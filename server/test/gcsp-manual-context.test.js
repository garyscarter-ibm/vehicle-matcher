import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { stock, fact } from './helpers/employee-recommendation.js';

const instant = '2026-11-05T09:00:00.000Z';
const command = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });
async function setup({ policy = createPolicyService(), seed = true } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => instant }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'manual-test', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const f = { repository, policy, clock, identity, presenter, acting, context };
  if (seed) assert.equal((await seedManualDemoContext(f)).status, 'ok');
  f.ports = createRepositoryManualPorts(f); f.service = new ManualContextService(f);
  return f;
}
const employeeRef = (f) => ({ table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } });
async function changeRecords(f, change, id = 'change-records') {
  return f.repository.transaction(f.context, command(id), async (tx) => {
    const found = await tx.get(employeeRef(f)); const context = structuredClone(found.value.contract.manualContext);
    change(context); return tx.compareAndSwap(employeeRef(f), found.value.version, { contract: { manualContext: context } });
  });
}
async function changeSlot(f, patch, id = 'change-slot') {
  return f.repository.transaction(f.context, command(id), async (tx) => {
    const ref = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.context.entitlementSlotId } };
    const found = await tx.get(ref); return tx.compareAndSwap(ref, found.value.version, patch);
  });
}
const choices = (f, changes = {}) => ({ mode: 'replacement', oldContractId: `current:${f.context.employeeId}`,
  slotId: f.context.entitlementSlotId, schemeId: f.context.schemeId, driverId: `driver:${f.context.employeeId}`,
  contractOptionId: 'six-month-8000', requestedCollectionDate: '2026-11-20', collectionLocationId: 'demo-collection-centre',
  brand: 'bmw', contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: 6700,
  specialRequirements: '', ...changes });
async function save(f, changes = {}, options = {}) {
  const account = await f.service.readAccount(f.context);
  return f.service.saveDraft(f.context, { commandId: 'draft', expectedDraftVersion: 0,
    expectedContextVersion: account.value.contextVersion, choices: choices(f, changes), ...options });
}
async function insertCars(f, cars = [stock(11, { insuranceGroup: fact(25, 'insurance-group') })]) {
  return f.repository.transaction(f.context, command('cars', cars), async (tx) => {
    for (const [i, car] of cars.entries()) {
      const inserted = await tx.insert('stock', { runId: f.context.runId, orderUuid: car.orderUuid,
        orderNumber: String(i + 1).padStart(7, '0'), configurationId: car.configurationId,
        state: 'released', available: true, held: false, allocated: false,
        visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null },
        facts: car.snapshot, release: { availability: { ...car.availability, availableFrom: instant } } });
      if (inserted.status !== 'ok') return inserted;
    }
    return ok({ count: cars.length });
  });
}
const variant = (f, ports) => new ManualContextService({ ...f, ports: { ...f.ports, ...ports } });
const intent = (f, changes = {}) => ({ mode: 'replacement', oldContractId: `current:${f.context.employeeId}`,
  slotId: f.context.entitlementSlotId, schemeId: f.context.schemeId, ...changes });

test('account inventory includes other supplied slots without granting them ordering authority', async () => {
  const f = await setup(); const actual = (await f.ports.employeeContract.read(f.context)).value;
  const extra = { ...actual.contracts[0], contractId: 'other-current', slotId: 'other-slot', schemeId: 'pcs-ukfs-bmw' };
  const service = variant(f, { employeeContract: { async read() { return ok({ ...actual,
    contracts: [...actual.contracts, extra], slots: [...actual.slots, { ...actual.slots[0], entitlementSlotId: 'other-slot', contractId: extra.contractId }] }); } } });
  const response = await service.readAccount(f.context);
  assert.equal(response.value.asOf, instant); assert.equal(response.value.contracts.length, 2);
  assert.equal(response.value.slots[1].ordering.enabled, false);
  assert.equal(response.value.slots[1].ordering.reason, 'outside-trusted-context');
  assert.equal(response.value.actions.length, 1); assert.equal(response.value.actions[0].slotId, f.context.entitlementSlotId);
  assert.equal((await service.saveDraft(f.context, { commandId: 'other-slot-intent', expectedDraftVersion: 0,
    expectedContextVersion: response.value.contextVersion, choices: intent(f, { slotId: 'other-slot', oldContractId: extra.contractId }) })).status, 'invalid');
});

