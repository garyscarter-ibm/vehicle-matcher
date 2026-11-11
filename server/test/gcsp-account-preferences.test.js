import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { createBriefEditorService, briefSemantic } from '../gcsp/brief/editor.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { createManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { scorePreferences, validateBriefContent } from '../scenarios/employee/index.js';
import { createBriefController } from '../../blocks/gcsp/brief/brief-controller.js';
import { fact, preference, stock, providerValue } from './helpers/employee-recommendation.js';
import { startHttpServer, cookieOf, EMPLOYEE_ORIGIN } from './helpers/employee-recommendation-http.js';
import { createBriefTransport } from '../../blocks/gcsp/brief/brief-transport.js';
import { createAccountPreferencesController } from '../../blocks/gcsp/brief/account-preferences-controller.js';

const KEY = 'brief.accountPreferences.v1';
const SLIDERS = ['sportiness', 'comfort', 'economy', 'size'];

async function setup(t, { policy = createPolicyService() } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  await repository.open(); t.after(() => repository.close());
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'account-preferences-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T12:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T12:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const f = { store, repository, policy, clock, identity, presenter, acting, context };
  assert.equal((await seedManualDemoContext(f)).status, 'ok');
  f.account = createManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  f.brief = createBriefService(f);
  const now = (await clock.now(context)).value.now;
  f.source = { ...providerValue([stock(1, { equipment: fact({ towbar: true }) }),
    stock(2, { body: fact('coupe'), fuel: fact('phev'), zeroTo62: fact(4, 's'), tags: fact(['sporty']), equipment: fact({ towbar: false }) })]),
  runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId };
  f.source.stock.forEach((car) => { car.availability.availableFrom = now; });
  f.provider = { async resolve() { return { status: 'ok', value: structuredClone(f.source) }; } };
  f.editor = createBriefEditorService(f);
  return f;
}

let serial = 0;
const save = (f, changes, expectedDraftVersion = 0, expectedBriefVersion = 0, commandId = `cmd-${++serial}`) =>
  f.editor.savePreferences(f.context, { commandId, expectedBriefVersion, expectedDraftVersion, changes });
const read = async (f) => { const r = await f.editor.readEditor(f.context); assert.equal(r.status, 'ok', JSON.stringify(r)); return r.value; };
const draftOf = async (f) => (await f.brief.readDraft(f.context)).value;
const entry = (b, key) => b.preferences[key];

// Sequential saver that tracks the draft version, so each step reads like a user edit.
function session(f) {
  let draftVersion = 0;
  return async (changes) => {
    const out = await save(f, changes, draftVersion);
    if (out.status === 'ok') draftVersion = out.value.draftVersion;
    return out;
  };
}

async function patchedSeed(change) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  change(seed.assumptions.find((a) => a.key === KEY).value);
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}

async function registry(f) {
  const read = { runId: f.context.runId, asOf: (await f.clock.now(f.context)).value.now, policyVersion: f.context.policyVersion };
  const [config, minimum, maximum] = await Promise.all(['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum']
    .map(async (key) => (await f.policy.getAssumption(key, read)).value.value));
  return { config, slider: { minimum, maximum } };
}

test('policy defaults are never considered; confirmed values and zero importance follow the considered rule', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state);
  const first = await read(f);
  assert.equal(first.initial.brief.preferences.comfort.source, 'policy:brief.editor.v1');
  assert.deepEqual(first.initial.accountPreferences.categories, Object.fromEntries(first.context.accountPreferences.order.map((k) => [k, { state: 'unset' }])));
  assert.equal(first.initial.accountPreferences.considered, 0);
  assert.deepEqual(f.store.state, before);
  assert.equal(first.context.accountPreferences.policyVersion, f.context.policyVersion);
  assert.deepEqual(first.context.accountPreferences.importance, { medium: 50, high: 100 });
  assert.equal(first.context.accountPreferences.minimumCategories, 3);
  assert.deepEqual(first.context.preferences.body.multiple, true);
  assert.equal(first.context.preferences.comfort.multiple, undefined);
  // Genuine confirmed values stay considered, a zero importance does not count and a confirmed value on a policy source counts.
  const brief = { schemaVersion: 1, preferences: { comfort: preference(90, 80), sportiness: preference(30, 0), size: { ...preference(50, 50), source: 'policy:brief.editor.v1' } },
    essentials: {} };
  assert.equal((await f.brief.saveDraft(f.context, { commandId: 'seed', expectedBriefVersion: 0, expectedDraftVersion: 0, brief })).status, 'ok');
  const next = (await read(f)).initial.accountPreferences;
  assert.equal(next.considered, 2);
  assert.deepEqual(next.categories.comfort, { state: 'considered', value: 100, importance: 'high', exact: false });
  assert.equal(next.categories.sportiness.state, 'unset');
  assert.equal(next.categories.size.state, 'considered');
  assert.equal(next.categories.body.state, 'unset');
});

test('an old scalar body reads as a list and scores like the list; a multiple list validates, persists and scores', async (t) => {
  const f = await setup(t); const { config, slider } = await registry(f);
  const brief = (value) => ({ schemaVersion: 1, preferences: { body: preference(value) }, essentials: {} });
  assert.deepEqual(validateBriefContent(brief('estate'), config, slider), []);
  assert.deepEqual(validateBriefContent(brief(['estate']), config, slider), []);
  assert.deepEqual(validateBriefContent(brief(['saloon', 'estate']), config, slider), []);
  for (const bad of [[], ['estate', 'saloon'], ['estate', 'estate'], ['truck'], ['saloon', 'truck'], [['estate']]])
    assert.equal(validateBriefContent(brief(bad), config, slider).length, 1, JSON.stringify(bad));
  assert.equal(validateBriefContent({ schemaVersion: 1, preferences: { sportiness: preference([50]) }, essentials: {} }, config, slider).length, 1);
  const [estate, coupe] = f.source.stock;
  const fit = (car, value) => scorePreferences(car.snapshot, brief(value), {}, config, slider).components[0].score;
  assert.equal(fit(estate, 'estate'), fit(estate, ['estate']));
  assert.equal(fit(coupe, 'estate'), fit(coupe, ['estate']));
  assert.ok(fit(estate, ['saloon', 'estate']) > fit(coupe, ['saloon', 'estate']));
  assert.equal(fit(estate, ['saloon', 'estate']), fit(estate, 'estate'));
  // The same through the real service: the saved list is read back and the saved draft is previewed.
  const step = session(f); const saved = await step({ body: { value: ['saloon', 'estate'] } });
  assert.equal(saved.status, 'ok', JSON.stringify(saved));
  const reread = await read(f);
  assert.deepEqual(entry(reread.initial.brief, 'body').value, ['saloon', 'estate']);
  const preview = await f.editor.previewDraft(f.context, { kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 1,
    brief: { ...reread.initial.brief, essentials: { charging: { value: 'home', operator: 'equals', unit: null, state: 'draft', source: 'employee' } } } });
  assert.equal(preview.status, 'ok', JSON.stringify(preview));
  const bodyScore = (id) => preview.value.decisions.find((d) => d.orderUuid === id).components.find((c) => c.field === 'body').score;
  assert.ok(bodyScore(estate.orderUuid) > bodyScore(coupe.orderUuid));
  // A legacy scalar saved by the old editor reads back as a one-item list.
  const g = await setup(t);
  assert.equal((await g.brief.saveDraft(g.context, { commandId: 'old', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: {} } })).status, 'ok');
  assert.deepEqual((await read(g)).initial.accountPreferences.categories.body, { state: 'considered', value: ['estate'], importance: 'high', exact: true });
});

test('every slider stop saves and reads back; non-stops are refused but a legacy value reads as the nearest stop', async (t) => {
  const f = await setup(t); const step = session(f);
  for (const key of SLIDERS) for (const stop of [0, 50, 100]) {
    const out = await step({ [key]: { value: stop } });
    assert.equal(out.status, 'ok', `${key} ${stop} ${JSON.stringify(out)}`);
    assert.deepEqual(out.value.accountPreferences.categories[key], { state: 'considered', value: stop, importance: 'medium', exact: true });
    assert.equal(entry((await draftOf(f)).brief, key).value, stop);
  }
  for (const bad of [40, 101, -1, 50.5, '50', null, true]) {
    const out = await step({ sportiness: { value: bad } });
    assert.equal(out.status, 'invalid', String(bad));
    assert.equal(out.reasons[0].field, 'changes.sportiness.value');
  }
  const g = await setup(t);
  const brief = { schemaVersion: 1, preferences: { sportiness: preference(37, 50), comfort: preference(25, 50), economy: preference(75, 50), size: preference(100, 50) }, essentials: {} };
  assert.equal((await g.brief.saveDraft(g.context, { commandId: 'legacy', expectedBriefVersion: 0, expectedDraftVersion: 0, brief })).status, 'ok');
  const { categories } = (await read(g)).initial.accountPreferences;
  assert.deepEqual(categories.sportiness, { state: 'considered', value: 50, importance: 'medium', exact: false });
  assert.deepEqual([categories.comfort.value, categories.comfort.exact], [50, false]);
  assert.deepEqual([categories.economy.value, categories.economy.exact], [50, false]);
  assert.deepEqual([categories.size.value, categories.size.exact], [100, true]);
});

