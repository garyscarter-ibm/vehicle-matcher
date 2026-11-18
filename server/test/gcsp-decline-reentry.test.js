import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyService } from '../gcsp/policy/index.js';
import { ok, result } from '../gcsp/repository/index.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';
import { fact, preference, essential, stock, instant } from './helpers/employee-recommendation.js';

// Explicit alternative canonical policy input: the historical seed remains immutable.
const KEY = 'offer.declinedCar.reentry.v1';
const RULE = { schemaVersion: 1, rule: 'confirmedDeclineAnswerMustFitCandidate', reasons: [
  { reasonCode: 'body-style', path: 'preferences.body.value', field: 'body', match: 'known-value' },
  { reasonCode: 'fuel', path: 'preferences.fuel.value', field: 'fuel', match: 'known-value' },
  { reasonCode: 'size', path: 'preferences.size.value', field: 'size', match: 'closer-fit' },
  { reasonCode: 'equipment', path: 'essentials.equipment', field: 'equipment', match: 'essential-met' },
] };
const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value; };

async function fixture(t, { reason = 'fuel', before = 'diesel', after = 'ev',
  candidateFacts = [{ fuel: fact('diesel') }, { fuel: fact('petrol') }], mutate = () => {}, policyValue = RULE,
  policyFailure, charging = 'home', importance = 100 } = {}) {
  const f = await allocationFixture({ cars: candidateFacts.length });
  t.after(() => f.repository.close());
  const source = structuredClone(f.source);
  source.assumptions.push({ ...source.assumptions[0], key: KEY, value: policyValue, status: 'assumed', basis: 'Explicit F388 regression input.',
    source: 'server/test/gcsp-decline-reentry.test.js', sourceDate: '2026-11-18' });
  const canonical = new PolicyService({ provider: { async loadVersions() { return [source]; } } });
  const policy = policyFailure ? { getAssumption(key, read) { return key === KEY ? policyFailure : canonical.getAssumption(key, read); },
    getEligibility: (...args) => canonical.getEligibility(...args), getAllowance: (...args) => canonical.getAllowance(...args),
    getPointsCost: (...args) => canonical.getPointsCost(...args) } : canonical;
  const employee = f.employees[0]; const field = reason === 'body-style' ? 'body' : reason;
  const rows = good(await f.repository.query(f.context, 'briefs'));
  const initial = structuredClone(rows.find((b) => b.employeeId === employee.employeeId));
  if (field === 'equipment') initial.essentials.equipment = essential(before, 'includes', 'equipment-key');
  else initial.preferences[field] = preference(before, importance);
  initial.essentials.charging = essential(charging, 'equals', null);
  const current = structuredClone(initial); current.briefVersion = 2; current.previousBriefVersion = 1;
  if (field === 'equipment') current.essentials.equipment = essential(after, 'includes', 'equipment-key');
  else current.preferences[field] = preference(after, importance);
  const beforeValue = field === 'equipment' ? initial.essentials.equipment : before;
  const afterValue = field === 'equipment' ? current.essentials.equipment : after;
  current.postDeclineChange = { decisionId: 'decline:1', offerId: 'offer:1', fromBriefVersion: 1,
    path: field === 'equipment' ? 'essentials.equipment' : `preferences.${field}.value`,
    before: beforeValue, after: afterValue, confirmedBy: employee.principalId, confirmedAt: instant };
  const quote = { runId: f.context.runId, quoteId: 'quote:1', employeeId: employee.employeeId,
    entitlementSlotId: employee.entitlementSlotId, orderUuid: f.stock().orderUuid, briefVersion: 1,
    policyVersion: f.context.policyVersion, eligibility: { decision: { reasons: [], tradeOffs: [
      { code: 'preference-fit', field: 'size', desired: before, observed: 60 },
    ] } } };
  const offer = { runId: f.context.runId, offerId: 'offer:1', holdId: 'hold:1', quoteId: quote.quoteId,
    employeeId: employee.employeeId, orderUuid: f.stock().orderUuid, briefVersion: 1,
    policyVersion: f.context.policyVersion, state: 'rejected' };
  const decision = { runId: f.context.runId, decisionId: 'decline:1', commandId: 'decline:1',
    employeeId: employee.employeeId, offerId: offer.offerId, decision: 'decline',
    reason: { code: reason, policyVersion: f.context.policyVersion }, versions: { brief: 1, pinnedBrief: 1, quotePolicy: f.context.policyVersion },
    outcome: ok({ state: 'declined', decisionId: 'decline:1' }) };
  const input = { initial, current, quote, offer, decision, extra: [] }; mutate(input);
  await f.write(async (tx) => {
    // The fixture's original confirmed row is immutable; controlled table replacement below gives v1 the independent input.
    for (const [i, facts] of candidateFacts.entries()) {
      const row = good(await tx.get({ table: 'stock', key: { runId: f.context.runId, orderUuid: f.stock(i + 1).orderUuid } }));
      const changed = await tx.compareAndSwap({ table: 'stock', key: { runId: f.context.runId, orderUuid: row.orderUuid } },
        row.version, { facts: stock(i + 1, facts).snapshot });
      if (changed.status !== 'ok') return changed;
    }
    for (const [table, row] of [['quotes', quote], ['holds', { runId: f.context.runId, holdId: offer.holdId,
      quoteId: quote.quoteId, employeeId: employee.employeeId, entitlementSlotId: employee.entitlementSlotId,
      orderUuid: offer.orderUuid, state: 'released', type: 'buddy-offer', releaseReason: 'offer-declined' }],
    ['offers', offer], ['decisions', decision], ...input.extra, ['briefs', current]]) {
      const inserted = await tx.insert(table, row); if (inserted.status !== 'ok') return inserted;
    }
    return ok(null);
  });
  const tables = f.store.state.tables;
  f.store.state = { ...f.store.state, tables: { ...tables,
    briefs: tables.briefs.map((row) => row.employeeId === employee.employeeId && row.briefVersion === 1 ? initial : row) } };
  const out = await f.create({ policy }).allocate(f.context, f.event);
  return { ...f, ...input, out, evaluation: out.status === 'ok' ? out.value.evaluations.find((e) => e.employeeId === employee.employeeId) : null };
}

