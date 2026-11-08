// FUCQ-173: decline, one confirmed change that no released car meets, and truthful waiting, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, runDeclineChangeRoute } from './helpers/gcsp-decline-change-route.js';

const SCENARIO = 'decline-then-change-waiting';
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const route = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

async function setup(t) {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: (deps) => createDemoStockProvider(deps), environmentId: 'decline-change-waiting', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'decline-change-waiting-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  return { client, services: app.services };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, client, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: client.cookie(), purpose: 'presenter-control' }));
  assert.equal(presenter.runId, runId);
  const read = async (table, filter) => good(await services.repository.query(presenter, table, filter)).filter((row) => row.runId === runId);
  const [offers, decisions, briefs, stock, holds, receipts, slices] = await Promise.all([read('offers'), read('decisions'), read('briefs'),
    read('stock'), read('holds'), read('event_receipts', { consumerId: 'buddy-allocation' }), read('event_receipts', { consumerId: 'buddy-allocation-evaluation' })]);
  return { offers, decisions, briefs, stock, holds, receipts, slices };
}

const describe = (row) => ({ name: row.facts.display.name, body: row.facts.facts.body.value });

async function replay(services, client, label) {
  const run = await runDeclineChangeRoute(client, { label, scenarioId: SCENARIO });
  assert.equal(run.entry.ownerStory, 'FUCQ-173'); assert.deepEqual(run.entry.variants, ['waiting-for-suitable-stock']);
  const { offers, decisions, briefs, stock, holds, receipts, slices } = await records(services, client, run.runId);
  const car = (orderUuid) => stock.find((row) => row.orderUuid === orderUuid);
  const first = offers.find((row) => row.offerId === run.firstOffer.offerId);
  const paula = first.employeeId;

  // Start state from actual services: brief v1 and a first offer on the estate preference.
  const history = briefs.filter((row) => row.employeeId === paula).sort((a, b) => a.briefVersion - b.briefVersion);
  assert.equal(history.length, 2);
  assert.equal(describe(car(first.orderUuid)).body, 'estate');

  // The decline is its own decision record with the typed reason; the offer is declined, not expired.
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].decision, 'decline'); assert.equal(decisions[0].reason.code, 'equipment');
  assert.equal(decisions[0].offerId, first.offerId);
  assert.equal(first.state, 'rejected'); assert.equal(run.reloaded.state, 'declined');
  assert.ok(!holds.some((row) => row.holdId === first.holdId && row.releaseReason === 'buddy-expired'));

  // The one confirmed change is brief version 2: the equipment essential, with everything else kept.
  assert.equal(run.saved.state, 'change-saved'); assert.equal(run.saved.change.path, 'essentials.equipment');
  assert.equal(run.waiting.state, 'waiting');
  assert.deepEqual(history[1].essentials.equipment.value, ['Tow bar']);
  assert.deepEqual(history[1].preferences, history[0].preferences);
  const { equipment: _added, ...kept } = history[1].essentials; const { equipment: _none, ...before } = history[0].essentials;
  assert.deepEqual(kept, before);

  // The tick recomputes from brief v2: no released car meets the change, so no second offer is invented.
  assert.equal(run.ready.state, 'no-match');
  assert.equal(run.ready.savedChange.briefVersion, 2);
  assert.deepEqual(offers.filter((row) => row.employeeId === paula).map((row) => row.offerId), [first.offerId]);
  assert.ok(!run.later.offers.some((row) => row.runId === run.runId && row.offerId !== first.offerId));
  const passes = receipts.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .map((row) => slices.find((slice) => slice.eventId === `${row.eventId}:${paula}`)?.outcome.value.evaluation).filter(Boolean);
  const last = passes.at(-1);
  assert.equal(last.briefVersion ?? 2, 2);
  assert.ok(last.decisions.length > 0);
  // No car is known to carry the new essential, so each is blocked or needs confirmation; none is eligible.
  assert.ok(last.decisions.every((d) => d.gateStatus !== 'eligible'));
  assert.ok(last.decisions.every((d) => d.blockers.length > 0 || d.unknowns.some((u) => u.code === 'essential-unconfirmed' && u.field === 'equipment')));

  // Paula's activity is honest: at most the declined offer, and nothing suitable on the latest check.
  const activity = route(await client.request('/api/gcsp/activity'));
  assert.ok(!activity.currentOffer || (activity.currentOffer.offerRef.offerId === first.offerId && activity.currentOffer.state === 'rejected'));
  assert.deepEqual([activity.lastSuccessfulCheck.outcome, activity.lastSuccessfulCheck.suitableCars], ['no-match', 0]);

  // The declined car is back in the pool for others; Paula holds nothing and nothing is accepted.
  assert.equal(car(first.orderUuid).available, true); assert.equal(car(first.orderUuid).state, 'released');
  assert.ok(!holds.some((row) => row.employeeId === paula && row.state === 'active'));
  assert.ok(!offers.some((row) => row.state === 'accepted'));
  return { first: describe(car(first.orderUuid)), runId: run.runId, tick: run.ticked.tick.now, activity: activity.state };
}

test('decline, one confirmed change and truthful waiting with no second car replay across two resets', async (t) => {
  const { client, services } = await setup(t);
  const one = await replay(services, client, 'first');
  const two = await replay(services, client, 'second');
  assert.notEqual(one.runId, two.runId);
  assert.deepEqual({ first: one.first, tick: one.tick, activity: one.activity }, { first: two.first, tick: two.tick, activity: two.activity });
});
