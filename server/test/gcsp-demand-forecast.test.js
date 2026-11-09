import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as planning from '../gcsp/predict/plan/index.js';
import * as forecasting from '../gcsp/predict/forecast/index.js';
import { createModelArtifact, writeModelArtifact, readModelArtifact } from '../gcsp/predict/model/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { activateRunPolicy } from '../gcsp/policy/activation.js';
import { setup, confirm, saved, fact as sourceFact } from './helpers/greg-demand-run.js';
import { preference, essential } from './helpers/employee-recommendation.js';
import { withContractEnd } from './helpers/order-plan-input.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
const ARTIFACTS = fileURLToPath(new URL('../../docs/gcsp/models/artifacts/', import.meta.url));
const FIXTURE_ID = 'sha256:2ce1109d986c7709bf9505f8e388e9c1479ff3c36e7cae86f656ff29bb973c7d';
const FIXTURE = await readModelArtifact(`${ARTIFACTS}${FIXTURE_ID.slice(7)}.json`, FIXTURE_ID);
const TOURING = 'g21-touring-320i';
const REFERENCE = 'choice.model.reference';
const fact = (...args) => { const value = sourceFact(...args); value.provenance.observedAt = '2026-11-05T00:00:00.000Z'; return value; };

// A clone of the unmodified seed, edited in place; `edit(byKey, source)` may add or remove rows.
const variant = (edit = () => {}) => {
  const source = structuredClone(seed);
  edit(Object.fromEntries(source.assumptions.map((a) => [a.key, a])), source);
  return new PolicyService({ provider: { async loadVersions() { return [source]; } } });
};
const row = (key, value, source) => ({ key, value, unit: 'test-fixture', status: 'assumed', basis: 'Test activation of a synthetic-trained artifact.',
  source: 'server/test/gcsp-demand-forecast.test.js', sourceDate: '2026-11-09', policyVersion: source.policyVersion, effectiveFrom: source.effectiveFrom });
const reference = (artifactId, featureVersion = 'vehicle-preference-v1') => ({ artifactId, featureVersion, schemaVersion: 1 });
const withModel = (id, featureVersion) => (a, source) => source.assumptions.push(row(REFERENCE, reference(id, featureVersion), source));
const active = (edit = () => {}) => variant((a, source) => { withModel(FIXTURE_ID)(a, source); edit(a, source); });
const settings = (patch) => (a) => { a['forecast.learned.v1'].value = { ...a['forecast.learned.v1'].value, ...patch }; };

function supplyPort(f, policy) {
  const catalog = planning.createPolicyOrderPlanCatalog({ policy });
  return { async readSupply(context, read) {
    const choices = await catalog.readCatalog(context, read);
    return { status: 'ok', value: { runId: context.runId, asOf: read.asOf, stock: [], inbound: [],
      versions: { stock: 'stock-empty-v1', supply: 'supply-v1:0', catalog: choices.value.version } } };
  } };
}

async function fixture(brief = saved(), policyProvider) {
  const f = await setup({ canonical: true, policyProvider });
  const slotRef = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.employee.entitlementSlotId } };
  await f.write(async (tx) => {
    const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.employee.employeeId } };
    const current = (await tx.get(ref)).value; const contract = withContractEnd(current.contract, '2027-02-15');
    return tx.compareAndSwap(ref, current.version, { renewalId: 'renewal-known', contract: { ...contract, manualContext: { ...contract.manualContext,
      employeeFacts: { essentials: {}, driverEligible: fact(true), charging: fact('home') } } } });
  });
  await f.write(async (tx) => { const current = (await tx.get(slotRef)).value; return tx.compareAndSwap(slotRef, current.version, { renewalId: 'renewal-known' }); });
  await confirm(f, brief);
  return f;
}
const readOf = async (f, context = f.context) => {
  const { now } = (await f.clock.now(context)).value;
  return { runId: context.runId, asOf: now, policyVersion: context.policyVersion, horizonEnd: new Date(Date.parse(now) + 120 * 86400000).toISOString() };
};

// Read-only repository view: any non-read method throws and every call is recorded.
function guarded(repository) {
  const calls = [];
  const proxy = new Proxy({}, { get(_, prop) {
    if (typeof repository[prop] !== 'function') return repository[prop];
    if (prop !== 'query') return () => { throw new Error(`write path used: ${String(prop)}`); };
    return (...args) => { calls.push(prop); return repository.query(...args); };
  } });
  return { proxy, calls };
}
function learned(f, policy, artifactDirectory = ARTIFACTS, repository = f.repository) {
  const catalog = planning.createPolicyOrderPlanCatalog({ policy });
  const futureChoices = planning.createFutureChoiceEvaluator({ policy, identity: f.identity, terms: planning.createPolicyFutureTermsProvider({ policy }) });
  return forecasting.createLearnedOrderForecastProvider({ repository, identity: f.identity, clock: f.clock, catalog, futureChoices, policy, artifactDirectory });
}
const plannerFor = (f, policy, forecast) => planning.createOrderPlanService({ policy, identity: f.identity, clock: f.clock, forecast, supply: supplyPort(f, policy),
  catalog: planning.createPolicyOrderPlanCatalog({ policy }) });
