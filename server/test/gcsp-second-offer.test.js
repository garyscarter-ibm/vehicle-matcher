import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { createOfferFollowupService } from '../gcsp/offers/followup.js';
import { createOfferFollowupRoutes } from '../gcsp/offers/followup-http.js';
import { buildFollowupComparison } from '../gcsp/offers/followup-comparison.js';
import { createBuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { preference, essential, stock, fact as stockFact } from './helpers/employee-recommendation.js';

// These labelled policy values and persisted decline rows are scoped inputs, not a106/103 producer proof.
const bundle = JSON.parse(await readFile(new URL('../gcsp/offers/followup-policy-definitions.json', import.meta.url), 'utf8'));
const reasonRows = [
  { code: 'body-style', label: 'Body style', attribute: 'body' },
  { code: 'size', label: 'Size', attribute: 'sizeClass' },
  { code: 'fuel', label: 'Fuel', attribute: 'fuel' },
  { code: 'equipment', label: 'Equipment', attribute: 'equipment' },
];
const data = () => ({ schemaVersion: 1,
  preferences: { body: preference('estate'), size: preference(50), fuel: preference('petrol'), comfort: preference(75, 0) },
  essentials: { seats: essential(5), equipment: { value: ['heated-seats'], operator: 'includes', unit: 'equipment-key',
    state: 'confirmed', source: 'employee' }, charging: { value: null, operator: 'equals', unit: null,
    state: 'needs-confirmation', source: 'employee' } },
  currentCarFeedback: { preserve: ['comfort'], change: ['body'], state: 'draft', source: 'employee' } });
const command = (commandId, payload = {}) => ({ commandId, inputDigest: inputDigest(payload) });

async function setup(t, { alter = () => {}, missingPolicy = false, inputData, briefOverride, slotRenewalId, manualContext = false } = {}) {
  const canonical = createPolicyService();
  const policy = { getActiveVersion: (...args) => canonical.getActiveVersion(...args),
    async getAssumption(key, read) {
      if (key === 'offer.followupQuestions.v1') return missingPolicy ? result('unavailable')
        : { status: 'ok', policyVersion: read.policyVersion, value: bundle.definitions[0] };
      if (key === 'offer.declineReasons.v1') return { status: 'ok', policyVersion: read.policyVersion,
        value: { key, value: { schemaVersion: 1, reasons: reasonRows }, status: 'assumed', basis: 'Scoped test input.',
          source: 'server/test/gcsp-second-offer.test.js', sourceDate: '2026-11-06' } };
      return canonical.getAssumption(key, read);
    } };
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  await repository.open(); t.after(() => repository.close());
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'followup-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context; const brief = createBriefService({ repository, policy, clock, identity });
  if (manualContext) {
    assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
    assert.equal((await clock.advance(presenter.value.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  }
  const slotRef = { table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } };
  let slot = (await repository.read(context, slotRef)).value;
  if (slotRenewalId !== undefined) {
    const changed = await repository.transaction(context, command('slot-renewal-input'),
      (tx) => tx.compareAndSwap(slotRef, slot.version, { renewalId: slotRenewalId }));
    assert.equal(changed.status, 'ok', JSON.stringify(changed)); slot = changed.value;
  }
  assert.equal((await brief.saveDraft(context, { commandId: 'draft', expectedDraftVersion: 0,
    expectedBriefVersion: 0, brief: inputData ?? data() })).status, 'ok');
  const approved = await brief.confirm(context, { commandId: 'approve', expectedDraftVersion: 1,
    expectedBriefVersion: 0, consent: { search: true, hold: true } });
  assert.equal(approved.status, 'ok', JSON.stringify(approved));
  const now = (await clock.now(context)).value.now;
  const order = (await repository.query(context, 'stock')).value[0];
  const versions = { brief: 1, pinnedBrief: 1, slot: slot.version, policy: context.policyVersion, quotePolicy: context.policyVersion };
  const quote = { runId: context.runId, quoteId: 'old-quote', employeeId: context.employeeId,
    entitlementSlotId: context.entitlementSlotId, orderUuid: order.orderUuid, briefVersion: 1, policyVersion: context.policyVersion };
  const hold = { runId: context.runId, holdId: 'old-hold', quoteId: quote.quoteId, employeeId: context.employeeId,
    entitlementSlotId: context.entitlementSlotId, renewalId: slot.renewalId ?? context.renewalId ?? null, orderUuid: order.orderUuid,
    type: 'buddy-offer', state: 'released', releaseReason: 'offer-declined', policyVersion: context.policyVersion };
  const offer = { runId: context.runId, offerId: 'old-offer', holdId: hold.holdId, quoteId: quote.quoteId,
    employeeId: context.employeeId, orderUuid: order.orderUuid, environmentId: context.environmentId,
    state: 'rejected', briefVersion: 1, policyVersion: context.policyVersion };
  const decision = { runId: context.runId, decisionId: 'decline', commandId: 'decline-command',
    offerId: offer.offerId, holdId: hold.holdId, employeeId: context.employeeId, decision: 'decline', versions,
    reason: { ...reasonRows[0], policyVersion: context.policyVersion }, outcome: ok({ state: 'declined', decisionId: 'decline' }) };
  const event = { schemaVersion: 1, eventId: 'decline-event', type: 'offer-declined', runId: context.runId,
    decisionId: decision.decisionId, commandId: 'decline-command', offerId: offer.offerId, holdId: hold.holdId,
    quoteId: quote.quoteId, employeeId: context.employeeId, entitlementSlotId: context.entitlementSlotId,
    renewalId: hold.renewalId, orderUuid: order.orderUuid, occurredAt: now,
    policyVersion: context.policyVersion, briefVersion: 1, reasonCode: decision.reason.code, exclusion: null };
  const rows = { decision, event, offer, hold, quote, receipt: { consumerId: 'offer-decisions:events:v1',
    eventId: event.eventId, eventType: 'offer-declined', state: 'completed', inputVersions: versions } };
  alter(rows);
  const seeded = await repository.transaction(context, command('decline-input-fixture'), async (tx) => {
    for (const [table, row] of [['quotes', quote], ['holds', hold], ['offers', offer], ['decisions', decision]]) {
      const inserted = await tx.insert(table, row); if (inserted.status !== 'ok') return inserted;
    }
    return rows.omitReceipt ? ok(null) : tx.recordReceipt({ ...rows.receipt,
      inputDigest: rows.badDigest ? 'bad-digest' : inputDigest(event), outcome: ok({ event }) });
  });
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded));
  const service = createOfferFollowupService({ repository, policy, clock, identity, brief: briefOverride ?? brief });
  return { repository, policy, canonical, clock, identity, context, presenter, brief, service, slot, slotRef, initial: approved.value.brief, rows };
}

async function answer(f, additions = {}) {
  const question = await f.service.read(f.context, { decisionId: 'decline' });
  assert.equal(question.status, 'ok', JSON.stringify(question));
  return { commandId: 'change', decisionId: 'decline', expectedBriefVersion: question.value.briefVersion,
    questionVersion: question.value.question.questionVersion, value: 'suv', ...additions };
}
const snapshot = async (f) => Promise.all(['briefs', 'offers', 'holds', 'quotes', 'decisions', 'event_receipts']
  .map(async (table) => [table, (await f.repository.query(f.context, table)).value]));

test('reading a policy question writes nothing and projects only the one existing target', async (t) => {
  const f = await setup(t); const before = await snapshot(f);
  const question = await f.service.read(f.context, { decisionId: 'decline' });
  assert.equal(question.status, 'ok'); assert.equal(question.value.state, 'question');
  assert.equal(question.value.question.path, 'preferences.body.value');
  assert.equal(question.value.question.currentValue, 'estate');
  assert.equal(JSON.stringify(question).includes(f.context.employeeId), false);
  assert.deepEqual(await snapshot(f), before);
});

test('confirmation uses real BriefService, preserves other inputs, replays and retains save on reload', async (t) => {
  const f = await setup(t); const input = await answer(f);
  const beforeOffers = (await f.repository.query(f.context, 'offers')).value;
  const changed = await f.service.confirm(f.context, input);
  assert.equal(changed.status, 'ok', JSON.stringify(changed)); assert.equal(changed.value.state, 'change-saved');
  assert.equal(changed.value.briefVersion, 2); assert.equal(changed.value.event.eventType, 'brief-changed');
  assert.equal(Object.hasOwn(changed.value.event, 'eventId'), false);
  assert.equal(changed.value.event.receiptReference, `brief-change:${inputDigest({ consumerId: 'brief:changes',
    runId: f.context.runId, eventId: `brief:${f.context.employeeId}:2` })}`);
  assert.equal(JSON.stringify(changed).includes(f.context.employeeId), false);
  assert.deepEqual(changed.value.change, { path: 'preferences.body.value', before: 'estate', after: 'suv' });
  const current = (await f.brief.readCurrent(f.context)).value.brief;
  assert.equal(current.preferences.body.value, 'suv'); assert.deepEqual(current.essentials, f.initial.essentials);
  assert.deepEqual(current.preferences.comfort, f.initial.preferences.comfort);
  assert.deepEqual(current.preferences.size, f.initial.preferences.size); assert.deepEqual(current.buddy, f.initial.buddy);
  assert.deepEqual(current.knownFacts, f.initial.knownFacts);
  assert.equal(current.postDeclineChange.confirmedBy, f.context.principalId);
  assert.deepEqual(await f.service.confirm(f.context, input), changed);
  const conflicting = await f.service.confirm(f.context, { ...input, value: 'saloon' });
  assert.equal(conflicting.status, 'conflict'); assert.equal(conflicting.reason, 'idempotency-input-changed');
  const reload = await f.service.read(f.context, { decisionId: 'decline' });
  assert.equal(reload.status, 'ok'); assert.equal(reload.value.state, 'waiting');
  assert.deepEqual(reload.value.savedChange, changed.value);
  assert.equal((await f.brief.readHistory(f.context)).value.versions.length, 2);
  assert.deepEqual((await f.repository.query(f.context, 'offers')).value, beforeOffers);
  assert.equal(JSON.stringify(changed).includes(f.context.principalId), false);
});

test('a second command cannot consume the decline and stale concurrent confirmations cannot overwrite', async (t) => {
  const f = await setup(t); const input = await answer(f);
  const outcomes = await Promise.all([f.service.confirm(f.context, input), f.service.confirm(f.context, { ...input, commandId: 'race' })]);
  assert.equal(outcomes.filter((o) => o.status === 'ok').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'stale-version').length, 1);
  const reread = createOfferFollowupService({ repository: f.repository, policy: f.policy, clock: f.clock, identity: f.identity, brief: f.brief });
  assert.equal((await reread.read(f.context, { decisionId: 'decline' })).value.savedChange.briefVersion, 2);
  const next = await f.service.confirm(f.context, { ...input, commandId: 'second', expectedBriefVersion: 2 });
  assert.equal(next.status, 'stale-version');
  assert.equal((await f.brief.readHistory(f.context)).value.versions.length, 2);
});

