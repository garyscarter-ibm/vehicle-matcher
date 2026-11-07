import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as catalogue from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { syntheticV2, rebind, V2_OPTIONS, unknown, known, ref } from './helpers/bmw-catalogue-v2-synthetic.js';

const validate = (fixture, raw = JSON.stringify(fixture.envelope)) => {
  assert.equal(typeof catalogue.validateBmwCatalogueV2Envelope, 'function', 'closed v2 envelope validator is required');
  return catalogue.validateBmwCatalogueV2Envelope(raw, fixture.trusted);
};
const rejected = (fixture, raw) => {
  assert.deepEqual(validate(fixture, raw), { status: 'invalid', code: 'invalid-v2-envelope', admission: false,
    envelope: null, lookupIdentity: null });
};
const identityRequest = (fixture) => ({ configurationId: fixture.envelope.lookupIdentity.configurationId,
  bindingDigest: fixture.envelope.lookupIdentity.bindingDigest });

test('v2 complete synthetic selection preserves unknown metadata and accessory quantity without admission', async () => {
  const fixture = await syntheticV2();
  const before = JSON.stringify(fixture.envelope);
  const result = validate(fixture);
  assert.equal(result.status, 'valid');
  assert.equal(result.admission, false);
  assert.deepEqual(result.envelope, fixture.envelope);
  assert.deepEqual(result.lookupIdentity, fixture.envelope.lookupIdentity);
  assert.deepEqual(result.envelope.sourceBinding.optionalFacts.trim, unknown());
  assert.deepEqual(result.envelope.sourceBinding.optionalFacts.catalogueProductionDate, unknown());
  assert.deepEqual(result.envelope.sourceBinding.selection.accessories,
    [{ code: 'SE000001', type: 'accessory', quantity: unknown('quantity-not-exposed') }]);
  assert.equal(Object.values(result.envelope.facts).every((fact) => fact.state === 'unknown'), true);
  assert.equal(result.envelope.status, 'partial');
  assert.equal(result.envelope.sourceBinding.requestScope.requests[0].effectDate, '2027-01-01');
  assert.equal(result.envelope.sourceBinding.confirmedContext.effectDate.value, '2027-02-01');
  assert.equal(Object.hasOwn(result.envelope.sourceBinding.evidence[0], 'effectDate'), false);
  result.envelope.sourceBinding.selection.accessories.length = 0;
  assert.equal(JSON.stringify(fixture.envelope), before);
  assert.deepEqual(fixture.accepted, []);
});

test('v2 configuration identity uses actual VG policy key while binding includes exact unknown states', async () => {
  const first = await syntheticV2();
  const expected = first.trusted.configurationKey(first.envelope.sourceBinding.canonicalIdentity);
  assert.equal(first.envelope.lookupIdentity.configurationId, expected.configurationId);
  assert.equal(Buffer.from(expected.configurationId, 'base64').toString(), 'T5MJ:P0300,S0337,S0456,WFKSW');
  assert.equal(first.envelope.lookupIdentity.bindingDigest, inputDigest(first.envelope.sourceBinding));
  const second = await syntheticV2({ quantity: 2 });
  assert.equal(validate(second).status, 'valid');
  assert.equal(second.envelope.lookupIdentity.configurationId, first.envelope.lookupIdentity.configurationId);
  assert.notEqual(second.envelope.lookupIdentity.bindingDigest, first.envelope.lookupIdentity.bindingDigest);
  const stale = structuredClone(first.envelope.lookupIdentity);
  second.envelope.requestedIdentity.bindingDigest = stale.bindingDigest;
  rejected(second);
});

