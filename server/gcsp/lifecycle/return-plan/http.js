import { result } from '../../repository/index.js';

// Browser identity/run claims are discarded by the shared handler; services use only the resolved context.
export function createReturnPlanRoutes(service) {
  const route = (path, method, operation, query = []) => ({ method, path: `/api/gcsp${path}`, browserContext: 'ignore',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].some((key) => !query.includes(key))) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'The return plan uses the current trusted employee and demonstration run.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', { reason: 'The return plan is unavailable. Ask the scheme team to check the service.', retryable: true });
      return service[operation](context, method === 'GET' ? Object.fromEntries(query.filter((k) => searchParams.has(k)).map((k) => [k, searchParams.get(k)])) : body);
    } });
  return [route('/return-plan', 'GET', 'read', ['orderUuid']), route('/return-plan/request', 'POST', 'request'),
    route('/return-plan/accept', 'POST', 'acceptChange')];
}
