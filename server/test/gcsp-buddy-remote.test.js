import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime, DemoClock } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { verifyOfferToken } from '../gcsp/offers/offer-token.js';
import { stock, essential, preference } from './helpers/employee-recommendation.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const acknowledgement = (operation, status = 'confirmed') => ({ status, operationId: operation.operationId,
  runId: operation.runId, orderUuid: operation.payload.orderUuid });
const operation = (f, type = 'buddy-claim') => f.store.state.tables.pending_operations.find((row) => row.operationType === type);
const car = (f) => f.store.state.tables.stock.find((row) => row.orderUuid === f.car.orderUuid);
const keys = { stock: 'orderUuid', holds: 'holdId', claims: 'claimId', offers: 'offerId', employees: 'employeeId',
  entitlement_slots: 'entitlementSlotId', pending_operations: 'operationId' };

async function setup(t) {
  const store = createMemoryStore(); const base = createMemoryRepository({ store });
  assert.equal((await base.open()).status, 'ok'); t.after(() => base.close());
  const control = { fail: null, failIntent: null, calls: [], onExecute: null, onReconcile: null };
  const repository = { ...base, transaction: (context, cmd, work) => base.transaction(context, cmd, (tx) => work({ ...tx,
    compareAndSwap: (key, version, patch) => {
      if (control.failIntent === key.table && (patch.operationId || key.table === 'stock' && patch.available === false)) throw Error('owned intent interruption');
      if (control.fail === key.table && ['active', 'expired', 'released', 'confirmed'].includes(patch.state)) throw Error('owned write interruption');
      return tx.compareAndSwap(key, version, patch);
    },
    insert: (table, row) => {
      if (control.fail === table) throw Error('owned insert interruption');
      return tx.insert(table, row);
    },
    enqueueNotification: (row) => {
      if (control.fail === 'notification_outbox') throw Error('owned outbox interruption');
      return tx.enqueueNotification(row);
    },
    recordReceipt: (row) => {
      if (control.fail === 'expiry-receipt' && row.consumerId === 'buddy-expiry') throw Error('owned expiry receipt interruption');
      return tx.recordReceipt(row);
    },
  })) };
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'buddy-remote-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok'); const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const context = (await identity.switchPrincipal(presenter, 'demo-paula', 'paula')).value.context;
  assert.equal((await seedManualDemoContext({ repository, identity, clock, context })).status, 'ok');
  assert.equal((await clock.advance(presenter, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  const brief = new BriefService({ repository, policy, clock, identity });
  const content = { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } };
  assert.equal((await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: content })).status, 'ok');
  assert.equal((await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } })).status, 'ok');
  const candidate = stock(1);
  assert.equal((await repository.transaction(context, command('release'), (tx) => tx.insert('stock', {
    runId: context.runId, orderUuid: candidate.orderUuid, orderNumber: '9123456', configurationId: candidate.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: candidate.snapshot,
    release: { eventId: 'synthetic-release', availability: candidate.availability },
    visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null },
  }))).status, 'ok');
  const f = { store, repository, control, policy, clock, identity, presenter, context, brief, content, car: candidate };
  const adapter = { mode: 'remote' };
  for (const method of ['execute', 'reconcile']) adapter[method] = async (op) => {
    const durable = operation(f, op.operationType);
    assert.equal(durable.version, op.version); assert.equal(durable.attempts, op.attempts);
    assert.equal(store.state.tables.offers.length, op.operationType === 'buddy-claim' ? 0 : store.state.tables.offers.length);
    assert.equal(store.state.tables.event_receipts.some((row) => row.consumerId === 'command:transaction'
      && row.eventId === operation(f).idempotencyKey && row.outcome.status === 'pending'), true);
    control.calls.push({ method, operation: structuredClone(op) });
    return await control[method === 'execute' ? 'onExecute' : 'onReconcile']?.(op, f) ?? acknowledgement(op, 'unknown');
  };
  f.adapter = adapter; f.service = new BuddyHoldService({ ...f, adapter });
  const employee = store.state.tables.employees.find((row) => row.employeeId === context.employeeId);
  const slot = store.state.tables.entitlement_slots.find((row) => row.entitlementSlotId === context.entitlementSlotId);
  f.input = { commandId: 'allocate', orderUuid: candidate.orderUuid, expectedBriefVersion: 1, expectedStockVersion: 1,
    expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version };
  f.allocate = () => f.service.allocate(context, f.input);
  return f;
}

