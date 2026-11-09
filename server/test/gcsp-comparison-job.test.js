import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { runComparison } from '../gcsp/comparison/experiments.js';
import { readLatestComparisonResult, storeComparisonResult, COMPARISON_RESULTS_ENVIRONMENT, COMPARISON_RESULTS_RUN } from '../gcsp/comparison/results.js';
import { parseComparisonArgs, runComparisonCli, writeComparisonResultFile, readComparisonResultFile, importComparisonResult,
  COMPARISON_CLI_CONTEXT } from '../gcsp/comparison/job.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { once } from 'node:events';
import { createComparisonResultRoutes, createComparisonResultService } from '../gcsp/comparison/http.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const buddyFixture = JSON.parse(readFileSync(new URL('./fixtures/gcsp-comparison-buddy-outcomes.json', import.meta.url), 'utf8'));
const NOW = '2026-11-08T12:00:00.000Z';
const REVISION = 'job-test';
// One PolicyService for the module: it caches policy snapshots by provider identity.
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const options = { policy, codeRevision: REVISION, now: () => NOW };
const experiment = { experimentId: 'process-only', overlay: buddyFixture.overlay };
const direct = await runComparison(experiment, options);
const scope = { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT, ...COMPARISON_CLI_CONTEXT };

const openRepository = async () => {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW });
  assert.equal((await repository.open()).status, 'ok');
  return repository;
};
const stored = async (repository) => (await repository.query(scope, 'comparison_results')).value ?? [];
const latest = (repository) => readLatestComparisonResult(repository, COMPARISON_CLI_CONTEXT, policy, { asOf: NOW });
const cli = async (argv, extra = {}) => {
  const out = []; const err = [];
  const outcome = await runComparisonCli({ argv, env: {}, now: () => NOW, codeRevision: REVISION, overlay: buddyFixture.overlay,
    stdout: (text) => out.push(text), stderr: (text) => err.push(text), ...extra });
  return { ...outcome, out: out.join(''), err: err.join('') };
};
const scratch = async (work) => {
  const dir = await mkdtemp(join(tmpdir(), 'gcsp-comparison-job-'));
  try { return await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
};
const exists = (path) => access(path).then(() => true, () => false);

test('the command stores the same result as the shared runner and reads it back', async () => {
  const repository = await openRepository();
  // No policy injected: the default memory mode must serve the seeded policy to the runner.
  const run = await cli(['--experiment', 'process'], { repository });
  assert.equal(run.exitCode, 0, run.err);
  assert.deepEqual(run.result, direct);
  const read = await latest(repository);
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.value.result, direct);
  assert.equal(read.value.resultId, run.stored.resultId);
  assert.equal(read.value.policyCurrent, true);
  assert.equal((await stored(repository)).length, 1);
});