test('importance is medium or high only, orphan importance is refused and removal clears both', async (t) => {
  const f = await setup(t); const step = session(f);
  const stored = async (key) => entry((await draftOf(f)).brief, key);
  let out = await step({ comfort: { value: 100 } });
  assert.deepEqual(await stored('comfort'), { value: 100, importance: 50, valueState: 'draft', importanceState: 'draft', source: 'employee' });
  out = await step({ comfort: { importance: 'high' } });
  assert.equal((await stored('comfort')).importance, 100);
  assert.equal(out.value.accountPreferences.categories.comfort.importance, 'high');
  assert.equal(out.value.accountPreferences.considered, 1);
  out = await step({ comfort: { importance: 'medium' } });
  assert.equal((await stored('comfort')).importance, 50); assert.equal((await stored('comfort')).value, 100);
  await step({ comfort: { importance: 'high' } });
  // A value-only patch keeps the existing importance.
  await step({ comfort: { value: 0 } });
  assert.equal((await stored('comfort')).importance, 100);
  // Orphan importance, numeric weights and empty values are refused without a write.
  const version = (await draftOf(f)).draftVersion;
  for (const changes of [{ size: { importance: 'high' } }, { comfort: { importance: 75 } }, { comfort: { importance: 'urgent' } },
    { comfort: { importance: 100 } }, { body: { value: [] } }, { body: {} }, { comfort: {} }, { comfort: 5 }, {}, []]) {
    const refused = await step(changes);
    assert.equal(refused.status, 'invalid', JSON.stringify(changes));
  }
  assert.equal((await draftOf(f)).draftVersion, version);
  // Null removes value and importance; choosing again starts at medium, even after a high weight.
  out = await step({ comfort: null });
  assert.equal(out.value.accountPreferences.categories.comfort.state, 'unset');
  assert.equal(Object.hasOwn((await draftOf(f)).brief.preferences, 'comfort'), false);
  const orphan = await step({ comfort: { importance: 'high' } });
  assert.equal(orphan.status, 'invalid');
  await step({ comfort: { value: 50 } });
  assert.equal((await stored('comfort')).importance, 50);
  // Removing a category that is not there is harmless.
  assert.equal((await step({ size: null })).status, 'ok');
});

test('unknown categories and options and injected authority fields are refused', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state);
  const refused = [
    { changes: { price: { value: 1 } } }, { changes: { essentials: { value: 1 } } }, { changes: { constructor: null } },
    { changes: { body: { value: ['truck'] } } }, { changes: { body: { value: ['estate', 'saloon'] } } }, { changes: { fuel: { value: 'petrol' } } },
    { changes: { body: { value: ['estate'], weight: 4 } } }, { changes: { sportiness: { value: 'sporty' } } },
  ];
  for (const extra of refused) assert.equal((await f.editor.savePreferences(f.context,
    { commandId: 'bad', expectedBriefVersion: 0, expectedDraftVersion: 0, ...extra })).status, 'invalid', JSON.stringify(extra));
  const good = { commandId: 'bad', expectedBriefVersion: 0, expectedDraftVersion: 0, changes: { comfort: { value: 50 } } };
  for (const field of ['employeeId', 'runId', 'policy', 'policyVersion', 'buddy', 'consent', 'essentials', 'brief', 'context', 'knownFacts'])
    assert.equal((await f.editor.savePreferences(f.context, { ...good, [field]: {} })).status, 'invalid', field);
  for (const missing of ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'changes']) {
    const partial = { ...good }; delete partial[missing];
    assert.equal((await f.editor.savePreferences(f.context, partial)).status, 'invalid', missing);
  }
  for (const bad of [{ commandId: '' }, { expectedBriefVersion: -1 }, { expectedDraftVersion: 1.5 }, { commandId: 7 }])
    assert.equal((await f.editor.savePreferences(f.context, { ...good, ...bad })).status, 'invalid', JSON.stringify(bad));
  assert.equal((await f.editor.savePreferences(f.context, null)).status, 'invalid');
  assert.equal((await f.editor.savePreferences(f.context, JSON.parse('{"commandId":"x","expectedBriefVersion":0,"expectedDraftVersion":0,"changes":{"__proto__":{"value":1}}}'))).status, 'invalid');
  assert.deepEqual(f.store.state, before);
});

test('essentials, current-car feedback, other preferences and consent survive every save', async (t) => {
  const f = await setup(t);
  const seed = { schemaVersion: 1, preferences: { comfort: preference(100, 100), body: preference('estate', 50) },
    essentials: { seats: { value: 5, operator: 'gte', unit: 'count', state: 'draft', source: 'employee' },
      equipment: { value: ['towbar'], operator: 'includes', unit: 'equipment-key', state: 'draft', source: 'employee' },
      boot: { value: null, operator: 'gte', unit: 'L', state: 'needs-confirmation', source: 'policy:brief.editor.v1' } },
    currentCarFeedback: { preserve: ['comfort'], change: ['size'], state: 'draft', source: 'employee' } };
  assert.equal((await f.brief.saveDraft(f.context, { commandId: 'seed', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: seed })).status, 'ok');
  const out = await save(f, { size: { value: 100 }, fuel: { value: ['phev', 'ev'], importance: 'high' } }, 1);
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.draftVersion, 2);
  const after = (await draftOf(f)).brief;
  assert.deepEqual(after.essentials, seed.essentials);
  assert.deepEqual(after.currentCarFeedback, seed.currentCarFeedback);
  assert.deepEqual(after.preferences.comfort, seed.preferences.comfort);
  assert.deepEqual(after.preferences.body, seed.preferences.body);
  assert.deepEqual(after.preferences.fuel.value, ['phev', 'ev']);
  assert.equal(after.preferences.fuel.importance, 100);
  assert.deepEqual(after.preferences.size, { value: 100, importance: 50, valueState: 'draft', importanceState: 'draft', source: 'employee' });
  // Autosave never confirms, grants consent, or starts anything.
  assert.equal((await f.brief.readCurrent(f.context)).status, 'not-found');
  assert.deepEqual((await read(f)).initial.consent, { search: false, hold: false });
  // The controller still accepts the editor payload with lists and the account projection.
  const editor = await read(f);
  assert.doesNotThrow(() => createBriefController({ ...editor, transport: { preview: async () => ({}), saveDraft: async () => ({}), confirm: async () => ({}) },
    createCommandId: () => 'id' }).destroy());
  // A new employee starts sparse with unconfirmed essentials, not invented preferences.
  const g = await setup(t);
  assert.equal((await save(g, { economy: { value: 0 } })).status, 'ok');
  const fresh = (await draftOf(g)).brief;
  assert.deepEqual(Object.keys(fresh.preferences), ['economy']);
  assert.ok(Object.values(fresh.essentials).every((e) => e.value === null && e.state === 'needs-confirmation'));
  assert.ok(Object.hasOwn(fresh.essentials, 'charging'));
});

