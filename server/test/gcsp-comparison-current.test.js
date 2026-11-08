import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { loadComparisonPolicy, generateComparisonInputs } from '../gcsp/comparison/generator.js';
import { openComparisonRun } from '../gcsp/comparison/harness.js';
import { evaluateComparisonSeed, statedCandidates, acceptable, carFit } from '../gcsp/comparison/evaluation.js';
import { replayCurrentRoute } from '../gcsp/comparison/routes/current.js';
import { ManualClaimsService } from '../gcsp/manual-claims/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-current-outcomes.json', import.meta.url), 'utf8'));
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const origin = '2026-11-05T09:00:00.000Z';
const snapshot = await loadComparisonPolicy({ policyService: policy, policyRead: { runId: 'comparison-fixture-preparation', asOf: origin } });
async function mechanics(seed = fixture.seed) {
  const inputs = generateComparisonInputs(seed, snapshot, { overlay: fixture.overlay });
  return { policy, inputs, evaluation: await evaluateComparisonSeed({ inputs, policy }),
    route: 'current', codeRevision: 'fucq134-test' };
}
async function prepare({ seed, overlay, service = policy, source = snapshot }) {
  const inputs = generateComparisonInputs(seed, source, { overlay });
  return { policy: service, inputs, evaluation: await evaluateComparisonSeed({ inputs, policy: service }),
    route: 'current', codeRevision: 'fucq134-test' };
}
const scenario = () => prepare(fixture.outcomeScenario);
async function replay(t, setup) {
  const run = await openComparisonRun(setup);
  t.after(() => run.close());
  return { run, record: await replayCurrentRoute(run) };
}
const requireOk = (result) => { assert.equal(result.status, 'ok', JSON.stringify(result)); return result.value; };
const browseDiagnostic = (employee, browsed) => JSON.stringify({
  gradeId: String(employee.gradeId).slice(0, 32), decisionCount: browsed.decisions.length,
  decisions: browsed.decisions.slice(0, 2).map((decision) => ({
    gateStatus: String(decision.gateStatus).slice(0, 32),
    blockerCount: decision.blockers.length, unknownCount: decision.unknowns.length,
    blockers: decision.blockers.slice(0, 8).map((entry) => String(entry.code).slice(0, 64)),
    unknowns: decision.unknowns.slice(0, 8).map((entry) => String(entry.code).slice(0, 64)),
  })),
});
async function claimFirst(run) {
  const employee = run.inputs.employees[0];
  const context = run.employeeContext(employee.employeeId);
  const browsed = requireOk(await run.claims.browseStock(context));
  assert.equal(browsed.ranked, false);
  assert.equal(browsed.cars.length, run.inputs.stock.length, browseDiagnostic(employee, browsed));
  const result = requireOk(await run.claims.claim(context, { commandId: 'mechanics-claim', ...browsed.cars[0].claimInput }));
  return { context, result };
}
async function action(run, context, commandId) {
  const current = requireOk(await run.claims.readClaim(context));
  return { commandId, holdId: current.hold.holdId, expectedHoldVersion: current.hold.version,
    expectedDraftVersion: current.quote.draftVersion };
}

test('isolation', async (t) => {
  const sentinel = await openComparisonRun(await mechanics('fucq134-live-sentinel'));
  t.after(() => sentinel.close());
  const before = await sentinel.snapshot();
  const run = await openComparisonRun(await mechanics());
  t.after(() => run.close());
  assert.notEqual(run.repository, sentinel.repository);
  assert.notEqual(run.metadata.runId, sentinel.metadata.runId);
  requireOk(await run.release(run.inputs.releaseSchedule[0].releaseId));
  await claimFirst(run);
  assert.deepEqual(await sentinel.snapshot(), before);
  const after = await run.snapshot();
  assert.equal(after.holds.length, 1);
  assert.equal(after.notification_outbox.length, fixture.expected.outboxJobs);
  assert.equal(before.notification_outbox.length, 0);
  assert.equal(run.transport.constructor.name, 'CapturedTransport');
  await assert.rejects(openComparisonRun({ ...await mechanics(), repository: sentinel.repository }), /invalid-input: options/);
});

