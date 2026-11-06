import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { choiceProbabilities, conditionalLogitObjective, trainConditionalLogit,
  validateExamples, featureVector, buildChoiceFeatures, FEATURE_SETS, splitChoiceExamples,
  evaluateProbabilities, evaluateModelComparison, canonicalJson, contentDigest, createModelArtifact, verifyModelArtifact,
  writeModelArtifact, readModelArtifact, evaluationSummary, loadChoiceTrainingPolicy, readActiveChoiceModel } from '../gcsp/predict/model/index.js';
import { PolicyService, MemoryPolicyProvider } from '../gcsp/policy/index.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';

const optimizer = { maxIterations: 1000, gradientTolerance: 0.000001, initialStep: 4, maxBacktracks: 30 };
function random(seed) { let x = seed; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; }; }
function knownLogit(seed = 312) {
  const next = random(seed); const truth = [0.7, -1.1, -0.4];
  const examples = Array.from({ length: 4000 }, (_, i) => {
    const alternatives = Array.from({ length: 3 }, (_, a) => ({ alternativeId: `a${a}`, isWait: false,
      features: [next() * 2 - 1, next() * 2 - 1, 0] }));
    alternatives.push({ alternativeId: 'wait', isWait: true, features: [0, 0, 1] });
    const probabilities = choiceProbabilities(alternatives, truth); const u = next(); let total = 0;
    const choice = probabilities.findIndex((p) => { total += p; return u < total; });
    return { recordId: `r${i}`, alternatives, chosenAlternativeId: alternatives[choice].alternativeId };
  });
  return { examples, truth };
}

test('plain-JS regularised optimizer recovers known synthetic coefficients, including wait', () => {
  const { examples, truth } = knownLogit();
  const trained = trainConditionalLogit(examples, { featureNames: ['x', 'y', 'wait'], regularization: 0.0001, optimizer });
  assert.equal(trained.optimizer.status, 'converged');
  for (let j = 0; j < truth.length; j += 1)
    assert.ok(Math.abs(trained.coefficients[j] - truth[j]) < 0.15, `coefficient ${j}: ${trained.coefficients[j]} vs ${truth[j]}`);
  assert.ok(trained.optimizer.objective < trained.optimizer.initialObjective);
  assert.equal(trained.trainingCount, 4000);
  assert.ok(trained.optimizer.iterations <= optimizer.maxIterations);
  const penalised = trainConditionalLogit(examples, { featureNames: ['x', 'y', 'wait'], regularization: 1, optimizer });
  assert.ok(Math.hypot(...penalised.coefficients) < Math.hypot(...trained.coefficients));
});

test('analytic gradient matches central differences and stable probabilities tolerate extreme utilities', () => {
  const examples = knownLogit().examples.slice(0, 12); const coefficients = [0.2, -0.3, 0.1];
  const { gradient } = conditionalLogitObjective(examples, coefficients, 0.1);
  for (let j = 0; j < coefficients.length; j += 1) {
    const above = [...coefficients]; const below = [...coefficients]; above[j] += 0.00001; below[j] -= 0.00001;
    const numerical = (conditionalLogitObjective(examples, above, 0.1).objective
      - conditionalLogitObjective(examples, below, 0.1).objective) / 0.00002;
    assert.ok(Math.abs(numerical - gradient[j]) < 1e-7);
  }
  assert.deepEqual(choiceProbabilities([{ features: [1000] }, { features: [-1000] }], [100]), [1, 0]);
  assert.deepEqual(choiceProbabilities([{ features: [1000] }, { features: [1000] }], [100]), [0.5, 0.5]);
  assert.ok(Number.isFinite(conditionalLogitObjective([{ alternatives: [{ alternativeId: 'a', features: [1000] },
    { alternativeId: 'w', features: [-1000] }], chosenAlternativeId: 'w' }], [100], 0).objective));
});

