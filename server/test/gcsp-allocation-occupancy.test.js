import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationFixture } from './helpers/gcsp-allocation.js';
import { inputDigest, ok } from '../gcsp/repository/index.js';

const identities = ['employeeId', 'entitlementSlotId', 'renewalId', 'orderUuid'];
const contender = (n, changes = {}) => ({ employeeId: `employee-${n}`, entitlementSlotId: `slot-${n}`,
  renewalId: `renewal-${n}`, orderUuid: `car-${n}`, quote: { orderUuid: `car-${n}` }, ...changes });
const occupiedByScan = (assignments, candidate) => assignments.some((a) => a.employeeId === candidate.employeeId
  || a.entitlementSlotId === candidate.entitlementSlotId || candidate.renewalId && a.renewalId === candidate.renewalId
  || a.orderUuid === candidate.orderUuid);
const reference = (f, consumerId) => ({ table: 'event_receipts',
  key: { runId: f.context.runId, consumerId, eventId: f.event.eventId } });

// Freeze a real pending receipt, then isolate traversal from recommendation and claim policy.
async function frozenPlan(t, contenders, { legacy = false, assignments = [], savedAttempts = [], next = 0 } = {}) {
  const f = await allocationFixture({ cars: 1, claimResult: () => ({ status: 'unavailable' }) });
  t.after(async () => { await f.repository.close(); await f.policy.close(); });
  assert.equal((await f.service.allocate(f.context, f.event)).code, 'claim-pending');
  const planRef = reference(f, 'buddy-allocation'); const cursorRef = reference(f, 'buddy-allocation-cursor');
  const planRow = (await f.repository.read(f.context, planRef)).value;
  const cursorRow = (await f.repository.read(f.context, cursorRef)).value;
  planRow.outcome.value.plan.contenders = contenders;
  planRow.outcome.value.plan.evaluations = [];
  await f.write(async (tx) => {
    const plan = await tx.compareAndSwap(planRef, planRow.version, { outcome: planRow.outcome });
    if (plan.status !== 'ok') return plan;
    for (const [n, saved] of savedAttempts.entries()) {
      const stored = await tx.recordReceipt({ consumerId: 'buddy-allocation-attempt', eventId: `${f.event.eventId}:${n}`,
        eventType: f.event.eventType, inputDigest: inputDigest(saved), inputVersions: {}, state: 'completed', outcome: ok(saved) });
      if (stored.status !== 'ok') return stored;
    }
    return tx.compareAndSwap(cursorRef, cursorRow.version, { outcome: ok(legacy
      ? { next, assignments, attempts: savedAttempts.map(({ attempt }) => attempt) }
      : { next, count: savedAttempts.length }) });
  });
  const calls = [];
  const identity = { requireRole: (...args) => f.identity.requireRole(...args),
    async resolveEmployeeContext(_, employeeId) { return ok({ employeeId }); } };
  const run = ({ claimResult = () => ok({ claimed: true }), ...overrides } = {}) => f.create({ identity,
    claim: { async tryClaim(_, input) { calls.push(input); return claimResult(input); } }, ...overrides }).allocate(f.context, f.event);
  return { ...f, calls, run };
}

for (const legacy of [false, true]) {
  test(`occupancy matches the scan oracle after ${legacy ? 'inline cursor' : 'attempt row'} restoration and failed claims`, async (t) => {
    const contenders = [contender(0), contender(1),
      contender(2, { employeeId: 'employee-0' }), contender(3, { entitlementSlotId: 'slot-0' }),
      contender(4, { renewalId: 'renewal-0' }), contender(5, { orderUuid: 'car-0' }),
      contender(1, { orderUuid: 'stale-car' }), contender(1, { orderUuid: 'conflict-car' }),
      contender(1, { orderUuid: 'winning-car' }), contender(9, { employeeId: 'employee-1' }),
      contender(10, { entitlementSlotId: 'slot-1' }), contender(11, { renewalId: 'renewal-1' }),
      contender(12, { orderUuid: 'winning-car' }), contender(13, { orderUuid: 'stale-car' }),
      contender(14, { orderUuid: 'conflict-car' })];
    const savedAttempts = [ok({ claimed: true }), { status: 'conflict' }].map((outcome, index) => ({ index,
      attempt: { employeeId: contenders[index].employeeId, orderUuid: contenders[index].orderUuid,
        operationId: `restored-${index}`, outcome } }));
    const restored = { ...contenders[0], operationId: 'restored-0', claim: { claimed: true } };
    const f = await frozenPlan(t, contenders, { legacy, assignments: [restored], savedAttempts, next: 2 });
    const status = (candidate) => candidate.employeeId === 'employee-1'
      ? candidate.orderUuid === 'stale-car' ? 'stale-version' : candidate.orderUuid === 'conflict-car' ? 'conflict' : 'ok' : 'ok';
    const expectedAssignments = [restored]; const expectedCalls = [];
    for (const candidate of contenders.slice(2)) {
      if (occupiedByScan(expectedAssignments, candidate)) continue;
      expectedCalls.push(candidate);
      if (status(candidate) === 'ok') expectedAssignments.push(candidate);
    }
    const out = await f.run({ claimResult: (candidate) => status(candidate) === 'ok' ? ok({ claimed: true }) : { status: status(candidate) } });
    assert.equal(out.status, 'ok', JSON.stringify(out));
    const keys = (rows) => rows.map((row) => identities.map((key) => row[key]));
    assert.deepEqual(keys(f.calls), keys(expectedCalls));
    assert.deepEqual(keys(out.value.assignments), keys(expectedAssignments));
    assert.equal(out.value.attempts.length, savedAttempts.length + expectedCalls.length);
    for (const key of identities) assert.equal(new Set(out.value.assignments.map((a) => a[key])).size, out.value.assignments.length, key);
    const calls = f.calls.length;
    assert.deepEqual(await f.run(), out, 'completed replay retains the exact outcome');
    assert.equal(f.calls.length, calls, 'completed replay makes no claim');
  });
}