test('intent drafts reuse exact action authority, replay, versions and reload without inventing order options', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  const input = { commandId: 'intent', expectedDraftVersion: 0, expectedContextVersion: account.value.contextVersion, choices: intent(f) };
  const before = (await f.repository.query(f.context, 'stock')).value;
  for (const [i, change] of [{ mode: 'new', oldContractId: null }, { oldContractId: 'wrong' }, { schemeId: 'pcs-ukfs-bmw' },
    { slotId: 'slot-alex' }, { driverId: 'driver:employee-paula' }].entries()) {
    assert.equal((await f.service.saveDraft(f.context, { ...input, commandId: `bad-intent-${i}`, choices: intent(f, change) })).status, 'invalid');
  }
  const saved = await f.service.saveDraft(f.context, input);
  assert.equal(saved.status, 'ok', JSON.stringify(saved)); assert.equal(saved.value.draftStage, 'intent');
  assert.equal(saved.value.view.action, 'choose-order-options'); assert.equal(saved.value.contract, null);
  assert.deepEqual(saved.value.choices, intent(f)); assert.equal(saved.value.currentContract.contractEndDate, '2026-12-01');
  assert.deepEqual(await f.service.saveDraft(f.context, input), saved);
  assert.deepEqual((await f.service.readDraft(f.context)).value.choices, intent(f));
  const browse = await f.service.browseStock(f.context);
  assert.equal(browse.status, 'conflict'); assert.equal(browse.reason, 'order-options-required');
  assert.deepEqual((await f.repository.query(f.context, 'stock')).value, before);
  assert.equal((await f.service.saveDraft(f.context, { ...input, commandId: 'stale-intent' })).status, 'stale-version');
  const complete = await save(f, {}, { commandId: 'complete-intent', expectedDraftVersion: 1 });
  assert.equal(complete.status, 'ok'); assert.equal(complete.value.draftStage, 'complete');
  assert.equal(complete.value.view.action, 'browse-stock'); assert.equal((await f.service.browseStock(f.context)).status, 'ok');
  await changeRecords(f, (r) => { r.source.sourceVersion = 'intent-source-v2'; }, 'intent-source');
  assert.equal((await f.service.readDraft(f.context)).value.requiresRefresh, true);
  assert.deepEqual(await f.service.saveDraft(f.context, input), saved);
});

test('new order intent uses an empty trusted slot and remains an intent after source refresh', async () => {
  const f = await setup(); await changeSlot(f, { contractId: null });
  await changeRecords(f, (r) => { r.contracts = []; });
  const account = await f.service.readAccount(f.context);
  const input = { commandId: 'new-intent', expectedDraftVersion: 0, expectedContextVersion: account.value.contextVersion,
    choices: intent(f, { mode: 'new', oldContractId: null }) };
  assert.equal((await f.service.saveDraft(f.context, input)).status, 'ok');
  await changeSlot(f, { renewalId: 'changed' }, 'intent-renewal');
  const reload = await f.service.readDraft(f.context);
  assert.equal(reload.value.draftStage, 'intent'); assert.equal(reload.value.requiresRefresh, true);
  assert.equal(reload.value.view.action, 'refresh-review'); assert.deepEqual(reload.value.choices, input.choices);
  assert.equal((await f.service.saveDraft(f.context, { ...input, commandId: 'stale-context', expectedDraftVersion: 1 })).status, 'stale-version');
});

test('server clock intersects renewal dates with canonical lead policy and open collection dates', async () => {
  const f = await setup();
  assert.equal((await f.service.readAccount(f.context)).value.state, 'ready');
  await changeRecords(f, (r) => { r.contracts[0].earliestCollectionDate = '2027-06-01'; r.contracts[0].latestCollectionDate = '2027-06-15'; });
  const later = await f.service.readAccount(f.context);
  assert.equal(later.value.state, 'not-yet-eligible'); assert.deepEqual(later.value.actions, []);
  assert.equal((await f.service.saveDraft(f.context, { commandId: 'too-early', expectedDraftVersion: 0,
    expectedContextVersion: later.value.contextVersion, choices: intent(f) })).reason, 'not-yet-eligible');
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const rules = seed.assumptions.find((a) => a.key === 'manual.context.v1').value;
  rules.maximumLeadDays = 7;
  const bounded = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  assert.equal((await bounded.service.readAccount(bounded.context)).value.state, 'ready');
  assert.equal((await save(bounded, { requestedCollectionDate: '2026-11-12' })).status, 'ok');
  for (const location of rules.locations) location.closedDates = ['2026-11-12'];
  const closed = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  assert.equal((await closed.service.readAccount(closed.context)).value.state, 'not-yet-eligible');
  const state = (await f.clock.readState(f.presenter.value.context)).value;
  assert.equal((await f.clock.advance(f.presenter.value.context, { commandId: 'window-opens', expectedClockVersion: state.clockVersion,
    to: '2027-05-25T09:00:00.000Z' })).status, 'ok');
  assert.equal((await f.service.readAccount(f.context)).value.state, 'ready');
});

