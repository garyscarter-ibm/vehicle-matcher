import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolicyService, FilePolicyProvider, createPolicyService } from '../gcsp/policy/index.js';

const read = { runId: 'policy-test-run', asOf: '2026-11-04T12:00:00.000Z' };
const seedUrl = new URL('../gcsp/policy/seed-v1.json', import.meta.url);
const service = createPolicyService();
const initial = await service.getActiveVersion(read);
const version = initial.policyVersion;
const mapping = (await service.getAssumption('eligibility.context.mapping', read)).value.value;
const context = (scheme = mapping[0], gradeId = scheme.gradeIds[0]) => ({
  runId: read.runId, companyId: scheme.companyId, schemeId: scheme.schemeId, gradeId,
});
const car = { eligibilityModelKey: 'G20 Saloon|320i' };
const alternateSeed = async () => JSON.parse(await readFile(seedUrl, 'utf8'));
const withSeeds = (...seeds) => new PolicyService({ provider: { async loadVersions() { return seeds; } } });
const versioned = (result, expected = version) => {
  assert.equal(result.contractVersion, '1.0.0');
  assert.equal(result.policyVersion, expected);
  return result;
};
const reviseVersion = (seed, policyVersion, effectiveFrom, effectiveTo) => {
  seed.policyVersion = policyVersion;
  seed.effectiveFrom = effectiveFrom;
  if (effectiveTo) seed.effectiveTo = effectiveTo;
  for (const table of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of seed[table]) row.policyVersion = policyVersion;
  }
  return seed;
};
async function projection(policy, policyRead = read) {
  return {
    activeVersion: await policy.getActiveVersion(policyRead),
    eligibility: await policy.getEligibility(context(mapping[0], mapping[0].gradeIds[1]), car, policyRead),
    allowance: await policy.getAllowance(context(mapping[0], mapping[0].gradeIds[1]), policyRead),
    pointsCost: await policy.getPointsCost(context(mapping[0], mapping[0].gradeIds[1]), car, policyRead),
    cartHold: await policy.getAssumption('hold.cart.durationSeconds', policyRead),
    orderReview: await policy.getAssumption('hold.cart.orderReview.durationSeconds', policyRead),
    buddyHold: await policy.getAssumption('hold.buddy.durationSeconds', policyRead),
  };
}

// These representative consumers get their values exclusively through the injected service.
async function consumerHolds(policy, policyRead = read) {
  const [manual, generator, simulation] = await Promise.all([
    policy.getAssumption('hold.cart.durationSeconds', policyRead),
    policy.getAssumption('hold.cart.durationSeconds', policyRead),
    policy.getAssumption('hold.cart.durationSeconds', policyRead),
  ]);
  for (const result of [manual, generator, simulation]) assert.equal(result.status, 'ok');
  return {
    manualExpiresAt: new Date(Date.parse(policyRead.asOf) + manual.value.value * 1000).toISOString(),
    generatorDuration: generator.value.value,
    simulationDuration: simulation.value.value,
    displayedDuration: (await projection(policy, policyRead)).cartHold.value.value,
  };
}

test('typed reads retain all provenance, declared units and policy versions', async () => {
  assert.equal(initial.status, 'ok');
  versioned(initial);
  const results = await projection(service);
  for (const result of Object.values(results)) {
    versioned(result);
    assert.equal(result.status, 'ok');
  }
  for (const row of [results.allowance.value, results.pointsCost.value, results.cartHold.value]) {
    for (const key of ['key', 'value', 'unit', 'status', 'basis', 'source', 'sourceDate', 'effectiveFrom', 'policyVersion']) assert.ok(Object.hasOwn(row, key), key);
    assert.equal(row.status, 'assumed');
  }
  assert.equal(results.allowance.value.unit, 'points/month');
  assert.equal(results.pointsCost.value.unit, 'points/month');
  assert.ok(results.pointsCost.value.pricePlanId);
  assert.equal(results.eligibility.value.eligible, true);
  assert.equal(results.eligibility.value.provenance.rules[0].status, 'verified');
  assert.equal(results.eligibility.value.provenance.assumptions[0].key, 'eligibility.rule.matchField');
  assert.equal((await service.getAssumption('choices.topUp.enabled', read)).value.value, false);
});

