import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, resetDom, settle } from './dom-harness.js';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';

let dom; let mod; const cleanups = [];
const states = orderProgressFixtures().states;
const progress = (name) => structuredClone(states[name]);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const account = { status: 'ready', name: 'Paula (synthetic)', context: 'Synthetic order progress' };
const mount = (root, ctx) => { const stop = mod.mountOrderProgress(root, ctx); cleanups.push(stop); return stop; };
const root = () => { const node = document.createElement('div'); document.body.append(node); return node; };
const text = (node) => node.textContent.replace(/\s+/g, ' ');
const button = (node, label) => [...node.querySelectorAll('button')].find((b) => b.textContent.includes(label));

// An adapter over a mutable fixture name: reads reflect `server.name`, commands record and answer as scripted.
function adapter(server, extra = {}) {
  const a = { calls: [], signals: [], loadAccount: async () => account };
  const read = (key, field) => async (input) => { a.calls.push(key); a.signals.push(input?.signal); return structuredClone(progress(server.name)[field]); };
  Object.assign(a, { listOrders: async () => ({ status: 'ok', value: { orders: [{ orderUuid: progress(server.name).stages?.value?.orderUuid ?? 'x', source: { receivedAt: '2026-11-05T09:00:00.000Z' } }] } }),
    readStages: read('readStages', 'stages'), readDocuments: read('readDocuments', 'documents'), readAppointment: read('readAppointment', 'appointment'), readReturnPlan: read('readReturnPlan', 'returnPlan') });
  for (const op of ['completeTask', 'requestAppointment', 'acceptAppointment', 'requestReturn', 'acceptReturn']) {
    a[op] = async (input) => { a.calls.push(op); const out = server.outcome?.(op, input) ?? { status: 'ok', value: {} }; return out; };
  }
  return Object.assign(a, extra);
}
before(async () => { dom = installDom(); mod = await import('../../blocks/gcsp/order-progress/gcsp-order-progress.js'); });
after(() => { cleanups.forEach((c) => c()); dom.window.close(); });
beforeEach(() => { cleanups.splice(0).forEach((c) => c()); resetDom(); });

test('the shell waits for the account, then reads the latest order and shows only what the server confirmed', async () => {
  const loading = deferred(); const server = { name: 'appointment-requested' }; const a = adapter(server, { loadAccount: () => loading.promise });
  const node = root(); const stop = mount(node, { adapter: a, car: orderProgressFixtures().car });
  assert.equal(a.calls.length, 0); loading.resolve(account);
  await settle(node, (r) => r.querySelector('.gcsp-order-progress .gcsp-order-handover'));
  assert.equal(node.querySelector('h1').textContent, 'Order progress'); assert.match(text(node), /Fictional BMW i4/);
  assert.match(text(node), /Not booked yet/); assert.doesNotMatch(text(node), /Booked:/);
  assert.deepEqual(a.calls.filter((c) => c !== 'listOrders').sort(), ['readAppointment', 'readDocuments', 'readReturnPlan', 'readStages']);
  assert.equal(node.querySelector('[aria-current="page"]')?.textContent.includes('Order progress'), true);
  await stop.refresh(); assert.equal(a.calls.filter((c) => c === 'readStages').length, 2);
  stop(); assert.equal(node.childElementCount, 0);
});

test('an account that is not ready, another brand and an external abort never start or keep a read', async () => {
  const server = { name: 'appointment-requested' };
  const refused = adapter(server, { loadAccount: async () => ({ status: 'unavailable' }) }); const one = root(); mount(one, { adapter: refused });
  await settle(one, (r) => r.textContent.includes('Order progress unavailable')); assert.equal(refused.calls.length, 0); assert.equal(one.querySelector('.gcsp-order-progress button').disabled, true);
  const bad = adapter(server); const two = root(); mount(two, { brand: 'mini', adapter: bad }); assert.match(two.textContent, /Not available for this brand/); assert.equal(bad.calls.length, 0);
  const late = deferred(); const abort = new AbortController(); const slow = adapter(server); slow.readStages = (input) => { slow.signals.push(input.signal); return late.promise; };
  const three = root(); mount(three, { adapter: slow, signal: abort.signal }); await settle(three, () => slow.signals.length > 0);
  abort.abort(); assert.equal(slow.signals.at(-1).aborted, true); late.resolve(progress('appointment-requested').stages); await Promise.resolve(); assert.equal(three.childElementCount, 0);
});