test('ordering closes, not waits, once no collection date can fit the lead time before the window ends (FUCQ-200)', async () => {
  const f = await setup();
  // Clock 2026-11-05 plus the 7-day minimum lead is 2026-11-12, after this window's last date.
  await changeRecords(f, (r) => { r.contracts[0].earliestCollectionDate = '2026-11-01'; r.contracts[0].latestCollectionDate = '2026-11-11'; });
  const closed = await f.service.readAccount(f.context);
  assert.equal(closed.value.state, 'ordering-closed'); assert.deepEqual(closed.value.actions, []);
  assert.equal(closed.value.slots.find((s) => s.entitlementSlotId === f.context.entitlementSlotId).ordering.reason, 'ordering-closed');
  assert.equal((await f.service.saveDraft(f.context, { commandId: 'too-late', expectedDraftVersion: 0,
    expectedContextVersion: closed.value.contextVersion, choices: intent(f) })).reason, 'ordering-closed');
  await changeRecords(f, (r) => { r.contracts[0].latestCollectionDate = '2026-11-12'; }, 'last-fitting-date');
  assert.equal((await f.service.readAccount(f.context)).value.state, 'ready');
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  for (const location of seed.assumptions.find((a) => a.key === 'manual.context.v1').value.locations) location.closedDates = ['2026-11-12'];
  const shut = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  await changeRecords(shut, (r) => { r.contracts[0].latestCollectionDate = '2026-11-12'; }, 'last-date-shut');
  assert.equal((await shut.service.readAccount(shut.context)).value.state, 'ordering-closed');
});

test('future earliest collection alone permits replacement when canonical policy still offers dates', async () => {
  const f = await setup();
  await changeRecords(f, (r) => { r.contracts[0].earliestCollectionDate = '2026-11-20'; delete r.contracts[0].latestCollectionDate; });
  const account = await f.service.readAccount(f.context);
  assert.equal(account.value.state, 'ready');
  assert.deepEqual(account.value.actions, [{ action: 'replace', slotId: f.context.entitlementSlotId,
    schemeId: f.context.schemeId, oldContractId: `current:${f.context.employeeId}`, enabled: true }]);
  const saved = await f.service.saveDraft(f.context, { commandId: 'future-earliest-intent', expectedDraftVersion: 0,
    expectedContextVersion: account.value.contextVersion, choices: intent(f) });
  assert.equal(saved.status, 'ok'); assert.equal(saved.value.draftStage, 'intent');
  assert.equal((await save(f, {}, { commandId: 'future-earliest-complete', expectedDraftVersion: 1 })).status, 'ok');
});

test('account histories carry the policy scheme display name, and none when policy supplies no name (FUCQ-218)', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  const row = await f.policy.getAssumption('scheme.displayNames.v1', { runId: f.context.runId, asOf: instant, policyVersion: f.context.policyVersion });
  const names = row.value.value.names; assert.equal(row.value.status, 'assumed');
  assert.deepEqual(account.value.histories.map((h) => [h.schemeId, h.label]), account.value.histories.map((h) => [h.schemeId, names[h.schemeId]]));
  assert.ok(account.value.histories.every((h) => typeof h.label === 'string' && h.label.length > 0));
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const entry = seed.assumptions.find((a) => a.key === 'scheme.displayNames.v1'); delete entry.value.names['pcs-ukfs-bmw'];
  const partial = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  const histories = (await partial.service.readAccount(partial.context)).value.histories;
  assert.equal(histories[0].label, names['choices-fs-uk']); assert.equal(Object.hasOwn(histories[1], 'label'), false);
  seed.assumptions = seed.assumptions.filter((a) => a.key !== 'scheme.displayNames.v1');
  const bare = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  const read = await bare.service.readAccount(bare.context);
  assert.equal(read.value.state, 'ready'); assert.ok(read.value.histories.every((h) => !Object.hasOwn(h, 'label')));
});

test('account uses identity-seeded principal and entitlement; history, licence and support ownership are explicit', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  assert.equal(account.status, 'ok', JSON.stringify(account));
  assert.equal(account.value.state, 'ready');
  assert.equal(account.value.account.employeeId, f.context.employeeId);
  assert.equal(account.value.drivers[0].licence.displayNumber, 'FICTIONAL-LICENCE');
  assert.deepEqual(account.value.actions, [{ action: 'replace', slotId: 'slot-paula', schemeId: 'choices-fs-uk',
    oldContractId: 'current:employee-paula', enabled: true }]);
  assert.equal(account.value.histories[1].orderingSupported, false);
  assert.equal(account.value.histories[1].entries[0].status, 'returned');
  assert.equal(account.value.histories[2].state, 'empty-history');
  assert.equal(account.value.view.fields.account.supportOwner, 'hr-support');
  assert.equal(account.value.view.fields.licence.editable, false);
  assert.equal(account.value.assumptions[0].status, 'assumed');
  assert.equal((await f.service.readAccount({ ...f.context, employeeId: 'other' })).status, 'forbidden');
  assert.equal((await f.service.readAccount(f.presenter.value.context)).status, 'forbidden');
});

