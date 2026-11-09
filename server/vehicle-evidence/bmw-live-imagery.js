import { createHash } from 'node:crypto';
import { inputDigest } from '../gcsp/repository/core.js';
import { validateBmwEnrichmentObservationRegistration } from '../../scripts/gcsp/bmw-public-registration.mjs';
import { bmwImageLookupIdentity, createBmwImageAdapter, presentBmwImage } from './bmw-image-adapter.js';

const PROVIDER = 'bmw-cosy-named-images';
const VERSION = 'bmw-uk-cosy-named-images.v1';
const ORIGIN = 'https://prod.cosy.bmw.cloud';
const COLLECTION = 'stage-fullscreen-views-legacy-newnames';
const PROFILE = 'bmw-uk-public-configurator';
const ROLE = 'representative-catalogue-render';
const MANIFEST_BYTES = 1048576;
const IMAGE_BYTES = 2097152;
const HANDOFF_MS = 15000;
const SNAPSHOTS = ['bmw-i5-white-20261101-v1', 'bmw-i5-black-20261101-v1'];
// COSY exterior crops use W/H; the observed DASH and INTERIORSIDE siblings use WIDTH/HEIGHT.
const DISTINCTIONS = ['BKGND', 'X', 'Y', 'W', 'H', 'WIDTH', 'HEIGHT'];
const UNKNOWN = { model: 'unknown', paint: 'unknown', wheels: 'unknown', interior: 'unknown', equipment: 'unknown', exactVehicle: 'unknown' };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const token = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const MESSAGES = {
  'invalid-request': 'Supply the complete resolved configuration, named view, viewport and dimensions.',
  'source-not-selected': 'The live image source has not been explicitly selected for this demo.',
  'credentials-unavailable': 'Live image credentials are unavailable.',
  'unsupported-request': 'The requested named image, view, viewport or dimensions are unsupported.',
  'manifest-unavailable': 'The live image manifest is unavailable or malformed.',
  'identity-unverified': 'The source does not independently establish the resolved configuration and dates.',
  'identity-mismatch': 'The source describes a different configuration or date. No image was substituted.',
  'asset-unavailable': 'The returned image is unavailable or failed its type and dimensions checks.',
  'asset-expired': 'This image delivery has expired. Resolve the image again or explicitly choose a dated snapshot.',
  'access-denied': 'The live image source refused access. Check the selected backend credentials before trying again.',
  'rate-limited': 'The live image source is busy. Try again later or explicitly choose a dated snapshot.',
  'source-busy': 'A live image request is already in progress. Try again after it finishes.',
  timeout: 'The live image source did not respond in time.',
};
const failure = (code) => ({ code, message: MESSAGES[code], retryable: ['manifest-unavailable', 'asset-unavailable', 'asset-expired', 'rate-limited', 'timeout'].includes(code) });
const freshness = () => ({ status: 'unknown', policy: 'revalidate-every-resolution', upstreamExpiresAt: null,
  retrievedAt: null, handoffExpiresAt: null, delivery: 'single-read' });
const instant = (value) => value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : null;
const sourceFailure = Symbol('safe-source-failure');

function responseFailure(response, now) {
  const code = [401, 403].includes(response?.status) ? 'access-denied' : response?.status === 429 ? 'rate-limited' : null;
  const hint = response?.retryAfter ?? response?.headers?.['retry-after'];
  let retryAfterSeconds = null;
  if (code === 'rate-limited' && typeof hint === 'string') {
    if (/^\d{1,4}$/.test(hint)) retryAfterSeconds = Number(hint);
    else if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(hint) && now !== null) {
      const until = Date.parse(hint);
      if (Number.isFinite(until) && new Date(until).toUTCString() === hint) retryAfterSeconds = Math.max(0, Math.ceil((until - now) / 1000));
    }
    if (retryAfterSeconds > 3600) retryAfterSeconds = null;
  }
  return { [sourceFailure]: true, code, retryAfterSeconds };
}

