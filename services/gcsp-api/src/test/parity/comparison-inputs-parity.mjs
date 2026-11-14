// Offline generator for src/test/resources/comparison-parity/inputs.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/comparison-inputs-parity.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/index.js';
import { ComparisonInputError, generateComparisonInputs, loadComparisonPolicy } from '../../../../../server/gcsp/comparison/generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '../resources/comparison-parity/inputs.json');
const small = { 'comparison.cohortSize': 12, 'comparison.carsPerEmployee': 1 };
const service = createPolicyService();
const probe = await service.getAssumption('comparison.startsAt', { runId: 'comparison-experiment-preparation', asOf: '2026-11-05T09:00:00.000Z' });
const policy = await loadComparisonPolicy({ policyService: service,
  policyRead: { runId: 'comparison-experiment-preparation', asOf: probe.value.value } });
const lines = policy.configurations.map((row) => row.modelLine);

const cases = [
  { name: 'small-a', seed: 'comparison-a', overlay: small },
  { name: 'small-b', seed: 'comparison-b', overlay: small },
  { name: 'integer-seed', seed: 7, overlay: small },
  { name: 'rounding-half-up', seed: 'comparison-c', overlay: { 'comparison.cohortSize': 5, 'comparison.carsPerEmployee': 0.5 } },
  { name: 'model-line-mix', seed: 'comparison-a',
    overlay: { ...small, 'comparison.modelLineMix': [{ modelLine: lines[1], weight: 3 }, { modelLine: lines[2], weight: 1 }] } },
  { name: 'points-multiplier', seed: 'comparison-b', overlay: { ...small, 'comparison.pointsAllowanceMultiplier': 1.2 } },
  { name: 'hold-buddy', seed: 'comparison-a', overlay: { ...small, 'hold.buddy.durationSeconds': 14400 } },
  { name: 'noise-and-uptake', seed: 'noise', overlay: { ...small, 'comparison.briefNoise.v1': { accuratePreferenceProbability: 0.3, preserveEssentials: true },
    'comparison.buddyUptake': 0.5 } },
  { name: 'unknown-key', seed: 'comparison-a', overlay: { 'comparison.nope': 1 } },
  { name: 'grade-overlay', seed: 'comparison-a', overlay: { 'comparison.gradeDistribution': [] } },
  { name: 'empty-seed', seed: '', overlay: small },
  { name: 'fractional-seed', seed: 1.5, overlay: small },
  { name: 'cohort-over-maximum', seed: 'comparison-a', overlay: { 'comparison.cohortSize': 100001 } },
  { name: 'cars-over-maximum', seed: 'comparison-a', overlay: { 'comparison.cohortSize': 60000, 'comparison.carsPerEmployee': 1 } },
  { name: 'unknown-model-line', seed: 'comparison-a', overlay: { ...small, 'comparison.modelLineMix': [{ modelLine: 'No such line', weight: 1 }] } },
  { name: 'zero-weight-mix', seed: 'comparison-a', overlay: { ...small, 'comparison.modelLineMix': [{ modelLine: lines[0], weight: 0 }] } },
  { name: 'negative-buddy-hold', seed: 'comparison-a', overlay: { ...small, 'hold.buddy.durationSeconds': -1 } },
  { name: 'late-release', seed: 'comparison-a', overlay: { ...small, 'comparison.releaseCadence': { firstReleaseDay: 0, intervalDays: 100, batchSize: 1 } } },
];

const records = cases.map(({ name, seed, overlay }) => {
  try {
    const output = generateComparisonInputs(seed, policy, { overlay });
    const { manifest } = output;
    return { name, seed, overlay, ok: {
      inputHash: manifest.inputHash, policyHash: manifest.policyHash, configurationHash: manifest.configurationHash,
      overlayHash: manifest.overlayHash, counts: manifest.counts, outputDigest: inputDigest(output) } };
  } catch (error) {
    if (!(error instanceof ComparisonInputError)) throw error;
    return { name, seed, overlay, error: { code: error.code, key: error.key } };
  }
});
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify({ policyVersion: policy.policyVersion, startsAt: policy.assumptions['comparison.startsAt'].value, cases: records }, null, 1)}\n`);
console.log(`wrote ${records.length} cases to ${outPath}`);
