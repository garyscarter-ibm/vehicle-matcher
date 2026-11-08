// FUCQ-124: Paula's buddy order from the accepted second offer to a confirmed handover and separate return plan.
// Launcher on memory, loopback HTTPS, presenter ticks; every expected value is read through PolicyService.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assumption, launch, rows, stepper, tickTo, walkPaulasPath } from './helpers/gcsp-journey.js';

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const later = (instant, seconds) => iso(Date.parse(instant) + seconds * 1000);
const without = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();

/** Slots the keyed rule offers: `daysOffered` days from `lead` days after the clock date, at each daily start time. */
function expectedSlots(rule, now, { notBefore = -Infinity, notAfter = Infinity } = {}) {
  const today = Math.floor(Date.parse(now) / DAY) * DAY; const out = [];
  for (let d = 0; d < rule.daysOffered; d += 1) for (const time of [...rule.dailyStartTimes].sort()) {
    const [h, m] = time.split(':').map(Number); const start = today + (rule.earliestLeadDays + d) * DAY + (h * 60 + m) * 60000;
    if (start >= notBefore && start <= notAfter) out.push({ start: iso(start), end: iso(start + rule.slotMinutes * 60000) });
  }
  return out;
}
const times = (slots) => slots.map((slot) => ({ start: slot.start, end: slot.end }));

/** Allocation inputs (Alex's lapsing hold moves with the clock, so only Paula's rows): the account, her entitlement slot, her brief and her accepted car with its hold and claim. */
async function allocationInputs(f, seen) {
  const order = seen.second.orderUuid; const mine = (row) => row.employeeId === 'employee-paula';
  return { employees: await rows(f, 'employees'), slots: (await rows(f, 'entitlement_slots')).filter((row) => row.entitlementSlotId === 'slot-paula'), briefs: (await rows(f, 'briefs')).filter(mine),
    stock: (await rows(f, 'stock')).filter((row) => row.orderUuid === order), holds: (await rows(f, 'holds')).filter((row) => row.holdId === seen.second.holdId),
    claims: (await rows(f, 'claims')).filter((row) => row.holdId === seen.second.holdId) };
}

