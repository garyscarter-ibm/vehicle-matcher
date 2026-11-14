import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import pg from 'pg';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { inputDigest, ok } from '../gcsp/repository/core.js';
import { RECEIPT_PROJECTIONS } from '../gcsp/repository/receipt-projections.js';
import { allocationLimitations, summarizeAllocation } from '../gcsp/allocation/summary.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';

// FUCQ-419: readReceipts is equal on both backends, its SQL projections equal the JS ones, and it reads bounded indexed rows.
const url = process.env.GCSP_DATABASE_URL;
const native = { skip: url === undefined ? 'native PostgreSQL URL unset' : false };
const NOW = '2026-11-14T00:00:00.000Z';
const ALLOCATION = 'buddy-allocation'; const EVALUATION = 'buddy-allocation-evaluation';
let serial = 0;
const command = () => { const id = `receipt-reads-${++serial}`; return { commandId: id, inputDigest: inputDigest(id) }; };
const ctx = (runId = 'run-a', environmentId = 'env-a') => ({ environmentId, runId, principalId: 'principal', roles: ['employee'] });
const filler = (bytes, tag) => `${tag}:`.padEnd(bytes, 'x');
const receipt = (consumerId, eventId, { tag = '', ...over } = {}) => ({ consumerId, eventId, eventType: 'fixture', inputDigest: inputDigest(`${consumerId}/${eventId}/${tag}`),
  inputVersions: { policy: 'p1' }, state: 'completed', outcome: ok({ marker: eventId }), ...over });
const assignments = (n, runId) => Array.from({ length: n }, (_, i) => ({ employeeId: `e${i}`, orderUuid: `car-${i}`, quote: { terms: filler(2048, `quote-${runId}-${i}`) } }));
const allocation = (runId, { offers = 2, refs, inline, excluded, quoteBytes = 2048 } = {}) => ok({ runId, ...(offers === null ? {} : { assignments: assignments(offers, runId).map((a) => ({ ...a, quote: { terms: filler(quoteBytes, 'q') } })) }),
  ...(refs && { evaluationRefs: { employeeIds: refs, claimInputs: filler(300, 'refs') } }), ...(inline && { evaluations: inline }), ...(excluded && { excluded }) });

// Synthetic rows for every projection branch, per run.
const rowsFor = (runId, tag = '') => [
  receipt(ALLOCATION, 'a-refs', { tag, outcome: allocation(runId, { refs: ['e1', 'e2', 'e3'], excluded: [{ employeeId: 'e9', reason: 'deadline' }, { employeeId: 'e9', reason: 'again' }] }) }),
  receipt(ALLOCATION, 'a-legacy', { tag, outcome: allocation(runId, { offers: 0, inline: [{ employeeId: 'e1' }, { employeeId: 'e2' }] }) }),
  receipt(ALLOCATION, 'a-both', { tag, outcome: allocation(runId, { refs: ['e1'], inline: [{ employeeId: 'x' }, { employeeId: 'y' }] }) }),
  receipt(ALLOCATION, 'a-empty-excluded', { tag, outcome: allocation(runId, { refs: ['e1', 'e2'], excluded: [] }) }),
  receipt(ALLOCATION, 'a-no-assignments', { tag, outcome: allocation(runId, { offers: null, refs: ['e1'] }) }),
  receipt(ALLOCATION, 'a-null-value', { tag, outcome: ok(null) }),
  receipt(ALLOCATION, 'a-failed', { tag, outcome: { status: 'unavailable', code: 'claim-pending' } }),
  receipt(ALLOCATION, 'a-pending', { tag, state: 'pending', outcome: allocation(runId, { refs: ['e1'] }) }),
  receipt(EVALUATION, 's-inputs', { tag, outcome: ok({ evaluation: { decisions: filler(4096, 'decisions') }, quoteInputs: { quoteFacts: { seats: 5 }, plan: filler(200, 'plan') }, claimInputs: filler(500, 'c') }) }),
  receipt(EVALUATION, 's-legacy', { tag, outcome: ok({ evaluation: { decisions: filler(1024, 'd') }, quotes: { 'car-1': { terms: filler(256, 'quote') } } }) }),
  receipt(EVALUATION, 's-both', { tag, outcome: ok({ evaluation: {}, quotes: { 'car-2': { terms: 'x' } }, quoteInputs: { quoteFacts: null } }) }),
  receipt(EVALUATION, 's-neither', { tag, outcome: ok({ evaluation: { decisions: filler(512, 'e') } }) }),
  receipt(EVALUATION, 's-failed', { tag, outcome: { status: 'unavailable', code: 'allocation-quote-unavailable', evaluation: filler(64, 'f') } }),
  receipt('stock-release', 'Z-release', { tag, outcome: ok({ quotes: { never: 'projected' }, quoteInputs: { never: 'projected' }, assignments: [1] }) }),
  receipt('stock-release', 'a-release', { tag, outcome: ok({ releasedAt: NOW }) }),
  receipt('buddy-expiry', 'hold-1', { tag, outcome: ok({ holdId: 'hold-1' }) }),
];

