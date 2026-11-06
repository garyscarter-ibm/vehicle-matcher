// Offline, full-batch regularised conditional logit. No business policy defaults.
export class ChoiceModelError extends Error {
  constructor(code, field) {
    super(`Choice model ${code}: ${field}.`);
    this.name = 'ChoiceModelError'; this.code = code; this.field = field;
  }
}
export const requireChoice = (condition, field, code = 'invalid-input') => {
  if (!condition) throw new ChoiceModelError(code, field);
};
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

export function validateExamples(examples, dimension) {
  requireChoice(Array.isArray(examples) && examples.length > 0, 'examples');
  requireChoice(Number.isSafeInteger(dimension) && dimension > 0, 'dimension');
  const ids = new Set();
  for (const example of examples) {
    requireChoice(typeof example?.recordId === 'string' && example.recordId.length > 0
      && !ids.has(example.recordId), 'recordId');
    ids.add(example.recordId);
    requireChoice(Array.isArray(example.alternatives) && example.alternatives.length >= 1, 'alternatives');
    const alternatives = example.alternatives;
    requireChoice(alternatives.every((a) => typeof a.alternativeId === 'string' && a.alternativeId.length > 0)
      && new Set(alternatives.map((a) => a.alternativeId)).size === alternatives.length, 'alternativeId');
    requireChoice(alternatives.filter((a) => a.isWait === true).length === 1, 'wait');
    requireChoice(alternatives.some((a) => a.alternativeId === example.chosenAlternativeId), 'chosenAlternativeId');
    requireChoice(alternatives.every((a) => Array.isArray(a.features) && a.features.length === dimension
      && a.features.every(finite)), 'features');
  }
}

export function choiceProbabilities(alternatives, coefficients) {
  requireChoice(Array.isArray(coefficients) && coefficients.length > 0 && coefficients.every(finite), 'coefficients');
  requireChoice(Array.isArray(alternatives) && alternatives.length > 0, 'alternatives');
  const utilities = alternatives.map(({ features }) => {
    requireChoice(Array.isArray(features) && features.length === coefficients.length && features.every(finite), 'features');
    const utility = features.reduce((sum, x, j) => sum + x * coefficients[j], 0);
    requireChoice(finite(utility), 'utility');
    return utility;
  });
  const maximum = Math.max(...utilities);
  const weights = utilities.map((u) => Math.exp(u - maximum));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
}

// Returns an exact gradient for mean NLL + lambda/2 * ||beta||².
export function conditionalLogitObjective(examples, coefficients, regularization) {
  requireChoice(finite(regularization) && regularization >= 0, 'regularization');
  let objective = 0;
  const gradient = coefficients.map(() => 0);
  for (const example of examples) {
    const utilities = example.alternatives.map(({ features }) => features.reduce((s, x, j) => s + x * coefficients[j], 0));
    requireChoice(utilities.every(finite), 'utility');
    const maximum = Math.max(...utilities);
    const weights = utilities.map((u) => Math.exp(u - maximum));
    const total = weights.reduce((a, b) => a + b, 0);
    const chosen = example.alternatives.findIndex((a) => a.alternativeId === example.chosenAlternativeId);
    requireChoice(chosen >= 0, 'chosenAlternativeId');
    // Subtract maximum first, avoiding cancellation when all utilities are large.
    objective += Math.log(total) - (utilities[chosen] - maximum);
    for (let a = 0; a < weights.length; a += 1) {
      const residual = weights[a] / total - Number(a === chosen);
      for (let j = 0; j < coefficients.length; j += 1) gradient[j] += residual * example.alternatives[a].features[j];
    }
  }
  objective /= examples.length;
  for (let j = 0; j < coefficients.length; j += 1) {
    objective += regularization * coefficients[j] ** 2 / 2;
    gradient[j] = gradient[j] / examples.length + regularization * coefficients[j];
  }
  requireChoice(finite(objective) && gradient.every(finite), 'objective');
  return { objective, gradient };
}

export function trainConditionalLogit(examples, { featureNames, regularization, optimizer } = {}) {
  requireChoice(Array.isArray(featureNames) && featureNames.length > 0
    && featureNames.every((v) => typeof v === 'string' && v.length > 0)
    && new Set(featureNames).size === featureNames.length, 'featureNames');
  validateExamples(examples, featureNames.length);
  requireChoice(finite(regularization) && regularization >= 0, 'regularization');
  requireChoice(Number.isSafeInteger(optimizer?.maxIterations) && optimizer.maxIterations > 0
    && finite(optimizer.gradientTolerance) && optimizer.gradientTolerance > 0
    && finite(optimizer.initialStep) && optimizer.initialStep > 0
    && Number.isSafeInteger(optimizer.maxBacktracks) && optimizer.maxBacktracks > 0, 'optimizer');
  let coefficients = featureNames.map(() => 0);
  let current = conditionalLogitObjective(examples, coefficients, regularization);
  const initialObjective = current.objective;
  let iterations = 0; let status = 'iteration-limit';
  for (; iterations < optimizer.maxIterations; iterations += 1) {
    const squaredNorm = current.gradient.reduce((s, g) => s + g * g, 0);
    if (Math.sqrt(squaredNorm) <= optimizer.gradientTolerance) { status = 'converged'; break; }
    let step = optimizer.initialStep; let accepted;
    for (let backtrack = 0; backtrack < optimizer.maxBacktracks; backtrack += 1) {
      const candidate = coefficients.map((b, j) => b - step * current.gradient[j]);
      const next = conditionalLogitObjective(examples, candidate, regularization);
      // Armijo's sufficient decrease constant is part of optimizer version v1.
      if (next.objective <= current.objective - 0.0001 * step * squaredNorm) {
        accepted = { candidate, next }; break;
      }
      step /= 2;
    }
    if (!accepted) { status = 'line-search-stalled'; break; }
    coefficients = accepted.candidate; current = accepted.next;
  }
  const gradientNorm = Math.hypot(...current.gradient);
  if (gradientNorm <= optimizer.gradientTolerance) status = 'converged';
  return { modelVersion: 'conditional-logit.l2.v1', featureNames: [...featureNames], coefficients,
    optimizer: { ...optimizer, status, iterations, gradientNorm, initialObjective, objective: current.objective },
    regularization, trainingCount: examples.length };
}
