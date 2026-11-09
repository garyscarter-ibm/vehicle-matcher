// FUCQ-278: after the presenter's Next release the buddy holds a car, so manual claims must say so, not "release-required".
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, presenterTick } from './helpers/gcsp-decline-change-route.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const routeGood = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

test("FUCQ-278: a held buddy offer is reported by browse and refuses every manual claim as offer-held", async (t) => {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: (deps) => createDemoStockProvider(deps), environmentId: 'main-journey', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'main-journey-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);

  const catalogue = routeGood(await client.request('/api/gcsp/presenter/scenarios'));
  const entry = catalogue.scenarios.find((row) => row.scenarioId === 'main-successful-journey');
  assert.equal(entry.availability.available, true);
  const current = routeGood(await client.request('/api/gcsp/presenter/scenarios/current'));
  const reset = routeGood(await client.request('/api/gcsp/presenter/scenarios/reset', { commandId: 'main-journey-reset',
    expectedRunId: current.runId, expectedRunVersion: current.runVersion, scenarioId: entry.scenarioId,
    scenarioVersion: entry.scenarioVersion, fixtureVersion: entry.fixtureVersion, policyVersion: entry.policyVersion }));
  assert.notEqual(reset.runId, current.runId);
  assert.equal(reset.startState.status, 'ok', JSON.stringify(reset.startState));
  assert.equal(reset.startState.briefVersion, 1); assert.ok(reset.startState.now);
  assert.deepEqual(Object.keys(reset.startState).sort(), ['briefVersion', 'now', 'status']);

  const presenter = good(await app.services.identity.resolveSession({ authorized: true, cookie: client.cookie(), purpose: 'presenter-control' }));
  assert.equal(presenter.runId, reset.runId);
  const read = async (table) => good(await app.services.repository.query(presenter, table)).filter((row) => row.runId === reset.runId);
  const input = entry.inputs.briefs[0];
  const briefs = await read('briefs');
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].briefVersion, 1);
  assert.deepEqual([briefs[0].preferences.body.value, briefs[0].preferences.body.importance], ['estate', 80]);
  assert.deepEqual(Object.fromEntries(Object.entries(briefs[0].essentials).map(([key, row]) => [key, row.value])), input.essentials);
  assert.deepEqual([briefs[0].buddy.searchConsent, briefs[0].buddy.holdConsent], [input.consent.search, input.consent.hold]);
  // Nothing is released, offered or held until the presenter's own Next release.
  assert.equal((await read('offers')).length, 0); assert.equal((await read('holds')).length, 0);
  assert.equal((await read('stock')).filter((row) => row.release).length, 0);

  await presenterTick(client, 'main-journey-release', { mode: 'next-release' });
  routeGood(await client.request('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: 'main-journey-paula' }));
  const holds = (await read('holds')).filter((h) => h.type === 'buddy-offer' && h.state === 'active');
  assert.equal(holds.length, 1);
  const offer = (await read('offers')).find((row) => row.holdId === holds[0].holdId);
  assert.ok(offer);
  const account = (await client.request('/api/gcsp/manual/account')).json.value;
  const action = account.actions[0];
  const choices = { mode: 'replacement', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId,
    driverId: account.choices.drivers[0].driverId, contractOptionId: 'six-month-8000', requestedCollectionDate: '2026-11-20',
    collectionLocationId: 'demo-collection-centre', brand: account.choices.brands[0],
    contact: { phone: '01632 960001', email: 'paula@example.invalid' }, expectedReturnMileage: 6700, specialRequirements: '' };
  const draft = await client.request('/api/gcsp/manual/draft', { commandId: 'offer-held-draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices });
  assert.equal(draft.status, 200, JSON.stringify(draft.json));

  const stock = routeGood(await client.request('/api/gcsp/manual/stock'));
  assert.deepEqual(stock.heldOffer, { offerId: offer.offerId, runId: reset.runId });
  assert.ok(stock.cars.length > 0);
  for (const [index, car] of stock.cars.entries()) {
    const refused = await client.request('/api/gcsp/manual/claim', { commandId: `offer-held-${index}`, ...car.claimInput });
    assert.equal(refused.status, 409, JSON.stringify(refused.json));
    assert.equal(refused.json.reason, 'offer-held');
    assert.equal(refused.json.view.action, 'view-offer');
    assert.deepEqual([refused.json.offerId, refused.json.runId], [offer.offerId, reset.runId]);
  }
});
