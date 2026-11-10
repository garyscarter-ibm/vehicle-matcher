import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLiveDisplayImageHandler } from '../gcsp/vehicle-evidence/live-display-images.js';

const id = 'bmw-display-aaaaaaaaaaaaaaaaaaaa';
const otherId = 'bmw-display-bbbbbbbbbbbbbbbbbbbb';
const path = (imageId = id) => `/api/gcsp/vehicle-images/${imageId}.webp`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Deliberately tiny signature fixtures. Browser decoding is separately covered by the real image smoke.
const webp = (marker = 1) => {
  const bytes = Buffer.alloc(24); bytes.write('RIFF'); bytes.writeUInt32LE(16, 4); bytes.write('WEBP', 8);
  bytes.write('VP8 ', 12); bytes.writeUInt32LE(4, 16); bytes[20] = marker; return bytes;
};
const retained = webp(1); const live = webp(2);
const response = (body, type, cache = 'max-age=604800') => new Response(body, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': cache } });
const registration = { factoryOptionCodes: ['P0300', 'S0205'], model: { market: 'GB', locale: 'en-GB', steering: 'RL', catalogueRangeKey: 'G21', modelCode: 'T3MK', agModelCode: '22FY', effectDate: '2027-01-05' } };

function fixture({ ids = [id], badSourceHash = false, unsupported = false, changeAsset = null, cacheControl, failAt, assetGate, fetchOverride, maxCacheBytes } = {}) {
  const calls = []; let fallbacks = 0;
  const images = ids.map((imageId) => ({ imageId, asset: `assets/gcsp-vehicle-evidence/${hash(retained)}.webp`, bytes: retained.length, sha256: hash(retained) }));
  const sources = Buffer.from(JSON.stringify({ configurations: images.map((image) => ({ image, evidence: { sourceRegistration: registration } })) }));
  const catalogue = { configurations: images.map((image) => ({ image })), variants: {}, models: {}, sourcesSha256: badSourceHash ? '0'.repeat(64) : hash(sources), liveImageIds: unsupported ? [] : ids };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init }); const parsed = new URL(url);
    const kind = parsed.hostname === 'configure.bmw.co.uk' ? parsed.pathname.includes('settings.') ? 'settings' : 'page'
      : parsed.pathname === '/connext-bmw/cosySec' ? 'asset' : 'manifest';
    if (fetchOverride) { const result = await fetchOverride(kind, url, init); if (result) return result; }
    if (failAt === kind) throw new Error('upstream failure with opaque URL must never be exposed');
    if (kind === 'page') return response('<script src="/en_GB/settings.current123.json"></script>', 'text/html');
    if (kind === 'settings') return response(JSON.stringify({ APP: { backend: { settingsCosy: { base: 'https://prod.cosy.bmw.cloud', headers: { 'x-api-key': 'fixture-public-key' } } } } }), 'application/json');
    if (kind === 'manifest') return response(JSON.stringify({ 'stage-fullscreen-views-legacy-newnames': { desktop: { namedImages: [{ name: 'Gallery', images: [
      { distinctionParameters: { POV: 'REAR', BKGND: 'sand' }, viewImage: 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?wrong=rear' },
      { distinctionParameters: { POV: 'FRONTLEFT', BKGND: 'sand' }, viewImage: changeAsset || 'https://prod.cosy.bmw.cloud/connext-bmw/cosySec?opaque=fixture' },
    ] }] } } }), 'application/json');
    if (assetGate) await assetGate();
    return response(live, 'image/webp', cacheControl);
  };
  let time = 1000;
  const handler = createLiveDisplayImageHandler({ fetchImpl, now: () => time, loadCatalogue: async () => catalogue,
    loadSources: async () => sources, loadAsset: async () => { fallbacks += 1; return retained; }, ...(maxCacheBytes ? { maxCacheBytes } : {}) });
  return { handler, calls, advance: (ms) => { time += ms; }, fallbacks: () => fallbacks };
}
async function request(handler, { pathname = path(), method = 'GET', url = pathname } = {}) {
  const out = { status: null, headers: null, body: null };
  const res = { writeHead(status, headers) { out.status = status; out.headers = headers; return this; }, end(body) { out.body = body; } };
  out.handled = await handler({ req: { method, url, headers: { Authorization: 'fixture-must-not-forward', Cookie: 'fixture-must-not-forward' } }, res, pathname });
  return out;
}

test('live manifest FRONTLEFT imagery is primary, safe headers are used, and successful bytes are cached', async () => {
  const f = fixture(); const first = await request(f.handler); const second = await request(f.handler);
  assert.equal(first.handled, true); assert.equal(first.status, 200); assert.deepEqual(first.body, live); assert.deepEqual(second.body, live);
  assert.equal(first.headers['Content-Type'], 'image/webp'); assert.equal(first.headers['Cache-Control'], 'private, max-age=604800');
  assert.equal(f.calls.length, 4); assert.equal(f.fallbacks(), 0);
  assert.ok(f.calls.every(({ init }) => init.method === 'GET' && init.credentials === 'omit' && init.redirect === 'error' && !init.headers.Cookie && !init.headers.Authorization));
  const manifest = f.calls.find(({ url }) => url.includes('/image-urls/'));
  assert.equal(manifest.init.headers['x-api-key'], 'fixture-public-key');
  assert.ok(f.calls.filter(({ url }) => !url.includes('/image-urls/')).every(({ init }) => !init.headers['x-api-key']));
  assert.deepEqual(Object.keys(first.headers).sort(), ['Cache-Control', 'Content-Length', 'Content-Type', 'X-Content-Type-Options'].sort());
});

