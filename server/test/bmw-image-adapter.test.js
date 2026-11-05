import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { createBmwImageAdapter, bmwImageLookupIdentity, presentBmwImage } from '../vehicle-evidence/bmw-image-adapter.js';
import { bmwCatalogueLookupIdentity, createBmwCatalogueAdapter, mergeBmwCatalogueFacts } from '../vehicle-evidence/bmw-catalogue-adapter.js';

const evidence = new URL('../../docs/gcsp/evidence/fucq-4/', import.meta.url);
const requests = JSON.parse(await readFile(new URL('requests-2026-11-01.json', evidence)));
const observations = JSON.parse(await readFile(new URL('observations-2026-11-01.json', evidence)));
const excerpts = JSON.parse(await readFile(new URL('response-excerpts-2026-11-01.json', evidence)));
const retail = requests.requests.find(({ id }) => id === 'retail-pricing').body;
const manifestUrl = new URL('../vehicle-evidence/snapshots/bmw-gb-i5-images-2026-11-01.v1.json', import.meta.url);
const manifest = async () => JSON.parse(await readFile(manifestUrl));
const enabled = (options = {}) => createBmwImageAdapter({ environment: 'gcsp-demo', ...options });
const request = (paint = 'white') => ({
  market: 'GB', locale: 'en-GB', catalogueDate: '2026-11-01',
  orderDate: '2026-11-01', effectDate: '2027-01-05', productionDate: '2027-01-05', taxDate: '2027-01-05',
  modelCode: 'T5MJ', modelRange: 'G61E', rawModelRange: 'G61', agModelCode: '72HH', trim: 'S0337',
  selectedOptions: [...(paint === 'white' ? retail.configuration.selectedOptions : observations.blackConfiguration.selected)],
  selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }], selectionComplete: true,
  viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 },
});

test('both exact observed source selections resolve distinct local assets with zero outbound', async () => {
  let outbound = 0;
  const adapter = enabled({ transport: () => { outbound += 1; throw Error('unexpected outbound'); } });
  const ids = [];
  for (const [paint, code] of [['white', 'P0300'], ['black', 'P0475']]) {
    const result = await adapter.resolve(request(paint));
    assert.equal(result.status, 'ok');
    assert.equal(result.sourceKind, 'dated-snapshot');
    assert.equal(result.observedDate, '2026-11-01');
    assert.equal(result.retrievedDate, '2026-11-01');
    assert.deepEqual(result.requestedIdentity, result.resolvedIdentity);
    assert.deepEqual(result.resolvedIdentity.selectedOptions, [...request(paint).selectedOptions].sort());
    assert.deepEqual(result.resolvedIdentity.selectedAccessories, request(paint).selectedAccessories);
    assert.equal(result.resolvedIdentity.selectedOptions.length, 47);
    assert.equal(result.image.paint.code, code);
    assert.equal(result.image.role, 'representative-catalogue-render');
    assert.equal(result.image.contentType, 'image/webp');
    assert.deepEqual(result.image.size, request().size);
    assert.equal(result.image.viewpoint, 'HEROFRONT');
    assert.equal(result.image.fidelity.model, 'verified');
    assert.equal(result.image.fidelity.paint, 'verified');
    for (const field of ['wheels', 'interior', 'equipment', 'exactVehicle']) assert.equal(result.image.fidelity[field], 'unknown');
    ids.push(result.image.assetId);
    const bytes = await adapter.readAsset(result.image.assetId);
    assert.equal(bytes.status, 'ok');
    assert.equal(createHash('sha256').update(bytes.bytes).digest('hex'), excerpts.images[paint].sha256);
    assert.equal(bytes.bytes.length, excerpts.images[paint].bytes);
    assert.equal(bytes.bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.bytes.subarray(8, 12).toString(), 'WEBP');
    assert.equal(bytes.bytes.readUInt16LE(26) & 0x3fff, 2560);
    assert.equal(bytes.bytes.readUInt16LE(28) & 0x3fff, 1646);
    assert.deepEqual(bytes.bytes, await readFile(new URL(`i5-${paint === 'white' ? 'alpine-white' : 'black-sapphire'}-reference.webp`, evidence)));
  }
  assert.notEqual(...ids);
  assert.equal(outbound, 0);
});