test('malformed/nonfinite examples, duplicate identities, missing choices and wait are refused', () => {
  const sample = knownLogit().examples.slice(0, 1);
  for (const mutate of [(r) => { r[0].alternatives[0].features[0] = NaN; },
    (r) => { r[0].chosenAlternativeId = 'missing'; }, (r) => { r[0].alternatives.pop(); },
    (r) => { r[0].alternatives[1].alternativeId = r[0].alternatives[0].alternativeId; }, (r) => r.push(structuredClone(r[0]))]) {
    const records = structuredClone(sample); mutate(records); assert.throws(() => validateExamples(records, 3));
  }
  assert.throws(() => trainConditionalLogit(sample, { featureNames: ['a', 'b', 'c'], regularization: -1, optimizer }));
  const bounded = trainConditionalLogit(sample, { featureNames: ['a', 'b', 'c'], regularization: 0.001,
    optimizer: { ...optimizer, maxIterations: 1 } });
  assert.equal(bounded.optimizer.status, 'iteration-limit');
});

test('vehicle features interact with confirmed preferences, importance and essential capacity', () => {
  const alternative = { attributes: { body: 'estate', fuel: 'ev', seats: 5, boot: 560, monthlyPoints: 1100, allowance: 1300 } };
  const brief = { preferences: { body: { value: 'estate', importance: 80, valueState: 'confirmed', importanceState: 'confirmed' },
    fuel: { value: 'ev', importance: 20, valueState: 'confirmed', importanceState: 'confirmed' } },
  essentials: { seats: { value: 4, operator: 'gte', state: 'confirmed' }, boot: { value: 420, operator: 'gte', state: 'confirmed' } } };
  const featureVersion = 'vehicle-preference-v1';
  const vector = featureVector(alternative, brief, featureVersion);
  const get = (name, v = vector) => v[FEATURE_SETS[featureVersion].indexOf(name)];
  assert.equal(get('preference.body.match'), 1); assert.equal(get('importance.body.match'), 0.8);
  assert.equal(get('importance.fuel.match'), 0.2); assert.equal(get('essential.seats.capacity'), 1 / 7);
  assert.equal(get('essential.boot.capacity'), 0.2);
  const indifferent = structuredClone(brief); indifferent.preferences.body.importance = 0;
  assert.equal(get('importance.body.match', featureVector(alternative, indifferent, featureVersion)), 0);
  const unconfirmed = structuredClone(brief); unconfirmed.preferences.body.valueState = 'inferred';
  assert.equal(get('preference.body.match', featureVector(alternative, unconfirmed, featureVersion)), 0);
  const missing = featureVector({ attributes: {} }, brief, featureVersion);
  assert.equal(get('missing.seats', missing), 1); assert.equal(get('missing.points', missing), 1);
  const wait = featureVector({ isWait: true }, brief, featureVersion);
  assert.equal(wait[0], 1); assert.equal(wait.reduce((s, x) => s + x, 0), 1);
  assert.throws(() => featureVector(alternative, brief, 'unavailable'));
  assert.equal(buildChoiceFeatures({ alternatives: [alternative], brief }, featureVersion).alternatives[0].features.length, vector.length);
});

function splitFixture() {
  return Array.from({ length: 4 }, (_, index) => ['G7', 'G8'].map((cohort) => ({ recordId: `${index}-${cohort}`, cohort,
    cycle: { id: `cycle-${index}`, index, startsAt: `202${index}-01-01T00:00:00.000Z`, until: `202${index}-12-31T23:59:59.000Z` },
    featuresAsOf: `202${index}-06-01T00:00:00.000Z`, observedAt: `202${index}-06-02T00:00:00.000Z` }))).flat();
}
const split = { lastTrainingCycleIndex: 1, evaluationCycleIndices: [2, 3], cohortField: 'gradeId', heldOutCohorts: ['G8'] };

