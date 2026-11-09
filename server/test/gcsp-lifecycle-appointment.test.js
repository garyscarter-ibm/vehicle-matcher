import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createLifecycleAppointmentService, APPOINTMENT_HANDLER_ID } from '../gcsp/lifecycle/appointments/index.js';
import { createAppointmentRoutes } from '../gcsp/lifecycle/appointments/http.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { createLifecycleApprovalService } from '../gcsp/lifecycle/approvals/index.js';
import { createSyntheticOrderingStatus } from '../gcsp/adapters/synthetic-ordering-status.js';
import { createRenewalCaseService } from '../gcsp/cases/index.js';
import { createLifecycleDocumentService } from '../gcsp/lifecycle/documents/index.js';
import { createSyntheticDocumentStatus } from '../gcsp/adapters/synthetic-ordering-documents.js';
import { createSyntheticAppointments, createLiveAppointmentsStub, APPOINTMENT_CONSUMER, OPERATION_TYPES } from '../gcsp/adapters/synthetic-appointments.js';
import { createRealProducer } from './helpers/gcsp-lifecycle-approval.js';

const shapes = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-appointment-outcomes.json', import.meta.url), 'utf8'));
const SEED = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const seedValue = (key) => SEED.assumptions.find((a) => a.key === key).value;
const SLOTS = seedValue('lifecycle.appointments.slots.v1');
const DELAY = seedValue('lifecycle.appointments.confirmation.v1').confirmDelaySeconds;
const OWNERSHIP = seedValue('lifecycle.appointments.ownership.v1');
const OUTCOMES = seedValue('lifecycle.appointments.outcomes.v1');
const TIMING = seedValue('lifecycle.appointments.outcomeTiming.v1');
const ORDER = '7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f';
const HOUR = 3600; const DAY = 86400;
const STAGES = ['selection received', 'HR approval', 'sales-manager approval', 'sent to ordering'];

// The canonical seed read only through PolicyService; `mutate` patches an alternative value by key.
async function policyWith(mutate = () => {}) {
  const seed = structuredClone(SEED);
  mutate((key) => seed.assumptions.find((a) => a.key === key).value);
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}

// Injected FUCQ-111 stage port fixture: proves consumer mechanics only, never producer integration.
function stagePort() {
  const orders = new Map();
  return { orders, async read(context, { orderUuid }) {
    const order = orders.get(orderUuid); if (!order) return result('not-found', { resourceType: 'lifecycle' });
    const stages = order.stageList.map((stage, index) => ({ stage, state: index < order.approved ? 'approved' : index === order.approved ? 'pending' : 'not-started',
      at: index < order.approved ? '2026-11-05T09:00:00.000Z' : null, providerReference: index <= order.approved ? `SYN-STAGE-${index}` : null }));
    return ok({ contractVersion: 'lifecycle.stages.v1', runId: context.runId, orderUuid, employeeId: order.employeeId, policyVersion: 'gcsp-policy-v1',
      lifecycleRevision: order.revision, stageList: order.stageList, currentStage: order.stageList[order.approved] ?? null, entitlementSlotId: 'slot-paula',
      renewalId: 'renewal:employee-paula', renewalAuthority: 'validated', stages, outcome: order.approved >= order.stageList.length ? 'sent-to-ordering' : 'in-progress' });
  }, async listOrders() { return ok({ orders: [...orders.keys()].map((orderUuid) => ({ orderUuid })) }); } };
}

// Wraps the synthetic adapter so a test can lose, delay or garble one call; `calls` records the order of provider calls.
function flaky(inner) {
  const f = { mode: inner.mode, contractVersion: inner.contractVersion, capability: inner.capability, calls: [], fault: {},
    offerSlots: (input) => inner.offerSlots(input) };
  for (const method of ['requestSlot', 'confirm', 'acceptProposal', 'complete', 'recordNoShow', 'reconcile']) {
    f[method] = async (...args) => {
      f.calls.push(method);
      const fault = f.fault[method]; delete f.fault[method];
      if (fault === 'lost') throw new Error('lost before the provider');
      if (fault === 'hang') return new Promise(() => {});
      if (fault === 'garbled') return { status: 'weird' };
      if (fault?.refuse) return fault.refuse;
      const outcome = await inner[method](...args);
      if (fault === 'throw-after') throw new Error('lost after the provider');
      return outcome;
    };
  }
  return f;
}

// `documents` composes the real FUCQ-116 service as the readiness port (counting its reads); `readiness` replaces it.
async function setup(t, { policy, live = false, stages = stagePort(), documents = false, readiness, slotSource } = {}) {
  policy ??= await policyWith();
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'appointments-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const alex = await identity.switchPrincipal(presenter.value.context, 'demo-alex', 'alex');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context: paula.value.context })).status, 'ok');
  const synthetic = createSyntheticAppointments({ repository });
  const provider = flaky(live ? createLiveAppointmentsStub() : synthetic);
  const port = typeof stages === 'function' ? await stages({ repository, clock, identity, policy }) : stages;
  let docs = null; const gate = { reads: 0 };
  if (documents) {
    docs = createLifecycleDocumentService({ repository, policy, clock, identity, lifecycleStages: port, provider: createSyntheticDocumentStatus({ repository }) });
    assert.equal((await docs.start()).status, 'ok');
    readiness = { readReadiness: (...args) => { gate.reads += 1; return docs.readReadiness(...args); } };
  }
  const deps = { repository, policy, clock, identity, lifecycleStages: port, readiness };
  const service = createLifecycleAppointmentService({ ...deps, provider, ...(slotSource ? { slotSource } : {}) });
  assert.equal((await service.start()).status, 'ok');
  t.after(() => repository.close());
  const p = presenter.value.context; let n = 0;
  const tick = async () => {
    const now = await clock.now(p); const eventId = `tick-${++n}`;
    const outcome = await clock.tick(p, { eventId, expectedClockVersion: now.value.clockVersion, inputDigest: inputDigest(eventId) });
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value;
  };
  const advance = async (bySeconds) => {
    const now = await clock.now(p);
    assert.equal((await clock.advance(p, { commandId: `advance-${++n}`, expectedClockVersion: now.value.clockVersion, bySeconds })).status, 'ok');
  };
  const order = (patch = {}) => stages.orders.set(ORDER, { employeeId: 'employee-paula', stageList: STAGES, approved: 4, revision: 4, ...patch });
  const now = async () => (await clock.now(p)).value.now;
  return { repository, store, clock, identity, service, stages, provider, synthetic, tick, advance, order, now, presenter: p, paula: paula.value.context,
    alex: alex.value.context, greg: greg.value.context, sessions: { paula, alex, greg, presenter }, docs, gate, deps };
}
const read = async (f, context = f.paula) => { const r = await f.service.read(context, { orderUuid: ORDER }); assert.equal(r.status, 'ok', JSON.stringify(r)); return r.value; };
const request = (f, slotId, context = f.paula) => f.service.request(context, { orderUuid: ORDER, slotId });
const offered = async (f) => (await read(f)).offeredSlots;
const receipts = async (f, consumerId = APPOINTMENT_CONSUMER) => (await f.repository.query(f.paula, 'event_receipts', { consumerId })).value;
const operations = async (f, step) => (await f.repository.query(f.paula, 'pending_operations', { operationType: OPERATION_TYPES[step] })).value;
const handled = (tickValue) => tickValue.outcomes.find((o) => o.handlerId === APPOINTMENT_HANDLER_ID).outcome;

test('a request is refused until the order is sent to ordering; slots then follow the policy keys', async (t) => {
  const f = await setup(t);
  assert.equal((await f.service.read(f.paula, { orderUuid: ORDER })).status, 'not-found');
  f.order({ approved: 3, revision: 3 });
  const early = await read(f);
  assert.deepEqual([early.state, early.booked, early.eligibility.eligible, early.offeredSlots, early.owner, early.nextStep],
    ['not-requested', false, false, [], OWNERSHIP.ineligible.owner, OWNERSHIP.ineligible.nextStep]);
  const refused = await request(f, 'slot-20261107T0900Z');
  assert.deepEqual([refused.status, refused.code], ['conflict', 'appointment-not-eligible']);
  assert.equal((await f.repository.query(f.paula, 'event_receipts', { consumerId: 'lifecycle-appointments:state:v1' })).value.length, 0);

  f.order();
  const open = await read(f);
  const today = Math.floor(Date.parse(await f.now()) / 86400000) * 86400000;
  assert.equal(open.eligibility.eligible, true);
  assert.equal(open.offeredSlots.length, SLOTS.daysOffered * SLOTS.dailyStartTimes.length);
  assert.equal(open.offeredSlots[0].start, new Date(today + SLOTS.earliestLeadDays * 86400000 + 9 * HOUR * 1000).toISOString());
  assert.ok(open.offeredSlots.every((s) => Date.parse(s.end) - Date.parse(s.start) === SLOTS.slotMinutes * 60000));
  assert.deepEqual([open.owner, open.nextStep], [OWNERSHIP.states['not-requested'].owner, OWNERSHIP.states['not-requested'].nextStep]);
  assert.deepEqual([open.fictional, open.provider, open.policyVersion], [true, { mode: 'synthetic', synthetic: true }, 'gcsp-policy-v1']);

  assert.equal((await request(f, 'slot-nope')).status, 'invalid');
  assert.equal((await f.service.request(f.paula, { orderUuid: ORDER, slotId: open.offeredSlots[0].slotId, employeeId: 'employee-alex' })).status, 'invalid');
  assert.equal((await f.service.read(f.paula, { orderUuid: ORDER, runId: 'other' })).status, 'invalid');
  assert.equal((await f.service.request(f.paula, { orderUuid: ORDER })).status, 'invalid');

  const other = await setup(t, { policy: await policyWith((get) => Object.assign(get('lifecycle.appointments.slots.v1'),
    { earliestLeadDays: 3, daysOffered: 2, slotMinutes: 30, dailyStartTimes: ['10:00'] })) });
  other.order();
  const changed = await offered(other);
  assert.deepEqual(changed.map((s) => [s.start.slice(11, 16), Date.parse(s.end) - Date.parse(s.start)]), [['10:00', 1800000], ['10:00', 1800000]]);
  assert.equal(Date.parse(changed[0].start) - today, 3 * 86400000 + 10 * HOUR * 1000);

  const broken = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.ownership.v1').states.requested.owner = 'nobody'; }) });
  broken.order(); assert.equal((await broken.service.read(broken.paula, { orderUuid: ORDER })).status, 'unavailable');
});

