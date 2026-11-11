import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { stock, fact, preference } from './helpers/employee-recommendation.js';
import { createVehicleSnapshot } from '../vehicles/index.js';

const NOW = '2026-11-05T09:00:00.000Z';
const DEMO = 'synthetic:demo-synthetic-stock-v1';
const GENERATED = 'synthetic:stock-generator.v1';
const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
async function fixture(t) {
  const store = createMemoryStore(); const policyStore = createMemoryPolicyStore(); let current; let serial = 0;
  const start = async () => {
    current = good(await createGcspRuntime({ mode: 'memory', repository: createMemoryRepository({ store }),
      policy: new PolicyService({ provider: new MemoryPolicyProvider({ store: policyStore }) }),
      environmentId: 'retained-model-facts', policyAsOf: NOW, commandId: 'bootstrap', sessionNow: () => NOW }));
    return current;
  };
  t.after(async () => current?.close()); const runtime = await start();
  const context = good(await runtime.createLocalSession()).context;
  const write = async (work) => { const id = `fixture:${++serial}`;
    return good(await current.repository.transaction(context, { commandId: id, inputDigest: inputDigest(id) }, work)); };
  const add = async (id, change = () => {}) => {
    const car = stock(id, { insuranceGroup: fact(25, 'insurance-group') });
    const snapshot = structuredClone(car.snapshot); snapshot.sourceNamespace = GENERATED;
    delete snapshot.facts.zeroTo62; delete snapshot.facts.mpg;
    const row = { runId: context.runId, orderUuid: car.orderUuid, orderNumber: String(id).padStart(7, '0'),
      configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false, facts: snapshot,
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null },
      release: { availability: { ...car.availability, availableFrom: NOW }, releasedAt: NOW } };
    change(row); delete row.facts.candidateKey; row.facts = createVehicleSnapshot(row.facts);
    return write((tx) => tx.insert('stock', row));
  };
  return { runtime, context, store, start, write, add };
}

test('retained startup persists missing derivative facts and leaves known/foreign/unknown/occupied/frozen records unchanged', async (t) => {
  const f = await fixture(t); const { context } = f;
  const generated = await f.add(1); const demo = await f.add(2, (row) => { row.facts.sourceNamespace = DEMO; });
  const preserved = [
    await f.add(3, (row) => { row.facts.facts.zeroTo62 = fact(6.123, 's'); row.facts.facts.mpg = fact(50.1, 'mpg-imperial'); }),
    await f.add(4, (row) => { row.facts.sourceNamespace = 'authorised-live:stock'; }),
    await f.add(5, (row) => { row.facts.facts.eligibilityModelKey = fact('unmapped|derivative'); }),
    await f.add(6, (row) => { row.held = true; }),
    await f.add(7, (row) => { row.allocated = true; }),
    await f.add(8), await f.add(9), await f.add(10),
    await f.add(11), await f.add(12),
  ];
  const ev = await f.add(13, (row) => { row.facts.facts.eligibilityModelKey = fact('G61 i5|i5 40'); row.facts.facts.zeroTo62 = fact(6.1, 's'); });
  const unknown = await f.add(14, (row) => { row.facts.facts.zeroTo62 = fact(null, 's'); });
  const quote = await f.write((tx) => tx.insert('quotes', { runId: context.runId, quoteId: 'retained-quote', orderUuid: preserved[5].orderUuid,
    employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, facts: preserved[5].facts }));
  await f.write((tx) => tx.insert('holds', { runId: context.runId, holdId: 'retained-hold', orderUuid: preserved[5].orderUuid,
    employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, quoteId: quote.quoteId, state: 'active' }));
  await f.write((tx) => tx.insert('holds', { runId: context.runId, holdId: 'allocated-hold', orderUuid: preserved[6].orderUuid,
    employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, quoteId: quote.quoteId, state: 'allocated' }));
  const pending = await f.write((tx) => tx.insert('event_receipts', { runId: context.runId, consumerId: 'buddy-allocation', eventId: 'retained-pending',
    state: 'pending', outcome: ok({ plan: { pool: [{ orderUuid: preserved[7].orderUuid, snapshot: preserved[7].facts }] } }) }));
  await f.write((tx) => tx.insert('event_receipts', { runId: context.runId, consumerId: 'buddy-allocation', eventId: 'legacy-pending',
    state: 'pending', outcome: ok({ plan: { contenders: [{ orderUuid: preserved[8].orderUuid, quote: { snapshot: preserved[8].facts } }] } }) }));
  await f.write((tx) => tx.insert('holds', { runId: context.runId, holdId: 'returned-hold', orderUuid: preserved[9].orderUuid,
    employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, quoteId: quote.quoteId, state: 'expired' }));
  await f.write((tx) => tx.insert('claims', { runId: context.runId, claimId: 'active-retained-claim', holdId: 'returned-hold', orderUuid: preserved[9].orderUuid,
    employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, state: 'active' }));
  const beforeHistory = structuredClone(f.store.state.tables.quotes);
  await f.runtime.close(); const reopened = await f.start();
  for (const before of [generated, demo, unknown]) {
    const after = good(await reopened.repository.read(context, ref(context, 'stock', { orderUuid: before.orderUuid })));
    assert.equal(after.facts.facts.zeroTo62?.value, 7.4);
    assert.equal(after.facts.facts.mpg?.value, 44);
    assert.equal(after.version, before.version + 1); assert.notEqual(after.facts.snapshotVersion, before.facts.snapshotVersion);
    assert.match(after.facts.facts.zeroTo62.provenance.sourceRef, /stock-model-facts-2026-11-11/);
    assert.equal(after.facts.facts.zeroTo62.provenance.assurance, 'synthetic-scenario');
  }
  assert.deepEqual(good(await reopened.repository.read(context, ref(context, 'stock', { orderUuid: ev.orderUuid }))), ev);
  for (const before of preserved) assert.deepEqual(good(await reopened.repository.read(context, ref(context, 'stock', { orderUuid: before.orderUuid }))), before);
  assert.deepEqual(f.store.state.tables.quotes, beforeHistory);
  assert.deepEqual(good(await reopened.repository.read(context, ref(context, 'event_receipts', { consumerId: pending.consumerId, eventId: pending.eventId }))), pending);
  const versions = inputDigest(f.store.state.tables.stock); await reopened.close(); const again = await f.start();
  assert.equal(inputDigest(f.store.state.tables.stock), versions); assert.equal(good(await again.clock.now(context)).now, NOW);
});