test('earlier-cycle training excludes the held-out cohort and all later records', () => {
  const result = splitChoiceExamples(splitFixture(), split);
  assert.deepEqual(result.manifest.counts, { training: 2, later: 4, unseen: 2, familiar: 2, excluded: 2 });
  assert.ok(result.training.every((r) => r.cycle.index <= 1 && r.cohort === 'G7'));
  assert.ok(result.later.every((r) => r.cycle.index >= 2));
  assert.ok(result.unseen.every((r) => r.cohort === 'G8'));
});

test('leakage, conflicting cycles, empty holdouts and duplicate records fail explicitly', () => {
  for (const mutate of [(r) => r.push(structuredClone(r[0])),
    (r) => { r[0].featuresAsOf = '2025-01-01T00:00:00.000Z'; },
    (r) => { r[2].cycle.startsAt = r[0].cycle.startsAt; },
    (r) => { r[0].cycle.id = r[2].cycle.id; },
    (r) => { r.splice(4); }, (r) => { for (const e of r) e.cohort = 'G7'; }]) {
    const records = splitFixture(); mutate(records); assert.throws(() => splitChoiceExamples(records, split));
  }
  assert.throws(() => splitChoiceExamples(splitFixture(), { ...split, evaluationCycleIndices: [1, 2] }));
});

const settings = { reliabilityBands: 5, thinClassMinimum: 2, logFloor: 1e-15 };
function arithmeticExamples() {
  return ['a', 'wait'].map((chosenAlternativeId, i) => ({ recordId: `metric-${i}`, cohort: i ? 'unseen' : 'familiar',
    chosenAlternativeId, alternatives: [{ alternativeId: 'a', vehicleClass: 'estate' }, { alternativeId: 'wait', isWait: true }] }));
}
const arithmeticPredictor = (r) => r.recordId === 'metric-0' ? [0.8, 0.2] : [0.3, 0.7];
function arithmeticComparison() {
  // Explicit arithmetic fixture: these are not FUCQ-99/FUCQ-29 service outputs.
  const model = (predict) => ({ predict, provenance: { source: 'arithmetic-fixture-only', version: '1' } });
  return evaluateModelComparison(arithmeticExamples(), { learned: model(() => [0.5, 0.5]),
    expressedDemand: model(arithmeticPredictor), deterministicFit: model(arithmeticPredictor) }, settings);
}

test('log loss, multiclass Brier, reliability, cohort and thin-class results are computed from choices', () => {
  const metrics = evaluateProbabilities(arithmeticExamples(), arithmeticPredictor, settings);
  assert.ok(Math.abs(metrics.overall.logLoss - (-Math.log(0.8) - Math.log(0.7)) / 2) < 1e-12);
  assert.ok(Math.abs(metrics.overall.brier - 0.13) < 1e-12);
  assert.equal(metrics.reliability.reduce((n, b) => n + b.count, 0), 4);
  assert.equal(metrics.reliability[1].count, 2); assert.equal(metrics.reliability[1].observedRate, 0);
  assert.equal(metrics.byCohort.length, 2); assert.ok(metrics.byCohort.every((r) => r.thin));
  assert.equal(metrics.byVehicleClass[0].key, 'estate'); assert.equal(metrics.byVehicleClass[0].observedCount, 1);
  assert.equal(metrics.byVehicleClass[0].thin, true);
  assert.ok(Math.abs(metrics.byVehicleClass[0].brier - 0.065) < 1e-12);
  assert.equal(metrics.byChosenVehicleClass.length, 2);
  const zero = evaluateProbabilities(arithmeticExamples(), () => [1, 0], settings);
  assert.equal(zero.overall.zeroProbabilityOutcomes, 1); assert.ok(Number.isFinite(zero.overall.logLoss));
  assert.equal(zero.reliability.at(-1).count, 2);
  const comparison = arithmeticComparison();
  assert.equal(comparison.deltas.expressedDemand.worseLogLoss, true);
  assert.equal(comparison.deltas.deterministicFit.worseBrier, true);
});

