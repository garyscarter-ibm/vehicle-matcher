import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

let dom; let consoleMod; let tabsMod;
before(async () => {
  dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  consoleMod = await import('../../blocks/gcsp/presenter-controls/console.js');
  tabsMod = await import('../../blocks/gcsp/kit/tabs.js');
});
beforeEach(() => { document.body.replaceChildren(); window.sessionStorage.clear(); window.localStorage.clear(); });
after(() => dom.window.close());
const ok = (value) => ({ status: 'ok', value });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)); };
const readState = (extra = {}) => ({ runId: 'run-a', runVersion: 1, now: '2026-11-05T09:00:00.000Z', clockVersion: '7',
  currentScenario: { scenarioId: 'mechanics', name: 'Clock mechanics' }, lastTick: null,
  principals: [{ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }],
  controls: { step: { value: 37, unit: 'seconds' }, namedTimes: { release: '2026-11-05T10:00:00.000Z' }, nextRelease: { status: 'available', at: '2026-11-05T10:00:00.000Z' } }, ...extra });
const catalogue = { policyVersion: 'p1', scenarios: [{ scenarioId: 'mechanics', name: 'Clock mechanics', scenarioVersion: 'v1', fixtureVersion: 'f1', availability: { available: true } }] };
function setup(overrides = {}, options = {}) {
  const host = document.createElement('div'); document.body.append(host); const calls = []; let ids = 0;
  const adapter = { readControls: async () => ok(readState()), readContext: async () => ok({ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }),
    readScenarios: async () => ok(catalogue), readFaults: async () => ok({ faults: [] }),
    tick: async (payload) => { calls.push(payload); return ok({}); }, reset: async () => ok({}), switchPrincipal: async () => ok({}), ...overrides };
  const api = consoleMod.mountPresenterConsole(host, { adapter, commandId: () => `command-${++ids}`, ...options });
  return { host, adapter, api, calls, root: api.root };
}
const labelled = (root, label) => [...root.querySelectorAll('button')].find((node) => node.textContent === label || node.textContent.startsWith(`${label} (`));
const key = (node, name) => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true }));
const textNodes = (root) => { const out = []; const walk = (node) => { if (node.nodeType === 3) out.push(node.nodeValue); else node.childNodes.forEach(walk); }; walk(root); return out.join(' '); };

// Records every value written to the h1, so a test can prove no interim heading is ever painted.
function watchHeading(root) {
  const h1 = root.querySelector('h1'); const seen = []; const own = Object.getOwnPropertyDescriptor(window.Node.prototype, 'textContent');
  Object.defineProperty(h1, 'textContent', { configurable: true, get() { return own.get.call(this); }, set(value) { seen.push(value); own.set.call(this, value); } });
  return seen;
}
const gate = () => { let open; const wait = new Promise((resolve) => { open = resolve; }); return { wait, open }; };
const visibleSkeleton = (root) => root.querySelector('.gcsp-console-stage > .gcsp-skeleton');

test('the console has no portal chrome and the page links only what it needs', () => {
  const f = setup();
  for (const selector of ['.gcsp-header', '.gcsp-nav', '.gcsp-rail', '.gcsp-presenter-flyout', '.gcsp-nav-presenter']) assert.equal(f.root.querySelector(selector), null, selector);
  assert.ok(f.root.querySelector('header.gcsp-console-head')); f.api.destroy();
  const html = readFileSync(new URL('../../gcsp-presenter.html', import.meta.url), 'utf8');
  assert.match(html, /<title>Presenter console<\/title>/); assert.match(html, /<body class="gcsp">/);
  assert.doesNotMatch(html, /gcsp-shell\.css|gcsp-account|manual|greg|case|portalShell/i);
  assert.match(html, /presenter-controls\/presenter-controls\.css/); assert.match(html, /presenter-console\.css/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>|\son[a-z]+\s*=/i);
  assert.doesNotMatch(readFileSync(new URL('../../blocks/gcsp/presenter-controls/harness.js', import.meta.url), 'utf8'), /workspace/);
});

