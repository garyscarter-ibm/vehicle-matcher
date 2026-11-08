import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rankCars } from '../engine.js';
import { brandTuning } from '../brands.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { context, instant, fact, brief, stock, providerValue, provider, time, policy, preference, essential } from './helpers/employee-recommendation.js';
const service = (options = {}) => createEmployeeRecommendationService({ policy: policy(), provider: provider(), time, ...options });
const recommend = (options = {}, request = brief(), ctx = context) => service(options).recommend(ctx, request);
const decision = (result, i = 0) => result.value.decisions[i];

test('trusted budget opt-out ranks price-free exact cars and leaves retail budget filtering intact', () => {
  const car = { name: 'Exact car', body: 'estate', fuel: 'petrol', tags: [], seats: 5, boot: 500, zeroTo62: 7, mpg: 45, sizeClass: 3 };
  const tuning = { ...brandTuning('bmw'), weights: { body: 1, economy: 0, performance: 0 }, retailBudgetEnabled: false };
  assert.equal(rankCars({ bodyStyles: ['estate'] }, [car], tuning).length, 1);
  assert.equal(rankCars({ budget: 10000 }, [{ ...car, priceMin: 20000 }]).length, 0);
  assert.equal(rankCars({ budget: 30000 }, [{ ...car, priceMin: 20000 }]).length, 1);
});

test('absent configuration and source failures are unavailable, not empty stock', async () => {
  for (const options of [{ provider: undefined }, { policy: undefined }, { time: undefined },
    { provider: { resolve() { throw Error('offline'); } } }]) assert.equal((await recommend(options)).status, 'unavailable');
  const empty = await recommend({ provider: provider(providerValue([])) });
  assert.equal(empty.status, 'ok'); assert.equal(empty.value.state, 'no-stock');
});

test('unsupported context and mismatched run or employee fail closed', async () => {
  for (const patch of [{ schemeId: 'unknown' }, { gradeId: 'unknown' }, { companyId: 'unknown' }]) {
    assert.equal((await recommend({}, brief(), { ...context, ...patch })).status, 'invalid');
  }
  assert.equal((await recommend({}, brief(), { ...context, roles: ['greg'] })).status, 'forbidden');
  for (const patch of [{ runId: 'old' }, { environmentId: 'other' }, { employeeId: 'other' }]) {
    assert.equal((await recommend({ provider: provider({ ...providerValue(), ...patch }) })).status, 'stale-run');
  }
  assert.equal((await recommend({ time: { now: async () => ({ status: 'stale-run', reason: 'Old run' }) } })).status, 'stale-run');
});

test('request whitelist blocks authority, profile downgrade and strategic inference fields', async () => {
  for (const key of ['employeeId', 'gradeId', 'policyVersion', 'quotes', 'availability', 'profile', 'scenarioId', 'retailBudgetEnabled', 'inferred', 'steering', 'limit']) {
    assert.equal((await recommend({}, { ...brief(), [key]: 'hostile' })).status, 'invalid', key);
  }
  for (const patch of [{ schemaVersion: 2 }, { briefVersion: 0 }, { preferences: { unknown: preference(50) } },
    { preferences: { sportiness: preference(101) } }, { essentials: { seats: { ...essential(5), operator: 'drop' } } }]) {
    assert.equal((await recommend({}, { ...brief(), ...patch })).status, 'invalid');
  }
});

test('exact decisions preserve source evidence and terms before final display cap', async () => {
  const result = await recommend({ provider: provider(providerValue([stock(1), stock(2), stock(3), stock(4)])) });
  assert.equal(result.status, 'ok'); assert.equal(result.value.state, 'recommendations');
  assert.equal(result.value.decisions.length, 4); assert.equal(result.value.recommendations.length, 3);
  const first = decision(result);
  assert.equal(first.gateStatus, 'eligible'); assert.equal(first.configurationId, 'RzIxOlMx');
  assert.equal(first.snapshot.vin, undefined); assert.equal(first.terms.kind, 'employee-scheme');
  assert.equal(first.terms.points.unit, 'points'); assert.equal(first.terms.contribution, null);
  assert.deepEqual(first.versions, { brief: 1, facts: 'employee-facts-v1', policy: 'gcsp-policy-v1', stock: 'stock-v1',
    snapshot: 'snapshot-v1', terms: first.terms.termsVersion, clock: 'clock-v1', availability: 'availability-v1' });
  assert.equal(first.snapshot.facts.seats.provenance.sourceRef, 'fixture:employee');
  assert.ok(first.reasons.some((r) => r.code === 'allowance-sufficient'));
  assert.ok(first.evidence.eligibility.provenance.rules.length > 0);
});