const baselineFor = (f, policy) => planning.createCanonicalOrderPlanService({ ...f, policy, supply: supplyPort(f, policy) });
async function inputFor(f, policy, read) {
  const catalog = planning.createPolicyOrderPlanCatalog({ policy });
  const futureChoices = planning.createFutureChoiceEvaluator({ policy, identity: f.identity, terms: planning.createPolicyFutureTermsProvider({ policy }) });
  const expressed = await planning.createExpressedOrderForecastProvider({ repository: f.repository, identity: f.identity, clock: f.clock, catalog, futureChoices,
    predictionContext: true }).readForecast(f.context, read);
  assert.equal(expressed.status, 'ok', JSON.stringify(expressed));
  const choices = await catalog.readCatalog(f.context, read);
  const prepared = await forecasting.createPredictionInput(f.context, { expressed: expressed.value, catalog: choices.value,
    terms: planning.createPolicyFutureTermsProvider({ policy }), read });
  assert.equal(prepared.status, 'ok', JSON.stringify(prepared));
  return { input: prepared.value, expressed: expressed.value };
}
const providerFor = (policy, artifactDirectory = ARTIFACTS) => forecasting.createLearnedDemandForecastProvider({ policy, artifactDirectory });
const keysOf = (value, found = new Set()) => {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, found));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { found.add(k); keysOf(v, found); }
  return found;
};
const ownedDirectory = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'demand-forecast-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};
const variantPayload = (edit) => { const payload = structuredClone(FIXTURE.payload); edit(payload); return createModelArtifact(payload); };

// Employees e1 (two classes) and e2 (saloon only) join the real one, in other cohorts and periods.
function widened(input) {
  const [first] = input.cohort.entitlements; const [choice] = first.permittedChoices;
  const saloon = { ...structuredClone(choice), derivativeId: 'd-saloon', configurationId: 'c-saloon', vehicleClass: 'saloon', attributes: { ...choice.attributes, body: 'saloon' } };
  const wide = structuredClone(input);
  wide.cohort.entitlements.push(
    { ...structuredClone(first), entitlementId: 'e1', employeeId: 'x1', cohortKey: 'G1-6', period: '2027-03', permittedChoices: [structuredClone(choice), saloon] },
    { ...structuredClone(first), entitlementId: 'e2', employeeId: 'x2', cohortKey: 'G11-14', period: '2027-03', permittedChoices: [structuredClone(saloon)] });
  return wide;
}

test('gates build the permitted set first: a gated derivative never gets a probability, and the learned path only reads', async (t) => {
  const directory = await ownedDirectory(t);
  // Coefficients that strongly favour non-estates: the gated saloons would win if they were scored.
  const favouring = variantPayload((p) => { p.coefficients[0] = -6; p.coefficients[2] = -6; });
  await writeModelArtifact(directory, favouring);
  const policy = variant(withModel(favouring.artifactId));
  const f = await fixture(); const read = await readOf(f);
  const { input, expressed } = await inputFor(f, policy, read);
  const permitted = input.cohort.entitlements[0].permittedChoices.map((c) => c.derivativeId);
  assert.deepEqual(permitted, [TOURING]);
  assert.deepEqual(permitted, expressed.forecast.entitlements[0].acceptableDerivativeIds);
  const catalog = (await planning.createPolicyOrderPlanCatalog({ policy }).readCatalog(f.context, read)).value;
  assert.ok(catalog.derivatives.length > permitted.length, 'the gates removed derivatives');
  const out = await providerFor(policy, directory).forecast(f.context, input, { runId: read.runId, asOf: read.asOf });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual(out.employees[0].choices.map((c) => c.derivativeId), [TOURING]);
  assert.equal(out.model.artifactId, favouring.artifactId);

  const guard = guarded(f.repository);
  const mapped = await learned(f, policy, directory, guard.proxy).readForecast(f.context, read);
  assert.deepEqual(guard.calls.filter((name) => name !== 'query'), []); assert.ok(guard.calls.length > 0);
  assert.equal(mapped.status, 'ok', JSON.stringify(mapped));
  const permittedSet = new Set(expressed.forecast.entitlements[0].acceptableDerivativeIds);
  for (const e of mapped.value.forecast.entitlements) {
    assert.ok(e.acceptableDerivativeIds.every((id) => permittedSet.has(id)));
    assert.deepEqual([e.gates, e.requiredBy, e.excludedStockIds], [expressed.forecast.entitlements[0].gates,
      expressed.forecast.entitlements[0].requiredBy, expressed.forecast.entitlements[0].excludedStockIds]);
  }
  // The default expressed provider output is untouched by the opt-in.
  const plain = await planning.createExpressedOrderForecastProvider({ repository: f.repository, identity: f.identity, clock: f.clock,
    catalog: planning.createPolicyOrderPlanCatalog({ policy }), futureChoices: planning.createFutureChoiceEvaluator({ policy, identity: f.identity,
      terms: planning.createPolicyFutureTermsProvider({ policy }) }) }).readForecast(f.context, read);
  assert.equal(Object.hasOwn(plain.value, 'predictionContext'), false);
  assert.equal(plain.value.version, expressed.version); assert.deepEqual(plain.value.forecast, expressed.forecast);
});

