// FUCQ-247 run 2: the default 1,000-employee comparison job (FUCQ-175/226) on a cold local hosted host, as Greg starts it.
// Times the job, samples worker heap and process RSS (server-probe-run2.mjs), and pings the main event loop while it runs.
// PERF_PORT=9280-9289 PERF_SCRATCH=<owned review-247 dir> PERF_RUN=n; writes comparison-job-<n>.json here.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const port = Number(process.env.PERF_PORT || 9281); const runNo = Number(process.env.PERF_RUN || 1);
if (port < 9280 || port > 9289) throw new Error('PERF_PORT must be 9280-9289');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!scratch.includes('review-247')) throw new Error('Set PERF_SCRATCH to the owned review-247 run folder');
const origin = `http://127.0.0.1:${port}`; const key = `perf-${randomBytes(9).toString('hex')}`;
const probeOut = join(scratch, `probe-comparison-${runNo}.jsonl`);
const wait = (ms) => new Promise((d) => setTimeout(d, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10 : null; };
const MIB = 1024 * 1024; const mib = (x) => Math.round(x / MIB);

const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1',
  GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: key, PORT: String(port), GCSP_PERF_PROBE_OUT: probeOut };
const child = spawn(process.execPath, ['--import', join(HERE, 'server-probe-run2.mjs'), 'index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
process.on('exit', () => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } });
process.on('SIGALRM', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } process.exit(124); });
await appendFile(join(scratch, 'pids.txt'), `${child.pid} server comparison-${runNo}\n`);
let out = ''; await new Promise((done, fail) => { for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) done(); }); child.once('exit', () => fail(new Error(out.slice(-300)))); });
for (;;) { try { if ((await fetch(`${origin}/health/vehicle-evidence`)).status === 200) break; } catch { /* not yet */ } await wait(250); }

const jar = new Map();
const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); } };
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
keep(await fetch(`${origin}/gcsp/access`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key, next: '/gcsp-presenter.html' }) }));
const shell = await fetch(`${origin}/gcsp-presenter.html`, { headers: { cookie: cookie() } }); keep(shell); await shell.arrayBuffer();
const api = async (path, { method = 'GET', body } = {}) => {
  const t = performance.now();
  const r = await fetch(`${origin}${path}`, { method, headers: { cookie: cookie(), origin, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  keep(r); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { st: r.status, ms: performance.now() - t, b: text.length, json };
};
const switched = await api('/api/gcsp/session/switch', { method: 'POST', body: { principalId: 'demo-greg', commandId: `perf-greg-${randomBytes(4).toString('hex')}` } });
await wait(10000); // settle after start-up, then a 5 s baseline of pings

// Ping the main loop every 200 ms with the cheapest route; the UI's own poll is jobs/latest every 2 s.
const pings = []; let pinging = true;
const pinger = (async () => { while (pinging) { const t = performance.now(); try { const r = await fetch(`${origin}/health`); await r.arrayBuffer(); } catch { /* down */ } pings.push({ t: Date.now(), ms: performance.now() - t }); await wait(200); } })();
await wait(5000);
const startedAt = Date.now();
const started = await api('/api/gcsp/comparison/jobs', { method: 'POST', body: { experimentId: 'process-only' } });
const polls = []; let job = started.json?.value ?? null;
while (Date.now() - startedAt < 1800000) {
  await wait(2000);
  const r = await api('/api/gcsp/comparison/jobs/latest'); polls.push({ t: Date.now(), ms: Math.round(r.ms), st: r.st, status: r.json?.value?.status, progress: r.json?.value?.progress });
  job = r.json?.value ?? job; if (['succeeded', 'failed', 'interrupted'].includes(job?.status)) break;
}
const endedAt = Date.now();
await wait(3000); pinging = false; await pinger;
const results = job?.status === 'succeeded' ? await api('/api/gcsp/comparison/results/latest?experimentId=process-only') : null;
const gone = once(child, 'exit'); child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 8000).unref(); await gone;

const lines = (await readFile(probeOut, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const s = lines.filter((l) => l.k === 's'); const w = lines.filter((l) => l.k === 'w'); const exit = lines.find((l) => l.k === 'exit');
const during = s.filter((x) => x.t >= startedAt && x.t <= endedAt + 250); const before = s.filter((x) => x.t < startedAt && x.t >= startedAt - 5000);
const pingDuring = pings.filter((p) => p.t >= startedAt && p.t <= endedAt).map((p) => p.ms); const pingBefore = pings.filter((p) => p.t < startedAt).map((p) => p.ms);
const heap = w.filter((x) => x.ev === 'heap');
const report = { story: 'FUCQ-247', run: 2, runNo, where: 'local, macOS, offline memory host (GCSP_RUNTIME=1, GCSP_REPOSITORY_MODE=memory, GCSP_OFFLINE=1)', node: process.version, measuredAt: new Date(startedAt).toISOString(),
  request: { experimentId: 'process-only' }, switchStatus: switched.st, start: { st: started.st, ms: Math.round(started.ms), status: started.json?.status, reason: started.json?.reason ?? null },
  outcome: { status: job?.status ?? null, reason: job?.reason ?? null, progress: job?.progress ?? null, durationMs: endedAt - startedAt, polledEveryMs: 2000 },
  worker: { events: w.filter((x) => x.ev !== 'heap').map(({ k, ...x }) => ({ ...x, t: x.t - startedAt })), heapSamples: heap.length,
    peakUsedMiB: heap.length ? mib(Math.max(...heap.map((x) => x.used))) : null, peakTotalMiB: heap.length ? mib(Math.max(...heap.map((x) => x.total))) : null,
    heapLimitMiB: heap.length ? mib(heap[0].limit) : null, usedSeriesMiB: heap.filter((_, i) => i % 8 === 0).map((x) => [Math.round((x.t - startedAt) / 100) / 10, mib(x.used)]) },
  process: { rssBeforeMiB: before.length ? mib(Math.max(...before.map((x) => x.rss))) : null, peakRssDuringMiB: during.length ? mib(Math.max(...during.map((x) => x.rss))) : null,
    mainHeapUsedPeakDuringMiB: during.length ? mib(Math.max(...during.map((x) => x.heapUsed))) : null, maxRssProcessMiB: exit ? mib(exit.maxRssBytes) : null,
    mainEventLoopDelayMaxDuringMs: during.length ? Math.max(...during.map((x) => x.eldMaxMs)) : null, mainEluMeanDuring: during.length ? Math.round(1000 * during.reduce((a, x) => a + x.elu, 0) / during.length) / 1000 : null },
  mainLoopPing: { path: '/health', everyMs: 200, before: { n: pingBefore.length, p50: pct(pingBefore, 0.5), p95: pct(pingBefore, 0.95), max: pct(pingBefore, 1) },
    during: { n: pingDuring.length, p50: pct(pingDuring, 0.5), p95: pct(pingDuring, 0.95), max: pct(pingDuring, 1), over100ms: pingDuring.filter((x) => x > 100).length } },
  pollServerMs: { p50: pct(polls.map((p) => p.ms), 0.5), max: pct(polls.map((p) => p.ms), 1), n: polls.length },
  storedResult: results ? { st: results.st, ms: Math.round(results.ms), bytes: results.b } : null };
await writeFile(join(HERE, `comparison-job-${runNo}.json`), `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ outcome: report.outcome, worker: { peakUsedMiB: report.worker.peakUsedMiB, limit: report.worker.heapLimitMiB, events: report.worker.events }, process: report.process, ping: report.mainLoopPing.during }));