test('unchanged, invalid, forged and stale question inputs never write', async (t) => {
  const f = await setup(t); const input = await answer(f); const before = await snapshot(f);
  for (const value of ['estate', 'not-a-body', 50, { value: 'suv' }]) {
    assert.equal((await f.service.confirm(f.context, { ...input, value })).status, 'invalid');
  }
  for (const addition of [{ path: 'essentials.seats' }, { reasonCode: 'fuel' }, { employeeId: 'other' }]) {
    assert.equal((await f.service.confirm(f.context, { ...input, ...addition })).status, 'invalid');
  }
  assert.equal((await f.service.confirm(f.context, { ...input, questionVersion: 'forged' })).status, 'stale-version');
  assert.deepEqual(await snapshot(f), before);
});

test('question versions cannot cross a different completed decline', async (t) => {
  const f = await setup(t); const input = await answer(f);
  const { decision, event } = f.rows;
  const inserted = await f.repository.transaction(f.context, command('another-fixture'), async (tx) => {
    const d = await tx.insert('decisions', { ...decision, decisionId: 'another-decline', commandId: 'another-command',
      outcome: ok({ state: 'declined', decisionId: 'another-decline' }) });
    if (d.status !== 'ok') return d;
    const e = { ...event, decisionId: 'another-decline', eventId: 'another-event' };
    return tx.recordReceipt({ ...f.rows.receipt, eventId: e.eventId, inputDigest: inputDigest(e), outcome: ok({ event: e }) });
  });
  assert.equal(inserted.status, 'ok');
  assert.equal((await f.service.confirm(f.context, { ...input, decisionId: 'another-decline' })).status, 'stale-version');
});