test('all foundation assumption values match the documented baseline through service reads', async () => {
  const contract = await readFile(new URL('../../docs/gcsp/shared-contracts.md', import.meta.url), 'utf8');
  let checked = 0;
  const catalogue = contract.split('Key names use')[1].split('FUCQ-82 adds')[0];
  for (const line of catalogue.split('\n')) {
    const entry = line.match(/^\| `([^`]+)` \| `([^`]+)`/);
    if (!entry) continue;
    const [, key, value] = entry;
    if (!key.includes('.') || key === 'eligibility.context.mapping') continue;
    let expected;
    try { expected = JSON.parse(value); } catch { expected = value; }
    const result = versioned(await service.getAssumption(key, read));
    assert.equal(result.status, 'ok', key);
    assert.deepEqual(result.value.value, expected, key);
    checked += 1;
  }
  assert.equal(checked, 25);
});

test('every source matrix model/engine and grade has its exact independent decision', async () => {
  const source = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
  let schemeIndex = -1;
  const counts = [0, 0];
  for (const line of source.split('\n')) {
    if (line.startsWith('## FS&UK')) schemeIndex = 0;
    if (line.startsWith('## RR&Production')) schemeIndex = 1;
    if (schemeIndex < 0 || !line.startsWith('|') || !/[✓✗]/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const scheme = mapping[schemeIndex];
    for (const engine of cells[3].split(/[,/]/).map((entry) => entry.trim())) {
      counts[schemeIndex] += 1;
      for (const [gradeIndex, gradeId] of scheme.gradeIds.entries()) {
        const result = versioned(await service.getEligibility(context(scheme, gradeId), { eligibilityModelKey: `${cells[1]}|${engine}` }, read));
        assert.equal(result.status, 'ok');
        assert.equal(result.value.eligible, cells[5 + gradeIndex] === '✓', `${scheme.schemeId}/${gradeId}/${cells[1]}|${engine}`);
        assert.equal(result.value.state, cells[5 + gradeIndex] === '✓' ? 'eligible' : 'ineligible');
        assert.equal(result.value.provenance.rules[0].sourceDate, schemeIndex === 0 ? '2024-07-29' : '2024-07-18');
      }
    }
  }
  assert.deepEqual(counts, [73, 74]);
});

test('unknown assumptions, schemes, grades and companies fail without a fallback', async () => {
  const missing = versioned(await service.getAssumption('missing.assumption', read));
  assert.equal(missing.status, 'invalid');
  assert.equal(missing.code, 'unknown-assumption');
  for (const [field, code] of [['schemeId', 'unknown-scheme'], ['gradeId', 'unknown-grade'], ['companyId', 'unknown-company']]) {
    for (const method of ['getEligibility', 'getAllowance', 'getPointsCost']) {
      const args = method === 'getAllowance' ? [{ ...context(), [field]: 'missing' }, read] : [{ ...context(), [field]: 'missing' }, car, read];
      const result = versioned(await service[method](...args));
      assert.equal(result.status, 'invalid');
      assert.equal(result.code, code);
    }
  }
});

test('missing and unmapped facts cannot become eligible or use a nearest price', async () => {
  for (const input of [undefined, {}, { eligibilityModelKey: 'G20 Saloon|320' }, { eligibilityModelKey: 'G20 Saloon|320i ' }]) {
    const result = versioned(await service.getEligibility(context(), input, read));
    assert.equal(result.value.eligible, false);
    assert.equal(result.value.state, 'needs-confirmation');
    const price = versioned(await service.getPointsCost(context(), input, read));
    assert.equal(price.status, 'not-found');
    assert.equal(price.code, 'price-not-found');
    assert.equal(price.resourceType, 'price');
  }
  // This method applies matrix decisions; affordability/charging/essentials belong to FUCQ-29.
  const result = await service.getEligibility({ ...context(mapping[0], mapping[0].gradeIds[1]), homeCharging: false, essentialsMet: false, monthlyPoints: 0 }, car, read);
  assert.equal(result.value.eligible, true);
});

test('exact configuration prices are supported and ambiguous matches fail explicitly', async () => {
  const seed = await alternateSeed();
  const selected = seed.pricePlans.find((row) => row.schemeId === context().schemeId && row.matchValue === car.eligibilityModelKey);
  const exact = { ...selected, configurationId: 'explicit-test-configuration' };
  delete exact.matchField;
  delete exact.matchValue;
  seed.pricePlans[seed.pricePlans.indexOf(selected)] = exact;
  const policy = withSeeds(seed);
  const priced = versioned(await policy.getPointsCost(context(), { configurationId: exact.configurationId }, read));
  assert.equal(priced.status, 'ok');
  assert.equal(priced.value.configurationId, exact.configurationId);
  assert.equal(priced.value.monthlyPoints, selected.monthlyPoints);
  assert.equal(versioned(await policy.getPointsCost(context(), car, read)).code, 'price-not-found');
  const ambiguous = await alternateSeed();
  ambiguous.pricePlans.push({ ...exact, key: 'explicit-test-price', priceEntryId: 'explicit-test-price' });
  const result = versioned(await withSeeds(ambiguous).getPointsCost(context(), { ...car, configurationId: exact.configurationId }, read));
  assert.equal(result.status, 'invalid');
  assert.equal(result.code, 'ambiguous-price');
});

test('explicit exclude wins over an overlapping include', async () => {
  const seed = await alternateSeed();
  const include = seed.eligibilityRules.find((row) => row.effect === 'include');
  const link = seed.schemeRuleLinks.find((row) => row.ruleId === include.ruleId);
  seed.eligibilityRules.push({ ...include, key: 'test-explicit-exclude', ruleId: 'test-explicit-exclude', effect: 'exclude' });
  seed.schemeRuleLinks.push({ ...link, key: 'test-exclude-link', linkId: 'test-exclude-link', ruleId: 'test-explicit-exclude', value: 'test-explicit-exclude' });
  const result = versioned(await withSeeds(seed).getEligibility(context(), { [include.matchField]: include.value }, read));
  assert.equal(result.value.eligible, false);
  assert.equal(result.value.state, 'ineligible');
  assert.equal(result.value.ruleIds.length, 2);
});

test('bad reads, missing pins and context run mismatches carry explicit versions', async () => {
  for (const badRead of [undefined, {}, { ...read, runId: '' }, { ...read, asOf: '2026-11-04' }, { ...read, asOf: '2026-02-30T12:00:00Z' }, { ...read, policyVersion: '' }, { ...read, policyVersion: null }]) {
    const result = versioned(await service.getActiveVersion(badRead), null);
    assert.equal(result.code, 'invalid-read');
  }
  for (const method of ['getEligibility', 'getAllowance', 'getPointsCost']) {
    const args = method === 'getAllowance' ? [{ ...context(), runId: 'other-run' }, read] : [{ ...context(), runId: 'other-run' }, car, read];
    assert.equal(versioned(await service[method](...args)).code, 'run-mismatch');
  }
  assert.equal(versioned(await service.getAllowance(null, read)).code, 'invalid-context');
  const missingPin = versioned(await service.getActiveVersion({ ...read, policyVersion: 'missing' }), null);
  assert.equal(missingPin.code, 'policy-version-not-found');
  assert.equal(missingPin.resourceType, 'policy-version');
  assert.equal(versioned(await service.getActiveVersion({ ...read, asOf: '2026-11-03T23:59:59Z' }), null).status, 'not-found');
});

test('source failures are typed and never expose provider errors or file paths', async () => {
  for (const provider of [null, {}, { loadVersions() { throw new Error('/private/secret credential'); } }, { async loadVersions() { return []; } }]) {
    const result = versioned(await new PolicyService({ provider }).getAssumption('hold.cart.durationSeconds', read), null);
    assert.ok(['invalid', 'unavailable'].includes(result.status));
    assert.doesNotMatch(JSON.stringify(result), /private|secret|credential/);
  }
  assert.equal(versioned(await createPolicyService({ provider: null }).getActiveVersion(read), null).status, 'unavailable');
  const unavailable = versioned(await createPolicyService({ filePath: '/missing/private/policy.json' }).getActiveVersion(read), null);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.code, 'source-unavailable');
  assert.equal(unavailable.reason, 'The policy source is unavailable.');
  assert.equal(unavailable.retryable, true);
});

