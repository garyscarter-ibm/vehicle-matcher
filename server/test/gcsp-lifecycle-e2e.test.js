// FUCQ-124: the buddy order on the launcher, then the manual order and the retained difficult cases on the composed runtime.
// Every expected value is read through PolicyService; alternative policies are explicit seed edits before boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assumption, jar, launch, rows, stepper, tickTo, walkPaulasPath } from './helpers/gcsp-journey.js';
import { good, setupManualRuntime, selectManualOrder } from './helpers/gcsp-manual-order.js';
import { EXCEPTION_CONSUMER } from '../gcsp/lifecycle/approvals/index.js';
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
  return { f, order, picked, ...reads(f, order, f.session) };
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
