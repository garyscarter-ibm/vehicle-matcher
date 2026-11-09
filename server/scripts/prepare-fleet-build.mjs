import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fleetReleases } from '../gcsp/vehicle-evidence/fleet-release.js';

// Some existing Render services retain an npm-only dashboard build command.
// Prepare the same code-approved release at install time for this GCSP service.
// Lookup and application startup retain their existing offline contract.
export async function resolveFleetBuildRelease({ env = process.env, config } = {}) {
  if (env.RENDER !== 'true' || env.RENDER_SERVICE_ID !== 'srv-dbm9cim1egvs73bo6g5g') {
    return null;
  }
  config ??= await readFile(new URL('../../render.gcsp.yaml', import.meta.url), 'utf8');
  const api = config.split('name: gcsp-api')[1]?.split('name: gcsp-site')[0] || '';
  const pins = [...api.matchAll(/--release ([a-f0-9]{64})(?=\s|$)/g)];
  if (pins.length !== 1 || !fleetReleases.some((r) => r.releaseId === pins[0][1])) {
    throw new TypeError('GCSP build requires one code-approved release pin');
  }
  return pins[0][1];
}

export async function prepareFleetBuild({ env = process.env, config, restore } = {}) {
  const releaseId = await resolveFleetBuildRelease({ env, config });
  if (releaseId === null) return { status: 'not-gcsp-render-build' };
  if (env.GCSP_FLEET_BUILD_EXPLICIT === '1') return { status: 'explicit-build-restore' };
  restore ??= (await import('../gcsp/vehicle-evidence/fleet-artifacts.js')).restoreFleetRelease;
  const result = await restore({ releaseId, offline: false,
    store: fileURLToPath(new URL('../data/gcsp/vehicle-evidence/fleet-source.v1', import.meta.url)),
    cacheRoot: fileURLToPath(new URL('../data/gcsp/vehicle-evidence/fleet-artifacts.v1', import.meta.url)) });
  if (result.status !== 'ok' || result.active?.manifestDigest !== releaseId) {
    throw new TypeError('GCSP build did not activate its pinned fleet');
  }
  return { status: 'prepared', manifestDigest: releaseId };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(await prepareFleetBuild())); }
  catch { console.error('GCSP pinned fleet build preparation failed'); process.exitCode = 1; }
}
