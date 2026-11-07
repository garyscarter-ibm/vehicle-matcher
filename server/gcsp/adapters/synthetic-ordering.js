import { ok, result } from '../repository/index.js';

const consumerId = 'synthetic-ordering:v1';
const valid = (o) => o?.operationType === 'selection-order' && o.payload?.context?.runId === o.runId
  && o.idempotencyKey === o.operationId && /^\d{7}$/.test(o.payload?.selection?.stock?.orderNumber ?? '')
  && o.payload.selection.stock.orderUuid === o.payload.orderUuid;
const scope = (o) => ({ operationId: o.operationId, runId: o.runId, orderUuid: o.payload.orderUuid });

// Explicitly synthetic: the simulated provider's idempotent receipt is durable in the injected repository.
// No HTTP, BMW approval, generated order number, private map or timer is involved.
export function createSyntheticOrderingAdapter({ repository } = {}) {
  return {
    mode: 'synthetic', contractVersion: '1.0.0',
    async execute(operation) {
      if (!valid(operation)) return result('unsupported', { reason: 'invalid-ordering-operation' });
      const selection = operation.payload.selection;
      const outcome = { status: 'confirmed', ...scope(operation), configurationId: selection.stock.configurationId,
        orderNumber: selection.stock.orderNumber, orderStatus: selection.terms.approvalStages[0], fictional: true };
      const stored = await repository.transaction(operation.payload.context,
        { commandId: `synthetic-ordering:${operation.operationId}`, inputDigest: operation.inputDigest }, async (tx) => {
          const receipt = await tx.recordReceipt({ consumerId, eventId: operation.operationId, inputDigest: operation.inputDigest,
            eventType: 'synthetic-ordering-acknowledged', state: 'completed', outcome });
          return receipt.status === 'ok' ? ok(receipt.value.outcome) : receipt;
        });
      return stored.status === 'ok' ? stored.value : stored;
    },
    async reconcile(operation) {
      if (!valid(operation)) return result('unsupported', { reason: 'invalid-ordering-operation' });
      const found = await repository.read(operation.payload.context, { table: 'event_receipts', key: {
        runId: operation.runId, consumerId, eventId: operation.operationId } });
      return found.status === 'ok' ? found.value.inputDigest === operation.inputDigest ? found.value.outcome
        : result('conflict', { reason: 'idempotency-input-changed' })
        : found.status === 'not-found' ? { status: 'not-found', ...scope(operation) } : found;
    },
  };
}
