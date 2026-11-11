import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { accountFixture } from '../../blocks/gcsp/account/fixtures.js';
import { PREFERENCE_FIXTURE_STATES, previewPreferenceTransport, drivePreferenceState } from '../../blocks/gcsp/brief/account-preferences-fixtures.js';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'https://account.test/', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements', 'DOMException']) {
  Object.defineProperty(globalThis, name, { value: name === 'window' ? window : window[name], configurable: true, writable: true });
}
const { mountAccount } = await import('../../blocks/gcsp/account/gcsp-account.js');
const { mountAccountPreferences } = await import('../../blocks/gcsp/brief/account-preferences.js');
const tick = () => new Promise((done) => setTimeout(done, 0));
const adapter = () => ({ readAccount: async () => accountFixture('ready'), readDraft: async () => ({ status: 'not-found' }), startJourney: async () => ({ status: 'unavailable' }) });
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tile = (root, key) => root.querySelector(`[id$="-tile-${key}"]`);
const statusText = (root) => root.querySelector('.gcsp-prefs-status')?.textContent;

async function mount(state = 'empty', wrap = (t) => t) {
  const host = document.createElement('div'); document.body.append(host);
  const transport = wrap(previewPreferenceTransport(state)); const calls = [];
  const spy = { loadEditor: (...a) => transport.loadEditor(...a), savePreferences: (input) => { calls.push(structuredClone(input)); return transport.savePreferences(input); } };
  let mounted;
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal }) => { mounted = mountAccountPreferences(region, { transport: spy, signal }); return mounted; } });
  await tick(); await mounted.ready; await tick();
  return { host, destroy, calls, controller: mounted.controller };
}

test('the capability sits in Account between Your cars and Order history, and shows loading, then the tiles', async () => {
  const host = document.createElement('div'); document.body.append(host);
  let release; const gate = new Promise((r) => { release = r; }); const inner = previewPreferenceTransport('selected'); let mounted;
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal }) => {
    mounted = mountAccountPreferences(region, { signal, transport: { loadEditor: async () => { await gate; return inner.loadEditor(); }, savePreferences: inner.savePreferences } });
    return mounted;
  } });
  await tick();
  const region = host.querySelector('.gcsp-account-preferences');
  assert.equal(region.querySelector('.gcsp-skeleton [role=status]').textContent, 'Loading your preferences.');
  release(); await mounted.ready; await tick();
  const after = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(after(host.querySelector('.gcsp-feature'), region) && after(region, host.querySelector('.gcsp-account-history')));
  assert.equal(region.querySelectorAll('.gcsp-prefs-tile').length, 6);
  assert.match(tile(region, 'body').getAttribute('aria-label'), /Body, considered: Touring \/ Estate/);
  assert.equal(statusText(region), '3 categories considered · Saved automatically');
  destroy(); host.remove();
});

test('a quiet Account re-render keeps the open panel, the focused control and the status', async () => {
  const { host, destroy, controller } = await mount('selected');
  click(tile(host, 'body')); await tick();
  const region = host.querySelector('.gcsp-account-preferences'); const panel = region.querySelector('.gcsp-prefs-panel');
  assert.equal(panel.hidden, false);
  const option = [...panel.querySelectorAll('.vm-option')].find((node) => node.textContent === 'SUV'); option.focus(); click(option);
  await tick(); await tick();
  assert.equal(statusText(region), 'Preferences saved automatically.');
  await destroy.sync(); await tick();
  assert.equal(host.querySelector('.gcsp-account-preferences'), region, 'the same region node survives Account redraws');
  assert.equal(region.querySelector('.gcsp-prefs-panel'), panel); assert.equal(document.activeElement, option);
  assert.equal(statusText(region), 'Preferences saved automatically.');
  assert.equal(controller.snapshot().open, 'body');
  destroy(); host.remove();
});

