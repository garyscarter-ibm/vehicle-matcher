import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVinProfileRegistry, presentVinProfile } from '../gcsp/vehicle-evidence/vin-profiles.js';

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url)));
const data = await load('../data/gcsp/vehicle-evidence/vin-profiles.v1.json');
const { fixtures } = await load('./fixtures/gcsp/vehicle-evidence/five-wmi-reference-configurations.json');
const evidence = await load('../../docs/gcsp/evidence/fucq-4/bmw-vin-rules-2026-11-01.json');
const request = (fixture = fixtures[0], overrides = {}) => ({ ...fixture.configuration, ...overrides });
const options = (fixture = fixtures[0], overrides = {}) => ({ profileId: fixture.profileId,
  usage: fixture.usage, referenceOnly: fixture.referenceOnly, ...overrides });

test('five exact MY2026 North American references resolve offline for delivered/current cars', async () => {
  const registry = createVinProfileRegistry();
  assert.deepEqual(fixtures.map(({ profileId }) => data.profiles.find((p) => p.profileId === profileId).format.wmi),
    ['WBA', 'WBS', 'WBY', '5UX', '5YM']);
  for (const fixture of fixtures) {
    for (const usage of ['current-car', 'delivered-car']) {
      const result = await registry.resolve(request(fixture), options(fixture, { usage }));
      assert.equal(result.status, 'ok');
      assert.equal(result.registryVersion, 'vin-profiles.v1');
      assert.equal(result.identityScope, 'delivered-and-current-cars-only');
      assert.deepEqual(result.requestedIdentity, result.resolvedIdentity);
      assert.equal(result.profile.profileVersion, '1');
      assert.equal(result.profile.referenceOnly, true);
      assert.equal(result.profile.format.position10.value, 'T');
      assert.equal(result.profile.format.descriptor.kind, 'whole-value');
      assert.equal(result.profile.format.serial.status, 'fictional-allocation');
    }
  }
});

test('stock/corpus use and unlabelled reference use fail before any profile loading', async () => {
  let loads = 0;
  const registry = createVinProfileRegistry({ loadRegistry: async () => { loads += 1; return data; } });
  for (const usage of ['stock', 'corpus', 'offered-car', '', null, undefined]) {
    assert.equal((await registry.resolve(request(), options(undefined, { usage }))).status, 'unsupported');
  }
  assert.equal((await registry.resolve(request(), options(undefined, { referenceOnly: false }))).status, 'unsupported');
  assert.equal(loads, 0);
});

test('market/steering, body/generation, powertrain, drive, year and plant mismatch before generation', async () => {
  const registry = createVinProfileRegistry();
  for (const fixture of fixtures) {
    for (const change of [{ market: 'GB' }, { region: 'Europe' }, { steering: 'RHD' },
      { generation: 'G61' }, { body: 'Touring' }, { powertrain: 'diesel' }, { drive: 'unverified-drive' },
      { derivative: 'similarly named newer derivative' }, { modelYear: 2027 }, { productionEra: 'MY2027' },
      { wmi: '3MF' }, { descriptor: '72HH0' },
      { plant: fixture.configuration.plant === '9' ? 'C' : '9' },
      { transmission: 'automatic' }, { engineCode: 'unverified-engine' }, { agModelCode: '72HH' },
      { productionDate: '2027-01-05' }]) {
      const result = await registry.resolve(request(fixture, change), options(fixture));
      assert.equal(result.status, 'identity-mismatch', JSON.stringify(change));
      assert.equal(result.profile, null);
      assert.equal(result.resolvedIdentity, null);
      assert.ok(result.mismatchedFields.includes(Object.keys(change)[0]));
    }
  }
  assert.equal((await registry.resolve(request(fixtures[2], { effectDate: '2027-01-05' }), options(fixtures[2]))).status, 'ok');
  const missingYear = request(); delete missingYear.modelYear;
  assert.equal((await registry.resolve(missingYear, options())).status, 'invalid-input');
});

test('exact descriptors and plant allocations reconcile to the retained source context', async () => {
  for (const fixture of fixtures) {
    const profile = data.profiles.find(({ profileId }) => profileId === fixture.profileId);
    const format = profile.format;
    assert.ok(evidence.descriptors.some((row) => row.wmi === format.wmi
      && row.vds === format.descriptor.value && row.modelYear === profile.binding.modelYear
      && row.sourceId === 'BMW-565-MY2026'));
    const partial = evidence.partialPatternChecks.results.find((row) => row.partialPattern
      === `${format.wmi}${format.descriptor.value}*T${fixture.configuration.plant}`);
    assert.ok(partial);
    assert.equal(partial.PlantCity.toLowerCase(), format.allowedPlants[0].city.toLowerCase());
    assert.equal(profile.evidence.partialDecode.httpStatus, partial.httpStatus);
    assert.equal(profile.evidence.partialDecode.businessCode, partial.ErrorCode);
    assert.equal(profile.evidence.partialDecode.completeVinDecoded, false);
    assert.equal(format.allowedPlants.length, 1);
    assert.notEqual(profile.binding.generation, format.descriptor.value);
    assert.equal(profile.binding.agModelCode, null);
    for (const fact of profile.evidence.facts) {
      for (const ref of fact.sourceRefs) {
        const source = data.sources.find(({ id }) => id === ref);
        assert.ok(source.source);
        assert.match(source.observedDate, /^\d{4}-\d{2}-\d{2}$/);
      }
    }
  }
});

