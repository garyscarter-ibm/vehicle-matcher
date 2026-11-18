// Offline generator for src/test/resources/comparison-parity/experiments.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/comparison-experiment-parity.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/index.js';
import { runComparison } from '../../../../../server/gcsp/comparison/experiments.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '../resources/comparison-parity/experiments.json');
const NOW = '2026-11-08T12:00:00.000Z';
const policy = createPolicyService();
const plain = (value) => JSON.parse(JSON.stringify(value));
const basis = 'Parity test basis for an illustrative what-if value.';
const small = { 'comparison.cohortSize': 12, 'comparison.carsPerEmployee': 1 };
const seeds = ['parity-a', 'parity-b'];

// Each what-if arm runs through the real Node replay; the digest and arm and effect counts are the evidence.
const runs = [];
for (const [name, change] of [
  ['points', { value: 2, basis }],
  ['order-mix', { value: [{ modelLine: 'G20 Saloon|320i', weight: 1 }], basis }],
  ['hold-sweep', { values: [900, 86400], basis }],
]) {
  const experiment = { experimentId: name, seeds, overlay: small, change };
  const progress = [];
  const result = await runComparison(experiment, { policy, codeRevision: 'parity', now: () => NOW,
    onProgress: (step) => progress.push(plain(step)) });
  runs.push({ name, experiment, progress, resultDigest: inputDigest(result),
    result: { kind: result.kind, arms: result.arms?.length ?? 0, effects: result.effects?.length ?? 0 } });
}

const golden = { now: NOW, runs };
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(golden)}\n`);
console.log(`wrote ${outPath}`);
