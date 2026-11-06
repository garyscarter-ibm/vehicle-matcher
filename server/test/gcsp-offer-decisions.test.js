import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { OfferDecisionService, DECLINE_REASONS_KEY, DECISION_EVENTS } from '../gcsp/offers/decision.js';
import { createOfferDecisionHandler } from '../gcsp/offers/decision-http.js';
import { preference, essential, stock } from './helpers/employee-recommendation.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
// Explicit alternative policy input exercises the proposed registry. It does not
// activate a production key or prove FUCQ-103 adoption.
const reasonInput = [{ code: 'body-style', label: 'Body style', attribute: 'body' },
  { code: 'size', label: 'Size', attribute: 'sizeClass' },
  { code: 'fuel', label: 'Fuel type', attribute: 'fuel' },
  { code: 'equipment', label: 'Equipment', attribute: 'equipment' }];
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const command = (commandId, input = {}) => ({ commandId, inputDigest: inputDigest(input) });
const yes = (outcome) => { assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value; };

async function setup({ reasons = reasonInput, evaluator = true } = {}) {
  const alternative = structuredClone(seed);
  if (reasons !== null) alternative.assumptions.push({ key: DECLINE_REASONS_KEY,
    value: { schemaVersion: 1, reasons }, unit: 'reason-registry', status: 'assumed',
    basis: 'Explicit FUCQ-106 contract-test input; not activated policy.',
    source: 'docs/gcsp/offer-decisions-contract.md', sourceDate: '2026-11-05',
    policyVersion: alternative.policyVersion, effectiveFrom: alternative.effectiveFrom });
  const provider = { versions: [alternative], async loadVersions() { return this.versions; } };
  const policy = new PolicyService({ provider });
  const store = createMemoryStore(); const repository = createMemoryRepository({ store }); yes(await repository.open());
  const runtime = yes(await createDemoRuntime({ repository, policy, environmentId: 'offer-decisions-test',
    environmentKind: 'synthetic', policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap',
    sessionNow: () => '2026-11-05T00:00:00.000Z' }));
  const { identity, clock } = runtime;
  const presenter = yes(await identity.createPresenterSession('presenter'));
  const context = yes(await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula')).context;
  const f = { repository, policy, store, identity, clock, context, presenter, alternative, provider };
  yes(await seedManualDemoContext({ repository, identity, clock, context }));
  const briefService = new BriefService({ repository, policy, clock, identity }); f.briefService = briefService;
  yes(await briefService.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') },
      essentials: { seats: essential(5), charging: { value: 'home', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } } }));
  const brief = yes(await briefService.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } })).brief;
  const time = yes(await clock.now(context));
  const car = stock(987); car.availability.availableFrom = time.now;
  const employee = yes(await repository.read(context, ref(f, 'employees', { employeeId: context.employeeId })));
  const employeeFacts = structuredClone(employee.contract.manualContext.employeeFacts);
  employeeFacts.driverEligible = employee.contract.manualContext.drivers.find((d) => d.kind === 'employee').eligible;
  const evaluated = yes(await briefService.evaluateCandidate(context, { candidate: car, employeeFacts }));
  assert.equal(evaluated.gateStatus, 'eligible', JSON.stringify(evaluated));
  const expiresAt = new Date(Date.parse(time.now) + 7200000).toISOString();
  yes(await repository.transaction(context, command('persist-synthetic-offer'), async (tx) => {
    let row = await tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid,
      configurationId: car.configurationId, orderNumber: '9000987', wholesalerOrderId: 90000987,
      revision: 'source-stock-v1', state: 'available', available: true, held: false, allocated: false,
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null },
      release: { availability: car.availability }, facts: car.snapshot });
    if (row.status !== 'ok') return row;
    const slot = await tx.get(ref(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
    if (slot.status !== 'ok') return slot;
    const quote = await tx.insert('quotes', { runId: context.runId, quoteId: 'quote-fixture',
      employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
      orderUuid: car.orderUuid, configurationId: car.configurationId, facts: evaluated.snapshot,
      eligibility: { decision: evaluated, employeeVersion: employee.version, slotVersion: slot.value.version, stockVersion: row.value.version },
      terms: evaluated.terms, briefVersion: brief.briefVersion, policyVersion: context.policyVersion,
      quotedAt: time.now, validUntil: evaluated.terms.validUntil, expiresAt: evaluated.terms.validUntil,
      monthlyPoints: evaluated.terms.points, allowance: evaluated.terms.allowanceInputs, provenance: evaluated.terms.provenance });
    if (quote.status !== 'ok') return quote;
    const held = await tx.conditionalClaim({ orderUuid: car.orderUuid, holdId: 'hold-fixture', claimId: 'claim-fixture',
      employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId, renewalId: slot.value.renewalId,
      type: 'buddy-offer', state: 'active', expiresAt, policyVersion: context.policyVersion, quoteId: 'quote-fixture',
      expectedStockVersion: row.value.version, expectedSlotVersion: slot.value.version });
    if (held.status !== 'ok') return held;
    row = await tx.compareAndSwap(ref(f, 'claims', { claimId: 'claim-fixture' }), held.value.claim.version, { renewalId: slot.value.renewalId });
    if (row.status !== 'ok') return row;
    row = await tx.compareAndSwap(ref(f, 'stock', { orderUuid: car.orderUuid }), held.value.stockVersion,
      { available: false, held: true, allocated: false });
    if (row.status !== 'ok') return row;
    return tx.insert('offers', { runId: context.runId, environmentId: context.environmentId,
      offerId: 'offer-fixture', holdId: 'hold-fixture', quoteId: 'quote-fixture',
      employeeId: context.employeeId, orderUuid: car.orderUuid, state: 'active',
      briefVersion: brief.briefVersion, policyVersion: context.policyVersion, expiresAt });
  }));
  f.car = car;
  // Scoped authenticated account port: every call checks real DemoIdentity ownership.
  // This is deliberately not claimed as FUCQ-102's private-branded capability proof.
  const caps = new WeakMap();
  f.capability = Object.freeze({ runId: context.runId, offerId: 'offer-fixture' }); caps.set(f.capability, context);
  f.access = { async authorizeOffer(capability, selector, action) {
    const owned = caps.get(capability);
    if (!owned || selector.runId !== capability.runId || selector.offerId !== capability.offerId) return result('not-found', {});
    const auth = await identity.authorizeResource(owned, ref(f, 'offers', { offerId: selector.offerId }), action === 'decide' ? 'write' : 'read');
    return auth.status === 'ok' ? ok({ runId: context.runId, offerId: selector.offerId, environmentId: context.environmentId }) : auth;
  } };
  f.brandAccount = (account) => { const cap = Object.freeze({ runId: context.runId, offerId: 'offer-fixture' }); caps.set(cap, account); return cap; };
  // Until the separate stored-subject export is admitted, exercise the actual
  // merged shared kernel with this genuine account context. No role fabrication,
  // unconditional gate success or token-route parity is hidden in the fixture.
  const sharedKernel = evaluator ? (options) => ({ async evaluate(subject, confirmedBrief) {
    for (const key of ['runId', 'environmentId', 'employeeId', 'companyId', 'schemeId', 'gradeId', 'policyVersion']) {
      assert.equal(subject[key], context[key]);
    }
    return createEmployeeRecommendationService(options).recommend(context, confirmedBrief);
  } }) : undefined;
  f.service = new OfferDecisionService({ repository, policy, clock, access: f.access,
    createStoredSubjectEvaluator: sharedKernel, mode: 'local-synthetic' });
  f.options = { repository, policy, clock, access: f.access, createStoredSubjectEvaluator: sharedKernel, mode: 'local-synthetic' };
  f.input = (decision = 'decline', commandId = 'decision-1', extra = {}) => ({ commandId, runId: context.runId,
    offerId: 'offer-fixture', decision, ...(decision === 'decline' ? { reasonCode: 'body-style' } : {}),
    expectedOfferVersion: 1, expectedHoldVersion: 1, expectedQuoteVersion: 1, ...extra });
  return f;
}