test('missing, pending, mismatched, future and bad-digest completed decline inputs fail closed', async (t) => {
  const alterations = [
    (r) => { r.omitReceipt = true; }, (r) => { r.receipt.state = 'pending'; },
    (r) => { r.event.reasonCode = 'fuel'; }, (r) => { r.event.briefVersion = 9; },
    (r) => { r.event.employeeId = 'other'; }, (r) => { r.event.occurredAt = '2099-01-01T00:00:00.000Z'; },
    (r) => { r.badDigest = true; }, (r) => { r.receipt.inputVersions = { brief: 2 }; },
    (r) => { r.offer.state = 'release-pending'; }, (r) => { r.hold.releaseReason = 'expired'; },
  ];
  for (const alter of alterations) {
    const f = await setup(t, { alter }); const before = await snapshot(f);
    assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).status, 'unavailable');
    assert.deepEqual(await snapshot(f), before);
  }
});

test('missing canonical policy never creates a question or change', async (t) => {
  const f = await setup(t, { missingPolicy: true });
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).status, 'unavailable');
});

test('FUCQ-183: a decline reason whose target is not in the brief asks the question and the answer adds it', async (t) => {
  const editor = (await createPolicyService().getAssumption('brief.editor.v1',
    { runId: 'x', asOf: '2026-11-05T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' })).value.value.preferences;
  for (const [code, value, path, drop] of [['body-style', 'suv', 'preferences.body.value', (d) => delete d.preferences.body],
    ['fuel', 'ev', 'preferences.fuel.value', (d) => delete d.preferences.fuel],
    ['size', 75, 'preferences.size.value', (d) => delete d.preferences.size],
    ['equipment', ['towbar'], 'essentials.equipment', (d) => delete d.essentials.equipment]]) {
    const sparse = data(); drop(sparse);
    const f = await setup(t, { inputData: sparse, alter: (r) => { r.decision.reason = { ...reasonRows.find((row) => row.code === code),
      policyVersion: r.decision.reason.policyVersion }; r.event.reasonCode = code; } });
    const question = await f.service.read(f.context, { decisionId: 'decline' });
    assert.equal(question.status, 'ok', JSON.stringify(question)); assert.equal(question.value.state, 'question');
    assert.equal(question.value.question.path, path); assert.equal(question.value.question.currentValue, null);
    const changed = await f.service.confirm(f.context, await answer(f, { value }));
    assert.equal(changed.status, 'ok', JSON.stringify(changed)); assert.equal(changed.value.state, 'change-saved');
    assert.deepEqual(changed.value.change, { path, before: null, after: path.startsWith('essentials') ? changed.value.change.after : value });
    const current = (await f.brief.readCurrent(f.context)).value.brief;
    assert.equal(current.postDeclineChange.before, null);
    if (path.startsWith('essentials')) {
      assert.deepEqual(current.essentials.equipment.value, value); assert.equal(current.essentials.equipment.state, 'confirmed');
      assert.equal(current.essentials.equipment.source, 'employee');
    } else {
      const key = path.split('.')[1];
      assert.equal(current.preferences[key].value, value); assert.equal(current.preferences[key].importance, editor[key].importance);
      assert.equal(current.preferences[key].valueState, 'confirmed'); assert.equal(current.preferences[key].importanceState, 'confirmed');
    }
    assert.deepEqual(current.preferences.comfort, f.initial.preferences.comfort);
    const reload = await f.service.read(f.context, { decisionId: 'decline' });
    assert.notEqual(reload.value?.state, 'question');
  }
});

