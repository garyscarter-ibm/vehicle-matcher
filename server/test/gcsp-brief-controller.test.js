import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBriefController } from '../../blocks/gcsp/brief/brief-controller.js';
import { PREVIEW_DEBOUNCE_MS } from '../../blocks/vehicle-matcher/modes/preview-feed.js';

const pref = (value, importance = 50) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed',
  source: 'supplied:employee', confirmedAt: '2026-11-05T09:00:00.000Z' });
const context = () => ({ slider: { minimum: 0, maximum: 100 }, preferences: {
  comfort: { type: 'slider', editable: true }, sportiness: { type: 'slider', editable: true },
  body: { type: 'enum', values: ['estate', 'suv'], editable: true }, readonly: { type: 'slider', editable: false },
}, essentials: {
  seats: { type: 'number', integer: true, operator: 'gte', unit: 'count', editable: true },
  equipment: { type: 'list', operator: 'includes', unit: null, editable: true },
  automatic: { type: 'boolean', operator: 'equals', unit: null, editable: true },
  boot: { type: 'number', operator: 'gte', unit: 'L', editable: true },
  charging: { type: 'enum', values: ['home', 'work', 'either', 'not-ready'], operator: 'equals', unit: null, editable: true },
}, knownFacts: { driver: { value: 'Paula', source: 'repository', sourceVersion: 1 } }, permissions: { driver: false } });
const initial = () => ({ briefVersion: 0, draftVersion: 0, brief: { schemaVersion: 1,
  preferences: { comfort: pref(70), sportiness: pref(80), body: pref('estate') }, essentials: {} } });
const empty = () => ({ status: 'ok', value: { state: 'no-stock', recommendations: [], decisions: [], eligibleCount: 0,
  versions: { brief: 1, policy: 'p1', stock: 's1' } }, contractVersion: '1.0.0' });
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
function setup(t, options = {}) {
  let id = 0;
  const transport = { preview: async () => empty(), saveDraft: async () => ({ status: 'ok', value: { draftVersion: 1, baseBriefVersion: 0 } }),
    confirm: async () => ({ status: 'ok', value: { brief: { briefVersion: 1 } } }), ...options.transport };
  const controller = createBriefController({ context: context(), initial: initial(), createCommandId: (kind) => `${kind}-${++id}`,
    ...options, transport });
  t.after(() => controller.destroy());
  return controller;
}
function timers(t) { t.mock.timers.enable({ apis: ['setTimeout'] }); }

test('independent positions and importance preserve indifference and provenance without stale confirmation', (t) => {
  const c = setup(t);
  assert.equal(c.updatePreference('comfort', { importance: 0 }).status, 'ok');
  assert.equal(c.updatePreference('sportiness', { value: 95 }).status, 'ok');
  const p = c.snapshot().brief.preferences;
  assert.equal(p.comfort.value, 70);
  assert.equal(p.comfort.importance, 0);
  assert.equal(p.comfort.valueState, 'confirmed');
  assert.equal(p.comfort.importanceState, 'draft');
  assert.equal(p.comfort.source, 'employee');
  assert.equal(p.comfort.confirmedAt, undefined);
  assert.equal(p.sportiness.value, 95);
  assert.equal(p.sportiness.importance, 50);
  assert.equal(p.body.source, 'supplied:employee');
  assert.equal(c.updatePreference('readonly', { value: 10, importance: 30 }).status, 'invalid');
  assert.equal(c.updatePreference('comfort', { value: -1 }).status, 'invalid');
  assert.equal(c.updatePreference('body', { value: 'estate' }).status, 'ok');
});

test('missing preference counterpart is rejected; complete registered values create a preference', (t) => {
  const input = initial(); input.brief.preferences = {};
  const c = setup(t, { initial: input });
  assert.equal(c.updatePreference('comfort', { value: 90 }).status, 'invalid');
  assert.equal(c.updatePreference('comfort', { importance: 0 }).status, 'invalid');
  assert.deepEqual(c.snapshot().brief.preferences, {});
  assert.equal(c.updatePreference('comfort', { value: 90, importance: 0 }).status, 'ok');
  assert.equal(c.snapshot().brief.preferences.comfort.importance, 0);
});

