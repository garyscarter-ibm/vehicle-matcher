import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { validateBrief } from '../scenarios/employee/index.js';
import { COMPARISON_GENERATOR_VERSION, COMPARISON_KEYS, ComparisonInputError,
  generateComparisonInputs, loadComparisonPolicy } from '../gcsp/comparison/generator.js';

const read = { runId: 'comparison-policy-read', asOf: '2026-11-05T09:00:00.000Z', policyVersion: 'gcsp-policy-v1' };
const source = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const service = createPolicyService();
const prepared = await loadComparisonPolicy({ policyService: service, policyRead: read });
const values = Object.fromEntries(Object.entries(prepared.assumptions).map(([key, row]) => [key, row.value]));
const small = { 'comparison.cohortSize': 12, 'comparison.carsPerEmployee': 1 };
const generate = (seed = 'test-seed', overlay = small, policy = prepared) => generateComparisonInputs(seed, policy, { overlay });
const seedRow = (seed, key) => seed.assumptions.find((row) => row.key === key);
const fromSeed = (seed) => new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
const prepare = (seed) => loadComparisonPolicy({ policyService: fromSeed(seed), policyRead: read });
const rejects = (error, key, code) => error instanceof ComparisonInputError && error.key === key && (!code || error.code === code);

test('same seed and pinned policy give identical input without any clock, network or global random read', () => {
  const original = { Date: globalThis.Date, random: Math.random, fetch: globalThis.fetch };
  try {
    globalThis.Date = class extends original.Date {
      constructor(...args) { assert.ok(args.length > 0, 'generator must supply an instant'); super(...args); }
      static now() { assert.fail('wall clock read'); }
    };
    Math.random = () => assert.fail('global random read');
    globalThis.fetch = () => assert.fail('network read');
    const first = generateComparisonInputs(values['comparison.seeds'][0], prepared);
    const second = generateComparisonInputs(values['comparison.seeds'][0], prepared);
    assert.deepEqual(first, second);
    assert.equal(first.manifest.generatorVersion, COMPARISON_GENERATOR_VERSION);
    assert.equal(first.manifest.policyVersion, prepared.policyVersion);
    assert.match(first.manifest.inputHash, /^[0-9a-f]{64}$/);
  } finally {
    globalThis.Date = original.Date;
    Math.random = original.random;
    globalThis.fetch = original.fetch;
  }
});

test('different seeds change fictional people, exact stock and release identities', () => {
  const first = generate('first');
  const second = generate('second');
  assert.notEqual(first.manifest.inputHash, second.manifest.inputHash);
  assert.notDeepEqual(first.employees, second.employees);
  assert.notDeepEqual(first.stock, second.stock);
  assert.notDeepEqual(first.releaseSchedule, second.releaseSchedule);
  assert.deepEqual(first.manifest.counts, second.manifest.counts);
});

test('cohort size and seed list resolve through canonical keys with complete assumed provenance', async () => {
  const output = generateComparisonInputs(values['comparison.seeds'][0], prepared);
  assert.equal(output.employees.length, values['comparison.cohortSize']);
  assert.equal(output.employees.length, 1000, 'the reviewed requested default cohort');
  assert.deepEqual(output.manifest.seeds, values['comparison.seeds']);
  for (const key of COMPARISON_KEYS) {
    const row = (await service.getAssumption(key, read)).value;
    assert.deepEqual(prepared.assumptions[key], row);
    assert.equal(row.status, 'assumed');
    for (const field of ['value', 'unit', 'basis', 'source', 'sourceDate', 'policyVersion', 'effectiveFrom']) assert.ok(Object.hasOwn(row, field), `${key}.${field}`);
  }
  const changed = structuredClone(source);
  seedRow(changed, 'comparison.cohortSize').value = 7;
  seedRow(changed, 'comparison.seeds').value = ['explicit-alternative-seed'];
  const alternative = generateComparisonInputs('explicit-alternative-seed', await prepare(changed));
  assert.equal(alternative.employees.length, 7);
  assert.deepEqual(alternative.manifest.seeds, ['explicit-alternative-seed']);
});

test('changing one central source key changes generation and its policy identity', async () => {
  const changed = structuredClone(source);
  seedRow(changed, 'comparison.carsPerEmployee').value = 0.5;
  const first = generateComparisonInputs('source-key', prepared);
  const second = generateComparisonInputs('source-key', await prepare(changed));
  assert.equal(second.stock.length, second.employees.length / 2);
  assert.notEqual(first.stock.length, second.stock.length);
  assert.notEqual(first.manifest.policyHash, second.manifest.policyHash);
  assert.deepEqual(first.employees, second.employees);
});

