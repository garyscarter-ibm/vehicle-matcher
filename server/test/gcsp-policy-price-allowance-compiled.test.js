import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../gcsp/policy/index.js';

const start = '2026-11-04T00:00:00Z';
const change = '2026-11-05T00:00:00Z';
const read = { runId: 'compiled-price-run', asOf: '2026-11-04T12:00:00Z' };
const context = { runId: read.runId, schemeId: 'scheme-a', companyId: 'company-a', gradeId: 'grade-a' };
const row = (key, value, extra = {}) => ({ key, value, unit: 'rule', status: 'assumed', basis: 'Bounded price regression fixture',
  source: 'compiled-price-fixture', sourceDate: '2026-11-04', policyVersion: 'compiled-v1', effectiveFrom: start, ...extra });
const price = (id, match, extra = {}) => row(`compiled-price-${id}`, 100, { pricePlanId: 'plan-a', priceEntryId: id,
  schemeId: 'scheme-a', monthlyPoints: 100, unit: 'points/month', provenance: { evidence: [id] }, ...match, ...extra });
function seed() {
  return { schemaVersion: 1, policyVersion: 'compiled-v1', effectiveFrom: start, source: 'compiled-price-fixture',
    eligibilityRules: [], schemeRuleLinks: [], allowances: [],
    pricePlans: [
      price('exact', { configurationId: 'config-a' }),
      price('model', { matchField: 'model', matchValue: 'alpha' }),
      price('trim', { matchField: 'trim', matchValue: 'sport' }),
      price('configuration-field', { matchField: 'configurationId', matchValue: 'config-both' }),
      price('configuration-exact', { configurationId: 'config-both' }),
      price('index-field', { matchField: '0', matchValue: 'A' }),
      price('own-prototype-field', { matchField: '__proto__', matchValue: 'own-prototype' }),
      price('scheme-b', { matchField: 'model', matchValue: 'alpha' }, { schemeId: 'scheme-b' }),
    ],
    assumptions: [row('eligibility.context.mapping', [
      { schemeId: 'scheme-a', companyId: 'company-a', gradeIds: ['grade-a', 'grade-b'], sourceMatrix: 'fixture-a' },
      { schemeId: 'scheme-b', companyId: 'company-b', gradeIds: ['grade-a'], sourceMatrix: 'fixture-b' },
      { schemeId: 'scheme-empty', companyId: 'company-a', gradeIds: ['grade-a'], sourceMatrix: 'fixture-empty' },
    ])] };
}
const policyFor = (...versions) => new PolicyService({ provider: { async loadVersions() { return versions; } } });
const pin = (policyRead = read) => ({ ...policyRead, policyVersion: 'compiled-v1' });
const active = (entry, at) => Date.parse(entry.effectiveFrom) <= at
  && (entry.effectiveTo === undefined || at < Date.parse(entry.effectiveTo));
const outcome = (status, policyVersion, fields) => ({ status, ...structuredClone(fields), contractVersion: '1.0.0', policyVersion });
const invalid = (policyVersion, code, field, reason) => outcome('invalid', policyVersion, { code, reasons: [{ field, reason }] });

// Independent reference for the original scan and typed result, including failure precedence.
function expected(fixture, ctx, car, policyRead) {
  const at = Date.parse(Object.hasOwn(policyRead, 'policyVersion') ? fixture.effectiveFrom : policyRead.asOf);
  const version = fixture.policyVersion;
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return invalid(version, 'invalid-context', 'context', 'Supply a company, scheme and grade.');
  if (Object.hasOwn(ctx, 'runId') && ctx.runId !== policyRead.runId) return invalid(version, 'run-mismatch', 'runId', 'Context and policy read must use the same run.');
  const mapping = fixture.assumptions.filter((entry) => active(entry, at)).find(({ key }) => key === 'eligibility.context.mapping');
  if (!mapping) return invalid(version, 'policy-configuration-unavailable', 'eligibility.context.mapping', 'The context mapping is not effective.');
  const scheme = mapping.value.find((entry) => entry.schemeId === ctx.schemeId);
  if (!scheme) return invalid(version, 'unknown-scheme', 'schemeId', 'Unknown scheme.');
  if (scheme.companyId !== ctx.companyId) return invalid(version, 'unknown-company', 'companyId', 'Company is not mapped to this scheme.');
  if (!scheme.gradeIds.includes(ctx.gradeId)) return invalid(version, 'unknown-grade', 'gradeId', 'Grade is not mapped to this scheme.');
  const rows = fixture.pricePlans.filter((entry) => active(entry, at)).filter((entry) => entry.schemeId === ctx.schemeId);
  const matches = rows.filter((entry) => car && (entry.configurationId !== undefined
    ? Object.hasOwn(car, 'configurationId') && car.configurationId === entry.configurationId
    : Object.hasOwn(car, entry.matchField) && car[entry.matchField] === entry.matchValue));
  if (matches.length > 1) return invalid(version, 'ambiguous-price', 'car', 'Multiple effective prices match the supplied car facts.');
  return matches[0] ? outcome('ok', version, { value: matches[0] })
    : outcome('not-found', version, { code: 'price-not-found', resourceType: 'price', reasons: [{ field: 'car', reason: 'No exact effective monthly points price.' }] });
}