async function seedRows(repository, context, rows) {
  const out = await repository.transaction(context, command(), async (tx) => {
    const run = await tx.insert('runs', { runId: context.runId, environmentId: context.environmentId, status: 'active', current: true });
    if (run.status !== 'ok') return run;
    for (const row of rows) { const saved = await tx.recordReceipt(row); if (saved.status !== 'ok') return saved; }
    return ok('seeded');
  });
  assert.equal(out.status, 'ok', JSON.stringify(out));
}
async function addRows(repository, context, rows) {
  for (let at = 0; at < rows.length; at += 50) {
    const out = await repository.transaction(context, command(), async (tx) => {
      for (const row of rows.slice(at, at + 50)) { const saved = await tx.recordReceipt(row); if (saved.status !== 'ok') return saved; }
      return ok('added');
    });
    assert.equal(out.status, 'ok', JSON.stringify(out));
  }
}
const memory = async () => { const repository = createMemoryRepository({ store: createMemoryStore(), now: () => NOW }); assert.equal((await repository.open()).status, 'ok'); return repository; };
const runs = [['run-a', 'env-a', 'a'], ['run-b', 'env-b', 'b']];
const ALL = { consumerIds: [ALLOCATION, EVALUATION, 'stock-release', 'buddy-expiry'] };

// A pool whose clients log every statement with the rows and bytes it returned (data column only).
function database(t) {
  const schema = `gcsp_receipts_${process.pid}_${++serial}`; const pools = []; const repositories = []; const log = [];
  const admin = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 20000 }); admin.on('error', () => {}); pools.push(admin);
  t.after(async () => {
    for (const repository of repositories) await repository.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1', [schema])).rows[0].n, 0);
    for (const pool of pools) await pool.end();
  });
  const traced = (pool, into = log) => ({ async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = async function(sql, ...rest) {
      const entry = { sql: typeof sql === 'string' ? sql : sql.text, params: typeof sql === 'string' ? rest[0] : sql.values, rows: 0, bytes: 0, tables: {}, receipts: [] }; into.push(entry);
      const out = await query.call(this, sql, ...rest);
      if (!Array.isArray(out)) for (const row of out.rows ?? []) {
        const size = Buffer.byteLength(JSON.stringify(row.data ?? null)); entry.rows += 1; entry.bytes += size;
        if (row.t) entry.tables[row.t] = { rows: (entry.tables[row.t]?.rows ?? 0) + 1, bytes: (entry.tables[row.t]?.bytes ?? 0) + size };
        if (row.t === 'event_receipts') entry.receipts.push({ data: row.data, bytes: size });
      }
      return out;
    };
    const release = client.release;
    client.release = function(...args) { client.query = query; client.release = release; return release.apply(this, args); };
    return client;
  } });
  const open = async (options = {}) => {
    const { separate, ...rest } = options; const entries = options.log ?? log;
    let pool = admin;
    if (separate) { pool = new pg.Pool({ connectionString: url, max: 3, statement_timeout: 20000 }); pool.on('error', () => {}); pools.push(pool); }
    const repository = createPostgresRepository({ schema, pool: traced(pool, entries), now: () => NOW, ...rest }); repositories.push(repository);
    assert.equal((await repository.open()).status, 'ok'); return repository;
  };
  return admin.query(`CREATE SCHEMA "${schema}"`).then(() => ({ schema, admin, log, open }));
}
const receiptSelects = (entries) => entries.filter(({ sql }) => /"event_receipts"/.test(sql) && /^\s*SELECT/.test(sql));

