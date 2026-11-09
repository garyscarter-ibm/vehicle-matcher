import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { inputDigest } from '../../repository/core.js';
import { choiceProbabilities, featureVector, evaluationSummary, readActiveChoiceModel, FEATURE_SETS } from '../model/index.js';
import { FORECAST_CONTRACT_VERSION, validatePredictionInput } from './input.js';

export const FORECAST_KEY = 'forecast.learned.v1';
export const MODEL_REFERENCE_KEY = 'choice.model.reference';
export const LEARNED_BASIS = 'synthetic-trained-model';
export const LEARNED_LABEL = 'Synthetic-trained model';
const SHA = /^sha256:[a-f0-9]{64}$/;
const base = 'only the baseline plan from expressed demand is shown';
const LIMITATIONS = Object.freeze({
  'no-active-model': `No learned model is active, so ${base}.`,
  'artifact-missing': `The active model file could not be found, so ${base}.`,
  'artifact-invalid': `The active model file failed its checks, so ${base}.`,
  'outside-coverage': `Some employees or vehicle classes are outside what the model was trained on, so ${base}.`,
  'forecast-policy-unavailable': `The learned forecast settings are unavailable, so ${base}.`,
});
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rate = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const fallback = (reason, extra = {}) => ({ contractVersion: FORECAST_CONTRACT_VERSION, status: 'fallback', basis: 'deterministic-baseline',
  reason, limitation: LIMITATIONS[reason], ...extra });
const settingsOf = (value) => (value && rate(value.choiceMassThreshold) && value.choiceMassThreshold > 0 && rate(value.waitExclusionThreshold)
  && Number.isFinite(value.intervalZ) && value.intervalZ > 0 && value.intervalZ <= 10
  ? { choiceMassThreshold: value.choiceMassThreshold, waitExclusionThreshold: value.waitExclusionThreshold, intervalZ: value.intervalZ } : null);

// Classes and cohorts the artifact was evaluated on, less held-out cohorts, 'wait' and 'unknown'.
function trainedCoverage(payload) {
  const learned = payload.evaluation.models.learned;
  const keys = (rows) => rows.filter((r) => r.count > 0).map((r) => r.key);
  const held = new Set(payload.trainingSettings?.split?.heldOutCohorts ?? []);
  return { cohorts: keys(learned.byCohort).filter((k) => !held.has(k)).sort(compare),
    vehicleClasses: keys(learned.byVehicleClass).filter((k) => k !== 'wait' && k !== 'unknown').sort(compare) };
}

function evaluationView(summary) {
  const thin = (rows) => rows.filter((r) => r.thin).map((r) => r.key).sort(compare);
  const learned = summary.metrics.learned;
  return { label: summary.label, partitionCounts: summary.partitionCounts,
    overall: Object.fromEntries(['learned', 'expressedDemand', 'deterministicFit'].map((k) => [k, structuredClone(summary.metrics[k].overall)])),
    deltas: structuredClone(summary.deltas), thin: { cohorts: thin(learned.byCohort), vehicleClasses: thin(learned.byVehicleClass) } };
}

function score(input, artifact, settings) {
  const { coefficients, featureVersion } = artifact.payload;
  const employees = []; const cells = new Map();
  for (const e of [...input.cohort.entitlements].sort((a, b) => compare(a.entitlementId, b.entitlementId))) {
    const choices = [...e.permittedChoices].sort((a, b) => compare(a.derivativeId, b.derivativeId));
    const alternatives = [...choices.map((c) => ({ alternativeId: c.derivativeId, attributes: c.attributes })), { alternativeId: 'wait', isWait: true }]
      .map((a) => ({ ...a, features: featureVector(a, e.brief, featureVersion) }));
    const p = choiceProbabilities(alternatives, coefficients);
    const waitProbability = p.at(-1);
    employees.push({ entitlementId: e.entitlementId, choices: choices.map((c, i) => ({ derivativeId: c.derivativeId, probability: p[i] })),
      waitProbability, acceptanceProbability: 1 - waitProbability });
    const byClass = new Map();
    choices.forEach((c, i) => byClass.set(c.vehicleClass, (byClass.get(c.vehicleClass) ?? 0) + p[i]));
    for (const [vehicleClass, q] of byClass) {
      const key = `${e.period}\u0000${vehicleClass}`; const cell = cells.get(key) ?? { vehicleClass, period: e.period, employees: 0, expected: 0, variance: 0 };
      cell.employees += 1; cell.expected += q; cell.variance += q * (1 - q); cells.set(key, cell);
    }
  }
  const aggregate = [...cells.values()].sort((a, b) => compare(a.period, b.period) || compare(a.vehicleClass, b.vehicleClass))
    .map(({ vehicleClass, period, employees: n, expected, variance }) => {
      const sd = Math.sqrt(variance);
      return { vehicleClass, period, employees: n, expected, low: Math.max(0, expected - settings.intervalZ * sd), high: Math.min(n, expected + settings.intervalZ * sd) };
    });
  return { employees, aggregate };
}

