import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationFixture } from './helpers/gcsp-allocation.js';
import { createComparisonRepository, createComparisonStore } from '../gcsp/comparison/private-repository.js';
import { expandEvaluation } from '../gcsp/allocation/evaluation-rows.js';
import { ok } from '../gcsp/repository/core.js';

const privateProvider = { createRepository: createComparisonRepository, createStore: createComparisonStore };
const reference = (f, consumerId = 'buddy-allocation', eventId = f.event.eventId) => ({ table: 'event_receipts',
  key: { runId: f.context.runId, consumerId, eventId } });
const close = (t, f) => t.after(async () => { await f.repository.close(); await f.policy.close(); });

test('allocator consumes the private plan view and quote projection without a full pending detached read', async (t) => {
  const f = await allocationFixture(privateProvider); close(t, f);
  const repository = { ...f.repository, async read(context, ref) {
    const pending = f.store.state.tables.event_receipts.some((row) => row.consumerId === 'buddy-allocation' && row.state === 'pending');
    if (pending && ref.table === 'event_receipts' && ['buddy-allocation', 'buddy-allocation-evaluation'].includes(ref.key.consumerId)) {
      assert.fail('pending allocation reads must use the private ownership/projection capability');
    }
    return f.repository.read(context, ref);
  } };
  const outcome = await f.create({ repository }).allocate(f.context, f.event);
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
  assert.equal(outcome.value.assignments.length, 2);
  assert.equal(outcome.value.assignments[0].employeeId, f.employees[0].employeeId);
  assert.equal(outcome.value.evaluations.length, 3, 'completed hydration still returns every evaluation');
  assert.equal(f.calls.length, 2);
  const original = structuredClone(outcome);
  outcome.value.assignments[0].quote.orderUuid = 'caller-change';
  assert.deepEqual(await f.create({ repository }).allocate(f.context, f.event), original, 'completed replay remains mutable and caller isolated');
});

for (const form of ['modern', 'inline-plan', 'quoted-slice', 'inline-cursor']) {
  test(`private and ordinary allocation preserve ${form} pending receipt replay`, async (t) => {
    const straight = await allocationFixture({ cars: 1 }); close(t, straight);
    const expected = await straight.service.allocate(straight.context, straight.event);
    assert.equal(expected.status, 'ok'); assert.equal(expected.value.assignments.length, 1);
    for (const provider of [{}, privateProvider]) {
      let first = true;
      const f = await allocationFixture({ ...provider, cars: 1, claimResult: (_, input) => {
        if (first) { first = false; return { status: 'unavailable' }; }
        return ok({ claimId: input.operationId });
      } }); close(t, f);
      assert.equal((await f.service.allocate(f.context, f.event)).code, 'claim-pending');
      const read = await f.repository.read(f.context, reference(f));
      if (form === 'inline-plan') {
        const plan = read.value.outcome.value.plan;
        plan.contenders[0].quote = structuredClone(f.calls[0].input.quote);
        const slices = (await f.repository.query(f.context, 'event_receipts', { consumerId: 'buddy-allocation-evaluation' })).value;
        plan.evaluations = slices.map((row) => expandEvaluation(row.outcome.value.evaluation));
        delete plan.pool; delete plan.evaluatedEmployees;
        await f.write((tx) => tx.compareAndSwap(reference(f), read.value.version, { outcome: read.value.outcome }));
        const tables = f.store.state.tables;
        f.store.state = { ...f.store.state, tables: { ...tables,
          event_receipts: tables.event_receipts.filter((row) => row.consumerId !== 'buddy-allocation-cursor') } };
      } else if (form === 'quoted-slice') {
        const employeeId = f.calls[0].input.employeeId;
        const ref = reference(f, 'buddy-allocation-evaluation', `${f.event.eventId}:${employeeId}`);
        const slice = (await f.repository.read(f.context, ref)).value;
        delete slice.outcome.value.quoteInputs;
        slice.outcome.value.quotes = { [f.calls[0].input.orderUuid]: structuredClone(f.calls[0].input.quote) };
        await f.write((tx) => tx.compareAndSwap(ref, slice.version, { outcome: slice.outcome }));
      } else if (form === 'inline-cursor') {
        const ref = reference(f, 'buddy-allocation-cursor'); const cursor = (await f.repository.read(f.context, ref)).value;
        await f.write((tx) => tx.compareAndSwap(ref, cursor.version, { outcome: ok({ next: 0, attempts: [], assignments: [] }) }));
      }
      const resumed = await f.create().allocate(f.context, f.event);
      assert.equal(resumed.status, 'ok', JSON.stringify(resumed));
      assert.deepEqual(resumed, expected);
      assert.equal(f.calls[0].input.operationId, f.calls[1].input.operationId);
      assert.deepEqual(f.calls[0].input.quote, f.calls[1].input.quote);
      const calls = f.calls.length;
      assert.deepEqual(await f.create().allocate(f.context, f.event), expected);
      assert.equal(f.calls.length, calls);
    }
  });
}
