import test from 'node:test';
import assert from 'node:assert/strict';
import * as planning from '../gcsp/predict/plan/index.js';
import { createEmployeeTerms } from '../vehicles/index.js';
import { setup, confirm, offer } from './helpers/greg-demand-run.js';
import { stock, fact as sourceFact, preference } from './helpers/employee-recommendation.js';
import { planningInput, withContractEnd } from './helpers/order-plan-input.js';

const fact = (...args) => { const value = sourceFact(...args); value.provenance.observedAt = '2026-11-05T00:00:00.000Z'; return value; };

// The seeded manual context leaves driver eligibility unconfirmed; these tests need it confirmed in the stored row.
const storedFacts = (contract) => ({ ...contract, manualContext: { ...contract.manualContext,
  employeeFacts: { essentials: {}, driverEligible: fact(true), charging: fact('home') } } });

async function fixture() {
  const f = await setup({ canonical: true });
  await f.write(async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } };
    const row = (await tx.get(ref)).value;
    return tx.compareAndSwap(ref, row.version, { renewalId: 'renewal-known',
      contract: storedFacts(withContractEnd(row.contract, '2026-11-26')) });
  });
  await f.write(async (tx) => {
    const ref = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.employee.entitlementSlotId } };
    const row = (await tx.get(ref)).value;
    return tx.compareAndSwap(ref, row.version, { renewalId: 'renewal-known' });
  });
  await confirm(f);
  const employee = (await f.repository.query(f.context, 'employees')).value.find((e) => e.employeeId === f.employee.employeeId);
  employee.contract.manualContext.employeeFacts = { essentials: {}, driverEligible: fact(true), charging: fact('home') };
  const brief = (await f.repository.query(f.context, 'briefs')).value[0];
  const asOf = (await f.clock.now(f.context)).value.now;
  const read = { runId: f.context.runId, asOf, policyVersion: f.context.policyVersion, horizonEnd: '2026-12-05T00:00:00.000Z' };
  const configuration = { configurationId: 'RzIxOlMx', derivativeId: 'a', version: 'explicit-future-facts-v1',
    display: { name: 'Explicit future configuration' }, facts: { ...structuredClone(stock().snapshot.facts), modelLine: fact('G21 Touring') } };
  for (const value of Object.values(configuration.facts)) value.provenance.observedAt = asOf;
  const catalog = { runId: f.context.runId, asOf, policyVersion: f.context.policyVersion, version: 'explicit-future-catalog-v1',
    derivatives: [{ derivativeId: 'a', modelId: 'model-a', configurationIds: [configuration.configurationId] }], configurations: [configuration] };
  const history = { decisions: [], offers: [], briefs: [brief] };
  const args = { read, employee, brief, catalog, history };
  let termChange = (value) => value;
  const terms = { async readFutureTerms(context, request) {
    const employeeContext = { ...context, ...request.employee, roles: ['employee'] };
    const car = Object.fromEntries(Object.entries(request.configuration.facts).filter(([, v]) => v.status === 'known').map(([k, v]) => [k, v.value]));
    const points = await f.policy.getPointsCost(employeeContext, { ...car, configurationId: request.configuration.configurationId }, read);
    const allowance = await f.policy.getAllowance(employeeContext, read);
    return { status: 'ok', value: termChange({ runId: context.runId, asOf, policyVersion: context.policyVersion,
      employeeId: request.employee.employeeId, renewalId: request.employee.renewalId, briefVersion: request.brief.briefVersion,
      catalogVersion: catalog.version, configurationId: request.configuration.configurationId, version: 'explicit-future-terms-v1',
      terms: createEmployeeTerms({ termsVersion: 'future-quote-v1', points: { value: points.value.monthlyPoints, unit: 'points' },
        allowanceInputs: { allowance: { value: allowance.value.monthlyPoints, unit: 'points' } }, contribution: null,
        validFrom: asOf, validUntil: '2026-12-01T00:00:00.000Z',
        provenance: { sourceRef: 'explicit-alternative-future-terms', version: 'terms-fixture-v1', observedAt: asOf, assurance: 'synthetic-scenario' } }) }) };
  } };
  const evaluate = async () => {
    assert.equal(typeof planning.createFutureChoiceEvaluator, 'function', 'The configuration-only future evaluator is required.');
    return planning.createFutureChoiceEvaluator({ policy: f.policy, identity: f.identity, terms }).evaluateChoices(f.context, args);
  };
  return { ...f, args, configuration, catalog, evaluate, terms, changeTerms: (change) => { termChange = change; } };
}

test('future evaluator uses shared gates and canonical terms without creating exact stock', async () => {
  const f = await fixture();
  const before = structuredClone(f.args);
  const out = await f.evaluate();
  assert.equal(out.status, 'ok'); assert.deepEqual(out.value.acceptableDerivativeIds, ['a']);
  assert.equal(out.value.decisions[0].gateStatus, 'eligible');
  assert.equal(out.value.decisions[0].configurationId, 'RzIxOlMx');
  assert.ok(out.value.decisions[0].score !== null);
  assert.equal(Object.hasOwn(out.value.decisions[0], 'orderUuid'), false);
  assert.equal(Object.hasOwn(out.value.decisions[0], 'availability'), false);
  assert.deepEqual(f.args, before);
  assert.deepEqual(await f.evaluate(), out);
});