test('v2 dispatch requires the entire explicit tuple and never infers a version from nullable fields', async () => {
  const fixture = await syntheticV2();
  const request = identityRequest(fixture);
  assert.deepEqual(catalogue.bmwCatalogueLookupIdentity(request, V2_OPTIONS), fixture.envelope.lookupIdentity);
  assert.equal(catalogue.bmwCatalogueLookupIdentity(request), null);
  for (const patch of [{ provider: 'other' }, { providerVersion: '1' }, { schemaVersion: '1' },
    { sourceContractVersion: 'other.v1' }, { sourceContractVersion: undefined }, { snapshotVersion: '../private' }]) {
    assert.equal(catalogue.bmwCatalogueLookupIdentity(request, { ...V2_OPTIONS, ...patch }), null);
  }
  for (const field of Object.keys(V2_OPTIONS)) {
    const options = { ...V2_OPTIONS }; delete options[field];
    assert.equal(catalogue.bmwCatalogueLookupIdentity(request, options), null);
  }
  for (const patch of [{ trim: null }, { productionDate: null }, { bindingDigest: 'A'.repeat(64) },
    { bindingDigest: '../private' }, { configurationId: 'not-base64' }, { configurationId: Buffer.from('72HH:P0300').toString('base64') + '=' }]) {
    assert.equal(catalogue.bmwCatalogueLookupIdentity({ ...request, ...patch }, V2_OPTIONS), null);
  }
});

test('v2 unregistered lookup fails unsupported before snapshot or outbound transport', async (context) => {
  const fixture = await syntheticV2();
  let loads = 0; let outbound = 0;
  const stop = () => { outbound += 1; throw new Error('synthetic contract forbids outbound'); };
  context.mock.method(globalThis, 'fetch', stop);
  for (const module of ['node:http', 'node:https']) {
    const { default: transport } = await import(module);
    context.mock.method(transport, 'get', stop); context.mock.method(transport, 'request', stop);
  }
  const adapter = catalogue.createBmwCatalogueAdapter({ loadSnapshot: async () => { loads += 1; throw new Error('must not load'); }, transport: stop });
  const result = await adapter.resolve(identityRequest(fixture), V2_OPTIONS);
  assert.equal(result.status, 'unsupported');
  assert.equal(result.failure.code, 'unsupported-snapshot');
  assert.deepEqual(Object.keys(result).sort(), Object.keys(fixture.envelope).sort());
  assert.equal(result.sourceBinding, null);
  for (const section of ['available', 'selected', 'verifiedFitted']) {
    assert.deepEqual(Object.keys(result.equipment[section]).sort(), Object.keys(fixture.envelope.equipment[section]).sort());
    assert.equal(result.equipment[section].state, 'unknown');
  }
  assert.deepEqual(Object.keys(result.completeness).sort(), Object.keys(fixture.envelope.completeness).sort());
  assert.equal(Object.values(result.completeness).every((value) => value === 'unknown'), true);
  assert.equal(result.equipment.selected.factoryComplete, false);
  assert.equal(result.equipment.selected.accessoryCodesComplete, false);
  assert.equal(result.equipment.selected.accessoryQuantitiesComplete, false);
  assert.deepEqual(Object.fromEntries(Object.keys(V2_OPTIONS).map((field) => [field, result[field]])), V2_OPTIONS);
  assert.deepEqual(result.lookupIdentity, fixture.envelope.lookupIdentity);
  assert.deepEqual(result.requestedIdentity, fixture.envelope.requestedIdentity);
  assert.equal(result.resolvedIdentity, null);
  assert.equal(result.resolvedLookupIdentity, null);
  assert.equal(Object.values(result.facts).every((fact) => fact.state === 'unknown'), true);
  assert.equal(validate(fixture).admission, false);
  for (const field of Object.keys(V2_OPTIONS)) {
    const options = { ...V2_OPTIONS }; delete options[field];
    assert.equal((await adapter.resolve(identityRequest(fixture), options)).status, 'invalid-input');
  }
  assert.equal((await adapter.resolve(identityRequest(fixture), { ...V2_OPTIONS, schemaVersion: '1' })).status, 'invalid-input');
  assert.equal(loads, 0); assert.equal(outbound, 0);
});

