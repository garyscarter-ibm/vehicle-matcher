// FUCQ-129: Paula's buddy offer runs out on a presenter tick, and the old email link tells the truth, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
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
  return { client, services: app.services, https, origin: app.origin };
}

// Direct reads for assertions only; every journey step goes through the routes.
async function records(services, presenterCookie, runId) {
  const presenter = good(await services.identity.resolveSession({ authorized: true, cookie: presenterCookie, purpose: 'presenter-control' }));
  const read = async (table, filter) => good(await services.repository.query(presenter, table, filter)).filter((row) => row.runId === runId);
  const [offers, holds, claims, stock, decisions, briefs, slots, employees, receipts] = await Promise.all(['offers', 'holds', 'claims', 'stock',
    'decisions', 'briefs', 'entitlement_slots', 'employees'].map((table) => read(table)).concat([read('event_receipts', { consumerId: 'buddy-expiry' })]));
  return { presenter, offers, holds, claims, stock, decisions, briefs, slots, employees, receipts };
}
const link = (href, origin) => { const url = new URL(href, origin); return { runId: url.searchParams.get('runId'), offerId: url.searchParams.get('offerId'),
  token: new URLSearchParams(url.hash.slice(1)).get('token') }; };

async function replay(ctx, label) {
  const { client, services, https, origin } = ctx;
  const { entry, reset } = await resetIntoScenario(client, SCENARIO, `${label}-reset`);
  assert.equal(entry.ownerStory, 'FUCQ-129'); assert.equal(entry.fixtureVersion, 'offer-expires-inputs-v1');
  assert.doesNotMatch(JSON.stringify(entry.inputs), /offerId|holdId|operationId|orderNumber|"offers?"/i);
  const { startState, runId } = reset;
  assert.equal(startState.status, 'ok', JSON.stringify(startState));
  const cookie = client.cookie(); const presenter = () => client.seed(cookie.split('; '));
  const as = async (principalId, tag) => { presenter(); route(await client.request('/api/gcsp/session/switch', { principalId, commandId: `${label}-${tag}` })); };
  const before = await records(services, cookie, runId);

  // Start state: Paula holds one active offer. Alex may hold his own G1-6 car (FUCQ-199), never Paula's.
  const offer = before.offers.find((row) => row.offerId === startState.offerId); const paula = offer.employeeId;
  assert.deepEqual([before.offers.filter((row) => row.employeeId === paula).length, offer.state], [1, 'active']);
  assert.equal(offer.expiresAt, startState.expiresAt);
  const alex = before.employees.find((row) => row.principalId === 'demo-alex').employeeId;
  assert.ok(!before.offers.some((row) => row.employeeId === alex && row.orderUuid === offer.orderUuid));
  assert.deepEqual(before.stock.find((row) => row.orderUuid === offer.orderUuid).state, 'held');

  // The hold length is the policy value; the offer carries it as a deadline read from the offer.
  const now = good(await services.clock.now(before.presenter)).now;
  const duration = good(await services.policy.getAssumption('hold.buddy.durationSeconds', { runId, asOf: now, policyVersion: before.presenter.policyVersion })).value;
  assert.equal(Date.parse(offer.expiresAt) - Date.parse(startState.now), duration * 1000);

  // Paula's captured email, through the presenter outbox viewer: her one offer link.
  const outbox = route(await client.request('/api/gcsp/presenter/outbox')).messages.filter((m) => m.recipient.employeeId === paula);
  assert.equal(outbox.length, 1); assert.equal(outbox[0].state, 'sent');
  const old = link(outbox[0].offerLink, origin); assert.deepEqual([old.runId, old.offerId], [runId, offer.offerId]);
  const mail = new RegExp(offer.expiresAt.slice(0, 19));
  assert.match(outbox[0].textBody, mail);

  // Paula sees an active offer before the tick.
  await as('demo-paula', 'paula');
  const path = `/api/gcsp/offers/${encodeURIComponent(offer.offerId)}`; const query = `?runId=${encodeURIComponent(runId)}`;
  const open = route(await client.request(path + query));
  assert.deepEqual([open.state, open.expiresAt, open.availableActions], ['pending', offer.expiresAt, ['accept', 'decline']]);

  // The presenter ticks to the offer's own deadline; the buddy-expiry handler expires it before allocation runs.
  presenter();
  const ticked = await presenterTick(client, `${label}-expire`, { mode: 'to', to: offer.expiresAt });
  assert.equal(ticked.advance.now, offer.expiresAt);
  const stages = ticked.tick.handlerOrder.map((h) => h.stage);
  assert.ok(stages.indexOf('buddy-expiry') < stages.indexOf('buddy-allocation'));
  const expiry = good(ticked.tick.outcomes.find((o) => o.handlerId === 'buddy-expiry').outcome);
  // Alex's own offer from the same release (FUCQ-199) lapses on the same deadline; Paula's is the one under test.
  assert.deepEqual(expiry.expired.filter((row) => row.offerId === offer.offerId).map((row) => [row.offerId, row.state]), [[offer.offerId, 'expired']]);
  assert.ok(expiry.expired.every((row) => row.state === 'expired'));
  const after = await records(services, cookie, runId);

  // Recorded as an expiry (not a decline or dislike) and the car is back in the pool, hold released.
  const state = (rows, key, value) => rows.find((row) => row[key] === value);
  assert.equal(state(after.offers, 'offerId', offer.offerId).state, 'expired');
  assert.deepEqual([state(after.holds, 'holdId', offer.holdId).state, state(after.holds, 'holdId', offer.holdId).releaseReason], ['expired', 'buddy-expired']);
  assert.equal(after.claims.find((row) => row.holdId === offer.holdId).state, 'expired');
  assert.ok(after.receipts.length >= 1 && after.receipts.every((row) => row.eventType === 'buddy-expired'));
  const car = state(after.stock, 'orderUuid', offer.orderUuid);
  assert.deepEqual([car.state, car.available, car.held, car.allocated], ['released', true, false, false]);
  assert.equal(after.decisions.length, 0, 'no decline or dislike record');

  // No priority entitlement: Paula's brief history, renewal and entitlement slot are exactly as before.
  const mine = (rows) => rows.filter((row) => row.employeeId === paula);
  assert.deepEqual(mine(after.briefs), mine(before.briefs));
  const slot = (rows) => rows.find((row) => row.employeeId === paula);
  assert.deepEqual([slot(after.slots).capacity, slot(after.slots).renewalId], [slot(before.slots).capacity, slot(before.slots).renewalId]);
  assert.deepEqual(after.employees.find((row) => row.employeeId === paula), before.employees.find((row) => row.employeeId === paula));

  // The old email link, opened with only its token, shows expired from the backend, and nothing revives it.
  const anon = createRouteClient({ fetch: https.fetch, origin });
  const opened = await anon.request('/api/gcsp/offers/access', { runId: old.runId, offerId: old.offerId, token: old.token });
  const view = route(opened);
  assert.deepEqual([view.state, view.reason, view.offerState, view.holdState, view.availableActions], ['expired', 'deadline-passed', 'expired', 'expired', []]);
  for (let i = 0; i < 2; i += 1) {
    const reread = route(await anon.request(path + query));
    assert.deepEqual([reread.state, reread.offerState, reread.holdState, reread.availableActions], ['expired', 'expired', 'expired', []]);
    await presenterTickAgain(client, cookie, `${label}-again-${i}`);
  }
  // A late accept from the old page is refused and the hold stays expired.
  const late = await anon.request(`${path}/decision`, { commandId: `${label}-late-accept`, runId, decision: 'accept', expectedOfferVersion: view.offerVersion,
    expectedHoldVersion: view.holdVersion, expectedQuoteVersion: view.quote.revisions.quote });
  assert.notEqual(late.json.status, 'ok', JSON.stringify(late.json));
  await as('demo-paula', 'paula-after');
  const mineNow = route(await client.request(path + query));
  assert.deepEqual([mineNow.state, mineNow.availableActions], ['expired', []]);
  const activity = route(await client.request('/api/gcsp/activity'));
  assert.equal(activity.currentOffer?.state ?? 'expired', 'expired');
  const final = await records(services, cookie, runId);
  assert.deepEqual([state(final.holds, 'holdId', offer.holdId).state, state(final.offers, 'offerId', offer.offerId).state, final.decisions.length], ['expired', 'expired', 0]);
  presenter();
  return { runId, link: old, offerCookie: anon.cookie(), expiresAt: offer.expiresAt, now: startState.now, duration, expired: view.state, expiredAt: expiry.expired.find((row) => row.offerId === offer.offerId).expiredAt, car: car.facts.display.name };
}
async function presenterTickAgain(client, cookie, commandId) { client.seed(cookie.split('; ')); return presenterTick(client, commandId, { mode: 'step' }); }

