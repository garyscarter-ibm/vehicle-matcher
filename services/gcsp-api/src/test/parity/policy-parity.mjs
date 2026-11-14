// Offline generator for src/test/resources/policy-parity/cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/policy-parity.mjs
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, '../../../../../server/gcsp/policy/seed-v1.json');
const outPath = join(here, '../resources/policy-parity/cases.json');
const RUN = 'policy-parity-run';
const T0 = '2026-11-04T12:00:00.000Z';
const TABLES = ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions'];
const clone = (value) => JSON.parse(JSON.stringify(value));
const seed = JSON.parse(await readFile(seedPath, 'utf8'));
const mapping = seed.assumptions.find((row) => row.key === 'eligibility.context.mapping').value;

// Named source variants. Each returns file contents: the first is the main file, the rest are retained files.
const revise = (value, policyVersion, effectiveFrom) => {
  value.policyVersion = policyVersion;
  value.effectiveFrom = effectiveFrom;
  for (const table of TABLES) for (const row of value[table]) row.policyVersion = policyVersion;
  return value;
};
const assumption = (value, key) => value.assumptions.find((row) => row.key === key);
const variants = {
  seed: () => [JSON.stringify(seed)],
  change: () => {
    const original = clone(seed);
    original.effectiveTo = '2026-11-05T00:00:00Z';
    const changed = revise(clone(seed), 'alternative-v2', '2026-11-05T00:00:00Z');
    assumption(changed, 'hold.cart.durationSeconds').value += 47;
    return [JSON.stringify(changed), JSON.stringify(original)];
  },
  'price-ambiguous': () => {
    const value = clone(seed);
    const extra = clone(value.pricePlans[0]);
    Object.assign(extra, { key: 'price.parity.config', priceEntryId: 'price.parity.config', configurationId: 'parity-cfg-1' });
    delete extra.matchField; delete extra.matchValue;
    value.pricePlans.push(extra);
    return [JSON.stringify(value)];
  },
  'exclude-overlap': () => {
    const value = clone(seed);
    const rule = clone(value.eligibilityRules[0]);
    const link = clone(value.schemeRuleLinks.find((row) => row.ruleId === rule.ruleId));
    Object.assign(rule, { key: 'parity-exclude-001', ruleId: 'parity-exclude-001', effect: 'exclude' });
    Object.assign(link, { key: 'parity-link-exclude-001', linkId: 'parity-link-exclude-001', ruleId: rule.ruleId, value: rule.ruleId });
    value.eligibilityRules.push(rule); value.schemeRuleLinks.push(link);
    return [JSON.stringify(value)];
  },
  'bad-field': () => { const value = clone(seed); assumption(value, 'eligibility.rule.matchField').value = 'otherField'; return [JSON.stringify(value)]; },
  'bad-precedence': () => { const value = clone(seed); assumption(value, 'eligibility.rule.precedence').value = 'includeThenExclude'; return [JSON.stringify(value)]; },
  'no-field': () => { const value = clone(seed); value.assumptions = value.assumptions.filter((row) => row.key !== 'eligibility.rule.matchField'); return [JSON.stringify(value)]; },
  'expiring-row': () => { const value = clone(seed); assumption(value, 'hold.cart.durationSeconds').effectiveTo = '2026-11-10T00:00:00Z'; return [JSON.stringify(value)]; },
  'expiring-rule': () => {
    const value = clone(seed);
    value.eligibilityRules[0].effectiveTo = '2026-11-10T00:00:00Z';
    for (const link of value.schemeRuleLinks) if (link.ruleId === value.eligibilityRules[0].ruleId) link.effectiveTo = '2026-11-10T00:00:00Z';
    return [JSON.stringify(value)];
  },
  'invalid-row': () => { const value = clone(seed); value.allowances[0].unit = 'bogus'; return [JSON.stringify(value)]; },
  malformed: () => ['not json'],
  'duplicate-key': () => ['{"schemaVersion":1,"schemaVersion":1}'],
  'missing-file': () => [null],
};

