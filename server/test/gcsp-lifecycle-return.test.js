import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createLifecycleAppointmentService } from '../gcsp/lifecycle/appointments/index.js';
import { createLifecycleReturnPlanService } from '../gcsp/lifecycle/return-plan/index.js';
import { createReturnPlanRoutes } from '../gcsp/lifecycle/return-plan/http.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { createLifecycleApprovalService } from '../gcsp/lifecycle/approvals/index.js';
import { createSyntheticOrderingStatus } from '../gcsp/adapters/synthetic-ordering-status.js';
import { createSyntheticAppointments, APPOINTMENT_CONSUMER } from '../gcsp/adapters/synthetic-appointments.js';
import { createSyntheticReturnOutcomes, createLiveReturnOutcomesStub, RETURN_OUTCOME_CONSUMER } from '../gcsp/adapters/synthetic-return-outcomes.js';
import { RETURN_EXCEPTION_CONSUMER, RETURN_OUTCOME_STATE } from '../gcsp/lifecycle/return-plan/outcomes.js';
import { applyCurrentCarEvent, recordCurrentCarEvent, readCurrentCar, CURRENT_CAR_EVENTS } from '../gcsp/lifecycle/current-car/index.js';
import { RenewalCaseService } from '../gcsp/cases/index.js';
import { createLifecycleDocumentService } from '../gcsp/lifecycle/documents/index.js';
import { createSyntheticDocumentStatus } from '../gcsp/adapters/synthetic-ordering-documents.js';
import { prepareBuddySelection } from '../gcsp/offers/buddy-conversion.js';
import { createRealProducer, acknowledgedSelection } from './helpers/gcsp-lifecycle-approval.js';

const shapes = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-return-plan-outcomes.json', import.meta.url), 'utf8'));
const SEED = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const seedRow = (key) => SEED.assumptions.find((a) => a.key === key);
const DELAY = seedRow('lifecycle.appointments.confirmation.v1').value.confirmDelaySeconds;
const OWNERSHIP = seedRow('lifecycle.return.ownership.v1').value;
const HOUR = 3600;
const DAY = 86400000;
const MILEAGE = 6100;

// The canonical seed read only through PolicyService; `mutate` patches an alternative value by key.
async function policyWith(mutate = () => {}) {
  const seed = structuredClone(SEED);
  mutate((key) => seed.assumptions.find((a) => a.key === key).value);
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}

// Real FUCQ-71 producer and FUCQ-111 approvals feed the real handover (FUCQ-114) and return services.
// `outcomes` builds the return outcome step from the repository (synthetic by default); `cases` adds the renewal-risk trigger.
async function setup(t, { policy, order = 'replacement', outcomes = (repository) => createSyntheticReturnOutcomes({ repository }), cases = false, documents = false, wrapProvider = (p) => p } = {}) {
  policy ??= await policyWith();
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
  t.after(() => repository.close());
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'return-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const alex = await identity.switchPrincipal(presenter.value.context, 'demo-alex', 'alex');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  for (const who of [paula, alex]) assert.equal((await seedManualDemoContext({ repository, identity, clock, context: who.value.context })).status, 'ok');
  const approvals = createLifecycleApprovalService({ repository, policy, clock, identity, status: createSyntheticOrderingStatus({ repository }) });
  assert.equal((await approvals.start()).status, 'ok');
  const provider = wrapProvider(createSyntheticAppointments({ repository }));
  const common = { repository, policy, clock, identity, lifecycleStages: approvals.stagePort(), provider };
  // `documents` composes the real FUCQ-116 service as the handover readiness port, so FUCQ-167 completion can run.
  const docs = documents ? createLifecycleDocumentService({ ...common, provider: createSyntheticDocumentStatus({ repository }) }) : null;
  if (docs) assert.equal((await docs.start()).status, 'ok');
  const handover = createLifecycleAppointmentService({ ...common, readiness: docs ?? undefined });
  const outcomeProvider = outcomes(repository);
  const returns = createLifecycleReturnPlanService({ ...common, handover, outcomes: outcomeProvider });
  assert.equal((await handover.start()).status, 'ok'); assert.equal((await returns.start()).status, 'ok');
  const renewalCases = cases ? new RenewalCaseService({ repository, policy, clock, identity }) : null;
  if (renewalCases) assert.equal((await renewalCases.start()).status, 'ok');
  const producer = await createRealProducer({ repository, policy, clock, identity });
  const p = presenter.value.context; const ctx = paula.value.context; let n = 0;
  const f = { repository, clock, identity, policy, handover, returns, producer, provider, outcomeProvider, renewalCases, docs, presenter: p, paula: ctx, alex: alex.value.context, greg: greg.value.context,
    sessions: { paula, alex, greg, presenter } };
  f.tick = async () => {
    const now = await clock.now(p); const eventId = `tick-${++n}`;
    const outcome = await clock.tick(p, { eventId, expectedClockVersion: now.value.clockVersion, inputDigest: inputDigest(eventId) });
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value;
  };
  f.advance = async (bySeconds) => {
    const now = await clock.now(p);
    assert.equal((await clock.advance(p, { commandId: `advance-${++n}`, expectedClockVersion: now.value.clockVersion, bySeconds })).status, 'ok');
  };
  f.now = async () => (await clock.now(p)).value.now;
  // Paula's current-car identity: the account's contract records and the entitlement slot's contract link.
  f.car = async () => {
    const employee = await repository.read(ctx, { table: 'employees', key: { runId: ctx.runId, employeeId: ctx.employeeId } });
    const slot = await repository.read(ctx, { table: 'entitlement_slots', key: { runId: ctx.runId, entitlementSlotId: ctx.entitlementSlotId } });
    const contracts = employee.value.contract.manualContext.contracts;
    return structuredClone({ current: contracts.filter((c) => c.status === 'current'), contracts, slotContractId: slot.value.contractId });
  };
  f.before = await f.car();
  const contract = f.before.current[0];
  const buddy = order === 'buddy' ? await prepareBuddySelection({ repository, clock }, ctx, { expectedDraftVersion: 1 }) : null;
  if (buddy) assert.equal(buddy.status, 'ok', JSON.stringify(buddy));
  const choices = order === 'replacement'
    ? { mode: 'replacement', oldContractId: contract.contractId, collectionLocationId: 'demo-collection-centre', expectedReturnMileage: MILEAGE,
      contact: { email: 'paula@example.invalid' }, driverId: 'fictional-driver' }
    : buddy?.value.draft.choices;
  const replacement = order !== 'new';
  const sent = await producer.submit(ctx, { id: 911, type: buddy ? 'buddy-offer' : 'cart', choices, oldContract: replacement ? contract : undefined,
    declarations: replacement ? { terms: true, driver: true, return: true } : undefined });
  assert.equal(sent.submitted.status, 'ok', JSON.stringify(sent.submitted));
  f.orderUuid = sent.orderUuid; f.contract = contract;
  f.sameCar = async (step) => assert.deepEqual(await f.car(), f.before, `current car unchanged after ${step}`);
  f.plan = async (context = ctx) => { const r = await returns.read(context, { orderUuid: f.orderUuid }); assert.equal(r.status, 'ok', JSON.stringify(r)); return r.value; };
  f.handoverView = async () => (await handover.read(ctx, { orderUuid: f.orderUuid })).value;
  // Approval progression on the real FUCQ-111 lifecycle until the order is sent to ordering.
  f.approve = async () => {
    for (let i = 0; i < 16 && !(await f.handoverView()).eligibility.eligible; i += 1) { await f.advance(HOUR); await f.tick(); await f.sameCar(`approval tick ${i + 1}`); }
    assert.equal((await f.handoverView()).eligibility.eligible, true, 'the real approval lifecycle reached sent to ordering');
  };
  f.scheduleHandover = async () => {
    const slot = (await f.handoverView()).offeredSlots[0];
    assert.equal((await handover.request(ctx, { orderUuid: f.orderUuid, slotId: slot.slotId })).status, 'ok');
    await f.sameCar('handover requested');
    await f.advance(DELAY); await f.tick();
    const done = await f.handoverView(); assert.equal(done.state, 'scheduled');
    await f.sameCar('handover scheduled');
    return done;
  };
  f.setAddress = async (address) => {
    const key = { table: 'employees', key: { runId: ctx.runId, employeeId: ctx.employeeId } };
    const done = await repository.transaction(ctx, { commandId: `address-${++n}`, inputDigest: inputDigest(address) }, async (tx) => {
      const row = await tx.get(key); const m = row.value.contract.manualContext;
      return tx.compareAndSwap(key, row.value.version, { contract: { ...row.value.contract, manualContext: { ...m, account: { ...m.account, address } } } });
    });
    assert.equal(done.status, 'ok', JSON.stringify(done));
  };
  f.ask = (choice, slotId, context = ctx) => returns.request(context, { orderUuid: f.orderUuid, choice, slotId });
  return f;
}
const keys = (v) => Object.keys(v).sort();
// Paula's home address as seedManualDemoContext holds it on her account.
const HOME = { locationId: null, kind: 'home-address', label: '1 Fictional Way, Example Town, ZZ1 1ZZ', rule: 'home-address' };
const sorted = (list) => [...list].sort();

