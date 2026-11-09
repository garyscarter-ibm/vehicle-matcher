import { inputDigest } from '../repository/core.js';
import { loadComparisonPolicy, generateComparisonInputs, ComparisonInputError } from './generator.js';
import { evaluateComparisonSeed } from './evaluation.js';
import { openComparisonRun, comparisonAssumption, ComparisonRunError } from './harness.js';
import { replayCurrentRoute } from './routes/current.js';
import { replayBuddyRoute } from './routes/buddy.js';
import { routeMeasures, summariseSeeds, compareRoutes, compareArms, MEASURE_NAMES, RULE_KEY } from './measures.js';
import { freezeVehicleData } from '../../vehicles/index.js';

export const PROCESS_EXPERIMENT_ID = 'process-only';
export const PROCESS_COMPARISON_CAVEAT = 'Calculated fit is not observed satisfaction.';
/** The caveat every experiment result carries; the same fixed text as the process comparison. */
export const EXPERIMENT_CAVEAT = PROCESS_COMPARISON_CAVEAT;
/** The experiment ids runComparison and validateExperiment accept. */
export const EXPERIMENT_IDS = Object.freeze(['process-only', 'order-mix', 'points', 'hold-sweep']);
export const EXPERIMENTS_KEY = 'comparison.experiments.v1';
const POINTS_KEY = 'comparison.pointsAllowanceMultiplier';
const WHAT_IF_LIMITATION = 'What-if experiment: the changed values were never published as live policy.';
/** The policy key each what-if experiment changes. */
export const EXPERIMENT_KEYS = Object.freeze({ 'order-mix': 'comparison.modelLineMix', points: POINTS_KEY, 'hold-sweep': 'hold.buddy.durationSeconds' });
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

const text = (value) => typeof value === 'string' && value.trim().length > 0;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const sameValue = (a, b) => inputDigest(a) === inputDigest(b);

// The run sees scaled allowances, so employee.pointsAllowance and getAllowance agree (the harness checks it).
function scaledPolicy(policy, multiplier) {
  return new Proxy(policy, { get(target, name) {
    if (name === 'getAllowance') {
      return async (...args) => {
        const result = await target.getAllowance(...args);
        return result?.status === 'ok' ? { ...result, value: { ...result.value, monthlyPoints: result.value.monthlyPoints * multiplier } } : result;
      };
    }
    const member = target[name];
    return typeof member === 'function' ? member.bind(target) : member;
  } });
}

