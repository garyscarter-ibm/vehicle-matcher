import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { createLifecycleDocumentService, DOCUMENTS_HANDLER_ID, observeStage } from '../gcsp/lifecycle/documents/index.js';
import { createDocumentRoutes } from '../gcsp/lifecycle/documents/http.js';
import { RenewalCaseService } from '../gcsp/cases/index.js';
import { createLifecycleApprovalService } from '../gcsp/lifecycle/approvals/index.js';
import { createSyntheticOrderingStatus } from '../gcsp/adapters/synthetic-ordering-status.js';
import { createRealProducer } from './helpers/gcsp-lifecycle-approval.js';
import { createSyntheticDocumentStatus, createLiveDocumentStatusStub } from '../gcsp/adapters/synthetic-ordering-documents.js';

const patch = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-documents-policy-patch.json', import.meta.url), 'utf8'));
const shapes = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-documents-outcomes.json', import.meta.url), 'utf8'));
const ORDER = '7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f';
const HOUR = 3600; const DAY = 86400;

// The canonical seed plus the story's additive rows, read only through PolicyService.
async function policyWith(change = (rows) => rows) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const rows = change(structuredClone(patch.assumptions));
  seed.assumptions = [...seed.assumptions.filter((a) => !rows.some((r) => r.key === a.key)), ...rows];
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}
const setValue = (key, mutate) => (rows) => { const row = rows.find((r) => r.key === key); mutate(row.value); return rows; };

// Injected FUCQ-111 stage port fixture: proves consumer mechanics only, never producer integration.
function stagePort() {
  const orders = new Map();
  return { orders, async read(context, { orderUuid }) {
    const order = orders.get(orderUuid); if (!order) return result('not-found', { resourceType: 'lifecycle' });
    if (order.reply) return typeof order.reply === 'function' ? order.reply() : order.reply;
    const stages = order.stageList.map((stage, index) => ({ stage, state: index < order.approved ? 'approved' : index === order.approved ? 'pending' : 'not-started',
      at: index < order.approved ? '2026-11-05T09:00:00.000Z' : null, providerReference: index <= order.approved ? `SYN-STAGE-${index}` : null }));
    return ok({ contractVersion: order.contractVersion ?? 'lifecycle.stages.v1', runId: order.runId ?? context.runId, orderUuid, employeeId: order.employeeId,
      ...(order.nestedPolicy ? { policy: { policyVersion: 'gcsp-policy-v1' } } : { policyVersion: 'gcsp-policy-v1' }), lifecycleRevision: order.revision, stageList: order.stageList, currentStage: order.stageList[order.approved] ?? null,
      entitlementSlotId: order.slot ?? 'slot-paula', renewalId: order.renewalId === undefined ? 'renewal:employee-paula' : order.renewalId,
      renewalAuthority: order.renewalAuthority ?? (order.renewalId === null ? 'missing' : 'validated'),
      stages, outcome: order.declined ? 'declined' : order.approved >= order.stageList.length ? 'sent-to-ordering' : 'in-progress' });
  }, async listOrders() { return ok({ orders: [...orders.keys()].map((orderUuid) => ({ orderUuid })) }); } };
}
const STAGES = ['selection received', 'HR approval', 'sales-manager approval', 'sent to ordering'];

