import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBmwCatalogueAdapter, presentBmwCatalogue, rejectOutbound } from '../vehicle-evidence/bmw-catalogue-adapter.js';

const evidence = new URL('../../docs/gcsp/evidence/fucq-4/', import.meta.url);
const observations = JSON.parse(await readFile(new URL('observations-2026-11-01.json', evidence)));
const requests = JSON.parse(await readFile(new URL('requests-2026-11-01.json', evidence)));
const retail = requests.requests.find(({ id }) => id === 'retail-pricing').body;
const artifactUrl = new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url);
const sample = () => ({
  market: 'GB', locale: 'en-GB',
  orderDate: '2026-11-01', effectDate: '2027-01-05', productionDate: '2027-01-05', taxDate: '2027-01-05',
  modelCode: 'T5MJ', modelRange: 'G61E', rawModelRange: 'G61', agModelCode: '72HH', trim: 'S0337',
  selectedOptions: [...retail.configuration.selectedOptions],
  selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }],
  selectionComplete: true,
});
const fixture = async () => JSON.parse(await readFile(artifactUrl));

test('resolves only the complete dated observed configuration without outbound traffic', async () => {
  let outbound = 0;
  const adapter = createBmwCatalogueAdapter({ transport: () => { outbound += 1; throw new Error('Outbound attempted'); } });
  const result = await adapter.resolve(sample());
  assert.equal(result.status, 'ok');
  assert.equal(outbound, 0);
  assert.deepEqual(result.requestedIdentity, result.resolvedIdentity);
  assert.equal(result.resolvedIdentity.rawModelRange, observations.model.rawModelRange);
  assert.equal(result.resolvedIdentity.agModelCode, observations.model.agModelCode);
  assert.equal(result.resolvedIdentity.productionDate, '2027-01-05');
  assert.equal(result.resolvedIdentity.selectedOptions.length, 47);
  assert.deepEqual(result.resolvedIdentity.selectedOptions, [...retail.configuration.selectedOptions].sort());
  assert.deepEqual(result.resolvedIdentity.selectedAccessories, sample().selectedAccessories);
  assert.equal(result.provider, 'bmw-catalogue-snapshot');
  assert.equal(result.providerVersion, '1');
  assert.equal(result.schemaVersion, '1');
  assert.equal(result.snapshotVersion, 'bmw-gb-i5-2026-11-01.v1');
  assert.equal(result.sourceKind, 'dated-snapshot');
  assert.equal(result.observedDate, observations.observedDate);
  assert.equal(result.retrievedDate, observations.observedDate);
  assert.equal(result.catalogueValidity.effectDate, '2027-01-05');
  for (const [name, code, definition, unit] of [
    ['seats', 'N_SITZE', 'SEATS', 'COUNT'],
    ['luggageNormal', 'A_GEPR_V211', 'NORMAL', 'LITRES'],
    ['luggageExpanded', 'A_GEPR_V214', 'EXPANDED', 'LITRES'],
    ['acceleration', 'E_0_100KMH', '0–100 KM/H', 'SECONDS'],
  ]) {
    assert.deepEqual(result.facts[name], {
      state: 'known', value: observations.technicalData.values[code].targetValue, definition, unit,
      provenance: { kind: 'observed', source: 'BMW UK catalogue', observedDate: '2026-11-01' },
    });
  }
  assert.equal(result.completeness.measurements, 'complete');
  assert.equal(result.completeness.optionDefinitions, 'partial');
  assert.equal(result.facts.bodyLength.state, 'unknown');
  assert.equal(result.facts.bodyLength.value, null);
});

test('keeps available definitions, complete selection and unknown verified fitting separate', async () => {
  const result = await createBmwCatalogueAdapter().resolve(sample());
  const towbar = result.equipment.definitions.find(({ code }) => code === 'S03AC');
  assert.equal(towbar.label.value, 'Towbar');
  assert.equal(result.equipment.available.codes.includes('S03AC'), true);
  assert.equal(result.equipment.selected.options.includes('S03AC'), false);
  assert.equal(result.equipment.selected.complete, true);
  assert.deepEqual(result.equipment.verifiedFitted, { state: 'unknown', codes: null });
  assert.equal(result.equipment.selected.accessories[0].type, 'accessory');
  const reordered = sample(); reordered.selectedOptions.reverse();
  assert.deepEqual(await createBmwCatalogueAdapter().resolve(reordered), result);
});

