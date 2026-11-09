import { createManualReviewHttpAdapter } from '../manual-review/http-adapter.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';

const statuses = new Set(['ok', 'pending', 'invalid', 'forbidden', 'not-found', 'stale-version', 'conflict', 'unavailable']);
const unavailable = (code, uncertain, httpStatus = null) => ({ status: 'unavailable', code, uncertain, retryable: true, httpStatus });
const usable = (path, value) => value && typeof value === 'object' && !Array.isArray(value)
  && (path === 'order/terms' ? typeof value.termsDigest === 'string' && Array.isArray(value.declarations)
    : typeof value.operationId === 'string' && value.selection && value.progress);

/** Claim, review and account reads reuse their adapters; this adds the order and terms routes. */
export function createManualSummaryHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { body, signal } = {}) {
    const write = body !== undefined; let response;
    try {
      response = await fetchImpl(`${base}/api/gcsp/manual/${path}`, { method: write ? 'POST' : 'GET', credentials: 'include', signal,
        headers: { Accept: 'application/json', ...(write ? { 'Content-Type': 'application/json' } : {}) },
        ...(write ? { body: JSON.stringify(body) } : {}) });
    } catch { return unavailable('manual-order-transport-unavailable', write); }
    let envelope;
    try { envelope = await response.json(); } catch { return unavailable('manual-order-response-invalid', write, response.status); }
    const delivered = ['ok', 'pending'].includes(envelope?.status);
    if (!envelope || typeof envelope !== 'object' || !statuses.has(envelope.status)
      || delivered && (!usable(path, envelope.value) || response.status !== (envelope.status === 'ok' ? 200 : 202))
      || !delivered && response.ok) return unavailable('manual-order-response-invalid', write, response.status);
    return envelope;
  }
  const account = createAccountHttpAdapter({ base, fetchImpl });
  return Object.freeze({
    ...createManualReviewHttpAdapter({ base, fetchImpl }),
    readAccount: account.readAccount, readDraft: account.readDraft,
    readTerms: (options) => request('order/terms', options),
    readOrder: (options) => request('order', options),
    submitOrder: (input, options = {}) => request('order', { ...options, body: input }),
  });
}
