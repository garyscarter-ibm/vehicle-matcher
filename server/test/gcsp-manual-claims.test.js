import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createManualClaimsService } from '../gcsp/manual-claims/index.js';
import { createSyntheticManualStockAdapter } from '../gcsp/adapters/manual-stock.js';
import { stock, fact } from './helpers/employee-recommendation.js';

const instant = '2026-11-05T09:00:00.000Z';
const cmd = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });
const ref = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
async function setup({ adapter = createSyntheticManualStockAdapter(), repository } = {}) {
  const store = createMemoryStore();
  repository ??= createMemoryRepository({ store, now: () => instant });
  assert.equal((await repository.open()).status, 'ok');
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'manual-claims', environmentKind: 'synthetic',
    policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value;
  const acting = (await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula')).value;
  const f = { repository, store, policy, clock, identity, presenter, acting, context: acting.context, adapter };
  await seedManualDemoContext(f);
  f.manual = new ManualContextService({ ...f, ports: createRepositoryManualPorts(f) });
  f.service = createManualClaimsService(f);
  const choices = { mode: 'replacement', oldContractId: `current:${f.context.employeeId}`, slotId: f.context.entitlementSlotId,
    schemeId: f.context.schemeId, driverId: `driver:${f.context.employeeId}`, contractOptionId: 'six-month-8000',
    requestedCollectionDate: '2026-11-20', collectionLocationId: 'demo-collection-centre', brand: 'bmw',
    contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: 6700, specialRequirements: '' };
  const account = await f.service.readAccount(f.context);
  assert.equal((await f.service.saveDraft(f.context, { commandId: 'draft', expectedDraftVersion: 0,
    expectedContextVersion: account.value.contextVersion, choices })).status, 'ok');
  const cars = [stock(11, { insuranceGroup: fact(25, 'insurance-group') }), stock(12, { insuranceGroup: fact(25, 'insurance-group') })];
  await repository.transaction(f.context, cmd('cars'), async (tx) => {
    for (const [i, car] of cars.entries()) {
      const stored = await tx.insert('stock', { runId: f.context.runId, orderUuid: car.orderUuid,
        orderNumber: String(i + 1).padStart(7, '0'), configurationId: car.configurationId,
        state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
        visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null },
        release: { availability: { ...car.availability, availableFrom: instant } } });
      if (stored.status !== 'ok') return stored;
    }
    return ok({ seeded: true });
  });
  return f;
}
async function selection(f, index = 0, commandId = 'claim') {
  const browsed = await f.service.browseStock(f.context);
  assert.equal(browsed.status, 'ok', JSON.stringify(browsed));
  return { commandId, ...browsed.value.cars[index].claimInput };
}
async function claim(f) { return f.service.claim(f.context, await selection(f)); }
async function action(f, commandId = 'action') {
  const current = await f.service.readClaim(f.context);
  assert.equal(current.status, 'ok', JSON.stringify(current));
  return { commandId, holdId: current.value.hold.holdId, expectedHoldVersion: current.value.hold.version,
    expectedDraftVersion: current.value.quote.draftVersion };
}
async function advance(f, bySeconds) {
  const state = (await f.clock.readState(f.presenter.context)).value;
  return f.clock.advance(f.presenter.context, { commandId: `advance-${state.clockVersion}-${bySeconds}`,
    expectedClockVersion: state.clockVersion, bySeconds });
}

