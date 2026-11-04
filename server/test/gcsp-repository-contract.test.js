import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { ok, result, inputDigest, TABLES, FOUNDATION_TABLES } from '../gcsp/repository/core.js';

const ctx = (runId = 'run-a') => ({ environmentId: `environment-${runId}`, runId, principalId: 'trusted-principal', roles: ['employee'] });
let serial = 0;
const command = (id = `command-${++serial}`, input = id) => ({ commandId: id, inputDigest: inputDigest(input) });
const ref = (table, key, context = ctx()) => ({ table, key: { runId: context.runId, ...key } });
const expiresAt = '2026-11-04T15:00:00.000Z';
const claimInput = (overrides = {}) => ({ orderUuid: 'car-a', holdId: 'hold-a', claimId: 'claim-a', employeeId: 'employee-a', entitlementSlotId: 'slot-a', type: 'cart', expiresAt, policyVersion: 'policy-1', quoteId: 'quote-a', expectedStockVersion: 1, expectedSlotVersion: 1, ...overrides });
async function setup(repository, context = ctx()) {
  const rows = [
    ['runs', { environmentId: context.environmentId, status: 'active' }],
    ['employees', { employeeId: 'employee-a' }], ['employees', { employeeId: 'employee-b' }],
    ['entitlement_slots', { entitlementSlotId: 'slot-a', employeeId: 'employee-a', capacity: 1 }],
    ['entitlement_slots', { entitlementSlotId: 'slot-b', employeeId: 'employee-b', capacity: 1 }],
    ['stock', { orderUuid: 'car-a', orderNumber: '0000001', configurationId: 'same-config', state: 'available' }],
    ['stock', { orderUuid: 'car-b', orderNumber: '0000002', configurationId: 'same-config', state: 'available' }],
    ['quotes', { quoteId: 'quote-a', orderUuid: 'car-a', employeeId: 'employee-a', policyVersion: 'policy-1' }],
    ['quotes', { quoteId: 'quote-b', orderUuid: 'car-b', employeeId: 'employee-b', policyVersion: 'policy-1' }],
    ['quotes', { quoteId: 'quote-ba', orderUuid: 'car-a', employeeId: 'employee-b', policyVersion: 'policy-1' }],
    ['quotes', { quoteId: 'quote-ab', orderUuid: 'car-b', employeeId: 'employee-a', policyVersion: 'policy-1' }],
  ];
  const out = await repository.transaction(context, command(), async (tx) => {
    for (const [table, row] of rows) {
      const inserted = await tx.insert(table, { runId: context.runId, ...row });
      assert.equal(inserted.status, 'ok', JSON.stringify(inserted));
    }
    return ok({ seeded: true });
  });
  assert.equal(out.status, 'ok', JSON.stringify(out));
}

