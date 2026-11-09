import { inputDigest, ok, result } from '../../repository/index.js';
import { validInstant } from '../../policy/file-provider.js';
import { OPERATION_TYPES } from '../../adapters/synthetic-appointments.js';
import { observeStage } from '../documents/index.js';
import { APPOINTMENT_KEYS, loadAppointmentPolicy } from './policy.js';

export const APPOINTMENT_CONTRACT = 'lifecycle.appointments.v1';
export const APPOINTMENT_HANDLER_ID = 'lifecycle-appointments';
export const APPOINTMENT_HANDLER_STAGE = 'pending-reconciliation';
// Versioned per-order projection in the existing receipts table (no schema change); writes ride pending_operations.
// The return purpose (FUCQ-118) reuses this machine under its own namespace; the handover names are unchanged.
const PURPOSES = Object.freeze({
  handover: { consumer: 'lifecycle-appointments:state:v1', purpose: 'handover', handlerId: APPOINTMENT_HANDLER_ID, opBase: 'appointment', commands: 'lifecycle-appointments',
    eventType: 'lifecycle-appointment-state' },
  return: { purpose: 'return', consumer: 'lifecycle-return-appointments:state:v1', handlerId: 'lifecycle-return-appointments', opBase: 'return-appointment',
    commands: 'lifecycle-return-appointments', eventType: 'lifecycle-return-appointment-state' },
});
const METHODS = { request: 'requestSlot', confirm: 'confirm', accept: 'acceptProposal', complete: 'complete', noShow: 'recordNoShow' };
const TERMINAL = { complete: { state: 'completed', at: 'completedAt' }, noShow: { state: 'no-show', at: 'noShowAt' } };
// The original no-show lifecycle exception FUCQ-112 consumes; one completed receipt per no-show operation.
const EXCEPTION_CONSUMER = 'lifecycle-appointments:exceptions:v1';
const NO_AUTHORITY = Object.freeze({ entitlementSlotId: null, renewalId: null, renewalAuthority: 'missing' });
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const slotShape = (s) => object(s) && text(s.slotId, 64) && validInstant(s.start) && validInstant(s.end);
const plusSeconds = (instant, seconds) => new Date(Date.parse(instant) + seconds * 1000).toISOString();
const opRef = (runId, operationId) => ({ table: 'pending_operations', key: { runId, operationId } });
const invalid = (field, reason) => result('invalid', { code: 'invalid-appointment-command', reasons: [{ field, reason }], action: 'review-and-retry' });
const unavailable = () => result('unavailable', { code: 'appointments-unavailable', retryable: true, reason: 'Appointments are unavailable. Try again shortly.' });
const ELIGIBILITY = { 'opening-stage-not-reached': 'Your order has not been sent to ordering yet.', 'opening-stage-not-in-lifecycle': 'Your order has not been sent to ordering yet.' };

// Whether a provider answer is the expected success for this step; anything else is unsupported or uncertain.
function expected(step, op, r) {
  if (!object(r) || r.operationId !== op.operationId || r.orderUuid !== op.payload.orderUuid || r.step !== step || !text(r.providerReference) || !validInstant(r.at)) return false;
  if (step === 'request') return r.status === 'accepted' && r.slot?.slotId === op.payload.slot.slotId;
  if (step === 'confirm') {
    return (r.status === 'scheduled' && r.slot?.slotId === op.payload.slot.slotId)
      || (r.status === 'proposed' && slotShape(r.proposedSlot) && r.proposedSlot.slotId !== op.payload.slot.slotId && text(r.proposalId));
  }
  if (TERMINAL[step]) return r.status === TERMINAL[step].state && r.slot?.slotId === op.payload.slot.slotId && r.at === op.payload[TERMINAL[step].at];
  return r.status === 'scheduled' && r.slot?.slotId === op.payload.proposedSlot.slotId;
}

export class LifecycleAppointmentService {
  #repository; #policy; #clock; #identity; #stages; #provider; #start; #cfg; #ownershipKey; #slotSource; #fields; #readiness; #outcomesKey;
  // Options default to the handover purpose. `slotSource` replaces provider.offerSlots; `requestFields` are extra caller-validated request keys.
  // `readiness` (FUCQ-116's readReadiness) gates completion; `outcomesKey` is unset for the return purpose, which has no terminal outcomes.
  constructor({ repository, policy, clock, identity, lifecycleStages, provider, purpose = 'handover', ownershipKey, slotSource, requestFields = [], readiness,
    outcomesKey = purpose === 'handover' ? APPOINTMENT_KEYS.outcomes : null } = {}) {
    if (!Object.hasOwn(PURPOSES, purpose)) throw new TypeError('Unknown appointment purpose.');
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
    this.#stages = lifecycleStages; this.#provider = provider; this.#cfg = PURPOSES[purpose];
    this.#ownershipKey = ownershipKey; this.#slotSource = slotSource; this.#fields = Object.freeze([...requestFields]);
    this.#readiness = readiness; this.#outcomesKey = outcomesKey;
  }

