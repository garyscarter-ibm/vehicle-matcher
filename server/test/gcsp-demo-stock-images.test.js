// FUCQ-323: every supported demo car carries a verified model/body representative image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { modelDisplayImage } from '../gcsp/vehicle-evidence/display-images.js';
import { APPROVED_CORPUS_IMAGES, publishedCorpusImage } from '../gcsp/vehicle-evidence/registered-corpus-images.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { createOfferAccessService } from '../gcsp/offers/access.js';
import { mintOfferToken, verifyOfferToken } from '../gcsp/offers/offer-token.js';
import { stock as candidateStock, brief, fact } from './helpers/employee-recommendation.js';

const asset = (image) => `/${image.asset}`;
const byKey = (cars, key) => cars.filter((car) => car.facts.facts.eligibilityModelKey.value === key);

async function demoCars() {
  const provider = createDemoStockProvider({ policy: createPolicyService() });
  const out = await provider.pull({ runId: 'demo-stock-images', asOf: '2026-11-06T12:00:00.000Z', policyVersion: 'gcsp-policy-v1',
    released: [], releaseSize: 10, queuedSupply: [] });
  assert.equal(out.status, 'ok'); return out.value.stock;
}

test('released cars carry verified model imagery without inventing a caption or colour', async () => {
  const cars = await demoCars();
  for (const car of cars) {
    const { display } = car.facts; const image = await modelDisplayImage(car.facts.facts.eligibilityModelKey.value);
    assert.ok(image); assert.equal(display.photo, `/${image.asset}`);
    assert.deepEqual(display.images, [{ src: display.photo, alt: display.name, fidelity: 'representative-model',
      sourceRef: `display-image:${image.imageId}, observed ${image.observedDate}` }]);
    assert.equal(display.caption, undefined); assert.equal(display.colour, undefined);
  }
});

test('saloon and touring always carry a picture of their own model and body', async () => {
  const cars = await demoCars();
  for (const key of ['G20 Saloon|320i', 'G21 Touring|320i']) {
    const found = byKey(cars, key); assert.ok(found.length > 0, key);
    for (const car of found) {
      assert.match(car.facts.display.photo ?? '', /^\/assets\/gcsp-vehicle-evidence\/[0-9a-f]{64}\.webp$/);
      assert.equal(car.facts.display.images.length, 1);
      assert.equal(car.facts.display.images[0].src, car.facts.display.photo);
      assert.equal(car.facts.display.images[0].fidelity, 'representative-model');
    }
  }
});

test('every demo car carries model and derivative', async () => {
  const cars = await demoCars(); assert.ok(cars.length >= 4);
  for (const car of cars) for (const key of ['model', 'derivative']) assert.ok(car.facts.display[key]?.trim(), `${car.facts.display.name} ${key}`);
});

test('the sourced representatives identify the correct generation and body for all four structural lines', async () => {
  const sources = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/display-images.sources.json', import.meta.url)));
  for (const [key, generation] of [['G20 Saloon|320i', 'G20'], ['G21 Touring|320i', 'G21'], ['G61 i5|i5 40', 'G61'], ['F70 Sports Hatch|120', 'F70']]) {
    const image = await modelDisplayImage(key);
    const source = sources.configurations.find(row => row.image.asset === image.asset);
    if (generation === 'G20') assert.equal(sources.g20.evidence.model, 'G20');
    else if (source.evidence.model) assert.equal(source.evidence.model, generation);
    else assert.equal(generation, 'G61');
  }
});

test('a digest or length mismatch, unknown id or loader fault gives null, never an image', async () => {
  const good = await publishedCorpusImage('bmw-i5-white-20261101-v1');
  assert.deepEqual(good, { imageId: 'bmw-i5-white-20261101-v1', src: asset(APPROVED_CORPUS_IMAGES[0]), fidelity: 'representative-configuration', observedDate: '2026-11-01' });
  const bytes = (image, size) => Buffer.alloc(size, 7);
  assert.equal(await publishedCorpusImage('bmw-i5-white-20261101-v1', { loadPublishedAsset: async (image, size) => bytes(image, size) }), null);
  assert.equal(await publishedCorpusImage('bmw-i5-white-20261101-v1', { loadPublishedAsset: async () => Buffer.alloc(3) }), null);
  assert.equal(await publishedCorpusImage('bmw-i5-white-20261101-v1', { loadPublishedAsset: async () => null }), null);
  assert.equal(await publishedCorpusImage('bmw-1f7e-20261107-v2', { loadPublishedAsset: async () => { throw new Error('disk'); } }), null);
  assert.equal(await publishedCorpusImage('not-registered'), null);
  assert.equal(await publishedCorpusImage(undefined), null);
});

