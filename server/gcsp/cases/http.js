import { result } from '../repository/core.js';
export function createCaseRoutes(service) {
  const route = (path, method, operation, own = false) => ({ method, path: `/api/gcsp${path}`, browserContext: 'ignore',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].some((key) => !(own && key === 'caseId'))) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Cases use the current trusted employee and demonstration run.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', { reason: 'Renewal help is unavailable. Ask the scheme team to check the service.', retryable: true });
      return service[operation](context, method === 'GET' ? own && searchParams.has('caseId') ? { caseId: searchParams.get('caseId') } : {} : body);
    } });
  return [route('/help', 'GET', 'readHelp'),route('/cases', 'GET', 'readOwn', true),route('/cases', 'POST', 'requestHelp'),
    route('/scheme-team/cases','GET','list'),route('/scheme-team/cases/update','POST','update')];
}
