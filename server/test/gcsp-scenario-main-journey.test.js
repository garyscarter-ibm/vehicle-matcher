// Reset into the main successful journey: only Paula's confirmed brief exists; the presenter's Next release does the rest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, presenterTick } from './helpers/gcsp-decline-change-route.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const routeGood = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

test('main-successful-journey starts at Paula\'s confirmed brief with no stock released and no offer, then Next release offers her a car', async (t) => {
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

  const ticked = await presenterTick(client, 'main-journey-release', { mode: 'next-release' });
  assert.equal(ticked.tick.outcomes.filter((row) => row.outcome?.status !== 'ok').length, 0);
  routeGood(await client.request('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: 'main-journey-paula' }));
  const offers = routeGood(await client.request('/api/gcsp/offers/current'));
  assert.ok(offers.offers.some((offer) => offer.runId === reset.runId), 'Paula has her first offer');
  assert.equal((await read('offers')).filter((row) => row.state === 'active').length, 1);
  assert.ok((await read('stock')).some((row) => row.release));
});
