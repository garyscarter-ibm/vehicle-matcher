import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { inputDigest, ok } from '../gcsp/repository/core.js';

// FUCQ-379 follow-up: the opt-in read window skips the per-read database check only after this process's own commit.
const url = process.env.GCSP_DATABASE_URL;
const options = { skip: url === undefined ? 'GCSP_DATABASE_URL is unset; native read-window proof was not run' : false };
const context = { environmentId: 'environment-window', runId: 'run-window', principalId: 'trusted-principal', roles: ['employee'] };
let serial = 0;
const command = () => { const id = `window-${++serial}`; return { commandId: id, inputDigest: inputDigest(id) }; };
const runRef = { table: 'runs', key: { runId: context.runId } };
const carRef = { table: 'stock', key: { runId: context.runId, orderUuid: 'car-a' } };
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function fixture(t) {
  const schema = `gcsp_window_${process.pid}_${++serial}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 }); admin.on('error', () => {});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pools = [];
  // Each repository gets its own pool; `connects` counts database checks (one per repository call that reaches PostgreSQL).
  const open = async (readTrustMs) => {
    const real = new pg.Pool({ connectionString: url, max: 2 }); real.on('error', () => {}); pools.push(real);
    const counter = { connects: 0 };
    const pool = { connect: () => { counter.connects += 1; return real.connect(); }, query: (...args) => real.query(...args), on: () => {}, end: () => real.end() };
    const repository = createPostgresRepository({ schema, pool, readTrustMs });
    assert.equal((await repository.open()).status, 'ok');
    return { repository, counter };
  };
  t.after(async () => { for (const pool of pools) await pool.end().catch(() => {}); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); });
  const seed = await open(0);
  const seeded = await seed.repository.transaction(context, command(), async (tx) => {
    await tx.insert('runs', { runId: context.runId, environmentId: context.environmentId, status: 'active', current: true, clockVersion: '1' });
    await tx.insert('stock', { runId: context.runId, orderUuid: 'car-a', orderNumber: '0000001', configurationId: 'config', state: 'available' });
    return ok({ seeded: true });
  });
  assert.equal(seeded.status, 'ok', JSON.stringify(seeded));
  return open;
}

test('postgresql read window: strict by default, every read checks the database', options, async (t) => {
  const open = await fixture(t);
  const { repository, counter } = await open(0);
  await repository.transaction(context, command(), (tx) => tx.compareAndSwap(runRef, 1, { clockVersion: '2' }));
  const before = counter.connects;
  for (let i = 0; i < 3; i += 1) assert.equal((await repository.read(context, carRef)).status, 'ok');
  assert.equal((await repository.currentRun(context.environmentId)).value.clockVersion, '2');
  assert.equal(counter.connects - before, 4);
});

test('postgresql read window: after an own commit, reads skip the check and see that commit, including the current run', options, async (t) => {
  const open = await fixture(t);
  const { repository, counter } = await open(60000);
  assert.equal((await repository.currentRun(context.environmentId)).value.clockVersion, '1');
  const written = await repository.transaction(context, command(), (tx) => tx.compareAndSwap(runRef, 1, { clockVersion: '2' }));
  assert.equal(written.status, 'ok', JSON.stringify(written));
  const before = counter.connects;
  assert.equal((await repository.currentRun(context.environmentId)).value.clockVersion, '2');
  assert.equal((await repository.read(context, carRef)).value.state, 'available');
  assert.equal((await repository.read(context, runRef)).value.clockVersion, '2');
  assert.equal(counter.connects - before, 0, 'reads inside the window reuse this process\'s committed state');
});

test('postgresql read window: a burst of reads shares one check, and another writer is seen once the window ends', options, async (t) => {
  const open = await fixture(t);
  const own = await open(80);
  const other = await open(0);
  const before = own.counter.connects;
  for (let i = 0; i < 5; i += 1) assert.equal((await own.repository.read(context, carRef)).value.state, 'available');
  assert.equal(own.counter.connects - before, 1, 'one database check covers the burst');
  assert.equal((await other.repository.transaction(context, command(), (tx) => tx.compareAndSwap(carRef, 1, { state: 'held' }))).status, 'ok');
  await wait(120);
  assert.equal((await own.repository.read(context, carRef)).value.state, 'held');
});

test('postgresql read window: another writer is seen once the window ends, and by the next own write at once', options, async (t) => {
  const open = await fixture(t);
  const own = await open(80);
  const other = await open(0);
  await own.repository.transaction(context, command(), (tx) => tx.compareAndSwap(carRef, 1, { state: 'held' }));
  const external = await other.repository.transaction(context, command(), (tx) => tx.compareAndSwap(carRef, 2, { state: 'sold' }));
  assert.equal(external.status, 'ok', JSON.stringify(external));
  // A write always checks: it sees the other writer's version, so its compare-and-swap on the stale version fails.
  const stale = await own.repository.transaction(context, command(), (tx) => tx.compareAndSwap(carRef, 2, { state: 'again' }));
  assert.notEqual(stale.status, 'ok');
  await wait(120);
  assert.equal((await own.repository.read(context, carRef)).value.state, 'sold');
});
