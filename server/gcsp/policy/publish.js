import { snapshotVersions, validInstant } from './file-provider.js';
import { inputDigest } from '../repository/core.js';

export const POLICY_TABLES = Object.freeze({ schemeRuleLinks: 'scheme_rule_links', eligibilityRules: 'eligibility_rules',
  pricePlans: 'price_plans', allowances: 'grade_allowances', assumptions: 'policy_assumptions' });
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validValue = (value, previous) => {
  if (value === null || previous === null) return value === previous;
  if (typeof value !== typeof previous) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && (!Number.isInteger(previous) || Number.isSafeInteger(value));
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (Array.isArray(previous)) return Array.isArray(value) && value.every((entry) => previous.some((sample) => validValue(entry, sample)));
  if (object(previous)) return object(value) && Object.keys(value).length === Object.keys(previous).length
    && Object.keys(previous).every((key) => Object.hasOwn(value, key) && validValue(value[key], previous[key]));
  return false;
};
// A dated successor may adopt neutral employee preference multipliers without rewriting retained v1.
function validPreferenceWeightAdoption(change, previous) {
  if (change.table !== 'assumptions' || change.key !== 'employee.recommendation.v1'
    || !object(previous) || Object.hasOwn(previous, 'preferenceWeights') || !object(previous.preferences)) return false;
  const { preferenceWeights, ...retained } = change.patch.value ?? {};
  if (inputDigest(retained) !== inputDigest(previous) || !object(preferenceWeights)) return false;
  const keys = Object.keys(previous.preferences);
  return Object.keys(preferenceWeights).length === keys.length && keys.every((key) => Object.hasOwn(preferenceWeights, key)
    && Number.isSafeInteger(preferenceWeights[key]) && preferenceWeights[key] >= 0);
}
export const policyOutcome = (status, policyVersion, fields) => ({ status, ...structuredClone(fields), contractVersion: '1.0.0', policyVersion });
export const publishInvalid = (field, reason) => policyOutcome('invalid', null, {
  code: 'invalid-policy-change', accepted: false, reasons: [{ field, reason }],
});
export const policyUnavailable = () => policyOutcome('unavailable', null, {
  accepted: false, reason: 'The policy source is unavailable.', retryable: true,
});
export const acceptedPublication = (record) => policyOutcome('ok', record.seed.policyVersion, { value: {
  accepted: true, policyVersion: record.seed.policyVersion, effectiveFrom: record.seed.effectiveFrom,
  publisher: record.publisher, publishedAt: record.publishedAt, ...(record.adoption ? { adoption: record.adoption } : {}),
} });

export function validateChangeSet(input) {
  if (!object(input) || Object.keys(input).some((key) => !['commandId', 'expectedActiveVersion', 'policyVersion', 'effectiveFrom', 'changes'].includes(key))
    || !['commandId', 'expectedActiveVersion', 'policyVersion'].every((key) => text(input[key]))
    || !validInstant(input.effectiveFrom) || !Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > 100) {
    return publishInvalid('changeSet', 'Supply commandId, expectedActiveVersion, new policyVersion, ISO effectiveFrom and 1 to 100 changes.');
  }
  const seen = new Set();
  for (const change of input.changes) {
    if (!object(change) || Object.keys(change).some((key) => !['table', 'key', 'patch'].includes(key))
      || !Object.hasOwn(POLICY_TABLES, change.table) || !text(change.key) || !object(change.patch)
      || Object.keys(change.patch).length === 0 || seen.has(JSON.stringify([change.table, change.key]))) {
      return publishInvalid('changes', 'Each change names one existing collection/key and a nonempty patch, without duplicates.');
    }
    seen.add(JSON.stringify([change.table, change.key]));
    if (!['basis', 'source', 'sourceDate', 'status'].every((key) => text(change.patch[key]))) {
      return publishInvalid('changes.provenance', 'Every changed entry requires basis, source, sourceDate and assumed/verified status.');
    }
  }
  return null;
}

