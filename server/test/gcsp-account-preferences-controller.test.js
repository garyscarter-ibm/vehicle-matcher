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
  assert.deepEqual(view.status, { kind: 'failed', text: 'Your comfort change was not saved.', actionLabel: 'Try again', action: 'retry' });
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

// Current-car star rating lane: it shares the one in-flight, coalesced queue with category autosave.
const CAR = 'current:employee-paula';
const rated = (value, extra = {}) => { const e = editor(extra.categories, extra.versions); e.value.initial.currentCarRating = { contractId: CAR, value }; return e; };
const okRated = (draftVersion, value, categories = {}, contractId = CAR) => { const r = ok(draftVersion, categories); r.value.currentCarRating = { contractId, value }; return r; };

test('rate saves only the rating and leaves the footer, consent and categories alone', async () => {
  const { controller, saves, state } = harness(rated(null)); await controller.load();
  assert.deepEqual(controller.snapshot().rating, { value: null, contractId: CAR, saved: null, status: 'idle' });
  const before = controller.snapshot().status;
  controller.rate(3, CAR);
  assert.deepEqual(saves[0].input, { commandId: 'preferences:1', expectedBriefVersion: 1, expectedDraftVersion: 0, changes: {}, currentCarRating: { contractId: CAR, value: 3 } });
  assert.equal(controller.snapshot().rating.value, 3); assert.equal(controller.snapshot().rating.status, 'pending');
  assert.deepEqual(controller.snapshot().status, before, 'the preferences footer does not report a rating-only save');
  saves[0].answer(okRated(1, 3)); await settle();
  assert.deepEqual(controller.snapshot().rating, { value: 3, contractId: CAR, saved: 3, status: 'saved' });
  assert.deepEqual(controller.snapshot().status, before); assert.equal(controller.snapshot().draftVersion, 1);
  assert.equal(state.confirms, 0); assert.deepEqual(controller.snapshot().categories.body, { state: 'unset' });
  controller.rate(null, CAR); assert.deepEqual(saves[1].input.currentCarRating, { contractId: CAR, value: null });
  assert.equal(saves[1].input.expectedDraftVersion, 1);
});

test('a rating made during a category save coalesces into the next single request with its categories', async () => {
  const { controller, saves } = harness(rated(null)); await controller.load();
  controller.change('comfort', { value: 100 });
  controller.rate(2, CAR); controller.change('body', { value: ['estate'] });
  assert.equal(saves.length, 1); assert.equal('currentCarRating' in saves[0].input, false);
  saves[0].answer(okRated(1, null, { comfort: considered(100) })); await settle();
  assert.equal(saves.length, 2); assert.equal(controller.snapshot().rating.value, 2, 'the echo of an older answer keeps the newer choice');
  assert.deepEqual(saves[1].input.changes, { body: { value: ['estate'] } }); assert.deepEqual(saves[1].input.currentCarRating, { contractId: CAR, value: 2 });
  assert.equal(controller.snapshot().status.kind, 'pending');
  saves[1].answer(okRated(2, 2, { body: considered(['estate']), comfort: considered(100) })); await settle();
  assert.equal(controller.snapshot().status.text, 'Preferences saved automatically.'); assert.equal(controller.snapshot().rating.status, 'saved');
});

test('rapid 3 then 5 then clear sends one follow-up with the newest, and a late answer for 3 cannot overwrite it', async () => {
  const { controller, saves } = harness(rated(4)); await controller.load();
  controller.rate(3, CAR); controller.rate(5, CAR); controller.rate(null, CAR);
  assert.equal(saves.length, 1); assert.equal(controller.snapshot().rating.value, null);
  saves[0].answer(okRated(1, 3)); await settle();
  assert.equal(controller.snapshot().rating.value, null, 'visible value stays the newest');
  assert.equal(controller.snapshot().rating.saved, 3); assert.equal(controller.snapshot().rating.status, 'pending');
  assert.equal(saves.length, 2); assert.deepEqual(saves[1].input.currentCarRating, { contractId: CAR, value: null });
  saves[1].answer(okRated(2, null)); await settle();
  assert.deepEqual(controller.snapshot().rating, { value: null, contractId: CAR, saved: null, status: 'saved' }); assert.equal(saves.length, 2);
});