test('browse never reserves; explicit claim pins exact facts, points and one server expiry without a stock VIN', async () => {
  const f = await setup(); const input = await selection(f);
  assert.equal((await f.repository.query(f.context, 'holds')).value.length, 0);
  const claimed = await f.service.claim(f.context, input);
  assert.equal(claimed.status, 'ok', JSON.stringify(claimed));
  assert.equal(claimed.value.state, 'quoted');
  assert.equal(claimed.value.hold.phase, 'preview');
  const duration = await f.policy.getAssumption('hold.cart.durationSeconds', { asOf: instant, policyVersion: f.context.policyVersion, runId: f.context.runId });
  assert.equal(Date.parse(claimed.value.hold.expiresAt) - Date.parse(instant), duration.value.value * 1000);
  assert.equal(claimed.value.quote.draftVersion, 1);
  assert.equal(claimed.value.quote.terms.points.value > 0, true);
  assert.equal(claimed.value.quote.configurationId, 'RzIxOlMx');
  assert.equal('carVIN' in claimed.value.quote, false);
  assert.deepEqual(await f.service.claim(f.context, input), claimed);
  assert.equal((await f.service.claim(f.context, { ...input, expectedStockVersion: 999 })).status, 'conflict');
  assert.equal((await f.service.readDraft(f.context)).value.requiresRefresh, false);
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 1);
  assert.equal((await f.service.readClaim(f.context)).value.hold.expiresAt, claimed.value.hold.expiresAt);
});

test('two tabs contend atomically and cannot claim a silent second car; a new command never renews the hold', async () => {
  const f = await setup(); const a = await selection(f); const b = { ...a, commandId: 'other-tab' };
  const outcomes = await Promise.all([f.service.claim(f.context, a), f.service.claim(f.context, b)]);
  assert.equal(outcomes.filter((o) => o.status === 'ok').length, 1);
  assert.equal(outcomes.filter((o) => ['conflict', 'stale-version'].includes(o.status)).length, 1);
  assert.equal((await f.repository.query(f.context, 'holds', { state: 'active' })).value.length, 1);
  const second = await selection(f, 0, 'second-car');
  assert.equal((await f.service.claim(f.context, second)).status, 'conflict');
});

test('stale draft, stock, terms and changed driver/entitlement are rejected before any hold or quote', async () => {
  for (const field of ['expectedDraftVersion', 'expectedStockVersion', 'expectedTermsDigest', 'expectedContextVersion']) {
    const f = await setup(); const input = await selection(f);
    const changed = { ...input, [field]: typeof input[field] === 'number' ? input[field] + 1 : 'stale' };
    assert.equal((await f.service.claim(f.context, changed)).status, 'stale-version', field);
    assert.equal((await f.repository.query(f.context, 'holds')).value.length, 0);
    assert.equal((await f.repository.query(f.context, 'quotes')).value.length, 0);
  }
  const f = await setup(); const input = await selection(f);
  await f.repository.transaction(f.context, cmd('disable'), async (tx) => {
    const employee = await tx.get(ref(f, 'employees', { employeeId: f.context.employeeId }));
    const manualContext = structuredClone(employee.value.contract.manualContext);
    manualContext.drivers[0].eligible = fact(false);
    return tx.compareAndSwap(ref(f, 'employees', { employeeId: f.context.employeeId }), employee.value.version, { contract: { manualContext } });
  });
  assert.notEqual((await f.service.claim(f.context, input)).status, 'ok');
  assert.equal((await f.repository.query(f.context, 'holds')).value.length, 0);
});

test('order review progresses once with its own keyed deadline; navigation/retries retain it and exact deadline expires', async () => {
  const f = await setup(); await claim(f); await advance(f, 30);
  const input = await action(f, 'review');
  const reviewed = await f.service.beginReview(f.context, input);
  assert.equal(reviewed.status, 'ok', JSON.stringify(reviewed));
  assert.equal(reviewed.value.hold.phase, 'order-review');
  const rule = await f.policy.getAssumption('hold.cart.orderReview.durationSeconds', { asOf: instant, policyVersion: f.context.policyVersion, runId: f.context.runId });
  assert.equal(Date.parse(reviewed.value.hold.expiresAt) - Date.parse(reviewed.value.hold.reviewStartedAt), rule.value.value * 1000);
  await advance(f, 10);
  assert.deepEqual(await f.service.beginReview(f.context, input), reviewed);
  const again = await f.service.beginReview(f.context, await action(f, 'review-again'));
  assert.equal(again.value.hold.expiresAt, reviewed.value.hold.expiresAt);
  await advance(f, rule.value.value - 10);
  const expired = await f.service.readClaim(f.context);
  assert.equal(expired.value.state, 'expired');
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 2);
  assert.notEqual((await f.service.allocate(f.context, input)).status, 'ok');
});