test('compiled prices equal the scan for exact, arbitrary equality, ambiguity, missing and malformed facts', async () => {
  const fixture = seed(); const policy = policyFor(fixture);
  const inherited = Object.create({ configurationId: 'config-a', model: 'alpha', trim: 'sport' });
  const ownPrototype = JSON.parse('{"__proto__":"own-prototype"}');
  for (const car of [undefined, null, false, true, 0, 12, 1n, Symbol('car'), '', 'A', 'alpha', [], ['A'], {}, inherited,
    ownPrototype, { configurationId: 'config-a' }, { model: 'alpha' }, { trim: 'sport' },
    { configurationId: 'config-both' }, { configurationId: 'config-a', model: 'alpha' },
    { model: 'alpha', trim: 'sport' }, { configurationId: 'missing' }, { model: 'alpha ' },
    { model: ['alpha'] }, { model: new String('alpha') }, { model: null }, { model: undefined },
    { model: 0 }, { model: NaN }, { model: false }]) {
    for (const ctx of [context, { ...context, gradeId: 'grade-b' },
      { ...context, companyId: 'company-b', schemeId: 'scheme-b' }, { ...context, schemeId: 'scheme-empty' }]) {
      for (const policyRead of [read, pin()]) {
        assert.deepEqual(await policy.getPointsCost(ctx, car, policyRead), expected(fixture, ctx, car, policyRead));
      }
    }
  }
  assert.equal((await policy.getPointsCost(context, { configurationId: 'config-a', model: 'alpha' }, read)).code, 'ambiguous-price');
  assert.equal((await policy.getPointsCost(context, { configurationId: 'config-both' }, read)).code, 'ambiguous-price');
});

test('compiled prices preserve complete context errors and resolve read failures before car inspection', async () => {
  const fixture = seed(); const policy = policyFor(fixture);
  const car = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('car must not be inspected'); } });
  for (const ctx of [null, [], 'invalid', { ...context, runId: 'other', schemeId: 'missing' },
    { ...context, schemeId: 'missing', companyId: 'missing' }, { ...context, companyId: 'missing', gradeId: 'missing' },
    { ...context, gradeId: 'missing' }]) {
    assert.deepEqual(await policy.getPointsCost(ctx, car, read), expected(fixture, ctx, car, read));
  }
  fixture.assumptions[0].effectiveTo = change;
  const later = { ...read, asOf: change };
  assert.deepEqual(await policyFor(fixture).getPointsCost(context, car, later), expected(fixture, context, car, later));
  assert.deepEqual(await policy.getPointsCost(null, car, { ...read, asOf: 'invalid' }),
    invalid(null, 'invalid-read', 'read', 'Supply runId, ISO asOf and an optional nonempty policyVersion.'));
  assert.deepEqual(await policy.getPointsCost(null, car, { ...read, policyVersion: 'missing' }),
    outcome('not-found', null, { code: 'policy-version-not-found', resourceType: 'policy-version', reasons: [{ field: 'policyVersion', reason: 'No matching retained policy version.' }] }));
});

test('price intervals switch at starts and exclusive ends while historical pins retain activation rows', async () => {
  const fixture = seed();
  fixture.pricePlans[1].effectiveTo = change;
  fixture.pricePlans.push(price('later-model', { matchField: 'model', matchValue: 'alpha' },
    { effectiveFrom: change, monthlyPoints: 125, value: 125 }));
  fixture.pricePlans[2].effectiveFrom = change;
  fixture.pricePlans[0].effectiveTo = change;
  const policy = policyFor(fixture);
  for (const asOf of ['2026-11-04T23:59:59.999Z', change, '2026-11-05T12:00:00Z', read.asOf]) {
    for (const car of [{ model: 'alpha' }, { trim: 'sport' }, { configurationId: 'config-a' }]) {
      for (const policyRead of [{ ...read, asOf }, pin({ ...read, asOf })]) {
        assert.deepEqual(await policy.getPointsCost(context, car, policyRead), expected(fixture, context, car, policyRead));
      }
    }
  }
});

