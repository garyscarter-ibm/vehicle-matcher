import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const selected = new URL('../data/gcsp/vehicle-evidence/lookup-reference.v1/', import.meta.url);
const candidate = new URL('../data/gcsp/vehicle-evidence/publication-reference.v1/', import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Loaded before the real entry point. Builtin ESM exports and socket connections
// are guarded too, so an HTTPS caller cannot bypass the global fetch guard.
const guardSource = `
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const allowed = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function host(args) {
  let value = args[0];
  if (Array.isArray(value)) return host(value);
  if (typeof value === 'number') return typeof args[1] === 'string' ? args[1] : 'localhost';
  if (value instanceof URL) return value.hostname;
  if (typeof value === 'string') { try { return new URL(value).hostname; } catch { return value; } }
  return value?.hostname || value?.host || value?.servername || 'localhost';
}
function check(name, args) {
  if (allowed.has(host(args))) return;
  fs.appendFileSync(process.env.GCSP_EGRESS_LOG, JSON.stringify({ transport: name }) + '\\n');
  throw new Error('External transport forbidden during offline startup');
}
for (const [target, key, name] of [[http, 'request', 'http.request'], [http, 'get', 'http.get'],
  [https, 'request', 'https.request'], [https, 'get', 'https.get'], [tls, 'connect', 'tls.connect'],
  [net.Socket.prototype, 'connect', 'net.Socket.connect']]) {
  const original = target[key];
  target[key] = function (...args) { check(name, args); return Reflect.apply(original, this, args); };
}
const fetch = globalThis.fetch;
globalThis.fetch = function (...args) {
  const input = args[0]?.url || args[0]; check('fetch', [input]); return Reflect.apply(fetch, this, args);
};
syncBuiltinESMExports();
`;

function request(base, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (part) => { body += part; }); res.on('error', reject);
      res.on('end', () => {
        try { resolve({ code: res.statusCode, body: body ? JSON.parse(body) : null }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Offline HTTP request timed out')));
    req.on('error', reject); req.end();
  });
}

async function start({ scratch, guard, corpusRoot, stops }) {
  let output = ''; let spawnError;
  const child = spawn(process.execPath, ['--import', guard, join(project, 'server/index.js')], {
    cwd: project, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    // Deliberately omit provider keys, DATABASE_URL and inherited NODE_OPTIONS.
    env: { PATH: process.env.PATH, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      PORT: '0', GCSP_OFFLINE: '1', COLOUR_WARM: '1', GCSP_EGRESS_LOG: join(scratch, 'egress.jsonl'),
      ...(corpusRoot ? { GCSP_VEHICLE_EVIDENCE_ROOT: corpusRoot } : {}) },
  });
  child.on('error', (error) => { spawnError = error; });
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-16384); });
  child.stderr.on('data', (chunk) => { output = (output + chunk).slice(-16384); });
  let closed = false;
  const close = new Promise((resolve) => child.once('close', () => { closed = true; resolve(); }));
  async function waitForClose() {
    let timer;
    try { await Promise.race([close, new Promise((resolve) => { timer = setTimeout(resolve, 3000); })]); }
    finally { clearTimeout(timer); }
  }
  async function stop() {
    if (!child.pid) { await close; return; }
    if (!closed) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await waitForClose();
      if (!closed) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
      await waitForClose();
    }
    assert.equal(closed, true, 'owned offline child must close');
    if (child.pid) assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' });
  }
  stops.push(stop);
  const deadline = Date.now() + 10000;
  while ((!/Matcher API listening on http:\/\/localhost:\d+/.test(output) || !output.includes('live startup warmers disabled'))
    && !closed && !spawnError && Date.now() < deadline) await delay(25);
  if (spawnError) throw spawnError;
  const match = output.match(/Matcher API listening on http:\/\/localhost:(\d+)/);
  assert.ok(match, `offline child did not start: ${output}`);
  assert.match(output, /live startup warmers disabled/);
  return { base: `http://127.0.0.1:${match[1]}`, stop };
}

test('the real same-entry offline profile cold-starts and restarts selected local evidence without credentials or external calls', { timeout: 45000 }, async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'gcsp-offline-'));
  const stops = [];
  t.after(async () => {
    for (const stop of [...stops].reverse()) await stop();
    await rm(scratch, { recursive: true, force: true });
  });
  const guard = join(scratch, 'offline-guard.mjs'); await writeFile(guard, guardSource);
  const before = await Promise.all(['active.json', 'identity-inventory.json'].map((name) => readFile(new URL(name, selected), 'utf8')));
  const [vehicle] = (await readFile(new URL('vins.jsonl', candidate), 'utf8')).trim().split('\n').map(JSON.parse);
  let first;
  for (let attempt = 0; attempt < 2; attempt++) {
    const server = await start({ scratch, guard, stops });
    assert.deepEqual(await request(server.base, '/health'), { code: 200, body: { ok: true } });
    const vin = await request(server.base, `/api/gcsp/vehicle-evidence/vins/${vehicle.vin17}`);
    assert.equal(vin.code, 200); assert.equal(vin.body.identity.identityKind, 'synthetic');
    assert.equal(vin.body.routing.liveEligible, false);
    const configuration = await request(server.base, `/api/gcsp/vehicle-evidence/configurations/${encodeURIComponent(vehicle.configurationId)}`);
    assert.equal(configuration.code, 200); assert.deepEqual(configuration.body.technical, vin.body.technical);
    assert.equal((await request(server.base, '/api/gcsp/vehicle-evidence/vins/ZZZZZZZZ0ZZ000000')).code, 404);
    assert.equal((await request(server.base, '/api/gcsp/vehicle-evidence/stock/1d736acd-674c-4bb1-8b6b-45dc56906442')).code, 503);
    if (first) assert.deepEqual(vin.body, first); else first = vin.body;
    await server.stop();
  }
  const missing = await start({ scratch, guard, stops, corpusRoot: join(scratch, 'missing-selected-store') });
  assert.equal((await request(missing.base, `/api/gcsp/vehicle-evidence/vins/${vehicle.vin17}`)).code, 503);
  await missing.stop();
  assert.deepEqual(await Promise.all(['active.json', 'identity-inventory.json'].map((name) => readFile(new URL(name, selected), 'utf8'))), before);
  assert.equal(await readFile(join(scratch, 'egress.jsonl'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''; throw error;
  }), '');
});
