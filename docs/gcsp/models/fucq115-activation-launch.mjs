// Keep the direct child alive until its PID/start is externally recorded.
// The parent opens this gate only after strict process/RSS/ledger sampling.
import { readSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const gate = Buffer.alloc(1);
if (process.argv.length !== 5 || readSync(0, gate, 0, 1, null) !== 1 || gate[0] !== 49) {
  throw new Error('Activation launch gate refused');
}
process.argv.splice(1, 1);
await import(pathToFileURL(process.argv[1]).href);