test('no order is a plain statement; a failed list or order is unavailable with a working Retry', async () => {
  const none = adapter({ name: 'appointment-requested' }); none.listOrders = async () => ({ status: 'ok', value: { orders: [] } });
  const one = root(); mount(one, { adapter: none }); await settle(one, (r) => r.textContent.includes('No order yet'));
  assert.equal(one.querySelectorAll('.gcsp-order-section').length, 0); assert.equal(none.calls.length, 0);
  const server = { name: 'appointment-requested' }; const a = adapter(server); a.readStages = async () => ({ status: 'unavailable' });
  const two = root(); mount(two, { adapter: a }); await settle(two, (r) => r.textContent.includes('Order progress unavailable'));
  let healthy = false; a.readStages = async () => (healthy ? progress('appointment-requested').stages : { status: 'unavailable' });
  const retry = two.querySelector('.gcsp-order-progress button'); retry.focus(); healthy = true; retry.click();
  await settle(two, (r) => r.querySelector('.gcsp-order-handover')); assert.match(two.textContent, /Not booked yet/);
});

test('a command keeps keyboard focus on a surviving control, otherwise on the message, and reports a refusal', async () => {
  const server = { name: 'sent-to-ordering-no-slot' }; const a = adapter(server);
  const node = root(); mount(node, { adapter: a }); await settle(node, (r) => r.querySelector('.gcsp-order-slots button'));
  server.outcome = () => ({ status: 'unsupported', code: 'live-appointments-unsupported', reason: 'Live handover times are not connected in this demonstration.' });
  const slot = node.querySelector('.gcsp-order-slots button'); const label = slot.textContent; slot.focus(); slot.click();
  await settle(node, (r) => r.querySelector('.gcsp-order-message.is-error'));
  assert.equal(node.querySelector('.gcsp-order-message').hasAttribute('role'), false);
  assert.match(node.querySelector('.gcsp-vh[role="status"]').textContent, /Not done\. Live handover times are not connected/);
  assert.match(text(node), /Not done\. Live handover times are not connected/);
  assert.equal(document.activeElement.textContent, label); assert.equal(document.activeElement.disabled, false);
  server.outcome = () => { server.name = 'appointment-requested'; return { status: 'ok', value: {} }; };
  document.activeElement.click(); await settle(node, (r) => r.textContent.includes('Handover time requested.'));
  assert.equal(node.querySelector('.gcsp-order-slots'), null); assert.match(text(node), /Handover time requested\./);
  assert.equal(document.activeElement, node.querySelector('.gcsp-order-message')); assert.equal(node.querySelector('.gcsp-order-message').hasAttribute('role'), false);
  assert.equal(node.querySelector('.gcsp-vh[role="status"]').textContent, 'Handover time requested.');
});

test('FUCQ-254: a keyboard rebook after a missed handover keeps the update and focus in the Handover section', async () => {
  const server = { name: 'appointment-no-show' }; const a = adapter(server); const gate = deferred(); a.requestAppointment = () => gate.promise;
  const node = root(); mount(node, { adapter: a }); await settle(node, (r) => r.querySelector('.gcsp-order-handover .gcsp-order-slots button'));
  const slot = node.querySelector('.gcsp-order-handover .gcsp-order-slots button'); slot.focus(); slot.click();
  await settle(node, (r) => r.querySelector('.gcsp-order-message'));
  assert.equal(document.activeElement, node.querySelector('.gcsp-order-message')); assert.ok(document.activeElement.closest('.gcsp-order-handover'), 'pending update in Handover');
  server.name = 'appointment-rebooked'; gate.resolve({ status: 'ok', value: {} });
  await settle(node, (r) => r.textContent.includes('Handover time requested.'));
  const live = node.querySelector('.gcsp-order-message');
  assert.equal(live.hasAttribute('role'), false); assert.equal(live.textContent, 'Handover time requested.');
  assert.equal(node.querySelector('.gcsp-vh[role="status"]').textContent, 'Handover time requested.');
  assert.equal(document.activeElement, live); assert.ok(live.closest('.gcsp-order-handover'), 'confirmation in Handover');
});

test('focus moved outside the body stays outside; the controls are disabled while a command is pending', async () => {
  const server = { name: 'sent-to-ordering-no-slot' }; const a = adapter(server); const gate = deferred(); a.requestAppointment = () => gate.promise;
  const outside = document.createElement('button'); outside.textContent = 'Outside'; document.body.append(outside);
  const node = root(); mount(node, { adapter: a }); await settle(node, (r) => r.querySelector('.gcsp-order-slots button'));
  const slot = node.querySelector('.gcsp-order-slots button'); slot.focus(); slot.click();
  await settle(node, (r) => r.querySelector('.gcsp-order-message')); assert.match(text(node), /Updating your order/);
  assert.ok([...node.querySelectorAll('.gcsp-order-slots button')].every((b) => b.disabled)); assert.equal(document.activeElement, node.querySelector('.gcsp-order-message'));
  outside.focus(); server.name = 'appointment-requested'; gate.resolve({ status: 'ok', value: {} });
  await settle(node, (r) => r.textContent.includes('Handover time requested.')); assert.equal(document.activeElement, outside);
});

