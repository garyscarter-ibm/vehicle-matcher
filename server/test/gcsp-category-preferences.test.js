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
