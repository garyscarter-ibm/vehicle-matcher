// Replays data-unavailable (FUCQ-130) through the presenter and employee routes, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, resetIntoScenario, presenterTick } from './helpers/gcsp-decline-change-route.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const route = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

async function setup(t) {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, environmentId: 'data-unavailable',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'data-unavailable-bootstrap' } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  return { client, services: app.services };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, presenterCookie, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: presenterCookie, purpose: 'presenter-control' }));
  const read = async (table, filter) => good(await services.repository.query(presenter, table, filter)).filter((row) => row.runId === runId);
  const [offers, holds, stock, briefs, allocations, releases] = await Promise.all([read('offers'), read('holds'), read('stock'), read('briefs'),
    read('event_receipts', { consumerId: 'buddy-allocation' }), read('event_receipts', { consumerId: 'stock-release' })]);
  return { offers, holds, stock: stock.filter((row) => row.state !== 'unreleased'), briefs, allocations, releases };
}

// A failed pull is a refused tick: the stock-release handler's outcome, with nothing after it run.
async function failedTick(client, commandId) {
  const state = route(await client.request('/api/gcsp/presenter/controls'));
  const reply = await client.request('/api/gcsp/presenter/controls/tick', { commandId, expectedClockVersion: state.clockVersion, mode: 'step' });
  assert.notEqual(reply.status, 200);
  assert.equal(reply.json.status, 'unavailable'); assert.equal(reply.json.handlerId, 'stock-release');
  return reply.json;
}

async function replay(services, client, label) {
  const { entry, reset } = await resetIntoScenario(client, 'data-unavailable', `${label}-reset`);
  const runId = reset.runId;
  assert.equal(reset.startState.status, 'ok', JSON.stringify(reset.startState));
  assert.equal(entry.fixtureVersion, 'data-unavailable-inputs-v1'); assert.deepEqual(entry.variants, ['unavailable', 'stale']);
  assert.doesNotMatch(JSON.stringify(entry.inputs), /winner|outcome|offerId|holdId|"offers?"|"holds"/i);
  const presenterCookie = client.cookie();
  const as = async (principalId, tag) => { client.seed(presenterCookie.split('; ')); route(await client.request('/api/gcsp/session/switch', { principalId, commandId: `${label}-${tag}` })); };
  const presenter = () => client.seed(presenterCookie.split('; '));
  const faultMode = async () => route(await client.request('/api/gcsp/presenter/scenarios/faults')).faults.find((row) => row.adapter === 'stock').mode;
  const setFault = async (mode, tag) => route(await client.request('/api/gcsp/presenter/scenarios/faults', { commandId: `${label}-${tag}`, adapter: 'stock', mode }));
  const views = async (tag) => {
    await as('demo-paula', `${tag}-paula`); const activity = route(await client.request('/api/gcsp/activity'));
    await as('demo-greg', `${tag}-greg`); const greg = route(await client.request('/api/gcsp/greg/demand'));
    presenter(); return { activity, greg };
  };
  // The fixture set the fault before the release; the previous run's fault never carries over.
  assert.equal(await faultMode(), 'unavailable');
  const before = await records(services, presenterCookie, runId);

  const state = route(await client.request('/api/gcsp/presenter/controls'));
  const refused = await client.request('/api/gcsp/presenter/controls/tick', { commandId: `${label}-next-release`, expectedClockVersion: state.clockVersion, mode: 'next-release' });
  assert.equal(refused.json.status, 'unavailable'); assert.equal(refused.json.handlerId, 'stock-release');
  const unavailable = await records(services, presenterCookie, runId);
  // No false outcome: no stock change, no release receipt, no allocation pass, offer or hold, and the briefs (priority) unchanged.
  for (const key of ['stock', 'releases', 'allocations', 'offers', 'holds']) assert.equal(unavailable[key].length, 0, key);
  assert.deepEqual(unavailable.briefs, before.briefs);
  const down = await views('down');
  assert.equal(down.activity.sourceStatus, 'unavailable'); assert.equal(down.activity.lastSuccessfulCheck, null);
  assert.equal(down.activity.currentOffer, null);
  assert.deepEqual(down.greg.stock.source, { status: 'unavailable' }); assert.deepEqual(down.greg.stock.byModelLine, []);

  // The presenter switches the fault to stale: the list is refused beyond the policy age, still with no stock change.
  await setFault('stale', 'stale');
  const stale = await failedTick(client, `${label}-stale-tick`);
  assert.equal(stale.handlerOutcome.code, 'stock-source-stale'); assert.ok(stale.handlerOutcome.maxAgeMinutes > 0);
  const afterStale = await records(services, presenterCookie, runId);
  for (const key of ['stock', 'releases', 'allocations', 'offers', 'holds']) assert.equal(afterStale[key].length, 0, key);
  assert.deepEqual(afterStale.briefs, before.briefs);
  const old = await views('stale');
  assert.equal(old.activity.sourceStatus, 'unavailable');
  assert.deepEqual(old.greg.stock.source, { status: 'unavailable', reason: 'stale' });

  // Cleared, the next tick pulls the same tranche and normal allocation resumes.
  assert.equal((await setFault('none', 'clear')).faults[0].mode, 'none');
  const ticked = await presenterTick(client, `${label}-recover`, { mode: 'step' });
  const recovered = await records(services, presenterCookie, runId);
  assert.equal(recovered.releases.length, 1); assert.ok(recovered.stock.length > 0);
  assert.ok(recovered.allocations.length > 0);
  const paula = recovered.briefs[0];
  const offer = recovered.offers.find((row) => row.employeeId === paula.employeeId && row.state === 'active');
  assert.ok(offer, 'Paula is offered a car once the source recovers');
  const up = await views('up');
  assert.equal(up.activity.sourceStatus, 'ok'); assert.equal(up.activity.lastSuccessfulCheck.outcome, 'offer-held');
  assert.deepEqual(up.greg.stock.source, { status: 'ok' }); assert.ok(up.greg.stock.byModelLine.length > 0);

  // A presenter-set fault stays with this run; the next reset starts from the fixture again.
  await setFault('stale', 'leave-stale');
  const car = recovered.stock.find((row) => row.orderUuid === offer.orderUuid);
  return { runId, tick: ticked.tick.now, released: recovered.stock.length, car: car.facts.display.name };
}

