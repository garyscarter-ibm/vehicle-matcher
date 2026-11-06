// AUTHORED ONLY. Requires reviewed f179ae6-or-later composed candidate and resource supervisor.
// Explicit --test target; deliberately outside the default test-suite glob until integration admission.
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { createGcspRuntime } from '../../../../server/gcsp/runtime.js';
import { buildServer } from '../../../../server/index.js';
import { createMemoryRepository, createMemoryStore } from '../../../../server/gcsp/repository/index.js';
import { createSyntheticStockProvider } from '../../../../server/gcsp/stock/index.js';
import { STOCK_FIELDS } from '../../../../server/gcsp/stock/port.js';
import { createPresenterHttpProofTransport } from '../../../../server/test/helpers/presenter-http-proof.js';

const origin = 'https://presenter-proof.invalid';
const environmentId = 'TEST-presenter-release-http';
const good = (reply) => { assert.equal(reply.status, 'ok', JSON.stringify(reply)); return reply.value; };
const cookie = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
let dom; let mount; let http;
const previousGlobals = new Map();
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: origin, pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true,
      value: name === 'window' ? dom.window : dom.window[name] });
  }
  ({ mountPresenterControls: mount } = await import('../../../../blocks/gcsp/presenter-controls/controls.js'));
  ({ createPresenterHttpAdapter: http } = await import('../../../../blocks/gcsp/presenter-controls/http-adapter.js'));
});
beforeEach(() => document.body.replaceChildren());
after(() => {
  dom?.window.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

async function waitFor(predicate, description) {
  const deadline = performance.now() + 3000;
  while (!predicate()) {
    assert.ok(performance.now() < deadline, description);
    await delay(1);
  }
}

async function setup(t) {
  const pulls = []; let source; let fault = null;
  // Explicit isolated pull-port input. It is not the delivered host's future run-aware TEST profile.
  const stockProvider = { async pull(request) {
    pulls.push(structuredClone(request));
    if (fault === 'unavailable') return { status: 'unavailable' };
    if (fault === 'malformed') return { status: 'ok', value: { schemaVersion: 'TEST-malformed' } };
    assert.ok(source, 'TEST window must be prepared before startup/tick');
    return source.pull(request);
  } };
  const store = createMemoryStore();
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository: createMemoryRepository({ store }),
    environmentId, policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'TEST-bootstrap', stockProvider,
    sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => runtime.close());
  let presenter = good(await runtime.identity.createPresenterSession('TEST-presenter'));
  let time = good(await runtime.clock.now(presenter.context));
  let run = good(await runtime.repository.currentRun(environmentId));
  const principals = good(await runtime.policy.getAssumption('identity.demo.principals', {
    runId: run.runId, asOf: time.now, policyVersion: run.policyVersion }));
  const employee = principals.value.find((row) => row.roles.includes('employee'));
  const greg = principals.value.find((row) => row.roles.includes('greg'));
  assert.ok(employee && greg);
  const acting = good(await runtime.identity.switchPrincipal(presenter.context, employee.principalId, 'TEST-employee'));
  const editor = good(await runtime.identity.switchPrincipal(presenter.context, greg.principalId, 'TEST-greg'));
  const step = await runtime.policy.getAssumption('clock.presenter.stepSeconds', {
    runId: run.runId, asOf: time.now, policyVersion: run.policyVersion });
  if (step.status !== 'ok') {
    good(await runtime.policy.adoptReviewedAssumptions(editor.context, { commandId: 'TEST-reviewed-step',
      expectedActiveVersion: run.policyVersion, policyVersion: 'TEST-presenter-reviewed-v2', effectiveFrom: time.now,
      definitionSetId: 'presenter-controls-v1' }));
    presenter = { ...presenter, context: good(await runtime.identity.resolveSession({ authorized: true,
      cookie: cookie(presenter.setCookie), purpose: 'presenter-control' })) };
    run = good(await runtime.repository.currentRun(environmentId));
    time = good(await runtime.clock.now(presenter.context));
  }
  const configuration = good(await runtime.policy.getAssumption('clock.scenario.v1', {
    runId: run.runId, asOf: time.now, policyVersion: run.policyVersion }));
  const releaseSize = good(await runtime.policy.getAssumption('supply.release.size', {
    runId: run.runId, asOf: time.now, policyVersion: run.policyVersion }));
  const initialStock = good(await runtime.repository.query(presenter.context, 'stock', {}));
  const selected = initialStock.filter((row) => row.state === 'unreleased').slice(0, Math.min(2, releaseSize.value));
  assert.ok(selected.length > 0, 'Use actual bootstrap identities, without inventing business facts.');
  const cars = selected.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => STOCK_FIELDS.includes(key))));
  source = createSyntheticStockProvider({ runId: run.runId, version: 'TEST-presenter-release-v1',
    label: 'TEST isolated count/HTTP proof; bootstrap identity facts only; no business preparation',
    windows: [{ windowId: 'TEST-first-window', availableAt: configuration.value.namedTimes.release,
      supplyId: null, stock: cars }] });
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  good(await server.gcspStartup);
  assert.equal(pulls.length, 0, 'Startup must not invoke release-pull.');
  const transport = createPresenterHttpProofTransport(server, { origin });
  transport.acceptIssuedCookies(presenter.setCookie); transport.acceptIssuedCookies(acting.setCookie);
  t.after(() => transport.clear());
  const sent = [];
  const adapter = http({ fetchImpl: (url, options) => {
    if (options.method === 'POST' && url.endsWith('/presenter/controls/tick')) sent.push(JSON.parse(options.body));
    return transport.fetchImpl(url, options);
  } });
  const host = document.createElement('div'); document.body.append(host);
  const navigation = []; let commands = 0; let control;
  const mountControl = () => {
    control?.destroy();
    control = mount(host, { adapter, commandId: () => `TEST-presenter-command-${++commands}`,
      navigate: (url) => navigation.push(url) });
  };
  mountControl(); t.after(() => control.destroy());
  const button = (label) => [...host.querySelectorAll('button')].find((row) => row.textContent === label
    || row.textContent.startsWith(label + ' ('));
  const ready = () => waitFor(() => button('Tick')?.disabled === false, 'Actual authenticated controls must load.');
  await ready();
  return { runtime, presenter, adapter, transport, host, navigation, sent, pulls, initialStock, selected,
    setFault(value) { fault = value; }, mountControl, ready,
    click(label) { const node = button(label); assert.ok(node && !node.hidden && !node.disabled, label); node.click(); },
    button, stock: () => runtime.repository.query(presenter.context, 'stock', {}).then(good),
    receipts: () => runtime.repository.query(presenter.context, 'event_receipts', { consumerId: 'stock-release' }).then(good) };
}