test('absent HR, unavailable sources, no entitlement, missing referenced contract and valid empty history stay distinct', async () => {
  const absent = await setup({ seed: false });
  assert.equal((await absent.service.readAccount(absent.context)).value.state, 'absent-hr-account');
  const f = await setup();
  const failed = variant(f, { employeeContract: { async read() { return result('unavailable', { retryable: true }); } } });
  assert.equal((await failed.readAccount(f.context)).status, 'unavailable');
  await changeSlot(f, { state: 'disabled' });
  assert.equal((await f.service.readAccount(f.context)).value.state, 'no-entitlement');
  await changeSlot(f, { state: 'entitled', contractId: 'missing-contract' }, 'missing-contract');
  assert.equal((await f.service.readAccount(f.context)).value.state, 'no-contract');
  await changeSlot(f, { contractId: null }, 'new-entitlement');
  await changeRecords(f, (r) => { r.contracts = []; r.histories[0].entries = []; });
  const empty = await f.service.readAccount(f.context);
  assert.equal(empty.value.state, 'ready'); assert.equal(empty.value.currentContract, null);
  assert.equal(empty.value.contractState, 'no-contract');
  assert.equal(empty.value.histories[0].state, 'empty-history'); assert.equal(empty.value.actions[0].action, 'order');
});

test('unknown scheme/grade and unsupported supplied scheme history do not imply ordering support', async () => {
  const f = await setup();
  for (const code of ['unknown-scheme', 'unknown-grade']) {
    const service = variant(f, { schemeTerms: { async read() { return result('invalid', { code }); } } });
    const response = await service.readAccount(f.context);
    assert.equal(response.value.state, code); assert.deepEqual(response.value.actions, []);
    assert.equal(response.value.histories[1].entries.length, 1);
  }
  const sam = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-sam', 'sam');
  assert.equal((await seedManualDemoContext({ ...f, context: sam.value.context })).status, 'ok');
  const unsupported = await f.service.readAccount(sam.value.context);
  assert.equal(unsupported.value.state, 'unsupported-scheme');
  assert.equal(unsupported.value.histories[0].entries.length, 1); assert.deepEqual(unsupported.value.actions, []);
});

test('incompatible source rows, employee scope and driver record sets fail closed', async () => {
  const f = await setup();
  const actual = (await f.ports.driver.read(f.context)).value;
  for (const value of [{ ...actual, employeeId: 'other' }, { ...actual, recordSetId: 'another-screenshot' },
    { ...actual, source: { ...actual.source, sourceVersion: null } },
    { ...actual, source: { ...actual.source, effectiveFrom: '2026-11-06T00:00:00.000Z' } },
    { ...actual, repositoryVersion: actual.repositoryVersion + 1 },
    { ...actual, drivers: [{ ...actual.drivers[0], employeeId: 'other' }] }]) {
    assert.equal((await variant(f, { driver: { async read() { return ok(value); } } }).readAccount(f.context)).status, 'unavailable');
  }
  await changeRecords(f, (r) => { r.account.gradeId = 'G15'; });
  assert.equal((await f.service.readAccount(f.context)).status, 'unavailable');
});

test('versioned replacement draft preserves separate current-car, requested collection and typed term facts', async () => {
  const f = await setup(); const response = await save(f);
  assert.equal(response.status, 'ok', JSON.stringify(response));
  const d = response.value;
  assert.equal(d.draftVersion, 1); assert.equal(d.currentContract.contractEndDate, '2026-12-01');
  assert.equal(d.choices.requestedCollectionDate, '2026-11-20'); assert.equal(d.currentContract.currentOdometer.value, 5200);
  assert.equal(d.choices.expectedReturnMileage, 6700); assert.equal(d.contract.annualMileage, 8000);
  assert.equal(d.contract.months, 6); assert.equal(d.contract.mileageUnit, 'mi/year');
  assert.equal(d.sources.employeeContract.sourceVersion, 'manual-records-v1');
  assert.equal(d.renewalId, 'renewal:employee-paula'); assert.equal(d.entitlementSlotId, 'slot-paula');
  assert.deepEqual((await f.service.readDraft(f.context)).value.choices, d.choices);
  assert.equal((await f.repository.query(f.context, 'briefs')).value.length, 0);
  assert.deepEqual(await save(f), response);
  assert.equal((await save(f, { expectedReturnMileage: 6800 })).status, 'conflict');
});

test('new-order branch never borrows a current contract or return mileage', async () => {
  const f = await setup(); await changeSlot(f, { contractId: null });
  await changeRecords(f, (r) => { r.contracts = []; });
  assert.equal((await save(f, { mode: 'new', oldContractId: null, expectedReturnMileage: null })).status, 'ok');
  assert.equal((await save(f, { mode: 'new', oldContractId: null }, { commandId: 'bad', expectedDraftVersion: 1 })).status, 'invalid');
});

