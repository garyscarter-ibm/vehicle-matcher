import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { buildServer } from '../index.js';
import { createManualSetupController } from '../../blocks/gcsp/manual-setup/setup-controller.js';
import { deriveSetupModel } from '../../blocks/gcsp/manual-setup/setup-model.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';

const instant = '2026-11-05T09:00:00.000Z';
async function setup({ policy = createPolicyService() } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => instant }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'manual-setup-test', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context; const f = { repository, policy, clock, identity, context, acting };
  assert.equal((await seedManualDemoContext(f)).status, 'ok');
  f.ports = createRepositoryManualPorts(f); f.service = new ManualContextService(f);
  f.adapter = { readAccount: () => f.service.readAccount(context), readDraft: () => f.service.readDraft(context),
    saveDraft: (input) => f.service.saveDraft(context, input), browseStock: () => f.service.browseStock(context) };
  let sequence = 0;
  f.controller = createManualSetupController({ adapter: f.adapter, commandId: () => `setup-${++sequence}` });
  return f;
}
async function changeRecords(f, change, id = 'records-change') {
  const ref = { table: 'employees', key: { runId: f.context.runId, employeeId: f.context.employeeId } };
  return f.repository.transaction(f.context, { commandId: id, inputDigest: inputDigest({ id }) }, async (tx) => {
    const found = await tx.get(ref); const value = structuredClone(found.value.contract.manualContext); change(value);
    return tx.compareAndSwap(ref, found.value.version, { contract: { manualContext: value } });
  });
}
async function makeNew(f) {
  const ref = { table: 'entitlement_slots', key: { runId: f.context.runId, entitlementSlotId: f.context.entitlementSlotId } };
  await f.repository.transaction(f.context, { commandId: 'empty-slot', inputDigest: inputDigest({}) }, async (tx) => {
    const row = await tx.get(ref); return tx.compareAndSwap(ref, row.value.version, { contractId: null });
  });
  await changeRecords(f, (r) => { r.contracts = []; });
}
function fill(f, patch = {}) {
  const changes = { driverId: `driver:${f.context.employeeId}`, contractOptionId: 'six-month-8000',
    requestedCollectionDate: '2026-11-20', collectionLocationId: 'demo-collection-centre', expectedReturnMileage: 6700,
    ...patch };
  for (const [field, value] of Object.entries(changes)) f.controller.update(field, value);
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function persisted(f, commandId = 'external', choices = f.controller.getState().choices, version = 0) {
  const account = await f.adapter.readAccount();
  return f.adapter.saveDraft({ commandId, expectedDraftVersion: version, expectedContextVersion: account.value.contextVersion, choices });
}

test('load derives trusted replacement, editable contact and sole brand, leaving decisions unselected', async () => {
  const f = await setup(); const state = await f.controller.load();
  assert.equal(state.status, 'ready'); assert.equal(state.choices.mode, 'replacement');
  assert.equal(state.choices.oldContractId, 'current:employee-paula');
  assert.equal(state.choices.brand, 'bmw'); assert.equal(state.choices.driverId, '');
  assert.equal(state.choices.contractOptionId, ''); assert.equal(state.choices.collectionLocationId, '');
  assert.equal(state.choices.requestedCollectionDate, ''); assert.equal(state.choices.contact.phone, '01632 960000');
  assert.deepEqual(state.options.collectionWindow, { min: '2026-11-12', max: '2026-12-01' });
  assert.equal(state.options.allowance.monthlyPoints, 1300); assert.equal(state.options.allowance.unit, 'points/month');
  assert.equal(state.options.drivers[1].kind, 'nominated');
  assert.equal(f.controller.update('schemeId', 'other'), false); assert.equal(f.controller.update('licence', {}), false);
  fill(f); assert.equal((await f.controller.save()).status, 'ok');
  const saved = f.controller.getState(); assert.equal(saved.availability.status, 'ok');
  assert.equal(saved.versions.draft, saved.draft.draftVersion); assert.equal(saved.versions.context, state.account.contextVersion);
  assert.equal(saved.draft.currentContract.contractId, state.choices.oldContractId);
  const snapshot = f.controller.getState(); snapshot.account.account.name = 'tampered';
  assert.notEqual(f.controller.getState().account.account.name, 'tampered');
});

test('required fields, conditional mileage and supplied driver/contract/location combinations validate inline', async () => {
  const f = await setup(); await f.controller.load();
  const missing = await f.controller.save(); assert.equal(missing.status, 'invalid');
  assert.deepEqual(Object.keys(f.controller.getState().errors).sort(), ['collectionLocationId', 'contractOptionId', 'driverId', 'expectedReturnMileage', 'requestedCollectionDate']);
  fill(f, { driverId: 'nominated:employee-paula', contractOptionId: 'twelve-month-12000' });
  assert.match(f.controller.getState().options.contractOptions[1].reason, /driver/);
  assert.equal((await f.controller.save()).status, 'invalid');
  f.controller.update('contractOptionId', 'six-month-8000');
  assert.equal(f.controller.getState().options.selectedDriver.relationship, 'spouse');
  assert.equal((await f.controller.save()).status, 'ok');
  assert.equal(f.controller.getState().draft.choices.driverId, 'nominated:employee-paula');
});

test('new order uses exact empty slot, never borrows an old car or return mileage, and reload preserves decisions', async () => {
  const f = await setup(); await makeNew(f); await f.controller.load(); fill(f, { expectedReturnMileage: null });
  assert.equal(f.controller.getState().choices.mode, 'new'); assert.equal(f.controller.getState().choices.oldContractId, null);
  assert.equal((await f.controller.save()).status, 'ok');
  const before = f.controller.getState().choices; f.controller.destroy();
  f.controller = createManualSetupController({ adapter: f.adapter });
  const loaded = await f.controller.load(); assert.deepEqual(loaded.choices, before); assert.equal(loaded.draft.draftStage, 'complete');
  f.controller.update('expectedReturnMileage', 1); assert.equal((await f.controller.save()).status, 'invalid');
});

test('calendar dates, canonical lead/renewal window, closed locations, contact and text bounds remain authoritative', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const rules = seed.assumptions.find((a) => a.key === 'manual.context.v1').value;
  rules.maximumLeadDays = 20; rules.maximumSpecialRequirements = 12;
  rules.locations[0].closedDates = ['2026-11-20'];
  const f = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  await f.controller.load(); fill(f);
  assert.deepEqual(f.controller.getState().options.collectionWindow, { min: '2026-11-12', max: '2026-11-25' });
  assert.equal((await f.controller.save()).status, 'invalid');
  assert.match(f.controller.getState().options.collectionLocations[0].reason, /Closed/);
  for (const value of ['2026-02-30', '2026-11-11', '2026-11-26', '2026-2-20']) {
    f.controller.update('requestedCollectionDate', value); assert.equal((await f.controller.save()).status, 'invalid');
    assert.ok(f.controller.getState().errors.requestedCollectionDate);
  }
  f.controller.update('requestedCollectionDate', '2026-11-21');
  f.controller.update('contact', { email: 'bad', phone: '' });
  f.controller.update('specialRequirements', 'x'.repeat(13));
  assert.equal((await f.controller.save()).status, 'invalid'); assert.ok(f.controller.getState().errors.contact);
  assert.ok(f.controller.getState().errors.specialRequirements);
  assert.equal((await persisted(f)).status, 'invalid');
});