test('offer expires on a tick, the old email link reads expired, nothing revives it, and the run repeats after a second reset', async (t) => {
  const ctx = await setup(t);
  const one = await replay(ctx, 'first');
  const two = await replay(ctx, 'second');
  assert.notEqual(one.runId, two.runId);
  const outline = ({ runId: _run, link: _link, offerCookie: _cookie, ...rest }) => rest;
  assert.deepEqual(outline(one), outline(two));
  // After the second reset the first run's email link is refused as stale, and cannot read or decide the old offer.
  const anon = createRouteClient({ fetch: ctx.https.fetch, origin: ctx.origin });
  const stale = await anon.request('/api/gcsp/offers/access', { runId: one.link.runId, offerId: one.link.offerId, token: one.link.token });
  assert.deepEqual([stale.status, stale.json.status], [409, 'stale-run']);
  const holder = createRouteClient({ fetch: ctx.https.fetch, origin: ctx.origin }); holder.seed(one.offerCookie.split('; '));
  const read = await holder.request(`/api/gcsp/offers/${encodeURIComponent(one.link.offerId)}?runId=${encodeURIComponent(one.runId)}`);
  assert.deepEqual([read.status, read.json.status], [409, 'stale-run'], 'the first run\'s offer cookie cannot read the offer');
});

// FUCQ-129 gap: allocation re-evaluates only on stock releases and brief changes, and Alex (G1-6) is over allowance for every released car.
test('the expired car is offered to the waiting employee on the same or next tick', { todo: 'allocation has no expiry trigger; Alex is eligible only for his own G1-6 car, not Paula\'s' }, async (t) => {
  const ctx = await setup(t);
  const { reset } = await resetIntoScenario(ctx.client, SCENARIO, 'realloc-reset');
  const cookie = ctx.client.cookie();
  await presenterTick(ctx.client, 'realloc-expire', { mode: 'to', to: reset.startState.expiresAt });
  await presenterTick(ctx.client, 'realloc-next', { mode: 'step' });
  const after = await records(ctx.services, cookie, reset.runId);
  const alex = after.employees.find((row) => row.principalId === 'demo-alex').employeeId;
  const car = after.offers.find((row) => row.offerId === reset.startState.offerId).orderUuid;
  assert.ok(after.offers.some((row) => row.employeeId === alex && row.orderUuid === car && row.state === 'active'), 'Alex holds an active offer for the returned car');
});
