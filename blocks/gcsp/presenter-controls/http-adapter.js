import { isAccessLapsed } from '../kit/run-restarted.js';

// Presenter authority and acting context are separate server-owned cookies.
export function createPresenterHttpAdapter({ base = '', fetchImpl = globalThis.fetch, headers = {} } = {}) {
  async function request(path, body, { signal } = {}) {
    try {
      const response = await fetchImpl(`${base}/api/gcsp/${path}`, { method: body ? 'POST' : 'GET',
        credentials: 'include', signal, headers: { Accept: 'application/json', ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (isAccessLapsed(response.status, result)) return { status: 'access-required' };
      if (!result || typeof result.status !== 'string' || result.status === 'ok' && !response.ok) throw new Error('Invalid response');
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: 'unavailable', code: 'presenter-transport-unavailable', lostResponse: Boolean(body), retryable: true };
    }
  }
  return {
    readControls: (options) => request('presenter/controls', null, options),
    readContext: (options) => request('context', null, options),
    readScenarios: (options) => request('presenter/scenarios', null, options),
    readFaults: (options) => request('presenter/scenarios/faults', null, options),
    setFault: (body, options) => request('presenter/scenarios/faults', body, options),
    tick: (body, options) => request('presenter/controls/tick', body, options),
    reset: (body, options) => request('presenter/scenarios/reset', body, options),
    switchPrincipal: (body, options) => request('session/switch', body, options),
  };
}
