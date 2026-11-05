import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';

const command = (commandId, value = commandId) => ({ commandId, inputDigest: inputDigest(value) });
const scope = (runId) => ({ runId, environmentId: 'clock-test', principalId: 'trusted-bootstrap', roles: [] });

test('atomic run transition rolls back failed fixture rows and retains one current run', async () => {
  const repository = createMemoryRepository({ store: createMemoryStore() });
  await repository.open();
  const first = { runId: 'first', environmentId: 'clock-test', status: 'active', current: true };
  const seeded = await repository.resetRun(scope('first'), command('bootstrap'), {
    expectedCurrentRunId: null, nextRun: first, rows: [['employees', { employeeId: 'person' }]],
  });
  assert.equal(seeded.status, 'ok');
  const bad = await repository.resetRun(scope('first'), command('bad-reset'), {
    expectedCurrentRunId: 'first', expectedRunVersion: 1,
    nextRun: { ...first, runId: 'bad' }, rows: [['entitlement_slots', { entitlementSlotId: 'orphan', employeeId: 'missing', capacity: 1 }]],
  });
  assert.equal(bad.status, 'conflict');
  assert.equal((await repository.currentRun('clock-test')).value.runId, 'first');
  assert.equal((await repository.read(scope('bad'), { table: 'runs', key: { runId: 'bad' } })).status, 'not-found');
  const next = { ...first, runId: 'second' };
  const payload = { expectedCurrentRunId: 'first', expectedRunVersion: 1, nextRun: next, rows: [['employees', { employeeId: 'person' }]] };
  const result = await repository.resetRun(scope('first'), command('reset'), payload);
  assert.equal(result.status, 'ok');
  assert.equal((await repository.currentRun('clock-test')).value.runId, 'second');
  assert.equal((await repository.read(scope('first'), { table: 'runs', key: { runId: 'first' } })).value.status, 'historical');
  assert.equal((await repository.query(scope('first'), 'employees')).value.length, 1);
  assert.deepEqual(await repository.resetRun(scope('first'), command('reset'), payload), result);
  assert.equal((await repository.transaction(scope('first'), command('old-decision'), (tx) => tx.insert('decisions', { runId: 'first', decisionId: 'old' }))).status, 'stale-run');
});

async function setup({ policy = createPolicyService() } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'clock-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z', secureCookies: true });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  assert.equal(presenter.status, 'ok');
  const employee = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'employee');
  return { store, repository, policy, clock, identity, presenter: presenter.value.context, session: presenter, employee: employee.value.context };
}
const resetCommand = (state, commandId = 'reset') => ({ commandId, expectedRunId: state.runId, expectedRunVersion: state.runVersion,
  scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });

test('injected repository clock advances by step or named time and presenter alone reads/changes it', async () => {
  const f = await setup();
  const initial = (await f.clock.readState(f.presenter)).value;
  assert.equal(initial.now, '2026-11-05T09:00:00.000Z');
  assert.deepEqual((await f.clock.now(f.employee)).value, { now: initial.now, runId: initial.runId, clockVersion: '1' });
  assert.equal((await f.clock.advance(f.employee, { commandId: 'forged', expectedClockVersion: '1', bySeconds: 60 })).status, 'forbidden');
  assert.equal((await f.clock.readState(f.employee)).status, 'forbidden');
  assert.equal((await f.clock.readState({ ...f.presenter })).status, 'forbidden');
  const step = { commandId: 'step', expectedClockVersion: '1', bySeconds: 60 };
  const advanced = await f.clock.advance(f.presenter, step);
  assert.equal(advanced.value.now, '2026-11-05T09:01:00.000Z');
  assert.equal(advanced.value.clockVersion, '2');
  assert.deepEqual(await f.clock.advance(f.presenter, step), advanced);
  assert.equal((await f.clock.advance(f.presenter, { ...step, bySeconds: 120 })).status, 'conflict');
  assert.equal((await f.clock.advance(f.presenter, { commandId: 'stale', expectedClockVersion: '1', bySeconds: 1 })).status, 'stale-version');
  assert.equal((await f.clock.advance(f.presenter, { commandId: 'back', expectedClockVersion: '2', to: initial.now })).status, 'invalid');
  assert.equal((await f.clock.advance(f.presenter, { commandId: 'both', expectedClockVersion: '2', bySeconds: 1, to: 'release' })).status, 'invalid');
  const named = await f.clock.advance(f.presenter, { commandId: 'named', expectedClockVersion: '2', to: 'release' });
  assert.equal(named.value.now, '2026-11-05T09:30:00.000Z');
  assert.equal((await f.repository.currentRun('clock-test')).value.clockInstant, named.value.now);
});

