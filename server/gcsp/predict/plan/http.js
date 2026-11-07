import { result } from '../../repository/index.js';

// Greg-only order-plan routes. Run and person come from the server session; the service refuses unknown fields.
export function createOrderPlanRoutes(service) {
  return [
    { method: 'GET', path: '/api/gcsp/greg/order-plan', action: 'readPlan' },
    { method: 'POST', path: '/api/gcsp/greg/order-plan/preview', action: 'previewPlan' },
    { method: 'GET', path: '/api/gcsp/greg/order-plan/draft', action: 'readConstraintDraft' },
    { method: 'POST', path: '/api/gcsp/greg/order-plan/draft', action: 'saveConstraintDraft' },
    { method: 'POST', path: '/api/gcsp/greg/order-plan/publish', action: 'publishConstraints' },
    { method: 'POST', path: '/api/gcsp/greg/order-plan/submit', action: 'submitPlan' },
  ].map(({ action, ...route }) => ({ ...route, role: 'greg', async handle({ context, searchParams, body }) {
    if (searchParams && [...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
      reasons: [{ field: 'query', reason: 'The order plan uses the current trusted run and role.' }] });
    if (route.method === 'GET' && body !== undefined && body !== null
      && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) return result('invalid', { code: 'unsupported-body',
      reasons: [{ field: 'body', reason: 'Order plan reads do not accept a body.' }] });
    if (typeof service?.[action] !== 'function') return result('unavailable', { retryable: true,
      reason: 'The order plan has not been configured.' });
    return route.method === 'GET' ? service[action](context) : service[action](context, body);
  } }));
}