async function prepare(experiment, { policy, now = () => new Date().toISOString() } = {}) {
  const id = experiment?.experimentId;
  const extra = id === PROCESS_EXPERIMENT_ID ? [] : ['change'];
  if (!plain(experiment) || !EXPERIMENT_IDS.includes(id)
    || Object.keys(experiment).some((key) => !['experimentId', 'seeds', 'overlay', ...extra].includes(key))) refuse('experimentId');
  if (experiment.overlay !== undefined && !plain(experiment.overlay)) refuse('overlay');
  const overlay = experiment.overlay ?? {};
  const runId = 'comparison-experiment-preparation';
  const probe = await policy.getAssumption('comparison.startsAt', { runId, asOf: now() });
  if (probe.status !== 'ok') throw new ComparisonRunError(probe.status, 'comparison.startsAt');
  const snapshot = await loadComparisonPolicy({ policyService: policy, policyRead: { runId, asOf: probe.value.value } });
  const seeds = structuredClone(experiment.seeds ?? snapshot.assumptions['comparison.seeds'].value);
  if (!Array.isArray(seeds) || seeds.length === 0 || new Set(seeds).size !== seeds.length) refuse('seeds');
  const read = { runId, asOf: snapshot.assumptions['comparison.startsAt'].value, policyVersion: snapshot.policyVersion };
  const ruleRow = await comparisonAssumption(policy, RULE_KEY, read);
  if (id === PROCESS_EXPERIMENT_ID) {
    const plan = freezeVehicleData({ experimentId: id, seeds, arms: [{ armId: 'process', value: null, overlay: structuredClone(overlay) }],
      steps: seeds.length * 2 });
    return { plan, snapshot, ruleRow, overlay };
  }

  const definitionRow = await comparisonAssumption(policy, EXPERIMENTS_KEY, read);
  const definition = definitionRow.value?.experiments?.[id];
  if (definitionRow.value?.schemaVersion !== 1 || !plain(definition) || definition.key !== EXPERIMENT_KEYS[id] || !text(definition.unit)
    || (id !== 'order-mix' && !(Number.isFinite(definition.minimum) && Number.isFinite(definition.maximum) && definition.minimum <= definition.maximum))
    || (id === 'hold-sweep' && !(Number.isSafeInteger(definition.maximumValues) && definition.maximumValues >= 1))) refuse(EXPERIMENTS_KEY);
  const baseline = snapshot.assumptions[definition.key];
  if (!baseline || baseline.unit !== definition.unit) refuse(definition.key);
  if (Object.hasOwn(overlay, definition.key)) refuse('overlay');

  const { change } = experiment;
  const sweep = id === 'hold-sweep';
  if (!plain(change) || Object.keys(change).some((key) => !['basis', sweep ? 'values' : 'value'].includes(key))
    || !Object.hasOwn(change, sweep ? 'values' : 'value')) refuse('change');
  if (!text(change.basis)) refuse('basis');
  const values = sweep ? change.values : [change.value];
  if (!Array.isArray(values) || (sweep && (values.length < 1 || values.length > definition.maximumValues
    || new Set(values).size !== values.length || !values.every(Number.isSafeInteger)))) refuse('change');
  for (const value of values) {
    if (id !== 'order-mix' && !inRange(value, definition.minimum, definition.maximum)) refuse(definition.key);
    if (sameValue(value, baseline.value)) refuse(definition.key);
  }

  const arms = [{ armId: 'baseline', value: structuredClone(baseline.value), overlay: structuredClone(overlay) },
    ...values.map((value) => ({ armId: sweep ? `hold-${value}` : 'variant', value: structuredClone(value),
      overlay: { ...structuredClone(overlay), [definition.key]: structuredClone(value) } }))];
  // Generate once per arm that is not a hold change, so a bad mix or overlay is refused before any replay.
  for (const arm of sweep ? arms.slice(0, 1) : arms) {
    try { generateComparisonInputs(seeds[0], snapshot, { overlay: arm.overlay }); } catch (error) {
      if (error instanceof ComparisonInputError) refuse(error.key ?? 'overlay');
      throw error;
    }
  }
  const plan = freezeVehicleData({ experimentId: id, seeds, arms, steps: arms.length * seeds.length * 2 });
  const changeInfo = { key: definition.key, unit: definition.unit, status: 'what-if', basis: change.basis.trim(),
    baselineValue: structuredClone(baseline.value), baselineBasis: baseline.basis, baselineStatus: baseline.status,
    definitionKey: EXPERIMENTS_KEY, ...(sweep ? { values: structuredClone(values) } : { value: structuredClone(values[0]) }) };
  return { plan, snapshot, ruleRow, definitionRow, changeInfo, overlay, scaled: true };
}

/**
 * Checks an experiment against PolicyService before any replay and returns its frozen plan.
 * Plan: { experimentId, seeds, arms: [{ armId, value, overlay }], steps }; throws ComparisonRunError invalid-input.
 */
export async function validateExperiment(experiment, options = {}) {
  return (await prepare(experiment, options)).plan;
}

// Replays every arm for every seed, current then buddy, one run at a time; hold arms reuse one evaluation per seed.
async function replayArms({ plan, snapshot, policy, scaled, codeRevision, onRecord, onProgress }) {
  const results = plan.arms.map(() => ({ perSeed: [], assumptions: new Map() }));
  const armPolicies = plan.arms.map((arm) => (scaled ? scaledPolicy(policy, arm.overlay[POINTS_KEY] ?? snapshot.assumptions[POINTS_KEY].value) : policy));
  const limitations = new Set();
  let identity;
  let completed = 0;
  for (const seed of plan.seeds) {
    const evaluations = new Map();
    for (const [index, arm] of plan.arms.entries()) {
      const armPolicy = armPolicies[index];
      const inputs = generateComparisonInputs(seed, snapshot, { overlay: arm.overlay });
      const { manifest } = inputs;
      const cacheKey = `${manifest.inputHash}:${scaled ? arm.overlay[POINTS_KEY] ?? '' : ''}`;
      if (!evaluations.has(cacheKey)) evaluations.set(cacheKey, await evaluateComparisonSeed({ inputs, policy: armPolicy }));
      const evaluation = evaluations.get(cacheKey);
      identity ??= { policyVersion: manifest.policyVersion, policyHash: manifest.policyHash, generatorVersion: manifest.generatorVersion };
      if (Object.entries(identity).some(([key, value]) => manifest[key] !== value)) refuse('manifest');
      const routes = {};
      for (const [route, replay] of Object.entries(ROUTES)) {
        const run = await openComparisonRun({ inputs, policy: armPolicy, route, codeRevision, evaluation });
        try {
          const record = await replay(run);
          if (record.route !== route || record.seed !== seed || record.inputHash !== manifest.inputHash
            || record.policyVersion !== manifest.policyVersion) refuse('outcome-record');
          if (onRecord) await onRecord(record, { armId: arm.armId });
          for (const row of record.assumptions) if (!results[index].assumptions.has(row.key)) results[index].assumptions.set(row.key, assumptionRow(row));
          for (const line of record.limitations) limitations.add(line);
          routes[route] = { measures: routeMeasures(record), totals: structuredClone(record.totals), recordDigest: outcomeRecordDigest(record) };
        } finally { await run.close(); }
        completed += 1;
        if (onProgress) await onProgress({ experimentId: plan.experimentId, armId: arm.armId, seed, route, completed, total: plan.steps });
      }
      results[index].perSeed.push({ seed, inputHash: manifest.inputHash, routes });
    }
  }
  return { results, limitations, identity };
}

