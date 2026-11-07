import pg from 'pg';
import { createRepository, createState, TABLES, FOUNDATION_TABLES, inputDigest, ok, result } from './core.js';
import { migrate, migrationStatus, validSchema, sqlName } from '../migrations/index.js';

const column = (name) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const unavailable = () => result('unavailable', { reason: 'database-unavailable', retryable: true });
const invalid = (code, field) => result('invalid', { code, reasons: [{ field, reason: 'Invalid backend configuration' }] });
const keyOf = (table, row) => inputDigest(TABLES[table].key.map((key) => row[key]));

// The URL stays inside the backend closure; diagnostics never contain driver errors or configuration.
export function createPostgresRepository(options = {}) {
  const { schema = 'public', migrationsDirectory, now, pool: suppliedPool } = options;
  let pool = suppliedPool;
  let owned = false;
  const tableName = (table) => `${sqlName(schema)}.${sqlName(table)}`;
  const migrationOptions = { schema, directory: migrationsDirectory };
  const databaseFailure = (error) => ['23505', '23503'].includes(error?.code)
    ? result('conflict', { reason: error.code === '23505' ? 'database-constraint-conflict' : 'missing-reference', current: {} })
    : unavailable();

  // One simple-protocol string: lock first, then the snapshot as its own statement (fresh READ COMMITTED snapshot).
  function snapshotSql(context, commit) {
    const scope = context?.runId == null ? ' WHERE false' : ` WHERE run_id = ${pg.escapeLiteral(String(context.runId))}`;
    const selects = FOUNDATION_TABLES.map((table) => `SELECT ${pg.escapeLiteral(table)} AS t, data FROM ${tableName(table)}${table === 'runs' ? '' : scope}`);
    const lock = pg.escapeLiteral(`gcsp:run:${schema}:${context?.runId ?? ''}`);
    return `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0)); ${selects.join(' UNION ALL ')}${commit ? '; COMMIT' : ''}`;
  }

  function toState(results) {
    const state = createState();
    for (const { t, data } of results[2].rows) state.tables[t].push(data);
    return state;
  }

  // Tables with partial unique indexes on mutable state keep ordered per-row updates.
  const ROW_UPDATE_TABLES = new Set(['runs', 'holds', 'claims']);
  const NUMERIC_KEYS = new Set(['briefVersion']);
  const CHUNK = 500;
  const concurrentWrite = () => Object.assign(new Error('concurrent-write'), { code: '40001' });

  async function flush(client, before, after) {
    const updates = [];
    const inserts = [];
    for (const table of FOUNDATION_TABLES) {
      const previous = new Map(before.tables[table].map((row) => [keyOf(table, row), row]));
      // Snapshot contains scoped rows plus runs. resetRun may add one replacement run's rows.
      for (const row of after.tables[table]) {
        const old = previous.get(keyOf(table, row));
        if (!old) { inserts.push([table, row]); continue; }
        if (inputDigest(old) === inputDigest(row)) continue;
        updates.push([table, row, old.version]);
      }
    }
    for (const table of FOUNDATION_TABLES) {
      const rows = updates.filter(([name]) => name === table);
      const keys = TABLES[table].key;
      if (ROW_UPDATE_TABLES.has(table)) {
        const where = keys.map((key, index) => `${sqlName(column(key))} = $${index + 2}`).join(' AND ');
        for (const [, row, old] of rows) {
          const updated = await client.query(`UPDATE ${tableName(table)} SET data = $1::jsonb WHERE ${where} AND version = $${keys.length + 2}`,
            [JSON.stringify(row), ...keys.map((key) => row[key]), old]);
          if (updated.rowCount !== 1) throw concurrentWrite();
        }
        continue;
      }
      const where = keys.map((key) => `t.${sqlName(column(key))} = (v.data->>'${key}')${NUMERIC_KEYS.has(key) ? '::bigint' : ''}`).join(' AND ');
      for (let offset = 0; offset < rows.length; offset += CHUNK) {
        const chunk = rows.slice(offset, offset + CHUNK);
        const updated = await client.query(`UPDATE ${tableName(table)} AS t SET data = v.data FROM (SELECT e->'row' AS data, (e->>'old')::bigint AS old
          FROM jsonb_array_elements($1::jsonb) AS e) AS v WHERE ${where} AND t.version = v.old`,
        [JSON.stringify(chunk.map(([, row, old]) => ({ row, old })))]);
        if (updated.rowCount !== chunk.length) throw concurrentWrite();
      }
    }
    // Updates release existing partial-index entries before replacement rows are inserted.
    for (const table of FOUNDATION_TABLES) {
      const rows = inserts.filter(([name]) => name === table).map(([, row]) => row);
      for (let offset = 0; offset < rows.length; offset += CHUNK) {
        await client.query(`INSERT INTO ${tableName(table)} (data) SELECT value FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(value, ordinality) ORDER BY ordinality`,
          [JSON.stringify(rows.slice(offset, offset + CHUNK))]);
      }
    }
  }

  async function run(context, work, write) {
    let client;
    let begun = false;
    try {
      client = await pool.connect();
      begun = true;
      const state = toState(await client.query(snapshotSql(context, !write)));
      if (!write) {
        begun = false;
        return await work(state);
      }
      const before = structuredClone(state);
      const { commit, outcome } = await work(state);
      if (!commit) { await client.query('ROLLBACK'); begun = false; return outcome; }
      await flush(client, before, state);
      await client.query('COMMIT'); begun = false;
      return outcome;
    } catch (error) {
      if (begun) await client?.query('ROLLBACK').catch(() => {});
      return databaseFailure(error);
    } finally {
      client?.release();
    }
  }

  return createRepository({
    now,
    supportedTables: FOUNDATION_TABLES,
    async open() {
      if (!validSchema(schema)) return invalid('invalid-schema', 'schema');
      if (!pool) {
        const connectionString = options.connectionString ?? process.env.GCSP_DATABASE_URL;
        if (!connectionString) return invalid('missing-database-url', 'GCSP_DATABASE_URL');
        try {
          const parsed = new URL(connectionString);
          if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return invalid('invalid-database-url', 'GCSP_DATABASE_URL');
          pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
            keepAlive: true, allowExitOnIdle: true, idleTimeoutMillis: 300000, statement_timeout: 10000, query_timeout: 15000 });
          pool.on('error', () => {});
          owned = true;
        } catch { return invalid('invalid-database-url', 'GCSP_DATABASE_URL'); }
      }
      if (typeof pool.connect !== 'function') return invalid('invalid-pool', 'pool');
      const status = options.migrate === false ? await migrationStatus(pool, migrationOptions) : await migrate(pool, migrationOptions);
      return status.status === 'ok' ? ok({ provider: 'postgresql', migrationStatus: status.value }) : status;
    },
    migrationStatus() { return migrationStatus(pool, migrationOptions); },
    read(context, work) { return run(context, work, false); },
    transaction(context, work) { return run(context, work, true); },
    async close() {
      try {
        if (owned && pool) await pool.end();
        if (owned) { pool = undefined; owned = false; }
        return ok({ closed: true });
      } catch { return unavailable(); }
    },
  });
}
