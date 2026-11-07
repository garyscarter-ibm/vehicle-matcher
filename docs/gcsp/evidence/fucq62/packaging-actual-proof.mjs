import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetReleases, releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { packFleetRelease, restoreFleetRelease } from '../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { verifyActiveFleet } from '../../../../scripts/gcsp/verify-fleet.mjs';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
assert.equal(process.argv[2], '--receipt'); const receipt = process.argv[3]; const scratch = process.env.TMPDIR;
assert.ok(scratch.startsWith('/tmp/vehicle-matcher-f58-63-20261106/f62-packaging-actual'));
const release = fleetReleases[0]; const cache = join(scratch, 'cache'); await mkdir(cache);
const store = join(scratch, 'restored'); const sourceStore = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const original = { active: await readFile(join(sourceStore, 'active.json')), inventory: await readFile(join(sourceStore, 'identity-inventory.json')) };
const guard = installFleetOfflineGuard(); let packed; let restored; let repeated; let recovery; let audit; let downloaded; let calls = 0; let downloadCalls = 0;
const policyService = createPolicyService(); const options = { policyService, policyRead: { runId: 'packaging-proof', asOf: '2026-11-07T00:00:00.000Z' },
  jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: join(cache, release.releaseId) };
try {
  packed = await packFleetRelease({ releaseId: release.releaseId, store: sourceStore, output: cache });
  restored = await restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot: cache, offline: true, fetchImpl: async () => { calls++; throw new Error('network forbidden'); } });
  assert.equal(restored.status, 'ok'); assert.equal(restored.active.counts.configurations, 350);
  assert.equal(restored.externalCalls, 0);
  assert.equal(restored.active.counts.qualifyingCompleteDistinctSourceConfigurations, 349);
  assert.deepEqual(await readFile(join(store, 'active.json')), original.active); assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), original.inventory);
  const downloadCache = join(scratch, 'download-cache'); const downloadStore = join(scratch, 'download-store');
  downloaded = await restoreFleetRelease({ releaseId: release.releaseId, store: downloadStore, cacheRoot: downloadCache, offline: false,
    fetchImpl: async (url) => { downloadCalls++; const asset = release.assets.find((a) => a.url === url); assert.ok(asset);
      return new Response(await readFile(join(cache, release.releaseId, asset.path))); } });
  assert.equal(downloaded.externalCalls, release.assets.length); assert.equal(downloadCalls, release.assets.length);
  assert.deepEqual(await readFile(join(downloadStore, 'active.json')), original.active);
  assert.deepEqual(await readFile(join(downloadStore, 'identity-inventory.json')), original.inventory);
  await rm(downloadCache, { recursive: true }); await rm(downloadStore, { recursive: true });
  repeated = await restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot: cache, offline: true });
  assert.equal(repeated.status, 'ok'); assert.equal(repeated.idempotent, true);
  const newOnly = release.sources.find((s) => s.manifestDigests.length === 1); const broken = join(cache, release.releaseId, newOnly.path); const exact = await readFile(broken);
  await writeFile(broken, '{}\n');
  await assert.rejects(restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot: cache, offline: true }));
  assert.deepEqual(await readFile(join(store, 'active.json')), original.active); assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), original.inventory);
  recovery = await createSyntheticRegistry({ root: store, ...options }).load();
  assert.equal(recovery.recovered, true); assert.equal(recovery.active.manifestDigest, release.previousManifestDigest);
  await writeFile(broken, exact);
  await assert.rejects(restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot: join(scratch, 'absent-cache'), offline: true,
    fetchImpl: async () => { calls++; throw new Error('network forbidden'); } }));
  await assert.rejects(restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot: join(scratch, 'failed-download'), offline: false,
    fetchImpl: async () => { throw new Error('selected injected transfer interruption'); } }));
  assert.deepEqual(await readdir(join(scratch, 'failed-download')), []);
  assert.deepEqual(await readFile(join(store, 'active.json')), original.active); assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), original.inventory);
  const fresh = await createSyntheticRegistry({ root: store, ...options }).load(); assert.equal(fresh.status, 'ok'); assert.equal(fresh.active.manifestDigest, release.manifestDigest);
  assert.equal(calls, 0); assert.equal(guard.calls.length, 0);
} finally { guard.restore(); }
audit = await verifyActiveFleet({ root: store, ...options, requiredDistinct: 200, offline: true, http: true,
  endpoint: 'http://127.0.0.1:0', concurrency: 1, sampleSize: 351 });
assert.equal(audit.status, 'verified-active', JSON.stringify(audit)); assert.equal(audit.audit.checked, 351); assert.equal(audit.audit.errors, 0);
assert.equal(audit.http.requests, 351); assert.equal(audit.http.errors, 0); assert.equal(audit.egress.externalCalls, 0);
assert.deepEqual(await readFile(join(sourceStore, 'active.json')), original.active); assert.deepEqual(await readFile(join(sourceStore, 'identity-inventory.json')), original.inventory);
await writeFile(receipt, JSON.stringify({ status: 'actual349-package-restore-proved', releaseId: release.releaseId, packed, restored,
  repeated: { status: repeated.status, idempotent: repeated.idempotent }, injectedDownload: { status: downloaded.status, externalCalls: downloaded.externalCalls, actualPublicNetwork: false }, previousRecovery: { recovered: recovery.recovered, manifestDigest: recovery.active.manifestDigest },
  exactActiveBytes: true, exactInventoryBytes: true, sourceStoreUnchanged: true, zeroEgress: true, offlineCacheNetworkCalls: calls,
  corruptNewShardPreservedPreviousStore: true, partialDownloadPreservedStore: true, offlineMissingCacheRefused: true,
  activePointerSha256: hash(original.active), inventorySha256: hash(original.inventory), audit,
  scope: 'Actual349-source/350configuration package, no10k/source/profile/VIN breadth claim; release asset URLs are prepared but unpublished.' }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'actual349-package-restore-proved', files: packed.files, bytes: packed.bytes, checks: 351, http: 351, egress: 0 }));
