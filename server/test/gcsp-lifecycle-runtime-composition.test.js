// Scoped actual memory runtime and loopback HTTP; no browser, TLS, native DB or live provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { inputDigest, result } from '../gcsp/repository/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';

const origin = 'https://lifecycle-composition.test';
// Diagnostics deliberately expose only status, never sessions or provider payloads.
const good = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
const cookie = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });

async function setup(t, { refuse } = {}) {
  const profile = createCompositionTestProfile();
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile,
    environmentId: 'lifecycle-composition', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'lifecycle-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const registrations = []; const register = runtime.clock.registerHandler.bind(runtime.clock);
  runtime.clock.registerHandler = (input) => { registrations.push(input.handlerId); return register(input); };
  let reconciliations = 0; const reconcile = runtime.clock.reconcileStartup.bind(runtime.clock);
  runtime.clock.reconcileStartup = (...args) => { reconciliations += 1; return reconcile(...args); };
  if (refuse) runtime[refuse.service][refuse.method] = async () => result('unavailable', { code: 'selected-registration-refusal' });
  const local = good(await runtime.createLocalSession()); const session = cookie(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: session, purpose: 'presenter-control' }));
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  t.after(async () => {
    try { await new Promise((done) => { server.close(done); server.closeAllConnections(); }); }
    finally { await runtime.close(); }
  });
  const startup = await server.gcspStartup;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { body, session: supplied = session, requestOrigin = origin } = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: requestOrigin, ...(supplied ? { Cookie: supplied } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
  return { ...runtime, runtime, profile, server, startup, registrations, session, employee: local.context,
    presenter, request, reconciliations: () => reconciliations };
}

async function tick(f, eventId, bySeconds = 0) {
  let now = good(await f.clock.now(f.presenter));
  if (bySeconds) {
    good(await f.clock.advance(f.presenter, { commandId: `advance:${eventId}`, expectedClockVersion: now.clockVersion, bySeconds }));
    now = good(await f.clock.now(f.presenter));
  }
  const input = { eventId, expectedClockVersion: now.clockVersion, inputDigest: inputDigest(eventId) };
  return { input, outcome: await f.clock.tick(f.presenter, input) };
}