test('registered essentials retain false, zero and unknown without guessing practical mappings', (t) => {
  const c = setup(t);
  for (const [key, value] of [['automatic', false], ['boot', 0], ['charging', null], ['equipment', ['heated-seats']]]) {
    assert.equal(c.updateEssential(key, value).status, 'ok');
  }
  const e = c.snapshot().brief.essentials;
  assert.equal(e.automatic.value, false); assert.equal(e.automatic.state, 'draft');
  assert.equal(e.boot.value, 0); assert.equal(e.boot.state, 'draft');
  assert.equal(e.charging.value, null); assert.equal(e.charging.state, 'needs-confirmation');
  assert.equal(c.updateEssential('seats', true).status, 'invalid');
  assert.equal(c.updateEssential('seats', 4.5).status, 'invalid');
  assert.equal(c.updateEssential('equipment', false).status, 'invalid');
  assert.equal(c.updateEssential('charging', 'not-ready').status, 'ok');
});

test('unknown/prototype/authority writes fail closed and inputs, callbacks and snapshots are isolated', async (t) => {
  const ctx = context(); const input = initial(); const observed = [];
  const c = setup(t, { context: ctx, initial: input, onChange: (s) => { observed.push(s); s.brief.preferences.comfort.value = 1; } });
  ctx.preferences.comfort.editable = false; ctx.knownFacts.driver.value = 'Changed'; input.brief.preferences.comfort.value = 2;
  const before = c.snapshot(); before.brief.preferences.comfort.value = 3; before.knownFacts.driver.value = 'Mutated';
  for (const key of ['__proto__', 'constructor', 'runId', 'policy', 'knownFacts', 'cash', 'contribution', 'missing']) {
    assert.equal(c.updatePreference(key, { value: 99, importance: 100 }).status, 'invalid');
    assert.equal(c.updateEssential(key, true).status, 'invalid');
  }
  assert.equal(c.updatePreference('comfort', JSON.parse('{"__proto__":{},"value":20}')).status, 'invalid');
  assert.equal(c.updatePreference('comfort', { value: 20, employeeId: 'forged' }).status, 'invalid');
  assert.equal(c.updatePreference('comfort', Object.create({ value: 5 })).status, 'invalid');
  c.updatePreference('comfort', { value: 91 });
  assert.equal(c.snapshot().brief.preferences.comfort.value, 91);
  assert.equal(c.snapshot().knownFacts.driver.value, 'Paula');
  assert.equal(observed.length, 1);
  const unsubscribe = c.subscribe((s) => { s.knownFacts.driver.value = 'Other'; });
  c.setConsent({ search: false, hold: true }); unsubscribe();
  assert.equal(c.snapshot().knownFacts.driver.value, 'Paula');
  assert.throws(() => setup(t, { initial: { ...initial(), knownFacts: {} } }), /initial/);
  assert.throws(() => setup(t, { context: undefined }), TypeError);
});

test('shared feed debounces edits, immediately loads and dispatches immutable unsaved snapshots with charging', async (t) => {
  timers(t); const calls = [];
  const c = setup(t, { transport: { preview: async (s) => { calls.push(s); s.brief.preferences.comfort.value = 1; return empty(); } } });
  c.updateEssential('charging', null);
  c.updatePreference('comfort', { value: 88 });
  assert.equal(c.snapshot().preview.state, 'loading');
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS - 1); await settle(); assert.equal(calls.length, 0);
  t.mock.timers.tick(1); await settle();
  assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'unsaved-draft');
  assert.equal(calls[0].baseBriefVersion, 0); assert.equal(calls[0].draftVersion, 0);
  assert.equal(calls[0].brief.briefVersion, undefined); assert.equal(calls[0].brief.knownFacts, undefined);
  assert.equal(calls[0].brief.essentials.charging.value, null);
  assert.equal(c.snapshot().brief.preferences.comfort.value, 88);
  assert.equal(c.snapshot().preview.state, 'zero-eligible');
});

