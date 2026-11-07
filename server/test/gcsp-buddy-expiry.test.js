import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime, DemoClock } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { stock, essential, preference } from './helpers/employee-recommendation.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const reference = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
const keys = { holds: 'holdId', claims: 'claimId', offers: 'offerId', stock: 'orderUuid' };
const authority = (f) => Object.fromEntries(Object.keys(keys).map((table) => [table, structuredClone(f.store.state.tables[table])]));
const receipt = (f) => f.store.state.tables.event_receipts.filter((row) => row.consumerId === 'buddy-expiry');

async function setup(t, policy = createPolicyService()) {
  const store = createMemoryStore(); const base = createMemoryRepository({ store });
  assert.equal((await base.open()).status, 'ok'); t.after(() => base.close());
  const control = { fail: null };
  const repository = { ...base, transaction: (context, cmd, work) => base.transaction(context, cmd, (tx) => work({ ...tx,
    compareAndSwap: (ref, version, patch) => {
      if (control.fail === ref.table && (patch.state === 'expired' || ref.table === 'stock' && patch.state === 'released')) throw Error('expiry write failure');
      return tx.compareAndSwap(ref, version, patch);
    },
    recordReceipt: (row) => {
      if (control.fail === 'receipt' && row.consumerId === 'buddy-expiry') throw Error('expiry receipt failure');
      return tx.recordReceipt(row);
    },
  })) };
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'buddy-expiry-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok'); const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const context = (await identity.switchPrincipal(presenter, 'demo-paula', 'paula')).value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  assert.equal((await clock.advance(presenter, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  const brief = new BriefService({ repository, policy, clock, identity });
  assert.equal((await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } })).status, 'ok');
  assert.equal((await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } })).status, 'ok');
  const car = stock(1);
  assert.equal((await repository.transaction(context, command('release'), (tx) => tx.insert('stock', {
    runId: context.runId, orderUuid: car.orderUuid, orderNumber: '9123456', configurationId: car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
    release: { eventId: 'synthetic-release', availability: car.availability },
    visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null },
  }))).status, 'ok');
  const f = { store, repository, control, policy, clock, identity, presenter, context, car };
  const employee = (await repository.read(context, reference(f, 'employees', { employeeId: context.employeeId }))).value;
  const slot = (await repository.read(context, reference(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }))).value;
  f.input = { commandId: 'allocate', orderUuid: car.orderUuid, expectedBriefVersion: 1, expectedStockVersion: 1,
    expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version };
  f.service = new BuddyHoldService({ ...f, adapter: { mode: 'local-synthetic' } });
  f.original = await f.service.allocate(context, f.input); assert.equal(f.original.status, 'ok');
  f.hold = f.original.value.hold; return f;
}
async function advanceTo(f, when) {
  const time = (await f.clock.now(f.presenter)).value;
  return f.clock.advance(f.presenter, { commandId: `advance:${when}`, expectedClockVersion: time.clockVersion,
    bySeconds: (Date.parse(when) - Date.parse(time.now)) / 1000 });
}
async function tick(f, eventId = 'expiry-tick') {
  const time = (await f.clock.now(f.presenter)).value;
  return f.clock.tick(f.presenter, { eventId, expectedClockVersion: time.clockVersion, inputDigest: inputDigest(eventId) });
}
async function patch(f, table, patch) {
  const row = f.store.state.tables[table].find((r) => table !== 'stock' || r.orderUuid === f.car.orderUuid);
  return f.repository.transaction(f.context, command(`patch:${table}:${row.version}`),
    (tx) => tx.compareAndSwap(reference(f, table, { [keys[table]]: row[keys[table]] }), row.version, patch));
}
function expired(f) {
  for (const table of ['holds', 'claims', 'offers']) assert.equal(f.store.state.tables[table][0].state, 'expired');
  const car = f.store.state.tables.stock.find((row) => row.orderUuid === f.car.orderUuid);
  assert.deepEqual([car.state, car.available, car.held, car.allocated], ['released', true, false, false]);
  assert.equal(receipt(f).length, 1); assert.equal(receipt(f)[0].outcome.value.expiredAt, f.hold.expiresAt);
  assert.equal(f.store.state.tables.decisions.length, 0);
}

