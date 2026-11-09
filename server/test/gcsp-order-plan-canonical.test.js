import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as planning from '../gcsp/predict/plan/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { setup, confirm, fact as sourceFact } from './helpers/greg-demand-run.js';
import { withContractEnd } from './helpers/order-plan-input.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
const fact = (...args) => { const value = sourceFact(...args); value.provenance.observedAt = '2026-11-05T00:00:00.000Z'; return value; };
const TOURING = 'g21-touring-320i';

// A clone of the unmodified seed with entries edited in place (no code change).
const variant = (edit) => {
  const source = structuredClone(seed);
  edit(Object.fromEntries(source.assumptions.map((a) => [a.key, a])));
  return new PolicyService({ provider: { async loadVersions() { return [source]; } } });
};

// F104 tables are not on this base: an injected port with the provider's output shape.
function supplyPort(f, policy, inbound = []) {
  const catalog = planning.createPolicyOrderPlanCatalog({ policy });
  return { async readSupply(context, read) {
    const choices = await catalog.readCatalog(context, read);
    return { status: 'ok', value: { runId: context.runId, asOf: read.asOf, stock: [], inbound: structuredClone(inbound),
      versions: { stock: 'stock-empty-v1', supply: `supply-v1:${inbound.length}`, catalog: choices.value.version } } };
  } };
}

// `seeded` keeps the F112 manual-context contract and facts exactly as seeded, and stamps only
// the slot's own renewal id on the employee row (the demo identity seeding leaves it unset).
async function fixture({ contractEnd = '2027-02-15', seeded = false, stampRenewal = true } = {}) {
  const f = await setup({ canonical: true });
  const slotRef = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.employee.entitlementSlotId } };
  const renewalId = seeded ? (await f.repository.read(f.context, slotRef)).value.renewalId : 'renewal-known';
  if (stampRenewal) await f.write(async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } };
    const row = (await tx.get(ref)).value;
    if (seeded) return tx.compareAndSwap(ref, row.version, { renewalId });
    const contract = withContractEnd(row.contract, contractEnd);
    return tx.compareAndSwap(ref, row.version, { renewalId, contract: { ...contract, manualContext: { ...contract.manualContext,
      employeeFacts: { essentials: {}, driverEligible: fact(true), charging: fact('home') } } } });
  });
  if (!seeded) await f.write(async (tx) => {
    const row = (await tx.get(slotRef)).value;
    return tx.compareAndSwap(slotRef, row.version, { renewalId });
  });
  await confirm(f);
  const asOf = (await f.clock.now(f.context)).value.now;
  const read = { runId: f.context.runId, asOf, policyVersion: f.context.policyVersion };
  const planFor = (policy = f.policy, inbound = [], request) => planning.createCanonicalOrderPlanService({ ...f, policy,
    supply: supplyPort(f, policy, inbound) }).readPlan(f.context, request);
  return { ...f, asOf, read, planFor };
}
const quantity = (plan, id) => plan.quantities.find((q) => q.derivativeId === id)?.quantity ?? 0;
const bound = (rules, field, key, id) => rules.value[field].find((b) => b[key] === id);

