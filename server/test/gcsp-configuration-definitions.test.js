import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createConfigurationDefinitionIndex, loadConfigurationDefinitionIndex, withConfigurationDefinitions,
  selectedConfigurationDefinitionFacts, CONFIGURATION_DEFINITIONS_SHA256 } from '../gcsp/vehicle-evidence/configuration-definitions.js';
import { indexJsonl } from '../gcsp/vehicle-evidence/indexed-jsonl.js';
import { vehicleEvidenceDetails } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { createVehicleSnapshot } from '../vehicles/index.js';

const root = fileURLToPath(new URL('../data/gcsp/vehicle-evidence/demo-fleet.v1/', import.meta.url));
const seedBytes = await readFile(new URL('../data/gcsp/vehicle-evidence/configuration-definitions.v1.json', import.meta.url));
const seed = JSON.parse(seedBytes);
const pointer = JSON.parse(await readFile(join(root, 'active.json'), 'utf8'));
const corpus = await indexJsonl(join(root, 'versions', pointer.selected.directory, 'configurations.jsonl'), { key: (row) => row.configurationId });
const ids = [...corpus.metadataEntries()].map((entry) => entry.key);
const source = (record) => ({ status: 'partial', record, images: [], active: { datasetId: 'gcsp-demo-fleet', version: '1',
  manifestDigest: pointer.selected.manifestDigest } });
const registry = { getConfiguration: (id) => corpus.get(id) ? source(corpus.get(id)) : { status: 'not-found' },
  classifyConfiguration: async (configurationId) => ({ status: 'ok', identityKind: 'synthetic', liveEligible: false, configurationId }) };
const freshIndex = (data = seed, digest = CONFIGURATION_DEFINITIONS_SHA256) => createConfigurationDefinitionIndex(data, { digest });
const first = corpus.get(ids[0]);
const wire = async (record = first, index = freshIndex()) => {
  const enriched = await withConfigurationDefinitions({ getConfiguration: () => source(record) }, { index }).getConfiguration(record.configurationId);
  return vehicleEvidenceDetails({ kind: 'configuration', id: record.configurationId }, enriched);
};

test('versioned retained definition seed has pinned population coverage and reuses the same loaded index', async () => {
  assert.equal(createHash('sha256').update(seedBytes).digest('hex'), CONFIGURATION_DEFINITIONS_SHA256);
  const a = await loadConfigurationDefinitionIndex(); assert.equal(a, await loadConfigurationDefinitionIndex());
  assert.equal(seed.population.configurations, 240); assert.equal(corpus.length, seed.population.configurations);
  assert.equal(corpus.checksum, seed.population.configurationSha256);
  let selected = 0; let resolved = 0; let fullyLabelled = 0; const unresolved = {};
  for (const id of ids) {
    const result = a.resolve(corpus.get(id)); selected += result.selectedCount; resolved += result.resolvedCount;
    fullyLabelled += result.state === 'complete';
    for (const entry of result.unresolved) unresolved[entry.code] = (unresolved[entry.code] ?? 0) + 1;
  }
  assert.equal(selected, 11947); assert.equal(resolved, 11900); assert.equal(fullyLabelled, 239);
  assert.deepEqual(unresolved, seed.population.unresolvedCodes);
  assert.equal(a.diagnostics().indexBuilds, 1); assert.equal(a.diagnostics().resolutions, 240);
});

