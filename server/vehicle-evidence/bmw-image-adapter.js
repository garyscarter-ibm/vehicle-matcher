import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bmwCatalogueLookupIdentity } from './bmw-catalogue-adapter.js';

const PROVIDER = 'bmw-image-snapshot';
const VERSION = 'bmw-gb-i5-images-2026-11-01.v1';
const REGISTRY = new Map([
  ['bmw-i5-white-20261101-v1', { paint: 'P0300', label: 'Alpine White', bytes: 82798,
    identitySha256: '6130840d918e5fca69e444b230bf0cc0df645188a8892b0c8d893e35d84c107a',
    sha256: 'fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe', file: 'alpine-white.webp' }],
  ['bmw-i5-black-20261101-v1', { paint: 'P0475', label: 'Black Sapphire', bytes: 86286,
    identitySha256: '2def7ce9921003cd0e1ba6d5e2ba25e2836722185a8b52a1bc0861a8f2534753',
    sha256: '4c38cdb43b6438b7ae54fd1c882280bf744e88a17f2ce43597c5dd2c4890b5de', file: 'black-sapphire.webp' }],
]);
const FIDELITY = { model: 'verified', paint: 'verified', wheels: 'unknown', interior: 'unknown',
  equipment: 'unknown', exactVehicle: 'unknown' };
const FAILURES = {
  'demo-only': ['These registered images are available only in the configured GCSP demo environment.', false],
  'invalid-request': ['Check the complete resolved catalogue identity, dates, selection, viewpoint and size.', false],
  'unsupported-request': ['No registered render supports this model, paint, viewpoint, size or version.', false],
  'identity-mismatch': ['The registered render describes a different configuration or date. No image was substituted.', false],
  'manifest-unavailable': ['The local image manifest is unavailable or invalid.', true],
  'asset-unavailable': ['The registered local image is missing or failed its integrity check.', true],
};
const STATUS_FAILURE = { unsupported: 'unsupported-request', 'invalid-input': 'invalid-request',
  'source-unavailable': 'manifest-unavailable', 'identity-mismatch': 'identity-mismatch' };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const size = (value) => object(value) && ['width', 'height'].every((key) => Number.isSafeInteger(value[key])
  && value[key] > 0 && value[key] <= 8192);
const failure = (code) => ({ code, message: FAILURES[code][0], retryable: FAILURES[code][1] });

/** Extend FUCQ-37's resolved catalogue identity; a paint code alone is never an image identity. */
export function bmwImageLookupIdentity(request, options = {}) {
  if (!object(options) || !object(request) || typeof request.viewpoint !== 'string'
    || !/^[A-Z][A-Z0-9]{0,31}$/.test(request.viewpoint) || !size(request.size)) return null;
  const lookup = bmwCatalogueLookupIdentity(request, { provider: PROVIDER, providerVersion: '1', schemaVersion: '1',
    snapshotVersion: VERSION, ...options });
  return lookup ? { ...lookup, viewpoint: request.viewpoint, size: { width: request.size.width, height: request.size.height } } : null;
}

function sourceIdentity(lookup) {
  if (!lookup) return null;
  const { provider, providerVersion, schemaVersion, snapshotVersion, viewpoint, size: dimensions, ...identity } = lookup;
  return identity;
}

function envelope(status, lookup = null, code = STATUS_FAILURE[status]) {
  return { provider: PROVIDER, providerVersion: '1', schemaVersion: '1', snapshotVersion: lookup?.snapshotVersion || VERSION,
    sourceKind: 'dated-snapshot', status, failure: code ? failure(code) : null,
    lookupIdentity: lookup, resolvedLookupIdentity: null, requestedIdentity: sourceIdentity(lookup), resolvedIdentity: null,
    observedDate: null, retrievedDate: null, identityProvenance: null, image: null };
}

async function localManifest() {
  return JSON.parse(await readFile(new URL(`./snapshots/${VERSION}.json`, import.meta.url), 'utf8'));
}

async function localAsset(assetId) {
  return readFile(new URL(`./assets/${VERSION}/${REGISTRY.get(assetId).file}`, import.meta.url));
}

