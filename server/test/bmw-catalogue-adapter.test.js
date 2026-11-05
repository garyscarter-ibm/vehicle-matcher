import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as catalogue from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { createBmwCatalogueAdapter, presentBmwCatalogue, rejectOutbound } from '../vehicle-evidence/bmw-catalogue-adapter.js';

const evidence = new URL('../../docs/gcsp/evidence/fucq-4/', import.meta.url);
const observations = JSON.parse(await readFile(new URL('observations-2026-11-01.json', evidence)));
const requests = JSON.parse(await readFile(new URL('requests-2026-11-01.json', evidence)));
const retail = requests.requests.find(({ id }) => id === 'retail-pricing').body;
const artifactUrl = new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url);
const sample = () => ({
  market: 'GB', locale: 'en-GB', catalogueDate: '2026-11-01',
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
      state: 'known', value: observations.technicalData.values[code].targetValue, definition, unit, completeness: 'complete',
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
  assert.equal((await adapter.resolve(sample(), { snapshotVersion: '../../secret' })).status, 'invalid-input');
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


test('option claims distinguish definitions, availability, catalogue selection and VIN fitting', async () => {
  assert.equal(typeof catalogue.describeBmwEquipment, 'function');
  const result = await createBmwCatalogueAdapter().resolve(sample());
  const paint = catalogue.describeBmwEquipment(result, 'P0300');
  assert.equal(paint.definition.label, 'Alpine White');
  assert.equal(paint.catalogueSelection.state, 'selected');
  assert.equal(catalogue.describeBmwEquipment(result, 'FKSFU').catalogueSelection.state, 'selected');
  const alternative = catalogue.describeBmwEquipment(result, 'P0475');
  assert.equal(alternative.configurableAvailability.state, 'available');
  assert.equal(alternative.catalogueSelection.state, 'not-selected');
  const towbar = catalogue.describeBmwEquipment(result, 'S03AC');
  assert.equal(towbar.definition.state, 'defined');
  assert.equal(towbar.catalogueSelection.state, 'not-selected');
  assert.equal(towbar.verifiedVinFitted.state, 'unknown');
  assert.equal(towbar.verifiedVinFitted.reason, 'provider-does-not-verify-fitting');
  assert.equal(catalogue.describeBmwEquipment(result, 'S0XYZ').configurableAvailability.state, 'unknown');
  assert.equal(catalogue.describeBmwEquipment(result, 'invalid<script>'), null);
  result.equipment.definitions.find(({ code }) => code === 'P0475').label.value = 'Alpine White';
  assert.equal(catalogue.describeBmwEquipment(result, 'P0475').catalogueSelection.state, 'not-selected');
  for (const claim of [paint.definition, paint.configurableAvailability, paint.catalogueSelection]) {
    assert.equal(claim.provenance.source, 'BMW UK catalogue');
    assert.equal(claim.provenance.observedDate, '2026-11-01');
  }
  assert.equal(paint.definition.kind, 'option-definition');
  assert.equal(paint.configurableAvailability.kind, 'configurable-availability');
  assert.equal(paint.catalogueSelection.kind, 'selected-catalogue-equipment');
  assert.equal(paint.verifiedVinFitted.kind, 'verified-vin-fitted-equipment');
});

test('partial selection does not turn absent equipment into a negative claim', async () => {
  const data = await fixture();
  data.equipmentEvidence = { ...data.equipmentEvidence, selected: {
    ...data.equipmentEvidence?.selected, completeness: 'partial',
  } };
  const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  assert.equal(result.status, 'partial');
  assert.equal(result.equipment.selected.complete, false);
  assert.equal(result.completeness.selectedConfiguration, 'partial');
  assert.equal(result.facts.seats.value, 5);
  assert.equal(catalogue.describeBmwEquipment(result, 'P0300').catalogueSelection.state, 'selected');
  assert.equal(catalogue.describeBmwEquipment(result, 'S03AC').catalogueSelection.state, 'unknown');
  assert.equal(catalogue.describeBmwEquipment(result, 'S03AC').catalogueSelection.reason, 'incomplete-selection');
});

test('missing or malformed equipment sections preserve attributed technical facts', async () => {
  for (const change of [
    (data) => { delete data.availableOptions; },
    (data) => { data.availableOptions = ['S03AC', 'S03AC']; },
    (data) => { delete data.definitions; },
    (data) => { data.definitions = []; },
    (data) => { delete data.equipmentEvidence?.selected; },
    (data) => { delete data.availableOptions; delete data.equipmentEvidence?.selected; },
  ]) {
    const data = await fixture(); change(data);
    const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
    assert.equal(result.status, 'partial');
    assert.equal(result.facts.luggageNormal.value, 570);
    assert.equal(result.facts.luggageNormal.provenance.observedDate, '2026-11-01');
    assert.equal(catalogue.describeBmwEquipment(result, 'S03AC').verifiedVinFitted.state, 'unknown');
    if (!data.equipmentEvidence?.selected) {
      assert.equal(result.equipment.selected.state, 'unknown');
      assert.equal(result.equipment.selected.options, null);
      assert.equal(result.equipment.selected.complete, false);
      const towbar = catalogue.describeBmwEquipment(result, 'S03AC');
      assert.equal(towbar.definition.state, 'defined');
      assert.equal(towbar.catalogueSelection.state, 'unknown');
    }
  }
});

test('unknown measurements carry useful reasons while evidenced numeric zero survives', async () => {
  for (const [value, reason] of [
    [undefined, 'missing-value'], [null, 'missing-value'], ['', 'missing-value'],
    ['-', 'placeholder-value'], ['0000', 'placeholder-value'], ['N/A', 'placeholder-value'],
    ['12x', 'malformed-value'], ['0', 'malformed-value'], [-1, 'malformed-value'],
    [NaN, 'malformed-value'], [Infinity, 'malformed-value'], [false, 'malformed-value'],
  ]) {
    const data = await fixture(); data.measurements.A_GEPR_V211.value = value;
    const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
    assert.equal(result.status, 'partial');
    assert.equal(result.facts.luggageNormal.state, 'unknown', String(value));
    assert.equal(result.facts.luggageNormal.reason, reason, String(value));
    assert.equal(result.facts.seats.value, 5);
  }
  const data = await fixture();
  data.measurements.A_GEPR_V211.value = 0;
  data.measurements.A_GEPR_V211.observedDate = '2026-10-31';
  data.measurements.A_GEPR_V211.source = 'BMW UK OTD';
  data.measurements.A_GEPR_V211.completeness = 'partial';
  const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  assert.equal(result.facts.luggageNormal.state, 'known');
  assert.equal(result.facts.luggageNormal.value, 0);
  assert.equal(result.facts.luggageNormal.provenance.source, 'BMW UK OTD');
  assert.equal(result.facts.luggageNormal.provenance.observedDate, '2026-10-31');
  assert.equal(result.facts.luggageNormal.completeness, 'partial');
  assert.equal(result.facts.bodyLength.state, 'unknown');
  assert.equal(result.facts.bodyLength.reason, 'placeholder-value');
  assert.equal(result.status, 'partial');
  assert.equal(presentBmwCatalogue(result).measurements[1], '0 litres (normal, observed)');
});

test('unsupported meanings and units cannot become supported technical facts', async () => {
  for (const [field, value, reason] of [
    ['unit', 'GALLONS', 'unmapped-unit'], ['definition', '0–62 MPH', 'unmapped-meaning'],
    ['unit', undefined, 'unmapped-unit'], ['observedDate', 'bad', 'invalid-provenance'],
    ['source', 'https://private.invalid/vin/secret', 'invalid-provenance'],
  ]) {
    const data = await fixture(); data.measurements.A_GEPR_V211[field] = value;
    const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
    assert.equal(result.facts.luggageNormal.state, 'unknown');
    assert.equal(result.facts.luggageNormal.reason, reason);
    assert.equal(JSON.stringify(result).includes('private.invalid'), false);
  }
  const data = await fixture();
  data.measurements.UNKNOWN_CODE = { value: 99, unit: 'UNKNOWN' };
  data.modelTree.length.value = 5060;
  const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  assert.equal(result.status, 'partial');
  assert.equal(result.facts.bodyLength.state, 'unknown');
  assert.equal(result.facts.bodyLength.reason, 'unmapped-source');
  assert.deepEqual(result.unmappedMeasurements, [{ state: 'unknown', value: null, reason: 'unmapped-meaning' }]);
  assert.equal(JSON.stringify(result).includes('UNKNOWN_CODE'), false);
  data.measurements.N_SITZE.value = 1.5;
  assert.equal((await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample())).facts.seats.reason, 'malformed-value');
  delete data.measurements;
  const absent = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  assert.equal(absent.status, 'partial');
  assert.equal(absent.facts.seats.reason, 'missing-value');
  assert.equal(absent.equipment.selected.complete, true);
});

test('complete and partial plain text examples visibly explain equipment certainty', async () => {
  const data = await fixture();
  const complete = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  const shown = presentBmwCatalogue(complete);
  assert.equal(Array.isArray(shown.equipment), true);
  assert.match(shown.equipment.find((line) => line.includes('P0300')), /Alpine White.*selected in this catalogue configuration/);
  assert.match(shown.equipment.find((line) => line.includes('P0475')), /Black Sapphire.*available.*not selected/);
  assert.match(shown.equipment.find((line) => line.includes('S03AC')), /Towbar.*not selected.*VIN-fitted: unknown/);
  assert.match(shown.completeness, /Selection: complete.*definitions: partial/);
  data.equipmentEvidence = { ...data.equipmentEvidence, selected: {
    ...data.equipmentEvidence?.selected, completeness: 'partial',
  } };
  data.measurements.A_GEPR_V211.value = '-';
  data.definitions.S03AC.label = '<script>private</script>';
  const partial = presentBmwCatalogue(await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample()));
  assert.match(partial.equipment.find((line) => line.includes('S03AC')), /label unknown.*selection unknown.*incomplete selection/);
  assert.equal(partial.measurements[1], 'Luggage (normal): unknown (placeholder value)');
  assert.match(partial.measurementEvidence[0], /BMW UK catalogue.*1 November 2026.*complete/);
  assert.match(partial.completeness, /Selection: partial/);
  assert.equal(JSON.stringify(partial).includes('<'), false);
  assert.equal(JSON.stringify(partial).includes('private'), false);
  for (const forbidden of ['telemetry', 'eligible', 'fitted: yes']) assert.equal(JSON.stringify(partial).includes(forbidden), false);
});


