import { result } from '../repository/index.js';

export function createGregRoutes(service) {
  return [{ method: 'GET', path: '/api/gcsp/greg/demand', role: 'greg',
    async handle({ context, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Demand uses the current trusted role and run, without display sampling.' }] });
      if (typeof service?.readDemand !== 'function') return result('unavailable', {
        reason: 'The saved-demand service has not been configured.', retryable: true });
      return service.readDemand(context);
    } }];
}