test('snapshot resolution and byte delivery never enter fetch, HTTP or HTTPS transport', async (t) => {
  let outbound = 0;
  const reject = () => { outbound += 1; throw Error('network forbidden'); };
  t.mock.method(globalThis, 'fetch', reject);
  for (const transport of [http, https]) for (const method of ['get', 'request']) t.mock.method(transport, method, reject);
  // Evaluate module startup as well as calls, with the same network guards installed.
  const { createBmwImageAdapter: startOffline } = await import('../vehicle-evidence/bmw-image-adapter.js?offline-startup');
  const adapter = startOffline({ environment: 'gcsp-demo' });
  for (const paint of ['white', 'black']) {
    const result = await adapter.resolve(request(paint));
    assert.equal(result.status, 'ok');
    assert.deepEqual(await startOffline({ environment: 'gcsp-demo' }).resolve(request(paint)), result);
    assert.deepEqual(await adapter.resolve(request(paint)), result);
    assert.equal((await adapter.readAsset(result.image.assetId)).status, 'ok');
  }
  assert.equal((await startOffline().resolve(request())).failure.code, 'demo-only');
  assert.equal((await adapter.resolve(request(), { provider: 'live-image' })).status, 'unsupported');
  assert.equal(outbound, 0);
});

test('catalogue identity plus view/size forms the provider-versioned lookup identity', () => {
  const input = request();
  const lookup = bmwImageLookupIdentity(input);
  assert.equal(lookup.provider, 'bmw-image-snapshot');
  assert.equal(lookup.snapshotVersion, 'bmw-gb-i5-images-2026-11-01.v1');
  assert.equal(lookup.agModelCode, '72HH');
  assert.deepEqual(lookup.size, input.size);
  input.selectedOptions.reverse();
  assert.deepEqual(bmwImageLookupIdentity(input), lookup);
  const { viewpoint, size, ...catalogue } = lookup;
  assert.deepEqual(catalogue, bmwCatalogueLookupIdentity(request(), {
    provider: lookup.provider, snapshotVersion: lookup.snapshotVersion,
  }));
  const key = JSON.stringify(lookup);
  const alternatives = [
    { market: 'US' }, { locale: 'de-DE' }, { modelCode: 'T3MQ' }, { agModelCode: '22FY' },
    { modelRange: 'G21' }, { rawModelRange: 'G61E' }, { trim: 'S07BL' },
    { catalogueDate: '2026-11-02' }, { orderDate: '2026-11-02' }, { effectDate: '2027-01-06' },
    { productionDate: '2027-01-06' }, { taxDate: '2027-01-06' },
    { selectedOptions: request('black').selectedOptions },
    { selectedOptions: [...request().selectedOptions, 'S03AC'] }, { selectedAccessories: [] },
    { selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 2 }] },
    { viewpoint: 'SIDELEFT' }, { size: { width: 1280, height: 1646 } },
    { size: { width: 2560, height: 1152 } },
  ].map((change) => bmwImageLookupIdentity({ ...request(), ...change }));
  for (const options of [{ provider: 'other-image' }, { providerVersion: '2' }, { schemaVersion: '2' },
    { snapshotVersion: 'bmw-gb-i5-images-2026-11-01.v2' }]) alternatives.push(bmwImageLookupIdentity(request(), options));
  assert.ok(alternatives.every(Boolean));
  assert.equal(new Set([key, ...alternatives.map((identity) => JSON.stringify(identity))]).size, alternatives.length + 1);
  const reordered = { ...request(), selectedOptions: [...request().selectedOptions].reverse(),
    selectedAccessories: [{ quantity: 1, type: 'accessory', code: 'SE000001' }],
    size: { height: 1646, width: 2560 }, userId: 'private-user', privateUrl: 'https://private.invalid' };
  assert.equal(JSON.stringify(bmwImageLookupIdentity(reordered)), key);
  const accessories = [{ code: 'SE000002', type: 'accessory', quantity: 2 }, ...request().selectedAccessories];
  assert.deepEqual(bmwImageLookupIdentity({ ...request(), selectedAccessories: accessories }),
    bmwImageLookupIdentity({ ...request(), selectedAccessories: [...accessories].reverse() }));
  assert.doesNotMatch(key, /private|https?:|userId|vin|credential/i);
});

