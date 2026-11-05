import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { bmwLiveImageLookupIdentity, createBmwLiveImageryProvider, presentBmwLiveImage,
  selectBmwImageSnapshot } from '../vehicle-evidence/bmw-live-imagery.js';
import { createBmwImageAdapter } from '../vehicle-evidence/bmw-image-adapter.js';
import { createBmwCatalogueAdapter, mergeBmwCatalogueFacts } from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { createBoundedTransport, verifyLiveImagery, loadVerificationContext, publishedAssetPage,
  provePublishedDelivery, reserveAttempt, runCli, parseCliArguments, SETTINGS, LIMITS } from '../../scripts/gcsp/verify-live-imagery.mjs';

const COLLECTION = 'stage-fullscreen-views-legacy-newnames';
const ORIGIN = 'https://prod.cosy.bmw.cloud';
const URL_ASSET = `${ORIGIN}/connext-bmw/cosySec?opaque=fixture%2Btoken%3D&keep=untouched`;
const source = JSON.parse(await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json', import.meta.url)));
const bytes = await readFile(new URL('../vehicle-evidence/assets/bmw-gb-i5-images-2026-11-01.v1/alpine-white.webp', import.meta.url));
const request = () => ({ ...structuredClone(source.assets[0].identity), selectionComplete: true,
  viewport: 'desktop', namedImage: 'Gallery', viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 },
  distinctions: { BKGND: 'sand', X: '1700', Y: '500' } });
const manifest = () => ({ [COLLECTION]: { desktop: { metaData: { width: 2560, height: 1646 },
  namedImages: [{ name: 'Gallery', images: [{ viewImage: URL_ASSET,
    distinctionParameters: { POV: 'HEROFRONT', BKGND: 'sand', X: '1700', Y: '500' } }] }] } } });
const record = (data) => data[COLLECTION].desktop.namedImages[0].images[0];
const proof = () => ({ basis: 'independent-source-proof', identity: request(), observedDate: '2026-11-01',
  fidelity: { model: 'verified', paint: 'verified', wheels: 'verified', equipment: 'verified', interior: 'verified', exactVehicle: 'verified' } });
function fixture(options = {}) {
  const calls = [];
  const transport = async (input) => {
    calls.push(input);
    return input.url === URL_ASSET
      ? { status: 200, contentType: 'image/webp', body: bytes }
      : { status: 200, contentType: 'application/json;charset=utf-8', body: JSON.stringify(manifest()) };
  };
  const provider = createBmwLiveImageryProvider({ environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator',
    transport, getCredential: async () => 'offline-fixture-credential', resolveConfiguration: async () => proof(),
    clock: () => new Date('2026-11-05T12:00:00Z'), ...options });
  return { provider, calls };
}

test('complete snapshot canonical identity includes named group, viewport and distinctions, without catalogue access', async () => {
  const a = request(); const b = request(); b.selectedOptions.reverse(); b.selectedAccessories.reverse();
  b.distinctions = { Y: '500', X: '1700', BKGND: 'sand' };
  assert.deepEqual(bmwLiveImageLookupIdentity(a), bmwLiveImageLookupIdentity(b));
  const key = JSON.stringify(bmwLiveImageLookupIdentity(a));
  assert.equal(bmwLiveImageLookupIdentity(a).provider, 'bmw-cosy-named-images');
  assert.equal(bmwLiveImageLookupIdentity(a).snapshotVersion, 'bmw-uk-cosy-named-images.v1');
  for (const changed of [{ agModelCode: '22FY' }, { modelCode: 'T3SK' },
    ...['catalogueDate', 'orderDate', 'effectDate', 'productionDate', 'taxDate'].map((key) => ({ [key]: '2027-02-05' })),
    { selectedAccessories: [...a.selectedAccessories, 'SE000002'] }, { locale: 'de-DE' }, { market: 'DE' },
    { selectedOptions: a.selectedOptions.map((code) => code === 'P0300' ? 'P0475' : code) },
    { selectedOptions: [...a.selectedOptions, 'S03AC'] }, { viewport: 'mobile' }, { namedImage: 'Other' },
    { viewpoint: 'HEROREAR' }, { size: { width: 1280, height: 1152 } }, { distinctions: { BKGND: 'sandnight' } }]) {
    assert.notEqual(JSON.stringify(bmwLiveImageLookupIdentity({ ...a, ...changed })), key);
  }
});

test('injected independent proof resolves exact named bytes, safe metadata and opaque server asset ID', async () => {
  const { provider, calls } = fixture(); const result = await provider.resolve(request());
  assert.equal(result.status, 'ok'); assert.equal(calls.length, 2);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, ORIGIN); assert.ok(url.pathname.endsWith('/models/72HH'));
  assert.equal(url.searchParams.get('effectdate'), '20270105');
  assert.equal(url.searchParams.get('options'), [...request().selectedOptions].sort().join(','));
  assert.equal(url.searchParams.get('hub'), 'CLOUD_PROD_INTERNET'); assert.equal(url.searchParams.get('imagetype'), 'webp');
  assert.equal(calls[0].headers['x-api-key'], 'offline-fixture-credential');
  assert.equal(calls[1].url, URL_ASSET); assert.equal(calls[1].headers['x-api-key'], undefined);
  for (const call of calls) {
    assert.equal(call.method, 'GET'); assert.equal(call.credentials, 'omit'); assert.equal(call.cache, 'no-store');
    assert.equal(call.redirect, 'error'); assert.equal(call.retries, 0); assert.ok(call.maxResponseBytes <= 2097152);
  }
  assert.deepEqual(result.requestedIdentity, result.resolvedIdentity);
  assert.equal(result.manifestResolvedIdentity, null); assert.equal(result.identityProvenance.manifestIdentityEchoed, false);
  assert.equal(result.sourceSupport, 'unsupported-public-website-demo'); assert.equal(result.observedDate, '2026-11-01');
  assert.equal(result.retrievedDate, '2026-11-05'); assert.equal(result.image.role, 'representative-catalogue-render');
  assert.equal(result.image.fidelity.model, 'verified'); assert.equal(result.image.fidelity.paint, 'verified');
  for (const key of ['wheels', 'interior', 'equipment', 'exactVehicle']) assert.equal(result.image.fidelity[key], 'unknown');
  assert.deepEqual((await provider.readAsset(result.image.assetId)).bytes, bytes);
  assert.equal(calls.length, 2);
  const text = JSON.stringify(result); assert.ok(!text.includes(URL_ASSET)); assert.ok(!text.includes('offline-fixture-credential'));
  const shown = presentBmwLiveImage(result); assert.equal(shown.label, 'Representative image');
  assert.match(shown.caption, /equipment and exact vehicle appearance unknown/);
  provider.dispose(); assert.equal((await provider.readAsset(result.image.assetId)).status, 'source-unavailable');
});