// Single-defect mutations: each must be refused as source-invalid (or accepted) exactly as Node does.
const first0 = (value, table) => value[table][0];
const mutations = {
  'schema-2': (v) => { v.schemaVersion = 2; },
  'blank-source': (v) => { v.source = '  '; },
  'row-wrong-version': (v) => { v.allowances[0].policyVersion = 'other'; },
  'row-bad-status': (v) => { v.pricePlans[0].status = 'guessed'; },
  'row-bad-sourceDate': (v) => { v.pricePlans[0].sourceDate = '2026-02-30'; },
  'row-effectiveTo-before-from': (v) => { v.allowances[0].effectiveTo = '2026-11-03T00:00:00Z'; },
  'row-effectiveTo-equal-from': (v) => { v.allowances[0].effectiveTo = v.allowances[0].effectiveFrom; },
  'row-bad-effectiveFrom': (v) => { v.allowances[0].effectiveFrom = '2026-11-04'; },
  'row-duplicate-key': (v) => { v.allowances[1].key = v.allowances[0].key; },
  'row-null-value': (v) => { v.assumptions[0].value = null; },
  'row-missing-value': (v) => { delete v.assumptions[0].value; },
  'allowance-overlap': (v) => { const a = clone(v.allowances[0]); a.key = 'dup.key'; a.allowanceId = 'dup-id'; v.allowances.push(a); },
  'allowance-adjacent-ok': (v) => { v.allowances[0].effectiveTo = '2026-12-01T00:00:00Z'; const a = clone(v.allowances[0]); a.key = 'dup.key'; a.allowanceId = 'dup-id'; a.effectiveFrom = '2026-12-01T00:00:00Z'; delete a.effectiveTo; v.allowances.push(a); },
  'allowance-points-mismatch': (v) => { v.allowances[0].value += 1; },
  'allowance-negative': (v) => { v.allowances[0].monthlyPoints = -1; v.allowances[0].value = -1; },
  'allowance-bad-grade': (v) => { v.allowances[0].gradeId = 'nope'; },
  'allowance-bad-company': (v) => { v.allowances[0].companyId = 'nope'; },
  'allowance-bad-unit': (v) => { v.allowances[0].unit = 'points'; },
  'price-both-forms': (v) => { v.pricePlans[0].configurationId = 'cfg'; },
  'price-neither-form': (v) => { delete v.pricePlans[0].matchField; delete v.pricePlans[0].matchValue; },
  'price-bad-scheme': (v) => { v.pricePlans[0].schemeId = 'nope'; },
  'price-duplicate-entry': (v) => { v.pricePlans[1].pricePlanId = v.pricePlans[0].pricePlanId; v.pricePlans[1].priceEntryId = v.pricePlans[0].priceEntryId; },
  'price-overlap': (v) => { const p = clone(v.pricePlans[0]); p.key = 'dup.price'; p.priceEntryId = 'dup-entry'; v.pricePlans.push(p); },
  'rule-bad-effect': (v) => { v.eligibilityRules[0].effect = 'maybe'; },
  'rule-bad-operator': (v) => { v.eligibilityRules[0].operator = 'contains'; },
  'rule-empty-grades': (v) => { v.eligibilityRules[0].gradeIds = []; },
  'rule-duplicate-grade': (v) => { v.eligibilityRules[0].gradeIds.push(v.eligibilityRules[0].gradeIds[0]); },
  'rule-duplicate-id': (v) => { v.eligibilityRules[1].ruleId = v.eligibilityRules[0].ruleId; },
  'rule-without-link': (v) => { const r = clone(v.eligibilityRules[0]); r.key = 'orphan'; r.ruleId = 'orphan'; v.eligibilityRules.push(r); },
  'rule-grade-outside-scheme': (v) => { v.eligibilityRules[0].gradeIds.push('nope'); },
  'link-unknown-rule': (v) => { v.schemeRuleLinks[0].ruleId = 'nope'; v.schemeRuleLinks[0].value = 'nope'; },
  'link-value-mismatch': (v) => { v.schemeRuleLinks[0].value = 'nope'; },
  'link-source-mismatch': (v) => { v.schemeRuleLinks[0].source = 'elsewhere'; },
  'link-status-mismatch': (v) => { v.schemeRuleLinks[0].status = 'assumed'; },
  'link-duplicate-id': (v) => { v.schemeRuleLinks[1].linkId = v.schemeRuleLinks[0].linkId; },
  'link-overlap': (v) => { const l = clone(v.schemeRuleLinks[0]); l.key = 'dup.link'; l.linkId = 'dup-link'; v.schemeRuleLinks.push(l); },
  'mapping-missing': (v) => { v.assumptions = v.assumptions.filter((r) => r.key !== 'eligibility.context.mapping'); },
  'mapping-empty': (v) => { assumption(v, 'eligibility.context.mapping').value = []; },
  'mapping-duplicate-scheme': (v) => { const m = assumption(v, 'eligibility.context.mapping'); m.value.push(clone(m.value[0])); },
  'mapping-no-grades': (v) => { assumption(v, 'eligibility.context.mapping').value[0].gradeIds = []; },
  'mapping-missing-matrix': (v) => { delete assumption(v, 'eligibility.context.mapping').value[0].sourceMatrix; },
  'table-missing': (v) => { delete v.pricePlans; },
  'table-not-array': (v) => { v.allowances = {}; },
  'future-effective': (v) => { v.effectiveFrom = '2027-01-01T00:00:00Z'; },
  'version-effectiveTo': (v) => { v.effectiveTo = '2026-11-10T00:00:00Z'; },
};
for (const name of Object.keys(mutations)) variants[`mut/${name}`] = () => { const v = clone(seed); mutations[name](v); return [JSON.stringify(v)]; };
variants['dup-effectiveFrom'] = () => { const other = revise(clone(seed), 'other-v2', seed.effectiveFrom); return [JSON.stringify(seed), JSON.stringify(other)]; };
variants['dup-version-name'] = () => { const other = clone(seed); other.effectiveFrom = '2027-01-01T00:00:00Z'; return [JSON.stringify(seed), JSON.stringify(other)]; };
variants['second-bad'] = () => { const other = revise(clone(seed), 'other-v2', '2027-01-01T00:00:00Z'); other.allowances[0].unit = 'x'; return [JSON.stringify(seed), JSON.stringify(other)]; };

