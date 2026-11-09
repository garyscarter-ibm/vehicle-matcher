import { result } from '../../repository/index.js';

export const APPOINTMENT_KEYS = Object.freeze({
  slots: 'lifecycle.appointments.slots.v1',
  confirmation: 'lifecycle.appointments.confirmation.v1',
  scenario: 'lifecycle.appointments.scenario.v1',
  ownership: 'lifecycle.appointments.ownership.v1',
  outcomes: 'lifecycle.appointments.outcomes.v1',
  outcomeTiming: 'lifecycle.appointments.outcomeTiming.v1',
});
export const OWNERS = Object.freeze(['employee', 'retailer', 'scheme-team']);
export const STATES = Object.freeze(['not-requested', 'requested', 'change-proposed', 'scheduled']);
export const OUTCOME_STATES = Object.freeze(['completed', 'no-show']);
const EXTRA_STEPS = ['ineligible', 'pending', 'blocked'];
const text = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('—');
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const int = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const step = (v) => object(v) && OWNERS.includes(v.owner) && text(v.nextStep);
export const policyUnavailable = () => result('unavailable', { code: 'appointment-policy-unavailable', retryable: true,
  reason: 'Appointment rules are unavailable. Ask the scheme team to check the demonstration setup.' });

// Every slot, delay, scenario and owner comes from PolicyService; there are no consumer defaults.
// The outcomes key is read only when the caller supplies one, so the return purpose is unchanged.
export async function loadAppointmentPolicy(policy, read, ownershipKey = APPOINTMENT_KEYS.ownership, outcomesKey = null) {
  if (!policy || typeof policy.getAssumption !== 'function') return policyUnavailable();
  const keys = [APPOINTMENT_KEYS.slots, APPOINTMENT_KEYS.confirmation, APPOINTMENT_KEYS.scenario, ownershipKey, ...(outcomesKey ? [outcomesKey] : [])];
  let rows;
  try { rows = await Promise.all(keys.map((key) => policy.getAssumption(key, read))); } catch { return policyUnavailable(); }
  if (rows.some((row) => row?.status !== 'ok' || row.policyVersion !== read.policyVersion || !text(row.value?.basis, 2000)
    || !text(row.value?.unit) || !['assumed', 'verified'].includes(row.value.status))) return policyUnavailable();
  const [slots, confirmation, scenario, ownership, outcomes] = rows.map((row) => row.value.value);
  if (!object(slots) || !text(slots.openingStage, 128) || slots.openingState !== 'approved' || !int(slots.earliestLeadDays, 0, 60)
    || !int(slots.daysOffered, 1, 14) || !int(slots.slotMinutes, 5, 480) || !Array.isArray(slots.dailyStartTimes) || slots.dailyStartTimes.length === 0
    || !slots.dailyStartTimes.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || new Set(slots.dailyStartTimes).size !== slots.dailyStartTimes.length) return policyUnavailable();
  if (!object(confirmation) || !int(confirmation.confirmDelaySeconds, 0, 30 * 86400) || !int(confirmation.providerTimeoutMs, 1, 60000)) return policyUnavailable();
  if (!object(scenario) || typeof scenario.proposeChange !== 'boolean' || scenario.proposedSlot !== 'next-offered' || !text(scenario.proposalReason)) return policyUnavailable();
  if (!object(ownership) || !object(ownership.states) || !STATES.every((s) => step(ownership.states[s])) || !EXTRA_STEPS.every((s) => step(ownership[s]))) return policyUnavailable();
  if (outcomesKey && (!object(outcomes) || !object(outcomes.states) || !OUTCOME_STATES.every((s) => step(outcomes.states[s])) || !step(outcomes.notReady)
    || !object(outcomes.exceptionTypes) || !text(outcomes.exceptionTypes.noShow, 128))) return policyUnavailable();
  return { status: 'ok', value: { policyVersion: read.policyVersion, openingStage: slots.openingStage, openingState: slots.openingState,
    slotPolicy: { earliestLeadDays: slots.earliestLeadDays, daysOffered: slots.daysOffered, slotMinutes: slots.slotMinutes,
      dailyStartTimes: [...slots.dailyStartTimes] },
    confirmDelaySeconds: confirmation.confirmDelaySeconds, providerTimeoutMs: confirmation.providerTimeoutMs,
    ...(outcomesKey ? { outcomes } : {}),
    scenario: { proposeChange: scenario.proposeChange, proposedSlot: scenario.proposedSlot, proposalReason: scenario.proposalReason }, ownership,
    assumptions: rows.map(({ value, policyVersion }) => ({ key: value.key, status: value.status, unit: value.unit, basis: value.basis,
      source: value.source, sourceDate: value.sourceDate, policyVersion })) } };
}

// FUCQ-260: the earliest demo time each handover outcome may be recorded, relative to the booked slot start; no defaults.
export async function loadOutcomeTiming(policy, read) {
  let row; try { row = await policy?.getAssumption?.(APPOINTMENT_KEYS.outcomeTiming, read); } catch { return policyUnavailable(); }
  const v = row?.value?.value;
  if (row?.status !== 'ok' || row.policyVersion !== read.policyVersion || !['assumed', 'verified'].includes(row.value.status) || !object(v)
    || !int(v.completeAfterSlotStartSeconds, 0, 86400) || !int(v.noShowAfterSlotStartSeconds, 0, 86400) || !step(v.tooEarly)) return policyUnavailable();
  return { status: 'ok', value: { complete: v.completeAfterSlotStartSeconds, noShow: v.noShowAfterSlotStartSeconds, tooEarly: v.tooEarly } };
}