test('projections: JS projection equals the memory repository and the summary helpers for every shape', async () => {
  const mem = await memory(); await seedRows(mem, ctx(), rowsFor('run-a'));
  const raw = (await mem.readReceipts(ctx(), ALL)).value;
  assert.equal(raw.length, rowsFor('run-a').length);
  for (const name of Object.keys(RECEIPT_PROJECTIONS)) {
    const projected = (await mem.readReceipts(ctx(), { ...ALL, projection: name })).value;
    assert.deepEqual(projected, raw.map((row) => RECEIPT_PROJECTIONS[name].js(row)), name);
  }
  const summaries = (await mem.readReceipts(ctx(), { ...ALL, projection: 'allocation-summary' })).value;
  for (const [n, row] of raw.entries()) {
    assert.equal(summaries[n].eventId, row.eventId);
    const s = summaries[n].summary;
    assert.ok(!('outcome' in summaries[n]) && !('inputVersions' in summaries[n]), 'projection drops outcome and inputVersions');
    if (row.consumerId !== ALLOCATION || row.outcome?.status !== 'ok' || row.outcome.value === null) continue;
    const counted = summarizeAllocation(row.outcome);
    assert.deepEqual({ events: 1, offers: s.offers, evaluated: s.evaluated }, counted.value.summary, row.eventId);
    assert.deepEqual(allocationLimitations({ excluded: s.excluded ?? undefined }), counted.value.limitations, row.eventId);
    assert.equal(s.runId, counted.value.runId);
  }
  assert.ok(raw.some((row) => row.eventId === 'a-both') && summaries.find((row) => row.eventId === 'a-both').summary.evaluated === 1, 'refs outrank legacy evaluations');
  const slices = (await mem.readReceipts(ctx(), { ...ALL, projection: 'quote-inputs' })).value;
  const bySlice = Object.fromEntries(slices.filter((row) => row.consumerId === EVALUATION).map((row) => [row.eventId, row.outcome]));
  assert.deepEqual(Object.keys(bySlice['s-inputs'].value), ['quoteInputs']);
  assert.deepEqual(Object.keys(bySlice['s-legacy'].value), ['quotes']);
  assert.deepEqual(Object.keys(bySlice['s-both'].value).sort(), ['quoteInputs', 'quotes']);
  assert.deepEqual(bySlice['s-neither'].value, {});
  assert.deepEqual(bySlice['s-failed'], raw.find((row) => row.eventId === 's-failed').outcome, 'a non-ok slice is returned unchanged');
  assert.deepEqual(slices.find((row) => row.eventId === 'Z-release'), raw.find((row) => row.eventId === 'Z-release'), 'other consumers are unchanged');
});

test('native projections: PostgreSQL SQL projection equals the JS projection, the memory result and summarizeAllocation', native, async (t) => {
  const db = await database(t); const pgRepo = await db.open(); const mem = await memory();
  for (const [runId, environmentId, tag] of runs) for (const repository of [pgRepo, mem]) await seedRows(repository, ctx(runId, environmentId), rowsFor(runId, tag));
  const full = await pgRepo.readReceipts(ctx(), ALL); const raw = (await mem.readReceipts(ctx(), ALL)).value;
  assert.deepEqual(full, await mem.readReceipts(ctx(), ALL), 'unprojected rows are identical on both backends');
  for (const name of Object.keys(RECEIPT_PROJECTIONS)) {
    const expected = raw.map((row) => RECEIPT_PROJECTIONS[name].js(row)).sort((a, b) => (a.consumerId < b.consumerId ? -1 : a.consumerId > b.consumerId ? 1 : a.eventId < b.eventId ? -1 : 1));
    const mark = db.log.length;
    const got = await pgRepo.readReceipts(ctx(), { ...ALL, projection: name });
    assert.equal(got.status, 'ok', JSON.stringify(got));
    assert.deepEqual(got.value, expected, `${name}: SQL projection equals JS projection`);
    assert.deepEqual(got, await mem.readReceipts(ctx(), { ...ALL, projection: name }), `${name}: memory equals PostgreSQL`);
    assert.ok(db.log.slice(mark).some(({ sql }) => sql.includes(RECEIPT_PROJECTIONS[name].sql)), 'the projection ran in SQL, not in core');
  }
  const summaries = (await pgRepo.readReceipts(ctx(), { ...ALL, projection: 'allocation-summary' })).value;
  for (const row of raw.filter((r) => r.consumerId === ALLOCATION && r.outcome?.status === 'ok' && r.outcome.value !== null)) {
    const s = summaries.find((x) => x.eventId === row.eventId).summary; const counted = summarizeAllocation(row.outcome);
    assert.deepEqual({ events: 1, offers: s.offers, evaluated: s.evaluated }, counted.value.summary, row.eventId);
    assert.deepEqual(allocationLimitations({ excluded: s.excluded ?? undefined }), counted.value.limitations, row.eventId);
  }
});