test('cache expires and max-age is capped at seven days', async () => {
  const f = fixture({ cacheControl: 'max-age=999999999' });
  assert.equal((await request(f.handler)).headers['Cache-Control'], 'private, max-age=604800');
  f.advance(604800000); await request(f.handler); assert.equal(f.calls.length, 8);
});

test('no-store source responses are not retained in the server cache', async () => {
  const f = fixture({ cacheControl: 'no-store' });
  await request(f.handler); await request(f.handler); assert.equal(f.calls.length, 8);
});

test('requests for one image are coalesced while upstream work is pending', async () => {
  let release; let entered;
  const started = new Promise((done) => { entered = done; });
  const gate = new Promise((done) => { release = done; });
  const f = fixture({ assetGate: async () => { entered(); await gate; } });
  const a = request(f.handler); const b = request(f.handler); await started;
  assert.equal(f.calls.length, 4); release();
  const results = await Promise.all([a, b]); assert.ok(results.every((out) => out.status === 200 && out.body.equals(live)));
  assert.equal(f.calls.length, 4);
});

test('different image jobs never exceed two concurrent upstream resolutions', async () => {
  let release; let twoEntered; let entered = 0;
  const started = new Promise((done) => { twoEntered = done; });
  const gate = new Promise((done) => { release = done; });
  const thirdId = 'bmw-display-cccccccccccccccccccc';
  const f = fixture({ ids: [id, otherId, thirdId], assetGate: async () => { entered += 1; if (entered === 2) twoEntered(); await gate; } });
  const requests = [id, otherId, thirdId].map((imageId) => request(f.handler, { pathname: path(imageId) }));
  await started; assert.equal(entered, 2); assert.equal(f.calls.length, 8);
  release(); const results = await Promise.all(requests);
  assert.ok(results.every((out) => out.status === 200)); assert.equal(f.calls.length, 12);
});

test('cache allocation is bounded and evicts the least recently used image', async () => {
  const f = fixture({ ids: [id, otherId], maxCacheBytes: live.length });
  await request(f.handler); await request(f.handler, { pathname: path(otherId) }); await request(f.handler);
  assert.equal(f.calls.length, 12);
});

test('upstream failures use byte-verified retained imagery with a short browser lifetime', async () => {
  for (const failAt of ['page', 'settings', 'manifest', 'asset']) {
    const f = fixture({ failAt }); const out = await request(f.handler);
    assert.equal(out.status, 200); assert.deepEqual(out.body, retained); assert.equal(out.headers['Cache-Control'], 'private, max-age=60'); assert.equal(f.fallbacks(), 1);
    assert.equal(JSON.stringify(out.headers).includes('opaque'), false);
  }
});

test('untrusted source evidence and unsupported legacy images do not initiate live requests', async () => {
  for (const options of [{ badSourceHash: true }, { unsupported: true }]) {
    const f = fixture(options); const out = await request(f.handler);
    assert.equal(out.status, 200); assert.deepEqual(out.body, retained); assert.equal(f.calls.length, 0);
  }
});

test('manifest image references cannot proxy another host, credentials, redirect, or path', async () => {
  for (const changeAsset of ['https://example.com/connext-bmw/cosySec?a=b', 'http://prod.cosy.bmw.cloud/connext-bmw/cosySec?a=b',
    'https://user:password@prod.cosy.bmw.cloud/connext-bmw/cosySec?a=b', 'https://prod.cosy.bmw.cloud/elsewhere', 'https://prod.cosy.bmw.cloud:8443/connext-bmw/cosySec?a=b']) {
    const f = fixture({ changeAsset }); const out = await request(f.handler);
    assert.deepEqual(out.body, retained); assert.equal(f.calls.length, 3);
  }
});

test('redirect responses, wrong image signatures and oversized images fall back', async () => {
  for (const responseForAsset of [() => new Response(null, { status: 302, headers: { Location: 'https://example.com' } }),
    () => response('not an image', 'image/webp'), () => new Response('tiny', { headers: { 'Content-Type': 'image/webp', 'Content-Length': '2097153' } })]) {
    const f = fixture({ fetchOverride: (kind) => kind === 'asset' ? responseForAsset() : null });
    assert.deepEqual((await request(f.handler)).body, retained);
  }
});

test('only fixed known image paths and GET without query strings are accepted', async () => {
  const f = fixture();
  assert.equal((await request(f.handler, { pathname: '/api/gcsp/unrelated' })).handled, false);
  for (const [input, status] of [[{ method: 'POST' }, 405], [{ url: `${path()}?url=https://example.com` }, 400],
    [{ pathname: '/api/gcsp/vehicle-images/../../asset.webp' }, 400], [{ pathname: path('bmw-display-cccccccccccccccccccc') }, 404],
    [{ pathname: '/api/gcsp/vehicle-images/not-a-token.webp' }, 404]]) assert.equal((await request(f.handler, input)).status, status);
  assert.equal(f.calls.length, 0);
});

test('corrupt retained fallback fails closed without returning unchecked bytes', async () => {
  const f = fixture({ unsupported: true });
  const bad = webp(7);
  const image = { imageId: id, asset: `assets/gcsp-vehicle-evidence/${hash(retained)}.webp`, bytes: retained.length, sha256: hash(retained) };
  const handler = createLiveDisplayImageHandler({ fetchImpl: async () => assert.fail('no network expected'),
    loadCatalogue: async () => ({ configurations: [{ image }], variants: {}, models: {} }), loadSources: async () => Buffer.from('{}'), loadAsset: async () => bad });
  const out = await request(handler); assert.equal(out.status, 503); assert.equal(out.body, undefined); assert.equal(f.calls.length, 0);
});