test('each outcome is announced once: pending then saved, and a failure with its retry', async () => {
  let fail = true;
  const { host, destroy, calls } = await mount('selected', (t) => ({ loadEditor: t.loadEditor, savePreferences: (input) => (fail ? { status: 'unavailable', retryable: true } : t.savePreferences(input)) }));
  const region = host.querySelector('.gcsp-account-preferences'); const seen = [];
  new window.MutationObserver(() => seen.push(statusText(region))).observe(region.querySelector('.gcsp-prefs-status'), { childList: true, characterData: true, subtree: true });
  click(tile(host, 'size')); await tick(); await tick();
  assert.equal(statusText(region), 'Your size change was not saved.');
  const retry = [...region.querySelectorAll('button')].find((node) => node.textContent === 'Try again');
  fail = false; retry.focus(); click(retry); await tick(); await tick(); await tick();
  assert.equal(calls.length, 2); assert.equal(calls[1].commandId, calls[0].commandId, 'the retry reuses the command');
  assert.equal(statusText(region), 'Preferences saved automatically.');
  assert.deepEqual(seen.filter((text, at) => text !== seen[at - 1]), ['Saving your preferences.', 'Your size change was not saved.', 'Saving your preferences.', 'Preferences saved automatically.']);
  assert.notEqual(document.activeElement, document.body, 'focus does not fall to the page when the Try again button goes');
  destroy(); host.remove();
});

test('a failed load shows a short status with Try again, and teardown empties the region', async () => {
  let up = false; const inner = previewPreferenceTransport('selected');
  const host = document.createElement('div'); document.body.append(host); let mounted;
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal }) => { mounted = mountAccountPreferences(region, { signal,
    transport: { loadEditor: async () => (up ? inner.loadEditor() : { status: 'unavailable', retryable: true }), savePreferences: inner.savePreferences } }); return mounted; } });
  await tick(); await mounted.ready; await tick();
  const region = host.querySelector('.gcsp-account-preferences');
  assert.equal(region.querySelector('.gcsp-prefs-unavailable p').textContent, 'Your preferences could not be loaded.');
  assert.equal(region.querySelectorAll('.gcsp-prefs-tile').length, 0);
  up = true; click([...region.querySelectorAll('button')].find((node) => node.textContent === 'Try again')); await tick(); await tick();
  assert.equal(region.querySelectorAll('.gcsp-prefs-tile').length, 6);
  destroy(); assert.equal(region.childElementCount, 0); host.remove();
});

test('every named visual state mounts with its expected tiles, panel and status', async () => {
  const expected = { empty: [0, null], selected: [3, null], 'body-open-unset': [0, 'body'], 'body-open-medium': [3, 'body'], 'body-high': [3, 'body'],
    'comfort-midpoint': [3, 'comfort'], 'remove-comfort': [3, null], 'save-failed': [3, null], stale: [3, null], pending: [3, null], 'rating-failed': [3, null],
    'same-again': [3, null], 'same-again-high': [1, null], 'same-again-failed': [3, null], 'engage-pending': [3, null], 'engage-failed': [3, null], 'minimum-loss': [2, null], validation: [0, null], ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((n) => [`count-${n}`, [n, null]])) };
  for (const name of PREFERENCE_FIXTURE_STATES) {
    const host = document.createElement('div'); document.body.append(host); let mounted;
    const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal }) => {
      mounted = mountAccountPreferences(region, { signal, transport: previewPreferenceTransport(name) });
      mounted.ready.then(() => drivePreferenceState(mounted.controller, name)); return mounted;
    } });
    await tick(); await mounted.ready; await tick(); await tick(); await tick();
    const region = host.querySelector('.gcsp-account-preferences');
    assert.equal(region.querySelectorAll('.gcsp-prefs-tile.is-considered').length, expected[name][0], name);
    assert.equal(mounted.controller.snapshot().open, expected[name][1], name);
    if (name === 'save-failed') assert.equal(statusText(region), 'Your comfort change was not saved.');
    if (name === 'stale') assert.match(statusText(region), /Reload to see the latest/);
    if (name === 'remove-comfort') assert.equal(region.querySelector('.gcsp-prefs-removal').hidden, false);
    if (name === 'same-again-failed') assert.equal(statusText(region), 'Same again was not saved.');
    if (name.startsWith('same-again') && name !== 'same-again-failed') assert.equal(region.querySelector('.gcsp-prefs').classList.contains('is-same-again'), true, name);
    if (name === 'same-again') assert.equal(statusText(region), 'More like your current car. Preferences save automatically.');
    if (name === 'same-again-high') assert.equal(region.querySelector('.gcsp-prefs-tile.is-important'), null, 'retained high importance is shown neutral');
    if (/^count-/.test(name)) assert.equal(region.querySelector('.gcsp-understanding-value').textContent, `${[1, 3, 4, 6, 7, 9, 10][Number(name.slice(6))]} / 11`, name);
    if (name === 'body-high') assert.equal(region.querySelector('.gcsp-prefs-tile.is-important') !== null, true);
    destroy(); host.remove();
  }
});

