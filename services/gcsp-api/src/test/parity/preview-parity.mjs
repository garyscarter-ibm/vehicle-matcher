// Offline generator for src/test/resources/policy-parity/preview-cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/preview-parity.mjs
// Preview cases drive the real createGregPublishService.preview; the fit count and band expression is copied from
// evaluateFit in server/gcsp/greg/publish/fit.js because it is not exported on its own.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from '../../../../../server/test/helpers/greg-demand-run.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../../../../../server/gcsp/policy/index.js';
import { createGregPublishService } from '../../../../../server/gcsp/greg/publish/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '../resources/policy-parity/preview-cases.json');
const NOW = '2026-11-05T09:00:00.000Z';
const V1 = 'gcsp-policy-v1';

// The same fixture as server/test/gcsp-greg-publish.test.js: seed with neutral preferenceWeights, canonical threshold.
const store = createMemoryPolicyStore();
let policyProvider;
const f = await setup({ canonical: true, policyProvider(source) {
  const calibration = source.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
  calibration.preferenceWeights = Object.fromEntries(Object.keys(calibration.preferences).map((key) => [key, 1]));
  policyProvider = new MemoryPolicyProvider({ store, seedProvider: { async loadVersions() { return [source]; } } });
  return policyProvider;
} });
f.policy = new PolicyService({ provider: policyProvider, identity: f.identity, clock: f.clock });
const snapshot = (await f.policy.getPolicySnapshot({ runId: f.context.runId, asOf: NOW })).value;
const publish = createGregPublishService(f);
const prices = snapshot.pricePlans.slice(0, 2).map((row) => `price:${row.key}`);
const pointsOf = (id) => snapshot.pricePlans.find((row) => `price:${row.key}` === id).monthlyPoints;

const body = (changes, overrides = {}) => ({ expectedActiveVersion: V1, changes, ...overrides });
const edit = (id, value) => body([{ id, value }]);
const text = (value) => JSON.parse(JSON.stringify(value));

const refusals = [];
const addRefusal = async (name, input) => {
  const out = await publish.preview(f.context, input);
  if (out.status === 'ok') throw new Error(`${name} was not refused`);
  refusals.push({ name, input: text(input), expected: text(out) });
};
const cases = [
  ['unknown-field-id', edit('eligibility:any', 0)], ['unknown-weight', edit('weight:unknown', 1)],
  ['negative-weight', edit('weight:body', -1)], ['fractional-weight', edit('weight:body', 0.5)],
  ['unsafe-integer', edit('weight:body', Number.MAX_SAFE_INTEGER + 1)], ['nan-value', edit('weight:body', NaN)],
  ['string-value', edit('weight:body', '2')], ['missing-value', body([{ id: 'weight:body' }])],
  ['no-op-weight', edit('weight:body', 1)], ['no-op-price', edit(prices[0], pointsOf(prices[0]))],
  ['unknown-body-key', { ...edit('weight:body', 2), unknown: true }],
  ['publish-only-key', { ...edit('weight:body', 2), commandId: 'c-1' }],
  ['empty-changes', body([])], ['changes-not-array', body({})], ['missing-changes', { expectedActiveVersion: V1 }],
  ['101-changes', body(Array.from({ length: 101 }, (_, i) => ({ id: `weight:w${i}`, value: 1 })))],
  ['duplicate-id', body([{ id: 'weight:body', value: 2 }, { id: 'weight:body', value: 3 }])],
  ['change-extra-key', body([{ id: 'weight:body', value: 2, path: 'essentials' }])],
  ['change-null', body([null])], ['missing-expected', { changes: [{ id: 'weight:body', value: 2 }] }],
  ['long-expected', body([{ id: 'weight:body', value: 2 }], { expectedActiveVersion: 'x'.repeat(257) })],
  ['stale-expected', body([{ id: 'weight:body', value: 2 }], { expectedActiveVersion: 'other' })],
  ['stale-with-invalid-change', body([{ id: 'weight:unknown', value: 2 }], { expectedActiveVersion: 'other' })],
];
for (const [name, input] of cases) await addRefusal(name, input);

const successes = [];
const addSuccess = async (name, input) => {
  const out = await publish.preview(f.context, input);
  if (out.status !== 'ok') throw new Error(`${name} failed: ${JSON.stringify(out)}`);
  const { draftVersion, activeVersion, differences } = out.value;
  successes.push({ name, input: text(input), expected: text({ activeVersion, draftVersion, differences }) });
};
await addSuccess('one-price', edit(prices[0], pointsOf(prices[0]) + 100));
await addSuccess('one-weight', edit('weight:body', 3));
await addSuccess('zero-weight', edit('weight:comfort', 0));
await addSuccess('price-and-weight', body([{ id: prices[0], value: pointsOf(prices[0]) + 7 }, { id: 'weight:fuel', value: 4 }]));
await addSuccess('two-prices', body(prices.map((id, i) => ({ id, value: pointsOf(id) + 10 * (i + 1) }))));
await addSuccess('two-weights', body([{ id: 'weight:size', value: 2 }, { id: 'weight:body', value: 5 }]));
await addSuccess('no-op-entry-with-change', body([{ id: 'weight:body', value: 1 }, { id: 'weight:economy', value: 9 }]));
await addSuccess('large-price', edit(prices[1], 9007199254740991));

// The count and band expression of evaluateFit (fit.js), over per-employee results.
const render = ({ eligible, scores, threshold }) => {
  const count = (value) => value < threshold ? { kind: 'band', fewerThan: threshold, label: `fewer than ${threshold}` }
    : { kind: 'exact', value, label: String(value) };
  return { basis: 'saved-brief-recommendation-fit', label: 'Recommendation fit, not predicted acceptance',
    employeesWithEligibleStock: count(eligible), scoredBriefs: count(scores.length),
    meanBestScore: scores.length >= threshold ? { status: 'available', value: scores.reduce((a, b) => a + b, 0) / scores.length, unit: 'score/100' }
      : { status: 'suppressed', fewerThan: threshold, unit: 'score/100' } };
};
const fit = [];
for (const [name, eligible, scores, threshold] of [
  ['none', 0, [], 5], ['none-threshold-1', 0, [], 1], ['below-threshold', 3, [70, 80, 90], 5], ['eligible-no-scores', 6, [], 5],
  ['exactly-threshold', 5, [60, 70, 80, 90, 100], 5], ['above-threshold', 7, [55.5, 61.25, 70, 80.75, 99, 12, 40], 5],
  ['scores-fewer-than-eligible', 8, [50, 60, 70, 80, 90], 5], ['threshold-1-single', 1, [72.5], 1],
  ['threshold-2', 2, [33.3, 66.6], 2], ['mean-not-terminating', 3, [10, 20, 25], 3], ['zero-scores-count', 5, [0, 0, 0, 0, 0], 5]]) {
  fit.push({ name, eligible, scores, threshold, expected: render({ eligible, scores, threshold }) });
}

await f.repository.close();
const out = `${JSON.stringify({ now: NOW, activeVersion: V1, refusals, successes, fit })}\n`;
await writeFile(outPath, out);
console.log(`${refusals.length} refusal + ${successes.length} success + ${fit.length} fit cases, ${out.length} bytes`);
