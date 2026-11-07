import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';

export const JSONL_MAX_BYTES = 64 * 1024 * 1024;
export class JsonlError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new JsonlError(code, message); };
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (info) => Object.freeze(Object.fromEntries(
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [key, String(info[key])])));
const sameIdentity = (left, right) => Object.keys(left).every((key) => left[key] === right[key]);
function parse(bytes, label) {
  let row;
  try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('malformed-jsonl', `${label} is not a complete UTF-8 JSON object.`); }
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('artifact-schema', `${label} must contain an object.`);
  return row;
}

/** Read one detached record. No descriptors or full envelopes remain cached. */
export function readIndexedRow(path, expectedIdentity, entry) {
  let fd;
  try {
    fd = openSync(path, 'r');
    if (!sameIdentity(identity(fstatSync(fd, { bigint: true })), expectedIdentity)) fail('artifact-changed', 'Indexed artifact identity changed.');
    const bytes = Buffer.alloc(entry.length); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, entry.offset + offset);
      if (!count) fail('artifact-changed', 'Indexed artifact became incomplete.');
      offset += count;
    }
    if (sha(bytes) !== entry.digest || !sameIdentity(identity(fstatSync(fd, { bigint: true })), expectedIdentity)) {
      fail('artifact-changed', 'Indexed record bytes changed.');
    }
    return parse(bytes, 'Indexed record');
  } catch (error) {
    if (error instanceof JsonlError) throw error;
    throw new JsonlError('artifact-changed', 'Indexed artifact is no longer accessible.');
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Stream the existing JSONL format and retain only byte positions and compact metadata. */
export async function indexJsonl(path, { maxBytes = JSONL_MAX_BYTES, maxRowBytes = 1024 * 1024,
  maxRows = 100000, chunkBytes = 64 * 1024, key = (_row, i) => i, metadata = () => ({}), onRow } = {}) {
  if (![maxBytes, maxRowBytes, maxRows, chunkBytes].every((value) => Number.isSafeInteger(value) && value > 0)
    || chunkBytes > 1024 * 1024) throw new TypeError('Supply positive bounded JSONL limits.');
  const file = await open(path, 'r');
  try {
    const initial = await file.stat({ bigint: true });
    if (!initial.isFile() || initial.size > BigInt(maxBytes)) fail('artifact-size', 'Artifact exceeds the bounded streaming file limit.');
    const expectedIdentity = identity(initial); const hash = createHash('sha256');
    const entries = []; const byKey = new Map(); const buffer = Buffer.alloc(chunkBytes);
    let pending = Buffer.alloc(0); let consumed = 0; let total = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) fail('artifact-size', 'Artifact exceeds the bounded streaming file limit.');
      hash.update(buffer.subarray(0, bytesRead));
      const bytes = pending.length ? Buffer.concat([pending, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      let start = 0; let end;
      while ((end = bytes.indexOf(10, start)) !== -1) {
        const line = bytes.subarray(start, end + 1);
        if (line.length > maxRowBytes) fail('artifact-row-size', 'JSONL record exceeds its bounded row limit.');
        if (entries.length >= maxRows) fail('artifact-row-count', 'JSONL record count exceeds its bounded limit.');
        const row = parse(line, `JSONL:${entries.length + 1}`);
        const entry = Object.freeze({ ...metadata(row), key: key(row, entries.length), offset: consumed,
          length: line.length, digest: sha(line) });
        if (onRow) await onRow(row, entry);
        entries.push(entry); byKey.set(entry.key, entry); consumed += line.length; start = end + 1;
      }
      pending = Buffer.from(bytes.subarray(start));
      if (pending.length > maxRowBytes) fail('artifact-row-size', 'JSONL record exceeds its bounded row limit.');
    }
    if (!sameIdentity(expectedIdentity, identity(await file.stat({ bigint: true })))) fail('artifact-changed', 'Artifact changed during indexing.');
    if (pending.length) fail('truncated-jsonl', 'JSONL must end with a newline; interrupted records cannot activate.');
    const read = (entry) => entry ? readIndexedRow(path, expectedIdentity, entry) : undefined;
    return Object.freeze({ length: entries.length, checksum: hash.digest('hex'), identity: expectedIdentity,
      get: (id) => read(byKey.get(id)), metadata: (id) => byKey.get(id),
      *metadataEntries() { yield* entries; },
      *[Symbol.iterator]() { for (const entry of entries) yield read(entry); } });
  } finally { await file.close(); }
}