test('the printed output has the header, one row per measure, the caveat and the limitations', async () => {
  const repository = await openRepository();
  const run = await cli(['--experiment', 'process'], { repository, policy });
  const lines = run.out.split('\n');
  const rule = lines.findIndex((line) => /^-+(\s+-+)+$/.test(line));
  const rows = lines.slice(rule + 1, lines.indexOf('', rule));
  assert.equal(rows.length, direct.differences.length);
  for (const entry of direct.differences) assert.ok(entry.measure.startsWith('accessGroupCoverage:')
    ? rows.some((row) => row.includes(entry.measure.slice('accessGroupCoverage:'.length))) : true);
  assert.ok(rows.every((row, index) => /(no clear difference|buddy route better|today's route better|too few seeds)$/.test(row)), rows.join('\n'));
  assert.match(rows[0], /%/);
  assert.match(run.out, /Today's release route/);
  for (const text of [direct.caveat, ...direct.limitations, run.stored.resultId, REVISION, direct.manifest.policyVersion, NOW]) {
    assert.ok(run.out.includes(text), text);
  }
  assert.ok(!/[—–]/.test(run.out), 'no em or en dashes in printed copy');
  assert.match(run.err, /Seed comparison-a: buddy route replayed/);
});

test('seeds are parsed as numbers where safe and default to the policy seeds', async () => {
  assert.deepEqual(parseComparisonArgs(['--experiment', 'process', '--seeds', '1,2,x,9007199254740993,-3']).value.seeds,
    [1, 2, 'x', '9007199254740993', -3]);
  assert.deepEqual(parseComparisonArgs(['--experiment=process', '--seeds=a,b']).value, { experiment: 'process', seeds: ['a', 'b'] });
  assert.equal(parseComparisonArgs(['--experiment', 'process']).value.seeds, undefined);
  const numeric = await cli(['--experiment', 'process', '--seeds', '11,12,13'], { repository: await openRepository(), policy });
  assert.equal(numeric.exitCode, 0, numeric.err);
  assert.deepEqual(numeric.result.manifest.seeds, [11, 12, 13]);
  assert.deepEqual(direct.manifest.seeds, ['comparison-a', 'comparison-b', 'comparison-c']);
});

test('invalid input is refused with a reason, exit code 2 and nothing stored', async () => {
  const cases = [
    [['--experiment', 'order-mix'], /only supported experiment is process/],
    [['--experiment', 'process', '--bogus'], /Unknown option "--bogus"/],
    [['--experiment'], /--experiment needs a value/],
    [['--experiment', 'process', '--seeds'], /--seeds needs a value/],
    [['--experiment', 'process', '--out', '--seeds', 'a'], /--out needs a value/],
    [['--experiment', 'process', '--experiment', 'process'], /more than once/],
    [['process'], /Unknown option/],
    [[], /Give --experiment process/],
    [['--experiment', 'process', '--seeds', 'a,a,b'], /seeds are not valid/],
    [['--experiment', 'process', '--seeds', 'a,,b'], /empty seed/],
    [['--experiment', 'process', '--seeds', ''], /empty seed/],
    [['--import', 'x.json', '--experiment', 'process'], /cannot be combined/],
  ];
  for (const [argv, reason] of cases) {
    const repository = await openRepository();
    const run = await cli(argv, { repository, policy });
    assert.equal(run.exitCode, 2, `${argv.join(' ')}: ${run.err}`);
    assert.match(run.err, reason);
    assert.match(run.err, /\S/);
    assert.equal(run.out, '');
    assert.equal((await stored(repository)).length, 0);
    assert.equal((await latest(repository)).status, 'not-found');
  }
  const noUrl = await cli(['--experiment', 'process'], { env: { GCSP_REPOSITORY_MODE: 'postgres' }, overlay: undefined });
  assert.equal(noUrl.exitCode, 2);
  assert.match(noUrl.err, /GCSP_DATABASE_URL is not set/);
  const badMode = await cli(['--experiment', 'process'], { env: { GCSP_REPOSITORY_MODE: 'files' } });
  assert.equal(badMode.exitCode, 2);
});

test('an invalid seed list writes no file', () => scratch(async (dir) => {
  const out = join(dir, 'result.json');
  const run = await cli(['--experiment', 'process', '--seeds', 'a,a', '--out', out], { repository: await openRepository(), policy });
  assert.equal(run.exitCode, 2);
  assert.equal(await exists(out), false);
}));

test('an execution failure reports the reason and stores and writes nothing', () => scratch(async (dir) => {
  const repository = await openRepository();
  const out = join(dir, 'result.json');
  const unavailable = { getAssumption: async () => ({ status: 'unavailable' }) };
  const run = await cli(['--experiment', 'process', '--out', out], { repository, policy: unavailable });
  assert.equal(run.exitCode, 1);
  assert.match(run.err, /Comparison run unavailable: comparison\.startsAt/);
  assert.match(run.err, /Nothing was stored/);
  assert.equal(run.out, '');
  assert.equal((await stored(repository)).length, 0);
  assert.deepEqual(await readdir(dir), []);
}));

test('a repository that cannot be opened is a fixed-reason failure that never prints the database URL', async () => {
  const url = 'postgres://demo-user:demo-secret@127.0.0.1:1/demo-db';
  const run = await cli(['--experiment', 'process'], { env: { GCSP_REPOSITORY_MODE: 'postgres', GCSP_DATABASE_URL: url } });
  assert.equal(run.exitCode, 1);
  assert.match(run.err, /Could not open the postgres repository/);
  for (const text of ['demo-secret', 'demo-user', '127.0.0.1', 'demo-db']) assert.ok(!run.out.includes(text) && !run.err.includes(text), text);
});

test('postgres mode replays in memory: policy never comes from the database, only the result is stored (FUCQ-241)', async () => {
  const repository = await openRepository();
  const url = 'postgres://demo-user:demo-secret@127.0.0.1:1/demo-db';
  const run = await cli(['--experiment', 'process'], { env: { GCSP_REPOSITORY_MODE: 'postgres', GCSP_DATABASE_URL: url }, repository });
  assert.equal(run.exitCode, 0, run.err);
  assert.deepEqual(run.result, direct);
  assert.deepEqual((await latest(repository)).value.result, direct);
  for (const text of ['demo-secret', 'demo-user', '127.0.0.1', 'demo-db']) assert.ok(!run.out.includes(text) && !run.err.includes(text), text);
});

test('--out writes a verified file that imports idempotently into a fresh repository', () => scratch(async (dir) => {
  const out = join(dir, 'nested', 'result.json');
  const run = await cli(['--experiment', 'process', '--out', out], { repository: await openRepository(), policy });
  assert.equal(run.exitCode, 0, run.err);
  assert.deepEqual(await readdir(join(dir, 'nested')), ['result.json']);
  const read = await readComparisonResultFile(out);
  assert.equal(read.status, 'ok');
  assert.deepEqual(read.value, direct);

  const fresh = await openRepository();
  const imported = await importComparisonResult(fresh, COMPARISON_CLI_CONTEXT, out);
  assert.equal(imported.status, 'ok');
  assert.equal(imported.value.resultId, run.stored.resultId);
  assert.deepEqual((await latest(fresh)).value.result, direct);
  const before = await stored(fresh);
  const again = await importComparisonResult(fresh, COMPARISON_CLI_CONTEXT, out);
  assert.equal(again.status, 'ok');
  assert.deepEqual(await stored(fresh), before);

  const viaCli = await cli(['--import', out], { repository: await openRepository() });
  assert.equal(viaCli.exitCode, 0, viaCli.err);
  assert.equal(viaCli.stored.resultId, run.stored.resultId);
  assert.match(viaCli.out, new RegExp(direct.caveat));
}));

test('a changed, foreign or unreadable result file is refused and not stored', () => scratch(async (dir) => {
  const good = join(dir, 'good.json');
  await writeComparisonResultFile(good, direct);
  const envelope = JSON.parse(await readFile(good, 'utf8'));
  const variants = {
    tampered: [{ ...envelope, result: { ...envelope.result, completedAt: '2026-11-09T00:00:00.000Z' } }, /digest does not match/],
    format: [{ ...envelope, format: 'something-else' }, /is not a gcsp-process-comparison-result-v1 file/],
    caveat: [(() => { const result = { ...direct, caveat: 'Calculated fit is observed satisfaction.' };
      return { ...envelope, result, digest: inputDigest(result) }; })(), /does not hold a process comparison result/],
    kind: [(() => { const result = { ...direct, kind: 'other' };
      return { ...envelope, result, digest: inputDigest(result) }; })(), /does not hold a process comparison result/],
  };
  for (const [name, [content, reason]] of Object.entries(variants)) {
    const path = join(dir, `${name}.json`);
    await writeFile(path, JSON.stringify(content));
    const read = await readComparisonResultFile(path);
    assert.equal(read.status, 'invalid', name);
    assert.match(read.reason, reason, name);
    const repository = await openRepository();
    assert.equal((await importComparisonResult(repository, COMPARISON_CLI_CONTEXT, path)).status, 'invalid');
    const run = await cli(['--import', path], { repository });
    assert.equal(run.exitCode, 2, name);
    assert.equal((await stored(repository)).length, 0, name);
  }
  await writeFile(join(dir, 'broken.json'), '{ not json');
  assert.equal((await readComparisonResultFile(join(dir, 'broken.json'))).status, 'invalid');
  assert.match((await readComparisonResultFile(join(dir, 'missing.json'))).reason, /does not exist/);
}));

test('a storage failure after a successful run keeps the file and says how to store it later', () => scratch(async (dir) => {
  const repository = await openRepository();
  const failing = new Proxy(repository, { get: (target, name) => name === 'transaction'
    ? async () => ({ status: 'unavailable', reason: 'database-unavailable', retryable: true }) : target[name] });
  const out = join(dir, 'result.json');
  const run = await cli(['--experiment', 'process', '--out', out], { repository: failing, policy });
  assert.equal(run.exitCode, 1);
  assert.match(run.err, /could not be stored/);
  assert.ok(run.err.includes(`--import ${out}`));
  assert.equal((await readComparisonResultFile(out)).status, 'ok');
  assert.equal((await stored(repository)).length, 0);
}));

test('nothing runs on import, startup or a timer, and only the command runs the comparison', () => {
  const quiet = (specifier) => spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)});`],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  for (const specifier of ['./server/gcsp/comparison/job.js', './scripts/gcsp-comparison.mjs']) {
    const loaded = quiet(specifier);
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout + loaded.stderr, '', specifier);
  }
  const help = spawnSync(process.execPath, ['scripts/gcsp-comparison.mjs', '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--experiment process/);
  assert.match(help.stdout, /replay always runs in memory/);
  assert.match(help.stdout, /Only the result is stored, through GCSP_REPOSITORY_MODE/);
  const refused = spawnSync(process.execPath, ['scripts/gcsp-comparison.mjs', '--experiment', 'order-mix'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(refused.status, 2);
  for (const file of ['server/gcsp/comparison/job.js', 'scripts/gcsp-comparison.mjs']) {
    assert.ok(!/setInterval|setTimeout|cron|listen\(/i.test(readFileSync(join(ROOT, file), 'utf8')), `${file} schedules nothing`);
  }
});

test('postgresql: the command stores into a temporary schema and reads the result back', {
  skip: process.env.GCSP_DATABASE_URL === undefined ? 'GCSP_DATABASE_URL is unset; the PostgreSQL store was not run' : false,
}, async () => {
  const schema = `gcsp_comparison_job_${process.pid}_1`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  pool.on('error', () => {});
  let created = false;
  const repository = createPostgresRepository({ connectionString: process.env.GCSP_DATABASE_URL, schema });
  try {
    try { await pool.query(`CREATE SCHEMA "${schema}"`); created = true; }
    catch { throw new Error('PostgreSQL comparison fixture unavailable'); }
    assert.equal((await repository.open()).status, 'ok');
    // The command picks its own policy here; only the result store may reach PostgreSQL (FUCQ-241).
    const texts = []; const query = pg.Client.prototype.query;
    pg.Client.prototype.query = function (config, ...rest) { texts.push(typeof config === 'string' ? config : config?.text ?? ''); return query.call(this, config, ...rest); };
    let run;
    try { run = await cli(['--experiment', 'process'], { repository, env: { GCSP_REPOSITORY_MODE: 'postgres', GCSP_DATABASE_URL: process.env.GCSP_DATABASE_URL } }); }
    finally { pg.Client.prototype.query = query; }
    assert.equal(run.exitCode, 0, run.err);
    assert.deepEqual(texts.filter((text) => /policy_versions|scheme_rule_links|eligibility_rules|price_plans|grade_allowances|policy_assumptions/.test(text)), []);
    assert.ok(texts.length <= 20, `${texts.length} queries for one stored result`);
    const read = await latest(repository);
    assert.equal(read.status, 'ok');
    assert.deepEqual(read.value.result, direct);
    assert.equal(read.value.resultId, run.stored.resultId);
    const again = await cli(['--import', '/nonexistent/none.json'], { repository });
    assert.equal(again.exitCode, 2);
    assert.equal((await stored(repository)).length, 1);
  } finally {
    await repository.close();
    try {
      if (created) {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        const absent = await pool.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1', [schema]);
        assert.equal(absent.rows[0].count, 0, 'The exact owned comparison schema must be absent.');
      }
    } catch { throw new Error('PostgreSQL comparison fixture cleanup incomplete'); }
    finally { await pool.end(); }
  }
});

// The stored read has its own environment, so identity and clock come from a separate demo runtime.
const readFixture = async (repository) => {
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'comparison-read-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('comparison-read-presenter');
  const greg = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'comparison-read-greg');
  const paula = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'comparison-read-paula');
  return { clock, identity, sessions: { presenter, greg, paula } };
};

test('the stored read serves Greg and presenter, refuses employees, and reports whether the policy is current', async () => {
  const repository = await openRepository();
  const f = await readFixture(repository);
  const [greg, paula, presenter] = [f.sessions.greg, f.sessions.paula, f.sessions.presenter].map((session) => session.value.context);
  const service = createComparisonResultService({ repository, policy, clock: f.clock, identity: f.identity });
  assert.equal((await service.readLatest(greg)).status, 'not-found');
  assert.equal((await service.readLatest(paula)).status, 'forbidden');
  const saved = await storeComparisonResult(repository, COMPARISON_CLI_CONTEXT, direct);
  assert.equal(saved.status, 'ok', JSON.stringify(saved));
  for (const context of [greg, presenter]) {
    const found = await service.readLatest(context);
    assert.equal(found.status, 'ok', JSON.stringify(found));
    assert.deepEqual(found.value.result, direct);
    assert.equal(found.value.resultId, saved.value.resultId);
    assert.equal(found.value.policyVersion, direct.manifest.policyVersion);
    assert.equal(found.value.activePolicyVersion, direct.manifest.policyVersion);
    assert.equal(found.value.policyCurrent, true);
  }
  assert.equal((await service.readLatest(paula)).status, 'forbidden');

  const drifted = { getActiveVersion: async () => ({ status: 'ok', policyVersion: 'gcsp-policy-drifted', value: {} }) };
  const stale = await createComparisonResultService({ repository, policy: drifted, clock: f.clock, identity: f.identity }).readLatest(greg);
  assert.equal(stale.status, 'ok');
  assert.equal(stale.value.policyCurrent, false);
  assert.equal(stale.value.activePolicyVersion, 'gcsp-policy-drifted');

  const broken = { query: async () => { throw new Error('database-unavailable at postgres://secret-host'); } };
  const unavailable = await createComparisonResultService({ repository: broken, policy, clock: f.clock, identity: f.identity }).readLatest(greg);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.retryable, true);
  assert.ok(!JSON.stringify(unavailable).includes('secret-host'));

  const [route] = createComparisonResultRoutes(service);
  const refused = await route.handle({ context: greg, searchParams: new URLSearchParams('view=full') });
  assert.equal(refused.status, 'invalid');
  assert.equal(refused.code, 'unsupported-query');
  const unconfigured = await createComparisonResultRoutes(undefined)[0].handle({ context: greg, searchParams: new URLSearchParams() });
  assert.equal(unconfigured.status, 'unavailable');
});

test('buildServer serves the stored read with no-store, 404 until stored, 403 for employees and 400 for a query', async () => {
  const repository = await openRepository();
  const f = await readFixture(repository);
  const service = createComparisonResultService({ repository, policy, clock: f.clock, identity: f.identity });
  const oldKey = process.env.DEMO_ACCESS_KEY;
  const accessKey = 'comparison-read-fixture-key';
  process.env.DEMO_ACCESS_KEY = accessKey;
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspComparison: service, gcspAllowedOrigins: ['https://greg.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cookie = (session) => [session.value.setCookie].flat().map((c) => c.split(';')[0]).join('; ');
  const read = async (session, query = '') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/comparison/process/latest${query}`, {
      headers: { Origin: 'https://greg.test', Cookie: cookie(session), 'X-Access-Key': accessKey } });
    return { status: response.status, body: await response.json(), cache: response.headers.get('Cache-Control') };
  };
  try {
    const empty = await read(f.sessions.greg);
    assert.equal(empty.status, 404); assert.equal(empty.body.status, 'not-found');
    const saved = await storeComparisonResult(repository, COMPARISON_CLI_CONTEXT, direct);
    assert.equal(saved.status, 'ok', JSON.stringify(saved));
    const found = await read(f.sessions.greg);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.cache, 'no-store');
    assert.equal(found.body.value.resultId, saved.value.resultId);
    assert.equal(found.body.value.policyCurrent, true);
    assert.deepEqual(found.body.value.result, JSON.parse(JSON.stringify(direct)));
    assert.equal((await read(f.sessions.presenter)).status, 200);
    assert.equal((await read(f.sessions.paula)).status, 403);
    const query = await read(f.sessions.greg, '?view=full');
    assert.equal(query.status, 400); assert.equal(query.body.code, 'unsupported-query');
  } finally {
    server.closeAllConnections(); await new Promise((done) => server.close(done));
    if (oldKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = oldKey;
  }
});

