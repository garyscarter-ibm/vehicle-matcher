import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { createBriefEditorService } from '../gcsp/brief/editor.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { createManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createBriefController } from '../../blocks/gcsp/brief/brief-controller.js';
import { fact, preference, essential, stock, providerValue } from './helpers/employee-recommendation.js';
import { startHttpServer } from './helpers/employee-recommendation-http.js';

async function setup(t, { policy = createPolicyService(), seed = true } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  await repository.open(); t.after(() => repository.close());
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'brief-editor-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T12:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T12:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const f = { store, repository, policy, clock, identity, presenter, acting, context };
  if (seed) assert.equal((await seedManualDemoContext(f)).status, 'ok');
  f.account = createManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  f.brief = createBriefService(f);
  const now = (await clock.now(context)).value.now;
  f.source = { ...providerValue([stock(1, { equipment: fact({ towbar: true }) }), stock(2, { zeroTo62: fact(4, 's'), tags: fact(['sporty']), fuel: fact('phev'), equipment: fact({ towbar: false }) })]),
    runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId };
  f.source.stock.forEach((car) => { car.availability.availableFrom = now; });
  f.provider = { async resolve() { return { status: 'ok', value: structuredClone(f.source) }; } };
  f.editor = createBriefEditorService(f);
  return f;
}
const input = (brief, baseBriefVersion = 0, draftVersion = 0) => ({ kind: 'unsaved-draft', baseBriefVersion, draftVersion, brief });
const charging = (value) => ({ value, operator: 'equals', unit: null, state: value === null ? 'needs-confirmation' : 'draft', source: 'employee' });
const draft = () => ({ schemaVersion: 1, preferences: {
  comfort: { ...preference(90, 80), valueState: 'draft', importanceState: 'draft' },
  sportiness: { ...preference(30, 20), valueState: 'draft', importanceState: 'draft' },
}, essentials: { charging: charging('home') } });
const preview = (f, b = draft(), bv = 0, dv = 0) => f.editor.previewDraft(f.context, input(b, bv, dv));
const draftSave = (f, b = draft(), commandId = 'save', expectedBriefVersion = 0, expectedDraftVersion = 0) =>
  f.brief.saveDraft(f.context, { commandId, expectedBriefVersion, expectedDraftVersion, brief: b });

function controller(t, editor, transport = {}) {
  let id = 0;
  const c = createBriefController({ ...editor.value, transport: { preview: async () => ({ status: 'unavailable' }),
    saveDraft: async () => ({ status: 'unavailable' }), confirm: async () => ({ status: 'unavailable' }), ...transport },
  createCommandId: (kind) => `${kind}:${++id}` });
  t.after(() => c.destroy()); return c;
}

test('editor uses canonical controls, labelled unconfirmed defaults and sourced read-only account facts', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state);
  const read = await f.editor.readEditor(f.context);
  assert.equal(read.status, 'ok', JSON.stringify(read));
  const { context, initial, provenance } = read.value;
  assert.deepEqual([initial.briefVersion, initial.draftVersion], [0, 0]);
  assert.deepEqual(initial.consent, { search: false, hold: false });
  assert.equal(provenance.approvedBriefVersion, null);
  assert.equal(provenance.initial, 'unconfirmed-policy-defaults');
  assert.equal(context.assumptions.find((a) => a.key === 'brief.editor.v1').status, 'assumed');
  assert.equal(context.preferences.comfort.editable, true);
  assert.equal(context.preferences.comfort.dimension, undefined);
  assert.equal(context.tuning, undefined);
  assert.equal(initial.brief.preferences.comfort.valueState, 'draft');
  assert.equal(initial.brief.preferences.comfort.source, 'policy:brief.editor.v1');
  assert.equal(context.knownFacts.currentContract.value.contractId, `current:${f.context.employeeId}`);
  assert.equal(context.knownFacts.drivers.source, 'manual-account');
  assert.equal(context.knownFacts.driverEligible.sourceVersion, f.source.factsVersion);
  assert.ok(Object.values(context.permissions).every((p) => p.editable === false));
  const c = controller(t, read); assert.equal(c.updatePreference('comfort', { value: 85 }).status, 'ok');
  assert.equal(c.snapshot().brief.preferences.sportiness.value, initial.brief.preferences.sportiness.value);
  assert.deepEqual(f.store.state, before);
});