test('real tick expires at the server deadline atomically; replay preserves historical offer and expiry outcomes', async (t) => {
  const f = await setup(t); const employees = structuredClone(f.store.state.tables.employees);
  assert.equal((await f.service.start()).status, 'ok'); assert.deepEqual(await f.service.start(), await f.service.start());
  assert.equal(typeof f.service.expire, 'undefined');
  assert.equal((await advanceTo(f, new Date(Date.parse(f.hold.expiresAt) - 1000).toISOString())).status, 'ok');
  const before = authority(f); const early = await tick(f, 'early'); assert.equal(early.status, 'ok');
  assert.deepEqual(authority(f), before); assert.equal(receipt(f).length, 0);
  assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
  const done = await tick(f); assert.equal(done.status, 'ok');
  assert.deepEqual(done.value.handlerOrder, [{ handlerId: 'buddy-expiry', stage: 'buddy-expiry' }]);
  expired(f); assert.deepEqual(f.store.state.tables.employees, employees);
  assert.equal(f.store.state.tables.holds[0].releaseReason, 'buddy-expired');
  const after = authority(f); const originalReceipt = structuredClone(receipt(f));
  assert.deepEqual(await tick(f), done); assert.equal((await tick(f, 'later')).status, 'ok');
  assert.deepEqual(authority(f), after); assert.deepEqual(receipt(f), originalReceipt);
  assert.deepEqual(await f.service.allocate(f.context, f.input), f.original);
  const token = new URL(f.store.state.tables.notification_outbox[0].payload.offerLink, 'https://demo.invalid').hash.slice(7);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(f.store.state.tables).filter(([name]) => name !== 'notification_outbox'))).includes(token), false);
  const car = f.store.state.tables.stock.find((row) => row.orderUuid === f.car.orderUuid);
  const slot = f.store.state.tables.entitlement_slots.find((row) => row.entitlementSlotId === f.context.entitlementSlotId);
  const next = await f.service.allocate(f.context, { ...f.input, commandId: 'after-expiry',
    expectedStockVersion: car.version, expectedSlotVersion: slot.version });
  assert.equal(next.status, 'ok'); assert.equal(next.value.state, 'offered');
  assert.equal(f.store.state.tables.offers.filter((row) => row.state === 'active').length, 1);
  assert.equal(receipt(f).length, 1); assert.equal(f.store.state.tables.decisions.length, 0);
});

test('new backend startup runs the same private expiry handler without issuing an employee session', async (t) => {
  const f = await setup(t); assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
  const clock = new DemoClock({ ...f, environmentId: f.context.environmentId, environmentKind: 'synthetic' });
  const service = new BuddyHoldService({ ...f, clock, adapter: { mode: 'local-synthetic' } });
  assert.equal((await service.start()).status, 'ok');
  const outcome = await clock.reconcileStartup(); assert.equal(outcome.status, 'ok'); expired(f);
  const before = authority(f); assert.deepEqual(await clock.reconcileStartup(), outcome); assert.deepEqual(authority(f), before);
  const anotherClock = new DemoClock({ ...f, environmentId: f.context.environmentId, environmentKind: 'synthetic' });
  assert.equal((await new BuddyHoldService({ ...f, clock: anotherClock, adapter: { mode: 'local-synthetic' } }).start()).status, 'ok');
  assert.equal((await anotherClock.reconcileStartup()).status, 'ok'); assert.deepEqual(authority(f), before);
});

