import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { vehicleEvidenceDetails } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';

// First actual accepted source32 record, retained unchanged catalogue envelope.
// Source SHA a99f3000b9e8cc9ec369fc5133ce0cde990f8fc80a628b4ad1469e89c9ee2265.
// This exercises DTO consumption; corpus admission and source scale are separate.
const record = JSON.parse(await readFile(new URL('./fixtures/gcsp/vehicle-evidence/catalogue-v2-source-record.json', import.meta.url)));
const request = { kind: 'configuration', id: record.configurationId };
const wire = () => vehicleEvidenceDetails(request, { status: 'partial', record, images: [],
  active: { datasetId: 'v2-consumer-regression', version: '1', manifestDigest: 'a'.repeat(64) } });
const resolve = (result, input = request) => createConfiguredVehicleDetails({ lookup: {
  resolve: () => result, classifyRequest: () => ({ status: 'ok', identityKind: 'synthetic',
    liveEligible: false, configurationId: record.configurationId }) } }).resolve(input);

test('actual v2 source DTO retains factory selection and unknown accessory quantities at the application port', async () => {
  const result = await resolve(wire()); assert.equal(result.status, 'partial');
  assert.deepEqual(result.vehicle.equipment.selected, record.catalogue.equipment.selected);
  assert.deepEqual(result.vehicle.source.resolvedIdentity, record.catalogue.resolvedIdentity);
  assert.deepEqual(result.vehicle.source.references, record.sourceContext.sourceRefs);
  assert.equal(result.vehicle.source.productionDate, null); assert.equal(result.vehicle.source.catalogueValidity, null);
  assert.equal(result.vehicle.completeness.optionDefinitions, record.catalogue.completeness.definitions);
  assert.equal(result.vehicle.completeness.availableOptions, record.catalogue.completeness.availability);
  assert.equal(result.vehicle.equipment.selected.accessories[0].quantity.state, 'unknown');
  assert.equal(result.vehicle.equipment.verifiedFitted.state, 'unknown');
  assert.equal(result.vehicle.presentation.syntheticLabel, 'Synthetic identity');
});

test('v2 consumer refuses identity substitution and malformed or overstated quantity completeness', async () => {
  for (const mutate of [
    (w) => { w.source.resolvedIdentity.bindingDigest = 'b'.repeat(64); },
    (w) => { w.source.requestedIdentity.configurationId = w.source.resolvedIdentity.configurationId = Buffer.from('T5MJ:S0000').toString('base64'); },
    (w) => { w.source.requestedIdentity.snapshotVersion = w.source.resolvedIdentity.snapshotVersion = 'different'; },
  ]) { const w = wire(); mutate(w); assert.equal((await resolve(w)).status, 'identity-mismatch'); }
  for (const mutate of [
    (w) => { w.equipment.selected.accessories[0].quantity.value = 1; },
    (w) => { w.equipment.selected.accessories[0].quantity = 1; },
    (w) => { w.equipment.selected.accessoryQuantitiesComplete = true; },
    (w) => { w.equipment.selected.factoryComplete = 'yes'; },
    (w) => { w.source.requestedIdentity.extra = 'untrusted'; },
    (w) => { w.source.references[0] += '&token=secret'; },
    (w) => { w.source.references[0] = w.source.references[0].replace('prod.ucp.bmw.cloud', 'private.example'); },
  ]) { const w = wire(); mutate(w); assert.equal((await resolve(w)).status, 'source-unavailable'); }
});

// FUCQ-158: retained .7 1F7A/1F7C direct DTOs whose solver citation has a present-empty mandatory-elements value.
const empty = JSON.parse(await readFile(new URL('./fixtures/gcsp/vehicle-evidence/empty-mandatory-elements-cases.json', import.meta.url)));
const consume = (c, result = c.direct) => createConfiguredVehicleDetails({ lookup: { resolve: () => structuredClone(result),
  classifyRequest: () => ({ status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId: c.request.id }) } })
  .resolve({ kind: c.request.kind, id: c.request.id });

test('configured consumer accepts the documented present-empty mandatory-elements citation for both retained models', async () => {
  assert.deepEqual(empty.cases.map((c) => c.vgModelCode), ['1F7A', '1F7C']);
  for (const c of empty.cases) {
    assert.ok(c.direct.source.references.some((r) => r.endsWith('&mandatory-elements=')));
    const result = await consume(c); assert.equal(result.status, 'partial', c.vgModelCode);
    assert.deepEqual(result.vehicle.source.references, c.direct.source.references);
    assert.deepEqual(result.vehicle.identity, c.direct.identity); assert.deepEqual(result.vehicle.equipment, c.direct.equipment);
  }
});

test('configured consumer still rejects malformed v2 solver citations alongside the empty form', async () => {
  const [c] = empty.cases; const at = c.direct.source.references.findIndex((r) => r.includes('/rulesolver/'));
  for (const edit of [
    (r) => `${r}&mandatory-elements=`, (r) => `${r}S01h2`, (r) => `${r}%2C`, (r) => `${r}%2CS01H2`, (r) => `${r}S01`,
    (r) => `${r}%20`, (r) => `${r}&token=secret`, (r) => r.replace('&mandatory-elements=', '&mandatory-element='),
    (r) => r.replace(/included-elements=[^&]*/, 'included-elements='),
    (r) => r.replace('/models/1F7A?', '/models/1F7A/extra?'), (r) => r.replace('https:', 'http:'),
    (r) => `${r}#fragment`,
  ]) {
    const w = structuredClone(c.direct); w.source.references[at] = edit(w.source.references[at]);
    assert.equal((await consume(c, w)).status, 'source-unavailable', w.source.references[at]);
  }
  const w = structuredClone(c.direct); const local = w.source.references.findIndex((r) => r.includes('/localisations/'));
  w.source.references[local] += '?mandatory-elements=';
  assert.equal((await consume(c, w)).status, 'source-unavailable');
});
