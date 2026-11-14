import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inputDigest, ok, result } from '../gcsp/repository/core.js';
import { packEvidence, evidenceReferences, unpackEvidence, verifyEvidence, jsonBatches } from '../gcsp/repository/postgres-evidence.js';
import { compactPostgresEvidence } from '../gcsp/repository/postgres-evidence-maintenance.js';

const { createPostgresRepository } = await import(process.env.GCSP_MEMORY_BASELINE_MODULE
  ? pathToFileURL(process.env.GCSP_MEMORY_BASELINE_MODULE).href : '../gcsp/repository/postgres.js');
const provenance = { sourceRef: 'exact-source', observedAt: '2026-11-07T00:00:00.000Z', version: 'definitions-1', assurance: 'model-reference' };
const known = (value) => ({ status: 'known', value, unit: null, provenance });
const snapshot = (id, version = 'v1', definitions = 60) => ({ contractVersion: 'vehicle-snapshot-v1', identityKind: 'exact-stock',
  sourceKeys: { stockId: id }, snapshotVersion: version, observedAt: '2026-11-07T00:00:00.000Z',
  display: { name: 'Exact car', images: [{ src: '/retained.webp' }] },
  facts: { configurationEvidence: known({ identity: { configurationId: 'config-a' }, versions: { snapshot: version },
    equipment: { definitions: Array.from({ length: definitions }, (_, i) => ({ code: `option-${i}`, label: 'Exact option '.repeat(60), provenance })) } }),
  options: known(['Exact option']), colour: known('Blue'), interior: known('Black'), optionSelection: known({ codes: ['option-1'], complete: true }),
  syntheticIdentity: known({ vehicleId: id }), plannedRelease: known({ releaseId: 'release-1' }) } });

test('evidence codec shares only exact configuration facts and restores stock/quote/receipt payloads without change', () => {
  const original = { stock: snapshot('car-a'), quote: { facts: snapshot('car-b'), eligibility: { decision: { snapshot: snapshot('car-b') } } } };
  const packed = packEvidence(original);
  assert.equal(packed.snapshots.size, 1, 'different cars with the same exact evidence share one payload');
  assert.equal(packed.references.size, 1);
  assert.deepEqual([...evidenceReferences(packed.data)], [...packed.references]);
  for (const [digest, data] of packed.snapshots) verifyEvidence(digest, data);
  assert.deepEqual(unpackEvidence(packed.data, packed.snapshots), original);
  assert.equal(original.stock.facts.configurationEvidence.value.identity.configurationId, 'config-a', 'input is untouched');
  assert.ok(Buffer.byteLength(JSON.stringify(packed.data)) < Buffer.byteLength(JSON.stringify(original)) / 20);
  const successor = packEvidence(snapshot('car-a', 'v2'));
  assert.notDeepEqual([...successor.references], [...packed.references], 'source version changes create a different immutable snapshot');
});

test('evidence codec accepts inline legacy rows, refuses corrupt/missing references, and never drops large rows', () => {
  const inline = { facts: snapshot('car-a') };
  const ordinary = { __gcspEvidence: { label: 'an ordinary domain field' } };
  assert.deepEqual(unpackEvidence(packEvidence(ordinary).data, new Map()), ordinary);
  assert.deepEqual(unpackEvidence(inline, new Map()), inline);
  const packed = packEvidence(inline); const [digest, data] = [...packed.snapshots][0];
  assert.throws(() => verifyEvidence(digest, { ...data, colour: known('Altered') }));
  assert.throws(() => unpackEvidence(packed.data, new Map()));
  assert.throws(() => evidenceReferences({ ...packed.data.facts, __gcspEvidence: 'invalid' }));
  assert.throws(() => packEvidence(packed.data), /reserved-evidence-marker/);
  const rows = [{ unicode: 'é'.repeat(200) }, { text: 'x'.repeat(2000) }, { small: true }];
  const batches = [...jsonBatches(rows, 1024)];
  assert.deepEqual(batches.flatMap(JSON.parse), rows);
  assert.equal(batches.length, 3);
  for (const json of batches) assert.ok(Buffer.byteLength(json) <= 1024 || JSON.parse(json).length === 1);
});

