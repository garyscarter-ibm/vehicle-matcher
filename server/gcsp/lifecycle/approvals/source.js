import { ok, result } from '../../repository/core.js';

// Decodes FUCQ-71's actual `selection-order` operation (ed20ca2 manual-order/index.js:127-131, :218-221).
// Only an acknowledged, scope-matching operation is an allocated order; nothing here invents one.
export const SELECTION_OPERATION = 'selection-order';
const ROUTES = { cart: 'manual', 'buddy-offer': 'buddy' };
const text = (v, max = 256) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
// Not ready is `unavailable` with a code, so the shared HTTP gate maps it to 503 rather than an unknown status.
export const notReady = (code, reason) => result('unavailable', { code, reason, retryable: true, state: 'not-ready' });

export function decodeSelectionOrder(row) {
  const p = row?.payload; const s = p?.selection; const o = row?.outcome;
  if (row?.operationType !== SELECTION_OPERATION || !text(row.operationId) || !text(p?.orderUuid) || !text(p?.context?.employeeId)) {
    return result('unavailable', { code: 'selection-source-invalid', retryable: false, reason: 'The selection record could not be read.' });
  }
  if (row.state === 'pending') return notReady('selection-pending', 'The selection is still being sent on.');
  if (row.state === 'failed') return notReady('selection-handoff-failed', 'The selection was not accepted for ordering.');
  const route = ROUTES[s?.source?.type];
  const valid = row.state === 'completed' && row.lastKnownState === 'acknowledged' && o?.status === 'confirmed'
    && o.operationId === row.operationId && o.runId === row.runId && o.orderUuid === p.orderUuid
    && s?.stock?.orderUuid === p.orderUuid && route && text(s.receivedAt) && Number.isFinite(Date.parse(s.receivedAt))
    && Array.isArray(s.terms?.approvalStages) && text(s.terms?.policyVersion);
  if (!valid) return result('unavailable', { code: 'selection-source-invalid', retryable: false, reason: 'The selection record could not be read.' });
  return ok({ runId: row.runId, orderUuid: p.orderUuid, employeeId: p.context.employeeId, entitlementSlotId: p.context.entitlementSlotId ?? null,
    route, source: { operationId: row.operationId, operationType: SELECTION_OPERATION, sourceType: s.source.type, holdId: s.source.holdId ?? null,
      orderNumber: o.orderNumber ?? s.stock.orderNumber ?? null, configurationId: o.configurationId ?? s.stock.configurationId ?? null,
      receivedAt: s.receivedAt, quoteId: s.quote?.quoteId ?? null, termsVersion: s.terms.termsVersion ?? null, termsDigest: s.terms.termsDigest ?? null,
      approvalStages: s.terms.approvalStages, policyVersion: s.terms.policyVersion, operationVersion: row.version ?? null,
      providerReference: `synthetic-ordering:v1:${row.operationId}` } });
}

// Run-bound lookup by allocated order UUID. More than one acknowledged operation for a UUID is refused, not chosen.
// An employee reader is refused for another employee's order before its readiness is revealed.
export async function findSelectionOrder(reader, orderUuid, employeeId) {
  const rows = await reader('pending_operations', { operationType: SELECTION_OPERATION });
  if (rows.status !== 'ok') return rows;
  const matches = rows.value.filter((row) => row.payload?.orderUuid === orderUuid);
  if (!matches.length) return result('not-found', { resourceType: 'order', reason: 'No selection has been sent on for this order.' });
  if (employeeId !== undefined && matches.some((row) => row.payload?.context?.employeeId !== employeeId)) {
    return result('forbidden', { reason: 'This order belongs to another employee.' });
  }
  const decoded = matches.map(decodeSelectionOrder);
  const ready = decoded.filter((d) => d.status === 'ok');
  if (ready.length > 1) return result('conflict', { reason: 'duplicate-order-source' });
  return ready[0] ?? decoded[0];
}

export async function listSelectionOrders(reader) {
  const rows = await reader('pending_operations', { operationType: SELECTION_OPERATION });
  if (rows.status !== 'ok') return rows;
  return ok(rows.value.map(decodeSelectionOrder).filter((d) => d.status === 'ok').map((d) => d.value));
}

// Renewal identity comes only from the stored employee or slot authority; absence is an explicit gap.
export async function readRenewalAuthority(get, runId, source) {
  const employee = await get({ table: 'employees', key: { runId, employeeId: source.employeeId } });
  if (employee.status !== 'ok') return employee.status === 'not-found' ? ok({ renewalId: null }) : employee;
  let renewalId = employee.value.renewalId;
  if (!text(renewalId, 128) && text(source.entitlementSlotId)) {
    const slot = await get({ table: 'entitlement_slots', key: { runId, entitlementSlotId: source.entitlementSlotId } });
    if (slot.status !== 'ok' && slot.status !== 'not-found') return slot;
    if (slot.status === 'ok' && slot.value.employeeId === source.employeeId) renewalId = slot.value.renewalId;
  }
  return ok({ renewalId: text(renewalId, 128) ? renewalId : null });
}
