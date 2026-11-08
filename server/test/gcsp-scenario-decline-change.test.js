// Replays decline-then-change through the actual presenter and employee routes, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, runDeclineChangeRoute } from './helpers/gcsp-decline-change-route.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };

async function setup(t) {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: (deps) => createDemoStockProvider(deps), environmentId: 'decline-change', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'decline-change-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  return { client, services: app.services };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, client, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: client.cookie(), purpose: 'presenter-control' }));
  assert.equal(presenter.runId, runId);
  const read = async (table) => good(await services.repository.query(presenter, table)).filter((row) => row.runId === runId);
  const [offers, decisions, briefs, stock, holds] = await Promise.all(['offers', 'decisions', 'briefs', 'stock', 'holds'].map(read));
  return { offers, decisions, briefs, stock, holds };
}

// Compare across runs by model and body, never by run-bound ids.
const describe = (row) => ({ name: row.facts.display.name, body: row.facts.facts.body.value });

async function replay(t, services, client, label) {
  const run = await runDeclineChangeRoute(client, { label });
  const { offers, decisions, briefs, stock, holds } = await records(services, client, run.runId);
  const car = (orderUuid) => stock.find((row) => row.orderUuid === orderUuid);
  const paula = offers.filter((row) => row.employeeId === offers.find((o) => o.offerId === run.firstOffer.offerId).employeeId);
  const first = paula.find((row) => row.offerId === run.firstOffer.offerId);
  const later = paula.filter((row) => row.offerId !== first.offerId);

  // Start state came from actual services: Paula's brief v1 and first offer on the estate preference.
  const history = briefs.filter((row) => row.employeeId === first.employeeId).sort((a, b) => a.briefVersion - b.briefVersion);
  assert.equal(history.length, 2);
  assert.equal(describe(car(first.orderUuid)).body, 'estate');

  // The decline is its own decision record and the offer is declined, not expired.
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'decline'); assert.equal(decisions[0].reason.code, 'body-style');
  assert.equal(decisions[0].offerId, first.offerId);
  assert.equal(first.state, 'rejected'); assert.equal(run.reloaded.state, 'declined');
  assert.ok(!holds.some((row) => row.holdId === first.holdId && row.releaseReason === 'buddy-expired'));

  // The one confirmed change is a separate brief version; other essentials are kept.
  assert.equal(run.saved.change.after, 'saloon');
  assert.equal(history[0].preferences.body.value, 'estate'); assert.equal(history[1].preferences.body.value, 'saloon');
  assert.equal(history[1].preferences.body.importance, history[0].preferences.body.importance);
  assert.deepEqual(history[1].essentials, history[0].essentials);
  assert.equal(run.waiting.state, 'waiting');

  // The next presenter tick yields a separate second offer for the changed brief.
  assert.equal(later.length, 1);
  const second = later[0];
  assert.equal(second.state, 'active'); assert.equal(second.briefVersion, 2);
  assert.equal(run.ready.state, 'ready'); assert.equal(describe(car(second.orderUuid)).body, 'saloon');
  assert.notEqual(second.orderUuid, first.orderUuid);
  assert.ok(!later.some((row) => row.orderUuid === first.orderUuid));
  assert.ok(run.later.offers.some((row) => row.offerId === second.offerId));

  // The declined car is back in the pool for others; nothing is accepted or marked satisfied.
  assert.equal(car(first.orderUuid).available, true); assert.equal(car(first.orderUuid).state, 'released');
  assert.equal(car(second.orderUuid).available, false);
  assert.ok(!holds.some((row) => row.holdId === first.holdId && row.state === 'active'));
  assert.ok(!offers.some((row) => row.state === 'accepted'));
  return { first: describe(car(first.orderUuid)), second: describe(car(second.orderUuid)), runId: run.runId, tick: run.ticked.tick.now };
}

test('decline, one confirmed change and a matching second offer replay across two resets', async (t) => {
  const { client, services } = await setup(t);
  const one = await replay(t, services, client, 'first');
  const two = await replay(t, services, client, 'second');
  assert.notEqual(one.runId, two.runId);
  assert.deepEqual({ first: one.first, second: one.second, tick: one.tick }, { first: two.first, second: two.second, tick: two.tick });
});