test('reset restores versioned employees/time and new allocator identifiers while history and corpus remain intact', async () => {
  const f = await setup();
  const before = (await f.clock.readState(f.presenter)).value;
  const oldScope = { ...scope(before.runId), ...f.presenter };
  const stock = (await f.repository.query(oldScope, 'stock')).value;
  assert.equal(stock.length, 2);
  await f.repository.transaction(oldScope, command('employee-change'), (tx) => tx.compareAndSwap({ table: 'employees', key: { runId: before.runId, employeeId: f.employee.employeeId } }, 1, { name: 'Changed during trial' }));
  const corpus = stock.map((row) => row.configurationId);
  const input = resetCommand(before);
  assert.equal((await f.clock.reset(f.employee, input)).status, 'forbidden');
  const reset = await f.clock.reset(f.presenter, input);
  assert.equal(reset.status, 'ok', JSON.stringify(reset));
  assert.notEqual(reset.value.runId, before.runId);
  assert.equal(reset.value.now, '2026-11-05T09:00:00.000Z');
  assert.deepEqual(await f.clock.reset(f.presenter, input), reset);
  const fresh = await f.identity.createPresenterSession('new-presenter');
  const after = (await f.clock.readState(fresh.value.context)).value;
  const currentStock = (await f.repository.query(fresh.value.context, 'stock')).value;
  assert.deepEqual(currentStock.map((row) => row.configurationId), corpus);
  for (let i = 0; i < stock.length; i++) {
    assert.notEqual(stock[i].orderUuid, currentStock[i].orderUuid);
    assert.notEqual(stock[i].orderNumber, currentStock[i].orderNumber);
    assert.match(currentStock[i].orderUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(currentStock[i].orderNumber, /^[0-9]{7}$/);
    assert.equal(currentStock[i].vin, undefined);
  }
  assert.equal((await f.repository.read(fresh.value.context, { table: 'employees', key: { runId: after.runId, employeeId: f.employee.employeeId } })).value.name, 'Paula (fictional)');
  assert.equal((await f.repository.read(oldScope, { table: 'employees', key: { runId: before.runId, employeeId: f.employee.employeeId } })).value.name, 'Changed during trial');
  assert.deepEqual((await f.repository.query(oldScope, 'stock')).value, stock);
  assert.equal((await f.clock.now(f.employee)).status, 'stale-run');
  assert.equal((await f.clock.readState(f.presenter)).status, 'stale-run');
});


test('concurrent/stale resets have one winner and never partly retire or seed runs', async () => {
  const f = await setup();
  const before = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.reset(f.presenter, { ...resetCommand(before), expectedRunVersion: before.runVersion + 1 })).status, 'stale-version');
  assert.equal((await f.repository.currentRun('clock-test')).value.runId, before.runId);
  const results = await Promise.all([f.clock.reset(f.presenter, resetCommand(before, 'one')), f.clock.reset(f.presenter, resetCommand(before, 'two'))]);
  assert.equal(results.filter((row) => row.status === 'ok').length, 1);
  assert.equal(results.filter((row) => row.status === 'stale-run').length, 1);
  assert.equal(f.store.state.tables.runs.length, 2);
  assert.equal(f.store.state.tables.runs.filter((row) => row.current).length, 1);
});