// Current-car star rating on the bitmap (FUCQ-367 slice B).
const stars = (host) => [...host.querySelectorAll('.gcsp-star-rating')];
const radio = (host, n) => host.querySelector(`.gcsp-star-rating input[value="${n}"]`);
const HELP = 'How highly do you rate your BMW 3 Series Touring 320i M Sport Petrol?';

async function mountRated(state = 'selected', { fixture = 'ready', rating, wrap = (t) => t } = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const inner = wrap(previewPreferenceTransport(state, { rating })); const calls = []; let mounted;
  const spy = { loadEditor: () => inner.loadEditor(), savePreferences: (input) => { calls.push(structuredClone(input)); return inner.savePreferences(input); } };
  const destroy = mountAccount(host, { adapter: { ...adapter(), readAccount: async () => accountFixture(fixture) },
    preferences: (region, { signal, describeCar }) => { mounted = mountAccountPreferences(region, { transport: spy, signal, describeCar }); return mounted; } });
  await tick(); await mounted.ready; await tick();
  return { host, destroy, calls, controller: mounted.controller };
}

test('one rating mounts inside the current car image well with the heading and specification as its name and help', async () => {
  const { host, destroy } = await mountRated('selected', { rating: 4 });
  const found = stars(host); assert.equal(found.length, 1);
  assert.equal(found[0].closest('.vm-card-media')?.classList.contains('gcsp-media-whole'), true);
  assert.equal(found[0].closest('.gcsp-feature')?.dataset.contractId, 'current:employee-paula');
  const car = found[0].closest('.gcsp-feature'); const heading = car.querySelector('.gcsp-h2').textContent; const spec = car.querySelector('.gcsp-account-spec')?.textContent;
  const text = `How highly do you rate your ${[heading, spec].filter(Boolean).join(' ')}?`;
  assert.equal(found[0].querySelector('legend').textContent, text); assert.equal(found[0].querySelector('[role=tooltip]').textContent, text);
  assert.equal(radio(host, 4).checked, true);
  assert.equal(host.querySelectorAll('.gcsp-history .gcsp-star-rating, .gcsp-account-secondary .gcsp-star-rating').length, 0);
  assert.equal(found[0].querySelector('[role=status]'), null, 'the rating uses the Account live region, not its own');
  destroy(); host.remove();
});

test('selecting saves only the rating; clearing by the same star saves unset; Account announces once per outcome', async () => {
  const { host, destroy, calls } = await mountRated('selected');
  const live = [...host.querySelectorAll('[role=status].gcsp-vh')].filter((node) => !node.closest('.gcsp-account-preferences'));
  assert.equal(live.length, 1, 'one Account live region');
  radio(host, 3).click(); await tick(); await tick();
  assert.deepEqual(calls[0].changes, {}); assert.deepEqual(calls[0].currentCarRating, { contractId: 'current:employee-paula', value: 3 });
  assert.equal(live[0].textContent, 'Rating saved: 3 of 5');
  assert.equal(statusText(host.querySelector('.gcsp-account-preferences')), '3 categories considered · Saved automatically');
  radio(host, 3).click(); await tick(); await tick();
  assert.deepEqual(calls[1].currentCarRating, { contractId: 'current:employee-paula', value: null }); assert.equal(live[0].textContent, 'Rating cleared');
  destroy(); host.remove();
});

