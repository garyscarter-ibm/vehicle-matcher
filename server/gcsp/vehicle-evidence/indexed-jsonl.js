import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';

export const JSONL_MAX_BYTES = 64 * 1024 * 1024;
export class JsonlError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; if (detail) this.detail = detail; }
}
const fail = (code, message, detail) => { throw new JsonlError(code, message, detail); };
const nameOf = (path) => basename(path instanceof URL ? path.pathname : String(path));
const where = (path, check, extra = {}) => ({ file: nameOf(path), check, ...extra });
const errnoOf = (error) => typeof error?.code === 'string' && /^E[A-Z0-9]+$/.test(error.code) ? error.code : undefined;
const differing = (left, right, skip) => Object.keys(left).filter((key) => key !== skip && left[key] !== right[key]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = (info) => Object.freeze(Object.fromEntries(
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [key, String(info[key])])));
const sameIdentity = (left, right) => Object.keys(left).every((key) => left[key] === right[key]);
const CONFIRM_ATTEMPTS = 4;
function confirmMetadataChange(fd, expected, current, checksum, file) {
  // File providers write metadata in bursts. Accept only ctime movement, and only around a full re-hash.
  const now = () => identity(fstatSync(fd, { bigint: true })); const buffer = Buffer.alloc(64 * 1024);
  let latest = now();
  const moved = [...new Set([current, latest].flatMap((value) => differing(expected, value, 'ctimeNs')))];
  if (!checksum || moved.length) fail('artifact-changed', 'Indexed artifact identity changed.', { file, check: 'confirm-identity', changedFields: moved });
  for (let attempt = 1; attempt <= CONFIRM_ATTEMPTS; attempt++) {
    const hash = createHash('sha256'); let position = 0;
    while (position < Number(latest.size)) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(latest.size) - position), position);
      if (!count) fail('artifact-changed', 'Indexed artifact became incomplete.', { file, check: 'confirm-incomplete', offset: position });
      hash.update(buffer.subarray(0, count)); position += count;
    }
    if (hash.digest('hex') !== checksum) fail('artifact-changed', 'Indexed artifact bytes or identity changed.', { file, check: 'confirm-bytes', attempts: attempt });
    const after = now();
    if (sameIdentity(latest, after)) return latest;
    const changedFields = differing(latest, after, 'ctimeNs');
    if (changedFields.length) fail('artifact-changed', 'Indexed artifact bytes or identity changed.', { file, check: 'confirm-identity', changedFields, attempts: attempt });
    latest = after;
  }
  fail('artifact-changed', 'Indexed artifact bytes or identity changed.', { file, check: 'confirm-unstable', attempts: CONFIRM_ATTEMPTS });
}
function parse(bytes, label, detail) {
  let row;
  try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('malformed-jsonl', `${label} is not a complete UTF-8 JSON object.`, detail()); }
  if (!row || typeof row !== 'object' || Array.isArray(row)) fail('artifact-schema', `${label} must contain an object.`, detail());
  return row;
}

