import { result } from '../../repository/core.js';

// Trusted context only: browser employee/run claims are discarded by the shared gate before this handler runs.
export function createLifecycleApprovalRoutes(service) {
  const route = (path, operation) => ({ method: 'GET', path: `/api/gcsp${path}`, browserContext: 'ignore',
    async handle({ context, searchParams }) {
      if ([...searchParams.keys()].some((key) => key !== 'orderUuid')) return result('invalid', { code: 'unsupported-query',
        reasons: [{ field: 'query', reason: 'Order progress uses the current trusted session and demonstration run.' }] });
      if (!service || typeof service[operation] !== 'function') return result('unavailable', { retryable: true,
        reason: 'Order progress is unavailable. Ask the scheme team to check the service.' });
      return operation === 'read' ? service.read(context, { orderUuid: searchParams.get('orderUuid') ?? undefined }) : service.listOrders(context);
    } });
  return [route('/orders/progress', 'read'), route('/orders/progress/all', 'listOrders')];
}
