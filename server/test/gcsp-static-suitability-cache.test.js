import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAllocationRecommendationEvaluator, createStaticSuitabilityCache } from '../gcsp/recommendation/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createVehicleSnapshot } from '../vehicles/index.js';
import { context, instant, fact, brief, stock, providerValue, policy, preference, currentCar, rating, sameAgain } from './helpers/employee-recommendation.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out)); return out; };
const snapshotEdit = (car, edit) => { const copy = structuredClone(car.snapshot); edit(copy); car.snapshot = createVehicleSnapshot(copy); };
function fixture(cache = createStaticSuitabilityCache()) {
  const f = { cache, source: providerValue(), request: brief(), context: structuredClone(context), now: instant, policy: policy() };
  f.evaluate = async (projection = 'evaluate', useCache = true) => good(await createAllocationRecommendationEvaluator({
    staticCache: useCache ? cache : undefined, policy: f.policy,
    provider: { resolve: async () => ({ status: 'ok', value: f.source }) },
    time: { now: async () => ({ status: 'ok', value: { now: f.now, runId: f.context.runId, clockVersion: 'clock-current' } }) },
  })[projection](f.context, f.request));
  f.equal = async (projection = 'evaluate') => {
    const actual = await f.evaluate(projection); assert.deepEqual(actual, await f.evaluate(projection, false)); return actual;
  };
  return f;
}

test('consecutive releases score only changed signatures and keep every exact fallback identity', async () => {
  const f = fixture(); const historical = await f.equal('quote'); const saved = JSON.stringify(historical);
  assert.equal(f.cache.stats().computations, 1);
  await f.equal(); assert.equal(f.cache.stats().computations, 1);
  f.source.stockVersion = 'unrelated-pool-digest'; f.source.factsVersion = 'new-employee-wrapper';
  const twin = stock(2); snapshotEdit(twin, (s) => { s.display.name = f.source.stock[0].snapshot.display.name; s.snapshotVersion = 'twin-version'; });
  f.source.stock.push(twin); await f.equal('quote'); assert.equal(f.cache.stats().computations, 1);
  for (let n = 3; n <= 6; n++) {
    f.source.stock.push(stock(n)); const out = await f.equal();
    assert.equal(out.value.decisions.length, n); assert.equal(f.cache.stats().computations, n - 1);
    assert.deepEqual(out.value.decisions.map((d) => d.orderUuid), f.source.stock.map((c) => c.orderUuid));
  }
  snapshotEdit(f.source.stock[0], (s) => { s.facts.boot.value = 501; });
  await f.equal(); assert.equal(f.cache.stats().computations, 6);
  const quote = await f.equal('quote');
  for (const d of quote.value.decisions) assert.equal(d.snapshot.sourceKeys.stockId, d.orderUuid);
  assert.equal(JSON.stringify(historical), saved); assert.ok(Object.isFrozen(historical.value.decisions[0].components));
  assert.throws(() => { historical.value.decisions[0].components[0].score = -1; }, TypeError);
});

test('all scoring input categories invalidate, including evidence provenance and preference state', async () => {
  const edits = [
    (f) => snapshotEdit(f.source.stock[0], (s) => { s.display.name += ' changed'; }),
    (f) => snapshotEdit(f.source.stock[0], (s) => { s.facts.body.value = 'suv'; }),
    (f) => snapshotEdit(f.source.stock[0], (s) => { s.facts.body.provenance.version = 'revised'; }),
    (f) => snapshotEdit(f.source.stock[0], (s) => { s.facts.body.provenance.assurance = 'model-reference'; }),
    (f) => { f.request.preferences.body.value = 'suv'; },
    (f) => { f.request.preferences.body.importance = 50; },
    (f) => { f.request.preferences.body.valueState = 'draft'; },
    (f) => { f.source.employeeFacts.charging = fact('none'); },
    (f) => { f.source.employeeFacts.annualMileage = fact(20000, 'mi/year'); },
    (f) => { const changed = structuredClone(seed); const config = changed.assumptions.find((r) => r.key === 'employee.recommendation.v1').value;
      config.preferenceWeights = Object.fromEntries(Object.keys(config.preferences).map((key) => [key, key === 'body' ? 2 : 1]));
      f.policy = new PolicyService({ provider: { loadVersions: async () => [changed] } }); },
  ];
  for (const edit of edits) {
    const f = fixture(); await f.equal(); edit(f); await f.equal();
    assert.equal(f.cache.stats().computations, 2, edit.toString());
  }
});

