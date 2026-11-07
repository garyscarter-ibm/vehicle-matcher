import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { ok, result, inputDigest, TABLES, FOUNDATION_TABLES } from '../gcsp/repository/core.js';
import { migrate, migrationStatus, loadMigrations } from '../gcsp/migrations/index.js';
const responseFixtures = JSON.parse(readFileSync(new URL('./fixtures/gcsp-repository-outcomes.json', import.meta.url), 'utf8'));

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
        }, fixture.processRead, fixture.independent);
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
    await t.test('atomic reset switches current run, preserves history and rolls back failed seeds', () => withRepository(async (repository, reopen) => {
      const c = ctx();
      await repository.transaction(c, command(), (tx) => tx.compareAndSwap(ref('runs', {}, c), 1, { current: true }));
      const next = { runId: 'reset-run', environmentId: c.environmentId, current: true, status: 'active' };
      const rows = [['employees', { employeeId: 'reset-person' }]];
      const staleReset = await repository.resetRun(c, command(), { expectedCurrentRunId: c.runId, expectedRunVersion: 1, nextRun: next, rows });
      assert.equal(staleReset.status, 'stale-version');
      assert.equal((await repository.currentRun(c.environmentId)).value.runId, c.runId);
      const bad = await repository.resetRun(c, command(), { expectedCurrentRunId: c.runId, expectedRunVersion: 2, nextRun: next,
        rows: [['entitlement_slots', { entitlementSlotId: 'bad', employeeId: 'missing', capacity: 1 }]] });
      assert.equal(bad.status, 'conflict');
      assert.equal((await repository.currentRun(c.environmentId)).value.runId, c.runId);
      const cmd = command();
      const input = { expectedCurrentRunId: c.runId, expectedRunVersion: 2, nextRun: next, rows };
      const changed = await repository.resetRun(c, cmd, input);
      assert.equal(changed.status, 'ok');
      repository = await reopen();
      assert.deepEqual(await repository.resetRun(c, cmd, input), changed);
      assert.equal((await repository.currentRun(c.environmentId)).value.runId, 'reset-run');
      assert.equal((await repository.read(c, ref('runs', {}, c))).value.status, 'historical');
      assert.equal((await repository.query(c, 'stock')).value.length, 2);
      const newContext = { ...c, runId: 'reset-run' };
      assert.equal((await repository.query(newContext, 'employees')).value[0].employeeId, 'reset-person');
      assert.equal((await repository.transaction(c, command(), (tx) => tx.insert('decisions', { runId: c.runId, decisionId: 'stale' }))).status, 'stale-run');
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
    await t.test('simultaneous exact-car claims produce one owner and explicit stale resource', () => withRepository(async (repository, _reopen, _processRead, independent) => {
      const competitor = independent ? await independent() : repository;
      const outcomes = await Promise.all([
        repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput())),
        competitor.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ holdId: 'hold-b', claimId: 'claim-b', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-ba', type: 'buddy-offer' }))),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === 'ok').length, 1);
      const stale = outcomes.find((outcome) => outcome.status === 'stale-version');
      assert.deepEqual(stale, responseFixtures.staleVersion);
      assert.equal((await repository.query(ctx(), 'claims')).value.length, 1);
      // Independent native pools may let either contender win; the loser retries at the new stock version.
      const aWon = outcomes[0].status === 'ok';
      const loser = aWon ? { holdId: 'hold-b', claimId: 'claim-b', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-ba' } : {};
      const conflict = await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ ...loser, expectedStockVersion: 2 })));
      assert.equal(conflict.status, 'conflict'); assert.equal(conflict.reason, 'car-occupied');
      assert.deepEqual(conflict, responseFixtures.conflict);
      assert.equal(JSON.stringify(conflict).includes(aWon ? 'employee-a' : 'employee-b'), false);
    }));
    await t.test('configuration identity never collapses two exact cars', () => withRepository(async (repository) => {
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput()))).status, 'ok');
      const second = await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({ orderUuid: 'car-b', holdId: 'hold-b', claimId: 'claim-b', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-b', type: 'buddy-offer' })));
      assert.equal(second.status, 'ok'); assert.equal(second.value.slotVersion, 2);
    }));
    await t.test('manual pinned quote, pending intent and exclusion commit together, roll back and survive reopen', () => withRepository(async (repository, reopen, processRead) => {
      const quote = { runId: 'run-a', quoteId: 'manual-quote', orderUuid: 'car-a', employeeId: 'employee-a',
        entitlementSlotId: 'slot-a', configurationId: 'same-config', draftVersion: 7, policyVersion: 'policy-1',
        quotedAt: '2026-11-04T14:58:00.000Z', validUntil: expiresAt, expiresAt,
        facts: { source: 'synthetic-contract', exact: 'car-a' }, terms: { points: { value: 800, unit: 'points' } },
        provenance: { sourceRef: 'fixture:manual-contract' } };
      const runClaim = async (tx, abort) => {
        const draft = await tx.recordReceipt({ consumerId: 'manual:draft:employee-a', eventId: '7', inputDigest: 'manual-draft-v7',
          outcome: ok({ draftVersion: 7, employeeId: 'employee-a', entitlementSlotId: 'slot-a', choices: { driverId: 'driver-a' } }) });
        if (draft.status !== 'ok') return draft;
        const pinned = await tx.insert('quotes', quote); if (pinned.status !== 'ok') return pinned;
        const claim = await tx.conditionalClaim(claimInput({ quoteId: quote.quoteId, state: 'claim-pending', phase: 'preview', operationId: 'manual-operation' }));
        if (claim.status !== 'ok') return claim;
        const operation = await tx.insert('pending_operations', { runId: 'run-a', operationId: 'manual-operation',
          operationType: 'manual-claim', idempotencyKey: 'manual-key', inputDigest: 'same-input', holdId: 'hold-a',
          state: 'pending', lastKnownState: 'claim-pending', attempts: 0,
          payload: { orderUuid: 'car-a', target: 'active', quote: pinned.value } });
        if (operation.status !== 'ok') return operation;
        return abort ? result('unavailable', { retryable: true }) : result('pending', {
          operationId: 'manual-operation', operationType: 'manual-claim', lastKnownState: 'claim-pending' });
      };
      assert.equal((await repository.transaction(ctx(), command(), (tx) => runClaim(tx, true))).status, 'unavailable');
      for (const table of ['holds', 'claims', 'pending_operations']) assert.equal((await repository.query(ctx(), table)).value.length, 0);
      assert.equal((await repository.read(ctx(), ref('quotes', { quoteId: quote.quoteId }))).status, 'not-found');
      assert.equal((await repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.version, 1);
      const stable = command('manual-durable');
      const original = await repository.transaction(ctx(), stable, (tx) => runClaim(tx, false)); assert.equal(original.status, 'pending');
      repository = await reopen();
      assert.deepEqual(await repository.transaction(ctx(), stable, () => { throw new Error('must not replay effect'); }), original);
      const hold = (await repository.read(ctx(), ref('holds', { holdId: 'hold-a' }))).value;
      assert.equal(hold.state, 'claim-pending'); assert.equal(hold.expiresAt, expiresAt); assert.equal(hold.phase, 'preview');
      const pinned = (await repository.read(ctx(), ref('quotes', { quoteId: quote.quoteId }))).value;
      assert.equal(pinned.draftVersion, 7); assert.deepEqual(pinned.facts, quote.facts); assert.deepEqual(pinned.terms, quote.terms);
      const operations = (await repository.query(ctx(), 'pending_operations')).value;
      assert.equal(operations[0].payload.quote.quoteId, quote.quoteId);
      const draft = (await repository.read(ctx(), ref('event_receipts', { consumerId: 'manual:draft:employee-a', eventId: '7' }))).value.outcome.value;
      assert.equal(draft.draftVersion, 7);
      const claims = (await repository.query(ctx(), 'claims', { holdId: 'hold-a' })).value;
      const stock = (await repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value;
      if (processRead) assert.deepEqual(processRead('hold-a'), { hold, quote: pinned, draft, operations, claims, stock });
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput({
        holdId: 'competitor', claimId: 'competitor', employeeId: 'employee-b', entitlementSlotId: 'slot-b', quoteId: 'quote-ba', expectedStockVersion: 2,
      })))).reason, 'car-occupied');
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
    await t.test('F71 selection intent, ownership and history roll back, replay and survive pending/acknowledged reopen', async (orderT) => withRepository(async (repository, reopen, processRead) => {
      assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput()))).status, 'ok');
      const refs = [ref('holds', { holdId: 'hold-a' }), ref('claims', { claimId: 'claim-a' }),
        ref('stock', { orderUuid: 'car-a' }), ref('entitlement_slots', { entitlementSlotId: 'slot-a' })];
      const before = await Promise.all(refs.map(async (key) => (await repository.read(ctx(), key)).value));
      const operationId = 'selection:employee-a:slot-a';
      const operationRef = ref('pending_operations', { operationId });
      const consumerId = 'ordering:history:employee-a';
      const selection = { stock: { orderUuid: 'car-a', orderNumber: '0000001', configurationId: 'same-config' },
        quote: (await repository.read(ctx(), ref('quotes', { quoteId: 'quote-a' }))).value,
        terms: { termsVersion: 'repository-contract-fixture', fictional: true }, driver: { driverId: 'fixture-driver' } };
      const write = async (tx, abort) => {
        const stored = await tx.insert('pending_operations', { runId: 'run-a', operationId, operationType: 'selection-order',
          idempotencyKey: operationId, inputDigest: inputDigest(selection), state: 'pending', lastKnownState: 'unknown',
          attempts: 1, payload: { context: ctx(), orderUuid: 'car-a', selection } });
        if (stored.status !== 'ok') return stored;
        const received = await tx.recordReceipt({ consumerId, eventId: `${operationId}:received`, inputDigest: inputDigest(selection),
          eventType: 'selection-received', state: 'completed', outcome: ok({ operationId, selection }) });
        if (received.status !== 'ok') return received;
        for (const key of refs) {
          const current = await tx.get(key); if (current.status !== 'ok') return current;
          const changed = await tx.compareAndSwap(key, current.value.version, { state: 'allocated',
            ...(key.table === 'stock' ? { available: false, held: false, allocated: true } : {}) });
          if (changed.status !== 'ok') return changed;
        }
        return abort ? result('conflict', { reason: 'selection-fixture-rollback' }) : result('pending', {
          operationId, operationType: 'selection-order', lastKnownState: 'unknown' });
      };
      assert.equal((await repository.transaction(ctx(), command(), (tx) => write(tx, true))).reason, 'selection-fixture-rollback');
      assert.equal((await repository.read(ctx(), operationRef)).status, 'not-found');
      assert.equal((await repository.query(ctx(), 'event_receipts', { consumerId })).value.length, 0);
      assert.deepEqual(await Promise.all(refs.map(async (key) => (await repository.read(ctx(), key)).value)), before);
      const stable = command('selection-durable', selection);
      const pending = await repository.transaction(ctx(), stable, (tx) => write(tx, false));
      assert.equal(pending.status, 'pending');
      repository = await reopen();
      assert.deepEqual(await repository.transaction(ctx(), stable, () => assert.fail('selection replay must not write')), pending);
      assert.equal((await repository.transaction(ctx(), command('selection-durable', 'changed'), () => ok(null))).status, 'conflict');
      const saved = (await repository.read(ctx(), operationRef)).value;
      assert.deepEqual(saved.payload.selection, selection); assert.equal(saved.state, 'pending');
      const order = { status: 'confirmed', orderUuid: 'car-a', orderNumber: '0000001', orderStatus: 'HR approval' };
      assert.equal((await repository.transaction(ctx(), command(), async (tx) => {
        const updated = await tx.compareAndSwap(operationRef, saved.version, { state: 'completed', lastKnownState: 'acknowledged', outcome: order });
        if (updated.status !== 'ok') return updated;
        return tx.recordReceipt({ consumerId, eventId: `${operationId}:outcome`, inputDigest: inputDigest(order),
          eventType: 'selection-acknowledged', state: 'completed', outcome: ok({ operationId, order }) });
      })).status, 'ok');
      repository = await reopen();
      const acknowledged = (await repository.read(ctx(), operationRef)).value;
      assert.deepEqual(acknowledged.payload.selection, selection); assert.deepEqual(acknowledged.outcome, order);
      assert.equal((await repository.query(ctx(), 'event_receipts', { consumerId })).value.length, 2);
      assert.equal((await repository.read(ctx(), ref('entitlement_slots', { entitlementSlotId: 'slot-a' }))).value.state, 'allocated');
      const duplicate = await repository.transaction(ctx(), command(), (tx) => tx.insert('pending_operations', {
        ...saved, payload: { ...saved.payload, orderUuid: 'car-b' } }));
      assert.equal(duplicate.status, 'conflict');
      await orderT.test('F71 ordering new-process readback', { skip: !processRead && 'Fixture has no ordering-capable processRead; native new-process proof remains outstanding' }, async () => {
        const external = await processRead('hold-a');
        assert.deepEqual(external.operations.find((row) => row.operationId === operationId), acknowledged);
      });
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
    await t.test('renewal case uniqueness and notification rollback share the provider transaction', () => withRepository(async (repository) => {
      const row = { runId: 'run-a', caseId: 'case-one', employeeId: 'employee-a', renewalId: 'renewal-a', status: 'open', history: [] };
      const saved = await repository.transaction(ctx(), command(), (tx) => tx.insert('renewal_cases', row));
      assert.equal(saved.status, 'ok');
      const duplicate = await repository.transaction(ctx(), command(), (tx) => tx.insert('renewal_cases', { ...row, caseId: 'case-two' }));
      assert.equal(duplicate.reason, 'active-renewal-case-exists');
      const rollback = await repository.transaction(ctx(), command(), async (tx) => {
        await tx.compareAndSwap(ref('renewal_cases', { caseId: 'case-one' }), saved.value.version, { status: 'in-progress' });
        await tx.enqueueNotification({ jobId: 'case-update', idempotencyKey: 'case:one:update:2', inputDigest: inputDigest('case'),
          recipientId: 'employee-a', messageKind: 'renewal-case-update', state: 'pending' });
        return result('conflict', { reason: 'fixture-rollback' });
      });
      assert.equal(rollback.reason, 'fixture-rollback');
      assert.deepEqual((await repository.read(ctx(), ref('renewal_cases', { caseId: 'case-one' }))).value, saved.value);
      assert.equal((await repository.query(ctx(), 'notification_outbox')).value.length, 0);
      const invalid = await repository.transaction(ctx(), command(), (tx) => tx.insert('renewal_cases', { ...row, caseId: 'invalid', status: 'invented' }));
      assert.equal(invalid.status, 'invalid');
    }));
    await t.test('closed provider returns UI-safe unavailable shape', () => withRepository(async (repository) => {
      await repository.close();
      assert.deepEqual(await repository.query(ctx(), 'stock'), responseFixtures.unavailable);
    }));
    await t.test('storage types protect occupancy constraints and the run environment', () => withRepository(async (repository) => {
      const invalidHold = await repository.transaction(ctx(), command(), (tx) => tx.insert('holds', {
        runId: 'run-a', holdId: 'unknown-state', orderUuid: 'car-a', employeeId: 'employee-a',
        entitlementSlotId: 'slot-a', type: 'cart', state: 'unknown', quoteId: 'quote-a',
      }));
      assert.equal(invalidHold.status, 'invalid');
      const moved = await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('runs', {}), 1, { environmentId: 'other-environment' }));
      assert.equal(moved.status, 'forbidden');
      assert.equal((await repository.query(ctx(), 'stock')).status, 'ok');
    }));
  });
}