test('a task, a proposed time and a return choice reach the controller with their ids', async () => {
  const sent = []; const server = { name: 'documents-waiting-for-you', outcome: (op, input) => { sent.push([op, input.itemId ?? input.proposalId ?? input.slotId, input.choice]); return { status: 'ok', value: {} }; } };
  const a = adapter(server); const node = root(); mount(node, { adapter: a }); await settle(node, (r) => r.querySelector('.gcsp-task-list button'));
  node.querySelector('.gcsp-task-list button').click(); await settle(node, () => sent.length === 1);
  server.name = 'appointment-change-proposed';
  const other = root(); mount(other, { adapter: a }); await settle(other, (r) => button(r, 'Accept new time'));
  button(other, 'Accept new time').click(); await settle(other, () => sent.length === 2);
  server.name = 'return-not-planned'; const third = root(); mount(third, { adapter: a }); await settle(third, (r) => r.querySelector('.gcsp-order-choice button'));
  third.querySelector('.gcsp-order-choice button').click(); await settle(third, () => sent.length === 3);
  assert.equal(sent[0][0], 'completeTask'); assert.equal(typeof sent[0][1], 'string');
  assert.deepEqual([sent[1][0], typeof sent[1][1]], ['acceptAppointment', 'string']); assert.deepEqual([sent[2][0], sent[2][2]], ['requestReturn', 'same-visit']);
  const limited = adapter(server); delete limited.requestReturn; delete limited.completeTask;
  const fourth = root(); mount(fourth, { adapter: limited }); await settle(fourth, (r) => r.querySelector('.gcsp-order-return'));
  assert.equal(fourth.querySelector('.gcsp-order-choice button'), null, 'an adapter without the command renders no control');
});

test('help is mounted from the supplied help adapter on a decline and torn down with the page', async () => {
  const reads = []; const help = { readHelp: async () => ({ status: 'ok', value: { opensCase: false, automaticRecoveryPriority: false } }),
    readCases: async (input) => { reads.push(input); return { status: 'ok', value: { cases: [], asOf: '2026-11-05T09:00:00.000Z', policyVersion: 'p' } }; } };
  const node = root(); const stop = mount(node, { adapter: adapter({ name: 'declined' }), helpAdapter: help });
  await settle(node, (r) => r.querySelector('.gcsp-order-help .gcsp-cases-body')); await settle(node, () => reads.length > 0);
  assert.equal(node.querySelectorAll('.gcsp-order-help').length, 1); stop(); assert.equal(node.childElementCount, 0);
});

test('embedded mode draws only the body, with no shell and no account read', async () => {
  const a = adapter({ name: 'ready-for-handover' }); a.loadAccount = async () => { throw new Error('embedded must not load the account'); };
  const node = root(); const stop = mount(node, { adapter: a, embedded: true, headingLevel: 2 });
  await settle(node, (r) => r.querySelector('.gcsp-order-handover'));
  assert.equal(node.querySelector('header, main, nav'), null); assert.equal(node.querySelector('h1'), null); assert.equal(node.querySelector('h2').textContent, 'Order progress');
  assert.ok(node.querySelector('.gcsp .gcsp-order-progress')); assert.match(text(node), /Ready for handover/);
  stop(); assert.equal(node.childElementCount, 0);
});

test('navigation reports the destination and the order progress destination is exported', async () => {
  assert.deepEqual([mod.ORDER_PROGRESS_DESTINATION.key, mod.ORDER_PROGRESS_DESTINATION.label, mod.ORDER_PROGRESS_DESTINATION.available], ['order-progress', 'Order progress', true]);
  const to = []; const node = root();
  mount(node, { adapter: adapter({ name: 'appointment-requested' }), onNavigate: (key) => to.push(key) });
  await settle(node, (r) => r.querySelector('.gcsp-order-handover'));
  const link = [...node.querySelectorAll('a, button')].find((n) => n.textContent.includes('Your car brief')); link.click(); assert.deepEqual(to, ['brief']);
});

