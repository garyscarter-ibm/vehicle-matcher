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
import { readLatestComparisonResult, COMPARISON_RESULTS_ENVIRONMENT, COMPARISON_RESULTS_RUN } from '../gcsp/comparison/results.js';
import { parseComparisonArgs, runComparisonCli, writeComparisonResultFile, readComparisonResultFile, importComparisonResult, COMPARISON_CLI_CONTEXT } from '../gcsp/comparison/job.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { once } from 'node:events';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const buddyFixture = JSON.parse(readFileSync(new URL('./fixtures/gcsp-comparison-buddy-outcomes.json', import.meta.url), 'utf8'));
const NOW = '2026-11-08T12:00:00.000Z';
const REVISION = 'job-test';
// One PolicyService for the module: it caches policy snapshots by provider identity.
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const options = { policy, codeRevision: REVISION, now: () => NOW };
const experiment = { experimentId: 'process-only', overlay: buddyFixture.overlay };
const direct = await runComparison(experiment, options);
const sweepChange = { values: [3600], basis: 'Does a shorter hold help?' };
const sweepArgs = ['--experiment', 'hold-sweep', '--change', JSON.stringify(sweepChange)];
const sweepDirect = await runComparison({ experimentId: 'hold-sweep', change: sweepChange, overlay: buddyFixture.overlay }, options);
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
    [['--experiment', 'order-mix'], /^change: Give the change to try\./],
    [['--experiment', 'nonsense'], /Unsupported experiment "nonsense"\. Choose process, order-mix, points, hold-sweep/],
    [['--experiment', 'constructor'], /Unsupported experiment/],
    [['--experiment', 'process', '--change', '{"value":2,"basis":"x"}'], /^change: The process comparison takes no change\./],
    [['--experiment', 'hold-sweep', '--change', '{not json'], /--change is not valid JSON/],
    [['--experiment', 'hold-sweep', '--change', ''], /--change needs a value/],
    [['--experiment', 'hold-sweep', '--change', 'null'], /^change: Give a change with a list of values and a basis/],
    [['--import', 'x.json', '--change', '{}'], /cannot be combined/],
    [['--experiment', 'process', '--bogus'], /Unknown option "--bogus"/],
    [['--experiment'], /--experiment needs a value/],
    [['--experiment', 'process', '--seeds'], /--seeds needs a value/],
    [['--experiment', 'process', '--out', '--seeds', 'a'], /--out needs a value/],
    [['--experiment', 'process', '--experiment', 'process'], /more than once/],
    [['process'], /Unknown option/],
    [[], /Give --experiment to run a comparison/],
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
    format: [{ ...envelope, format: 'something-else' }, /is not a gcsp-process-comparison-result-v1 or gcsp-experiment-comparison-result-v1 file/],
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

test('an experiment is checked like the browser request, naming every field at once, and stores nothing', async () => {
  const repository = await openRepository();
  const bad = await cli(['--experiment', 'hold-sweep', '--change', '{"values":[1.5,1.5],"basis":"","extra":1}'], { repository, policy });
  assert.equal(bad.exitCode, 2);
  assert.equal(bad.out, '');
  const lines = bad.err.trim().split('\n');
  for (const field of ['change.values (hold.buddy.durationSeconds): ', 'change.basis: ', 'change.extra: ']) {
    assert.ok(lines.some((line) => line.startsWith(field)), `${field}\n${bad.err}`);
  }
  assert.equal(lines.at(-1), 'Nothing was stored.');
  const same = await cli(['--experiment', 'hold-sweep', '--change', '{"values":[7200],"basis":"The current value"}'], { repository, policy });
  assert.equal(same.exitCode, 2, same.err);
  assert.match(same.err, /^change\.values \(hold\.buddy\.durationSeconds\): Give no more holds than the policy allows/);
  assert.equal(same.out, '');
  const tooMany = await cli(['--experiment', 'hold-sweep', '--change', JSON.stringify({ values: Array.from({ length: 40 }, (_, i) => 3600 + i), basis: 'x' })],
    { repository, policy });
  assert.equal(tooMany.exitCode, 2);
  assert.match(tooMany.err, /^change\.values \(hold\.buddy\.durationSeconds\): Give no more holds than the policy allows/);
  const badSeeds = await cli([...sweepArgs, '--seeds', 'a,a'], { repository, policy });
  assert.equal(badSeeds.exitCode, 2);
  assert.match(badSeeds.err, /seeds are not valid/);
  assert.equal((await stored(repository)).length, 0);
});