test('postgresql native constraints reject a second occupying hold and claim', {
  skip: process.env.GCSP_DATABASE_URL === undefined ? 'GCSP_DATABASE_URL is unset; native SQL constraints were not run' : false,
}, async () => {
  const schema = `gcsp_constraints_${process.pid}_1`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  pool.on('error', () => {});
  let created = false;
  const repository = createPostgresRepository({ schema });
  try {
    try { await pool.query(`CREATE SCHEMA "${schema}"`); created = true; }
    catch { throw new Error('PostgreSQL native-constraint fixture unavailable'); }
    assert.equal((await repository.open()).status, 'ok'); await setup(repository);
    const claimed = await repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput()));
    assert.equal(claimed.status, 'ok');
    for (const state of ['active', 'claim-pending', 'release-pending', 'selection-pending']) {
      const duplicate = { ...claimed.value.hold, holdId: `duplicate-${state}`, state };
      await assert.rejects(pool.query(`INSERT INTO "${schema}".holds (data) VALUES ($1::jsonb)`, [JSON.stringify(duplicate)]), (error) => error.code === '23505');
    }
    await pool.query(`INSERT INTO "${schema}".holds (data) VALUES ($1::jsonb)`, [JSON.stringify({ ...claimed.value.hold, holdId: 'terminal', state: 'released' })]);
    for (const state of ['active', 'claim-pending', 'release-pending', 'selection-pending']) {
      const duplicate = { ...claimed.value.claim, claimId: `duplicate-${state}`, holdId: 'terminal', state };
      await assert.rejects(pool.query(`INSERT INTO "${schema}".claims (data) VALUES ($1::jsonb)`, [JSON.stringify(duplicate)]), (error) => error.code === '23505');
    }
  } finally {
    await repository.close();
    try {
      if (created) {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        const absent = await pool.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1', [schema]);
        assert.equal(absent.rows[0].count, 0, 'The exact owned native-constraint schema must be absent.');
      }
    }
    catch { throw new Error('PostgreSQL native-constraint fixture cleanup incomplete'); }
    finally { await pool.end(); }
  }
});