test('rate ignores a wrong car, an out of range value, a missing lane and a locked editor', async () => {
  const { controller, saves } = harness(rated(null)); await controller.load();
  for (const [value, id] of [[3, 'other:car'], [0, CAR], [6, CAR], [2.5, CAR], ['3', CAR], [undefined, CAR]]) controller.rate(value, id);
  assert.equal(saves.length, 0);
  const none = harness(editor()); await none.controller.load();
  assert.equal(none.controller.snapshot().rating, null); none.controller.rate(3, CAR); assert.equal(none.saves.length, 0);
  const nul = rated(null); nul.value.initial.currentCarRating = null; const bare = harness(nul); await bare.controller.load();
  assert.equal(bare.controller.snapshot().rating, null);
  const locked = rated(2); locked.value.selection = { state: 'accepted', briefVersion: 1 }; const l = harness(locked); await l.controller.load();
  l.controller.rate(4, CAR); assert.equal(l.saves.length, 0); assert.equal(l.controller.snapshot().rating.value, 2);
});

test('a failed rating keeps the attempted value, retry resends the same command, a new value gets a new one', async () => {
  const { controller, saves } = harness(rated(null)); await controller.load();
  controller.rate(4, CAR); saves[0].answer({ status: 'unavailable', retryable: true }); await settle();
  assert.deepEqual(controller.snapshot().rating, { value: 4, contractId: CAR, saved: null, status: 'failed' });
  assert.equal(controller.snapshot().status.kind, 'idle', 'the footer is not blamed for a rating failure');
  assert.equal(saves.length, 1);
  controller.retry(); assert.equal(saves.length, 2); assert.equal(controller.snapshot().rating.status, 'pending');
  assert.deepEqual(saves[1].input, saves[0].input, 'same command and body');
  saves[1].answer({ status: 'unavailable', retryable: true }); await settle();
  controller.rate(5, CAR); assert.equal(saves.length, 2, 'no automatic resend while failed'); assert.equal(controller.snapshot().rating.value, 5);
  controller.retry(); assert.notEqual(saves[2].input.commandId, saves[1].input.commandId); assert.deepEqual(saves[2].input.currentCarRating, { contractId: CAR, value: 5 });
  saves[2].answer(okRated(1, 5)); await settle();
  assert.deepEqual(controller.snapshot().rating, { value: 5, contractId: CAR, saved: 5, status: 'saved' });
});

test('stale and current-car-changed refusals ask for a reload, which shows the server rating', async () => {
  for (const refusal of [{ status: 'stale-version', action: 'refresh' }, { status: 'conflict', reason: 'current-car-changed', current: { contractId: 'current:new' } }, { status: 'conflict', reason: 'no-current-car' }]) {
    let fresh = rated(1, { versions: { draftVersion: 7 } });
    const { controller, saves } = harness(() => fresh); await controller.load();
    controller.rate(5, CAR); saves[0].answer(refusal); await settle();
    let view = controller.snapshot();
    assert.equal(view.status.kind, 'stale'); assert.equal(view.rating.value, 5); assert.equal(view.rating.status, 'failed'); assert.equal(view.disabled, true);
    controller.rate(2, CAR); assert.equal(saves.length, 1);
    await controller.reload(); view = controller.snapshot();
    assert.deepEqual(view.rating, { value: 1, contractId: CAR, saved: 1, status: 'idle' }); assert.equal(view.draftVersion, 7);
    assert.equal(view.status.kind, 'idle');
  }
});

test('an invalid or forbidden rating reverts to the saved value and reports failed', async () => {
  const { controller, saves } = harness(rated(2)); await controller.load();
  controller.rate(5, CAR); saves[0].answer({ status: 'invalid', code: 'invalid-rating' }); await settle();
  assert.deepEqual(controller.snapshot().rating, { value: 2, contractId: CAR, saved: 2, status: 'failed' });
  assert.equal(controller.snapshot().status.kind, 'idle'); assert.equal(saves.length, 1);
  controller.rate(1, CAR); saves[1].answer({ status: 'forbidden' }); await settle();
  assert.equal(controller.snapshot().rating.value, 2);
});

