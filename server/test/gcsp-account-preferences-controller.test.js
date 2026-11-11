import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountPreferencesController } from '../../blocks/gcsp/brief/account-preferences-controller.js';
import { ACCESS_LAPSED_MESSAGE, RUN_RESTARTED_MESSAGE } from '../../blocks/gcsp/kit/run-restarted.js';

const opts = (...p) => p.map(([value, label]) => ({ value, label }));
const CATEGORIES = {
  body: { label: 'Body', question: 'Which body styles feel right?', kind: 'multi', options: opts(['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Estate']) },
  comfort: { label: 'Comfort', question: 'How much comfort?', kind: 'stops', openDefault: 50,
    stops: [{ value: 0, label: 'Simple' }, { value: 50, label: 'A bit of both' }, { value: 100, label: 'Comfortable' }] },
};
const considered = (value, importance = 'medium') => ({ state: 'considered', value, importance, exact: true });
const editor = (categories = {}, versions = {}) => ({ status: 'ok', value: { context: { accountPreferences: { order: ['body', 'comfort'], categories: CATEGORIES,
  minimumCategories: 3, policyVersion: 'p1' } }, initial: { briefVersion: 1, draftVersion: 0, ...versions, accountPreferences: { considered: 0,
  categories: { body: { state: 'unset' }, comfort: { state: 'unset' }, ...categories } } }, selection: null } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise((done) => setImmediate(done));

// A transport whose saves wait for the test to answer them, in order.
function harness(initial = editor()) {
  const saves = []; const state = { calls: [], confirms: 0 };
  const transport = {
    loadEditor: async () => (typeof initial === 'function' ? initial() : initial),
    savePreferences: (input) => { const d = deferred(); saves.push({ input: structuredClone(input), answer: (r) => d.resolve(r) }); return d.promise; },
    confirm: async () => { state.confirms += 1; return { status: 'ok' }; },
    saveDraft: async () => { state.confirms += 1; return { status: 'ok' }; },
  };
  let serial = 0;
  const controller = createAccountPreferencesController({ transport, createCommandId: (kind) => `${kind}:${++serial}` });
  return { controller, saves, state };
}
const ok = (draftVersion, categories) => ({ status: 'ok', value: { briefVersion: 1, draftVersion, accountPreferences: { considered: 0,
  categories: { body: { state: 'unset' }, comfort: { state: 'unset' }, ...categories } } } });

test('load keeps the projection and versions; a failed load is a truthful status, not an empty editor', async () => {
  const { controller } = harness(editor({ body: considered(['estate'], 'high') }, { draftVersion: 4 }));
  assert.equal(controller.snapshot().status.text, '');
  await controller.load();
  const view = controller.snapshot();
  assert.equal(view.phase, 'ready'); assert.equal(view.draftVersion, 4); assert.deepEqual(view.projection.order, ['body', 'comfort']);
  assert.deepEqual(view.categories.body, considered(['estate'], 'high'));
  const bad = harness({ status: 'unavailable', retryable: true }); await bad.controller.load();
  assert.equal(bad.controller.snapshot().phase, 'failed'); assert.equal(bad.controller.snapshot().status.text, 'Your preferences could not be loaded.');
  assert.equal(bad.controller.snapshot().projection, null);
});

test('opening an unset stops category saves its default at once; opening a multi category saves nothing', async () => {
  const { controller, saves } = harness(); await controller.load();
  controller.open('body'); await settle();
  assert.equal(saves.length, 0); assert.equal(controller.snapshot().open, 'body'); assert.equal(controller.snapshot().categories.body.state, 'unset');
  controller.open('comfort');
  const view = controller.snapshot();
  assert.deepEqual(view.categories.comfort, considered(50)); assert.equal(view.open, 'comfort'); assert.equal(view.status.kind, 'pending');
  assert.deepEqual(saves[0].input, { commandId: 'preferences:1', expectedBriefVersion: 1, expectedDraftVersion: 0, changes: { comfort: { value: 50 } } });
  saves[0].answer(ok(1, { comfort: considered(50) })); await settle();
  assert.equal(controller.snapshot().status.text, 'Preferences saved automatically.');
  controller.open('comfort'); assert.equal(controller.snapshot().open, null, 'opening the open tile closes it');
  assert.equal(saves.length, 1, 'closing and reopening a set category saves nothing');
});

test('rapid edits during a request become one coalesced request; the latest wins and versions chain', async () => {
  const { controller, saves } = harness(); await controller.load();
  controller.change('body', { value: ['estate'] });
  controller.change('body', { value: ['estate', 'saloon'].sort() }); controller.change('body', { value: ['saloon'] }); controller.change('comfort', { value: 100 });
  assert.equal(saves.length, 1, 'only one request in flight');
  assert.deepEqual(controller.snapshot().categories.body.value, ['saloon']);
  saves[0].answer(ok(1, { body: considered(['estate']) })); await settle();
  assert.equal(saves.length, 2);
  assert.equal(controller.snapshot().status.kind, 'pending', 'not saved while newer edits are unsent');
  assert.deepEqual(controller.snapshot().categories.body.value, ['saloon'], 'the server echo does not undo a newer edit');
  assert.equal(saves[1].input.expectedDraftVersion, 1);
  assert.deepEqual(saves[1].input.changes, { body: { value: ['saloon'] }, comfort: { value: 100 } });
  assert.notEqual(saves[1].input.commandId, saves[0].input.commandId);
  saves[1].answer(ok(2, { body: considered(['saloon']), comfort: considered(100) })); await settle();
  assert.equal(controller.snapshot().status.text, 'Preferences saved automatically.'); assert.equal(controller.snapshot().draftVersion, 2);
  assert.equal(saves.length, 2);
});

test('importance: medium on first choice, high and medium after, ignored while unset', async () => {
  const { controller, saves } = harness(editor({ comfort: considered(0) }, { draftVersion: 2 })); await controller.load();
  controller.change('body', { importance: 'high' }); assert.equal(saves.length, 0); assert.equal(controller.snapshot().categories.body.state, 'unset');
  controller.change('comfort', { importance: 'high' });
  assert.deepEqual(saves[0].input.changes, { comfort: { importance: 'high' } }); assert.equal(controller.snapshot().categories.comfort.importance, 'high');
  controller.change('comfort', { importance: 'medium' });
  saves[0].answer(ok(3, { comfort: considered(0, 'high') })); await settle();
  assert.deepEqual(saves[1].input.changes, { comfort: { importance: 'medium' } });
  assert.equal(controller.snapshot().categories.comfort.importance, 'medium');
});

test('clearing the last multi choice sends null; a later choice starts at medium, also when it coalesces behind the removal', async () => {
  const { controller, saves } = harness(editor({ body: considered(['estate'], 'high'), comfort: considered(100) })); await controller.load();
  controller.change('body', { value: [] });
  assert.deepEqual(saves[0].input.changes, { body: null }); assert.deepEqual(controller.snapshot().categories.body, { state: 'unset' });
  controller.change('body', { value: ['saloon'] });
  assert.equal(controller.snapshot().categories.body.importance, 'medium');
  controller.change('body', { value: [] }); controller.change('body', { value: ['hatchback'] });
  saves[0].answer(ok(1, { comfort: considered(100) })); await settle();
  assert.deepEqual(saves[1].input.changes, { body: { value: ['hatchback'], importance: 'medium' } }, 'a null then a value in one patch resets to medium');
});

test('removal: requesting closes the open panel, keep changes nothing, confirm sends null and says so', async () => {
  const { controller, saves } = harness(editor({ body: considered(['estate'], 'high'), comfort: considered(100) })); await controller.load();
  controller.open('body'); controller.requestRemove('comfort');
  let view = controller.snapshot(); assert.equal(view.open, null); assert.equal(view.pendingRemoval, 'comfort');
  controller.keep('comfort');
  view = controller.snapshot(); assert.equal(view.pendingRemoval, null); assert.deepEqual(view.categories.body, considered(['estate'], 'high')); assert.equal(saves.length, 0);
  controller.requestRemove('comfort'); controller.confirmRemove('comfort');
  assert.deepEqual(saves[0].input.changes, { comfort: null }); assert.equal(controller.snapshot().pendingRemoval, null);
  assert.deepEqual(controller.snapshot().categories.comfort, { state: 'unset' }); assert.equal(controller.snapshot().status.text, 'Saving your preferences.');
  saves[0].answer(ok(1, { body: considered(['estate'], 'high') })); await settle();
  assert.equal(controller.snapshot().status.text, 'Comfort preference removed. Saved automatically.');
  assert.deepEqual(controller.snapshot().categories.body, considered(['estate'], 'high'), 'high importance is preserved');
});

test('a failed save keeps the edits; retry resends the same command, a new edit gets a new one', async () => {
  const { controller, saves } = harness(); await controller.load();
  controller.change('comfort', { value: 100 });
  saves[0].answer({ status: 'unavailable', retryable: true }); await settle();
  let view = controller.snapshot();
  assert.deepEqual(view.status, { kind: 'failed', text: 'Your changes were not saved.', actionLabel: 'Try again', action: 'retry' });
  assert.deepEqual(view.categories.comfort, considered(100)); assert.equal(saves.length, 1);
  controller.change('body', { value: ['estate'] }); await settle();
  assert.equal(saves.length, 1, 'no automatic resend while failed'); assert.equal(controller.snapshot().status.kind, 'failed');
  controller.retry(); assert.equal(saves.length, 2);
  assert.notEqual(saves[1].input.commandId, saves[0].input.commandId, 'the merged changes differ, so the command is new');
  assert.deepEqual(saves[1].input.changes, { comfort: { value: 100 }, body: { value: ['estate'] } });
  saves[1].answer({ status: 'unavailable', retryable: true }); await settle();
  controller.retry(); assert.equal(saves[2].input.commandId, saves[1].input.commandId, 'unchanged changes reuse the same command');
  assert.deepEqual(saves[2].input, saves[1].input);
  saves[2].answer(ok(1, { comfort: considered(100), body: considered(['estate']) })); await settle();
  assert.equal(controller.snapshot().status.text, 'Preferences saved automatically.');
});

test('a network throw is the same retryable failure', async () => {
  const controller = createAccountPreferencesController({ transport: { loadEditor: async () => editor(), savePreferences: async () => { throw new Error('offline'); } }, createCommandId: () => 'c' });
  await controller.load(); controller.change('comfort', { value: 0 }); await settle();
  assert.equal(controller.snapshot().status.kind, 'failed'); assert.deepEqual(controller.snapshot().categories.comfort, considered(0));
});

test('stale or conflicting responses ask for a reload; only the explicit reload drops unsent edits', async () => {
  let fresh = editor({ body: considered(['saloon']) }, { draftVersion: 9 });
  const { controller, saves } = harness(() => fresh); await controller.load();
  controller.change('comfort', { value: 100 });
  saves[0].answer({ status: 'stale-version', action: 'refresh' }); await settle();
  let view = controller.snapshot();
  assert.deepEqual(view.status, { kind: 'stale', text: 'Your preferences changed elsewhere. Reload to see the latest.', actionLabel: 'Reload preferences', action: 'reload' });
  assert.equal(view.disabled, true); assert.deepEqual(view.categories.comfort, considered(100), 'edits stay until the explicit reload');
  controller.change('body', { value: ['estate'] }); assert.equal(saves.length, 1);
  await controller.reload();
  view = controller.snapshot();
  assert.equal(view.draftVersion, 9); assert.deepEqual(view.categories.comfort, { state: 'unset' }); assert.deepEqual(view.categories.body, considered(['saloon']));
  assert.equal(view.status.kind, 'idle'); assert.equal(view.disabled, false);
  controller.change('comfort', { value: 0 }); assert.equal(saves[1].input.expectedDraftVersion, 9);
});

test('a conflict that is not read-only also asks for a reload; brief-read-only disables editing with its own copy', async () => {
  const a = harness(); await a.controller.load(); a.controller.change('comfort', { value: 100 });
  a.saves[0].answer({ status: 'conflict', reason: 'something-else' }); await settle();
  assert.equal(a.controller.snapshot().status.kind, 'stale');
  const b = harness(); await b.controller.load(); b.controller.change('comfort', { value: 100 });
  b.saves[0].answer({ status: 'conflict', reason: 'brief-read-only' }); await settle();
  const view = b.controller.snapshot();
  assert.equal(view.status.text, 'Your buddy found your car, so your preferences can no longer be changed.'); assert.equal(view.disabled, true);
  b.controller.change('body', { value: ['estate'] }); b.controller.open('comfort'); assert.equal(b.saves.length, 1);
});

test('an accepted selection loads read-only', async () => {
  const accepted = editor(); accepted.value.selection = { state: 'accepted', briefVersion: 1 };
  const { controller } = harness(accepted); await controller.load();
  assert.equal(controller.snapshot().disabled, true); assert.match(controller.snapshot().status.text, /can no longer be changed/);
});

test('an expired session or restarted run disables editing with the shared copy', async () => {
  for (const [status, text, kind] of [['access-required', ACCESS_LAPSED_MESSAGE, 'access'], ['stale-run', RUN_RESTARTED_MESSAGE, 'restarted']]) {
    const { controller, saves } = harness(); await controller.load(); controller.change('comfort', { value: 50 });
    saves[0].answer({ status }); await settle();
    const view = controller.snapshot();
    assert.deepEqual([view.status.kind, view.status.text, view.disabled], [kind, text, true]);
    controller.change('body', { value: ['estate'] }); controller.open('comfort'); assert.equal(saves.length, 1);
  }
});

test('an invalid response is not retryable: it restores the last confirmed state and says so', async () => {
  const { controller, saves } = harness(editor({ comfort: considered(100) }, { draftVersion: 1 })); await controller.load();
  controller.change('comfort', { value: 0 });
  saves[0].answer({ status: 'invalid', code: 'invalid-preferences' }); await settle();
  const view = controller.snapshot();
  assert.deepEqual(view.categories.comfort, considered(100)); assert.deepEqual(view.status, { kind: 'failed', text: 'That change could not be saved.' });
  assert.equal(saves.length, 1);
});

test('autosave never confirms, saves a draft or touches Buddy consent', async () => {
  const { controller, saves, state } = harness(); await controller.load();
  controller.open('comfort'); controller.change('body', { value: ['estate'] }); controller.requestRemove('comfort'); controller.confirmRemove('comfort');
  saves[0].answer(ok(1, {})); await settle(); saves[1]?.answer(ok(2, {})); await settle();
  assert.equal(state.confirms, 0);
  for (const save of saves) assert.deepEqual(Object.keys(save.input).sort(), ['changes', 'commandId', 'expectedBriefVersion', 'expectedDraftVersion']);
});

test('a late answer after destroy changes nothing and notifies nobody', async () => {
  const { controller, saves } = harness(); await controller.load(); const seen = [];
  controller.subscribe((s) => seen.push(s)); controller.change('comfort', { value: 0 }); const count = seen.length;
  controller.destroy(); saves[0].answer(ok(1, { comfort: considered(0) })); await settle();
  assert.equal(seen.length, count);
});
