/** Source HTTP event log: append locally, export once to the retained path. Never synthesises rows. */
import { open, readFile, readdir, realpath, rm, stat, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, resolve } from 'node:path';

const CLOUD_SEGMENT = '/Library/CloudStorage/';
const CODE = /^[a-zA-Z0-9_-]{1,64}$/;
const BASE_KEYS = ['attempt', 'method', 'phase', 'startedAt', 'url'];
const TERMINAL_KEYS = { 'headers-received': [...BASE_KEYS, 'at', 'status'].sort(), 'transport-refused': [...BASE_KEYS, 'at', 'code'].sort() };

const fail = (code, message) => Object.assign(new Error(message || code), { code });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sameKeys = (row, keys) => Object.keys(row).sort().join() === keys.join();

function step(state, row, attempts) {
  const bad = (why) => fail('source-event-contradiction', `source-event-contradiction: ${why}`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw bad('row is not an object');
  if (row.phase === 'started') {
    if (!sameKeys(row, [...BASE_KEYS].sort())) throw bad('started row has unexpected fields');
    if (state.open) throw bad(`attempt ${row.attempt} started before attempt ${state.open.attempt} finished`);
    if (row.attempt !== state.next || row.attempt > attempts) throw bad(`attempt ${row.attempt} is not the next attempt ${state.next}`);
    if (typeof row.method !== 'string' || !row.method || typeof row.url !== 'string' || !row.url || !isDate(row.startedAt)) throw bad('started row has invalid values');
    return { next: state.next + 1, open: row, done: state.done };
  }
  if (!TERMINAL_KEYS[row.phase]) throw bad('unknown phase');
  if (!sameKeys(row, TERMINAL_KEYS[row.phase])) throw bad(`${row.phase} row has unexpected fields`);
  if (!state.open) throw bad(`${row.phase} without a started row`);
  for (const key of ['attempt', 'method', 'url', 'startedAt']) if (row[key] !== state.open[key]) throw bad(`${row.phase} ${key} differs from its started row`);
  if (!isDate(row.at) || Date.parse(row.at) < Date.parse(row.startedAt)) throw bad('terminal time precedes start');
  if (row.phase === 'headers-received' && !(Number.isInteger(row.status) && row.status >= 100 && row.status <= 599)) throw bad('invalid status');
  if (row.phase === 'transport-refused' && !(typeof row.code === 'string' && CODE.test(row.code))) throw bad('invalid code');
  return { next: state.next, open: null, done: state.done + 1 };
}

const freshState = () => ({ next: 1, open: null, done: 0 });
const summary = (state, rows, bytes, hash) => ({ rows, bytes, sha256: hash, attemptsComplete: state.done, incompleteAttempt: state.open ? state.open.attempt : null });

function parseHistory(buffer, attempts) {
  if (!buffer.length || buffer[buffer.length - 1] !== 0x0a) throw fail('source-event-contradiction', 'source-event-contradiction: log is empty or not newline-terminated');
  const lines = buffer.toString('utf8').slice(0, -1).split('\n');
  let state = freshState(); const events = [];
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { throw fail('source-event-contradiction', 'source-event-contradiction: unparseable row'); }
    if (JSON.stringify(row) !== line) throw fail('source-event-contradiction', 'source-event-contradiction: row is not canonically encoded');
    state = step(state, row, attempts); events.push(row);
  }
  return { events, ...summary(state, events.length, buffer.length, sha(buffer)) };
}

