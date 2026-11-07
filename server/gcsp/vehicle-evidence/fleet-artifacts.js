import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetReleases, approvedAssetUrl, DEFAULT_ARTIFACT_ROOT, releaseLimits, EMPTY_SHA256 } from './fleet-release.js';
import { durableCopy } from './corpus-publisher.js';
import { createSyntheticRegistry } from './synthetic-registry.js';
import { createPolicyService } from '../policy/index.js';
const sha = async (p) => { const h = createHash('sha256'); for await (const b of createReadStream(p)) h.update(b); return h.digest('hex'); };
const absent = async (p) => { try { await lstat(p); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } };
async function checkedAsset(root, asset) {
  const p = join(root, asset.path); let current = root;
  for (const part of asset.path.split('/')) { current = join(current, part); const st = await lstat(current); if (st.isSymbolicLink()) throw new TypeError('Artifact symlinks forbidden'); }
  const st = await lstat(p); if (!st.isFile() || st.size !== asset.bytes || await sha(p) !== asset.sha256) throw new TypeError('Artifact bytes/hash mismatch');
}
export async function downloadAsset(asset, destination, { fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  let url = approvedAssetUrl(asset.url, true); let file; let owned = false;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > 268435456 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new TypeError('Invalid byte/hash bound');
    if (asset.bytes === 0 && asset.sha256 !== EMPTY_SHA256) throw new TypeError('Invalid empty artifact checksum');
    file = await open(destination, 'wx', 0o600); owned = true;
    // The code-owned release pins these exact empty bytes. GitHub rejects empty
    // uploads; materialize the pinned file locally without a transport request.
    if (asset.bytes === 0) { await file.sync(); await file.close(); file = null; return; }
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, headers: { 'Accept-Encoding': 'identity' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const target = response.headers.get('location'); await response.body?.cancel();
      if (redirects === 3 || !target) throw new TypeError('Artifact redirect bound');
      url = approvedAssetUrl(new URL(target, url).href);
    }
    if (response.status !== 200 || !response.body || ![null, 'identity'].includes(response.headers.get('content-encoding'))
      || response.headers.has('content-length') && Number(response.headers.get('content-length')) !== asset.bytes) throw new TypeError('Artifact response rejected');
    const h = createHash('sha256'); let count = 0;
    for await (const chunk of response.body) { count += chunk.length; if (count > asset.bytes) throw new TypeError('Artifact byte bound'); h.update(chunk); await file.writeFile(chunk); }
    if (count !== asset.bytes || h.digest('hex') !== asset.sha256) throw new TypeError('Artifact bytes/hash mismatch');
    await file.sync(); await file.close(); file = null;
  } catch (e) { await file?.close(); if (owned) await rm(destination, { force: true }); throw e; }
  finally { clearTimeout(timer); }
}
function selected(id) { const r = fleetReleases.find((r) => r.releaseId === id); if (!r) throw new TypeError('Release is not code-approved'); return r; }
function paths(...values) { if (values.some((v) => typeof v !== 'string' || !isAbsolute(v))) throw new TypeError('Explicit absolute artifact paths required'); }
async function complete(root, release) { for (const asset of release.assets) await checkedAsset(root, asset); }
/** Copy exact raw assets to a new release directory. This does not upload or grant trust. */
export async function packFleetRelease({ releaseId, output, store, sourceRoot = fileURLToPath(new URL('../../data/gcsp/vehicle-evidence/registered-sources', import.meta.url)) }) {
  paths(output, store, sourceRoot); const release = selected(releaseId); const target = join(output, release.releaseId);
  await mkdir(target, { recursive: false, mode: 0o700 });
  try {
    for (const a of release.assets) {
      const input = a.role === 'source' ? join(sourceRoot, a.origin) : join(store, a.path.slice('store/'.length));
      const out = join(target, a.path); await mkdir(dirname(out), { recursive: true }); await durableCopy(input, out, a.bytes || 1); await checkedAsset(target, a);
    }
    await complete(target, release); return { status: 'packed', releaseId, files: release.assets.length, bytes: release.assets.reduce((n, a) => n + a.bytes, 0), directory: target };
  } catch (e) { await rm(target, { recursive: true, force: true }); throw e; }
}
/** Restore a code-approved release. Runtime lookup itself has no transport capability. */
export async function restoreFleetRelease({ releaseId, store, cacheRoot = DEFAULT_ARTIFACT_ROOT, offline = true, fetchImpl = fetch, asOf = new Date().toISOString() }) {
  paths(store, cacheRoot); const release = selected(releaseId); const cached = join(cacheRoot, releaseId); let ownedStage; let externalCalls = 0;
  try {
    if (await absent(cached)) {
      if (offline) throw new TypeError('Pinned artifact cache is absent in offline mode');
      await mkdir(cacheRoot, { recursive: true }); ownedStage = join(cacheRoot, '.restore-' + randomUUID()); await mkdir(ownedStage);
      for (const asset of release.assets) { const target = join(ownedStage, asset.path); await mkdir(dirname(target), { recursive: true });
        await downloadAsset(asset, target, { fetchImpl: (...args) => { externalCalls++; return fetchImpl(...args); } }); }
      await complete(ownedStage, release); await rename(ownedStage, cached); ownedStage = null;
    }
    await complete(cached, release);
    const options = { policyService: createPolicyService(), policyRead: { runId: 'fleet-artifact-restore', asOf },
      jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: cached };
    const candidateStore = join(cached, 'store'); const input = createSyntheticRegistry({ root: candidateStore, ...options }); const validated = await input.load();
    if (validated.status !== 'ok' || validated.active.manifestDigest !== release.manifestDigest) throw new TypeError('Cached store failed full validation');
    if (await absent(store)) {
      await mkdir(dirname(store), { recursive: true }); ownedStage = join(dirname(store), '.restore-store-' + randomUUID()); await mkdir(ownedStage);
      for (const asset of release.assets.filter((a) => a.role === 'corpus')) { const target = join(ownedStage, asset.path.slice('store/'.length)); await mkdir(dirname(target), { recursive: true }); await durableCopy(join(cached, asset.path), target, asset.bytes || 1); }
      const check = await createSyntheticRegistry({ root: ownedStage, ...options }).load();
      if (check.status !== 'ok' || check.active.manifestDigest !== release.manifestDigest) throw new TypeError('Staged store failed validation');
      await rename(ownedStage, store); ownedStage = null;
      return { status: 'ok', mode: 'cold-restore', active: check.active, externalCalls };
    }
    const registry = createSyntheticRegistry({ root: store, ...options });
    const result = await registry.publish(join(candidateStore, 'versions', release.manifestDigest));
    if (result.status !== 'ok') throw new TypeError('Existing store rejected release; previous selection retained');
    return { ...result, mode: 'publish-existing', externalCalls };
  } finally { if (ownedStage) await rm(ownedStage, { recursive: true, force: true }); }
}
