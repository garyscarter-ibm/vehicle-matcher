import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService } from '../gcsp/policy/index.js';
import { brief, fact, preference, stock, providerValue } from './helpers/employee-recommendation.js';
import { createEmployeeHttpFixture, EMPLOYEE_INSTANT, EMPLOYEE_ORIGIN, startHttpServer } from './helpers/employee-recommendation-http.js';

const sourceFor = (context, cars = [stock()]) => ({ ...providerValue(cars),
  runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId });
const providerFor = (resolve) => ({ async resolve(context) { return resolve(context); } });
const domainTime = { async now(context) { return { status: 'ok', value: {
  now: EMPLOYEE_INSTANT, runId: context.runId, clockVersion: 'clock-v1',
} }; } };
const configured = (provider, policy = createPolicyService(), time = domainTime) => ({ provider, policy, time });
const resultBody = () => ({ ...brief(), preferences: { body: preference('estate') }, essentials: { seats: {
  value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee',
} } });

async function withFixture(options, work) {
  const fixture = await createEmployeeHttpFixture(options);
  try { await work(fixture); } finally { await fixture.close(); }
}

test('built-in route resolves identity before service, enforces employee role and exact origin', async () => {
  let providerCalls = 0;
  const provider = providerFor((context) => {
    providerCalls += 1;
    return { status: 'ok', value: sourceFor(context) };
  });
  await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
    const missing = await f.request('/api/gcsp/recommendations', { session: null, body: brief() });
    assert.equal(missing.status, 401);
    assert.equal(missing.json.status, 'missing-session');
    assert.equal((await f.request('/api/gcsp/recommendations', { session: f.greg, body: brief() })).status, 403);
    assert.equal((await f.request('/api/gcsp/recommendations', { session: f.presenter, body: brief() })).status, 403);
    const forbiddenOrigin = await f.request('/api/gcsp/recommendations', { body: brief(), origin: 'https://hostile.test' });
    assert.equal(forbiddenOrigin.status, 403);
    assert.equal(forbiddenOrigin.json.status, 'forbidden');
    assert.equal(forbiddenOrigin.headers.get('cache-control'), 'no-store');
    assert.equal(forbiddenOrigin.headers.get('access-control-allow-origin'), 'null');
    assert.equal(providerCalls, 0);
  });
});

test('built-in route retains the shared access-key gate', async () => {
  let providerCalls = 0;
  const provider = providerFor((context) => {
    providerCalls += 1;
    return { status: 'ok', value: sourceFor(context) };
  });
  const oldKey = process.env.DEMO_ACCESS_KEY;
  await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
    process.env.DEMO_ACCESS_KEY = 'recommendation-route-test-key';
    try {
      const missing = await f.request('/api/gcsp/recommendations', { body: brief() });
      const wrong = await f.request('/api/gcsp/recommendations', { body: brief(), headers: { 'X-Access-Key': 'wrong-test-key' } });
      assert.equal(missing.status, 401);
      assert.equal(wrong.status, 401);
      assert.equal(providerCalls, 0);
      const valid = await f.request('/api/gcsp/recommendations', { body: brief(), headers: { 'X-Access-Key': 'recommendation-route-test-key' } });
      assert.equal(valid.status, 200);
      assert.equal(providerCalls, 1);
    } finally {
      if (oldKey === undefined) delete process.env.DEMO_ACCESS_KEY;
      else process.env.DEMO_ACCESS_KEY = oldKey;
    }
  });
});

test('missing identity or recommendation dependencies fail closed after the shared boundary', async () => {
  const noIdentity = await startHttpServer();
  try {
    const response = await noIdentity.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(response.status, 503);
    assert.equal(response.json.status, 'unavailable');
  } finally { await noIdentity.close(); }

  let providerCalls = 0;
  const provider = providerFor((context) => {
    providerCalls += 1;
    return { status: 'ok', value: sourceFor(context) };
  });
  await withFixture({}, async (f) => {
    const disabled = await f.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(disabled.status, 503);
    assert.equal(disabled.json.status, 'unavailable');
  });
  for (const recommendation of [
    { policy: createPolicyService(), time: domainTime },
    { provider, time: domainTime },
    null,
  ]) {
    await withFixture({ gcspRecommendations: recommendation }, async (f) => {
      const response = await f.request('/api/gcsp/recommendations', { body: brief() });
      assert.equal(response.status, 503);
      assert.equal(response.json.status, 'unavailable');
    });
  }
  assert.equal(providerCalls, 0);
});