test('expiry consumes a revised canonical duration with the shared inclusive deadline', async (t) => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((row) => row.key === 'hold.buddy.durationSeconds').value = 17;
  const f = await setup(t, new PolicyService({ provider: { async loadVersions() { return [seed]; } } }));
  assert.equal(Date.parse(f.hold.expiresAt) - Date.parse(f.original.value.now), 17000);
  assert.equal((await f.service.start()).status, 'ok'); assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
  assert.equal((await tick(f, 'revised-deadline')).status, 'ok'); expired(f);
});

for (const table of ['holds', 'claims', 'offers']) {
  for (const state of ['claim-pending', 'release-pending', 'selection-pending', 'allocated']) {
    test(`expiry preserves ${table} ${state} exclusion`, async (t) => {
      const f = await setup(t); assert.equal((await patch(f, table, { state })).status, 'ok');
      assert.equal((await f.service.start()).status, 'ok'); assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
      const before = authority(f); assert.equal((await tick(f)).status, 'ok');
      assert.deepEqual(authority(f), before); assert.equal(receipt(f).length, 0);
    });
  }
  test(`expiry preserves remote operation exclusion on ${table}`, async (t) => {
    const f = await setup(t); assert.equal((await patch(f, table, { operationId: 'remote-authority' })).status, 'ok');
    assert.equal((await f.service.start()).status, 'ok'); assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
    const before = authority(f); assert.equal((await tick(f)).status, 'ok'); assert.deepEqual(authority(f), before); assert.equal(receipt(f).length, 0);
  });
}

for (const value of [{ held: false }, { state: 'allocated', allocated: true }, { available: true }]) {
  test(`expiry retains inconsistent stock ${Object.keys(value).join('/')}`, async (t) => {
    const f = await setup(t); assert.equal((await patch(f, 'stock', value)).status, 'ok');
    assert.equal((await f.service.start()).status, 'ok'); assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
    const before = authority(f); const outcome = await tick(f); assert.equal(outcome.status, 'ok');
    assert.deepEqual(authority(f), before); assert.equal(receipt(f).length, 0);
    assert.equal(outcome.value.outcomes[0].outcome.value.retained[0].reason, 'stock-reconciliation-required');
  });
}

for (const fail of ['holds', 'claims', 'offers', 'stock', 'receipt']) {
  test(`expiry rolls back every earlier write on ${fail} failure and same event can recover`, async (t) => {
    const f = await setup(t); assert.equal((await f.service.start()).status, 'ok');
    assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
    const before = authority(f); f.control.fail = fail;
    assert.equal((await tick(f)).status, 'unavailable'); assert.deepEqual(authority(f), before); assert.equal(receipt(f).length, 0);
    f.control.fail = null; assert.equal((await tick(f)).status, 'ok'); expired(f);
  });
}

test('remote mode cannot register a local release handler; stale handler time refuses without release', async (t) => {
  const f = await setup(t);
  assert.equal((await new BuddyHoldService({ ...f, adapter: { mode: 'remote' } }).start()).status, 'unavailable');
  let handle;
  const service = new BuddyHoldService({ ...f, clock: { registerHandler: async (entry) => { handle = entry.handle; return { status: 'ok', value: null }; } }, adapter: { mode: 'local-synthetic' } });
  assert.equal((await service.start()).status, 'ok');
  const before = authority(f); const outcome = await handle({ context: f.context, now: f.hold.expiresAt, clockVersion: 'stale',
    transaction: (work) => f.repository.transaction(f.context, command('stale-expiry'), work) });
  assert.equal(outcome.status, 'stale-version'); assert.deepEqual(authority(f), before); assert.equal(receipt(f).length, 0);
});

test('buddy expiry leaves manual cart authority untouched', async (t) => {
  const f = await setup(t);
  for (const table of ['holds', 'claims']) assert.equal((await patch(f, table, { type: 'cart' })).status, 'ok');
  assert.equal((await f.service.start()).status, 'ok'); assert.equal((await advanceTo(f, f.hold.expiresAt)).status, 'ok');
  const before = authority(f); assert.equal((await tick(f)).status, 'ok'); assert.deepEqual(authority(f), before);
  assert.equal(receipt(f).length, 0);
});