export function prepareSuccessor(records, context, input, now, digestInput = input) {
  let digest;
  try { digest = inputDigest({ principalId: context.principalId, input: digestInput }); }
  catch { return { outcome: publishInvalid('changeSet', 'Supply finite JSON values without cycles or unsupported types.') }; }
  const prior = records.find((record) => record.commandId === input.commandId);
  if (prior) return { outcome: prior.inputDigest === digest ? acceptedPublication(prior)
    : policyOutcome('conflict', null, { accepted: false, reason: 'idempotency-input-changed', current: {} }) };
  const active = records.map((record) => record.seed).filter((seed) => Date.parse(seed.effectiveFrom) <= Date.parse(now)
    && (seed.effectiveTo === undefined || Date.parse(now) < Date.parse(seed.effectiveTo)))
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))[0];
  if (!active || active.policyVersion !== input.expectedActiveVersion) return { outcome: policyOutcome('stale-version', active?.policyVersion ?? null, {
    accepted: false, expectedVersion: input.expectedActiveVersion, currentVersion: active?.policyVersion ?? null, action: 'refresh',
  }) };
  if (records.some(({ seed }) => seed.policyVersion === input.policyVersion)
    || Date.parse(input.effectiveFrom) < Date.parse(now)
    || records.some(({ seed }) => Date.parse(seed.effectiveFrom) >= Date.parse(input.effectiveFrom))) {
    return { outcome: publishInvalid('effectiveFrom', 'Use a new version and an effective date at or after now, later than every retained version.') };
  }
  // Append to the latest scheduled snapshot so a later publication cannot discard its changes.
  const predecessor = records.map(({ seed }) => seed).sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))[0];
  const next = structuredClone(predecessor);
  next.policyVersion = input.policyVersion;
  next.effectiveFrom = input.effectiveFrom;
  delete next.effectiveTo;
  for (const table of Object.keys(POLICY_TABLES)) for (const row of next[table]) row.policyVersion = next.policyVersion;
  return { next, predecessor, digest };
}

export function completePublication(records, context, input, now, { next, predecessor, digest }, audit = {}) {
  try { snapshotVersions([...records.map(({ seed }) => seed), next]); }
  catch { return { outcome: publishInvalid('changes', 'The complete changed policy must satisfy the seed schema, dates, references, units and provenance.') }; }
  const record = { seed: next, seedDigest: inputDigest(next), publisher: context.principalId, publishedAt: now,
    sourceVersion: predecessor.policyVersion, commandId: input.commandId, inputDigest: digest, ...audit };
  return { record, outcome: acceptedPublication(record) };
}

export function preparePublication(records, context, input, now) {
  const prepared = prepareSuccessor(records, context, input, now);
  if (prepared.outcome) return prepared;
  const { next } = prepared;
  for (const { table, key, patch } of input.changes) {
    const row = next[table].find((entry) => entry.key === key);
    const protectedFields = ['key', 'policyVersion', 'effectiveFrom', 'effectiveTo', 'linkId', 'ruleId', 'pricePlanId', 'priceEntryId', 'allowanceId'];
    if (!row || Object.keys(patch).some((field) => protectedFields.includes(field) || !Object.hasOwn(row, field))) {
      return { outcome: publishInvalid('changes.patch', 'Patch an existing entry field; identifiers and effective dates are immutable.') };
    }
    if (Object.hasOwn(patch, 'value') && !validValue(patch.value, row.value)
      && !validPreferenceWeightAdoption({ table, key, patch }, row.value)) {
      return { outcome: publishInvalid('changes.value', 'Preserve the existing value type and shape, with finite nonnegative numbers.') };
    }
    Object.assign(row, structuredClone(patch), { effectiveFrom: input.effectiveFrom });
  }
  return completePublication(records, context, input, now, prepared);
}

export async function publishPolicyVersion({ provider, identity, clock }, context, changeSet) {
  if (typeof provider?.publish !== 'function') return policyOutcome('invalid', null, {
    code: 'unsupported-operation', accepted: false, reasons: [{ field: 'publishPolicyVersion', reason: 'The file policy provider is read-only.' }],
  });
  try {
    if (!identity || !clock) return policyUnavailable();
    const allowed = await identity.requireRole(context, 'greg');
    if (allowed.status !== 'ok') return policyOutcome(allowed.status, null, { ...allowed, accepted: false });
    let input;
    try { input = structuredClone(changeSet); } catch { return publishInvalid('changeSet', 'Supply a JSON change set.'); }
    const invalid = validateChangeSet(input);
    if (invalid) return invalid;
    const instant = await clock.now(context);
    if (instant.status !== 'ok') return policyOutcome(instant.status, null, { ...instant, accepted: false });
    if (instant.value?.runId !== context.runId || !validInstant(instant.value?.now)) return policyUnavailable();
    return await provider.publish({ runId: context.runId, asOf: instant.value.now }, async (records) => {
      const authorized = await identity.requireRole(context, 'greg');
      if (authorized.status !== 'ok') return { outcome: policyOutcome(authorized.status, null, { ...authorized, accepted: false }) };
      return preparePublication(records, context, input, instant.value.now);
    });
  } catch { return policyUnavailable(); }
}
