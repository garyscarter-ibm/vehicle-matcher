// Browser transport for the stored comparisons and worker jobs (FUCQ-137/175 routes). The server owns role and result; this maps replies to view states.
import { isAccessLapsed } from '../../kit/run-restarted.js';

const PATH = '/api/gcsp/comparison/process/latest';
const ROOT = '/api/gcsp/comparison';
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const KINDS = ['process-comparison', 'experiment-comparison'];
const storedOk = (v) => object(v) && object(v.result) && KINDS.includes(v.result.kind);
// Statuses every route shares, checked after its own success cases.
const common = (httpStatus, body) => {
  if (isAccessLapsed(httpStatus, body)) return { status: 'access-required' };
  if (httpStatus === 401 || httpStatus === 403) return { status: 'refused' };
  return null;
};
const unavailable = (body) => (text(body?.reason) ? { status: 'unavailable', reason: body.reason } : { status: 'unavailable' });

/** Pure: results/latest (no query) -> { status: 'ready', activePolicyVersion, experiments: [{ experimentId, latest }] } | refused | access-required | unavailable. */
export function listOutcomeToState(httpStatus, body) {
  const value = body?.value;
  if (httpStatus === 200 && body?.status === 'ok' && object(value) && Array.isArray(value.experiments)
    && value.experiments.every((e) => object(e) && text(e.experimentId) && (e.latest === null || storedOk(e.latest)))) {
    return { status: 'ready', activePolicyVersion: text(value.activePolicyVersion) ? value.activePolicyVersion : null,
      experiments: value.experiments.map(({ experimentId, latest }) => ({ experimentId, latest })) };
  }
  return common(httpStatus, body) ?? unavailable(body);
}

/** Pure: results/latest?experimentId= -> { status: 'ready', stored } | empty | refused | access-required | unavailable. */
export function resultOutcomeToState(httpStatus, body) {
  if (httpStatus === 200 && body?.status === 'ok' && storedOk(body.value)) return { status: 'ready', stored: body.value };
  if (httpStatus === 404 && body?.status === 'not-found') return { status: 'empty' };
  return common(httpStatus, body) ?? unavailable(body);
}

/** Pure: jobs POST -> { status: 'started', job } | invalid { reasons } | conflict { jobId, reason } | refused | access-required | unavailable. */
export function startOutcomeToState(httpStatus, body) {
  if (httpStatus === 202 && body?.status === 'pending' && object(body.value) && text(body.value.jobId)) return { status: 'started', job: body.value };
  if (httpStatus === 400 && body?.status === 'invalid') {
    const reasons = (Array.isArray(body.reasons) ? body.reasons : []).filter((r) => object(r) && text(r.reason))
      .map((r) => ({ field: text(r.field) ? r.field : null, key: text(r.key) ? r.key : null, reason: r.reason }));
    return { status: 'invalid', reasons };
  }
  if (httpStatus === 409 && body?.status === 'conflict') return { status: 'conflict', jobId: text(body.jobId) ? body.jobId : null, reason: text(body.reason) ? body.reason : null };
  return common(httpStatus, body) ?? unavailable(body);
}

/** Pure: jobs/latest -> { status: 'ok', job, reruns } | { none, reruns } | refused | access-required | unavailable. */
export function jobOutcomeToState(httpStatus, body) {
  if (httpStatus === 200 && body?.status === 'ok' && object(body.value) && text(body.value.jobId) && text(body.value.status)) return { status: 'ok', job: body.value, reruns: body.reruns === true };
  if (httpStatus === 404 && body?.status === 'not-found') return { status: 'none', reruns: body.reruns === true };
  return common(httpStatus, body) ?? unavailable(body);
}
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

/** { load, loadAll, loadResult, start, readJob }, each taking a { signal } and answering a state above. Network failure reads as unavailable; an abort rethrows. */
export function createComparisonHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function call(path, { method = 'GET', payload, signal } = {}) {
    const headers = { Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) };
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { method, credentials: 'include', cache: 'no-store', signal, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    } catch (error) {
      if (signal?.aborted) throw error;
      return null;
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return { httpStatus: response.status, body };
  }
  const run = async (map, path, options) => { const got = await call(path, options); return got ? map(got.httpStatus, got.body) : { status: 'unavailable' }; };
  return {
    load: ({ signal } = {}) => run(outcomeToState, PATH, { signal }),
    loadAll: ({ signal } = {}) => run(listOutcomeToState, `${ROOT}/results/latest`, { signal }),
    loadResult: (experimentId, { signal } = {}) => run(resultOutcomeToState, `${ROOT}/results/latest?experimentId=${encodeURIComponent(experimentId)}`, { signal }),
    start: ({ experimentId, change } = {}, { signal } = {}) => run(startOutcomeToState, `${ROOT}/jobs`, { method: 'POST', payload: change === undefined ? { experimentId } : { experimentId, change }, signal }),
    readJob: ({ jobId } = {}, { signal } = {}) => run(jobOutcomeToState, `${ROOT}/jobs/latest${text(jobId) ? `?jobId=${encodeURIComponent(jobId)}` : ''}`, { signal }),
  };
}