async function released(f) {
  f.click('Next release');
  await waitFor(() => f.button('Tick')?.disabled === false && /\d+ cars released/.test(f.host.textContent), 'Actual release result must reach controller.');
  const state = good(await f.adapter.readControls());
  const registrations = state.lastTick.handlerOrder.filter((row) => row.handlerId === 'stock-release' || row.stage === 'release-pull');
  const outcomes = state.lastTick.outcomes.filter((row) => row.handlerId === 'stock-release' || row.stage === 'release-pull');
  assert.equal(registrations.length, 1); assert.equal(outcomes.length, 1);
  assert.deepEqual(registrations[0], { handlerId: 'stock-release', stage: 'release-pull' });
  const value = good(outcomes[0].outcome);
  assert.equal(value.kind, 'stock-released'); assert.equal(value.runId, state.runId);
  assert.equal(value.tickId, state.lastTick.tickId); assert.equal(state.lastTick.eventId, value.tickId);
  return { state, value };
}

test('release-http: startup and actual release IDs match controller count and inventory delta', { timeout: 10000 }, async (t) => {
  const f = await setup(t); assert.deepEqual(await f.stock(), f.initialStock);
  const { value } = await released(f);
  const stock = await f.stock(); const ids = f.selected.map((row) => row.orderUuid).sort();
  assert.deepEqual([...value.orderUuids].sort(), ids); assert.equal(f.pulls.length, 1);
  assert.match(f.host.textContent, new RegExp(`${ids.length} cars released`));
  const changed = stock.filter((row) => f.initialStock.find((old) => old.orderUuid === row.orderUuid)?.state !== row.state);
  assert.deepEqual(changed.map((row) => row.orderUuid).sort(), ids);
  for (const row of changed) {
    assert.equal(row.state, 'released');
    assert.deepEqual(row.facts, f.initialStock.find((old) => old.orderUuid === row.orderUuid).facts,
      'Count proof must preserve identity-only bootstrap facts; no released-row business repair.');
  }
});

test('release-http: lost body retries the exact committed command once', { timeout: 10000 }, async (t) => {
  const f = await setup(t); f.transport.loseNextReply('/api/gcsp/presenter/controls/tick');
  f.click('Next release');
  await waitFor(() => f.button('Retry original action')?.hidden === false && !f.button('Retry original action').disabled, 'Original retry must become available.');
  const before = good(await f.adapter.readControls()); const stock = await f.stock(); const receipts = await f.receipts();
  assert.equal(receipts.length, 1); assert.equal(f.pulls.length, 1);
  f.click('Retry original action');
  await waitFor(() => f.button('Tick')?.disabled === false && f.sent.length === 2, 'Acknowledged original retry must finish.');
  const after = good(await f.adapter.readControls());
  assert.deepEqual(f.sent[1], f.sent[0]); assert.equal(after.clockVersion, before.clockVersion); assert.equal(after.now, before.now);
  assert.equal(after.lastTick.tickId, before.lastTick.tickId); assert.equal(f.pulls.length, 1);
  assert.deepEqual(await f.stock(), stock); assert.deepEqual(await f.receipts(), receipts);
  assert.match(f.host.textContent, new RegExp(`${f.selected.length} cars released`));
});

