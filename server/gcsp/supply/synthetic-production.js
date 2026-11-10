import { inputDigest, ok, result } from '../repository/core.js';

// Explicit scenario input, never a catalogue lookup, stock writer or live ordering client.
export function createSyntheticProductionAdapter({ sourceVersion, choices } = {}) {
  if (typeof sourceVersion !== 'string' || !sourceVersion || !Array.isArray(choices) || !choices.length
    || choices.some((c) => !c || typeof c.model !== 'string' || !c.model.trim()
      || typeof c.derivative !== 'string' || !c.derivative.trim())) throw new TypeError('Supply a versioned synthetic production choice set.');
  const options = structuredClone(choices).map(({ model, derivative }) => ({ model, derivative }));
  const provenance = { providerId: 'synthetic-production', mode: 'synthetic', sourceVersion,
    label: 'Production' };
  const reference = (kind, input) => `${kind}-${inputDigest(input).slice(0, 32)}`;
  return Object.freeze({
    async describe() { return ok({ choices: structuredClone(options), provenance: { ...provenance } }); },
    async submit({ runId, requestId, commandId, input }) {
      if (!options.some((c) => c.model === input.model && c.derivative === input.derivative)) return result('invalid', {
        code: 'unknown-production-choice', reasons: [{ field: 'derivative', reason: 'Choose a supplied model and derivative.' }] });
      return ok({ state: 'requested', providerReference: reference('request', [runId, requestId, commandId]), provenance: { ...provenance } });
    },
    async respond({ runId, request, input, now, expectedAt }) {
      const providerReference = reference('response', [runId, request.requestId, input.commandId]);
      return input.action === 'delay'
        ? ok({ state: 'delayed', delayUntil: input.delayUntil, reason: input.reason, providerReference, provenance: { ...provenance } })
        : ok({ state: 'confirmed', quantity: input.quantity, confirmedAt: now, expectedAt,
          supplyId: reference('supply', [runId, request.requestId, input.commandId]), providerReference, provenance: { ...provenance } });
    },
  });
}
