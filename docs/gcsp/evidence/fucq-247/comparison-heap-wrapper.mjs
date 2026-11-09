// FUCQ-247 run 2: worker entry that runs the real comparison worker (server/gcsp/comparison/worker.js) under V8's
// sampling heap profiler, and posts what is live on the heap, by allocation site, at each progress step.
import { Session } from 'node:inspector';
import { parentPort } from 'node:worker_threads';
import v8 from 'node:v8';

const session = new Session(); session.connect();
const post = (method, params) => { let out; let err; session.post(method, params, (e, r) => { err = e; out = r; }); if (err) throw err; return out; };
post('HeapProfiler.enable'); post('HeapProfiler.startSampling', { samplingInterval: 16384 });
const frameKey = (f) => `${f.functionName || '(anonymous)'} ${f.url.replace(/^.*\/server\//, 'server/')}:${f.lineNumber + 1}`;
const own = (f) => /\/server\/(gcsp|vehicles)\//.test(f.url);
const send = parentPort.postMessage.bind(parentPort);
let captures = 0;
function capture(label) {
  const before = v8.getHeapStatistics().used_heap_size;
  // With --expose-gc (PERF_GC=1 in the driver) a full GC first, so the capture is what the step retains.
  if (typeof globalThis.gc === 'function') { globalThis.gc(); globalThis.gc(); }
  const used = v8.getHeapStatistics().used_heap_size;
  const { profile } = post('HeapProfiler.getSamplingProfile');
  const self = new Map(); const site = new Map(); let total = 0;
  // site: the innermost server/gcsp or server/vehicles frame on each allocation's stack.
  const walk = (node, stack) => {
    const next = own(node.callFrame) ? frameKey(node.callFrame) : stack;
    if (node.selfSize) { total += node.selfSize; const k = frameKey(node.callFrame); self.set(k, (self.get(k) ?? 0) + node.selfSize); site.set(next ?? '(outside server)', (site.get(next ?? '(outside server)') ?? 0) + node.selfSize); }
    for (const c of node.children) walk(c, next);
  };
  walk(profile.head, null);
  const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, b]) => ({ at: k, mib: Math.round(b / 1048576 * 10) / 10, pct: Math.round(1000 * b / total) / 10 }));
  captures += 1;
  send({ type: 'heap-profile', label, capture: captures, usedBeforeGcMiB: Math.round(before / 1048576), usedMiB: Math.round(used / 1048576), forcedGc: typeof globalThis.gc === 'function', sampledLiveMiB: Math.round(total / 1048576), topSelf: top(self), topSite: top(site) });
}
// Capture at each step boundary the job reports (the 1 s interval rarely fires: the replay seldom yields to the loop).
parentPort.postMessage = (message, ...rest) => { if (message?.type === 'progress') { try { capture(`progress ${message.completed}/${message.total} ${message.route} ${message.seed}`); } catch { /* best effort */ } } return send(message, ...rest); };
const timer = setInterval(() => { try { capture('interval'); } catch { /* best effort */ } }, 1000); timer.unref();
await import(new URL('../../../../server/gcsp/comparison/worker.js', import.meta.url).href);
clearInterval(timer);