test('rejects malformed, duplicate, incomplete and incorrectly typed requests', async () => {
  const adapter = createBmwCatalogueAdapter();
  for (const request of [null, {}, { ...sample(), effectDate: '2027-02-30' },
    { ...sample(), selectionComplete: false }, { ...sample(), selectedOptions: null },
    { ...sample(), selectedOptions: [...sample().selectedOptions, 'P0300'] },
    { ...sample(), selectedAccessories: [{ code: 'SE000001', type: 'option', quantity: 1 }] },
    { ...sample(), selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 0 }] },
  ]) assert.equal((await adapter.resolve(request)).status, 'invalid-input');
});

test('distinguishes unsupported, not found and mismatches without nearest fallback facts', async () => {
  const adapter = createBmwCatalogueAdapter();
  assert.equal((await adapter.resolve({ ...sample(), market: 'US' })).status, 'unsupported');
  assert.equal((await adapter.resolve({ ...sample(), locale: 'de-DE' })).status, 'unsupported');
  assert.equal((await adapter.resolve({ ...sample(), modelCode: 'T3MQ' })).status, 'not-found');
  for (const update of [
    { agModelCode: '22FY' }, { modelRange: 'G21' }, { rawModelRange: 'G61E' }, { trim: 'S07BL' },
    { orderDate: '2026-11-02' }, { effectDate: '2026-11-01' }, { productionDate: '2027-01-06' },
    { taxDate: '2027-01-06' }, { selectedOptions: sample().selectedOptions.slice(1) },
    { selectedOptions: [...sample().selectedOptions, 'S03AC'] }, { selectedAccessories: [] },
  ]) {
    const result = await adapter.resolve({ ...sample(), ...update });
    assert.equal(result.status, 'identity-mismatch');
    assert.equal(result.facts.seats.state, 'unknown');
    assert.equal(result.resolvedIdentity.modelCode, 'T5MJ');
  }
});

test('versions are allowlisted identifiers and unavailable snapshots never expose errors', async () => {
  let loads = 0;
  const adapter = createBmwCatalogueAdapter({ loadSnapshot: async () => { loads += 1; throw new Error('private/file raw payload'); } });
  assert.equal((await adapter.resolve(sample(), { snapshotVersion: '../../secret' })).status, 'unsupported');
  assert.equal(loads, 0);
  const result = await adapter.resolve(sample());
  assert.equal(result.status, 'source-unavailable');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.throws(() => rejectOutbound(), /Outbound transport disabled/);
  const attempting = createBmwCatalogueAdapter({ loadSnapshot: async (version, { transport }) => transport('https://example.invalid') });
  assert.equal((await attempting.resolve(sample())).status, 'source-unavailable');
});

test('curated source fields reconcile with retained evidence without promoting excerpts', async () => {
  const data = await fixture();
  assert.deepEqual(data.selectedOptions, retail.configuration.selectedOptions);
  assert.deepEqual(data.availableOptions, retail.configuration.availableOptions);
  assert.equal(data.model.prodDate, observations.model.prodDate);
  for (const key of Object.keys(data.model)) assert.equal(data.model[key], observations.model[key]);
  for (const [code, entry] of Object.entries(data.definitions)) {
    assert.equal(entry.label, observations.options[code].phrases.longDescription);
    assert.equal(entry.optionType, observations.options[code].optionType);
  }
  const excerpts = JSON.parse(await readFile(new URL('response-excerpts-2026-11-01.json', evidence)));
  assert.equal(excerpts.ruleResult.body.configuration.elements.SE000001.type, data.selectedAccessories[0].type);
  assert.equal(data.curation, 'Selected observed fields, not a complete raw API response');
});