test('requested is never booked; the tick schedules it only after the keyed delay, and each state keeps its time and reference', async (t) => {
  const f = await setup(t); f.order();
  const [slot] = await offered(f);
  const requestedAt = await f.now();
  const made = await request(f, slot.slotId); assert.equal(made.status, 'ok', JSON.stringify(made));
  assert.deepEqual([made.value.state, made.value.booked, made.value.slot, made.value.requestedSlot, made.value.pending, made.value.blocked, made.value.offeredSlots],
    ['requested', false, null, slot, null, null, []]);
  assert.deepEqual([made.value.owner, made.value.nextStep], [OWNERSHIP.states.requested.owner, OWNERSHIP.states.requested.nextStep]);
  assert.equal(made.value.history.length, 1);
  assert.deepEqual([made.value.history[0].state, made.value.history[0].at], ['requested', requestedAt]);
  assert.match(made.value.history[0].providerReference, /^SYN-APT-[0-9A-F]{12}$/);

  assert.equal(handled(await f.tick()).status, 'ok');
  await f.advance(DELAY - 1); await f.tick();
  let view = await read(f);
  assert.deepEqual([view.state, view.booked, view.slot], ['requested', false, null]);
  assert.equal((await receipts(f)).length, 1, 'only the request is receipted before the delay');

  await f.advance(1);
  const confirmedAt = await f.now();
  const summary = handled(await f.tick());
  assert.deepEqual([summary.status, summary.value.applied, summary.value.failed], ['ok', 1, []]);
  view = await read(f);
  assert.deepEqual([view.state, view.booked, view.slot, view.owner, view.nextStep], ['scheduled', true, slot, OWNERSHIP.states.scheduled.owner, OWNERSHIP.states.scheduled.nextStep]);
  assert.deepEqual(view.history.map((h) => [h.state, h.at]), [['requested', requestedAt], ['scheduled', confirmedAt]]);
  assert.ok(view.history.every((h) => /^SYN-APT-/.test(h.providerReference)));
  assert.notEqual(view.history[0].providerReference, view.history[1].providerReference);
  await f.tick();
  assert.equal((await receipts(f)).length, 2, 'request and confirmation are each receipted once');
  assert.equal((await operations(f, 'confirm')).length, 1);
});

test('repeating the same request returns the same appointment with no new write; another slot is a conflict', async (t) => {
  const f = await setup(t); f.order();
  const slots = await offered(f);
  const first = await request(f, slots[0].slotId);
  const again = await request(f, slots[0].slotId);
  assert.deepEqual(again, first);
  assert.equal((await request(f, slots[1].slotId)).status, 'conflict');
  assert.deepEqual([(await operations(f, 'request')).length, (await receipts(f)).length], [1, 1]);
  await f.advance(DELAY); await f.tick();
  const booked = await request(f, slots[0].slotId);
  assert.deepEqual([booked.status, booked.value.state, booked.value.booked], ['ok', 'scheduled', true]);
  assert.deepEqual([(await operations(f, 'request')).length, (await receipts(f)).length], [1, 2]);
});

test('a proposed change needs Paula\'s acceptance before it is scheduled', async (t) => {
  const f = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); f.order();
  const [slot] = await offered(f);
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: 'x' })).status, 'not-found');
  await request(f, slot.slotId);
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: 'x' })).status, 'conflict');
  await f.advance(DELAY); await f.tick();
  let view = await read(f);
  assert.deepEqual([view.state, view.booked, view.slot, view.owner, view.nextStep], ['change-proposed', false, null, OWNERSHIP.states['change-proposed'].owner, OWNERSHIP.states['change-proposed'].nextStep]);
  assert.notEqual(view.proposedSlot.slotId, slot.slotId);
  assert.equal(Date.parse(view.proposedSlot.start) > Date.parse(slot.start), true);
  assert.equal(view.history.at(-1).state, 'change-proposed'); assert.match(view.history.at(-1).providerReference, /^SYN-APT-/);
  await f.advance(DELAY); await f.tick(); await f.tick();
  assert.equal((await read(f)).state, 'change-proposed', 'no tick accepts the change on Paula\'s behalf');
  assert.equal((await operations(f, 'accept')).length, 0);

  assert.equal((await f.service.acceptChange(f.alex, { orderUuid: ORDER, proposalId: view.proposalId })).status, 'forbidden');
  assert.equal((await f.service.acceptChange(f.greg, { orderUuid: ORDER, proposalId: view.proposalId })).status, 'forbidden');
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: 'other' })).status, 'invalid');
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: view.proposalId, runId: 'r' })).status, 'invalid');
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER })).status, 'invalid');
  const accepted = await f.service.acceptChange(f.paula, { orderUuid: ORDER, providerReference: view.proposalId });
  assert.equal(accepted.status, 'ok', JSON.stringify(accepted));
  view = accepted.value;
  assert.deepEqual([view.state, view.booked, view.slot.slotId], ['scheduled', true, view.proposedSlot.slotId]);
  assert.deepEqual(view.history.map((h) => h.state), ['requested', 'change-proposed', 'scheduled']);
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: view.proposalId })).status, 'ok');
  assert.equal((await receipts(f)).length, 3, 'request, proposal and acceptance are each receipted once');
});

test('the live stub reports unsupported and changes nothing; a refused write or acceptance leaves the state and shows why', async (t) => {
  const live = await setup(t, { live: true }); live.order();
  const view = await read(live);
  assert.deepEqual([view.offeredSlots, view.blocked.code, view.owner, view.provider.mode, view.provider.synthetic],
    [[], 'live-appointments-unsupported', OWNERSHIP.blocked.owner, 'live', false]);
  const refused = await request(live, 'slot-20261107T0900Z');
  assert.deepEqual([refused.status, refused.code], ['unsupported', 'live-appointments-unsupported']);
  assert.match(refused.reason, /not connected/);
  await live.advance(DELAY); await live.tick();
  assert.deepEqual([(await live.repository.query(live.paula, 'event_receipts', { consumerId: 'lifecycle-appointments:state:v1' })).value.length,
    (await operations(live, 'request')).length, (await receipts(live)).length], [0, 0, 0]);
  const stub = createLiveAppointmentsStub();
  for (const write of ['requestSlot', 'confirm', 'acceptProposal']) assert.equal((await stub[write]({})).code, 'live-appointments-unsupported');

  // The provider takes offers but refuses the request write: the order is not asked to hold a slot that was not taken.
  const f = await setup(t); f.order();
  const [slot] = await offered(f);
  f.provider.fault.requestSlot = { refuse: { status: 'unsupported', code: 'live-appointments-unsupported', reason: 'Booking is not connected.' } };
  const blocked = await request(f, slot.slotId);
  assert.deepEqual([blocked.status, blocked.appointment.state, blocked.appointment.booked, blocked.appointment.blocked.reason, blocked.appointment.owner],
    ['unsupported', 'not-requested', false, 'Booking is not connected.', OWNERSHIP.blocked.owner]);
  assert.equal((await receipts(f)).length, 0);
  assert.equal((await operations(f, 'request'))[0].lastKnownState, 'unsupported');
  await f.advance(DELAY); await f.tick();
  assert.deepEqual([(await read(f)).state, (await receipts(f)).length], ['not-requested', 0]);
  assert.equal((await request(f, slot.slotId)).status, 'ok', 'a repeat shows the same blocked appointment without another call');
  assert.equal(f.provider.calls.filter((c) => c === 'requestSlot').length, 1);

  const g = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); g.order();
  await request(g, (await offered(g))[0].slotId); await g.advance(DELAY); await g.tick();
  const proposal = (await read(g)).proposalId;
  g.provider.fault.acceptProposal = { refuse: { status: 'unsupported', code: 'live-appointments-unsupported', reason: 'Acceptance is not connected.' } };
  const stuck = await g.service.acceptChange(g.paula, { orderUuid: ORDER, proposalId: proposal });
  assert.deepEqual([stuck.status, stuck.reason, stuck.appointment.state, stuck.appointment.booked], ['unsupported', 'Acceptance is not connected.', 'change-proposed', false]);
  assert.equal((await g.service.acceptChange(g.paula, { orderUuid: ORDER, proposalId: proposal })).status, 'unsupported');
  assert.equal(g.provider.calls.filter((c) => c === 'acceptProposal').length, 1);
  assert.equal((await receipts(g)).length, 2);
});

