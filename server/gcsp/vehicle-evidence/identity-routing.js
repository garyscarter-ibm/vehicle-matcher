import { isValidAllocationInventory } from './vin-allocation.js';
import { vehicleEvidenceFailure } from './vehicle-details-contract.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unavailable = () => ({ status: 'source-unavailable', identityKind: 'unknown', liveEligible: false });
const mismatch = () => ({ status: 'identity-mismatch', identityKind: 'unknown', liveEligible: false });
const known = (row) => ({ status: 'ok', identityKind: 'synthetic', liveEligible: false,
  configurationId: row.configurationId, ...(row.vehicleId ? { vehicleId: row.vehicleId } : {}) });

/** Server-owned classification only. Format checks never grant routing permission. */
export async function classifyVehicleEvidenceRequest({ registry, repository }, request, { context } = {}) {
  try {
    if (['vin', 'configuration'].includes(request.kind)) {
      const classified = await (request.kind === 'vin' ? registry?.classifyIdentity?.(request.id)
        : registry?.classifyConfiguration?.(request.id));
      // An empty/unselected store is unavailable, never proof of a valid empty corpus.
      // Retained synthetic classification stays authoritative even when facts are inactive.
      if (classified?.status === 'not-found' && registry?.status?.().status === 'source-unavailable') return unavailable();
      return classified || unavailable();
    }
    if (request.kind !== 'stock' || !object(context) || typeof context.environmentId !== 'string'
      || typeof context.runId !== 'string') return unavailable();
    const current = await repository?.currentRun?.(context.environmentId);
    if (current?.status !== 'ok') return unavailable();
    if (current.value?.runId !== context.runId) return mismatch();
    const retained = current.value.versions?.syntheticIdentityInventory;
    const inventory = retained?.snapshot;
    if (!isValidAllocationInventory(inventory) || retained.revision !== inventory.revision
      || retained.contentDigest !== inventory.contentDigest) return unavailable();
    const row = inventory.records.find((r) => r.orderUuid === request.id);
    if (!row) return { status: 'not-found', identityKind: 'unknown', liveEligible: false };
    if (row.runId !== context.runId || row.usage !== 'stock') return mismatch();
    const configuration = await registry?.classifyConfiguration?.(row.configurationId);
    if (configuration?.status !== 'ok' || configuration.identityKind !== 'synthetic') return unavailable();
    return known(row);
  } catch { return unavailable(); }
}

/** Called inside each bounded adapter attempt, before its offline provider. There
 * is deliberately no live branch, caller URL, redirect or not-found fallback. */
export function createVehicleIdentityRouting({ identityLookup, provider } = {}) {
  if (!['lookup', 'alternate-offline'].includes(provider)) throw new TypeError('Unsupported configured vehicle provider.');
  const classify = typeof identityLookup?.classifyRequest === 'function'
    ? identityLookup.classifyRequest.bind(identityLookup) : null;
  return async (request, options) => {
    if (!classify) return 'source-unavailable';
    try {
      const result = await classify(request, options);
      if (!object(result) || result.liveEligible !== false) return 'source-unavailable';
      if (result.status === 'identity-mismatch') return 'identity-mismatch';
      if (result.status === 'ok' && result.identityKind === 'synthetic') return result;
      // A closed synthetic lookup may answer a genuine miss offline. A miss is
      // never positive evidence of a real VIN or permission to forward it.
      if (result.status === 'not-found' && result.identityKind === 'unknown') return 'not-found';
      return 'source-unavailable';
    } catch { return 'source-unavailable'; }
  };
}

/** Recheck the same authority after a provider read, including an alternate
 * provider spanning a reset. Providers cannot replace an immutable association. */
export async function routedVehicleResult(route, request, options, result) {
  if (!route || !['complete', 'partial'].includes(result?.status)) return result;
  const binding = await route(request, options);
  if (typeof binding === 'string') return vehicleEvidenceFailure(binding, request.kind);
  if (!binding || result.identity?.identityKind !== 'synthetic'
    || binding.configurationId !== result.identity.configurationId
    || binding.vehicleId !== undefined && binding.vehicleId !== result.identity.vehicleId) {
    return vehicleEvidenceFailure('identity-mismatch', request.kind);
  }
  return result;
}
