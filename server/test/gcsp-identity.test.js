import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { DemoIdentityAdapter } from '../gcsp/identity/index.js';
const read = { runId: 'identity-run-1', asOf: '2026-11-05T00:00:00.000Z' };
const seedUrl = new URL('../gcsp/policy/seed-v1.json', import.meta.url);
const context = (runId = read.runId) => ({ environmentId: 'identity-test', runId, principalId: 'trusted-bootstrap', roles: [] });
const command = (commandId, data = {}) => ({ commandId, inputDigest: inputDigest(data) });
const cookieOf = (session) => [session.value.setCookie].flat().map((cookie) => cookie.split(';')[0]).join('; ');

async function setup({ policy = createPolicyService(), secureCookies = true } = {}) {
  const store = createMemoryStore();
  let current = context();
  let instant = read.asOf;
  const repository = createMemoryRepository({ store, now: () => instant });
  assert.equal((await repository.open()).status, 'ok');
  const version = await policy.getActiveVersion(read);
  assert.equal(version.status, 'ok');
  const addRun = async (runId) => {
    const scope = context(runId);
    const result = await repository.transaction(scope, command(`run:${runId}`), (tx) => tx.insert('runs', {
      runId, environmentId: scope.environmentId, current: true, status: 'active', policyVersion: version.policyVersion,
    }));
    assert.equal(result.status, 'ok');
  };
  await addRun(current.runId);
  const identity = new DemoIdentityAdapter({ repository, policy, currentRun: () => current, sessionNow: () => instant, secureCookies });
  const seeded = await identity.seedPrincipals();
  assert.equal(seeded.status, 'ok');
  const presenter = await identity.createPresenterSession('presenter-1');
  assert.equal(presenter.status, 'ok');
  let counter = 0;
  const acting = async (principalId) => {
    const result = await identity.switchPrincipal(presenter.value.context, principalId, `switch-${++counter}`);
    assert.equal(result.status, 'ok');
    return result;
  };
  return {
    identity, repository, presenter, acting, store, addRun,
    now: () => instant, advance: (seconds) => { instant = new Date(Date.parse(instant) + seconds * 1000).toISOString(); },
    reset: async () => {
      const old = await repository.read(current, { table: 'runs', key: { runId: current.runId } });
      assert.equal((await repository.transaction(current, command('mark-historical'), (tx) => tx.compareAndSwap({ table: 'runs', key: { runId: current.runId } }, old.value.version, { current: false, status: 'historical' }))).status, 'ok');
      current = context('identity-run-2');
      await addRun(current.runId);
    },
  };
}

async function resolve(fixture, session) {
  return fixture.identity.resolveSession({ authorized: true, cookie: cookieOf(session) });
}

test('configured fictional people seed once per run, with exact policy-owned scheme/grade/slot', async () => {
  const f = await setup();
  assert.equal((await f.identity.seedPrincipals()).status, 'ok');
  const configured = await createPolicyService().getAssumption('identity.demo.principals', read);
  const employees = await f.repository.query(context(), 'employees');
  assert.equal(employees.value.length, configured.value.value.length);
  for (const principal of configured.value.value) {
    const acting = await f.acting(principal.principalId);
    const resolved = await resolve(f, acting);
    assert.equal(resolved.status, 'ok');
    for (const key of Object.keys(principal).filter((key) => key !== 'name')) assert.deepEqual(resolved.value[key], principal[key]);
    assert.equal(resolved.value.name, principal.name === 'Presenter' ? 'Presenter Taylor' : principal.name);
    assert.equal(resolved.value.runId, read.runId);
    assert.ok(Object.isFrozen(resolved.value));
    assert.ok(Object.isFrozen(resolved.value.roles));
  }
  assert.equal((await f.repository.query(context(), 'entitlement_slots')).value.length, configured.value.value.filter((p) => p.roles.includes('employee')).length);
  assert.ok(employees.value.every((person) => person.email.endsWith('@gcsp-demo.com') && person.lastName));
  assert.ok(!JSON.stringify(employees.value).match(/licence|password/));
});

