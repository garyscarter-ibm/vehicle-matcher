import { ok, result } from '../repository/index.js';

// Status capability for FUCQ-71's single ordering adapter (synthetic-ordering:v1). Its own receipt namespace
// keeps the selection acknowledgement untouched; this is not a second selection-ordering adapter.
export const STATUS_CONSUMER = 'synthetic-ordering-status:v1';
export const DECISION_OPERATION = 'lifecycle-approval-decision';
const valid = (o) => o?.operationType === DECISION_OPERATION && o.idempotencyKey === o.operationId && o.payload?.context?.runId === o.runId
  && typeof o.payload.orderUuid === 'string' && typeof o.payload.stage === 'string' && ['approved', 'declined'].includes(o.intendedDecision)
  && typeof o.inputDigest === 'string';
const scope = (o) => ({ operationId: o.operationId, runId: o.runId, orderUuid: o.payload.orderUuid, stage: o.payload.stage });

// Explicitly synthetic: the simulated provider's decision is the scenario-keyed intent, durably receipted once.
export function createSyntheticOrderingStatus({ repository } = {}) {
  return {
    mode: 'synthetic', contractVersion: '1.0.0', provider: STATUS_CONSUMER,
    async requestDecision(operation) {
      if (!valid(operation)) return result('unsupported', { ...(operation?.operationId ? { operationId: operation.operationId } : {}), reason: 'invalid-status-operation' });
      const outcome = { status: 'confirmed', ...scope(operation), state: operation.intendedDecision,
        providerReference: `${STATUS_CONSUMER}:${operation.operationId}`, decidedAt: operation.payload.occurredAt, fictional: true };
      const stored = await repository.transaction(operation.payload.context,
        { commandId: `synthetic-ordering-status:${operation.operationId}`, inputDigest: operation.inputDigest }, async (tx) => {
          const receipt = await tx.recordReceipt({ consumerId: STATUS_CONSUMER, eventId: operation.operationId, inputDigest: operation.inputDigest,
            eventType: 'synthetic-ordering-status-decided', state: 'completed', outcome });
          return receipt.status === 'ok' ? ok(receipt.value.outcome) : receipt;
        });
      return stored.status === 'ok' ? stored.value : stored;
    },
    async reconcile(operation) {
      if (!valid(operation)) return result('unsupported', { reason: 'invalid-status-operation' });
      const found = await repository.read(operation.payload.context, { table: 'event_receipts', key: {
        runId: operation.runId, consumerId: STATUS_CONSUMER, eventId: operation.operationId } });
      return found.status === 'ok' ? found.value.inputDigest === operation.inputDigest ? found.value.outcome
        : result('conflict', { reason: 'idempotency-input-changed' })
        : found.status === 'not-found' ? { status: 'not-found', ...scope(operation) } : found;
    },
  };
}

// Live-shaped boundary: no BMW approval system is reachable, so every write is refused and state stays put.
export function createLiveOrderingStatusStub() {
  const refuse = (operation) => ({ status: 'unsupported', ...(valid(operation) ? scope(operation) : {}), code: 'live-ordering-unsupported',
    reason: 'Live approval updates are not connected in this demonstration. The order stays at its current step.' });
  return { mode: 'live', contractVersion: '1.0.0', provider: 'live-ordering-status:stub',
    async requestDecision(operation) { return refuse(operation); },
    async reconcile(operation) { return refuse(operation); } };
}
