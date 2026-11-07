// The real memory runtime over loopback HTTP, read and driven only through the order progress adapter and controller.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider } from '../gcsp/policy/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';
import { createOrderProgressHttpAdapter } from '../../blocks/gcsp/order-progress/order-progress-http.js';
import { createOrderProgressController } from '../../blocks/gcsp/order-progress/order-progress-controller.js';

const SEED = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const origin = 'https://order-progress-live.test';
const good = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
const cookie = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
let dom; let orderProgressBody;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
  ({ orderProgressBody } = await import('../../blocks/gcsp/order-progress/order-progress-body.js'));
});
after(() => dom?.window.close());
const words = (progress) => orderProgressBody({ progress }).textContent.replace(/\s+/g, ' ');

async function setup(t, { proposeChange = false } = {}) {
  const profile = createCompositionTestProfile();
  let policy;
  if (proposeChange) {
    const seed = structuredClone(SEED); seed.assumptions.find((a) => a.key === 'lifecycle.appointments.scenario.v1').value.proposeChange = true;
    policy = new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } }) });
  }
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile, ...(policy ? { policy } : {}),
    environmentId: 'order-progress-live', policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'order-progress-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const local = good(await runtime.createLocalSession()); const session = cookie(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: session, purpose: 'presenter-control' }));
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  t.after(async () => { try { await new Promise((done) => { server.close(done); server.closeAllConnections(); }); } finally { await runtime.close(); } });
  good(await server.gcspStartup);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // The browser's same-origin fetch, with the session cookie the page would carry.
  const browserFetch = (path, init = {}) => fetch(base + path, { ...init, headers: { ...init.headers, Origin: origin, Cookie: session } });
  const request = async (path) => (await browserFetch(path)).json();
  return { ...runtime, runtime, profile, employee: local.context, presenter, request, browserFetch };
}

async function tick(f, eventId, bySeconds = 0) {
  let now = good(await f.clock.now(f.presenter));
  if (bySeconds) {
    good(await f.clock.advance(f.presenter, { commandId: `advance:${eventId}`, expectedClockVersion: now.clockVersion, bySeconds }));
    now = good(await f.clock.now(f.presenter));
  }
  return f.clock.tick(f.presenter, { eventId, expectedClockVersion: now.clockVersion, inputDigest: inputDigest(eventId) });
}

