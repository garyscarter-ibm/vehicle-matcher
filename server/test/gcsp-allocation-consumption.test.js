import test from 'node:test';
import assert from 'node:assert/strict';
import { inputDigest, ok } from '../gcsp/repository/index.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { summarizeAllocation } from '../gcsp/allocation/summary.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';

// FUCQ-420: each tick processes only new, changed or pending triggers; settled history is digest-checked and counted.
const url = process.env.GCSP_DATABASE_URL;
const native = { skip: url === undefined ? 'native PostgreSQL URL unset' : false };
const TIMES = ['2026-11-05T11:58:00.000Z', '2026-11-05T11:59:00.000Z', '2026-11-05T12:00:00.000Z'];
const release = (f, id, releasedAt) => ({ consumerId: 'stock-release', eventId: id, eventType: 'stock-released', inputDigest: inputDigest(id),
  inputVersions: { policy: f.context.policyVersion, clock: 'clock-v1', source: 'fixture-v1' }, state: 'completed',
  outcome: ok({ kind: 'stock-released', runId: f.context.runId, trancheId: id, windowId: 'window-1', supplyId: null, tickId: `tick-${id}`, releasedAt,
    orderUuids: [f.stock().orderUuid], visibleOrderUuids: [f.stock().orderUuid], policyVersion: f.context.policyVersion,
    source: { providerId: 'allocation-consumption-test', mode: 'synthetic', version: 'fixture-v1', label: 'TEST' } }) });
const briefChange = (f, id, occurredAt) => ({ consumerId: 'brief:changes', eventId: id, eventType: 'brief-changed', inputDigest: inputDigest(id),
  inputVersions: { brief: 1, policy: f.context.policyVersion }, state: 'completed',
  outcome: ok({ eventId: id, eventType: 'brief-changed', runId: f.context.runId, employeeId: f.employees[0].employeeId,
    briefVersion: 1, previousBriefVersion: null, operation: 'confirmed', occurredAt }) });
const put = (f, row) => f.write((tx) => tx.recordReceipt(row));
// The fixture's default claim, except that it is unavailable (an uncertain commit) while `gate.down` is set.
const flaky = (gate) => { const occupied = new Set(); return (_, input) => {
  if (gate.down) return { status: 'unavailable' };
  if (occupied.has(input.orderUuid)) return { status: 'conflict', reason: 'car-occupied' };
  occupied.add(input.orderUuid); return ok({ claimId: input.operationId }); }; };

// Counts allocate() entries (its plan read), preparations and evaluation-slice reads through a repository wrapper.
function counted(f, base = f.repository) {
  const ops = { allocationReads: 0, prepares: 0, evaluationReads: 0 };
  const repository = { ...base,
    async read(context, ref) {
      if (ref.table === 'event_receipts' && ref.key.consumerId === 'buddy-allocation') ops.allocationReads += 1;
      if (ref.table === 'event_receipts' && ref.key.consumerId === 'buddy-allocation-evaluation') ops.evaluationReads += 1;
      return base.read(context, ref);
    },
    async readReceipts(context, request) {
      if (request.consumerIds.includes('buddy-allocation-evaluation')) ops.evaluationReads += request.eventIds?.length ?? Infinity;
      return base.readReceipts(context, request);
    },
    async transaction(context, command, work, options) {
      if (command.commandId.startsWith('allocation:snapshot:')) ops.prepares += 1;
      return base.transaction(context, command, work, options);
    } };
  return { ops, repository };
}
async function handler(f, overrides = {}) {
  let descriptor;
  const service = f.create({ ...overrides, clock: { ...f.clock, async registerHandler(value) { descriptor = value; return ok({ registered: true }); } } });
  assert.equal((await service.register()).status, 'ok');
  return { service, tick: () => descriptor.handle({ context: f.context }) };
}
const delta = (ops, before, f, claims) => ({ allocationReads: ops.allocationReads - before.allocationReads, prepares: ops.prepares - before.prepares,
  evaluationReads: ops.evaluationReads - before.evaluationReads, claims: f.calls.length - claims });
// The same producer receipts consumed in one detailed pass on a fresh memory fixture.
async function allAtOnce(times) {
  const g = await allocationFixture({ cars: 3 });
  for (const [n, at] of times.entries()) await put(g, release(g, `tranche-${n}`, at));
  const detailed = await g.service.consumeTriggers(g.context); assert.equal(detailed.status, 'ok', JSON.stringify(detailed));
  return { g, detailed };
}

