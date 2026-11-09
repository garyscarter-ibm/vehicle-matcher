// FUCQ-233: Paula declines her buddy offer; the next tick offers the car to waiting Alex once, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { DECISION_EVENTS } from '../gcsp/offers/decision.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';
import { createRouteClient, resetIntoScenario, presenterTick } from './helpers/gcsp-decline-change-route.js';

const SCENARIO = 'offer-expires';
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const route = (response) => { assert.equal(response.status, 200, JSON.stringify(response.json)); return good(response.json); };

async function setup(t) {
  const https = await createLocalHttpsFixture(t);
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
    stockProvider: createDemoStockProvider, adoptOfferJourney: true, environmentId: 'offer-expires',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'offer-expires-bootstrap' } }));
  t.after(() => app.close());
  const client = createRouteClient({ fetch: https.fetch, origin: app.origin });
  client.seed(good(await app.services.createLocalSession()).setCookie);
  return { client, services: app.services };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, presenterCookie, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: presenterCookie, purpose: 'presenter-control' }));
  const read = async (table, filter) => good(await services.repository.query(presenter, table, filter)).filter((row) => row.runId === runId);
  const [offers, holds, claims, stock, decisions, employees, receipts] = await Promise.all(['offers', 'holds', 'claims', 'stock', 'decisions', 'employees']
    .map((table) => read(table)).concat([read('event_receipts', { consumerId: DECISION_EVENTS })]));
  return { offers, holds, claims, stock, decisions, employees, receipts };
}
// Re-seeds the presenter session before a step tick, as the expiry replay does.
async function presenterTickAgain(client, cookie, commandId) { client.seed(cookie.split('; ')); return presenterTick(client, commandId, { mode: 'step' }); }

async function replay(ctx, label) {
  const { client, services } = ctx;
  const { entry, reset } = await resetIntoScenario(client, SCENARIO, `${label}-reset`);
  assert.equal(entry.fixtureVersion, 'offer-expires-inputs-v2');
  assert.doesNotMatch(JSON.stringify(entry.inputs), /offerId|holdId|operationId|orderNumber|"offers?"/i);
  const { startState, runId } = reset;
  assert.equal(startState.status, 'ok', JSON.stringify(startState));
  const cookie = client.cookie(); const presenter = () => client.seed(cookie.split('; '));
  const as = async (principalId, tag) => { presenter(); route(await client.request('/api/gcsp/session/switch', { principalId, commandId: `${label}-${tag}` })); };
  const reofferMail = async (employeeId) => { presenter(); return route(await client.request('/api/gcsp/presenter/outbox')).messages.filter((m) => m.recipient.employeeId === employeeId); };
  const before = await records(services, cookie, runId);

  // Start state: Paula holds one active offer. Alex (G1-6) is eligible only for this hatch, so he waits for it.
  const offer = before.offers.find((row) => row.offerId === startState.offerId); const paula = offer.employeeId;
  assert.deepEqual([before.offers.filter((row) => row.employeeId === paula).length, offer.state], [1, 'active']);
  const alex = before.employees.find((row) => row.principalId === 'demo-alex').employeeId;
  assert.equal(before.offers.filter((row) => row.employeeId === alex).length, 0);
  assert.deepEqual(before.stock.find((row) => row.orderUuid === offer.orderUuid).state, 'held');

  // Paula opens her active offer, reads the registered decline reasons and declines with one of them.
  await as('demo-paula', 'paula');
  const path = `/api/gcsp/offers/${encodeURIComponent(offer.offerId)}`; const query = `?runId=${encodeURIComponent(runId)}`;
  const open = route(await client.request(path + query));
  assert.deepEqual([open.state, open.availableActions], ['pending', ['accept', 'decline']]);
  const { reasons } = route(await client.request(`${path}/decision-reasons${query}`));
  const reasonCode = reasons[0].code;
  const decision = route(await client.request(`${path}/decision`, { commandId: `${label}-decline`, runId, decision: 'decline',
    expectedOfferVersion: open.offerVersion, expectedHoldVersion: open.holdVersion, expectedQuoteVersion: open.quote.revisions.quote, reasonCode }));
  assert.equal(decision.state, 'declined');

  // The presenter's next step: the declined car is allocated again on that same tick, to waiting Alex.
  presenter();
  const ticked = await presenterTick(client, `${label}-tick`, { mode: 'step' });
  const allocation = good(ticked.tick.outcomes.find((o) => o.handlerId === 'buddy-allocation').outcome);
  assert.deepEqual(allocation.allocations.filter((a) => a.event.eventType === 'buddy-declined').map((a) => a.state), ['allocated']);
  const after = await records(services, cookie, runId);
  const find = (rows, key, value) => rows.find((row) => row[key] === value);

  // Paula's offer is rejected and her hold released as an offer decline; her claim is released too.
  const paulaOffer = find(after.offers, 'offerId', offer.offerId); const paulaHold = find(after.holds, 'holdId', offer.holdId);
  assert.deepEqual([paulaOffer.state, paulaHold.state, paulaHold.releaseReason], ['rejected', 'released', 'offer-declined']);
  assert.deepEqual(after.claims.filter((row) => row.holdId === offer.holdId).map((row) => row.state), ['released']);
  // Alex gets the car on one new active hold, Paula has no other offer, and the car stays held.
  const alexOffers = after.offers.filter((row) => row.employeeId === alex);
  assert.deepEqual(alexOffers.map((row) => [row.orderUuid, row.state]), [[offer.orderUuid, 'active']]);
  assert.notEqual(alexOffers[0].holdId, offer.holdId);
  assert.equal(find(after.holds, 'holdId', alexOffers[0].holdId).state, 'active');
  assert.deepEqual(after.offers.filter((row) => row.employeeId === paula).map((row) => row.state), ['rejected']);
  const car = find(after.stock, 'orderUuid', offer.orderUuid);
  assert.deepEqual([car.state, car.available, car.held, car.allocated], ['held', false, true, false]);
  // Alex's captured email: exactly one reoffer message, and exactly one decline record with its event receipt.
  const mails = await reofferMail(alex);
  assert.equal(mails.length, 1);
  assert.deepEqual(after.decisions.map((row) => [row.offerId, row.decision]), [[offer.offerId, 'decline']]);
  assert.deepEqual(after.receipts.map((row) => row.eventType), ['offer-declined']);

  // Two more presenter step ticks add no second offer and no second email.
  for (let i = 0; i < 2; i += 1) await presenterTickAgain(client, cookie, `${label}-again-${i}`);
  const again = await records(services, cookie, runId);
  assert.deepEqual(again.offers.filter((row) => row.employeeId === alex).map((row) => [row.orderUuid, row.state]), [[offer.orderUuid, 'active']]);
  assert.deepEqual(again.offers.filter((row) => row.employeeId === paula).map((row) => row.state), ['rejected']);
  assert.equal((await reofferMail(alex)).length, 1);
  presenter();
  return { runId, outline: { decision: decision.state, reasonCode, paula: [paulaOffer.state, paulaHold.state, paulaHold.releaseReason],
    alex: alexOffers.map((row) => row.state), car: [car.state, car.available, car.held, car.allocated], carName: car.facts.display.name,
    emails: mails.length, decisions: after.decisions.map((row) => row.decision) } };
}

test('a declined buddy offer reoffers its car to the waiting employee once, and the run repeats after a second reset', async (t) => {
  const ctx = await setup(t);
  const one = await replay(ctx, 'first');
  const two = await replay(ctx, 'second');
  assert.notEqual(one.runId, two.runId);
  assert.deepEqual(one.outline, two.outline);
});