/** Read one detached record. No descriptors or full envelopes remain cached. */
export function readIndexedRow(path, expectedIdentity, entry, integrity) {
  let fd; const file = nameOf(path);
  try {
    fd = openSync(path, 'r');
    const current = identity(fstatSync(fd, { bigint: true }));
    if (!sameIdentity(current, expectedIdentity)) {
      expectedIdentity = confirmMetadataChange(fd, expectedIdentity, current, integrity?.checksum, file);
      integrity.identity = expectedIdentity;
    }
    const bytes = Buffer.alloc(entry.length); let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, entry.offset + offset);
      if (!count) fail('artifact-changed', 'Indexed artifact became incomplete.', { file, check: 'row-incomplete', offset: entry.offset + offset });
      offset += count;
    }
    if (sha(bytes) !== entry.digest) fail('artifact-changed', 'Indexed record bytes changed.', { file, check: 'row-digest', offset: entry.offset });
    const after = identity(fstatSync(fd, { bigint: true }));
    if (!sameIdentity(after, expectedIdentity)) {
      const changedFields = differing(expectedIdentity, after, 'ctimeNs');
      if (changedFields.length) fail('artifact-changed', 'Indexed record bytes changed.', { file, check: 'post-read-identity', offset: entry.offset, changedFields });
      integrity.identity = confirmMetadataChange(fd, expectedIdentity, after, integrity.checksum, file);
    }
    return parse(bytes, 'Indexed record', () => ({ file, check: 'parse', offset: entry.offset }));
  } catch (error) {
    if (error instanceof JsonlError) throw error;
    const errno = errnoOf(error);
    throw new JsonlError('artifact-changed', 'Indexed artifact is no longer accessible.', { file, check: 'inaccessible', ...(errno ? { errno } : {}) });
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Stream the existing JSONL format and retain only byte positions and compact metadata. */
export async function indexJsonl(path, { maxBytes = JSONL_MAX_BYTES, maxRowBytes = 1024 * 1024,
  maxRows = 100000, chunkBytes = 64 * 1024, key = (_row, i) => i, metadata = () => ({}), onRow } = {}) {
  if (![maxBytes, maxRowBytes, maxRows, chunkBytes].every((value) => Number.isSafeInteger(value) && value > 0)
    || chunkBytes > 1024 * 1024) throw new TypeError('Supply positive bounded JSONL limits.');
  const file = await open(path, 'r'); const name = nameOf(path);
  try {
    const initial = await file.stat({ bigint: true });
    if (!initial.isFile() || initial.size > BigInt(maxBytes)) fail('artifact-size', 'Artifact exceeds the bounded streaming file limit.', where(path, 'size'));
    let expectedIdentity = identity(initial); const hash = createHash('sha256');
    const entries = []; const byKey = new Map(); const buffer = Buffer.alloc(chunkBytes);
    let pending = Buffer.alloc(0); let consumed = 0; let total = 0;
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      total += bytesRead;
      if (total > maxBytes) fail('artifact-size', 'Artifact exceeds the bounded streaming file limit.', where(path, 'size', { offset: total }));
      hash.update(buffer.subarray(0, bytesRead));
      const bytes = pending.length ? Buffer.concat([pending, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      let start = 0; let end;
      while ((end = bytes.indexOf(10, start)) !== -1) {
        const line = bytes.subarray(start, end + 1);
        const at = (check) => where(path, check, { record: entries.length + 1, offset: consumed });
        if (line.length > maxRowBytes) fail('artifact-row-size', 'JSONL record exceeds its bounded row limit.', at('row-size'));
        if (entries.length >= maxRows) fail('artifact-row-count', 'JSONL record count exceeds its bounded limit.', at('row-count'));
        const row = parse(line, `JSONL:${entries.length + 1}`, () => at('parse'));
        const entry = Object.freeze({ ...metadata(row), key: key(row, entries.length), offset: consumed,
          length: line.length, digest: sha(line) });
        if (onRow) await onRow(row, entry);
        entries.push(entry); byKey.set(entry.key, entry); consumed += line.length; start = end + 1;
      }
      pending = Buffer.from(bytes.subarray(start));
      if (pending.length > maxRowBytes) fail('artifact-row-size', 'JSONL record exceeds its bounded row limit.', where(path, 'row-size', { record: entries.length + 1, offset: consumed }));
    }
    const checksum = hash.digest('hex'); const current = identity(await file.stat({ bigint: true }));
    if (!sameIdentity(expectedIdentity, current)) expectedIdentity = confirmMetadataChange(file.fd, expectedIdentity, current, checksum, name);
    if (pending.length) fail('truncated-jsonl', 'JSONL must end with a newline; interrupted records cannot activate.', where(path, 'truncated', { record: entries.length + 1, offset: consumed }));
    const integrity = { identity: expectedIdentity, checksum };
    const read = (entry) => {
      if (!entry) return undefined;
      try { return readIndexedRow(path, integrity.identity, entry, integrity); }
      catch (error) { if (error instanceof JsonlError && error.detail) error.detail = { ...error.detail, record: entries.indexOf(entry) + 1 }; throw error; }
    };
    return Object.freeze({ length: entries.length, checksum, get identity() { return integrity.identity; },
      get: (id) => read(byKey.get(id)), metadata: (id) => byKey.get(id),
      *metadataEntries() { yield* entries; },
      *[Symbol.iterator]() { for (const entry of entries) yield read(entry); } });
  } finally { await file.close(); }
}