test('unregistered references and inconsistent image metadata fail before loading any asset', async () => {
  for (const mutate of [
    (data) => { data.assets[0].assetId = 'unregistered-image'; },
    (data) => { data.assets[1].assetId = data.assets[0].assetId; },
    (data) => { data.assets.pop(); },
    (data) => { data.assets[0].contentType = 'image/jpeg'; },
    (data) => { delete data.assets[0].contentType; },
    (data) => { data.assets[0].size = null; },
    (data) => { data.assets[0].size.width = 1280; },
    (data) => { data.assets[0].size.height = '1646'; },
    (data) => { data.assets[0].viewpoint = 'SIDELEFT'; },
    (data) => { data.assets[0].bytes += 1; },
    (data) => { delete data.assets[0].sha256; },
  ]) {
    const data = await manifest(); mutate(data);
    let loads = 0;
    const adapter = enabled({ loadManifest: async () => data, loadAsset: async () => { loads += 1; } });
    for (const result of [await adapter.resolve(request()), await adapter.readAsset('bmw-i5-white-20261101-v1')]) {
      assert.equal(result.status, 'source-unavailable');
      assert.equal(result.image, null);
      assert.equal(presentBmwImage(result).assetId, null);
    }
    assert.equal(loads, 0);
  }
});

test('presentation refuses missing or inconsistent registered type, dimensions and reference metadata', async () => {
  const resolved = await enabled().resolve(request());
  for (const patch of [
    { contentType: undefined }, { contentType: 'image/jpeg' }, { size: null },
    { size: { width: 1280, height: 1646 } }, { size: { width: 2560, height: 1152 } },
    { viewpoint: 'SIDELEFT' }, { bytes: 0 }, { sha256: 'unregistered' }, { assetId: 'unregistered-image' },
  ]) {
    const view = presentBmwImage({ ...resolved, image: { ...resolved.image, ...patch } });
    assert.equal(view.status, 'source-unavailable', JSON.stringify(patch));
    assert.equal(view.assetId, null);
    assert.equal(view.label, 'Image unavailable');
    for (const state of Object.values(view.fidelity)) assert.equal(state, 'unknown');
  }
});

test('delivery requires explicit demo construction and never reads artifacts for other environments', async () => {
  let reads = 0;
  for (const environment of [undefined, 'retail', 'production', 'GCSP-DEMO']) {
    const adapter = createBmwImageAdapter({ environment, loadManifest: async () => { reads += 1; } });
    assert.equal((await adapter.resolve(request())).failure.code, 'demo-only');
    assert.equal((await adapter.readAsset('bmw-i5-white-20261101-v1')).failure.code, 'demo-only');
  }
  assert.equal(reads, 0);
});

test('full identity mismatches never fall back to a matching paint', async () => {
  const adapter = enabled();
  for (const change of [
    { agModelCode: '22FY' }, { modelRange: 'G21' }, { rawModelRange: 'G61E' }, { trim: 'S07BL' },
    { catalogueDate: '2026-11-02' }, { orderDate: '2026-11-02' }, { effectDate: '2027-01-06' },
    { productionDate: '2027-01-06' }, { taxDate: '2027-01-06' },
    { selectedOptions: request().selectedOptions.slice(1) },
    { selectedOptions: [...request().selectedOptions, 'S03AC'] }, { selectedAccessories: [] },
    { selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 2 }] },
  ]) {
    const result = await adapter.resolve({ ...request(), ...change });
    assert.equal(result.status, 'identity-mismatch', JSON.stringify(change));
    assert.equal(result.image, null);
    assert.equal(result.resolvedIdentity.modelCode, 'T5MJ');
  }
});

test('unobserved paint and model, market, version, viewpoint and size are explicit unsupported states', async () => {
  const adapter = enabled();
  for (const change of [
    { market: 'US' }, { locale: 'de-DE' }, { modelCode: 'T3MQ' }, { viewpoint: 'SIDELEFT' },
    { size: { width: 1280, height: 1152 } },
    { selectedOptions: request().selectedOptions.map((code) => code === 'P0300' ? 'P0A96' : code) },
  ]) {
    const result = await adapter.resolve({ ...request(), ...change });
    assert.equal(result.status, 'unsupported');
    assert.equal(result.image, null);
  }
  for (const options of [{ snapshotVersion: 'unregistered' }, { provider: 'live-image' }, { schemaVersion: '2' }]) {
    assert.equal((await adapter.resolve(request(), options)).status, 'unsupported');
  }
});

