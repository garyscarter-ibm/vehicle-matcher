import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { preference, essential, stock, providerValue } from './helpers/employee-recommendation.js';

const implementation = await import('../gcsp/brief/index.js').catch(() => ({}));
test('BriefService exposes a repository-backed lifecycle', () => assert.equal(typeof implementation.BriefService, 'function'));
const lifecycle = (name, fn) => test(name, { skip: !implementation.BriefService }, fn);
const cmd = (commandId, input = {}) => ({ commandId, inputDigest: inputDigest(input) });
async function setup({ policy = createPolicyService() } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'brief-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const service = new implementation.BriefService({ repository, policy, clock, identity });
  return { repository, store, policy, clock, identity, presenter, acting, context, service };
}
const data = () => ({ schemaVersion: 1, preferences: { body: preference('estate'), comfort: preference(75, 0) },
  essentials: { seats: essential(5), charging: { value: null, operator: 'equals', unit: null, state: 'needs-confirmation', source: 'employee' } },
  currentCarFeedback: { preserve: ['comfort'], change: ['body'], state: 'draft', source: 'employee' } });
const save = (f, commandId = 'draft', brief = data(), versions = {}) => f.service.saveDraft(f.context, {
  commandId, expectedDraftVersion: 0, expectedBriefVersion: 0, brief, ...versions });
const confirm = (f, commandId = 'confirm', versions = {}, consent = { search: true, hold: true }) => f.service.confirm(f.context, {
  commandId, expectedDraftVersion: 1, expectedBriefVersion: 0, consent, ...versions });
const changeState = (f, operation, expectedBriefVersion, commandId = operation) => f.service[operation](f.context, { commandId, expectedBriefVersion });

lifecycle('drafts and suggestions remain separate; confirm/revise append immutable versions with provenance', async () => {
  const f = await setup();
  assert.equal((await f.service.readCurrent(f.context)).status, 'not-found');
  const draft = await save(f);
  assert.equal(draft.status, 'ok', JSON.stringify(draft));
  assert.equal(draft.value.draftVersion, 1);
  assert.equal(draft.value.knownFacts.gradeId.source, 'repository:employees');
  assert.equal((await f.repository.query(f.context, 'briefs')).value.length, 0);
  assert.equal((await f.service.readCurrent(f.context)).status, 'not-found');
  const confirmed = await confirm(f);
  assert.equal(confirmed.status, 'ok', JSON.stringify(confirmed));
  const brief = confirmed.value.brief;
  assert.equal(brief.briefVersion, 1);
  assert.equal(brief.employeeId, f.context.employeeId);
  assert.equal(brief.runId, f.context.runId);
  assert.equal(brief.preferences.comfort.importance, 0);
  assert.equal(brief.preferences.body.valueState, 'confirmed');
  assert.equal(brief.currentCarFeedback.state, 'confirmed');
  assert.equal(brief.confirmedBy, f.context.principalId);
  assert.equal(brief.confirmedAt, (await f.clock.now(f.context)).value.now);
  assert.equal(brief.createdAt, brief.confirmedAt);
  assert.equal(brief.knownFacts.gradeId.value, f.context.gradeId);
  assert.equal(brief.knownFacts.gradeId.source, 'repository:employees');
  assert.equal(brief.essentials.charging.value, null);
  assert.equal(brief.essentials.charging.state, 'needs-confirmation');
  assert.equal(confirmed.value.validation.assumptions.find((a) => a.key === 'eligibility.homeCharging.requiredForPlugIn').status, 'assumed');
  assert.deepEqual(confirmed.value.validation.unknownEssentials, ['charging']);
  const revised = data(); revised.preferences.body.value = 'suv';
  await save(f, 'draft-2', revised, { expectedDraftVersion: 1, expectedBriefVersion: 1 });
  assert.deepEqual((await f.service.readCurrent(f.context)).value.brief, brief);
  const second = await confirm(f, 'confirm-2', { expectedDraftVersion: 2, expectedBriefVersion: 1 });
  assert.equal(second.value.brief.briefVersion, 2);
  assert.equal(second.value.brief.previousBriefVersion, 1);
  assert.deepEqual((await f.service.readHistory(f.context)).value.versions.map((b) => b.briefVersion), [1, 2]);
  assert.equal((await f.repository.read(f.context, { table: 'briefs', key: { runId: f.context.runId, employeeId: f.context.employeeId, briefVersion: 1 } })).value.preferences.body.value, 'estate');
  assert.deepEqual(await confirm(f, 'confirm-2', { expectedDraftVersion: 2, expectedBriefVersion: 1 }), second);
  assert.equal((await confirm(f, 'confirm-2', { expectedDraftVersion: 2, expectedBriefVersion: 1 }, { search: false, hold: false })).status, 'conflict');
  await f.repository.close(); await f.repository.open();
  const reopened = new implementation.BriefService({ repository: f.repository, policy: f.policy, clock: f.clock, identity: f.identity });
  assert.equal((await reopened.readCurrent(f.context)).value.brief.briefVersion, 2);
  assert.equal((await reopened.readDraft(f.context)).value.draftVersion, 2);
});