test('configured employee receives exact decisions and all server-owned versions without writes', async () => {
  const contexts = [];
  const provider = providerFor((context) => {
    contexts.push(structuredClone(context));
    return { status: 'ok', value: sourceFor(context) };
  });
  await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
    const before = structuredClone(f.store.state);
    const response = await f.request('/api/gcsp/recommendations', { body: resultBody() });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), EMPLOYEE_ORIGIN);
    assert.equal(response.json.status, 'ok');
    assert.equal(response.json.value.state, 'recommendations');
    assert.deepEqual(contexts[0], f.paula.value.context);
    const { value } = response.json;
    assert.equal(value.decisions.length, 1);
    assert.equal(value.recommendations.length, 1);
    assert.deepEqual(value.decisions[0].orderUuid, stock().orderUuid);
    assert.equal(value.decisions[0].configurationId, 'RzIxOlMx');
    assert.equal(value.decisions[0].gateStatus, 'eligible');
    assert.equal(value.decisions[0].suitable, true);
    assert.deepEqual(value.versions, { brief: 1, facts: 'employee-facts-v1', policy: 'gcsp-policy-v1', stock: 'stock-v1', clock: 'clock-v1' });
    assert.deepEqual(value.decisions[0].versions, { brief: 1, facts: 'employee-facts-v1', policy: 'gcsp-policy-v1', stock: 'stock-v1',
      snapshot: 'snapshot-v1', terms: value.decisions[0].terms.termsVersion, clock: 'clock-v1', availability: 'availability-v1' });
    assert.deepEqual(f.store.state, before);
    for (const table of ['briefs', 'holds', 'claims', 'offers', 'notification_outbox']) assert.deepEqual(f.store.state.tables[table], []);
  });
});

test('server rejects query selectors and browser policy, stock, quote and downgrade fields', async () => {
  const provider = providerFor((context) => ({ status: 'ok', value: sourceFor(context) }));
  await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
    for (const query of ['profile=retail', 'stock=other', 'context=other', 'retailBudgetEnabled=false']) {
      const response = await f.request(`/api/gcsp/recommendations?${query}`, { body: brief() });
      assert.equal(response.status, 400, query);
      assert.equal(response.json.status, 'invalid', query);
      assert.ok(response.json.code, query);
    }
    const rejectedFields = ['employeeId', 'gradeId', 'schemeId', 'provider', 'time', 'tuning', 'policy',
      'retailBudgetEnabled', 'price', 'quotes', 'availability', 'stock', 'profile', 'context'];
    for (const field of rejectedFields) {
      const response = await f.request('/api/gcsp/recommendations', { body: { ...brief(), [field]: 'hostile' } });
      assert.equal(response.status, 400, field);
      assert.equal(response.json.status, 'invalid', field);
    }
    for (const key of ['schemeId', 'gradeId']) {
      const response = await f.request('/api/gcsp/recommendations', { body: { ...brief(), [key]: 'unknown' } });
      assert.equal(response.status, 400, key);
      assert.equal(response.json.code, 'browser-context-forbidden');
    }
    const malformed = await f.request('/api/gcsp/recommendations', { body: { schemaVersion: 1, preferences: [], essentials: {} } });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.json.status, 'invalid');
    const prototypeKey = JSON.parse('{"schemaVersion":1,"briefVersion":1,"preferences":{"__proto__":{"value":50,"importance":100,"valueState":"confirmed","importanceState":"confirmed","source":"employee"}},"essentials":{}}');
    const prototype = await f.request('/api/gcsp/recommendations', { body: prototypeKey });
    assert.equal(prototype.status, 400);
    assert.equal(prototype.json.status, 'invalid');
  });
});

test('identity headers cannot widen context and reset makes the previous employee session stale', async () => {
  const observed = [];
  const provider = providerFor((context) => {
    observed.push(structuredClone(context));
    return { status: 'ok', value: sourceFor(context) };
  });
  await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
    const normal = await f.request('/api/gcsp/recommendations', { body: brief(), headers: {
      'X-Employee-Id': 'employee-alex', 'X-Role': 'greg', 'X-Run-Id': 'forged',
      'X-Grade-Id': 'G11-14', 'X-Scheme-Id': 'unknown', 'X-Policy-Version': 'forged',
    } });
    assert.equal(normal.status, 200);
    assert.equal(observed[0].employeeId, 'employee-paula');
    assert.equal(observed[0].gradeId, 'G7');
    await f.resetRun();
    const stale = await f.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.status, 'stale-run');
    assert.equal(observed.length, 1);
  });
});

