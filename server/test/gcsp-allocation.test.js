import test from 'node:test';
import assert from 'node:assert/strict';
import { ok } from '../gcsp/repository/index.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';

test('three employees compete deterministically for scarce exact cars, one each', async () => {
  const f = await allocationFixture(); const reversed = await allocationFixture({ reverse: true });
  const out = await f.service.allocate(f.context, f.event);
  assert.equal(out.status, 'ok', JSON.stringify(out)); assert.equal(out.value.assignments.length, 2);
  assert.equal(new Set(out.value.assignments.map((a) => a.employeeId)).size, 2);
  assert.equal(new Set(out.value.assignments.map((a) => a.orderUuid)).size, 2);
  assert.deepEqual(out.value.assignments, (await reversed.service.allocate(reversed.context, reversed.event)).value.assignments);
  assert.equal(out.value.assignments[0].employeeId, f.employees[0].employeeId);
  assert.equal(out.value.assignments[0].quote.snapshot.vin, undefined);
  assert.ok(out.value.assignments.every((a) => a.quote.terms.kind === 'employee-scheme'));
});

test('changing the canonical tie-break key changes the winner', async () => {
  const renewal = await allocationFixture({ cars: 1 });
  const fit = await allocationFixture({ cars: 1, rule: 'fitThenRenewalDueThenSeededLottery' });
  const a = await renewal.service.allocate(renewal.context, renewal.event); const b = await fit.service.allocate(fit.context, fit.event);
  assert.equal(a.status, 'ok', JSON.stringify(a)); assert.equal(b.status, 'ok', JSON.stringify(b));
  assert.notEqual(a.value.assignments[0].employeeId, b.value.assignments[0].employeeId);
  assert.equal(b.value.assumptions[0].value, 'fitThenRenewalDueThenSeededLottery');
});

test('claim conflict and stale version fall through to the next appropriate candidate', async () => {
  for (const status of ['conflict', 'stale-version']) {
    const f = await allocationFixture({ cars: 4, claimResult: (employee, input, n) => n === 1 ? { status } : ok({ claimId: input.operationId }) });
    const out = await f.service.allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.equal(f.calls[0].employee.employeeId, f.calls[1].employee.employeeId);
    assert.notEqual(f.calls[0].input.orderUuid, f.calls[1].input.orderUuid);
    assert.equal(out.value.assignments.length, 3);
    assert.equal(out.value.evaluations[0].decisions.length, 4, 'complete pool survives display cap');
  }
});

test('replaying an event after service recreation returns original outcome without another claim', async () => {
  const f = await allocationFixture(); const out = await f.service.allocate(f.context, f.event); const calls = f.calls.length;
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual(await f.create().allocate(f.context, f.event), out); assert.equal(f.calls.length, calls);
  assert.equal((await f.service.allocate(f.context, { ...f.event, stockVersion: 'changed' })).status, 'conflict');
  assert.equal((await f.repository.query(f.context, 'holds')).value.length, 0, 'allocation writes no holds');
  assert.equal((await f.repository.query(f.context, 'offers')).value.length, 0);
  assert.equal((await f.repository.query(f.context, 'notification_outbox')).value.length, 0);
});