test('planning policy and catalogue read from the unmodified seed, pinned to gcsp-policy-v1', async () => {
  const f = await fixture();
  const rules = await planning.readPlanningPolicy(f.policy, f.read);
  assert.equal(rules.status, 'ok'); assert.equal(rules.policyVersion, 'gcsp-policy-v1');
  assert.equal(rules.value.provenance.length, planning.PLANNING_POLICY_KEYS.length);
  assert.ok(rules.value.provenance.every((row) => row.policyVersion === 'gcsp-policy-v1' && row.status === 'assumed'));
  assert.deepEqual([rules.value.horizonDays, rules.value.budgetMinor, rules.value.currency, rules.value.leadTimeDays], [120, 20000000, 'GBP', 56]);
  const out = await planning.createPolicyOrderPlanCatalog({ policy: f.policy }).readCatalog(f.context, f.read);
  assert.equal(out.status, 'ok'); const catalog = out.value;
  assert.equal(catalog.policyVersion, 'gcsp-policy-v1'); assert.equal(catalog.version, 'gcsp-policy-v1:order-plan-catalog.v1');
  assert.equal(catalog.currency, rules.value.currency);
  assert.equal(catalog.derivatives.length, 5); assert.equal(catalog.configurations.length, 5);
  assert.deepEqual(catalog.derivatives.map((d) => d.modelId).filter((id, i, all) => all.indexOf(id) === i).sort(), ['f70-hatch', 'g20-saloon', 'g21-touring', 'g61-i5']);
  // Bounds name exactly the catalogue identities.
  assert.deepEqual(rules.value.derivativeBounds.map((b) => b.derivativeId).sort(), catalog.derivatives.map((d) => d.derivativeId).sort());
  assert.deepEqual(rules.value.modelBounds.map((b) => b.modelId).sort(), [...new Set(catalog.derivatives.map((d) => d.modelId))].sort());
  assert.ok(catalog.derivatives.every((d) => d.unitCostMinor >= 3300000 && d.unitCostMinor <= 6200000));
  const reused = (await f.policy.getAssumption('comparison.configurationSet.v1', f.read)).value.value.configurations.map((c) => c.configurationId);
  assert.equal(catalog.configurations.filter((c) => reused.includes(c.configurationId)).length, 4);
  for (const c of catalog.configurations) for (const [key, value] of Object.entries(c.facts)) {
    assert.ok(['known', 'unknown'].includes(value.status), key);
    assert.equal(value.provenance.sourceRef, 'policy:orderPlan.catalog.v1');
    assert.ok(Date.parse(value.provenance.observedAt) <= Date.parse(f.asOf), key);
  }
});

test('the catalogue provider fails closed on an absent, mismatched or malformed entry', async () => {
  const f = await fixture();
  const read = (policy, patch = {}) => planning.createPolicyOrderPlanCatalog({ policy }).readCatalog(f.context, { ...f.read, ...patch });
  const plain = variant(() => {}); const source = structuredClone(seed);
  source.assumptions = source.assumptions.filter((a) => a.key !== 'orderPlan.catalog.v1');
  const missing = new PolicyService({ provider: { async loadVersions() { return [source]; } } });
  assert.deepEqual([(await read(missing)).status, (await read(missing)).code], ['unavailable', 'planning-catalog-unavailable']);
  assert.equal((await read(plain, { policyVersion: 'gcsp-policy-v0' })).status, 'unavailable');
  const mismatch = { async getAssumption(key, readArg) { const row = await plain.getAssumption(key, readArg); return { ...row, policyVersion: 'other' }; } };
  assert.equal((await read(mismatch)).code, 'planning-catalog-policy-mismatch');
  for (const edit of [(c) => { c.derivatives[0].unitCostMinor = 1.5; }, (c) => { c.derivatives[0].configurationIds = ['unknown-config']; },
    (c) => { c.configurations[1].derivativeId = c.derivatives[0].derivativeId; }, (c) => { c.derivatives.pop(); },
    (c) => { c.configurations[0].facts.seats.unit = null; }, (c) => { delete c.derivatives[2].production; }]) {
    const out = await read(variant((a) => edit(a['orderPlan.catalog.v1'].value)));
    assert.deepEqual([out.status, out.code], ['invalid', 'planning-catalog-invalid']);
  }
  assert.equal((await planning.createPolicyOrderPlanCatalog().readCatalog(f.context, f.read)).status, 'unavailable');
});

