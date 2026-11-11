import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let categoryPreferences; let preferenceCategories; let checkboxField; let categoryPreferencesExample;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'CustomEvent']) {
    Object.defineProperty(globalThis, name, { value: name === 'window' ? dom.window : dom.window[name], configurable: true, writable: true });
  }
  ({ categoryPreferences, preferenceCategories } = await import('../../blocks/gcsp/kit/category-preferences.js'));
  CATEGORIES = preferenceCategories(SERVER);
  ({ checkboxField } = await import('../../blocks/gcsp/kit/form-controls.js'));
  ({ categoryPreferencesExample } = await import('../../blocks/gcsp/kit/form-controls-gallery.js'));
});
after(() => dom.window.close());
beforeEach(() => document.body.replaceChildren());

const opts = (...p) => p.map(([value, label]) => ({ value, label }));
const SERVER = { order: ['body', 'fuel', 'comfort'], categories: {
  body: { label: 'Body', question: 'Which body styles feel right?', kind: 'multi', options: opts(['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Touring / Estate']) },
  fuel: { label: 'Fuel', question: 'What would you like to drive?', kind: 'multi', options: opts(['petrol', 'Petrol'], ['diesel', 'Diesel']) },
  comfort: { label: 'Comfort', question: 'How much comfort would you like?', kind: 'stops', openDefault: 50,
    stops: [{ value: 0, label: 'Simple and functional' }, { value: 50, label: 'A bit of both' }, { value: 100, label: 'As comfortable as possible' }] } } };
let CATEGORIES;
const base = (extra = {}) => ({ categories: {}, open: null, pendingRemoval: null, disabled: false, status: { kind: 'idle', text: '' }, ...extra });
function mount(state = base()) {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  const view = categoryPreferences({ id: 'p', categories: CATEGORIES, state, onOpen: rec('open'), onChange: rec('change'), onRemove: rec('remove'),
    onConfirmRemove: rec('confirm'), onKeep: rec('keep'), onClose: rec('close'), onStatusAction: rec('action') });
  document.body.append(view.root); return { view, calls };
}
const tile = (key) => document.getElementById(`p-tile-${key}`);
const click = (node) => node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

test('preferenceCategories orders the server projection', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.key), ['body', 'fuel', 'comfort']);
  assert.equal(CATEGORIES[2].kind, 'stops');
});

test('tiles show label and Choose, with the section head, slots and no bin', () => {
  const { view } = mount();
  assert.equal(view.root.querySelector('h2').textContent, 'Your preferences');
  assert.match(view.root.textContent, /Choose at least 3 categories\. Tell your buddy what matters\./);
  assert.deepEqual([...view.root.querySelectorAll('.gcsp-prefs-value')].map((n) => n.textContent), ['Choose', 'Choose', 'Choose']);
  assert.equal(tile('body').getAttribute('aria-label'), 'Body, choose a preference');
  assert.equal(view.root.querySelectorAll('.gcsp-prefs-remove:not([hidden])').length, 0);
  for (const slot of ['understanding', 'mode', 'action']) assert.equal(view.root.querySelector(`[data-slot="${slot}"]`).children.length, 0);
});

test('considered and high tiles: choices, classes, accessible names and bin', () => {
  const { view } = mount(base({ categories: { body: { state: 'considered', value: ['hatchback', 'estate'], importance: 'high' },
    comfort: { state: 'considered', value: 100, importance: 'medium' } } }));
  assert.equal(tile('body').querySelector('.gcsp-prefs-value').textContent, 'Hatchback, Touring / Estate');
  assert.equal(tile('body').getAttribute('aria-label'), 'Body, considered: Hatchback, Touring / Estate, really important');
  assert.equal(tile('comfort').getAttribute('aria-label'), 'Comfort, considered: As comfortable as possible');
  const [body, fuel, comfort] = [...view.root.querySelectorAll('.gcsp-prefs-tile')];
  assert.ok(body.classList.contains('is-considered') && body.classList.contains('is-important'));
  assert.ok(comfort.classList.contains('is-considered') && !comfort.classList.contains('is-important'));
  assert.ok(!fuel.classList.contains('is-considered'));
  assert.equal(fuel.querySelector('.gcsp-prefs-remove').hidden, true);
  assert.equal(body.querySelector('.gcsp-prefs-remove').getAttribute('aria-label'), 'Remove Body preference');
});