test('current matching saved draft and consumed confirmed draft reopen with actual versions and independent consent', async (t) => {
  const f = await setup(t);
  const saved = await draftSave(f); assert.equal(saved.status, 'ok', JSON.stringify(saved));
  const read = await f.editor.readEditor(f.context);
  assert.equal(read.value.provenance.initial, 'saved-draft'); assert.equal(read.value.initial.draftVersion, 1);
  const confirmed = await f.brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: false, hold: true } });
  assert.equal(confirmed.status, 'ok', JSON.stringify(confirmed));
  const reopened = await f.editor.readEditor(f.context);
  assert.equal(reopened.status, 'ok', JSON.stringify(reopened));
  assert.equal(reopened.value.provenance.initial, 'approved-brief');
  assert.deepEqual(reopened.value.initial.consent, { search: false, hold: true });
  assert.deepEqual([reopened.value.initial.briefVersion, reopened.value.initial.draftVersion], [1, 1]);
  assert.equal(reopened.value.initial.brief.buddy, undefined);
  const result = await preview(f, draft(), 1, 1);
  assert.equal(result.value.versions.brief, 1);
  assert.equal(result.value.preview.approved, false);
  assert.equal((await f.brief.readCurrent(f.context)).value.activity.canHold, false);
});

test('controller Save uses the same real FUCQ-91 draft and confirm services with explicit independent consent', async (t) => {
  const f = await setup(t); const c = controller(t, await f.editor.readEditor(f.context), {
    preview: (request) => f.editor.previewDraft(f.context, request),
    saveDraft: (request) => f.brief.saveDraft(f.context, request), confirm: (request) => f.brief.confirm(f.context, request),
  });
  c.updateEssential('equipment', []); c.updateEssential('seats', 0); c.setConsent({ search: true, hold: false });
  const saved = await c.save(); assert.equal(saved.status, 'ok', JSON.stringify(saved));
  const read = await f.editor.readEditor(f.context); assert.equal(read.status, 'ok', JSON.stringify(read));
  assert.deepEqual(read.value.initial.consent, { search: true, hold: false });
  assert.deepEqual(read.value.initial.brief.essentials.equipment.value, []);
  assert.equal(read.value.initial.brief.essentials.seats.value, 0);
});

test('preview computes all candidate decisions, keeps original draft and never fabricates approval or writes', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state); const b = draft();
  const outcome = await preview(f, b);
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
  assert.equal(outcome.value.decisions.length, 2);
  assert.deepEqual(outcome.value.preview, { kind: 'unsaved-draft', approved: false, baseBriefVersion: 0, baseDraftVersion: 0 });
  assert.equal(outcome.value.versions.brief, null);
  assert.deepEqual(outcome.value.brief, b);
  for (const d of outcome.value.decisions) {
    assert.equal(d.versions.brief, null); assert.deepEqual(d.brief, b);
    assert.equal(d.employeeFacts.charging.provenance.sourceRef, 'employee-preview:charging');
    assert.equal(d.preview.approved, false);
    assert.ok(d.reasons.some((r) => r.code === 'driver-eligible'));
    assert.ok(d.reasons.some((r) => r.code === 'required-by-met'));
  }
  assert.deepEqual(f.store.state, before);
});