// Break caught: semantic-digest change alone permits every combustion candidate after an EV answer.
test('confirmed EV decline answer blocks the rejected diesel and every other combustion candidate', async (t) => {
  const f = await fixture(t);
  good(f.out);
  assert.deepEqual(f.evaluation.decisions.map((d) => d.gateStatus), ['ineligible', 'ineligible']);
  assert.equal(f.out.value.assignments.some((a) => a.employeeId === f.employees[0].employeeId), false);
  assert.ok(f.evaluation.decisions.every((d) => d.blockers.some((b) => b.code === 'decline-answer-mismatch')));
  assert.ok(f.out.value.assumptions.some((a) => a.key === KEY));
});

test('known selected fuel resolves the answer while unrelated soft body fit stays a trade-off', async (t) => {
  const f = await fixture(t, { candidateFacts: [{ fuel: fact('ev'), body: fact('estate') }], before: 'diesel', after: 'ev' });
  good(f.out);
  assert.equal(f.evaluation.decisions[0].gateStatus, 'eligible');
  assert.equal(f.out.value.assignments.find((a) => a.employeeId === f.employees[0].employeeId)?.orderUuid, f.stock().orderUuid);
});

test('fuel list membership uses known canonical fuel facts and never option inference', async (t) => {
  const f = await fixture(t, { after: ['phev', 'ev'], candidateFacts: [{ fuel: fact('diesel') }, { fuel: fact('ev') }] });
  good(f.out);
  assert.deepEqual(f.evaluation.decisions.map((d) => d.gateStatus), ['ineligible', 'eligible']);
});

