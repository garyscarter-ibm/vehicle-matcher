import { result } from '../repository/index.js';

export function createManualContextRoutes(service) {
  const route = (path, method, operation) => ({ method, path: `/api/gcsp/manual${path}`, role: 'employee',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Manual context uses the trusted employee session.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', {
        reason: 'The manual context service has not been configured.', retryable: true,
      });
      return service[operation](context, body);
    } });
  return [route('/account', 'GET', 'readAccount'), route('/draft', 'GET', 'readDraft'),
    route('/draft', 'POST', 'saveDraft'), route('/stock', 'GET', 'browseStock')];
}
