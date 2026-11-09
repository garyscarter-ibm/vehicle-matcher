import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { runComparison } from '../gcsp/comparison/experiments.js';
import { COMPARISON_RESULTS_ENVIRONMENT, COMPARISON_RESULTS_RUN } from '../gcsp/comparison/results.js';
import { runComparisonCli, COMPARISON_CLI_CONTEXT } from '../gcsp/comparison/job.js';
import { createComparisonJobService, JOBS_KEY } from '../gcsp/comparison/jobs.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE_WORKER = new URL('./fixtures/gcsp-comparison-fixture-worker.mjs', import.meta.url);
const buddyFixture = JSON.parse(readFileSync(new URL('./fixtures/gcsp-comparison-buddy-outcomes.json', import.meta.url), 'utf8'));
const NOW = '2026-11-08T12:00:00.000Z';
const REVISION = 'worker-job-test';
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const processOnly = { experimentId: 'process-only' };
const holdSweep = { experimentId: 'hold-sweep', change: { values: [3600, 10800, 21600, 43200, 86400], basis: 'Does a longer hold help?' } };
const scope = { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT, ...COMPARISON_CLI_CONTEXT };
const direct = await runComparison({ ...processOnly, overlay: buddyFixture.overlay }, { policy, codeRevision: REVISION, now: () => NOW });

const openRepository = async () => {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW });
  assert.equal((await repository.open()).status, 'ok');
  return repository;
};
const rowsOf = async (repository, table) => (await repository.query(scope, table)).value ?? [];

// Identity and clock come from a demo runtime; the sessions are Greg, the presenter and an employee.
const fixture = async (repository) => {
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'comparison-jobs-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('jobs-presenter');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'jobs-greg');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'jobs-paula');
  return { clock, identity, contexts: { presenter: presenter.value.context, greg: greg.value.context, paula: paula.value.context } };
};

// Wraps the Worker so a test can count spawns and wait for a worker to exit; `fake` runs the fixture worker instead.
const spawnLog = (fake) => {
  const workers = [];
  const createWorker = (url, options) => {
    const worker = fake ? new Worker(FIXTURE_WORKER, { ...options, workerData: { mode: fake } }) : new Worker(url, options);
    workers.push({ worker, exited: new Promise((resolve) => worker.once('exit', resolve)) });
    return worker;
  };
  return { workers, createWorker };
};
// A policy whose job limits are replaced (or removed with null); every other key reads through.
const limitsPolicy = (override, called = new Set()) => new Proxy(policy, { get(target, name) {
  if (name === 'getAssumption') {
    return async (key, read) => {
      called.add('getAssumption');
      const outcome = await target.getAssumption(key, read);
      if (key !== JOBS_KEY) return outcome;
      return override === null ? { status: 'not-found' } : { ...outcome, value: { ...outcome.value, value: { ...outcome.value.value, ...override } } };
    };
  }
  const member = target[name];
  if (typeof member === 'function') return (...args) => { called.add(name); return member.apply(target, args); };
  return member;
} });

