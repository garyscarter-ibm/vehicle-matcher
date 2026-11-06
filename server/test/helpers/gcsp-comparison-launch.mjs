import { readSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const gate = Buffer.alloc(1);
if (readSync(0, gate, 0, 1, null) !== 1 || gate[0] !== 49) throw new Error('Supervisor gate refused');
const [guard, manifest, testFile] = process.argv.slice(2);
const frozen = JSON.parse(readFileSync(manifest, 'utf8'));
await (await import(pathToFileURL(guard).href)).installComparisonGuard(frozen);
globalThis.comparisonCodeRevision = frozen.codeRevision;
await import(pathToFileURL(testFile).href);