test('probabilities sum to one per employee including wait; acceptance is not wait; aggregates are consistent; no fit or score field', async () => {
  const f = await fixture(); const policy = active(); const read = await readOf(f);
  const { input } = await inputFor(f, policy, read);
  const wide = widened(input);
  const out = await providerFor(policy).forecast(f.context, wide, { runId: read.runId, asOf: read.asOf });
  assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual([out.basis, out.label], ['synthetic-trained-model', 'Synthetic-trained model']);
  assert.equal(out.employees.length, 3);
  for (const e of out.employees) {
    const total = e.choices.reduce((sum, c) => sum + c.probability, 0) + e.waitProbability;
    assert.ok(Math.abs(total - 1) < 1e-12, `${e.entitlementId}: ${total}`);
    assert.ok(Math.abs(e.acceptanceProbability - (1 - e.waitProbability)) < 1e-12);
    assert.ok(e.choices.every((c) => c.probability > 0 && c.probability < 1));
  }
  const classOf = new Map(wide.cohort.entitlements.flatMap((e) => e.permittedChoices.map((c) => [c.derivativeId, c.vehicleClass])));
  const periodOf = new Map(wide.cohort.entitlements.map((e) => [e.entitlementId, e.period]));
  assert.deepEqual(out.aggregate.map((c) => [c.period, c.vehicleClass]), [['2027-02', 'estate'], ['2027-03', 'estate'], ['2027-03', 'saloon']]);
  const z = out.settings.intervalZ;
  for (const cell of out.aggregate) {
    const q = out.employees.map((e) => e.choices.filter((c) => classOf.get(c.derivativeId) === cell.vehicleClass && periodOf.get(e.entitlementId) === cell.period)
      .reduce((sum, c) => sum + c.probability, 0)).filter((p) => p > 0);
    const expected = q.reduce((a, b) => a + b, 0); const sd = Math.sqrt(q.reduce((a, p) => a + p * (1 - p), 0));
    assert.equal(cell.employees, q.length);
    assert.ok(Math.abs(cell.expected - expected) < 1e-12);
    assert.ok(Math.abs(cell.low - Math.max(0, expected - z * sd)) < 1e-12 && Math.abs(cell.high - Math.min(q.length, expected + z * sd)) < 1e-12);
    assert.ok(0 <= cell.low && cell.low <= cell.expected && cell.expected <= cell.high && cell.high <= cell.employees);
  }
  const names = keysOf(out);
  for (const banned of ['fit', 'score', 'fitScore']) assert.equal(names.has(banned), false, banned);
  assert.deepEqual(out.model, { artifactId: FIXTURE_ID, featureVersion: 'vehicle-preference-v1', modelVersion: 'conditional-logit.l2.v1',
    activationPolicyVersion: 'gcsp-policy-v1', activationEffectiveFrom: '2026-11-04T00:00:00.000Z' });
  assert.equal(out.data.datasetKind, 'synthetic'); assert.match(out.data.dataHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(out.evaluation.overall), ['learned', 'expressedDemand', 'deterministicFit']);
  assert.ok(out.evaluation.partitionCounts.later > 0 && out.evaluation.thin.vehicleClasses.includes('estate'));
  assert.ok(out.limitations.length > 0 && JSON.stringify(out).includes('—') === false);
  assert.deepEqual(await providerFor(policy).forecast(f.context, wide, { runId: read.runId, asOf: read.asOf }), out);
});

test('activating a later policy version changes the next forecast and plan; earlier reads keep the version they used', async (t) => {
  const directory = await ownedDirectory(t);
  await writeModelArtifact(directory, FIXTURE);
  const second = variantPayload((p) => { p.coefficients[0] = 0.4; p.coefficients[9] = 2; });
  await writeModelArtifact(directory, second);
  // One policy service for identity and planning, so contexts follow the activated version.
  const v2At = '2026-11-05T10:00:00.000Z';
  const f = await fixture(saved(), (source) => {
    source.assumptions.push(row(REFERENCE, reference(FIXTURE_ID), source));
    source.assumptions.find((a) => a.key === 'forecast.learned.v1').value.waitExclusionThreshold = 0.95;
    const v2 = structuredClone(source); v2.policyVersion = 'gcsp-policy-v2'; v2.effectiveFrom = v2At;
    for (const table of Object.keys(v2).filter((key) => Array.isArray(v2[key]))) for (const r of v2[table]) r.policyVersion = v2.policyVersion;
    v2.assumptions.find((a) => a.key === REFERENCE).value = reference(second.artifactId);
    return { async loadVersions() { return [source, v2]; } };
  });
  const policy = f.policy; const first = await readOf(f);
  assert.ok(Date.parse(first.asOf) < Date.parse(v2At), first.asOf);
  const adapter = learned(f, policy, directory);

  const before = await adapter.readForecast(f.context, first);
  assert.equal(before.status, 'ok', JSON.stringify(before));
  const earlier = await plannerFor(f, policy, adapter).readPlan(f.context);
  assert.equal(earlier.status, 'feasible', JSON.stringify(earlier).slice(0, 300));
  assert.equal(before.value.provenance.model.artifactId, FIXTURE_ID);
  assert.equal(before.value.provenance.model.activationPolicyVersion, earlier.versions.policy);
  const retained = structuredClone({ before, earlier });

  // The app's own path: a dated successor takes effect, the run is activated, and the context follows it.
  const session = f.presenter.value.context;
  const time = (await f.clock.now(session)).value;
  assert.equal((await f.clock.advance(session, { commandId: 'step-past-v2', expectedClockVersion: time.clockVersion, bySeconds: 7200 })).status, 'ok');
  const activated = await activateRunPolicy({ repository: f.repository, policy }, f.context);
  assert.equal(activated.status, 'ok', JSON.stringify(activated)); assert.equal(activated.value.policyVersion, 'gcsp-policy-v2');
  const switched = await f.identity.switchPrincipal(session, 'demo-greg', 'greg-after-activation');
  assert.equal(switched.status, 'ok', JSON.stringify(switched));
  const next = switched.value.context; assert.equal(next.policyVersion, 'gcsp-policy-v2');
  const later = await readOf(f, next);
  const after = await adapter.readForecast(next, later);
  assert.equal(after.status, 'ok', JSON.stringify(after));
  const plan = await plannerFor(f, policy, adapter).readPlan(next);
  assert.equal(plan.status, 'feasible', JSON.stringify(plan).slice(0, 300));
  assert.equal(after.value.provenance.model.artifactId, second.artifactId);
  assert.equal(after.value.demandForecast.model.artifactId, second.artifactId);
  assert.equal(after.value.provenance.model.activationPolicyVersion, plan.versions.policy);
  assert.equal(plan.versions.policy, 'gcsp-policy-v2'); assert.equal(plan.versions.forecast, after.value.version);
  assert.notEqual(after.value.version, before.value.version); assert.notEqual(plan.planId, earlier.planId);
  assert.notEqual(after.value.demandForecast.employees[0].waitProbability, before.value.demandForecast.employees[0].waitProbability);

  // The earlier version, read by its pin, still resolves the first artifact and its numbers; the earlier result is unchanged.
  const pinned = await adapter.readForecast(f.context, await readOf(f));
  assert.equal(pinned.status, 'ok', JSON.stringify(pinned));
  assert.equal(pinned.value.provenance.model.artifactId, FIXTURE_ID);
  assert.deepEqual(pinned.value.demandForecast.employees, before.value.demandForecast.employees);
  assert.equal((await plannerFor(f, policy, adapter).readPlan(f.context)).versions.policy, 'gcsp-policy-v1');
  assert.deepEqual({ before, earlier }, retained);
  assert.equal(retained.earlier.versions.forecast, before.value.version);
});

