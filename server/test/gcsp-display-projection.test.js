import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withVehicleDisplayImages } from '../gcsp/vehicle-evidence/display-projection.js';
import { configurationIdDisplayImage, modelDisplayImage, primaryDisplayImageSource, readDisplayImageCatalogue } from '../gcsp/vehicle-evidence/display-images.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { createOfferAccessHandler } from '../gcsp/offers/access-http.js';
import { createOfferDecisionHandler } from '../gcsp/offers/decision-http.js';
import { inputDigest } from '../gcsp/repository/core.js';

const configurationId = 'Q01QRzIxOlJFRlBBSU5ULFJFRlRSSU0=';
const stockId = 'saved-order-1';
const snapshot = () => ({ identityKind: 'exact-stock', sourceKeys: { stockId }, snapshotVersion: 'saved-v1',
  display: { name: 'BMW 3 Series 320i M Sport Touring' }, facts: { eligibilityModelKey: { status: 'known', value: 'G21 Touring|320i',
    provenance: { sourceRef: 'unchanged-policy', assurance: 'synthetic-scenario' } } } });
const saved = () => ({ orderUuid: stockId, configurationId, facts: snapshot() });
const image = (value) => assert.match(value.display.photo ?? '', /^\/api\/gcsp\/vehicle-images\/bmw-display-[a-f0-9]{20}\.webp$/);
const source = { mode: 'synthetic', sourceRef: 'fixture:manual-records-v1', sourceVersion: 'manual-records-v1' };

test('saved stock, selected quotes and orders gain display images without changing their authoritative data', async () => {
  const selected = saved();
  const claimInput = { commandId: 'original-command', expectedStockVersion: 4, termsDigest: 'original-digest', snapshot: snapshot() };
  const eligibility = { decision: { orderUuid: stockId, configurationId, snapshot: snapshot(), versions: { stock: 'original' } } };
  const terms = { points: { value: 1100 }, provenance: { version: 'pinned-policy-v1' } };
  const original = { status: 'ok', value: { decisions: [{ orderUuid: stockId, configurationId, snapshot: snapshot(), claimInput }],
    quote: { ...selected, quoteId: 'saved-quote', version: 2, eligibility, terms },
    selection: { stock: selected, quote: { ...selected, eligibility, terms }, source: claimInput },
    pendingOperation: { payload: { stock: selected } } } };
  const originalBytes = JSON.stringify(original); const originalDigest = inputDigest(original);
  const output = await withVehicleDisplayImages(original);
  image(output.value.decisions[0].snapshot); image(output.value.quote.facts); image(output.value.selection.stock.facts);
  assert.equal(JSON.stringify(output.value.decisions[0].claimInput), JSON.stringify(claimInput));
  assert.equal(JSON.stringify(output.value.quote.terms), JSON.stringify(terms));
  assert.equal(JSON.stringify(output.value.quote.eligibility), JSON.stringify(eligibility));
  assert.deepEqual(output.value.selection.source, claimInput);
  assert.deepEqual(output.value.pendingOperation, original.value.pendingOperation);
  assert.equal(output.value.quote.version, 2); assert.equal(output.value.quote.quoteId, 'saved-quote');
  assert.deepEqual(output.value.quote.facts.facts, original.value.quote.facts.facts);
  assert.equal(JSON.stringify(original), originalBytes); assert.equal(inputDigest(original), originalDigest);
});

