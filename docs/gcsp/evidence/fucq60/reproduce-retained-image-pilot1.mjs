import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { writeCorpusCandidate, validateCorpusDirectory } from '../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createLocalVehicleEvidenceLookup } from '../../../../server/gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../../../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import { releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
import { verifyActiveFleet } from '../../../../scripts/gcsp/verify-fleet.mjs';

// This proof writes only inside supervisor-owned TMPDIR and its explicit receipt.
assert.equal(process.argv[2], '--receipt');
const receipt = process.argv[3]; const scratch = process.env.TMPDIR;
assert.ok(isAbsolute(receipt) && isAbsolute(scratch) && /\/test-stamp-shard-[a-f0-9]+$/.test(scratch));
assert.ok(relative(scratch, receipt).startsWith('..'));
const project = fileURLToPath(new URL('../../../../', import.meta.url));
const sourceStore = join(project, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const expectedManifest = '8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9';
const expectedConfigurations = 'da5c54020b9ccf2eddef8160a8df4e501f7ce57884b195bd275e242ff843f2f5';
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function treeIdentity(directory) {
  const rows = [];
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name); const info = await stat(file);
      if (info.isDirectory()) await walk(file);
      else rows.push({ path: relative(directory, file), bytes: info.size, sha256: hash(await readFile(file)) });
    }
  }
  await walk(directory); return rows;
}
const beforeTree = await treeIdentity(sourceStore);
const activeBytes = await readFile(join(sourceStore, 'active.json'));
const historyBytes = await readFile(join(sourceStore, 'identity-inventory.json'));
const active = JSON.parse(activeBytes); const originalHistory = JSON.parse(historyBytes);
assert.equal(active.selected.manifestDigest, expectedManifest);
const baseline = join(sourceStore, 'versions', expectedManifest);
const configurationBytes = await readFile(join(baseline, 'configurations.jsonl'));
const vinBytes = await readFile(join(baseline, 'vins.jsonl'));
assert.equal(hash(configurationBytes), expectedConfigurations);
const image = APPROVED_CORPUS_IMAGES[0];
const imagedRow = configurationBytes.toString('utf8').trimEnd().split('\n').map(JSON.parse)
  .find((row) => row.configurationId === image.configurationId);
assert.ok(imagedRow); assert.deepEqual(imagedRow.imageIds, []);
const policyService = createPolicyService();
const asOf = '2026-11-07T00:00:00.000Z';
const options = { policyService, policyRead: { runId: 'retained-image-pilot1', asOf },
  approvedImages: APPROVED_CORPUS_IMAGES, jsonlLimitsForManifest: releaseLimits };
const store = join(scratch, 'store'); const candidate = join(scratch, 'image-only-candidate');
let prepared; let published; let loaded; let details; let candidateDigest; let history; let guardCalls;
const guard = installFleetOfflineGuard();
try {
  assert.equal(guard.control(), 'blocked');
  await cp(sourceStore, store, { recursive: true, errorOnExist: true, force: false });
  const manifest = JSON.parse(await readFile(join(baseline, 'manifest.json'), 'utf8'));
  const metadata = Object.fromEntries(['datasetId', 'schemaVersion', 'profileRegistryVersion', 'generatorVersion', 'seed', 'sourceContexts']
    .map((key) => [key, manifest[key]]));
  metadata.version = '2026-11-07.4-image-pilot1';
  prepared = await writeCorpusCandidate(candidate, { configurations: [], retainedCorpusDirectory: baseline,
    metadata, images: APPROVED_CORPUS_IMAGES }, options);
  assert.equal(prepared.status, 'ok', JSON.stringify(prepared));
  assert.deepEqual(await readFile(join(candidate, 'configurations.jsonl')), configurationBytes);
  assert.deepEqual(await readFile(join(candidate, 'vins.jsonl')), vinBytes);
  const checked = await validateCorpusDirectory(candidate, { ...options, indexed: true });
  assert.equal(checked.status, 'ok', JSON.stringify(checked)); candidateDigest = checked.manifestDigest;
  assert.equal(checked.corpus.manifest.counts.configurations, 350);
  assert.equal(checked.corpus.manifest.counts.qualifyingCompleteDistinctSourceConfigurations, 349);
  assert.equal(checked.corpus.manifest.counts.sourceConfigurations, 349);
  assert.equal(checked.corpus.manifest.counts.images, 1);
  assert.equal(checked.corpus.manifest.completeness.imagesMissing, 349);
  const registry = createSyntheticRegistry({ root: store, ...options });
  assert.equal((await registry.load()).status, 'ok');
  published = await registry.publish(candidate); assert.equal(published.status, 'ok', JSON.stringify(published));
  history = JSON.parse(await readFile(join(store, 'identity-inventory.json'), 'utf8'));
  assert.deepEqual(history.configurations, originalHistory.configurations);
  assert.deepEqual(history.identities, originalHistory.identities);
  assert.equal(history.datasets.length, originalHistory.datasets.length + 1);
  for (const dataset of originalHistory.datasets) assert.deepEqual(history.datasets.find((row) =>
    row.datasetId === dataset.datasetId && row.version === dataset.version), dataset);
  const cold = createSyntheticRegistry({ root: store, ...options }); loaded = await cold.load();
  assert.equal(loaded.status, 'ok'); assert.equal(loaded.active.manifestDigest, candidateDigest);
  const read = cold.getConfiguration(image.configurationId);
  assert.deepEqual(read.record, imagedRow); assert.deepEqual(read.images, [image]);
  const local = createLocalVehicleEvidenceLookup({ root: store, policyService, asOf });
  details = await createConfiguredVehicleDetails({ lookup: local }).resolve({ kind: 'configuration', id: image.configurationId });
  assert.equal(details.status, 'complete', JSON.stringify(details));
  assert.equal(details.vehicle.images.state, 'representative');
  assert.equal(details.vehicle.images.items.length, 1);
  assert.equal(details.vehicle.images.items[0].asset, image.asset);
  assert.equal(details.vehicle.images.items[0].label, 'Representative configuration image');
  assert.equal(details.vehicle.source.productionDate, null);
  guardCalls = guard.calls.length; assert.equal(guardCalls, 0);
} finally { guard.restore(); }
// All 350 configuration routes plus the one retained VIN are audited over loopback.
// This includes the exact imaged configuration, with no sampling gap.
const audit = await verifyActiveFleet({ root: store, ...options, requiredDistinct: 349, offline: true,
  http: true, endpoint: 'http://127.0.0.1:0', concurrency: 1, sampleSize: 351 });
