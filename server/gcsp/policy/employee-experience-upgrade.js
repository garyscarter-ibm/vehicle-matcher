import { feedbackPolicyValid } from '../recommendation/current-car.js';

export const EMPLOYEE_EXPERIENCE_KEYS = ['brief.engagement.v1', 'employee.currentCarFeedback.v1', 'identity.demo.principals', 'employee.demoProfiles.v1'];
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
const engagementValid = (v) => only(v, ['schemaVersion', 'grants', 'onMinimumLoss']) && v.schemaVersion === 1
  && v.onMinimumLoss === 'disengage' && only(v.grants, ['search', 'hold'])
  && typeof v.grants.search === 'boolean' && typeof v.grants.hold === 'boolean';
const LEGACY_DIMENSIONS = ['eligibilityModelKey', 'body', 'fuel'];

// Plan only the recognized schema transition. Configured policy values are never defaults to reset.
export function planEmployeeExperienceUpgrade(assumptions, bundle) {
  const additions = []; const updates = [];
  for (const key of EMPLOYEE_EXPERIENCE_KEYS) {
    const definition = bundle.definitions.find((row) => row.key === key);
    const previous = assumptions.find((row) => row.key === key);
    if (!previous) { additions.push(structuredClone(definition)); continue; }
    if (!['assumed', 'verified'].includes(previous.status)) return { invalidKey: key };
    if (key === 'employee.demoProfiles.v1') {
      if (previous.value?.schemaVersion !== 1 || !plain(previous.value.profiles)) return { invalidKey: key };
      continue;
    }
    if (key === 'brief.engagement.v1') {
      if (!engagementValid(previous.value)) return { invalidKey: key };
      continue;
    }
    if (key === 'identity.demo.principals') {
      if (!Array.isArray(previous.value)) return { invalidKey: key };
      const canonical = definition.value.find((person) => person.principalId === 'demo-greg');
      const greg = previous.value.find((person) => person.principalId === canonical.principalId);
      if (!greg || !Array.isArray(greg.roles)) return { invalidKey: key };
      if (greg.roles.includes('employee')) continue;
      // Only the known former ordering-only Greg shape is upgraded. Keep other
      // configured people and every unrelated setting in the retained policy.
      if (greg.roles.length !== 1 || greg.roles[0] !== 'greg' || greg.employeeId !== canonical.employeeId
        || greg.companyId !== canonical.companyId || greg.schemeId !== canonical.schemeId
        || greg.gradeId !== undefined || greg.entitlementSlotId !== undefined) return { invalidKey: key };
      const next = structuredClone(previous);
      Object.assign(next.value.find((person) => person.principalId === canonical.principalId), {
        roles: [...canonical.roles], gradeId: canonical.gradeId, entitlementSlotId: canonical.entitlementSlotId,
      });
      next.basis = `${previous.basis} Greg employee access authorised 11 November 2026; adds his own entitlement alongside ordering responsibility.`;
      next.source = definition.source; next.sourceDate = definition.sourceDate;
      updates.push({ previous, next, transformation: { key, principalId: canonical.principalId,
        addedRoles: ['employee'], addedFields: ['gradeId', 'entitlementSlotId'] } });
      continue;
    }
    if (!feedbackPolicyValid(previous.value)) return { invalidKey: key };
    const dimensions = previous.value.sameAgain.dimensions;
    if (dimensions.includes('configurationId')) continue;
    if (dimensions.length !== LEGACY_DIMENSIONS.length || !LEGACY_DIMENSIONS.every((name) => dimensions.includes(name)))
      return { invalidKey: key };
    const next = structuredClone(previous);
    next.value.sameAgain.dimensions.push('configurationId');
    next.basis = `${previous.basis} Reviewed structural migration adds exact configuration identity to Same again; existing rating, similarity and improvement settings are retained.`;
    next.source = definition.source; next.sourceDate = definition.sourceDate;
    updates.push({ previous, next, transformation: { key, path: 'value.sameAgain.dimensions', appended: ['configurationId'] } });
  }
  return { additions, updates, required: additions.length > 0 || updates.length > 0 };
}
