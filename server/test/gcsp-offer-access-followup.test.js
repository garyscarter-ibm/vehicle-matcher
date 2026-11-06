// The reviewed launcher executes these assertion cases sequentially and stops
// before invoking another case on any assertion or teardown failure.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createStoredSubjectRecommendationEvaluator } from '../gcsp/recommendation/index.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { verifyOfferToken } from '../gcsp/offers/offer-token.js';
import { createOfferAccessService } from '../gcsp/offers/access.js';
import { OfferDecisionService, DECISION_EVENTS } from '../gcsp/offers/decision.js';
import { createOfferFollowupService } from '../gcsp/offers/followup.js';
import { stock, essential, preference } from './helpers/employee-recommendation.js';

if (!process.env.FUCQ102_FOLLOWUP_MODULE_MAP) throw Error('Use the reviewed FUCQ-102 follow-up supervisor.');
export const followupEntryCases = [];
const test = (name, run) => followupEntryCases.push(Object.freeze({ name, run }));
const questionBundle = JSON.parse(await readFile(new URL('../gcsp/offers/followup-policy-definitions.json', import.meta.url), 'utf8'));
const yes = (out) => { assert.equal(out.status, 'ok', `Expected ok, received ${out.status}`); return out.value; };
const cookieOf = (exchanged) => exchanged.setCookie.split(';')[0];
const briefInput = () => ({ schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } });
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const stateDigest = (f) => inputDigest(f.store.state);