test('successor activation and reset with a repeated identity keep indexes on their immutable seed', async () => {
  const first = seed(); const next = seed();
  next.policyVersion = 'compiled-v2'; next.effectiveFrom = change;
  for (const table of ['pricePlans', 'assumptions']) for (const entry of next[table]) entry.policyVersion = next.policyVersion;
  next.pricePlans[1].monthlyPoints = 125; next.pricePlans[1].value = 125;
  let supplied = [first]; let loads = 0;
  const policy = new PolicyService({ provider: { async loadVersions() { loads += 1; return supplied; } } });
  const car = { model: 'alpha' }; const later = { ...read, asOf: change };
  await policy.withReadScope(async () => {
    assert.deepEqual(await policy.getPointsCost(context, car, pin()), expected(first, context, car, pin()));
    assert.deepEqual(await policy.getPointsCost(context, car, later), expected(first, context, car, later));
    supplied = [first, next];
    assert.deepEqual(await policy.getPointsCost(context, car, later), expected(next, context, car, later));
    assert.deepEqual(await policy.getPointsCost(context, car, pin(later)), expected(first, context, car, pin(later)));
    assert.equal(loads, 3);
  });
  const reset = seed(); reset.pricePlans[1].monthlyPoints = 150; reset.pricePlans[1].value = 150;
  supplied = [reset];
  const resetRead = { ...pin(), runId: 'reset-run' }; const resetContext = { ...context, runId: resetRead.runId };
  const result = await policy.getPointsCost(resetContext, car, resetRead);
  assert.deepEqual(result, expected(reset, resetContext, car, resetRead));
  const retained = structuredClone(result);
  result.value.provenance.evidence.push('caller-mutation'); result.value.monthlyPoints = 999;
  reset.pricePlans[1].provenance.evidence.push('provider-mutation'); reset.pricePlans[1].monthlyPoints = 999;
  assert.deepEqual(await policy.getPointsCost(resetContext, car, resetRead), retained);
  assert.deepEqual(await policyFor(seed()).getPointsCost(context, car, pin()), expected(seed(), context, car, pin()));
});

test('bounded price evaluation visits the collection only during compilation of each immutable interval', async (t) => {
  const fixture = seed(); fixture.pricePlans[2].effectiveFrom = change;
  const policy = policyFor(fixture);
  await policy.getActiveVersion(read);
  const filter = Array.prototype.filter; const iterator = Array.prototype[Symbol.iterator];
  let visits = 0;
  const record = (array) => {
    if (typeof array[0]?.key === 'string' && array[0].key.startsWith('compiled-price-')) visits += array.length;
  };
  try {
    Array.prototype.filter = function (...args) { record(this); return Reflect.apply(filter, this, args); };
    Array.prototype[Symbol.iterator] = function () { record(this); return Reflect.apply(iterator, this, []); };
    await policy.getPointsCost(context, { model: 'alpha' }, pin());
    const firstCompilation = visits;
    assert.ok(firstCompilation > 0 && firstCompilation <= fixture.pricePlans.length * 3, String(firstCompilation));
    for (let pair = 0; pair < 32; pair += 1) {
      await policy.getPointsCost(context, { configurationId: pair % 2 ? 'config-a' : 'missing' }, pin());
      await policy.getPointsCost(context, { model: 'alpha' }, { ...read, asOf: '2026-11-04T20:00:00Z' });
    }
    assert.equal(visits, firstCompilation);
    const after64RepeatedCalls = visits;
    await policy.getPointsCost(context, { trim: 'sport' }, { ...read, asOf: change });
    assert.ok(visits > firstCompilation && visits <= firstCompilation + fixture.pricePlans.length * 2);
    const nextIntervalCompilation = visits;
    for (let pair = 0; pair < 32; pair += 1) await policy.getPointsCost(context, { trim: 'sport' }, { ...read, asOf: change });
    assert.equal(visits, nextIntervalCompilation);
    await policy.getPointsCost(context, { model: 'alpha' }, pin());
    assert.equal(visits, nextIntervalCompilation);
    t.diagnostic(JSON.stringify({ firstCompilation, after64RepeatedCalls, nextIntervalCompilation, after32NextIntervalCalls: visits }));
  } finally {
    Array.prototype.filter = filter; Array.prototype[Symbol.iterator] = iterator;
  }
});
