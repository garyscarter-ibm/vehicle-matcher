import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ok, result } from '../repository/core.js';

export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL('./', import.meta.url));
export const validSchema = (schema) => typeof schema === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(schema);
export const sqlName = (name) => `"${name}"`;
const unavailable = (reason = 'database-unavailable', retryable = true) => result('unavailable', { reason, retryable });

export async function loadMigrations(directory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const files = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const versions = new Set();
  const migrations = [];
  for (const filename of files) {
    const version = filename.slice(0, 4);
    if (versions.has(version)) throw new Error('duplicate-migration-version');
    versions.add(version);
    const sql = await readFile(join(directory, filename), 'utf8');
    migrations.push({ version, filename, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return migrations;
}

async function ledger(client, schema) {
  const name = `${sqlName(schema)}.schema_migrations`;
  const exists = await client.query('SELECT to_regclass($1) AS name', [name]);
  return exists.rows[0]?.name ? (await client.query(`SELECT version, filename, checksum FROM ${name} ORDER BY version`)).rows : [];
}

function verify(migrations, applied) {
  for (const row of applied) {
    const known = migrations.find((migration) => migration.version === row.version);
    if (!known || row.filename !== known.filename || row.checksum !== known.checksum) return unavailable('migration-history-mismatch', false);
  }
  return null;
}

export async function migrationStatus(pool, { schema = 'public', directory } = {}) {
  if (!validSchema(schema)) return result('invalid', { code: 'invalid-schema', reasons: [{ field: 'schema', reason: 'Use a simple SQL schema identifier' }] });
  let client;
  try {
    const migrations = await loadMigrations(directory);
    client = await pool.connect();
    const applied = await ledger(client, schema);
    const failure = verify(migrations, applied);
    if (failure) return failure;
    const appliedVersions = applied.map((row) => row.version);
    const pendingVersions = migrations.filter((row) => !appliedVersions.includes(row.version)).map((row) => row.version);
    return ok({ current: pendingVersions.length === 0, appliedVersions, pendingVersions });
  } catch {
    return unavailable();
  } finally {
    client?.release();
  }
}

export async function migrate(pool, { schema = 'public', directory } = {}) {
  if (!validSchema(schema)) return result('invalid', { code: 'invalid-schema', reasons: [{ field: 'schema', reason: 'Use a simple SQL schema identifier' }] });
  let client;
  let locked = false;
  let inTransaction = false;
  try {
    const migrations = await loadMigrations(directory);
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`gcsp:migrations:${schema}`]);
    locked = true;
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(`CREATE TABLE IF NOT EXISTS ${sqlName(schema)}.schema_migrations (
      version text PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query('COMMIT');
    inTransaction = false;
    const applied = await ledger(client, schema);
    const failure = verify(migrations, applied);
    if (failure) return failure;
    for (const migration of migrations.filter((row) => !applied.some((done) => done.version === row.version))) {
      await client.query('BEGIN');
      inTransaction = true;
      await client.query(`SET LOCAL search_path TO ${sqlName(schema)}`);
      await client.query(migration.sql);
      await client.query(`INSERT INTO ${sqlName(schema)}.schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)`,
        [migration.version, migration.filename, migration.checksum]);
      await client.query('COMMIT');
      inTransaction = false;
      applied.push(migration);
    }
    return ok({ current: true, appliedVersions: applied.map((row) => row.version), pendingVersions: [] });
  } catch {
    if (inTransaction) await client?.query('ROLLBACK').catch(() => {});
    return unavailable();
  } finally {
    if (locked) await client?.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`gcsp:migrations:${schema}`]).catch(() => {});
    client?.release();
  }
}