test('unchanged decline excludes exact car; expiry has no dislike or priority', async () => {
  for (const decision of ['decline', 'expired']) {
    const f = await allocationFixture({ cars: 1 }); const employee = decision === 'decline' ? f.employees[0] : f.employees[2];
    await f.write(async (tx) => {
      const quote = await tx.insert('quotes', { runId: f.context.runId, quoteId: 'old-quote', employeeId: employee.employeeId }); if (quote.status !== 'ok') return quote;
      const hold = await tx.insert('holds', { runId: f.context.runId, holdId: 'old-hold', state: 'expired', orderUuid: f.stock().orderUuid,
        employeeId: employee.employeeId, entitlementSlotId: employee.entitlementSlotId, quoteId: 'old-quote' }); if (hold.status !== 'ok') return hold;
      const offer = await tx.insert('offers', { runId: f.context.runId, offerId: 'old-offer', holdId: 'old-hold', quoteId: 'old-quote',
        employeeId: employee.employeeId, orderUuid: f.stock().orderUuid, state: decision }); if (offer.status !== 'ok') return offer;
      return tx.insert('decisions', { runId: f.context.runId, decisionId: 'old-decision', commandId: 'old-decision',
        offerId: 'old-offer', employeeId: employee.employeeId, decision, versions: { brief: 1 } });
    });
    const out = await f.service.allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.equal(out.value.assignments[0].employeeId, decision === 'decline' ? f.employees[1].employeeId : f.employees[0].employeeId);
    if (decision === 'decline') assert.ok(out.value.evaluations.find((e) => e.employeeId === employee.employeeId)
      .decisions[0].blockers.some((b) => b.code === 'declined-unchanged'));
  }
});

test('recorded run preserves stock, brief, policy, quote, reason and clock versions', async () => {
  const f = await allocationFixture(); const out = await f.service.allocate(f.context, f.event);
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.inputVersions.briefs.length, 3); assert.equal(out.value.inputVersions.stock.length, 2);
  assert.equal(out.value.policyVersion, f.context.policyVersion); assert.equal(out.value.inputVersions.clock, 'clock-v1');
  const a = out.value.assignments[0]; assert.equal(a.expectedVersions.brief, 1); assert.equal(a.quote.versions.policy, f.context.policyVersion);
  assert.ok(a.reasons.some((r) => r.code === 'allocation-policy'));
  const row = (await f.repository.query(f.context, 'event_receipts', { consumerId: 'buddy-allocation' })).value[0];
  assert.equal(row.state, 'completed'); const { evaluations, ...rest } = out.value;
  // FUCQ-209: the stored receipt references each employee's evaluation row instead of copying it.
  assert.deepEqual(row.outcome, { ...out, value: { ...rest, evaluationRefs: { consumerId: 'buddy-allocation-evaluation',
    employeeIds: evaluations.map((e) => e.employeeId) } } });
});

test('uncertain claim retains pending plan and retries the same operation and quote', async () => {
  let first = true;
  const f = await allocationFixture({ cars: 1, claimResult: (_, input) => { if (first) { first = false; return { status: 'unavailable' }; } return ok({ claimId: input.operationId }); } });
  assert.equal((await f.service.allocate(f.context, f.event)).code, 'claim-pending');
  const out = await f.create().allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(f.calls[0].input.operationId, f.calls[1].input.operationId); assert.deepEqual(f.calls[0].input.quote, f.calls[1].input.quote);
});

test('same-event retry reads repaired source after a rejected pre-plan snapshot', async () => {
  const f = await allocationFixture({ cars: 1 }); const employee = f.employees[0];
  const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: employee.employeeId } };
  const original = (await f.repository.read(f.context, ref)).value;
  const incomplete = structuredClone(original.contract);
  delete incomplete.manualContext.contracts[0].contractEndDate;
  await f.write((tx) => tx.compareAndSwap(ref, original.version, { contract: incomplete }));
  const rejected = await f.service.allocate(f.context, f.event);
  assert.equal(rejected.code, 'renewal-deadline-unavailable'); assert.equal(f.calls.length, 0);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { consumerId: 'buddy-allocation' })).value.length, 0);
  const current = (await f.repository.read(f.context, ref)).value;
  await f.write((tx) => tx.compareAndSwap(ref, current.version, { contract: original.contract }));
  const retried = await f.create().allocate(f.context, f.event);
  assert.equal(retried.status, 'ok', JSON.stringify(retried));
  assert.equal(retried.value.assignments[0].employeeId, employee.employeeId);
  assert.equal(retried.value.assignments[0].expectedVersions.employee, current.version + 1);
});

