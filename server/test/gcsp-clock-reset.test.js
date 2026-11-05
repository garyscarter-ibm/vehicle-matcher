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