test('missing baselines and malformed distributions are refused, without invented scores', () => {
  assert.throws(() => evaluateModelComparison(arithmeticExamples(), { learned: {} }, settings), { code: 'baseline-unavailable' });
  for (const probabilities of [[0.2, 0.2], [-0.1, 1.1], [NaN, 0], [1], [0, Infinity]])
    assert.throws(() => evaluateProbabilities(arithmeticExamples(), () => probabilities, settings));
});

function arithmeticArtifact() {
  return createModelArtifact({ schemaVersion: 1, modelVersion: 'conditional-logit.l2.v1', featureVersion: 'vehicle-preference-v1',
    featureNames: [...FEATURE_SETS['vehicle-preference-v1']], coefficients: FEATURE_SETS['vehicle-preference-v1'].map(() => 0),
    policyVersion: 'arithmetic-fixture-policy', trainingSettings: { regularization: 0.1 },
    trainingManifest: { schemaVersion: 1, datasetKind: 'synthetic', generatorVersion: 'arithmetic-fixture.v1', seed: 'arithmetic-only',
      dataHash: contentDigest(arithmeticExamples()), counts: { records: 4 }, privateRecordId: 'never-project-private-123' },
    partition: { counts: { training: 2, later: 2, unseen: 1, familiar: 1 }, recordIds: ['never-project-private-123'] },
    evaluation: arithmeticComparison(), provenance: { label: 'synthetic-trained', seed: 'arithmetic-only',
      generatorVersion: 'arithmetic-fixture.v1', assumptions: ['Two arithmetic examples; no real baseline integration.'] },
    limitations: ['Arithmetic contract fixture only; not BMW calibration.', 'IIA assumption applies.'] });
}

