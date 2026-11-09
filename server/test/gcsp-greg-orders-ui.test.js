import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createGregOrdersHttpAdapter } from '../../blocks/gcsp/greg-orders/http-adapter.js';

let mountGregOrders; let defineGcspGregOrders;
before(async () => {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://greg.test', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'CustomEvent', 'customElements']) Object.defineProperty(globalThis, key,
    { value: key === 'window' ? window : window[key], configurable: true, writable: true });
  ({ mountGregOrders, defineGcspGregOrders } = await import('../../blocks/gcsp/greg-orders/greg-orders.js'));
});
beforeEach(() => document.body.replaceChildren());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const view = (stage = null) => ({ runId: 'explicit-ui-fixture', asOf: '2026-11-06T09:00:00.000Z', versions: { policy: 'policy-a', stock: 'stock-a' },
  adapter: { status: 'ready', choices: [{ model: '3 Series', derivative: '320i Touring' }] },
  requests: stage ? [{ requestId: 'request-a', version: 2, model: '3 Series', derivative: '320i Touring', quantity: 3, stage,
    confirmedQuantity: stage === 'requested' ? 0 : stage === 'partly-confirmed' || stage === 'delayed' ? 1 : 3,
    outstandingQuantity: stage === 'requested' ? 3 : stage === 'partly-confirmed' || stage === 'delayed' ? 2 : 0,
    releasedQuantity: stage === 'released' ? 3 : 0,
    supplies: stage === 'requested' ? [] : [{ supplyId: 'supply-a', quantity: stage === 'partly-confirmed' || stage === 'delayed' ? 1 : 3,
      expectedAt: '2027-01-01T09:00:00.000Z', queued: true }],
    delay: stage === 'delayed' ? { until: '2027-02-01T00:00:00.000Z', reason: 'Explicit synthetic delay' } : null,
    latestReleasedAt: stage === 'released' ? '2027-01-01T09:00:00.000Z' : null }] : [] });
const ok = (value) => ({ status: 'ok', value });
async function setup(value = view(), extra = {}, options = {}) {
  const root = document.createElement('section'); document.body.append(root);
  const adapter = { loadTracking: async () => ok(value), ...extra };
  const teardown = mountGregOrders(root, { adapter, newCommandId: () => 'stable-ui-command', ...options }); await tick();
  return { root, adapter, teardown };
}
const byLabel = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);

test('empty, requested, partly confirmed, delayed, released and unavailable adapter keep distinct visible facts', async () => {
  for (const stage of [null, 'requested', 'partly-confirmed', 'delayed', 'released']) {
    const { root, teardown } = await setup(view(stage));
    assert.equal(root.querySelectorAll('table').length, 1);
    if (!stage) assert.match(root.textContent, /No requests yet/);
    else {
      const cells = [...root.querySelectorAll('tbody tr > *')].map((n) => n.textContent);
      assert.equal(cells[2], '3'); assert.equal(cells[4], stage === 'released' ? '3' : '0');
      if (stage === 'delayed') assert.match(cells[5], /2 delayed until 1 Feb 2027: Explicit synthetic delay/);
    }
    teardown();
  }
  const value = view('requested'); value.adapter = { status: 'unavailable' };
  const { root, teardown } = await setup(value);
  assert.match(root.textContent, /Saved requests remain visible/); assert.match(root.querySelector('tbody').textContent, /Requested/);
  assert.equal(byLabel(root, 'Submit request').disabled, true); assert.equal(byLabel(root, 'Refresh orders').disabled, false); teardown();
});

test('submission preserves native form focus and retries the exact command after an unknown response', async () => {
  const inputs = []; let attempts = 0;
  const { root, teardown } = await setup(view(), { submit: async (input) => { inputs.push(input); return ++attempts === 1
    ? { status: 'unavailable', reason: 'Explicit lost response; retry.' } : ok({}); } });
  const quantity = root.querySelector('input[type="number"]'); quantity.value = '2'; quantity.focus();
  const form = quantity.closest('form'); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.equal(document.activeElement, quantity); assert.equal(quantity.value, '2');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.equal(inputs.length, 2); assert.deepEqual(inputs[1], inputs[0]); assert.equal(inputs[0].quantity, 2);
  assert.equal(inputs[0].expectedStockVersion, 'stock-a'); assert.equal(inputs[0].commandId, 'stable-ui-command'); teardown();
});

test('presenter confirmation precedes acting Greg queue; queue failure remains recoverable', async () => {
  let value = view('requested'); const calls = [];
  const { root, teardown } = await setup(value, {
    loadTracking: async () => ok(value),
    stepProduction: async (input) => { calls.push(['production', input]); value = view('partly-confirmed'); value.requests[0].supplies[0].queued = false; return ok({}); },
    queueConfirmed: async (input) => { calls.push(['queue', input]); return { status: 'unavailable' }; },
  }, { productionControls: true });
  const details = root.querySelector('details'); details.open = true;
  const form = details.querySelector('form'); form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.deepEqual(calls.map(([kind]) => kind), ['production', 'queue']);
  assert.equal(calls[0][1].expectedVersion, 2); assert.equal(calls[0][1].quantity, 1);
  assert.match(root.textContent, /Confirmation saved. Release queue unavailable/);
  assert.ok(byLabel(root, 'Retry release queue')); teardown();
});