test('unknown stock, empty stock and source outage remain distinct HTTP outcomes', async () => {
  for (const [source, state] of [
    [() => [], 'no-stock'],
    [() => [stock(1, { seats: fact(null, 'count') })], 'no-viable-stock'],
  ]) {
    const provider = providerFor((context) => ({ status: 'ok', value: sourceFor(context, source()) }));
    await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
      const response = await f.request('/api/gcsp/recommendations', { body: resultBody() });
      assert.equal(response.status, 200);
      assert.equal(response.json.value.state, state);
      if (state === 'no-viable-stock') {
        assert.equal(response.json.value.decisions[0].gateStatus, 'needs-confirmation');
        assert.equal(response.json.value.decisions[0].suitable, false);
        assert.ok(response.json.value.decisions[0].unknowns.some((entry) => entry.code === 'essential-unconfirmed' && entry.field === 'seats'));
        assert.equal(response.json.value.recommendations.length, 0);
      }
    });
  }
  const offline = providerFor(() => ({ status: 'unavailable', reason: 'fixture outage', retryable: true }));
  await withFixture({ gcspRecommendations: configured(offline) }, async (f) => {
    const response = await f.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(response.status, 503);
    assert.equal(response.json.status, 'unavailable');
  });
});

test('all candidates are evaluated before the recommendation display cap', async () => {
  const cars = [stock(1), stock(2), stock(3), stock(4)];
  const provider = providerFor((context) => ({ status: 'ok', value: sourceFor(context, cars) }));
  await withFixture({ gcspRecommendations: configured(provider) }, async (f) => {
    const response = await f.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(response.status, 200);
    assert.equal(response.json.value.decisions.length, 4);
    assert.equal(response.json.value.eligibleCount, 4);
    assert.equal(response.json.value.recommendations.length, 3);
  });
});

function targetShapedScenario(context, cars) {
  const markSource = (fact, sourceRef) => ({ ...structuredClone(fact), provenance: { ...structuredClone(fact.provenance), sourceRef } });
  return {
    employee: {
      employeeId: context.employeeId, companyId: context.companyId, schemeId: context.schemeId, gradeId: context.gradeId,
      factsVersion: 'target-employee-v1', driverEligible: markSource(fact(true), 'target-fixture:employee'),
      essentials: {}, charging: markSource(fact('home'), 'target-fixture:employee'),
      annualMileage: markSource(fact(12000, 'mi/year'), 'target-fixture:employee'),
      requiredBy: markSource(fact('2026-12-01T00:00:00.000Z'), 'target-fixture:employee'),
    },
    orders: cars.map(({ orderUuid, configurationId, availability }) => ({ orderUuid, configurationId, availability: structuredClone(availability) })),
    specifications: Object.fromEntries(cars.map(({ configurationId, snapshot }) => [configurationId, {
      snapshot: { ...structuredClone(snapshot), facts: Object.fromEntries(Object.entries(snapshot.facts)
        .map(([key, value]) => [key, markSource(value, 'target-fixture:specification')])) },
    }])),
    versions: { stock: 'target-stock-v1' },
  };
}

function targetProvider(scenario) {
  return providerFor((context) => {
    if (['employeeId', 'companyId', 'schemeId', 'gradeId'].some((key) => scenario.employee[key] !== context[key])) {
      return { status: 'forbidden', reason: 'Fixture is not bound to this resolved employee.' };
    }
    return { status: 'ok', value: {
      runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
      factsVersion: scenario.employee.factsVersion, stockVersion: scenario.versions.stock,
      employeeFacts: Object.fromEntries(['driverEligible', 'essentials', 'charging', 'annualMileage', 'requiredBy']
        .map((key) => [key, structuredClone(scenario.employee[key])])),
      stock: scenario.orders.map((order) => ({ ...structuredClone(order),
        snapshot: structuredClone(scenario.specifications[order.configurationId].snapshot) })),
    } };
  });
}

