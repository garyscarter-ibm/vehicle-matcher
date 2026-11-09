// FUCQ-247 measurement preload (`node --import ./server-probe.mjs index.js`); changes no product behaviour.
// Every 250 ms appends memory, CPU and event-loop delay to GCSP_PERF_PROBE_OUT; also times each HTTP request (path only).
import { appendFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const out = process.env.GCSP_PERF_PROBE_OUT;
if (out) {
  writeFileSync(out, '');
  const eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable();
  let elu = performance.eventLoopUtilization();
  const sample = () => {
    const m = process.memoryUsage(); const c = process.cpuUsage(); const now = performance.eventLoopUtilization();
    const d = performance.eventLoopUtilization(now, elu); elu = now;
    appendFileSync(out, `${JSON.stringify({ k: 's', t: Date.now(), rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external,
      arrayBuffers: m.arrayBuffers, cpuUser: c.user, cpuSystem: c.system, elu: Number(d.utilization.toFixed(3)),
      eldMaxMs: Number((eld.max / 1e6).toFixed(1)), eldP99Ms: Number((eld.percentile(99) / 1e6).toFixed(1)) })}\n`);
    eld.reset();
  };
  sample(); setInterval(sample, 250).unref();
  // The front server re-emits /api requests on a second server, so only the outermost emit is timed.
  const seen = Symbol('fucq247');
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function patched(event, req, res) {
    if (event === 'request' && req && res && !req[seen]) {
      req[seen] = true; const start = performance.now(); const t = Date.now(); let bytes = 0;
      const write = res.write; const end = res.end;
      res.write = function w(chunk, ...rest) { if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk); return write.call(this, chunk, ...rest); };
      res.end = function e(chunk, ...rest) { if (chunk && typeof chunk !== 'function') bytes += Buffer.byteLength(chunk); return end.call(this, chunk, ...rest); };
      res.once('finish', () => {
        appendFileSync(out, `${JSON.stringify({ k: 'r', t, m: req.method, p: String(req.url).replace(/[?#].*$/, ''), st: res.statusCode,
          ms: Number((performance.now() - start).toFixed(1)), b: bytes, enc: res.getHeader('content-encoding') ?? null })}\n`);
      });
    }
    return emit.call(this, event, req, res);
  };
  process.once('exit', () => { try { appendFileSync(out, `${JSON.stringify({ k: 'exit', t: Date.now(), maxRssBytes: process.resourceUsage().maxRSS * 1024 })}\n`); } catch { /* gone */ } });
}