test('matrix exclusions and monthly points gate before high preference scores', async () => {
  const result = await recommend({ provider: provider(providerValue([
    stock(1, { eligibilityModelKey: fact('G21 Touring|M340i') }), stock(2, { eligibilityModelKey: fact('G21 Touring|320i') }),
  ])) });
  assert.equal(decision(result).gateStatus, 'ineligible'); assert.equal(decision(result).score, null);
  assert.ok(decision(result).blockers.some((r) => r.code === 'policy-exclude'));
  assert.equal(result.value.recommendations.length, 1);
});

test('confirmed essentials need exact evidence; inferred and model-reference facts never prove fit', async () => {
  for (const entry of [fact(null, 'count'), fact(5, 'count', 'model-reference'), fact(5, 'count', 'derived')]) {
    const result = await recommend({ provider: provider(providerValue([stock(1, { seats: entry })])) });
    assert.equal(decision(result).gateStatus, 'needs-confirmation'); assert.equal(result.value.recommendations.length, 0);
  }
  const pending = await recommend({}, { ...brief(), essentials: { seats: { ...essential(5), state: 'inferred' } } });
  assert.equal(decision(pending).gateStatus, 'needs-confirmation');
  const small = await recommend({ provider: provider(providerValue([stock(1, { seats: fact(4, 'count') })])) });
  assert.equal(decision(small).gateStatus, 'ineligible');
});

test('equipment is checked on the exact car rather than sibling configuration union', async () => {
  const request = { ...brief(), essentials: { equipment: essential(['towbar'], 'includes', 'equipment-key') } };
  const result = await recommend({ provider: provider(providerValue([stock(1, { equipment: fact({ towbar: true }) }), stock(2, { equipment: fact({ towbar: false }) })])) }, request);
  assert.equal(decision(result).gateStatus, 'eligible'); assert.equal(decision(result, 1).gateStatus, 'ineligible');
});

test('plug-in charging gate uses confirmed employee facts and canonical assumption', async () => {
  for (const charging of [fact(null), fact('none'), fact('home', null, 'derived')]) {
    const supplied = providerValue([stock(1, { fuel: fact('ev') })]); supplied.employeeFacts.charging = charging;
    const result = await recommend({ provider: provider(supplied) });
    assert.equal(decision(result).gateStatus, charging.value === 'none' ? 'ineligible' : 'needs-confirmation');
  }
});

test('required timing and current availability use injected time and cannot widen provider deadline', async () => {
  const late = stock(); late.availability.availableFrom = '2026-12-02T00:00:00.000Z';
  const result = await recommend({ provider: provider(providerValue([late])) }, { ...brief(), requiredBy: '2026-12-20T00:00:00.000Z' });
  assert.equal(decision(result).gateStatus, 'ineligible');
  assert.ok(decision(result).blockers.some((r) => r.code === 'required-by'));
  const expired = await recommend({ time: { now: async () => ({ status: 'ok', value: { now: '2027-01-01T00:00:00.000Z', runId: context.runId, clockVersion: 'clock-v2' } }) } });
  assert.equal(decision(expired).gateStatus, 'ineligible');
});

test('unknown eligibility, points and availability stay explicit confirmation outcomes', async () => {
  const car = stock(1, { eligibilityModelKey: fact('unknown') });
  const result = await recommend({ provider: provider(providerValue([car])) });
  assert.equal(result.value.state, 'no-viable-stock'); assert.equal(decision(result).gateStatus, 'needs-confirmation');
  assert.ok(decision(result).unknowns.some((u) => u.code === 'points-unavailable'));
  const uncertain = stock(); uncertain.availability.state = 'unknown';
  assert.equal(decision(await recommend({ provider: provider(providerValue([uncertain])) })).gateStatus, 'needs-confirmation');
});

test('separate importance and indifference change computed preference order', async () => {
  const cars = [stock(1, { body: fact('saloon'), zeroTo62: fact(4, 's') }), stock(2, { body: fact('estate'), zeroTo62: fact(10, 's') })];
  const options = { provider: provider(providerValue(cars)) };
  const body = await recommend(options, { ...brief(), preferences: { body: preference('estate'), sportiness: preference(100, 0) } });
  assert.equal(body.value.recommendations[0].orderUuid, cars[1].orderUuid);
  const speed = await recommend(options, { ...brief(), preferences: { body: preference('estate', 0), sportiness: preference(100) } });
  assert.equal(speed.value.recommendations[0].orderUuid, cars[0].orderUuid);
  const indifferent = await recommend(options, { ...brief(), preferences: { body: preference('estate', 0) } });
  assert.ok(indifferent.value.decisions.every((d) => d.score === null));
});

