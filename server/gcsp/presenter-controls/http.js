import { result } from '../repository/core.js';
import { createPresenterControlsService } from './index.js';

export function createPresenterControlsRoutes(options) {
  const controls = createPresenterControlsService(options);
  const route = (suffix, method, operation) => ({ method, path: `/api/gcsp/presenter/controls${suffix}`,
    role: 'presenter', purpose: 'presenter-control',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length || method === 'GET' && Object.keys(body).length) return result('invalid', {
        code: 'unsupported-query', reasons: [{ field: 'query', reason: 'Presenter controls accept no query selectors.' }],
      });
      return controls[operation](context, body);
    } });
  return [route('', 'GET', 'readState'), route('/tick', 'POST', 'tick')];
}