test('opening shows only that category panel, sets aria-expanded and emits intents', () => {
  const { view, calls } = mount();
  click(tile('body')); assert.deepEqual(calls.at(-1), ['open', 'body']);
  view.update(base({ open: 'body' }));
  assert.equal(tile('body').getAttribute('aria-expanded'), 'true'); assert.equal(tile('fuel').getAttribute('aria-expanded'), 'false');
  assert.equal(tile('body').getAttribute('aria-controls'), 'p-panel');
  const panel = document.getElementById('p-panel'); assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('h3').textContent, 'Which body styles feel right?');
  assert.deepEqual([...panel.querySelectorAll('.vm-option')].map((n) => n.textContent), ['Hatchback', 'Saloon', 'Touring / Estate']);
  view.update(base({ open: null })); assert.equal(panel.hidden, true);
});

test('multi selection emits values in option order', () => {
  const { view, calls } = mount(base({ open: 'body' }));
  const [hatch, , estate] = [...view.root.querySelectorAll('.vm-option')];
  click(estate); click(hatch);
  assert.deepEqual(calls.filter((c) => c[0] === 'change').map((c) => c[2]), [{ value: ['estate'] }, { value: ['hatchback', 'estate'] }]);
});

test('slider emits stop values and speaks qualitative text', () => {
  const { view, calls } = mount(base({ open: 'comfort' }));
  const input = view.root.querySelector('input[type="range"]');
  assert.equal(input.max, '100'); assert.equal(input.step, '50');
  assert.equal(input.getAttribute('aria-valuetext'), 'A bit of both');
  input.value = '100'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(calls.at(-1), ['change', 'comfort', { value: 100 }]);
  assert.equal(input.getAttribute('aria-valuetext'), 'As comfortable as possible');
  assert.equal(view.root.querySelector('.vm-slider-value').hidden, true);
  assert.deepEqual([...view.root.querySelectorAll('.gcsp-prefs-stops span')].map((n) => n.textContent), ['Simple and functional', 'A bit of both', 'As comfortable as possible']);
});

test('importance switch: disabled with a hint when unset, then medium and high', () => {
  const { view, calls } = mount(base({ open: 'fuel' }));
  const sw = () => view.root.querySelector('[role="switch"]'); const hint = () => view.root.querySelector('.gcsp-prefs-hint');
  assert.equal(sw().disabled, true); assert.equal(sw().checked, false);
  assert.equal(hint().textContent, 'Choose a preference first.'); assert.equal(hint().hidden, false);
  assert.equal(sw().getAttribute('aria-describedby'), hint().id);
  view.update(base({ open: 'fuel', categories: { fuel: { state: 'considered', value: ['petrol'], importance: 'medium' } } }));
  assert.equal(sw().disabled, false); assert.equal(sw().checked, false); assert.equal(hint().hidden, true);
  assert.equal(sw().hasAttribute('aria-describedby'), false);
  sw().checked = true; sw().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(calls.at(-1), ['change', 'fuel', { importance: 'high' }]);
  view.update(base({ open: 'fuel', categories: { fuel: { state: 'considered', value: ['petrol'], importance: 'high' } } }));
  assert.equal(sw().checked, true); assert.ok(sw().parentElement.classList.contains('is-important'));
  assert.ok(document.getElementById('p-panel').classList.contains('is-important'));
  sw().checked = false; sw().dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(calls.at(-1), ['change', 'fuel', { importance: 'medium' }]);
});

test('Done emits onClose and returns focus to the tile', () => {
  const { view, calls } = mount(base({ open: 'body' }));
  click([...view.root.querySelectorAll('.gcsp-prefs-heading button')][0]);
  assert.deepEqual(calls.at(-1), ['close']); assert.equal(document.activeElement, tile('body'));
});

test('removal: bin emits, confirmation is a labelled group, Keep it and Remove emit and focus', () => {
  const { view, calls } = mount(base({ categories: { comfort: { state: 'considered', value: 100, importance: 'medium' } } }));
  click(view.root.querySelectorAll('.gcsp-prefs-remove')[2]); assert.deepEqual(calls.at(-1), ['remove', 'comfort']);
  view.update(base({ pendingRemoval: 'comfort', categories: { comfort: { state: 'considered', value: 100, importance: 'medium' } } }));
  const group = view.root.querySelector('[role="group"].gcsp-prefs-removal');
  assert.equal(group.hidden, false);
  assert.equal(document.getElementById(group.getAttribute('aria-labelledby')).textContent, 'Remove your comfort preference?');
  const [keep, remove] = group.querySelectorAll('button');
  assert.deepEqual([keep.textContent, remove.textContent], ['Keep it', 'Remove preference']);
  assert.equal(document.activeElement, keep);
  click(remove); assert.deepEqual(calls.at(-1), ['confirm', 'comfort']);
  click(keep); assert.deepEqual(calls.at(-1), ['keep', 'comfort']);
  assert.equal(document.activeElement, view.root.querySelectorAll('.gcsp-prefs-remove')[2]);
  view.focusCategory('comfort'); assert.equal(document.activeElement, tile('comfort'));
});

