import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../gcsp/policy/index.js';

const start = '2026-11-04T00:00:00Z';
const change = '2026-11-05T00:00:00Z';
const read = { runId: 'compiled-run', asOf: '2026-11-04T12:00:00Z' };
const context = { runId: read.runId, schemeId: 'scheme-a', companyId: 'company-a', gradeId: 'grade-a' };
const row = (key, value, extra = {}) => ({ key, value, unit: 'rule', status: 'assumed', basis: 'Bounded regression fixture',
  source: 'compiled-fixture', sourceDate: '2026-11-04', policyVersion: 'compiled-v1', effectiveFrom: start, ...extra });
function seed() {
  const rules = [
    row('compiled-rule-include', 'alpha', { ruleId: 'include', effect: 'include', gradeIds: ['grade-a', 'grade-b'] }),
    row('compiled-rule-exclude', 'alpha', { ruleId: 'exclude', effect: 'exclude', gradeIds: ['grade-b'] }),
    row('compiled-rule-beta', 'beta', { ruleId: 'beta', effect: 'include', gradeIds: ['grade-a'] }),
  ].map((rule) => ({ ...rule, matchField: 'model', operator: 'equals' }));
  return { schemaVersion: 1, policyVersion: 'compiled-v1', effectiveFrom: start, source: 'compiled-fixture',
    eligibilityRules: rules,
    schemeRuleLinks: [rules[1], rules[2], rules[0]].map((rule) => row(`compiled-link-${rule.ruleId}`, rule.ruleId,
      { linkId: `link-${rule.ruleId}`, ruleId: rule.ruleId, schemeId: 'scheme-a' })),
    pricePlans: [], allowances: [], assumptions: [
      row('eligibility.context.mapping', [
        { schemeId: 'scheme-a', companyId: 'company-a', gradeIds: ['grade-a', 'grade-b'], sourceMatrix: 'fixture-a' },
        { schemeId: 'scheme-b', companyId: 'company-b', gradeIds: ['grade-a'], sourceMatrix: 'fixture-b' },
      ]),
      row('eligibility.rule.matchField', 'model'), row('eligibility.rule.precedence', 'excludeThenInclude'),
    ] };
}
const policyFor = (...versions) => new PolicyService({ provider: { async loadVersions() { return versions; } } });
const pin = (policyRead = read) => ({ ...policyRead, policyVersion: 'compiled-v1' });
const active = (entry, at) => Date.parse(entry.effectiveFrom) <= at
  && (entry.effectiveTo === undefined || at < Date.parse(entry.effectiveTo));
function expected(seed, ctx, car, policyRead) {
  const at = Date.parse(Object.hasOwn(policyRead, 'policyVersion') ? seed.effectiveFrom : policyRead.asOf);
  const assumptions = seed.assumptions.filter((entry) => active(entry, at));
  const field = assumptions.find(({ key }) => key === 'eligibility.rule.matchField');
  const links = seed.schemeRuleLinks.filter((entry) => active(entry, at) && entry.schemeId === ctx.schemeId);
  const linked = new Set(links.map((entry) => entry.ruleId));
  const fact = car && Object.hasOwn(car, field.value) ? car[field.value] : undefined;
  const valid = typeof fact === 'string' && fact.trim().length > 0;
  const matches = seed.eligibilityRules.filter((entry) => active(entry, at) && linked.has(entry.ruleId)
    && valid && entry.value === fact && entry.gradeIds.includes(ctx.gradeId));
  const excluded = matches.some((entry) => entry.effect === 'exclude');
  const eligible = !excluded && matches.some((entry) => entry.effect === 'include');
  return { status: 'ok', contractVersion: '1.0.0', policyVersion: seed.policyVersion, value: {
    eligible, state: excluded ? 'ineligible' : eligible ? 'eligible' : 'needs-confirmation', ruleIds: matches.map((entry) => entry.ruleId),
    reasons: [excluded ? 'explicit-exclude' : eligible ? 'explicit-include' : valid ? 'no-applicable-include' : 'missing-model-fact'],
    provenance: { rules: matches, schemeRuleLinks: links.filter((link) => matches.some((rule) => rule.ruleId === link.ruleId)),
      assumptions: ['eligibility.rule.matchField', 'eligibility.rule.precedence', 'eligibility.context.mapping']
        .map((key) => assumptions.find((entry) => entry.key === key)) },
  } };
}