async function patch(f, table, key, value) {
  return f.repository.transaction(f.context, command(`patch:${table}:${inputDigest(value)}`), async (tx) => {
    const row = await tx.get(ref(f, table, key)); if (row.status !== 'ok') return row;
    return tx.compareAndSwap(ref(f, table, key), row.value.version, value);
  });
}
const read = async (f, table, key) => yes(await f.repository.read(f.context, ref(f, table, key)));
const state = (f) => structuredClone(f.store.state);

test('local decline atomically releases exact stock, records typed reason/exclusion and emits a native source event', async () => {
  const f = await setup(); const briefBefore = (await f.repository.query(f.context, 'briefs')).value;
  const out = yes(await f.service.decide(f.capability, f.input()));
  assert.equal(out.state, 'declined'); assert.equal(out.offerState, 'rejected'); assert.equal(out.holdState, 'released');
  assert.deepEqual(out.availableActions, []);
  const row = await read(f, 'decisions', { decisionId: out.decisionId });
  assert.equal(row.decision, 'decline'); assert.equal(row.reason.code, 'body-style'); assert.equal(row.versions.brief, 1);
  assert.equal(row.versions.exclusion.key, 'offer.declinedCar.exclusion');
  assert.deepEqual(row.originalResponse.value, out);
  const stockRow = await read(f, 'stock', { orderUuid: f.car.orderUuid });
  assert.deepEqual([stockRow.state, stockRow.available, stockRow.held, stockRow.allocated], ['released', true, false, false]);
  const events = yes(await f.repository.query(f.context, 'event_receipts', { consumerId: DECISION_EVENTS }));
  assert.equal(events.length, 1); assert.equal(events[0].eventType, 'offer-declined');
  assert.equal(events[0].outcome.value.event.reasonCode, 'body-style');
  assert.equal(events[0].inputDigest, inputDigest(events[0].outcome.value.event));
  assert.equal(yes(await f.repository.query(f.context, 'notification_outbox')).length, 0);
  assert.deepEqual(yes(await f.repository.query(f.context, 'briefs')), briefBefore);
  assert.ok(!JSON.stringify(out).includes(f.context.employeeId));
});