function validManifest(data) {
  if (!object(data) || data.schemaVersion !== '1' || data.snapshotVersion !== VERSION
    || !date(data.observedDate) || !date(data.retrievedDate)
    || data.observedDate !== '2026-11-01' || data.retrievedDate !== '2026-11-01'
    || data.demoUse?.scope !== 'gcsp-demo' || data.demoUse.retention !== 'remove-after-demo'
    || data.demoUse.retailPublication !== false || data.demoUse.decision?.commentId !== '132468'
    || data.demoUse.decision.issue !== 'FUCQ-40' || data.demoUse.decision.by !== 'Gary Carter'
    || data.demoUse.decision.date !== '2026-11-05'
    || !Array.isArray(data.assets) || data.assets.length !== REGISTRY.size
    || new Set(data.assets.map((entry) => entry?.assetId)).size !== REGISTRY.size) return false;
  return data.assets.every((entry) => {
    const registered = REGISTRY.get(entry?.assetId);
    const lookup = bmwImageLookupIdentity({ ...entry?.identity, viewpoint: entry?.viewpoint, size: entry?.size });
    return registered && lookup && entry.contentType === 'image/webp' && entry.bytes === registered.bytes
      && entry.sha256 === registered.sha256 && entry.paint?.code === registered.paint && entry.paint.label === registered.label
      && entry.role === 'representative-catalogue-render' && entry.viewpoint === 'HEROFRONT'
      && entry.size.width === 2560 && entry.size.height === 1646
      && lookup.market === 'GB' && lookup.locale === 'en-GB' && lookup.modelCode === 'T5MJ'
      && lookup.agModelCode === '72HH' && lookup.modelRange === 'G61E' && lookup.rawModelRange === 'G61'
      && lookup.catalogueDate === data.observedDate && lookup.orderDate === '2026-11-01'
      && ['effectDate', 'productionDate', 'taxDate'].every((key) => lookup[key] === '2027-01-05')
      && lookup.selectedOptions.includes(registered.paint) && lookup.selectedOptions.length === 47
      && lookup.selectedOptions.filter((code) => code.startsWith('P')).length === 1
      && createHash('sha256').update(JSON.stringify(sourceIdentity(lookup))).digest('hex') === registered.identitySha256
      && entry.source?.origin === 'BMW COSY catalogue render' && entry.source.sourceDate === data.observedDate
      && entry.source.observedDate === data.observedDate && entry.source.retrievedDate === data.retrievedDate
      && Object.entries(FIDELITY).every(([key, value]) => entry.fidelity?.[key] === value);
  });
}

function imageMetadata(entry) {
  return { assetId: entry.assetId, contentType: 'image/webp', bytes: entry.bytes, sha256: entry.sha256,
    size: { width: 2560, height: 1646 }, viewpoint: 'HEROFRONT', role: 'representative-catalogue-render',
    paint: { code: entry.paint.code, label: entry.paint.label }, fidelity: { ...FIDELITY },
    origin: 'BMW COSY catalogue render', sourceDate: entry.source.sourceDate, observedDate: entry.source.observedDate,
    demoUse: { scope: 'gcsp-demo', retention: 'remove-after-demo', decision: { issue: 'FUCQ-40', commentId: '132468',
      by: 'Gary Carter', date: '2026-11-05' } } };
}

function verifiedBytes(bytes, registered) {
  return Buffer.isBuffer(bytes) && bytes.length === registered.bytes
    && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    && bytes.subarray(12, 16).toString() === 'VP8 ' && (bytes.readUInt16LE(26) & 0x3fff) === 2560
    && (bytes.readUInt16LE(28) & 0x3fff) === 1646
    && createHash('sha256').update(bytes).digest('hex') === registered.sha256;
}

