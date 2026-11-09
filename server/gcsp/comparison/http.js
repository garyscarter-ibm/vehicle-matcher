import { result } from '../repository/index.js';
import { readLatestComparisonResult } from './results.js';

/** Ok for Greg or the presenter; any other role gets the presenter check's refusal. */
export async function requireGregOrPresenter(identity, context) {
  const greg = await identity.requireRole(context, 'greg');
  return greg.status === 'ok' ? greg : identity.requireRole(context, 'presenter');
}

// Greg and presenter may read the stored result; every other role is refused here, not by the route.
export function createComparisonResultService({ repository, policy, clock, identity } = {}) {
  return {
    async readLatest(context) {
      const allowed = await requireGregOrPresenter(identity, context);
      if (allowed.status !== 'ok') return allowed;
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