async function setup(t, { reviseBeforeDecline = false, decline = true } = {}) {
  const store = createMemoryStore(); const raw = createMemoryRepository({ store }); yes(await raw.open());
  t.after(() => raw.close()); const hooks = {};
  const repository = { ...raw,
    async query(...args) { const out = await raw.query(...args); await hooks.query?.(...args, out); return out; },
    async read(...args) { const out = await raw.read(...args); await hooks.read?.(...args, out); return out; } };
  const provider = new MemoryPolicyProvider({ store: createMemoryPolicyStore() }); const policy = new PolicyService({ provider });
  let wall = '2026-11-06T09:00:00.000Z';
  const { clock, identity } = yes(await createDemoRuntime({ repository, policy, environmentId: 'followup-entry-proof',
    environmentKind: 'synthetic', policyAsOf: wall, commandId: 'bootstrap', sessionNow: () => wall }));
  const presenter = yes(await identity.createPresenterSession('presenter'));
  let context = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula')).context;
  yes(await seedManualDemoContext({ repository, identity, clock, context }));
  const initial = yes(await clock.now(context));
  yes(await clock.advance(presenter.context, { commandId: 'morning', expectedClockVersion: initial.clockVersion,
    bySeconds: (Date.parse(wall) - Date.parse(initial.now)) / 1000 }));
  const brief = new BriefService({ repository, policy, clock, identity });
  yes(await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: briefInput() }));
  yes(await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } }));
  const car = stock(1);
  yes(await repository.transaction(context, { commandId: 'stock', inputDigest: inputDigest('stock') },
    (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: '9000001', configurationId: car.configurationId,
      state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
      release: { eventId: 'explicit-synthetic-release', availability: car.availability },
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
  const f = { store, repository, raw, hooks, policy, clock, identity, context, presenter, brief, car };
  const employee = yes(await raw.read(context, ref(f, 'employees', { employeeId: context.employeeId })));
  const slot = yes(await raw.read(context, ref(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId })));
  const producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
  f.produced = yes(await producer.allocate(context, { commandId: 'allocate', orderUuid: car.orderUuid,
    expectedBriefVersion: 1, expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version }));
  // Only the real producer outbox supplies credentials. No links or credentials enter diagnostics.
  const jobs = yes(await raw.query(context, 'notification_outbox')); assert.equal(jobs.length, 1);
  const link = new URL(jobs[0].payload.offerLink, 'https://explicit-synthetic.test');
  f.selector = { runId: link.searchParams.get('runId'), offerId: link.searchParams.get('offerId') };
  f.options = { repository, policy, clock, identity, environmentId: context.environmentId, sessionNow: () => wall, verifyOfferToken };
  f.access = createOfferAccessService(f.options);
  f.exchanged = yes(await f.access.exchange({ ...f.selector, token: new URLSearchParams(link.hash.slice(1)).get('token') }));
  f.account = yes(await f.access.fromAccount(context, f.selector)).context;
  if (reviseBeforeDecline) {
    yes(await brief.saveDraft(context, { commandId: 'draft-2', expectedBriefVersion: 1, expectedDraftVersion: 1, brief: briefInput() }));
    yes(await brief.confirm(context, { commandId: 'confirm-2', expectedBriefVersion: 1, expectedDraftVersion: 2, consent: { search: true, hold: true } }));
  }
  const greg = yes(await identity.switchPrincipal(presenter.context, 'demo-greg', 'greg')).context;
  const time = yes(await clock.now(context));
  yes(await policy.withPublicationPorts({ identity, clock, repository }).adoptReviewedAssumptions(greg, {
    commandId: 'adopt-reasons', expectedActiveVersion: f.produced.quote.policyVersion, policyVersion: 'entry-reasons-v2',
    effectiveFrom: time.now, definitionSetId: 'offer-decline-reasons-v1' }));
  // Real identity reissues the ordinary employee context with the now-active policy pin.
  context = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula-current')).context; f.context = context;
  f.decisions = new OfferDecisionService({ repository, policy, clock, access: f.access,
    createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator, mode: 'local-synthetic' });
  f.command = { ...f.selector, commandId: 'decline', decision: 'decline', reasonCode: 'body-style',
    expectedOfferVersion: f.produced.offer.version, expectedHoldVersion: f.produced.hold.version, expectedQuoteVersion: f.produced.quote.version };
  if (decline) f.declined = yes(await f.decisions.decide(f.exchanged.context, f.command));
  // Explicit 107-owned question input; this does not prove canonical question registration/default runtime adoption.
  const followupPolicy = { async getAssumption(key, read) {
    return key === 'offer.followupQuestions.v1' ? { status: 'ok', policyVersion: read.policyVersion, value: questionBundle.definitions[0] }
      : policy.getAssumption(key, read);
  } };
  f.followup = createOfferFollowupService({ repository, policy: followupPolicy, clock, identity, brief });
  f.handle = () => ({ decisionId: f.declined.decisionId });
  f.source = () => ({ decision: store.state.tables.decisions.find((row) => row.offerId === f.selector.offerId),
    receipt: store.state.tables.event_receipts.find((row) => row.consumerId === DECISION_EVENTS),
    offer: store.state.tables.offers.find((row) => row.offerId === f.selector.offerId),
    hold: store.state.tables.holds.find((row) => row.holdId === f.produced.hold.holdId),
    history: store.state.tables.briefs.find((row) => row.employeeId === context.employeeId && row.briefVersion === (reviseBeforeDecline ? 2 : 1)),
    slot: store.state.tables.entitlement_slots.find((row) => row.entitlementSlotId === context.entitlementSlotId) });
  f.advance = async (seconds) => {
    const now = yes(await clock.now(context));
    yes(await clock.advance(presenter.context, { commandId: `advance-${now.clockVersion}`, expectedClockVersion: now.clockVersion, bySeconds: seconds }));
  };
  f.expireCookie = () => { wall = '2027-11-06T09:00:00.000Z'; };
  f.restoreWall = () => { wall = '2026-11-06T09:00:00.000Z'; };
  return f;
}

async function corruptions(f, variants) {
  const baseline = structuredClone(f.store.state);
  for (const [name, alter] of variants) {
    f.store.state = structuredClone(baseline); alter(f.source(), f.store.state.tables);
    const before = stateDigest(f); const read = await f.access.read(f.account);
    assert.equal(read.status, 'ok', name); assert.equal(read.value.state, 'declined', name);
    assert.equal(read.value.followup, null, name); assert.deepEqual(read.value.availableActions, [], name);
    assert.equal(stateDigest(f), before, `${name}: read mutated state`);
  }
  f.store.state = baseline;
}

test('actual 100/106 decline survives a lost response and cookie/account reload into employee-only 107', async (t) => {
  const f = await setup(t); const before = stateDigest(f);
  const { history, slot, receipt } = f.source();
  assert.equal(history.renewalId ?? null, null); assert.equal(f.context.renewalId ?? null, null);
  assert.equal(typeof slot.renewalId, 'string'); assert.equal(receipt.outcome.value.event.renewalId, slot.renewalId);
  // Ignore the POST result at entry: the selector comes solely from the authoritative read.
  const dto = yes(await f.access.read(f.account)); assert.deepEqual(dto.followup, f.handle());
  const restarted = createOfferAccessService(f.options);
  const cookieRead = yes(await restarted.fromSession(f.selector, cookieOf(f.exchanged))).offer;
  assert.deepEqual(cookieRead.followup, dto.followup);
  assert.deepEqual(yes(await restarted.fromAccount(f.context, f.selector)).offer.followup, dto.followup);
  const question = yes(await f.followup.read(f.context, dto.followup)); assert.equal(question.state, 'question');
  assert.equal((await f.followup.read(f.exchanged.context, dto.followup)).status, 'forbidden');
  assert.equal(stateDigest(f), before);
  assert.deepEqual(Object.keys(dto.followup), ['decisionId']);
  assert.equal(/employeeId|eventId|consumerId|commandId|actorId|principalId|tokenHash/.test(JSON.stringify(dto)), false);
  const saved = yes(await f.followup.confirm(f.context, { commandId: 'answer', ...dto.followup,
    expectedBriefVersion: question.briefVersion, questionVersion: question.question.questionVersion, value: 'suv' }));
  assert.equal(saved.state, 'change-saved'); const afterSave = stateDigest(f);
  assert.deepEqual(yes(await restarted.fromSession(f.selector, cookieOf(f.exchanged))).offer.followup, dto.followup);
  const reload = await f.followup.read(f.context, dto.followup);
  assert.equal(reload.status, 'unavailable'); assert.deepEqual(reload.savedChange, saved);
  assert.equal(stateDigest(f), afterSave);
});

test('follow-up entry keeps the existing private instance, owner, selector and run authority', async (t) => {
  const f = await setup(t); const before = stateDigest(f);
  assert.equal((await f.access.read({ ...f.account })).status, 'not-found');
  assert.equal((await createOfferAccessService(f.options).read(f.account)).status, 'not-found');
  assert.equal((await f.access.authorizeOffer(f.account, { ...f.selector, offerId: 'other' })).status, 'not-found');
  const other = yes(await f.identity.switchPrincipal(f.presenter.context, 'demo-alex', 'alex')).context;
  assert.equal((await f.access.fromAccount(other, f.selector)).status, 'not-found');
  assert.equal((await f.followup.read(other, f.handle())).status, 'forbidden');
  // Session creation above owns its writes; the reads below own none.
  const afterSession = stateDigest(f); assert.notEqual(afterSession, before);
  f.expireCookie(); assert.equal((await f.access.fromSession(f.selector, cookieOf(f.exchanged))).status, 'not-found');
  assert.equal(stateDigest(f), afterSession); f.restoreWall();
  const state = yes(await f.clock.readState(f.presenter.context));
  yes(await f.clock.reset(f.presenter.context, { commandId: 'reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture }));
  assert.equal((await f.access.read(f.account)).status, 'stale-run');
});

test('active, accepted, expired, superseded and pending releases never query a follow-up selector', async (t) => {
  const f = await setup(t); const baseline = structuredClone(f.store.state); let queries = 0;
  f.hooks.query = (_scope, table) => { if (['decisions', 'event_receipts'].includes(table)) queries += 1; };
  for (const [offerState, holdState] of [['active', 'active'], ['accepted', 'allocated'], ['expired', 'expired'],
    ['superseded', 'released'], ['decision-pending', 'selection-pending'], ['release-pending', 'release-pending']]) {
    f.store.state = structuredClone(baseline); const { offer, hold } = f.source(); offer.state = offerState; hold.state = holdState;
    const before = stateDigest(f); assert.equal(yes(await f.access.read(f.account)).followup, null, offerState);
    assert.equal(stateDigest(f), before, offerState);
  }
  assert.equal(queries, 0);
});

test('confirmed historical decline brief can differ from the immutable quoted brief', async (t) => {
  const f = await setup(t, { reviseBeforeDecline: true });
  assert.equal(f.source().decision.versions.brief, 2); assert.equal(f.source().decision.versions.pinnedBrief, 1);
  assert.deepEqual(yes(await f.access.read(f.account)).followup, f.handle());
  assert.equal(yes(await f.followup.read(f.context, f.handle())).briefVersion, 2);
});

test('terminal outcome versions survive quote expiry and later car reuse without extending the hold', async (t) => {
  const f = await setup(t); const { decision, hold, offer } = f.source();
  assert.equal(decision.versions.offer + 1, offer.version); assert.equal(decision.versions.hold + 1, hold.version);
  assert.notEqual(decision.versions.policy, decision.versions.quotePolicy);
  const deadline = hold.expiresAt; const stockRow = f.store.state.tables.stock.find((row) => row.orderUuid === f.car.orderUuid);
  yes(await f.raw.transaction(f.context, { commandId: 'later-car-use', inputDigest: inputDigest('later-car-use') },
    (tx) => tx.compareAndSwap(ref(f, 'stock', { orderUuid: f.car.orderUuid }), stockRow.version, { state: 'allocated', available: false, allocated: true })));
  await f.advance(3 * 60 * 60); const before = stateDigest(f);
  const dto = yes(await f.access.read(f.account)); assert.equal(dto.state, 'declined');
  assert.deepEqual(dto.followup, f.handle()); assert.equal(dto.expiresAt, deadline); assert.equal(stateDigest(f), before);
});

test('missing, duplicate or malformed decision sources preserve declined status with no handle', async (t) => {
  const f = await setup(t);
  await corruptions(f, [
    ['missing decision', (_source, tables) => { tables.decisions = []; }],
    ['duplicate decision', ({ decision }, tables) => { tables.decisions.push({ ...decision, decisionId: `offer-decision:${'a'.repeat(64)}` }); }],
    ['accepted decision', ({ decision }) => { decision.decision = 'accept'; }],
    ['missing typed reason', ({ decision }) => { delete decision.reason; }],
    ['noncanonical handle', ({ decision }) => { decision.decisionId = 'employee-private-handle'; }],
    ['mismatched original result', ({ decision }) => { decision.originalResponse.value.decisionId = 'other'; }],
    ['missing original result', ({ decision }) => { delete decision.originalResponse; }],
    ['missing completed release reason', ({ hold }) => { delete hold.releaseReason; }],
    ['missing confirmed history', (_source, tables) => { tables.briefs = []; }],
    ['unconfirmed history', ({ history }) => { history.status = 'draft'; }],
    ['conflicting history renewal', ({ history }) => { history.renewalId = 'other-renewal'; }],
    ['malformed history renewal', ({ history }) => { history.renewalId = 7; }],
    ['conflicting slot owner', ({ slot }) => { slot.employeeId = 'other'; }],
    ['conflicting slot renewal', ({ slot }) => { slot.renewalId = 'other-renewal'; }],
    ['malformed slot renewal', ({ slot }) => { slot.renewalId = ''; }],
    ['changed slot version', ({ slot }) => { slot.version += 1; }],
    ['missing slot', (_source, tables) => { tables.entitlement_slots = []; }],
  ]);
});

test('only one complete native decline receipt with valid digest and pins supplies a handle', async (t) => {
  const f = await setup(t);
  await corruptions(f, [
    ['missing event', (_source, tables) => { tables.event_receipts = tables.event_receipts.filter((row) => row.consumerId !== DECISION_EVENTS); }],
    ['wrong namespace', ({ receipt }) => { receipt.consumerId = 'command:transaction'; }],
    ['wrong type', ({ receipt }) => { receipt.eventType = 'offer-accepted'; }],
    ['duplicate event', ({ receipt }, tables) => { tables.event_receipts.push({ ...structuredClone(receipt), eventId: 'other-event' }); }],
    ['incomplete receipt', ({ receipt }) => { receipt.state = 'pending'; }],
    ['bad digest', ({ receipt }) => { receipt.inputDigest = 'bad'; }],
    ['absent version pins', ({ receipt }) => { delete receipt.inputVersions; }],
    ['changed version pins', ({ receipt }) => { receipt.inputVersions.offer += 1; }],
    ['non-success event', ({ receipt }) => { receipt.outcome.status = 'unavailable'; }],
  ]);
});

test('valid digests cannot substitute a different employee, run, slot, renewal, car or brief', async (t) => {
  const f = await setup(t);
  await corruptions(f, ['employeeId', 'runId', 'entitlementSlotId', 'renewalId', 'orderUuid', 'offerId', 'holdId', 'quoteId', 'reasonCode', 'policyVersion', 'briefVersion']
    .map((key) => [key, ({ receipt }) => { receipt.outcome.value.event[key] = key === 'briefVersion' ? 99 : 'other';
      receipt.inputDigest = inputDigest(receipt.outcome.value.event); }]));
});

test('pre-write revisions, inconsistent outcome pins and future source times cannot supply a handle', async (t) => {
  const f = await setup(t);
  await corruptions(f, [
    ['pre-write offer', ({ decision }) => { decision.outcome.value.offerVersion = decision.versions.offer; decision.originalResponse = structuredClone(decision.outcome); }],
    ['pre-write hold', ({ decision }) => { decision.outcome.value.holdVersion = decision.versions.hold; decision.originalResponse = structuredClone(decision.outcome); }],
    ['quote revision', ({ decision }) => { decision.outcome.value.quoteVersion += 1; decision.originalResponse = structuredClone(decision.outcome); }],
    ['future event', ({ receipt }) => { receipt.outcome.value.event.occurredAt = '2027-11-06T00:00:00.000Z'; receipt.inputDigest = inputDigest(receipt.outcome.value.event); }],
    ['future brief', ({ history }) => { history.confirmedAt = '2027-11-06T00:00:00.000Z'; }],
    ['wrong history owner', ({ history }) => { history.employeeId = 'other'; }],
  ]);
});

test('repository query failures and unavailable history return typed unavailable without writes', async (t) => {
  const f = await setup(t); const originalQuery = f.repository.query; const originalRead = f.repository.read;
  for (const table of ['decisions', 'event_receipts', 'briefs', 'entitlement_slots']) {
    f.repository.query = async (...args) => args[1] === table ? { status: 'unavailable' } : originalQuery(...args);
    f.repository.read = async (...args) => args[1].table === table ? { status: 'unavailable' } : originalRead(...args);
    const before = stateDigest(f); assert.equal((await f.access.read(f.account)).status, 'unavailable', table);
    assert.equal(stateDigest(f), before, table);
  }
  f.repository.query = originalQuery; f.repository.read = originalRead;
});

test('decision membership, receipt membership, history and clock races refuse a mixed follow-up read', async (t) => {
  const f = await setup(t); const baseline = structuredClone(f.store.state);
  for (const kind of ['new-decision', 'new-event', 'changed-event', 'missing-history', 'new-history', 'slot-content', 'slot-version', 'clock', 'policy']) {
    f.store.state = structuredClone(baseline); f.hooks.query = null; f.hooks.read = null;
    if (kind === 'new-history') f.store.state.tables.briefs = [];
    f.hooks.query = async (_scope, table) => {
      if (table !== (kind === 'new-decision' ? 'decisions' : 'event_receipts')) return;
      f.hooks.query = null; const { decision, receipt } = f.source();
      if (kind === 'new-decision') f.store.state.tables.decisions.push({ ...decision, decisionId: `offer-decision:${'b'.repeat(64)}` });
      if (kind === 'new-event') f.store.state.tables.event_receipts.push({ ...structuredClone(receipt), eventId: 'new-event' });
      if (kind === 'changed-event') { receipt.version += 1; receipt.inputDigest = 'changed'; }
      if (kind === 'clock') await f.advance(1);
      if (kind === 'policy') { const run = f.store.state.tables.runs.find((row) => row.runId === f.context.runId); run.policyVersion = 'changed'; run.version += 1; }
    };
    if (['missing-history', 'new-history'].includes(kind)) f.hooks.read = (_scope, reference) => {
      if (reference.table !== 'briefs') return; f.hooks.read = null;
      if (kind === 'missing-history') f.store.state.tables.briefs = [];
      else f.store.state.tables.briefs = structuredClone(baseline.tables.briefs);
    };
    if (['slot-content', 'slot-version'].includes(kind)) f.hooks.read = (_scope, reference) => {
      if (reference.table !== 'entitlement_slots') return; f.hooks.read = null;
      const { slot } = f.source();
      if (kind === 'slot-content') slot.renewalId = 'changed'; else slot.version += 1;
    };
    assert.equal((await f.access.read(f.account)).status, 'unavailable', kind);
  }
});

Object.freeze(followupEntryCases);
