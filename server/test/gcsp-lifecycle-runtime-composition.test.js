// Scoped actual memory runtime and loopback HTTP; no browser, TLS, native DB or live provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inputDigest } from '../gcsp/repository/index.js';
import { good, cookie, ref, setupManualRuntime as setup, tickRuntime as tick, selectManualOrder as select } from './helpers/gcsp-manual-order.js';

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
