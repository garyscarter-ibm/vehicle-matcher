import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fleetReleases, approvedAssetUrl, DEFAULT_ARTIFACT_ROOT, releaseLimits, EMPTY_SHA256 } from './fleet-release.js';
import { boundDiagnostic, durableCopy } from './corpus-publisher.js';
import { createSyntheticRegistry } from './synthetic-registry.js';
import { createPolicyService } from '../policy/index.js';
import { APPROVED_CORPUS_IMAGES } from './registered-corpus-images.js';
const sha = async (p) => { const h = createHash('sha256'); for await (const b of createReadStream(p)) h.update(b); return h.digest('hex'); };
const absent = async (p) => { try { await lstat(p); return false; } catch (e) { if (e.code === 'ENOENT') return true; throw e; } };
const SAFE_CODE = /^[A-Z][A-Z0-9_]*$/;
const tag = (e, artifactCode, retryable, extra = {}) => Object.assign(e !== null && typeof e === 'object' ? e : new Error('Artifact transfer failed'), { artifactCode, retryable }, extra);
const rejected = (message, artifactCode) => tag(new TypeError(message), artifactCode, false);
const coded = (message, artifactCode, extra = {}) => Object.assign(new TypeError(message), { artifactCode }, extra);
/** Build the restore validation error with its bounded first-failure diagnostic. Grants no release approval. */
export const validationFailed = (message, stage, result, release) => coded(message, 'validation-failed', { validation: boundDiagnostic({
  stage, status: result.status, failure: result.failure, diagnostic: result.diagnostic, previousDiagnostic: result.previousDiagnostic,
  manifestDigestMatches: result.active?.manifestDigest === release.manifestDigest }) });