test('cancel/change/back explicitly release before replacement and saving draft cannot leak a claim', async () => {
  for (const reason of ['cancel', 'change', 'back']) {
    const f = await setup(); await claim(f);
    const draft = (await f.service.readDraft(f.context)).value;
    assert.equal((await f.service.saveDraft(f.context, { commandId: 'edit', expectedDraftVersion: 1,
      expectedContextVersion: draft.contextVersion, choices: draft.choices })).reason, 'release-required');
    const released = await f.service.release(f.context, { ...await action(f, 'release'), reason });
    assert.equal(released.status, 'ok', JSON.stringify(released)); assert.equal(released.value.state, 'released');
    assert.equal((await f.service.browseStock(f.context)).value.cars.length, 2);
    const replacement = await selection(f, 1, 'replacement');
    assert.equal((await f.service.claim(f.context, replacement)).status, 'ok');
    assert.equal((await f.repository.query(f.context, 'holds', { state: 'active' })).value.length, 1);
  }
});

test('saving atomically allocates the existing exact order, never a new vehicle identity or a second entitlement', async () => {
  const f = await setup(); const held = await claim(f);
  await f.service.beginReview(f.context, await action(f, 'review'));
  const input = await action(f, 'save');
  const saved = await f.service.allocate(f.context, input);
  assert.equal(saved.status, 'ok', JSON.stringify(saved)); assert.equal(saved.value.state, 'allocated');
  assert.equal(saved.value.hold.orderUuid, held.value.hold.orderUuid);
  assert.equal((await f.repository.query(f.context, 'stock')).value.length, 4); // two clock references + two released fixtures
  assert.equal((await f.repository.read(f.context, ref(f, 'stock', { orderUuid: held.value.hold.orderUuid }))).value.allocated, true);
  assert.deepEqual(await f.service.allocate(f.context, input), saved);
  assert.equal((await f.service.release(f.context, { ...await action(f, 'after-save'), reason: 'cancel' })).status, 'conflict');
});

test('storage unavailable, missing adapter and forged/cross-principal/run commands never report a reservation', async () => {
  const f = await setup(); const input = await selection(f);
  assert.equal((await f.service.claim({ ...f.context }, input)).status, 'forbidden');
  assert.equal((await f.service.claim(f.context, { ...input, employeeId: 'other' })).status, 'invalid');
  const unavailable = createManualClaimsService({ ...f, adapter: null });
  assert.equal((await unavailable.claim(f.context, input)).status, 'unavailable');
  await f.repository.close();
  assert.equal((await f.service.claim(f.context, input)).status, 'unavailable');
});

test('a committed claim and pinned quote survive repository/service reopening; local expiry works without a browser', async () => {
  const f = await setup(); const held = await claim(f);
  const reopened = createMemoryRepository({ store: f.store }); await reopened.open();
  const manual = new ManualContextService({ ...f, repository: reopened, ports: createRepositoryManualPorts({ ...f, repository: reopened }) });
  const service = createManualClaimsService({ ...f, repository: reopened, manual });
  assert.equal((await service.readClaim(f.context)).value.quote.quoteId, held.value.quote.quoteId);
  assert.equal((await service.registerClockHandler()).status, 'ok');
  await advance(f, 120);
  const startup = await f.clock.reconcileStartup();
  assert.equal(startup.status, 'ok', JSON.stringify(startup));
  assert.equal((await reopened.query(f.context, 'holds', { state: 'expired' })).value.length, 1);
  assert.equal((await service.readClaim(f.context)).value.state, 'expired');
});

export { setup, selection, action, advance, cmd, ref };