test('uncertain claim retries the same operation before later fallback and does not occupy identities', async (t) => {
  const contenders = [contender(0), contender(0, { orderUuid: 'fallback-car' }), contender(1, { orderUuid: 'car-0' })];
  const f = await frozenPlan(t, contenders);
  assert.equal((await f.run({ claimResult: () => ({ status: 'unavailable' }) })).code, 'claim-pending');
  const uncertain = f.calls[0];
  const out = await f.run({ claimResult: (candidate) => candidate.employeeId === 'employee-0' && candidate.orderUuid === 'car-0'
    ? { status: 'conflict' } : ok({ claimed: true }) });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual(f.calls[1], uncertain, 'retry preserves operation, quote and exact identities');
  assert.deepEqual(out.value.assignments.map((a) => [a.employeeId, a.orderUuid]),
    [['employee-0', 'fallback-car'], ['employee-1', 'car-0']]);
});

test('identity membership preserves empty, missing, null and typed values and the truthy renewal guard', async (t) => {
  const restored = [contender(0, { employeeId: '', entitlementSlotId: '', renewalId: '', orderUuid: '' }),
    contender(1, { renewalId: null }), contender(2, { entitlementSlotId: null, renewalId: 0 }),
    contender(3, { renewalId: false }), contender(4, { entitlementSlotId: 7, renewalId: 'shared-renewal' })];
  delete restored[1].entitlementSlotId;
  const missingSlot = contender(10); delete missingSlot.entitlementSlotId;
  const contenders = [contender(5, { employeeId: '' }), contender(6, { entitlementSlotId: '' }),
    contender(7, { orderUuid: '' }), missingSlot, contender(11, { entitlementSlotId: null }),
    contender(12, { entitlementSlotId: '7' }), contender(13, { renewalId: '' }),
    contender(14, { renewalId: null }), contender(15, { renewalId: 0 }), contender(16, { renewalId: false }),
    contender(17, { renewalId: 'shared-renewal' })];
  const expected = [...restored]; const expectedCalls = [];
  for (const candidate of contenders) {
    if (!occupiedByScan(expected, candidate)) { expected.push(candidate); expectedCalls.push(candidate); }
  }
  const f = await frozenPlan(t, contenders, { legacy: true, assignments: restored });
  const out = await f.run();
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual(f.calls.map((a) => a.employeeId), expectedCalls.map((a) => a.employeeId));
  assert.deepEqual(out.value.assignments.map((a) => a.employeeId), expected.map((a) => a.employeeId));
});

test('NaN identities retain strict inequality when reading a legacy cursor', async (t) => {
  const f = await frozenPlan(t, [contender(1)], { legacy: true, assignments: [contender(0)] });
  for (const key of identities) {
    const repository = { ...f.repository, async read(context, ref) {
      const found = await f.repository.read(context, ref);
      if (found.status === 'ok' && ref.key.consumerId === 'buddy-allocation') found.value.outcome.value.plan.contenders[0][key] = NaN;
      if (found.status === 'ok' && ref.key.consumerId === 'buddy-allocation-cursor') found.value.outcome.value.assignments[0][key] = NaN;
      return found;
    } };
    // Native receipts reject NaN; probe the detached read before another write/digest can reject it.
    const identity = { requireRole: (...args) => f.identity.requireRole(...args),
      async resolveEmployeeContext() { return { status: 'unavailable', code: 'strict-equality-probe' }; } };
    assert.equal((await f.run({ repository, identity })).code, 'strict-equality-probe', key);
  }
});

test('restored occupancy avoids repeated identity scans across skipped contenders', async (t) => {
  const assignments = Array.from({ length: 8 }, (_, n) => contender(n));
  const contenders = Array.from({ length: 40 }, (_, n) => contender(100 + n, { employeeId: 'employee-7' }));
  const f = await frozenPlan(t, contenders, { legacy: true, assignments });
  let reads = 0;
  const repository = { ...f.repository, async read(context, ref) {
    const found = await f.repository.read(context, ref);
    if (ref.key.consumerId === 'buddy-allocation-cursor' && found.status === 'ok') {
      for (const assignment of found.value.outcome.value.assignments) for (const key of identities) {
        const value = assignment[key];
        Object.defineProperty(assignment, key, { enumerable: true, get() { reads += 1; return value; } });
      }
    }
    return found;
  } };
  const out = await f.run({ repository, claimResult: () => ({ status: 'conflict' }) });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(f.calls.length, 0, 'all contenders share the final restored employee');
  // Persistence digests/clones also read identities, but their fixed cost is below a traversal scan.
  assert.ok(reads < assignments.length * contenders.length, `identity reads: ${reads}`);
});