const scratch = await mkdtemp(join(tmpdir(), 'gcsp-policy-parity-'));
const services = new Map();
async function service(name) {
  if (services.has(name)) return services.get(name);
  const files = variants[name]();
  const paths = [];
  for (const [index, contents] of files.entries()) {
    const path = join(scratch, `${name.replaceAll('/', '_')}-${index}.json`);
    if (contents !== null) await writeFile(path, contents);
    paths.push(path);
  }
  const created = createPolicyService({ filePath: paths[0], retainedFilePaths: paths.slice(1) });
  services.set(name, created);
  return created;
}

const cases = [];
const names = new Set();
async function add(name, method, args) {
  if (names.has(name)) throw new Error(`duplicate case ${name}`);
  names.add(name);
  const full = { source: 'seed', ...args };
  const policy = await service(full.source);
  const readArg = full.read === undefined ? { runId: RUN, asOf: T0 } : full.read;
  let result;
  if (method === 'getActiveVersion') result = await policy.getActiveVersion(readArg);
  else if (method === 'getAssumption') result = await policy.getAssumption(full.key, readArg);
  else if (method === 'getAllowance') result = await policy.getAllowance(full.context, readArg);
  else if (method === 'getPointsCost') result = await policy.getPointsCost(full.context, full.car, readArg);
  else result = await policy.getEligibility(full.context, full.car, readArg);
  cases.push({ name, method, args: { ...full, read: readArg }, expected: JSON.parse(JSON.stringify(result)) });
}
const ctx = (scheme, gradeId, extra = {}) => ({ runId: RUN, companyId: scheme.companyId, schemeId: scheme.schemeId, gradeId, ...extra });
const first = mapping[0];