test('canonical scenario changes affect clock/reset and operational providers cannot be seeded', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const scenario = seed.assumptions.find((row) => row.key === 'clock.scenario.v1').value;
  scenario.startsAt = '2026-11-06T10:00:00.000Z';
  scenario.namedTimes.release = '2026-11-06T10:30:00.000Z';
  const f = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  const before = (await f.clock.readState(f.presenter)).value;
  assert.equal(before.now, '2026-11-06T10:00:00.000Z');
  const moved = await f.clock.advance(f.presenter, { commandId: 'new-cue', expectedClockVersion: '1', to: 'release' });
  assert.equal(moved.value.now, '2026-11-06T10:30:00.000Z');
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.reset(f.presenter, resetCommand(state))).value.now, '2026-11-06T10:00:00.000Z');
  const repository = createMemoryRepository({ store: createMemoryStore() });
  await repository.open();
  const refused = await createDemoRuntime({ repository, policy: createPolicyService(), environmentId: 'real', environmentKind: 'operational',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'never', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(refused.status, 'forbidden');
  assert.equal((await repository.currentRun('real')).status, 'not-found');
});

const register = async (f, handlers) => {
  for (const [handlerId, stage, handle] of handlers) assert.equal((await f.clock.registerHandler({ handlerId, stage, handle })).status, 'ok');
};
const tickCommand = (eventId = 'tick-one', expectedClockVersion = '1') => ({ eventId, expectedClockVersion, inputDigest: inputDigest({ cue: eventId }) });

test('ticks record policy stage/id order and durable event outcomes, including replay after reopening', async () => {
  const f = await setup();
  const handles = (handlerId) => async ({ transaction, context, eventId, operationId, now }) => transaction(async (tx) => {
    const written = await tx.insert('decisions', { runId: context.runId, decisionId: handlerId, commandId: operationId, outcome: { eventId, now } });
    return written.status === 'ok' ? ok({ recorded: handlerId }) : written;
  });
  const handlers = [['z-expiry', 'manual-expiry', handles('z-expiry')], ['release', 'release-pull', handles('release')],
    ['a-expiry', 'manual-expiry', handles('a-expiry')], ['reconcile', 'pending-reconciliation', handles('reconcile')]];
  await register(f, handlers);
  assert.equal((await f.clock.registerHandler({ handlerId: 'release', stage: 'release-pull', handle: handles('duplicate') })).status, 'invalid');
  assert.equal((await f.clock.registerHandler({ handlerId: 'unknown', stage: 'timer', handle: handles('unknown') })).status, 'invalid');
  assert.equal((await f.clock.tick(f.employee, tickCommand())).status, 'forbidden');
  const outcome = await f.clock.tick(f.presenter, tickCommand());
  assert.equal(outcome.status, 'ok');
  assert.deepEqual(outcome.value.handlerOrder.map((row) => row.handlerId), ['release', 'a-expiry', 'z-expiry', 'reconcile']);
  assert.deepEqual(outcome.value.missingStages, ['buddy-expiry', 'buddy-allocation', 'outbox-dispatch']);
  assert.equal(outcome.value.state, 'completed');
  assert.equal((await f.repository.query(f.presenter, 'decisions')).value.length, 4);
  assert.equal((await f.clock.registerHandler({ handlerId: 'late', stage: 'manual-expiry', handle: handles('late') })).status, 'invalid');
  assert.deepEqual(await f.clock.tick(f.presenter, tickCommand()), outcome);
  const { createDemoClock } = await import('../gcsp/clock/index.js');
  const repository = createMemoryRepository({ store: f.store });
  await repository.open();
  const clock = createDemoClock({ repository, policy: f.policy, identity: f.identity, environmentId: 'clock-test', environmentKind: 'synthetic' });
  await register({ clock }, handlers.map(([id, stage]) => [id, stage, () => { throw Error('Completed replay must not execute'); }]));
  assert.deepEqual(await clock.tick(f.presenter, tickCommand()), outcome);
  assert.equal((await clock.tick(f.presenter, { ...tickCommand(), inputDigest: inputDigest('changed') })).status, 'conflict');
  assert.deepEqual((await clock.readState(f.presenter)).value.lastTick.handlerOrder, outcome.value.handlerOrder);
});

