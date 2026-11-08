import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { COMPARISON_GENERATOR_VERSION } from '../gcsp/comparison/generator.js';
import { ComparisonRunError } from '../gcsp/comparison/harness.js';
import { routeMeasures, summariseSeeds, compareRoutes, MEASURE_NAMES } from '../gcsp/comparison/measures.js';
import { runComparison, PROCESS_COMPARISON_CAVEAT } from '../gcsp/comparison/experiments.js';
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
    assert.equal(entry.routes.current.recordDigest, inputDigest(current));
    assert.equal(entry.routes.buddy.recordDigest, inputDigest(buddy));
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

test('the same inputs and clock give an identical result; other experiments are refused', async () => {
  const again = await runComparison(experiment, { ...options, now: () => NOW });
  assert.equal(JSON.stringify(again), JSON.stringify(first));
  await assert.rejects(runComparison({ experimentId: 'order-mix' }, options), /invalid-input: experimentId/);
  await assert.rejects(runComparison({ experimentId: 'process-only', mix: {} }, options), /invalid-input: experimentId/);
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