test('malformed identity, incomplete selections and unsafe selectors are rejected before I/O', async () => {
  let loads = 0;
  const adapter = enabled({ loadManifest: async () => { loads += 1; } });
  for (const input of [null, {}, { ...request(), selectionComplete: false }, { ...request(), effectDate: '2027-02-30' },
    { ...request(), selectedOptions: [...request().selectedOptions, 'P0300'] },
    { ...request(), selectedAccessories: [{ code: 'SE000001', type: 'option', quantity: 1 }] },
    { ...request(), viewpoint: '../../secret' }, { ...request(), size: { width: -1, height: 1646 } },
    { ...request(), size: { width: '2560', height: 1646 } },
  ]) assert.equal((await adapter.resolve(input)).status, 'invalid-input');
  assert.equal((await adapter.resolve(request(), { snapshotVersion: '../../secret' })).status, 'invalid-input');
  assert.equal((await adapter.readAsset('../../secret')).status, 'invalid-input');
  assert.equal(loads, 0);
});

test('missing, malformed and incompatible manifests fail unavailable without leaking exceptions', async () => {
  for (const loadManifest of [
    async () => { throw Object.assign(Error('private upstream key and URL'), { code: 'ENOENT' }); },
    async () => { throw new SyntaxError('private upstream JSON'); }, async () => null,
    async () => ({ ...(await manifest()), schemaVersion: '2' }),
  ]) {
    const result = await enabled({ loadManifest }).resolve(request());
    assert.equal(result.status, 'source-unavailable');
    assert.equal(result.image, null);
    assert.doesNotMatch(JSON.stringify(result), /private|upstream|URL/);
  }
});

test('missing and corrupt registered bytes never produce usable metadata or delivery', async () => {
  for (const loadAsset of [async () => { throw Error('private/file.webp'); }, async () => Buffer.from('not an image'),
    async () => readFile(new URL('i5-black-sapphire-reference.webp', evidence))]) {
    const adapter = enabled({ loadAsset });
    const result = await adapter.resolve(request());
    assert.equal(result.status, 'source-unavailable');
    assert.equal(result.image, null);
    assert.equal((await adapter.readAsset('bmw-i5-white-20261101-v1')).status, 'source-unavailable');
    assert.doesNotMatch(JSON.stringify(result), /private|file.webp/);
  }
  assert.equal((await enabled().readAsset('unregistered-asset')).status, 'unsupported');
});

test('a corrupt manifest cannot establish an unobserved complete option or accessory selection', async () => {
  for (const mutate of [
    (entry) => { entry.identity.selectedOptions[2] = 'S03AC'; },
    (entry) => { entry.identity.selectedAccessories[0].quantity = 2; },
    (entry) => { entry.identity.trim = 'S07BL'; },
  ]) {
    const data = await manifest(); mutate(data.assets[0]);
    const adapter = enabled({ loadManifest: async () => data });
    assert.equal((await adapter.resolve(request())).status, 'source-unavailable');
    assert.equal((await adapter.readAsset(data.assets[0].assetId)).status, 'source-unavailable');
  }
});

test('registered manifest preserves actual independent source selections and the demo decision', async () => {
  const data = await manifest();
  assert.deepEqual(data.assets[0].identity.selectedOptions, retail.configuration.selectedOptions);
  assert.deepEqual(data.assets[1].identity.selectedOptions, observations.blackConfiguration.selected);
  assert.deepEqual(data.assets[0].identity.selectedAccessories, request().selectedAccessories);
  assert.deepEqual(data.assets[1].identity.selectedAccessories, request('black').selectedAccessories);
  assert.equal(data.demoUse.decision.commentId, '132468');
  assert.equal(data.demoUse.decision.by, 'Gary Carter');
  assert.equal(data.demoUse.scope, 'gcsp-demo');
  assert.equal(data.demoUse.retention, 'remove-after-demo');
  assert.equal(Object.hasOwn(data.demoUse, 'expiresAt'), false);
  assert.doesNotMatch(JSON.stringify(data), /https?:|cosySec|x-api-key|vin|garageId/i);
});

