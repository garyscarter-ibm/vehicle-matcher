// FUCQ-124 and FUCQ-171: the buddy order on the launcher, the manual order on the composed runtime, then the later handover, return and help cases.
// Every expected value is read through PolicyService; alternative policies are explicit seed edits before boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { actAs, assumption, confirmed, jar, launch, offerPath, openLink, readOffer, resetRun, rows, saveBrief, stepper, tickTo, walkPaulasPath } from './helpers/gcsp-journey.js';
import { good, setupManualRuntime, selectManualOrder } from './helpers/gcsp-manual-order.js';
import { EXCEPTION_CONSUMER } from '../gcsp/lifecycle/approvals/index.js';
import { CURRENT_CAR_EVENTS, readCurrentCar } from '../gcsp/lifecycle/current-car/index.js';
import { createLiveOrderingStatusStub } from '../gcsp/adapters/synthetic-ordering-status.js';

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

/** Launcher-style reads and posts for one order as one session; every route must answer 200. */
function reads(f, order, session) {
  const get = async (path) => { const reply = await f.api(path, { session }); assert.equal(reply.status, 200, `${path} ${JSON.stringify(reply.json)}`); return reply.json.value; };
  const post = async (path, body) => { const reply = await f.api(path, { session, body }); assert.equal(reply.status, 200, `${path} ${JSON.stringify(reply.json)}`); return reply.json.value; };
  return { get, post, progress: () => get(`/api/gcsp/orders/progress?orderUuid=${order}`), handover: () => get(`/api/gcsp/appointments?orderUuid=${order}`),
    returnPlan: () => get(`/api/gcsp/return-plan?orderUuid=${order}`), orderView: () => get('/api/gcsp/manual/order'),
    documents: async () => (await get('/api/gcsp/documents')).orders.find((row) => row.orderUuid === order),
    clockNow: async () => (await f.api('/api/gcsp/presenter/controls')).json.value.now };
}

/** Ticks one order from its first stage to the end of the policy list: each stage is decided on its keyed tick, in the policy order. */
async function walkApprovals(f, r, route) {
  const list = await assumption(f, 'ordering.approvalStages.v1'); const ticks = await assumption(f, 'lifecycle.approval.ticks.v1');
  assert.ok(list.length >= 1 && list.every((name) => Number.isSafeInteger(ticks[name])), 'every stage has a keyed tick count');
  const start = await r.progress();
  assert.deepEqual([start.route, start.stageList, start.currentStage, start.outcome], [route, ['selection received', ...list], 'selection received', 'in-progress']);
  assert.deepEqual(start.stages.map((row) => [row.stage, row.state]), [['selection received', 'approved'], ...list.map((name) => [name, 'not-started'])]);
  let index = -1; let elapsed = 0; let firstTickAt; const approvedAt = {}; const count = 1 + list.reduce((sum, name) => sum + ticks[name], 0);
  for (let n = 1; n <= count; n += 1) {
    const tick = await tickTo(f, 'approval', { mode: 'step' });
    if (n === 1) firstTickAt = tick.now;
    // Tick 1 starts the first stage; after that a stage is decided on its keyed tick and the next one starts in the same tick.
    if (index < 0) { index = 0; elapsed = 0; } else { elapsed += 1; if (elapsed >= ticks[list[index]]) { approvedAt[list[index]] = tick.now; index += 1; elapsed = 0; } }
    const view = await r.progress(); const done = index >= list.length;
    assert.deepEqual(view.stages.map((row) => row.state), ['approved', ...list.map((name, i) => (i < index ? 'approved' : i === index ? 'pending' : 'not-started'))], `tick ${n}`);
    assert.equal(view.currentStage, list[Math.min(index, list.length - 1)], `tick ${n}`);
    assert.equal(view.outcome, done ? 'sent-to-ordering' : 'in-progress', `tick ${n}`);
  }
  const finished = await r.progress();
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
  return { list, ticks, count, finished, approvedAt, firstTickAt };
}