test('native equivalence: memory and PostgreSQL agree on filters, order, run isolation, context and invalid requests', native, async (t) => {
  const db = await database(t); const pgRepo = await db.open(); const mem = await memory();
  for (const [runId, environmentId, tag] of runs) for (const repository of [pgRepo, mem]) await seedRows(repository, ctx(runId, environmentId), rowsFor(runId, tag));
  const requests = [
    { consumerIds: [ALLOCATION] }, { consumerIds: [EVALUATION, ALLOCATION] }, { consumerIds: [ALLOCATION, ALLOCATION, 'stock-release'] }, ALL,
    { consumerIds: [ALLOCATION], eventIds: ['a-refs', 'a-failed', 'missing', 'a-refs'] }, { consumerIds: [ALLOCATION, EVALUATION], eventIds: ['s-inputs', 'a-legacy'] },
    { consumerIds: ALL.consumerIds, state: 'completed' }, { consumerIds: [ALLOCATION], state: 'pending' }, { consumerIds: ALL.consumerIds, state: 'nothing' },
    { consumerIds: [ALLOCATION], eventIds: ['a-pending', 'a-refs'], state: 'completed', projection: 'allocation-summary' },
    { consumerIds: ['absent'] }, { consumerIds: [ALLOCATION], eventIds: ['Z-release', 'a-release', 'a-refs'] }, { consumerIds: ['stock-release'] },
  ];
  for (const request of requests) {
    const [a, b] = [await pgRepo.readReceipts(ctx(), request), await mem.readReceipts(ctx(), request)];
    assert.equal(a.status, 'ok', JSON.stringify(request)); assert.deepEqual(a, b, JSON.stringify(request));
    assert.ok(a.value.every((row) => row.runId === 'run-a' && !String(row.inputDigest).includes('b/')), 'rows of the other run are never returned');
    const keys = a.value.map((row) => [row.consumerId, row.eventId]);
    assert.deepEqual(keys, [...keys].sort(([c1, e1], [c2, e2]) => (c1 < c2 ? -1 : c1 > c2 ? 1 : e1 < e2 ? -1 : e1 > e2 ? 1 : 0)), 'ordered by consumer then event');
    assert.equal(new Set(keys.map(String)).size, keys.length, 'duplicates in the request do not duplicate rows');
  }
  const stockRows = (await pgRepo.readReceipts(ctx(), { consumerIds: ['stock-release'] })).value;
  assert.deepEqual(stockRows.map((row) => row.eventId), ['Z-release', 'a-release'], 'ordinal order, upper case before lower case');
  const other = await pgRepo.readReceipts(ctx('run-b', 'env-b'), { consumerIds: [ALLOCATION], eventIds: ['a-refs'] });
  assert.equal(other.value[0].outcome.value.runId, 'run-b'); assert.deepEqual(other, await mem.readReceipts(ctx('run-b', 'env-b'), { consumerIds: [ALLOCATION], eventIds: ['a-refs'] }));
  // Context and environment checks are those of read().
  const wrong = ctx('run-a', 'env-b'); const runRef = { table: 'runs', key: { runId: 'run-a' } };
  for (const repository of [pgRepo, mem]) {
    assert.equal((await repository.read(wrong, runRef)).status, 'forbidden');
    assert.equal((await repository.readReceipts(wrong, ALL)).status, 'forbidden');
    assert.equal((await repository.readReceipts({ runId: 'run-a' }, ALL)).status, 'invalid');
    assert.deepEqual(await repository.readReceipts(ctx('run-unknown'), ALL), ok([]), 'an unknown run has no receipts');
  }
  assert.deepEqual(await pgRepo.readReceipts(wrong, ALL), await mem.readReceipts(wrong, ALL));
  assert.deepEqual(await pgRepo.readReceipts({ runId: 'run-a' }, ALL), await mem.readReceipts({ runId: 'run-a' }, ALL));
  const many = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const invalid = [null, [], 'x', {}, { consumerIds: [] }, { consumerIds: many(17, 'c') }, { consumerIds: [ALLOCATION], eventIds: [] }, { consumerIds: [ALLOCATION], eventIds: many(501, 'e') },
    { consumerIds: [ALLOCATION], projection: 'unknown' }, { consumerIds: [ALLOCATION], projection: 'toString' }, { consumerIds: [ALLOCATION], extra: true },
    { consumerIds: 'buddy-allocation' }, { consumerIds: [1] }, { consumerIds: [''] }, { consumerIds: [ALLOCATION], state: '' }, { consumerIds: [ALLOCATION], eventIds: 'a-refs' }];
  const before = db.log.length;
  for (const request of invalid) {
    const [a, b] = [await pgRepo.readReceipts(ctx(), request), await mem.readReceipts(ctx(), request)];
    assert.equal(a.status, 'invalid', JSON.stringify(request)); assert.equal(a.code, 'invalid-receipt-read'); assert.deepEqual(a, b);
  }
  assert.equal(db.log.length, before, 'invalid requests never reach PostgreSQL');
  for (const [consumers, events] of [[16, 500]]) {
    const edge = { consumerIds: many(consumers, 'c'), eventIds: many(events, 'e') };
    assert.deepEqual(await pgRepo.readReceipts(ctx(), edge), ok([])); assert.deepEqual(await mem.readReceipts(ctx(), edge), ok([]));
  }
});

