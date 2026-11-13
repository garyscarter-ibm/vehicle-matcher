import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository, createState, createReceiptIndex, inputDigest, ok, TABLES, FOUNDATION_TABLES } from '../gcsp/repository/core.js';

// FUCQ-422: a custom adapter that keeps memory semantics and captures the journal offered with each commit.
function journalRepository() {
  const store = { state: createState() };
  const offered = [];
  const copy = (state) => ({ ...state, tables: Object.fromEntries(Object.entries(state.tables).map(([name, rows]) => [name, rows.slice()])) });
  let clock = 0;
  const repository = createRepository({
    now: () => new Date(Date.UTC(2026, 10, 13, 0, 0, clock++)).toISOString(),
    receiptIndex: createReceiptIndex(),
    async open() { return ok({}); },
    async close() { return ok({ closed: true }); },
    async read(context, work) { return work(store.state); },
    async transaction(context, work) {
      const before = store.state; const draft = copy(before);
      const returned = await work(draft);
      offered.push({ commit: returned.commit, mutations: returned.mutations, before, after: draft });
      if (returned.commit) store.state = draft;
      return returned.outcome;
    },
  });
  return { repository, store, offered, last: () => offered.at(-1) };
}
const ctx = (runId = 'run-a') => ({ environmentId: 'environment-a', runId, principalId: 'trusted', roles: [] });
let serial = 0;
const command = (id = `command-${++serial}`, input = id) => ({ commandId: id, inputDigest: inputDigest(input) });
const ref = (table, key, runId = 'run-a') => ({ table, key: { runId, ...key } });
const brief = (entry) => [entry.type, entry.table, ...Object.values(entry.key)].join(' ');
const keyOf = (table, row) => JSON.stringify(TABLES[table].key.map((key) => row[key]));
// The snapshot comparison FUCQ-423 replaces: the journal must name exactly these rows, with the same final content.
function snapshotDiff(before, after) {
  const changes = [];
  for (const table of FOUNDATION_TABLES) {
    const prior = new Map(before.tables[table].map((row) => [keyOf(table, row), row]));
    for (const row of after.tables[table]) {
      const old = prior.get(keyOf(table, row));
      if (!old) changes.push(['insert', table, keyOf(table, row), row]);
      else if (old !== row && inputDigest(old) !== inputDigest(row)) changes.push(['update', table, keyOf(table, row), row, old.version]);
    }
  }
  return changes.sort((a, b) => `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`));
}
const journalDiff = (mutations) => mutations.map((entry) => [entry.type, entry.table, keyOf(entry.table, entry.row), entry.row,
  ...(entry.type === 'update' ? [entry.expectedVersion] : [])]).sort((a, b) => `${a[1]}${a[2]}`.localeCompare(`${b[1]}${b[2]}`));
const assertEquivalent = (offer) => assert.deepEqual(journalDiff(offer.mutations), snapshotDiff(offer.before, offer.after));
const claimInput = { orderUuid: 'car-a', holdId: 'hold-a', claimId: 'claim-a', employeeId: 'employee-a', entitlementSlotId: 'slot-a',
  type: 'cart', expiresAt: '2026-11-14T00:00:00.000Z', policyVersion: 'policy-1', quoteId: 'quote-a', expectedStockVersion: 1, expectedSlotVersion: 1 };

async function seeded() {
  const fixture = journalRepository();
  await fixture.repository.open();
  const outcome = await fixture.repository.transaction(ctx(), command('seed'), async (tx) => {
    for (const [table, row] of [
      ['runs', { environmentId: 'environment-a', status: 'active', current: true }],
      ['employees', { employeeId: 'employee-a' }],
      ['entitlement_slots', { entitlementSlotId: 'slot-a', employeeId: 'employee-a', capacity: 1 }],
      ['stock', { orderUuid: 'car-a', orderNumber: '0000001', state: 'available' }],
      ['stock', { orderUuid: 'car-b', orderNumber: '0000002', state: 'available' }],
      ['quotes', { quoteId: 'quote-a', orderUuid: 'car-a', employeeId: 'employee-a', policyVersion: 'policy-1' }],
    ]) { const inserted = await tx.insert(table, { runId: 'run-a', ...row }); if (inserted.status !== 'ok') return inserted; }
    return ok('seeded');
  });
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
  return fixture;
}

test('inserts journal each row with its automatic insert receipt and the command receipt', async () => {
  const f = await seeded();
  const offer = f.last();
  assert.equal(offer.commit, true);
  const names = offer.mutations.map(brief);
  assert.equal(names.length, 13, '6 rows, 6 automatic insert receipts, 1 command receipt');
  assert.deepEqual(names.slice(0, 2), ['insert runs run-a', `insert event_receipts run-a repository:insert:runs ${inputDigest({ runId: 'run-a' })}`]);
  assert.equal(names.at(-1), 'insert event_receipts run-a command:transaction seed');
  assert.ok(offer.mutations.every((entry) => entry.type === 'insert' && !Object.hasOwn(entry, 'expectedVersion')));
  assert.ok(offer.mutations.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.key)));
  assertEquivalent(offer);
});

