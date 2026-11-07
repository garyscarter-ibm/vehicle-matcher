import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCorpusCandidate, validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { sourceBackedInput, options } from './helpers/vin-corpus-fixture.js';
import { verifyActiveFleet } from '../../scripts/gcsp/verify-fleet.mjs';
import { validateRegisteredCorpusImage } from '../gcsp/vehicle-evidence/registered-corpus-images.js';

const signature = 'T5MJ:FKSFU,P0300,S0230,S02PA,S02VB,S02VD,S0302,S0337,S03DK,S03G9,S03M1,S0428,S043L,S0488,S0494,S04T2,S04U9,S04UR,S04V1,S0552,S05AS,S05AV,S05DM,S0654,S0674,S06AE,S06AF,S06AK,S06C4,S06NX,S06PA,S0704,S0710,S0760,S0775,S0812,S0853,S0880,S08R3,S08R9,S08SM,S08TF,S08TG,S08WM,S09QV,S09T1,S09T2';
const configurationId = Buffer.from(signature).toString('base64');
const image = { imageId: 'bmw-i5-white-20261101-v1', configurationId,
  asset: 'assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp',
  role: 'representative-configuration', fidelity: 'representative-configuration',
  sourceKind: 'dated-snapshot', observedDate: '2026-11-01' };

test('a retained real image augments lookup after restart without changing the published configuration or its history', async (t) => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Retained image lookup must remain offline'));
  const root = await mkdtemp(join(tmpdir(), 'retained-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = await sourceBackedInput(); assert.equal(input.configurations[0].configurationId, configurationId);
  const baseline = join(root, 'baseline');
  assert.equal((await writeCorpusCandidate(baseline, input, options)).status, 'ok');
  const approved = { ...options, approvedImages: [image] };
  const store = join(root, 'store'); const registry = createSyntheticRegistry({ root: store, ...approved });
  assert.equal((await registry.publish(baseline)).status, 'ok');
  const originalRows = await readFile(join(baseline, 'configurations.jsonl'), 'utf8');
  const originalHistory = JSON.parse(await readFile(join(store, 'identity-inventory.json'), 'utf8'));
  const candidate = join(root, 'image-only');
  const prepared = await writeCorpusCandidate(candidate, { ...input, configurations: [],
    metadata: { ...input.metadata, version: 'retained-image-1' }, retainedCorpusDirectory: baseline, images: [image] }, approved);
  assert.equal(prepared.status, 'ok', JSON.stringify(prepared));
  assert.equal(await readFile(join(candidate, 'configurations.jsonl'), 'utf8'), originalRows);
  const checked = await validateCorpusDirectory(candidate, approved); assert.equal(checked.status, 'ok');
  assert.equal(checked.corpus.manifest.counts.images, 1); assert.equal(checked.corpus.manifest.completeness.imagesMissing, 0);
  assert.equal((await registry.publish(candidate)).status, 'ok');
  const history = JSON.parse(await readFile(join(store, 'identity-inventory.json'), 'utf8'));
  assert.deepEqual(history.configurations, originalHistory.configurations);
  assert.deepEqual(history.identities, originalHistory.identities);
  const restarted = createSyntheticRegistry({ root: store, ...approved }); assert.equal((await restarted.load()).status, 'ok');
  const read = restarted.getConfiguration(configurationId);
  assert.deepEqual(read.record.imageIds, []); assert.deepEqual(read.images, [image]); assert.equal(read.imageState, 'representative');
  assert.equal(JSON.stringify(read.record), JSON.stringify(JSON.parse(originalRows)));
  const lookup = createLocalVehicleEvidenceLookup({ root: store, policyService: options.policyService, asOf: options.policyRead.asOf });
  const details = await createConfiguredVehicleDetails({ lookup }).resolve({ kind: 'configuration', id: configurationId });
  assert.equal(details.status, 'complete', JSON.stringify(details));
  assert.equal(details.vehicle.images.state, 'representative');
  assert.equal(details.vehicle.images.items[0].asset, image.asset);
  assert.equal(details.vehicle.images.items[0].label, 'Representative configuration image');
  assert.equal(details.vehicle.source.productionDate, null);
  const audit = await verifyActiveFleet({ root: store, requiredDistinct: 1, offline: true, ...approved });
  assert.equal(audit.status, 'verified-active', JSON.stringify(audit));
  assert.equal(audit.audit.errors, 0); assert.equal(audit.egress.externalCalls, 0);
});

test('an additive image cannot borrow a changed source context, factory selection, accessory quantity or presentation reference', async () => {
  const row = (await sourceBackedInput()).configurations[0];
  assert.equal(await validateRegisteredCorpusImage(image, row), true);
  for (const mutate of [
    (r) => { r.catalogue.resolvedIdentity.agModelCode = 'OTHER'; },
    (r) => { r.catalogue.resolvedIdentity.selectedOptions[1] = 'P0475'; },
    (r) => { r.catalogue.requestedIdentity.effectDate = '2027-02-05'; },
    (r) => { r.catalogue.resolvedIdentity.selectedAccessories[0].quantity = 2; },
    (r) => { r.sourceContext.observedDate = '2026-11-07'; },
  ]) {
    const changed = structuredClone(row); mutate(changed);
    assert.equal(await validateRegisteredCorpusImage(image, changed), false);
  }
  for (const changed of [{ ...image, asset: 'assets/another.webp' }, { ...image, role: 'representative-model' },
    { ...image, configurationId: Buffer.from('OTHER:REFERENCE').toString('base64') }]) {
    assert.equal(await validateRegisteredCorpusImage(changed, row), false);
  }
});

test('registered published bytes must remain identical to the retained F42 WebP', async () => {
  const row = (await sourceBackedInput()).configurations[0];
  const bytes = await readFile(new URL(`../../${image.asset}`, import.meta.url));
  const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1;
  for (const value of [null, changed, bytes.subarray(1), Buffer.concat([bytes, Buffer.from([0])])]) {
    assert.equal(await validateRegisteredCorpusImage(image, row, { loadPublishedAsset: async () => value }), false);
  }
});

test('caller approval alone cannot add an unregistered image association to an immutable row', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'unregistered-image-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = await sourceBackedInput();
  const unregistered = { ...image, imageId: 'caller-approved-image' };
  const result = await writeCorpusCandidate(join(root, 'candidate'), { ...input, images: [unregistered] },
    { ...options, approvedImages: [unregistered] });
  assert.equal(result.status, 'invalid-corpus');
  assert.equal(result.failure.code, 'dangling-image');
});