test('an uncertain confirmation stays pending under the same key and is reconciled before any retry', async (t) => {
  const f = await setup(t); f.order();
  await request(f, (await offered(f))[0].slotId); await f.advance(DELAY);
  f.provider.fault.confirm = 'throw-after';
  await f.tick();
  const [before] = await operations(f, 'confirm');
  let view = await read(f);
  assert.deepEqual([view.state, view.booked, view.pending?.step, view.owner, view.nextStep], ['requested', false, 'confirm', OWNERSHIP.pending.owner, OWNERSHIP.pending.nextStep]);
  assert.equal(before.lastKnownState, 'unknown'); assert.equal((await receipts(f)).length, 2, 'the provider did record the confirmation');
  f.provider.calls.length = 0;
  await f.tick();
  assert.deepEqual(f.provider.calls, ['reconcile'], 'reconciled first, and the found outcome means no second confirm');
  view = await read(f);
  assert.deepEqual([view.state, view.booked, view.pending], ['scheduled', true, null]);
  const [after] = await operations(f, 'confirm');
  assert.deepEqual([after.operationId, after.idempotencyKey, after.state], [before.operationId, before.idempotencyKey, 'completed']);
  assert.equal((await receipts(f)).length, 2, 'exactly one confirmation receipt');

  // A call lost before the provider saw it is not-found on reconcile, so the same write is then retried once.
  const g = await setup(t); g.order();
  await request(g, (await offered(g))[0].slotId); await g.advance(DELAY);
  g.provider.fault.confirm = 'lost'; await g.tick();
  assert.equal((await read(g)).pending.step, 'confirm');
  g.provider.calls.length = 0; await g.tick();
  assert.deepEqual(g.provider.calls, ['reconcile', 'confirm']);
  assert.deepEqual([(await read(g)).state, (await receipts(g)).length, (await operations(g, 'confirm')).length], ['scheduled', 2, 1]);

  // A timeout (policy bound) and an unknown status are uncertain too, never booked.
  const h = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.confirmation.v1').providerTimeoutMs = 20; }) }); h.order();
  await request(h, (await offered(h))[0].slotId); await h.advance(DELAY);
  h.provider.fault.confirm = 'hang'; await h.tick();
  assert.deepEqual([(await read(h)).booked, (await read(h)).pending.step], [false, 'confirm']);
  h.provider.fault.reconcile = 'garbled'; await h.tick();
  assert.deepEqual([(await read(h)).booked, (await read(h)).pending.step], [false, 'confirm']);
  await h.tick();
  assert.deepEqual([(await read(h)).state, (await receipts(h)).length], ['scheduled', 2]);
});

test('an uncertain request and an uncertain acceptance reconcile on the next tick without a second write', async (t) => {
  const f = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); f.order();
  f.provider.fault.requestSlot = 'throw-after';
  const made = await request(f, (await offered(f))[0].slotId);
  assert.deepEqual([made.status, made.value.state, made.value.booked, made.value.pending.step, made.value.owner], ['ok', 'not-requested', false, 'request', OWNERSHIP.pending.owner]);
  f.provider.calls.length = 0; await f.tick();
  assert.deepEqual(f.provider.calls, ['reconcile']);
  assert.deepEqual([(await read(f)).state, (await read(f)).pending], ['requested', null]);
  await f.advance(DELAY); await f.tick();
  const proposal = (await read(f)).proposalId;
  f.provider.fault.acceptProposal = 'throw-after';
  const pending = await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: proposal });
  assert.deepEqual([pending.status, pending.value.state, pending.value.booked, pending.value.pending.step], ['ok', 'change-proposed', false, 'accept']);
  assert.equal((await f.service.acceptChange(f.paula, { orderUuid: ORDER, proposalId: proposal })).value.pending.step, 'accept');
  assert.equal(f.provider.calls.filter((c) => c === 'acceptProposal').length, 1);
  f.provider.calls.length = 0; await f.tick();
  assert.deepEqual(f.provider.calls, ['reconcile']);
  assert.deepEqual([(await read(f)).state, (await read(f)).booked, (await receipts(f)).length], ['scheduled', true, 3]);
});

test('another employee is refused, greg and the presenter can read, and browser identity is ignored', async (t) => {
  const f = await setup(t); f.order();
  const [slot] = await offered(f);
  assert.equal((await f.service.read(f.alex, { orderUuid: ORDER })).status, 'forbidden');
  assert.equal((await request(f, slot.slotId, f.alex)).status, 'forbidden');
  assert.equal((await request(f, slot.slotId, f.greg)).status, 'forbidden');
  await request(f, slot.slotId);
  assert.equal((await f.service.read(f.alex, { orderUuid: ORDER })).status, 'forbidden');
  assert.equal((await request(f, slot.slotId, f.alex)).status, 'forbidden');
  for (const context of [f.greg, f.presenter]) assert.deepEqual([(await read(f, context)).state, (await read(f, context)).employeeId], ['requested', 'employee-paula']);
  assert.equal((await read(f)).runId, f.paula.runId);
  assert.equal((await f.service.read(f.alex, { orderUuid: ORDER, employeeId: 'employee-paula' })).status, 'invalid');
});

test('a startup tick only reconciles: it never confirms or retries, while a presenter tick does', async (t) => {
  const f = await setup(t); f.order();
  await request(f, (await offered(f))[0].slotId); await f.advance(DELAY);
  assert.equal((await f.clock.reconcileStartup()).status, 'ok');
  assert.deepEqual([(await read(f)).state, (await receipts(f)).length, f.provider.calls.includes('confirm')], ['requested', 1, false]);
  await f.tick();
  assert.equal((await read(f)).state, 'scheduled');

  // An uncertain write that the provider did record is applied on startup; one it never saw is left for a presenter tick.
  const g = await setup(t); g.order();
  await request(g, (await offered(g))[0].slotId); await g.advance(DELAY);
  g.provider.fault.confirm = 'throw-after'; await g.tick();
  g.provider.calls.length = 0;
  assert.equal((await g.clock.reconcileStartup()).status, 'ok');
  assert.deepEqual([(await read(g)).state, g.provider.calls], ['scheduled', ['reconcile']]);

  const h = await setup(t); h.order();
  await request(h, (await offered(h))[0].slotId); await h.advance(DELAY);
  h.provider.fault.confirm = 'lost'; await h.tick(); h.provider.calls.length = 0;
  assert.equal((await h.clock.reconcileStartup()).status, 'ok');
  assert.deepEqual([(await read(h)).state, (await read(h)).pending.step, h.provider.calls], ['requested', 'confirm', ['reconcile']]);
  await h.tick();
  assert.equal((await read(h)).state, 'scheduled');
});

test('real FUCQ-111 stage port: refused until the order is sent to ordering, then requested and scheduled', async (t) => {
  const policy = await policyWith();
  const f = await setup(t, { policy, stages: ({ repository, clock, identity }) => {
    const approvals = createLifecycleApprovalService({ repository, policy, clock, identity, status: createSyntheticOrderingStatus({ repository }) });
    return approvals.start().then((started) => { assert.equal(started.status, 'ok'); return approvals.stagePort(); });
  } });
  assert.equal((await seedManualDemoContext({ repository: f.repository, identity: f.identity, clock: f.clock, context: f.alex })).status, 'ok');
  const producer = await createRealProducer({ repository: f.repository, policy, clock: f.clock, identity: f.identity });
  const { submitted, orderUuid } = await producer.submit(f.paula, { id: 911, type: 'cart' });
  assert.equal(submitted.status, 'ok', JSON.stringify(submitted));
  const view = async (context = f.paula) => (await f.service.read(context, { orderUuid })).value;
  assert.equal((await view()).eligibility.eligible, false);
  const early = await f.service.request(f.paula, { orderUuid, slotId: 'slot-20261107T0900Z' });
  assert.deepEqual([early.status, early.code], ['conflict', 'appointment-not-eligible']);
  for (let i = 0; i < 16 && !(await view()).eligibility.eligible; i += 1) { await f.advance(HOUR); await f.tick(); }
  const open = await view();
  assert.equal(open.eligibility.eligible, true, 'the real approval lifecycle reached sent to ordering');
  assert.equal((await f.service.read(f.alex, { orderUuid })).status, 'forbidden');
  assert.equal((await f.service.request(f.alex, { orderUuid, slotId: open.offeredSlots[0].slotId })).status, 'forbidden');
  const made = await f.service.request(f.paula, { orderUuid, slotId: open.offeredSlots[0].slotId });
  assert.deepEqual([made.status, made.value.state, made.value.booked], ['ok', 'requested', false]);
  await f.advance(DELAY); await f.tick();
  const done = await view();
  assert.deepEqual([done.state, done.booked, done.slot, done.history.map((h) => h.state)], ['scheduled', true, open.offeredSlots[0], ['requested', 'scheduled']]);
});

// A route caller bound to the real shared handler; sessions come from setup, never from the request.
const http = (f) => {
  const handler = createGcspHandler({ identity: f.identity, routes: createAppointmentRoutes(f.service), allowedOrigins: ['https://appointments.test'] });
  const cookie = (session) => [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  return async (path, { body, session = f.sessions.paula, query = '' } = {}) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method: body ? 'POST' : 'GET', headers: { origin: 'https://appointments.test', cookie: cookie(session) } });
    let sent; const res = { setHeader() {} };
    await handler({ req, res, pathname: `/api/gcsp${path}`, searchParams: new URLSearchParams(query), sendJson: (r, code, value) => { sent = { code, value }; } });
    return sent;
  };
};