test('fuel, size and equipment questions use the same canonical change reducer', async (t) => {
  for (const [code, value, path] of [['fuel', 'ev', 'preferences.fuel.value'], ['size', 75, 'preferences.size.value'],
    ['equipment', ['heated-seats', 'rear-camera'], 'essentials.equipment']]) {
    const f = await setup(t, { alter: (r) => { r.decision.reason = { ...reasonRows.find((row) => row.code === code),
      policyVersion: r.decision.reason.policyVersion }; r.event.reasonCode = code; } });
    const input = await answer(f, { value });
    const changed = await f.service.confirm(f.context, input);
    assert.equal(changed.status, 'ok', JSON.stringify(changed)); assert.equal(changed.value.change.path, path);
    const current = (await f.brief.readCurrent(f.context)).value.brief;
    assert.deepEqual(path.startsWith('essentials') ? current.essentials.equipment.value : current.preferences[code].value, value);
    assert.deepEqual(current.preferences.comfort, f.initial.preferences.comfort);
  }
});

test('forged, other employee and stale run sessions cannot follow or change the brief', async (t) => {
  const f = await setup(t); const input = await answer(f);
  assert.equal((await f.service.read({ ...f.context }, { decisionId: 'decline' })).status, 'forbidden');
  assert.equal((await f.service.confirm({ ...f.context }, input)).status, 'forbidden');
  const other = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-alex', 'alex');
  assert.equal(other.status, 'ok');
  assert.equal((await f.service.read(other.value.context, { decisionId: 'decline' })).status, 'forbidden');
  const state = (await f.clock.readState(f.presenter.value.context)).value;
  assert.equal((await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  assert.equal((await f.service.confirm(f.context, input)).status, 'stale-run');
});

test('BriefService failures remain safe and never become a saved response', async (t) => {
  const f = await setup(t);
  const service = createOfferFollowupService({ ...f, brief: { readHistory: (ctx) => f.brief.readHistory(ctx),
    async changeAfterDecline() { return result('unavailable', { reason: 'secret provider details', employee: f.context }); } } });
  const input = await answer({ ...f, service }); const before = await snapshot(f);
  const response = await service.confirm(f.context, input);
  assert.equal(response.status, 'unavailable'); assert.equal(JSON.stringify(response).includes('secret'), false);
  assert.deepEqual(await snapshot(f), before);
});

async function comparisonCase(t, slotRenewalId) {
  const f = await setup(t, { slotRenewalId }); const saved = await f.service.confirm(f.context, await answer(f));
  assert.equal(saved.status, 'ok');
  if (slotRenewalId !== undefined) {
    assert.equal(Object.hasOwn(f.context, 'renewalId'), false);
    assert.equal(Object.isFrozen(f.context), true);
    assert.equal(f.initial.renewalId, null);
    const reload = await f.service.read(f.context, { decisionId: 'decline' });
    assert.equal(reload.status, 'ok'); assert.deepEqual(reload.value.savedChange, saved.value);
  }
  const now = (await f.clock.now(f.context)).value.now;
  const quote = { ...f.rows.quote, quoteId: 'new-quote', briefVersion: 2, quotedAt: now };
  const hold = { ...f.rows.hold, holdId: 'new-hold', quoteId: quote.quoteId, state: 'active' };
  const offer = { ...f.rows.offer, offerId: 'new-offer', holdId: hold.holdId, quoteId: quote.quoteId, briefVersion: 2, state: 'active' };
  const seeded = await f.repository.transaction(f.context, command('second-offer-input-fixture'), async (tx) => {
    for (const [table, row] of [['quotes', quote], ['holds', hold], ['offers', offer]]) {
      const inserted = await tx.insert(table, row); if (inserted.status !== 'ok') return inserted;
    }
    return ok(null);
  });
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded));
  const provenance = { sourceRef: 'scoped-input', observedAt: now, version: '1', assurance: 'synthetic-scenario' };
  const fact = (value, unit = null) => ({ status: 'known', value, unit, provenance });
  const calls = [];
  // Explicit safe102-shaped port inputs; no actual102/100/96 integration is claimed here.
  const offers = { async fromAccount(context, selector) {
    assert.equal(context, f.context); calls.push(selector);
    const previous = selector.offerId === 'old-offer';
    return ok({ context: { private: 'must-not-escape' }, offer: { schemaVersion: 1, runId: context.runId,
      offerId: selector.offerId, state: previous ? 'declined' : 'pending', quote: {
        quoteId: previous ? f.rows.quote.quoteId : quote.quoteId, orderUuid: quote.orderUuid,
        briefVersion: previous ? 1 : 2, policyVersion: context.policyVersion, quotedAt: now,
        facts: { facts: { body: fact(previous ? 'estate' : 'suv'), seats: fact(5, 'count') } },
        decision: { score: previous ? 95 : 70 },
      } } });
  } };
  const service = createOfferFollowupService({ ...f, offers });
  const response = await service.read(f.context, { decisionId: 'decline' });
  assert.equal(response.status, 'ok', JSON.stringify(response)); assert.equal(response.value.state, 'ready');
  const comparison = response.value.comparison;
  assert.equal(comparison.currentBriefVersion, 2);
  assert.equal(comparison.previous.scoreBasis.kind, 'historical-quote');
  assert.equal(comparison.previous.scoreBasis.briefVersion, 1);
  assert.equal(comparison.next.scoreBasis.briefVersion, 2);
  assert.equal(comparison.previous.offer.quote.decision.score, 95);
  assert.equal(comparison.next.offer.quote.decision.score, 70);
  const body = comparison.requirements.find((row) => row.kind === 'preference' && row.key === 'body');
  assert.equal(body.value, 'suv'); assert.equal(body.previousFacts.body.value, 'estate'); assert.equal(body.nextFacts.body.value, 'suv');
  assert.deepEqual(body.nextFacts.body.provenance, provenance);
  const size = comparison.requirements.find((row) => row.key === 'size');
  assert.deepEqual(size.nextFacts.sizeClass, { status: 'unknown', value: null, unit: null, provenance: null });
  assert.equal(comparison.requirements.find((row) => row.key === 'seats').nextFacts.seats.unit, 'count');
  assert.equal(comparison.requirements.some((row) => row.key === 'charging'), false);
  assert.equal(JSON.stringify(response).includes('must-not-escape'), false);
  assert.equal(JSON.stringify(response).includes(f.context.employeeId), false);
  assert.deepEqual(calls, [{ runId: f.context.runId, offerId: 'old-offer' }, { runId: f.context.runId, offerId: 'new-offer' }]);
  const bad = buildFollowupComparison({ previousOffer: comparison.previous.offer, nextOffer: comparison.next.offer,
    brief: { ...f.initial, briefVersion: 3 }, config: {} });
  assert.equal(bad.status, 'unavailable');
  const failing = createOfferFollowupService({ ...f, offers: { async fromAccount() { throw Error('secret details'); } } });
  const failure = await failing.read(f.context, { decisionId: 'decline' });
  assert.equal(failure.status, 'unavailable'); assert.deepEqual(failure.savedChange, saved.value);
  assert.equal(JSON.stringify(failure).includes('secret'), false);
}

