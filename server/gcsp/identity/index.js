import { createHash, randomBytes } from 'node:crypto';
import { inputDigest, ok, result } from '../repository/index.js';
import { loadDemoPrincipalSeed } from '../fixtures/principals.js';

export const SESSION_COOKIE = 'gcsp_session';
export const PRESENTER_COOKIE = 'gcsp_presenter';
const unavailable = () => result('unavailable', { reason: 'Identity service is unavailable.', retryable: true });
const refused = (status) => result(status, { reason: ({
  'missing-session': 'Choose an acting person using a presenter session.',
  'unknown-session': 'This session is not recognised.',
  'expired-session': 'This session has expired. Start a new presenter session.',
  'unknown-principal': 'This fictional person is not configured.',
  'stale-run': 'This request belongs to an earlier demonstration run.',
  forbidden: 'This person cannot perform that action.',
})[status] || 'The request is refused.' });
const hash = (token) => createHash('sha256').update(token).digest('hex');
const freeze = (object) => {
  if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object); }
  return object;
};
const command = (commandId, payload) => ({ commandId, inputDigest: inputDigest(payload) });

export class DemoIdentityAdapter {
  #repository;
  #policy;
  #currentRun;
  #sessionNow;
  #secure;
  #contexts = new WeakMap();

  constructor({ repository, policy, currentRun, sessionNow, secureCookies = true }) {
    if (!repository || !policy || typeof currentRun !== 'function' || typeof sessionNow !== 'function') {
      throw new TypeError('Inject repository, PolicyService, currentRun and server sessionNow.');
    }
    this.#repository = repository;
    this.#policy = policy;
    this.#currentRun = currentRun;
    this.#sessionNow = sessionNow;
    this.#secure = secureCookies;
  }

