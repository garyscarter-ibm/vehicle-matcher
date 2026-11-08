import { releaseLimits, DEFAULT_ARTIFACT_ROOT } from './fleet-release.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
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
  const started = performance.now();
  const elapsedMs = () => Math.max(0, Math.round(performance.now() - started));
  let readiness = { status: 'loading', manifestDigest: null, recovered: false };
  const loaded = registry.load().then((result) => {
    const current = registry.status();
    const ready = current.status === 'ok';
    const code = result?.failure?.code;
    readiness = { status: ready ? 'ready' : 'unavailable', elapsedMs: elapsedMs(),
      manifestDigest: ready ? current.active.manifestDigest : null, recovered: result?.recovered === true,
      ...(!ready ? { code: typeof code === 'string' && /^[a-z0-9-]{1,64}$/.test(code) ? code : 'corpus-unavailable' } : {}) };
  }).catch(() => {
    readiness = { status: 'unavailable', elapsedMs: elapsedMs(), manifestDigest: null,
      recovered: false, code: 'corpus-unavailable' };
  });
  const lookup = createVehicleEvidenceLookup({ registry, repository });
  return Object.freeze({
    readiness() { return { ...readiness, elapsedMs: readiness.elapsedMs ?? elapsedMs() }; },
    async resolve(request, options) { await loaded; return lookup.resolve(request, options); },
    async classifyRequest(request, options) { await loaded; return lookup.classifyRequest(request, options); },
  });
}
