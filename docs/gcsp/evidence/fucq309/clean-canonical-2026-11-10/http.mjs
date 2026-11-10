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
const proofId = process.argv[3] ?? 'canonical-v1';
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
const wallStartedAt = new Date().toISOString();
const identityPath = process.argv[4];
assert.ok(identityPath, 'supply the persisted prelaunch plan');
const prelaunch = JSON.parse(await readFile(identityPath, 'utf8'));
assert.equal(prelaunch.head, revision);
const inputIdentity = prelaunch.canonicalInputIdentity;
const summaryPath = `${retained}/fucq309-clean-canonical-2026-11-10/summary.json`;
const resultPath = `${retained}/fucq309-clean-canonical-2026-11-10/result.json`;
await assert.rejects(stat(summaryPath), { code: 'ENOENT' }, 'choose a new proof id; preserve the existing receipt');
await assert.rejects(stat(resultPath), { code: 'ENOENT' }, 'choose a new proof id; preserve the existing result');
const summary = { proofId, status: 'preparing', exactHead: revision, environment: { node: process.version, platform: process.platform,
  arch: process.arch }, request: { experimentId: 'process-only' }, overlay: null, fixedNow: NOW,
  wallStartedAt, prelaunchPlanPath: identityPath, cleanWorker: true, canonicalBaselineEquality: 'Not asserted: no successful unchanged canonical baseline; prior exact 100/300-person equality remains scoped.', elapsedMs: 0, workerLimits: [], workerMessages: [], workerErrors: [], workerExits: [], heapSamples: [],
  hostSamples: [], peakRss: 0, sourceHashes: {}, resultPath, resultStored: false };
const sourcePaths = Object.keys(prelaunch.productionSourceHashes);
for (const path of sourcePaths) {
  summary.sourceHashes[path] = createHash('sha256').update(await readFile(`${root}/${path}`)).digest('hex');
  assert.equal(summary.sourceHashes[path], prelaunch.productionSourceHashes[path], `prelaunch source identity changed: ${path}`);
}
const policySeed = JSON.parse(await readFile(`${root}/server/gcsp/policy/seed-v1.json`, 'utf8'));
summary.canonicalInputs = Object.fromEntries(policySeed.assumptions.filter((row) =>
  ['comparison.cohortSize', 'comparison.seeds', 'comparison.jobs.v1'].includes(row.key)).map((row) => [row.key, row.value]));
