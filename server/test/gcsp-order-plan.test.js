import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { planOrder, SOLVER_LIMITS, readPlanningPolicy, resolveSupplyRecords, createOrderPlanService, createOrderPlanSupplyProvider, createExpressedOrderForecastProvider } from '../gcsp/predict/plan/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { setup as savedDemandRun, confirm as confirmDemand } from './helpers/greg-demand-run.js';

import { planningInput as input } from './helpers/order-plan-input.js';

const q = (plan, derivative) => plan.quantities.find((d) => d.derivativeId === derivative)?.quantity;

test('feasible integer plan satisfies derivative, model and budget bounds', () => {
  const source = input(); const out = planOrder(source);
  assert.equal(out.status, 'feasible'); assert.equal(out.expectedAcceptableCoverage.covered, 2);
  assert.equal(q(out, 'a'), 1); assert.equal(q(out, 'b'), 1); assert.equal(out.spendMinor, 18);
  assert.ok(out.quantities.every((d) => Number.isInteger(d.quantity)));
  assert.equal(out.solver.optimalWithinDeclaredModel, true);
  assert.equal(source.catalog.length, 2); assert.equal(source.stock.length, 0);
});

test('competition/substitution matches each employee once instead of adding marginal demand', () => {
  const source = input();
  source.constraints.derivativeBounds.forEach((b) => { b.max = 0; });
  source.stock = [{ stockId: 'first', derivativeId: 'a', availableAt: source.asOf, heldForEntitlementId: null },
    { stockId: 'second', derivativeId: 'b', availableAt: source.asOf, heldForEntitlementId: null }];
  const out = planOrder(source);
  assert.equal(out.expectedAcceptableCoverage.covered, 2);
  assert.deepEqual(out.allocations.map((a) => [a.entitlementId, a.derivativeId]), [['flexible', 'b'], ['single', 'a']]);
  assert.equal(new Set(out.allocations.map((a) => a.entitlementId)).size, 2);
  source.stock.pop();
  assert.equal(planOrder(source).expectedAcceptableCoverage.covered, 1);
});

test('held stock stays with its entitlement and never satisfies competing demand', () => {
  const source = input(); source.constraints.budgetMinor = 0;
  source.stock = [{ stockId: 'held', derivativeId: 'a', availableAt: source.asOf, heldForEntitlementId: 'flexible' }];
  const out = planOrder(source);
  assert.equal(out.expectedAcceptableCoverage.covered, 1);
  assert.equal(out.allocations[0].entitlementId, 'flexible');
  assert.ok(out.unmetNeeds.find((e) => e.entitlementId === 'single').gates.includes('held-for-another-entitlement'));
});

test('confirmed inbound reduces new orders only before the exact renewal date', () => {
  const source = input(); source.inbound = [{ supplyId: 'ack-1', derivativeId: 'a', quantity: 1, releasedQuantity: 0,
    state: 'confirmed', expectedAt: '2026-11-26T00:00:00.000Z', provenance: { sourceVersion: 'production-v1' } }];
  const before = planOrder(source); assert.equal(q(before, 'a'), 0); assert.equal(q(before, 'b'), 1);
  source.inbound[0].expectedAt = '2026-11-26T00:00:00.001Z';
  const after = planOrder(source); assert.equal(q(after, 'a'), 1); assert.equal(q(after, 'b'), 1);
});

test('released confirmed quantities are subtracted once and held units are not free supply', () => {
  const source = input(); source.constraints.budgetMinor = 0;
  source.stock = [{ stockId: 'released-1', derivativeId: 'a', availableAt: source.asOf, heldForEntitlementId: null }];
  source.inbound = [{ supplyId: 'ack-1', derivativeId: 'a', quantity: 1, releasedQuantity: 1, state: 'confirmed', expectedAt: source.asOf }];
  const out = planOrder(source); assert.equal(out.expectedAcceptableCoverage.covered, 1); assert.equal(out.unallocatedStockRisk.totalSupply, 1);
});