test('each fallback case names its reason and limitation, and nothing is substituted', async (t) => {
  const directory = await ownedDirectory(t);
  await writeModelArtifact(directory, FIXTURE);
  const hex = (c) => `sha256:${c.repeat(64)}`;
  const text = await readFile(`${ARTIFACTS}${FIXTURE_ID.slice(7)}.json`, 'utf8');
  const corrupt = await ownedDirectory(t);
  await writeFile(join(corrupt, `${FIXTURE_ID.slice(7)}.json`), text.replace('1.3813689792790895', '1.381368979279'));
  await writeFile(join(corrupt, `${'b'.repeat(64)}.json`), '{ not json');
  const heldOut = variantPayload((p) => { p.trainingSettings.split.heldOutCohorts = ['G8-10', 'G7']; });
  const noEstate = variantPayload((p) => { p.evaluation.models.learned.byVehicleClass.find((r) => r.key === 'estate').count = 0; });
  await writeModelArtifact(directory, heldOut); await writeModelArtifact(directory, noEstate);
  const cases = [
    ['no reference in the unmodified seed', variant(), directory, 'no-active-model'],
    ['the bundled unavailable reference', variant((a, s) => s.assumptions.push(row(REFERENCE, reference('unavailable', 'unavailable'), s))), directory, 'no-active-model'],
    ['artifact file missing', variant(withModel(hex('a'))), directory, 'artifact-missing'],
    ['artifact digest mismatch', variant(withModel(FIXTURE_ID)), corrupt, 'artifact-invalid'],
    ['artifact not JSON', variant(withModel(hex('b'))), corrupt, 'artifact-invalid'],
    ['featureVersion mismatch', variant(withModel(FIXTURE_ID, 'vehicle-only-v1')), directory, 'artifact-invalid'],
    ['cohort outside coverage', variant(withModel(heldOut.artifactId)), directory, 'outside-coverage'],
    ['vehicle class outside coverage', variant(withModel(noEstate.artifactId)), directory, 'outside-coverage'],
    ['forecast key missing', variant((a, s) => { withModel(FIXTURE_ID)(a, s); s.assumptions = s.assumptions.filter((r) => r.key !== 'forecast.learned.v1'); }), directory, 'forecast-policy-unavailable'],
    ['forecast key malformed', active(settings({ waitExclusionThreshold: 'half' })), directory, 'forecast-policy-unavailable'],
    ['forecast key out of range', active(settings({ choiceMassThreshold: 0 })), directory, 'forecast-policy-unavailable'],
  ];
  const f = await fixture(); const read = await readOf(f);
  const baseline = await baselineFor(f, variant()).readPlan(f.context);
  for (const [name, policy, artifactDirectory, reason] of cases) {
    const out = await learned(f, policy, artifactDirectory).readForecast(f.context, read);
    assert.deepEqual([out.status, out.code], ['unavailable', 'learned-forecast-fallback'], name);
    assert.deepEqual([out.fallback.status, out.fallback.reason, out.fallback.basis], ['fallback', reason, 'deterministic-baseline'], name);
    assert.ok(typeof out.fallback.limitation === 'string' && out.fallback.limitation.length > 0 && !out.fallback.limitation.includes('—'), name);
    for (const key of ['employees', 'aggregate', 'evaluation', 'value']) assert.equal(Object.hasOwn(out.fallback, key) || Object.hasOwn(out, key), false, `${name}: ${key}`);
    const plan = await plannerFor(f, policy, learned(f, policy, artifactDirectory)).readPlan(f.context);
    assert.deepEqual([plan.status, plan.code], ['unavailable', 'learned-forecast-fallback'], name);
  }
  assert.equal(baseline.status, 'feasible');
  const coverage = await learned(f, variant(withModel(heldOut.artifactId)), directory).readForecast(f.context, read);
  assert.deepEqual(coverage.fallback.coverage, { cohorts: ['G7'], vehicleClasses: [] });
  const classes = await learned(f, variant(withModel(noEstate.artifactId)), directory).readForecast(f.context, read);
  assert.deepEqual(classes.fallback.coverage, { cohorts: [], vehicleClasses: ['estate'] });
  assert.equal(JSON.stringify(coverage).includes(f.employee.employeeId), false);

  // Any one uncovered employee or class falls the whole cohort back; none is dropped or substituted.
  const { input } = await inputFor(f, active(), read);
  const wide = widened(input); wide.cohort.entitlements[1].cohortKey = 'G8-10'; wide.cohort.entitlements[2].permittedChoices[0].vehicleClass = 'unknown';
  const mixed = await providerFor(active()).forecast(f.context, wide, { runId: read.runId, asOf: read.asOf });
  assert.deepEqual([mixed.status, mixed.reason, mixed.coverage], ['fallback', 'outside-coverage', { cohorts: ['G8-10'], vehicleClasses: ['unknown'] }]);
  assert.deepEqual((await providerFor(active()).forecast(f.context, { ...input, cohort: { version: 'x' } }, undefined)), { status: 'invalid', code: 'prediction-input-invalid', contractVersion: '1.0.0' });
});

