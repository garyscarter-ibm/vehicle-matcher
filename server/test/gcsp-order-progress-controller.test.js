import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderProgressController, latestOrderId } from '../../blocks/gcsp/order-progress/order-progress-controller.js';
import { orderProgressFixtures } from '../../blocks/gcsp/order-progress/fixtures.js';

const states = orderProgressFixtures().states;
const progress = (name = 'appointment-requested') => structuredClone(states[name]);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const order = (orderUuid, receivedAt) => ({ orderUuid, source: { receivedAt } });

// A fake server: tests change `server` and every read reflects it, as the real producers do.
function fake(name = 'appointment-requested', extra = {}) {
  const server = { progress: progress(name), orders: [{ orderUuid: progress(name).stages.value.orderUuid }], listed: undefined, ...extra };
  const calls = []; const signals = [];
  const read = (key, field) => async (input) => { calls.push([key, input?.orderUuid]); signals.push(input?.signal); return structuredClone(server.progress[field]); };
  const adapter = {
    listOrders: async (input) => { calls.push(['listOrders']); signals.push(input?.signal); return server.listed ?? { status: 'ok', value: { orders: structuredClone(server.orders) } }; },
    readStages: read('readStages', 'stages'), readDocuments: read('readDocuments', 'documents'),
    readAppointment: read('readAppointment', 'appointment'), readReturnPlan: read('readReturnPlan', 'returnPlan'),
  };
  for (const op of ['completeTask', 'requestAppointment', 'acceptAppointment', 'requestReturn', 'acceptReturn']) {
    adapter[op] = async (input) => { calls.push([op, input]); signals.push(input?.signal); return server.outcome?.(op, input) ?? { status: 'ok', value: {} }; };
  }
  return { server, adapter, calls, signals, reads: () => calls.filter(([key]) => key.startsWith('read')).length };
}
const make = (f, options = {}) => {
  const changes = []; const controller = createOrderProgressController({ adapter: f.adapter, onChange: (s) => changes.push(s), createCommandId: () => 'cmd-1', ...options });
  return { controller, changes };
};

test('without an order id the newest selection is chosen, then all four sections are read together', async () => {
  const f = fake(); const uuid = f.server.progress.stages.value.orderUuid;
  f.server.orders = [order('a-old', '2026-11-03T09:00:00.000Z'), order(uuid, '2026-11-05T09:00:00.000Z'), order('b-bad', 'not a date')];
  const gate = deferred(); const started = [];
  for (const key of ['readStages', 'readDocuments', 'readAppointment', 'readReturnPlan']) {
    const inner = f.adapter[key]; f.adapter[key] = async (input) => { started.push(key); await gate.promise; return inner(input); };
  }
  const { controller, changes } = make(f);
  assert.equal(controller.getState().phase, 'loading');
  const loaded = controller.refresh(); await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(started.sort(), ['readAppointment', 'readDocuments', 'readReturnPlan', 'readStages']);
  gate.resolve(); const state = await loaded;
  assert.deepEqual([state.phase, state.orderUuid, state.pending, state.message], ['ready', uuid, false, null]);
  assert.deepEqual(state.progress, { ...progress(), phase: 'ready' });
  assert.equal(changes.at(-1).phase, 'ready'); assert.deepEqual(f.calls[0], ['listOrders']);
  assert.ok(f.calls.filter(([key]) => key.startsWith('read')).every(([key, id]) => key === 'readDocuments' || id === uuid));
  assert.equal(latestOrderId([order('x', '2026-11-05T09:00:00.000Z'), order('y', '2026-11-05T09:00:00.000Z')]), 'y');
  assert.equal(latestOrderId([]), null);
});