test('two persisted quotes and the safe account port produce a comparison with explicit current inputs', async (t) => {
  await comparisonCase(t);
});

test('ordinary identity uses persisted slot renewal through question, save, reload and next-hold comparison', async (t) => {
  await comparisonCase(t, 'persisted-renewal');
});

test('unpopulated slot renewal uses the matched hold and event; explicit conflicts and malformed values refuse', async (t) => {
  for (const slotRenewalId of [undefined, null]) {
    const matched = await setup(t, { slotRenewalId, alter: (rows) => {
      rows.hold.renewalId = 'hold-renewal'; rows.event.renewalId = 'hold-renewal';
    } });
    assert.equal(Object.hasOwn(matched.context, 'renewalId'), false);
    assert.equal(matched.slot.renewalId, slotRenewalId);
    const input = await answer(matched);
    assert.equal((await matched.service.confirm(matched.context, input)).status, 'ok');
  }
  const alterations = [
    { slotRenewalId: 'slot-renewal', alter(rows) { rows.hold.renewalId = 'other'; rows.event.renewalId = 'other'; } },
    { slotRenewalId: 7 }, { slotRenewalId: '' }, { slotRenewalId: ' padded ' },
    { alter(rows) { rows.hold.renewalId = 'hold-renewal'; } },
    { alter(rows) { rows.hold.renewalId = {}; rows.event.renewalId = {}; } },
  ];
  for (const options of alterations) {
    const f = await setup(t, options); const before = await snapshot(f);
    assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).status, 'unavailable');
    assert.deepEqual(await snapshot(f), before);
  }
  for (const renewalId of ['conflicting-history', 7, '']) {
    const f = await setup(t, { slotRenewalId: 'persisted-renewal' });
    // A labelled corrupt-history reader input, never an enriched identity or a
    // change to the real BriefService writer or its immutable stored history.
    const brief = { ...f.brief, async readHistory(context) {
      const history = await f.brief.readHistory(context);
      return { ...history, value: { ...history.value, versions: history.value.versions.map((row) => ({ ...row, renewalId })) } };
    } };
    const service = createOfferFollowupService({ ...f, brief }); const before = await snapshot(f);
    assert.equal((await service.read(f.context, { decisionId: 'decline' })).status, 'unavailable');
    assert.deepEqual(await snapshot(f), before);
  }
});

