import pg from 'pg';
import { withPostgresClient } from './postgres-client.js';
import { createRepository, createState, TABLES, FOUNDATION_TABLES, inputDigest, isScopeMiss, ok, result } from './core.js';
import { migrate, migrationStatus, validSchema, sqlName } from '../migrations/index.js';
import { packEvidence, evidenceReferences, unpackEvidence, verifyEvidence, jsonBatches, DEFAULT_BATCH_BYTES,
  writeEvidenceSnapshots, replaceEvidenceReferences } from './postgres-evidence.js';

// Same sealing as memory.js (FUCQ-302): committed rows are deep-frozen and shared, so a stray in-place write throws.
const deepFreeze = (value) => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
};
const sealed = new WeakSet();
const sealState = (state) => {
  if (sealed.has(state)) return state;
  for (const rows of Object.values(state.tables)) { if (!Object.isFrozen(rows)) { for (const row of rows) deepFreeze(row); Object.freeze(rows); } }
  Object.freeze(state.tables); Object.freeze(state); sealed.add(state);
  return state;
};
// A transaction gets fresh table arrays over the same frozen rows and replaces rows rather than editing them.
const shallowState = (state) => ({ ...state, tables: Object.fromEntries(Object.entries(state.tables).map(([name, rows]) => [name, rows.slice()])) });
// After a commit, unchanged tables keep the sealed arrays they were read from; only journalled rows need freezing.
const committedState = (before, state, mutations) => {
  const changed = new Set(mutations.map(({ table }) => table));
  for (const { row } of mutations) deepFreeze(row);
  const tables = Object.fromEntries(Object.entries(state.tables).map(([name, rows]) => [name, changed.has(name) ? Object.freeze(rows) : before.tables[name]]));
  const after = Object.freeze({ ...state, tables: Object.freeze(tables) }); sealed.add(after);
  return after;
};

const column = (name) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const unavailable = () => result('unavailable', { reason: 'database-unavailable', retryable: true });
const invalid = (code, field) => result('invalid', { code, reasons: [{ field, reason: 'Invalid backend configuration' }] });
const keyOf = (table, row) => JSON.stringify(TABLES[table].key.map((key) => row[key]));
const EVIDENCE_BATCH_DIGESTS = 500;
const REVISION_MIGRATION = '0010';

