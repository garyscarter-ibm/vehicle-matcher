// Reviewed policy maps selected capabilities, never dictionary availability, to preference evidence.
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['sportiness', 'comfort', 'economy', 'size', 'body', 'fuel'];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const stronger = (left = 0, right = 0) => Math.abs(right) > Math.abs(left)
  || Math.abs(right) === Math.abs(left) && right < left ? right : left;
const codes = (value) => Array.isArray(value) && value.every((code) => typeof code === 'string' && /^[A-Z0-9]+$/.test(code));
const RESULT_LIMIT = 256;
const ADMISSION_LIMIT = 8;

let immutableGraphs = new WeakSet();
let policyIdentities = new WeakMap();
let tokenAdmissions = new WeakMap();
let admissions = new Map();
let results = new Map();
let nextTokenId = 1;
let counters = { validations: 0, derivations: 0, hits: 0, evictions: 0, admissionEvictions: 0 };

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

function frozenJsonGraph(value, visiting = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)) return true;
  if (!value || typeof value !== 'object') return false;
  if (immutableGraphs.has(value)) return true;
  if (!Object.isFrozen(value) || visiting.has(value)) return false;
  visiting.add(value);
  const array = Array.isArray(value);
  if (array ? Object.getPrototypeOf(value) !== Array.prototype
    : ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  if (array) {
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !frozenJsonGraph(descriptor.value, visiting)) return false;
    }
  } else {
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !frozenJsonGraph(descriptor.value, visiting)) return false;
    }
  }
  visiting.delete(value);
  immutableGraphs.add(value);
  return true;
}

function cacheableSelection(selection) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(selection))) return false;
  if (!['kind', 'complete', 'codes'].every((key) => Object.hasOwn(selection, key))) return false;
  if ('activeCodes' in selection && !Object.hasOwn(selection, 'activeCodes')) return false;
  if (['kind', 'complete', 'codes', 'activeCodes'].filter((key) => Object.hasOwn(selection, key)).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(selection, key);
    return !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value');
  })) return false;
  const arrays = [selection.codes, ...(selection.activeCodes === undefined ? [] : [selection.activeCodes])];
  return arrays.every((array) => Object.getPrototypeOf(array) === Array.prototype
    && Reflect.ownKeys(array).length === array.length + 1
    && Array.from({ length: array.length }, (_, index) => Object.getOwnPropertyDescriptor(array, String(index)))
      .every((descriptor) => descriptor?.enumerable && Object.hasOwn(descriptor, 'value')));
}

function identityToken(policy, preferences) {
  const byPreference = policyIdentities.get(policy);
  const token = byPreference?.get(preferences);
  const reference = token && tokenAdmissions.get(token);
  const admission = reference?.deref();
  if (!admission?.active) return null;
  admissions.delete(admission.key);
  admissions.set(admission.key, admission);
  return token;
}

function rememberIdentity(policy, preferences, token, admission) {
  let byPreference = policyIdentities.get(policy);
  if (!byPreference) { byPreference = new WeakMap(); policyIdentities.set(policy, byPreference); }
  byPreference.set(preferences, token);
  tokenAdmissions.set(token, new WeakRef(admission));
}

function admit(policy, preferences) {
  if (!policy || typeof policy !== 'object' || !preferences || typeof preferences !== 'object'
    || !frozenJsonGraph(policy) || !frozenJsonGraph(preferences)) return null;
  const identity = identityToken(policy, preferences);
  if (identity) return identity;
  const key = JSON.stringify([policy, preferences]);
  let admission = admissions.get(key);
  if (admission) {
    admissions.delete(key);
    admissions.set(key, admission);
    rememberIdentity(policy, preferences, admission.token, admission);
    return admission.token;
  }
  counters.validations++;
  validatePolicy(policy, preferences);
  const token = { id: nextTokenId++ };
  admission = { key, token, active: true };
  admissions.set(key, admission);
  rememberIdentity(policy, preferences, token, admission);
  if (admissions.size > ADMISSION_LIMIT) {
    const oldestKey = admissions.keys().next().value;
    admissions.get(oldestKey).active = false;
    admissions.delete(oldestKey);
    counters.admissionEvictions++;
  }
  return token;
}

function validateSelection(selection) {
  return object(selection) && ['selected-catalogue', 'verified-fitted'].includes(selection.kind)
    && codes(selection.codes) && typeof selection.complete === 'boolean'
    && (selection.activeCodes === undefined || codes(selection.activeCodes)
      && selection.activeCodes.every((code) => selection.codes.includes(code)));
}

function selectionSignature(selection) {
  return JSON.stringify([selection.kind, selection.complete, [...new Set(selection.codes)].sort(),
    [...new Set(selection.activeCodes ?? [])].sort()]);
}

function deriveOptionEvidence(selection, policy, preferences) {
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

/** Null means the specification is unknown, not an evidenced basic car. */
export function scoreOptionEvidence(selection, policy, preferences) {
  if (policy === undefined) return null; // Existing pinned policies retain their original calculation.
  const token = admit(policy, preferences);
  if (!token) {
    counters.validations++;
    validatePolicy(policy, preferences);
  }
  if (!validateSelection(selection)) return null;
  const signature = token && cacheableSelection(selection) ? selectionSignature(selection) : null;
  const key = signature === null ? null : `${token.id}\u0000${signature}`;
  if (key !== null && results.has(key)) {
    const result = results.get(key);
    results.delete(key);
    results.set(key, result);
    counters.hits++;
    return structuredClone(result);
  }
  counters.derivations++;
  const result = deriveOptionEvidence(selection, policy, preferences);
  if (key === null) return result;
  results.set(key, result);
  if (results.size > RESULT_LIMIT) {
    results.delete(results.keys().next().value);
    counters.evictions++;
  }
  return structuredClone(result);
}

export function resetOptionEvidenceCache() {
  immutableGraphs = new WeakSet();
  policyIdentities = new WeakMap();
  tokenAdmissions = new WeakMap();
  admissions.clear();
  results.clear();
  nextTokenId = 1;
  counters = { validations: 0, derivations: 0, hits: 0, evictions: 0, admissionEvictions: 0 };
}

export function optionEvidenceCacheStats() {
  return { ...counters, size: results.size, admissionSize: admissions.size,
    limits: { results: RESULT_LIMIT, admissions: ADMISSION_LIMIT } };
}