test('structurally reordered facts reuse scores while explanation order remains current', async () => {
  const f = fixture(); f.request.preferences.sportiness = preference(80); await f.equal();
  snapshotEdit(f.source.stock[0], (s) => { s.facts = Object.fromEntries(Object.entries(s.facts).reverse()); });
  await f.equal(); assert.equal(f.cache.stats().computations, 1);
  f.request.preferences = Object.fromEntries(Object.entries(f.request.preferences).reverse());
  await f.equal(); assert.equal(f.cache.stats().computations, 2);
});

test('current clock, availability, policy gates and feedback never reuse previous decisions or terms', async () => {
  const f = fixture(); f.source.currentCar = currentCar(); snapshotEdit(f.source.stock[0], (s) => { s.facts.modelLine = fact('G21 Touring'); }); const old = await f.equal('quote');
  f.now = '2026-11-05T13:00:00.000Z'; const later = await f.equal('quote');
  assert.notEqual(later.value.decisions[0].versions.terms, old.value.decisions[0].versions.terms);
  assert.equal(f.cache.stats().computations, 1);
  f.request.currentCarRating = rating(1); const excluded = await f.equal();
  assert.equal(excluded.value.decisions[0].suitable, false); assert.equal(f.cache.stats().computations, 1);
  f.request.currentCarRating = rating(3); f.request.sameAgain = sameAgain(true); await f.equal();
  delete f.request.currentCarRating; delete f.request.sameAgain;
  f.source.stock[0].availability.state = 'held'; const unavailable = await f.equal();
  assert.equal(unavailable.value.decisions[0].suitable, false); assert.equal(f.cache.stats().computations, 1);
  f.source.stock[0].availability.state = 'available'; f.now = '2026-12-02T00:00:00.000Z';
  const expired = await f.equal(); assert.ok(expired.value.decisions[0].blockers.some((r) => r.code === 'required-by'));
  f.now = instant;
  const real = f.policy; f.policy = new Proxy(real, { get: (target, key) => key === 'getEligibility'
    ? async (...args) => { const out = await target.getEligibility(...args); return { ...out, value: { ...out.value, state: 'ineligible' } }; }
    : target[key].bind(target) });
  const denied = await f.equal(); assert.ok(denied.value.decisions[0].blockers.some((r) => r.code === 'policy-exclude'));
});

test('bounded entries and bytes, eviction, explicit reset, restart and incomplete cache safely recompute', async () => {
  const f = fixture(createStaticSuitabilityCache({ maxEntries: 1, maxBytes: 1024 * 1024 }));
  await f.equal(); f.source.stock = [stock(2)]; await f.equal(); f.source.stock = [stock(1)]; await f.equal('quote');
  assert.equal(f.cache.stats().computations, 3); assert.equal(f.cache.stats().entries, 1); assert.equal(f.cache.stats().evictions, 2);
  f.cache.reset(); await f.equal(); assert.equal(f.cache.stats().computations, 4);
  const bytes = fixture(createStaticSuitabilityCache({ maxBytes: 1 })); await bytes.equal(); await bytes.equal();
  assert.equal(bytes.cache.stats().entries, 0); assert.equal(bytes.cache.stats().computations, 2);
  const restarted = fixture(); await restarted.equal(); assert.equal(restarted.cache.stats().computations, 1);
  const incomplete = fixture({ score() { throw Error('must not be used'); } }); await incomplete.equal('quote');
  const disabled = fixture(createStaticSuitabilityCache({ maxEntries: 0 })); await disabled.equal(); await disabled.equal();
  assert.equal(disabled.cache.stats().entries, 0); assert.equal(disabled.cache.stats().computations, 2);
});

test('run and environment transitions discard retained work', async () => {
  const f = fixture(); await f.equal();
  f.context.runId = f.source.runId = 'next-run'; await f.equal();
  f.context.environmentId = f.source.environmentId = 'next-environment'; await f.equal();
  assert.equal(f.cache.stats().computations, 3); assert.equal(f.cache.stats().entries, 1);
});

test('slider changes and unsupported cache input recompute without changing scoring semantics', () => {
  const cache = createStaticSuitabilityCache(); const config = structuredClone(seed.assumptions.find((r) => r.key === 'employee.recommendation.v1').value);
  const source = providerValue(); const request = brief(); const slider = { minimum: 0, maximum: 100 };
  const score = () => cache.score(source.stock[0].snapshot, request, source.employeeFacts, config, slider, context);
  const before = score(); score(); assert.equal(cache.stats().computations, 1);
  slider.maximum = 99; score(); assert.equal(cache.stats().computations, 2);
  slider.maximum = 100; config.unusedUnsupported = undefined;
  assert.deepEqual(score(), before); assert.deepEqual(score(), before); assert.equal(cache.stats().computations, 4);
});

