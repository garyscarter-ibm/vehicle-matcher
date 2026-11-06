import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { RenewalCaseService } from '../gcsp/cases/index.js';
import { createLifecycleApprovalService, HANDLER_ID, EXCEPTION_CONSUMER } from '../gcsp/lifecycle/approvals/index.js';
import { createLifecycleApprovalRoutes } from '../gcsp/lifecycle/approvals/http.js';
import { createSyntheticOrderingStatus, createLiveOrderingStatusStub } from '../gcsp/adapters/synthetic-ordering-status.js';
import { acknowledgedSelection, pendingSelection, createRealProducer } from './helpers/gcsp-lifecycle-approval.js';

const AT = '2026-11-05T00:00:00.000Z';
// Reads the canonical seed only; alternative values are explicit test inputs over it.
async function policyWith(changes = {}) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries(changes)) seed.assumptions.find((a) => a.key === key).value = value;
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}

async function setup(t, { changes, status = 'synthetic', stages, cases = false, producer = false, extraHandler } = {}) {
  const policy = await policyWith(changes);
  const store = createMemoryStore(); const repository = createMemoryRepository({ store }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'lifecycle-test', environmentKind: 'synthetic',
    policyAsOf: AT, commandId: 'bootstrap', sessionNow: () => AT });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const as = async (id) => (await identity.switchPrincipal(presenter.value.context, id, id)).value.context;
  const [paula, alex, greg] = [await as('demo-paula'), await as('demo-alex'), await as('demo-greg')];
  const adapter = status === 'live' ? createLiveOrderingStatusStub() : typeof status === 'object' ? status : createSyntheticOrderingStatus({ repository });
  const service = createLifecycleApprovalService({ repository, policy, clock, identity, status: adapter });
  assert.equal((await service.start()).status, 'ok');
  const real = producer ? await createRealProducer({ repository, policy, clock, identity }) : null;
  if (extraHandler) assert.equal((await clock.registerHandler(extraHandler(service))).status, 'ok');
  const caseService = cases ? new RenewalCaseService({ repository, policy, clock, identity }) : null;
  if (caseService) assert.equal((await caseService.start()).status, 'ok');
  let ticks = 0;
  const tick = async () => {
    const eventId = `tick-${++ticks}`; const state = await clock.readState(presenter.value.context);
    const advanced = await clock.advance(presenter.value.context, { commandId: `advance-${ticks}`, expectedClockVersion: state.value.clockVersion, bySeconds: 3600 });
    assert.equal(advanced.status, 'ok', JSON.stringify(advanced));
    const outcome = await clock.tick(presenter.value.context, { eventId, expectedClockVersion: advanced.value.clockVersion, inputDigest: inputDigest(eventId) });
    return { eventId, clockVersion: advanced.value.clockVersion, outcome };
  };
  const seed = (context, options) => acknowledgedSelection(repository, context, { stages, ...options });
  t.after(() => repository.close());
  return { repository, store, policy, clock, identity, presenter, paula, alex, greg, service, caseService, real, tick, seed };
}
const states = (view) => view.stages.map((s) => `${s.stage}:${s.state}`);
const until = async (f, orderUuid, done, limit = 12) => {
  for (let i = 0; i < limit; i += 1) {
    const view = await f.service.read(f.greg, { orderUuid }); if (done(view.value)) return view.value; await f.tick();
  }
  assert.fail('lifecycle did not reach the expected state');
};

test('stage order follows the canonical list with HR approval on, and drops it everywhere when the list omits it', async (t) => {
  const on = await setup(t); const order = await on.seed(on.paula);
  const view = await on.service.read(on.paula, { orderUuid: order.orderUuid });
  assert.equal(view.status, 'ok', JSON.stringify(view));
  assert.deepEqual(view.value.stageList, ['selection received', 'HR approval', 'sales-manager approval', 'sent to ordering']);
  assert.deepEqual(states(view.value), ['selection received:approved', 'HR approval:not-started', 'sales-manager approval:not-started', 'sent to ordering:not-started']);
  assert.equal(view.value.lifecycleRevision, 0); assert.equal(view.value.renewalAuthority, 'missing'); assert.equal(view.value.renewalId, null);
  const offStages = ['sales-manager approval', 'sent to ordering'];
  const off = await setup(t, { changes: { 'ordering.approvalStages.v1': offStages }, stages: offStages });
  const second = await off.seed(off.paula);
  const read = await off.service.read(off.greg, { orderUuid: second.orderUuid });
  assert.deepEqual(read.value.stageList, ['selection received', ...offStages]);
  const listed = await off.service.listOrders(off.presenter.value.context);
  assert.deepEqual(listed.value.orders[0].stageList, read.value.stageList);
  const final = await until(off, second.orderUuid, (v) => v.outcome !== 'in-progress');
  assert.equal(final.outcome, 'sent-to-ordering'); assert.ok(!final.stages.some((s) => s.stage === 'HR approval'));
});

