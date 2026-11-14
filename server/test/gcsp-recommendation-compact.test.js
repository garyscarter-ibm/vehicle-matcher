import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeeRecommendationService, createAllocationRecommendationEvaluator, createStoredSubjectRecommendationEvaluator } from '../gcsp/recommendation/index.js';
import { context, brief, stock, fact, providerValue, provider, time, policy, currentCar, rating, sameAgain } from './helpers/employee-recommendation.js';

const ports = (source = providerValue(), overrides = {}) => ({ provider: provider(source), policy: policy(), time, ...overrides });
const compactDecision = ({ snapshot, terms, brief, employeeFacts, evidence, ...decision }) => decision;
async function equivalent(source = providerValue(), request = brief(), overrides = {}) {
  const injected = ports(source, overrides);
  const gallery = await createEmployeeRecommendationService(injected).recommend(context, request);
  const compact = await createAllocationRecommendationEvaluator(injected).evaluate(context, request);
  assert.equal(gallery.status, 'ok'); assert.equal(compact.status, 'ok');
  assert.deepEqual(compact.value.decisions, gallery.value.decisions.map(compactDecision));
  const { decisions, recommendations, ...metadata } = gallery.value;
  assert.deepEqual(compact.value, { ...metadata, decisions: decisions.map(compactDecision) });
  return { gallery, compact, injected };
}

test('compact decisions retain every source-ordered fallback without gallery or terms graphs', async () => {
  const cars = Array.from({ length: 12 }, (_, i) => stock(12 - i));
  const { gallery, compact } = await equivalent(providerValue(cars));
  assert.equal(gallery.value.recommendations.length, 3);
  assert.equal(compact.value.decisions.length, cars.length);
  assert.deepEqual(compact.value.decisions.map((row) => row.orderUuid), cars.map((row) => row.orderUuid));
  assert.equal(compact.value.recommendations, undefined);
  for (const row of compact.value.decisions) {
    for (const key of ['snapshot', 'terms', 'brief', 'employeeFacts', 'evidence', 'recommendations', 'preview']) assert.equal(Object.hasOwn(row, key), false, key);
    assert.equal(typeof row.versions.terms, 'string');
    assert.equal(Object.isFrozen(row), true);
  }
});

for (const [name, change, expected] of [
  ['policy exclusion', (source) => { source.stock = [stock(1, { eligibilityModelKey: fact('G21 Touring|M340i') })]; }, 'ineligible'],
  ['practical exclusion', (source) => { source.stock = [stock(1, { seats: fact(2, 'count') })]; }, 'ineligible'],
  ['unknown vehicle fact', (source) => { source.stock = [stock(1, { seats: fact(null, 'count') })]; }, 'needs-confirmation'],
  ['driver missing', (source) => { delete source.employeeFacts.driverEligible; }, 'needs-confirmation'],
  ['driver excluded', (source) => { source.employeeFacts.driverEligible = fact(false); }, 'ineligible'],
  ['timing missing', (source) => { delete source.employeeFacts.requiredBy; }, 'needs-confirmation'],
  ['availability missing', (source) => { delete source.stock[0].availability.availableUntil; }, 'needs-confirmation'],
  ['not yet available', (source) => { source.stock[0].availability.availableFrom = '2026-11-20T00:00:00.000Z'; }, 'ineligible'],
  ['charging excluded', (source) => { source.stock = [stock(1, { fuel: fact('ev') })]; source.employeeFacts.charging = fact('none'); }, 'ineligible'],
]) test(`compact preserves ${name} gates, score components and evidence reasons`, async () => {
  const source = providerValue(); change(source);
  const { compact } = await equivalent(source);
  assert.equal(compact.value.decisions[0].gateStatus, expected);
});

test('missing points retain confirmation and null terms identity', async () => {
  const supplied = policy();
  supplied.getPointsCost = async () => ({ status: 'not-found', policyVersion: context.policyVersion });
  const { compact } = await equivalent(providerValue(), brief(), { policy: supplied });
  const row = compact.value.decisions[0];
  assert.equal(row.gateStatus, 'needs-confirmation'); assert.equal(row.versions.terms, null);
  assert.ok(row.unknowns.some((entry) => entry.code === 'points-unavailable'));
});

test('empty stock and mixed outcomes preserve their metadata and all candidates', async () => {
  await equivalent(providerValue([]));
  await equivalent(providerValue([stock(3), stock(2, { seats: fact(2, 'count') }), stock(1, { seats: fact(null, 'count') })]));
});