const native = { skip: process.env.GCSP_DATABASE_URL === undefined ? 'native PostgreSQL URL unset' : false };
let serial = 0;
async function fixture(t, { writeBatchBytes = 64 * 1024, readTrustMs = 0 } = {}) {
  const schema = `gcsp_evidence_${process.pid}_${++serial}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 2, statement_timeout: 15000 }); pool.on('error', () => {});
  const repositories = []; const queries = [];
  t.after(async () => { for (const repository of repositories) await repository.close(); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const traced = { async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = function(sql, values, ...rest) {
      queries.push({ sql, values, bytes: (values ?? []).reduce((sum, value) => sum + Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)), 0) });
      return query.call(this, sql, values, ...rest);
    };
    const release = client.release;
    client.release = function(...args) { client.query = query; client.release = release; return release.apply(this, args); };
    return client;
  } };
  const open = async () => {
    const repository = createPostgresRepository({ schema, pool: traced, writeBatchBytes, readTrustMs }); repositories.push(repository);
    assert.equal((await repository.open()).status, 'ok'); return repository;
  };
  const context = { environmentId: schema, runId: 'run-a', principalId: 'principal', roles: ['employee'] };
  const command = () => { const commandId = `cmd-${++serial}`; return { commandId, inputDigest: inputDigest(commandId) }; };
  const repository = await open();
  const seeded = await repository.transaction(context, command(), async (tx) => {
    await tx.insert('runs', { runId: context.runId, environmentId: schema, status: 'active', current: true });
    return ok({ seeded: true });
  });
  assert.equal(seeded.status, 'ok');
  const ref = (table, key) => ({ table, key: { runId: context.runId, ...key } });
  return { repository, pool, schema, queries, open, context, command, ref };
}

test('native evidence: bounded writes deduplicate large stock facts and preserve pinned quotes across independent reopen and enrichment', native, async (t) => {
  const f = await fixture(t); const { repository, pool, schema, context, command, ref, queries } = f;
  const at = queries.length;
  const seeded = await repository.transaction(context, command(), async (tx) => {
    for (let i = 0; i < 24; i += 1) await tx.insert('stock', { runId: context.runId, orderUuid: `car-${i}`, configurationId: 'config-a', state: 'available', facts: snapshot(`car-${i}`) });
    await tx.insert('quotes', { runId: context.runId, quoteId: 'quote-a', orderUuid: 'car-0', facts: snapshot('car-0'), eligibility: { decision: { snapshot: snapshot('car-0') } }, terms: { monthlyPoints: 800 } });
    return ok({ count: 24 });
  });
  assert.equal(seeded.status, 'ok');
  const bulk = queries.slice(at).filter(({ sql }) => /jsonb_array_elements\(\$1::jsonb\)/.test(sql));
  assert.ok(bulk.length > 0);
  assert.ok(bulk.every(({ bytes }) => bytes <= 64 * 1024), 'a 24-car batch must not expand to megabytes in one PostgreSQL JSON operation');
  const counts = await pool.query(`SELECT (SELECT count(*)::int FROM "${schema}".vehicle_evidence_snapshots) AS snapshots,
    (SELECT count(*)::int FROM "${schema}".vehicle_evidence_references) AS refs,
    (SELECT max(octet_length(data::text))::int FROM "${schema}".stock) AS largest`);
  assert.equal(counts.rows[0].snapshots, 1); assert.equal(counts.rows[0].refs, 50, 'stock, quote and original-row replay receipts all retain the shared evidence'); assert.ok(counts.rows[0].largest < 5000);
  const reopened = await f.open();
  assert.deepEqual((await reopened.read(context, ref('stock', { orderUuid: 'car-0' }))).value.facts, snapshot('car-0'));
  const quote = (await reopened.read(context, ref('quotes', { quoteId: 'quote-a' }))).value;
  assert.deepEqual(quote.facts, snapshot('car-0')); assert.deepEqual(quote.eligibility.decision.snapshot, quote.facts);
  const child = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { createPostgresRepository } from './server/gcsp/repository/postgres.js';
    const [schema, runId] = process.argv.slice(1);
    const repository = createPostgresRepository({ schema, migrate: false });
    try {
      if ((await repository.open()).status !== 'ok') throw Error('open');
      const outcome = await repository.read({ environmentId: schema, runId, principalId: 'reopen', roles: [] },
        { table: 'quotes', key: { runId, quoteId: 'quote-a' } });
      process.stdout.write(JSON.stringify(outcome));
    } finally { await repository.close(); }
  `, schema, context.runId], { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15000, maxBuffer: 512 * 1024 });
  assert.deepEqual(JSON.parse(child).value, quote, 'a new Node process resolves the exact persisted quote');
  assert.equal((await reopened.transaction(context, command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'car-0' }), 1, { facts: snapshot('car-0', 'v2') }))).status, 'ok');
  assert.deepEqual((await (await f.open()).read(context, ref('quotes', { quoteId: 'quote-a' }))).value, quote);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_evidence_snapshots`)).rows[0].n, 2);
  await assert.rejects(pool.query(`UPDATE "${schema}".vehicle_evidence_snapshots SET data = '{}'::jsonb`), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM "${schema}".vehicle_evidence_snapshots`), (error) => error.code === '23503');
  t.diagnostic(JSON.stringify({ logicalStockBytes: Buffer.byteLength(JSON.stringify(snapshot('car-0'))) * 24, storedStockRowMaxBytes: counts.rows[0].largest,
    largestBulkParameterBytes: Math.max(...bulk.map(({ bytes }) => bytes)), sharedSnapshots: counts.rows[0].snapshots }));
});

