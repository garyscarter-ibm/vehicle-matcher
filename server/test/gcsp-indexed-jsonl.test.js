import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { indexJsonl } from '../gcsp/vehicle-evidence/indexed-jsonl.js';

async function fixture(t, content) {
  const root = await mkdtemp(join(tmpdir(), 'indexed-jsonl-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'rows.jsonl'); await writeFile(path, content); return path;
}
test('streamed JSONL indexes exact byte ranges across UTF-8 and chunk boundaries', async (t) => {
  const rows = [{ id: 'first', label: 'é🚗' }, { id: 'second', label: 'λ' }];
  const lines = rows.map((row) => JSON.stringify(row) + '\n'); const content = lines.join('');
  const path = await fixture(t, content); const observed = [];
  const indexed = await indexJsonl(path, { key: (row) => row.id, chunkBytes: 7,
    onRow: (row, entry) => observed.push([row.id, entry.offset, entry.length]) });
  assert.equal(indexed.checksum, createHash('sha256').update(content).digest('hex'));
  assert.equal(indexed.length, 2); assert.deepEqual([...indexed], rows);
  assert.deepEqual(observed, [['first', 0, Buffer.byteLength(lines[0])],
    ['second', Buffer.byteLength(lines[0]), Buffer.byteLength(lines[1])]]);
  assert.deepEqual(indexed.get('second'), rows[1]); assert.equal(indexed.get('absent'), undefined);
  assert.equal(indexed.metadata('first').digest, createHash('sha256').update(lines[0]).digest('hex'));
  const detached = indexed.get('first'); detached.label = 'changed';
  assert.equal(indexed.get('first').label, 'é🚗'); assert.equal(Object.isFrozen(indexed), true);
});
test('empty JSONL is valid and retains the empty-byte checksum', async (t) => {
  const indexed = await indexJsonl(await fixture(t, ''));
  assert.equal(indexed.length, 0); assert.deepEqual([...indexed], []);
  assert.equal(indexed.checksum, createHash('sha256').update('').digest('hex'));
});
test('stream limits and complete object records fail with explicit boundary codes', async (t) => {
  for (const [content, options, code] of [
    ['{"id":1}', {}, 'truncated-jsonl'], ['broken\n', {}, 'malformed-jsonl'],
    ['[]\n', {}, 'artifact-schema'], ['\n', {}, 'malformed-jsonl'],
    ['{"id":1}\n', { maxBytes: 2 }, 'artifact-size'],
    ['{"id":1}\n', { maxRowBytes: 4, chunkBytes: 2 }, 'artifact-row-size'],
    ['{}\n{}\n', { maxRows: 1 }, 'artifact-row-count'],
    [Buffer.from([123, 34, 97, 34, 58, 34, 255, 34, 125, 10]), {}, 'malformed-jsonl'],
  ]) await assert.rejects(indexJsonl(await fixture(t, content), options), { code });
});
test('indexed reads reject changed bytes, replacement files and removal', async (t) => {
  const path = await fixture(t, '{"id":"a","value":1}\n');
  let indexed = await indexJsonl(path, { key: (row) => row.id });
  await writeFile(path, '{"id":"a","value":2}\n');
  assert.throws(() => indexed.get('a'), { code: 'artifact-changed' });
  indexed = await indexJsonl(path, { key: (row) => row.id });
  const replacement = path + '.new'; await writeFile(replacement, '{"id":"a","value":2}\n');
  await rename(replacement, path); assert.throws(() => indexed.get('a'), { code: 'artifact-changed' });
  await rm(path); assert.throws(() => indexed.get('a'), { code: 'artifact-changed' });
});
test('a file modified during its scan is never returned as a complete index', async (t) => {
  const path = await fixture(t, '{"id":"a"}\n{"id":"b"}\n'); let changed = false;
  await assert.rejects(indexJsonl(path, { chunkBytes: 11, onRow: async () => {
    if (!changed) { changed = true; await writeFile(path, '{"id":"z"}\n{"id":"b"}\n'); }
  } }), { code: 'artifact-changed' });
});
