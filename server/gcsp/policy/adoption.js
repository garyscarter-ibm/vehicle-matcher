import { validInstant } from './file-provider.js';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from './reviewed-definitions.js';
import { policyOutcome, publishInvalid, policyUnavailable, prepareSuccessor, completePublication } from './publish.js';
import { activateRunPolicy } from './activation.js';

const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const validInput = (input) => input && typeof input === 'object' && !Array.isArray(input)
  && Object.keys(input).length === 5 && ['commandId', 'expectedActiveVersion', 'policyVersion', 'definitionSetId'].every((key) => text(input[key]))
  && validInstant(input.effectiveFrom);

export function prepareReviewedAdoption(records, context, input, now, bundle) {
  if (!validateReviewedDefinitionSet(bundle)) return { outcome: publishInvalid('definitionSetId', 'The reviewed definition set is invalid.') };
  const prepared = prepareSuccessor(records, context, input, now, { operation: 'adopt-reviewed-assumptions', input, definitionDigest: bundle.digest });
  if (prepared.outcome) return prepared;
  const existing = new Set(prepared.next.assumptions.map((row) => row.key));
  const missing = bundle.definitions.filter((row) => !existing.has(row.key));
  if (!missing.length) return { outcome: publishInvalid('definitionSetId', 'All reviewed assumption keys already exist. No successor was created.') };
  prepared.next.assumptions.push(...missing.map((row) => ({ ...structuredClone(row), policyVersion: input.policyVersion, effectiveFrom: input.effectiveFrom })));
  return completePublication(records, context, input, now, prepared, { adoption: {
    definitionSetId: bundle.definitionSetId, revision: bundle.revision, digest: bundle.digest, addedKeys: missing.map((row) => row.key),
  } });
}

// This intentional server operation has no HTTP route or browser-supplied definition rows.
export async function adoptReviewedAssumptions({ provider, identity, clock, repository, policy }, context, supplied) {
  if (typeof provider?.publish !== 'function') return policyOutcome('invalid', null, { code: 'unsupported-operation', accepted: false,
    reasons: [{ field: 'adoptReviewedAssumptions', reason: 'The file policy provider is read-only.' }] });
  let accepted;
  try {
    if (!identity || !clock) return policyUnavailable();
    const allowed = await identity.requireRole(context, 'greg');
    if (allowed.status !== 'ok') return policyOutcome(allowed.status, null, { ...allowed, accepted: false });
    let input;
    try { input = structuredClone(supplied); } catch { return publishInvalid('adoption', 'Supply a JSON adoption command.'); }
    if (!validInput(input)) return publishInvalid('adoption', 'Supply only commandId, expectedActiveVersion, new policyVersion, ISO effectiveFrom and definitionSetId.');
    const bundle = getReviewedDefinitionSet(input.definitionSetId);
    if (!bundle) return publishInvalid('definitionSetId', 'Select a reviewed definition set.');
    const instant = await clock.now(context);
    if (instant.status !== 'ok') return policyOutcome(instant.status, null, { ...instant, accepted: false });
    if (instant.value?.runId !== context.runId || !validInstant(instant.value?.now)) return policyUnavailable();
    accepted = await provider.publish({ runId: context.runId, asOf: instant.value.now }, async (records) => {
      const authorized = await identity.requireRole(context, 'greg');
      if (authorized.status !== 'ok') return { outcome: policyOutcome(authorized.status, null, { ...authorized, accepted: false }) };
      return prepareReviewedAdoption(records, context, input, instant.value.now, bundle);
    });
  } catch { return policyUnavailable(); }
  if (accepted.status !== 'ok') return accepted;
  const activated = await activateRunPolicy({ repository, policy }, context);
  return policyOutcome('ok', accepted.policyVersion, { value: { ...accepted.value, activationRequired: activated.status !== 'ok',
    activation: activated.status === 'ok' ? { status: 'active', policyVersion: activated.value.policyVersion,
      asOf: activated.value.asOf, publishedVersionActive: activated.value.policyVersion === accepted.policyVersion }
      : { status: 'pending', policyVersion: accepted.policyVersion, retryable: true,
        reason: 'Publication was saved. Retry to activate the run.', outcome: activated.status },
  } });
}