test('a replacement order has a return plan linked to the old contract and slot; a new order has none', async (t) => {
  const f = await setup(t); await f.approve();
  const plan = await f.plan();
  assert.deepEqual([plan.applicable, plan.state, plan.scheduled, plan.choice, plan.appointment.state, plan.appointment.purpose], [true, 'not-planned', false, null, 'not-requested', 'return']);
  assert.deepEqual([plan.oldContractId, plan.vehicleSlotId, plan.employeeId, plan.runId], [f.contract.contractId, f.paula.entitlementSlotId, 'employee-paula', f.paula.runId]);
  assert.deepEqual([plan.currentCar.contractId, plan.currentCar.slotId, plan.currentCar.status, plan.currentCar.source], [f.contract.contractId, f.contract.slotId, 'current', 'account']);
  assert.deepEqual([plan.location.locationId, plan.location.kind, plan.location.label], ['demo-collection-centre', 'collection-location', 'Fictional collection centre']);
  assert.deepEqual([plan.fictional, plan.handover.state, plan.handover.booked], [true, 'not-requested', false]);
  assert.deepEqual([plan.owner, plan.nextStep], [OWNERSHIP.ineligible.owner, OWNERSHIP.ineligible.nextStep]);
  assert.ok(plan.choices.every((c) => c.available === false && typeof c.reason === 'string'), 'no choice is open before the handover is scheduled');
  const early = await f.ask('separate', 'slot-20261107T0900Z');
  assert.deepEqual([early.status, early.code], ['conflict', 'handover-not-ready']);
  assert.equal((await f.plan()).appointment.state, 'not-requested', 'a refused request writes nothing');
  assert.equal((await f.repository.query(f.paula, 'event_receipts', { consumerId: 'lifecycle-return-appointments:state:v1' })).value.length, 0);

  const g = await setup(t, { order: 'new' });
  const none = await g.plan();
  assert.deepEqual([none.applicable, none.state, none.scheduled, none.appointment, none.currentCar, none.oldContractId, none.returnMileage, none.choices, none.offeredSlots],
    [false, null, false, null, null, null, null, [], {}]);
  const refused = await g.ask('separate', 'slot-20261107T0900Z');
  assert.deepEqual([refused.status, refused.code], ['conflict', 'return-not-applicable']);
  assert.equal((await g.repository.query(g.paula, 'event_receipts', { consumerId: 'lifecycle-return-appointments:state:v1' })).value.length, 0);

  // A replacement selection without its old-car record is an explicit source error, never a guess.
  const h = await setup(t, { order: 'new' });
  const broken = await acknowledgedSelection(h.repository, h.paula, { selection: { draft: { choices: { mode: 'replacement', oldContractId: 'current:employee-paula' } } } });
  const bad = await h.returns.read(h.paula, { orderUuid: broken.orderUuid });
  assert.deepEqual([bad.status, bad.code], ['unavailable', 'return-plan-source-invalid']);
});

