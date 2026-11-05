import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { bmwLiveImageLookupIdentity, createBmwLiveImageryProvider, presentBmwLiveImage } from '../vehicle-evidence/bmw-live-imagery.js';
import { createBmwImageAdapter } from '../vehicle-evidence/bmw-image-adapter.js';
import { createBmwCatalogueAdapter, mergeBmwCatalogueFacts } from '../vehicle-evidence/bmw-catalogue-adapter.js';

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
  for (const changed of [{ agModelCode: '22FY' }, { modelCode: 'T3SK' }, { effectDate: '2027-02-05' },
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
  for (const response of [{ status: 401, contentType: 'application/json', body: '{"message":"upstream secret"}' },
    { status: 200, contentType: 'text/html', body: '<html>upstream secret</html>' },
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
