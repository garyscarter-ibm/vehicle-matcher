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
// node:test's direct runner executes these eleven top-level tests in this owned process.
await import(map.entry);
