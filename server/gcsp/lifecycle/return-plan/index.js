import { ok, result } from '../../repository/index.js';
import { LifecycleAppointmentService } from '../appointments/index.js';
import { findSelectionOrder } from '../approvals/source.js';
import { readCurrentCar } from '../current-car/index.js';
import { loadReturnOutcomePolicy, loadReturnPolicy, RETURN_KEYS } from './policy.js';
import { ReturnOutcomeRecorder } from './outcomes.js';

export const RETURN_PLAN_CONTRACT = 'lifecycle.return-plan.v1';
// Plan states over the return appointment's own states; a proposed change is still a request, never a schedule.
const PLAN_STATE = { 'not-requested': 'not-planned', requested: 'return-requested', 'change-proposed': 'return-requested', scheduled: 'return-scheduled' };
const OUTCOME_STATE = { returned: 'returned', missed: 'return-missed' };
const DAY = 86400000;
const ADDRESS_LINES = ['line1', 'line2', 'line3', 'town', 'county', 'postcode'];
const text = (v, max = 512) => typeof v === 'string' && v.length > 0 && v.length <= max;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const invalid = (field, reason) => result('invalid', { code: 'invalid-return-command', reasons: [{ field, reason }], action: 'review-and-retry' });
const unavailable = () => result('unavailable', { code: 'return-plan-unavailable', retryable: true, reason: 'The return plan is unavailable. Try again shortly.' });
const badSource = () => result('unavailable', { code: 'return-plan-source-invalid', retryable: false, reason: 'The record of your current car could not be read.' });

export class LifecycleReturnPlanService {
  #repository; #policy; #clock; #identity; #provider; #handover; #returns; #outcomes;
  // `outcomes` is the return outcome step of the appointment capability (FUCQ-168); without it no outcome is recorded.
  constructor({ repository, policy, clock, identity, lifecycleStages, provider, handover, outcomes } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity; this.#provider = provider; this.#handover = handover;
    this.#returns = new LifecycleAppointmentService({ repository, policy, clock, identity, lifecycleStages, provider, purpose: 'return',
      ownershipKey: RETURN_KEYS.ownership, requestFields: ['choice'], slotSource: (context, args) => this.#slotSource(context, args) });
    this.#outcomes = new ReturnOutcomeRecorder({ repository, policy, clock, provider: outcomes, describe: (system, a, now) => this.#describe(system, a, now) });
  }

  // The outcome handler registers after the return appointment's, so a return scheduled on one tick gets its outcome on a later one.
  async start() {
    const returns = await this.#returns.start(); if (returns.status !== 'ok') return returns;
    const outcomes = await this.#outcomes.start(); return outcomes.status === 'ok' ? returns : outcomes;
  }