test('interrupted tick resumes only unfinished handlers and atomically rolls back their failed changes', async () => {
  const f = await setup(); let fail = true; let first = 0; let second = 0;
  await register(f, [['first', 'release-pull', async ({ transaction, context }) => transaction(async (tx) => { first++; return tx.insert('decisions', { runId: context.runId, decisionId: 'first' }); })],
    ['second', 'manual-expiry', async ({ transaction, context }) => transaction(async (tx) => {
      second++;
      await tx.insert('decisions', { runId: context.runId, decisionId: 'second' });
      return fail ? { status: 'unavailable', reason: 'synthetic provider delay', retryable: true } : ok({ expired: true });
    })]]);
  assert.equal((await f.clock.tick(f.presenter, tickCommand('resume'))).status, 'unavailable');
  assert.equal((await f.repository.query(f.presenter, 'decisions')).value.length, 1);
  assert.equal((await f.clock.readState(f.presenter)).value.lastTick.state, 'interrupted');
  fail = false;
  const result = await f.clock.tick(f.presenter, tickCommand('resume'));
  assert.equal(result.value.state, 'completed');
  assert.deepEqual([first, second], [1, 2]);
  assert.equal((await f.repository.query(f.presenter, 'decisions')).value.length, 2);
  assert.equal((await f.repository.query(f.presenter, 'event_receipts', { consumerId: 'clock:handler:first' })).value.length, 1);
});

test('startup reconciliation runs once without advance/release and preserves visible pending outcomes', async () => {
  const f = await setup(); let release = 0; let reconcile = 0;
  await register(f, [['pull', 'release-pull', async () => { release++; return ok({}); }],
    ['recover', 'pending-reconciliation', async () => { reconcile++; return { status: 'pending', operationId: 'existing-op', operationType: 'selection', lastKnownState: 'selection-pending' }; }]]);
  const [first, again] = await Promise.all([f.clock.reconcileStartup('clock-test'), f.clock.reconcileStartup('clock-test')]);
  assert.deepEqual(first, again);
  assert.equal(first.value.state, 'pending');
  assert.deepEqual([release, reconcile], [0, 1]);
  assert.equal(first.value.now, '2026-11-05T09:00:00.000Z');
  assert.deepEqual(first.value.handlerOrder.map((row) => row.handlerId), ['recover']);
});

test('actual old offer IDs, decision commands and outbox jobs cannot act on a replacement run', async () => {
  const f = await setup();
  const order = (await f.repository.query(f.presenter, 'stock')).value[0];
  const oldRunId = f.presenter.runId;
  assert.equal((await f.repository.transaction(f.presenter, command('old-resources'), async (tx) => {
    for (const [table, row] of [
      ['quotes', { quoteId: 'old-quote', orderUuid: order.orderUuid, employeeId: f.employee.employeeId }],
      ['holds', { holdId: 'old-hold', orderUuid: order.orderUuid, employeeId: f.employee.employeeId, entitlementSlotId: f.employee.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'old-quote' }],
      ['offers', { offerId: 'old-offer-id', holdId: 'old-hold', employeeId: f.employee.employeeId, orderUuid: order.orderUuid, quoteId: 'old-quote', state: 'active' }],
    ]) { const outcome = await tx.insert(table, { runId: oldRunId, ...row }); if (outcome.status !== 'ok') return outcome; }
    return tx.enqueueNotification({ runId: oldRunId, jobId: 'old-outbox-job', idempotencyKey: 'old-mail', inputDigest: inputDigest('old-mail'), offerId: 'old-offer-id', state: 'pending' });
  })).status, 'ok');
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.reset(f.presenter, resetCommand(state))).status, 'ok');
  const nextPresenter = await f.identity.createPresenterSession('next-presenter');
  const nextEmployee = await f.identity.switchPrincipal(nextPresenter.value.context, 'demo-paula', 'next-employee');
  const fresh = nextEmployee.value.context;
  const snapshot = inputDigest(Object.fromEntries(Object.entries(f.store.state.tables).map(([table, rows]) => [table, rows.filter((row) => row.runId === fresh.runId)])));
  const oldOffer = { table: 'offers', key: { runId: oldRunId, offerId: 'old-offer-id' } };
  assert.equal((await f.identity.authorizeResource(fresh, oldOffer, 'read')).status, 'stale-run');
  assert.equal((await f.identity.authorizeResource(f.employee, oldOffer, 'write')).status, 'stale-run');
  assert.equal((await f.repository.transaction(f.employee, command('old-decision-id'), (tx) => tx.insert('decisions', { runId: oldRunId, decisionId: 'old-decision-id', offerId: 'old-offer-id', decision: 'accept' }))).status, 'stale-run');
  const oldJob = { table: 'notification_outbox', key: { runId: oldRunId, jobId: 'old-outbox-job' } };
  const dispatch = async (context) => f.repository.transaction(context, command('dispatch-old-outbox-job'), async (tx) => {
    const job = await tx.get(oldJob);
    if (job.status !== 'ok') return job;
    return tx.compareAndSwap(oldJob, job.value.version, { state: 'sent' });
  });
  assert.equal((await dispatch(f.presenter)).status, 'stale-run');
  assert.equal((await dispatch(fresh)).status, 'stale-run');
  assert.equal((await f.repository.read(f.presenter, oldJob)).value.state, 'pending');
  assert.equal(inputDigest(Object.fromEntries(Object.entries(f.store.state.tables).map(([table, rows]) => [table, rows.filter((row) => row.runId === fresh.runId)]))), snapshot);
});

