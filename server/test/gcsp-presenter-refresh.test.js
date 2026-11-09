import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, settle } from './dom-harness.js';
import { activityFixtures } from '../../blocks/gcsp/activity/activity-fixtures.js';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';
import { orderCopy } from '../../blocks/gcsp/order-progress/order-progress-copy.js';
import { accountFixture } from '../../blocks/gcsp/account/fixtures.js';
import { fixtureMessages } from '../../blocks/gcsp/presenter/fixtures.js';

let dom; let activity; let orders; let controls; let journey; let outbox; const cleanups = [];
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
  journey = await import('../../blocks/gcsp/manual-setup/journey.js');
  outbox = await import('../../blocks/gcsp/presenter/gcsp-outbox.js');
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
  const button = find(); button.focus(); const live = node.querySelector('.gcsp-vh[role="status"][aria-atomic="true"]');
  assert.ok(live); assert.equal(live.textContent, ''); const watch = loadingWatch(node, orderCopy.loading);
  name = 'documents-waiting-for-you'; act(node);
  await settle(node, () => reads === 2 && live.textContent !== ''); await pause();
  assert.equal(reads, 2); assert.deepEqual(watch.seen, []); assert.equal(live.textContent, 'Order progress updated.');
  assert.ok(find()); assert.equal(document.activeElement, find()); assert.equal(node.querySelector('.gcsp-order-message'), null);
  assert.equal(node.querySelectorAll('.gcsp-vh[role="status"]').length, 1);
  live.textContent = ''; act(node); await settle(node, () => reads === 3); await pause();
  assert.equal(live.textContent, ''); assert.equal(document.activeElement, find());
  watch.stop(); await stop.sync(); assert.equal(reads, 4); stop(); act(node); await pause(); assert.equal(reads, 4);
});

test('account: one presenter action re-reads once, keeps the shell and order card, focus and announces only a change', async () => {
  const states = orderProgressFixtures().states['appointment-requested']; let uuid = states.stages.value.orderUuid;
  const n = { account: 0, draft: 0, list: 0, stages: 0 }; let asOf = '2026-11-05T09:00:00.000Z'; let accountOk = true;
  const first = uuid;
  const read = (field) => async () => { if (field === 'stages') n.stages += 1; return JSON.parse(JSON.stringify(states[field]).replaceAll(first, uuid)); };
  const orderAdapter = { listOrders: async () => { n.list += 1; return { status: 'ok', value: { orders: [{ orderUuid: uuid, source: { receivedAt: '2026-11-05T09:00:00.000Z' } }] } }; },
    readStages: read('stages'), readDocuments: read('documents'), readAppointment: read('appointment'), readReturnPlan: read('returnPlan') };
  const adapter = { readAccount: async () => { n.account += 1; if (!accountOk) return { status: 'unavailable' }; const out = structuredClone(accountFixture('ready')); out.value.asOf = asOf; return out; },
    readDraft: async () => { n.draft += 1; return { status: 'not-found' }; }, startJourney: async () => ({ status: 'unavailable' }) };
  const node = root();
  const stop = journey.mountManualJourney(node, { adapter, orderAdapter, subscribeClock: controls.subscribePresenterActions(node) }); cleanups.push(stop);
  const refreshButton = () => [...node.querySelectorAll('button')].find((b) => b.textContent === 'Refresh account');
  await settle(node, () => refreshButton() && node.querySelector('.gcsp-account-order .gcsp-order-progress')); await pause();
  assert.deepEqual(n, { account: 1, draft: 1, list: 1, stages: 1 });
  const shell = node.firstElementChild; const main = node.querySelector('main'); const area = node.querySelector('.gcsp-account-order'); const card = area.firstElementChild;
  const live = [...node.children].find((child) => child.matches('.gcsp-vh[role="status"][aria-atomic="true"]')); assert.ok(live); assert.equal(live.textContent, '');
  const old = refreshButton(); old.focus(); const watch = loadingWatch(node, 'Loading your account and cars.');
  asOf = '2026-11-05T09:30:00.000Z'; act(node);
  await settle(node, () => live.textContent !== ''); await pause();
  assert.deepEqual(n, { account: 2, draft: 2, list: 2, stages: 2 }); assert.deepEqual(watch.seen, []); assert.equal(live.textContent, 'Account updated.');
  assert.equal(node.firstElementChild, shell); assert.equal(node.querySelector('main'), main); assert.equal(node.querySelector('.gcsp-account-order'), area);
  assert.equal(area.firstElementChild, card); assert.match(node.textContent, /Account as of/);
  assert.notEqual(refreshButton(), old); assert.equal(document.activeElement, refreshButton());
  live.textContent = ''; act(node); await settle(node, () => n.account === 3); await pause();
  assert.equal(n.list, 3); assert.equal(live.textContent, ''); assert.equal(document.activeElement, refreshButton());
  accountOk = false; act(node); await settle(node, () => n.account === 4); await pause();
  assert.equal(live.textContent, ''); assert.equal(node.querySelector('main [role="alert"]'), null); assert.equal(node.querySelector('.gcsp-account-order'), area);
  accountOk = true; uuid = 'order-changed'; act(node); await settle(node, () => live.textContent !== ''); await pause();
  assert.equal(live.textContent, 'Account updated.'); assert.notEqual(node.querySelector('.gcsp-account-order'), area); assert.equal(node.querySelector('main'), main);
  watch.stop(); stop(); act(node); await pause(); assert.equal(n.account, 5);
});

test('outbox: one presenter action re-reads once, no loading note, keeps selection and focus, repaints only on change', async () => {
  let messages = fixtureMessages(); let loads = 0; let fail = false; const node = root();
  const stop = outbox.mountOutbox(node, { loadMessages: async () => { loads += 1; return fail ? { status: 'unavailable' } : { status: 'ready', messages: structuredClone(messages) }; },
    subscribeClock: controls.subscribePresenterActions(node) }); cleanups.push(stop);
  const rows = () => [...node.querySelectorAll('.gcsp-mail-row')]; const status = node.querySelector('.gcsp-presenter-count');
  await settle(node, () => rows().length === 4); assert.equal(loads, 1);
  rows()[1].click(); const pickedId = rows()[1].dataset.id; rows()[1].focus();
  const list = node.querySelector('.gcsp-mail'); const watch = loadingWatch(node, 'Loading captured emails.');
  act(node); await settle(node, () => loads === 2); await pause();
  assert.equal(node.querySelector('.gcsp-mail'), list); assert.equal(rows().length, 4); assert.deepEqual(watch.seen, []);
  const added = { ...structuredClone(messages[0]), jobId: 'job-005', time: '2026-11-05T09:40:00.000Z' }; messages = [added, ...messages];
  act(node); await settle(node, () => rows().length === 5); await pause();
  assert.equal(loads, 3); assert.deepEqual(watch.seen, []); assert.equal(status.textContent, '5 captured emails, newest first.');
  assert.equal(rows().find((row) => row.getAttribute('aria-current') === 'true').dataset.id, pickedId);
  assert.equal(document.activeElement.dataset.id, pickedId); assert.notEqual(node.querySelector('.gcsp-mail'), list);
  fail = true; act(node); await settle(node, () => loads === 4); await pause();
  assert.equal(rows().length, 5); assert.equal(node.querySelector('.gcsp-presenter-body [role="alert"]'), null); assert.deepEqual(watch.seen, []);
  watch.stop(); stop(); act(node); await pause(); assert.equal(loads, 4);
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
