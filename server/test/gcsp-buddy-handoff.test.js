// FUCQ-108: accepted buddy offers hand off through FUCQ-71's single ordering adapter, in memory and runtime-composed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, result } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider } from '../gcsp/policy/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { stock, essential, preference, fact } from './helpers/employee-recommendation.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const ref = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const good = (r) => { assert.equal(r.status, 'ok', JSON.stringify(r)); return r.value; };
const cookie = (value) => [value].flat().map((v) => v.split(';')[0]).join('; ');
const STAGES = ['selection received', 'HR approval', 'sales-manager approval', 'sent to ordering'];

async function policyWithoutHr() {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((row) => row.key === 'ordering.approvalStages.v1').value = ['sales-manager approval', 'sent to ordering'];
  return new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } }) });
}
async function setup(t, { policy, wrap = (r) => r } = {}) {
  const store = createMemoryStore(); const repository = wrap(createMemoryRepository({ store }));
  const f = { ...good(await createGcspRuntime({ mode: 'memory', repository, policy, environmentId: 'buddy-handoff-test',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' })), store, contexts: {} };
  t.after(() => f.close());
  const presenter = good(await f.identity.createPresenterSession('presenter'));
  f.presenter = presenter.context;
  for (const name of ['paula', 'alex']) {
    const acting = good(await f.identity.switchPrincipal(f.presenter, `demo-${name}`, name));
    f.contexts[name] = acting.context;
    good(await seedManualDemoContext({ repository, identity: f.identity, clock: f.clock, context: acting.context }));
  }
  const time = good(await f.clock.now(f.presenter));
  if (time.now === '2026-11-05T09:00:00.000Z') good(await f.clock.advance(f.presenter, { commandId: 'noon', expectedClockVersion: time.clockVersion, bySeconds: 10800 }));
  f.server = buildServer({ ...f.dependencies, gcspAllowedOrigins: ['https://demo.invalid'] }); good(await f.server.gcspStartup);
  return f;
}
async function insertCar(f, id, orderNumber) {
  const car = stock(id, { eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'), boot: fact(380, 'L'),
    sizeClass: fact(2, 'ordinal-1-5'), insuranceGroup: fact(25, 'insurance-group') }, 'RjcwOlMx');
  const context = f.contexts.paula;
  good(await f.repository.transaction(context, command(`car-${id}`), (tx) => tx.insert('stock', {
    runId: context.runId, orderUuid: car.orderUuid, orderNumber, configurationId: car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
    release: { eventId: `synthetic-proof-input-${id}`, availability: car.availability },
    visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
  return car;
}
async function buddyInput(f, context, car, id) {
  const read = async (table, key) => good(await f.repository.read(context, ref(context, table, key)));
  return { commandId: id, orderUuid: car.orderUuid, expectedBriefVersion: 1,
    expectedStockVersion: (await read('stock', { orderUuid: car.orderUuid })).version,
    expectedEmployeeVersion: (await read('employees', { employeeId: context.employeeId })).version,
    expectedSlotVersion: (await read('entitlement_slots', { entitlementSlotId: context.entitlementSlotId })).version };
}
// Paula holds an active buddy offer for exact car 11; the capability context is the offer-token context.
async function offered(t, options) {
  const f = await setup(t, options);
  for (const context of [f.contexts.paula, f.contexts.alex]) {
    good(await f.brief.saveDraft(context, { commandId: 'brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
    good(await f.brief.confirm(context, { commandId: 'brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: true } }));
  }
  f.car = await insertCar(f, 11, '9123456');
  f.allocated = good(await f.buddy.allocate(f.contexts.paula, await buddyInput(f, f.contexts.paula, f.car, 'buddy-first')));
  const job = f.store.state.tables.notification_outbox.find((row) => row.offerId === f.allocated.offer.offerId);
  const token = new URLSearchParams(new URL(job.payload.offerLink, 'https://demo.invalid').hash.slice(1)).get('token');
  f.offerContext = good(await f.offerAccess.exchange({ runId: f.allocated.offer.runId, offerId: f.allocated.offer.offerId, token })).context;
  f.terms = good(await f.manualOrder.readTerms(f.contexts.paula));
  f.declarations = Object.fromEntries(f.terms.declarations.filter((d) => ['all', 'replacement'].includes(d.appliesTo)).map((d) => [d.id, true]));
  return f;
}
async function acceptInput(f, commandId = 'accept-1', extra = {}) {
  const read = async (table, key) => good(await f.repository.read(f.contexts.paula, ref(f.contexts.paula, table, key)));
  const { offer, hold, quote } = f.allocated;
  return { commandId, runId: offer.runId, offerId: offer.offerId, decision: 'accept',
    expectedOfferVersion: (await read('offers', { offerId: offer.offerId })).version,
    expectedHoldVersion: (await read('holds', { holdId: hold.holdId })).version,
    expectedQuoteVersion: (await read('quotes', { quoteId: quote.quoteId })).version,
    termsDigest: f.terms.termsDigest, declarations: f.declarations, ...extra };
}
const accept = async (f, commandId, extra) => f.offerDecisions.decide(f.offerContext, await acceptInput(f, commandId, extra));
const table = (f, name) => f.store.state.tables[name];
const operations = (f) => table(f, 'pending_operations').filter((row) => row.operationType === 'selection-order');
const receipts = (f, consumerId) => table(f, 'event_receipts').filter((row) => row.consumerId === consumerId);
const row = (f, name, key, value) => table(f, name).find((r) => r[key] === value);
const authority = (f) => ({ hold: row(f, 'holds', 'holdId', f.allocated.hold.holdId).state,
  claim: table(f, 'claims').find((r) => r.holdId === f.allocated.hold.holdId).state,
  stock: row(f, 'stock', 'orderUuid', f.car.orderUuid).state, slot: row(f, 'entitlement_slots', 'entitlementSlotId', f.contexts.paula.entitlementSlotId).state,
  offer: row(f, 'offers', 'offerId', f.allocated.offer.offerId).state });
async function tick(f, id) {
  const time = good(await f.clock.now(f.presenter));
  return good(await f.clock.tick(f.presenter, { eventId: id, inputDigest: inputDigest(id), expectedClockVersion: time.clockVersion }));
}
// Records adapter calls; `execute` behaviour is replaced per test and restored for the reconciliation tick.
function spyAdapter(f, execute) {
  const calls = []; const { execute: original, reconcile } = f.orderingAdapter;
  f.orderingAdapter.reconcile = async (op) => { calls.push('reconcile'); return reconcile(op); };
  f.orderingAdapter.execute = async (op) => { calls.push('execute'); return execute(original, op); };
  calls.restore = () => { f.orderingAdapter.execute = async (op) => { calls.push('execute'); return original(op); }; };
  return calls;
}

test('a single handoff through FUCQ-71 adapter', async (t) => {
  const f = await offered(t); const input = await acceptInput(f); const value = good(await f.offerDecisions.decide(f.offerContext, input));
  assert.equal(value.state, 'accepted'); assert.equal(value.selection.progress.selectionState, 'acknowledged');
  assert.equal(operations(f).length, 1); assert.equal(operations(f)[0].payload.selection.source.type, 'buddy-offer');
  assert.equal(operations(f)[0].payload.selection.stock.orderUuid, f.car.orderUuid);
  assert.equal(receipts(f, 'synthetic-ordering:v1').length, 1);
  const replay = good(await f.offerDecisions.decide(f.offerContext, structuredClone(input))); assert.equal(replay.decisionId, value.decisionId);
  assert.equal(replay.selection.operationId, value.selection.operationId);
  assert.equal(operations(f).length, 1); assert.equal(receipts(f, 'synthetic-ordering:v1').length, 1);
  const other = await accept(f, 'accept-2'); assert.equal(other.status, 'conflict'); assert.equal(other.reason, 'offer-no-longer-pending');
  assert.equal(operations(f).length, 1);
  const order = good(await f.manualOrder.readOrder(f.contexts.paula)); assert.equal(order.operationId, value.selection.operationId);
  assert.equal(order.view.state, 'awaiting-approval');
  for (const name of ['missing', 'extra']) {
    const g = await offered(t); const declarations = { ...g.declarations };
    if (name === 'missing') delete declarations[Object.keys(declarations)[0]]; else declarations.unrelated = true;
    const refused = await accept(g, 'accept-bad', { declarations });
    assert.equal(refused.status, 'invalid', name); assert.equal(operations(g).length, 0);
    assert.equal(authority(g).offer, 'active'); assert.equal(authority(g).hold, 'active');
    assert.equal(receipts(g, 'synthetic-ordering:v1').length, 0);
  }
});

test('hold to allocation in one transaction', async (t) => {
  const f = await offered(t); good(await accept(f));
  assert.deepEqual(authority(f), { hold: 'allocated', claim: 'allocated', stock: 'allocated', slot: 'allocated', offer: 'accepted' });
  const op = operations(f)[0]; assert.equal(op.payload.atomicConversion, true);
  assert.equal(receipts(f, `ordering:history:${f.contexts.paula.employeeId}`).filter((r) => r.eventType === 'selection-received').length, 1);
  assert.equal(table(f, 'decisions').length, 1);
  // A failure after the selection callback rolls everything back: no operation, history or allocation.
  const wrap = (base) => ({ ...base, transaction: (context, cmd, work) => base.transaction(context, cmd, (tx) => work(!cmd.commandId.startsWith('offer-decision:') ? tx
    : { ...tx, compareAndSwap: (r, v, p) => r.table === 'offers' ? Promise.resolve(result('unavailable', { reason: 'forced' })) : tx.compareAndSwap(r, v, p) })) });
  const g = await offered(t, { wrap });
  const failed = await accept(g); assert.notEqual(failed.status, 'ok');
  assert.equal(operations(g).length, 0); assert.equal(receipts(g, `ordering:history:${g.contexts.paula.employeeId}`).length, 0);
  assert.equal(receipts(g, 'brief-selection:v1').length, 0); assert.equal(table(g, 'decisions').length, 0);
  assert.deepEqual(authority(g), { hold: 'active', claim: 'active', stock: 'held', slot: authority(g).slot, offer: 'active' });
  assert.notEqual(authority(g).slot, 'allocated');
});

test('no further holds after selection', async (t) => {
  const f = await offered(t); const value = good(await accept(f)); const paula = f.contexts.paula;
  const second = await insertCar(f, 12, '9123457');
  const direct = await f.buddy.allocate(paula, await buddyInput(f, paula, second, 'buddy-second'));
  assert.ok(['conflict', 'forbidden', 'stale-version'].includes(direct.status), JSON.stringify(direct));
  await tick(f, 'after-selection');
  const mine = (rows) => rows.filter((r) => r.employeeId === paula.employeeId);
  assert.equal(mine(table(f, 'holds')).length, 1); assert.equal(mine(table(f, 'claims')).length, 1); assert.equal(mine(table(f, 'offers')).length, 1);
  assert.equal(authority(f).slot, 'allocated');
  const recorded = receipts(f, 'brief-selection:v1'); assert.equal(recorded.length, 1);
  assert.equal(recorded[0].eventId, `${paula.employeeId}:${paula.entitlementSlotId}`);
  assert.deepEqual([recorded[0].outcome.value.offerId, recorded[0].outcome.value.holdId, recorded[0].outcome.value.orderUuid,
    recorded[0].outcome.value.operationId, recorded[0].outcome.value.briefVersion],
  [f.allocated.offer.offerId, f.allocated.hold.holdId, f.car.orderUuid, value.selection.operationId, 1]);
});

test('target state names', async (t) => {
  const f = await offered(t); const value = good(await accept(f)); const progress = value.selection.progress;
  assert.deepEqual(progress.stages.map((s) => s.name), STAGES);
  assert.deepEqual(progress.stages.map((s) => s.state), ['complete', 'waiting', 'not-started', 'not-started']);
  assert.equal(progress.approved, false); assert.equal(progress.selectionState, 'acknowledged'); assert.equal(progress.current, 'HR approval');
  assert.deepEqual(good(await f.manualOrder.readOrder(f.contexts.paula)).progress, progress);
  const noHr = await offered(t, { policy: await policyWithoutHr() });
  const reduced = good(await accept(noHr)).selection.progress;
  assert.deepEqual(reduced.stages.map((s) => s.name), ['selection received', 'sales-manager approval', 'sent to ordering']);
  const pending = await offered(t); spyAdapter(pending, async () => { throw new Error('timeout'); });
  const waiting = good(await accept(pending)).selection.progress;
  assert.equal(waiting.selectionState, 'handoff-pending'); assert.equal(waiting.approved, false);
  assert.deepEqual(waiting.stages.map((s) => s.state), ['pending', 'not-started', 'not-started', 'not-started']);
});

test('uncertain outcomes kept pending and reconciled on a tick', async (t) => {
  const timedOut = await offered(t);
  const calls = spyAdapter(timedOut, async () => { throw new Error('timeout'); });
  const value = good(await accept(timedOut));
  assert.equal(value.state, 'accepted'); assert.equal(value.selection.progress.selectionState, 'handoff-pending');
  assert.deepEqual([...calls], ['reconcile', 'execute']);
  assert.equal(authority(timedOut).stock, 'allocated'); assert.equal(authority(timedOut).hold, 'allocated');
  assert.equal(operations(timedOut)[0].state, 'pending'); assert.equal(receipts(timedOut, 'synthetic-ordering:v1').length, 0);
  assert.equal(receipts(timedOut, `ordering:history:${timedOut.contexts.paula.employeeId}`).filter((r) => r.eventType !== 'selection-received').length, 0);
  // The tick reconciles before it executes, once, and only then is the selection acknowledged.
  calls.restore();
  await tick(timedOut, 'recover');
  assert.deepEqual([...calls], ['reconcile', 'execute', 'reconcile', 'execute']);
  assert.equal(operations(timedOut)[0].state, 'completed'); assert.equal(operations(timedOut)[0].lastKnownState, 'acknowledged');
  assert.equal(receipts(timedOut, 'synthetic-ordering:v1').length, 1); assert.equal(authority(timedOut).stock, 'allocated');

  const lost = await offered(t); const lostCalls = spyAdapter(lost, async (original, op) => { await original(op); throw new Error('response lost'); });
  assert.equal(good(await accept(lost)).selection.progress.selectionState, 'handoff-pending');
  assert.equal(receipts(lost, 'synthetic-ordering:v1').length, 1); assert.equal(operations(lost)[0].state, 'pending');
  await tick(lost, 'recover-lost');
  assert.deepEqual([...lostCalls], ['reconcile', 'execute', 'reconcile']);
  assert.equal(operations(lost)[0].state, 'completed'); assert.equal(receipts(lost, 'synthetic-ordering:v1').length, 1);
});

test('allowance recheck with the pinned quote', async (t) => {
  const f = await offered(t); const quote = structuredClone(row(f, 'quotes', 'quoteId', f.allocated.quote.quoteId));
  const points = quote.monthlyPoints.value; const original = f.policy.getAllowance.bind(f.policy);
  const allowance = (n) => { f.policy.getAllowance = async (c, r) => { const out = await original(c, r);
    return out.status === 'ok' ? { ...out, value: { ...out.value, monthlyPoints: n } } : out; }; };
  allowance(points - 1);
  const refused = await accept(f); assert.equal(refused.status, 'conflict'); assert.equal(refused.reason, 'allowance-exceeded');
  assert.equal(operations(f).length, 0); assert.equal(authority(f).offer, 'active'); assert.equal(authority(f).hold, 'active');
  // Exactly enough points under a changed allowance still honours the pinned quote and never requotes.
  allowance(points);
  const value = good(await accept(f, 'accept-2')); assert.equal(value.selection.progress.selectionState, 'acknowledged');
  assert.deepEqual(row(f, 'quotes', 'quoteId', quote.quoteId), quote);
  assert.deepEqual(operations(f)[0].payload.selection.quote, quote);
  assert.equal(table(f, 'quotes').filter((r) => r.employeeId === f.contexts.paula.employeeId).length, 1);
  assert.equal(table(f, 'decisions')[0].versions.allowance.monthlyPoints, points);
});

test('the buddy handoff keeps contact, driver and return-data checks', async (t) => {
  const cases = [['contact-required', (m) => { m.account.contact = { phone: 'x', email: 'bad' }; }],
    ['driver-review-required', (m) => { m.drivers[0].eligible.value = false; }],
    ['return-data-required', (m) => { m.contracts[0].currentOdometer = { value: -1, unit: 'mi' }; }]];
  for (const [reason, change] of cases) {
    const f = await offered(t); const context = f.contexts.paula;
    good(await f.repository.transaction(context, command(`break-${reason}`), async (tx) => {
      const found = await tx.get(ref(context, 'employees', { employeeId: context.employeeId }));
      const manual = structuredClone(found.value.contract.manualContext); change(manual);
      return tx.compareAndSwap(ref(context, 'employees', { employeeId: context.employeeId }), found.value.version,
        { contract: { ...found.value.contract, manualContext: manual } });
    }));
    const refused = await accept(f); assert.equal(refused.status, 'conflict', reason); assert.equal(refused.reason, reason);
    assert.equal(operations(f).length, 0); assert.equal(authority(f).offer, 'active'); assert.equal(authority(f).hold, 'active');
  }
});