test('local acceptance uses real shared calculation, pins quote and allocates slot without changing current car', async () => {
  const f = await setup(); const quote = await read(f, 'quotes', { quoteId: 'quote-fixture' });
  const employee = await read(f, 'employees', { employeeId: f.context.employeeId });
  const out = yes(await f.service.decide(f.capability, f.input('accept')));
  assert.equal(out.state, 'accepted'); assert.equal(out.holdState, 'allocated');
  assert.equal((await read(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId })).state, 'allocated');
  assert.deepEqual(await read(f, 'quotes', { quoteId: 'quote-fixture' }), quote);
  assert.deepEqual(await read(f, 'employees', { employeeId: f.context.employeeId }), employee);
  const event = yes(await f.repository.query(f.context, 'event_receipts', { consumerId: DECISION_EVENTS }))[0];
  assert.equal(event.eventType, 'offer-accepted'); assert.equal(event.outcome.value.event.reasonCode, null);
});

test('same command replays original outcome across reopen; changed input and new conflicting decision preserve terminal state', async () => {
  const f = await setup(); const input = f.input(); const out = await f.service.decide(f.capability, input);
  yes(out); const committed = state(f);
  await f.repository.close(); yes(await f.repository.open());
  assert.deepEqual(await new OfferDecisionService(f.options).decide(f.capability, input), out);
  assert.equal((await f.service.decide(f.capability, { ...input, reasonCode: 'fuel' })).status, 'conflict');
  const opposite = await f.service.decide(f.capability, f.input('accept', 'another-command'));
  assert.equal(opposite.status, 'conflict'); assert.equal(opposite.current.state, 'declined');
  assert.deepEqual(state(f), committed);
});

test('concurrent duplicate and contradictory commands have one decision and one source event', async () => {
  const f = await setup(); const input = f.input();
  const results = await Promise.all([f.service.decide(f.capability, input), f.service.decide(f.capability, input),
    f.service.decide(f.capability, f.input('accept', 'other'))]);
  assert.deepEqual(results[0], results[1]); assert.equal(results[2].status, 'conflict');
  assert.equal(yes(await f.repository.query(f.context, 'decisions')).length, 1);
  assert.equal(yes(await f.repository.query(f.context, 'event_receipts', { consumerId: DECISION_EVENTS })).length, 1);
});

test('every caller-controlled decision pin is validated without consuming its ID on refusal', async () => {
  const f = await setup(); const before = state(f);
  for (const field of ['Offer', 'Hold', 'Quote']) {
    assert.equal((await f.service.decide(f.capability, f.input('decline', 'retryable', { [`expected${field}Version`]: 99 }))).status, 'stale-version');
    assert.deepEqual(state(f), before);
  }
  yes(await f.service.decide(f.capability, f.input('decline', 'retryable')));
});

