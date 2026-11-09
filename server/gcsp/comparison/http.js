import { result } from '../repository/index.js';
import { readLatestComparisonResult } from './results.js';

// Greg and presenter may read the stored result; every other role is refused here, not by the route.
export function createComparisonResultService({ repository, policy, clock, identity } = {}) {
  return {
    async readLatest(context) {
      const greg = await identity.requireRole(context, 'greg');
      if (greg.status !== 'ok') {
        const presenter = await identity.requireRole(context, 'presenter');
        if (presenter.status !== 'ok') return presenter;
      }
      const time = await clock.now(context);
      if (time.status !== 'ok') return time;
      try {
        return await readLatestComparisonResult(repository, context, policy, { asOf: time.value.now });
      } catch {
        return result('unavailable', { reason: 'The stored comparison result is unavailable.', retryable: true });
      }
    },
  };
}

export function createComparisonResultRoutes(service) {
  return [{ method: 'GET', path: '/api/gcsp/comparison/process/latest',
    async handle({ context, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'The latest stored result takes no query.' }] });
      if (typeof service?.readLatest !== 'function') return result('unavailable', {
        reason: 'The comparison result service has not been configured.', retryable: true });
      return service.readLatest(context);
    } }];
}