test('real-claim-review-allocate', async (t) => {
  const run = await openComparisonRun(await mechanics());
  t.after(() => run.close());
  requireOk(await run.release(run.inputs.releaseSchedule[0].releaseId));
  const { context, result } = await claimFirst(run);
  assert.equal(result.state, fixture.expected.afterClaim);
  const read = { runId: context.runId, asOf: result.now, policyVersion: context.policyVersion };
  const duration = requireOk(await run.policy.getAssumption('hold.cart.durationSeconds', read));
  assert.equal(Date.parse(result.hold.expiresAt) - Date.parse(result.now), duration.value * 1000);
  const reviewed = requireOk(await run.claims.beginReview(context, await action(run, context, 'mechanics-review')));
  assert.equal(reviewed.hold.phase, fixture.expected.reviewPhase);
  const reviewDuration = requireOk(await run.policy.getAssumption('hold.cart.orderReview.durationSeconds', read));
  assert.equal(Date.parse(reviewed.hold.expiresAt) - Date.parse(reviewed.hold.reviewStartedAt), reviewDuration.value * 1000);
  const allocated = requireOk(await run.claims.allocate(context, await action(run, context, 'mechanics-allocate')));
  assert.equal(allocated.state, fixture.expected.afterAllocation);
  const persisted = await run.snapshot();
  assert.equal(persisted.holds[0].state, 'allocated');
  assert.equal(persisted.claims[0].state, 'allocated');
  assert.equal(persisted.stock.find((car) => car.orderUuid === allocated.hold.orderUuid).state, 'allocated');
  assert.equal(persisted.entitlement_slots.find((slot) => slot.employeeId === context.employeeId).state, 'allocated');
  assert.equal(persisted.notification_outbox.length, 0);
  assert.equal(allocated.quote.facts.identityKind, 'exact-stock');
  assert.equal(allocated.quote.facts.sourceKeys.stockId, allocated.hold.orderUuid);
  assert.equal(allocated.quote.facts.facts.seats.provenance.assurance, 'synthetic-scenario');
  assert.equal(Object.hasOwn(allocated.quote.facts, 'vin'), false);
});

test('untaken-expiry', async (t) => {
  const run = await openComparisonRun(await mechanics());
  t.after(() => run.close());
  requireOk(await run.release(run.inputs.releaseSchedule[0].releaseId));
  const { context, result } = await claimFirst(run);
  requireOk(await run.advanceTo(result.hold.expiresAt));
  const tick = requireOk(await run.tick('mechanics-exact-expiry'));
  assert.equal(tick.state, 'completed');
  assert.ok(tick.handlerOrder.some((row) => row.handlerId === 'manual-claim-expiry' && row.stage === 'manual-expiry'));
  const expired = requireOk(await run.claims.readClaim(context));
  assert.equal(expired.state, fixture.expected.afterUntakenDeadline);
  const persisted = await run.snapshot();
  assert.equal(persisted.claims[0].state, 'expired');
  assert.equal(persisted.stock.find((car) => car.orderUuid === expired.hold.orderUuid).state, fixture.expected.returnedStock);
  assert.equal(persisted.stock.find((car) => car.orderUuid === expired.hold.orderUuid).available, true);
  assert.equal(requireOk(await run.claims.browseStock(context)).cars.length, run.inputs.stock.length);
  assert.equal(persisted.notification_outbox.length, 0);
});

const assumption = (record, key) => record.assumptions.find((row) => row.key === key).value;
const deepFrozen = (value) => !value || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(deepFrozen);
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

