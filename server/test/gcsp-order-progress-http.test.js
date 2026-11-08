import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrderProgressHttpAdapter } from '../../blocks/gcsp/order-progress/order-progress-http.js';

function recorder(reply = { status: 'ok', value: {} }, http = 200) {
  const calls = [];
  const fetch = async (path, init) => { calls.push({ path, ...init }); return { ok: http < 400, status: http, json: async () => (typeof reply === 'function' ? reply() : reply) }; };
  return { calls, adapter: createOrderProgressHttpAdapter({ fetch }) };
}
const UUID = 'order uuid/1&x';

test('reads use fixed same-origin GET paths with only the order id, no body and no identity', async () => {
  const { calls, adapter } = recorder(); const signal = new AbortController().signal;
  await adapter.listOrders({ signal }); await adapter.readStages({ orderUuid: UUID, signal }); await adapter.readDocuments({ signal });
  await adapter.readAppointment({ orderUuid: UUID }); await adapter.readReturnPlan({ orderUuid: UUID });
  assert.deepEqual(calls.map((c) => [c.method, c.path]), [['GET', '/api/gcsp/orders/progress/all'], ['GET', `/api/gcsp/orders/progress?orderUuid=${encodeURIComponent(UUID)}`],
    ['GET', '/api/gcsp/documents'], ['GET', `/api/gcsp/appointments?orderUuid=${encodeURIComponent(UUID)}`], ['GET', `/api/gcsp/return-plan?orderUuid=${encodeURIComponent(UUID)}`]]);
  for (const call of calls) {
    assert.deepEqual([call.credentials, call.cache, call.redirect, 'body' in call], ['same-origin', 'no-store', 'error', false]);
    assert.deepEqual(call.headers, { Accept: 'application/json' });
  }
  assert.equal(calls[0].signal, signal);
});

test('commands post exactly the producer fields as JSON and nothing else', async () => {
  const { calls, adapter } = recorder(); const extra = { employeeId: 'forged', runId: 'x', role: 'greg' };
  await adapter.completeTask({ orderUuid: 'o', itemId: 'i', commandId: 'c', ...extra });
  await adapter.requestAppointment({ orderUuid: 'o', slotId: 's', ...extra }); await adapter.acceptAppointment({ orderUuid: 'o', proposalId: 'p', ...extra });
  await adapter.requestReturn({ orderUuid: 'o', choice: 'separate', slotId: 's', ...extra }); await adapter.acceptReturn({ orderUuid: 'o', proposalId: 'p', ...extra });
  assert.deepEqual(calls.map((c) => [c.method, c.path, JSON.parse(c.body)]), [
    ['POST', '/api/gcsp/documents/tasks/complete', { commandId: 'c', orderUuid: 'o', itemId: 'i', acknowledgement: 'synthetic' }],
    ['POST', '/api/gcsp/appointments/request', { orderUuid: 'o', slotId: 's' }], ['POST', '/api/gcsp/appointments/accept', { orderUuid: 'o', proposalId: 'p' }],
    ['POST', '/api/gcsp/return-plan/request', { orderUuid: 'o', choice: 'separate', slotId: 's' }], ['POST', '/api/gcsp/return-plan/accept', { orderUuid: 'o', proposalId: 'p' }]]);
  for (const call of calls) assert.deepEqual([call.headers['Content-Type'], call.credentials, call.redirect], ['application/json', 'same-origin', 'error']);
});

test('missing or oversized fields are invalid and never reach the network', async () => {
  const { calls, adapter } = recorder();
  for (const out of [await adapter.readStages({}), await adapter.readAppointment({ orderUuid: '' }), await adapter.readReturnPlan(), await adapter.completeTask({ orderUuid: 'o', itemId: 'i' }),
    await adapter.requestAppointment({ orderUuid: 'o' }), await adapter.acceptAppointment({ proposalId: 'p' }), await adapter.requestReturn({ orderUuid: 'o', slotId: 's' }),
    await adapter.acceptReturn({ orderUuid: 'o', proposalId: 'x'.repeat(129) }), await adapter.requestAppointment({ orderUuid: 'o', slotId: 7 })]) assert.deepEqual(out, { status: 'invalid' });
  assert.equal(calls.length, 0);
});

test('producer refusals keep their own envelope; only malformed answers become unavailable', async () => {
  for (const [status, http] of [['unsupported', 422], ['conflict', 409], ['forbidden', 403], ['not-open', 200], ['stale-run', 409], ['invalid', 400], ['not-found', 404]]) {
    const body = { status, code: 'c', reason: 'Because.' };
    assert.deepEqual(await recorder(body, http).adapter.requestAppointment({ orderUuid: 'o', slotId: 's' }), body, status);
  }
  const ok = { status: 'ok', value: { orders: [] } };
  assert.deepEqual(await recorder(ok).adapter.listOrders(), ok);
  for (const bad of [await recorder(ok, 500).adapter.listOrders(), await recorder('text').adapter.listOrders(), await recorder(null).adapter.listOrders(),
    await recorder({ value: 1 }).adapter.listOrders(), await recorder({ status: 5 }).adapter.listOrders()]) assert.deepEqual(bad, { status: 'unavailable' });
});

test('a thrown request, a redirect error, bad JSON or a missing fetch is unavailable', async () => {
  const thrown = createOrderProgressHttpAdapter({ fetch: async () => { throw new TypeError('redirect'); } });
  const badJson = createOrderProgressHttpAdapter({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }) });
  for (const adapter of [thrown, badJson, createOrderProgressHttpAdapter({ fetch: null })]) {
    assert.deepEqual(await adapter.listOrders(), { status: 'unavailable' }); assert.deepEqual(await adapter.completeTask({ orderUuid: 'o', itemId: 'i', commandId: 'c' }), { status: 'unavailable' });
  }
});

test('the account loader is passed through unchanged for the shell', () => {
  const loadAccount = () => ({ status: 'ready' });
  assert.equal(createOrderProgressHttpAdapter({ fetch: async () => ({}), loadAccount }).loadAccount, loadAccount);
});