test('the same rating instance and its focus survive an Account redraw; a failed save shows Try again that resends', async () => {
  let fail = true;
  const { host, destroy, calls } = await mountRated('selected', { rating: 2, wrap: (t) => ({ loadEditor: t.loadEditor, savePreferences: (i) => (fail ? { status: 'unavailable', retryable: true } : t.savePreferences(i)) }) });
  const first = stars(host)[0]; radio(host, 5).focus(); radio(host, 5).click(); await tick(); await tick();
  assert.equal(radio(host, 5).checked, true, 'the attempted value stays visible');
  const retry = first.querySelector('.vm-btn'); assert.equal(first.querySelector('.gcsp-star-failed').hidden, false);
  await destroy.sync(); await tick();
  assert.equal(stars(host)[0], first, 'the same node is re-appended'); assert.equal(stars(host).length, 1);
  assert.equal(document.activeElement, radio(host, 5));
  fail = false; retry.click(); await tick(); await tick();
  assert.equal(calls[1].commandId, calls[0].commandId); assert.equal(first.querySelector('.gcsp-star-failed').hidden, true);
  destroy(); host.remove();
});

test('stars are absent without a rating controller or without a rating lane', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region) => { region.append(document.createElement('p')); return () => {}; } });
  await tick(); await tick(); assert.equal(stars(host).length, 0); destroy(); host.remove();
  const bare = document.createElement('div'); document.body.append(bare);
  const off = mountAccount(bare, { adapter: adapter() }); await tick(); assert.equal(stars(bare).length, 0); off(); bare.remove();
  const none = document.createElement('div'); document.body.append(none); let mounted;
  const inner = previewPreferenceTransport('selected');
  const noLane = mountAccount(none, { adapter: adapter(), preferences: (region, { signal }) => { mounted = mountAccountPreferences(region, { signal,
    transport: { loadEditor: async () => { const r = await inner.loadEditor(); r.value.initial.currentCarRating = null; return r; }, savePreferences: inner.savePreferences } }); return mounted; } });
  await tick(); await mounted.ready; await tick(); assert.equal(stars(none).length, 0); noLane(); none.remove();
});

test('the missing image fixture keeps its fallback text beside the stars, and the region order is unchanged', async () => {
  const { host, destroy } = await mountRated('selected', { fixture: 'missing-image', rating: 5 });
  const media = host.querySelector('.gcsp-feature .vm-card-media'); assert.equal(media.classList.contains('has-photo'), false);
  assert.equal(media.querySelector('.vm-card-soon').textContent, 'No image available for your car'); assert.equal(media.querySelector('.gcsp-star-rating') !== null, true);
  const after = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  const feature = host.querySelector('.gcsp-feature'); const region = host.querySelector('.gcsp-account-preferences');
  assert.ok(after(feature, region) && after(region, host.querySelector('.gcsp-account-history')) && after(host.querySelector('.gcsp-account-history'), host.querySelector('.gcsp-account-secondary .gcsp-account-rows')));
  assert.ok([...feature.querySelectorAll('button')].some((node) => node.textContent === 'Choose a replacement'));
  destroy(); host.remove();
});

test('teardown removes the rating and its listeners', async () => {
  const { host, destroy, controller } = await mountRated('selected', { rating: 1 });
  const node = stars(host)[0]; destroy(); controller.rate(2, 'current:employee-paula');
  assert.equal(node.querySelector('input[value="2"]').checked, false); host.remove();
});

// FUCQ-369: the Same again row and Buddy understanding on the bitmap.
const sameInput = (host) => host.querySelector('.gcsp-same-switch input');
const figure = (host) => host.querySelector('.gcsp-understanding-value');
const CAR_TEXT = 'BMW 3 Series Touring 320i 320i M Sport Touring \u00b7 Petrol'; // the Account fixture's heading and specification

test('the Same again row sits between the head and the tiles and its help names the Account car', async () => {
  const { host, destroy } = await mountRated('selected');
  const region = host.querySelector('.gcsp-account-preferences'); const head = region.querySelector('.gcsp-prefs-head'); const row = region.querySelector('.gcsp-prefs-mode'); const tiles = region.querySelector('.gcsp-prefs-tiles');
  const after = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(after(head, row) && after(row, tiles)); assert.ok(sameInput(host)); assert.equal(sameInput(host).checked, false);
  const tip = row.querySelector('[role=tooltip]').textContent;
  assert.equal(tip, `Select this option if you just love everything about your current car, and your next best car would be another ${CAR_TEXT}`);
  assert.equal(figure(host).textContent, '6 / 11'); assert.equal(figure(host).getAttribute('aria-label'), 'Buddy understanding 6 out of 11');
  const feature = host.querySelector('.gcsp-feature'); const parts = [feature.querySelector('.gcsp-h2').textContent, feature.querySelector('.gcsp-account-spec')?.textContent].filter(Boolean).join(' ');
  assert.ok(tip.endsWith(parts)); destroy(); host.remove();
});

