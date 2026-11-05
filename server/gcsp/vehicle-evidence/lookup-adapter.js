import { boundedVehicleRead } from './provider-read.js';
import { vehicleEvidenceFailure } from './vehicle-details-contract.js';
import { routedVehicleResult } from './identity-routing.js';

/** Adapt FUCQ-55's public port in process. No self-HTTP or private registry import. */
export function createLookupVehicleAdapter({ lookup, route, timeoutMs, maxAttempts } = {}) {
  return Object.freeze({ resolve: boundedVehicleRead(async (request, options) => {
    const denied = route && await route(request, options);
    if (typeof denied === 'string') return { result: vehicleEvidenceFailure(denied, request.kind) };
    if (options.signal.aborted) return { result: vehicleEvidenceFailure('source-unavailable', request.kind) };
    const result = await lookup?.resolve?.({ kind: request.kind, id: request.id }, options);
    return { result: await routedVehicleResult(route, request, options, result) };
  }, { protocol: 'in-process', timeoutMs, maxAttempts }) });
}
