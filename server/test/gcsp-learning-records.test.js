import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { createObservedLearningRecordService, validateLearningRecord } from '../gcsp/predict/records/index.js';
import { preference, essential, stock } from './helpers/employee-recommendation.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
async function setup() {
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'learning-fixture', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'greg');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context; const employee = paula.value.context;
  const brief = new BriefService({ repository, policy, clock, identity });
  const service = createObservedLearningRecordService({ repository, clock, identity });
  let sequence = 0;
  const write = async (work) => {
    const commandId = `fixture-${++sequence}`;
    const out = await repository.transaction(context, { commandId, inputDigest: inputDigest(commandId) }, work);
    assert.equal(out.status, 'ok', JSON.stringify(out)); return out;
  };
  return { repository, policy, clock, identity, presenter, acting, context, employee, brief, service, write };
}
async function confirm(f, version = 0, body = 'estate') {
  const brief = { schemaVersion: 1, preferences: { body: preference(body, 70), comfort: preference(65, 30) },
    essentials: { seats: essential(5), charging: { ...essential(null, 'equals', null), state: 'needs-confirmation' } },
    currentCarFeedback: { preserve: ['comfort'], change: ['size'], state: 'confirmed', source: 'employee' } };
  const draft = await f.brief.saveDraft(f.employee, { commandId: `draft-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version, brief });
  assert.equal(draft.status, 'ok', JSON.stringify(draft));
  const out = await f.brief.confirm(f.employee, { commandId: `confirm-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version + 1, consent: { search: true, hold: true } });
  assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value.brief;
}

// Outcome rows below are explicit repository fixtures, not proof of the live outcome producers.
async function outcome(f, id, state = 'active', decision, options = {}) {
  const candidate = stock(id);
  const now = (await f.clock.now(f.context)).value.now;
  const briefVersion = options.briefVersion ?? 1;
  await f.write(async (tx) => {
    let r = await tx.insert('stock', { runId: f.context.runId, orderUuid: candidate.orderUuid,
      configurationId: candidate.configurationId, state: state === 'selected' ? 'allocated' : 'released',
      allocated: state === 'selected', available: state !== 'selected', facts: candidate.snapshot });
    if (r.status !== 'ok') return r;
    const quote = { runId: f.context.runId, quoteId: `quote-${id}`, orderUuid: candidate.orderUuid, employeeId: f.employee.employeeId,
      entitlementSlotId: f.employee.entitlementSlotId, briefVersion: options.quoteBriefVersion ?? briefVersion, policyVersion: f.context.policyVersion,
      configurationId: candidate.configurationId, monthlyPoints: 1100,
      allowance: { monthlyPoints: 1300, unit: 'points/month', schemeId: f.employee.schemeId, gradeId: f.employee.gradeId,
        name: 'PRIVATE-ALLOWANCE', source: { contact: 'PRIVATE-CONTACT' } },
      quotedAt: now, validUntil: '2026-11-06T09:00:00.000Z', facts: { privateBlob: 'PRIVATE-QUOTE' }, ...options.quote };
    r = await tx.insert('quotes', quote); if (r.status !== 'ok') return r;
    r = await tx.insert('holds', { runId: f.context.runId, holdId: `hold-${id}`, quoteId: quote.quoteId,
      orderUuid: candidate.orderUuid, employeeId: f.employee.employeeId, entitlementSlotId: f.employee.entitlementSlotId,
      state: state === 'selected' ? 'allocated' : state === 'selection-pending' ? 'selection-pending' : state === 'expired' ? 'expired' : 'released',
      policyVersion: f.context.policyVersion, type: 'buddy-offer' });
    if (r.status !== 'ok') return r;
    if (!options.noOffer) {
      r = await tx.insert('offers', { runId: f.context.runId, offerId: `offer-${id}`, holdId: `hold-${id}`, quoteId: quote.quoteId,
        employeeId: f.employee.employeeId, orderUuid: candidate.orderUuid, state, briefVersion, policyVersion: f.context.policyVersion,
        expiresAt: '2020-01-01T00:00:00.000Z', tokenHash: 'PRIVATE-TOKEN', tokenMetadata: { email: 'PRIVATE-EMAIL' } });
      if (r.status !== 'ok') return r;
    }
    if (decision) {
      r = await tx.insert('decisions', { runId: f.context.runId, decisionId: `decision-${id}`, commandId: `decision-${id}`,
        offerId: `offer-${id}`, employeeId: f.employee.employeeId, decision,
        reason: { type: options.reasonType ?? 'body', text: 'PRIVATE-DECLINE', score: 99 },
        versions: { brief: options.decisionBriefVersion ?? briefVersion, policy: f.context.policyVersion },
        outcome: { status: options.pending ? 'pending' : 'ok', score: 99, satisfaction: 99 }, actorId: 'PRIVATE-ACTOR' });
      if (r.status !== 'ok') return r;
    }
    return ok({ fixture: true });
  });
}
const read = async (f, ports = {}) => {
  const service = Object.keys(ports).length ? createObservedLearningRecordService({ ...f, ...ports }) : f.service;
  return service.readRecords(f.context);
};
const records = async (f) => { const out = await read(f); assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value.records; };

