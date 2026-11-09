import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { COMPARISON_GENERATOR_VERSION } from '../gcsp/comparison/generator.js';
import { ComparisonRunError } from '../gcsp/comparison/harness.js';
import { routeMeasures, summariseSeeds, compareRoutes, compareArms, MEASURE_NAMES } from '../gcsp/comparison/measures.js';
import { runComparison, validateExperiment, outcomeRecordDigest, PROCESS_COMPARISON_CAVEAT, EXPERIMENT_IDS, EXPERIMENT_CAVEAT } from '../gcsp/comparison/experiments.js';
import { storeComparisonResult, readLatestComparisonResult, COMPARISON_RESULTS_ENVIRONMENT, COMPARISON_RESULTS_RUN } from '../gcsp/comparison/results.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest } from '../gcsp/repository/core.js';

const load = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const currentFixture = await load('gcsp-comparison-current-outcomes.json');
const buddyFixture = await load('gcsp-comparison-buddy-outcomes.json');
const stored = await load('gcsp-comparison-process-result.json');
// One PolicyService for the module: it caches policy snapshots by provider identity.
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const origin = '2026-11-05T09:00:00.000Z';
const ruleRow = (await policy.getAssumption('comparison.noClearDifferenceRule', { runId: 'measures-test', asOf: origin })).value;
const deepFrozen = (value) => !value || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(deepFrozen);
const NOW = '2026-11-08T12:00:00.000Z';
const LATER = '2026-11-09T12:00:00.000Z';
const context = { principalId: 'comparison-test', roles: ['presenter'] };

test('current route measures follow the committed outcome record', () => {
  const m = routeMeasures(currentFixture.outcomeRecord);
  // 1 of 2 employees took a car by renewal at underlying fit 100 (>= 70); 1 of 2 cars allocated; 2 x 120 s held.
  assert.equal(m.acceptableCoverage, 0.5);
  assert.equal(m.carsNeverAllocated, 1);
  assert.equal(m.heldNotTakenCarDays, 0.002778);
  // Today's route makes no offers; totals.expiries is 2 and totals.retries is 1.
  assert.deepEqual([m.declinedOffers, m.expiredOffers, m.failedClaims, m.retries], [0, 0, 2, 1]);
  assert.equal(m.meanAcceptedFit, 100);
  assert.deepEqual(m.accessGroupCoverage, { 'mechanics-access': 0.5 });
  assert.ok(deepFrozen(m));
});

test('buddy route measures follow the committed outcome record', () => {
  const m = routeMeasures(buddyFixture.outcomeRecord);
  // 2 of 4 taken at fit 100; 2 cars held-not-taken; totals.heldNotTakenHours 0.366667 / 24; 2 declines, 0 expiries.
  assert.equal(m.acceptableCoverage, 0.5);
  assert.equal(m.carsNeverAllocated, 2);
  assert.equal(m.heldNotTakenCarDays, 0.015278);
  assert.deepEqual([m.declinedOffers, m.expiredOffers, m.failedClaims, m.retries], [2, 0, 1, 1]);
  assert.equal(m.meanAcceptedFit, 100);
  assert.deepEqual(m.accessGroupCoverage, { 'mechanics-access': 0.5 });
});

test('a taken car below the threshold or after renewal is not acceptable', () => {
  const record = structuredClone(currentFixture.outcomeRecord);
  const taken = record.employees.find((row) => row.outcome === 'taken');
  taken.fit.underlying = 69;
  assert.equal(routeMeasures(record).acceptableCoverage, 0);
  assert.equal(routeMeasures(record).meanAcceptedFit, null);
  taken.fit.underlying = 70;
  assert.equal(routeMeasures(record).acceptableCoverage, 0.5);
  taken.takenAt = '2026-12-05T09:00:01.000Z';
  assert.equal(routeMeasures(record).acceptableCoverage, 0);
  assert.throws(() => routeMeasures({ route: 'other' }), /invalid-input/);
});

test('summariseSeeds gives mean, min, max and the seeds that observed the measure', () => {
  assert.deepEqual(summariseSeeds([1, 2, 3, null]), { mean: 2, min: 1, max: 3, observedSeeds: 3 });
  assert.deepEqual(summariseSeeds([0.1, 0.2, 0.2]), { mean: 0.166667, min: 0.1, max: 0.2, observedSeeds: 3 });
  assert.deepEqual(summariseSeeds([null, null]), { mean: null, min: null, max: null, observedSeeds: 0 });
});

const base = { acceptableCoverage: 0, carsNeverAllocated: 0, heldNotTakenCarDays: 0, declinedOffers: 0, expiredOffers: 0,
  failedClaims: 0, retries: 0, meanAcceptedFit: 80, accessGroupCoverage: { a: 0.5, b: 0.5 } };