test('a malformed or mismatched ok answer is a failure, not a save', async () => {
  for (const answer of [undefined, { value: 9, contractId: CAR }, { value: 3 }, { value: 3, contractId: 'other:car' }, { value: '3', contractId: CAR }, 'x']) {
    const { controller, saves } = harness(rated(null)); await controller.load();
    controller.rate(3, CAR); const reply = ok(1, {}); if (answer !== undefined) reply.value.currentCarRating = answer; saves[0].answer(reply); await settle();
    const view = controller.snapshot();
    assert.equal(view.rating.status, 'failed', JSON.stringify(answer)); assert.equal(view.rating.saved, null); assert.equal(view.draftVersion, 0, 'versions do not advance');
  }
});

test('a read-only refusal locks the stars without touching the saved value', async () => {
  const { controller, saves } = harness(rated(4)); await controller.load();
  controller.rate(1, CAR); saves[0].answer({ status: 'conflict', reason: 'brief-read-only' }); await settle();
  const view = controller.snapshot();
  assert.equal(view.disabled, true); assert.deepEqual(view.rating, { value: 4, contractId: CAR, saved: 4, status: 'idle' });
});

// FUCQ-369: Same again lane and Buddy understanding; same queue, same coalescing, newest intent wins.
const POLICY = { maximum: 11, byConsidered: [1, 3, 4], sameAgain: 11 };
const again = (extra = {}, { on = false, available = true, reason, categories, versions, score } = {}) => {
  const e = rated(null, { categories, versions }); e.value.context.accountPreferences.understanding = { kind: 'input-completeness', ...POLICY, policyKey: 'k' };
  const n = Object.values(categories ?? {}).filter((c) => c.state === 'considered').length;
  e.value.initial.sameAgain = available ? { available: true, on, contractId: CAR } : { available: false, on: false, contractId: null, reason };
  e.value.initial.accountPreferences.understanding = { kind: 'input-completeness', value: score ?? (on ? 11 : POLICY.byConsidered[n]), maximum: 11 };
  return Object.assign(e, extra);
};
const okAgain = (draftVersion, on, categories = {}, value = on ? 11 : 1) => { const r = okRated(draftVersion, null, categories);
  r.value.sameAgain = { available: true, on, contractId: CAR }; r.value.accountPreferences.understanding = { kind: 'input-completeness', value, maximum: 11 }; return r; };
const lane = (c) => c.snapshot().sameAgain; const score = (c) => c.snapshot().understanding;

test('Same again sends only its intent, shows the projected score as pending, then the confirmed one', async () => {
  const { controller, saves } = harness(again()); await controller.load();
  assert.deepEqual(lane(controller), { available: true, on: false, reason: null, status: 'idle' }); assert.deepEqual(score(controller), { value: 1, maximum: 11, pending: false, failed: false });
  controller.toggleSameAgain(true);
  assert.deepEqual(saves[0].input, { commandId: 'preferences:1', expectedBriefVersion: 1, expectedDraftVersion: 0, changes: {}, sameAgain: { contractId: CAR, on: true } });
  assert.deepEqual(lane(controller), { available: true, on: true, reason: null, status: 'pending' });
  assert.deepEqual(score(controller), { value: 11, maximum: 11, pending: true, failed: false }); assert.equal(controller.snapshot().status.text, 'Saving your preferences.');
  saves[0].answer(okAgain(1, true)); await settle();
  assert.deepEqual(lane(controller), { available: true, on: true, reason: null, status: 'saved' });
  assert.deepEqual(score(controller), { value: 11, maximum: 11, pending: false, failed: false });
  assert.deepEqual(controller.snapshot().status, { kind: 'idle', text: 'More like your current car. Preferences save automatically.' });
  controller.toggleSameAgain(false); saves[1].answer(okAgain(2, false)); await settle();
  assert.equal(lane(controller).on, false); assert.equal(score(controller).value, 1); assert.equal(controller.snapshot().status.text, '0 of 3 categories considered · Preferences save automatically');
});