/** Canonical snapshot inputs plus an explicit named-image selection; no catalogue fetch is needed. */
export function bmwLiveImageLookupIdentity(request, registration) {
  if (registration !== undefined) {
    let r; try { r = validateBmwEnrichmentObservationRegistration(registration); } catch { return null; }
    const pointer = '/stage-fullscreen-views-legacy-newnames/desktop/namedImages/0/images/0';
    if (!object(request) || Object.keys(request).some((k) => !['configurationId', 'bindingDigest', 'viewport', 'viewpoint', 'size', 'variantPointer', 'role'].includes(k))
      || request.configurationId !== r.configurationId || request.bindingDigest !== r.bindingDigest || request.viewport !== 'desktop'
      || request.viewpoint !== 'HEROFRONT' || request.variantPointer !== pointer || request.size?.width !== 2560 || request.size?.height !== 1646) return null;
    return { provider: PROVIDER, providerVersion: '2', schemaVersion: '2', snapshotVersion: 'bmw-uk-cosy-named-images.v2',
      sourceContractVersion: 'bmw-public-solver-selection.v1', configurationId: r.configurationId, bindingDigest: r.bindingDigest,
      requestRegistration: r, viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 }, viewport: 'desktop', variantPointer: pointer };
  }
  if (!object(request) || !['desktop', 'tablet', 'mobile', 'thumbnails'].includes(request.viewport)
    || !token(request.namedImage) || !object(request.distinctions)
    || Object.keys(request.distinctions).some((key) => !DISTINCTIONS.includes(key))
    || Object.values(request.distinctions).some((value) => typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value))) return null;
  const lookup = bmwImageLookupIdentity(request, { provider: PROVIDER, providerVersion: '1', schemaVersion: '1', snapshotVersion: VERSION });
  if (!lookup || !lookup.selectedOptions.includes(lookup.trim)
    || lookup.selectedOptions.filter((code) => /^P0[A-Z0-9]{3}$/.test(code)).length !== 1) return null;
  return { ...lookup, viewport: request.viewport, namedImage: request.namedImage,
    distinctions: Object.fromEntries(Object.entries(request.distinctions).sort(([a], [b]) => a.localeCompare(b))) };
}

function identity(lookup) {
  if (!lookup) return null;
  const { provider, providerVersion, schemaVersion, snapshotVersion, viewpoint, size, viewport, namedImage, distinctions, variantPointer, ...configuration } = lookup;
  return configuration;
}

function envelope(status, lookup, code) {
  return { provider: PROVIDER, providerVersion: lookup?.providerVersion || '1', schemaVersion: lookup?.schemaVersion || '1', snapshotVersion: lookup?.snapshotVersion || VERSION,
    sourceKind: 'authorised-live', sourceSupport: 'unsupported-public-website-demo', sourceProfile: PROFILE,
    status, failure: failure(code), lookupIdentity: lookup, resolvedLookupIdentity: null,
    requestedIdentity: identity(lookup), resolvedIdentity: null, manifestResolvedIdentity: null,
    observedDate: null, retrievedDate: null, identityProvenance: null, image: null, fallback: null,
    freshness: freshness() };
}

function assetReference(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === ORIGIN && url.pathname === '/connext-bmw/cosySec'
      && !url.username && !url.password && !url.hash && !url.port;
  } catch { return false; }
}

