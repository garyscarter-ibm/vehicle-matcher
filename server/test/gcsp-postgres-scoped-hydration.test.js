import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createRepository, createState, inputDigest, isScopeMiss, ok, result, FOUNDATION_TABLES } from '../gcsp/repository/core.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';

// FUCQ-424: declared-scope hydration. Memory ignores the scope, so its outcomes are the oracle for PostgreSQL.
const native = { skip: process.env.GCSP_DATABASE_URL === undefined ? 'native PostgreSQL URL unset' : false };
const fixed = () => '2026-11-14T00:00:00.000Z';
let serial = 0;
const command = (id = `cmd-${++serial}`) => ({ commandId: id, inputDigest: inputDigest(id) });
const ctx = (runId = 'run-a', environmentId = 'scoped-env') => ({ environmentId, runId, principalId: 'principal', roles: ['employee'] });
const ref = (table, key, runId = 'run-a') => ({ table, key: { runId, ...key } });
const tickRef = (tickId, runId) => ref('tick_runs', { tickId }, runId);
const receiptRef = (eventId, consumerId = 'tick', runId) => ref('event_receipts', { consumerId, eventId }, runId);
const sortRows = (rows) => rows.slice().sort((a, b) => inputDigest(a).localeCompare(inputDigest(b)));

// A tick-receipt-like transaction: read and CAS one tick row, then record one receipt.
const tickWork = (tickId, eventId) => async (tx) => {
  const got = await tx.get(tickRef(tickId));
  if (got.status !== 'ok') return got;
  const moved = await tx.compareAndSwap(tickRef(tickId), got.value.version, { state: 'completed', outcomes: [eventId] });
  if (moved.status !== 'ok') return moved;
  const receipt = await tx.recordReceipt({ consumerId: 'tick', eventId, inputDigest: inputDigest(eventId), state: 'completed', outcome: ok(eventId) });
  return receipt.status === 'ok' ? ok({ tickVersion: moved.value.version }) : receipt;
};
const tickScope = (tickId, eventId) => ({ scope: [tickRef(tickId), receiptRef(eventId)] });
const insertRun = (repository, context = ctx()) => repository.transaction(context, command(`seed-${context.runId}`), (tx) =>
  tx.insert('runs', { runId: context.runId, environmentId: context.environmentId, status: 'active', current: true }));
const insertTick = (tickId, runId = 'run-a') => (tx) => tx.insert('tick_runs', { runId, tickId, state: 'pending', targetClock: '2026-11-14T00:00:00.000Z' });
async function must(promise) { const out = await promise; assert.equal(out.status, 'ok', JSON.stringify(out)); return out; }

