import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService } from '../gcsp/policy/index.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { projectCurrentCarBaseline } from '../gcsp/recommendation/current-car.js';
import { context, fact, brief, stock, providerValue, provider, time, preference,
  currentCar, rating, sameAgain } from './helpers/employee-recommendation.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const policy = (edit = () => {}) => {
  const value = structuredClone(seed); edit(value);
  return new PolicyService({ provider: { loadVersions: async () => [value] } });
};
const evaluate = ({ baseline = currentCar(), cars = [stock()], rules = policy(), feedback = { currentCarRating: rating(5) }, preferences = {} } = {}) => {
  const source = providerValue(cars); source.currentCar = baseline;
  return createEmployeeRecommendationService({ provider: provider(source), policy: rules, time })
    .recommend(context, { ...brief(), preferences, ...feedback });
};

test('active positive feedback and Same again cannot fall back to unrelated offers without a baseline', async () => {
  for (const feedback of [{ currentCarRating: rating(5) }, { sameAgain: sameAgain(true) }]) {
    const out = await evaluate({ baseline: null, feedback });
    assert.equal(out.status, 'unavailable');
    assert.equal(out.code, 'feedback-baseline-unavailable');
  }
  assert.equal((await evaluate({ baseline: null, feedback: { currentCarRating: rating(3) } })).status, 'ok');
  assert.equal((await evaluate({ baseline: null, feedback: { sameAgain: sameAgain(false) } })).status, 'ok');
});

test('active feedback cannot be silently ignored if its policy is unavailable', async () => {
  const rules = policy((s) => { s.assumptions = s.assumptions.filter((r) => r.key !== 'employee.currentCarFeedback.v1'); });
  for (const feedback of [{ currentCarRating: rating(5) }, { sameAgain: sameAgain(true) }]) {
    const out = await evaluate({ rules, feedback });
    assert.equal(out.status, 'unavailable');
    assert.equal(out.code, 'feedback-policy-unavailable');
  }
  assert.equal((await evaluate({ rules, feedback: {} })).status, 'ok');
});

test('unconfirmed candidate performance cannot prove an improvement over confirmed current-car performance', async () => {
  for (const assurance of ['model-reference', 'derived']) {
    const out = await evaluate({ cars: [stock(1, { body: fact('suv'), zeroTo62: fact(4, 's', assurance) })],
      preferences: { sportiness: preference(100) } });
    assert.equal(out.status, 'ok');
    assert.equal(out.value.recommendations.length, 0);
    assert.equal(out.value.decisions[0].feedback.improvement, 'unknown');
  }
});

test('confirmed different negative-rating recommendations carry their explanation into Offer reasons', async () => {
  const out = await evaluate({ cars: [stock(1, { body: fact('suv') })], feedback: { currentCarRating: rating(1) } });
  assert.equal(out.status, 'ok');
  assert.ok(out.value.recommendations[0].reasons.some((r) => r.code === 'feedback-different'));
});

test('Same again requires the confirmed configuration as well as the same model and engine', async () => {
  const baseline = currentCar({ ...Object.fromEntries(Object.entries(currentCar().facts).map(([key, f]) => [key, f.value])), configurationId: 'RzIxOlMx' });
  const out = await evaluate({ baseline, cars: [stock(1), stock(2, {}, 'RzIxOlMy')], feedback: { sameAgain: sameAgain(true) } });
  assert.equal(out.status, 'ok');
  assert.deepEqual(out.value.recommendations.map((r) => r.orderUuid), [stock(1).orderUuid]);
  const unknown = await evaluate({ baseline: currentCar({ ...Object.fromEntries(Object.entries(baseline.facts).map(([key, f]) => [key, f.value])), configurationId: null }), feedback: { sameAgain: sameAgain(true) } });
  assert.equal(unknown.value.recommendations.length, 0);
});

test('current-car specification identity is optional, canonical and can exceed a display label length', async () => {
  const configurationId = Buffer.from(`G21:${Array.from({ length: 60 }, (_, i) => `S${String(i).padStart(4, '0')}`).join(',')}`).toString('base64');
  assert.ok(configurationId.length > 256);
  const source = { mode: 'synthetic', sourceRef: 'fixture:contract', sourceVersion: 'contract-v1', schemaVersion: '1',
    effectiveFrom: '2026-11-05T00:00:00.000Z', observedAt: '2026-11-05T00:00:00.000Z' };
  const contract = { contractId: 'current:employee-test', employeeId: context.employeeId, schemeId: context.schemeId,
    status: 'current', source, vehicle: { configurationId } };
  const input = { manualContext: { source, contracts: [contract] }, contractId: contract.contractId, context, now: '2026-11-05T12:00:00.000Z' };
  assert.equal(projectCurrentCarBaseline(input).facts.configurationId.value, configurationId);
  const baseline = currentCar({ ...Object.fromEntries(Object.entries(currentCar().facts).map(([key, f]) => [key, f.value])), configurationId });
  const out = await evaluate({ baseline, cars: [stock(1, {}, configurationId)], feedback: { sameAgain: sameAgain(true), currentCarRating: rating(1) } });
  assert.equal(out.value.recommendations.length, 1);
  for (const bad of [undefined, 'not-a-configuration', Buffer.from('G21:S2,S1').toString('base64')]) {
    contract.vehicle.configurationId = bad;
    assert.equal(projectCurrentCarBaseline(input).facts.configurationId, undefined);
  }
});