for (const [name, mutate] of [
  ['missing link', ({ current }) => { delete current.postDeclineChange; }],
  ['another decision', ({ current }) => { current.postDeclineChange.decisionId = 'unrelated'; }],
  ['another offer', ({ current }) => { current.postDeclineChange.offerId = 'unrelated'; }],
  ['unrelated path', ({ current }) => { current.postDeclineChange.path = 'preferences.body.value'; }],
  ['unconfirmed answer', ({ current }) => { current.preferences.fuel.valueState = 'inferred'; }],
  ['unconfirmed importance', ({ current }) => { current.preferences.fuel.importanceState = 'inferred'; }],
  ['nonemployee answer', ({ current }) => { current.preferences.fuel.source = 'model'; }],
  ['stale after value', ({ current }) => { current.postDeclineChange.after = 'petrol'; }],
  ['unchanged answer', ({ current }) => { current.postDeclineChange.before = 'ev'; }],
  ['unknown reason', ({ decision }) => { decision.reason.code = 'unknown'; }],
  ['missing saved confirmation', ({ current, extra }) => {
    const saved = structuredClone(current); delete saved.postDeclineChange;
    extra.push(['briefs', saved]); current.briefVersion = 3; current.previousBriefVersion = 2;
  }],
]) test(`${name} cannot reopen the latest exact car or impose the special rule on other cars`, async (t) => {
  const f = await fixture(t, { mutate }); good(f.out);
  assert.deepEqual(f.evaluation.decisions.map((d) => d.gateStatus), ['ineligible', 'eligible']);
});

test('confirmed body answer blocks unknown or mismatched bodies but admits a known selected body', async (t) => {
  const f = await fixture(t, { reason: 'body-style', before: 'suv', after: 'estate',
    candidateFacts: [{ body: fact(null) }, { body: fact('estate') }] }); good(f.out);
  assert.equal(f.evaluation.decisions[0].gateStatus, 'ineligible');
  assert.equal(f.evaluation.decisions[1].gateStatus, 'eligible');
});

test('size accepts only a closer alternative or an exact car whose own target distance improved', async (t) => {
  // Canonical city size observations are 60 for class 3 and 100 for class 1: distances to 100 are 40 and 0.
  const f = await fixture(t, { reason: 'size', before: 20, after: 100,
    candidateFacts: [{ sizeClass: fact(3, 'ordinal-1-5') }, { sizeClass: fact(1, 'ordinal-1-5') }] }); good(f.out);
  assert.deepEqual(f.evaluation.decisions.map((d) => d.gateStatus), ['ineligible', 'eligible']);
});

test('size exact car can return when its distance strictly improves without a total-fit floor', async (t) => {
  const f = await fixture(t, { reason: 'size', before: 0, after: 60,
    candidateFacts: [{ sizeClass: fact(3, 'ordinal-1-5') }] }); good(f.out);
  assert.equal(f.evaluation.decisions[0].gateStatus, 'eligible');
});

test('size cannot resolve from a missing rejected quote observation', async (t) => {
  const f = await fixture(t, { reason: 'size', before: 0, after: 100,
    mutate: ({ quote }) => { quote.eligibility.decision.tradeOffs = []; },
    candidateFacts: [{ sizeClass: fact(3, 'ordinal-1-5') }, { sizeClass: fact(5, 'ordinal-1-5') }] }); good(f.out);
  assert.deepEqual(f.evaluation.decisions.map((d) => d.gateStatus), ['ineligible', 'ineligible']);
});

test('EV answer cannot infer charging and no suitable offer replaces low-fit combustion', async (t) => {
  const f = await fixture(t, { charging: 'not-ready',
    candidateFacts: [{ fuel: fact('diesel') }, { fuel: fact('ev') }] }); good(f.out);
  assert.deepEqual(f.evaluation.decisions.map((d) => d.gateStatus), ['ineligible', 'ineligible']);
  assert.ok(f.evaluation.decisions[1].blockers.some((b) => b.code === 'charging-unavailable'));
});