test('native freshness: another instance sees a receipt recorded by a different instance on its next read', native, async (t) => {
  const db = await database(t); const logA = []; const logB = [];
  const a = await db.open({ separate: true, log: logA, readTrustMs: 0 }); const b = await db.open({ separate: true, log: logB, readTrustMs: 0 });
  await seedRows(a, ctx(), rowsFor('run-a'));
  const request = { consumerIds: [ALLOCATION], state: 'completed', projection: 'allocation-summary' };
  const first = await a.readReceipts(ctx(), request); assert.equal(first.status, 'ok');
  const mark = logA.length; assert.deepEqual(await a.readReceipts(ctx(), request), first);
  assert.equal(logA.slice(mark).length, 1, 'an unchanged run is one probe and no receipt select');
  assert.equal((await b.transaction(ctx(), command(), (tx) => tx.recordReceipt(receipt(ALLOCATION, 'a-new', { outcome: allocation('run-a', { refs: ['e1'] }) })))).status, 'ok');
  const markB = logA.length; const second = await a.readReceipts(ctx(), request);
  assert.equal(second.value.length, first.value.length + 1);
  assert.ok(second.value.some((row) => row.eventId === 'a-new'), 'the next read sees the other instance\'s receipt');
  assert.equal(receiptSelects(logA.slice(markB)).length, 1, 'a changed run reloads with one selected read');
  // The same receipt in a state that does not match is still filtered, not cached stale.
  assert.equal((await b.transaction(ctx(), command(), (tx) => tx.recordReceipt(receipt(ALLOCATION, 'a-pending-new', { state: 'pending' })))).status, 'ok');
  assert.deepEqual((await a.readReceipts(ctx(), request)).value.map((row) => row.eventId), second.value.map((row) => row.eventId));
  assert.ok((await a.readReceipts(ctx(), { consumerIds: [ALLOCATION], eventIds: ['a-pending-new'] })).value.length === 1);
});