test('identical command replay survives changed or unavailable sources and collection timing while keeping identity/run guards', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  const input = { commandId: 'lost-response', expectedDraftVersion: 0,
    expectedContextVersion: account.value.contextVersion, choices: choices(f) };
  const original = await f.service.saveDraft(f.context, input); assert.equal(original.status, 'ok');
  await changeRecords(f, (r) => { r.source.sourceVersion = 'new-source'; }, 'replay-source-change');
  assert.deepEqual(await f.service.saveDraft(f.context, input), original);
  const outage = variant(f, { employeeContract: { async read() { return result('unavailable', { retryable: true }); } } });
  assert.deepEqual(await outage.saveDraft(f.context, input), original);
  const state = (await f.clock.readState(f.presenter.value.context)).value;
  assert.equal((await f.clock.advance(f.presenter.value.context, { commandId: 'replay-later', expectedClockVersion: state.clockVersion,
    bySeconds: 30 * 86400 })).status, 'ok');
  assert.deepEqual(await f.service.saveDraft(f.context, input), original);
  assert.equal((await f.service.saveDraft(f.context, { ...input, choices: choices(f, { expectedReturnMileage: 6800 }) })).status, 'conflict');
  assert.equal((await f.service.saveDraft({ ...f.context, employeeId: 'other' }, input)).status, 'forbidden');
  const current = (await f.clock.readState(f.presenter.value.context)).value;
  await f.clock.reset(f.presenter.value.context, { commandId: 'replay-reset', expectedRunId: current.runId,
    expectedRunVersion: current.runVersion, scenarioVersion: current.versions.scenario, fixtureVersion: current.versions.fixture });
  assert.equal((await f.service.saveDraft(f.context, input)).status, 'stale-run');
});

test('collection dates require strings and cannot bypass a configured closure through JSON coercion', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((a) => a.key === 'manual.context.v1').value.locations[0].closedDates = ['2026-11-20'];
  const f = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  for (const [i, date] of ['2026-11-20', ['2026-11-20'], ['2026-11-21']].entries()) {
    const response = await save(f, { requestedCollectionDate: date }, { commandId: `date-type-${i}` });
    assert.equal(response.status, 'invalid'); assert.equal(response.reasons[0].field, 'requestedCollectionDate');
  }
  assert.equal((await save(f, { requestedCollectionDate: '2026-11-21' }, { commandId: 'open-string-date' })).status, 'ok');
});

test('a command committed during duplicate preparation wins over its later source failure', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  const input = { commandId: 'in-flight-retry', expectedDraftVersion: 0,
    expectedContextVersion: account.value.contextVersion, choices: choices(f) };
  let original;
  const retry = variant(f, { employeeContract: { async read() {
    original = await f.service.saveDraft(f.context, input);
    return result('unavailable', { retryable: true });
  } } });
  assert.deepEqual(await retry.saveDraft(f.context, input), original);
  assert.equal(original.status, 'ok');
  assert.equal((await f.service.readDraft(f.context)).value.draftVersion, 1);
});

test('driver, contract, location, dates, contact and bounded conditional requirements validate permitted combinations', async () => {
  const f = await setup();
  const cases = [{ driverId: 'someone-else' }, { schemeId: 'pcs-ukfs-bmw' }, { slotId: 'slot-alex' }, { oldContractId: 'wrong' },
    { driverId: 'nominated:employee-paula', contractOptionId: 'twelve-month-12000' },
    { collectionLocationId: 'demo-company-site' }, { brand: 'mini' }, { requestedCollectionDate: '2026-02-30' },
    { requestedCollectionDate: '2026-11-06' }, { requestedCollectionDate: '2027-06-20' }, { requestedCollectionDate: '2026-12-02' },
    { contact: { phone: '', email: 'bad' } }, { expectedReturnMileage: -1 }, { expectedReturnMileage: null },
    { expectedReturnMileage: 500001 }, { specialRequirements: 'x'.repeat(501) }, { specialRequirements: 'x\u0000' }, { contribution: 100 }];
  for (const [i, entry] of cases.entries()) assert.equal((await save(f, entry, { commandId: `invalid-${i}` })).status, 'invalid', JSON.stringify(entry));
  assert.equal((await save(f, { driverId: 'nominated:employee-paula', specialRequirements: 'x'.repeat(500) })).status, 'ok');
});

test('stale and concurrent writes refuse; dependent driver, term, date and location changes explicitly invalidate quote/selection', async () => {
  const f = await setup(); await save(f);
  const outcomes = await Promise.all([save(f, { expectedReturnMileage: 6800 }, { commandId: 'a', expectedDraftVersion: 1 }),
    save(f, { expectedReturnMileage: 6900 }, { commandId: 'b', expectedDraftVersion: 1 })]);
  assert.equal(outcomes.filter((o) => o.status === 'ok').length, 1);
  const stale = outcomes.find((o) => o.status === 'stale-version'); assert.equal(stale.currentVersion, 2); assert.equal(stale.action, 'refresh');
  const contactOnly = await save(f, { contact: { phone: '01632 960002', email: 'edited@example.invalid' } }, { commandId: 'contact', expectedDraftVersion: 2 });
  assert.deepEqual(contactOnly.value.invalidations, []);
  for (const [i, changes] of [{ driverId: 'nominated:employee-paula' }, { contractOptionId: 'twelve-month-12000' },
    { requestedCollectionDate: '2026-11-21' }, { contractOptionId: 'twelve-month-12000', collectionLocationId: 'demo-company-site' }].entries()) {
    const updated = await save(f, changes, { commandId: `dependent-${i}`, expectedDraftVersion: i + 3 });
    assert.equal(updated.status, 'ok', JSON.stringify(updated));
    assert.ok(updated.value.invalidations.includes('quote')); assert.ok(updated.value.invalidations.includes('selection'));
    assert.equal(updated.value.selection, null); assert.equal(updated.value.quote, null);
  }
});