async function setup(t, { policy, provider = 'synthetic', stages = stagePort(), register = true } = {}) {
  policy ??= await policyWith();
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'documents-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const alex = await identity.switchPrincipal(presenter.value.context, 'demo-alex', 'alex');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context: paula.value.context })).status, 'ok');
  const adapter = provider === 'live' ? createLiveDocumentStatusStub() : createSyntheticDocumentStatus({ repository });
  const service = createLifecycleDocumentService({ repository, policy, clock, identity, lifecycleStages: stages, provider: adapter });
  if (register) assert.equal((await service.start()).status, 'ok');
  t.after(() => repository.close());
  const p = presenter.value.context;
  let n = 0;
  const tick = async () => {
    const now = await clock.now(p); const eventId = `tick-${++n}`;
    const outcome = await clock.tick(p, { eventId, expectedClockVersion: now.value.clockVersion, inputDigest: inputDigest(eventId) });
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value;
  };
  const advance = async (bySeconds) => {
    const now = await clock.now(p);
    assert.equal((await clock.advance(p, { commandId: `advance-${++n}`, expectedClockVersion: now.value.clockVersion, bySeconds })).status, 'ok');
  };
  const order = (patchOrder = {}) => stages.orders.set(ORDER, { employeeId: 'employee-paula', stageList: STAGES, approved: 4, revision: 4, ...patchOrder });
  return { repository, clock, identity, presenter, paula: paula.value.context, alex: alex.value.context, greg: greg.value.context,
    paulaSession: paula, alexSession: alex, service, stages, tick, advance, order, adapter };
}
const items = async (f, context = f.paula) => { const read = await f.service.readItems(context); assert.equal(read.status, 'ok', JSON.stringify(read)); return read.value.orders; };
const item = (order, id) => order.items.find((entry) => entry.itemId === id);
const receipts = async (f, consumerId) => (await f.repository.query(f.paula, 'event_receipts', { consumerId })).value;

test('the item set comes from PolicyService keys, labelled synthetic, and a changed key changes it', async (t) => {
  const f = await setup(t); f.order(); await f.tick();
  const [order] = await items(f);
  assert.deepEqual(order.items.map((i) => i.itemId), ['agreement-acknowledgement', 'licence-check', 'vehicle-preparation', 'delivery-to-retailer']);
  assert.ok(order.items.every((i) => i.assumption.synthetic && i.assumption.key === 'lifecycle.documents.v1' && i.assumption.basis.length > 0));
  assert.deepEqual(order.assumptions.map((a) => a.key), ['lifecycle.documents.v1', 'lifecycle.documents.scenario.v1', 'lifecycle.documents.exceptions.v1']);
  assert.ok(order.assumptions.every((a) => a.status === 'assumed' && a.policyVersion === 'gcsp-policy-v1'));
  const changed = await setup(t, { policy: await policyWith(setValue('lifecycle.documents.v1', (v) => {
    v.items.find((i) => i.itemId === 'licence-check').schemeIds = ['choices-rr-production']; v.items[2].label = 'Car preparation'; })) });
  changed.order(); await changed.tick();
  const [other] = await items(changed);
  assert.deepEqual(other.items.map((i) => i.itemId), ['agreement-acknowledgement', 'vehicle-preparation', 'delivery-to-retailer']);
  assert.equal(item(other, 'vehicle-preparation').label, 'Car preparation');
  const broken = await setup(t, { policy: await policyWith(setValue('lifecycle.documents.v1', (v) => { v.items[0].owner = 'nobody'; })) });
  broken.order(); assert.equal((await broken.service.readReadiness(broken.paula, { orderUuid: ORDER })).value.reason, 'document-policy-unavailable');
});