test('fixed reasons and labels come only from actual PolicyService input; absent registry fails closed', async () => {
  const f = await setup({ reasons: [{ code: 'changed', label: 'Changed centrally', attribute: 'body' }] });
  const projected = yes(await f.service.readReasons(f.capability, { runId: f.context.runId, offerId: 'offer-fixture' }));
  assert.deepEqual(projected.reasons, [{ code: 'changed', label: 'Changed centrally', attribute: 'body' }]);
  assert.equal((await f.service.decide(f.capability, f.input())).status, 'invalid');
  yes(await f.service.decide(f.capability, f.input('decline', 'new', { reasonCode: 'changed' })));
  const missing = await setup({ reasons: null }); const before = state(missing);
  assert.equal((await missing.service.decide(missing.capability, missing.input())).code, 'decline-reasons-unavailable');
  assert.deepEqual(state(missing), before);
});

test('unbranded and cross-employee account contexts are refused by real identity ownership', async () => {
  const f = await setup(); const before = state(f);
  assert.equal((await f.service.decide({ ...f.capability }, f.input())).status, 'not-found');
  const other = yes(await f.identity.switchPrincipal(f.presenter.context, 'demo-greg', 'greg'));
  const afterSession = state(f);
  assert.notEqual((await f.service.decide(f.brandAccount(other.context), f.input())).status, 'ok');
  assert.deepEqual(state(f), afterSession);
  assert.equal(yes(await f.repository.query(f.context, 'decisions')).length, 0);
  assert.deepEqual(before.tables.offers, f.store.state.tables.offers);
});

test('deadline guard leaves expiry to its owner and never writes a decline or grants priority', async () => {
  const f = await setup(); const now = yes(await f.clock.now(f.context));
  yes(await f.clock.advance(f.presenter.context, { commandId: 'deadline', expectedClockVersion: now.clockVersion, bySeconds: 7200 }));
  const before = state(f); const out = await f.service.decide(f.capability, f.input());
  assert.equal(out.status, 'conflict'); assert.equal(out.reason, 'deadline-passed'); assert.equal(out.current.state, 'expired');
  assert.deepEqual(state(f), before);
});

test('expired and accepted rows cannot be revived by a contradictory decision', async () => {
  for (const terminal of ['expired', 'accepted']) {
    const f = await setup(); yes(await patch(f, 'offers', { offerId: 'offer-fixture' }, { state: terminal }));
    yes(await patch(f, 'holds', { holdId: 'hold-fixture' }, { state: terminal === 'accepted' ? 'allocated' : 'expired' }));
    yes(await patch(f, 'claims', { claimId: 'claim-fixture' }, { state: terminal === 'accepted' ? 'allocated' : 'expired' }));
    const before = state(f); const out = await f.service.decide(f.capability, f.input());
    assert.equal(out.status, 'conflict'); assert.equal(out.current.state, terminal); assert.deepEqual(state(f), before);
  }
});

test('inconsistent terminal authority and changed exact-stock facts refuse without mutation', async () => {
  const f = await setup(); yes(await patch(f, 'offers', { offerId: 'offer-fixture' }, { state: 'accepted' }));
  const inconsistent = state(f); assert.equal((await f.service.decide(f.capability, f.input())).code, 'offer-state-inconsistent');
  assert.deepEqual(state(f), inconsistent);
  const changed = await setup(); const snapshot = structuredClone(changed.car.snapshot); snapshot.facts.seats.value = 4;
  yes(await patch(changed, 'stock', { orderUuid: changed.car.orderUuid }, { facts: snapshot }));
  const before = state(changed); assert.equal((await changed.service.decide(changed.capability, changed.input('accept'))).code, 'offer-authority-inconsistent');
  assert.deepEqual(state(changed), before);
});

test('a clock change between access preparation and transactional recheck requests refresh', async () => {
  const f = await setup(); const clock = { async now(scope) {
    const captured = await f.clock.now(scope);
    yes(await f.clock.advance(f.presenter.context, { commandId: 'racing-clock',
      expectedClockVersion: captured.value.clockVersion, bySeconds: 1 }));
    return captured;
  } };
  const service = new OfferDecisionService({ ...f.options, clock });
  const before = (await f.repository.query(f.context, 'offers')).value;
  assert.equal((await service.decide(f.capability, f.input('accept'))).reason, 'clock-changed');
  assert.deepEqual(yes(await f.repository.query(f.context, 'offers')), before);
  assert.equal(yes(await f.repository.query(f.context, 'decisions')).length, 0);
});