test('changed source and renewal-slot revisions require refresh and recomputation without erasing history', async () => {
  const f = await setup(); const initial = await save(f);
  await changeRecords(f, (r) => { r.source.sourceVersion = 'manual-records-v2'; r.recordSetId += ':v2'; });
  const read = await f.service.readDraft(f.context);
  assert.equal(read.value.requiresRefresh, true); assert.ok(read.value.invalidations.includes('quote'));
  assert.equal((await f.service.browseStock(f.context)).status, 'stale-version');
  assert.equal((await f.service.saveDraft(f.context, { commandId: 'old-source', expectedDraftVersion: 1,
    expectedContextVersion: initial.value.contextVersion, choices: choices(f) })).status, 'stale-version');
  const refreshed = await save(f, {}, { commandId: 'refresh', expectedDraftVersion: 1 });
  assert.equal(refreshed.status, 'ok'); assert.ok(refreshed.value.invalidations.includes('context'));
  const history = (await f.repository.query(f.context, 'event_receipts', { consumerId: 'manual:draft:employee-paula' })).value;
  assert.equal(history.length, 2); assert.equal(history[0].outcome.value.sources.employeeContract.sourceVersion, 'manual-records-v1');
  await changeSlot(f, { renewalId: 'next-renewal' }, 'next-renewal');
  assert.equal((await f.service.readDraft(f.context)).value.requiresRefresh, true);
});

test('manual browsing uses all shared gate decisions without preference ranking or the recommendation display cap', async () => {
  const f = await setup(); await save(f);
  const cars = Array.from({ length: 7 }, (_, i) => stock(i + 11, { insuranceGroup: fact(25, 'insurance-group') }));
  assert.equal((await insertCars(f, cars)).status, 'ok');
  const before = (await f.repository.query(f.context, 'stock')).value;
  const response = await f.service.browseStock(f.context);
  assert.equal(response.status, 'ok', JSON.stringify(response)); assert.equal(response.value.state, 'available-stock');
  assert.equal(response.value.total, 7); assert.equal(response.value.cars.length, 7); assert.equal(response.value.ranked, false);
  assert.equal(response.value.browsingReservesStock, false); assert.equal(response.value.cars[0].score, null);
  assert.equal(response.value.cars[0].terms.kind, 'employee-scheme'); assert.equal(response.value.cars[0].terms.contribution, null);
  assert.equal(response.value.cars[0].terms.points.unit, 'points');
  assert.equal(response.value.cars[0].versions.policy, f.context.policyVersion);
  assert.equal(response.value.cars[0].snapshot.vin, undefined);
  assert.deepEqual((await f.repository.query(f.context, 'stock')).value, before);
  assert.equal((await f.repository.query(f.context, 'holds')).value.length, 0);
});

test('browsing refuses to combine draft and account preparations from different source snapshots', async () => {
  const f = await setup(); await save(f); await insertCars(f);
  const original = (await f.ports.driver.read(f.context)).value;
  let reads = 0;
  const service = variant(f, { driver: { async read() {
    reads += 1;
    return ok(reads === 1 ? { ...original, source: { ...original.source, sourceVersion: 'racing-driver-v2' } } : original);
  } } });
  const response = await service.browseStock(f.context);
  assert.equal(response.status, 'stale-version'); assert.equal(response.resource, 'manual-context');
});

test('stock absence, source outage and unavailable exact cars are distinct; catalogue facts never create availability', async () => {
  const f = await setup(); await save(f);
  // DemoClock's unreleased catalogue references do not create available stock.
  assert.equal((await f.service.browseStock(f.context)).value.state, 'empty-stock');
  const empty = variant(f, { releasedStock: { async read(context) { return ok({ ...context, sourceVersion: 'empty-v1', stock: [] }); } } });
  assert.equal((await empty.browseStock(f.context)).value.state, 'empty-stock');
  const outage = variant(f, { releasedStock: { async read() { throw Error('never expose source details'); } } });
  assert.equal((await outage.browseStock(f.context)).status, 'unavailable');
  await insertCars(f);
  const source = (await f.ports.releasedStock.read(f.context)).value;
  const exact = source.stock.filter((row) => row.snapshot?.identityKind === 'exact-stock');
  const unavailable = variant(f, { releasedStock: { async read() { return ok({ ...source, stock: exact.map((r) => ({ ...r,
    availability: { ...r.availability, state: 'held' } })) }); } } });
  const held = await unavailable.browseStock(f.context);
  assert.equal(held.value.state, 'no-eligible-stock'); assert.equal(held.value.cars.length, 0);
  assert.ok(held.value.decisions[0].blockers.some((b) => b.code === 'not-available'));
});

