const fields = ['commandId', 'decisionId', 'expectedBriefVersion', 'questionVersion', 'value'];
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
const only = (v, keys) => object(v) && Reflect.ownKeys(v).length === keys.length && Reflect.ownKeys(v).every((k) => keys.includes(k));
const unavailable = () => ({ status: 'unavailable', retryable: true });

/** Session cookies carry identity; the request never accepts an employee, policy, path or reason selector. */
export function createFollowupHttpAdapter({ fetchImpl = globalThis.fetch, base = '/api/gcsp/offer-followup', signal } = {}) {
  async function request(url, body) {
    if (typeof fetchImpl !== 'function' || signal?.aborted) return unavailable();
    try {
      const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const outcome = await response.json();
      return object(outcome) && typeof outcome.status === 'string' && !(response.ok === false && outcome.status === 'ok') ? outcome : unavailable();
    } catch { return unavailable(); }
  }
  return {
    read(input) {
      if (!only(input, ['decisionId']) || !text(input.decisionId)) return Promise.resolve({ status: 'invalid' });
      return request(`${base}?${new URLSearchParams({ decisionId: input.decisionId })}`);
    },
    confirm(input) {
      if (!only(input, fields) || !['commandId', 'decisionId', 'questionVersion'].every((key) => text(input[key]))
        || !Number.isSafeInteger(input.expectedBriefVersion) || input.expectedBriefVersion <= 0
        || !(typeof input.value === 'string' || Number.isSafeInteger(input.value)
          || Array.isArray(input.value) && input.value.every((v) => typeof v === 'string'))) return Promise.resolve({ status: 'invalid' });
      return request(`${base}/confirm`, input);
    },
  };
}