test('UK observations are candidate-only with unresolved semantics and no generating profile', async () => {
  const registry = createVinProfileRegistry();
  const result = await registry.list();
  const candidates = result.profiles.filter(({ status }) => status === 'candidate');
  assert.deepEqual(candidates.map(({ profileId }) => profileId), ['UK-OBS-001', 'UK-OBS-002']);
  for (const candidate of candidates) {
    assert.equal(candidate.binding.market, null);
    assert.equal(candidate.binding.steering, null);
    assert.equal(candidate.format.position10.observedValue, '0');
    assert.equal(candidate.format.position9.convention, 'unresolved');
    assert.ok(candidate.evidence.unresolvedFacts.includes('second distinct corroborating vehicle'));
    assert.equal((await registry.resolve(request(), options(undefined, { profileId: candidate.profileId }))).status, 'unsupported');
  }
});

test('preserves additional evidenced WMIs without enabling or guessing incomplete profiles', async () => {
  const registry = createVinProfileRegistry();
  const result = await registry.list();
  assert.deepEqual(result.additionalWmiReferences, evidence.descriptors.filter((row) => evidence.otherBmwWmisInFilings.includes(row.wmi)));
  for (const [model, wmi] of [['M2 Coupe', '3MF'], ['iX xDrive45', 'WB5'], ['iX3 50 xDrive', 'WBX']]) {
    assert.ok(result.additionalWmiReferences.some((row) => row.model === model && row.wmi === wmi));
    assert.equal((await registry.resolve(request(undefined, { model }), options(undefined, { profileId: model }))).status, 'unsupported');
  }
});

test('presentation exposes reference-only context, confidence, unknowns and incomplete decoder status', async () => {
  for (const fixture of fixtures) {
    const resolved = await createVinProfileRegistry().resolve(request(fixture), options(fixture));
    const presentation = presentVinProfile(resolved);
    assert.match(presentation.context, /US.*North America.*LHD/);
    assert.equal(presentation.referenceOnly, true);
    assert.match(presentation.notice, /reference only/);
    assert.match(presentation.confidence, /Manufacturer-filed/);
    assert.ok(presentation.unknownFields.includes('transmission'));
    assert.ok(presentation.unknownFields.includes('engineCode'));
    assert.equal(resolved.equipment.verifiedFitted.state, 'unknown');
    assert.equal(resolved.equipment.verifiedFitted.codes, null);
    assert.match(presentation.decodeStatus, /6 - Incomplete VIN/);
    assert.equal(presentation.completeVinDecoded, false);
    assert.ok(presentation.sources.every(({ observedDate }) => observedDate));
    assert.equal(JSON.stringify(presentation).includes('—'), false);
  }
  assert.equal(presentVinProfile({ status: 'identity-mismatch' }).context, null);
});

test('unsupported versions, unavailable or invalid registry remain explicit and private', async () => {
  let loads = 0;
  const unavailable = createVinProfileRegistry({ loadRegistry: async () => { loads += 1; throw Error('private payload'); } });
  assert.equal((await unavailable.resolve(request(), options(undefined, { registryVersion: '../../private' }))).status, 'unsupported');
  assert.equal(loads, 0);
  assert.equal((await unavailable.resolve(request(), options())).status, 'source-unavailable');
  assert.equal((await unavailable.list()).status, 'source-unavailable');
  for (const mutate of [(r) => { r.schemaVersion = '2'; }, (r) => { r.profiles[0].format.allowedPlants = []; },
    (r) => { r.profiles[0].evidence.sourceRefs = ['missing']; }, (r) => { r.profiles[0].binding.modelYear = null; },
    (r) => { r.profiles[0].format.descriptor.value = '33DBQ'; }, (r) => { r.profiles.push(r.profiles[0]); },
    (r) => { r.profiles.find((p) => p.status === 'candidate').status = 'enabled'; }]) {
    const corrupt = structuredClone(data); mutate(corrupt);
    assert.equal((await createVinProfileRegistry({ loadRegistry: async () => corrupt }).resolve(request(), options())).status, 'source-unavailable');
  }
});

test('safe requests and isolated outputs exclude personal identities and raw extension fields', async () => {
  const registry = createVinProfileRegistry();
  const result = await registry.resolve(request(undefined, { privateInput: 'do-not-return' }), options());
  assert.equal(JSON.stringify(result).includes('do-not-return'), false);
  result.profile.binding.model = 'mutated'; result.sources.pop();
  assert.equal((await registry.resolve(request(), options())).profile.binding.model, '430i');
  const listing = await registry.list(); listing.profiles.pop();
  assert.equal((await registry.list()).profiles.length, 7);
  for (const artifact of [data, fixtures]) {
    const text = JSON.stringify(artifact);
    assert.equal(/[A-HJ-NPR-Z0-9]{17}/.test(text), false);
    for (const name of ['vin17', 'vin7', 'registrationPlate', 'serialNumber', 'identityHash', 'capture', 'partialPattern']) {
      assert.equal(text.includes(`\"${name}\"`), false, name);
    }
  }
});
