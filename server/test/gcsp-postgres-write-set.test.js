import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { inputDigest, ok, result, FOUNDATION_TABLES } from '../gcsp/repository/core.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';

// FUCQ-423: PostgreSQL commits persist the core mutation journal. GCSP_POSTGRES_BASELINE_MODULE measures another build.
const { createPostgresRepository } = await import(process.env.GCSP_POSTGRES_BASELINE_MODULE
  ? pathToFileURL(process.env.GCSP_POSTGRES_BASELINE_MODULE).href : '../gcsp/repository/postgres.js');
const native = { skip: process.env.GCSP_DATABASE_URL === undefined ? 'native PostgreSQL URL unset' : false };
const clock = () => { let tick = 0; return () => new Date(Date.UTC(2026, 10, 13, 0, 0, 0, tick++)).toISOString(); };
let serial = 0;
const command = (id = `cmd-${++serial}`) => ({ commandId: id, inputDigest: inputDigest(id) });
const ctx = (runId = 'run-a', environmentId = 'write-set-env') => ({ environmentId, runId, principalId: 'principal', roles: ['employee'] });
const ref = (table, key, runId = 'run-a') => ({ table, key: { runId, ...key } });
const expiresAt = '2026-11-14T00:00:00.000Z';
const claimInput = { orderUuid: 'car-a', holdId: 'hold-a', claimId: 'claim-a', employeeId: 'employee-a', entitlementSlotId: 'slot-a',
  type: 'cart', expiresAt, policyVersion: 'policy-1', quoteId: 'quote-a', expectedStockVersion: 1, expectedSlotVersion: 1 };
const evidence = (id) => ({ contractVersion: 'vehicle-snapshot-v1', identityKind: 'exact-stock', sourceKeys: { stockId: id }, snapshotVersion: 'v1',
  observedAt: '2026-11-07T00:00:00.000Z', facts: { configurationEvidence: { status: 'known', value: { identity: { configurationId: 'config-a' } } } } });

