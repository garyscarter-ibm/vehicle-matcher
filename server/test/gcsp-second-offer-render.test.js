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
  assert.equal(root.querySelector('[role=alert]').textContent, 'Choose a different value.');
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
  view.update({ state: 'stale-run', busy: false }); assert.match(root.textContent, /earlier demo run/);
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
  assert.match(root.querySelector('table').textContent, /Not supplied/); assert.match(root.querySelector('details').textContent, /dated-source/);
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
  assert.match(root.textContent, /Demo access needed/); assert.equal(root.querySelectorAll('button').length, 0);
  assert.equal(root.querySelector('a.vm-btn').getAttribute('href'), '/gcsp/access?next=%2Fgcsp-account.html');
  assert.equal(root.querySelector('[data-followup-action=refresh]'), null); assert.doesNotMatch(root.textContent, /unavailable/i);
});