async function select(f) {
  const account = good((await f.request('/api/gcsp/manual/account')).json);
  const action = account.actions.find((row) => row.enabled);
  const driver = account.choices.drivers.find((row) => row.kind === 'employee');
  const option = account.choices.contractOptions.find((row) => row.schemeIds.includes(f.employee.schemeId) && row.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((row) => row.contractOptionIds.includes(option.contractOptionId) && row.driverKinds.includes(driver.kind));
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
    requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
    brand: account.choices.brands[0], contact: account.account.contact,
    expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
  good((await f.request('/api/gcsp/manual/draft', { body: { commandId: 'lifecycle-draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices } })).json);
  const car = await f.profile.prepare(f.runtime, f.employee);
  const time = good(await f.clock.now(f.presenter));
  good((await tick(f, 'release-lifecycle-stock', (Date.parse('2026-11-05T12:00:00.000Z') - Date.parse(time.now)) / 1000)).outcome);
  const stock = good((await f.request('/api/gcsp/manual/stock')).json);
  const decision = stock.decisions.find((row) => row.orderUuid === car.orderUuid);
  assert.equal(decision.gateStatus, 'eligible');
  const claimed = good(await f.manualClaims.claim(f.employee, { ...decision.claimInput, commandId: 'lifecycle-claim' }));
  const reviewed = good(await f.manualClaims.beginReview(f.employee, { commandId: 'lifecycle-review', holdId: claimed.hold.holdId,
    expectedHoldVersion: claimed.hold.version, expectedDraftVersion: claimed.quote.draftVersion }));
  const terms = good(await f.manualOrder.readTerms(f.employee));
  const currentStock = good(await f.repository.read(f.employee, ref(f.employee, 'stock', { orderUuid: car.orderUuid })));
  const input = { commandId: 'lifecycle-submit', source: { type: 'cart', holdId: reviewed.hold.holdId,
    expectedHoldVersion: reviewed.hold.version, expectedDraftVersion: reviewed.quote.draftVersion },
  expectedQuoteId: reviewed.quote.quoteId, expectedStockVersion: currentStock.version, termsDigest: terms.termsDigest,
  declarations: Object.fromEntries(terms.declarations.filter((row) => row.appliesTo === 'all' || row.appliesTo === choices.mode).map((row) => [row.id, true])) };
  const submitted = good(await f.manualOrder.submit(f.employee, input));
  assert.equal(submitted.view.state, 'awaiting-approval'); assert.equal(submitted.order.status, 'confirmed');
  assert.deepEqual(good(await f.manualOrder.submit(f.employee, input)), submitted);
  const persisted = good(await f.repository.read(f.employee, ref(f.employee, 'pending_operations', { operationId: submitted.operationId })));
  assert.equal(persisted.payload.atomicConversion, true); // F66 converts through FUCQ-71's atomic callback.
  assert.equal(persisted.lastKnownState, 'acknowledged');
  assert.equal(good(await f.repository.read(f.employee, ref(f.employee, 'holds', { holdId: reviewed.hold.holdId }))).state, 'allocated');
  return { car, submitted, operation: persisted };
}

test('actual manual conversion and shared runtime progress approvals into document readiness through HTTP and replay', async (t) => {
  const f = await setup(t); good(f.startup);
  assert.equal(f.dependencies.gcspManualOrder, f.manualOrder);
  assert.equal(f.dependencies.gcspLifecycle, f.lifecycle); assert.equal(f.dependencies.gcspDocuments, f.documents);
  assert.equal(f.dependencies.gcspAppointments, f.appointments); assert.equal(f.dependencies.gcspReturnPlan, f.returnPlan);
  assert.equal(f.orderingAdapter.mode, 'synthetic');
  assert.equal(typeof f.orderingAdapter.status.requestDecision, 'function');
  assert.equal(typeof f.orderingAdapter.documentStatus.start, 'function');
  assert.deepEqual(f.registrations, ['stock-release', 'manual-claim-expiry', 'buddy-expiry', 'buddy-allocation', 'selection-order-reconciliation',
    'lifecycle-approvals', 'lifecycle-documents', 'lifecycle-appointments', 'lifecycle-return-appointments', 'renewal-risk-cases', 'captured-outbox']);
  assert.equal(f.reconciliations(), 1);
  good(await f.manualOrder.registerClockHandler()); good(await f.lifecycle.start()); good(await f.documents.start()); good(await f.appointments.start());
  good(await f.returnPlan.start());
  assert.equal(f.registrations.length, 11);
  assert.equal((await f.clock.registerHandler({ handlerId: 'too-late', stage: 'pending-reconciliation', handle: async () => ({ status: 'ok', value: {} }) })).status, 'invalid');
  const { car, operation } = await select(f); const query = `?orderUuid=${encodeURIComponent(car.orderUuid)}`;
  const initial = good((await f.request('/api/gcsp/orders/progress' + query)).json);
  assert.equal(initial.lifecycleRevision, 0); assert.equal(initial.renewalAuthority, 'validated');
  assert.equal(initial.entitlementSlotId, f.employee.entitlementSlotId);
  assert.ok(initial.renewalId); assert.equal(initial.source.operationId, operation.operationId);
  const internal = f.lifecycle.stagePort(); assert.equal(internal, f.lifecycle.stagePort()); assert.ok(Object.isFrozen(internal));
  const system = { environmentId: f.employee.environmentId, runId: f.employee.runId, principalId: 'clock-startup', roles: [] };
  good(await internal.read(system, { orderUuid: car.orderUuid })); good(await internal.listOrders(system));
  assert.notEqual((await f.lifecycle.read(system, { orderUuid: car.orderUuid })).status, 'ok');
  const read = { runId: f.employee.runId, policyVersion: f.employee.policyVersion, asOf: good(await f.clock.now(f.presenter)).now };
  const ticks = good(await f.policy.getAssumption('lifecycle.approval.ticks.v1', read)).value;
  const maxTicks = Object.values(ticks).reduce((sum, value) => sum + value, 0) + initial.stageList.length * 2;
  let completed;
  for (let index = 0; index < maxTicks; index += 1) {
    const next = await tick(f, `lifecycle-progress-${index}`); const value = good(next.outcome);
    assert.deepEqual(value.handlerOrder.filter((row) => row.stage === 'pending-reconciliation').map((row) => row.handlerId),
      ['lifecycle-appointments', 'lifecycle-approvals', 'lifecycle-documents', 'lifecycle-return-appointments', 'renewal-risk-cases', 'selection-order-reconciliation']);
    if (index === 0) assert.deepEqual(await f.clock.tick(f.presenter, next.input), next.outcome);
    completed = good((await f.request('/api/gcsp/orders/progress' + query)).json);
    if (completed.outcome === 'sent-to-ordering') break;
  }
  assert.equal(completed.outcome, 'sent-to-ordering'); assert.ok(completed.lifecycleRevision > 0);
  const items = good((await f.request('/api/gcsp/documents')).json).orders.find((row) => row.orderUuid === car.orderUuid);
  assert.ok(items); assert.equal(items.opening.stage, 'sent to ordering'); assert.equal(items.opening.state, 'approved');
  assert.equal(items.opening.lifecycleRevision, completed.lifecycleRevision);
  assert.equal(items.readiness.ready, false);
  for (const task of items.tasks) good((await f.request('/api/gcsp/documents/tasks/complete', { body: {
    commandId: `complete:${task.itemId}`, orderUuid: car.orderUuid, itemId: task.itemId, acknowledgement: 'synthetic',
  } })).json);
  const config = good(await f.policy.getAssumption('lifecycle.documents.v1', read)).value;
  const delay = Math.max(...config.items.map((row) => row.progressSeconds ?? 0));
  good((await tick(f, 'complete-provider-readiness', delay)).outcome);
  const ready = good((await f.request('/api/gcsp/documents/readiness' + query)).json);
  assert.equal(ready.opened, true); assert.equal(ready.ready, true); assert.equal(ready.documentsComplete, true); assert.equal(ready.vehicleReady, true);
  // Appointment over HTTP: requested is never booked; a presenter tick past the policy delay schedules it.
  const aptQuery = `/api/gcsp/appointments${query}`;
  const open = good((await f.request(aptQuery)).json);
  assert.equal(open.eligibility.eligible, true); assert.equal(open.state, 'not-requested'); assert.ok(open.offeredSlots.length > 0);
  const asked = good((await f.request('/api/gcsp/appointments/request', { body: { orderUuid: car.orderUuid, slotId: open.offeredSlots[0].slotId } })).json);
  assert.deepEqual([asked.state, asked.booked], ['requested', false]);
  assert.deepEqual(good((await f.request(aptQuery)).json), asked);
  const confirmation = good(await f.policy.getAssumption('lifecycle.appointments.confirmation.v1', read)).value;
  good((await tick(f, 'confirm-appointment', confirmation.confirmDelaySeconds)).outcome);
  const booked = good((await f.request(aptQuery)).json);
  assert.deepEqual([booked.state, booked.booked, booked.slot], ['scheduled', true, open.offeredSlots[0]]);
  // Return plan over HTTP on the real replacement selection: its own appointment, and the current car untouched.
  const planQuery = `/api/gcsp/return-plan${query}`;
  const plan = good((await f.request(planQuery)).json);
  assert.deepEqual([plan.applicable, plan.state, plan.scheduled, plan.oldContractId, plan.vehicleSlotId, plan.returnMileage.value],
    [true, 'not-planned', false, operation.payload.selection.oldContract.contractId, f.employee.entitlementSlotId, operation.payload.selection.draft.choices.expectedReturnMileage]);
  const returning = good((await f.request('/api/gcsp/return-plan/request', { body: { orderUuid: car.orderUuid, choice: 'separate', slotId: plan.offeredSlots.separate[0].slotId } })).json);
  assert.deepEqual([returning.state, returning.scheduled, returning.handover.state], ['return-requested', false, 'scheduled']);
  good((await tick(f, 'confirm-return', confirmation.confirmDelaySeconds)).outcome);
  const returned = good((await f.request(planQuery)).json);
  assert.deepEqual([returned.state, returned.scheduled, returned.slot], ['return-scheduled', true, plan.offeredSlots.separate[0]]);
  assert.notEqual(returned.providerReference, booked.history.at(-1).providerReference);
  assert.deepEqual(good(await f.repository.read(f.employee, ref(f.employee, 'entitlement_slots', { entitlementSlotId: f.employee.entitlementSlotId }))).contractId,
    operation.payload.selection.vehicleSlot.contractId, 'the slot still points at the old contract');
  const alex = good(await f.identity.switchPrincipal(f.presenter, 'demo-alex', 'lifecycle-alex'));
  const greg = good(await f.identity.switchPrincipal(f.presenter, 'demo-greg', 'lifecycle-greg'));
  const presenter = good(await f.identity.createPresenterSession('lifecycle-presenter-http'));
  for (const path of ['/api/gcsp/orders/progress', '/api/gcsp/documents/readiness']) {
    assert.equal((await f.request(path + query, { session: cookie(alex.setCookie) })).status, 403);
    assert.equal((await f.request(path + query, { session: cookie(greg.setCookie) })).status, 200);
    assert.equal((await f.request(path + query, { session: cookie(presenter.setCookie) })).status, 200);
    assert.equal((await f.request(path + query + '&employeeId=forged&runId=foreign')).status, 200);
    assert.equal((await f.request(path + query, { session: '' })).status, 401);
    assert.equal((await f.request(path + query, { requestOrigin: 'https://foreign.invalid' })).status, 403);
  }
  assert.equal((await f.request('/api/gcsp/documents', { session: cookie(greg.setCookie) })).status, 403);
  assert.equal((await f.manualOrder.submit(f.employee, { source: { type: 'buddy-offer' } })).status, 'invalid');
  const rows = good(await f.repository.query(f.employee, 'pending_operations', { operationType: 'selection-order' }));
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.selection.source.type, 'cart');
});

test('actual lifecycle startup propagates ordering approval and document registration failures before seal and HTTP dispatch', async (t) => {
  for (const refuse of [{ service: 'manualOrder', method: 'registerClockHandler' },
    { service: 'lifecycle', method: 'start' }, { service: 'documents', method: 'start' }, { service: 'appointments', method: 'start' }, { service: 'returnPlan', method: 'start' }]) {
    const f = await setup(t, { refuse });
    assert.equal(f.startup.status, 'unavailable'); assert.equal(f.startup.code, 'selected-registration-refusal');
    assert.equal(f.reconciliations(), 0);
    for (const path of ['/api/gcsp/orders/progress?orderUuid=missing', '/api/gcsp/documents', '/api/gcsp/appointments?orderUuid=missing', '/api/gcsp/return-plan?orderUuid=missing', '/api/gcsp/manual/account']) {
      const response = await f.request(path); assert.equal(response.status, 503); assert.equal(response.json.status, 'unavailable');
    }
    assert.equal((await f.request('/health')).status, 200);
    assert.equal(f.profile.calls.length, 0);
  }
});

test('composed lifecycle routes keep missing and corrupted selection sources explicit and reject an actual stale run', async (t) => {
  const f = await setup(t); good(f.startup);
  assert.equal((await f.request('/api/gcsp/orders/progress?orderUuid=missing')).status, 404);
  assert.equal(good((await f.request('/api/gcsp/documents/readiness?orderUuid=missing')).json).ready, false);
  assert.equal((await f.request('/api/gcsp/orders/progress')).status, 400);
  const { car, operation } = await select(f);
  // Corrupt an actual produced operation through the repository, never fabricate a successful producer.
  good(await f.repository.transaction(f.employee, { commandId: 'corrupt-selection-proof', inputDigest: inputDigest('corrupt-selection-proof') },
    (tx) => tx.compareAndSwap(ref(f.employee, 'pending_operations', { operationId: operation.operationId }), operation.version,
      { outcome: { status: 'confirmed', runId: 'foreign-run' } })));
  const refused = await f.request(`/api/gcsp/orders/progress?orderUuid=${encodeURIComponent(car.orderUuid)}`);
  assert.equal(refused.status, 503); assert.equal(refused.json.code, 'selection-source-invalid');
  const diagnostics = good((await f.request('/api/gcsp/orders/progress/all')).json);
  assert.equal(diagnostics.orders.length, 0); assert.equal(diagnostics.failedCount, 1);
  const scenario = good(await f.scenarios.readCatalogue(f.presenter)).scenarios.find((row) => row.kind === 'mechanics');
  const state = good(await f.scenarios.readState(f.presenter));
  good((await f.request('/api/gcsp/presenter/scenarios/reset', { body: { commandId: 'lifecycle-reset',
    expectedRunId: state.runId, expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId,
    scenarioVersion: scenario.scenarioVersion, fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion } })).json);
  assert.equal((await f.request('/api/gcsp/orders/progress/all')).status, 409);
  assert.equal((await f.request('/api/gcsp/documents')).status, 409);
});
