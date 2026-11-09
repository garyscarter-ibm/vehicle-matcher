import { requireChoice, trainConditionalLogit, choiceProbabilities } from './optimizer.js';
import { FEATURE_SETS } from './features.js';
import { loadChoiceTrainingPolicy } from './policy.js';
import { projectLearningChoices } from './dataset.js';
import { splitChoiceExamples } from './split.js';
import { evaluateModelComparison } from './metrics.js';
import { createModelArtifact, evaluationSummary } from './artifact.js';

export async function trainChoiceDataset({ dataset, readLearningDataset, policyService, policyRead, prepareBaselines }) {
  const loaded = await loadChoiceTrainingPolicy({ policyService, policyRead });
  requireChoice(loaded.status === 'ok', 'training-policy', 'choice-policy-unavailable');
  const settings = loaded.value;
  const projection = projectLearningChoices(dataset, { readLearningDataset,
    featureVersion: settings.featureVersion, cohortField: settings.split.cohortField });
  const partition = splitChoiceExamples(projection.examples, settings.split);
  const trained = trainConditionalLogit(partition.training, { featureNames: FEATURE_SETS[settings.featureVersion],
    regularization: settings.regularization, optimizer: settings.optimizer });
  requireChoice(typeof prepareBaselines === 'function', 'actual-baselines', 'baseline-unavailable');
  // Only the training population is passed: later/unseen demand cannot leak into a baseline.
  const baselines = await prepareBaselines({ training: partition.training, settings });
  const models = { ...baselines, learned: { predict: (example) => choiceProbabilities(example.alternatives, trained.coefficients),
    provenance: { source: 'FUCQ-115 conditional logit; synthetic-trained', version: trained.modelVersion } } };
  const evaluation = evaluateModelComparison(partition.later, models, settings.evaluation);
  const holdouts = { unseen: evaluateModelComparison(partition.unseen, models, settings.evaluation),
    familiar: evaluateModelComparison(partition.familiar, models, settings.evaluation) };
  const artifact = createModelArtifact({ schemaVersion: 1, modelVersion: trained.modelVersion, featureVersion: settings.featureVersion,
    featureNames: trained.featureNames, coefficients: trained.coefficients, policyVersion: settings.policyVersion,
    trainingSettings: structuredClone(settings), trainingManifest: projection.manifest, partition: partition.manifest,
    evaluation: { ...evaluation, holdouts }, optimizer: trained.optimizer, exclusions: projection.exclusions,
    provenance: projection.provenance, limitations: [
      'Synthetic-trained; not validated on BMW employee choices.',
      'The basic logit model assumes independence of irrelevant alternatives.',
      'Generated labels reflect latent fit, uniform utility noise, wait propensity and constrained supply, not a true logit process.',
      'Deterministic fit normalization and expressed-demand mapping are assumed probability baselines, not calibrated acceptance.',
      'Small or thin classes, missing attributes, censored outcomes and unseen ranges limit interpretation.',
      'Observational points associations do not establish a causal response to a price nudge.',
      `Optimizer status: ${trained.optimizer.status}.`,
    ] });
  return { artifact, summary: evaluationSummary(artifact) };
}