function selectNamed(manifest, lookup) {
  if (lookup.providerVersion === '2') {
    const viewport = manifest?.[COLLECTION]?.desktop; const group = viewport?.namedImages?.[0]; const image = group?.images?.[0];
    const tuple = image?.distinctionParameters;
    if (viewport?.metaData?.width !== 2560 || viewport?.metaData?.height !== 1646 || !token(group?.name)
      || !object(tuple) || !assetReference(image?.viewImage) || tuple.POV !== 'HEROFRONT'
      || inputDigest(Object.keys(tuple).sort()) !== inputDigest(['BKGND', 'POV', 'X', 'Y'])
      || !Object.values(tuple).every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v))
      || !Array.isArray(viewport.namedImages) || viewport.namedImages.length > 32
      || !viewport.namedImages.every((g) => token(g?.name) && Array.isArray(g.images) && g.images.length <= 256)) return { code: 'manifest-unavailable' };
    const candidates = viewport.namedImages.flatMap((g) => g.images.filter((entry) => g.name === group.name
      && object(entry?.distinctionParameters) && inputDigest(entry.distinctionParameters) === inputDigest(tuple)));
    if (candidates.length !== 1) return { code: 'manifest-unavailable' };
    return { image, selectedVariant: { pointer: lookup.variantPointer, namedImage: group.name,
      distinctions: Object.fromEntries(Object.entries(tuple).filter(([k]) => k !== 'POV').sort(([a], [b]) => a.localeCompare(b))) } };
  }
  const collection = manifest?.[COLLECTION];
  if (!object(collection)) return { code: 'manifest-unavailable' };
  if (!Object.hasOwn(collection, lookup.viewport)) return { code: 'unsupported-request' };
  const viewport = collection[lookup.viewport];
  if (!object(viewport) || !object(viewport.metaData)
    || !['width', 'height'].every((key) => Number.isSafeInteger(viewport.metaData[key]) && viewport.metaData[key] > 0 && viewport.metaData[key] <= 8192)
    || !Array.isArray(viewport.namedImages) || !viewport.namedImages.length || viewport.namedImages.length > 32) return { code: 'manifest-unavailable' };
  if (viewport.metaData.width !== lookup.size.width || viewport.metaData.height !== lookup.size.height) return { code: 'unsupported-request' };
  const candidates = [];
  for (const group of viewport.namedImages) {
    if (!object(group) || !token(group.name) || !Array.isArray(group.images) || !group.images.length || group.images.length > 256) return { code: 'manifest-unavailable' };
    for (const image of group.images) {
      const parameters = image?.distinctionParameters;
      if (!object(parameters) || !token(parameters.POV) || !assetReference(image?.viewImage)
        || Object.entries(parameters).some(([key, value]) => (key !== 'POV' && !DISTINCTIONS.includes(key))
          || typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(value))) return { code: 'manifest-unavailable' };
      if (group.name === lookup.namedImage && parameters.POV === lookup.viewpoint
        && Object.keys(parameters).length === Object.keys(lookup.distinctions).length + 1
        && Object.entries(lookup.distinctions).every(([key, value]) => parameters[key] === value)) candidates.push(image);
    }
  }
  return candidates.length === 1 ? { image: candidates[0] } : { code: candidates.length ? 'manifest-unavailable' : 'unsupported-request' };
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let extended = null; let dimensions = null; let position = 12;
  while (position + 8 <= bytes.length) {
    const format = bytes.subarray(position, position + 4).toString(); const length = bytes.readUInt32LE(position + 4);
    const start = position + 8; const end = start + length;
    if (end > bytes.length || ['ANIM', 'ANMF'].includes(format)) return null;
    if (format === 'VP8X') {
      if (extended || position !== 12 || length !== 10 || bytes[start] & 0x02) return null;
      extended = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    } else if (format === 'VP8 ') {
      if (dimensions || length < 10 || bytes[start] & 1 || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) return null;
      dimensions = { width: bytes.readUInt16LE(start + 6) & 0x3fff, height: bytes.readUInt16LE(start + 8) & 0x3fff };
    } else if (format === 'VP8L') {
      if (dimensions || length < 5 || bytes[start] !== 0x2f) return null;
      const bits = bytes.readUInt32LE(start + 1); if (bits >>> 29) return null;
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    position = end + (length & 1);
  }
  return position === bytes.length && dimensions?.width > 0 && dimensions.height > 0
    && (!extended || extended.width === dimensions.width && extended.height === dimensions.height) ? dimensions : null;
}