repositoryContract('memory', async () => {
  const store = createMemoryStore();
  return { repository: createMemoryRepository({ store }), reopen: () => createMemoryRepository({ store }) };
});

test('memory: explicit store and complete foundation vocabulary', async () => {
  assert.equal((await createMemoryRepository().open()).code, 'missing-store');
  assert.equal(FOUNDATION_TABLES.length, 18);
  assert.equal(Object.keys(TABLES).length, 24);
  assert.equal(inputDigest({ b: 2, a: 1 }), inputDigest({ a: 1, b: 2 }));
});

if (process.env.GCSP_DATABASE_URL === undefined) {
  test('postgresql: shared TransactionRepository contract', { skip: 'GCSP_DATABASE_URL is unset; PostgreSQL integration was not run' }, () => {});
} else {
  let schemaSerial = 0;
  repositoryContract('postgresql', async () => {
    const schema = `gcsp_contract_${process.pid}_${++schemaSerial}`;
    const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    pool.on('error', () => {});
    try { await pool.query(`CREATE SCHEMA "${schema}"`); }
    catch { await pool.end(); throw new Error('PostgreSQL contract schema setup unavailable'); }
    const pools = [];
    const repositories = [];
    const create = () => {
      const ownedPool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 1,
        connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 15000 });
      ownedPool.on('error', () => {}); pools.push(ownedPool);
      const repository = createPostgresRepository({ schema, pool: ownedPool }); repositories.push(repository);
      return repository;
    };
    const primary = create();
    return {
      repository: primary,
      reopen: create,
      async independent() {
        const secondary = create();
        assert.equal((await secondary.open()).status, 'ok');
        const pids = await Promise.all(pools.slice(0, 2).map(async (ownedPool) =>
          (await ownedPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
        assert.equal(new Set(pids).size, 2, 'Exact-car contenders use independent PostgreSQL pools and backend sessions.');
        return secondary;
      },
      processRead(holdId) {
        try {
          return JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./helpers/manual-claim-reopen.js', import.meta.url)),
            schema, 'run-a', ctx().environmentId, holdId], { encoding: 'utf8', timeout: 20000, maxBuffer: 65536,
            stdio: ['ignore', 'pipe', 'pipe'] }));
        } catch { throw new Error('Configured PostgreSQL process reopen proof unavailable'); }
      },
      async cleanup() {
        try {
          for (const repository of repositories) await repository.close();
          for (const ownedPool of pools) await ownedPool.end();
          await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
          const absent = await pool.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1', [schema]);
          assert.equal(absent.rows[0].count, 0, 'The exact owned contract schema must be absent.');
        } catch { throw new Error('PostgreSQL contract schema cleanup incomplete'); }
        finally { await pool.end(); }
      },
    };
  });
}

