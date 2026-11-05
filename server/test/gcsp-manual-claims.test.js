import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, createPostgresRepository, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createManualClaimsService } from '../gcsp/manual-claims/index.js';
import { createSyntheticManualStockAdapter } from '../gcsp/adapters/manual-stock.js';
import { stock, fact } from './helpers/employee-recommendation.js';

const instant = '2026-11-05T09:00:00.000Z';
const cmd = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });
const ref = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
async function setup({ adapter = createSyntheticManualStockAdapter(), repository, policy = createPolicyService({ provider: new FilePolicyProvider() }), modelKey = 'G21 Touring|320i' } = {}) {
  const store = createMemoryStore();
  repository ??= createMemoryRepository({ store, now: () => instant });
  assert.equal((await repository.open()).status, 'ok');
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
  const cars = [stock(11, { insuranceGroup: fact(25, 'insurance-group'), eligibilityModelKey: fact(modelKey) }),
    stock(12, { insuranceGroup: fact(25, 'insurance-group'), eligibilityModelKey: fact(modelKey) })];
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

function remoteAdapter() {
  const calls = [];
  let acknowledgement = 'pending';
  const adapter = { mode: 'remote', calls,
    set(value) { acknowledgement = value; },
    async execute(operation) { calls.push({ method: 'execute', operation: structuredClone(operation) }); return this.response(operation); },
    async reconcile(operation) { calls.push({ method: 'reconcile', operation: structuredClone(operation) }); return this.response(operation); },
    response(operation) {
      if (acknowledgement === 'throw') throw new Error('private upstream details');
      return { status: acknowledgement, operationId: operation.operationId, runId: operation.runId, orderUuid: operation.payload.orderUuid };
    } };
  return adapter;
}

test('different employees contend for the same exact stock; private claim and quote reads stay isolated', async () => {
  const f = await setup({ modelKey: 'F70 Sports Hatch|120' });
  const context = (await f.identity.switchPrincipal(f.presenter.context, 'demo-alex', 'alex')).value.context;
  await seedManualDemoContext({ ...f, context });
  const account = (await f.service.readAccount(context)).value;
  const draft = (await f.service.readDraft(f.context)).value;
  const choices = { ...draft.choices, oldContractId: `current:${context.employeeId}`, slotId: context.entitlementSlotId,
    driverId: `driver:${context.employeeId}` };
  assert.equal((await f.service.saveDraft(context, { commandId: 'alex-draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices })).status, 'ok');
  const paula = await selection(f);
  const browsed = await f.service.browseStock(context); assert.equal(browsed.value.cars.length > 0, true);
  const alex = { commandId: 'alex-claim', ...browsed.value.cars[0].claimInput };
  const [a, b] = await Promise.all([f.service.claim(f.context, paula), f.service.claim(context, alex)]);
  assert.equal([a, b].filter((o) => o.status === 'ok').length, 1);
  const winner = a.status === 'ok' ? a : b; const loser = a.status === 'ok' ? context : f.context;
  assert.equal((await f.service.readClaim(loser)).status, 'not-found');
  assert.equal((await f.service.release(loser, { commandId: 'steal', holdId: winner.value.hold.holdId,
    expectedHoldVersion: winner.value.hold.version, expectedDraftVersion: 1, reason: 'cancel' })).status, 'forbidden');
});

test('remote claim timeout persists intent before the effect, survives reopen, and retries reconcile before reallocation', async () => {
  const adapter = remoteAdapter(); adapter.set('throw');
  const f = await setup({ adapter }); const input = await selection(f);
  const response = await f.service.claim(f.context, input);
  assert.equal(response.status, 'pending');
  assert.equal(adapter.calls.length, 1); assert.equal(adapter.calls[0].method, 'execute');
  const operation = (await f.repository.query(f.context, 'pending_operations')).value[0];
  assert.equal(operation.operationId, response.operationId);
  assert.equal(operation.payload.quote.draftVersion, 1);
  assert.equal(positiveVersion(operation.payload.expectedStockVersion), true);
  assert.deepEqual(await f.service.claim(f.context, input), response);
  assert.equal(adapter.calls.filter((c) => c.method === 'execute').length, 1);
  assert.equal(adapter.calls.at(-1).method, 'reconcile');
  assert.equal((await f.service.readClaim(f.context)).value.hold.state, 'claim-pending');
  assert.equal(adapter.calls.at(-1).method, 'reconcile');
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 1);
  const reopened = createMemoryRepository({ store: f.store }); await reopened.open();
  const manual = new ManualContextService({ ...f, repository: reopened, ports: createRepositoryManualPorts({ ...f, repository: reopened }) });
  const service = createManualClaimsService({ ...f, repository: reopened, manual });
  adapter.set('confirmed');
  assert.equal((await service.readClaim(f.context)).value.hold.state, 'active');
  assert.equal(adapter.calls.filter((c) => c.method === 'execute').length, 1);
  assert.equal((await reopened.query(f.context, 'pending_operations')).value[0].state, 'completed');
});

test('concurrent identical remote commands execute one new intent; committed replay reconciles before any resend', async () => {
  const adapter = remoteAdapter(); const f = await setup({ adapter }); const input = await selection(f);
  const [a, b] = await Promise.all([f.service.claim(f.context, input), f.service.claim(f.context, input)]);
  assert.deepEqual(a, b); assert.equal(a.status, 'pending');
  assert.equal(adapter.calls.filter((c) => c.method === 'execute').length, 1);
  assert.equal((await f.repository.query(f.context, 'holds')).value.length, 1);
  assert.equal((await f.repository.query(f.context, 'pending_operations')).value.length, 1);
});

test('identical command replay also reconciles expiry, while retaining its original response and timestamp', async () => {
  const f = await setup(); const input = await selection(f); const original = await f.service.claim(f.context, input);
  await advance(f, 120);
  assert.deepEqual(await f.service.claim(f.context, input), original);
  assert.equal((await f.repository.query(f.context, 'holds', { state: 'expired' })).value.length, 1);
  assert.equal((await f.service.readClaim(f.context)).value.state, 'expired');
});
const positiveVersion = (v) => Number.isSafeInteger(v) && v > 0;

test('uncertain release stays excluded through expiry, then authoritative confirmation frees it; refusal preserves deadline', async () => {
  const adapter = remoteAdapter(); adapter.set('confirmed');
  const f = await setup({ adapter }); await claim(f);
  const held = await f.service.readClaim(f.context); const input = { ...await action(f, 'cancel'), reason: 'cancel' };
  adapter.set('pending');
  const response = await f.service.release(f.context, input); assert.equal(response.status, 'pending');
  assert.deepEqual(await f.service.release(f.context, input), response);
  await advance(f, 120);
  const uncertain = await f.service.readClaim(f.context);
  assert.equal(uncertain.status, 'pending'); assert.equal(uncertain.value.hold.state, 'release-pending');
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 1);
  assert.equal((await f.service.claim(f.context, await selection(f, 0, 'no-second'))).status, 'conflict');
  adapter.set('confirmed');
  assert.equal((await f.service.readClaim(f.context)).value.state, 'released');
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 2);
  assert.equal(held.value.hold.expiresAt, uncertain.value.hold.expiresAt);
  const second = await f.service.claim(f.context, await selection(f, 1, 'second')); assert.equal(second.status, 'pending');
  const before = (await f.service.readClaim(f.context)).value;
  adapter.set('rejected');
  assert.equal((await f.service.release(f.context, { ...await action(f, 'refused'), reason: 'back' })).status, 'pending');
  const refused = await f.service.readClaim(f.context);
  assert.equal(refused.value.state, 'quoted'); assert.equal(refused.value.hold.expiresAt, before.hold.expiresAt);
});

test('pending selection is never freed at the deadline, and confirmation atomically allocates its original order', async () => {
  const adapter = remoteAdapter(); adapter.set('confirmed'); const f = await setup({ adapter });
  await claim(f); await f.service.beginReview(f.context, await action(f, 'review'));
  adapter.set('pending');
  const input = await action(f, 'save'); const response = await f.service.allocate(f.context, input);
  assert.equal(response.status, 'pending'); await advance(f, 601);
  const waiting = await f.service.readClaim(f.context);
  assert.equal(waiting.status, 'pending'); assert.equal(waiting.value.hold.state, 'selection-pending');
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 1);
  adapter.set('confirmed'); const saved = await f.service.readClaim(f.context);
  assert.equal(saved.value.state, 'allocated');
  assert.equal((await f.repository.read(f.context, ref(f, 'stock', { orderUuid: saved.value.hold.orderUuid }))).value.allocated, true);
});

test('an uncertain remote claim is not freed by time; failed/malformed acknowledgements cannot fabricate success', async () => {
  const adapter = remoteAdapter(); const f = await setup({ adapter }); await claim(f); await advance(f, 121);
  assert.equal((await f.service.readClaim(f.context)).value.hold.state, 'claim-pending');
  adapter.response = (operation) => ({ status: 'confirmed', operationId: 'wrong', runId: operation.runId, orderUuid: operation.payload.orderUuid });
  assert.equal((await f.service.readClaim(f.context)).status, 'pending');
  adapter.response = (operation) => ({ status: 'rejected', operationId: operation.operationId, runId: operation.runId, orderUuid: operation.payload.orderUuid });
  assert.equal((await f.service.readClaim(f.context)).value.state, 'claim-failed');
  assert.equal((await f.service.browseStock(f.context)).value.cars.length, 2);
});

test('clock ticks reconcile manual expiry with no employee browser and reset refuses historical commands', async () => {
  const f = await setup(); await f.service.registerClockHandler(); const held = await claim(f); await advance(f, 120);
  const state = (await f.clock.readState(f.presenter.context)).value;
  const tick = await f.clock.tick(f.presenter.context, { eventId: 'expiry-tick', expectedClockVersion: state.clockVersion, inputDigest: inputDigest('expiry') });
  assert.equal(tick.status, 'ok', JSON.stringify(tick));
  assert.equal(tick.value.handlerOrder.some((h) => h.handlerId === 'manual-claim-expiry'), true);
  assert.equal((await f.repository.query(f.context, 'holds', { state: 'expired' })).value.length, 1);
  const current = (await f.clock.readState(f.presenter.context)).value;
  await f.clock.reset(f.presenter.context, { commandId: 'reset', expectedRunId: current.runId, expectedRunVersion: current.runVersion,
    scenarioVersion: current.versions.scenario, fixtureVersion: current.versions.fixture });
  assert.equal((await f.service.readClaim(f.context)).status, 'stale-run');
  assert.equal((await f.service.release(f.context, { commandId: 'old', holdId: held.value.hold.holdId,
    expectedHoldVersion: 1, expectedDraftVersion: 1, reason: 'cancel' })).status, 'stale-run');
});

test('HTTP composes expiry before startup and exposes truthful scoped claim/quote/pending outcomes', async () => {
  const adapter = remoteAdapter(); const f = await setup({ adapter });
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspManual: f.manual,
    gcspManualClaims: f.service, gcspAllowedOrigins: ['https://manual.test'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = async (path, body, session = f.acting, origin = 'https://manual.test') => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/manual${path}`, {
      method: body ? 'POST' : 'GET', headers: { Origin: origin, cookie: [session.setCookie].flat().map((v) => v.split(';')[0]).join('; '),
        ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, value: await r.json(), cache: r.headers.get('Cache-Control') };
  };
  try {
    assert.equal((await server.gcspStartup).status, 'ok');
    const input = await selection(f);
    const pending = await request('/claim', input); assert.equal(pending.status, 202); assert.equal(pending.cache, 'no-store');
    assert.equal((await request('/claim')).value.value.hold.state, 'claim-pending');
    assert.equal((await request('/quote')).status, 202);
    assert.equal((await request('/claim?employeeId=other')).status, 400);
    assert.equal((await request('/claim', { ...input, employeeId: 'other' })).status, 400);
    assert.equal((await request('/claim', input, f.acting, 'https://hostile.test')).status, 403);
    adapter.set('confirmed'); assert.equal((await request('/claim')).status, 200);
    const other = (await f.identity.switchPrincipal(f.presenter.context, 'demo-alex', 'alex')).value;
    assert.equal((await request('/quote', null, other)).status, 404);
    assert.equal((await request('/claim/allocate', await action(f))).status, 404);
  } finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
});

test('transaction failure rolls back quote/claim/hold/stock and intent before any remote effect', async () => {
  const adapter = remoteAdapter(); const f = await setup({ adapter }); const input = await selection(f);
  const repository = { ...f.repository, transaction(context, command, work) {
    return f.repository.transaction(context, command, async (tx) => {
      const response = await work(tx);
      return command.commandId.startsWith('manual-claims:') ? result('unavailable', { retryable: true }) : response;
    });
  } };
  const failed = createManualClaimsService({ ...f, repository });
  assert.equal((await failed.claim(f.context, input)).status, 'unavailable');
  for (const table of ['holds', 'claims', 'quotes', 'pending_operations']) assert.equal((await f.repository.query(f.context, table)).value.length, 0);
  assert.equal((await f.repository.read(f.context, ref(f, 'stock', { orderUuid: input.orderUuid }))).value.state, 'released');
  assert.equal(adapter.calls.length, 0);
  assert.equal((await f.service.claim(f.context, input)).status, 'pending');
});

test('concurrent draft edits and changed authoritative employee records cannot bypass transactional revalidation', async () => {
  const f = await setup(); const input = await selection(f);
  const repository = { ...f.repository, async transaction(context, command, work) {
    if (command.commandId === `manual:${context.employeeId}:edit-race`) await f.service.claim(context, input);
    return f.repository.transaction(context, command, work);
  } };
  const manual = new ManualContextService({ ...f, repository, ports: createRepositoryManualPorts({ ...f, repository }) });
  const draft = (await f.service.readDraft(f.context)).value;
  const response = await manual.saveDraft(f.context, { commandId: 'edit-race', expectedDraftVersion: 1,
    expectedContextVersion: draft.contextVersion, choices: { ...draft.choices, driverId: `nominated:${f.context.employeeId}` } });
  assert.equal(response.reason, 'release-required');
  assert.equal((await f.service.readDraft(f.context)).value.draftVersion, 1);

  const g = await setup(); const selected = await selection(g); let changed = false;
  const changing = { ...g.repository, async transaction(context, command, work) {
    if (!changed && command.commandId.startsWith('manual-claims:')) {
      changed = true;
      await g.repository.transaction(context, cmd('authority-change'), (tx) => tx.compareAndSwap(
        ref(g, 'employees', { employeeId: context.employeeId }), 2, { gradeId: 'G1-6' }));
    }
    return g.repository.transaction(context, command, work);
  } };
  const service = createManualClaimsService({ ...g, repository: changing });
  assert.equal((await service.claim(g.context, selected)).reason, 'employee-authority-changed');
  assert.equal((await g.repository.query(g.context, 'holds')).value.length, 0);
});

test('a changed driver or stale stock during order review refuses allocation but still permits explicit release', async () => {
  const f = await setup(); await claim(f); await f.service.beginReview(f.context, await action(f, 'review'));
  const input = await action(f, 'save');
  await f.repository.transaction(f.context, cmd('driver-no-longer-eligible'), async (tx) => {
    const employee = await tx.get(ref(f, 'employees', { employeeId: f.context.employeeId }));
    const contract = structuredClone(employee.value.contract); contract.manualContext.drivers[0].eligible = fact(false);
    return tx.compareAndSwap(ref(f, 'employees', { employeeId: f.context.employeeId }), employee.value.version, { contract });
  });
  assert.notEqual((await f.service.allocate(f.context, input)).status, 'ok');
  const current = await f.service.readClaim(f.context); assert.equal(current.value.state, 'quoted');
  assert.equal((await f.service.release(f.context, { ...await action(f, 'cancel-after-change'), reason: 'cancel' })).value.state, 'released');
  const g = await setup(); const original = await claim(g); await g.service.beginReview(g.context, await action(g, 'review'));
  await g.repository.transaction(g.context, cmd('stock-changed'), async (tx) => {
    const stock = await tx.get(ref(g, 'stock', { orderUuid: original.value.hold.orderUuid }));
    return tx.compareAndSwap(ref(g, 'stock', { orderUuid: original.value.hold.orderUuid }), stock.value.version, { revision: 'new-source-revision' });
  });
  const stale = await g.service.allocate(g.context, await action(g, 'save'));
  assert.equal(stale.status, 'stale-version'); assert.equal(stale.resource, 'stock');
  assert.equal((await g.service.readClaim(g.context)).value.state, 'quoted');
});

test('only authoritative absence permits resending the same pending operation; late claim confirmation first releases overdue stock', async () => {
  const adapter = remoteAdapter(); const f = await setup({ adapter }); const original = await claim(f);
  adapter.reconcile = async (operation) => { adapter.calls.push({ method: 'reconcile', operation }); return {
    status: 'not-found', operationId: operation.operationId, runId: operation.runId, orderUuid: operation.payload.orderUuid }; };
  adapter.set('confirmed');
  assert.equal((await f.service.readClaim(f.context)).value.state, 'quoted');
  const executions = adapter.calls.filter((c) => c.method === 'execute');
  assert.equal(executions.length, 2); assert.equal(executions[0].operation.operationId, executions[1].operation.operationId);
  assert.equal(executions[0].operation.operationId, original.operationId);

  const slow = remoteAdapter(); const g = await setup({ adapter: slow }); await claim(g); await advance(g, 121);
  slow.set('confirmed');
  const overdue = await g.service.readClaim(g.context);
  assert.equal(overdue.value.state, 'expired');
  assert.equal(slow.calls.filter((c) => c.method === 'execute' && c.operation.operationType === 'manual-release').length, 1);
  assert.equal((await g.service.browseStock(g.context)).value.cars.length, 2);
});

test('presentation fixtures assert actual quoted, released, expired, conflict, unavailable and pending responses', async () => {
  const expected = JSON.parse(await readFile(new URL('./fixtures/gcsp/manual-claims-presentation.json', import.meta.url), 'utf8'));
  const projection = (outcome) => ({ status: outcome.status, state: outcome.value?.state ?? null,
    view: (outcome.value?.view ?? outcome.view)?.state ?? null, action: (outcome.value?.view ?? outcome.view)?.action ?? null });
  const f = await setup(); const held = await claim(f);
  assert.deepEqual(projection(held), expected.quoted);
  assert.deepEqual(projection(await f.service.claim(f.context, await selection(f, 0, 'conflict'))), expected.conflict);
  assert.deepEqual(projection(await f.service.release(f.context, { ...await action(f, 'cancel'), reason: 'cancel' })), expected.released);
  await f.service.claim(f.context, await selection(f, 0, 'again')); await advance(f, 120);
  assert.deepEqual(projection(await f.service.readClaim(f.context)), expected.expired);
  const unavailable = createManualClaimsService({ ...f, adapter: null });
  assert.deepEqual(projection(await unavailable.readClaim(f.context)), expected.unavailable);
  const g = await setup({ adapter: remoteAdapter() }); await claim(g);
  assert.deepEqual(projection(await g.service.readClaim(g.context)), expected.pending);
});

test('a concurrent hold revision during reload refuses a torn success projection', async () => {
  const f = await setup(); await claim(f); let changed = false;
  const repository = { ...f.repository, async read(context, reference) {
    const found = await f.repository.read(context, reference);
    if (!changed && reference.table === 'holds' && found.status === 'ok') {
      changed = true;
      await f.repository.transaction(context, cmd('concurrent-revision'), (tx) => tx.compareAndSwap(reference, found.value.version, {}));
    }
    return found;
  } };
  const service = createManualClaimsService({ ...f, repository });
  const outcome = await service.readClaim(f.context);
  assert.equal(outcome.status, 'stale-version'); assert.equal(outcome.resource, 'hold');
  assert.equal((await service.readClaim(f.context)).value.state, 'quoted');
});

let nativeSerial = 0;
async function nativeFixture() {
  const schema = `gcsp_manual_${process.pid}_${++nativeSerial}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 2,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 15000 });
  pool.on('error', () => {});
  try { await pool.query(`CREATE SCHEMA "${schema}"`); }
  catch { await pool.end(); assert.fail('Configured PostgreSQL manual-claim fixture is unavailable.'); }
  const repositories = []; const policies = []; let session = 0;
  const resources = () => {
    const repository = createPostgresRepository({ schema });
    // Every policy read uses the same exact owned namespace as transaction storage.
    const policy = createPolicyService({ schema });
    repositories.push(repository); policies.push(policy);
    return { repository, policy };
  };
  return { schema, pool,
    async create(adapter) { return setup({ ...resources(), ...(adapter ? { adapter } : {}) }); },
    async reopen(f) {
      await f.repository.close(); await f.policy.close();
      const { repository, policy } = resources();
      assert.equal((await repository.open()).status, 'ok');
      const runtime = await createDemoRuntime({ repository, policy, environmentId: 'manual-claims', environmentKind: 'synthetic',
        policyAsOf: instant, commandId: 'bootstrap', sessionNow: () => instant });
      assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
      const { clock, identity } = runtime.value;
      const id = ++session;
      const presenter = (await identity.createPresenterSession(`restart-presenter-${id}`)).value;
      const acting = (await identity.switchPrincipal(presenter.context, 'demo-paula', `restart-paula-${id}`)).value;
      const reopened = { repository, policy, clock, identity, presenter, acting, context: acting.context, adapter: f.adapter };
      reopened.manual = new ManualContextService({ ...reopened, ports: createRepositoryManualPorts(reopened) });
      reopened.service = createManualClaimsService(reopened);
      assert.equal(reopened.context.runId, f.context.runId);
      return reopened;
    },
    processRead(f, holdId) {
      try {
        return JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./helpers/manual-claim-reopen.js', import.meta.url)),
          schema, f.context.runId, f.context.environmentId, holdId], { encoding: 'utf8', timeout: 20000, maxBuffer: 65536,
          stdio: ['ignore', 'pipe', 'pipe'] }));
      } catch { assert.fail('Configured PostgreSQL manual-claim process reopen is unavailable.'); }
    },
    async cleanup() {
      try {
        for (const repository of repositories) await repository.close();
        for (const policy of policies) await policy.close();
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        const absent = await pool.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1', [schema]);
        assert.equal(absent.rows[0].count, 0, 'The exact owned synthetic manual-claim schema must be absent.');
      } finally { await pool.end(); }
    },
  };
}
const nativeOptions = { skip: process.env.GCSP_DATABASE_URL === undefined ? 'GCSP_DATABASE_URL is unset; native manual lifecycle was not run' : false };

