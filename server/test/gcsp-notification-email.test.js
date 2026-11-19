import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createDeliveryEmailRoutes } from '../gcsp/notify/delivery-email.js';
const instant = '2026-11-05T09:00:00.000Z';
const cookie = (session) => [session.value.setCookie].flat().map((value) => value.split(';')[0]).join('; ');
async function setup(t) {
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'email-setting', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(runtime.status, 'ok'); const { identity, clock } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const sam = await identity.switchPrincipal(presenter.value.context, 'demo-sam', 'sam');
  const routes = createDeliveryEmailRoutes({ repository });
  const invoke = (method, body = {}, context = paula.value.context) => routes.find((route) => route.method === method)
    .handle({ context, body, searchParams: new URLSearchParams() });
  t.after(() => repository.close());
  return { repository, identity, clock, presenter, paula, sam, invoke };
}

test('settings save, replay, stale edit and clear stay private and isolated from other employees', async (t) => {
  const f = await setup(t);
  assert.deepEqual((await f.invoke('GET')).value, { deliveryEmail: null, version: 0 });
  const body = { commandId: 'save', expectedVersion: 0, deliveryEmail: 'paula@example.test' };
  const saved = await f.invoke('POST', body); assert.equal(saved.status, 'ok');
  assert.deepEqual(await f.invoke('POST', body), saved);
  assert.equal((await f.invoke('POST', { ...body, deliveryEmail: 'changed@example.test' })).status, 'conflict');
  assert.equal((await f.invoke('POST', { ...body, commandId: 'stale' })).status, 'stale-version');
  assert.deepEqual((await f.invoke('GET', {}, f.sam.value.context)).value, { deliveryEmail: null, version: 0 });
  assert.equal((await f.invoke('POST', { ...body, deliveryEmail: 'sam@example.test' }, f.sam.value.context)).status, 'ok');
  assert.equal((await f.invoke('GET', {}, f.sam.value.context)).value.deliveryEmail, 'sam@example.test');
  assert.equal((await f.invoke('POST', { commandId: 'clear', expectedVersion: 1, deliveryEmail: null })).status, 'ok');
  assert.deepEqual((await f.invoke('GET')).value, { deliveryEmail: null, version: 2 });
  const stored = await f.repository.read(f.paula.value.context, { table: 'employees', key: { runId: f.paula.value.context.runId, employeeId: 'employee-paula' } });
  assert.equal(stored.value.email, 'paula.mason@gcsp-demo.com');
  assert.equal(stored.value.deliveryEmail, null);
});

test('invalid inputs and recipient selectors cannot change settings', async (t) => {
  const f = await setup(t); const body = { commandId: 'save', expectedVersion: 0, deliveryEmail: 'valid@example.test' };
  for (const patch of [{ deliveryEmail: 'bad' }, { deliveryEmail: ' two@example.test' }, { deliveryEmail: 'two@example.test\n' },
    { deliveryEmail: 'one@example.test,two@example.test' }, { deliveryEmail: 3 }, { expectedVersion: -1 },
    { employeeId: 'employee-sam' }, { recipientId: 'employee-sam' }, { roles: ['presenter'] }]) {
    assert.equal((await f.invoke('POST', { ...body, ...patch })).status, 'invalid');
  }
  assert.equal((await f.invoke('GET')).value.version, 0);
});

test('address survives reopen, identity reseeding and reset, without appearing in identity context', async (t) => {
  const f = await setup(t);
  await f.invoke('POST', { commandId: 'save', expectedVersion: 0, deliveryEmail: 'private@example.test' });
  await f.repository.close(); await f.repository.open(); await f.identity.seedPrincipals();
  const refreshed = await f.identity.resolveSession({ authorized: true, cookie: cookie(f.paula) });
  assert.equal(refreshed.status, 'ok'); assert.ok(!JSON.stringify(refreshed).includes('private@example.test'));
  const state = (await f.clock.readState(f.presenter.value.context)).value;
  assert.equal((await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  const presenter = await f.identity.createPresenterSession('next-presenter');
  const paula = await f.identity.switchPrincipal(presenter.value.context, 'demo-paula', 'next-paula');
  assert.deepEqual((await f.invoke('GET', {}, paula.value.context)).value, { deliveryEmail: 'private@example.test', version: 1 });
  assert.equal(paula.value.context.email, 'paula.mason@gcsp-demo.com');
  assert.equal(paula.value.context.deliveryEmail, undefined);
});

test('reset never transfers a delivery address to a different principal with the same employee key', async (t) => {
  const f = await setup(t); const context = f.paula.value.context;
  await f.invoke('POST', { commandId: 'save', expectedVersion: 0, deliveryEmail: 'private@example.test' });
  const current = (await f.repository.currentRun(context.environmentId)).value;
  const runId = 'replacement-run';
  const reset = await f.repository.resetRun(context, { commandId: 'replacement', inputDigest: inputDigest('replacement') }, {
    expectedCurrentRunId: current.runId, expectedRunVersion: current.version,
    nextRun: { runId, environmentId: context.environmentId, current: true, status: 'active' },
    rows: [['employees', { employeeId: context.employeeId, principalId: 'different-person' }]],
  });
  assert.equal(reset.status, 'ok');
  const next = await f.repository.read({ ...context, runId }, { table: 'employees', key: { runId, employeeId: context.employeeId } });
  assert.equal(next.value.deliveryEmail, undefined);
});