assert.equal(summary.canonicalInputs['comparison.cohortSize'], 1000);
assert.deepEqual(summary.canonicalInputs['comparison.seeds'], ['comparison-a', 'comparison-b', 'comparison-c']);
assert.deepEqual(summary.canonicalInputs['comparison.jobs.v1'], { schemaVersion: 1, timeoutSeconds: 1800, workerHeapMb: 128, workerYoungGenerationMb: 16 });
assert.deepEqual(process.execArgv, ['--import', prelaunch.dependencyResolveHook], 'only dependency resolution may be inherited by worker');
const checkpoint = async () => {
  summary.elapsedMs = performance.now() - started;
  summary.wallCheckpointAt = new Date().toISOString();
  const temporary = `${summaryPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`);
  await rename(temporary, summaryPath);
};
const since = () => performance.now() - started;
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW });
const workers = [];
let server, jobs, interval, sampling = false;
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
    assert.equal(url.href, pathToFileURL(`${root}/server/gcsp/comparison/worker.js`).href);
    assert.deepEqual(options.resourceLimits, { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 });
    assert.deepEqual(options.workerData.experiment, { experimentId: 'process-only' });
    assert.equal(options.workerData.overlay, undefined);
    assert.equal(options.execArgv, undefined);
    summary.workerLimits.push({ elapsedMs: since(), wallAt: new Date().toISOString(), url: url.href, resourceLimits: options.resourceLimits, data: options.workerData, inheritedExecArgv: process.execArgv });
    const worker = new Worker(url, options); workers.push(worker);
    worker.on('message', (message) => {
      if (message.type === 'result') {
        summary.workerResult = { elapsedMs: since(), wallAt: new Date().toISOString(), digest: inputDigest(message.result), bytes: Buffer.byteLength(JSON.stringify(message.result)) };
      } else {
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
      ...(body !== undefined && { body: JSON.stringify(body) }) });
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
        try { summary.heapSamples.push({ elapsedMs: since(), wallAt: new Date().toISOString(), ...await worker.getHeapStatistics() }); }
        catch (error) { summary.lastHeapSamplingError = error.code ?? error.message; }
      }
    } finally { sampling = false; }
  };
  interval = setInterval(() => void sample(), 1000);
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
    summary.hostSamples.push({ elapsedMs: since(), wallAt: new Date().toISOString(), stillRunning: after.body.value?.status === 'running', health: { http: health.http, ms: health.ms },
      process: { http: processView.http, ms: processView.ms }, latest: { http: after.http, ms: after.ms }, progress: after.body.value?.progress });
    assert.equal(health.http, 200);
    assert.equal(after.http, 200);
    assert.ok([200, 404].includes(processView.http));
    if (after.body.value?.progress.stepsDone !== previousProgress || summary.hostSamples.length % 30 === 0) {
      previousProgress = after.body.value?.progress.stepsDone;
      await checkpoint();
      console.log(JSON.stringify({ checkpoint: 'host-responsive', elapsedMs: since(), progress: after.body.value?.progress,
        rss: process.memoryUsage().rss, samples: summary.hostSamples.length }));
    }
    assert.ok(since() < 1850000, 'canonical proof exceeded application limit plus teardown allowance');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  summary.final = final; await checkpoint();
  const scope = { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT, ...COMPARISON_CLI_CONTEXT };
  const storedRows = await repository.query(scope, 'comparison_results');
  summary.storedRowCount = storedRows.value?.length ?? null;
  if (final.body.value.status !== 'succeeded') {
    assert.deepEqual(storedRows.value, [], 'failed/interrupted canonical job must store no partial result');
    throw new Error(`Canonical job ${final.body.value.status}: ${final.body.value.reason}`);
  }
  assert.deepEqual(final.body.value.progress, { seedsDone: 3, seedsTotal: 3, stepsDone: 6, stepsTotal: 6 });
  const saved = await call('greg', 'GET', '/api/gcsp/comparison/results/latest?experimentId=process-only');
  assert.equal(saved.http, 200, JSON.stringify(saved).slice(0, 1000));
  assert.equal(saved.body.value.resultId, final.body.value.resultId);
  assert.equal(storedRows.status, 'ok'); assert.equal(storedRows.value.length, 1);
  const result = saved.body.value.result;
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.kind, 'process-comparison');
  assert.equal(result.experimentId, 'process-only');
  assert.equal(result.completedAt, NOW);
  assert.equal(result.manifest.codeRevision, revision);
  assert.equal(result.manifest.policyVersion, inputIdentity.policyVersion);
  assert.equal(result.manifest.policyHash, inputIdentity.policyHash);
  assert.equal(result.manifest.generatorVersion, inputIdentity.generatorVersion);
  assert.deepEqual(result.manifest.inputHashes, Object.fromEntries(inputIdentity.seeds.map((entry) => [entry.seed, entry.inputHash])));
  assert.deepEqual(result.manifest.seeds, ['comparison-a', 'comparison-b', 'comparison-c']);
  assert.deepEqual(result.manifest.overlays, {});
  assert.equal(result.perSeed.length, 3);
  assert.ok(result.perSeed.every((entry) => Object.keys(entry.routes).join(',') === 'current,buddy'));
  // These host-only checks validate result completeness and internal arithmetic. They do not
  // claim equality to an unavailable pre-repair canonical record/decision baseline.
  const integerKeys = ['employees', 'taken', 'noneByRenewal', 'claims', 'retries', 'expiries', 'carsAllocated', 'carsHeldNotTaken', 'carsUnused'];
  const scalarMeasures = ['acceptableCoverage', 'carsNeverAllocated', 'heldNotTakenCarDays', 'declinedOffers', 'expiredOffers', 'failedClaims', 'retries', 'meanAcceptedFit'];
  const rounded = (value) => Math.round(value * 1e6) / 1e6 + 0;
  const summarise = (values) => {
    const observed = values.filter(Number.isFinite);
    return observed.length ? { mean: rounded(observed.reduce((a, b) => a + b, 0) / observed.length), min: Math.min(...observed), max: Math.max(...observed), observedSeeds: observed.length }
      : { mean: null, min: null, max: null, observedSeeds: 0 };
  };
  const routeDigests = [];
  assert.deepEqual(result.perSeed.map((entry) => entry.seed), inputIdentity.seeds.map((entry) => entry.seed));
  for (const [index, entry] of result.perSeed.entries()) {
    const expected = inputIdentity.seeds[index];
    assert.equal(entry.inputHash, expected.inputHash);
    for (const route of ['current', 'buddy']) {
      const actual = entry.routes[route], totals = actual.totals, measures = actual.measures;
      assert.deepEqual(Object.keys(actual).sort(), ['measures', 'recordDigest', 'totals']);
      assert.match(actual.recordDigest, /^[a-f0-9]{64}$/);
      routeDigests.push({ seed: entry.seed, route, recordDigest: actual.recordDigest });
      for (const key of integerKeys) assert.ok(Number.isSafeInteger(totals[key]) && totals[key] >= 0, `${entry.seed}/${route}/${key}`);
      assert.equal(totals.employees, 1000);
      assert.equal(totals.taken + totals.noneByRenewal, 1000);
      assert.equal(totals.carsAllocated, totals.taken);
      assert.equal(totals.carsAllocated + totals.carsHeldNotTaken + totals.carsUnused, expected.cars);
      assert.deepEqual(Object.keys(measures).sort(), [...scalarMeasures, 'accessGroupCoverage'].sort());
      for (const name of scalarMeasures) assert.ok(measures[name] === null || (Number.isFinite(measures[name]) && measures[name] >= 0), `${entry.seed}/${route}/${name}`);
      assert.ok(Number.isFinite(measures.acceptableCoverage) && measures.acceptableCoverage <= 1);
      assert.equal(measures.carsNeverAllocated, totals.carsHeldNotTaken + totals.carsUnused);
      assert.equal(measures.failedClaims, totals.expiries);
      assert.equal(measures.retries, totals.retries);
      assert.deepEqual(Object.keys(measures.accessGroupCoverage).sort(), expected.accessGroups);
      assert.ok(Object.values(measures.accessGroupCoverage).every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
      if (route === 'buddy') {
        for (const key of ['participants', 'offersMade', 'offersAccepted', 'declines', 'offerExpiries', 'termsLapsed', 'notificationsCaptured']) assert.ok(Number.isSafeInteger(totals[key]) && totals[key] >= 0, key);
        assert.ok(totals.participants <= 1000);
        assert.ok(Number.isFinite(totals.heldNotTakenHours) && totals.heldNotTakenHours >= 0);
        assert.ok(Number.isFinite(totals.buddyHeldNotTakenHours) && totals.buddyHeldNotTakenHours >= 0);
        assert.equal(Object.values(totals.declinesByReason).reduce((sum, count) => sum + count, 0), totals.declines);
        assert.equal(measures.declinedOffers, totals.declines);
        assert.equal(measures.expiredOffers, totals.offerExpiries);
        assert.equal(measures.heldNotTakenCarDays, rounded(totals.heldNotTakenHours / 24));
      } else {
        assert.equal(measures.declinedOffers, 0);
        assert.equal(measures.expiredOffers, 0);
      }
    }
  }
  for (const route of ['current', 'buddy']) {
    const aggregate = result.measures[route];
    assert.deepEqual(Object.keys(aggregate).sort(), [...scalarMeasures, 'accessGroupCoverage'].sort());
    for (const name of scalarMeasures) assert.deepEqual(aggregate[name], summarise(result.perSeed.map((entry) => entry.routes[route].measures[name])));
    const groups = [...new Set(inputIdentity.seeds.flatMap((entry) => entry.accessGroups))].sort();
    assert.deepEqual(Object.keys(aggregate.accessGroupCoverage).sort(), groups);
    for (const group of groups) assert.deepEqual(aggregate.accessGroupCoverage[group], summarise(result.perSeed.map((entry) => entry.routes[route].measures.accessGroupCoverage[group])));
  }
  const { compareRoutes } = await load('server/gcsp/comparison/measures.js');
  assert.deepEqual(result.differences, compareRoutes(result.perSeed.map((entry) => ({ seed: entry.seed, current: entry.routes.current.measures, buddy: entry.routes.buddy.measures })), result.rule));
  summary.completeResultAssertions = { allSeeds: 3, allRoutes: 6, canonicalInputHashes: true, recordDigests: routeDigests,
    totalsConservation: true, perRouteMeasureConsistency: true, aggregateMeasures: true, differences: true,
    baselineEquality: 'Unavailable canonical baseline; exact 100/300-person checks retained separately.' };
  assert.deepEqual(storedRows.value[0].result, result);
  const digest = inputDigest(result);
  assert.equal(summary.workerResult.digest, digest);
  assert.equal(inputDigest(storedRows.value[0].result), digest);
  // Returned values are detached from the immutable saved row.
  saved.body.value.result.perSeed[0].inputHash = 'caller-mutation';
  storedRows.value[0].result.perSeed[0].routes.buddy.totals.employees = -1;
  const storedAgain = await repository.query(scope, 'comparison_results');
  assert.equal(storedAgain.status, 'ok');
  assert.equal(storedAgain.value.length, 1);
  assert.equal(inputDigest(storedAgain.value[0].result), digest);
  const again = await call('greg', 'GET', '/api/gcsp/comparison/results/latest?experimentId=process-only');
  assert.equal(inputDigest(again.body.value.result), digest);
  await writeComparisonResultFile(resultPath, again.body.value.result);
  const reread = await readComparisonResultFile(resultPath);
  assert.equal(reread.status, 'ok'); assert.equal(inputDigest(reread.value), digest);
  summary.resultStored = true; summary.resultDigest = digest; summary.resultBytes = (await stat(resultPath)).size;
  summary.resultId = final.body.value.resultId; summary.manifest = reread.value.manifest;
  summary.perSeed = reread.value.perSeed; summary.status = 'succeeded';
  summary.hostTiming = Object.fromEntries(['health', 'process', 'latest'].map((key) => {
    const values = summary.hostSamples.filter((row) => row.stillRunning).map((row) => row[key].ms).sort((a,b) => a-b);
    return [key, { samples: values.length, minMs: values[0], maxMs: values.at(-1), p95Ms: values[Math.ceil(values.length*.95)-1] }];
  }));
  summary.peakWorkerUsedHeap = Math.max(0, ...summary.heapSamples.map((row) => row.used_heap_size));
  assert.ok(summary.hostTiming.health.samples > 0, 'no host requests observed during active work');
  console.log(JSON.stringify({ checkpoint: 'canonical-succeeded', elapsedMs: since(), resultPath, digest, peakRss: summary.peakRss,
    peakWorkerUsedHeap: summary.peakWorkerUsedHeap, hostTiming: summary.hostTiming }));
} catch (error) {
  summary.status = 'failed'; summary.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
  console.error(JSON.stringify({ checkpoint: 'canonical-failed', elapsedMs: since(), error: summary.error }));
} finally {
  clearInterval(interval);
  await jobs?.close();
  await Promise.allSettled(workers.map((worker) => worker.terminate()));
  if (server) { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  await repository.close(); await policy.close();
  if (priorKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = priorKey;
  summary.wallFinishedAt = new Date().toISOString();
  summary.wallElapsedMs = Date.parse(summary.wallFinishedAt) - Date.parse(wallStartedAt);
  summary.hostSampleGaps = { samples: summary.hostSamples.length, maxMs: Math.max(0, ...summary.hostSamples.slice(1).map((row, index) => row.elapsedMs - summary.hostSamples[index].elapsedMs)) };
  summary.hostTiming = Object.fromEntries(['health', 'process', 'latest'].map((key) => {
    const values = summary.hostSamples.filter((row) => row.stillRunning).map((row) => row[key].ms).sort((a,b) => a-b);
    return [key, { samples: values.length, minMs: values[0], maxMs: values.at(-1), p95Ms: values[Math.ceil(values.length*.95)-1] }];
  }));
  summary.peakRss = Math.max(summary.peakRss, process.memoryUsage().rss);
  summary.peakWorkerUsedHeap = Math.max(0, ...summary.heapSamples.map((row) => row.used_heap_size));
  summary.closed = true; await checkpoint();
}
