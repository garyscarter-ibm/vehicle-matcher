import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualOrderService, createManualOrderConversion } from '../gcsp/manual-order/index.js';
import { ManualReviewDetailsService } from '../gcsp/manual-review/index.js';
import { createSyntheticOrderingAdapter } from '../gcsp/adapters/synthetic-ordering.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { stock, fact } from './helpers/employee-recommendation.js';
import { createManualClaimsService } from '../gcsp/manual-claims/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { createSyntheticManualStockAdapter } from '../gcsp/adapters/manual-stock.js';

const instant = '2026-11-05T09:00:00.000Z';
const cmd = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });
const ref = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
const details = (patch = {}) => ({ contact: { phone: '01632 960001', email: 'chooser@example.invalid' },
  expectedReturnMileage: 6700, specialRequirements: 'Ground floor collection', ...patch });

// Same real claims, review and ordering services as FUCQ-71, with a review-details service wired in.
async function setup({ wired = true } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store, now: () => instant });
  assert.equal((await repository.open()).status, 'ok');
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const metadata = { unit: 'versioned synthetic ordering contract', status: 'assumed', basis: 'Explicit test-only policy inputs.',
    source: 'server/test/gcsp-manual-order-freeze.test.js', sourceDate: '2026-11-05', policyVersion: seed.policyVersion, effectiveFrom: seed.effectiveFrom };
  const terms = seed.assumptions.find((row) => row.key === 'ordering.terms.v1').value;
  seed.assumptions = seed.assumptions.filter((row) => !['ordering.terms.v1', 'ordering.approvalStages.v1'].includes(row.key));
  seed.assumptions.push({ ...metadata, key: 'ordering.terms.v1', value: terms },
    { ...metadata, key: 'ordering.approvalStages.v1', value: ['HR approval', 'sales-manager approval', 'sent to ordering'] });
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const demo = await createDemoRuntime({ repository, policy, environmentId: 'manual-order-freeze', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(demo.status, 'ok', JSON.stringify(demo));
  const { clock, identity } = demo.value;
  const presenter = (await identity.createPresenterSession('presenter')).value;
  const f = { store, repository, policy, clock, identity, context: (await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula')).value.context };
  await seedManualDemoContext(f);
  f.manual = new ManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  f.claims = createManualClaimsService({ ...f, adapter: createSyntheticManualStockAdapter() });
  assert.equal((await f.claims.registerClockHandler()).status, 'ok');
  const account = await f.manual.readAccount(f.context);
  const choices = { mode: 'replacement', oldContractId: `current:${f.context.employeeId}`, slotId: f.context.entitlementSlotId,
    schemeId: f.context.schemeId, driverId: `driver:${f.context.employeeId}`, contractOptionId: 'six-month-8000', requestedCollectionDate: '2026-11-20',
    collectionLocationId: 'demo-collection-centre', brand: 'bmw', contact: { phone: '01632 960001', email: 'chooser@example.invalid' },
    expectedReturnMileage: 6700, specialRequirements: '' };
  assert.equal((await f.manual.saveDraft(f.context, { commandId: 'draft', expectedDraftVersion: 0, expectedContextVersion: account.value.contextVersion, choices })).status, 'ok');
  const car = stock(11, { insuranceGroup: fact(25, 'insurance-group') });
  await f.repository.transaction(f.context, cmd('car'), (tx) => tx.insert('stock', { runId: f.context.runId, orderUuid: car.orderUuid,
    orderNumber: '7654321', configurationId: car.configurationId, facts: car.snapshot, state: 'released', available: true, held: false, allocated: false,
    visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null }, release: { availability: { ...car.availability, availableFrom: instant } } }));
  const browse = await f.claims.browseStock(f.context);
  assert.equal((await f.claims.claim(f.context, { commandId: 'claim', ...browse.value.cars[0].claimInput })).status, 'ok');
  const held = (await f.claims.readClaim(f.context)).value;
  const reviewed = await f.claims.beginReview(f.context, { commandId: 'review', holdId: held.hold.holdId, expectedHoldVersion: held.hold.version, expectedDraftVersion: 1 });
  assert.equal(reviewed.status, 'ok', JSON.stringify(reviewed));
  f.review = new ManualReviewDetailsService({ ...f, manualClaims: f.claims });
  f.service = new ManualOrderService({ ...f, ...(wired ? { reviewDetails: f.review } : {}), converters: { cart: createManualOrderConversion(f) },
    adapter: createSyntheticOrderingAdapter(f) });
  assert.equal((await f.service.registerClockHandler()).status, 'ok');
  const termsRead = await f.service.readTerms(f.context);
  f.hold = reviewed.value.hold; f.quote = reviewed.value.quote;
  f.input = async (extra = {}) => ({ commandId: 'submit', source: { type: 'cart', holdId: f.hold.holdId, expectedHoldVersion: f.hold.version, expectedDraftVersion: 1 },
    expectedQuoteId: f.quote.quoteId, expectedStockVersion: (await f.repository.read(f.context, ref(f, 'stock', { orderUuid: f.hold.orderUuid }))).value.version,
    termsDigest: termsRead.value.termsDigest, declarations: { terms: true, driver: true, return: true }, ...extra });
  f.save = (version, patch = {}, commandId = `save-${version}`) => f.review.saveReviewDetails(f.context, { commandId, holdId: f.hold.holdId,
    quoteId: f.quote.quoteId, expectedHoldVersion: f.hold.version, expectedDraftVersion: 1, expectedReviewDetailsVersion: version, details: details(patch) });
  return f;
}
const operations = async (f) => (await f.repository.query(f.context, 'pending_operations', { operationType: 'selection-order' })).value;
const frozenReceipts = async (f) => (await f.repository.query(f.context, 'event_receipts', { eventId: 'selection' })).value;

test('cart submit with the current version freezes the saved details and locks the review', async () => {
  const f = await setup(); assert.equal((await f.save(0)).status, 'ok');
  const read = await f.review.readReviewDetails(f.context);
  assert.equal(read.value.reviewDetailsVersion, 1); 
  const row = await f.repository.read(f.context, ref(f, 'stock', { orderUuid: f.hold.orderUuid }));
  assert.equal(read.value.stockVersion, row.value.version);
  const response = await f.service.submit(f.context, await f.input({ expectedReviewDetailsVersion: 1 }));
  assert.equal(response.status, 'ok', JSON.stringify(response));
  assert.deepEqual(response.value.selection.reviewDetails.details, details());
  assert.deepEqual((await f.service.readOrder(f.context)).value.selection.reviewDetails.details, details());
  const after = await f.review.readReviewDetails(f.context);
  assert.equal(after.status, 'ok', JSON.stringify(after)); assert.equal(after.value.frozen, true); assert.equal(after.value.editable, false);
  assert.notEqual((await f.save(1, { specialRequirements: 'Late edit' }, 'late')).status, 'ok');
});

test('stale version, unsaved details, and an unwired service refuse and store nothing', async () => {
  const g = await setup(); assert.equal((await g.save(0)).status, 'ok');
  const staleInput = await g.input({ expectedReviewDetailsVersion: 1 });
  assert.equal((await g.save(1, { specialRequirements: 'Changed after read' })).status, 'ok');
  const stale = await g.service.submit(g.context, staleInput);
  assert.equal(stale.status, 'stale-version', JSON.stringify(stale));
  assert.equal((await operations(g)).length, 0); assert.equal((await frozenReceipts(g)).length, 0);
  const h = await setup();
  const none = await h.service.submit(h.context, await h.input({ expectedReviewDetailsVersion: 0 }));
  assert.equal(none.status, 'conflict', JSON.stringify(none)); assert.equal(none.reason, 'review-details-not-saved');
  assert.equal((await operations(h)).length, 0); assert.equal((await frozenReceipts(h)).length, 0);
  const w = await setup({ wired: false }); assert.equal((await w.save(0)).status, 'ok');
  const missing = await w.service.submit(w.context, await w.input({ expectedReviewDetailsVersion: 1 }));
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.reason, 'review-details-unavailable'); assert.equal((await operations(w)).length, 0);
});

test('replaying the same submit returns the same order without freezing twice', async () => {
  const f = await setup(); assert.equal((await f.save(0)).status, 'ok');
  const input = await f.input({ expectedReviewDetailsVersion: 1 });
  const first = await f.service.submit(f.context, input); assert.equal(first.status, 'ok');
  assert.deepEqual(await f.service.submit(f.context, input), first);
  assert.deepEqual(await f.service.submit(f.context, { ...input, commandId: 'double-click' }), first);
  assert.equal((await frozenReceipts(f)).length, 1); assert.equal((await operations(f)).length, 1);
});

test('absent version keeps the old behaviour; buddy-offer or a bad version is invalid', async () => {
  const f = await setup();
  const plain = await f.service.submit(f.context, await f.input());
  assert.equal(plain.status, 'ok'); assert.equal(plain.value.selection.reviewDetails, null);
  for (const bad of [-1, 1.5, '1', null]) {
    const g = await setup();
    assert.equal((await g.service.submit(g.context, await g.input({ expectedReviewDetailsVersion: bad }))).status, 'invalid');
  }
  const b = await setup(); const input = await b.input({ expectedReviewDetailsVersion: 0 }); input.source.type = 'buddy-offer';
  assert.equal((await b.service.submit(b.context, input)).status, 'invalid');
  assert.equal((await b.service.submitSource(b.context, input, { converter: { prepare() {}, convertSelection() {} } })).status, 'invalid');
});
