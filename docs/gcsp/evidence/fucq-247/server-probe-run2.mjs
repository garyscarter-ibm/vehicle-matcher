// FUCQ-247 run 2 preload: server-probe.mjs's samples and request timings, main thread only (a --import preload also runs in
// every worker), plus each worker's own heap. `node --import ./server-probe-run2.mjs index.js`; changes no product behaviour.
import { appendFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { isMainThread } from 'node:worker_threads';

const out = process.env.GCSP_PERF_PROBE_OUT;
if (out && isMainThread) {
  writeFileSync(out, '');
  const line = (o) => appendFileSync(out, `${JSON.stringify(o)}\n`);
  const eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable();
  let elu = performance.eventLoopUtilization();
  const sample = () => {
    const m = process.memoryUsage(); const c = process.cpuUsage(); const now = performance.eventLoopUtilization();
    const d = performance.eventLoopUtilization(now, elu); elu = now;
    line({ k: 's', t: Date.now(), rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external, arrayBuffers: m.arrayBuffers,
      cpuUser: c.user, cpuSystem: c.system, elu: Number(d.utilization.toFixed(3)), eldMaxMs: Number((eld.max / 1e6).toFixed(1)), eldP99Ms: Number((eld.percentile(99) / 1e6).toFixed(1)) });
    eld.reset();
  };
  sample(); setInterval(sample, 250).unref();
  // The front server re-emits /api requests on a second server, so only the outermost emit is timed.
  const seen = Symbol('fucq247'); const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function patched(event, req, res) {
    if (event === 'request' && req && res && !req[seen]) {
      req[seen] = true; const start = performance.now(); const t = Date.now(); let bytes = 0;
      const write = res.write; const end = res.end;
      res.write = function w(chunk, ...rest) { if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk); return write.call(this, chunk, ...rest); };
      res.end = function e(chunk, ...rest) { if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk); return end.call(this, chunk, ...rest); };
      res.once('finish', () => line({ k: 'r', t, m: req.method, p: String(req.url).replace(/[?#].*$/, ''), st: res.statusCode,
        ms: Number((performance.now() - start).toFixed(1)), b: bytes, enc: res.getHeader('content-encoding') ?? null }));
    }
    return emit.call(this, event, req, res);
  };
  process.once('exit', () => { try { line({ k: 'exit', t: Date.now(), maxRssBytes: process.resourceUsage().maxRSS * 1024 }); } catch { /* gone */ } });

  // Wraps every Worker the app creates, so the probe reads its heap without touching product code.
  const wt = createRequire(import.meta.url)('node:worker_threads');
  const Base = wt.Worker; let seq = 0;
  wt.Worker = class ProbedWorker extends Base {
    constructor(url, options) {
      super(url, options);
      const id = (seq += 1); const t0 = Date.now(); let peak = 0;
      line({ k: 'w', id, t: t0, ev: 'start', url: String(url).replace(/^.*\/server\//, 'server/'), limits: options?.resourceLimits ?? null });
      const timer = setInterval(async () => {
        try { const h = await this.getHeapStatistics(); peak = Math.max(peak, h.used_heap_size);
          line({ k: 'w', id, t: Date.now(), ev: 'heap', used: h.used_heap_size, total: h.total_heap_size, limit: h.heap_size_limit }); } catch { /* exiting */ }
      }, 250); timer.unref();
      this.on('message', (m) => { if (m?.type !== 'progress') line({ k: 'w', id, t: Date.now(), ev: 'msg', type: m?.type, reason: m?.reason ?? null }); else line({ k: 'w', id, t: Date.now(), ev: 'progress', completed: m.completed, route: m.route, seed: m.seed }); });
      this.on('error', (e) => line({ k: 'w', id, t: Date.now(), ev: 'error', code: e?.code ?? null, message: String(e?.message ?? '').slice(0, 160) }));
      this.on('exit', (code) => { clearInterval(timer); line({ k: 'w', id, t: Date.now(), ev: 'exit', code, ms: Date.now() - t0, peakUsed: peak }); });
    }
  };
  syncBuiltinESMExports();
}