test('FUCQ-184/194: a buddy replacement reads its old car and odometer, is collected from her home address, and plans a separate return', async (t) => {
  const f = await setup(t, { order: 'buddy' }); await f.approve();
  const selection = (await f.repository.query(f.paula, 'pending_operations', { operationType: 'selection-order' })).value[0].payload.selection;
  assert.equal(selection.source.type, 'buddy-offer'); assert.equal(selection.draft.choices.expectedReturnMileage, undefined, 'the buddy draft has no manual fields');
  const odometer = selection.draft.choices.returnOdometer;
  const plan = await f.plan();
  assert.deepEqual([plan.applicable, plan.state, plan.oldContractId, plan.vehicleSlotId], [true, 'not-planned', f.contract.contractId, f.paula.entitlementSlotId]);
  assert.deepEqual([plan.currentCar.contractId, plan.currentCar.status, plan.currentCar.source], [f.contract.contractId, 'current', 'account']);
  assert.deepEqual(plan.returnMileage, { value: odometer.value, unit: odometer.unit, recordedAt: selection.receivedAt, source: 'selection' });
  assert.deepEqual(plan.location, HOME);
  await f.scheduleHandover();
  const open = await f.plan();
  const asked = await f.ask('separate', open.offeredSlots.separate[0].slotId);
  assert.equal(asked.status, 'ok', JSON.stringify(asked));
  assert.deepEqual(asked.value.location, HOME, 'choosing a return option never moves a buddy collection off her home address');
  await f.advance(DELAY); await f.tick();
  assert.deepEqual([(await f.plan()).state, (await f.plan()).scheduled], ['return-scheduled', true]);
  await f.sameCar('buddy return scheduled');

  // FUCQ-194: with no usable address on her account the place is unknown, never invented.
  for (const [name, address] of [['no address', null], ['blank address', { line1: ' ', town: '', postcode: '' }]]) {
    await f.setAddress(address);
    assert.deepEqual((await f.plan()).location, { ...HOME, label: null }, name);
  }

  // A malformed buddy record is still an explicit source error, never a guess.
  const h = await setup(t, { order: 'new' });
  const good = { draft: { choices: { mode: 'replacement', returnOdometer: { value: 5200, unit: 'mi' } } }, oldContract: h.contract,
    vehicleSlot: { entitlementSlotId: 'slot-paula' } };
  const variants = { 'no odometer': { draft: { choices: { mode: 'replacement' } } }, 'negative odometer': { draft: { choices: { mode: 'replacement', returnOdometer: { value: -1, unit: 'mi' } } } },
    'fractional odometer': { draft: { choices: { mode: 'replacement', returnOdometer: { value: 1.5, unit: 'mi' } } } },
    'no unit': { draft: { choices: { mode: 'replacement', returnOdometer: { value: 5200 } } } }, 'no old contract': { oldContract: null }, 'no slot': { vehicleSlot: null } };
  const ok = await acknowledgedSelection(h.repository, h.paula, { sourceType: 'buddy-offer', selection: good });
  assert.equal((await h.returns.read(h.paula, { orderUuid: ok.orderUuid })).value.applicable, true, 'the well-formed control reads');
  for (const [name, patch] of Object.entries(variants)) {
    const row = await acknowledgedSelection(h.repository, h.paula, { sourceType: 'buddy-offer', selection: { ...good, ...patch } });
    const bad = await h.returns.read(h.paula, { orderUuid: row.orderUuid });
    assert.deepEqual([bad.status, bad.code], ['unavailable', 'return-plan-source-invalid'], name);
  }
});

test('return states: requested is never scheduled, then a separate appointment is scheduled with its own reference', async (t) => {
  const f = await setup(t); await f.approve();
  const handover = await f.scheduleHandover();
  const open = await f.plan();
  assert.deepEqual([open.state, open.handover.state, open.handover.booked], ['not-planned', 'scheduled', true]);
  assert.deepEqual(open.choices.map((c) => [c.id, c.available]), [['same-visit', true], ['separate', true]]);
  assert.deepEqual([open.owner, open.nextStep], [OWNERSHIP.states['not-requested'].owner, OWNERSHIP.states['not-requested'].nextStep]);
  const slot = open.offeredSlots.separate[0];
  const asked = await f.ask('separate', slot.slotId);
  assert.equal(asked.status, 'ok', JSON.stringify(asked));
  const requested = asked.value; const askedAt = await f.now();
  assert.deepEqual([requested.state, requested.scheduled, requested.choice, requested.slot, requested.requestedSlot], ['return-requested', false, 'separate', null, slot]);
  assert.deepEqual([requested.owner, requested.nextStep], [OWNERSHIP.states.requested.owner, OWNERSHIP.states.requested.nextStep]);
  assert.deepEqual(requested.history.map((h) => [h.state, h.at]), [['return-requested', askedAt]]);
  assert.match(requested.history[0].providerReference, /^SYN-APT-/);
  assert.deepEqual(requested.location, { locationId: 'demo-collection-centre', kind: 'collection-location', label: 'Fictional collection centre', rule: 'handover-retailer' });
  await f.sameCar('return requested');

  await f.advance(60); await f.tick();
  assert.deepEqual([(await f.plan()).state, (await f.plan()).scheduled], ['return-requested', false], 'before the keyed delay the retailer has not answered');
  await f.advance(DELAY); await f.tick();
  const scheduled = await f.plan();
  assert.deepEqual([scheduled.state, scheduled.scheduled, scheduled.slot, scheduled.appointment.booked], ['return-scheduled', true, slot, true]);
  assert.deepEqual([scheduled.owner, scheduled.nextStep], [OWNERSHIP.states.scheduled.owner, OWNERSHIP.states.scheduled.nextStep]);
  assert.deepEqual(scheduled.history.map((h) => [h.state, h.appointmentState]), [['return-requested', 'requested'], ['return-scheduled', 'scheduled']]);
  assert.equal(scheduled.history[1].at, await f.now());
  assert.equal(scheduled.providerReference, scheduled.history[1].providerReference);
  await f.sameCar('return scheduled');

  // Distinct from the handover: another projection, other operation IDs and other provider references.
  const after = await f.handoverView();
  assert.deepEqual([after.state, after.slot, after.history.map((h) => h.providerReference)], ['scheduled', handover.slot, handover.history.map((h) => h.providerReference)], 'the handover is untouched');
  const refs = [...scheduled.history, ...after.history].map((h) => h.providerReference);
  assert.equal(new Set(refs).size, 4, 'handover and return never share a provider reference');
  const receipts = (await f.repository.query(f.paula, 'event_receipts', { consumerId: APPOINTMENT_CONSUMER })).value;
  assert.equal(receipts.length, 4);
  const ops = (await f.repository.query(f.paula, 'pending_operations', {})).value.filter((o) => o.operationType.startsWith('lifecycle-appointment-'));
  assert.deepEqual([sorted(new Set(ops.map((o) => o.operationId.split(':')[0]))), ops.length], [['appointment', 'return-appointment'], 4]);

  // Repeating the booked request returns the same plan; a different choice or slot is refused.
  assert.deepEqual((await f.ask('separate', slot.slotId)).value, scheduled);
  const other = await f.ask('separate', open.offeredSlots.separate[1].slotId);
  assert.deepEqual([other.status, other.code], ['conflict', 'appointment-already-requested']);
  const swap = await f.ask('same-visit', slot.slotId);
  assert.deepEqual([swap.status, swap.code], ['conflict', 'appointment-already-requested']);
  assert.deepEqual((await f.plan()).choices.map((c) => [c.id, c.available, c.selected]), [['same-visit', false, false], ['separate', false, true]]);
});

