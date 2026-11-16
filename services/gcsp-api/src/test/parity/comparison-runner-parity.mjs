// Offline generator for src/test/resources/comparison-parity/runner.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/comparison-runner-parity.mjs
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/index.js';
import { ComparisonRunError } from '../../../../../server/gcsp/comparison/harness.js';
import { routeMeasures, compareRoutes, compareArms } from '../../../../../server/gcsp/comparison/measures.js';
import { parseExperimentRequest, refusalFor } from '../../../../../server/gcsp/comparison/requests.js';
import { runComparison, validateExperiment } from '../../../../../server/gcsp/comparison/experiments.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '../resources/comparison-parity/runner.json');
const fixture = async (name) => JSON.parse(await readFile(join(here, '../../../../../server/test/fixtures', name), 'utf8'));
const NOW = '2026-11-08T12:00:00.000Z';
const policy = createPolicyService();
const ruleRow = (await policy.getAssumption('comparison.noClearDifferenceRule', { runId: 'runner-parity', asOf: '2026-11-05T09:00:00.000Z' })).value;
const plain = (value) => JSON.parse(JSON.stringify(value));
const attempt = (fn) => { try { return { ok: fn() }; } catch (error) {
  if (!(error instanceof ComparisonRunError)) throw error;
  return { refused: { code: error.code, boundary: error.boundary } }; } };
const attemptAsync = async (fn) => { try { return { ok: await fn() }; } catch (error) {
  if (!(error instanceof ComparisonRunError)) throw error;
  return { refused: { code: error.code, boundary: error.boundary } }; } };

// (a) routeMeasures: the two committed records plus small mutations of the current one.
const current = (await fixture('gcsp-comparison-current-outcomes.json')).outcomeRecord;
const buddy = (await fixture('gcsp-comparison-buddy-outcomes.json')).outcomeRecord;
const mutations = {
  'no-employees': (record) => { record.employees = []; },
  'below-threshold': (record) => { for (const row of record.employees) if (row.fit) row.fit.underlying = record.threshold - 1; },
  'unknown-route': (record) => { record.route = 'other'; },
  'no-totals': (record) => { delete record.totals; },
};
const measures = [
  { name: 'current-fixture', source: 'current', expected: attempt(() => routeMeasures(current)) },
  { name: 'buddy-fixture', source: 'buddy', expected: attempt(() => routeMeasures(buddy)) },
  ...Object.entries(mutations).map(([name, mutate]) => {
    const record = structuredClone(current); mutate(record);
    return { name, source: 'current', mutation: name, expected: attempt(() => routeMeasures(record)) };
  }),
];

// Synthetic seeds for the verdict logic of compareRoutes and compareArms.
const side = (value, groups = {}) => ({ acceptableCoverage: value, carsNeverAllocated: 1, heldNotTakenCarDays: 0.5, declinedOffers: 0, expiredOffers: 0,
  failedClaims: 0, retries: 0, meanAcceptedFit: value === null ? null : 90, accessGroupCoverage: groups });
