#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runComparisonCli } from '../server/gcsp/comparison/job.js';

// Offline and explicit: nothing runs when this file is imported, only when it is the command.
export async function main(argv = process.argv.slice(2)) {
  const { exitCode } = await runComparisonCli({ argv });
  process.exitCode = exitCode;
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) await main();
