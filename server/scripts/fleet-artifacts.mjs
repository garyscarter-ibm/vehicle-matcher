#!/usr/bin/env node
import { packFleetRelease, restoreFleetRelease } from '../gcsp/vehicle-evidence/fleet-artifacts.js';
const [command, ...args] = process.argv.slice(2); const flags = new Map(); let step = 'arguments';
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--release', '--store', '--cache', '--output', '--network'].includes(args[i]) || flags.has(args[i]) || !args[i + 1]) throw new TypeError('Invalid arguments');
    flags.set(args[i], args[i + 1]);
  }
  if (!flags.has('--release') || !flags.has('--store')) throw new TypeError('Invalid arguments');
  // Existing dashboard commands can retain an older release than the Blueprint.
  let releaseId = flags.get('--release');
  if (command === 'restore' && flags.get('--network') === 'download') {
    step = 'resolve-release';
    const { resolveFleetBuildRelease } = await import('./prepare-fleet-build.mjs');
    releaseId = await resolveFleetBuildRelease() ?? releaseId;
  }
  step = command;
  const result = command === 'pack' && flags.has('--output')
    ? await packFleetRelease({ releaseId, store: flags.get('--store'), output: flags.get('--output') })
    : command === 'restore' && flags.has('--cache') && ['offline', 'download'].includes(flags.get('--network'))
      ? await restoreFleetRelease({ releaseId, store: flags.get('--store'), cacheRoot: flags.get('--cache'), offline: flags.get('--network') === 'offline' })
      : null;
  if (!result) { step = 'arguments'; throw new TypeError('Invalid arguments'); }
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (e) {
  // One URL-free JSON line: where it failed and why, so the build log shows the cause.
  const fsCode = typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(e.code) ? e.code : undefined;
  const code = e?.artifactCode ?? fsCode ?? (step === 'arguments' ? 'invalid-arguments' : 'unexpected');
  const reason = typeof e?.message === 'string' && !e.message.includes('://') && e.artifactCode !== 'download-failed' ? e.message : undefined;
  const report = { status: 'artifact-release-failed', step: e?.step ?? step, code, httpStatus: e?.httpStatus, attempts: e?.attempts, asset: e?.asset, detail: e?.detail, reason,
    failure: 'Check approved release, explicit absolute paths, pinned bytes and offline cache. Existing selection is preserved on rejected candidates.' };
  process.stdout.write(JSON.stringify(report) + '\n'); process.exitCode = 1;
}