test('rescheduling rejects stale successes and failures during debounce; cancellation invalidates dispatched work', async (t) => {
  timers(t); const pending = [];
  const c = setup(t, { transport: { preview: () => { const d = deferred(); pending.push(d); return d.promise; } } });
  c.requestPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  c.updatePreference('comfort', { value: 90 }); pending[0].resolve(empty()); await settle();
  assert.equal(c.snapshot().preview.state, 'loading');
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  c.updatePreference('comfort', { value: 80 }); pending[1].reject(new Error('old')); await settle();
  assert.equal(c.snapshot().preview.state, 'loading');
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); c.cancelPreview(); pending[2].resolve(empty()); await settle();
  assert.equal(c.snapshot().preview.state, 'idle');
  c.requestPreview(); c.cancelPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  assert.equal(pending.length, 3);
});

test('FUCQ-29-shaped result retains recorded evidence and versions alongside unknown candidates', async (t) => {
  timers(t);
  const evidence = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq-29/computed-cases.json', import.meta.url)));
  const actual = evidence.cases.find((entry) => entry.name === 'suitable-exact-car').output;
  actual.value.recommendations = actual.value.recommendations.map((id) => structuredClone(actual.value.decisions.find((d) => d.orderUuid === id)));
  assert.equal(actual.status, 'ok');
  const unknown = structuredClone(actual.value.decisions[0]); unknown.orderUuid = 'unknown-car';
  unknown.gateStatus = 'needs-confirmation'; unknown.suitable = false; unknown.unknowns = [{ code: 'essential-unconfirmed' }];
  const mixed = structuredClone(actual); mixed.value.decisions.push(unknown);
  const c = setup(t, { transport: { preview: async () => mixed } });
  c.requestPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await settle();
  assert.equal(c.snapshot().preview.state, 'recommendations');
  assert.deepEqual(c.snapshot().preview.outcome, mixed);
  mixed.value.recommendations[0].reasons.length = 0;
  assert.deepEqual(c.snapshot().preview.outcome.value.recommendations[0].reasons, actual.value.recommendations[0].reasons);
  const onlyUnknown = structuredClone(actual); onlyUnknown.value.recommendations = []; onlyUnknown.value.decisions = [unknown];
  onlyUnknown.value.state = 'no-viable-stock'; onlyUnknown.value.eligibleCount = 0;
  const other = setup(t, { transport: { preview: async () => onlyUnknown } });
  other.requestPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await settle();
  assert.equal(other.snapshot().preview.state, 'essential-unknown');
});

test('missing/malformed success and failed preview remain unavailable, distinct from computed zero eligible', async (t) => {
  timers(t);
  for (const response of [undefined, { status: 'ok' }, { status: 'ok', value: [] },
    { ...empty(), value: { ...empty().value, state: 'recommendations' } }, { status: 'forbidden', reason: 'role' }]) {
    const c = setup(t, { transport: { preview: async () => response } });
    c.requestPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await settle();
    assert.equal(c.snapshot().preview.state, 'unavailable'); c.destroy();
  }
  const c = setup(t, { transport: { preview: async () => { throw new Error('offline'); } } });
  c.requestPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await settle();
  assert.equal(c.snapshot().preview.state, 'unavailable');
});