test('/api/gcsp appointment routes request, read and accept as the server-owned employee and ignore browser identity', async (t) => {
  const f = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); f.order();
  const call = http(f);
  const early = await call('/appointments', { query: `orderUuid=${ORDER}&employeeId=employee-alex&runId=other` });
  assert.deepEqual([early.code, early.value.value.employeeId, early.value.value.runId], [200, 'employee-paula', f.paula.runId], 'forged query identity is stripped');
  const open = await call('/appointments', { query: `orderUuid=${ORDER}` });
  assert.equal(open.code, 200); assert.equal(open.value.value.state, 'not-requested');
  const [slot] = open.value.value.offeredSlots;
  const asked = await call('/appointments/request', { body: { orderUuid: ORDER, slotId: slot.slotId, employeeId: 'employee-alex', runId: 'other', roles: ['presenter'] } });
  assert.equal(asked.code, 200, JSON.stringify(asked));
  assert.deepEqual([asked.value.value.state, asked.value.value.booked, asked.value.value.employeeId, asked.value.value.runId],
    ['requested', false, 'employee-paula', f.paula.runId]);
  assert.deepEqual((await call('/appointments/request', { body: { orderUuid: ORDER, slotId: slot.slotId } })).value, asked.value, 'repeat returns the same appointment');
  assert.deepEqual((await call('/appointments', { query: `orderUuid=${ORDER}` })).value.value, asked.value.value);
  assert.equal((await call('/appointments', { session: f.sessions.alex, query: `orderUuid=${ORDER}` })).code, 403);
  assert.equal((await call('/appointments/request', { session: f.sessions.alex, body: { orderUuid: ORDER, slotId: slot.slotId } })).code, 403);
  assert.equal((await call('/appointments', { session: f.sessions.greg, query: `orderUuid=${ORDER}` })).code, 200);
  assert.equal((await call('/appointments', { query: 'other=1' })).code, 400);

  await f.advance(DELAY); await f.tick();
  const proposed = (await call('/appointments', { query: `orderUuid=${ORDER}` })).value.value;
  assert.deepEqual([proposed.state, proposed.booked], ['change-proposed', false]);
  assert.equal((await call('/appointments/accept', { session: f.sessions.alex, body: { orderUuid: ORDER, proposalId: proposed.proposalId } })).code, 403);
  const accepted = await call('/appointments/accept', { body: { orderUuid: ORDER, proposalId: proposed.proposalId, employeeId: 'employee-alex' } });
  assert.equal(accepted.code, 200, JSON.stringify(accepted));
  assert.deepEqual([accepted.value.value.state, accepted.value.value.booked, accepted.value.value.employeeId], ['scheduled', true, 'employee-paula']);
});

// Recorded response shapes for the later appointment screen (FUCQ-120); no screen in this story.
test('recorded appointment response shapes match real service output, with owners and next steps from policy', async (t) => {
  const keys = (v) => Object.keys(v).sort();
  const f = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.confirmation.v1').providerTimeoutMs = 20; }) }); f.order();
  const seeded = { 'not-requested': OWNERSHIP.states['not-requested'], requested: OWNERSHIP.states.requested, 'change-proposed': OWNERSHIP.states['change-proposed'],
    pending: OWNERSHIP.pending, scheduled: OWNERSHIP.states.scheduled };
  for (const [name, want] of Object.entries(seeded)) assert.deepEqual([shapes.states[name].owner, shapes.states[name].nextStep], [want.owner, want.nextStep], `fixture ${name} matches the policy seed`);
  const expectShape = (view, name) => {
    const want = shapes.states[name];
    assert.deepEqual(keys(view), [...shapes.readModelKeys].sort(), name);
    assert.deepEqual([view.state, view.booked, view.owner, view.nextStep], [want.state, want.booked, want.owner, want.nextStep], name);
    assert.deepEqual([view.pending?.step ?? null, view.blocked?.code ?? null], [want.pendingStep, want.blockedCode], name);
    assert.deepEqual(view.history.map((h) => h.state), want.history, name);
    for (const h of view.history) assert.deepEqual(keys(h), [...shapes.historyKeys].sort());
  };
  const [slot] = await offered(f);
  expectShape(await read(f), 'not-requested');
  const requested = (await request(f, slot.slotId)).value;
  expectShape(requested, 'requested');
  assert.deepEqual([requested.owner, requested.nextStep], [OWNERSHIP.states.requested.owner, OWNERSHIP.states.requested.nextStep]);
  await f.advance(DELAY); f.provider.fault.confirm = 'hang'; await f.tick();
  const pending = await read(f); expectShape(pending, 'pending');
  assert.deepEqual([pending.owner, pending.nextStep], [OWNERSHIP.pending.owner, OWNERSHIP.pending.nextStep]);
  assert.deepEqual(keys(pending.pending), [...shapes.pendingKeys].sort());
  await f.tick(); const scheduled = await read(f); expectShape(scheduled, 'scheduled');
  assert.deepEqual([scheduled.owner, scheduled.nextStep], [OWNERSHIP.states.scheduled.owner, OWNERSHIP.states.scheduled.nextStep]);
  assert.deepEqual(keys(scheduled.slot), [...shapes.slotKeys].sort());

  const g = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); g.order();
  await request(g, (await offered(g))[0].slotId); await g.advance(DELAY); await g.tick();
  const proposed = await read(g); expectShape(proposed, 'change-proposed');
  assert.deepEqual([proposed.owner, proposed.nextStep], [OWNERSHIP['states']['change-proposed'].owner, OWNERSHIP['states']['change-proposed'].nextStep]);
  assert.deepEqual(keys(proposed.proposedSlot), [...shapes.slotKeys].sort());

  const live = await setup(t, { live: true }); live.order();
  const unsupported = await request(live, 'slot-20261107T0900Z');
  assert.equal(unsupported.status, shapes.unsupported.status); assert.equal(unsupported.code, shapes.unsupported.code);
  assert.deepEqual(keys(unsupported), [...shapes.unsupported.keys].sort());
  assert.equal(typeof unsupported.reason, 'string');
  const h = await setup(t); h.order();
  h.provider.fault.requestSlot = { refuse: { status: 'unsupported', code: shapes.unsupported.code, reason: 'Booking is not connected.' } };
  const refused = await request(h, (await offered(h))[0].slotId);
  assert.deepEqual(keys(refused), [...shapes.unsupported.keysWhenProviderRefusesAfterOffering].sort());
  assert.deepEqual([refused.appointment.owner, refused.appointment.nextStep, refused.appointment.booked], [OWNERSHIP.blocked.owner, OWNERSHIP.blocked.nextStep, false]);
});

// Terminal outcomes (FUCQ-167): completion is gated by the real FUCQ-116 readiness read.
const complete = (f, context = f.presenter, input = { orderUuid: ORDER }) => f.service.complete(context, input);
const ACK = { commandId: 'ack', orderUuid: ORDER, itemId: 'agreement-acknowledgement', acknowledgement: 'synthetic' };
async function scheduled(f) {
  f.order(); await request(f, (await offered(f))[0].slotId); await f.advance(DELAY); await f.tick();
  assert.equal((await read(f)).state, 'scheduled');
}
async function ready(f) {
  await f.advance(2 * DAY); await f.tick();
  assert.equal((await f.docs.completeTask(f.paula, ACK)).status, 'ok');
  assert.equal((await f.docs.readReadiness(f.greg, { orderUuid: ORDER })).value.ready, true);
}
// FUCQ-260: a scheduled handover at the keyed earliest no-show time.
async function missable(f) { await scheduled(f); await atSlot(f, TIMING.noShowAfterSlotStartSeconds); }
// FUCQ-260: advance the demo clock to the booked slot start plus the keyed offset (an outcome is refused before it).
async function atSlot(f, offset = 0) {
  const by = (Date.parse((await read(f)).slot.start) - Date.parse(await f.now())) / 1000 + offset;
  if (by > 0) await f.advance(by);
}

test('completion is refused until documents and car readiness are complete, then records the outcome once', async (t) => {
  const f = await setup(t, { documents: true }); await scheduled(f);
  const early = await complete(f);
  assert.deepEqual([early.status, early.code, early.owner, early.nextStep, early.reason], ['conflict', 'handover-not-ready', OUTCOMES.notReady.owner, OUTCOMES.notReady.nextStep, OUTCOMES.notReady.nextStep]);
  assert.deepEqual([early.readiness.state, early.readiness.documentsComplete, early.readiness.vehicleReady], ['waiting', false, false]);
  assert.ok(early.readiness.blocking.includes('vehicle-preparation'));
  assert.deepEqual([early.appointment.state, early.appointment.booked, early.appointment.outcome], ['scheduled', true, null]);
  assert.deepEqual([(await operations(f, 'complete')).length, (await receipts(f)).length], [0, 2], 'a refused completion writes nothing');

  await f.advance(2 * DAY); await f.tick();
  const partial = await complete(f);
  assert.deepEqual([partial.code, partial.readiness.documentsComplete, partial.readiness.vehicleReady, partial.readiness.blocking], ['handover-not-ready', false, true, ['agreement-acknowledgement']]);
  assert.equal((await f.docs.completeTask(f.paula, ACK)).status, 'ok');

  const at = await f.now();
  const done = await complete(f, f.greg); assert.equal(done.status, 'ok', JSON.stringify(done));
  const view = done.value;
  assert.deepEqual([view.state, view.booked, view.owner, view.nextStep, view.pending, view.blocked], ['completed', false, OUTCOMES.states.completed.owner, OUTCOMES.states.completed.nextStep, null, null]);
  assert.deepEqual([view.outcome.state, view.outcome.at], ['completed', at]);
  assert.match(view.outcome.providerReference, /^SYN-APT-[0-9A-F]{12}$/);
  assert.deepEqual(view.history.map((h) => h.state), ['requested', 'scheduled', 'completed']);
  assert.equal(view.history[2].at, at);
  assert.equal(view.history[2].providerReference, view.outcome.providerReference);
  assert.ok(view.assumptions.some((a) => a.key === 'lifecycle.appointments.outcomes.v1'));
  const [op] = await operations(f, 'complete');
  assert.deepEqual([op.state, op.payload.completedAt, op.payload.readiness.documentsRevision > 0, op.idempotencyKey], ['completed', at, true, op.operationId]);

  const again = await complete(f, f.presenter);
  assert.deepEqual(again, done, 'a repeat returns the same outcome');
  assert.deepEqual([(await receipts(f)).length, f.provider.calls.filter((c) => c === 'complete').length, (await operations(f, 'complete')).length], [3, 1, 1]);
  const paulaView = await read(f);
  assert.deepEqual([paulaView.state, paulaView.outcome, paulaView.owner], ['completed', view.outcome, 'employee']);
  await f.tick(); await f.tick();
  assert.deepEqual([(await read(f)).outcome, (await receipts(f)).length], [view.outcome, 3], 'later ticks leave the outcome alone');
});