test('Space on the switch turns Same again on and autosaves; focus stays on it and the score and status follow', async () => {
  const { host, destroy, calls } = await mountRated('selected');
  const input = sameInput(host); input.focus(); input.checked = true; input.dispatchEvent(new window.Event('change', { bubbles: true }));
  const region = host.querySelector('.gcsp-account-preferences');
  assert.equal(statusText(region), 'Saving your preferences.'); assert.equal(region.querySelector('.gcsp-prefs-status').classList.contains('is-pending'), true);
  assert.equal(figure(host).getAttribute('aria-label'), 'Buddy understanding 11 out of 11 (saving)');
  await tick(); await tick();
  assert.deepEqual(calls[0].sameAgain, { contractId: 'current:employee-paula', on: true }); assert.deepEqual(calls[0].changes, {});
  assert.equal(document.activeElement, sameInput(host), 'focus stays on the switch'); assert.equal(sameInput(host), input, 'the same control node');
  assert.equal(input.checked, true); assert.equal(statusText(region), 'Preferences saved automatically.');
  assert.equal(figure(host).textContent, '11 / 11'); assert.equal(figure(host).getAttribute('aria-label'), 'Buddy understanding 11 out of 11');
  assert.equal(region.querySelectorAll('.gcsp-prefs-open:not(:disabled)').length, 0, 'tiles are neutral and disabled');
  assert.equal(host.querySelector('.gcsp-prefs-tile.is-considered .gcsp-prefs-value').textContent, 'Touring / Estate', 'saved choices stay visible');
  input.checked = false; input.dispatchEvent(new window.Event('change', { bubbles: true })); await tick(); await tick();
  assert.deepEqual(calls[1].sameAgain, { contractId: 'current:employee-paula', on: false });
  assert.equal(figure(host).textContent, '6 / 11'); assert.equal(document.activeElement, input);
  assert.equal(statusText(region), 'Preferences saved automatically.');
  destroy(); host.remove();
});

test('a quiet Account redraw keeps the Same again switch node, its state and its focus', async () => {
  const { host, destroy, controller } = await mountRated('same-again');
  assert.equal(controller.snapshot().sameAgain.on, true);
  const input = sameInput(host); assert.equal(input.checked, true); input.focus();
  await destroy.sync(); await tick();
  assert.equal(sameInput(host), input); assert.equal(input.checked, true); assert.equal(document.activeElement, input);
  assert.equal(host.querySelector('.gcsp-prefs-mode [role=tooltip]').textContent.endsWith(CAR_TEXT), true);
  destroy(); host.remove();
});

test('a failed Same again save says so with Try again, keeps the attempt and the retry reuses the command', async () => {
  let fail = true;
  const { host, destroy, calls } = await mountRated('selected', { wrap: (t) => ({ loadEditor: t.loadEditor, savePreferences: (i) => (fail ? { status: 'unavailable', retryable: true } : t.savePreferences(i)) }) });
  const input = sameInput(host); input.focus(); input.checked = true; input.dispatchEvent(new window.Event('change', { bubbles: true })); await tick(); await tick();
  const region = host.querySelector('.gcsp-account-preferences');
  assert.equal(statusText(region), 'Same again was not saved.'); assert.equal(input.checked, true);
  assert.equal(figure(host).getAttribute('aria-label'), 'Buddy understanding 11 out of 11 (not saved)');
  const retry = [...region.querySelectorAll('button')].find((node) => node.textContent === 'Try again'); fail = false; retry.click(); await tick(); await tick(); await tick();
  assert.equal(calls[1].commandId, calls[0].commandId); assert.equal(statusText(region), 'Preferences saved automatically.');
  assert.notEqual(document.activeElement, document.body); destroy(); host.remove();
});