test('same-model selections resolve differently and paint/upholstery use their own selected code', async () => {
  const a = await wire();
  const other = ids.map((id) => corpus.get(id)).find((row) => row.configuration.vgModelCode === first.configuration.vgModelCode
    && row.configurationId !== first.configurationId && row.catalogue.equipment.selected.options.some((code) => !first.catalogue.equipment.selected.options.includes(code)));
  assert.ok(other, 'retained same-model contrast exists'); const b = await wire(other);
  assert.notDeepEqual(a.equipment.definitions.map((definition) => definition.code), b.equipment.definitions.map((definition) => definition.code));
  for (const result of [a, b]) {
    assert.equal(result.equipment.resolution.configurationId, result.identity.configurationId);
    assert.deepEqual(result.equipment.selected.options, corpus.get(result.identity.configurationId).catalogue.equipment.selected.options);
    assert.equal(result.equipment.available.state, 'unknown'); assert.equal(result.equipment.verifiedFitted.state, 'unknown');
    for (const key of ['paint', 'upholstery']) {
      const appearance = result.description[key]; assert.equal(appearance.state, 'known'); assert.equal(appearance.selections.length, 1);
      const item = appearance.selections[0]; assert.ok(result.equipment.selected.options.includes(item.code));
      assert.ok(item.label.value.length); assert.equal(item.claim, 'selected-catalogue-equipment');
      assert.equal(item.swatch.state, 'unknown'); assert.equal(item.swatch.value, null);
      assert.match(item.label.provenance.source, /\/options\/languages\/en/);
    }
  }
});

test('variant model/market/source mismatches and missing identity cannot borrow another definition', () => {
  for (const mutate of [
    (row) => { row.configuration.market = 'US'; },
    (row) => { row.configuration.generation = 'INCOMPATIBLE'; },
    (row) => { row.configuration.agModelCode = 'OTHER'; },
    (row) => { row.sourceContext.sourceRefs = row.sourceContext.sourceRefs.map((ref) => ref.replace('trim=S033B', 'trim=S0999')); },
    (row) => { row.configurationId = 'missing'; },
  ]) {
    const row = structuredClone(first); mutate(row); const result = freshIndex().resolve(row);
    assert.equal(result.state, 'unknown'); assert.equal(result.definitions.length, 0); assert.ok(result.reason);
  }
});

test('unknown codes, conflicting same-context definitions and selected-versus-available stay truthful', async () => {
  const data = structuredClone(seed); const variant = data.variants.find((entry) => first.sourceContext.sourceRefs.includes(entry.source));
  const code = first.catalogue.equipment.selected.options.find((selected) => selected.startsWith('S'));
  variant.definitions[code] = { state: 'unknown', reason: 'ambiguous-definition', candidates: [
    { label: 'Conflicting label one', category: 'other', sources: [0] }, { label: 'Conflicting label two', category: 'other', sources: [0] }] };
  const missing = first.catalogue.equipment.selected.options.find((selected) => selected !== code);
  delete variant.definitions[missing];
  variant.definitions.S9999 = { state: 'known', reason: null, candidates: [{ label: 'Unselected item', category: 'other', sources: [0] }] };
  const result = await wire(first, freshIndex(data));
  assert.equal(result.equipment.resolution.state, 'partial');
  assert.ok(result.equipment.resolution.unresolved.some((entry) => entry.code === code && entry.reason === 'ambiguous-definition'));
  assert.ok(result.equipment.resolution.unresolved.some((entry) => entry.code === missing && entry.reason === 'definition-unavailable'));
  assert.equal(result.equipment.definitions.some((entry) => [code, missing, 'S9999'].includes(entry.code)), false);
  assert.deepEqual(result.equipment.available, first.catalogue.equipment.available);
  assert.match(selectedConfigurationDefinitionFacts(result).options.value.at(-1), /^2 selected codes without a readable definition$/);
});

test('failed seed loads and unknown selections remain explicit without hiding existing source facts', async () => {
  const enriched = await withConfigurationDefinitions(registry, { index: Promise.reject(new Error('missing seed')) }).getConfiguration(first.configurationId);
  assert.equal(enriched.definitionResolution.reason, 'definition-seed-unavailable');
  assert.deepEqual(enriched.record.catalogue.equipment.selected, first.catalogue.equipment.selected);
  assert.equal((await withConfigurationDefinitions(registry).getConfiguration('missing')).status, 'not-found');
  const row = structuredClone(first); row.catalogue.equipment.selected.state = 'unknown';
  const result = freshIndex().resolve(row); assert.equal(result.state, 'unknown'); assert.equal(result.reason, 'selection-unavailable');
});

