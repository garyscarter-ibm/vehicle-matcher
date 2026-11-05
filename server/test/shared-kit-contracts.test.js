import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installDom, resetDom } from './dom-harness.js';
import { matchCard, previewTile, listingsOf, mediaWell } from '../../blocks/vehicle-matcher/modes/result-card.js';
import { formatTerm } from '../../blocks/vehicle-matcher/ui.js';
import { employeeCardFixture } from '../../blocks/vehicle-matcher/employee-card-fixture.js';
import { createSharedKitEmployeeFixture } from './helpers/shared-kit-fixture.js';


let dom;
let exactListingExample;
let employeeDecisionExample;
let manualGalleryExample;
before(async () => {
  dom = installDom();
  ({ exactListingExample, employeeDecisionExample, manualGalleryExample } = await import('../../blocks/vehicle-matcher/component-gallery.js'));
});
after(() => dom.window.close());
beforeEach(() => resetDom());
const fixture = () => structuredClone(employeeCardFixture);

test('legacy retail signatures retain listing identity, price, odometer, dealer and unknown treatment', () => {
  const match = exactListingExample();
  assert.equal(listingsOf(match), match.listings);
  const card = matchCard(match, { big: true }); document.body.append(card);
  assert.match(card.textContent, /£30,000/);
  assert.match(card.textContent, /10,000 miles/);
  assert.equal(card.querySelector('.vm-card-link').textContent, `View at ${match.listings[0].retailerName} ›`);
  assert.match(card.querySelector('.vm-card-link').textContent, /View at/);
  assert.equal(card.querySelector('.vm-score').textContent, '96%');
  assert.equal(previewTile(match).tagName, 'A');
  assert.match(previewTile(match).textContent, /£30,000/);
  assert.equal(mediaWell({ name: 'Unknown car' }).media.querySelector('.vm-card-soon').textContent, 'Images coming soon');
});

test('typed terms never infer points from purchase money or invent unknown values', () => {
  assert.equal(formatTerm({ kind: 'purchase-money', currency: 'GBP', value: 32000 }), '£32,000');
  assert.equal(formatTerm({ kind: 'purchase-money', value: 32000 }), 'Terms not supplied');
  assert.equal(formatTerm({ kind: 'points-monthly', value: 1100, allowance: 1300 }), '1,100 points a month · 1,300 points a month allowance');
  assert.equal(formatTerm({ kind: 'points-monthly', value: null, allowance: null }), 'Monthly points cost not supplied · monthly points allowance not supplied');
  assert.equal(formatTerm({ kind: 'purchase-money', currency: 'GBP', value: null }), 'Purchase price not supplied');
});

test('exact selection updates every field, decision, term, media and callback together without replacing focused picker', () => {
  const view = fixture(); const second = view.members[1];
  second.display.line = 'Second exact line';
  second.terms = [{ kind: 'points-monthly', value: 1400, allowance: 1200 }];
  second.decision.tradeOffs = ['Second exact trade-off'];
  let selected; let actionMember;
  const card = matchCard(null, { view, onListingSelect: (member) => { selected = member; }, onAction: (action, member) => { actionMember = member; } });
  document.body.append(card);
  assert.equal(listingsOf(null, { view }), view.members);
  assert.match(card.textContent, /1,100 points a month/);
  assert.ok(card.querySelector('.vm-media-caption'));
  const choice = card.querySelectorAll('.vm-pick-opt')[1]; choice.focus(); choice.click();
  assert.equal(document.activeElement, choice);
  assert.equal(choice.getAttribute('aria-pressed'), 'true');
  assert.equal(selected, second);
  assert.equal(card.dataset.memberId, second.id);
  assert.equal(card.querySelector('.vm-card-name').textContent, second.display.name);
  assert.equal(card.querySelector('.vm-card-line').textContent, 'Second exact line');
  assert.equal(card.querySelector('.vm-card-photo'), null);
  assert.equal(card.querySelector('.vm-media-caption'), null);
  assert.match(card.textContent, /1,400 points a month · 1,200 points a month allowance/);
  assert.doesNotMatch(card.textContent, /1,100 points a month/);
  assert.match(card.textContent, /Not eligible/);
  assert.match(card.textContent, /Second exact trade-off/);
  assert.equal(card.querySelector('.vm-fact-value').textContent, '4 seats');
  assert.equal(card.querySelector('.vm-score').hidden, true);
  card.querySelector('[data-action-id="inspect"]').click();
  assert.equal(actionMember, second);
});

