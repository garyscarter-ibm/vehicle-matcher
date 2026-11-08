import { inputDigest, ok, result } from '../repository/core.js';

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

/** Appends one immutable result row; storing the same result again changes nothing. */
export async function storeComparisonResult(repository, context, outcome) {
  if (!outcome || outcome.kind !== 'process-comparison' || typeof outcome.completedAt !== 'string' || !outcome.manifest
    || !Array.isArray(outcome.perSeed) || typeof outcome.manifest.policyVersion !== 'string') return invalid('result', 'Expected a process-comparison result');
  const scope = scopeOf(context);
  const run = await ensureResultsRun(repository, scope, outcome.completedAt);
  if (run.status !== 'ok') return run;
  const resultId = `process-comparison-${inputDigest({ completedAt: outcome.completedAt, manifest: outcome.manifest, perSeed: outcome.perSeed }).slice(0, 32)}`;
  const row = { runId: COMPARISON_RESULTS_RUN, resultId, experimentId: outcome.experimentId, kind: outcome.kind,
    completedAt: outcome.completedAt, policyVersion: outcome.manifest.policyVersion, manifest: outcome.manifest, result: outcome };
  return repository.transaction(scope, command(`store-comparison-result:${resultId}`, { resultId, digest: inputDigest(outcome) }), async (tx) => {
    const saved = await tx.insert(TABLE, row);
    return saved.status === 'ok' ? ok({ resultId, completedAt: row.completedAt, policyVersion: row.policyVersion, storedAt: saved.value.createdAt }) : saved;
  });
}

/** The latest stored process-comparison result and whether its policy version is still the active one. */
export async function readLatestComparisonResult(repository, context, policy, { asOf } = {}) {
  const rows = await repository.query(scopeOf(context), TABLE);
  if (rows.status !== 'ok') return rows;
  const latest = rows.value.filter((row) => row.kind === 'process-comparison')
    .sort((a, b) => (a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : a.resultId < b.resultId ? 1 : -1))[0];
  if (!latest) return result('not-found', { resourceType: TABLE });
  const active = await policy.getActiveVersion({ runId: COMPARISON_RESULTS_RUN, asOf });
  if (active.status !== 'ok') return active;
  return ok({ result: latest.result, resultId: latest.resultId, storedAt: latest.createdAt, policyVersion: latest.policyVersion,
    activePolicyVersion: active.policyVersion, policyCurrent: active.policyVersion === latest.policyVersion });
}