test('same-visit and separate choices follow the canonical policy keys, and changing a key changes the offer', async (t) => {
  const f = await setup(t); await f.approve();
  const handover = await f.scheduleHandover();
  const today = Math.floor(Date.parse(await f.now()) / DAY) * DAY;
  const read = { runId: f.paula.runId, asOf: await f.now(), policyVersion: f.paula.policyVersion };
  const row = await f.policy.getAssumption('lifecycle.return.options.v1', read);
  assert.equal(row.status, 'ok');
  assert.deepEqual([row.value.status, row.value.value.choices.map((c) => c.id)], ['assumed', ['same-visit', 'separate']]);
  const expected = (rules) => {
    const { slots, maxDaysAfterHandover } = rules.separate; const end = Date.parse(handover.slot.end); const out = [];
    for (let d = 0; d < slots.daysOffered; d += 1) for (const time of [...slots.dailyStartTimes].sort()) {
      const [h, m] = time.split(':').map(Number); const start = today + (slots.earliestLeadDays + d) * DAY + (h * 60 + m) * 60000;
      if (start >= end && start <= end + maxDaysAfterHandover * DAY) out.push([new Date(start).toISOString(), slots.slotMinutes]);
    }
    return out;
  };
  const plan = await f.plan();
  const grid = (list) => list.map((s) => [s.start, (Date.parse(s.end) - Date.parse(s.start)) / 60000]);
  assert.deepEqual(grid(plan.offeredSlots.separate), expected(row.value.value.rules));
  assert.ok(plan.offeredSlots.separate.length > 0 && plan.offeredSlots.separate.every((s) => Date.parse(s.start) >= Date.parse(handover.slot.end)));
  assert.deepEqual(plan.offeredSlots['same-visit'], [handover.slot], 'same-visit offers only the handover slot');
  assert.deepEqual(plan.choices.map((c) => c.label), row.value.value.choices.map((c) => c.label));
  assert.ok(['lifecycle.return.options.v1', 'lifecycle.return.ownership.v1'].every((key) => plan.assumptions.some((a) => a.key === key && a.status === 'assumed')));
  assert.ok(seedRow('lifecycle.return.options.v1').basis.includes('Synthetic demo assumption'));

  const alt = await setup(t, { policy: await policyWith((get) => {
    const separate = get('lifecycle.return.options.v1').rules.separate;
    Object.assign(separate.slots, { earliestLeadDays: 3, daysOffered: 2, slotMinutes: 30, dailyStartTimes: ['10:00'] }); separate.maxDaysAfterHandover = 2;
  }) });
  await alt.approve(); const altHandover = await alt.scheduleHandover(); const altPlan = await alt.plan();
  const altToday = Math.floor(Date.parse(await alt.now()) / DAY) * DAY;
  assert.deepEqual(grid(altPlan.offeredSlots.separate), [[new Date(altToday + 3 * DAY + 10 * HOUR * 1000).toISOString(), 30], [new Date(altToday + 4 * DAY + 10 * HOUR * 1000).toISOString(), 30]]);
  assert.ok(altPlan.offeredSlots.separate.every((s) => Date.parse(s.start) >= Date.parse(altHandover.slot.end)));

  // Same visit: the return books the handover's own slot, as a second appointment.
  const same = await f.ask('same-visit', handover.slot.slotId);
  assert.equal(same.status, 'ok', JSON.stringify(same));
  assert.deepEqual([same.value.choice, same.value.state, same.value.requestedSlot], ['same-visit', 'return-requested', handover.slot]);
  await f.advance(DELAY); await f.tick();
  const done = await f.plan();
  assert.deepEqual([done.state, done.slot, done.handover.slot], ['return-scheduled', handover.slot, handover.slot]);
  assert.notEqual(done.providerReference, done.handover.providerReference);

  const g = await setup(t); await g.approve(); await g.scheduleHandover();
  const offers = (await g.plan()).offeredSlots;
  assert.deepEqual([(await g.ask('weekly', offers.separate[0].slotId)).status, (await g.ask('same-visit', offers.separate[0].slotId)).status], ['invalid', 'invalid'], 'unknown choice and an unoffered slot');
  assert.equal((await g.ask('separate', handover.slot.slotId)).status, 'invalid', 'the handover slot is before the separate window');
  assert.equal((await g.returns.request(g.paula, { orderUuid: g.orderUuid, choice: 'separate', slotId: offers.separate[0].slotId, expectedReturnMileage: 1 })).status, 'invalid');
  assert.equal((await g.plan()).state, 'not-planned');

  // A rule that fails validation is refused, not defaulted.
  const bad = await setup(t, { policy: await policyWith((get) => { get('lifecycle.return.options.v1').choices[0].label = 'Return it — now'; }) });
  await bad.approve();
  assert.deepEqual([(await bad.returns.read(bad.paula, { orderUuid: bad.orderUuid })).status, (await bad.returns.read(bad.paula, { orderUuid: bad.orderUuid })).code], ['unavailable', 'return-policy-unavailable']);
  for (const key of ['lifecycle.return.options.v1', 'lifecycle.return.ownership.v1']) assert.ok(!JSON.stringify(seedRow(key)).includes('—'), key);
});

test('return mileage is the value captured at selection, read-only', async (t) => {
  const f = await setup(t); await f.approve();
  const selection = (await f.repository.query(f.paula, 'pending_operations', { operationType: 'selection-order' })).value[0].payload.selection;
  assert.equal(selection.draft.choices.expectedReturnMileage, MILEAGE);
  const mileage = (await f.plan()).returnMileage;
  assert.deepEqual(mileage, { value: MILEAGE, unit: 'mi', recordedAt: selection.receivedAt, source: 'selection' });
  await f.scheduleHandover();
  const plan = await f.plan();
  assert.equal((await f.ask('separate', plan.offeredSlots.separate[0].slotId)).status, 'ok');
  await f.advance(DELAY); await f.tick();
  assert.deepEqual((await f.plan()).returnMileage, mileage, 'planning never rewrites the recorded mileage');
  const edit = await f.returns.request(f.paula, { orderUuid: f.orderUuid, choice: 'separate', slotId: plan.offeredSlots.separate[0].slotId, returnMileage: 1 });
  assert.equal(edit.status, 'invalid');
});

test('the current car is unchanged through selection, approvals, handover and return planning', async (t) => {
  const f = await setup(t);
  await f.sameCar('selection and acceptance');
  await f.approve();                  // every approval tick is checked inside approve()
  await f.scheduleHandover();         // handover requested and scheduled are checked inside
  const plan = await f.plan();
  assert.equal((await f.ask('separate', plan.offeredSlots.separate[0].slotId)).status, 'ok');
  await f.sameCar('return requested');
  await f.advance(DELAY); await f.tick();
  assert.equal((await f.plan()).state, 'return-scheduled');
  await f.sameCar('return scheduled');
  const after = await f.car();
  assert.deepEqual(after.current.map((c) => [c.contractId, c.slotId, c.status, c.returnedDate]), [[f.contract.contractId, f.contract.slotId, 'current', null]]);
  assert.equal(after.slotContractId, f.before.slotContractId);
  assert.equal((await f.plan()).currentCar.status, 'current', 'the read model still shows it as her current car');
});

// A route caller bound to the real shared handler; sessions come from setup, never from the request.
const http = (f) => {
  const handler = createGcspHandler({ identity: f.identity, routes: createReturnPlanRoutes(f.returns), allowedOrigins: ['https://return.test'] });
  const cookie = (session) => [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  return async (path, { body, session = f.sessions.paula, query = '' } = {}) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { method: body ? 'POST' : 'GET', headers: { origin: 'https://return.test', cookie: cookie(session) } });
    let sent; const res = { setHeader() {} };
    await handler({ req, res, pathname: `/api/gcsp${path}`, searchParams: new URLSearchParams(query), sendJson: (r, code, value) => { sent = { code, value }; } });
    return sent;
  };
};