test('accept and reserve fail closed for ineligible, confirmation-needed, unknown or absent decisions despite caller enablement', () => {
  for (const gateStatus of ['eligible', 'ineligible', 'needs-confirmation', 'unrecognised', null]) {
    const view = fixture(); view.members = [view.members[0]];
    view.members[0].decision = gateStatus ? { gateStatus, score: 99 } : null;
    view.members[0].actions = ['accept', 'reserve'].map((kind) => ({ id: kind, kind, label: kind, disabled: false }));
    let calls = 0;
    const card = matchCard(null, { view, onAction: () => { calls += 1; } });
    for (const control of card.querySelectorAll('[data-action-id]')) {
      assert.equal(control.disabled, gateStatus !== 'eligible');
      if (control.disabled) assert.ok(card.querySelector(`#${control.getAttribute('aria-describedby')}`).textContent);
      control.click();
    }
    assert.equal(calls, gateStatus === 'eligible' ? 2 : 0);
  }
});

test('explicit facts preserve zero and unknown units; preview shares the same exact gate and callback contract', () => {
  const view = fixture(); view.members = [view.members[2]];
  view.members[0].facts.push({ label: 'Confirmed zero', value: 0, unit: 'mi' });
  const tile = previewTile(null, { view });
  assert.match(tile.textContent, /Not supplied \(seats\)/);
  assert.match(tile.textContent, /Not supplied \(L\)/);
  assert.match(tile.textContent, /0 mi/);
  assert.match(tile.textContent, /The exact number of seats needs confirmation/);
  assert.equal(tile.querySelector('[data-action-id="reserve"]').disabled, true);
  assert.ok([...tile.querySelectorAll('[data-action-id]')].every((control) => control.disabled));
  assert.throws(() => matchCard(null, { view: { members: [] } }), /exact members/);
});

test('representative media caption and alt disappear on broken images and never transfer to absent imagery', () => {
  const view = fixture();
  const { media, showPhoto } = mediaWell(null, '', { view: view.members[0] });
  assert.equal(media.querySelector('img').alt, 'Representative BMW brand image');
  media.querySelector('img').dispatchEvent(new dom.window.Event('error'));
  assert.equal(media.querySelector('.vm-media-caption'), null);
  assert.equal(media.classList.contains('has-photo'), false);
  const replacement = { name: 'New exact car', caption: 'New representative caption' };
  showPhoto('/new.jpg', replacement);
  const stale = media.querySelector('img');
  showPhoto('/newer.jpg', replacement);
  stale.dispatchEvent(new dom.window.Event('error'));
  assert.equal(media.querySelector('.vm-media-caption').textContent, replacement.caption);
  assert.equal(media.classList.contains('has-photo'), true);
  showPhoto(null, {});
  assert.equal(media.querySelector('.vm-media-caption'), null);
  assert.equal(media.querySelector('.vm-card-line').textContent, '');
});

test('callback actions own effects, fixture input stays unchanged, and gallery Reserve gives its preview reason', () => {
  const view = fixture(); const original = structuredClone(view); let actionMember;
  const card = matchCard(null, { view, onAction: (action, member) => { actionMember = member; } });
  card.querySelector('[data-action-id="feedback"]').click();
  assert.equal(actionMember, view.members[0]);
  assert.deepEqual(view, original);
  const gallery = employeeDecisionExample();
  assert.match(gallery.textContent, /Reserving is not part of this preview/);
  assert.equal(gallery.querySelector('[data-action-id="reserve"]').disabled, true);
  assert.equal(gallery.querySelectorAll('.vm-status').length, 3);
  gallery.querySelector('[data-action-id="feedback"]').click();
  assert.match(gallery.querySelector('[role="status"]').textContent, /Nothing is saved or reserved/);
  gallery.querySelector('.vm-brief-undo').click();
  assert.match(gallery.querySelector('[role="status"]').textContent, /Local feedback undone/);
});

test('committed browser fixture equals actual FUCQ-29 decisions and canonical PolicyService provenance', async () => {
  assert.deepEqual(employeeCardFixture, await createSharedKitEmployeeFixture());
  assert.deepEqual(employeeCardFixture.members.map((member) => member.decision.gateStatus), ['eligible', 'ineligible', 'needs-confirmation']);
  for (const member of employeeCardFixture.members) {
    assert.equal(member.terms[0].provenance.version, employeeCardFixture.versions.policy);
    assert.ok(member.facts.every((row) => row.provenance.sourceRef));
  }
});