async function conflictSiblings(path) {
  const ext = extname(path); const stem = basename(path, ext);
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(?:${escape(stem)}|${escape(basename(path))}) \\d+${escape(ext)}$`);
  let names = [];
  try { names = await readdir(dirname(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return names.filter((name) => pattern.test(name));
}

async function refuseSiblings(path) {
  const found = await conflictSiblings(path);
  if (found.length) throw fail('source-event-conflict-copy-present', `source-event-conflict-copy-present: ${found.join(', ')}`);
}

async function realDir(directory) {
  try { return await realpath(directory); } catch { return directory; }
}

async function checkPaths(workingPath, path, attempts) {
  if (!Number.isInteger(attempts) || attempts < 1) throw fail('source-event-attempts-invalid');
  if (typeof workingPath !== 'string' || typeof path !== 'string' || !workingPath || !path) throw fail('source-event-path-invalid');
  const work = resolve(workingPath); const target = resolve(path);
  const workDir = dirname(work); const targetDir = dirname(target);
  for (const directory of [workDir, await realDir(workDir)]) {
    if (`${directory}/`.includes(CLOUD_SEGMENT)) throw fail('source-event-working-path-cloud', 'source-event-working-path-cloud: working log must be local');
  }
  if (work === target || workDir === targetDir || (await realDir(workDir)) === (await realDir(targetDir))) {
    throw fail('source-event-working-path-shared', 'source-event-working-path-shared: working log must not share a directory with the canonical path');
  }
  return { work, target };
}

async function syncDirectory(directory) {
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function exportExact({ work, target, bytes, hash, result }) {
  await refuseSiblings(target);
  let existing = null;
  try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (sha(existing) !== hash || existing.length !== bytes.length) throw fail('source-event-canonical-contradiction', 'source-event-canonical-contradiction: canonical file differs from the working log');
  } else {
    const handle = await open(target, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(dirname(target));
  }
  const back = await readFile(target);
  if (back.length !== bytes.length || sha(back) !== hash) throw fail('source-event-export-mismatch', 'source-event-export-mismatch: canonical read-back differs');
  await refuseSiblings(target);
  await rm(work);
  return { path: target, ...result };
}

export async function createSourceEventLog({ path, workingPath, attempts }) {
  const { work, target } = await checkPaths(workingPath, path, attempts);
  const handle = await open(work, 'ax', 0o600);
  const identity = await handle.stat();
  const hash = createHash('sha256');
  let state = freshState(); let rows = 0; let bytes = 0; let finished = false; let broken = null;

  const verify = async () => {
    let now;
    try { now = await stat(work); } catch { throw fail('source-event-working-log-replaced', 'source-event-working-log-replaced: working log is missing'); }
    if (now.dev !== identity.dev || now.ino !== identity.ino || now.size !== bytes) {
      throw fail('source-event-working-log-replaced', 'source-event-working-log-replaced: working log changed identity or size');
    }
  };

  return {
    async append(row) {
      if (finished) throw fail('source-event-log-closed');
      if (broken) throw broken;
      const next = step(state, row, attempts);
      const buffer = Buffer.from(`${JSON.stringify(row)}\n`);
      try { await verify(); } catch (error) { broken = error; throw error; }
      const { bytesWritten } = await handle.write(buffer, 0, buffer.length, null);
      if (bytesWritten !== buffer.length) { broken = fail('source-event-working-log-replaced', 'short write'); throw broken; }
      await handle.sync();
      bytes += buffer.length; hash.update(buffer); rows += 1; state = next;
      try { await verify(); } catch (error) { broken = error; throw error; }
    },
    async abandon() { if (!finished) { finished = true; await handle.close(); } },
    async close() {
      if (finished) throw fail('source-event-log-closed');
      finished = true; await handle.close();
      if (broken) throw broken;
      await verify();
      const buffer = await readFile(work); const expected = hash.copy().digest('hex');
      if (buffer.length !== bytes || sha(buffer) !== expected) throw fail('source-event-working-log-replaced', 'source-event-working-log-replaced: working bytes differ from appended rows');
      return exportExact({ work, target, bytes: buffer, hash: expected, result: summary(state, rows, bytes, expected) });
    },
  };
}

export async function exportSourceEventLog({ workingPath, path, attempts }) {
  const { work, target } = await checkPaths(workingPath, path, attempts);
  if (!(await lstat(work)).isFile()) throw fail('source-event-working-log-invalid', 'source-event-working-log-invalid: not a regular file');
  const buffer = await readFile(work);
  const { events, ...result } = parseHistory(buffer, attempts);
  return exportExact({ work, target, bytes: buffer, hash: result.sha256, result });
}

export async function readSourceEventHistory(path, { attempts, expected, allowIncomplete = false } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw fail('source-event-attempts-invalid');
  const target = resolve(path);
  await refuseSiblings(target);
  const parsed = parseHistory(await readFile(target), attempts);
  if (!allowIncomplete && (parsed.incompleteAttempt !== null || parsed.attemptsComplete !== attempts)) {
    throw fail('source-event-contradiction', `source-event-contradiction: ${parsed.attemptsComplete} of ${attempts} attempts complete`);
  }
  for (const key of ['sha256', 'bytes', 'rows']) {
    if (expected && expected[key] !== undefined && expected[key] !== parsed[key]) throw fail('source-event-expected-mismatch', `source-event-expected-mismatch: ${key} ${parsed[key]} !== ${expected[key]}`);
  }
  return parsed;
}