test('renewal reach and policy horizon prevent late order coverage', () => {
  const source = input(); source.catalog.forEach((d) => { d.leadTimeDays = 21; });
  const out = planOrder(source);
  assert.equal(out.status, 'feasible'); assert.equal(out.expectedAcceptableCoverage.covered, 0);
  assert.equal(out.orderQuantity, 0); assert.ok(out.unmetNeeds.every((e) => e.constraintIds.some((id) => id.startsWith('lead-time-before-renewal:'))));
  source.catalog[0].leadTimeDays = 31; source.constraints.derivativeBounds[0].min = 1;
  const impossible = planOrder(source); assert.equal(impossible.status, 'infeasible');
  assert.ok(impossible.conflicts.some((c) => c.id === 'lead-time:a')); assert.deepEqual(impossible.quantities, []);
});

test('currently available stock cannot backdate acceptable coverage for an overdue renewal', () => {
  const source = input(); source.forecast.entitlements.forEach((e) => { e.renewalAt = '2026-11-05T00:00:00.000Z'; });
  source.stock = [{ stockId: 'old', derivativeId: 'a', availableAt: '2026-11-04T00:00:00.000Z', heldForEntitlementId: null }];
  const out = planOrder(source); assert.equal(out.expectedAcceptableCoverage.covered, 0);
  assert.ok(out.unmetNeeds.every((e) => e.gates.includes('renewal-already-passed')));
});

test('conflicting model, derivative and budget constraints name the actual conflicts', () => {
  const source = input(); source.constraints.derivativeBounds[0].min = 2; source.constraints.budgetMinor = 9;
  let out = planOrder(source); assert.equal(out.status, 'infeasible'); assert.ok(out.conflicts.some((c) => c.id === 'budget')); assert.deepEqual(out.quantities, []);
  source.constraints.budgetMinor = 100; source.constraints.modelBounds[0].max = 1;
  out = planOrder(source); assert.equal(out.status, 'infeasible'); assert.ok(out.conflicts.some((c) => c.id === 'model:model-a:max'));
  source.constraints.derivativeBounds[0].max = 1;
  out = planOrder(source); assert.equal(out.status, 'infeasible'); assert.ok(out.conflicts.some((c) => c.id === 'derivative:a:min'));
});

test('model bounds constrain the sum of sibling derivatives', () => {
  const source = input(); source.catalog[1].modelId = 'model-a';
  source.constraints.modelBounds = [{ modelId: 'model-a', min: 1, max: 1 }];
  const out = planOrder(source); assert.equal(out.status, 'feasible'); assert.equal(out.orderQuantity, 1); assert.equal(out.expectedAcceptableCoverage.covered, 1);
  assert.ok(out.bindingConstraints.some((c) => c.id === 'model:model-a:max'));
});

test('output explains unmet gates, unallocated risk, objectives, alternatives and current draft', () => {
  const source = input(); source.forecast.entitlements[0].acceptableDerivativeIds = []; source.forecast.entitlements[0].gates = ['eligibility-unconfirmed'];
  source.constraints.derivativeBounds[1].min = 1;
  source.currentDraft = { quantities: [{ derivativeId: 'b', quantity: 1 }] };
  const out = planOrder(source);
  assert.equal(out.unallocatedStockRisk.quantity, 1);
  assert.ok(out.unmetNeeds[0].gates.includes('eligibility-unconfirmed'));
  assert.equal(out.currentDraftComparison.coverageDelta, 1);
  assert.equal(out.alternatives[0].kind, 'zero-new-orders-baseline');
  assert.equal(out.alternatives[0].status, 'infeasible');
  assert.ok(out.alternatives.some((p) => p.kind === 'next-best-distinct-feasible'));
  assert.equal(out.objective.value, Object.values(out.objective.terms).reduce((n, v) => n + v, 0));
});

test('same inputs give same complete plan, stable ID and all version pins without mutation', () => {
  const source = input(); const saved = structuredClone(source);
  const first = planOrder(source); assert.deepEqual(planOrder(source), first); assert.deepEqual(source, saved);
  assert.deepEqual(first.versions, source.versions); assert.match(first.planId, /^order-plan-[a-f0-9]{64}$/);
  source.versions.forecast = 'other'; assert.notEqual(planOrder(source).planId, first.planId);
});

test('objective and bound inputs alter the plan without code edits', () => {
  const source = input(); const before = planOrder(source);
  source.constraints.objectiveWeights.costMinor = 20;
  const after = planOrder(source); assert.equal(before.orderQuantity, 2); assert.equal(after.orderQuantity, 0);
  assert.ok(after.unmetNeeds.every((e) => e.gates.includes('objective-tradeoff')));
  source.constraints.derivativeBounds[0].min = 1; assert.equal(q(planOrder(source), 'a'), 1);
});