test('native bounds: a selected projected read returns only the selected rows and bytes, however many receipts exist', native, async (t) => {
  const db = await database(t); const writer = await db.open(); const context = ctx();
  const batch = (from, to) => {
    const rows = [];
    for (let i = from; i < to; i += 1) {
      rows.push(receipt(ALLOCATION, `alloc-${i}`, { outcome: allocation('run-a', { offers: 3, refs: ['e1', 'e2', 'e3', 'e4', 'e5'], excluded: i % 2 ? [{ employeeId: 'e9' }] : undefined }) }));
      for (const employee of ['e1', 'e2', 'e3']) rows.push(receipt(EVALUATION, `alloc-${i}:${employee}`, { outcome: ok({ evaluation: { decisions: filler(8192, 'd') }, quoteInputs: { plan: 'x' } }) }));
      rows.push(receipt('stock-release', `release-${i}`, { outcome: ok({ releasedAt: NOW }) }), receipt(ALLOCATION, `pending-${i}`, { state: 'pending', outcome: ok({}) }));
    }
    return rows;
  };
  await seedRows(writer, context, batch(0, 5));
  // A fresh instance has no cache, as a new server process or another instance would; the writer's own cache already holds its commit.
  const repo = await db.open();
  const K = 3; const selected = { consumerIds: [ALLOCATION], eventIds: Array.from({ length: K }, (_, i) => `alloc-${i}`), state: 'completed', projection: 'allocation-summary' };
  const sample = async () => {
    const mark = db.log.length; const out = await repo.readReceipts(context, selected); const entries = db.log.slice(mark);
    return { out, entries };
  };
  const small = await sample();
  await addRows(writer, context, batch(5, 40));
  const large = await sample();
  for (const run of [small, large]) {
    assert.equal(run.out.status, 'ok'); assert.equal(run.out.value.length, K);
    assert.equal(run.entries.length, 2, 'one revision probe and one selected read');
    const select = receiptSelects(run.entries); assert.equal(select.length, 1);
    assert.equal(select[0].tables.event_receipts.rows, K); assert.equal(select[0].tables.runs.rows, 1);
    assert.equal(select[0].rows, K + 1, 'exactly the selected receipts plus the runs row');
    assert.ok(select[0].tables.event_receipts.bytes / K < 1024, `bytes per receipt ${select[0].tables.event_receipts.bytes / K}`);
    assert.ok(select[0].receipts.every(({ data }) => !('outcome' in data) && !JSON.stringify(data).includes('"quote"')), 'no outcome, assignments or quotes travel');
    assert.match(select[0].sql, /event_id = ANY\(\$3::text\[\]\)/);
  }
  assert.equal(receiptSelects(large.entries)[0].bytes, receiptSelects(small.entries)[0].bytes, 'bytes do not grow from 5 to 40 allocations');
  assert.equal(large.entries.length, small.entries.length);
  // The same read without a projection is the cost this avoids.
  const markFull = db.log.length; await repo.readReceipts(context, { consumerIds: [ALLOCATION], eventIds: selected.eventIds, state: 'completed' });
  const fullBytes = receiptSelects(db.log.slice(markFull))[0].tables.event_receipts.bytes;
  assert.ok(fullBytes > K * 6000, `unprojected ${fullBytes}`);
  // Statement count does not depend on how many receipts the consumer filter returns.
  const counts = [];
  for (const request of [{ consumerIds: [ALLOCATION] }, { consumerIds: [EVALUATION], projection: 'quote-inputs' }, { consumerIds: ['stock-release'], state: 'completed' }]) {
    await repo.readReceipts(context, request);
    await addRows(writer, context, [receipt('noise', `n-${++serial}`)]); const mark = db.log.length;
    const out = await repo.readReceipts(context, request); counts.push(db.log.slice(mark).length); assert.equal(out.status, 'ok');
  }
  assert.deepEqual(counts, [2, 2, 2]);
  t.diagnostic(JSON.stringify({ K, small: { statements: small.entries.length, rows: receiptSelects(small.entries)[0].rows, bytes: receiptSelects(small.entries)[0].bytes,
    receiptBytes: receiptSelects(small.entries)[0].tables.event_receipts.bytes }, large: { statements: large.entries.length, rows: receiptSelects(large.entries)[0].rows,
    bytes: receiptSelects(large.entries)[0].bytes, receiptBytes: receiptSelects(large.entries)[0].tables.event_receipts.bytes },
  unprojectedReceiptBytesForSameIds: fullBytes, receiptsInRun: { small: 5 * 6, large: 40 * 6 }, statementsPerFreshRead: counts }));
});

// A release trigger as stock-release writes it.
const release = (f, id, releasedAt) => ({ consumerId: 'stock-release', eventId: id, eventType: 'stock-released', inputDigest: inputDigest(id),
  inputVersions: { policy: f.context.policyVersion, clock: 'clock-v1', source: 'fixture-v1' }, state: 'completed',
  outcome: ok({ kind: 'stock-released', runId: f.context.runId, trancheId: id, windowId: 'window-1', supplyId: null, tickId: `tick-${id}`, releasedAt,
    orderUuids: [f.stock().orderUuid], visibleOrderUuids: [f.stock().orderUuid], policyVersion: f.context.policyVersion,
    source: { providerId: 'receipt-reads-test', mode: 'synthetic', version: 'fixture-v1', label: 'TEST' } }) });

