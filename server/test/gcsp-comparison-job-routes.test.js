import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { COMPARISON_RESULTS_ENVIRONMENT, COMPARISON_RESULTS_RUN } from '../gcsp/comparison/results.js';
import { COMPARISON_CLI_CONTEXT } from '../gcsp/comparison/job.js';
import { createComparisonResultService } from '../gcsp/comparison/http.js';
import { createComparisonJobService } from '../gcsp/comparison/jobs.js';
import { parseExperimentRequest } from '../gcsp/comparison/requests.js';
import { EXPERIMENT_IDS } from '../gcsp/comparison/experiments.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';

const buddyFixture = JSON.parse(readFileSync(new URL('./fixtures/gcsp-comparison-buddy-outcomes.json', import.meta.url), 'utf8'));
const FIXTURE_WORKER = new URL('./fixtures/gcsp-comparison-fixture-worker.mjs', import.meta.url);
const NOW = '2026-11-08T12:00:00.000Z';
const ORIGIN = 'https://greg.test';
const ACCESS_KEY = 'comparison-routes-fixture-key';
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const scope = { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT, ...COMPARISON_CLI_CONTEXT };
const processOnly = { experimentId: 'process-only' };
const holdSweep = { experimentId: 'hold-sweep', change: { values: [3600, 10800, 21600, 43200, 86400], basis: 'Does a longer hold help?' } };
const PATHS = { jobs: '/api/gcsp/comparison/jobs', latest: '/api/gcsp/comparison/jobs/latest', results: '/api/gcsp/comparison/results/latest',
  process: '/api/gcsp/comparison/process/latest' };