test('canonical lookup identity separates provider, version, market, dates and complete configuration', async () => {
  assert.equal(typeof catalogue.bmwCatalogueLookupIdentity, 'function');
  const base = catalogue.bmwCatalogueLookupIdentity(sample());
  assert.equal(base.provider, 'bmw-catalogue-snapshot');
  assert.equal(base.schemaVersion, '1');
  assert.equal(base.snapshotVersion, 'bmw-gb-i5-2026-11-01.v1');
  assert.equal(base.catalogueDate, '2026-11-01');
  const keys = new Set([JSON.stringify(base)]);
  for (const patch of [
    { market: 'US' }, { locale: 'de-DE' }, { modelCode: 'T3MQ' }, { modelRange: 'G21' },
    { rawModelRange: 'G61E' }, { agModelCode: '22FY' }, { trim: 'S07BL' },
    { catalogueDate: '2026-11-02' }, { orderDate: '2026-11-02' }, { effectDate: '2027-01-06' },
    { productionDate: '2027-01-06' }, { taxDate: '2027-01-06' },
    { selectedOptions: sample().selectedOptions.map((code) => code === 'P0300' ? 'P0475' : code) },
    { selectedOptions: sample().selectedOptions.slice(1) },
    { selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 2 }] },
  ]) {
    const key = JSON.stringify(catalogue.bmwCatalogueLookupIdentity({ ...sample(), ...patch }));
    assert.equal(keys.has(key), false); keys.add(key);
  }
  for (const options of [{ provider: 'other-snapshot' }, { providerVersion: '2' },
    { schemaVersion: '2' }, { snapshotVersion: 'bmw-gb-i5-2026-11-01.v2' }]) {
    const key = JSON.stringify(catalogue.bmwCatalogueLookupIdentity(sample(), options));
    assert.equal(keys.has(key), false); keys.add(key);
  }
  for (let offset = 0; offset < 47; offset += 1) {
    const options = sample().selectedOptions;
    const rotated = [...options.slice(offset), ...options.slice(0, offset)];
    assert.deepEqual(catalogue.bmwCatalogueLookupIdentity({ ...sample(), selectedOptions: rotated }), base);
  }
  const accessories = [{ code: 'SE000002', type: 'accessory', quantity: 3 }, ...sample().selectedAccessories];
  assert.deepEqual(catalogue.bmwCatalogueLookupIdentity({ ...sample(), selectedAccessories: accessories }),
    catalogue.bmwCatalogueLookupIdentity({ ...sample(), selectedAccessories: [...accessories].reverse() }));
  const decorated = catalogue.bmwCatalogueLookupIdentity({ ...sample(), garageId: 'private', shareId: 'private', ruleId: 'private', userId: 'private' });
  assert.deepEqual(decorated, base);
  assert.equal(JSON.stringify(decorated).includes('private'), false);
  const result = await createBmwCatalogueAdapter().resolve(sample());
  assert.deepEqual(result.lookupIdentity, base);
  assert.deepEqual(result.resolvedLookupIdentity, base);
});