test('integer budget slack still explains why no additional acceptable car can be bought', () => {
  const source = input(); source.constraints.budgetMinor = 9;
  const out = planOrder(source); assert.equal(out.spendMinor, 8);
  assert.ok(out.unmetNeeds[0].constraintIds.includes('budget'));
  assert.ok(out.bindingConstraints.some((b) => b.id === 'budget'));
});

test('duplicate employee, unconfirmed inbound, missing bounds and privacy bands fail closed', () => {
  for (const change of [
    (s) => { s.forecast.entitlements[1].employeeId = s.forecast.entitlements[0].employeeId; },
    (s) => { s.inbound = [{ supplyId: 'request', derivativeId: 'a', state: 'requested', quantity: 1, releasedQuantity: 0, expectedAt: s.asOf }]; },
    (s) => { s.constraints.derivativeBounds.pop(); },
    (s) => { s.forecast.entitlements = { count: { kind: 'band', fewerThan: 5 } }; },
  ]) { const source = input(); change(source); assert.equal(planOrder(source).status, 'invalid'); }
});

test('oversized search returns unsupported without a partial optimum', () => {
  const source = input(); source.constraints.derivativeBounds.forEach((b) => { b.max = 1000; });
  const out = planOrder(source); assert.equal(out.status, 'unsupported'); assert.equal(out.code, 'solver-limit'); assert.deepEqual(out.quantities, []);
  assert.equal(out.solver.complete, false); assert.ok(out.limits.some((l) => l.maximum === SOLVER_LIMITS.candidatePlans));
});

test('matching effort exhaustion returns unsupported even after feasible candidates were found', () => {
  const source = input(); source.constraints.budgetMinor = 100000;
  source.constraints.derivativeBounds.forEach((b) => { b.max = 100; });
  source.constraints.modelBounds.forEach((b) => { b.max = 100; });
  source.forecast.entitlements = Array.from({ length: 128 }, (_, i) => ({ ...source.forecast.entitlements[0],
    entitlementId: `entitlement-${i}`, employeeId: `employee-${i}`, renewalId: `renewal-${i}`, entitlementSlotId: `slot-${i}` }));
  const out = planOrder(source); assert.equal(out.status, 'unsupported'); assert.deepEqual(out.quantities, []);
  assert.equal(out.limits[0].field, 'matchingSteps'); assert.equal(out.solver.complete, false);
});

test('invalid current draft refuses rather than silently dropping unknown derivatives', () => {
  const source = input(); source.currentDraft = { quantities: [{ derivativeId: 'unknown', quantity: 1 }] };
  assert.equal(planOrder(source).code, 'invalid-current-draft');
});

test('stock visibility is independent of derivative eligibility', () => {
  const source = input(); source.constraints.budgetMinor = 0;
  source.stock = [{ stockId: 'restricted', derivativeId: 'a', availableAt: source.asOf,
    heldForEntitlementId: null, permittedEntitlementIds: ['flexible'] }];
  const out = planOrder(source); assert.equal(out.expectedAcceptableCoverage.covered, 1);
  assert.equal(out.allocations[0].entitlementId, 'flexible');
  assert.ok(out.unmetNeeds[0].gates.includes('stock-not-visible'));
});

test('invalid dates, numeric overflow and nonunique entitlement slots fail closed', () => {
  for (const change of [
    (s) => { s.catalog[0].leadTimeDays = Number.MAX_SAFE_INTEGER; },
    (s) => { s.catalog[0].unitCostMinor = Number.MAX_SAFE_INTEGER; },
    (s) => { s.forecast.entitlements[1].renewalAt = '2026-11-31T00:00:00Z'; },
    (s) => { s.forecast.entitlements[1].entitlementSlotId = s.forecast.entitlements[0].entitlementSlotId; },
    (s) => { s.stock = [{ stockId: 'future', derivativeId: 'a', availableAt: '2026-11-07T00:00:00Z', heldForEntitlementId: null }]; },
  ]) { const source = input(); change(source); assert.equal(planOrder(source).status, 'invalid'); }
});