test('CAS journals one update with the stored version; repeated writes keep the first expected version and the final row', async () => {
  const f = await seeded();
  const out = await f.repository.transaction(ctx(), command(), async (tx) => {
    const first = await tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), 1, { revision: 'r2' });
    return tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), first.value.version, { revision: 'r3' });
  });
  assert.equal(out.value.version, 3);
  const [stock, receipt] = f.last().mutations;
  assert.equal(f.last().mutations.length, 2);
  assert.deepEqual([stock.type, stock.table, stock.key, stock.expectedVersion, stock.row.version, stock.row.revision],
    ['update', 'stock', { runId: 'run-a', orderUuid: 'car-b' }, 1, 3, 'r3']);
  assert.equal(brief(receipt).startsWith('insert event_receipts run-a command:transaction'), true);
  assertEquivalent(f.last());
});

test('an inserted row changed again in the same transaction stays one insert carrying the final row', async () => {
  const f = await seeded();
  await f.repository.transaction(ctx(), command(), async (tx) => {
    await tx.insert('stock', { runId: 'run-a', orderUuid: 'car-c', orderNumber: '0000003', state: 'available' });
    return tx.compareAndSwap(ref('stock', { orderUuid: 'car-c' }), 1, { state: 'held' });
  });
  const car = f.last().mutations.filter((entry) => entry.table === 'stock');
  assert.deepEqual(car.map((entry) => [entry.type, entry.row.state, entry.row.version]), [['insert', 'held', 2]]);
  assertEquivalent(f.last());
});

test('a composed claim journals hold, claim, their receipts, stock and slot updates, and the outbox job', async () => {
  const f = await seeded();
  const out = await f.repository.transaction(ctx(), command(), async (tx) => {
    const claim = await tx.conditionalClaim({ runId: 'run-a', ...claimInput });
    if (claim.status !== 'ok') return claim;
    return tx.enqueueNotification({ runId: 'run-a', jobId: 'job-a', idempotencyKey: 'offer-a', inputDigest: inputDigest('offer-a'),
      state: 'pending', payload: { offerLink: 'https://example.invalid/secret' } });
  });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const names = f.last().mutations.map((entry) => `${entry.type} ${entry.table}`);
  assert.deepEqual(names, ['insert holds', 'insert event_receipts', 'insert claims', 'insert event_receipts', 'update stock',
    'update entitlement_slots', 'insert notification_outbox', 'insert event_receipts', 'insert event_receipts']);
  const slot = f.last().mutations.find((entry) => entry.table === 'entitlement_slots');
  assert.deepEqual([slot.expectedVersion, slot.row.version], [1, 2], 'an empty-patch CAS still bumps and journals the version');
  const outboxReceipt = f.last().mutations[7].row;
  assert.equal(Object.hasOwn(outboxReceipt.outcome.value.payload, 'offerLink'), false, 'journal carries the stored receipt, without the link');
  assertEquivalent(f.last());
});

test('resetRun journals the old run retirement, its stale jobs, the new run seed and the reset receipt', async () => {
  const f = await seeded();
  await f.repository.transaction(ctx(), command(), (tx) => tx.enqueueNotification({ runId: 'run-a', jobId: 'job-old',
    idempotencyKey: 'old', inputDigest: inputDigest('old'), state: 'pending' }));
  const run = (await f.repository.read(ctx(), ref('runs', {}))).value;
  const reset = await f.repository.resetRun(ctx(), command('reset'), { expectedCurrentRunId: 'run-a', expectedRunVersion: run.version,
    nextRun: { runId: 'run-b', environmentId: 'environment-a', current: true, status: 'active' }, rows: [['employees', { employeeId: 'employee-b' }]] });
  assert.equal(reset.status, 'ok', JSON.stringify(reset));
  const names = f.last().mutations.map(brief);
  assert.deepEqual(names.slice(0, 2), ['update runs run-a', 'update notification_outbox run-a job-old']);
  assert.ok(names.includes('insert runs run-b'));
  assert.ok(names.includes('insert employees run-b employee-b'));
  assert.ok(names.some((name) => name.startsWith('insert event_receipts run-b repository:insert:employees')));
  assert.equal(names.at(-1), 'insert event_receipts run-a command:reset-run reset');
  assert.equal(names.length, 7);
  assert.equal(f.last().mutations[0].row.status, 'historical');
  assert.equal(f.last().mutations[1].row.state, 'stale');
  assertEquivalent(f.last());
});