test('retained repaired facts remain identical through manual selection and a real persisted quote/hold', async (t) => {
  const f = await fixture(t); const car = await f.add(21); await f.runtime.close(); const runtime = await f.start();
  const ctx = good(await runtime.createLocalSession()).context; const account = good(await runtime.manualClaims.readAccount(ctx));
  good(await runtime.manualClaims.saveDraft(ctx, { commandId: 'manual-draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices: { mode: 'replacement', oldContractId: `current:${ctx.employeeId}`,
      slotId: ctx.entitlementSlotId, schemeId: ctx.schemeId, driverId: `driver:${ctx.employeeId}`, contractOptionId: 'six-month-8000',
      requestedCollectionDate: '2026-11-20', collectionLocationId: 'demo-collection-centre', brand: 'bmw',
      contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: 6700, specialRequirements: '' } }));
  const browse = good(await runtime.manualClaims.browseStock(ctx)); const selected = browse.cars.find((row) => row.orderUuid === car.orderUuid);
  assert.ok(selected); const claimed = good(await runtime.manualClaims.claim(ctx, { commandId: 'manual-claim', ...selected.claimInput }));
  const persisted = good(await runtime.repository.read(ctx, ref(ctx, 'stock', { orderUuid: car.orderUuid })));
  assert.deepEqual(claimed.quote.facts, persisted.facts); assert.equal(claimed.quote.facts.facts.zeroTo62.value, 7.4);
  assert.equal(claimed.hold.state, 'active');
});

test('fresh allocation repairs returned stock before freezing its proposal and real Buddy quote/hold', async (t) => {
  const f = await fixture(t); const runtime = f.runtime;
  const car = await f.add(31, (row) => { row.held = true; });
  await runtime.close(); const restarted = await f.start();
  const ctx = good(await restarted.createLocalSession()).context;
  assert.deepEqual(good(await restarted.repository.read(ctx, ref(ctx, 'stock', { orderUuid: car.orderUuid }))), car);
  await f.write((tx) => tx.compareAndSwap(ref(ctx, 'stock', { orderUuid: car.orderUuid }), car.version, { held: false }));
  good(await restarted.brief.saveDraft(ctx, { commandId: 'buddy-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: {} } }));
  good(await restarted.brief.confirm(ctx, { commandId: 'buddy-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } }));
  const presenter = good(await restarted.identity.createPresenterSession('fresh-allocation'));
  const allocated = good(await restarted.allocation.allocate(presenter.context, { eventId: 'returned-stock', eventType: 'stock-released',
    runId: ctx.runId, stockVersion: 'returned-stock' }));
  assert.equal(allocated.assignments.length, 1);
  const persisted = good(await restarted.repository.read(ctx, ref(ctx, 'stock', { orderUuid: car.orderUuid })));
  const quotes = good(await restarted.repository.query(ctx, 'quotes'));
  assert.equal(quotes.length, 1); assert.deepEqual(quotes[0].facts, persisted.facts);
  assert.equal(quotes[0].facts.facts.zeroTo62.value, 7.4); assert.equal(quotes[0].facts.facts.mpg.value, 44);
  assert.equal(persisted.state, 'held');
  const before = inputDigest(f.store.state.tables); good(await restarted.allocation.allocate(presenter.context, {
    eventId: 'returned-stock', eventType: 'stock-released', runId: ctx.runId, stockVersion: 'returned-stock' }));
  assert.equal(inputDigest(f.store.state.tables), before);
});
