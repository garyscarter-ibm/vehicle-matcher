import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chmod, mkdtemp, writeFile, rm, rename, stat, utimes } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
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
test('metadata-only changes preserve indexed rows after complete byte verification', async (t) => {
  const path = await fixture(t, '{"id":"a","value":1}\n{"id":"b","value":2}\n');
  await chmod(path, 0o600);
  const indexed = await indexJsonl(path, { key: (row) => row.id });
  const before = await stat(path, { bigint: true }); await chmod(path, 0o640);
  const after = await stat(path, { bigint: true });
  assert.equal(after.mtimeNs, before.mtimeNs); assert.notEqual(after.ctimeNs, before.ctimeNs);
  assert.deepEqual(indexed.get('a'), { id: 'a', value: 1 });
  assert.deepEqual([...indexed], [{ id: 'a', value: 1 }, { id: 'b', value: 2 }]);
});
test('metadata-only movement during indexing preserves one coherent byte snapshot', async (t) => {
  const path = await fixture(t, '{"id":"a"}\n{"id":"b"}\n'); await chmod(path, 0o600);
  let changed = false;
  const indexed = await indexJsonl(path, { key: (row) => row.id, chunkBytes: 11, onRow: async () => {
    if (!changed) { changed = true; await chmod(path, 0o640); }
  } });
  assert.deepEqual([...indexed], [{ id: 'a' }, { id: 'b' }]);
});
test('ctime-only movement before confirmation hashes one stable current byte snapshot', async (t) => {
  const path = await fixture(t, '{"id":"a","value":1}\n{"id":"b","value":2}\n'); await chmod(path, 0o600);
  const indexed = await indexJsonl(path, { key: (row) => row.id }); const target = await stat(path, { bigint: true });
  await chmod(path, 0o640);
  const original = fs.fstatSync; let calls = 0; let injected = false;
  fs.fstatSync = function (fd, ...args) {
    let info = original.call(this, fd, ...args);
    if (String(info.dev) === String(target.dev) && String(info.ino) === String(target.ino) && ++calls === 2) {
      fs.fchmodSync(fd, 0o600); injected = true; info = original.call(this, fd, ...args);
    }
    return info;
  };
  syncBuiltinESMExports();
  try { assert.deepEqual(indexed.get('a'), { id: 'a', value: 1 }); assert.ok(injected); }
  finally { fs.fstatSync = original; syncBuiltinESMExports(); }
  assert.deepEqual(indexed.get('b'), { id: 'b', value: 2 });
});
test('a changed unrequested row cannot hide behind restored modification time', async (t) => {
  const path = await fixture(t, '{"id":"a","value":1}\n{"id":"b","value":2}\n');
  await utimes(path, 1700000000, 1700000000);
  const indexed = await indexJsonl(path, { key: (row) => row.id });
  await writeFile(path, '{"id":"a","value":1}\n{"id":"b","value":3}\n');
  await utimes(path, 1700000000, 1700000000);
  assert.throws(() => indexed.get('a'), { code: 'artifact-changed' });
});
test('bytes changed during a scan still fail when their modification time is restored', async (t) => {
  const path = await fixture(t, '{"id":"a"}\n{"id":"b"}\n');
  await utimes(path, 1700000000, 1700000000);
  await assert.rejects(indexJsonl(path, { chunkBytes: 11, onRow: async (_row, entry) => {
    if (entry.key === 1) {
      await writeFile(path, '{"id":"z"}\n{"id":"b"}\n');
      await utimes(path, 1700000000, 1700000000);
    }
  } }), { code: 'artifact-changed' });
});