test('rollback, failed CAS and refused commands offer no committed mutations', async () => {
  const f = await seeded();
  const committed = f.store.state;
  const failedCas = await f.repository.transaction(ctx(), command(), async (tx) => {
    await tx.insert('stock', { runId: 'run-a', orderUuid: 'car-x', orderNumber: '0000009' });
    return tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), 7, { revision: 'stale' });
  });
  assert.equal(failedCas.status, 'stale-version');
  const ignored = await f.repository.transaction(ctx(), command(), async (tx) => {
    await tx.insert('stock', { runId: 'run-a', orderUuid: 'car-y', orderNumber: '0000010' });
    await tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), 9, { revision: 'stale' });
    return ok('ignored the failure');
  });
  assert.equal(ignored.status, 'stale-version', 'a failed mutation poisons the transaction');
  const thrown = await f.repository.transaction(ctx(), command(), async (tx) => {
    await tx.insert('stock', { runId: 'run-a', orderUuid: 'car-z', orderNumber: '0000011' }); throw new Error('boom');
  });
  assert.equal(thrown.status, 'unavailable');
  const refused = await f.repository.transaction(ctx(), command(), async (tx) => {
    await tx.insert('stock', { runId: 'run-a', orderUuid: 'car-w', orderNumber: '0000012' }); return { status: 'conflict', reason: 'domain' };
  });
  assert.equal(refused.status, 'conflict');
  const failedReset = await f.repository.resetRun(ctx(), command(), { expectedCurrentRunId: 'run-a', expectedRunVersion: 1,
    nextRun: { runId: 'run-c', environmentId: 'environment-a', current: true, status: 'active' }, rows: [['entitlement_slots', { entitlementSlotId: 'bad', employeeId: 'missing', capacity: 1 }]] });
  assert.equal(failedReset.status, 'conflict');
  const attempts = f.offered.slice(-5);
  assert.deepEqual(attempts.map((offer) => [offer.commit, offer.mutations]), Array(5).fill([false, undefined]));
  assert.equal(f.store.state, committed, 'no attempt replaced committed state');
});

test('no-op writes and replays journal nothing beyond the new command receipt', async () => {
  const f = await seeded();
  const car = { runId: 'run-a', orderUuid: 'car-c', orderNumber: '0000003', state: 'available' };
  const job = { runId: 'run-a', jobId: 'job-a', idempotencyKey: 'offer-a', inputDigest: inputDigest('offer-a'), state: 'pending' };
  const receipt = { consumerId: 'consumer', eventId: 'event-1', inputDigest: inputDigest('event-1'), state: 'completed', outcome: ok(1) };
  await f.repository.transaction(ctx(), command(), async (tx) => { await tx.insert('stock', car); await tx.enqueueNotification(job); return tx.recordReceipt(receipt); });
  const id = command();
  const repeated = await f.repository.transaction(ctx(), id, async (tx) => {
    const again = await tx.insert('stock', car);
    if (again.status !== 'ok') return again;
    const lookup = await tx.get(ref('stock', { orderUuid: 'missing' }));
    assert.equal(lookup.status, 'not-found');
    await tx.list('stock');
    await tx.enqueueNotification(job);
    return tx.recordReceipt(receipt);
  });
  assert.equal(repeated.status, 'ok', JSON.stringify(repeated));
  assert.deepEqual(f.last().mutations.map(brief), [`insert event_receipts run-a command:transaction ${id.commandId}`]);
  assertEquivalent(f.last());
  const replay = await f.repository.transaction(ctx(), id, () => assert.fail('a command replay must not run its work'));
  assert.deepEqual(replay, repeated);
  assert.deepEqual([f.last().commit, f.last().mutations], [false, undefined]);
  const resetInput = { expectedCurrentRunId: 'run-a', expectedRunVersion: 1, nextRun: { runId: 'run-b', environmentId: 'environment-a', current: true, status: 'active' }, rows: [] };
  const reset = command('reset-replay');
  assert.equal((await f.repository.resetRun(ctx(), reset, resetInput)).status, 'ok');
  await f.repository.resetRun(ctx(), reset, resetInput);
  assert.deepEqual([f.last().commit, f.last().mutations], [false, undefined], 'a reset replay offers nothing');
});

test('adapters that ignore the journal see the same commit/outcome contract', async () => {
  const f = await seeded();
  const offer = f.last();
  assert.deepEqual(Object.keys(offer).sort(), ['after', 'before', 'commit', 'mutations']);
  const seen = [];
  const unsubscribe = f.repository.afterCommit((event) => seen.push(Object.keys(event).sort()));
  await f.repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { revision: 'r2' }));
  unsubscribe();
  assert.deepEqual(seen, [['changedTables', 'commandId', 'context']], 'commit observers keep their existing event shape');
});
