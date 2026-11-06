// Reviewed launch barrier: register the frozen loader only after parent ownership/RAM sampling.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { register } from 'node:module';

await new Promise((resolve, reject) => {
  process.stdin.once('data', (chunk) => {
    process.stdin.pause();
    if (chunk.toString() === '1') resolve(); else reject(Error('Invalid owned launch barrier.'));
  });
  process.stdin.once('end', () => reject(Error('Owned launch barrier was not released.')));
  process.stdin.once('error', reject);
});
const path = process.env.FUCQ102_FOLLOWUP_MODULE_MAP;
const data = readFileSync(path);
if (createHash('sha256').update(data).digest('hex') !== process.env.FUCQ102_FOLLOWUP_MAP_SHA256) throw Error('Frozen module map differs.');
const map = JSON.parse(data);
register(new URL('./loader.mjs', import.meta.url), { parentURL: import.meta.url,
  data: { path, sha256: process.env.FUCQ102_FOLLOWUP_MAP_SHA256 } });
// Direct assertion cases give the child the first-failure boundary itself.
// No subsequent case is invoked while a parent reacts to buffered output.
const { followupEntryCases: cases } = await import(map.entry);
if (!Array.isArray(cases) || cases.length !== map.selectedCases.length
  || cases.some((entry, index) => entry.name !== map.selectedCases[index] || typeof entry.run !== 'function')) {
  throw Error('Frozen assertion case names/order differ.');
}
const write = (line) => process.stdout.write(`${line}\n`);
let executed = 0; let failures = 0;
const started = performance.now();
write('TAP version 13');
for (const entry of cases) {
  const cleanup = []; let failure; let failed = false;
  write(`# Subtest: ${entry.name}`);
  try {
    await entry.run(Object.freeze({ after(action) {
      if (typeof action !== 'function') throw Error('Case cleanup must be a function.');
      cleanup.push(action);
    } }));
  } catch (error) { failure = error; failed = true; }
  finally {
    for (const action of cleanup.reverse()) {
      try { await action(); } catch (error) { if (!failed) failure = error; failed = true; }
    }
  }
  executed += 1;
  if (failed) {
    failures += 1;
    write(`not ok ${executed} - ${entry.name}`);
    write('  ---');
    // Assertions compare safe DTO fields/digests; never serialize fixture state.
    write(`  name: ${JSON.stringify(String(failure?.name ?? 'Error').slice(0, 128))}`);
    write(`  message: ${JSON.stringify(String(failure?.message ?? failure).slice(0, 4096))}`);
    write(`  stack: ${JSON.stringify(String(failure?.stack ?? '').slice(0, 8192))}`);
    write('  ...');
    break;
  }
  write(`ok ${executed} - ${entry.name}`);
}
write(`1..${executed}`);
for (const [key, value] of Object.entries({ tests: executed, pass: executed - failures, fail: failures,
  cancelled: 0, skipped: 0, todo: 0 })) write(`# ${key} ${value}`);
write(`# duration_ms ${performance.now() - started}`);
if (failures || executed !== map.selectedCases.length) process.exitCode = 1;