// Version discovery, pins and invalid reads.
await add('active/default', 'getActiveVersion', {});
await add('active/pinned', 'getActiveVersion', { read: { runId: RUN, asOf: T0, policyVersion: seed.policyVersion } });
await add('active/pinned-missing', 'getActiveVersion', { read: { runId: RUN, asOf: T0, policyVersion: 'nope-v9' } });
await add('active/before-first-version', 'getActiveVersion', { read: { runId: RUN, asOf: '2026-11-03T23:59:59.999Z' } });
await add('active/at-first-version', 'getActiveVersion', { read: { runId: RUN, asOf: '2026-11-04T00:00:00Z' } });
await add('active/offset-instant', 'getActiveVersion', { read: { runId: RUN, asOf: '2026-11-04T01:00:00+01:00' } });
await add('active/offset-before', 'getActiveVersion', { read: { runId: RUN, asOf: '2026-11-04T00:59:59.9+01:00' } });
await add('active/fraction-one-digit', 'getActiveVersion', { read: { runId: RUN, asOf: '2026-11-04T00:00:00.5Z' } });
const invalidReads = {
  'missing-runId': { asOf: T0 }, 'blank-runId': { runId: '  ', asOf: T0 }, 'missing-asOf': { runId: RUN },
  'feb-30': { runId: RUN, asOf: '2026-02-30T00:00:00Z' }, 'hour-24': { runId: RUN, asOf: '2026-11-04T24:00:00Z' },
  'minute-60': { runId: RUN, asOf: '2026-11-04T12:60:00Z' }, 'second-60': { runId: RUN, asOf: '2026-11-04T12:00:60Z' },
  'no-zone': { runId: RUN, asOf: '2026-11-04T12:00:00' }, 'date-only': { runId: RUN, asOf: '2026-11-04' },
  'four-fraction': { runId: RUN, asOf: '2026-11-04T12:00:00.1234Z' }, 'offset-24': { runId: RUN, asOf: '2026-11-04T12:00:00+24:00' },
  'offset-minute-60': { runId: RUN, asOf: '2026-11-04T12:00:00+01:60' }, 'blank-pin': { runId: RUN, asOf: T0, policyVersion: '' },
  'space-pin': { runId: RUN, asOf: T0, policyVersion: '   ' }, 'null-read': null, 'leap-day-2025': { runId: RUN, asOf: '2025-02-29T00:00:00Z' },
};
for (const [name, read] of Object.entries(invalidReads)) await add(`invalid-read/${name}`, 'getActiveVersion', { read });
await add('invalid-read/leap-day-2028-ok', 'getActiveVersion', { read: { runId: RUN, asOf: '2028-02-29T00:00:00Z' } });

// Assumptions: every key and an unknown key.
for (const row of seed.assumptions) await add(`assumption/${row.key}`, 'getAssumption', { key: row.key });
await add('assumption/unknown', 'getAssumption', { key: 'no.such.key' });
await add('assumption/pinned', 'getAssumption', { key: 'hold.cart.durationSeconds', read: { runId: RUN, asOf: '2030-01-01T00:00:00Z', policyVersion: seed.policyVersion } });

// Allowances: every mapped scheme and grade, plus context failures.
for (const scheme of mapping) for (const grade of scheme.gradeIds) await add(`allowance/${scheme.schemeId}/${grade}`, 'getAllowance', { context: ctx(scheme, grade) });
const contextFailures = {
  'unknown-scheme': { ...ctx(first, first.gradeIds[0]), schemeId: 'no-scheme' },
  'unknown-company': { ...ctx(first, first.gradeIds[0]), companyId: 'no-company' },
  'unknown-grade': { ...ctx(first, first.gradeIds[0]), gradeId: 'no-grade' },
  'other-scheme-company': { ...ctx(first, first.gradeIds[0]), companyId: mapping[1].companyId },
  'run-mismatch': ctx(first, first.gradeIds[0], { runId: 'another-run' }),
  'run-absent': { companyId: first.companyId, schemeId: first.schemeId, gradeId: first.gradeIds[0] },
  'missing-grade': { runId: RUN, companyId: first.companyId, schemeId: first.schemeId },
  'missing-scheme': { runId: RUN, companyId: first.companyId, gradeId: first.gradeIds[0] },
  'null-context': null, 'empty-context': {},
};
for (const [name, context] of Object.entries(contextFailures)) {
  await add(`allowance/context/${name}`, 'getAllowance', { context });
  await add(`points/context/${name}`, 'getPointsCost', { context, car: { eligibilityModelKey: seed.pricePlans[0].matchValue } });
  await add(`eligibility/context/${name}`, 'getEligibility', { context, car: { eligibilityModelKey: 'G20 Saloon|320i' } });
}
await add('allowance/invalid-source-read', 'getAllowance', { context: ctx(first, first.gradeIds[0]), read: { runId: '', asOf: T0 } });