const seedsOf = (current, buddy) => current.map((_, index) => ({ seed: `s${index}`,
  current: { ...base, ...current[index] }, buddy: { ...base, ...buddy[index] } }));
const verdicts = (differences) => Object.fromEntries(differences.map((row) => [row.measure, row.verdict]));

test('compareRoutes labels overlap, and reports a baseline win as well as a buddy win', () => {
  const differences = compareRoutes(seedsOf(
    [{ acceptableCoverage: 0.1, retries: 5, failedClaims: 1, accessGroupCoverage: { a: 0.2, b: 0.1 } },
      { acceptableCoverage: 0.2, retries: 6, failedClaims: 2, accessGroupCoverage: { a: 0.2, b: 0.1 } },
      { acceptableCoverage: 0.3, retries: 7, failedClaims: 3, accessGroupCoverage: { a: 0.2, b: 0.1 } }],
    [{ acceptableCoverage: 0.25, retries: 1, failedClaims: 10, accessGroupCoverage: { a: 0.4, b: 0.1 } },
      { acceptableCoverage: 0.35, retries: 2, failedClaims: 11, accessGroupCoverage: { a: 0.4, b: 0.1 } },
      { acceptableCoverage: 0.5, retries: 3, failedClaims: 12, accessGroupCoverage: { a: 0.4, b: 0.1 } }]), ruleRow);
  const found = verdicts(differences);
  assert.equal(found.acceptableCoverage, 'no-clear-difference', 'ranges 0.1-0.3 and 0.25-0.5 overlap');
  assert.equal(found.retries, 'buddy-better', 'lower is better and 1-3 sits below 5-7');
  assert.equal(found.failedClaims, 'current-better', 'lower is better and 10-12 sits above 1-3');
  assert.equal(found['accessGroupCoverage:a'], 'buddy-better');
  assert.equal(found['accessGroupCoverage:b'], 'no-clear-difference', 'identical single points touch');
  assert.ok(Object.values(found).includes('buddy-better') && Object.values(found).includes('current-better'));
  const coverage = differences.find((row) => row.measure === 'acceptableCoverage');
  assert.deepEqual(coverage.current, { mean: 0.2, min: 0.1, max: 0.3, observedSeeds: 3 });
  assert.deepEqual(coverage.buddy, { mean: 0.366667, min: 0.25, max: 0.5, observedSeeds: 3 });
  assert.deepEqual(coverage.difference, { mean: 0.166667, min: 0.15, max: 0.2 });
  assert.equal(coverage.betterWhen, 'higher');
  assert.ok(deepFrozen(differences));
});

test('compareRoutes never drops a measure or an access group', () => {
  const differences = compareRoutes(seedsOf([{}, {}, {}], [{}, {}, {}]), ruleRow);
  assert.deepEqual(differences.map((row) => row.measure), [
    ...MEASURE_NAMES.filter((name) => name !== 'accessGroupCoverage'), 'accessGroupCoverage:a', 'accessGroupCoverage:b']);
  assert.ok(differences.every((row) => row.verdict === 'no-clear-difference'));
});

test('two seeds, or a measure seen in too few seeds, is insufficient and never a winner', () => {
  const two = verdicts(compareRoutes(seedsOf([{ retries: 9 }, { retries: 9 }], [{ retries: 1 }, { retries: 1 }]), ruleRow));
  assert.ok(Object.values(two).every((verdict) => verdict === 'insufficient-seeds'));
  const sparse = seedsOf([{ retries: 9 }, { retries: 9 }, { retries: 9 }], [{ retries: 1 }, { retries: 1 }, { retries: 1 }]);
  sparse[2].buddy.meanAcceptedFit = null;
  const found = verdicts(compareRoutes(sparse, ruleRow));
  assert.equal(found.meanAcceptedFit, 'insufficient-seeds');
  assert.equal(found.retries, 'buddy-better');
});

test('compareRoutes refuses a rule it does not understand', () => {
  const seeds = seedsOf([{}, {}, {}], [{}, {}, {}]);
  const withRule = (change) => ({ ...ruleRow, value: change(structuredClone(ruleRow.value)) });
  for (const change of [(v) => ({ ...v, rule: 'other-rule' }), (v) => ({ ...v, schemaVersion: 2 }),
    (v) => { delete v.betterWhen.retries; return v; }, (v) => ({ ...v, overlapInclusive: 'yes' })]) {
    assert.throws(() => compareRoutes(seeds, withRule(change)), (error) => error instanceof ComparisonRunError && /invalid-input/.test(error.message));
  }
});

const armSeeds = (baseline, variant) => baseline.map((_, index) => ({ seed: `s${index}`,
  baseline: { ...base, ...baseline[index] }, variant: { ...base, ...variant[index] } }));