test('an experiment run prints the change and one table per effect and route, then round trips through a file', () => scratch(async (dir) => {
  const out = join(dir, 'sweep.json');
  const repository = await openRepository();
  const run = await cli([...sweepArgs, '--out', out], { repository, policy });
  assert.equal(run.exitCode, 0, run.err);
  assert.deepEqual(run.result, sweepDirect);
  assert.deepEqual((await readLatestComparisonResult(repository, COMPARISON_CLI_CONTEXT, policy, { asOf: NOW, experimentId: 'hold-sweep' })).value.result, sweepDirect);
  for (const text of ['hold-sweep', sweepChange.basis, '3600 seconds', 'Used today: 7200 seconds', 'Change: hold.buddy.durationSeconds (seconds)',
    sweepDirect.caveat, ...sweepDirect.limitations, run.stored.resultId, REVISION, sweepDirect.manifest.policyVersion, NOW,
    "3600 seconds against 7200 seconds: today's release route", '3600 seconds against 7200 seconds: buddy route']) {
    assert.ok(run.out.includes(text), text);
  }
  const verdicts = /(no clear difference|tried value better|today's value better|too few seeds)$/;
  const rows = run.out.split('\n').filter((line) => /^(Employees with an acceptable car|Cars never allocated|Offers declined)/.test(line));
  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => verdicts.test(row)), rows.join('\n'));
  assert.ok(!/[—–]/.test(run.out), 'no em or en dashes in printed copy');
  assert.match(run.err, /Seed comparison-a, hold-3600: buddy route replayed/);

  const envelope = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(envelope.format, 'gcsp-experiment-comparison-result-v1');
  const read = await readComparisonResultFile(out);
  assert.deepEqual(read.value, sweepDirect);
  const fresh = await openRepository();
  const imported = await importComparisonResult(fresh, COMPARISON_CLI_CONTEXT, out);
  assert.equal(imported.status, 'ok', JSON.stringify(imported));
  assert.equal(imported.value.resultId, run.stored.resultId);
  const before = await stored(fresh);
  assert.equal((await importComparisonResult(fresh, COMPARISON_CLI_CONTEXT, out)).status, 'ok');
  assert.deepEqual(await stored(fresh), before);
  assert.equal(before.length, 1);
  const viaCli = await cli(['--import', out], { repository: await openRepository() });
  assert.equal(viaCli.exitCode, 0, viaCli.err);
  assert.equal(viaCli.stored.resultId, run.stored.resultId);
  assert.ok(viaCli.out.includes(sweepChange.basis));
}));

test('a process file still imports, and a changed or mismatched experiment file is refused', () => scratch(async (dir) => {
  const processFile = join(dir, 'process.json');
  await writeComparisonResultFile(processFile, direct);
  assert.equal(JSON.parse(await readFile(processFile, 'utf8')).format, 'gcsp-process-comparison-result-v1');
  assert.equal((await importComparisonResult(await openRepository(), COMPARISON_CLI_CONTEXT, processFile)).status, 'ok');

  const good = join(dir, 'sweep.json');
  await writeComparisonResultFile(good, sweepDirect);
  const envelope = JSON.parse(await readFile(good, 'utf8'));
  const redigest = (result, format = envelope.format) => ({ format, result, digest: inputDigest(result) });
  const variants = {
    tampered: [{ ...envelope, result: { ...envelope.result, completedAt: '2026-11-09T00:00:00.000Z' } }, /digest does not match/],
    caveat: [redigest({ ...sweepDirect, caveat: 'Calculated fit is observed satisfaction.' }), /does not hold an experiment comparison result/],
    process: [redigest({ ...sweepDirect, experimentId: 'process-only' }), /does not hold an experiment comparison result/],
    unknown: [redigest({ ...sweepDirect, experimentId: 'other-sweep' }), /does not hold an experiment comparison result/],
    kind: [redigest({ ...sweepDirect, kind: 'process-comparison' }), /does not hold an experiment comparison result/],
    wrongFormat: [redigest(sweepDirect, 'gcsp-process-comparison-result-v1'), /does not hold a process comparison result/],
  };
  for (const [name, [content, reason]] of Object.entries(variants)) {
    const path = join(dir, `${name}.json`);
    await writeFile(path, JSON.stringify(content));
    const read = await readComparisonResultFile(path);
    assert.equal(read.status, 'invalid', name);
    assert.match(read.reason, reason, name);
    const repository = await openRepository();
    const run = await cli(['--import', path], { repository });
    assert.equal(run.exitCode, 2, name);
    assert.equal((await stored(repository)).length, 0, name);
  }
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
  for (const specifier of ['./server/gcsp/comparison/job.js', './scripts/gcsp-comparison.mjs', './server/gcsp/comparison/jobs.js',
    './server/gcsp/comparison/worker.js', './server/gcsp/comparison/requests.js']) {
    const loaded = quiet(specifier);
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.equal(loaded.stdout + loaded.stderr, '', specifier);
  }
  const help = spawnSync(process.execPath, ['scripts/gcsp-comparison.mjs', '--help'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--experiment process/);
  assert.match(help.stdout, /--experiment <order-mix\|points\|hold-sweep> --change <json>/);
  assert.match(help.stdout, /Exit codes: 0 stored, 2 refused input or file, 1 failed\./);
  assert.match(help.stdout, /replay always runs in memory/);
  assert.match(help.stdout, /Only the result is stored, through GCSP_REPOSITORY_MODE/);
  const refused = spawnSync(process.execPath, ['scripts/gcsp-comparison.mjs', '--experiment', 'order-mix'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^change: Give the change to try\./);
  assert.equal(refused.stdout, '');
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
