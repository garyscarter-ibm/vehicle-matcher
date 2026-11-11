import { readFile, writeFile, rename } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { migrate, validSchema } from '../gcsp/migrations/index.js';
import { compactPostgresEvidence } from '../gcsp/repository/postgres-evidence-maintenance.js';

const args = process.argv.slice(2); const flags = new Map(); let pool;
try {
  if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !['--state', '--schema', '--rows'].includes(arg))) throw Error();
  for (let i = 0; i < args.length; i += 2) { if (flags.has(args[i])) throw Error(); flags.set(args[i], args[i + 1]); }
  const statePath = flags.get('--state'); const schema = flags.get('--schema') ?? 'public'; const maxRows = Number(flags.get('--rows') ?? 32);
  if (!isAbsolute(statePath ?? '') || !validSchema(schema) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 500 || !process.env.GCSP_DATABASE_URL) throw Error();
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const databaseIdentity = createHash('sha256').update(process.env.GCSP_DATABASE_URL).digest('hex');
  if (state && (state.version !== 1 || state.schema !== schema || state.databaseIdentity !== databaseIdentity)) throw Error();
  pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 1, connectionTimeoutMillis: 5000,
    statement_timeout: 15000, query_timeout: 20000 }); pool.on('error', () => {});
  if ((await migrate(pool, { schema })).status !== 'ok') throw Error();
  const outcome = await compactPostgresEvidence({ pool, schema, maxRows, cursor: state?.cursor ?? null });
  if (outcome.status !== 'ok') throw Error();
  const next = { version: 1, schema, databaseIdentity, ...outcome.value };
  // Commit the checkpoint only after the row transactions have finished; replay is harmless after interruption.
  await writeFile(`${statePath}.tmp`, JSON.stringify(next) + '\n', { mode: 0o600 }); await rename(`${statePath}.tmp`, statePath);
  console.log(JSON.stringify({ status: 'ok', processed: next.processed, rewritten: next.rewritten, done: next.done }));
} catch {
  console.error(JSON.stringify({ status: 'unavailable', reason: 'evidence-compaction-failed',
    usage: 'Set GCSP_DATABASE_URL; supply --state /absolute/checkpoint.json [--schema public] [--rows 32]. Rerun with the same state until done.' }));
  process.exitCode = 1;
} finally { if (pool) await pool.end().catch(() => {}); }