test('ticks advance after the keyed delay, each stage keeps its provider reference and replaying a tick is a no-op', async (t) => {
  const f = await setup(t); const order = await f.seed(f.paula);
  const first = await f.tick();
  assert.equal(first.outcome.status, 'ok', JSON.stringify(first.outcome));
  let view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  assert.equal(view.currentStage, 'HR approval'); assert.equal(view.owner, 'HR'); assert.equal(view.nextStep, 'HR decision');
  assert.equal(view.stages[1].state, 'pending'); assert.equal(view.lifecycleRevision, 1);
  const snapshot = structuredClone(f.store.state);
  const replay = await f.clock.tick(f.presenter.value.context, { eventId: first.eventId, expectedClockVersion: first.clockVersion, inputDigest: inputDigest(first.eventId) });
  assert.deepEqual(replay, first.outcome); assert.deepEqual(f.store.state, snapshot);
  await f.tick(); view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  assert.equal(view.stages[1].state, 'pending', 'HR waits its keyed two ticks');
  await f.tick(); view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  assert.equal(view.stages[1].state, 'approved'); assert.match(view.stages[1].providerReference, /^synthetic-ordering-status:v1:/);
  assert.equal(view.currentStage, 'sales-manager approval'); assert.equal(view.owner, 'sales manager');
  const final = await until(f, order.orderUuid, (v) => v.outcome !== 'in-progress');
  assert.equal(final.outcome, 'sent-to-ordering'); assert.equal(final.owner, 'ordering');
  assert.ok(final.stages.every((s) => s.state === 'approved' && s.providerReference && s.at));
  assert.equal(new Set(final.stages.map((s) => s.providerReference)).size, final.stages.length);
  const revisions = final.lifecycleRevision; await f.tick();
  assert.equal((await f.service.read(f.paula, { orderUuid: order.orderUuid })).value.lifecycleRevision, revisions);
});

test('the keyed decline scenario declines a named stage and records a renewal-case lifecycle exception', async (t) => {
  const f = await setup(t, { changes: { 'lifecycle.approval.declineScenario.v1': { enabled: true, stage: 'sales-manager approval', eventType: 'approval-declined',
    reasonCode: 'sales-manager-declined', reason: 'The sales manager declined this order. The scheme team will contact you.' } }, cases: true });
  const order = await f.seed(f.paula, { renewalId: 'renewal:employee-paula' });
  const final = await until(f, order.orderUuid, (v) => v.outcome !== 'in-progress');
  assert.equal(final.outcome, 'declined'); assert.equal(final.owner, 'scheme team');
  assert.deepEqual(states(final), ['selection received:approved', 'HR approval:approved', 'sales-manager approval:declined', 'sent to ordering:not-started']);
  const events = await f.repository.query(f.greg, 'event_receipts', { consumerId: EXCEPTION_CONSUMER });
  assert.equal(events.value.length, 1);
  const value = events.value[0].outcome.value;
  assert.equal(events.value[0].eventType, 'approval-declined');
  assert.deepEqual([value.employeeId, value.renewalId, value.orderUuid, value.reasonCode], ['employee-paula', 'renewal:employee-paula', order.orderUuid, 'sales-manager-declined']);
  assert.equal(value.occurredAt, final.stages[2].at);
  // The actual FUCQ-112 consumer, keyed by renewalCase.lifecycle.eventTypes, opens one case from this exception.
  const opened = await f.caseService.list(f.greg);
  assert.equal(opened.status, 'ok', JSON.stringify(opened));
  const caseRow = opened.value.cases.find((c) => c.trigger?.type === 'lifecycle-exception');
  assert.ok(caseRow, JSON.stringify(opened.value.cases.map((c) => c.trigger)));
  assert.deepEqual([caseRow.employeeId, caseRow.trigger.eventType, caseRow.trigger.orderUuid], ['employee-paula', 'approval-declined', order.orderUuid]);
});