test('actual BriefService confirmed intent has explicit unknown history, wait and satisfaction', async () => {
  const f = await setup(); const brief = await confirm(f);
  const [record] = await records(f);
  assert.equal(record.brief.briefVersion, brief.briefVersion);
  assert.equal(record.brief.confirmedAt, brief.confirmedAt);
  assert.deepEqual(record.brief.preferences.body, { value: 'estate', importance: 70, valueState: 'confirmed', importanceState: 'confirmed' });
  assert.equal(record.brief.essentials.charging.state, 'needs-confirmation');
  for (const value of [record.renewal.cohort, record.renewal.period, record.choiceSet, record.entitlement.schemeId]) assert.equal(value.status, 'unknown');
  assert.equal(record.outcomes.wait.state, 'unknown');
  assert.equal(record.outcomes.offered.state, 'unknown');
  assert.equal(record.outcomes.satisfaction.state, 'unknown');
  assert.deepEqual(record.provenance, { kind: 'observed' });
  assert.equal(validateLearningRecord(record).status, 'ok');
});

test('repository fixtures keep offered, selected, accepted, declined, expired and pending independent', async () => {
  const f = await setup(); await confirm(f);
  await outcome(f, 1, 'accepted', 'accept'); await outcome(f, 2, 'selected', 'select');
  await outcome(f, 3, 'declined', 'decline'); await outcome(f, 4, 'expired');
  await outcome(f, 5, 'active'); await outcome(f, 6, 'selection-pending');
  const rows = await records(f);
  assert.equal(rows.length, 6);
  const count = (field, state) => rows.filter((r) => r.outcomes[field].state === state).length;
  assert.equal(count('offered', 'offered'), 6); assert.equal(count('selection', 'selected'), 1);
  assert.equal(count('acceptance', 'accepted'), 1); assert.equal(count('expiry', 'expired'), 1);
  assert.equal(count('decline', 'declined'), 1); assert.equal(count('acceptance', 'pending'), 1);
  const accepted = rows.find((r) => r.outcomes.acceptance.state === 'accepted');
  assert.equal(accepted.outcomes.selection.state, 'unknown');
  const selected = rows.find((r) => r.outcomes.selection.state === 'selected');
  assert.equal(selected.outcomes.acceptance.state, 'unknown');
  assert.equal(rows.find((r) => r.outcomes.decline.state === 'declined').outcomes.decline.reasonType, 'body');
  assert.equal(rows.every((r) => r.outcomes.satisfaction.state === 'unknown'), true);
  assert.equal(rows.every((r) => r.outcomes.offered.at === null), true);
});