test('the live run is untouched and no mail is sent', async (t) => {
  const sentinel = await openComparisonRun(await mechanics('fucq134-live-sentinel'));
  t.after(() => sentinel.close());
  const before = await sentinel.snapshot();
  const { run, record } = await replay(t, await scenario());
  assert.equal(record.totals.taken, 1);
  assert.deepEqual(await sentinel.snapshot(), before);
  const after = await run.snapshot();
  assert.ok(after.holds.length > 0);
  assert.equal(after.notification_outbox.length, 0);
  assert.equal(before.notification_outbox.length, 0);
  assert.equal(run.transport.constructor.name, 'CapturedTransport');
  assert.notEqual(run.repository, sentinel.repository);
});

test('evaluation runs once per seed and is reused', async (t) => {
  const setup = await scenario();
  const { evaluation } = setup;
  assert.equal(evaluation.evaluatorCalls, 2 * setup.inputs.employees.length);
  const first = await replay(t, setup);
  const second = await replay(t, setup);
  assert.equal(first.run.evaluation, evaluation);
  assert.equal(second.run.evaluation, evaluation);
  assert.equal(evaluation.evaluatorCalls, 2 * setup.inputs.employees.length);
  assert.deepEqual(first.record, second.record);
  const other = await mechanics('fucq134-other-seed');
  await assert.rejects(openComparisonRun({ ...setup, evaluation: other.evaluation }), /invalid-input: evaluation/);
});

test('claims follow access order', async (t) => {
  const base = fixture.overlay;
  const setup = await prepare({ seed: 'fucq134-order-6', overlay: { ...base, 'comparison.cohortSize': 6,
    'comparison.releaseCadence': { firstReleaseDay: 0, intervalDays: 1, batchSize: 6 },
    'comparison.accessGroups': [{ id: 'spread', weight: 1, accessSeconds: { min: 0, max: 3000 }, responseSeconds: { min: 0, max: 0 } }] } });
  const actors = setup.inputs.employees.filter((e) => statedCandidates(setup.evaluation, e.employeeId).length > 0)
    .sort((a, b) => a.accessSeconds - b.accessSeconds || byId(a.employeeId, b.employeeId));
  assert.ok(actors.length >= 4);
  assert.ok(actors.every((e, i) => i === 0 || e.accessSeconds - actors[i - 1].accessSeconds > 30));
  const { run, record } = await replay(t, setup);
  const listing = assumption(record, 'comparison.manualRoute.v1').listingToClaimSeconds;
  const quotes = (await run.snapshot()).quotes;
  assert.deepEqual(quotes.map((quote) => quote.employeeId), actors.map((e) => e.employeeId));
  const start = Date.parse(setup.inputs.manifest.startsAt);
  assert.deepEqual(quotes.map((quote) => quote.quotedAt), actors.map((e) => new Date(start + (e.accessSeconds + listing) * 1000).toISOString()));
  assert.equal(record.totals.retries, 0);
  assert.equal(record.totals.taken, actors.length);
});

test('a conflict leads to a counted retry', async (t) => {
  const setup = await mechanics();
  const [first, second] = [...setup.inputs.employees].sort((a, b) => byId(a.employeeId, b.employeeId));
  assert.equal(first.accessSeconds, second.accessSeconds);
  const top = statedCandidates(setup.evaluation, first.employeeId);
  assert.deepEqual(statedCandidates(setup.evaluation, second.employeeId), top);
  assert.equal(top.length, 2);
  const { run, record } = await replay(t, setup);
  const [a, b] = record.employees;
  assert.equal(a.employeeId, first.employeeId);
  assert.deepEqual([a.claims, a.retries, a.orderUuid], [1, 0, top[0]]);
  assert.deepEqual([b.claims, b.retries, b.orderUuid], [1, 1, top[1]]);
  assert.equal(record.totals.retries, 1);
  assert.equal((await run.snapshot()).holds.length, 2);
});