test('native allocation tick: a settled tick reads summary rows in a constant number of selects, whatever the trigger count', native, async (t) => {
  const results = {};
  for (const releases of [1, 3]) {
    results[releases] = await measureOn(t, await database(t), releases);
  }
  const [one, three] = [results[1], results[3]];
  for (const run of [one, three]) {
    assert.deepEqual(run.second, run.first, 'the settled tick returns the same summary');
    assert.deepEqual(run.warm, run.first, 'and so does the same instance');
    assert.equal(run.claimsAfter, run.claims, 'the settled tick claims nothing');
    const rows = run.selects.flatMap((entry) => entry.receipts.map(({ data }) => data));
    assert.ok(rows.every((data) => data.consumerId !== EVALUATION), 'no evaluation slice is read');
    assert.ok(rows.every((data) => !JSON.stringify(data).includes('"assignments"')), 'no full allocation outcome is read');
    assert.ok(run.selects.length <= 3, `receipt selects ${run.selects.length}`);
  }
  assert.equal(three.selects.length, one.selects.length, 'receipt selects do not grow with completed triggers');
  assert.equal(three.all.length, one.all.length, 'statements do not grow with completed triggers');
  assert.ok(three.summaryRows >= 3 && three.summaryRows > one.summaryRows - 1);
  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(results).map(([n, r]) => [`${n} triggers`, { statements: r.all.length, receiptSelects: r.selects.length, warmReceiptSelects: r.warmSelects.length,
    receiptRows: r.selects.map((s) => s.tables.event_receipts?.rows ?? 0), receiptBytes: r.selects.map((s) => s.tables.event_receipts?.bytes ?? 0),
    consumers: [...new Set(r.selects.flatMap((s) => s.receipts.map(({ data }) => data.consumerId)))] }]))));
});

async function measureOn(t, db, releases) {
  let repository;
  // allocationFixture builds its repository from `now`; route it through this schema's traced pool.
  const pool = new pg.Pool({ connectionString: url, max: 3, statement_timeout: 20000 }); pool.on('error', () => {});
  t.after(() => pool.end());
  const log = db.log;
  const wrapped = { async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = async function(sql, ...rest) {
      const entry = { sql: typeof sql === 'string' ? sql : sql.text, rows: 0, bytes: 0, tables: {}, receipts: [] }; log.push(entry);
      const out = await query.call(this, sql, ...rest);
      if (!Array.isArray(out)) for (const row of out.rows ?? []) {
        const size = Buffer.byteLength(JSON.stringify(row.data ?? null)); entry.rows += 1; entry.bytes += size;
        if (row.t) entry.tables[row.t] = { rows: (entry.tables[row.t]?.rows ?? 0) + 1, bytes: (entry.tables[row.t]?.bytes ?? 0) + size };
        if (row.t === 'event_receipts') entry.receipts.push({ data: row.data, bytes: size });
      }
      return out;
    };
    const release = client.release;
    client.release = function(...args) { client.query = query; client.release = release; return release.apply(this, args); };
    return client;
  } };
  const f = await allocationFixture({ cars: 3, createRepository: ({ now }) => { repository = createPostgresRepository({ schema: db.schema, pool: wrapped, now }); return repository; } });
  t.after(() => repository.close());
  let descriptor; const service = f.create({ clock: { ...f.clock, async registerHandler(value) { descriptor = value; return ok({ registered: true }); } } });
  assert.equal((await service.register()).status, 'ok');
  const times = ['2026-11-05T11:58:00.000Z', '2026-11-05T11:59:00.000Z', '2026-11-05T12:00:00.000Z'].slice(0, releases);
  for (const [n, at] of times.entries()) assert.equal((await f.write((tx) => tx.recordReceipt(release(f, `tranche-${n}`, at)))).status, 'ok');
  const first = await descriptor.handle({ context: f.context });
  assert.equal(first.status, 'ok', JSON.stringify(first)); assert.equal(first.value.summary.events, releases);
  const claims = f.calls.length; const mark = log.length;
  const warm = await descriptor.handle({ context: f.context }); const warmEntries = log.slice(mark);
  // A fresh repository instance has no cache, as a restarted server would: its settled tick must still read summaries only.
  const cold = createPostgresRepository({ schema: db.schema, pool: wrapped, now: () => NOW }); assert.equal((await cold.open()).status, 'ok');
  t.after(() => cold.close());
  let coldDescriptor; const coldService = f.create({ repository: cold, clock: { ...f.clock, async registerHandler(value) { coldDescriptor = value; return ok({ registered: true }); } } });
  await coldService.register(); const coldMark = log.length;
  const second = await coldDescriptor.handle({ context: f.context }); const entries = log.slice(coldMark);
  const selects = receiptSelects(entries);
  const completed = (await repository.readReceipts(f.context, { consumerIds: [ALLOCATION], state: 'completed', projection: 'allocation-summary' })).value.length;
  return { first, warm, second, claims, claimsAfter: f.calls.length, all: entries, selects, warmSelects: receiptSelects(warmEntries), summaryRows: completed };
}