test('Basic is the default with two buttons and the portal link', async () => {
  const f = setup(); await f.api.ready;
  const buttons = [...f.root.querySelectorAll('.gcsp-console-actions button')].map((node) => node.textContent);
  assert.deepEqual(buttons, ["Release tomorrow's cars", 'Start again']);
  assert.ok(f.api.basic.release.classList.contains('vm-btn-primary')); assert.ok(f.api.basic.startAgain.classList.contains('vm-btn-ghost'));
  const link = f.root.querySelector('a.gcsp-console-link');
  assert.equal(link.textContent, 'Open the portal'); assert.match(link.getAttribute('href'), /gcsp-account\.html$/);
  assert.equal(link.target, '_blank'); assert.match(link.rel, /noopener/);
  assert.equal(f.root.querySelector('h1').textContent, 'Clock mechanics');
  assert.equal(f.root.querySelector('[role="status"]').textContent, '');
  assert.equal(f.root.querySelector('.gcsp-console-time').hidden, true);
  const toggle = f.root.querySelector('.gcsp-console-mode');
  assert.equal(toggle.textContent, 'Advanced'); assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(f.root.querySelector('.gcsp-console-advanced').hidden, true); assert.equal(f.root.querySelector('.gcsp-presenter-controls'), null);
  f.api.destroy();
});

test('the Advanced toggle is remembered for the session and falls back to Basic when storage throws', async () => {
  const first = setup(); await first.api.ready;
  const toggle = first.root.querySelector('.gcsp-console-mode'); toggle.click();
  assert.equal(window.sessionStorage.getItem(consoleMod.PRESENTER_CONSOLE_MODE_KEY), 'advanced');
  assert.equal(consoleMod.PRESENTER_CONSOLE_MODE_KEY, 'gcsp:presenter-console-mode');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true'); first.api.destroy(); document.body.replaceChildren();
  const second = setup(); await settle();
  assert.equal(second.root.querySelector('.gcsp-console-mode').getAttribute('aria-pressed'), 'true');
  assert.equal(second.root.querySelector('.gcsp-console-advanced').hidden, false); assert.equal(second.root.querySelector('.gcsp-console-stage').hidden, true);
  second.root.querySelector('.gcsp-console-mode').click();
  assert.equal(window.sessionStorage.getItem(consoleMod.PRESENTER_CONSOLE_MODE_KEY), 'basic'); second.api.destroy(); document.body.replaceChildren();
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const third = setup({}, { storage: broken }); await settle();
  assert.equal(third.root.querySelector('.gcsp-console-mode').getAttribute('aria-pressed'), 'false');
  third.root.querySelector('.gcsp-console-mode').click(); assert.equal(third.root.querySelector('.gcsp-console-advanced').hidden, false); third.api.destroy();
});

test('the controller is mounted once, lazily, and stays mounted when toggling back', async () => {
  const f = setup(); await f.api.ready;
  assert.equal(f.root.querySelectorAll('.gcsp-presenter-controls').length, 0);
  const toggle = f.root.querySelector('.gcsp-console-mode'); toggle.click(); await settle();
  const controller = f.root.querySelector('.gcsp-presenter-controls'); assert.ok(controller);
  assert.ok(controller.classList.contains('gcsp-presenter-embedded'));
  const target = controller.querySelector('input.gcsp-presenter-input'); target.value = 'draft';
  toggle.click(); assert.equal(f.root.querySelector('.gcsp-console-advanced').hidden, true); toggle.click();
  assert.equal(f.root.querySelectorAll('.gcsp-presenter-controls').length, 1);
  assert.equal(f.root.querySelector('.gcsp-presenter-controls'), controller); assert.equal(controller.querySelector('input.gcsp-presenter-input').value, 'draft');
  f.api.destroy();
});