test('malformed rows, duplicate IDs, invalid dates and inconsistent provenance fail as source errors', async () => {
  const mutations = [
    (seed) => { seed.schemaVersion = 2; },
    (seed) => { const row = seed.schemeRuleLinks[0]; seed.schemeRuleLinks.push({ ...row, key: 'duplicate-link', linkId: 'duplicate-link' }); },
    (seed) => { seed.assumptions.push({ ...seed.assumptions[0] }); },
    (seed) => { seed.effectiveFrom = '2026-02-30T00:00:00Z'; },
    (seed) => { seed.assumptions[0].effectiveTo = seed.assumptions[0].effectiveFrom; },
    (seed) => { seed.assumptions[0].sourceDate = '2026-02-30'; },
    (seed) => { seed.assumptions[0].policyVersion = 'different'; },
    (seed) => { seed.pricePlans[0].monthlyPoints = -1; },
    (seed) => { seed.allowances[0].value += 1; },
    (seed) => { seed.schemeRuleLinks[0].ruleId = 'missing-rule'; },
    (seed) => { seed.schemeRuleLinks[0].sourceDate = '2026-11-04'; },
    (seed) => { seed.eligibilityRules[0].operator = 'guess'; },
    (seed) => { seed.eligibilityRules[0].gradeIds = ['unknown']; },
  ];
  for (const mutate of mutations) {
    const seed = await alternateSeed();
    mutate(seed);
    const result = versioned(await withSeeds(seed).getActiveVersion(read), null);
    assert.equal(result.status, 'invalid');
    assert.equal(result.code, 'source-invalid');
  }
  const seed = await alternateSeed();
  assert.equal(versioned(await withSeeds(seed, structuredClone(seed)).getActiveVersion(read), null).code, 'source-invalid');
  const equivalent = reviseVersion(structuredClone(seed), 'equivalent-instant', '2026-11-04T00:00:00Z');
  assert.equal(versioned(await withSeeds(seed, equivalent).getActiveVersion(read), null).code, 'source-invalid');
});