test('future terms are the canonical points and allowance and fail closed on any non-ok read', async () => {
  const f = await fixture();
  const catalog = (await planning.createPolicyOrderPlanCatalog({ policy: f.policy }).readCatalog(f.context, f.read)).value;
  const employee = (await f.repository.query(f.context, 'employees')).value.find((e) => e.employeeId === f.employee.employeeId);
  const brief = (await f.repository.query(f.context, 'briefs')).value[0];
  const read = { ...f.read, horizonEnd: '2027-03-05T09:00:00.000Z' };
  const request = (configuration, over = {}) => ({ read, employee, brief, catalogVersion: catalog.version, configuration, renewalAt: '2027-02-15T23:59:59.999Z', ...over });
  const touring = catalog.configurations.find((c) => c.derivativeId === TOURING);
  const terms = planning.createPolicyFutureTermsProvider({ policy: f.policy });
  const out = await terms.readFutureTerms(f.context, request(touring));
  assert.equal(out.status, 'ok');
  assert.deepEqual([out.value.terms.points.value, out.value.terms.allowanceInputs.allowance.value], [1100, 1300]);
  assert.deepEqual([out.value.terms.validFrom, out.value.terms.validUntil], [read.asOf, read.horizonEnd]);
  assert.equal(out.value.version, `future-terms:gcsp-policy-v1:${touring.configurationId}`);
  assert.deepEqual(await terms.readFutureTerms(f.context, request(touring)), out);
  const unpriced = structuredClone(touring); unpriced.facts.eligibilityModelKey.value = 'Unpriced|model';
  assert.equal((await terms.readFutureTerms(f.context, request(unpriced))).status, 'unavailable');
  assert.equal((await terms.readFutureTerms(f.context, request(touring, { employee: { ...employee, gradeId: 'unknown-grade' } }))).status, 'unavailable');
  assert.equal((await terms.readFutureTerms(f.context, request(touring, { read: { ...read, horizonEnd: undefined } }))).status, 'unavailable');
  assert.equal((await planning.createPolicyFutureTermsProvider().readFutureTerms(f.context, request(touring))).status, 'unavailable');
});

test('canonical readPlan gives Greg a feasible integer plan inside every bound and the budget', async () => {
  const f = await fixture();
  const rules = await planning.readPlanningPolicy(f.policy, f.read);
  const plan = await f.planFor();
  assert.equal(plan.status, 'feasible', JSON.stringify(plan).slice(0, 400));
  assert.equal(plan.quantities.length, 5);
  for (const q of plan.quantities) {
    const b = bound(rules, 'derivativeBounds', 'derivativeId', q.derivativeId);
    assert.ok(Number.isInteger(q.quantity) && q.quantity >= b.min && q.quantity <= b.max, q.derivativeId);
  }
  for (const m of plan.modelQuantities) {
    const b = bound(rules, 'modelBounds', 'modelId', m.modelId);
    assert.ok(Number.isInteger(m.quantity) && m.quantity >= b.min && m.quantity <= b.max, m.modelId);
  }
  assert.ok(plan.spendMinor <= rules.value.budgetMinor); assert.equal(plan.currency, 'GBP');
  assert.equal(quantity(plan, TOURING), 1); assert.equal(plan.orderQuantity, 1); assert.equal(plan.spendMinor, 4200000);
  assert.deepEqual([plan.expectedAcceptableCoverage.covered, plan.expectedAcceptableCoverage.total], [1, 1]);
  assert.deepEqual(plan.allocations.map((a) => [a.derivativeId, a.source]), [[TOURING, 'new-order']]);
  assert.equal(plan.versions.policy, 'gcsp-policy-v1'); assert.equal(plan.versions.catalog, 'gcsp-policy-v1:order-plan-catalog.v1');
  assert.equal(plan.policyProvenance.length, 7);
  assert.ok(plan.policyProvenance.every((row) => row.policyVersion === 'gcsp-policy-v1'));
  assert.ok(plan.limitations.length > 0 && plan.objective.tradeOff && plan.alternatives[0].kind === 'zero-new-orders-baseline');
  assert.equal(plan.alternatives[0].expectedAcceptableCoverage.covered, 0);
  assert.ok(plan.alternatives[0].unmetNeeds[0].gates.includes('objective-tradeoff'), JSON.stringify(plan.alternatives[0].unmetNeeds));
  assert.ok(plan.bindingConstraints.length > 0);
});