// A server over the small overlay seam, with greg, presenter and paula sessions; `fake` runs the fixture worker.
async function serve({ fake } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW });
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'comparison-routes-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('routes-presenter');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'routes-greg');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'routes-paula');
  const cookies = Object.fromEntries(Object.entries({ presenter, greg, paula })
    .map(([name, session]) => [name, [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ')]));
  const spawned = [];
  const createWorker = (url, options) => {
    const worker = fake ? new Worker(FIXTURE_WORKER, { ...options, workerData: { mode: fake } }) : new Worker(url, options);
    spawned.push(worker);
    return worker;
  };
  const jobs = createComparisonJobService({ repository, policy, clock, identity, createWorker, codeRevision: 'routes-test', fixedNow: NOW,
    overlay: buddyFixture.overlay });
  const results = createComparisonResultService({ repository, policy, clock, identity });
  const oldKey = process.env.DEMO_ACCESS_KEY;
  process.env.DEMO_ACCESS_KEY = ACCESS_KEY;
  const server = buildServer({ gcspIdentity: identity, gcspClock: clock, gcspComparison: results, gcspComparisonJobs: jobs, gcspAllowedOrigins: [ORIGIN] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const call = async (who, method, path, body) => {
    const started = performance.now();
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { Origin: ORIGIN, Cookie: cookies[who], 'X-Access-Key': ACCESS_KEY, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }) });
    const parsed = await response.json();
    return { http: response.status, body: parsed, cache: response.headers.get('Cache-Control'), ms: performance.now() - started };
  };
  const close = async () => {
    await jobs.close();
    await Promise.all(spawned.map((worker) => worker.terminate()));
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    if (oldKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = oldKey;
  };
  const rows = async (table) => (await repository.query(scope, table)).value ?? [];
  return { call, close, spawned, rows, jobs };
}
const until = async (read, done, limitMs = 30000) => {
  const stop = performance.now() + limitMs;
  for (;;) {
    const outcome = await read();
    if (done(outcome)) return outcome;
    assert.ok(performance.now() < stop, `timed out waiting: ${JSON.stringify(outcome.body)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const settled = (outcome) => ['succeeded', 'failed', 'interrupted'].includes(outcome.body.value?.status);

test('other requests are served while a job runs, and the stored result matches the job', async (t) => {
  const s = await serve();
  t.after(s.close);
  const started = await s.call('greg', 'POST', PATHS.jobs, holdSweep);
  assert.equal(started.http, 202, JSON.stringify(started.body));
  assert.equal(started.cache, 'no-store');
  assert.equal(started.body.status, 'pending');
  const { jobId } = started.body.value;
  assert.equal(started.body.value.status, 'running');

  const timings = [];
  const final = await until(async () => {
    const view = await s.call('greg', 'GET', `${PATHS.latest}?jobId=${jobId}`);
    if (view.body.value?.status === 'running') {
      const other = await s.call('presenter', 'GET', PATHS.process);
      const again = await s.call('greg', 'GET', PATHS.latest);
      // Counted only when the job was still running after both calls.
      const after = await s.call('greg', 'GET', PATHS.latest);
      if (after.body.value?.status === 'running') timings.push({ process: other.ms, latest: again.ms, processHttp: other.http });
    }
    return view;
  }, settled);
  assert.ok(timings.length >= 1, 'no request was made while the job was running');
  for (const { process: processMs, latest, processHttp } of timings) {
    assert.ok(processMs < 500 && latest < 500, `slow mid-run: process ${processMs.toFixed(0)} ms, latest ${latest.toFixed(0)} ms`);
    assert.ok([200, 404].includes(processHttp));
  }
  assert.equal(final.body.value.status, 'succeeded', JSON.stringify(final.body));
  assert.equal(final.cache, 'no-store');

  const stored = await s.call('greg', 'GET', `${PATHS.results}?experimentId=hold-sweep`);
  assert.equal(stored.http, 200, JSON.stringify(stored.body).slice(0, 300));
  assert.equal(stored.body.value.resultId, final.body.value.resultId);
  assert.equal(stored.body.value.policyCurrent, true);
  assert.equal(stored.body.value.result.experimentId, 'hold-sweep');
  // With no id the latest job is this one.
  assert.equal((await s.call('presenter', 'GET', PATHS.latest)).body.value.jobId, jobId);
});

test('a second start while a job runs is refused with its job id, and an employee is refused on every route', async (t) => {
  const s = await serve({ fake: 'hang' });
  t.after(s.close);
  const first = await s.call('greg', 'POST', PATHS.jobs, processOnly);
  assert.equal(first.http, 202, JSON.stringify(first.body));
  const second = await s.call('presenter', 'POST', PATHS.jobs, processOnly);
  assert.equal(second.http, 409);
  assert.deepEqual({ ...second.body, reason: undefined, contractVersion: undefined }, { status: 'conflict', code: 'job-running',
    jobId: first.body.value.jobId, reason: undefined, contractVersion: undefined });
  assert.match(second.body.reason, /\S/);
  assert.equal(s.spawned.length, 1);
  // The running job is the one reported first.
  assert.equal((await s.call('greg', 'GET', PATHS.latest)).body.value.jobId, first.body.value.jobId);

  for (const [method, path, body] of [['POST', PATHS.jobs, processOnly], ['GET', PATHS.latest], ['GET', PATHS.results]]) {
    const refused = await s.call('paula', method, path, body);
    assert.equal(refused.http, 403, `${method} ${path}`);
    assert.equal(refused.cache, 'no-store');
  }
  // An employee's bad body is refused as forbidden, not described.
  assert.equal((await s.call('paula', 'POST', PATHS.jobs, { seeds: [1] })).http, 403);
  assert.equal(s.spawned.length, 1);
});

test('shape failures name every field, start nothing and store no job; the worker check names the policy key', async (t) => {
  const s = await serve();
  t.after(s.close);
  const post = (body) => s.call('greg', 'POST', PATHS.jobs, body);
  const fields = (outcome) => outcome.body.reasons.map((r) => r.field);
  const hold = (extra) => ({ experimentId: 'hold-sweep', change: { values: [3600], basis: 'Trying it', ...extra } });

  const together = await post({ experimentId: 'process-only', seeds: [1, 2], overlay: { 'hold.buddy.durationSeconds': 3600 } });
  assert.equal(together.http, 400);
  assert.equal(together.cache, 'no-store');
  assert.equal(together.body.code, 'invalid-experiment');
  assert.deepEqual(fields(together), ['seeds', 'overlay']);
  assert.ok(together.body.reasons.every((r) => r.key === null && /\S/.test(r.reason) && !/[—–]/.test(r.reason)));

  const shape = [
    [{ experimentId: 'nonsense' }, ['experimentId']],
    [{}, ['experimentId']],
    [{ experimentId: 'process-only', change: { value: 2, basis: 'x' } }, ['change']],
    [{ experimentId: 'points', change: { value: 2 } }, ['change.basis']],
    [{ experimentId: 'points', change: { value: '2', basis: 'x'.repeat(501) } }, ['change.value', 'change.basis']],
    [{ experimentId: 'points' }, ['change']],
    [hold({ values: [3600.5] }), ['change.values']],
    [hold({ values: [3600, 3600] }), ['change.values']],
    [hold({ extra: 1 }), ['change.extra']],
    [{ experimentId: 'hold-sweep', change: { value: 3600, basis: 'x' } }, ['change.value', 'change.values']],
    [{ experimentId: 'order-mix', change: { value: 'x', basis: 'x' } }, ['change.value']],
    [{ experimentId: 'order-mix', change: { value: [], basis: '  ' } }, ['change.value', 'change.basis']],
  ];
  for (const [body, expected] of shape) {
    const refused = await post(body);
    assert.equal(refused.http, 400, JSON.stringify(body));
    assert.deepEqual(fields(refused).sort(), [...expected].sort(), JSON.stringify(refused.body));
    assert.equal(new Set(fields(refused)).size, fields(refused).length);
  }
  // Keys are the policy keys the field changes.
  const keyed = await post(hold({ values: [1.5] }));
  assert.deepEqual(keyed.body.reasons.map((r) => r.key), ['hold.buddy.durationSeconds']);
  assert.deepEqual((await post({ experimentId: 'points', change: { value: 'a', basis: 'x' } })).body.reasons.map((r) => r.key), ['comparison.pointsAllowanceMultiplier']);
  assert.equal((await s.call('greg', 'POST', PATHS.jobs, undefined)).http, 400);
  assert.equal(s.spawned.length, 0);
  assert.deepEqual(await s.rows('comparison_jobs'), []);
  assert.equal((await s.call('greg', 'GET', PATHS.latest)).http, 404);

  // The worker's canonical check still decides range, unit and "same as today".
  for (const values of [[7200], [100]]) {
    const before = s.spawned.length;
    const refused = await post(hold({ values }));
    assert.equal(refused.http, 400, JSON.stringify(refused.body));
    assert.deepEqual(refused.body.reasons.map(({ field, key }) => ({ field, key })), [{ field: 'change.values', key: 'hold.buddy.durationSeconds' }]);
    assert.match(refused.body.reasons[0].reason, /\S/);
    assert.equal(s.spawned.length, before + 1);
    assert.deepEqual(await s.rows('comparison_jobs'), []);
  }
  assert.equal((await s.call('greg', 'GET', PATHS.latest)).http, 404);
});

test('parseExperimentRequest returns only the accepted fields', () => {
  assert.deepEqual(parseExperimentRequest({ experimentId: 'process-only' }).value, { experimentId: 'process-only' });
  const mix = [{ modelLine: 'G20 Saloon|320i', weight: 100 }];
  assert.deepEqual(parseExperimentRequest({ experimentId: 'order-mix', change: { value: mix, basis: 'Why' } }).value,
    { experimentId: 'order-mix', change: { value: mix, basis: 'Why' } });
  assert.deepEqual(parseExperimentRequest({ experimentId: 'hold-sweep', change: { values: [900, 1800], basis: 'Why' } }).value,
    { experimentId: 'hold-sweep', change: { values: [900, 1800], basis: 'Why' } });
  assert.equal(parseExperimentRequest(null).reasons[0].field, 'body');
  for (const id of EXPERIMENT_IDS) assert.equal(parseExperimentRequest({ experimentId: id, seeds: [1] }).status, 'invalid');
});

test('the latest-job and stored-result reads answer 404 when empty, and refuse other queries', async (t) => {
  const s = await serve();
  t.after(s.close);
  const none = await s.call('greg', 'GET', PATHS.latest);
  assert.equal(none.http, 404);
  assert.equal(none.body.status, 'not-found');
  assert.equal((await s.call('greg', 'GET', `${PATHS.latest}?jobId=comparison-job-missing`)).http, 404);

  const query = await s.call('greg', 'GET', `${PATHS.latest}?view=full&sort=up`);
  assert.equal(query.http, 400);
  assert.equal(query.body.code, 'unsupported-query');
  assert.deepEqual(query.body.reasons.map((r) => r.field), ['view', 'sort']);
  assert.equal((await s.call('greg', 'GET', `${PATHS.latest}?jobId=`)).body.reasons[0].field, 'jobId');
  assert.equal((await s.call('greg', 'GET', `${PATHS.results}?jobId=x`)).body.reasons[0].field, 'jobId');
  const bad = await s.call('greg', 'GET', `${PATHS.results}?experimentId=bogus`);
  assert.equal(bad.http, 400);
  assert.deepEqual(bad.body.reasons.map(({ field, key }) => ({ field, key })), [{ field: 'experimentId', key: null }]);

  const empty = await s.call('presenter', 'GET', PATHS.results);
  assert.equal(empty.http, 200);
  assert.deepEqual(empty.body.value.experiments, EXPERIMENT_IDS.map((experimentId) => ({ experimentId, latest: null })));
  assert.equal(typeof empty.body.value.activePolicyVersion, 'string');
  assert.equal((await s.call('greg', 'GET', `${PATHS.results}?experimentId=points`)).http, 404);
  assert.equal(s.spawned.length, 0);

  const started = await s.call('greg', 'POST', PATHS.jobs, processOnly);
  assert.equal(started.http, 202);
  await until(() => s.call('greg', 'GET', PATHS.latest), settled);
  const all = await s.call('greg', 'GET', PATHS.results);
  assert.equal(all.http, 200);
  const latestOf = Object.fromEntries(all.body.value.experiments.map((entry) => [entry.experimentId, entry.latest]));
  assert.equal(latestOf['process-only'].resultId, (await s.call('greg', 'GET', PATHS.latest)).body.value.resultId);
  assert.equal(latestOf['hold-sweep'], null);
  assert.equal((await s.call('greg', 'GET', `${PATHS.results}?experimentId=process-only`)).body.value.resultId, latestOf['process-only'].resultId);
});

test('the runtime exposes the job service, spawns no worker, and closes it first', async () => {
  const created = await createGcspRuntime({ mode: 'memory', environmentId: 'comparison-routes-runtime', policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap' });
  assert.equal(created.status, 'ok', JSON.stringify(created));
  const runtime = created.value;
  assert.equal(runtime.dependencies.gcspComparisonJobs, runtime.comparisonJobs);
  assert.equal(typeof runtime.comparisonJobs.start, 'function');
  // Nothing has started a worker or written a job row.
  assert.deepEqual((await runtime.repository.query(scope, 'comparison_jobs')).value ?? [], []);
  const order = [];
  const close = runtime.comparisonJobs.close.bind(runtime.comparisonJobs);
  runtime.comparisonJobs.close = async () => { order.push('jobs'); await close(); throw new Error('close failed'); };
  const notifyClose = runtime.notify.close.bind(runtime.notify);
  runtime.notify.close = async () => { order.push('notify'); return notifyClose(); };
  await runtime.close();
  // A failing job close does not skip the rest.
  assert.deepEqual(order, ['jobs', 'notify']);
});

test('closing the job service with an active job marks it interrupted', async (t) => {
  const s = await serve({ fake: 'hang' });
  t.after(s.close);
  const started = await s.call('greg', 'POST', PATHS.jobs, processOnly);
  assert.equal(started.http, 202);
  await s.jobs.close();
  const view = await s.call('greg', 'GET', `${PATHS.latest}?jobId=${started.body.value.jobId}`);
  assert.equal(view.body.value.status, 'interrupted');
  assert.equal(view.body.value.reason, 'The backend stopped before the comparison finished.');
  assert.deepEqual(await s.rows('comparison_results'), []);
});
