import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRANDS } from '../brands.js';
import { bmwPool, fakeStock } from './helpers.js';
import { MODES } from '../../blocks/vehicle-matcher/modes/index.js';
import { brief, providerValue, stock } from './helpers/employee-recommendation.js';
import { createEmployeeHttpFixture, EMPLOYEE_INSTANT } from './helpers/employee-recommendation-http.js';
import { createPolicyService } from '../gcsp/policy/index.js';

const expectedBrands = ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari'];
const expectedModes = ['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who'];

test('retail compatibility metadata retains six brands and five registered modes', () => {
  assert.deepEqual(Object.keys(BRANDS).sort(), [...expectedBrands].sort());
  assert.deepEqual(MODES.map((mode) => mode.key), expectedModes);
  const expected = JSON.parse(readFileSync(new URL('./fixtures/retail-compat-v1/expected.json', import.meta.url), 'utf8'));
  for (const brand of expectedBrands) {
    assert.ok(Object.hasOwn(expected.server, `${brand}/questions`), `${brand} questions fixture`);
    assert.ok(Object.hasOwn(expected.server, `${brand}/pool`), `${brand} pool fixture`);
    assert.ok(Object.hasOwn(expected.client, `${brand}/guess-who`), `${brand} client fixture`);
  }
});

test('employee and retail routes use separate providers and retail keeps its cash budget gate', async () => {
  const insideBudget = bmwPool(1)[0];
  const outsideBudget = { ...structuredClone(insideBudget), id: 'fixture-above-budget',
    priceMin: insideBudget.priceMin + 100000, priceMax: insideBudget.priceMax + 100000 };
  const retailPool = [insideBudget, outsideBudget];
  const fetchRetailerStock = fakeStock({ bmw: retailPool });
  const employeeCalls = [];
  const provider = { async resolve(context) {
    employeeCalls.push(structuredClone(context));
    return { status: 'ok', value: { ...providerValue([stock()]), runId: context.runId,
      environmentId: context.environmentId, employeeId: context.employeeId } };
  } };
  const clock = { async now(context) { return { status: 'ok', value: {
    now: EMPLOYEE_INSTANT, runId: context.runId, clockVersion: 'isolation-clock-v1',
  } }; } };
  const fixture = await createEmployeeHttpFixture({ gcspRecommendations: {
    provider, policy: createPolicyService(), time: clock,
  }, retailDependencies: { fetchRetailerStock, fetchNearbyStock: async () => [],
    enrichColours: async (_brand, cars) => cars, fetchDealerDirectory: async () => new Map(),
    geocodePostcode: async () => null } });
  try {
    const employee = await fixture.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(employee.status, 200);
    assert.equal(fetchRetailerStock.calls.length, 0);
    assert.equal(employeeCalls.length, 1);
    assert.equal(employeeCalls[0].employeeId, 'employee-paula');

    const answers = { bodyStyles: ['any'], fuel: ['open'], charging: 'none', primaryUse: 'city', people: 'solo' };
    const narrowBudget = await fixture.request('/api/match', { body: {
      answers: { ...answers, budget: [0, insideBudget.priceMax + 500] }, retailBudgetEnabled: false,
    } });
    assert.equal(narrowBudget.status, 200);
    assert.equal(narrowBudget.json.matches.length, 1);
    assert.equal(narrowBudget.json.matches[0].listings.length, 1);
    assert.equal(narrowBudget.json.matches[0].listings[0].id, insideBudget.id);
    assert.equal(fetchRetailerStock.calls.length, 1);
    assert.equal(fetchRetailerStock.calls[0].brand, 'bmw');
    assert.equal(employeeCalls.length, 1);

    const wideBudget = await fixture.request('/api/match', { body: {
      answers: { ...answers, budget: [0, outsideBudget.priceMax + 500] },
    } });
    assert.equal(wideBudget.status, 200);
    assert.equal(wideBudget.json.matches[0].listings.length, 2);
    assert.equal(fetchRetailerStock.calls.length, 2);
    assert.equal(employeeCalls.length, 1);

    const missingBudget = await fixture.request('/api/match', { body: {
      answers: { bodyStyles: ['any'] }, retailBudgetEnabled: false,
    } });
    assert.equal(missingBudget.status, 400);
    assert.equal(fetchRetailerStock.calls.length, 2);
    assert.equal(employeeCalls.length, 1);
  } finally { await fixture.close(); }
});