test('rapid on, off, on sends one in flight plus the latest, and a late answer cannot undo the newest choice', async () => {
  const { controller, saves } = harness(again()); await controller.load();
  controller.toggleSameAgain(true); controller.toggleSameAgain(false); controller.toggleSameAgain(true);
  assert.equal(saves.length, 1); assert.equal(lane(controller).on, true);
  saves[0].answer(okAgain(1, true)); await settle();
  assert.equal(saves.length, 1, 'the newest choice already matches the saved state, so nothing more is sent');
  controller.toggleSameAgain(false); controller.toggleSameAgain(true); controller.toggleSameAgain(false);
  assert.equal(saves.length, 2); assert.equal(saves[1].input.sameAgain.on, false);
  saves[1].answer(okAgain(2, false)); await settle();
  assert.equal(saves.length, 2); assert.equal(lane(controller).on, false);
  controller.toggleSameAgain(true); controller.toggleSameAgain(false);
  saves[2].answer(okAgain(3, true)); await settle();
  assert.equal(saves.length, 4, 'the answer for on is followed by the newest, off'); assert.equal(saves[3].input.sameAgain.on, false); assert.equal(lane(controller).on, false, 'the visible value stays the newest');
});

test('Same again shares the queue with categories and rating: one request carries them in order', async () => {
  const { controller, saves } = harness(again()); await controller.load();
  controller.change('comfort', { value: 100 }); controller.toggleSameAgain(true); controller.rate(4, CAR);
  assert.equal(saves.length, 1); assert.equal('sameAgain' in saves[0].input, false);
  saves[0].answer(okAgain(1, false, { comfort: considered(100) })); await settle();
  assert.equal(saves.length, 2); assert.deepEqual(saves[1].input.sameAgain, { contractId: CAR, on: true }); assert.deepEqual(saves[1].input.currentCarRating, { contractId: CAR, value: 4 });
  assert.deepEqual(saves[1].input.changes, {});
});

test('queued edits made before an on go out with an explicit off first, then the on follows', async () => {
  const { controller, saves } = harness(again({}, { on: true, categories: { comfort: considered(0) } }));
  await controller.load(); controller.toggleSameAgain(false); saves[0].answer(okAgain(1, false, { comfort: considered(0) }, 3)); await settle();
  controller.change('body', { value: ['estate'] }); controller.toggleSameAgain(true);
  assert.deepEqual(saves[1].input.changes, { body: { value: ['estate'] } });
  saves[1].answer(okAgain(2, false, { comfort: considered(0), body: considered(['estate']) }, 4)); await settle();
  assert.deepEqual(saves[2].input.sameAgain, { contractId: CAR, on: true }); assert.deepEqual(saves[2].input.changes, {});
});

test('while on, open, change, remove and confirm do nothing and rate still works; turning on closes the panel and removal', async () => {
  const { controller, saves } = harness(again({}, { categories: { body: considered(['estate']), comfort: considered(100) } })); await controller.load();
  controller.open('body'); assert.equal(controller.snapshot().open, 'body');
  controller.toggleSameAgain(true); assert.equal(controller.snapshot().open, null);
  saves[0].answer(okAgain(1, true, { body: considered(['estate']), comfort: considered(100) })); await settle();
  controller.open('comfort'); controller.change('body', { value: ['saloon'] }); controller.change('comfort', { importance: 'high' });
  controller.requestRemove('comfort'); controller.confirmRemove('comfort');
  const view = controller.snapshot(); assert.equal(view.open, null); assert.equal(view.pendingRemoval, null); assert.equal(saves.length, 1);
  assert.deepEqual(view.categories.body, considered(['estate'])); assert.deepEqual(view.categories.comfort, considered(100));
  controller.rate(5, CAR); assert.equal(saves.length, 2); assert.deepEqual(saves[1].input.currentCarRating, { contractId: CAR, value: 5 });
  controller.toggleSameAgain(false); controller.requestRemove('comfort'); assert.equal(controller.snapshot().pendingRemoval, 'comfort');
  controller.toggleSameAgain(true); assert.equal(controller.snapshot().pendingRemoval, null, 'turning on drops a pending removal');
});