// Points cost: every price plan under its scheme, plus misses.
const schemeOf = (id) => mapping.find((row) => row.schemeId === id);
for (const price of seed.pricePlans) {
  const scheme = schemeOf(price.schemeId);
  await add(`points/${price.priceEntryId}`, 'getPointsCost', { context: ctx(scheme, scheme.gradeIds[0]), car: { [price.matchField]: price.matchValue } });
}
const p0 = seed.pricePlans[0]; const s0 = schemeOf(p0.schemeId);
const otherScheme = mapping.find((row) => row.schemeId !== p0.schemeId);
await add('points/missing-car', 'getPointsCost', { context: ctx(s0, s0.gradeIds[0]), car: null });
await add('points/empty-car', 'getPointsCost', { context: ctx(s0, s0.gradeIds[0]), car: {} });
await add('points/unmapped-value', 'getPointsCost', { context: ctx(s0, s0.gradeIds[0]), car: { [p0.matchField]: 'No Such|Model' } });
await add('points/value-of-other-scheme', 'getPointsCost', { context: ctx(otherScheme, otherScheme.gradeIds[0]), car: { [p0.matchField]: p0.matchValue } });
await add('points/non-text-fact', 'getPointsCost', { context: ctx(s0, s0.gradeIds[0]), car: { [p0.matchField]: 5 } });
await add('points/ambiguous', 'getPointsCost', { source: 'price-ambiguous', context: ctx(s0, s0.gradeIds[0]), car: { [p0.matchField]: p0.matchValue, configurationId: 'parity-cfg-1' } });
await add('points/ambiguous-config-only', 'getPointsCost', { source: 'price-ambiguous', context: ctx(s0, s0.gradeIds[0]), car: { configurationId: 'parity-cfg-1' } });
await add('points/ambiguous-fact-only', 'getPointsCost', { source: 'price-ambiguous', context: ctx(s0, s0.gradeIds[0]), car: { [p0.matchField]: p0.matchValue } });

// Eligibility: every distinct rule value per grade of its scheme, thinned deterministically to keep the file small.
const ruleById = new Map(seed.eligibilityRules.map((rule) => [rule.ruleId, rule]));
const cells = new Set();
for (const link of seed.schemeRuleLinks) {
  const scheme = schemeOf(link.schemeId);
  for (const grade of scheme.gradeIds) cells.add(JSON.stringify([link.schemeId, grade, ruleById.get(link.ruleId).value]));
}
const ordered = [...cells].map((cell) => JSON.parse(cell)).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
for (const [index, [schemeId, grade, model]] of ordered.entries()) {
  if (index % 2 === 1) continue;
  const scheme = schemeOf(schemeId);
  await add(`eligibility/${schemeId}/${grade}/${model}`, 'getEligibility', { context: ctx(scheme, grade), car: { eligibilityModelKey: model } });
}
const r0 = seed.eligibilityRules[0]; const rs = schemeOf(seed.schemeRuleLinks.find((link) => link.ruleId === r0.ruleId).schemeId);
const elig = (name, car, extra = {}) => add(`eligibility/${name}`, 'getEligibility', { context: ctx(rs, r0.gradeIds[0]), car, ...extra });
await elig('missing-car', null);
await elig('empty-car', {});
await elig('blank-fact', { eligibilityModelKey: '  ' });
await elig('non-text-fact', { eligibilityModelKey: 5 });
await elig('unknown-model', { eligibilityModelKey: 'No Such|Model' });
await add('eligibility/grade-outside-rule', 'getEligibility', { context: ctx(rs, rs.gradeIds.find((grade) => !r0.gradeIds.includes(grade)) ?? rs.gradeIds.at(-1)), car: { eligibilityModelKey: r0.value } });
for (const grade of r0.gradeIds) {
  await add(`eligibility/exclude-overlap/${grade}`, 'getEligibility', { source: 'exclude-overlap', context: ctx(rs, grade), car: { eligibilityModelKey: r0.value } });
}
await add('eligibility/bad-field', 'getEligibility', { source: 'bad-field', context: ctx(rs, r0.gradeIds[0]), car: { eligibilityModelKey: r0.value } });
await add('eligibility/bad-precedence', 'getEligibility', { source: 'bad-precedence', context: ctx(rs, r0.gradeIds[0]), car: { eligibilityModelKey: r0.value } });
await add('eligibility/no-field', 'getEligibility', { source: 'no-field', context: ctx(rs, r0.gradeIds[0]), car: { eligibilityModelKey: r0.value } });
await add('assumption/bad-field-value', 'getAssumption', { source: 'bad-field', key: 'eligibility.rule.matchField' });
for (const [label, asOf, policyVersion] of [['before-expiry', '2026-11-09T23:59:59.999Z'], ['at-expiry', '2026-11-10T00:00:00Z'], ['after-expiry', '2026-12-01T00:00:00Z'],
  ['pinned-after-expiry', '2026-12-01T00:00:00Z', seed.policyVersion]]) {
  const read = { runId: RUN, asOf, ...(policyVersion ? { policyVersion } : {}) };
  await add(`eligibility/expiring-rule/${label}`, 'getEligibility', { source: 'expiring-rule', read, context: ctx(rs, r0.gradeIds[0]), car: { eligibilityModelKey: r0.value } });
  await add(`assumption/expiring-row/${label}`, 'getAssumption', { source: 'expiring-row', read, key: 'hold.cart.durationSeconds' });
}