test('absent dependency, forged controller and unsupported policy fail closed', async () => {
  const f = await allocationFixture();
  assert.equal((await f.create({ claim: null }).allocate(f.context, f.event)).code, 'not-configured');
  assert.equal((await f.service.allocate({ ...f.context }, f.event)).status, 'forbidden');
  const bad = await allocationFixture({ rule: 'unknown-rule' });
  assert.equal((await bad.service.allocate(bad.context, bad.event)).code, 'policy-invalid'); assert.equal(bad.calls.length, 0);
});

test('pause and consent are current; search-only consent evaluates without claiming', async () => {
  const f = await allocationFixture({ cars: 4 });
  await f.write(async (tx) => {
    for (const [i, employee] of f.employees.entries()) {
      const current = await tx.get({ table: 'briefs', key: { runId: f.context.runId, employeeId: employee.employeeId, briefVersion: 1 } });
      const saved = await tx.insert('briefs', { ...current.value, briefVersion: 2, buddy: { ...current.value.buddy,
        permissionVersion: 2, ...(i === 0 ? { paused: true } : i === 1 ? { holdConsent: false } : { searchConsent: false }) } });
      if (saved.status !== 'ok') return saved;
    }
    return ok({ changed: true });
  });
  const out = await f.service.allocate(f.context, { ...f.event, eventType: 'brief-changed' });
  assert.equal(out.status, 'ok', JSON.stringify(out)); assert.equal(out.value.state, 'no-assignment');
  assert.equal(out.value.evaluations.length, 1); assert.equal(out.value.evaluations[0].employeeId, f.employees[1].employeeId);
  assert.equal(out.value.evaluations[0].decisions.length, 4); assert.equal(f.calls.length, 0);
});

test('relevant confirmed preference change reopens decline; provenance-only version does not', async () => {
  for (const relevant of [false, true]) {
    const f = await allocationFixture({ cars: 1 }); const employee = f.employees[0];
    await f.write(async (tx) => {
      const quote = await tx.insert('quotes', { runId: f.context.runId, quoteId: 'q', employeeId: employee.employeeId }); if (quote.status !== 'ok') return quote;
      const hold = await tx.insert('holds', { runId: f.context.runId, holdId: 'h', state: 'released', orderUuid: f.stock().orderUuid,
        employeeId: employee.employeeId, entitlementSlotId: employee.entitlementSlotId, quoteId: 'q' }); if (hold.status !== 'ok') return hold;
      const offer = await tx.insert('offers', { runId: f.context.runId, offerId: 'o', holdId: 'h', quoteId: 'q',
        employeeId: employee.employeeId, orderUuid: f.stock().orderUuid, state: 'declined' }); if (offer.status !== 'ok') return offer;
      const decision = await tx.insert('decisions', { runId: f.context.runId, decisionId: 'd', commandId: 'd',
        offerId: 'o', employeeId: employee.employeeId, decision: 'decline', versions: { brief: 1 } }); if (decision.status !== 'ok') return decision;
      const current = await tx.get({ table: 'briefs', key: { runId: f.context.runId, employeeId: employee.employeeId, briefVersion: 1 } });
      return tx.insert('briefs', { ...current.value, briefVersion: 2, preferences: { body: { ...current.value.preferences.body,
        source: 'new-provenance', ...(relevant ? { value: 'estate' } : {}) } } });
    });
    const out = await f.service.allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.equal(out.value.assignments[0].employeeId === employee.employeeId, relevant);
  }
});

test('already allocated entitlement is excluded even when no hold remains active', async () => {
  const f = await allocationFixture({ cars: 4 }); const employee = f.employees[0];
  await f.write(async (tx) => {
    const quote = await tx.insert('quotes', { runId: f.context.runId, quoteId: 'allocated-quote', employeeId: employee.employeeId }); if (quote.status !== 'ok') return quote;
    return tx.insert('holds', { runId: f.context.runId, holdId: 'allocated-hold', state: 'allocated', orderUuid: f.stock().orderUuid,
      employeeId: employee.employeeId, entitlementSlotId: employee.entitlementSlotId, renewalId: `renewal:${employee.employeeId}`, quoteId: 'allocated-quote' });
  });
  const out = await f.service.allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.assignments.length, 2); assert.ok(out.value.assignments.every((a) => a.employeeId !== employee.employeeId && a.orderUuid !== f.stock().orderUuid));
});

