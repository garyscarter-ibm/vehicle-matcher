import { inputDigest, ok, result } from '../repository/core.js';
import { EXPERIMENT_IDS, PROCESS_EXPERIMENT_ID } from './experiments.js';

// Own environment: a live demo reset (FUCQ-85) retires only the live environment's current run.
export const COMPARISON_RESULTS_ENVIRONMENT = 'comparison-results';
export const COMPARISON_RESULTS_RUN = 'comparison-results-v1';
const TABLE = 'comparison_results';
const command = (commandId, input) => ({ commandId, inputDigest: inputDigest(input) });
const scopeOf = (context) => ({ runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT,
  principalId: context?.principalId, roles: Array.isArray(context?.roles) ? [...context.roles] : [] });
const invalid = (field, reason) => result('invalid', { code: 'invalid-result', reasons: [{ field, reason }] });

async function ensureResultsRun(repository, scope, startedAt) {
  const current = await repository.currentRun(COMPARISON_RESULTS_ENVIRONMENT);
  if (current.status === 'ok') return current.value.runId === COMPARISON_RESULTS_RUN ? ok(current.value) : result('conflict', { reason: 'unexpected-results-run' });
  if (current.status !== 'not-found') return current;
  const created = await repository.resetRun(scope, command('comparison-results-bootstrap', { runId: COMPARISON_RESULTS_RUN }), {
    expectedCurrentRunId: null, rows: [], nextRun: { runId: COMPARISON_RESULTS_RUN, environmentId: COMPARISON_RESULTS_ENVIRONMENT,
      status: 'active', current: true, scenarioVersion: COMPARISON_RESULTS_RUN, fixtureVersion: COMPARISON_RESULTS_RUN,
      corpusVersion: COMPARISON_RESULTS_RUN, policyVersion: 'not-applicable', clockInstant: startedAt, clockVersion: '1',
      versions: { comparisonResults: COMPARISON_RESULTS_RUN } } });
  if (created.status === 'ok') return created;
  // A concurrent first store may have created it already.
  const again = await repository.currentRun(COMPARISON_RESULTS_ENVIRONMENT);
  return again.status === 'ok' && again.value.runId === COMPARISON_RESULTS_RUN ? ok(again.value) : created;
}

/** Appends one immutable result row (process or what-if); storing the same result again changes nothing. */
export async function storeComparisonResult(repository, context, outcome) {
  const isProcess = outcome?.kind === 'process-comparison';
  const whatIf = outcome?.kind === 'experiment-comparison' && EXPERIMENT_IDS.includes(outcome.experimentId) && outcome.experimentId !== PROCESS_EXPERIMENT_ID;
  if (!outcome || !(isProcess || whatIf) || typeof outcome.completedAt !== 'string' || !outcome.manifest
    || typeof outcome.manifest.policyVersion !== 'string' || !(isProcess ? Array.isArray(outcome.perSeed) : Array.isArray(outcome.arms) && outcome.arms.length > 0)) {
    return invalid('result', 'Expected a process-comparison or experiment-comparison result');
  }
  const scope = scopeOf(context);
  const run = await ensureResultsRun(repository, scope, outcome.completedAt);
  if (run.status !== 'ok') return run;
  const resultId = isProcess
    ? `process-comparison-${inputDigest({ completedAt: outcome.completedAt, manifest: outcome.manifest, perSeed: outcome.perSeed }).slice(0, 32)}`
    : `${outcome.experimentId}-comparison-${inputDigest({ completedAt: outcome.completedAt, manifest: outcome.manifest, arms: outcome.arms }).slice(0, 32)}`;
  const row = { runId: COMPARISON_RESULTS_RUN, resultId, experimentId: outcome.experimentId, kind: outcome.kind,
    completedAt: outcome.completedAt, policyVersion: outcome.manifest.policyVersion, manifest: outcome.manifest, result: outcome };
  return repository.transaction(scope, command(`store-comparison-result:${resultId}`, { resultId, digest: inputDigest(outcome) }), async (tx) => {
    const saved = await tx.insert(TABLE, row);
    return saved.status === 'ok' ? ok({ resultId, completedAt: row.completedAt, policyVersion: row.policyVersion, storedAt: saved.value.createdAt }) : saved;
  });
}

const newer = (a, b) => (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : a.resultId < b.resultId ? 1 : -1);
const latestOf = (rows, experimentId) => rows.filter((row) => row.experimentId === experimentId
  && row.kind === (experimentId === PROCESS_EXPERIMENT_ID ? 'process-comparison' : 'experiment-comparison')).sort(newer)[0];
const readOf = (row, active) => ({ result: row.result, resultId: row.resultId, storedAt: row.createdAt, policyVersion: row.policyVersion,
  activePolicyVersion: active.policyVersion, policyCurrent: active.policyVersion === row.policyVersion });

/** The latest stored result of one experiment (default process-only) and whether its policy version is still active. */
export async function readLatestComparisonResult(repository, context, policy, { asOf, experimentId = PROCESS_EXPERIMENT_ID } = {}) {
  if (!EXPERIMENT_IDS.includes(experimentId)) return invalid('experimentId', 'Expected a known comparison experiment id');
  const rows = await repository.query(scopeOf(context), TABLE);
  if (rows.status !== 'ok') return rows;
  const latest = latestOf(rows.value, experimentId);
  if (!latest) return result('not-found', { resourceType: TABLE });
  const active = await policy.getActiveVersion({ runId: COMPARISON_RESULTS_RUN, asOf });
  if (active.status !== 'ok') return active;
  return ok(readOf(latest, active));
}

/** The latest stored result for every experiment id, in EXPERIMENT_IDS order, with null where none is stored. */
export async function readLatestComparisonResults(repository, context, policy, { asOf } = {}) {
  const rows = await repository.query(scopeOf(context), TABLE);
  if (rows.status !== 'ok') return rows;
  const active = await policy.getActiveVersion({ runId: COMPARISON_RESULTS_RUN, asOf });
  if (active.status !== 'ok') return active;
  const experiments = EXPERIMENT_IDS.map((experimentId) => {
    const latest = latestOf(rows.value, experimentId);
    return { experimentId, latest: latest ? readOf(latest, active) : null };
  });
  return ok({ activePolicyVersion: active.policyVersion, experiments });
}
