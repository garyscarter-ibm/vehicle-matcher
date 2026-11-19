// FUCQ-92: the run-level stock source. Memory repository, no network, no PostgreSQL URL.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { ok, result } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createRunStockProvider } from '../gcsp/stock/index.js';
import { provider } from './helpers/employee-recommendation.js';
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const roots = [];
after(async () => { for (const directory of roots) await rm(directory, { recursive: true, force: true }); });
const quiet = () => {};

test('a repository read failure is unavailable and cached nothing; a recovered read then decides once', async () => {
  const policy = createPolicyService();
  const run = { runId: 'flaky-run', clockInstant: '2026-11-05T09:00:00.000Z', policyVersion: 'gcsp-policy-v1', versions: {} };
  let mode = 'fail-query'; let generations = 0;
  const repository = {
    async read() { return mode === 'throw' ? Promise.reject(new Error('boom')) : ok(run); },
    async query() { return mode === 'fail-query' ? result('unavailable', { retryable: true }) : ok([]); },
  };
  const generation = { async generate() { generations += 1; return result('unavailable', { code: 'later' }); } };
  const provider = createRunStockProvider({ policy, repository, generation, logger: quiet,
    contextForRun: (runId) => ({ runId, environmentId: 'e', principalId: 'p', roles: ['presenter'] }) });
  const request = { runId: 'flaky-run', asOf: '2026-11-05T09:30:00.000Z', policyVersion: 'gcsp-policy-v1', releaseSize: 20, released: [], queuedSupply: [] };
  assert.equal((await provider.pull(request)).status, 'unavailable');
  assert.equal(provider.describe('flaky-run'), null); assert.equal(generations, 0);
  mode = 'throw';
  assert.equal((await provider.prepareRun('flaky-run')).status, 'unavailable'); assert.equal(generations, 0);
  mode = 'ok';
  assert.equal((await provider.prepareRun('flaky-run')).value.source, 'demo');
  assert.equal(generations, 1);
  assert.equal((await provider.pull(request)).value.tranche.windowId, 'demo-release-1');
  await provider.prepareRun('flaky-run');
  assert.equal(generations, 1, 'the decision is cached per run');
});

test('a scenario that declares published demo stock keeps the demo provider and its release cue', async () => {
  let asked = 0;
  const run = { runId: 'scenario-run', clockInstant: '2026-11-05T09:00:00.000Z', policyVersion: 'gcsp-policy-v1',
    versions: { scenarioSelection: { scenarioId: 'offer-expires' } } };
  const repository = { read: async () => ok(run), query: async () => ok([]) };
  const provider = createRunStockProvider({ policy: createPolicyService(), repository,
    contextForRun: (runId) => ({ runId, environmentId: 'e', principalId: 'p', roles: ['presenter'] }),
    generation: { generate: async () => { asked += 1; return ok({}); } } });
  const decided = good(await provider.prepareRun('scenario-run'));
  assert.equal(decided.source, 'demo'); assert.equal(asked, 0);
  const cue = good(await createPolicyService().getAssumption('clock.scenario.v1', { runId: 'scenario-run', asOf: run.clockInstant })).value.namedTimes.release;
  const pulled = good(await provider.pull({ runId: 'scenario-run', asOf: cue, policyVersion: 'gcsp-policy-v1', releaseSize: 20, released: [], queuedSupply: [] }));
  assert.equal(pulled.tranche.windowId, 'demo-release-1'); assert.equal(pulled.tranche.availableAt, cue);
});