// Source errors.
for (const name of ['malformed', 'duplicate-key', 'invalid-row', 'missing-file']) {
  await add(`source/${name}/active`, 'getActiveVersion', { source: name });
  await add(`source/${name}/allowance`, 'getAllowance', { source: name, context: ctx(first, first.gradeIds[0]) });
}
await add('source/invalid-read-wins-over-source', 'getActiveVersion', { source: 'malformed', read: { runId: '', asOf: T0 } });

// Change one canonical entry: new value after the change, old before it and under the original pin.
const at = (asOf, policyVersion) => ({ runId: RUN, asOf, ...(policyVersion ? { policyVersion } : {}) });
for (const [label, read] of [
  ['after', at('2026-11-06T12:00:00Z')], ['at-boundary', at('2026-11-05T00:00:00Z')], ['before', at('2026-11-04T12:00:00Z')],
  ['just-before-boundary', at('2026-11-04T23:59:59.999Z')], ['pinned-original-after', at('2026-11-06T12:00:00Z', seed.policyVersion)],
  ['pinned-alternative-before', at('2026-11-04T12:00:00Z', 'alternative-v2')], ['pinned-missing', at('2026-11-06T12:00:00Z', 'alternative-v3')],
  ['before-everything', at('2026-11-03T00:00:00Z')],
]) {
  await add(`change/${label}/hold`, 'getAssumption', { source: 'change', key: 'hold.cart.durationSeconds', read });
  await add(`change/${label}/active`, 'getActiveVersion', { source: 'change', read });
  await add(`change/${label}/allowance`, 'getAllowance', { source: 'change', read, context: ctx(first, first.gradeIds[1]) });
  await add(`change/${label}/eligibility`, 'getEligibility', { source: 'change', read, context: ctx(first, first.gradeIds[1]), car: { eligibilityModelKey: 'G20 Saloon|320i' } });
}

// Source validation: one defect per variant, then a read that exercises it.
for (const name of [...Object.keys(mutations).map((key) => `mut/${key}`), 'dup-effectiveFrom', 'dup-version-name', 'second-bad']) {
  await add(`validation/${name}`, 'getAllowance', { source: name, context: ctx(first, first.gradeIds[0]) });
}
await add('validation/allowance-adjacent-later', 'getAllowance', { source: 'mut/allowance-adjacent-ok', context: ctx(first, first.gradeIds[0]), read: { runId: RUN, asOf: '2027-01-01T00:00:00Z' } });
await add('validation/future-effective-before', 'getActiveVersion', { source: 'mut/future-effective', read: { runId: RUN, asOf: T0 } });
await add('validation/version-effectiveTo-after', 'getActiveVersion', { source: 'mut/version-effectiveTo', read: { runId: RUN, asOf: '2026-12-01T00:00:00Z' } });
await add('validation/version-effectiveTo-pinned-after', 'getAssumption', { source: 'mut/version-effectiveTo', key: 'hold.cart.durationSeconds', read: { runId: RUN, asOf: '2026-12-01T00:00:00Z', policyVersion: seed.policyVersion } });

await rm(scratch, { recursive: true, force: true });
const text = `${JSON.stringify(cases)}\n`;
await writeFile(outPath, text);
console.log(`${cases.length} cases, ${text.length} bytes`);