test('a supplied order id skips the order list; no orders is its own phase; an unreadable list or order is unavailable', async () => {
  const f = fake(); const uuid = f.server.progress.stages.value.orderUuid;
  await make(f, { orderUuid: uuid }).controller.refresh(); assert.ok(!f.calls.some(([key]) => key === 'listOrders'));
  const none = fake(); none.server.orders = [];
  const empty = await make(none).controller.refresh(); assert.deepEqual([empty.phase, empty.progress], ['none', { phase: 'none' }]);
  assert.equal(none.reads(), 0);
  const broken = fake(); broken.server.listed = { status: 'unavailable' };
  assert.equal((await make(broken).controller.refresh()).phase, 'unavailable');
  const malformed = fake(); malformed.server.listed = { status: 'ok', value: {} };
  assert.equal((await make(malformed).controller.refresh()).phase, 'unavailable');
  const noOrder = fake(); noOrder.server.progress.stages = { status: 'not-found' };
  assert.equal((await make(noOrder).controller.refresh()).phase, 'unavailable');
  const wrong = fake(); wrong.server.progress.stages.value.orderUuid = 'someone-else';
  assert.equal((await make(wrong).controller.refresh()).phase, 'unavailable');
  const thrown = fake(); thrown.adapter.readStages = async () => { throw new Error('boom'); };
  assert.equal((await make(thrown).controller.refresh()).phase, 'unavailable');
});

test('one failing section keeps its own envelope while the order and the other sections still show', async () => {
  const f = fake('appointment-scheduled');
  f.server.progress.documents = { status: 'unavailable', retryable: true, reason: 'Document tracking is unavailable.' };
  f.adapter.readReturnPlan = async () => { throw new Error('boom'); };
  delete f.adapter.readAppointment;
  const state = await make(f).controller.refresh();
  assert.equal(state.phase, 'ready'); assert.equal(state.progress.stages.status, 'ok');
  assert.deepEqual(state.progress.documents, { status: 'unavailable', retryable: true, reason: 'Document tracking is unavailable.' });
  assert.deepEqual([state.progress.appointment, state.progress.returnPlan], [{ status: 'unavailable' }, { status: 'unavailable' }]);
});

test('every command sends only the order and its own fields, then re-reads all four sections from the server', async () => {
  const f = fake('appointment-requested'); const uuid = f.server.progress.stages.value.orderUuid;
  const { controller } = make(f); await controller.refresh();
  const cases = [['completeTask', (c) => c.completeTask('item-1'), { orderUuid: uuid, itemId: 'item-1', commandId: 'cmd-1' }, 'Task completed.'],
    ['requestAppointment', (c) => c.requestAppointment('slot-1'), { orderUuid: uuid, slotId: 'slot-1' }, 'Handover time requested.'],
    ['acceptAppointment', (c) => c.acceptAppointment('p-1'), { orderUuid: uuid, proposalId: 'p-1' }, 'New handover time accepted.'],
    ['requestReturn', (c) => c.requestReturn({ choice: 'separate', slotId: 'slot-2' }), { orderUuid: uuid, choice: 'separate', slotId: 'slot-2' }, 'Return requested.'],
    ['acceptReturn', (c) => c.acceptReturn('p-2'), { orderUuid: uuid, proposalId: 'p-2' }, 'New return time accepted.']];
  for (const [op, run, fields, text] of cases) {
    const before = f.reads(); const lists = f.calls.filter(([key]) => key === 'listOrders').length;
    const state = await run(controller);
    const [, sent] = f.calls.findLast(([key]) => key === op); const { signal, ...rest } = sent;
    assert.deepEqual(rest, fields); assert.ok(signal instanceof AbortSignal);
    assert.equal(f.reads() - before, 4, op); assert.equal(f.calls.filter(([key]) => key === 'listOrders').length, lists, 'the same order is re-read');
    assert.deepEqual([state.pending, state.message, state.phase], [false, { text, error: false }, 'ready'], op);
  }
});

test('the screen shows the server state after a command, never a local guess', async () => {
  const f = fake('appointment-requested'); const { controller, changes } = make(f); await controller.refresh();
  f.server.outcome = () => { f.server.progress = progress('appointment-scheduled'); return { status: 'ok', value: {} }; };
  const state = await controller.requestAppointment('slot-1');
  assert.equal(state.progress.appointment.value.state, 'scheduled');
  assert.ok(changes.some((s) => s.pending && s.message === null), 'pending is published first, with the earlier facts kept');
  f.server.outcome = () => ({ status: 'ok', value: {} }); // the server answered ok but did not change: so neither does the screen
  const same = await controller.requestAppointment('slot-1'); assert.equal(same.progress.appointment.value.state, 'scheduled');
});