// Each factory owns cleanup and supplies reopen() against the exact same backing store/database.
export function repositoryContract(provider, factory) {
  test(`${provider}: shared TransactionRepository contract`, async (t) => {
    const withRepository = async (work) => {
      const fixture = await factory();
      let repository = fixture.repository;
      try {
        const opened = await repository.open();
        assert.equal(opened.status, 'ok', JSON.stringify(opened));
        assert.equal(opened.contractVersion, '1.0.0');
        await setup(repository);
        await work(repository, async () => {
          await repository.close(); repository = await fixture.reopen();
          assert.equal((await repository.open()).status, 'ok');
          return repository;
        });
      } finally { await repository.close(); await fixture.cleanup?.(); }
    };
    await t.test('scoped CRUD, filtering, clones and persistence on reopen', () => withRepository(async (repository, reopen) => {
      const filtered = await repository.query(ctx(), 'stock', { configurationId: 'same-config' });
      assert.equal(filtered.value.length, 2);
      filtered.value[0].state = 'corrupted';
      assert.equal((await repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'available');
      repository = await reopen();
      assert.equal((await repository.query(ctx(), 'stock')).value.length, 2);
      const write = await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { revision: 2 }));
      assert.equal(write.value.version, 2);
      assert.equal((await repository.migrationStatus()).value.current, true);
    }));
    await t.test('thrown and typed failures roll back even if callback ignores failed operation', () => withRepository(async (repository) => {
      const thrown = await repository.transaction(ctx(), command(), async (tx) => { await tx.insert('employees', { runId: 'run-a', employeeId: 'throw' }); throw new Error('private detail'); });
      assert.equal(thrown.status, 'unavailable');
      assert.equal(JSON.stringify(thrown).includes('private detail'), false);
      const typed = await repository.transaction(ctx(), command(), async (tx) => { await tx.insert('employees', { runId: 'run-a', employeeId: 'typed' }); return result('conflict', { reason: 'abort', current: {} }); });
      assert.equal(typed.status, 'conflict');
      const ignored = await repository.transaction(ctx(), command(), async (tx) => { await tx.insert('employees', { runId: 'run-a', employeeId: 'ignored' }); await tx.insert('stock', { runId: 'run-a', orderUuid: 'new-car', orderNumber: '0000001' }); return ok('would-commit'); });
      assert.equal(ignored.status, 'conflict');
      for (const employeeId of ['throw', 'typed', 'ignored']) assert.equal((await repository.read(ctx(), ref('employees', { employeeId }))).status, 'not-found');
    }));
    await t.test('simultaneous exact-car claims produce one owner and explicit stale resource', () => withRepository(async (repository) => {
      const outcomes = await Promise.all([
        repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput())),
        repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ holdId: 'hold-b', claimId: 'claim-b', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-ba', type: 'buddy-offer' }))),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'ok').length, 1);
      const stale = outcomes.find((outcome) => outcome.status === 'stale-version');
      assert.deepEqual(stale, result('stale-version', { expectedVersion: 1, currentVersion: 2, resource: ref('stock', { orderUuid: 'car-a' }) }));
      assert.equal((await repository.query(ctx(), 'claims')).value.length, 1);
      const conflict = await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ holdId: 'hold-b', claimId: 'claim-b', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-ba', expectedStockVersion: 2 })));
      assert.equal(conflict.status, 'conflict'); assert.equal(conflict.reason, 'car-occupied');
      assert.equal(JSON.stringify(conflict).includes('employee-a'), false);
    }));
    await t.test('configuration identity never collapses two exact cars', () => withRepository(async (repository) => {
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput()))).status, 'ok');
      const second = await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ orderUuid: 'car-b', holdId: 'hold-b', claimId: 'claim-b', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-b', type: 'buddy-offer' })));
      assert.equal(second.status, 'ok'); assert.equal(second.value.slotVersion, 2);
    }));
    await t.test('pending phases occupy direct holds and claims; slot capacity is enforced', () => withRepository(async (repository) => {
      await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput()));
      for (const state of ['claim-pending', 'release-pending', 'selection-pending']) {
        const current = (await repository.read(ctx(), ref('holds', { holdId: 'hold-a' }))).value;
        assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('holds', { holdId: 'hold-a' }), current.version, { state }))).status, 'ok');
        const hold = { runId: 'run-a', holdId: 'bypass', orderUuid: 'car-a', employeeId: 'employee-b', entitlementSlotId: 'slot-b', type: 'buddy-offer', state, quoteId: 'quote-ba' };
        assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.insert('holds', hold))).reason, 'car-occupied');
      }
      const capacity = await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ orderUuid: 'car-b', holdId: 'hold-other', claimId: 'claim-other', quoteId: 'quote-ab', expectedSlotVersion: 2 })));
      assert.equal(capacity.reason, 'slot-capacity');
      assert.equal((await repository.query(ctx(), 'holds')).value.length, 1);
      assert.equal((await repository.read(ctx(), ref('stock', { orderUuid: 'car-b' }))).value.state, 'available');
    }));
    await t.test('slot versions, configured capacity, owner and allocation exclusion', () => withRepository(async (repository) => {
      const missingCapacity = await repository.transaction(ctx(), command(), (tx) => tx.insert('entitlement_slots', { runId: 'run-a', employeeId: 'employee-a', entitlementSlotId: 'slot-empty' }));
      assert.equal(missingCapacity.status, 'ok');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ entitlementSlotId: 'slot-empty' })))).code, 'invalid-capacity');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ expectedSlotVersion: 2 })))).resource.table, 'entitlement_slots');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ entitlementSlotId: 'slot-b' })))).status, 'forbidden');
      await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { state: 'allocated' }));
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ expectedStockVersion: 2 })))).reason, 'stock-unavailable');
    }));
    await t.test('hold, offer and outbox form one atomic transaction', () => withRepository(async (repository) => {
      const execute = async (tx, fail) => {
        const claim = await tx.conditionalClaim(claimInput({ type: 'buddy-offer' }));
        if (claim.status !== 'ok') return claim;
        await tx.insert('offers', { runId: 'run-a', offerId: 'offer-a', holdId: 'hold-a', quoteId: 'quote-a' });
        await tx.enqueueNotification({ jobId: 'job-a', idempotencyKey: 'offer:offer-a:notification:offer:1', inputDigest: 'digest', offerId: 'offer-a', state: 'pending' });
        return fail ? result('conflict', { reason: 'abort', current: {} }) : ok(claim.value);
      };
      assert.equal((await repository.transaction(ctx(), command(), (tx) => execute(tx, true))).status, 'conflict');
      for (const table of ['holds', 'claims', 'offers', 'notification_outbox']) assert.equal((await repository.query(ctx(), table)).value.length, 0);
      assert.equal((await repository.transaction(ctx(), command(), (tx) => execute(tx, false))).status, 'ok');
      for (const table of ['holds', 'claims', 'offers', 'notification_outbox']) assert.equal((await repository.query(ctx(), table)).value.length, 1);
    }));
    await t.test('CAS races have one winner; keys and historical rows are immutable', () => withRepository(async (repository) => {
      const outcomes = await Promise.all([1, 2].map((revision) => repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { revision }))));
      assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['ok', 'stale-version']);
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 2, { orderUuid: 'new-id' }))).code, 'immutable-field');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('quotes', { quoteId: 'quote-a' }), 1, { policyVersion: 'policy-2' }))).code, 'immutable-row');
      await repository.transaction(ctx(), command(), (tx) => tx.insert('briefs', { runId: 'run-a', employeeId: 'employee-a', briefVersion: 1, status: 'confirmed' }));
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('briefs', { employeeId: 'employee-a', briefVersion: 1 }), 1, { status: 'draft' }))).code, 'immutable-row');
    }));
    await t.test('command, event and notification replay preserves original outcomes', () => withRepository(async (repository) => {
      const stable = command('stable');
      const first = await repository.transaction(ctx(), stable, (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { revision: 2 }));
      const replay = await repository.transaction(ctx(), stable, () => { throw new Error('must not execute'); });
      assert.deepEqual(replay, first);
      assert.equal((await repository.transaction(ctx(), command('stable', 'changed'), () => ok(null))).reason, 'idempotency-input-changed');
      const receipt = { consumerId: 'handler', eventId: 'event', inputDigest: 'same', outcome: ok({ original: 1 }) };
      const recorded = await repository.transaction(ctx(), command(), (tx) => tx.recordReceipt(receipt));
      assert.deepEqual(await repository.transaction(ctx(), command(), (tx) => tx.recordReceipt({ ...receipt, outcome: ok({ original: 2 }) })), recorded);
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.recordReceipt({ ...receipt, inputDigest: 'changed' }))).status, 'conflict');
      assert.deepEqual((await repository.transaction(ctx(), command(), (tx) => tx.getReceipt('handler', 'event'))).value, recorded.value);
      const job = { jobId: 'job', idempotencyKey: 'stable-job', inputDigest: 'same', state: 'pending' };
      const queued = await repository.transaction(ctx(), command(), (tx) => tx.enqueueNotification(job));
      assert.deepEqual(await repository.transaction(ctx(), command(), (tx) => tx.enqueueNotification({ ...job, jobId: 'different-id' })), queued);
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.enqueueNotification({ ...job, inputDigest: 'changed' }))).status, 'conflict');
      const row = { runId: 'run-a', employeeId: 'replay-row', name: 'First' };
      const inserted = await repository.transaction(ctx(), command(), (tx) => tx.insert('employees', row));
      assert.deepEqual(await repository.transaction(ctx(), command(), (tx) => tx.insert('employees', row)), inserted);
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.insert('employees', { ...row, name: 'Changed' }))).status, 'conflict');
    }));
    await t.test('run isolation, malformed inputs and future migration refusal', () => withRepository(async (repository) => {
      await setup(repository, ctx('run-b'));
      assert.equal((await repository.query(ctx(), 'stock')).value.length, 2);
      for (const action of [
        () => repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }, ctx('run-b'))),
        () => repository.query(ctx(), 'stock', { runId: 'run-b' }),
        () => repository.transaction(ctx(), command(), (tx) => tx.insert('employees', { runId: 'run-b', employeeId: 'wrong' })),
      ]) assert.equal((await action()).status, 'stale-run');
      assert.equal((await repository.query({ ...ctx(), environmentId: 'other' }, 'stock')).status, 'forbidden');
      assert.equal((await repository.query({}, 'stock')).status, 'invalid');
      for (const table of ['stock; DROP TABLE stock', 'constructor', '__proto__']) assert.equal((await repository.query(ctx(), table)).code, 'unknown-table');
      assert.equal((await repository.query(ctx(), 'stock', { unregistered: 1 })).code, 'unknown-field');
      assert.equal((await repository.read(ctx(), { table: 'stock', key: { orderUuid: 'car-a' } })).code, 'invalid-key');
      assert.equal((await repository.query(ctx(), 'policy_versions')).code, 'unsupported-table');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 0, {}))).code, 'invalid-version');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.insert('stock', JSON.parse('{"runId":"run-a","orderUuid":"bad","constructor":{}}')))).status, 'invalid');
      await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('runs', {}), 1, { status: 'historical' }));
      assert.equal((await repository.transaction(ctx(), command(), () => ok('forbidden'))).status, 'stale-run');
      assert.equal((await repository.query(ctx(), 'stock')).status, 'ok');
    }));
    await t.test('configured capacity two permits two exact cars for the same slot', () => withRepository(async (repository) => {
      await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('entitlement_slots', { entitlementSlotId: 'slot-a' }), 1, { capacity: 2 }));
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ expectedSlotVersion: 2 })))).status, 'ok');
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ orderUuid: 'car-b', holdId: 'second', claimId: 'second', quoteId: 'quote-ab', expectedSlotVersion: 3 })))).status, 'ok');
      assert.equal((await repository.query(ctx(), 'claims')).value.length, 2);
    }));
    await t.test('read misses allow receipt creation; escaped transaction and malformed success fail safely', () => withRepository(async (repository) => {
      let escaped;
      const outcome = await repository.transaction(ctx(), command(), async (tx) => {
        escaped = tx;
        assert.equal((await tx.getReceipt('new-handler', 'new-event')).status, 'not-found');
        return tx.recordReceipt({ consumerId: 'new-handler', eventId: 'new-event', inputDigest: 'same', outcome: ok('recorded') });
      });
      assert.equal(outcome.status, 'ok');
      assert.equal((await escaped.insert('employees', { runId: 'run-a', employeeId: 'late' })).code, 'transaction-closed');
      const bad = await repository.transaction(ctx(), command(), async (tx) => {
        await tx.insert('employees', { runId: 'run-a', employeeId: 'malformed-result' });
        return { status: 'ok' };
      });
      assert.equal(bad.code, 'invalid-outcome');
      assert.equal((await repository.read(ctx(), ref('employees', { employeeId: 'malformed-result' }))).status, 'not-found');
    }));
    await t.test('insert replay retains original row after later CAS; historical command replay is stable', () => withRepository(async (repository) => {
      const row = { runId: 'run-a', employeeId: 'history', name: 'Original' };
      const inserted = await repository.transaction(ctx(), command(), (tx) => tx.insert('employees', row));
      await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('employees', { employeeId: 'history' }), 1, { name: 'Updated' }));
      assert.deepEqual(await repository.transaction(ctx(), command(), (tx) => tx.insert('employees', row)), inserted);
      const stable = command('before-history');
      const before = await repository.transaction(ctx(), stable, () => ok({ original: 1 }));
      await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('runs', {}), 1, { status: 'historical' }));
      assert.deepEqual(await repository.transaction(ctx(), stable, () => ok({ original: 2 })), before);
    }));
    await t.test('closed provider returns UI-safe unavailable shape', () => withRepository(async (repository) => {
      await repository.close();
      assert.deepEqual(await repository.query(ctx(), 'stock'), result('unavailable', { reason: 'Repository is unavailable', retryable: true }));
    }));
  });
}

repositoryContract('memory', async () => {
  const store = createMemoryStore();
  return { repository: createMemoryRepository({ store }), reopen: () => createMemoryRepository({ store }) };
});

test('memory: explicit store and complete foundation vocabulary', async () => {
  assert.equal((await createMemoryRepository().open()).code, 'missing-store');
  assert.equal(FOUNDATION_TABLES.length, 17);
  assert.equal(Object.keys(TABLES).length, 23);
  assert.equal(inputDigest({ b: 2, a: 1 }), inputDigest({ a: 1, b: 2 }));
});