test('unsupported rule selections fail on the resolved version', async () => {
  for (const [key, value] of [['eligibility.rule.precedence', 'includeFirst'], ['eligibility.rule.matchField', 'unknownField']]) {
    const seed = await alternateSeed();
    seed.assumptions.find((row) => row.key === key).value = value;
    const result = versioned(await withSeeds(seed).getEligibility(context(), car, read));
    assert.equal(result.status, 'invalid');
    assert.equal(result.code, 'unsupported-rule-selection');
  }
});

test('retained historical pins keep activation-time rows after expiry and future versions wait', async () => {
  const old = reviseVersion(await alternateSeed(), 'retained-v0', '2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z');
  const current = reviseVersion(await alternateSeed(), 'retained-v1', '2026-11-05T00:00:00.000Z');
  const future = reviseVersion(await alternateSeed(), 'retained-v2', '2026-11-10T00:00:00.000Z');
  const oldHold = old.assumptions.find((row) => row.key === 'hold.cart.durationSeconds');
  oldHold.effectiveTo = '2026-11-05T00:00:00.000Z';
  current.assumptions.find((row) => row.key === oldHold.key).value = oldHold.value + 60;
  future.assumptions.find((row) => row.key === oldHold.key).value = oldHold.value + 120;
  const policy = withSeeds(old, current, future);
  const later = { ...read, asOf: '2026-11-06T12:00:00Z' };
  assert.equal(versioned(await policy.getAssumption(oldHold.key, later), 'retained-v1').value.value, oldHold.value + 60);
  assert.equal(versioned(await policy.getAssumption(oldHold.key, { ...later, policyVersion: 'retained-v0' }), 'retained-v0').value.value, oldHold.value);
  assert.equal(versioned(await policy.getActiveVersion({ ...later, asOf: future.effectiveFrom }), 'retained-v2').value.policyVersion, 'retained-v2');
  const dated = await alternateSeed();
  dated.pricePlans.find((row) => row.matchValue === car.eligibilityModelKey).effectiveTo = '2026-11-05T00:00:00Z';
  dated.allowances[0].effectiveTo = '2026-11-05T00:00:00Z';
  const datedPolicy = withSeeds(dated);
  const missingAllowance = versioned(await datedPolicy.getAllowance(context(), later));
  assert.equal(missingAllowance.status, 'not-found');
  assert.equal(missingAllowance.resourceType, 'allowance');
  assert.equal(versioned(await datedPolicy.getPointsCost(context(), car, later)).code, 'price-not-found');
  assert.equal(versioned(await datedPolicy.getPointsCost(context(), car, { ...later, policyVersion: version })).status, 'ok');
});

