import { result } from '../../repository/index.js';

// Browser identity/run claims are discarded by the shared handler; services use only the resolved context.
export function createAppointmentRoutes(service) {
  const route = (path, method, operation, query = []) => ({ method, path: `/api/gcsp${path}`, browserContext: 'ignore',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].some((key) => !query.includes(key))) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Appointments use the current trusted employee and demonstration run.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', { reason: 'Handover appointments are unavailable. Ask the scheme team to check the service.', retryable: true });
      return service[operation](context, method === 'GET' ? Object.fromEntries(query.filter((k) => searchParams.has(k)).map((k) => [k, searchParams.get(k)])) : body);
    } });
  return [route('/appointments', 'GET', 'read', ['orderUuid']), route('/appointments/request', 'POST', 'request'),
    route('/appointments/accept', 'POST', 'acceptChange')];
}
