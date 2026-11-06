// REVIEW PROPOSAL ONLY. Canonical module path is server/test/gcsp-offer-decisions-canonical-adoption.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { activateRunPolicy } from '../gcsp/policy/activation.js';
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

if (!process.env.FUCQ106_CANONICAL_MODULE_MAP) throw Error('Use the reviewed FUCQ-106 integration supervisor.');
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
const yes = (out) => {
  assert.equal(out.status, 'ok', `Expected ok, received ${out.status}: ${out.code ?? out.reason ?? 'safe refusal'}`);
  return out.value;
};
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const read = async (f, table, key = {}) => yes(await f.repository.read(f.context, ref(f, table, key)));
const rows = async (f, table, filter = {}) => yes(await f.repository.query(f.context, table, filter));
const digest = (f) => inputDigest(f.store.state);
const cookieOf = (exchanged) => exchanged.setCookie.split(';')[0];

async function setup(t) {
  const policyStore = createMemoryPolicyStore();
  const provider = new MemoryPolicyProvider({ store: policyStore });
  const policy = new PolicyService({ provider });
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  yes(await repository.open()); t.after(() => repository.close());
  let wall = '2026-11-06T09:00:00.000Z';
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
  const f = { repository, store, policy, provider, policyStore, clock, identity, context, presenter, brief };
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
  f.writer = policy.withPublicationPorts({ identity, clock, repository });
  f.greg = yes(await identity.switchPrincipal(presenter.context, 'demo-greg', 'canonical-greg')).context;
  f.adopt = async () => {
    const time = yes(await clock.now(context));
    f.adoptionCommand ??= { commandId: 'canonical-reasons-adoption',
      expectedActiveVersion: f.produced.quote.policyVersion, policyVersion: 'fucq106-reasons-v2',
      effectiveFrom: time.now, definitionSetId: 'offer-decline-reasons-v1' };
    return f.writer.adoptReviewedAssumptions(f.greg, f.adoptionCommand);
  };
  return f;
}

async function publishChange(f, changes, version = 'fucq106-consumer-v3') {
  const previous = (await read(f, 'runs')).policyVersion;
  const time = yes(await f.clock.now(f.context));
  const effectiveFrom = new Date(Date.parse(time.now) + 1000).toISOString();
  yes(await f.advanceTo(effectiveFrom, `advance-${version}`));
  const input = { commandId: `publish-${version}`, expectedActiveVersion: previous,
    policyVersion: version, effectiveFrom, changes };
  yes(await f.writer.publishPolicyVersion(f.greg, input));
  yes(await activateRunPolicy({ repository: f.repository, policy: f.policy }, f.greg));
  assert.equal((await read(f, 'runs')).policyVersion, version);
  return input;
}

const provenance = { status: 'assumed', sourceDate: '2026-11-06',
  source: 'docs/gcsp/evidence/fucq106/canonical-adoption-plan.md',
  basis: 'Isolated consumer regression proving one-source current policy and retained quote provenance.' };

test('canonical adoption reaches actual 106 reasons and confirmed decline with the retained quote pin', async (t) => {
  const f = await setup(t);
  const originalQuote = await read(f, 'quotes', { quoteId: f.produced.quote.quoteId });
  const before = digest(f);
  assert.equal((await f.service.readReasons(f.tokenContext, f.selector)).code, 'decline-reasons-unavailable');
  assert.equal((await f.service.decide(f.accountContext, f.input())).code, 'decline-reasons-unavailable');
  assert.equal(digest(f), before);
  const adopted = yes(await f.adopt());
  assert.equal(adopted.activationRequired, false);
  assert.equal(adopted.activation.publishedVersionActive, true);
  assert.deepEqual(adopted.adoption.addedKeys, [DECLINE_REASONS_KEY]);
  const versionsBeforeReplay = inputDigest(await f.provider.loadVersions({ runId: f.context.runId }));
  assert.deepEqual(yes(await f.adopt()), adopted);
  assert.equal(inputDigest(await f.provider.loadVersions({ runId: f.context.runId })), versionsBeforeReplay);
  assert.equal((await read(f, 'runs')).policyVersion, 'fucq106-reasons-v2');
  const projected = yes(await f.service.readReasons(f.tokenContext, f.selector));
  const registered = yes(await f.policy.getAssumption(DECLINE_REASONS_KEY, {
    runId: f.context.runId, asOf: f.adoptionCommand.effectiveFrom, policyVersion: 'fucq106-reasons-v2' }));
  assert.deepEqual(projected.reasons, registered.value.reasons);
  assert.equal(projected.policyVersion, 'fucq106-reasons-v2');
  const response = await f.service.decide(f.tokenContext, f.input());
  const declined = yes(response); assert.equal(declined.state, 'declined');
  assert.deepEqual(await f.service.decide(f.accountContext, f.input()), response);
  const decision = await read(f, 'decisions', { decisionId: declined.decisionId });
  assert.equal(decision.reason.policyVersion, 'fucq106-reasons-v2');
  assert.equal(decision.versions.exclusion.policyVersion, 'fucq106-reasons-v2');
  assert.equal(decision.versions.quotePolicy, originalQuote.policyVersion);
  assert.deepEqual(await read(f, 'quotes', { quoteId: originalQuote.quoteId }), originalQuote);
  assert.equal((await read(f, 'stock', { orderUuid: f.car.orderUuid })).available, true);
  assert.equal((await rows(f, 'decisions')).length, 1);
  const events = await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS });
  assert.equal(events.length, 1); assert.equal(events[0].eventType, 'offer-declined');
  assert.equal(events[0].outcome.value.event.policyVersion, 'fucq106-reasons-v2');
  f.assertCustody(response);
});

