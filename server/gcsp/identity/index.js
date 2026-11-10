import { createHash, randomBytes } from 'node:crypto';
import { inputDigest, ok, result } from '../repository/index.js';
import { loadDemoPrincipalSeed } from '../fixtures/principals.js';
import { activateRunPolicy } from '../policy/activation.js';
import { validInstant } from '../policy/file-provider.js';
import { DemoLoginAdapter, demoLoginProfile } from './login-adapter.js';

export const SESSION_COOKIE = 'gcsp_session';
export const PRESENTER_COOKIE = 'gcsp_presenter';
const unavailable = () => result('unavailable', { reason: 'Identity service is unavailable.', retryable: true });
const refused = (status) => result(status, { reason: ({
  'missing-session': 'Sign in to continue.',
  'unknown-session': 'This session is not recognised.',
  'expired-session': 'Your session has expired. Sign in again.',
  'unknown-principal': 'This person is not configured.',
  'stale-run': 'This page is out of date. Reload to see the latest.',
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
  #login;
  #contexts = new WeakMap();

  constructor({ repository, policy, currentRun, sessionNow, secureCookies = true, loginAdapter = new DemoLoginAdapter() }) {
    if (!repository || !policy || typeof currentRun !== 'function' || typeof sessionNow !== 'function') {
      throw new TypeError('Inject repository, PolicyService, currentRun and server sessionNow.');
    }
    this.#repository = repository;
    this.#policy = policy;
    this.#currentRun = currentRun;
    this.#sessionNow = sessionNow;
    this.#secure = secureCookies;
    if (typeof loginAdapter?.authenticate !== 'function') throw new TypeError('Inject a login adapter with authenticate.');
    this.#login = loginAdapter;
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
      return { scope, run: found.value, instant, read: { runId: current.runId, asOf: validInstant(found.value.clockInstant) ? found.value.clockInstant : instant, policyVersion: found.value.policyVersion } };
    } catch { return { error: unavailable() }; }
  }

  async #adoptPolicy(state) {
    if (state.error || state.run.status === 'historical' || state.run.clockInstant === undefined) return state;
    const activated = await activateRunPolicy({ repository: this.#repository, policy: this.#policy }, state.scope);
    if (activated.status !== 'ok') return { error: activated };
    return { ...state, run: activated.value.run, read: { runId: state.scope.runId,
      asOf: activated.value.asOf, policyVersion: activated.value.policyVersion } };
  }

  async #configuration(state) {
    try {
      const seed = await loadDemoPrincipalSeed(this.#policy, state.read);
      return seed.status === 'ok' ? seed.value : { error: unavailable() };
    } catch { return { error: unavailable() }; }
  }

  async seedPrincipals() {
    // Activate first: a reset can carry a run-published policy version the new run does not hold.
    const state = await this.#adoptPolicy(await this.#run());
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const seeded = await this.#repository.transaction(state.scope, command(`identity:seed:v2:${inputDigest(config)}`, config), async (tx) => {
      for (const principal of config.principals) {
        const existing = await tx.get({ table: 'employees', key: { runId: state.scope.runId, employeeId: principal.employeeId } });
        if (existing.status === 'not-found') {
          const inserted = await tx.insert('employees', { ...principal, runId: state.scope.runId });
          if (inserted.status !== 'ok') return inserted;
        } else if (existing.status !== 'ok') return existing;
        if (principal.roles.includes('employee')) {
          const existingSlot = await tx.get({ table: 'entitlement_slots', key: { runId: state.scope.runId, entitlementSlotId: principal.entitlementSlotId } });
          if (existingSlot.status === 'not-found') {
            const slot = await tx.insert('entitlement_slots', {
              runId: state.scope.runId, employeeId: principal.employeeId, entitlementSlotId: principal.entitlementSlotId,
              capacity: config.capacity, employeeCapacity: config.capacity,
            });
            if (slot.status !== 'ok') return slot;
          } else if (existingSlot.status !== 'ok') return existingSlot;
        }
      }
      return ok({ seeded: config.principals.length, runId: state.scope.runId });
    });
    if (seeded.status !== 'ok') return seeded;
    return this.#repository.transaction(state.scope, command(`identity:profiles:v1:${inputDigest(config.principals)}`, config.principals), async (tx) => {
      const emails = new Set();
      for (const principal of config.principals) {
        const ref = { table: 'employees', key: { runId: state.scope.runId, employeeId: principal.employeeId } };
        const found = await tx.get(ref);
        if (found.status !== 'ok') return found;
        const profile = demoLoginProfile(principal, found.value);
        if (emails.has(profile.email)) return unavailable();
        emails.add(profile.email);
        const patch = { ...profile };
        const manual = found.value.contract?.manualContext;
        if (manual?.account) patch.contract = { ...found.value.contract, manualContext: { ...manual,
          account: { ...manual.account, name: profile.name, contact: { ...manual.account.contact, email: profile.email } },
          ...(manual.drivers ? { drivers: manual.drivers.map((driver) => driver.kind === 'employee' ? { ...driver, name: profile.name } : driver) } : {}),
        } };
        if (Object.entries(patch).some(([key, value]) => inputDigest(value) !== inputDigest(found.value[key] ?? null))) {
          const changed = await tx.compareAndSwap(ref, found.value.version, patch);
          if (changed.status !== 'ok') return changed;
        }
      }
      return seeded;
    });
  }

  #context(state, session, principal) {
    const context = freeze({
      environmentId: state.scope.environmentId, runId: state.scope.runId,
      ...structuredClone(principal), policyVersion: state.run.policyVersion,
      principal: { principalId: principal.principalId, name: principal.name, email: principal.email },
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
    const setCookie = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite.value.value}; Expires=${new Date(session.expiresAt).toUTCString()}${this.#secure ? '; Secure' : ''}`;
    return ok({ context: this.#context(state, session, principal), setCookie });
  }

  #expiredCookies() {
    return [[SESSION_COOKIE, '/'], [SESSION_COOKIE, '/api/gcsp'], [PRESENTER_COOKIE, '/'], [PRESENTER_COOKIE, '/api/gcsp'],
      ['gcsp_offer_access', '/api/gcsp/offers']].map(([name, path]) => `${name}=; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=0${this.#secure ? '; Secure' : ''}`);
  }

  async signIn(credentials, commandId) {
    if (!credentials || typeof credentials.email !== 'string' || credentials.email.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(credentials.email.trim())
      || typeof credentials.password !== 'string' || !credentials.password.length || credentials.password.length > 1024
      || Object.keys(credentials).some((key) => !['email', 'password'].includes(key))) {
      return result('invalid', { code: 'invalid-credentials-input', reasons: [{ field: 'credentials', reason: 'Enter your email and password.' }] });
    }
    const seeded = await this.seedPrincipals();
    if (seeded.status !== 'ok') return seeded;
    const state = await this.#adoptPolicy(await this.#run());
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const principals = [];
    for (const principal of config.principals) {
      const found = await this.#repository.read(state.scope, { table: 'employees', key: { runId: state.scope.runId, employeeId: principal.employeeId } });
      if (found.status !== 'ok') return unavailable();
      principals.push({ ...principal, ...demoLoginProfile(principal, found.value) });
    }
    let authenticated;
    try { authenticated = await this.#login.authenticate({ email: credentials.email.trim().toLowerCase(), password: credentials.password }, { principals: structuredClone(principals) }); }
    catch { return unavailable(); }
    if (authenticated?.status !== 'ok') return authenticated?.status === 'invalid-credentials'
      ? result('invalid-credentials', { reason: 'Email or password did not match.' }) : unavailable();
    const principal = principals.find((entry) => entry.principalId === authenticated.value?.principalId);
    if (!principal || !principal.roles.some((role) => ['employee', 'greg'].includes(role))) return refused('forbidden');
    const issued = await this.#issue(state, principal, principal, commandId);
    if (issued.status !== 'ok') return issued;
    return ok({ ...issued.value, redirectTo: principal.roles.includes('greg') ? '/gcsp-greg.html' : '/gcsp-account.html',
      setCookie: [issued.value.setCookie, ...this.#expiredCookies().filter((c) => !c.startsWith(`${SESSION_COOKIE}=; Path=/;`))] });
  }

  async signOut({ cookie } = {}) {
    const resolved = await this.resolveSession({ authorized: true, cookie });
    if (resolved.status === 'ok') {
      const context = resolved.value;
      const auth = this.#contexts.get(context);
      const revoked = await this.#repository.transaction(context, command(`identity:revoke:${auth.sessionIdHash}`, { sessionIdHash: auth.sessionIdHash }), async (tx) => {
        const ref = { table: 'identity_sessions', key: { runId: context.runId, sessionIdHash: auth.sessionIdHash } };
        const found = await tx.get(ref);
        if (found.status !== 'ok') return found;
        return found.value.revokedAt ? ok({}) : tx.compareAndSwap(ref, found.value.version, { revokedAt: this.#sessionNow() });
      });
      if (revoked.status !== 'ok') return revoked;
    } else if (!['missing-session', 'unknown-session', 'expired-session', 'stale-run', 'unknown-principal'].includes(resolved.status)) return resolved;
    return ok({ setCookie: this.#expiredCookies() });
  }

  // Trusted backend bootstrap only. There is deliberately no HTTP password-to-presenter endpoint.
  async createPresenterSession(commandId) {
    const seeded = await this.seedPrincipals();
    if (seeded.status !== 'ok') return seeded;
    const state = await this.#adoptPolicy(await this.#run());
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const presenter = config.principals.find((p) => p.roles.includes('presenter'));
    const issued = await this.#issue(state, presenter, presenter, commandId);
    if (issued.status !== 'ok') return issued;
    const actingCookie = issued.value.setCookie;
    return ok({ ...issued.value, setCookie: [actingCookie, actingCookie.replace(`${SESSION_COOKIE}=`, `${PRESENTER_COOKIE}=`)] });
  }

  async createPresenterControlSession(commandId) {
    const presenter = await this.createPresenterSession(commandId);
    if (presenter.status !== 'ok') return presenter;
    return ok({ setCookie: [presenter.value.setCookie[1],
      ...this.#expiredCookies().filter((cookie) => cookie.includes('; Path=/api/gcsp;'))] });
  }

  async resolveSession({ authorized, cookie, purpose = 'acting' } = {}) {
    if (authorized !== true) return refused('forbidden');
    if (!['acting', 'presenter-control', 'reset-replay'].includes(purpose)) return refused('forbidden');
    const cookieName = purpose === 'acting' ? SESSION_COOKIE : PRESENTER_COOKIE;
    const matches = typeof cookie === 'string' ? cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${cookieName}=`)) : [];
    if (matches.length === 0) return refused('missing-session');
    if (matches.length !== 1) return refused('unknown-session');
    const token = matches[0].slice(cookieName.length + 1);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token) || token.length > 1024) return refused('unknown-session');
    let state = await this.#run();
    if (state.error) return state.error;
    const tokenRunId = Buffer.from(token.split('.')[0], 'base64url').toString();
    if (tokenRunId !== state.scope.runId) {
      if (purpose !== 'reset-replay') return refused('stale-run');
      // The reset route alone may authenticate an old presenter to retrieve its recorded outcome.
      // It cannot issue a new command or read resources through this historical context.
      const scope = { ...state.scope, runId: tokenRunId };
      const old = await this.#repository.read(scope, { table: 'runs', key: { runId: tokenRunId } });
      if (old.status !== 'ok' || old.value.environmentId !== scope.environmentId || old.value.status !== 'historical') return refused('stale-run');
      state = { ...state, scope, run: old.value, read: { runId: tokenRunId, asOf: state.instant, policyVersion: old.value.policyVersion } };
    }
    const found = await this.#repository.read(state.scope, { table: 'identity_sessions', key: { runId: state.scope.runId, sessionIdHash: hash(token) } });
    if (found.status === 'not-found') return refused('unknown-session');
    if (found.status !== 'ok') return unavailable();
    const session = found.value;
    if (session.revokedAt) return refused('unknown-session');
    if (session.environmentId !== state.scope.environmentId) return refused('forbidden');
    if (!Number.isFinite(Date.parse(session.expiresAt))) return unavailable();
    if (Date.parse(state.instant) >= Date.parse(session.expiresAt)) return refused('expired-session');
    state = await this.#adoptPolicy(state);
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const principal = config.principals.find((p) => p.principalId === session.actingPrincipalId);
    if (!principal || principal.principalId !== session.principalId) return refused('unknown-principal');
    if (purpose !== 'acting' && !principal.roles.includes('presenter')) return refused('forbidden');
    const seeded = await this.#repository.read(state.scope, { table: 'employees', key: { runId: state.scope.runId, employeeId: principal.employeeId } });
    if (seeded.status === 'not-found') return refused('unknown-principal');
    if (seeded.status !== 'ok') return unavailable();
    return ok(this.#context(state, session, { ...principal, ...demoLoginProfile(principal, seeded.value),
      ...(seeded.value.renewalId ? { renewalId: seeded.value.renewalId } : {}) }));
  }

  async #guard(context) {
    const auth = context && this.#contexts.get(context);
    if (!auth) return { error: refused('forbidden') };
    const state = await this.#run();
    if (state.error) return state;
    if (context.runId !== state.scope.runId || context.environmentId !== state.scope.environmentId) return { error: refused('stale-run') };
    if (Date.parse(state.instant) >= Date.parse(auth.expiresAt)) return { error: refused('expired-session') };
    const stored = await this.#repository.read(state.scope, { table: 'identity_sessions', key: { runId: state.scope.runId, sessionIdHash: auth.sessionIdHash } });
    if (stored.status !== 'ok') return { error: stored.status === 'not-found' ? refused('unknown-session') : unavailable() };
    if (stored.value.revokedAt) return { error: refused('unknown-session') };
    return { ...state, auth };
  }

  async switchPrincipal(context, principalId, commandId) {
    const guarded = await this.#guard(context);
    if (guarded.error) return guarded.error;
    if (!context.roles.includes('presenter')) return refused('forbidden');
    const state = await this.#adoptPolicy(guarded);
    if (state.error) return state.error;
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const presenter = config.principals.find((p) => p.principalId === context.principalId && p.roles.includes('presenter'));
    if (!presenter) return refused('forbidden');
    const principal = config.principals.find((p) => p.principalId === principalId);
    if (!principal) return refused('unknown-principal');
    const stored = await this.#repository.read(state.scope, { table: 'employees', key: { runId: state.scope.runId, employeeId: principal.employeeId } });
    if (stored.status !== 'ok') return unavailable();
    return this.#issue(state, presenter, { ...principal, ...demoLoginProfile(principal, stored.value) }, commandId);
  }

  async readPresenterPrincipals(context) {
    const state = await this.#guard(context);
    if (state.error) return state.error;
    if (!context.roles.includes('presenter')) return refused('forbidden');
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    return ok(config.principals.map(({ principalId, name, roles }) => ({ principalId, name, roles: [...roles] })));
  }

  async requireRole(context, role) {
    const guarded = await this.#guard(context);
    if (guarded.error) return guarded.error;
    return context.roles.includes(role) ? ok({ authorized: true }) : refused('forbidden');
  }

  // Trusted in-process cohort work only. Never exposed as an employee-ID login route.
  async resolveEmployeeContext(controller, employeeId) {
    const state = await this.#guard(controller);
    if (state.error) return state.error;
    if (!controller.roles.includes('presenter')) return refused('forbidden');
    const config = await this.#configuration(state);
    if (config.error) return config.error;
    const principal = config.principals.find((p) => p.employeeId === employeeId && p.roles.includes('employee'));
    if (!principal) return refused('unknown-principal');
    const seeded = await this.#repository.read(state.scope, { table: 'employees', key: { runId: state.scope.runId, employeeId } });
    if (seeded.status !== 'ok') return seeded.status === 'not-found' ? refused('unknown-principal') : unavailable();
    if (!seeded.value.roles?.includes('employee')
      || ['principalId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId'].some((key) => seeded.value[key] !== principal[key])) return refused('forbidden');
    const slot = await this.#repository.read(state.scope, { table: 'entitlement_slots', key: { runId: state.scope.runId, entitlementSlotId: principal.entitlementSlotId } });
    if (slot.status !== 'ok' || slot.value.employeeId !== employeeId) return refused('forbidden');
    return ok(this.#context(state, state.auth, { ...principal, ...demoLoginProfile(principal, seeded.value),
      ...(seeded.value.renewalId ? { renewalId: seeded.value.renewalId } : {}) }));
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
