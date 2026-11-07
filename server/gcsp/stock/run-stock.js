import { ok, result } from '../repository/index.js';
import { loadScenarioCatalogue } from '../fixtures/scenarios/index.js';
import { STOCK_GENERATOR_NAMESPACE } from '../vehicle-evidence/stock-generator.js';
import { createDemoStockProvider, DEMO_STOCK_NAMESPACE } from './demo-provider.js';
import { createGeneratedStockProvider } from './generated-provider.js';
import { createDemoStockGeneration } from './run-stock-generation.js';

const unavailable = () => result('unavailable', { reason: 'Stock source is unavailable.', retryable: true });
const holds = (rows, namespace) => rows.some((row) => row.facts?.sourceNamespace === namespace);

/** Pull-port source that picks each run's stock source once: demo stock for scenario replays and runs already on it,
 * otherwise generated stock, falling back to demo stock (reason logged) when generation is unavailable. */
export function createRunStockProvider({ policy, repository, contextForRun, generation, logger = console.warn } = {}) {
  if (typeof repository?.query !== 'function' || typeof repository?.read !== 'function') throw new TypeError('Inject the repository read port.');
  const demo = createDemoStockProvider({ policy });
  const generated = createGeneratedStockProvider({ repository, contextForRun });
  const decisions = new Map(); const pending = new Map();

  async function choose(runId) {
    const context = await contextForRun(runId);
    if (context?.runId !== runId) return unavailable();
    const found = await repository.read(context, { table: 'runs', key: { runId } });
    const rows = found.status === 'ok' ? await repository.query(context, 'stock') : found;
    if (found.status !== 'ok' || rows.status !== 'ok') return unavailable();
    const run = found.value;
    if (holds(rows.value, DEMO_STOCK_NAMESPACE)) return ok({ source: 'demo', reason: 'The run already holds demo stock.' });
    const selected = run.versions?.scenarioSelection;
    if (selected) {
      const catalogue = await loadScenarioCatalogue({ policy, read: { runId, asOf: run.clockInstant, policyVersion: run.policyVersion } });
      if (catalogue.status !== 'ok') return unavailable();
      const scenario = catalogue.value.scenarios.find((row) => row.scenarioId === selected.scenarioId);
      if (scenario?.inputs?.stockTranches?.some((row) => row.source === 'published-demo-stock')) {
        return ok({ source: 'demo', reason: 'The scenario replays published demo stock.' });
      }
    }
    if (holds(rows.value, STOCK_GENERATOR_NAMESPACE)) return ok({ source: 'generated', reason: 'The run holds generated stock.' });
    const outcome = typeof generation?.generate === 'function' ? await generation.generate(run)
      : result('unavailable', { code: 'generation-not-configured' });
    if (outcome.status === 'ok') return ok({ source: 'generated', reason: 'Stock generated for the run.' });
    const reason = `Stock generation ${outcome.status}${outcome.code ?? outcome.reason ? ` (${outcome.code ?? outcome.reason})` : ''}.`;
    try { logger(`GCSP stock: run ${runId} uses demo stock. ${reason}`); } catch { /* logging is best effort */ }
    return ok({ source: 'demo', reason });
  }
  function decide(runId) {
    if (decisions.has(runId)) return Promise.resolve(decisions.get(runId));
    if (!pending.has(runId)) {
      pending.set(runId, (async () => {
        try {
          const outcome = await choose(runId);
          if (outcome.status === 'ok') decisions.set(runId, outcome);
          return outcome;
        } catch { return unavailable(); } finally { pending.delete(runId); }
      })());
    }
    return pending.get(runId);
  }
  return Object.freeze({
    async pull(request) {
      if (typeof request?.runId !== 'string' || !request.runId || typeof contextForRun !== 'function') return unavailable();
      const decision = await decide(request.runId);
      if (decision.status !== 'ok') return decision;
      return (decision.value.source === 'generated' ? generated : demo).pull(request);
    },
    /** Makes the run's decision now, generating its stock when it is a generated run. Never throws. */
    async prepareRun(runId) {
      if (typeof runId !== 'string' || !runId || typeof contextForRun !== 'function') return unavailable();
      return decide(runId);
    },
    /** The decided source for a run, or null before it is decided. */
    describe(runId) { return decisions.get(runId)?.value ?? null; },
  });
}

/** Provider factory for the runtime: GCSP_STOCK_SOURCE=demo forces demo stock; otherwise the per-run chooser. */
export function createRunStockProviderFactory({ env = process.env, logger, generation } = {}) {
  const factory = (deps) => {
    const forced = env.GCSP_STOCK_SOURCE === 'demo';
    factory.provider = forced ? createDemoStockProvider(deps) : createRunStockProvider({ ...deps, logger,
      generation: generation ?? createDemoStockGeneration({ ...deps, env }) });
    factory.forced = forced;
    return factory.provider;
  };
  return factory;
}