test('consecutive releases prepare only the new trigger; settled history is counted, not replayed', async () => {
  const f = await allocationFixture({ cars: 3 }); const { ops, repository } = counted(f); const { tick } = await handler(f, { repository });
  const perRelease = []; let last;
  for (const [n, at] of TIMES.entries()) {
    await put(f, release(f, `tranche-${n}`, at));
    let before = { ...ops }; let claims = f.calls.length;
    last = await tick(); assert.equal(last.status, 'ok', JSON.stringify(last)); assert.equal(last.value.summary.events, n + 1);
    perRelease.push(delta(ops, before, f, claims));
    before = { ...ops }; claims = f.calls.length;
    assert.deepEqual(await tick(), last, 'a settled tick returns the same summary');
    assert.deepEqual(delta(ops, before, f, claims), { allocationReads: 0, prepares: 0, evaluationReads: 0, claims: 0 }, `settled after release ${n + 1}`);
  }
  for (const [n, d] of perRelease.entries()) {
    assert.equal(d.prepares, 1, `release ${n + 1} prepares once`);
    assert.equal(d.allocationReads, perRelease[0].allocationReads, `release ${n + 1} allocates one event, not ${n + 1}`);
  }
  const { g, detailed } = await allAtOnce(TIMES);
  assert.deepEqual(await f.create().consumeTriggers(f.context), detailed, 'offers and audit references equal one pass over the same triggers');
  assert.equal(f.calls.length, g.calls.length, 'the same claims were attempted');
  const { tick: once } = await handler(g); assert.deepEqual(await once(), last, 'and the same tick summary');
});

test('a pending claim resumes before a new trigger that sorts ahead of it', async () => {
  const gate = { down: true }; const f = await allocationFixture({ cars: 1, claimResult: flaky(gate) });
  await put(f, release(f, 'tranche-0', TIMES[2]));
  const { tick } = await handler(f);
  assert.equal((await tick()).code, 'claim-pending');
  const pending = f.calls[0].input;
  // At the same instant 'brief:changes' sorts before 'stock-release', so canonical order would try the new trigger first.
  await put(f, briefChange(f, 'brief-same-instant', TIMES[2])); gate.down = false;
  const out = await f.create().consumeTriggers(f.context, { summary: true }); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(f.calls[1].input.operationId, pending.operationId, 'the uncertain claim is retried first, with the same operation');
  assert.equal(f.calls[1].input.eventId, pending.eventId);
  assert.deepEqual(f.calls[1].input.quote, pending.quote);
  const detailed = await f.create().consumeTriggers(f.context); assert.equal(detailed.status, 'ok');
  assert.deepEqual(detailed.value.allocations.map((a) => a.event.sourceReceipt.consumerId), ['brief:changes', 'stock-release'], 'detail keeps canonical order');
  const won = detailed.value.allocations[1].assignments;
  assert.equal(won.length, 1); assert.equal(won[0].operationId, pending.operationId, 'the resumed claim keeps the car');
  assert.equal(detailed.value.allocations[0].assignments.length, 0, 'the later trigger cannot take the occupied car');
  assert.equal(out.value.summary.offers, 1); assert.equal(out.value.summary.events, 2);
});

test('repeated delivery of a settled producer receipt changes nothing; a changed payload still conflicts', async () => {
  const f = await allocationFixture({ cars: 1 }); const { ops, repository } = counted(f); const { tick } = await handler(f, { repository });
  const source = release(f, 'tranche-0', TIMES[2]); await put(f, source);
  const first = await tick(); assert.equal(first.status, 'ok', JSON.stringify(first));
  await put(f, source); const before = { ...ops }; const claims = f.calls.length;
  assert.deepEqual(await tick(), first);
  assert.deepEqual(delta(ops, before, f, claims), { allocationReads: 0, prepares: 0, evaluationReads: 0, claims: 0 });
  // The producer's own digest is unchanged; the rebuilt event digest differs, so the summary row is not trusted.
  const ref = { table: 'event_receipts', key: { runId: f.context.runId, consumerId: 'stock-release', eventId: 'tranche-0' } };
  const row = (await f.repository.read(f.context, ref)).value;
  await f.write((tx) => tx.compareAndSwap(ref, row.version, { outcome: ok({ ...row.outcome.value, windowId: 'window-2' }) }));
  assert.equal((await tick()).status, 'conflict'); assert.equal(f.calls.length, claims);
});