test('items open once at the keyed lifecycle stage, bind its revision and keep progress on replay', async (t) => {
  const f = await setup(t); f.order({ approved: 3, revision: 3 });
  const first = await f.tick();
  assert.deepEqual(first.handlerOrder, [{ handlerId: DOCUMENTS_HANDLER_ID, stage: 'pending-reconciliation' }]);
  assert.deepEqual(await items(f), []);
  assert.equal((await f.service.readReadiness(f.paula, { orderUuid: ORDER })).value.reason, 'opening-stage-not-reached');
  f.order({ approved: 4, revision: 4 }); await f.tick();
  let [order] = await items(f);
  assert.equal(order.opening.stage, 'sent to ordering'); assert.equal(order.opening.lifecycleRevision, 4);
  assert.equal(item(order, 'agreement-acknowledgement').status, 'waiting-for-employee');
  assert.equal(item(order, 'licence-check').status, 'in-progress');
  assert.match(item(order, 'licence-check').providerReference, /^SYN-DOC-/);
  assert.equal(order.items.every((i) => /Z$/.test(i.dueAt)), true);
  await f.service.completeTask(f.paula, { commandId: 'ack', orderUuid: ORDER, itemId: 'agreement-acknowledgement', acknowledgement: 'synthetic' });
  f.order({ approved: 4, revision: 5 }); await f.tick(); await f.tick();
  [order] = await items(f);
  assert.equal(order.lastObservedRevision, 5); assert.equal(order.opening.lifecycleRevision, 4);
  assert.equal(item(order, 'agreement-acknowledgement').status, 'complete');
  assert.equal((await receipts(f, 'lifecycle-documents:state:v1')).length, 1);
  const early = await setup(t, { policy: await policyWith(setValue('lifecycle.documents.v1', (v) => { v.openingStage = 'sales-manager approval'; })) });
  early.order({ approved: 3, revision: 3 }); await early.tick();
  assert.equal((await items(early)).length, 1);
});

test('missing, unsupported, stale or foreign stage reads stay explicitly not open', async (t) => {
  const f = await setup(t); const read = (o) => f.service.readReadiness(f.paula, { orderUuid: ORDER });
  assert.equal((await read()).value.reason, 'no-lifecycle-for-order');
  f.order({ runId: 'demo-other-run' }); assert.equal((await read()).value.reason, 'stage-identity-mismatch');
  f.order({ contractVersion: 'lifecycle.stages.v0' }); assert.equal((await read()).value.reason, 'stage-contract-unsupported');
  f.order({ reply: result('unsupported', { reason: 'live' }) }); assert.equal((await read()).value.reason, 'stage-mode-unsupported');
  f.order({ reply: () => { throw new Error('down'); } }); assert.equal((await read()).value.reason, 'stage-read-unavailable');
  f.order({ revision: 0 }); assert.equal((await read()).value.reason, 'stage-revision-missing');
  f.order({ employeeId: 'employee-nobody' }); await f.tick(); assert.deepEqual(await items(f), []);
  f.order({ renewalAuthority: 'validated', renewalId: null }); assert.equal((await read()).value.reason, 'stage-renewal-authority-invalid');
  f.order({ slot: 'slot-alex' }); await f.tick(); assert.deepEqual(await items(f), []);
  assert.equal((await f.service.readReadiness(f.paula, { orderUuid: ORDER })).value.reason, 'awaiting-document-tick');
  f.order({ nestedPolicy: true }); assert.equal((await read()).value.reason, 'awaiting-document-tick');
  const listOnly = stagePort(); listOnly.list = listOnly.listOrders; delete listOnly.listOrders;
  const viaList = await setup(t, { stages: listOnly }); viaList.order({ nestedPolicy: true }); await viaList.tick();
  assert.equal((await items(viaList)).length, 1);
  const staleIdentity = { requireRole: async () => result('stale-run', { reason: 'earlier run' }) };
  const staleService = createLifecycleDocumentService({ repository: f.repository, policy: await policyWith(), clock: f.clock, identity: staleIdentity, lifecycleStages: f.stages });
  assert.equal((await staleService.readReadiness(f.greg, { orderUuid: ORDER })).status, 'stale-run');
  const none = await setup(t, { stages: null }); const outcome = await none.tick();
  assert.equal(outcome.outcomes.find((o) => o.handlerId === DOCUMENTS_HANDLER_ID).outcome.value.producer, 'missing');
  assert.equal((await none.service.readReadiness(none.paula, { orderUuid: ORDER })).value.reason, 'stage-read-unavailable');
  assert.equal(observeStage(undefined, { context: f.paula, orderUuid: ORDER, openingStage: 'x', openingState: 'approved' }).status, 'not-open');
});

