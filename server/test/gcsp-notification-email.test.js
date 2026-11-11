import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { JSDOM } from 'jsdom';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createDeliveryEmailRoutes } from '../gcsp/notify/delivery-email.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';
import { mountNotificationEmail } from '../../blocks/gcsp/account/notification-email.js';
import { accountFixture } from '../../blocks/gcsp/account/fixtures.js';

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

test('real HTTP setting route enforces session, employee role, origin and employee ownership', async (t) => {
  const f = await setup(t);
  const server = buildServer({ gcspRepository: f.repository, gcspIdentity: f.identity,
    gcspAllowedOrigins: ['https://setting.test'], gcspVehicleEvidence: { lookup: { resolve: async () => ({ status: 'unavailable' }) } } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  const base = `http://127.0.0.1:${server.address().port}`; const path = '/api/gcsp/manual/notification-email';
  const body = { commandId: 'http-save', expectedVersion: 0, deliveryEmail: 'http@example.test' };
  const request = (session, origin, input = body) => fetch(`${base}${path}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(session ? { cookie: cookie(session) } : {}), ...(origin ? { Origin: origin } : {}),
  }, body: JSON.stringify(input) });
  assert.equal((await request(null, 'https://setting.test')).status, 401);
  assert.equal((await request(f.presenter, 'https://setting.test')).status, 403);
  assert.equal((await request(f.paula, undefined)).status, 403);
  assert.equal((await request(f.paula, 'https://attacker.test')).status, 403);
  assert.equal((await request(f.paula, 'https://setting.test', { ...body, employeeId: 'employee-sam' })).status, 400);
  const adapter = createAccountHttpAdapter({ base, fetchImpl: (url, options) => fetch(url, { ...options,
    headers: { ...options.headers, cookie: cookie(f.paula), Origin: 'https://setting.test' } }) });
  assert.equal((await adapter.saveNotificationEmail(body)).status, 'ok');
  assert.deepEqual((await adapter.readNotificationEmail()).value, { deliveryEmail: 'http@example.test', version: 1 });
  assert.equal((await f.invoke('GET', {}, f.sam.value.context)).value.deliveryEmail, null);
});

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://setting.test' });
for (const name of ['document', 'window', 'HTMLElement', 'Node', 'CustomEvent']) {
  Object.defineProperty(globalThis, name, { value: name === 'window' ? dom.window : dom.window[name], configurable: true });
}
const { mountAccount } = await import('../../blocks/gcsp/account/gcsp-account.js');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const submit = async (root, value) => { root.querySelector('input').value = value;
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); };
const adapterFor = (saveNotificationEmail) => ({ readNotificationEmail: async () => ({ status: 'ok', value: { deliveryEmail: null, version: 0 } }), saveNotificationEmail });

test('email form validates, retries a lost response with the same command, then clears', async () => {
  const root = document.createElement('div'); const calls = [];
  const stop = mountNotificationEmail(root, { adapter: adapterFor(async (body) => {
    calls.push(body); return calls.length === 1 ? { status: 'unavailable' } : { status: 'ok', value: { deliveryEmail: body.deliveryEmail, version: calls.length - 1 } };
  }) }); await stop.ready;
  await submit(root, 'bad'); assert.equal(calls.length, 0); assert.equal(root.querySelector('input').getAttribute('aria-invalid'), 'true');
  await submit(root, ' one@example.test '); assert.equal(calls.length, 1); assert.match(root.textContent, /Could not save/);
  await submit(root, 'one@example.test'); assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]); assert.match(root.textContent, /Saved\./);
  await submit(root, ''); assert.equal(calls[2].deliveryEmail, null); assert.equal(calls[2].expectedVersion, 1); assert.match(root.textContent, /notifications off/);
  stop();
});

test('stale edits require reload and expired access locks the form', async () => {
  const root = document.createElement('div'); let status = 'stale-version';
  const stop = mountNotificationEmail(root, { adapter: adapterFor(async () => ({ status })) }); await stop.ready;
  await submit(root, 'one@example.test'); assert.equal(root.querySelector('input').disabled, true); assert.match(root.textContent, /Reload it/);
  [...root.querySelectorAll('button')].find((node) => node.textContent === 'Reload email').click(); await tick();
  assert.equal(root.querySelector('input').disabled, false); status = 'access-required';
  await submit(root, 'one@example.test'); assert.equal(root.querySelector('input').disabled, true); assert.match(root.textContent, /Sign in again/);
  stop();
});

test('load errors allow retry and teardown ignores pending responses', async () => {
  const root = document.createElement('div'); let release;
  const stop = mountNotificationEmail(root, { adapter: { readNotificationEmail: async () => ({ status: 'unavailable' }) } });
  await stop.ready; assert.equal(root.querySelector('input').disabled, true);
  assert.equal([...root.querySelectorAll('button')].find((node) => node.textContent === 'Reload email').disabled, false); stop();
  const pending = mountNotificationEmail(root, { adapter: { readNotificationEmail: () => new Promise((resolve) => { release = resolve; }) } });
  pending(); release({ status: 'ok', value: { deliveryEmail: 'late@example.test', version: 1 } }); await pending.ready;
  assert.equal(root.querySelector('input').value, '');
});

test('Your details mounts the email control once and preserves unsaved input across account redraws', async () => {
  const root = document.createElement('div'); let reads = 0;
  const adapter = { ...adapterFor(async () => ({ status: 'unavailable' })),
    readNotificationEmail: async () => { reads++; return { status: 'ok', value: { deliveryEmail: null, version: 0 } }; },
    readAccount: async () => accountFixture('ready'), readDraft: async () => ({ status: 'not-found' }) };
  const stop = mountAccount(root, { adapter }); await tick(); await tick();
  const input = root.querySelector('input[type=email]'); assert.ok(input); input.value = 'unsaved@example.test';
  assert.match(input.closest('section').textContent, /Your details/);
  const disclosure = input.closest('details'); assert.ok(disclosure); assert.equal(disclosure.open, false);
  assert.equal(disclosure.closest('.gcsp-account-row'), root.querySelector('.gcsp-account-rows').lastElementChild);
  disclosure.open = true;
  [...root.querySelectorAll('button')].find((node) => node.textContent === 'Get help with your details').click();
  assert.equal(input.closest('details'), disclosure); assert.equal(disclosure.open, true);
  assert.equal(root.querySelector('input[type=email]'), input); assert.equal(input.value, 'unsaved@example.test'); assert.equal(reads, 1); stop();
});