test('catalogue dates and version configuration fail explicitly before any nearby lookup', async () => {
  let loads = 0;
  const data = await fixture();
  const adapter = createBmwCatalogueAdapter({ loadSnapshot: async () => { loads += 1; return data; } });
  for (const request of [{ ...sample(), catalogueDate: undefined }, { ...sample(), catalogueDate: '2026-02-30' },
    { ...sample(), selectedOptions: [] }, { ...sample(), selectionComplete: false }]) {
    const result = await adapter.resolve(request);
    assert.equal(result.status, 'invalid-input');
    assert.equal(result.failure.code, 'invalid-request');
    assert.equal(result.lookupIdentity, null);
  }
  assert.equal(loads, 0);
  for (const options of [{ snapshotVersion: 1 }, { schemaVersion: {} }, null]) {
    assert.equal((await adapter.resolve(sample(), options)).status, 'invalid-input');
  }
  assert.equal(loads, 0);
  for (const options of [{ schemaVersion: '2' }, { providerVersion: '2' }, { snapshotVersion: 'unknown' }]) {
    assert.equal((await adapter.resolve(sample(), options)).status, 'unsupported');
  }
  assert.equal(loads, 0);
  for (const patch of [{ catalogueDate: '2024-10-01' }, { agModelCode: '22FY' },
    { selectedOptions: sample().selectedOptions.filter((code) => code !== 'P0300') }]) {
    const result = await adapter.resolve({ ...sample(), ...patch });
    assert.equal(result.status, 'identity-mismatch');
    assert.equal(result.failure.code, 'snapshot-identity-mismatch');
    assert.equal(result.resolvedIdentity.catalogueDate, '2026-11-01');
    assert.equal(result.facts.seats.state, 'unknown');
    assert.equal(result.lookupIdentity.catalogueDate, patch.catalogueDate || '2026-11-01');
    assert.equal(result.resolvedLookupIdentity.catalogueDate, '2026-11-01');
  }
});

