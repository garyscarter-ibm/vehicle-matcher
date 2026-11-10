// FUCQ-362: the Basic body wired to the console: friendly time, journey-driven Release and a confirmed Start again.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom; let consoleMod; let basicMod;
before(async () => {
  dom = new JSDOM('<!doctype html><body class="gcsp"></body>', { url: 'https://example.test/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'HTMLElement', 'customElements']) globalThis[name] = name === 'window' ? dom.window : dom.window[name];
  consoleMod = await import('../../blocks/gcsp/presenter-controls/console.js');
  basicMod = await import('../../blocks/gcsp/presenter-controls/basic-console.js');
});
beforeEach(() => { document.body.replaceChildren(); window.sessionStorage.clear(); window.localStorage.clear(); });
after(() => dom.window.close());
const ok = (value) => ({ status: 'ok', value });
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve)); };
const START = '2026-11-09T09:00:00.000Z';
const main = { scenarioId: 'main-successful-journey', name: 'Main successful journey', scenarioVersion: 'gcsp-acceptance-scenarios-v1',
  fixtureVersion: 'main-successful-journey-inputs-v1', availability: { available: true }, inputs: { briefs: [{ principalId: 'demo-paula' }] }, clockStart: START };
const catalogue = { policyVersion: 'p1', scenarios: [main] };
const state = (extra = {}) => ({ runId: 'run-a', runVersion: 3, now: START, clockVersion: '7', lastTick: null,
  currentScenario: { scenarioId: main.scenarioId, name: main.name, fixtureVersion: main.fixtureVersion },
  principals: [], controls: { step: { value: 60, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'unavailable', reason: 'No future release cue is configured.' } }, ...extra });
function setup(overrides = {}) {
  const host = document.createElement('div'); document.body.append(host); const calls = []; let ids = 0; let current = state();
  const adapter = { readControls: async () => ok(current), readContext: async () => ok({ principalId: 'demo-presenter', roles: ['presenter'] }),
    readScenarios: async () => ok(catalogue), readFaults: async () => ok({ faults: [] }), listOrders: async () => ok({ orders: [] }),
    tick: async (payload) => { calls.push(['tick', payload]); current = state({ now: payload.to, clockVersion: '8' }); return ok({}); },
    reset: async (payload) => { calls.push(['reset', payload]); current = state({ runId: 'run-b', runVersion: 1 }); return ok({ runId: 'run-b', startState: { status: 'ok' } }); },
    switchPrincipal: async () => ok({}), ...overrides };
  const api = consoleMod.mountPresenterConsole(host, { ...basicMod.basicConsoleOptions({ adapter }), commandId: () => `command-${++ids}` });
  return { api, calls, root: api.root, set: (next) => { current = next; } };
}
const text = (root, selector) => root.querySelector(selector).textContent;

test('Basic shows the London clock, the headline and the journey label read from the server', async () => {
  const f = setup(); await f.api.ready; await settle();
  assert.equal(text(f.root, '.gcsp-console-clock'), 'Day 1 · Mon 9 Nov, 9:00am');
  assert.equal(text(f.root, 'h1'), 'Ready for the next release');
  assert.equal(text(f.root, '.gcsp-console-sub'), 'Next release: Tomorrow, 11:30am.');
  assert.equal(f.api.basic.release.textContent, "Release tomorrow's cars"); assert.equal(f.api.basic.release.disabled, false);
  assert.doesNotMatch(f.root.querySelector('.gcsp-console-stage').textContent + text(f.root, '.gcsp-console-head'), /UTC|\dT\d|\btick\b|—|Paula/);
  f.api.destroy();
});

test('Release moves the clock to the next weekday 11:30am through the existing tick path', async () => {
  const f = setup(); await f.api.ready; await settle();
  f.api.basic.release.click(); await settle();
  assert.deepEqual(f.calls, [['tick', { commandId: 'command-1', expectedClockVersion: '7', mode: 'to', to: '2026-11-10T11:30:00.000Z' }]]);
  assert.equal(text(f.root, '[role="status"]'), 'Cars released');
  assert.equal(text(f.root, '.gcsp-console-clock'), 'Day 2 · Tue 10 Nov, 11:30am');
  f.api.basic.release.focus(); f.api.basic.release.click(); await settle();
  assert.equal(document.activeElement, f.api.basic.release, 'keyboard focus stays on Release');
  f.api.destroy();
});

