import { result } from '../repository/index.js';

export function createActivityRoutes(service) {
  return [{ method: 'GET', path: '/api/gcsp/activity', role: 'employee',
    async handle({ context, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Activity uses the current trusted employee and run.' }] });
      if (typeof service?.readActivity !== 'function') return result('unavailable', {
        reason: 'The activity service has not been configured.', retryable: true });
      return service.readActivity(context);
    } }];
}
