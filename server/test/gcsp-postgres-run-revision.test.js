import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputDigest, ok, result, FOUNDATION_TABLES } from '../gcsp/repository/core.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { DEFAULT_MIGRATIONS_DIRECTORY } from '../gcsp/migrations/index.js';

// FUCQ-421: freshness is a transactional run revision; native PostgreSQL only.
const native = { skip: process.env.GCSP_DATABASE_URL === undefined ? 'native PostgreSQL URL unset' : false };
let serial = 0;
const command = (id = `cmd-${++serial}`) => ({ commandId: id, inputDigest: inputDigest(id) });
const ctx = (runId = 'run-a') => ({ environmentId: 'revision-env', runId, principalId: 'principal', roles: ['employee'] });
const ref = (table, key, runId = 'run-a') => ({ table, key: { runId, ...key } });
const claimInput = (i) => ({ orderUuid: 'car-a', holdId: `hold-${i}`, claimId: `claim-${i}`, employeeId: 'employee-a', entitlementSlotId: 'slot-a',
  type: 'cart', expiresAt: '2026-11-15T00:00:00.000Z', policyVersion: 'policy-1', quoteId: 'quote-a', expectedStockVersion: 1, expectedSlotVersion: 1 });

async function fixture(t) {
  const schema = `gcsp_revision_${process.pid}_${++serial}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 4, statement_timeout: 15000 }); pool.on('error', () => {});
  const repositories = []; const statements = []; const control = { failCommit: false }; const owned = [];
  t.after(async () => {
    for (const repository of repositories) await repository.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [schema])).rows[0].n, 0);
    await pool.end();
    for (const path of owned) await rm(path, { recursive: true, force: true });
  });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  // Records statements; failCommit makes the next COMMIT succeed in PostgreSQL but report a lost acknowledgement.
  const traced = { async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = async function(sql, ...rest) {
      statements.push(sql);
      const out = await query.call(this, sql, ...rest);
      if (sql === 'COMMIT' && control.failCommit) { control.failCommit = false; throw new Error('acknowledgement lost'); }
      return out;
    };
    const release = client.release;
    client.release = function(...args) { client.query = query; client.release = release; return release.apply(this, args); };
    return client;
  } };
  const open = async (options = {}) => {
    const repository = createPostgresRepository({ schema, pool: traced, ...options }); repositories.push(repository);
    assert.equal((await repository.open()).status, 'ok'); return repository;
  };
  // A migrations directory without 0010, standing in for a deployment that has not applied it yet.
  const legacyDirectory = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gcsp-revision-legacy-')); owned.push(directory);
    for (const name of (await readdir(DEFAULT_MIGRATIONS_DIRECTORY)).filter((file) => /^000\d_.*\.sql$/.test(file))) {
      await copyFile(join(DEFAULT_MIGRATIONS_DIRECTORY, name), join(directory, name));
    }
    return directory;
  };
  const measure = async (work) => { const at = statements.length; const value = await work(); return { value, statements: statements.slice(at) }; };
  const revisions = async () => Object.fromEntries((await pool.query(`SELECT scope, revision::int FROM "${schema}".repository_revisions ORDER BY scope`)).rows
    .map(({ scope, revision }) => [scope, revision]));
  return { schema, pool, open, measure, revisions, control, legacyDirectory };
}

async function seed(repository, context = ctx()) {
  const out = await repository.transaction(context, command(), async (tx) => {
    for (const [table, row] of [
      ['runs', { environmentId: context.environmentId, status: 'active', current: true }],
      ['employees', { employeeId: 'employee-a' }],
      ['entitlement_slots', { entitlementSlotId: 'slot-a', employeeId: 'employee-a', capacity: 1 }],
      ['stock', { orderUuid: 'car-a', orderNumber: '0000001', state: 'available' }],
      ['quotes', { quoteId: 'quote-a', orderUuid: 'car-a', employeeId: 'employee-a', policyVersion: 'policy-1' }],
    ]) { const inserted = await tx.insert(table, { runId: context.runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    return ok('seeded');
  });
  assert.equal(out.status, 'ok', JSON.stringify(out));
}
async function grow(repository, from, count, context = ctx()) {
  for (let start = from; start < from + count; start += 100) {
    const out = await repository.transaction(context, command(), async (tx) => {
      for (let i = start; i < Math.min(from + count, start + 100); i += 1) {
        await tx.recordReceipt({ consumerId: 'history', eventId: `event-${i}`, inputDigest: inputDigest(i), state: 'completed', outcome: ok(i) });
        await tx.insert('stock', { runId: context.runId, orderUuid: `history-${i}`, orderNumber: `H${i}`, state: 'available' });
      }
      return ok('grown');
    });
    assert.equal(out.status, 'ok');
  }
}
const receiptWrite = (repository, id, context = ctx()) => repository.transaction(context, command(), (tx) =>
  tx.recordReceipt({ consumerId: 'small', eventId: id, inputDigest: inputDigest(id), state: 'completed', outcome: ok(id) }));
const foundationReads = (statements) => statements.filter((sql) => /^\s*(BEGIN; )?SELECT/.test(sql)
  && FOUNDATION_TABLES.some((table) => sql.includes(`."${table}"`)));
const probeOf = (statements) => statements.map((sql) => sql.split('; ').find((part) => part.includes('repository_revisions'))).find(Boolean);

test('native revision: a supported check reads two keyed rows, never the foundation tables, however much history grows', native, async (t) => {
  const f = await fixture(t); const writer = await f.open(); const reader = await f.open(); await seed(writer);
  const sample = async () => {
    await reader.read(ctx(), ref('stock', { orderUuid: 'car-a' }));
    const cached = await f.measure(() => reader.read(ctx(), ref('stock', { orderUuid: 'car-a' })));
    const write = await f.measure(() => receiptWrite(writer, `w-${++serial}`));
    return { cached, write };
  };
  await grow(writer, 0, 20); const small = await sample();
  await grow(writer, 20, 2000); const large = await sample();
  for (const { cached, write } of [small, large]) {
    assert.equal(cached.statements.length, 1, 'a fresh cached read is one round trip');
    assert.deepEqual(foundationReads(cached.statements), [], 'the check scans no foundation table');
    assert.deepEqual(foundationReads(write.statements), [], 'a cached write reads no foundation table before writing');
    assert.ok(!cached.statements.some((sql) => /count\(\*\)|sum\(version\)/.test(sql)));
  }
  assert.equal(probeOf(large.cached.statements), probeOf(small.cached.statements), 'the probe is independent of history');
  // Native plan: the probe touches only repository_revisions and returns its two scope rows at most.
  const [plan] = (await f.pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${probeOf(large.cached.statements)}`)).rows[0]['QUERY PLAN'];
  const nodes = []; const walk = (node) => { nodes.push(node); for (const child of node.Plans ?? []) walk(child); }; walk(plan.Plan);
  const relations = [...new Set(nodes.map((node) => node['Relation Name']).filter(Boolean))];
  assert.deepEqual(relations, ['repository_revisions']);
  assert.ok(nodes.filter((node) => node['Relation Name']).every((node) => node['Actual Rows'] <= 2), JSON.stringify(nodes.map((node) => [node['Node Type'], node['Actual Rows']])));
  t.diagnostic(JSON.stringify({ historyRows: { small: 20 * 2 + 6, large: 2020 * 2 + 6 }, probeRelations: relations,
    probeActualRows: nodes.map((node) => node['Actual Rows']), cachedReadStatements: large.cached.statements.length, writeStatements: large.write.statements.length }));
});