function supplyRecords() {
  const runId = 'planning-test'; const releasedAt = '2026-11-05T00:00:00.000Z';
  return { runId, asOf: input().asOf, catalogVersion: 'catalog-v1',
    catalog: [{ derivativeId: 'a', modelId: 'model-a', production: { model: 'Production A', derivative: 'Derivative A' }, configurationIds: ['config-a'] }],
    rows: { stock: [{ runId, orderUuid: 'exact-a', configurationId: 'config-a', state: 'released', available: true,
      visibility: { companyIds: ['company'], schemeIds: ['scheme'], employeeIds: null },
      release: { supplyId: 'ack-a', trancheId: 'release-a', releasedAt, policyVersion: 'original-policy', sourceVersion: 'source-v1' } }],
    holds: [], future_order_requests: [{ runId, requestId: 'request-a', model: 'Production A', derivative: 'Derivative A', quantity: 3, state: 'delayed' }],
    confirmed_supply: [{ runId, supplyId: 'ack-a', requestId: 'request-a', state: 'confirmed', quantity: 2,
      confirmedAt: '2026-11-01T00:00:00.000Z', expectedAt: '2026-11-20T00:00:00.000Z', policyVersion: 'original-policy',
      sourceVersion: 'production-v1', providerReference: 'ack-reference', provenance: { mode: 'synthetic' } }],
    event_receipts: [{ runId, consumerId: 'stock-release', eventId: 'release-a', eventType: 'stock-released', state: 'completed',
      outcome: { status: 'ok', value: { runId, kind: 'stock-released', supplyId: 'ack-a', trancheId: 'release-a',
        orderUuids: ['exact-a'], releasedAt, source: { version: 'source-v1' }, policyVersion: 'original-policy' } } }] } };
}

test('F104 record conversion joins request identity and subtracts actual per-supply releases', () => {
  const source = supplyRecords(); const saved = structuredClone(source); const out = resolveSupplyRecords(source);
  assert.equal(out.status, 'ok'); assert.deepEqual(source, saved);
  assert.equal(out.value.inbound[0].releasedQuantity, 1); assert.equal(out.value.inbound[0].quantity, 2);
  assert.equal(out.value.inbound[0].expectedAt, source.rows.confirmed_supply[0].expectedAt);
  assert.equal(out.value.inbound[0].provenance.policyVersion, 'original-policy');
  assert.equal(out.value.stock[0].derivativeId, 'a');
  assert.equal(out.value.inbound.length, 1); // Outstanding delayed third vehicle is not supply.
  source.rows.stock[0].state = 'allocated'; source.rows.stock[0].allocated = true;
  const selected = resolveSupplyRecords(source); assert.equal(selected.status, 'ok');
  assert.equal(selected.value.stock.length, 0); assert.equal(selected.value.inbound[0].releasedQuantity, 1);
});

test('supply conversion refuses guesses, missing release receipts and crossed provenance', () => {
  for (const change of [
    (s) => { s.catalog[0].configurationIds = []; },
    (s) => { s.rows.future_order_requests[0].derivative = 'unknown'; },
    (s) => { s.rows.event_receipts = []; },
    (s) => { s.rows.stock[0].release.sourceVersion = 'different'; },
    (s) => { s.rows.confirmed_supply[0].runId = 'other-run'; },
    (s) => { s.rows.confirmed_supply[0].quantity = 4; },
  ]) { const source = supplyRecords(); change(source); assert.equal(resolveSupplyRecords(source).status, 'unavailable'); }
});

test('supply conversion preserves exact held slot and refuses unresolved expiry', () => {
  const source = supplyRecords(); source.rows.stock[0].state = 'held'; source.rows.stock[0].available = false;
  source.rows.holds = [{ runId: source.runId, holdId: 'hold-a', orderUuid: 'exact-a', state: 'active',
    entitlementSlotId: 'slot-a', expiresAt: '2026-11-07T00:00:00.000Z' }];
  assert.equal(resolveSupplyRecords(source).value.stock[0].heldForEntitlementSlotId, 'slot-a');
  source.rows.holds[0].expiresAt = source.asOf;
  assert.equal(resolveSupplyRecords(source).code, 'planning-held-stock-unresolved');
});