lifecycle('concurrent and stale draft/confirm writes demand refresh without lost versions', async () => {
  const f = await setup(); await save(f);
  const outcomes = await Promise.all([confirm(f, 'first'), confirm(f, 'second')]);
  assert.equal(outcomes.filter((o) => o.status === 'ok').length, 1);
  const stale = outcomes.find((o) => o.status === 'stale-version');
  assert.equal(stale.action, 'refresh'); assert.equal(stale.currentVersion, 1);
  assert.equal((await save(f, 'old', data())).status, 'stale-version');
  assert.equal((await f.service.readHistory(f.context)).value.versions.length, 1);
});

lifecycle('search and hold consent are explicit independent choices; omitted consent leaves buddy off', async () => {
  for (const consent of [undefined, { search: true, hold: false }, { search: false, hold: true }, { search: true, hold: true }]) {
    const f = await setup(); await save(f);
    const input = { commandId: 'consent', expectedDraftVersion: 1, expectedBriefVersion: 0, ...(consent ? { consent } : {}) };
    const confirmed = await f.service.confirm(f.context, input);
    assert.equal(confirmed.status, 'ok', JSON.stringify(confirmed));
    assert.equal(confirmed.value.brief.buddy.searchConsent, consent?.search === true);
    assert.equal(confirmed.value.brief.buddy.holdConsent, consent?.hold === true);
    assert.equal(confirmed.value.activity.canSearch, consent?.search === true);
    assert.equal(confirmed.value.activity.canHold, consent?.search === true && consent?.hold === true);
    if (!consent) assert.equal(confirmed.value.brief.buddy.enabled, false);
  }
});

lifecycle('pause/resume append versions and receipts while existing offers stay untouched', async () => {
  const f = await setup(); await save(f); await confirm(f);
  const order = (await f.repository.query(f.context, 'stock')).value[0];
  await f.repository.transaction(f.context, cmd('offer-fixture'), async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'quote', employeeId: f.context.employeeId, orderUuid: order.orderUuid });
    await tx.insert('holds', { runId: f.context.runId, holdId: 'hold', orderUuid: order.orderUuid, employeeId: f.context.employeeId,
      entitlementSlotId: f.context.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'quote' });
    return tx.insert('offers', { runId: f.context.runId, offerId: 'offer', holdId: 'hold', quoteId: 'quote', employeeId: f.context.employeeId, state: 'active', briefVersion: 1 });
  });
  const offers = (await f.repository.query(f.context, 'offers')).value;
  const paused = await changeState(f, 'pause', 1);
  assert.equal(paused.value.brief.briefVersion, 2); assert.equal(paused.value.brief.buddy.paused, true);
  assert.deepEqual(paused.value.activity, { canSearch: false, canHold: false, existingOffersUnaffected: true, existingOffers: [{ offerId: 'offer', state: 'active', briefVersion: 1 }] });
  assert.equal((await changeState(f, 'resume', 1, 'stale')).status, 'stale-version');
  const resumed = await changeState(f, 'resume', 2);
  assert.equal(resumed.value.brief.briefVersion, 3); assert.equal(resumed.value.activity.canHold, true);
  assert.deepEqual((await f.repository.query(f.context, 'offers')).value, offers);
  const events = (await f.repository.query(f.context, 'event_receipts', { eventType: 'brief-changed' })).value;
  assert.deepEqual(events.map((r) => r.outcome.value.operation), ['confirmed', 'paused', 'resumed']);
  assert.equal(events[2].inputVersions.brief, 3);
});

