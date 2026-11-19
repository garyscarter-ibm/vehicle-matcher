// FUCQ-285: the presenter strip's success text clears after a short delay and failures stay.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://live-regions.test/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'CustomEvent', 'customElements']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : dom.window[key], configurable: true });
}
const { mountPresenterControls } = await import('../../blocks/gcsp/presenter-controls/controls.js');

const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };
beforeEach(() => document.body.replaceChildren());
after(() => dom.window.close());

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitMs = async (check) => { for (let i = 0; i < 100 && !check(); i += 1) await pause(10); assert.ok(check(), 'Expected state was not reached'); };
const click = (scope, label) => { const node = [...scope.querySelectorAll('button')].find((b) => b.textContent === label || b.textContent.startsWith(`${label} (`)); assert.ok(node, label); node.click(); return node; };

test('presenter success text clears after a short delay and failures stay', async (t) => {
  const host = root(); const ok = (value) => ({ status: 'ok', value });
  const adapter = { readControls: async () => ok({ runId: 'run-a', runVersion: 1, now: '2026-11-05T09:00:00.000Z', clockVersion: '1',
      principals: [{ principalId: 'p1', name: 'P one', roles: ['employee'] }], controls: { step: { value: 37, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'unavailable' } } }),
    readContext: async () => ok({ principalId: 'p1', name: 'P one', roles: ['employee'] }), readScenarios: async () => ok({ policyVersion: 'p', scenarios: [] }),
    tick: async () => (fail ? { status: 'unavailable', reason: 'No clock.' } : ok({})) };
  let fail = false; let ids = 0;
  const controls = mountPresenterControls(host, { adapter, commandId: () => `c-${++ids}`, clearAfter: 25 }); t.after(() => controls.destroy());
  const message = () => host.querySelector('.gcsp-presenter-controls .gcsp-note[role=status]');
  await waitMs(() => message().textContent === 'Presenter controls ready');
  await waitMs(() => message().textContent === ''); click(host, 'Tick');
  await waitMs(() => message().textContent === 'Action recorded'); assert.equal(message().textContent, 'Action recorded');
  await waitMs(() => message().textContent === ''); fail = true; click(host, 'Tick');
  await waitMs(() => /Action not completed/.test(message().textContent)); await new Promise((resolve) => setTimeout(resolve, 80));
  assert.match(message().textContent, /Action not completed/);
});
