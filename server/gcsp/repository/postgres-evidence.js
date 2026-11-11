import { inputDigest } from './core.js';

// Private persistence representation. Public/domain snapshots are always expanded.
const marker = '__gcspEvidence';
const fields = ['configurationEvidence', 'optionSelection', 'options', 'colour', 'interior', 'gearbox'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const snapshot = (value) => object(value) && value.contractVersion === 'vehicle-snapshot-v1' && object(value.facts);
const digestPattern = /^[a-f0-9]{64}$/;

/** Extract shared configuration facts, retaining each car's identity and operational facts inline. */
export function packEvidence(row) {
  const snapshots = new Map();
  const references = new Set();
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!object(value)) return value;
    if (snapshot(value) && Object.hasOwn(value, marker)) throw new Error('reserved-evidence-marker');
    if (snapshot(value) && Object.hasOwn(value.facts, 'configurationEvidence')) {
      const evidence = Object.fromEntries(fields.filter((field) => Object.hasOwn(value.facts, field)).map((field) => [field, value.facts[field]]));
      const digest = inputDigest(evidence);
      snapshots.set(digest, evidence); references.add(digest);
      return { ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'facts').map(([key, item]) => [key, visit(item)])),
        facts: Object.fromEntries(Object.entries(value.facts).filter(([key]) => !fields.includes(key)).map(([key, item]) => [key, visit(item)])),
        [marker]: digest };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
  }
  return { data: visit(row), snapshots, references };
}

export function evidenceReferences(row) {
  const references = new Set();
  function visit(value) {
    if (!object(value) && !Array.isArray(value)) return;
    if (snapshot(value) && Object.hasOwn(value, marker)) {
      if (!digestPattern.test(value[marker]) || fields.some((field) => Object.hasOwn(value.facts, field))) {
        throw new Error('invalid-evidence-reference');
      }
      references.add(value[marker]);
    }
    for (const item of Object.values(value)) visit(item);
  }
  visit(row); return references;
}

export function verifyEvidence(digest, data) {
  if (!digestPattern.test(digest) || !object(data) || !Object.hasOwn(data, 'configurationEvidence')
    || Object.keys(data).some((key) => !fields.includes(key)) || inputDigest(data) !== digest) throw new Error('invalid-evidence-snapshot');
  return data;
}

/** Hydrate only references found in these selected rows; preserve inline legacy data. */
export function unpackEvidence(row, snapshots) {
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!object(value)) return value;
    if (snapshot(value) && Object.hasOwn(value, marker)) {
      const evidence = snapshots.get(value[marker]);
      if (!evidence) throw new Error('missing-evidence-snapshot');
      return { ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== marker).map(([key, item]) => [key, visit(item)])),
        facts: { ...visit(value.facts), ...evidence } };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
  }
  return visit(row);
}

export const DEFAULT_BATCH_BYTES = 512 * 1024;
/** A single oversized row travels alone; no evidence is truncated. */
export function* jsonBatches(rows, maxBytes = DEFAULT_BATCH_BYTES, maxRows = 500) {
  let batch = []; let bytes = 2;
  for (const row of rows) {
    const json = JSON.stringify(row); const size = Buffer.byteLength(json);
    if (batch.length && (batch.length >= maxRows || bytes + 1 + size > maxBytes)) {
      yield `[${batch.join(',')}]`; batch = []; bytes = 2;
    }
    bytes += size + (batch.length ? 1 : 0); batch.push(json);
  }
  if (batch.length) yield `[${batch.join(',')}]`;
}

export async function writeEvidenceSnapshots(client, tableName, snapshots) {
  for (const [digest, data] of snapshots) {
    const inserted = await client.query(`INSERT INTO ${tableName('vehicle_evidence_snapshots')} (digest, data) VALUES ($1, $2::jsonb) ON CONFLICT (digest) DO NOTHING`,
      [digest, JSON.stringify(data)]);
    if (!inserted.rowCount) {
      const existing = await client.query(`SELECT data FROM ${tableName('vehicle_evidence_snapshots')} WHERE digest = $1 FOR KEY SHARE`, [digest]);
      verifyEvidence(digest, existing.rows[0]?.data);
    }
  }
}

export async function replaceEvidenceReferences(client, tableName, references, maxBytes = DEFAULT_BATCH_BYTES) {
  for (const [table, owners] of references) {
    for (const json of jsonBatches(owners.map((owner) => owner.key), maxBytes)) {
      await client.query(`DELETE FROM ${tableName('vehicle_evidence_references')} WHERE table_name = $1 AND row_key IN (SELECT jsonb_array_elements_text($2::jsonb))`, [table, json]);
    }
    for (const json of jsonBatches(owners.flatMap((owner) => owner.digests.map((digest) => ({ key: owner.key, digest }))), maxBytes)) {
      await client.query(`INSERT INTO ${tableName('vehicle_evidence_references')} (table_name, row_key, digest)
        SELECT $1, value->>'key', value->>'digest' FROM jsonb_array_elements($2::jsonb)`, [table, json]);
    }
  }
}