test('the learned plan runs alongside a baseline plan that is unchanged and still the only one built from expressed demand', async () => {
  const f = await fixture(); const policy = active(settings({ waitExclusionThreshold: 0.9 }));
  const before = await baselineFor(f, policy).readPlan(f.context);
  assert.equal(before.status, 'feasible', JSON.stringify(before).slice(0, 300));
  const adapter = learned(f, policy); const read = await readOf(f);
  const forecast = await adapter.readForecast(f.context, read);
  assert.equal(forecast.status, 'ok', JSON.stringify(forecast));
  assert.equal(forecast.value.forecast.basis, 'synthetic-trained-model');
  assert.deepEqual(forecast.value.forecast.entitlements.map((e) => e.acceptableDerivativeIds), [[TOURING]]);
  assert.equal(forecast.value.demandForecast.status, 'ok'); assert.equal(forecast.value.provenance.model.artifactId, FIXTURE_ID);
  const plan = await plannerFor(f, policy, adapter).readPlan(f.context);
  assert.equal(plan.status, 'feasible', JSON.stringify(plan).slice(0, 400));
  assert.equal(plan.versions.forecast, forecast.value.version);
  assert.equal(plan.orderQuantity, 1); assert.deepEqual(plan.allocations.map((a) => [a.derivativeId, a.source]), [[TOURING, 'new-order']]);
  const after = await baselineFor(f, policy).readPlan(f.context);
  assert.deepEqual(after, before);
  assert.notEqual(plan.versions.forecast, before.versions.forecast); assert.notEqual(plan.planId, before.planId);
  assert.deepEqual(await plannerFor(f, policy, adapter).readPlan(f.context), plan);
});

test('editing one forecast key changes the learned forecast and plan with no code edit', async () => {
  const f = await fixture();
  const run = async (policy) => {
    const adapter = learned(f, policy); const forecast = await adapter.readForecast(f.context, await readOf(f));
    return { forecast, plan: await plannerFor(f, policy, adapter).readPlan(f.context) };
  };
  const base = await run(active());
  // The shipped threshold leaves out an employee the fixture model expects to wait (p(wait) is about 0.7).
  assert.equal(base.forecast.status, 'ok'); assert.deepEqual(base.forecast.value.forecast.entitlements, []);
  assert.deepEqual(base.forecast.value.provenance.excluded.filter((e) => e.reason === 'model-expects-wait').map((e) => e.employeeId), [f.employee.employeeId]);
  assert.equal(base.forecast.value.provenance.modelExpectsWait, 1);
  assert.equal(base.plan.status, 'feasible'); assert.equal(base.plan.orderQuantity, 0);
  const raised = await run(active(settings({ waitExclusionThreshold: 0.9 })));
  assert.equal(raised.forecast.value.forecast.entitlements.length, 1); assert.equal(raised.plan.orderQuantity, 1);
  assert.notEqual(raised.forecast.value.version, base.forecast.value.version); assert.notEqual(raised.plan.planId, base.plan.planId);
  assert.equal(raised.forecast.value.demandForecast.settings.waitExclusionThreshold, 0.9);
  assert.equal(raised.forecast.value.provenance.modelExpectsWait, 0);
});

test('the choice-mass threshold keeps the smallest set of likeliest permitted choices', async () => {
  // Seats and boot: several covered (estate, saloon) derivatives pass, the hatch (380 L) does not, so the threshold has something to cut.
  const brief = { ...saved(), preferences: { body: preference('estate'), fuel: preference('petrol') },
    essentials: { seats: essential(5), boot: essential(400, 'gte', 'L') } };
  const f = await fixture(brief);
  const run = async (patch) => {
    const out = await learned(f, active(settings({ waitExclusionThreshold: 1, ...patch }))).readForecast(f.context, await readOf(f));
    assert.equal(out.status, 'ok', JSON.stringify(out)); return out.value;
  };
  const wide = await run({ choiceMassThreshold: 1 });
  const permitted = wide.forecast.entitlements[0].acceptableDerivativeIds;
  assert.ok(permitted.length > 1, JSON.stringify(permitted));
  assert.equal(permitted.includes('f70-hatch-120'), false, JSON.stringify(permitted));
  const probabilities = wide.demandForecast.employees[0].choices;
  const likeliest = [...probabilities].sort((a, b) => b.probability - a.probability || (a.derivativeId < b.derivativeId ? -1 : 1))[0].derivativeId;
  const narrow = await run({ choiceMassThreshold: 0.01 });
  assert.deepEqual(narrow.forecast.entitlements[0].acceptableDerivativeIds, [likeliest]);
  assert.notEqual(narrow.version, wide.version);
  assert.ok(narrow.forecast.entitlements[0].acceptableDerivativeIds.every((id) => permitted.includes(id)));
});