test('native evidence: small reads avoid unrelated payloads, filters remain exact and empty read caches invalidate after commit', native, async (t) => {
  const f = await fixture(t, { readTrustMs: 60000 }); const { context, command, ref } = f;
  await f.repository.transaction(context, command(), async (tx) => {
    await tx.insert('stock', { runId: context.runId, orderUuid: 'large', configurationId: 'config-a', facts: snapshot('large') });
    await tx.insert('employees', { runId: context.runId, employeeId: 'person', name: 'Paula' });
    return ok({});
  });
  const fresh = await f.open(); const at = f.queries.length;
  assert.equal((await fresh.read(context, ref('employees', { employeeId: 'person' }))).value.name, 'Paula');
  const sql = f.queries.slice(at).map(({ sql }) => sql);
  assert.ok(!sql.some((query) => /AS t, data FROM .*\."stock"/.test(query)), 'employee read must not select stock payloads');
  assert.ok(!sql.some((query) => query.includes('FROM "' + f.schema + '"."vehicle_evidence_snapshots"')));
  assert.deepEqual((await fresh.query(context, 'quotes')).value, []);
  assert.equal((await fresh.transaction(context, command(), (tx) => tx.insert('quotes', { runId: context.runId, quoteId: 'new' }))).status, 'ok');
  assert.equal((await fresh.query(context, 'quotes')).value.length, 1, 'a cached empty table must not hide an own insert');
  for (const filter of [{ orderUuid: {} }, { orderUuid: null }, { configurationId: ['config-a'] }]) assert.deepEqual((await fresh.query(context, 'stock', filter)).value, []);
  assert.equal((await fresh.query(context, 'stock', { runId: 'other' })).status, 'stale-run');
});

