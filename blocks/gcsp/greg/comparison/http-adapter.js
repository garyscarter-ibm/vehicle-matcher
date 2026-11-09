// Browser transport for the stored process comparison (FUCQ-137 read route). The server owns role and result; this maps replies to view states.
import { isAccessLapsed } from '../../kit/run-restarted.js';

const PATH = '/api/gcsp/comparison/process/latest';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Pure: HTTP status and parsed JSON body -> { status: 'ready' | 'empty' | 'refused' | 'access-required' | 'unavailable', stored? }. */
export function outcomeToState(httpStatus, body) {
  const value = body?.value;
  if (httpStatus === 200 && body?.status === 'ok' && object(value) && value.result?.kind === 'process-comparison') return { status: 'ready', stored: value };
  if (isAccessLapsed(httpStatus, body)) return { status: 'access-required' };
  if (httpStatus === 404 && body?.status === 'not-found') return { status: 'empty' };
  if (httpStatus === 401 || httpStatus === 403) return { status: 'refused' };
  return { status: 'unavailable' };
}

/** { load({ signal }) } -> an outcomeToState result. Network failure reads as unavailable; an abort rethrows. */
export function createComparisonHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  return {
    async load({ signal } = {}) {
      let response;
      try {
        response = await fetchImpl(`${base}${PATH}`, { method: 'GET', credentials: 'include', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 'unavailable' };
      }
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return outcomeToState(response.status, body);
    },
  };
}