test('local artifact failures have bounded safe reasons and usable presentation', async () => {
  for (const [code, expected] of [['ENOENT', 'artifact-missing'], ['EACCES', 'artifact-unreadable'],
    ['EIO', 'artifact-unreadable']]) {
    const adapter = createBmwCatalogueAdapter({ loadSnapshot: async () => {
      throw Object.assign(new Error('private path <html> upstream'), { code });
    } });
    const result = await adapter.resolve(sample());
    assert.equal(result.status, 'source-unavailable');
    assert.equal(result.failure.code, expected);
    assert.equal(result.failure.retryable, true);
    const shown = presentBmwCatalogue(result);
    assert.equal(shown.sourceKind, 'dated-snapshot');
    assert.equal(shown.failure.code, expected);
    assert.ok(shown.failure.message.length > 10);
    assert.equal(shown.measurements.length, 0);
    assert.equal(JSON.stringify([result, shown]).includes('private'), false);
    assert.equal(JSON.stringify([result, shown]).includes('<html>'), false);
  }
  const malformed = await createBmwCatalogueAdapter({ loadSnapshot: async () => JSON.parse('{') }).resolve(sample());
  assert.equal(malformed.failure.code, 'artifact-malformed');
  for (const patch of [{ schemaVersion: '2' }, { snapshotVersion: 'other' }]) {
    const data = { ...await fixture(), ...patch };
    const result = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
    assert.equal(result.failure.code, 'artifact-incompatible');
  }
  const unknown = await createBmwCatalogueAdapter().resolve({ ...sample(), modelCode: 'T3MQ' });
  assert.equal(unknown.failure.code, 'snapshot-not-found');
  assert.equal(presentBmwCatalogue(unknown).failure.retryable, false);
  assert.equal(presentBmwCatalogue({ status: '<private>', failure: { code: 'private', message: '<private>' } }).status, 'source-unavailable');
});

