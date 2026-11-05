import pg from 'pg';
import { FilePolicyProvider, snapshotVersions, PolicySourceError } from './file-provider.js';
import { migrate, migrationStatus, validSchema, sqlName } from '../migrations/index.js';
import { inputDigest } from '../repository/core.js';
import { POLICY_TABLES, policyUnavailable, policyOutcome } from './publish.js';

export class PostgresPolicyProvider {
  #options; #pool; #owned = false; #startup; #schema; #seedProvider;
  constructor({ schema = 'public', seedProvider = new FilePolicyProvider(), ...options } = {}) {
    this.#options = options; this.#pool = options.pool; this.#schema = schema; this.#seedProvider = seedProvider;
  }
  #table(name) { return `${sqlName(this.#schema)}.${sqlName(name)}`; }

  async open() {
    this.#startup ??= (async () => {
      try {
        if (!validSchema(this.#schema)) return policyOutcome('invalid', null, { code: 'invalid-schema', reasons: [{ field: 'schema', reason: 'Invalid backend schema.' }] });
        if (!this.#pool) {
          const connectionString = this.#options.connectionString ?? process.env.GCSP_DATABASE_URL;
          const parsed = new URL(connectionString);
          if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return policyUnavailable();
          this.#pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 1000, statement_timeout: 10000, query_timeout: 15000 });
          this.#pool.on('error', () => {}); this.#owned = true;
        }
        const status = await (this.#options.migrate === false ? migrationStatus : migrate)(this.#pool,
          { schema: this.#schema, directory: this.#options.migrationsDirectory });
        return status.status === 'ok' && status.value.current ? policyOutcome('ok', null, {
          value: { provider: 'postgresql', migrationStatus: status.value },
        }) : policyUnavailable();
      } catch { return policyUnavailable(); }
    })();
    return this.#startup;
  }

  async #records(client, runId) {
    const headers = await client.query(`SELECT data FROM ${this.#table('policy_versions')} WHERE run_id = $1 ORDER BY effective_from`, [runId]);
    const records = headers.rows.map(({ data }) => ({ ...data, seed: { ...data.seed } }));
    for (const [collection, table] of Object.entries(POLICY_TABLES)) {
      const rows = await client.query(`SELECT data FROM ${this.#table(table)} WHERE run_id = $1 ORDER BY policy_version, ordinal`, [runId]);
      for (const record of records) record.seed[collection] = rows.rows.filter(({ data }) => data.policyVersion === record.seed.policyVersion)
        .map(({ data }) => Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'runId')));
    }
    if (records.length) {
      snapshotVersions(records.map(({ seed }) => seed));
      if (records.some(({ seed, seedDigest }) => inputDigest(seed) !== seedDigest)) throw new PolicySourceError('source-invalid');
    }
    return records;
  }

  async #insert(client, runId, record) {
    const { seed, ...audit } = record;
    const header = Object.fromEntries(Object.entries(seed).filter(([key]) => !Object.hasOwn(POLICY_TABLES, key)));
    await client.query(`INSERT INTO ${this.#table('policy_versions')} (data, effective_from) VALUES ($1::jsonb, $2::timestamptz)`,
      [JSON.stringify({ runId, ...audit, seed: header }), seed.effectiveFrom]);
    for (const [collection, table] of Object.entries(POLICY_TABLES)) {
      // Bounded batches preserve seed ordering and avoid one network round-trip per matrix row.
      for (let offset = 0; offset < seed[collection].length; offset += 100) {
        const rows = seed[collection].slice(offset, offset + 100).map((row, index) => ({ data: { runId, ...row }, ordinal: offset + index, effectiveFrom: row.effectiveFrom }));
        await client.query(`INSERT INTO ${this.#table(table)} (data, ordinal, effective_from)
          SELECT entry->'data', (entry->>'ordinal')::integer, (entry->>'effectiveFrom')::timestamptz
          FROM jsonb_array_elements($1::jsonb) AS entry`, [JSON.stringify(rows)]);
      }
    }
  }

  async #transaction(read, build) {
    if ((await this.open()).status !== 'ok') throw new PolicySourceError('source-unavailable');
    let client; let begun = false;
    try {
      client = await this.#pool.connect();
      await client.query('BEGIN'); begun = true;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`gcsp:policy:${this.#schema}:${read.runId}`]);
      let records = await this.#records(client, read.runId);
      if (records.length === 0) {
        const [seed] = snapshotVersions(await this.#seedProvider.loadVersions(read));
        const record = { seed, seedDigest: inputDigest(seed), sourceVersion: seed.policyVersion,
          publisher: 'reviewed-repository-seed', publishedAt: seed.effectiveFrom };
        await this.#insert(client, read.runId, record); records = [record];
      }
      const prepared = await build(records);
      if (prepared.record) await this.#insert(client, read.runId, prepared.record);
      // Invalid publish outcomes roll back the whole transaction, including any first-use seed.
      await client.query(prepared.outcome && prepared.outcome.status !== 'ok' ? 'ROLLBACK' : 'COMMIT'); begun = false;
      return prepared.outcome ?? prepared.value;
    } catch (error) {
      if (begun) await client?.query('ROLLBACK').catch(() => {});
      if (error instanceof PolicySourceError) throw error;
      throw new PolicySourceError('source-unavailable');
    } finally { client?.release(); }
  }

  async loadVersions(read) {
    return this.#transaction(read, async (records) => ({ value: snapshotVersions(records.map(({ seed }) => {
      const value = structuredClone(seed);
      for (const table of Object.keys(POLICY_TABLES)) for (const row of value[table]) delete row.runId;
      return value;
    })) }));
  }

  async publish(read, build) {
    try {
      return await this.#transaction(read, async (records) => {
        const clean = structuredClone(records);
        for (const record of clean) for (const table of Object.keys(POLICY_TABLES)) for (const row of record.seed[table]) delete row.runId;
        return build(clean);
      });
    } catch { return policyUnavailable(); }
  }

  async close() {
    try {
      if (this.#owned) { await this.#pool.end(); this.#pool = undefined; this.#owned = false; }
      this.#startup = undefined;
      return policyOutcome('ok', null, { value: { closed: true } });
    } catch { return policyUnavailable(); }
  }
}