test('the custom element survives an early adapter, remounts on change, reads attributes and tears down', async () => {
  const early = document.createElement('gcsp-order-progress'); let reads = 0; const server = { name: 'appointment-scheduled' };
  const a = adapter(server); early.adapter = { ...a, readStages: async (input) => { reads += 1; return a.readStages(input); } };
  early.car = orderProgressFixtures().car; document.body.append(early); assert.equal(reads, 0);
  const Type = mod.defineGcspOrderProgress(dom.window.customElements); assert.equal(mod.defineGcspOrderProgress(dom.window.customElements), Type);
  await settle(early, (r) => r.querySelector('.gcsp-order-handover')); assert.equal(reads, 1); assert.match(early.textContent, /Fictional BMW i4/); assert.match(early.textContent, /Booked:/);
  const first = deferred(); let signal; const next = adapter(server); next.readStages = (input) => { signal = input.signal; return first.promise; };
  early.adapter = next; await settle(early, () => signal); const old = signal;
  early.adapter = adapter(server); assert.equal(old.aborted, true); first.resolve(progress('appointment-scheduled').stages);
  await settle(early, (r) => r.querySelector('.gcsp-order-handover')); await early.refresh();
  const order = document.createElement('gcsp-order-progress'); order.setAttribute('order-uuid', 'fixed-order'); order.setAttribute('embedded', '');
  const fixed = adapter(server); const seen = []; fixed.readStages = async (input) => { seen.push(input.orderUuid); return progress('appointment-scheduled').stages; };
  fixed.listOrders = async () => { throw new Error('a fixed order is never discovered'); };
  order.adapter = fixed; document.body.append(order); await settle(order, () => seen.length > 0); assert.deepEqual(seen, ['fixed-order']);
  early.remove(); order.remove(); assert.equal(early.childElementCount, 0); assert.equal(order.childElementCount, 0);
});

const stale = { status: 'stale-run', reason: 'This request belongs to an earlier demonstration run.' };
function assertRestarted(node, reloads) {
  assert.match(text(node), /Demo restarted/); assert.match(text(node), /Reload the page to continue/);
  assert.doesNotMatch(text(node), /stale-run|\u2014|Your order changed|Order progress unavailable/);
  const buttons = node.querySelectorAll('.gcsp-order-progress button'); assert.equal(buttons.length, 1);
  const [reload] = buttons; assert.equal(reload.type, 'button'); assert.equal(reload.disabled, false); assert.equal(document.activeElement === reload || reload.tabIndex >= 0, true);
  const before = reloads.length; reload.click(); assert.equal(reloads.length, before + 1);
}

test('a stale-run progress read shows the restarted screen with a working Reload', async () => {
  const reloads = []; const a = adapter({ name: 'appointment-requested' }); a.readStages = async () => stale;
  const node = root(); mount(node, { adapter: a, reload: () => reloads.push(1) });
  await settle(node, (r) => r.textContent.includes('Demo restarted')); assertRestarted(node, reloads);
  assert.equal(node.querySelector('h1').textContent, 'Order progress');
});

test('a stale-run order command shows the restarted screen and is neither resent nor reread', async () => {
  const reloads = []; const server = { name: 'sent-to-ordering-no-slot', outcome: () => stale }; const a = adapter(server);
  const node = root(); mount(node, { adapter: a, reload: () => reloads.push(1) });
  await settle(node, (r) => r.querySelector('.gcsp-order-slots button'));
  const request = node.querySelector('.gcsp-order-slots button'); request.focus(); const reads = a.calls.filter((c) => c === 'readStages').length; request.click();
  await settle(node, (r) => r.textContent.includes('Demo restarted')); assert.equal(document.activeElement, node.querySelector('.gcsp-order-progress button')); assertRestarted(node, reloads);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(a.calls.filter((c) => /^(request|accept|complete)/.test(c)).length, 1); assert.equal(a.calls.filter((c) => c === 'readStages').length, reads);
});

test('FUCQ-299: a quiet re-read puts focus back on the same slot when equal times fall on different days', async () => {
  const server = { name: 'sent-to-ordering-no-slot' }; let tick; const a = adapter(server, { subscribeClock: (cb) => { tick = cb; return () => {}; } });
  const node = root(); mount(node, { adapter: a }); await settle(node, (r) => r.querySelector('.gcsp-order-slots button'));
  const slots = () => [...node.querySelectorAll('.gcsp-order-slots button')]; const third = slots()[2]; third.focus();
  assert.equal(third.textContent, slots()[0].textContent); assert.equal(third.getAttribute('aria-label'), 'Request 9 Nov 2026, 09:00');
  const reads = a.calls.filter((c) => c === 'readStages').length; tick(); await settle(node, () => a.calls.filter((c) => c === 'readStages').length > reads);
  await new Promise((r) => setTimeout(r, 30));
  assert.notEqual(slots()[2], third); assert.equal(document.activeElement, slots()[2]); assert.equal(document.activeElement.getAttribute('aria-label'), 'Request 9 Nov 2026, 09:00');
});
