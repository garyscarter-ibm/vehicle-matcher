// FUCQ-247: per-call server cost of the read routes a page load makes, sequential and as one parallel burst,
// with a CPU profile of the burst phase. PERF_PORT=9280-9289 PERF_SCRATCH=<owned dir>; writes api-floor.json here.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const port = Number(process.env.PERF_PORT || 9287);
if (port < 9280 || port > 9289) throw new Error('PERF_PORT must be 9280-9289');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!scratch.includes('review-247')) throw new Error('Set PERF_SCRATCH to the owned review-247 run folder');
const origin = `http://127.0.0.1:${port}`; const key = `perf-${randomBytes(9).toString('hex')}`;
const wait = (ms) => new Promise((d) => setTimeout(d, ms));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;

const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1',
  GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: key, PORT: String(port) };
const spawnAt = performance.now();
const child = spawn(process.execPath, ['--cpu-prof', '--cpu-prof-dir', scratch, 'index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } });
await writeFile(join(scratch, '..', 'run-1-pids.txt'), `${child.pid} server api-floor\n`, { flag: 'a' });
let out = ''; await new Promise((done, fail) => { for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) done(); }); child.once('exit', () => fail(new Error(out.slice(-300)))); });
for (;;) { try { if ((await fetch(`${origin}/health/vehicle-evidence`)).status === 200) break; } catch { /* not yet */ } await wait(250); }

const jar = new Map();
const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
keep(await fetch(`${origin}/gcsp/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key, next: '/gcsp-presenter.html' }) }));
const shell = await fetch(`${origin}/gcsp-presenter.html`, { headers: { cookie: cookie() } }); keep(shell); await shell.arrayBuffer();
const get = async (path) => { const t = performance.now(); const r = await fetch(`${origin}${path}`, { headers: { cookie: cookie(), origin } }); const b = await r.arrayBuffer(); return { ms: performance.now() - t, st: r.status, b: b.byteLength }; };

// The nine calls the workspace makes on every page load (signin-workspace step in results-*.json).
const LOAD = ['/api/gcsp/context', '/api/gcsp/presenter/controls', '/api/gcsp/manual/account', '/api/gcsp/manual/draft', '/api/gcsp/offers/current',
  '/api/gcsp/orders/progress/all', '/api/gcsp/presenter/scenarios', '/api/gcsp/presenter/scenarios/faults', '/api/gcsp/context'];
for (let i = 0; i < 5; i += 1) await Promise.all(LOAD.map(get)); // warm-up
const phaseStartMs = performance.now() - spawnAt; // the profile below keeps only samples after this
const sequential = {};
for (const path of [...new Set(LOAD)]) { const xs = []; let last; for (let i = 0; i < 30; i += 1) { last = await get(path); xs.push(last.ms); } sequential[path] = { st: last.st, bytes: last.b, medianMs: r1(median(xs)), minMs: r1(Math.min(...xs)), maxMs: r1(Math.max(...xs)) }; }
const bursts = [];
for (let i = 0; i < 20; i += 1) { const t = performance.now(); const rs = await Promise.all(LOAD.map(get)); bursts.push({ wall: performance.now() - t, slowest: Math.max(...rs.map((r) => r.ms)) }); }
const sumSequential = LOAD.reduce((a, p) => a + sequential[p].medianMs, 0);
const result = { story: 'FUCQ-247', where: 'local, macOS, offline memory host, fresh run (no reset, no journey)', node: process.version, measuredAt: new Date().toISOString(),
  sequential, burstOfNine: { medianWallMs: r1(median(bursts.map((b) => b.wall))), minWallMs: r1(Math.min(...bursts.map((b) => b.wall))), maxWallMs: r1(Math.max(...bursts.map((b) => b.wall))) },
  sumOfSequentialMediansMs: r1(sumSequential) };

const phaseEndMs = performance.now() - spawnAt;
// Ticks (outside the profiled window), then which parts of the controls readback grow with them.
const sizes = async () => { const r = await fetch(`${origin}/api/gcsp/presenter/controls`, { headers: { cookie: cookie(), origin } }); const j = await r.json(); const v = j.value ?? j;
  const walk = (o, depth) => Object.fromEntries(Object.entries(o ?? {}).map(([k, x]) => [k, depth && x && typeof x === 'object' && !Array.isArray(x) ? walk(x, depth - 1) : JSON.stringify(x ?? null).length]));
  return { total: JSON.stringify(j).length, parts: walk(v, 1) }; };
result.controlsBeforeTicks = await sizes(); result.ticks = [];
for (let i = 0; i < 6; i += 1) { const t = performance.now(); const r = await fetch(`${origin}/api/gcsp/presenter/controls/tick`, { method: 'POST', headers: { cookie: cookie(), origin, 'content-type': 'application/json' }, body: '{}' });
  const b = await r.arrayBuffer(); result.ticks.push({ st: r.status, ms: r1(performance.now() - t), bytes: b.byteLength }); }
result.controlsAfterSixTicks = await sizes();
const gone = once(child, 'exit'); child.kill('SIGTERM'); await gone;
const prof = (await readdir(scratch)).filter((f) => f.endsWith('.cpuprofile')).sort().at(-1);
if (prof) {
  const p = JSON.parse(await readFile(join(scratch, prof), 'utf8'));
  const dt = new Map(); let at = 0;
  for (let i = 0; i < p.samples.length; i += 1) { at += p.timeDeltas[i] ?? 0; if (at / 1000 >= phaseStartMs && at / 1000 <= phaseEndMs) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0)); }
  const self = new Map(); let total = 0;
  for (const n of p.nodes) { const us = dt.get(n.id) ?? 0; total += us; const f = n.callFrame; const k = `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/server\//, 'server/')}:${f.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + us); }
  result.cpuProfile = { note: 'Samples from the sequential and burst read phases only (after start-up and warm-up, before the ticks). Self time by function.', totalMs: Math.round(total / 1000),
    topSelf: [...self].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, us]) => ({ fn: k, ms: Math.round(us / 1000), pct: r1((100 * us) / total) })) };
}
await writeFile(join(HERE, 'api-floor.json'), `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify(result.burstOfNine), result.sumOfSequentialMediansMs);