test('stale versions write nothing, a retried command is idempotent and an accepted offer is read-only', async (t) => {
  const f = await setup(t);
  assert.equal((await save(f, { comfort: { value: 50 } }, 0, 0, 'first')).status, 'ok');
  const before = structuredClone(f.store.state);
  const stale = await save(f, { comfort: { value: 100 } }, 0, 0, 'second');
  assert.equal(stale.status, 'stale-version'); assert.equal(stale.resource.table, 'brief-draft');
  const staleBrief = await save(f, { comfort: { value: 100 } }, 1, 3, 'third');
  assert.equal(staleBrief.status, 'stale-version'); assert.equal(staleBrief.resource.table, 'briefs');
  assert.deepEqual(f.store.state, before);
  // The same command and changes return the recorded result without a second draft.
  const again = await save(f, { comfort: { value: 50 } }, 0, 0, 'first');
  assert.equal(again.status, 'ok'); assert.equal(again.value.draftVersion, 1);
  assert.deepEqual(f.store.state, before);
  assert.equal((await draftOf(f)).draftVersion, 1);
  assert.equal((await save(f, { comfort: { value: 0 } }, 0, 0, 'first')).status, 'conflict');
  assert.equal((await save(f, { size: { value: 50 } }, 1, 0, 'next')).value.draftVersion, 2);
  // A stale unmatched draft is the same refresh the editor read returns.
  assert.equal((await f.brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 2 })).status, 'ok');
  assert.equal((await save(f, { comfort: { value: 100 } }, 2, 1, 'after-confirm')).status, 'ok');
  assert.equal((await f.brief.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 })).status, 'ok');
  assert.equal((await f.editor.readEditor(f.context)).status, 'stale-version');
  assert.equal((await save(f, { comfort: { value: 0 } }, 3, 2, 'stale-draft')).status, 'stale-version');
  // After an accept the brief is read-only.
  const accepted = createBriefEditorService({ ...f, brief: { readDraft: (c) => f.brief.readDraft(c), readHistory: (c) => f.brief.readHistory(c),
    saveDraft: (...a) => f.brief.saveDraft(...a), async readCurrent(c) {
      const r = await f.brief.readCurrent(c); r.value.activity.existingOffers = [{ offerId: 'o1', state: 'accepted', briefVersion: 1 }]; return r;
    } } });
  const blocked = await accepted.savePreferences(f.context, { commandId: 'late', expectedBriefVersion: 2, expectedDraftVersion: 3, changes: { size: { value: 100 } } });
  assert.equal(blocked.status, 'conflict'); assert.equal(blocked.reason, 'brief-read-only');
  assert.equal((await f.brief.readDraft(f.context)).value.draftVersion, 3);
  // Wrong role and a different employee are refused by the existing guards.
  assert.equal((await f.editor.savePreferences(f.presenter.value.context, { commandId: 'p', expectedBriefVersion: 0, expectedDraftVersion: 0, changes: { size: null } })).status, 'forbidden');
  assert.equal((await createBriefEditorService().savePreferences(f.context, { commandId: 'u', expectedBriefVersion: 0, expectedDraftVersion: 0, changes: { size: null } })).status, 'unavailable');
});

test('zero, one and two categories autosave with no minimum enforced', async (t) => {
  const f = await setup(t); const step = session(f);
  assert.equal((await step({ body: { value: ['coupe'] } })).value.accountPreferences.considered, 1);
  assert.equal((await step({ fuel: { value: ['ev'] } })).value.accountPreferences.considered, 2);
  assert.equal((await step({ body: null })).value.accountPreferences.considered, 1);
  const none = await step({ fuel: null });
  assert.equal(none.status, 'ok'); assert.equal(none.value.accountPreferences.considered, 0);
  assert.deepEqual((await draftOf(f)).brief.preferences, {});
  assert.deepEqual((await read(f)).initial.accountPreferences.categories.fuel, { state: 'unset' });
  assert.equal((await read(f)).context.accountPreferences.minimumCategories, 3);
});

test('one canonical mapping change reaches projection, saved importance and score evidence; v1 stays pinned', async (t) => {
  const policy = await patchedSeed((v) => { v.importance.high = 90; v.categories.comfort.stops[2].label = 'Plush'; });
  const f = await setup(t, { policy }); const step = session(f);
  const editor = await read(f);
  assert.equal(editor.context.accountPreferences.importance.high, 90);
  assert.equal(editor.context.accountPreferences.categories.comfort.stops[2].label, 'Plush');
  assert.equal((await step({ comfort: { value: 100, importance: 'high' } })).status, 'ok');
  const saved = (await draftOf(f)).brief;
  assert.equal(saved.preferences.comfort.importance, 90);
  const preview = await f.editor.previewDraft(f.context, { kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 1,
    brief: { ...saved, essentials: { charging: { value: 'home', operator: 'equals', unit: null, state: 'draft', source: 'employee' } } } });
  assert.equal(preview.status, 'ok', JSON.stringify(preview));
  assert.ok(preview.value.decisions.every((d) => d.components.find((c) => c.field === 'comfort').importance === 90));
  assert.equal((await read(f)).initial.accountPreferences.categories.comfort.importance, 'high');
  // The unchanged pinned policy still maps high to 100 and keeps the original label.
  const v1 = await setup(t); const pinned = await read(v1);
  assert.equal(pinned.context.accountPreferences.importance.high, 100);
  assert.equal(pinned.context.accountPreferences.categories.comfort.stops[2].label, 'As comfortable as possible');
  assert.equal((await save(v1, { comfort: { value: 100, importance: 'high' } })).status, 'ok');
  assert.equal((await draftOf(v1)).brief.preferences.comfort.importance, 100);
  const exact = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8')).assumptions.find((a) => a.key === KEY);
  assert.deepEqual(exact.value.importance, { medium: 50, high: 100, highFrom: 75 }); assert.equal(exact.status, 'assumed');
});

test('a missing or malformed account preference policy makes the editor unavailable', async (t) => {
  for (const change of [(v) => { delete v.categories.size; }, (v) => { v.importance.medium = 0; }, (v) => { v.importance.highFrom = 40; },
    (v) => { v.categories.comfort.stops = v.categories.comfort.stops.slice(0, 2); v.categories.comfort.openDefault = 100; },
    (v) => { v.categories.sportiness.openDefault = 40; }, (v) => { v.categories.body.options[0].value = 'tractor'; },
    (v) => { v.categories.fuel.options.reverse(); }, (v) => { v.categories.size.kind = 'multi'; }]) {
    const f = await setup(t, { policy: await patchedSeed(change) });
    assert.equal((await f.editor.readEditor(f.context)).status, 'unavailable', change.toString());
    assert.equal((await save(f, { comfort: { value: 50 } })).status, 'unavailable', change.toString());
  }
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions = seed.assumptions.filter((a) => a.key !== KEY);
  const missing = await setup(t, { policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  assert.equal((await missing.editor.readEditor(missing.context)).status, 'unavailable');
});

test('real authenticated HTTP saves a draft and the editor read returns the same record', async (t) => {
  const f = await setup(t);
  const http = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief, gcspBriefEditor: f.editor });
  t.after(() => http.close());
  const body = (changes, extra = {}) => ({ commandId: `http-${++serial}`, expectedBriefVersion: 0, expectedDraftVersion: 0, changes, ...extra });
  const post = (b, options = {}) => http.request('/api/gcsp/brief/preferences', { session: f.acting, body: b, ...options });
  assert.equal((await post(body({ comfort: { value: 50 } }), { session: null })).status, 401);
  assert.equal((await post(body({ comfort: { value: 50 } }), { session: f.presenter })).status, 403);
  assert.equal((await post(body({ comfort: { value: 50 } }), { origin: 'https://hostile.test' })).status, 403);
  assert.equal((await http.request('/api/gcsp/brief/preferences?employeeId=other', { session: f.acting, body: body({ comfort: { value: 50 } }) })).status, 400);
  for (const key of ['employeeId', 'runId', 'buddy', 'consent', 'essentials']) assert.equal((await post(body({ comfort: { value: 50 } }, { [key]: {} }))).status, 400, key);
  const ok = await post(body({ body: { value: ['saloon', 'estate'] }, comfort: { value: 100, importance: 'high' } }));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.equal(ok.json.value.draftVersion, 1);
  const editor = await http.request('/api/gcsp/brief/editor', { session: f.acting });
  assert.equal(editor.status, 200);
  assert.equal(editor.json.value.provenance.initial, 'saved-draft');
  assert.deepEqual(editor.json.value.initial.accountPreferences, ok.json.value.accountPreferences);
  assert.equal(editor.json.value.initial.accountPreferences.considered, 2);
  assert.deepEqual(editor.json.value.initial.accountPreferences.categories.body, { state: 'considered', value: ['saloon', 'estate'], importance: 'medium', exact: true });
  assert.deepEqual(editor.json.value.initial.accountPreferences.categories.comfort, { state: 'considered', value: 100, importance: 'high', exact: true });
  const stored = await http.request('/api/gcsp/brief/draft', { session: f.acting });
  assert.deepEqual(stored.json.value.brief.preferences.body.value, ['saloon', 'estate']);
  assert.equal(stored.json.value.brief.preferences.comfort.importance, 100);
  const stale = await post(body({ comfort: { value: 0 } }));
  assert.equal(stale.status, 409); assert.equal(stale.json.status, 'stale-version');
  const unconfigured = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief });
  t.after(() => unconfigured.close());
  assert.equal((await unconfigured.request('/api/gcsp/brief/preferences', { session: f.acting, body: body({ comfort: { value: 50 } }) })).status, 503);
});