test('compiled eligibility preserves complete ordered provenance, exclusion and unknown facts', async () => {
  const fixture = seed(); const policy = policyFor(fixture);
  const inherited = Object.create({ model: 'alpha' });
  for (const gradeId of ['grade-a', 'grade-b']) {
    for (const car of [undefined, null, {}, inherited, { model: '' }, { model: ' ' }, { model: 0 },
      { model: 'alpha' }, { model: 'beta' }, { model: 'unknown' }, { model: 'alpha ' }]) {
      const ctx = { ...context, gradeId };
      assert.deepEqual(await policy.getEligibility(ctx, car, pin()), expected(fixture, ctx, car, pin()));
    }
  }
  const excluded = await policy.getEligibility({ ...context, gradeId: 'grade-b' }, { model: 'alpha' }, read);
  assert.deepEqual(excluded.value.ruleIds, ['include', 'exclude']);
  assert.deepEqual(excluded.value.provenance.schemeRuleLinks.map((link) => link.ruleId), ['exclude', 'include']);
  const empty = { ...context, schemeId: 'scheme-b', companyId: 'company-b' };
  assert.deepEqual(await policy.getEligibility(empty, { model: 'alpha' }, read), expected(fixture, empty, { model: 'alpha' }, read));
  excluded.value.provenance.rules[0].gradeIds.push('corrupt');
  excluded.value.provenance.schemeRuleLinks.reverse();
  excluded.value.provenance.assumptions[2].value[0].gradeIds.push('corrupt');
  const ctx = { ...context, gradeId: 'grade-b' };
  assert.deepEqual(await policy.getEligibility(ctx, { model: 'alpha' }, pin()), expected(fixture, ctx, { model: 'alpha' }, pin()));
});

test('compiled eligibility keeps context failure precedence and scheme-wide field errors', async () => {
  const fixture = seed(); fixture.eligibilityRules[2].matchField = 'other';
  const policy = policyFor(fixture);
  for (const [ctx, code, field] of [[null, 'invalid-context', 'context'], [[], 'invalid-context', 'context'],
    [{ ...context, runId: 'other', schemeId: 'missing' }, 'run-mismatch', 'runId'],
    [{ ...context, schemeId: 'missing', companyId: 'missing' }, 'unknown-scheme', 'schemeId'],
    [{ ...context, companyId: 'missing', gradeId: 'missing' }, 'unknown-company', 'companyId'],
    [{ ...context, gradeId: 'missing' }, 'unknown-grade', 'gradeId'],
    [context, 'unsupported-rule-selection', 'eligibility.rule.matchField']]) {
    const result = await policy.getEligibility(ctx, {}, read);
    assert.equal(result.code, code); assert.equal(result.reasons[0].field, field);
  }
  const empty = { ...context, schemeId: 'scheme-b', companyId: 'company-b' };
  assert.equal((await policy.getEligibility(empty, {}, read)).status, 'ok');
  for (const key of ['eligibility.rule.matchField', 'eligibility.rule.precedence', 'eligibility.context.mapping']) {
    const dated = seed(); dated.assumptions.find((entry) => entry.key === key).effectiveTo = change;
    const later = { ...read, asOf: change };
    const result = await policyFor(dated).getEligibility(context, {}, later);
    assert.equal(result.code, key === 'eligibility.context.mapping' ? 'policy-configuration-unavailable' : 'unsupported-rule-selection');
  }
});

test('dated eligibility rows switch exactly at boundaries while retained pins keep activation rows', async () => {
  for (const table of ['eligibilityRules', 'schemeRuleLinks', 'assumptions']) {
    const fixture = seed();
    const entry = table === 'assumptions' ? fixture.assumptions.find((entry) => entry.key === 'eligibility.rule.matchField')
      : fixture[table].find((entry) => entry.ruleId === 'include');
    entry.effectiveTo = change;
    if (table !== 'assumptions') {
      const policy = policyFor(fixture);
      for (const asOf of [read.asOf, change, '2026-11-05T12:00:00Z', read.asOf]) {
        const dated = { ...read, asOf };
        assert.deepEqual(await policy.getEligibility(context, { model: 'alpha' }, dated), expected(fixture, context, { model: 'alpha' }, dated));
        assert.deepEqual(await policy.getEligibility(context, { model: 'alpha' }, pin(dated)), expected(fixture, context, { model: 'alpha' }, pin(dated)));
      }
    } else {
      const policy = policyFor(fixture);
      assert.equal((await policy.getEligibility(context, {}, read)).status, 'ok');
      assert.equal((await policy.getEligibility(context, {}, { ...read, asOf: change })).code, 'unsupported-rule-selection');
      assert.equal((await policy.getEligibility(context, {}, pin({ ...read, asOf: change }))).status, 'ok');
    }
  }
  const fixture = seed(); fixture.eligibilityRules[2].effectiveFrom = change;
  const policy = policyFor(fixture);
  assert.equal((await policy.getEligibility(context, { model: 'beta' }, read)).value.state, 'needs-confirmation');
  assert.equal((await policy.getEligibility(context, { model: 'beta' }, { ...read, asOf: change })).value.state, 'eligible');
});