test('compareArms labels overlap, a variant win and a baseline win, with difference as variant minus baseline', () => {
  const differences = compareArms(armSeeds(
    [{ acceptableCoverage: 0.1, retries: 5, failedClaims: 1 }, { acceptableCoverage: 0.2, retries: 6, failedClaims: 2 },
      { acceptableCoverage: 0.3, retries: 7, failedClaims: 3 }],
    [{ acceptableCoverage: 0.25, retries: 1, failedClaims: 10 }, { acceptableCoverage: 0.35, retries: 2, failedClaims: 11 },
      { acceptableCoverage: 0.5, retries: 3, failedClaims: 12 }]), ruleRow);
  const found = verdicts(differences);
  assert.equal(found.acceptableCoverage, 'no-clear-difference');
  assert.equal(found.retries, 'variant-better');
  assert.equal(found.failedClaims, 'baseline-better');
  const coverage = differences.find((row) => row.measure === 'acceptableCoverage');
  assert.deepEqual(Object.keys(coverage), ['measure', 'betterWhen', 'baseline', 'variant', 'difference', 'verdict']);
  assert.deepEqual(coverage.baseline, { mean: 0.2, min: 0.1, max: 0.3, observedSeeds: 3 });
  assert.deepEqual(coverage.difference, { mean: 0.166667, min: 0.15, max: 0.2 });
  assert.ok(deepFrozen(differences));
});

test('compareArms never drops a measure or an access group, and labels thin seeds insufficient', () => {
  const same = compareArms(armSeeds([{}, {}, {}], [{}, {}, {}]), ruleRow);
  assert.deepEqual(same.map((row) => row.measure), compareRoutes(seedsOf([{}, {}, {}], [{}, {}, {}]), ruleRow).map((row) => row.measure));
  assert.ok(same.every((row) => row.verdict === 'no-clear-difference'));
  const two = compareArms(armSeeds([{ retries: 9 }, { retries: 9 }], [{ retries: 1 }, { retries: 1 }]), ruleRow);
  assert.ok(two.every((row) => row.verdict === 'insufficient-seeds'));
  const sparse = armSeeds([{}, {}, {}], [{}, {}, {}]);
  sparse[2].variant.meanAcceptedFit = null;
  assert.equal(verdicts(compareArms(sparse, ruleRow)).meanAcceptedFit, 'insufficient-seeds');
});

test('compareArms refuses a rule it does not understand', () => {
  const seeds = armSeeds([{}, {}, {}], [{}, {}, {}]);
  assert.throws(() => compareArms(seeds, { ...ruleRow, value: { ...ruleRow.value, rule: 'other-rule' } }), /invalid-input/);
  assert.throws(() => compareArms('not-seeds', ruleRow), /invalid-input: perSeed/);
});

const experiment = { experimentId: 'process-only', overlay: buddyFixture.overlay };
const options = { policy, codeRevision: 'fucq136-test' };
const records = [];
const first = await runComparison(experiment, { ...options, now: () => NOW, onRecord: (record) => records.push(record) });

test('runComparison gives both routes identical inputs for every seed', () => {
  assert.equal(records.length, 6);
  for (const entry of first.perSeed) {
    const [current, buddy] = ['current', 'buddy'].map((route) => records.find((record) => record.seed === entry.seed && record.route === route));
    assert.equal(current.inputHash, entry.inputHash);
    assert.equal(buddy.inputHash, entry.inputHash);
    assert.equal(first.manifest.inputHashes[entry.seed], entry.inputHash);
    assert.equal(entry.routes.current.recordDigest, outcomeRecordDigest(current));
    assert.equal(entry.routes.buddy.recordDigest, outcomeRecordDigest(buddy));
  }
  assert.equal(new Set(first.perSeed.map((entry) => entry.inputHash)).size, 3);
});

test('the result carries a complete manifest, labels and every measure', () => {
  assert.deepEqual(Object.keys(first.manifest).sort(), ['codeRevision', 'experimentId', 'generatorVersion', 'inputHashes',
    'overlays', 'policyHash', 'policyVersion', 'seeds']);
  assert.deepEqual(first.manifest.seeds, ['comparison-a', 'comparison-b', 'comparison-c']);
  assert.deepEqual([first.manifest.experimentId, first.manifest.policyVersion, first.manifest.generatorVersion, first.manifest.codeRevision],
    ['process-only', 'gcsp-policy-v1', COMPARISON_GENERATOR_VERSION, 'fucq136-test']);
  assert.match(first.manifest.policyHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.manifest.overlays, buddyFixture.overlay);
  assert.deepEqual([first.kind, first.completedAt, first.caveat], ['process-comparison', NOW, PROCESS_COMPARISON_CAVEAT]);
  const keys = first.assumptions.map((row) => row.key);
  for (const key of ['comparison.noClearDifferenceRule', 'comparison.acceptableFitThreshold', 'comparison.manualRoute.v1', 'comparison.buddyRoute.v1']) {
    const row = first.assumptions.find((entry) => entry.key === key);
    assert.ok(row && ['assumed', 'verified'].includes(row.status) && row.basis.length > 0 && row.policyVersion === 'gcsp-policy-v1', key);
  }
  assert.deepEqual(keys, [...new Set(keys)].sort());
  assert.equal(first.rule.key, 'comparison.noClearDifferenceRule');
  assert.ok(first.limitations.includes(PROCESS_COMPARISON_CAVEAT));
  for (const route of ['current', 'buddy']) {
    assert.deepEqual(Object.keys(first.measures[route]).sort(), [...MEASURE_NAMES].sort());
    assert.equal(first.measures[route].retries.observedSeeds, 3);
  }
  assert.equal(first.differences.length, MEASURE_NAMES.length - 1 + Object.keys(first.measures.buddy.accessGroupCoverage).length);
  assert.ok(deepFrozen(first));
  assert.ok(first.perSeed.every((entry) => entry.routes.buddy.totals.participants >= 0 && !('employees' in entry.routes.buddy)));
});

