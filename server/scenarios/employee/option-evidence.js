// Reviewed policy maps selected capabilities, never dictionary availability, to preference evidence.
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['sportiness', 'comfort', 'economy', 'size', 'body', 'fuel'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const stronger = (left = 0, right = 0) => Math.abs(right) > Math.abs(left)
  || Math.abs(right) === Math.abs(left) && right < left ? right : left;
const codes = (value) => Array.isArray(value) && value.every((code) => typeof code === 'string' && /^[A-Z0-9]+$/.test(code));

function validatePolicy(policy, preferences) {
  if (!object(policy) || policy.rule !== 'reviewedEquipment.v1' || typeof policy.version !== 'string'
    || policy.importance !== 100 || !Number.isFinite(policy.halfSaturationWeight) || policy.halfSaturationWeight <= 0
    || !Number.isFinite(policy.sliderStep) || policy.sliderStep <= 0
    || !Number.isFinite(policy.unknownModelAnchor) || policy.unknownModelAnchor < 0 || policy.unknownModelAnchor > 100
    || !Number.isFinite(policy.maximumAdjustment) || policy.maximumAdjustment < 0 || policy.maximumAdjustment > 100
    || !object(policy.options) || !object(policy.bundleFamilies) || !object(policy.disabledBy)
    || Object.values(policy.disabledBy).some((list) => !codes(list))
    || Object.values(policy.bundleFamilies).some((family) => !object(family)
      || !Array.isArray(family.groups) || !Array.isArray(family.members)
      || [...family.groups, ...family.members].some((group) => typeof group !== 'string'))
    || Object.values(policy.options).some((entry) => !object(entry) || typeof entry.group !== 'string'
      || !Number.isFinite(entry.weight) || entry.weight < 0 || entry.weight > 3
      || entry.bundle !== undefined && typeof entry.bundle !== 'boolean'
      || entry.requiresActivation !== undefined && typeof entry.requiresActivation !== 'boolean'
      || !object(entry.evidence) || Object.entries(entry.evidence).some(([field, value]) => !fields.includes(field)
        || (preferences[field]?.type === 'enum' ? !preferences[field].values.includes(value)
          : !Number.isFinite(value) || value < -3 || value > 3)))) throw TypeError('Invalid recommendation option evidence policy');
}

/** Null means the specification is unknown, not an evidenced basic car. */
export function scoreOptionEvidence(selection, policy, preferences) {
  if (policy === undefined) return null; // Existing pinned policies retain their original calculation.
  validatePolicy(policy, preferences);
  if (!object(selection) || !['selected-catalogue', 'verified-fitted'].includes(selection.kind)
    || !codes(selection.codes) || typeof selection.complete !== 'boolean'
    || selection.activeCodes !== undefined && (!codes(selection.activeCodes)
      || selection.activeCodes.some((code) => !selection.codes.includes(code)))) return null;
  const selected = new Set(selection.codes); const active = new Set(selection.activeCodes ?? []);
  const groups = new Map(); const bundles = new Map(); const enums = {};
  for (const code of [...selected].sort()) {
    const entry = Object.hasOwn(policy.options, code) ? policy.options[code] : null;
    if (!entry || entry.requiresActivation && !active.has(code)
      || policy.disabledBy[code]?.some((replacement) => selected.has(replacement))) continue;
    const family = entry.bundle ? Object.keys(policy.bundleFamilies)
      .find((key) => policy.bundleFamilies[key].groups.includes(entry.group)) : null;
    const map = family ? bundles : groups; const key = family ?? entry.group;
    const prior = map.get(key) ?? { group: key, weight: 0, evidence: {}, codes: [] };
    prior.weight = Math.max(prior.weight, entry.weight); prior.codes.push(code);
    for (const [field, value] of Object.entries(entry.evidence)) {
      if (typeof value === 'string') (enums[field] ??= new Set()).add(value);
      else prior.evidence[field] = stronger(prior.evidence[field], value);
    }
    map.set(key, prior);
  }
  let totalWeight = [...groups.values()].reduce((sum, entry) => sum + entry.weight, 0);
  const signals = Object.fromEntries(fields.filter((field) => preferences[field]?.type === 'slider').map((field) => [field,
    [...groups.values()].reduce((sum, entry) => sum + (entry.evidence[field] ?? 0), 0)]));
  // Unresolved packs are a fallback, not an invented bill of materials. Where selected
  // constituents already explain the benefit, only a stronger pack signal can fill the gap.
  for (const [family, bundle] of bundles) {
    const members = [...groups.values()].filter((entry) => policy.bundleFamilies[family].members.includes(entry.group));
    totalWeight += Math.max(0, bundle.weight - members.reduce((sum, entry) => sum + entry.weight, 0));
    for (const field of Object.keys(signals)) {
      const value = bundle.evidence[field] ?? 0;
      const represented = members.reduce((sum, entry) => sum + Math.max(0, (entry.evidence[field] ?? 0) * Math.sign(value)), 0);
      signals[field] += Math.sign(value) * Math.max(0, Math.abs(value) - represented);
    }
  }
  return { version: policy.version, kind: selection.kind, complete: selection.complete, totalWeight,
    score: 100 * totalWeight / (totalWeight + policy.halfSaturationWeight), importance: policy.importance,
    adjustment: Object.fromEntries(Object.entries(signals).map(([field, value]) => [field,
      clamp(value * policy.sliderStep, -policy.maximumAdjustment, policy.maximumAdjustment)])),
    enumEvidence: Object.fromEntries(Object.entries(enums).map(([field, values]) => [field, [...values]])),
    groups: [...groups.values(), ...bundles.values()] };
}
