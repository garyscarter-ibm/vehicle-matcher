import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetReleases, releaseLimits } from '../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { downloadAsset, packFleetRelease, restoreFleetRelease } from '../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import { validateCorpusDirectory } from '../../../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { verifyActiveFleet } from '../../../../scripts/gcsp/verify-fleet.mjs';
import { installFleetOfflineGuard } from '../../../../scripts/gcsp/fleet-offline-guard.mjs';
const run = promisify(execFile); const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, output] = process.argv.slice(2); const scratch = process.env.TMPDIR;
assert.ok(['/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/_agent-output/f58-63-overnight-20261106/f62-public-artifacts','/tmp/vehicle-matcher-f58-63-20261106/f62-public-artifacts-local'].includes(scratch));
const release = fleetReleases[0]; const tag = 'fleet-2026-11-07-4'; const repository = 'garyscarter-ibm/vehicle-matcher';
const target = '2540479cb3e1630d458083cc9656454d4b308577'; const gh = '/Users/usget/.claude-tools/bin/gh';
assert.equal(release.releaseId, '8af582cf0dc60488daa6a6bf105d0eb80bcda98d77958960f98abd5e2e15c3e9');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = async (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
const api = async (args) => JSON.parse((await run(gh, args, { cwd: root, maxBuffer: 131072, timeout: 60000 })).stdout);
const originalStore = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const storePins = Object.fromEntries(await Promise.all(['active.json', 'identity-inventory.json'].map(async (p) => [p, hash(await readFile(join(originalStore, p)))])));
const selectedRelease = async () => api(['api', `repos/${repository}/releases/tags/${tag}`, '--jq', '{id,tag_name,target_commitish,prerelease,draft,html_url,assets:[.assets[]|{id,name,size,state,digest,browser_download_url}]}']);
try {
 if (mode === 'publish' || mode === 'resume' || mode === 'continue') {
  await mkdir(join(scratch, 'package'));
  const packed = await packFleetRelease({ releaseId: release.releaseId, store: originalStore, output: join(scratch, 'package') });
  const body = { tag_name: tag, target_commitish: target, name: 'GCSP configuration corpus 2026-11-07.4', prerelease: true, draft: false,
   body: 'Checksum-pinned offline build artifact for the GCSP demonstration. Contains 349 retained complete distinct source configurations, 350 configurations in total, one previously allocated synthetic VIN and zero images. Coverage is partial; this is not full scheme-model/WMI coverage or Story acceptance. Raw assets preserve the current and previous corpus selections, durable synthetic identity inventory and exact admitted source shards. Runtime lookup remains offline. Manifest: ' + release.releaseId + '. Retrieval and restore runbook is in docs/gcsp/evidence/fucq62/static-artifact-packaging-2026-11-07.md at the target commit. No released stock, points, holds or employee usage is created.' };
  const bodyFile = join(output, 'release-request.json'); await save('release-request.json', body);
  const created = mode !== 'publish' ? await selectedRelease() : await api(['api', '--method', 'POST', `repos/${repository}/releases`, '--input', bodyFile, '--jq', '{id,tag_name,target_commitish,prerelease,draft,html_url}']);
  if (mode !== 'publish') { assert.equal(created.id, 437264368); for (const remote of created.assets) { const asset = release.assets.find((a) => a.name === remote.name); assert.ok(asset); assert.equal(remote.size, asset.bytes); assert.equal(remote.digest, 'sha256:' + asset.sha256); assert.equal(remote.browser_download_url, asset.url); } }
  assert.equal(created.prerelease, true); assert.equal(created.target_commitish, target); await save('release-created.json', created);
  const uploaded = [];
  const trustedEmptyMaterializations = [];
  for (const asset of release.assets) {
   if (mode === 'continue' && asset.bytes === 0) { assert.equal(asset.sha256, hash('')); trustedEmptyMaterializations.push({ name: asset.name, bytes: 0, sha256: asset.sha256, transport: false }); continue; }
   const existing = created.assets?.find((a) => a.name === asset.name);
   if (existing) { uploaded.push(existing); continue; }
   const args = ['api', '--method', 'POST', `https://uploads.github.com/repos/${repository}/releases/${created.id}/assets?name=${encodeURIComponent(asset.name)}`, '-H', 'Content-Type: application/octet-stream'];
   if (mode === 'resume' && asset.bytes === 0) args.push('-H', 'Content-Length: 0');
   else args.push('--input', join(packed.directory, asset.path));
   args.push('--jq', '{id,name,size,state,digest,browser_download_url}');
   const value = await api(args);
   assert.equal(value.name, asset.name); assert.equal(value.size, asset.bytes); assert.equal(value.state, 'uploaded'); assert.equal(value.browser_download_url, asset.url);
   if (value.digest) assert.equal(value.digest, 'sha256:' + asset.sha256);
   uploaded.push(value); await save('upload-checkpoint.json', { release: created, completed: uploaded });
   console.log(JSON.stringify({ uploaded: uploaded.length, total: release.assets.length, name: value.name, bytes: value.size }));
  }
  const readback = await selectedRelease(); assert.equal(readback.assets.length, release.assets.length - trustedEmptyMaterializations.length);
  for (const asset of release.assets.filter((a) => a.bytes !== 0)) { const remote = readback.assets.find((a) => a.name === asset.name); assert.ok(remote); assert.equal(remote.size, asset.bytes); assert.equal(remote.browser_download_url, asset.url); }
  await save('publication-receipt.json', { status: 'published-prerelease', target, packed: { files: packed.files, bytes: packed.bytes }, release: readback, trustedEmptyMaterializations, storePins });
 } else if (mode === 'published-check') {
  const readback = await selectedRelease(); assert.equal(readback.id, 437264368); const files = []; const requests = [];
  for (const remote of readback.assets) {
   const asset = release.assets.find((a) => a.name === remote.name); assert.ok(asset); assert.equal(remote.size, asset.bytes); assert.equal(remote.digest, 'sha256:' + asset.sha256); assert.equal(remote.browser_download_url, asset.url);
   const destination = join(scratch, asset.name);
   await downloadAsset(asset, destination, { fetchImpl: async (url, options) => { const h = new Headers(options.headers); assert.equal(h.has('authorization'), false); assert.equal(h.has('cookie'), false);
    const response = await fetch(url, options); requests.push({ host: new URL(url).hostname, status: response.status }); return response; } });
   const bytes = await readFile(destination); assert.equal(bytes.length, asset.bytes); assert.equal(hash(bytes), asset.sha256); files.push({ name: asset.name, bytes: bytes.length, sha256: hash(bytes) });
  }
  await save('public-partial-get-receipt.json', { status: 'six-published-assets-public-get-passed', runtime: process.version, releaseId: release.releaseId, files, requests,
   completePackage: false, fullRestoreAnd351Checks: 'unrun: zero-byte asset upload rejected' });
  console.log(JSON.stringify({ status: 'partial-public-get-passed', files: files.length, completePackage: false }));
 } else if (mode === 'download' || mode === 'cloud-local') {
  const requests = []; const cacheRoot = join(scratch, 'cache'); const store = join(scratch, 'store');
  if (mode === 'cloud-local') { await mkdir(cacheRoot); await packFleetRelease({ releaseId: release.releaseId, store: originalStore, output: cacheRoot }); }
  let restored;
  try { restored = await restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot, offline: mode === 'cloud-local',
   fetchImpl: async (url, options) => { const headers = new Headers(options.headers); assert.equal(headers.has('authorization'), false); assert.equal(headers.has('cookie'), false);
    const response = await fetch(url, options); requests.push({ host: new URL(url).hostname, status: response.status }); await save('public-get-checkpoint.json', { requests }); return response; } });
  } catch (error) {
   const options = { policyService: createPolicyService(), policyRead: { runId: 'public-restore-diagnostic', asOf: new Date().toISOString() }, jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: join(cacheRoot, release.releaseId) };
   const checks = [];
   for (const digest of [release.manifestDigest, release.previousManifestDigest]) { const checked = await validateCorpusDirectory(join(cacheRoot, release.releaseId, 'store/versions', digest), { ...options, indexed: true }); checks.push({ digest, status: checked.status, failure: checked.failure ?? null, manifestDigest: checked.manifestDigest ?? null }); }
   const loaded = await createSyntheticRegistry({ root: join(cacheRoot, release.releaseId, 'store'), ...options }).load();
   await save('semantic-diagnostic.json', { mode, requests, checks, loaded, originalCause: error.cause ?? null }); throw error;
  }
  assert.equal(restored.status, 'ok'); assert.equal(restored.active.manifestDigest, release.releaseId); assert.equal(restored.externalCalls, requests.length);
  const files = [];
  for (const asset of release.assets) { const bytes = await readFile(join(cacheRoot, release.releaseId, asset.path)); assert.equal(bytes.length, asset.bytes); assert.equal(hash(bytes), asset.sha256); files.push({ name: asset.name, bytes: bytes.length, sha256: hash(bytes) }); }
  assert.equal(files.filter((a) => a.bytes === 0).length, 2); assert.equal(requests.filter((r) => r.status === 200).length, mode === 'cloud-local' ? 0 : 13);
  for (const [p, pin] of Object.entries(storePins)) assert.equal(hash(await readFile(join(store, p))), pin);
  await save('download-receipt.json', { status: mode === 'cloud-local' ? 'local-cloud-package-restore-passed' : 'public-unauthenticated-restore-passed', runtime: process.version, releaseId: release.releaseId, files, requests, externalCalls: restored.externalCalls, publicDownloadedFiles: files.filter((a) => a.bytes > 0).length, trustedEmptyMaterializations: files.filter((a) => a.bytes === 0).map((a) => ({ ...a, transport: false })), storePins });
  const child = await run(process.execPath, ['--max-old-space-size=256', fileURLToPath(import.meta.url), 'offline', output], { cwd: root, env: process.env, timeout: 90000, maxBuffer: 131072 });
  assert.equal(child.stderr, ''); console.log(child.stdout.trim());
 } else if (mode === 'offline') {
  const cacheRoot = join(scratch, 'cache'); const store = join(scratch, 'store'); let calls = 0;
  let guard = installFleetOfflineGuard();
  try {
   const restored = await restoreFleetRelease({ releaseId: release.releaseId, store, cacheRoot, offline: true, fetchImpl: async () => { calls++; throw new Error('offline fetch forbidden'); } });
   assert.equal(restored.status, 'ok'); assert.equal(restored.idempotent, true); assert.equal(restored.externalCalls, 0);
   const options = { policyService: createPolicyService(), policyRead: { runId: 'public-artifact-cold-restart', asOf: '2026-11-07T00:00:00.000Z' }, jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: join(cacheRoot, release.releaseId) };
   const loaded = await createSyntheticRegistry({ root: store, ...options }).load(); assert.equal(loaded.status, 'ok'); assert.equal(loaded.active.manifestDigest, release.releaseId);
   assert.equal(calls, 0); assert.equal(guard.calls.length, 0);
   guard.restore(); guard = null;
   const audit = await verifyActiveFleet({ root: store, ...options, requiredDistinct: 200, offline: true, http: true, endpoint: 'http://127.0.0.1:0', concurrency: 1, sampleSize: 351 });
   assert.equal(audit.status, 'verified-active'); assert.equal(audit.audit.checked, 351); assert.equal(audit.audit.errors, 0); assert.equal(audit.http.requests, 351); assert.equal(audit.http.errors, 0); assert.equal(audit.egress.externalCalls, 0);
   await save('offline-restart-receipt.json', { status: 'fresh-process-offline-restart-passed', runtime: process.version, zeroProviderEgress: true, offlineCacheFetchCalls: calls, audit });
   console.log(JSON.stringify({ status: 'public-download-and-offline-restart-passed', direct: 351, http: 351, errors: 0, providerEgress: 0 }));
  } finally { guard?.restore(); }
 } else throw new TypeError('Unsupported proof phase');
 for (const [p, pin] of Object.entries(storePins)) assert.equal(hash(await readFile(join(originalStore, p))), pin);
} catch (error) {
 const failure = { phase: mode, name: error.name, message: String(error.message).replace(/https?:\/\/[^\s)]+/g, '[URL omitted]').slice(0, 2000), code: error.code ?? null,
  stderr: typeof error.stderr === 'string' ? error.stderr.replace(/https?:\/\/[^\s)]+/g, '[URL omitted]').slice(0, 4000) : null };
 await save('failure.json', failure); console.error(JSON.stringify(failure)); process.exitCode = 1;
}