// The HTTP boundary must renew only a successful reset's presenter credential and still refuse
// every other use of historical sessions. These checks exercise real server composition.
test('backend startup and guarded presenter HTTP expose time, replay and reset cookie rollover', async () => {
  const { buildServer } = await import('../index.js');
  const { once } = await import('node:events');
  const f = await setup(); let recoveries = 0;
  await register(f, [['recover', 'pending-reconciliation', async () => { recoveries++; return ok({ recovered: true }); }]]);
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspAllowedOrigins: ['https://clock.test'] });
  try {
    const startup = await server.gcspStartup;
    assert.equal(startup.status, 'ok');
    assert.equal(recoveries, 1);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const cookies = f.session.value.setCookie.map((value) => value.split(';')[0]).join('; ');
    const request = async (path, body, cookie = cookies) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/presenter/${path}`, {
        method: body ? 'POST' : 'GET', headers: { Origin: 'https://clock.test', cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie(), cache: response.headers.get('cache-control') };
    };
    const state = await request('clock');
    assert.equal(state.status, 200); assert.equal(state.cache, 'no-store');
    const step = await request('clock/advance', { commandId: 'http-step', expectedClockVersion: '1', bySeconds: 60 });
    assert.equal(step.body.value.now, '2026-11-05T09:01:00.000Z');
    const ticking = await request('clock/tick', tickCommand('http-event', '2'));
    assert.equal(ticking.body.status, 'ok');
    assert.deepEqual((await request('clock/tick', tickCommand('http-event', '2'))).body, ticking.body);
    assert.equal((await request('clock/advance', { commandId: 'spoof', expectedClockVersion: '2', bySeconds: 1, roles: ['presenter'] })).status, 400);
    const employeeCookie = (await f.identity.switchPrincipal(f.presenter, 'demo-paula', 'http-employee')).value.setCookie.split(';')[0];
    assert.equal((await request('clock/advance', { commandId: 'employee', expectedClockVersion: '2', bySeconds: 60 }, employeeCookie)).status, 403);
    const stateBeforeReset = (await request('clock')).body.value;
    const resetInput = resetCommand(stateBeforeReset, 'http-reset');
    const reset = await request('clock/reset', resetInput);
    assert.equal(reset.body.status, 'ok');
    assert.equal(reset.cookies.length, 2);
    assert.ok(reset.cookies.every((value) => value.includes('HttpOnly') && value.includes('Secure')));
    assert.ok(!JSON.stringify(reset.body).includes('gcsp_session='));
    const renewed = reset.cookies.map((value) => value.split(';')[0]).join('; ');
    assert.equal((await request('clock', undefined, renewed)).body.value.runId, reset.body.value.runId);
    assert.equal((await request('clock')).status, 409);
    assert.deepEqual((await request('clock/reset', resetInput)).body, reset.body);
    assert.equal((await request('clock/reset', { ...resetInput, commandId: 'never-performed' })).status, 409);
    assert.equal((await request('clock/advance', { commandId: 'after-reset', expectedClockVersion: '1', bySeconds: 1 })).status, 409);
    assert.equal(recoveries, 2); // one startup and one explicit event, with HTTP replay doing no work
  } finally { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); }
});

test('composed employee consumer gets persisted run time and security sessions ignore accelerated domain time', async () => {
  const { buildServer } = await import('../index.js');
  const { once } = await import('node:events');
  const { brief } = await import('./helpers/employee-recommendation.js');
  const f = await setup();
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock, gcspAllowedOrigins: ['https://clock.test'],
    gcspRecommendations: { policy: f.policy, time: { now() { throw Error('Competing clock must never supply domain time'); } },
      provider: { async resolve(context) { return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
        factsVersion: 'clock-fixture-v1', stockVersion: 'empty-v1', stock: [], employeeFacts: { essentials: {} } }); } } } });
  try {
    await server.gcspStartup;
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const employee = await f.identity.switchPrincipal(f.presenter, 'demo-paula', 'clock-employee');
    const recommend = async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/recommendations`, { method: 'POST',
        headers: { Origin: 'https://clock.test', cookie: employee.value.setCookie.split(';')[0], 'Content-Type': 'application/json' }, body: JSON.stringify(brief()) });
      return response.json();
    };
    const before = await recommend();
    assert.equal(before.value.evaluatedAt, '2026-11-05T09:00:00.000Z');
    assert.equal(before.value.versions.clock, '1');
    assert.equal((await f.clock.advance(f.presenter, { commandId: 'long-demo-step', expectedClockVersion: '1', bySeconds: 86400 })).status, 'ok');
    const after = await recommend();
    assert.equal(after.value.evaluatedAt, '2026-11-06T09:00:00.000Z');
    assert.equal(after.value.versions.clock, '2');
    assert.equal((await f.identity.requireRole(f.presenter, 'presenter')).status, 'ok');
  } finally { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); }
});

