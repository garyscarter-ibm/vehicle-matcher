import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBmwCatalogueAdapter } from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { createBmwImageAdapter } from '../vehicle-evidence/bmw-image-adapter.js';
import { enrichConfiguration, reportEnrichment } from '../../scripts/gcsp/enrich-fleet.mjs';

const snapshot = JSON.parse(await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url)));
const request = () => ({ catalogueDate: snapshot.observedDate, market: snapshot.market, locale: snapshot.locale,
  ...snapshot.model, productionDate: '2027-01-05', trim: snapshot.trim,
  selectedOptions: [...snapshot.selectedOptions], selectedAccessories: structuredClone(snapshot.selectedAccessories),
  selectionComplete: true, viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 } });
async function input() {
  const identity = request();
  return { configurationId: 'accepted-configuration-1', request: identity,
    catalogue: await createBmwCatalogueAdapter().resolve(identity),
    image: await createBmwImageAdapter({ environment: 'gcsp-demo' }).resolve(identity),
    retention: { status: 'allowed', decision: 'FUCQ-58-2026-11-05' }, asOf: '2026-11-06' };
}

test('pure exact projection preserves contexts, units, unknowns, accessory and selection claims', async () => {
  const source = await input(); const before = structuredClone(source);
  const output = enrichConfiguration(source);
  assert.equal(output.status, 'partial');
  assert.equal(output.configurationId, source.configurationId);
  assert.equal(output.scope, 'pure-enrichment');
  assert.equal(output.facts.luggageNormal.unit, 'LITRES');
  assert.equal(output.facts.luggageNormal.value, 570);
  assert.equal(output.facts.bodyLength.state, 'unknown');
  assert.equal(output.facts.bodyLength.value, null);
  assert.equal(output.facts.bodyLength.reason, 'placeholder-value');
  assert.equal(output.sources.catalogue.retrievedDate, '2026-11-01');
  assert.deepEqual(output.sources.catalogue.requestedIdentity, output.sources.catalogue.resolvedIdentity);
  assert.equal(output.identity.effectDate, '2027-01-05');
  assert.equal(output.identity.selectedAccessories[0].quantity, 1);
  assert.equal(output.appearance.paint.selections[0].code, 'P0300');
  assert.equal(output.appearance.upholstery.selections[0].code, 'FKSFU');
  const towbar = output.equipment.find(({ code }) => code === 'S03AC');
  assert.equal(towbar.configurableAvailability.state, 'available');
  assert.equal(towbar.catalogueSelection.state, 'not-selected');
  assert.equal(towbar.verifiedVinFitted.state, 'unknown');
  assert.equal(output.image.fidelity.equipment, 'unknown');
  assert.equal(output.image.body.state, 'unknown');
  assert.deepEqual(source, before);
  for (const key of ['vin', 'orderNumber', 'availability', 'schemePoints', 'eligibility', 'connectedUse']) {
    assert.equal(Object.hasOwn(output, key), false);
  }
});

test('every configuration/date/selection substitution rejects catalogue facts before merging', async () => {
  for (const field of ['market', 'locale', 'modelCode', 'agModelCode', 'modelRange', 'rawModelRange', 'trim',
    'catalogueDate', 'orderDate', 'effectDate', 'productionDate', 'taxDate', 'selectedOptions', 'selectedAccessories']) {
    const source = await input();
    const changed = field === 'selectedOptions' ? source.request.selectedOptions.slice(1)
      : field === 'selectedAccessories' ? [] : field.endsWith('Date') ? '2026-11-02' : 'OTHER';
    source.catalogue.resolvedIdentity[field] = changed;
    const output = enrichConfiguration(source);
    assert.equal(output.sources.catalogue.outcome, 'identity-mismatch', field);
    assert.deepEqual(output.facts, {}, field);
    assert.equal(output.status, 'rejected', field);
  }
  const source = await input(); source.catalogue.lookupIdentity.providerVersion = '2';
  assert.deepEqual(enrichConfiguration(source).facts, {});
});

test('canonical ordering is accepted but invalid complete selections are not', async () => {
  const source = await input(); source.request.selectedOptions.reverse();
  assert.equal(enrichConfiguration(source).facts.seats.value, 5);
  for (const patch of [{ selectionComplete: false }, { selectedOptions: [] }, { catalogueDate: '2026-02-30' }]) {
    assert.equal(enrichConfiguration({ ...source, request: { ...source.request, ...patch } }).status, 'rejected');
  }
});

