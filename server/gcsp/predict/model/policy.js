import { requireChoice, ChoiceModelError } from './optimizer.js';
import { FEATURE_SETS } from './features.js';
import { validateEvaluationSettings } from './metrics.js';
import { readModelArtifact } from './artifact.js';

export const CHOICE_TRAINING_KEYS = Object.freeze(['choice.training.regularization', 'choice.training.split.v1',
  'choice.training.featureSet', 'choice.training.optimizer.v1', 'choice.evaluation.v1']);
const unavailable = (field) => ({ status: 'unavailable', contractVersion: '1.0.0', code: 'choice-policy-unavailable',
  reason: `The canonical choice model policy is unavailable: ${field}.`, retryable: false });
const text = (v) => typeof v === 'string' && v.length > 0;

async function pinnedRead(policy, read, keys) {
  const version = await policy.getActiveVersion(read);
  requireChoice(version?.status === 'ok' && text(version.policyVersion), 'policyVersion', 'policy-unavailable');
  const pin = { ...read, policyVersion: version.policyVersion };
  const assumptions = {};
  for (const key of keys) {
    const out = await policy.getAssumption(key, pin);
    requireChoice(out?.status === 'ok' && out.policyVersion === version.policyVersion && out.value?.key === key
      && out.value.policyVersion === version.policyVersion && text(out.value.unit) && text(out.value.basis)
      && text(out.value.source) && /^\d{4}-\d{2}-\d{2}$/.test(out.value.sourceDate)
      && ['assumed', 'verified'].includes(out.value.status), key, 'policy-unavailable');
    assumptions[key] = structuredClone(out.value);
  }
  return { policyVersion: version.policyVersion, policyRead: pin, assumptions };
}

export async function loadChoiceTrainingPolicy({ policyService, policyRead }) {
  try {
    const snapshot = await pinnedRead(policyService, policyRead, CHOICE_TRAINING_KEYS);
    const value = (key) => snapshot.assumptions[key].value;
    const regularization = value('choice.training.regularization'); const featureVersion = value('choice.training.featureSet');
    const optimizer = value('choice.training.optimizer.v1'); const split = value('choice.training.split.v1');
    const evaluation = value('choice.evaluation.v1');
    requireChoice(typeof regularization === 'number' && Number.isFinite(regularization) && regularization >= 0, 'regularization');
    requireChoice(Object.hasOwn(FEATURE_SETS, featureVersion), 'featureVersion');
    requireChoice(Number.isSafeInteger(optimizer?.maxIterations) && optimizer.maxIterations > 0
      && Number.isFinite(optimizer.gradientTolerance) && optimizer.gradientTolerance > 0
      && Number.isFinite(optimizer.initialStep) && optimizer.initialStep > 0
      && Number.isSafeInteger(optimizer.maxBacktracks) && optimizer.maxBacktracks > 0, 'optimizer');
    requireChoice(Number.isSafeInteger(split?.lastTrainingCycleIndex) && split.lastTrainingCycleIndex >= 0
      && Array.isArray(split.evaluationCycleIndices) && split.evaluationCycleIndices.length > 0
      && split.evaluationCycleIndices.every((i) => Number.isSafeInteger(i) && i > split.lastTrainingCycleIndex)
      && ['gradeId', 'employeeRef'].includes(split.cohortField)
      && Array.isArray(split.heldOutCohorts) && split.heldOutCohorts.length > 0 && split.heldOutCohorts.every(text), 'split');
    validateEvaluationSettings(evaluation);
    return { status: 'ok', contractVersion: '1.0.0', value: { ...snapshot, regularization, featureVersion, optimizer, split, evaluation } };
  } catch (error) { return unavailable(error instanceof ChoiceModelError ? error.field : 'source'); }
}

// PolicyService is the only active reference authority. The caller owns trusted artifact location.
export async function readActiveChoiceModel({ policyService, policyRead, artifactDirectory }) {
  try {
    const snapshot = await pinnedRead(policyService, policyRead, ['choice.model.reference']);
    const reference = snapshot.assumptions['choice.model.reference'].value;
    requireChoice(/^sha256:[a-f0-9]{64}$/.test(reference?.artifactId) && reference.schemaVersion === 1
      && Object.hasOwn(FEATURE_SETS, reference.featureVersion), 'choice.model.reference');
    const { join } = await import('node:path');
    const artifact = await readModelArtifact(join(artifactDirectory, `${reference.artifactId.slice(7)}.json`), reference.artifactId);
    requireChoice(artifact.payload.featureVersion === reference.featureVersion, 'choice.model.reference');
    return { status: 'ok', contractVersion: '1.0.0', policyVersion: snapshot.policyVersion,
      value: { artifact, activation: snapshot.assumptions['choice.model.reference'] } };
  } catch (error) { return unavailable(error instanceof ChoiceModelError ? error.field : 'source'); }
}
