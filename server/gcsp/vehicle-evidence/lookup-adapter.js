import { boundedVehicleRead } from './provider-read.js';

/** Adapt FUCQ-55's public port in process. No self-HTTP or private registry import. */
export function createLookupVehicleAdapter({ lookup, timeoutMs, maxAttempts } = {}) {
  return Object.freeze({ resolve: boundedVehicleRead(async (request, options) => ({
    result: await lookup?.resolve?.({ kind: request.kind, id: request.id }, options),
  }), { protocol: 'in-process', timeoutMs, maxAttempts }) });
}
