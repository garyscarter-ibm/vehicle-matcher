import { result } from '../repository/core.js';
export const CASE_KEYS = Object.freeze(['renewalCase.deadline.enabled', 'renewalCase.deadline.withinDays',
  'renewalCase.lifecycle.enabled', 'renewalCase.lifecycle.eventTypes', 'renewalCase.selection.eventTypes',
  'renewalCase.owner.role', 'renewalCase.response.dueHours', 'renewalCase.extension.permitted']);
export const unavailable = () => result('unavailable', { reason: 'Renewal case policy or context is unavailable. Ask the scheme team to check the demonstration setup.', retryable: true });
export async function loadCasePolicy(policy, read) {
  const rows = await Promise.all(CASE_KEYS.map((key) => policy.getAssumption(key, read)));
  if (rows.some((r) => r.status !== 'ok' || r.policyVersion !== read.policyVersion || !r.value?.basis || !r.value?.unit
    || !['assumed', 'verified'].includes(r.value.status))) return unavailable();
  const values = rows.map((r) => r.value.value);
  const list = (value) => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length
    && value.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 128);
  if (![values[0], values[2], values[7]].every((v) => typeof v === 'boolean') || !Number.isSafeInteger(values[1]) || values[1] < 0
    || !list(values[3]) || !list(values[4]) || values[5] !== 'scheme-team' || !Number.isSafeInteger(values[6]) || values[6] < 1) return unavailable();
  return { status: 'ok', value: { deadlineEnabled: values[0], withinDays: values[1], lifecycleEnabled: values[2],
    eventTypes: values[3], acknowledgedTypes: values[4], ownerRole: values[5], dueHours: values[6], extensionPermitted: values[7],
    assumptions: rows.map((r) => r.value) } };
}
