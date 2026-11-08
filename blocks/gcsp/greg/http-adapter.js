import { createGregPublishHttpAdapter } from './publish/http-adapter.js';
import { createOrderPlanHttpAdapter } from './plan/http-adapter.js';
// HTTP adapter for the Greg dashboard. The server owns role and run checks; this only maps replies to view states.

export const MESSAGES = Object.freeze({
  unavailable: 'The demand figures could not be loaded. Try again in a moment.',
  refused: 'Only the scheme ordering lead can open this dashboard. Switch to that session and try again.',
  reset: 'The demo was reset. Reopen the scheme ordering lead session to see the new run.',
  conflict: 'The figures changed while they were loading. Refresh to see the latest.',
});

/** Pure: HTTP status and parsed JSON body -> { status: 'ready' | 'refused' | 'conflict' | 'unavailable', ... }. */
export function outcomeToState(httpStatus, body) {
  const value = body?.value;
  if (httpStatus === 200 && body?.status === 'ok' && value && typeof value === 'object'
    && ['demand', 'offers', 'stock'].every((key) => value[key] && typeof value[key] === 'object')) return { status: 'ready', projection: value };
  if (httpStatus === 401 || httpStatus === 403) return { status: 'refused', message: MESSAGES.refused };
  if (httpStatus === 409 && body?.status === 'stale-run') return { status: 'refused', message: MESSAGES.reset };
  if (httpStatus === 409 && body?.status === 'conflict') return { status: 'conflict', message: MESSAGES.conflict };
  return { status: 'unavailable', message: MESSAGES.unavailable };
}

export function createGregHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  return {
    publish: createGregPublishHttpAdapter({ base, fetchImpl }),
    orderPlan: createOrderPlanHttpAdapter({ base, fetchImpl }),
    async loadDemand({ signal } = {}) {
      let response;
      try {
        response = await fetchImpl(`${base}/api/gcsp/greg/demand`, { method: 'GET', credentials: 'include', signal, headers: { Accept: 'application/json' } });
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 'unavailable', message: MESSAGES.unavailable };
      }
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return outcomeToState(response.status, body);
    },
  };
}
