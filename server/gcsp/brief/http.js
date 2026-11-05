import { result } from '../repository/index.js';

export function createBriefRoutes(service, editorService) {
  const route = (path, method, operation) => ({ method, path: `/api/gcsp/brief${path}`, role: 'employee', browserContext: 'ignore',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Brief routes use the current trusted employee and run.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', {
        reason: 'The brief service has not been configured.', retryable: true,
      });
      return service[operation](context, body);
    } });
  const editor = (path, method, operation) => ({ ...route(path, method, operation), browserContext: undefined,
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query', reasons: [{ field: 'query', reason: 'Use the current trusted editor context.' }] });
      if (!editorService || typeof editorService[operation] !== 'function') return result('unavailable', { reason: 'The brief editor has not been configured.', retryable: true });
      return editorService[operation](context, body);
    } });
  return [editor('/editor', 'GET', 'readEditor'), editor('/preview', 'POST', 'previewDraft'), route('', 'GET', 'readCurrent'), route('/history', 'GET', 'readHistory'), route('/draft', 'GET', 'readDraft'),
    route('/draft', 'POST', 'saveDraft'), route('/confirm', 'POST', 'confirm'), route('/pause', 'POST', 'pause'),
    route('/resume', 'POST', 'resume'), route('/change-after-decline', 'POST', 'changeAfterDecline')];
}