test('missing exact availability evidence stays unsuitable and empty stock is a completed no-assignment', async () => {
  const empty = await allocationFixture({ cars: 0 }); const none = await empty.service.allocate(empty.context, empty.event);
  assert.equal(none.status, 'ok', JSON.stringify(none)); assert.equal(none.value.state, 'no-assignment'); assert.equal(none.value.evaluations.length, 3);
  const unknown = await allocationFixture({ cars: 1 });
  await unknown.write((tx) => tx.compareAndSwap({ table: 'stock', key: { runId: unknown.context.runId, orderUuid: unknown.stock().orderUuid } }, 1,
    { release: { releasedAt: '2026-11-05T12:00:00.000Z' } }));
  const out = await unknown.service.allocate(unknown.context, unknown.event); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.state, 'no-assignment'); assert.ok(out.value.evaluations.every((e) => e.decisions[0].gateStatus === 'needs-confirmation'));
  assert.equal(unknown.calls.length, 0);
});

test('FUCQ-205: the plan is written once and progress only per claim attempt, not per contender', async () => {
  const f = await allocationFixture({ cars: 12 });
  const ids = [];
  const repository = { ...f.repository, transaction: (context, command, work) => { ids.push(command.commandId); return f.repository.transaction(context, command, work); } };
  const out = await f.create({ repository }).allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
  const contenders = out.value.evaluations.reduce((n, e) => n + e.decisions.filter((d) => d.gateStatus === 'eligible').length, 0);
  assert.ok(contenders >= 30, `contenders ${contenders}`);
  assert.equal(out.value.attempts.length, 3);
  const plan = (await f.repository.read(f.context, { table: 'event_receipts', key: { runId: f.context.runId, consumerId: 'buddy-allocation', eventId: f.event.eventId } })).value;
  assert.equal(plan.version, 2, 'plan receipt: one pending write and one completion');
  assert.ok(ids.filter((id) => id.startsWith('allocation:')).length <= 4 + out.value.attempts.length, ids.join(','));
});

test('FUCQ-209: no single receipt holds every participant\'s evaluation or quote; each slice is its own row', async () => {
  const f = await allocationFixture({ cars: 12 });
  const size = (value) => JSON.stringify(value).length; let pending = 0;
  const read = () => f.repository.read(f.context, { table: 'event_receipts', key: { runId: f.context.runId, consumerId: 'buddy-allocation', eventId: f.event.eventId } });
  // The claim port runs mid-allocation, so it sees the pending plan as persisted.
  const claim = { async tryClaim(employee, input) { pending = Math.max(pending, size((await read()).value)); return ok({ claimId: input.operationId }); } };
  const out = await f.create({ claim }).allocate(f.context, f.event); assert.equal(out.status, 'ok', JSON.stringify(out));
  const all = size(out.value.evaluations); assert.ok(out.value.evaluations.length >= 3);
  assert.ok(pending > 0 && pending < all, `pending plan ${pending} vs evaluations ${all}`);
  assert.ok(size((await read()).value) < all, 'completed receipt carries references, not every slice');
  for (const evaluation of out.value.evaluations) {
    const slice = (await f.repository.read(f.context, { table: 'event_receipts', key: { runId: f.context.runId,
      consumerId: 'buddy-allocation-evaluation', eventId: `${f.event.eventId}:${evaluation.employeeId}` } })).value;
    assert.deepEqual(slice.outcome.value.evaluation, evaluation);
  }
  assert.ok(out.value.assignments.every((a) => a.quote?.orderUuid === a.orderUuid), 'assignments keep their quote');
  assert.deepEqual(await f.create({ claim }).allocate(f.context, f.event), out, 'replay returns the same outcome');
});
