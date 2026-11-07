import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APPROVED_CORPUS_IMAGES, validateRegisteredCorpusImage } from '../gcsp/vehicle-evidence/registered-corpus-images.js';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { corpusInput, options } from './helpers/vin-corpus-fixture.js';
import { emptyAllocationInventory } from '../gcsp/vehicle-evidence/vin-allocation.js';

const accepted = JSON.parse((await readFile(new URL('../data/gcsp/vehicle-evidence/registered-sources/f70-1f7e-first32-2026-11-07.jsonl', import.meta.url), 'utf8')).split('\n')[0]);
const image = APPROVED_CORPUS_IMAGES.find((item) => item.imageId === 'bmw-1f7e-20261107-v2');
function row() {
  const c = accepted.catalogue; const b = c.sourceBinding;
  const configuration = Object.fromEntries(['model','derivative','generation','body','powertrain','drive','transmission','engineCode','agModelCode','vgModelCode','market','region','steering','modelYear','productionEra','productionDate','plant'].map((key) => [key, null]));
  Object.assign(configuration, { model: b.optionalFacts.modelName.value, generation: b.confirmedContext.rawModelRange.value,
    agModelCode: b.canonicalIdentity.agModelCode, vgModelCode: b.canonicalIdentity.vgModelCode, market: b.requestScope.market });
  return { configurationId: accepted.configurationId, canonicalSignature: accepted.canonicalSignature,
    canonicalIdentity: { ...structuredClone(b.canonicalIdentity), provenance: structuredClone(c.identityProvenance) },
    snapshotVersion: c.snapshotVersion, configuration, catalogue: structuredClone(c), imageIds: [],
    sourceContext: { sourceRefs: [...new Set(b.evidence.map((e) => e.request.url))].sort(), observedDate: c.observedDate,
      catalogueDate: c.observedDate, sourceKind: 'dated-snapshot', confidence: 'Exact retained complete factory selection; physical build and equipment fidelity remain unknown',
      unresolvedFacts: Object.keys(configuration).filter((key) => configuration[key] === null), selectedOptionCompleteness: c.completeness.factorySelection } };
}

test('actual v2 image registration binds the exact retained source and captured bytes while preserving v1', async () => {
  assert.equal(APPROVED_CORPUS_IMAGES[0].imageId, 'bmw-i5-white-20261101-v1'); assert.ok(image);
  assert.equal(await validateRegisteredCorpusImage(image, row()), true);
  for (const mutate of [
    (r) => { r.catalogue.facts.seats.value = 5; },
    (r) => { r.catalogue.lookupIdentity.bindingDigest = '0'.repeat(64); },
    (r) => { r.canonicalIdentity.factoryOptionCodes[0] = 'OTHER'; },
    (r) => { r.configuration.productionDate = '2027-01-05'; },
    (r) => { r.sourceContext.catalogueDate = '2026-11-01'; },
  ]) { const changed = row(); mutate(changed); assert.equal(await validateRegisteredCorpusImage(image, changed), false); }
  const bytes = await readFile(new URL(`../../${image.asset}`, import.meta.url)); const corrupt = Buffer.from(bytes); corrupt[0] ^= 1;
  for (const value of [null, corrupt, bytes.subarray(1), Buffer.concat([bytes, Buffer.from([0])])])
    assert.equal(await validateRegisteredCorpusImage(image, row(), { loadPublishedAsset: async () => value }), false);
  assert.equal(await validateRegisteredCorpusImage({ ...image, configurationId: APPROVED_CORPUS_IMAGES[0].configurationId }, row()), false);
});

test('existing additive publisher keeps v2 configuration and identity history byte stable across restart with no network', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Retained publication stays offline'));
  const root = await mkdtemp(join(tmpdir(), 'v2-retained-image-')); t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await corpusInput(); const original = row();
  const input = { ...fixture, configurations: [original], allocationInventory: emptyAllocationInventory(),
    metadata: { ...fixture.metadata, datasetId: 'v2-image-proof', sourceContexts: [{ sourceKind: 'dated-snapshot', observedDate: '2026-11-07', catalogueDate: '2026-11-07', market: 'GB', steering: null, note: 'One accepted v2 source; no physical vehicle claim' }] } };
  const baseline = join(root, 'baseline'); const approved = { ...options, approvedImages: APPROVED_CORPUS_IMAGES };
  const before = await writeCorpusCandidate(baseline, input, approved); assert.equal(before.status, 'ok', JSON.stringify(before));
  const store = join(root, 'store'); const registry = createSyntheticRegistry({ root: store, ...approved });
  assert.equal((await registry.publish(baseline)).status, 'ok');
  const immutable = await readFile(join(baseline, 'configurations.jsonl'), 'utf8'); const history = await readFile(join(store, 'identity-inventory.json'), 'utf8');
  const candidate = join(root, 'candidate');
  const result = await writeCorpusCandidate(candidate, { ...input, configurations: [], retainedCorpusDirectory: baseline,
    metadata: { ...input.metadata, version: 'v2-image-1' }, images: [image] }, approved);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.equal(await readFile(join(candidate, 'configurations.jsonl'), 'utf8'), immutable);
  assert.equal((await registry.publish(candidate)).status, 'ok');
  const beforeHistory = JSON.parse(history); const afterHistory = JSON.parse(await readFile(join(store, 'identity-inventory.json')));
  assert.deepEqual(afterHistory.configurations, beforeHistory.configurations); assert.deepEqual(afterHistory.identities, beforeHistory.identities);
  const restarted = createSyntheticRegistry({ root: store, ...approved }); assert.equal((await restarted.load()).status, 'ok');
  const loaded = restarted.getConfiguration(original.configurationId); assert.deepEqual(loaded.record, JSON.parse(immutable));
  assert.deepEqual(loaded.record.imageIds, []); assert.deepEqual(loaded.images, [image]); assert.equal(loaded.imageState, 'representative');
  assert.equal(loaded.record.catalogue.facts.seats.state, 'unknown'); assert.equal(loaded.record.configuration.productionDate, null);
});