test('native PostgreSQL manual claims persist claim replay and confirmed release across reopen', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    let f = await fixture.create();
    const selected = await selection(f); const held = await f.service.claim(f.context, selected);
    assert.equal(held.status, 'ok', JSON.stringify(held));
    const persisted = fixture.processRead(f, held.value.hold.holdId);
    assert.equal(persisted.draft.draftVersion, 1);
    assert.deepEqual(persisted.quote, held.value.quote);
    assert.equal(persisted.hold.expiresAt, held.value.hold.expiresAt);
    assert.equal(persisted.claims.length, 1); assert.equal(persisted.claims[0].state, 'active');
    assert.equal(persisted.stock.state, 'held'); assert.equal(persisted.operations.length, 0);
    f = await fixture.reopen(f);
    assert.equal((await f.service.readClaim(f.context)).value.hold.expiresAt, held.value.hold.expiresAt);
    assert.deepEqual(await f.service.claim(f.context, selected), held);
    assert.equal((await f.service.release(f.context, { ...await action(f, 'native-release'), reason: 'back' })).value.state, 'released');
    const released = fixture.processRead(f, held.value.hold.holdId);
    assert.equal(released.hold.state, 'released'); assert.equal(released.claims[0].state, 'released');
    assert.equal(released.stock.state, 'released'); assert.equal(released.stock.available, true);
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL manual claims retain once-only keyed review and expire at exact startup deadline', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    let f = await fixture.create();
    const second = await f.service.claim(f.context, await selection(f, 0, 'native-review-claim'));
    assert.equal(second.status, 'ok', JSON.stringify(second));
    const reviewInput = await action(f, 'native-review');
    const reviewed = await f.service.beginReview(f.context, reviewInput);
    assert.equal(reviewed.status, 'ok', JSON.stringify(reviewed));
    const read = { runId: f.context.runId, asOf: instant, policyVersion: f.context.policyVersion };
    const previewRule = await f.policy.getAssumption('hold.cart.durationSeconds', read);
    const reviewRule = await f.policy.getAssumption('hold.cart.orderReview.durationSeconds', read);
    assert.equal(Date.parse(second.value.hold.expiresAt) - Date.parse(instant), previewRule.value.value * 1000);
    assert.equal(Date.parse(reviewed.value.hold.expiresAt) - Date.parse(reviewed.value.hold.reviewStartedAt), reviewRule.value.value * 1000);
    f = await fixture.reopen(f);
    assert.deepEqual(await f.service.beginReview(f.context, reviewInput), reviewed);
    const nextReview = await f.service.beginReview(f.context, await action(f, 'native-review-new-command'));
    assert.equal(nextReview.status, 'ok', JSON.stringify(nextReview));
    assert.equal(nextReview.value.hold.expiresAt, reviewed.value.hold.expiresAt);
    assert.equal((await f.service.registerClockHandler()).status, 'ok');
    assert.equal((await advance(f, reviewRule.value.value)).status, 'ok');
    assert.equal((await f.clock.reconcileStartup()).status, 'ok');
    const expired = fixture.processRead(f, reviewed.value.hold.holdId);
    assert.equal(expired.hold.state, 'expired'); assert.equal(expired.claims[0].state, 'expired');
    assert.equal(expired.stock.state, 'released'); assert.equal(expired.stock.available, true);
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL manual claims expire on explicit tick and remain expired after reopen', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    let f = await fixture.create();
    const previewRule = await f.policy.getAssumption('hold.cart.durationSeconds', {
      runId: f.context.runId, asOf: instant, policyVersion: f.context.policyVersion });
    assert.equal((await f.service.registerClockHandler()).status, 'ok');
    const tickHold = await f.service.claim(f.context, await selection(f, 0, 'native-tick-claim'));
    assert.equal(tickHold.status, 'ok', JSON.stringify(tickHold));
    assert.equal((await advance(f, previewRule.value.value)).status, 'ok');
    const state = (await f.clock.readState(f.presenter.context)).value;
    const tick = await f.clock.tick(f.presenter.context, { eventId: 'native-expiry-tick', expectedClockVersion: state.clockVersion,
      inputDigest: inputDigest('native-expiry') });
    assert.equal(tick.status, 'ok', JSON.stringify(tick));
    assert.equal(fixture.processRead(f, tickHold.value.hold.holdId).hold.state, 'expired');
    f = await fixture.reopen(f);
    assert.equal((await f.service.readClaim(f.context)).value.state, 'expired');
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL manual claims allocate the same order and replay after reopen', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    let f = await fixture.create();
    const final = await f.service.claim(f.context, await selection(f, 0, 'native-allocate-claim'));
    assert.equal((await f.service.beginReview(f.context, await action(f, 'native-allocate-review'))).status, 'ok');
    const saveInput = await action(f, 'native-save'); const saved = await f.service.allocate(f.context, saveInput);
    assert.equal(saved.status, 'ok', JSON.stringify(saved)); assert.equal(saved.value.state, 'allocated');
    f = await fixture.reopen(f);
    assert.deepEqual(await f.service.allocate(f.context, saveInput), saved);
    const allocated = fixture.processRead(f, final.value.hold.holdId);
    assert.equal(allocated.hold.orderUuid, final.value.hold.orderUuid);
    assert.equal(allocated.claims[0].state, 'allocated'); assert.equal(allocated.stock.state, 'allocated');
    assert.equal(allocated.stock.allocated, true); assert.equal(allocated.stock.available, false);
    const slot = await f.repository.read(f.context, ref(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId }));
    assert.equal(slot.value.state, 'allocated');
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL SQL failure rolls back manual intent before external effects', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    const adapter = remoteAdapter(); const f = await fixture.create(adapter);
    const input = await selection(f); const before = await f.repository.read(f.context, ref(f, 'stock', { orderUuid: input.orderUuid }));
    await fixture.pool.query(`CREATE FUNCTION "${fixture.schema}".fail_manual_intent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic manual rollback checkpoint'; END; $$;
      CREATE TRIGGER synthetic_manual_failure BEFORE INSERT ON "${fixture.schema}".pending_operations
        FOR EACH ROW EXECUTE FUNCTION "${fixture.schema}".fail_manual_intent()`);
    try {
      const failed = await f.service.claim(f.context, input);
      assert.equal(failed.status, 'unavailable');
      assert.doesNotMatch(JSON.stringify(failed), /Synthetic manual rollback checkpoint|postgres:/);
      for (const table of ['holds', 'claims', 'quotes', 'pending_operations']) assert.equal((await f.repository.query(f.context, table)).value.length, 0);
      assert.deepEqual(await f.repository.read(f.context, ref(f, 'stock', { orderUuid: input.orderUuid })), before);
      assert.equal(adapter.calls.length, 0);
    } finally {
      await fixture.pool.query(`DROP TRIGGER synthetic_manual_failure ON "${fixture.schema}".pending_operations;
        DROP FUNCTION "${fixture.schema}".fail_manual_intent()`);
    }
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL uncertain claim persists across reopen until authoritative confirmation', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    const adapter = remoteAdapter(); let f = await fixture.create(adapter);
    const input = await selection(f);
    const pending = await f.service.claim(f.context, input); assert.equal(pending.status, 'pending');
    const first = await f.service.readClaim(f.context); const holdId = first.value.hold.holdId;
    const persisted = fixture.processRead(f, holdId);
    assert.equal(persisted.hold.state, 'claim-pending'); assert.equal(persisted.claims[0].state, 'claim-pending');
    assert.equal(persisted.stock.state, 'held'); assert.equal(persisted.operations[0].operationId, pending.operationId);
    assert.deepEqual(persisted.operations[0].payload.quote, persisted.quote);
    f = await fixture.reopen(f);
    assert.equal((await f.service.readClaim(f.context)).status, 'pending');
    assert.equal(adapter.calls.filter((call) => call.method === 'execute').length, 1);
    adapter.set('confirmed'); assert.equal((await f.service.readClaim(f.context)).value.state, 'quoted');
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL uncertain release excludes stock past deadline and reopen until confirmed freedom', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    const adapter = remoteAdapter(); adapter.set('confirmed');
    let f = await fixture.create(adapter);
    assert.equal((await claim(f)).status, 'pending');
    const first = await f.service.readClaim(f.context);
    assert.equal(first.value.state, 'quoted');
    const holdId = first.value.hold.holdId;
    const previewRule = await f.policy.getAssumption('hold.cart.durationSeconds', {
      runId: f.context.runId, asOf: instant, policyVersion: f.context.policyVersion });
    adapter.set('pending');
    assert.equal((await f.service.release(f.context, { ...await action(f, 'native-remote-release'), reason: 'change' })).status, 'pending');
    assert.equal((await advance(f, previewRule.value.value + 1)).status, 'ok');
    assert.equal((await f.service.readClaim(f.context)).value.state, 'release-pending');
    const uncertainRelease = fixture.processRead(f, holdId);
    assert.equal(uncertainRelease.stock.available, false); assert.equal(uncertainRelease.claims[0].state, 'release-pending');
    f = await fixture.reopen(f);
    assert.equal((await f.service.browseStock(f.context)).value.cars.length, 1);
    adapter.set('confirmed'); assert.equal((await f.service.readClaim(f.context)).value.state, 'released');
    assert.equal(fixture.processRead(f, holdId).stock.available, true);
  } finally { await fixture.cleanup(); }
});

