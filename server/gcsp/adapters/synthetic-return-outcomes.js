import { inputDigest, ok, result } from '../repository/index.js';

// Return outcome step of the ordering.appointments.v1 capability (FUCQ-168). Physical return stays outside the walkthrough,
// so the synthetic provider reports the keyed outcome once the slot has passed, receipted once per operation ID.
export const RETURN_OUTCOME_CONSUMER = 'synthetic-return-outcomes:v1';
export const RETURN_OUTCOME_OPERATION = 'lifecycle-return-outcome';
export const RETURN_OUTCOMES = Object.freeze(['returned', 'missed']);
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const instant = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const validSlot = (s) => s && text(s.slotId, 64) && instant(s.start) && instant(s.end);
const valid = (o) => o && o.operationType === RETURN_OUTCOME_OPERATION && text(o.operationId) && o.idempotencyKey === o.operationId && text(o.runId)
  && o.payload?.context?.runId === o.runId && text(o.payload.orderUuid) && o.payload.step === 'outcome' && text(o.inputDigest)
  && validSlot(o.payload.slot) && instant(o.payload.confirmAfter) && RETURN_OUTCOMES.includes(o.payload.outcome);
const scope = (o) => ({ operationId: o.operationId, orderUuid: o.payload.orderUuid, step: 'outcome' });
const reference = (o) => `SYN-RET-${inputDigest(['synthetic-return-outcome', o.operationId]).slice(0, 12).toUpperCase()}`;
const invalidOperation = () => result('unsupported', { code: 'invalid-return-outcome-operation', reason: 'invalid-return-outcome-operation' });

export function createSyntheticReturnOutcomes({ repository } = {}) {
  return {
    mode: 'synthetic', contractVersion: '1.0.0', capability: 'ordering.appointments.v1',
    // Before the keyed time nothing is receipted; afterwards the pinned scenario decides returned or missed, once.
    async confirmOutcome(operation, now) {
      if (!valid(operation) || !instant(now)) return invalidOperation();
      if (Date.parse(now) < Date.parse(operation.payload.confirmAfter)) return { status: 'in-progress', ...scope(operation), fictional: true };
      const outcome = { status: operation.payload.outcome, ...scope(operation), slot: operation.payload.slot, at: now, providerReference: reference(operation), fictional: true };
      const stored = await repository.transaction(operation.payload.context,
        { commandId: `${RETURN_OUTCOME_CONSUMER}:${operation.operationId}`, inputDigest: operation.inputDigest }, async (tx) => {
          const receipt = await tx.recordReceipt({ consumerId: RETURN_OUTCOME_CONSUMER, eventId: operation.operationId, inputDigest: operation.inputDigest,
            eventType: `synthetic-return-${operation.payload.outcome}`, state: 'completed', outcome });
          return receipt.status === 'ok' ? ok(receipt.value.outcome) : receipt;
        });
      return stored.status === 'ok' ? stored.value : stored;
    },
    // The stored outcome for this operation, `not-found` when the provider never received it, or `conflict` if its input changed.
    async reconcile(operation) {
      if (!valid(operation)) return invalidOperation();
      const found = await repository.read(operation.payload.context, { table: 'event_receipts', key: {
        runId: operation.runId, consumerId: RETURN_OUTCOME_CONSUMER, eventId: operation.operationId } });
      if (found.status === 'ok') return found.value.inputDigest === operation.inputDigest ? found.value.outcome : result('conflict', { reason: 'idempotency-input-changed' });
      return found.status === 'not-found' ? { status: 'not-found', ...scope(operation) } : found;
    },
  };
}

// Live-shaped boundary: no retailer return confirmation is reachable, so every call is refused and nothing is written.
export function createLiveReturnOutcomesStub() {
  const refuse = (operation) => ({ status: 'unsupported', ...(valid(operation) ? scope(operation) : {}), code: 'live-return-outcomes-unsupported',
    reason: 'Live return confirmation is not connected in this demonstration. The return stays as it is.' });
  return { mode: 'live', contractVersion: '1.0.0', capability: 'ordering.appointments.v1',
    async confirmOutcome(operation) { return refuse(operation); },
    async reconcile(operation) { return refuse(operation); } };
}