test('native revision: each successful commit advances its scopes once; rollback, refusal, failed CAS and replay advance nothing', native, async (t) => {
  const f = await fixture(t); const repository = await f.open(); await seed(repository);
  assert.deepEqual(await f.revisions(), { 'run:run-a': 1, runs: 1 }, 'one seed transaction across five tables is one bump per scope');
  const stable = command();
  const done = await repository.transaction(ctx(), stable, async (tx) => {
    await tx.insert('decisions', { runId: 'run-a', decisionId: 'd-1' }); await tx.insert('decisions', { runId: 'run-a', decisionId: 'd-2' });
    return tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { state: 'held' });
  });
  assert.equal(done.status, 'ok');
  assert.deepEqual(await f.revisions(), { 'run:run-a': 2, runs: 1 }, 'a multi-row commit outside runs bumps only its run');
  const unchanged = await f.revisions();
  assert.equal((await repository.transaction(ctx(), command(), async (tx) => { await tx.insert('decisions', { runId: 'run-a', decisionId: 'refused' });
    return result('conflict', { reason: 'refused', current: {} }); })).status, 'conflict');
  assert.equal((await repository.transaction(ctx(), command(), async (tx) => { await tx.insert('decisions', { runId: 'run-a', decisionId: 'thrown' });
    throw new Error('fixture'); })).status, 'unavailable');
  assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { state: 'x' }))).status, 'stale-version');
  assert.deepEqual(await repository.transaction(ctx(), stable, () => { throw new Error('must not run'); }), done, 'replay returns the stored outcome');
  assert.equal((await repository.transaction(ctx(), stable, () => ok('changed'))).status, 'ok', 'replay with the same digest');
  assert.deepEqual(await f.revisions(), unchanged, 'no attempt that wrote nothing advanced a revision');
  // A flush failure rolls the revision back with the rows.
  await f.pool.query(`CREATE FUNCTION "${f.schema}".reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$;
    CREATE TRIGGER reject BEFORE INSERT ON "${f.schema}".decisions FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject()`);
  assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.insert('decisions', { runId: 'run-a', decisionId: 'flush' }))).status, 'unavailable');
  assert.deepEqual(await f.revisions(), unchanged);
  await f.pool.query(`DROP TRIGGER reject ON "${f.schema}".decisions`);
  assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.insert('decisions', { runId: 'run-a', decisionId: 'flush' }))).status, 'ok');
  assert.deepEqual(await f.revisions(), { ...unchanged, 'run:run-a': unchanged['run:run-a'] + 1 });
  // An UPDATE outside the adapter (maintenance, raw SQL) also advances the revision, so a cached instance reloads.
  assert.equal((await repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'held');
  await f.pool.query(`UPDATE "${f.schema}".stock SET data = data || '{"state":"available","version":3}'::jsonb WHERE order_uuid = 'car-a'`);
  assert.equal((await repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'available');
});