test('/api/gcsp return-plan routes act as the server-owned employee, refuse others and ignore browser identity', async (t) => {
  const f = await setup(t, { policy: await policyWith((get) => { get('lifecycle.appointments.scenario.v1').proposeChange = true; }) }); await f.approve();
  const call = http(f); const q = `orderUuid=${f.orderUuid}`;
  // The handover proposes a change under this scenario; Paula accepts it first.
  const slot = (await f.handoverView()).offeredSlots[0];
  assert.equal((await f.handover.request(f.paula, { orderUuid: f.orderUuid, slotId: slot.slotId })).status, 'ok');
  await f.advance(DELAY); await f.tick();
  const proposal = await f.handoverView(); assert.equal(proposal.state, 'change-proposed');
  assert.equal((await f.handover.acceptChange(f.paula, { orderUuid: f.orderUuid, proposalId: proposal.proposalId })).status, 'ok');

  const early = await call('/return-plan', { query: `${q}&employeeId=employee-alex&runId=other` });
  assert.deepEqual([early.code, early.value.value.employeeId, early.value.value.runId, early.value.value.state], [200, 'employee-paula', f.paula.runId, 'not-planned'], 'forged query identity is stripped');
  const open = early.value.value; const same = open.offeredSlots['same-visit'][0];
  const asked = await call('/return-plan/request', { body: { orderUuid: f.orderUuid, choice: 'same-visit', slotId: same.slotId, employeeId: 'employee-alex', runId: 'other', roles: ['presenter'] } });
  assert.equal(asked.code, 200, JSON.stringify(asked));
  assert.deepEqual([asked.value.value.state, asked.value.value.scheduled, asked.value.value.employeeId, asked.value.value.runId], ['return-requested', false, 'employee-paula', f.paula.runId]);
  assert.deepEqual((await call('/return-plan/request', { body: { orderUuid: f.orderUuid, choice: 'same-visit', slotId: same.slotId } })).value, asked.value, 'repeat returns the same plan');
  assert.equal((await call('/return-plan/request', { body: { orderUuid: f.orderUuid, choice: 'separate', slotId: same.slotId } })).code, 409);
  assert.equal((await call('/return-plan/request', { body: { orderUuid: f.orderUuid, choice: 'same-visit' } })).code, 400);

  for (const who of ['alex']) {
    assert.equal((await call('/return-plan', { session: f.sessions[who], query: q })).code, 403);
    assert.equal((await call('/return-plan/request', { session: f.sessions[who], body: { orderUuid: f.orderUuid, choice: 'same-visit', slotId: same.slotId } })).code, 403);
    assert.equal((await call('/return-plan/accept', { session: f.sessions[who], body: { orderUuid: f.orderUuid, proposalId: 'x' } })).code, 403);
  }
  for (const who of ['greg', 'presenter']) assert.equal((await call('/return-plan', { session: f.sessions[who], query: q })).code, 200, who);
  assert.equal((await call('/return-plan/request', { session: f.sessions.greg, body: { orderUuid: f.orderUuid, choice: 'same-visit', slotId: same.slotId } })).code, 403);
  assert.equal((await call('/return-plan', { query: 'other=1' })).code, 400);

  await f.advance(DELAY); await f.tick();
  const proposed = (await call('/return-plan', { query: q })).value.value;
  assert.deepEqual([proposed.state, proposed.scheduled, proposed.appointment.state], ['return-requested', false, 'change-proposed'], 'a proposed change is still only a request');
  assert.deepEqual([proposed.owner, proposed.nextStep], [OWNERSHIP.states['change-proposed'].owner, OWNERSHIP.states['change-proposed'].nextStep]);
  const accepted = await call('/return-plan/accept', { body: { orderUuid: f.orderUuid, proposalId: proposed.proposalId, employeeId: 'employee-alex' } });
  assert.equal(accepted.code, 200, JSON.stringify(accepted));
  assert.deepEqual([accepted.value.value.state, accepted.value.value.scheduled, accepted.value.value.slot, accepted.value.value.employeeId],
    ['return-scheduled', true, proposed.proposedSlot, 'employee-paula']);
  await f.sameCar('return accepted');
});

// Recorded response shapes for the later return screen (FUCQ-120); no screen in this story.
test('recorded return-plan response shapes match real service output, with owners and next steps from policy', async (t) => {
  const f = await setup(t); await f.approve();
  for (const [name, want] of Object.entries({ 'not-planned': OWNERSHIP.ineligible, 'return-requested': OWNERSHIP.states.requested, 'return-scheduled': OWNERSHIP.states.scheduled })) {
    assert.deepEqual([shapes.states[name].owner, shapes.states[name].nextStep], [want.owner, want.nextStep], `fixture ${name} matches the policy seed`);
  }
  const expectShape = (plan, name) => {
    const want = shapes.states[name];
    assert.deepEqual(keys(plan), sorted(shapes.readModelKeys), name);
    assert.deepEqual([plan.applicable, plan.state, plan.scheduled, plan.owner, plan.nextStep, plan.choice], [true, want.state, want.scheduled, want.owner, want.nextStep, want.choice], name);
    assert.deepEqual(plan.history.map((h) => h.state), want.history, name);
    for (const h of plan.history) assert.deepEqual(keys(h), sorted(shapes.historyKeys));
    assert.deepEqual(keys(plan.currentCar), sorted(shapes.currentCarKeys)); assert.deepEqual(keys(plan.returnMileage), sorted(shapes.returnMileageKeys));
    assert.deepEqual(keys(plan.location), sorted(shapes.locationKeys)); assert.deepEqual(keys(plan.handover), sorted(shapes.handoverKeys));
    assert.deepEqual(keys(plan.appointment), sorted(shapes.appointmentKeys)); assert.deepEqual(plan.choices.map(keys), plan.choices.map(() => sorted(shapes.choiceKeys)));
    assert.deepEqual(keys(plan.offeredSlots), sorted(shapes.offeredSlotsKeys));
  };
  const idle = await f.plan(); expectShape(idle, 'not-planned');
  await f.scheduleHandover();
  const open = await f.plan();
  const requested = (await f.ask('separate', open.offeredSlots.separate[0].slotId)).value; expectShape(requested, 'return-requested');
  assert.deepEqual(keys(requested.requestedSlot), sorted(shapes.slotKeys));
  await f.advance(DELAY); await f.tick();
  const scheduled = await f.plan(); expectShape(scheduled, 'return-scheduled');
  assert.deepEqual(keys(scheduled.slot), sorted(shapes.slotKeys));

  const g = await setup(t, { order: 'new' });
  const none = await g.plan();
  assert.deepEqual(keys(none), sorted(shapes.readModelKeys));
  assert.deepEqual([none.applicable, none.state, none.scheduled, none.appointment, none.choices, none.offeredSlots], [shapes.newOrder.applicable, shapes.newOrder.state, shapes.newOrder.scheduled, null, [], {}]);

  const errors = [['new order', await g.ask('separate', 'x'), shapes.errors.newOrder], ['too early', await (await setup(t)).ask('separate', 'x'), shapes.errors.handoverNotReady],
    ['different slot', await f.ask('separate', 'slot-other'), shapes.errors.alreadyRequested],
    ['unknown choice', await f.ask('weekly', 'x'), shapes.errors.unknownChoice], ['other employee', await f.ask('separate', 'x', f.alex), shapes.errors.forbidden]];
  for (const [name, got, want] of errors) {
    // The too-early case runs on a fresh order whose approval has not finished, so only its status and code are fixed.
    assert.deepEqual([got.status, got.code ?? null], [want.status, want.code], name);
    assert.deepEqual(keys(got), sorted(want.keys), name);
  }
});