test('one order that cannot progress is recorded as blocked while another still progresses', async (t) => {
  const f = await setup(t, { register: false }); const BAD = '0b0b0b0b-1111-4222-8333-444444444444';
  const failing = { ...f.repository, transaction: (c, command, work) => command.commandId.includes(BAD)
    ? Promise.resolve(result('unavailable', { reason: 'synthetic-order-failure', retryable: true })) : f.repository.transaction(c, command, work) };
  const service = createLifecycleDocumentService({ repository: failing, policy: await policyWith(), clock: f.clock, identity: f.identity,
    lifecycleStages: f.stages, provider: f.adapter });
  assert.equal((await service.start()).status, 'ok');
  f.order(); f.stages.orders.set(BAD, { employeeId: 'employee-paula', stageList: STAGES, approved: 4, revision: 4 });
  const outcome = (await f.tick()).outcomes.find((o) => o.handlerId === DOCUMENTS_HANDLER_ID).outcome;
  assert.equal(outcome.status, 'ok');
  assert.deepEqual(outcome.value.blocked, [{ orderUuid: BAD, step: 'open', status: 'unavailable' }]);
  await f.advance(HOUR); await f.tick();
  const orders = (await service.readItems(f.paula)).value.orders;
  assert.deepEqual(orders.map((o) => o.orderUuid), [ORDER]);
  assert.equal(item(orders[0], 'licence-check').status, 'complete');
});

test('exceptions carry the order\'s own slot and renewal, never the employee\'s default slot', async (t) => {
  const f = await setup(t, { register: false });
  const second = await f.repository.transaction(f.paula, { commandId: 'slot-b', inputDigest: inputDigest('slot-b') }, (tx) => tx.insert('entitlement_slots', {
    runId: f.paula.runId, entitlementSlotId: 'slot-paula-b', employeeId: 'employee-paula', renewalId: 'renewal:employee-paula:b', capacity: 1, state: 'entitled' }));
  assert.equal(second.status, 'ok', JSON.stringify(second));
  const policy = await policyWith((rows) => [...rows, { ...rows[2], key: 'renewalCase.lifecycle.eventTypes', value: ['document-overdue'], unit: 'event type keys' }]);
  const service = createLifecycleDocumentService({ repository: f.repository, policy, clock: f.clock, identity: f.identity, lifecycleStages: f.stages, provider: f.adapter });
  const cases = new RenewalCaseService({ repository: f.repository, policy, clock: f.clock, identity: f.identity });
  assert.equal((await service.start()).status, 'ok'); assert.equal((await cases.start()).status, 'ok');
  f.order({ slot: 'slot-paula-b', renewalId: 'renewal:employee-paula:b' }); await f.tick(); await f.advance(2 * DAY + 1); await f.tick();
  const [overdue] = await receipts(f, 'lifecycle-documents:exceptions:v1');
  assert.deepEqual([overdue.outcome.value.entitlementSlotId, overdue.outcome.value.renewalId, overdue.outcome.value.renewalAuthority],
    ['slot-paula-b', 'renewal:employee-paula:b', 'validated']);
  // The consumer only matches the employee's default renewal, so the B-slot exception must not open a case against renewal A.
  assert.deepEqual((await f.repository.query(f.paula, 'renewal_cases', {})).value.filter((c) => c.renewalId === 'renewal:employee-paula'), []);
  const missing = await setup(t); missing.order({ renewalId: null, slot: null }); await missing.tick(); await missing.advance(2 * DAY + 1); await missing.tick();
  const [unknown] = await receipts(missing, 'lifecycle-documents:exceptions:v1');
  assert.deepEqual([unknown.outcome.value.renewalId, unknown.outcome.value.renewalAuthority], [null, 'missing']);
});