test('native revision: two instances see each other, keep CAS and unique occupancy, and recover an unknown commit', native, async (t) => {
  const f = await fixture(t); const a = await f.open(); const b = await f.open(); await seed(a);
  assert.equal((await b.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'available');
  assert.equal((await a.transaction(ctx(), command(), (tx) => tx.insert('decisions', { runId: 'run-a', decisionId: 'from-a' }))).status, 'ok');
  const seen = await f.measure(() => b.read(ctx(), ref('decisions', { decisionId: 'from-a' })));
  assert.equal(seen.value.status, 'ok', 'b sees a commit at once');
  // Concurrent writers serialize under the run lock: every commit is counted and seen by both.
  const before = (await f.revisions())['run:run-a'];
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_, i) => receiptWrite(i % 2 ? a : b, `parallel-${i}`)));
  assert.ok(outcomes.every(({ status }) => status === 'ok'));
  assert.equal((await f.revisions())['run:run-a'], before + 12);
  for (const repository of [a, b]) assert.equal((await repository.query(ctx(), 'event_receipts', { consumerId: 'small' })).value.length, 12);
  // CAS and occupancy stay authoritative: one claim wins, the other sees its stock write.
  const race = await Promise.all([a, b].map((repository, i) => repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim(claimInput(i)))));
  assert.deepEqual(race.map(({ status }) => status).sort(), ['ok', 'stale-version']);
  assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM "${f.schema}".holds`)).rows[0].n, 1);
  const loser = race.findIndex(({ status }) => status !== 'ok');
  const retry = await [a, b][loser].transaction(ctx(), command(), (tx) => tx.conditionalClaim({ ...claimInput(9), expectedStockVersion: 2 }));
  assert.notEqual(retry.status, 'ok', 'a fresh retry still cannot take an occupied car');
  // Unknown commit: PostgreSQL commits but the acknowledgement is lost; the same command reconciles from stored state.
  const stable = command(); f.control.failCommit = true;
  assert.equal((await a.transaction(ctx(), stable, (tx) => tx.insert('decisions', { runId: 'run-a', decisionId: 'uncertain' }))).status, 'unavailable');
  const committed = await f.revisions();
  for (const repository of [a, b]) {
    const replay = await repository.transaction(ctx(), stable, () => { throw new Error('must not repeat'); });
    assert.equal(replay.status, 'ok', 'the stored outcome is returned');
    assert.equal((await repository.read(ctx(), ref('decisions', { decisionId: 'uncertain' }))).status, 'ok');
  }
  assert.deepEqual(await f.revisions(), committed, 'reconciling replays advance nothing');
  assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM "${f.schema}".decisions WHERE decision_id = 'uncertain'`)).rows[0].n, 1);
});