test('independent comfort, sportiness, importance and indifference change real preference components', async (t) => {
  const f = await setup(t); const a = await preview(f);
  // Previews list best fit first, so compare one car by stock id rather than by position.
  const id = a.value.decisions[0].orderUuid; const car = (r) => r.value.decisions.find((d) => d.orderUuid === id);
  const b = draft(); b.preferences.comfort.value = 10;
  const changed = await preview(f, b);
  assert.notEqual(car(a).score, car(changed).score);
  assert.equal(car(a).components.find((p) => p.field === 'sportiness').score,
    car(changed).components.find((p) => p.field === 'sportiness').score);
  const weighted = draft(); weighted.preferences.comfort.importance = 0; weighted.preferences.sportiness.value = 95;
  const w = await preview(f, weighted);
  assert.equal(car(w).components.some((p) => p.field === 'comfort'), false);
  assert.notEqual(car(a).score, car(w).score);
  assert.equal(car(w).score, car(w).components[0].score);
});

test('canonical practical mappings preserve carrying/equipment/charging yes, no and unknown', async (t) => {
  const f = await setup(t); const read = await f.editor.readEditor(f.context); const q = read.value.context.practicalQuestions;
  assert.deepEqual([q.seats.no, q.boot.no, q.equipment.no, q.charging.no], [0, 0, [], 'not-ready']);
  const b = draft();
  for (const key of ['seats', 'boot', 'equipment']) {
    const d = read.value.context.essentials[key];
    b.essentials[key] = { value: q[key].yes, state: 'draft', operator: d.operator, unit: d.unit, source: 'employee' };
  }
  const yes = await preview(f, b); assert.equal(yes.value.decisions[0].gateStatus, 'eligible');
  assert.equal(yes.value.decisions[1].blockers.some((r) => r.field === 'equipment'), true);
  for (const key of ['seats', 'boot', 'equipment']) b.essentials[key].value = q[key].no;
  f.source.stock[0] = stock(1, { seats: fact(null, 'count'), boot: fact(null, 'L'), equipment: fact(null) });
  f.source.stock[0].availability.availableFrom = (await f.clock.now(f.context)).value.now;
  const no = await preview(f, b); assert.equal(no.value.decisions[0].gateStatus, 'eligible');
  b.essentials.equipment.value = null; b.essentials.equipment.state = 'needs-confirmation';
  const unknown = await preview(f, b);
  assert.equal(unknown.value.decisions[0].gateStatus, 'needs-confirmation');
  assert.ok(unknown.value.decisions[0].unknowns.some((r) => r.field === 'equipment'));
  const blocked = draft(); blocked.essentials.charging = charging(q.charging.no);
  const notReady = await preview(f, blocked);
  assert.ok(notReady.value.decisions[1].blockers.some((r) => r.code === 'charging-unavailable'));
  blocked.essentials.charging = charging(null);
  const unanswered = await preview(f, blocked);
  assert.equal(unanswered.value.decisions[1].gateStatus, 'needs-confirmation');
  assert.ok(unanswered.value.decisions[1].unknowns.some((r) => r.code === 'charging-unconfirmed'));
  assert.equal(unanswered.value.decisions[0].gateStatus, 'eligible');
});

test('unconfirmed default positions and inferred input remain explicit unknowns in computed output', async (t) => {
  const f = await setup(t); const read = await f.editor.readEditor(f.context);
  const b = structuredClone(read.value.initial.brief); b.essentials = { charging: charging('home') };
  const initial = await preview(f, b);
  assert.equal(initial.value.decisions[0].score, null);
  assert.ok(initial.value.decisions[0].unknowns.some((r) => r.code === 'preference-unconfirmed'));
  const inferred = draft(); inferred.preferences.comfort.valueState = 'inferred';
  const result = await preview(f, inferred);
  assert.ok(result.value.decisions[0].unknowns.some((r) => r.field === 'comfort'));
  assert.equal(result.value.brief.preferences.comfort.valueState, 'inferred');
});

