// FUCQ-250: demo stock carries digest-checked approved images where the line has one, else the honest placeholder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { APPROVED_CORPUS_IMAGES, publishedCorpusImage } from '../gcsp/vehicle-evidence/registered-corpus-images.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { createOfferAccessService } from '../gcsp/offers/access.js';
import { mintOfferToken, verifyOfferToken } from '../gcsp/offers/offer-token.js';
import { stock as candidateStock, brief, fact } from './helpers/employee-recommendation.js';

const plan = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/demo-plan.json', import.meta.url), 'utf8'));
const asset = (image) => `/${image.asset}`;
const byKey = (cars, key) => cars.filter((car) => car.facts.facts.eligibilityModelKey.value === key);

async function demoCars() {
  const provider = createDemoStockProvider({ policy: createPolicyService() });
  const out = await provider.pull({ runId: 'demo-stock-images', asOf: '2026-11-06T12:00:00.000Z', policyVersion: 'gcsp-policy-v1',
    released: [], releaseSize: 10, queuedSupply: [] });
  assert.equal(out.status, 'ok'); return out.value.stock;
}

test('released i5 and hatch cars carry their approved image, with no caption or colour', async () => {
  const cars = await demoCars();
  for (const [key, image] of [['G61 i5|i5 40', APPROVED_CORPUS_IMAGES[0]], ['F70 Sports Hatch|120', APPROVED_CORPUS_IMAGES[1]]]) {
    const found = byKey(cars, key); assert.ok(found.length > 0, key);
    for (const car of found) {
      const { display } = car.facts;
      assert.match(display.photo, /^\/assets\/gcsp-vehicle-evidence\/[0-9a-f]{64}\.webp$/);
      assert.equal(display.photo, asset(image));
      assert.deepEqual(display.images, [{ src: asset(image), alt: `${display.name}: representative image`, fidelity: 'representative-configuration',
        sourceRef: `registered-corpus-image:${image.imageId}, observed ${image.observedDate}` }]);
      assert.equal(display.caption, undefined); assert.equal(display.colour, undefined);
      assert.ok(!display.images[0].sourceRef.includes('—') && !display.images[0].alt.includes('—'));
    }
  }
});

test('saloon and touring have no approved image, so they keep the placeholder', async () => {
  const cars = await demoCars();
  for (const key of ['G20 Saloon|320i', 'G21 Touring|320i']) {
    const found = byKey(cars, key); assert.ok(found.length > 0, key);
    for (const car of found) { assert.equal(car.facts.display.photo, undefined); assert.ok(!car.facts.display.images?.length); }
  }
});

test('every demo car carries model and derivative', async () => {
  const cars = await demoCars(); assert.ok(cars.length >= 4);
  for (const car of cars) for (const key of ['model', 'derivative']) assert.ok(car.facts.display[key]?.trim(), `${car.facts.display.name} ${key}`);
});

test('each image belongs to a code of the car\'s own model line in demo-plan.json', async () => {
  const cars = await demoCars();
  for (const car of cars.filter((row) => row.facts.display.images?.length)) {
    const [model, engine] = car.facts.facts.eligibilityModelKey.value.split('|');
    const line = plan.modelLines.find((row) => row.model === model && row.engine === engine); assert.ok(line, model);
    const codes = [line.mapping.vgModelCode, ...(line.mapping.additionalModels ?? []).map((row) => row.vgModelCode)];
    const imageId = /^registered-corpus-image:([^,]+),/.exec(car.facts.display.images[0].sourceRef)[1];
    const image = APPROVED_CORPUS_IMAGES.find((row) => row.imageId === imageId);
    const code = Buffer.from(image.configurationId, 'base64').toString().split(':')[0];
    assert.ok(codes.includes(code), `${imageId}: ${code} not in ${codes}`);
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

test('offer access exposes the i5 image and the saloon placeholder', async () => {
  const cars = await demoCars();
  const i5 = byKey(cars, 'G61 i5|i5 40')[0].facts.display; const saloon = byKey(cars, 'G20 Saloon|320i')[0].facts.display;
  const shownI5 = await exchangeWithDisplay(i5);
  assert.equal(shownI5.photo, i5.photo); assert.deepEqual(shownI5.images, i5.images);
  assert.equal(shownI5.model, 'i5 Touring'); assert.equal(shownI5.derivative, 'eDrive40');
  const shownSaloon = await exchangeWithDisplay(saloon);
  assert.equal(shownSaloon.photo, null); assert.deepEqual(shownSaloon.images, []);
  assert.equal(shownSaloon.model, '3 Series Saloon');
});
