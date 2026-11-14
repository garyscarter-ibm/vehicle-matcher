import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import pg from 'pg';
import { migrate, migrationStatus, loadMigrations } from '../gcsp/migrations/index.js';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';
import { FOUNDATION_TABLES, inputDigest, ok } from '../gcsp/repository/core.js';
import { FilePolicyProvider, PostgresPolicyProvider } from '../gcsp/policy/index.js';
import { POLICY_TABLES } from '../gcsp/policy/publish.js';

const context = { environmentId: 'disconnect-env', runId: 'disconnect-run', principalId: 'principal', roles: ['employee'] };
const read = { runId: context.runId, asOf: '2026-11-05T09:00:00.000Z' };
const secret = 'private postgres://user:password@host/database';
const unavailable = (outcome) => {
  assert.equal(outcome.status, 'unavailable');
  assert.doesNotMatch(JSON.stringify(outcome), /private|password/);
};

// Real pg transport: authenticate the client, then drop its socket on its first
// query. This is a protocol stub, not proof of PostgreSQL SQL or Render access.
for (const operation of [migrate, migrationStatus]) {
  test(`real pg disconnect during ${operation.name} returns unavailable without an unhandled error`, async (t) => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      let authenticated = false;
      socket.on('data', () => {
        if (authenticated) { socket.destroy(); return; }
        authenticated = true;
        // AuthenticationOk, ReadyForQuery (idle).
        socket.write(Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0, 90, 0, 0, 0, 5, 73]));
      });
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const pool = new pg.Pool({ host: '127.0.0.1', port: server.address().port,
      user: 'test', database: 'test', ssl: false, max: 1, connectionTimeoutMillis: 1000, query_timeout: 1000 });
    pool.on('error', () => {});
    t.after(async () => {
      for (const socket of sockets) socket.destroy();
      await pool.end();
      await new Promise((done) => server.close(done));
    });
    unavailable(await operation(pool));
    assert.equal(pool.totalCount, 0, 'the disconnected client is discarded');
  });
}

async function fixture() {
  const migrations = await loadMigrations();
  const [seed] = await new FilePolicyProvider().loadVersions(read);
  const seedDigest = inputDigest(seed);
  const pool = { clients: [], fail: undefined, current: undefined, async connect() {
    const client = new EventEmitter();
    client.queries = [];
    client.release = (error) => { client.released = true; client.discarded = !!error; };
    client.query = async (sql) => {
      client.queries.push(sql);
      if (pool.fail?.(sql)) {
        const error = new Error(secret);
        client.emit('error', error);
        throw error;
      }
      if (sql.includes('to_regclass')) return { rows: [{ name: 'public.schema_migrations' }] };
      if (sql.includes('SELECT version, filename, checksum')) return { rows: migrations };
      const fingerprints = FOUNDATION_TABLES.map((t) => ({ t, n: '0', v: '0', data: null }));
      const probe = sql.includes('repository_revisions') ? [{ t: 'revision', runs: '0', run: '0' }] : fingerprints;
      if (sql.startsWith('BEGIN; SELECT')) return [{ rows: [] }, { rows: [] }, { rows: probe }, { rows: [] }];
      if (sql.startsWith("SELECT '")) return { rows: sql.includes('count(*)') ? fingerprints : [] };
      if (sql.includes('AS "seedDigest"')) return { rows: [{ policyVersion: seed.policyVersion, seedDigest }] };
      if (sql.startsWith('SELECT data')) {
        const table = sql.match(/\."([a-z_]+)"/)?.[1];
        if (table === 'policy_versions') return { rows: [{ data: { seed, seedDigest } }] };
        const collection = Object.keys(POLICY_TABLES).find((key) => POLICY_TABLES[key] === table);
        return { rows: (seed[collection] ?? []).map((data) => ({ data: { ...data, runId: read.runId } })) };
      }
      return { rows: [], rowCount: 1 };
    };
    pool.clients.push(client); pool.current = client;
    return client;
  } };
  return { pool, seed };
}

const released = (pool) => {
  for (const client of pool.clients) {
    assert.equal(client.released, true);
    assert.equal(client.listenerCount('error'), 0, 'lease listeners do not accumulate');
  }
};

test('migration disconnect during final unlock cannot report successful startup', async () => {
  const { pool } = await fixture();
  pool.fail = (sql) => sql.includes('pg_advisory_unlock');
  unavailable(await migrate(pool));
  assert.equal(pool.current.discarded, true);
  released(pool);
});

test('repository read disconnect is unavailable and the next call acquires a fresh client', async () => {
  const { pool } = await fixture();
  const repository = createPostgresRepository({ pool, migrate: false });
  assert.equal((await repository.open()).status, 'ok');
  pool.fail = (sql) => sql.startsWith('BEGIN; SELECT');
  unavailable(await repository.query(context, 'stock'));
  const broken = pool.current;
  assert.equal(broken.discarded, true);
  pool.fail = undefined;
  assert.equal((await repository.query(context, 'stock')).status, 'ok');
  assert.notEqual(pool.current, broken);
  released(pool);
});

test('disconnect while transaction work awaits prevents commit and returns unavailable', async () => {
  const { pool } = await fixture();
  const repository = createPostgresRepository({ pool, migrate: false });
  assert.equal((await repository.open()).status, 'ok');
  const outcome = await repository.transaction(context, { commandId: 'disconnect-command', inputDigest: inputDigest('disconnect') }, async () => {
    await Promise.resolve();
    pool.current.emit('error', new Error(secret));
    return ok({ completed: true });
  });
  unavailable(outcome);
  assert.equal(pool.current.discarded, true);
  assert.ok(!pool.current.queries.includes('COMMIT'));
  released(pool);
});

test('policy transaction disconnect is safe and a later connection can load policy', async () => {
  const { pool, seed } = await fixture();
  const provider = new PostgresPolicyProvider({ pool, migrate: false });
  assert.equal((await provider.open()).status, 'ok');
  pool.fail = (sql) => sql === 'BEGIN';
  await assert.rejects(provider.loadVersions(read), { code: 'source-unavailable' });
  assert.equal(pool.current.discarded, true);
  pool.fail = undefined;
  assert.deepEqual(await provider.loadVersions(read), [seed]);
  released(pool);
});

test('policy header disconnect discards the client and reloads instead of trusting cache', async () => {
  const { pool, seed } = await fixture();
  const provider = new PostgresPolicyProvider({ pool, migrate: false });
  await provider.loadVersions(read);
  const count = pool.clients.length;
  pool.fail = (sql) => sql.includes('AS "seedDigest"');
  assert.deepEqual(await provider.loadVersions(read), [seed]);
  assert.equal(pool.clients[count].discarded, true);
  assert.equal(pool.clients.length, count + 2, 'header failure requires a fresh transaction');
  released(pool);
});