test('synthetic and target-shaped adapters compute equivalent exact decisions and changed preferences recompute', async () => {
  const cars = [stock(1), stock(2, { body: fact('saloon') }, 'RzIxOlMy')];
  let target;
  const synthetic = providerFor((context) => ({ status: 'ok', value: sourceFor(context, cars) }));
  const policy = createPolicyService();
  const syntheticRun = await createEmployeeHttpFixture({ gcspRecommendations: configured(synthetic, policy) });
  try {
    target = targetShapedScenario(syntheticRun.paula.value.context, cars);
  } finally { await syntheticRun.close(); }

  const adapters = [synthetic, targetProvider(target)];
  const outputs = [];
  for (const provider of adapters) {
    await withFixture({ gcspRecommendations: configured(provider, policy) }, async (f) => {
      const initial = await f.request('/api/gcsp/recommendations', { body: brief() });
      assert.equal(initial.status, 200);
      const changed = await f.request('/api/gcsp/recommendations', { body: { ...brief(), preferences: { body: preference('saloon') } } });
      assert.equal(changed.status, 200);
      outputs.push({ initial: initial.json.value, changed: changed.json.value });
    });
  }
  const evidenceValues = (entries) => entries.map(({ code, field, score, importance, desired, observed }) => ({
    code, field, score, importance, desired, observed,
  }));
  const computed = (response) => response.decisions.map((decision) => ({ orderUuid: decision.orderUuid,
    configurationId: decision.configurationId, gateStatus: decision.gateStatus, suitable: decision.suitable,
    score: decision.score, components: evidenceValues(decision.components), reasonCodes: decision.reasons.map((row) => row.code),
    blockerCodes: decision.blockers.map((row) => row.code), unknownCodes: decision.unknowns.map((row) => row.code),
    tradeOffs: evidenceValues(decision.tradeOffs) }));
  assert.deepEqual(computed(outputs[0].initial), computed(outputs[1].initial));
  assert.deepEqual(computed(outputs[0].changed), computed(outputs[1].changed));
  assert.equal(outputs[0].initial.recommendations[0].orderUuid, cars[0].orderUuid);
  assert.equal(outputs[0].changed.recommendations[0].orderUuid, cars[1].orderUuid);
  assert.equal(outputs[1].initial.decisions[0].snapshot.facts.body.provenance.sourceRef, 'target-fixture:specification');
  assert.equal(outputs[0].initial.decisions[0].snapshot.facts.body.provenance.sourceRef, 'fixture:employee');
  assert.equal(outputs[1].initial.versions.facts, 'target-employee-v1');
  assert.equal(outputs[1].initial.versions.stock, 'target-stock-v1');
});

test('duplicate custom recommendation paths cannot replace the built-in employee guards', async () => {
  let customCalls = 0;
  const provider = providerFor((context) => ({ status: 'ok', value: sourceFor(context) }));
  await withFixture({ gcspRecommendations: configured(provider), gcspRoutes: [{ method: 'POST', path: '/api/gcsp/recommendations',
    handle: async () => { customCalls += 1; return { status: 'ok', value: { override: true } }; } }] }, async (f) => {
    const employee = await f.request('/api/gcsp/recommendations', { body: brief() });
    assert.equal(employee.status, 200);
    assert.equal(employee.json.value.state, 'recommendations');
    assert.equal(customCalls, 0);
    const greg = await f.request('/api/gcsp/recommendations', { session: f.greg, body: brief() });
    assert.equal(greg.status, 403);
    assert.equal(customCalls, 0);
  });
});

test('service timing is bound to resolved current run, never caller-supplied timestamps', async () => {
  const calls = [];
  const provider = providerFor((context) => ({ status: 'ok', value: sourceFor(context) }));
  const clock = { async now(context) { calls.push(context.runId); return { status: 'ok', value: {
    now: EMPLOYEE_INSTANT, runId: context.runId, clockVersion: 'clock-api-v1',
  } }; } };
  await withFixture({ gcspRecommendations: { provider, policy: createPolicyService(), time: clock } }, async (f) => {
    const response = await f.request('/api/gcsp/recommendations?time=2099-01-01', { body: brief() });
    assert.equal(response.status, 400);
    const normal = await f.request('/api/gcsp/recommendations', { body: brief(), headers: { 'X-Demo-Time': '2099-01-01' } });
    assert.equal(normal.status, 200);
    assert.deepEqual(calls, [f.current().runId]);
  });
});

