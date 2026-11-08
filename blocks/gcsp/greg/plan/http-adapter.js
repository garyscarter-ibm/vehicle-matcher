// Browser transport for Greg's order plan (FUCQ-119 routes). The server owns role, run and numbers; this maps replies to view states.

import { isAccessLapsed } from '../../kit/run-restarted.js';

export const PLAN_MESSAGES = Object.freeze({
  unavailable: 'The order plan could not be loaded. Try again in a moment.',
  refused: 'Only the scheme ordering lead can open this dashboard. Switch to that session and try again.',
  reset: 'The demo was reset. Reopen the scheme ordering lead session to see the new run.',
  invalid: 'Those limits cannot be used. Check them and try again.',
  replan: 'Inputs changed since this plan was made. Replan before submitting.',
});

const BASE_PATH = '/api/gcsp/greg/order-plan';
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const validValue = (v) => object(v) && (text(v.submissionId) || (object(v.plan) && text(v.plan.planId)));

/** Pure: HTTP status and parsed JSON body -> { status: 'ready' | 'refused' | 'replan-needed' | 'invalid' | 'unavailable', ... }. */
export function planOutcome(httpStatus, body) {
  if (httpStatus === 200 && body?.status === 'ok' && validValue(body.value)) return { status: 'ready', value: body.value };
  if (isAccessLapsed(httpStatus, body)) return { status: 'access-required' };
  if (httpStatus === 401 || httpStatus === 403) return { status: 'refused', message: PLAN_MESSAGES.refused };
  if (body?.status === 'stale-run') return { status: 'refused', message: PLAN_MESSAGES.reset };
  if (httpStatus === 409 && body?.status === 'conflict' && body.code === 'replan-needed') {
    return { status: 'replan-needed', changedInputs: Array.isArray(body.changedInputs) ? body.changedInputs.filter(text) : [],
      current: object(body.current) ? body.current : null, message: PLAN_MESSAGES.replan };
  }
  if ((httpStatus === 400 && body?.status === 'invalid') || (httpStatus === 409 && body?.status === 'conflict')) {
    const reasons = (Array.isArray(body.reasons) ? body.reasons : []).filter((r) => text(r?.reason)).map((r) => ({ field: text(r.field) ? r.field : '', reason: r.reason }));
    return { status: 'invalid', code: text(body.code) ? body.code : 'invalid', reasons, message: reasons[0]?.reason ?? (text(body.reason) ? body.reason : PLAN_MESSAGES.invalid) };
  }
  return { status: 'unavailable', message: body?.code === 'submission-incomplete' && text(body.reason) ? body.reason : PLAN_MESSAGES.unavailable };
}

/** { readPlan({ signal }), previewPlan({ changes, signal }), submitPlan({ commandId, planId, versions, changes, signal }) } -> a planOutcome state. */
export function createOrderPlanHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  const request = async (path, payload, signal) => {
    const post = payload !== undefined;
    let response;
    try {
      response = await fetchImpl(`${base}${BASE_PATH}${path}`, { method: post ? 'POST' : 'GET', credentials: 'include', cache: 'no-store', signal,
        headers: { Accept: 'application/json', ...(post ? { 'Content-Type': 'application/json' } : {}) }, ...(post ? { body: JSON.stringify(payload) } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: 'unavailable', message: PLAN_MESSAGES.unavailable };
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return planOutcome(response.status, body);
  };
  return {
    readPlan: ({ signal } = {}) => request('', undefined, signal),
    previewPlan: ({ changes, signal } = {}) => request('/preview', { changes }, signal),
    submitPlan: ({ commandId, planId, versions, changes, signal } = {}) => request('/submit', { commandId, planId, versions,
      ...(Array.isArray(changes) && changes.length ? { changes } : {}) }, signal),
  };
}
