import { releaseLimits, DEFAULT_ARTIFACT_ROOT } from './fleet-release.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPolicyService, FilePolicyProvider } from '../policy/index.js';
import { createSyntheticRegistry } from './synthetic-registry.js';
import { createVehicleEvidenceLookup } from './vehicle-lookup.js';
import { APPROVED_CORPUS_IMAGES } from './registered-corpus-images.js';

export const DEFAULT_VEHICLE_CORPUS_ROOT = fileURLToPath(new URL('../../data/gcsp/vehicle-evidence/fleet-source.v1', import.meta.url));

/** Only reads an already-published local store; there is no runtime publish/generator/transport capability. */
export function createLocalVehicleEvidenceLookup({ root = DEFAULT_VEHICLE_CORPUS_ROOT, repository,
  policyService = createPolicyService({ provider: new FilePolicyProvider() }), asOf = new Date().toISOString(), artifactRoot = DEFAULT_ARTIFACT_ROOT } = {}) {
  const registry = createSyntheticRegistry({ root: resolve(root), policyService, approvedImages: APPROVED_CORPUS_IMAGES,
    jsonlLimitsForManifest: releaseLimits, sourceArtifactRoot: artifactRoot,
    policyRead: { runId: 'local-vehicle-evidence', asOf } });
  const loaded = registry.load();
  const lookup = createVehicleEvidenceLookup({ registry, repository });
  return Object.freeze({
    async resolve(request, options) { await loaded; return lookup.resolve(request, options); },
    async classifyRequest(request, options) { await loaded; return lookup.classifyRequest(request, options); },
  });
}