test('completion is unavailable without a working readiness port and refused when not scheduled or malformed', async (t) => {
  const none = await setup(t); await scheduled(none);
  const missing = await complete(none);
  assert.deepEqual([missing.status, missing.code, missing.retryable], ['unavailable', 'handover-readiness-unavailable', true]);
  assert.equal(typeof missing.reason, 'string');
  const bad = [async () => { throw new Error('documents down'); }, async () => result('unavailable', { retryable: true }), async () => result('forbidden', {})];
  for (const readReadiness of bad) {
    const broken = await setup(t, { readiness: { readReadiness } }); await scheduled(broken);
    assert.deepEqual([(await complete(broken)).code, (await complete(broken)).status], ['handover-readiness-unavailable', 'unavailable']);
    assert.deepEqual([(await operations(broken, 'complete')).length, (await receipts(broken)).length, (await read(broken)).state], [0, 2, 'scheduled']);
  }

  const f = await setup(t, { documents: true });
  assert.equal((await complete(f)).status, 'not-found');
  f.order(); await request(f, (await offered(f))[0].slotId);
  const requested = await complete(f);
  assert.deepEqual([requested.status, requested.code], ['conflict', 'appointment-not-scheduled']);
  assert.equal(f.gate.reads, 0, 'the gate is not consulted for an appointment that is not scheduled');
  await f.advance(DELAY); await f.tick();
  for (const input of [{}, { orderUuid: ORDER, runId: 'other' }, { orderUuid: ORDER, employeeId: 'employee-alex' }, { orderUuid: 7 }]) assert.equal((await complete(f, f.presenter, input)).status, 'invalid');

  const proposing = await setup(t, { documents: true, policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); proposing.order();
  await request(proposing, (await offered(proposing))[0].slotId); await proposing.advance(DELAY); await proposing.tick();
  assert.deepEqual([(await read(proposing)).state, (await complete(proposing)).code], ['change-proposed', 'appointment-not-scheduled']);

  // The return purpose has no terminal outcomes: it never writes and never reads readiness.
  const returned = createLifecycleAppointmentService({ ...f.deps, provider: f.provider, purpose: 'return' });
  const unsupported = await returned.complete(f.presenter, { orderUuid: ORDER });
  assert.deepEqual([unsupported.status, unsupported.code], ['unsupported', 'appointment-outcome-unsupported']);
  assert.deepEqual([(await operations(f, 'complete')).length, f.gate.reads], [0, 0]);
});

test('only greg or the presenter completes; the employee and other employees are forbidden', async (t) => {
  const f = await setup(t, { documents: true }); await scheduled(f); await ready(f);
  for (const context of [f.paula, f.alex]) assert.equal((await complete(f, context)).status, 'forbidden');
  assert.deepEqual([(await operations(f, 'complete')).length, (await read(f)).state, (await read(f, f.greg)).state], [0, 'scheduled', 'scheduled']);
  assert.equal((await complete(f, f.presenter)).status, 'ok');
  assert.equal((await f.service.read(f.alex, { orderUuid: ORDER })).status, 'forbidden', 'the outcome stays private to its employee');
  assert.equal((await read(f, f.greg)).state, 'completed');
  const other = await setup(t, { documents: true });
  assert.equal((await complete(other, other.presenter)).status, 'not-found', 'another run holds no such appointment');
});

test('a refused terminal write leaves the appointment scheduled; the live stub reports unsupported and records nothing', async (t) => {
  const f = await setup(t, { documents: true }); await scheduled(f); await ready(f);
  f.provider.fault.complete = { refuse: { status: 'unsupported', code: 'live-appointments-unsupported', reason: 'Completion is not connected.' } };
  const refused = await complete(f);
  assert.deepEqual([refused.status, refused.code, refused.reason, refused.appointment.state, refused.appointment.outcome, refused.appointment.owner],
    ['unsupported', 'live-appointments-unsupported', 'Completion is not connected.', 'scheduled', null, OWNERSHIP.blocked.owner]);
  assert.deepEqual([(await receipts(f)).length, (await operations(f, 'complete'))[0].lastKnownState], [2, 'unsupported']);
  assert.equal((await complete(f)).status, 'unsupported');
  assert.equal(f.provider.calls.filter((c) => c === 'complete').length, 1, 'a repeat shows the same blocked appointment without another call');

  // A live-mode service over the same stored appointment cannot complete it either.
  const g = await setup(t, { documents: true }); await scheduled(g); await ready(g);
  const live = createLifecycleAppointmentService({ ...g.deps, provider: createLiveAppointmentsStub() });
  const stuck = await live.complete(g.presenter, { orderUuid: ORDER });
  assert.deepEqual([stuck.status, stuck.code, stuck.appointment.state, stuck.appointment.provider.mode, stuck.appointment.outcome], ['unsupported', 'live-appointments-unsupported', 'scheduled', 'live', null]);
  assert.equal((await receipts(g)).length, 2);
  const stub = createLiveAppointmentsStub();
  for (const write of ['complete', 'recordNoShow']) assert.equal((await stub[write]({})).code, 'live-appointments-unsupported');
  assert.equal((await complete(g)).status, 'unsupported', 'the refusal stays recorded under the same operation');
});

for (const fault of ['lost', 'throw-after', 'hang']) {
  test(`an uncertain completion (${fault}) stays pending under one key and is reconciled before any retry`, async (t) => {
    const policy = () => policyWith((get) => { get('lifecycle.appointments.confirmation.v1').providerTimeoutMs = 20; });
    const recorded = fault === 'throw-after';
    const uncertain = async () => {
      const f = await setup(t, { documents: true, policy: await policy() }); await scheduled(f); await ready(f);
      f.provider.fault.complete = fault;
      const pending = await complete(f); assert.equal(pending.status, 'ok', JSON.stringify(pending));
      assert.deepEqual([pending.value.state, pending.value.booked, pending.value.pending.step, pending.value.outcome, pending.value.owner, pending.value.nextStep],
        ['scheduled', true, 'complete', null, OWNERSHIP.pending.owner, OWNERSHIP.pending.nextStep]);
      const [before] = await operations(f, 'complete');
      assert.deepEqual([before.lastKnownState, (await receipts(f)).length], ['unknown', recorded ? 3 : 2]);
      f.provider.calls.length = 0; f.gate.reads = 0;
      return { f, before };
    };
    const expectDone = async ({ f, before }, view) => {
      assert.deepEqual(f.provider.calls, recorded ? ['reconcile'] : ['reconcile', 'complete'], 'reconciled first; only not-found allows the same write again');
      assert.deepEqual([view.state, view.pending, view.outcome.state], ['completed', null, 'completed']);
      const after = await operations(f, 'complete');
      assert.deepEqual([after.length, after[0].operationId, after[0].idempotencyKey, after[0].state], [1, before.operationId, before.idempotencyKey, 'completed']);
      assert.equal((await receipts(f)).length, 3, 'exactly one completion receipt');
    };

    const viaRepeat = await uncertain();
    const repeated = await complete(viaRepeat.f); assert.equal(repeated.status, 'ok', JSON.stringify(repeated));
    assert.equal(viaRepeat.f.gate.reads, 0, 'a pending operation is reconciled without re-reading readiness');
    await expectDone(viaRepeat, repeated.value);

    const viaTick = await uncertain();
    const summary = handled(await viaTick.f.tick());
    assert.deepEqual([summary.status, summary.value.applied, summary.value.failed], ['ok', 1, []]);
    await expectDone(viaTick, await read(viaTick.f));
  });
}

test('a startup tick only reconciles an uncertain completion; the next presenter tick retries it', async (t) => {
  const f = await setup(t, { documents: true }); await scheduled(f); await ready(f);
  f.provider.fault.complete = 'lost';
  assert.equal((await complete(f)).value.pending.step, 'complete');
  f.provider.calls.length = 0;
  assert.equal((await f.clock.reconcileStartup()).status, 'ok');
  assert.deepEqual([(await read(f)).pending.step, f.provider.calls], ['complete', ['reconcile']], 'a startup tick never retries the write');
  await f.tick();
  assert.deepEqual([(await read(f)).state, (await receipts(f)).length], ['completed', 3]);
});

test('/api/gcsp/appointments/complete is gated, server-scoped and ignores browser identity', async (t) => {
  const f = await setup(t, { documents: true }); await scheduled(f);
  const call = http(f);
  const forged = { orderUuid: ORDER, employeeId: 'employee-alex', runId: 'other', roles: ['employee'] };
  assert.equal((await call('/appointments/complete', { body: { orderUuid: ORDER } })).code, 403, 'the employee cannot complete');
  assert.equal((await call('/appointments/complete', { session: f.sessions.alex, body: { orderUuid: ORDER } })).code, 403);
  const early = await call('/appointments/complete', { session: f.sessions.greg, body: forged });
  assert.deepEqual([early.code, early.value.code, early.value.readiness.documentsComplete], [409, 'handover-not-ready', false]);
  assert.deepEqual(Object.keys(early.value).sort(), [...shapes.notReady.keys].sort());
  assert.deepEqual(Object.keys(early.value.readiness).sort(), [...shapes.notReady.readinessKeys].sort());
  await ready(f);
  const done = await call('/appointments/complete', { session: f.sessions.presenter, body: forged });
  assert.equal(done.code, 200, JSON.stringify(done));
  assert.deepEqual([done.value.value.state, done.value.value.employeeId, done.value.value.runId, done.value.value.outcome.state], ['completed', 'employee-paula', f.paula.runId, 'completed']);
  assert.deepEqual((await call('/appointments/complete', { session: f.sessions.greg, body: { orderUuid: ORDER } })).value, done.value);
  assert.deepEqual((await call('/appointments', { query: `orderUuid=${ORDER}` })).value.value, done.value.value);
  assert.equal((await call('/appointments/complete', { session: f.sessions.greg, body: { orderUuid: ORDER, extra: 1 } })).code, 400);
});

test('the completed response shape and notReady refusal match the recorded fixture', async (t) => {
  const keys = (v) => Object.keys(v).sort();
  const want = shapes.states.completed;
  assert.deepEqual([want.owner, want.nextStep], [OUTCOMES.states.completed.owner, OUTCOMES.states.completed.nextStep]);
  const f = await setup(t, { documents: true }); await scheduled(f); await ready(f);
  const view = (await complete(f)).value;
  assert.deepEqual(keys(view), [...shapes.readModelKeys].sort());
  assert.deepEqual([view.state, view.booked, view.owner, view.nextStep, view.pending?.step ?? null, view.blocked?.code ?? null], [want.state, want.booked, want.owner, want.nextStep, want.pendingStep, want.blockedCode]);
  assert.deepEqual(view.history.map((h) => h.state), want.history);
  assert.deepEqual(keys(view.outcome), [...shapes.outcomeKeys].sort());
  for (const h of view.history) assert.deepEqual(keys(h), [...shapes.historyKeys].sort());
  const g = await setup(t, { documents: true }); await scheduled(g);
  const refused = await complete(g);
  assert.deepEqual([refused.status, refused.code, keys(refused), keys(refused.readiness)], [shapes.notReady.status, shapes.notReady.code, [...shapes.notReady.keys].sort(), [...shapes.notReady.readinessKeys].sort()]);
});

test('a missing or malformed outcomes policy makes the handover appointment unavailable with no defaults; a changed entry changes the copy', async (t) => {
  for (const mutate of [(v) => { delete v.notReady; }, (v) => { v.states.completed.owner = 'nobody'; }, (v) => { delete v.states['no-show']; }, (v) => { v.exceptionTypes.noShow = ''; },
    (v) => { v.states.completed.nextStep = 'Done — finished.'; }]) {
    const f = await setup(t, { documents: true, policy: await policyWith((get) => mutate(get('lifecycle.appointments.outcomes.v1'))) }); f.order();
    assert.equal((await f.service.read(f.paula, { orderUuid: ORDER })).status, 'unavailable');
  }
  const seedless = structuredClone(SEED);
  seedless.assumptions = seedless.assumptions.filter((a) => a.key !== 'lifecycle.appointments.outcomes.v1');
  const f = await setup(t, { documents: true, policy: new PolicyService({ provider: { async loadVersions() { return [seedless]; } } }) }); f.order();
  assert.equal((await f.service.read(f.paula, { orderUuid: ORDER })).status, 'unavailable');
  const g = await setup(t, { documents: true, policy: await policyWith((get) => { Object.assign(get('lifecycle.appointments.outcomes.v1').states.completed, { owner: 'scheme-team', nextStep: 'Handover recorded.' }); }) });
  await scheduled(g); await ready(g);
  const view = (await complete(g)).value;
  assert.deepEqual([view.owner, view.nextStep], ['scheme-team', 'Handover recorded.']);
});

// No-show and rebooking (FUCQ-167): the presenter records the miss; Paula then requests a new slot through the same request path.
const EXCEPTIONS = 'lifecycle-appointments:exceptions:v1';
const noShow = (f, context = f.presenter, input = { orderUuid: ORDER }) => f.service.recordNoShow(context, input);
const exceptions = (f) => receipts(f, EXCEPTIONS);
const NO_SHOW = OUTCOMES.states['no-show'];
const FACTS = ['employees', 'entitlement_slots', 'briefs', 'stock', 'holds', 'claims', 'quotes', 'offers', 'decisions'];
const allocation = (f) => JSON.stringify(FACTS.map((table) => f.store.state.tables[table]));

test('a presenter records a no-show: it reads no-show with its outcome and fresh slots, and the original exception receipt is written once', async (t) => {
  const f = await setup(t); await missable(f);
  const at = await f.now();
  const done = await noShow(f); assert.equal(done.status, 'ok', JSON.stringify(done));
  const view = done.value;
  assert.deepEqual([view.state, view.booked, view.owner, view.nextStep, view.pending, view.blocked, view.attempt, view.previousAttempts],
    ['no-show', false, NO_SHOW.owner, NO_SHOW.nextStep, null, null, 1, []]);
  assert.deepEqual([view.outcome.state, view.outcome.at], ['no-show', at]);
  assert.match(view.outcome.providerReference, /^SYN-APT-[0-9A-F]{12}$/);
  assert.deepEqual(view.history.map((h) => [h.state]), [['requested'], ['scheduled'], ['no-show']]);
  assert.deepEqual([view.history[2].at, view.history[2].providerReference], [at, view.outcome.providerReference]);
  assert.equal(view.offeredSlots.length, SLOTS.daysOffered * SLOTS.dailyStartTimes.length, 'Paula can choose a new slot');
  assert.deepEqual([view.eligibility.eligible, view.slot !== null], [true, true], 'the missed slot stays on the record');

  const [op] = await operations(f, 'noShow');
  assert.deepEqual([op.state, op.payload.noShowAt, op.payload.exceptionType, op.idempotencyKey], ['completed', at, OUTCOMES.exceptionTypes.noShow, op.operationId]);
  const list = await exceptions(f); assert.equal(list.length, 1);
  assert.deepEqual([list[0].eventId, list[0].eventType, list[0].handlerId, list[0].state], [op.operationId, 'appointment-no-show', APPOINTMENT_HANDLER_ID, 'completed']);
  assert.deepEqual(list[0].outcome.value, { employeeId: 'employee-paula', renewalId: 'renewal:employee-paula', orderUuid: ORDER, occurredAt: at, entitlementSlotId: 'slot-paula',
    renewalAuthority: 'validated', exceptionType: 'appointment-no-show', policyVersion: 'gcsp-policy-v1', providerReference: view.outcome.providerReference, attempt: 1, fictional: true });

  assert.deepEqual(await noShow(f, f.greg), done, 'a repeat returns the same outcome');
  await f.tick(); await f.tick();
  assert.deepEqual([(await exceptions(f)).length, (await receipts(f)).length, f.provider.calls.filter((c) => c === 'recordNoShow').length], [1, 3, 1]);
  assert.deepEqual([(await read(f)).state, (await read(f)).owner], ['no-show', NO_SHOW.owner]);
});

test('the no-show receipt is the original lifecycle exception that FUCQ-112 turns into a case for Paula\'s renewal, once', async (t) => {
  const f = await setup(t);
  const cases = createRenewalCaseService({ repository: f.repository, policy: f.deps.policy, clock: f.clock, identity: f.identity });
  assert.equal((await cases.start()).status, 'ok', 'registered in the same runtime before the first tick');
  await missable(f);
  assert.equal((await cases.readOwn(f.paula)).value.cases.length, 0, 'a scheduled handover raises nothing');
  assert.equal((await noShow(f)).status, 'ok');
  await f.tick();
  const opened = (await cases.readOwn(f.paula)).value.cases;
  assert.equal(opened.length, 1, JSON.stringify(opened));
  assert.deepEqual([opened[0].trigger.type, opened[0].trigger.eventType, opened[0].renewalId, opened[0].trigger.orderUuid],
    ['lifecycle-exception', 'appointment-no-show', 'renewal:employee-paula', ORDER]);
  await f.tick(); await f.tick();
  assert.equal((await cases.readOwn(f.paula)).value.cases.length, 1, 'later ticks open no second case');
  assert.equal((await f.service.recordNoShow(f.presenter, { orderUuid: ORDER })).status, 'ok');
  assert.equal((await exceptions(f)).length, 1);
});

test('a missing renewal authority is recorded as missing, never as the employee\'s default renewal', async (t) => {
  const f = await setup(t); await missable(f);
  const original = f.stages.read;
  f.stages.read = async (context, input) => {
    const r = await original(context, input);
    return r.status === 'ok' ? ok({ ...r.value, entitlementSlotId: null, renewalId: null, renewalAuthority: 'missing' }) : r;
  };
  assert.equal((await noShow(f)).status, 'ok');
  const [exc] = await exceptions(f);
  assert.deepEqual([exc.outcome.value.renewalId, exc.outcome.value.entitlementSlotId, exc.outcome.value.renewalAuthority], [null, null, 'missing']);
  const g = await setup(t); await missable(g);
  g.stages.read = async () => { throw new Error('stage producer down'); };
  assert.equal((await noShow(g)).status, 'unavailable', 'a failed authority read is returned as is');
  assert.deepEqual([(await operations(g, 'noShow')).length, (await exceptions(g)).length, (await read(g)).state], [0, 0, 'scheduled']);
});

test('a no-show leaves the order allocated: no order, hold, allocation or slot row changes', async (t) => {
  const f = await setup(t); await missable(f);
  assert.ok(f.store.state.tables.employees.length > 0 && f.store.state.tables.entitlement_slots.length > 0);
  const before = allocation(f); const stage = JSON.stringify(await f.stages.read(f.paula, { orderUuid: ORDER }));
  assert.equal((await noShow(f)).status, 'ok');
  await f.tick();
  assert.equal(allocation(f), before);
  assert.equal(JSON.stringify(await f.stages.read(f.paula, { orderUuid: ORDER })), stage, 'the stage port still reports the order');
  const ops = await f.repository.query(f.paula, 'pending_operations');
  assert.deepEqual([...new Set(ops.value.map((o) => o.operationType))].sort(), [OPERATION_TYPES.confirm, OPERATION_TYPES.noShow, OPERATION_TYPES.request].sort());
});

test('Paula rebooks a new offered slot: attempt 2 keeps the no-show on record, uses its own operation IDs and completes through the readiness gate', async (t) => {
  const f = await setup(t, { documents: true }); await missable(f);
  const missed = (await read(f)).slot;
  assert.equal((await noShow(f)).status, 'ok');
  const idsBefore = (await f.repository.query(f.paula, 'pending_operations', {})).value.map((o) => o.operationId).filter((id) => id.startsWith('appointment:'));
  assert.ok(idsBefore.every((id) => !id.includes(':a')), 'attempt 1 keeps the original IDs');

  const view = await read(f);
  const fresh = view.offeredSlots.find((s) => s.slotId !== missed.slotId);
  assert.equal((await request(f, 'slot-nope')).status, 'invalid');
  assert.equal((await request(f, fresh.slotId, f.alex)).status, 'forbidden', 'another employee cannot rebook Paula\'s order');
  const rebookedAt = await f.now();
  const made = await request(f, fresh.slotId); assert.equal(made.status, 'ok', JSON.stringify(made));
  const a2 = made.value;
  assert.deepEqual([a2.state, a2.booked, a2.attempt, a2.slot, a2.requestedSlot, a2.outcome, a2.pending, a2.blocked, a2.offeredSlots],
    ['requested', false, 2, null, fresh, null, null, null, []]);
  assert.deepEqual([a2.owner, a2.nextStep], [OWNERSHIP.states.requested.owner, OWNERSHIP.states.requested.nextStep]);
  assert.equal(a2.previousAttempts.length, 1);
  assert.deepEqual([a2.previousAttempts[0].attempt, a2.previousAttempts[0].state, a2.previousAttempts[0].slot, a2.previousAttempts[0].outcome.state], [1, 'no-show', missed, 'no-show']);
  assert.deepEqual(a2.history.map((h) => h.state), ['requested', 'scheduled', 'no-show', 'requested'], 'history is append-only');
  assert.equal(a2.history[3].at, rebookedAt);
  const [reqOp] = (await operations(f, 'request')).filter((o) => o.payload.requestedAt === rebookedAt);
  assert.match(reqOp.operationId, /^appointment:[0-9a-f]{32}:a2:request$/);

  const again = await request(f, fresh.slotId);
  assert.deepEqual(again, made, 'repeating the rebook returns the same appointment');
  assert.equal((await operations(f, 'request')).length, 2);
  assert.equal((await receipts(f)).length, 4, 'one new request receipt');
  assert.equal((await request(f, view.offeredSlots.find((s) => s.slotId !== fresh.slotId && s.slotId !== missed.slotId).slotId)).code, 'appointment-already-requested');

  await f.advance(DELAY - 1); await f.tick();
  assert.equal((await read(f)).state, 'requested', 'attempt 2 confirms after its own delay');
  await f.advance(1); const confirmedAt = await f.now(); await f.tick();
  const booked = await read(f);
  assert.deepEqual([booked.state, booked.booked, booked.slot, booked.attempt], ['scheduled', true, fresh, 2]);
  assert.equal(booked.history[4].at, confirmedAt);
  const [confirm2] = (await operations(f, 'confirm')).filter((o) => o.operationId.includes(':a2:'));
  assert.match(confirm2.operationId, /:a2:confirm$/);

  const early = await complete(f);
  assert.deepEqual([early.status, early.code], ['conflict', 'handover-not-ready']);
  await ready(f);
  const done = await complete(f); assert.equal(done.status, 'ok', JSON.stringify(done));
  assert.deepEqual([done.value.state, done.value.attempt, done.value.previousAttempts.length, done.value.outcome.state], ['completed', 2, 1, 'completed']);
  assert.match((await operations(f, 'complete')).at(-1).operationId, /:a2:complete$/);
  assert.equal((await exceptions(f)).length, 1, 'only the missed handover raised an exception');
});

test('a second no-show on the rebooked attempt records its own exception and can be rebooked again', async (t) => {
  const f = await setup(t); await missable(f);
  assert.equal((await noShow(f)).status, 'ok');
  const slots = (await read(f)).offeredSlots;
  assert.equal((await request(f, slots[1].slotId)).status, 'ok');
  await f.advance(DELAY); await f.tick();
  assert.equal((await read(f)).state, 'scheduled');
  await atSlot(f, TIMING.noShowAfterSlotStartSeconds);
  const second = await noShow(f); assert.equal(second.status, 'ok', JSON.stringify(second));
  assert.deepEqual([second.value.state, second.value.attempt, second.value.previousAttempts.length], ['no-show', 2, 1]);
  const list = await exceptions(f);
  assert.deepEqual([list.length, list[0].outcome.value.attempt, list[1].outcome.value.attempt, new Set(list.map((e) => e.eventId)).size], [2, 1, 2, 2]);
  assert.match(list.find((e) => e.outcome.value.attempt === 2).eventId, /:a2:no-show$/);
  const [next] = (await read(f)).offeredSlots;
  const third = await request(f, next.slotId); assert.equal(third.status, 'ok', JSON.stringify(third));
  assert.deepEqual([third.value.attempt, third.value.previousAttempts.map((a) => a.attempt), third.value.state], [3, [1, 2], 'requested']);
  assert.deepEqual((await request(f, next.slotId)).value, third.value);
  await f.advance(DELAY); await f.tick();
  assert.deepEqual([(await read(f)).state, (await read(f)).attempt], ['scheduled', 3]);
});

test('no-show refusals: not scheduled, completed, wrong role, malformed, return purpose and a withdrawn order', async (t) => {
  const f = await setup(t, { documents: true });
  assert.equal((await noShow(f)).status, 'not-found');
  f.order(); await request(f, (await offered(f))[0].slotId);
  const requested = await noShow(f);
  assert.deepEqual([requested.status, requested.code], ['conflict', 'appointment-not-scheduled']);
  await f.advance(DELAY); await f.tick();
  for (const context of [f.paula, f.alex]) assert.equal((await noShow(f, context)).status, 'forbidden');
  for (const input of [{}, { orderUuid: ORDER, runId: 'other' }, { orderUuid: ORDER, employeeId: 'employee-alex' }, { orderUuid: 7 }]) assert.equal((await noShow(f, f.presenter, input)).status, 'invalid');
  assert.deepEqual([(await operations(f, 'noShow')).length, (await exceptions(f)).length, (await read(f)).state], [0, 0, 'scheduled']);

  const returned = createLifecycleAppointmentService({ ...f.deps, provider: f.provider, purpose: 'return' });
  const unsupported = await returned.recordNoShow(f.presenter, { orderUuid: ORDER });
  assert.deepEqual([unsupported.status, unsupported.code], ['unsupported', 'appointment-outcome-unsupported']);

  await ready(f); assert.equal((await complete(f)).status, 'ok');
  const late = await noShow(f); assert.deepEqual([late.status, late.code], ['conflict', 'appointment-not-scheduled']);
  assert.deepEqual([(await exceptions(f)).length, (await read(f)).state], [0, 'completed']);

  const g = await setup(t); await missable(g);
  assert.equal((await noShow(g)).status, 'ok');
  const done = await complete(g, g.presenter);
  assert.deepEqual([done.status, done.code], ['conflict', 'appointment-not-scheduled'], 'a no-show cannot then be completed');
  const [slot] = (await read(g)).offeredSlots;
  g.stages.orders.delete(ORDER);
  assert.equal((await request(g, slot.slotId)).status, 'not-found', 'rebooking needs the order still known to ordering');
  assert.deepEqual([(await g.service.read(g.paula, { orderUuid: ORDER })).value.state, (await g.service.read(g.paula, { orderUuid: ORDER })).value.offeredSlots], ['no-show', []]);
});

test('the live stub refuses a no-show as unsupported: the appointment and the exception record are unchanged', async (t) => {
  const f = await setup(t); await missable(f);
  const live = createLifecycleAppointmentService({ ...f.deps, provider: createLiveAppointmentsStub() });
  const stuck = await live.recordNoShow(f.presenter, { orderUuid: ORDER });
  assert.deepEqual([stuck.status, stuck.code, stuck.appointment.state, stuck.appointment.outcome, stuck.appointment.provider.mode], ['unsupported', 'live-appointments-unsupported', 'scheduled', null, 'live']);
  assert.deepEqual([(await exceptions(f)).length, (await receipts(f)).length, (await read(f)).state], [0, 2, 'scheduled']);
  assert.equal((await live.recordNoShow(f.presenter, { orderUuid: ORDER })).status, 'unsupported', 'the refusal stays recorded under the same operation');
  f.provider.fault.recordNoShow = { refuse: { status: 'unsupported', code: 'live-appointments-unsupported', reason: 'Recording is not connected.' } };
  assert.equal((await noShow(f)).status, 'unsupported');
  assert.deepEqual([(await exceptions(f)).length, (await operations(f, 'noShow')).length], [0, 1]);
});

for (const fault of ['lost', 'throw-after', 'hang']) {
  test(`an uncertain no-show (${fault}) stays pending under one key and is reconciled before any retry; one exception receipt`, async (t) => {
    const policy = () => policyWith((get) => { get('lifecycle.appointments.confirmation.v1').providerTimeoutMs = 20; });
    const recorded = fault === 'throw-after';
    const uncertain = async () => {
      const f = await setup(t, { policy: await policy() }); await missable(f);
      f.provider.fault.recordNoShow = fault;
      const pending = await noShow(f); assert.equal(pending.status, 'ok', JSON.stringify(pending));
      assert.deepEqual([pending.value.state, pending.value.pending.step, pending.value.outcome, pending.value.owner, pending.value.nextStep],
        ['scheduled', 'noShow', null, OWNERSHIP.pending.owner, OWNERSHIP.pending.nextStep]);
      const [before] = await operations(f, 'noShow');
      assert.deepEqual([before.lastKnownState, (await exceptions(f)).length], ['unknown', 0], 'nothing is reported until the outcome is known');
      assert.equal((await complete(f, f.presenter)).code, 'appointment-update-pending');
      f.provider.calls.length = 0;
      return { f, before };
    };
    const expectDone = async ({ f, before }, view) => {
      assert.deepEqual(f.provider.calls, recorded ? ['reconcile'] : ['reconcile', 'recordNoShow'], 'reconciled first; only not-found allows the same write again');
      assert.deepEqual([view.state, view.pending, view.outcome.state], ['no-show', null, 'no-show']);
      const after = await operations(f, 'noShow');
      assert.deepEqual([after.length, after[0].operationId, after[0].idempotencyKey, after[0].state], [1, before.operationId, before.idempotencyKey, 'completed']);
      assert.deepEqual([(await exceptions(f)).length, (await receipts(f)).length], [1, 3], 'exactly one adapter receipt and one exception receipt');
      assert.equal((await exceptions(f))[0].eventId, before.operationId);
    };
    const viaRepeat = await uncertain();
    const repeated = await noShow(viaRepeat.f, viaRepeat.f.greg); assert.equal(repeated.status, 'ok', JSON.stringify(repeated));
    await expectDone(viaRepeat, repeated.value);

    const viaTick = await uncertain();
    const summary = handled(await viaTick.f.tick());
    assert.deepEqual([summary.status, summary.value.applied, summary.value.failed], ['ok', 1, []]);
    await expectDone(viaTick, await read(viaTick.f));
    await viaTick.f.tick();
    assert.equal((await exceptions(viaTick.f)).length, 1);
  });
}

test('/api/gcsp/appointments/no-show is gated, server-scoped and ignores browser identity; rebooking is Paula\'s own request', async (t) => {
  const f = await setup(t); await missable(f);
  const call = http(f);
  const forged = { orderUuid: ORDER, employeeId: 'employee-alex', runId: 'other', roles: ['employee'] };
  assert.equal((await call('/appointments/no-show', { body: { orderUuid: ORDER } })).code, 403, 'the employee cannot record a no-show');
  assert.equal((await call('/appointments/no-show', { session: f.sessions.alex, body: { orderUuid: ORDER } })).code, 403);
  assert.equal((await call('/appointments/no-show', { session: f.sessions.greg, body: { orderUuid: ORDER, extra: 1 } })).code, 400);
  const done = await call('/appointments/no-show', { session: f.sessions.presenter, body: forged });
  assert.equal(done.code, 200, JSON.stringify(done));
  assert.deepEqual([done.value.value.state, done.value.value.employeeId, done.value.value.runId, done.value.value.outcome.state], ['no-show', 'employee-paula', f.paula.runId, 'no-show']);
  assert.deepEqual((await call('/appointments/no-show', { session: f.sessions.greg, body: { orderUuid: ORDER } })).value, done.value);
  assert.deepEqual((await call('/appointments', { query: `orderUuid=${ORDER}` })).value.value, done.value.value);
  assert.equal((await call('/appointments', { session: f.sessions.alex, query: `orderUuid=${ORDER}` })).code, 403);
  const [slot] = done.value.value.offeredSlots.slice(1);
  assert.equal((await call('/appointments/request', { session: f.sessions.alex, body: { orderUuid: ORDER, slotId: slot.slotId } })).code, 403);
  const rebooked = await call('/appointments/request', { body: { orderUuid: ORDER, slotId: slot.slotId, employeeId: 'employee-alex' } });
  assert.deepEqual([rebooked.code, rebooked.value.value.state, rebooked.value.value.attempt, rebooked.value.value.employeeId], [200, 'requested', 2, 'employee-paula']);
  assert.equal((await call('/appointments/no-show', { session: f.sessions.greg, body: { orderUuid: ORDER } })).code, 409);
});

test('the no-show and rebooked response shapes match the recorded fixture', async (t) => {
  const keys = (v) => Object.keys(v).sort();
  const want = shapes.states['no-show'];
  assert.deepEqual([want.owner, want.nextStep], [NO_SHOW.owner, NO_SHOW.nextStep]);
  assert.deepEqual(shapes.readModelKeys.filter((k) => ['attempt', 'previousAttempts', 'outcome'].includes(k)).sort(), ['attempt', 'outcome', 'previousAttempts']);
  const f = await setup(t); await missable(f);
  const view = (await noShow(f)).value;
  assert.deepEqual(keys(view), [...shapes.readModelKeys].sort());
  assert.deepEqual([view.state, view.booked, view.owner, view.nextStep, view.pending?.step ?? null, view.blocked?.code ?? null, view.attempt, view.previousAttempts], [want.state, want.booked, want.owner, want.nextStep, want.pendingStep, want.blockedCode, want.attempt, []]);
  assert.deepEqual(view.history.map((h) => h.state), want.history);
  assert.deepEqual(keys(view.outcome), [...shapes.outcomeKeys].sort());
  assert.ok(view.offeredSlots.length > 0 && view.offeredSlots.every((s) => keys(s).join() === [...shapes.slotKeys].sort().join()));
  const rebooked = (await request(f, view.offeredSlots[1].slotId)).value;
  assert.deepEqual(keys(rebooked), [...shapes.readModelKeys].sort());
  assert.deepEqual([rebooked.state, rebooked.attempt], [shapes.rebooked.state, shapes.rebooked.attempt]);
  assert.deepEqual(rebooked.history.map((h) => h.state), shapes.rebooked.history);
  assert.deepEqual(keys(rebooked.previousAttempts[0]), [...shapes.previousAttemptKeys].sort());
  assert.deepEqual(keys(rebooked.previousAttempts[0].outcome), [...shapes.outcomeKeys].sort());
  const [exc] = await exceptions(f);
  assert.deepEqual(keys(exc.outcome.value), [...shapes.exceptionReceipt.valueKeys].sort());
  assert.deepEqual([exc.consumerId, exc.eventType], [shapes.exceptionReceipt.consumerId, OUTCOMES.exceptionTypes.noShow]);
});

test('FUCQ-260: a completion or no-show before the slot starts is refused with the keyed owner and next step and writes nothing', async (t) => {
  const f = await setup(t, { readiness: { readReadiness: async () => ok({ ready: true, documentsRevision: 1 }) } }); await scheduled(f);
  const { slot } = await read(f); assert.ok(Date.parse(await f.now()) < Date.parse(slot.start)); const count = (await receipts(f)).length;
  const from = { complete: new Date(Date.parse(slot.start) + TIMING.completeAfterSlotStartSeconds * 1000).toISOString(),
    noShow: new Date(Date.parse(slot.start) + TIMING.noShowAfterSlotStartSeconds * 1000).toISOString() };
  for (const [step, write] of [['noShow', noShow], ['complete', complete]]) {
    const early = await write(f, f.greg);
    assert.deepEqual([early.status, early.code, early.owner, early.nextStep, early.reason, early.availableFrom],
      ['conflict', 'appointment-outcome-too-early', TIMING.tooEarly.owner, TIMING.tooEarly.nextStep, TIMING.tooEarly.nextStep, from[step]]);
    assert.deepEqual([early.appointment.state, early.appointment.booked, early.appointment.outcome], ['scheduled', true, null]);
  }
  assert.deepEqual([(await operations(f, 'complete')).length, (await operations(f, 'noShow')).length, (await exceptions(f)).length, (await receipts(f)).length],
    [0, 0, 0, count], 'an early outcome writes nothing');
  await atSlot(f, TIMING.noShowAfterSlotStartSeconds - 1);
  assert.equal((await noShow(f)).code, 'appointment-outcome-too-early', 'still early one second before');
  await f.advance(1);
  const done = await noShow(f); assert.equal(done.status, 'ok', JSON.stringify(done));
  assert.deepEqual(await noShow(f), done, 'a repeat of the recorded outcome still returns it');

  const g = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.outcomeTiming.v1').noShowAfterSlotStartSeconds = 1800; }) });
  await scheduled(g); await atSlot(g);
  const graced = await noShow(g);
  assert.deepEqual([graced.code, graced.availableFrom], ['appointment-outcome-too-early', new Date(Date.parse((await read(g)).slot.start) + 1800 * 1000).toISOString()], 'the keyed offset moves the rule');
  await g.advance(1800); assert.equal((await noShow(g)).status, 'ok');

  const seedless = structuredClone(SEED); seedless.assumptions = seedless.assumptions.filter((a) => a.key !== 'lifecycle.appointments.outcomeTiming.v1');
  const h = await setup(t, { policy: new PolicyService({ provider: { async loadVersions() { return [seedless]; } } }) }); await scheduled(h); await atSlot(h);
  assert.deepEqual([(await noShow(h)).status, (await noShow(h)).code, (await read(h)).state], ['unavailable', 'appointment-policy-unavailable', 'scheduled'], 'no default timing');
});

test('FUCQ-260: after a no-show the missed slot is not offered or rebooked again, even when the slot source still lists it', async (t) => {
  const first = Date.parse('2026-11-08T09:00:00.000Z');
  const fixed = [0, 1, 2].map((i) => ({ slotId: `fixed-${i}`, start: new Date(first + i * DAY * 1000).toISOString(), end: new Date(first + (i * DAY + HOUR) * 1000).toISOString() }));
  const f = await setup(t, { slotSource: async () => ({ slots: fixed }) }); await scheduled(f);
  assert.equal((await read(f)).slot.slotId, 'fixed-0');
  await atSlot(f, TIMING.noShowAfterSlotStartSeconds); assert.equal((await noShow(f)).status, 'ok');
  assert.deepEqual((await offered(f)).map((s) => s.slotId), ['fixed-1', 'fixed-2'], 'the missed slot is not offered again');
  assert.equal((await request(f, 'fixed-0')).status, 'invalid', 'the missed slot cannot be rebooked');
  assert.equal((await request(f, 'fixed-1')).status, 'ok'); await f.advance(DELAY); await f.tick();
  await atSlot(f, TIMING.noShowAfterSlotStartSeconds); assert.equal((await noShow(f)).status, 'ok');
  assert.deepEqual((await offered(f)).map((s) => s.slotId), ['fixed-2'], 'every earlier missed slot stays excluded');
});