test('remote and selection/release uncertainty keep stock exclusion with no optimistic decision', async () => {
  const f = await setup(); const service = new OfferDecisionService({ ...f.options, mode: 'remote' }); const before = state(f);
  assert.equal((await service.decide(f.capability, f.input())).code, 'remote-decision-protocol-required');
  assert.deepEqual(state(f), before);
  for (const [offerState, holdState] of [['decision-pending', 'selection-pending'], ['release-pending', 'release-pending']]) {
    yes(await patch(f, 'offers', { offerId: 'offer-fixture' }, { state: offerState, operationId: 'uncertain' }));
    yes(await patch(f, 'holds', { holdId: 'hold-fixture' }, { state: holdState, operationId: 'uncertain' }));
    yes(await patch(f, 'claims', { claimId: 'claim-fixture' }, { state: holdState, operationId: 'uncertain' }));
    const pending = state(f); const out = await f.service.decide(f.capability, f.input());
    assert.equal(out.status, 'conflict'); assert.equal(out.current.state, 'pending'); assert.equal(out.current.reconciliationRequired, true);
    assert.deepEqual(state(f), pending); assert.equal((await read(f, 'stock', { orderUuid: f.car.orderUuid })).available, false);
  }
});

test('revalidation refuses driver changes and missing evaluator without changing any authority', async () => {
  const missing = await setup({ evaluator: false }); const before = state(missing);
  assert.equal((await missing.service.decide(missing.capability, missing.input('accept'))).code, 'stored-subject-evaluator-not-configured');
  assert.deepEqual(state(missing), before);
  const f = await setup(); const employee = await read(f, 'employees', { employeeId: f.context.employeeId });
  employee.contract.manualContext.drivers.find((d) => d.kind === 'employee').eligible.value = false;
  yes(await patch(f, 'employees', { employeeId: f.context.employeeId }, { contract: employee.contract }));
  const changed = state(f); assert.equal((await f.service.decide(f.capability, f.input('accept'))).status, 'conflict');
  assert.deepEqual(state(f), changed);
});

test('conflicting current driver facts cannot bypass revalidation with an older eligible projection', async () => {
  const f = await setup(); const employee = await read(f, 'employees', { employeeId: f.context.employeeId });
  const driver = employee.contract.manualContext.drivers.find((d) => d.kind === 'employee');
  employee.contract.manualContext.employeeFacts.driverEligible = structuredClone(driver.eligible);
  driver.eligible.value = false;
  yes(await patch(f, 'employees', { employeeId: f.context.employeeId }, { contract: employee.contract }));
  const before = state(f); const out = await f.service.decide(f.capability, f.input('accept'));
  assert.equal(out.reason, 'driver-authority-inconsistent'); assert.deepEqual(state(f), before);
});

test('accepting after clock advance preserves the original still-valid quote', async () => {
  const f = await setup(); const quote = await read(f, 'quotes', { quoteId: 'quote-fixture' });
  const time = yes(await f.clock.now(f.context));
  yes(await f.clock.advance(f.presenter.context, { commandId: 'later', expectedClockVersion: time.clockVersion, bySeconds: 120 }));
  yes(await f.service.decide(f.capability, f.input('accept')));
  assert.deepEqual(await read(f, 'quotes', { quoteId: 'quote-fixture' }), quote);
});

test('acceptance rejects an expired quote before the longer hold expires', async () => {
  const f = await setup(); const time = yes(await f.clock.now(f.context));
  yes(await f.clock.advance(f.presenter.context, { commandId: 'quote-expired', expectedClockVersion: time.clockVersion, bySeconds: 3600 }));
  const before = state(f); const out = await f.service.decide(f.capability, f.input('accept'));
  assert.equal(out.reason, 'quote-no-longer-valid'); assert.deepEqual(state(f), before);
});