test('a legacy completed receipt with inline evaluations is counted from its summary and still hydrates', async () => {
  const f = await allocationFixture({ cars: 2 }); const { ops, repository } = counted(f); const { tick } = await handler(f, { repository });
  await put(f, release(f, 'tranche-0', TIMES[2]));
  const modern = await tick(); assert.equal(modern.status, 'ok');
  const detailed = await f.create().consumeTriggers(f.context); const allocation = detailed.value.allocations[0];
  assert.ok(Array.isArray(allocation.evaluations) && !('evaluationRefs' in allocation));
  // Rewrite the completed receipt in its pre-FUCQ-209 inline form.
  const ref = { table: 'event_receipts', key: { runId: f.context.runId, consumerId: 'buddy-allocation', eventId: allocation.event.eventId } };
  const row = (await f.repository.read(f.context, ref)).value;
  await f.write((tx) => tx.compareAndSwap(ref, row.version, { outcome: ok(allocation) }));
  const before = { ...ops }; const claims = f.calls.length;
  const legacy = await tick();
  assert.deepEqual(legacy, modern); assert.deepEqual(legacy.value.summary, summarizeAllocation(ok(allocation)).value.summary);
  assert.deepEqual(delta(ops, before, f, claims), { allocationReads: 0, prepares: 0, evaluationReads: 0, claims: 0 });
  assert.deepEqual(await f.create().consumeTriggers(f.context), detailed, 'detail reads the inline evaluations unchanged');
});

test('native recovery: consecutive releases across restarts and an uncertain claim stay bounded and equivalent', native, async (t) => {
  const pg = (await import('pg')).default;
  const schema = `gcsp_consume_${process.pid}`; const pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 20000 }); pool.on('error', () => {});
  const repositories = [];
  t.after(async () => {
    for (const repository of repositories) await repository.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
  });
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.query(`CREATE SCHEMA "${schema}"`);
  const log = [];
  const traced = { async connect() {
    const client = await pool.connect(); const query = client.query;
    client.query = function(sql, ...rest) { log.push(typeof sql === 'string' ? sql : sql.text); return query.call(this, sql, ...rest); };
    const done = client.release;
    client.release = function(...args) { client.query = query; client.release = done; return done.apply(this, args); };
    return client;
  } };
  const open = (now) => { const r = createPostgresRepository({ schema, pool: traced, now }); repositories.push(r); return r; };
  const gate = { down: false }; const f = await allocationFixture({ cars: 3, createRepository: ({ now }) => open(now), claimResult: flaky(gate) });
  // A fresh repository and service per tick, as a restarted server would have: no cache, no in-process state.
  const restartTick = async () => { const cold = open(() => '2026-11-14T00:00:00.000Z'); assert.equal((await cold.open()).status, 'ok');
    const { ops, repository } = counted(f, cold); const { tick } = await handler(f, { repository });
    const mark = log.length; const claims = f.calls.length; const out = await tick();
    return { out, ops, claims: f.calls.length - claims, statements: log.length - mark }; };
  const settled = []; let last;
  for (const [n, at] of TIMES.entries()) {
    assert.equal((await put(f, release(f, `tranche-${n}`, at))).status, 'ok');
    if (n === 1) {
      gate.down = true;
      assert.equal((await restartTick()).out.code, 'claim-pending', 'an uncertain claim leaves the trigger pending');
      gate.down = false;
      const pending = f.calls.at(-1).input;
      const resumed = await restartTick(); assert.equal(resumed.out.status, 'ok', JSON.stringify(resumed.out));
      assert.equal(f.calls.at(-resumed.claims).input.operationId, pending.operationId, 'the restarted instance resumes the same operation');
      assert.equal(resumed.ops.prepares, 0, 'resumption does not re-prepare');
      last = resumed.out;
    } else {
      const fresh = await restartTick(); assert.equal(fresh.out.status, 'ok', JSON.stringify(fresh.out));
      assert.equal(fresh.ops.prepares, 1, `release ${n + 1} prepares once`); last = fresh.out;
    }
    const again = await restartTick();
    assert.deepEqual(again.out, last); assert.equal(again.claims, 0);
    assert.deepEqual([again.ops.prepares, again.ops.allocationReads, again.ops.evaluationReads], [0, 0, 0], `settled after release ${n + 1}`);
    settled.push(again.statements);
  }
  assert.ok(settled.every((n) => n === settled[0]), `settled tick statements stay constant: ${settled}`);
  const { detailed } = await allAtOnce(TIMES);
  const pgDetail = await f.create().consumeTriggers(f.context); assert.equal(pgDetail.status, 'ok');
  const audit = (out) => out.value.allocations.map((a) => ({ event: a.event.eventId, source: a.event.sourceReceipt, state: a.state,
    assignments: a.assignments.map((x) => [x.employeeId, x.orderUuid, x.operationId, x.claim]), attempts: a.attempts.map((x) => [x.employeeId, x.orderUuid, x.operationId, x.outcome.status]) }));
  assert.deepEqual(audit(pgDetail), audit(detailed), 'PostgreSQL recovery gives the offers and audit references of one memory pass');
  t.diagnostic(JSON.stringify({ settledTickStatements: settled, offers: last.value.summary.offers, events: last.value.summary.events }));
});