test('historical version association retains original preferences and unmatched current brief', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'accepted', 'accept'); await confirm(f, 1, 'suv');
  const rows = await records(f); assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.outcomes.offered.state === 'offered').brief.preferences.body.value, 'estate');
  assert.equal(rows.find((r) => r.outcomes.offered.state === 'unknown').brief.preferences.body.value, 'suv');
  assert.deepEqual(rows.map((r) => r.brief.briefVersion).sort(), [1, 2]);
});

test('dated saved quote terms and context are allowlisted; current stock never supplies choice exposure', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1);
  await f.write(async (tx) => {
    const found = await tx.get({ table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } });
    return tx.compareAndSwap({ table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } }, found.value.version,
      { name: 'PRIVATE-NAME', schemeId: 'current-only', gradeId: 'current-only', contract: { tripHistory: ['PRIVATE-TRIP'], usageHistory: ['PRIVATE-USAGE'] } });
  });
  const [row] = await records(f);
  assert.equal(row.terms.value.monthlyPoints, 1100); assert.equal(row.terms.value.unit, 'points/month');
  assert.equal(row.entitlement.schemeId.value, f.employee.schemeId); assert.equal(row.entitlement.gradeId.value, f.employee.gradeId);
  assert.deepEqual(row.choiceSet, { status: 'unknown', reason: 'not-captured' });
  assert.equal(row.outcomes.expiry.state, 'unknown');
  for (const forbidden of ['PRIVATE-', 'currentCarFeedback', 'tripHistory', 'usageHistory', 'tokenHash', 'score', 'name', 'source', 'contact']) {
    assert.equal(JSON.stringify(row).includes(forbidden), false, forbidden);
  }
});

test('quote without offer retains historical brief and actual selection without inventing offered or acceptance', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'selected', undefined, { noOffer: true }); await confirm(f, 1, 'suv');
  const rows = await records(f); assert.equal(rows.length, 2);
  const selected = rows.find((r) => r.outcomes.selection.state === 'selected');
  assert.equal(selected.brief.briefVersion, 1); assert.equal(selected.outcomes.offered.state, 'unknown');
  assert.equal(selected.outcomes.acceptance.state, 'unknown');
});

test('missing saved quote or incomplete dated terms remain unknown and never use current policy terms', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'active', undefined, { quote: { quotedAt: null } });
  assert.equal((await records(f))[0].terms.status, 'unknown');
  const repository = { ...f.repository, async query(context, table) {
    const out = await f.repository.query(context, table); if (table === 'quotes') out.value = []; return out;
  } };
  const out = await read(f, { repository }); assert.equal(out.status, 'ok');
  assert.deepEqual(out.value.records[0].terms, { status: 'unknown', reason: 'missing-quote' });
});

test('missing or contradictory brief version references fail safely', async () => {
  for (const options of [{ briefVersion: 2 }, { quoteBriefVersion: 2 }, { decisionBriefVersion: 2 }]) {
    const f = await setup(); await confirm(f); await outcome(f, 1, 'accepted', 'accept', options);
    assert.equal((await read(f)).status, 'unavailable');
  }
});

test('unregistered decline reason becomes typed unclassified without free text', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'declined', 'decline', { reasonType: 'PRIVATE-NAME' });
  const [r] = await records(f); assert.equal(r.outcomes.decline.reasonType, 'unclassified');
  assert.equal(JSON.stringify(r).includes('PRIVATE-'), false);
});