lifecycle('one post-decline field change is audited, idempotent and preserves all other inputs', async () => {
  const f = await setup(); await save(f); const initial = (await confirm(f)).value.brief;
  await f.repository.transaction(f.context, cmd('decline'), (tx) => tx.insert('decisions', { runId: f.context.runId, decisionId: 'decline',
    offerId: 'offer-old', employeeId: f.context.employeeId, decision: 'decline', versions: { brief: 1 } }));
  const input = { commandId: 'one-change', decisionId: 'decline', expectedBriefVersion: 1, change: { path: 'preferences.body.value', value: 'suv' } };
  const changed = await f.service.changeAfterDecline(f.context, input);
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.equal(changed.value.brief.preferences.body.value, 'suv');
  assert.deepEqual(changed.value.brief.essentials, initial.essentials);
  assert.deepEqual(changed.value.brief.preferences.comfort, initial.preferences.comfort);
  assert.deepEqual(changed.value.brief.postDeclineChange, { decisionId: 'decline', offerId: 'offer-old', fromBriefVersion: 1,
    path: input.change.path, before: 'estate', after: 'suv', confirmedBy: f.context.principalId, confirmedAt: initial.confirmedAt });
  assert.deepEqual(await f.service.changeAfterDecline(f.context, input), changed);
  assert.equal((await f.service.changeAfterDecline(f.context, { ...input, commandId: 'again', expectedBriefVersion: 2 })).status, 'conflict');
  assert.equal((await f.service.changeAfterDecline(f.context, { ...input, commandId: 'forged', expectedBriefVersion: 2, change: { path: 'buddy.enabled', value: true } })).status, 'invalid');
});

lifecycle('invalid fields, contribution, forged known facts and inferred inputs cannot become approved defaults', async () => {
  const f = await setup();
  for (const brief of [{ ...data(), contribution: 500 }, { ...data(), knownFacts: { gradeId: 'G15' } },
    { ...data(), preferences: { nonsense: preference(50) } }, { ...data(), essentials: { seats: { ...essential(null), state: 'confirmed' } } }]) {
    assert.equal((await save(f, 'invalid', brief)).status, 'invalid');
  }
  const suggested = data(); suggested.preferences.body.valueState = 'inferred';
  await save(f, 'inferred', suggested);
  const unreviewed = await confirm(f);
  assert.equal(unreviewed.status, 'invalid');
  assert.equal(unreviewed.code, 'confirmation-required');
  assert.equal((await f.repository.query(f.context, 'briefs')).value.length, 0);
});

lifecycle('candidate gates reuse PolicyService and employee gates; unknown essentials and charging fail closed', async () => {
  const f = await setup(); await save(f); await confirm(f);
  await f.clock.advance(f.presenter.value.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 });
  const employeeFacts = providerValue().employeeFacts;
  const evaluate = (candidate, facts = employeeFacts) => f.service.evaluateCandidate(f.context, { candidate, employeeFacts: facts });
  const petrol = await evaluate(stock());
  assert.equal(petrol.status, 'ok', JSON.stringify(petrol));
  assert.equal(petrol.value.suitable, true, JSON.stringify({ blockers: petrol.value.blockers, unknowns: petrol.value.unknowns }));
  const { fact } = await import('./helpers/employee-recommendation.js');
  const plugIn = await evaluate(stock(2, { fuel: fact('phev') }));
  assert.equal(plugIn.value.suitable, false);
  assert.ok(plugIn.value.unknowns.some((u) => u.code === 'charging-unconfirmed'));
  assert.equal(plugIn.value.evidence.assumptions.find((a) => a.key === 'eligibility.homeCharging.requiredForPlugIn').status, 'assumed');
  const over = await evaluate(stock(3, { eligibilityModelKey: fact('G70 Saloon|760e xDrive') }));
  assert.equal(over.value.suitable, false);
  const unknown = data(); unknown.essentials.seats = { ...essential(null), state: 'needs-confirmation' };
  await save(f, 'unknown', unknown, { expectedDraftVersion: 1, expectedBriefVersion: 1 });
  await confirm(f, 'unknown-confirm', { expectedDraftVersion: 2, expectedBriefVersion: 1 });
  assert.equal((await evaluate(stock())).value.suitable, false);
});

lifecycle('changing the canonical charging assumption changes the brief gate without a local rule copy', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((a) => a.key === 'eligibility.homeCharging.requiredForPlugIn').value = false;
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const f = await setup({ policy }); await save(f); await confirm(f);
  const { fact } = await import('./helpers/employee-recommendation.js');
  await f.clock.advance(f.presenter.value.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 });
  const evaluated = await f.service.evaluateCandidate(f.context, { candidate: stock(1, { fuel: fact('phev') }), employeeFacts: providerValue().employeeFacts });
  assert.equal(evaluated.status, 'ok', JSON.stringify(evaluated));
  assert.equal(evaluated.value.suitable, true, JSON.stringify({ blockers: evaluated.value.blockers, unknowns: evaluated.value.unknowns }));
});