test('update with the same open category keeps the same nodes and focus', () => {
  const { view } = mount(base({ open: 'body' }));
  const option = view.root.querySelector('.vm-option'); option.focus(); const list = view.root.querySelector('.vm-options');
  view.update(base({ open: 'body', categories: { body: { state: 'considered', value: ['hatchback'], importance: 'medium' } } }));
  assert.equal(view.root.querySelector('.vm-option'), option); assert.equal(view.root.querySelector('.vm-options'), list);
  assert.equal(document.activeElement, option);
  assert.ok(option.classList.contains('is-selected'));
  view.update(base({ open: 'fuel' })); assert.notEqual(view.root.querySelector('.vm-option'), option);
});

test('disabled state disables tiles, bins, options and the switch', () => {
  const { view } = mount(base({ open: 'body', disabled: true, categories: { body: { state: 'considered', value: ['hatchback'], importance: 'medium' } } }));
  assert.ok(view.root.classList.contains('is-disabled'));
  assert.ok([...view.root.querySelectorAll('.gcsp-prefs-open, .gcsp-prefs-remove, .vm-option, [role="switch"]')].every((n) => n.disabled));
});

test('status line: polite role, kinds, and one action button for failures', () => {
  const { view, calls } = mount();
  const status = view.root.querySelector('[role="status"]'); assert.equal(status.getAttribute('role'), 'status');
  view.update(base({ status: { kind: 'saved', text: 'Preferences saved automatically.' } }));
  assert.equal(status.textContent, 'Preferences saved automatically.'); assert.ok(status.classList.contains('is-saved'));
  assert.equal(view.root.querySelectorAll('.gcsp-prefs-statusline button').length, 0);
  let retried = 0;
  view.update(base({ status: { kind: 'failed', text: 'Your changes were not saved.', actionLabel: 'Try again', onAction: () => { retried += 1; } } }));
  assert.ok(status.classList.contains('is-failed'));
  const buttons = view.root.querySelectorAll('.gcsp-prefs-statusline button'); assert.equal(buttons.length, 1);
  click(buttons[0]); assert.equal(retried, 1);
  view.update(base({ status: { kind: 'stale', text: 'Preferences changed elsewhere.', actionLabel: 'Reload preferences' } }));
  assert.equal(view.root.querySelectorAll('.gcsp-prefs-statusline button').length, 1);
  click(view.root.querySelector('.gcsp-prefs-statusline button')); assert.deepEqual(calls.at(-1), ['action', 'stale']);
  view.update(base({ status: { kind: 'pending', text: 'Saving' } })); assert.equal(view.root.querySelectorAll('.gcsp-prefs-statusline button').length, 0);
});

test('checkboxField output is unchanged without the new options, and switch adds role and class', () => {
  const plain = checkboxField({ id: 'a', label: 'Tick' });
  assert.equal(plain.root.outerHTML, '<div class="gcsp-check"><input type="checkbox" id="a"><label for="a">Tick</label></div>');
  const sw = checkboxField({ id: 'b', label: 'Flip', switch: true, disabled: true, describedBy: 'note' });
  assert.equal(sw.root.className, 'gcsp-check gcsp-switch'); assert.equal(sw.input.getAttribute('role'), 'switch');
  assert.equal(sw.input.disabled, true); assert.equal(sw.input.getAttribute('aria-describedby'), 'note');
  assert.equal(sw.root.firstElementChild.tagName, 'LABEL');
});

test('gallery example mounts every state without errors', () => {
  const section = categoryPreferencesExample(); document.body.append(section);
  assert.equal(section.querySelectorAll('.gcsp-prefs').length, 8);
  assert.ok(section.querySelector('.gcsp-prefs-removal:not([hidden])'));
  assert.ok(!/—/.test(section.textContent));
});

const SAME_TEXT = 'Select this option if you just love everything about your current car, and your next best car would be another BMW 3 Series Touring 320i';
function mountSame(state = {}, extra = {}) {
  const toggles = [];
  const view = categoryPreferences({ id: 'p', categories: CATEGORIES, understanding: { maximum: 11 }, sameAgain: { description: 'BMW 3 Series Touring 320i', onToggle: (on) => toggles.push(on) },
    state: base({ understanding: { value: 1, maximum: 11, pending: false }, sameAgain: { on: false, available: true }, ...state }), ...extra });
  document.body.append(view.root); return { view, toggles };
}
const key = (node, name) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true }));
const considered = (value, importance = 'medium') => ({ state: 'considered', value, importance });
const chosen = { body: considered(['estate'], 'high'), fuel: considered(['petrol']), comfort: considered(100) };

