import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createFollowupView } from '../../blocks/gcsp/offer-followup/followup-view.js';

// Scoped rendering fixtures only. Actual FUCQ-105 projection/106 decision integration is a separate check.
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://followup.invalid/' });
after(() => dom.window.close());
globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
const { mountFollowupBody, defineGcspOfferFollowup } = await import('../../blocks/gcsp/offer-followup/gcsp-offer-followup.js');
const question = (kind = 'options') => ({ state: 'question', busy: false, canConfirm: false, error: '', savedChange: null,
  value: kind === 'slider' ? 50 : kind === 'equipment' ? ['towbar'] : 'saloon', question: {
    schemaVersion: 1, questionVersion: 'question-one', prompt: 'What would you change?', currentValue: 'saloon',
    control: kind === 'slider' ? { kind, minimum: 0, maximum: 100, unit: 'percent' }
      : kind === 'equipment' ? { kind, maximumItems: 3, maximumItemLength: 20 }
        : { kind, options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] } } });
const saved = { briefVersion: 2 };
function host(t, adapters = {}) {
  const root = document.createElement('main'); document.body.append(root); const view = createFollowupView(root, adapters);
  t.after(() => { view.destroy(); root.remove(); }); return { root, view };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('shared options preserve keyboard focus and do not confirm on selection', (t) => {
  const choices = []; let confirmations = 0; const { root, view } = host(t, { choose: (v) => choices.push(v), confirm: () => { confirmations += 1; } });
  const model = question(); view.update(model);
  const options = root.querySelector('[role=radiogroup]'); const first = options.querySelector('button'); first.focus();
  first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(choices, ['estate']); assert.equal(confirmations, 0);
  const selected = document.activeElement; assert.equal(selected.textContent, 'Estate');
  view.update({ ...model, value: 'estate', canConfirm: true });
  assert.equal(root.querySelector('[role=radiogroup]'), options); assert.equal(document.activeElement, selected);
  root.querySelector('[data-followup-action=confirm]').click(); assert.equal(confirmations, 1);
});

test('shared slider and labelled equipment textarea retain focused controls across edits', (t) => {
  for (const kind of ['slider', 'equipment']) {
    let chosen; const { root, view } = host(t, { choose: (v) => { chosen = v; } }); const model = question(kind); view.update(model);
    const input = root.querySelector(kind === 'slider' ? 'input[type=range]' : 'textarea'); input.focus();
    input.value = kind === 'slider' ? '72' : 'heated seats\nrear camera'; input.dispatchEvent(new dom.window.Event('input'));
    const expected = kind === 'slider' ? 72 : ['heated seats', 'rear camera']; assert.deepEqual(chosen, expected);
    view.update({ ...model, value: expected, canConfirm: true }); assert.equal(document.activeElement, input);
    if (kind === 'slider') assert.equal(input.getAttribute('aria-valuetext'), '72%');
    else assert.equal(root.querySelector('label').htmlFor, input.id);
  }
});

test('FUCQ-183: a question with no current value says the answer adds it and keeps the copy free of em dashes', (t) => {
  for (const kind of ['options', 'slider', 'equipment']) {
    const { root, view } = host(t); const model = question(kind);
    model.question.currentValue = null; model.value = kind === 'slider' ? 50 : kind === 'equipment' ? [] : null;
    view.update(model);
    assert.match(root.querySelector('fieldset').textContent, /Not in your brief yet\. Your answer adds it\./);
    assert.equal(root.querySelector('[data-followup-action=confirm]').disabled, true);
    assert.doesNotMatch(root.textContent, /\u2014/);
    if (kind === 'equipment') assert.doesNotMatch(root.textContent, /Leave empty/);
    if (kind === 'options') assert.equal(root.querySelectorAll('[role=radio][aria-checked=true]').length, 0);
  }
  const { root, view } = host(t); view.update(question());
  assert.doesNotMatch(root.textContent, /Not in your brief yet/);
});

test('invalid, busy and saved states disable confirmation and move completed focus to the heading', (t) => {
  const { root, view } = host(t); const model = question(); view.update({ ...model, error: 'Choose a different value.' });
  assert.equal(root.querySelector(`#${root.querySelector('fieldset').getAttribute('aria-describedby')}`).textContent, 'Choose a different value.');
  assert.equal(root.querySelector('.gcsp-followup-live').textContent, 'Choose a different value.');
  assert.equal(root.querySelector('[data-followup-action=confirm]').disabled, true);
  view.update({ ...model, value: 'estate', canConfirm: true }); const button = root.querySelector('[data-followup-action=confirm]'); button.focus();
  view.update({ ...model, value: 'estate', busy: true }); assert.equal(button.disabled, true); assert.equal(root.getAttribute('aria-busy'), null);
  assert.equal(root.firstElementChild.getAttribute('aria-busy'), 'true');
  view.update({ state: 'change-saved', savedChange: saved, busy: false });
  assert.match(root.textContent, /brief version 2/); assert.equal(document.activeElement.tagName, 'H2');
  assert.equal(root.querySelector('[data-followup-action=confirm]'), null);
});

test('uncertain state offers the same-command retry; unavailable keeps saved receipt without a no-match claim', (t) => {
  let retries = 0; let reads = 0; const { root, view } = host(t, { confirm: () => { retries += 1; }, refresh: () => { reads += 1; } });
  view.update({ state: 'confirmation-uncertain', busy: false }); root.querySelector('[data-followup-action=retry]').click();
  root.querySelector('[data-followup-action=refresh]').click(); assert.equal(retries, 1); assert.equal(reads, 1);
  view.update({ state: 'unavailable', savedChange: saved, busy: false });
  assert.match(root.textContent, /Your change is saved/); assert.doesNotMatch(root.textContent, /Nothing suitable|Waiting for|No match/);
  view.update({ state: 'stale-run', busy: false }); assert.match(root.textContent, /page is out of date/);
  assert.equal(root.querySelector('button'), null);
});

test('waiting and no-match are calculated states with a focusable refresh and the title announced', (t) => {
  let reads = 0; const { root, view } = host(t, { refresh: () => { reads += 1; } });
  const cases = [
    [{ state: 'waiting' }, 'Waiting for the next release', /Your change is saved\. Your next offer is checked when more cars are released\./],
    [{ state: 'no-match', evaluation: { evaluatedAt: '2026-11-06T09:00:00.000Z', carsChecked: 3, suitable: 0 } },
      'Nothing suitable yet', /None of the 3 cars checked fit your updated brief\. We will check again at the next release\./],
    [{ state: 'no-match', evaluation: { evaluatedAt: '2026-11-06T09:00:00.000Z', carsChecked: 1, suitable: 0 } },
      'Nothing suitable yet', /The 1 car checked does not fit your updated brief\./],
  ];
  for (const [model, title, message] of cases) {
    view.update({ ...model, savedChange: saved, busy: false });
    assert.match(root.querySelector('h1, h2').textContent, new RegExp(title)); assert.match(root.textContent, message);
    assert.equal(root.querySelector('.gcsp-followup-live').textContent, title); assert.doesNotMatch(root.textContent, /\u2014/);
    const refresh = root.querySelector('[data-followup-action=refresh]'); assert.ok(refresh); assert.equal(refresh.disabled, false);
    assert.equal(refresh.tagName, 'BUTTON'); refresh.focus(); assert.equal(document.activeElement, refresh);
  }
  root.querySelector('[data-followup-action=refresh]').click(); assert.equal(reads, 1);
});

test('FUCQ-188: an embedding page that shows its own refresh gets no second Check current state', (t) => {
  const offer = (id) => ({ offerId: id, quote: { quoteId: `quote-${id}`, briefVersion: 1, policyVersion: 'p', quotedAt: '2026-11-06T00:00:00Z' } });
  const projector = ({ value }) => ({ status: 'ok', value: { reference: { offerId: value.offerId }, card: { schemaVersion: 1,
    selectedId: value.offerId, members: [{ id: value.offerId, display: { name: value.offerId }, media: {}, facts: [], terms: [],
      decision: { gateStatus: 'eligible', score: 90, reasons: [], blockers: [], unknowns: [], tradeOffs: [] }, actions: [] }] } } });
  const models = [question(), { state: 'waiting', savedChange: saved }, { state: 'no-match', evaluation: { carsChecked: 2 } },
    { state: 'unavailable' }, { state: 'refresh-required' }, { state: 'confirmation-uncertain' },
    { state: 'ready', comparison: { currentBriefVersion: 2, previous: { offer: offer('a') }, next: { offer: offer('b') }, requirements: [] } }];
  const count = (root) => [...root.querySelectorAll('button')].filter((node) => node.textContent === 'Check current state').length;
  for (const [hostRefresh, expected] of [[false, 1], [true, 0]]) {
    const { root, view } = host(t, { hostRefresh, projectOffer: projector });
    for (const model of models) { view.update({ busy: false, ...model }); assert.equal(count(root), expected, `${model.state} hostRefresh=${hostRefresh}`); }
  }
});

test('comparison uses the supplied offer projector, shared cards/table and exact units/unknown/source evidence', (t) => {
  const calls = []; const opened = [];
  const projector = ({ value }) => { calls.push(value.offerId); return { status: 'ok', value: { reference: { offerId: value.offerId }, card: {
    schemaVersion: 1, selectedId: value.offerId, members: [{ id: value.offerId, display: { name: value.offerId }, media: {},
      facts: [], terms: [{ kind: 'points-monthly', value: 500, allowance: 600 }],
      decision: { gateStatus: 'eligible', score: 90, reasons: [], blockers: [], unknowns: [], tradeOffs: [] }, actions: [] }] } } }; };
  const { root, view } = host(t, { projectOffer: projector, openOffer: (v) => opened.push(v) });
  const source = { sourceRef: 'dated-source', version: 'snapshot-one', observedAt: '2026-11-05T00:00:00Z', assurance: 'confirmed-build' };
  const offer = (id, briefVersion) => ({ offerId: id, quote: { quoteId: `quote-${id}`, briefVersion, policyVersion: `policy-${briefVersion}`, quotedAt: '2026-11-06T00:00:00Z' } });
  view.update({ state: 'ready', savedChange: saved, busy: false, comparison: { currentBriefVersion: 2,
    previous: { offer: offer('first-car', 1) }, next: { offer: offer('second-car', 2) }, requirements: [
      { kind: 'essential', key: 'boot', value: 430, operator: 'gte', unit: 'L', previousFacts: {
        boot: { status: 'known', value: 400, unit: 'L', provenance: source } }, nextFacts: {
        boot: { status: 'unknown', value: null, unit: 'L', provenance: null } } },
    ] } });
  assert.deepEqual(calls, ['first-car', 'second-car']); assert.equal(root.querySelectorAll('.gcsp-followup-car').length, 2);
  assert.match(root.querySelector('table').textContent, /At least 430 \(L\)/); assert.match(root.querySelector('table').textContent, /400 \(L\)/);
  assert.match(root.querySelector('table').textContent, /Not supplied/); assert.match(root.querySelector('details').textContent, /Checked on.*Thursday 5 November 2026/);
  assert.match(root.querySelector('details').textContent, /policy-1/); assert.doesNotMatch(root.textContent, /better fit|90%/i);
  root.querySelector('[data-followup-action=open]').click(); assert.deepEqual(opened, [{ offerId: 'second-car' }]);
  assert.equal(root.querySelector('table th').scope, 'col'); assert.equal(root.querySelector('.gcsp-table-wrap').tabIndex, 0);
});

test('absent or failed canonical offer projection never paints an unverified ready page', (t) => {
  const { root, view } = host(t, { projectOffer: () => ({ status: 'unavailable' }) });
  view.update({ state: 'ready', busy: false, savedChange: saved, comparison: { previous: { offer: {} }, next: { offer: {} } } });
  assert.match(root.textContent, /Next-offer status unavailable/); assert.equal(root.querySelector('.gcsp-followup-cars'), null);
  assert.match(root.textContent, /change is saved/);
});

test('body teardown suppresses a late read; aborted mount performs no work', async () => {
  const root = document.createElement('main'); let resolve; let calls = 0;
  const cleanup = mountFollowupBody(root, { decisionId: 'decline-one', transport: {
    read: () => new Promise((r) => { resolve = r; }), confirm: async () => ({ status: 'unavailable' }),
  } }); cleanup(); resolve({ status: 'unavailable' }); await flush(); assert.equal(root.childElementCount, 0);
  const abort = new AbortController(); abort.abort(); mountFollowupBody(root, { signal: abort.signal,
    transport: { read: () => { calls += 1; }, confirm: () => {} } }); assert.equal(calls, 0);
});

test('standard element retains a pre-upgrade adapter and disconnect cleans its pending body', async () => {
  const element = document.createElement('gcsp-offer-followup'); let resolve; let reads = 0;
  element.adapter = { decisionId: 'decline-one', loadAccount: async () => ({ status: 'ready', name: 'Synthetic employee' }),
    transport: { read: () => { reads += 1; return new Promise((r) => { resolve = r; }); }, confirm: async () => ({ status: 'unavailable' }) } };
  document.body.append(element); defineGcspOfferFollowup(dom.window.customElements); await flush();
  try { assert.equal(reads, 1); assert.equal(Object.hasOwn(element, 'adapter'), false); assert.ok(element.querySelector('main')); }
  finally { element.remove(); }
  resolve({ status: 'unavailable' }); await flush(); assert.equal(element.childElementCount, 0);
});

test('owned block sources have no inline handlers, unsafe execution or stylesheet changes inside kit controls', async () => {
  const base = new URL('../../blocks/gcsp/offer-followup/', import.meta.url);
  for (const path of ['followup-controller.js', 'http-adapter.js', 'followup-view.js', 'gcsp-offer-followup.js']) {
    const source = await readFile(new URL(path, base), 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\b|\.innerHTML\s*=|setAttribute\(['"]on/i);
  }
  const css = await readFile(new URL('gcsp-offer-followup.css', base), 'utf8');
  assert.doesNotMatch(css, /\.vm-(?:option|card|slider|btn|facts)/); assert.match(css, /max-width: 800px/);
  // FUCQ-189: the question title sits inside the card padding rather than across its top border.
  assert.match(css, /\.gcsp-followup-field > legend \{[^}]*float: left; width: 100%/);
});

test('a lapsed access key links to the access form with no refresh', (t) => {
  const { root, view } = host(t); view.update({ state: 'access-lapsed', busy: false });
  assert.match(root.textContent, /Access needed/); assert.equal(root.querySelectorAll('button').length, 0);
  assert.equal(root.querySelector('a.vm-btn').getAttribute('href'), '/gcsp/access?next=%2Fgcsp-account.html');
  assert.equal(root.querySelector('[data-followup-action=refresh]'), null); assert.doesNotMatch(root.textContent, /unavailable/i);
});

const bodyOptions = ['hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv'];
const reviewed = { hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', suv: 'SUV', coupe: 'Coupe', convertible: 'Convertible', mpv: 'MPV' };

test('GC-042: body-style options read Coupé and Family carrier, send the same values and leave other questions alone', (t) => {
  const choices = []; const { root, view } = host(t, { choose: (v) => choices.push(v) }); const model = question();
  model.question.path = 'preferences.body.value'; model.question.control.options = bodyOptions.map((value) => ({ value, label: reviewed[value] }));
  view.update({ ...model, value: 'estate' });
  assert.deepEqual([...root.querySelectorAll('[role=radio]')].map((node) => node.textContent),
    ['Hatchback', 'Saloon', 'Estate', 'SUV', 'Coupé', 'Convertible', 'Family carrier']);
  [...root.querySelectorAll('[role=radio]')].find((node) => node.textContent === 'Coupé').click(); assert.deepEqual(choices, ['coupe']);
  const fuel = question(); fuel.question.path = 'preferences.fuel.value'; fuel.question.questionVersion = 'question-two'; fuel.value = 'phev';
  fuel.question.control.options = [{ value: 'phev', label: 'Plug-in hybrid' }, { value: 'ev', label: 'Electric' }];
  view.update(fuel); assert.deepEqual([...root.querySelectorAll('[role=radio]')].map((node) => node.textContent), ['Plug-in hybrid', 'Electric']);
});

test('GC-042: an embedding page owns the h1, so the follow-up uses h2 in every state; standalone keeps h1', (t) => {
  const offer = (id) => ({ offerId: id, quote: { quoteId: `quote-${id}`, briefVersion: 1, policyVersion: 'p', quotedAt: '2026-11-06T00:00:00Z' } });
  const projector = ({ value }) => ({ status: 'ok', value: { reference: { offerId: value.offerId }, card: { schemaVersion: 1,
    selectedId: value.offerId, members: [{ id: value.offerId, display: { name: value.offerId }, media: {}, facts: [], terms: [],
      decision: { gateStatus: 'eligible', score: 90, reasons: [], blockers: [], unknowns: [], tradeOffs: [] }, actions: [] }] } } });
  const models = [{ state: 'idle' }, { state: 'loading' }, question(), { state: 'change-saved', savedChange: saved }, { state: 'waiting', savedChange: saved },
    { state: 'no-match', evaluation: { carsChecked: 2 } }, { state: 'unavailable' }, { state: 'refresh-required' }, { state: 'confirmation-uncertain' },
    { state: 'stale-run' }, { state: 'forbidden' }, { state: 'access-lapsed' },
    { state: 'ready', comparison: { currentBriefVersion: 2, previous: { offer: offer('a') }, next: { offer: offer('b') }, requirements: [] } }];
  const embedded = host(t, { hostRefresh: true, headingLevel: 2, projectOffer: projector });
  const standalone = host(t, { projectOffer: projector });
  for (const model of models) {
    embedded.view.update({ busy: false, ...model }); assert.equal(embedded.root.querySelectorAll('h1').length, 0, `embedded ${model.state}`);
    assert.ok(embedded.root.querySelector('h2'), `embedded ${model.state} has an h2`);
    standalone.view.update({ busy: false, ...model });
    if (['question', 'ready'].includes(model.state)) assert.equal(standalone.root.querySelectorAll('h1').length, 1, `standalone ${model.state}`);
  }
  embedded.view.update({ busy: false, ...models[2] }); assert.equal(embedded.root.querySelector('h2').textContent, 'One change to your brief');
});

test('GC-042: focus on the follow-up root moves to its first heading on each draw', (t) => {
  const { root, view } = host(t, { hostRefresh: true, headingLevel: 2 }); root.tabIndex = -1; root.focus();
  view.update({ state: 'loading', busy: true }); assert.equal(document.activeElement.textContent, 'Checking your next offer');
  view.update(question()); assert.equal(document.activeElement.tagName, 'H2'); assert.equal(document.activeElement.textContent, 'One change to your brief');
});

test('GC-042: quote sources show Checked on and Quoted at as long dates, with no raw source or observed-at rows', (t) => {
  const projector = ({ value }) => ({ status: 'ok', value: { reference: { offerId: value.offerId }, card: { schemaVersion: 1, selectedId: value.offerId,
    members: [{ id: value.offerId, display: { name: value.offerId }, media: {}, facts: [], terms: [],
      decision: { gateStatus: 'eligible', score: 90, reasons: [], blockers: [], unknowns: [], tradeOffs: [] }, actions: [] }] } } });
  const { root, view } = host(t, { projectOffer: projector });
  const source = (observedAt) => ({ sourceRef: 'dated-source', version: 'snapshot-one', observedAt, assurance: 'confirmed-build' });
  const offer = (id) => ({ offerId: id, quote: { quoteId: `quote-${id}`, briefVersion: 1, policyVersion: 'p', quotedAt: '2026-11-06T09:30:00Z' } });
  view.update({ state: 'ready', busy: false, savedChange: saved, comparison: { currentBriefVersion: 2, previous: { offer: offer('a') }, next: { offer: offer('b') },
    requirements: [{ kind: 'essential', key: 'boot', value: 430, operator: 'gte', unit: 'L',
      previousFacts: { boot: { status: 'known', value: 400, unit: 'L', provenance: source('2026-11-05T09:00:00.000Z') } },
      nextFacts: { boot: { status: 'known', value: 450, unit: 'L', provenance: source('not a date') } } }] } });
  const text = root.querySelector('details').textContent;
  assert.match(text, /Checked onThursday 5 November 2026/); assert.match(text, /Quoted atFriday 6 November 2026/);
  assert.match(text, /Checked onNot supplied/); assert.match(text, /Assurance/);
  assert.doesNotMatch(text, /Observed at|Source version|dated-source|snapshot-one|2026-11-0\dT/); assert.doesNotMatch(text, /Source/);
});

// jsdom keeps focus on a disabled button; a browser drops it to body.
const dropFocus = () => { const node = document.activeElement; const was = node.disabled; node.disabled = false; node.blur(); node.disabled = was; };

test('GC-041: a saved change leads on to buddy activity when the host supplies the route; nothing else does', (t) => {
  const link = (root) => root.querySelector('[data-followup-link=activity]');
  const { root, view } = host(t, { hostRefresh: true, headingLevel: 2, activityHref: '/gcsp-activity-live.html' });
  for (const model of [{ state: 'change-saved', savedChange: saved }, { state: 'waiting', savedChange: saved },
    { state: 'no-match', savedChange: saved, evaluation: { carsChecked: 2 } }]) {
    view.update({ busy: false, ...model });
    const node = link(root);
    assert.ok(node, model.state); assert.equal(node.tagName, 'A'); assert.equal(node.textContent, 'See your buddy activity');
    assert.equal(node.getAttribute('href'), '/gcsp-activity-live.html'); assert.ok(node.classList.contains('vm-btn-primary'));
  }
  for (const model of [question(), { state: 'unavailable' }, { state: 'refresh-required' }, { state: 'confirmation-uncertain' }, { state: 'forbidden' }]) {
    view.update({ busy: false, ...model }); assert.equal(link(root), null, model.state);
  }
  const bare = host(t, { hostRefresh: true, headingLevel: 2 });
  bare.view.update({ busy: false, state: 'change-saved', savedChange: saved }); assert.equal(link(bare.root), null);
});

test('GC-041: focus lands on the outcome heading after Confirm even when the browser dropped it to body', (t) => {
  const outcomes = [{ state: 'change-saved', savedChange: saved }, { state: 'waiting', savedChange: saved },
    { state: 'no-match', savedChange: saved, evaluation: { carsChecked: 2 } },
    { state: 'ready', savedChange: saved, comparison: { currentBriefVersion: 2, previous: { offer: { offerId: 'a', quote: { quoteId: 'q', briefVersion: 1, policyVersion: 'p', quotedAt: '2026-11-06T00:00:00Z' } } },
      next: { offer: { offerId: 'b', quote: { quoteId: 'q', briefVersion: 1, policyVersion: 'p', quotedAt: '2026-11-06T00:00:00Z' } } }, requirements: [] } }];
  const projector = ({ value }) => ({ status: 'ok', value: { reference: { offerId: value.offerId }, card: { schemaVersion: 1, selectedId: value.offerId,
    members: [{ id: value.offerId, display: { name: value.offerId }, media: {}, facts: [], terms: [],
      decision: { gateStatus: 'eligible', score: 90, reasons: [], blockers: [], unknowns: [], tradeOffs: [] }, actions: [] }] } } });
  for (const outcome of outcomes) {
    const { root, view } = host(t, { hostRefresh: true, headingLevel: 2, projectOffer: projector });
    const model = { ...question(), value: 'estate', canConfirm: true }; view.update(model);
    const confirm = root.querySelector('[data-followup-action=confirm]'); confirm.focus();
    view.update({ ...model, busy: true, canConfirm: false }); dropFocus();
    assert.equal(document.activeElement, document.body);
    view.update({ busy: false, ...outcome });
    assert.equal(document.activeElement.tagName, 'H2', outcome.state);
    assert.equal(document.activeElement.textContent, root.querySelector('h2').textContent);
    assert.notEqual(document.activeElement.dataset.followupAction, 'refresh');
  }
  const { root, view } = host(t, { hostRefresh: true, headingLevel: 2 });
  const model = { ...question(), value: 'estate', canConfirm: true }; view.update(model);
  root.querySelector('[data-followup-action=confirm]').focus(); view.update({ ...model, busy: true, canConfirm: false });
  dropFocus(); view.update({ busy: false, state: 'change-saved', savedChange: saved });
  assert.equal(document.activeElement.textContent, 'Change saved');
});

test('GC-041: a rejected save returns focus to the heading, and a background poll never takes focus', (t) => {
  const { root, view } = host(t, { hostRefresh: true, headingLevel: 2 });
  const model = { ...question(), value: 'estate', canConfirm: true }; view.update(model);
  root.querySelector('[data-followup-action=confirm]').focus(); view.update({ ...model, busy: true, canConfirm: false });
  dropFocus(); view.update({ ...model, busy: false, error: 'Review your answer and choose a different value.' });
  assert.equal(document.activeElement.textContent, 'One change to your brief');
  // A poll while the person works elsewhere leaves focus alone.
  const other = document.createElement('input'); document.body.append(other); other.focus(); t.after(() => other.remove());
  view.update({ state: 'loading', busy: true }); view.update({ busy: false, state: 'waiting', savedChange: saved });
  assert.equal(document.activeElement, other);
});
