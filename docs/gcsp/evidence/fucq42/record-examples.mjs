// Offline usage recipe; writes only this story's concise contract evidence.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createBmwImageAdapter, bmwImageLookupIdentity, presentBmwImage } from '../../../../server/vehicle-evidence/bmw-image-adapter.js';

const manifest = JSON.parse(await readFile(new URL('../../../../server/vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json', import.meta.url)));
const request = (entry = manifest.assets[0]) => ({ ...entry.identity, viewpoint: entry.viewpoint, size: { ...entry.size } });
const adapter = createBmwImageAdapter({ environment: 'gcsp-demo' });
const project = (result) => ({ status: result.status, failure: result.failure, image: result.image,
  resolvedConfiguration: result.resolvedIdentity !== null, fallback: result.fallback, presentation: presentBmwImage(result) });
const examples = {};
for (const entry of manifest.assets) {
  const input = request(entry);
  const result = await adapter.resolve(input);
  const delivered = await adapter.readAsset(entry.assetId);
  assert.equal(result.status, 'ok');
  assert.equal(delivered.status, 'ok');
  assert.equal(delivered.bytes.readUInt16LE(26) & 0x3fff, entry.size.width);
  assert.equal(delivered.bytes.readUInt16LE(28) & 0x3fff, entry.size.height);
  assert.equal(createHash('sha256').update(delivered.bytes).digest('hex'), entry.sha256);
  examples[entry.paint.code] = { keySha256: createHash('sha256').update(JSON.stringify(bmwImageLookupIdentity(input))).digest('hex'), ...project(result) };
}
examples.missing = project(await createBmwImageAdapter({ environment: 'gcsp-demo',
  loadAsset: async () => { throw Error('missing local asset'); } }).resolve(request()));
examples.unsupportedView = project(await adapter.resolve({ ...request(), viewpoint: 'SIDELEFT' }));
examples.unsupportedSize = project(await adapter.resolve({ ...request(), size: { width: 1280, height: 1152 } }));
examples.unknownFidelity = project(await adapter.resolve({ ...request(), modelCode: 'T3MQ' },
  { fallback: 'bmw-i5-generic-20261101-v1' }));
assert.equal(examples.missing.status, 'source-unavailable');
assert.equal(examples.unsupportedView.status, 'unsupported');
assert.equal(examples.unsupportedSize.status, 'unsupported');
assert.equal(examples.unknownFidelity.resolvedConfiguration, false);
assert.ok(Object.values(examples.unknownFidelity.image.fidelity).every((state) => state === 'unknown'));
const output = JSON.stringify({ observed: '2026-11-05', snapshotVersion: manifest.snapshotVersion,
  sourceObserved: manifest.observedDate, examples }, null, 2) + '\n';
assert.doesNotMatch(output, /https?:|cosySec|x-api-key|garageId|userId/i);
await writeFile(new URL('presentation-examples.json', import.meta.url), output);
console.log('Six offline contract examples recorded; both registered WebP artifacts inspected.');