// The URL stays inside the backend closure; diagnostics never contain driver errors or configuration.
export function createPostgresRepository(options = {}) {
  const { schema = 'public', migrationsDirectory, now, pool: suppliedPool, readTrustMs = 0, writeBatchBytes = DEFAULT_BATCH_BYTES } = options;
  // Opt-in (hosted only): for readTrustMs after a cache entry was last checked or committed, reads trust it without a probe.
  const trustMs = Number.isSafeInteger(readTrustMs) && readTrustMs > 0 ? readTrustMs : 0;
  const until = () => trustMs ? performance.now() + trustMs : 0;
  let pool = suppliedPool;
  let owned = false;
  const tableName = (table) => `${sqlName(schema)}.${sqlName(table)}`;
  const migrationOptions = { schema, directory: migrationsDirectory };
  const databaseFailure = (error) => ['23505', '23503'].includes(error?.code)
    ? result('conflict', { reason: error.code === '23505' ? 'database-constraint-conflict' : 'missing-reference', current: {} })
    : unavailable();

  // Legacy fingerprint per table: all rows (runs) or this run's rows, as count and sum(version), which rise on any write.
  const scopeSql = (context, table) => table === 'runs' ? ''
    : context?.runId == null ? ' WHERE false' : ` WHERE run_id = ${pg.escapeLiteral(String(context.runId))}`;
  const union = (context, select) => FOUNDATION_TABLES.map((table) => select(pg.escapeLiteral(table), `${tableName(table)}${scopeSql(context, table)}`)).join(' UNION ALL ');
  const fingerprintSql = (context, wide) => union(context, (t, from) =>
    `SELECT ${t} AS t, ${wide ? 'NULL::jsonb AS data, ' : ''}count(*) AS n, coalesce(sum(version), 0) AS v FROM ${from}`);
  const snapshotSql = (context, wide) => union(context, (t, from) => `SELECT ${t} AS t, data${wide ? ', NULL::bigint AS n, NULL::numeric AS v' : ''} FROM ${from}`);
  // Hints come from validated core reads. Runs remain available for environment/history checks.
  const selectedSql = (context, selection) => {
    const parameters = [];
    const runs = `SELECT 'runs' AS t, data FROM ${tableName('runs')}`;
    if (selection.table === 'runs' || !FOUNDATION_TABLES.includes(selection.table)) return { sql: runs, parameters };
    const table = selection.table;
    parameters.push(String(context?.runId ?? ''));
    const where = ['run_id = $1'];
    for (const [key, value] of Object.entries(selection.filter)) {
      if (TABLES[table].key.includes(key) && (key === 'briefVersion' ? Number.isSafeInteger(value) : typeof value === 'string')) {
        parameters.push(value);
        where.push(`${sqlName(column(key))} = $${parameters.length}`);
      } else {
        parameters.push(key, JSON.stringify(value));
        where.push(`data -> $${parameters.length - 1}::text = $${parameters.length}::jsonb`);
      }
    }
    return { sql: `${runs} UNION ALL SELECT ${pg.escapeLiteral(table)} AS t, data FROM ${tableName(table)} WHERE ${where.join(' AND ')}`, parameters };
  };
  // FUCQ-424: all runs plus only the declared exact keys of this run, in one round trip.
  const scopedSql = (context, scope) => {
    const parameters = [String(context?.runId ?? '')]; const parts = [`SELECT 'runs' AS t, data FROM ${tableName('runs')}`];
    for (const table of [...new Set(scope.map((ref) => ref.table))]) {
      const fields = TABLES[table].key.filter((field) => field !== 'runId');
      parameters.push(JSON.stringify(scope.filter((ref) => ref.table === table).map(({ key }) => Object.fromEntries(fields.map((field) => [field, key[field]])))));
      const join = fields.map((field) => `r.${sqlName(column(field))} = k.e->>'${field}'`).join(' AND ');
      parts.push(`SELECT ${pg.escapeLiteral(table)} AS t, r.data FROM ${tableName(table)} AS r JOIN jsonb_array_elements($${parameters.length}::jsonb) AS k(e) ON r.run_id = $1 AND ${join}`);
    }
    return { sql: parts.join(' UNION ALL '), parameters };
  };
  // FUCQ-421: with 0010 applied, freshness is the runs revision plus this run's revision, read by primary key.
  const revisionSql = (context) => {
    const scopes = ['runs', ...(context?.runId == null ? [] : [`run:${context.runId}`])].map((scope) => pg.escapeLiteral(scope));
    return `SELECT 'revision' AS t, coalesce(max(revision) FILTER (WHERE scope = 'runs'), 0) AS runs, ${scopes[1] ? `coalesce(max(revision) FILTER (WHERE scope = ${scopes[1]}), 0)` : 'NULL::bigint'} AS run FROM ${tableName('repository_revisions')} WHERE scope IN (${scopes.join(', ')})`;
  };
  let revisions = false;
  const probeSql = (context) => revisions ? revisionSql(context) : fingerprintSql(context);
  const lockSql = (context) => `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${pg.escapeLiteral(`gcsp:run:${schema}:${context?.runId ?? ''}`)}, 0))`;

  const fingerprintOf = (rows) => {
    if (revisions) {
      const [row] = rows; if (row?.t !== 'revision') throw new Error('fingerprint-incomplete');
      return `revision:${BigInt(row.runs)}:${row.run == null ? '-' : BigInt(row.run)}`;
    }
    const seen = new Map(rows.filter((row) => row.n != null).map(({ t, n, v }) => [t, `${t}:${BigInt(n)}:${BigInt(v)}`]));
    return FOUNDATION_TABLES.map((table) => seen.get(table) ?? (() => { throw new Error('fingerprint-incomplete'); })()).join('|');
  };
  const localFingerprint = (state) => FOUNDATION_TABLES.map((table) =>
    `${table}:${state.tables[table].length}:${state.tables[table].reduce((sum, row) => sum + Number(row.version), 0)}`).join('|');
  // Loads only digests the selected rows reference, sequentially, in batches bounded by digest count and response bytes.
  // Sizes come from a small probe first; a value larger than the budget travels alone, untruncated.
  const hydrateEvidence = async (client, digests) => {
    const snapshots = new Map(); const from = tableName('vehicle_evidence_snapshots');
    const fetch = async (group) => {
      const found = new Map((await client.query(`SELECT digest, data FROM ${from} WHERE digest = ANY($1::text[])`, [group])).rows.map(({ digest, data }) => [digest, data]));
      for (const digest of group) snapshots.set(digest, verifyEvidence(digest, found.get(digest)));
    };
    if (digests.length === 1) { await fetch(digests); return snapshots; }
    for (let at = 0; at < digests.length; at += EVIDENCE_BATCH_DIGESTS) {
      const chunk = digests.slice(at, at + EVIDENCE_BATCH_DIGESTS);
      const sizes = new Map((await client.query(`SELECT digest, octet_length(data::text)::bigint AS bytes FROM ${from} WHERE digest = ANY($1::text[])`, [chunk]))
        .rows.map(({ digest, bytes }) => [digest, Number(bytes)]));
      let group = []; let bytes = 0;
      for (const digest of chunk) {
        // A missing digest still joins a fetch so verification refuses it, as before.
        const size = sizes.get(digest) ?? 0;
        if (group.length && bytes + size > writeBatchBytes) { await fetch(group); group = []; bytes = 0; }
        group.push(digest); bytes += size;
      }
      if (group.length) await fetch(group);
    }
    return snapshots;
  };
  const toState = async (client, rows) => {
    const state = createState();
    const digests = new Set();
    for (const { data } of rows) if (data != null) for (const digest of evidenceReferences(data)) digests.add(digest);
    const snapshots = digests.size ? await hydrateEvidence(client, [...digests]) : new Map();
    for (const { t, data } of rows) if (data != null) state.tables[t].push(unpackEvidence(data, snapshots));
    return state;
  };
  // Cache entry: the sealed snapshot scope (runs plus this run's rows), sharing frozen rows like memory.js (FUCQ-302).
  const scopedCopy = (state, context) => {
    const copy = createState();
    for (const table of FOUNDATION_TABLES) {
      copy.tables[table] = table === 'runs' ? state.tables.runs.slice() : context?.runId == null ? [] : state.tables[table].filter((row) => row.runId === context.runId);
    }
    return sealState(copy);
  };
  const cache = new Map();
  const remember = (key, entry) => {
    cache.delete(key); cache.set(key, entry);
    if (cache.size > 4) cache.delete(cache.keys().next().value);
  };
  // After an own commit, a runs-only entry (the current-run read) takes the committed runs; other run scopes reload.
  // Revisions: a runs-only entry takes the committed runs revision and keeps its own run part (same run: the committed one).
  const refreshOthers = (key, runs, committed) => {
    for (const [other, entry] of [...cache]) {
      if (other === key) continue;
      if (entry.selection?.table !== 'runs') { cache.delete(other); continue; }
      const state = sealState({ ...entry.state, tables: { ...entry.state.tables, runs } });
      const fingerprint = !revisions ? localFingerprint(state) : JSON.parse(other)[0] === JSON.parse(key)[0] ? committed
        : `revision:${committed.split(':')[1]}:${entry.fingerprint.split(':')[2]}`;
      cache.set(other, { fingerprint, state, selection: entry.selection, trustedUntil: until() });
    }
  };

  // Tables with partial unique indexes on mutable state keep ordered per-row updates.
  const ROW_UPDATE_TABLES = new Set(['runs', 'holds', 'claims']);
  const NUMERIC_KEYS = new Set(['briefVersion']);
  const concurrentWrite = () => Object.assign(new Error('concurrent-write'), { code: '40001' });

  // Persists exactly the journalled write set (FUCQ-423); updates stay version-checked against the stored row.
  async function flush(client, mutations) {
    const snapshots = new Map(); const references = new Map(); const encoded = { insert: new Map(), update: new Map() };
    for (const { type, table, row, expectedVersion, previous } of mutations) {
      if (!FOUNDATION_TABLES.includes(table) || !['insert', 'update'].includes(type)) throw new Error('unsupported-mutation');
      const packed = packEvidence(row);
      for (const [digest, data] of packed.snapshots) snapshots.set(digest, data);
      // Keep the logical state/cache unchanged. Only the durable representation contains references.
      if (packed.references.size || previous && packEvidence(previous).references.size) {
        const owners = references.get(table) ?? []; references.set(table, owners);
        owners.push({ key: keyOf(table, row), digests: [...packed.references] });
      }
      const rows = encoded[type].get(table) ?? []; encoded[type].set(table, rows);
      rows.push(type === 'update' ? [packed.data, expectedVersion] : packed.data);
    }
    await writeEvidenceSnapshots(client, tableName, snapshots);
    for (const table of FOUNDATION_TABLES) {
      const rows = encoded.update.get(table);
      if (!rows) continue;
      const keys = TABLES[table].key;
      if (ROW_UPDATE_TABLES.has(table)) {
        const where = keys.map((key, index) => `${sqlName(column(key))} = $${index + 2}`).join(' AND ');
        for (const [row, old] of rows) {
          const updated = await client.query(`UPDATE ${tableName(table)} SET data = $1::jsonb WHERE ${where} AND version = $${keys.length + 2}`,
            [JSON.stringify(row), ...keys.map((key) => row[key]), old]);
          if (updated.rowCount !== 1) throw concurrentWrite();
        }
        continue;
      }
      const where = keys.map((key) => `t.${sqlName(column(key))} = (v.data->>'${key}')${NUMERIC_KEYS.has(key) ? '::bigint' : ''}`).join(' AND ');
      for (const json of jsonBatches(rows.map(([row, old]) => ({ row, old })), writeBatchBytes)) {
        const updated = await client.query(`UPDATE ${tableName(table)} AS t SET data = v.data FROM (SELECT e->'row' AS data, (e->>'old')::bigint AS old
          FROM jsonb_array_elements($1::jsonb) AS e) AS v WHERE ${where} AND t.version = v.old`,
        [json]);
        if (updated.rowCount !== JSON.parse(json).length) throw concurrentWrite();
      }
    }
    // Updates release existing partial-index entries before replacement rows are inserted.
    for (const table of FOUNDATION_TABLES) {
      for (const json of jsonBatches(encoded.insert.get(table) ?? [], writeBatchBytes)) {
        await client.query(`INSERT INTO ${tableName(table)} (data) SELECT value FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(value, ordinality) ORDER BY ordinality`,
          [json]);
      }
    }
    await replaceEvidenceReferences(client, tableName, references, writeBatchBytes);
  }
  // A cache hit matched the locked probe, so its committed fingerprint is the probe plus the write set's deltas.
  const advance = (fingerprint, context, mutations) => {
    // Triggers add one per scope per transaction; a concurrent runs bump only makes this lower, so the next probe reloads.
    if (revisions) {
      const [, runs, own] = fingerprint.split(':');
      const touched = (test) => mutations.some(test) ? 1n : 0n;
      const run = own === '-' ? '-' : BigInt(own) + touched(({ table, key }) => table !== 'runs' && key.runId === context?.runId);
      return `revision:${BigInt(runs) + touched(({ table }) => table === 'runs')}:${run}`;
    }
    const parts = new Map(fingerprint.split('|').map((part) => { const [t, n, v] = part.split(':'); return [t, [BigInt(n), BigInt(v)]]; }));
    for (const { type, table, key, row, expectedVersion } of mutations) {
      if (table !== 'runs' && (context?.runId == null || key.runId !== context.runId)) continue;
      const [n, v] = parts.get(table);
      parts.set(table, type === 'insert' ? [n + 1n, v + BigInt(row.version)] : [n, v + BigInt(row.version) - BigInt(expectedVersion)]);
    }
    return FOUNDATION_TABLES.map((table) => `${table}:${parts.get(table)[0]}:${parts.get(table)[1]}`).join('|');
  };

  async function run(context, work, write, selection, scope) {
    const runId = String(context?.runId ?? '');
    const scopeKey = JSON.stringify([runId, null]);
    const key = selection ? JSON.stringify([runId, inputDigest(selection)]) : scopeKey;
    try {
      const cached = cache.get(key);
      if (!write && trustMs && cached && performance.now() < cached.trustedUntil) return await work(cached.state);
      const complete = !write ? cache.get(scopeKey) : undefined;
      if (complete && trustMs && performance.now() < complete.trustedUntil) return await work(complete.state);
      if (!write && selection?.table === 'runs' && trustMs) {
        const recent = [...cache.values()].find((entry) => performance.now() < entry.trustedUntil);
        if (recent) return await work(recent.state);
      }
      return await withPostgresClient(pool, async (client) => {
        let begun = false;
        try {
          begun = true;
          // A legacy scoped write with no cache entry cannot hit, so it skips the wide probe; the revision probe is a key read.
          const lockOnly = !revisions && write && scope && !cache.has(key);
          const probe = await client.query(lockOnly ? lockSql(context) : `${lockSql(context)}; ${probeSql(context)}${write ? '' : '; COMMIT'}`);
          const fingerprint = lockOnly ? undefined : fingerprintOf(probe[2].rows);
          const hit = lockOnly ? undefined : cache.get(key)?.fingerprint === fingerprint ? cache.get(key)
            : complete?.fingerprint === fingerprint ? complete : undefined;
          if (hit) remember(hit === complete ? scopeKey : key, write ? hit : { ...hit, trustedUntil: until() });
          // Reads see the sealed snapshot directly; a transaction gets fresh table arrays over the same frozen rows.
          if (!write) {
            begun = false;
            if (hit) return await work(hit.state);
            const selected = selection && selectedSql(context, selection);
            const fresh = selected ? (await client.query(selected.sql, selected.parameters)).rows
              : (await client.query(snapshotSql(context))).rows;
            const state = sealState(await toState(client, fresh));
            remember(key, { fingerprint, state, selection, trustedUntil: until() });
            return await work(state);
          }
          let before; let state; let done; let partial = false;
          if (scope && !hit) {
            const selected = scopedSql(context, scope);
            const loaded = await toState(client, (await client.query(selected.sql, selected.parameters)).rows);
            state = shallowState(sealState(Object.assign(loaded, { scope })));
            try { done = await work(state); partial = true; } catch (error) { if (!isScopeMiss(error)) throw error; }
          }
          // An under-declared transaction reruns on the full state in this same locked transaction; nothing was flushed yet.
          if (!partial) {
            before = hit ? hit.state : sealState(await toState(client, (await client.query(snapshotSql(context))).rows));
            state = shallowState(before);
            done = await work(state);
          }
          const { commit, outcome, mutations } = done;
          if (!commit) { await client.query('ROLLBACK'); begun = false; return outcome; }
          if (!Array.isArray(mutations)) throw new Error('missing-mutations');
          await flush(client, mutations);
          if (partial) {
            // Partial state is never cached; trusted reads must not serve pre-commit rows.
            await client.query('COMMIT'); begun = false;
            cache.delete(key);
            if (trustMs) refreshOthers(key, state.tables.runs, revisions ? advance(fingerprint, context, mutations) : undefined);
            return outcome;
          }
          // Only resetRun writes outside the cached scope (the next run's seed), so only it needs a filtered copy.
          const after = mutations.some(({ table, key: { runId } }) => table !== 'runs' && runId !== context?.runId) ? scopedCopy(state, context) : committedState(before, state, mutations);
          await client.query('COMMIT'); begun = false;
          // Revisions: the locked probe plus this commit's trigger bumps, whether or not the cache hit.
          const committed = revisions || hit ? advance(fingerprint, context, mutations) : localFingerprint(after);
          remember(key, { fingerprint: committed, state: after, trustedUntil: until() });
          if (trustMs) refreshOthers(key, after.tables.runs, committed);
          return outcome;
        } catch (error) {
          if (begun) await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    } catch (error) {
      cache.delete(key);
      for (const entry of cache.values()) entry.trustedUntil = 0;
      return databaseFailure(error);
    }
  }

  return createRepository({
    now,
    supportedTables: FOUNDATION_TABLES,
    async open() {
      if (!validSchema(schema)) return invalid('invalid-schema', 'schema');
      if (!Number.isSafeInteger(writeBatchBytes) || writeBatchBytes < 1024) return invalid('invalid-write-budget', 'writeBatchBytes');
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
      // Without 0010 applied (a deferred migration) the legacy fingerprint stays the freshness check.
      revisions = status.status === 'ok' && status.value.appliedVersions.includes(REVISION_MIGRATION);
      return status.status === 'ok' ? ok({ provider: 'postgresql', migrationStatus: status.value }) : status;
    },
    migrationStatus() { return migrationStatus(pool, migrationOptions); },
    read(context, work, selection) { return run(context, work, false, selection); },
    transaction(context, work, scope) { return run(context, work, true, undefined, scope); },
    async close() {
      try {
        if (owned && pool) await pool.end();
        if (owned) { pool = undefined; owned = false; }
        cache.clear();
        return ok({ closed: true });
      } catch { return unavailable(); }
    },
  });
}