test('without the new options the slots stay empty and no meter or mode row is built', () => {
  const { view } = mount();
  assert.equal(view.root.querySelector('.gcsp-understanding'), null); assert.equal(view.root.querySelector('.gcsp-help-tip'), null);
  assert.equal(view.root.querySelector('[data-slot="mode"]').children.length, 0);
  view.update(base({ understanding: { value: 5, maximum: 11 }, sameAgain: { on: true } }));
  assert.equal(view.root.querySelector('.gcsp-understanding'), null); assert.ok(!view.root.classList.contains('is-same-again'));
});

test('meter in the head slot follows state.understanding, including pending', () => {
  const { view } = mountSame({ understanding: { value: 6, maximum: 11, pending: false } });
  const slot = view.root.querySelector('[data-slot="understanding"]');
  const value = slot.querySelector('.gcsp-understanding-value');
  assert.equal(value.textContent, '6 / 11'); assert.equal(value.getAttribute('aria-label'), 'Buddy understanding 6 out of 11');
  view.update(base({ understanding: { value: 11, maximum: 11, pending: true }, sameAgain: { on: true, available: true } }));
  assert.equal(value.textContent, '11 / 11'); assert.match(value.getAttribute('aria-label'), /\(saving\)$/);
});

test('mode row sits between head and tiles: label, info button, switch', () => {
  const { view } = mountSame();
  const kids = [...view.root.children].map((n) => n.className);
  assert.deepEqual(kids.slice(0, 3), ['gcsp-prefs-head', 'gcsp-prefs-mode', 'gcsp-prefs-tiles']);
  const row = view.root.querySelector('[data-slot="mode"]');
  const parts = [...row.querySelector('.gcsp-switch').children];
  assert.equal(parts[0].tagName, 'LABEL'); assert.equal(parts[0].textContent, 'Same again, please!');
  assert.equal(parts[1].getAttribute('aria-label'), 'About Same again, please!'); assert.equal(parts[1].tagName, 'BUTTON');
  assert.equal(parts[1].querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(parts[2].getAttribute('role'), 'switch'); assert.equal(parts[2].id, 'p-same-again');
});

test('the switch is controlled: Space-style change calls onToggle and nothing else changes', () => {
  const { view, toggles } = mountSame({ categories: chosen });
  const input = document.getElementById('p-same-again');
  input.checked = true; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(toggles, [true]);
  assert.ok(!view.root.classList.contains('is-same-again')); assert.ok(tile('body').closest('.gcsp-prefs-tile').classList.contains('is-important'));
  view.update(base({ categories: chosen, sameAgain: { on: true, available: true } })); assert.equal(input.checked, true);
  input.checked = false; input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); assert.deepEqual(toggles, [true, false]);
  click(input); assert.equal(toggles.length, 3);
});

test('help tip: exact text, described-by, hover, focus, tap, Escape and outside press', () => {
  const { view } = mountSame();
  const tip = view.root.querySelector('.gcsp-help-tip'); const info = view.root.querySelector('.gcsp-prefs-info'); const input = document.getElementById('p-same-again');
  assert.equal(tip.textContent, SAME_TEXT); assert.equal(tip.getAttribute('role'), 'tooltip'); assert.equal(tip.hidden, true);
  assert.equal(tip.parentElement, input.parentElement); assert.ok(tip.classList.contains('gcsp-help-tip-below-start'));
  assert.ok(input.getAttribute('aria-describedby').split(' ').includes(tip.id)); assert.ok(info.getAttribute('aria-describedby').split(' ').includes(tip.id));
  info.dispatchEvent(new dom.window.Event('pointerenter')); assert.equal(tip.hidden, false);
  key(info, 'Escape'); assert.equal(tip.hidden, true);
  info.dispatchEvent(new dom.window.Event('pointerleave', { bubbles: false })); tip.parentElement.dispatchEvent(new dom.window.Event('pointerleave'));
  click(info); assert.equal(tip.hidden, false);
  document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); assert.equal(tip.hidden, true);
  view.destroy();
  const again = mountSame().view; const next = again.root.querySelector('.gcsp-prefs-info');
  next.focus(); assert.equal(again.root.querySelector('.gcsp-help-tip').hidden, false);
});