test('changing one seed entry changes the plan with no code edit', async () => {
  const f = await fixture(); const base = await f.planFor();
  const capped = await f.planFor(variant((a) => { a['orderPlan.derivativeBounds'].value.find((b) => b.derivativeId === TOURING).max = 0; }));
  assert.equal(capped.status, 'feasible'); assert.equal(quantity(capped, TOURING), 0);
  assert.equal(capped.expectedAcceptableCoverage.covered, 0); assert.notEqual(capped.planId, base.planId);
  assert.ok(capped.unmetNeeds[0].constraintIds.some((id) => id.startsWith(`derivative:${TOURING}`)), JSON.stringify(capped.unmetNeeds));
  const noCoverageWeight = await f.planFor(variant((a) => { a['orderPlan.objectiveWeights'].value.coverage = 0; }));
  assert.equal(noCoverageWeight.orderQuantity, 0); assert.deepEqual(noCoverageWeight.objective.weights, { coverage: 0, unallocatedStock: 10, costMinor: 0 });
  const dearer = await f.planFor(variant((a) => { a['orderPlan.catalog.v1'].value.derivatives.find((d) => d.derivativeId === TOURING).unitCostMinor = 4800000; }));
  assert.equal(quantity(dearer, TOURING), 1); assert.equal(dearer.spendMinor, 4800000);
  const tight = await f.planFor(variant((a) => { a['orderPlan.budgetMinor'].value = 4000000; }));
  assert.equal(tight.orderQuantity, 0); assert.deepEqual(tight.unmetNeeds[0].constraintIds, ['budget']);
});

test('a contradictory bound is infeasible and names the conflicting constraints', async () => {
  const f = await fixture();
  const plan = await f.planFor(variant((a) => {
    a['orderPlan.budgetMinor'].value = 5000000;
    a['orderPlan.modelBounds'].value.find((b) => b.modelId === 'g61-i5').min = 1;
  }));
  assert.equal(plan.status, 'infeasible'); assert.deepEqual(plan.quantities, []);
  const ids = plan.conflicts.map((c) => c.id);
  assert.ok(ids.includes('budget') && ids.includes('model:g61-i5:min'), JSON.stringify(ids));
  const inverted = await f.planFor(variant((a) => { a['orderPlan.modelBounds'].value.find((b) => b.modelId === 'g20-saloon').min = 5; }));
  assert.equal(inverted.status, 'infeasible'); assert.ok(inverted.conflicts.some((c) => c.id === 'model:g20-saloon:min'));
});

test('the same inputs give the same plan id and plan', async () => {
  const f = await fixture();
  const first = await f.planFor(); const second = await f.planFor();
  assert.equal(first.status, 'feasible'); assert.equal(second.planId, first.planId); assert.deepEqual(second, first);
});

test('a confirmed inbound row reduces the new-order quantity', async () => {
  const f = await fixture(); const base = await f.planFor();
  const inbound = [{ supplyId: 'confirmed-supply-1', derivativeId: TOURING, state: 'confirmed', quantity: 1, releasedQuantity: 0,
    expectedAt: '2027-01-10T00:00:00.000Z', provenance: { requestId: 'request-1', source: 'injected-f104-shaped-port' } }];
  const covered = await f.planFor(f.policy, inbound);
  assert.equal(covered.status, 'feasible');
  assert.equal(quantity(base, TOURING), 1); assert.equal(quantity(covered, TOURING), 0); assert.equal(covered.spendMinor, 0);
  assert.deepEqual(covered.allocations.map((a) => a.sourceId), ['supply:confirmed-supply-1']);
  assert.equal(covered.expectedAcceptableCoverage.covered, 1); assert.notEqual(covered.planId, base.planId);
  const released = await f.planFor(f.policy, [{ ...inbound[0], releasedQuantity: 1 }]);
  assert.equal(quantity(released, TOURING), 1);
});

test('the untouched seeded demo employee reaches a plan via the slot renewal, gated driver-unconfirmed', async () => {
  const f = await fixture({ seeded: true, stampRenewal: false });
  const plan = await f.planFor();
  assert.equal(plan.status, 'feasible'); assert.equal(plan.orderQuantity, 0);
  assert.deepEqual([plan.expectedAcceptableCoverage.covered, plan.expectedAcceptableCoverage.total], [0, 1]);
  assert.equal(plan.unmetNeeds.length, 1);
  assert.ok(plan.unmetNeeds[0].gates.includes('driver-unconfirmed'), JSON.stringify(plan.unmetNeeds));
  assert.ok(plan.unmetNeeds[0].gates.includes('no-permitted-acceptable-choice'));
});
