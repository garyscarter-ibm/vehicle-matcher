import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { isMainThread, parentPort, threadId } from 'node:worker_threads';

// Diagnostic only. No graph traversal, copied rows, retained strong roots, forced GC or extra yields.
const root = '/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-10-GC-027/server/gcsp/';
const started = performance.now();
const refs = new Map();
let planWasSent = false; let route = null; let points = 0; let preparing = false; let transactions = 0; let claimReturns = 0;
const sha = (source) => createHash('sha256').update(source).digest('hex');
const remember = (key, value) => { if (value && typeof value === 'object') refs.set(key, new WeakRef(value)); };
function point(label, extra = {}) {
  if (++points > 256) throw new Error('FUCQ309 diagnostic observation cap exceeded');
  const data = { type: 'fucq309-diagnostic', threadId, route, label, elapsedMs: performance.now() - started,
    observedAt: new Date().toISOString(), heap: process.memoryUsage(), transactions,
    weakAlive: Object.fromEntries([...refs].map(([key, reference]) => [key, Boolean(reference.deref())])), ...extra };
  writeSync(2, JSON.stringify(data) + '\n');
  if (planWasSent && label !== 'source-hook') parentPort?.postMessage(data);
}
globalThis.__fucq309FirstBuddy = {
  planSent() { planWasSent = true; point('worker-plan-sent'); },
  route(label, value, inputs) {
    route = value;
    if (inputs) point(label, { seed: inputs.manifest.seed, inputHash: inputs.manifest.inputHash,
      policyHash: inputs.manifest.policyHash, employees: inputs.employees.length, stock: inputs.stock.length });
    else point(label);
  },
  store(store) { remember(`${route}-store`, store); },
  pool(pool) { remember(`${route}-pool`, pool); },
  point,
  prepare() { if (route === 'buddy') { preparing = true; point('allocation-prepare-start'); } },
  snapshot(rows) { if (preparing) { remember('snapshot', rows); point('allocation-snapshot-loaded'); } },
  employee(count) { if (preparing && count % 128 === 0) point('prepare-employees', { count }); },
  prepared(planned, plan, slices) {
    if (!preparing) return;
    remember('planned-wrapper', planned); remember('prepared-plan', plan); remember('prepared-slices', slices);
    point('allocation-prepared', { contenders: plan.contenders.length, employees: plan.evaluatedEmployees.length, slices: slices.length });
  },
  transaction(label) {
    if (!preparing) return;
    if (label === 'backend-work-start') transactions++;
    point(label);
  },
  recorded(recorded) { if (preparing) point('prepare-helper-returned', { status: recorded.status, marker: recorded.value?.prepared }); },
  receipt(projection, immutablePlan, row, checked) {
    if (!preparing || checked.status !== 'ok') return;
    point('allocation-receipt-return', { projection, immutablePlan, returnsStoredRow: immutablePlan,
      storedRowFrozen: Object.isFrozen(row), storedPlanFrozen: Boolean(row?.outcome?.value?.plan && Object.isFrozen(row.outcome.value.plan)),
      projectedValueKeys: projection === 'quote-inputs' ? Object.keys(checked.value.outcome.value) : undefined });
  },
  cache(value) { if (preparing) point('quote-cache-added', { keys: Object.keys(value), evaluationPresent: Object.hasOwn(value, 'evaluation') }); },
  claimed(outcome, candidate) {
    if (!preparing || ++claimReturns !== 1) return;
    point('first-claim-returned', { outcomeStatus: outcome?.status, employeeId: candidate.employeeId, orderUuid: candidate.orderUuid });
    // The allocator converts this injected stop to unavailable; the actual worker then closes its run normally.
    throw new Error('FUCQ309 diagnostic stop after first canonical buddy claim return');
  },
};
function replace(source, anchor, next, url) {
  if (source.split(anchor).length !== 2) throw new Error(`First-buddy observer anchor not unique: ${url}: ${anchor.slice(0, 70)}`);
  return source.replace(anchor, next);
}
if (!isMainThread) registerHooks({ load(url, context, nextLoad) {
  const loaded = nextLoad(url, context);
  let source = loaded.source?.toString();
  if (!source || !url.startsWith(`file://${root}`)) return loaded;
  const before = source;
  if (url.endsWith('/comparison/worker.js')) {
    const anchor = "port.postMessage({ type: 'plan', steps: plan.steps, seeds: [...plan.seeds], arms: plan.arms.map((arm) => arm.armId) });";
    source = replace(source, anchor, anchor + ' globalThis.__fucq309FirstBuddy.planSent();', url);
  }
  if (url.endsWith('/comparison/experiments.js')) {
    const anchor = 'const run = await openComparisonRun({ inputs, policy: armPolicy, route, codeRevision, evaluation });';
    source = replace(source, anchor, "globalThis.__fucq309FirstBuddy.route('route-open-before', route, inputs); " + anchor + " globalThis.__fucq309FirstBuddy.route('run-ready', route);", url);
    source = replace(source, '} finally { await run.close(); }', "} finally { await run.close(); globalThis.__fucq309FirstBuddy.route('route-closed', route); }", url);
  }
  if (url.endsWith('/comparison/private-repository.js')) {
    source = replace(source, 'let nextId = 0;', 'let nextId = 0; globalThis.__fucq309FirstBuddy.pool(pool);', url);
    source = replace(source, 'let committed = store.state;', 'let committed = store.state; globalThis.__fucq309FirstBuddy.store(store);', url);
    source = replace(source, 'const { commit, outcome } = await work(draft);', "globalThis.__fucq309FirstBuddy.transaction('backend-work-start'); const { commit, outcome } = await work(draft); globalThis.__fucq309FirstBuddy.transaction('backend-work-complete');", url);
    source = replace(source, 'store.state = draft;', "globalThis.__fucq309FirstBuddy.transaction('normalize-start'); store.state = draft; globalThis.__fucq309FirstBuddy.transaction('normalize-end');", url);
    source = replace(source, "return immutablePlan && checked.status === 'ok' ? ok(row) : checked;", "globalThis.__fucq309FirstBuddy.receipt(projection, immutablePlan, row, checked); return immutablePlan && checked.status === 'ok' ? ok(row) : checked;", url);
  }
  if (url.endsWith('/allocation/index.js')) {
    source = replace(source, 'async function prepare(context, event, instant, assumptions) {', 'async function prepare(context, event, instant, assumptions) { globalThis.__fucq309FirstBuddy.prepare();', url);
    source = replace(source, "if (loaded.status !== 'ok') return loaded;", "if (loaded.status !== 'ok') return loaded; globalThis.__fucq309FirstBuddy.snapshot(rows);", url);
    source = replace(source, 'plan.evaluatedEmployees.push(employee.employeeId);', 'plan.evaluatedEmployees.push(employee.employeeId); globalThis.__fucq309FirstBuddy.employee(plan.evaluatedEmployees.length);', url);
    source = replace(source, 'const { plan: prepared, slices } = planned.value;', 'const { plan: prepared, slices } = planned.value; globalThis.__fucq309FirstBuddy.prepared(planned, prepared, slices);', url);
    source = replace(source, "if (recorded.status !== 'ok') return recorded;", "if (recorded.status !== 'ok') return recorded; globalThis.__fucq309FirstBuddy.recorded(recorded);", url);
    source = replace(source, 'sliceRows.set(contender.employeeId, { quotes, quoteInputs });', 'sliceRows.set(contender.employeeId, { quotes, quoteInputs }); globalThis.__fucq309FirstBuddy.cache(sliceRows.get(contender.employeeId));', url);
    const claim = 'const outcome = await claim.tryClaim(resolved.value, { ...candidate, operationId, eventId: event.eventId, runId: context.runId });';
    source = replace(source, claim, claim + ' globalThis.__fucq309FirstBuddy.claimed(outcome, candidate);', url);
  }
  if (source !== before) point('source-hook', { url, originalSha256: sha(before), diagnosticSha256: sha(source) });
  return { ...loaded, source };
} });
