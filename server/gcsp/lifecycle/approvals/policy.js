import { result } from '../../repository/core.js';

// The stage list is FUCQ-71's canonical key: HR approval is configured by its presence there, not by a second flag.
export const STAGE_LIST_KEY = 'ordering.approvalStages.v1';
export const LIFECYCLE_KEYS = Object.freeze({ ticks: 'lifecycle.approval.ticks.v1', decline: 'lifecycle.approval.declineScenario.v1',
  ownership: 'lifecycle.approval.ownership.v1' });
export const SELECTION_STAGE = 'selection received';
const ALLOWED_STAGES = [['sales-manager approval', 'sent to ordering'], ['HR approval', 'sales-manager approval', 'sent to ordering']];
const OWNERS = ['HR', 'sales manager', 'ordering', 'scheme team'];
const text = (v, max = 200) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('—');
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const policyUnavailable = (code = 'lifecycle-policy-unavailable') => result('unavailable', { code, retryable: true,
  reason: 'Order approval rules are unavailable. Ask the scheme team to check the demonstration setup.' });

// Reads every rule at one pinned version. An order's own stage snapshot governs it, so a later list never relabels it.
export async function loadLifecyclePolicy(policy, read, snapshot) {
  if (!policy || typeof policy.getAssumption !== 'function') return policyUnavailable();
  const keys = [STAGE_LIST_KEY, ...Object.values(LIFECYCLE_KEYS)];
  let rows;
  try { rows = await Promise.all(keys.map((key) => policy.getAssumption(key, read))); } catch { return policyUnavailable(); }
  if (rows.some((r) => r?.status !== 'ok' || r.policyVersion !== read.policyVersion || !text(r.value?.basis, 2000) || !text(r.value?.unit)
    || !['assumed', 'verified'].includes(r.value.status))) return policyUnavailable();
  const [stages, ticks, decline, ownership] = rows.map((r) => r.value.value);
  const allowed = (list) => Array.isArray(list) && ALLOWED_STAGES.find((a) => JSON.stringify(a) === JSON.stringify(list));
  const approvals = allowed(stages) && (snapshot === undefined ? allowed(stages) : allowed(snapshot));
  const stageList = approvals ? [SELECTION_STAGE, ...approvals] : null;
  const step = (v) => object(v) && OWNERS.includes(v.owner) && text(v.nextStep);
  if (!stageList || !object(ticks) || approvals.some((s) => !Number.isSafeInteger(ticks[s]) || ticks[s] < 1 || ticks[s] > 50)
    || !object(decline) || typeof decline.enabled !== 'boolean' || !text(decline.stage) || !text(decline.reasonCode, 64)
    || !text(decline.reason) || !text(decline.eventType, 64) || (decline.enabled && !approvals.includes(decline.stage))
    || !object(ownership) || !object(ownership.stages) || !object(ownership.outcomes)
    || stageList.some((s) => !step(ownership.stages[s])) || !['declined', 'sent-to-ordering'].every((o) => step(ownership.outcomes[o]))) return policyUnavailable('lifecycle-policy-invalid');
  return { status: 'ok', value: { policyVersion: read.policyVersion, stageList, approvals, ticks, decline, ownership,
    provenance: rows.map((r) => ({ key: r.value.key, status: r.value.status, source: r.value.source ?? null, sourceDate: r.value.sourceDate ?? null })) } };
}
