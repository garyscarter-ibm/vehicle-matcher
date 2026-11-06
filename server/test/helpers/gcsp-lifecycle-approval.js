import { inputDigest } from '../../gcsp/repository/index.js';

// Injected FUCQ-71-shaped rows (ed20ca2 manual-order/index.js:127-131, :218-221). They prove consumer mechanics only;
// a real producer integration needs FUCQ-71's own service writing these rows.
const HR = ['HR approval', 'sales-manager approval', 'sent to ordering'];
let counter = 0;
function operation(context, { sourceType = 'cart', stages = HR, state, renewalId } = {}) {
  counter += 1;
  const orderUuid = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const operationId = `selection:${inputDigest([context.runId, context.employeeId, counter])}`;
  const selection = { schemaVersion: 1, receivedAt: '2026-11-05T09:00:00.000Z', source: { type: sourceType, holdId: `hold-${counter}` },
    quote: { quoteId: `quote-${counter}` }, stock: { orderUuid, orderNumber: String(1000000 + counter), configurationId: `config-${counter}` },
    terms: { termsVersion: 'fictional-order-terms-v1', termsDigest: 'f'.repeat(64), policyVersion: context.policyVersion, approvalStages: stages } };
  const confirmed = { status: 'confirmed', operationId, runId: context.runId, orderUuid, configurationId: selection.stock.configurationId,
    orderNumber: selection.stock.orderNumber, orderStatus: stages[0], fictional: true };
  return { renewalId, row: { runId: context.runId, operationId, operationType: 'selection-order', idempotencyKey: operationId, inputDigest: inputDigest(selection),
    state, lastKnownState: state === 'completed' ? 'acknowledged' : 'allocation-pending', attempts: state === 'completed' ? 1 : 0,
    payload: { context: { ...context }, orderUuid, selection }, ...(state === 'completed' ? { outcome: confirmed } : {}) } };
}
async function write(repository, context, options) {
  const { row, renewalId } = operation(context, options);
  const stored = await repository.transaction(context, { commandId: `fixture:${row.operationId}`, inputDigest: row.inputDigest }, async (tx) => {
    const inserted = await tx.insert('pending_operations', row); if (inserted.status !== 'ok' || !renewalId) return inserted;
    const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
    const employee = await tx.get(ref); if (employee.status !== 'ok') return employee;
    return tx.compareAndSwap(ref, employee.value.version, { renewalId });
  });
  if (stored.status !== 'ok') throw new Error(JSON.stringify(stored));
  return { orderUuid: row.payload.orderUuid, operationId: row.operationId };
}
export const acknowledgedSelection = (repository, context, options = {}) => write(repository, context, { ...options, state: 'completed' });
export const pendingSelection = (repository, context, options = {}) => write(repository, context, { ...options, state: 'pending' });
