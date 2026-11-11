import { FOUNDATION_TABLES, TABLES, ok, result } from './core.js';
import { sqlName, validSchema } from '../migrations/index.js';
import { withPostgresClient } from './postgres-client.js';
import { packEvidence, evidenceReferences, writeEvidenceSnapshots, replaceEvidenceReferences } from './postgres-evidence.js';

const column = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const validKeys = (table, keys) => Array.isArray(keys) && keys.length === TABLES[table].key.length
  && keys.every((value, i) => TABLES[table].key[i] === 'briefVersion' ? Number.isSafeInteger(value) && value > 0
    : typeof value === 'string' && value.length > 0 && value.length <= 512);

/** One resumable, bounded pass. Every row uses the repository's run lock and its own atomic transaction. */
export async function compactPostgresEvidence({ pool, schema = 'public', cursor = null, maxRows = 32 } = {}) {
  if (!validSchema(schema) || !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 500
    || cursor !== null && (!FOUNDATION_TABLES.includes(cursor?.table) || !validKeys(cursor.table, cursor.keys))) {
    return result('invalid', { code: 'invalid-evidence-compaction' });
  }
  let processed = 0; let rewritten = 0; let checkpoint = cursor;
  const tableName = (name) => `${sqlName(schema)}.${sqlName(name)}`;
  try {
    return await withPostgresClient(pool, async (client) => {
      for (let i = cursor ? FOUNDATION_TABLES.indexOf(cursor.table) : 0; i < FOUNDATION_TABLES.length; i += 1) {
        const table = FOUNDATION_TABLES[i]; const keys = TABLES[table].key; const columns = keys.map((key) => sqlName(column(key)));
        const after = checkpoint?.table === table ? checkpoint.keys : null;
        const where = after ? ` WHERE (${columns.join(', ')}) > (${after.map((_, n) => `$${n + 1}`).join(', ')})` : '';
        // Read only keys here; individual evidence values never accumulate in a page-sized JSON operation.
        const candidates = await client.query(`SELECT ${keys.map((key, n) => `${columns[n]} AS ${sqlName(key)}`).join(', ')} FROM ${tableName(table)}${where}
          ORDER BY ${columns.join(', ')} LIMIT ${maxRows - processed}`, after ?? []);
        for (const candidate of candidates.rows) {
          const values = keys.map((key) => candidate[key]);
          let begun = false; let changed = false;
          try {
            await client.query('BEGIN'); begun = true;
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`gcsp:run:${schema}:${candidate.runId}`]);
            const found = await client.query(`SELECT data FROM ${tableName(table)} WHERE ${columns.map((name, n) => `${name} = $${n + 1}`).join(' AND ')} FOR UPDATE`, values);
            const row = found.rows[0]?.data;
            if (row && evidenceReferences(row).size === 0) {
              const packed = packEvidence(row);
              if (packed.references.size) {
                await writeEvidenceSnapshots(client, tableName, packed.snapshots);
                await client.query(`UPDATE ${tableName(table)} SET data = $1::jsonb WHERE ${columns.map((name, n) => `${name} = $${n + 2}`).join(' AND ')}`, [JSON.stringify(packed.data), ...values]);
                await replaceEvidenceReferences(client, tableName, new Map([[table, [{ key: JSON.stringify(values), digests: [...packed.references] }]]]));
                changed = true;
              }
            }
            await client.query('COMMIT'); begun = false;
            if (changed) rewritten += 1;
          } catch (error) {
            if (begun) await client.query('ROLLBACK').catch(() => {});
            throw error;
          }
          processed += 1; checkpoint = { table, keys: values };
          if (processed === maxRows) return ok({ processed, rewritten, cursor: checkpoint, done: false });
        }
      }
      return ok({ processed, rewritten, cursor: checkpoint, done: true });
    });
  } catch {
    return result('unavailable', { reason: 'evidence-compaction-unavailable', retryable: true, processed, rewritten, cursor: checkpoint });
  }
}