test('provider practical, driver, points, eligibility, timing and full-stock gates survive draft input', async (t) => {
  const f = await setup(t); const request = draft(); request.essentials.seats = essential(0);
  const variants = [
    (s) => { s.employeeFacts.essentials = { seats: essential(6) }; },
    (s) => { s.employeeFacts.driverEligible = fact(false); },
    (s) => { s.employeeFacts.requiredBy = fact('2026-11-01T00:00:00.000Z'); },
    (s) => { s.stock.forEach((c) => { c.availability.state = 'held'; }); },
    (s) => { s.stock.forEach((c) => { c.snapshot.facts.eligibilityModelKey = fact('G70 Saloon|760e xDrive'); }); },
  ];
  const original = structuredClone(f.source);
  for (const change of variants) {
    f.source = structuredClone(original); change(f.source);
    const outcome = await preview(f, request);
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
    assert.equal(outcome.value.decisions.length, original.stock.length);
    assert.equal(outcome.value.recommendations.length, 0);
    assert.ok(outcome.value.decisions.every((d) => d.blockers.length || d.unknowns.length));
  }
  f.source = structuredClone(original); delete f.source.employeeFacts.essentials;
  assert.ok((await preview(f)).value.decisions.every((d) => d.gateStatus === 'needs-confirmation'));
});

test('current base and draft versions reject stale requests and stale unmatched saved draft needs refresh', async (t) => {
  const f = await setup(t); await draftSave(f);
  assert.equal((await preview(f)).status, 'stale-version');
  assert.equal((await preview(f, draft(), 1, 1)).status, 'stale-version');
  await f.brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1 });
  const b = draft(); b.preferences.comfort.value = 5;
  await draftSave(f, b, 'second', 1, 1);
  await f.brief.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 });
  const stale = await f.editor.readEditor(f.context);
  assert.equal(stale.status, 'stale-version'); assert.equal(stale.action, 'refresh');
});

test('forged authority, malformed typed inputs and accessors fail closed without repository effects', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state);
  for (const key of ['employeeId', 'runId', 'context', 'knownFacts', 'policy', 'clock', 'cash', 'contribution', 'buddy']) {
    assert.equal((await f.editor.previewDraft(f.context, { ...input(draft()), [key]: {} })).status, 'invalid', key);
    assert.equal((await preview(f, { ...draft(), [key]: {} })).status, 'invalid', key);
  }
  for (const b of [ { ...draft(), essentials: { charging: charging('sometimes') } },
    { ...draft(), preferences: { comfort: preference(101) } },
    { ...draft(), essentials: { equipment: essential(false, 'includes', 'equipment-key') } } ]) {
    assert.equal((await preview(f, b)).status, 'invalid');
  }
  let invoked = false;
  const forged = input(draft()); Object.defineProperty(forged, 'knownFacts', { get() { invoked = true; return {}; } });
  assert.equal((await f.editor.previewDraft(f.context, forged)).status, 'invalid'); assert.equal(invoked, false);
  assert.equal((await preview(f, JSON.parse('{"schemaVersion":1,"preferences":{},"essentials":{},"__proto__":{}}'))).status, 'invalid');
  assert.deepEqual(f.store.state, before);
});

test('missing, malformed, unavailable and differently scoped sources remain typed refusals', async (t) => {
  const f = await setup(t);
  assert.equal((await createBriefEditorService().readEditor(f.context)).status, 'unavailable');
  for (const provider of [{ resolve: async () => ({ status: 'unavailable' }) },
    { resolve: async () => ({ status: 'ok', value: {} }) },
    { resolve: async () => ({ status: 'ok', value: { ...f.source, employeeId: 'other' } }) }]) {
    const e = createBriefEditorService({ ...f, provider });
    assert.notEqual((await e.readEditor(f.context)).status, 'ok');
    assert.notEqual((await e.previewDraft(f.context, input(draft()))).status, 'ok');
  }
  f.source.stock[0].orderUuid = 'not-exact-stock';
  assert.equal((await preview(f)).status, 'unavailable');
  const absent = await setup(t, { seed: false });
  const read = await absent.editor.readEditor(absent.context);
  assert.equal(read.status, 'ok'); assert.equal(read.value.context.knownFacts.account.value, null);
  assert.equal(read.value.context.knownFacts.account.sourceVersion, null);
  assert.equal(read.value.context.knownFacts.account.status, 'missing');
  assert.equal(read.value.context.knownFacts.currentContract, undefined);
  assert.equal((await f.editor.readEditor({ ...f.context, employeeId: 'other' })).status, 'forbidden');
});