/** Trusted backend dependencies own transport, credentials and independent identity proof, never the caller. */
export function createBmwLiveImageryProvider({ environment, sourceProfile, transport, getCredential,
  resolveConfiguration, sourceRegistration, onSelectedVariant = async () => {}, clock = () => new Date(), timeoutMs = 15000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000 || typeof clock !== 'function') throw new TypeError('Supply bounded image settings.');
  const selected = environment === 'gcsp-demo' && sourceProfile === PROFILE;
  const assets = new Map(); const active = new Set(); let generation = 0;
  return Object.freeze({
    async resolve(request) {
      const lookup = bmwLiveImageLookupIdentity(request, sourceRegistration);
      if (!lookup) return envelope('invalid-input', null, 'invalid-request');
      if (!selected) return envelope('source-unavailable', lookup, 'source-not-selected');
      if ((lookup.requestRegistration?.model.market || lookup.market) !== 'GB' || (lookup.requestRegistration?.model.locale || lookup.locale) !== 'en-GB' || (request.role !== undefined && request.role !== ROLE)) return envelope('unsupported', lookup, 'unsupported-request');
      if (typeof transport !== 'function' || typeof getCredential !== 'function') return envelope('source-unavailable', lookup, 'credentials-unavailable');
      if (active.size) return envelope('source-unavailable', lookup, 'source-busy');
      // An older delivery cannot become the fallback for a new resolution, including a failed one.
      assets.clear(); generation += 1;
      const controller = new AbortController(); let timer;
      active.add(controller);
      const expired = Symbol('timeout');
      const run = async () => {
        let key;
        try { key = await getCredential(PROFILE); } catch { return envelope('source-unavailable', lookup, 'credentials-unavailable'); }
        if (typeof key !== 'string' || !key || key.length > 4096 || /[\r\n]/.test(key)) return envelope('source-unavailable', lookup, 'credentials-unavailable');
        const retrieval = clock(); const retrievedAt = instant(retrieval);
        const retrievedDate = retrievedAt === null ? null : retrieval.toISOString().slice(0, 10);
        if (!date(retrievedDate)) return envelope('source-unavailable', lookup, 'manifest-unavailable');
        const get = async (url, headers, cap) => {
          if (controller.signal.aborted) throw expired;
          const response = await transport({ method: 'GET', url, headers, maxResponseBytes: cap, signal: controller.signal,
            credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0 });
          if (controller.signal.aborted) throw expired;
          if (response?.status !== 200) throw responseFailure(response, instant(clock()));
          if (response.redirected === true || (response.url !== undefined && response.url !== url)) throw Error('source');
          const body = typeof response.body === 'string' ? Buffer.from(response.body) : response.body instanceof Uint8Array ? Buffer.from(response.body) : null;
          if (!body || body.length > cap || typeof response.contentType !== 'string') throw Error('source');
          return { body, type: response.contentType.split(';')[0].trim().toLowerCase() };
        };
        const query = new URLSearchParams({ effectdate: (lookup.requestRegistration?.model.effectDate || lookup.effectDate).replaceAll('-', ''), hub: 'CLOUD_PROD_INTERNET', imagetype: 'webp', options: (lookup.requestRegistration?.factoryOptionCodes || lookup.selectedOptions).join(',') });
        let manifest; let named;
        try {
          const response = await get(`${ORIGIN}/image-urls/dynamic-named-images/mandators/connext-bmw/collections/${COLLECTION}/brands/bmwCar/models/${lookup.requestRegistration?.model.agModelCode || lookup.agModelCode}?${query}`, { 'x-api-key': key, Accept: 'application/json' }, MANIFEST_BYTES);
          if (response.type !== 'application/json') throw Error('source');
          manifest = JSON.parse(response.body.toString('utf8')); named = selectNamed(manifest, lookup);
        } catch (error) {
          const result = envelope('source-unavailable', lookup, controller.signal.aborted ? 'timeout'
            : error?.[sourceFailure] && error.code || 'manifest-unavailable');
          if (result.failure.code === 'rate-limited') result.failure.retryAfterSeconds = error.retryAfterSeconds;
          return result;
        }
        if (named.code) return envelope(named.code === 'unsupported-request' ? 'unsupported' : 'source-unavailable', lookup, named.code);
        // COSY currently echoes no configuration identity. Request inputs cannot manufacture that proof.
        let proof;
        try { proof = typeof resolveConfiguration === 'function' ? await resolveConfiguration({ manifest: structuredClone(manifest), requestedIdentity: structuredClone(identity(lookup)), signal: controller.signal }) : null; }
        catch { proof = null; }
        if (controller.signal.aborted) return envelope('source-unavailable', lookup, 'timeout');
        const resolved = proof?.basis === 'independent-source-proof' && date(proof.observedDate)
          ? lookup.providerVersion === '2'
            ? proof.registrationDigest === inputDigest(lookup.requestRegistration) && proof.acceptedLineSha256 === lookup.requestRegistration.sourceAcceptedSha256
              ? bmwLiveImageLookupIdentity({ ...proof.identity, viewport: lookup.viewport, variantPointer: lookup.variantPointer, viewpoint: lookup.viewpoint, size: lookup.size }, sourceRegistration) : null
            : bmwLiveImageLookupIdentity({ ...proof.identity, viewport: lookup.viewport, namedImage: lookup.namedImage, distinctions: lookup.distinctions, viewpoint: lookup.viewpoint, size: lookup.size }) : null;
        if (!resolved) return envelope('source-unavailable', lookup, 'identity-unverified');
        const result = envelope('source-unavailable', lookup, 'asset-unavailable');
        result.resolvedLookupIdentity = resolved; result.resolvedIdentity = identity(resolved);
        result.observedDate = proof.observedDate; result.retrievedDate = retrievedDate;
        result.identityProvenance = { kind: 'independent-source-proof', observedDate: proof.observedDate, manifestIdentityEchoed: false,
          ...(lookup.providerVersion === '2' ? { registrationDigest: proof.registrationDigest, acceptedLineSha256: proof.acceptedLineSha256 } : {}) };
        if (named.selectedVariant) result.selectedVariant = named.selectedVariant;
        if (JSON.stringify(identity(resolved)) !== JSON.stringify(identity(lookup))) {
          result.status = 'identity-mismatch'; result.failure = failure('identity-mismatch'); return result;
        }
        try {
          if (named.selectedVariant) await onSelectedVariant(structuredClone(named.selectedVariant));
          const response = await get(named.image.viewImage, { Accept: 'image/webp' }, IMAGE_BYTES);
          const dimensions = webpDimensions(response.body);
          if (response.type !== 'image/webp' || !dimensions || dimensions.width !== lookup.size.width || dimensions.height !== lookup.size.height) return result;
          const sha256 = createHash('sha256').update(response.body).digest('hex');
          const deliveredAt = instant(clock());
          if (deliveredAt === null || deliveredAt < retrievedAt) return result;
          const expiresAt = deliveredAt + HANDOFF_MS;
          const assetId = `bmw-live-${createHash('sha256').update(JSON.stringify(lookup)).update(sha256)
            .update(`${generation}:${deliveredAt}`).digest('hex').slice(0, 40)}`;
          result.status = 'ok'; result.failure = null;
          result.freshness = { ...freshness(), retrievedAt: new Date(retrievedAt).toISOString(),
            handoffExpiresAt: new Date(expiresAt).toISOString() };
          result.image = { assetId, contentType: 'image/webp', bytes: response.body.length, sha256, size: dimensions,
            viewpoint: lookup.viewpoint, viewport: lookup.viewport, namedImage: named.selectedVariant?.namedImage || lookup.namedImage, role: ROLE,
            representation: 'configuration', matchesRequestedConfiguration: true,
            fidelity: { ...UNKNOWN, model: proof.fidelity?.model === 'verified' ? 'verified' : 'unknown', paint: proof.fidelity?.paint === 'verified' ? 'verified' : 'unknown' },
            origin: 'BMW COSY public UK configurator', sourceDate: proof.observedDate, retrievedDate };
          assets.set(assetId, { result: structuredClone(result), bytes: Buffer.from(response.body), deliveredAt, expiresAt });
          return result;
        } catch (error) {
          if (controller.signal.aborted) result.failure = failure('timeout');
          else if (error?.[sourceFailure] && error.code) {
            result.failure = failure(error.code);
            if (error.code === 'rate-limited') result.failure.retryAfterSeconds = error.retryAfterSeconds;
          }
          return result;
        }
      };
      try {
        return await Promise.race([run(), new Promise((resolve) => { timer = setTimeout(() => {
          controller.abort(); resolve(envelope('source-unavailable', lookup, 'timeout'));
        }, timeoutMs); })]);
      } catch { return envelope('source-unavailable', lookup, controller.signal.aborted ? 'timeout' : 'manifest-unavailable'); }
      finally { clearTimeout(timer); controller.abort(); active.delete(controller); }
    },
    async readAsset(assetId) {
      const entry = typeof assetId === 'string' && assets.get(assetId);
      if (!entry) return envelope('source-unavailable', null, 'asset-unavailable');
      assets.delete(assetId);
      let now;
      try { now = instant(clock()); } catch { now = null; }
      if (now === null || now < entry.deliveredAt || now >= entry.expiresAt) return envelope('source-unavailable', null, 'asset-expired');
      return { ...structuredClone(entry.result), bytes: Buffer.from(entry.bytes) };
    },
    dispose() { for (const controller of active) controller.abort(); assets.clear(); },
  });
}

