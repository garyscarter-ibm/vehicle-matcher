import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { readDisplayImageCatalogue } from './display-images.js';

const PREFIX = '/api/gcsp/vehicle-images/';
const ID = /^bmw-display-[a-f0-9]{20}$/;
const ASSET = /^assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/;
const CONFIGURE = 'https://configure.bmw.co.uk';
const COSY = 'https://prod.cosy.bmw.cloud';
const WEEK = 7 * 86400;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refuse = () => { throw new Error('image-unavailable'); };
const contentType = (headers) => (headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

async function retainedAsset(image) {
  const file = await open(new URL(`../../../${image.asset}`, import.meta.url), 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== image.bytes || info.size > 2 * 1024 * 1024) refuse();
    // A bounded read also handles a file growing between stat and read.
    const bytes = Buffer.alloc(image.bytes + 1); let size = 0;
    while (size < bytes.length) {
      const part = await file.read(bytes, size, bytes.length - size, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    if (size !== image.bytes) refuse();
    return bytes.subarray(0, size);
  } finally { await file.close(); }
}

function imageType(bytes) {
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))) return 'image/webp';
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  return null;
}
function seconds(headers) {
  const cache = headers.get('cache-control') || '';
  if (/\b(?:no-store|no-cache)\b/i.test(cache)) return 0;
  const found = cache.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+)"?/i);
  return found ? Math.min(WEEK, Number(found[1])) : 300;
}
function registrationUrls(registration) {
  const model = registration?.model; const codes = registration?.factoryOptionCodes;
  if (!model || model.market !== 'GB' || model.locale !== 'en-GB' || model.steering !== 'RL'
    || !['catalogueRangeKey', 'modelCode', 'agModelCode'].every((key) => /^[A-Z0-9]{1,16}$/.test(model[key]))
    || !/^\d{4}-\d{2}-\d{2}$/.test(model.effectDate) || !Array.isArray(codes) || !codes.length || codes.length > 256
    || !codes.every((code) => /^[A-Z0-9]{4,12}$/.test(code))) refuse();
  return { page: `${CONFIGURE}/en_GB/configure/${model.catalogueRangeKey}/${model.modelCode}`,
    manifest: `${COSY}/image-urls/dynamic-named-images/mandators/connext-bmw/collections/stage-fullscreen-views-legacy-newnames/brands/bmwCar/models/${model.agModelCode}?${new URLSearchParams({
      effectdate: model.effectDate.replaceAll('-', ''), hub: 'CLOUD_PROD_INTERNET', imagetype: 'webp', options: codes.join(',') })}` };
}
function credential(bytes) {
  const settings = JSON.parse(bytes.toString('utf8')); const app = settings.APP || settings.app;
  const profile = (app?.backend || app?.BACKEND)?.settingsCosy; const nodes = [];
  const walk = (value, depth = 0) => { if (depth > 24) refuse(); if (value && typeof value === 'object') { nodes.push(value); Object.values(value).forEach((item) => walk(item, depth + 1)); } };
  walk(profile);
  const registered = nodes.some((node) => Object.values(node).some((value) => { try { return typeof value === 'string' && new URL(value).origin === COSY; } catch { return false; } }));
  const keys = nodes.flatMap((node) => Object.entries(node).filter(([key, value]) => /^x-api-key$/i.test(key) && typeof value === 'string').map(([, value]) => value));
  if (!registered || new Set(keys).size !== 1 || !keys[0] || keys[0].length > 4096 || /[\r\n]/.test(keys[0])) refuse();
  return keys[0];
}
function selectedAsset(manifest) {
  const viewport = manifest?.['stage-fullscreen-views-legacy-newnames']?.desktop;
  const groups = viewport?.namedImages;
  if (!Array.isArray(groups) || groups.length > 32) refuse();
  for (const group of groups) {
    if (group.name !== 'Gallery' || !Array.isArray(group.images) || group.images.length > 256) continue;
    const selected = group.images.find((image) => image?.distinctionParameters?.POV === 'FRONTLEFT' && image.distinctionParameters.BKGND === 'sand');
    if (!selected) continue;
    if (typeof selected.viewImage !== 'string' || selected.viewImage.length > 8192 || /[\s\\\u0000-\u001f\u007f]/.test(selected.viewImage)) refuse();
    const url = new URL(selected.viewImage);
    if (url.origin !== COSY || url.protocol !== 'https:' || url.pathname !== '/connext-bmw/cosySec' || url.username || url.password || url.hash || url.port) refuse();
    return url.href;
  }
  refuse();
}