test('one canonical editor policy change reaches defaults, labels and practical mapping without browser constants', async (t) => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const entry = seed.assumptions.find((a) => a.key === 'brief.editor.v1');
  entry.value.preferences.comfort.value = 83; entry.value.preferences.comfort.importance = 17;
  entry.value.practicalQuestions.seats.yes = 7; entry.value.practicalQuestions.seats.label = 'Need seven seats?';
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const f = await setup(t, { policy }); const read = await f.editor.readEditor(f.context);
  assert.equal(read.status, 'ok', JSON.stringify(read));
  assert.equal(read.value.initial.brief.preferences.comfort.value, 83);
  assert.equal(read.value.initial.brief.preferences.comfort.importance, 17);
  assert.equal(read.value.context.practicalQuestions.seats.label, 'Need seven seats?');
  const b = draft(); b.essentials.seats = essential(read.value.context.practicalQuestions.seats.yes);
  assert.equal((await preview(f, b)).value.recommendations.length, 0);
});

test('approved recommendation entry stays strict positive-version and excludes charging while preview is separate', async (t) => {
  const f = await setup(t); const service = createEmployeeRecommendationService({ provider: f.provider, policy: f.policy, time: f.clock });
  for (const request of [draft(), { ...draft(), briefVersion: 0 }, { ...draft(), briefVersion: 1 }])
    assert.equal((await service.recommend(f.context, request)).status, 'invalid');
  const b = draft(); delete b.essentials.charging;
  assert.equal((await service.recommend(f.context, { ...b, briefVersion: 1 })).status, 'ok');
  assert.equal((await preview(f)).status, 'ok');
  assert.equal((await service.previewUnsaved(f.context, { brief: { ...draft(), essentials: { charging: charging('forged') } },
    baseBriefVersion: 0, baseDraftVersion: 0 })).status, 'invalid');
  assert.equal((await service.previewUnsaved(f.context, { brief: draft(), baseBriefVersion: 0, baseDraftVersion: 0,
    employeeId: 'other' })).status, 'invalid');
});