test('missing, empty, placeholder and synthetic facts retain field provenance', async () => {
  const data = await fixture();
  data.measurements.N_SITZE.origin = 'synthetic';
  delete data.measurements.A_GEPR_V211;
  data.measurements.A_GEPR_V214.value = '';
  data.measurements.E_0_100KMH.value = '0000';
  const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  assert.equal(result.status, 'partial');
  assert.equal(result.facts.seats.provenance.kind, 'synthetic');
  for (const key of ['luggageNormal', 'luggageExpanded', 'acceleration']) {
    assert.equal(result.facts[key].state, 'unknown');
    assert.equal(result.facts[key].value, null);
    assert.equal(result.facts[key].provenance.kind, 'unknown');
  }
});

test('projects safe fields and returns isolated copies of the retained sample', async () => {
  const data = await fixture();
  data.garageId = 'private-garage'; data.model.configurationState = 'private-state';
  data.measurements.N_SITZE.html = '<b>secret raw HTML</b>';
  data.model.providerPayload = 'private-payload';
  const adapter = createBmwCatalogueAdapter({ loadSnapshot: async () => data });
  const first = await adapter.resolve({ ...sample(), garageId: 'request-private' });
  const text = JSON.stringify(first);
  for (const forbidden of ['private', 'providerPayload', 'configurationState', '<b>', 'N_SITZE', 'snapshots/', 'pcaso']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  first.resolvedIdentity.selectedOptions.pop(); first.facts.seats.value = 999;
  assert.equal((await adapter.resolve(sample())).facts.seats.value, 5);
  assert.equal((await adapter.resolve(sample())).resolvedIdentity.selectedOptions.length, 47);
});

test('malformed source identity and source metadata are unavailable', async () => {
  for (const mutate of [
    (data) => { data.model.agModelCode = ''; },
    (data) => { data.snapshotVersion = '../bad'; },
    (data) => { data.observedDate = ''; },
    (data) => { data.selectedOptions.pop(); },
  ]) {
    const data = await fixture(); mutate(data);
    assert.equal((await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample())).status, 'source-unavailable');
  }
});

test('presentation examples retain source, observation and future January context', async () => {
  const doc = await readFile(new URL('../../docs/gcsp/bmw-catalogue-adapter.md', import.meta.url), 'utf8');
  for (const required of ['BMW UK catalogue', '1 November 2026', '5 January 2027',
    '570 litres (normal)', '1700 litres (expanded)', '6.1 seconds from 0–100 km/h',
    'not a VIN build', 'not verified fitted equipment', 'not released scheme stock', 'not a live lookup']) {
    assert.equal(doc.includes(required), true, required);
  }
  assert.equal(doc.includes('—'), false);
});

test('presentation text uses projected dates, units and per-field provenance', async () => {
  const adapter = createBmwCatalogueAdapter();
  const result = await adapter.resolve(sample());
  const presentation = presentBmwCatalogue(result);
  assert.equal(presentation.source, 'BMW UK catalogue, observed 1 November 2026');
  assert.equal(presentation.context, 'Order: 1 November 2026. Effect: 5 January 2027. Production: 5 January 2027. Tax: 5 January 2027. Future catalogue context relative to observation.');
  assert.deepEqual(presentation.measurements, [
    '5 seats (observed)', '570 litres (normal, observed)', '1700 litres (expanded, observed)',
    '6.1 seconds from 0–100 km/h (observed)',
  ]);
  result.facts.acceleration.value = 7.3;
  result.facts.acceleration.provenance.kind = 'synthetic';
  result.facts.luggageNormal = { state: 'unknown', value: null };
  result.catalogueValidity.effectDate = '2027-01-06';
  const changed = presentBmwCatalogue(result);
  assert.equal(changed.measurements[1], 'Luggage (normal): unknown');
  assert.equal(changed.measurements[3], '7.3 seconds from 0–100 km/h (synthetic)');
  assert.match(changed.context, /Effect: 6 January 2027/);
  assert.equal(JSON.stringify(changed).includes('—'), false);
  assert.equal(presentBmwCatalogue(await adapter.resolve({ ...sample(), modelCode: 'T3MQ' })).measurements.length, 0);
});