async function patch(f, table, change, selected = null) {
  const key = keys[table];
  const row = selected ?? f.store.state.tables[table].find((r) => table === 'employees' ? r.employeeId === f.context.employeeId
    : table === 'entitlement_slots' ? r.entitlementSlotId === f.context.entitlementSlotId : table === 'stock' ? r.orderUuid === f.car.orderUuid : true);
  const result = await f.repository.transaction(f.context, command(`patch:${table}:${row.version}`),
    (tx) => tx.compareAndSwap(ref(f, table, { [key]: row[key] }), row.version, change));
  assert.equal(result.status, 'ok');
}
async function tick(f, eventId = 'reconcile') {
  const time = (await f.clock.now(f.presenter)).value;
  return f.clock.tick(f.presenter, { eventId, expectedClockVersion: time.clockVersion, inputDigest: inputDigest(eventId) });
}
async function advance(f, when) {
  const time = (await f.clock.now(f.presenter)).value;
  const done = await f.clock.advance(f.presenter, { commandId: `advance:${when}`, expectedClockVersion: time.clockVersion,
    bySeconds: (Date.parse(when) - Date.parse(time.now)) / 1000 });
  assert.equal(done.status, 'ok');
}
function excluded(f, state = 'claim-pending') {
  assert.equal(f.store.state.tables.holds[0].state, state);
  assert.equal(f.store.state.tables.claims[0].state, state);
  assert.deepEqual([car(f).state, car(f).available, car(f).held, car(f).allocated], ['held', false, true, false]);
}
function noOffer(f) {
  assert.equal(f.store.state.tables.offers.length, 0); assert.equal(f.store.state.tables.notification_outbox.length, 0);
}
function offered(f) {
  assert.equal(operation(f).state, 'confirmed'); excluded(f, 'active');
  assert.equal(f.store.state.tables.offers.length, 1); assert.equal(f.store.state.tables.notification_outbox.length, 1);
  const offer = f.store.state.tables.offers[0]; const job = f.store.state.tables.notification_outbox[0];
  assert.equal(offer.expiresAt, operation(f).payload.expiresAt);
  assert.equal(offer.quoteId, operation(f).payload.quoteId); assert.equal(offer.state, 'active');
  const currentCar = operation(f).payload.quote.eligibility.currentCarComparison;
  assert.equal(currentCar.display.state, 'partial'); assert.equal(currentCar.comparisonAvailable, false);
  assert.equal(currentCar.display.model, 'Fictional BMW 320i Touring');
  assert.equal(currentCar.binding.employeeVersion, f.input.expectedEmployeeVersion);
  assert.equal(currentCar.binding.slotVersion, f.input.expectedSlotVersion);
  const url = new URL(job.payload.offerLink, 'https://demo.invalid');
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.equal(url.searchParams.get('runId'), f.context.runId);
  assert.equal(verifyOfferToken(token, { environmentId: f.context.environmentId, runId: f.context.runId, offerId: offer.offerId }, offer.tokenHash), true);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(f.store.state.tables).filter(([table]) => table !== 'notification_outbox'))).includes(token), false);
}
function released(f, state = 'expired') {
  for (const table of ['holds', 'claims', 'offers']) for (const row of f.store.state.tables[table]) assert.equal(row.state, state);
  assert.deepEqual([car(f).state, car(f).available, car(f).held, car(f).allocated], ['released', true, false, false]);
  assert.equal(f.store.state.tables.decisions.length, 0);
}