test('historical slot pins must be valid and reached; compatible later current revisions remain usable', async (t) => {
  for (const slotVersion of [undefined, null, 0, -1, 1.5, '1', 'future']) {
    const f = await setup(t, { alter(rows) {
      if (slotVersion === undefined) delete rows.decision.versions.slot;
      else rows.decision.versions.slot = slotVersion === 'future' ? rows.decision.versions.slot + 1 : slotVersion;
    } });
    const before = await snapshot(f);
    assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).status, 'unavailable');
    assert.deepEqual(await snapshot(f), before);
  }
  const f = await setup(t, { slotRenewalId: 'persisted-renewal' });
  const later = await f.repository.transaction(f.context, command('compatible-later-slot'),
    (tx) => tx.compareAndSwap(f.slotRef, f.slot.version, {}));
  assert.equal(later.status, 'ok', JSON.stringify(later));
  assert.equal(later.value.version, f.rows.decision.versions.slot + 1);
  assert.equal((await f.service.confirm(f.context, await answer(f))).status, 'ok');
});

test('slot content and version changes before question response or brief write refuse without a brief change', async (t) => {
  for (const phase of ['question', 'confirm']) {
    const f = await setup(t, { slotRenewalId: 'persisted-renewal' });
    const input = phase === 'confirm' ? await answer(f) : null;
    let mutated = false; let writes = 0; let mutationSnapshot;
    const policy = { ...f.policy, async getAssumption(key, read) {
      const outcome = await f.policy.getAssumption(key, read);
      if (key === 'offer.followupQuestions.v1' && !mutated) {
        mutated = true;
        const changed = await f.repository.transaction(f.context, command(`slot-race-${phase}`),
          (tx) => tx.compareAndSwap(f.slotRef, f.slot.version, { capacity: f.slot.capacity + 1 }));
        assert.equal(changed.status, 'ok', JSON.stringify(changed));
        mutationSnapshot = await snapshot(f);
      }
      return outcome;
    } };
    const brief = { readHistory: (context) => f.brief.readHistory(context), async changeAfterDecline(...args) {
      writes += 1; return f.brief.changeAfterDecline(...args);
    } };
    const service = createOfferFollowupService({ ...f, policy, brief }); const before = await snapshot(f);
    const outcome = phase === 'confirm' ? await service.confirm(f.context, input)
      : await service.read(f.context, { decisionId: 'decline' });
    assert.equal(mutated, true); assert.equal(outcome.status, 'unavailable'); assert.equal(writes, 0);
    // The injected CAS writes its own command receipt. All other resources
    // must stay unchanged, and follow-up must add nothing after that mutation.
    const raceReceipt = (row) => row.consumerId === 'command:transaction' && row.eventId === `slot-race-${phase}`;
    const receipts = mutationSnapshot.find(([table]) => table === 'event_receipts')[1];
    assert.equal(receipts.filter(raceReceipt).length, 1);
    assert.deepEqual(mutationSnapshot.map(([table, rows]) => [table,
      table === 'event_receipts' ? rows.filter((row) => !raceReceipt(row)) : rows]), before);
    assert.deepEqual(await snapshot(f), mutationSnapshot);
    assert.equal((await f.repository.read(f.context, f.slotRef)).value.version, f.slot.version + 1);
    assert.equal((await f.brief.readHistory(f.context)).value.versions.length, 1);
  }
});

