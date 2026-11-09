import { inputDigest, ok, result } from '../repository/index.js';

// Appointment capability for the ordering adapter family (FUCQ-114). The synthetic provider is deterministic,
// receipts each write once under its own namespace and reads time only from values the service passes in.
export const APPOINTMENT_CONSUMER = 'synthetic-appointments:v1';
export const APPOINTMENT_CAPABILITY = 'ordering.appointments.v1';
export const OPERATION_TYPES = Object.freeze({ request: 'lifecycle-appointment-request', confirm: 'lifecycle-appointment-confirm',
  accept: 'lifecycle-appointment-accept', complete: 'lifecycle-appointment-complete', noShow: 'lifecycle-appointment-no-show' });
const DAY = 86400000;
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const instant = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 13) + 'Z';
const slotAt = (start, minutes) => ({ slotId: `slot-${stamp(start)}`, start: new Date(start).toISOString(), end: new Date(start + minutes * 60000).toISOString() });
const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m) * 60000; };
const validSlot = (s) => s && text(s.slotId, 64) && instant(s.start) && instant(s.end);
const validPolicy = (p) => p && Number.isSafeInteger(p.earliestLeadDays) && p.earliestLeadDays >= 0 && Number.isSafeInteger(p.daysOffered) && p.daysOffered > 0
  && Number.isSafeInteger(p.slotMinutes) && p.slotMinutes > 0 && Array.isArray(p.dailyStartTimes) && p.dailyStartTimes.length > 0
  && p.dailyStartTimes.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t));

// Slots start `earliestLeadDays` after the demo-clock date and repeat at the keyed UTC times.
export function buildSlots({ now, ...policy } = {}) {
  if (!instant(now) || !validPolicy(policy)) return null;
  const today = Math.floor(Date.parse(now) / DAY) * DAY;
  const starts = [...policy.dailyStartTimes].sort();
  const slots = [];
  for (let d = 0; d < policy.daysOffered; d += 1) {
    for (const time of starts) slots.push(slotAt(today + (policy.earliestLeadDays + d) * DAY + clock(time), policy.slotMinutes));
  }
  return slots;
}

// The next daily start after the requested slot (the next day's first start when it was the last), from policy alone.
export function alternativeAfter(slot, policy) {
  if (!validSlot(slot) || !validPolicy(policy)) return null;
  const start = Date.parse(slot.start); const day = Math.floor(start / DAY) * DAY;
  const times = [...policy.dailyStartTimes].sort().map(clock);
  const later = times.find((t) => day + t > start);
  return slotAt(later === undefined ? day + DAY + times[0] : day + later, policy.slotMinutes);
}

const valid = (o) => o && Object.values(OPERATION_TYPES).includes(o.operationType) && text(o.operationId) && o.idempotencyKey === o.operationId
  && text(o.runId) && o.payload?.context?.runId === o.runId && text(o.payload.orderUuid) && text(o.inputDigest) && validSlot(o.payload.slot)
  && o.operationType === OPERATION_TYPES[o.payload.step];
const scope = (o) => ({ operationId: o.operationId, orderUuid: o.payload.orderUuid, step: o.payload.step });
const reference = (o) => `SYN-APT-${inputDigest(['synthetic-appointment', o.operationId]).slice(0, 12).toUpperCase()}`;
const invalidOperation = () => result('unsupported', { code: 'invalid-appointment-operation', reason: 'invalid-appointment-operation' });