test('untrusted manifest extras and request extras are excluded and results are isolated copies', async () => {
  const data = await manifest();
  data.privateUrl = 'https://private.invalid'; data.assets[0].privateUrl = 'private';
  const adapter = enabled({ loadManifest: async () => data });
  const first = await adapter.resolve({ ...request(), privateUrl: 'private', userId: 'private' });
  assert.equal(first.status, 'ok');
  assert.doesNotMatch(JSON.stringify(first), /private|userId|https?:/);
  first.image.fidelity.paint = 'unknown'; first.resolvedIdentity.selectedOptions.pop();
  assert.equal((await adapter.resolve(request())).image.fidelity.paint, 'verified');
  assert.equal((await adapter.resolve(request())).resolvedIdentity.selectedOptions.length, 47);
});

test('presentation carries representative role, source date, observed model/paint and unknown equipment', async () => {
  const result = await enabled().resolve(request());
  const view = presentBmwImage(result);
  assert.match(view.caption, /Representative catalogue render/);
  assert.match(view.caption, /1 November 2026/);
  assert.match(view.caption, /model and paint/);
  assert.match(view.caption, /wheels, interior and equipment.*unknown/i);
  assert.equal(view.assetId, result.image.assetId);
  assert.equal(view.role, 'representative-catalogue-render');
  assert.equal(view.observedDate, '2026-11-01');
  for (const status of ['unsupported', 'source-unavailable', 'identity-mismatch', 'invalid-input']) {
    const failure = presentBmwImage({ ...result, status, failure: { code: 'private' }, image: { assetId: 'private' } });
    assert.equal(failure.assetId, null);
    assert.doesNotMatch(JSON.stringify(failure), /private/);
    assert.ok(failure.message);
  }
});

const fallbackChoice = 'bmw-i5-generic-20261101-v1';

test('generic fallback requires a registered explicit choice and never inherits configuration claims', async () => {
  const adapter = enabled();
  const input = { ...request(), modelCode: 'T3MQ' };
  assert.equal((await adapter.resolve(input)).status, 'unsupported');
  for (const fallback of [true, {}, 'unregistered', 'https://private.invalid/key']) {
    const result = await adapter.resolve(input, { fallback });
    assert.equal(result.status, 'invalid-input');
    assert.equal(result.image, null);
    assert.doesNotMatch(JSON.stringify(result), /private|https?:/);
  }
  const result = await adapter.resolve(input, { fallback: fallbackChoice });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.fallback, { choice: fallbackChoice, originalStatus: 'unsupported',
    reason: { code: 'unsupported-request', message: 'No registered render supports this model, paint, viewpoint, size or version.', retryable: false } });
  assert.equal(result.requestedIdentity.modelCode, 'T3MQ');
  assert.equal(result.resolvedIdentity, null);
  assert.equal(result.resolvedLookupIdentity, null);
  assert.equal(result.image.role, 'representative-catalogue-render');
  assert.equal(result.image.representation, 'generic');
  assert.equal(result.image.paint, null);
  assert.equal(result.image.matchesRequestedConfiguration, false);
  for (const state of Object.values(result.image.fidelity)) assert.equal(state, 'unknown');
  const view = presentBmwImage(result);
  assert.equal(view.isFallback, true);
  assert.equal(view.label, 'Representative image');
  assert.match(view.caption, /configuration match unknown/i);
  assert.doesNotMatch(view.caption, /verified|exact|matches/i);
  assert.equal(view.alt, 'Representative image; configuration match unknown');
  for (const state of Object.values(view.fidelity)) assert.equal(state, 'unknown');
  for (const text of Object.values(view.fidelityLabels)) assert.match(text, /unknown/i);
});