test('catalogue failures and partial unknowns preserve independent caller facts without mutation', async () => {
  assert.equal(typeof catalogue.mergeBmwCatalogueFacts, 'function');
  const caller = { connectedMileage: { state: 'known', value: 12000, unit: 'KILOMETRES', provenance: { kind: 'synthetic' } },
    luggageNormal: { state: 'known', value: 450, definition: 'NORMAL', unit: 'LITRES', provenance: { kind: 'synthetic' } } };
  const before = structuredClone(caller);
  const adapter = createBmwCatalogueAdapter();
  for (const result of [await adapter.resolve(null), await adapter.resolve(sample(), { snapshotVersion: 'unknown' }),
    await adapter.resolve({ ...sample(), modelCode: 'T3MQ' }), await adapter.resolve({ ...sample(), catalogueDate: '2024-10-01' }),
    await createBmwCatalogueAdapter({ loadSnapshot: async () => { throw new Error('private'); } }).resolve(sample())]) {
    const merged = catalogue.mergeBmwCatalogueFacts(caller, result);
    assert.deepEqual(merged, before);
    merged.connectedMileage.value = 999;
    assert.deepEqual(caller, before);
  }
  const data = await fixture(); delete data.measurements.A_GEPR_V211;
  const partial = await createBmwCatalogueAdapter({ loadSnapshot: async () => data }).resolve(sample());
  const merged = catalogue.mergeBmwCatalogueFacts(caller, partial);
  assert.equal(merged.luggageNormal.value, 450);
  assert.equal(merged.seats.value, 5);
  assert.equal(merged.connectedMileage.value, 12000);
  assert.deepEqual(caller, before);
  assert.deepEqual(catalogue.mergeBmwCatalogueFacts(null, partial).seats, partial.facts.seats);
});


test('default resolution and safe failures make zero external requests', async (context) => {
  let external = 0;
  const stop = () => { external += 1; throw new Error('network forbidden in snapshot contract'); };
  context.mock.method(globalThis, 'fetch', stop);
  for (const name of ['node:http', 'node:https']) {
    const { default: transport } = await import(name);
    context.mock.method(transport, 'request', stop);
    context.mock.method(transport, 'get', stop);
  }
  const adapter = createBmwCatalogueAdapter({ transport: stop });
  const results = [await adapter.resolve(sample()), await adapter.resolve(null),
    await adapter.resolve({ ...sample(), market: 'US' }),
    await adapter.resolve(sample(), { snapshotVersion: 'unknown' }),
    await adapter.resolve({ ...sample(), modelCode: 'T3MQ' }),
    await adapter.resolve({ ...sample(), catalogueDate: '2024-10-01' }),
    await createBmwCatalogueAdapter({ transport: stop, loadSnapshot: async () => { throw new Error('unavailable'); } }).resolve(sample())];
  assert.deepEqual(results.map(({ status }) => status),
    ['ok', 'invalid-input', 'unsupported', 'unsupported', 'not-found', 'identity-mismatch', 'source-unavailable']);
  assert.equal(external, 0);
  for (const result of results) {
    assert.equal(result.sourceKind, 'dated-snapshot');
    assert.equal(result.equipment.verifiedFitted.state, 'unknown');
    const shown = presentBmwCatalogue(result);
    assert.equal(shown.sourceKind, 'dated-snapshot');
    if (result.status !== 'ok') {
      assert.equal(result.facts.seats.state, 'unknown');
      assert.equal(typeof shown.failure.message, 'string');
    }
  }
});