test('the same inputs and clock give an identical result; unknown experiments are refused', async () => {
  const again = await runComparison(experiment, { ...options, now: () => NOW });
  assert.equal(JSON.stringify(again), JSON.stringify(first));
  await assert.rejects(runComparison({ experimentId: 'unknown-experiment' }, options), /invalid-input: experimentId/);
  await assert.rejects(runComparison({ experimentId: 'order-mix' }, options), /invalid-input: change/);
  await assert.rejects(runComparison({ experimentId: 'process-only', mix: {} }, options), /invalid-input: experimentId/);
});

test('the code revision is provenance only: another revision gives identical measures and record digests (FUCQ-242)', async () => {
  const revisions = [];
  const other = await runComparison(experiment, { ...options, codeRevision: 'fucq242-other-commit', now: () => NOW,
    onRecord: (record) => revisions.push(record.codeRevision) });
  assert.deepEqual([...new Set(revisions)], ['fucq242-other-commit']);
  assert.equal(other.manifest.codeRevision, 'fucq242-other-commit');
  assert.equal(JSON.stringify({ ...other, manifest: { ...other.manifest, codeRevision: 'fucq136-test' } }), JSON.stringify(first));
  for (const [index, entry] of other.perSeed.entries()) for (const route of ['current', 'buddy']) {
    assert.equal(entry.routes[route].recordDigest, first.perSeed[index].routes[route].recordDigest, `${entry.seed} ${route}`);
  }
});

const openRepository = async () => {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW });
  assert.equal((await repository.open()).status, 'ok');
  return repository;
};
const resultsScope = { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT, ...context };
const stubPolicy = (policyVersion) => ({ getActiveVersion: async () => ({ status: 'ok', policyVersion }) });

test('a stored result is read back as the latest and is flagged current', async () => {
  const repository = await openRepository();
  assert.equal((await readLatestComparisonResult(repository, context, policy, { asOf: NOW })).status, 'not-found');
  const saved = await storeComparisonResult(repository, context, first);
  assert.equal(saved.status, 'ok');
  assert.match(saved.value.resultId, /^process-comparison-[0-9a-f]{32}$/);
  const read = await readLatestComparisonResult(repository, context, policy, { asOf: NOW });
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.value.result, JSON.parse(JSON.stringify(first)));
  assert.deepEqual([read.value.resultId, read.value.policyVersion, read.value.activePolicyVersion, read.value.policyCurrent],
    [saved.value.resultId, 'gcsp-policy-v1', 'gcsp-policy-v1', true]);
  const again = await storeComparisonResult(repository, context, first);
  assert.equal(again.value.resultId, saved.value.resultId);
  assert.equal((await repository.query(resultsScope, 'comparison_results')).value.length, 1);
  await repository.close();
});

test('a new run is a new row and becomes latest; the first stays readable and cannot be edited', async () => {
  const repository = await openRepository();
  const earlier = await storeComparisonResult(repository, context, first);
  const second = await runComparison(experiment, { ...options, now: () => LATER });
  const later = await storeComparisonResult(repository, context, second);
  assert.notEqual(later.value.resultId, earlier.value.resultId);
  const rows = (await repository.query(resultsScope, 'comparison_results')).value;
  assert.deepEqual(rows.map((row) => row.resultId).sort(), [earlier.value.resultId, later.value.resultId].sort());
  assert.equal((await readLatestComparisonResult(repository, context, policy, { asOf: LATER })).value.resultId, later.value.resultId);
  assert.equal(rows.find((row) => row.resultId === earlier.value.resultId).result.completedAt, NOW);
  const edit = await repository.transaction(resultsScope, { commandId: 'edit-result', inputDigest: inputDigest('edit') },
    (tx) => tx.compareAndSwap({ table: 'comparison_results', key: { runId: COMPARISON_RESULTS_RUN, resultId: earlier.value.resultId } }, 1, { experimentId: 'changed' }));
  assert.equal(edit.code, 'immutable-row');
  assert.equal((await repository.query(resultsScope, 'comparison_results')).value.find((row) => row.resultId === earlier.value.resultId).experimentId, 'process-only');
  await repository.close();
});