test('readSupply uses read-only repository ports and fences concurrent record changes', async () => {
  const source = supplyRecords(); const context = { runId: source.runId, policyVersion: 'policy-v1' };
  let loads = 0; let changed = false;
  const provider = createOrderPlanSupplyProvider({
    repository: { async query(given, table) {
      assert.equal(given, context); const rows = structuredClone(source.rows[table]);
      if (table === 'confirmed_supply') { loads += 1; if (changed && loads > 1) rows[0].quantity = 1; }
      return { status: 'ok', value: rows };
    } },
    identity: { async requireRole(given) { return { status: given === context ? 'ok' : 'forbidden' }; } },
    clock: { async now() { return { status: 'ok', value: { runId: source.runId, now: source.asOf, clockVersion: 'clock-v1' } }; } },
    catalog: { async readCatalog() { return { status: 'ok', value: { version: source.catalogVersion, derivatives: source.catalog } }; } },
  });
  const read = { asOf: source.asOf, policyVersion: context.policyVersion };
  assert.equal((await provider.readSupply({ ...context }, read)).status, 'forbidden');
  assert.equal((await provider.readSupply(context, read)).status, 'ok');
  loads = 0; changed = true;
  assert.equal((await provider.readSupply(context, read)).code, 'planning-supply-changed');
});

function serviceSetup() {
  const source = input(); let count = 0; let changed = false;
  const context = { runId: source.runId, policyVersion: source.versions.policy };
  const keys = { 'orderPlan.horizonDays': 30, 'orderPlan.budgetMinor': 20, 'orderPlan.currency': 'GBP',
    'orderPlan.modelBounds': source.constraints.modelBounds, 'orderPlan.derivativeBounds': source.constraints.derivativeBounds,
    'orderPlan.objectiveWeights': source.constraints.objectiveWeights, 'supply.leadTimeDays': 10 };
  const ports = {
    identity: { async requireRole(given, role) { return given === context && role === 'greg' ? { status: 'ok' } : { status: 'forbidden' }; } },
    clock: { async now() { return { status: 'ok', value: { runId: source.runId, now: source.asOf, clockVersion: 1 } }; } },
    policy: { async getAssumption(key) { return { status: 'ok', policyVersion: source.versions.policy, value: { key, value: keys[key], status: 'assumed', basis: 'Explicit service-port alternative fixture.' } }; } },
    forecast: { async readForecast() { count += 1; return { status: 'ok', value: { runId: source.runId, asOf: source.asOf,
      policyVersion: source.versions.policy, version: changed && count > 1 ? 'changed' : 'forecast-v1', cohortVersion: source.versions.cohort,
      forecast: { ...source.forecast, entitlements: source.forecast.entitlements.map((e) => ({ ...e, companyId: 'company', schemeId: 'scheme' })) } } }; } },
    catalog: { async readCatalog() { return { status: 'ok', value: { runId: source.runId, asOf: source.asOf, policyVersion: source.versions.policy,
      version: source.versions.catalog, currency: 'GBP', derivatives: source.catalog } }; } },
    supply: { async readSupply() { return { status: 'ok', value: { runId: source.runId, asOf: source.asOf, versions: { stock: 'stock-v1', supply: 'supply-v1', catalog: source.versions.catalog },
      stock: [{ stockId: 'held-a', derivativeId: 'a', availableAt: source.asOf, heldForEntitlementSlotId: 'slot-b',
        visibility: { companyIds: ['company'], schemeIds: ['scheme'], employeeIds: null } }], inbound: [] } }; } },
  };
  return { context, ports, change: () => { changed = true; }, keys };
}

test('read-only service enforces trusted context, policy pins, hold ownership and input fences', async () => {
  let f = serviceSetup(); let service = createOrderPlanService(f.ports);
  assert.equal((await service.readPlan({ ...f.context })).status, 'forbidden');
  const out = await service.readPlan(f.context); assert.equal(out.status, 'feasible'); assert.equal(q(out, 'a'), 0);
  assert.equal(out.allocations.find((a) => a.source === 'stock').entitlementId, 'single');
  assert.equal(out.policyProvenance.length, 7);
  f = serviceSetup(); f.change(); service = createOrderPlanService(f.ports);
  assert.equal((await service.readPlan(f.context)).code, 'planning-inputs-changed');
  assert.equal((await createOrderPlanService().readPlan(f.context)).code, 'planning-producers-not-configured');
});

