// Offline generator for src/test/resources/policy-parity/publish-cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/publish-parity.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChangeSet, preparePublication, POLICY_TABLES } from '../../../../../server/gcsp/policy/publish.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(await readFile(join(here, '../../../../../server/gcsp/policy/seed-v1.json'), 'utf8'));
const outPath = join(here, '../resources/policy-parity/publish-cases.json');
const NOW = '2026-11-05T09:00:00.000Z';
const NEXT = '2026-11-05T10:00:00.000Z';
const PUBLISHER = 'demo-greg';
const V1 = seed.policyVersion;
const HOLD = 'hold.cart.durationSeconds';
const prov = { basis: 'Parity input.', source: 'publish-parity.mjs', sourceDate: '2026-11-05', status: 'assumed' };
const change = (table, key, patch) => ({ table, key, patch: { ...prov, ...patch } });
const input = (overrides = {}) => ({ commandId: 'cmd-1', expectedActiveVersion: V1, policyVersion: 'parity-v2', effectiveFrom: NEXT,
  changes: [change('assumptions', HOLD, { value: 180 })], ...overrides });
const price = seed.pricePlans[0];
const reco = seed.assumptions.find((row) => row.key === 'employee.recommendation.v1');
const weights = Object.fromEntries(Object.keys(reco.value.preferences).map((key) => [key, 1]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const PROTECTED = ['key', 'policyVersion', 'effectiveFrom', 'effectiveTo', 'linkId', 'ruleId', 'pricePlanId', 'priceEntryId', 'allowanceId'];

const validate = [];
const addValidate = (name, value) => validate.push({ name, input: value, expected: validateChangeSet(value) });
addValidate('valid', input());
for (const [name, value] of [['null', null], ['array', []], ['string', 'x'], ['unknown-key', { ...input(), extra: 1 }],
  ['no-commandId', (({ commandId, ...rest }) => rest)(input())], ['blank-commandId', input({ commandId: '   ' })],
  ['number-commandId', input({ commandId: 7 })], ['long-expectedActiveVersion', input({ expectedActiveVersion: 'x'.repeat(257) })],
  ['256-policyVersion-ok', input({ policyVersion: 'x'.repeat(256) })], ['no-effectiveFrom', (({ effectiveFrom, ...rest }) => rest)(input())],
  ['date-only-effectiveFrom', input({ effectiveFrom: '2026-11-05' })], ['impossible-day', input({ effectiveFrom: '2026-02-30T00:00:00Z' })],
  ['offset-effectiveFrom-ok', input({ effectiveFrom: '2026-11-05T11:00:00+01:00' })],
  ['empty-changes', input({ changes: [] })], ['changes-not-array', input({ changes: {} })],
  ['101-changes', input({ changes: Array.from({ length: 101 }, (_, i) => change('assumptions', `k${i}`, { value: 1 })) })],
  ['100-changes-ok', input({ changes: Array.from({ length: 100 }, (_, i) => change('assumptions', `k${i}`, { value: 1 })) })],
  ['change-null', input({ changes: [null] })], ['change-array', input({ changes: [[]] })],
  ['change-unknown-key', input({ changes: [{ ...change('assumptions', HOLD, { value: 1 }), extra: 1 }] })],
  ['unknown-table', input({ changes: [change('nope', HOLD, { value: 1 })] })],
  ['inherited-table-name', input({ changes: [change('toString', HOLD, { value: 1 })] })],
  ['no-key', input({ changes: [{ table: 'assumptions', patch: { value: 1, ...prov } }] })],
  ['blank-key', input({ changes: [change('assumptions', ' ', { value: 1 })] })],
  ['patch-array', input({ changes: [{ table: 'assumptions', key: HOLD, patch: [] }] })],
  ['empty-patch', input({ changes: [{ table: 'assumptions', key: HOLD, patch: {} }] })],
  ['duplicate-change', input({ changes: [change('assumptions', HOLD, { value: 1 }), change('assumptions', HOLD, { value: 2 })] })],
  ['same-key-other-table-ok', input({ changes: [change('assumptions', HOLD, { value: 1 }), change('allowances', HOLD, { value: 2 })] })],
  ...['basis', 'source', 'sourceDate', 'status'].map((field) => [`no-${field}`, input({ changes: [{ table: 'assumptions', key: HOLD,
    patch: Object.fromEntries(Object.entries({ value: 1, ...prov }).filter(([key]) => key !== field)) }] })]),
  ['blank-status', input({ changes: [change('assumptions', HOLD, { value: 1, status: ' ' })] })]]) addValidate(name, value);

const prepare = [];
const addPrepare = (name, { now = NOW, prior = [], input: value }) => {
  let records = [{ seed: clone(seed), seedDigest: inputDigest(seed), publisher: 'reviewed-repository-seed', publishedAt: seed.effectiveFrom }];
  for (const step of prior) {
    const done = preparePublication(records, { principalId: PUBLISHER }, step.input, step.now ?? NOW);
    if (!done.record) throw new Error(`prior step of ${name} did not publish: ${JSON.stringify(done.outcome)}`);
    records = [...records, done.record];
  }
  const done = preparePublication(records, { principalId: PUBLISHER }, value, now);
  const entry = { name, now, prior, input: value, outcome: done.outcome };
  if (done.record) {
    const next = done.record.seed;
    const touched = new Set(value.changes.map(({ table, key }) => `${table}\u0000${key}`));
    const patched = value.changes.map(({ table, key }) => ({ table, key, row: next[table].find((row) => row.key === key) }));
    const others = Object.fromEntries(Object.keys(POLICY_TABLES).map((table) => [table,
      inputDigest(next[table].filter((row) => !touched.has(`${table}\u0000${row.key}`)))]));
    entry.successor = { policyVersion: next.policyVersion, effectiveFrom: next.effectiveFrom, source: next.source, hasEffectiveTo: 'effectiveTo' in next,
      sourceVersion: done.record.sourceVersion, publisher: done.record.publisher, publishedAt: done.record.publishedAt,
      rowCounts: Object.fromEntries(Object.keys(POLICY_TABLES).map((table) => [table, next[table].length])),
      patched, otherRowsDigest: others, successorDigest: done.record.seedDigest };
  }
  prepare.push(entry);
};
addPrepare('assumption-patch', { input: input() });
addPrepare('price-patch', { input: input({ changes: [change('pricePlans', price.key, { value: 900, monthlyPoints: 900 })] }) });
addPrepare('allowance-patch', { input: input({ changes: [change('allowances', seed.allowances[0].key, { value: 1100, monthlyPoints: 1100 })] }) });
addPrepare('price-and-assumption', { input: input({ changes: [change('pricePlans', price.key, { value: 900, monthlyPoints: 900 }), change('assumptions', HOLD, { value: 90 })] }) });
addPrepare('preference-weight-adoption', { input: input({ changes: [change('assumptions', 'employee.recommendation.v1', { value: { ...clone(reco.value), preferenceWeights: weights } })] }) });
addPrepare('adoption-extra-weight', { input: input({ changes: [change('assumptions', 'employee.recommendation.v1', { value: { ...clone(reco.value), preferenceWeights: { ...weights, extra: 1 } } })] }) });
addPrepare('adoption-negative-weight', { input: input({ changes: [change('assumptions', 'employee.recommendation.v1', { value: { ...clone(reco.value), preferenceWeights: { ...weights, body: -1 } } })] }) });
addPrepare('adoption-fractional-weight', { input: input({ changes: [change('assumptions', 'employee.recommendation.v1', { value: { ...clone(reco.value), preferenceWeights: { ...weights, body: 1.5 } } })] }) });
addPrepare('adoption-changes-retained', { input: input({ changes: [change('assumptions', 'employee.recommendation.v1', { value: { ...clone(reco.value), displayLimit: 4, preferenceWeights: weights } })] }) });
addPrepare('adoption-on-other-key', { input: input({ changes: [change('assumptions', HOLD, { value: { preferenceWeights: weights } })] }) });
addPrepare('effective-at-now', { input: input({ effectiveFrom: NOW }) });
addPrepare('effective-past', { input: input({ effectiveFrom: '2026-11-05T08:59:59.999Z' }) });
addPrepare('effective-equals-base', { now: '2026-11-04T00:00:00.000Z', input: input({ effectiveFrom: seed.effectiveFrom }) });
addPrepare('effective-before-base', { now: '2026-11-03T00:00:00.000Z', input: input({ effectiveFrom: '2026-11-03T12:00:00.000Z' }) });
addPrepare('stale-expected', { input: input({ expectedActiveVersion: 'old' }) });
addPrepare('stale-before-first-version', { now: '2026-11-03T00:00:00.000Z', input: input({ effectiveFrom: '2026-11-03T12:00:00.000Z' }) });
addPrepare('version-taken', { input: input({ policyVersion: V1 }) });
addPrepare('protected-key', { input: input({ changes: [change('assumptions', HOLD, { key: 'other', value: 1 })] }) });
for (const field of PROTECTED.filter((name) => name !== 'key')) addPrepare(`protected-${field}`, { input: input({ changes: [change('assumptions', HOLD, { [field]: 'x', value: 1 })] }) });
addPrepare('unknown-row', { input: input({ changes: [change('assumptions', 'no.such.key', { value: 1 })] }) });
addPrepare('unknown-field', { input: input({ changes: [change('assumptions', HOLD, { invented: 1, value: 1 })] }) });
addPrepare('value-string-for-number', { input: input({ changes: [change('assumptions', HOLD, { value: '180' })] }) });
addPrepare('value-negative', { input: input({ changes: [change('assumptions', HOLD, { value: -1 })] }) });
addPrepare('value-fractional-for-integer', { input: input({ changes: [change('assumptions', HOLD, { value: 180.5 })] }) });
addPrepare('value-huge-for-integer', { input: input({ changes: [change('assumptions', HOLD, { value: 1e300 })] }) });
addPrepare('value-null', { input: input({ changes: [change('assumptions', HOLD, { value: null })] }) });
addPrepare('value-fractional-for-fractional', { input: input({ changes: [change('assumptions', seed.assumptions.find((row) => typeof row.value === 'number' && !Number.isInteger(row.value)).key, { value: 0.5 })] }) });
addPrepare('value-object-for-number', { input: input({ changes: [change('assumptions', HOLD, { value: { a: 1 } })] }) });
const objectRow = seed.assumptions.find((row) => row.key === 'eligibility.rule.matchField');
addPrepare('value-string-for-string', { input: input({ changes: [change('assumptions', objectRow.key, { value: 'otherField' })] }) });
const shaped = seed.assumptions.find((row) => row.value && typeof row.value === 'object' && !Array.isArray(row.value) && Object.keys(row.value).length > 1
  && Object.values(row.value).every((entry) => typeof entry === 'number'));
if (shaped) {
  addPrepare('object-same-shape', { input: input({ changes: [change('assumptions', shaped.key, { value: Object.fromEntries(Object.keys(shaped.value).map((key) => [key, 1])) })] }) });
  addPrepare('object-missing-key', { input: input({ changes: [change('assumptions', shaped.key, { value: Object.fromEntries(Object.keys(shaped.value).slice(1).map((key) => [key, 1])) })] }) });
  addPrepare('object-extra-key', { input: input({ changes: [change('assumptions', shaped.key, { value: { ...shaped.value, extra: 1 } })] }) });
}
const arrayRow = seed.assumptions.find((row) => Array.isArray(row.value) && row.key !== 'eligibility.context.mapping' && row.value.every((entry) => typeof entry === 'string'));
if (arrayRow) {
  addPrepare('array-of-known-type', { input: input({ changes: [change('assumptions', arrayRow.key, { value: [...arrayRow.value].reverse() })] }) });
  addPrepare('array-wrong-element-type', { input: input({ changes: [change('assumptions', arrayRow.key, { value: [1] })] }) });
  addPrepare('array-empty', { input: input({ changes: [change('assumptions', arrayRow.key, { value: [] })] }) });
}
addPrepare('snapshot-price-value-only', { input: input({ changes: [change('pricePlans', price.key, { value: 900 })] }) });
addPrepare('snapshot-allowance-value-only', { input: input({ changes: [change('allowances', seed.allowances[0].key, { monthlyPoints: 5 })] }) });
addPrepare('snapshot-status-invalid', { input: input({ changes: [change('assumptions', HOLD, { value: 1, status: 'guessed' })] }) });
addPrepare('snapshot-source-date-invalid', { input: input({ changes: [change('assumptions', HOLD, { value: 1, sourceDate: '2026-02-30' })] }) });
addPrepare('second-publication-appends', { prior: [{ input: input() }],
  input: input({ commandId: 'cmd-2', policyVersion: 'parity-v3', effectiveFrom: '2026-11-05T11:00:00.000Z', changes: [change('assumptions', 'hold.cart.orderReview.durationSeconds', { value: 900 })] }) });
addPrepare('second-publication-not-later', { prior: [{ input: input() }], input: input({ commandId: 'cmd-2', policyVersion: 'parity-v3' }) });
addPrepare('second-publication-before-first', { prior: [{ input: input() }],
  input: input({ commandId: 'cmd-2', policyVersion: 'parity-v3', effectiveFrom: '2026-11-05T09:30:00.000Z' }) });
addPrepare('second-publication-stale-expected-scheduled', { prior: [{ input: input() }],
  input: input({ commandId: 'cmd-2', policyVersion: 'parity-v3', effectiveFrom: '2026-11-05T11:00:00.000Z', expectedActiveVersion: 'parity-v2' }) });
addPrepare('after-first-effective', { now: '2026-11-05T10:30:00.000Z', prior: [{ input: input() }],
  input: input({ commandId: 'cmd-2', policyVersion: 'parity-v3', expectedActiveVersion: 'parity-v2', effectiveFrom: '2026-11-05T11:00:00.000Z' }) });

const text = `${JSON.stringify({ now: NOW, publisher: PUBLISHER, validate, prepare })}\n`;
await writeFile(outPath, text);
console.log(`${validate.length} validate + ${prepare.length} prepare cases, ${text.length} bytes`);