test('five tabs in order hold every controller control and none is orphaned', async () => {
  const f = setup({ readFaults: async () => ok({ faults: [{ adapter: 'stock', mode: 'none', modes: ['none', 'stale'] }] }) }); await f.api.ready;
  f.api.setMode('advanced'); await settle();
  assert.equal(f.root.dataset.tabs, 'true');
  const tabs = [...f.root.querySelectorAll('[role="tab"]')]; assert.deepEqual(tabs.map((n) => n.textContent), ['Scenario', 'Clock', 'People', 'Faults', 'Last tick']);
  const panels = [...f.root.querySelectorAll('[role="tabpanel"]')]; assert.equal(panels.length, 5);
  const inPanel = (index, label) => assert.ok(panels[index].contains(labelled(f.root, label)), `${label} in ${tabs[index].textContent}`);
  inPanel(0, 'Reset scenario'); inPanel(0, 'Confirm reset'); inPanel(0, 'Continue to workspace');
  assert.ok(panels[0].contains(f.root.querySelector('[role="radiogroup"][aria-label="Scenario"]')));
  inPanel(1, 'Tick'); inPanel(1, 'Next release'); inPanel(1, 'Tick to target');
  assert.ok(panels[1].contains(f.root.querySelector('input.gcsp-presenter-input'))); assert.ok(panels[1].contains(f.root.querySelector('datalist')));
  assert.match(panels[1].textContent, /Named time or UTC target/);
  inPanel(2, 'Switch principal'); inPanel(2, 'Issue selected principal again');
  assert.ok(panels[2].contains(f.root.querySelector('[role="radiogroup"][aria-label="Acting principal"]')));
  assert.ok(panels[3].contains(labelled(f.root, 'Set stock source') ?? [...f.root.querySelectorAll('button')].find((n) => /^Set /.test(n.textContent))));
  assert.equal(panels[3].querySelector('details').open, true);
  inPanel(4, 'Refresh readback'); assert.equal(panels[4].querySelector('details').open, true); assert.match(panels[4].textContent, /Last tick/);
  const actions = f.root.querySelector('.gcsp-presenter-actions');
  for (const node of [...f.root.querySelectorAll('.gcsp-presenter-controls button, .gcsp-presenter-controls fieldset')].filter((n) => !n.closest('.gcsp-tab-list'))) {
    assert.ok(node.closest('[role="tabpanel"]') || node.closest('.gcsp-console-recovery') || node.closest('.gcsp-run-restarted'), `orphaned: ${node.textContent || node.className}`);
  }
  assert.ok(labelled(f.root, 'Retry original action').closest('.gcsp-console-recovery')); assert.ok(f.root.querySelector('.gcsp-presenter-facts'));
  assert.equal(actions.querySelectorAll(':scope > p.gcsp-note[role="status"]').length, 2); assert.ok(actions.querySelector(':scope > .gcsp-run-restarted'));
  assert.ok(f.root.querySelector('.gcsp-presenter-panel').contains(f.root.querySelector('.gcsp-tabs')));
  f.api.destroy();
});