test('remote command persists authentic pending intent before execute, without an offer/token; copied contexts are refused', async (t) => {
  const f = await setup(t);
  assert.equal((await f.service.allocate({ ...f.context }, f.input)).status, 'forbidden');
  assert.equal(f.control.calls.length, 0); assert.equal(f.store.state.tables.pending_operations.length, 0);
  const outcome = await f.allocate(); assert.equal(outcome.status, 'pending'); excluded(f); noOffer(f);
  assert.equal(f.control.calls.length, 1); assert.equal(f.control.calls[0].method, 'execute');
  assert.equal(operation(f).payload.authority.principalId, f.context.principalId);
  assert.equal(operation(f).payload.expectedClaimVersion, f.store.state.tables.claims[0].version);
  const current = await f.service.readOperation(f.context, { operationId: outcome.operationId });
  assert.equal(current.status, 'ok'); assert.equal(current.value.offer, null);
  assert.equal(current.value.state, 'pending'); assert.equal(current.value.hold.state, 'claim-pending');
  assert.equal((await f.service.readOperation({ ...f.context }, { operationId: outcome.operationId })).status, 'forbidden');
  assert.equal((await f.service.readOperation(f.context, { operationId: outcome.operationId, token: 'extra' })).status, 'invalid');
});

test('confirmed valid claim atomically creates one offer/outbox; original pending receipt stays historical', async (t) => {
  const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op);
  const original = await f.allocate(); assert.equal(original.status, 'pending'); offered(f);
  const sessions = structuredClone(f.store.state.tables.identity_sessions);
  assert.deepEqual(await f.allocate(), original); offered(f); assert.equal(f.control.calls.length, 1);
  const current = await f.service.readOperation(f.context, { operationId: original.operationId });
  assert.equal(current.value.state, 'confirmed'); assert.equal(current.value.offer.state, 'active');
  for (const key of ['token', 'tokenHash', 'tokenMetadata', 'payload', 'authority']) assert.equal(JSON.stringify(current.value).includes(`"${key}"`), false);
  assert.deepEqual(f.store.state.tables.identity_sessions, sessions);
});

test('matching rejected claim retires local exclusion without an offer or decline', async (t) => {
  const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op, 'rejected');
  assert.equal((await f.allocate()).status, 'pending'); released(f, 'released'); noOffer(f);
  assert.equal(operation(f).state, 'rejected');
});

test('real backend startup reconciles unknown before confirming; restarts never issue employee sessions or duplicate offers', async (t) => {
  const f = await setup(t); const original = await f.allocate();
  const sessions = structuredClone(f.store.state.tables.identity_sessions);
  f.control.onReconcile = (op) => acknowledgement(op);
  for (let i = 0; i < 2; i++) {
    const clock = new DemoClock({ ...f, environmentId: f.context.environmentId, environmentKind: 'synthetic' });
    const service = new BuddyHoldService({ ...f, clock });
    assert.equal((await service.start()).status, 'ok');
    assert.equal((await clock.reconcileStartup()).status, 'ok');
    assert.deepEqual(await clock.reconcileStartup(), await clock.reconcileStartup()); offered(f);
  }
  assert.deepEqual(f.control.calls.map((row) => row.method), ['execute', 'reconcile']);
  assert.deepEqual(f.store.state.tables.identity_sessions, sessions); assert.deepEqual(await f.allocate(), original);
});

test('matching authoritative not-found allows execute again with the same operation identity and unchanged deadline', async (t) => {
  const f = await setup(t); const original = await f.allocate(); const deadline = operation(f).payload.expiresAt;
  f.control.onReconcile = (op) => acknowledgement(op, 'not-found'); f.control.onExecute = (op) => acknowledgement(op);
  assert.equal((await f.service.start()).status, 'ok'); assert.equal((await tick(f)).status, 'ok'); offered(f);
  assert.deepEqual(f.control.calls.map((row) => row.method), ['execute', 'reconcile', 'execute']);
  assert.equal(new Set(f.control.calls.map((row) => row.operation.operationId)).size, 1);
  assert.equal(f.store.state.tables.offers[0].expiresAt, deadline); assert.deepEqual(await f.allocate(), original);
});

