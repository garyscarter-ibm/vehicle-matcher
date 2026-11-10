import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { isMainThread } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

// PLAN ONLY until the parent separately authorises launch. No business object is passed here.
const ROOT = '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027/';
const started = performance.now();
let targetRoute = false, selected = false, recording = false, finished = false;
let sequence = 0, sliceCount = 0, totalSlices = 0, contenderCount = 0;
let disabled = false;
function point(label, status = '', commit = false) {
  if (disabled || sequence >= 60) return;
  const data = { type: 'fucq309-preparation-scalars', sequence: ++sequence, label,
    elapsedMs: performance.now() - started, wallAt: new Date().toISOString(),
    seed: 'comparison-a', route: 'buddy', sliceCount, totalSlices, contenderCount, status, commit };
  try { writeSync(2, JSON.stringify(data) + '\n'); } catch { disabled = true; }
}
globalThis.__fucq309PreparationScalars = {
  routeBefore(seed, route, inputHash, policyHash, employees, cars) {
    targetRoute = seed === 'comparison-a' && route === 'buddy';
    if (!targetRoute) return;
    point('route-open-before');
    // All arguments are primitives. No input, run, repository, plan, slice or outcome graph is retained.
    try { writeSync(2, JSON.stringify({ type: 'fucq309-preparation-identity', seed, route, inputHash, policyHash, employees, cars }) + '\n'); }
    catch { disabled = true; }
  },
  routeReady() { if (targetRoute) point('run-ready'); },
  routeClosed() { if (targetRoute) point('route-closed'); targetRoute = false; },
  prepareEnter() { if (targetRoute && !selected && !finished) { selected = true; point('preparation-function-enter'); } },
  prepared(slices, contenders) { if (!targetRoute || !selected || recording || finished) return;
    totalSlices = slices; contenderCount = contenders; sliceCount = 0; recording = true; point('preparation-built'); },
  phase(label, status = '') { if (targetRoute && recording && !finished) point(label, status); },
  sliceComplete(status) { if (!targetRoute || !recording || finished) return;
    sliceCount++;
    if (sliceCount === 1 || sliceCount % 128 === 0 || sliceCount === totalSlices || status !== 'ok') point('evaluation-slice-complete', status); },
  backend(label, commit = false) { if (targetRoute && recording && !finished) point(label, '', commit); },
  helperReturned(status) { if (targetRoute && selected && !finished) { point('prepare-helper-returned', status); finished = true; recording = false; } },
};
const sha = (source) => createHash('sha256').update(source).digest('hex');
if (!isMainThread) {
  const transforms = JSON.parse(readFileSync(new URL('./transforms.json', import.meta.url), 'utf8')).files;
  const byUrl = new Map(transforms.map((item) => [pathToFileURL(ROOT + item.path).href, item]));
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context), definition = byUrl.get(url);
    if (!definition) return loaded;
    let source = loaded.source?.toString();
    if (!source || sha(source) !== definition.originalSha256) throw new Error('Diagnostic source identity mismatch: ' + url);
    for (const item of definition.replacements) {
      if (source.split(item.anchor).length !== item.requiredAnchorCount + 1) throw new Error('Diagnostic anchor mismatch: ' + item.label);
      source = source.replace(item.anchor, item.replacement);
    }
    if (sha(source) !== definition.diagnosticSha256) throw new Error('Diagnostic transformed identity mismatch: ' + url);
    // Never post diagnostics to the production worker message protocol.
    try { writeSync(2, JSON.stringify({ type: 'fucq309-source-transform', url, originalSha256: definition.originalSha256,
      diagnosticSha256: definition.diagnosticSha256 }) + '\n'); } catch { disabled = true; }
    return { ...loaded, source };
  } });
}
