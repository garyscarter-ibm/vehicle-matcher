import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { createBriefEditorService } from '../gcsp/brief/editor.js';
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
  assert.deepEqual(editor.json.value.initial.accountPreferences, { considered: 2, categories: { ...ok.json.value.accountPreferences.categories } });
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
  fresh.destroy(); controller.destroy();
});