test('unknown driver, insurance, eligibility and points facts fail closed while valid alternatives remain reachable', async () => {
  const f = await setup(); await save(f);
  const cars = [stock(11, { insuranceGroup: fact(25, 'insurance-group') }), stock(12),
    stock(13, { insuranceGroup: fact(45, 'insurance-group') }),
    stock(14, { insuranceGroup: fact(25, 'insurance-group'), eligibilityModelKey: fact('G70 Saloon|760e xDrive') }),
    stock(15, { insuranceGroup: fact(25, 'insurance-group'), eligibilityModelKey: fact(null) })];
  const base = (await f.ports.releasedStock.read(f.context)).value;
  const source = { ...base, stock: cars.map((c, i) => ({ ...c, orderNumber: `000000${i}`, availability: { ...c.availability, availableFrom: instant } })) };
  const service = variant(f, { releasedStock: { async read() { return ok(source); } } });
  const result = await service.browseStock(f.context);
  assert.equal(result.status, 'ok', JSON.stringify(result)); assert.equal(result.value.cars.length, 1);
  assert.ok(result.value.decisions[1].unknowns.some((u) => u.code === 'insurance-unconfirmed'));
  assert.ok(result.value.decisions[2].blockers.some((u) => u.code === 'insurance-grade-limit'));
  assert.equal(result.value.decisions[3].suitable, false); assert.equal(result.value.decisions[4].suitable, false);
  await changeRecords(f, (r) => { r.drivers[0].eligible = fact(null); r.source.sourceVersion = 'driver-unknown'; });
  await save(f, {}, { commandId: 'new-context', expectedDraftVersion: 1 });
  const unknown = await service.browseStock(f.context);
  assert.equal(unknown.value.cars.length, 0); assert.ok(unknown.value.decisions[0].unknowns.some((u) => u.code === 'driver-unconfirmed'));
});

test('central manual configuration changes allowed choices and insurance consistently; historical drafts keep their inputs', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seed.assumptions.find((a) => a.key === 'manual.context.v1').value.insuranceMaximumByGrade.G7 = 50;
  seed.assumptions.find((a) => a.key === 'manual.context.v1').value.maximumSpecialRequirements = 12;
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const f = await setup({ policy });
  assert.equal((await save(f, { specialRequirements: 'x'.repeat(13) }, { commandId: 'too-long' })).status, 'invalid');
  await save(f); const source = (await f.ports.releasedStock.read(f.context)).value;
  const car = stock(11, { insuranceGroup: fact(45, 'insurance-group') });
  const service = variant(f, { releasedStock: { async read() { return ok({ ...source, stock: [{ ...car, orderNumber: '0000001',
    availability: { ...car.availability, availableFrom: instant } }] }); } } });
  assert.equal((await service.browseStock(f.context)).value.cars.length, 1);
  const topUp = await policy.getAssumption('choices.topUp.enabled', { runId: f.context.runId, asOf: instant });
  assert.equal(topUp.value.value, false);
});

test('repository stock visibility is scoped to company, scheme and optional employee; unknown authority is unavailable', async () => {
  const f = await setup(); await save(f); await insertCars(f);
  const ref = { table: 'stock', key: { runId: f.context.runId, orderUuid: stock(11).orderUuid } };
  const patch = (visibility, id) => f.repository.transaction(f.context, command(id), async (tx) => {
    const row = await tx.get(ref); return tx.compareAndSwap(ref, row.value.version, { visibility });
  });
  await patch({ companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: ['employee-alex'] }, 'private-car');
  assert.equal((await f.service.browseStock(f.context)).value.state, 'empty-stock');
  await patch({ companyIds: ['another-company'], schemeIds: [f.context.schemeId], employeeIds: null }, 'company-car');
  assert.equal((await f.service.browseStock(f.context)).value.total, 0);
  await patch({ companyIds: [f.context.companyId], schemeIds: ['another-scheme'], employeeIds: null }, 'scheme-car');
  assert.equal((await f.service.browseStock(f.context)).value.total, 0);
  await patch(null, 'unknown-visibility');
  assert.equal((await f.service.browseStock(f.context)).status, 'unavailable');
});

test('licence qualification is checked at requested collection; unknown and expired facts never imply suitability', async () => {
  const f = await setup(); await save(f); await insertCars(f);
  assert.equal((await f.service.browseStock(f.context)).value.total, 1);
  await changeRecords(f, (r) => { r.drivers[0].licence.validUntil = '2026-11-19'; }, 'expiry');
  const expiredSave = await save(f, {}, { commandId: 'expiry-refresh', expectedDraftVersion: 1 });
  assert.equal(expiredSave.status, 'invalid'); assert.equal(expiredSave.code, 'licence-not-valid-at-collection');
  const expired = await f.service.browseStock(f.context);
  assert.equal(expired.status, 'stale-version');
  assert.equal((await f.service.readDraft(f.context)).value.draftVersion, 1);
  await changeRecords(f, (r) => { r.drivers[0].licence.validUntil = null; }, 'unknown-licence');
  const unknownSave = await save(f, {}, { commandId: 'unknown-refresh', expectedDraftVersion: 1 });
  assert.equal(unknownSave.status, 'invalid'); assert.equal(unknownSave.code, 'licence-unconfirmed');
  const unknown = await f.service.browseStock(f.context);
  assert.equal(unknown.status, 'stale-version');
  const history = (await f.repository.query(f.context, 'event_receipts', { consumerId: 'manual:draft:employee-paula' })).value;
  assert.equal(history.length, 1);
});

