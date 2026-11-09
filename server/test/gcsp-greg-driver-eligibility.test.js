// Default canonical preparation and deliberately synthetic cohort inputs; no listener.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { inputDigest, ok } from '../gcsp/repository/index.js';
import { projectRecommendationFacts } from '../gcsp/manual-context/recommendation-facts.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { createGregDemandService } from '../gcsp/greg/index.js';
import { createGregPublishService } from '../gcsp/greg/publish/index.js';
import { evaluateFit } from '../gcsp/greg/publish/fit.js';
import { stock, fact, essential, preference } from './helpers/employee-recommendation.js';

const good = (value) => { assert.equal(value.status, 'ok', JSON.stringify(value)); return value.value; };
const ref = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const projection = (brief) => ({ schemaVersion: brief.schemaVersion, briefVersion: brief.briefVersion,
  preferences: brief.preferences, essentials: brief.essentials });
const saved = () => ({ schemaVersion: 1, preferences: { body: preference('estate'), fuel: preference('diesel') },
  essentials: { seats: essential(5) } });
async function setup(t, { release = true } = {}) {
  const runtime = good(await createGcspRuntime({ mode: 'memory', environmentId: 'greg-driver-test',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z', adoptOfferJourney: true }));
  t.after(() => runtime.close());
  const employee = good(await runtime.createLocalSession()).context;
  const presenter = good(await runtime.identity.createPresenterSession('driver-presenter')).context;
  const greg = good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', 'driver-greg')).context;
  const clock = good(await runtime.clock.now(presenter));
  good(await runtime.clock.advance(presenter, { commandId: 'driver-noon', expectedClockVersion: clock.clockVersion,
    to: '2026-11-05T12:00:00.000Z' }));
  const time = good(await runtime.clock.now(greg));
  let sequence = 0;
  const write = async (work) => good(await runtime.repository.transaction(greg,
    { commandId: `driver-fixture:${++sequence}`, inputDigest: inputDigest(sequence) }, work));
  good(await runtime.brief.saveDraft(employee, { commandId: 'driver-draft', expectedBriefVersion: 0,
    expectedDraftVersion: 0, brief: saved() }));
  const brief = good(await runtime.brief.confirm(employee, { commandId: 'driver-confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } })).brief;
  if (release) {
    const car = stock(601, { modelLine: fact('G21 Touring') });
    await write((tx) => tx.insert('stock', { runId: employee.runId, orderUuid: car.orderUuid, orderNumber: '9130601',
      configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
      facts: car.snapshot, release: { availability: car.availability },
      visibility: { companyIds: [employee.companyId], schemeIds: [employee.schemeId], employeeIds: null } }));
  }
  const rows = async () => Object.fromEntries(await Promise.all(
    ['employees', 'entitlement_slots', 'briefs', 'stock', 'offers', 'decisions', 'holds', 'quotes']
      .map(async (table) => [table, good(await runtime.repository.query(greg, table))])));
  const patchEmployee = async (change) => write(async (tx) => {
    const row = good(await tx.get(ref(employee, 'employees', { employeeId: employee.employeeId })));
    const contract = structuredClone(row.contract); change(contract.manualContext);
    return tx.compareAndSwap(ref(employee, 'employees', { employeeId: employee.employeeId }), row.version, { contract });
  });
  return { ...runtime, employee, gregContext: greg, presenter, time, briefValue: brief, write, rows, patchEmployee };
}
async function subject(f) {
  const rows = await f.rows();
  return { context: f.employee, employee: rows.employees.find((row) => row.employeeId === f.employee.employeeId),
    brief: rows.briefs.find((row) => row.employeeId === f.employee.employeeId), slots: rows.entitlement_slots, now: f.time.now };
}
async function previewInput(f) {
  const controls = good(await f.gregPublish.readPolicy(f.gregContext));
  const weight = controls.fields.find((field) => field.kind === 'weight'); assert.ok(weight);
  return { expectedActiveVersion: controls.activeVersion, changes: [{ id: weight.id, value: weight.value + 1 }] };
}
const noPrivateFields = (value) => {
  const text = JSON.stringify(value);
  for (const key of ['employeeId', 'principalId', 'driverId', 'driverEligible', 'licence', 'Paula', 'PRIVATE-', 'tripHistory', 'usageHistory']) {
    assert.equal(text.includes(key), false, key);
  }
};

test('default manual preparation supplies the same actual driver fact to employee and Greg without a persisted flattened field', async (t) => {
  const f = await setup(t); const source = await subject(f); const before = structuredClone(source);
  assert.equal(Object.hasOwn(source.employee.contract.manualContext.employeeFacts, 'driverEligible'), false);
  const driverId = source.employee.contract.manualContext.contracts.find((row) => row.contractId === source.slots
    .find((row) => row.entitlementSlotId === f.employee.entitlementSlotId).contractId).driverId;
  const driver = source.employee.contract.manualContext.drivers.find((row) => row.driverId === driverId);
  const projected = good(projectRecommendationFacts(source));
  assert.deepEqual(projected.employeeFacts.driverEligible, driver.eligible);
  const employeeSource = good(await f.provider.resolve(f.employee));
  assert.deepEqual(projected.employeeFacts.driverEligible, employeeSource.employeeFacts.driverEligible);
  const evaluator = createEmployeeRecommendationService({ policy: f.policy, time: f.clock, provider: f.provider });
  const evaluated = good(await evaluator.recommend(f.employee, projection(f.briefValue)));
  assert.equal(evaluated.decisions[0].gateStatus, 'eligible');
  const demand = good(await f.greg.readDemand(f.gregContext));
  assert.deepEqual(demand.demand.unmet.byGate, []); noPrivateFields(demand);
  const preview = good(await f.gregPublish.preview(f.gregContext, await previewInput(f)));
  assert.equal(preview.active.fit.meanBestScore.status, 'suppressed');
  assert.equal(preview.draft.fit.meanBestScore.status, 'suppressed');
  noPrivateFields(preview.active); noPrivateFields(preview.draft);
  assert.deepEqual(source, before);
  const after = await subject(f); assert.deepEqual(after.employee, source.employee);
});

test('bound false, absent, unknown, nonboolean and uncertain provenance retain their shared recommendation refusal', async (t) => {
  const f = await setup(t);
  const variants = [
    ['false', fact(false), 'driver-ineligible'], ['unknown', fact(null), 'driver-unconfirmed'],
    ['absent', undefined, 'driver-unconfirmed'], ['nonboolean', fact('yes'), 'driver-unconfirmed'],
    ['untrusted', fact(true, null, 'unverified'), 'driver-unconfirmed'],
    ['bad-date', { ...fact(true), provenance: { ...fact(true).provenance, observedAt: 'invalid' } }, 'driver-unconfirmed'],
  ];
  for (const [name, value, gate] of variants) {
    await f.patchEmployee((manual) => {
      const driver = manual.drivers.find((row) => row.kind === 'employee');
      if (value === undefined) delete driver.eligible; else driver.eligible = value;
      manual.employeeFacts.driverEligible = fact(true); // A stale conflicting flattened value has no binding authority.
    });
    const source = await subject(f); const projected = good(projectRecommendationFacts(source));
    assert.deepEqual(projected.employeeFacts.driverEligible, value, name);
    const demand = good(await f.greg.readDemand(f.gregContext));
    assert.ok(demand.demand.unmet.byGate.some((row) => row.key === gate), name);
    const fit = good(await evaluateFit({ rows: await f.rows(), context: f.gregContext, policy: f.policy,
      time: { status: 'ok', value: f.time }, threshold: 1 })); // Explicit pure-projection threshold; the policy is untouched.
    assert.equal(fit.scoredBriefs.kind, 'band', name); assert.equal(fit.meanBestScore.status, 'suppressed', name);
  }
});

test('explicit current driver binding selects the owned nominated driver and never chooses an eligible fallback', async (t) => {
  const f = await setup(t); const source = await subject(f); const manual = source.employee.contract.manualContext;
  const nominated = manual.drivers.find((row) => row.kind === 'nominated'); nominated.eligible = fact(false);
  manual.contracts.find((row) => row.status === 'current').driverId = nominated.driverId;
  manual.employeeFacts.driverEligible = fact(true);
  assert.deepEqual(good(projectRecommendationFacts(source)).employeeFacts.driverEligible, nominated.eligible);
  manual.contracts[0].driverId = 'missing-driver';
  assert.equal(projectRecommendationFacts(source).status, 'unavailable');
});

test('absent driver choice stays unconfirmed only when no explicit contract reference requires it', async (t) => {
  const f = await setup(t); const source = await subject(f);
  const slot = source.slots.find((row) => row.entitlementSlotId === f.employee.entitlementSlotId); delete slot.contractId;
  const manual = source.employee.contract.manualContext; manual.employeeFacts.driverEligible = fact(true);
  const employeeDriver = manual.drivers.find((row) => row.kind === 'employee');
  assert.deepEqual(good(projectRecommendationFacts(source)).employeeFacts.driverEligible, employeeDriver.eligible);
  manual.drivers.push({ ...structuredClone(employeeDriver), driverId: 'other-owned-driver' });
  assert.equal(Object.hasOwn(good(projectRecommendationFacts(source)).employeeFacts, 'driverEligible'), false);
  manual.drivers = manual.drivers.filter((row) => row.kind !== 'employee');
  assert.equal(Object.hasOwn(good(projectRecommendationFacts(source)).employeeFacts, 'driverEligible'), false);
});

test('foreign, duplicate, dangling and malformed source bindings return only generic unavailable', async (t) => {
  const f = await setup(t); const original = await subject(f);
  const cases = [
    (s) => { s.brief.employeeId = 'foreign'; }, (s) => { s.brief.runId = 'foreign'; },
    (s) => { s.brief.entitlementSlotId = 'foreign'; }, (s) => { s.employee.schemeId = 'foreign'; },
    (s) => { s.slots = []; },
    (s) => { s.slots.push(structuredClone(s.slots.find((row) => row.entitlementSlotId === f.employee.entitlementSlotId))); },
    (s) => { s.slots.find((row) => row.entitlementSlotId === f.employee.entitlementSlotId).employeeId = 'foreign'; },
    (s) => { s.slots.find((row) => row.entitlementSlotId === f.employee.entitlementSlotId).contractId = 'dangling'; },
    (s) => { s.employee.contract.manualContext.contracts[0].slotId = 'foreign'; },
    (s) => { s.employee.contract.manualContext.contracts[0].schemeId = 'foreign'; },
    (s) => { s.employee.contract.manualContext.contracts[0].driverId = 'dangling'; },
    (s) => { s.employee.contract.manualContext.contracts.push(structuredClone(s.employee.contract.manualContext.contracts[0])); },
    (s) => { s.employee.contract.manualContext.drivers.push(structuredClone(s.employee.contract.manualContext.drivers[0])); },
    (s) => { s.employee.contract.manualContext.drivers[0].employeeId = 'foreign'; },
    (s) => { s.employee.contract.manualContext.account.employeeId = 'foreign'; },
    (s) => { s.employee.contract.manualContext.account.gradeId = 'foreign'; },
    (s) => { s.employee.contract.manualContext.source.observedAt = '2027-01-01T00:00:00.000Z'; },
    (s) => { s.employee.contract.manualContext.source.effectiveFrom = 'invalid'; },
    (s) => { s.employee.contract.manualContext.recordSetId = ''; },
    (s) => { delete s.employee.contract.manualContext; },
    (s) => {
      delete s.slots.find((row) => row.entitlementSlotId === f.employee.entitlementSlotId).contractId;
      delete s.employee.contract.manualContext;
    },
    (s) => { delete s.employee.contract.manualContext.account; },
    (s) => { delete s.employee.contract.manualContext.source; },
  ];
  for (const change of cases) {
    const input = structuredClone(original); change(input); const before = structuredClone(input);
    const outcome = projectRecommendationFacts(input);
    assert.equal(outcome.status, 'unavailable', change.toString()); assert.equal(outcome.code, 'source-invalid');
    noPrivateFields(outcome); assert.deepEqual(input, before);
  }
});

test('invalid subject bindings are refused before demand can take the no-stock or hidden-stock shortcut', async (t) => {
  const f = await setup(t, { release: false });
  assert.ok(good(await f.greg.readDemand(f.gregContext)).demand.unmet.byGate.some((row) => row.key === 'no-released-stock'));
  await f.patchEmployee((manual) => { manual.account.employeeId = 'foreign'; });
  assert.equal((await f.greg.readDemand(f.gregContext)).status, 'unavailable');
  assert.equal((await f.gregPublish.preview(f.gregContext, await previewInput(f))).status, 'unavailable');
});

test('coherent synthetic cohort preserves canonical suppression and never persists the derived driver fact', async (t) => {
  const f = await setup(t); const source = await subject(f);
  const threshold = good(await f.policy.getAssumption('greg.demand.smallCountThreshold', {
    runId: f.employee.runId, policyVersion: f.employee.policyVersion, asOf: f.time.now })).value;
  assert.equal(threshold, 5);
  const strip = ({ version, createdAt, updatedAt, ...row }) => row;
  const canonicalSlot = source.slots.find((row) => row.entitlementSlotId === f.employee.entitlementSlotId);
  // These additional stored subjects are explicit fixture inputs, not authenticated employee sessions.
  await f.write(async (tx) => {
    for (let i = 2; i <= threshold; i++) {
      const employeeId = `greg-synthetic-${i}`; const slotId = `slot:${employeeId}`;
      const rewrite = (value) => typeof value === 'string' ? value === f.employee.entitlementSlotId ? slotId
        : value.replaceAll(f.employee.employeeId, employeeId).replaceAll(source.employee.name, `Synthetic subject ${i}`)
        : Array.isArray(value) ? value.map(rewrite) : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)])) : value;
      good(await tx.insert('employees', { ...rewrite(strip(source.employee)), employeeId, principalId: employeeId,
        entitlementSlotId: slotId, name: `Synthetic subject ${i}` }));
      good(await tx.insert('entitlement_slots', { ...rewrite(strip(canonicalSlot)), employeeId, entitlementSlotId: slotId }));
      good(await tx.insert('briefs', { ...rewrite(strip(source.brief)), employeeId, entitlementSlotId: slotId, confirmedBy: employeeId }));
    }
    return ok({ subjects: threshold });
  });
  const before = await f.rows();
  const confirmedOwners = new Set(before.briefs.map((row) => row.employeeId));
  for (const row of before.employees.filter((row) => confirmedOwners.has(row.employeeId))) {
    assert.equal(Object.hasOwn(row.contract.manualContext.employeeFacts, 'driverEligible'), false);
  }
  const preview = good(await f.gregPublish.preview(f.gregContext, await previewInput(f)));
  assert.equal(preview.active.fit.meanBestScore.status, 'available');
  assert.equal(preview.draft.fit.meanBestScore.status, 'available');
  noPrivateFields(preview.active); noPrivateFields(preview.draft);
  assert.deepEqual(await f.rows(), before);
  await f.patchEmployee((manual) => { manual.drivers.find((row) => row.kind === 'employee').eligible = fact(false); });
  const suppressed = good(await f.gregPublish.preview(f.gregContext, await previewInput(f)));
  assert.equal(suppressed.active.fit.meanBestScore.status, 'suppressed');
  assert.equal(suppressed.active.fit.meanBestScore.fewerThan, threshold);
});

test('employee and slot revisions participate in both Greg read fences', async (t) => {
  for (const target of ['demand', 'preview']) {
    const f = await setup(t); let reads = 0;
    const repository = { read: f.repository.read.bind(f.repository), async query(context, table, filter) {
      if (table === 'entitlement_slots' && ++reads === 2) await f.write(async (tx) => {
        const key = ref(f.employee, 'entitlement_slots', { entitlementSlotId: f.employee.entitlementSlotId });
        const row = good(await tx.get(key));
        return tx.compareAndSwap(key, row.version, { renewalId: 'changed-during-read' });
      });
      return f.repository.query(context, table, filter);
    } };
    const deps = { repository, policy: f.policy, clock: f.clock, identity: f.identity };
    const outcome = target === 'demand' ? await createGregDemandService(deps).readDemand(f.gregContext)
      : await createGregPublishService(deps).preview(f.gregContext, await previewInput(f));
    assert.equal(outcome.status, 'conflict', target); assert.ok(reads >= 2, target);
  }
});
