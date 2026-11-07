// Root-owned ordinary publication after the exact public restore boundary passes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService, FilePolicyProvider } from '../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { fleetReleases, releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
assert.equal(process.argv[2], '--receipt'); const receiptPath = process.argv[3];
assert.ok(isAbsolute(receiptPath) && /\/test-stamp-shard-[a-f0-9]+$/.test(process.env.TMPDIR));
const digest = '421ccd4ec6377e7e97d61f9017d76643ddbeaa76c2ebd5e4cf7f1d88d48a039d';
const previous = '7f4396b8fcddf14eb0d7386a47cbc41f58e1385d8ee30a0bda95f292c016e431';
const cloud = '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output';
const candidate = join(cloud, 'fleet-dot6-offline-20261107/candidate');
const proof = JSON.parse(await readFile(join(cloud, 'fleet-dot6-public-20261107/download/receipt.json')));
assert.equal(proof.status, 'anonymous-public-restore-full-offline-parity-and-changed-rollback-passed');
assert.equal(proof.releaseId, digest); assert.equal(proof.direct, 871); assert.equal(proof.http, 871);
assert.equal(proof.errors, 0); assert.equal(proof.sourceProviderEgress, 0);
assert.ok((await readFile(join(root, 'render.gcsp.yaml'), 'utf8')).includes('--release ' + digest));
const release = fleetReleases.find(r => r.releaseId === digest); assert.ok(release);
const store = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const initial = JSON.parse(await readFile(join(store, 'active.json')));
assert.equal(initial.selected.manifestDigest, previous, 'Preserve any already activated or changed selection.');
const oldHistory = JSON.parse(await readFile(join(store, 'identity-inventory.json')));
assert.equal(oldHistory.configurations.length, 480); assert.equal(oldHistory.datasets.length, 6);
async function sha(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
const oldPins = [];
for (const dir of await readdir(join(store, 'versions'))) for (const file of await readdir(join(store, 'versions', dir))) {
  const path = join('versions', dir, file); if ((await stat(join(store, path))).isFile()) oldPins.push({ path, sha256: await sha(join(store, path)) });
}
for (const name of ['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl']) {
  const asset = release.assets.find(a => a.path === `store/versions/${digest}/${name}`); assert.ok(asset);
  assert.equal((await stat(join(candidate, name))).size, asset.bytes); assert.equal(await sha(join(candidate, name)), asset.sha256);
}
const options = { approvedImages: APPROVED_CORPUS_IMAGES, jsonlLimitsForManifest: releaseLimits,
  policyService: createPolicyService({ provider: new FilePolicyProvider() }),
  policyRead: { runId: 'f62-dot6-ordinary-publication', asOf: '2026-11-07T00:00:00.000Z' } };
const guard = installFleetOfflineGuard(); const control = guard.control(); let published; let history;
try {
  const registry = createSyntheticRegistry({ root: store, ...options });
  assert.equal((await registry.load()).active.manifestDigest, previous);
  published = await registry.publish(candidate); assert.equal(published.status, 'ok', JSON.stringify(published));
  assert.equal(published.active.manifestDigest, digest); assert.equal(published.active.counts.sourceConfigurations, 869);
  assert.equal((await registry.publish(candidate)).idempotent, true);
  const cold = createSyntheticRegistry({ root: store, ...options }); assert.equal((await cold.load()).active.manifestDigest, digest);
  for (const asset of release.assets.filter(a => a.role === 'corpus')) {
    const path = join(store, asset.path.slice('store/'.length));
    assert.equal((await stat(path)).size, asset.bytes); assert.equal(await sha(path), asset.sha256);
  }
  for (const pin of oldPins) assert.equal(await sha(join(store, pin.path)), pin.sha256);
  history = JSON.parse(await readFile(join(store, 'identity-inventory.json')));
  assert.equal(history.configurations.length, 870); assert.equal(history.datasets.length, 7);
  assert.deepEqual(history.identities, oldHistory.identities);
  for (const old of oldHistory.configurations) assert.deepEqual(history.configurations.find(r => r.configurationId === old.configurationId), old);
  for (const old of oldHistory.datasets) assert.deepEqual(history.datasets.find(r => r.datasetId === old.datasetId && r.version === old.version), old);
  const image = cold.getConfiguration(APPROVED_CORPUS_IMAGES[0].configurationId);
  assert.deepEqual(image.record.imageIds, []); assert.deepEqual(image.images, APPROVED_CORPUS_IMAGES); assert.equal(image.imageState, 'representative');
  assert.equal(guard.calls.length, 0);
  assert.deepEqual((await readdir(store)).filter(n => /^\.(stage|publisher|write)-/.test(n)), []);
} finally { guard.restore(); }
await writeFile(receiptPath, JSON.stringify({ status: 'ordinary-dot6-published-coherent-anchor-staged', releaseId: digest,
  previousManifestDigest: previous, counts: published.active.counts, oldVersionFilesRehashed: oldPins.length,
  oldHistoryConfigurationsUnchanged: oldHistory.configurations.length, oldHistoryIdentitiesUnchanged: oldHistory.identities.length,
  oldHistoryDatasetsUnchanged: oldHistory.datasets.length, addedConfigurations: 390, addedDatasets: 1,
  allPublicCorpusAssetBytesIdentical: true, idempotentRepeat: true, coldImageState: 'representative',
  egress: { control, calls: guard.calls.length }, public871DirectAnd871HttpProofReused: true,
  ordinaryStore: store, pushOrDeployExecuted: false, acceptance: false }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'ordinary-dot6-published-coherent-anchor-staged', releaseId: digest, counts: published.active.counts }));
