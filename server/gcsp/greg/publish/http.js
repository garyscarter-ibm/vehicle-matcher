import { result } from '../../repository/index.js';

export function createGregPublishRoutes(service) {
  return [
    { method: 'GET', path: '/api/gcsp/greg/policy', action: 'readPolicy' },
    { method: 'POST', path: '/api/gcsp/greg/policy/preview', action: 'preview' },
    { method: 'POST', path: '/api/gcsp/greg/policy/publish', action: 'publish' },
  ].map(({ action, ...route }) => ({ ...route, role: 'greg', async handle({ context, searchParams, body }) {
    if (searchParams && [...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
      reasons: [{ field: 'query', reason: 'Policy controls use the current trusted run and role.' }] });
    if (route.method === 'GET' && body !== undefined && body !== null) return result('invalid', { code: 'unsupported-body',
      reasons: [{ field: 'body', reason: 'Policy reads do not accept a body.' }] });
    if (typeof service?.[action] !== 'function') return result('unavailable', { retryable: true,
      reason: 'The policy controls have not been configured.' });
    return service[action](context, body);
  } }));
}