test('fallback is deliberate for date, paint and unavailable asset gaps and never bypasses identity or permission guards', async () => {
  const adapter = enabled();
  for (const patch of [
    { catalogueDate: '2026-11-02' },
    { selectedOptions: request().selectedOptions.map((code) => code === 'P0300' ? 'P0A96' : code) },
  ]) {
    const result = await adapter.resolve({ ...request(), ...patch }, { fallback: fallbackChoice });
    assert.equal(result.status, 'ok');
    assert.equal(result.image.representation, 'generic');
    assert.equal(result.image.fidelity.paint, 'unknown');
    assert.equal(result.resolvedIdentity, null);
  }
  const assetGap = enabled({ loadAsset: async (assetId) => {
    if (assetId.includes('black')) throw Error('<html>private source failure</html>');
    return readFile(new URL('i5-alpine-white-reference.webp', evidence));
  } });
  assert.equal((await assetGap.resolve(request('black'))).status, 'source-unavailable');
  const fallback = await assetGap.resolve(request('black'), { fallback: fallbackChoice });
  assert.equal(fallback.status, 'ok');
  assert.equal(fallback.fallback.originalStatus, 'source-unavailable');
  assert.equal(fallback.image.paint, null);
  assert.doesNotMatch(JSON.stringify(fallback), /private|html/);
  const exact = await adapter.resolve(request(), { fallback: fallbackChoice });
  assert.equal(exact.fallback, null);
  assert.equal(exact.image.representation, 'configuration');
  assert.equal(exact.image.fidelity.model, 'verified');
  for (const options of [{ fallback: fallbackChoice, snapshotVersion: 'unregistered' },
    { fallback: fallbackChoice, provider: 'live-image' }]) {
    assert.equal((await adapter.resolve(request(), options)).status, 'unsupported');
  }
  assert.equal((await adapter.resolve({ ...request(), selectionComplete: false }, { fallback: fallbackChoice })).status, 'invalid-input');
  assert.equal((await createBmwImageAdapter().resolve(request(), { fallback: fallbackChoice })).failure.code, 'demo-only');
  const broken = enabled({ loadAsset: async () => Buffer.from('corrupt') });
  assert.equal((await broken.resolve({ ...request(), modelCode: 'T3MQ' }, { fallback: fallbackChoice })).status, 'source-unavailable');
});

test('catalogue renders cannot impersonate VIN illustrations or exact-car photos and full selections preserve unknowns', async () => {
  const adapter = enabled();
  const exact = await adapter.resolve(request());
  for (const role of ['vin-linked-illustration', 'exact-car-stock-photo']) {
    const result = await adapter.resolve({ ...request(), role }, { fallback: fallbackChoice });
    assert.equal(result.status, 'unsupported');
    assert.equal(result.image, null);
    const data = await manifest(); data.assets[0].role = role;
    assert.equal((await enabled({ loadManifest: async () => data }).resolve(request())).status, 'source-unavailable');
    const view = presentBmwImage({ ...exact, image: { ...exact.image, role } });
    assert.equal(view.assetId, null);
    assert.equal(view.label, 'Image unavailable');
  }
  assert.equal(exact.image.matchesRequestedConfiguration, true);
  for (const key of ['wheels', 'interior', 'equipment', 'exactVehicle']) {
    assert.equal(exact.image.fidelity[key], 'unknown');
    assert.equal(presentBmwImage(exact).fidelity[key], 'unknown');
    assert.match(presentBmwImage(exact).fidelityLabels[key], /unknown/i);
  }
  const forged = structuredClone(exact); forged.image.fidelity.equipment = 'verified';
  assert.equal(presentBmwImage(forged).assetId, null);
});

test('malformed manifest records and missing imagery preserve independent valid specifications with safe display text', async () => {
  const specifications = await createBmwCatalogueAdapter().resolve(request());
  assert.ok(['ok', 'partial'].includes(specifications.status));
  const facts = mergeBmwCatalogueFacts({}, specifications);
  const before = structuredClone(specifications);
  const malformed = [null, {}, [], { assetId: 'bmw-i5-white-20261101-v1' }];
  for (const entry of malformed) {
    const data = await manifest(); data.assets[0] = entry;
    const images = await enabled({ loadManifest: async () => data }).resolve(request());
    assert.equal(images.status, 'source-unavailable');
    const description = { specifications, images: presentBmwImage(images) };
    assert.deepEqual(mergeBmwCatalogueFacts({}, description.specifications), facts);
    assert.equal(description.images.label, 'Image unavailable');
    assert.equal(description.images.alt, null);
    assert.equal(description.images.assetId, null);
    assert.ok(description.images.message);
    assert.equal(description.images.fidelity.equipment, 'unknown');
  }
  for (const image of [await enabled({ loadAsset: async () => { throw Error('<html>https://private.invalid?key=secret</html>'); } }).resolve(request()),
    { status: 'ok', image: { assetId: 'unregistered' }, failure: { code: '<html>secret</html>' } }]) {
    const view = presentBmwImage(image);
    assert.equal(view.assetId, null);
    assert.doesNotMatch(JSON.stringify(view), /<|https?:|private|secret/);
  }
  assert.deepEqual(specifications, before);
});