test('native revision: reset and historical runs stay isolated, and an instance opened before 0010 stays correct alongside', native, async (t) => {
  const f = await fixture(t); const directory = await f.legacyDirectory();
  const legacy = await f.open({ migrationsDirectory: directory });
  await seed(legacy);
  assert.equal((await f.pool.query('SELECT to_regclass($1) AS name', [`"${f.schema}".repository_revisions`])).rows[0].name, null);
  const upgraded = await f.open(); // applies 0010 beside the running legacy instance
  assert.deepEqual(await f.revisions(), {}, 'existing rows start at revision 0');
  assert.equal((await upgraded.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'available');
  const legacyProbe = await f.measure(() => legacy.read(ctx(), ref('stock', { orderUuid: 'car-a' })));
  assert.ok(legacyProbe.statements.some((sql) => sql.includes('count(*)')), 'the legacy instance keeps its fingerprint');
  // Each sees the other's writes: legacy writes now fire the revision triggers.
  assert.equal((await legacy.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 1, { state: 'held' }))).status, 'ok');
  assert.equal((await upgraded.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'held');
  assert.equal((await upgraded.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 2, { state: 'available' }))).status, 'ok');
  assert.equal((await legacy.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'available');
  // Reset bumps runs and both runs' revisions; the retired run becomes historical for every instance.
  const reset = await upgraded.resetRun(ctx(), command(), { expectedCurrentRunId: 'run-a', expectedRunVersion: 1,
    nextRun: { runId: 'run-b', environmentId: ctx().environmentId, current: true, status: 'active' }, rows: [['employees', { employeeId: 'employee-b' }]] });
  assert.equal(reset.status, 'ok', JSON.stringify(reset));
  const afterReset = await f.revisions();
  assert.ok(afterReset.runs >= 1 && afterReset['run:run-b'] === 1 && afterReset['run:run-a'] >= 2, JSON.stringify(afterReset));
  for (const repository of [legacy, upgraded]) {
    assert.equal((await repository.read(ctx(), ref('runs', {}))).value.status, 'historical');
    assert.equal((await repository.transaction(ctx(), command(), (tx) => tx.insert('decisions', { runId: 'run-a', decisionId: 'late' }))).status, 'stale-run');
    assert.equal((await repository.currentRun(ctx().environmentId)).value.runId, 'run-b');
  }
  // A write in the new run leaves the historical run's revision and cached scope untouched.
  await upgraded.read(ctx(), ref('stock', { orderUuid: 'car-a' }));
  assert.equal((await upgraded.transaction(ctx('run-b'), command(), (tx) => tx.insert('decisions', { runId: 'run-b', decisionId: 'new-run' }))).status, 'ok');
  assert.equal((await f.revisions())['run:run-a'], afterReset['run:run-a']);
  const historical = await f.measure(() => upgraded.read(ctx(), ref('stock', { orderUuid: 'car-a' })));
  assert.equal(historical.value.status, 'ok'); assert.equal(historical.statements.length, 1, 'the historical scope is still a cache hit');
  assert.equal((await legacy.read(ctx('run-b'), ref('decisions', { decisionId: 'new-run' }, 'run-b'))).status, 'ok');
});
