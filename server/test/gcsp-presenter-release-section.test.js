import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let sectionMod; let consoleMod; let basicMod;
before(async () => {
  dom = new JSDOM('<!doctype html><body class="gcsp"></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  // Images "load" at once so the grid's default preload settles without a network.
  globalThis.Image = class { addEventListener(type, run) { if (type === 'load') setImmediate(run); } set src(value) { this.value = value; } };
  sectionMod = await import('../../blocks/gcsp/presenter-controls/release-section.js');
  consoleMod = await import('../../blocks/gcsp/presenter-controls/console.js');
  basicMod = await import('../../blocks/gcsp/presenter-controls/basic-console.js');
});
beforeEach(() => { document.body.replaceChildren(); window.sessionStorage.clear(); window.localStorage.clear(); window.matchMedia = () => ({ matches: true }); });
after(() => dom.window.close());
const ok = (value) => ({ status: 'ok', value });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };
const car = (at, extra = {}) => ({ id: `car-${at}`, imageSrc: `/assets/${at}.webp`, imageAlt: `Car ${at}`, modelName: `Model ${at}`, modelLine: 'G20', colourName: `Colour ${at}`, ...extra });
const latest = (runId = 'run-a', trancheId = 't1', n = 4, extra = {}) => ok({ runId, release: { windowId: 'w1', releasedAt: '2026-11-10T11:30:00.000Z', trancheId },
  cars: Array.from({ length: n }, (_, at) => car(at)), counts: { released: n, modelLines: 2, colours: 3, onScheme: 1200 }, modelLines: [{ modelLine: 'G20', count: 3 }, { modelLine: 'F70', count: 1 }], ...extra });