test('missing, malformed, expired, future or wrong-category licence refuses complete save without changing history; intent still saves', async () => {
  for (const [index, mutate] of [
    (l) => { l.validUntil = '2026-11-19'; }, (l) => { l.validUntil = null; },
    (l) => { l.validFrom = '2026-11-21'; }, (l) => { l.categories = ['motorcycle']; },
    (l) => { l.source = null; }, (l) => { l.validFrom = '2026-02-30'; },
    (l) => { l.source = { ...l.source, effectiveFrom: '2026-11-06T00:00:00.000Z' }; },
  ].entries()) {
    const f = await setup(); await changeRecords(f, (r) => { mutate(r.drivers[0].licence); });
    await f.controller.load(); fill(f);
    assert.ok(f.controller.getState().options.errors.driverId, String(index));
    assert.equal((await persisted(f)).status, 'invalid');
    assert.equal((await f.service.readDraft(f.context)).status, 'not-found');
    const state = f.controller.getState(); const { mode, oldContractId, slotId, schemeId } = state.choices;
    assert.equal((await persisted(f, 'intent', { mode, oldContractId, slotId, schemeId })).status, 'ok');
    assert.equal((await f.service.browseStock(f.context)).reason, 'order-options-required');
  }
});

test('missing or unresolved monthly allowance prevents complete progression without invented conversion', async () => {
  const f = await setup(); const original = f.ports.schemeTerms;
  f.service = new ManualContextService({ ...f, ports: { ...f.ports, schemeTerms: { async read(...args) {
    const value = await original.read(...args); return ok({ ...value.value, allowance: { ...value.value.allowance, monthlyPoints: null } });
  } } } });
  await f.controller.load(); fill(f);
  assert.equal(f.controller.getState().options.allowanceReady, false);
  assert.equal((await f.controller.save()).status, 'invalid'); assert.ok(f.controller.getState().errors.allowance);
  assert.equal((await persisted(f)).code, 'allowance-unconfirmed');
});