test('explicit overlays change inputs, have canonical hashes, remain immutable and are never published', () => {
  const before = structuredClone(prepared);
  const overlay = { ...small, 'comparison.pointsAllowanceMultiplier': 1.2,
    'comparison.modelLineMix': [{ modelLine: prepared.configurations[1].modelLine, weight: 1 }] };
  const originalOverlay = structuredClone(overlay);
  const baseline = generate();
  const changed = generate('test-seed', overlay);
  assert.ok(changed.stock.every((car) => car.modelLine === prepared.configurations[1].modelLine));
  assert.equal(changed.employees[0].pointsAllowance, baseline.employees[0].pointsAllowance * 1.2);
  assert.notEqual(changed.manifest.inputHash, baseline.manifest.inputHash);
  assert.deepEqual(changed.manifest.overlay, originalOverlay);
  assert.equal(changed.manifest.overlayHash, generate('test-seed', Object.fromEntries(Object.entries(overlay).reverse())).manifest.overlayHash);
  assert.equal(changed.manifest.assumptions.find((row) => row.key === 'comparison.pointsAllowanceMultiplier').baselineValue, 1);
  assert.deepEqual(prepared, before);
  assert.deepEqual(overlay, originalOverlay);
  assert.throws(() => { changed.manifest.overlay['comparison.pointsAllowanceMultiplier'] = 2; }, TypeError);
  const held = generate('test-seed', { ...small, 'hold.buddy.durationSeconds': 14400 });
  assert.equal(held.manifest.inputHash, baseline.manifest.inputHash, 'a hold sweep changes rules, not the shared generated inputs');
  assert.equal(held.manifest.overlay['hold.buddy.durationSeconds'], 14400);
});

test('generated employees contain no personal-data fields or delivered-car identifiers', () => {
  const forbidden = /^(name|firstName|lastName|email|phone|address|contact|licence|license|licenceNumber|licenseNumber|vin|vin7|vin17)$/i;
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.test(key), false, key); walk(child); }
  };
  const output = generate();
  walk(output);
  assert.ok(output.employees.every((employee) => employee.fictional && /^fictional-employee-[a-f0-9]{24}$/.test(employee.employeeId)));
  assert.equal(new Set(output.employees.map((employee) => employee.employeeId)).size, output.employees.length);
});

test('exact stock has unique Q13 UUID-v4 references and target Base64 configuration identities', () => {
  const output = generateComparisonInputs('stock-q13', prepared);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.equal(new Set(output.stock.map((car) => car.orderUuid)).size, output.stock.length);
  for (const car of output.stock) {
    assert.match(car.orderUuid, uuid);
    const reference = prepared.configurations.find((row) => row.configurationId === car.configurationId);
    assert.ok(reference);
    const identity = reference.canonicalIdentity;
    const signature = `${identity[values['stock.configuration.modelCodeField']]}:${[...identity.factoryOptionCodes].sort().join(values['stock.configuration.codeSeparator'])}`;
    assert.equal(Buffer.from(car.configurationId, 'base64').toString('utf8'), signature);
    assert.equal(Buffer.from(signature).toString('base64'), car.configurationId);
    assert.equal(car.eligibilityModelKey, reference.modelLine);
    assert.equal(car.sourceKind, 'reviewed-fixtures');
    assert.equal(identity.provenance.kind, 'synthetic');
  }
  assert.deepEqual(output.releaseSchedule.flatMap((release) => release.orderUuids), output.stock.map((car) => car.orderUuid));
  const cadence = values['comparison.releaseCadence'];
  output.releaseSchedule.forEach((release, index) => {
    assert.equal(Date.parse(release.at), Date.parse(values['comparison.startsAt'])
      + (cadence.firstReleaseDay + index * cadence.intervalDays) * 86400000);
    assert.ok(release.orderUuids.length <= cadence.batchSize);
  });
});

test('employee fields respect keyed allowances, renewal and access bounds, and the existing brief reader', () => {
  const output = generate();
  const config = values['employee.recommendation.v1'];
  const slider = { minimum: values['brief.slider.minimum'], maximum: values['brief.slider.maximum'] };
  for (const employee of output.employees) {
    const grade = values['comparison.gradeDistribution'].find((row) => row.gradeId === employee.gradeId);
    const allowance = prepared.allowances.find((row) => row.gradeId === employee.gradeId && row.schemeId === grade.schemeId);
    assert.equal(employee.pointsAllowance, allowance.monthlyPoints);
    assert.equal(employee.companyId, grade.companyId);
    const day = (Date.parse(employee.renewalAt) - Date.parse(values['comparison.startsAt'])) / 86400000;
    assert.ok(day >= values['comparison.renewalDays'].min && day <= values['comparison.renewalDays'].max);
    const access = values['comparison.accessGroups'].find((row) => row.id === employee.accessGroup);
    assert.ok(employee.accessSeconds >= access.accessSeconds.min && employee.accessSeconds <= access.accessSeconds.max);
    assert.ok(employee.responseSeconds >= access.responseSeconds.min && employee.responseSeconds <= access.responseSeconds.max);
    assert.deepEqual(validateBrief(employee.statedBrief, config, slider), []);
  }
});