  async #run() {
    try {
      const current = await this.#currentRun();
      if (!current?.runId || !current.environmentId) return { error: unavailable() };
      const scope = { ...current, principalId: 'identity-service', roles: [] };
      const found = await this.#repository.read(scope, { table: 'runs', key: { runId: current.runId } });
      if (found.status !== 'ok') return { error: unavailable() };
      if (found.value.current !== true || found.value.status === 'historical') return { error: refused('stale-run') };
      const instant = this.#sessionNow();
      if (typeof instant !== 'string' || !Number.isFinite(Date.parse(instant))) return { error: unavailable() };
      return { scope, run: found.value, instant, read: { runId: current.runId, asOf: instant, policyVersion: found.value.policyVersion } };
    } catch { return { error: unavailable() }; }
  }

  async #configuration(state) {
    try {
      const seed = await loadDemoPrincipalSeed(this.#policy, state.read);
      return seed.status === 'ok' ? seed.value : { error: unavailable() };
    } catch { return { error: unavailable() }; }
  }

  async seedPrincipals() {
    const state = await this.#run();
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    return this.#repository.transaction(state.scope, command('identity:seed:v1', config), async (tx) => {
      for (const principal of config.principals) {
        const inserted = await tx.insert('employees', { ...principal, runId: state.scope.runId });
        if (inserted.status !== 'ok') return inserted;
        if (principal.roles.includes('employee')) {
          const slot = await tx.insert('entitlement_slots', {
            runId: state.scope.runId, employeeId: principal.employeeId, entitlementSlotId: principal.entitlementSlotId,
            capacity: config.capacity, employeeCapacity: config.capacity,
          });
          if (slot.status !== 'ok') return slot;
        }
      }
      return ok({ seeded: config.principals.length, runId: state.scope.runId });
    });
  }

  #context(state, session, principal) {
    const context = freeze({
      environmentId: state.scope.environmentId, runId: state.scope.runId,
      ...structuredClone(principal), policyVersion: state.run.policyVersion,
      principal: { principalId: principal.principalId, name: principal.name },
      schemeContext: principal.schemeId ? Object.fromEntries(['companyId', 'schemeId', 'gradeId', 'entitlementSlotId']
        .filter((key) => principal[key] !== undefined).map((key) => [key, principal[key]])) : null,
    });
    this.#contexts.set(context, { sessionIdHash: session.sessionIdHash, expiresAt: session.expiresAt });
    return context;
  }

  async #issue(state, controller, principal, commandId) {
    if (typeof commandId !== 'string' || !commandId.trim()) return result('invalid', {
      code: 'missing-command-id', reasons: [{ field: 'commandId', reason: 'Supply a new session command ID.' }],
    });
    const lifetime = await this.#policy.getAssumption('identity.session.durationSeconds', state.read);
    const clock = await this.#policy.getAssumption('identity.session.clock', state.read);
    const sameSite = await this.#policy.getAssumption('identity.session.sameSite', state.read);
    if (lifetime.status !== 'ok' || !Number.isSafeInteger(lifetime.value.value) || lifetime.value.value <= 0
      || clock.status !== 'ok' || clock.value.value !== 'server-wall-clock'
      || sameSite.status !== 'ok' || !['Strict', 'Lax', 'None'].includes(sameSite.value.value)
      || sameSite.value.value === 'None' && !this.#secure) return unavailable();
    const token = `${Buffer.from(state.scope.runId).toString('base64url')}.${randomBytes(32).toString('base64url')}`;
    const session = {
      runId: state.scope.runId, sessionIdHash: hash(token), principalId: principal.principalId,
      employeeId: principal.employeeId, actingPrincipalId: principal.principalId, roles: principal.roles,
      environmentId: state.scope.environmentId, expiresAt: new Date(Date.parse(state.instant) + lifetime.value.value * 1000).toISOString(),
    };
    // Receipts retain only hashed credentials; replay cannot recover a lost cookie.
    const inserted = await this.#repository.transaction(state.scope,
      command(`identity:issue:${controller.principalId}:${commandId}`, { principalId: principal.principalId }),
      (tx) => tx.insert('identity_sessions', session));
    if (inserted.status !== 'ok') return inserted;
    if (inserted.value.sessionIdHash !== session.sessionIdHash) return result('conflict', { reason: 'Session command already completed. Use a new command ID to issue another cookie.' });
    const setCookie = `${SESSION_COOKIE}=${token}; Path=/api/gcsp; HttpOnly; SameSite=${sameSite.value.value}; Expires=${new Date(session.expiresAt).toUTCString()}${this.#secure ? '; Secure' : ''}`;
    return ok({ context: this.#context(state, session, principal), setCookie });
  }

  // Trusted backend bootstrap only. There is deliberately no HTTP password-to-presenter endpoint.
  async createPresenterSession(commandId) {
    const seeded = await this.seedPrincipals();
    if (seeded.status !== 'ok') return seeded;
    const state = await this.#run();
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const presenter = config.principals.find((p) => p.roles.includes('presenter'));
    const issued = await this.#issue(state, presenter, presenter, commandId);
    if (issued.status !== 'ok') return issued;
    const actingCookie = issued.value.setCookie;
    return ok({ ...issued.value, setCookie: [actingCookie, actingCookie.replace(`${SESSION_COOKIE}=`, `${PRESENTER_COOKIE}=`)] });
  }

  async resolveSession({ authorized, cookie, purpose = 'acting' } = {}) {
    if (authorized !== true) return refused('forbidden');
    if (!['acting', 'presenter-control'].includes(purpose)) return refused('forbidden');
    const cookieName = purpose === 'presenter-control' ? PRESENTER_COOKIE : SESSION_COOKIE;
    const matches = typeof cookie === 'string' ? cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`)) : [];
    if (matches.length === 0) return refused('missing-session');
    if (matches.length !== 1) return refused('unknown-session');
    const token = matches[0].slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token) || token.length > 1024) return refused('unknown-session');
    const state = await this.#run();
    if (state.error) return state.error;
    if (Buffer.from(token.split('.')[0], 'base64url').toString() !== state.scope.runId) return refused('stale-run');
    const found = await this.#repository.read(state.scope, { table: 'identity_sessions', key: { runId: state.scope.runId, sessionIdHash: hash(token) } });
    if (found.status === 'not-found') return refused('unknown-session');
    if (found.status !== 'ok') return unavailable();
    const session = found.value;
    if (session.environmentId !== state.scope.environmentId) return refused('forbidden');
    if (!Number.isFinite(Date.parse(session.expiresAt))) return unavailable();
    if (Date.parse(state.instant) >= Date.parse(session.expiresAt)) return refused('expired-session');
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const principal = config.principals.find((p) => p.principalId === session.actingPrincipalId);
    if (!principal || principal.principalId !== session.principalId) return refused('unknown-principal');
    if (purpose === 'presenter-control' && !principal.roles.includes('presenter')) return refused('forbidden');
    const seeded = await this.#repository.read(state.scope, { table: 'employees', key: { runId: state.scope.runId, employeeId: principal.employeeId } });
    if (seeded.status === 'not-found') return refused('unknown-principal');
    if (seeded.status !== 'ok') return unavailable();
    return ok(this.#context(state, session, principal));
  }

  async #guard(context) {
    const auth = context && this.#contexts.get(context);
    if (!auth) return { error: refused('forbidden') };
    const state = await this.#run();
    if (state.error) return state;
    if (context.runId !== state.scope.runId || context.environmentId !== state.scope.environmentId) return { error: refused('stale-run') };
    if (Date.parse(state.instant) >= Date.parse(auth.expiresAt)) return { error: refused('expired-session') };
    return { ...state, auth };
  }

  async switchPrincipal(context, principalId, commandId) {
    const state = await this.#guard(context);
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const presenter = config.principals.find((p) => p.principalId === context.principalId && p.roles.includes('presenter'));
    if (!presenter) return refused('forbidden');
    const principal = config.principals.find((p) => p.principalId === principalId);
    if (!principal) return refused('unknown-principal');
    return this.#issue(state, presenter, principal, commandId);
  }

  async requireRole(context, role) {
    const guarded = await this.#guard(context);
    if (guarded.error) return guarded.error;
    return context.roles.includes(role) ? ok({ authorized: true }) : refused('forbidden');
  }

  async authorizeResource(context, resourceRef, action = 'read') {
    const guarded = await this.#guard(context);
    if (guarded.error) return guarded.error;
    if (!resourceRef?.key?.runId || resourceRef.key.runId !== context.runId) return refused('stale-run');
    if (!['briefs', 'holds', 'offers'].includes(resourceRef.table) || !['read', 'write'].includes(action)) return refused('forbidden');
    const found = await this.#repository.read(context, resourceRef);
    if (found.status !== 'ok') return found;
    return context.roles.includes('employee') && found.value.employeeId === context.employeeId
      ? ok(found.value) : refused('forbidden');
  }
}

export const createDemoIdentityAdapter = (options) => new DemoIdentityAdapter(options);
