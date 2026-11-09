// Seven selected C1/host cases. In-process HTTP only; no listener or live source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';

const origin = 'https://composition.test';
const expectedRegistrations = [
  { handlerId: 'stock-release', stage: 'release-pull' },
  { handlerId: 'manual-claim-expiry', stage: 'manual-expiry' },
  { handlerId: 'buddy-expiry', stage: 'buddy-expiry' },
  { handlerId: 'buddy-allocation', stage: 'buddy-allocation' },
  { handlerId: 'selection-order-reconciliation', stage: 'pending-reconciliation' },
  { handlerId: 'lifecycle-approvals', stage: 'pending-reconciliation' },
  { handlerId: 'lifecycle-documents', stage: 'pending-reconciliation' },
  { handlerId: 'lifecycle-appointments', stage: 'pending-reconciliation' },
  { handlerId: 'lifecycle-return-appointments', stage: 'pending-reconciliation' },
  { handlerId: 'lifecycle-return-outcomes', stage: 'pending-reconciliation' },
  { handlerId: 'renewal-risk-cases', stage: 'pending-reconciliation' },
  { handlerId: 'captured-outbox', stage: 'outbox-dispatch' },
];
// Deliberately never serialize a result/context/cookie into assertion diagnostics.
const good = (value) => { assert.equal(value?.status, 'ok'); return value.value; };
const cookies = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
async function request(f, path, { body, session = f.employeeCookie } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: {
    host: 'composition.test', origin, cookie: session,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
    end(body) { this.body = body; } };
  await f.server.listeners('request')[0](req, response);
  return { status: response.status, headers: response.headers, json: response.body ? JSON.parse(response.body) : null };
}
async function setup(t, { provider = createCompositionTestProfile(), start = true } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider: provider ?? undefined,
    environmentId: 'composition-test', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'composition-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const registrations = []; const register = runtime.clock.registerHandler.bind(runtime.clock);
  runtime.clock.registerHandler = async (input) => { registrations.push({ handlerId: input.handlerId, stage: input.stage }); return register(input); };
  const local = good(await runtime.createLocalSession());
  const employeeCookie = cookies(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: employeeCookie, purpose: 'presenter-control' }));
  const f = { ...runtime, runtime, store, profile: provider, registrations, employee: local.context, employeeCookie, presenter };
  t.after(async () => { try { await f.dispose?.(); } finally { await runtime.close(); } });
  if (start) { f.server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] }); good(await f.server.gcspStartup); }
  return f;
}
async function saveChoices(f) {
  const account = good((await request(f, '/api/gcsp/manual/account')).json);
  const action = account.actions.find((entry) => entry.enabled); assert.ok(action);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee'); assert.ok(driver);
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(f.employee.schemeId) && entry.driverKinds.includes(driver.kind));
  assert.ok(option);
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  assert.ok(location);
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
    requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
    brand: account.choices.brands[0], contact: account.account.contact,
    expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
  const saved = await request(f, '/api/gcsp/manual/draft', { body: { commandId: 'composition-save',
    expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices } });
  assert.equal(saved.status, 200); good(saved.json);
  return { account, choices };
}
async function tick(f, eventId = 'composition-release', to = '2026-11-05T12:00:00.000Z') {
  let time = good(await f.clock.now(f.presenter));
  if (Date.parse(time.now) < Date.parse(to)) {
    good(await f.clock.advance(f.presenter, { commandId: `advance:${eventId}`, expectedClockVersion: time.clockVersion, to }));
    time = good(await f.clock.now(f.presenter));
  }
  return f.clock.tick(f.presenter, { eventId, inputDigest: inputDigest(eventId), expectedClockVersion: time.clockVersion });
}

test('C1 shared runtime authority and bound raw manual receivers serve authenticated setup', async (t) => {
  const f = await setup(t);
  for (const [name, value] of Object.entries({ gcspRepository: f.repository, gcspPolicy: f.policy, gcspClock: f.clock,
    gcspIdentity: f.identity, gcspScenarios: f.scenarios, gcspManualClaims: f.manualClaims,
    gcspManualRead: f.manualRead, gcspManualReview: f.manualReview, gcspStockRelease: f.stockRelease, gcspCases: f.cases })) {
    assert.equal(f.dependencies[name], value);
  }
  assert.notEqual(f.manualRead, f.manualClaims);
  const { choices } = await saveChoices(f);
  const draft = await request(f, '/api/gcsp/manual/draft'); assert.equal(draft.status, 200);
  assert.equal(good(draft.json).choices.driverId, choices.driverId);
  const employee = good(await f.repository.read(f.employee, ref(f.employee, 'employees', { employeeId: f.employee.employeeId })));
  const manual = employee.contract.manualContext;
  assert.ok(manual.recordSetId); assert.ok(manual.source);
  assert.ok(manual.drivers.some((entry) => entry.driverId === choices.driverId && entry.eligible.value === true));
  assert.equal(Object.hasOwn(manual.employeeFacts, 'driverEligible'), false);
  const browse = await request(f, '/api/gcsp/manual/stock'); assert.equal(browse.status, 200); good(browse.json);
  const absentClaim = await request(f, '/api/gcsp/manual/claim');
  assert.equal(absentClaim.status, 404); assert.equal(absentClaim.json.status, 'not-found');
});