// Explicitly synthetic: every outcome is fictional, derived from the operation and receipted once per operation ID.
export function createSyntheticAppointments({ repository } = {}) {
  async function record(operation, eventType, outcome) {
    const stored = await repository.transaction(operation.payload.context,
      { commandId: `${APPOINTMENT_CONSUMER}:${operation.operationId}`, inputDigest: operation.inputDigest }, async (tx) => {
        const receipt = await tx.recordReceipt({ consumerId: APPOINTMENT_CONSUMER, eventId: operation.operationId, inputDigest: operation.inputDigest,
          eventType, state: 'completed', outcome });
        return receipt.status === 'ok' ? ok(receipt.value.outcome) : receipt;
      });
    return stored.status === 'ok' ? stored.value : stored;
  }
  const base = (o, extra) => ({ ...scope(o), slot: o.payload.slot, providerReference: reference(o), fictional: true, ...extra });
  return {
    mode: 'synthetic', contractVersion: '1.0.0', capability: APPOINTMENT_CAPABILITY,
    async offerSlots(input) {
      const slots = buildSlots(input);
      return slots ? { status: 'ok', slots, fictional: true } : result('unsupported', { code: 'invalid-slot-policy', reason: 'invalid-slot-policy' });
    },
    async requestSlot(operation) {
      if (!valid(operation) || operation.payload.step !== 'request' || !instant(operation.payload.requestedAt)) return invalidOperation();
      return record(operation, 'synthetic-appointment-requested', { status: 'accepted', ...base(operation, { at: operation.payload.requestedAt }) });
    },
    // Before the keyed delay nothing is receipted; afterwards the pinned scenario decides schedule or proposal, once.
    async confirm(operation, now) {
      if (!valid(operation) || operation.payload.step !== 'confirm' || !instant(operation.payload.confirmAfter) || !instant(now)) return invalidOperation();
      if (Date.parse(now) < Date.parse(operation.payload.confirmAfter)) return { status: 'in-progress', ...scope(operation), fictional: true };
      const proposed = operation.payload.scenario?.proposeChange === true ? alternativeAfter(operation.payload.slot, operation.payload.slotPolicy) : null;
      if (operation.payload.scenario?.proposeChange === true && !proposed) return invalidOperation();
      return record(operation, proposed ? 'synthetic-appointment-proposed' : 'synthetic-appointment-scheduled', proposed
        ? { status: 'proposed', ...base(operation, { at: now, proposedSlot: proposed, proposalId: reference(operation), reason: operation.payload.scenario.proposalReason ?? null }) }
        : { status: 'scheduled', ...base(operation, { at: now }) });
    },
    async acceptProposal(operation) {
      if (!valid(operation) || operation.payload.step !== 'accept' || !instant(operation.payload.acceptedAt) || !validSlot(operation.payload.proposedSlot)) return invalidOperation();
      return record(operation, 'synthetic-appointment-accepted', { status: 'scheduled', ...base(operation, { at: operation.payload.acceptedAt, slot: operation.payload.proposedSlot }) });
    },
    // Terminal outcomes (FUCQ-167): each is receipted once per operation ID, on the instant the service passes in.
    async complete(operation) {
      if (!valid(operation) || operation.payload.step !== 'complete' || !instant(operation.payload.completedAt)) return invalidOperation();
      return record(operation, 'synthetic-appointment-completed', { status: 'completed', ...base(operation, { at: operation.payload.completedAt }) });
    },
    async recordNoShow(operation) {
      if (!valid(operation) || operation.payload.step !== 'noShow' || !instant(operation.payload.noShowAt)) return invalidOperation();
      return record(operation, 'synthetic-appointment-no-show', { status: 'no-show', ...base(operation, { at: operation.payload.noShowAt }) });
    },
    // The stored outcome for this operation, `not-found` when the provider never received it, or `conflict` if its input changed.
    async reconcile(operation) {
      if (!valid(operation)) return invalidOperation();
      const found = await repository.read(operation.payload.context, { table: 'event_receipts', key: {
        runId: operation.runId, consumerId: APPOINTMENT_CONSUMER, eventId: operation.operationId } });
      if (found.status === 'ok') return found.value.inputDigest === operation.inputDigest ? found.value.outcome : result('conflict', { reason: 'idempotency-input-changed' });
      return found.status === 'not-found' ? { status: 'not-found', ...scope(operation) } : found;
    },
  };
}

// Live-shaped boundary: no retailer calendar is reachable, so every call is refused and nothing is written.
export function createLiveAppointmentsStub() {
  const refuse = (operation) => ({ status: 'unsupported', ...(valid(operation) ? scope(operation) : {}), code: 'live-appointments-unsupported',
    reason: 'Live appointment booking is not connected in this demonstration. The appointment stays as it is.' });
  return { mode: 'live', contractVersion: '1.0.0', capability: APPOINTMENT_CAPABILITY,
    async offerSlots() { return refuse(); },
    async requestSlot(operation) { return refuse(operation); },
    async confirm(operation) { return refuse(operation); },
    async acceptProposal(operation) { return refuse(operation); },
    async complete(operation) { return refuse(operation); },
    async recordNoShow(operation) { return refuse(operation); },
    async reconcile(operation) { return refuse(operation); } };
}