test('not-found returned by execute requires a later reconcile before retry', async (t) => {
  const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op, 'not-found');
  await f.allocate(); assert.equal(f.control.calls.length, 1); excluded(f); noOffer(f);
  f.control.onReconcile = (op) => acknowledgement(op); assert.equal((await f.service.start()).status, 'ok');
  assert.equal((await tick(f)).status, 'ok'); offered(f);
});

for (const field of ['operationId', 'runId', 'orderUuid', 'status']) {
  test(`mismatched ${field} acknowledgement remains pending/excluded without extending deadline`, async (t) => {
    const f = await setup(t); f.control.onExecute = (op) => ({ ...acknowledgement(op), [field]: 'mismatched' });
    await f.allocate(); excluded(f); noOffer(f); assert.equal(operation(f).lastKnownState, 'unknown');
    const deadline = operation(f).payload.expiresAt;
    assert.equal((await f.service.start()).status, 'ok'); assert.equal((await tick(f)).status, 'ok');
    excluded(f); noOffer(f); assert.equal(operation(f).payload.expiresAt, deadline);
    assert.deepEqual(f.control.calls.map((row) => row.method), ['execute', 'reconcile']);
  });
}

test('provider exception text is discarded and a subsequent tick reconciles', async (t) => {
  const f = await setup(t); const secret = 'provider-exception-must-never-be-retained';
  f.control.onExecute = () => { throw Error(secret); };
  await f.allocate(); excluded(f); noOffer(f); assert.equal(JSON.stringify(f.store.state.tables).includes(secret), false);
  f.control.onReconcile = (op) => acknowledgement(op); assert.equal((await f.service.start()).status, 'ok');
  assert.equal((await tick(f)).status, 'ok'); offered(f);
});

const invalidations = {
  pause: async (f) => assert.equal((await f.brief.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 })).status, 'ok'),
  consent: async (f) => {
    assert.equal((await f.brief.saveDraft(f.context, { commandId: 'revised-draft', expectedBriefVersion: 1, expectedDraftVersion: 1, brief: f.content })).status, 'ok');
    assert.equal((await f.brief.confirm(f.context, { commandId: 'revised-confirm', expectedBriefVersion: 1, expectedDraftVersion: 2,
      consent: { search: true, hold: false } })).status, 'ok');
  },
  employee: (f) => patch(f, 'employees', { name: 'Changed employee source revision' }),
  slot: (f) => patch(f, 'entitlement_slots', {}),
  visibility: (f) => patch(f, 'stock', { visibility: { companyIds: [], schemeIds: [], employeeIds: [] } }),
  facts: (f) => patch(f, 'stock', { facts: stock(2).snapshot }),
  availability: (f) => patch(f, 'stock', { release: { ...car(f).release, availability: { ...car(f).release.availability, state: 'unknown' } } }),
  policy: async (f) => {
    const row = f.store.state.tables.runs.find((run) => run.runId === f.context.runId);
    assert.equal((await f.repository.transaction(f.context, command('policy-change'), (tx) => tx.compareAndSwap(ref(f, 'runs'),
      row.version, { policyVersion: 'changed-policy' }))).status, 'ok');
  },
  deadline: (f) => advance(f, operation(f).payload.expiresAt),
  terms: (f) => advance(f, operation(f).payload.quote.validUntil),
};
for (const [name, invalidate] of Object.entries(invalidations)) {
  test(`confirmed claim after ${name} change requires a durable confirmed release before stock can return`, async (t) => {
    const f = await setup(t);
    f.control.onExecute = async (op) => { await invalidate(f); return acknowledgement(op); };
    await f.allocate(); excluded(f, 'release-pending'); noOffer(f);
    assert.equal(operation(f).state, 'confirmed'); const release = operation(f, 'buddy-release'); assert.ok(release);
    const deadline = release.payload.expiresAt; assert.equal(release.payload.sourceClaimOperationId, operation(f).operationId);
    f.control.onExecute = (op) => acknowledgement(op);
    // A policy change affects clock configuration, so use a fresh backend drive through an unchanged policy port
    // only after restoring that unrelated run pin. The invalidation/release itself is already durable.
    if (name === 'policy') {
      const row = f.store.state.tables.runs.find((run) => run.runId === f.context.runId);
      assert.equal((await f.repository.transaction(f.context, command('restore-policy'), (tx) => tx.compareAndSwap(ref(f, 'runs'),
        row.version, { policyVersion: f.context.policyVersion }))).status, 'ok');
    }
    assert.equal((await f.service.start()).status, 'ok'); assert.equal((await tick(f)).status, 'ok');
    released(f, name === 'deadline' ? 'expired' : 'released'); noOffer(f);
    assert.equal(operation(f, 'buddy-release').state, 'confirmed'); assert.equal(release.payload.expiresAt, deadline);
  });
}