// Offer access over a real pinned decision whose snapshot display is the demo car's own.
async function exchangeWithDisplay(display) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  const policy = createPolicyService(); const wall = '2026-11-05T12:00:00.000Z';
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'demo-stock-images', environmentKind: 'synthetic',
    policyAsOf: wall, commandId: 'bootstrap', sessionNow: () => wall });
  assert.equal(runtime.status, 'ok'); const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter'); assert.equal(presenter.status, 'ok');
  const employee = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula'); assert.equal(employee.status, 'ok');
  const context = employee.value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  const initial = await clock.now(context);
  assert.equal((await clock.advance(presenter.value.context, { commandId: 'midday', expectedClockVersion: initial.value.clockVersion,
    bySeconds: (Date.parse(wall) - Date.parse(initial.value.now)) / 1000 })).status, 'ok');
  const now = (await clock.now(context)).value; const candidate = candidateStock(987);
  const recommendation = createEmployeeRecommendationService({ policy, time: clock, provider: { async resolve() {
    return { status: 'ok', value: { runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
      factsVersion: 'employee-facts-v1', stockVersion: 'stock-v1', employeeFacts: { driverEligible: fact(true), essentials: {}, charging: fact('home'),
        requiredBy: fact('2026-12-01T00:00:00.000Z') }, stock: [candidate] } };
  } } });
  const evaluated = await recommendation.recommend(context, brief()); assert.equal(evaluated.status, 'ok');
  const decision = structuredClone(evaluated.value.decisions[0]); decision.snapshot.display = structuredClone(display);
  const binding = { environmentId: context.environmentId, runId: context.runId, offerId: 'offer-one' };
  const token = mintOfferToken(binding); const rawToken = new URLSearchParams(token.offerLink.split('#')[1]).get('token');
  const duration = await policy.getAssumption('hold.buddy.durationSeconds', { runId: binding.runId, asOf: now.now, policyVersion: context.policyVersion });
  const expiresAt = new Date(Date.parse(now.now) + duration.value.value * 1000).toISOString();
  const cmd = { commandId: 'offer-fixture', inputDigest: inputDigest('offer-fixture') };
  const seeded = await repository.transaction(context, cmd, async (tx) => {
    const rows = [
      ['stock', { orderUuid: candidate.orderUuid, orderNumber: '0999987', configurationId: candidate.configurationId, state: 'held', available: false, held: true }],
      ['quotes', { quoteId: 'quote-one', orderUuid: candidate.orderUuid, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
        configurationId: candidate.configurationId, facts: decision.snapshot, eligibility: { decision }, terms: decision.terms, allowance: decision.terms.allowanceInputs,
        briefVersion: 1, policyVersion: context.policyVersion, quotedAt: now.now, validUntil: decision.terms.validUntil }],
      ['holds', { holdId: 'hold-one', orderUuid: candidate.orderUuid, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
        type: 'buddy-offer', state: 'active', quoteId: 'quote-one', policyVersion: context.policyVersion, expiresAt }],
      ['offers', { ...binding, holdId: 'hold-one', quoteId: 'quote-one', orderUuid: candidate.orderUuid, employeeId: context.employeeId, state: 'active',
        briefVersion: 1, policyVersion: context.policyVersion, expiresAt, tokenHash: token.tokenHash, tokenMetadata: token.tokenMetadata }],
    ];
    for (const [table, row] of rows) { const inserted = await tx.insert(table, { runId: binding.runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    return { status: 'ok', value: { seeded: true } };
  });
  assert.equal(seeded.status, 'ok');
  const service = createOfferAccessService({ repository, policy, clock, identity, environmentId: binding.environmentId, sessionNow: () => wall, verifyOfferToken });
  const access = await service.exchange({ runId: binding.runId, offerId: binding.offerId, token: rawToken });
  assert.equal(access.status, 'ok', JSON.stringify(access)); return access.value.offer.quote.facts.display;
}

test('offer access preserves both i5 and saloon pictures', async () => {
  const cars = await demoCars();
  const i5 = byKey(cars, 'G61 i5|i5 40')[0].facts.display; const saloon = byKey(cars, 'G20 Saloon|320i')[0].facts.display;
  const shownI5 = await exchangeWithDisplay(i5);
  assert.equal(shownI5.photo, i5.photo); assert.deepEqual(shownI5.images, i5.images);
  assert.equal(shownI5.model, 'i5 Touring'); assert.equal(shownI5.derivative, 'eDrive40');
  const shownSaloon = await exchangeWithDisplay(saloon);
  assert.equal(shownSaloon.photo, saloon.photo); assert.deepEqual(shownSaloon.images, saloon.images);
  assert.equal(shownSaloon.model, '3 Series Saloon');
});