test('the live stub reports every write unsupported and leaves the stage where it was', async (t) => {
  const f = await setup(t, { status: 'live' }); const order = await f.seed(f.paula);
  await f.tick(); await f.tick(); await f.tick();
  const view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  assert.equal(view.currentStage, 'HR approval'); assert.equal(view.stages[1].state, 'pending');
  assert.equal(view.blocked.code, 'live-ordering-unsupported'); assert.equal(view.provider.synthetic, false);
  const before = view.lifecycleRevision; await f.tick();
  assert.equal((await f.service.read(f.paula, { orderUuid: order.orderUuid })).value.lifecycleRevision, before);
});

test('an uncertain write stays pending under its operation ID and is reconciled before any retry', async (t) => {
  let synthetic; const calls = []; let fail = true;
  const flaky = { mode: 'synthetic', provider: 'synthetic-ordering-status:v1',
    async requestDecision(op) { calls.push(['request', op.operationId]); const r = await synthetic.requestDecision(op);
      if (fail) { fail = false; throw new Error('timeout after the provider stored the decision'); } return r; },
    async reconcile(op) { calls.push(['reconcile', op.operationId]); return synthetic.reconcile(op); } };
  const f = await setup(t, { status: flaky }); synthetic = createSyntheticOrderingStatus({ repository: f.repository });
  const order = await f.seed(f.paula);
  await f.tick(); await f.tick(); await f.tick();
  let view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  assert.equal(view.stages[1].state, 'pending'); assert.equal(view.blocked.code, 'provider-uncertain');
  const op = calls[0][1];
  await f.tick(); view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  assert.deepEqual(calls.filter((c) => c[1] === op), [['request', op], ['reconcile', op]], 'reconciled, not re-requested');
  assert.equal(view.stages[1].state, 'approved'); assert.equal(view.blocked, null);
  const receipts = await f.repository.query(f.greg, 'event_receipts', { consumerId: 'synthetic-ordering-status:v1', eventId: op });
  assert.equal(receipts.value.length, 1);
});

test('buddy and manual orders both progress through the same lifecycle', async (t) => {
  const f = await setup(t);
  const manual = await f.seed(f.paula, { sourceType: 'cart' }); const buddy = await f.seed(f.alex, { sourceType: 'buddy-offer' });
  const a = await until(f, manual.orderUuid, (v) => v.outcome !== 'in-progress');
  const b = await until(f, buddy.orderUuid, (v) => v.outcome !== 'in-progress');
  assert.deepEqual([a.route, a.outcome, b.route, b.outcome], ['manual', 'sent-to-ordering', 'buddy', 'sent-to-ordering']);
  const listed = await f.service.listOrders(f.greg); assert.equal(listed.value.orders.length, 2);
});

test('employee and run scoping, presenter/Greg reads, and truthful not-found and not-ready outcomes', async (t) => {
  const f = await setup(t); const order = await f.seed(f.paula);
  assert.equal((await f.service.read(f.alex, { orderUuid: order.orderUuid })).status, 'forbidden');
  assert.equal((await f.service.read(f.greg, { orderUuid: order.orderUuid })).status, 'ok');
  assert.equal((await f.service.read(f.presenter.value.context, { orderUuid: order.orderUuid })).status, 'ok');
  assert.equal((await f.service.listOrders(f.alex)).value.orders.length, 0);
  assert.equal((await f.service.read(f.greg, { orderUuid: 'no-such-order' })).status, 'not-found');
  const pending = await pendingSelection(f.repository, f.alex);
  const notReady = await f.service.read(f.greg, { orderUuid: pending.orderUuid });
  assert.deepEqual([notReady.status, notReady.code, notReady.state], ['unavailable', 'selection-pending', 'not-ready']);
  const other = await setup(t);
  assert.equal((await other.service.read(other.greg, { orderUuid: order.orderUuid })).status, 'not-found', 'another run cannot see it');
  assert.equal((await createLifecycleApprovalService({}).read(f.greg, { orderUuid: order.orderUuid })).status, 'unavailable');
  assert.equal((await f.service.read(f.greg, { orderUuid: order.orderUuid, employeeId: 'x' })).status, 'invalid');
});

