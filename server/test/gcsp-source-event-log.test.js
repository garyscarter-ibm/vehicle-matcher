import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, appendFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createSourceEventLog, exportSourceEventLog, readSourceEventHistory } from '../../scripts/gcsp/source-event-log.mjs';

const encode = (row) => `${JSON.stringify(row)}\n`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const at = (n) => new Date(Date.UTC(2026, 10, 7, 12, 0, n)).toISOString();
const request = (n) => ({ attempt: n, method: 'GET', url: `https://example.test/a/${n}`, startedAt: at(n * 10) });
const started = (n) => ({ ...request(n), phase: 'started' });
const headers = (n, status = 200) => ({ ...request(n), phase: 'headers-received', status, at: at(n * 10 + 1) });
const refused = (n) => ({ ...request(n), phase: 'transport-refused', code: 'ECONNRESET', at: at(n * 10 + 1) });
const rowsFor = (attempts) => Array.from({ length: attempts }, (_, i) => [started(i + 1), i === 1 ? refused(i + 1) : headers(i + 1)]).flat();

async function setup(t, attempts = 3) {
  const root = await mkdtemp(join(tmpdir(), 'gc015-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const work = join(root, 'work'); const dest = join(root, 'dest');
  await mkdir(work); await mkdir(dest);
  const paths = { root, dest, workingPath: join(work, 'events.working.jsonl'), path: join(dest, 'source-events.jsonl') };
  const log = await createSourceEventLog({ path: paths.path, workingPath: paths.workingPath, attempts });
  t.after(() => log.abandon().catch(() => {}));
  return { ...paths, log, attempts, copy: join(dest, 'source-events.jsonl 2.jsonl') };
}
const code = (expected) => (error) => { assert.equal(error.code, expected, error.message); return true; };

test('reproduction: per-row appendFile into a cloud-resolved canonical file loses a row', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gc015-')); t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source-events.jsonl'); const copy = join(root, 'source-events.jsonl 2.jsonl');
  const rows = rowsFor(3);
  for (const row of rows.slice(0, 4)) await appendFile(path, encode(row), { mode: 0o600 });
  const older = await readFile(path);
  await appendFile(path, encode(rows[4]), { mode: 0o600 });
  await rename(path, copy); await writeFile(path, older);
  await appendFile(path, encode(rows[5]), { mode: 0o600 });
  const copyBytes = await readFile(copy);
  await assert.rejects(readSourceEventHistory(path, { attempts: 3 }), code('source-event-conflict-copy-present'));
  const alone = join(root, 'alone'); await mkdir(alone);
  await writeFile(join(alone, 'source-events.jsonl'), await readFile(path));
  await assert.rejects(readSourceEventHistory(join(alone, 'source-events.jsonl'), { attempts: 3 }), code('source-event-contradiction'));
  assert.deepEqual(await readFile(copy), copyBytes);
  assert.equal(copyBytes.toString().trim().split('\n').length, 5);
});

test('working log keeps the complete history when the retained folder is churned by a sync conflict', async (t) => {
  const s = await setup(t); const rows = rowsFor(3);
  for (const row of rows.slice(0, 4)) await s.log.append(row);
  await writeFile(s.path, encode(rows[0]));
  await rename(s.path, s.copy); await writeFile(s.path, encode(rows[0]) + encode(rows[1]));
  for (const row of rows.slice(4)) await s.log.append(row);
  await rm(s.path); await rm(s.copy);
  const result = await s.log.close();
  const expected = rows.map(encode).join('');
  assert.deepEqual([result.rows, result.bytes, result.sha256, result.attemptsComplete], [6, Buffer.byteLength(expected), sha(expected), 3]);
  assert.equal(await readFile(s.path, 'utf8'), expected);
  const history = await readSourceEventHistory(s.path, { attempts: 3, expected: { sha256: sha(expected), bytes: Buffer.byteLength(expected), rows: 6 } });
  assert.deepEqual(history.events, rows);
  await assert.rejects(stat(s.workingPath), { code: 'ENOENT' });
});

test('replaced working log is detected and both files are preserved', async (t) => {
  const s = await setup(t); const rows = rowsFor(3);
  await s.log.append(rows[0]); await s.log.append(rows[1]); await s.log.append(rows[2]);
  const aside = `${s.workingPath}.aside`; const older = encode(rows[0]) + encode(rows[1]);
  await rename(s.workingPath, aside); await writeFile(s.workingPath, older);
  const asideBytes = await readFile(aside);
  await assert.rejects(s.log.append(rows[3]), code('source-event-working-log-replaced'));
  assert.deepEqual(await readFile(aside), asideBytes);
  assert.equal(await readFile(s.workingPath, 'utf8'), older);
  await assert.rejects(s.log.close(), code('source-event-working-log-replaced'));
  await assert.rejects(stat(s.path), { code: 'ENOENT' });
});