test('URL/event hints never replace trusted identity or saved intent, and mismatches require review', async () => {
  const f = await setup(); await f.controller.load({ hint: { mode: 'new', oldContractId: null, slotId: 'other', schemeId: 'other' } });
  assert.equal(f.controller.getState().reviewRequired, true); assert.equal(f.controller.getState().choices.mode, 'replacement');
  await f.controller.refresh(); fill(f); assert.equal((await f.controller.save()).status, 'ok');
  const actual = await f.adapter.readDraft();
  f.adapter.readDraft = async () => ok({ ...actual.value, choices: { ...actual.value.choices, oldContractId: 'other-car' } });
  const state = await f.controller.load(); assert.equal(state.reviewRequired, true);
  assert.equal(state.failure.reason, 'ordering-action-changed'); assert.equal((await f.controller.save()).status, 'invalid');
});

test('duplicate progression shares one save; uncertain transport retries the exact command and payload', async () => {
  const f = await setup(); const saved = f.adapter.saveDraft; const gate = deferred(); let calls = 0; const inputs = [];
  f.adapter.saveDraft = async (input) => {
    calls += 1; inputs.push(structuredClone(input));
    if (calls === 1) { await gate.promise; await saved(input); return result('unavailable', { retryable: true }); }
    return saved(input);
  };
  await f.controller.load(); fill(f);
  const first = f.controller.save(); const duplicate = f.controller.save(); assert.equal(first, duplicate);
  assert.equal(f.controller.update('driverId', 'nominated:employee-paula'), false);
  gate.resolve(); assert.equal((await first).status, 'unavailable'); assert.equal(calls, 1);
  assert.equal(f.controller.getState().dirty, true); assert.equal(f.controller.getState().draft, null);
  assert.equal((await f.controller.save()).status, 'ok'); assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(f.controller.getState().draft.draftVersion, 1);
});

test('source/write failures keep dirty choices and explicit refresh reviews changed context', async () => {
  const f = await setup(); await f.controller.load(); fill(f); await f.controller.save();
  f.controller.update('specialRequirements', 'Keep these edits');
  const read = f.adapter.readAccount; f.adapter.readAccount = async () => result('unavailable', {});
  const failed = await f.controller.refresh(); assert.equal(failed.status, 'error'); assert.equal(failed.choices.specialRequirements, 'Keep these edits');
  assert.equal(failed.dirty, true); f.adapter.readAccount = read;
  await changeRecords(f, (r) => { r.source.sourceVersion = 'new-context'; });
  const reload = await f.controller.load(); assert.equal(reload.reviewRequired, true);
  assert.equal(reload.choices.specialRequirements, 'Keep these edits');
  const reviewed = await f.controller.refresh(); assert.equal(reviewed.reviewRequired, false);
  assert.equal(reviewed.reviewedContextVersion, reviewed.account.contextVersion);
  assert.equal((await f.controller.save()).status, 'ok');
  assert.equal(f.controller.getState().draft.currentContract.contractId, 'current:employee-paula');
});

test('stale draft CAS keeps dirty choices and requires deliberate discard to load a newer draft', async () => {
  const f = await setup(); await f.controller.load(); fill(f); await f.controller.save();
  const concurrent = { ...f.controller.getState().choices, specialRequirements: 'Other browser' };
  assert.equal((await persisted(f, 'other-browser', concurrent, 1)).status, 'ok');
  f.controller.update('specialRequirements', 'Local edits');
  assert.equal((await f.controller.save()).status, 'stale-version');
  for (let i = 0; i < 2; i += 1) {
    const state = await f.controller.refresh(); assert.equal(state.reviewRequired, true);
    assert.equal(state.choices.specialRequirements, 'Local edits'); assert.equal(state.conflictingDraft.draftVersion, 2);
    assert.equal((await f.controller.save()).status, 'invalid');
  }
  const reviewed = await f.controller.refresh({ discardEdits: true });
  assert.equal(reviewed.reviewRequired, false); assert.equal(reviewed.choices.specialRequirements, 'Other browser');
  assert.equal(reviewed.draft.currentContract.contractId, 'current:employee-paula');
});