test('unconfirmed preferences do not silently override stated requirements', async () => {
  const result = await recommend({}, { ...brief(), preferences: { body: { ...preference('saloon'), valueState: 'inferred' } } });
  assert.equal(decision(result).score, null); assert.equal(decision(result).gateStatus, 'eligible');
  assert.ok(decision(result).unknowns.some((u) => u.code === 'preference-unconfirmed'));
});

test('source snapshots are immutable and equivalent provider shapes compute equivalent decisions', async () => {
  const input = providerValue(); const original = structuredClone(input);
  const a = await recommend({ provider: provider(input) });
  const b = await recommend({ provider: { async resolve() { return { status: 'ok', value: structuredClone(original) }; } } });
  assert.deepEqual(a, b); assert.deepEqual(input, original);
  assert.equal(Object.isFrozen(decision(a).snapshot), true);
});

test('central one-entry policy revision changes affordability and preserves pinned historical explanation', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const revised = structuredClone(seed); revised.policyVersion = 'gcsp-policy-v2'; revised.effectiveFrom = instant;
  for (const table of ['allowances', 'pricePlans', 'eligibilityRules', 'schemeRuleLinks', 'assumptions']) {
    for (const row of revised[table]) row.policyVersion = revised.policyVersion;
  }
  const row = revised.allowances.find((r) => r.schemeId === context.schemeId && r.gradeId === context.gradeId);
  row.monthlyPoints = 0; row.value = 0;
  const shared = new PolicyService({ provider: { loadVersions: async () => [seed, revised] } });
  const old = await recommend({ policy: shared });
  const next = await recommend({ policy: shared }, brief(), { ...context, policyVersion: revised.policyVersion });
  assert.equal(decision(old).gateStatus, 'eligible'); assert.equal(decision(next).gateStatus, 'ineligible');
  assert.equal(decision(old).versions.policy, 'gcsp-policy-v1');
  assert.ok(decision(next).blockers.some((r) => r.code === 'allowance-exceeded'));
  assert.equal(decision(old).evidence.allowance.monthlyPoints > 0, true);
});

test('unavailable employee facts and missing calibration fail explicitly rather than becoming empty stock', async () => {
  const missing = providerValue(); delete missing.employeeFacts;
  assert.equal((await recommend({ provider: provider(missing) })).status, 'unavailable');
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions = seed.assumptions.filter((row) => row.key !== 'employee.recommendation.v1');
  assert.equal((await recommend({ policy: new PolicyService({ provider: { loadVersions: async () => [seed] } }) })).status, 'unavailable');
  for (const field of ['charging', 'requiredBy']) {
    const source = providerValue([stock(1, { fuel: fact('ev') })]); delete source.employeeFacts[field];
    assert.equal(decision(await recommend({ provider: provider(source) })).gateStatus, 'needs-confirmation');
  }
});

test('server-supplied carrying essentials cannot be removed or weakened by the request', async () => {
  const source = providerValue([stock(1, { seats: fact(4, 'count') })]);
  source.employeeFacts.essentials = { seats: essential(5) };
  const result = await recommend({ provider: provider(source) }, { ...brief(), essentials: {} });
  assert.equal(decision(result).gateStatus, 'ineligible');
  assert.ok(decision(result).blockers.some((entry) => entry.field === 'seats' && entry.authority === 'employee-provider'));
});

test('driver eligibility uses supplied synthetic facts and unknown never qualifies', async () => {
  for (const value of [false, null]) {
    const source = providerValue(); source.employeeFacts.driverEligible = fact(value);
    const result = await recommend({ provider: provider(source) });
    assert.equal(decision(result).gateStatus, value === false ? 'ineligible' : 'needs-confirmation');
  }
  const source = providerValue(); delete source.employeeFacts.driverEligible;
  assert.equal(decision(await recommend({ provider: provider(source) })).gateStatus, 'needs-confirmation');
});

test('unregistered prototype names are invalid brief keys and never resolve a policy dimension', async () => {
  const request = brief(); request.preferences = JSON.parse('{"constructor":{"value":50,"importance":100,"valueState":"confirmed","importanceState":"confirmed","source":"employee"}}');
  assert.equal((await recommend({}, request)).status, 'invalid');
});