test('v2 raw JSON rejects duplicate, unexpected, missing, prototype and over-limit data', async () => {
  const fixture = await syntheticV2();
  const raw = JSON.stringify(fixture.envelope);
  for (const text of [null, fixture.envelope, '{', 'null', '[]', raw.replace('"schemaVersion":"2"', '"schemaVersion":"2","schemaVersion":"2"'),
    raw.replace('"state":"unknown"', '"state":"unknown","st\\u0061te":"unknown"'),
    raw.replace('"sourceKind":"dated-snapshot"', '"sourceKind":"dated-snapshot","__proto__":{}'),
    raw.replace('"sourceKind":"dated-snapshot",', ''),
    raw.replace('"sourceKind":"dated-snapshot"', '"sourceKind":"dated-snapshot","privateHeader":"secret"'),
    raw + ' '.repeat(2 * 1024 * 1024)]) rejected(fixture, text);
  for (const mutate of [
    (value) => { value.sourceBinding.selection.elements[0].unexpected = true; },
    (value) => { delete value.sourceBinding.optionalFacts.trim; },
    (value) => { value.sourceBinding.evidence = Array.from({ length: 17 }, () => value.sourceBinding.evidence[0]); },
    (value) => { value.sourceBinding.selection.accessories = Array.from({ length: 65 }, () => value.sourceBinding.selection.accessories[0]); },
    (value) => { value.sourceBinding.selection.factoryOptionCodes = Array.from({ length: 257 }, (_, i) => `S${String(i).padStart(4, '0')}`); },
  ]) { const next = await syntheticV2(); mutate(next.envelope); rejected(next); }
});

test('v2 rejects model date request and producer association drift even after digest refresh', async () => {
  for (const mutate of [
    (value) => { value.sourceBinding.confirmedContext.modelCode.value = 'T3MQ'; },
    (value) => { value.sourceBinding.canonicalIdentity.agModelCode = '22FY'; },
    (value) => { value.sourceBinding.confirmedContext.orderDate.value = '2026-11-07'; },
    (value) => { value.sourceBinding.confirmedContext.effectDate.value = '2027-02-30'; },
    (value) => { value.sourceBinding.requestScope.requests[1].effectDate = '2027-01-01'; },
    (value) => { value.sourceBinding.requestScope.requests[1].url += '&effectDate=2027-03-01'; },
    (value) => { value.sourceBinding.evidence[0].request.url += '&modelCode=T3MQ'; },
    (value) => { value.sourceBinding.producerPins.policyVersion = 'other-policy'; },
    (value) => { value.sourceBinding.producerPins.sessionSha256 = 'f'.repeat(64); },
    (value) => { value.observedDate = '2026-11-07'; },
    (value) => { value.retrievedDate = '2026-11-07'; },
    (value) => { value.sourceBinding.evidence[0].retrievedAt = null; },
  ]) { const next = await syntheticV2(); mutate(next.envelope); rebind(next); rejected(next); }
});

test('v2 rejects unbound references hashes roles and duplicate evidence identities', async () => {
  for (const mutate of [
    (value) => { value.sourceBinding.confirmedContext.modelCode.evidenceRefs = [ref('missing', 'modelCode')]; },
    (value) => { value.sourceBinding.confirmedContext.modelCode.evidenceRefs = [ref('tree', 'missing')]; },
    (value) => { value.sourceBinding.confirmedContext.modelCode.evidenceRefs = [ref('solver', 'modelCode')]; },
    (value) => { value.sourceBinding.selection.evidenceRefs = [ref('tree', 'modelCode')]; },
    (value) => { value.sourceBinding.evidence[0].responseSha256 = 'F'.repeat(64); },
    (value) => { value.sourceBinding.evidence[0].retainedSha256 = 'f'.repeat(64); },
    (value) => { value.sourceBinding.evidence[0].locators[0].sourcePointer = '/bad~2escape'; },
    (value) => { value.sourceBinding.evidence[0].locators.push(value.sourceBinding.evidence[0].locators[0]); },
    (value) => { value.sourceBinding.evidence.push(value.sourceBinding.evidence[0]); },
    (value) => { value.sourceBinding.evidence[0].request.headers = { authorization: 'private' }; },
  ]) { const next = await syntheticV2(); mutate(next.envelope); rebind(next); rejected(next); }
});