test('FUCQ-312 coverage regression: a brief that permits the orderable hatch falls back, since the artifact never saw hatchbacks', async () => {
  const f = await fixture({ ...saved(), preferences: { body: preference('hatchback'), fuel: preference('petrol') }, essentials: { seats: essential(5) } });
  const out = await learned(f, active(settings({ waitExclusionThreshold: 1 }))).readForecast(f.context, await readOf(f));
  assert.equal(out.status, 'unavailable', JSON.stringify(out)); assert.equal(out.code, 'learned-forecast-fallback');
  assert.equal(out.fallback.reason, 'outside-coverage'); assert.deepEqual(out.fallback.coverage.vehicleClasses, ['hatchback']);
});

// FUCQ-123 slice 2: Greg's plan operations carry the learned plan beside the baseline one.
const LABEL = 'Synthetic-trained model';
const SHORT = 'The learned forecast is unavailable right now, so only the baseline plan is shown.';
const good = (out) => { assert.equal(out.status, 'ok', JSON.stringify(out).slice(0, 400)); return out.value; };
const setPolicy = (...edits) => (source) => { for (const edit of edits) edit(source); return { async loadVersions() { return [source]; } }; };
const useModel = (source) => withModel(FIXTURE_ID)({}, source);
const keepEmployee = (source) => settings({ waitExclusionThreshold: 0.9 })(Object.fromEntries(source.assumptions.map((a) => [a.key, a])));
function submitStub() {
  const calls = [];
  return { calls, async submit(_context, line) { calls.push(line); return { status: 'ok', value: { request: { requestId: `request-${calls.length}`, commandId: line.commandId } } }; } };
}
function opsFor(f, extra = {}) {
  return planning.createOrderPlanOperations({ repository: f.repository, policy: f.policy, identity: f.identity, clock: f.clock,
    supply: supplyPort(f, f.policy), artifactDirectory: ARTIFACTS, ...extra });
}
const opsFixture = async (...edits) => { const f = await fixture(saved(), setPolicy(...edits)); f.requests = submitStub(); f.ops = opsFor(f, { requests: f.requests }); return f; };
const touring = (min) => ({ key: 'orderPlan.derivativeBounds', value: seed.assumptions.find((a) => a.key === 'orderPlan.derivativeBounds').value
  .map((b) => (b.derivativeId === TOURING ? { ...b, min } : b)) });
const submissions = async (f) => good(await f.repository.query(f.context, 'plan_snapshots')).filter((r) => r.provenance?.kind === 'submission');

const learned_ = async (f) => learned(f, f.policy).readForecast(f.context, await readOf(f));
// Every number in `differences` is read back from the two plans it compares.
function assertDifferences(differences, baseline, learnedPlan) {
  assert.equal(differences.comparable, true);
  const pairs = { coverage: (p) => p.expectedAcceptableCoverage.covered, orderQuantity: (p) => p.orderQuantity, spendMinor: (p) => p.spendMinor,
    unmetNeeds: (p) => p.unmetNeeds.length };
  for (const [name, read] of Object.entries(pairs)) {
    assert.deepEqual(differences[name], { baseline: read(baseline), learned: read(learnedPlan), delta: read(learnedPlan) - read(baseline) }, name);
  }
  assert.deepEqual(differences.derivatives.map((d) => d.derivativeId), baseline.quantities.map((q) => q.derivativeId));
  // FUCQ-312: the seed lists the hatch last, but the order follows derivativeId like the plans.
  assert.deepEqual(differences.derivatives.map((d) => d.derivativeId), differences.derivatives.map((d) => d.derivativeId).sort());
  differences.derivatives.forEach((d, i) => {
    const [b, l] = [baseline.quantities[i].quantity, learnedPlan.quantities.find((q) => q.derivativeId === d.derivativeId).quantity];
    assert.deepEqual(d, { derivativeId: d.derivativeId, baseline: b, learned: l, delta: l - b, changed: l !== b });
  });
}

test('without an active model the plan operations keep the baseline and add a learned fallback, on read and preview', async () => {
  const f = await fixture(); const ops = opsFor(f);
  const baseline = await baselineFor(f, f.policy).readPlan(f.context);
  const read = good(await ops.readPlan(f.context));
  assert.deepEqual(read.plan, baseline); assert.equal(read.presentation.forecastBasis, 'expressed-saved-demand');
  assert.deepEqual(Object.keys(read).sort(), ['learned', 'mode', 'plan', 'presentation', 'preview', 'replan']);
  assert.deepEqual(Object.keys(read.learned).sort(), ['label', 'limitation', 'reason', 'recommended', 'status', 'submittable']);
  assert.deepEqual([read.learned.status, read.learned.label, read.learned.reason, read.learned.recommended, read.learned.submittable],
    ['fallback', LABEL, 'no-active-model', false, false]);
  assert.match(read.learned.limitation, /No learned model is active/);
  const preview = good(await ops.previewPlan(f.context, { changes: [touring(2)] }));
  assert.deepEqual(preview.activePlan, baseline); assert.equal(preview.presentation.forecastBasis, 'expressed-saved-demand');
  assert.deepEqual([preview.learned.status, preview.learned.reason, preview.learned.recommended, preview.learned.submittable], ['fallback', 'no-active-model', false, false]);
  assert.equal(Object.hasOwn(preview.learned, 'plan'), false);
});

