import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let attachGregOrders;
before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://greg.test', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'customElements']) Object.defineProperty(globalThis, key,
    { value: key === 'window' ? window : window[key], configurable: true, writable: true });
  const { defineGcspGregDashboard } = await import('../../blocks/gcsp/greg/gcsp-greg.js');
  defineGcspGregDashboard();
  try { ({ attachGregOrders } = await import('../../blocks/gcsp/greg-orders/runtime.js')); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
});
beforeEach(() => document.body.replaceChildren());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const tracking = { runId: 'explicit-attachment-fixture', asOf: '2026-11-06T09:00:00.000Z',
  versions: { policy: 'policy-a', stock: 'stock-a' }, adapter: { status: 'ready', choices: [{ model: '3 Series', derivative: '320i Touring' }] }, requests: [] };
const adapter = { loadTracking: async () => ({ status: 'ok', value: structuredClone(tracking) }) };
function dashboard(fixture = 'populated') {
  const node = document.createElement('gcsp-greg-dashboard'); node.setAttribute('fixture', fixture); document.body.append(node); return node;
}

// Removing the ready-event attachment must lose tracking after a real dashboard remount.
test('attachment follows the real dashboard reserved region across remounts without duplicating the shell', async () => {
  assert.equal(typeof attachGregOrders, 'function', 'F104 needs the reusable host attachment');
  const host = dashboard(); const stop = attachGregOrders(host, { adapter }); await settle();
  const first = host.regions.orderTracking;
  assert.equal(first.querySelectorAll('gcsp-greg-orders').length, 1);
  assert.match(first.textContent, /No requests yet/);
  host.setAttribute('fixture', 'empty'); await settle();
  assert.notEqual(host.regions.orderTracking, first);
  assert.equal(host.querySelectorAll('gcsp-greg-orders').length, 1);
  assert.equal(host.querySelectorAll('header').length, 1); assert.equal(host.querySelectorAll('h1').length, 1);
  assert.equal(first.querySelector('gcsp-greg-orders'), null);
  stop(); assert.equal(host.querySelector('gcsp-greg-orders'), null);
  host.setAttribute('fixture', 'populated'); await settle(); assert.equal(host.querySelector('gcsp-greg-orders'), null);
});

// Dropping the orders-changed bridge would leave the already-visible demand figures stale.
test('order changes refresh the same real demand dashboard and keep production controls host-selected', async () => {
  assert.equal(typeof attachGregOrders, 'function');
  const host = dashboard('refresh'); const stop = attachGregOrders(host, { adapter }); await settle();
  assert.match(host.querySelector('.gcsp-greg-meta').textContent, /09:40/);
  const orders = host.querySelector('gcsp-greg-orders'); assert.equal(orders.querySelector('details').hidden, true);
  orders.dispatchEvent(new CustomEvent('gcsp:orders-changed', { bubbles: true })); await settle();
  assert.match(host.querySelector('.gcsp-greg-meta').textContent, /10:25/);
  assert.equal(host.querySelector('gcsp-greg-orders'), orders);
  stop(); const presenterStop = attachGregOrders(host, { adapter, productionControls: true }); await settle();
  assert.equal(host.querySelector('gcsp-greg-orders details').hidden, false); presenterStop();
});

// A leftover old attachment would keep obsolete ready listeners and recreate tracking after abort.
test('replacement and abort detach old tracking and restore the reserved region', async () => {
  assert.equal(typeof attachGregOrders, 'function');
  const host = dashboard(); const firstStop = attachGregOrders(host, { adapter }); await settle();
  const originalOrders = host.querySelector('gcsp-greg-orders');
  const abort = new AbortController(); const stop = attachGregOrders(host, { adapter, signal: abort.signal }); await settle();
  assert.equal(host.querySelectorAll('gcsp-greg-orders').length, 1); assert.equal(originalOrders.isConnected, false);
  firstStop(); assert.equal(host.querySelectorAll('gcsp-greg-orders').length, 1);
  abort.abort(); assert.equal(host.querySelector('gcsp-greg-orders'), null);
  assert.ok(host.regions.orderTracking.classList.contains('gcsp-greg-region'));
  assert.match(host.regions.orderTracking.textContent, /Order tracking is not built/);
  host.setAttribute('fixture', 'empty'); await settle(); assert.equal(host.querySelector('gcsp-greg-orders'), null);
  stop();
});
