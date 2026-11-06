import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createStoredSubjectRecommendationEvaluator } from '../gcsp/recommendation/index.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { verifyOfferToken } from '../gcsp/offers/offer-token.js';
import { createOfferAccessService } from '../gcsp/offers/access.js';
import { createOfferAccessHandler } from '../gcsp/offers/access-http.js';
import { OfferDecisionService, DECLINE_REASONS_KEY, DECISION_EVENTS } from '../gcsp/offers/decision.js';
import { createOfferDecisionHandler } from '../gcsp/offers/decision-http.js';
import { stock, essential, preference } from './helpers/employee-recommendation.js';

if (!process.env.FUCQ106_MODULE_MAP) throw Error('Use the reviewed FUCQ-106 integration supervisor.');
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
const reviewedInput = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq106/reviewed-offer-decline-reasons-v1.proposal.json', import.meta.url)));
const yes = (out) => {
  assert.equal(out.status, 'ok', `Expected ok, received ${out.status}: ${out.code ?? out.reason ?? 'safe refusal'}`);
  return out.value;
};
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const read = async (f, table, key = {}) => yes(await f.repository.read(f.context, ref(f, table, key)));
const rows = async (f, table, filter = {}) => yes(await f.repository.query(f.context, table, filter));
const digest = (f) => inputDigest(f.store.state);
const cookieOf = (exchanged) => exchanged.setCookie.split(';')[0];

