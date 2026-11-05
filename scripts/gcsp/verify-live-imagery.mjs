import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBmwLiveImageryProvider, presentBmwLiveImage } from '../../server/vehicle-evidence/bmw-live-imagery.js';
import { createBmwImageAdapter } from '../../server/vehicle-evidence/bmw-image-adapter.js';
import { createBmwCatalogueAdapter } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';

export const LIMITS = Object.freeze({ requests: 8, images: 2, bytes: 6 * 1024 * 1024,
  requestMs: 15000, totalMs: 120000, retries: 0, concurrency: 1 });
export const SETTINGS = 'https://configure.bmw.co.uk/en_GB/settings.f8e66668.json';
const ORIGIN = 'https://prod.cosy.bmw.cloud';
const MANIFEST = '/image-urls/dynamic-named-images/mandators/connext-bmw/collections/stage-fullscreen-views-legacy-newnames/brands/bmwCar/models/72HH';
const LEDGER = new URL('../../docs/gcsp/evidence/fucq51/native-attempt-v1.json', import.meta.url);
const FILES = ['i5-p0300-herofront.webp', 'i5-p0475-herofront.webp'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw Error(code); };
const SAFE_CODES = new Set(['budget-exhausted', 'source-invalid', 'access-denied', 'http-failure', 'redirect-refused',
  'content-type', 'response-byte-cap', 'request-timeout', 'source-busy', 'settings-invalid', 'snapshot-invalid',
  'image-unavailable', 'delivery-failed', 'artifact-write-failed']);

/** One shared budget covers settings, manifests and assets, including partially read failure bodies. */
export function createBoundedTransport({ fetchImpl, now = () => performance.now() } = {}) {
  if (typeof fetchImpl !== 'function') throw TypeError('Supply an explicit transport.');
  const started = now(); const requests = []; let bytes = 0; let images = 0; let active = false; let stopped = null;
  const state = () => ({ requests: requests.map((item) => ({ ...item })), requestCount: requests.length,
    imageCount: images, bytes, elapsedMs: Math.max(0, Math.ceil(now() - started)), stopped });
  const get = async (input) => {
    if (stopped) fail(stopped);
    if (active) { stopped = 'source-busy'; fail(stopped); }
    let url; try { url = new URL(input.url); } catch { stopped = 'source-invalid'; fail(stopped); }
    const settings = input.url === SETTINGS;
    const asset = url.origin === ORIGIN && url.pathname === '/connext-bmw/cosySec';
    const manifest = url.origin === ORIGIN && url.pathname === MANIFEST;
    if ((!settings && !asset && !manifest) || url.username || url.password || url.hash || url.port
      || input.method !== 'GET' || input.credentials !== 'omit' || input.cache !== 'no-store'
      || input.redirect !== 'error' || input.retries !== 0
      || !Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 1
      || input.maxResponseBytes > (asset ? 2097152 : 1048576)
      || ((settings || asset) && Object.keys(input.headers || {}).some((key) => key.toLowerCase() !== 'accept'))
      || (manifest && Object.keys(input.headers || {}).some((key) => !['accept', 'x-api-key'].includes(key.toLowerCase())))) {
      stopped = 'source-invalid'; fail(stopped);
    }
    const remaining = LIMITS.totalMs - (now() - started);
    if (remaining <= 0 || requests.length >= LIMITS.requests || bytes >= LIMITS.bytes || asset && images >= LIMITS.images) {
      stopped = 'budget-exhausted'; fail(stopped);
    }
    const entry = { kind: settings ? 'settings' : asset ? 'asset' : 'manifest', status: null, bytes: 0 };
    requests.push(entry); if (asset) images += 1; active = true;
    const controller = new AbortController();
    const abort = () => controller.abort(); input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    let timer; let reader; let response;
    try {
      const work = async () => {
        response = await fetchImpl(input.url, { method: 'GET', headers: input.headers,
          credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (controller.signal.aborted) fail('request-timeout');
        entry.status = Number.isInteger(response.status) ? response.status : null;
        if (response.redirected || response.url && response.url !== input.url || response.status >= 300 && response.status < 400) fail('redirect-refused');
        if ([401, 403].includes(response.status)) fail('access-denied');
        if (response.status !== 200) fail('http-failure');
        const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (type !== (asset ? 'image/webp' : 'application/json')) fail('content-type');
        reader = response.body?.getReader(); if (!reader) fail('source-invalid');
        const chunks = [];
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          if (controller.signal.aborted) fail('request-timeout');
          entry.bytes += part.value.byteLength; bytes += part.value.byteLength;
          if (entry.bytes > input.maxResponseBytes || bytes > LIMITS.bytes) fail('response-byte-cap');
          if (now() - started >= LIMITS.totalMs) fail('budget-exhausted');
          chunks.push(Buffer.from(part.value));
        }
        if (now() - started >= LIMITS.totalMs) fail('budget-exhausted');
        return { status: 200, contentType: type, body: Buffer.concat(chunks) };
      };
      return await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('request-timeout')); }, Math.min(LIMITS.requestMs, remaining));
      })]);
    } catch (error) {
      stopped = SAFE_CODES.has(error?.message) ? error.message : controller.signal.aborted ? 'request-timeout' : 'http-failure';
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
      fail(stopped);
    } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); active = false; }
  };
  return Object.freeze({ get, state });
}

