import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const root = '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027';
const retained = '/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110';
const revision = process.argv[2];
const proofId = process.argv[3] ?? 'first-buddy-claim-v1';
assert.ok(revision && /^[a-f0-9]{40}$/.test(revision), 'supply exact reviewed source HEAD');
assert.match(proofId, /^[a-z0-9-]+$/);
const load = (path) => import(pathToFileURL(`${root}/${path}`));
const [{ PolicyService, FilePolicyProvider }, { createMemoryRepository, createMemoryStore },
  { createDemoRuntime }, { createComparisonJobService }, { createComparisonResultService },
  { COMPARISON_RESULTS_ENVIRONMENT, COMPARISON_RESULTS_RUN }, { COMPARISON_CLI_CONTEXT, writeComparisonResultFile, readComparisonResultFile },
  { inputDigest }, { buildServer }] = await Promise.all([
  load('server/gcsp/policy/index.js'), load('server/gcsp/repository/memory.js'), load('server/gcsp/clock/index.js'),
  load('server/gcsp/comparison/jobs.js'), load('server/gcsp/comparison/http.js'), load('server/gcsp/comparison/results.js'),
  load('server/gcsp/comparison/job.js'), load('server/gcsp/repository/core.js'), load('server/index.js'),
]);
const NOW = '2026-11-10T12:00:00.000Z';
const ORIGIN = 'https://fucq309.local.test';
const ACCESS = 'isolated-fucq309-proof-key';
const started = performance.now();
const summaryPath = `${retained}/${proofId}-summary.json`;
const resultPath = null;
await assert.rejects(stat(summaryPath), { code: 'ENOENT' }, 'choose a new proof id; preserve the existing receipt');

const summary = { proofId, diagnosticOnly: true, diagnosticCapMs: 570000, stopBoundary: 'first canonical buddy claim.tryClaim return', status: 'preparing', exactHead: revision, environment: { node: process.version, platform: process.platform,
  arch: process.arch }, request: { experimentId: 'process-only' }, overlay: null, fixedNow: NOW,
  elapsedMs: 0, workerLimits: [], workerMessages: [], workerErrors: [], workerExits: [], heapSamples: [],
  hostSamples: [], peakRss: 0, sourceHashes: {}, resultPath, resultStored: false };
const sourcePaths = ['server/gcsp/comparison/private-repository.js', 'server/gcsp/allocation/index.js', 'server/gcsp/comparison/generator.js', 'server/gcsp/comparison/evaluation.js', 'server/gcsp/comparison/harness.js',
  'server/gcsp/comparison/routes/current.js', 'server/gcsp/comparison/routes/buddy.js', 'server/gcsp/comparison/experiments.js',
  'server/gcsp/comparison/jobs.js', 'server/gcsp/comparison/worker.js', 'server/gcsp/comparison/results.js',
  'server/gcsp/policy/seed-v1.json', 'server/gcsp/repository/core.js', 'server/gcsp/repository/memory.js'];
for (const path of sourcePaths) summary.sourceHashes[path] = createHash('sha256').update(await readFile(`${root}/${path}`)).digest('hex');
const policySeed = JSON.parse(await readFile(`${root}/server/gcsp/policy/seed-v1.json`, 'utf8'));
summary.canonicalInputs = Object.fromEntries(policySeed.assumptions.filter((row) =>
  ['comparison.cohortSize', 'comparison.seeds', 'comparison.jobs.v1'].includes(row.key)).map((row) => [row.key, row.value]));