test('identifier exhaustion during reset leaves the current run and complete state untouched', async () => {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const scenario = seed.assumptions.find((row) => row.key === 'clock.scenario.v1').value;
  scenario.vehicles = scenario.vehicles.slice(0, 1);
  scenario.allocationLimits.orderNumberSpace = 1;
  const f = await setup({ policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }) });
  const state = (await f.clock.readState(f.presenter)).value;
  const before = inputDigest(f.store.state);
  assert.equal((await f.clock.reset(f.presenter, resetCommand(state))).status, 'unavailable');
  assert.equal(inputDigest(f.store.state), before);
});

test('computed backend presentation fixtures retain clock/tick/reset/stale response contracts', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-clock-outcomes.json', import.meta.url), 'utf8'));
  const f = await setup();
  assert.deepEqual(await f.clock.readState(f.presenter), fixture.readState);
  assert.deepEqual(await f.clock.advance(f.presenter, { commandId: 'fixture-step', expectedClockVersion: '1', bySeconds: 60 }), fixture.advance);
  assert.deepEqual(await f.clock.tick(f.presenter, tickCommand('fixture-event', '2')), fixture.tick);
  const state = (await f.clock.readState(f.presenter)).value;
  assert.deepEqual(await f.clock.reset(f.presenter, resetCommand(state, 'fixture-reset')), fixture.reset);
  assert.deepEqual(await f.clock.readState(f.presenter), fixture.stale);
});