test('validator rejects extra fields recursively, score outcomes and invalid synthetic provenance', async () => {
  const f = await setup(); await confirm(f); const [record] = await records(f);
  const edits = [r => { r.name = 'PRIVATE'; }, r => { r.brief.preferences.body.source = {}; },
    r => { r.brief.essentials.seats.value = { personal: 'PRIVATE' }; }, r => { r.outcomes.satisfaction.score = 99; },
    r => { r.choiceSet.blob = {}; }, r => { r.provenance.seed = 1; }, r => { r.outcomes.acceptance.state = 'score'; },
    r => { r.provenance = { kind: 'synthetic', seed: 1 }; }, r => { r.outcomes.acceptance.state = 'accepted'; r.outcomes.expiry.state = 'expired'; }, r => { r.target.configurationId = { status: 'known', value: { blob: true } }; }];
  for (const edit of edits) { const r = structuredClone(record); edit(r); assert.equal(validateLearningRecord(r).status, 'invalid'); }
  const synthetic = { ...record, provenance: { kind: 'synthetic', generatorVersion: 'test-only', seed: 1 } };
  assert.equal(validateLearningRecord(synthetic).status, 'ok');
  assert.equal(record.provenance.kind, 'observed');
});

test('complete read fence rejects concurrent mutations in every source table', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1);
  for (const target of ['briefs', 'employees', 'entitlement_slots', 'offers', 'holds', 'decisions', 'quotes', 'stock']) {
    let count = 0;
    const repository = { ...f.repository, async query(context, table) {
      const out = await f.repository.query(context, table);
      if (table === target && ++count === 2) out.value = table === 'decisions' ? [{ runId: context.runId, decisionId: 'new' }] : [];
      return out;
    } };
    assert.equal((await read(f, { repository })).status, 'conflict', target);
  }
});

test('source refusal, mixed run, invalid clock and changing clock are never an empty success', async () => {
  const f = await setup(); await confirm(f);
  assert.equal((await createObservedLearningRecordService().readRecords(f.context)).status, 'unavailable');
  const unavailable = { ...f.repository, async query() { return { status: 'unavailable', reason: 'fixture', retryable: true }; } };
  assert.equal((await read(f, { repository: unavailable })).status, 'unavailable');
  const mixed = { ...f.repository, async query(context, table) { const out = await f.repository.query(context, table);
    if (table === 'briefs') out.value[0].runId = 'wrong'; return out; } };
  assert.equal((await read(f, { repository: mixed })).status, 'unavailable');
  const wrongClock = { async now() { return ok({ runId: 'other', now: '2026-11-05T09:00:00.000Z', clockVersion: 1 }); } };
  assert.equal((await read(f, { clock: wrongClock })).status, 'unavailable');
  let count = 0;
  const changedClock = { async now(context) { const out = await f.clock.now(context); out.value.clockVersion = ++count; return out; } };
  assert.equal((await read(f, { clock: changedClock })).status, 'conflict');
});

test('server identity refuses employee, forged role and stale run; authorization is fenced again', async () => {
  const f = await setup(); await confirm(f);
  assert.equal((await f.service.readRecords(f.employee)).status, 'forbidden');
  assert.equal((await f.service.readRecords({ ...f.employee, roles: ['greg'] })).status, 'forbidden');
  assert.equal((await f.service.readRecords(f.presenter.value.context)).status, 'forbidden');
  let calls = 0;
  const identity = { async requireRole(context, role) { return ++calls === 2 ? { status: 'forbidden', reason: 'fixture revoked' } : f.identity.requireRole(context, role); } };
  assert.equal((await read(f, { identity })).status, 'forbidden');
  const current = await f.repository.currentRun(f.context.environmentId);
  const reset = await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: f.context.runId,
    expectedRunVersion: current.value.version, scenarioVersion: current.value.scenarioVersion, fixtureVersion: current.value.fixtureVersion });
  assert.equal(reset.status, 'ok'); assert.equal((await read(f)).status, 'stale-run');
});


test('a pending accept decision is never confirmed acceptance or selection', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'active', 'accept', { pending: true });
  const [row] = await records(f);
  assert.equal(row.outcomes.acceptance.state, 'pending'); assert.equal(row.outcomes.selection.state, 'pending');
  assert.equal(row.outcomes.expiry.state, 'unknown');
});

test('repeated projection is deterministic and read only for unchanged sources', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'accepted', 'accept');
  const first = await read(f); const second = await read(f);
  assert.equal(first.status, 'ok'); assert.deepEqual(first, second);
});