/** Offline local port. Trusted startup must explicitly select the demo; no transport is accepted or invoked. */
export function createBmwImageAdapter({ environment, loadManifest = localManifest, loadAsset = localAsset } = {}) {
  const enabled = environment === 'gcsp-demo';
  const refused = () => envelope('unsupported', null, 'demo-only');
  async function manifest() {
    try { const data = await loadManifest(VERSION); return validManifest(data) ? structuredClone(data) : null; }
    catch { return null; }
  }
  async function resolveEntry(entry, lookup, data, includeBytes) {
    const result = envelope('source-unavailable', lookup, 'asset-unavailable');
    const resolved = bmwImageLookupIdentity({ ...entry.identity, viewpoint: entry.viewpoint, size: entry.size });
    result.resolvedLookupIdentity = resolved; result.resolvedIdentity = sourceIdentity(resolved);
    result.observedDate = data.observedDate; result.retrievedDate = data.retrievedDate;
    result.identityProvenance = { kind: 'observed', source: 'BMW UK catalogue', observedDate: data.observedDate };
    if (JSON.stringify(lookup) !== JSON.stringify(resolved)) {
      result.status = 'identity-mismatch'; result.failure = failure('identity-mismatch'); return result;
    }
    try {
      const bytes = await loadAsset(entry.assetId);
      if (!verifiedBytes(bytes, REGISTRY.get(entry.assetId))) return result;
      result.status = 'ok'; result.failure = null; result.image = imageMetadata(entry);
      if (includeBytes) result.bytes = Buffer.from(bytes);
    } catch { /* Missing local bytes leave an explicit unavailable image. */ }
    return result;
  }
  return Object.freeze({
    async resolve(request, options = {}) {
      if (!enabled) return refused();
      const lookup = bmwImageLookupIdentity(request, options);
      if (!lookup) return envelope('invalid-input');
      if (lookup.provider !== PROVIDER || lookup.providerVersion !== '1' || lookup.schemaVersion !== '1'
        || lookup.snapshotVersion !== VERSION || lookup.market !== 'GB' || lookup.locale !== 'en-GB'
        || lookup.modelCode !== 'T5MJ' || lookup.viewpoint !== 'HEROFRONT'
        || lookup.size.width !== 2560 || lookup.size.height !== 1646) return envelope('unsupported', lookup);
      const data = await manifest();
      if (!data) return envelope('source-unavailable', lookup);
      const paints = lookup.selectedOptions.filter((code) => code.startsWith('P'));
      const entry = paints.length === 1 && data.assets.find((item) => item.paint.code === paints[0]);
      if (!entry) return envelope('unsupported', lookup);
      return resolveEntry(entry, lookup, data, false);
    },
    async readAsset(assetId) {
      if (!enabled) return refused();
      if (typeof assetId !== 'string' || !/^[a-z][a-z0-9-]{0,95}$/.test(assetId)) return envelope('invalid-input');
      if (!REGISTRY.has(assetId)) return envelope('unsupported');
      const data = await manifest();
      if (!data) return envelope('source-unavailable');
      const entry = data.assets.find((item) => item.assetId === assetId);
      return resolveEntry(entry, bmwImageLookupIdentity({ ...entry.identity, viewpoint: entry.viewpoint, size: entry.size }), data, true);
    },
  });
}

/** Safe display projection only; future consuming UI owns image delivery and its rendered acceptance. */
export function presentBmwImage(result) {
  if (result?.status !== 'ok' || !REGISTRY.has(result.image?.assetId)) {
    const status = Object.hasOwn(STATUS_FAILURE, result?.status) ? result.status : 'source-unavailable';
    const code = Object.hasOwn(FAILURES, result?.failure?.code) ? result.failure.code : STATUS_FAILURE[status];
    return { status, assetId: null, role: 'representative-catalogue-render', observedDate: null,
      caption: null, message: failure(code).message };
  }
  const observedDate = date(result.observedDate) ? result.observedDate : null;
  const observed = observedDate ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'UTC' }).format(new Date(`${observedDate}T00:00:00Z`)) : 'unknown';
  return { status: 'ok', assetId: result.image.assetId, role: 'representative-catalogue-render', observedDate,
    caption: `Representative catalogue render, observed ${observed}. Observed model and paint verified; wheels, interior and equipment fidelity unknown.`,
    message: null };
}