test('a live demo reset leaves stored results untouched', async () => {
  const repository = await openRepository();
  const live = (runId) => ({ runId, environmentId: 'live-demo', principalId: 'presenter', roles: ['presenter'] });
  const nextRun = (runId) => ({ runId, environmentId: 'live-demo', status: 'active', current: true, scenarioVersion: 's', fixtureVersion: 'f',
    corpusVersion: 'c', policyVersion: 'gcsp-policy-v1', clockInstant: NOW, clockVersion: '1', versions: {} });
  assert.equal((await repository.resetRun(live('live-1'), { commandId: 'live-1', inputDigest: inputDigest('1') },
    { expectedCurrentRunId: null, nextRun: nextRun('live-1'), rows: [] })).status, 'ok');
  const saved = await storeComparisonResult(repository, live('live-1'), first);
  assert.equal(saved.status, 'ok');
  const reset = await repository.resetRun(live('live-1'), { commandId: 'live-2', inputDigest: inputDigest('2') },
    { expectedCurrentRunId: 'live-1', expectedRunVersion: 1, nextRun: nextRun('live-2'), rows: [] });
  assert.equal(reset.status, 'ok');
  assert.equal((await repository.currentRun('live-demo')).value.runId, 'live-2');
  assert.equal((await repository.currentRun(COMPARISON_RESULTS_ENVIRONMENT)).value.runId, COMPARISON_RESULTS_RUN);
  const read = await readLatestComparisonResult(repository, live('live-2'), policy, { asOf: NOW });
  assert.equal(read.value.resultId, saved.value.resultId);
  await repository.close();
});

test('a result from a superseded policy version is flagged', async () => {
  const repository = await openRepository();
  await storeComparisonResult(repository, context, first);
  const read = await readLatestComparisonResult(repository, context, stubPolicy('gcsp-policy-v2'), { asOf: NOW });
  assert.deepEqual([read.value.policyVersion, read.value.activePolicyVersion, read.value.policyCurrent], ['gcsp-policy-v1', 'gcsp-policy-v2', false]);
  await repository.close();
});

test('the published process-result shape is what a fresh run stores and reads', async () => {
  assert.deepEqual([stored.schemaVersion, stored.evidenceStatus], [1, 'computed-small-cohort']);
  assert.deepEqual(stored.overlay, buddyFixture.overlay);
  const repository = await openRepository();
  await storeComparisonResult(repository, context, first);
  const read = await readLatestComparisonResult(repository, context, policy, { asOf: NOW });
  assert.deepEqual(JSON.parse(JSON.stringify(read.value)), stored.storedResult);
  await repository.close();
});

// ---- FUCQ-174: what-if experiments (order mix, points, hold sweep) ----
const small = buddyFixture.overlay;
const basis = 'Test basis: an illustrative what-if value.';
const pointsExperiment = { experimentId: 'points', change: { value: 2, basis }, overlay: small };
const holdExperiment = { experimentId: 'hold-sweep', change: { values: [900, 86400], basis }, overlay: small };
const mixBaseline = (await policy.getAssumption('comparison.modelLineMix', { runId: 'measures-test', asOf: origin })).value.value;
const mixOverlay = Object.fromEntries(Object.entries(small).filter(([key]) => key !== 'comparison.modelLineMix'));
const mixExperiment = { experimentId: 'order-mix', change: { value: [{ modelLine: 'G20 Saloon|320i', weight: 1 }], basis }, overlay: mixOverlay };
const collect = () => { const seen = []; return { seen, onRecord: (record, meta) => seen.push({ armId: meta.armId, route: record.route, seed: record.seed,
  hold: record.holdDuration?.holdDurationSeconds }) }; };
const pointsSeen = collect();
const holdSeen = collect();
const mixSeen = collect();
const progress = [];
const points = await runComparison(pointsExperiment, { ...options, now: () => NOW, onRecord: pointsSeen.onRecord });
const hold = await runComparison(holdExperiment, { ...options, now: () => NOW, onRecord: holdSeen.onRecord, onProgress: (step) => progress.push(step) });
const mix = await runComparison(mixExperiment, { ...options, now: () => NOW, onRecord: mixSeen.onRecord });
const stripped = (arm) => JSON.stringify({ perSeed: arm.perSeed, measures: arm.measures, differences: arm.differences });
const allowedVerdicts = ['insufficient-seeds', 'no-clear-difference', 'variant-better', 'baseline-better'];

test('the experiment ids are the process comparison plus the three what-ifs', () => {
  assert.deepEqual(EXPERIMENT_IDS, ['process-only', 'order-mix', 'points', 'hold-sweep']);
  assert.equal(EXPERIMENT_CAVEAT, PROCESS_COMPARISON_CAVEAT);
});

