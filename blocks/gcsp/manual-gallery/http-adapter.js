import { createAccountHttpAdapter } from '../account/http-adapter.js';

/** The authenticated account adapter remains the sole released-stock reader. */
export function createManualGalleryHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  const account = createAccountHttpAdapter({ base, fetchImpl });
  async function claimRequest({ body, signal } = {}) {
    try {
      const response = await fetchImpl(`${base}/api/gcsp/manual/claim`, { method: body ? 'POST' : 'GET',
        credentials: 'include', signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const envelope = await response.json();
      if (response.status === 401 && typeof envelope?.status !== 'string') return { status: 'access-required' };
      if (!envelope || typeof envelope.status !== 'string' || envelope.status === 'ok' && (!response.ok || !envelope.value)) throw new TypeError('Invalid claim response');
      return envelope;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: 'unavailable', code: 'manual-claim-unavailable', retryable: true };
    }
  }
  return { ...account, readClaim: (options) => claimRequest(options),
    claim: (input, options = {}) => claimRequest({ ...options, body: input }) };
}