test('artifact canonical identity, atomic exclusive publication and corruption detection preserve immutable bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'choice-artifact-'));
  try {
    assert.equal(canonicalJson({ z: 1, a: [2, 3] }), '{"a":[2,3],"z":1}');
    assert.equal(contentDigest({ a: 1, b: 2 }), contentDigest({ b: 2, a: 1 }));
    for (const value of [NaN, { x: undefined }, new Date(), Array(2)]) assert.throws(() => canonicalJson(value));
    const cyclic = {}; cyclic.x = cyclic; assert.throws(() => canonicalJson(cyclic));
    const artifact = arithmeticArtifact(); assert.ok(Object.isFrozen(artifact.payload.coefficients));
    const first = await writeModelArtifact(directory, artifact); const bytes = await readFile(first.path, 'utf8');
    assert.equal(first.reused, false); assert.equal((await writeModelArtifact(directory, artifact)).reused, true);
    assert.equal(await readFile(first.path, 'utf8'), bytes);
    assert.deepEqual(await readModelArtifact(first.path, artifact.artifactId), artifact);
    const changed = structuredClone(artifact); changed.payload.coefficients[0] = 2;
    assert.throws(() => verifyModelArtifact(changed), { code: 'artifact-corrupt' });
    await chmod(first.path, 0o600); await writeFile(first.path, '{}');
    await assert.rejects(readModelArtifact(first.path, artifact.artifactId));
    await assert.rejects(writeModelArtifact(directory, artifact), { code: 'artifact-corrupt' });
    assert.equal((await readdir(directory)).length, 1, 'No partial private writing files remain.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('safe panel summary keeps adverse comparisons and synthetic limits, excludes record identities', () => {
  const summary = evaluationSummary(arithmeticArtifact());
  assert.equal(summary.status, 'evaluated'); assert.equal(summary.trainingOrigin.label, 'synthetic-trained');
  assert.equal(summary.deltas.expressedDemand.worseLogLoss, true);
  assert.ok(!JSON.stringify(summary).includes('never-project-private-123'));
});

async function alternativePolicyFixture() {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
  const proposal = JSON.parse(await readFile(new URL('../../docs/gcsp/models/fucq115-policy-proposal.json', import.meta.url)));
  const { digest, ...bundle } = proposal; assert.equal(digest, contentDigest(bundle));
  // Explicit alternative test source. Never used as an application fallback or canonical adoption proof.
  for (const row of proposal.definitions) seed.assumptions.push({ ...row, effectiveFrom: seed.effectiveFrom, policyVersion: seed.policyVersion });
  const provider = new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } });
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  const readPolicy = new PolicyService({ provider });
  const runtime = await createDemoRuntime({ repository, policy: readPolicy, environmentId: 'choice-model-fixture', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'choice-bootstrap', sessionNow: () => '2026-11-05T09:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const context = (await identity.switchPrincipal(presenter, 'demo-greg', 'greg')).value.context;
  return { provider, repository, clock, identity, presenter, context, policy: new PolicyService({ provider, clock, identity }) };
}

test('canonical missing keys are unavailable and alternative policy changes affect settings via actual dated publication', async () => {
  const read = { runId: 'choice-unavailable', asOf: '2026-11-05T09:00:00.000Z' };
  assert.equal((await loadChoiceTrainingPolicy({ policyService: new PolicyService(), policyRead: read })).status, 'unavailable');
  const f = await alternativePolicyFixture();
  const directory = await mkdtemp(join(tmpdir(), 'choice-policy-'));
  try {
    const scoped = { ...read, runId: f.context.runId };
    const before = await loadChoiceTrainingPolicy({ policyService: f.policy, policyRead: scoped });
    assert.equal(before.status, 'ok'); assert.equal(before.value.regularization, 0.001);
    const artifact = arithmeticArtifact(); await writeModelArtifact(directory, artifact);
    assert.equal((await readActiveChoiceModel({ policyService: f.policy, policyRead: scoped, artifactDirectory: directory })).status, 'unavailable');
    const provenance = { basis: 'Explicit alternative source for the dated training/activation contract test.',
      source: 'server/test/gcsp-choice-model.test.js', sourceDate: '2026-11-05', status: 'assumed' };
    const published = await f.policy.publishPolicyVersion(f.context, { commandId: 'choice-publish', expectedActiveVersion: before.value.policyVersion,
      policyVersion: 'choice-test-v2', effectiveFrom: '2026-11-05T10:00:00.000Z', changes: [
        { table: 'assumptions', key: 'choice.training.regularization', patch: { value: 1, ...provenance } },
        { table: 'assumptions', key: 'choice.model.reference', patch: { value: { artifactId: artifact.artifactId,
          featureVersion: artifact.payload.featureVersion, schemaVersion: 1 }, ...provenance } },
      ] });
    assert.equal(published.status, 'ok', JSON.stringify(published));
    assert.equal((await loadChoiceTrainingPolicy({ policyService: f.policy, policyRead: scoped })).value.regularization, 0.001);
    const later = { ...scoped, asOf: '2026-11-05T11:00:00.000Z' };
    const after = await loadChoiceTrainingPolicy({ policyService: f.policy, policyRead: later });
    assert.equal(after.value.regularization, 1);
    const historical = await loadChoiceTrainingPolicy({ policyService: f.policy, policyRead: { ...later, policyVersion: before.value.policyVersion } });
    assert.equal(historical.value.regularization, 0.001);
    const active = await readActiveChoiceModel({ policyService: f.policy, policyRead: later, artifactDirectory: directory });
    assert.equal(active.status, 'ok', JSON.stringify(active)); assert.equal(active.value.artifact.artifactId, artifact.artifactId);
    assert.equal(active.policyVersion, 'choice-test-v2');
    const examples = knownLogit().examples.slice(0, 200);
    const initialRun = trainConditionalLogit(examples, { featureNames: ['x', 'y', 'wait'], regularization: before.value.regularization, optimizer });
    const nextRun = trainConditionalLogit(examples, { featureNames: ['x', 'y', 'wait'], regularization: after.value.regularization, optimizer });
    assert.notDeepEqual(initialRun.coefficients, nextRun.coefficients);
  } finally { await f.repository.close(); await f.provider.close(); await rm(directory, { recursive: true, force: true }); }
});