test('observed interior WIDTH/HEIGHT siblings do not reject the safe exterior target', async () => {
  // V5 native diagnostics observed these keys and safe string shapes; values and URLs below are synthetic.
  const data = manifest(); const images = data[COLLECTION].desktop.namedImages[0].images;
  for (const POV of ['DASH', 'INTERIORSIDE']) images.push({ viewImage: URL_ASSET,
    distinctionParameters: { POV, WIDTH: 'fixture-width', HEIGHT: 'fixture-height', BKGND: 'sand' } });
  let assets = 0;
  const { provider } = fixture({ transport: async ({ url }) => {
    if (url === URL_ASSET) { assets += 1; return { status: 200, contentType: 'image/webp', body: bytes }; }
    return { status: 200, contentType: 'application/json', body: JSON.stringify(data) };
  } });
  assert.equal((await provider.resolve(request())).status, 'ok'); assert.equal(assets, 1);
  provider.dispose();
});

test('all distinction keys must match exactly; unspecified crops are not substituted', async () => {
  const data = manifest(); record(data).distinctionParameters.W = '11000';
  const { provider, calls } = fixture({ transport: async (input) => {
    calls.push(input); return { status: 200, contentType: 'application/json', body: JSON.stringify(data) };
  } });
  const result = await provider.resolve(request());
  assert.equal(result.failure.code, 'unsupported-request'); assert.equal(calls.length, 1);
  provider.dispose();
});

test('observed sibling keys do not relax asset safety, value bounds or unknown parameter rejection', async () => {
  for (const change of [{ viewImage: 'https://evil.example/connext-bmw/cosySec' },
    { distinctionParameters: { POV: 'DASH', WIDTH: 'x'.repeat(33), HEIGHT: '100' } },
    { distinctionParameters: { POV: 'DASH', WIDTH: '100', HEIGHT: '100', URL: 'unregistered' } }]) {
    const data = manifest(); data[COLLECTION].desktop.namedImages[0].images.push({ viewImage: URL_ASSET,
      distinctionParameters: { POV: 'DASH', WIDTH: '100', HEIGHT: '100', BKGND: 'sand' }, ...change });
    let calls = 0;
    const { provider } = fixture({ transport: async () => {
      calls += 1; return { status: 200, contentType: 'application/json', body: JSON.stringify(data) };
    } });
    assert.equal((await provider.resolve(request())).failure.code, 'manifest-unavailable'); assert.equal(calls, 1);
    provider.dispose();
  }
});

test('actual observed COSY shape without independent identity fails honestly before any asset request', async () => {
  const { provider, calls } = fixture({ resolveConfiguration: undefined });
  const result = await provider.resolve(request());
  assert.equal(result.failure.code, 'identity-unverified'); assert.equal(result.status, 'source-unavailable');
  assert.equal(result.resolvedIdentity, null); assert.equal(result.manifestResolvedIdentity, null);
  assert.equal(result.image, null); assert.equal(calls.length, 1);
  assert.equal(result.requestedIdentity.agModelCode, '72HH'); assert.equal(result.requestedIdentity.selectedOptions.length, 47);
  assert.match(presentBmwLiveImage(result).message, /does not independently establish/);
});

test('a caller supplied identity or upstream invented identity fields cannot bypass independent proof', async () => {
  const { provider, calls } = fixture({ resolveConfiguration: undefined, transport: async (input) => {
    calls.push(input); return { status: 200, contentType: 'application/json', body: JSON.stringify({ ...manifest(), configuration: request(), resolvedIdentity: request() }) };
  } });
  const result = await provider.resolve({ ...request(), resolvedIdentity: request(), identityVerified: true });
  assert.equal(result.failure.code, 'identity-unverified'); assert.equal(calls.length, 1);
});

test('wrong model, paint, options or any resolved date is rejected before combining manifest assets', async () => {
  for (const changed of [{ modelCode: 'T3SK' }, { agModelCode: '22FY' },
    { selectedOptions: request().selectedOptions.map((code) => code === 'P0300' ? 'P0475' : code) },
    { selectedOptions: [...request().selectedOptions, 'S03AC'] },
    ...['catalogueDate', 'orderDate', 'effectDate', 'productionDate', 'taxDate'].map((key) => ({ [key]: '2027-02-05' }))]) {
    const { provider, calls } = fixture({ resolveConfiguration: async () => ({ ...proof(), identity: { ...request(), ...changed } }) });
    const result = await provider.resolve(request()); assert.equal(result.status, 'identity-mismatch');
    assert.equal(result.image, null); assert.notDeepEqual(result.resolvedIdentity, result.requestedIdentity); assert.equal(calls.length, 1);
  }
});