async function forecastRun() {
  const f = await savedDemandRun({ canonical: true });
  await f.write(async (tx) => {
    const employeeRef = { table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } };
    const employee = await tx.get(employeeRef);
    const changed = await tx.compareAndSwap(employeeRef, employee.value.version, { renewalId: 'known-renewal',
      contract: { ...employee.value.contract, contractEndDate: '2026-11-26' } });
    if (changed.status !== 'ok') return changed;
    const ref = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.employee.entitlementSlotId } };
    const slot = await tx.get(ref);
    return tx.compareAndSwap(ref, slot.value.version, { renewalId: 'known-renewal' });
  });
  await confirmDemand(f);
  const asOf = (await f.clock.now(f.context)).value.now;
  const read = { runId: f.context.runId, asOf, policyVersion: f.context.policyVersion, horizonEnd: '2026-12-05T00:00:00.000Z' };
  let mode = 'ok'; let calls = 0;
  const catalog = { async readCatalog() { return { status: 'ok', value: { runId: f.context.runId, asOf,
    policyVersion: f.context.policyVersion, version: 'future-catalog-v1', derivatives: [{ derivativeId: 'a' }, { derivativeId: 'b' }] } }; } };
  const futureChoices = { async evaluateChoices(context, { employee, brief, catalog: catalogValue }) {
    calls += 1; assert.equal(brief.status, 'confirmed'); assert.equal(employee.employeeId, f.employee.employeeId);
    return { status: 'ok', value: { runId: context.runId, policyVersion: mode === 'stale' ? 'wrong-policy' : context.policyVersion,
      employeeId: employee.employeeId, briefVersion: brief.briefVersion, catalogVersion: catalogValue.version,
      version: 'explicit-future-evaluation-v1', acceptableDerivativeIds: ['a', 'b'], gates: [],
      limitations: ['Injected alternative future-choice evaluator; no actual shared future gate composition claimed.'] } };
  } };
  const provider = createExpressedOrderForecastProvider({ ...f, catalog, futureChoices });
  return { ...f, read, provider, catalog, futureChoices, mode: (value) => { mode = value; }, calls: () => calls };
}

test('trusted expressed forecast reads actual F99 saved briefs without inverting public suppression', async () => {
  const f = await forecastRun();
  const publicBefore = await f.service.readDemand(f.context);
  assert.equal(publicBefore.value.demand.activeBriefs.count.kind, 'band');
  assert.equal((await f.repository.query(f.context, 'briefs')).value[0].renewalId, null);
  const out = await f.provider.readForecast(f.context, f.read); assert.equal(out.status, 'ok');
  assert.equal(out.value.forecast.basis, 'expressed-saved-demand');
  assert.equal(out.value.forecast.entitlements.length, 1); assert.equal(out.value.forecast.entitlements[0].renewalAt, '2026-11-26T23:59:59.999Z');
  assert.deepEqual(out.value.forecast.entitlements[0].acceptableDerivativeIds, ['a', 'b']);
  assert.equal(out.value.forecast.entitlements[0].entitlementId, f.employee.entitlementSlotId);
  assert.equal(f.calls(), 1); assert.deepEqual(await f.service.readDemand(f.context), publicBefore);
  assert.equal((await f.provider.readForecast({ ...f.context }, f.read)).status, 'forbidden');
});

test('trusted forecast rejects an explicitly conflicting saved renewal or entitlement', async () => {
  for (const patch of [{ renewalId: 'another-renewal' }, { entitlementSlotId: 'another-slot' }]) {
    const f = await forecastRun();
    await f.write(async (tx) => {
      const brief = (await tx.list('briefs')).value[0];
      return tx.insert('briefs', { ...brief, briefVersion: brief.briefVersion + 1,
        previousBriefVersion: brief.briefVersion, ...patch });
    });
    assert.equal((await f.provider.readForecast(f.context, f.read)).code, 'planning-forecast-entitlement-mismatch');
    assert.equal(f.calls(), 0);
  }
});

test('default forecast fails closed without future evaluation, a known renewal or matching versions', async () => {
  const f = await forecastRun();
  const absent = createExpressedOrderForecastProvider({ ...f, catalog: f.catalog, futureChoices: undefined });
  assert.equal((await absent.readForecast(f.context, f.read)).code, 'planning-future-choice-evaluator-not-configured');
  f.mode('stale'); assert.equal((await f.provider.readForecast(f.context, f.read)).code, 'planning-future-choice-evaluation-invalid');
  f.mode('ok');
  await f.write(async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } };
    const row = await tx.get(ref);
    return tx.compareAndSwap(ref, row.value.version, { contract: { ...row.value.contract, contractEndDate: null } });
  });
  assert.equal((await f.provider.readForecast(f.context, f.read)).code, 'planning-renewal-unconfirmed');
});