test('Same again on: tiles neutral, controls disabled, panel and removal hidden, choices and names kept', () => {
  const { view } = mountSame({ categories: chosen, open: 'body', pendingRemoval: 'fuel', understanding: { value: 11, maximum: 11 }, sameAgain: { on: true, available: true } });
  assert.ok(view.root.classList.contains('is-same-again'));
  assert.equal(document.getElementById('p-panel').hidden, true); assert.equal(view.root.querySelector('.gcsp-prefs-removal').hidden, true);
  for (const node of view.root.querySelectorAll('.gcsp-prefs-tile')) {
    assert.ok(!node.classList.contains('is-important') && !node.classList.contains('is-open'));
    assert.equal(node.querySelector('.gcsp-prefs-open').disabled, true); assert.equal(node.querySelector('.gcsp-prefs-remove').disabled, true);
  }
  assert.equal(tile('body').querySelector('.gcsp-prefs-value').textContent, 'Touring / Estate');
  assert.equal(tile('body').getAttribute('aria-label'), 'Body, considered: Touring / Estate, kept while Same again is on');
  assert.equal(tile('body').getAttribute('aria-expanded'), 'false');
  assert.equal(tile('comfort').getAttribute('aria-label'), 'Comfort, considered: As comfortable as possible, kept while Same again is on');
  assert.equal(document.getElementById('p-same-again').checked, true); assert.equal(document.getElementById('p-same-again').disabled, false);
});

test('turning Same again off restores colours, names and the open panel', () => {
  const { view } = mountSame({ categories: chosen, open: 'body', sameAgain: { on: true, available: true } });
  view.update(base({ categories: chosen, open: 'body', sameAgain: { on: false, available: true } }));
  assert.ok(!view.root.classList.contains('is-same-again'));
  assert.ok(tile('body').closest('.gcsp-prefs-tile').classList.contains('is-important')); assert.ok(tile('fuel').closest('.gcsp-prefs-tile').classList.contains('is-considered'));
  assert.equal(tile('body').getAttribute('aria-label'), 'Body, considered: Touring / Estate, really important');
  assert.equal(document.getElementById('p-panel').hidden, false); assert.equal(tile('body').disabled, false);
});

test('unavailable: switch disabled and unchecked with a reason, tiles still usable', () => {
  const { view, calls } = (() => { const m = mountSame({ categories: chosen, sameAgain: { on: true, available: false, reason: 'no-current-car' } }); return { view: m.view, calls: [] }; })();
  const input = document.getElementById('p-same-again'); const note = view.root.querySelector('.gcsp-prefs-same-note');
  assert.equal(input.disabled, true); assert.equal(input.checked, false); assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Add your current car to use this.'); assert.ok(input.getAttribute('aria-describedby').split(' ').includes(note.id));
  assert.ok(!view.root.classList.contains('is-same-again')); assert.equal(tile('body').disabled, false);
  view.update(base({ categories: chosen, open: 'body', sameAgain: { on: false, available: false, reason: 'current-car-unidentified' } }));
  assert.equal(note.textContent, 'Your current car details are incomplete.'); assert.equal(document.getElementById('p-panel').hidden, false);
  view.update(base({ categories: chosen, sameAgain: { on: false, available: true } })); assert.equal(note.hidden, true); assert.equal(input.disabled, false);
  assert.ok(!/—/.test(view.root.textContent)); assert.equal(calls.length, 0);
});

test('state.disabled also disables the Same again switch', () => {
  const { view } = mountSame({ disabled: true });
  assert.equal(document.getElementById('p-same-again').disabled, true); assert.ok(view.root.classList.contains('is-disabled'));
});

test('gallery Same again example mounts meter at 1, 6, 11 and every row state', async () => {
  const { sameAgainExample } = await import('../../blocks/gcsp/kit/form-controls-gallery.js');
  const section = sameAgainExample(); document.body.append(section);
  const values = [...section.querySelectorAll('.gcsp-understanding-value')].map((n) => n.textContent);
  for (const wanted of ['1 / 11', '6 / 11', '11 / 11']) assert.ok(values.includes(wanted), wanted);
  assert.equal(section.querySelectorAll('.gcsp-prefs.is-same-again').length, 1);
  assert.equal(section.querySelectorAll('.gcsp-prefs-same-note:not([hidden])').length, 1);
  assert.equal(section.querySelectorAll('.gcsp-help-tip:not([hidden])').length, 1);
  assert.ok(!/—/.test(section.textContent));
});
