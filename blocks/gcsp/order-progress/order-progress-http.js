import { isAccessLapsed } from '../kit/run-restarted.js';
// Fixed same-origin endpoints. Identity, run and access stay with the server; producer refusals keep their own envelope.
const unavailable = () => ({ status: 'unavailable' });
const invalid = () => ({ status: 'invalid' });
const text = (value) => typeof value === 'string' && value.trim() !== '' && value.length <= 128;

export function createOrderProgressHttpAdapter({ fetch: request = globalThis.fetch, loadAccount } = {}) {
  async function send(path, method, body, signal) {
    if (typeof request !== 'function') return unavailable();
    try {
      const response = await request(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const out = await response.json().catch(() => null);
      if (isAccessLapsed(response.status, out)) return { status: 'access-required' };
      return typeof out?.status === 'string' && (out.status !== 'ok' || response.ok) ? out : unavailable();
    } catch { return unavailable(); }
  }
  const read = (path, { orderUuid, signal } = {}) => (text(orderUuid)
    ? send(`${path}?orderUuid=${encodeURIComponent(orderUuid)}`, 'GET', undefined, signal) : Promise.resolve(invalid()));
  const write = (path, fields, input = {}, fixed = {}) => (fields.every((key) => text(input[key]))
    ? send(path, 'POST', { ...Object.fromEntries(fields.map((key) => [key, input[key]])), ...fixed }, input.signal) : Promise.resolve(invalid()));
  return {
    loadAccount,
    listOrders: ({ signal } = {}) => send('/api/gcsp/orders/progress/all', 'GET', undefined, signal),
    readStages: (input) => read('/api/gcsp/orders/progress', input),
    readDocuments: ({ signal } = {}) => send('/api/gcsp/documents', 'GET', undefined, signal),
    readAppointment: (input) => read('/api/gcsp/appointments', input),
    readReturnPlan: (input) => read('/api/gcsp/return-plan', input),
    completeTask: (input) => write('/api/gcsp/documents/tasks/complete', ['commandId', 'orderUuid', 'itemId'], input, { acknowledgement: 'synthetic' }),
    requestAppointment: (input) => write('/api/gcsp/appointments/request', ['orderUuid', 'slotId'], input),
    acceptAppointment: (input) => write('/api/gcsp/appointments/accept', ['orderUuid', 'proposalId'], input),
    requestReturn: (input) => write('/api/gcsp/return-plan/request', ['orderUuid', 'choice', 'slotId'], input),
    acceptReturn: (input) => write('/api/gcsp/return-plan/accept', ['orderUuid', 'proposalId'], input),
  };
}