function credentialFromSettings(bytes) {
  let data; try { data = JSON.parse(bytes.toString('utf8')); } catch { fail('settings-invalid'); }
  const app = data.APP || data.app; const profile = (app?.backend || app?.BACKEND)?.settingsCosy;
  const nodes = []; const walk = (value) => {
    if (value && typeof value === 'object') { nodes.push(value); Object.values(value).forEach(walk); }
  }; walk(profile);
  const registered = nodes.some((item) => Object.values(item).some((value) => {
    try { return typeof value === 'string' && new URL(value).origin === ORIGIN; } catch { return false; }
  }));
  const keys = nodes.flatMap((item) => Object.entries(item).filter(([key, value]) => /^x-api-key$/i.test(key)
    && typeof value === 'string').map(([, value]) => value));
  if (!registered || new Set(keys).size !== 1 || !keys[0] || keys[0].length > 4096 || /[\r\n]/.test(keys[0])) fail('settings-invalid');
  return keys[0];
}

/** Inputs and independent identity context come solely from the two registered complete C14 selections. */
export async function loadVerificationContext() {
  const source = JSON.parse(await readFile(new URL('../../server/vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json', import.meta.url)));
  const requests = source.assets.map(({ identity, size, viewpoint }) => ({ ...identity, size, viewpoint,
    viewport: 'desktop', namedImage: 'Gallery', distinctions: { BKGND: 'sand', X: '1700', Y: '500' } }));
  const imageAdapter = createBmwImageAdapter({ environment: 'gcsp-demo' });
  const contexts = await Promise.all(requests.map((request) => imageAdapter.resolve(request)));
  const catalogue = await createBmwCatalogueAdapter().resolve(requests[0]);
  const withoutPaint = (request) => ({ ...request, selectedOptions: request.selectedOptions.filter((code) => !['P0300', 'P0475'].includes(code)) });
  if (requests.length !== 2 || JSON.stringify(withoutPaint(requests[0])) !== JSON.stringify(withoutPaint(requests[1]))
    || !requests[0].selectedOptions.includes('P0300') || !requests[1].selectedOptions.includes('P0475')
    || contexts.some((context) => context.status !== 'ok' || !context.resolvedIdentity)
    || !['ok', 'partial'].includes(catalogue.status) || !catalogue.equipment.selected.complete) fail('snapshot-invalid');
  return { requests, contexts, catalogue };
}

const CSP = "default-src 'none'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
export function publishedAssetPage() {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Representative BMW renders</title>'
    + '<h1>Representative BMW i5 renders</h1><p>Model and paint await visual inspection. Wheels, interior, equipment and exact vehicle appearance unknown.</p>'
    + FILES.map((file, index) => `<figure><img src="./${file}" width="2560" height="1646" alt="Representative BMW i5 ${index ? 'black' : 'white'} render"><figcaption>${index ? 'P0475 Black Sapphire' : 'P0300 Alpine White'}</figcaption></figure>`).join('') + '</html>';
}

