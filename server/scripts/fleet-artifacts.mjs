#!/usr/bin/env node
import { packFleetRelease, restoreFleetRelease } from '../gcsp/vehicle-evidence/fleet-artifacts.js';
const [command, ...args] = process.argv.slice(2); const flags = new Map();
try {
  for (let i = 0; i < args.length; i += 2) {
    if (!['--release', '--store', '--cache', '--output', '--network'].includes(args[i]) || flags.has(args[i]) || !args[i + 1]) throw new TypeError();
    flags.set(args[i], args[i + 1]);
  }
  if (!flags.has('--release') || !flags.has('--store')) throw new TypeError();
  const result = command === 'pack' && flags.has('--output')
    ? await packFleetRelease({ releaseId: flags.get('--release'), store: flags.get('--store'), output: flags.get('--output') })
    : command === 'restore' && flags.has('--cache') && ['offline', 'download'].includes(flags.get('--network'))
      ? await restoreFleetRelease({ releaseId: flags.get('--release'), store: flags.get('--store'), cacheRoot: flags.get('--cache'), offline: flags.get('--network') === 'offline' })
      : null;
  if (!result) throw new TypeError(); process.stdout.write(JSON.stringify(result) + '\n');
} catch { process.stdout.write(JSON.stringify({ status: 'artifact-release-failed', failure: 'Check approved release, explicit absolute paths, pinned bytes and offline cache. Existing selection is preserved on rejected candidates.' }) + '\n'); process.exitCode = 1; }
