const statuses = new Set(['ok', 'pending', 'invalid', 'forbidden', 'not-found', 'stale-version', 'stale-run', 'conflict', 'unavailable']);
const unavailable = (code, uncertain, httpStatus = null) => ({ status: 'unavailable', code, uncertain, retryable: true, httpStatus,
  view: { state: uncertain ? 'pending' : 'unavailable', editable: false, action: 'retry', supportOwner: 'scheme-support' } });

export function createManualReviewHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { body, signal } = {}) {
    const write = body !== undefined;
    let response;
    try {
      response = await fetchImpl(`${base}/api/gcsp/manual/${path}`, { method: write ? 'POST' : 'GET', credentials: 'include', signal,
        headers: { Accept: 'application/json', ...(write ? { 'Content-Type': 'application/json' } : {}) },
        ...(write ? { body: JSON.stringify(body) } : {}) });
    } catch { return unavailable('manual-review-transport-unavailable', write); }
    let envelope;
    try { envelope = await response.json(); } catch { return unavailable('manual-review-response-invalid', write, response.status); }
    if (response.status === 401 && typeof envelope?.status !== 'string') return { status: 'access-required' };
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || !statuses.has(envelope.status)
      || envelope.status === 'ok' && (response.status !== 200 || !envelope.value || typeof envelope.value !== 'object')
      || envelope.status === 'pending' && response.status !== 202
      || !['ok', 'pending'].includes(envelope.status) && response.ok) return unavailable('manual-review-response-invalid', write, response.status);
    return envelope;
  }
  return Object.freeze({
    readClaim: (options) => request('claim', options),
    readReviewDetails: (options) => request('review-details', options),
    saveReviewDetails: (input, options = {}) => request('review-details', { ...options, body: input }),
    beginReview: (input, options = {}) => request('claim/review', { ...options, body: input }),
    release: (input, options = {}) => request('claim/release', { ...options, body: input }),
  });
}