test('the browser transport and controller save through the real route and the editor reads the same record back', async (t) => {
  const f = await setup(t);
  const http = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief, gcspBriefEditor: f.editor });
  t.after(() => http.close());
  const base = `http://127.0.0.1:${http.server.address().port}`;
  const fetch = (url, init) => globalThis.fetch(url, { ...init, headers: { ...init.headers, Origin: EMPLOYEE_ORIGIN, cookie: cookieOf(f.acting) } });
  const transport = createBriefTransport({ fetch, baseURL: base });
  let id = 0; const controller = createAccountPreferencesController({ transport, createCommandId: (kind) => `${kind}-http-${++id}` });
  await controller.load(); assert.equal(controller.snapshot().phase, 'ready'); assert.equal(controller.snapshot().status.kind, 'idle');
  controller.change('body', { value: ['saloon'] }); controller.change('body', { value: ['saloon', 'estate'] }); controller.open('comfort'); controller.change('comfort', { importance: 'high' });
  for (let at = 0; at < 50 && controller.snapshot().status.kind === 'pending'; at += 1) await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual([controller.snapshot().status.kind, controller.snapshot().draftVersion], ['saved', 2]);
  const readback = await read(f);
  assert.equal(readback.initial.draftVersion, 2);
  assert.deepEqual(readback.initial.accountPreferences.categories.body, { state: 'considered', value: ['saloon', 'estate'], importance: 'medium', exact: true });
  assert.deepEqual(readback.initial.accountPreferences.categories.comfort, { state: 'considered', value: 50, importance: 'high', exact: true });
  const fresh = createAccountPreferencesController({ transport, createCommandId: () => 'unused' }); await fresh.load();
  assert.deepEqual(fresh.snapshot().categories, readback.initial.accountPreferences.categories);
  controller.requestRemove('body'); controller.confirmRemove('body');
  for (let at = 0; at < 50 && controller.snapshot().status.kind === 'pending'; at += 1) await new Promise((done) => setTimeout(done, 10));
  assert.equal(controller.snapshot().status.text, 'Body preference removed. Saved automatically.');
  assert.deepEqual((await read(f)).initial.accountPreferences.categories.body, { state: 'unset' });
  // A second window still on the old version is told to reload, and keeps what it had until it does.
  controller.change('size', { value: 100 });
  for (let at = 0; at < 50 && controller.snapshot().status.kind === 'pending'; at += 1) await new Promise((done) => setTimeout(done, 10));
  fresh.change('economy', { value: 0 });
  for (let at = 0; at < 50 && fresh.snapshot().status.kind === 'pending'; at += 1) await new Promise((done) => setTimeout(done, 10));
  assert.equal(fresh.snapshot().status.kind, 'stale'); assert.equal(fresh.snapshot().categories.economy.value, 0);
  await fresh.reload(); assert.equal(fresh.snapshot().categories.economy.state, 'unset'); assert.equal(fresh.snapshot().categories.size.value, 100);
  // Same again through the same controller and route: the choices and importance stay exactly as saved, and the score follows.
  const settled = async (c) => { for (let at = 0; at < 50 && c.snapshot().status.kind === 'pending'; at += 1) await new Promise((done) => setTimeout(done, 10)); };
  const before = (await read(f)).initial.accountPreferences; const contractId = await carOf(f);
  assert.deepEqual(controller.snapshot().sameAgain, { available: true, on: false, reason: null, status: 'idle' });
  controller.toggleSameAgain(true); await settled(controller);
  assert.deepEqual(controller.snapshot().sameAgain, { available: true, on: true, reason: null, status: 'saved' });
  assert.equal(controller.snapshot().status.text, 'More like your current car. Preferences save automatically.');
  assert.deepEqual(controller.snapshot().understanding, { value: 11, maximum: 11, pending: false, failed: false });
  let on = await read(f); const row = (await draftOf(f)).brief;
  assert.deepEqual([row.sameAgain.on, row.sameAgain.contractId], [true, contractId]);
  assert.deepEqual(on.initial.sameAgain, { available: true, on: true, contractId });
  assert.deepEqual(on.initial.accountPreferences.categories, before.categories, 'choices and importance are untouched');
  assert.deepEqual([on.initial.accountPreferences.understanding.value, on.initial.accountPreferences.understanding.basis], [11, 'same-again']);
  controller.change('size', { value: 0 }); controller.open('body'); assert.equal(controller.snapshot().open, null);
  assert.equal(controller.snapshot().categories.size.value, 100, 'edits do nothing while on');
  controller.toggleSameAgain(false); await settled(controller);
  const off = await read(f);
  assert.equal(off.initial.sameAgain.on, false); assert.deepEqual(off.initial.accountPreferences.categories, before.categories);
  assert.deepEqual([off.initial.accountPreferences.understanding.value, off.initial.accountPreferences.understanding.basis], [before.understanding.value, 'categories']);
  assert.equal(controller.snapshot().understanding.value, before.understanding.value); assert.equal(controller.snapshot().understanding.pending, false);
  fresh.destroy(); controller.destroy();
});

// FUCQ-367: the current-car star rating rides the same draft autosave.
const carOf = async (f) => (await f.account.readAccount(f.context)).value.currentContract.contractId;
const rate = (f, value, o = {}) => f.editor.savePreferences(f.context, { commandId: o.commandId ?? `rate-${++serial}`, expectedBriefVersion: o.briefVersion ?? 0,
  expectedDraftVersion: o.draftVersion ?? 0, changes: o.changes ?? {}, currentCarRating: { contractId: o.contractId, value } });
const rows = (f) => f.store.state.tables.event_receipts.filter((r) => r.consumerId.startsWith('brief:draft:'));

test('a rating sets 1 and 5, replaces, clears with null and reads back through the editor', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.deepEqual((await read(f)).initial.currentCarRating, { value: null, contractId });
  let draftVersion = 0;
  for (const value of [1, 5, 3, null, 4]) {
    const out = await rate(f, value, { contractId, draftVersion });
    assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.deepEqual(out.value.currentCarRating, { value, contractId });
    draftVersion = out.value.draftVersion;
    const stored = (await draftOf(f)).brief.currentCarRating;
    assert.deepEqual([stored.value, stored.contractId, stored.source], [value, contractId, 'employee']);
    assert.equal(stored.ratedAt, (await f.clock.now(f.context)).value.now);
    assert.deepEqual((await read(f)).initial.currentCarRating, { value, contractId });
  }
  // A cleared rating is stored as an explicit null, not dropped.
  const cleared = await rate(f, null, { contractId, draftVersion });
  assert.equal(Object.hasOwn((await draftOf(f)).brief.currentCarRating, 'value'), true);
  assert.equal(cleared.value.currentCarRating.value, null);
});

test('malformed ratings are invalid with the field named and write nothing', async (t) => {
  const f = await setup(t); const contractId = await carOf(f); const before = structuredClone(f.store.state);
  const send = (currentCarRating) => f.editor.savePreferences(f.context, { commandId: 'bad', expectedBriefVersion: 0, expectedDraftVersion: 0, changes: {}, currentCarRating });
  for (const value of [0, 6, 4.5, '4', true, -1, [3], {}, 'null']) {
    const out = await send({ contractId, value });
    assert.equal(out.status, 'invalid', String(value)); assert.equal(out.code, 'invalid-preferences'); assert.equal(out.reasons[0].field, 'currentCarRating');
  }
  assert.equal((await send({ contractId })).status, 'invalid');
  // Non-JSON values are refused before any read (they cannot arrive over HTTP).
  for (const value of [undefined, NaN, Infinity]) assert.equal((await send({ contractId, value })).status, 'invalid');
  for (const bad of [{ value: 3 }, { contractId: '', value: 3 }, { contractId: 7, value: 3 }, { contractId: 'x'.repeat(129), value: 3 }, null, 3, []]) {
    const out = await send(bad); assert.equal(out.status, 'invalid', JSON.stringify(bad)); assert.equal(out.reasons[0].field, 'currentCarRating');
  }
  for (const extra of ['source', 'ratedAt', 'employeeId', 'runId', 'buddy', 'consent', 'state']) {
    const out = await send({ contractId, value: 3, [extra]: 'x' });
    assert.equal(out.status, 'invalid', extra); assert.equal(out.reasons[0].field, 'currentCarRating');
  }
  // Empty changes are only acceptable alongside a rating.
  const bare = await save(f, {}); assert.equal(bare.status, 'invalid'); assert.equal(bare.reasons[0].reason, 'Change at least one category.');
  assert.equal((await f.editor.savePreferences(f.context, { commandId: 'b', expectedBriefVersion: 0, expectedDraftVersion: 0, currentCarRating: { contractId, value: 3 } })).status, 'invalid');
  assert.equal((await send(undefined)).status, 'invalid');
  assert.deepEqual(f.store.state, before);
});

