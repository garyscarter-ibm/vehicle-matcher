import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPolicyService } from '../policy/index.js';
import { createSyntheticRegistry } from './synthetic-registry.js';
import { createVehicleEvidenceLookup } from './vehicle-lookup.js';

export const DEFAULT_VEHICLE_CORPUS_ROOT = fileURLToPath(new URL('../../data/gcsp/vehicle-evidence/lookup-reference.v1', import.meta.url));

/** Only reads an already-published local store; there is no runtime publish/generator/transport capability. */
export function createLocalVehicleEvidenceLookup({ root = DEFAULT_VEHICLE_CORPUS_ROOT, repository,
  policyService = createPolicyService(), asOf = new Date().toISOString() } = {}) {
  const registry = createSyntheticRegistry({ root: resolve(root), policyService,
    policyRead: { runId: 'local-vehicle-evidence', asOf } });
  const loaded = registry.load();
  const lookup = createVehicleEvidenceLookup({ registry, repository });
  return Object.freeze({
    async resolve(request, options) { await loaded; return lookup.resolve(request, options); },
  });
}
