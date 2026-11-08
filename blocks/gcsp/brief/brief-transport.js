import { isAccessLapsed } from '../kit/run-restarted.js';
const unavailable = () => ({ status: 'unavailable', retryable: true });
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const commands = {
  preview: ['kind', 'baseBriefVersion', 'draftVersion', 'brief'],
  draft: ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'brief'],
  confirm: ['commandId', 'expectedBriefVersion', 'expectedDraftVersion', 'consent'],
};

/** Same-origin HTTP ports; trusted identity and policy never become browser payload fields. */
export function createBriefTransport({ fetch: request = globalThis.fetch, baseURL = '', signal } = {}) {
  async function call(route, payload, requestSignal = signal) {
    if (typeof request !== 'function' || requestSignal?.aborted) return unavailable();
    if (payload !== undefined && (!object(payload) || Object.keys(payload).some((k) => !commands[route].includes(k)))) return { status: 'invalid', field: 'request' };
    try {
      const response = await request(`${baseURL.replace(/\/$/, '')}/api/gcsp/brief/${route}`, {
        method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: requestSignal,
        headers: { Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      });
      const result = await response.json().catch(() => null);
      if (isAccessLapsed(response.status, result)) return { status: 'access-required' };
      if (!object(result) || typeof result.status !== 'string') return unavailable();
      if (response.ok && result.status === 'ok') {
        if (!object(result.value)) return unavailable();
        if (route === 'editor' && (!object(result.value.context?.preferences) || !object(result.value.context?.essentials)
          || !object(result.value.context?.slider) || !object(result.value.initial?.brief))) return unavailable();
        return result;
      }
      return ['invalid', 'unavailable', 'stale-version', 'conflict', 'forbidden', 'not-found', 'stale-run'].includes(result.status) ? result : unavailable();
    } catch { return unavailable(); }
  }
  return { loadEditor: (options = {}) => call('editor', undefined, options.signal), preview: (input, options = {}) => call('preview', input, options.signal),
    saveDraft: (input, options = {}) => call('draft', input, options.signal), confirm: (input, options = {}) => call('confirm', input, options.signal) };
}
