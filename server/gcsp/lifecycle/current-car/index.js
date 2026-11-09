import { inputDigest, ok, result } from '../../repository/index.js';
import { validInstant } from '../../policy/file-provider.js';
import { findSelectionOrder } from '../approvals/source.js';

// Paula's current-car relationship per exact order (FUCQ-168): only a confirmed handover completion or a confirmed
// return changes it. Acceptance, approval and scheduling never call this, so they never change it.
export const CURRENT_CAR_CONTRACT = 'lifecycle.current-car.v1';
export const CURRENT_CAR_STATE = 'lifecycle-current-car:state:v1';
export const CURRENT_CAR_EVENTS = 'lifecycle-current-car:events:v1';
export const CURRENT_CAR_EVENT_TYPES = Object.freeze(['handover-completed', 'return-confirmed']);
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const stateRef = (runId, orderUuid) => ({ table: 'event_receipts', key: { runId, consumerId: CURRENT_CAR_STATE, eventId: orderUuid } });
const invalid = (field, reason) => result('invalid', { code: 'invalid-current-car-event', reasons: [{ field, reason }], action: 'review-and-retry' });
const badSource = () => result('unavailable', { code: 'current-car-source-invalid', retryable: false, reason: 'The record of your current car could not be read.' });

// The order's exact identities from FUCQ-71's selection: the new car by orderUuid, the old car by contract and slot.
async function identities(reader, runId, orderUuid) {
  const found = await findSelectionOrder(reader.list, orderUuid); if (found.status !== 'ok') return found;
  const row = await reader.get({ table: 'pending_operations', key: { runId, operationId: found.value.source.operationId } });
  if (row.status !== 'ok') return row.status === 'not-found' ? badSource() : row;
  const s = row.value.payload?.selection; const mode = s?.draft?.choices?.mode;
  const base = { employeeId: found.value.employeeId, orderUuid, configurationId: found.value.source.configurationId ?? null };
  if (mode === 'new') return ok({ ...base, oldCar: null });
  const contract = s?.oldContract;
  if (mode !== 'replacement' || !object(contract) || !text(contract.contractId)) return badSource();
  return ok({ ...base, oldCar: { contractId: contract.contractId, slotId: s.vehicleSlot?.entitlementSlotId ?? contract.slotId ?? null } });
}

function baseline(runId, id) {
  return { schemaVersion: 1, runId, orderUuid: id.orderUuid, employeeId: id.employeeId,
    oldCar: id.oldCar ? { ...id.oldCar, status: 'held', returnedAt: null, providerReference: null, location: null } : null,
    newCar: { orderUuid: id.orderUuid, configurationId: id.configurationId, status: 'on-order', collectedAt: null, vin: null, providerReference: null },
    changes: [] };
}

// The car she drives: the new one once collected, else the old one until it is returned; none if returned first.
function present(r) {
  const currentCar = r.newCar.status === 'collected' ? { kind: 'order', orderUuid: r.newCar.orderUuid, vin: r.newCar.vin }
    : r.oldCar?.status === 'held' ? { kind: 'contract', contractId: r.oldCar.contractId, slotId: r.oldCar.slotId } : null;
  return { contractVersion: CURRENT_CAR_CONTRACT, runId: r.runId, orderUuid: r.orderUuid, employeeId: r.employeeId, currentCar,
    oldCar: r.oldCar, newCar: r.newCar, changes: r.changes, fictional: true };
}

function check(e) {
  if (!object(e) || !CURRENT_CAR_EVENT_TYPES.includes(e.type)) return invalid('type', 'Only a confirmed handover completion or return changes the current car.');
  if (!text(e.orderUuid, 128) || !text(e.employeeId, 128)) return invalid('orderUuid', 'Supply the exact order and employee.');
  if (!validInstant(e.occurredAt) || !text(e.providerReference, 128)) return invalid('occurredAt', 'Supply the confirmed time and provider reference.');
  if (!object(e.appointment) || !text(e.appointment.providerReference, 128) || !text(e.appointment.slotId, 64)) return invalid('appointment', 'Supply the confirmed appointment.');
  if (e.type === 'return-confirmed' && !text(e.oldContractId, 128)) return invalid('oldContractId', 'Supply the returned contract.');
  if (e.type === 'handover-completed' && e.vin != null && !/^[A-HJ-NPR-Z0-9]{17}$/.test(e.vin)) return invalid('vin', 'A delivered car VIN has 17 characters.');
  return null;
}