for (const result of ['unknown', 'rejected', 'mismatch']) {
  test(`remote expiry retains release-pending exclusion on ${result} release and later reconciles it`, async (t) => {
    const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op); await f.allocate(); offered(f);
    assert.equal((await f.service.start()).status, 'ok'); await advance(f, operation(f).payload.expiresAt);
    f.control.onExecute = (op) => result === 'mismatch' ? { ...acknowledgement(op), runId: 'other-run' } : acknowledgement(op, result);
    assert.equal((await tick(f, 'expire')).status, 'ok'); excluded(f, 'release-pending');
    assert.equal(f.store.state.tables.offers[0].state, 'release-pending');
    assert.equal(f.store.state.tables.event_receipts.filter((row) => row.consumerId === 'buddy-expiry').length, 0);
    f.control.onReconcile = (op) => acknowledgement(op);
    assert.equal((await tick(f, 'release')).status, 'ok'); released(f);
    assert.equal(f.store.state.tables.event_receipts.filter((row) => row.consumerId === 'buddy-expiry').length, 1);
    const before = structuredClone(f.store.state.tables.holds); assert.equal((await tick(f, 'again')).status, 'ok');
    assert.deepEqual(f.store.state.tables.holds, before); assert.equal(f.store.state.tables.notification_outbox.length, 1);
  });
}

test('uncertain expired claim reconciles before any release; confirmed claim then confirmed release never makes an offer', async (t) => {
  const f = await setup(t); await f.allocate(); assert.equal((await f.service.start()).status, 'ok');
  await advance(f, operation(f).payload.expiresAt); assert.equal((await tick(f, 'expired-unknown')).status, 'ok');
  excluded(f); noOffer(f); assert.equal(operation(f, 'buddy-release'), undefined);
  f.control.onReconcile = (op) => acknowledgement(op);
  assert.equal((await tick(f, 'claim-confirmed')).status, 'ok'); excluded(f, 'release-pending'); noOffer(f);
  f.control.onExecute = (op) => acknowledgement(op); assert.equal((await tick(f, 'release-confirmed')).status, 'ok'); released(f); noOffer(f);
});

test('authoritative not-found for an expired uncertain claim retires safely without executing again', async (t) => {
  const f = await setup(t); await f.allocate(); assert.equal((await f.service.start()).status, 'ok');
  await advance(f, operation(f).payload.expiresAt); f.control.onReconcile = (op) => acknowledgement(op, 'not-found');
  assert.equal((await tick(f)).status, 'ok'); released(f); noOffer(f);
  assert.deepEqual(f.control.calls.map((row) => row.method), ['execute', 'reconcile']);
});

for (const table of ['holds', 'claims', 'offers', 'notification_outbox', 'pending_operations']) {
  test(`interrupted confirmation at ${table} rolls back all offer writes and recovers through reconcile`, async (t) => {
    const f = await setup(t); f.control.onExecute = (op) => { f.control.fail = table; return acknowledgement(op); };
    await f.allocate(); excluded(f); noOffer(f); assert.equal(operation(f).state, 'pending'); assert.equal(operation(f).attempts, 1);
    f.control.fail = null; f.control.onReconcile = (op) => acknowledgement(op);
    assert.equal((await f.service.start()).status, 'ok'); assert.equal((await tick(f)).status, 'ok'); offered(f);
  });
}