async function fixture(t) {
  const schema = `gcsp_write_set_${process.pid}_${++serial}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 3, statement_timeout: 15000 }); pool.on('error', () => {});
  const repositories = []; const statements = [];
  t.after(async () => {
    for (const repository of repositories) await repository.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [schema])).rows[0].n, 0);
    await pool.end();
  });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  // Records each statement, its parameter bytes and the rows it changed.
  const traced = { async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = async function(sql, values, ...rest) {
      const entry = { sql, bytes: (values ?? []).reduce((sum, value) => sum + Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null)), 0) };
      statements.push(entry);
      const out = await query.call(this, sql, values, ...rest);
      entry.rowCount = Array.isArray(out) ? null : out.rowCount; return out;
    };
    const release = client.release;
    client.release = function(...args) { client.query = query; client.release = release; return release.apply(this, args); };
    return client;
  } };
  const open = async (options = {}) => {
    const repository = createPostgresRepository({ schema, pool: traced, ...options }); repositories.push(repository);
    assert.equal((await repository.open()).status, 'ok'); return repository;
  };
  const measure = async (work) => { const at = statements.length; const value = await work(); return { value, statements: statements.slice(at) }; };
  return { schema, pool, open, measure, statements };
}

async function seed(repository, context = ctx()) {
  const out = await repository.transaction(context, command(), async (tx) => {
    for (const [table, row] of [
      ['runs', { environmentId: context.environmentId, status: 'active', current: true }],
      ['employees', { employeeId: 'employee-a' }],
      ['entitlement_slots', { entitlementSlotId: 'slot-a', employeeId: 'employee-a', capacity: 1 }],
      ['stock', { orderUuid: 'car-a', orderNumber: '0000001', state: 'available', facts: evidence('car-a') }],
      ['stock', { orderUuid: 'car-b', orderNumber: '0000002', state: 'available' }],
      ['quotes', { quoteId: 'quote-a', orderUuid: 'car-a', employeeId: 'employee-a', policyVersion: 'policy-1' }],
    ]) { const inserted = await tx.insert(table, { runId: context.runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    return ok('seeded');
  });
  assert.equal(out.status, 'ok', JSON.stringify(out));
}
// Unrelated history: receipts and stock rows that a later small receipt write never touches.
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
const receiptWrite = (repository, id) => repository.transaction(ctx(), command(), (tx) =>
  tx.recordReceipt({ consumerId: 'small', eventId: id, inputDigest: inputDigest(id), state: 'completed', outcome: ok(id) }));
const written = (statements) => statements.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)/.test(sql.trimStart()));
const tablesOf = (statements) => [...new Set(written(statements).map(({ sql }) => sql.match(/(?:INTO|UPDATE|FROM) "[^"]+"\."([a-z_]+)"/)?.[1]))];
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

test('native write set: a small receipt commit issues the same statements and rows however much unrelated history grows', native, async (t) => {
  const f = await fixture(t); const repository = await f.open(); await seed(repository);
  const sample = async (label) => {
    const timings = []; let last;
    for (let i = 0; i < 5; i += 1) {
      const started = performance.now();
      last = await f.measure(() => receiptWrite(repository, `${label}-${i}`));
      timings.push(performance.now() - started);
      assert.equal(last.value.status, 'ok');
    }
    return { statements: last.statements, ms: median(timings) };
  };
  await grow(repository, 0, 20); const small = await sample('small');
  await grow(repository, 20, 2000); const large = await sample('large');
  const shape = ({ statements }) => statements.map(({ sql, rowCount }) => [sql.replace(/\$\d+|'[^']*'/g, '?').replace(/\s+/g, ' ').slice(0, 80), rowCount]);
  assert.deepEqual(shape(large), shape(small), 'statement text and changed-row counts are independent of history');
  assert.deepEqual(tablesOf(large.statements), ['event_receipts'], 'only the receipt table is written');
  assert.equal(written(large.statements).reduce((sum, { rowCount }) => sum + rowCount, 0), 2, 'the small receipt and its command receipt');
  assert.ok(Math.max(...large.statements.map(({ bytes }) => bytes)) < 2048, 'parameters carry only the write set');
  t.diagnostic(JSON.stringify({ statementsPerSmallCommit: large.statements.length, historyRows: { small: 20 * 2 + 7, large: 2020 * 2 + 7 },
    medianCommitMs: { small: Number(small.ms.toFixed(2)), large: Number(large.ms.toFixed(2)) } }));
});

test('native write set: composed claims, insert-then-update, CAS, outbox and reset persist exactly the memory state', native, async (t) => {
  const f = await fixture(t);
  const store = createMemoryStore();
  const memory = createMemoryRepository({ store, now: clock() }); await memory.open();
  const postgres = await f.open({ now: clock() });
  const script = async (repository) => {
    await seed(repository);
    const steps = [
      (tx) => tx.conditionalClaim(claimInput),
      async (tx) => {
        const inserted = await tx.insert('offers', { runId: 'run-a', offerId: 'offer-a', holdId: 'hold-a', state: 'open' });
        await tx.compareAndSwap(ref('offers', { offerId: 'offer-a' }), inserted.value.version, { state: 'sent' });
        return tx.enqueueNotification({ runId: 'run-a', jobId: 'job-a', idempotencyKey: 'offer-a', inputDigest: inputDigest('offer-a'), state: 'pending' });
      },
      async (tx) => {
        const first = await tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), 1, { revision: 'r2' });
        return tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), first.value.version, { revision: 'r3' });
      },
      (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-a' }), 2, { facts: { plain: true } }),
      (tx) => tx.compareAndSwap(ref('holds', { holdId: 'hold-a' }), 1, { state: 'released' }),
    ];
    const outcomes = [];
    for (const step of steps) outcomes.push(await repository.transaction(ctx(), command(`step-${outcomes.length}`), step));
    outcomes.push(await repository.resetRun(ctx(), command('reset'), { expectedCurrentRunId: 'run-a', expectedRunVersion: 1,
      nextRun: { runId: 'run-b', environmentId: ctx().environmentId, current: true, status: 'active' }, rows: [['employees', { employeeId: 'employee-a' }]] }));
    return outcomes;
  };
  serial = 1000; const expected = await script(memory);
  serial = 1000; const actual = await script(postgres);
  assert.deepEqual(actual, expected, 'every outcome matches the memory backend');
  assert.ok(expected.every((outcome) => outcome.status === 'ok'), JSON.stringify(expected));
  const reopened = await f.open();
  const sortKey = (row) => inputDigest(row); // JSONB reorders keys, so sort canonically.
  for (const runId of ['run-a', 'run-b']) for (const table of FOUNDATION_TABLES) {
    const fromMemory = (await memory.query(ctx(runId), table)).value; const fromDatabase = (await reopened.query(ctx(runId), table)).value;
    assert.deepEqual(fromDatabase.sort((a, b) => sortKey(a).localeCompare(sortKey(b))), fromMemory.sort((a, b) => sortKey(a).localeCompare(sortKey(b))), `${runId} ${table}`);
  }
  const refs = await f.pool.query(`SELECT table_name, row_key FROM "${f.schema}".vehicle_evidence_references ORDER BY 1, 2`);
  assert.ok(!refs.rows.some((row) => row.table_name === 'stock'), 'replacing evidence-bearing facts removes the stock reference');
  assert.ok(refs.rows.some((row) => row.table_name === 'event_receipts'), 'the original insert receipt still pins its evidence');
  await memory.close();
});

test('native write set: an insert later updated in one transaction is one INSERT carrying the final row', native, async (t) => {
  const f = await fixture(t); const repository = await f.open(); await seed(repository);
  const { value, statements } = await f.measure(() => repository.transaction(ctx(), command(), async (tx) => {
    const inserted = await tx.insert('decisions', { runId: 'run-a', decisionId: 'decision-a', commandId: 'decide-a', decision: 'draft' });
    return tx.compareAndSwap(ref('decisions', { decisionId: 'decision-a' }), inserted.value.version, { decision: 'accept' });
  }));
  assert.equal(value.status, 'ok');
  assert.ok(!written(statements).some(({ sql }) => /^\s*UPDATE "[^"]+"\."decisions"/.test(sql)), 'no UPDATE for a row this transaction created');
  const stored = await f.pool.query(`SELECT data FROM "${f.schema}".decisions`);
  assert.deepEqual(stored.rows.map(({ data }) => [data.decision, data.version]), [['accept', 2]]);
});

test('native write set: competing instances keep CAS, occupancy and cache freshness', native, async (t) => {
  const f = await fixture(t); const a = await f.open(); const b = await f.open(); await seed(a);
  assert.equal((await b.read(ctx(), ref('stock', { orderUuid: 'car-b' }))).value.version, 1);
  assert.equal((await a.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), 1, { revision: 'a' }))).status, 'ok');
  const stale = await b.transaction(ctx(), command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-b' }), 1, { revision: 'b' }));
  assert.equal(stale.status, 'stale-version', 'a cached instance sees the other instance commit before writing');
  assert.equal((await b.read(ctx(), ref('stock', { orderUuid: 'car-b' }))).value.revision, 'a');
  const race = await Promise.all([a, b].map((repository, i) => repository.transaction(ctx(), command(), (tx) => tx.conditionalClaim({ ...claimInput, holdId: `hold-${i}`, claimId: `claim-${i}` }))));
  assert.deepEqual(race.map(({ status }) => status).sort(), ['ok', 'stale-version'], 'exactly one instance occupies the car; the other sees its stock write');
  assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM "${f.schema}".holds`)).rows[0].n, 1);
  // The probe-derived fingerprint after an own commit lets the next read reuse the cache with one statement.
  const next = await f.measure(() => a.read(ctx(), ref('stock', { orderUuid: 'car-a' })));
  assert.equal(next.value.status, 'ok'); assert.equal(next.statements.length, 1, next.statements.map(({ sql }) => sql.slice(0, 60)).join('\n'));
  const reset = await a.resetRun(ctx(), command(), { expectedCurrentRunId: 'run-a', expectedRunVersion: 1,
    nextRun: { runId: 'run-b', environmentId: ctx().environmentId, current: true, status: 'active' }, rows: [] });
  assert.equal(reset.status, 'ok');
  const afterReset = await f.measure(() => a.read(ctx(), ref('runs', {})));
  assert.equal(afterReset.value.value.status, 'historical'); assert.equal(afterReset.statements.length, 1, 'reset keeps the scoped cache exact');
  assert.equal((await b.transaction(ctx(), command(), (tx) => tx.insert('decisions', { runId: 'run-a', decisionId: 'late' }))).status, 'stale-run');
});