test('FUCQ-124 happy path, buddy route: approvals, handover, documents and a separate return plan, with the current car unchanged', async (t) => {
  const f = await launch(t, { environmentId: 'lifecycle-e2e' });
  const before = {};
  const seen = await walkPaulasPath(t, f, 'e2e', { beforeAccept: async (walk) => { before.inputs = await allocationInputs(f, walk); } });
  const step = stepper(t, () => !seen.operationId);
  const order = seen.second.orderUuid; const session = seen.sessions.paula;
  const get = async (path) => { const reply = await f.api(path, { session }); assert.equal(reply.status, 200, `${path} ${JSON.stringify(reply.json)}`); return reply.json.value; };
  const post = async (path, body) => { const reply = await f.api(path, { session, body }); assert.equal(reply.status, 200, `${path} ${JSON.stringify(reply.json)}`); return reply.json.value; };
  const progress = () => get(`/api/gcsp/orders/progress?orderUuid=${order}`);
  const handover = () => get(`/api/gcsp/appointments?orderUuid=${order}`);
  const returnPlan = () => get(`/api/gcsp/return-plan?orderUuid=${order}`);
  const documents = async () => (await get('/api/gcsp/documents')).orders.find((row) => row.orderUuid === order);
  const clockNow = async () => (await f.api('/api/gcsp/presenter/controls')).json.value.now;
  const car = async () => {
    const inputs = await allocationInputs(f, seen); const paula = inputs.employees.find((row) => row.employeeId === 'employee-paula');
    return { contract: paula.contract, slot: inputs.slots[0], inputs };
  };
  const state = {};

  await step('acceptance wrote only the allocation: the current car and the account are as they were', async () => {
    const after = await car(); state.afterAccept = after.inputs;
    const was = before.inputs;
    assert.deepEqual(after.inputs.employees, was.employees, 'no account row changed at acceptance');
    assert.deepEqual(after.inputs.briefs, was.briefs, 'no brief changed at acceptance');
    const slotBefore = was.slots[0];
    assert.equal(after.slot.state, 'allocated');
    assert.deepEqual(changedKeys(slotBefore, after.slot).filter((key) => !['state', 'version', 'updatedAt'].includes(key)), [], 'only the slot state moved');
    const contract = after.contract.manualContext.contracts.find((row) => row.status === 'current');
    assert.ok(contract, 'Paula still has a current contract');
    state.contract = structuredClone(contract); state.contractId = contract.contractId;
    state.car = structuredClone(await car());
  });

  await step('approvals: each stage is reached on its keyed tick, in the policy order, ending sent to ordering', async () => {
    const list = await assumption(f, 'ordering.approvalStages.v1'); const ticks = await assumption(f, 'lifecycle.approval.ticks.v1');
    assert.ok(list.length >= 1 && list.every((name) => Number.isSafeInteger(ticks[name])), 'every stage has a keyed tick count');
    const start = await progress();
    assert.deepEqual([start.route, start.stageList, start.currentStage, start.outcome], ['buddy', ['selection received', ...list], 'selection received', 'in-progress']);
    assert.deepEqual(start.stages.map((row) => [row.stage, row.state]), [['selection received', 'approved'], ...list.map((name) => [name, 'not-started'])]);
    let index = -1; let elapsed = 0; const approvedAt = {};
    for (let n = 1; n <= 1 + list.reduce((sum, name) => sum + ticks[name], 0); n += 1) {
      const tick = await tickTo(f, 'approval', { mode: 'step' });
      // Tick 1 starts the first stage; after that a stage is decided on its keyed tick and the next one starts in the same tick.
      if (index < 0) { index = 0; elapsed = 0; } else { elapsed += 1; if (elapsed >= ticks[list[index]]) { approvedAt[list[index]] = tick.now; index += 1; elapsed = 0; } }
      const view = await progress(); const done = index >= list.length;
      assert.deepEqual(view.stages.map((row) => row.state), ['approved', ...list.map((name, i) => (i < index ? 'approved' : i === index ? 'pending' : 'not-started'))], `tick ${n}`);
      assert.equal(view.currentStage, list[Math.min(index, list.length - 1)], `tick ${n}`);
      assert.equal(view.outcome, done ? 'sent-to-ordering' : 'in-progress', `tick ${n}`);
      state.approvedNow = tick.now;
    }
    const finished = await progress();
    assert.deepEqual(finished.stages.map((row) => row.stage), ['selection received', ...list], 'stages stay in the policy order');
    for (const name of list) {
      const row = finished.stages.find((entry) => entry.stage === name);
      assert.deepEqual([row.state, row.at], ['approved', approvedAt[name]], name);
      assert.ok(row.providerReference, `${name} carries the ordering provider reference`);
    }
    assert.deepEqual(finished.stages.map((row) => row.at), [...finished.stages.map((row) => row.at)].sort(), 'stage times never go backwards');
    assert.equal(finished.lifecycleRevision, list.length + 1);
    const ownership = (await assumption(f, 'lifecycle.approval.ownership.v1')).outcomes['sent-to-ordering'];
    assert.deepEqual([finished.owner, finished.nextStep], [ownership.owner, ownership.nextStep]);
  });

  await step('handover: Paula requests an offered slot and the retailer confirms it after the keyed delay', async () => {
    const slots = await assumption(f, 'lifecycle.appointments.slots.v1'); const confirmation = await assumption(f, 'lifecycle.appointments.confirmation.v1');
    const scenario = await assumption(f, 'lifecycle.appointments.scenario.v1'); const ownership = (await assumption(f, 'lifecycle.appointments.ownership.v1')).states;
    const open = await handover();
    assert.deepEqual([open.state, open.booked, open.eligibility.eligible, open.owner, open.nextStep], ['not-requested', false, true, ownership['not-requested'].owner, ownership['not-requested'].nextStep]);
    assert.deepEqual(times(open.offeredSlots), expectedSlots(slots, await clockNow()), 'the offered slots follow the keyed rule');
    const chosen = open.offeredSlots[0];
    const requested = await post('/api/gcsp/appointments/request', { orderUuid: order, slotId: chosen.slotId });
    assert.deepEqual([requested.state, requested.booked, requested.requestedSlot.slotId, requested.slot], ['requested', false, chosen.slotId, null]);
    assert.deepEqual([requested.owner, requested.nextStep], [ownership.requested.owner, ownership.requested.nextStep]);
    const askedAt = await clockNow();
    await tickTo(f, 'handover-early', { mode: 'to', to: later(askedAt, confirmation.confirmDelaySeconds - 60) });
    assert.equal((await handover()).state, 'requested', 'before the keyed delay the retailer has not answered');
    await tickTo(f, 'handover', { mode: 'to', to: later(askedAt, confirmation.confirmDelaySeconds) });
    let view = await handover();
    if (scenario.proposeChange) {
      assert.deepEqual([view.state, view.booked], ['change-proposed', false]);
      assert.notEqual(view.proposedSlot.slotId, chosen.slotId);
      await post('/api/gcsp/appointments/accept', { orderUuid: order, proposalId: view.proposalId });
      view = await handover();
    }
    const wanted = scenario.proposeChange ? view.proposedSlot ?? view.slot : chosen;
    assert.deepEqual([view.state, view.booked, view.slot.slotId, view.slot.start], ['scheduled', true, wanted.slotId, wanted.start]);
    assert.deepEqual([view.owner, view.nextStep], [ownership.scheduled.owner, ownership.scheduled.nextStep]);
    assert.match(view.history.at(-1).providerReference, /^SYN-APT-/);
    state.handover = view;
  });

  await step('documents: the employee task is completed, the other items finish on their keyed times and the order is ready', async () => {
    const policy = await assumption(f, 'lifecycle.documents.v1');
    const scheme = (await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula').schemeId;
    const items = policy.items.filter((item) => item.schemeIds.includes(scheme));
    const opened = await documents();
    assert.deepEqual(opened.items.map((row) => row.itemId), items.map((item) => item.itemId), 'the items are the policy items for Paula\'s scheme');
    assert.equal(opened.opening.stage, policy.openingStage); assert.equal(opened.opening.state, policy.openingState);
    for (const item of items) assert.equal(opened.items.find((row) => row.itemId === item.itemId).dueAt, later(opened.openedAt, item.dueSeconds), `${item.itemId} due`);
    assert.deepEqual([opened.readiness.ready, opened.readiness.state, opened.readiness.blocking], [false, 'waiting', items.map((item) => item.itemId)]);
    const mine = items.filter((item) => item.owner === 'employee' && item.kind === 'document');
    assert.deepEqual(opened.tasks.map((row) => row.itemId), mine.map((item) => item.itemId));
    for (const task of mine) {
      const body = { commandId: `e2e-complete-${task.itemId}`, orderUuid: order, itemId: task.itemId, acknowledgement: 'synthetic' };
      const done = await post('/api/gcsp/documents/tasks/complete', body);
      assert.deepEqual(await post('/api/gcsp/documents/tasks/complete', body), done, 'the same command ID replays the same outcome');
      assert.equal((await documents()).items.find((row) => row.itemId === task.itemId).status, 'complete');
    }
    const mid = await documents();
    assert.equal(mid.readiness.ready, false, 'the other items have not progressed yet');
    const last = Math.max(...items.filter((item) => item.progressSeconds).map((item) => item.progressSeconds));
    await tickTo(f, 'documents', { mode: 'to', to: later(mid.openedAt, last) });
    const done = await documents();
    assert.ok(done.items.every((row) => row.status === 'complete' && !row.overdue), JSON.stringify(done.items.map((row) => [row.itemId, row.status])));
    assert.deepEqual(done.readiness, { ready: true, state: 'ready', documentsComplete: true, vehicleReady: true, blocking: [], failed: [] });
    const readiness = await get(`/api/gcsp/documents/readiness?orderUuid=${order}`);
    assert.equal(JSON.stringify(readiness).includes('"ready":true'), true, 'the readiness view agrees');
  });

  await step('return: Paula plans a separate return, requested then scheduled after the keyed delay', async () => {
    const options = await assumption(f, 'lifecycle.return.options.v1'); const ownership = (await assumption(f, 'lifecycle.return.ownership.v1')).states;
    const confirmation = await assumption(f, 'lifecycle.appointments.confirmation.v1');
    const choice = options.choices.find((row) => row.id === 'separate'); assert.ok(choice, 'policy offers the separate-visit choice');
    const rule = options.rules.separate;
    const open = await returnPlan();
    assert.deepEqual([open.applicable, open.state, open.scheduled, open.oldContractId, open.vehicleSlotId], [true, 'not-planned', false, state.contractId, 'slot-paula']);
    assert.deepEqual(open.choices.map((row) => [row.id, row.label, row.available]), options.choices.map((row) => [row.id, row.label, true]));
    const end = Date.parse(state.handover.slot.end);
    assert.deepEqual(times(open.offeredSlots.separate), expectedSlots(rule.slots, await clockNow(), { notBefore: rule.notBeforeHandoverEnd ? end : -Infinity, notAfter: end + rule.maxDaysAfterHandover * DAY }));
    assert.deepEqual(open.offeredSlots['same-visit'], [state.handover.slot], 'same-visit offers only the handover slot');
    const chosen = open.offeredSlots.separate[0];
    const requested = await post('/api/gcsp/return-plan/request', { orderUuid: order, choice: choice.id, slotId: chosen.slotId });
    assert.deepEqual([requested.state, requested.scheduled, requested.choice, requested.slot, requested.requestedSlot.slotId], ['return-requested', false, 'separate', null, chosen.slotId]);
    assert.deepEqual([requested.owner, requested.nextStep], [ownership.requested.owner, ownership.requested.nextStep]);
    const askedAt = await clockNow();
    await tickTo(f, 'return', { mode: 'to', to: later(askedAt, confirmation.confirmDelaySeconds) });
    const plan = await returnPlan();
    assert.deepEqual([plan.state, plan.scheduled, plan.choice, plan.slot.slotId, plan.slot.start], ['return-scheduled', true, 'separate', chosen.slotId, chosen.start]);
    assert.deepEqual([plan.owner, plan.nextStep], [ownership.scheduled.owner, ownership.scheduled.nextStep]);
    assert.deepEqual(plan.history.map((row) => row.state), ['return-requested', 'return-scheduled']);
    assert.deepEqual([plan.handover.state, plan.handover.slot], ['scheduled', state.handover.slot], 'the handover is untouched by the return');
    assert.deepEqual(plan.location, { locationId: null, label: null, rule: rule.location }, 'the buddy route names no collection place');
    assert.deepEqual([plan.returnMileage.unit, plan.returnMileage.source, plan.currentCar.contractId, plan.currentCar.status, plan.currentCar.source], ['mi', 'selection', state.contractId, 'current', 'account']);
    assert.ok(Number.isSafeInteger(plan.returnMileage.value));
    const refs = [...plan.history, ...state.handover.history].map((row) => row.providerReference);
    assert.equal(new Set(refs).size, refs.length, 'handover and return never share a provider reference');
    state.plan = plan;
  });

  await step('stop at the confirmed plan: the current car and every allocation input are exactly as acceptance left them', async () => {
    const now = await car();
    assert.deepEqual(now.contract, state.car.contract, 'the account contract record is unchanged');
    const current = now.contract.manualContext.contracts.find((row) => row.contractId === state.contractId);
    assert.deepEqual(current, state.contract, 'status, slot and returned date of the current contract are unchanged');
    assert.equal(current.status, 'current'); assert.equal(current.returnedDate ?? null, state.contract.returnedDate ?? null);
    assert.deepEqual(now.slot, state.car.slot, 'the entitlement slot is unchanged');
    assert.deepEqual(now.inputs, state.afterAccept, 'no account, slot, brief, car, hold or claim changed after acceptance');
    assert.equal(state.plan.currentCar.status, 'current', 'the plan still reports the car as current, not returned');
  });
});