async function fixture(t) {
  const schema = `gcsp_scoped_${process.pid}_${++serial}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 3, statement_timeout: 15000 }); pool.on('error', () => {});
  const repositories = []; const statements = []; const control = { fail: undefined };
  t.after(async () => {
    for (const repository of repositories) await repository.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [schema])).rows[0].n, 0);
    await pool.end();
  });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  // Records each statement with its parameter bytes, changed rows, returned rows and response bytes.
  const traced = { async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = async function(sql, values, ...rest) {
      const entry = { sql, bytes: (values ?? []).reduce((sum, value) => sum + Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null)), 0), rows: 0, responseBytes: 0 };
      statements.push(entry);
      if (control.fail?.test(sql)) throw Object.assign(new Error('injected failure'), { code: '57P01' });
      const out = await query.call(this, sql, values, ...rest);
      for (const one of Array.isArray(out) ? out : [out]) {
        if (Array.isArray(one.rows)) { entry.rows += one.rows.length; entry.responseBytes += Buffer.byteLength(JSON.stringify(one.rows)); }
      }
      entry.rowCount = Array.isArray(out) ? null : out.rowCount; return out;
    };
    const release = client.release;
    client.release = function(...args) { client.query = query; client.release = release; return release.apply(this, args); };
    return client;
  } };
  const open = async (options = {}) => {
    const repository = createPostgresRepository({ schema, pool: traced, now: fixed, ...options }); repositories.push(repository);
    assert.equal((await repository.open()).status, 'ok'); return repository;
  };
  const measure = async (work) => { const at = statements.length; const value = await work(); return { value, statements: statements.slice(at) }; };
  const count = async (sql, values) => (await pool.query(sql.replace(/\$S/g, `"${schema}"`), values)).rows[0];
  return { schema, pool, open, measure, statements, control, count };
}
const isFull = ({ sql }) => /'stock' AS t, data FROM/.test(sql);
const isScopedLoad = ({ sql }) => /^SELECT 'runs' AS t, data FROM/.test(sql) && sql.includes('jsonb_array_elements') && !isFull({ sql });
const isFingerprint = ({ sql }) => /count\(\*\) AS n/.test(sql);
const written = (statements) => statements.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql.trimStart()));
const load = (statements) => ({ rows: statements.reduce((sum, { rows }) => sum + rows, 0), bytes: statements.reduce((sum, { responseBytes }) => sum + responseBytes, 0) });

// A small world on any repository: one run, three ticks, one receipt.
async function world(repository) {
  await must(insertRun(repository));
  await must(repository.transaction(ctx(), command('world'), async (tx) => {
    for (const id of ['tick-1', 'tick-2', 'tick-3']) await insertTick(id)(tx);
    return tx.recordReceipt({ consumerId: 'history', eventId: 'e0', inputDigest: inputDigest('e0'), state: 'completed', outcome: ok('e0') });
  }));
}
const memoryRepository = async () => { const repository = createMemoryRepository({ store: createMemoryStore(), now: fixed }); await repository.open(); return repository; };

test('scope declarations: invalid ones return invalid-scope, run no work and write nothing', async () => {
  const repository = await memoryRepository(); await world(repository);
  const before = (await repository.query(ctx(), 'event_receipts')).value.length;
  const bad = [
    ['not an array', { scope: 'tick-1' }], ['options not an object', 5], ['other run', { scope: [tickRef('tick-1', 'run-b')] }],
    ['disallowed table', { scope: [ref('stock', { orderUuid: 'car-a' })] }], ['runs table', { scope: [ref('runs', {})] }],
    ['partial key', { scope: [{ table: 'event_receipts', key: { runId: 'run-a', consumerId: 'tick' } }] }],
    ['missing key', { scope: [{ table: 'tick_runs' }] }], ['not a ref', { scope: [null] }], ['extra field', { scope: [{ ...tickRef('tick-1'), extra: 1 }] }],
    ['unknown table', { scope: [{ table: 'nope', key: { runId: 'run-a' } }] }],
  ];
  for (const [label, options] of bad) {
    let ran = false;
    const out = await repository.transaction(ctx(), command(), async () => { ran = true; return ok(1); }, options);
    assert.equal(out.status, 'invalid', label); assert.equal(out.code, 'invalid-scope', label); assert.equal(ran, false, label);
  }
  assert.equal((await repository.query(ctx(), 'event_receipts')).value.length, before, 'nothing written');
  for (const options of [undefined, null, {}, { scope: undefined }]) await must(repository.transaction(ctx(), command(), () => ok(1), options));
});

test('memory: a valid scope gives the same outcomes and tables as no scope', async () => {
  const [scoped, plain] = [await memoryRepository(), await memoryRepository()];
  await world(scoped); await world(plain);
  const run = async (repository, withScope) => {
    const out = [];
    out.push(await repository.transaction(ctx(), command('c1'), tickWork('tick-1', 'e1'), withScope ? tickScope('tick-1', 'e1') : undefined));
    out.push(await repository.transaction(ctx(), command('c1'), tickWork('tick-1', 'e1'), withScope ? tickScope('tick-1', 'e1') : undefined));
    out.push(await repository.transaction(ctx(), command('c2'), tickWork('tick-1', 'e1'), withScope ? tickScope('tick-1', 'e1') : undefined));
    out.push(await repository.transaction(ctx(), command('c3'), tickWork('absent', 'e2'), withScope ? tickScope('absent', 'e2') : undefined));
    return out;
  };
  assert.deepEqual(await run(scoped, true), await run(plain, false));
  for (const table of FOUNDATION_TABLES) assert.deepEqual((await scoped.query(ctx(), table)).value, (await plain.query(ctx(), table)).value, table);
});

test('core: a partial state is fail-closed and the backend gets the expanded scope', async () => {
  const seen = []; const misses = [];
  const run = ctx();
  const partial = () => {
    const state = createState();
    state.tables.runs.push({ runId: 'run-a', environmentId: run.environmentId, status: 'active', current: true, version: 1 });
    state.tables.tick_runs.push({ runId: 'run-a', tickId: 'tick-1', state: 'pending', version: 1 });
    return state;
  };
  let override;
  const backend = {
    now: fixed, supportedTables: FOUNDATION_TABLES,
    async open() { return ok({}); }, async migrationStatus() { return ok({}); }, async close() { return ok({}); },
    async read(...args) { seen.push({ read: args.length }); return args[1](partial()); },
    async transaction(context, work, ...extra) {
      seen.push(extra[0]); const state = partial(); state.scope = override ?? extra[0];
      try { return (await work(state)).outcome; } catch (error) { misses.push(isScopeMiss(error)); throw error; }
    },
  };
  const repository = createRepository(backend); await repository.open();
  const declared = { scope: [tickRef('tick-1'), tickRef('tick-9')] };
  const quiet = console.error; console.error = () => {};
  try {
    // Covered present and covered absent keys are authoritative; the commit still works.
    const found = await repository.transaction(run, command('k1'), async (tx) => ok([(await tx.get(tickRef('tick-1'))).status, (await tx.get(tickRef('tick-9'))).status]), declared);
    assert.deepEqual(found.value, ['ok', 'not-found']);
    const expectedScope = [
      ['tick_runs', 'run-a', 'tick-1'], ['tick_runs', 'run-a', 'tick-9'], ['event_receipts', 'run-a', 'command:transaction', 'k1'],
      ...['tick-1', 'tick-9'].map((id) => ['event_receipts', 'run-a', 'repository:insert:tick_runs', inputDigest({ runId: 'run-a', tickId: id })]),
      ['event_receipts', 'run-a', 'repository:insert:event_receipts', inputDigest({ runId: 'run-a', consumerId: 'command:transaction', eventId: 'k1' })],
    ];
    const actualScope = seen[0].map(({ table, key }) => [table, ...Object.values(key)]);
    assert.deepEqual(actualScope.map((entry) => JSON.stringify(entry)).sort(), expectedScope.map((entry) => JSON.stringify(entry)).sort());
    // Under-declared access is a scope miss even when the callback ignores or throws on it.
    const ignored = await repository.transaction(run, command('k2'), async (tx) => { await tx.get(tickRef('tick-2')); return ok('swallowed'); }, declared);
    assert.equal(ignored.status, 'unavailable');
    await repository.transaction(run, command('k3'), (tx) => tx.list('tick_runs'), declared);
    await repository.transaction(run, command('k4'), async (tx) => { await tx.list('event_receipts'); throw new Error('boom'); }, declared);
    await repository.transaction(run, command('k5'), (tx) => tx.insert('tick_runs', { runId: 'run-a', tickId: 'tick-2' }), declared);
    await repository.transaction(run, command('k6'), (tx) => tx.recordReceipt({ consumerId: 'x', eventId: 'y', inputDigest: 'z', outcome: ok(1) }), declared);
    await repository.transaction(run, command('k7'), (tx) => tx.enqueueNotification({ runId: 'run-a', jobId: 'j', idempotencyKey: 'i', inputDigest: 'd' }), declared);
    assert.deepEqual(misses, [true, true, true, true, true, true]);
    // After a miss the session is poisoned: later calls fail instead of reading stale data.
    await repository.transaction(run, command('k8'), async (tx) => {
      await tx.list('tick_runs'); const after = await tx.get(tickRef('tick-1')); assert.equal(after.status, 'unavailable'); return ok(1);
    }, declared);
    assert.equal(misses.length, 7);
    // A state whose scope lacks the command receipt misses before work runs.
    override = [tickRef('tick-1')]; let ran = false;
    await repository.transaction(run, command('k9'), async () => { ran = true; return ok(1); }, declared);
    assert.equal(ran, false); assert.equal(misses.at(-1), true);
    // Reads and queries never pass a scope.
    override = undefined;
    await repository.read(run, tickRef('tick-1')); await repository.query(run, 'tick_runs');
    assert.deepEqual(seen.filter((entry) => entry?.read !== undefined).map(({ read }) => read), [3, 3]);
  } finally { console.error = quiet; }
});

test('native: a cold declared receipt update loads a bounded set while the undeclared one hydrates the whole history', native, async (t) => {
  const f = await fixture(t); const seeder = await f.open();
  await must(insertRun(seeder));
  for (let start = 0; start < 1500; start += 100) {
    await must(seeder.transaction(ctx(), command(), async (tx) => {
      for (let i = start; i < start + 100; i += 1) await tx.recordReceipt({ consumerId: 'history', eventId: `event-${i}`, inputDigest: inputDigest(i), state: 'completed', outcome: ok(i) });
      return ok('grown');
    }));
  }
  for (let start = 0; start < 200; start += 100) {
    await must(seeder.transaction(ctx(), command(), async (tx) => { for (let i = start; i < start + 100; i += 1) await insertTick(`tick-${i}`)(tx); return ok('ticks'); }));
  }
  const history = (await f.count(`SELECT (SELECT count(*)::int FROM $S.event_receipts) AS receipts, (SELECT count(*)::int FROM $S.tick_runs) AS ticks`));
  assert.ok(history.receipts >= 1700 && history.ticks === 200, JSON.stringify(history));
  const memory = await memoryRepository(); await must(insertRun(memory)); await must(memory.transaction(ctx(), command(), insertTick('tick-10')));
  const expected = await memory.transaction(ctx(), command('tick-cmd'), tickWork('tick-10', 'e-10'));

  const [coldScoped, coldWide] = [await f.open(), await f.open()];
  const scoped = await f.measure(() => coldScoped.transaction(ctx(), command('tick-cmd'), tickWork('tick-10', 'e-10'), tickScope('tick-10', 'e-10')));
  const wide = await f.measure(() => coldWide.transaction(ctx(), command('wide-cmd'), tickWork('tick-11', 'e-11')));
  assert.equal(scoped.value.status, 'ok'); assert.equal(wide.value.status, 'ok');
  assert.deepEqual(scoped.value, expected, 'the outcome equals the memory backend');
  assert.ok(!scoped.statements.some(isFull), 'no statement loaded the full snapshot');
  assert.equal(scoped.statements.filter(isScopedLoad).length, 1);
  assert.ok(!scoped.statements.some(isFingerprint), 'a cold scoped write skips the fingerprint probe');
  assert.ok(wide.statements.some(isFull));
  const [small, big] = [load(scoped.statements), load(wide.statements)];
  assert.ok(small.rows <= 12 && small.bytes < 8192, JSON.stringify(small));
  assert.ok(big.rows > 1500 && big.bytes > 100 * small.bytes, JSON.stringify(big));
  assert.deepEqual(written(scoped.statements).map(({ rowCount }) => rowCount).sort(), [1, 2]);
  t.diagnostic(JSON.stringify({ scoped: { ...small, statements: scoped.statements.length }, undeclared: { ...big, statements: wide.statements.length }, history }));
});

test('native: the same declared sequence on memory and PostgreSQL gives identical outcomes and final tables', native, async (t) => {
  const f = await fixture(t);
  const memory = await memoryRepository();
  const script = async (open) => {
    const run = async (c, work, scope) => (await open()).transaction(ctx(), c, work, scope);
    await must(insertRun(await open()));
    const never = () => result('conflict', { reason: 'must-not-run', current: {} });
    const stale = (tx) => tx.compareAndSwap(tickRef('t1'), 1, { state: 'late' });
    return [
      await run(command('i1'), insertTick('t1'), { scope: [tickRef('t1')] }),
      await run(command('i2'), insertTick('t1'), { scope: [tickRef('t1')] }),
      await run(command('i3'), (tx) => tx.insert('tick_runs', { runId: 'run-a', tickId: 't1', state: 'different' }), { scope: [tickRef('t1')] }),
      await run(command('r1'), async (tx) => { const run1 = await tx.get(ref('runs', {})); return tx.compareAndSwap(ref('runs', {}), run1.value.version, { clockInstant: '2026-11-14T01:00:00.000Z' }); }, { scope: [] }),
      await run(command('c1'), tickWork('t1', 'e1'), tickScope('t1', 'e1')),
      await run(command('c1'), never, tickScope('t1', 'e1')),
      await run({ commandId: 'c1', inputDigest: inputDigest('other') }, never, tickScope('t1', 'e1')),
      await run(command('s1'), stale, { scope: [tickRef('t1')] }),
      await run(command('c2'), (tx) => tx.recordReceipt({ consumerId: 'tick', eventId: 'e1', inputDigest: inputDigest('changed'), state: 'completed', outcome: ok(1) }), { scope: [receiptRef('e1')] }),
      await run(command('c3'), tickWork('absent', 'e3'), tickScope('absent', 'e3')),
    ];
  };
  const expected = await script(async () => memory);
  const actual = await script(() => f.open());
  assert.deepEqual(actual.map(({ status, code, reason }) => [status, code ?? reason ?? null]), expected.map(({ status, code, reason }) => [status, code ?? reason ?? null]));
  assert.deepEqual(actual, expected);
  assert.deepEqual(expected.map(({ status }) => status), ['ok', 'ok', 'conflict', 'ok', 'ok', 'ok', 'conflict', 'stale-version', 'conflict', 'not-found']);
  const reopened = await f.open();
  for (const table of ['runs', 'tick_runs', 'event_receipts']) {
    assert.deepEqual(sortRows((await reopened.query(ctx(), table)).value), sortRows((await memory.query(ctx(), table)).value), table);
  }
});

test('native: an under-declared transaction falls back to the full state once and equals the memory outcome', native, async (t) => {
  const f = await fixture(t); const memory = await memoryRepository(); await world(memory); await world(await f.open());
  const cases = {
    'list of an undeclared table': { scope: [], work: async (tx) => ok((await tx.list('event_receipts')).value.length) },
    'get of an undeclared key': { scope: [], work: async (tx) => ok((await tx.get(tickRef('tick-2'))).value.version) },
    'ignores the miss result': { scope: [tickRef('tick-1')], work: async (tx) => { await tx.get(tickRef('tick-3')); return ok('done'); } },
    'throws after the miss': { scope: [], work: async (tx) => { await tx.list('tick_runs'); throw new Error('callback failure'); } },
    'writes after an undeclared read': { scope: [tickRef('tick-1')], work: async (tx) => { const rows = await tx.list('tick_runs'); await tx.compareAndSwap(tickRef('tick-1'), 1, { state: String(rows.value.length) }); return ok(rows.value.length); } },
  };
  const quiet = console.error; console.error = () => {};
  try {
    for (const [label, { scope, work }] of Object.entries(cases)) {
      const c = command();
      const expected = await memory.transaction(ctx(), c, work, { scope });
      const cold = await f.open();
      const { value, statements } = await f.measure(() => cold.transaction(ctx(), c, work, { scope }));
      assert.deepEqual(value, expected, label);
      assert.equal(statements.filter(isFull).length, 1, `${label}: one full snapshot`);
      assert.equal(statements.filter(isScopedLoad).length, 1, `${label}: one scoped load first`);
    }
  } finally { console.error = quiet; }
  const reopened = await f.open();
  for (const table of ['tick_runs', 'event_receipts']) assert.deepEqual(sortRows((await reopened.query(ctx(), table)).value), sortRows((await memory.query(ctx(), table)).value), table);
});

test('native: scoped commits never delete or change unrelated rows', native, async (t) => {
  const f = await fixture(t); const seeder = await f.open(); await world(seeder);
  await must(seeder.transaction(ctx(), command(), async (tx) => {
    for (let i = 0; i < 50; i += 1) await tx.recordReceipt({ consumerId: 'history', eventId: `h-${i}`, inputDigest: inputDigest(i), state: 'completed', outcome: ok(i) });
    return ok('grown');
  }));
  await must(insertRun(seeder, ctx('run-b', 'env-b')));
  await must(seeder.transaction(ctx('run-b', 'env-b'), command(), insertTick('tick-1', 'run-b')));
  const unrelated = () => f.count(`SELECT (SELECT count(*)::int FROM $S.event_receipts WHERE consumer_id = 'history') AS history,
    (SELECT md5(string_agg(data::text, '|' ORDER BY event_id)) FROM $S.event_receipts WHERE consumer_id = 'history') AS digest,
    (SELECT md5(string_agg(data::text, '|' ORDER BY run_id, tick_id)) FROM $S.tick_runs WHERE tick_id <> 'tick-1' OR run_id = 'run-b') AS ticks,
    (SELECT count(*)::int FROM $S.runs) AS runs`);
  const before = await unrelated();
  for (let i = 0; i < 3; i += 1) await must((await f.open()).transaction(ctx(), command(), tickWork('tick-1', `e-${i}`), tickScope('tick-1', `e-${i}`)));
  assert.deepEqual(await unrelated(), before);
  const full = await f.open();
  assert.equal((await full.query(ctx(), 'event_receipts', { consumerId: 'history' })).value.length, 51);
  assert.equal((await full.query(ctx(), 'tick_runs')).value.length, 3);
  assert.equal((await full.read(ctx(), tickRef('tick-1'))).value.version, 4);
});

test('native: mixed scoped and full instances and trusted reads always see the scoped write', native, async (t) => {
  const f = await fixture(t);
  const a = await f.open(); const b = await f.open(); await world(a);
  // Instance A holds a warm cache; B commits a scoped write, so A's next probe must mismatch and reload.
  await must(a.transaction(ctx(), command(), (tx) => tx.get(tickRef('tick-1'))));
  const viaB = await f.measure(() => b.transaction(ctx(), command(), tickWork('tick-1', 'eb'), tickScope('tick-1', 'eb')));
  assert.equal(viaB.value.status, 'ok'); assert.ok(!viaB.statements.some(isFull));
  const seen = await a.transaction(ctx(), command(), async (tx) => ok((await tx.get(tickRef('tick-1'))).value.version));
  assert.equal(seen.value, 2);
  assert.equal((await a.read(ctx(), tickRef('tick-1'))).value.version, 2);
  assert.equal((await a.read(ctx(), receiptRef('eb'))).status, 'ok');
  // A stale entry is probed, then the scoped load still avoids the full snapshot.
  await must(b.transaction(ctx(), command(), tickWork('tick-2', 'eb2'), tickScope('tick-2', 'eb2')));
  const stale = await f.measure(() => a.transaction(ctx(), command(), tickWork('tick-3', 'ea3'), tickScope('tick-3', 'ea3')));
  assert.equal(stale.value.status, 'ok');
  assert.ok(stale.statements.some(isFingerprint) && stale.statements.some(isScopedLoad) && !stale.statements.some(isFull));
  // A matching cache entry is a hit: no scoped load, no full load.
  await must(a.transaction(ctx(), command(), (tx) => tx.get(tickRef('tick-1'))));
  const hit = await f.measure(() => a.transaction(ctx(), command(), tickWork('tick-1', 'ea1'), tickScope('tick-1', 'ea1')));
  assert.equal(hit.value.status, 'ok'); assert.ok(!hit.statements.some((s) => isScopedLoad(s) || isFull(s)) && hit.statements.some(isFingerprint));
  // Same instance with trusted reads: the scoped commit must not leave a pre-commit row behind.
  const trusted = await f.open({ readTrustMs: 60000 });
  assert.equal((await trusted.read(ctx(), tickRef('tick-1'))).value.version, 3);
  assert.equal((await trusted.query(ctx(), 'tick_runs', { tickId: 'tick-2' })).value[0].version, 2);
  await must(trusted.transaction(ctx(), command(), (tx) => tx.compareAndSwap(tickRef('tick-1'), 3, { state: 'again' }), { scope: [tickRef('tick-1')] }));
  assert.equal((await trusted.read(ctx(), tickRef('tick-1'))).value.version, 4, 'trusted read sees the scoped write');
  assert.equal((await trusted.query(ctx(), 'tick_runs')).value.find((row) => row.tickId === 'tick-1').state, 'again');
  assert.equal((await trusted.transaction(ctx(), command(), async (tx) => ok((await tx.get(tickRef('tick-1'))).value.version))).value, 4);
});

test('native: a failed scoped flush rolls back, and the retry commits once and replays without a second write', native, async (t) => {
  const f = await fixture(t); const seeder = await f.open(); await world(seeder);
  const stable = command('stable'); const base = await f.count(`SELECT (SELECT count(*)::int FROM $S.event_receipts) AS receipts, (SELECT version::int FROM $S.tick_runs WHERE tick_id = 'tick-1') AS tick`);
  f.control.fail = /^INSERT INTO "[^"]+"\."event_receipts"/;
  const quiet = console.error; console.error = () => {};
  let failed;
  try { failed = await (await f.open()).transaction(ctx(), stable, tickWork('tick-1', 'e-r'), tickScope('tick-1', 'e-r')); } finally { console.error = quiet; }
  assert.equal(failed.status, 'unavailable');
  assert.deepEqual(await f.count(`SELECT (SELECT count(*)::int FROM $S.event_receipts) AS receipts, (SELECT version::int FROM $S.tick_runs WHERE tick_id = 'tick-1') AS tick`), base);
  f.control.fail = undefined;
  const saved = await (await f.open()).transaction(ctx(), stable, tickWork('tick-1', 'e-r'), tickScope('tick-1', 'e-r'));
  assert.equal(saved.status, 'ok');
  const replay = await f.measure(async () => (await f.open()).transaction(ctx(), stable, () => result('conflict', { reason: 'must-not-run', current: {} }), tickScope('tick-1', 'e-r')));
  assert.deepEqual(replay.value, saved); assert.equal(written(replay.statements).length, 0);
  assert.deepEqual(await f.count(`SELECT (SELECT count(*)::int FROM $S.event_receipts) AS receipts, (SELECT version::int FROM $S.tick_runs WHERE tick_id = 'tick-1') AS tick`),
    { receipts: base.receipts + 2, tick: base.tick + 1 });
});

test('native: the scoped path enforces the environment and never touches another run', native, async (t) => {
  const f = await fixture(t); const seeder = await f.open(); await world(seeder);
  await must(insertRun(seeder, ctx('run-b', 'other-env')));
  await must(seeder.transaction(ctx('run-b', 'other-env'), command(), insertTick('tick-1', 'run-b')));
  const rows = () => f.count(`SELECT (SELECT count(*)::int FROM $S.event_receipts) AS receipts, (SELECT md5(string_agg(data::text, '|' ORDER BY tick_id)) FROM $S.tick_runs WHERE run_id = 'run-b') AS b`);
  const before = await rows();
  let ran = false;
  const forbidden = await (await f.open()).transaction(ctx('run-a', 'intruder-env'), command(), async () => { ran = true; return ok(1); }, tickScope('tick-1', 'e1'));
  assert.equal(forbidden.status, 'forbidden'); assert.equal(ran, false); assert.deepEqual(await rows(), before);
  // The same tick id exists in both runs; an undeclared read of run-b's row is refused, and run-a's own row stays reachable.
  const cross = await f.measure(async () => (await f.open()).transaction(ctx(), command(), (tx) => tx.get(tickRef('tick-1', 'run-b')), { scope: [tickRef('tick-1')] }));
  assert.equal(cross.value.status, 'stale-run'); assert.ok(!cross.statements.some(isFull));
  const own = await (await f.open()).transaction(ctx(), command(), async (tx) => ok((await tx.get(tickRef('tick-1'))).value.runId), { scope: [tickRef('tick-1')] });
  assert.equal(own.value, 'run-a');
  const declaredOther = await (await f.open()).transaction(ctx(), command(), () => ok(1), { scope: [tickRef('tick-1', 'run-b')] });
  assert.equal(declaredOther.code, 'invalid-scope');
  await must((await f.open()).transaction(ctx(), command(), tickWork('tick-1', 'e1'), tickScope('tick-1', 'e1')));
  assert.equal((await rows()).b, before.b, 'the other run is untouched');
});