test('typed policy reader has no canonical fallback when new keys are inactive', async () => {
  const policy = new PolicyService();
  const out = await readPlanningPolicy(policy, { runId: 'policy-test', policyVersion: 'gcsp-policy-v1', asOf: '2026-11-06T00:00:00.000Z' });
  assert.equal(out.status, 'unavailable'); assert.ok(out.keys.includes('orderPlan.budgetMinor'));
});

test('real PolicyService reads explicit alternative entries and one source change reaches the kernel', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
  seed.assumptions.find((a) => a.key === 'supply.leadTimeDays').value = 10; // Explicit alternative lead time, not an active default.
  const source = input();
  const entries = { 'orderPlan.horizonDays': source.constraints.horizonDays, 'orderPlan.budgetMinor': source.constraints.budgetMinor,
    'orderPlan.currency': source.constraints.currency, 'orderPlan.modelBounds': source.constraints.modelBounds,
    'orderPlan.derivativeBounds': source.constraints.derivativeBounds, 'orderPlan.objectiveWeights': source.constraints.objectiveWeights };
  for (const [key, value] of Object.entries(entries)) seed.assumptions.push({ ...seed.assumptions[0], key, value,
    status: 'assumed', unit: 'explicit alternative test input', basis: 'Fixture-only published source for typed reader validation.' });
  const load = async () => readPlanningPolicy(new PolicyService({ provider: { async loadVersions() { return [seed]; } } }),
    { runId: source.runId, policyVersion: seed.policyVersion, asOf: source.asOf });
  let read = await load(); assert.equal(read.status, 'ok');
  const apply = (p) => planOrder({ ...source, constraints: p.value, catalog: source.catalog.map((d) => ({ ...d, leadTimeDays: p.value.leadTimeDays })) });
  const before = apply(read);
  seed.assumptions.find((a) => a.key === 'orderPlan.budgetMinor').value = 0;
  read = await load(); const after = apply(read);
  assert.equal(before.orderQuantity, 2); assert.equal(after.orderQuantity, 0);
  assert.equal(read.value.provenance.find((a) => a.key === 'orderPlan.budgetMinor').value, 0);
});

test('feasible, infeasible and alternative DTO fixtures retain exact panel shapes', async () => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/gcsp-order-plan-outcomes.json', import.meta.url)));
  assert.equal(fixtures.cases.length, 3);
  for (const fixture of fixtures.cases) assert.deepEqual(planOrder(fixture.input), fixture.result, fixture.name);
  assert.ok(fixtures.cases[0].result.alternatives.length >= 1);
  assert.deepEqual(fixtures.cases[1].result.quantities, []);
});

test('bounded exhaustive planner agrees with independent tiny assignment oracle', () => {
  // The oracle explicitly tries every employee assignment; it shares no matching code.
  for (let seed = 0; seed < 16; seed += 1) {
    const source = input(); source.constraints.budgetMinor = seed + 3;
    source.forecast.entitlements[0].acceptableDerivativeIds = seed % 3 === 0 ? ['a'] : ['a', 'b'];
    source.forecast.entitlements[1].acceptableDerivativeIds = seed % 4 === 0 ? ['b'] : ['a'];
    let optimum = -Infinity;
    const covers = (at, remaining) => {
      if (at === source.forecast.entitlements.length) return 0;
      let best = covers(at + 1, remaining);
      for (const id of source.forecast.entitlements[at].acceptableDerivativeIds) {
        if (!remaining[id]) continue;
        const next = { ...remaining, [id]: remaining[id] - 1 };
        best = Math.max(best, 1 + covers(at + 1, next));
      }
      return best;
    };
    for (let a = 0; a <= 2; a += 1) for (let b = 0; b <= 2; b += 1) {
      if (a * 10 + b * 8 > source.constraints.budgetMinor) continue;
      const covered = covers(0, { a, b });
      optimum = Math.max(optimum, covered * 100 - (a + b - covered) * 10);
    }
    assert.equal(planOrder(source).objective.value, optimum, `seed ${seed}`);
  }
});