test('data unavailable: failed and stale pulls change nothing, read as unavailable not empty, recover when cleared, and repeat after a second reset', async (t) => {
  const { client, services } = await setup(t);
  const one = await replay(services, client, 'first');
  const two = await replay(services, client, 'second');
  assert.notEqual(one.runId, two.runId);
  const { runId: _a, ...outlineOne } = one; const { runId: _b, ...outlineTwo } = two;
  assert.deepEqual(outlineOne, outlineTwo);
  // Any other scenario's reset starts with no synthetic fault.
  await resetIntoScenario(client, 'main-successful-journey', 'third-reset');
  const faults = route(await client.request('/api/gcsp/presenter/scenarios/faults')).faults;
  assert.deepEqual(faults.map((row) => [row.adapter, row.mode]), [['stock', 'none']]);
});

test('the synthetic stock fault is run-scoped and never alters an operational provider pull', async () => {
  const { createSyntheticStockFaults } = await import('../gcsp/stock/synthetic-fault.js');
  const policy = { getAssumption: async () => ({ status: 'ok', value: { value: 60, unit: 'minutes' } }) };
  const snapshot = (mode) => ({ status: 'ok', value: { observedAt: '2026-11-05T09:30:00.000Z', source: { mode }, stock: [] } });
  const faults = createSyntheticStockFaults({ policy });
  const request = { runId: 'run-a', asOf: '2026-11-05T09:30:00.000Z', policyVersion: 'v1' };
  assert.equal(faults.set('run-a', 'unavailable'), true); assert.equal(faults.set('run-a', 'broken'), false);
  assert.deepEqual(await faults.wrap({ pull: async () => snapshot('dated-snapshot') }).pull(request), snapshot('dated-snapshot'));
  assert.equal((await faults.wrap({ pull: async () => snapshot('synthetic') }).pull(request)).status, 'unavailable');
  assert.deepEqual(await faults.wrap({ pull: async () => snapshot('synthetic') }).pull({ ...request, runId: 'run-b' }), snapshot('synthetic'));
  faults.set('run-a', 'stale');
  const stale = await faults.wrap({ pull: async () => snapshot('synthetic') }).pull(request);
  assert.equal(stale.value.observedAt, '2026-11-05T08:29:00.000Z');
  assert.equal(faults.read('run-b').mode, 'none');
});

test("Greg's view model reads an unavailable or stale stock source as unavailable, not as no stock", async () => {
  const { toDashboardView } = await import('../../blocks/gcsp/greg/demand-view.js');
  const { fixtureProjection } = await import('../../blocks/gcsp/greg/fixtures.js');
  const base = fixtureProjection('no-stock');
  const view = (source) => toDashboardView({ ...base, stock: { ...base.stock, source } }).stock;
  assert.deepEqual(view({ status: 'ok' }), { rows: [], sourceUnavailable: false, sourceStale: false });
  assert.deepEqual(view({ status: 'unavailable' }), { rows: [], sourceUnavailable: true, sourceStale: false });
  assert.deepEqual(view({ status: 'unavailable', reason: 'stale' }), { rows: [], sourceUnavailable: true, sourceStale: true });
});
