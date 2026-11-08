import { result } from '../repository/index.js';

export function createManualOrderRoutes(service) {
  const route = (path, method, operation) => ({ method, path: `/api/gcsp/manual/order${path}`, role: 'employee',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Ordering uses the current trusted employee and entitlement.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', {
        reason: 'Manual ordering has not been configured.', retryable: true });
      return service[operation](context, body);
    } });
  return [route('/terms', 'GET', 'readTerms'), route('', 'POST', 'submit'), route('', 'GET', 'readOrder')];
}