test('a rating for another car or with no current car is a conflict that writes nothing', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await rate(f, 3, { contractId, draftVersion: 0 })).status, 'ok');
  const before = structuredClone(f.store.state);
  const wrong = await rate(f, 4, { contractId: 'current:someone-else', draftVersion: 1 });
  assert.equal(wrong.status, 'conflict'); assert.equal(wrong.reason, 'current-car-changed'); assert.deepEqual(wrong.current, { contractId });
  assert.equal((await draftOf(f)).draftVersion, 1);
  const none = createBriefEditorService({ ...f, account: { async readAccount(c) {
    const r = await f.account.readAccount(c); r.value.currentContract = null; return r;
  } } });
  const absent = await none.savePreferences(f.context, { commandId: 'n', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: {}, currentCarRating: { contractId, value: 2 } });
  assert.equal(absent.status, 'conflict'); assert.equal(absent.reason, 'no-current-car');
  assert.deepEqual(f.store.state, before);
  // Without a current car a category save still works and the readback is null.
  const sparse = await none.savePreferences(f.context, { commandId: 'c', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: { size: { value: 50 } } });
  assert.equal(sparse.status, 'ok'); assert.equal(sparse.value.currentCarRating, null);
  assert.equal((await none.readEditor(f.context)).value.initial.currentCarRating, null);
  assert.equal((await draftOf(f)).brief.currentCarRating.contractId, contractId);
});

test('a rating-only save leaves everything else byte-identical and a category save keeps the rating', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  const seed = { schemaVersion: 1, preferences: { comfort: preference(100, 100), body: preference('estate', 50) },
    essentials: { seats: { value: 5, operator: 'gte', unit: 'count', state: 'draft', source: 'employee' } },
    currentCarFeedback: { preserve: ['comfort'], change: ['size'], state: 'draft', source: 'employee' } };
  assert.equal((await f.brief.saveDraft(f.context, { commandId: 'seed', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: seed })).status, 'ok');
  const before = (await draftOf(f)).brief; const countBefore = (await read(f)).initial.accountPreferences;
  const out = await rate(f, 4, { contractId, draftVersion: 1 });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const { currentCarRating, ...after } = (await draftOf(f)).brief;
  assert.deepEqual(after, before); assert.equal(currentCarRating.value, 4);
  assert.deepEqual(out.value.accountPreferences, countBefore);
  assert.equal((await f.brief.readCurrent(f.context)).status, 'not-found');
  assert.deepEqual((await read(f)).initial.consent, { search: false, hold: false });
  // A later category-only save never drops or alters the rating.
  const kept = (await draftOf(f)).brief.currentCarRating;
  assert.equal((await save(f, { size: { value: 100 } }, 2)).status, 'ok');
  const final = (await draftOf(f)).brief;
  assert.deepEqual(final.currentCarRating, kept); assert.deepEqual(final.currentCarFeedback, seed.currentCarFeedback);
  // Rating and a category change in one write.
  const both = await rate(f, 2, { contractId, draftVersion: 3, changes: { economy: { value: 0 } } });
  assert.equal(both.status, 'ok'); assert.equal(both.value.accountPreferences.categories.economy.value, 0);
  assert.equal((await draftOf(f)).brief.currentCarRating.value, 2);
});

test('a rating for another contract reads as unset, so a replacement car never inherits it', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await rate(f, 5, { contractId })).status, 'ok');
  const replaced = createBriefEditorService({ ...f, account: { async readAccount(c) {
    const r = await f.account.readAccount(c); r.value.currentContract = { ...r.value.currentContract, contractId: 'replacement-contract' }; return r;
  } } });
  assert.deepEqual((await replaced.readEditor(f.context)).value.initial.currentCarRating, { value: null, contractId: 'replacement-contract' });
  // A category save for the replacement keeps the old record in the draft and reports unset.
  const out = await replaced.savePreferences(f.context, { commandId: 'rep', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: { size: { value: 50 } } });
  assert.deepEqual(out.value.currentCarRating, { value: null, contractId: 'replacement-contract' });
  assert.deepEqual([(await draftOf(f)).brief.currentCarRating.contractId, (await draftOf(f)).brief.currentCarRating.value], [contractId, 5]);
  // Rating the replacement replaces the stored record with that contract.
  const next = await replaced.savePreferences(f.context, { commandId: 'rep2', expectedBriefVersion: 0, expectedDraftVersion: 2, changes: {}, currentCarRating: { contractId: 'replacement-contract', value: 2 } });
  assert.deepEqual(next.value.currentCarRating, { value: 2, contractId: 'replacement-contract' });
});

test('rating saves obey stale versions, idempotent retries and the accepted-offer lock', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await rate(f, 3, { contractId, commandId: 'r1' })).status, 'ok');
  const before = structuredClone(f.store.state);
  assert.equal((await rate(f, 5, { contractId, commandId: 'r2', draftVersion: 0 })).status, 'stale-version');
  assert.equal((await rate(f, 5, { contractId, commandId: 'r3', draftVersion: 1, briefVersion: 4 })).status, 'stale-version');
  const again = await rate(f, 3, { contractId, commandId: 'r1' });
  assert.equal(again.status, 'ok'); assert.equal(again.value.draftVersion, 1);
  assert.equal((await rate(f, 5, { contractId, commandId: 'r1' })).status, 'conflict');
  assert.deepEqual(f.store.state, before); assert.equal(rows(f).length, 1);
  assert.equal((await f.brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1 })).status, 'ok');
  const confirmed = (await f.brief.readCurrent(f.context)).value.brief;
  assert.deepEqual([confirmed.currentCarRating.value, confirmed.currentCarRating.contractId], [3, contractId]);
  assert.equal((await rate(f, 1, { contractId, draftVersion: 1, briefVersion: 1 })).status, 'ok');
  const accepted = createBriefEditorService({ ...f, brief: { readDraft: (c) => f.brief.readDraft(c), readHistory: (c) => f.brief.readHistory(c),
    saveDraft: (...a) => f.brief.saveDraft(...a), async readCurrent(c) {
      const r = await f.brief.readCurrent(c); r.value.activity.existingOffers = [{ offerId: 'o1', state: 'accepted', briefVersion: 1 }]; return r;
    } } });
  const blocked = await accepted.savePreferences(f.context, { commandId: 'late', expectedBriefVersion: 1, expectedDraftVersion: 2, changes: {}, currentCarRating: { contractId, value: 5 } });
  assert.equal(blocked.status, 'conflict'); assert.equal(blocked.reason, 'brief-read-only');
  assert.equal((await rate({ ...f, editor: f.editor, context: f.presenter.value.context }, 1, { contractId })).status, 'forbidden');
});

test('legacy briefs without a rating stay valid and the semantic digest only changes when a rating exists', async (t) => {
  const f = await setup(t);
  const legacy = { schemaVersion: 1, preferences: { comfort: preference(100, 100) }, essentials: {},
    currentCarFeedback: { preserve: ['comfort'], change: ['size'], state: 'draft', source: 'employee' } };
  assert.equal((await f.brief.saveDraft(f.context, { commandId: 'legacy', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: legacy })).status, 'ok');
  const editor = await read(f);
  assert.equal(Object.hasOwn(editor.initial.brief, 'currentCarRating'), false);
  assert.equal(editor.initial.currentCarRating.value, null);
  const semantic = briefSemantic({ ...legacy, preferences: { comfort: { ...preference(100, 100) } } });
  assert.equal(Object.hasOwn(semantic, 'rating'), false);
  assert.deepEqual(Object.keys(semantic), ['preferences', 'essentials', 'feedback']);
  const rated = briefSemantic({ ...legacy, currentCarRating: { value: 3, contractId: 'c1', source: 'employee', ratedAt: '2026-11-05T12:00:00.000Z' } });
  assert.deepEqual(rated.rating, { value: 3, contractId: 'c1' });
  assert.notEqual(inputDigest(rated), inputDigest(semantic));
  const timeOnly = briefSemantic({ ...legacy, currentCarRating: { value: 3, contractId: 'c1', source: 'employee', ratedAt: '2026-11-06T12:00:00.000Z' } });
  assert.equal(inputDigest(timeOnly), inputDigest(rated));
  assert.equal(inputDigest(briefSemantic({ ...legacy, preferences: {} })), inputDigest(briefSemantic({ ...legacy, preferences: {} })));
});