test('release-http: a genuine exhausted source reports zero on the next ordinary tick', { timeout: 10000 }, async (t) => {
  const f = await setup(t); await released(f); const stock = await f.stock();
  f.click('Tick');
  await waitFor(() => f.button('Tick')?.disabled === false && /0 cars released/.test(f.host.textContent), 'Real empty release must report zero.');
  const state = good(await f.adapter.readControls());
  const outcome = state.lastTick.outcomes.find((row) => row.handlerId === 'stock-release').outcome;
  assert.equal(good(outcome).kind, 'no-release'); assert.deepEqual(outcome.value.orderUuids, []);
  assert.deepEqual(await f.stock(), stock); assert.equal((await f.receipts()).length, 1);
});

test('release-http: unavailable source refuses release without stock mutation', { timeout: 10000 }, async (t) => {
  const f = await setup(t); f.setFault('unavailable'); f.click('Next release');
  await waitFor(() => f.pulls.length === 1 && f.button('Retry original action')?.hidden === false, 'Actual source refusal must settle.');
  const state = good(await f.adapter.readControls());
  assert.equal(state.lastTick.outcomes.find((row) => row.handlerId === 'stock-release').outcome.status, 'unavailable');
  assert.match(f.host.textContent, /Release unavailable/); assert.doesNotMatch(f.host.textContent, /\d+ cars released/);
  assert.deepEqual(await f.stock(), f.initialStock); assert.deepEqual(await f.receipts(), []);
});

test('release-http: malformed pull is rejected by the actual producer without stock mutation', { timeout: 10000 }, async (t) => {
  const f = await setup(t); f.setFault('malformed'); f.click('Next release');
  await waitFor(() => f.pulls.length === 1 && f.button('Retry original action')?.hidden === false, 'Actual producer validation must settle.');
  const state = good(await f.adapter.readControls());
  const outcome = state.lastTick.outcomes.find((row) => row.handlerId === 'stock-release').outcome;
  assert.equal(outcome.status, 'invalid'); assert.equal(outcome.code, 'invalid-stock-pull');
  assert.match(f.host.textContent, /Release unavailable/); assert.doesNotMatch(f.host.textContent, /\d+ cars released/);
  assert.deepEqual(await f.stock(), f.initialStock); assert.deepEqual(await f.receipts(), []);
});

test('release-http: actual mechanics reset renews authority and old provider refuses the new run', { timeout: 10000 }, async (t) => {
  const f = await setup(t); await released(f);
  const before = good(await f.adapter.readControls()); const clock = f.runtime.clock; const service = f.runtime.stockRelease;
  f.click('Reset scenario'); f.click('Confirm reset');
  await waitFor(() => f.navigation.length === 1, 'Actual acknowledged reset must request workspace navigation.');
  const fresh = good(await f.adapter.readControls()); const acting = good(await f.adapter.readContext());
  assert.notEqual(fresh.runId, before.runId); assert.equal(acting.runId, fresh.runId);
  assert.equal(f.runtime.clock, clock); assert.equal(f.runtime.stockRelease, service);
  const audit = good(await f.runtime.identity.createPresenterSession('TEST-new-run-read'));
  const newStock = good(await f.runtime.repository.query(audit.context, 'stock', {}));
  assert.ok(newStock.every((row) => !f.initialStock.some((old) => old.orderUuid === row.orderUuid)));
  f.mountControl(); await f.ready(); f.click('Next release');
  await waitFor(() => f.pulls.some((request) => request.runId === fresh.runId)
    && f.button('Retry original action')?.hidden === false, 'Old run-bound provider refusal must reach real HTTP/controller.');
  const refused = good(await f.adapter.readControls());
  const result = refused.lastTick.outcomes.find((row) => row.handlerId === 'stock-release');
  assert.equal(result.stage, 'release-pull'); assert.equal(result.outcome.status, 'invalid');
  assert.equal(result.outcome.code, 'invalid-stock-pull');
  assert.match(f.host.textContent, /Release unavailable/); assert.doesNotMatch(f.host.textContent, /\d+ cars released/);
  assert.deepEqual(good(await f.runtime.repository.query(audit.context, 'stock', {})), newStock);
});
