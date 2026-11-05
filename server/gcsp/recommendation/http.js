import { createEmployeeRecommendationService } from './index.js';

export function createEmployeeRecommendationRoutes(configuration) {
  const service = createEmployeeRecommendationService(configuration ?? undefined);
  return [{
    method: 'POST',
    path: '/api/gcsp/recommendations',
    role: 'employee',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length) return {
        status: 'invalid', code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Employee recommendation inputs belong in the request body.' }],
        contractVersion: '1.0.0',
      };
      return service.recommend(context, body);
    },
  }];
}
