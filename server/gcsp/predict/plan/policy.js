import { CONTRACT_VERSION, integer } from './input.js';

export const PLANNING_POLICY_KEYS = Object.freeze(['orderPlan.horizonDays', 'orderPlan.budgetMinor', 'orderPlan.currency',
  'orderPlan.modelBounds', 'orderPlan.derivativeBounds', 'orderPlan.objectiveWeights', 'supply.leadTimeDays']);

// No runtime defaults: every value is read from the canonical seed via PolicyService.
export async function readPlanningPolicy(policy, read) {
  if (typeof policy?.getAssumption !== 'function' || !read?.policyVersion) return { status: 'unavailable', code: 'planning-policy-not-configured', contractVersion: CONTRACT_VERSION };
  let rows;
  try { rows = await Promise.all(PLANNING_POLICY_KEYS.map((key) => policy.getAssumption(key, read))); }
  catch { return { status: 'unavailable', code: 'planning-policy-unavailable', contractVersion: CONTRACT_VERSION }; }
  const failures = PLANNING_POLICY_KEYS.filter((key, i) => rows[i]?.status !== 'ok' || rows[i].policyVersion !== read.policyVersion || rows[i].value?.key !== key);
  if (failures.length) return { status: 'unavailable', code: 'planning-policy-incomplete', keys: failures, contractVersion: CONTRACT_VERSION };
  const provenance = rows.map((r) => structuredClone(r.value));
  const values = Object.fromEntries(provenance.map((row) => [row.key, row.value]));
  if (!integer(values['supply.leadTimeDays'])) return { status: 'invalid', code: 'planning-lead-time-invalid', contractVersion: CONTRACT_VERSION };
  return { status: 'ok', contractVersion: CONTRACT_VERSION, policyVersion: read.policyVersion, value: {
    horizonDays: values['orderPlan.horizonDays'], budgetMinor: values['orderPlan.budgetMinor'], currency: values['orderPlan.currency'],
    modelBounds: values['orderPlan.modelBounds'], derivativeBounds: values['orderPlan.derivativeBounds'],
    objectiveWeights: values['orderPlan.objectiveWeights'], leadTimeDays: values['supply.leadTimeDays'], provenance,
  } };
}
