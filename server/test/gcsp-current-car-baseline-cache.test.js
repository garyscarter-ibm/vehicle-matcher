import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import * as employee from '../scenarios/employee/index.js';
import { context, fact, brief, stock, providerValue, provider, time, policy, preference,
  currentCar, rating, sameAgain } from './helpers/employee-recommendation.js';

const recommendationUrl = new URL('../gcsp/recommendation/index.js', import.meta.url);
const feedbackUrl = new URL('../gcsp/recommendation/current-car.js', import.meta.url);
const employeeUrl = new URL('../scenarios/employee/index.js', import.meta.url);

// Load the real service sources with only the scorer import wrapped. The uncached variant
// recreates the former per-candidate baseline calculation, without maintaining a second formula.
async function instrumented({ uncached = false } = {}) {
  const baselineCalls = [];
  const bridge = (namespace, identifier) => new SyntheticModule(Object.keys(namespace), function () {
    for (const [name, value] of Object.entries(namespace)) this.setExport(name, value);
  }, { identifier });
  const scoring = bridge({ ...employee, scorePreferences(snapshot, request, facts, config, slider) {
    if (snapshot.display.name === 'current car') baselineCalls.push({ snapshot, request, facts });
    return employee.scorePreferences(snapshot, request, facts, config, slider);
  } }, employeeUrl.href);
  const dependencies = new Map([[employeeUrl.href, scoring]]);
  const link = async (specifier, referencing) => {
    const url = new URL(specifier, referencing.identifier);
    if (!dependencies.has(url.href)) dependencies.set(url.href, bridge(await import(url.href), url.href));
    return dependencies.get(url.href);
  };
  const feedback = new SourceTextModule(await readFile(feedbackUrl, 'utf8'), { identifier: feedbackUrl.href });
  await feedback.link(link);
  await feedback.evaluate();
  dependencies.set(feedbackUrl.href, bridge({ ...feedback.namespace,
    compareImprovement: uncached ? ({ baselineScores, ...inputs }) => feedback.namespace.compareImprovement(inputs)
      : feedback.namespace.compareImprovement,
  }, feedbackUrl.href));
  const service = new SourceTextModule(await readFile(recommendationUrl, 'utf8'), { identifier: recommendationUrl.href });
  await service.link(link);
  await service.evaluate();
  return { ...service.namespace, baselineCalls };
}

const cars = () => [
  stock(1, { modelLine: fact('G21 Touring') }),
  stock(2, { modelLine: fact('G20 Saloon'), eligibilityModelKey: fact('G20 Saloon|320i'), body: fact('saloon') }),
  stock(3), // Unknown similarity still needs the improvement comparison.
  stock(4, { modelLine: fact('U11 X1'), eligibilityModelKey: fact('U11 X1|20i'), body: fact('suv'), zeroTo62: fact(5, 's') }),
];
const source = () => ({ ...providerValue(cars()), currentCar: currentCar() });
const request = () => ({ ...brief(), preferences: { sportiness: preference(80) }, currentCarRating: rating(5) });
const ids = (rows) => rows.map((row) => Number(row.orderUuid.slice(-1)));
const create = (module, value) => module.createEmployeeRecommendationService({ provider: provider(value), policy: policy(), time });
const recommend = (service, input = request(), subject = context) => service.recommend(subject, input);

test('multi-candidate evaluation scores the baseline once with identical decisions, explanations and order', async () => {
  const cached = await instrumented(); const uncached = await instrumented({ uncached: true });
  const actual = await recommend(create(cached, source()));
  const former = await recommend(create(uncached, source()));
  assert.equal(actual.status, 'ok');
  assert.deepEqual(actual, former);
  assert.equal(cached.baselineCalls.length, 1);
  assert.equal(uncached.baselineCalls.length, 3);
  assert.deepEqual(ids(actual.value.decisions), [1, 2, 3, 4]);
  assert.deepEqual(ids(actual.value.recommendations), [4, 1, 2]);
  const compared = actual.value.decisions.filter((row) => row.feedback.improvement !== null);
  assert.deepEqual(ids(compared), [2, 3, 4]);
  assert.deepEqual(compared.map((row) => row.feedback.similarity), ['different', 'unknown', 'different']);
  assert.ok(compared.every((row) => row.feedback.improvement === 'proven'));
  assert.ok(compared.every((row) => row.reasons.some((reason) => reason.code === 'feedback-improvement')));
});

test('inactive feedback and unexpressed preferences never score the baseline', async () => {
  const cached = await instrumented(); const uncached = await instrumented({ uncached: true });
  const cases = [
    { name: 'no feedback', input: brief() },
    { name: 'neutral', input: { ...request(), currentCarRating: rating(3) } },
    { name: 'negative', input: { ...request(), currentCarRating: rating(1) } },
    { name: 'Same again precedence', input: { ...request(), sameAgain: sameAgain(true) } },
    { name: 'similar', value: { ...source(), stock: [cars()[0]] } },
    { name: 'gated', value: { ...source(), stock: [stock(2, { body: fact('saloon'), seats: fact(4, 'count') })] } },
    { name: 'no preferences', input: { ...request(), preferences: {} } },
    { name: 'zero importance', input: { ...request(), preferences: { sportiness: preference(80, 0) } } },
    { name: 'contract mismatch', input: { ...request(), currentCarRating: rating(5, 'current:other') } },
  ];
  for (const { name, input = request(), value = source() } of cases) {
    const actual = await recommend(create(cached, value), input);
    assert.equal(actual.status, 'ok', name);
    assert.deepEqual(actual, await recommend(create(uncached, value), input), name);
    assert.equal(cached.baselineCalls.length, 0, name);
    assert.equal(uncached.baselineCalls.length, 0, name);
  }
});