// A real manual replacement order for Paula, submitted through the actual claim, review and order services.
async function submitOrder(f) {
  const account = good(await f.request('/api/gcsp/manual/account'));
  const action = account.actions.find((row) => row.enabled);
  const driver = account.choices.drivers.find((row) => row.kind === 'employee');
  const option = account.choices.contractOptions.find((row) => row.schemeIds.includes(f.employee.schemeId) && row.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((row) => row.contractOptionIds.includes(option.contractOptionId) && row.driverKinds.includes(driver.kind));
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId,
    driverId: driver.driverId, contractOptionId: option.contractOptionId, requestedCollectionDate: account.currentContract.earliestCollectionDate,
    collectionLocationId: location.locationId, brand: account.choices.brands[0], contact: account.account.contact,
    expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
  const post = async (path, body) => (await f.browserFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  good(await post('/api/gcsp/manual/draft', { commandId: 'op-draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices }));
  const car = await f.profile.prepare(f.runtime, f.employee);
  const time = good(await f.clock.now(f.presenter));
  good(await tick(f, 'release-op-stock', (Date.parse('2026-11-05T12:00:00.000Z') - Date.parse(time.now)) / 1000));
  const decision = good(await f.request('/api/gcsp/manual/stock')).decisions.find((row) => row.orderUuid === car.orderUuid);
  const claimed = good(await f.manualClaims.claim(f.employee, { ...decision.claimInput, commandId: 'op-claim' }));
  const reviewed = good(await f.manualClaims.beginReview(f.employee, { commandId: 'op-review', holdId: claimed.hold.holdId,
    expectedHoldVersion: claimed.hold.version, expectedDraftVersion: claimed.quote.draftVersion }));
  const terms = good(await f.manualOrder.readTerms(f.employee));
  const stock = good(await f.repository.read(f.employee, ref(f.employee, 'stock', { orderUuid: car.orderUuid })));
  good(await f.manualOrder.submit(f.employee, { commandId: 'op-submit', source: { type: 'cart', holdId: reviewed.hold.holdId,
    expectedHoldVersion: reviewed.hold.version, expectedDraftVersion: reviewed.quote.draftVersion }, expectedQuoteId: reviewed.quote.quoteId,
  expectedStockVersion: stock.version, termsDigest: terms.termsDigest,
  declarations: Object.fromEntries(terms.declarations.filter((row) => row.appliesTo === 'all' || row.appliesTo === choices.mode).map((row) => [row.id, true])) }));
  return car.orderUuid;
}

const open = async (f, options) => {
  const adapter = createOrderProgressHttpAdapter({ fetch: f.browserFetch });
  const controller = createOrderProgressController({ adapter, ...options, createCommandId: randomUUID });
  await controller.refresh(); return controller;
};
const value = (controller, section) => controller.getState().progress[section].value;
const slotOf = (offered) => offered[0];

// Policy delays are read from the run's own assumptions, never hard-coded.
async function delays(f) {
  const read = { runId: f.employee.runId, policyVersion: f.employee.policyVersion, asOf: good(await f.clock.now(f.presenter)).now };
  return { appointment: good(await f.policy.getAssumption('lifecycle.appointments.confirmation.v1', read)).value.confirmDelaySeconds,
    documents: Math.max(...good(await f.policy.getAssumption('lifecycle.documents.v1', read)).value.items.map((row) => row.progressSeconds ?? 0)) };
}

async function approve(f, controller) {
  for (let index = 0; index < 20; index += 1) {
    good(await tick(f, `op-approve-${index}`)); await controller.refresh();
    if (value(controller, 'stages').outcome === 'sent-to-ordering') return;
  }
  assert.fail('the order never reached sent to ordering');
}

test('a real replacement order is read, driven and re-read through the adapter and controller', async (t) => {
  const f = await setup(t); const orderUuid = await submitOrder(f);
  let controller = await open(f);
  try {
    // 1. Selection received, approval in progress.
    let state = controller.getState();
    assert.deepEqual([state.phase, state.orderUuid, state.progress.stages.status], ['ready', orderUuid, 'ok']);
    assert.equal(value(controller, 'stages').currentStage, 'selection received'); assert.equal(value(controller, 'stages').outcome, 'in-progress');
    assert.match(words(state.progress), /Selection received/); assert.match(words(state.progress), /Documents and checks open once your order is sent to ordering/);
    assert.match(words(state.progress), /Handover times open once your order is sent to ordering/);
    // 2. Presenter ticks carry it to ordering, and the documents open.
    await approve(f, controller); state = controller.getState();
    assert.match(words(state.progress), /Sent to ordering/);
    const docs = value(controller, 'documents').orders.find((row) => row.orderUuid === orderUuid);
    assert.ok(docs, 'documents opened for this order'); assert.equal(docs.readiness.ready, false);
    // 3. Paula completes the employee task; the screen reads the server's answer.
    const task = docs.tasks.find((row) => row.actionable); assert.ok(task);
    state = await controller.completeTask(task.itemId);
    assert.deepEqual(state.message, { text: 'Task completed.', error: false });
    const after = value(controller, 'documents').orders.find((row) => row.orderUuid === orderUuid);
    assert.equal(after.items.find((row) => row.itemId === task.itemId).status, 'complete');
    state = await controller.completeTask(task.itemId); // already complete: the server refuses and the screen says so
    assert.deepEqual(state.message, { text: 'Your order changed. Showing the latest.', error: true });
    const wait = await delays(f); good(await tick(f, 'op-documents-ready', wait.documents)); await controller.refresh();
    assert.match(words(controller.getState().progress), /Ready for handover/);
    // 4. Handover: requested is never booked; the tick books it.
    let appointment = value(controller, 'appointment');
    assert.deepEqual([appointment.state, appointment.eligibility.eligible], ['not-requested', true]);
    const slot = slotOf(appointment.offeredSlots);
    state = await controller.requestAppointment(slot.slotId);
    assert.deepEqual(state.message, { text: 'Handover time requested.', error: false });
    appointment = value(controller, 'appointment'); assert.deepEqual([appointment.state, appointment.booked, appointment.requestedSlot], ['requested', false, slot]);
    assert.match(words(state.progress), /Not booked yet/); assert.doesNotMatch(words(state.progress), /Booked:/);
    const returnBefore = structuredClone(value(controller, 'returnPlan'));
    assert.equal(returnBefore.applicable, true); assert.equal(returnBefore.state, 'not-planned');
    good(await tick(f, 'op-confirm-appointment', wait.appointment)); await controller.refresh();
    appointment = value(controller, 'appointment'); assert.deepEqual([appointment.state, appointment.booked, appointment.slot], ['scheduled', true, slot]);
    assert.match(words(controller.getState().progress), /Booked:/);
    // 5. Return of the current car: requested, then scheduled; the current car never changes.
    const plan = value(controller, 'returnPlan'); const carBefore = structuredClone(plan.currentCar);
    const separate = plan.choices.find((row) => row.id === 'separate'); assert.equal(separate.available, true);
    state = await controller.requestReturn({ choice: 'separate', slotId: slotOf(plan.offeredSlots.separate).slotId });
    assert.deepEqual(state.message, { text: 'Return requested.', error: false });
    let returning = value(controller, 'returnPlan'); assert.deepEqual([returning.state, returning.scheduled, returning.currentCar], ['return-requested', false, carBefore]);
    assert.match(words(state.progress), /Return requested/); assert.doesNotMatch(words(state.progress), /Return booked/);
    good(await tick(f, 'op-confirm-return', wait.appointment)); await controller.refresh();
    returning = value(controller, 'returnPlan'); assert.deepEqual([returning.state, returning.scheduled, returning.currentCar], ['return-scheduled', true, carBefore]);
    assert.match(words(controller.getState().progress), /Return booked/);
    assert.equal(value(controller, 'appointment').state, 'scheduled', 'the handover is untouched by the return');
    // 6. A reload (new controller, new reads) shows the same server state.
    const before = controller.getState().progress; controller.destroy(); controller = await open(f);
    assert.deepEqual(controller.getState().progress, before);
    assert.equal((await open(f, { orderUuid })).getState().orderUuid, orderUuid);
  } finally { controller.destroy(); }
});

test('a proposed handover time and a proposed return time are accepted through the controller', async (t) => {
  const f = await setup(t, { proposeChange: true }); const orderUuid = await submitOrder(f);
  const controller = await open(f, { orderUuid });
  try {
    await approve(f, controller); const wait = await delays(f);
    await controller.requestAppointment(slotOf(value(controller, 'appointment').offeredSlots).slotId);
    good(await tick(f, 'op-propose-appointment', wait.appointment)); await controller.refresh();
    let appointment = value(controller, 'appointment'); assert.deepEqual([appointment.state, appointment.booked], ['change-proposed', false]);
    assert.match(words(controller.getState().progress), /New time proposed/); assert.doesNotMatch(words(controller.getState().progress), /Booked:/);
    const state = await controller.acceptAppointment(appointment.proposalId);
    assert.deepEqual(state.message, { text: 'New handover time accepted.', error: false });
    appointment = value(controller, 'appointment'); assert.deepEqual([appointment.state, appointment.booked], ['scheduled', true]);
    const plan = value(controller, 'returnPlan'); const carBefore = structuredClone(plan.currentCar);
    await controller.requestReturn({ choice: 'separate', slotId: slotOf(plan.offeredSlots.separate).slotId });
    good(await tick(f, 'op-propose-return', wait.appointment)); await controller.refresh();
    let returning = value(controller, 'returnPlan');
    assert.deepEqual([returning.state, returning.scheduled, returning.appointment.state], ['return-requested', false, 'change-proposed']);
    assert.match(words(controller.getState().progress), /New return time proposed/);
    const done = await controller.acceptReturn(returning.proposalId);
    assert.deepEqual(done.message, { text: 'New return time accepted.', error: false });
    returning = value(controller, 'returnPlan'); assert.deepEqual([returning.state, returning.scheduled, returning.currentCar], ['return-scheduled', true, carBefore]);
  } finally { controller.destroy(); }
});

test('a run with no order is its own state; cases the default memory runtime cannot produce are skipped with their reason', async (t) => {
  await t.test('declined approval needs the decline scenario policy and a validated renewal, which this runtime does not seed', { skip: 'lifecycle.approval.declineScenario.v1 is disabled and no validated renewal is seeded (shared-contracts, FUCQ-111 Remaining).' }, () => {});
  await t.test('an unsupported provider answer needs the live-shaped ordering stub, not wired in the memory runtime', { skip: 'Only the live-shaped provider returns unsupported; the memory runtime composes the synthetic adapter (orderingAdapter.mode synthetic). The controller mapping is covered with a fake adapter.' }, () => {});
  await t.test('a new (non-replacement) order has no return plan', { skip: 'The seeded account offers only the replace action, so the real runtime cannot submit a new order. applicable:false is covered by the fixtures.' }, () => {});
  const f = await setup(t); const controller = await open(f);
  try { assert.deepEqual([controller.getState().phase, controller.getState().progress], ['none', { phase: 'none' }]); } finally { controller.destroy(); }
});