test('sessions require a successful shared gate and distinguish missing, unknown and expired', async () => {
  const f = await setup();
  assert.equal((await f.identity.resolveSession({ cookie: cookieOf(f.presenter) })).status, 'forbidden');
  assert.equal((await f.identity.resolveSession({ authorized: true })).status, 'missing-session');
  assert.equal((await f.identity.resolveSession({ authorized: true, cookie: 'gcsp_session=unknown' })).status, 'unknown-session');
  const unknown = `${Buffer.from(read.runId).toString('base64url')}.${'a'.repeat(43)}`;
  assert.equal((await f.identity.resolveSession({ authorized: true, cookie: `gcsp_session=${unknown}` })).status, 'unknown-session');
  assert.equal((await f.identity.resolveSession({ authorized: true, cookie: `${cookieOf(f.presenter)}; ${cookieOf(f.presenter)}` })).status, 'unknown-session');
  const lifetime = await createPolicyService().getAssumption('identity.session.durationSeconds', read);
  f.advance(lifetime.value.value - 1);
  assert.equal((await resolve(f, f.presenter)).status, 'ok');
  f.advance(1);
  assert.equal((await resolve(f, f.presenter)).status, 'expired-session');
  assert.equal((await f.identity.requireRole(f.presenter.value.context, 'presenter')).status, 'expired-session');
});

test('session cookies are HttpOnly and secure; storage and transaction receipts contain only credential hashes', async () => {
  const f = await setup();
  for (const cookie of f.presenter.value.setCookie) {
    const attributes = cookie.split(';').slice(1).join(';');
    assert.match(attributes, /; HttpOnly; SameSite=None;/);
    assert.match(attributes, /; Secure$/);
    assert.match(attributes, /Path=\/;/);
  }
  const token = f.presenter.value.setCookie[0].split(';')[0].split('=')[1];
  assert.ok(!JSON.stringify(f.store.state).includes(token));
  const stored = (await f.repository.query(context(), 'identity_sessions')).value[0];
  assert.match(stored.sessionIdHash, /^[a-f0-9]{64}$/);
  assert.equal((await f.identity.createPresenterSession('presenter-1')).status, 'conflict');
});

test('browser identity fields cannot replace the server context or forge a trusted context', async () => {
  const f = await setup();
  const paula = await f.acting('demo-paula');
  const resolved = await f.identity.resolveSession({ authorized: true, cookie: cookieOf(paula), principalId: 'demo-greg', roles: ['greg'], runId: 'other', gradeId: 'G11-14' });
  assert.equal(resolved.value.principalId, 'demo-paula');
  assert.deepEqual(resolved.value.roles, ['employee']);
  assert.equal((await f.identity.requireRole({ ...resolved.value, roles: ['greg'] }, 'greg')).status, 'forbidden');
  assert.equal((await f.identity.requireRole(null, 'greg')).status, 'forbidden');
  assert.equal((await f.identity.switchPrincipal({ ...f.presenter.value.context }, 'demo-greg', 'forged')).status, 'forbidden');
});

test('Greg and presenter permissions stay separate from each selected acting person', async () => {
  const f = await setup();
  const paula = await f.acting('demo-paula');
  const greg = await f.acting('demo-greg');
  for (const role of ['greg', 'presenter']) assert.equal((await f.identity.requireRole(paula.value.context, role)).status, 'forbidden');
  assert.equal((await f.identity.requireRole(greg.value.context, 'greg')).status, 'ok');
  assert.equal((await f.identity.requireRole(greg.value.context, 'presenter')).status, 'forbidden');
  assert.equal((await f.identity.requireRole(f.presenter.value.context, 'greg')).status, 'forbidden');
  assert.equal((await f.identity.requireRole(f.presenter.value.context, 'presenter')).status, 'ok');
  assert.equal((await f.identity.switchPrincipal(paula.value.context, 'demo-greg', 'employee-escalation')).status, 'forbidden');
  assert.equal((await f.identity.switchPrincipal(f.presenter.value.context, 'not-configured', 'unknown')).status, 'unknown-principal');
});