const compareCases = [
  { name: 'separated', rule: ruleRow, perSeed: [0.1, 0.2, 0.3].map((v, i) => ({ seed: `s${i}`, current: side(v, { a: v }), buddy: side(v + 0.5, { a: v + 0.5, b: 0.2 }) })) },
  { name: 'overlapping', rule: ruleRow, perSeed: [0.1, 0.4, 0.3].map((v, i) => ({ seed: `s${i}`, current: side(v), buddy: side(v + 0.1) })) },
  { name: 'insufficient', rule: ruleRow, perSeed: [0.1, 0.2].map((v, i) => ({ seed: `s${i}`, current: side(v), buddy: side(v + 0.5) })) },
  { name: 'missing-values', rule: ruleRow, perSeed: [0.1, null, 0.3, 0.2].map((v, i) => ({ seed: `s${i}`, current: side(v), buddy: side(v === null ? 0.3 : v + 0.4) })) },
  { name: 'same-point-exclusive', rule: { ...ruleRow, value: { ...ruleRow.value, overlapInclusive: false } },
    perSeed: [0.5, 0.5, 0.5].map((v, i) => ({ seed: `s${i}`, current: side(v), buddy: side(v) })) },
  { name: 'bad-rule', rule: { ...ruleRow, value: { ...ruleRow.value, rule: 'other-rule' } }, perSeed: [] },
];
// Digests keep the file small; a refusal stays readable.
const digestOf = (outcome) => (outcome.ok ? { digest: inputDigest(outcome.ok), entries: outcome.ok.length } : outcome);
const comparisons = compareCases.map((entry) => ({ ...entry,
  routes: digestOf(attempt(() => plain(compareRoutes(entry.perSeed, entry.rule)))),
  arms: digestOf(attempt(() => plain(compareArms(entry.perSeed.map((row) => ({ seed: row.seed, baseline: row.current, variant: row.buddy })), entry.rule)))) }));

// (b) requests.
const basis = 'Parity test basis for an illustrative what-if value.';
const bodies = [
  { name: 'process-only', body: { experimentId: 'process-only' } },
  { name: 'process-with-change', body: { experimentId: 'process-only', change: { value: 1, basis } } },
  { name: 'points', body: { experimentId: 'points', change: { value: 2, basis } } },
  { name: 'hold-sweep', body: { experimentId: 'hold-sweep', change: { values: [900, 86400], basis } } },
  { name: 'order-mix', body: { experimentId: 'order-mix', change: { value: [{ modelLine: 'G20 Saloon|320i', weight: 1 }], basis } } },
  { name: 'not-an-object', body: [] },
  { name: 'null-body', body: null },
  { name: 'unknown-fields', body: { experimentId: 'points', seeds: ['x'], overlay: {}, extra: 1, change: { value: 2, basis } } },
  { name: 'unknown-experiment', body: { experimentId: 'nope' } },
  { name: 'missing-change', body: { experimentId: 'points' } },
  { name: 'change-not-object', body: { experimentId: 'hold-sweep', change: 3 } },
  { name: 'change-null', body: { experimentId: 'points', change: null } },
  { name: 'change-extra-field', body: { experimentId: 'points', change: { value: 2, basis, why: 'x' } } },
  { name: 'missing-value-and-basis', body: { experimentId: 'points', change: {} } },
  { name: 'points-not-number', body: { experimentId: 'points', change: { value: '2', basis } } },
  { name: 'sweep-not-list', body: { experimentId: 'hold-sweep', change: { values: 900, basis } } },
  { name: 'sweep-fractions', body: { experimentId: 'hold-sweep', change: { values: [900.5], basis } } },
  { name: 'sweep-empty', body: { experimentId: 'hold-sweep', change: { values: [], basis } } },
  { name: 'sweep-duplicates', body: { experimentId: 'hold-sweep', change: { values: [900, 900], basis } } },
  { name: 'mix-not-list', body: { experimentId: 'order-mix', change: { value: 'all', basis } } },
  { name: 'mix-rows-not-objects', body: { experimentId: 'order-mix', change: { value: [1], basis } } },
  { name: 'blank-basis', body: { experimentId: 'points', change: { value: 2, basis: '   ' } } },
  { name: 'long-basis', body: { experimentId: 'points', change: { value: 2, basis: 'x'.repeat(501) } } },
  { name: 'max-basis', body: { experimentId: 'points', change: { value: 2, basis: 'x'.repeat(500) } } },
];
const requests = bodies.map(({ name, body }) => ({ name, body, expected: plain(parseExperimentRequest(body)) }));
const sample = { values: [900, 86400] };
const refusals = [
  ['experimentId', 'points'], ['change', 'points'], ['change', 'hold-sweep', sample], ['change', 'hold-sweep', { value: 3 }], ['basis', 'points'],
  ['overlay', 'points'], ['overlay', 'order-mix'], ['seeds', 'points'], ['comparison.modelLineMix', 'order-mix'],
  ['comparison.pointsAllowanceMultiplier', 'points'], ['hold.buddy.durationSeconds', 'hold-sweep'], ['comparison.cohortSize', 'points'],
  ['manifest', 'points'], ['seed', 'points'],
].map(([boundary, experimentId, change]) => ({ boundary, experimentId, ...(change && { change }),
  expected: plain(refusalFor(boundary, experimentId, change)) }));

