import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceProbabilities, conditionalLogitObjective, trainConditionalLogit,
  validateExamples, featureVector, buildChoiceFeatures, FEATURE_SETS, splitChoiceExamples } from '../gcsp/predict/model/index.js';

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
