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

  async function snapshot(client, context) {
    const state = createState();
    for (const table of FOUNDATION_TABLES) {
      const query = table === 'runs'
        ? await client.query(`SELECT data FROM ${tableName(table)}`)
        : await client.query(`SELECT data FROM ${tableName(table)} WHERE run_id = $1`, [context?.runId ?? null]);
      state.tables[table] = query.rows.map((row) => row.data);
    }
    return state;
  }

  async function flush(client, before, after, context) {
    const inserts = [];
    for (const table of FOUNDATION_TABLES) {
      const previous = new Map(before.tables[table].map((row) => [keyOf(table, row), row]));
      for (const row of after.tables[table].filter((item) => item.runId === context.runId)) {
        const old = previous.get(keyOf(table, row));
        if (!old) { inserts.push([table, row]); continue; }
        if (inputDigest(old) === inputDigest(row)) continue;
        const keys = TABLES[table].key;
        const where = keys.map((key, index) => `${sqlName(column(key))} = $${index + 2}`).join(' AND ');
        const updated = await client.query(`UPDATE ${tableName(table)} SET data = $1::jsonb WHERE ${where} AND version = $${keys.length + 2}`,
          [JSON.stringify(row), ...keys.map((key) => row[key]), old.version]);
        if (updated.rowCount !== 1) throw Object.assign(new Error('concurrent-write'), { code: '40001' });
      }
    }
    // Updates release existing partial-index entries before replacement rows are inserted.
    for (const [table, row] of inserts) await client.query(`INSERT INTO ${tableName(table)} (data) VALUES ($1::jsonb)`, [JSON.stringify(row)]);
  }

  async function run(context, work, write) {
    let client;
    let begun = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN'); begun = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`gcsp:run:${schema}:${context?.runId ?? ''}`]);
      const state = await snapshot(client, context);
      if (!write) {
        const outcome = await work(state);
        await client.query('COMMIT'); begun = false;
        return outcome;
      }
      const before = structuredClone(state);
      const { commit, outcome } = await work(state);
      if (!commit) { await client.query('ROLLBACK'); begun = false; return outcome; }
      await flush(client, before, state, context);
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
            idleTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 15000 });
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