test('a producer forbidden read and foreign pending or declined orders are refused, never reported as not open', async (t) => {
  const f = await setup(t);
  f.order({ reply: result('forbidden', { reason: 'not yours' }) });
  assert.equal((await f.service.readReadiness(f.greg, { orderUuid: ORDER })).status, 'forbidden');
  for (const shape of [{ employeeId: 'employee-alex', approved: 2 }, { employeeId: 'employee-alex', approved: 2, declined: true }]) {
    f.order({ ...shape, slot: 'slot-alex', renewalId: null });
    assert.equal((await f.service.readReadiness(f.paula, { orderUuid: ORDER })).status, 'forbidden');
  }
  assert.equal((await f.service.readReadiness(f.greg, { orderUuid: ORDER })).value.reason, 'opening-stage-not-reached');
});

// Real producer chain: FUCQ-71 ManualOrderService -> FUCQ-111 LifecycleApprovalService.stagePort() -> documents, one run.
async function realChain(t, { approvalPolicy } = {}) {
  const policy = await policyWith();
  const f = await setup(t, { policy, register: false, stages: null });
  assert.equal((await seedManualDemoContext({ repository: f.repository, identity: f.identity, clock: f.clock, context: f.alex })).status, 'ok');
  const approvals = createLifecycleApprovalService({ repository: f.repository, policy: approvalPolicy ?? policy, clock: f.clock, identity: f.identity,
    status: createSyntheticOrderingStatus({ repository: f.repository }) });
  if (!approvalPolicy) assert.equal((await approvals.start()).status, 'ok');
  const service = createLifecycleDocumentService({ repository: f.repository, policy, clock: f.clock, identity: f.identity,
    lifecycleStages: approvals.stagePort(), provider: f.adapter });
  assert.equal((await service.start()).status, 'ok');
  const producer = await createRealProducer({ repository: f.repository, policy, clock: f.clock, identity: f.identity });
  return { ...f, approvals, service, producer };
}
const documentsOutcome = (tick) => tick.outcomes.find((o) => o.handlerId === DOCUMENTS_HANDLER_ID).outcome;