test('turning off restores the saved categories exactly and leaves the view unchanged', async () => {
  const saved = { body: considered(['estate'], 'high'), comfort: considered(100) };
  const { controller, saves } = harness(again({}, { on: true, categories: saved })); await controller.load();
  const before = controller.snapshot().categories;
  controller.toggleSameAgain(false); saves[0].answer(okAgain(1, false, saved, 4)); await settle();
  assert.deepEqual(controller.snapshot().categories, before); assert.deepEqual(controller.snapshot().categories.body, saved.body);
});

test('a failed Same again save keeps the attempt, says so, retry reuses the command and a new choice gets a new one', async () => {
  const { controller, saves } = harness(again()); await controller.load();
  controller.toggleSameAgain(true); saves[0].answer({ status: 'unavailable', retryable: true }); await settle();
  assert.deepEqual(controller.snapshot().status, { kind: 'failed', text: 'Same again was not saved.', actionLabel: 'Try again', action: 'retry' });
  assert.deepEqual(lane(controller), { available: true, on: true, reason: null, status: 'failed' }); assert.deepEqual(score(controller), { value: 11, maximum: 11, pending: true, failed: true });
  controller.retry(); assert.equal(saves.length, 2); assert.equal(saves[1].input.commandId, saves[0].input.commandId); assert.deepEqual(saves[1].input, saves[0].input);
  saves[1].answer({ status: 'unavailable', retryable: true }); await settle();
  controller.toggleSameAgain(false);
  assert.equal(saves.length, 2, 'back to the saved state needs no request'); assert.equal(lane(controller).on, false); assert.equal(controller.snapshot().status.kind, 'idle', 'and the failure clears');
  controller.toggleSameAgain(true); assert.equal(saves.length, 3); assert.notEqual(saves[2].input.commandId, saves[1].input.commandId);
});

test('a retry that succeeds clears the failure and confirms the score', async () => {
  const { controller, saves } = harness(again()); await controller.load();
  controller.toggleSameAgain(true); saves[0].answer({ status: 'unavailable', retryable: true }); await settle();
  controller.retry(); saves[1].answer(okAgain(1, true)); await settle();
  assert.deepEqual(lane(controller), { available: true, on: true, reason: null, status: 'saved' }); assert.equal(controller.snapshot().status.kind, 'idle');
  assert.deepEqual(score(controller), { value: 11, maximum: 11, pending: false, failed: false });
});

test('stale and conflict refusals ask for a reload, which shows the server state', async () => {
  for (const refusal of [{ status: 'stale-version', action: 'refresh' }, { status: 'conflict', reason: 'current-car-changed', current: { contractId: 'current:new' } }]) {
    let fresh = again({}, { on: false }); fresh.value.initial.draftVersion = 6;
    const { controller, saves } = harness(() => fresh); await controller.load();
    controller.toggleSameAgain(true); saves[0].answer(refusal); await settle();
    assert.equal(controller.snapshot().status.kind, 'stale'); assert.equal(controller.snapshot().disabled, true);
    controller.toggleSameAgain(false); assert.equal(saves.length, 1);
    await controller.reload();
    assert.deepEqual(lane(controller), { available: true, on: false, reason: null, status: 'idle' }); assert.equal(controller.snapshot().draftVersion, 6);
  }
});

test('an invalid Same again answer reverts to the last confirmed state and says it was not saved', async () => {
  const { controller, saves } = harness(again({}, { categories: { comfort: considered(0) } })); await controller.load();
  controller.toggleSameAgain(true); saves[0].answer({ status: 'invalid', code: 'invalid-preferences' }); await settle();
  assert.deepEqual(lane(controller), { available: true, on: false, reason: null, status: 'failed' }); assert.equal(saves.length, 1);
  assert.deepEqual(controller.snapshot().status, { kind: 'failed', text: 'Same again was not saved.' }); assert.deepEqual(score(controller), { value: 3, maximum: 11, pending: false, failed: false });
  controller.toggleSameAgain(true); assert.equal(saves.length, 2, 'a fresh choice is sent again');
});