test('order-sensitive overlapping equipment families invalidate the canonical policy signature', async () => {
  const f = fixture(); const changed = structuredClone(seed);
  const config = changed.assumptions.find((r) => r.key === 'employee.recommendation.v1').value;
  const first = Object.entries(config.optionEvidence.bundleFamilies)[0];
  config.optionEvidence.bundleFamilies = { first: first[1], second: { ...first[1], members: [] } };
  f.policy = new PolicyService({ provider: { loadVersions: async () => [changed] } });
  await f.equal(); config.optionEvidence.bundleFamilies = Object.fromEntries(Object.entries(config.optionEvidence.bundleFamilies).reverse());
  f.policy = new PolicyService({ provider: { loadVersions: async () => [changed] } });
  await f.equal(); assert.equal(f.cache.stats().computations, 2);
});

test('allocation service retains scoring across releases with exact uncached fallback and replay outcomes', async () => {
  const { allocationFixture } = await import('./helpers/gcsp-allocation.js');
  const execute = async (cache) => {
    const f = await allocationFixture({ cars: 2, claimResult: () => ({ status: 'conflict', reason: 'fixture-racer' }) });
    const service = f.create({ staticCache: cache }); const outcomes = [];
    try {
      for (let release = 0; release < 3; release++) {
        if (release) await f.write((tx) => {
          const car = stock(release + 2);
          return tx.insert('stock', { runId: f.context.runId, orderUuid: car.orderUuid, orderNumber: String(release + 2).padStart(7, '0'),
            configurationId: car.configurationId, state: 'available', available: true, facts: car.snapshot,
            release: { availability: car.availability, releasedAt: instant, trancheId: `tranche-${release}` },
            visibility: { companyIds: [f.employees[0].companyId], schemeIds: [f.employees[0].schemeId], employeeIds: null } });
        });
        const event = { ...f.event, eventId: `release-${release}`, stockVersion: `stock-${release}` };
        const out = good(await service.allocate(f.context, event)); outcomes.push(out);
        const count = cache.stats().computations; const calls = f.calls.length;
        assert.deepEqual(await service.allocate(f.context, event), out);
        assert.equal(cache.stats().computations, count); assert.equal(f.calls.length, calls);
        assert.ok(out.value.attempts.length >= release + 2, 'every failed exact candidate retains fallback coverage');
        if (release === 0) assert.ok(cache.stats().hits > 0 || cache.stats().entries === 0, 'quotes and repeated employees reuse static work');
      }
      return { outcomes, computations: cache.stats().computations };
    } finally { await f.repository.close(); }
  };
  const cached = await execute(createStaticSuitabilityCache()); const disabled = await execute(createStaticSuitabilityCache({ maxEntries: 0 }));
  assert.deepEqual(cached.outcomes, disabled.outcomes); assert.ok(cached.computations < disabled.computations);
  assert.equal(cached.computations, 8, 'two distinct preference signatures score four exact fact signatures once');
});

test('cached successful assignments retain the same exact quotes after first-claim fallback', async () => {
  const { allocationFixture } = await import('./helpers/gcsp-allocation.js');
  const { ok } = await import('../gcsp/repository/index.js');
  const execute = async (staticCache) => {
    const f = await allocationFixture({ cars: 4, claimResult: (_, input, n) => n === 1 ? { status: 'conflict' } : ok({ claimId: input.operationId }) });
    try {
      const service = f.create({ staticCache }); const out = good(await service.allocate(f.context, f.event));
      assert.equal(out.value.assignments.length, 3); assert.equal(out.value.evaluations[0].decisions.length, 4);
      assert.notEqual(f.calls[0].input.orderUuid, f.calls[1].input.orderUuid);
      for (const assigned of out.value.assignments) assert.equal(assigned.quote.snapshot.sourceKeys.stockId, assigned.orderUuid);
      assert.deepEqual(await f.create({ staticCache }).allocate(f.context, f.event), out);
      return out;
    } finally { await f.repository.close(); }
  };
  assert.deepEqual(await execute(createStaticSuitabilityCache()), await execute(createStaticSuitabilityCache({ maxEntries: 0 })));
});