test('future choices retain essential, driver, charging and matrix gates before preferences', async () => {
  const cases = [
    { change: (f) => { f.configuration.facts.seats = fact(4, 'count'); }, gate: 'essential-unmet' },
    { change: (f) => { f.configuration.facts.seats = fact(null, 'count'); }, gate: 'essential-unconfirmed' },
    { change: (f) => { f.args.employee.contract.manualContext.employeeFacts.driverEligible = fact(null); }, gate: 'driver-unconfirmed' },
    { change: (f) => { f.configuration.facts.fuel = fact('ev'); f.args.employee.contract.manualContext.employeeFacts.charging = fact('none'); }, gate: 'charging-unavailable' },
    { change: (f) => { f.configuration.facts.eligibilityModelKey = fact('G21 Touring|M340i'); }, gate: 'policy-exclude' },
    { change: (f) => { f.args.employee.gradeId = 'G1-6'; }, gate: 'allowance-exceeded' },
  ];
  for (const { change, gate } of cases) {
    const f = await fixture(); change(f);
    const out = await f.evaluate();
    assert.equal(out.status, 'ok', gate); assert.deepEqual(out.value.acceptableDerivativeIds, [], gate);
    assert.ok(out.value.gates.includes(gate), gate); assert.equal(out.value.decisions[0].score, null);
  }
});

test('low preference fit remains advisory and unconfirmed preferences are not invented', async () => {
  const f = await fixture(); f.configuration.facts.body = fact('saloon');
  let out = await f.evaluate(); assert.deepEqual(out.value.acceptableDerivativeIds, ['a']);
  assert.ok(out.value.decisions[0].tradeOffs.length > 0);
  f.args.brief.preferences.body = { ...preference('estate'), valueState: 'inferred' };
  out = await f.evaluate(); assert.deepEqual(out.value.acceptableDerivativeIds, ['a']);
  assert.ok(out.value.decisions[0].unknowns.some((g) => g.code === 'preference-unconfirmed'));
});

test('a derivative with one unsuitable represented configuration cannot promise the suitable sibling', async () => {
  const f = await fixture();
  const other = structuredClone(f.configuration); other.configurationId = 'explicit-other-config'; other.facts.seats = fact(4, 'count');
  f.catalog.configurations.push(other); f.catalog.derivatives[0].configurationIds.push(other.configurationId);
  const out = await f.evaluate(); assert.equal(out.status, 'ok');
  assert.equal(out.value.decisions[0].gateStatus, 'eligible');
  assert.equal(out.value.decisions[1].gateStatus, 'ineligible');
  assert.deepEqual(out.value.acceptableDerivativeIds, []);
  assert.ok(out.value.gates.includes('derivative-representation-not-fully-eligible:a'));
});

test('future terms and facts must represent the exact run, policy, employee, configuration and renewal', async () => {
  for (const patch of [{ runId: 'another-run' }, { policyVersion: 'another-policy' }, { employeeId: 'another-employee' },
    { configurationId: 'another-configuration' }, { catalogVersion: 'another-catalog' }, { renewalId: 'another-renewal' },
    { version: '' }]) {
    const f = await fixture(); f.changeTerms((value) => ({ ...value, ...patch }));
    assert.equal((await f.evaluate()).status, 'unavailable');
  }
  const f = await fixture();
  f.changeTerms((value) => ({ ...value, terms: { ...value.terms, validUntil: '2026-11-26T23:59:59.999Z' } }));
  assert.equal((await f.evaluate()).code, 'planning-future-terms-invalid');
  f.changeTerms((value) => ({ ...value, terms: { ...value.terms, points: { value: 0, unit: 'points' } } }));
  assert.equal((await f.evaluate()).code, 'planning-future-terms-invalid');
  f.changeTerms((value) => value);
  f.catalog.derivatives[0].configurationIds.push('missing-config');
  assert.equal((await f.evaluate()).code, 'planning-future-catalog-invalid');
});

test('declined exact stock stays excluded until a relevant confirmed business change', async () => {
  const f = await fixture();
  const old = structuredClone(f.args.brief);
  f.args.history.offers = [{ offerId: 'declined-offer', employeeId: old.employeeId, orderUuid: 'declined-unit' }];
  f.args.history.decisions = [{ employeeId: old.employeeId, decision: 'decline', offerId: 'declined-offer', versions: { brief: old.briefVersion } }];
  let out = await f.evaluate(); assert.deepEqual(out.value.excludedStockIds, ['declined-unit']);
  assert.deepEqual(out.value.acceptableDerivativeIds, ['a']);
  f.args.brief = { ...structuredClone(old), briefVersion: 2, confirmedAt: f.args.read.asOf };
  f.args.history.briefs = [old, f.args.brief];
  out = await f.evaluate(); assert.deepEqual(out.value.excludedStockIds, ['declined-unit']);
  f.args.brief.preferences.body = { ...preference('saloon'), valueState: 'inferred' };
  out = await f.evaluate(); assert.deepEqual(out.value.excludedStockIds, ['declined-unit']);
  f.args.brief.preferences.body = preference('saloon');
  out = await f.evaluate(); assert.deepEqual(out.value.excludedStockIds, []);
  f.args.history.decisions[0].decision = 'expire';
  f.args.brief = old;
  out = await f.evaluate(); assert.deepEqual(out.value.excludedStockIds, []);
});