/** Harness-only loopback publication proves the HLD's ordinary same-origin image-loading route. */
export async function provePublishedDelivery(assets, { inspect } = {}) {
  if (!Array.isArray(assets) || assets.length !== 2 || assets.some((asset, index) => asset.file !== FILES[index]
    || !Buffer.isBuffer(asset.bytes) || asset.bytes.length > 2097152)) fail('delivery-failed');
  const page = publishedAssetPage(); const files = new Map(assets.map((asset) => [`/${asset.file}`, asset.bytes]));
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', CSP);
    if (request.method !== 'GET' || request.url !== '/index.html' && !files.has(request.url)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', request.url === '/index.html' ? 'text/html; charset=utf-8' : 'image/webp');
    response.end(request.url === '/index.html' ? page : files.get(request.url));
  });
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = async (path) => {
      const response = await fetch(`${origin}/${path}`, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (response.status !== 200 || response.headers.get('content-security-policy') !== CSP
        || response.headers.get('cache-control') !== 'no-store') fail('delivery-failed');
      return { response, body: Buffer.from(await response.arrayBuffer()) };
    };
    const document = await get('index.html'); if (document.body.toString() !== page) fail('delivery-failed');
    const delivered = await get(assets[0].file);
    if (delivered.response.headers.get('content-type') !== 'image/webp' || hash(delivered.body) !== hash(assets[0].bytes)) fail('delivery-failed');
    let browserInspection = { status: 'pending' };
    if (inspect) {
      const inspected = await inspect({ origin, page: '/index.html', images: FILES.map((file) => `/${file}`) });
      if (inspected?.status !== 'passed' || inspected.decodedImages !== 2
        || inspected.externalRequests !== 0 || inspected.cspViolations !== 0) fail('delivery-failed');
      browserInspection = { status: 'passed', decodedImages: 2, externalRequests: 0, cspViolations: 0 };
    }
    return { status: 'passed', route: 'harness-local-published-assets', harnessRequests: ['index.html', assets[0].file],
      csp: CSP, cacheControl: 'no-store', browserBmwCredentials: false, browserOpaqueSourceUrls: false,
      authorisation: 'BMW-approved-project-retention-and-display-2026-11-05', productionIntegration: false,
      browserInspection, browserVisualInspection: 'pending' };
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

/** No fetch dependency is selected on import or ordinary lookup; callers explicitly inject transport. */
export async function verifyLiveImagery({ fetchImpl, now, clock = () => new Date(),
  deliver = provePublishedDelivery, onAsset = async () => {}, onCheckpoint = async () => {} } = {}) {
  const budget = createBoundedTransport({ fetchImpl, now }); let provider; let credential;
  const report = { version: 1, status: 'failed', source: 'BMW public UK configurator', sourceSupport: 'unsupported-public-website-demo',
    limits: LIMITS, liveCatalogueRequests: 0, images: [], delivery: null, visualInspection: 'pending',
    paintVariation: 'pending-actual-visual-inspection', fullOptionFidelity: 'unknown', viewCoverage: 'single-HEROFRONT-no-360', catalogue: null };
  try {
    const context = await loadVerificationContext();
    report.catalogue = { status: context.catalogue.status, sourceKind: context.catalogue.sourceKind,
      snapshotVersion: context.catalogue.snapshotVersion, observedDate: context.catalogue.observedDate, facts: context.catalogue.facts };
    const settings = await budget.get({ url: SETTINGS, method: 'GET', headers: { Accept: 'application/json' },
      maxResponseBytes: 1048576, credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0 });
    credential = credentialFromSettings(settings.body); settings.body.fill(0);
    provider = createBmwLiveImageryProvider({ environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator',
      transport: async (input) => { try { return await budget.get(input); } finally { await onCheckpoint(budget.state()); } },
      getCredential: async () => credential, clock,
      resolveConfiguration: async ({ requestedIdentity }) => {
        const match = context.contexts.find((item) => JSON.stringify(item.resolvedIdentity) === JSON.stringify(requestedIdentity));
        return match ? { basis: 'independent-source-proof', identity: { ...match.resolvedIdentity, selectionComplete: true },
          observedDate: match.observedDate, fidelity: { model: 'unknown', paint: 'unknown' } } : null;
      } });
    const assets = [];
    for (const [index, request] of context.requests.entries()) {
      const result = await provider.resolve(request);
      if (result.status !== 'ok') { report.imageFailure = result.failure?.code || 'image-unavailable'; fail('image-unavailable'); }
      const read = await provider.readAsset(result.image.assetId);
      if (read.status !== 'ok' || hash(read.bytes) !== result.image.sha256) fail('delivery-failed');
      const asset = { file: FILES[index], bytes: read.bytes };
      report.images.push({ file: asset.file, configuration: result.resolvedIdentity, lookup: result.resolvedLookupIdentity,
        provider: result.provider, providerVersion: result.providerVersion, schemaVersion: result.schemaVersion,
        snapshotVersion: result.snapshotVersion, observedDate: result.observedDate, retrievedDate: result.retrievedDate,
        identityProvenance: result.identityProvenance, manifestIdentityEchoed: false, image: result.image,
        presentation: presentBmwLiveImage(result) });
      assets.push(asset);
      try { await onAsset(asset); } catch { fail('artifact-write-failed'); }
    }
    if (budget.state().elapsedMs >= LIMITS.totalMs) fail('budget-exhausted');
    report.delivery = await deliver(assets);
    if (budget.state().elapsedMs >= LIMITS.totalMs || report.delivery?.status !== 'passed') fail('delivery-failed');
    report.status = 'technical-pass-visual-inspection-pending';
  } catch (error) { report.failure = budget.state().stopped || (SAFE_CODES.has(error?.message) ? error.message : 'image-unavailable'); }
  finally { credential = null; provider?.dispose(); report.budget = budget.state(); await onCheckpoint(report.budget); }
  return report;
}

export function parseCliArguments(argv) {
  if (argv.length === 1 && argv[0] === '--live') return fileURLToPath(new URL('../../docs/gcsp/evidence/fucq51/native-v1-assets', import.meta.url));
  if (argv.length === 3 && argv[0] === '--live' && argv[1] === '--output' && argv[2]) return resolve(argv[2]);
  return null;
}

export async function runCli({ argv = process.argv.slice(2), fetchImpl = globalThis.fetch, inspect,
  write = (line) => process.stdout.write(line) } = {}) {
  const output = parseCliArguments(argv);
  if (!output) {
    write('Usage: node scripts/gcsp/verify-live-imagery.mjs --live [--output <new-artifact-directory>]\n'); return 2;
  }
  let ledger;
  try {
    await reserveAttempt(LEDGER, output);
    ledger = true; await mkdir(output, { recursive: false, mode: 0o700 });
    const report = await verifyLiveImagery({ fetchImpl, deliver: (assets) => provePublishedDelivery(assets, { inspect }),
      onCheckpoint: async (budget) => writeFile(LEDGER, JSON.stringify({ version: 1, state: 'running', output,
        limits: LIMITS, budget, reviewRequiredBeforeAnotherAttempt: true }) + '\n', { mode: 0o600 }),
      onAsset: async (asset) => writeFile(join(output, asset.file), asset.bytes, { flag: 'wx', mode: 0o600 }) });
    await writeFile(join(output, 'index.html'), publishedAssetPage(), { flag: 'wx', mode: 0o600 });
    await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(LEDGER, JSON.stringify({ version: 1, state: 'finished', output, status: report.status,
      limits: LIMITS, budget: report.budget, reviewRequiredBeforeAnotherAttempt: true }) + '\n', { mode: 0o600 });
    write(JSON.stringify({ status: report.status, summary: join(output, 'summary.json'), assets: report.images.map(({ file }) => join(output, file)) }) + '\n');
    return report.status === 'technical-pass-visual-inspection-pending' ? 0 : 1;
  } catch {
    if (ledger) await writeFile(LEDGER, JSON.stringify({ version: 1, state: 'interrupted-or-output-failed', output,
      reviewRequiredBeforeAnotherAttempt: true }) + '\n', { mode: 0o600 }).catch(() => {});
    write(JSON.stringify({ status: ledger ? 'artifact-write-failed' : 'attempt-ledger-exists-or-unavailable', reviewRequired: true }) + '\n'); return 1;
  }
}

export async function reserveAttempt(path, output) {
  await writeFile(path, JSON.stringify({ version: 1, state: 'started', output, limits: LIMITS,
    reviewRequiredBeforeAnotherAttempt: true }) + '\n', { flag: 'wx', mode: 0o600 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli();
