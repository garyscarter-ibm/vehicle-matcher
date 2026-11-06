import { result } from '../repository/index.js';

export function createManualClaimsRoutes(service) {
  const route = (path, method, operation) => ({ method, path: `/api/gcsp/manual${path}`, role: 'employee',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Claims use the current trusted employee and entitlement.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', {
        reason: 'Manual claims have not been configured.', retryable: true });
      return service[operation](context, body);
    } });
  return [route('/claim', 'GET', 'readClaim'), route('/quote', 'GET', 'readQuote'), route('/claim', 'POST', 'claim'),
    route('/claim/review', 'POST', 'beginReview'), route('/claim/release', 'POST', 'release')];
  // Allocation is a backend port for the later declarations/order-handoff service.
  // There is no public final-submit shortcut in this slice.
}