test('refusals map to concise messages: unsupported reason, changed order, and a generic retry', async () => {
  const f = fake(); const { controller } = make(f); await controller.refresh();
  f.server.outcome = () => ({ status: 'unsupported', code: 'live-appointments-unsupported', reason: 'Live handover times are not connected in this demonstration.' });
  assert.deepEqual((await controller.requestAppointment('s')).message, { text: 'Not done. Live handover times are not connected in this demonstration.', error: true });
  for (const status of ['conflict', 'stale-version', 'stale-run']) {
    f.server.outcome = () => ({ status });
    assert.deepEqual((await controller.requestAppointment('s')).message, { text: 'Your order changed. Showing the latest.', error: true }, status);
  }
  for (const out of [{ status: 'unavailable' }, { status: 'forbidden' }, { status: 'unsupported' }, undefined]) {
    f.server.outcome = () => out ?? { status: 'invalid' };
    assert.deepEqual((await controller.requestAppointment('s')).message, { text: 'Not saved. Try again.', error: true });
  }
  f.adapter.requestAppointment = async () => { throw new Error('boom'); };
  assert.deepEqual((await controller.requestAppointment('s')).message, { text: 'Not saved. Try again.', error: true });
  assert.equal(controller.getState().phase, 'ready');
});

test('a task without a command id is not sent, and a command that cannot be sent leaves the screen alone', async () => {
  const f = fake(); const { controller } = make(f, { createCommandId: () => { throw new Error('no crypto'); } }); await controller.refresh();
  const state = await controller.completeTask('item-1');
  assert.deepEqual(state.message, { text: 'Not saved. Try again.', error: true }); assert.ok(!f.calls.some(([key]) => key === 'completeTask'));
  const bare = fake(); bare.adapter.acceptReturn = undefined; const other = make(bare).controller; await other.refresh();
  const before = bare.calls.length; await other.acceptReturn('p'); assert.equal(bare.calls.length, before);
});

test('one command at a time: a second command and a refresh wait for the first, which owns the final read', async () => {
  const f = fake(); const { controller } = make(f); await controller.refresh();
  const gate = deferred(); f.server.outcome = () => gate.promise;
  const first = controller.requestAppointment('slot-1'); await new Promise((r) => setTimeout(r, 5));
  assert.equal(controller.getState().pending, true);
  await controller.acceptAppointment('p'); await controller.refresh();
  assert.ok(!f.calls.some(([key]) => key === 'acceptAppointment')); assert.equal(f.calls.filter(([key]) => key === 'requestAppointment').length, 1);
  gate.resolve({ status: 'ok', value: {} }); const state = await first;
  assert.deepEqual([state.pending, state.message.text], [false, 'Handover time requested.']);
});

test('a superseded read cannot paint: the later refresh wins and the earlier request is aborted', async () => {
  const f = fake('appointment-requested'); const slow = deferred(); let reads = 0;
  const original = f.adapter.readStages;
  f.adapter.readStages = async (input) => (++reads === 1 ? slow.promise.then(() => original(input)) : original(input));
  const { controller, changes } = make(f);
  const early = controller.refresh(); await new Promise((r) => setTimeout(r, 5));
  f.server.progress = progress('appointment-scheduled');
  const late = await controller.refresh(); assert.equal(late.progress.appointment.value.state, 'scheduled');
  slow.resolve(); await early;
  assert.equal(controller.getState().progress.appointment.value.state, 'scheduled');
  assert.equal(changes.filter((s) => s.phase === 'ready').length, 1);
});

test('destroy aborts every owned request and nothing paints afterwards', async () => {
  const f = fake(); const { controller, changes } = make(f); await controller.refresh();
  const gate = deferred(); f.server.outcome = () => gate.promise;
  const sent = controller.requestAppointment('slot-1'); await new Promise((r) => setTimeout(r, 5));
  const commandSignal = f.signals.at(-1); controller.destroy();
  assert.equal(commandSignal.aborted, true); const count = changes.length;
  gate.resolve({ status: 'ok', value: {} }); await sent; assert.equal(changes.length, count);
  assert.equal(f.reads(), 4); await controller.refresh(); await controller.requestAppointment('x'); assert.equal(f.reads(), 4);
  const loading = fake(); const slow = deferred(); const original = loading.adapter.readStages;
  loading.adapter.readStages = async (input) => { await slow.promise; return original(input); };
  const second = make(loading); const pending = second.controller.refresh(); await new Promise((r) => setTimeout(r, 5));
  second.controller.destroy(); assert.ok(loading.signals.filter(Boolean).every((s) => s.aborted));
  slow.resolve(); await pending; assert.equal(second.changes.at(-1).phase, 'loading');
});