test('a points experiment records the change, its unit, basis and baseline, and the shared overlay', () => {
  assert.deepEqual([points.kind, points.experimentId, points.completedAt, points.caveat], ['experiment-comparison', 'points', NOW, PROCESS_COMPARISON_CAVEAT]);
  const { change } = points.manifest;
  assert.deepEqual(change, { key: 'comparison.pointsAllowanceMultiplier', unit: 'allowance multiplier', status: 'what-if', basis,
    baselineValue: 1, baselineBasis: change.baselineBasis, baselineStatus: 'assumed', definitionKey: 'comparison.experiments.v1', value: 2 });
  assert.ok(change.baselineBasis.length > 0);
  assert.deepEqual(points.manifest.overlays, small);
  assert.deepEqual(points.manifest.arms.map((arm) => [arm.armId, arm.value]), [['baseline', 1], ['variant', 2]]);
  const [baseline, variant] = points.manifest.arms;
  assert.deepEqual(baseline.overlay, small);
  assert.deepEqual(variant.overlay, { ...small, 'comparison.pointsAllowanceMultiplier': 2 });
  assert.equal(baseline.overlayHash, inputDigest(baseline.overlay));
  assert.equal(variant.overlayHash, inputDigest(variant.overlay));
  assert.deepEqual(Object.keys(variant.inputHashes), points.manifest.seeds);
  for (const seed of points.manifest.seeds) assert.notEqual(variant.inputHashes[seed], baseline.inputHashes[seed]);
  assert.equal(points.manifest.policyHash, first.manifest.policyHash);
  assert.ok(points.limitations.includes('What-if experiment: the changed values were never published as live policy.'));
  assert.ok(points.limitations.includes(PROCESS_COMPARISON_CAVEAT));
  assert.deepEqual(points.assumptions.map((row) => row.key), [...points.assumptions.map((row) => row.key)].sort());
  for (const key of ['comparison.experiments.v1', 'comparison.noClearDifferenceRule']) {
    assert.ok(points.assumptions.some((row) => row.key === key && row.status === 'assumed' && row.basis.length > 0), key);
  }
  assert.ok(deepFrozen(points) && deepFrozen(hold) && deepFrozen(mix));
});

test('the baseline arm equals a process-only run with the same overlay and seeds', () => {
  for (const result of [points, hold]) {
    assert.equal(stripped(result.arms[0]), stripped(first));
    assert.deepEqual(result.arms[0].value, result.manifest.change.baselineValue);
  }
  assert.deepEqual(points.manifest.arms[0].inputHashes, first.manifest.inputHashes);
});

test('a hold sweep carries every value and changes only the buddy route', () => {
  const { change } = hold.manifest;
  assert.deepEqual([change.key, change.unit, change.baselineValue, change.values, change.basis, change.status],
    ['hold.buddy.durationSeconds', 'seconds', 7200, [900, 86400], basis, 'what-if']);
  assert.ok(!('value' in change));
  assert.deepEqual(hold.arms.map((arm) => [arm.armId, arm.value]), [['baseline', 7200], ['hold-900', 900], ['hold-86400', 86400]]);
  const [baseline, ...variants] = hold.arms;
  for (const arm of variants) {
    const manifestArm = hold.manifest.arms.find((entry) => entry.armId === arm.armId);
    assert.deepEqual(manifestArm.inputHashes, first.manifest.inputHashes, 'hold changes no cohort, stock or release');
    assert.deepEqual(manifestArm.overlay, { ...small, 'hold.buddy.durationSeconds': arm.value });
    assert.notEqual(manifestArm.overlayHash, hold.manifest.arms[0].overlayHash);
    for (const [index, entry] of arm.perSeed.entries()) {
      assert.deepEqual(entry.routes.current, baseline.perSeed[index].routes.current);
    }
    assert.deepEqual(arm.measures.current, baseline.measures.current);
  }
  // Identical current routes give no winner; a measure seen in too few seeds stays insufficient-seeds.
  for (const effect of hold.effects) assert.ok(effect.routes.current.every((row) => ['no-clear-difference', 'insufficient-seeds']
    .includes(row.verdict) && row.difference.mean === (row.difference.mean === null ? null : 0)), effect.armId);
  const buddyHolds = holdSeen.seen.filter((row) => row.route === 'buddy');
  assert.equal(buddyHolds.length, 9);
  for (const row of buddyHolds) assert.equal(row.hold, hold.arms.find((arm) => arm.armId === row.armId).value, row.armId);
});