test('native evidence: failed flush rolls back snapshot/reference writes and retries preserve command idempotency', native, async (t) => {
  const f = await fixture(t); const { context, command, ref, schema, pool } = f;
  await pool.query(`CREATE FUNCTION "${schema}".reject_stock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture flush failure'; END; $$;
    CREATE TRIGGER reject_stock BEFORE INSERT ON "${schema}".stock FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_stock()`);
  const cmd = command(); const work = (tx) => tx.insert('stock', { runId: context.runId, orderUuid: 'rollback', configurationId: 'config-a', facts: snapshot('rollback') });
  assert.equal((await f.repository.transaction(context, cmd, work)).status, 'unavailable');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_evidence_snapshots`)).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_evidence_references`)).rows[0].n, 0);
  await pool.query(`DROP TRIGGER reject_stock ON "${schema}".stock`);
  const saved = await f.repository.transaction(context, cmd, work); assert.equal(saved.status, 'ok');
  assert.deepEqual(await (await f.open()).transaction(context, cmd, () => result('conflict')), saved);
  assert.deepEqual((await (await f.open()).read(context, ref('stock', { orderUuid: 'rollback' }))).value.facts, snapshot('rollback'));
});

test('native evidence: legacy inline rows remain readable and compact on ordinary updates', native, async (t) => {
  const f = await fixture(t); const { context, command, ref, pool, schema } = f;
  const legacy = { runId: context.runId, orderUuid: 'legacy', configurationId: 'config-a', facts: snapshot('legacy'),
    version: 1, createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' };
  await pool.query(`INSERT INTO "${schema}".stock (data) VALUES ($1::jsonb)`, [JSON.stringify(legacy)]);
  assert.deepEqual((await (await f.open()).read(context, ref('stock', { orderUuid: 'legacy' }))).value, legacy);
  assert.equal((await f.repository.transaction(context, command(), (tx) => tx.compareAndSwap(ref('stock', { orderUuid: 'legacy' }), 1, { state: 'released' }))).status, 'ok');
  assert.equal((await pool.query(`SELECT octet_length(data::text)::int AS n FROM "${schema}".stock`)).rows[0].n < 5000, true);
  assert.deepEqual((await (await f.open()).read(context, ref('stock', { orderUuid: 'legacy' }))).value.facts, legacy.facts);
});

test('native evidence: compaction resumes in bounded steps without changing domain versions or pinned facts', native, async (t) => {
  const f = await fixture(t); const { schema, pool, context, ref } = f;
  const original = [];
  for (let i = 0; i < 3; i += 1) {
    const row = { runId: context.runId, orderUuid: `old-${i}`, facts: snapshot(`old-${i}`), configurationId: 'config-a',
      version: 7, createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-08T00:00:00.000Z' };
    original.push(row); await pool.query(`INSERT INTO "${schema}".stock (data) VALUES ($1::jsonb)`, [JSON.stringify(row)]);
  }
  let cursor = null; let done = false; let rewritten = 0;
  for (let step = 0; step < 20 && !done; step += 1) {
    const out = await compactPostgresEvidence({ pool, schema, cursor, maxRows: 2 });
    assert.equal(out.status, 'ok'); assert.ok(out.value.processed <= 2);
    ({ cursor, done } = out.value); rewritten += out.value.rewritten;
  }
  assert.equal(done, true); assert.equal(rewritten, 3);
  assert.equal((await compactPostgresEvidence({ pool, schema, maxRows: 100 })).value.rewritten, 0, 'a repeated pass is idempotent');
  for (const row of original) assert.deepEqual((await (await f.open()).read(context, ref('stock', { orderUuid: row.orderUuid }))).value, row);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_evidence_snapshots`)).rows[0].n, 1);
});

test('native evidence: compaction failure rolls back its row and resumes from its last committed checkpoint', native, async (t) => {
  const f = await fixture(t); const { schema, pool, context } = f;
  const row = { runId: context.runId, orderUuid: 'old', facts: snapshot('old'), version: 1,
    createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' };
  await pool.query(`INSERT INTO "${schema}".stock (data) VALUES ($1::jsonb)`, [JSON.stringify(row)]);
  await pool.query(`CREATE FUNCTION "${schema}".reject_ref() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture reference failure'; END; $$;
    CREATE TRIGGER reject_ref BEFORE INSERT ON "${schema}".vehicle_evidence_references FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_ref()`);
  const failed = await compactPostgresEvidence({ pool, schema });
  assert.equal(failed.status, 'unavailable'); assert.equal(failed.rewritten, 0);
  assert.deepEqual((await pool.query(`SELECT data FROM "${schema}".stock`)).rows[0].data, row);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM "${schema}".vehicle_evidence_snapshots`)).rows[0].n, 0);
  await pool.query(`DROP TRIGGER reject_ref ON "${schema}".vehicle_evidence_references`);
  const resumed = await compactPostgresEvidence({ pool, schema, cursor: failed.cursor });
  assert.equal(resumed.status, 'ok'); assert.equal(resumed.value.rewritten, 1);
});