// A URL-free hint for the build log: a system error code, else a timeout marker.
function transportDetail(e, signal) {
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === 'string' && SAFE_CODE.test(code)) return { detail: code };
  return signal.aborted || e?.name === 'AbortError' ? { detail: 'timeout' } : {};
}
function approved(value, initial) { try { return approvedAssetUrl(value, initial); } catch (e) { throw tag(e, 'unapproved-host', false); } }
async function checkedAsset(root, asset) {
  const p = join(root, asset.path); let current = root;
  for (const part of asset.path.split('/')) { current = join(current, part); const st = await lstat(current); if (st.isSymbolicLink()) throw coded('Artifact symlinks forbidden', 'symlink-forbidden'); }
  const st = await lstat(p); if (!st.isFile() || st.size !== asset.bytes || await sha(p) !== asset.sha256) throw coded('Artifact bytes/hash mismatch', 'digest-mismatch');
}
// The approved corpus assets can reach 256 MiB. Keep the entire transfer bounded,
// while allowing the 191 MB fleet file to finish beyond the former 30s cutoff.
export async function downloadAsset(asset, destination, { fetchImpl = fetch, timeoutMs = 120000 } = {}) {
  let url = approved(asset.url, true); let file; let owned = false;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > 268435456 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw rejected('Invalid byte/hash bound', 'invalid-descriptor');
    if (asset.bytes === 0 && asset.sha256 !== EMPTY_SHA256) throw rejected('Invalid empty artifact checksum', 'invalid-descriptor');
    file = await open(destination, 'wx', 0o600); owned = true;
    // The code-owned release pins these exact empty bytes. GitHub rejects empty
    // uploads; materialize the pinned file locally without a transport request.
    if (asset.bytes === 0) { await file.sync(); await file.close(); file = null; return; }
    let response;
    for (let redirects = 0; redirects <= 3; redirects++) {
      try { response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, headers: { 'Accept-Encoding': 'identity' } }); }
      catch (e) { throw tag(e, 'download-failed', true, transportDetail(e, controller.signal)); }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const target = response.headers.get('location'); await response.body?.cancel();
      if (redirects === 3 || !target) throw rejected('Artifact redirect bound', 'redirect-rejected');
      url = approved(new URL(target, url).href);
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw tag(new TypeError('Artifact response rejected'), 'download-failed', response.status >= 500 || response.status === 429, { httpStatus: response.status });
    }
    if (!response.body || ![null, 'identity'].includes(response.headers.get('content-encoding'))
      || response.headers.has('content-length') && Number(response.headers.get('content-length')) !== asset.bytes) throw rejected('Artifact response rejected', 'response-rejected');
    const h = createHash('sha256'); let count = 0;
    try {
      for await (const chunk of response.body) { count += chunk.length; if (count > asset.bytes) throw rejected('Artifact byte bound', 'digest-mismatch'); h.update(chunk); await file.writeFile(chunk); }
    } catch (e) { throw e?.artifactCode || e?.syscall === 'write' ? e : tag(e, 'download-failed', true, transportDetail(e, controller.signal)); }
    if (count !== asset.bytes || h.digest('hex') !== asset.sha256) throw rejected('Artifact bytes/hash mismatch', 'digest-mismatch');
    await file.sync(); await file.close(); file = null;
  } catch (e) { await file?.close(); if (owned) await rm(destination, { force: true }); throw e; }
  finally { clearTimeout(timer); }
}
const assetName = (asset) => asset.path ? basename(asset.path) : String(asset.url).split('?')[0].split('/').pop();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Retry transient transfer failures only; every attempt re-verifies the pinned digest. */
export async function downloadAssetWithRetry(asset, destination, { fetchImpl = fetch, timeoutMs, retryDelaysMs = [1000, 2000, 4000], sleep = pause } = {}) {
  const options = { fetchImpl, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
  for (let attempt = 1; ; attempt++) {
    try { return await downloadAsset(asset, destination, options); }
    catch (e) {
      if (e?.retryable === true && attempt <= retryDelaysMs.length) { await sleep(retryDelaysMs[attempt - 1]); continue; }
      if (e !== null && typeof e === 'object') Object.assign(e, { attempts: attempt, asset: assetName(asset) });
      throw e;
    }
  }
}
function selected(id) { const r = fleetReleases.find((r) => r.releaseId === id); if (!r) throw coded('Release is not code-approved', 'release-not-approved'); return r; }
function paths(...values) { if (values.some((v) => typeof v !== 'string' || !isAbsolute(v))) throw coded('Explicit absolute artifact paths required', 'invalid-paths'); }
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
export async function restoreFleetRelease({ releaseId, store, cacheRoot = DEFAULT_ARTIFACT_ROOT, offline = true, fetchImpl = fetch, asOf = new Date().toISOString(), retryDelaysMs, sleep }) {
  let step = 'select-release'; let ownedStage; let externalCalls = 0;
  try {
    paths(store, cacheRoot); const release = selected(releaseId); const cached = join(cacheRoot, releaseId); step = 'verify-cache';
    if (await absent(cached)) {
      if (offline) throw coded('Pinned artifact cache is absent in offline mode', 'offline-cache-absent');
      step = 'download'; await mkdir(cacheRoot, { recursive: true }); ownedStage = join(cacheRoot, '.restore-' + randomUUID()); await mkdir(ownedStage);
      for (const asset of release.assets) { const target = join(ownedStage, asset.path); await mkdir(dirname(target), { recursive: true });
        await downloadAssetWithRetry(asset, target, { retryDelaysMs, sleep, fetchImpl: (...args) => { externalCalls++; return fetchImpl(...args); } }); }
      step = 'verify-cache'; await complete(ownedStage, release); await rename(ownedStage, cached); ownedStage = null;
    }
    await complete(cached, release); step = 'validate-cache';
    const options = { policyService: createPolicyService(), policyRead: { runId: 'fleet-artifact-restore', asOf },
      jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: cached, approvedImages: APPROVED_CORPUS_IMAGES };
    const candidateStore = join(cached, 'store'); const input = createSyntheticRegistry({ root: candidateStore, ...options }); const validated = await input.load();
    if (validated.status !== 'ok' || validated.active.manifestDigest !== release.manifestDigest) throw validationFailed('Cached store failed full validation', 'cached', validated, release);
    if (await absent(store)) {
      step = 'stage-store'; await mkdir(dirname(store), { recursive: true }); ownedStage = join(dirname(store), '.restore-store-' + randomUUID()); await mkdir(ownedStage);
      for (const asset of release.assets.filter((a) => a.role === 'corpus')) { const target = join(ownedStage, asset.path.slice('store/'.length)); await mkdir(dirname(target), { recursive: true }); await durableCopy(join(cached, asset.path), target, asset.bytes || 1); }
      const check = await createSyntheticRegistry({ root: ownedStage, ...options }).load();
      if (check.status !== 'ok' || check.active.manifestDigest !== release.manifestDigest) throw validationFailed('Staged store failed validation', 'staged', check, release);
      await rename(ownedStage, store); ownedStage = null;
      return { status: 'ok', mode: 'cold-restore', active: check.active, externalCalls };
    }
    step = 'publish-existing'; const registry = createSyntheticRegistry({ root: store, ...options });
    const result = await registry.publish(join(candidateStore, 'versions', release.manifestDigest));
    if (result.status !== 'ok') throw coded('Existing store rejected release; previous selection retained', 'store-rejected');
    return { ...result, mode: 'publish-existing', externalCalls };
  } catch (e) { if (e !== null && typeof e === 'object' && !e.step) e.step = step; throw e; }
  finally { if (ownedStage) await rm(ownedStage, { recursive: true, force: true }); }
}