test('C1 release registry is preseal and memoized while ordinary startup releases nothing', async (t) => {
  const f = await setup(t);
  assert.deepEqual(f.registrations, expectedRegistrations);
  good(await f.stockRelease.register()); good(await f.manualClaims.registerClockHandler());
  good(await f.buddy.start()); good(await f.manualOrder.registerClockHandler());
  good(await f.lifecycle.start()); good(await f.documents.start());
  good(await f.cases.start()); good(await f.notify.start()); good(await f.server.gcspStartup);
  assert.deepEqual(f.registrations, expectedRegistrations); assert.equal(f.profile.calls.length, 0);
  assert.equal(f.store.state.tables.event_receipts.filter((row) => row.consumerId === 'stock-release').length, 0);
  assert.equal(f.store.state.tables.stock.filter((row) => row.release).length, 0);
});

test('C1 actual pull commits exact TEST facts and authenticated decorated stock preserves raw claimInput', async (t) => {
  const f = await setup(t); await saveChoices(f);
  const car = await f.profile.prepare(f.runtime, f.employee);
  const before = structuredClone(f.store.state.tables.stock);
  const released = good(await tick(f));
  assert.equal(f.profile.calls.length, 1);
  const outcome = released.outcomes.find((row) => row.handlerId === 'stock-release').outcome;
  assert.deepEqual(good(outcome).orderUuids, [car.orderUuid]);
  const committed = good(await f.repository.read(f.employee, ref(f.employee, 'stock', { orderUuid: car.orderUuid })));
  assert.equal(committed.state, 'released'); assert.equal(committed.orderNumber, car.orderNumber);
  assert.deepEqual(committed.facts, car.facts); assert.deepEqual(committed.visibility, car.visibility);
  for (const original of before) assert.deepEqual(f.store.state.tables.stock.find((row) => row.orderUuid === original.orderUuid), original);
  const raw = good(await f.manualClaims.browseStock(f.employee));
  const response = await request(f, '/api/gcsp/manual/stock'); assert.equal(response.status, 200);
  const decorated = good(response.json); const { releaseHistory, ...preserved } = decorated;
  assert.deepEqual(preserved, raw);
  const decision = decorated.decisions.find((row) => row.orderUuid === car.orderUuid); assert.ok(decision);
  assert.equal(decision.gateStatus, 'eligible'); assert.ok(decision.claimInput);
  assert.deepEqual(decision.claimInput, raw.decisions.find((row) => row.orderUuid === car.orderUuid).claimInput);
  assert.equal(releaseHistory.runId, f.employee.runId); assert.equal(releaseHistory.history.releasedCarCount, 1);
  assert.equal(releaseHistory.history.releaseCount, 1); assert.equal(releaseHistory.history.latestReleasedAt, released.now);
  assert.deepEqual(releaseHistory.history.sourceVersions, [committed.release.sourceVersion]);
  assert.equal(releaseHistory.source.state, 'current-version-unknown');
});

test('C1 omitted stock provider has no release service or synthetic fallback and reports missing stage', async (t) => {
  const omitted = await setup(t, { provider: null });
  assert.equal(omitted.stockRelease, undefined);
  const result = good(await tick(omitted));
  assert.ok(result.missingStages.includes('release-pull'));
  assert.equal(result.outcomes.some((row) => row.handlerId === 'stock-release'), false);
  assert.equal(omitted.store.state.tables.event_receipts.some((row) => row.consumerId === 'stock-release'), false);
});

test('C1 actual presealed clock refuses release registration and guards ordinary HTTP with503', async (t) => {
  const f = await setup(t, { start: false }); good(await f.clock.reconcileStartup());
  f.server = buildServer({ ...f.dependencies, gcspAllowedOrigins: [origin] });
  assert.equal((await f.server.gcspStartup).status, 'invalid');
  assert.equal((await f.stockRelease.register()).status, 'invalid');
  const blocked = await request(f, '/api/gcsp/manual/account'); assert.equal(blocked.status, 503);
  assert.equal(blocked.json.status, 'unavailable'); assert.equal(blocked.headers['cache-control'], 'no-store');
  assert.equal((await request(f, '/health')).status, 200); assert.equal(f.profile.calls.length, 0);
});

