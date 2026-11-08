// Selected in-process memory composition proof. No listener, browser or remote adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, OCCUPYING_STATES } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider } from '../gcsp/policy/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { stock, essential, preference, fact } from './helpers/employee-recommendation.js';

const origin = 'https://demo.invalid';
// Registration order across the composed runtime; other stories add handlers here.
const HANDLERS = ['manual-claim-expiry', 'buddy-expiry', 'buddy-allocation', 'selection-order-reconciliation', 'lifecycle-approvals',
  'lifecycle-documents', 'lifecycle-appointments', 'lifecycle-return-appointments', 'renewal-risk-cases', 'captured-outbox'];
// A tick runs handlers in stage order, which differs from registration order.
const TICK_ORDER = ['manual-claim-expiry', 'buddy-expiry', 'lifecycle-appointments', 'lifecycle-approvals', 'lifecycle-documents',
  'lifecycle-return-appointments', 'renewal-risk-cases', 'selection-order-reconciliation', 'buddy-allocation', 'captured-outbox'];
const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const ref = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const good = (result) => { assert.equal(result.status, 'ok', JSON.stringify(result)); return result.value; };
const cookie = (value) => [value].flat().map((v) => v.split(';')[0]).join('; ');
async function request(server, path, { body, session, headers = {} } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST',
    headers: { host: 'demo.invalid', origin, ...(session ? { cookie: session } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } });
  const response = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    writeHead(status, values) { this.status = status; for (const [k, v] of Object.entries(values)) this.setHeader(k, v); },
    end(body) { this.body = body; } };
  await server.listeners('request')[0](req, response);
  return { ...response, json: response.body ? JSON.parse(response.body) : null };
}
async function setup(t, { start = true, sessionTag = '', store = createMemoryStore(), policy, repository = createMemoryRepository({ store }) } = {}) {
  const opened = good(await createGcspRuntime({ mode: 'memory', repository, policy, environmentId: 'buddy-runtime-test',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => opened.close());
  const registrations = []; const register = opened.clock.registerHandler.bind(opened.clock);
  opened.clock.registerHandler = async (input) => { registrations.push(input.handlerId); return register(input); };
  const f = { ...opened, store, registrations, manual: opened.manualClaims, contexts: {}, sessions: {} };
  if (start) { f.server = buildServer({ ...f.dependencies, gcspAllowedOrigins: [origin] }); good(await f.server.gcspStartup); }
  const presenter = good(await f.identity.createPresenterSession(`presenter${sessionTag}`));
  f.presenter = presenter.context; f.presenterCookie = cookie(presenter.setCookie);
  for (const name of ['paula', 'alex', 'greg']) {
    const acting = good(await f.identity.switchPrincipal(f.presenter, `demo-${name}`, `${name}${sessionTag}`));
    f.contexts[name] = acting.context; f.sessions[name] = cookie(acting.setCookie);
    if (name !== 'greg') good(await seedManualDemoContext({ repository: f.repository, identity: f.identity, clock: f.clock, context: acting.context }));
  }
  const time = good(await f.clock.now(f.presenter));
  if (time.now === '2026-11-05T09:00:00.000Z') good(await f.clock.advance(f.presenter, { commandId: 'noon', expectedClockVersion: time.clockVersion, bySeconds: 10800 }));
  return f;
}
async function prepareBuddy(f) {
  for (const context of [f.contexts.paula, f.contexts.alex]) {
    good(await f.brief.saveDraft(context, { commandId: 'brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
    good(await f.brief.confirm(context, { commandId: 'brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: true } }));
  }
  f.car = stock(11, { eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'), boot: fact(380, 'L'),
    sizeClass: fact(2, 'ordinal-1-5'), insuranceGroup: fact(25, 'insurance-group') }, 'RjcwOlMx');
  good(await f.repository.transaction(f.contexts.paula, command('exact-synthetic-stock'), (tx) => tx.insert('stock', {
    runId: f.contexts.paula.runId, orderUuid: f.car.orderUuid, orderNumber: '9123456', configurationId: f.car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: f.car.snapshot,
    release: { eventId: 'synthetic-proof-input', availability: f.car.availability },
    visibility: { companyIds: [f.contexts.paula.companyId], schemeIds: [f.contexts.paula.schemeId], employeeIds: null },
  })));
}
async function allocate(f) {
  await prepareBuddy(f);
  return good(await f.buddy.allocate(f.contexts.paula, await buddyInput(f, f.contexts.paula, 'buddy-first')));
}
function offerInput(f, offer) {
  const job = f.store.state.tables.notification_outbox.find((row) => row.offerId === offer.offerId);
  assert.equal(job.state, 'sent'); assert.equal(job.transport, 'captured'); assert.ok(job.outcome.message);
  const link = new URL(job.payload.offerLink, origin);
  return { runId: offer.runId, offerId: offer.offerId, token: new URLSearchParams(link.hash.slice(1)).get('token') };
}
async function advance(f, to, id = 'advance') {
  const state = good(await f.clock.now(f.presenter));
  return good(await f.clock.advance(f.presenter, { commandId: id, expectedClockVersion: state.clockVersion, to }));
}
async function tick(f, id = 'expire') {
  const time = good(await f.clock.now(f.presenter));
  return good(await f.clock.tick(f.presenter, { eventId: id, inputDigest: inputDigest(id), expectedClockVersion: time.clockVersion }));
}
async function adoptPresenter(f) {
  const time = good(await f.clock.now(f.presenter));
  const run = good(await f.repository.currentRun('buddy-runtime-test'));
  // The presenter-controls definitions are in the base seed now; adopt only when they are not yet active.
  const active = await f.policy.getAssumption('clock.presenter.stepSeconds', { runId: run.runId, asOf: time.now, policyVersion: run.policyVersion });
  if (active.status !== 'ok') good(await f.policy.adoptReviewedAssumptions(f.contexts.greg, { commandId: 'reviewed-presenter', expectedActiveVersion: run.policyVersion,
    policyVersion: 'runtime-reviewed-v2', effectiveFrom: time.now, definitionSetId: 'presenter-controls-v1' }));
  f.presenter = good(await f.identity.resolveSession({ authorized: true, cookie: f.presenterCookie, purpose: 'presenter-control' }));
  for (const name of ['paula', 'alex', 'greg']) f.contexts[name] = good(await f.identity.resolveSession({ authorized: true, cookie: f.sessions[name] }));
}

async function prepareManual(f, context, version = 0) {
  const account = await f.manual.readAccount(context); assert.equal(account.status, 'ok'); assert.equal(account.value.state, 'ready');
  const a = account.value; const action = a.actions.find((row) => row.enabled); assert.ok(action);
  const driver = a.choices.drivers.find((row) => row.kind === 'employee'); assert.ok(driver);
  const option = a.choices.contractOptions.find((row) => row.schemeIds.includes(context.schemeId) && row.driverKinds.includes(driver.kind));
  assert.ok(option);
  const location = a.choices.collectionLocations.find((row) => row.contractOptionIds.includes(option.contractOptionId)
    && row.driverKinds.includes(driver.kind)); assert.ok(location);
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
    requestedCollectionDate: a.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
    brand: a.choices.brands[0], contact: a.account.contact, expectedReturnMileage: a.currentContract.currentOdometer.value,
    specialRequirements: '' };
  const saved = await f.manual.saveDraft(context, { commandId: `manual-draft:${version + 1}`, expectedDraftVersion: version,
    expectedContextVersion: a.contextVersion, choices });
  assert.equal(saved.status, 'ok'); assert.equal(saved.value.draftVersion, version + 1);
  const browsed = await f.manual.browseStock(context); assert.equal(browsed.status, 'ok');
  return browsed.value.decisions.find((row) => row.orderUuid === f.car.orderUuid);
}

async function buddyInput(f, context, id) {
  const employee = await f.repository.read(context, ref(context, 'employees', { employeeId: context.employeeId }));
  const slot = await f.repository.read(context, ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
  const stock = await f.repository.read(context, ref(context, 'stock', { orderUuid: f.car.orderUuid }));
  assert.equal(employee.status, 'ok'); assert.equal(slot.status, 'ok'); assert.equal(stock.status, 'ok');
  return { commandId: id, orderUuid: f.car.orderUuid, expectedBriefVersion: 1, expectedStockVersion: stock.value.version,
    expectedEmployeeVersion: employee.value.version, expectedSlotVersion: slot.value.version };
}

test('normal runtime shares services, registers before startup, and serves real presenter scenario controls', async (t) => {
  const f = await setup(t);
  for (const [key, value] of Object.entries({ gcspBuddy: f.buddy, gcspManualClaims: f.manualClaims, gcspOfferAccess: f.offerAccess,
    gcspNotify: f.notify, gcspRepository: f.repository, gcspPolicy: f.policy, gcspScenarios: f.scenarios })) assert.equal(f.dependencies[key], value);
  assert.deepEqual(f.registrations, HANDLERS);
  good(await f.buddy.start()); good(await f.manualClaims.registerClockHandler()); good(await f.notify.start()); good(await f.server.gcspStartup);
  assert.equal(f.registrations.length, HANDLERS.length);
  const catalogue = await request(f.server, '/api/gcsp/presenter/scenarios', { session: f.presenterCookie });
  assert.equal(catalogue.status, 200); assert.ok(catalogue.json.value.scenarios.length);
  assert.ok(catalogue.json.value.scenarios.filter((s) => s.kind === 'journey' && !['main-successful-journey', 'no-suitable-match', 'decline-then-change', 'data-unavailable'].includes(s.scenarioId)).every((s) => s.availability.missingCapabilities.length));
  await adoptPresenter(f);
  const controls = await request(f.server, '/api/gcsp/presenter/controls', { session: f.presenterCookie }); assert.equal(controls.status, 200);
  const state = good(await f.clock.now(f.presenter));
  const stepped = await request(f.server, '/api/gcsp/presenter/controls/tick', { session: f.presenterCookie,
    body: { commandId: 'normal-step', expectedClockVersion: state.clockVersion, mode: 'step' } });
  assert.equal(stepped.status, 200); assert.equal(stepped.json.value.advance.now, '2026-11-05T12:01:00.000Z');
  assert.deepEqual(stepped.json.value.tick.handlerOrder.map((row) => row.handlerId), TICK_ORDER);
});

test('actual buddy capture and token access preserve timing, guards and exact-deadline expiry', async (t) => {
  const f = await setup(t); const allocated = await allocate(f); const input = offerInput(f, allocated.offer);
  const exchange = await request(f.server, '/api/gcsp/offers/access', { body: input });
  assert.equal(exchange.status, 200); assert.deepEqual(exchange.json.value.availableActions, ['accept', 'decline']);
  assert.match(exchange.headers['set-cookie'], /HttpOnly/); assert.match(exchange.headers['set-cookie'], /Secure/);
  const session = cookie(exchange.headers['set-cookie']);
  const path = `/api/gcsp/offers/${encodeURIComponent(input.offerId)}?runId=${encodeURIComponent(input.runId)}`;
  const account = await request(f.server, path, { session: f.sessions.paula }); assert.equal(account.status, 200);
  assert.equal((await request(f.server, path, { session: f.sessions.alex })).status, 404);
  assert.equal((await request(f.server, path, { session, headers: { origin: 'https://foreign.invalid' } })).status, 403);
  await advance(f, allocated.quote.validUntil, 'quote-deadline');
  assert.ok(Date.parse(allocated.quote.validUntil) < Date.parse(allocated.hold.expiresAt));
  const late = await request(f.server, path, { session }); assert.equal(late.status, 200); assert.deepEqual(late.json.value.availableActions, ['decline']);
  await advance(f, allocated.hold.expiresAt, 'hold-deadline');
  const expired = await request(f.server, path, { session }); assert.equal(expired.json.value.state, 'expired'); assert.deepEqual(expired.json.value.availableActions, []);
  await tick(f);
  assert.equal(good(await f.repository.read(f.contexts.paula, ref(f.contexts.paula, 'holds', { holdId: allocated.hold.holdId }))).state, 'expired');
  // The returned car re-enters the pool; the composed FUCQ-96 allocator may re-offer it in the same tick.
  const reoffered = f.store.state.tables.holds.filter((row) => row.orderUuid === f.car.orderUuid && row.state === 'active');
  assert.ok(reoffered.every((row) => row.holdId !== allocated.hold.holdId && row.type === 'buddy-offer'));
  assert.equal(good(await f.repository.read(f.contexts.paula, ref(f.contexts.paula, 'stock', { orderUuid: f.car.orderUuid }))).state,
    reoffered.length ? 'held' : 'released');
  assert.equal(f.store.state.tables.decisions.length, 0);
});

test('fresh composed backend reconciles overdue memory authority before dispatch', async (t) => {
  const f = await setup(t); const allocated = await allocate(f); const input = offerInput(f, allocated.offer);
  await advance(f, allocated.hold.expiresAt); await f.close();
  const fresh = await setup(t, { store: f.store, sessionTag: ':restarted' });
  const read = await request(fresh.server, '/api/gcsp/offers/access', { body: input }); assert.equal(read.status, 200);
  assert.equal(read.json.value.state, 'expired'); assert.deepEqual(read.json.value.availableActions, []);
  assert.equal(f.store.state.tables.holds.find((row) => row.holdId === allocated.hold.holdId).state, 'expired');
  assert.deepEqual(fresh.registrations, HANDLERS);
  assert.equal(f.store.state.tables.offers.length, 1);
});

for (const first of ['manual', 'buddy']) test(`normal composed ${first} claim excludes the other claimant`, async (t) => {
  const f = await setup(t); await prepareBuddy(f); const context = f.contexts.paula;
  const decision = await prepareManual(f, context); assert.equal(decision.gateStatus, 'eligible'); assert.ok(decision.claimInput);
  const input = await buddyInput(f, context, 'buddy');
  if (first === 'manual') {
    good(await f.manual.claim(context, { commandId: 'manual', ...decision.claimInput }));
    assert.equal((await f.buddy.allocate(context, await buddyInput(f, context, 'buddy-after-manual'))).status, 'conflict');
    assert.equal(f.store.state.tables.offers.length, 0);
  } else {
    good(await f.buddy.allocate(context, input));
    assert.ok(['conflict', 'stale-version'].includes((await f.manual.claim(context, { commandId: 'manual', ...decision.claimInput })).status));
    assert.equal(f.store.state.tables.offers.length, 1);
  }
  const occupied = f.store.state.tables.holds.filter((row) => OCCUPYING_STATES.includes(row.state)); assert.equal(occupied.length, 1);
  assert.equal(occupied[0].type, first === 'manual' ? 'cart' : 'buddy-offer');
});

test('reviewed publication activates the shared provider while preserving pinned buddy quote and access', async (t) => {
  const f = await setup(t); const allocated = await allocate(f); const before = structuredClone(allocated.quote);
  const input = offerInput(f, allocated.offer); await adoptPresenter(f);
  assert.equal(good(await f.repository.currentRun('buddy-runtime-test')).versions.policy, before.policyVersion);
  const time = good(await f.clock.now(f.presenter));
  assert.equal((await f.policy.getAssumption('clock.presenter.stepSeconds', { runId: f.presenter.runId, asOf: time.now,
    policyVersion: f.presenter.policyVersion })).value.value, 60);
  assert.deepEqual(good(await f.repository.read(f.contexts.paula, ref(f.contexts.paula, 'quotes', { quoteId: before.quoteId }))), before);
  const read = await request(f.server, '/api/gcsp/offers/access', { body: input }); assert.equal(read.status, 200);
  assert.equal(read.json.value.quote.policyVersion, before.policyVersion); assert.deepEqual(read.json.value.availableActions, ['accept', 'decline']);
  const demand = await request(f.server, '/api/gcsp/greg/demand', { session: f.sessions.greg }); assert.equal(demand.status, 200);
});

test('normal named mechanics reset retains handlers and invalidates old employee and offer authority', async (t) => {
  const f = await setup(t); const allocated = await allocate(f); const input = offerInput(f, allocated.offer);
  const exchanged = good(await f.offerAccess.exchange(input)); const oldEmployee = f.contexts.paula;
  const catalogue = good(await f.scenarios.readCatalogue(f.presenter)); const scenario = catalogue.scenarios.find((s) => s.kind === 'mechanics');
  const state = good(await f.scenarios.readState(f.presenter));
  const reset = await request(f.server, '/api/gcsp/presenter/scenarios/reset', { session: f.presenterCookie, body: { commandId: 'normal-reset',
    expectedRunId: state.runId, expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion, fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion } });
  assert.equal(reset.status, 200); assert.notEqual(reset.json.value.runId, state.runId);
  assert.equal((await f.identity.requireRole(oldEmployee, 'employee')).status, 'stale-run');
  assert.equal((await f.offerAccess.read(exchanged.context)).status, 'stale-run');
  assert.equal((await f.offerAccess.exchange(input)).status, 'stale-run');
  const presenter = good(await f.identity.createPresenterSession('fresh-presenter')); f.presenter = presenter.context;
  const after = await tick(f, 'new-run-tick'); assert.deepEqual(after.handlerOrder.map((row) => row.handlerId), TICK_ORDER);
  assert.equal(f.registrations.length, HANDLERS.length);
  const fresh = good(await f.createLocalSession()); good(await f.manual.readAccount(fresh.context));
});

test('actual late buddy registration blocks ordinary and offer dispatch with guarded HTTP503', async (t) => {
  const f = await setup(t, { start: false }); good(await f.manualClaims.registerClockHandler()); good(await f.clock.reconcileStartup());
  let ordinary = 0; let access = 0;
  f.offerAccess.exchange = async () => { access++; throw Error('must remain blocked'); };
  const server = buildServer({ ...f.dependencies, gcspAllowedOrigins: [origin], gcspRoutes: [{ method: 'GET', path: '/api/gcsp/probe',
    handle: async () => { ordinary++; throw Error('must remain blocked'); } }] });
  assert.equal((await server.gcspStartup).status, 'invalid'); assert.ok(f.registrations.includes('buddy-expiry'));
  for (const [path, options] of [['/api/gcsp/probe', { session: f.sessions.paula }], ['/api/gcsp/offers/access', { body: {} }]]) {
    const response = await request(server, path, options); assert.equal(response.status, 503); assert.equal(response.json.status, 'unavailable');
    assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(response.headers['access-control-allow-origin'], origin);
  }
  assert.equal((await request(server, '/api/gcsp/probe', { headers: { origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal((await request(server, '/health')).status, 200); assert.equal(ordinary, 0); assert.equal(access, 0);
});

test('settled local commits await observers and close unsubscribes before owned storage exactly once', async (t) => {
  const store = createMemoryStore(); const base = createMemoryRepository({ store });
  const events = []; const afterCommit = base.afterCommit;
  const repository = { ...base,
    afterCommit(observer) { events.push('subscribe'); const off = afterCommit(observer); return () => { events.push('unsubscribe'); off(); }; },
    async close() { events.push('repository-close'); return base.close(); },
  };
  const originalClose = MemoryPolicyProvider.prototype.close;
  MemoryPolicyProvider.prototype.close = async function () { events.push('policy-close'); return originalClose.call(this); };
  t.after(() => { MemoryPolicyProvider.prototype.close = originalClose; });
  const f = await setup(t, { store, repository }); await prepareBuddy(f);
  let entered; let release;
  const started = new Promise((r) => { entered = r; }); const gate = new Promise((r) => { release = r; });
  const off = afterCommit(async ({ commandId }) => { if (commandId.endsWith(':buddy-held-observer')) { entered(); await gate; events.push('observer-settled'); } });
  let settled = false;
  const allocation = f.buddy.allocate(f.contexts.paula, await buddyInput(f, f.contexts.paula, 'buddy-held-observer')).then((outcome) => { settled = true; return outcome; });
  await started; assert.equal(settled, false); release(); good(await allocation); off();
  assert.equal(settled, true); await Promise.all([f.close(), f.close()]);
  assert.deepEqual(events.slice(-4), ['observer-settled', 'unsubscribe', 'repository-close', 'policy-close']);
  assert.equal(events.filter((s) => s === 'repository-close').length, 1); assert.equal(events.filter((s) => s === 'policy-close').length, 1);
  let externalCloses = 0; const externalProvider = new MemoryPolicyProvider();
  externalProvider.close = async () => { externalCloses++; };
  const external = await setup(t, { policy: new PolicyService({ provider: externalProvider }) }); await external.close();
  assert.equal(externalCloses, 0); await externalProvider.close(); assert.equal(externalCloses, 1);
});
