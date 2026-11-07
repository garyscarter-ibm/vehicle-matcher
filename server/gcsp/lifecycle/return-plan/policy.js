import { result } from '../../repository/index.js';
import { loadAppointmentPolicy, STATES as APPOINTMENT_STATES } from '../appointments/policy.js';

export const RETURN_KEYS = Object.freeze({ options: 'lifecycle.return.options.v1', ownership: 'lifecycle.return.ownership.v1' });
export const CHOICES = Object.freeze(['same-visit', 'separate']);
const SLOT_RULES = { 'same-visit': 'handover-slot', separate: 'after-handover' };
const text = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('—');
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const int = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
export const policyUnavailable = () => result('unavailable', { code: 'return-policy-unavailable', retryable: true,
  reason: 'Return rules are unavailable. Ask the scheme team to check the demonstration setup.' });

function validRule(id, rule) {
  if (!object(rule) || !Array.isArray(rule.requiresHandoverStates) || rule.requiresHandoverStates.length === 0
    || !rule.requiresHandoverStates.every((s) => APPOINTMENT_STATES.includes(s)) || rule.location !== 'handover-retailer' || rule.slot !== SLOT_RULES[id]) return false;
  if (id === 'same-visit') return true;
  const s = rule.slots;
  return typeof rule.notBeforeHandoverEnd === 'boolean' && int(rule.maxDaysAfterHandover, 1, 60) && object(s) && int(s.earliestLeadDays, 0, 60)
    && int(s.daysOffered, 1, 30) && int(s.slotMinutes, 5, 480) && Array.isArray(s.dailyStartTimes) && s.dailyStartTimes.length > 0
    && s.dailyStartTimes.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) && new Set(s.dailyStartTimes).size === s.dailyStartTimes.length;
}

// Choices, rules and wording come from PolicyService; the appointment keys (slots, confirmation, scenario) are reused (HLD Q19).
export async function loadReturnPolicy(policy, read) {
  if (!policy || typeof policy.getAssumption !== 'function') return policyUnavailable();
  let row; try { row = await policy.getAssumption(RETURN_KEYS.options, read); } catch { return policyUnavailable(); }
  const v = row?.value?.value;
  if (row?.status !== 'ok' || row.policyVersion !== read.policyVersion || !text(row.value?.basis, 2000) || !text(row.value?.unit)
    || !['assumed', 'verified'].includes(row.value.status) || !object(v) || !object(v.rules) || !Array.isArray(v.choices) || v.choices.length === 0) return policyUnavailable();
  const ids = v.choices.map((c) => c?.id);
  if (!v.choices.every((c) => object(c) && CHOICES.includes(c.id) && text(c.label)) || new Set(ids).size !== ids.length
    || Object.keys(v.rules).length !== ids.length || !ids.every((id) => validRule(id, v.rules[id]))) return policyUnavailable();
  const appointments = await loadAppointmentPolicy(policy, read, RETURN_KEYS.ownership); if (appointments.status !== 'ok') return policyUnavailable();
  const { value } = row;
  return { status: 'ok', value: { policyVersion: read.policyVersion, choices: v.choices.map(({ id, label }) => ({ id, label })), rules: structuredClone(v.rules),
    ownership: appointments.value.ownership,
    assumptions: [{ key: value.key, status: value.status, unit: value.unit, basis: value.basis, source: value.source, sourceDate: value.sourceDate,
      policyVersion: row.policyVersion }, ...appointments.value.assumptions] } };
}