  // Exact identities and the planned location a recorded outcome keeps (FUCQ-168).
  async #describe(system, a, now) {
    const source = await this.#source(system, 'system', a.orderUuid); if (source.status !== 'ok') return source;
    if (!source.value.applicable) return result('conflict', { code: 'return-not-applicable', reason: 'A new order has no current car to return.' });
    const read = { runId: system.runId, asOf: now, policyVersion: a.policyVersion };
    const config = await loadReturnPolicy(this.#policy, read); if (config.status !== 'ok') return config;
    const account = await this.#account(system, source.value); if (account.status !== 'ok') return account;
    const rule = a.plan?.choice ? config.value.rules[a.plan.choice]?.location ?? null : null;
    return ok({ employeeId: source.value.employeeId, oldContractId: source.value.oldContract.contractId, entitlementSlotId: source.value.vehicleSlotId,
      location: await this.#location(source.value, account.value, rule, read) });
  }

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
    // Manual orders carry the review details frozen at confirmation; older orders without them fall back to the draft.
    const frozen = s?.reviewDetails?.details;
    const mileage = buddy ? odometer?.value : object(frozen) ? frozen.expectedReturnMileage : choices?.expectedReturnMileage;
    const unit = buddy ? odometer?.unit : 'mi';
    if (choices?.mode !== 'replacement' || !object(contract) || !text(contract.contractId) || !object(slot) || !text(slot.entitlementSlotId)
      || (buddy ? !object(odometer) || !text(unit, 16) : contract.contractId !== choices.oldContractId || !text(choices.collectionLocationId))
      || !Number.isSafeInteger(mileage) || mileage < 0) return badSource();
    return ok({ ...base, applicable: true, buddy, oldContract: contract, vehicleSlotId: slot.entitlementSlotId, locationId: buddy ? null : choices.collectionLocationId,
      mileage, unit });
  }

  // Paula's account as it is now: her current car (the recorded contract only fills a gap) and home address. Nothing here writes either.
  async #account(context, source) {
    const employee = await this.#repository.read(context, { table: 'employees', key: { runId: context.runId, employeeId: source.employeeId } });
    if (employee.status !== 'ok' && employee.status !== 'not-found') return employee;
    const manual = employee.status === 'ok' ? employee.value.contract?.manualContext : null;
    const live = manual?.contracts?.find((c) => c.contractId === source.oldContract.contractId);
    const car = live ?? source.oldContract;
    const address = object(manual?.account?.address) ? ADDRESS_LINES.map((k) => manual.account.address[k]).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim()) : [];
    return ok({ currentCar: { contractId: car.contractId, slotId: car.slotId ?? source.vehicleSlotId, status: car.status ?? null, model: car.model ?? null,
      vehicle: car.vehicle ?? null, source: live ? 'account' : 'selection' }, homeAddress: address.length ? address.join(', ') : null });
  }

  // Gary, 8 Nov 2026 (FUCQ-194): the buddy route collects the old car from her home address; missing stays null, never invented.
  async #location(source, account, rule, read) {
    if (source.buddy) return { locationId: null, kind: 'home-address', label: account.homeAddress, rule: 'home-address' };
    return { locationId: source.locationId, kind: 'collection-location', label: await this.#locationLabel(source, read), rule };
  }

  async #locationLabel(source, read) {
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
    const relationship = await readCurrentCar(this.#repository, context, orderUuid); if (relationship.status !== 'ok') return relationship;
    if (!s.applicable) {
      return ok({ contractVersion: RETURN_PLAN_CONTRACT, runId: context.runId, orderUuid, employeeId: s.employeeId, applicable: false, state: null, scheduled: false,
        oldContractId: null, vehicleSlotId: null, currentCar: null, returnMileage: null, choice: null, location: null, appointment: null, handover: null,
        slot: null, requestedSlot: null, proposedSlot: null, proposalId: null, providerReference: null, history: [], owner: null, nextStep: null,
        pending: null, blocked: null, choices: [], offeredSlots: {}, outcome: null, relationship: relationship.value, policyVersion, assumptions: [], fictional: true });
    }
    const appointment = await this.#returns.read(context, { orderUuid }); if (appointment.status !== 'ok') return appointment;
    const a = appointment.value; const read = { runId: context.runId, asOf: now, policyVersion: a.policyVersion };
    const config = await loadReturnPolicy(this.#policy, read); if (config.status !== 'ok') return config;
    const handover = await this.#handover.read(context, { orderUuid }); if (handover.status !== 'ok') return handover;
    const account = await this.#account(context, s); if (account.status !== 'ok') return account;
    const outcomeConfig = await loadReturnOutcomePolicy(this.#policy, read); if (outcomeConfig.status !== 'ok') return outcomeConfig;
    const recorded = await this.#outcomes.read(context, orderUuid); if (recorded.status !== 'ok') return recorded;
    const o = recorded.value; const done = o && OUTCOME_STATE[o.state];
    const state = done ?? PLAN_STATE[a.state]; const planning = state === 'not-planned';
    const choices = []; const offeredSlots = {};
    for (const { id, label } of config.value.choices) {
      const offer = planning ? await this.#choiceOffer(config.value.rules[id], handover.value, now) : { available: false, slots: [], reason: 'Your return is already planned.' };
      choices.push({ id, label, available: offer.available, reason: offer.reason, selected: a.plan?.choice === id });
      offeredSlots[id] = offer.slots;
    }
    const idle = planning && !choices.some((c) => c.available);
    const unsure = !a.pending && o?.pending?.lastKnownState === 'unknown' ? { step: 'outcome', reason: 'Waiting for the provider to confirm the last update.' } : null;
    const step = done ? outcomeConfig.value.ownership[o.state] : unsure ? config.value.ownership.pending
      : !a.blocked && o?.blocked ? config.value.ownership.blocked : idle ? config.value.ownership.ineligible : { owner: a.owner, nextStep: a.nextStep };
    const outcome = done ? { state, at: o.at, location: o.location, appointment: o.appointment, providerReference: o.providerReference, oldContractId: o.oldContractId } : null;
    const { assumptions: _assumptions, offeredSlots: _offered, policyVersion: _policy, ...nested } = a;
    return ok({ contractVersion: RETURN_PLAN_CONTRACT, runId: context.runId, orderUuid, employeeId: s.employeeId, applicable: true, state, scheduled: state === 'return-scheduled',
      oldContractId: s.oldContract.contractId, vehicleSlotId: s.vehicleSlotId, currentCar: account.value.currentCar,
      returnMileage: { value: s.mileage, unit: s.unit, recordedAt: s.receivedAt, source: 'selection' },
      choice: a.plan?.choice ?? null, location: await this.#location(s, account.value, a.plan?.choice ? config.value.rules[a.plan.choice].location : null, read),
      appointment: nested, handover: { state: handover.value.state, booked: handover.value.booked, slot: handover.value.slot,
        providerReference: handover.value.history.at(-1)?.providerReference ?? null },
      slot: a.slot, requestedSlot: a.requestedSlot, proposedSlot: a.proposedSlot, proposalId: a.proposalId, providerReference: a.history.at(-1)?.providerReference ?? null,
      history: [...a.history.map((h) => ({ state: PLAN_STATE[h.state], appointmentState: h.state, at: h.at, providerReference: h.providerReference })),
        ...(done ? [{ state, appointmentState: null, at: o.at, providerReference: o.providerReference }] : [])],
      owner: step.owner, nextStep: step.nextStep, pending: a.pending ?? unsure, blocked: a.blocked ?? (o?.blocked ? { code: o.blocked.code, reason: o.blocked.reason } : null),
      choices, offeredSlots, outcome, relationship: relationship.value,
      policyVersion: a.policyVersion, assumptions: [...config.value.assumptions, outcomeConfig.value.assumption], fictional: true });
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