test('incomplete or invalid independent evidence stays unverified, with unknown attribute fidelity', async () => {
  for (const value of [null, {}, { ...proof(), basis: 'request-echo' }, { ...proof(), observedDate: '2026-02-30' },
    { ...proof(), identity: { ...request(), selectionComplete: false } }]) {
    const { provider } = fixture({ resolveConfiguration: async () => value });
    assert.equal((await provider.resolve(request())).failure.code, 'identity-unverified');
  }
  const { provider } = fixture({ resolveConfiguration: async () => ({ ...proof(), fidelity: {} }) });
  const result = await provider.resolve(request()); assert.equal(result.status, 'ok');
  assert.ok(Object.values(result.image.fidelity).every((state) => state === 'unknown'));
});

test('unsupported viewport, named view and size remain explicit without resize or substitute crop', async () => {
  for (const changed of [{ viewport: 'mobile' }, { namedImage: 'Wheel' }, { viewpoint: 'HEROREAR' },
    { size: { width: 1280, height: 1152 } }, { distinctions: { BKGND: 'sandnight' } }]) {
    const { provider, calls } = fixture(); const result = await provider.resolve({ ...request(), ...changed });
    assert.equal(result.status, 'unsupported'); assert.equal(result.image, null); assert.equal(calls.length, 1);
  }
});

test('malformed dimensions, missing images, duplicate matches and inconsistent records fail unavailable', async () => {
  const cases = [null, {}, { [COLLECTION]: { desktop: {} } }];
  const wrongDimensions = manifest(); wrongDimensions[COLLECTION].desktop.metaData.width = '2560'; cases.push(wrongDimensions);
  const noImages = manifest(); noImages[COLLECTION].desktop.namedImages[0].images = []; cases.push(noImages);
  const duplicate = manifest(); duplicate[COLLECTION].desktop.namedImages[0].images.push(structuredClone(record(duplicate))); cases.push(duplicate);
  const missingPOV = manifest(); delete record(missingPOV).distinctionParameters.POV; cases.push(missingPOV);
  for (const data of cases) {
    const { provider } = fixture({ transport: async () => ({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }) });
    assert.equal((await provider.resolve(request())).failure.code, 'manifest-unavailable');
  }
});

test('only registered exact HTTPS origin and cosySec path are accepted; opaque query bytes stay unchanged', async () => {
  for (const value of ['http://prod.cosy.bmw.cloud/connext-bmw/cosySec?x=1',
    'https://evil.example/connext-bmw/cosySec', `${ORIGIN}.evil.example/connext-bmw/cosySec`,
    `${ORIGIN}/other?url=${URL_ASSET}`, `${ORIGIN}/connext-bmw/cosySec/other`,
    'https://user:secret@prod.cosy.bmw.cloud/connext-bmw/cosySec', `${URL_ASSET}#fragment`, `${URL_ASSET}\n`]) {
    let called = 0; const data = manifest(); record(data).viewImage = value;
    const { provider } = fixture({ transport: async () => { called += 1; return { status: 200, contentType: 'application/json', body: JSON.stringify(data) }; } });
    assert.equal((await provider.resolve(request())).failure.code, 'manifest-unavailable'); assert.equal(called, 1);
    assert.equal((await provider.readAsset(value)).status, 'source-unavailable'); assert.equal(called, 1);
  }
});

test('asset content type, encoded dimensions, signatures, byte caps and redirects are validated', async () => {
  const wrongSize = Buffer.from(bytes); wrongSize.writeUInt16LE(1280, 26);
  const extendedOnly = Buffer.alloc(30); extendedOnly.write('RIFF'); extendedOnly.writeUInt32LE(22, 4);
  extendedOnly.write('WEBPVP8X', 8); extendedOnly.writeUInt32LE(10, 16);
  extendedOnly.writeUIntLE(2559, 24, 3); extendedOnly.writeUIntLE(1645, 27, 3);
  const responses = [{ status: 200, contentType: 'text/html', body: '<html>private error</html>' },
    { status: 200, contentType: 'image/webp', body: wrongSize }, { status: 200, contentType: 'image/webp', body: Buffer.alloc(64) },
    { status: 200, contentType: 'image/webp', body: extendedOnly },
    { status: 200, contentType: 'image/webp', body: Buffer.alloc(2097153) },
    { status: 302, contentType: 'image/webp', body: bytes },
    { status: 200, contentType: 'image/webp', body: bytes, redirected: true },
    { status: 200, contentType: 'image/webp', body: bytes, url: 'https://evil.example/asset' }];
  for (const asset of responses) {
    const { provider } = fixture({ transport: async ({ url }) => url === URL_ASSET ? asset
      : { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()) } });
    const result = await provider.resolve(request()); assert.equal(result.failure.code, 'asset-unavailable');
    assert.equal(result.image, null); assert.ok(!JSON.stringify(result).includes('private error'));
  }
});

test('malformed display projections cannot publish arbitrary fidelity or image roles', async () => {
  const { provider } = fixture(); const original = await provider.resolve(request());
  for (const change of [{ role: 'exact-stock-photo' }, { fidelity: { ...original.image.fidelity, model: 'https://private.example/secret' } },
    { fidelity: { ...original.image.fidelity, equipment: 'verified' } }, { matchesRequestedConfiguration: false }]) {
    const shown = presentBmwLiveImage({ ...original, image: { ...original.image, ...change } });
    assert.equal(shown.status, 'source-unavailable'); assert.equal(shown.assetId, null);
    assert.ok(!JSON.stringify(shown).includes('private.example'));
  }
});