test('native write set: a failed flush rolls back every row, poisons no cache and the retry replays once', native, async (t) => {
  const f = await fixture(t); const repository = await f.open(); await seed(repository);
  await f.pool.query(`CREATE FUNCTION "${f.schema}".reject_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture flush failure'; END; $$;
    CREATE TRIGGER reject_claim BEFORE INSERT ON "${f.schema}".claims FOR EACH ROW EXECUTE FUNCTION "${f.schema}".reject_claim()`);
  const stable = command();
  assert.equal((await repository.transaction(ctx(), stable, (tx) => tx.conditionalClaim(claimInput))).status, 'unavailable');
  const counts = await f.pool.query(`SELECT (SELECT count(*)::int FROM "${f.schema}".holds) AS holds,
    (SELECT max(version)::int FROM "${f.schema}".stock) AS stock, (SELECT count(*)::int FROM "${f.schema}".event_receipts WHERE event_id = $1) AS receipts`, [stable.commandId]);
  assert.deepEqual(counts.rows[0], { holds: 0, stock: 1, receipts: 0 });
  assert.equal((await repository.read(ctx(), ref('stock', { orderUuid: 'car-a' }))).value.state, 'available');
  await f.pool.query(`DROP TRIGGER reject_claim ON "${f.schema}".claims`);
  const saved = await repository.transaction(ctx(), stable, (tx) => tx.conditionalClaim(claimInput));
  assert.equal(saved.status, 'ok');
  const replay = await (await f.open()).transaction(ctx(), stable, () => result('conflict', { reason: 'must-not-run', current: {} }));
  assert.deepEqual(replay, saved, 'a new instance returns the stored outcome without repeating the write');
  assert.equal((await f.pool.query(`SELECT count(*)::int AS n FROM "${f.schema}".holds`)).rows[0].n, 1);
});
