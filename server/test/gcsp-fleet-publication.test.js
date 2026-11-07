import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCorpusCandidate, validateCorpusDirectory, canonicalContent } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { validateBmwCatalogueV2Envelope } from '../vehicle-evidence/bmw-catalogue-v2.js';
import { createConfigurationKey } from '../../scripts/gcsp/configuration-key.mjs';
import { emptyAllocationInventory } from '../gcsp/vehicle-evidence/vin-allocation.js';
import { options, sourceBackedInput, corpusInput } from './helpers/vin-corpus-fixture.js';

const source = new URL('../../docs/gcsp/evidence/fucq61/source-batch32-2026-11-07/accepted.jsonl', import.meta.url);
const records = (await readFile(source, 'utf8')).trim().split('\n').map(JSON.parse);
const fields = ['model', 'derivative', 'generation', 'body', 'powertrain', 'drive', 'transmission', 'engineCode',
  'agModelCode', 'vgModelCode', 'market', 'region', 'steering', 'modelYear', 'productionEra', 'productionDate', 'plant'];
const key = await createConfigurationKey(options);
export async function fleetInput(count = 2) {
  const legacy = await sourceBackedInput();
  const configurations = records.slice(0, count).map((raw) => {
    const record = structuredClone(raw);
    const c = record.catalogue;
    const configuration = Object.fromEntries(fields.map((field) => [field, null]));
    Object.assign(configuration, { generation: 'G61', agModelCode: '72HH', vgModelCode: 'T5MJ', market: 'GB' });
    return { configurationId: record.configurationId, snapshotVersion: c.snapshotVersion,
      canonicalIdentity: { ...record.canonicalIdentity, provenance: c.identityProvenance }, configuration,
      sourceContext: { sourceRefs: [...new Set(c.sourceBinding.evidence.map((e) => e.request.url))].sort(),
        observedDate: '2026-11-07', catalogueDate: '2026-11-07', confidence: 'Complete source factory selection; physical build unknown',
        unresolvedFacts: fields.filter((field) => configuration[field] === null), sourceKind: 'dated-snapshot', selectedOptionCompleteness: 'complete' },
      catalogue: c, imageIds: [] };
  });
  return { metadata: { ...legacy.metadata, datasetId: 'real-source-contract', version: '1',
    sourceContexts: [{ sourceKind: 'dated-snapshot', observedDate: '2026-11-07', catalogueDate: '2026-11-07', market: 'GB', steering: null,
      note: 'Actual bounded source captures, no physical vehicle or stock claim' }] }, configurations, allocationInventory: emptyAllocationInventory(), images: [] };
}
export const registeredOptions = { ...options, sourceRegistrations: records.map((record) => {
  const expected = record.catalogue; const binding = expected.sourceBinding;
  const trusted = { configurationKey: key, producerPins: binding.producerPins, evidencePins: binding.evidence,
    requestScope: binding.requestScope, confirmedContext: binding.confirmedContext };
  return { lookupIdentity: expected.lookupIdentity, qualifySnapshot(snapshot) {
    const result = validateBmwCatalogueV2Envelope(JSON.stringify(snapshot), trusted);
    return result.status === 'valid' && canonicalContent(result.envelope) === canonicalContent(expected)
      ? { status: 'qualified', envelope: result.envelope } : { status: 'invalid' };
  } };
}) };
const temporary = async (t) => { const path = await mkdtemp(join(tmpdir(), 'fleet-publication-')); t.after(() => rm(path, { recursive: true, force: true })); return path; };

test('registered v2 factory selections publish with separate qualifying counts and retained unknown quantities', async (t) => {
  const root = await temporary(t); const input = await fleetInput();
  const result = await writeCorpusCandidate(join(root, 'candidate'), input, registeredOptions);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.deepEqual(result.manifest.counts, { configurations: 2, distinctConfigurations: 2, vinMappings: 0, images: 0,
    sourceConfigurations: 2, qualifyingCompleteDistinctSourceConfigurations: 2 });
  const loaded = await validateCorpusDirectory(join(root, 'candidate'), registeredOptions);
  assert.equal(loaded.status, 'ok', JSON.stringify(loaded));
  assert.deepEqual(loaded.corpus.configurations[0].catalogue, input.configurations.find((r) => r.configurationId === loaded.corpus.configurations[0].configurationId).catalogue);
  assert.equal(loaded.corpus.configurations[0].catalogue.completeness.accessoryQuantities, 'unknown');
  assert.equal(loaded.corpus.configurations[0].configuration.productionDate, null);
});

test('configuration-only input needs no VIN allocation inventory or enabled physical profile', async (t) => {
  const root = await temporary(t); const input = await fleetInput(1); delete input.allocationInventory;
  const result = await writeCorpusCandidate(join(root, 'candidate'), input, registeredOptions);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(result.manifest.counts.vinMappings, 0);
});