test('native evidence: maintenance CLI persists and resumes a private checkpoint with bounded work', native, async (t) => {
  const f = await fixture(t); const directory = await mkdtemp(join(tmpdir(), 'gcsp-evidence-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = join(directory, 'checkpoint.json');
  const invoke = () => JSON.parse(execFileSync(process.execPath,
    ['server/scripts/compact-vehicle-evidence.mjs', '--state', state, '--schema', f.schema, '--rows', '2'],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 15000, maxBuffer: 8192 }));
  let reply = invoke(); assert.equal(reply.status, 'ok'); assert.ok(reply.processed <= 2);
  for (let i = 0; i < 10 && !reply.done; i += 1) reply = invoke();
  assert.equal(reply.done, true);
  const checkpoint = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(checkpoint.schema, f.schema); assert.equal(checkpoint.done, true);
  assert.match(checkpoint.databaseIdentity, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(checkpoint).includes(process.env.GCSP_DATABASE_URL), false);
});

// FUCQ-425: the per-digest loop this story replaced, kept as the semantic oracle.
async function perDigestOracle(pool, schema, runId) {
  const rows = (await pool.query(`SELECT data FROM "${schema}".stock WHERE run_id = $1`, [runId])).rows.map(({ data }) => data);
  const snapshots = new Map();
  for (const row of rows) for (const digest of evidenceReferences(row)) {
    if (snapshots.has(digest)) continue;
    const found = await pool.query(`SELECT data FROM "${schema}".vehicle_evidence_snapshots WHERE digest = $1`, [digest]);
    snapshots.set(digest, verifyEvidence(digest, found.rows[0]?.data));
  }
  return { rows: rows.map((row) => unpackEvidence(row, snapshots)), digests: snapshots.size };
}

test('native evidence: hydration batches many small snapshots, keeps mixed and oversized values within the byte budget, and matches per-digest reads', native, async (t) => {
  const budget = 64 * 1024;
  const f = await fixture(t, { writeBatchBytes: budget }); const { context, command, pool, schema, queries } = f;
  const inputs = [];
  for (let i = 0; i < 60; i += 1) {
    inputs.push({ orderUuid: `small-${i}`, facts: snapshot(`small-${i}`, `s${i}`, 1) });
    if (i % 20 === 4) inputs.push({ orderUuid: `large-${i}`, facts: snapshot(`large-${i}`, `l${i}`, 60) });
  }
  inputs.push({ orderUuid: 'oversized', facts: snapshot('oversized', 'o1', 140) }, { orderUuid: 'shared', facts: snapshot('shared-twin', 's3', 1) });
  const saved = await f.repository.transaction(context, command(), async (tx) => {
    for (const row of inputs) await tx.insert('stock', { runId: context.runId, configurationId: 'config-a', ...row });
    return ok({});
  });
  assert.equal(saved.status, 'ok', JSON.stringify(saved));
  const legacy = { runId: context.runId, orderUuid: 'legacy', configurationId: 'config-a', facts: snapshot('legacy', 'g1', 1),
    version: 1, createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' };
  await pool.query(`INSERT INTO "${schema}".stock (data) VALUES ($1::jsonb)`, [JSON.stringify(legacy)]);
  const sizes = new Map((await pool.query(`SELECT digest, octet_length(data::text)::int AS n FROM "${schema}".vehicle_evidence_snapshots`)).rows.map(({ digest, n }) => [digest, n]));
  assert.ok([...sizes.values()].some((n) => n > budget), 'the fixture includes a snapshot larger than the whole budget');

  const reader = await f.open(); const at = queries.length;
  const listed = await reader.query(context, 'stock');
  assert.equal(listed.status, 'ok', JSON.stringify(listed));
  const evidence = queries.slice(at).filter(({ sql }) => sql.includes('vehicle_evidence_snapshots'));
  const oracle = await perDigestOracle(pool, schema, context.runId);
  assert.deepEqual(listed.value, oracle.rows, 'same rows, same order, same expanded facts as the per-digest reads');
  const byId = new Map(listed.value.map((row) => [row.orderUuid, row]));
  for (const row of inputs) assert.deepEqual(byId.get(row.orderUuid).facts, row.facts, `${row.orderUuid} is restored untruncated`);
  assert.deepEqual(byId.get('legacy'), legacy, 'legacy inline evidence is returned unchanged');

  const fetches = evidence.filter(({ sql }) => /SELECT digest, data FROM/.test(sql));
  assert.equal(fetches.reduce((n, { values }) => n + values[0].length, 0), oracle.digests, 'each referenced digest is fetched exactly once');
  for (const { values: [group] } of fetches) {
    const bytes = group.reduce((n, digest) => n + sizes.get(digest), 0);
    assert.ok(bytes <= budget || group.length === 1, `a fetch of ${group.length} snapshots carried ${bytes} bytes`);
  }
  assert.ok(evidence.length * 4 < oracle.digests, `${evidence.length} evidence round trips for ${oracle.digests} digests`);
  assert.ok(!evidence.some(({ sql }) => !/= ANY\(\$1::text\[\]\)/.test(sql)), 'no evidence query reads the table without a digest list');
  t.diagnostic(JSON.stringify({ digests: oracle.digests, perDigestRoundTrips: oracle.digests, batchedRoundTrips: evidence.length,
    fetchSizes: fetches.map(({ values: [group] }) => group.length) }));

  const single = await f.open(); const before = queries.length;
  assert.deepEqual((await single.read(context, f.ref('stock', { orderUuid: 'oversized' }))).value.facts, byId.get('oversized').facts);
  assert.equal(queries.slice(before).filter(({ sql }) => sql.includes('vehicle_evidence_snapshots')).length, 1, 'a one-row read keeps a single evidence query');
});

test('native evidence: batched hydration fails closed when any referenced snapshot is missing or corrupt', native, async (t) => {
  const f = await fixture(t); const { context, command, pool, schema } = f;
  assert.equal((await f.repository.transaction(context, command(), async (tx) => {
    for (let i = 0; i < 5; i += 1) await tx.insert('stock', { runId: context.runId, orderUuid: `car-${i}`, facts: snapshot(`car-${i}`, `v${i}`, 1) });
    return ok({});
  })).status, 'ok');
  assert.equal((await (await f.open()).query(context, 'stock')).status, 'ok');
  const missing = packEvidence({ runId: context.runId, orderUuid: 'missing', facts: snapshot('missing', 'gone', 1), version: 1,
    createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' });
  await pool.query(`INSERT INTO "${schema}".stock (data) VALUES ($1::jsonb)`, [JSON.stringify(missing.data)]);
  assert.equal((await (await f.open()).query(context, 'stock')).status, 'unavailable', 'a missing snapshot refuses the whole read');
  const [[digest, data]] = [...missing.snapshots];
  await pool.query(`INSERT INTO "${schema}".vehicle_evidence_snapshots (digest, data) VALUES ($1, $2::jsonb)`, [digest, JSON.stringify({ ...data, colour: known('Altered') })]);
  assert.equal((await (await f.open()).query(context, 'stock')).status, 'unavailable', 'a snapshot failing its digest refuses the whole read');
  await pool.query(`DELETE FROM "${schema}".vehicle_evidence_snapshots WHERE digest = $1`, [digest]);
  await pool.query(`INSERT INTO "${schema}".vehicle_evidence_snapshots (digest, data) VALUES ($1, $2::jsonb)`, [digest, JSON.stringify(data)]);
  assert.equal((await (await f.open()).query(context, 'stock')).value.length, 6, 'the same rows read once the exact snapshot exists');
});