test('a points experiment and an order-mix experiment change the generated inputs', () => {
  assert.equal(pointsSeen.seen.length, 12);
  assert.deepEqual(mix.arms.map((arm) => arm.armId), ['baseline', 'variant']);
  assert.equal(mixSeen.seen.length, 12);
  assert.deepEqual(mix.manifest.change.value, [{ modelLine: 'G20 Saloon|320i', weight: 1 }]);
  assert.equal(mix.manifest.change.key, 'comparison.modelLineMix');
  assert.deepEqual(mix.manifest.overlays, mixOverlay);
  const [baseline, variant] = mix.manifest.arms;
  for (const seed of mix.manifest.seeds) assert.notEqual(variant.inputHashes[seed], baseline.inputHashes[seed]);
});

test('effects hold one entry per measure and access group for both routes, using only the four verdicts', () => {
  for (const result of [points, hold, mix]) {
    assert.deepEqual(result.effects.map((effect) => effect.armId), result.arms.slice(1).map((arm) => arm.armId));
    for (const effect of result.effects) for (const route of ['current', 'buddy']) {
      const groups = Object.keys(result.arms[0].measures[route].accessGroupCoverage);
      assert.equal(effect.routes[route].length, MEASURE_NAMES.length - 1 + groups.length);
      assert.ok(effect.routes[route].every((row) => allowedVerdicts.includes(row.verdict) && 'baseline' in row && 'variant' in row));
    }
  }
});

test('the same inputs and clock give an identical experiment result', async () => {
  const again = await runComparison(holdExperiment, { ...options, now: () => NOW });
  assert.equal(JSON.stringify(again), JSON.stringify(hold));
  const plan = await validateExperiment(holdExperiment, { policy, now: () => NOW });
  assert.deepEqual(plan, { experimentId: 'hold-sweep', seeds: hold.manifest.seeds, steps: 18,
    arms: hold.manifest.arms.map(({ armId, value, overlay }) => ({ armId, value, overlay })) });
  assert.ok(deepFrozen(plan));
});

test('onProgress is called once per route replay, completed rising to the total', () => {
  assert.equal(progress.length, 18);
  assert.deepEqual(progress.map((step) => step.completed), Array.from({ length: 18 }, (_, index) => index + 1));
  assert.ok(progress.every((step) => step.total === 18 && step.experimentId === 'hold-sweep'));
  assert.deepEqual(Object.keys(progress[0]).sort(), ['armId', 'completed', 'experimentId', 'route', 'seed', 'total']);
  assert.deepEqual([progress[0].armId, progress[0].route, progress[1].route], ['baseline', 'current', 'buddy']);
});

// A PolicyService look-alike that lets one assumption row be altered, and records every method called.
const spyPolicy = (alter = () => undefined) => {
  const called = new Set();
  const proxy = new Proxy(policy, { get(target, name) {
    const member = target[name];
    if (typeof member !== 'function') return member;
    return async (...args) => {
      called.add(name);
      const result = await member.apply(target, args);
      if (name !== 'getAssumption' || result.status !== 'ok') return result;
      const value = alter(args[0], structuredClone(result.value));
      return value ? { ...result, value } : result;
    };
  } });
  return { proxy, called };
};

