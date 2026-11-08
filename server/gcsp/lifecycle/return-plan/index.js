import { ok, result } from '../../repository/index.js';
import { LifecycleAppointmentService } from '../appointments/index.js';
import { findSelectionOrder } from '../approvals/source.js';
import { loadReturnPolicy, RETURN_KEYS } from './policy.js';

export const RETURN_PLAN_CONTRACT = 'lifecycle.return-plan.v1';
// Plan states over the return appointment's own states; a proposed change is still a request, never a schedule.
const PLAN_STATE = { 'not-requested': 'not-planned', requested: 'return-requested', 'change-proposed': 'return-requested', scheduled: 'return-scheduled' };
const DAY = 86400000;
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const invalid = (field, reason) => result('invalid', { code: 'invalid-return-command', reasons: [{ field, reason }], action: 'review-and-retry' });
const unavailable = () => result('unavailable', { code: 'return-plan-unavailable', retryable: true, reason: 'The return plan is unavailable. Try again shortly.' });
const badSource = () => result('unavailable', { code: 'return-plan-source-invalid', retryable: false, reason: 'The record of your current car could not be read.' });

export class LifecycleReturnPlanService {
  #repository; #policy; #clock; #identity; #provider; #handover; #returns;
  constructor({ repository, policy, clock, identity, lifecycleStages, provider, handover } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity; this.#provider = provider; this.#handover = handover;
    this.#returns = new LifecycleAppointmentService({ repository, policy, clock, identity, lifecycleStages, provider, purpose: 'return',
      ownershipKey: RETURN_KEYS.ownership, requestFields: ['choice'], slotSource: (context, args) => this.#slotSource(context, args) });
  }

  start() { return this.#returns.start(); }

  async #safe(work) { try { return await work(); } catch { return unavailable(); } }

  async #role(context, allowed) {
    if (!this.#identity) return unavailable();
    for (const role of allowed) {
      const checked = await this.#identity.requireRole(context, role);
      if (checked.status === 'ok') return ok(role);
      if (checked.status !== 'forbidden') return checked;
    }
    return result('forbidden', { reason: 'The return plan is for the employee, the scheme team or the presenter.' });
  }

  async #now(context) {
    if (!this.#repository || !this.#clock || !this.#policy || !this.#handover) return { error: unavailable() };
    const time = await this.#clock.now(context); if (time.status !== 'ok') return { error: time };
    const run = await this.#repository.read(context, { table: 'runs', key: { runId: context.runId } }); if (run.status !== 'ok') return { error: run };
    return { now: time.value.now, policyVersion: run.value.policyVersion };
  }

  // The selection FUCQ-71 recorded, read-only: a new order has no current car; a replacement must carry the whole old-car record.
  async #source(context, scope, orderUuid) {
    const found = await findSelectionOrder((table, filter) => this.#repository.query(context, table, filter), orderUuid, scope === 'employee' ? context.employeeId : undefined);
    if (found.status !== 'ok') return found;
    const row = await this.#repository.read(context, { table: 'pending_operations', key: { runId: context.runId, operationId: found.value.source.operationId } });
    if (row.status !== 'ok') return row.status === 'not-found' ? badSource() : row;
    const s = row.value.payload?.selection; const choices = s?.draft?.choices;
    const base = { employeeId: found.value.employeeId, receivedAt: found.value.source.receivedAt };
    if (choices?.mode === 'new') return ok({ ...base, applicable: false });
    const contract = s?.oldContract; const slot = s?.vehicleSlot;
    // The buddy route records the car's odometer and never asks for a collection place; the manual draft carries both.
    const buddy = found.value.route === 'buddy'; const odometer = choices?.returnOdometer;
    const mileage = buddy ? odometer?.value : choices?.expectedReturnMileage;
    const unit = buddy ? odometer?.unit : 'mi';
    if (choices?.mode !== 'replacement' || !object(contract) || !text(contract.contractId) || !object(slot) || !text(slot.entitlementSlotId)
      || (buddy ? !object(odometer) || !text(unit, 16) : contract.contractId !== choices.oldContractId || !text(choices.collectionLocationId))
      || !Number.isSafeInteger(mileage) || mileage < 0) return badSource();
    return ok({ ...base, applicable: true, oldContract: contract, vehicleSlotId: slot.entitlementSlotId, locationId: buddy ? null : choices.collectionLocationId,
      mileage, unit });
  }

  // Paula's current car as the account shows it now; the recorded contract only fills a gap, and nothing here writes either.
  async #currentCar(context, source) {
    const employee = await this.#repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: source.employeeId } });
    if (employee.status !== 'ok' && employee.status !== 'not-found') return employee;
    const live = employee.status === 'ok' ? employee.value.contract?.manualContext?.contracts?.find((c) => c.contractId === source.oldContract.contractId) : null;
    const car = live ?? source.oldContract;
    return ok({ contractId: car.contractId, slotId: car.slotId ?? source.vehicleSlotId, status: car.status ?? null, model: car.model ?? null,
      vehicle: car.vehicle ?? null, source: live ? 'account' : 'selection' });
  }