// (c) experiment preparation: the plan or the refused boundary.
const small = { 'comparison.cohortSize': 12, 'comparison.carsPerEmployee': 1 };
const mixOk = [{ modelLine: 'G20 Saloon|320i', weight: 1 }];
const experiments = [
  { name: 'process-default', experiment: { experimentId: 'process-only' } },
  { name: 'process-seeds-overlay', experiment: { experimentId: 'process-only', seeds: ['x', 7], overlay: small } },
  { name: 'process-unknown-overlay-key', experiment: { experimentId: 'process-only', overlay: { 'comparison.nope': 1 } } },
  { name: 'points-valid', experiment: { experimentId: 'points', change: { value: 2, basis: `  ${basis}  ` }, overlay: small } },
  { name: 'points-out-of-range-high', experiment: { experimentId: 'points', change: { value: 4, basis }, overlay: small } },
  { name: 'points-out-of-range-low', experiment: { experimentId: 'points', change: { value: -1, basis }, overlay: small } },
  { name: 'points-equals-today', experiment: { experimentId: 'points', change: { value: 1, basis }, overlay: small } },
  { name: 'points-not-number', experiment: { experimentId: 'points', change: { value: '2', basis }, overlay: small } },
  { name: 'points-overlay-touches-key', experiment: { experimentId: 'points', change: { value: 2, basis }, overlay: { ...small, 'comparison.pointsAllowanceMultiplier': 1.5 } } },
  { name: 'points-bad-overlay-key', experiment: { experimentId: 'points', change: { value: 2, basis }, overlay: { 'comparison.nope': 1 } } },
  { name: 'points-bad-shared-setting', experiment: { experimentId: 'points', change: { value: 2, basis }, overlay: { 'comparison.cohortSize': 100001 } } },
  { name: 'hold-valid', experiment: { experimentId: 'hold-sweep', change: { values: [900, 86400], basis }, overlay: small } },
  { name: 'hold-single', experiment: { experimentId: 'hold-sweep', change: { values: [14400], basis }, overlay: small } },
  { name: 'hold-over-maximum', experiment: { experimentId: 'hold-sweep', change: { values: [900, 1800, 3600, 10800, 14400, 86400], basis }, overlay: small } },
  { name: 'hold-equals-today', experiment: { experimentId: 'hold-sweep', change: { values: [900, 7200], basis }, overlay: small } },
  { name: 'hold-out-of-range', experiment: { experimentId: 'hold-sweep', change: { values: [100], basis }, overlay: small } },
  { name: 'hold-fraction', experiment: { experimentId: 'hold-sweep', change: { values: [1000.5], basis }, overlay: small } },
  { name: 'hold-duplicates', experiment: { experimentId: 'hold-sweep', change: { values: [900, 900], basis }, overlay: small } },
  { name: 'hold-overlay-touches-key', experiment: { experimentId: 'hold-sweep', change: { values: [900], basis }, overlay: { ...small, 'hold.buddy.durationSeconds': 3600 } } },
  { name: 'hold-bad-shared-setting', experiment: { experimentId: 'hold-sweep', change: { values: [900], basis }, overlay: { 'comparison.cohortSize': 0 } } },
  { name: 'mix-valid', experiment: { experimentId: 'order-mix', change: { value: mixOk, basis }, overlay: small } },
  { name: 'mix-unknown-line', experiment: { experimentId: 'order-mix', change: { value: [{ modelLine: 'No such line', weight: 1 }], basis }, overlay: small } },
  { name: 'mix-zero-weight', experiment: { experimentId: 'order-mix', change: { value: [{ modelLine: 'G20 Saloon|320i', weight: 0 }], basis }, overlay: small } },
  { name: 'mix-not-list', experiment: { experimentId: 'order-mix', change: { value: 'all', basis }, overlay: small } },
  { name: 'mix-overlay-touches-key', experiment: { experimentId: 'order-mix', change: { value: mixOk, basis }, overlay: { ...small, 'comparison.modelLineMix': mixOk } } },
  { name: 'unknown-experiment', experiment: { experimentId: 'unknown-experiment' } },
  { name: 'process-extra-key', experiment: { experimentId: 'process-only', mix: {} } },
  { name: 'process-with-change', experiment: { experimentId: 'process-only', change: { value: 1, basis } } },
  { name: 'missing-change', experiment: { experimentId: 'order-mix' } },
  { name: 'change-extra-key', experiment: { experimentId: 'points', change: { value: 2, basis, why: 1 }, overlay: small } },
  { name: 'missing-basis', experiment: { experimentId: 'points', change: { value: 2 }, overlay: small } },
  { name: 'blank-basis', experiment: { experimentId: 'points', change: { value: 2, basis: ' ' }, overlay: small } },
  { name: 'seeds-duplicate', experiment: { experimentId: 'process-only', seeds: ['a', 'a'] } },
  { name: 'seeds-empty', experiment: { experimentId: 'process-only', seeds: [] } },
  { name: 'seeds-not-list', experiment: { experimentId: 'process-only', seeds: 'a' } },
  { name: 'overlay-not-object', experiment: { experimentId: 'process-only', overlay: [] } },
  { name: 'bad-first-seed', experiment: { experimentId: 'points', seeds: [''], change: { value: 2, basis }, overlay: small } },
  { name: 'not-an-object', experiment: [] },
];
const preparation = [];
for (const entry of experiments) {
  preparation.push({ ...entry, expected: await attemptAsync(async () => plain(await validateExperiment(entry.experiment, { policy, now: () => NOW }))) });
}

