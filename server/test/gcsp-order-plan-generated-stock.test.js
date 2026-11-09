// FUCQ-310: Greg's order plan still loads once a generated stock tranche is released, and names the cars it leaves out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createRunStockProviderFactory } from '../gcsp/stock/index.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, presenterTick } from './helpers/gcsp-decline-change-route.js';

const BASE = '/api/gcsp/greg/order-plan';
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const route = (label, out) => { assert.equal(out.status, 200, `${label}: HTTP ${out.status} ${JSON.stringify(out.json)}`);
  assert.equal(out.json.status, 'ok', `${label}: ${JSON.stringify(out.json)}`); return out.json.value; };

// Paula's manual order over the page routes: draft, claim one released generated car, review, submit.
async function paulaOrders(app, client) {
  route('switch to Paula', await client.request('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: 'plan-generated-paula' }));
  const account = route('account', await client.request('/api/gcsp/manual/account'));
  const action = account.actions.find((entry) => entry.enabled);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee');
  const option = account.choices.contractOptions.find((entry) => entry.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  route('draft', await client.request('/api/gcsp/manual/draft', { commandId: 'plan-generated-draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion,
    choices: { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId,
      driverId: driver.driverId, contractOptionId: option.contractOptionId, requestedCollectionDate: '2026-11-30', collectionLocationId: location.locationId,
      brand: account.choices.brands[0], contact: account.account.contact, expectedReturnMileage: account.currentContract?.currentOdometer?.value ?? null,
      specialRequirements: '' } }));
  // The stock page is over the test client's 1 MiB bound with a whole tranche released, so read it in process.
  const context = good(await app.services.identity.resolveSession({ authorized: true, cookie: client.cookie() }));
  const decision = good(await app.services.manualRead.browseStock(context)).decisions.find((row) => row.gateStatus === 'eligible' && row.claimInput);
  assert.ok(decision, 'Paula can claim a released generated car');
  const claim = route('claim', await client.request('/api/gcsp/manual/claim', { commandId: 'plan-generated-claim', ...decision.claimInput }));
  route('review', await client.request('/api/gcsp/manual/claim/review', { commandId: 'plan-generated-review', holdId: claim.hold.holdId,
    expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion }));
  const details = route('review details', await client.request('/api/gcsp/manual/review-details'));
  route('save details', await client.request('/api/gcsp/manual/review-details', { commandId: 'plan-generated-details', holdId: details.binding.holdId,
    quoteId: details.binding.quoteId, expectedHoldVersion: details.binding.expectedHoldVersion, expectedDraftVersion: details.binding.expectedDraftVersion,
    expectedReviewDetailsVersion: 0, details: details.details }));
  const terms = route('terms', await client.request('/api/gcsp/manual/order/terms'));
  const hold = route('claim read', await client.request('/api/gcsp/manual/claim'));
  const declarations = Object.fromEntries(terms.declarations.filter((row) => row.appliesTo === 'all' || row.appliesTo === (action.action === 'replace' ? 'replacement' : 'new')).map((row) => [row.id, true]));
  const car = good(await app.services.repository.query(context, 'stock')).find((row) => row.orderUuid === claim.hold.orderUuid);
  const order = route('order', await client.request('/api/gcsp/manual/order', { commandId: 'plan-generated-order',
    source: { type: 'cart', holdId: hold.hold.holdId, expectedHoldVersion: hold.hold.version, expectedDraftVersion: hold.quote.draftVersion },
    expectedQuoteId: hold.quote.quoteId, expectedStockVersion: car.version, termsDigest: terms.termsDigest, declarations, expectedReviewDetailsVersion: 1 }));
  assert.equal(order.order.status, 'confirmed');
}

test('Greg\'s order plan answers ok after Paula\'s manual order and a generated tranche release, and names the cars left out', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gcsp-plan-generated-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createRunStockProviderFactory({ env: { GCSP_STOCK_INVENTORY_PATH: join(directory, 'inventory.json') }, logger: () => {} }),
    environmentId: 'order-plan-generated', policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'order-plan-generated-bootstrap',
    sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  const released = await presenterTick(client, 'plan-generated-release', { mode: 'next-release' });
  const release = released.tick.outcomes.find((row) => row.handlerId === 'stock-release').outcome.value;
  assert.ok(release.orderUuids.length > 0, 'the release tick publishes generated stock');
  await paulaOrders(app, client);
  route('switch to Greg', await client.request('/api/gcsp/session/switch', { principalId: 'demo-greg', commandId: 'plan-generated-greg' }));
  const plan = route('GET plan', await client.request(BASE));
  assert.ok(['feasible', 'infeasible'].includes(plan.plan.status));
  const { count, models } = plan.plan.unboundStock;
  assert.ok(count > 0 && models.length > 0, 'the released generated cars are left out and named');
  assert.deepEqual(Object.keys(plan.plan.unboundStock).sort(), ['count', 'models']);
  assert.ok(models.every((name) => typeof name === 'string' && !/^[A-Za-z0-9+/=]{40,}$/.test(name)), 'names, not configuration ids');
});