test('real FUCQ-91 response envelopes drive exact returned versions and explicit independent consent', async (t) => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/gcsp-brief-outcomes.json', import.meta.url)));
  for (const consent of [undefined, { search: true, hold: false }, { search: false, hold: true }]) {
    const commands = [];
    const c = setup(t, { transport: { saveDraft: async (command) => { commands.push(command); return fixtures.draft; },
      confirm: async (command) => { commands.push(command); return fixtures.confirmed; } } });
    if (consent) c.setConsent(consent);
    assert.equal((await c.save()).status, 'ok');
    assert.deepEqual(Object.keys(commands[0]).sort(), ['brief', 'commandId', 'expectedBriefVersion', 'expectedDraftVersion']);
    assert.equal(commands[0].brief.knownFacts, undefined);
    assert.equal(commands[1].expectedDraftVersion, fixtures.draft.value.draftVersion);
    assert.notEqual(commands[0].commandId, commands[1].commandId);
    assert.deepEqual(commands[1].consent, consent ?? { search: false, hold: false });
    assert.equal(c.snapshot().briefVersion, fixtures.confirmed.value.brief.briefVersion);
    assert.equal(c.snapshot().save.state, 'saved'); assert.equal(c.snapshot().dirty, false);
  }
});

test('save snapshots survive transport mutation and retain edits and consent made while saving; repeated calls are busy', async (t) => {
  const draft = deferred(); const confirm = deferred(); let sentDraft; let sentConfirm;
  const c = setup(t, { transport: { saveDraft: (command) => { sentDraft = structuredClone(command); command.brief.preferences.comfort.value = 1; return draft.promise; },
    confirm: (command) => { sentConfirm = command; command.consent.search = true; return confirm.promise; } } });
  c.updatePreference('comfort', { value: 90 });
  const saving = c.save(); assert.equal((await c.save()).status, 'busy');
  c.updatePreference('comfort', { value: 95 }); c.setConsent({ search: false, hold: true });
  draft.resolve({ status: 'ok', value: { draftVersion: 7, baseBriefVersion: 0 } }); await settle();
  assert.equal(sentDraft.brief.preferences.comfort.value, 90); assert.equal(sentConfirm.expectedDraftVersion, 7);
  assert.equal(sentConfirm.consent.hold, false);
  confirm.resolve({ status: 'ok', value: { brief: { briefVersion: 4 }, activity: { canSearch: false } } });
  const outcome = await saving; outcome.value.brief.briefVersion = 100;
  assert.equal(c.snapshot().briefVersion, 4); assert.equal(c.snapshot().draftVersion, 7);
  assert.equal(c.snapshot().brief.preferences.comfort.value, 95); assert.equal(c.snapshot().dirty, true);
  assert.deepEqual(c.snapshot().consent, { search: false, hold: true });
  assert.equal(c.snapshot().save.outcome.value.brief.briefVersion, 4);
});

test('typed draft failures never confirm and stale-version/conflict retain every edit and base version', async (t) => {
  for (const status of ['invalid', 'forbidden', 'stale-run', 'unavailable', 'conflict', 'stale-version']) {
    let confirmed = false;
    const failure = { status, reason: 'safe-detail', action: 'refresh', currentVersion: 8 };
    const c = setup(t, { transport: { saveDraft: async () => failure, confirm: async () => { confirmed = true; } } });
    c.updatePreference('comfort', { value: 99 }); const before = c.snapshot();
    assert.deepEqual(await c.save(), failure); failure.reason = 'mutated';
    assert.equal(confirmed, false); assert.deepEqual(c.snapshot().brief, before.brief);
    assert.equal(c.snapshot().briefVersion, 0); assert.equal(c.snapshot().draftVersion, 0);
    assert.equal(c.snapshot().save.outcome.reason, 'safe-detail');
    assert.equal(c.snapshot().save.state, ['conflict', 'stale-version'].includes(status) ? 'refresh-required' : 'failed');
  }
});

test('confirmation conflict keeps base versions; unavailable confirmation retains known saved draft version', async (t) => {
  for (const status of ['conflict', 'stale-version', 'unavailable']) {
    const c = setup(t, { transport: { confirm: async () => ({ status, action: 'refresh' }) } });
    c.updatePreference('sportiness', { value: 99 });
    assert.equal((await c.save()).status, status);
    assert.equal(c.snapshot().briefVersion, 0);
    assert.equal(c.snapshot().draftVersion, status === 'unavailable' ? 1 : 0);
    assert.equal(c.snapshot().brief.preferences.sportiness.value, 99);
  }
});

