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
const plan=JSON.parse(await readFile(new URL('./fleet-dot8-1923-public/plan.json',import.meta.url)));
const digest=plan.releaseId;const previous=plan.previousManifestDigest;const expected=plan.expected;const prior=plan.previousExpected;
const candidate=join(plan.packageRoot,'candidate');const publicRoot=join(plan.outputRoot,'download');
const originalDownload=join(plan.outputRoot,'download');const followupPlan=JSON.parse(await readFile(new URL('./fleet-dot8-1923-public/followup-plan.json',import.meta.url)));
assert.equal(await sha(join(originalDownload,'download-receipt.json')),followupPlan.publicReceiptSha256);
const proof=JSON.parse(await readFile(join(originalDownload,'download-receipt.json')));
assert.equal(proof.status,'real-cli-anonymous-public-restore-passed');assert.equal(proof.releaseId,digest);assert.equal(proof.restore.status,'ok');assert.equal(proof.restore.active.manifestDigest,digest);assert.equal(proof.restore.mode,'cold-restore');assert.equal(proof.network.denied,0);assert.equal(proof.network.authorization,false);assert.equal(proof.network.cookie,false);assert.equal(proof.network.attempts,plan.network.anonymousMaxRequests);
// Reuse the unchanged, previously passed full offline proof. Failed follow-up is not a completion gate or passing evidence.
for(const [path,pin]of Object.entries(plan.offlineEvidence))assert.equal(await sha(join(root,path)),pin,path);
const offlineSummaryPath=join(root,'docs/gcsp/evidence/fucq62/fleet-dot8-1923-offline/summary.json');
const offline=JSON.parse(await readFile(offlineSummaryPath));assert.equal(offline.manifestDigest,digest);assert.equal(offline.descriptorSha256,plan.descriptorSha256);assert.equal(offline.assets,expected.files);assert.equal(offline.packBytes,expected.bytes);
assert.deepEqual(offline.lookupDtoParity,{checked:expected.direct,failed:0,passed:expected.direct});assert.equal(offline.configuredConsumer.passed,expected.configuredConsumerPassed);assert.equal(offline.configuredConsumer.failed,expected.configuredConsumerFailed);
assert.equal(offline.http.uniqueUnion,expected.httpUnique);assert.deepEqual(offline.http.chunks,[expected.httpSample,expected.httpComplement]);assert.equal(offline.http.overlap,0);assert.equal(offline.http.errors,0);assert.equal(offline.http.externalCalls,0);assert.equal(offline.http.sourceCalls,0);assert.equal(offline.http.allDtoAndManifestExact,true);
const rawPath=join(root,'docs/gcsp/evidence/fucq62/fleet-dot8-1923-offline/strict-audit-report.json');const raw=JSON.parse(await readFile(rawPath));assert.equal(raw.status,plan.knownConsumerDefect.rawVerifierStatus);assert.equal(raw.audit.errors,expected.configuredConsumerFailed);
const failedFollowup=JSON.parse(await readFile(new URL('./fleet-dot8-1923-public/followup-offline-failed.json',import.meta.url)));assert.equal(failedFollowup.result.rc,1);assert.equal(failedFollowup.acceptance,false);
const recoveryPath=join(root,'docs/gcsp/evidence/fucq62/fleet-dot8-1923-offline/recovery-results.json');assert.equal(await sha(recoveryPath),plan.offlineEvidence['docs/gcsp/evidence/fucq62/fleet-dot8-1923-offline/recovery-results.json']);const recovery=JSON.parse(await readFile(recoveryPath));assert.equal(recovery.receipt.status,'actual-offline-pack-restart-and-changed-recovery-passed');assert.equal(recovery.receipt.manifestDigest,digest);assert.equal(recovery.receipt.cases.corrupt790Source.previousManifestDigest,previous);assert.equal(recovery.receipt.cases.corrupt790Source.previousSourceConfigurations,prior.sourceConfigurations);assert.equal(recovery.receipt.cases.corrupt790Source.previousImages,prior.images);assert.equal(recovery.receipt.cases.corruptCurrentImageAssociation.previousManifestDigest,previous);
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
assert.equal(oldHistory.configurations.length, prior.configurations);
assert.equal(oldHistory.datasets.length, prior.datasets);
for(const [path,pin]of Object.entries(plan.ordinaryBaselinePins))assert.equal(await sha(join(store,path)),pin,path);
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
  policyRead: { runId: 'f62-dot8-ordinary-publication', asOf: '2026-11-07T00:00:00.000Z' }
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
  assert.equal(published.active.counts.sourceConfigurations, expected.sourceConfigurations);
  assert.equal(published.active.counts.images, expected.images);
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
  assert.equal(history.configurations.length, expected.configurations);
  assert.equal(history.datasets.length, expected.datasets);
  assert.deepEqual(history.identities, oldHistory.identities);
  assert.equal(history.revision,oldHistory.revision+1);
  for (const old of oldHistory.configurations) assert.deepEqual(history.configurations.find(row => row.configurationId === old.configurationId), old);
  for (const old of oldHistory.datasets) assert.deepEqual(history.datasets.find(row => row.datasetId === old.datasetId && row.version === old.version), old);
  assert.equal(APPROVED_CORPUS_IMAGES.length, expected.images);
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
  status: 'ordinary-dot8-published-operational-exception-known-consumer-limitation', releaseId: digest,
  previousManifestDigest: previous, counts: published.active.counts, oldVersionFilesRehashed: oldPins.length,
  oldHistoryConfigurationsUnchanged: oldHistory.configurations.length, oldHistoryIdentitiesUnchanged: oldHistory.identities.length,
  oldHistoryDatasetsUnchanged: oldHistory.datasets.length, addedConfigurations: expected.configurations-prior.configurations, addedDatasets: 1,
  allPublicCorpusAssetBytesIdentical: true, idempotentRepeat: true, coldRepresentativeImages: expected.images,
  egress: { control, calls: guard.calls.length },
  publicEvidence: { exactAnonymousAssetsAndColdRestore: true, completePublicProof: false,
    originalFailedStep:'consumer request-key expected hash used id/kind insertion order',
    originalPublicHttpCompletion:'unmet: 1024 public-context sample passed; 901 complement and changed-edge public context unrun',
    sameByteOfflineContinuation:false, previousPassedOfflineEvidenceReused:true,
    publicDownloadReceiptSha256:followupPlan.publicReceiptSha256, offlineSummarySha256:await sha(offlineSummaryPath),
    failedZeroNetworkFollowup:'active-audit-unavailable: duplicate guard installation before DTO proof; incomplete',
    rawAuditStatus:raw.status,
    operationalDisposition:'Root-authorized ordinary integration; Medium proof harness defects and consumer defect retained; no AC waiver' },
  sameByteOfflineDtoAndHttpProofReused: true, offlineChangedSourceAndImageRollbackReused: true,
  linuxPublicBuildAndActualDeploymentProof: 'pending',
  configuredConsumer: { passed: expected.configuredConsumerPassed, failed: expected.configuredConsumerFailed, severity: 'Medium', acceptanceWaiver: false },
  ordinaryStore: store, pushOrDeployExecuted: false, acceptance: false
}, null, 2) + '\n');
console.log(JSON.stringify({ status: 'ordinary-dot8-published-operational-exception-known-consumer-limitation', releaseId: digest, counts: published.active.counts }));