// FUCQ-168: returned and missed outcomes, the current-car relationship and the missed-return exception receipt.
const OUTCOME = seedRow('lifecycle.return.outcome.v1').value;
const outcomePolicy = (outcome) => policyWith((get) => Object.assign(get('lifecycle.return.outcome.v1'), { enabled: true, outcome }));
async function scheduledReturn(f) {
  await f.approve(); await f.scheduleHandover();
  const slot = (await f.plan()).offeredSlots.separate[0];
  assert.equal((await f.ask('separate', slot.slotId)).status, 'ok');
  await f.advance(DELAY); await f.tick();
  const plan = await f.plan(); assert.equal(plan.state, 'return-scheduled'); return plan;
}
// Moves the demo clock to `offsetSeconds` after the keyed outcome time of the scheduled return, then ticks.
async function passReturn(f, plan, offsetSeconds = 1) {
  const due = Date.parse(plan.slot.end) + OUTCOME.delaySecondsAfterSlotEnd * 1000 + offsetSeconds * 1000;
  const by = Math.ceil((due - Date.parse(await f.now())) / 1000); if (by > 0) await f.advance(by);
  await f.tick(); return f.plan();
}
const rows = async (f, consumerId) => (await f.repository.query(f.paula, 'event_receipts', { consumerId })).value;

test('FUCQ-168: by default no outcome is reported, so the scheduled return and current car stay as they are', async (t) => {
  const f = await setup(t);
  const scheduled = await scheduledReturn(f);
  const after = await passReturn(f, scheduled, 3 * HOUR); await f.tick();
  assert.deepEqual([after.state, after.scheduled, after.outcome], ['return-scheduled', true, null]);
  assert.deepEqual(after.relationship.currentCar, { kind: 'contract', contractId: f.contract.contractId, slotId: scheduled.vehicleSlotId });
  assert.deepEqual([(await rows(f, RETURN_OUTCOME_STATE)).length, (await rows(f, RETURN_OUTCOME_CONSUMER)).length], [0, 0]);
  await f.sameCar('default policy after the return slot');
});

test('FUCQ-168: a confirmed return is recorded with location, appointment, demo-clock time and provider reference, and only then changes the current car', async (t) => {
  const f = await setup(t, { policy: await outcomePolicy('returned') });
  const scheduled = await scheduledReturn(f);
  const held = { kind: 'contract', contractId: f.contract.contractId, slotId: scheduled.vehicleSlotId };
  assert.deepEqual([scheduled.relationship.currentCar, scheduled.relationship.oldCar.status, scheduled.relationship.newCar.status], [held, 'held', 'on-order'],
    'acceptance, approval and scheduling never change the current car');
  const early = await passReturn(f, scheduled, -60);
  assert.deepEqual([early.state, early.outcome, early.pending, early.relationship.currentCar], ['return-scheduled', null, null, held], 'before the keyed time the retailer has not confirmed');
  const done = await passReturn(f, scheduled); const at = await f.now();
  assert.deepEqual([done.state, done.scheduled, done.owner, done.nextStep], ['returned', false, OUTCOME.ownership.returned.owner, OUTCOME.ownership.returned.nextStep]);
  assert.deepEqual(done.outcome, { state: 'returned', at, location: scheduled.location, appointment: { purpose: 'return', slotId: scheduled.slot.slotId, slot: scheduled.slot,
    providerReference: scheduled.providerReference }, providerReference: done.outcome.providerReference, oldContractId: f.contract.contractId });
  assert.match(done.outcome.providerReference, /^SYN-RET-/);
  assert.deepEqual(done.history.at(-1), { state: 'returned', appointmentState: null, at, providerReference: done.outcome.providerReference });
  const r = done.relationship;
  assert.equal(r.currentCar, null, 'returned before the new car handover is confirmed: no current car until FUCQ-167 confirms it');
  assert.deepEqual([r.oldCar.status, r.oldCar.returnedAt, r.oldCar.providerReference, r.oldCar.location], ['returned', at, done.outcome.providerReference, scheduled.location]);
  assert.deepEqual(r.changes.map((c) => [c.type, c.at, c.appointment.providerReference]), [['return-confirmed', at, scheduled.providerReference]]);
  assert.ok(done.assumptions.some((a) => a.key === 'lifecycle.return.outcome.v1' && a.status === 'assumed'));
  // Repeated ticks change nothing: one operation, one provider receipt, one relationship event.
  await f.tick(); await f.advance(HOUR); await f.tick();
  assert.deepEqual(await f.plan(), done);
  const ops = (await f.repository.query(f.paula, 'pending_operations', { operationType: 'lifecycle-return-outcome' })).value;
  assert.deepEqual([ops.length, ops[0].state, (await rows(f, RETURN_OUTCOME_CONSUMER)).length, (await rows(f, CURRENT_CAR_EVENTS)).length], [1, 'completed', 1, 1]);
  assert.equal((await rows(f, RETURN_EXCEPTION_CONSUMER)).length, 0, 'a confirmed return raises no exception');
  assert.equal((await f.handoverView()).state, 'scheduled', 'the handover is untouched');
  assert.deepEqual((await f.plan(f.greg)).outcome, done.outcome, 'the scheme team reads the same outcome');
  assert.equal((await f.returns.read(f.alex, { orderUuid: f.orderUuid })).status, 'forbidden');
});