assert.equal(audit.status, 'verified-active', JSON.stringify(audit));
assert.equal(audit.audit.checked, 351); assert.equal(audit.audit.errors, 0);
assert.equal(audit.http.scope, 'all-records'); assert.equal(audit.http.requests, 351);
assert.equal(audit.http.errors, 0); assert.equal(audit.http.serverClosed, true);
assert.equal(audit.egress.externalCalls, 0); assert.equal(audit.egress.sourceCalls, 0);
assert.deepEqual(await treeIdentity(sourceStore), beforeTree);
await writeFile(receipt, JSON.stringify({ status: 'retained-image-pilot1-proved',
  baselineManifestDigest: expectedManifest, candidateManifestDigest: candidateDigest,
  baselineVersion: '2026-11-07.4', candidateVersion: '2026-11-07.4-image-pilot1',
  counts: prepared.manifest.counts, completeness: prepared.manifest.completeness,
  retainedBytes: { configurations: { bytes: configurationBytes.length, sha256: hash(configurationBytes), identical: true },
    vins: { bytes: vinBytes.length, sha256: hash(vinBytes), identical: true } },
  history: { configurationsUnchanged: true, identitiesUnchanged: true, priorDatasetsUnchanged: true,
    addedDatasetVersions: 1, baselineInventorySha256: hash(historyBytes) },
  sourceStore: { treeUnchanged: true, files: beforeTree.length, bytes: beforeTree.reduce((sum, file) => sum + file.bytes, 0),
    activePointerSha256: hash(activeBytes) },
  image: { ...image, sha256: 'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe',
    bytes: 82798, contentType: 'image/webp', viewpoint: 'HEROFRONT', width: 2560, height: 1646,
    configurationIdSha256: hash(image.configurationId), physicalProductionDate: details.vehicle.source.productionDate,
    modelAndPaint: 'observed F42 white i5', wheelsInteriorEquipmentAndExactAppearance: 'unknown' },
  restart: { registry: loaded.status, defaultLocalComposition: details.status, imageState: details.vehicle.images.state },
  egress: { preparationExternalCalls: guardCalls, auditExternalCalls: audit.egress.externalCalls,
    auditSourceCalls: audit.egress.sourceCalls, control: audit.egress.control }, audit,
  scope: 'One exact retained real image on the unchanged actual 349-source/350-configuration corpus; isolated store only; no source collection, active publication, 10k or whole-story acceptance claim.'
}, null, 2) + '\n');
console.log(JSON.stringify({ status: 'retained-image-pilot1-proved', candidateManifestDigest: candidateDigest,
  configurations: 350, sourceConfigurations: 349, images: 1, auditChecks: 351, httpChecks: 351, externalCalls: 0 }));