// Applies one confirmed event inside the caller's transaction. A repeat is a no-op; changed input for the same event is a conflict.
export async function applyCurrentCarEvent(tx, runId, event) {
  const bad = check(event); if (bad) return bad;
  const reader = { list: (table, filter) => tx.list(table, filter), get: (ref) => tx.get(ref) };
  const id = await identities(reader, runId, event.orderUuid); if (id.status !== 'ok') return id;
  if (id.value.employeeId !== event.employeeId) return result('forbidden', { reason: 'This order belongs to another employee.' });
  if (event.type === 'return-confirmed' && !id.value.oldCar) return result('conflict', { code: 'return-not-applicable', reason: 'A new order has no current car to return.' });
  if (event.type === 'return-confirmed' && event.oldContractId !== id.value.oldCar.contractId) {
    return result('conflict', { code: 'current-car-identity-mismatch', reason: 'The returned car is not the car this order replaces.' });
  }
  const stable = { ...event, vin: event.vin ?? null, location: event.location ?? null };
  const eventId = `${event.type}:${event.orderUuid}`;
  const prior = await tx.getReceipt(CURRENT_CAR_EVENTS, eventId);
  const found = await tx.get(stateRef(runId, event.orderUuid));
  if (found.status !== 'ok' && found.status !== 'not-found') return found;
  if (prior.status === 'ok') {
    if (prior.value.inputDigest !== inputDigest(stable)) return result('conflict', { code: 'idempotency-input-changed', reason: 'This event was already recorded differently.' });
    return ok({ applied: false, relationship: present(found.status === 'ok' ? found.value.outcome.value : baseline(runId, id.value)) });
  }
  if (prior.status !== 'not-found') return prior;
  const r = found.status === 'ok' ? found.value.outcome.value : baseline(runId, id.value);
  const change = { type: event.type, at: event.occurredAt, providerReference: event.providerReference, appointment: structuredClone(event.appointment) };
  const next = event.type === 'handover-completed'
    ? { ...r, newCar: { ...r.newCar, status: 'collected', collectedAt: event.occurredAt, vin: stable.vin, providerReference: event.providerReference }, changes: [...r.changes, change] }
    : { ...r, oldCar: { ...r.oldCar, status: 'returned', returnedAt: event.occurredAt, providerReference: event.providerReference, location: stable.location }, changes: [...r.changes, change] };
  const recorded = await tx.recordReceipt({ consumerId: CURRENT_CAR_EVENTS, eventId, inputDigest: inputDigest(stable), eventType: `current-car-${event.type}`,
    state: 'completed', outcome: ok(stable) });
  if (recorded.status !== 'ok') return recorded;
  const stored = found.status === 'ok'
    ? await tx.compareAndSwap(stateRef(runId, event.orderUuid), found.value.version, { outcome: ok(next) })
    : await tx.insert('event_receipts', { runId, consumerId: CURRENT_CAR_STATE, eventId: event.orderUuid, inputDigest: inputDigest([event.orderUuid, 'current-car']),
      eventType: 'lifecycle-current-car-state', state: 'projection', outcome: ok(next) });
  return stored.status === 'ok' ? ok({ applied: true, relationship: present(next) }) : stored;
}

// The same, in its own transaction, for a caller outside one (FUCQ-167's handover completion, for example).
// The command key carries the input digest, so changed input reaches the coded conflict above rather than a bare replay refusal.
export function recordCurrentCarEvent(repository, context, event) {
  const digest = inputDigest(event ?? null);
  return repository.transaction(context, { commandId: `${CURRENT_CAR_EVENTS}:${event?.type}:${event?.orderUuid}:${digest.slice(0, 16)}`, inputDigest: digest },
    (tx) => applyCurrentCarEvent(tx, context.runId, event));
}

// Side-effect free: the recorded relationship, or the baseline the selection implies when nothing is confirmed yet.
export async function readCurrentCar(repository, context, orderUuid) {
  const found = await repository.read(context, stateRef(context.runId, orderUuid));
  if (found.status === 'ok') return ok(present(found.value.outcome.value));
  if (found.status !== 'not-found') return found;
  const reader = { list: (table, filter) => repository.query(context, table, filter), get: (ref) => repository.read(context, ref) };
  const id = await identities(reader, context.runId, orderUuid); if (id.status !== 'ok') return id;
  return ok(present(baseline(context.runId, id.value)));
}