test('a rating never reaches scoring: a previewed rated draft scores like the same draft without it', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  const out = await rate(f, 5, { contractId, changes: { comfort: { value: 100, importance: 'high' } } });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  const saved = (await read(f)).initial.brief; const { currentCarRating, ...plain } = saved;
  const charging = { charging: { value: 'home', operator: 'equals', unit: null, state: 'draft', source: 'employee' } };
  const preview = (brief) => f.editor.previewDraft(f.context, { kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 1, brief: { ...brief, essentials: charging } });
  const [withRating, without] = [await preview(saved), await preview(plain)];
  assert.equal(withRating.status, 'ok', JSON.stringify(withRating));
  assert.deepEqual(withRating.value.decisions.map((d) => [d.orderUuid, d.score]), without.value.decisions.map((d) => [d.orderUuid, d.score]));
  assert.equal(JSON.stringify(withRating.value.decisions.map((d) => d.components)).includes('currentCarRating'), false);
});

test('real authenticated HTTP saves, clears and reads a rating and the persisted draft and confirmed brief carry it', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  const http = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief, gcspBriefEditor: f.editor });
  t.after(() => http.close());
  const post = (body, options = {}) => http.request('/api/gcsp/brief/preferences', { session: f.acting, body, ...options });
  const body = (value, extra = {}) => ({ commandId: `http-${++serial}`, expectedBriefVersion: 0, expectedDraftVersion: 0, changes: {}, currentCarRating: { contractId, value }, ...extra });
  assert.equal((await post(body(3), { session: null })).status, 401);
  assert.equal((await post(body(3), { session: f.presenter })).status, 403);
  assert.equal((await post(body(3), { origin: 'https://hostile.test' })).status, 403);
  assert.equal((await post(body(3, { currentCarRating: { contractId, value: 3, employeeId: 'x' } }))).status, 400);
  assert.equal((await post(body(7))).status, 400);
  assert.equal((await post(body(3, { currentCarRating: { contractId: 'other', value: 3 } }))).status, 409);
  const saved = await post(body(4));
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.value.currentCarRating, { value: 4, contractId });
  const editor = await http.request('/api/gcsp/brief/editor', { session: f.acting });
  assert.deepEqual(editor.json.value.initial.currentCarRating, { value: 4, contractId });
  // The persisted draft stream row, not only the projection.
  const [row] = rows(f); assert.equal(rows(f).length, 1);
  const persisted = row.outcome.value.brief.currentCarRating;
  assert.deepEqual([persisted.value, persisted.contractId, persisted.source, typeof persisted.ratedAt], [4, contractId, 'employee', 'string']);
  const stored = await http.request('/api/gcsp/brief/draft', { session: f.acting });
  assert.deepEqual(stored.json.value.brief.currentCarRating, persisted);
  const cleared = await post(body(null, { expectedDraftVersion: 1 }));
  assert.deepEqual(cleared.json.value.currentCarRating, { value: null, contractId });
  assert.equal((await http.request('/api/gcsp/brief/editor', { session: f.acting })).json.value.initial.currentCarRating.value, null);
  assert.equal((await post(body(2, { expectedDraftVersion: 2 }))).status, 200);
  const confirmed = await http.request('/api/gcsp/brief/confirm', { session: f.acting, body: { commandId: 'http-confirm', expectedBriefVersion: 0, expectedDraftVersion: 3 } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  const row1 = f.store.state.tables.briefs.find((b) => b.employeeId === f.context.employeeId && b.briefVersion === 1);
  assert.deepEqual([row1.currentCarRating.value, row1.currentCarRating.contractId, row1.currentCarRating.source], [2, contractId, 'employee']);
  const after = await http.request('/api/gcsp/brief/editor', { session: f.acting });
  assert.deepEqual(after.json.value.initial.currentCarRating, { value: 2, contractId });
  assert.equal(after.json.value.provenance.initial, 'approved-brief');
});

// FUCQ-369: Same again intent and the canonical Buddy understanding (input completeness, never confidence).
const again = (f, on, o = {}) => f.editor.savePreferences(f.context, { commandId: o.commandId ?? `again-${++serial}`, expectedBriefVersion: o.briefVersion ?? 0,
  expectedDraftVersion: o.draftVersion ?? 0, changes: o.changes ?? {}, sameAgain: { contractId: o.contractId, on } });
const CATEGORY_STEPS = [{ body: { value: ['suv'] } }, { fuel: { value: ['ev'] } }, { comfort: { value: 100 } }, { economy: { value: 0 } },
  { size: { value: 100 } }, { sportiness: { value: 50 } }];
const withCar = (f, patch) => createBriefEditorService({ ...f, account: { async readAccount(c) {
  const r = await f.account.readAccount(c); r.value.currentContract = patch(r.value.currentContract); return r;
} } });

test('understanding is 1,3,4,6,7,9,10 for 0..6 considered categories and 11 with Same again, from the policy entry', async (t) => {
  const f = await setup(t); const contractId = await carOf(f); const step = session(f);
  const u = async () => (await read(f)).initial.accountPreferences.understanding;
  assert.deepEqual(await u(), { kind: 'input-completeness', value: 1, maximum: 11, basis: 'categories', considered: 0,
    policyKey: KEY, policyVersion: f.context.policyVersion });
  const seen = [1];
  for (const change of CATEGORY_STEPS) {
    const out = await step(change); assert.equal(out.status, 'ok', JSON.stringify(out));
    seen.push(out.value.accountPreferences.understanding.value);
    assert.deepEqual((await u()).value, seen.at(-1));
  }
  assert.deepEqual(seen, [1, 3, 4, 6, 7, 9, 10]);
  const on = await again(f, true, { contractId, draftVersion: 6 });
  assert.equal(on.status, 'ok', JSON.stringify(on));
  assert.deepEqual(on.value.accountPreferences.understanding, { kind: 'input-completeness', value: 11, maximum: 11, basis: 'same-again',
    considered: 6, policyKey: KEY, policyVersion: f.context.policyVersion });
  assert.equal(on.value.accountPreferences.sameAgain, true);
  assert.equal((await u()).value, 11);
  assert.deepEqual((await read(f)).context.accountPreferences.understanding, { kind: 'input-completeness', maximum: 11,
    byConsidered: [1, 3, 4, 6, 7, 9, 10], sameAgain: 11, policyKey: KEY });
});

test('one canonical understanding change reaches the projection and readback with the policy key and version', async (t) => {
  const policy = await patchedSeed((v) => { v.understanding = { kind: 'input-completeness', maximum: 20, byConsidered: [2, 4, 6, 8, 10, 12, 14], sameAgain: 20 }; });
  const f = await setup(t, { policy }); const contractId = await carOf(f);
  const editor = await read(f);
  assert.deepEqual(editor.context.accountPreferences.understanding, { kind: 'input-completeness', maximum: 20,
    byConsidered: [2, 4, 6, 8, 10, 12, 14], sameAgain: 20, policyKey: KEY });
  assert.equal(editor.initial.accountPreferences.understanding.value, 2);
  const saved = await save(f, { comfort: { value: 100 }, size: { value: 0 } });
  assert.equal(saved.value.accountPreferences.understanding.value, 6);
  assert.equal(saved.value.accountPreferences.understanding.maximum, 20);
  assert.equal(saved.value.accountPreferences.understanding.policyVersion, f.context.policyVersion);
  const on = await again(f, true, { contractId, draftVersion: 1 });
  assert.deepEqual([on.value.accountPreferences.understanding.value, on.value.accountPreferences.understanding.basis], [20, 'same-again']);
  assert.equal((await read(f)).initial.accountPreferences.understanding.value, 20);
});

test('a malformed understanding mapping makes the editor unavailable', async (t) => {
  for (const change of [(v) => { delete v.understanding; }, (v) => { v.understanding.kind = 'confidence'; }, (v) => { v.understanding.byConsidered.pop(); },
    (v) => { v.understanding.byConsidered[3] = 2; }, (v) => { v.understanding.byConsidered[0] = -1; }, (v) => { v.understanding.byConsidered[6] = 12; },
    (v) => { v.understanding.byConsidered[2] = 4.5; }, (v) => { v.understanding.sameAgain = 9; }, (v) => { v.understanding.sameAgain = 12; },
    (v) => { v.understanding.sameAgain = '11'; }, (v) => { v.understanding.extra = 1; }]) {
    const f = await setup(t, { policy: await patchedSeed(change) });
    assert.equal((await f.editor.readEditor(f.context)).status, 'unavailable', change.toString());
    assert.equal((await save(f, { comfort: { value: 50 } })).status, 'unavailable', change.toString());
  }
});