test('tab keyboard: arrows wrap, Home and End jump, and aria is wired', () => {
  const panel = (t) => { const n = document.createElement('div'); n.textContent = t; return n; };
  const picked = []; const set = tabsMod.tabs({ label: 'Groups', items: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase(), panel: panel(id) })), onSelect: (id) => picked.push(id) });
  document.body.append(set.root);
  const tabs = [...set.root.querySelectorAll('[role="tab"]')]; const panels = [...set.root.querySelectorAll('[role="tabpanel"]')];
  assert.equal(set.list.getAttribute('role'), 'tablist'); assert.equal(set.list.getAttribute('aria-label'), 'Groups');
  tabs.forEach((tab, i) => { assert.equal(tab.getAttribute('aria-controls'), panels[i].id); assert.equal(panels[i].getAttribute('aria-labelledby'), tab.id); assert.equal(panels[i].tabIndex, 0); });
  assert.deepEqual(tabs.map((t) => [t.getAttribute('aria-selected'), t.tabIndex]), [['true', 0], ['false', -1], ['false', -1]]);
  assert.deepEqual(panels.map((p) => p.hidden), [false, true, true]);
  tabs[0].focus(); key(tabs[0], 'ArrowLeft'); assert.equal(document.activeElement, tabs[2]); assert.equal(set.selected(), 'c');
  key(tabs[2], 'ArrowRight'); assert.equal(document.activeElement, tabs[0]); assert.equal(set.selected(), 'a');
  key(tabs[0], 'End'); assert.equal(set.selected(), 'c'); key(tabs[2], 'Home'); assert.equal(set.selected(), 'a');
  tabs[1].click(); assert.equal(set.selected(), 'b'); assert.equal(panels[1].hidden, false); assert.equal(panels[0].hidden, true);
  set.select('c'); assert.equal(tabs[2].getAttribute('aria-selected'), 'true'); assert.deepEqual(picked, ['c', 'a', 'c', 'a', 'b', 'c']);
  assert.throws(() => tabsMod.tabs({ items: [] }), TypeError);
});

test('Release sends next-release with a command id and the clock version, announces it, and is disabled while busy', async () => {
  let finish; const f = setup({ tick: (payload) => { f.calls.push(payload); return new Promise((resolve) => { finish = resolve; }); } });
  await f.api.ready; const events = []; f.host.addEventListener('gcsp:presenter-action', (e) => events.push(e.detail.kind));
  assert.equal(f.api.basic.release.disabled, false);
  f.api.basic.release.click(); await settle();
  assert.deepEqual(f.calls, [{ commandId: 'command-1', expectedClockVersion: '7', mode: 'next-release' }]);
  assert.equal(f.api.basic.release.disabled, true); f.api.basic.release.click(); assert.equal(f.calls.length, 1);
  finish(ok({})); await settle();
  assert.equal(f.root.querySelector('[role="status"]').textContent, 'Cars released'); assert.deepEqual(events, ['tick']);
  assert.equal(JSON.parse(window.localStorage.getItem('gcsp:presenter-action')).kind, 'tick');
  assert.equal(f.api.basic.release.disabled, false); f.api.destroy();
});

test('Release failure says why without a raw status code, and an unavailable cue disables the button with its reason', async () => {
  const f = setup({ tick: async () => ({ status: 'conflict', reason: 'The clock moved on' }) }); await f.api.ready;
  f.api.basic.release.click(); await settle();
  assert.equal(f.root.querySelector('[role="status"]').textContent, 'Release not completed: The clock moved on'); f.api.destroy();
  const g = setup({ tick: async () => ({ status: 'unavailable', code: 'presenter-transport-unavailable' }) }); await g.api.ready;
  g.api.basic.release.click(); await settle();
  assert.equal(g.root.querySelector('[role="status"]').textContent, 'Release not completed: Try again'); g.api.destroy();
  const h = setup({ readControls: async () => ok(readState({ controls: { nextRelease: { status: 'none', reason: 'No future cue' } } })) }); await h.api.ready;
  assert.equal(h.api.basic.release.disabled, true);
  const reason = h.root.querySelector('.gcsp-console-reason'); assert.equal(reason.textContent, 'Release unavailable: No future cue');
  assert.equal(h.api.basic.release.getAttribute('aria-describedby'), reason.id); h.api.destroy();
});

test('Start again opens Advanced on Scenario and focuses Reset scenario, leaving the confirmation to the controller', async () => {
  const f = setup(); await f.api.ready; f.api.basic.startAgain.click(); await settle();
  assert.equal(f.root.querySelector('.gcsp-console-advanced').hidden, false);
  assert.equal(f.root.querySelector('[role="tab"][aria-selected="true"]').textContent, 'Scenario');
  const reset = labelled(f.root, 'Reset scenario'); assert.equal(document.activeElement, reset); assert.equal(f.calls.length, 0);
  reset.click(); assert.equal(f.root.querySelector('.gcsp-presenter-confirmation').hidden, false); f.api.destroy();
});