for (const table of ['holds', 'claims', 'offers', 'stock', 'pending_operations', 'expiry-receipt']) {
  test(`interrupted release at ${table} retains exclusion and recovers atomically`, async (t) => {
    const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op); await f.allocate();
    assert.equal((await f.service.start()).status, 'ok'); await advance(f, operation(f).payload.expiresAt);
    f.control.onExecute = (op) => { f.control.fail = table; return acknowledgement(op); };
    assert.equal((await tick(f, 'interrupted-release')).status, 'unavailable'); excluded(f, 'release-pending');
    assert.equal(f.store.state.tables.event_receipts.filter((row) => row.consumerId === 'buddy-expiry').length, 0);
    f.control.fail = null; f.control.onReconcile = (op) => acknowledgement(op);
    assert.equal((await tick(f, 'retry-release')).status, 'ok'); released(f);
  });
}

test('operation version changed during adapter await refuses an obsolete ack; fresh reconcile can finish', async (t) => {
  const f = await setup(t); f.control.onExecute = async (op) => {
    await patch(f, 'pending_operations', { lastKnownState: 'concurrent-reconciliation' }); return acknowledgement(op);
  };
  await f.allocate(); excluded(f); noOffer(f); assert.equal(operation(f).lastKnownState, 'concurrent-reconciliation');
  f.control.onReconcile = (op) => acknowledgement(op); assert.equal((await f.service.start()).status, 'ok');
  assert.equal((await tick(f)).status, 'ok'); offered(f);
});