test('contradictory rows are rejected and nothing is written', async (t) => {
  const cases = [
    ['a different url', [started(1)], { ...headers(1), url: 'https://example.test/other' }],
    ['a different startedAt', [started(1)], { ...headers(1), startedAt: at(99) }],
    ['a skipped attempt', [started(1), headers(1)], started(3)],
    ['a first attempt other than 1', [], started(2)],
    ['a started row before the terminal', [started(1)], started(2)],
    ['a duplicate terminal', [started(1), headers(1)], headers(1)],
    ['an unknown phase', [started(1)], { ...request(1), phase: 'finished', at: at(11) }],
    ['an extra field', [], { ...started(1), extra: true }],
    ['a time before the start', [started(1)], { ...headers(1), at: at(5) }],
    ['a non-integer status', [started(1)], { ...headers(1), status: '200' }],
    ['an invalid code', [started(1)], { ...refused(1), code: 'bad code!' }],
    ['an attempt beyond the allocation', rowsFor(3), started(4)],
  ];
  for (const [name, prefix, bad] of cases) {
    const s = await setup(t, 3);
    for (const row of prefix) await s.log.append(row);
    const before = await readFile(s.workingPath);
    await assert.rejects(s.log.append(bad), code('source-event-contradiction'), name);
    assert.deepEqual(await readFile(s.workingPath), before, name);
  }
});

test('a pre-existing canonical file is accepted only when byte-identical', async (t) => {
  const same = await setup(t, 2); const rows = rowsFor(2); const bytes = rows.map(encode).join('');
  await writeFile(same.path, bytes);
  for (const row of rows) await same.log.append(row);
  assert.equal((await same.log.close()).sha256, sha(bytes));
  assert.equal(await readFile(same.path, 'utf8'), bytes);
  await assert.rejects(stat(same.workingPath), { code: 'ENOENT' });

  const diff = await setup(t, 2);
  await writeFile(diff.path, encode(rows[0]));
  for (const row of rows) await diff.log.append(row);
  await assert.rejects(diff.log.close(), code('source-event-canonical-contradiction'));
  assert.equal(await readFile(diff.path, 'utf8'), encode(rows[0]));
  assert.equal(await readFile(diff.workingPath, 'utf8'), bytes);
});

test('a conflict sibling beside the canonical path blocks export and strict reads', async (t) => {
  const s = await setup(t, 2); const rows = rowsFor(2);
  for (const row of rows) await s.log.append(row);
  await writeFile(s.copy, encode(rows[0]));
  await assert.rejects(s.log.close(), code('source-event-conflict-copy-present'));
  assert.equal(await readFile(s.copy, 'utf8'), encode(rows[0]));
  assert.equal(await readFile(s.workingPath, 'utf8'), rows.map(encode).join(''));
  await assert.rejects(stat(s.path), { code: 'ENOENT' });
  await writeFile(s.path, rows.map(encode).join(''));
  await assert.rejects(readSourceEventHistory(s.path, { attempts: 2 }), code('source-event-conflict-copy-present'));
  assert.equal(await readFile(s.copy, 'utf8'), encode(rows[0]));
});

test('exportSourceEventLog recovers a crashed run exactly without inventing a terminal row', async (t) => {
  const s = await setup(t, 2); const rows = rowsFor(2).slice(0, 3);
  for (const row of rows) await s.log.append(row);
  await s.log.abandon();
  const bytes = rows.map(encode).join('');
  const result = await exportSourceEventLog({ workingPath: s.workingPath, path: s.path, attempts: 2 });
  assert.deepEqual([result.rows, result.attemptsComplete, result.incompleteAttempt, result.sha256], [3, 1, 2, sha(bytes)]);
  assert.equal(await readFile(s.path, 'utf8'), bytes);
  await assert.rejects(stat(s.workingPath), { code: 'ENOENT' });
  await assert.rejects(readSourceEventHistory(s.path, { attempts: 2 }), code('source-event-contradiction'));
  const partial = await readSourceEventHistory(s.path, { attempts: 2, allowIncomplete: true });
  assert.equal(partial.incompleteAttempt, 2);
});

test('a working path under CloudStorage or beside the canonical file is refused', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gc015-')); t.after(() => rm(root, { recursive: true, force: true }));
  const cloud = join(root, 'Library', 'CloudStorage', 'OneDrive-IBM', 'working.jsonl');
  await assert.rejects(createSourceEventLog({ path: join(root, 'dest', 'e.jsonl'), workingPath: cloud, attempts: 2 }), code('source-event-working-path-cloud'));
  await assert.rejects(createSourceEventLog({ path: join(root, 'e.jsonl'), workingPath: join(root, 'w.jsonl'), attempts: 2 }), code('source-event-working-path-shared'));
  await assert.rejects(stat(join(root, 'w.jsonl')), { code: 'ENOENT' });
});

test('an existing working file is never overwritten and strict reads reject duplicates and mismatches', async (t) => {
  const s = await setup(t, 2);
  await assert.rejects(createSourceEventLog({ path: s.path, workingPath: s.workingPath, attempts: 2 }), { code: 'EEXIST' });
  const rows = rowsFor(2); const bytes = rows.map(encode).join('');
  await writeFile(s.path, bytes);
  await assert.rejects(readSourceEventHistory(s.path, { attempts: 2, expected: { rows: 5 } }), code('source-event-expected-mismatch'));
  await writeFile(s.path, bytes + encode(rows[3]));
  await assert.rejects(readSourceEventHistory(s.path, { attempts: 2 }), code('source-event-contradiction'));
  await writeFile(s.path, bytes.trimEnd());
  await assert.rejects(readSourceEventHistory(s.path, { attempts: 2 }), code('source-event-contradiction'));
});