test('broken observers and failed confirmation transport cannot lose a successful draft version or current edits', async (t) => {
  const c = setup(t, { onChange: () => { throw new Error('consumer'); }, transport: {
    saveDraft: async () => ({ status: 'ok', value: { draftVersion: 6, baseBriefVersion: 0 } }),
    confirm: async () => { throw new Error('connection lost'); },
  } });
  assert.equal(c.updatePreference('comfort', { value: 93 }).status, 'ok');
  assert.equal((await c.save()).status, 'unavailable');
  assert.equal(c.snapshot().draftVersion, 6); assert.equal(c.snapshot().briefVersion, 0);
  assert.equal(c.snapshot().brief.preferences.comfort.value, 93); assert.equal(c.snapshot().dirty, true);
});

test('malformed save successes cannot report saved or confirm a fabricated draft', async (t) => {
  let confirmations = 0;
  const c = setup(t, { transport: { saveDraft: async () => ({ status: 'ok' }),
    confirm: async () => { confirmations += 1; } } });
  assert.equal((await c.save()).status, 'unavailable'); assert.equal(confirmations, 0);
  assert.equal(c.snapshot().briefVersion, 0); assert.equal(c.snapshot().save.state, 'failed');
});

test('destroy during confirmation suppresses late state changes and remaining observers', async (t) => {
  const confirmation = deferred(); const c = setup(t, { transport: { confirm: () => confirmation.promise } });
  const saving = c.save(); await settle(); const before = c.snapshot();
  c.destroy(); confirmation.resolve({ status: 'ok', value: { brief: { briefVersion: 1 } } });
  assert.equal((await saving).status, 'destroyed'); assert.deepEqual(c.snapshot(), before);
  const other = setup(t); let secondObserver = false;
  other.subscribe(() => other.destroy()); other.subscribe(() => { secondObserver = true; });
  other.setConsent({ search: true, hold: false }); assert.equal(secondObserver, false);
});

test('destroy cancels timers, suppresses late preview/save/subscription callbacks and prevents confirmation after late draft', async (t) => {
  timers(t); const draft = deferred(); const preview = deferred(); let confirms = 0; let notifications = 0;
  const c = setup(t, { onChange: () => { notifications += 1; }, transport: { preview: () => preview.promise,
    saveDraft: () => draft.promise, confirm: async () => { confirms += 1; } } });
  c.requestPreview(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); const saving = c.save();
  c.destroy(); const count = notifications;
  preview.resolve(empty()); draft.resolve({ status: 'ok', value: { draftVersion: 1, baseBriefVersion: 0 } });
  assert.equal((await saving).status, 'destroyed'); await settle();
  assert.equal(confirms, 0); assert.equal(notifications, count);
  assert.equal(c.updatePreference('comfort', { value: 99 }).status, 'destroyed');
  assert.equal(c.requestPreview().status, 'destroyed'); assert.equal((await c.save()).status, 'destroyed');
});


test('consent rejects accessors without executing them and leaves current choices intact', (t) => {
  const c = setup(t); let read = false;
  const consent = { get search() { read = true; throw new Error('getter'); }, hold: true };
  assert.equal(c.setConsent(consent).status, 'invalid');
  assert.equal(read, false);
  assert.deepEqual(c.snapshot().consent, { search: false, hold: false });
});

test('teardown from the saving notification prevents any new draft request', async (t) => {
  let drafts = 0;
  const c = setup(t, { transport: { saveDraft: async () => { drafts += 1; return { status: 'unavailable' }; } } });
  c.subscribe((state) => { if (state.save.state === 'saving') c.destroy(); });
  assert.equal((await c.save()).status, 'destroyed');
  assert.equal(drafts, 0);
});