test('a bad experiment is refused before any replay, naming the boundary', async () => {
  const hit = [];
  const guard = { ...options, onRecord: () => hit.push('record'), onProgress: () => hit.push('progress') };
  const withRow = (key, change) => spyPolicy((name, row) => (name === key ? change(row) : undefined)).proxy;
  const cases = [
    ['points above range', { ...pointsExperiment, change: { value: 3.5, basis } }, 'comparison.pointsAllowanceMultiplier'],
    ['points below range', { ...pointsExperiment, change: { value: -1, basis } }, 'comparison.pointsAllowanceMultiplier'],
    ['points not a number', { ...pointsExperiment, change: { value: '2', basis } }, 'comparison.pointsAllowanceMultiplier'],
    ['points equal to baseline', { ...pointsExperiment, change: { value: 1, basis } }, 'comparison.pointsAllowanceMultiplier'],
    ['hold below range', { ...holdExperiment, change: { values: [899], basis } }, 'hold.buddy.durationSeconds'],
    ['hold above range', { ...holdExperiment, change: { values: [86401], basis } }, 'hold.buddy.durationSeconds'],
    ['hold not an integer', { ...holdExperiment, change: { values: [900.5], basis } }, 'change'],
    ['too many hold values', { ...holdExperiment, change: { values: [900, 1800, 3600, 10800, 21600, 43200], basis } }, 'change'],
    ['no hold values', { ...holdExperiment, change: { values: [], basis } }, 'change'],
    ['duplicate hold values', { ...holdExperiment, change: { values: [900, 900], basis } }, 'change'],
    ['hold equal to baseline', { ...holdExperiment, change: { values: [900, 7200], basis } }, 'hold.buddy.durationSeconds'],
    ['order mix equal to baseline', { ...mixExperiment, change: { value: structuredClone(mixBaseline), basis } }, 'comparison.modelLineMix'],
    ['order mix with an unknown model line', { ...mixExperiment, change: { value: [{ modelLine: 'No such line', weight: 1 }], basis } }, 'comparison.modelLineMix'],
    ['order mix with a bad shape', { ...mixExperiment, change: { value: [{ weight: 1 }], basis } }, 'comparison.modelLineMix'],
    ['blank basis', { ...pointsExperiment, change: { value: 2, basis: '   ' } }, 'basis'],
    ['missing basis', { ...pointsExperiment, change: { value: 2 } }, 'basis'],
    ['no change', { experimentId: 'points', overlay: small }, 'change'],
    ['hold given as value', { ...holdExperiment, change: { value: 900, basis } }, 'change'],
    ['unknown change key', { ...pointsExperiment, change: { value: 2, basis, extra: 1 } }, 'change'],
    ['shared overlay holding the experiment key', { ...pointsExperiment, overlay: { ...small, 'comparison.pointsAllowanceMultiplier': 2 } }, 'overlay'],
    ['shared overlay holding the hold key', { ...holdExperiment, overlay: { ...small, 'hold.buddy.durationSeconds': 3600 } }, 'overlay'],
    ['shared overlay with an unsupported key', { ...pointsExperiment, overlay: { ...small, 'comparison.nothing': 1 } }, 'overlay'],
    ['unknown top-level key', { ...pointsExperiment, mix: {} }, 'experimentId'],
    ['change on process-only', { experimentId: 'process-only', change: { value: 2, basis } }, 'experimentId'],
    ['duplicate seeds', { ...pointsExperiment, seeds: ['a', 'a'] }, 'seeds'],
  ];
  for (const [name, input, boundary] of cases) {
    await assert.rejects(runComparison(input, guard), (error) => error instanceof ComparisonRunError && error.code === 'invalid-input'
      && error.boundary === boundary, name);
    await assert.rejects(validateExperiment(input, { policy, now: () => NOW }), /invalid-input/, `${name} (validate)`);
  }
  const policyCases = [
    ['canonical unit differs from the definition', pointsExperiment, withRow('comparison.pointsAllowanceMultiplier', (row) => ({ ...row, unit: 'percent' })), 'comparison.pointsAllowanceMultiplier'],
    ['hold unit differs from the definition', holdExperiment, withRow('hold.buddy.durationSeconds', (row) => ({ ...row, unit: 'minutes' })), 'hold.buddy.durationSeconds'],
    ['definition unit differs from the canonical key', holdExperiment, withRow('comparison.experiments.v1', (row) => {
      row.value.experiments['hold-sweep'].unit = 'minutes'; return row; }), 'hold.buddy.durationSeconds'],
    ['definition schema version unknown', pointsExperiment, withRow('comparison.experiments.v1', (row) => ({ ...row, value: { ...row.value, schemaVersion: 2 } })), 'comparison.experiments.v1'],
    ['definition names another key', pointsExperiment, withRow('comparison.experiments.v1', (row) => {
      row.value.experiments.points.key = 'comparison.cohortSize'; return row; }), 'comparison.experiments.v1'],
    ['definition missing a bound', holdExperiment, withRow('comparison.experiments.v1', (row) => {
      delete row.value.experiments['hold-sweep'].maximumValues; return row; }), 'comparison.experiments.v1'],
  ];
  for (const [name, input, wrapped, boundary] of policyCases) {
    await assert.rejects(runComparison(input, { ...guard, policy: wrapped }), (error) => error instanceof ComparisonRunError
      && error.boundary === boundary, name);
  }
  assert.deepEqual(hit, [], 'no route was replayed for any refused input');
});

test('an experiment only reads policy; it never publishes or writes it', async () => {
  const { proxy, called } = spyPolicy();
  await runComparison(holdExperiment, { ...options, policy: proxy, now: () => NOW });
  await runComparison(pointsExperiment, { ...options, policy: proxy, now: () => NOW });
  const reads = ['getActiveVersion', 'getAssumption', 'getAllowance', 'getEligibility', 'getPointsCost'];
  assert.ok(called.size > 0 && [...called].every((name) => reads.includes(name)), [...called].join(','));
  const failing = new Proxy(policy, { get(target, name) {
    const member = target[name];
    if (typeof member !== 'function' || ['getActiveVersion', 'getAssumption', 'getAllowance', 'getEligibility', 'getPointsCost'].includes(name)) {
      return typeof member === 'function' ? member.bind(target) : member;
    }
    return () => assert.fail(`policy method ${String(name)} must not be called`);
  } });
  await runComparison(mixExperiment, { ...options, policy: failing, now: () => NOW });
});

test('the process-only fixtures are untouched by the experiment runner', async () => {
  const again = await runComparison(experiment, { ...options, now: () => NOW });
  assert.equal(JSON.stringify(again), JSON.stringify(first));
  assert.equal(again.kind, 'process-comparison');
  assert.ok(!again.manifest.arms && !again.effects);
});