test('callers cannot mutate the provider snapshot or subsequent service results', async () => {
  const seed = await alternateSeed();
  const policy = withSeeds(seed);
  const original = await policy.getAssumption('eligibility.context.mapping', read);
  const expected = structuredClone(original);
  original.value.value[0].gradeIds.push('invented');
  seed.assumptions.find((row) => row.key === 'eligibility.context.mapping').value[0].gradeIds.push('mutated-provider');
  assert.deepEqual(await policy.getAssumption('eligibility.context.mapping', read), expected);
  const provider = new FilePolicyProvider();
  const versions = await provider.loadVersions();
  assert.throws(() => { versions[0].assumptions[0].value = -1; }, TypeError);
  assert.throws(() => { versions.push(seed); }, TypeError);
});

test('one alternative file entry changes all consumer reads and projection while pins retain original terms', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'gcsp-policy-'));
  try {
    const original = await alternateSeed();
    original.effectiveTo = '2026-11-05T00:00:00Z';
    const changed = reviseVersion(structuredClone(original), 'alternative-v2', '2026-11-05T00:00:00Z');
    delete changed.effectiveTo;
    const entry = changed.assumptions.find((row) => row.key === 'hold.cart.durationSeconds');
    const oldValue = (await service.getAssumption(entry.key, read)).value.value;
    entry.value = oldValue + 47;
    const firstPath = join(scratch, 'retained.json');
    const changedPath = join(scratch, 'alternative.json');
    await writeFile(firstPath, JSON.stringify(original));
    await writeFile(changedPath, JSON.stringify(changed));
    const alternative = createPolicyService({ filePath: changedPath, retainedFilePaths: [firstPath] });
    const later = { ...read, asOf: '2026-11-06T12:00:00Z' };
    const consumers = await consumerHolds(alternative, later);
    assert.equal(consumers.generatorDuration, entry.value);
    assert.equal(consumers.simulationDuration, entry.value);
    assert.equal(consumers.displayedDuration, entry.value);
    assert.equal(consumers.manualExpiresAt, new Date(Date.parse(later.asOf) + entry.value * 1000).toISOString());
    assert.equal((await consumerHolds(service)).generatorDuration, oldValue);
    assert.equal((await consumerHolds(alternative, { ...later, policyVersion: version })).generatorDuration, oldValue);
    const before = await stat(changedPath);
    const publish = versioned(await alternative.publishPolicyVersion({ role: 'greg' }, { changes: [] }), null);
    assert.equal(publish.status, 'invalid');
    assert.equal(publish.code, 'unsupported-operation');
    assert.equal(publish.accepted, false);
    assert.equal((await stat(changedPath)).mtimeMs, before.mtimeMs);
    for (const contents of ['not json', '{"schemaVersion":1,"schemaVersion":1}']) {
      const badPath = join(scratch, 'malformed.json');
      await writeFile(badPath, contents);
      const result = versioned(await createPolicyService({ filePath: badPath }).getActiveVersion(read), null);
      assert.equal(result.code, 'source-invalid');
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('backend presentation projection matches the retained fixture', async () => {
  const expected = JSON.parse(await readFile(new URL('./fixtures/gcsp-policy-projection.json', import.meta.url), 'utf8'));
  assert.deepEqual(await projection(service), expected);
});