test('run reset during adapter await cannot confirm the historical intent or write into the new run', async (t) => {
  const f = await setup(t); f.control.onExecute = async (op) => {
    const state = (await f.clock.readState(f.presenter)).value;
    const reset = await f.clock.reset(f.presenter, { commandId: 'reset', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
    assert.equal(reset.status, 'ok'); return acknowledgement(op);
  };
  const original = await f.allocate(); assert.equal(original.status, 'pending'); noOffer(f);
  assert.equal(operation(f).state, 'pending'); assert.equal(f.store.state.tables.runs.filter((run) => run.current).length, 1);
  assert.equal((await f.service.readOperation(f.context, { operationId: original.operationId })).status, 'stale-run');
});

test('fresh confirmation after a small clock advance accepts the original still-valid terms without extending its deadline', async (t) => {
  const f = await setup(t); await f.allocate(); const deadline = operation(f).payload.expiresAt;
  const time = (await f.clock.now(f.context)).value;
  await advance(f, new Date(Date.parse(time.now) + 1000).toISOString());
  f.control.onReconcile = (op) => acknowledgement(op); assert.equal((await f.service.start()).status, 'ok');
  assert.equal((await tick(f)).status, 'ok'); offered(f); assert.equal(f.store.state.tables.offers[0].expiresAt, deadline);
});

test('remote intent and confirmed offer retain the same immutable current-car comparison snapshot', async (t) => {
  const f = await setup(t); await f.allocate();
  const pinned = structuredClone(operation(f).payload.quote.eligibility.currentCarComparison);
  assert.equal(pinned.display.state, 'partial'); assert.equal(pinned.comparisonAvailable, false);
  f.control.onReconcile = (op) => acknowledgement(op); assert.equal((await f.service.start()).status, 'ok');
  assert.equal((await tick(f)).status, 'ok'); offered(f);
  const employee = f.store.state.tables.employees.find((row) => row.employeeId === f.context.employeeId);
  const contract = structuredClone(employee.contract); contract.manualContext.contracts[0].model = 'New current source model';
  await patch(f, 'employees', { contract });
  const quote = (await f.repository.read(f.context, ref(f, 'quotes', { quoteId: operation(f).payload.quoteId }))).value;
  assert.deepEqual(quote.eligibility.currentCarComparison, pinned);
  assert.deepEqual(operation(f).payload.quote.eligibility.currentCarComparison, pinned);
});

test('release not-found reconciles before retry and retains one stable release identity', async (t) => {
  const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op); await f.allocate();
  assert.equal((await f.service.start()).status, 'ok'); await advance(f, operation(f).payload.expiresAt);
  f.control.onExecute = (op) => acknowledgement(op, 'unknown'); assert.equal((await tick(f, 'expire')).status, 'ok');
  excluded(f, 'release-pending'); f.control.onReconcile = (op) => acknowledgement(op, 'not-found');
  f.control.onExecute = (op) => acknowledgement(op); assert.equal((await tick(f, 'retry')).status, 'ok'); released(f);
  const calls = f.control.calls.filter((row) => row.operation.operationType === 'buddy-release');
  assert.deepEqual(calls.map((row) => row.method), ['execute', 'reconcile', 'execute']);
  assert.equal(new Set(calls.map((row) => row.operation.operationId)).size, 1);
});

test('current-operation read is bound to a genuine same-employee entitlement', async (t) => {
  const f = await setup(t); const original = await f.allocate();
  const other = f.store.state.tables.employees.find((row) => row.employeeId !== f.context.employeeId && row.roles.includes('employee'));
  assert.ok(other);
  const switched = await f.identity.switchPrincipal(f.presenter, other.principalId, 'other-employee');
  assert.equal(switched.status, 'ok');
  assert.equal((await f.service.readOperation(switched.value.context, { operationId: original.operationId })).status, 'forbidden');
});

test('current-operation read refuses a changed offer snapshot', async (t) => {
  const f = await setup(t); f.control.onExecute = (op) => acknowledgement(op); const original = await f.allocate();
  let changed = false;
  const repository = { ...f.repository, query: async (context, table, filter) => {
    const result = await f.repository.query(context, table, filter);
    if (table === 'offers' && !changed) { changed = true; await patch(f, 'offers', { state: 'release-pending' }); }
    return result;
  } };
  const service = new BuddyHoldService({ ...f, repository });
  assert.equal((await service.readOperation(f.context, { operationId: original.operationId })).status, 'stale-version');
});

test('a pending row without its original authenticated command receipt cannot drive an adapter', async (t) => {
  const f = await setup(t); await f.allocate();
  const forged = structuredClone(operation(f)); forged.operationId = 'unbacked-intent'; forged.idempotencyKey = 'unbacked-command';
  await patch(f, 'pending_operations', { state: 'rejected' });
  await patch(f, 'holds', { operationId: forged.operationId }); await patch(f, 'claims', { operationId: forged.operationId });
  forged.payload.expectedHoldVersion = f.store.state.tables.holds[0].version;
  forged.payload.expectedClaimVersion = f.store.state.tables.claims[0].version;
  assert.equal((await f.repository.transaction(f.context, command('unbacked-row'), (tx) => tx.insert('pending_operations', forged))).status, 'ok');
  const before = f.control.calls.length; assert.equal((await f.service.start()).status, 'ok');
  assert.equal((await tick(f)).status, 'ok'); assert.equal(f.control.calls.length, before); excluded(f); noOffer(f);
});

for (const failure of ['quotes', 'pending_operations', 'holds', 'claims', 'stock']) {
  test(`initial remote intent failure at ${failure} commits no quote/claim/intent or adapter attempt`, async (t) => {
    const f = await setup(t);
    if (['quotes', 'pending_operations'].includes(failure)) f.control.fail = failure;
    else f.control.failIntent = failure;
    assert.equal((await f.allocate()).status, 'unavailable');
    for (const table of ['quotes', 'holds', 'claims', 'offers', 'notification_outbox', 'pending_operations']) {
      assert.equal(f.store.state.tables[table].length, 0);
    }
    assert.deepEqual([car(f).state, car(f).available, car(f).held, car(f).allocated, car(f).version], ['released', true, false, false, 1]);
    assert.equal(f.control.calls.length, 0);
    f.control.fail = null; f.control.failIntent = null;
    assert.equal((await f.allocate()).status, 'pending'); excluded(f); noOffer(f);
  });
}