test('a run reset or access lapse locks the switch and shows the saved value', async () => {
  for (const [status, kind] of [['access-required', 'access'], ['stale-run', 'restarted']]) {
    const { controller, saves } = harness(again()); await controller.load();
    controller.toggleSameAgain(true); saves[0].answer({ status }); await settle();
    assert.equal(controller.snapshot().status.kind, kind); assert.equal(controller.snapshot().disabled, true); assert.equal(lane(controller).on, false);
    controller.toggleSameAgain(true); assert.equal(saves.length, 1);
  }
});

test('an ok answer without a matching Same again view is a failure, not a save', async () => {
  for (const answer of [undefined, { available: true, on: true, contractId: 'other:car' }, { available: true, on: 'yes', contractId: CAR }, { available: false, on: false, contractId: null }]) {
    const { controller, saves } = harness(again()); await controller.load();
    controller.toggleSameAgain(true); const reply = okAgain(1, true); if (answer === undefined) delete reply.value.sameAgain; else reply.value.sameAgain = answer;
    saves[0].answer(reply); await settle();
    assert.equal(lane(controller).status, 'failed', JSON.stringify(answer)); assert.equal(controller.snapshot().draftVersion, 0);
  }
});

test('unavailable: the switch is refused locally, the reason is exposed and categories stay editable', async () => {
  for (const reason of ['no-current-car', 'current-car-unidentified']) {
    const { controller, saves } = harness(again({}, { available: false, reason })); await controller.load();
    assert.deepEqual(lane(controller), { available: false, on: false, reason, status: 'idle' });
    controller.toggleSameAgain(true); assert.equal(saves.length, 0); assert.equal(lane(controller).on, false);
    controller.change('comfort', { value: 100 }); assert.equal(saves.length, 1); assert.deepEqual(saves[0].input.changes, { comfort: { value: 100 } });
  }
  const none = harness(editor()); await none.controller.load(); assert.equal(lane(none.controller), null); assert.equal(score(none.controller), null); none.controller.toggleSameAgain(true); assert.equal(none.saves.length, 0);
});

test('understanding: confirmed at rest, projected from the policy while a change is pending, for 0 to 2 categories', async () => {
  const { controller, saves } = harness(again()); await controller.load();
  assert.equal(score(controller).value, 1);
  controller.change('comfort', { value: 100 });
  assert.deepEqual(score(controller), { value: 3, maximum: 11, pending: true, failed: false });
  controller.change('body', { value: ['estate'] });
  assert.equal(score(controller).value, 4, 'optimistic count of two');
  saves[0].answer(okAgain(1, false, { comfort: considered(100) }, 3)); await settle();
  assert.deepEqual(score(controller), { value: 4, maximum: 11, pending: true, failed: false }, 'still pending: the follow-up is unsent or in flight');
  saves[1].answer(okAgain(2, false, { comfort: considered(100), body: considered(['estate']) }, 4)); await settle();
  assert.deepEqual(score(controller), { value: 4, maximum: 11, pending: false, failed: false });
  controller.requestRemove('comfort'); controller.confirmRemove('comfort');
  assert.deepEqual(score(controller), { value: 3, maximum: 11, pending: true, failed: false }, 'a removal projects one fewer');
  saves[2].answer({ status: 'unavailable', retryable: true }); await settle();
  assert.deepEqual(score(controller), { value: 3, maximum: 11, pending: true, failed: true });
});

test('rating and importance never change the score', async () => {
  const { controller, saves } = harness(again({}, { categories: { comfort: considered(100) } })); await controller.load();
  controller.rate(5, CAR); assert.deepEqual(score(controller), { value: 3, maximum: 11, pending: false, failed: false });
  saves[0].answer(okAgain(1, false, { comfort: considered(100) }, 3)); await settle();
  controller.change('comfort', { importance: 'high' }); assert.equal(score(controller).value, 3);
  saves[1].answer(okAgain(2, false, { comfort: considered(100, 'high') }, 3)); await settle();
  assert.deepEqual(score(controller), { value: 3, maximum: 11, pending: false, failed: false });
});

test('without a policy projection the score is absent, and the editor still works', async () => {
  const e = again(); delete e.value.context.accountPreferences.understanding;
  const { controller } = harness(e); await controller.load(); assert.equal(score(controller), null); assert.equal(lane(controller).available, true);
});