// Seeds the FUCQ-96 allocator's persisted run record shape through the repository's normal receipt path.
async function seedRun(f, { eventId, brief = 2, decisions, evaluatedAt, value = {}, employeeId = f.context.employeeId }) {
  const at = evaluatedAt ?? (await f.clock.now(f.context)).value.now;
  const run = { state: 'no-assignment', runId: f.context.runId, evaluatedAt: at, policyVersion: f.context.policyVersion,
    inputVersions: { briefs: [{ employeeId, brief }], stock: [] }, assignments: [], attempts: [],
    evaluations: [{ employeeId, versions: {}, decisions }], ...value };
  const seeded = await f.repository.transaction(f.context, command(`allocation-${eventId}`), (tx) => tx.recordReceipt({
    consumerId: 'buddy-allocation', eventId, eventType: 'stock-released', state: 'completed',
    inputVersions: { brief }, inputDigest: inputDigest(run), outcome: ok(run) }));
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded));
}
const decisionRow = (gateStatus, n) => ({ orderUuid: `car-${n}`, gateStatus, score: null, reasons: [],
  blockers: gateStatus === 'eligible' ? [] : ['declined-unchanged'], unknowns: [], versions: {} });

test('after a saved change the follow-up is waiting until a release evaluates the new brief', async (t) => {
  const f = await setup(t); const saved = await f.service.confirm(f.context, await answer(f));
  const before = await snapshot(f);
  const none = await f.service.read(f.context, { decisionId: 'decline' });
  assert.equal(none.status, 'ok'); assert.deepEqual(none.value, { schemaVersion: 1, state: 'waiting', decisionId: 'decline', savedChange: saved.value });
  assert.deepEqual(await snapshot(f), before);
  await seedRun(f, { eventId: 'older', brief: 1, decisions: [decisionRow('ineligible', 1)] });
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).value.state, 'waiting');
  await seedRun(f, { eventId: 'other-run', decisions: [decisionRow('ineligible', 1)], value: { runId: 'earlier-run' } });
  await seedRun(f, { eventId: 'other-employee', decisions: [decisionRow('ineligible', 1)], employeeId: 'someone-else' });
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).value.state, 'waiting');
});

test('a completed release evaluating the current brief with no eligible car is a calculated no-match', async (t) => {
  const f = await setup(t); const saved = await f.service.confirm(f.context, await answer(f));
  await seedRun(f, { eventId: 'release-one', decisions: [1, 2, 3].map((n) => decisionRow('ineligible', n)) });
  const response = await f.service.read(f.context, { decisionId: 'decline' });
  assert.equal(response.status, 'ok', JSON.stringify(response)); assert.equal(response.value.state, 'no-match');
  assert.deepEqual(response.value.savedChange, saved.value);
  assert.deepEqual(response.value.evaluation, { evaluatedAt: (await f.clock.now(f.context)).value.now, carsChecked: 3, suitable: 0 });
  assert.equal(JSON.stringify(response).includes(f.context.employeeId), false);
  const now = Date.parse((await f.clock.now(f.context)).value.now);
  await seedRun(f, { eventId: 'release-two', evaluatedAt: new Date(now - 60000).toISOString(), decisions: [decisionRow('eligible', 4)] });
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).value.evaluation.carsChecked, 3);
  await seedRun(f, { eventId: 'release-three', evaluatedAt: new Date(now + 60000).toISOString(), decisions: [] });
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).value.evaluation.carsChecked, 3);
});

test('eligible cars without an offer wait; the latest evaluation wins', async (t) => {
  const f = await setup(t); await f.service.confirm(f.context, await answer(f));
  const now = Date.parse((await f.clock.now(f.context)).value.now);
  await seedRun(f, { eventId: 'earlier', evaluatedAt: new Date(now - 60000).toISOString(), decisions: [decisionRow('ineligible', 1)] });
  await seedRun(f, { eventId: 'later', decisions: [decisionRow('ineligible', 1), decisionRow('eligible', 2)] });
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).value.state, 'waiting');
});