test('retained definition facts keep their snapshot provenance when the active seed resolves no codes', async () => {
  const retained = ids.map((id) => corpus.get(id)).find((row) => row.snapshotVersion === 'bmw-gb-i5-2026-11-01.v1');
  assert.equal(retained.catalogue.equipment.definitions.length, 6);
  const details = await wire(retained);
  assert.equal(details.equipment.resolution.resolvedCount, 0);
  assert.equal(details.equipment.resolution.unresolved.length, 47);
  const facts = selectedConfigurationDefinitionFacts(details);
  assert.equal(facts.colour.value, 'Alpine White');
  assert.equal(facts.interior.value, 'Perforated and Quilted Veganza in Smoke White');
  assert.deepEqual(facts.options.value, ['Lumbar Support', '44 selected codes without a readable definition']);
  for (const name of ['colour', 'interior', 'options']) assert.deepEqual(facts[name].provenance, {
    sourceRef: 'BMW UK catalogue', observedAt: '2026-11-01T00:00:00.000Z',
    version: 'bmw-gb-i5-2026-11-01.v1', assurance: 'model-reference',
  });
  const changed = structuredClone(seed); changed.version = 'unrelated-active-dictionary.v2';
  assert.deepEqual(selectedConfigurationDefinitionFacts(await wire(retained, freshIndex(changed, 'c'.repeat(64)))), facts);
});

test('mixed selected option facts retain each source and version through the canonical snapshot', async () => {
  const retained = structuredClone(ids.map((id) => corpus.get(id)).find((row) => row.snapshotVersion === 'bmw-gb-i5-2026-11-01.v1'));
  // Controlled one-code join on the existing retained record, not a new source claim for the corpus.
  const joinedSource = 'https://example.test/options/languages/en/mixed-retained-record';
  retained.sourceContext.sourceRefs.push(joinedSource);
  const mixed = { schemaVersion: '1', version: 'mixed-fixture.v1', population: {}, variants: [{
    source: joinedSource, market: 'GB', vgModelCode: 'T5MJ', generations: ['G61'], agModelCodes: ['72HH'],
    sources: [{ path: 'test-only:mixed-option-label', observedDate: '2026-11-09' }],
    definitions: { S0494: { state: 'known', candidates: [{ label: 'Heated front seats', category: 'other', sources: [0] }] } },
  }] };
  const details = await wire(retained, freshIndex(mixed, 'c'.repeat(64)));
  assert.equal(details.equipment.resolution.resolvedCount, 1);
  const facts = selectedConfigurationDefinitionFacts(details);
  assert.equal(facts.colour.provenance.version, 'bmw-gb-i5-2026-11-01.v1');
  assert.equal(facts.interior.provenance.version, 'bmw-gb-i5-2026-11-01.v1');
  assert.deepEqual(facts.options.value, ['Lumbar Support', 'Heated front seats', '43 selected codes without a readable definition']);
  assert.deepEqual(JSON.parse(facts.options.provenance.sourceRef), [
    { code: 'S0488', sourceRef: 'BMW UK catalogue', observedAt: '2026-11-01T00:00:00.000Z', version: 'bmw-gb-i5-2026-11-01.v1' },
    { code: 'S0494', sourceRef: joinedSource, observedAt: '2026-11-09T00:00:00.000Z', version: `mixed-fixture.v1:${'c'.repeat(64)}` },
  ]);
  assert.deepEqual(JSON.parse(facts.options.provenance.version), ['bmw-gb-i5-2026-11-01.v1', `mixed-fixture.v1:${'c'.repeat(64)}`]);
  assert.equal(facts.options.provenance.observedAt, '2026-11-09T00:00:00.000Z');
  const snapshot = createVehicleSnapshot({ sourceNamespace: 'test-retained-configuration', identityKind: 'legacy-record',
    sourceKeys: { recordId: retained.configurationId }, snapshotVersion: 'test-mixed-snapshot.v1',
    observedAt: '2026-11-11T00:00:00.000Z', display: { name: 'BMW i5 retained configuration' }, facts });
  assert.deepEqual(snapshot.facts.options.provenance, facts.options.provenance);
});

