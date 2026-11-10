import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createReplayPolicy } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027/server/gcsp/comparison/job.js';
import { loadComparisonPolicy, generateComparisonInputs } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027/server/gcsp/comparison/generator.js';
import { validateExperiment } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027/server/gcsp/comparison/experiments.js';
import { inputDigest } from '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027/server/gcsp/repository/core.js';
const policy = createReplayPolicy();
try {
  const plan = await validateExperiment({ experimentId: 'process-only' }, { policy, now: () => '2026-11-10T12:00:00.000Z' });
  assert.deepEqual(plan, { experimentId: 'process-only', seeds: ['comparison-a', 'comparison-b', 'comparison-c'], arms: [{ armId: 'process', value: null, overlay: {} }], steps: 6 });
  const probe = await policy.getAssumption('comparison.startsAt', { runId: 'comparison-experiment-preparation', asOf: '2026-11-10T12:00:00.000Z' });
  assert.equal(probe.status, 'ok');
  const snapshot = await loadComparisonPolicy({ policyService: policy, policyRead: { runId: 'comparison-experiment-preparation', asOf: probe.value.value } });
  const seeds = [];
  for (const seed of plan.seeds) {
    const inputs = generateComparisonInputs(seed, snapshot);
    assert.equal(inputs.employees.length, 1000);
    seeds.push({ seed, inputHash: inputs.manifest.inputHash, policyHash: inputs.manifest.policyHash,
      generatorVersion: inputs.manifest.generatorVersion, policyVersion: inputs.manifest.policyVersion,
      employees: inputs.employees.length, cars: inputs.stock.length, releases: inputs.releaseSchedule.length,
      accessGroups: [...new Set(inputs.employees.map((row) => row.accessGroup))].sort() });
  }
  const output = { generatedAt: new Date().toISOString(), preflightOnly: true, noWorkerOrReplay: true,
    plan, policyVersion: seeds[0].policyVersion, policyHash: seeds[0].policyHash, generatorVersion: seeds[0].generatorVersion,
    snapshotDigest: inputDigest(snapshot), seeds };
  await writeFile(new URL('./canonical-inputs.json', import.meta.url), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ preflight: 'pass', plan, seeds }));
} finally { await policy.close(); }