test('basic.update changes only supplied keys, and the overrides replace the defaults', async () => {
  const seen = []; const starts = [];
  const f = setup({}, { onState: (state, basic) => seen.push([state.runId, typeof basic.update]), onRelease: (ctx) => { seen.push(Object.keys(ctx).sort().join()); },
    onStartAgain: (ctx) => { starts.push(ctx.state.runId); ctx.setMode('advanced'); } });
  await f.api.ready; const { basic } = f.api;
  assert.deepEqual(seen[0], ['run-a', 'function']);
  basic.update({ headline: 'Day 2', sub: 'Next release tomorrow' });
  assert.equal(f.root.querySelector('h1').textContent, 'Day 2'); assert.equal(f.root.querySelector('.gcsp-console-sub').textContent, 'Next release tomorrow');
  basic.update({ clock: 'Mon 9 Nov, 9:00am' }); assert.equal(f.root.querySelector('h1').textContent, 'Day 2');
  assert.equal(f.root.querySelector('.gcsp-console-time').hidden, false); assert.equal(f.root.querySelector('.gcsp-console-clock').textContent, 'Mon 9 Nov, 9:00am');
  basic.update({ clock: '' }); assert.equal(f.root.querySelector('.gcsp-console-time').hidden, true);
  basic.update({ primary: { label: 'Release 9:00am cars', disabled: true, reason: 'Waiting for the release time' } });
  assert.equal(basic.release.textContent, 'Release 9:00am cars'); assert.equal(basic.release.disabled, true);
  const reason = f.root.querySelector('.gcsp-console-reason'); assert.equal(reason.textContent, 'Waiting for the release time'); assert.equal(basic.release.getAttribute('aria-describedby'), reason.id);
  basic.update({ primary: { disabled: false } }); assert.equal(basic.release.disabled, false); assert.equal(reason.hidden, true); assert.equal(basic.release.getAttribute('aria-describedby'), null);
  basic.setStatus('Hello'); assert.equal(f.root.querySelector('[role="status"]').textContent, 'Hello');
  basic.release.click(); await settle(); assert.equal(f.calls.length, 0); assert.equal(seen.at(-1), 'adapter,basic,commandId,refresh,setMode,state,tick');
  basic.startAgain.click(); assert.deepEqual(starts, ['run-a']); assert.equal(f.root.querySelector('.gcsp-console-advanced').hidden, false); f.api.destroy();
});

test('restarted and unavailable reads show a screen in the Basic body', async () => {
  let reloads = 0;
  const a = setup({ readControls: async () => ({ status: 'stale-run' }) }, { reload: () => { reloads += 1; } }); await a.api.ready;
  assert.match(a.root.querySelector('.vm-status').textContent, /Restarted/); a.root.querySelector('.vm-status button').click(); assert.equal(reloads, 1); a.api.destroy();
  const b = setup({ readControls: async () => ({ status: 'forbidden' }) }); await b.api.ready;
  assert.match(b.root.querySelector('.vm-status').textContent, /Presenter controls unavailable.*Reload this page to start a presenter session\./); b.api.destroy();
  let reads = 0; const c = setup({ readControls: async () => (++reads === 1 ? { status: 'unavailable' } : ok(readState())) }); await c.api.ready;
  assert.match(c.root.querySelector('.vm-status').textContent, /Presenter controls unavailable/);
  c.root.querySelector('.vm-status button').click(); await settle(); assert.equal(c.root.querySelector('.gcsp-console-screen .vm-status'), null); assert.equal(c.root.querySelector('h1').textContent, 'Clock mechanics'); c.api.destroy();
});