test('FUCQ-168: a missed return keeps the current car and emits the keyed lifecycle-exception receipt the renewal-risk trigger opens a case from', async (t) => {
  const f = await setup(t, { policy: await outcomePolicy('missed'), cases: true });
  const scheduled = await scheduledReturn(f);
  const missed = await passReturn(f, scheduled); const at = await f.now();
  assert.deepEqual([missed.state, missed.scheduled, missed.owner, missed.nextStep], ['return-missed', false, OUTCOME.ownership.missed.owner, OUTCOME.ownership.missed.nextStep]);
  assert.deepEqual([missed.outcome.state, missed.outcome.at, missed.outcome.location, missed.outcome.appointment.providerReference], ['return-missed', at, scheduled.location, scheduled.providerReference]);
  assert.deepEqual([missed.relationship.currentCar, missed.relationship.oldCar.status, missed.relationship.changes],
    [{ kind: 'contract', contractId: f.contract.contractId, slotId: scheduled.vehicleSlotId }, 'held', []]);
  const receipts = await rows(f, RETURN_EXCEPTION_CONSUMER);
  assert.equal(receipts.length, 1);
  const [e] = receipts;
  assert.deepEqual([e.eventId, e.eventType, e.state, e.outcome.status], [`${f.orderUuid}:return-missed`, OUTCOME.exceptionType, 'completed', 'ok']);
  assert.ok(seedRow('renewalCase.lifecycle.eventTypes').value.includes(e.eventType), 'the renewal-risk trigger selects this exception type');
  assert.deepEqual(keys(e.outcome.value), sorted(shapes.exceptionKeys));
  assert.deepEqual([e.outcome.value.employeeId, e.outcome.value.renewalId, e.outcome.value.orderUuid, e.outcome.value.occurredAt, e.outcome.value.providerReference],
    [f.paula.employeeId, `renewal:${f.paula.employeeId}`, f.orderUuid, at, missed.outcome.providerReference]);
  await f.tick();
  const cases = await f.renewalCases.list(f.greg); assert.equal(cases.status, 'ok', JSON.stringify(cases));
  const opened = cases.value.cases.filter((c) => c.trigger?.sourceId === `${RETURN_EXCEPTION_CONSUMER}:${f.orderUuid}:return-missed`);
  assert.equal(opened.length, 1, 'the renewal-risk trigger opened one case from the missed return');
  await f.tick();
  assert.equal((await rows(f, RETURN_EXCEPTION_CONSUMER)).length, 1, 'repeat ticks emit no second receipt');
  await f.sameCar('missed return');
});

test('FUCQ-168: only a confirmed handover completion or return changes the current car, by exact order and contract identity', async (t) => {
  const f = await setup(t);
  const system = { environmentId: f.paula.environmentId, runId: f.paula.runId, principalId: 'lifecycle-appointments', roles: [] };
  const appointment = { purpose: 'handover', slotId: 'slot-x', providerReference: 'SYN-APT-HANDOVER' };
  const event = (over) => ({ type: 'handover-completed', orderUuid: f.orderUuid, employeeId: f.paula.employeeId, occurredAt: '2026-11-06T10:00:00.000Z',
    providerReference: 'SYN-APT-DONE', appointment, ...over });
  const before = (await readCurrentCar(f.repository, f.paula, f.orderUuid)).value;
  assert.deepEqual([before.currentCar.kind, before.oldCar.contractId, before.newCar.orderUuid], ['contract', f.contract.contractId, f.orderUuid]);
  for (const [name, bad, status, code] of [['acceptance is not an event', event({ type: 'offer-accepted' }), 'invalid', 'invalid-current-car-event'],
    ['another employee', event({ employeeId: f.alex.employeeId }), 'forbidden', undefined],
    ['another contract', event({ type: 'return-confirmed', oldContractId: 'contract-other' }), 'conflict', 'current-car-identity-mismatch'],
    ['unknown order', event({ orderUuid: 'order-missing' }), 'not-found', undefined]]) {
    const got = await recordCurrentCarEvent(f.repository, system, bad); assert.deepEqual([got.status, got.code], [status, code], name);
  }
  assert.deepEqual((await readCurrentCar(f.repository, f.paula, f.orderUuid)).value, before, 'refused events change nothing');
  const collected = await recordCurrentCarEvent(f.repository, system, event());
  assert.equal(collected.status, 'ok', JSON.stringify(collected));
  assert.deepEqual([collected.value.applied, collected.value.relationship.currentCar], [true, { kind: 'order', orderUuid: f.orderUuid, vin: null }]);
  assert.equal(collected.value.relationship.oldCar.status, 'held', 'the old car is still held until its return is confirmed');
  const repeat = await recordCurrentCarEvent(f.repository, system, event());
  assert.deepEqual([repeat.status, repeat.value.relationship, (await rows(f, CURRENT_CAR_EVENTS)).length], ['ok', collected.value.relationship, 1], 'a repeat replays, changing nothing');
  const inner = await f.repository.transaction(system, { commandId: 'inner-repeat', inputDigest: inputDigest('inner') }, (tx) => applyCurrentCarEvent(tx, system.runId, event()));
  assert.deepEqual([inner.status, inner.value.applied, inner.value.relationship], ['ok', false, collected.value.relationship], 'a repeat inside another transaction is a no-op');
  const changed = await recordCurrentCarEvent(f.repository, system, event({ providerReference: 'SYN-APT-OTHER' }));
  assert.deepEqual([changed.status, changed.code], ['conflict', 'idempotency-input-changed']);
  const returned = await recordCurrentCarEvent(f.repository, system, event({ type: 'return-confirmed', oldContractId: f.contract.contractId,
    appointment: { purpose: 'return', slotId: 'slot-y', providerReference: 'SYN-APT-RETURN' } }));
  assert.deepEqual([returned.value.relationship.currentCar.kind, returned.value.relationship.oldCar.status, returned.value.relationship.changes.map((c) => c.type)],
    ['order', 'returned', ['handover-completed', 'return-confirmed']]);
  await f.sameCar('relationship events leave the account record alone');

  const g = await setup(t, { order: 'new' });
  const gs = { ...system, runId: g.paula.runId, environmentId: g.paula.environmentId };
  const none = (await g.plan()).relationship;
  assert.deepEqual([none.oldCar, none.currentCar, none.newCar.status], [null, null, 'on-order'], 'a new order has no old car and no return plan');
  const refused = await recordCurrentCarEvent(g.repository, gs, { ...event({ orderUuid: g.orderUuid, employeeId: g.paula.employeeId }), type: 'return-confirmed', oldContractId: f.contract.contractId });
  assert.deepEqual([refused.status, refused.code], ['conflict', 'return-not-applicable']);
  const first = await recordCurrentCarEvent(g.repository, gs, event({ orderUuid: g.orderUuid, employeeId: g.paula.employeeId }));
  assert.deepEqual(first.value.relationship.currentCar, { kind: 'order', orderUuid: g.orderUuid, vin: null });
});