test('oversized, non-JSON, HTTP and malformed manifest failures remain explicit and sanitized', async () => {
  for (const response of [{ status: 200, contentType: 'text/html', body: '<html>upstream secret</html>' },
    { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()), redirected: true },
    { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()), url: 'https://private.example/redirect' },
    { status: 200, contentType: 'application/json', body: '{broken' },
    { status: 200, contentType: 'application/json', body: ' '.repeat(1048577) }]) {
    let calls = 0; const { provider } = fixture({ transport: async () => { calls += 1; return response; } });
    const result = await provider.resolve(request()); assert.equal(result.failure.code, 'manifest-unavailable');
    assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes('upstream secret'));
  }
});

test('default construction, missing source selection and missing credentials invoke no outbound transport', async (t) => {
  let outbound = 0; const denied = () => { outbound += 1; throw Error('unexpected network'); };
  t.mock.method(globalThis, 'fetch', denied);
  for (const transport of [http, https]) for (const method of ['get', 'request']) t.mock.method(transport, method, denied);
  const { createBmwLiveImageryProvider: start } = await import('../vehicle-evidence/bmw-live-imagery.js?offline-startup');
  for (const config of [{}, { environment: 'gcsp-demo', sourceProfile: 'arbitrary', transport: denied },
    { environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator', transport: denied },
    { environment: 'gcsp-demo', sourceProfile: 'bmw-uk-public-configurator', transport: denied, getCredential: async () => '' }]) {
    assert.equal((await start(config).resolve(request())).status, 'source-unavailable');
  }
  assert.equal((await createBmwImageAdapter({ environment: 'gcsp-demo' }).resolve(request())).status, 'ok');
  assert.equal(outbound, 0);
});

test('invalid requests and wrong market are refused, caller URLs never become proxy targets', async () => {
  const bad = [{ selectionComplete: false }, { selectedOptions: [] }, { selectedOptions: ['P0300', 'P0300'] },
    { effectDate: '2026-02-30' }, { viewport: 'arbitrary' }, { namedImage: '' }, { distinctions: { url: 'http://evil' } },
    { size: { width: -1, height: 1646 } }];
  for (const changed of bad) { const { provider, calls } = fixture(); assert.equal((await provider.resolve({ ...request(), ...changed })).status, 'invalid-input'); assert.equal(calls.length, 0); }
  const { provider, calls } = fixture(); assert.equal((await provider.resolve({ ...request(), market: 'US' })).status, 'unsupported'); assert.equal(calls.length, 0);
  assert.equal((await provider.resolve({ ...request(), url: 'https://evil.example', assetUrl: 'https://evil.example' })).status, 'ok');
  assert.ok(calls.every(({ url }) => new URL(url).origin === ORIGIN));
});

test('transport and identity failures never expose a key, raw error, HTML or private URL, or discard specs', async () => {
  const secret = 'SECRET-VALUE https://private.example/vin/PRIVATE <html>raw upstream</html>';
  for (const config of [{ getCredential: async () => { throw Error(secret); } },
    { transport: async () => { throw Error(secret); } }, { resolveConfiguration: async () => { throw Error(secret); } }]) {
    const { provider } = fixture(config); const result = await provider.resolve(request());
    assert.equal(result.status, 'source-unavailable'); assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(presentBmwLiveImage(result)).includes('private.example'));
    const facts = { seats: { state: 'known', value: 5, unit: 'count' } };
    assert.deepEqual(mergeBmwCatalogueFacts(facts, result), facts);
  }
  const catalogue = await createBmwCatalogueAdapter().resolve(request()); assert.ok(['ok', 'partial'].includes(catalogue.status));
});

test('bounded deadline cancels stalled credentials, manifest, independent proof and asset without retry', async () => {
  const never = () => new Promise(() => {});
  for (const stage of ['credentials', 'manifest', 'proof', 'asset']) {
    let count = 0; let signal;
    const { provider } = fixture({ timeoutMs: 15,
      getCredential: stage === 'credentials' ? never : async () => 'offline-fixture-credential',
      resolveConfiguration: stage === 'proof' ? never : async () => proof(),
      transport: async (input) => { count += 1; signal = input.signal;
        if (stage === 'manifest' || stage === 'asset' && input.url === URL_ASSET) return never();
        return { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()) }; } });
    const result = await provider.resolve(request()); assert.equal(result.failure.code, 'timeout');
    assert.ok(count <= 2); if (signal) assert.equal(signal.aborted, true);
  }
});

test('source evidence cannot mutate the canonical requested configuration', async () => {
  const { provider } = fixture({ resolveConfiguration: async ({ requestedIdentity }) => {
    requestedIdentity.selectedOptions.push('S03AC'); return proof();
  } });
  const result = await provider.resolve(request()); assert.equal(result.status, 'ok'); assert.equal(result.requestedIdentity.selectedOptions.length, 47);
});

test('one live operation per provider is admitted and disposal aborts its owned transport', async () => {
  let signal; let started;
  const inTransport = new Promise((resolve) => { started = resolve; });
  const { provider } = fixture({ timeoutMs: 15, transport: async (input) => { signal = input.signal; started(); return new Promise(() => {}); } });
  const first = provider.resolve(request()); await inTransport;
  assert.equal((await provider.resolve(request())).failure.code, 'source-busy');
  provider.dispose(); assert.equal(signal.aborted, true);
  assert.equal((await first).failure.code, 'timeout');
});

