// Replays no-suitable-match through the presenter and employee routes, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { competingPolicy } from './helpers/gcsp-journey.js';
import { createRouteClient, resetIntoScenario, presenterTick } from './helpers/gcsp-decline-change-route.js';
import { expandEvaluation } from '../gcsp/allocation/evaluation-rows.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const route = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

async function setup(t) {
  // Alex takes Paula's grade (competingPolicy): at the canonical seed grade no car is within his allowance.
  const { seed, policy } = await competingPolicy();
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy, environmentId: 'no-match', policyAsOf: seed.effectiveFrom,
    commandId: 'no-match-bootstrap' } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  return { client, services: app.services };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, presenterCookie, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: presenterCookie, purpose: 'presenter-control' }));
  assert.equal(presenter.runId, runId);
  const read = async (table, filter) => good(await services.repository.query(presenter, table, filter)).filter((row) => row.runId === runId);
  const [offers, holds, stock, briefs, receipts, slices] = await Promise.all([read('offers'), read('holds'), read('stock'), read('briefs'),
    read('event_receipts', { consumerId: 'buddy-allocation' }), read('event_receipts', { consumerId: 'buddy-allocation-evaluation' })]);
  return { offers, holds, stock, briefs, receipts, slices };
}

async function replay(services, client, label) {
  const { entry, reset } = await resetIntoScenario(client, 'no-suitable-match', `${label}-reset`);
  const runId = reset.runId;
  // The catalogue input carries no outcome: the no-match must come from allocation's own calculation.
  assert.equal(reset.startState.status, 'ok', JSON.stringify(reset.startState));
  assert.deepEqual(reset.startState.briefs, { 'demo-paula': 1, 'demo-alex': 1 });
  assert.equal(entry.availability.available, true);
  assert.doesNotMatch(JSON.stringify(entry.inputs), /winner|no-match|outcome|offerId|holdId|"offers?"|"holds"/i);
  const presenterCookie = client.cookie();
  const as = async (principalId, tag) => { client.seed(presenterCookie.split('; ')); route(await client.request('/api/gcsp/session/switch', { principalId, commandId: `${label}-${tag}` })); };

  const ticked = await presenterTick(client, `${label}-next-release`, { mode: 'next-release' });
  const { offers, holds, stock, briefs, receipts, slices } = await records(services, presenterCookie, runId);

  const paula = briefs.find((row) => row.status === 'confirmed' && row.essentials.seats?.value === 9);
  const alex = briefs.find((row) => row.status === 'confirmed' && row !== paula);
  assert.ok(paula && alex, 'both confirmed briefs came from the start loader');
  const active = (rows, id) => rows.filter((row) => row.employeeId === id && row.state === 'active');
  assert.equal(offers.filter((row) => row.employeeId === paula.employeeId).length, 0);
  assert.equal(holds.filter((row) => row.employeeId === paula.employeeId).length, 0);
  assert.equal(active(offers, alex.employeeId).length, 1);

  // The calculation: in every allocation pass, every released car fails Paula's nine-seat essential.
  // Later passes see fewer cars (Alex's is held), and her activity reports the latest pass.
  const passes = receipts.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    // FUCQ-209: each employee's evaluation is its own receipt row.
    .map((row) => slices.find((slice) => slice.eventId === `${row.eventId}:${paula.employeeId}`)?.outcome.value.evaluation).filter(Boolean).map(expandEvaluation);
  assert.ok(passes.length > 0);
  for (const pass of passes) {
    assert.ok(pass.decisions.length > 0);
    assert.ok(pass.decisions.every((d) => d.gateStatus !== 'eligible'));
    assert.ok(pass.decisions.every((d) => d.blockers.some((b) => b.code === 'essential-unmet' && b.field === 'seats')));
  }
  const evaluation = passes.at(-1);

  await as('demo-paula', 'paula');
  const activity = route(await client.request('/api/gcsp/activity'));
  assert.equal(activity.state, 'searching'); assert.equal(activity.sourceStatus, 'ok');
  assert.equal(activity.currentOffer, null);
  const check = activity.lastSuccessfulCheck;
  assert.deepEqual([check.outcome, check.suitableCars, check.carsChecked], ['no-match', 0, evaluation.decisions.length]);
  // FUCQ-219: the check names the essential that ruled every car out, from her own decisions only.
  assert.deepEqual(check.exclusions.map((row) => [row.essential, row.cars, row.requirement.value]), [['seats', evaluation.decisions.length, 9]]);
  const hers = route(await client.request('/api/gcsp/offers/current'));
  assert.equal(hers.offers.filter((row) => row.runId === runId).length, 0);

  await as('demo-alex', 'alex');
  const his = route(await client.request('/api/gcsp/offers/current'));
  assert.equal(his.offers.filter((row) => row.runId === runId).length, 1);

  await as('demo-greg', 'greg');
  const unmet = route(await client.request('/api/gcsp/greg/demand')).demand.unmet;
  const seats = unmet.byGate.find((row) => row.key === 'essential-unmet:seats');
  assert.ok(seats?.count, 'her unmet need appears under the seats essential');
  assert.ok(unmet.total?.count);

  const car = stock.find((row) => row.orderUuid === active(offers, alex.employeeId)[0].orderUuid);
  return { runId, tick: ticked.tick.now, checked: evaluation.decisions.length, seats: seats.count,
    alexCar: { name: car.facts.display.name, body: car.facts.facts.body.value } };
}

test('no suitable match: calculated no-offer, competitor offer, activity reason, Greg unmet count and repeat after a second reset', async (t) => {
  const { client, services } = await setup(t);
  const one = await replay(services, client, 'first');
  const two = await replay(services, client, 'second');
  assert.notEqual(one.runId, two.runId);
  const { runId: _a, ...outlineOne } = one; const { runId: _b, ...outlineTwo } = two;
  assert.deepEqual(outlineOne, outlineTwo);
});