/** A separate, deliberate C14 selection. A live failure never calls this or changes provider itself. */
export async function selectBmwImageSnapshot(request, { environment, assetId,
  adapter = createBmwImageAdapter({ environment }) } = {}) {
  const unavailable = () => envelope('unsupported', bmwLiveImageLookupIdentity(request), 'unsupported-request');
  if (!SNAPSHOTS.includes(assetId)) return unavailable();
  try {
    const result = await adapter.resolve(request);
    if (result?.image?.assetId !== assetId || presentBmwImage(result).status !== 'ok' || result.fallback) return unavailable();
    return { ...result, selection: { kind: 'explicit-snapshot', assetId },
      freshness: { status: 'dated-snapshot', policy: 'registered-c14-snapshot', upstreamExpiresAt: null } };
  } catch { return unavailable(); }
}

/** Safe text and a registered opaque server ID only; asset URLs and provider errors never enter display output. */
export function presentBmwLiveImage(result) {
  if (result?.provider === 'bmw-image-snapshot' && result.selection?.kind === 'explicit-snapshot'
    && SNAPSHOTS.includes(result.selection.assetId) && result.image?.assetId === result.selection.assetId
    && date(result.observedDate) && date(result.retrievedDate)) {
    const shown = presentBmwImage(result);
    if (shown.status === 'ok') return { ...shown, label: 'Snapshot image', sourceKind: 'dated-snapshot',
      source: 'BMW COSY catalogue render', retrievedDate: date(result.retrievedDate) ? result.retrievedDate : null,
      freshness: { status: 'dated-snapshot', policy: 'registered-c14-snapshot', upstreamExpiresAt: null },
      caption: `Dated snapshot selected; source observed ${result.observedDate}, retrieved ${result.retrievedDate}. ${shown.caption}` };
  }
  const image = result?.image;
  if (result?.provider !== PROVIDER || result.status !== 'ok' || image?.role !== ROLE
    || !/^bmw-live-[0-9a-f]{40}$/.test(image.assetId) || image.contentType !== 'image/webp'
    || image.representation !== 'configuration' || image.matchesRequestedConfiguration !== true
    || !['model', 'paint'].every((key) => ['verified', 'unknown'].includes(image.fidelity?.[key]))
    || !['wheels', 'interior', 'equipment', 'exactVehicle'].every((key) => image.fidelity?.[key] === 'unknown')
    || !date(result.observedDate) || !date(result.retrievedDate)
    || result.freshness?.status !== 'unknown' || result.freshness.policy !== 'revalidate-every-resolution'
    || result.freshness.upstreamExpiresAt !== null) {
    const code = Object.hasOwn(MESSAGES, result?.failure?.code) ? result.failure.code : 'asset-unavailable';
    return { status: 'source-unavailable', assetId: null, label: 'Image unavailable', role: ROLE,
      caption: null, fidelity: { ...UNKNOWN }, sourceKind: null, source: null,
      observedDate: null, retrievedDate: null, freshness: freshness(), message: failure(code).message };
  }
  return { status: 'ok', assetId: image.assetId, role: ROLE, label: 'Representative image',
    sourceKind: 'authorised-live', source: 'BMW COSY public UK configurator',
    observedDate: result.observedDate, retrievedDate: result.retrievedDate, freshness: freshness(),
    caption: `Representative catalogue render; source observed ${result.observedDate}, retrieved ${result.retrievedDate}. Current source freshness unknown; resolve again for another delivery. Wheels, interior, equipment and exact vehicle appearance unknown.`,
    fidelity: { ...UNKNOWN, model: image.fidelity.model, paint: image.fidelity.paint }, message: null };
}