test('every resolution revalidates; delivery handles cannot revive earlier bytes or refresh an old handle', async () => {
  const { provider, calls } = fixture();
  const first = await provider.resolve(request());
  const second = await provider.resolve(request());
  assert.equal(calls.length, 4); assert.notEqual(first.image.assetId, second.image.assetId);
  assert.equal((await provider.readAsset(first.image.assetId)).status, 'source-unavailable');
  assert.deepEqual((await provider.readAsset(second.image.assetId)).bytes, bytes);
  assert.equal((await provider.readAsset(second.image.assetId)).failure.code, 'asset-unavailable');
  assert.equal(calls.length, 4);
  provider.dispose();
});

test('local single-read handoff expires using the fake clock without inventing upstream expiry', async () => {
  let now = new Date('2026-11-05T12:00:00Z');
  const { provider, calls } = fixture({ clock: () => now });
  const result = await provider.resolve(request());
  assert.deepEqual(result.freshness, { status: 'unknown', policy: 'revalidate-every-resolution', upstreamExpiresAt: null,
    retrievedAt: '2026-11-05T12:00:00.000Z', handoffExpiresAt: '2026-11-05T12:00:15.000Z', delivery: 'single-read' });
  const shown = presentBmwLiveImage(result); assert.match(shown.caption, /freshness unknown/);
  assert.equal(shown.freshness.upstreamExpiresAt, null);
  now = new Date('2026-11-05T12:00:15Z');
  const expired = await provider.readAsset(result.image.assetId);
  assert.equal(expired.failure.code, 'asset-expired'); assert.equal(expired.image, null);
  assert.match(presentBmwLiveImage(expired).message, /Resolve the image again/);
  assert.equal(calls.length, 2); provider.dispose();
});

test('invalid or backward clocks cannot extend custody; read bytes are isolated from retained metadata', async () => {
  for (const invalid of [new Date('invalid'), new Date('2026-11-05T11:59:59Z')]) {
    let now = new Date('2026-11-05T12:00:00Z');
    const { provider } = fixture({ clock: () => now }); const result = await provider.resolve(request());
    now = invalid; assert.equal((await provider.readAsset(result.image.assetId)).failure.code, 'asset-expired'); provider.dispose();
  }
  const { provider } = fixture(); const result = await provider.resolve(request());
  result.freshness.policy = 'caller-invented-TTL'; result.image.fidelity.paint = 'unknown';
  const delivery = await provider.readAsset(result.image.assetId);
  assert.equal(delivery.freshness.policy, 'revalidate-every-resolution'); assert.equal(delivery.image.fidelity.paint, 'verified');
  provider.dispose();
});

test('401 and 403 stop after one request, expose no upstream body and never suggest automatic auth retry', async () => {
  for (const status of [401, 403]) for (const stage of ['manifest', 'asset']) {
    let count = 0;
    const { provider } = fixture({ transport: async ({ url, retries }) => {
      count += 1; assert.equal(retries, 0);
      if (stage === 'manifest' || url === URL_ASSET) return { status, contentType: 'application/json', body: 'PRIVATE https://private.example/vin' };
      return { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()) };
    } });
    const result = await provider.resolve(request());
    assert.equal(result.failure.code, 'access-denied'); assert.equal(result.failure.retryable, false);
    assert.equal(count, stage === 'manifest' ? 1 : 2); assert.equal(result.fallback, null);
    assert.ok(!JSON.stringify(result).includes('PRIVATE')); provider.dispose();
  }
});

test('429 retry hints are bounded safe data with zero retries; 5xx and thrown failures are finite', async () => {
  for (const retryAfter of ['30', '0', '3601', '99999', 'https://private.example/secret', 'Wed, 05 Nov 2026 12:01:00 GMT',
    'Thu, 05 Nov 2026 12:01:00 GMT', 'Thu, 05 Nov 2026 14:01:00 GMT']) {
    let count = 0; const { provider } = fixture({ transport: async () => {
      count += 1; return { status: 429, retryAfter, contentType: 'text/plain', body: 'private upstream failure' };
    } });
    const result = await provider.resolve(request());
    assert.equal(result.failure.code, 'rate-limited'); assert.equal(count, 1);
    assert.equal(result.failure.retryAfterSeconds, ['30', '0'].includes(retryAfter) ? Number(retryAfter)
      : retryAfter === 'Thu, 05 Nov 2026 12:01:00 GMT' ? 60 : null);
    assert.ok(!JSON.stringify(result).includes('private.example')); provider.dispose();
  }
  for (const status of [500, 502, 503, 504]) {
    let count = 0; const { provider } = fixture({ transport: async () => {
      count += 1; return { status, contentType: 'text/html', body: '<html>secret upstream</html>' };
    } });
    const result = await provider.resolve(request()); assert.equal(result.failure.code, 'manifest-unavailable');
    assert.equal(count, 1); assert.equal(result.image, null); provider.dispose();
  }
});

test('a failed new resolution invalidates its earlier delivery instead of silently using stale bytes', async () => {
  let count = 0;
  const { provider } = fixture({ transport: async ({ url }) => {
    count += 1;
    if (count > 2) return { status: 410, contentType: 'text/plain', body: 'expired private URL' };
    return url === URL_ASSET ? { status: 200, contentType: 'image/webp', body: bytes }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()) };
  } });
  const first = await provider.resolve(request()); const failure = await provider.resolve(request());
  assert.equal(failure.image, null); assert.equal(failure.fallback, null); assert.equal(count, 3);
  assert.equal((await provider.readAsset(first.image.assetId)).status, 'source-unavailable'); provider.dispose();
});

