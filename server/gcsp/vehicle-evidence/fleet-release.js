import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const DEFAULT_ARTIFACT_ROOT = fileURLToPath(new URL('../../data/gcsp/vehicle-evidence/fleet-artifacts.v1', import.meta.url));
const SHA = /^[a-f0-9]{64}$/;
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const pathPattern = /^(?:store\/(?:active\.json|last-good\.json|identity-inventory\.json|versions\/[a-f0-9]{64}\/(?:manifest\.json|configurations\.jsonl|vins\.jsonl|images\.jsonl))|sources\/[a-f0-9]{64}\.jsonl)$/;
const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export function approvedAssetUrl(value, initial = false) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash
    || !(initial ? u.hostname === 'github.com' && /^\/garyscarter-ibm\/vehicle-matcher\/releases\/download\/[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/.test(u.pathname) && !u.search
      : ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname))) throw new TypeError('Unapproved artifact URL');
  return u.href;
}
export function validateRelease(value) {
  const r = structuredClone(value);
  if (r.schemaVersion !== 'fleet-release.v1' || !SHA.test(r.releaseId) || r.releaseId !== r.manifestDigest
    || !(r.previousManifestDigest === null || SHA.test(r.previousManifestDigest)) || !r.datasetId || !r.version
    || !Number.isSafeInteger(r.jsonlMaxBytes) || r.jsonlMaxBytes < 67108864 || r.jsonlMaxBytes > 268435456
    || !Array.isArray(r.assets) || !r.assets.length || r.assets.length > 256 || !Array.isArray(r.sources)) throw new TypeError('Invalid release descriptor');
  const paths = new Set(); const names = new Set(); let total = 0;
  for (const a of r.assets) {
    if (!pathPattern.test(a.path) || paths.has(a.path) || !/^[A-Za-z0-9._-]{1,240}$/.test(a.name) || names.has(a.name)
      || !SHA.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 0 || a.bytes > 268435456
      || a.bytes === 0 && a.sha256 !== EMPTY_SHA256
      || a.role === 'source' && !/^[A-Za-z0-9._-]{1,200}$/.test(a.origin || '')
      || !['corpus', 'source'].includes(a.role) || (a.role === 'source') !== a.path.startsWith('sources/')) throw new TypeError('Invalid release asset');
    approvedAssetUrl(a.url, true); paths.add(a.path); names.add(a.name); total += a.bytes;
  }
  if (total > 2147483648) throw new TypeError('Release exceeds aggregate byte bound');
  for (const s of r.sources) {
    const a = r.assets.find((a) => a.path === s.path);
    if (!a || a.role !== 'source' || s.bytes !== a.bytes || s.sha256 !== a.sha256 || s.bytes > 33554432
      || !Array.isArray(s.manifestDigests) || !s.manifestDigests.length || s.manifestDigests.some((d) => ![r.manifestDigest, r.previousManifestDigest].includes(d))) throw new TypeError('Invalid source shard');
  }
  if (r.assets.filter((a) => a.role === 'source').length !== r.sources.length) throw new TypeError('Unregistered source asset');
  return freeze(r);
}
const descriptorBytes = readFileSync(new URL('./fleet-releases.json', import.meta.url));
if (descriptorBytes.length > 262144) throw new TypeError('Release descriptors exceed code bound');
const releases = JSON.parse(descriptorBytes);
if (!Array.isArray(releases) || releases.length > 16) throw new TypeError('Invalid code-owned release list');
const trusted = releases.map(validateRelease);
if (new Set(trusted.map((r) => r.releaseId)).size !== trusted.length) throw new TypeError('Duplicate release anchor');
export const fleetReleases = Object.freeze(trusted);
export function releaseForManifest(digest) { return trusted.find((r) => r.manifestDigest === digest) ?? trusted.find((r) => r.previousManifestDigest === digest) ?? null; }
export function releaseLimits(digest) { return Object.freeze({ maxBytes: (releaseForManifest(digest)?.manifestDigest === digest ? releaseForManifest(digest).jsonlMaxBytes : 67108864), maxRowBytes: 1048576, maxRows: 100000 }); }