test('painted copy has no em dash and none of the banned words, and the adapter is the only data source', async () => {
  const names = []; const adapter = {}; const f = setup({}, {});
  for (const name of Object.keys(f.adapter)) adapter[name] = (...args) => { names.push(name); return f.adapter[name](...args); };
  f.api.destroy(); document.body.replaceChildren();
  const g = setup(adapter); await g.api.ready; g.api.setMode('advanced'); await settle();
  const paint = (root) => [textNodes(root), ...[...root.querySelectorAll('[aria-label],[alt],[title],[placeholder]')].flatMap((n) => ['aria-label', 'alt', 'title', 'placeholder'].map((a) => n.getAttribute(a)))].join(' ');
  const shown = paint(g.root);
  assert.doesNotMatch(shown, /—/); assert.doesNotMatch(shown, /demo|demonstration|synthetic|fictional|example/i);
  assert.doesNotMatch(readFileSync(new URL('../../gcsp-presenter.html', import.meta.url), 'utf8').match(/<title>.*<\/title>/)[0], /demo|synthetic|fictional|example|—/i);
  const bad = names.filter((n) => !['readControls', 'readContext', 'readScenarios', 'readFaults', 'readOutbox'].includes(n));
  assert.deepEqual(bad, []); assert.ok(names.includes('readControls'));
  assert.doesNotMatch(readFileSync(new URL('../../blocks/gcsp/presenter-controls/console.js', import.meta.url), 'utf8'), /createAccountHttpAdapter|createGregHttpAdapter|accountAdapter|gregAdapter|\/account\/|\/greg\//);
  g.api.destroy();
});

test('before the first read the page is a skeleton with one status line, and no heading has text', async () => {
  const hold = gate(); const f = setup({ readControls: async () => { await hold.wait; return ok(readState()); } });
  const skeleton = visibleSkeleton(f.root); assert.ok(skeleton); assert.equal(skeleton.dataset.layout, 'console');
  assert.equal(f.root.querySelectorAll('[role="status"]').length, 2, 'the skeleton line and the action status');
  assert.equal(skeleton.querySelector('[role="status"]').textContent, 'Loading the presenter console');
  assert.equal(f.root.querySelector('h1').textContent, ''); assert.equal(f.root.querySelector('.gcsp-console-stage').hasAttribute('data-loading'), true);
  hold.open(); await f.api.ready; await settle(); f.api.destroy();
});

test('without Basic options the heading is written once, after the read, and the skeleton goes', async () => {
  const hold = gate(); const f = setup({ readControls: async () => { await hold.wait; return ok(readState()); } }); const seen = watchHeading(f.root);
  await settle(); assert.deepEqual(seen, []); assert.ok(visibleSkeleton(f.root));
  hold.open(); await f.api.ready; await settle();
  assert.deepEqual(seen, ['Clock mechanics']); assert.equal(visibleSkeleton(f.root), null);
  assert.equal(f.root.querySelector('.gcsp-console-stage').hasAttribute('data-loading'), false); f.api.destroy();
});

test('a slow onState keeps the skeleton and never shows the scenario name before the supplied headline', async () => {
  const hold = gate(); const f = setup({}, { onState: async (state, basic) => { await hold.wait; basic.update({ headline: 'Ready for the next release' }); } });
  const seen = watchHeading(f.root); await settle();
  assert.deepEqual(seen, []); assert.ok(visibleSkeleton(f.root));
  hold.open(); await f.api.ready; await settle();
  assert.deepEqual(seen, ['Ready for the next release']); assert.equal(visibleSkeleton(f.root), null); f.api.destroy();
});

test('a failed read ends the skeleton on the error screen, with the title as the heading', async () => {
  const f = setup({ readControls: async () => ({ status: 'unavailable' }) }); await f.api.ready;
  assert.equal(visibleSkeleton(f.root), null); assert.ok(f.root.querySelector('.gcsp-console-screen .vm-status'));
  assert.equal(f.root.querySelector('h1').textContent, 'Presenter console'); f.api.destroy();
});
