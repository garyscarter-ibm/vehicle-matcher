// FUCQ-302: HTTP-only before/after timing of the hosted memory host (read floor, page bursts, Ticks, grown state); writes <PERF_LABEL>.json here.
// Env: PERF_SERVER_DIR (default ../../../../server), PERF_PORT 9540-9549, PERF_SCRATCH (path with 'fucq-302-runs'), PERF_LABEL, ROUNDS (15).
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(process.env.PERF_SERVER_DIR || join(HERE, '../../../../server'));
const port = Number(process.env.PERF_PORT || 9540);
if (!(port >= 9540 && port <= 9549)) throw new Error('PERF_PORT must be 9540-9549');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!scratch.includes('fucq-302-runs')) throw new Error('Set PERF_SCRATCH to the owned fucq-302-runs folder');
const label = process.env.PERF_LABEL || 'run'; const ROUNDS = Number(process.env.ROUNDS || 15);
if (!/^[\w.-]+$/.test(label)) throw new Error('PERF_LABEL must be a plain name');
await mkdir(scratch, { recursive: true });
const probe = join(HERE, '../fucq-247/server-probe-run2.mjs'); const probeOut = join(scratch, 'probe.jsonl');
const origin = `http://127.0.0.1:${port}`; const key = `perf-${randomBytes(9).toString('hex')}`;
const wait = (ms) => new Promise((d) => setTimeout(d, ms));
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const startedAt = performance.now();

const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, TMP: scratch, TEMP: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
  GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: key, PORT: String(port), GCSP_PERF_PROBE_OUT: probeOut };
const child = spawn(process.execPath, ['--import', probe, 'index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
const killChild = () => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', killChild);
process.on('SIGALRM', () => { killChild(); process.exit(124); });
process.on('uncaughtException', (e) => { killChild(); console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { killChild(); console.error(e); process.exit(1); });
await appendFile(join(scratch, '..', `pids-${label}.txt`), `${child.pid} server ${label}\n`);
let out = ''; await new Promise((done, fail) => { for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) done(); }); child.once('exit', () => fail(new Error(out.slice(-300)))); });
for (;;) { try { if ((await fetch(`${origin}/health/vehicle-evidence`)).status === 200) break; } catch { /* not yet */ } await wait(250); }

