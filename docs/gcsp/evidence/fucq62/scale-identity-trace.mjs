// Prepared main-process diagnostics only; no file identity guard is changed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const control = process.env.F62_SCALE_CONTROL; const scratch = process.env.TMPDIR;
assert.ok(control && scratch && fs.realpathSync(control) === control);
const target = join(root, 'server/gcsp/vehicle-evidence/indexed-jsonl.js');
const source = fs.readFileSync(target, 'utf8'); const targetUrl = pathToFileURL(target).href;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const identity = (info) => Object.fromEntries(
  ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map((key) => [key, String(info[key])]));
const descriptors = new Map(); const lastStats = new Map(); const events = []; const failures = []; const confirmations = [];
let frame = null; let active = null; let sequence = 0; let dropped = 0; let transformedSha256 = null;
function event(type, value) {
  events.push({ sequence: ++sequence, type, ...value });
  if (events.length > 128) { events.shift(); dropped++; }
}
function observe(fd, type, info) {
  const path = descriptors.get(fd); if (!path?.startsWith(scratch + '/')) return;
  const current = identity(info); lastStats.set(fd, current); event(type, { fd, path, current });
  if (active?.fd === fd) active.stats.push(current);
}
function save() {
  try {
    fs.writeFileSync(join(control, 'identity-trace.json'), JSON.stringify({
      status: failures.length ? 'indexed-identity-failure-captured' : 'bounded-trace-retained',
      pid: process.pid, productionSourceSha256: sha(source), transformedSha256,
      scope: 'Main proof process only; cold subprocesses keep their original command',
      eventLimit: 128, eventTotal: sequence, dropped, events, confirmations, failures,
    }) + '\n');
  } catch (error) { process.stderr.write('Identity trace write failed: ' + error.message + '\n'); }
}
globalThis.__f62ScaleIdentityTrace = {
  index(path) { frame = { kind: 'index-scan', path }; },
  read(path, expected, entry, integrity) {
    frame = { kind: 'indexed-row', path, expected: { ...expected },
      entry: { key: entry.key, offset: entry.offset, length: entry.length },
      checksum: integrity?.checksum || null };
  },
  confirm(fd, expected, current, checksum) {
    active = { fd, path: descriptors.get(fd), expected: { ...expected },
      current: { ...current }, checksum: checksum || null, stats: [] };
    event('confirmation-start', { fd, path: active.path, expected, current });
  },
  confirmed(current) {
    if (active) {
      confirmations.push({ ...active, returnedIdentity: current });
      if (confirmations.length > 8) confirmations.shift();
    }
    active = null;
  },
  returned(path, expected) {
    const fd = [...descriptors].find(([, value]) => value === path)?.[0];
    event('before-return', { path, expected: { ...expected }, current: lastStats.get(fd) || null });
  },
  fail(code, message) {
    if (failures.length < 8) failures.push({ code, message, frame,
      confirmation: active, stack: new Error(message).stack });
    active = null; save();
  },
};
const originalOpen = fsp.open;
fsp.open = async function (path, ...args) {
  const handle = await originalOpen.call(this, path, ...args); const fd = handle.fd;
  descriptors.set(fd, String(path));
  const stat = handle.stat.bind(handle); const close = handle.close.bind(handle);
  handle.stat = async (...args) => { const info = await stat(...args); observe(fd, 'FileHandle.stat', info); return info; };
  handle.close = async (...args) => { descriptors.delete(fd); lastStats.delete(fd); return close(...args); };
  return handle;
};
const originalOpenSync = fs.openSync; const originalCloseSync = fs.closeSync; const originalStat = fs.fstatSync;
fs.openSync = function (path, ...args) { const fd = originalOpenSync.call(this, path, ...args); descriptors.set(fd, String(path)); return fd; };
fs.closeSync = function (fd) { descriptors.delete(fd); lastStats.delete(fd); return originalCloseSync.call(this, fd); };
fs.fstatSync = function (fd, ...args) { const info = originalStat.call(this, fd, ...args); observe(fd, 'fstatSync', info); return info; };
syncBuiltinESMExports();
registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context); if (url !== targetUrl) return loaded;
  let transformed = String(loaded.source); assert.equal(transformed, source);
  const replace = (before, after) => {
    assert.equal(transformed.split(before).length, 2, 'Unexpected indexed JSONL source');
    transformed = transformed.replace(before, after);
  };
  replace('const fail = (code, message) => { throw new JsonlError(code, message); };',
    'const fail = (code, message) => { globalThis.__f62ScaleIdentityTrace.fail(code, message); throw new JsonlError(code, message); };');
  replace('function confirmMetadataChange(fd, expected, current, checksum) {',
    'function confirmMetadataChange(fd, expected, current, checksum) { globalThis.__f62ScaleIdentityTrace.confirm(fd, expected, current, checksum);');
  replace('  return latest;', '  globalThis.__f62ScaleIdentityTrace.confirmed(latest); return latest;');
  replace('export function readIndexedRow(path, expectedIdentity, entry, integrity) {',
    'export function readIndexedRow(path, expectedIdentity, entry, integrity) { globalThis.__f62ScaleIdentityTrace.read(path, expectedIdentity, entry, integrity);');
  replace("    return parse(bytes, 'Indexed record');",
    "    globalThis.__f62ScaleIdentityTrace.returned(path, expectedIdentity); return parse(bytes, 'Indexed record');");
  replace('  if (![maxBytes, maxRowBytes, maxRows, chunkBytes]',
    '  globalThis.__f62ScaleIdentityTrace.index(path); if (![maxBytes, maxRowBytes, maxRows, chunkBytes]');
  transformedSha256 = sha(transformed); return { ...loaded, source: transformed };
} });
process.on('exit', save);