test('declined exact unit cannot cover its employee while another unit of the derivative can', () => {
  const source = planningInput(); source.constraints.budgetMinor = 0;
  source.forecast.entitlements = [source.forecast.entitlements.find((e) => e.entitlementId === 'single')];
  source.forecast.entitlements[0].excludedStockIds = ['declined-unit'];
  source.stock = [{ stockId: 'declined-unit', derivativeId: 'a', availableAt: source.asOf, heldForEntitlementId: null }];
  let out = planning.planOrder(source); assert.equal(out.expectedAcceptableCoverage.covered, 0);
  assert.ok(out.unmetNeeds[0].gates.includes('declined-unchanged'));
  source.stock.push({ ...source.stock[0], stockId: 'another-unit' });
  out = planning.planOrder(source); assert.equal(out.expectedAcceptableCoverage.covered, 1);
  assert.equal(out.allocations[0].sourceId, 'stock:another-unit');
});

test('future evaluator fails closed on absent ports, facts, history and unknown renewal', async () => {
  const f = await fixture();
  assert.equal((await planning.createFutureChoiceEvaluator().evaluateChoices(f.context, f.args)).status, 'unavailable');
  const forged = { ...f.context };
  const service = planning.createFutureChoiceEvaluator({ ...f, terms: f.terms });
  assert.equal((await service.evaluateChoices(forged, f.args)).status, 'forbidden');
  delete f.args.employee.contract.manualContext.employeeFacts;
  assert.equal((await f.evaluate()).code, 'planning-future-employee-facts-unavailable');
  f.args.employee.contract.manualContext.employeeFacts = { essentials: {}, driverEligible: fact(true) };
  delete f.args.history;
  assert.equal((await f.evaluate()).code, 'planning-future-decline-history-incomplete');
  f.args.history = { decisions: [], offers: [], briefs: [f.args.brief] };
  f.args.employee.contract = withContractEnd(f.args.employee.contract, undefined);
  assert.equal((await f.evaluate()).code, 'planning-future-input-invalid');
});

test('actual saved-demand forecast composes the evaluator and preserves exact decline exclusions', async () => {
  const f = await fixture(); await offer(f, 1, 'declined', 'decline');
  const before = await f.service.readDemand(f.context);
  const provider = planning.createExpressedOrderForecastProvider({ ...f,
    catalog: { async readCatalog() { return { status: 'ok', value: structuredClone(f.catalog) }; } },
    futureChoices: planning.createFutureChoiceEvaluator({ ...f, terms: f.terms }) });
  const out = await provider.readForecast(f.context, f.args.read);
  assert.equal(out.status, 'ok'); assert.equal(out.value.forecast.entitlements.length, 1);
  assert.deepEqual(out.value.forecast.entitlements[0].acceptableDerivativeIds, ['a']);
  assert.deepEqual(out.value.forecast.entitlements[0].excludedStockIds, ['00000000-0000-4000-8000-000000000001']);
  assert.deepEqual(await f.service.readDemand(f.context), before);
});

test('a confirmed earlier required-by date narrows renewal coverage and never extends it', async () => {
  const f = await fixture();
  f.args.employee.contract.manualContext.employeeFacts.requiredBy = fact('2026-11-20T00:00:00.000Z');
  let out = await f.evaluate(); assert.equal(out.value.requiredBy, '2026-11-20T00:00:00.000Z');
  f.args.employee.contract.manualContext.employeeFacts.requiredBy = fact('2027-01-01T00:00:00.000Z');
  out = await f.evaluate(); assert.equal(out.value.requiredBy, '2026-11-26T23:59:59.999Z');
  f.args.employee.contract.manualContext.employeeFacts.requiredBy = fact(null);
  out = await f.evaluate(); assert.deepEqual(out.value.acceptableDerivativeIds, []);
  assert.ok(out.value.gates.includes('required-by-unconfirmed'));
});

test('confirmed inbound after required-by cannot satisfy a later renewal', () => {
  const source = planningInput(); source.constraints.budgetMinor = 0;
  source.forecast.entitlements = [source.forecast.entitlements.find((e) => e.entitlementId === 'single')];
  source.forecast.entitlements[0].requiredBy = '2026-11-20T00:00:00.000Z';
  source.inbound = [{ supplyId: 'later-arrival', derivativeId: 'a', quantity: 1, releasedQuantity: 0,
    state: 'confirmed', expectedAt: '2026-11-25T00:00:00.000Z' }];
  const out = planning.planOrder(source);
  assert.equal(out.expectedAcceptableCoverage.covered, 0);
  assert.ok(out.unmetNeeds[0].gates.includes('arrival-after-required-by'));
});
