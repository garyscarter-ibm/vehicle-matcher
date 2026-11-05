import { boundedVehicleRead } from './provider-read.js';
import { vehicleEvidenceFailure, VEHICLE_DETAILS_VERSION } from './vehicle-details-contract.js';
import { routedVehicleResult } from './identity-routing.js';

const kinds = { configuration: 'composition', stock: 'order', vin: 'delivered' };
const outcomes = { missing: 'not-found', unsupported: 'unsupported', unavailable: 'source-unavailable',
  mismatch: 'identity-mismatch', invalid: 'invalid-input' };

/** An intentionally fictional offline shape, not a BMW schema or a live-provider promise. */
export function createAlternateOfflineVehicleAdapter({ read, route, timeoutMs, maxAttempts } = {}) {
  return Object.freeze({ resolve: boundedVehicleRead(async (request, { context, signal }) => {
    const denied = route && await route(request, { context, signal });
    if (typeof denied === 'string') return { result: vehicleEvidenceFailure(denied, request.kind) };
    if (signal.aborted) return { result: vehicleEvidenceFailure('source-unavailable', request.kind) };
    const response = await read?.({ category: kinds[request.kind], token: request.id }, { context, signal });
    const status = response?.transportStatus;
    if (status !== undefined && status !== 200) return { transportStatus: status };
    try {
      const payload = typeof response?.document === 'string' ? JSON.parse(response.document) : response?.document;
      if (!payload || payload.edition !== 'offline-cards/1') throw new Error('Unsupported offline document');
      if (Object.hasOwn(outcomes, payload.result)) return { transportStatus: status,
        result: vehicleEvidenceFailure(outcomes[payload.result], request.kind) };
      if (!['complete', 'partial'].includes(payload.result)) throw new Error('Invalid offline result');
      const c = payload.card; const ids = c.identifiers;
      if (request.kind === 'stock') {
        if (typeof c.scope?.run !== 'string' || typeof c.scope?.environment !== 'string') throw new Error('Missing stock scope');
        if (c.scope.run !== context?.runId || c.scope.environment !== context?.environmentId) {
          return { transportStatus: status, result: vehicleEvidenceFailure('identity-mismatch', request.kind) };
        }
      }
      const result = {
        contractVersion: VEHICLE_DETAILS_VERSION, schemaVersion: '1', provider: 'alternate-offline', providerVersion: '1',
        status: payload.result, requested: c.query, resolved: c.answer,
        identity: { kind: ids.category, identityKind: ids.flavour, configurationId: ids.composition,
          vehicleId: ids.subject, datasetId: ids.collection, originatingDatasetId: ids.origin,
          orderUuid: ids.order, orderNumber: ids.displayOrder, vin: ids.chassis, usage: ids.purpose },
        versions: c.revisions, description: c.narrative,
        technical: Object.fromEntries(c.dimensions.map(({ name, reading, measure, meaning, ...evidence }) =>
          [name, { ...evidence, value: reading, unit: measure, definition: meaning }])),
        equipment: c.features,
        images: { state: c.portraits.knowledge, label: c.portraits.caption,
          items: c.portraits.pictures.map(({ reference, resource, usage, accuracy, origin, dated, caption }) => ({
            imageId: reference, asset: resource, role: usage, fidelity: accuracy, sourceKind: origin,
            observedDate: dated, label: caption,
          })) },
        source: c.evidence, completeness: c.coverage, presentation: c.labels,
        routing: { mode: 'offline', liveEligible: false }, failure: null,
      };
      return { transportStatus: status, result: await routedVehicleResult(route, request, { context, signal }, result) };
    } catch {
      return { transportStatus: status, result: vehicleEvidenceFailure('source-unavailable', request.kind) };
    }
  }, { protocol: 'offline', timeoutMs, maxAttempts }) });
}