// This driver double tests adapter transaction/failure handling; it does not validate PostgreSQL SQL execution.
function driverDouble({ state = { tables: Object.fromEntries(Object.keys(TABLES).map((table) => [table, []])) }, failTable, failMigration = false, uncertainCommit = false } = {}) {
  let data = structuredClone(state);
  let applied = [];
  let exists = false;
  let savepoint;
  let ddlExecutions = 0;
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push(sql);
      if (sql === 'BEGIN') { savepoint = { data: structuredClone(data), applied: structuredClone(applied), exists }; return { rows: [] }; }
      if (sql === 'ROLLBACK') { if (savepoint) ({ data, applied, exists } = savepoint); savepoint = undefined; return { rows: [] }; }
      const commit = () => {
        savepoint = undefined;
        if (uncertainCommit && data.tables.holds.length) { uncertainCommit = false; throw new Error('PRIVATE_DATABASE_DETAIL'); }
        return { rows: [] };
      };
      if (sql === 'COMMIT') return commit();
      if (sql.startsWith('BEGIN; SELECT pg_advisory_xact_lock')) {
        // Simple-protocol multi-statement: BEGIN, lock, one UNION ALL snapshot, optional COMMIT.
        savepoint = { data: structuredClone(data), applied: structuredClone(applied), exists };
        const rows = sql.split('; ')[2].split(' UNION ALL ').flatMap((part) => {
          const [, name, scope] = part.match(/^SELECT '([a-z_]+)' AS t, data FROM "[a-z_]+"\."[a-z_]+"( WHERE .*)?$/);
          const runId = scope?.match(/^ WHERE run_id = '(.*)'$/)?.[1];
          return data.tables[name].filter((row) => !scope || (scope !== ' WHERE false' && row.runId === runId)).map((row) => ({ t: name, data: structuredClone(row) }));
        });
        return [{ rows: [] }, { rows: [] }, { rows }, ...(sql.endsWith('; COMMIT') ? [commit()] : [])];
      }
      if (sql.startsWith('SELECT to_regclass')) return { rows: [{ name: exists ? 'schema_migrations' : null }] };
      if (sql.startsWith('SELECT version, filename, checksum')) return { rows: structuredClone(applied) };
      if (sql.includes('CREATE TABLE IF NOT EXISTS')) { exists = true; return { rows: [] }; }
      if (sql.startsWith('INSERT INTO') && sql.includes('.schema_migrations')) {
        applied.push({ version: values[0], filename: values[1], checksum: values[2] }); return { rows: [] };
      }
      if ((sql.includes('CREATE TABLE "runs"') || sql.includes('CREATE TABLE policy_versions') || sql.includes('CREATE TABLE renewal_cases'))) {
        ddlExecutions += 1;
        if (failMigration) throw new Error('PRIVATE_DATABASE_DETAIL');
        return { rows: [] };
      }
      const table = sql.match(/(?:FROM|INTO|UPDATE) "[a-z_0-9]+"\."([a-z_]+)"/)?.[1];
      if (sql.startsWith('INSERT INTO') && table) {
        if (table === failTable) throw new Error('PRIVATE_DATABASE_DETAIL');
        const rows = JSON.parse(values[0]); data.tables[table].push(...rows); return { rowCount: rows.length, rows: [] };
      }
      if (sql.startsWith('UPDATE') && table && sql.includes('jsonb_array_elements')) {
        let rowCount = 0;
        for (const { row, old } of JSON.parse(values[0])) {
          const index = data.tables[table].findIndex((current) => TABLES[table].key.every((key) => current[key] === row[key]) && current.version === old);
          if (index >= 0) { data.tables[table][index] = row; rowCount += 1; }
        }
        return { rowCount, rows: [] };
      }
      if (sql.startsWith('UPDATE') && table) {
        const replacement = JSON.parse(values[0]);
        const index = data.tables[table].findIndex((row) => TABLES[table].key.every((key, i) => row[key] === values[i + 1]) && row.version === values.at(-1));
        if (index < 0) return { rowCount: 0, rows: [] };
        data.tables[table][index] = replacement; return { rowCount: 1, rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  let queue = Promise.resolve();
  return {
    pool: { async connect() {
      const previous = queue; let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      return { ...client, release };
    } },
    setFailureTable: (table) => { failTable = table; },
    read: () => structuredClone(data), ledger: () => applied, queries,
    ddlExecutions: () => ddlExecutions,
  };
}

repositoryContract('postgresql driver double (not live SQL)', async () => {
  const driver = driverDouble();
  return { repository: createPostgresRepository({ pool: driver.pool }), reopen: () => createPostgresRepository({ pool: driver.pool }) };
});

test('postgresql driver: migrations record checksums, rerun once and reject changed history', async () => {
  const driver = driverDouble();
  assert.deepEqual((await migrationStatus(driver.pool)).value, { current: false, appliedVersions: [], pendingVersions: ['0001', '0002', '0003'] });
  assert.equal((await migrate(driver.pool)).status, 'ok');
  assert.equal((await migrate(driver.pool)).status, 'ok');
  assert.equal(driver.ddlExecutions(), 3);
  const migrations = await loadMigrations();
  assert.deepEqual(driver.ledger().map(({version, checksum}) => ({version, checksum})),
    migrations.map(({version, checksum}) => ({version, checksum})));
  driver.ledger()[0].checksum = 'changed';
  const changed = await migrate(driver.pool);
  assert.equal(changed.reason, 'migration-history-mismatch');
  assert.equal(changed.retryable, false);
  assert.equal(driver.ddlExecutions(), 3);
  const failed = driverDouble({ failMigration: true });
  assert.equal((await migrate(failed.pool)).status, 'unavailable');
  assert.deepEqual(failed.ledger(), []);
  assert.equal(failed.queries.includes('ROLLBACK'), true);
});

test('postgresql driver: unavailable startup and configuration never expose credentials', async () => {
  const secret = 'PRIVATE_DATABASE_DETAIL';
  const repository = createPostgresRepository({ pool: { async connect() { throw new Error(secret); } } });
  const opened = await repository.open();
  assert.equal(opened.status, 'unavailable');
  assert.equal(JSON.stringify(opened).includes(secret), false);
  assert.equal((await repository.transaction(ctx(), command(), () => ok('fake-success'))).status, 'unavailable');
  assert.equal((await createPostgresRepository({ connectionString: '' }).open()).code, 'missing-database-url');
  assert.equal((await createPostgresRepository({ connectionString: 'https://user:PRIVATE_DATABASE_DETAIL@example.invalid' }).open()).code, 'invalid-database-url');
  assert.equal((await createPostgresRepository({ schema: 'public; invalid' }).open()).code, 'invalid-schema');
});

test('postgresql driver: a flush failure rolls back claim, offer and outbox without memory fallback', async () => {
  const store = createMemoryStore();
  const memory = createMemoryRepository({ store }); await memory.open(); await setup(memory); await memory.close();
  const driver = driverDouble({ state: store.state, failTable: 'notification_outbox' });
  const repository = createPostgresRepository({ pool: driver.pool });
  assert.equal((await repository.open()).status, 'ok');
  const outcome = await repository.transaction(ctx(), command(), async (tx) => {
    await tx.conditionalClaim(claimInput({ type: 'buddy-offer' }));
    await tx.insert('offers', { runId: 'run-a', offerId: 'offer-a', holdId: 'hold-a', quoteId: 'quote-a' });
    await tx.enqueueNotification({ jobId: 'job', idempotencyKey: 'job-key', inputDigest: 'digest', state: 'pending' });
    return ok({ accepted: true });
  });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(JSON.stringify(outcome).includes('PRIVATE_DATABASE_DETAIL'), false);
  for (const table of ['holds', 'claims', 'offers', 'notification_outbox']) assert.equal(driver.read().tables[table].length, 0);
  assert.equal(driver.read().tables.stock[0].version, 1);
  assert.equal(driver.queries.includes('ROLLBACK'), true);
  await repository.close();
});

test('postgresql driver: uncertain commit is reconciled with the original command id', async () => {
  const store = createMemoryStore(); const memory = createMemoryRepository({ store });
  await memory.open(); await setup(memory); await memory.close();
  const driver = driverDouble({ state: store.state, uncertainCommit: true });
  const repository = createPostgresRepository({ pool: driver.pool }); await repository.open();
  const stable = command('uncertain-commit');
  assert.equal((await repository.transaction(ctx(), stable, (tx) => tx.conditionalClaim(claimInput()))).status, 'unavailable');
  const replay = await repository.transaction(ctx(), stable, () => { throw new Error('must not repeat'); });
  assert.equal(replay.status, 'ok'); assert.equal(replay.value.hold.holdId, 'hold-a');
  assert.equal(driver.read().tables.holds.length, 1);
  await repository.close();
});


test('postgresql driver: a reset flush failure restores current run and leaves no replacement fixture rows', async () => {
  const driver = driverDouble();
  const repository = createPostgresRepository({ pool: driver.pool });
  await repository.open(); await setup(repository);
  const c = ctx();
  await repository.transaction(c, command(), (tx) => tx.compareAndSwap(ref('runs', {}, c), 1, { current: true }));
  const before = driver.read();
  driver.setFailureTable('entitlement_slots');
  const reset = await repository.resetRun(c, command(), { expectedCurrentRunId: c.runId, expectedRunVersion: 2,
    nextRun: { runId: 'flush-failed-reset', environmentId: c.environmentId, current: true, status: 'active' },
    rows: [['employees', { employeeId: 'new-person' }], ['entitlement_slots', { employeeId: 'new-person', entitlementSlotId: 'new-slot', capacity: 1 }]] });
  assert.equal(reset.status, 'unavailable');
  assert.deepEqual(driver.read(), before);
  assert.equal((await repository.currentRun(c.environmentId)).value.runId, c.runId);
  await repository.close();
});

test('postgresql driver: round trips stay constant per read and per transaction', async () => {
  const driver = driverDouble();
  const repository = createPostgresRepository({ pool: driver.pool });
  await repository.open(); await setup(repository);
  const count = async (work) => { const before = driver.queries.length; await work(); return driver.queries.length - before; };
  assert.equal(await count(() => repository.query(ctx(), 'stock')), 1);
  assert.equal(await count(() => repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))), 1);
  const bulk = await count(() => repository.transaction(ctx(), command(), async (tx) => {
    for (let i = 0; i < 50; i += 1) await tx.insert('stock', { runId: 'run-a', orderUuid: `bulk-${i}`, orderNumber: `B${i}`, state: 'available' });
    return ok('bulk');
  }));
  assert.ok(bulk <= 4, `snapshot, batched inserts per table, commit (got ${bulk})`);
  assert.equal((await repository.query(ctx(), 'stock')).value.length, 52);
  const edit = await count(() => repository.transaction(ctx(), command(), async (tx) => {
    for (const orderUuid of ['car-a', 'car-b']) await tx.compareAndSwap(ref('stock', { orderUuid }), 1, { state: 'held' });
    return ok('edit');
  }));
  assert.ok(edit <= 4, `snapshot, batched update, command record, commit (got ${edit})`);
  assert.deepEqual((await repository.query(ctx(), 'stock', { state: 'held' })).value.map((row) => row.version), [2, 2]);
  await repository.close();
});