test('an order in progress turns Release into Move on a day; no preferences disables it', async () => {
  const f = setup({ listOrders: async () => ok({ orders: [{ orderUuid: 'o1' }] }) }); await f.api.ready; await settle();
  assert.equal(f.api.basic.release.textContent, 'Move on a day'); assert.equal(text(f.root, 'h1'), 'An order is in progress');
  f.api.basic.release.click(); await settle();
  assert.equal(f.calls[0][1].to, '2026-11-10T11:30:00.000Z'); assert.equal(text(f.root, '[role="status"]'), 'Moved on a day'); f.api.destroy();
  const g = setup({ readScenarios: async () => ok({ ...catalogue, scenarios: [{ ...main, inputs: { briefs: [] } }] }) }); await g.api.ready; await settle();
  assert.equal(g.api.basic.release.textContent, 'Waiting for preferences'); assert.equal(g.api.basic.release.disabled, true);
  g.api.basic.release.click(); await settle(); assert.equal(g.calls.length, 0); g.api.destroy();
});

test('Start again asks first; Cancel and Escape send nothing and return focus', async () => {
  const f = setup(); await f.api.ready; await settle();
  f.api.basic.startAgain.click();
  const dialog = f.root.querySelector('.gcsp-console-confirm');
  assert.equal(dialog.hidden, false); assert.equal(dialog.getAttribute('role'), 'alertdialog'); assert.equal(text(dialog, 'h2'), 'Start again?');
  assert.match(dialog.textContent, /The scheme goes back to day 1 and released cars are cleared\. Employees keep their saved preferences\. The next release brings a new set of cars\./);
  assert.equal(document.activeElement.textContent, 'Start again'); assert.ok(dialog.contains(document.activeElement));
  [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Cancel').click();
  assert.equal(dialog.hidden, true); assert.equal(document.activeElement, f.api.basic.startAgain);
  f.api.basic.startAgain.click(); dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(dialog.hidden, true); assert.equal(f.calls.length, 0);
  assert.equal(f.root.querySelector('.gcsp-console-advanced').hidden, true, 'stays in Basic'); f.api.destroy();
});

test('confirmed Start again resets into a fresh Main successful journey run and shows day 1', async () => {
  const f = setup(); await f.api.ready; await settle();
  f.set(state({ now: '2026-11-10T11:30:00.000Z', clockVersion: '8' })); f.api.basic.release.click(); await settle();
  f.api.basic.startAgain.click();
  [...f.root.querySelectorAll('.gcsp-console-confirm button')].find((b) => b.textContent === 'Start again').click(); await settle();
  const reset = f.calls.find(([kind]) => kind === 'reset')[1];
  assert.deepEqual(reset, { commandId: 'command-2', expectedRunId: 'run-a', expectedRunVersion: 3, scenarioId: 'main-successful-journey',
    scenarioVersion: main.scenarioVersion, fixtureVersion: main.fixtureVersion, policyVersion: 'p1' });
  assert.equal(text(f.root, '[role="status"]'), 'Started again on day 1');
  assert.equal(text(f.root, '.gcsp-console-clock'), 'Day 1 · Mon 9 Nov, 9:00am');
  assert.equal(document.activeElement, f.api.basic.release, 'focus lands on Release after Start again'); f.api.destroy();
});

test('a lost Start again reply retries the exact original command', async () => {
  let first = true;
  const f = setup({ reset: async (payload) => { f.calls.push(['reset', payload]); if (first) { first = false; return { status: 'unavailable', lostResponse: true, retryable: true }; } return ok({ runId: 'run-b' }); } });
  await f.api.ready; await settle();
  const confirm = () => { f.api.basic.startAgain.click(); [...f.root.querySelectorAll('.gcsp-console-confirm button')].find((b) => b.textContent === 'Start again').click(); };
  confirm(); await settle();
  assert.equal(text(f.root, '[role="status"]'), 'Start again not confirmed. Press Start again to retry.');
  confirm(); await settle();
  const resets = f.calls.filter(([kind]) => kind === 'reset').map(([, body]) => body);
  assert.equal(resets.length, 2); assert.deepEqual(resets[1], resets[0]); f.api.destroy();
});

test('a second Start again after more releases sends the current run, not the first one', async () => {
  const f = setup({ tick: async (payload) => { f.calls.push(['tick', payload]); f.set(state({ runId: 'run-b', runVersion: 4, now: payload.to, clockVersion: '9' })); return ok({}); } });
  await f.api.ready; await settle();
  const confirm = () => { f.api.basic.startAgain.click(); [...f.root.querySelectorAll('.gcsp-console-confirm button')].find((b) => b.textContent === 'Start again').click(); };
  confirm(); await settle();
  f.api.basic.release.click(); await settle();
  confirm(); await settle();
  const resets = f.calls.filter(([kind]) => kind === 'reset').map(([, body]) => body);
  assert.equal(resets.length, 2); assert.equal(resets[0].expectedRunId, 'run-a');
  assert.equal(resets[1].expectedRunId, 'run-b'); assert.equal(resets[1].expectedRunVersion, 4); f.api.destroy();
});
