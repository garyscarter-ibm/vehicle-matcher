import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allocationFixture } from './helpers/gcsp-allocation.js';
import { ok } from '../gcsp/repository/index.js';
import { createVehicleSnapshot } from '../vehicles/index.js';
import { fact, preference } from './helpers/employee-recommendation.js';

const allocationUrl = new URL('../gcsp/allocation/index.js', import.meta.url);
const source = await readFile(allocationUrl, 'utf8');
// Compare the unchanged allocator with its former gallery calculation, without copying fleet or transaction rules.
assert.equal((source.match(/createAllocationRecommendationEvaluator/g) ?? []).length, 2);
assert.equal((source.match(/\[projection\]\(employeeContext, inputs.request\)/g) ?? []).length, 1);
const gallerySource = source.replaceAll('createAllocationRecommendationEvaluator', 'createEmployeeRecommendationService')
  .replace('[projection](employeeContext, inputs.request)', '.recommend(employeeContext, inputs.request)')
  .replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, path) => `from ${quote}${new URL(path, allocationUrl).href}${quote}`);
const { createAllocationService: createGalleryAllocationService } = await import(`data:text/javascript;base64,${Buffer.from(gallerySource).toString('base64')}`);
const good = (outcome) => { assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
async function fixture(t, options) {
  const f = await allocationFixture(options);
  t.after(async () => { await f.repository.close(); await f.policy.close(); });
  return f;
}
const galleryService = (f, overrides = {}) => createGalleryAllocationService({ repository: f.repository, policy: f.policy,
  clock: f.clock, identity: f.identity, claim: { tryClaim: async (employee, input) => {
    f.calls.push({ employee, input }); return ok({ claimId: input.operationId });
  } }, ...overrides });
const receipt = async (f, consumerId, eventId = f.event.eventId) => good(await f.repository.read(f.context,
  { table: 'event_receipts', key: { runId: f.context.runId, consumerId, eventId } }));
async function changeRow(f, table, key, patch) {
  const ref = { table, key: { runId: f.context.runId, ...key } };
  const row = good(await f.repository.read(f.context, ref));
  await f.write((tx) => tx.compareAndSwap(ref, row.version, patch(row)));
}
async function operations(work) {
  const freeze = Object.freeze; const sort = Array.prototype.sort; const seen = new WeakSet();
  const counts = { termsGraphs: 0, gallerySorts: 0, contenderSorts: 0 };
  Object.freeze = (value) => {
    if (value?.kind === 'employee-scheme' && value.termsVersion && !seen.has(value)
      && new Error().stack.includes('at createEmployeeTerms')) { seen.add(value); counts.termsGraphs += 1; }
    return freeze(value);
  };
  Array.prototype.sort = function (...args) {
    if (this.length && this.every((row) => row?.orderUuid && row.gateStatus)) counts.gallerySorts += 1;
    if (this.length && this.every((row) => row?.orderUuid && row.employeeId && row.renewalDue)) counts.contenderSorts += 1;
    return sort.apply(this, args);
  };
  try { return { outcome: await work(), counts }; }
  finally { Object.freeze = freeze; Array.prototype.sort = sort; }
}

test('same employee/car allocation decisions, quotes and global order equal the gallery baseline with less construction', async (t) => {
  for (const rule of ['renewalDueThenFitThenSeededLottery', 'fitThenRenewalDueThenSeededLottery']) {
    const compact = await fixture(t, { cars: 8, rule }); const gallery = await fixture(t, { cars: 8, rule, reverse: true });
    const actual = await operations(() => compact.service.allocate(compact.context, compact.event));
    const expected = await operations(() => galleryService(gallery).allocate(gallery.context, gallery.event));
    good(actual.outcome); good(expected.outcome);
    assert.deepEqual(actual.outcome, expected.outcome);
    assert.deepEqual(compact.calls.map((row) => row.input), gallery.calls.map((row) => row.input));
    assert.equal(actual.outcome.value.evaluations.length, 3);
    assert.ok(actual.outcome.value.evaluations.every((row) => row.decisions.length === 8));
    assert.deepEqual(actual.counts, { termsGraphs: 3, gallerySorts: 0, contenderSorts: 1 });
    assert.deepEqual(expected.counts, { termsGraphs: 27, gallerySorts: 12, contenderSorts: 1 });
    t.diagnostic(JSON.stringify({ employees: 3, cars: 8, pairs: 24, rule, compact: actual.counts, gallery: expected.counts }));
  }
});

test('a failed first four claims still reaches a fallback beyond the display cap', async (t) => {
  const f = await fixture(t, { cars: 6, claimResult: (_, input, n) => n <= 4 ? { status: n % 2 ? 'conflict' : 'stale-version' } : ok({ claimId: input.operationId }) });
  const out = good(await f.service.allocate(f.context, f.event));
  assert.equal(out.assignments.length, 3); assert.equal(out.attempts.length, 7);
  assert.equal(new Set(f.calls.slice(0, 5).map((row) => row.input.employeeId)).size, 1);
  assert.equal(new Set(f.calls.slice(0, 5).map((row) => row.input.orderUuid)).size, 5);
  assert.deepEqual(out.attempts.slice(0, 4).map((row) => row.outcome.status), ['conflict', 'stale-version', 'conflict', 'stale-version']);
  assert.equal(out.assignments[0].orderUuid, out.attempts[4].orderUuid);
  assert.ok(out.evaluations.every((row) => row.decisions.length === 6));
  assert.ok(out.assignments.every((row) => row.quote.terms && row.quote.snapshot && row.quote.versions.terms && row.quote.reasons.length));
});

test('pending resume rebuilds both saved-success and uncertain quotes from frozen planning inputs', async (t) => {
  const f = await fixture(t, { cars: 4, claimResult: (_, input, n) => n === 2 ? { status: 'unavailable' } : ok({ claimId: input.operationId }) });
  const initial = await f.service.allocate(f.context, f.event);
  assert.equal(initial.code, 'claim-pending'); assert.equal(f.calls.length, 2);
  const frozen = structuredClone(f.calls.map((row) => row.input));
  const plan = (await receipt(f, 'buddy-allocation')).outcome.value.plan;
  assert.equal(plan.contenders.length, 12);
  const cursor = await receipt(f, 'buddy-allocation-cursor'); assert.equal(cursor.outcome.value.count, 1);
  for (const employee of f.employees) {
    await changeRow(f, 'employees', { employeeId: employee.employeeId }, (row) => {
      const contract = structuredClone(row.contract); contract.manualContext.employeeFacts.driverEligible = fact(false);
      return { contract };
    });
    const original = good(await f.repository.read(f.context, { table: 'briefs', key: { runId: f.context.runId, employeeId: employee.employeeId, briefVersion: 1 } }));
    await f.write((tx) => tx.insert('briefs', { ...original, briefVersion: 2, preferences: { body: preference('suv') } }));
  }
  for (const row of good(await f.repository.query(f.context, 'stock'))) {
    await changeRow(f, 'stock', { orderUuid: row.orderUuid }, (current) => ({ facts: createVehicleSnapshot({ ...current.facts,
      snapshotVersion: 'changed-after-plan', facts: { ...current.facts.facts, seats: fact(2, 'count') } }) }));
  }
  let clockReads = 0; const reads = []; const policy = { withReadScope: (work) => f.policy.withReadScope(work) };
  for (const key of ['getAllowance', 'getAssumption', 'getEligibility', 'getPointsCost']) policy[key] = (...args) => {
    reads.push(args.at(-1)); return f.policy[key](...args);
  };
  const resumed = good(await f.create({ policy, clock: { now() { clockReads += 1; throw Error('live clock must not be read'); } } }).allocate(f.context, f.event));
  assert.equal(clockReads, 0); assert.ok(reads.length > 0);
  assert.ok(reads.every((read) => read.asOf === plan.evaluatedAt && read.policyVersion === plan.policyVersion));
  assert.deepEqual(f.calls[2].input, frozen[1]);
  assert.deepEqual(resumed.assignments.find((row) => row.employeeId === frozen[0].employeeId).quote, frozen[0].quote);
  assert.ok(resumed.assignments.every((row) => row.quote.snapshot.snapshotVersion === 'snapshot-v1'
    && row.quote.versions.brief === 1 && row.quote.versions.clock === 'clock-v1' && row.quote.versions.policy === plan.policyVersion));
  assert.equal(resumed.assignments.length, 3); assert.equal(resumed.attempts.length, 3);
  const calls = f.calls.length;
  assert.deepEqual(await f.create().allocate(f.context, f.event), { status: 'ok', value: resumed, contractVersion: '1.0.0' });
  assert.equal(f.calls.length, calls);
});

for (const legacy of ['embedded-quote', 'slice-quotes']) test(`pending ${legacy} receipts remain usable without frozen input reconstruction`, async (t) => {
  const f = await fixture(t, { cars: 1, claimResult: (_, input, n) => n === 1 ? { status: 'unavailable' } : ok({ claimId: input.operationId }) });
  assert.equal((await f.service.allocate(f.context, f.event)).code, 'claim-pending');
  const candidate = structuredClone(f.calls[0].input);
  await changeRow(f, 'event_receipts', { consumerId: 'buddy-allocation', eventId: f.event.eventId }, (row) => {
    const outcome = structuredClone(row.outcome); outcome.value.plan.pool = [];
    if (legacy === 'embedded-quote') outcome.value.plan.contenders[0].quote = candidate.quote;
    return { outcome };
  });
  await changeRow(f, 'event_receipts', { consumerId: 'buddy-allocation-evaluation', eventId: `${f.event.eventId}:${candidate.employeeId}` }, (row) => {
    const outcome = structuredClone(row.outcome); outcome.value.quoteInputs = null;
    if (legacy === 'slice-quotes') outcome.value.quotes = { [candidate.orderUuid]: candidate.quote };
    return { outcome };
  });
  const out = good(await f.create().allocate(f.context, f.event));
  assert.equal(out.assignments.length, 1); assert.deepEqual(out.assignments[0].quote, candidate.quote);
  assert.deepEqual(f.calls[1].input.quote, candidate.quote);
});

test('unknown and blocked candidates preserve gallery evaluation receipts and no-match behavior', async (t) => {
  for (const noMatch of [false, true]) {
    const compact = await fixture(t, { cars: 4 }); const gallery = await fixture(t, { cars: 4 });
    for (const f of [compact, gallery]) {
      for (const [index, row] of good(await f.repository.query(f.context, 'stock')).entries()) {
        if (!noMatch && index > 1) continue;
        await changeRow(f, 'stock', { orderUuid: row.orderUuid }, (current) => ({ facts: createVehicleSnapshot({ ...current.facts,
          facts: { ...current.facts.facts, seats: fact(index % 2 ? 2 : null, 'count') } }) }));
      }
    }
    const actual = await compact.service.allocate(compact.context, compact.event);
    const expected = await galleryService(gallery).allocate(gallery.context, gallery.event);
    assert.deepEqual(actual, expected); good(actual);
    assert.equal(actual.value.state, noMatch ? 'no-assignment' : 'allocated');
    for (const evaluation of actual.value.evaluations) {
      assert.equal(evaluation.decisions[0].gateStatus, 'needs-confirmation');
      assert.equal(evaluation.decisions[1].gateStatus, 'ineligible');
      assert.ok(evaluation.decisions[0].unknowns.length && evaluation.decisions[1].blockers.length);
    }
  }
});