const build = async ({ spawn = spawnLog(), policy: runtimePolicy = policy, instanceId, repository: shared, f: sharedFixture } = {}) => {
  const repository = shared ?? await openRepository();
  const f = sharedFixture ?? await fixture(repository);
  const service = createComparisonJobService({ repository, policy: runtimePolicy, clock: f.clock, identity: f.identity, instanceId,
    createWorker: spawn.createWorker, codeRevision: REVISION, fixedNow: NOW, overlay: buddyFixture.overlay });
  return { repository, f, service, spawn };
};
const until = async (read, done, limitMs = 20000) => {
  const stop = performance.now() + limitMs;
  for (;;) {
    const outcome = await read();
    if (done(outcome)) return outcome;
    assert.ok(performance.now() < stop, `timed out waiting: ${JSON.stringify(outcome)}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
};
const finished = (service, context, jobId) => until(() => service.read(context, { jobId }),
  (outcome) => outcome.status === 'ok' && ['succeeded', 'failed', 'interrupted'].includes(outcome.value.status));

test('creating the service, reading and importing the modules spawn and start nothing', async () => {
  const { service, spawn, f } = await build();
  assert.equal(spawn.workers.length, 0);
  assert.equal((await service.read(f.contexts.greg)).status, 'not-found');
  assert.equal(spawn.workers.length, 0);
  const quiet = spawnSync(process.execPath, ['--input-type=module', '-e',
    'await import("./server/gcsp/comparison/worker.js"); await import("./server/gcsp/comparison/jobs.js");'],
  { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout + quiet.stderr, '');
  await import('../gcsp/comparison/worker.js');
  assert.equal(spawn.workers.length, 0);
});

test('a started job reaches succeeded with full progress, and its stored result equals the CLI and direct runner result', async () => {
  const { service, spawn, repository, f } = await build();
  const started = await service.start(f.contexts.greg, processOnly);
  assert.equal(started.status, 'pending', JSON.stringify(started));
  const first = started.value;
  assert.match(first.jobId, /^comparison-job-[0-9a-f-]{36}$/);
  assert.deepEqual({ ...first, jobId: undefined }, { jobId: undefined, experimentId: 'process-only', status: 'running',
    progress: { seedsDone: 0, seedsTotal: 3, stepsDone: 0, stepsTotal: 6 }, startedAt: NOW, finishedAt: null, resultId: null, reason: null,
    request: { experimentId: 'process-only', change: null } });
  const done = (await finished(service, f.contexts.greg, first.jobId)).value;
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.deepEqual(done.progress, { seedsDone: 3, seedsTotal: 3, stepsDone: 6, stepsTotal: 6 });
  assert.equal(done.reason, null);
  assert.equal(done.finishedAt, NOW);

  const rows = await rowsOf(repository, 'comparison_results');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resultId, done.resultId);
  assert.deepEqual(rows[0].result, direct);
  const out = []; const err = [];
  const cliRepository = await openRepository();
  const cli = await runComparisonCli({ argv: ['--experiment', 'process'], env: {}, now: () => NOW, codeRevision: REVISION, overlay: buddyFixture.overlay,
    repository: cliRepository, policy, stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
  assert.equal(cli.exitCode, 0, err.join(''));
  assert.deepEqual(rows[0].result, cli.result);
  assert.equal(cli.stored.resultId, done.resultId);
  await spawn.workers[0].exited;
  // The latest job, with no id given, is the one just run.
  assert.equal((await service.read(f.contexts.presenter)).value.jobId, first.jobId);
});

test('a what-if job stores the same result as the direct runner, with progress across arms', async () => {
  const { service, repository, f } = await build();
  const expected = await runComparison({ ...holdSweep, overlay: buddyFixture.overlay }, { policy, codeRevision: REVISION, now: () => NOW });
  const started = await service.start(f.contexts.presenter, holdSweep);
  assert.equal(started.status, 'pending', JSON.stringify(started));
  assert.equal(started.value.progress.stepsTotal, 36);
  assert.deepEqual(started.value.request, { experimentId: 'hold-sweep', change: holdSweep.change });
  const done = (await finished(service, f.contexts.presenter, started.value.jobId)).value;
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.deepEqual(done.progress, { seedsDone: 3, seedsTotal: 3, stepsDone: 36, stepsTotal: 36 });
  const [row] = await rowsOf(repository, 'comparison_results');
  assert.deepEqual(row.result, expected);
  assert.equal(row.experimentId, 'hold-sweep');
});

test('the command and the worker store the same what-if result for the same request', async () => {
  const request = { experimentId: 'hold-sweep', change: { values: [3600, 14400], basis: 'Does a different hold help?' } };
  const expected = await runComparison({ ...request, overlay: buddyFixture.overlay }, { policy, codeRevision: REVISION, now: () => NOW });
  const { service, repository, f } = await build();
  const started = await service.start(f.contexts.greg, request);
  assert.equal(started.status, 'pending', JSON.stringify(started));
  const done = (await finished(service, f.contexts.greg, started.value.jobId)).value;
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const [workerRow] = await rowsOf(repository, 'comparison_results');

  const cliRepository = await openRepository();
  const err = [];
  const cli = await runComparisonCli({ argv: ['--experiment', 'hold-sweep', '--change', JSON.stringify(request.change)], env: {}, now: () => NOW,
    codeRevision: REVISION, overlay: buddyFixture.overlay, repository: cliRepository, policy, stdout: () => {}, stderr: (text) => err.push(text) });
  assert.equal(cli.exitCode, 0, err.join(''));
  const [cliRow] = await rowsOf(cliRepository, 'comparison_results');
  assert.deepEqual(cliRow.result, workerRow.result);
  assert.deepEqual(cliRow.result, expected);
  assert.deepEqual(cli.result, expected);
  assert.equal(cliRow.resultId, workerRow.resultId);
  assert.equal(cli.stored.resultId, done.resultId);
});

test('the event loop and repository stay responsive while a job runs', async () => {
  const { service, repository, f } = await build();
  const started = await service.start(f.contexts.greg, holdSweep);
  assert.equal(started.status, 'pending');
  let last = performance.now(); let maxLag = 0;
  const ticker = setInterval(() => { const at = performance.now(); maxLag = Math.max(maxLag, at - last - 10); last = at; }, 10);
  const seen = new Set(); let queriedWhileRunning = false;
  try {
    await until(async () => {
      const outcome = await service.read(f.contexts.greg, { jobId: started.value.jobId });
      seen.add(outcome.value.status);
      if (outcome.value.status === 'running') queriedWhileRunning = (await repository.query(scope, 'comparison_jobs')).status === 'ok' || queriedWhileRunning;
      return outcome;
    }, (outcome) => outcome.value.status !== 'running');
  } finally { clearInterval(ticker); }
  assert.ok(seen.has('running') && queriedWhileRunning, [...seen].join());
  assert.ok(maxLag < 200, `max timer lag ${maxLag.toFixed(0)} ms`);
});

test('progress that arrives while the job row is still being written is not lost', async () => {
  const real = await openRepository();
  const f = await fixture(real);
  const slow = { ...real, transaction: async (context, command, work) => {
    if (command.commandId.startsWith('comparison-job-start:')) await new Promise((resolve) => setTimeout(resolve, 600));
    return real.transaction(context, command, work);
  } };
  const { service } = await build({ repository: slow, f });
  const started = await service.start(f.contexts.greg, processOnly);
  assert.equal(started.status, 'pending', JSON.stringify(started));
  const done = (await finished(service, f.contexts.greg, started.value.jobId)).value;
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  assert.deepEqual(done.progress, { seedsDone: 3, seedsTotal: 3, stepsDone: 6, stepsTotal: 6 });
  assert.equal((await rowsOf(real, 'comparison_results')).length, 1);
});

test('a second start while a job runs is refused with the running job id, and one after it finishes is accepted', async () => {
  const { service, f } = await build();
  const first = await service.start(f.contexts.greg, processOnly);
  assert.equal(first.status, 'pending');
  const [second, third] = await Promise.all([service.start(f.contexts.greg, processOnly), service.start(f.contexts.presenter, processOnly)]);
  for (const refused of [second, third]) {
    assert.equal(refused.status, 'conflict', JSON.stringify(refused));
    assert.equal(refused.code, 'job-running');
    assert.equal(refused.jobId, first.value.jobId);
  }
  assert.equal((await finished(service, f.contexts.greg, first.value.jobId)).value.status, 'succeeded');
  const next = await service.start(f.contexts.greg, processOnly);
  assert.equal(next.status, 'pending', JSON.stringify(next));
  assert.notEqual(next.value.jobId, first.value.jobId);
  assert.equal((await finished(service, f.contexts.greg, next.value.jobId)).value.status, 'succeeded');
  assert.equal((await service.read(f.contexts.greg)).value.jobId, next.value.jobId);
});

test('two starts at the same moment run exactly one job', async () => {
  const { service, spawn, f } = await build();
  const [a, b] = await Promise.all([service.start(f.contexts.greg, processOnly), service.start(f.contexts.greg, processOnly)]);
  assert.deepEqual([a.status, b.status].sort(), ['conflict', 'pending']);
  assert.equal(spawn.workers.length, 1);
  await service.close();
});

test('Greg and the presenter may start and read; an employee is refused both without a worker', async () => {
  const { service, spawn, f } = await build();
  const refused = await service.start(f.contexts.paula, processOnly);
  assert.equal(refused.status, 'forbidden');
  assert.equal((await service.read(f.contexts.paula)).status, 'forbidden');
  assert.equal(spawn.workers.length, 0);
  const started = await service.start(f.contexts.presenter, processOnly);
  assert.equal(started.status, 'pending');
  assert.equal((await service.read(f.contexts.greg, { jobId: started.value.jobId })).status, 'ok');
  assert.equal((await service.read(f.contexts.presenter, { jobId: started.value.jobId })).status, 'ok');
  assert.equal((await service.read(f.contexts.paula, { jobId: started.value.jobId })).status, 'forbidden');
  assert.equal((await service.read(f.contexts.greg, { jobId: 'comparison-job-missing' })).status, 'not-found');
  await finished(service, f.contexts.greg, started.value.jobId);
});

test('invalid requests name the key, start nothing, store no job and never touch policy', async () => {
  const called = new Set();
  const { service, spawn, repository, f } = await build({ policy: limitsPolicy({}, called) });
  const change = (extra) => ({ experimentId: 'hold-sweep', change: { values: [3600], basis: 'Trying it', ...extra } });
  const hold = ['change.values', 'hold.buddy.durationSeconds'];
  const cases = [
    [change({ values: [100] }), ...hold],
    [change({ values: [7200] }), ...hold],
    [change({ values: [3600, 100000] }), ...hold],
    [change({ values: [900, 1800, 3600, 10800, 21600, 43200] }), ...hold],
    [{ experimentId: 'points', change: { value: 5, basis: 'Trying it' } }, 'change.value', 'comparison.pointsAllowanceMultiplier'],
    [{ experimentId: 'order-mix', change: { value: [], basis: 'Trying it' } }, 'change.value', 'comparison.modelLineMix'],
    [{ experimentId: 'hold-sweep', change: { values: [3600] } }, 'change.basis', null],
    [{ experimentId: 'hold-sweep' }, 'change', null],
    [{ experimentId: 'nonsense' }, 'experimentId', null],
    [{ experimentId: 'points', change: { value: 2, basis: 'x', extra: 1 } }, 'change', null],
  ];
  for (const [request, field, key] of cases) {
    const refused = await service.start(f.contexts.greg, request);
    assert.equal(refused.status, 'invalid', `${field}: ${JSON.stringify(refused)}`);
    assert.equal(refused.code, 'invalid-experiment');
    assert.equal(refused.reasons[0].field, field);
    assert.equal(refused.reasons[0].key, key);
    assert.match(refused.reasons[0].reason, /\S/);
    assert.ok(!/[—–]/.test(refused.reasons[0].reason));
    assert.equal((await service.read(f.contexts.greg)).status, 'not-found');
    assert.deepEqual(await rowsOf(repository, 'comparison_jobs'), []);
  }
  assert.equal((await service.start(f.contexts.greg, 'process-only')).reasons[0].field, 'experimentId');
  assert.deepEqual(await rowsOf(repository, 'comparison_results'), []);
  await Promise.all(spawn.workers.map(({ exited }) => exited));
  assert.equal(spawn.workers.length, cases.length);
  assert.deepEqual([...called].filter((name) => name !== 'getAssumption'), []);
  // The slot is free after a refusal.
  assert.equal((await service.start(f.contexts.greg, processOnly)).status, 'pending');
  await service.close();
});

test('a worker that throws fails the job with a fixed reason and stores no result', async () => {
  const { service, spawn, repository, f } = await build({ spawn: spawnLog('throw') });
  const started = await service.start(f.contexts.greg, processOnly);
  assert.equal(started.status, 'pending');
  const done = (await finished(service, f.contexts.greg, started.value.jobId)).value;
  assert.equal(done.status, 'failed');
  assert.equal(done.reason, 'The comparison could not be completed.');
  assert.ok(!JSON.stringify(done).includes('secret-host'));
  assert.notEqual(done.finishedAt, null);
  assert.deepEqual(await rowsOf(repository, 'comparison_results'), []);
  await spawn.workers[0].exited;
  assert.equal((await service.start(f.contexts.greg, processOnly)).status, 'pending');
  await service.close();
});

test('a worker that exceeds its heap allowance fails the job naming the allowance', async () => {
  const { service, spawn, repository, f } = await build({ spawn: spawnLog('oom'), policy: limitsPolicy({ workerHeapMb: 16 }) });
  const started = await service.start(f.contexts.greg, processOnly);
  assert.equal(started.status, 'pending');
  const done = (await finished(service, f.contexts.greg, started.value.jobId)).value;
  assert.equal(done.status, 'failed');
  assert.match(done.reason, /more than its 16 MB memory allowance/);
  assert.deepEqual(await rowsOf(repository, 'comparison_results'), []);
  await spawn.workers[0].exited;
});

test('the canonical timeout stops the worker, fails the job naming the limit and stores no result', async () => {
  const { service, spawn, repository, f } = await build({ spawn: spawnLog('hang'), policy: limitsPolicy({ timeoutSeconds: 0.2 }) });
  const started = await service.start(f.contexts.greg, processOnly);
  assert.equal(started.status, 'pending');
  assert.equal((await service.read(f.contexts.greg)).value.status, 'running');
  const done = (await finished(service, f.contexts.greg, started.value.jobId)).value;
  assert.equal(done.status, 'failed');
  assert.match(done.reason, /limit of 0\.2 seconds/);
  await spawn.workers[0].exited;
  assert.deepEqual(await rowsOf(repository, 'comparison_results'), []);
  assert.equal((await service.start(f.contexts.greg, processOnly)).status, 'pending');
  await service.close();
});

test('the job limits are read from the policy; missing or malformed limits are unavailable and spawn nothing', async () => {
  for (const override of [null, { timeoutSeconds: 0 }, { workerHeapMb: 'big' }, { workerYoungGenerationMb: 0 }, { workerYoungGenerationMb: undefined }, { schemaVersion: 2 }]) {
    const { service, spawn, f } = await build({ policy: limitsPolicy(override) });
    const refused = await service.start(f.contexts.greg, processOnly);
    assert.equal(refused.status, 'unavailable', JSON.stringify(override));
    assert.equal(refused.key, JOBS_KEY);
    assert.match(refused.reason, /comparison\.jobs\.v1/);
    assert.equal(spawn.workers.length, 0);
    assert.equal((await service.read(f.contexts.greg)).status, 'not-found');
  }
  const seeded = (await policy.getAssumption(JOBS_KEY, { runId: 'jobs-test', asOf: '2026-11-08T00:00:00.000Z' }));
  assert.deepEqual(seeded.value.value, { schemaVersion: 1, timeoutSeconds: 1800, workerHeapMb: 128, workerYoungGenerationMb: 16 });
  assert.equal(seeded.value.status, 'assumed');
});

test('a running row from another backend instance is read as interrupted; close marks its own job interrupted', async () => {
  const repository = await openRepository();
  const f = await fixture(repository);
  const first = await build({ repository, f, instanceId: 'instance-one', spawn: spawnLog('hang') });
  const started = await first.service.start(f.contexts.greg, processOnly);
  assert.equal(started.status, 'pending');
  assert.equal((await first.service.read(f.contexts.greg)).value.status, 'running');

  // The first instance never marks its job: the backend died, so the second finds the row still running.
  const second = await build({ repository, f, instanceId: 'instance-two', spawn: spawnLog('hang') });
  const read = await second.service.read(f.contexts.presenter, { jobId: started.value.jobId });
  assert.equal(read.value.status, 'interrupted');
  assert.equal(read.value.reason, 'The backend restarted before the comparison finished.');
  assert.notEqual(read.value.finishedAt, null);
  assert.equal(first.spawn.workers.length, 1);
  await first.spawn.workers[0].worker.terminate();
  assert.equal((await second.service.read(f.contexts.greg)).value.status, 'interrupted');

  const next = await second.service.start(f.contexts.greg, processOnly);
  assert.equal(next.status, 'pending');
  await second.service.close();
  await second.spawn.workers[0].exited;
  const closed = (await second.service.read(f.contexts.greg, { jobId: next.value.jobId })).value;
  assert.equal(closed.status, 'interrupted');
  assert.equal(closed.reason, 'The backend stopped before the comparison finished.');
  assert.deepEqual(await rowsOf(repository, 'comparison_results'), []);
  // Starting also marks a stale running row.
  const third = await build({ repository, f, instanceId: 'instance-three', spawn: spawnLog('hang') });
  assert.equal((await third.service.read(f.contexts.greg, { jobId: started.value.jobId })).value.status, 'interrupted');
});
