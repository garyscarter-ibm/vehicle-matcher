import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoIdentityAdapter } from '../gcsp/identity/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
const scope = { runId: 'login-run', environmentId: 'login-test', principalId: 'bootstrap', roles: [] };
const instant = '2026-11-10T12:00:00.000Z';
const cookieOf = (reply) => [reply.value.setCookie].flat().filter((c) => !c.includes('Max-Age=0')).map((c) => c.split(';')[0]).join('; ');
const credentials = { email: 'paula.mason@gcsp-demo.com', password: 'fucq' };
async function setup(options = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  await repository.open();
  const policy = createPolicyService();
  const version = await policy.getActiveVersion({ runId: scope.runId, asOf: instant });
  await repository.transaction(scope, { commandId: 'bootstrap', inputDigest: inputDigest(scope) }, (tx) => tx.insert('runs', {
    runId: scope.runId, environmentId: scope.environmentId, current: true, status: 'active', policyVersion: version.policyVersion,
  }));
  const configuration = { repository, policy, currentRun: () => scope, sessionNow: () => instant, ...options };
  const identity = new DemoIdentityAdapter(configuration);
  return { identity, repository, policy, configuration, store };
}

test('each live configured person signs in through email, receives their stored profile and no presenter grant', async () => {
  const f = await setup();
  const people = await f.policy.getAssumption('identity.demo.principals', { runId: scope.runId, asOf: instant });
  for (const person of people.value.value.filter((p) => !p.roles.includes('presenter'))) {
    const email = `${person.name.toLowerCase().replaceAll(' ', '.')}@gcsp-demo.com`;
    const reply = await f.identity.signIn({ email: `  ${email.toUpperCase()}  `, password: 'fucq' }, `login:${person.principalId}`);
    assert.equal(reply.status, 'ok', JSON.stringify(reply));
    assert.equal(reply.value.context.principalId, person.principalId);
    assert.equal(reply.value.context.name, person.name);
    assert.equal(reply.value.context.email, email);
    assert.ok(reply.value.context.lastName);
    assert.equal(reply.value.redirectTo, person.roles.includes('employee') ? '/gcsp/account' : '/gcsp/greg');
    assert.match(reply.value.setCookie[0], /; Path=\/; HttpOnly; SameSite=None;.*; Secure$/);
    assert.ok(!reply.value.setCookie.some((c) => c.startsWith('gcsp_presenter=') && !c.includes('Max-Age=0')));
    const resolved = await f.identity.resolveSession({ authorized: true, cookie: cookieOf(reply) });
    assert.equal(resolved.status, 'ok');
    assert.equal(resolved.value.employeeId, person.employeeId);
    assert.equal(resolved.value.email, email);
  }
  const data = await f.repository.query(scope, 'employees');
  assert.ok(data.value.every((p) => p.firstName && p.lastName && p.email.endsWith('@gcsp-demo.com')));
  assert.ok(!JSON.stringify(f.store).includes('fucq'));
});

test('unknown email and wrong password fail alike and create no session', async () => {
  const f = await setup();
  for (const input of [{ ...credentials, password: 'wrong' }, { ...credentials, email: 'nobody@example.com' },
    { email: 'presenter.taylor@gcsp-demo.com', password: 'fucq' }]) {
    const reply = await f.identity.signIn(input, 'bad-login');
    assert.equal(reply.status, 'invalid-credentials');
    assert.equal(reply.reason, 'Email or password did not match.');
  }
  assert.equal((await f.repository.query(scope, 'identity_sessions')).value.length, 0);
  assert.equal((await f.identity.signIn({ email: credentials.email }, 'missing')).status, 'invalid');
});

test('the login adapter can be replaced but its role and identity claims never become authority', async () => {
  let received;
  const loginAdapter = { async authenticate(input) { received = input; return ok({ principalId: 'demo-alex', roles: ['presenter'], employeeId: 'employee-paula' }); } };
  const f = await setup({ loginAdapter });
  const reply = await f.identity.signIn(credentials, 'external-login');
  assert.equal(reply.status, 'ok');
  assert.deepEqual(received, credentials);
  assert.equal(reply.value.context.employeeId, 'employee-alex');
  assert.deepEqual(reply.value.context.roles, ['employee']);
  for (const principalId of ['missing', 'demo-presenter']) {
    const adapter = new DemoIdentityAdapter({ ...f.configuration, loginAdapter: { authenticate: async () => ok({ principalId }) } });
    assert.equal((await adapter.signIn(credentials, `external:${principalId}`)).status, 'forbidden');
  }
});

test('profile backfill preserves existing contract/preferences and stable IDs, and supplies a missing surname', async () => {
  const f = await setup();
  await f.repository.transaction(scope, { commandId: 'legacy', inputDigest: inputDigest('legacy') }, (tx) => tx.insert('employees', {
    runId: scope.runId, employeeId: 'employee-paula', principalId: 'demo-paula', name: 'Paula', roles: ['employee'],
    companyId: 'demo-bmw-fs-uk', schemeId: 'choices-fs-uk', gradeId: 'G7', entitlementSlotId: 'slot-paula',
    contract: { manualContext: { account: { name: 'Paula', contact: { email: 'employee-paula@example.invalid', phone: 'unchanged' } },
      contracts: [{ contractId: 'saved-car', currentOdometer: { value: 8800 } }], preferences: { fuel: 'electric' } } },
  }));
  const signedIn = await f.identity.signIn(credentials, 'backfill-login');
  assert.equal(signedIn.status, 'ok');
  const stored = await f.repository.read(scope, { table: 'employees', key: { runId: scope.runId, employeeId: 'employee-paula' } });
  assert.equal(stored.value.name, 'Paula Mason');
  assert.equal(stored.value.contract.manualContext.account.contact.email, credentials.email);
  assert.equal(stored.value.contract.manualContext.account.contact.phone, 'unchanged');
  assert.equal(stored.value.contract.manualContext.contracts[0].contractId, 'saved-car');
  assert.deepEqual(stored.value.contract.manualContext.preferences, { fuel: 'electric' });
  assert.equal((await f.identity.seedPrincipals()).status, 'ok');
  assert.equal((await f.repository.read(scope, { table: 'employees', key: { runId: scope.runId, employeeId: 'employee-paula' } })).value.version, stored.value.version);
});

test('sign-out revokes server authority including issued in-process contexts and survives reconstruction', async () => {
  const f = await setup();
  const login = await f.identity.signIn(credentials, 'logout-login');
  const cookie = cookieOf(login);
  const other = await f.identity.signIn({ email: 'alex.brennan@gcsp-demo.com', password: 'fucq' }, 'alex-login');
  assert.equal((await f.identity.requireRole(login.value.context, 'employee')).status, 'ok');
  const out = await f.identity.signOut({ cookie });
  assert.equal(out.status, 'ok');
  assert.ok(out.value.setCookie.every((c) => c.includes('Max-Age=0')));
  assert.equal((await f.identity.requireRole(login.value.context, 'employee')).status, 'unknown-session');
  const reconstructed = new DemoIdentityAdapter(f.configuration);
  assert.equal((await reconstructed.resolveSession({ authorized: true, cookie })).status, 'unknown-session');
  assert.equal((await reconstructed.resolveSession({ authorized: true, cookie: cookieOf(other) })).value.employeeId, 'employee-alex');
  assert.equal((await reconstructed.signOut({ cookie })).status, 'ok');
});
