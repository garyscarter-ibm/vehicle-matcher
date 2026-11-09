// FUCQ-247 run 2: CPU breakdown of presenter Tick (mode step) and what grows in the controls readback, on a fresh local hosted run.
// PERF_PORT=9280-9289 PERF_SCRATCH=<owned review-247 dir> TICKS=n; writes tick-profile.json here. The .cpuprofile stays in scratch.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const port = Number(process.env.PERF_PORT || 9283); const TICKS = Number(process.env.TICKS || 8);
if (port < 9280 || port > 9289) throw new Error('PERF_PORT must be 9280-9289');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!scratch.includes('review-247')) throw new Error('Set PERF_SCRATCH to the owned review-247 run folder');
const profDir = join(scratch, 'tick-cpuprof'); const probeOut = join(scratch, 'probe-tick.jsonl');
const origin = `http://127.0.0.1:${port}`; const key = `perf-${randomBytes(9).toString('hex')}`;
const wait = (ms) => new Promise((d) => setTimeout(d, ms)); const r1 = (x) => Math.round(x * 10) / 10;
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1',
  GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: key, PORT: String(port), GCSP_PERF_PROBE_OUT: probeOut };
const spawnAt = Date.now();
const child = spawn(process.execPath, ['--cpu-prof', '--cpu-prof-dir', profDir, '--import', join(HERE, 'server-probe-run2.mjs'), 'index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } });
process.on('SIGALRM', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } process.exit(124); });
await appendFile(join(scratch, 'pids.txt'), `${child.pid} server tick-profile\n`);
let out = ''; await new Promise((done, fail) => { for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) done(); }); child.once('exit', () => fail(new Error(out.slice(-300)))); });
for (;;) { try { if ((await fetch(`${origin}/health/vehicle-evidence`)).status === 200) break; } catch { /* not yet */ } await wait(250); }
const jar = new Map();
const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
keep(await fetch(`${origin}/gcsp/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key, next: '/gcsp-presenter.html' }) }));
keep(await fetch(`${origin}/gcsp-presenter.html`, { headers: { cookie: cookie() } }));
const api = async (path, body) => { const t = performance.now(); const r = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie: cookie(), origin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  keep(r); const text = await r.text(); return { st: r.status, ms: r1(performance.now() - t), b: text.length, json: JSON.parse(text) }; };
// Bytes by JSON path (array items folded), to depth 3.
const paths = (x, p = '$', d = 0, m = new Map()) => { m.set(p, (m.get(p) ?? 0) + JSON.stringify(x ?? null).length);
  if (x && typeof x === 'object' && d < 3) { if (Array.isArray(x)) { for (const y of x) paths(y, `${p}[]`, d + 1, m); } else for (const [k, y] of Object.entries(x)) paths(y, `${p}.${k}`, d + 1, m); } return m; };
const findKey = (x, name) => { if (!x || typeof x !== 'object') return undefined; if (Object.hasOwn(x, name)) return x[name]; for (const y of Object.values(x)) { const f = findKey(y, name); if (f !== undefined) return f; } return undefined; };
const counts = (x) => { const c = {}; const walk = (y, p, d) => { if (Array.isArray(y)) { c[p] = y.length; for (const z of y.slice(0, 1)) walk(z, `${p}[]`, d + 1); } else if (y && typeof y === 'object' && d < 3) for (const [k, z] of Object.entries(y)) walk(z, `${p}.${k}`, d + 1); }; walk(x, '$', 0); return c; };

await wait(10000);
const phaseStart = Date.now();
const readbacks = []; const ticks = [];
let state = await api('/api/gcsp/presenter/controls');
readbacks.push({ after: 0, st: state.st, ms: state.ms, bytes: state.b, paths: paths(state.json), counts: counts(state.json) });
for (let i = 1; i <= TICKS; i += 1) {
  const expectedClockVersion = findKey(state.json, 'clockVersion');
  const t0 = Date.now();
  const tick = await api('/api/gcsp/presenter/controls/tick', { commandId: `perf-tick-${i}-${randomBytes(3).toString('hex')}`, expectedClockVersion, mode: 'step' });
  ticks.push({ i, st: tick.st, ms: tick.ms, bytes: tick.b, from: t0, to: Date.now(), status: tick.json?.status, code: tick.json?.code ?? null });
  state = await api('/api/gcsp/presenter/controls');
  readbacks.push({ after: i, st: state.st, ms: state.ms, bytes: state.b, paths: paths(state.json), counts: counts(state.json) });
}
const phaseEnd = Date.now();
await wait(1000);
// Seen in passing on Greg's dashboard: the order plan answers 503 on a fresh local run; record its reason.
await api('/api/gcsp/session/switch', { commandId: `perf-greg-${randomBytes(3).toString('hex')}`, principalId: 'demo-greg' });
const plan = await api('/api/gcsp/greg/order-plan');
const gone = once(child, 'exit'); child.kill('SIGTERM'); await gone;

// Self time and time by innermost server/gcsp frame, inside the tick POSTs only (profile clock aligned to spawn; tens of ms of skew).
const prof = (await readdir(profDir)).filter((f) => f.endsWith('.cpuprofile')).sort().at(-1);
const p = JSON.parse(await readFile(join(profDir, prof), 'utf8'));
const byId = new Map(p.nodes.map((n) => [n.id, n])); const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const k = (f) => `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/server\//, 'server/')}:${f.lineNumber + 1}`;
const ownFrame = (id) => { for (let x = id; x !== undefined; x = parent.get(x)) { const f = byId.get(x).callFrame; if (/\/server\/gcsp\//.test(f.url) && !/repository\/(core|memory)\.js/.test(f.url)) return k(f); } return '(none)'; };
const inTick = (ms) => ticks.some((t) => ms >= t.from - spawnAt && ms <= t.to - spawnAt);
const self = new Map(); const site = new Map(); const svc = new Map(); let total = 0; let at = 0;
for (let i = 0; i < p.samples.length; i += 1) {
  at += p.timeDeltas[i] ?? 0; if (!inTick(at / 1000)) continue;
  const dt = p.timeDeltas[i] ?? 0; const n = byId.get(p.samples[i]); total += dt;
  self.set(k(n.callFrame), (self.get(k(n.callFrame)) ?? 0) + dt);
  const own = ownFrame(n.id); site.set(own, (site.get(own) ?? 0) + dt);
  const file = own.replace(/^\S+ (server\/gcsp\/[^:]+):\d+$/, '$1'); svc.set(file, (svc.get(file) ?? 0) + dt);
}
const top = (m, n = 15) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([f, us]) => ({ fn: f, ms: Math.round(us / 1000), pct: r1((100 * us) / total) }));
const lines = (await readFile(probeOut, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const samples = lines.filter((l) => l.k === 's' && l.t >= phaseStart && l.t <= phaseEnd);
const first = readbacks[0]; const last = readbacks.at(-1);
const grew = [...last.paths].map(([q, b]) => ({ p: q, firstKB: r1((first.paths.get(q) ?? 0) / 1024), lastKB: r1(b / 1024), grewKB: r1((b - (first.paths.get(q) ?? 0)) / 1024) }))
  .filter((x) => x.p.split(/\.|\[\]/).length > 2).sort((a, b) => b.grewKB - a.grewKB).slice(0, 15);
const countGrowth = Object.entries(last.counts).map(([q, n]) => ({ p: q, first: first.counts[q] ?? 0, last: n })).filter((x) => x.last !== x.first);
const result = { story: 'FUCQ-247', run: 2, where: 'local, macOS, offline memory host, fresh run, presenter Tick mode step', node: process.version, measuredAt: new Date(phaseStart).toISOString(),
  ticks: ticks.map(({ from, to, ...t }) => t), readbackBytes: readbacks.map((r) => ({ after: r.after, st: r.st, ms: r.ms, bytes: r.bytes })), readbackGrowth: grew, arrayCountGrowth: countGrowth,
  gregOrderPlanAfterTicks: { st: plan.st, ms: plan.ms, status: plan.json?.status, reason: plan.json?.reason ?? null, code: plan.json?.code ?? null },
  serverDuringTicks: { maxEventLoopDelayMs: Math.max(0, ...samples.map((s) => s.eldMaxMs)), peakRssMiB: Math.round(Math.max(...samples.map((s) => s.rss)) / 1048576) },
  cpuProfile: { note: 'Samples inside the tick POSTs only. "byService" and "bySite" charge each sample to the innermost server/gcsp frame outside repository/core.js and memory.js.', totalMs: Math.round(total / 1000),
    topSelf: top(self), byService: top(svc, 12), bySite: top(site, 15) } };
await writeFile(join(HERE, 'tick-profile.json'), `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify({ ticks: result.ticks, readback: result.readbackBytes.map((r) => r.bytes), topSelf: result.cpuProfile.topSelf.slice(0, 5), byService: result.cpuProfile.byService.slice(0, 6) }));