test('importance and rating changes never change understanding; defaults and unopened categories never count', async (t) => {
  const f = await setup(t); const contractId = await carOf(f); const step = session(f);
  const value = async () => (await read(f)).initial.accountPreferences.understanding.value;
  assert.equal((await step({ comfort: { value: 100 }, size: { value: 0 } })).status, 'ok');
  assert.equal(await value(), 4);
  assert.equal((await step({ comfort: { importance: 'high' } })).status, 'ok'); assert.equal(await value(), 4);
  assert.equal((await step({ size: { importance: 'high' }, comfort: { importance: 'medium' } })).status, 'ok'); assert.equal(await value(), 4);
  for (const stars of [5, 1, null]) {
    assert.equal((await rate(f, stars, { contractId, draftVersion: 3 + (stars === 5 ? 0 : stars === 1 ? 1 : 2) })).status, 'ok');
    assert.equal(await value(), 4);
  }
  // A policy-default entry and a zero-importance entry are never considered.
  const seeded = await setup(t);
  const brief = { schemaVersion: 1, preferences: { comfort: { value: 100, importance: 100, valueState: 'draft', importanceState: 'draft', source: 'policy:brief.editor.v1' },
    size: { value: 100, importance: 0, valueState: 'draft', importanceState: 'draft', source: 'employee' } }, essentials: {} };
  assert.equal((await seeded.brief.saveDraft(seeded.context, { commandId: 'seed', expectedBriefVersion: 0, expectedDraftVersion: 0, brief })).status, 'ok');
  const editor = await read(seeded);
  assert.equal(editor.initial.accountPreferences.considered, 0); assert.equal(editor.initial.accountPreferences.understanding.value, 1);
});

test('real HTTP turns Same again on and off, keeps categories byte-identical and restores the count and importance', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  const http = await startHttpServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspBrief: f.brief, gcspBriefEditor: f.editor });
  t.after(() => http.close());
  const post = (body, options = {}) => http.request('/api/gcsp/brief/preferences', { session: f.acting, body, ...options });
  const body = (on, extra = {}) => ({ commandId: `http-${++serial}`, expectedBriefVersion: 0, expectedDraftVersion: 0, changes: {}, sameAgain: { contractId, on }, ...extra });
  assert.equal((await post(body(true), { session: null })).status, 401);
  assert.equal((await post(body(true), { session: f.presenter })).status, 403);
  assert.equal((await post(body(true), { origin: 'https://hostile.test' })).status, 403);
  assert.equal((await post(body(true, { sameAgain: { contractId, on: true, employeeId: 'x' } }))).status, 400);
  assert.equal((await post(body(true, { sameAgain: { contractId, on: 'yes' } }))).status, 400);
  assert.equal((await post(body(true, { sameAgain: { contractId: 'other', on: true } }))).status, 409);
  assert.equal(rows(f).length, 0);
  const picked = await post(body(false, { changes: { body: { value: ['saloon', 'estate'] }, comfort: { value: 100, importance: 'high' }, size: { value: 0 } },
    sameAgain: undefined }));
  assert.equal(picked.status, 200, JSON.stringify(picked.json));
  const prefs = () => rows(f).at(-1).outcome.value.brief.preferences;
  const kept = structuredClone(prefs());
  const on = await post(body(true, { expectedDraftVersion: 1 }));
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.deepEqual(on.json.value.sameAgain, { available: true, on: true, contractId });
  assert.equal(on.json.value.accountPreferences.understanding.value, 11);
  const row = rows(f).at(-1).outcome.value.brief;
  assert.deepEqual(row.preferences, kept); assert.equal(JSON.stringify(row.preferences), JSON.stringify(kept));
  assert.deepEqual([row.sameAgain.on, row.sameAgain.contractId, row.sameAgain.source, typeof row.sameAgain.setAt], [true, contractId, 'employee', 'string']);
  const during = await http.request('/api/gcsp/brief/editor', { session: f.acting });
  assert.deepEqual(during.json.value.initial.sameAgain, { available: true, on: true, contractId });
  assert.equal(during.json.value.initial.accountPreferences.sameAgain, true);
  assert.equal(during.json.value.initial.accountPreferences.understanding.value, 11);
  assert.equal(during.json.value.initial.accountPreferences.considered, 3);
  const off = await post(body(false, { expectedDraftVersion: 2 }));
  assert.equal(off.status, 200);
  assert.deepEqual(rows(f).at(-1).outcome.value.brief.preferences, kept);
  assert.equal(rows(f).at(-1).outcome.value.brief.sameAgain.on, false);
  const after = (await http.request('/api/gcsp/brief/editor', { session: f.acting })).json.value.initial;
  assert.deepEqual(after.sameAgain, { available: true, on: false, contractId });
  assert.deepEqual([after.accountPreferences.considered, after.accountPreferences.understanding.value, after.accountPreferences.understanding.basis], [3, 6, 'categories']);
  assert.deepEqual([after.accountPreferences.categories.comfort.importance, after.accountPreferences.categories.size.importance], ['high', 'medium']);
  assert.deepEqual(after.consent, { search: false, hold: false });
});

test('while Same again is on a category change is refused and writes nothing; off plus changes works in one patch', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await save(f, { comfort: { value: 100 } })).status, 'ok');
  assert.equal((await again(f, true, { contractId, draftVersion: 1 })).status, 'ok');
  const before = structuredClone(f.store.state);
  const refused = await save(f, { size: { value: 0 } }, 2);
  assert.equal(refused.status, 'invalid'); assert.equal(refused.code, 'invalid-preferences');
  assert.deepEqual(refused.reasons, [{ field: 'changes', reason: 'Turn off Same again to change your categories.' }]);
  const stillOn = await again(f, true, { contractId, draftVersion: 2, changes: { size: { value: 0 } } });
  assert.equal(stillOn.status, 'invalid'); assert.equal(stillOn.reasons[0].field, 'changes');
  assert.deepEqual(f.store.state, before);
  // A rating-only save is still allowed while on.
  assert.equal((await rate(f, 4, { contractId, draftVersion: 2 })).status, 'ok');
  const both = await again(f, false, { contractId, draftVersion: 3, changes: { size: { value: 0 } } });
  assert.equal(both.status, 'ok', JSON.stringify(both));
  assert.equal(both.value.sameAgain.on, false); assert.equal(both.value.accountPreferences.categories.size.value, 0);
  const brief = (await draftOf(f)).brief;
  assert.equal(brief.sameAgain.on, false); assert.equal(brief.preferences.size.value, 0); assert.equal(brief.currentCarRating.value, 4);
  // Changes then on in one patch: the changes apply, then Same again is on.
  const then = await again(f, true, { contractId, draftVersion: 4, changes: { economy: { value: 100 } } });
  assert.equal(then.status, 'ok', JSON.stringify(then));
  assert.deepEqual([then.value.sameAgain.on, then.value.accountPreferences.categories.economy.value, then.value.accountPreferences.understanding.value], [true, 100, 11]);
});

test('Same again without a current car, without a model or for another car is a conflict that writes nothing', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await again(f, true, { contractId })).status, 'ok');
  const before = structuredClone(f.store.state);
  const wrong = await again(f, false, { contractId: 'current:someone-else', draftVersion: 1 });
  assert.equal(wrong.status, 'conflict'); assert.equal(wrong.reason, 'current-car-changed'); assert.deepEqual(wrong.current, { contractId });
  const none = withCar(f, () => null);
  const absent = await none.savePreferences(f.context, { commandId: 'n', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: {}, sameAgain: { contractId, on: false } });
  assert.equal(absent.status, 'conflict'); assert.equal(absent.reason, 'no-current-car');
  const unidentified = withCar(f, (c) => ({ ...c, model: '' }));
  const blank = await unidentified.savePreferences(f.context, { commandId: 'u', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: {}, sameAgain: { contractId, on: false } });
  assert.equal(blank.status, 'conflict'); assert.equal(blank.reason, 'current-car-unidentified');
  assert.deepEqual(f.store.state, before);
  // The read view says why Same again is unavailable and never reports it on.
  assert.deepEqual((await none.readEditor(f.context)).value.initial.sameAgain, { available: false, on: false, contractId: null, reason: 'no-current-car' });
  const view = (await unidentified.readEditor(f.context)).value.initial;
  assert.deepEqual(view.sameAgain, { available: false, on: false, contractId: null, reason: 'current-car-unidentified' });
  assert.deepEqual([view.accountPreferences.sameAgain, view.accountPreferences.understanding.basis], [false, 'categories']);
  // Category saves still work without a usable car, and the response carries the unavailable view.
  const sparse = await none.savePreferences(f.context, { commandId: 'c', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: { size: { value: 50 } } });
  assert.equal(sparse.status, 'ok'); assert.equal(sparse.value.sameAgain.reason, 'no-current-car');
});