lifecycle('service refuses forged employee contexts and stale run sessions', async () => {
  const f = await setup(); await save(f); await confirm(f);
  assert.equal((await f.service.readCurrent({ ...f.context, employeeId: 'another' })).status, 'forbidden');
  assert.equal((await f.service.saveDraft({ ...f.context }, { commandId: 'forged' })).status, 'forbidden');
  const state = (await f.clock.readState(f.presenter.value.context)).value;
  await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
  assert.equal((await f.service.readCurrent(f.context)).status, 'stale-run');
  assert.equal((await changeState(f, 'pause', 1)).status, 'stale-run');
});

const cookie = (session) => [session.value.setCookie].flat().map((v) => v.split(';')[0]).join('; ');
async function withHttp(f, work) {
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.service, gcspAllowedOrigins: ['https://brief.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = async (path, { body, session = f.acting, origin = 'https://brief.test' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/brief${path}`, {
      method: body ? 'POST' : 'GET', headers: { Origin: origin, cookie: cookie(session), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, json: await response.json(), cache: response.headers.get('Cache-Control') };
  };
  try { await work(request); } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

lifecycle('HTTP routes expose lifecycle and ignore top-level browser identity/run claims using trusted context', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    assert.equal((await request('')).status, 404);
    const drafted = await request('/draft', { body: { commandId: 'http-draft', expectedDraftVersion: 0, expectedBriefVersion: 0, brief: data(),
      employeeId: 'other', runId: 'stale-browser-run', principalId: 'demo-greg', roles: ['greg'] } });
    assert.equal(drafted.status, 200, JSON.stringify(drafted));
    assert.equal(drafted.json.value.employeeId, f.context.employeeId);
    assert.equal(drafted.json.value.runId, f.context.runId);
    assert.equal((await request('/draft')).json.value.draftVersion, 1);
    const input = { commandId: 'http-confirm', expectedDraftVersion: 1, expectedBriefVersion: 0 };
    const confirmed = await request('/confirm', { body: input });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed));
    assert.equal(confirmed.json.value.brief.buddy.enabled, false);
    assert.equal(confirmed.cache, 'no-store');
    assert.equal((await request('?employeeId=other&runId=other')).json.value.brief.employeeId, f.context.employeeId);
    const stale = await request('/pause', { body: { commandId: 'stale-http', expectedBriefVersion: 0 } });
    assert.equal(stale.status, 409); assert.equal(stale.json.action, 'refresh');
    assert.equal((await request('/pause', { body: { commandId: 'pause-http', expectedBriefVersion: 1 } })).json.value.brief.buddy.paused, true);
    const resumed = await request('/resume', { body: { commandId: 'resume-http', expectedBriefVersion: 2 } });
    assert.equal(resumed.json.value.activity.canSearch, false);
    assert.equal((await request('/history')).json.value.versions.length, 3);
    assert.equal((await request('/draft', { body: { commandId: 'bad', expectedBriefVersion: 3, expectedDraftVersion: 1, brief: { ...data(), employeeId: 'other' } } })).status, 400);
    assert.equal((await request('', { session: f.presenter })).status, 403);
    assert.equal((await request('', { origin: 'https://hostile.test' })).status, 403);
  });
});