test('handler services can use their own repository boundary without nesting a clock transaction', { timeout: 2000 }, async () => {
  const f = await setup();
  await register(f, [['service', 'pending-reconciliation', async ({ context, transaction }) => {
    const employees = await f.repository.query(context, 'employees');
    if (employees.status !== 'ok') return employees;
    return transaction((tx) => tx.insert('decisions', { runId: context.runId, decisionId: 'service-side-effect', outcome: { employees: employees.value.length } }));
  }]]);
  const outcome = await f.clock.tick(f.presenter, tickCommand('own-boundary'));
  assert.equal(outcome.status, 'ok');
  assert.equal((await f.repository.query(f.presenter, 'decisions')).value[0].outcome.employees, 5);
});

test('retry after committed handler work and lost receipt reuses its repository command outcome', async () => {
  const { createDemoClock } = await import('../gcsp/clock/index.js');
  const f = await setup(); let loseReceipt = true; let committed = 0;
  const repository = { ...f.repository, async transaction(context, cmd, work) {
    if (loseReceipt && cmd.commandId.startsWith('clock:tick:receipt:')) { loseReceipt = false; return { status: 'unavailable', retryable: true }; }
    return f.repository.transaction(context, cmd, work);
  } };
  const clock = createDemoClock({ repository, policy: f.policy, identity: f.identity, environmentId: 'clock-test', environmentKind: 'synthetic' });
  await register({ clock }, [['recover', 'pending-reconciliation', async ({ context, transaction }) => transaction((tx) => {
    committed++;
    return tx.insert('decisions', { runId: context.runId, decisionId: 'committed-before-receipt' });
  })]]);
  assert.equal((await clock.tick(f.presenter, tickCommand('lost-receipt'))).status, 'unavailable');
  const result = await clock.tick(f.presenter, tickCommand('lost-receipt'));
  assert.equal(result.value.state, 'completed');
  assert.equal(committed, 1);
  assert.equal((await f.repository.query(f.presenter, 'decisions')).value.length, 1);
});

test('concurrent duplicate events run local effects once and return the same recorded tick', async () => {
  const f = await setup(); let changed = 0;
  await register(f, [['once', 'manual-expiry', async ({ transaction, context }) => transaction((tx) => {
    changed++;
    return tx.insert('decisions', { runId: context.runId, decisionId: 'concurrent-once' });
  })]]);
  const results = await Promise.all([f.clock.tick(f.presenter, tickCommand('concurrent')), f.clock.tick(f.presenter, tickCommand('concurrent'))]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].value.state, 'completed');
  assert.equal(changed, 1);
});

test('pre-existing uninitialised run is unavailable rather than silently claiming clock readiness', async () => {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store }); await repository.open();
  await repository.transaction(scope('legacy'), command('legacy'), (tx) => tx.insert('runs', {
    runId: 'legacy', environmentId: 'clock-test', current: true, status: 'active', policyVersion: 'gcsp-policy-v1',
  }));
  const before = inputDigest(store.state);
  const runtime = await createDemoRuntime({ repository, policy: createPolicyService(), environmentId: 'clock-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'unavailable');
  assert.equal(inputDigest(store.state), before);
});

test('reopening refuses incomplete fixture metadata or a malformed persisted clock without mutation', async () => {
  for (const patch of [{ clockVersion: 'NaN' }, { clockVersion: '0' }, { fixtureVersion: 'different-fixture' }, { versions: {} }]) {
    const f = await setup();
    const current = (await f.repository.currentRun('clock-test')).value;
    await f.repository.transaction(f.presenter, command(`damage-${Object.keys(patch)[0]}`), (tx) => tx.compareAndSwap(
      { table: 'runs', key: { runId: current.runId } }, current.version, patch));
    const before = inputDigest(f.store.state);
    const runtime = await createDemoRuntime({ repository: f.repository, policy: f.policy, environmentId: 'clock-test', environmentKind: 'synthetic',
      policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'reopen', sessionNow: () => '2026-11-05T00:00:00.000Z' });
    assert.equal(runtime.status, 'unavailable', JSON.stringify(patch));
    assert.equal(inputDigest(f.store.state), before);
  }
});
