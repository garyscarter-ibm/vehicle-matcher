import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, settle } from './dom-harness.js';
import { activityFixtures } from '../../blocks/gcsp/activity/activity-fixtures.js';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';
import { orderCopy } from '../../blocks/gcsp/order-progress/order-progress-copy.js';

let dom; let activity; let orders; let controls; const cleanups = [];
const account = { status: 'ready', name: 'Paula (synthetic)', context: 'Synthetic presenter refresh' };
const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };
const act = (host) => host.dispatchEvent(new dom.window.CustomEvent('gcsp:presenter-action', { bubbles: true, detail: { kind: 'tick' } }));
const pause = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
// Records whether any repaint ever drew the given loading text after `watch()` was called.
function loadingWatch(node, needle) {
  const seen = []; const observer = new dom.window.MutationObserver((records) => {
    for (const record of records) for (const added of record.addedNodes) if ((added.textContent || '').includes(needle)) seen.push(needle);
  });
  observer.observe(node, { childList: true, subtree: true }); return { seen, stop: () => observer.disconnect() };
}

before(async () => {
  dom = installDom();
  activity = await import('../../blocks/gcsp/activity/gcsp-activity.js');
  orders = await import('../../blocks/gcsp/order-progress/gcsp-order-progress.js');
  controls = await import('../../blocks/gcsp/presenter-controls/controls.js');
});
after(() => { cleanups.forEach((c) => c()); dom.window.close(); });
beforeEach(() => { cleanups.splice(0).forEach((c) => c()); resetDom(); dom.window.localStorage.clear(); });

test('activity: one presenter action re-reads once, quietly, keeps focus and announces only a change', async () => {
  const snap = (name) => structuredClone(activityFixtures.snapshots[name]);
  let current = snap('never-checked'); let reads = 0; const node = root();
  const stop = activity.mountActivity(node, { adapter: { loadAccount: async () => account, readActivity: async () => { reads += 1; return structuredClone(current); },
    subscribeClock: controls.subscribePresenterActions(node) } });
  cleanups.push(stop);
  await settle(node, (r) => r.querySelector('.gcsp-activity-status')?.textContent === 'Active');
  const trigger = node.querySelector('.gcsp-action-trigger'); trigger.focus(); assert.equal(reads, 1);
  const watch = loadingWatch(node, 'Loading activity'); const note = node.querySelector('.gcsp-activity-announcement');
  current = snap('offer'); act(node);
  await settle(node, () => reads === 2 && node.querySelector('.gcsp-activity img, .gcsp-activity a[href]'));
  await pause(); assert.equal(reads, 2); assert.deepEqual(watch.seen, []);
  assert.equal(document.activeElement, node.querySelector('.gcsp-action-trigger')); assert.notEqual(document.activeElement, trigger);
  assert.equal(note.textContent, 'Activity updated.');
  act(node); await settle(node, () => reads === 3); await pause();
  assert.equal(reads, 3); assert.deepEqual(watch.seen, []); assert.equal(note.textContent, '');
  assert.equal(document.activeElement, node.querySelector('.gcsp-action-trigger'));
  watch.stop(); stop(); act(node); await pause(); assert.equal(reads, 3);
});

test('order progress: one presenter action re-reads once, keeps the focused button and announces once', async () => {
  const states = orderProgressFixtures().states; let name = 'appointment-requested'; let reads = 0;
  const read = (field) => async () => { if (field === 'stages') reads += 1; return structuredClone(states[name][field]); };
  const node = root();
  const adapter = { loadAccount: async () => account, subscribeClock: controls.subscribePresenterActions(node),
    listOrders: async () => ({ status: 'ok', value: { orders: [{ orderUuid: states[name].stages.value.orderUuid, source: { receivedAt: '2026-11-05T09:00:00.000Z' } }] } }),
    readStages: read('stages'), readDocuments: read('documents'), readAppointment: read('appointment'), readReturnPlan: read('returnPlan'),
    completeTask: async () => ({ status: 'ok', value: {} }) };
  const stop = orders.mountOrderProgress(node, { adapter }); cleanups.push(stop);
  const find = () => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Acknowledge the agreement');
  await settle(node, () => find()); assert.equal(reads, 1);
  const button = find(); button.focus(); const live = node.querySelector('.gcsp-vh[aria-live="polite"][aria-atomic="true"]');
  assert.ok(live); assert.equal(live.textContent, ''); const watch = loadingWatch(node, orderCopy.loading);
  name = 'documents-waiting-for-you'; act(node);
  await settle(node, () => reads === 2 && live.textContent !== ''); await pause();
  assert.equal(reads, 2); assert.deepEqual(watch.seen, []); assert.equal(live.textContent, 'Order progress updated.');
  assert.ok(find()); assert.equal(document.activeElement, find()); assert.equal(node.querySelector('.gcsp-order-message'), null);
  assert.equal(node.querySelectorAll('.gcsp-vh[aria-live]').length, 1);
  live.textContent = ''; act(node); await settle(node, () => reads === 3); await pause();
  assert.equal(live.textContent, ''); assert.equal(document.activeElement, find());
  watch.stop(); await stop.sync(); assert.equal(reads, 4); stop(); act(node); await pause(); assert.equal(reads, 4);
});

test('a subscription hears same-page events and the cross-tab storage key, ignores other keys and unsubscribes both', () => {
  const host = root(); const heard = []; const off = controls.subscribePresenterActions(host)(() => heard.push('x'));
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
  const proto = Object.getPrototypeOf(dom.window.localStorage); const original = proto.setItem;
  proto.setItem = () => { throw new Error('blocked'); };
  try { const seen = []; host.addEventListener('gcsp:presenter-action', () => seen.push(1)); tick().click(); await pause(); assert.equal(seen.length, 1); }
  finally { proto.setItem = original; }
});