const armSummary = (perSeed, ruleRow) => ({ perSeed,
  measures: { current: routeSummary(perSeed, 'current'), buddy: routeSummary(perSeed, 'buddy') },
  differences: compareRoutes(perSeed.map((entry) => ({ seed: entry.seed, current: entry.routes.current.measures,
    buddy: entry.routes.buddy.measures })), ruleRow) });
const ruleView = (ruleRow) => ({ key: ruleRow.key, value: structuredClone(ruleRow.value), status: ruleRow.status, basis: ruleRow.basis,
  source: ruleRow.source, policyVersion: ruleRow.policyVersion });

/**
 * Runs an experiment and returns one frozen result: process-only, or a what-if (order-mix, points, hold-sweep).
 * Options: { policy, codeRevision, now, onRecord(record, { armId }), onProgress({ experimentId, armId, seed, route, completed, total }) }.
 */
export async function runComparison(experiment, { policy, codeRevision, now = () => new Date().toISOString(), onRecord, onProgress } = {}) {
  const { plan, snapshot, ruleRow, definitionRow, changeInfo, overlay, scaled } = await prepare(experiment, { policy, now });
  const { results, limitations, identity } = await replayArms({ plan, snapshot, policy, scaled, codeRevision, onRecord, onProgress });
  const manifestBase = { policyVersion: identity.policyVersion, policyHash: identity.policyHash, generatorVersion: identity.generatorVersion };
  if (plan.experimentId === PROCESS_EXPERIMENT_ID) {
    const [{ perSeed, assumptions }] = results;
    assumptions.set(ruleRow.key, assumptionRow(ruleRow));
    return freezeVehicleData({
      schemaVersion: 1, kind: 'process-comparison', experimentId: PROCESS_EXPERIMENT_ID, completedAt: now(),
      manifest: { experimentId: PROCESS_EXPERIMENT_ID, seeds: plan.seeds, ...manifestBase, overlays: structuredClone(overlay), codeRevision,
        inputHashes: Object.fromEntries(perSeed.map((entry) => [entry.seed, entry.inputHash])) },
      perSeed,
      measures: { current: routeSummary(perSeed, 'current'), buddy: routeSummary(perSeed, 'buddy') },
      differences: armSummary(perSeed, ruleRow).differences,
      rule: ruleView(ruleRow),
      assumptions: [...assumptions.values()].sort(byKey),
      caveat: PROCESS_COMPARISON_CAVEAT,
      limitations: [...limitations],
    });
  }
  const assumptions = new Map(results[0].assumptions);
  for (const row of [ruleRow, definitionRow]) assumptions.set(row.key, assumptionRow(row));
  const armResults = plan.arms.map((arm, index) => ({ armId: arm.armId, value: arm.value, ...armSummary(results[index].perSeed, ruleRow) }));
  const baselineSeeds = results[0].perSeed;
  const effects = plan.arms.slice(1).map((arm, offset) => ({ armId: arm.armId, value: arm.value, routes: Object.fromEntries(['current', 'buddy']
    .map((route) => [route, compareArms(baselineSeeds.map((entry, seedIndex) => ({ seed: entry.seed, baseline: entry.routes[route].measures,
      variant: results[offset + 1].perSeed[seedIndex].routes[route].measures })), ruleRow)])) }));
  return freezeVehicleData({
    schemaVersion: 1, kind: 'experiment-comparison', experimentId: plan.experimentId, completedAt: now(),
    manifest: { experimentId: plan.experimentId, seeds: plan.seeds, ...manifestBase, overlays: structuredClone(overlay), codeRevision,
      change: changeInfo,
      arms: plan.arms.map((arm, index) => ({ armId: arm.armId, value: arm.value, overlay: structuredClone(arm.overlay),
        overlayHash: inputDigest(arm.overlay),
        inputHashes: Object.fromEntries(results[index].perSeed.map((entry) => [entry.seed, entry.inputHash])) })) },
    arms: armResults,
    effects,
    rule: ruleView(ruleRow),
    assumptions: [...assumptions.values()].sort(byKey),
    caveat: EXPERIMENT_CAVEAT,
    limitations: [...limitations, WHAT_IF_LIMITATION],
  });
}