test('actual same-provider publication changes current prices while canonical 106 acceptance retains the held terms', async (t) => {
  const f = await setup(t); yes(await f.adopt());
  const quote = await read(f, 'quotes', { quoteId: f.produced.quote.quoteId });
  // PolicyService takes known scalar car facts, rather than the typed snapshot envelope.
  const priceCar = { configurationId: quote.configurationId,
    ...Object.fromEntries(Object.entries(quote.facts.facts)
      .filter(([, fact]) => fact.status === 'known').map(([key, fact]) => [key, fact.value])) };
  const time = yes(await f.clock.now(f.context));
  const price = yes(await f.policy.getPointsCost(f.context, priceCar,
    { runId: f.context.runId, asOf: time.now, policyVersion: 'fucq106-reasons-v2' }));
  assert.equal(price.monthlyPoints, quote.monthlyPoints);
  const changedPoints = price.monthlyPoints + 100;
  await publishChange(f, [{ table: 'pricePlans', key: price.key,
    patch: { value: changedPoints, monthlyPoints: changedPoints, ...provenance } }]);
  const currentTime = yes(await f.clock.now(f.context));
  const current = yes(await f.policy.getPointsCost(f.context, priceCar,
    { runId: f.context.runId, asOf: currentTime.now, policyVersion: 'fucq106-consumer-v3' }));
  assert.equal(current.monthlyPoints, changedPoints);
  const out = yes(await f.service.decide(f.accountContext, f.input('accept')));
  assert.equal(out.state, 'accepted');
  const decision = await read(f, 'decisions', { decisionId: out.decisionId });
  assert.equal(decision.versions.policy, 'fucq106-consumer-v3');
  assert.equal(decision.versions.quotePolicy, quote.policyVersion);
  assert.deepEqual(await read(f, 'quotes', { quoteId: quote.quoteId }), quote);
  assert.equal((await read(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId })).state, 'allocated');
});

test('one real policy edit reaches the decision HTTP registry projection and preserves the earlier canonical decline', async (t) => {
  const f = await setup(t); yes(await f.adopt());
  const out = yes(await f.service.decide(f.accountContext, f.input()));
  const decision = await read(f, 'decisions', { decisionId: out.decisionId });
  const quote = await read(f, 'quotes', { quoteId: f.produced.quote.quoteId });
  const events = await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS });
  const time = yes(await f.clock.now(f.context));
  const prior = yes(await f.policy.getAssumption(DECLINE_REASONS_KEY,
    { runId: f.context.runId, asOf: time.now, policyVersion: 'fucq106-reasons-v2' }));
  const changed = structuredClone(prior.value); changed.reasons[0].label = 'Body shape';
  await publishChange(f, [{ table: 'assumptions', key: DECLINE_REASONS_KEY,
    patch: { value: changed, ...provenance } }]);
  const handler = createOfferDecisionHandler({ service: f.service,
    resolveAccess: async ({ selector, cookie }) => {
      const allowed = await f.access.fromSession(selector, cookie);
      return allowed.status === 'ok' ? ok({ context: allowed.value.context }) : allowed;
    } });
  const req = Readable.from([]); req.method = 'GET'; req.headers = { cookie: cookieOf(f.exchanged) };
  const headers = {}; const res = { setHeader: (key, value) => { headers[key] = value; } }; let response;
  await handler({ req, res, pathname: `/api/gcsp/offers/${f.selector.offerId}/decision-reasons`,
    searchParams: new URLSearchParams({ runId: f.context.runId }), gateAuthorized: true,
    sendJson: (_res, status, value) => { response = { status, value }; } });
  assert.equal(response.status, 200); const projected = yes(response.value);
  assert.equal(projected.policyVersion, 'fucq106-consumer-v3');
  assert.equal(projected.reasons[0].label, 'Body shape');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.deepEqual(await read(f, 'decisions', { decisionId: out.decisionId }), decision);
  assert.deepEqual(await read(f, 'quotes', { quoteId: quote.quoteId }), quote);
  assert.deepEqual(await rows(f, 'event_receipts', { consumerId: DECISION_EVENTS }), events);
  const retained = yes(await f.policy.getAssumption(DECLINE_REASONS_KEY,
    { runId: f.context.runId, asOf: time.now, policyVersion: 'fucq106-reasons-v2' }));
  assert.equal(retained.value.reasons[0].label, decision.reason.label);
  f.assertCustody(response.value);
});
