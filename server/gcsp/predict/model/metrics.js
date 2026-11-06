import { requireChoice } from './optimizer.js';

export function validateEvaluationSettings(settings) {
  requireChoice(Number.isSafeInteger(settings?.reliabilityBands) && settings.reliabilityBands > 0 && settings.reliabilityBands <= 100
    && Number.isSafeInteger(settings.thinClassMinimum) && settings.thinClassMinimum > 0
    && typeof settings.logFloor === 'number' && settings.logFloor > 0 && settings.logFloor < 0.5, 'evaluation');
}

export function validateDistribution(probabilities, length) {
  requireChoice(Array.isArray(probabilities) && probabilities.length === length
    && probabilities.every((p) => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1)
    && Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-10, 'probabilities');
}
const sorted = (map, project) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ key, ...project(rows) }));
const group = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

function scores(rows, settings, binary = false) {
  let logLoss = 0; let brier = 0; let zeroProbabilityOutcomes = 0;
  for (const { probabilities, chosen } of rows) {
    const p = probabilities[chosen];
    logLoss -= Math.log(Math.max(settings.logFloor, p));
    zeroProbabilityOutcomes += Number(p === 0);
    brier += probabilities.reduce((sum, probability, a) => sum + (probability - Number(a === chosen)) ** 2, 0) / (binary ? 2 : 1);
  }
  return { count: rows.length, logLoss: logLoss / rows.length, brier: brier / rows.length,
    zeroProbabilityOutcomes, thin: rows.length < settings.thinClassMinimum };
}

export function evaluateProbabilities(examples, predict, settings) {
  validateEvaluationSettings(settings);
  requireChoice(Array.isArray(examples) && examples.length > 0 && typeof predict === 'function', 'evaluation-input');
  const rows = []; const cohorts = new Map(); const chosenClasses = new Map(); const classRows = new Map();
  const bins = Array.from({ length: settings.reliabilityBands }, (_, index) => ({
    lower: index / settings.reliabilityBands, upper: (index + 1) / settings.reliabilityBands,
    count: 0, totalPredicted: 0, totalObserved: 0,
  }));
  const ids = new Set();
  for (const example of examples) {
    requireChoice(typeof example.recordId === 'string' && !ids.has(example.recordId)
      && typeof example.cohort === 'string', 'evaluation.identity');
    ids.add(example.recordId);
    requireChoice(Array.isArray(example.alternatives) && example.alternatives.length > 0, 'evaluation.alternatives');
    const chosen = example.alternatives.findIndex((a) => a.alternativeId === example.chosenAlternativeId);
    requireChoice(chosen >= 0 && new Set(example.alternatives.map((a) => a.alternativeId)).size === example.alternatives.length,
      'evaluation.chosen');
    const probabilities = predict(example);
    validateDistribution(probabilities, example.alternatives.length);
    const row = { probabilities, chosen }; rows.push(row); group(cohorts, example.cohort, row);
    const vehicleClasses = example.alternatives.map((a) => a.isWait ? 'wait' : a.vehicleClass);
    requireChoice(vehicleClasses.every((v) => typeof v === 'string' && v.length > 0), 'vehicleClass');
    group(chosenClasses, vehicleClasses[chosen], row);
    for (let a = 0; a < probabilities.length; a += 1) {
      const bin = bins[Math.min(settings.reliabilityBands - 1, Math.floor(probabilities[a] * settings.reliabilityBands))];
      bin.count += 1; bin.totalPredicted += probabilities[a]; bin.totalObserved += Number(a === chosen);
    }
    // Each class is one binary target per choice, including choices of other classes.
    for (const vehicleClass of new Set(vehicleClasses)) {
      const p = probabilities.reduce((sum, probability, a) => sum + (vehicleClasses[a] === vehicleClass ? probability : 0), 0);
      group(classRows, vehicleClass, { probabilities: [p, 1 - p], chosen: vehicleClasses[chosen] === vehicleClass ? 0 : 1 });
    }
  }
  return { overall: scores(rows, settings), byCohort: sorted(cohorts, (items) => scores(items, settings)),
    byChosenVehicleClass: sorted(chosenClasses, (items) => scores(items, settings)),
    byVehicleClass: sorted(classRows, (items) => ({ ...scores(items, settings, true),
      observedCount: items.filter((row) => row.chosen === 0).length,
      thin: items.filter((row) => row.chosen === 0).length < settings.thinClassMinimum })),
    reliability: bins.map(({ totalPredicted, totalObserved, ...bin }) => ({ ...bin,
      meanPredicted: bin.count ? totalPredicted / bin.count : null, observedRate: bin.count ? totalObserved / bin.count : null })),
    definitions: { logLoss: 'mean negative log probability of the observed choice', brier: 'mean sum of squared multiclass errors per choice',
      reliability: 'one event per alternative, with p=1 in the final closed band',
      byVehicleClass: 'binary class probability summed across alternatives, on choice sets containing that class; thin by observed positives',
      byChosenVehicleClass: 'multiclass scores grouped by the observed choice class', logFloor: settings.logFloor } };
}

export function evaluateModelComparison(examples, models, settings) {
  const required = ['learned', 'expressedDemand', 'deterministicFit']; const results = {};
  for (const key of required) {
    requireChoice(typeof models?.[key]?.predict === 'function' && typeof models[key].provenance?.source === 'string'
      && typeof models[key].provenance.version === 'string', `baselines.${key}`, 'baseline-unavailable');
    results[key] = { ...evaluateProbabilities(examples, models[key].predict, settings), provenance: structuredClone(models[key].provenance) };
  }
  return { models: results, deltas: Object.fromEntries(required.slice(1).map((key) => [key, {
    logLoss: results.learned.overall.logLoss - results[key].overall.logLoss,
    brier: results.learned.overall.brier - results[key].overall.brier,
    worseLogLoss: results.learned.overall.logLoss > results[key].overall.logLoss,
    worseBrier: results.learned.overall.brier > results[key].overall.brier,
  }])) };
}