test('equipment resolution uses the essential evaluator for the selected requirement', async (t) => {
  const f = await fixture(t, { reason: 'equipment', before: ['heated-seats'], after: ['towbar'],
    candidateFacts: [{ equipment: fact({ 'heated-seats': true, towbar: false }) },
      { equipment: fact({ 'heated-seats': false, towbar: true }) }] }); good(f.out);
  assert.equal(f.evaluation.decisions[0].gateStatus, 'ineligible');
  assert.equal(f.evaluation.decisions[1].gateStatus, 'eligible');
  assert.ok(f.evaluation.decisions[1].reasons.some((r) => r.code === 'essential-met' && r.field === 'equipment'));
});

function laterDecline(input, { answer = false } = {}) {
  const { quote, offer, decision, current } = input;
  const secondQuote = { ...quote, quoteId: 'quote:2', briefVersion: 2 };
  const secondOffer = { ...offer, offerId: 'offer:2', quoteId: secondQuote.quoteId, holdId: 'hold:2', briefVersion: 2 };
  const secondDecision = { ...decision, decisionId: 'decline:2', commandId: 'decline:2', offerId: secondOffer.offerId,
    createdAt: '2099-01-01T00:00:00.000Z', versions: { ...decision.versions, brief: 2, pinnedBrief: 2 },
    outcome: ok({ state: 'declined', decisionId: 'decline:2' }) };
  input.extra.push(['quotes', secondQuote], ['holds', { runId: offer.runId, holdId: 'hold:2', quoteId: secondQuote.quoteId,
    employeeId: offer.employeeId, orderUuid: offer.orderUuid, state: 'released' }], ['offers', secondOffer], ['decisions', secondDecision]);
  if (answer) {
    input.extra.push(['briefs', structuredClone(current)]);
    current.briefVersion = 3; current.previousBriefVersion = 2;
    current.preferences.fuel.value = 'diesel';
    current.postDeclineChange = { ...current.postDeclineChange, decisionId: secondDecision.decisionId,
      offerId: secondOffer.offerId, fromBriefVersion: 2, before: 'ev', after: 'diesel' };
  }
}

test('a repeated unanswered decline holds the exact car despite the previous resolved answer', async (t) => {
  const f = await fixture(t, { before: 'petrol', after: 'diesel', mutate: (input) => laterDecline(input),
    candidateFacts: [{ fuel: fact('diesel') }] }); good(f.out);
  assert.equal(f.evaluation.decisions[0].gateStatus, 'ineligible');
  assert.ok(f.evaluation.decisions[0].blockers.some((b) => b.code === 'declined-unresolved'));
});

test('a later resolved reason can readmit a historical exact car without a permanent blacklist', async (t) => {
  const f = await fixture(t, { mutate: (input) => laterDecline(input, { answer: true }),
    candidateFacts: [{ fuel: fact('diesel') }] }); good(f.out);
  assert.equal(f.evaluation.decisions[0].gateStatus, 'eligible');
});

for (const policyValue of [null, {}, { ...RULE, reasons: [] }, { ...RULE, rule: 'unknown-rule' },
  { ...RULE, extra: true }, { ...RULE, reasons: RULE.reasons.map((r) => ({ ...r, extra: true })) }]) {
  test(`recognized malformed reentry policy fails closed: ${JSON.stringify(policyValue)}`, async (t) => {
    const f = await fixture(t, { policyValue }); assert.equal(f.out.status, 'unavailable');
    assert.equal(f.calls.length, 0);
  });
}

test('optional-key provider refusal fails closed while unknown-assumption preserves historical behavior', async (t) => {
  const refused = await fixture(t, { policyFailure: result('unavailable', { code: 'provider-down' }) });
  assert.equal(refused.out.status, 'unavailable'); assert.equal(refused.calls.length, 0);
  const historical = await fixture(t, { policyFailure: { ...result('invalid', { code: 'unknown-assumption' }), policyVersion: 'gcsp-policy-v1' } });
  good(historical.out); assert.equal(historical.evaluation.decisions[0].gateStatus, 'eligible');
});