test('HTTP routes use the server-owned context and ignore browser-supplied employee and run IDs', async (t) => {
  const f = await setup(t); const order = await f.seed(f.paula); await f.tick();
  const { buildServer } = await import('../index.js');
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspRoutes: createLifecycleApprovalRoutes(f.service), gcspAllowedOrigins: ['https://lifecycle.test'] });
  assert.equal((await server.gcspStartup).status, 'ok'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const sessions = {};
  for (const id of ['demo-paula', 'demo-alex', 'demo-greg']) sessions[id] = await f.identity.switchPrincipal(f.presenter.value.context, id, `http-${id}`);
  const cookie = (s) => [s.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  const call = async (path, id) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp${path}`, { headers: { Origin: 'https://lifecycle.test', Cookie: cookie(sessions[id]) } });
    return { status: response.status, value: await response.json(), cache: response.headers.get('cache-control') };
  };
  const own = await call(`/orders/progress?orderUuid=${order.orderUuid}&employeeId=employee-alex&runId=other`, 'demo-paula');
  assert.equal(own.status, 200, JSON.stringify(own)); assert.equal(own.cache, 'no-store');
  assert.equal(own.value.value.employeeId, 'employee-paula'); assert.equal(own.value.value.currentStage, 'HR approval');
  assert.equal((await call(`/orders/progress?orderUuid=${order.orderUuid}&employeeId=employee-alex`, 'demo-alex')).status, 403);
  assert.equal((await call(`/orders/progress?orderUuid=${order.orderUuid}`, 'demo-greg')).status, 200);
  assert.equal((await call('/orders/progress/all', 'demo-greg')).value.value.orders.length, 1);
  assert.equal((await call('/orders/progress?orderUuid=missing', 'demo-greg')).status, 404);
  assert.equal((await call(`/orders/progress?orderUuid=${order.orderUuid}&stage=x`, 'demo-greg')).status, 400);
});

test('response-shape fixtures for the order progress screen match the read model', async (t) => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-approval-outcomes.json', import.meta.url), 'utf8'));
  const f = await setup(t); const order = await f.seed(f.paula); await f.tick();
  const view = (await f.service.read(f.paula, { orderUuid: order.orderUuid })).value;
  for (const name of ['pending', 'declined', 'sent-to-ordering', 'unsupported']) {
    assert.deepEqual(Object.keys(fixtures[name].value).sort(), Object.keys(view).sort(), name);
    assert.equal(fixtures[name].value.contractVersion, 'lifecycle.stages.v1');
  }
  for (const name of ['not-found', 'not-ready', 'forbidden']) assert.ok(fixtures[name].status, name);
  assert.ok(!JSON.stringify(fixtures).includes('—'), 'no em dashes in user-facing copy');
  assert.equal(HANDLER_ID < 'lifecycle-documents', true, 'approval handler sorts before the document handler');
});

test('real FUCQ-71 producer: ManualOrderService manual and buddy selections progress through every stage', async (t) => {
  const f = await setup(t, { producer: true });
  const manual = await f.real.submit(f.paula, { id: 801, type: 'cart' });
  assert.equal(manual.submitted.status, 'ok', JSON.stringify(manual.submitted)); assert.ok(manual.submitted.value.order, 'acknowledged by synthetic-ordering:v1');
  const buddy = await f.real.submit(f.alex, { id: 802, type: 'buddy-offer' });
  assert.equal(buddy.submitted.status, 'ok', JSON.stringify(buddy.submitted));
  const start = (await f.service.read(f.paula, { orderUuid: manual.orderUuid })).value;
  assert.equal(start.source.operationType, 'selection-order'); assert.equal(start.source.operationId, manual.submitted.value.operationId);
  assert.equal(start.policyVersion, 'gcsp-policy-v1'); assert.equal(start.entitlementSlotId, 'slot-paula');
  assert.deepEqual([start.renewalAuthority, start.renewalId], ['missing', null], 'no renewal authority was supplied'); assert.deepEqual(start.source.approvalStages, ['HR approval', 'sales-manager approval', 'sent to ordering']);
  const a = await until(f, manual.orderUuid, (v) => v.outcome !== 'in-progress', 16);
  const b = await until(f, buddy.orderUuid, (v) => v.outcome !== 'in-progress', 16);
  assert.deepEqual([a.route, a.outcome, b.route, b.outcome], ['manual', 'sent-to-ordering', 'buddy', 'sent-to-ordering']);
  assert.ok(a.stages.every((s) => s.state === 'approved' && s.providerReference));
  const acknowledged = await f.repository.query(f.greg, 'event_receipts', { consumerId: 'synthetic-ordering:v1' });
  assert.equal(acknowledged.value.length, 2, 'FUCQ-71 acknowledgement receipts stay untouched');
});

test('one failing order is recorded and skipped while another order advances, and the tick replays identically', async (t) => {
  const f = await setup(t);
  const good = await f.seed(f.paula); const bad = await f.seed(f.alex, { stages: ['unknown approval', 'sent to ordering'] });
  const first = await f.tick();
  assert.equal(first.outcome.status, 'ok', JSON.stringify(first.outcome));
  const handler = first.outcome.value.outcomes.find((o) => o.handlerId === HANDLER_ID).outcome.value;
  assert.deepEqual(handler.failed.map((x) => [x.orderUuid, x.status]), [[bad.orderUuid, 'unavailable']]);
  assert.equal(handler.advanced, 1);
  assert.equal((await f.service.read(f.greg, { orderUuid: good.orderUuid })).value.currentStage, 'HR approval');
  assert.equal((await f.service.read(f.greg, { orderUuid: bad.orderUuid })).status, 'unavailable');
  const snapshot = structuredClone(f.store.state);
  const replay = await f.clock.tick(f.presenter.value.context, { eventId: first.eventId, expectedClockVersion: first.clockVersion, inputDigest: inputDigest(first.eventId) });
  assert.deepEqual(replay, first.outcome); assert.deepEqual(f.store.state, snapshot);
});

test('internal stagePort serves DemoClock handler contexts with a top-level policyVersion, bound to the current run', async (t) => {
  const seen = [];
  const f = await setup(t, { extraHandler: (service) => ({ handlerId: 'lifecycle-documents-probe', stage: 'pending-reconciliation',
    handle: async ({ context }) => { const port = service.stagePort(); const listed = await port.listOrders(context);
      const read = listed.value?.orders?.[0] ? await port.read(context, { orderUuid: listed.value.orders[0].orderUuid }) : null;
      const foreign = await port.listOrders({ ...context, runId: 'another-run' });
      seen.push({ roles: context.roles, listed: listed.status, count: listed.value?.orders?.length, read, foreign: foreign.status });
      return { status: 'ok', value: { probed: true } }; } }) });
  const order = await f.seed(f.paula); await f.tick(); await f.tick();
  const last = seen.at(-1);
  assert.deepEqual(last.roles, ['presenter']); assert.equal(last.listed, 'ok'); assert.equal(last.count, 1);
  assert.equal(last.read.status, 'ok'); assert.equal(last.read.value.orderUuid, order.orderUuid);
  assert.equal(last.read.value.policyVersion, 'gcsp-policy-v1'); assert.ok(last.read.value.lifecycleRevision >= 1, 'approval handler ran first');
  assert.equal(last.foreign, 'stale-run');
  // Startup ticks pass a context the identity service never issued (principalId clock-startup, roles []).
  const system = { environmentId: f.paula.environmentId, runId: f.paula.runId, principalId: 'clock-startup', roles: [] };
  const direct = await f.service.stagePort().read(system, { orderUuid: order.orderUuid });
  assert.equal(direct.status, 'ok', JSON.stringify(direct)); assert.equal(direct.value.policyVersion, 'gcsp-policy-v1');
  assert.equal((await f.service.read(system, { orderUuid: order.orderUuid })).status, 'forbidden', 'public read refuses it');
  assert.equal((await f.service.stagePort().read({ ...system, environmentId: 'other' }, { orderUuid: order.orderUuid })).status, 'stale-run');
  assert.equal(Object.isFrozen(f.service.stagePort()), true); assert.equal(f.service.stagePort(), f.service.stagePort());
  assert.equal((await f.service.read({ ...f.paula }, { orderUuid: order.orderUuid })).status, 'forbidden', 'public read keeps its role check');
});

test('canonical seed carries the prepared FUCQ-111 rows exactly', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const prepared = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-approval-policy.json', import.meta.url), 'utf8'));
  for (const row of prepared.assumptions) assert.deepEqual(seed.assumptions.find((a) => a.key === row.key), row, row.key);
  assert.ok(seed.assumptions.some((a) => a.key === 'ordering.approvalStages.v1'));
});
