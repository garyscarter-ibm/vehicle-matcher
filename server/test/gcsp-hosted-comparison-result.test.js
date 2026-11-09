// FUCQ-288: the stored route comparison the hosted config names loads, validates and survives a presenter reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { gcspRuntimeOptions } from '../gcsp/host.js';
import { readComparisonResultFile } from '../gcsp/comparison/job.js';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_DIR = resolve(SERVER_DIR, '..');
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };

// Render runs `cd server && npm start`, so the configured value resolves from server/.
async function configuredFile() {
  const yaml = await readFile(resolve(REPO_DIR, 'render.gcsp.yaml'), 'utf8');
  const match = yaml.match(/- key: GCSP_COMPARISON_RESULT_FILE[^\n]*\n\s+value: (\S+)/);
  assert.ok(match, 'render.gcsp.yaml sets GCSP_COMPARISON_RESULT_FILE');
  return resolve(SERVER_DIR, match[1]);
}

test('the hosted config names a stored process comparison that the launcher also defaults to', async () => {
  const path = await configuredFile();
  assert.equal(path, resolve(REPO_DIR, 'server/data/gcsp/comparison/process-only.json'));
  const launcher = await readFile(resolve(REPO_DIR, 'scripts/gcsp-demo.mjs'), 'utf8');
  assert.match(launcher, /server\/data\/gcsp\/comparison\/process-only\.json/);
  const read = good(await readComparisonResultFile(path));
  assert.equal(read.kind, 'process-comparison');
  assert.equal(read.experimentId, 'process-only');
  assert.equal(read.manifest.policyVersion, 'gcsp-policy-v1');
  assert.deepEqual(read.manifest.seeds, ['comparison-a', 'comparison-b', 'comparison-c']);
});

test('the hosted runtime loads it at boot for Greg, current under the active policy, and keeps it after a reset', async (t) => {
  const path = await configuredFile();
  const { runtime: options } = gcspRuntimeOptions({ env: { GCSP_REPOSITORY_MODE: 'memory', GCSP_COMPARISON_RESULT_FILE: path }, defaultEnvironmentId: 'fucq-288-hosted', commandId: 'fucq-288-bootstrap' });
  const runtime = good(await createGcspRuntime(options));
  t.after(() => runtime.close());
  const greg = async (name) => {
    const presenter = good(await runtime.identity.createPresenterSession(`${name}-presenter`)).context;
    return { presenter, greg: good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', `${name}-greg`)).context };
  };
  const stored = good(await readComparisonResultFile(path));
  const check = async (context) => {
    const all = good(await runtime.comparison.readStored(context));
    const process = all.experiments.find((entry) => entry.experimentId === 'process-only').latest;
    assert.ok(process, 'process-only has a stored result');
    assert.deepEqual(process.result, stored);
    assert.equal(process.policyCurrent, true, `stored ${process.policyVersion}, active ${process.activePolicyVersion}`);
  };
  const before = await greg('before');
  await check(before.greg);

  const scenario = good(await runtime.scenarios.readCatalogue(before.presenter)).scenarios.find((row) => row.kind === 'mechanics');
  const state = good(await runtime.scenarios.readState(before.presenter));
  const reset = good(await runtime.scenarios.reset(before.presenter, { commandId: 'fucq-288-reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion }));
  assert.notEqual(reset.runId, state.runId);
  const after = await greg('after');
  assert.equal(after.greg.runId, reset.runId);
  await check(after.greg);
});