const jar = new Map();
const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
keep(await fetch(`${origin}/gcsp/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key, next: '/gcsp-presenter.html' }) }));
keep(await fetch(`${origin}/gcsp-presenter.html`, { headers: { cookie: cookie() } }));
const call = async (path, body) => {
  const t0 = Date.now(); const t = performance.now();
  const r = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { cookie: cookie(), origin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  keep(r); const buf = await r.arrayBuffer(); return { path, st: r.status, b: buf.byteLength, ms: performance.now() - t, t0, t1: Date.now(), buf };
};
const get = (path) => call(path);
const parseJson = (r) => { try { return JSON.parse(Buffer.from(r.buf).toString('utf8')); } catch { return null; } };
const findKey = (x, name) => { if (!x || typeof x !== 'object') return undefined; if (Object.hasOwn(x, name)) return x[name]; for (const y of Object.values(x)) { const f = findKey(y, name); if (f !== undefined) return f; } return undefined; };

// Call sets: the nine-call workspace load (api-floor-profile.mjs), the 14-call presenter page load and the 12-call Greg dashboard load (fucq-247 results).
const P = '/api/gcsp';
const LOAD = [`${P}/context`, `${P}/presenter/controls`, `${P}/manual/account`, `${P}/manual/draft`, `${P}/offers/current`, `${P}/orders/progress/all`,
  `${P}/presenter/scenarios`, `${P}/presenter/scenarios/faults`, `${P}/context`];
const PRESENTER_PAGE = [...LOAD, `${P}/manual/order`, `${P}/orders/progress`, `${P}/documents`, `${P}/appointments`, `${P}/return-plan`];
const GREG_PAGE = [`${P}/context`, `${P}/context`, `${P}/greg/policy`, `${P}/greg/order-plan`, `${P}/comparison/results/latest`, `${P}/comparison/jobs/latest`, `${P}/greg/demand`,
  `${P}/scheme-team/cases`, `${P}/greg/orders`, `${P}/presenter/controls`, `${P}/presenter/scenarios`, `${P}/presenter/scenarios/faults`];
const switchTo = (principalId) => call(`${P}/session/switch`, { commandId: `perf-sw-${randomBytes(4).toString('hex')}`, principalId });

const marks = []; // windows resolved against the server-side probe once the run is over
const mark = (kind, data, t0, t1) => marks.push({ kind, ...data, t0, t1 });
const sequential = async (name, paths, n) => { // one call at a time, n each
  const t0 = Date.now(); const walls = {}; const sts = {};
  for (const p of paths) { walls[p] = []; sts[p] = {}; for (let i = 0; i < n; i += 1) { const r = await get(p); walls[p].push(r.ms); sts[p][r.st] = (sts[p][r.st] ?? 0) + 1; sts[p].bytes = r.b; } }
  mark('seq', { name, paths, walls, sts }, t0, Date.now());
};
const burst = async (name, paths, rounds) => { // all of the set fired together, rounds times
  const t0 = Date.now(); const rs = []; const walls = {}; const sts = {}; const roundWin = [];
  for (let i = 0; i < rounds; i += 1) {
    const a = Date.now(); const t = performance.now(); const res = await Promise.all(paths.map(get));
    rs.push(performance.now() - t); roundWin.push([a, Date.now()]);
    for (const r of res) { (walls[r.path] ??= []).push(r.ms); const s = (sts[r.path] ??= {}); s[r.st] = (s[r.st] ?? 0) + 1; s.bytes = r.b; }
  }
  mark('burst', { name, paths, calls: paths.length, roundWall: rs, roundWin, walls, sts }, t0, Date.now());
};

const set = async (suffix, seqN) => {
  await sequential(`floor${suffix}`, [...new Set(LOAD)], seqN);
  await burst(`burst9${suffix}`, LOAD, ROUNDS);
  await burst(`presenterPage${suffix}`, PRESENTER_PAGE, ROUNDS);
  const sw = await switchTo('demo-greg'); if (sw.st !== 200) mark('note', { text: `switch to Greg ${sw.st}` }, sw.t0, sw.t1);
  await burst(`gregDashboard${suffix}`, GREG_PAGE, ROUNDS);
  const back = await switchTo('demo-paula'); if (back.st !== 200) mark('note', { text: `switch back to Paula ${back.st}` }, back.t0, back.t1);
};

await wait(3000);
for (let i = 0; i < 5; i += 1) await Promise.all(LOAD.map(get)); // warm-up
await set('', 30); // phases 1 and 2, fresh

const ticks = []; // phase 3
let state = await get(`${P}/presenter/controls`);
for (let i = 1; i <= 8; i += 1) {
  const t0 = Date.now();
  const tick = await call(`${P}/presenter/controls/tick`, { commandId: `perf-tick-${i}-${randomBytes(3).toString('hex')}`, expectedClockVersion: findKey(parseJson(state), 'clockVersion'), mode: 'step' });
  state = await get(`${P}/presenter/controls`);
  const j = parseJson(tick);
  ticks.push({ i, st: tick.st, status: j?.status ?? null, wallMs: tick.ms, tickT0: tick.t0, tickT1: tick.t1, winT0: t0, winT1: Date.now(), readbackBytes: state.b, tickBytes: tick.b });
}
await set('Grown', 10); // phase 4, after the ticks
await wait(600);
const gone = once(child, 'exit'); child.kill('SIGTERM'); await gone;

const lines = (await readFile(probeOut, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const reqs = lines.filter((l) => l.k === 'r' && l.p.startsWith(P)); const samples = lines.filter((l) => l.k === 's');
const inWin = (rs, a, b) => rs.filter((r) => r.t >= a && r.t <= b);
const stat = (srv, wall, extra) => ({ ...extra, serverMedianMs: r1(median(srv)), serverP90Ms: r1(pct(srv, 0.9)), wallMedianMs: r1(median(wall)), wallP90Ms: r1(pct(wall, 0.9)), n: wall.length });
const phases = {}; const notes = [];
for (const m of marks) {
  if (m.kind === 'note') { notes.push(m.text); continue; }
  const mine = inWin(reqs, m.t0, m.t1); const routes = {};
  for (const p of new Set(m.paths)) { const srv = mine.filter((r) => r.p === p).map((r) => r.ms); routes[p.slice(P.length)] = stat(srv, m.walls[p], { statuses: Object.fromEntries(Object.entries(m.sts[p]).filter(([k]) => k !== 'bytes')), bytes: m.sts[p].bytes }); }
  const entry = { routes };
  if (m.kind === 'burst') {
    const sums = m.roundWin.map(([a, b]) => inWin(reqs, a, b).reduce((s, r) => s + r.ms, 0));
    Object.assign(entry, { calls: m.calls, rounds: m.roundWall.length, wallMedianMs: r1(median(m.roundWall)), wallP90Ms: r1(pct(m.roundWall, 0.9)), serverSumMedianMs: r1(median(sums)), serverSumP90Ms: r1(pct(sums, 0.9)) });
  } else entry.sumOfServerMediansMs = r1(Object.values(routes).reduce((s, r) => s + r.serverMedianMs, 0));
  phases[m.name] = entry;
}
const tickOut = ticks.map((t) => {
  const srv = inWin(reqs, t.tickT0 - 5, t.tickT1).find((r) => r.m === 'POST' && r.p.endsWith('/tick'));
  const eld = samples.filter((s) => s.t >= t.winT0 && s.t <= t.winT1 + 260).map((s) => s.eldMaxMs);
  return { i: t.i, st: t.st, status: t.status, wallMs: r1(t.wallMs), serverMs: srv?.ms ?? null, eldMaxMs: Math.max(0, ...eld), readbackBytes: t.readbackBytes };
});
const rssPeak = Math.max(...samples.map((s) => s.rss), lines.find((l) => l.k === 'exit')?.maxRssBytes ?? 0);
const result = { story: 'FUCQ-302', label, node: process.version, measuredAt: new Date().toISOString(), rounds: ROUNDS, serverDir: SERVER_DIR.replace(/^.*\/scratchpad\//, '') , phases,
  ticks: tickOut, tickMedian: { wallMs: r1(median(tickOut.map((t) => t.wallMs))), serverMs: r1(median(tickOut.map((t) => t.serverMs ?? 0))), eldMaxMs: r1(median(tickOut.map((t) => t.eldMaxMs))), readbackBytes: tickOut.at(-1)?.readbackBytes },
  serverLog: { bytes: out.length, unavailable: (out.match(/gcsp-repository unavailable/gi) ?? []).length, errorLines: out.split('\n').filter((l) => /error|unavailable|\b5\d\d\b/i.test(l)).slice(0, 5).map((l) => l.slice(0, 160)) },
  rssPeakMiB: Math.round(rssPeak / 1048576), runSeconds: Math.round((performance.now() - startedAt) / 100) / 10, notes };
await writeFile(join(HERE, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
console.log(label, 'done', result.runSeconds, 's', 'rssPeakMiB', result.rssPeakMiB, 'tickMedian', JSON.stringify(result.tickMedian), notes.join('; '));