/** A same-origin binary adapter. Opaque source URLs and the public configurator key remain request-local.
 * Successful live bytes are kept in a bounded memory LRU; retained byte-verified imagery covers failures.
 * Live bytes preserve the source framing; this adapter does not invent unverified COSY crop parameters. */
export function createLiveDisplayImageHandler({ fetchImpl = globalThis.fetch, now = Date.now,
  loadCatalogue = readDisplayImageCatalogue,
  loadSources = () => readFile(new URL('../../data/gcsp/vehicle-evidence/display-images.sources.json', import.meta.url)),
  loadAsset = retainedAsset,
  maxCacheBytes = 32 * 1024 * 1024, maxImageBytes = 2 * 1024 * 1024, timeoutMs = 8000,
  maxConcurrent = 2, maxQueued = 32 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || ![maxCacheBytes, maxImageBytes, timeoutMs, maxConcurrent, maxQueued].every((value) => Number.isSafeInteger(value) && value > 0)
    || maxConcurrent > 2 || maxImageBytes > 2 * 1024 * 1024 || maxCacheBytes > 32 * 1024 * 1024) throw new TypeError('Supply bounded image adapter options.');
  const cache = new Map(); const pending = new Map(); const queue = [];
  let allocation = 0; let active = 0; let mappings;
  async function mapping() {
    mappings ??= (async () => {
      const catalogue = await loadCatalogue(); const images = new Map();
      for (const image of [...catalogue.configurations.map((row) => row.image), ...Object.values(catalogue.variants), ...Object.values(catalogue.models), ...Object.values(catalogue.configurationGalleries ?? catalogue.galleries ?? {}).flat()]) {
        if (ID.test(image?.imageId) && ASSET.test(image.asset) && /^[a-f0-9]{64}$/.test(image.sha256)
          && Number.isSafeInteger(image.bytes) && image.bytes > 0 && image.bytes <= maxImageBytes) images.set(image.imageId, { image });
      }
      // Invalid source evidence disables live resolution but still permits the independently verified fallback.
      try {
        const bytes = Buffer.from(await loadSources());
        if (bytes.length > 8 * 1024 * 1024 || hash(bytes) !== catalogue.sourcesSha256) refuse();
        const sources = JSON.parse(bytes); const live = new Set(catalogue.liveImageIds || []);
        for (const source of sources.configurations || []) {
          const entry = images.get(source.image?.imageId);
          if (entry && live.has(source.image.imageId) && source.image.sha256 === entry.image.sha256 && source.evidence?.sourceRegistration && !entry.registration) {
            registrationUrls(source.evidence.sourceRegistration); entry.registration = source.evidence.sourceRegistration;
          }
        }
      } catch { /* Retained verified assets remain available when live evidence is unavailable. */ }
      return images;
    })();
    return mappings;
  }
  async function get(url, accept, limit, headers = {}) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || ![CONFIGURE, COSY].includes(target.origin) || target.username || target.password || target.hash || target.port) refuse();
    const controller = new AbortController(); let timer; let reader;
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(target.href, { method: 'GET', headers: { Accept: accept, ...headers }, credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted || response.status !== 200 || response.redirected || response.url && response.url !== target.href) refuse();
        const declared = response.headers.get('content-length'); if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) refuse();
        reader = response.body?.getReader(); if (!reader) refuse();
        const chunks = []; let size = 0;
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength; if (size > limit || controller.signal.aborted) refuse();
          chunks.push(Buffer.from(part.value));
        }
        return { bytes: Buffer.concat(chunks), type: contentType(response.headers), ttl: seconds(response.headers) };
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('image-timeout')); }, timeoutMs); timer.unref?.(); })]);
    } finally { clearTimeout(timer); controller.abort(); if (reader) await reader.cancel().catch(() => {}); }
  }
  async function live(entry) {
    const urls = registrationUrls(entry.registration);
    const page = await get(urls.page, 'text/html', 1024 * 1024); if (page.type !== 'text/html') refuse();
    const paths = [...new Set([...page.bytes.toString('utf8').matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)]
      .map((match) => match[0].startsWith('/en_GB/') ? match[0] : `/en_GB/${match[0]}`))];
    if (paths.length !== 1) refuse();
    const settings = await get(CONFIGURE + paths[0], 'application/json', 1024 * 1024); if (settings.type !== 'application/json') refuse();
    let key;
    try {
      key = credential(settings.bytes); settings.bytes.fill(0);
      const manifest = await get(urls.manifest, 'application/json', 1024 * 1024, { 'x-api-key': key });
      if (manifest.type !== 'application/json') refuse();
      const image = await get(selectedAsset(JSON.parse(manifest.bytes)), 'image/webp,image/png,image/jpeg', maxImageBytes);
      if (!imageType(image.bytes) || imageType(image.bytes) !== image.type) refuse();
      return { ...image, source: 'live' };
    } finally { key = undefined; settings.bytes.fill(0); }
  }
  async function fallback(entry) {
    const bytes = Buffer.from(await loadAsset(entry.image));
    if (bytes.length !== entry.image.bytes || bytes.length > maxImageBytes || hash(bytes) !== entry.image.sha256 || imageType(bytes) !== 'image/webp') refuse();
    return { bytes, type: 'image/webp', ttl: 60, source: 'retained' };
  }
  function runQueued() {
    while (active < maxConcurrent && queue.length) {
      const job = queue.shift(); active += 1;
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { active -= 1; runQueued(); });
    }
  }
  function schedule(work) {
    if (queue.length >= maxQueued) return Promise.reject(new Error('image-queue-full'));
    return new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); runQueued(); });
  }
  function remember(id, value) {
    if (!value.ttl || value.bytes.length > maxCacheBytes) return;
    while (allocation + value.bytes.length > maxCacheBytes && cache.size) {
      const oldest = cache.keys().next().value; allocation -= cache.get(oldest).bytes.length; cache.delete(oldest);
    }
    cache.set(id, { ...value, expires: now() + value.ttl * 1000 }); allocation += value.bytes.length;
  }
  async function resolveImage(id, entry) {
    const known = cache.get(id);
    if (known && known.expires > now()) { cache.delete(id); cache.set(id, known); return { ...known, ttl: Math.max(0, Math.floor((known.expires - now()) / 1000)) }; }
    if (known) { allocation -= known.bytes.length; cache.delete(id); }
    if (!pending.has(id)) {
      const work = (async () => {
        let value;
        try { if (!entry.registration) refuse(); value = await schedule(() => live(entry)); }
        catch { value = await fallback(entry); }
        if (value.source === 'live') remember(id, value);
        return value;
      })();
      pending.set(id, work); work.finally(() => pending.delete(id)).catch(() => {});
    }
    return pending.get(id);
  }
  return async ({ req, res, pathname }) => {
    if (typeof pathname !== 'string' || !pathname.startsWith(PREFIX)) return false;
    const end = (status, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(); return true; };
    if (req.method !== 'GET') return end(405, { Allow: 'GET' });
    let parsed;
    try { parsed = new URL(req.url, 'https://local.invalid'); } catch { return end(400); }
    if (parsed.search || parsed.hash || parsed.pathname !== pathname) return end(400);
    const match = pathname.slice(PREFIX.length).match(/^(bmw-display-[a-f0-9]{20})\.webp$/); if (!match) return end(404);
    try {
      const entry = (await mapping()).get(match[1]); if (!entry) return end(404);
      const image = await resolveImage(match[1], entry);
      res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.bytes.length,
        'Cache-Control': `private, max-age=${image.ttl}`, 'X-Content-Type-Options': 'nosniff' });
      res.end(image.bytes); return true;
    } catch { return end(503, { 'Retry-After': '60' }); }
  };
}
