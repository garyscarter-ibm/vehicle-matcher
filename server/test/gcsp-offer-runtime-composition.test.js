// Selected actual memory/loopback composition; no native DB, external request or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';
import { essential, preference } from './helpers/employee-recommendation.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';

// Report only status/coordinates, never contexts, cookies, captured mail or credentials.
const good = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
const cookie = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');
const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });
async function waitFor(predicate) {
  for (let n = 0; n < 200; n += 1) { if (predicate()) return; await new Promise((done) => setTimeout(done, 10)); }
  assert.fail('The composed view did not settle within its bounded wait.');
}

async function setup(t) {
  const profile = createCompositionTestProfile();
  const https = await createLocalHttpsFixture(t); const fetch = https.fetch;
  const app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory', stockProvider: profile,
    environmentId: 'offer-composition', policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'offer-bootstrap',
    sessionNow: () => '2026-11-06T00:00:00.000Z' } }));
  t.after(() => app.close());
  const runtime = app.services;
  const local = good(await runtime.createLocalSession()); const session = cookie(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: session, purpose: 'presenter-control' }));
  const greg = good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', 'offer-policy-greg'));
  const gregCookie = cookie(greg.setCookie);
  // Intentional server-only adoption of the existing registered canonical bundles.
  // The actual presenter moves DemoClock between publications; no policy snapshot is edited.
  for (const [index, id] of ['offer-decline-reasons-v1', 'offer-followup-questions-v1'].entries()) {
    const context = good(await runtime.identity.resolveSession({ authorized: true, cookie: gregCookie }));
    const time = good(await runtime.clock.now(context));
    const version = `offer-composition-policy-${index + 1}`;
    const adopted = await runtime.policy.adoptReviewedAssumptions(context, { commandId: `adopt:${id}`,
      expectedActiveVersion: context.policyVersion, policyVersion: version, effectiveFrom: time.now, definitionSetId: id });
    const value = good(adopted); assert.equal(value.activationRequired, false);
    assert.equal(value.activation.policyVersion, version);
    for (const row of getReviewedDefinitionSet(id).definitions) {
      const read = await runtime.policy.getAssumption(row.key, { runId: context.runId, policyVersion: version, asOf: time.now });
      assert.equal(read.status, 'ok'); assert.equal(read.policyVersion, version); assert.deepEqual(read.value.value, row.value);
    }
    if (index === 0) good(await runtime.clock.advance(presenter, { commandId: 'next-publication-instant',
      expectedClockVersion: time.clockVersion, bySeconds: 1 }));
  }
  const employee = good(await runtime.identity.resolveSession({ authorized: true, cookie: session }));
  assert.equal(employee.policyVersion, 'offer-composition-policy-2');
  const run = good(await runtime.repository.read(employee, ref(employee, 'runs', {})));
  assert.equal(run.policyVersion, employee.policyVersion); assert.equal(run.versions.policy, employee.policyVersion);
  const history = await runtime.policy.getAssumption('offer.followupQuestions.v1', { runId: employee.runId,
    policyVersion: 'gcsp-policy-v1', asOf: '2026-11-05T09:00:00.000Z' });
  assert.notEqual(history.status, 'ok');
  good(await runtime.brief.saveDraft(employee, { commandId: 'offer-brief', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  good(await runtime.brief.confirm(employee, { commandId: 'offer-consent', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
  const car = await profile.prepare(runtime, employee);
  const before = good(await runtime.clock.now(presenter));
  good(await runtime.clock.advance(presenter, { commandId: 'release-noon', expectedClockVersion: before.clockVersion,
    to: '2026-11-05T12:00:00.000Z' }));
  const now = good(await runtime.clock.now(presenter));
  good(await runtime.clock.tick(presenter, { eventId: 'release-offer-stock', inputDigest: inputDigest('release-offer-stock'),
    expectedClockVersion: now.clockVersion }));
  const stock = good(await runtime.repository.read(employee, ref(employee, 'stock', { orderUuid: car.orderUuid })));
  const owner = good(await runtime.repository.read(employee, ref(employee, 'employees', { employeeId: employee.employeeId })));
  const slot = good(await runtime.repository.read(employee, ref(employee, 'entitlement_slots', { entitlementSlotId: employee.entitlementSlotId })));
  const allocation = good(await runtime.buddy.allocate(employee, { commandId: 'offer-claim', orderUuid: car.orderUuid,
    expectedBriefVersion: 1, expectedStockVersion: stock.version, expectedEmployeeVersion: owner.version, expectedSlotVersion: slot.version }));
  const offer = allocation.offer;
  const query = `?runId=${encodeURIComponent(employee.runId)}`;
  const path = `/api/gcsp/offers/${encodeURIComponent(offer.offerId)}`;
  const request = async (url, { body, session: supplied = session, origin = app.origin, method } = {}) => {
    const response = await fetch(`${app.origin}${url}`, { method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { Origin: origin, ...(supplied ? { Cookie: supplied } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
  return { ...app, ...runtime, runtime, employee, presenter, session, profile, car, offer, path, query, request, fetch };
}

test('composed offer entry reloads the real declined offer and saves the employee follow-up under adopted policy', async (t) => {
  const f = await setup(t);
  assert.equal(f.dependencies.gcspOfferAccess, f.offerAccess);
  assert.equal(f.dependencies.gcspOfferDecisions, f.offerDecisions);
  assert.equal(f.dependencies.gcspOfferFollowup, f.offerFollowup);
  const page = await f.fetch(`${f.origin}/gcsp/offer?offerId=${encodeURIComponent(f.offer.offerId)}`);
  assert.equal(page.status, 200); assert.ok(page.headers.get('set-cookie') === null);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  const html = await page.text(); assert.ok(html.includes('/blocks/gcsp/offer/entry-harness.js'));
  assert.ok(html.indexOf('offer/gcsp-offer.css') < html.indexOf('offer-followup/gcsp-offer-followup.css'));
  for (const asset of ['/blocks/gcsp/offer/entry-harness.js', '/blocks/gcsp/offer-followup/gcsp-offer-followup.css']) {
    const loaded = await f.fetch(f.origin + asset); assert.equal(loaded.status, 200); await loaded.arrayBuffer();
  }
  const current = good((await f.request(f.path + f.query)).json);
  const reasons = good((await f.request(`${f.path}/decision-reasons${f.query}`)).json);
  assert.ok(reasons.reasons.some((reason) => reason.code === 'body-style'));
  const declined = await f.request(`${f.path}/decision`, { body: { commandId: 'decline-composed', runId: f.employee.runId,
    decision: 'decline', expectedOfferVersion: current.offerVersion, expectedHoldVersion: current.holdVersion,
    expectedQuoteVersion: current.quote.revisions.quote, reasonCode: 'body-style' } });
  assert.equal(declined.status, 200); good(declined.json);
  // Reload through the actual durable access lookup, independently of the POST's returned decision DTO.
  const reloaded = good((await f.request(f.path + f.query)).json); assert.equal(reloaded.state, 'declined');
  assert.match(reloaded.followup.decisionId, /^offer-decision:[a-f0-9]{64}$/);
  const selector = `?decisionId=${encodeURIComponent(reloaded.followup.decisionId)}`;
  const question = good((await f.request('/api/gcsp/offer-followup' + selector)).json);
  assert.equal(question.state, 'question'); assert.equal(question.question.policyVersion, f.employee.policyVersion);
  const dom = new JSDOM('<!doctype html><gcsp-offer></gcsp-offer>', { url: 'https://offer-composition.test/gcsp/offer' });
  const savedGlobals = new Map();
  for (const name of ['window', 'document', 'HTMLElement', 'CustomEvent', 'customElements', 'Node']) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
  }
  let dispose;
  t.after(() => { dispose?.(); dom.window.close(); for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const { mountOfferEntry } = await import('../../blocks/gcsp/offer/entry.js');
  const location = { href: `https://offer-composition.test/gcsp/offer?offerId=${encodeURIComponent(f.offer.offerId)}&runId=${encodeURIComponent(f.employee.runId)}`,
    assign() { assert.fail('Saving a follow-up must not navigate to a fabricated offer.'); } };
  const requests = [];
  const transport = (input, init = {}) => {
    const url = new URL(input, 'https://offer-composition.test'); assert.equal(url.origin, 'https://offer-composition.test');
    requests.push({ path: url.pathname, method: init.method || 'GET' });
    return f.fetch(f.origin + url.pathname + url.search, { ...init, headers: { ...init.headers, Cookie: f.session, Origin: f.origin } });
  };
  const root = dom.window.document.querySelector('gcsp-offer');
  dispose = mountOfferEntry(root, { fetch: transport, location, history: { replaceState() {} } });
  await waitFor(() => root.querySelector('.gcsp-followup-question'));
  const option = [...root.querySelectorAll('button, input')].find((node) => node.value === 'saloon' || node.textContent === 'Saloon');
  assert.ok(option); option.click();
  const confirm = root.querySelector('[data-followup-action="confirm"]'); assert.ok(confirm); assert.equal(confirm.disabled, false); confirm.click();
  await waitFor(() => root.querySelector('[data-followup-saved]'));
  const afterSave = (await f.request('/api/gcsp/offer-followup' + selector)).json;
  assert.equal(afterSave.status, 'unavailable'); assert.equal(afterSave.code, 'followup-evaluation-unavailable');
  const saved = afterSave.savedChange;
  assert.equal(saved.state, 'change-saved'); assert.equal(saved.briefVersion, 2);
  assert.equal(saved.change.path, 'preferences.body.value'); assert.equal(saved.change.after, 'saloon');
  assert.ok(requests.filter((request) => request.path === '/api/gcsp/manual/account').length >= 2);
  assert.ok(requests.some((request) => request.path === '/api/gcsp/offer-followup/confirm' && request.method === 'POST'));
  const briefs = good(await f.repository.query(f.employee, 'briefs', { employeeId: f.employee.employeeId }));
  assert.deepEqual(briefs.at(-1).essentials, briefs[0].essentials);
  const final = good((await f.request(f.path + f.query)).json); assert.deepEqual(final.followup, reloaded.followup);
});

test('composed offer access preserves Secure cookies and invalid-cookie, employee, origin and run refusals', async (t) => {
  const f = await setup(t);
  const jobs = good(await f.repository.query(f.employee, 'notification_outbox', { offerId: f.offer.offerId }));
  assert.equal(jobs.length, 1);
  const link = new URL(jobs[0].payload.offerLink, f.origin);
  const exchange = await f.request('/api/gcsp/offers/access', { session: '', body: { runId: f.employee.runId,
    offerId: f.offer.offerId, token: new URLSearchParams(link.hash.slice(1)).get('token') } });
  assert.equal(exchange.status, 200); assert.ok(exchange.headers.get('set-cookie').includes('; Secure'));
  assert.ok(exchange.headers.get('set-cookie').includes('; HttpOnly'));
  assert.ok(exchange.headers.get('set-cookie').includes('Path=/api/gcsp/offers'));
  const offerCookie = cookie(exchange.headers.get('set-cookie'));
  assert.equal((await f.request(f.path + f.query, { session: offerCookie })).status, 200);
  const invalid = `${f.session}; gcsp_offer_access=invalid`;
  // An unusable offer cookie falls back to the employee's own account authority, never beyond it.
  assert.equal((await f.request(f.path + f.query, { session: invalid })).status, 200);
  assert.equal((await f.request(`${f.path}/decision-reasons${f.query}`, { session: invalid })).status, 200);
  assert.equal((await f.request(f.path + f.query, { session: 'gcsp_offer_access=invalid' })).status, 404);
  assert.equal((await f.request(`${f.path}/decision-reasons${f.query}`, { origin: 'https://foreign.invalid' })).status, 403);
  const other = good(await f.identity.switchPrincipal(f.presenter, 'demo-alex', 'foreign-offer-reader'));
  assert.equal((await f.request(f.path + f.query, { session: cookie(other.setCookie) })).status, 404);
  assert.equal((await f.request(f.path + '?runId=foreign-run')).status, 409);
  const handle = `offer-decision:${'0'.repeat(64)}`;
  assert.equal((await f.request(`/api/gcsp/offer-followup?decisionId=${handle}`, { session: offerCookie })).status, 401);
  assert.equal((await f.request(`/api/gcsp/offer-followup?decisionId=${handle}&employeeId=forged`)).status, 400);
  assert.equal((await f.request(`/api/gcsp/offer-followup?decisionId=${handle}`, { session: cookie(other.setCookie) })).status, 404);
  assert.equal(good(await f.repository.query(f.employee, 'decisions')).length, 0);
});

test('account lists its offer and a leftover offer cookie does not hide account access', async (t) => {
  const f = await setup(t);
  const listed = good((await f.request('/api/gcsp/offers/current')).json);
  assert.deepEqual(listed.offers.map(({ offerId, runId }) => ({ offerId, runId })), [{ offerId: f.offer.offerId, runId: f.employee.runId }]);
  assert.equal((await f.request('/api/gcsp/offers/current', { session: null })).json.status === 'ok', false);
  assert.equal((await f.request('/api/gcsp/offers/current?runId=x')).json.status, 'invalid');
  const stale = `${f.session}; gcsp_offer_access=leftover-from-an-earlier-offer`;
  const read = good((await f.request(f.path + f.query, { session: stale })).json);
  assert.equal(read.offerId, f.offer.offerId); assert.equal(read.state, 'pending');
});