test('real stagePort: a healthy order opens, a corrupted order is diagnosed, not a global block; policy-wide and foreign refusals hold', async (t) => {
  const f = await realChain(t);
  const healthy = await f.producer.submit(f.paula, { id: 811, type: 'cart' });
  const bad = await f.producer.submit(f.alex, { id: 812, type: 'cart' });
  assert.equal(healthy.submitted.status, 'ok', JSON.stringify(healthy.submitted)); assert.equal(bad.submitted.status, 'ok', JSON.stringify(bad.submitted));
  const corrupted = await f.repository.transaction(f.alex, { commandId: 'corrupt-real', inputDigest: inputDigest('corrupt-real') }, async (tx) => {
    const ref = { table: 'pending_operations', key: { runId: f.alex.runId, operationId: bad.submitted.value.operationId } };
    const row = await tx.get(ref); return tx.compareAndSwap(ref, row.value.version, { outcome: { status: 'unknown' } });
  });
  assert.equal(corrupted.status, 'ok');
  let outcome; let opened = [];
  for (let i = 0; i < 16 && opened.length === 0; i += 1) {
    await f.advance(HOUR); outcome = documentsOutcome(await f.tick());
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); opened = await items(f);
  }
  assert.deepEqual(opened.map((o) => o.orderUuid), [healthy.orderUuid], 'the healthy order opened from the real approved stage');
  const view = (await f.approvals.stagePort().read({ ...f.paula, principalId: 'clock-startup', roles: [] }, { orderUuid: healthy.orderUuid })).value;
  assert.deepEqual([opened[0].opening.stage, opened[0].opening.lifecycleRevision, opened[0].opening.stagePolicyVersion], ['sent to ordering', view.lifecycleRevision, view.policyVersion]);
  assert.equal(view.stages.find((s) => s.stage === 'sent to ordering').state, 'approved');
  assert.deepEqual(outcome.value.producerFailed.map((x) => [x.orderUuid, x.code]), [[bad.orderUuid, 'selection-source-invalid']]);
  assert.equal(outcome.value.producerFailedCount, 1); assert.equal(outcome.value.producer, 'ok');
  assert.deepEqual((await items(f, f.alex)), [], 'the corrupted order opens nothing');
  assert.equal((await f.service.readReadiness(f.alex, { orderUuid: healthy.orderUuid })).status, 'forbidden', 'foreign ownership refused');
  assert.equal((await f.service.readReadiness(f.paula, { orderUuid: bad.orderUuid })).status, 'ok');
  const ready = (await f.service.readReadiness(f.greg, { orderUuid: healthy.orderUuid })).value;
  assert.deepEqual([ready.opened, ready.ready], [true, false]);

  // Policy-wide: a real PolicyService over a malformed file in the launcher's owned TMPDIR refuses the whole list.
  const dir = await mkdtemp(join(tmpdir(), 'fucq116-policy-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const filePath = join(dir, 'seed-v1.json'); await writeFile(filePath, '{ "schemaVersion": 1, ');
  const broken = await realChain(t, { approvalPolicy: new PolicyService({ provider: new FilePolicyProvider({ filePath }) }) });
  const order = await broken.producer.submit(broken.paula, { id: 813, type: 'cart' });
  assert.equal(order.submitted.status, 'ok');
  const refused = documentsOutcome(await broken.tick());
  assert.equal(refused.status, 'ok');
  assert.deepEqual(refused.value.producer, { status: 'invalid', code: 'source-invalid', scope: 'policy-wide' });
  assert.deepEqual([refused.value.opened, refused.value.producerFailed], [0, []]);
  const read = (await broken.service.readReadiness(broken.greg, { orderUuid: order.orderUuid })).value;
  assert.deepEqual([read.state, read.reason, read.producerCode], ['not-open', 'stage-read-unavailable', 'source-invalid']);
});

test('the employee completes her task with a labelled synthetic acknowledgement; others are refused', async (t) => {
  const f = await setup(t); f.order(); await f.tick();
  const [order] = await items(f);
  assert.deepEqual(order.tasks.map((task) => [task.itemId, task.action, task.actionable]), [['agreement-acknowledgement', 'Acknowledge the agreement', true]]);
  const task = { commandId: 'ack', orderUuid: ORDER, itemId: 'agreement-acknowledgement', acknowledgement: 'synthetic' };
  assert.equal((await f.service.completeTask(f.alex, task)).status, 'forbidden');
  assert.deepEqual(await items(f, f.alex), []);
  assert.equal((await f.service.readReadiness(f.alex, { orderUuid: ORDER })).status, 'forbidden');
  const unopened = await setup(t); unopened.order({ approved: 4, revision: 4 });
  assert.equal((await unopened.service.readReadiness(unopened.alex, { orderUuid: ORDER })).status, 'forbidden');
  assert.equal((await unopened.service.readReadiness(unopened.paula, { orderUuid: ORDER })).value.reason, 'awaiting-document-tick');
  assert.equal((await f.service.completeTask(f.paula, { ...task, itemId: 'licence-check' })).status, 'forbidden');
  assert.equal((await f.service.completeTask(f.paula, { ...task, acknowledgement: 'signed' })).status, 'invalid');
  const done = await f.service.completeTask(f.paula, task);
  assert.equal(done.status, 'ok', JSON.stringify(done));
  const ack = item(done.value.order, 'agreement-acknowledgement').acknowledgement;
  assert.equal(ack.kind, 'synthetic-acknowledgement'); assert.match(ack.label, /Not a signature/);
  assert.deepEqual(await f.service.completeTask(f.paula, task), done);
  assert.equal((await f.service.completeTask(f.paula, { ...task, commandId: 'again' })).status, 'conflict');
  assert.equal((await f.service.completeTask(f.greg, task)).status, 'forbidden');
  assert.equal((await f.service.readReadiness(f.greg, { orderUuid: ORDER })).status, 'ok');
});

test('provider items advance on ticks after keyed delays, and the scenario key makes one fail', async (t) => {
  const f = await setup(t); f.order(); await f.tick();
  await f.advance(HOUR - 1); await f.tick();
  assert.equal(item((await items(f))[0], 'licence-check').status, 'in-progress');
  await f.advance(1); await f.tick();
  let [order] = await items(f);
  assert.equal(item(order, 'licence-check').status, 'complete'); assert.equal(item(order, 'vehicle-preparation').status, 'in-progress');
  await f.advance(2 * DAY); await f.tick();
  [order] = await items(f);
  assert.deepEqual(order.items.filter((i) => i.owner !== 'employee').map((i) => i.status), ['complete', 'complete', 'complete']);
  const failing = await setup(t, { policy: await policyWith(setValue('lifecycle.documents.scenario.v1', (v) => { v.failItemIds = ['vehicle-preparation']; })) });
  failing.order(); await failing.tick(); await failing.advance(DAY); await failing.tick();
  [order] = await items(failing);
  assert.equal(item(order, 'vehicle-preparation').status, 'failed');
  assert.equal(item(order, 'vehicle-preparation').reason, 'The synthetic provider reported this step as failed.');
  assert.equal(order.readiness.state, 'failed'); assert.deepEqual(order.readiness.failed, ['vehicle-preparation']);
  const [failure] = (await receipts(failing, 'lifecycle-documents:exceptions:v1'));
  assert.equal(failure.eventType, 'document-failed');
});

test('the readiness read alone reports handover ready once documents are complete and the car is ready', async (t) => {
  const f = await setup(t); f.order(); await f.tick();
  let ready = (await f.service.readReadiness(f.paula, { orderUuid: ORDER })).value;
  assert.equal(ready.ready, false); assert.equal(ready.state, 'waiting');
  await f.advance(2 * DAY); await f.tick();
  ready = (await f.service.readReadiness(f.paula, { orderUuid: ORDER })).value;
  assert.deepEqual([ready.ready, ready.documentsComplete, ready.vehicleReady, ready.blocking], [false, false, true, ['agreement-acknowledgement']]);
  await f.service.completeTask(f.paula, { commandId: 'ack', orderUuid: ORDER, itemId: 'agreement-acknowledgement', acknowledgement: 'synthetic' });
  ready = (await f.service.readReadiness(f.greg, { orderUuid: ORDER })).value;
  assert.deepEqual([ready.ready, ready.state, ready.blocking], [true, 'ready', []]);
  assert.equal((await f.service.readReadiness(f.paula, { orderUuid: ORDER, ready: true })).status, 'invalid');
});

test('an overdue employee item is shown overdue and records one keyed lifecycle-exception receipt', async (t) => {
  const f = await setup(t); f.order(); await f.tick();
  await f.advance(2 * DAY + 1); await f.tick(); await f.tick();
  const [order] = await items(f);
  assert.equal(item(order, 'agreement-acknowledgement').overdue, true); assert.equal(order.tasks[0].overdue, true);
  const overdue = await receipts(f, 'lifecycle-documents:exceptions:v1');
  assert.equal(overdue.length, 1); assert.equal(overdue[0].eventType, 'document-overdue'); assert.equal(overdue[0].state, 'completed');
  const value = overdue[0].outcome.value;
  assert.deepEqual([value.employeeId, value.renewalId, value.orderUuid, value.occurredAt], ['employee-paula', 'renewal:employee-paula', ORDER, (await f.clock.now(f.paula)).value.now]);
  assert.equal(overdue[0].outcome.status, 'ok');
});

test('the renewal-risk consumer opens a case from the overdue receipt only when policy selects its type', async (t) => {
  for (const [types, expected] of [[['approval-declined'], 0], [['approval-declined', 'document-overdue'], 1]]) {
    const policy = await policyWith((rows) => [...rows, { ...rows[2], key: 'renewalCase.lifecycle.eventTypes', value: types, unit: 'event type keys' }]);
    const f = await setup(t, { policy, register: false });
    const cases = new RenewalCaseService({ repository: f.repository, policy, clock: f.clock, identity: f.identity });
    assert.equal((await f.service.start()).status, 'ok'); assert.equal((await cases.start()).status, 'ok');
    f.order(); await f.tick(); await f.advance(2 * DAY + 1);
    const outcome = await f.tick();
    assert.deepEqual(outcome.handlerOrder.map((h) => h.handlerId), [DOCUMENTS_HANDLER_ID, 'renewal-risk-cases']);
    assert.equal(outcome.outcomes.find((o) => o.handlerId === 'renewal-risk-cases').outcome.value.opened, expected);
  }
});

test('the live-shaped stub reports writes as unsupported and never progresses an item', async (t) => {
  const stub = createLiveDocumentStatusStub();
  assert.equal((await stub.start({})).status, 'unsupported'); assert.equal((await stub.progress({}, 'now')).status, 'unsupported');
  const f = await setup(t, { provider: 'live' }); f.order(); await f.tick(); await f.advance(3 * DAY); await f.tick();
  const [order] = await items(f);
  assert.equal(order.providerMode, 'live');
  assert.ok(order.items.filter((i) => i.owner !== 'employee').every((i) => i.status === 'not-started' && i.lastProviderOutcome === 'unsupported'));
  assert.equal((await f.service.readReadiness(f.paula, { orderUuid: ORDER })).value.ready, false);
});

test('/api/gcsp document routes use the server-owned context and ignore browser identity or run IDs', async (t) => {
  const f = await setup(t); f.order(); await f.tick();
  const handler = createGcspHandler({ identity: f.identity, routes: createDocumentRoutes(f.service), allowedOrigins: ['https://documents.test'] });
  const cookie = (session) => [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  const call = async (path, { body, session = f.paulaSession, query = '' } = {}) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method: body ? 'POST' : 'GET', headers: { origin: 'https://documents.test', cookie: cookie(session) } });
    let sent; const res = { setHeader() {} };
    await handler({ req, res, pathname: `/api/gcsp${path}`, searchParams: new URLSearchParams(query), sendJson: (r, code, value) => { sent = { code, value }; } });
    return sent;
  };
  const listed = await call('/documents', { query: 'employeeId=employee-alex&runId=other' });
  assert.equal(listed.code, 200); assert.equal(listed.value.value.orders[0].employeeId, 'employee-paula');
  assert.equal((await call('/documents', { session: f.alexSession })).value.value.orders.length, 0);
  const done = await call('/documents/tasks/complete', { body: { commandId: 'http-ack', orderUuid: ORDER, itemId: 'agreement-acknowledgement',
    acknowledgement: 'synthetic', employeeId: 'employee-alex', runId: 'other', roles: ['presenter'] } });
  assert.equal(done.code, 200, JSON.stringify(done));
  assert.equal(done.value.value.order.tasks[0].acknowledgement.actorId, 'demo-paula');
  const refused = await call('/documents/tasks/complete', { session: f.alexSession, body: { commandId: 'x', orderUuid: ORDER, itemId: 'agreement-acknowledgement', acknowledgement: 'synthetic' } });
  assert.equal(refused.code, 403);
  assert.equal((await call('/documents/readiness', { query: `orderUuid=${ORDER}` })).value.value.blocking.includes('licence-check'), true);
  assert.equal((await call('/documents', { query: 'other=1' })).code, 400);
  // Recorded response shapes for the later order progress screen (no screen in this story).
  const [order] = listed.value.value.orders;
  assert.deepEqual(Object.keys(order).sort(), [...shapes.orderKeys].sort());
  for (const entry of order.items) assert.deepEqual(Object.keys(entry).filter((k) => !Object.hasOwn(shapes.optionalItemKeys, k)).sort(), [...shapes.itemKeys].sort());
  assert.ok(Object.hasOwn(order.items[0], 'action'));
  assert.deepEqual(Object.keys(order.tasks[0]).sort(), [...shapes.taskKeys].sort());
  assert.deepEqual(Object.keys(order.readiness).sort(), [...shapes.readinessKeys].sort());
});
