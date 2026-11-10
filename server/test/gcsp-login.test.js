import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { DemoIdentityAdapter } from '../gcsp/identity/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { buildServer } from '../index.js';
import { createGcspFront, gcspRuntimeOptions, REPO_ROOT } from '../gcsp/host.js';

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
    assert.equal(reply.value.redirectTo, person.roles.includes('greg') ? '/gcsp-greg.html' : '/gcsp-account.html');
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

test('HTTP login is gated by origin and shared access, rejects context claims, hides cookies and revokes logout', async (t) => {
  const f = await setup();
  const server = buildServer({ gcspIdentity: f.identity, gcspAllowedOrigins: ['https://login.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  const post = (path, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: 'POST', headers: { Origin: 'https://login.test', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post('/api/gcsp/session/login', credentials, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('/api/gcsp/session/login', { ...credentials, employeeId: 'employee-alex' })).status, 400);
  assert.equal((await post('/api/gcsp/session/login', { ...credentials, password: 'wrong' })).status, 401);
  const login = await post('/api/gcsp/session/login', credentials);
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const body = await login.json();
  assert.equal(body.value.context.employeeId, 'employee-paula');
  assert.ok(!JSON.stringify(body).match(/setCookie|sessionIdHash|fucq/));
  const cookie = login.headers.getSetCookie().filter((c) => !c.includes('Max-Age=0')).map((c) => c.split(';')[0]).join('; ');
  assert.equal((await post('/api/gcsp/session/logout', { employeeId: 'employee-alex' }, { cookie })).status, 400);
  assert.equal((await post('/api/gcsp/session/logout', {}, { cookie })).status, 200);
  const session = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/context`, { headers: { cookie } });
  assert.equal(session.status, 401);
});

test('live HTML requires the user cookie across navigation; Presenter never silently signs in an employee', async (t) => {
  const f = await setup();
  const api = buildServer({ gcspIdentity: f.identity });
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let presenterBoots = 0;
  const services = { identity: f.identity, async createPresenterControlSession() {
    presenterBoots += 1;
    return f.identity.createPresenterControlSession(`presenter:${presenterBoots}`);
  } };
  server.on('request', createGcspFront({ root: REPO_ROOT, services, api, origin }));
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  const get = (path, cookie) => fetch(origin + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  assert.equal((await get('/')).headers.get('location'), '/gcsp/login');
  for (const path of ['/gcsp-account.html', '/gcsp-brief-live.html', '/gcsp-greg.html']) {
    const signedOut = await get(path);
    assert.equal(signedOut.status, 303);
    assert.equal(signedOut.headers.get('location'), '/gcsp/login');
    assert.equal(signedOut.headers.get('cache-control'), 'no-store');
    assert.deepEqual(signedOut.headers.getSetCookie(), []);
  }
  assert.equal((await get('/gcsp/login')).status, 200);
  const presenter = await get('/gcsp-presenter.html');
  assert.equal(presenter.status, 200);
  assert.equal(presenterBoots, 1);
  assert.ok(presenter.headers.getSetCookie().every((c) => c.startsWith('gcsp_presenter=') || c.includes('Max-Age=0')));
  assert.ok(presenter.headers.getSetCookie().some((c) => c.startsWith('gcsp_presenter=; Path=/api/gcsp;') && c.includes('Max-Age=0')));
  assert.ok(presenter.headers.getSetCookie().some((c) => c.startsWith('gcsp_session=; Path=/api/gcsp;') && c.includes('Max-Age=0')));
  const login = await f.identity.signIn(credentials, 'html-login');
  const cookie = cookieOf(login);
  for (const path of ['/gcsp-account.html', '/gcsp-brief-live.html', '/gcsp-activity-live.html', '/gcsp-help.html']) {
    assert.equal((await get(path, cookie)).status, 200, path);
  }
  assert.equal((await get('/gcsp-greg.html', cookie)).headers.get('location'), '/gcsp-account.html');
  assert.equal((await get('/gcsp/login', cookie)).headers.get('location'), '/gcsp-account.html');
  assert.equal((await get('/', cookie)).headers.get('location'), '/gcsp-account.html');
  await f.identity.signOut({ cookie });
  assert.equal((await get('/gcsp-account.html', cookie)).headers.get('location'), '/gcsp/login');
  assert.equal(gcspRuntimeOptions({ env: {} }).mode, 'postgres');
});