test('native PostgreSQL uncertain selection persists past deadline and restart until authoritative allocation', nativeOptions, async () => {
  const fixture = await nativeFixture();
  try {
    const adapter = remoteAdapter(); adapter.set('confirmed');
    let f = await fixture.create(adapter);
    const final = await f.service.claim(f.context, await selection(f, 0, 'native-remote-final'));
    assert.equal(final.status, 'pending', JSON.stringify(final));
    const held = await f.service.readClaim(f.context);
    assert.equal(held.value.state, 'quoted');
    const holdId = held.value.hold.holdId;
    const reviewRule = await f.policy.getAssumption('hold.cart.orderReview.durationSeconds', {
      runId: f.context.runId, asOf: instant, policyVersion: f.context.policyVersion });
    assert.equal((await f.service.beginReview(f.context, await action(f, 'native-remote-review'))).status, 'ok');
    adapter.set('pending');
    assert.equal((await f.service.allocate(f.context, await action(f, 'native-remote-save'))).status, 'pending');
    assert.equal((await advance(f, reviewRule.value.value + 1)).status, 'ok');
    assert.equal((await f.service.readClaim(f.context)).value.state, 'selection-pending');
    f = await fixture.reopen(f);
    const uncertainSelection = fixture.processRead(f, holdId);
    assert.equal(uncertainSelection.hold.state, 'selection-pending'); assert.equal(uncertainSelection.stock.available, false);
    adapter.set('confirmed'); const saved = await f.service.readClaim(f.context);
    assert.equal(saved.value.state, 'allocated');
    const allocated = fixture.processRead(f, holdId);
    assert.equal(allocated.stock.orderUuid, held.value.hold.orderUuid); assert.equal(allocated.stock.state, 'allocated');
    assert.equal(allocated.claims[0].state, 'allocated');
    assert.equal(allocated.operations.filter((operation) => operation.state === 'pending').length, 0);
  } finally { await fixture.cleanup(); }
});