test('malformed allocation records and failed receipt reads keep the saved change with unavailable', async (t) => {
  for (const value of [{ evaluations: 'none' }, { inputVersions: { briefs: [{ employeeId: 'x' }] , stock: [] }, evaluations: 7 }]) {
    const f = await setup(t); const saved = await f.service.confirm(f.context, await answer(f));
    await seedRun(f, { eventId: 'bad', decisions: [], value: { inputVersions: { briefs: [{ employeeId: f.context.employeeId, brief: 2 }] }, ...value } });
    const response = await f.service.read(f.context, { decisionId: 'decline' });
    assert.equal(response.status, 'unavailable'); assert.deepEqual(response.savedChange, saved.value);
  }
  const f = await setup(t); const saved = await f.service.confirm(f.context, await answer(f));
  const repository = Object.create(f.repository, { query: { value: async (context, table, filter) =>
    table === 'event_receipts' && filter?.consumerId === 'buddy-allocation' ? result('unavailable') : f.repository.query(context, table, filter) } });
  const failing = createOfferFollowupService({ ...f, repository });
  const response = await failing.read(f.context, { decisionId: 'decline' });
  assert.equal(response.status, 'unavailable'); assert.deepEqual(response.savedChange, saved.value);
});

test('a release tick that finds a fitting car yields the second offer through the real hold service', async (t) => {
  const f = await setup(t, { manualContext: true, inputData: { schemaVersion: 1,
    preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }); const saved = await f.service.confirm(f.context, await answer(f));
  assert.equal((await f.service.read(f.context, { decisionId: 'decline' })).value.state, 'waiting');
  const car = stock(2, { body: stockFact('suv') });
  const released = await f.repository.transaction(f.context, command('release-fixture'), (tx) => tx.insert('stock', {
    runId: f.context.runId, orderUuid: car.orderUuid, orderNumber: '9123456', configurationId: car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
    release: { eventId: 'tick-release', availability: car.availability },
    visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null } }));
  assert.equal(released.status, 'ok', JSON.stringify(released));
  const read = (table, key) => f.repository.read(f.context, { table, key: { runId: f.context.runId, ...key } });
  const [employee, slot, row] = await Promise.all([read('employees', { employeeId: f.context.employeeId }),
    read('entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId }), read('stock', { orderUuid: car.orderUuid })]);
  // The FUCQ-96 allocator makes this claim on the release tick; here the real FUCQ-100 hold service is called directly.
  const hold = createBuddyHoldService({ repository: f.repository, policy: f.canonical, clock: f.clock, identity: f.identity,
    adapter: { mode: 'local-synthetic' } });
  const allocated = await hold.allocate(f.context, { commandId: 'tick', orderUuid: car.orderUuid, expectedBriefVersion: 2,
    expectedStockVersion: row.value.version, expectedSlotVersion: slot.value.version, expectedEmployeeVersion: employee.value.version });
  assert.equal(allocated.status, 'ok', JSON.stringify(allocated)); assert.equal(allocated.value.quote.briefVersion, 2);
  const now = (await f.clock.now(f.context)).value.now;
  const offers = { async fromAccount(context, { offerId }) {
    const previous = offerId === 'old-offer'; const quote = previous ? f.rows.quote : allocated.value.quote;
    return ok({ offer: { schemaVersion: 1, runId: context.runId, offerId, state: previous ? 'declined' : 'pending', quote: {
      quoteId: quote.quoteId, orderUuid: quote.orderUuid, briefVersion: quote.briefVersion, policyVersion: context.policyVersion,
      quotedAt: now, facts: { facts: { body: stockFact(previous ? 'estate' : 'suv') } }, decision: { score: previous ? 95 : 70 } } } });
  } };
  const response = await createOfferFollowupService({ ...f, offers }).read(f.context, { decisionId: 'decline' });
  assert.equal(response.status, 'ok', JSON.stringify(response)); assert.equal(response.value.state, 'ready');
  assert.deepEqual(response.value.savedChange, saved.value);
  assert.equal(response.value.comparison.next.offer.offerId, allocated.value.offer.offerId);
  assert.equal(response.value.comparison.next.offer.quote.briefVersion, 2);
});

test('HTTP descriptors require employee context, exact selector and delegated strict confirmation', async (t) => {
  const f = await setup(t); const [read, confirm] = createOfferFollowupRoutes(f.service);
  assert.deepEqual([read, confirm].map(({ method, path, role }) => ({ method, path, role })), [
    { method: 'GET', path: '/api/gcsp/offer-followup', role: 'employee' },
    { method: 'POST', path: '/api/gcsp/offer-followup/confirm', role: 'employee' },
  ]);
  for (const query of ['', 'decisionId=decline&decisionId=decline', 'decisionId=decline&employeeId=other']) {
    assert.equal((await read.handle({ context: f.context, searchParams: new URLSearchParams(query) })).status, 'invalid');
  }
  assert.equal((await read.handle({ context: f.context, searchParams: new URLSearchParams('decisionId=decline') })).value.state, 'question');
  const input = await answer(f);
  assert.equal((await confirm.handle({ context: f.context, body: { ...input, path: 'preferences.fuel.value' } })).status, 'invalid');
  assert.equal((await confirm.handle({ context: f.context, body: input, searchParams: new URLSearchParams('decisionId=decline') })).status, 'invalid');
  assert.equal((await confirm.handle({ context: f.context, body: input })).value.state, 'change-saved');
});