test('an active model adds a labelled learned plan and numbers read straight from the two plans', async () => {
  const f = await opsFixture(useModel, keepEmployee);
  const baseline = await baselineFor(f, f.policy).readPlan(f.context);
  const out = good(await f.ops.readPlan(f.context)); const { learned } = out;
  assert.deepEqual(out.plan, baseline); assert.equal(out.presentation.forecastBasis, 'expressed-saved-demand');
  assert.deepEqual([learned.status, learned.label, learned.recommended, learned.submittable], ['available', LABEL, false, false]);
  assert.deepEqual(Object.keys(learned).sort(), ['differences', 'forecast', 'label', 'plan', 'recommended', 'status', 'submittable']);
  assert.equal(learned.plan.status, 'feasible'); assert.equal(learned.plan.versions.forecast, learned.forecast.version);
  assert.notEqual(learned.plan.planId, out.plan.planId);
  assert.deepEqual(Object.keys(learned.forecast).sort(), ['aggregate', 'data', 'evaluation', 'limitations', 'model', 'modelExpectsWait', 'settings', 'version']);
  assert.equal(learned.forecast.model.artifactId, FIXTURE_ID); assert.equal(learned.forecast.settings.waitExclusionThreshold, 0.9);
  assert.equal(learned.forecast.modelExpectsWait, 0); assert.ok(learned.forecast.evaluation.partitionCounts && learned.forecast.evaluation.overall);
  assert.ok(learned.forecast.aggregate.length > 0 && learned.forecast.limitations.length > 0);
  const direct = await learned_(f);
  assert.equal(direct.value.version, learned.forecast.version); assert.equal(direct.value.forecast.basis, 'synthetic-trained-model');
  assert.deepEqual(direct.value.demandForecast.aggregate, learned.forecast.aggregate);
  assertDifferences(learned.differences, out.plan, learned.plan);
  assert.equal(JSON.stringify(learned).includes('—'), false);
  assert.deepEqual(good(await f.ops.readPlan(f.context)), out);
});

test('a learned failure, or an infeasible plan on either side, never changes the baseline response', async () => {
  const f = await opsFixture(useModel, keepEmployee);
  const normal = good(await f.ops.readPlan(f.context));
  for (const artifactDirectory of [42, '/private/nonexistent-gcsp-artifacts/']) {
    const out = good(await opsFor(f, { artifactDirectory }).readPlan(f.context));
    const { learned: shown, ...rest } = out; const { learned: _, ...expected } = normal;
    assert.deepEqual(rest, expected);
    assert.equal(shown.status, typeof artifactDirectory === 'number' ? 'unavailable' : 'fallback', JSON.stringify(shown));
    if (shown.status === 'unavailable') assert.deepEqual([shown.reason, shown.limitation, shown.recommended, shown.submittable, shown.label],
      ['learned-forecast-not-configured', SHORT, false, false, LABEL]);
    else assert.equal(shown.reason, 'artifact-missing');
  }
  // A budget no order fits makes the baseline infeasible: both sides report it and compare nothing.
  const tight = [{ key: 'orderPlan.budgetMinor', value: 5000000 }, { key: 'orderPlan.modelBounds',
    value: seed.assumptions.find((a) => a.key === 'orderPlan.modelBounds').value.map((b) => (b.modelId === 'g61-i5' ? { ...b, min: 1 } : b)) }];
  const preview = good(await f.ops.previewPlan(f.context, { changes: tight }));
  assert.equal(preview.plan.status, 'infeasible'); assert.equal(preview.learned.status, 'available');
  const { differences } = preview.learned;
  assert.equal(differences.comparable, false);
  for (const name of ['coverage', 'orderQuantity', 'spendMinor', 'unmetNeeds']) assert.deepEqual(differences[name], { baseline: null, learned: null, delta: null }, name);
  assert.deepEqual(differences.derivatives.map((d) => d.derivativeId), normal.plan.quantities.map((q) => q.derivativeId));
  assert.ok(differences.derivatives.every((d) => d.baseline === null && d.learned === null && d.delta === null && d.changed === false));
});

test('the learned plan is never a submit target: only the baseline plan submits', async () => {
  const f = await opsFixture(useModel, keepEmployee);
  const { plan, learned } = good(await f.ops.readPlan(f.context));
  const input = (p, commandId) => ({ commandId, planId: p.planId, versions: p.versions });
  const refused = await f.ops.submitPlan(f.context, input(learned.plan, 'learned-1'));
  assert.deepEqual([refused.status, refused.code], ['conflict', 'replan-needed']);
  assert.ok(refused.changedInputs.includes('forecast') && refused.changedInputs.includes('plan'), JSON.stringify(refused.changedInputs));
  assert.equal(refused.current.planId, plan.planId);
  assert.equal(f.requests.calls.length, 0); assert.deepEqual(await submissions(f), []);
  const sent = good(await f.ops.submitPlan(f.context, input(plan, 'baseline-1')));
  assert.equal(sent.planId, plan.planId); assert.equal(f.requests.calls.length, 1);
  assert.equal(f.requests.calls[0].plan.planId, plan.planId); assert.equal(f.requests.calls[0].plan.versions.model, 'expressed-saved-demand');
  assert.equal((await submissions(f)).length, 1);
});