test('native explain: every readReceipts shape is a primary-key range on event_receipts', native, async (t) => {
  const db = await database(t); const repo = await db.open();
  const consumers = [ALLOCATION, EVALUATION, 'stock-release', 'buddy-expiry'];
  const plan = [['run-a', 'env-a', 100], ['run-b', 'env-b', 50], ['run-c', 'env-c', 50]];
  for (const [runId, environmentId, count] of plan) {
    const rows = Array.from({ length: count }, (_, i) => receipt(consumers[i % 4], `ev-${String(i).padStart(3, '0')}`, { state: i % 5 === 0 ? 'pending' : 'completed',
      outcome: i % 4 === 0 ? allocation(runId, { refs: ['e1', 'e2'] }) : ok({ i }) }));
    await seedRows(repo, ctx(runId, environmentId), rows);
  }
  await db.admin.query(`ANALYZE "${db.schema}"."event_receipts"`);
  const eventIds = Array.from({ length: 12 }, (_, i) => `ev-${String(i * 3).padStart(3, '0')}`);
  const shapes = { 'consumers only': { consumerIds: [ALLOCATION, 'stock-release'] }, 'consumers and events': { consumerIds: [ALLOCATION, EVALUATION], eventIds },
    'with state': { consumerIds: [ALLOCATION], eventIds, state: 'completed' }, 'allocation-summary projection': { consumerIds: [ALLOCATION], eventIds, state: 'completed', projection: 'allocation-summary' } };
  const plans = {};
  for (const [label, request] of Object.entries(shapes)) {
    const mark = db.log.length; const out = await repo.readReceipts(ctx(), request); assert.equal(out.status, 'ok', label);
    const select = receiptSelects(db.log.slice(mark)); assert.equal(select.length, 1, label);
    const explain = async (noSeq) => {
      const client = await db.admin.connect();
      try {
        await client.query('BEGIN'); if (noSeq) await client.query('SET LOCAL enable_seqscan = off');
        const text = (await client.query({ text: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${select[0].sql}`, values: select[0].params })).rows.map((row) => row['QUERY PLAN']).join('\n');
        await client.query('ROLLBACK'); return text;
      } finally { client.release(); }
    };
    let text = await explain(false); let forced = false;
    if (/Seq Scan on event_receipts/.test(text)) { forced = true; text = `${text}\n-- planner chose a Seq Scan on this small table; re-run with enable_seqscan = off:\n${await explain(true)}`; }
    const tail = forced ? text.slice(text.indexOf('-- planner')) : text;
    assert.match(tail, /event_receipts_pkey/, `${label}: the primary key is used`);
    assert.doesNotMatch(tail, /Seq Scan on event_receipts/, `${label}: no sequential scan of event_receipts`);
    plans[label] = { forced, nodes: [...text.matchAll(/(Index Scan|Index Only Scan|Bitmap Index Scan|Bitmap Heap Scan|Seq Scan)[^\n(]*/g)].map((m) => m[0].trim()) };
    const block = `\n=== readReceipts: ${label} (${forced ? 'Seq Scan chosen by default; index plan shown with enable_seqscan = off' : 'default plan'}) ===\n${select[0].sql}\n-- params: ${JSON.stringify(select[0].params)}\n${text}\n`;
    t.diagnostic(block); if (process.env.GCSP_EXPLAIN_OUT) appendFileSync(process.env.GCSP_EXPLAIN_OUT, block);
  }
  t.diagnostic(JSON.stringify(plans));
});