assert.equal(summary.canonicalInputs['comparison.cohortSize'], 1000);
assert.deepEqual(summary.canonicalInputs['comparison.seeds'], ['comparison-a', 'comparison-b', 'comparison-c']);
const checkpoint = async () => {
  summary.elapsedMs = performance.now() - started;
  const temporary = `${summaryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`);
  await rename(temporary, summaryPath);
};
const since = () => performance.now() - started;
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW });
const workers = [];
let server, jobs, interval, diagnosticTimer, sampling = false;
const priorKey = process.env.DEMO_ACCESS_KEY;
try {
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'fucq309-isolated-proof', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'fucq309-bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('fucq309-presenter');
  assert.equal(presenter.status, 'ok');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'fucq309-greg');
  assert.equal(greg.status, 'ok');
  const cookies = Object.fromEntries(Object.entries({ presenter, greg }).map(([name, row]) =>
    [name, [row.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ')]));
  const createWorker = (url, options) => {
    summary.workerLimits.push({ elapsedMs: since(), resourceLimits: options.resourceLimits, data: options.workerData });
    const worker = new Worker(url, options); workers.push(worker);
    worker.on('message', (message) => {
      if (message.type !== 'result') {
        summary.workerMessages.push({ elapsedMs: since(), message });
        console.log(JSON.stringify({ checkpoint: 'worker-message', elapsedMs: since(), message }));
      }
    });
    worker.on('error', (error) => summary.workerErrors.push({ elapsedMs: since(), code: error.code, message: error.message }));
    worker.on('exit', (code) => summary.workerExits.push({ elapsedMs: since(), code }));
    return worker;
  };
  // The opt-in belongs solely to this isolated service; no environment or default gate change.
  jobs = createComparisonJobService({ repository, policy, clock, identity, createWorker, codeRevision: revision, fixedNow: NOW, reruns: true });
  const results = createComparisonResultService({ repository, policy, clock, identity });
  process.env.DEMO_ACCESS_KEY = ACCESS;
  server = buildServer({ gcspIdentity: identity, gcspClock: clock, gcspComparison: results, gcspComparisonJobs: jobs, gcspAllowedOrigins: [ORIGIN] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const call = async (who, method, path, body) => {
    const begin = performance.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { Origin: ORIGIN, Cookie: cookies[who], 'X-Access-Key': ACCESS, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    const parsed = await response.json();
    return { http: response.status, ms: performance.now() - begin, body: parsed };
  };
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      summary.peakRss = Math.max(summary.peakRss, process.memoryUsage().rss);
      const worker = workers.at(-1);
      if (worker?.threadId > 0) {
        try { summary.heapSamples.push({ observedAt: new Date().toISOString(), elapsedMs: since(), ...await worker.getHeapStatistics() }); }
        catch (error) { summary.lastHeapSamplingError = error.code ?? error.message; }
      }
    } finally { sampling = false; }
  };
  interval = setInterval(() => void sample(), 1000);
  diagnosticTimer = setTimeout(() => { summary.diagnosticCapReached = true; void jobs.close(); }, Math.max(1, summary.diagnosticCapMs - since()));
  const first = await call('greg', 'POST', '/api/gcsp/comparison/jobs', { experimentId: 'process-only' });
  summary.start = first; summary.status = 'running'; await checkpoint();
  assert.equal(first.http, 202, JSON.stringify(first));
  const jobId = first.body.value.jobId;
  let final;
  let previousProgress = -1;
  for (;;) {
    const view = await call('greg', 'GET', `/api/gcsp/comparison/jobs/latest?jobId=${jobId}`);
    assert.equal(view.http, 200, JSON.stringify(view));
    if (['succeeded', 'failed', 'interrupted'].includes(view.body.value.status)) { final = view; break; }
    const health = await call('greg', 'GET', '/health');
    const processView = await call('presenter', 'GET', '/api/gcsp/comparison/process/latest');
    const after = await call('greg', 'GET', `/api/gcsp/comparison/jobs/latest?jobId=${jobId}`);
    summary.hostSamples.push({ observedAt: new Date().toISOString(), elapsedMs: since(), stillRunning: after.body.value?.status === 'running', health: { http: health.http, ms: health.ms },
      process: { http: processView.http, ms: processView.ms }, latest: { http: after.http, ms: after.ms }, progress: after.body.value?.progress });
    assert.equal(health.http, 200);
    assert.ok([200, 404].includes(processView.http));
    if (after.body.value?.progress.stepsDone !== previousProgress || summary.hostSamples.length % 30 === 0) {
      previousProgress = after.body.value?.progress.stepsDone;
      await checkpoint();
      console.log(JSON.stringify({ checkpoint: 'host-responsive', elapsedMs: since(), progress: after.body.value?.progress,
        rss: process.memoryUsage().rss, samples: summary.hostSamples.length }));
    }
    assert.ok(since() < summary.diagnosticCapMs + 10000, 'diagnostic cap exceeded with teardown allowance');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  summary.final = final; await checkpoint();
  const scope = { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT, ...COMPARISON_CLI_CONTEXT };
  const storedRows = await repository.query(scope, 'comparison_results');
  summary.storedRowCount = storedRows.value?.length ?? null;
  assert.deepEqual(storedRows.value, [], 'diagnostic must store no partial comparison result');
  const checkpoints = summary.workerMessages.filter((row) => row.message.type === 'fucq309-diagnostic');
  summary.diagnosticCheckpoints = checkpoints.map((row) => row.message);
  const stop = checkpoints.filter((row) => row.message.label === 'first-claim-returned');
  summary.checkpointReached = stop.length === 1;
  assert.equal(stop.length, 1, 'single bounded first-claim checkpoint was not reached');
  assert.equal(stop[0].message.route, 'buddy');
  assert.ok(['ok', 'conflict', 'stale-version'].includes(stop[0].message.outcomeStatus));
  assert.equal(final.body.value.status, 'failed', 'injected diagnostic stop must end the real job without a result');
  assert.equal(final.body.value.progress.stepsDone, 1);
  const plan = summary.workerMessages.find((row) => row.message.type === 'plan')?.message;
  assert.deepEqual(plan?.seeds, ['comparison-a', 'comparison-b', 'comparison-c']);
  assert.equal(plan?.steps, 6);
  assert.deepEqual(summary.workerLimits.map((row) => row.resourceLimits), [{ maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 }]);
  summary.status = 'checkpoint-reached';
  console.log(JSON.stringify({ checkpoint: 'diagnostic-checkpoint-reached', elapsedMs: since(), firstClaim: stop[0].message,
    storedRowCount: summary.storedRowCount, finalProgress: final.body.value.progress }));
} catch (error) {
  summary.status = 'failed'; summary.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(JSON.stringify({ checkpoint: 'diagnostic-not-complete', elapsedMs: since(), error: summary.error }));
} finally {
  clearInterval(interval); clearTimeout(diagnosticTimer);
  await jobs?.close();
  await Promise.allSettled(workers.map((worker) => worker.terminate()));
  if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  await repository.close(); await policy.close();
  if (priorKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = priorKey;
  summary.peakRss = Math.max(summary.peakRss, process.memoryUsage().rss);
  summary.peakWorkerUsedHeap = Math.max(0, ...summary.heapSamples.map((row) => row.used_heap_size));
  summary.hostTiming = Object.fromEntries(['health', 'process', 'latest'].map((key) => {
    const values = summary.hostSamples.filter((row) => row.stillRunning).map((row) => row[key].ms).sort((a,b) => a-b);
    return [key, { samples: values.length, minMs: values[0] ?? null, maxMs: values.at(-1) ?? null,
      p95Ms: values[Math.ceil(values.length*.95)-1] ?? null }];
  }));
  const gaps = summary.hostSamples.slice(1).map((row, index) => row.elapsedMs - summary.hostSamples[index].elapsedMs);
  summary.maximumHostSampleGapMs = Math.max(0, ...gaps);
  summary.closed = true; await checkpoint();
}