test('expired or broken source assets never trigger retries or a snapshot switch', async () => {
  for (const status of [403, 404, 410, 429, 500]) {
    let count = 0; const { provider } = fixture({ transport: async ({ url }) => {
      count += 1; return url === URL_ASSET ? { status, retryAfter: '10', contentType: 'text/plain', body: 'private URL expired' }
        : { status: 200, contentType: 'application/json', body: JSON.stringify(manifest()) };
    } });
    const result = await provider.resolve(request()); assert.equal(result.status, 'source-unavailable');
    assert.equal(result.image, null); assert.equal(result.fallback, null); assert.equal(count, 2); provider.dispose();
  }
});

test('C14 snapshot selection is explicit and preserves its own source, dates, role and unknown fidelity', async () => {
  const result = await selectBmwImageSnapshot(request(), { environment: 'gcsp-demo', assetId: source.assets[0].assetId });
  assert.equal(result.status, 'ok'); assert.equal(result.provider, 'bmw-image-snapshot');
  assert.equal(result.sourceKind, 'dated-snapshot'); assert.equal(result.observedDate, '2026-11-01');
  assert.equal(result.retrievedDate, '2026-11-01'); assert.equal(result.selection.kind, 'explicit-snapshot');
  const shown = presentBmwLiveImage(result); assert.equal(shown.label, 'Snapshot image');
  assert.equal(shown.source, 'BMW COSY catalogue render'); assert.equal(shown.sourceKind, 'dated-snapshot');
  assert.equal(shown.freshness.status, 'dated-snapshot'); assert.match(shown.caption, /Dated snapshot selected/);
  for (const key of ['wheels', 'interior', 'equipment', 'exactVehicle']) assert.equal(shown.fidelity[key], 'unknown');
  assert.equal(presentBmwLiveImage(await createBmwImageAdapter({ environment: 'gcsp-demo' }).resolve(request())).status, 'source-unavailable');
});

test('no snapshot is selected implicitly; wrong model, paint or explicitly mismatched C14 asset stays unavailable', async () => {
  for (const [changed, assetId] of [[{}, undefined], [{ modelCode: 'T3SK' }, source.assets[0].assetId],
    [{ selectedOptions: request().selectedOptions.map((code) => code === 'P0300' ? 'P0475' : code) }, source.assets[0].assetId],
    [{}, 'bmw-i5-generic-20261101-v1'], [{}, source.assets[1].assetId]]) {
    const result = await selectBmwImageSnapshot({ ...request(), ...changed }, { environment: 'gcsp-demo', assetId });
    assert.equal(result.status, 'unsupported'); assert.equal(result.image, null);
    assert.equal(presentBmwLiveImage(result).label, 'Image unavailable');
    const facts = { seats: { state: 'known', value: 5, unit: 'count' } };
    assert.deepEqual(mergeBmwCatalogueFacts(facts, result), facts);
  }
});

test('freshness and snapshot presentation fields cannot publish private data from malformed envelopes', async () => {
  const secret = 'https://private.example/token/SECRET';
  const result = await selectBmwImageSnapshot(request(), { environment: 'gcsp-demo', assetId: source.assets[0].assetId });
  for (const field of ['observedDate', 'retrievedDate']) {
    const shown = presentBmwLiveImage({ ...result, [field]: secret });
    assert.equal(shown.assetId, null); assert.ok(!JSON.stringify(shown).includes(secret));
  }
  const { provider } = fixture(); const live = await provider.resolve(request());
  const shown = presentBmwLiveImage({ ...live, freshness: { ...live.freshness, upstreamExpiresAt: secret } });
  assert.equal(shown.assetId, null); assert.ok(!JSON.stringify(shown).includes(secret)); provider.dispose();
});

function harnessFetch({ change = () => {}, onCall = () => {} } = {}) {
  return async (url, options) => {
    onCall(url, options);
    if (url === SETTINGS) return new Response(JSON.stringify({ APP: { backend: { settingsCosy: {
      url: ORIGIN, headers: { 'x-api-key': 'OFFLINE-SETTINGS-KEY' } } } } }), { headers: { 'content-type': 'application/json' } });
    if (url === URL_ASSET) return new Response(bytes, { headers: { 'content-type': 'image/webp' } });
    const data = manifest(); change(data);
    return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
  };
}
const boundedInput = (url = SETTINGS) => ({ url, method: 'GET', headers: { Accept: 'application/json' },
  credentials: 'omit', cache: 'no-store', redirect: 'error', retries: 0, maxResponseBytes: 1048576 });

test('opt-in harness composes the real provider with trusted C14 contexts and safe published bytes', async () => {
  const calls = []; let retained = [];
  const report = await verifyLiveImagery({ fetchImpl: harnessFetch({ onCall: (url, options) => calls.push({ url, options }) }),
    clock: () => new Date('2026-11-05T12:00:00Z'), onAsset: async (asset) => retained.push(asset),
    deliver: async (assets) => { assert.deepEqual(assets, retained); return { status: 'passed', synthetic: true }; } });
  assert.equal(report.status, 'technical-pass-visual-inspection-pending'); assert.equal(calls.length, 5);
  assert.deepEqual(report.budget.requests.map(({ kind }) => kind), ['settings', 'manifest', 'asset', 'manifest', 'asset']);
  assert.equal(report.budget.imageCount, 2); assert.equal(report.liveCatalogueRequests, 0);
  assert.deepEqual(report.images.map(({ file }) => file), ['i5-p0300-herofront.webp', 'i5-p0475-herofront.webp']);
  const [white, black] = report.images.map(({ configuration }) => structuredClone(configuration));
  white.selectedOptions = white.selectedOptions.filter((code) => code !== 'P0300');
  black.selectedOptions = black.selectedOptions.filter((code) => code !== 'P0475'); assert.deepEqual(white, black);
  for (const image of report.images) {
    assert.equal(image.image.sha256, source.assets[0].sha256); assert.equal(image.manifestIdentityEchoed, false);
    assert.equal(image.image.size.width, 2560); assert.equal(image.image.size.height, 1646);
    assert.ok(Object.values(image.image.fidelity).every((value) => value === 'unknown'));
    assert.match(image.presentation.caption, /Current source freshness unknown/);
  }
  assert.equal(report.visualInspection, 'pending'); assert.equal(report.paintVariation, 'pending-actual-visual-inspection');
  assert.equal(report.catalogue.facts.seats.value, 5);
  const retainedText = JSON.stringify(report) + publishedAssetPage();
  for (const privateText of ['OFFLINE-SETTINGS-KEY', URL_ASSET, 'opaque=', 'settingsCosy', 'x-api-key']) assert.ok(!retainedText.includes(privateText));
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    if (url === URL_ASSET) assert.equal(options.headers['x-api-key'], undefined);
  }
});