/** The documents read right after approval: the policy items for the employee's scheme, due on their keyed times, not yet ready. */
async function expectDocumentsOpened(f, r) {
  const policy = await assumption(f, 'lifecycle.documents.v1');
  const scheme = (await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula').schemeId;
  const items = policy.items.filter((item) => item.schemeIds.includes(scheme));
  const opened = await r.documents();
  assert.deepEqual(opened.items.map((row) => row.itemId), items.map((item) => item.itemId), 'the items are the policy items for Paula\'s scheme');
  assert.equal(opened.opening.stage, policy.openingStage); assert.equal(opened.opening.state, policy.openingState);
  for (const item of items) assert.equal(opened.items.find((row) => row.itemId === item.itemId).dueAt, later(opened.openedAt, item.dueSeconds), `${item.itemId} due`);
  assert.deepEqual([opened.readiness.ready, opened.readiness.state, opened.readiness.blocking], [false, 'waiting', items.map((item) => item.itemId)]);
  return { items, opened };
}

test('FUCQ-124 happy path, buddy route: approvals, handover, documents and a separate return plan, with the current car unchanged', async (t) => {
  const f = await launch(t, { environmentId: 'lifecycle-e2e' });
  const before = {};
  const seen = await walkPaulasPath(t, f, 'e2e', { beforeAccept: async (walk) => { before.inputs = await allocationInputs(f, walk); } });
  const step = stepper(t, () => !seen.operationId);
  const order = seen.second.orderUuid; const session = seen.sessions.paula;
  const { get, post, progress, handover, returnPlan, documents, clockNow } = reads(f, order, session);
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
    await walkApprovals(f, { progress }, 'buddy');
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
    const { items, opened } = await expectDocumentsOpened(f, { documents });
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
    assert.deepEqual(plan.location, { locationId: null, kind: 'home-address', label: '1 Fictional Way, Example Town, ZZ1 1ZZ', rule: 'home-address' },
      'FUCQ-194: the buddy route collects the old car from the home address on her account');
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

/** One manual (cart) order on the composed runtime, produced by the real FUCQ-71 service; reads go over the same HTTP routes as the buddy test. */
async function manualRun(t, edit) {
  const f = await setupManualRuntime(t, { edit }); good(f.startup);
  const picked = await selectManualOrder(f); const order = picked.car.orderUuid;
  return { f, order, picked, session: f.session, ...reads(f, order, f.session) };
}
/** Switches the presenter to a demo principal over the route the browser uses and returns that principal's cookie. */
async function asPrincipal(f, name) {
  const switched = await f.api('/api/gcsp/session/switch', { body: { principalId: `demo-${name}`, commandId: `e2e-as-${name}-${++f.counter}` } });
  assert.equal(switched.status, 200, JSON.stringify(switched.json));
  return jar(switched.headers.getSetCookie());
}
/** Tables the allocator reads as its input (server/gcsp/allocation/index.js), plus its policy keys. */
const ALLOCATION_TABLES = ['briefs', 'employees', 'entitlement_slots', 'stock', 'holds', 'claims', 'offers', 'decisions'];
const allocatorInputs = async (f) => ({ tables: Object.fromEntries(await Promise.all(ALLOCATION_TABLES.map(async (name) => [name, await rows(f, name)]))),
  policy: [await assumption(f, 'allocation.tieBreak.rule'), await assumption(f, 'allocation.tieBreak.seed')] });

test('FUCQ-124 shared lifecycle entry: the manual cart selection is accepted by approvals, documents, handover and return plan', async (t) => {
  const m = await manualRun(t); const { f, order, picked } = m;
  const step = stepper(t); const state = {};
  const selection = picked.operation.payload.selection;

  await step('the producer is the manual handoff: one cart selection-order record, read as the manual route', async () => {
    assert.equal(selection.source.type, 'cart');
    const operations = (await rows(f, 'pending_operations')).filter((row) => row.operationType === 'selection-order');
    assert.deepEqual(operations.map((row) => [row.operationId, row.state, row.payload.selection.source.type]), [[picked.submitted.operationId, 'completed', 'cart']]);
    const start = await m.progress();
    assert.deepEqual([start.route, start.source.sourceType, start.source.operationId, start.renewalAuthority, start.contractVersion], ['manual', 'cart', picked.submitted.operationId, 'validated', 'lifecycle.stages.v1']);
    const fixtures = JSON.parse(await readFile(new URL('./fixtures/gcsp-lifecycle-approval-outcomes.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(start).sort(), Object.keys(fixtures['sent-to-ordering'].value).sort(), 'the same read model as every other source');
    const view = await m.orderView(); const list = await assumption(f, 'ordering.approvalStages.v1');
    assert.deepEqual([view.view.state, view.progress.stages.map((row) => row.name)], ['awaiting-approval', ['selection received', ...list]]);
  });

  await step('approvals: the same stage walk as the buddy order, ending sent to ordering', async () => {
    state.walk = await walkApprovals(f, m, 'manual');
  });

  await step('documents: the same policy items open for the manual order', async () => {
    const { items, opened } = await expectDocumentsOpened(f, m);
    assert.equal(opened.opening.lifecycleRevision, state.walk.finished.lifecycleRevision);
    state.openedAt = opened.openedAt; state.items = items;
  });

  await step('handover and return plan: eligible after sent to ordering, offered by the keyed rules, with the manual collection place', async () => {
    const slots = await assumption(f, 'lifecycle.appointments.slots.v1'); const options = await assumption(f, 'lifecycle.return.options.v1');
    const open = await m.handover();
    assert.deepEqual([open.state, open.booked, open.eligibility.eligible], ['not-requested', false, true]);
    assert.deepEqual(times(open.offeredSlots), expectedSlots(slots, await m.clockNow()), 'the offered slots follow the keyed rule');
    const plan = await m.returnPlan();
    assert.deepEqual([plan.applicable, plan.state, plan.scheduled, plan.oldContractId, plan.vehicleSlotId], [true, 'not-planned', false, selection.oldContract.contractId, f.employee.entitlementSlotId]);
    assert.deepEqual(plan.choices.map((row) => row.id), options.choices.map((row) => row.id));
    assert.deepEqual([plan.returnMileage.value, plan.returnMileage.source, plan.currentCar.status], [selection.draft.choices.expectedReturnMileage, 'selection', 'current']);
    assert.equal(plan.location.locationId, selection.draft.choices.collectionLocationId, 'the manual route names the collection place the employee chose');
  });

  await step('refusals: another employee and a stale clock version are refused on the lifecycle routes', async () => {
    const alex = await asPrincipal(f, 'alex');
    for (const path of [`/api/gcsp/orders/progress?orderUuid=${order}`, `/api/gcsp/documents/readiness?orderUuid=${order}`, `/api/gcsp/appointments?orderUuid=${order}`, `/api/gcsp/return-plan?orderUuid=${order}`]) {
      assert.equal((await f.api(path, { session: alex })).status, 403, path);
    }
    const before = await f.api('/api/gcsp/presenter/controls');
    const stale = await f.api('/api/gcsp/presenter/controls/tick', { body: { commandId: 'e2e-stale-tick', expectedClockVersion: `${Number(before.json.value.clockVersion) - 1}`, mode: 'step' } });
    assert.deepEqual([stale.status, stale.json.status], [409, 'stale-version']);
    assert.equal((await f.api('/api/gcsp/presenter/controls')).json.value.now, before.json.value.now, 'the refused tick moved nothing');
  });

  await step('an overdue employee document shows overdue with its owner and records the keyed exception once', async () => {
    const item = state.items.find((row) => row.owner === 'employee' && row.kind === 'document');
    const exceptions = await assumption(f, 'lifecycle.documents.exceptions.v1');
    await tickTo(f, 'overdue', { mode: 'to', to: later(state.openedAt, item.dueSeconds) });
    assert.equal((await m.documents()).items.find((row) => row.itemId === item.itemId).overdue, false, 'on its due time it is not yet late');
    await tickTo(f, 'overdue', { mode: 'to', to: later(state.openedAt, item.dueSeconds + 60) });
    const late = await m.documents(); const row = late.items.find((entry) => entry.itemId === item.itemId);
    assert.deepEqual([row.overdue, row.owner, row.status, row.action], [true, item.owner, 'waiting-for-employee', item.action]);
    assert.deepEqual(late.tasks.map((task) => [task.itemId, task.overdue]), [[item.itemId, true]]);
    assert.deepEqual([late.readiness.ready, late.readiness.blocking.includes(item.itemId)], [false, true]);
    const receipts = (await rows(f, 'event_receipts')).filter((entry) => entry.consumerId === 'lifecycle-documents:exceptions:v1');
    assert.deepEqual(receipts.map((entry) => [entry.eventType, entry.outcome.value.orderUuid, entry.outcome.value.employeeId]), [[exceptions.overdue, order, 'employee-paula']]);
    await tickTo(f, 'overdue', { mode: 'step' });
    assert.equal((await rows(f, 'event_receipts')).filter((entry) => entry.consumerId === 'lifecycle-documents:exceptions:v1').length, 1, 'a later tick records no duplicate');
  });

  await step('help request: opens one case with a named owner and status, and changes no allocation input', async () => {
    const owner = await assumption(f, 'renewalCase.owner.role'); const dueHours = await assumption(f, 'renewalCase.response.dueHours');
    const help = await m.get('/api/gcsp/help');
    assert.deepEqual([help.opensCase, help.ownerRole, help.automaticRecoveryPriority], [false, owner, false]);
    assert.deepEqual((await m.get('/api/gcsp/cases')).cases, [], 'no case exists before the request');
    const before = await allocatorInputs(f);
    const body = { commandId: 'e2e-help', reason: 'My replacement may miss my contract end.' };
    const opened = (await m.post('/api/gcsp/cases', body)).case;
    assert.deepEqual([opened.status, opened.owner.role, opened.owner.name, opened.trigger.type, opened.employeeId, opened.renewalId],
      ['open', owner, 'Scheme team', 'employee-request', 'employee-paula', state.walk.finished.renewalId]);
    assert.equal(opened.dueAt, later(opened.openedAt, dueHours * 3600), 'the response time follows the keyed hours');
    assert.deepEqual((await m.post('/api/gcsp/cases', body)).case, opened, 'the same command ID replays the same case');
    assert.deepEqual((await m.get('/api/gcsp/cases')).cases.map((row) => [row.caseId, row.status, row.owner.role]), [[opened.caseId, 'open', owner]]);
    const listed = await f.api('/api/gcsp/scheme-team/cases', { session: await asPrincipal(f, 'greg') });
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    const employeeName = (await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula').name;
    assert.deepEqual(listed.json.value.cases.map((row) => [row.caseId, row.status, row.owner.role, row.employeeName]), [[opened.caseId, 'open', owner, employeeName]]);
    assert.equal((await f.api(`/api/gcsp/cases?caseId=${opened.caseId}`, { session: await asPrincipal(f, 'alex') })).status, 403, 'another employee cannot read the case');
    assert.equal((await rows(f, 'renewal_cases')).length, 1, 'the case itself was written');
    assert.deepEqual(await allocatorInputs(f), before, 'opening a case gives no recovery priority: every allocation input is unchanged');
  });
});

/** Walks one manual order through approvals, handover and return on the policy `edit` makes, recording what each retained read showed. */
async function observe(t, edit, { compareDelay } = {}) {
  const m = await manualRun(t, edit); const { f, order } = m;
  const startedAt = await m.clockNow(); const walk = await walkApprovals(f, m, 'manual');
  const view = await m.orderView(); const docs = await m.documents();
  const confirmation = await assumption(f, 'lifecycle.appointments.confirmation.v1');
  // Before the keyed delay the retailer has not answered; at it the request is confirmed.
  const confirmAfter = async (label, read, requested, scheduled) => {
    const askedAt = await m.clockNow();
    for (const wait of [...new Set([confirmation.confirmDelaySeconds - 60, compareDelay].filter((seconds) => seconds !== undefined && seconds < confirmation.confirmDelaySeconds))].sort((a, b) => a - b)) {
      await tickTo(f, `${label}-early`, { mode: 'to', to: later(askedAt, wait) });
      assert.equal((await read()).state, requested, `${label}: not yet answered after ${wait}s`);
    }
    await tickTo(f, label, { mode: 'to', to: later(askedAt, confirmation.confirmDelaySeconds) });
    const answered = await read(); assert.equal(answered.state, scheduled, label);
    return answered;
  };
  const open = await m.handover(); const chosen = open.offeredSlots[0];
  await m.post('/api/gcsp/appointments/request', { orderUuid: order, slotId: chosen.slotId });
  const booked = await confirmAfter('handover', m.handover, 'requested', 'scheduled');
  const plan = await m.returnPlan(); const separate = plan.offeredSlots.separate[0];
  await m.post('/api/gcsp/return-plan/request', { orderUuid: order, choice: 'separate', slotId: separate.slotId });
  const returned = await confirmAfter('return', m.returnPlan, 'return-requested', 'return-scheduled');
  assert.deepEqual([booked.slot.slotId, returned.slot.slotId], [chosen.slotId, separate.slotId]);
  return { ...walk, startedAt, stepMs: Date.parse(walk.firstTickAt) - Date.parse(startedAt), delay: confirmation.confirmDelaySeconds,
    progressStages: walk.finished.stageList, orderViewStages: view.progress.stages.map((row) => row.name), orderStatus: view.order.orderStatus,
    documentsRevision: docs.opening.lifecycleRevision };
}

test('FUCQ-124 policy change: dropping HR approval and lengthening two delays changes stages and timing consistently across the retained reads', async (t) => {
  const edit = (seed, byKey) => {
    const stages = byKey('ordering.approvalStages.v1'); stages.value = stages.value.filter((name) => name !== 'HR approval');
    byKey('lifecycle.approval.ticks.v1').value['sales-manager approval'] += 1;
    byKey('lifecycle.appointments.confirmation.v1').value.confirmDelaySeconds *= 2;
  };
  const base = await observe(t); const edited = await observe(t, edit, { compareDelay: base.delay });
  assert.ok(base.list.includes('HR approval') && !edited.list.includes('HR approval'), 'only the edited policy drops HR approval');
  assert.deepEqual(edited.list, base.list.filter((name) => name !== 'HR approval'), 'nothing else about the list changed');
  assert.ok(edited.delay > base.delay && edited.ticks['sales-manager approval'] > base.ticks['sales-manager approval'], 'the edited delays are longer');
  for (const run of [base, edited]) {
    const stages = ['selection received', ...run.list];
    assert.deepEqual([run.progressStages, run.orderViewStages], [stages, stages], 'the progress read and the order view show the policy stages');
    assert.equal(run.orderStatus, run.list[0], 'the order view starts at the first policy stage');
    assert.equal(run.documentsRevision, stages.length, 'the documents opened on the last policy stage');
    assert.ok(run.stepMs > 0);
    // Each stage is decided after the start tick plus every earlier stage's keyed ticks and its own.
    let cumulative = 1;
    for (const name of run.list) { cumulative += run.ticks[name]; assert.equal(Date.parse(run.approvedAt[name]) - Date.parse(run.startedAt), cumulative * run.stepMs, `${name} time`); }
  }
  assert.equal(base.count - edited.count, base.list.reduce((sum, name) => sum + base.ticks[name], 0) - edited.list.reduce((sum, name) => sum + edited.ticks[name], 0),
    'the walk shortens by exactly the dropped and lengthened ticks');
});

test('FUCQ-124 approval declined with a named renewal-risk case: the stage, the lifecycle exception and the owned case are all visible', async (t) => {
  const m = await manualRun(t, (seed, byKey) => { byKey('lifecycle.approval.declineScenario.v1').value.enabled = true; }); const { f, order } = m;
  const scenario = await assumption(f, 'lifecycle.approval.declineScenario.v1'); const list = await assumption(f, 'ordering.approvalStages.v1');
  const ownership = await assumption(f, 'lifecycle.approval.ownership.v1'); const owner = await assumption(f, 'renewalCase.owner.role');
  const dueHours = await assumption(f, 'renewalCase.response.dueHours'); const eventTypes = await assumption(f, 'renewalCase.lifecycle.eventTypes');
  assert.ok(scenario.enabled && list.includes(scenario.stage) && eventTypes.includes(scenario.eventType), 'the keyed scenario names a policy stage and a case-opening event');
  let view = await m.progress();
  for (let n = 0; n < 20 && view.outcome === 'in-progress'; n += 1) { await tickTo(f, 'decline', { mode: 'step' }); view = await m.progress(); }
  const declinedAt = list.indexOf(scenario.stage) + 1;
  assert.deepEqual(view.stages.map((row) => row.state), ['selection received', ...list].map((name, i) => (i < declinedAt ? 'approved' : i === declinedAt ? 'declined' : 'not-started')));
  assert.deepEqual([view.outcome, view.currentStage, view.owner, view.nextStep], ['declined', scenario.stage, ownership.outcomes.declined.owner, ownership.outcomes.declined.nextStep]);
  const exceptions = (await rows(f, 'event_receipts')).filter((row) => row.consumerId === EXCEPTION_CONSUMER);
  assert.deepEqual(exceptions.map((row) => [row.eventType, row.outcome.status]), [[scenario.eventType, 'ok']]);
  const recorded = exceptions[0].outcome.value;
  assert.deepEqual([recorded.employeeId, recorded.renewalId, recorded.orderUuid, recorded.reasonCode, recorded.occurredAt],
    ['employee-paula', view.renewalId, order, scenario.reasonCode, view.stages[declinedAt].at]);
  const { cases } = await m.get('/api/gcsp/cases'); const [opened] = cases;
  assert.equal(cases.length, 1);
  assert.deepEqual([opened.status, opened.owner.role, opened.owner.name, opened.trigger.type, opened.trigger.eventType, opened.trigger.orderUuid, opened.renewalId],
    ['open', owner, 'Scheme team', 'lifecycle-exception', scenario.eventType, order, view.renewalId]);
  assert.deepEqual([opened.openedAt, opened.dueAt], [view.stages[declinedAt].at, later(view.stages[declinedAt].at, dueHours * 3600)], 'opened on the declining tick, due on the keyed hours');
  const listed = await f.api('/api/gcsp/scheme-team/cases', { session: await asPrincipal(f, 'greg') });
  assert.deepEqual(listed.json.value.cases.map((row) => [row.caseId, row.status, row.owner.role]), [[opened.caseId, 'open', owner]], 'the scheme team sees the same owned case');
  // Nothing downstream opens for a declined order.
  const ineligible = (await assumption(f, 'lifecycle.appointments.ownership.v1')).ineligible; const handover = await m.handover();
  assert.deepEqual([handover.eligibility.eligible, handover.offeredSlots, handover.owner, handover.nextStep], [false, [], ineligible.owner, ineligible.nextStep]);
  assert.equal(await m.documents(), undefined, 'no documents open');
  assert.deepEqual([(await m.get(`/api/gcsp/documents/readiness?orderUuid=${order}`)).opened], [false]);
});

test('FUCQ-124 live-shaped ordering stub: approval reports unsupported, claims no success and opens nothing downstream', async (t) => {
  // The launcher cannot boot a live adapter, so the live-shaped stub replaces the synthetic status provider on the composed runtime's service.
  const m = await manualRun(t); const { f, order } = m;
  Object.assign(f.orderingAdapter.status, createLiveOrderingStatusStub());
  const list = await assumption(f, 'ordering.approvalStages.v1'); const ticks = await assumption(f, 'lifecycle.approval.ticks.v1');
  for (let n = 0; n < 1 + ticks[list[0]]; n += 1) await tickTo(f, 'live', { mode: 'step' });
  const view = await m.progress(); const stuck = { ...view };
  assert.deepEqual([view.outcome, view.currentStage, view.stages[1].state, view.stages.filter((row) => row.state === 'approved').length], ['in-progress', list[0], 'pending', 1]);
  assert.deepEqual([view.blocked.code, view.provider.mode, view.provider.synthetic, view.stages[1].providerReference], ['live-ordering-unsupported', 'live', false, null]);
  for (let n = 0; n < 3; n += 1) await tickTo(f, 'live-more', { mode: 'step' });
  const after = await m.progress();
  assert.deepEqual([after.stages.map((row) => row.state), after.lifecycleRevision, after.outcome], [stuck.stages.map((row) => row.state), stuck.lifecycleRevision, 'in-progress'], 'further ticks never advance it');
  assert.equal((await m.orderView()).view.state, 'awaiting-approval', 'the order view does not claim approval');
  const handover = await m.handover(); assert.deepEqual([handover.eligibility.eligible, handover.state], [false, 'not-requested']);
  assert.equal(await m.documents(), undefined);
  const refused = await f.api('/api/gcsp/appointments/request', { session: f.session, body: { orderUuid: order, slotId: 'slot-any' } });
  assert.notEqual(refused.status, 200, JSON.stringify(refused.json));
  assert.equal((await m.handover()).state, 'not-requested', 'a refused request books nothing');
});

// FUCQ-171: the later physical handover, return, no-show and advanced-help scenarios, over the same routes and runtimes as FUCQ-124.
const APPOINTMENT_EXCEPTIONS = 'lifecycle-appointments:exceptions:v1';
const RETURN_EXCEPTIONS = 'lifecycle-return:exceptions:v1';
const APPOINTMENTS = '/api/gcsp/appointments';
/** Policy edit (before boot) that turns on the synthetic return outcome; the delay and copy still come from the key. */
const returnOutcome = (outcome, delaySecondsAfterSlotEnd) => (seed, byKey) => {
  Object.assign(byKey('lifecycle.return.outcome.v1').value, { enabled: true, outcome, ...(delaySecondsAfterSlotEnd ? { delaySecondsAfterSlotEnd } : {}) });
};
const receiptsOf = async (f, consumerId) => (await rows(f, 'event_receipts')).filter((row) => row.consumerId === consumerId);
const policyVersions = new WeakMap();
/** Records the policy version a read exposes, per runtime; every read of one run must name the same one. */
const seenPolicy = (f, view) => { assert.ok(view.policyVersion, 'the read exposes its policy version'); policyVersions.set(f, (policyVersions.get(f) ?? new Set()).add(view.policyVersion)); return view; };
const heldOldCar = (contractId, slotId) => ({ kind: 'contract', contractId, slotId });

/** Books the first offered slot (or the first other than `not`) and lets the retailer confirm it on the keyed delay; accepts a keyed proposed change. */
async function bookHandover(f, r, { not } = {}) {
  const confirmation = await assumption(f, 'lifecycle.appointments.confirmation.v1'); const scenario = await assumption(f, 'lifecycle.appointments.scenario.v1');
  const chosen = (await r.handover()).offeredSlots.find((slot) => slot.slotId !== not);
  await r.post(`${APPOINTMENTS}/request`, { orderUuid: r.order, slotId: chosen.slotId });
  await tickTo(f, 'book', { mode: 'to', to: later(await r.clockNow(), confirmation.confirmDelaySeconds) });
  let view = await r.handover();
  if (scenario.proposeChange) { await r.post(`${APPOINTMENTS}/accept`, { orderUuid: r.order, proposalId: view.proposalId }); view = await r.handover(); }
  assert.deepEqual([view.state, view.booked], ['scheduled', true]);
  assert.match(view.history.at(-1).providerReference, /^SYN-APT-/);
  return seenPolicy(f, view);
}
/** Paula's own document tasks, then a tick to the last keyed progress time (or one step if that time has passed); the order must read ready. */
async function finishDocuments(f, r, items) {
  for (const task of items.filter((item) => item.owner === 'employee' && item.kind === 'document')) {
    await r.post('/api/gcsp/documents/tasks/complete', { commandId: `e2e-171-${task.itemId}`, orderUuid: r.order, itemId: task.itemId, acknowledgement: 'synthetic' });
  }
  const opened = await r.documents(); const target = later(opened.openedAt, Math.max(...items.filter((item) => item.progressSeconds).map((item) => item.progressSeconds)));
  await tickTo(f, 'docs-171', Date.parse(target) > Date.parse(await r.clockNow()) ? { mode: 'to', to: target } : { mode: 'step' });
  const done = await r.documents();
  assert.deepEqual(done.readiness, { ready: true, state: 'ready', documentsComplete: true, vehicleReady: true, blocking: [], failed: [] });
  return done;
}
/** Paula's current-car relationship read two ways that must agree: the service and the return plan's read model. */
async function currentCar(f, r) {
  const context = good(await f.services.identity.resolveSession({ authorized: true, cookie: r.session }));
  const direct = good(await readCurrentCar(f.services.repository, context, r.order));
  assert.deepEqual((await r.returnPlan()).relationship, direct, 'the return plan reads the service relationship');
  return direct;
}
/** The two cars stay separate: the old one by contract and slot, the new one by order. */
function expectSeparateCars(car, oldContractId, slotId, order) {
  assert.deepEqual([car.oldCar.contractId, car.oldCar.slotId, car.newCar.orderUuid, car.orderUuid], [oldContractId, slotId, order, order]);
  assert.notEqual(car.oldCar.contractId, car.newCar.orderUuid); assert.notEqual(car.oldCar.slotId, car.newCar.orderUuid);
}
/** A completion before readiness is refused as a conflict and changes nothing: not the appointment, the current car, an operation or a receipt. */
async function expectNotReady(f, r, session) {
  const outcomes = await assumption(f, 'lifecycle.appointments.outcomes.v1'); const snapshot = async () => ({ appointment: await r.handover(), car: await currentCar(f, r),
    events: await receiptsOf(f, CURRENT_CAR_EVENTS), operations: (await rows(f, 'pending_operations')).map((row) => row.operationId).sort(), inputs: await allocatorInputs(f) });
  const before = await snapshot(); const documents = await r.documents();
  const reply = await f.api(`${APPOINTMENTS}/complete`, { body: { orderUuid: r.order }, session });
  assert.equal(reply.status, 409, JSON.stringify(reply.json));
  const refusal = reply.json;
  assert.deepEqual([refusal.status, refusal.code, refusal.owner, refusal.nextStep], ['conflict', 'handover-not-ready', outcomes.notReady.owner, outcomes.notReady.nextStep]);
  assert.deepEqual([refusal.readiness.ready ?? false, refusal.readiness.documentsComplete, refusal.readiness.blocking], [false, false, documents.readiness.blocking]);
  assert.ok(refusal.readiness.blocking.length > 0, 'something still blocks the handover');
  assert.deepEqual(await snapshot(), before, 'a refused completion changes nothing');
  return refusal;
}
/** The presenter's completion over the route; returns the read model. */
async function completeHandover(f, r, session) {
  const reply = await f.api(`${APPOINTMENTS}/complete`, { body: { orderUuid: r.order }, session });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  return seenPolicy(f, reply.json.value);
}

test('FUCQ-171 manual handoff lifecycle: completion waits for readiness, then the new order becomes the current car and the old one stays held', async (t) => {
  const m = await manualRun(t); const { f, order, picked } = m; const step = stepper(t); const state = {};
  const old = picked.operation.payload.selection.oldContract.contractId; const slotId = f.employee.entitlementSlotId;
  const outcomes = await assumption(f, 'lifecycle.appointments.outcomes.v1');

  await step('approvals and documents: the manual order reaches sent to ordering and its documents open', async () => {
    await walkApprovals(f, m, 'manual'); state.items = (await expectDocumentsOpened(f, m)).items;
  });
  await step('handover scheduled: the current car is still the old contract and the new order is only on order', async () => {
    state.scheduled = await bookHandover(f, m); state.before = await currentCar(f, m);
    assert.deepEqual([state.before.currentCar, state.before.oldCar.status, state.before.newCar.status, state.before.changes], [heldOldCar(old, slotId), 'held', 'on-order', []]);
    expectSeparateCars(state.before, old, slotId, order);
    assert.equal((await receiptsOf(f, CURRENT_CAR_EVENTS)).length, 0, 'scheduling records no current-car event');
  });
  await step('completion before readiness is refused for the presenter and the scheme team, and Paula and Alex cannot attempt it', async () => {
    await expectNotReady(f, m); await expectNotReady(f, m, await asPrincipal(f, 'greg'));
    for (const session of [m.session, await asPrincipal(f, 'alex')]) assert.equal((await f.api(`${APPOINTMENTS}/complete`, { body: { orderUuid: order }, session })).status, 403);
    assert.equal((await m.handover()).state, 'scheduled');
  });
  await step('documents and car preparation finish, then the scheme team records a confirmed synthetic completion', async () => {
    await finishDocuments(f, m, state.items);
    state.inputs = await allocatorInputs(f);
    const at = await m.clockNow(); const done = await completeHandover(f, m, await asPrincipal(f, 'greg'));
    assert.deepEqual([done.state, done.booked, done.owner, done.nextStep, done.pending, done.blocked], ['completed', false, outcomes.states.completed.owner, outcomes.states.completed.nextStep, null, null]);
    assert.deepEqual([done.outcome.state, done.outcome.at], ['completed', at]);
    assert.match(done.outcome.providerReference, /^SYN-APT-/);
    assert.deepEqual(done.history.map((row) => row.state), ['requested', 'scheduled', 'completed']);
    assert.deepEqual(await completeHandover(f, m), done, 'the presenter repeating it reads the same outcome');
    assert.deepEqual(await m.handover(), done, 'Paula reads the same completed appointment');
    state.done = done; state.at = at;
  });
  await step('the current car changes: the new order is collected, the old contract stays held and the two identities stay apart', async () => {
    const car = await currentCar(f, m);
    assert.deepEqual([car.currentCar, car.oldCar.status, car.oldCar.returnedAt, car.newCar.status, car.newCar.collectedAt], [{ kind: 'order', orderUuid: order, vin: null }, 'held', null, 'collected', state.at]);
    expectSeparateCars(car, old, slotId, order);
    assert.deepEqual(car.changes.map((row) => [row.type, row.at, row.providerReference, row.appointment.purpose, row.appointment.slotId]),
      [['handover-completed', state.at, state.done.outcome.providerReference, 'handover', state.done.slot.slotId]]);
    assert.equal((await receiptsOf(f, CURRENT_CAR_EVENTS)).length, 1, 'one confirmed event, however often completion is repeated');
    const plan = await m.returnPlan();
    assert.deepEqual([plan.handover.state, plan.state, plan.oldContractId, plan.vehicleSlotId], ['completed', 'not-planned', old, slotId], 'the old car still has a return to plan');
  });
  await step('completion changes no allocation input, and the order stays allocated', async () => {
    assert.deepEqual(await allocatorInputs(f), state.inputs, 'the allocator reads exactly what it read before the completion');
    assert.equal((await rows(f, 'entitlement_slots')).find((row) => row.entitlementSlotId === slotId).state, 'allocated');
    assert.equal((await rows(f, 'stock')).find((row) => row.orderUuid === order).allocated, true);
    assert.equal(policyVersions.get(f).size, 1, 'every read named one policy version');
  });
});

/** The owned renewal-risk cases Greg's queue and Paula's own read both show, each with its trigger. */
async function casesFor(f, r) {
  const own = (await r.get('/api/gcsp/cases')).cases; const listed = await f.api('/api/gcsp/scheme-team/cases', { session: await asPrincipal(f, 'greg') });
  assert.equal(listed.status, 200, JSON.stringify(listed.json));
  assert.deepEqual(listed.json.value.cases.map((row) => row.caseId), own.map((row) => row.caseId), 'the scheme team queue holds the same cases');
  return own;
}

test('FUCQ-171 no-show then rebooking: the miss opens a case and changes nothing else, then attempt 2 completes and changes the current car', async (t) => {
  const m = await manualRun(t); const { f, order, picked } = m; const step = stepper(t); const state = {};
  const old = picked.operation.payload.selection.oldContract.contractId; const slotId = f.employee.entitlementSlotId;
  const outcomes = await assumption(f, 'lifecycle.appointments.outcomes.v1');

  await step('a scheduled handover on the manual order, with its documents open', async () => {
    await walkApprovals(f, m, 'manual'); state.items = (await expectDocumentsOpened(f, m)).items;
    state.first = await bookHandover(f, m); state.held = await currentCar(f, m);
  });
  await step('the presenter records a no-show: the keyed state, owner and next step, a fresh slot list and the missed slot kept on record', async () => {
    state.inputs = await allocatorInputs(f); const at = await m.clockNow();
    const reply = await f.api(`${APPOINTMENTS}/no-show`, { body: { orderUuid: order } });
    assert.equal(reply.status, 200, JSON.stringify(reply.json));
    const view = seenPolicy(f, reply.json.value); const keyed = outcomes.states['no-show'];
    assert.deepEqual([view.state, view.booked, view.owner, view.nextStep, view.attempt, view.previousAttempts, view.pending, view.blocked],
      ['no-show', false, keyed.owner, keyed.nextStep, 1, [], null, null]);
    assert.deepEqual([view.outcome.state, view.outcome.at], ['no-show', at]);
    assert.match(view.outcome.providerReference, /^SYN-APT-/);
    assert.deepEqual(view.history.map((row) => row.state), ['requested', 'scheduled', 'no-show']);
    assert.deepEqual([view.slot, view.eligibility.eligible], [state.first.slot, true], 'the missed slot stays on the record');
    assert.ok(view.offeredSlots.length > 0 && view.offeredSlots.every((slot) => Date.parse(slot.start) > Date.parse(at)), 'Paula is offered fresh slots, all after the miss');
    assert.deepEqual((await f.api(`${APPOINTMENTS}/no-show`, { body: { orderUuid: order }, session: await asPrincipal(f, 'greg') })).json.value, view, 'a repeat returns the same outcome');
    assert.equal((await f.api(`${APPOINTMENTS}/no-show`, { body: { orderUuid: order }, session: m.session })).status, 403, 'Paula cannot record her own no-show');
    state.noShow = view; state.at = at;
  });
  await step('the exception receipt is the keyed appointment-no-show once; the order stays allocated and the current car is unchanged', async () => {
    const [receipt, ...more] = await receiptsOf(f, APPOINTMENT_EXCEPTIONS); assert.equal(more.length, 0);
    assert.deepEqual([receipt.eventType, receipt.outcome.status], [outcomes.exceptionTypes.noShow, 'ok']);
    assert.deepEqual(receipt.outcome.value, { employeeId: 'employee-paula', renewalId: receipt.outcome.value.renewalId, orderUuid: order, occurredAt: state.at, entitlementSlotId: slotId,
      renewalAuthority: 'validated', exceptionType: outcomes.exceptionTypes.noShow, policyVersion: state.noShow.policyVersion, providerReference: state.noShow.outcome.providerReference, attempt: 1, fictional: true });
    assert.deepEqual(await allocatorInputs(f), state.inputs, 'a no-show gives no recovery priority: every allocation input is unchanged');
    assert.equal((await rows(f, 'entitlement_slots')).find((row) => row.entitlementSlotId === slotId).state, 'allocated');
    assert.deepEqual(await currentCar(f, m), state.held, 'the current car is still the old contract');
    assert.equal((await receiptsOf(f, CURRENT_CAR_EVENTS)).length, 0);
  });
  await step('the next tick opens one owned lifecycle-exception case for the missed handover, and later ticks add none', async () => {
    const owner = await assumption(f, 'renewalCase.owner.role'); const dueHours = await assumption(f, 'renewalCase.response.dueHours');
    assert.deepEqual(await casesFor(f, m), [], 'no case before the renewal-risk tick');
    await tickTo(f, 'no-show-case', { mode: 'step' });
    const [opened, ...more] = await casesFor(f, m); assert.equal(more.length, 0);
    assert.deepEqual([opened.status, opened.owner.role, opened.trigger.type, opened.trigger.eventType, opened.trigger.orderUuid, opened.renewalId],
      ['open', owner, 'lifecycle-exception', outcomes.exceptionTypes.noShow, order, 'renewal:employee-paula']);
    assert.equal(opened.dueAt, later(opened.openedAt, dueHours * 3600));
    await tickTo(f, 'no-show-case-again', { mode: 'step' });
    assert.equal((await casesFor(f, m)).length, 1); assert.equal((await receiptsOf(f, APPOINTMENT_EXCEPTIONS)).length, 1);
  });
  await step('rebooking: Paula picks another slot as attempt 2, the missed attempt stays on record and the retailer confirms on the keyed delay', async () => {
    const missed = state.first.slot; const previousRefs = state.noShow.history.map((row) => row.providerReference);
    const booked = await bookHandover(f, m, { not: missed.slotId });
    assert.deepEqual([booked.attempt, booked.previousAttempts.length, booked.previousAttempts[0].attempt, booked.previousAttempts[0].state, booked.previousAttempts[0].slot, booked.previousAttempts[0].outcome.state],
      [2, 1, 1, 'no-show', missed, 'no-show']);
    assert.deepEqual(booked.history.map((row) => row.state), ['requested', 'scheduled', 'no-show', 'requested', 'scheduled'], 'history is append-only');
    assert.notEqual(booked.slot.slotId, missed.slotId);
    const ids = (await rows(f, 'pending_operations')).map((row) => row.operationId).filter((id) => id.startsWith('appointment:'));
    assert.ok(ids.some((id) => /:a2:request$/.test(id)) && ids.some((id) => /:a2:confirm$/.test(id)), 'attempt 2 uses its own operation IDs');
    assert.ok(booked.history.slice(3).every((row) => !previousRefs.includes(row.providerReference)), 'attempt 2 never reuses a provider reference');
    assert.deepEqual(await currentCar(f, m), state.held, 'rebooking does not change the current car');
  });
  await step('completion is refused until readiness, then the rebooked handover completes and the new order becomes the current car', async () => {
    await expectNotReady(f, m); await finishDocuments(f, m, state.items);
    const done = await completeHandover(f, m, await asPrincipal(f, 'greg'));
    assert.deepEqual([done.state, done.attempt, done.previousAttempts.length, done.outcome.state], ['completed', 2, 1, 'completed']);
    assert.match(done.outcome.providerReference, /^SYN-APT-/); assert.notEqual(done.outcome.providerReference, state.noShow.outcome.providerReference);
    const car = await currentCar(f, m);
    assert.deepEqual([car.currentCar, car.oldCar.status, car.newCar.status, car.changes.map((row) => row.type)], [{ kind: 'order', orderUuid: order, vin: null }, 'held', 'collected', ['handover-completed']]);
    expectSeparateCars(car, old, slotId, order);
    assert.equal((await receiptsOf(f, APPOINTMENT_EXCEPTIONS)).length, 1, 'only the missed attempt raised an exception');
    assert.equal((await casesFor(f, m)).length, 1, 'the completion opens no further case');
    assert.equal(policyVersions.get(f).size, 1, 'every read named one policy version');
  });
});

test('FUCQ-171 missed return: the keyed delay decides when it is missed, the old car stays held and the exception opens one case', async (t) => {
  const m = await manualRun(t, (seed, byKey) => { returnOutcome('missed', 5400)(seed, byKey); }); const { f, order, picked } = m; const step = stepper(t); const state = {};
  const old = picked.operation.payload.selection.oldContract.contractId; const slotId = f.employee.entitlementSlotId;

  await step('a scheduled handover and a scheduled separate return, with the policy-keyed outcome enabled', async () => {
    const policy = await assumption(f, 'lifecycle.return.outcome.v1');
    assert.deepEqual([policy.enabled, policy.outcome, policy.delaySecondsAfterSlotEnd], [true, 'missed', 5400]);
    state.policy = policy;
    await walkApprovals(f, m, 'manual'); await bookHandover(f, m);
    const confirmation = await assumption(f, 'lifecycle.appointments.confirmation.v1');
    const open = await m.returnPlan(); const chosen = open.offeredSlots.separate[0];
    await m.post('/api/gcsp/return-plan/request', { orderUuid: order, choice: 'separate', slotId: chosen.slotId });
    await tickTo(f, 'return-171', { mode: 'to', to: later(await m.clockNow(), confirmation.confirmDelaySeconds) });
    state.scheduled = seenPolicy(f, await m.returnPlan());
    assert.deepEqual([state.scheduled.state, state.scheduled.slot.slotId, state.scheduled.outcome], ['return-scheduled', chosen.slotId, null]);
    state.held = await currentCar(f, m);
    assert.deepEqual([state.held.currentCar, state.held.oldCar.status, state.held.newCar.status], [heldOldCar(old, slotId), 'held', 'on-order']);
  });
  await step('before the keyed time the retailer has not reported; at it the return is missed with the keyed owner and next step', async () => {
    const due = Date.parse(state.scheduled.slot.end) + state.policy.delaySecondsAfterSlotEnd * 1000;
    await tickTo(f, 'return-early', { mode: 'to', to: iso(due - 60000) });
    const early = await m.returnPlan();
    assert.deepEqual([early.state, early.outcome, early.relationship.currentCar], ['return-scheduled', null, heldOldCar(old, slotId)]);
    assert.equal((await receiptsOf(f, RETURN_EXCEPTIONS)).length, 0);
    state.inputs = await allocatorInputs(f);
    await tickTo(f, 'return-missed', { mode: 'to', to: iso(due) });
    const missed = seenPolicy(f, await m.returnPlan()); const keyed = state.policy.ownership.missed;
    assert.deepEqual([missed.state, missed.scheduled, missed.owner, missed.nextStep], ['return-missed', false, keyed.owner, keyed.nextStep]);
    assert.deepEqual([missed.outcome.state, missed.outcome.at, missed.outcome.location, missed.outcome.oldContractId, missed.outcome.appointment.purpose, missed.outcome.appointment.slotId, missed.outcome.appointment.providerReference],
      ['return-missed', iso(due), state.scheduled.location, old, 'return', state.scheduled.slot.slotId, state.scheduled.providerReference]);
    assert.match(missed.outcome.providerReference, /^SYN-RET-/); assert.match(missed.outcome.appointment.providerReference, /^SYN-APT-/);
    state.missed = missed;
  });
  await step('the old car is still the current car: no relationship change, no current-car event, allocation untouched', async () => {
    const car = await currentCar(f, m);
    assert.deepEqual([car.currentCar, car.oldCar.status, car.oldCar.returnedAt, car.newCar.status, car.changes], [heldOldCar(old, slotId), 'held', null, 'on-order', []]);
    expectSeparateCars(car, old, slotId, order);
    assert.equal((await receiptsOf(f, CURRENT_CAR_EVENTS)).length, 0);
    assert.deepEqual(await allocatorInputs(f), state.inputs, 'a missed return gives no recovery priority');
  });
  await step('the keyed exception receipt is recorded once and the next tick opens one owned case from it', async () => {
    const [receipt, ...more] = await receiptsOf(f, RETURN_EXCEPTIONS); assert.equal(more.length, 0);
    assert.deepEqual([receipt.eventId, receipt.eventType, receipt.state, receipt.outcome.status], [`${order}:return-missed`, state.policy.exceptionType, 'completed', 'ok']);
    assert.ok((await assumption(f, 'renewalCase.lifecycle.eventTypes')).includes(receipt.eventType), 'the renewal-risk rule selects this exception type');
    assert.deepEqual([receipt.outcome.value.employeeId, receipt.outcome.value.orderUuid, receipt.outcome.value.occurredAt, receipt.outcome.value.oldContractId, receipt.outcome.value.entitlementSlotId, receipt.outcome.value.providerReference],
      ['employee-paula', order, state.missed.outcome.at, old, slotId, state.missed.outcome.providerReference]);
    const owner = await assumption(f, 'renewalCase.owner.role');
    await tickTo(f, 'return-case', { mode: 'step' });
    const [opened, ...rest] = await casesFor(f, m); assert.equal(rest.length, 0);
    assert.deepEqual([opened.status, opened.owner.role, opened.trigger.type, opened.trigger.eventType, opened.trigger.orderUuid, opened.trigger.sourceId], ['open', owner, 'lifecycle-exception', state.policy.exceptionType, order, `${RETURN_EXCEPTIONS}:${order}:return-missed`]);
    await tickTo(f, 'return-case-again', { mode: 'step' });
    assert.deepEqual([(await casesFor(f, m)).length, (await receiptsOf(f, RETURN_EXCEPTIONS)).length], [1, 1], 'repeat ticks add neither a receipt nor a case');
    assert.deepEqual((await currentCar(f, m)).currentCar, heldOldCar(old, slotId));
    assert.equal(policyVersions.get(f).size, 1, 'every read named one policy version');
  });
});

test('FUCQ-171 buddy lifecycle: from the confirmed plan to a completed handover, a separate confirmed return and the current car at each point', async (t) => {
  const f = await launch(t, { environmentId: 'lifecycle-e2e-171', edit: returnOutcome('returned') });
  const before = {};
  const seen = await walkPaulasPath(t, f, 'e2e171', { beforeAccept: async (walk) => { before.inputs = await allocationInputs(f, walk); } });
  const step = stepper(t, () => !seen.operationId);
  const order = seen.second.orderUuid; const session = seen.sessions.paula; const r = { ...reads(f, order, session), order, session }; const slotId = 'slot-paula';
  const outcomes = await assumption(f, 'lifecycle.appointments.outcomes.v1'); const outcomePolicy = await assumption(f, 'lifecycle.return.outcome.v1');
  const state = {};

  await step('approvals, documents and a scheduled handover: the current car is still the old contract', async () => {
    await walkApprovals(f, r, 'buddy'); state.items = (await expectDocumentsOpened(f, r)).items;
    state.scheduled = await bookHandover(f, r);
    const paula = (await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula');
    state.contract = paula.contract; state.old = paula.contract.manualContext.contracts.find((row) => row.status === 'current').contractId;
    state.held = await currentCar(f, r);
    assert.deepEqual([state.held.currentCar, state.held.oldCar.status, state.held.newCar.status], [heldOldCar(state.old, slotId), 'held', 'on-order']);
    expectSeparateCars(state.held, state.old, slotId, order);
  });
  await step('completion is refused before readiness and changes nothing, then succeeds once documents and the car are ready', async () => {
    await expectNotReady(f, r); await finishDocuments(f, r, state.items);
    state.inputs = await allocationInputs(f, seen); const at = await r.clockNow();
    const done = await completeHandover(f, r);
    assert.deepEqual([done.state, done.owner, done.nextStep, done.outcome.state, done.outcome.at], ['completed', outcomes.states.completed.owner, outcomes.states.completed.nextStep, 'completed', at]);
    assert.match(done.outcome.providerReference, /^SYN-APT-/);
    state.done = done; state.at = at;
  });
  await step('the current car is now the new order, the old contract is still held, and the account contract and allocation inputs are untouched', async () => {
    const car = await currentCar(f, r);
    assert.deepEqual([car.currentCar, car.oldCar.status, car.newCar.status, car.newCar.collectedAt], [{ kind: 'order', orderUuid: order, vin: null }, 'held', 'collected', state.at]);
    expectSeparateCars(car, state.old, slotId, order);
    assert.deepEqual(car.changes.map((row) => [row.type, row.providerReference]), [['handover-completed', state.done.outcome.providerReference]]);
    assert.deepEqual((await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula').contract, state.contract, 'the account contract records are not rewritten');
    assert.deepEqual(await allocationInputs(f, seen), state.inputs, 'completion changes no allocation input');
  });
  await step('a separate return is planned after collection (FUCQ-251), by the keyed choices', async () => {
    const options = await assumption(f, 'lifecycle.return.options.v1'); const confirmation = await assumption(f, 'lifecycle.appointments.confirmation.v1');
    const plan = await r.returnPlan();
    assert.deepEqual(plan.choices.map((row) => [row.id, row.available]), options.choices.map((row) => [row.id, options.rules[row.id].requiresHandoverStates.includes('completed')]));
    const chosen = plan.offeredSlots.separate[0]; assert.ok(Date.parse(chosen.start) >= Date.parse(state.done.slot.end), 'the return follows the handover slot');
    await r.post('/api/gcsp/return-plan/request', { orderUuid: order, choice: 'separate', slotId: chosen.slotId });
    await tickTo(f, 'return-171', { mode: 'to', to: later(await r.clockNow(), confirmation.confirmDelaySeconds) });
    state.plan = seenPolicy(f, await r.returnPlan());
    assert.deepEqual([state.plan.state, state.plan.slot.slotId, state.plan.handover.state, state.plan.outcome], ['return-scheduled', chosen.slotId, 'completed', null]);
    assert.deepEqual((await currentCar(f, r)).currentCar, { kind: 'order', orderUuid: order, vin: null }, 'planning the return never changes the current car');
  });
  await step('a confirmed return at the keyed time marks the old car returned and keeps the new order as the current car', async () => {
    const due = Date.parse(state.plan.slot.end) + outcomePolicy.delaySecondsAfterSlotEnd * 1000;
    await tickTo(f, 'return-early', { mode: 'to', to: iso(due - 60000) });
    assert.deepEqual([(await r.returnPlan()).state, (await r.returnPlan()).outcome], ['return-scheduled', null], 'before the keyed time the retailer has not confirmed');
    await tickTo(f, 'return-done', { mode: 'to', to: iso(due) });
    const done = seenPolicy(f, await r.returnPlan()); const keyed = outcomePolicy.ownership.returned;
    assert.deepEqual([done.state, done.scheduled, done.owner, done.nextStep], ['returned', false, keyed.owner, keyed.nextStep]);
    assert.deepEqual([done.outcome.state, done.outcome.at, done.outcome.location, done.outcome.oldContractId, done.outcome.appointment.providerReference],
      ['returned', iso(due), state.plan.location, state.old, state.plan.providerReference]);
    assert.match(done.outcome.providerReference, /^SYN-RET-/);
    const car = await currentCar(f, r);
    assert.deepEqual([car.currentCar, car.oldCar.status, car.oldCar.returnedAt, car.oldCar.providerReference, car.newCar.status], [{ kind: 'order', orderUuid: order, vin: null }, 'returned', iso(due), done.outcome.providerReference, 'collected']);
    assert.deepEqual(car.changes.map((row) => row.type), ['handover-completed', 'return-confirmed']);
    const refs = [...state.scheduled.history, ...state.plan.history, state.done.outcome, done.outcome].map((row) => row.providerReference);
    assert.equal(new Set(refs).size, refs.length, 'the new car and the old car never share a provider reference');
    assert.equal((await receiptsOf(f, RETURN_EXCEPTIONS)).length, 0, 'a confirmed return raises no exception');
  });
  await step('through the whole lifecycle no allocation input moved and the order stayed allocated', async () => {
    assert.deepEqual(await allocationInputs(f, seen), state.inputs);
    assert.equal((await rows(f, 'entitlement_slots')).find((row) => row.entitlementSlotId === slotId).state, 'allocated');
    assert.equal(policyVersions.get(f).size, 1, 'every read named one policy version');
  });
});

/** Paula's brief as the editor saves it with the charging essential confirmed (the shared helper omits it), over the brief routes. */
async function saveConfirmedBrief(f, label, session, body) {
  const brief = { schemaVersion: 1, preferences: { body: confirmed(body) }, essentials: { seats: { value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee' },
    charging: { value: 'home', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } };
  good((await f.api('/api/gcsp/brief/draft', { session, body: { commandId: `${label}-paula-draft`, expectedBriefVersion: 0, expectedDraftVersion: 0, brief } })).json, 'save draft');
  return good((await f.api('/api/gcsp/brief/confirm', { session, body: { commandId: `${label}-paula-confirm`, expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } })).json, 'confirm brief');
}

/** Paula's real first offer, declined for its body style over the offer routes: a confirmed brief (version 1) and one decline decision, with no follow-up change yet. */
async function declinedFirstOffer(t, f, label, charging = true) {
  await resetRun(f, label);
  const paula = await actAs(f, label, 'paula'); const alex = await actAs(f, label, 'alex');
  await (charging ? saveConfirmedBrief(f, label, paula, 'estate') : saveBrief(f, label, 'paula', paula, 'estate')); await saveBrief(f, label, 'alex', alex, 'estate');
  await tickTo(f, label, { mode: 'next-release' });
  const offer = (await rows(f, 'offers')).find((row) => row.employeeId === 'employee-paula' && row.state === 'active'); assert.ok(offer, 'Paula holds a pending offer');
  const job = (await rows(f, 'notification_outbox')).find((row) => row.offerId === offer.offerId);
  const message = good((await f.api('/api/gcsp/presenter/outbox')).json, 'outbox viewer').messages.find((row) => row.jobId === job.jobId);
  const { reply, selector, session } = await openLink(f, message.offerLink); assert.equal(reply.status, 200, JSON.stringify(reply.json));
  const reason = (await assumption(f, 'offer.declineReasons.v1')).reasons.find((row) => row.attribute === 'body'); const view = await readOffer(f, session, selector);
  const declined = await f.api(`${offerPath(selector)}/decision`, { session, body: { commandId: `${label}-decline`, runId: selector.runId, decision: 'decline', reasonCode: reason.code,
    expectedOfferVersion: view.offerVersion, expectedHoldVersion: view.holdVersion, expectedQuoteVersion: view.quote.revisions.quote } });
  assert.equal(declined.status, 200, JSON.stringify(declined.json));
  const decision = (await rows(f, 'decisions')).find((row) => row.employeeId === 'employee-paula' && row.decision === 'decline');
  return { paula, alex, decisionId: decision.decisionId, declinedOrder: offer.orderUuid };
}

const SCHEME = '/api/gcsp/scheme-team/cases';
/** The tables and rows that differ between two allocator-input reads, by table and row key (employee or id), so a diff can be asserted exactly. */
function inputDiff(a, b) {
  const out = {};
  for (const table of Object.keys(a.tables)) {
    const key = (row) => JSON.stringify([row.employeeId, row.briefVersion, row.entitlementSlotId, row.orderUuid, row.holdId, row.claimId, row.offerId, row.decisionId]);
    const was = new Map(a.tables[table].map((row) => [key(row), row])); const now = new Map(b.tables[table].map((row) => [key(row), row]));
    const changed = [...new Set([...was.keys(), ...now.keys()])].filter((k) => JSON.stringify(was.get(k)) !== JSON.stringify(now.get(k)))
      .map((k) => ({ row: JSON.parse(k).filter((v) => v !== undefined && v !== null), change: !was.has(k) ? 'added' : !now.has(k) ? 'removed' : changedKeys(was.get(k), now.get(k)) }));
    if (changed.length) out[table] = changed;
  }
  if (JSON.stringify(a.policy) !== JSON.stringify(b.policy)) out.policy = 'changed';
  return out;
}

test('FUCQ-171 advanced help: Paula asks near the deadline, Greg proposes a feasible remedy, and the proposal, her confirmation and the applied brief stay distinct', async (t) => {
  const f = await launch(t, { environmentId: 'lifecycle-e2e-171h' }); const step = stepper(t); const state = {}; const asked = 'My contract ends on 1 December and I have no car yet.';
  const owner = await assumption(f, 'renewalCase.owner.role'); const dueHours = await assumption(f, 'renewalCase.response.dueHours');
  const paulaGet = async (path) => { const reply = await f.api(path, { session: state.paula }); assert.equal(reply.status, 200, JSON.stringify(reply.json)); return reply.json.value; };
  const gregGet = async (path) => { const reply = await f.api(path, { session: state.greg }); assert.equal(reply.status, 200, JSON.stringify(reply.json)); return reply.json.value; };
  const update = (c, status, extra = {}) => f.api(`${SCHEME}/update`, { session: state.greg, body: { commandId: `e2e-171-${status}-${++f.counter}`, caseId: c.caseId, expectedVersion: c.version,
    status, reason: `Scheme team set ${status}.`, nextAction: `Next after ${status}.`, dueAt: later(state.now, dueHours * 3600), ...extra } });
  const ownCase = async () => (await paulaGet('/api/gcsp/cases')).cases.find((row) => row.caseId === state.caseId);

  await step('setup: Paula has a confirmed brief and one declined offer, and the clock enters the keyed deadline window', async () => {
    Object.assign(state, await declinedFirstOffer(t, f, 'help171')); state.greg = await asPrincipal(f, 'greg');
    state.end = (await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula').contract.manualContext.contracts.find((row) => row.status === 'current').contractEndDate;
    const within = await assumption(f, 'renewalCase.deadline.withinDays'); assert.ok(7 < within, 'one week before the end is inside the keyed window');
    state.now = iso(Date.parse(`${state.end}T09:00:00.000Z`) - 7 * DAY); await tickTo(f, 'near-deadline', { mode: 'to', to: state.now });
    state.brief1 = (await paulaGet('/api/gcsp/brief')).brief; state.inputs = await allocatorInputs(f);
    assert.deepEqual([state.brief1.briefVersion, state.brief1.preferences.body.value, state.brief1.status], [1, 'estate', 'confirmed']);
  });
  await step('the keyed deadline rule has opened the owned case; Paula\'s request appends to it rather than opening a second', async () => {
    const [auto, ...none] = (await paulaGet('/api/gcsp/cases')).cases; assert.equal(none.length, 0);
    assert.deepEqual([auto.status, auto.owner.role, auto.trigger.type, auto.renewalDeadline, auto.remedy, auto.version], ['open', owner, 'renewal-deadline', state.end, null, 1]);
    assert.equal(auto.dueAt, later(auto.openedAt, dueHours * 3600)); state.caseId = auto.caseId;
    const body = { commandId: 'e2e-171-help', reason: asked };
    const helped = await f.api('/api/gcsp/cases', { session: state.paula, body }); assert.equal(helped.status, 200, JSON.stringify(helped.json));
    const c = helped.json.value.case;
    assert.deepEqual([c.caseId, c.version, c.status, c.history.length], [auto.caseId, 2, 'open', 2]);
    assert.deepEqual([c.history[1].actorRole, c.history[1].reason, c.history[1].trigger.type], ['employee', asked, 'employee-request']);
    assert.deepEqual((await f.api('/api/gcsp/cases', { session: state.paula, body })).json, helped.json, 'the same command ID replays the same outcome');
    assert.equal((await paulaGet('/api/gcsp/cases')).cases.length, 1);
    assert.equal((await f.api(`/api/gcsp/cases?caseId=${auto.caseId}`, { session: state.alex })).status, 403, 'another employee cannot read the case');
    assert.deepEqual(await allocatorInputs(f), state.inputs, 'asking for help gives no recovery priority');
  });
  await step('Greg reads the case with feasible options; the read changes nothing and promises no car', async () => {
    const listed = (await gregGet(SCHEME)).cases.find((row) => row.caseId === state.caseId);
    assert.deepEqual([listed.status, listed.owner.role, listed.employeeName.startsWith('Paula')], ['open', owner, true]);
    const cases = await rows(f, 'renewal_cases');
    const read = await gregGet(`${SCHEME}/options?caseId=${state.caseId}`); state.options = read;
    assert.deepEqual([read.automaticRecoveryPriority, read.case.caseId, read.nextStatuses.includes('in-progress'), read.policyVersion], [false, state.caseId, true, read.case.policyVersion]);
    const item = read.options.preferenceRelaxations.items.find((row) => row.path === 'preferences.body.value'); assert.ok(item, 'body style is an editable single preference');
    assert.deepEqual([read.options.preferenceRelaxations.available, item.decisionId, item.expectedBriefVersion, item.before, item.values.includes('estate')], [true, state.decisionId, 1, 'estate', false]);
    assert.equal(read.options.contractExtension.available, await assumption(f, 'renewalCase.extension.permitted'), 'extension follows the keyed permission');
    assert.equal(read.options.manualDecision.requiresDecision, true);
    state.item = item; state.value = item.values[0];
    assert.deepEqual([await rows(f, 'renewal_cases'), await allocatorInputs(f)], [cases, state.inputs], 'reading options changes no case and no allocation input');
  });
  await step('Greg starts work: the case moves to in-progress by the scheme team and Paula sees it', async () => {
    const moved = await update((await ownCase()), 'in-progress'); assert.equal(moved.status, 200, JSON.stringify(moved.json));
    const c = moved.json.value.case;
    assert.deepEqual([c.status, c.nextAction, c.dueAt, c.history.at(-1).actorRole], ['in-progress', 'Next after in-progress.', later(state.now, dueHours * 3600), 'scheme-team']);
    assert.deepEqual([(await ownCase()).status, (await ownCase()).nextAction], ['in-progress', 'Next after in-progress.']);
  });
  await step('Greg proposes one preference change: the case records the proposal and no brief changes', async () => {
    const remedy = { type: 'preference-relaxation', decisionId: state.decisionId, expectedBriefVersion: 1, path: state.item.path, value: state.value };
    const proposed = await update(await ownCase(), 'remedy-proposed', { remedy }); assert.equal(proposed.status, 200, JSON.stringify(proposed.json));
    const c = proposed.json.value.case;
    assert.deepEqual([c.status, c.remedy.type, c.remedy.path, c.remedy.value, c.remedy.confirmationState], ['remedy-proposed', 'preference-relaxation', state.item.path, state.value, 'employee-confirmation-required']);
    assert.deepEqual((await paulaGet('/api/gcsp/brief')).brief, state.brief1, 'the proposal changes no brief');
    assert.deepEqual(await allocatorInputs(f), state.inputs, 'a proposal changes no allocation input');
    const mine = await ownCase();
    assert.deepEqual(mine.relaxation, { currentBriefVersion: 1, before: 'estate', applicable: true, confirmed: false });
    state.remedy = remedy;
  });
  await step('the case cannot be resolved on a proposal alone, even with browser-supplied confirmation fields', async () => {
    const before = await ownCase();
    const forged = { ...state.remedy, confirmationState: 'employee-confirmed', confirmedBy: 'demo-paula', confirmedAt: state.now, briefVersion: 2 };
    for (const remedy of [state.remedy, forged]) {
      const refused = await update(before, 'resolved', { remedy });
      assert.notEqual(refused.status, 200, JSON.stringify(refused.json)); assert.equal(refused.json.code, 'employee-confirmation-required');
    }
    assert.deepEqual(await ownCase(), before, 'the refused resolution changed nothing');
    assert.deepEqual(await allocatorInputs(f), state.inputs);
  });
  await step('Paula explicitly confirms the single change: only then does a new confirmed brief version exist', async () => {
    const input = { decisionId: state.decisionId, expectedBriefVersion: 1, change: { path: state.item.path, value: state.value } };
    const confirmedChange = await f.api('/api/gcsp/brief/change-after-decline', { session: state.paula, body: { commandId: 'e2e-171-confirm', ...input } });
    assert.equal(confirmedChange.status, 200, JSON.stringify(confirmedChange.json));
    assert.deepEqual((await f.api('/api/gcsp/brief/change-after-decline', { session: state.paula, body: { commandId: 'e2e-171-confirm', ...input } })).json, confirmedChange.json, 'replay is idempotent');
    const brief = (await paulaGet('/api/gcsp/brief')).brief;
    assert.deepEqual([brief.briefVersion, brief.status, brief.preferences.body.value], [2, 'confirmed', state.value]);
    assert.deepEqual({ ...brief.preferences, body: state.brief1.preferences.body }, state.brief1.preferences, 'no other preference moved');
    assert.deepEqual(brief.essentials, state.brief1.essentials, 'essentials are unchanged');
    const mine = await ownCase();
    assert.deepEqual([mine.status, mine.relaxation.confirmed, mine.remedy.confirmationState], ['remedy-proposed', true, 'employee-confirmation-required'], 'her confirmation does not itself resolve or rewrite the proposal');
    state.briefDiff = inputDiff(state.inputs, await allocatorInputs(f));
    assert.deepEqual(Object.keys(state.briefDiff), ['briefs'], 'the confirmed brief is the only allocation input that moved');
    assert.deepEqual(state.briefDiff.briefs.map((row) => [row.row[0], row.row[1], row.change]), [['employee-paula', 2, 'added']], 'exactly one new row: Paula\'s version 2');
  });
  await step('Greg resolves the case on the verified confirmation, and Paula reads the persisted outcome', async () => {
    const resolved = await update(await ownCase(), 'resolved', { remedy: state.remedy }); assert.equal(resolved.status, 200, JSON.stringify(resolved.json));
    const c = resolved.json.value.case;
    assert.deepEqual([c.status, c.remedy.confirmationState, c.remedy.confirmedBy, c.remedy.briefVersion], ['resolved', 'employee-confirmed', 'demo-paula', 2]);
    const mine = await ownCase();
    const { relaxation, ...persisted } = mine;
    assert.deepEqual(persisted, c, 'Paula reads exactly what was persisted');
    assert.deepEqual([relaxation.confirmed, relaxation.applicable, relaxation.currentBriefVersion], [true, false, 2], 'and her own read shows the applied, confirmed change');
    assert.deepEqual(mine.history.map((row) => [row.actorRole, row.status]), [['system', 'open'], ['employee', 'open'], ['scheme-team', 'in-progress'], ['scheme-team', 'remedy-proposed'], ['scheme-team', 'resolved']]);
    assert.deepEqual((await gregGet(SCHEME)).cases.find((row) => row.caseId === state.caseId).status, 'resolved');
    assert.equal(mine.policyVersion, state.options.policyVersion, 'the case records the policy version it was read under');
  });
  await step('across the whole case no allocation input moved except the one confirmed brief change', async () => {
    assert.deepEqual(inputDiff(state.inputs, await allocatorInputs(f)), state.briefDiff, 'opening, progressing, proposing and resolving added nothing beyond the confirmed change');
  });
});
test('FUCQ-258: with charging unconfirmed, a help case after a declined offer still gives Greg feasible options', async (t) => {
  const f = await launch(t, { environmentId: 'lifecycle-e2e-258' });
  const state = await declinedFirstOffer(t, f, 'help258', false); const greg = await asPrincipal(f, 'greg');
  const help = await f.api('/api/gcsp/cases', { session: state.paula, body: { commandId: 'e2e-258-help', reason: 'Please help with my renewal.' } });
  assert.equal(help.status, 200, JSON.stringify(help.json));
  const reply = await f.api(`${SCHEME}/options?caseId=${help.json.value.case.caseId}`, { session: greg });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  const { alternativeCars, preferenceRelaxations, manualDecision } = reply.json.value.options;
  assert.deepEqual([preferenceRelaxations.available, manualDecision.available, alternativeCars.available], [true, true, true]);
  for (const car of alternativeCars.needsConfirmation) {
    assert.deepEqual(car.unknowns, ['charging-unconfirmed']);
    assert.ok(!alternativeCars.items.some((item) => item.orderUuid === car.orderUuid), 'a car needing confirmation is never a remedy');
  }
});