async function setup(t, { withReasons = true } = {}) {
  const alternative = structuredClone(seed);
  // Explicit alternative PolicyService input only. No reviewed registry is imported,
  // no provider publication/activation is performed, and canonical adoption stays open.
  if (withReasons) alternative.assumptions.push({ ...structuredClone(reviewedInput.definitions[0]),
    policyVersion: alternative.policyVersion, effectiveFrom: alternative.effectiveFrom });
  const provider = { versions: [alternative], async loadVersions() { return this.versions; } };
  const policy = new PolicyService({ provider });
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  yes(await repository.open()); t.after(() => repository.close());
  let wall = '2026-11-05T12:00:00.000Z';
  const { clock, identity } = yes(await createDemoRuntime({ repository, policy,
    environmentId: 'actual-offer-decision-integration', environmentKind: 'synthetic',
    policyAsOf: wall, commandId: 'integration-bootstrap', sessionNow: () => wall }));
  const presenter = yes(await identity.createPresenterSession('integration-presenter'));
  const context = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'integration-paula')).context;
  yes(await seedManualDemoContext({ repository, identity, clock, context }));
  const initial = yes(await clock.now(context));
  yes(await clock.advance(presenter.context, { commandId: 'integration-noon', expectedClockVersion: initial.clockVersion,
    bySeconds: (Date.parse(wall) - Date.parse(initial.now)) / 1000 }));
  const brief = new BriefService({ repository, policy, clock, identity });
  yes(await brief.saveDraft(context, { commandId: 'integration-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  yes(await brief.confirm(context, { commandId: 'integration-confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } }));
  const f = { repository, store, policy, provider, alternative, clock, identity, context, presenter, brief };
  f.insertCar = async (id) => {
    const car = stock(id);
    yes(await repository.transaction(context, { commandId: `release-${id}`, inputDigest: inputDigest(id) },
      (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: String(9000000 + id),
        configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
        facts: car.snapshot, release: { eventId: `synthetic-release-${id}`, availability: car.availability },
        visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
    return car;
  };
  f.car = await f.insertCar(1);
  const employee = await read(f, 'employees', { employeeId: context.employeeId });
  const slot = await read(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId });
  f.producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
  f.claimInput = { commandId: 'integration-allocate', orderUuid: f.car.orderUuid, expectedBriefVersion: 1,
    expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version };
  f.produced = yes(await f.producer.allocate(context, f.claimInput));
  const jobs = await rows(f, 'notification_outbox'); assert.equal(jobs.length, 1);
  // The actual producer outbox owns the raw link. Never include it or its token in assertions/logs.
  const link = new URL(jobs[0].payload.offerLink, 'https://explicit-synthetic.test');
  const token = new URLSearchParams(link.hash.slice(1)).get('token');
  assert.equal(typeof token, 'string'); assert.equal(token.length, 43);
  f.selector = { runId: link.searchParams.get('runId'), offerId: link.searchParams.get('offerId') };
  assert.equal(f.selector.offerId, f.produced.offer.offerId);
  f.access = createOfferAccessService({ repository, policy, clock, identity, environmentId: context.environmentId,
    sessionNow: () => wall, verifyOfferToken });
  f.exchanged = yes(await f.access.exchange({ ...f.selector, token }));
  f.tokenContext = yes(await f.access.fromSession(f.selector, cookieOf(f.exchanged))).context;
  f.accountContext = yes(await f.access.fromAccount(context, f.selector)).context;
  f.service = new OfferDecisionService({ repository, policy, clock, access: f.access,
    createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator, mode: 'local-synthetic' });
  f.input = (decision = 'decline', commandId = 'decision-1', extra = {}) => ({ ...f.selector, commandId, decision,
    ...(decision === 'decline' ? { reasonCode: 'body-style' } : {}), expectedOfferVersion: f.produced.offer.version,
    expectedHoldVersion: f.produced.hold.version, expectedQuoteVersion: f.produced.quote.version, ...extra });
  f.advanceTo = async (instant, commandId) => {
    const time = yes(await clock.now(context));
    return clock.advance(presenter.context, { commandId, expectedClockVersion: time.clockVersion,
      bySeconds: (Date.parse(instant) - Date.parse(time.now)) / 1000 });
  };
  f.tick = async (eventId) => {
    const time = yes(await clock.now(context));
    return clock.tick(presenter.context, { eventId, inputDigest: inputDigest(eventId), expectedClockVersion: time.clockVersion });
  };
  f.setWall = (instant) => { wall = instant; };
  f.assertCustody = (value) => {
    assert.equal(JSON.stringify(value).includes(token), false);
    const credential = cookieOf(f.exchanged).split('=')[1];
    for (const [table, records] of Object.entries(store.state.tables)) {
      if (table !== 'notification_outbox') assert.equal(JSON.stringify(records).includes(token), false, table);
      assert.equal(JSON.stringify(records).includes(credential), false, table);
    }
  };
  return f;
}

async function patch(f, table, key, value) {
  return f.repository.transaction(f.context, { commandId: `patch:${table}:${inputDigest(value)}`, inputDigest: inputDigest(value) },
    async (tx) => { const row = await tx.get(ref(f, table, key));
      return row.status === 'ok' ? tx.compareAndSwap(ref(f, table, key), row.value.version, value) : row; });
}

function nextPolicy(f, change) {
  const version = structuredClone(f.alternative); version.policyVersion = 'integration-alternative-v2';
  version.effectiveFrom = '2026-11-05T00:00:00.000Z';
  for (const collection of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of version[collection]) { row.policyVersion = version.policyVersion; row.effectiveFrom = version.effectiveFrom; }
  }
  change(version); f.provider.versions = [f.alternative, version]; return version.policyVersion;
}

test('actual producer token acceptance uses stored subject and account replay keeps one immutable outcome', async (t) => {
  const f = await setup(t); const quote = await read(f, 'quotes', { quoteId: f.produced.quote.quoteId });
  const employee = await read(f, 'employees', { employeeId: f.context.employeeId });
  const input = f.input('accept'); const accepted = await f.service.decide(f.tokenContext, input);
  const outcome = yes(accepted); assert.equal(outcome.state, 'accepted');
  assert.deepEqual(await f.service.decide(f.accountContext, input), accepted);
  assert.equal(yes(await f.access.read(f.accountContext)).state, 'accepted');
  assert.deepEqual(await read(f, 'quotes', { quoteId: quote.quoteId }), quote);
  assert.deepEqual(await read(f, 'employees', { employeeId: f.context.employeeId }), employee);
  assert.equal((await read(f, 'holds', { holdId: f.produced.hold.holdId })).state, 'allocated');
  assert.equal((await read(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId })).state, 'allocated');
  assert.equal((await rows(f, 'decisions')).length, 1);
  const events = await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS });
  assert.equal(events.length, 1); assert.equal(events[0].eventType, 'offer-accepted');
  f.assertCustody(outcome);
  if (process.env.FUCQ106_ACCEPT_SAMPLE) await writeFile(process.env.FUCQ106_ACCEPT_SAMPLE, JSON.stringify(outcome));
});