test('harness-local ordinary image route serves original bytes with restrictive CSP and no BMW browser dependency', async () => {
  const delivery = await provePublishedDelivery([{ file: 'i5-p0300-herofront.webp', bytes }, { file: 'i5-p0475-herofront.webp', bytes }]);
  assert.equal(delivery.status, 'passed'); assert.equal(delivery.browserBmwCredentials, false);
  assert.equal(delivery.browserOpaqueSourceUrls, false); assert.equal(delivery.productionIntegration, false);
  assert.equal(delivery.browserInspection.status, 'pending'); assert.ok(!Object.hasOwn(delivery, 'browserRequests'));
  assert.match(delivery.csp, /img-src 'self'/); assert.match(delivery.csp, /default-src 'none'/);
  const page = publishedAssetPage(); assert.ok(!/<script|onload=|https:|cosySec|x-api-key/.test(page));
  assert.equal((page.match(/<img /g) || []).length, 2);
});

test('optional inspector receives the live harness route and only approved inspection fields are retained', async () => {
  let invoked = false;
  const delivery = await provePublishedDelivery([{ file: 'i5-p0300-herofront.webp', bytes }, { file: 'i5-p0475-herofront.webp', bytes }], {
    inspect: async ({ origin, page, images }) => {
      invoked = true; assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/); assert.equal(page, '/index.html');
      assert.deepEqual(images, ['/i5-p0300-herofront.webp', '/i5-p0475-herofront.webp']);
      assert.equal((await fetch(origin + page)).status, 200);
      return { status: 'passed', decodedImages: 2, externalRequests: 0, cspViolations: 0, privateDebug: 'SECRET' };
    },
  });
  assert.equal(invoked, true); assert.equal(delivery.browserInspection.status, 'passed');
  assert.ok(!JSON.stringify(delivery).includes('SECRET'));
});

test('known snapshot inputs are complete and vary only paint without implicit live catalogue lookup', async () => {
  const { requests, contexts, catalogue } = await loadVerificationContext();
  assert.equal(requests.length, 2); assert.equal(catalogue.sourceKind, 'dated-snapshot');
  for (const [index, context] of contexts.entries()) {
    assert.equal(context.status, 'ok'); assert.equal(context.sourceKind, 'dated-snapshot');
    assert.deepEqual(context.resolvedIdentity.selectedOptions, [...requests[index].selectedOptions].sort());
  }
});

test('harness source, schema, authentication and image failures stop without retries and preserve specs', async () => {
  const cases = [
    { fetch: async () => new Response('private HTML and URL', { status: 403 }), count: 1, failure: 'access-denied' },
    { fetch: async () => new Response('private malformed settings', { headers: { 'content-type': 'application/json' } }), count: 1, failure: 'settings-invalid' },
    { fetch: harnessFetch({ change: (data) => { record(data).viewImage = 'https://private.example/SECRET'; } }), count: 2, failure: 'image-unavailable' },
    { fetch: harnessFetch({ change: (data) => { data[COLLECTION].desktop.metaData.width = 100; } }), count: 2, failure: 'image-unavailable' },
  ];
  for (const scenario of cases) {
    let calls = 0; const report = await verifyLiveImagery({ fetchImpl: (...args) => { calls += 1; return scenario.fetch(...args); },
      deliver: async () => assert.fail('failed image must not publish') });
    assert.equal(report.status, 'failed'); assert.equal(report.failure, scenario.failure); assert.equal(calls, scenario.count);
    assert.equal(report.catalogue.facts.seats.value, 5); assert.equal(report.images.length, 0);
    assert.ok(!/private|SECRET|HTML/.test(JSON.stringify(report)));
  }
});

test('shared native transport fixes safety policy, refuses redirects and raw errors, and latches failures', async () => {
  for (const [response, code] of [[new Response('', { status: 302 }), 'redirect-refused'],
    [new Response('', { status: 401 }), 'access-denied'], [new Response('', { status: 429 }), 'http-failure'],
    [new Response('private HTML', { headers: { 'content-type': 'text/html' } }), 'content-type']]) {
    let calls = 0; const transport = createBoundedTransport({ fetchImpl: async () => { calls += 1; return response; } });
    await assert.rejects(transport.get(boundedInput()), { message: code });
    await assert.rejects(transport.get(boundedInput()), { message: code }); assert.equal(calls, 1);
    assert.ok(!JSON.stringify(transport.state()).includes('private'));
  }
  for (const changed of [{ url: 'https://evil.example' }, { method: 'POST' }, { retries: 1 }, { credentials: 'include' },
    { cache: 'default' }, { redirect: 'follow' }, { maxResponseBytes: 1048577 }, { headers: { Cookie: 'PRIVATE' } }]) {
    const transport = createBoundedTransport({ fetchImpl: async () => assert.fail('invalid policy cannot fetch') });
    await assert.rejects(transport.get({ ...boundedInput(), ...changed }), { message: 'source-invalid' });
  }
});