// A PredictionInput to a DemandForecast, through the model the active policy version names.
// Gates already built each permitted set; this only scores it. Any gap falls back, never partially substitutes.
export function createLearnedDemandForecastProvider({ policy, artifactDirectory } = {}) {
  return Object.freeze({
    async forecast(context, input, policyRead) {
      if (typeof policy?.getAssumption !== 'function' || typeof policy.getActiveVersion !== 'function' || typeof artifactDirectory !== 'string' || !artifactDirectory) {
        return { status: 'unavailable', code: 'learned-forecast-not-configured', contractVersion: FORECAST_CONTRACT_VERSION };
      }
      if (validatePredictionInput(input).length) return { status: 'invalid', code: 'prediction-input-invalid', contractVersion: FORECAST_CONTRACT_VERSION };
      try {
        const read = policyRead ?? { runId: input.runId, asOf: input.asOf, policyVersion: input.policyVersion };
        const reference = await policy.getAssumption(MODEL_REFERENCE_KEY, read);
        const ref = reference?.status === 'ok' ? reference.value?.value : null;
        if (!SHA.test(ref?.artifactId ?? '')) return fallback('no-active-model');
        const model = { artifactId: ref.artifactId };
        if (ref.schemaVersion !== 1 || !Object.hasOwn(FEATURE_SETS, ref.featureVersion)) return fallback('artifact-invalid', { model });
        try { await stat(join(artifactDirectory, `${ref.artifactId.slice(7)}.json`)); } catch { return fallback('artifact-missing', { model }); }
        const active = await readActiveChoiceModel({ policyService: policy, policyRead: read, artifactDirectory });
        if (active.status !== 'ok') return fallback('artifact-invalid', { model });
        const { artifact, activation } = active.value; let summary;
        try { summary = evaluationSummary(artifact); } catch { return fallback('artifact-invalid', { model }); }
        const row = await policy.getAssumption(FORECAST_KEY, { runId: read.runId, asOf: read.asOf, policyVersion: activation.policyVersion });
        const settings = row?.status === 'ok' && row.policyVersion === activation.policyVersion ? settingsOf(row.value?.value) : null;
        if (!settings) return fallback('forecast-policy-unavailable', { model });
        const trained = trainedCoverage(artifact.payload);
        const uncovered = (have, wanted) => [...new Set(wanted.filter((k) => !have.includes(k)))].sort(compare);
        const cohorts = uncovered(trained.cohorts, input.cohort.entitlements.map((e) => e.cohortKey));
        const vehicleClasses = uncovered(trained.vehicleClasses, input.cohort.entitlements.flatMap((e) => e.permittedChoices.map((c) => c.vehicleClass)));
        if (cohorts.length || vehicleClasses.length) return fallback('outside-coverage', { model, coverage: { cohorts, vehicleClasses }, trained });
        const { employees, aggregate } = score(input, artifact, settings);
        const { payload } = artifact; const manifest = payload.trainingManifest;
        return { contractVersion: FORECAST_CONTRACT_VERSION, status: 'ok', basis: LEARNED_BASIS, label: LEARNED_LABEL, runId: input.runId, asOf: input.asOf,
          policyVersion: input.policyVersion, version: inputDigest({ input, artifactId: artifact.artifactId, settings }),
          input: { cohortVersion: input.cohort.version, termsVersion: input.terms.version, horizonEnd: input.horizon.end },
          model: { artifactId: artifact.artifactId, featureVersion: payload.featureVersion, modelVersion: payload.modelVersion,
            activationPolicyVersion: activation.policyVersion, activationEffectiveFrom: activation.effectiveFrom },
          data: { dataHash: manifest.dataHash, datasetKind: manifest.datasetKind, generatorVersion: manifest.generatorVersion, trainingPolicyVersion: payload.policyVersion },
          settings, employees, aggregate, evaluation: evaluationView(summary),
          limitations: [...new Set(['Trained on synthetic data; this does not describe validated BMW employee behaviour.',
            'Probabilities are the model\'s estimate over each employee\'s permitted vehicles or waiting, not a fit score.', ...payload.limitations])] };
      } catch { return { status: 'unavailable', code: 'learned-forecast-unavailable', contractVersion: FORECAST_CONTRACT_VERSION }; }
    },
  });
}