test('explicit shared paths and single gallery remain CSP-safe and own no HTTP or persistence', async () => {
  for (const path of ['ui.js', 'modes/result-card.js', 'modes/question-ui.js', 'modes/preview-feed.js', 'employee-card-fixture.js']) {
    const source = await readFile(new URL(`../../blocks/vehicle-matcher/${path}`, import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /\beval\s*\(|new\s+Function\b|\bset(?:Timeout|Interval)\s*\(\s*['"`]|\.setAttribute\(\s*['"]on[a-z]+['"]/);
    assert.doesNotMatch(code, /\bfetch\s*\(|\b(?:localStorage|sessionStorage|XMLHttpRequest)\b/);
  }
});

test('legacy question keys, arrays, defaults, visibility and callback order remain compatible', async () => {
  const { renderRangeSlider, renderOptionList, visibleQuestions, isVisible, formatSliderValue } = await import('../../blocks/vehicle-matcher/modes/question-ui.js');
  const answers = {}; const calls = [];
  const host = document.createElement('div');
  const q = { id: 'budget', min: 0, max: 100000, step: 1000, default: [20000, 40000], format: 'gbp', plusAtMax: true };
  renderRangeSlider(host, q, answers, { onChange: () => calls.push([...answers.budget]) });
  assert.deepEqual(answers.budget, [20000, 40000]);
  assert.deepEqual(calls, [], 'legacy initial commit does not emit onChange');
  const input = host.querySelector('input'); input.value = '25000'; input.dispatchEvent(new window.Event('input'));
  assert.deepEqual(calls, [[25000, 40000]]);
  assert.equal(formatSliderValue(100000, q), '£100,000+');
  assert.equal(formatSliderValue(25000, { format: 'int', unit: ' mi', max: 25000, plusAtMax: true }), '25,000 mi+');
  const options = [{ value: 'petrol', label: 'Petrol' }, { value: 'ev', label: 'Electric' }];
  const order = [];
  const single = renderOptionList({ id: 'fuel', options }, answers, {
    onChange: () => order.push(`change:${answers.fuel}`), onPick: () => order.push(`pick:${answers.fuel}`),
  });
  single.list.lastChild.click();
  assert.deepEqual(order, ['change:ev', 'pick:ev']);
  assert.equal(single.selected.has('ev'), true);
  const multi = renderOptionList({ id: 'fuel', multi: true, max: 1, options: [...options, { value: 'any', label: 'Any' }] }, { fuel: [] });
  multi.list.children[0].click(); multi.list.children[1].click();
  assert.deepEqual([...multi.selected], ['petrol']);
  multi.list.children[2].click(); assert.deepEqual([...multi.selected], ['any']);
  const questions = [{ id: 'fuel' }, { id: 'charging', conditional: true }, { id: 'doors', conditional: true }, { id: 'other', conditional: true }];
  assert.equal(isVisible(questions[1], { fuel: ['petrol'] }), false);
  assert.equal(isVisible(questions[1], {}), true);
  assert.equal(isVisible(questions[2], { bodyStyles: ['estate'] }), false);
  assert.deepEqual(visibleQuestions(questions, { fuel: ['petrol'], bodyStyles: ['estate'] }).map((entry) => entry.id), ['fuel', 'other']);
  assert.deepEqual(visibleQuestions(questions, { show: 'doors' }, { predicate: (entry, draft) => entry.id === draft.show }).map((entry) => entry.id), ['doors']);
});

test('callback-owned scalar, dual and option controls preserve input state and emit only explicit changes', async () => {
  const { renderRangeSlider, renderOptionList } = await import('../../blocks/vehicle-matcher/modes/question-ui.js');
  const state = Object.freeze({ weight: 33, nested: Object.freeze({ value: 'estate' }) });
  const host = document.createElement('div'); const received = [];
  renderRangeSlider(host, { id: 'weight', min: 0, max: 100, step: 1 }, state, {
    single: true, value: 0, ariaLabel: 'Body importance', unit: { kind: 'percent' }, onValueChange: (value) => received.push(value),
  });
  const input = host.querySelector('input');
  assert.equal(input.getAttribute('aria-label'), 'Body importance');
  assert.equal(input.getAttribute('aria-valuetext'), '0%');
  assert.deepEqual(received, []);
  input.value = '70'; input.dispatchEvent(new window.Event('input'));
  assert.deepEqual(received, [70]); assert.equal(state.weight, 33);
  const dual = document.createElement('div'); const pairs = [];
  renderRangeSlider(dual, { id: 'cost', min: 0, max: 2000, step: 10 }, state, {
    value: [1000, 1500], unit: { kind: 'points-monthly' }, onValueChange: (value) => pairs.push(value),
  });
  dual.querySelector('input').value = '1100'; dual.querySelector('input').dispatchEvent(new window.Event('input'));
  assert.deepEqual(pairs, [[1100, 1500]]);
  const chosen = []; const values = Object.freeze(['estate']);
  const options = renderOptionList({ id: 'body', multi: true, options: [{ value: 'estate', label: 'Estate' }, { value: 'saloon', label: 'Saloon' }] }, state, {
    value: values, onValueChange: (next) => chosen.push(next),
  });
  options.list.lastChild.click(); assert.deepEqual(chosen, [['estate', 'saloon']]); assert.deepEqual(values, ['estate']);
});

test('typed control units and unknown/unconfirmed/zero states stay distinct with native disabled behavior', async () => {
  const { formatSliderValue, renderRangeSlider } = await import('../../blocks/vehicle-matcher/modes/question-ui.js');
  assert.equal(formatSliderValue(1300, {}, { unit: { kind: 'points-monthly' } }), '1,300 points a month');
  assert.equal(formatSliderValue(30000, {}, { unit: { kind: 'purchase-money', currency: 'GBP' } }), '£30,000');
  assert.equal(formatSliderValue(30000, { format: 'gbp' }, { unit: { kind: 'points-monthly' } }), 'Unit not supplied');
  assert.equal(formatSliderValue(null, {}, { unit: { kind: 'percent' } }), 'Not supplied');
  assert.equal(formatSliderValue(0, {}, { unit: { kind: 'percent' } }), '0%');
  assert.equal(formatSliderValue(50, {}, { unit: { kind: 'percent' }, valueState: 'unconfirmed' }), 'Not confirmed (50%)');
  const host = document.createElement('div'); let calls = 0;
  renderRangeSlider(host, { id: 'preference', min: 0, max: 100, step: 1, default: 50 }, null, {
    single: true, value: null, disabled: true, onValueChange: () => { calls += 1; },
  });
  assert.equal(host.querySelector('output').textContent, 'Not supplied');
  const input = host.querySelector('input'); assert.equal(input.disabled, true);
  input.dispatchEvent(new window.Event('input')); assert.equal(calls, 0);
  for (const valueState of ['unknown', 'unconfirmed']) {
    const control = document.createElement('div');
    renderRangeSlider(control, { id: 'importance', min: 0, max: 100, step: 1 }, null, {
      single: true, value: 50, valueState, unit: { kind: 'percent' },
    });
    assert.equal(control.querySelector('.vm-slider-min').textContent, '0%');
    assert.equal(control.querySelector('.vm-slider-max').textContent, '100%');
    assert.equal(control.querySelector('output').textContent, valueState === 'unknown' ? 'Not supplied' : 'Not confirmed (50%)');
    assert.equal(control.querySelector('input').getAttribute('aria-valuetext'), control.querySelector('output').textContent);
  }
});

const flushPreview = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const pendingPreview = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('injected preview owns loading and deep-snapshots drafts without retail transport or caller mutation', async (t) => {
  const { createPreviewFeed, PREVIEW_DEBOUNCE_MS } = await import('../../blocks/vehicle-matcher/modes/preview-feed.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', () => assert.fail('injected preview must not use retail HTTP'));
  const draft = { preferences: { body: { value: 'estate' } }, essentials: ['seats'] }; let dispatched;
  const pending = pendingPreview(); const received = [];
  const feed = createPreviewFeed({ load: (snapshot) => { dispatched = snapshot; return pending.promise; } });
  feed.schedule(draft, (value) => received.push(value));
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS - 1); assert.equal(dispatched, undefined);
  t.mock.timers.tick(1); draft.preferences.body.value = 'saloon'; draft.essentials.push('boot');
  assert.deepEqual(dispatched, { preferences: { body: { value: 'estate' } }, essentials: ['seats'] });
  pending.resolve({ custom: 'display value' }); await flushPreview();
  assert.deepEqual(received, [{ custom: 'display value' }]);
});

test('injected previews suppress stale success/failure, cancel and stay independent with sync and async loaders', async (t) => {
  const { createPreviewFeed, PREVIEW_DEBOUNCE_MS } = await import('../../blocks/vehicle-matcher/modes/preview-feed.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests = []; const received = []; const errors = [];
  const feed = createPreviewFeed({ load: () => { const request = pendingPreview(); requests.push(request); return request.promise; }, onError: (error) => errors.push(error.message) });
  feed.schedule({}, (value) => received.push(value)); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS);
  feed.schedule({}, (value) => received.push(value)); requests[0].resolve('old'); await flushPreview(); assert.deepEqual(received, []);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); feed.schedule({}, (value) => received.push(value)); requests[1].reject(Error('old failure')); await flushPreview(); assert.deepEqual(errors, []);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); feed.cancel(); requests[2].reject(Error('cancelled failure')); await flushPreview(); assert.deepEqual(errors, []);
  feed.schedule({}, (value) => received.push(value)); feed.cancel(); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); assert.equal(requests.length, 3);
  const other = createPreviewFeed({ load: (draft) => draft.name });
  other.schedule({ name: 'independent' }, (value) => received.push(value)); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await flushPreview();
  assert.deepEqual(received, ['independent']);
  feed.schedule({}, (value) => received.push(value)); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); requests[3].reject(Error('current failure')); await flushPreview();
  assert.deepEqual(errors, ['current failure']); assert.deepEqual(received, ['independent']);
  const throws = createPreviewFeed({ load: () => { throw Error('sync failure'); } });
  throws.schedule({}, (value) => received.push(value)); t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await flushPreview();
  assert.deepEqual(received, ['independent', []]);
});

