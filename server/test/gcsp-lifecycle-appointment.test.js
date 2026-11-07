import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createLifecycleAppointmentService, APPOINTMENT_HANDLER_ID } from '../gcsp/lifecycle/appointments/index.js';
import { createLifecycleApprovalService } from '../gcsp/lifecycle/approvals/index.js';
import { createSyntheticOrderingStatus } from '../gcsp/adapters/synthetic-ordering-status.js';
import { createSyntheticAppointments, createLiveAppointmentsStub, APPOINTMENT_CONSUMER, OPERATION_TYPES } from '../gcsp/adapters/synthetic-appointments.js';
import { createRealProducer } from './helpers/gcsp-lifecycle-approval.js';

const SEED = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const seedValue = (key) => SEED.assumptions.find((a) => a.key === key).value;
const SLOTS = seedValue('lifecycle.appointments.slots.v1');
const DELAY = seedValue('lifecycle.appointments.confirmation.v1').confirmDelaySeconds;
const OWNERSHIP = seedValue('lifecycle.appointments.ownership.v1');
const ORDER = '7d1c0b6e-2f4a-4c1e-9b7a-1a2b3c4d5e6f';
const HOUR = 3600;
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
  for (const method of ['requestSlot', 'confirm', 'acceptProposal', 'reconcile']) {
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

async function setup(t, { policy, live = false, stages = stagePort() } = {}) {
  policy ??= await policyWith();
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
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
  const service = createLifecycleAppointmentService({ repository, policy, clock, identity, lifecycleStages: port, provider });
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
  return { repository, clock, identity, service, stages, provider, synthetic, tick, advance, order, now, presenter: p, paula: paula.value.context,
    alex: alex.value.context, greg: greg.value.context };
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
