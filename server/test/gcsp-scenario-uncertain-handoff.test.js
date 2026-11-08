// Replays uncertain-handoff (FUCQ-131), both resolutions, through the presenter and employee routes, twice across two resets.
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
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, environmentId: 'uncertain-handoff',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'uncertain-handoff-bootstrap' } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  return { client, services: app.services };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, presenterCookie, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: presenterCookie, purpose: 'presenter-control' }));
  const read = async (table, filter) => good(await services.repository.query(presenter, table, filter)).filter((row) => row.runId === runId);
  const [offers, stock, operations, receipts] = await Promise.all([read('offers'), read('stock'),
    read('pending_operations', { operationType: 'selection-order' }), read('event_receipts', { consumerId: 'synthetic-ordering:v1' })]);
  return { offers, stock, operations, receipts };
}

async function replay(services, client, scenarioId, label) {
  const resolution = scenarioId === 'uncertain-handoff' ? 'acknowledged' : 'rejected';
  const { entry, reset } = await resetIntoScenario(client, scenarioId, `${label}-reset`);
  const runId = reset.runId;
  assert.equal(reset.startState.status, 'ok', JSON.stringify(reset.startState));
  assert.deepEqual(entry.variants, [resolution]); assert.equal(entry.inputs.syntheticOrderingFault, `timeout-${resolution}`);
  assert.doesNotMatch(JSON.stringify(entry.inputs), /offerId|holdId|operationId|orderNumber|"offers?"/i);
  const presenterCookie = client.cookie();
  const presenter = () => client.seed(presenterCookie.split('; '));
  const as = async (principalId, tag) => { presenter(); route(await client.request('/api/gcsp/session/switch', { principalId, commandId: `${label}-${tag}` })); };
  const ordering = async () => route(await client.request('/api/gcsp/presenter/scenarios/faults')).faults.find((row) => row.adapter === 'ordering');
  // The fixture set the fault before any handoff; nothing is pending yet.
  assert.equal((await ordering()).mode, `timeout-${resolution}`);
  assert.equal((await records(services, presenterCookie, runId)).operations.length, 0);

  // Paula accepts; the provider records its answer but the response times out.
  await as('demo-paula', 'paula');
  const path = `/api/gcsp/offers/${encodeURIComponent(reset.startState.offerId)}`; const query = `?runId=${encodeURIComponent(runId)}`;
  const offer = route(await client.request(`${path}${query}`));
  assert.deepEqual(offer.availableActions, ['accept', 'decline']);
  const accepted = route(await client.request(`${path}/decision`, { commandId: `${label}-accept`, runId, decision: 'accept',
    expectedOfferVersion: offer.offerVersion, expectedHoldVersion: offer.holdVersion, expectedQuoteVersion: offer.quote.revisions.quote,
    termsDigest: offer.handoff.termsDigest, declarations: Object.fromEntries(offer.handoff.declarations.map((d) => [d.id, true])) }));
  assert.equal(accepted.state, 'accepted'); assert.equal(accepted.selection.progress.selectionState, 'handoff-pending');
  const pending = route(await client.request(`${path}${query}`));
  assert.equal(pending.selection.selectionState, 'handoff-pending'); assert.equal(pending.selection.approved, false);
  assert.equal(pending.selection.stages[0].state, 'pending');
  const activity = route(await client.request('/api/gcsp/activity'));
  presenter();
  const during = await records(services, presenterCookie, runId);
  const [operation] = during.operations;
  assert.deepEqual([during.operations.length, operation.state, operation.lastKnownState], [1, 'pending', 'unknown']);
  assert.equal(during.receipts.length, 1); // the provider did answer; only the response was lost
  const handoffsBefore = (await ordering()).handoffs;
  assert.deepEqual(handoffsBefore.map((h) => [h.response, h.resolution]), [['timeout', resolution]]);
  // The car stays held for Paula: never offered to anyone else while the write is uncertain.
  const { orderUuid } = during.offers.find((row) => row.offerId === reset.startState.offerId);
  const car = (rows) => rows.find((row) => row.orderUuid === orderUuid);
  const held = car(during.stock);
  assert.ok(held.allocated === true || held.held === true, JSON.stringify(held));
  const othersOn = (rows) => rows.filter((row) => row.orderUuid === orderUuid && row.offerId !== reset.startState.offerId);
  assert.equal(othersOn(during.offers).length, 0);

  // One presenter tick: reconciliation resolves the existing operation before any retry.
  const ticked = await presenterTick(client, `${label}-reconcile`, { mode: 'step' });
  const after = await records(services, presenterCookie, runId);
  assert.equal((await ordering()).handoffs.length, 1, 'no second provider write'); assert.equal(after.receipts.length, 1);
  assert.equal(after.operations[0].state, resolution === 'acknowledged' ? 'completed' : 'failed');
  assert.equal(othersOn(after.offers).length, 0);
  assert.equal(car(after.stock).allocated, true, 'the car is neither lost nor freed by either resolution');
  await as('demo-paula', 'paula-after');
  const resolved = route(await client.request(`${path}${query}`));
  const activityAfter = route(await client.request('/api/gcsp/activity'));
  presenter();
  if (resolution === 'acknowledged') {
    assert.equal(resolved.selection.selectionState, 'acknowledged');
    assert.equal(resolved.selection.current, resolved.selection.stages[1].name); // Q19 target state name, from policy
    assert.equal(resolved.selection.stages[0].state, 'complete');
  } else {
    assert.equal(resolved.selection.selectionState, 'handoff-failed');
  }
  return { runId, tick: ticked.tick.now, resolution, car: car(after.stock).facts.display.name, carState: { state: car(after.stock).state,
    allocated: car(after.stock).allocated === true }, stages: resolved.selection.stages.map((s) => s.name),
    observed: { activity: activity.currentOffer?.state ?? null, activityAfter: activityAfter.currentOffer?.state ?? null } };
}

test('uncertain handoff: pending on a timeout, car held, reconciled before any retry, both resolutions, repeat after a second reset', async (t) => {
  const { client, services } = await setup(t);
  for (const scenarioId of ['uncertain-handoff', 'uncertain-handoff-rejected']) {
    const one = await replay(services, client, scenarioId, `${scenarioId}-first`);
    const two = await replay(services, client, scenarioId, `${scenarioId}-second`);
    assert.notEqual(one.runId, two.runId);
    const { runId: _a, ...outlineOne } = one; const { runId: _b, ...outlineTwo } = two;
    assert.deepEqual(outlineOne, outlineTwo);
    t.diagnostic(JSON.stringify(outlineOne));
  }
});

test('the synthetic ordering fault applies to one handoff in its own run only', async () => {
  const { createSyntheticOrderingFaults } = await import('../gcsp/adapters/synthetic-ordering-fault.js');
  const faults = createSyntheticOrderingFaults();
  assert.equal(faults.set('run-a', 'timeout-rejected'), true); assert.equal(faults.set('run-a', 'sometimes'), false);
  assert.equal(faults.take('run-b', 'op-b'), null);
  assert.deepEqual(faults.take('run-a', 'op-1'), { response: 'timeout', resolution: 'rejected' });
  assert.equal(faults.take('run-a', 'op-2'), null);
  assert.deepEqual(faults.read('run-a').handoffs.map((h) => h.response), ['timeout', 'answered']);
  assert.equal(faults.read('run-a').mode, 'none');
});
