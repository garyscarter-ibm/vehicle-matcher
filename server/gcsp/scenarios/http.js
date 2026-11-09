import { result } from '../repository/core.js';
import { renewPresenterAfterReset } from '../clock/http.js';

export function createScenarioRoutes(scenarios, clock) {
  const route = (suffix, method, operation) => ({ method, path: `/api/gcsp/presenter/scenarios${suffix}`,
    role: 'presenter', purpose: 'presenter-control', ...(operation === 'reset' ? { resetReplay: true } : {}),
    async handle({ context, body, searchParams, identity, setCookie }) {
      if ([...searchParams.keys()].length || method === 'GET' && Object.keys(body).length) return result('invalid', {
        code: 'unsupported-query', reasons: [{ field: 'query', reason: 'Scenario controls accept no query selectors.' }],
      });
      if (!scenarios || !clock) return result('unavailable', { reason: 'Named scenarios have not been configured.', retryable: false });
      const outcome = await scenarios[operation](context, body);
      return operation === 'reset' ? renewPresenterAfterReset({ clock, identity, context, outcome, setCookie }) : outcome;
    } });
  return [route('', 'GET', 'readCatalogue'), route('/current', 'GET', 'readState'), route('/reset', 'POST', 'reset'),
    route('/faults', 'GET', 'readFaults'), route('/faults', 'POST', 'setFault')];
}