test('no current car: the switch is disabled with the reason and the categories stay editable', async () => {
  const host = document.createElement('div'); document.body.append(host); let mounted;
  const inner = previewPreferenceTransport('selected', { sameAgainReason: 'no-current-car' });
  const destroy = mountAccount(host, { adapter: { ...adapter(), readAccount: async () => accountFixture('no-current-car') },
    preferences: (region, { signal, describeCar }) => { mounted = mountAccountPreferences(region, { transport: inner, signal, describeCar }); return mounted; } });
  await tick(); await mounted.ready; await tick();
  assert.equal(sameInput(host).disabled, true); assert.equal(sameInput(host).checked, false);
  assert.equal(host.querySelector('.gcsp-prefs-same-note').textContent, 'Add your current car to use this.');
  click(tile(host, 'body')); await tick(); assert.equal(host.querySelector('.gcsp-prefs-panel').hidden, false);
  destroy(); host.remove();
});

test('the description is set once the current car renders after the preferences', async () => {
  const host = document.createElement('div'); document.body.append(host); let mounted;
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal, describeCar }) => {
    mounted = mountAccountPreferences(region, { transport: previewPreferenceTransport('selected'), signal, describeCar: () => describeCar() }); return mounted; } });
  await tick(); await mounted.ready; await tick();
  assert.ok(host.querySelector('.gcsp-prefs-mode [role=tooltip]').textContent.endsWith(CAR_TEXT));
  destroy(); host.remove();
});

// Buddy engagement (FUCQ-370): the lamp in Account's head and the one action in the Preferences footer.
async function mountBuddy(state = 'selected', options = {}) {
  const host = document.createElement('div'); document.body.append(host); const transport = previewPreferenceTransport(state, options); const calls = []; let mounted;
  const spy = { loadEditor: () => transport.loadEditor(), savePreferences: (i) => transport.savePreferences(i),
    engage: (i) => { calls.push(['engage', i]); return transport.engage(i); }, disengage: (i) => { calls.push(['disengage', i]); return transport.disengage(i); } };
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal, describeCar }) => { mounted = mountAccountPreferences(region, { transport: spy, signal, describeCar }); return mounted; } });
  await tick(); await mounted.ready; drivePreferenceState(mounted.controller, state); await tick();
  return { host, destroy, calls, controller: mounted.controller };
}
const lampText = (host) => host.querySelector('.gcsp-account-head .gcsp-buddy-status.is-prominent')?.textContent;
const action = (host) => host.querySelector('.gcsp-prefs-action button');

test('the lamp sits in the head, the action in the footer slot, and there is no Save button anywhere', async () => {
  const { host, destroy } = await mountBuddy('selected', { buddy: 'engaged' });
  assert.equal(lampText(host), 'Buddy engaged'); assert.equal(action(host).textContent, 'Disengage Buddy');
  assert.ok(action(host).classList.contains('vm-btn-primary')); assert.equal(action(host).closest('[data-slot="action"]') !== null, true);
  const describedBy = action(host).getAttribute('aria-describedby').split(' ');
  assert.ok(describedBy.includes(host.querySelector('.gcsp-prefs-status').id)); assert.ok(describedBy.includes(host.querySelector('.gcsp-buddy-status.is-prominent').id));
  assert.equal([...host.querySelectorAll('button')].some((node) => /save/i.test(node.textContent)), false);
  destroy(); host.remove();
  const off = await mountBuddy('selected'); assert.equal(lampText(off.host), 'Buddy disengaged'); assert.equal(action(off.host).textContent, 'Engage Buddy'); off.destroy(); off.host.remove();
  const unknown = await mountBuddy('selected', { buddy: 'unknown' });
  assert.equal(lampText(unknown.host), 'Buddy status unavailable'); assert.equal(action(unknown.host).disabled, true);
  assert.equal(statusText(unknown.host), 'Buddy status unavailable. Reload to try again.');
  assert.ok([...unknown.host.querySelectorAll('.gcsp-prefs-statusline button')].some((node) => node.textContent === 'Reload preferences')); unknown.destroy(); unknown.host.remove();
});

