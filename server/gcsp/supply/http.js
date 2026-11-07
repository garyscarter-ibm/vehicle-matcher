import { result } from '../repository/core.js';

// The shared handler resolves the acting Greg or retained presenter cookie.
// No browser-supplied role, principal, run or policy context is accepted here.
export function createSupplyRoutes(service) {
  const route = (path, method, role, operation) => ({ method, path, role,
    ...(role === 'presenter' ? { purpose: 'presenter-control' } : {}),
    async handle({ context, body = {}, searchParams }) {
      if ([...searchParams.keys()].length || method === 'GET' && Object.keys(body).length) return result('invalid', {
        code: 'unsupported-query', reasons: [{ field: 'query', reason: 'Order requests use the current trusted role and run.' }],
      });
      if (typeof service?.[operation] !== 'function') return result('unavailable', {
        reason: 'Order requests have not been configured.', retryable: true,
      });
      return service[operation](context, body);
    } });
  return [
    route('/api/gcsp/greg/orders', 'GET', 'greg', 'readTracking'),
    route('/api/gcsp/greg/orders', 'POST', 'greg', 'submit'),
    route('/api/gcsp/greg/orders/queue', 'POST', 'greg', 'queueConfirmed'),
    route('/api/gcsp/presenter/production', 'POST', 'presenter', 'stepProduction'),
  ];
}