test('actual account decline and token replay release once with typed reason and separate brief', async (t) => {
  const f = await setup(t); const briefs = await rows(f, 'briefs'); const input = f.input();
  const declined = await f.service.decide(f.accountContext, input); const outcome = yes(declined);
  assert.equal(outcome.state, 'declined'); assert.deepEqual(await f.service.decide(f.tokenContext, input), declined);
  assert.equal((await f.service.decide(f.tokenContext, { ...input, reasonCode: 'fuel' })).status, 'conflict');
  const conflict = await f.service.decide(f.tokenContext, f.input('accept', 'opposite'));
  assert.equal(conflict.status, 'conflict'); assert.equal(conflict.current.state, 'declined');
  assert.equal((await read(f, 'stock', { orderUuid: f.car.orderUuid })).available, true);
  const decision = (await rows(f, 'decisions'))[0]; assert.equal(decision.reason.code, 'body-style');
  assert.equal(decision.versions.exclusion.key, 'offer.declinedCar.exclusion');
  assert.deepEqual(await rows(f, 'briefs'), briefs);
  assert.equal(yes(await f.access.read(f.tokenContext)).state, 'declined');
  assert.equal((await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS })).length, 1);
  f.assertCustody(outcome);
  if (process.env.FUCQ106_DECLINE_SAMPLE) await writeFile(process.env.FUCQ106_DECLINE_SAMPLE, JSON.stringify(outcome));
});

test('real token and account concurrent retries and contradiction create one decision and event', async (t) => {
  const f = await setup(t); const input = f.input();
  const results = await Promise.all([f.service.decide(f.tokenContext, input), f.service.decide(f.accountContext, input),
    f.service.decide(f.accountContext, f.input('accept', 'contradiction'))]);
  yes(results[0]); assert.deepEqual(results[0], results[1]); assert.equal(results[2].status, 'conflict');
  assert.equal((await rows(f, 'decisions')).length, 1);
  assert.equal((await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS })).length, 1);
});

test('actual accepted slot prevents a new buddy allocation for another released car', async (t) => {
  const f = await setup(t); yes(await f.service.decide(f.accountContext, f.input('accept')));
  const car = await f.insertCar(2); const employee = await read(f, 'employees', { employeeId: f.context.employeeId });
  const slot = await read(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId });
  const before = digest(f);
  const out = await f.producer.allocate(f.context, { ...f.claimInput, commandId: 'new-hold-after-selection',
    orderUuid: car.orderUuid, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version });
  assert.notEqual(out.status, 'ok'); assert.equal(digest(f), before);
  assert.equal((await rows(f, 'holds')).length, 1); assert.equal((await rows(f, 'offers')).length, 1);
});

test('actual quote expiry refuses acceptance but keeps decline available until the hold deadline', async (t) => {
  const f = await setup(t); yes(await f.producer.start());
  yes(await f.advanceTo(f.produced.quote.validUntil, 'quote-expiry')); yes(await f.tick('quote-expiry-tick'));
  const projection = yes(await f.access.read(f.tokenContext));
  assert.equal(projection.holdState, 'active'); assert.deepEqual(projection.availableActions, ['decline']);
  const before = digest(f); const accepted = await f.service.decide(f.tokenContext, f.input('accept'));
  assert.equal(accepted.reason, 'quote-no-longer-valid'); assert.equal(digest(f), before);
  assert.equal(yes(await f.service.decide(f.accountContext, f.input())).state, 'declined');
});