test('retained fictional sample record passes the same closed validator', async () => {
  const sample = JSON.parse(await readFile(new URL('./fixtures/gcsp-learning-record.json', import.meta.url)));
  assert.equal(validateLearningRecord(sample).status, 'ok');
  assert.equal(sample.provenance.kind, 'observed'); assert.equal(sample.outcomes.satisfaction.state, 'unknown');
});


test('draft-only quotes are not confirmed intent and inconsistent historical slot references fail closed', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'active', undefined, { noOffer: true, quote: { briefVersion: 0 } });
  const rows = await records(f); assert.equal(rows.length, 1); assert.equal(rows[0].outcomes.offered.state, 'unknown');
  await outcome(f, 2, 'active', undefined, { quote: { entitlementSlotId: 'different-slot' } });
  assert.equal((await read(f)).status, 'unavailable');
});


const eventSources = (f, overlays) => ({ ...f.repository, async query(context, table) {
  const out = await f.repository.query(context, table);
  if (out.status === 'ok') for (const row of out.value) {
    const id = row.offerId ?? row.holdId;
    Object.assign(row, overlays[table]?.[id]);
  }
  return out;
} });
const laterClock = (f) => ({ async now(context) {
  const out = await f.clock.now(context); out.value.now = '2026-11-05T09:10:00.000Z'; return out;
} });

test('canonical rejected offer without decisions is a typed unclassified decline', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'rejected');
  const [row] = await records(f);
  assert.deepEqual(row.outcomes.decline, { state: 'declined', at: null, reasonType: 'unclassified' });
  assert.equal(row.outcomes.expiry.state, 'unknown'); assert.equal(row.outcomes.acceptance.state, 'unknown');
});

// Explicit event-field overlays test the public read contract, not unimplemented timestamp capture.
test('explicit business timestamps survive only their corresponding completed or pending outcome', async () => {
  const f = await setup(); await confirm(f);
  await outcome(f, 1, 'accepted', 'accept'); await outcome(f, 2, 'selected', 'select');
  await outcome(f, 3, 'rejected'); await outcome(f, 4, 'declined', 'decline');
  await outcome(f, 5, 'expired'); await outcome(f, 6, 'active', 'accept', { pending: true });
  await outcome(f, 7, 'decision-pending');
  const at = (minute) => `2026-11-05T09:0${minute}:00.000Z`;
  const repository = eventSources(f, {
    offers: { 'offer-1': { offeredAt: at(1), acceptedAt: at(3) }, 'offer-2': { selectedAt: at(2) },
      'offer-3': { rejectedAt: at(4) }, 'offer-4': { declinedAt: at(5) }, 'offer-5': { expiredAt: at(6) },
      'offer-7': { pendingAt: at(8) } },
    holds: { 'hold-2': { selectedAt: at(2) } },
    decisions: { 'offer-1': { decidedAt: at(3) }, 'offer-2': { decidedAt: at(2) },
      'offer-4': { decidedAt: at(5) }, 'offer-6': { decidedAt: at(7) } },
  });
  const out = await read(f, { repository, clock: laterClock(f) }); assert.equal(out.status, 'ok');
  const rows = out.value.records;
  assert.equal(rows.find((r) => r.outcomes.acceptance.state === 'accepted').outcomes.acceptance.at, at(3));
  assert.equal(rows.find((r) => r.outcomes.acceptance.state === 'accepted').outcomes.offered.at, at(1));
  assert.equal(rows.find((r) => r.outcomes.selection.state === 'selected').outcomes.selection.at, at(2));
  assert.deepEqual(rows.filter((r) => r.outcomes.decline.state === 'declined').map((r) => r.outcomes.decline.at).sort(), [at(4), at(5)]);
  assert.equal(rows.find((r) => r.outcomes.expiry.state === 'expired').outcomes.expiry.at, at(6));
  assert.deepEqual(rows.filter((r) => r.outcomes.acceptance.state === 'pending').map((r) => r.outcomes.acceptance.at).sort(), [at(7), at(8)]);
  assert.equal(rows.find((r) => r.outcomes.selection.state === 'selected').outcomes.acceptance.at, null);
  assert.equal(rows.every((r) => r.outcomes.satisfaction.at === null), true);
});