test('activation and run reset with a repeated version identity never reuse another frozen snapshot index', async () => {
  const first = seed(); const next = seed();
  next.policyVersion = 'compiled-v2'; next.effectiveFrom = change;
  for (const table of ['eligibilityRules', 'schemeRuleLinks', 'assumptions']) {
    for (const entry of next[table]) entry.policyVersion = next.policyVersion;
  }
  next.eligibilityRules[0].effect = 'exclude';
  let supplied = [first];
  const policy = new PolicyService({ provider: { async loadVersions() { return supplied; } } });
  assert.equal((await policy.getEligibility(context, { model: 'alpha' }, pin())).value.state, 'eligible');
  supplied = [first, next];
  const later = { ...read, asOf: change };
  assert.equal((await policy.getEligibility(context, { model: 'alpha' }, later)).value.state, 'ineligible');
  assert.equal((await policy.getEligibility(context, { model: 'alpha' }, pin(later))).value.state, 'eligible');
  const reset = seed(); reset.eligibilityRules[0].effect = 'exclude';
  supplied = [reset];
  const resetRead = { ...pin(), runId: 'reset-run' };
  assert.equal((await policy.getEligibility({ ...context, runId: resetRead.runId }, { model: 'alpha' }, resetRead)).value.state, 'ineligible');
  reset.eligibilityRules[0].effect = 'include';
  assert.equal((await policy.getEligibility({ ...context, runId: resetRead.runId }, { model: 'alpha' }, resetRead)).value.state, 'ineligible');
  assert.equal((await policyFor(seed()).getEligibility(context, { model: 'alpha' }, pin())).value.state, 'eligible');
});

test('bounded pair evaluation visits rule/link collections once per immutable effective interval', async (t) => {
  const fixture = seed(); fixture.eligibilityRules[2].effectiveFrom = change;
  const policy = policyFor(fixture);
  await policy.getActiveVersion(read);
  const filter = Array.prototype.filter; const iterator = Array.prototype[Symbol.iterator];
  const visits = { rules: 0, links: 0 };
  const record = (array) => {
    const key = array[0]?.key;
    if (typeof key === 'string' && key.startsWith('compiled-rule-')) visits.rules += array.length;
    if (typeof key === 'string' && key.startsWith('compiled-link-')) visits.links += array.length;
  };
  try {
    Array.prototype.filter = function (...args) { record(this); return Reflect.apply(filter, this, args); };
    Array.prototype[Symbol.iterator] = function () { record(this); return Reflect.apply(iterator, this, []); };
    await policy.getEligibility(context, { model: 'alpha' }, pin());
    const compiled = { ...visits };
    assert.ok(compiled.rules > 0 && compiled.rules <= fixture.eligibilityRules.length * 4);
    assert.ok(compiled.links > 0 && compiled.links <= fixture.schemeRuleLinks.length * 6, JSON.stringify(compiled));
    for (let pair = 0; pair < 32; pair += 1) {
      await policy.getEligibility({ ...context, gradeId: pair % 2 ? 'grade-b' : 'grade-a' }, { model: pair % 3 ? 'alpha' : 'beta' }, pin());
      await policy.getEligibility(context, {}, { ...read, asOf: '2026-11-04T20:00:00Z' });
    }
    assert.deepEqual(visits, compiled);
    const repeated = { ...visits };
    await policy.getEligibility(context, { model: 'beta' }, { ...read, asOf: change });
    assert.ok(visits.rules > compiled.rules);
    const later = { ...visits };
    for (let pair = 0; pair < 32; pair += 1) await policy.getEligibility(context, { model: 'beta' }, { ...read, asOf: change });
    assert.deepEqual(visits, later);
    t.diagnostic(JSON.stringify({ firstCompilation: compiled, after64RepeatedPairs: repeated,
      nextIntervalCompilation: later, after32NextIntervalPairs: { ...visits } }));
    await policy.getEligibility(context, { model: 'alpha' }, pin());
    assert.deepEqual(visits, later);
  } finally {
    Array.prototype.filter = filter; Array.prototype[Symbol.iterator] = iterator;
  }
});