async function addResources(f) {
  assert.equal((await f.repository.transaction(context(), command('resources'), async (tx) => {
    for (const [table, row] of [
      ['stock', { orderUuid: 'car-alex' }],
      ['quotes', { quoteId: 'quote-alex', employeeId: 'employee-alex' }],
      ['briefs', { employeeId: 'employee-alex', briefVersion: 1 }],
      ['holds', { holdId: 'hold-alex', employeeId: 'employee-alex', orderUuid: 'car-alex', entitlementSlotId: 'slot-alex', quoteId: 'quote-alex', type: 'buddy-offer', state: 'active' }],
      ['offers', { offerId: 'offer-alex', holdId: 'hold-alex', employeeId: 'employee-alex', quoteId: 'quote-alex' }],
    ]) { const inserted = await tx.insert(table, { runId: read.runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    return ok({ seeded: true });
  })).status, 'ok');
}

test('brief, hold and offer access uses persisted ownership for each read and write', async () => {
  const f = await setup();
  await addResources(f);
  const paula = (await f.acting('demo-paula')).value.context;
  const alex = (await f.acting('demo-alex')).value.context;
  for (const [table, key] of [
    ['briefs', { employeeId: 'employee-alex', briefVersion: 1 }],
    ['holds', { holdId: 'hold-alex' }], ['offers', { offerId: 'offer-alex' }],
  ]) {
    const ref = { table, key: { runId: read.runId, ...key } };
    for (const action of ['read', 'write']) {
      const forbidden = await f.identity.authorizeResource(paula, ref, action);
      assert.equal(forbidden.status, 'forbidden');
      assert.ok(!JSON.stringify(forbidden).includes('alex'));
      assert.equal((await f.identity.authorizeResource(alex, ref, action)).status, 'ok');
    }
    assert.equal((await f.identity.authorizeResource(f.presenter.value.context, ref)).status, 'forbidden');
    assert.equal((await f.identity.authorizeResource(paula, { ...ref, key: { ...ref.key, runId: 'old-run' } })).status, 'stale-run');
  }
  assert.equal((await f.identity.authorizeResource(alex, { table: 'offers', key: { runId: read.runId, offerId: 'missing' } })).status, 'not-found');
  assert.equal((await f.identity.authorizeResource(alex, { table: 'employees', key: { runId: read.runId, employeeId: alex.employeeId } })).status, 'forbidden');
});

test('reset makes old sessions, contexts and resource commands stale, then seeds the new run', async () => {
  const f = await setup();
  await f.reset();
  assert.equal((await resolve(f, f.presenter)).status, 'stale-run');
  assert.equal((await f.identity.requireRole(f.presenter.value.context, 'presenter')).status, 'stale-run');
  assert.equal((await f.identity.switchPrincipal(f.presenter.value.context, 'demo-greg', 'old-command')).status, 'stale-run');
  const next = await f.identity.createPresenterSession('presenter-next-run');
  assert.equal(next.status, 'ok');
  assert.equal(next.value.context.runId, 'identity-run-2');
  const configured = await createPolicyService().getAssumption('identity.demo.principals', read);
  assert.equal((await f.repository.query(context('identity-run-2'), 'employees')).value.length, configured.value.value.length);
  assert.equal((await f.identity.authorizeResource(next.value.context, { table: 'offers', key: { runId: read.runId, offerId: 'old' } })).status, 'stale-run');
});

test('changing canonical lifetime affects new cookies, with no identity fallback defaults', async () => {
  const seed = JSON.parse(await readFile(seedUrl, 'utf8'));
  seed.assumptions.find((row) => row.key === 'identity.session.durationSeconds').value = 17;
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const f = await setup({ policy });
  f.advance(17);
  assert.equal((await resolve(f, f.presenter)).status, 'expired-session');
  const broken = { async getAssumption() { return { status: 'unavailable' }; } };
  const unavailable = new DemoIdentityAdapter({ repository: f.repository, policy: broken, currentRun: () => context(), sessionNow: f.now });
  assert.equal((await unavailable.createPresenterSession('missing-policy')).status, 'unavailable');
});

test('unknown configured principal and repository outage are explicit session outcomes', async () => {
  const f = await setup();
  const session = (await f.repository.query(context(), 'identity_sessions')).value[0];
  assert.equal((await f.repository.transaction(context(), command('unknown-principal'), (tx) => tx.compareAndSwap({ table: 'identity_sessions', key: { runId: read.runId, sessionIdHash: session.sessionIdHash } }, session.version, { actingPrincipalId: 'removed-principal' }))).status, 'ok');
  assert.equal((await resolve(f, f.presenter)).status, 'unknown-principal');
  await f.repository.close();
  assert.equal((await resolve(f, f.presenter)).status, 'unavailable');
});

test('backend presentation fixtures retain the context and distinct safe refusal shapes', async () => {
  const evidence = JSON.parse(await readFile(new URL('./fixtures/gcsp-identity-outcomes.json', import.meta.url), 'utf8'));
  const f = await setup();
  const paula = await f.acting('demo-paula');
  assert.deepEqual(await resolve(f, paula), evidence.context);
  assert.deepEqual(await f.identity.resolveSession({ authorized: true }), evidence.refusals.missing);
  assert.deepEqual(await f.identity.resolveSession({ authorized: true, cookie: 'gcsp_session=unknown' }), evidence.refusals.unknown);
  assert.deepEqual(await f.identity.requireRole(paula.value.context, 'greg'), evidence.refusals.forbidden);
  assert.deepEqual(await f.identity.switchPrincipal(f.presenter.value.context, 'not-configured', 'unknown-evidence'), evidence.refusals.principal);
  const lifetime = await createPolicyService().getAssumption('identity.session.durationSeconds', read);
  f.advance(lifetime.value.value);
  assert.deepEqual(await resolve(f, paula), evidence.refusals.expired);
  await f.reset();
  assert.deepEqual(await resolve(f, paula), evidence.refusals.stale);
});