test('repeated, changed and concurrent employee evaluations own independent baseline scores', async () => {
  const cached = await instrumented(); const uncached = await instrumented({ uncached: true });
  let value = source();
  const ports = { provider: { async resolve() { return { status: 'ok', value }; } }, policy: policy(), time };
  const service = cached.createEmployeeRecommendationService(ports);
  const former = uncached.createEmployeeRecommendationService(ports);
  const inputs = [request(), request(), { ...request(), preferences: { sportiness: preference(20) } }, request()];
  for (const [index, input] of inputs.entries()) {
    if (index === 3) {
      value = source(); value.currentCar.facts.zeroTo62 = fact(4, 's');
      value.employeeFacts.annualMileage = fact(30000, 'mi/year');
    }
    const actual = await recommend(service, input);
    assert.equal(actual.status, 'ok');
    assert.deepEqual(actual, await recommend(former, input));
    assert.equal(cached.baselineCalls.length, index + 1);
  }
  assert.equal(cached.baselineCalls[2].request.preferences.sportiness.value, 20);
  assert.equal(cached.baselineCalls[3].snapshot.facts.zeroTo62.value, 4);
  assert.equal(cached.baselineCalls[3].facts.annualMileage.value, 30000);

  const other = { ...context, employeeId: 'employee-other' };
  const values = { [context.employeeId]: source(), [other.employeeId]: { ...value, employeeId: other.employeeId } };
  const concurrentPorts = { ...ports, provider: { async resolve(subject) { return { status: 'ok', value: values[subject.employeeId] }; } } };
  const shared = cached.createEmployeeRecommendationService(concurrentPorts);
  const oldShared = uncached.createEmployeeRecommendationService(concurrentPorts);
  const subjects = [context, other];
  const actual = await Promise.all(subjects.map((subject) => recommend(shared, request(), subject)));
  const expected = await Promise.all(subjects.map((subject) => recommend(oldShared, request(), subject)));
  assert.ok(actual.every((row) => row.status === 'ok'));
  assert.deepEqual(actual, expected);
  assert.equal(cached.baselineCalls.length, 6);
  assert.equal(uncached.baselineCalls.length, 18);
  assert.notDeepEqual(actual[0].value.decisions.map((row) => row.feedback), actual[1].value.decisions.map((row) => row.feedback));
});

test('missing or unconfirmed baseline and candidate preference facts keep improvement unknown', async () => {
  const cached = await instrumented(); const uncached = await instrumented({ uncached: true });
  const missing = source(); delete missing.currentCar.facts.zeroTo62;
  const unconfirmed = source(); unconfirmed.currentCar.facts.zeroTo62 = fact(7.6, 's', 'model-reference');
  const candidateUnknown = source();
  candidateUnknown.stock = [stock(2, { body: fact('saloon'), zeroTo62: fact(null, 's') }),
    stock(3, { body: fact('saloon'), zeroTo62: fact(null, 's') })];
  for (const [index, value] of [missing, unconfirmed, candidateUnknown].entries()) {
    const actual = await recommend(create(cached, value));
    assert.equal(actual.status, 'ok');
    assert.deepEqual(actual, await recommend(create(uncached, value)));
    const compared = actual.value.decisions.filter((row) => row.feedback.similarity !== 'similar');
    assert.ok(compared.length >= 2);
    assert.ok(compared.every((row) => row.feedback.improvement === 'unknown' && row.feedback.effect === 'omitted'));
    assert.equal(cached.baselineCalls.length, index + 1);
  }
});

test('frozen allocation quote replay keeps its pinned baseline and the independent static cache', async () => {
  const cached = await instrumented(); const uncached = await instrumented({ uncached: true });
  const upstream = source(); const frozen = structuredClone(upstream);
  const staticCache = cached.createStaticSuitabilityCache();
  const ports = { provider: provider(frozen), policy: policy(), time, staticCache };
  const evaluator = cached.createAllocationRecommendationEvaluator(ports);
  const former = uncached.createAllocationRecommendationEvaluator({ ...ports, staticCache: undefined });
  const input = request();
  const prepared = await evaluator.quote(context, input);
  assert.equal(prepared.status, 'ok');
  assert.deepEqual(prepared, await former.quote(context, input));
  assert.equal(cached.baselineCalls.length, 1);
  assert.equal(staticCache.stats().computations, 4);
  upstream.currentCar.facts.zeroTo62 = fact(1, 's');
  upstream.currentCar.source.sourceVersion = 'upstream-changed';
  const oneCar = { ...frozen, stock: [frozen.stock[1]] };
  const replay = cached.createAllocationRecommendationEvaluator({ ...ports, provider: provider(oneCar) });
  const first = await replay.quote(context, input);
  assert.equal(first.status, 'ok');
  assert.deepEqual(first.value.decisions[0], prepared.value.decisions[1]);
  assert.deepEqual(await replay.quote(context, input), first);
  assert.equal(cached.baselineCalls.length, 3, 'each replay owns a new local baseline score');
  assert.equal(staticCache.stats().computations, 4, 'candidate scores still use the existing static cache');
  assert.equal(staticCache.stats().hits, 2);
  const live = await recommend(create(cached, upstream));
  assert.equal(live.status, 'ok');
  assert.notDeepEqual(live.value.decisions[1].feedback, first.value.decisions[0].feedback);
  assert.equal(first.value.decisions[0].feedback.baseline.sourceVersion, 'manual-records-v1');
  assert.equal(first.value.decisions[0].feedback.improvement, 'proven');
});
