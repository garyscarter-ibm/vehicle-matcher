import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, settle } from './dom-harness.js';

let dom; let actions; let controls; const cleanups = [];
const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };
const act = (host) => host.dispatchEvent(new dom.window.CustomEvent('gcsp:presenter-action', { bubbles: true, detail: { kind: 'tick' } }));
const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
before(async () => {
  dom = installDom();
  controls = await import('../../blocks/gcsp/presenter-controls/controls.js');
  actions = await import('../../blocks/gcsp/kit/presenter-actions.js');
});
after(() => { cleanups.forEach((c) => c()); dom.window.close(); });
beforeEach(() => { cleanups.splice(0).forEach((c) => c()); resetDom(); dom.window.localStorage.clear(); });

test('a subscription hears same-page events and the cross-tab storage key, ignores other keys and unsubscribes both', () => {
  const host = root(); const heard = []; const off = actions.subscribePresenterActions(host)(() => heard.push('x'));
  const storage = (key) => dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key }));
  act(host); assert.equal(heard.length, 1);
  storage('gcsp:presenter-action'); assert.equal(heard.length, 2);
  storage('something-else'); storage(null); assert.equal(heard.length, 2);
  off(); off(); act(host); storage('gcsp:presenter-action'); assert.equal(heard.length, 2);
});

test('a successful strip action writes the cross-tab key and survives blocked storage; failures and reset write nothing', async () => {
  const ok = (value) => ({ status: 'ok', value });
  const state = { runId: 'run-a', runVersion: 1, now: '2026-11-05T09:00:00.000Z', clockVersion: '1',
    currentScenario: { scenarioId: 'mechanics', name: 'Clock mechanics' }, lastTick: null,
    principals: [{ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }],
    controls: { step: { value: 37, unit: 'seconds' }, namedTimes: { release: '2026-11-05T10:00:00.000Z' }, nextRelease: { status: 'available', at: '2026-11-05T10:00:00.000Z' } } };
  let fail = false;
  const adapter = { readControls: async () => ok(state), readContext: async () => ok({ principalId: 'employee-test', name: 'Employee test', roles: ['employee'] }),
    readScenarios: async () => ok({ policyVersion: 'p', scenarios: [{ scenarioId: 'mechanics', name: 'Clock mechanics', scenarioVersion: 'v1', fixtureVersion: 'f1', availability: { available: true } }] }), tick: async () => (fail ? { status: 'forbidden' } : ok({})), reset: async () => ok({ runId: 'run-new' }) };
  const host = root(); const strip = controls.mountPresenterControls(host, { adapter, commandId: () => `c-${Math.random()}`, navigate() {} }); cleanups.push(() => strip.destroy());
  const tick = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Tick' || b.textContent.startsWith('Tick ('));
  await settle(host, () => tick()); await pause(); fail = true; tick().click(); await pause();
  assert.equal(dom.window.localStorage.getItem('gcsp:presenter-action'), null);
  fail = false; tick().click(); await pause();
  const written = JSON.parse(dom.window.localStorage.getItem('gcsp:presenter-action'));
  assert.equal(written.kind, 'tick'); assert.ok(Number.isFinite(written.at));
  assert.equal(actions.PRESENTER_ACTION_KEY, 'gcsp:presenter-action'); assert.notEqual(dom.window.localStorage.getItem(actions.PRESENTER_ACTION_KEY), null);
  const proto = Object.getPrototypeOf(dom.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('blocked'); };
  try { const seen = []; host.addEventListener('gcsp:presenter-action', () => seen.push(1)); tick().click(); await pause(); assert.equal(seen.length, 1); }
  finally { proto.setItem = original; }
});