test('real guarded editor/preview HTTP composition rejects origin, role, query, authority and stale run; absent composition unavailable', async (t) => {
  const f = await setup(t);
  const http = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief, gcspBriefEditor: f.editor });
  t.after(() => http.close());
  const request = (path, options = {}) => http.request(`/api/gcsp/brief${path}`, { session: f.acting, ...options });
  const read = await request('/editor'); assert.equal(read.status, 200, JSON.stringify(read.json));
  assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.equal((await request('/preview', { body: input(draft()) })).status, 200);
  assert.equal((await request('/preview', { body: input(draft()), origin: 'https://hostile.test' })).status, 403);
  assert.equal((await request('/editor', { session: f.presenter })).status, 403);
  assert.equal((await request('/editor', { session: null })).status, 401);
  assert.equal((await request('/editor?employeeId=other')).status, 400);
  for (const key of ['runId', 'employeeId', 'policyVersion', 'knownFacts', 'cash', 'contribution'])
    assert.equal((await request('/preview', { body: { ...input(draft()), [key]: 'forged' } })).status, 400, key);
  const legacy = await request('/draft', { body: { commandId: 'http-draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: draft() } });
  assert.equal(legacy.status, 200, JSON.stringify(legacy.json));
  const state = (await f.clock.readState(f.presenter.value.context)).value;
  assert.equal((await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  assert.equal((await request('/editor')).json.status, 'stale-run');
  const absent = await setup(t); const missing = await startHttpServer({ gcspIdentity: absent.identity, gcspClock: absent.clock, gcspBrief: absent.brief });
  t.after(() => missing.close());
  assert.equal((await missing.request('/api/gcsp/brief/editor', { session: absent.acting })).status, 503);
  assert.equal((await missing.request('/api/gcsp/brief/preview', { session: absent.acting, body: input(draft()) })).status, 503);
});


test('employee no requirements never weaken independent provider facts and allowance or eligibility authority', async (t) => {
  const f = await setup(t); const b = draft(); b.essentials.equipment = essential([], 'includes', 'equipment-key');
  b.essentials.boot = essential(0, 'gte', 'L');
  f.source.employeeFacts.essentials = { equipment: essential(['towbar'], 'includes', 'equipment-key'), boot: essential(600, 'gte', 'L') };
  const required = await preview(f, b);
  assert.ok(required.value.decisions.every((d) => d.blockers.some((r) => r.field === 'boot' && r.authority === 'employee-provider')));
  assert.ok(required.value.decisions[1].blockers.some((r) => r.field === 'equipment' && r.authority === 'employee-provider'));
  f.source.employeeFacts.essentials = {};
  const policy = { getAssumption: (...args) => f.policy.getAssumption(...args), getPointsCost: (...args) => f.policy.getPointsCost(...args),
    getEligibility: (...args) => f.policy.getEligibility(...args), async getAllowance(...args) {
      const actual = await f.policy.getAllowance(...args); return { ...actual, value: { ...actual.value, monthlyPoints: 0 } };
    } };
  const over = await createBriefEditorService({ ...f, policy }).previewDraft(f.context, input(draft()));
  assert.equal(over.status, 'ok');
  assert.ok(over.value.decisions.every((d) => d.blockers.some((r) => r.code === 'allowance-exceeded')));
  policy.getAllowance = (...args) => f.policy.getAllowance(...args);
  policy.getEligibility = async (...args) => { const actual = await f.policy.getEligibility(...args);
    return { ...actual, value: { ...actual.value, state: 'ineligible' } }; };
  const excluded = await createBriefEditorService({ ...f, policy }).previewDraft(f.context, input(draft()));
  assert.ok(excluded.value.decisions.every((d) => d.blockers.some((r) => r.code === 'policy-exclude')));
});

test('preview refuses a concurrent saved-base change and unavailable account, clock or canonical mappings', async (t) => {
  const f = await setup(t); let calls = 0;
  const provider = { async resolve(context) {
    if (++calls === 2) await draftSave(f);
    return f.provider.resolve(context);
  } };
  const concurrent = createBriefEditorService({ ...f, provider });
  const outcome = await concurrent.previewDraft(f.context, input(draft()));
  assert.equal(outcome.status, 'stale-version'); assert.equal(outcome.currentVersion, 1);
  const unavailable = { status: 'unavailable', retryable: true };
  assert.equal((await createBriefEditorService({ ...f, account: { readAccount: async () => unavailable } }).readEditor(f.context)).status, 'unavailable');
  assert.equal((await createBriefEditorService({ ...f, clock: { now: async () => unavailable } }).readEditor(f.context)).status, 'unavailable');
  const policy = { async getAssumption(key, read) {
    const actual = await f.policy.getAssumption(key, read);
    if (key !== 'brief.editor.v1') return actual;
    const changed = structuredClone(actual); changed.value.value.practicalQuestions.charging.no = 'forged'; return changed;
  } };
  assert.equal((await createBriefEditorService({ ...f, policy }).readEditor(f.context)).status, 'unavailable');
});
