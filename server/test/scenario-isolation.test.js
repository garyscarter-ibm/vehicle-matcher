import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRANDS, brandTuning } from '../brands.js';
import { USED_RETAIL_V1 } from '../scenarios/retail/index.js';
import { bmwPool, fakeStock, startTestServer, get } from './helpers.js';
import { MODES } from '../../blocks/vehicle-matcher/modes/index.js';
import { brief, providerValue, stock, fact } from './helpers/employee-recommendation.js';
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

/* ---- FUCQ-27: retail profile binding and isolation ---- */

const retailAnswers = { bodyStyles: ['any'], fuel: ['open'], charging: 'none', primaryUse: 'city', people: 'solo', budget: [0, 90000] };
const retailDeps = (pool) => ({ fetchRetailerStock: fakeStock({ bmw: pool }), fetchNearbyStock: async () => [],
  enrichColours: async (_brand, cars) => cars, fetchDealerDirectory: async () => new Map(), geocodePostcode: async () => null });
const rawPost = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
};
// Keeps functions by reference so deepStrictEqual proves identity, not just shape.
const cloneKeepingFunctions = (value) => {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(cloneKeepingFunctions);
  return Object.fromEntries(Reflect.ownKeys(value).map((key) => [key, cloneKeepingFunctions(value[key])]));
};
const deepFreeze = (value) => {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
};

test('request fields cannot select or alter the retail profile', async () => {
  const server = await startTestServer(retailDeps(bmwPool(6)));
  const port = Number(new URL(server.base).port);
  try {
    const plain = await rawPost(port, '/api/match', { answers: retailAnswers });
    assert.equal(plain.status, 200);
    const extra = await rawPost(port, '/api/match', { answers: retailAnswers, scenario: 'employee-scheme-demo-v1',
      profile: 'x', policyVersion: 'x', tasteShare: 0.9, weights: { body: 99 }, tuning: { weights: { body: 99 } },
      retailBudgetEnabled: false });
    assert.equal(extra.status, plain.status);
    assert.equal(extra.text, plain.text);
  } finally { await server.close(); }
});

test('employee rules cannot mutate registry tuning or change the retail response', async () => {
  const snapshot = () => Object.fromEntries(Object.keys(BRANDS).map((b) => [b, cloneKeepingFunctions(brandTuning(b))]));
  const before = snapshot();
  const dir = mkdtempSync(join(tmpdir(), 'dev047-policy-'));
  const altPath = join(dir, 'seed-alt.json');
  const seed = JSON.parse(readFileSync(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const rule = seed.assumptions.find((a) => a.key === 'employee.recommendation.v1');
  rule.value.tuning.weights = { body: 0, economy: 1, performance: 0 };
  rule.value.displayLimit = 1;
  writeFileSync(altPath, JSON.stringify(seed));
  const provider = { async resolve(context) { return { status: 'ok', value: { ...providerValue([stock(1), stock(2, { mpg: fact(60, 'mpg-imperial') })]),
    runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId } }; } };
  const clock = { async now(context) { return { status: 'ok', value: { now: EMPLOYEE_INSTANT, runId: context.runId, clockVersion: 'isolation-clock-v1' } }; } };
  const fixture = await createEmployeeHttpFixture({ gcspRecommendations: { provider, policy: createPolicyService(), time: clock },
    retailDependencies: retailDeps(bmwPool(6)) });
  try {
    const port = fixture.server.address().port;
    const retail = () => rawPost(port, '/api/match', { answers: retailAnswers });
    const first = await retail();
    assert.equal(first.status, 200);
    const employeeA = await fixture.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(employeeA.status, 200);
    assert.deepEqual(snapshot(), before);
    const between = await retail();
    assert.equal(between.text, first.text);
    const alt = await createEmployeeHttpFixture({ gcspRecommendations: { provider, policy: createPolicyService({ filePath: altPath }), time: clock },
      retailDependencies: retailDeps(bmwPool(6)) });
    try {
      const employeeB = await alt.request('/api/gcsp/recommendations', { body: brief() });
      assert.equal(employeeB.status, 200);
      assert.notDeepEqual(employeeB.json, employeeA.json);
    } finally { await alt.close(); }
    assert.deepEqual(snapshot(), before);
    assert.equal((await retail()).text, first.text);
  } finally {
    await fixture.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the retail scenario is pure: no I/O imports and no fetch, inputs untouched', () => {
  const dir = new URL('../scenarios/retail/', import.meta.url);
  const banned = /(\/stock\.js|\/index\.js|\/mapping\.js|\/dealers\.js|\/geocode\.js|\/gcsp\/|node:)/;
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 3);
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const [, specifier] of source.matchAll(/\bfrom\s+'([^']+)'/g)) {
      const allowed = specifier === '../../recommendation/index.js' || !banned.test(specifier);
      assert.ok(allowed, `${file} imports ${specifier}`);
    }
    assert.ok(!/node:(fs|http|https|net)/.test(source), `${file} imports I/O`);
    assert.ok(!/\bfetch\(/.test(source), `${file} calls fetch`);
  }
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; throw new Error('retail evaluation must not fetch'); };
  try {
    const cars = deepFreeze(bmwPool(8));
    const answers = deepFreeze(structuredClone(retailAnswers));
    const tuning = deepFreeze(cloneKeepingFunctions(brandTuning('bmw')));
    const carsBefore = structuredClone(cars);
    const result = USED_RETAIL_V1.matchCars(answers, cars, tuning);
    assert.ok(result.matches.length > 0);
    assert.equal(calls, 0);
    assert.deepEqual(cars, carsBefore);
    assert.deepEqual(answers, retailAnswers);
  } finally { globalThis.fetch = realFetch; }
});

test('Guess Who bypasses weighted matching and the pool ignores answers', async () => {
  const source = readFileSync(new URL('../../blocks/vehicle-matcher/modes/guess-who.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/engine\.js'/g)];
  assert.equal(imports.length, 1);
  assert.deepEqual(imports[0][1].split(',').map((n) => n.trim()).filter(Boolean), ['apiPool', 'apiGeocode']);
  const pool = bmwPool(5);
  const server = await startTestServer(retailDeps(pool));
  try {
    const plain = await get(server.base, '/api/pool?brand=bmw&scope=national');
    const withAnswers = await get(server.base,
      `/api/pool?brand=bmw&scope=national&answers=${encodeURIComponent(JSON.stringify(retailAnswers))}&scenario=employee-scheme-demo-v1`);
    assert.equal(plain.status, 200);
    assert.equal(withAnswers.text, plain.text);
    assert.deepEqual(plain.json.id, pool.map((car) => car.id));
  } finally { await server.close(); }
});

test('USED_RETAIL_V1 is frozen and server wiring binds it explicitly', () => {
  assert.ok(Object.isFrozen(USED_RETAIL_V1));
  assert.ok(Object.isFrozen(USED_RETAIL_V1.limits));
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(index, /const RETAIL_PROFILE = USED_RETAIL_V1;/);
  assert.match(index, /from '\.\/scenarios\/retail\/index\.js'/);
  assert.ok(!/from '\.\/engine\.js'/.test(index), 'index.js must not import the engine facade');
  assert.ok(!/(?<![\w.])(matchCars|rankCars|groupListings|unmetWants)\(/.test(index.replace(/RETAIL_PROFILE\.\w+\(/g, '')));
});