test('a caller cannot substitute v2 facts or self-enrol an unregistered binding', async (t) => {
  const root = await temporary(t);
  for (const [name, change] of [
    ['measurement', (r) => { r.catalogue.facts.seats = { ...r.catalogue.facts.seats, state: 'known', value: 5 }; }],
    ['physical', (r) => { r.configuration.plant = 'Invented plant'; r.sourceContext.unresolvedFacts = r.sourceContext.unresolvedFacts.filter((v) => v !== 'plant'); }],
    ['identity', (r) => { r.catalogue.resolvedIdentity.bindingDigest = 'a'.repeat(64); }],
    ['source', (r) => { r.catalogue.sourceBinding.producerPins.sessionSha256 = 'b'.repeat(64); }],
  ]) {
    const input = await fleetInput(1); change(input.configurations[0]);
    assert.equal((await writeCorpusCandidate(join(root, name), input, registeredOptions)).status, 'invalid-corpus', name);
  }
  assert.equal((await writeCorpusCandidate(join(root, 'unregistered'), await fleetInput(1), { ...options, sourceRegistrations: [] })).status, 'invalid-corpus');
});

test('v2 corpus reload, additions and failure recovery use the existing durable registry', async (t) => {
  const root = await temporary(t); const store = join(root, 'store');
  const one = await fleetInput(1); const two = await fleetInput(2); two.metadata.version = '2';
  assert.equal((await writeCorpusCandidate(join(root, 'one'), one, registeredOptions)).status, 'ok');
  assert.equal((await writeCorpusCandidate(join(root, 'two'), two, registeredOptions)).status, 'ok');
  const registry = createSyntheticRegistry({ root: store, ...registeredOptions });
  assert.equal((await registry.publish(join(root, 'one'))).status, 'ok');
  assert.equal((await registry.publish(join(root, 'one'))).idempotent, true);
  assert.equal((await registry.publish(join(root, 'two'))).status, 'ok');
  const fresh = createSyntheticRegistry({ root: store, ...registeredOptions }); assert.equal((await fresh.load()).status, 'ok');
  assert.equal(fresh.getConfiguration(one.configurations[0].configurationId).status, 'partial');
  await writeFile(join(store, 'active.json'), '{broken');
  const recovered = createSyntheticRegistry({ root: store, ...registeredOptions });
  assert.equal((await recovered.load()).recovered, true);
  assert.deepEqual(recovered.getConfiguration(one.configurations[0].configurationId).record.catalogue, one.configurations[0].catalogue);
});

test('bundled admitted sources reconstitute qualification through normal standalone validator options', async (t) => {
  const root = await temporary(t);
  const prepared = await writeCorpusCandidate(join(root, 'candidate'), await fleetInput(2), registeredOptions);
  assert.equal(prepared.status, 'ok');
  const loaded = await validateCorpusDirectory(join(root, 'candidate'), options);
  assert.equal(loaded.status, 'ok', JSON.stringify(loaded));
  const reopened = createSyntheticRegistry({ root: join(root, 'store'), ...options });
  assert.equal((await reopened.publish(join(root, 'candidate'))).status, 'ok');
  assert.equal((await createSyntheticRegistry({ root: join(root, 'store'), ...options }).load()).status, 'ok');
});

test('adding configuration-only sources retains previously published configuration and VIN bytes', async (t) => {
  const root = await temporary(t); const before = await corpusInput();
  assert.equal((await writeCorpusCandidate(join(root, 'previous'), before, options)).status, 'ok');
  const previous = await validateCorpusDirectory(join(root, 'previous'), options);
  const input = await fleetInput(2); delete input.allocationInventory;
  input.retainedCorpusDirectory = join(root, 'previous');
  input.metadata.sourceContexts.push(...before.metadata.sourceContexts);
  assert.equal((await writeCorpusCandidate(join(root, 'next'), input, options)).status, 'ok');
  const next = await validateCorpusDirectory(join(root, 'next'), options);
  assert.equal(next.manifest.counts.configurations, 3);
  assert.equal(next.manifest.counts.qualifyingCompleteDistinctSourceConfigurations, 2);
  assert.deepEqual(next.corpus.vins, previous.corpus.vins);
  assert.deepEqual(next.corpus.configurations.find((r) => r.configurationId === previous.corpus.configurations[0].configurationId), previous.corpus.configurations[0]);
  input.configurations = [...input.configurations, { ...previous.corpus.configurations[0], snapshotVersion: 'changed-source' }];
  assert.equal((await writeCorpusCandidate(join(root, 'conflict'), input, options)).failure.code, 'historical-configuration-conflict');
});

test('normal offline runtime resolves new source configuration and retains its previous synthetic VIN', async () => {
  const lookup = createLocalVehicleEvidenceLookup();
  const source = await lookup.resolve({ kind: 'configuration', id: records[0].configurationId });
  assert.equal(source.status, 'partial', JSON.stringify(source));
  const previous = await lookup.resolve({ kind: 'vin', id: 'WBA33DB08TC426611' });
  assert.equal(previous.status, 'partial', JSON.stringify(previous));
});
