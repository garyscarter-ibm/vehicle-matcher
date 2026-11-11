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
    'comfort-midpoint': [3, 'comfort'], 'remove-comfort': [3, null], 'save-failed': [3, null], stale: [3, null], pending: [3, null] };
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
    if (name === 'body-high') assert.equal(region.querySelector('.gcsp-prefs-tile.is-important') !== null, true);
    destroy(); host.remove();
  }
});
