import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chmod, mkdtemp, writeFile, rm, rename, stat, utimes } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
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
// FUCQ-153: each remaining guard has a regression that fails if that guard alone is removed.
function patchFs(name, replacement) {
  const original = fs[name]; fs[name] = replacement(original); syncBuiltinESMExports();
  return () => { fs[name] = original; syncBuiltinESMExports(); };
}
test('metadata confirmation rejects modification-time movement during its whole-file hash', async (t) => {
  const path = await fixture(t, '{"id":"a"}\n{"id":"b"}\n'); await chmod(path, 0o600);
  let injected = false;
  const restore = patchFs('readSync', (original) => function (fd, buffer, ...args) {
    if (!injected && buffer.length === 64 * 1024) { fs.futimesSync(fd, 1700000000, 1700000000); injected = true; }
    return original.call(this, fd, buffer, ...args);
  });
  try {
    await assert.rejects(indexJsonl(path, { onRow: async (_row, entry) => {
      if (entry.key === 0) await chmod(path, 0o640);
    } }), { code: 'artifact-changed' });
    assert.ok(injected);
  } finally { restore(); }
});
test('metadata confirmation rejects a rewrite between its first and latest stat', async (t) => {
  const content = '{"id":"a","value":1}\n'; const path = await fixture(t, content);
  await utimes(path, 1700000000, 1700000000); await chmod(path, 0o600);
  const indexed = await indexJsonl(path, { key: (row) => row.id }); const target = await stat(path, { bigint: true });
  await chmod(path, 0o640); let calls = 0;
  const restore = patchFs('fstatSync', (original) => function (fd, ...args) {
    const info = original.call(this, fd, ...args);
    if (String(info.ino) !== String(target.ino) || ++calls !== 2) return info;
    fs.writeFileSync(path, content); return original.call(this, fd, ...args);
  });
  try { assert.throws(() => indexed.get('a'), { code: 'artifact-changed' }); assert.equal(calls >= 2, true); }
  finally { restore(); }
});
test('per-row digests reject corrupted record bytes even when file identity is unchanged', async (t) => {
  const path = await fixture(t, '{"id":"a","value":1}\n{"id":"b","value":2}\n');
  const indexed = await indexJsonl(path, { key: (row) => row.id }); let corrupted = false;
  const restore = patchFs('readSync', (original) => function (fd, buffer, offset, ...args) {
    const count = original.call(this, fd, buffer, offset, ...args);
    if (!corrupted && count) { buffer[offset + count - 3] ^= 1; corrupted = true; }
    return count;
  });
  try { assert.throws(() => indexed.get('b'), { code: 'artifact-changed' }); assert.ok(corrupted); }
  finally { restore(); }
  assert.deepEqual(indexed.get('b'), { id: 'b', value: 2 });
});
// FUCQ-164: failures keep a bounded, path-free reason alongside the unchanged code and message.
test('a damaged indexed row reports its file, check, offset and 1-based record', async (t) => {
  const first = '{"id":"a","value":1}\n';
  const path = await fixture(t, first + '{"id":"b","value":2}\n');
  const indexed = await indexJsonl(path, { key: (row) => row.id }); let corrupted = false;
  const restore = patchFs('readSync', (original) => function (fd, buffer, offset, ...args) {
    const count = original.call(this, fd, buffer, offset, ...args);
    if (!corrupted && count) { buffer[offset + count - 3] ^= 1; corrupted = true; }
    return count;
  });
  try {
    assert.throws(() => indexed.get('b'), (error) => error.code === 'artifact-changed'
      && error.message === 'Indexed record bytes changed.'
      && JSON.stringify(error.detail) === JSON.stringify({ file: 'rows.jsonl', check: 'row-digest', offset: Buffer.byteLength(first), record: 2 }));
  } finally { restore(); }
});
test('indexing and changed-file failures name the check without a path', async (t) => {
  await assert.rejects(indexJsonl(await fixture(t, '{"id":1}\nbroken\n')), (error) => error.code === 'malformed-jsonl'
    && JSON.stringify(error.detail) === JSON.stringify({ file: 'rows.jsonl', check: 'parse', record: 2, offset: 9 }));
  const path = await fixture(t, '{"id":"a","value":1}\n');
  const indexed = await indexJsonl(path, { key: (row) => row.id });
  await writeFile(path, '{"id":"a","value":10}\n');
  assert.throws(() => indexed.get('a'), (error) => error.code === 'artifact-changed' && error.detail.check === 'confirm-identity'
    && error.detail.file === 'rows.jsonl' && error.detail.changedFields.includes('size') && !error.detail.changedFields.includes('ctimeNs')
    && error.detail.record === 1 && !JSON.stringify(error.detail).includes(tmpdir()));
  await rm(path);
  assert.throws(() => indexed.get('a'), (error) => error.detail.check === 'inaccessible' && error.detail.errno === 'ENOENT' && error.detail.record === 1);
});
test('a file URL source indexes and names its file in failure detail', async (t) => {
  const url = pathToFileURL(await fixture(t, '{"id":"a"}\nbroken\n'));
  await assert.rejects(indexJsonl(url), (error) => error.detail.file === 'rows.jsonl' && error.detail.record === 2);
});
// FUCQ-164: a file provider can update ctime several times in a burst while the bytes stay exact.
const BURST_ROWS = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }];
const burstContent = BURST_ROWS.map((row) => JSON.stringify(row) + '\n').join('');
// Flip the mode (ctime only) just before each selected fstat of this file, then return the real stat.
function churnCtime(path, shouldChurn, extra = () => {}) {
  const target = fs.statSync(path, { bigint: true }); let calls = 0; let on = false;
  const restore = patchFs('fstatSync', (original) => function (fd, ...args) {
    const info = original.call(this, fd, ...args);
    if (info.ino !== target.ino || info.dev !== target.dev || !shouldChurn(++calls)) return info;
    extra(calls); fs.fchmodSync(fd, on ? 0o600 : 0o644); on = !on; return original.call(this, fd, ...args);
  });
  return { restore, calls: () => calls };
}
async function burstFixture(t, mtime) {
  const path = await fixture(t, burstContent); await chmod(path, 0o600); if (mtime) await utimes(path, mtime, mtime);
  const indexed = await indexJsonl(path, { key: (row) => row.id }); return { path, indexed };
}
test('a burst of ctime-only updates during confirmation is accepted and every row reads exact bytes', async (t) => {
  const { path, indexed } = await burstFixture(t); const before = indexed.identity.ctimeNs;
  await chmod(path, 0o644); const churn = churnCtime(path, (call) => call >= 2 && call <= 4);
  try { assert.deepEqual([...indexed], BURST_ROWS); assert.equal(churn.calls() >= 5, true); } finally { churn.restore(); }
  assert.notEqual(indexed.identity.ctimeNs, before); assert.deepEqual(indexed.get('b'), BURST_ROWS[1]);
});
test('a ctime-only update between the row read and the post-read check is accepted', async (t) => {
  const { path, indexed } = await burstFixture(t); const before = indexed.identity.ctimeNs;
  const churn = churnCtime(path, (call) => call === 2);
  try { assert.deepEqual(indexed.get('b'), BURST_ROWS[1]); } finally { churn.restore(); }
  assert.notEqual(indexed.identity.ctimeNs, before); assert.deepEqual([...indexed], BURST_ROWS);
});
test('a ctime burst during end-of-stream confirmation keeps one coherent byte snapshot', async (t) => {
  const path = await fixture(t, burstContent); await chmod(path, 0o600); let churn;
  try {
    const indexed = await indexJsonl(path, { key: (row) => row.id, chunkBytes: 11, onRow: async (_row, entry) => {
      if (entry.key === 'a') { await chmod(path, 0o644); churn = churnCtime(path, (call) => call <= 3); }
    } });
    assert.deepEqual([...indexed], BURST_ROWS);
  } finally { churn?.restore(); }
});
test('ctime that never settles fails closed as unstable after a fixed number of attempts', async (t) => {
  const { path, indexed } = await burstFixture(t); await chmod(path, 0o644);
  const churn = churnCtime(path, () => true);
  try {
    assert.throws(() => indexed.get('a'), (error) => error.code === 'artifact-changed' && error.detail.check === 'confirm-unstable'
      && error.detail.attempts === 4 && error.detail.record === 1);
  } finally { churn.restore(); }
});
test('real changes still fail closed during or after a ctime burst', async (t) => {
  let { path, indexed } = await burstFixture(t);
  await utimes(path, 1700000000, 1700000000);
  assert.throws(() => indexed.get('a'), (error) => error.code === 'artifact-changed' && error.detail.check === 'confirm-identity'
    && error.detail.changedFields.join() === 'mtimeNs');
  ({ path, indexed } = await burstFixture(t, 1700000000));
  await writeFile(path, burstContent.replace('"value":2', '"value":9')); await utimes(path, 1700000000, 1700000000);
  const bytes = churnCtime(path, (call) => call <= 2);
  try { assert.throws(() => indexed.get('a'), (error) => error.detail.check === 'confirm-bytes'); } finally { bytes.restore(); }
  ({ path, indexed } = await burstFixture(t));
  await writeFile(path + '.new', burstContent); await rename(path + '.new', path);
  assert.throws(() => indexed.get('a'), (error) => error.detail.check === 'confirm-identity' && error.detail.changedFields.includes('ino'));
  ({ path, indexed } = await burstFixture(t)); await chmod(path, 0o644);
  const mtime = churnCtime(path, (call) => call <= 3, (call) => { if (call === 3) fs.utimesSync(path, 1700000000, 1700000000); });
  try {
    assert.throws(() => indexed.get('a'), (error) => error.code === 'artifact-changed' && error.detail.check === 'confirm-identity'
      && error.detail.changedFields.includes('mtimeNs'));
  } finally { mtime.restore(); }
});