test('an untaken cart hold expires and frees the car', async (t) => {
  const setup = await scenario();
  const { evaluation, inputs } = setup;
  const [bad, good] = [...inputs.employees].sort((a, b) => byId(a.employeeId, b.employeeId));
  const first = inputs.stock[0].orderUuid;
  assert.ok(carFit(evaluation, bad.employeeId, first).stated.score >= evaluation.threshold);
  assert.ok(carFit(evaluation, bad.employeeId, first).underlying.score < evaluation.threshold);
  assert.equal(acceptable(evaluation, good.employeeId, first), true);
  const { run, record } = await replay(t, setup);
  const [x, y] = record.employees;
  assert.deepEqual([x.employeeId, x.outcome, x.claims, x.retries, x.expiries, x.sessions], [bad.employeeId, 'none-by-renewal', 2, 0, 2, 2]);
  assert.deepEqual([y.employeeId, y.outcome, y.claims, y.retries, y.expiries, y.sessions], [good.employeeId, 'taken', 1, 1, 0, 2]);
  const hold = assumption(record, 'hold.cart.durationSeconds');
  const car = record.cars.find((row) => row.orderUuid === y.orderUuid);
  assert.deepEqual([car.outcome, car.allocatedTo, car.holdsNotTaken], ['allocated', good.employeeId, 1]);
  const other = record.cars.find((row) => row.orderUuid !== y.orderUuid);
  assert.deepEqual([other.outcome, other.holdsNotTaken, other.heldNotTakenSeconds], ['held-not-taken', 1, hold]);
  assert.ok(other.heldNotTakenDays > 0);
  const persisted = await run.snapshot();
  const expired = persisted.holds.filter((row) => row.state === 'expired');
  assert.equal(expired.length, 2);
  assert.deepEqual(persisted.claims.filter((row) => row.state === 'expired').length, 2);
  const freed = persisted.holds.find((row) => row.state === 'allocated');
  assert.equal(freed.orderUuid, y.orderUuid);
  assert.ok(Date.parse(persisted.quotes.find((row) => row.quoteId === freed.quoteId).quotedAt)
    >= Date.parse(expired.find((row) => row.orderUuid === y.orderUuid).expiresAt));
  assert.equal(persisted.stock.find((row) => row.orderUuid === other.orderUuid).state, 'released');
  for (const row of expired) {
    const tick = persisted.tick_runs.find((entry) => entry.targetClock.now === row.expiresAt);
    assert.equal(tick.state, 'completed');
    assert.ok(tick.handlerOrder.some((entry) => entry.handlerId === 'manual-claim-expiry' && entry.stage === 'manual-expiry'));
  }
});

test('acceptance uses underlying needs and the threshold key', async (t) => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const variant = structuredClone(seed);
  const row = variant.assumptions.find((entry) => entry.key === 'comparison.acceptableFitThreshold');
  assert.equal(row.value, 70);
  row.value = 40;
  const versions = [variant];
  const service = new PolicyService({ provider: { loadVersions: async () => versions } });
  const source = await loadComparisonPolicy({ policyService: service, policyRead: { runId: 'comparison-threshold-variant', asOf: origin } });
  const lenient = await prepare({ ...fixture.outcomeScenario, service, source });
  const strict = await scenario();
  assert.equal(lenient.inputs.manifest.inputHash, strict.inputs.manifest.inputHash);
  const [bad] = [...strict.inputs.employees].sort((a, b) => byId(a.employeeId, b.employeeId));
  const car = strict.inputs.stock[0].orderUuid;
  const fit = carFit(strict.evaluation, bad.employeeId, car);
  assert.deepEqual([fit.stated.score, fit.underlying.score], [100, 50]);
  assert.equal(acceptable(strict.evaluation, bad.employeeId, car), false);
  assert.equal(acceptable(lenient.evaluation, bad.employeeId, car), true);
  const base = (await replay(t, strict)).record;
  const changed = (await replay(t, lenient)).record;
  assert.deepEqual([base.threshold, changed.threshold, base.thresholdKey], [70, 40, 'comparison.acceptableFitThreshold']);
  assert.equal(assumption(changed, 'comparison.acceptableFitThreshold'), 40);
  const rowOf = (record) => record.employees.find((entry) => entry.employeeId === bad.employeeId);
  assert.equal(rowOf(base).outcome, 'none-by-renewal');
  assert.equal(rowOf(changed).outcome, 'taken');
  assert.deepEqual(rowOf(changed).fit, { stated: 100, underlying: 50 });
  assert.equal(rowOf(changed).expiries, 0);
});