test('keyed extremes allow no stock, all or no participation, accurate or noisy briefs and fixed access', () => {
  const controls = { ...small, 'comparison.carsPerEmployee': 0, 'comparison.buddyUptake': 0,
    'comparison.briefNoise.v1': { accuratePreferenceProbability: 1, preserveEssentials: true },
    'comparison.accessGroups': [{ id: 'fixed', weight: 1, accessSeconds: { min: 7, max: 7 }, responseSeconds: { min: 11, max: 11 } }] };
  const exact = generate('extremes', controls);
  assert.deepEqual(exact.stock, []);
  assert.deepEqual(exact.releaseSchedule, []);
  for (const employee of exact.employees) {
    assert.equal(employee.buddyParticipation, false);
    assert.equal(employee.accessSeconds, 7);
    assert.equal(employee.responseSeconds, 11);
    for (const [key, preference] of Object.entries(employee.underlyingNeeds.preferences)) {
      assert.equal(employee.statedBrief.preferences[key].value, preference.value);
      assert.equal(employee.statedBrief.preferences[key].importance, preference.importance);
    }
  }
  const noisy = generate('extremes', { ...controls, 'comparison.buddyUptake': 1,
    'comparison.briefNoise.v1': { accuratePreferenceProbability: 0, preserveEssentials: true } });
  for (const employee of noisy.employees) {
    assert.equal(employee.buddyParticipation, true);
    for (const [key, preference] of Object.entries(employee.underlyingNeeds.preferences)) {
      assert.notEqual(employee.statedBrief.preferences[key].value, preference.value);
      assert.notEqual(employee.statedBrief.preferences[key].importance, preference.importance);
    }
    assert.deepEqual(Object.fromEntries(Object.entries(employee.statedBrief.essentials).map(([key, row]) => [key,
      { operator: row.operator, value: row.value, unit: row.unit }])), employee.underlyingNeeds.essentials);
  }
});

test('missing source keys, unavailable ports and mixed policy versions fail explicitly without publishing', async () => {
  const missing = structuredClone(source);
  missing.assumptions = missing.assumptions.filter((row) => row.key !== 'comparison.cohortSize');
  await assert.rejects(prepare(missing), (error) => rejects(error, 'comparison.cohortSize', 'policy-unavailable'));
  for (const policyService of [null, { getActiveVersion() { throw new Error('private provider details'); }, getAssumption() {}, getAllowance() {} }]) {
    await assert.rejects(loadComparisonPolicy({ policyService, policyRead: read }), ComparisonInputError);
  }
  let publications = 0;
  const inconsistent = {
    getActiveVersion: (...args) => service.getActiveVersion(...args),
    async getAssumption(...args) { const result = await service.getAssumption(...args); return { ...result, policyVersion: 'different' }; },
    getAllowance: (...args) => service.getAllowance(...args),
    publishPolicyVersion() { publications += 1; assert.fail('must not publish'); },
  };
  await assert.rejects(loadComparisonPolicy({ policyService: inconsistent, policyRead: read }),
    (error) => rejects(error, COMPARISON_KEYS[0], 'policy-unavailable'));
  assert.equal(publications, 0);
  const snapshot = structuredClone(prepared);
  snapshot.assumptions['comparison.cohortSize'].policyVersion = 'different';
  assert.throws(() => generate('bad-version', small, snapshot), (error) => rejects(error, 'comparison.cohortSize', 'incoherent-policy'));
});

test('invalid overlays name the offending key and cannot replace provenance or configuration sources', () => {
  const invalid = [
    [{ arbitrary: 1 }, 'overlay'],
    [{ 'comparison.configurationSet.v1': {} }, 'overlay'],
    [{ 'comparison.gradeDistribution': [] }, 'overlay'],
    [{ 'comparison.cohortSize': 0 }, 'comparison.cohortSize'],
    [{ 'comparison.pointsAllowanceMultiplier': -1 }, 'comparison.pointsAllowanceMultiplier'],
    [{ 'comparison.pointsAllowanceMultiplier': Number.MAX_VALUE }, 'comparison.pointsAllowanceMultiplier'],
    [{ 'comparison.carsPerEmployee': Infinity }, 'overlay'],
    [{ 'comparison.carsPerEmployee': 1e9 }, 'comparison.carsPerEmployee'],
    [{ 'comparison.buddyUptake': 1.1 }, 'comparison.buddyUptake'],
    [{ 'comparison.renewalDays': { min: 1, max: 91 } }, 'comparison.renewalDays'],
    [{ 'comparison.accessGroups': [{ id: 'invalid', weight: 1, accessSeconds: { min: 2, max: 1 }, responseSeconds: { min: 0, max: 1 } }] }, 'comparison.accessGroups'],
    [{ 'comparison.modelLineMix': [{ modelLine: 'absent', weight: 1 }] }, 'comparison.modelLineMix'],
    [{ 'comparison.releaseCadence': { firstReleaseDay: 90, intervalDays: 1, batchSize: 1 } }, 'comparison.releaseCadence'],
    [{ 'hold.buddy.durationSeconds': 0 }, 'hold.buddy.durationSeconds'],
    [{ 'comparison.seeds': ['duplicate', 'duplicate'] }, 'comparison.seeds'],
    [{ 'comparison.cohortSize': () => 10 }, 'overlay'],
  ];
  for (const [overlay, key] of invalid) assert.throws(() => generate('invalid', { ...small, ...overlay }),
    (error) => rejects(error, key), key);
});