test('decline can release the still-current hold after its quote validity ends', async () => {
  const f = await setup(); const time = yes(await f.clock.now(f.context));
  yes(await f.clock.advance(f.presenter.context, { commandId: 'quote-ended', expectedClockVersion: time.clockVersion, bySeconds: 3600 }));
  const out = yes(await f.service.decide(f.capability, f.input('decline')));
  assert.equal(out.state, 'declined'); assert.equal((await read(f, 'stock', { orderUuid: f.car.orderUuid })).available, true);
  assert.equal(yes(await f.repository.query(f.context, 'decisions'))[0].decision, 'decline');
});

test('pause does not revoke existing selection; a confirmed practical change requests review', async () => {
  const f = await setup(); yes(await f.briefService.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 }));
  yes(await f.service.decide(f.capability, f.input('accept')));
  const changed = await setup();
  yes(await changed.briefService.saveDraft(changed.context, { commandId: 'changed-draft', expectedBriefVersion: 1,
    expectedDraftVersion: 1, brief: { schemaVersion: 1, preferences: { body: preference('estate') },
      essentials: { seats: essential(6), charging: { value: 'home', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } } }));
  yes(await changed.briefService.confirm(changed.context, { commandId: 'changed-confirm', expectedBriefVersion: 1,
    expectedDraftVersion: 2, consent: { search: true, hold: true } }));
  const before = state(changed);
  assert.equal((await changed.service.decide(changed.capability, changed.input('accept'))).reason, 'brief-changed-review-required');
  assert.deepEqual(state(changed), before);
});

function nextPolicy(f, change) {
  const version = structuredClone(f.alternative); version.policyVersion = 'decision-policy-v2';
  version.effectiveFrom = '2026-11-05T00:00:00.000Z';
  for (const collection of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of version[collection]) { row.policyVersion = version.policyVersion; row.effectiveFrom = version.effectiveFrom; }
  }
  change(version); f.provider.versions = [f.alternative, version]; return version.policyVersion;
}

test('new active prices do not reprice the quote, while current eligibility changes still refuse selection', async () => {
  const f = await setup(); const quote = await read(f, 'quotes', { quoteId: 'quote-fixture' });
  const version = nextPolicy(f, (policy) => { for (const row of policy.pricePlans) { row.monthlyPoints *= 10; row.value = row.monthlyPoints; } });
  yes(await patch(f, 'runs', {}, { policyVersion: version }));
  yes(await f.service.decide(f.capability, f.input('accept')));
  assert.deepEqual(await read(f, 'quotes', { quoteId: 'quote-fixture' }), quote);
  const changed = await setup(); const blocked = nextPolicy(changed, (policy) => {
    for (const row of policy.eligibilityRules) if (row.value === 'G21 Touring|320i') row.effect = 'exclude';
  });
  yes(await patch(changed, 'runs', {}, { policyVersion: blocked })); const before = state(changed);
  assert.equal((await changed.service.decide(changed.capability, changed.input('accept'))).reason, 'current-eligibility-refused');
  assert.deepEqual(state(changed), before);
});

test('decline and the subsequent confirmed single brief change remain separate records', async () => {
  const f = await setup(); const out = yes(await f.service.decide(f.capability, f.input()));
  yes(await f.briefService.changeAfterDecline(f.context, { commandId: 'preference-change', expectedBriefVersion: 1,
    decisionId: out.decisionId, change: { path: 'preferences.body.value', value: 'suv' } }));
  assert.equal(yes(await f.repository.query(f.context, 'decisions')).length, 1);
  const history = yes(await f.briefService.readHistory(f.context)).versions;
  assert.equal(history.length, 2); assert.equal(history[0].preferences.body.value, 'estate');
  assert.equal(history[1].preferences.body.value, 'suv'); assert.equal(history[1].postDeclineChange.decisionId, out.decisionId);
});

test('reset refuses old capability and command replay without returning historical decision details', async () => {
  const f = await setup(); yes(await f.service.decide(f.capability, f.input()));
  const current = yes(await f.repository.currentRun(f.context.environmentId));
  const reset = await f.clock.reset(f.presenter.context, { commandId: 'reset', expectedRunId: current.runId,
    expectedRunVersion: current.version, scenarioVersion: current.scenarioVersion, fixtureVersion: current.fixtureVersion });
  yes(reset); const before = state(f);
  const out = await f.service.decide(f.capability, f.input()); assert.equal(out.status, 'stale-run');
  assert.equal(out.value, undefined); assert.deepEqual(state(f), before);
});