test('identical outcomes for the same seed', async (t) => {
  for (const [seed, overlay] of [[fixture.seed, fixture.overlay], [fixture.outcomeScenario.seed, fixture.outcomeScenario.overlay]]) {
    const a = await replay(t, await prepare({ seed, overlay }));
    const b = await replay(t, await prepare({ seed, overlay }));
    assert.deepEqual(a.record, b.record);
    assert.equal(JSON.stringify(a.record), JSON.stringify(b.record));
    assert.equal(a.run.metadata.runId, b.run.metadata.runId);
    assert.ok(deepFrozen(a.record));
    assert.ok(a.record.employees.every((entry) => entry.seed === seed && entry.policyVersion === 'gcsp-policy-v1' && entry.route === 'current'));
    assert.ok(a.record.cars.every((entry) => entry.seed === seed && entry.policyVersion === 'gcsp-policy-v1' && entry.route === 'current'));
  }
});

test("a small cohort runs through FUCQ-66's real claim code, not a copy", async (t) => {
  const run = await openComparisonRun(await scenario());
  t.after(() => run.close());
  assert.ok(run.claims instanceof ManualClaimsService);
  const calls = { claim: 0, beginReview: 0, allocate: 0 };
  for (const name of Object.keys(calls)) {
    const original = run.claims[name].bind(run.claims);
    run.claims[name] = (...args) => { calls[name] += 1; return original(...args); };
  }
  const record = await replayCurrentRoute(run);
  assert.deepEqual(calls, { claim: record.totals.claims + record.totals.retries,
    beginReview: record.totals.taken, allocate: record.totals.taken });
  const persisted = await run.snapshot();
  assert.equal(persisted.holds.length, record.totals.claims);
  assert.ok(persisted.holds.every((hold) => hold.type === 'cart' && hold.holdId.startsWith('manual-hold:')));
  assert.equal(persisted.holds.filter((hold) => hold.state === 'expired').length, record.totals.expiries);
  assert.equal(persisted.holds.filter((hold) => hold.state === 'allocated').length, record.totals.carsAllocated);
  assert.equal(persisted.claims.length, persisted.quotes.length);
  assert.ok(persisted.tick_runs.length > 0 && persisted.tick_runs.every((tick) => tick.state === 'completed'
    && tick.handlerOrder.some((entry) => entry.handlerId === 'manual-claim-expiry')));
});

test('the recorded outcome record matches the replay', async (t) => {
  const { record } = await replay(t, await scenario());
  assert.deepEqual(record, fixture.outcomeRecord);
});

test("ordering closes when FUCQ-66's collection lead time no longer fits before renewal", async (t) => {
  const setup = await prepare({ seed: fixture.seed, overlay: { ...fixture.overlay, 'comparison.renewalDays': { min: 3, max: 3 } } });
  assert.ok(setup.inputs.employees.every((e) => statedCandidates(setup.evaluation, e.employeeId).length > 0));
  const { run, record } = await replay(t, setup);
  for (const row of record.employees) {
    assert.deepEqual([row.outcome, row.claims, row.retries], ['none-by-renewal', 0, 0]);
    assert.ok(row.orderingClosedAt && Date.parse(row.orderingClosedAt) <= Date.parse(row.renewalAt));
  }
  assert.equal((await run.snapshot()).holds.length, 0);
  assert.equal(record.totals.carsUnused, setup.inputs.stock.length);
});