test('editing only forecast.learned.v1 moves the learned plan and differences while the baseline stays put', async () => {
  const f = await fixture(); const run = async (policy) => good(await opsFor(f, { policy }).readPlan(f.context));
  const [a, b] = [await run(active(settings({ waitExclusionThreshold: 0.9 }))), await run(active())];
  assert.deepEqual(a.plan, b.plan); assert.deepEqual(a.presentation, b.presentation);
  assert.deepEqual([a.learned.status, b.learned.status], ['available', 'available']);
  assert.deepEqual([a.learned.forecast.modelExpectsWait, b.learned.forecast.modelExpectsWait], [0, 1]);
  assert.deepEqual([a.learned.plan.orderQuantity, b.learned.plan.orderQuantity], [1, 0]);
  assert.notEqual(a.learned.plan.planId, b.learned.plan.planId); assert.notEqual(a.learned.forecast.version, b.learned.forecast.version);
  assert.notDeepEqual(a.learned.differences, b.learned.differences);
  assertDifferences(a.learned.differences, a.plan, a.learned.plan); assertDifferences(b.learned.differences, b.plan, b.learned.plan);
  assert.equal(b.learned.differences.orderQuantity.delta, -a.plan.orderQuantity);
});

test('activating another artifact version changes the learned model and plan; the earlier read keeps its own', async (t) => {
  const directory = await ownedDirectory(t);
  await writeModelArtifact(directory, FIXTURE);
  const second = variantPayload((p) => { p.coefficients[0] = 0.4; p.coefficients[9] = 2; });
  await writeModelArtifact(directory, second);
  const v2At = '2026-11-05T10:00:00.000Z';
  const f = await fixture(saved(), (source) => {
    source.assumptions.push(row(REFERENCE, reference(FIXTURE_ID), source));
    source.assumptions.find((a) => a.key === 'forecast.learned.v1').value.waitExclusionThreshold = 0.95;
    const v2 = structuredClone(source); v2.policyVersion = 'gcsp-policy-v2'; v2.effectiveFrom = v2At;
    for (const table of Object.keys(v2).filter((key) => Array.isArray(v2[key]))) for (const r of v2[table]) r.policyVersion = v2.policyVersion;
    v2.assumptions.find((a) => a.key === REFERENCE).value = reference(second.artifactId);
    return { async loadVersions() { return [source, v2]; } };
  });
  const ops = opsFor(f, { artifactDirectory: directory });
  const before = good(await ops.readPlan(f.context)); const retained = structuredClone(before);
  assert.equal(before.learned.forecast.model.artifactId, FIXTURE_ID);
  const session = f.presenter.value.context; const time = (await f.clock.now(session)).value;
  assert.equal((await f.clock.advance(session, { commandId: 'step-past-v2', expectedClockVersion: time.clockVersion, bySeconds: 7200 })).status, 'ok');
  assert.equal((await activateRunPolicy({ repository: f.repository, policy: f.policy }, f.context)).status, 'ok');
  const next = good(await f.identity.switchPrincipal(session, 'demo-greg', 'greg-after-activation')).context;
  const after = good(await ops.readPlan(next));
  assert.equal(after.learned.status, 'available', JSON.stringify(after.learned).slice(0, 300));
  assert.equal(after.learned.forecast.model.artifactId, second.artifactId);
  assert.equal(after.learned.plan.versions.policy, 'gcsp-policy-v2'); assert.equal(after.learned.forecast.model.activationPolicyVersion, 'gcsp-policy-v2');
  assert.notEqual(after.learned.plan.planId, before.learned.plan.planId); assert.notEqual(after.learned.forecast.version, before.learned.forecast.version);
  assertDifferences(after.learned.differences, after.plan, after.learned.plan);
  assertDifferences(before.learned.differences, before.plan, before.learned.plan);
  assert.deepEqual(before, retained);
});

test('a preview carries a learned plan under the draft policy and compares it with the preview plan', async () => {
  const f = await opsFixture(useModel, keepEmployee);
  const preview = good(await f.ops.previewPlan(f.context, { changes: [touring(2)] }));
  const { learned } = preview;
  assert.equal(learned.status, 'available', JSON.stringify(learned).slice(0, 300));
  assert.match(preview.draftPolicyVersion, /^preview-/);
  assert.equal(preview.plan.versions.policy, preview.draftPolicyVersion); assert.equal(learned.plan.versions.policy, preview.draftPolicyVersion);
  assert.equal(learned.forecast.model.activationPolicyVersion, preview.draftPolicyVersion);
  assert.equal(learned.forecast.model.artifactId, FIXTURE_ID);
  assert.equal(preview.plan.quantities.find((q) => q.derivativeId === TOURING).quantity, 2);
  assert.equal(learned.plan.quantities.find((q) => q.derivativeId === TOURING).quantity, 2);
  assertDifferences(learned.differences, preview.plan, learned.plan);
  assert.equal(preview.presentation.forecastBasis, 'expressed-saved-demand');
  assert.equal(preview.writes, 'none'); assert.deepEqual([learned.recommended, learned.submittable], [false, false]);
  assert.deepEqual(await submissions(f), []);
});
