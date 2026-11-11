import { feedbackPolicyValid } from '../recommendation/current-car.js';

export const EMPLOYEE_EXPERIENCE_KEYS = ['brief.engagement.v1', 'employee.currentCarFeedback.v1'];
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
    if (key === 'brief.engagement.v1') {
      if (!engagementValid(previous.value)) return { invalidKey: key };
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