test('exact hold deadline refuses a new decision and actual producer expiry records no decline or priority', async (t) => {
  const f = await setup(t); const employee = await read(f, 'employees', { employeeId: f.context.employeeId });
  yes(await f.advanceTo(f.produced.hold.expiresAt, 'hold-deadline'));
  const before = digest(f); const out = await f.service.decide(f.tokenContext, f.input());
  assert.equal(out.reason, 'deadline-passed'); assert.equal(out.current.state, 'expired'); assert.equal(digest(f), before);
  assert.deepEqual(yes(await f.access.read(f.accountContext)).availableActions, []);
  yes(await f.producer.start()); yes(await f.tick('actual-expiry'));
  assert.equal((await read(f, 'offers', { offerId: f.selector.offerId })).state, 'expired');
  assert.equal((await read(f, 'holds', { holdId: f.produced.hold.holdId })).state, 'expired');
  assert.equal((await read(f, 'stock', { orderUuid: f.car.orderUuid })).available, true);
  assert.equal((await rows(f, 'decisions')).length, 0);
  assert.equal((await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS })).length, 0);
  assert.equal((await rows(f, 'event_receipts', { consumerId: 'buddy-expiry' })).length, 1);
  assert.deepEqual(await read(f, 'employees', { employeeId: f.context.employeeId }), employee);
  assert.equal((await f.service.decide(f.accountContext, f.input('accept', 'after-expiry'))).current.state, 'expired');
});

test('real capability branding and ownership refuse another employee and a copied token context', async (t) => {
  const f = await setup(t); const other = yes(await f.identity.switchPrincipal(f.presenter.context, 'demo-alex', 'other-employee'));
  const before = digest(f);
  assert.equal((await f.access.fromAccount(other.context, f.selector)).status, 'not-found');
  assert.equal((await f.service.decide({ ...f.tokenContext }, f.input())).status, 'not-found');
  const foreign = { ...f.input(), offerId: 'another-offer' };
  assert.equal((await f.service.decide(f.tokenContext, foreign)).status, 'not-found');
  assert.equal(digest(f), before);
});

test('real cookie expiry and current account authorization precede decision replay', async (t) => {
  const f = await setup(t); const input = f.input(); yes(await f.service.decide(f.accountContext, input));
  f.setWall('2026-11-08T12:00:00.000Z'); const before = digest(f);
  assert.notEqual((await f.service.decide(f.tokenContext, input)).status, 'ok');
  assert.notEqual((await f.service.decide(f.accountContext, input)).status, 'ok');
  assert.equal(digest(f), before);
});