const gate = () => { let open; const wait = new Promise((resolve) => { open = resolve; }); return { wait, open }; };
const empty = ok({ runId: 'run-a', release: null, cars: [], counts: { released: 0, modelLines: 0, colours: 0, onScheme: 0 }, modelLines: [] });
const mount = (reply, extra = {}) => {
  const host = document.createElement('div'); document.body.append(host); const adapter = { readLatestRelease: async () => (typeof reply === 'function' ? reply() : reply), ...extra };
  return { host, adapter, api: sectionMod.mountReleaseSection(host, { adapter, matchMedia: () => ({ matches: true }) }) };
};
const facts = (root, selector) => Object.fromEntries([...root.querySelectorAll(`${selector} .vm-fact`)].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
const cells = (root) => [...root.querySelectorAll('[role="gridcell"]')];
const paint = (root) => [root.textContent, ...[...root.querySelectorAll('[aria-label],[alt],[title]')].flatMap((n) => ['aria-label', 'alt', 'title'].map((a) => n.getAttribute(a)))].join(' ');

test('before a release it waits for 11:30am with zero counters and a status screen', async () => {
  const f = mount(empty); await f.api.refresh();
  assert.equal(f.api.root.tagName, 'SECTION'); assert.equal(f.api.root.querySelector('h2').textContent, "Today's release");
  assert.equal(f.api.root.getAttribute('aria-labelledby'), f.api.root.querySelector('h2').id);
  assert.match(f.api.root.textContent, /Waiting for 11:30am/); assert.match(f.api.root.textContent, /No cars released yet/);
  assert.equal(f.api.root.querySelector('[role="grid"]'), null);
  assert.deepEqual(facts(f.api.root, '.gcsp-release-totals'), { Released: '0', 'Model lines': '0', Colours: '0', 'On the scheme': '0' });
  f.api.destroy();
});

test('after a release it shows labelled tiles, counters and the model-line breakdown', async () => {
  const f = mount(latest('run-a', 't1', 4, { cars: [car(0), car(1, { colourName: null }), car(2), car(3)] })); await f.api.refresh(); await settle();
  assert.match(f.api.root.textContent, /Released Tue 10 Nov, 11:30am/); assert.equal(f.api.root.querySelector('.vm-status'), null);
  const grid = f.api.root.querySelector('[role="grid"]'); assert.equal(grid.getAttribute('aria-label'), 'Released cars');
  assert.deepEqual(cells(f.api.root).map((cell) => cell.getAttribute('aria-label')), ['Model 0, Colour 0', 'Model 1', 'Model 2, Colour 2', 'Model 3, Colour 3']);
  assert.deepEqual(facts(f.api.root, '.gcsp-release-totals'), { Released: '4', 'Model lines': '2', Colours: '3', 'On the scheme': '1,200' });
  assert.deepEqual(Object.entries(facts(f.api.root, '.gcsp-release-lines')), [['G20', '3'], ['F70', '1']]);
  assert.ok(f.api.root.querySelector('[aria-label="Cars released by model line"]'));
  f.api.destroy();
});

test('a missing method, an unavailable reply or a throw all show the before state with no error copy', async () => {
  for (const f of [mount(null, { readLatestRelease: undefined }), mount({ status: 'unavailable', reason: 'route-absent', retryable: true }),
    mount(() => { throw new Error('boom'); }), mount({ status: 'access-required' })]) {
    await f.api.refresh(); assert.match(f.api.root.textContent, /Waiting for 11:30am/); assert.doesNotMatch(paint(f.api.root), /unavailable|error|failed|boom|retry/i);
    assert.equal(f.api.root.querySelector('[role="grid"]'), null); f.api.destroy();
  }
});

test('stale replies are dropped and destroy aborts the read', async () => {
  const gates = []; const signals = [];
  const f = mount(null, { readLatestRelease: (options) => { signals.push(options.signal); return new Promise((resolve) => gates.push(resolve)); } });
  const first = f.api.refresh(); const second = f.api.refresh();
  gates[1](latest('run-a', 't2', 2)); await second; await settle(); gates[0](latest('run-a', 't1', 5)); await first; await settle();
  assert.equal(cells(f.api.root).length, 2); f.api.destroy(); assert.equal(signals[0].aborted, true);
});

test('the first read fills at once; a new key cascades; the same key and null do not', async () => {
  window.matchMedia = () => ({ matches: false });
  let reply = latest('run-a', 't1', 4);
  const host = document.createElement('div'); document.body.append(host);
  const api = sectionMod.mountReleaseSection(host, { adapter: { readLatestRelease: async () => reply }, matchMedia: () => ({ matches: false }) });
  await api.refresh(); await settle();
  assert.equal(cells(api.root).length, 4); assert.ok(cells(api.root).every((cell) => cell.style.getPropertyValue('--gcsp-release-delay') === ''));
  const before = cells(api.root)[0];
  await api.refresh(); await settle(); assert.equal(cells(api.root)[0], before);
  reply = latest('run-a', 't2', 4); const next = api.refresh(); await settle();
  assert.notEqual(cells(api.root)[0], before); assert.equal(cells(api.root)[1].style.getPropertyValue('--gcsp-release-delay') !== '', true); await next;
  reply = latest('run-a', null, 4); const third = api.refresh(); await settle(); assert.equal(cells(api.root)[1].style.getPropertyValue('--gcsp-release-delay') !== '', true); await third;
  reply = empty; await api.refresh(); assert.equal(api.root.querySelector('[role="grid"]'), null); assert.match(api.root.textContent, /No cars released yet/);
  api.destroy();
});

test('under reduced motion a later release shows final numbers and tiles at once', async () => {
  let reply = latest('run-a', 't1', 3); const f = mount(() => reply); await f.api.refresh(); await settle();
  reply = latest('run-a', 't2', 6, { counts: { released: 6, modelLines: 4, colours: 5, onScheme: 900 } }); await f.api.refresh(); await settle();
  assert.equal(cells(f.api.root).length, 6); assert.ok(cells(f.api.root).every((cell) => cell.style.getPropertyValue('--gcsp-release-delay') === ''));
  assert.deepEqual(facts(f.api.root, '.gcsp-release-totals'), { Released: '6', 'Model lines': '4', Colours: '5', 'On the scheme': '900' });
  f.api.destroy();
});

const START = '2026-11-09T09:00:00.000Z';
const main = { scenarioId: 'main-successful-journey', name: 'Main successful journey', scenarioVersion: 'v1', fixtureVersion: 'f1', availability: { available: true }, inputs: { briefs: [{ principalId: 'p' }] }, clockStart: START };
const readState = () => ({ runId: 'run-a', runVersion: 1, now: START, clockVersion: '7', currentScenario: { scenarioId: main.scenarioId, name: main.name, fixtureVersion: main.fixtureVersion }, lastTick: null,
  principals: [], controls: { step: { value: 60, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'available', at: '2026-11-10T11:30:00.000Z' } } });
function mountConsole(options = {}) {
  const host = document.createElement('div'); document.body.append(host); let release = empty; let ids = 0; const adapter = { readControls: async () => ok(readState()),
    readContext: async () => ok({ principalId: 'x', name: 'X', roles: [] }), readScenarios: async () => ok({ policyVersion: 'p', scenarios: [main] }), readFaults: async () => ok({ faults: [] }),
    tick: async () => { release = latest('run-a', 't9', 5); return ok({}); }, reset: async () => { release = empty; return ok({}); }, listOrders: async () => ok({ orders: [] }),
    readLatestRelease: async () => release, ...options.adapter };
  const api = consoleMod.mountPresenterConsole(host, { adapter, commandId: () => `c-${++ids}`, ...(options.basic ? basicMod.basicConsoleOptions({ adapter }) : {}) });
  return { api, adapter, host, setRelease: (value) => { release = value; } };
}

test('the console mounts the section just before the feed and refreshes it after Release', async () => {
  const f = mountConsole(); await f.api.ready; await settle();
  const stage = f.api.root.querySelector('.gcsp-console-stage'); assert.equal(stage.querySelector('.gcsp-console-release').nextElementSibling?.className, 'gcsp-happened');
  assert.match(stage.textContent, /Waiting for 11:30am/);
  f.api.basic.release.click(); await settle();
  assert.equal(cells(stage).length, 5); assert.match(stage.textContent, /Released Tue 10 Nov, 11:30am/); assert.equal(stage.querySelector('.gcsp-console-release').nextElementSibling?.className, 'gcsp-happened');
  f.api.destroy(); assert.equal(document.querySelector('.gcsp-console-release'), null);
});

test('through the Basic options the section follows Release, Start again and keeps its place between the confirmation and the feed', async () => {
  const f = mountConsole({ basic: true }); await f.api.ready; await settle();
  f.api.basic.release.click(); await settle(); assert.equal(cells(f.api.root).length, 5);
  f.api.basic.startAgain.click(); await settle();
  const stage = f.api.root.querySelector('.gcsp-console-stage'); assert.equal(stage.querySelector('.gcsp-console-release').nextElementSibling?.className, 'gcsp-happened');
  assert.ok(stage.querySelector('.gcsp-console-confirm').compareDocumentPosition(stage.querySelector('.gcsp-console-release')) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  stage.querySelector('.gcsp-console-confirm button').click(); await settle();
  assert.equal(cells(f.api.root).length, 0); assert.match(stage.textContent, /No cars released yet/); assert.match(stage.textContent, /Waiting for 11:30am/);
  f.api.destroy();
});

test('an unavailable controls read hides the section with the feed, and a good read shows it again', async () => {
  let reads = 0; const f = mountConsole({ adapter: { readControls: async () => (++reads === 1 ? { status: 'unavailable' } : ok(readState())) } }); await f.api.ready; await settle();
  const section = f.api.root.querySelector('.gcsp-console-release'); assert.equal(section.hidden, true);
  f.api.root.querySelector('.gcsp-console-screen .vm-status button').click(); await settle(); assert.equal(section.hidden, false); f.api.destroy();
});

test('painted copy has no em dash or banned word', async () => {
  const f = mountConsole(); await f.api.ready; f.api.basic.release.click(); await settle();
  for (const root of [f.api.root.querySelector('.gcsp-console-release')]) { const shown = paint(root); assert.doesNotMatch(shown, /—/); assert.doesNotMatch(shown, /demo|demonstration|synthetic|fictional|example/i); }
  f.api.destroy();
});

test('Today\'s release shows its own skeleton, not the empty state, until the first read lands', async () => {
  const hold = gate(); const f = mount(null, { readLatestRelease: async () => { await hold.wait; return empty; } });
  assert.ok(f.api.root.querySelector('.gcsp-skeleton')); assert.doesNotMatch(f.api.root.textContent, /No cars released yet/);
  assert.equal(f.api.root.querySelector('.gcsp-release-totals'), null); assert.equal(f.api.root.querySelector('[role="status"]'), null);
  const read = f.api.refresh(); hold.open(); await read;
  assert.equal(f.api.root.querySelector('.gcsp-skeleton'), null); assert.match(f.api.root.textContent, /No cars released yet/);
  f.api.destroy();
});

test('inside the console, a slow release read keeps its own skeleton, never the empty state, then shows its result', async () => {
  const hold = gate(); const f = mountConsole({ adapter: { readLatestRelease: async () => { await hold.wait; return latest('run-a', 't1', 3); } } });
  await f.api.ready; await settle(); const stage = f.api.root.querySelector('.gcsp-console-stage'); const section = stage.querySelector('.gcsp-console-release');
  assert.ok(section.querySelector('.gcsp-skeleton')); assert.doesNotMatch(section.textContent, /No cars released yet|Waiting for 11:30am/);
  hold.open(); await settle();
  assert.equal(cells(stage).length, 3); assert.equal(section.querySelector('.gcsp-skeleton'), null);
  f.api.destroy();
});
