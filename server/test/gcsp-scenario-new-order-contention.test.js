// FUCQ-240: a new-order employee with no renewal date is left out of buddy contention; the batch and Paula's offer are unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, presenterTick, resetIntoScenario } from './helpers/gcsp-decline-change-route.js';
import { preference } from './helpers/employee-recommendation.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const routeGood = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

test('Jordan with no renewal date is left out of allocation while Paula still gets her offer, across two resets', async (t) => {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: (deps) => createDemoStockProvider(deps), environmentId: 'new-order-contention', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'new-order-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  const runIds = [];

  for (const label of ['first', 'second']) {
    const { reset } = await resetIntoScenario(client, 'main-successful-journey', `new-order-${label}-reset`);
    assert.equal(reset.startState.status, 'ok', JSON.stringify(reset.startState));
    runIds.push(reset.runId);
    const presenter = good(await app.services.identity.resolveSession({ authorized: true, cookie: client.cookie(), purpose: 'presenter-control' }));
    const read = async (table) => good(await app.services.repository.query(presenter, table)).filter((row) => row.runId === reset.runId);
    assert.equal((await read('briefs')).length, 1, 'only Paula has a brief before Jordan saves one');

    // Jordan saves and confirms an eligible brief with search and hold consent through the real routes.
    routeGood(await client.request('/api/gcsp/session/switch', { principalId: 'demo-jordan', commandId: `new-order-${label}-jordan` }));
    const draft = { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: {} };
    const preview = routeGood(await client.request('/api/gcsp/brief/preview', { kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 0, brief: draft }));
    routeGood(await client.request('/api/gcsp/brief/draft', { commandId: `new-order-${label}-draft`, expectedBriefVersion: 0, expectedDraftVersion: 0, brief: draft }));
    routeGood(await client.request('/api/gcsp/brief/confirm', { commandId: `new-order-${label}-confirm`, expectedBriefVersion: 0,
      expectedDraftVersion: 1, consent: { search: true, hold: true } }));
    assert.equal((await read('briefs')).filter((row) => row.employeeId.includes('jordan') && row.buddy.holdConsent === true).length, 1);

    const ticked = await presenterTick(client, `new-order-${label}-release`, { mode: 'next-release' });
    const outcomes = ticked.tick.outcomes;
    assert.deepEqual(outcomes.filter((row) => row.outcome?.status !== 'ok'), [], 'every tick outcome is ok');
    const buddy = outcomes.find((row) => row.handlerId === 'buddy-allocation').outcome.value;
    assert.deepEqual(buddy.limitations, [{ code: 'renewal-deadline-unknown', employees: 1 }]);

    // Jordan has at least one suitable car, so the exclusion is the renewal date and not fit.
    const activity = routeGood(await client.request('/api/gcsp/activity'));
    assert.ok(activity.lastSuccessfulCheck.suitableCars > 0, `Jordan has a suitable car: ${JSON.stringify(preview).slice(0, 200)}`);
    assert.equal(activity.lastSuccessfulCheck.limitation, 'renewal-deadline-unknown');
    assert.equal(activity.currentOffer, null);
    assert.equal((await read('offers')).filter((row) => row.employeeId.includes('jordan')).length, 0);
    assert.equal((await read('holds')).filter((row) => row.employeeId.includes('jordan')).length, 0);

    routeGood(await client.request('/api/gcsp/session/switch', { principalId: 'demo-paula', commandId: `new-order-${label}-paula` }));
    const offers = routeGood(await client.request('/api/gcsp/offers/current'));
    assert.ok(offers.offers.some((offer) => offer.runId === reset.runId), 'Paula has her first active offer');
    assert.equal((await read('offers')).filter((row) => row.state === 'active').length, 1);
    const paula = routeGood(await client.request('/api/gcsp/activity'));
    assert.equal(Object.hasOwn(paula.lastSuccessfulCheck ?? {}, 'limitation'), false);
  }
  assert.notEqual(runIds[0], runIds[1]);
});