test('registered element embeds, propagates changes, tears down; malformed and refused reads fail visibly', async () => {
  defineGcspGregOrders(); defineGcspGregOrders();
  const element = document.createElement('gcsp-greg-orders'); element.adapter = { loadTracking: async () => ok(view()) };
  document.body.append(element); await tick(); assert.ok(element.querySelector('table'));
  element.remove(); assert.equal(element.childNodes.length, 0);
  for (const out of [{ status: 'forbidden' }, ok({ requests: [{}], adapter: { status: 'ready' }, versions: {} })]) {
    const { root, teardown } = await setup(view(), { loadTracking: async () => out });
    assert.ok(root.querySelector('[role="alert"]')); assert.equal(root.querySelector('table'), null); teardown();
  }
});

test('HTTP transport includes credentials and exact body; failure never invents success', async () => {
  const calls = []; const adapter = createGregOrdersHttpAdapter({ base: 'https://api.test', fetchImpl: async (...args) => {
    calls.push(args); return { json: async () => ok(view()) }; } });
  assert.equal((await adapter.loadTracking()).status, 'ok');
  const input = { commandId: 'request-a', quantity: 2 }; await adapter.submit(input); await adapter.stepProduction(input); await adapter.queueConfirmed(input);
  assert.deepEqual(calls.map(([url]) => url), ['https://api.test/api/gcsp/greg/orders', 'https://api.test/api/gcsp/greg/orders',
    'https://api.test/api/gcsp/presenter/production', 'https://api.test/api/gcsp/greg/orders/queue']);
  assert.ok(calls.every(([, options]) => options.credentials === 'include'));
  assert.deepEqual(JSON.parse(calls[1][1].body), input);
  assert.equal((await createGregOrdersHttpAdapter({ fetchImpl: async () => { throw Error('private'); } }).submit(input)).status, 'unavailable');
});

test('new block source uses shared kit and has no inline code or CSP-forbidden execution', async () => {
  const base = new URL('../../blocks/gcsp/greg-orders/', import.meta.url);
  const source = (await Promise.all((await readdir(base)).filter((p) => /\.(?:js|html)$/.test(p)).map((p) => readFile(new URL(p, base), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(|<[^>]+\son\w+\s*=|\.on\w+\s*=|setAttribute\s*\(\s*['"]on|<script\b[^>]*>\s*[^<\s]|set(?:Timeout|Interval)\s*\(\s*['"`]/i);
  assert.match(source, /kit\/data-table/); assert.match(source, /kit\/form-controls/); assert.match(source, /vehicle-matcher\/ui/);
});

const lapsed = (status = 401, body = { error: 'Unauthorized' }) => async () => ({ ok: false, status, json: async () => { if (body === undefined) throw new SyntaxError('not json'); return body; } });
test('a 401 with no status (lapsed access key) reads access-required; a status keeps its own result', async () => {
  for (const body of [{ error: 'Unauthorized' }, undefined]) {
    const adapter = createGregOrdersHttpAdapter({ fetchImpl: lapsed(401, body) });
    assert.deepEqual(await adapter.loadTracking(), { status: 'access-required' });
    assert.deepEqual(await adapter.submit({ commandId: 'c' }), { status: 'access-required' });
  }
  for (const status of [401, 403]) assert.deepEqual(await createGregOrdersHttpAdapter({ fetchImpl: lapsed(status, { status: 'forbidden' }) }).loadTracking(), { status: 'forbidden' });
  assert.equal((await createGregOrdersHttpAdapter({ fetchImpl: lapsed(500, undefined) }).loadTracking()).status, 'unavailable');
});

test('a lapsed access key shows the restart screen on load and after a failed command', async () => {
  const lapsed = async () => ({ status: 'access-required' });
  const { root, teardown } = await setup(view(), { loadTracking: lapsed });
  const alert = root.querySelector('[role="alert"]'); assert.match(alert.textContent, /Demo restarted/);
  assert.deepEqual([...alert.querySelectorAll('button')].map((b) => b.textContent), ['Reload']); assert.doesNotMatch(root.textContent, /could not be loaded/); teardown();
  let reads = 0; const next = await setup(view(), { loadTracking: async () => (++reads === 1 ? ok(view()) : { status: 'access-required' }), submit: lapsed });
  const form = next.root.querySelector('input[type="number"]').closest('form');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.match(next.root.textContent, /Demo restarted/); assert.doesNotMatch(next.root.textContent, /are unavailable/); next.teardown();
});