// (d) two full small runs through the real Node replay. Records are pooled (records, assumptions) and referenced by index.
const runSeeds = ['parity-a', 'parity-b'];
const recordPool = [];
const assumptionPool = [];
const poolIndex = (pool, value) => {
  const text = JSON.stringify(value);
  let at = pool.findIndex((item) => JSON.stringify(item) === text);
  if (at < 0) at = pool.push(value) - 1;
  return at;
};
const runs = [];
for (const [name, experiment] of [
  ['process-only', { experimentId: 'process-only', seeds: runSeeds, overlay: small }],
  ['hold-sweep', { experimentId: 'hold-sweep', seeds: runSeeds, overlay: small, change: { values: [900, 86400], basis } }],
]) {
  const records = [];
  const progress = [];
  const result = await runComparison(experiment, { policy, codeRevision: 'parity', now: () => NOW,
    onRecord: (record, { armId }) => {
      const { assumptions, ...rest } = plain(record);
      records.push({ armId, seed: record.seed, route: record.route,
        record: poolIndex(recordPool, { ...rest, assumptions: assumptions.map((row) => poolIndex(assumptionPool, row)) }) });
    },
    onProgress: (step) => progress.push(plain(step)) });
  runs.push({ name, experiment, records, progress, resultDigest: inputDigest(result), result: plain(result) });
}
// The full results stay out of the file; the digest and the arm and effect counts are the evidence.
for (const run of runs) run.result = { kind: run.result.kind, arms: run.result.arms?.length ?? 0, effects: run.result.effects?.length ?? 0 };

const golden = { now: NOW, measures, comparisons, requests, refusals, preparation, recordPool, assumptionPool, runs };
const lines = Object.entries(golden).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `{\n${lines.join(',\n')}\n}\n`);
console.log(`wrote ${outPath}`);