test('Same again stored for another contract reads as off, so a replacement car starts off', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await again(f, true, { contractId })).status, 'ok');
  const replaced = withCar(f, (c) => ({ ...c, contractId: 'replacement-contract' }));
  const view = (await replaced.readEditor(f.context)).value.initial;
  assert.deepEqual(view.sameAgain, { available: true, on: false, contractId: 'replacement-contract' });
  assert.equal(view.accountPreferences.understanding.value, 1);
  // The old record stays in the draft; categories are editable for the replacement.
  const out = await replaced.savePreferences(f.context, { commandId: 'rep', expectedBriefVersion: 0, expectedDraftVersion: 1, changes: { size: { value: 50 } } });
  assert.equal(out.status, 'ok', JSON.stringify(out)); assert.equal(out.value.sameAgain.on, false);
  assert.deepEqual([(await draftOf(f)).brief.sameAgain.contractId, (await draftOf(f)).brief.sameAgain.on], [contractId, true]);
});

test('Same again saves obey stale versions, idempotent retries and the accepted-offer lock', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await again(f, true, { contractId, commandId: 's1' })).status, 'ok');
  const before = structuredClone(f.store.state);
  assert.equal((await again(f, false, { contractId, commandId: 's2', draftVersion: 0 })).status, 'stale-version');
  assert.equal((await again(f, false, { contractId, commandId: 's3', draftVersion: 1, briefVersion: 4 })).status, 'stale-version');
  const retry = await again(f, true, { contractId, commandId: 's1' });
  assert.equal(retry.status, 'ok'); assert.equal(retry.value.draftVersion, 1);
  assert.equal((await again(f, false, { contractId, commandId: 's1' })).status, 'conflict');
  assert.deepEqual(f.store.state, before); assert.equal(rows(f).length, 1);
  assert.equal((await f.brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1 })).status, 'ok');
  const confirmed = (await f.brief.readCurrent(f.context)).value.brief;
  assert.deepEqual([confirmed.sameAgain.on, confirmed.sameAgain.contractId], [true, contractId]);
  const view = (await read(f)).initial;
  assert.deepEqual([view.sameAgain.on, view.accountPreferences.understanding.value, view.accountPreferences.understanding.basis], [true, 11, 'same-again']);
  const accepted = createBriefEditorService({ ...f, brief: { readDraft: (c) => f.brief.readDraft(c), readHistory: (c) => f.brief.readHistory(c),
    saveDraft: (...a) => f.brief.saveDraft(...a), async readCurrent(c) {
      const r = await f.brief.readCurrent(c); r.value.activity.existingOffers = [{ offerId: 'o1', state: 'accepted', briefVersion: 1 }]; return r;
    } } });
  const blocked = await accepted.savePreferences(f.context, { commandId: 'late', expectedBriefVersion: 1, expectedDraftVersion: 1, changes: {}, sameAgain: { contractId, on: false } });
  assert.equal(blocked.status, 'conflict'); assert.equal(blocked.reason, 'brief-read-only');
  assert.equal((await again({ ...f, editor: f.editor, context: f.presenter.value.context }, false, { contractId })).status, 'forbidden');
});

test('malformed Same again patches are invalid with the field named and write nothing', async (t) => {
  const f = await setup(t); const contractId = await carOf(f); const before = structuredClone(f.store.state);
  const send = (sameAgain) => f.editor.savePreferences(f.context, { commandId: 'bad', expectedBriefVersion: 0, expectedDraftVersion: 0, changes: {}, sameAgain });
  for (const bad of [{ contractId }, { on: true }, { contractId, on: 'true' }, { contractId, on: 1 }, { contractId, on: null }, { contractId: '', on: true },
    { contractId: 7, on: true }, { contractId: 'x'.repeat(129), on: true }, null, true, [], 'on']) {
    const out = await send(bad); assert.equal(out.status, 'invalid', JSON.stringify(bad));
    assert.equal(out.code, 'invalid-preferences'); assert.equal(out.reasons[0].field, 'sameAgain');
  }
  for (const extra of ['source', 'setAt', 'employeeId', 'runId', 'buddy', 'consent', 'state']) {
    const out = await send({ contractId, on: true, [extra]: 'x' }); assert.equal(out.status, 'invalid', extra); assert.equal(out.reasons[0].field, 'sameAgain');
  }
  assert.equal((await send(undefined)).status, 'invalid');
  assert.equal((await f.editor.savePreferences(f.context, { commandId: 'b', expectedBriefVersion: 0, expectedDraftVersion: 0, sameAgain: { contractId, on: true } })).status, 'invalid');
  assert.deepEqual(f.store.state, before);
  // A stored record with extra keys or a wrong source is not a valid editable brief.
  const stored = { on: true, contractId, source: 'employee', setAt: '2026-11-05T12:00:00.000Z' };
  for (const bad of [{ ...stored, extra: 1 }, { ...stored, source: 'policy' }, { ...stored, on: 'yes' }, { ...stored, setAt: 'soon' }, { on: true, contractId }]) {
    const out = await f.brief.saveDraft(f.context, { commandId: `s-${++serial}`, expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: {}, essentials: {}, sameAgain: bad } });
    assert.equal(out.status, 'invalid', JSON.stringify(bad)); assert.equal(out.reasons[0].field, 'sameAgain');
  }
});

test('legacy briefs without Same again stay valid and the semantic digest only changes when it exists', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  const legacy = { schemaVersion: 1, preferences: { comfort: preference(100, 100) }, essentials: {},
    currentCarFeedback: { preserve: ['comfort'], change: ['size'], state: 'draft', source: 'employee' } };
  assert.equal((await f.brief.saveDraft(f.context, { commandId: 'legacy', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: legacy })).status, 'ok');
  const editor = await read(f);
  assert.equal(Object.hasOwn(editor.initial.brief, 'sameAgain'), false);
  assert.deepEqual(editor.initial.sameAgain, { available: true, on: false, contractId });
  assert.deepEqual(Object.keys(briefSemantic(legacy)), ['preferences', 'essentials', 'feedback']);
  const stored = (on, setAt) => ({ ...legacy, sameAgain: { on, contractId: 'c1', source: 'employee', setAt } });
  const withIntent = briefSemantic(stored(true, '2026-11-05T12:00:00.000Z'));
  assert.deepEqual(withIntent.sameAgain, { on: true, contractId: 'c1' });
  assert.notEqual(inputDigest(withIntent), inputDigest(briefSemantic(legacy)));
  assert.notEqual(inputDigest(withIntent), inputDigest(briefSemantic(stored(false, '2026-11-05T12:00:00.000Z'))));
  assert.equal(inputDigest(briefSemantic(stored(true, '2026-11-06T12:00:00.000Z'))), inputDigest(withIntent));
});

test('Same again never reaches scoring: a previewed draft with it on scores like the same draft without it', async (t) => {
  const f = await setup(t); const contractId = await carOf(f);
  assert.equal((await save(f, { comfort: { value: 100, importance: 'high' } })).status, 'ok');
  assert.equal((await again(f, true, { contractId, draftVersion: 1 })).status, 'ok');
  const saved = (await read(f)).initial.brief; const { sameAgain, ...plain } = saved;
  assert.equal(sameAgain.on, true);
  const charging = { charging: { value: 'home', operator: 'equals', unit: null, state: 'draft', source: 'employee' } };
  const preview = (brief) => f.editor.previewDraft(f.context, { kind: 'unsaved-draft', baseBriefVersion: 0, draftVersion: 2, brief: { ...brief, essentials: charging } });
  const [withIntent, without] = [await preview(saved), await preview(plain)];
  assert.equal(withIntent.status, 'ok', JSON.stringify(withIntent));
  assert.deepEqual(withIntent.value.decisions.map((d) => [d.orderUuid, d.score]), without.value.decisions.map((d) => [d.orderUuid, d.score]));
  assert.equal(JSON.stringify(withIntent.value.decisions.map((d) => d.components)).includes('sameAgain'), false);
  // Consent and Buddy fields stay untouched by the intent.
  assert.deepEqual((await read(f)).initial.consent, { search: false, hold: false });
  assert.equal((await f.brief.readCurrent(f.context)).status, 'not-found');
});

test('no new Same again or understanding field or copy uses confidence or probability wording', async () => {
  const names = ['sameAgain', 'understanding', 'input-completeness', 'same-again', 'current-car-unidentified', 'no-current-car'];
  assert.ok(names.every((n) => !/confiden|probab/i.test(n)));
  for (const file of ['../gcsp/brief/same-again.js', '../gcsp/brief/editor.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.equal(/confiden|probab/i.test(source), false, file);
  }
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8')).assumptions.find((a) => a.key === KEY);
  assert.equal(/confiden|probab/i.test(JSON.stringify(seed.value.understanding)), false);
  assert.match(seed.basis, /not confidence/);
});
