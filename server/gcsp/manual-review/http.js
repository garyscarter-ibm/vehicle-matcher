import { result } from '../repository/core.js';

export function createManualReviewDetailsRoutes(service) {
  return [['GET', 'readReviewDetails'], ['POST', 'saveReviewDetails']].map(([method, operation]) => ({
    method, path: '/api/gcsp/manual/review-details', role: 'employee',
    async handle({ context, body, searchParams }) {
      if (searchParams && [...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Review details use the trusted employee session.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', {
        code: 'manual-review-source-unavailable', reason: 'The review details service has not been configured.', retryable: true });
      return service[operation](context, body);
    },
  }));
}
