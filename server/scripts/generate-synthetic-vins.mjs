import { readFile } from 'node:fs/promises';
import { allocateInventoryFile } from '../gcsp/vehicle-evidence/vin-allocation.js';

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) options[args[index]] = args[index + 1];
if (args.length !== 6 || Object.keys(options).length !== 3 || !options['--inventory'] || !options['--plan']
  || !/^(0|[1-9][0-9]*)$/.test(options['--expected-revision'] || '')) {
  process.stderr.write('Usage: node server/scripts/generate-synthetic-vins.mjs --inventory FILE --plan FILE --expected-revision N\n');
  process.exitCode = 2;
} else {
  try {
    const plan = JSON.parse(await readFile(options['--plan'], 'utf8'));
    const result = await allocateInventoryFile({ path: options['--inventory'], plan, expectedRevision: Number(options['--expected-revision']) });
    process.stdout.write(JSON.stringify({ status: result.status, reason: result.reason, revision: result.inventory?.revision,
      records: result.inventory?.records.length, collisions: result.collisions, attempts: result.attempts }) + '\n');
    process.exitCode = result.status === 'ok' ? 0 : 1;
  } catch {
    process.stderr.write('Invalid or unavailable allocation plan. Inspect the inventory revision before retrying.\n');
    process.exitCode = 1;
  }
}