test('transport enforces aggregate GET, image and streamed byte limits without retry', async () => {
  const json = () => new Response('{}', { headers: { 'content-type': 'application/json' } });
  const transport = createBoundedTransport({ fetchImpl: async () => json() });
  for (let index = 0; index < LIMITS.requests; index += 1) await transport.get(boundedInput());
  await assert.rejects(transport.get(boundedInput()), { message: 'budget-exhausted' }); assert.equal(transport.state().requestCount, 8);
  const image = createBoundedTransport({ fetchImpl: async () => new Response(bytes, { headers: { 'content-type': 'image/webp' } }) });
  for (let index = 0; index < 2; index += 1) await image.get({ ...boundedInput(URL_ASSET), maxResponseBytes: 2097152 });
  await assert.rejects(image.get({ ...boundedInput(URL_ASSET), maxResponseBytes: 2097152 }), { message: 'budget-exhausted' });
  const cap = createBoundedTransport({ fetchImpl: async () => new Response(Buffer.alloc(12), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(cap.get({ ...boundedInput(), maxResponseBytes: 10 }), { message: 'response-byte-cap' }); assert.equal(cap.state().bytes, 12);
  const aggregate = createBoundedTransport({ fetchImpl: async () => new Response(Buffer.alloc(1048576), { headers: { 'content-type': 'application/json' } }) });
  for (let index = 0; index < 6; index += 1) await aggregate.get(boundedInput());
  await assert.rejects(aggregate.get(boundedInput()), { message: 'budget-exhausted' }); assert.equal(aggregate.state().bytes, LIMITS.bytes);
});

test('transport total deadline and cancellation stop further work; concurrency cannot widen the grant', async () => {
  let time = 0; let calls = 0;
  const expired = createBoundedTransport({ now: () => time, fetchImpl: async () => { calls += 1; assert.fail('expired'); } });
  time = LIMITS.totalMs; await assert.rejects(expired.get(boundedInput()), { message: 'budget-exhausted' }); assert.equal(calls, 0);
  let release; const pending = createBoundedTransport({ fetchImpl: async () => new Promise((done) => { release = done; }) });
  const first = pending.get(boundedInput()); await assert.rejects(pending.get(boundedInput()), { message: 'source-busy' });
  release(new Response('{}', { headers: { 'content-type': 'application/json' } })); await first;
  await assert.rejects(pending.get(boundedInput()), { message: 'source-busy' }); assert.equal(pending.state().requestCount, 1);
  const controller = new AbortController(); controller.abort();
  const cancelled = createBoundedTransport({ fetchImpl: async (_, options) => { assert.equal(options.signal.aborted, true); throw Error('raw SECRET'); } });
  await assert.rejects(cancelled.get({ ...boundedInput(), signal: controller.signal }), { message: 'request-timeout' });
  assert.ok(!JSON.stringify(cancelled.state()).includes('SECRET'));
});

test('per-request deadline aborts even an uncooperative fetch and latches a safe timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal; const transport = createBoundedTransport({ fetchImpl: async (_, options) => {
    signal = options.signal; return new Promise(() => {});
  } });
  const pending = transport.get(boundedInput());
  const rejected = assert.rejects(pending, { message: 'request-timeout' });
  t.mock.timers.tick(LIMITS.requestMs); await rejected;
  assert.equal(signal.aborted, true); assert.equal(transport.state().requestCount, 1);
  await assert.rejects(transport.get(boundedInput()), { message: 'request-timeout' });
});

test('a second-paint failure keeps the first permitted artifact and valid facts without claiming variation', async () => {
  let count = 0; const fixtureFetch = harnessFetch();
  const report = await verifyLiveImagery({ fetchImpl: async (...args) => {
    count += 1; return count === 4 ? new Response('PRIVATE', { status: 403 }) : fixtureFetch(...args);
  }, deliver: async () => assert.fail('no route success after failure') });
  assert.equal(report.status, 'failed'); assert.equal(report.images.length, 1); assert.equal(count, 4);
  assert.equal(report.failure, 'access-denied'); assert.equal(report.catalogue.facts.seats.value, 5);
  assert.equal(report.paintVariation, 'pending-actual-visual-inspection'); assert.equal(report.delivery, null);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
});

test('CLI needs explicit live/output and exclusive attempt ledger refuses reruns', async () => {
  let printed = ''; assert.equal(await runCli({ argv: [], fetchImpl: () => assert.fail('no implicit live'), write: (line) => { printed += line; } }), 2);
  assert.match(printed, /--live \[--output/);
  assert.equal(parseCliArguments(['--live']), new URL('../../docs/gcsp/evidence/fucq51/native-v1-assets', import.meta.url).pathname);
  assert.equal(parseCliArguments(['--live', '--output', '/tmp/new-imagery-proof']), '/tmp/new-imagery-proof');
  for (const argv of [[], ['--output', '/tmp/proof'], ['--live', '--retries', '1'], ['--live', '--output', '']]) assert.equal(parseCliArguments(argv), null);
  const directory = await mkdtemp(join(tmpdir(), 'fucq51-ledger-'));
  try {
    const path = join(directory, 'attempt.json'); await reserveAttempt(path, directory);
    await assert.rejects(reserveAttempt(path, directory), { code: 'EEXIST' });
    const ledger = JSON.parse(await readFile(path, 'utf8')); assert.deepEqual(ledger.limits, LIMITS);
    assert.equal(ledger.reviewRequiredBeforeAnotherAttempt, true);
  } finally { await rm(directory, { recursive: true }); }
});