test('malformed, future and contradictory explicit business times fail safely', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'accepted', 'accept');
  const cases = [
    { offers: { 'offer-1': { acceptedAt: 'invalid' } } },
    { offers: { 'offer-1': { acceptedAt: '2026-11-06T09:00:00.000Z' } } },
    { offers: { 'offer-1': { offeredAt: '2026-11-05T09:04:00.000Z', acceptedAt: '2026-11-05T09:03:00.000Z' } } },
    { offers: { 'offer-1': { acceptedAt: '2026-11-05T09:03:00.000Z' } }, decisions: { 'offer-1': { decidedAt: '2026-11-05T09:04:00.000Z' } } },
    { decisions: { 'offer-1': { decidedAt: '2026-11-06T09:00:00.000Z' } } },
  ];
  for (const overlay of cases) assert.equal((await read(f, { repository: eventSources(f, overlay), clock: laterClock(f) })).status, 'unavailable');
  const declined = await setup(); await confirm(declined); await outcome(declined, 1, 'rejected');
  assert.equal((await read(declined, { repository: eventSources(declined, { offers: { 'offer-1': {
    rejectedAt: '2026-11-05T09:02:00.000Z', declinedAt: '2026-11-05T09:03:00.000Z',
  } } }), clock: laterClock(declined) })).status, 'unavailable');
});

test('validator rejects waited combinations and future event, brief and quote times', async () => {
  const f = await setup(); await confirm(f); await outcome(f, 1, 'accepted', 'accept'); const [record] = await records(f);
  for (const [field, state] of [['offered', 'offered'], ['selection', 'selected'], ['acceptance', 'accepted'], ['decline', 'declined'], ['expiry', 'expired']]) {
    const r = structuredClone(record);
    for (const value of Object.values(r.outcomes)) { value.state = 'unknown'; value.at = null; if ('reasonType' in value) value.reasonType = null; }
    r.outcomes.wait = { state: 'waited', at: null, reasonType: 'no-acceptable-choice' };
    assert.equal(validateLearningRecord(r).status, 'ok');
    r.outcomes[field].state = state; if (field === 'decline') r.outcomes.decline.reasonType = 'unclassified';
    assert.equal(validateLearningRecord(r).status, 'invalid', field);
  }
  const future = '2026-11-06T09:00:00.000Z';
  for (const edit of [r => { r.outcomes.acceptance.at = future; }, r => { r.brief.confirmedAt = future; },
    r => { r.terms.value.quotedAt = future; r.terms.value.validUntil = '2026-11-07T09:00:00.000Z'; },
    r => { r.choiceSet = { status: 'known', value: [{ configurationId: r.terms.value.configurationId, eligible: true, available: true,
      exposure: { status: 'unknown', reason: 'not-captured' }, terms: structuredClone(r.terms) }] };
      r.choiceSet.value[0].terms.value.quotedAt = future; r.choiceSet.value[0].terms.value.validUntil = '2026-11-07T09:00:00.000Z'; }]) {
    const r = structuredClone(record); edit(r); assert.equal(validateLearningRecord(r).status, 'invalid');
  }
  const independent = structuredClone(record); independent.timestamps.projectedAt = '2026-11-05T09:10:00.000Z';
  independent.outcomes.selection = { state: 'selected', at: '2026-11-05T09:02:00.000Z' };
  independent.outcomes.acceptance.at = '2026-11-05T09:03:00.000Z';
  assert.equal(validateLearningRecord(independent).status, 'ok');
  independent.outcomes.acceptance.at = '2026-11-05T09:01:00.000Z';
  assert.equal(validateLearningRecord(independent).status, 'ok');
  assert.equal(validateLearningRecord(record).status, 'ok');
});
