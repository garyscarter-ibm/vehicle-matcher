export { ChoiceModelError, choiceProbabilities, conditionalLogitObjective, trainConditionalLogit, validateExamples } from './optimizer.js';
export { FEATURE_SETS, featureVector, buildChoiceFeatures } from './features.js';
export { splitChoiceExamples } from './split.js';
export { evaluateProbabilities, evaluateModelComparison, validateDistribution } from './metrics.js';
export { canonicalJson, contentDigest, createModelArtifact, verifyModelArtifact, writeModelArtifact,
  readModelArtifact, evaluationSummary } from './artifact.js';
export { CHOICE_TRAINING_KEYS, loadChoiceTrainingPolicy, readActiveChoiceModel } from './policy.js';
export { projectLearningChoices } from './dataset.js';
export { trainChoiceDataset } from './pipeline.js';
export { normalizeBaselineWeights, expressedDemandBaseline, prepareActualChoiceBaselines } from './baselines.js';
export { CHOICE_ADOPTION_SETS, adoptChoiceTrainingPolicy } from './adoption.js';