test('only the known seeded current contract and correctly bound public snapshots receive a fallback', async () => {
  const current = { contractId: 'current:employee-paula', model: 'BMW 3 Series Touring 320i', status: 'current', source };
  const unknown = { ...current, source: { ...source, sourceRef: 'authorised-other-source' } };
  const mismatched = { ...saved(), orderUuid: 'another-order' };
  const hasPhoto = saved(); hasPhoto.facts.display.photo = '/existing-picture.webp';
  const output = await withVehicleDisplayImages({ status: 'ok', value: { currentContract: current,
    contracts: [unknown], cars: [mismatched, hasPhoto], quote: { ...saved(), claimInput: { stock: saved() } } } });
  assert.match(output.value.currentContract.media.src, /^\/api\/gcsp\/vehicle-images\//);
  assert.equal(output.value.contracts[0].media, undefined);
  assert.equal(output.value.cars[0].facts.display.photo, undefined);
  assert.equal(output.value.cars[1].facts.display.photo, '/existing-picture.webp');
  assert.deepEqual(output.value.quote.claimInput, { stock: saved() });
  assert.equal(current.media, undefined);
});

test('existing reviewed public pictures use live routes while private snapshots and unsupported pictures remain pinned', async () => {
  const touring = await modelDisplayImage('G21 Touring|320i'); const saloon = await modelDisplayImage('G20 Saloon|320i');
  const local = `/${touring.asset}`; const staticOnly = `/${saloon.asset}`;
  const selected = saved(); selected.facts.display.photo = local;
  selected.facts.display.images = [{ src: local, alt: 'Saved representative picture', fidelity: 'representative-model' },
    { src: staticOnly, alt: 'Other reviewed static picture' }];
  const pinned = { stock: structuredClone(selected), media: { src: local } };
  const original = { status: 'pending', value: { quote: { ...selected, eligibility: pinned, terms: pinned, claimInput: pinned },
    oldContract: { contractId: 'saved-contract', media: { src: local, caption: 'Saved caption' } },
    source: pinned, pendingOperation: { payload: pinned } } };
  const before = JSON.stringify(original); const output = await withVehicleDisplayImages(original);
  const expected = `/api/gcsp/vehicle-images/${touring.imageId}.webp`;
  assert.equal(output.value.quote.facts.display.photo, expected);
  assert.equal(output.value.quote.facts.display.images[0].src, expected);
  assert.equal(output.value.quote.facts.display.images[0].alt, 'Saved representative picture');
  assert.equal(output.value.quote.facts.display.images[1].src, staticOnly);
  assert.equal(output.value.oldContract.media.src, expected); assert.equal(output.value.oldContract.media.caption, 'Saved caption');
  for (const key of ['eligibility', 'terms', 'claimInput']) assert.deepEqual(output.value.quote[key], pinned);
  assert.deepEqual(output.value.source, pinned); assert.deepEqual(output.value.pendingOperation, original.value.pendingOperation);
  assert.equal(JSON.stringify(original), before);
});

test('only pinned live-supported local catalogue sources become public routes and catalogue readers receive independent copies', async () => {
  const data = await readDisplayImageCatalogue(); const touring = data.models['G21 Touring|320i'];
  const saloon = data.models['G20 Saloon|320i']; const src = `/${touring.asset}`;
  assert.equal(await primaryDisplayImageSource(src), `/api/gcsp/vehicle-images/${touring.imageId}.webp`);
  assert.equal(await primaryDisplayImageSource(`/${saloon.asset}`), `/${saloon.asset}`);
  for (const untouched of [touring.asset, `${src}?replacement=1`, `https://example.test${src}`,
    '/assets/gcsp-vehicle-evidence/' + 'f'.repeat(64) + '.webp', '/legacy-photo.jpg', null]) {
    assert.equal(await primaryDisplayImageSource(untouched), untouched);
  }
  data.models['G21 Touring|320i'].asset = 'changed'; data.liveImageIds.length = 0;
  assert.equal((await readDisplayImageCatalogue()).models['G21 Touring|320i'].asset, src.slice(1));
  assert.equal(await primaryDisplayImageSource(src), `/api/gcsp/vehicle-images/${touring.imageId}.webp`);
});

test('shared display, image and contract media objects cannot mutate excluded authoritative branches', async () => {
  const touring = await modelDisplayImage('G21 Touring|320i'); const src = `/${touring.asset}`;
  const selected = saved(); const sharedImage = { src, fidelity: 'representative-model', alt: 'Pinned picture' };
  const sharedDisplay = { name: selected.facts.display.name, photo: src, images: [sharedImage] };
  const sharedMedia = { src, caption: 'Pinned current car' };
  selected.facts.display = sharedDisplay;
  const original = { status: 'ok', value: { cars: [selected], oldContract: { media: sharedMedia },
    source: { display: sharedDisplay, image: sharedImage, media: sharedMedia, stock: selected,
      omitted: undefined, observedAt: new Date('2026-11-10T12:00:00.000Z') } } };
  const pinned = structuredClone(original.value.source); const before = JSON.stringify(original);
  const output = await withVehicleDisplayImages(original);
  image(output.value.cars[0].facts);
  assert.equal(output.value.cars[0].facts.display.images[0].src, `/api/gcsp/vehicle-images/${touring.imageId}.webp`);
  assert.equal(output.value.oldContract.media.src, `/api/gcsp/vehicle-images/${touring.imageId}.webp`);
  assert.deepEqual(output.value.source, pinned); assert.equal(Object.hasOwn(output.value.source, 'omitted'), true);
  assert.ok(output.value.source.observedAt instanceof Date); assert.equal(JSON.stringify(original), before);
});

test('public configuration signatures use pinned assets and reject unknown, noncanonical and mismatched generations', async () => {
  const data = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/display-images.v1.json', import.meta.url)));
  const id = data.configurations[0].configurationId;
  const exact = await configurationIdDisplayImage(id); assert.ok(exact); assert.equal(exact.fidelity, 'representative-configuration');
  const [vg, codes] = Buffer.from(id, 'base64').toString('utf8').split(':');
  const variant = Buffer.from(`${vg}:${[...codes.split(','), 'SZZZZ'].sort().join(',')}`).toString('base64');
  const representative = await configurationIdDisplayImage(variant);
  assert.ok(representative); assert.equal(representative.fidelity, 'representative-model');
  assert.equal(await configurationIdDisplayImage(variant, 'G20 Saloon|320i'), null);
  assert.equal(await configurationIdDisplayImage(Buffer.from(`UNKNOWN:${codes}`).toString('base64')), null);
  assert.equal(await configurationIdDisplayImage(id.replace(/=+$/, '')), null);
  assert.equal(await configurationIdDisplayImage(id, null, { loadAsset: async () => { throw Error('missing'); } }), null);
});

const context = { principalId: 'employee-paula', runId: 'saved-run', environmentId: 'saved-env', roles: ['employee'] };
const response = () => ({ setHeader() {}, writeHead() {}, end() {} });
const request = (method = 'GET') => ({ method, headers: { origin: 'http://localhost' }, async *[Symbol.asyncIterator]() {} });
const captured = () => { let sent; return { sendJson(_res, code, value) { sent = { code, value }; }, get: () => sent }; };

test('authenticated normal and offer HTTP responses enrich persisted snapshots after service validation', async () => {
  const stored = { status: 'ok', value: { quote: saved() } }; const before = JSON.stringify(stored);
  const identity = { resolveSession: async () => ({ status: 'ok', value: context }), requireRole: async () => ({ status: 'ok' }) };
  const normal = createGcspHandler({ identity, allowedOrigins: ['http://localhost'], routes: [
    { method: 'GET', path: '/api/gcsp/manual/order', role: 'employee', handle: async () => stored },
  ] });
  const normalCapture = captured();
  await normal({ req: request(), res: response(), pathname: '/api/gcsp/manual/order', searchParams: new URLSearchParams(), sendJson: normalCapture.sendJson });
  assert.equal(normalCapture.get().code, 200); image(normalCapture.get().value.value.quote.facts);
  const offer = createOfferAccessHandler({ identity, allowedOrigins: ['http://localhost'], service: {
    fromAccount: async () => ({ status: 'ok', value: { offer: stored.value } }),
  } });
  const offerCapture = captured();
  await offer({ req: request(), res: response(), pathname: '/api/gcsp/offers/saved-offer', searchParams: new URLSearchParams(), sendJson: offerCapture.sendJson });
  assert.equal(offerCapture.get().code, 200); image(offerCapture.get().value.value.quote.facts);
  const decision = createOfferDecisionHandler({ allowedOrigins: ['http://localhost'], resolveAccess: async () => ({ status: 'ok', value: { context } }),
    service: { readReasons: async () => stored } });
  const decisionCapture = captured();
  await decision({ req: request(), res: response(), pathname: '/api/gcsp/offers/saved-offer/decision-reasons',
    searchParams: new URLSearchParams({ runId: context.runId }), sendJson: decisionCapture.sendJson, gateAuthorized: true });
  assert.equal(decisionCapture.get().code, 200); image(decisionCapture.get().value.value.quote.facts);
  assert.equal(JSON.stringify(stored), before);
});

test('FUCQ-373: image disclaimers stored before the rule are stripped from the public copy only', async () => {
  const media = () => ({ src: '/assets/brand-hero/bmw.jpg', alt: 'BMW 3 Series Touring: representative image', caption: 'Representative image, not your exact car' });
  const stored = { status: 'ok', value: { currentContract: { media: media() }, contracts: [{ media: media() }], histories: [{ entries: [{ media: media() }] }],
    stock: [{ display: { images: [{ src: '/assets/brand-hero/bmw.jpg', alt: 'BMW', caption: 'BMW brand image, not this exact car' },
      { src: '/assets/brand-hero/bmw.jpg', alt: 'BMW', caption: 'Front three-quarter view' }] } }] } };
  const before = structuredClone(stored); const shown = await withVehicleDisplayImages(stored);
  const json = JSON.stringify(shown.value);
  assert.doesNotMatch(json, /representative|not (this|your) exact car/i);
  assert.equal(shown.value.currentContract.media.alt, 'BMW 3 Series Touring');
  assert.equal(shown.value.stock[0].display.images[1].caption, 'Front three-quarter view');
  assert.deepEqual(stored, before);
});
