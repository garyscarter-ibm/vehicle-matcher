import { inputDigest } from '../repository/core.js';
import { loadComparisonPolicy, generateComparisonInputs } from './generator.js';
import { evaluateComparisonSeed } from './evaluation.js';
import { openComparisonRun, comparisonAssumption, ComparisonRunError } from './harness.js';
import { replayCurrentRoute } from './routes/current.js';
import { replayBuddyRoute } from './routes/buddy.js';
import { routeMeasures, summariseSeeds, compareRoutes, MEASURE_NAMES, RULE_KEY } from './measures.js';
import { freezeVehicleData } from '../../vehicles/index.js';

export const PROCESS_EXPERIMENT_ID = 'process-only';
export const PROCESS_COMPARISON_CAVEAT = 'Calculated fit is not observed satisfaction.';
const ROUTES = Object.freeze({ current: replayCurrentRoute, buddy: replayBuddyRoute });
const refuse = (boundary) => { throw new ComparisonRunError('invalid-input', boundary); };
const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** A route record's digest over its content; the code revision is provenance and stays out (FUCQ-242). */
export const outcomeRecordDigest = ({ codeRevision, ...content }) => inputDigest(content);
const assumptionRow = (row) => ({ key: row.key, value: structuredClone(row.value), unit: row.unit, status: row.status,
  basis: row.basis, source: row.source, policyVersion: row.policyVersion });

function routeSummary(perSeed, route) {
  const scalar = Object.fromEntries(MEASURE_NAMES.filter((name) => name !== 'accessGroupCoverage')
    .map((name) => [name, summariseSeeds(perSeed.map((seed) => seed.routes[route].measures[name]))]));
  const groups = [...new Set(perSeed.flatMap((seed) => Object.keys(seed.routes[route].measures.accessGroupCoverage)))].sort();
  return { ...scalar, accessGroupCoverage: Object.fromEntries(groups.map((id) =>
    [id, summariseSeeds(perSeed.map((seed) => seed.routes[route].measures.accessGroupCoverage[id]))])) };
}

/**
 * Runs both routes for every seed on identical inputs and returns one frozen, explainable result.
 * Only the process changes here; order-mix, points and hold sweeps are FUCQ-174.
 */
export async function runComparison(experiment, { policy, codeRevision, now = () => new Date().toISOString(), onRecord } = {}) {
  if (!experiment || Object.keys(experiment).some((key) => !['experimentId', 'seeds', 'overlay'].includes(key))
    || experiment.experimentId !== PROCESS_EXPERIMENT_ID) refuse('experimentId');
  const overlay = experiment.overlay ?? {};
  const runId = 'comparison-experiment-preparation';
  const probe = await policy.getAssumption('comparison.startsAt', { runId, asOf: now() });
  if (probe.status !== 'ok') throw new ComparisonRunError(probe.status, 'comparison.startsAt');
  const snapshot = await loadComparisonPolicy({ policyService: policy, policyRead: { runId, asOf: probe.value.value } });
  const seeds = structuredClone(experiment.seeds ?? snapshot.assumptions['comparison.seeds'].value);
  if (!Array.isArray(seeds) || seeds.length === 0 || new Set(seeds).size !== seeds.length) refuse('seeds');
  const ruleRow = await comparisonAssumption(policy, RULE_KEY, { runId, asOf: snapshot.assumptions['comparison.startsAt'].value,
    policyVersion: snapshot.policyVersion });

  const perSeed = [];
  const assumptions = new Map([[ruleRow.key, assumptionRow(ruleRow)]]);
  const limitations = new Set();
  let identity;
  for (const seed of seeds) {
    const inputs = generateComparisonInputs(seed, snapshot, { overlay });
    const evaluation = await evaluateComparisonSeed({ inputs, policy });
    const { manifest } = inputs;
    identity ??= { policyVersion: manifest.policyVersion, policyHash: manifest.policyHash, generatorVersion: manifest.generatorVersion };
    if (Object.entries(identity).some(([key, value]) => manifest[key] !== value)) refuse('manifest');
    const routes = {};
    for (const [route, replay] of Object.entries(ROUTES)) {
      const run = await openComparisonRun({ inputs, policy, route, codeRevision, evaluation });
      try {
        const record = await replay(run);
        if (record.route !== route || record.seed !== seed || record.inputHash !== manifest.inputHash
          || record.policyVersion !== manifest.policyVersion) refuse('outcome-record');
        if (onRecord) await onRecord(record);
        for (const row of record.assumptions) if (!assumptions.has(row.key)) assumptions.set(row.key, assumptionRow(row));
        for (const line of record.limitations) limitations.add(line);
        routes[route] = { measures: routeMeasures(record), totals: structuredClone(record.totals), recordDigest: outcomeRecordDigest(record) };
      } finally { await run.close(); }
    }
    perSeed.push({ seed, inputHash: manifest.inputHash, routes });
  }
  const differences = compareRoutes(perSeed.map((entry) => ({ seed: entry.seed, current: entry.routes.current.measures,
    buddy: entry.routes.buddy.measures })), ruleRow);
  return freezeVehicleData({
    schemaVersion: 1, kind: 'process-comparison', experimentId: PROCESS_EXPERIMENT_ID, completedAt: now(),
    manifest: { experimentId: PROCESS_EXPERIMENT_ID, seeds, policyVersion: identity.policyVersion, policyHash: identity.policyHash,
      generatorVersion: identity.generatorVersion, overlays: structuredClone(overlay), codeRevision,
      inputHashes: Object.fromEntries(perSeed.map((entry) => [entry.seed, entry.inputHash])) },
    perSeed,
    measures: { current: routeSummary(perSeed, 'current'), buddy: routeSummary(perSeed, 'buddy') },
    differences,
    rule: { key: ruleRow.key, value: structuredClone(ruleRow.value), status: ruleRow.status, basis: ruleRow.basis,
      source: ruleRow.source, policyVersion: ruleRow.policyVersion },
    assumptions: [...assumptions.values()].sort(byKey),
    caveat: PROCESS_COMPARISON_CAVEAT,
    limitations: [...limitations],
  });
}
