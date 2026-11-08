// Root-owned ordinary publication from exact retained bytes, with public proof limits explicit.
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
assert.equal(process.argv[2], '--receipt');
const receiptPath = process.argv[3];
assert.ok(isAbsolute(receiptPath) && /\/test-stamp-shard-[a-f0-9]+$/.test(process.env.TMPDIR));
const digest = '86ec3769dd55631007974869264f6d8a25671d9cf041f715e107b1435c297f4f';
const previous = '421ccd4ec6377e7e97d61f9017d76643ddbeaa76c2ebd5e4cf7f1d88d48a039d';
const cloud = '/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output';
const candidate = join(cloud, 'fleet-dot7-offline-20261107/candidate');
const proof = JSON.parse(await readFile(join(cloud, 'fleet-dot7-public-20261107/download/download-receipt.json')));
assert.equal(proof.status, 'real-cli-anonymous-public-restore-passed');
assert.equal(proof.releaseId, digest);
assert.equal(proof.restore.status, 'ok');
assert.equal(proof.restore.active.manifestDigest, digest);
assert.equal(proof.restore.mode, 'cold-restore');
assert.equal(proof.network.denied, 0);
assert.equal(proof.network.authorization, false);
assert.equal(proof.network.cookie, false);
const diagnosed = JSON.parse(await readFile(join(root, 'docs/gcsp/evidence/fucq62/fleet-dot7-public/diagnose-context-results.json')));
assert.equal(diagnosed.receiptSha256, 'aeafe4d28ed05efe8ab1dcfa133ffae404ba50a435dd9f382108f5dfc981b19e');
assert.equal(await sha(join(cloud, 'fleet-dot7-public-20261107/diagnose-context/receipt.json')), diagnosed.receiptSha256);
assert.equal(diagnosed.result.rc, 0);
const recovery = JSON.parse(await readFile(join(root, 'docs/gcsp/evidence/fucq62/fleet-dot7-offline/recovery2-results.json')));
assert.equal(recovery.receipt.status, 'actual-offline-pack-restart-and-changed-recovery-passed');
assert.equal(recovery.receipt.manifestDigest, digest);
assert.equal(recovery.receipt.cases.corrupt264Source.previousManifestDigest, previous);
assert.equal(recovery.receipt.cases.corruptCurrentImageAssociation.previousManifestDigest, previous);
const offlineProof = JSON.parse(await readFile(join(cloud, 'fleet-dot7-public-20261107/diagnose-context/proof-minimal-env/dto-http-proof.json')));
assert.equal(offlineProof.status, 'dto-http-passed-known-consumer-limitation');
assert.equal(offlineProof.manifestDigest, digest);
assert.equal(offlineProof.lookupDtoParity.passed, 1135);
assert.equal(offlineProof.http.unionUnique, 1135);
assert.equal(offlineProof.http.sampleKeys.length, 1024);
assert.equal(offlineProof.http.complement.length, 111);
assert.equal(offlineProof.configuredConsumer.passed, 1133);
assert.equal(offlineProof.configuredConsumer.failed, 2);
assert.equal(offlineProof.configuredConsumer.acceptanceWaiver, false);
assert.equal(offlineProof.externalCalls, 0);
assert.equal(offlineProof.sourceCalls, 0);
assert.ok((await readFile(join(root, 'render.gcsp.yaml'), 'utf8')).includes('--release ' + digest));
const release = fleetReleases.find(row => row.releaseId === digest);
assert.ok(release);
assert.equal(proof.files.length, release.assets.length);
for (const asset of release.assets) {
  const observed = proof.files.find(row => row.path === asset.path);
  assert.deepEqual(observed, { name: asset.name, path: asset.path, bytes: asset.bytes, sha256: asset.sha256 });
}
const store = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const initial = JSON.parse(await readFile(join(store, 'active.json')));
assert.equal(initial.selected.manifestDigest, previous, 'Preserve any changed selection.');
const oldHistory = JSON.parse(await readFile(join(store, 'identity-inventory.json')));
assert.equal(oldHistory.configurations.length, 870);
assert.equal(oldHistory.datasets.length, 7);
async function sha(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
const oldPins = [];
for (const directory of await readdir(join(store, 'versions'))) {
  for (const file of await readdir(join(store, 'versions', directory))) {
    const path = join('versions', directory, file);
    if ((await stat(join(store, path))).isFile()) oldPins.push({ path, sha256: await sha(join(store, path)) });
  }
}
for (const name of ['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl']) {
  const asset = release.assets.find(row => row.path === `store/versions/${digest}/${name}`);
  assert.ok(asset);
  assert.equal((await stat(join(candidate, name))).size, asset.bytes);
  assert.equal(await sha(join(candidate, name)), asset.sha256);
}
const options = {
  approvedImages: APPROVED_CORPUS_IMAGES,
  jsonlLimitsForManifest: releaseLimits,
  policyService: createPolicyService({ provider: new FilePolicyProvider() }),
  policyRead: { runId: 'f62-dot7-ordinary-publication', asOf: '2026-11-07T00:00:00.000Z' }
};
const guard = installFleetOfflineGuard();
const control = guard.control();
let published;
try {
  const registry = createSyntheticRegistry({ root: store, ...options });
  assert.equal((await registry.load()).active.manifestDigest, previous);
  published = await registry.publish(candidate);
  assert.equal(published.status, 'ok', JSON.stringify(published));
  assert.equal(published.active.manifestDigest, digest);
  assert.equal(published.active.counts.sourceConfigurations, 1133);
  assert.equal(published.active.counts.images, 2);
  assert.equal((await registry.publish(candidate)).idempotent, true);
  const cold = createSyntheticRegistry({ root: store, ...options });
  assert.equal((await cold.load()).active.manifestDigest, digest);
  for (const asset of release.assets.filter(row => row.role === 'corpus')) {
    const path = join(store, asset.path.slice('store/'.length));
    assert.equal((await stat(path)).size, asset.bytes);
    assert.equal(await sha(path), asset.sha256);
  }
  for (const pin of oldPins) assert.equal(await sha(join(store, pin.path)), pin.sha256);
  const history = JSON.parse(await readFile(join(store, 'identity-inventory.json')));
  assert.equal(history.configurations.length, 1134);
  assert.equal(history.datasets.length, 8);
  assert.deepEqual(history.identities, oldHistory.identities);
  for (const old of oldHistory.configurations) assert.deepEqual(history.configurations.find(row => row.configurationId === old.configurationId), old);
  for (const old of oldHistory.datasets) assert.deepEqual(history.datasets.find(row => row.datasetId === old.datasetId && row.version === old.version), old);
  assert.equal(APPROVED_CORPUS_IMAGES.length, 2);
  for (const image of APPROVED_CORPUS_IMAGES) {
    const selected = cold.getConfiguration(image.configurationId);
    assert.deepEqual(selected.record.imageIds, []);
    assert.deepEqual(selected.images, [image]);
    assert.equal(selected.imageState, 'representative');
  }
  assert.equal(guard.calls.length, 0);
  assert.deepEqual((await readdir(store)).filter(name => /^\.(stage|publisher|write)-/.test(name)), []);
} finally {
  guard.restore();
}
await writeFile(receiptPath, JSON.stringify({
  status: 'ordinary-dot7-published-known-consumer-limitation', releaseId: digest,
  previousManifestDigest: previous, counts: published.active.counts, oldVersionFilesRehashed: oldPins.length,
  oldHistoryConfigurationsUnchanged: oldHistory.configurations.length, oldHistoryIdentitiesUnchanged: oldHistory.identities.length,
  oldHistoryDatasetsUnchanged: oldHistory.datasets.length, addedConfigurations: 264, addedDatasets: 1,
  allPublicCorpusAssetBytesIdentical: true, idempotentRepeat: true, coldRepresentativeImages: 2,
  egress: { control, calls: guard.calls.length },
  publicEvidence: { exactAnonymousAssetsAndColdRestore: true, completePublicProof: false,
    firstParityFailure: 'unregistered-source', retryRestoreFailure: 'artifact-release-failed', cause: 'unestablished' },
  offline1135DtoAndHttpProofReused: true, offlineChangedSourceAndImageRollbackReused: true,
  linuxPublicBuildAndActualDeploymentProof: 'pending',
  configuredConsumer: { passed: 1133, failed: 2, severity: 'Medium', acceptanceWaiver: false },
  ordinaryStore: store, pushOrDeployExecuted: false, acceptance: false
}, null, 2) + '\n');
console.log(JSON.stringify({ status: 'ordinary-dot7-published-known-consumer-limitation', releaseId: digest, counts: published.active.counts }));