test('gallery separates position, importance and explicit indifference; injected preview is an unchanged snapshot', async (t) => {
  const { employeeControlsExample } = await import('../../blocks/vehicle-matcher/component-gallery.js');
  const { PREVIEW_DEBOUNCE_MS } = await import('../../blocks/vehicle-matcher/modes/preview-feed.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', () => assert.fail('gallery controls have no network owner'));
  const section = employeeControlsExample(); document.body.append(section);
  const [position, importance] = section.querySelectorAll('input[type=range]');
  assert.notEqual(position.getAttribute('aria-label'), importance.getAttribute('aria-label'));
  importance.value = '0'; importance.dispatchEvent(new window.Event('input'));
  assert.match(section.querySelector('[role=status]').textContent, /importance 0%; preference considered/);
  const indifferent = section.querySelectorAll('[role=radio]')[1]; indifferent.focus(); indifferent.click();
  assert.equal(document.activeElement, indifferent); assert.equal(position.disabled, true); assert.equal(importance.disabled, true);
  assert.match(section.querySelector('[role=status]').textContent, /explicitly indifferent/);
  section.querySelector('[role=radio]').click(); assert.equal(position.disabled, false); assert.equal(importance.value, '0');
  [...section.querySelectorAll('button')].find((node) => node.textContent === 'Load unchanged display snapshot').click();
  assert.match(section.textContent, /Loading display snapshot/);
  t.mock.timers.tick(PREVIEW_DEBOUNCE_MS); await flushPreview();
  assert.ok(section.querySelector('.vm-gallery-injected-preview .vm-card-explicit'));
  assert.match(section.textContent, /These controls have not recalculated this result/);
});


test('manual gallery examples retain separate exact cards and cannot claim synthetic display stock', () => {
  const section = manualGalleryExample(); document.body.append(section);
  const cards = [...section.querySelectorAll('.vm-card')];
  assert.ok(cards.length >= 3, 'eligible, ineligible and long-name examples remain discoverable');
  assert.equal(new Set(cards.map((card) => card.dataset.memberId)).size, cards.length);
  const actions = [...section.querySelectorAll('[data-action-id="review-car"]')];
  assert.equal(actions.length, cards.length);
  assert.ok(actions.every((action) => action.disabled));
  assert.ok([...section.querySelectorAll('.vm-score')].every((score) => score.hidden));
  assert.ok(section.querySelector('a[href="./gcsp-manual-gallery.html?fixture=available"]'));
});