test('v2 selected partitions completeness and solver changes cannot invent or discard a selected accessory', async () => {
  for (const mutate of [
    (value) => { value.sourceBinding.selection.constructible = false; },
    (value) => { value.sourceBinding.selection.factoryComplete = false; },
    (value) => { value.sourceBinding.selection.accessoryCodesComplete = false; },
    (value) => { value.sourceBinding.selection.elements.pop(); },
    (value) => { value.sourceBinding.selection.elements.push(value.sourceBinding.selection.elements[0]); },
    (value) => { value.sourceBinding.selection.elements.find(({ code }) => code === 'SE000001').type = 'option'; },
    (value) => { value.sourceBinding.selection.accessories = []; },
    (value) => { value.sourceBinding.selection.accessories[0].quantity = 1; },
    (value) => { value.sourceBinding.selection.accessories[0].quantity = known(0, 'solver', 'elements'); },
    (value) => { value.sourceBinding.selection.solverChanges.added = []; },
    (value) => { value.sourceBinding.selection.solverChanges.removed = ['P0300']; },
    (value) => { value.equipment.selected.accessories = []; },
    (value) => { value.equipment.selected.accessoryQuantitiesComplete = true; },
    (value) => { value.equipment.selected.complete = true; },
    (value) => { value.completeness.accessoryQuantities = 'complete'; },
    (value) => { value.status = 'ok'; },
  ]) { const next = await syntheticV2(); mutate(next.envelope); rebind(next); rejected(next); }
});

test('v2 unknown metadata is exact and cannot be promoted from a package effect date or source label', async () => {
  for (const mutate of [
    (value) => { value.sourceBinding.optionalFacts.trim = known('S0337', 'solver', 'elements'); },
    (value) => { value.sourceBinding.optionalFacts.catalogueProductionDate = known('2027-02-01', 'tree', 'effectDate'); },
    (value) => { value.sourceBinding.optionalFacts.physicalProductionDate = known('2027-02-01', 'tree', 'effectDate'); },
    (value) => { value.sourceBinding.optionalFacts.modelYear = known(2027, 'tree', 'effectDate'); },
    (value) => { value.sourceBinding.optionalFacts.plant = known('SYNTHETIC', 'tree', 'rawModelRange'); },
    (value) => { value.sourceBinding.optionalFacts.verifiedFitted = known(['S0337'], 'solver', 'elements'); },
    (value) => { value.sourceBinding.optionalFacts.trim.value = 'S0337'; },
    (value) => { value.sourceBinding.optionalFacts.trim.evidenceRefs = [ref('tree', 'modelCode')]; },
    (value) => { value.sourceBinding.optionalFacts.trim.reason = 'wildcard'; },
    (value) => { value.sourceBinding.confirmedContext.orderDate = unknown(); },
  ]) { const next = await syntheticV2(); mutate(next.envelope); rebind(next); rejected(next); }
});

test('v2 envelope version identity facts and nested output keys remain closed', async () => {
  for (const mutate of [
    (value) => { value.schemaVersion = '1'; }, (value) => { value.providerVersion = '1'; },
    (value) => { value.sourceContractVersion = 'other.v1'; },
    (value) => { value.lookupIdentity.configurationId = Buffer.from('72HH:P0300,S0337').toString('base64'); },
    (value) => { value.lookupIdentity.bindingDigest = 'f'.repeat(64); },
    (value) => { value.resolvedIdentity = null; }, (value) => { value.resolvedLookupIdentity = null; },
    (value) => { value.sourceBinding = null; }, (value) => { value.failure = { code: 'private' }; },
    (value) => { value.facts.seats = { ...value.facts.seats, state: 'known', value: 5, reason: null }; },
    (value) => { value.facts.private = value.facts.seats; },
    (value) => { value.equipment.selected.provenance.private = true; },
  ]) { const next = await syntheticV2(); mutate(next.envelope); rejected(next); }
});

test('v2 binding evidence ordering remains normalized even when trusted pins agree', async () => {
  const fixture = await syntheticV2();
  fixture.envelope.sourceBinding.evidence.reverse();
  fixture.trusted.evidencePins.reverse();
  rebind(fixture);
  rejected(fixture);
});

test('v2 source accessory type remains authoritative without inferring it from a code prefix', async () => {
  const fixture = await syntheticV2({ accessoryCode: 'A0000001' });
  const result = validate(fixture);
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.envelope.sourceBinding.selection.accessories,
    [{ code: 'A0000001', type: 'accessory', quantity: unknown('quantity-not-exposed') }]);
});