test('explicit corpus configuration references use the existing read port and never silently fall back', async () => {
  const changed = structuredClone(source);
  const set = seedRow(changed, 'comparison.configurationSet.v1').value;
  const fixtures = structuredClone(set.configurations);
  set.kind = 'corpus';
  set.datasetId = 'explicit-corpus-fixture';
  set.version = 'explicit-corpus-fixture';
  set.manifestDigest = 'a'.repeat(64);
  set.configurations = fixtures.map(({ modelLine, configurationId, snapshotVersion }) => ({ modelLine, configurationId, snapshotVersion }));
  const calls = [];
  const corpus = { getConfiguration(configurationId) {
    calls.push(configurationId);
    return { status: 'partial', active: { datasetId: set.datasetId, version: set.version, manifestDigest: set.manifestDigest },
      record: fixtures.find((row) => row.configurationId === configurationId) };
  } };
  const policy = await loadComparisonPolicy({ policyService: fromSeed(changed), policyRead: read, corpus });
  assert.deepEqual(calls, fixtures.map((row) => row.configurationId));
  assert.equal(generate('corpus', small, policy).manifest.configurationSource.kind, 'corpus');
  await assert.rejects(loadComparisonPolicy({ policyService: fromSeed(changed), policyRead: read }),
    (error) => rejects(error, 'comparison.configurationSet.v1', 'configuration-unavailable'));
  for (const returned of [{ status: 'not-found' }, { status: 'source-unavailable' },
    { status: 'partial', active: { datasetId: 'different' }, record: fixtures[0] }]) {
    await assert.rejects(loadComparisonPolicy({ policyService: fromSeed(changed), policyRead: read,
      corpus: { getConfiguration() { return returned; } } }), ComparisonInputError);
  }
});

test('malformed target configuration signatures and missing grade allowances fail closed', async () => {
  const signature = structuredClone(source);
  seedRow(signature, 'comparison.configurationSet.v1').value.configurations[0].configurationId = 'invented-id';
  await assert.rejects(prepare(signature), (error) => rejects(error, 'comparison.configurationSet.v1', 'configuration-signature'));
  const allowance = structuredClone(source);
  allowance.allowances = allowance.allowances.filter((row) => row.gradeId !== 'G7');
  await assert.rejects(prepare(allowance), (error) => rejects(error, 'comparison.gradeDistribution', 'allowance-unavailable'));
});

test('prepared inputs, generated data and complete manifest are immutable independent snapshots', () => {
  const output = generate();
  const again = generate();
  assert.throws(() => { prepared.allowances[0].monthlyPoints = -1; }, TypeError);
  assert.throws(() => { output.employees[0].underlyingNeeds.preferences.body.importance = -1; }, TypeError);
  assert.throws(() => { output.stock.push({}); }, TypeError);
  assert.throws(() => { output.releaseSchedule[0].orderUuids.pop(); }, TypeError);
  assert.throws(() => { output.manifest.assumptions[0].value = null; }, TypeError);
  assert.deepEqual(output, again);
  assert.ok(output.manifest.assumptions.every((row) => row.policyVersion === prepared.policyVersion));
  assert.equal(output.manifest.configurationSource.configurationCount, prepared.configurations.length);
});

test('backend shape fixture supplies the harness and panel contract', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-input-shapes.json', import.meta.url), 'utf8'));
  const output = generate();
  assert.deepEqual(Object.keys(output).sort(), fixture.outputFields);
  assert.deepEqual(Object.keys(output.employees[0]).sort(), fixture.employeeFields);
  assert.deepEqual(Object.keys(output.stock[0]).sort(), fixture.stockFields);
  assert.deepEqual(Object.keys(output.releaseSchedule[0]).sort(), fixture.releaseFields);
  assert.deepEqual(Object.keys(output.manifest).sort(), fixture.manifestFields);
  assert.deepEqual(output.manifest.limitations, fixture.limitations);
});