test('FUCQ-168: an uncertain outcome stays pending and is reconciled under the same operation ID; the live stub blocks and changes nothing', async (t) => {
  let fail = 1;
  const flaky = (repository) => { const real = createSyntheticReturnOutcomes({ repository });
    return { ...real, async confirmOutcome(op, now) { if (Date.parse(now) >= Date.parse(op.payload.confirmAfter) && fail-- > 0) throw new Error('timeout'); return real.confirmOutcome(op, now); } }; };
  const f = await setup(t, { policy: await outcomePolicy('returned'), outcomes: flaky });
  const scheduled = await scheduledReturn(f);
  const unsure = await passReturn(f, scheduled);
  assert.deepEqual([unsure.state, unsure.pending?.step, unsure.owner, unsure.relationship.oldCar.status], ['return-scheduled', 'outcome', OWNERSHIP.pending.owner, 'held']);
  await f.tick();
  const done = await f.plan();
  assert.deepEqual([done.state, done.pending, done.relationship.oldCar.status], ['returned', null, 'returned']);
  const ops = (await f.repository.query(f.paula, 'pending_operations', { operationType: 'lifecycle-return-outcome' })).value;
  assert.deepEqual([ops.length, ops[0].attempts, (await rows(f, RETURN_OUTCOME_CONSUMER)).length], [1, 1, 1]);

  const g = await setup(t, { policy: await outcomePolicy('returned'), outcomes: () => createLiveReturnOutcomesStub() });
  const live = await passReturn(g, await scheduledReturn(g));
  assert.deepEqual([live.state, live.blocked?.code, live.owner, live.relationship.oldCar.status], ['return-scheduled', 'live-return-outcomes-unsupported', OWNERSHIP.blocked.owner, 'held']);
  assert.deepEqual([(await rows(g, CURRENT_CAR_EVENTS)).length, (await rows(g, RETURN_EXCEPTION_CONSUMER)).length], [0, 0]);
  await g.sameCar('live stub');
});

test('FUCQ-168: recorded returned and missed response shapes match real service output', async (t) => {
  for (const [outcome, name] of [['returned', 'returned'], ['missed', 'return-missed']]) {
    const f = await setup(t, { policy: await outcomePolicy(outcome) });
    const plan = await passReturn(f, await scheduledReturn(f)); const want = shapes.states[name];
    assert.deepEqual(keys(plan), sorted(shapes.readModelKeys), name);
    assert.deepEqual([plan.state, plan.scheduled, plan.choice, plan.owner, plan.nextStep, plan.history.map((h) => h.state)],
      [want.state, want.scheduled, want.choice, want.owner, want.nextStep, want.history], name);
    assert.deepEqual([want.owner, want.nextStep], [OUTCOME.ownership[outcome].owner, OUTCOME.ownership[outcome].nextStep], `fixture ${name} matches the policy seed`);
    assert.deepEqual(keys(plan.outcome), sorted(shapes.outcomeKeys)); assert.deepEqual(keys(plan.outcome.appointment), sorted(shapes.outcomeAppointmentKeys));
    assert.deepEqual(keys(plan.relationship), sorted(shapes.relationshipKeys)); assert.deepEqual(keys(plan.relationship.oldCar), sorted(shapes.relationshipOldCarKeys));
    assert.deepEqual(keys(plan.relationship.newCar), sorted(shapes.relationshipNewCarKeys));
    for (const c of plan.relationship.changes) assert.deepEqual(keys(c), sorted(shapes.relationshipChangeKeys));
    assert.deepEqual([plan.relationship.currentCar?.kind ?? null, plan.relationship.oldCar.status], [want.currentCar, want.oldCarStatus], name);
  }
});

// FUCQ-167 x FUCQ-168: the real handover completion, gated by real FUCQ-116 readiness, is what makes the new car current.
const ACK = (orderUuid) => ({ commandId: 'ack', orderUuid, itemId: 'agreement-acknowledgement', acknowledgement: 'synthetic' });
test('FUCQ-168: a ready handover completed through the real appointment service makes the new order her current car; not-ready and refused completions do not', async (t) => {
  const f = await setup(t, { documents: true }); await f.approve(); await f.scheduleHandover();
  const held = (await readCurrentCar(f.repository, f.paula, f.orderUuid)).value;
  assert.deepEqual([held.currentCar.kind, held.oldCar.status, held.newCar.status], ['contract', 'held', 'on-order']);
  const early = await f.handover.complete(f.presenter, { orderUuid: f.orderUuid });
  assert.deepEqual([early.status, early.code], ['conflict', 'handover-not-ready']);
  assert.deepEqual([(await readCurrentCar(f.repository, f.paula, f.orderUuid)).value, (await rows(f, CURRENT_CAR_EVENTS)).length], [held, 0], 'a not-ready completion changes nothing');
  await f.advance(2 * DAY / 1000); await f.tick();
  assert.equal((await f.docs.completeTask(f.paula, ACK(f.orderUuid))).status, 'ok');
  assert.equal((await f.docs.readReadiness(f.greg, { orderUuid: f.orderUuid })).value.ready, true);
  const at = await f.now();
  const done = await f.handover.complete(f.greg, { orderUuid: f.orderUuid }); assert.equal(done.status, 'ok', JSON.stringify(done));
  assert.equal(done.value.state, 'completed');
  const r = (await readCurrentCar(f.repository, f.paula, f.orderUuid)).value;
  assert.deepEqual([r.currentCar, r.oldCar.status, r.newCar.status, r.newCar.collectedAt], [{ kind: 'order', orderUuid: f.orderUuid, vin: null }, 'held', 'collected', at]);
  assert.deepEqual(r.changes.map((c) => [c.type, c.at, c.providerReference, c.appointment.purpose, c.appointment.slotId]),
    [['handover-completed', at, done.value.outcome.providerReference, 'handover', done.value.slot.slotId]]);
  assert.deepEqual((await f.plan()).relationship, r, 'the return plan reads the same relationship');
  assert.equal((await f.handover.complete(f.greg, { orderUuid: f.orderUuid })).status, 'ok');
  assert.equal((await rows(f, CURRENT_CAR_EVENTS)).length, 1, 'a repeated completion records nothing more');

  const refuse = (p) => ({ ...p, async complete(op) { return { status: 'unsupported', operationId: op.operationId, orderUuid: op.payload.orderUuid, step: 'complete',
    code: 'live-appointments-unsupported', reason: 'Live appointment booking is not connected in this demonstration.' }; } });
  const g = await setup(t, { documents: true, wrapProvider: refuse }); await g.approve(); await g.scheduleHandover();
  await g.advance(2 * DAY / 1000); await g.tick();
  assert.equal((await g.docs.completeTask(g.paula, ACK(g.orderUuid))).status, 'ok');
  const refused = await g.handover.complete(g.greg, { orderUuid: g.orderUuid });
  assert.deepEqual([refused.status, refused.code], ['unsupported', 'live-appointments-unsupported']);
  const still = (await readCurrentCar(g.repository, g.paula, g.orderUuid)).value;
  assert.deepEqual([still.currentCar.kind, still.newCar.status, (await rows(g, CURRENT_CAR_EVENTS)).length], ['contract', 'on-order', 0], 'a refused completion changes nothing');
  await g.sameCar('refused completion');
});