test('engage and disengage keep focus on the button and say it once in the status line', async () => {
  const { host, destroy, calls } = await mountBuddy('selected');
  action(host).focus(); click(action(host)); await tick(); await tick();
  assert.equal(calls.length, 1); assert.equal(lampText(host), 'Buddy engaged'); assert.equal(action(host).textContent, 'Disengage Buddy');
  assert.equal(statusText(host), 'Buddy engaged. Your preferences will guide the search.'); assert.equal(document.activeElement, action(host));
  assert.equal(host.querySelectorAll('[aria-live], [role=status]').length >= 1, true);
  assert.equal(host.querySelector('.gcsp-buddy-status.is-prominent').hasAttribute('role'), false);
  click(action(host)); await tick(); await tick();
  assert.equal(lampText(host), 'Buddy disengaged'); assert.equal(statusText(host), 'Buddy disengaged. Your preferences are kept.'); assert.equal(document.activeElement, action(host));
  destroy(); host.remove();
});

test('under the minimum the status line takes focus and shows the danger copy, with no request', async () => {
  const { host, destroy, calls } = await mountBuddy('validation');
  await tick(); await tick();
  assert.equal(calls.length, 0);
  const status = host.querySelector('.gcsp-prefs-status');
  assert.equal(status.textContent, 'Choose 3 more categories to engage Buddy. Your preferences save automatically.');
  assert.ok(status.classList.contains('is-failed')); assert.equal(document.activeElement, status);
  assert.equal(lampText(host), 'Buddy disengaged');
  destroy(); host.remove();
});

test('a pending engage disables the button and never reads engaged; a failure offers Engage again', async () => {
  const pending = await mountBuddy('engage-pending'); await tick(); await tick();
  assert.equal(action(pending.host).disabled, true); assert.equal(statusText(pending.host), 'Engaging Buddy.'); assert.equal(lampText(pending.host), 'Buddy disengaged');
  pending.destroy(); pending.host.remove();
  const failed = await mountBuddy('engage-failed'); await tick(); await tick();
  assert.equal(statusText(failed.host), 'Buddy was not engaged. Try again.'); assert.equal(action(failed.host).disabled, false); assert.equal(action(failed.host).textContent, 'Engage Buddy');
  failed.destroy(); failed.host.remove();
});

test('minimum loss on a successful removal disengages the lamp and shows the danger notice', async () => {
  const { host, destroy } = await mountBuddy('minimum-loss'); await tick(); await tick(); await tick();
  const status = host.querySelector('.gcsp-prefs-status');
  assert.equal(lampText(host), 'Buddy disengaged'); assert.equal(action(host).textContent, 'Engage Buddy');
  assert.equal(status.textContent, 'Preferences saved. Buddy disengaged: choose at least 3 categories to engage again.'); assert.ok(status.classList.contains('is-notice'));
  destroy(); host.remove();
});

test('Account refresh re-reads the lamp quietly, and without a preferences capability there is no lamp', async () => {
  const host = document.createElement('div'); document.body.append(host); const inner = previewPreferenceTransport('selected', { buddy: 'engaged' }); let view = 'engaged'; let mounted;
  const transport = { ...inner, loadEditor: async () => { const r = await inner.loadEditor(); r.value.initial.buddy = { ...r.value.initial.buddy, state: view, remaining: 0 }; return r; } };
  const destroy = mountAccount(host, { adapter: adapter(), preferences: (region, { signal, describeCar }) => { mounted = mountAccountPreferences(region, { transport, signal, describeCar }); return mounted; } });
  await tick(); await mounted.ready; await tick();
  assert.equal(lampText(host), 'Buddy engaged'); view = 'disengaged';
  await destroy.sync(); await tick(); await tick(); await tick();
  assert.equal(lampText(host), 'Buddy disengaged'); destroy(); host.remove();
  const bare = document.createElement('div'); document.body.append(bare);
  const stop = mountAccount(bare, { adapter: adapter() }); await tick(); await tick();
  assert.equal(bare.querySelector('.gcsp-buddy-status.is-prominent'), null); stop(); bare.remove();
});