lifecycle('HTTP current/draft/history never disclose another employee and old sessions refuse after reset', async () => {
  const f = await setup(); await save(f); await confirm(f);
  const otherPrincipal = (await f.policy.getAssumption('identity.demo.principals', { runId: f.context.runId,
    asOf: (await f.clock.now(f.context)).value.now })).value.value.find((p) => p.roles.includes('employee') && p.employeeId !== f.context.employeeId);
  const other = await f.identity.switchPrincipal(f.presenter.value.context, otherPrincipal.principalId, 'other');
  await withHttp(f, async (request) => {
    assert.equal((await request('', { session: other })).status, 404);
    assert.equal((await request('/history', { session: other })).json.value.versions.length, 0);
    const state = (await f.clock.readState(f.presenter.value.context)).value;
    await f.clock.reset(f.presenter.value.context, { commandId: 'http-reset', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
    assert.equal((await request('')).status, 409);
    assert.equal((await request('/confirm', { body: { commandId: 'old-run', expectedDraftVersion: 1, expectedBriefVersion: 1 } })).json.status, 'stale-run');
  });
});

lifecycle('retained brief, conflict and validation fixtures match the real presentation contract', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/gcsp-brief-outcomes.json', import.meta.url), 'utf8'));
  const f = await setup();
  assert.deepEqual(await save(f, 'fixture-draft'), fixtures.draft);
  assert.deepEqual(await f.service.confirm(f.context, { commandId: 'fixture-confirm', expectedDraftVersion: 1, expectedBriefVersion: 0 }), fixtures.confirmed);
  assert.deepEqual(await changeState(f, 'pause', 0, 'fixture-stale'), fixtures.conflict);
  assert.deepEqual(await save(f, 'fixture-invalid', { ...data(), contribution: 500 }, { expectedDraftVersion: 1, expectedBriefVersion: 1 }), fixtures.validation);
  assert.deepEqual(await changeState(f, 'pause', 1, 'fixture-pause'), fixtures.paused);
});

lifecycle('work charging is ready; unknown equipment and driver/points gates remain independent of preferences', async () => {
  const f = await setup(); const ready = data(); ready.essentials.charging = { ...ready.essentials.charging, value: 'work', state: 'confirmed' };
  await save(f, 'ready', ready); await confirm(f);
  await f.clock.advance(f.presenter.value.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 });
  const { fact } = await import('./helpers/employee-recommendation.js');
  const facts = providerValue().employeeFacts;
  const evaluate = (candidate, employeeFacts = facts) => f.service.evaluateCandidate(f.context, { candidate, employeeFacts });
  const readyCar = stock(1, { fuel: fact('phev') });
  assert.equal((await evaluate(readyCar)).value.suitable, true);
  assert.equal((await evaluate(readyCar, { ...facts, driverEligible: fact(false) })).value.suitable, false);
  const needed = data(); needed.essentials.equipment = essential(['towbar'], 'includes', 'equipment-key');
  await save(f, 'equipment', needed, { expectedDraftVersion: 1, expectedBriefVersion: 1 });
  await confirm(f, 'equipment-confirm', { expectedDraftVersion: 2, expectedBriefVersion: 1 });
  const unknown = await evaluate(stock());
  assert.equal(unknown.value.suitable, false);
  assert.ok(unknown.value.unknowns.some((u) => u.field === 'equipment'));
  await changeState(f, 'pause', 2);
  assert.equal((await evaluate(stock())).reason, 'buddy-not-searching');
});

lifecycle('post-decline essential changes are server-stamped; other employees and invalid/multiple changes are refused', async () => {
  const f = await setup(); await save(f); const before = (await confirm(f)).value.brief;
  await f.repository.transaction(f.context, cmd('decision-fixture'), async (tx) => {
    await tx.insert('decisions', { runId: f.context.runId, decisionId: 'foreign-decline', offerId: 'foreign-offer', employeeId: 'other', decision: 'decline', versions: { brief: 1 } });
    return tx.insert('decisions', { runId: f.context.runId, decisionId: 'own-decline', offerId: 'own-offer', employeeId: f.context.employeeId, decision: 'decline', versions: { brief: 1 } });
  });
  const input = { commandId: 'essential-change', decisionId: 'own-decline', expectedBriefVersion: 1,
    change: { path: 'essentials.seats', value: essential(4) } };
  assert.equal((await f.service.changeAfterDecline(f.context, { ...input, decisionId: 'foreign-decline' })).status, 'forbidden');
  assert.equal((await f.service.changeAfterDecline(f.context, { ...input, change: { ...input.change, other: 'body' } })).status, 'invalid');
  const changed = await f.service.changeAfterDecline(f.context, input);
  assert.equal(changed.value.brief.essentials.seats.confirmedAt, before.confirmedAt);
  assert.equal(changed.value.brief.essentials.seats.value, 4);
  assert.deepEqual(changed.value.brief.preferences, before.preferences);
  assert.deepEqual(changed.value.brief.buddy, before.buddy);
  assert.deepEqual(changed.value.brief.postDeclineChange.after, changed.value.brief.essentials.seats);
});