test('public adapter accepts exact definition association and rejects substituted provenance metadata', async () => {
  const lookup = createVehicleEvidenceLookup({ registry: withConfigurationDefinitions(registry) });
  const request = { kind: 'configuration', id: first.configurationId };
  const app = createConfiguredVehicleDetails({ lookup });
  const result = await app.resolve(request); assert.equal(result.status, 'partial');
  assert.equal(result.vehicle.equipment.resolution.digest, CONFIGURATION_DEFINITIONS_SHA256);
  assert.equal(result.vehicle.description.paint.state, 'known');
  const malformed = await lookup.resolve(request); malformed.equipment.resolution.configurationId = ids[1];
  const bad = createConfiguredVehicleDetails({ lookup: { ...lookup, resolve: () => malformed } });
  assert.equal((await bad.resolve(request)).status, 'identity-mismatch');
});

test('actual retained registry and local evidence port join definitions without republishing the corpus', async () => {
  const lookup = createLocalVehicleEvidenceLookup({ root, asOf: '2026-11-11T00:00:00.000Z' });
  const result = await lookup.resolve({ kind: 'configuration', id: first.configurationId });
  assert.equal(result.status, 'partial', JSON.stringify(result.failure));
  assert.equal(result.identity.configurationId, first.configurationId);
  assert.equal(result.versions.manifestDigest, pointer.selected.manifestDigest);
  assert.equal(result.description.paint.state, 'known'); assert.equal(result.description.upholstery.state, 'known');
  assert.equal(result.equipment.resolution.resolvedCount, first.catalogue.equipment.selected.options.length);
  assert.equal((await lookup.definitionStatus()).digest, CONFIGURATION_DEFINITIONS_SHA256);
});

test('repeated detached keyed registry lookups do not iterate a catalogue or change pinned projections across dictionary versions', async () => {
  let gets = 0;
  const keyed = { ...registry, getConfiguration(id) { gets++; return source(corpus.get(id)); },
    [Symbol.iterator]() { throw new Error('catalogue scan forbidden'); } };
  const index = freshIndex(); const decorated = withConfigurationDefinitions(keyed, { index });
  const request = { kind: 'configuration', id: first.configurationId };
  const lookup = createVehicleEvidenceLookup({ registry: decorated });
  const original = await lookup.resolve(request); const pinned = selectedConfigurationDefinitionFacts(original);
  const saved = structuredClone(pinned);
  for (let i = 0; i < 5; i++) assert.deepEqual(selectedConfigurationDefinitionFacts(await lookup.resolve(request)), saved);
  assert.equal(gets, 6); assert.equal(index.diagnostics().resolutions, 6); assert.equal(index.diagnostics().indexBuilds, 1);
  const updated = structuredClone(seed); updated.version = 'configuration-definitions-test.v2';
  const variant = updated.variants.find((entry) => first.sourceContext.sourceRefs.includes(entry.source));
  variant.definitions[first.catalogue.equipment.selected.options.find((code) => code.startsWith('P'))].candidates[0].label = 'Revised readable paint label';
  const next = selectedConfigurationDefinitionFacts(await wire(first, freshIndex(updated, 'b'.repeat(64))));
  assert.equal(next.colour.value, 'Revised readable paint label'); assert.notEqual(next.colour.provenance.version, pinned.colour.provenance.version);
  assert.deepEqual(pinned, saved); assert.equal(first.catalogue.equipment.definitions.length, 0);
});