test('C1 real mechanics reset rejects stale employee and refuses missing fresh run TEST profile', async (t) => {
  const f = await setup(t); await saveChoices(f); const car = await f.profile.prepare(f.runtime, f.employee);
  good(await tick(f));
  const scenario = good(await f.scenarios.readCatalogue(f.presenter)).scenarios.find((entry) => entry.kind === 'mechanics');
  assert.ok(scenario); const state = good(await f.scenarios.readState(f.presenter));
  const reset = await request(f, '/api/gcsp/presenter/scenarios/reset', { session: f.employeeCookie, body: {
    commandId: 'composition-reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion,
  } });
  assert.equal(reset.status, 200); assert.notEqual(good(reset.json).runId, f.employee.runId);
  assert.equal((await f.identity.requireRole(f.employee, 'employee')).status, 'stale-run');
  assert.equal((await f.manualRead.readAccount(f.employee)).status, 'stale-run');
  const local = good(await f.createLocalSession()); f.employee = local.context; f.employeeCookie = cookies(local.setCookie);
  f.presenter = good(await f.identity.resolveSession({ authorized: true, cookie: f.employeeCookie, purpose: 'presenter-control' }));
  assert.equal(good(await f.manualRead.readAccount(f.employee)).state, 'ready');
  const unavailable = await tick(f, 'fresh-run-release');
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.handlerId, 'stock-release');
  assert.equal(unavailable.handlerOutcome.status, 'unavailable');
  assert.equal(f.profile.calls.at(-1).runId, f.employee.runId);
  assert.equal((await f.repository.read(f.employee, ref(f.employee, 'stock', { orderUuid: car.orderUuid }))).status, 'not-found');
  assert.deepEqual(f.registrations, expectedRegistrations);
});

test('host account setup Back and resume retain real saved choices and unchanged current car', async (t) => {
  const f = await setup(t); const dom = new JSDOM('<!doctype html><body></body>', { url: origin, pretendToBeVisual: true });
  const keys = ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements'];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
  let destroy; const pending = new Set();
  const tracked = (operation) => (...args) => {
    const value = Promise.resolve().then(() => operation(...args)); pending.add(value);
    value.then(() => pending.delete(value), () => pending.delete(value)); return value;
  };
  const root = document.createElement('div'); document.body.append(root);
  f.dispose = async () => {
    destroy?.(); await Promise.allSettled([...pending]); root.remove(); dom.window.close();
    for (const key of keys) { if (previous.get(key)) Object.defineProperty(globalThis, key, previous.get(key)); else delete globalThis[key]; }
  };
  const before = structuredClone(good(await f.manualRead.readAccount(f.employee)).currentContract);
  const read = (path) => tracked(async () => (await request(f, `/api/gcsp/manual/${path}`)).json);
  const adapter = { readAccount: read('account'), readDraft: read('draft'), browseStock: read('stock'),
    saveDraft: tracked(async (body) => (await request(f, '/api/gcsp/manual/draft', { body })).json),
    startJourney: tracked(async ({ account, action, draft, commandId }) => (await request(f, '/api/gcsp/manual/draft', {
      body: { commandId, expectedContextVersion: account.value.contextVersion, expectedDraftVersion: draft.value?.draftVersion ?? 0,
        choices: { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId } },
    })).json) };
  const { mountManualJourney } = await import('../../blocks/gcsp/manual-setup/journey.js');
  let sequence = 0; destroy = mountManualJourney(root, { adapter,
    galleryAdapter: { ...adapter, readClaim: read('claim') }, commandId: () => `host:${++sequence}` });
  const waitFor = async (check) => { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise((done) => setImmediate(done)); } assert.ok(check(), 'Expected host DOM state.'); };
  const click = (label) => { const button = [...root.querySelectorAll('button')].find((entry) => entry.textContent === label); assert.ok(button); button.click(); };
  await waitFor(() => root.querySelector('h1')?.textContent === 'Your cars'); click('Choose a replacement');
  await waitFor(() => root.querySelector('h1')?.textContent === 'Your order choices');
  for (const [name, value] of Object.entries({ driverId: `driver:${f.employee.employeeId}`, contractOptionId: 'six-month-8000',
    requestedCollectionDate: '2026-11-20', collectionLocationId: 'demo-collection-centre', expectedReturnMileage: '6700' })) {
    const node = root.querySelector(`[name="${name}"]`); assert.ok(node); node.value = value;
    node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  }
  click('Back to account'); await waitFor(() => root.querySelector('h1')?.textContent === 'Your cars');
  assert.equal(root.querySelectorAll('main').length, 1);
  assert.deepEqual(good(await f.manualRead.readAccount(f.employee)).currentContract, before);
  click('Resume saved journey'); await waitFor(() => root.querySelector('h1')?.textContent === 'Your order choices');
  assert.equal(root.querySelector('[name="requestedCollectionDate"]').value, '2026-11-20');
  assert.equal(good(await f.manualRead.readDraft(f.employee)).choices.driverId, `driver:${f.employee.employeeId}`);
});