lifecycle('unchanged essential business fields preserve the decline change despite different provenance metadata', async () => {
  const f = await setup(); await save(f); await confirm(f);
  await f.repository.transaction(f.context, cmd('no-op-decline'), (tx) => tx.insert('decisions', { runId: f.context.runId,
    decisionId: 'no-op-decline', offerId: 'no-op-offer', employeeId: f.context.employeeId, decision: 'decline', versions: { brief: 1 } }));
  const input = { commandId: 'same-essential', decisionId: 'no-op-decline', expectedBriefVersion: 1,
    change: { path: 'essentials.seats', value: { ...essential(5), source: 'reviewed-form' } } };
  const unchanged = await f.service.changeAfterDecline(f.context, input);
  assert.equal(unchanged.status, 'invalid', JSON.stringify(unchanged));
  assert.equal(unchanged.reasons[0].field, 'change.value');
  assert.equal((await f.service.readHistory(f.context)).value.versions.length, 1);
  const changed = await f.service.changeAfterDecline(f.context, { ...input, commandId: 'different-essential',
    change: { ...input.change, value: essential(4) } });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.equal(changed.value.brief.briefVersion, 2);
  assert.equal(changed.value.brief.essentials.seats.source, 'employee');
});

lifecycle('equipment ordering and duplicate keys preserve the one real post-decline change', async () => {
  const f = await setup(); const initial = data();
  initial.essentials.equipment = essential(['towbar', 'heatedSeats'], 'includes', 'equipment-key');
  await save(f, 'equipment-draft', initial); await confirm(f);
  await f.repository.transaction(f.context, cmd('equipment-decline'), (tx) => tx.insert('decisions', { runId: f.context.runId,
    decisionId: 'equipment-decline', offerId: 'equipment-offer', employeeId: f.context.employeeId, decision: 'decline', versions: { brief: 1 } }));
  const input = { commandId: 'reordered-equipment', decisionId: 'equipment-decline', expectedBriefVersion: 1,
    change: { path: 'essentials.equipment', value: essential(['heatedSeats', 'towbar', 'towbar'], 'includes', 'equipment-key') } };
  assert.equal((await f.service.changeAfterDecline(f.context, input)).status, 'invalid');
  assert.equal((await f.service.readHistory(f.context)).value.versions.length, 1);
  const changed = await f.service.changeAfterDecline(f.context, { ...input, commandId: 'different-equipment',
    change: { ...input.change, value: essential(['towbar'], 'includes', 'equipment-key') } });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.deepEqual(changed.value.brief.postDeclineChange.before.value, ['towbar', 'heatedSeats']);
  assert.deepEqual(changed.value.brief.postDeclineChange.after.value, ['towbar']);
});

lifecycle('drafts based on a previous confirmation cannot overwrite a pause; changed receipts commit atomically', async () => {
  const f = await setup(); await save(f); await confirm(f);
  await save(f, 'second-draft', data(), { expectedDraftVersion: 1, expectedBriefVersion: 1 });
  await changeState(f, 'pause', 1);
  assert.equal((await confirm(f, 'obsolete-draft', { expectedDraftVersion: 2, expectedBriefVersion: 2 })).status, 'stale-version');
  const repository = { transaction: (context, command, work) => f.repository.transaction(context, command, (tx) => work({ ...tx,
    recordReceipt: (receipt) => receipt.consumerId === 'brief:changes' ? { status: 'unavailable', reason: 'receipt-write-failed', retryable: true } : tx.recordReceipt(receipt),
  })) };
  const guarded = new implementation.BriefService({ repository, policy: f.policy, clock: f.clock, identity: f.identity });
  assert.equal((await guarded.resume(f.context, { commandId: 'failed-receipt', expectedBriefVersion: 2 })).status, 'unavailable');
  assert.equal((await f.service.readCurrent(f.context)).value.brief.briefVersion, 2);
  assert.equal((await f.repository.query(f.context, 'event_receipts', { eventType: 'brief-changed' })).value.length, 2);
});

lifecycle('pause and resume do not consume the one confirmed change answering a recorded decline', async () => {
  const f = await setup(); await save(f); await confirm(f);
  await f.repository.transaction(f.context, cmd('before-pause-decline'), (tx) => tx.insert('decisions', { runId: f.context.runId,
    decisionId: 'declined-before-pause', offerId: 'offer-before-pause', employeeId: f.context.employeeId, decision: 'decline', versions: { brief: 1 } }));
  await changeState(f, 'pause', 1); await changeState(f, 'resume', 2);
  const changed = await f.service.changeAfterDecline(f.context, { commandId: 'after-resume-change', decisionId: 'declined-before-pause',
    expectedBriefVersion: 3, change: { path: 'preferences.body.value', value: 'suv' } });
  assert.equal(changed.status, 'ok', JSON.stringify(changed));
  assert.equal(changed.value.brief.postDeclineChange.fromBriefVersion, 3);
  assert.equal(changed.value.brief.briefVersion, 4);
});