test('feedback and same-again preserve pins, omission, continuity and scores', async () => {
  const source = providerValue([stock(1), stock(2, { body: fact('suv'), eligibilityModelKey: fact('G01 X3|xDrive20i') }, 'other')]);
  source.currentCar = currentCar();
  for (const feedback of [{ currentCarRating: rating(1) }, { currentCarRating: rating(5) }, { sameAgain: sameAgain(true) }, { sameAgain: sameAgain(false) }]) {
    const { compact } = await equivalent(source, { ...brief(), ...feedback });
    assert.ok(compact.value.versions.feedback);
    assert.ok(compact.value.decisions.every((row) => row.versions.feedback === compact.value.versions.feedback));
    assert.ok(compact.value.decisions.every((row) => row.feedback.applied));
  }
});

test('both internal paths leave supplied facts, snapshots and request unchanged', async () => {
  const source = providerValue([stock(2), stock(1)]); source.currentCar = currentCar();
  const request = { ...brief(), currentCarRating: rating(5) };
  const before = structuredClone({ source, request }); const evaluator = createAllocationRecommendationEvaluator(ports(source));
  for (const method of ['evaluate', 'quote']) {
    const result = await evaluator[method](context, request);
    assert.equal(result.status, 'ok');
    assert.deepEqual({ source, request }, before);
    assert.equal(Object.isFrozen(source.employeeFacts), false);
    assert.equal(Object.isFrozen(request), false);
  }
});

test('a one-car frozen quote reconstructs the exact gallery decision without gallery fields', async () => {
  const source = providerValue([stock(3), stock(1), stock(2)]); source.currentCar = currentCar();
  const request = { ...brief(), currentCarRating: rating(5) };
  const { gallery } = await equivalent(source, request);
  for (const car of source.stock) {
    const evaluator = createAllocationRecommendationEvaluator(ports({ ...source, stock: [car] }));
    const detailed = await evaluator.quote(context, request);
    assert.equal(detailed.status, 'ok'); assert.equal(detailed.value.recommendations, undefined);
    assert.deepEqual(detailed.value.decisions, [gallery.value.decisions.find((row) => row.orderUuid === car.orderUuid)]);
    assert.equal(detailed.value.decisions[0].snapshot, car.snapshot);
  }
});

test('detailed calculation also retains provider order across multiple candidates', async () => {
  const source = providerValue([stock(3), stock(1), stock(2)]);
  const injected = ports(source);
  const expected = await createEmployeeRecommendationService(injected).recommend(context, brief());
  const detailed = await createAllocationRecommendationEvaluator(injected).quote(context, brief());
  assert.deepEqual(detailed.value.decisions, expected.value.decisions);
  assert.equal(detailed.value.recommendations, undefined);
});

test('compact terms validation refuses every malformed variable input that the gallery refuses', async () => {
  for (const [method, field, value] of [
    ['getPointsCost', 'monthlyPoints', -1], ['getPointsCost', 'monthlyPoints', NaN],
    ['getPointsCost', 'monthlyPoints', '100'], ['getPointsCost', 'source', ''],
    ['getPointsCost', 'source', null], ['getAllowance', 'monthlyPoints', -1],
    ['getAllowance', 'monthlyPoints', Infinity], ['getAllowance', 'monthlyPoints', '100'],
  ]) {
    const supplied = policy(); const original = supplied[method].bind(supplied);
    supplied[method] = async (...args) => { const outcome = await original(...args); return { ...outcome, value: { ...outcome.value, [field]: value } }; };
    const injected = ports(providerValue(), { policy: supplied });
    const expected = await createEmployeeRecommendationService(injected).recommend(context, brief());
    assert.equal(expected.status, 'unavailable', `${method}.${field}`);
    for (const mode of ['evaluate', 'quote']) assert.deepEqual(await createAllocationRecommendationEvaluator(injected)[mode](context, brief()), expected);
  }
});

test('invalid term validity remains unavailable in both internal paths', async () => {
  for (const seconds of [0.00001, 1e20]) {
    const supplied = policy(); const original = supplied.getAssumption.bind(supplied);
    supplied.getAssumption = async (key, ...args) => {
      const outcome = await original(key, ...args);
      return key === 'employee.recommendation.v1' ? { ...outcome, value: { ...outcome.value, value: { ...outcome.value.value, termValiditySeconds: seconds } } } : outcome;
    };
    const injected = ports(providerValue(), { policy: supplied });
    const expected = await createEmployeeRecommendationService(injected).recommend(context, brief());
    assert.equal(expected.status, 'unavailable');
    for (const mode of ['evaluate', 'quote']) assert.deepEqual(await createAllocationRecommendationEvaluator(injected)[mode](context, brief()), expected);
  }
});