  async #locationLabel(context, source, read) {
    try {
      const row = await this.#policy.getAssumption('manual.context.v1', read);
      return row?.value?.value?.locations?.find((l) => l.locationId === source.locationId)?.label ?? null;
    } catch { return null; }
  }

  // Slots for one choice from the keyed rules; the handover must already be in a required state.
  async #choiceOffer(rule, handover, now) {
    if (!rule.requiresHandoverStates.includes(handover.state)) return { available: false, slots: [], reason: 'Confirm your new car\'s handover first.' };
    if (!handover.slot) return { available: false, slots: [], reason: 'Your new car\'s handover has no confirmed time yet.' };
    if (rule.slot === 'handover-slot') return { available: true, slots: [handover.slot], reason: null };
    const offer = await this.#provider?.offerSlots({ now, ...rule.slots });
    if (offer?.status === 'unsupported') return { available: false, slots: [], reason: offer.reason ?? 'Slots are not available in this mode.', code: offer.code ?? 'unsupported' };
    if (offer?.status !== 'ok' || !Array.isArray(offer.slots)) return { available: false, slots: [], reason: 'Slots are unavailable. Try again shortly.', code: 'offer-unavailable' };
    const from = rule.notBeforeHandoverEnd ? Date.parse(handover.slot.end) : -Infinity;
    const to = Date.parse(handover.slot.end) + rule.maxDaysAfterHandover * DAY;
    const slots = offer.slots.filter((s) => Date.parse(s.start) >= from && Date.parse(s.start) <= to);
    return slots.length ? { available: true, slots, reason: null } : { available: false, slots: [], reason: 'No return slots are free after your handover.', code: 'no-return-slots' };
  }

  // The return appointment asks here for slots, so a request can only book what the choice's rules offer.
  async #slotSource(context, { orderUuid, now, policyVersion, input }) {
    if (!input?.choice) return { slots: [] };
    const config = await loadReturnPolicy(this.#policy, { runId: context.runId, asOf: now, policyVersion }); if (config.status !== 'ok') return { blocked: { code: 'return-policy-unavailable', reason: config.reason } };
    const rule = config.value.rules[input.choice]; if (!rule) return { blocked: { code: 'unknown-choice', reason: 'Choose one of the return options.' } };
    const handover = await this.#handover.read(context, { orderUuid }); if (handover.status !== 'ok') return { blocked: { code: 'handover-unavailable', reason: 'Your handover could not be read.' } };
    const offer = await this.#choiceOffer(rule, handover.value, now);
    return offer.available ? { slots: offer.slots } : { blocked: { code: offer.code ?? 'handover-not-ready', reason: offer.reason } };
  }

  async #plan(context, scope, orderUuid, { now, policyVersion }) {
    const source = await this.#source(context, scope, orderUuid); if (source.status !== 'ok') return source;
    const s = source.value;
    if (!s.applicable) {
      return ok({ contractVersion: RETURN_PLAN_CONTRACT, runId: context.runId, orderUuid, employeeId: s.employeeId, applicable: false, state: null, scheduled: false,
        oldContractId: null, vehicleSlotId: null, currentCar: null, returnMileage: null, choice: null, location: null, appointment: null, handover: null,
        slot: null, requestedSlot: null, proposedSlot: null, proposalId: null, providerReference: null, history: [], owner: null, nextStep: null,
        pending: null, blocked: null, choices: [], offeredSlots: {}, policyVersion, assumptions: [], fictional: true });
    }
    const appointment = await this.#returns.read(context, { orderUuid }); if (appointment.status !== 'ok') return appointment;
    const a = appointment.value; const read = { runId: context.runId, asOf: now, policyVersion: a.policyVersion };
    const config = await loadReturnPolicy(this.#policy, read); if (config.status !== 'ok') return config;
    const handover = await this.#handover.read(context, { orderUuid }); if (handover.status !== 'ok') return handover;
    const car = await this.#currentCar(context, s); if (car.status !== 'ok') return car;
    const state = PLAN_STATE[a.state]; const planning = state === 'not-planned';
    const choices = []; const offeredSlots = {};
    for (const { id, label } of config.value.choices) {
      const offer = planning ? await this.#choiceOffer(config.value.rules[id], handover.value, now) : { available: false, slots: [], reason: 'Your return is already planned.' };
      choices.push({ id, label, available: offer.available, reason: offer.reason, selected: a.plan?.choice === id });
      offeredSlots[id] = offer.slots;
    }
    const idle = planning && !choices.some((c) => c.available);
    const step = idle ? config.value.ownership.ineligible : { owner: a.owner, nextStep: a.nextStep };
    const { assumptions: _assumptions, offeredSlots: _offered, policyVersion: _policy, ...nested } = a;
    return ok({ contractVersion: RETURN_PLAN_CONTRACT, runId: context.runId, orderUuid, employeeId: s.employeeId, applicable: true, state, scheduled: state === 'return-scheduled',
      oldContractId: s.oldContract.contractId, vehicleSlotId: s.vehicleSlotId, currentCar: car.value,
      returnMileage: { value: s.mileage, unit: s.unit, recordedAt: s.receivedAt, source: 'selection' },
      choice: a.plan?.choice ?? null, location: { locationId: s.locationId, label: await this.#locationLabel(context, s, read), rule: a.plan?.choice ? config.value.rules[a.plan.choice].location : null },
      appointment: nested, handover: { state: handover.value.state, booked: handover.value.booked, slot: handover.value.slot,
        providerReference: handover.value.history.at(-1)?.providerReference ?? null },
      slot: a.slot, requestedSlot: a.requestedSlot, proposedSlot: a.proposedSlot, proposalId: a.proposalId, providerReference: a.history.at(-1)?.providerReference ?? null,
      history: a.history.map((h) => ({ state: PLAN_STATE[h.state], appointmentState: h.state, at: h.at, providerReference: h.providerReference })),
      owner: step.owner, nextStep: step.nextStep, pending: a.pending, blocked: a.blocked, choices, offeredSlots,
      policyVersion: a.policyVersion, assumptions: config.value.assumptions, fictional: true });
  }

  read(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['employee', 'greg', 'presenter']); if (role.status !== 'ok') return role;
    if (!object(input) || !text(input.orderUuid, 128) || Object.keys(input).some((key) => key !== 'orderUuid')) return invalid('orderUuid', 'Choose an order to view.');
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    return this.#plan(context, role.value, input.orderUuid, prepared);
  }); }

  // A refused write reports unsupported with the reason, carrying the plan as it stands.
  async #after(context, outcome, orderUuid, prepared) {
    if (outcome.status !== 'ok' && !(outcome.status === 'unsupported' && outcome.appointment)) return outcome;
    const plan = await this.#plan(context, 'employee', orderUuid, prepared); if (plan.status !== 'ok') return plan;
    return outcome.status === 'ok' ? plan : result('unsupported', { code: outcome.code, reason: outcome.reason, plan: plan.value });
  }

  request(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['employee']); if (role.status !== 'ok') return role;
    if (!object(input) || !text(input.orderUuid, 128) || !text(input.choice, 64) || !text(input.slotId, 64)
      || Object.keys(input).some((key) => !['orderUuid', 'choice', 'slotId'].includes(key))) return invalid('request', 'Supply the order, how you want to return the car and the slot you chose.');
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    const { orderUuid, choice, slotId } = input;
    const plan = await this.#plan(context, 'employee', orderUuid, prepared); if (plan.status !== 'ok') return plan;
    if (!plan.value.applicable) return result('conflict', { code: 'return-not-applicable', reason: 'A new order has no current car to return.' });
    const option = plan.value.choices.find((c) => c.id === choice);
    if (!option) return invalid('choice', 'Choose one of the return options.');
    // A repeat of the booked request skips the handover check; a different choice or slot is refused by the appointment.
    if (plan.value.state === 'not-planned' && !option.available) return result('conflict', { code: 'handover-not-ready', reason: option.reason, reasons: [{ field: 'choice', reason: option.reason }] });
    return this.#after(context, await this.#returns.request(context, { orderUuid, choice, slotId }), orderUuid, prepared);
  }); }

  acceptChange(context, input = {}) { return this.#safe(async () => {
    const role = await this.#role(context, ['employee']); if (role.status !== 'ok') return role;
    if (!object(input) || !text(input.orderUuid, 128) || !text(input.proposalId, 128) || Object.keys(input).some((key) => !['orderUuid', 'proposalId'].includes(key))) {
      return invalid('proposalId', 'Supply the order and the proposed change to accept.');
    }
    const prepared = await this.#now(context); if (prepared.error) return prepared.error;
    return this.#after(context, await this.#returns.acceptChange(context, input), input.orderUuid, prepared);
  }); }
}

export const createLifecycleReturnPlanService = (options) => new LifecycleReturnPlanService(options);