test('operation reads bind exact offer and expose current progress separately from original receipts', async () => {
  const f = await setup(); const operation = { runId: f.context.runId, operationId: 'selection-operation',
    operationType: 'offer-selection', idempotencyKey: 'original-operation', inputDigest: inputDigest('original-operation'),
    state: 'pending', attempts: 1, lastKnownState: 'selection-pending', offerId: 'offer-fixture', holdId: 'hold-fixture',
    payload: { runId: f.context.runId, environmentId: f.context.environmentId, offerId: 'offer-fixture', secretProviderData: 'must-not-project' } };
  yes(await f.repository.transaction(f.context, command('operation-fixture'), (tx) => tx.insert('pending_operations', operation)));
  const before = state(f); const out = yes(await f.service.readOperation(f.capability, { runId: f.context.runId,
    offerId: 'offer-fixture', operationId: operation.operationId }));
  assert.equal(out.reconciliationRequired, true); assert.ok(!JSON.stringify(out).includes('secretProviderData'));
  assert.deepEqual(state(f), before);
  assert.equal((await f.service.readOperation(f.capability, { runId: f.context.runId, offerId: 'another', operationId: operation.operationId })).status, 'not-found');
});

test('source-event write failure rolls back all stock/hold/slot/decision changes', async () => {
  const f = await setup(); const before = state(f);
  const repository = { currentRun: (...args) => f.repository.currentRun(...args),
    read: (...args) => f.repository.read(...args),
    transaction: (scope, cmd, work) => f.repository.transaction(scope, cmd, (tx) => work({ ...tx,
      recordReceipt: () => result('unavailable', { code: 'event-write-failed' }) })) };
  const out = await new OfferDecisionService({ ...f.options, repository }).decide(f.capability, f.input('accept'));
  assert.equal(out.status, 'unavailable'); assert.deepEqual(state(f), before);
});

async function http(f, { method = 'POST', body = f.input(), origin = 'https://gcsp.example', gate = true,
  query = '', path = '/api/gcsp/offers/offer-fixture/decision', raw, contentType = 'application/json' } = {}) {
  const { offerId, ...wire } = body;
  const req = Readable.from([raw ?? JSON.stringify(wire)]);
  req.method = method; req.headers = { 'content-type': contentType, ...(origin === null ? {} : { origin }) };
  const headers = {}; const res = { setHeader(k, v) { headers[k] = v; }, writeHead() {}, end() {} };
  let sent;
  const handle = createOfferDecisionHandler({ service: f.service, allowedOrigins: ['https://gcsp.example'],
    resolveAccess: async ({ selector, action }) => {
      const auth = await f.access.authorizeOffer(f.capability, selector, action);
      return auth.status === 'ok' ? ok({ context: f.capability }) : auth;
    } });
  await handle({ req, res, pathname: path, searchParams: new URLSearchParams(query), gateAuthorized: gate,
    sendJson(_res, status, outcome) { sent = { status, outcome, headers }; } });
  return sent;
}

test('HTTP protocol has explicit gate/origin checks, bounded allowlisted input and no-store safe responses', async () => {
  const f = await setup(); const before = state(f);
  for (const options of [{ gate: false }, { origin: null }, { origin: 'https://evil.example' },
    { body: { ...f.input(), employeeId: 'other' } }, { query: 'runId=other' }, { raw: '[]' },
    { raw: '{' }, { raw: ' '.repeat(17000) }, { contentType: 'text/plain' }]) {
    const response = await http(f, options); assert.ok([400, 401, 403].includes(response.status));
    assert.equal(response.headers['Cache-Control'], 'no-store'); assert.deepEqual(state(f), before);
  }
  const response = await http(f); assert.equal(response.status, 200); assert.equal(response.outcome.value.state, 'declined');
  assert.equal(response.headers['Referrer-Policy'], 'no-referrer'); assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('HTTP reason projection uses the same policy registry with exact run selector', async () => {
  const f = await setup(); const path = '/api/gcsp/offers/offer-fixture/decision-reasons';
  const response = await http(f, { method: 'GET', path, query: `runId=${f.context.runId}` });
  assert.equal(response.status, 200); assert.deepEqual(response.outcome.value.reasons, reasonInput);
  assert.equal((await http(f, { method: 'GET', path, query: `runId=${f.context.runId}&runId=${f.context.runId}` })).status, 400);
});
