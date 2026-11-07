import { inputDigest, ok, result } from '../repository/index.js';

// Document/readiness status capability for the single ordering adapter (attach as `documentStatus`).
// It never places orders; its typed receipts live under their own namespace.
export const DOCUMENT_STATUS_CAPABILITY = 'ordering.documentStatus.v1';
const consumerId = 'synthetic-ordering:documents:v1';
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512;
const valid = (op) => op && text(op.operationId) && text(op.orderUuid) && text(op.itemId) && text(op.runId)
  && op.context?.runId === op.runId && typeof op.fail === 'boolean' && Number.isFinite(Date.parse(op.progressAt ?? op.openedAt));
const payload = ({ context, ...rest }) => rest;
const unsupportedOperation = () => result('unsupported', { reason: 'invalid-document-operation' });

export function createSyntheticDocumentStatus({ repository } = {}) {
  async function record(op, step, outcome) {
    const digest = inputDigest(payload(op));
    const stored = await repository.transaction(op.context, { commandId: `${consumerId}:${op.operationId}:${step}`, inputDigest: digest }, async (tx) => {
      const receipt = await tx.recordReceipt({ consumerId, eventId: `${op.operationId}:${step}`, inputDigest: digest,
        eventType: `synthetic-document-${step}`, state: 'completed', outcome });
      return receipt.status === 'ok' ? ok(receipt.value.outcome) : receipt;
    });
    return stored.status === 'ok' ? stored.value : stored;
  }
  return {
    mode: 'synthetic', contractVersion: '1.0.0', capability: DOCUMENT_STATUS_CAPABILITY,
    async start(op) {
      if (!valid(op)) return unsupportedOperation();
      return record(op, 'start', { status: 'accepted', operationId: op.operationId, orderUuid: op.orderUuid, itemId: op.itemId,
        providerReference: `SYN-DOC-${op.operationId.slice(0, 12).toUpperCase()}`, fictional: true });
    },
    // Deterministic synthetic provider: due work completes, or fails when the pinned scenario selected it.
    async progress(op, now) {
      if (!valid(op) || !Number.isFinite(Date.parse(now))) return unsupportedOperation();
      if (Date.parse(now) < Date.parse(op.progressAt)) return { status: 'in-progress', operationId: op.operationId };
      return record(op, 'result', op.fail ? { status: 'failed', operationId: op.operationId, reason: op.failureReason, fictional: true }
        : { status: 'complete', operationId: op.operationId, fictional: true });
    },
  };
}

// Live-shaped stub: the same port, refusing every write rather than pretending a provider accepted it.
export function createLiveDocumentStatusStub() {
  const refused = () => result('unsupported', { reason: 'Live document and readiness writes are not supported in this demonstration.' });
  return { mode: 'live', contractVersion: '1.0.0', capability: DOCUMENT_STATUS_CAPABILITY, start: async () => refused(), progress: async () => refused() };
}
