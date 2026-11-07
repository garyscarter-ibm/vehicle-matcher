// Explicit pinned-source proof variant, selected by the admitted supervisor.
// Its loader supplies exactly the published FUCQ-66 claim/context modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore, inputDigest, OCCUPYING_STATES } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { ManualClaimsService } from '../gcsp/manual-claims/index.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { stock, essential, preference, fact } from './helpers/employee-recommendation.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const ref = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const authorityTables = ['stock', 'holds', 'claims', 'quotes', 'offers', 'notification_outbox'];
const authority = (f) => structuredClone(Object.fromEntries(authorityTables.map((table) => [table, f.store.state.tables[table]])));

async function setup(t) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok'); t.after(() => repository.close());
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'actual66-buddy-proof', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok'); const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const contexts = {};
  for (const name of ['paula', 'alex']) {
    const switched = await identity.switchPrincipal(presenter, `demo-${name}`, name); assert.equal(switched.status, 'ok');
    contexts[name] = switched.value.context;
    assert.equal((await identity.requireRole(contexts[name], 'employee')).status, 'ok');
    assert.equal((await identity.requireRole({ ...contexts[name] }, 'employee')).status, 'forbidden');
    assert.equal((await seedManualDemoContext({ repository, identity, clock, context: contexts[name] })).status, 'ok');
  }
  assert.equal((await clock.advance(presenter, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  const brief = new BriefService({ repository, policy, clock, identity });
  for (const context of Object.values(contexts)) {
    assert.equal((await brief.saveDraft(context, { commandId: 'brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } })).status, 'ok');
    assert.equal((await brief.confirm(context, { commandId: 'brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: true } })).status, 'ok');
  }
  // This canonical model key is allowed for both seeded grades; estate is a soft preference.
  const car = stock(11, { eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'),
    boot: fact(380, 'L'), sizeClass: fact(2, 'ordinal-1-5'), insuranceGroup: fact(25, 'insurance-group') }, 'RjcwOlMx');
  assert.equal((await repository.transaction(contexts.paula, command('release-exact-car'), (tx) => tx.insert('stock', {
    runId: contexts.paula.runId, orderUuid: car.orderUuid, orderNumber: '9123456', configurationId: car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
    release: { eventId: 'synthetic-release', availability: car.availability },
    visibility: { companyIds: [contexts.paula.companyId], schemeIds: [contexts.paula.schemeId], employeeIds: null },
  }))).status, 'ok');
  const options = { repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } };
  const ports = createRepositoryManualPorts(options);
  const manualContext = new ManualContextService({ ...options, ports });
  const manual = new ManualClaimsService({ ...options, manual: manualContext });
  const buddy = new BuddyHoldService(options);
  return { store, ...options, presenter, contexts, car, manual, buddy };
}

async function prepareManual(f, context, version = 0) {
  const account = await f.manual.readAccount(context); assert.equal(account.status, 'ok'); assert.equal(account.value.state, 'ready');
  const a = account.value; const action = a.actions.find((row) => row.enabled); assert.ok(action);
  const driver = a.choices.drivers.find((row) => row.kind === 'employee'); assert.ok(driver);
  const option = a.choices.contractOptions.find((row) => row.schemeIds.includes(context.schemeId) && row.driverKinds.includes(driver.kind));
  assert.ok(option);
  const location = a.choices.collectionLocations.find((row) => row.contractOptionIds.includes(option.contractOptionId)
    && row.driverKinds.includes(driver.kind)); assert.ok(location);
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
    requestedCollectionDate: a.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
    brand: a.choices.brands[0], contact: a.account.contact, expectedReturnMileage: a.currentContract.currentOdometer.value,
    specialRequirements: '' };
  const saved = await f.manual.saveDraft(context, { commandId: `manual-draft:${version + 1}`, expectedDraftVersion: version,
    expectedContextVersion: a.contextVersion, choices });
  assert.equal(saved.status, 'ok'); assert.equal(saved.value.draftVersion, version + 1);
  const browsed = await f.manual.browseStock(context); assert.equal(browsed.status, 'ok');
  return browsed.value.decisions.find((row) => row.orderUuid === f.car.orderUuid);
}

async function buddyInput(f, context, id) {
  const employee = await f.repository.read(context, ref(context, 'employees', { employeeId: context.employeeId }));
  const slot = await f.repository.read(context, ref(context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }));
  const stock = await f.repository.read(context, ref(context, 'stock', { orderUuid: f.car.orderUuid }));
  assert.equal(employee.status, 'ok'); assert.equal(slot.status, 'ok'); assert.equal(stock.status, 'ok');
  return { commandId: id, orderUuid: f.car.orderUuid, expectedBriefVersion: 1, expectedStockVersion: stock.value.version,
    expectedEmployeeVersion: employee.value.version, expectedSlotVersion: slot.value.version };
}
function oneWinner(f, type, employeeId) {
  for (const table of ['holds', 'claims']) {
    const rows = f.store.state.tables[table].filter((row) => OCCUPYING_STATES.includes(row.state));
    assert.equal(rows.length, 1); assert.equal(rows[0].type, type);
    assert.equal(rows[0].employeeId, employeeId); assert.equal(rows[0].orderUuid, f.car.orderUuid);
  }
  assert.equal(f.store.state.tables.stock.find((row) => row.orderUuid === f.car.orderUuid).state, 'held');
}

for (const employee of ['paula', 'alex']) {
  test(`actual manual service first excludes buddy exact-car claim for ${employee === 'paula' ? 'same' : 'second genuine'} employee`, async (t) => {
    const f = await setup(t); const manualContext = f.contexts.paula; const buddyContext = f.contexts[employee];
    const decision = await prepareManual(f, manualContext);
    assert.equal(decision.gateStatus, 'eligible', JSON.stringify({ blockers: decision.blockers.map((row) => row.code),
      unknowns: decision.unknowns.map((row) => row.code) })); assert.ok(decision.claimInput);
    const claim = { commandId: 'manual-first', ...decision.claimInput };
    const claimed = await f.manual.claim(manualContext, claim); assert.equal(claimed.status, 'ok'); assert.equal(claimed.value.state, 'quoted');
    oneWinner(f, 'cart', manualContext.employeeId);
    const before = authority(f); const input = await buddyInput(f, buddyContext, 'buddy-after-manual');
    const refused = await f.buddy.allocate(buddyContext, input); assert.equal(refused.status, 'conflict');
    assert.deepEqual(authority(f), before); assert.deepEqual(await f.buddy.allocate(buddyContext, input), refused);
    assert.deepEqual(await f.manual.claim(manualContext, claim), claimed);
    assert.equal(f.store.state.tables.quotes.length, 1); assert.equal(f.store.state.tables.offers.length, 0);
    assert.equal(f.store.state.tables.notification_outbox.length, 0); oneWinner(f, 'cart', manualContext.employeeId);
  });

  test(`actual buddy service first excludes manual exact-car claim for ${employee === 'paula' ? 'same' : 'second genuine'} employee`, async (t) => {
    const f = await setup(t); const manualContext = f.contexts[employee]; const buddyContext = f.contexts.paula;
    const decision = await prepareManual(f, manualContext);
    assert.equal(decision.gateStatus, 'eligible', JSON.stringify({ blockers: decision.blockers.map((row) => row.code),
      unknowns: decision.unknowns.map((row) => row.code) })); assert.ok(decision.claimInput);
    const input = await buddyInput(f, buddyContext, 'buddy-first');
    const allocated = await f.buddy.allocate(buddyContext, input); assert.equal(allocated.status, 'ok');
    assert.equal(allocated.value.quote.eligibility.currentCarComparison.display.state, 'partial');
    oneWinner(f, 'buddy-offer', buddyContext.employeeId);
    const before = authority(f);
    const refused = await f.manual.claim(manualContext, { commandId: 'manual-after-buddy', ...decision.claimInput });
    assert.equal(['conflict', 'stale-version'].includes(refused.status), true); assert.deepEqual(authority(f), before);
    const fresh = await prepareManual(f, manualContext, 1);
    assert.equal(fresh.gateStatus, 'ineligible'); assert.equal(fresh.claimInput, null);
    assert.equal(fresh.blockers.some((row) => row.code === 'not-available'), true);
    assert.deepEqual(authority(f), before); assert.deepEqual(await f.buddy.allocate(buddyContext, input), allocated);
    assert.equal(f.store.state.tables.quotes.length, 1); assert.equal(f.store.state.tables.offers.length, 1);
    assert.equal(f.store.state.tables.notification_outbox.length, 1); oneWinner(f, 'buddy-offer', buddyContext.employeeId);
    const token = new URL(f.store.state.tables.notification_outbox[0].payload.offerLink, 'https://demo.invalid').hash.slice(7);
    assert.equal(JSON.stringify(Object.fromEntries(Object.entries(f.store.state.tables).filter(([table]) => table !== 'notification_outbox'))).includes(token), false);
  });
}