test('malformed or VIN-bearing stock is source failure, not a computed absence', async () => {
  for (const mutate of [
    (source) => { source.stock.push(source.stock[0]); },
    (source) => { source.stock[0].orderUuid = 'model-group'; },
    (source) => { source.stock[0].snapshot = { ...source.stock[0].snapshot, vin: 'WBA12345678901234' }; },
    (source) => { source.stock[0].availability.availableUntil = '2026-11-01T00:00:00.000Z'; },
  ]) {
    const source = structuredClone(providerValue()); mutate(source);
    assert.equal((await recommend({ provider: provider(source) })).status, 'unavailable');
  }
});

test('unsupported fuel facts require confirmation even with a matching body preference', async () => {
  const result = await recommend({ provider: provider(providerValue([stock(1, { fuel: fact('unsupported') })])) });
  assert.equal(decision(result).gateStatus, 'needs-confirmation');
});

test('comfort, fuel, economy and compact-size preferences exercise the reused curves', async () => {
  const cases = [
    ['comfort', 100, { tags: fact(['cruiser']) }, { tags: fact(['drivers-car']) }],
    ['fuel', 'petrol', { fuel: fact('petrol') }, { fuel: fact('diesel') }],
    ['economy', 100, { mpg: fact(60, 'mpg-imperial') }, { mpg: fact(25, 'mpg-imperial') }],
    ['size', 100, { sizeClass: fact(1, 'ordinal-1-5') }, { sizeClass: fact(5, 'ordinal-1-5') }],
  ];
  for (const [dimension, desired, good, poor] of cases) {
    const result = await recommend({ provider: provider(providerValue([stock(2, good), stock(1, poor)])) },
      { ...brief(), preferences: { [dimension]: preference(desired) } });
    assert.equal(result.status, 'ok', dimension);
    assert.equal(result.value.recommendations[0].orderUuid, stock(2).orderUuid, dimension);
    assert.ok(decision(result).score > decision(result, 1).score, dimension);
  }
});

test('critical employee facts need complete provenance before asserting suitability', async () => {
  for (const field of ['driverEligible', 'charging', 'requiredBy']) {
    for (const patch of [{ sourceRef: '' }, { version: '' }, { observedAt: 'yesterday' }]) {
      const source = providerValue([stock(1, { fuel: fact('ev') })]);
      source.employeeFacts[field].provenance = { ...source.employeeFacts[field].provenance, ...patch };
      assert.equal(decision(await recommend({ provider: provider(source) })).gateStatus, 'needs-confirmation', `${field} ${Object.keys(patch)[0]}`);
    }
  }
});

test('no-stock outcome still preserves brief, facts, policy, stock and clock versions', async () => {
  const result = await recommend({ provider: provider(providerValue([])) });
  assert.deepEqual(result.value.versions, { brief: 1, facts: 'employee-facts-v1', policy: 'gcsp-policy-v1', stock: 'stock-v1', clock: 'clock-v1' });
});

test('conflicting canonical slider scales are explicitly unavailable for Brief schema v1', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((row) => row.key === 'brief.slider.maximum').value = 50;
  const result = await recommend({ policy: new PolicyService({ provider: { loadVersions: async () => [seed] } }) });
  assert.equal(result.status, 'unavailable'); assert.equal(result.code, 'policy-configuration-invalid');
});

test('preview gallery lists eligible cars best fit first, ties by stock id, without reordering stored evaluations', async () => {
  const mpg = (value) => ({ mpg: fact(value, 'mpg-imperial') });
  const cars = [stock(5, { seats: fact(2, 'count') }), stock(3, mpg(25)), stock(4, mpg(45)), stock(2, mpg(60)), stock(1, mpg(45))];
  const ports = { provider: provider(providerValue(cars)) };
  const request = { schemaVersion: 1, preferences: { economy: preference(100) }, essentials: { seats: essential(5) } };
  const preview = await service(ports).previewUnsaved(context, { brief: request, baseBriefVersion: 1, baseDraftVersion: 0 });
  assert.equal(preview.status, 'ok');
  const order = preview.value.decisions.map((d) => d.orderUuid);
  assert.deepEqual(order, [2, 1, 4, 3, 5].map((id) => stock(id).orderUuid));
  const [best, tieA, tieB, worst] = preview.value.decisions;
  assert.ok(best.score > tieA.score && tieA.score === tieB.score && tieB.score > worst.score);
  assert.equal(preview.value.decisions[4].gateStatus, 'ineligible');
  const stored = await recommend(ports, { ...request, briefVersion: 1 });
  assert.deepEqual(stored.value.decisions.map((d) => d.orderUuid), cars.map((c) => c.orderUuid));
  assert.deepEqual(stored.value.recommendations.map((d) => d.orderUuid), order.slice(0, 3));
});