test('local source changes between preparation and transaction return a safe stale refusal', async () => {
  const f = await setup(); const account = await f.service.readAccount(f.context);
  let changed = false;
  const repository = { ...f.repository, async transaction(context, input, work) {
    if (!changed && input.commandId.startsWith('manual:employee-paula:')) {
      changed = true; await changeRecords(f, (r) => { r.account.contact.phone = '01632 960005'; }, 'racing-record');
    }
    return f.repository.transaction(context, input, work);
  } };
  const service = new ManualContextService({ ...f, repository });
  const response = await service.saveDraft(f.context, { commandId: 'raced', expectedDraftVersion: 0,
    expectedContextVersion: account.value.contextVersion, choices: choices(f) });
  assert.equal(response.status, 'stale-version'); assert.equal(response.resource, 'employee-context');
  assert.equal((await f.service.readDraft(f.context)).status, 'not-found');
});

const cookie = (session) => [session.value.setCookie].flat().map((v) => v.split(';')[0]).join('; ');
async function withHttp(f, work, service = f.service) {
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspManual: service, gcspAllowedOrigins: ['https://manual.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = async (path, { body, session = f.acting, origin = 'https://manual.test' } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/manual${path}`, {
      method: body ? 'POST' : 'GET', headers: { Origin: origin, cookie: cookie(session), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json(), cache: response.headers.get('Cache-Control') };
  };
  try { await work(request); } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
}

test('manual HTTP rejects caller authority and hostile origins; another employee and stale sessions cannot read the draft', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    const account = await request('/account'); assert.equal(account.status, 200); assert.equal(account.cache, 'no-store');
    for (const path of ['/account?employeeId=other', '/account?schemeId=pcs-ukfs-bmw']) assert.equal((await request(path)).status, 400);
    const input = { commandId: 'http-draft', expectedDraftVersion: 0, expectedContextVersion: account.json.value.contextVersion, choices: choices(f) };
    for (const field of ['employeeId', 'principalId', 'gradeId', 'schemeId', 'roles', 'policy', 'runId']) {
      assert.equal((await request('/draft', { body: { ...input, [field]: 'other' } })).status, 400, field);
    }
    assert.equal((await request('/draft', { body: input })).status, 200);
    assert.equal((await request('/draft', { body: { ...input, commandId: 'stale' } })).status, 409);
    assert.equal((await request('/account', { origin: 'https://hostile.test' })).status, 403);
    assert.equal((await request('/account', { session: f.presenter })).status, 403);
    const other = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-alex', 'alex');
    // FUCQ-319: an absent draft reads as 200 not-found; another employee still gets nothing of Paula's.
    const otherDraft = await request('/draft', { session: other });
    assert.equal(otherDraft.status, 200); assert.equal(otherDraft.json.status, 'not-found'); assert.equal(otherDraft.json.value, undefined);
    const state = (await f.clock.readState(f.presenter.value.context)).value;
    await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
      scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
    assert.equal((await request('/draft')).json.status, 'stale-run');
  });
});

test('equivalent synthetic and real-shaped read adapters use the same application and presentation contract', async () => {
  const f = await setup(); const expected = JSON.parse(await readFile(new URL('./fixtures/gcsp/manual-presentation.json', import.meta.url), 'utf8'));
  const original = (await f.ports.employeeContract.read(f.context)).value;
  const raw = { person: { key: original.employeeId }, environment: original.environmentId, run: original.runId,
    revision: original.source.sourceVersion, accountDetails: original.account, agreements: original.contracts,
    schemeHistory: original.histories, vehicleSlots: original.slots, recordSet: original.recordSetId };
  const mapped = variant(f, { employeeContract: { async read() { return ok({ employeeId: raw.person.key, environmentId: raw.environment,
    runId: raw.run, recordSetId: raw.recordSet, source: { ...original.source, mode: 'dated-snapshot', sourceRef: 'fixture:real-shaped-contract' },
    account: raw.accountDetails, contracts: raw.agreements, histories: raw.schemeHistory, slots: raw.vehicleSlots }); } } });
  for (const service of [f.service, mapped]) {
    const account = await service.readAccount(f.context);
    assert.deepEqual({ state: account.value.state, actions: account.value.actions, view: account.value.view }, expected.account);
    const draft = await service.saveDraft(f.context, { commandId: service === mapped ? 'mapped' : 'synthetic', expectedDraftVersion: service === mapped ? 1 : 0,
      expectedContextVersion: account.value.contextVersion, choices: choices(f) });
    assert.equal(draft.status, 'ok'); assert.deepEqual(draft.value.view, expected.draftView);
    const validation = await service.saveDraft(f.context, { commandId: 'bad', expectedDraftVersion: draft.value.draftVersion,
      expectedContextVersion: account.value.contextVersion, choices: choices(f, { contact: null }) });
    assert.deepEqual(validation.view, expected.validationView);
  }
});