test('dependent edits invalidate availability before saving and ignore late browse responses; contact alone does not', async () => {
  const f = await setup(); await f.controller.load(); fill(f); await f.controller.save();
  const previous = f.controller.getState().availability; const browse = f.adapter.browseStock;
  f.controller.update('contact', { phone: '01632 960005', email: 'new@example.invalid' });
  assert.deepEqual(f.controller.getState().availability, previous);
  const gate = deferred(); f.adapter.browseStock = () => gate.promise;
  const saving = f.controller.save();
  // saveDraft is asynchronous; wait until the committed draft enters the browse callback.
  while (f.controller.getState().status !== 'saved') await new Promise((done) => setImmediate(done));
  f.controller.update('requestedCollectionDate', '2026-11-21');
  assert.equal(f.controller.getState().availability, null);
  assert.match(f.controller.getState().invalidationMessage, /choices changed/i);
  gate.resolve(await browse()); await saving;
  assert.equal(f.controller.getState().availability, null);
  f.adapter.browseStock = browse;
  assert.equal((await f.controller.save()).status, 'ok');
  assert.equal(f.controller.getState().versions.draft, 3);
});

test('long and unknown source facts stay read-only, and absent configuration cannot provide local defaults', async () => {
  const f = await setup(); await changeRecords(f, (r) => { r.account.name = 'A very long name '.repeat(20); delete r.account.contact;
    r.drivers[1].relationship = null; });
  await f.controller.load(); assert.equal(f.controller.getState().choices.contact.email, '');
  assert.equal(f.controller.getState().account.account.name.length, 340);
  const account = f.controller.getState().account;
  assert.equal(deriveSetupModel({ ...account, assumptions: [] }, f.controller.getState().choices).valid, false);
});

test('context changes before first save need review, stale stock cannot progress and late reads cannot overwrite current state', async () => {
  const f = await setup(); await f.controller.load(); fill(f);
  await changeRecords(f, (r) => { r.source.sourceVersion = 'first-save-changed'; });
  assert.equal((await f.controller.load()).reviewRequired, true);
  assert.equal((await f.controller.refresh()).reviewRequired, false);
  const stockRead = f.adapter.browseStock;
  f.adapter.browseStock = async () => result('stale-version', { resource: 'manual-context', action: 'refresh' });
  assert.equal((await f.controller.save()).status, 'ok');
  assert.equal(f.controller.getState().status, 'review'); assert.equal(f.controller.getState().versions, null);
  assert.equal((await f.controller.save()).status, 'invalid');
  f.adapter.browseStock = stockRead;
  const originalRead = f.adapter.readAccount; const gate = deferred(); let calls = 0;
  const original = await originalRead();
  f.adapter.readAccount = async () => ++calls === 1 ? gate.promise : originalRead();
  const late = f.controller.refresh(); const current = await f.controller.refresh();
  gate.resolve(ok({ ...original.value, account: { ...original.value.account, name: 'Stale name' } }));
  await late; assert.notEqual(f.controller.getState().account.account.name, 'Stale name');
  assert.deepEqual(f.controller.getState(), current);
  const before = f.controller.getState(); f.controller.destroy();
  assert.equal(f.controller.update('specialRequirements', 'after destroy'), false);
  assert.deepEqual(f.controller.getState(), before);
});

test('actual HTTP adapter uses authenticated account/draft/save/stock boundary and ignores caller authority', async () => {
  const f = await setup();
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspManual: f.service,
    gcspAllowedOrigins: ['https://manual-setup.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const cookie = [f.acting.value.setCookie].flat().map((v) => v.split(';')[0]).join('; ');
  const methods = [];
  const adapter = createAccountHttpAdapter({ base: `http://127.0.0.1:${server.address().port}`,
    fetchImpl(url, options) { methods.push([options.method, new URL(url).pathname]);
      return fetch(url, { ...options, headers: { ...options.headers, cookie, Origin: 'https://manual-setup.test' } }); } });
  f.controller = createManualSetupController({ adapter, commandId: () => 'http-setup' });
  try {
    await f.controller.load(); fill(f); assert.equal((await f.controller.save()).status, 'ok');
    assert.equal(f.controller.getState().availability.status, 'ok');
    assert.ok(methods.some(([method, path]) => method === 'POST' && path.endsWith('/draft')));
    assert.ok(methods.some(([method, path]) => method === 'GET' && path.endsWith('/stock')));
  } finally { f.controller.destroy(); server.closeAllConnections(); await new Promise((done) => server.close(done)); }
});
