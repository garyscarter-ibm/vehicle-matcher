// FUCQ-247 run 2: runs the real comparison worker alone (no HTTP host) to find what fills its heap.
// HEAP_MB / YOUNG_MB set the worker's resourceLimits (policy default 128 / 16); PROFILE=1 adds the sampling heap profiler.
// PERF_GC=1 (run under node --expose-gc) forces a full GC before each capture. PERF_TAG names the output: comparison-worker-<tag>.json here.
import { Worker } from 'node:worker_threads';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const heapMb = Number(process.env.HEAP_MB || 128); const youngMb = Number(process.env.YOUNG_MB || 16);
const profile = process.env.PROFILE === '1'; const forceGc = process.env.PERF_GC === '1'; const tag = process.env.PERF_TAG || `${heapMb}-${youngMb}${profile ? '-profile' : ''}${forceGc ? '-gc' : ''}`;
const url = profile ? new URL('./comparison-heap-wrapper.mjs', import.meta.url) : new URL('../../../../server/gcsp/comparison/worker.js', import.meta.url);
const MIB = 1048576; const t0 = Date.now(); const events = []; const series = []; const profiles = []; let peak = 0; let rssPeak = 0;
if (forceGc && typeof globalThis.gc !== 'function') throw new Error('PERF_GC=1 needs node --expose-gc');
const worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: youngMb },
  workerData: { experiment: { experimentId: 'process-only' }, codeRevision: 'perf-run2' } });
const timer = setInterval(async () => {
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  try { const h = await worker.getHeapStatistics(); peak = Math.max(peak, h.used_heap_size); series.push([Math.round((Date.now() - t0) / 100) / 10, Math.round(h.used_heap_size / MIB), Math.round(h.total_heap_size / MIB)]); } catch { /* exiting */ }
}, 250);
worker.on('message', (m) => {
  if (m?.type === 'heap-profile') { profiles.push({ t: Date.now() - t0, ...m }); return; }
  events.push({ t: Date.now() - t0, type: m?.type, ...(m?.type === 'progress' ? { completed: m.completed, total: m.total, route: m.route, seed: m.seed } : {}),
    ...(m?.type === 'failed' ? { reason: m.reason } : {}), ...(m?.type === 'result' ? { resultBytes: JSON.stringify(m.result).length } : {}) });
});
worker.on('error', (e) => events.push({ t: Date.now() - t0, type: 'error', code: e?.code ?? null, message: String(e?.message).slice(0, 160) }));
const code = await new Promise((done) => worker.once('exit', done));
clearInterval(timer);
// Keep the capture nearest the peak, plus the first and last, so the file stays small.
const byUsed = [...profiles].sort((a, b) => b.usedMiB - a.usedMiB);
const kept = [...new Map([profiles[0], byUsed[0], profiles.at(-1)].filter(Boolean).map((p) => [p.capture, p])).values()];
const out = { story: 'FUCQ-247', run: 2, where: 'local, macOS, worker thread only, no HTTP host', node: process.version, measuredAt: new Date(t0).toISOString(),
  resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: youngMb }, profiled: profile, exitCode: code, durationMs: Date.now() - t0, events,
  peakUsedHeapMiB: Math.round(peak / MIB), peakProcessRssMiB: Math.round(rssPeak / MIB), heapSeriesMiB: series.filter((_, i) => i % 4 === 0),
  heapProfiles: { captures: profiles.length, note: 'Live heap by allocation site at the capture (V8 sampling heap profiler, 16 KiB interval).', kept } };
await writeFile(join(HERE, `comparison-worker-${tag}.json`), `${JSON.stringify(out, null, 1)}\n`);
console.log(JSON.stringify({ tag, code, durationMs: out.durationMs, peakUsedHeapMiB: out.peakUsedHeapMiB, rss: out.peakProcessRssMiB, events: events.filter((e) => e.type !== 'progress'), progress: events.filter((e) => e.type === 'progress').length, captures: profiles.length }));