  #stateRef(runId, orderUuid) { return { table: 'event_receipts', key: { runId, consumerId: this.#cfg.consumer, eventId: orderUuid } }; }
  // Attempt 1 keeps the original IDs; a rebooking (attempt n > 1) adds `:a<n>` so each attempt writes under its own keys.
  #operationIds(runId, orderUuid, attempt = 1) {
    const base = `${this.#cfg.opBase}:${inputDigest([runId, orderUuid]).slice(0, 32)}${attempt > 1 ? `:a${attempt}` : ''}`;
    return { request: `${base}:request`, confirm: `${base}:confirm`, accept: `${base}:accept`, complete: `${base}:complete`, noShow: `${base}:no-show` };
  }
  // Repository writes made by the tick handler carry a system principal, never the presenter's identity.
  #system(context) { return { environmentId: context.environmentId, runId: context.runId, principalId: this.#cfg.handlerId, roles: [] }; }

  start() {
    this.#start ??= this.#clock?.registerHandler({ handlerId: this.#cfg.handlerId, stage: APPOINTMENT_HANDLER_STAGE,
      handle: (tick) => this.#safe(() => this.#tick(tick)) }) ?? Promise.resolve(unavailable());
    return this.#start;
  }

  async #safe(work) { try { return await work(); } catch { return unavailable(); } }

  async #role(context, allowed) {
    if (!this.#identity) return unavailable();
    for (const role of allowed) {
      const checked = await this.#identity.requireRole(context, role);
      if (checked.status === 'ok') return ok(role);
      if (checked.status !== 'forbidden') return checked;
    }
    return result('forbidden', { reason: 'Appointments are for the employee, the scheme team or the presenter.' });
  }

  async #prepare(context) {
    if (!this.#repository || !this.#clock || !this.#policy || !this.#identity) return { error: unavailable() };
    const time = await this.#clock.now(context); if (time.status !== 'ok') return { error: time };
    const run = await this.#repository.read(context, { table: 'runs', key: { runId: context.runId } }); if (run.status !== 'ok') return { error: run };
    return { now: time.value.now, policyVersion: run.value.policyVersion };
  }

  #config(context, now, policyVersion) { return loadAppointmentPolicy(this.#policy, { runId: context.runId, asOf: now, policyVersion }, this.#ownershipKey, this.#outcomesKey); }

  // Classifies one FUCQ-111 stage read; a missing order is not found, anything not yet sent to ordering is not eligible.
  async #observe(context, orderUuid, config) {
    if (!this.#stages || typeof this.#stages.read !== 'function') return { error: unavailable() };
    let raw; try { raw = await this.#stages.read(context, { orderUuid }); } catch { return { error: unavailable() }; }
    if (raw?.status === 'not-found') return { error: result('not-found', { resourceType: 'order', reason: 'No order was found.' }) };
    if (raw?.status === 'forbidden') return { error: result('forbidden', { reason: 'This order is not visible to you.' }) };
    return { observed: observeStage(raw, { context, orderUuid, openingStage: config.openingStage, openingState: config.openingState }) };
  }

  async #offer(context, config, now, orderUuid, input = {}) {
    const refused = (code, reason) => ({ blocked: { step: 'offer', code, reason } });
    try {
      if (this.#slotSource) {
        const picked = await this.#slotSource(context, { orderUuid, now, slotPolicy: config.slotPolicy, policyVersion: config.policyVersion, input });
        if (Array.isArray(picked?.slots) && picked.slots.every(slotShape)) return { slots: picked.slots };
        if (text(picked?.blocked?.code, 128)) return refused(picked.blocked.code, picked.blocked.reason ?? 'Slots are not available in this mode.');
        return refused('offer-unavailable', 'Slots are unavailable. Try again shortly.');
      }
      const offer = await this.#provider?.offerSlots({ now, ...config.slotPolicy });
      if (offer?.status === 'ok' && Array.isArray(offer.slots) && offer.slots.every(slotShape)) return { slots: offer.slots };
      if (offer?.status === 'unsupported') return refused(offer.code ?? 'unsupported', offer.reason ?? 'Slots are not available in this mode.');
    } catch { /* fall through to the generic refusal */ }
    return refused('offer-unavailable', 'Slots are unavailable. Try again shortly.');
  }

  #present(p, config, { eligibility, offeredSlots = [], blocked = null } = {}) {
    const pending = p.pending ? { step: p.pending.step, reason: 'Waiting for the provider to confirm the last update.' } : null;
    const stuck = p.blocked ?? blocked;
    const unmet = p.state === 'not-requested' && !eligibility.eligible;
    const step = pending ? config.ownership.pending : stuck ? config.ownership.blocked : unmet ? config.ownership.ineligible
      : config.ownership.states[p.state] ?? config.outcomes?.states[p.state];
    return { contractVersion: APPOINTMENT_CONTRACT, ...(this.#cfg.purpose === 'return' ? { purpose: 'return' } : {}), runId: p.runId, orderUuid: p.orderUuid, employeeId: p.employeeId, state: p.state,
      booked: p.state === 'scheduled', slot: p.slot, requestedSlot: p.requestedSlot, proposedSlot: p.proposedSlot, proposalId: p.proposalId,
      history: p.history, owner: step.owner, nextStep: step.nextStep, pending, blocked: stuck ? { code: stuck.code, reason: stuck.reason } : null,
      offeredSlots, eligibility, policyVersion: p.policyVersion, assumptions: config.assumptions,
      ...(this.#fields.length ? { plan: p.plan ?? null } : {}), ...(this.#outcomesKey ? { outcome: p.outcome ?? null, attempt: p.attempt ?? 1, previousAttempts: p.previousAttempts ?? [] } : {}),
      provider: { mode: this.#provider?.mode ?? null, synthetic: this.#provider?.mode === 'synthetic' }, fictional: true };
  }

  async #readModel(context, scope, orderUuid, prepared) {
    const found = await this.#repository.read(context, this.#stateRef(context.runId, orderUuid));
    if (found.status === 'ok') {
      const p = found.value.outcome.value;
      if (scope === 'employee' && p.employeeId !== context.employeeId) return result('forbidden', { reason: 'This appointment belongs to another employee.' });
      const config = await this.#config(context, prepared.now, p.policyVersion); if (config.status !== 'ok') return config;
      // After a no-show Paula chooses again: offer fresh slots while the order is still sent to ordering.
      if (p.state === 'no-show' && this.#outcomesKey) {
        const seen = await this.#observe(context, orderUuid, config.value);
        if (!seen.error && seen.observed.status === 'open') {
          const offer = await this.#offer(context, config.value, prepared.now, orderUuid);
          return ok(this.#present(p, config.value, { eligibility: { eligible: true, code: null, reason: null }, offeredSlots: offer.slots ?? [], blocked: offer.blocked ?? null }));
        }
      }
      return ok(this.#present(p, config.value, { eligibility: { eligible: true, code: null, reason: null } }));
    }
    if (found.status !== 'not-found') return found;
    const config = await this.#config(context, prepared.now, prepared.policyVersion); if (config.status !== 'ok') return config;
    const seen = await this.#observe(context, orderUuid, config.value); if (seen.error) return seen.error;
    const { observed } = seen;
    if (observed.status === 'forbidden' || (scope === 'employee' && observed.employeeId && observed.employeeId !== context.employeeId)) {
      return result('forbidden', { reason: 'This order belongs to another employee.' });
    }
    const eligible = observed.status === 'open';
    const eligibility = eligible ? { eligible: true, code: null, reason: null }
      : { eligible: false, code: observed.reason ?? 'not-open', reason: ELIGIBILITY[observed.reason] ?? 'Appointments are not available for this order yet.' };
    const offer = eligible ? await this.#offer(context, config.value, prepared.now, orderUuid) : {};
    const blank = { runId: context.runId, orderUuid, employeeId: observed.employeeId ?? context.employeeId ?? null, state: 'not-requested', slot: null,
      requestedSlot: null, proposedSlot: null, proposalId: null, history: [], pending: null, blocked: null, policyVersion: config.value.policyVersion };
    return ok(this.#present(blank, config.value, { eligibility, offeredSlots: offer.slots ?? [], blocked: offer.blocked ?? null }));
  }

  read(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['employee', 'greg', 'presenter']); if (role.status !== 'ok') return role;
    if (!object(input) || !text(input.orderUuid, 128) || Object.keys(input).some((key) => key !== 'orderUuid')) return invalid('orderUuid', 'Choose an order to view.');
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    return this.#readModel(context, role.value, input.orderUuid, prepared);
  }); }

  request(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['employee']); if (role.status !== 'ok') return role;
    const allowed = ['orderUuid', 'slotId', ...this.#fields];
    if (!object(input) || !text(input.orderUuid, 128) || !text(input.slotId, 64) || Object.keys(input).some((key) => !allowed.includes(key))) {
      return invalid('request', 'Supply the order and the slot you chose.');
    }
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const { orderUuid, slotId } = input;
    const extra = Object.fromEntries(this.#fields.map((key) => [key, input[key] ?? null]));
    const existing = await this.#repository.read(context, this.#stateRef(context.runId, orderUuid));
    if (existing.status === 'ok') {
      const p = existing.value.outcome.value;
      if (p.employeeId !== context.employeeId) return result('forbidden', { reason: 'This appointment belongs to another employee.' });
      if (p.state === 'no-show' && this.#outcomesKey) return this.#rebook(context, p, prepared, slotId);
      // Repeating the same request returns the same appointment; a different slot while one is requested is a conflict.
      if (p.requestedSlot?.slotId !== slotId || this.#fields.some((key) => (p.plan?.[key] ?? null) !== extra[key])) return result('conflict', { code: 'appointment-already-requested', reason: 'A slot is already requested for this order.' });
      return this.#readModel(context, 'employee', orderUuid, prepared);
    }
    if (existing.status !== 'not-found') return existing;
    const config = await this.#config(context, prepared.now, prepared.policyVersion); if (config.status !== 'ok') return config;
    const seen = await this.#observe(context, orderUuid, config.value); if (seen.error) return seen.error;
    const { observed } = seen;
    if (observed.status === 'forbidden' || (observed.employeeId && observed.employeeId !== context.employeeId)) return result('forbidden', { reason: 'This order belongs to another employee.' });
    if (observed.status !== 'open') {
      const reason = ELIGIBILITY[observed.reason] ?? 'Appointments are not available for this order yet.';
      return result('conflict', { code: 'appointment-not-eligible', reason, reasons: [{ field: 'orderUuid', reason }] });
    }
    const offer = await this.#offer(context, config.value, prepared.now, orderUuid, extra);
    if (offer.blocked) return result('unsupported', { code: offer.blocked.code, reason: offer.blocked.reason });
    const slot = offer.slots.find((s) => s.slotId === slotId);
    if (!slot) return invalid('slotId', 'Choose one of the offered slots.');
    const opened = await this.#open(context, config.value, prepared, observed, orderUuid, slot, extra);
    if (opened.status !== 'ok') return opened;
    const operation = opened.value;
    const settled = operation.state === 'pending' && operation.lastKnownState === 'requesting'
      ? await this.#write(context, config.value, operation, prepared.now, 'inline') : ok('settled');
    if (settled.status !== 'ok') return settled;
    return this.#after(context, orderUuid, prepared, settled.value);
  }); }

  // Rebooking after a no-show: one transaction starts the next attempt and its request; history stays append-only.
  async #rebook(context, p, prepared, slotId) {
    const { orderUuid } = p;
    const config = await this.#config(context, prepared.now, p.policyVersion); if (config.status !== 'ok') return config;
    const seen = await this.#observe(context, orderUuid, config.value); if (seen.error) return seen.error;
    const { observed } = seen;
    if (observed.status === 'forbidden' || (observed.employeeId && observed.employeeId !== context.employeeId)) return result('forbidden', { reason: 'This order belongs to another employee.' });
    if (observed.status !== 'open') {
      const reason = ELIGIBILITY[observed.reason] ?? 'Appointments are not available for this order yet.';
      return result('conflict', { code: 'appointment-not-eligible', reason, reasons: [{ field: 'orderUuid', reason }] });
    }
    const offer = await this.#offer(context, config.value, prepared.now, orderUuid);
    if (offer.blocked) return result('unsupported', { code: offer.blocked.code, reason: offer.blocked.reason });
    const slot = offer.slots.find((s) => s.slotId === slotId);
    if (!slot) return invalid('slotId', 'Choose one of the offered slots.');
    const attempt = (p.attempt ?? 1) + 1;
    const operationId = this.#operationIds(context.runId, orderUuid, attempt).request;
    const operation = this.#operation(context, operationId, 'request', orderUuid, slot, { requestedAt: prepared.now });
    const opened = await this.#repository.transaction(context, { commandId: `${this.#cfg.commands}:rebook:${orderUuid}:${attempt}`,
      inputDigest: inputDigest([orderUuid, slot.slotId, attempt]) }, async (tx) => {
      const found = await tx.get(this.#stateRef(context.runId, orderUuid)); if (found.status !== 'ok') return found;
      const cur = found.value.outcome.value;
      if (cur.state !== 'no-show' || (cur.attempt ?? 1) !== attempt - 1) return result('conflict', { code: 'appointment-already-requested', reason: 'A slot is already requested for this order.' });
      const inserted = await tx.insert('pending_operations', operation); if (inserted.status !== 'ok') return inserted;
      const next = { ...cur, attempt, previousAttempts: [...(cur.previousAttempts ?? []), { attempt: attempt - 1, state: 'no-show', slot: cur.slot, outcome: cur.outcome }],
        state: 'not-requested', requestedSlot: slot, slot: null, proposedSlot: null, proposalId: null, acceptedProposalId: null, outcome: null, blocked: null,
        operations: { request: operationId, confirm: null, accept: null, complete: null, noShow: null },
        pending: { step: 'request', operationId, lastKnownState: 'requesting' } };
      const changed = await tx.compareAndSwap(this.#stateRef(context.runId, orderUuid), found.value.version, { outcome: ok(next) });
      return changed.status === 'ok' ? ok(inserted.value) : changed;
    });
    if (opened.status !== 'ok') return opened;
    const settled = opened.value.state === 'pending' && opened.value.lastKnownState === 'requesting'
      ? await this.#write(context, config.value, opened.value, prepared.now, 'inline') : ok('settled');
    if (settled.status !== 'ok') return settled;
    return this.#after(context, orderUuid, prepared, settled.value);
  }

  acceptChange(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['employee']); if (role.status !== 'ok') return role;
    const keys = ['orderUuid', 'proposalId', 'providerReference'];
    const given = input?.proposalId ?? input?.providerReference;
    if (!object(input) || !text(input.orderUuid, 128) || !text(given, 128) || Object.keys(input).some((key) => !keys.includes(key))
      || (input.proposalId !== undefined && input.providerReference !== undefined && input.proposalId !== input.providerReference)) {
      return invalid('proposalId', 'Supply the order and the proposed change to accept.');
    }
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const { orderUuid } = input;
    const found = await this.#repository.read(context, this.#stateRef(context.runId, orderUuid));
    if (found.status === 'not-found') return result('not-found', { resourceType: 'appointment', reason: 'No appointment was requested for this order.' });
    if (found.status !== 'ok') return found;
    const p = found.value.outcome.value;
    if (p.employeeId !== context.employeeId) return result('forbidden', { reason: 'This appointment belongs to another employee.' });
    if (p.state === 'scheduled' && p.acceptedProposalId === given) return this.#readModel(context, 'employee', orderUuid, prepared);
    if (p.state !== 'change-proposed') return result('conflict', { code: 'no-change-proposed', reason: 'There is no proposed change to accept.' });
    if (given !== p.proposalId) return invalid('proposalId', 'This is not the proposed change.');
    const config = await this.#config(context, prepared.now, p.policyVersion); if (config.status !== 'ok') return config;
    const prior = p.operations.accept ? await this.#repository.read(context, opRef(context.runId, p.operations.accept)) : null;
    if (prior && prior.status !== 'ok') return prior;
    let label = 'repeat';
    if (!prior) {
      const opened = await this.#ensure(context, orderUuid, 'accept', (ids) => this.#operation(context, ids.accept, 'accept', orderUuid, p.requestedSlot,
        { acceptedAt: prepared.now, proposedSlot: p.proposedSlot, proposalId: p.proposalId }), p.attempt ?? 1);
      if (opened.status !== 'ok') return opened;
      const settled = await this.#write(context, config.value, opened.value, prepared.now, 'inline'); if (settled.status !== 'ok') return settled;
      label = settled.value;
    } else if (prior.value.lastKnownState === 'unsupported') label = 'blocked';
    return this.#after(context, orderUuid, prepared, label);
  }); }

  // Completion is the one terminal write the gate allows: FUCQ-116 must report documents and the car ready before any operation exists.
  complete(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['presenter', 'greg']); if (role.status !== 'ok') return role;
    if (!this.#outcomesKey) return result('unsupported', { code: 'appointment-outcome-unsupported', reason: 'This appointment cannot be completed here.' });
    if (!object(input) || !text(input.orderUuid, 128) || Object.keys(input).some((key) => key !== 'orderUuid')) return invalid('orderUuid', 'Choose an order to complete.');
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const { orderUuid } = input;
    const found = await this.#repository.read(context, this.#stateRef(context.runId, orderUuid));
    if (found.status === 'not-found') return result('not-found', { resourceType: 'appointment', reason: 'No appointment was requested for this order.' });
    if (found.status !== 'ok') return found;
    const p = found.value.outcome.value;
    if (p.state === 'completed') return this.#readModel(context, role.value, orderUuid, prepared);
    if (p.state !== 'scheduled') return result('conflict', { code: 'appointment-not-scheduled', reason: 'Only a scheduled handover can be completed.' });
    if (p.pending && p.pending.step !== 'complete') return result('conflict', { code: 'appointment-update-pending', reason: 'Another update to this appointment is still being confirmed.' });
    const config = await this.#config(context, prepared.now, p.policyVersion); if (config.status !== 'ok') return config;
    const prior = p.operations?.complete ? await this.#repository.read(context, opRef(context.runId, p.operations.complete)) : null;
    if (prior && prior.status !== 'ok') return prior;
    let label = 'repeat';
    if (prior?.value.state === 'pending' && prior.value.lastKnownState === 'unsupported') label = 'blocked';
    else if (prior?.value.state === 'pending') {
      const settled = await this.#recover(context, config.value, prior.value, prepared.now, `repeat-${prior.value.attempts}`, true);
      if (settled.status !== 'ok') return settled;
      label = settled.value;
    } else if (!prior) {
      let ready; try { ready = await this.#readiness?.readReadiness(context, { orderUuid }); } catch { ready = null; }
      if (ready?.status !== 'ok' || !object(ready.value)) return result('unavailable', { code: 'handover-readiness-unavailable', retryable: true,
        reason: 'Documents and car preparation cannot be checked right now. Try again shortly.' });
      if (ready.value.ready !== true) {
        const { state, documentsComplete, vehicleReady, blocking } = ready.value; const wait = config.value.outcomes.notReady;
        const model = await this.#readModel(context, role.value, orderUuid, prepared); if (model.status !== 'ok') return model;
        return result('conflict', { code: 'handover-not-ready', reason: wait.nextStep, owner: wait.owner, nextStep: wait.nextStep,
          readiness: { state, documentsComplete, vehicleReady, blocking: blocking ?? [] }, appointment: model.value });
      }
      const opened = await this.#ensure(context, orderUuid, 'complete', (ids) => this.#operation(context, ids.complete, 'complete', orderUuid, p.slot,
        { completedAt: prepared.now, readiness: { documentsRevision: ready.value.documentsRevision ?? null } }), p.attempt ?? 1);
      if (opened.status !== 'ok') return opened;
      const settled = opened.value.state === 'pending' ? await this.#write(context, config.value, opened.value, prepared.now, 'inline') : ok('settled');
      if (settled.status !== 'ok') return settled;
      label = settled.value;
    }
    return this.#after(context, orderUuid, prepared, label, role.value);
  }); }

  // A no-show is the failure case of a scheduled handover: the exception receipt is written with the outcome, and the order stays allocated.
  recordNoShow(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['presenter', 'greg']); if (role.status !== 'ok') return role;
    if (!this.#outcomesKey) return result('unsupported', { code: 'appointment-outcome-unsupported', reason: 'A no-show cannot be recorded here.' });
    if (!object(input) || !text(input.orderUuid, 128) || Object.keys(input).some((key) => key !== 'orderUuid')) return invalid('orderUuid', 'Choose an order to record.');
    const prepared = await this.#prepare(context); if (prepared.error) return prepared.error;
    const { orderUuid } = input;
    const found = await this.#repository.read(context, this.#stateRef(context.runId, orderUuid));
    if (found.status === 'not-found') return result('not-found', { resourceType: 'appointment', reason: 'No appointment was requested for this order.' });
    if (found.status !== 'ok') return found;
    const p = found.value.outcome.value;
    if (p.state === 'no-show') return this.#readModel(context, role.value, orderUuid, prepared);
    if (p.state !== 'scheduled') return result('conflict', { code: 'appointment-not-scheduled', reason: 'Only a scheduled handover can be recorded as a no-show.' });
    if (p.pending && p.pending.step !== 'noShow') return result('conflict', { code: 'appointment-update-pending', reason: 'Another update to this appointment is still being confirmed.' });
    const config = await this.#config(context, prepared.now, p.policyVersion); if (config.status !== 'ok') return config;
    const prior = p.operations?.noShow ? await this.#repository.read(context, opRef(context.runId, p.operations.noShow)) : null;
    if (prior && prior.status !== 'ok') return prior;
    let label = 'repeat';
    if (prior?.value.state === 'pending' && prior.value.lastKnownState === 'unsupported') label = 'blocked';
    else if (prior?.value.state === 'pending') {
      const settled = await this.#recover(context, config.value, prior.value, prepared.now, `repeat-${prior.value.attempts}`, true);
      if (settled.status !== 'ok') return settled;
      label = settled.value;
    } else if (!prior) {
      // The renewal authority is the order's own (FUCQ-111); a missing one stays missing, never the employee's default renewal.
      const seen = await this.#observe(context, orderUuid, config.value); if (seen.error) return seen.error;
      const order = seen.observed.status === 'open' ? seen.observed.order : NO_AUTHORITY;
      const opened = await this.#ensure(context, orderUuid, 'noShow', (ids) => this.#operation(context, ids.noShow, 'noShow', orderUuid, p.slot,
        { noShowAt: prepared.now, order, exceptionType: config.value.outcomes.exceptionTypes.noShow }), p.attempt ?? 1);
      if (opened.status !== 'ok') return opened;
      const settled = opened.value.state === 'pending' ? await this.#write(context, config.value, opened.value, prepared.now, 'inline') : ok('settled');
      if (settled.status !== 'ok') return settled;
      label = settled.value;
    }
    return this.#after(context, orderUuid, prepared, label, role.value);
  }); }

  // A refused write reports unsupported with the reason; an uncertain one shows as pending in the read model.
  async #after(context, orderUuid, prepared, label, scope = 'employee') {
    const model = await this.#readModel(context, scope, orderUuid, prepared); if (model.status !== 'ok') return model;
    return label === 'blocked' ? result('unsupported', { code: model.value.blocked.code, reason: model.value.blocked.reason, appointment: model.value }) : model;
  }

  #operation(context, operationId, step, orderUuid, slot, extra) {
    const payload = { context: this.#system(context), orderUuid, step, slot, ...extra };
    const { context: _context, ...stable } = payload;
    return { runId: context.runId, operationId, operationType: OPERATION_TYPES[step], idempotencyKey: operationId,
      inputDigest: inputDigest(stable), payload, state: 'pending', lastKnownState: step === 'confirm' ? 'waiting' : 'requesting', attempts: 0 };
  }

  // One transaction creates the projection and its request operation, so a crash leaves a recoverable pending write.
  async #open(context, config, prepared, observed, orderUuid, slot, extra) {
    const operationId = this.#operationIds(context.runId, orderUuid).request;
    const operation = this.#operation(context, operationId, 'request', orderUuid, slot, { requestedAt: prepared.now });
    const projection = { schemaVersion: 1, runId: context.runId, orderUuid, employeeId: observed.employeeId, policyVersion: config.policyVersion,
      opening: observed.observation, providerMode: this.#provider?.mode ?? 'unavailable', state: 'not-requested', requestedSlot: slot, slot: null,
      proposedSlot: null, proposalId: null, acceptedProposalId: null, history: [], outcome: null, ...(this.#fields.length ? { plan: extra } : {}),
      pending: { step: 'request', operationId, lastKnownState: 'requesting' }, blocked: null, operations: { request: operationId, confirm: null, accept: null, complete: null, noShow: null },
      confirmation: { delaySeconds: config.confirmDelaySeconds, scenario: config.scenario, slotPolicy: config.slotPolicy } };
    return this.#repository.transaction(context, { commandId: `${this.#cfg.commands}:open:${orderUuid}`,
      inputDigest: inputDigest([orderUuid, slot.slotId, config.policyVersion]) }, async (tx) => {
      const prior = await tx.get(opRef(context.runId, operationId));
      if (prior.status === 'ok') return ok(prior.value);
      if (prior.status !== 'not-found') return prior;
      const inserted = await tx.insert('pending_operations', operation); if (inserted.status !== 'ok') return inserted;
      const stored = await tx.insert('event_receipts', { runId: context.runId, consumerId: this.#cfg.consumer, eventId: orderUuid,
        inputDigest: inputDigest({ orderUuid, slotId: slot.slotId }), eventType: this.#cfg.eventType, handlerId: this.#cfg.handlerId,
        inputVersions: { policy: config.policyVersion }, state: 'projection', outcome: ok(projection) });
      return stored.status === 'ok' ? ok(inserted.value) : stored;
    });
  }

  // Creates a later-step operation once and links it from the projection; an existing one is returned unchanged.
  async #ensure(context, orderUuid, step, build, attempt = 1) {
    const ids = this.#operationIds(context.runId, orderUuid, attempt);
    const keyed = attempt > 1 ? { commandId: `${this.#cfg.commands}:${step}-open:${orderUuid}:a${attempt}`, inputDigest: inputDigest([orderUuid, step, attempt]) }
      : { commandId: `${this.#cfg.commands}:${step}-open:${orderUuid}`, inputDigest: inputDigest([orderUuid, step]) };
    return this.#repository.transaction(context, keyed, async (tx) => {
      const prior = await tx.get(opRef(context.runId, ids[step]));
      if (prior.status === 'ok') return ok(prior.value);
      if (prior.status !== 'not-found') return prior;
      const found = await tx.get(this.#stateRef(context.runId, orderUuid)); if (found.status !== 'ok') return found;
      const p = found.value.outcome.value;
      if ((p.attempt ?? 1) !== attempt) return result('conflict', { code: 'appointment-rebooked', reason: 'This appointment was rebooked. Refresh and try again.' });
      const inserted = await tx.insert('pending_operations', build(ids)); if (inserted.status !== 'ok') return inserted;
      const next = { ...p, operations: { ...p.operations, [step]: ids[step] },
        ...(['accept', 'complete', 'noShow'].includes(step) ? { pending: { step, operationId: ids[step], lastKnownState: 'requesting' }, blocked: null } : {}) };
      const changed = await tx.compareAndSwap(this.#stateRef(context.runId, orderUuid), found.value.version, { outcome: ok(next) });
      return changed.status === 'ok' ? ok(inserted.value) : changed;
    });
  }

  // Provider calls run outside transactions with the stored operation; a throw or timeout is an unknown outcome.
  async #call(config, method, ...args) {
    let timer;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ status: 'unknown' }), config.providerTimeoutMs); });
      return await Promise.race([Promise.resolve().then(() => this.#provider[method](...args.map((a) => structuredClone(a)))), timeout]);
    } catch { return { status: 'unknown' }; } finally { clearTimeout(timer); }
  }

  async #write(context, config, operation, now, tag) {
    const step = operation.payload.step;
    const response = await this.#call(config, METHODS[step], operation, now);
    return this.#settle(context, operation, response, tag);
  }

  // Uncertain writes are reconciled under the same operation ID; only `not-found` allows the same write again.
  async #recover(context, config, operation, now, tag, retry) {
    let response = await this.#call(config, 'reconcile', operation);
    if (response?.status === 'not-found' && response.operationId === operation.operationId) {
      if (!retry) return ok('waiting');
      response = await this.#call(config, METHODS[operation.payload.step], operation, now);
    }
    return this.#settle(context, operation, response, tag);
  }

  async #settle(context, operation, response, tag) {
    const { step, orderUuid } = operation.payload;
    const good = expected(step, operation, response);
    const waiting = step === 'confirm' && response?.status === 'in-progress' && response.operationId === operation.operationId;
    const refused = response?.status === 'unsupported';
    const label = good ? 'applied' : waiting ? 'waiting' : refused ? 'blocked' : 'uncertain';
    const settled = await this.#repository.transaction(context, { commandId: `${this.#cfg.commands}:settle:${operation.operationId}:${good ? 'done' : tag}`,
      inputDigest: inputDigest(good ? response : { label, code: response?.code ?? null }) }, async (tx) => {
      const fresh = await tx.get(opRef(context.runId, operation.operationId)); if (fresh.status !== 'ok') return fresh;
      if (fresh.value.state !== 'pending') return ok('settled');
      const found = await tx.get(this.#stateRef(context.runId, orderUuid)); if (found.status !== 'ok') return found;
      const p = found.value.outcome.value;
      const from = { request: 'not-requested', confirm: 'requested', accept: 'change-proposed', complete: 'scheduled', noShow: 'scheduled' }[step];
      if (p.state !== from) return ok('settled');
      const mine = p.pending?.operationId === operation.operationId;
      let next = { ...p, pending: mine ? null : p.pending };
      let patch;
      const entry = (state) => ({ state, at: response.at, providerReference: response.providerReference });
      if (good) {
        if (step === 'request') next = { ...next, state: 'requested', blocked: null, history: [...p.history, entry('requested')] };
        else if (TERMINAL[step]) next = { ...next, state: TERMINAL[step].state, outcome: entry(TERMINAL[step].state), blocked: null, history: [...p.history, entry(TERMINAL[step].state)] };
        else if (step === 'accept') next = { ...next, state: 'scheduled', slot: p.proposedSlot, acceptedProposalId: p.proposalId, blocked: null, history: [...p.history, entry('scheduled')] };
        else if (response.status === 'scheduled') next = { ...next, state: 'scheduled', slot: response.slot, blocked: null, history: [...p.history, entry('scheduled')] };
        else next = { ...next, state: 'change-proposed', proposedSlot: response.proposedSlot, proposalId: response.proposalId, blocked: null, history: [...p.history, entry('change-proposed')] };
        patch = { state: 'completed', lastKnownState: response.status, providerReference: response.providerReference, outcome: response };
      } else if (waiting) {
        patch = fresh.value.lastKnownState === 'waiting' ? null : { lastKnownState: 'waiting' };
      } else if (refused) {
        next = { ...next, blocked: { step, code: response.code ?? 'unsupported', reason: response.reason ?? 'This update is not supported.' } };
        patch = { lastKnownState: 'unsupported', attempts: fresh.value.attempts + 1, outcome: { status: 'unsupported', code: response.code ?? 'unsupported', reason: response.reason ?? null } };
      } else {
        next = { ...next, blocked: null, pending: { step, operationId: operation.operationId, lastKnownState: 'unknown' } };
        patch = { lastKnownState: 'unknown', attempts: fresh.value.attempts + 1, outcome: { status: 'unknown' } };
      }
      if (patch) { const changed = await tx.compareAndSwap(opRef(context.runId, operation.operationId), fresh.value.version, patch); if (changed.status !== 'ok') return changed; }
      if (JSON.stringify(next) !== JSON.stringify(p)) {
        const stored = await tx.compareAndSwap(this.#stateRef(context.runId, orderUuid), found.value.version, { outcome: ok(next) }); if (stored.status !== 'ok') return stored;
      }
      if (good && step === 'noShow') {
        const { order, exceptionType } = operation.payload;
        const value = { employeeId: p.employeeId, renewalId: order.renewalId, orderUuid, occurredAt: response.at, entitlementSlotId: order.entitlementSlotId,
          renewalAuthority: order.renewalAuthority, exceptionType, policyVersion: p.policyVersion, providerReference: response.providerReference, attempt: p.attempt ?? 1, fictional: true };
        const recorded = await tx.recordReceipt({ consumerId: EXCEPTION_CONSUMER, eventId: operation.operationId, eventType: exceptionType, handlerId: this.#cfg.handlerId,
          inputDigest: inputDigest({ eventId: operation.operationId, occurredAt: response.at }), inputVersions: { policy: p.policyVersion }, state: 'completed', outcome: ok(value) });
        if (recorded.status !== 'ok') return recorded;
      }
      return ok(label);
    });
    return settled;
  }

  async #tick({ context, tickId, now }) {
    if (!this.#repository || !this.#policy || typeof this.#provider?.reconcile !== 'function') return unavailable();
    const system = this.#system(context);
    const run = await this.#repository.read(system, { table: 'tick_runs', key: { runId: system.runId, tickId } }); if (run.status !== 'ok') return run;
    // Startup reconciles uncertain writes only; confirmation progresses on presenter ticks alone (HLD review Q3).
    const startup = run.value.targetClock?.kind === 'startup';
    const rows = await this.#repository.query(system, 'event_receipts', { consumerId: this.#cfg.consumer }); if (rows.status !== 'ok') return rows;
    const summary = { handlerId: this.#cfg.handlerId, orders: rows.value.length, applied: 0, waiting: 0, blocked: 0, uncertain: 0, idle: 0, failed: [] };
    // One order's failure is recorded and skipped so others still progress; stable operation IDs make the retry safe.
    for (const row of [...rows.value].sort((a, b) => (a.eventId < b.eventId ? -1 : 1))) {
      let step; try { step = await this.#progress(system, tickId, now, startup, row.outcome.value); } catch { step = unavailable(); }
      if (step.status !== 'ok') { summary.failed.push({ orderUuid: row.eventId, status: step.status, code: step.code ?? null }); continue; }
      const key = ['applied', 'waiting', 'blocked', 'uncertain'].includes(step.value) ? step.value : 'idle';
      summary[key] += 1;
    }
    summary.failed = summary.failed.slice(0, 20);
    return ok(summary);
  }

  async #progress(system, tickId, now, startup, p) {
    const config = await this.#config(system, now, p.policyVersion); if (config.status !== 'ok') return config;
    if (p.pending) {
      const found = await this.#repository.read(system, opRef(system.runId, p.pending.operationId)); if (found.status !== 'ok') return found;
      if (found.value.state !== 'pending') return ok('idle');
      return this.#recover(system, config.value, found.value, now, tickId, !startup);
    }
    if (p.state !== 'requested' || startup) return ok('idle');
    const requestedAt = [...p.history].reverse().find((h) => h.state === 'requested')?.at; if (!validInstant(requestedAt)) return unavailable();
    const opened = await this.#ensure(system, p.orderUuid, 'confirm', (ids) => this.#operation(system, ids.confirm, 'confirm', p.orderUuid, p.requestedSlot,
      { confirmAfter: plusSeconds(requestedAt, p.confirmation.delaySeconds), scenario: p.confirmation.scenario, slotPolicy: p.confirmation.slotPolicy }), p.attempt ?? 1);
    if (opened.status !== 'ok') return opened;
    if (opened.value.state !== 'pending') return ok('idle');
    return this.#write(system, config.value, opened.value, now, tickId);
  }
}

export const createLifecycleAppointmentService = (options) => new LifecycleAppointmentService(options);