test('real reset refuses old producer token and account decisions without reviving the offer', async (t) => {
  const f = await setup(t); const state = yes(await f.clock.readState(f.presenter.context));
  yes(await f.clock.reset(f.presenter.context, { commandId: 'integration-reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture }));
  const before = digest(f);
  for (const cap of [f.tokenContext, f.accountContext]) {
    assert.equal((await f.service.decide(cap, f.input())).status, 'stale-run');
  }
  assert.equal(digest(f), before);
});

test('actual held quote prices survive alternative current policy while eligibility changes refuse selection', async (t) => {
  const f = await setup(t); const quote = await read(f, 'quotes', { quoteId: f.produced.quote.quoteId });
  const version = nextPolicy(f, (policy) => {
    for (const row of policy.pricePlans) { row.monthlyPoints *= 10; row.value = row.monthlyPoints; }
  });
  yes(await patch(f, 'runs', {}, { policyVersion: version }));
  yes(await f.service.decide(f.tokenContext, f.input('accept')));
  assert.deepEqual(await read(f, 'quotes', { quoteId: quote.quoteId }), quote);
  const changed = await setup(t); const blocked = nextPolicy(changed, (policy) => {
    for (const row of policy.eligibilityRules) if (row.value === 'G21 Touring|320i') row.effect = 'exclude';
  });
  yes(await patch(changed, 'runs', {}, { policyVersion: blocked })); const before = digest(changed);
  assert.equal((await changed.service.decide(changed.accountContext, changed.input('accept'))).reason, 'current-eligibility-refused');
  assert.equal(digest(changed), before);
});

test('actual access and decision reasons use the alternative current reason pin separately from held price policy', async (t) => {
  const f = await setup(t); const quote = await read(f, 'quotes', { quoteId: f.produced.quote.quoteId });
  const version = nextPolicy(f, (policy) => {
    policy.assumptions.find((r) => r.key === DECLINE_REASONS_KEY).value.reasons[0].label = 'Current alternative reason';
  });
  yes(await patch(f, 'runs', {}, { policyVersion: version }));
  const projected = yes(await f.service.readReasons(f.tokenContext, f.selector));
  assert.equal(projected.policyVersion, version); assert.equal(projected.reasons[0].label, 'Current alternative reason');
  const out = yes(await f.service.decide(f.accountContext, f.input()));
  const decision = await read(f, 'decisions', { decisionId: out.decisionId });
  assert.equal(decision.reason.policyVersion, version); assert.equal(decision.versions.exclusion.policyVersion, version);
  assert.deepEqual(await read(f, 'quotes', { quoteId: quote.quoteId }), quote);
  const missing = await setup(t, { withReasons: false }); const before = digest(missing);
  assert.equal((await missing.service.decide(missing.tokenContext, missing.input())).code, 'decline-reasons-unavailable');
  assert.equal(digest(missing), before);
});

test('in-process access and decision HTTP use the same real capability, exact origin and fail-closed cookie resolution', async (t) => {
  const f = await setup(t); const origin = 'https://explicit-synthetic.test'; let accountFallbacks = 0;
  const accessHandler = createOfferAccessHandler({ service: f.access, identity: f.identity, allowedOrigins: [origin] });
  const decisionHandler = createOfferDecisionHandler({ service: f.service, allowedOrigins: [origin],
    resolveAccess: async ({ selector, cookie }) => {
      if (cookie?.includes('gcsp_offer_access=')) {
        const access = await f.access.fromSession(selector, cookie);
        return access.status === 'ok' ? ok({ context: access.value.context }) : access;
      }
      accountFallbacks += 1; const access = await f.access.fromAccount(f.context, selector);
      return access.status === 'ok' ? ok({ context: access.value.context }) : access;
    } });
  const invoke = async (handler, method, suffix, body, cookie = cookieOf(f.exchanged), requestOrigin = origin) => {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]); req.method = method;
    req.headers = { origin: requestOrigin, cookie, 'content-type': 'application/json' };
    const headers = {}; const res = { setHeader: (key, value) => { headers[key] = value; } }; let response;
    const url = new URL(`/api/gcsp/offers/${f.selector.offerId}${suffix.startsWith('?') ? '' : '/'}${suffix}`, origin);
    await handler({ req, res, pathname: url.pathname, searchParams: url.searchParams, gateAuthorized: true,
      sendJson: (_res, status, value) => { response = { status, value, headers }; } });
    return response;
  };
  const access = await invoke(accessHandler, 'GET', `?runId=${f.context.runId}`);
  assert.equal(access.status, 200); assert.deepEqual(access.value.value.availableActions, ['accept', 'decline']);
  const { offerId, ...body } = f.input();
  const bad = await invoke(decisionHandler, 'POST', 'decision', body, 'gcsp_offer_access=invalid');
  assert.equal(bad.status, 404); assert.equal(accountFallbacks, 0);
  const forbidden = await invoke(decisionHandler, 'POST', 'decision', body, cookieOf(f.exchanged), 'https://foreign.test');
  assert.equal(forbidden.status, 403);
  const accepted = await invoke(decisionHandler, 'POST', 'decision', body);
  assert.equal(accepted.status, 200); assert.equal(accepted.value.value.state, 'declined');
  assert.equal(accepted.headers['Cache-Control'], 'no-store'); assert.equal(accepted.headers['Referrer-Policy'], 'no-referrer');
  f.assertCustody(accepted.value);
});
