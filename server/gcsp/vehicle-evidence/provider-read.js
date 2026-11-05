import { vehicleEvidenceFailure } from './vehicle-details-contract.js';

/** One finite, cancellable provider read. This module has no network capability. */
export function boundedVehicleRead(read, { protocol, timeoutMs = 1000, maxAttempts = 1 } = {}) {
  if (typeof read !== 'function' || !['in-process', 'offline'].includes(protocol)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2) {
    throw new TypeError('Configure a vehicle provider with a finite timeout and one or two attempts.');
  }
  return async (request, options = {}) => {
    let transport;
    for (let attempts = 1; attempts <= maxAttempts; attempts++) {
      const controller = new AbortController(); let timer;
      transport = { protocol, status: null, attempts, outcome: 'unavailable' };
      try {
        const response = await Promise.race([
          Promise.resolve().then(() => read(structuredClone(request), { ...options, signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => {
            controller.abort(); reject(new Error('Vehicle provider deadline exceeded'));
          }, timeoutMs); }),
        ]);
        if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid provider envelope');
        const status = response.transportStatus;
        if (status !== undefined && (!Number.isInteger(status) || status < 100 || status > 599)) throw new Error('Invalid transport status');
        transport.status = status ?? null;
        if (status !== undefined && status !== 200) throw new Error('Provider transport did not succeed');
        transport.outcome = 'answered';
        return { transport, result: structuredClone(response.result) };
      } catch {
        controller.abort();
      } finally {
        clearTimeout(timer);
      }
    }
    return { transport, result: vehicleEvidenceFailure('source-unavailable', request?.kind) };
  };
}