test('adapter measured unknowns and selected towbar stay honest through enrichment', async () => {
  const source = await input(); const changed = structuredClone(snapshot);
  delete changed.measurements.A_GEPR_V211;
  changed.measurements.UNKNOWN = { value: 22, unit: 'UNMAPPED' };
  source.catalogue = await createBmwCatalogueAdapter({ loadSnapshot: async () => changed }).resolve(source.request);
  const output = enrichConfiguration(source);
  assert.equal(output.facts.luggageNormal.value, null);
  assert.equal(output.facts.luggageNormal.reason, 'missing-value');
  assert.equal(output.facts.seats.value, 5);
  assert.deepEqual(output.unmappedMeasurements, [{ state: 'unknown', value: null, reason: 'unmapped-meaning' }]);
  const selected = await input(); selected.request.selectedOptions.push('S03AC');
  selected.catalogue = structuredClone(selected.catalogue);
  // A deliberately supplied matching port envelope proves projection, not a new observed source selection.
  for (const key of ['lookupIdentity', 'resolvedLookupIdentity', 'requestedIdentity', 'resolvedIdentity']) selected.catalogue[key].selectedOptions.push('S03AC');
  selected.catalogue.equipment.selected.options.push('S03AC');
  const towbar = enrichConfiguration(selected).equipment.find(({ code }) => code === 'S03AC');
  assert.equal(towbar.catalogueSelection.state, 'selected');
  assert.equal(towbar.verifiedVinFitted.state, 'unknown');
});

test('inconsistent equipment lists cannot promote an available towbar into selected equipment', async () => {
  const source = await input(); source.catalogue.equipment.selected.options.push('S03AC');
  const output = enrichConfiguration(source);
  assert.equal(output.facts.seats.value, 5);
  assert.equal(output.completeness.selection, 'unknown');
  const towbar = output.equipment.find(({ code }) => code === 'S03AC');
  assert.equal(towbar.catalogueSelection.state, 'unknown');
  assert.equal(towbar.verifiedVinFitted.state, 'unknown');
});

test('image failures, wrong paint/model/view, generic substitution and invalid metadata keep valid facts', async () => {
  const changes = [
    (s) => { s.image = null; },
    (s) => { s.image.status = 'source-unavailable'; s.image.image = null; },
    (s) => { s.image.resolvedIdentity.modelCode = 'T3MQ'; },
    (s) => { s.image.resolvedLookupIdentity.viewpoint = 'SIDELEFT'; },
    (s) => { s.image.image.paint.code = 'P0475'; },
    (s) => { s.image.image.size.width = 100; },
    (s) => { s.image.image.fidelity.equipment = 'verified'; },
    (s) => { s.image.image.representation = 'generic'; },
    (s) => { s.retention.status = 'denied'; },
    (s) => { s.retention = null; },
    (s) => { s.image.expiresAt = '2026-11-06'; },
    (s) => { s.image.expiresAt = 'invalid'; },
  ];
  for (const change of changes) {
    const source = await input(); change(source); const output = enrichConfiguration(source);
    assert.equal(output.status, 'partial');
    assert.equal(output.facts.seats.value, 5);
    assert.equal(output.image, null);
    assert.notEqual(output.sources.image.outcome, 'ok');
  }
});

test('source context survives partial results without opaque URL or unrelated input leakage', async () => {
  const source = await input();
  source.image.image.url = 'https://opaque.invalid/token/private';
  source.image.failure = { message: 'https://opaque.invalid/token/private' };
  source.image.image.fidelity.secret = 'https://opaque.invalid/token/private';
  source.image.image.paint.label = 'https://opaque.invalid/token/private';
  source.catalogue.private = 'https://opaque.invalid/token/private';
  source.request.stock = { availability: true };
  const output = enrichConfiguration(source);
  assert.equal(output.image.assetId, source.image.image.assetId);
  assert.equal(JSON.stringify(output).includes('opaque.invalid'), false);
  assert.equal(output.image.paint.label, null);
  assert.equal(output.sources.image.resolvedIdentity.modelCode, 'T5MJ');
  assert.equal(output.sources.image.retrievedDate, '2026-11-01');
});

test('content-hash sharing retains every configuration source reference and partial coverage', async () => {
  const source = await input(); const first = enrichConfiguration(source);
  const second = enrichConfiguration({ ...source, configurationId: 'accepted-configuration-2' });
  const report = reportEnrichment([first, second]);
  assert.deepEqual(report.counts, { total: 2, partial: 2, rejected: 0 });
  assert.equal(report.assets.length, 1);
  assert.equal(report.assets[0].references.length, 2);
  assert.deepEqual(report.assets[0].references.map(({ configurationId }) => configurationId),
    ['accepted-configuration-1', 'accepted-configuration-2']);
  assert.equal(report.assets[0].references[0].source.requestedIdentity.agModelCode, '72HH');
  const conflict = structuredClone(second); conflict.image.bytes += 1;
  assert.throws(() => reportEnrichment([first, conflict]), /Conflicting asset metadata/);
});

test('pure transform invokes no supplied execution or transport capability', async (t) => {
  const source = await input(); let calls = 0;
  const stop = () => { calls += 1; throw Error('unexpected I/O'); };
  t.mock.method(globalThis, 'fetch', stop);
  source.execute = stop; source.session = { withCheckpoint: stop };
  assert.equal(enrichConfiguration(source).facts.seats.value, 5);
  assert.equal(calls, 0);
});