test('internal paths keep the same context, clock, request and provider failure boundaries', async () => {
  for (const overrides of [{ provider: undefined }, { time: undefined }, { policy: undefined },
    { provider: provider({ ...providerValue(), runId: 'old' }) }, { provider: provider({ ...providerValue(), stock: null }) },
    { time: { now: async () => ({ status: 'stale-run' }) } }]) {
    const injected = ports(providerValue(), overrides);
    const expected = await createEmployeeRecommendationService(injected).recommend(context, brief());
    for (const mode of ['evaluate', 'quote']) assert.deepEqual(await createAllocationRecommendationEvaluator(injected)[mode](context, brief()), expected);
  }
  const injected = ports();
  for (const owner of [null, { ...context, roles: [] }, { ...context, gradeId: '' }]) {
    const expected = await createEmployeeRecommendationService(injected).recommend(owner, brief());
    assert.deepEqual(await createAllocationRecommendationEvaluator(injected).evaluate(owner, brief()), expected);
  }
  assert.equal((await createAllocationRecommendationEvaluator(injected).evaluate(context, { ...brief(), limit: 1 })).status, 'invalid');
});

test('public, preview and stored-subject service shapes remain unchanged', async () => {
  const injected = ports(providerValue([stock(3), stock(1), stock(2)]));
  const service = createEmployeeRecommendationService(injected);
  assert.deepEqual(Object.keys(service), ['recommend', 'previewUnsaved']);
  const { roles, ...subject } = context;
  const stored = createStoredSubjectRecommendationEvaluator(injected);
  assert.deepEqual(Object.keys(stored), ['evaluate']);
  assert.deepEqual(await stored.evaluate(subject, brief()), await service.recommend(context, brief()));
  const { briefVersion, ...content } = brief();
  const preview = await service.previewUnsaved(context, { brief: content, baseBriefVersion: briefVersion, baseDraftVersion: 0 });
  assert.equal(preview.value.preview.kind, 'unsaved-draft');
  assert.deepEqual(preview.value.decisions, preview.value.recommendations);
  assert.ok(preview.value.decisions.every((row) => row.snapshot && row.terms && row.evidence && row.preview));
});


test('invalid gallery ranking policy cannot become a compact or detailed success', async () => {
  for (const ranking of [null, { rule: 'other', fitTolerance: 5 }, { rule: 'similarFitThenPoints', fitTolerance: -1 },
    { rule: 'similarFitThenPoints', fitTolerance: 101 }, { rule: 'similarFitThenPoints', fitTolerance: '5' }]) {
    const supplied = policy(); const original = supplied.getAssumption.bind(supplied);
    supplied.getAssumption = async (key, ...args) => {
      const outcome = await original(key, ...args);
      return key === 'employee.recommendation.v1' ? { ...outcome, value: { ...outcome.value, value: { ...outcome.value.value, ranking } } } : outcome;
    };
    const injected = ports(providerValue(), { policy: supplied });
    const expected = await createEmployeeRecommendationService(injected).recommend(context, brief());
    assert.equal(expected.status, 'unavailable');
    for (const mode of ['evaluate', 'quote']) assert.deepEqual(await createAllocationRecommendationEvaluator(injected)[mode](context, brief()), expected);
  }
});

test('same candidates construct no terms graphs and perform no gallery sorts in compact mode', async (t) => {
  const source = providerValue(Array.from({ length: 8 }, (_, i) => stock(8 - i)));
  const injected = ports(source); const metrics = {};
  for (const mode of ['gallery', 'evaluate', 'quote']) {
    const originalFreeze = Object.freeze; const originalSort = Array.prototype.sort;
    const terms = new WeakSet(); let termsGraphs = 0; let gallerySorts = 0;
    Object.freeze = (value) => {
      if (value?.kind === 'employee-scheme' && value.termsVersion && !terms.has(value)) { terms.add(value); termsGraphs += 1; }
      return originalFreeze(value);
    };
    Array.prototype.sort = function compare(...args) {
      if (this.length && this.every((row) => row?.orderUuid && row.gateStatus)) gallerySorts += 1;
      return originalSort.apply(this, args);
    };
    try {
      const outcome = mode === 'gallery' ? await createEmployeeRecommendationService(injected).recommend(context, brief())
        : await createAllocationRecommendationEvaluator(injected)[mode](context, brief());
      assert.equal(outcome.status, 'ok'); assert.equal(outcome.value.decisions.length, source.stock.length);
    } finally { Object.freeze = originalFreeze; Array.prototype.sort = originalSort; }
    metrics[mode] = { termsGraphs, gallerySorts };
  }
  assert.deepEqual(metrics.gallery, { termsGraphs: 8, gallerySorts: 2 });
  assert.deepEqual(metrics.evaluate, { termsGraphs: 0, gallerySorts: 0 });
  assert.deepEqual(metrics.quote, { termsGraphs: 8, gallerySorts: 0 });
  t.diagnostic(JSON.stringify({ candidates: source.stock.length, metrics }));
});