// Captures the one-line log and warning the runtime writes while it opens with a result file.
const openWithResultFile = async (comparisonResultFile) => {
  const logs = []; const warnings = [];
  const { log, warn } = console;
  console.log = (text) => logs.push(String(text));
  console.warn = (text) => warnings.push(String(text));
  try {
    const runtime = await createGcspRuntime({ mode: 'memory', comparisonResultFile, environmentId: 'comparison-import-test',
      policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap' });
    return { runtime, logs, warnings };
  } finally { console.log = log; console.warn = warn; }
};
const gregContext = async ({ identity }) => {
  const presenter = await identity.createPresenterSession('comparison-import-presenter');
  return (await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'comparison-import-greg')).value.context;
};

test('a result file named at runtime open is loaded for Greg; a missing or changed file leaves startup intact', () => scratch(async (dir) => {
  const good = join(dir, 'good.json');
  await writeComparisonResultFile(good, direct);
  const resultId = (await storeComparisonResult(await openRepository(), COMPARISON_CLI_CONTEXT, direct)).value.resultId;
  const envelope = JSON.parse(await readFile(good, 'utf8'));
  const changed = join(dir, 'changed.json');
  await writeFile(changed, JSON.stringify({ ...envelope, result: { ...envelope.result, completedAt: '2026-11-09T00:00:00.000Z' } }));
  const missing = join(dir, 'missing.json');

  const loaded = await openWithResultFile(good);
  assert.equal(loaded.runtime.status, 'ok', JSON.stringify(loaded.runtime));
  try {
    assert.deepEqual(loaded.logs.filter((line) => line.startsWith('GCSP comparison')), [`GCSP comparison: loaded result ${resultId}.`]);
    assert.deepEqual(loaded.warnings, []);
    const read = await loaded.runtime.value.comparison.readLatest(await gregContext(loaded.runtime.value));
    assert.equal(read.status, 'ok', JSON.stringify(read));
    assert.equal(read.value.resultId, resultId);
    assert.deepEqual(read.value.result, direct);
    assert.equal(read.value.policyCurrent, true);
  } finally { await loaded.runtime.value.close(); }

  for (const path of [missing, changed]) {
    const refused = await openWithResultFile(path);
    assert.equal(refused.runtime.status, 'ok', JSON.stringify(refused.runtime));
    try {
      assert.equal(refused.warnings.length, 1);
      assert.match(refused.warnings[0], /^GCSP comparison: the result file was not loaded \((The file .* does not exist|The file has changed)/);
      assert.equal((await refused.runtime.value.comparison.readLatest(await gregContext(refused.runtime.value))).status, 'not-found');
    } finally { await refused.runtime.value.close(); }
  }
}));
