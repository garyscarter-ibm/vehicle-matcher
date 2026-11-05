import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createStockReleaseService, createSyntheticStockProvider, createStockPullFixtureProvider,
  STOCK_RELEASE_CONSUMER } from '../gcsp/stock/index.js';
import { STOCK_FIELDS, validatePull } from '../gcsp/stock/port.js';
import { createRepositoryManualPorts } from '../gcsp/manual-context/ports.js';

const readFixture = async (name) => JSON.parse(await readFile(new URL(`../gcsp/stock/fixtures/${name}`, import.meta.url), 'utf8'));
const plan = await readFixture('tranche-plan.json');
const target = await readFixture('real-shaped-pull.json');
const presentation = await readFixture('presentation.json');
const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const tickCommand = (eventId = 'release-1', expectedClockVersion = '1') => ({ eventId, expectedClockVersion, inputDigest: inputDigest(eventId) });
async function alternativePolicy(values) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  for (const [key, value] of Object.entries(values)) seed.assumptions.find((entry) => entry.key === key).value = value;
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}
async function setup({ policy = createPolicyService(), providerFactory, windows = plan.windows } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore() });
  await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'release-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const greg = (await identity.switchPrincipal(presenter, 'demo-greg', 'greg')).value.context;
  const employee = (await identity.switchPrincipal(presenter, 'demo-paula', 'employee')).value.context;
  const provider = providerFactory ? await providerFactory({ repository, presenter, clock }) : createSyntheticStockProvider({ runId: presenter.runId,
    version: plan.version, label: plan.label, windows });
  const service = createStockReleaseService({ repository, policy, clock, identity, provider });
  assert.equal((await service.register()).status, 'ok');
  return { repository, policy, clock, identity, presenter, employee, greg, service, provider };
}
const available = async (f) => (await f.repository.query(f.presenter, 'stock', { state: 'released' })).value;
const receipts = async (f) => (await f.repository.query(f.presenter, 'event_receipts', { consumerId: STOCK_RELEASE_CONSUMER })).value;
const releaseOutcome = (tick) => tick.value?.outcomes.find((row) => row.handlerId === 'stock-release')?.outcome;
const tick = (f, id = 'release-1', version = '1') => f.clock.tick(f.presenter, tickCommand(id, version));
const fixtureProvider = (mutate = (value) => value) => createStockPullFixtureProvider(async (request) => {
  const result = structuredClone(target);
  result.value.runId = request.runId;
  result.value.observedAt = request.asOf;
  return mutate(result, request);
});

test('tranche release on a tick imports exact available cars and the atomic tranche receipt', async () => {
  const f = await setup();
  assert.equal((await available(f)).length, 0);
  const result = await tick(f);
  assert.equal(result.status, 'ok', JSON.stringify(result));
  const outcome = releaseOutcome(result);
  assert.equal(outcome.value.kind, 'stock-released');
  const pool = await available(f);
  assert.equal(pool.length, plan.windows[0].stock.length);
  assert.equal((await receipts(f)).length, 1);
  const receipt = (await receipts(f))[0];
  for (const key of ['consumerId', 'eventType', 'handlerId', 'state']) assert.equal(receipt[key], presentation.event[key]);
  assert.equal(receipt.eventId, presentation.event.trancheId);
  assert.deepEqual(receipt.outcome.value.orderUuids, presentation.event.orderUuids);
  assert.equal(receipt.eventId, outcome.value.trancheId);
  assert.equal(receipt.eventType, 'stock-released');
  assert.deepEqual(receipt.outcome, outcome);
  assert.equal(receipt.outcome.value.tickId, 'release-1');
  const source = plan.windows[0].stock[0];
  const car = pool.find((row) => row.orderUuid === source.orderUuid);
  for (const key of ['state', 'status', 'available', 'held', 'allocated']) assert.equal(car[key], presentation.releasedCar[key]);
  assert.equal(car.orderNumber, source.orderNumber);
  assert.equal(car.configurationId, source.configurationId);
  assert.deepEqual(car.facts, source.facts);
  assert.deepEqual(car.visibility, source.visibility);
  assert.deepEqual(car.release.availability, { state: 'available', availableFrom: result.value.now, version: receipt.eventId });
  assert.equal(car.vin, undefined);
  await f.repository.close();
});

test('actual released-stock reader sees the same exact pull without changing eligibility availability', async () => {
  const f = await setup({ providerFactory: () => fixtureProvider((response) => {
    response.value.stock[0].visibility = { companyIds: ['demo-bmw-fs-uk'], schemeIds: ['choices-fs-uk'], employeeIds: null };
    return response;
  }) });
  assert.equal((await tick(f)).status, 'ok');
  const stock = await createRepositoryManualPorts({ repository: f.repository, policy: f.policy }).releasedStock.read(f.employee);
  assert.equal(stock.status, 'ok', JSON.stringify(stock)); assert.equal(stock.value.stock.length, 1);
  assert.equal(stock.value.stock[0].orderUuid, target.value.stock[0].orderUuid);
  assert.equal(stock.value.stock[0].availability.state, 'available');
  assert.equal(stock.value.stock[0].availability.availableUntil, undefined, 'missing source expiry stays unknown');
});

test('released stock without source visibility remains unavailable to the actual manual reader', async () => {
  const f = await setup({ providerFactory: () => fixtureProvider() });
  assert.equal((await tick(f)).status, 'ok');
  assert.equal((await createRepositoryManualPorts({ repository: f.repository, policy: f.policy }).releasedStock.read(f.employee)).status, 'unavailable');
});

test('replay preserves legacy operational available rows and receipts for an audited reset or migration', async () => {
  const f = await setup({ providerFactory: () => fixtureProvider() }); assert.equal((await tick(f)).status, 'ok');
  const row = (await available(f))[0];
  const changed = await f.repository.transaction(f.presenter, command('legacy-state-fixture'), (tx) => tx.compareAndSwap(
    { table: 'stock', key: { runId: f.presenter.runId, orderUuid: row.orderUuid } }, row.version, { state: 'available' }));
  assert.equal(changed.status, 'ok'); const before = await receipts(f);
  assert.equal((await tick(f, 'legacy-row-replay')).status, 'ok');
  assert.deepEqual((await f.repository.read(f.presenter, { table: 'stock', key: { runId: f.presenter.runId, orderUuid: row.orderUuid } })).value, changed.value);
  assert.deepEqual(await receipts(f), before);
});

test('replaying a tick or tranche is idempotent; already released cars are never released twice', async () => {
  const f = await setup({ providerFactory: () => fixtureProvider() });
  const first = await tick(f);
  const pool = await available(f);
  assert.deepEqual(await tick(f), first);
  assert.equal((await tick(f, 'same-tranche-new-tick')).status, 'ok');
  assert.deepEqual(await available(f), pool);
  assert.equal((await receipts(f)).length, 1);
  assert.equal((await tick(f, 'release-1-changed')).status, 'ok');
  assert.equal((await f.clock.tick(f.presenter, { ...tickCommand(), inputDigest: inputDigest('changed') })).status, 'conflict');
});

test('policy-keyed sizes split a source window and changing the central key changes release size', async () => {
  for (const size of [1, 2]) {
    const policy = await alternativePolicy({ 'supply.release.size': size });
    const f = await setup({ policy });
    await tick(f);
    assert.equal((await available(f)).length, size);
    await tick(f, 'release-2');
    assert.equal((await available(f)).length, size * 2);
    assert.equal((await receipts(f)).length, 2);
  }
});

test('unreleased seeded orders are promoted by exact identity/version; existing facts remain immutable', async () => {
  let seeded;
  const f = await setup({ providerFactory: async ({ repository, presenter }) => {
    seeded = (await repository.query(presenter, 'stock')).value;
    const stock = seeded.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => STOCK_FIELDS.includes(key))));
    return createSyntheticStockProvider({ runId: presenter.runId, version: 'seeded-test', label: 'TEST FIXTURE from canonical clock seed',
      windows: [{ ...plan.windows[0], stock }] });
  } });
  assert.equal((await tick(f)).status, 'ok');
  const pool = await available(f);
  assert.equal(pool.length, seeded.length);
  for (const car of pool) {
    const before = seeded.find((row) => row.orderUuid === car.orderUuid);
    assert.equal(car.version, before.version + 1);
    assert.equal(car.orderNumber, before.orderNumber);
    assert.deepEqual(car.facts, before.facts);
  }
});

test('a known exact car is not freed or overwritten by a later source tranche', async () => {
  let snapshot;
  const f = await setup({ providerFactory: () => createStockPullFixtureProvider(async (request) => {
    snapshot = structuredClone(target);
    snapshot.value.runId = request.runId;
    snapshot.value.observedAt = request.asOf;
    snapshot.value.tranche.trancheId = request.eventId;
    return snapshot;
  }) });
  await tick(f);
  const car = (await available(f))[0];
  for (const state of ['held', 'allocated']) {
    const before = (await f.repository.read(f.presenter, { table: 'stock', key: { runId: f.presenter.runId, orderUuid: car.orderUuid } })).value;
    assert.equal((await f.repository.transaction(f.presenter, command(state), (tx) => tx.compareAndSwap({ table: 'stock', key: { runId: f.presenter.runId, orderUuid: car.orderUuid } }, before.version, { state }))).status, 'ok');
    const occupied = (await f.repository.read(f.presenter, { table: 'stock', key: { runId: f.presenter.runId, orderUuid: car.orderUuid } })).value;
    assert.equal((await tick(f, `repeat-${state}`)).status, 'ok');
    assert.deepEqual((await f.repository.read(f.presenter, { table: 'stock', key: { runId: f.presenter.runId, orderUuid: car.orderUuid } })).value, occupied);
    assert.deepEqual(releaseOutcome(await tick(f, `repeat-${state}`)).value.orderUuids, []);
  }
});

test('changed exact identities and changed tranche contents conflict with no partial release', async () => {
  let changed = false;
  const f = await setup({ providerFactory: () => fixtureProvider((result) => {
    if (changed) result.value.stock[0].configurationId = 'CHANGED';
    return result;
  }) });
  await tick(f);
  const before = await available(f);
  changed = true;
  assert.equal((await tick(f, 'changed-tranche')).status, 'unavailable');
  assert.deepEqual(await available(f), before);
  assert.equal((await receipts(f)).length, 1);
});

test('release windows are actual source data; future windows and startup do not release stock', async () => {
  const windows = structuredClone(plan.windows);
  windows[0].availableAt = '2026-11-05T10:30:00+01:00';
  const f = await setup({ windows });
  assert.equal((await f.clock.reconcileStartup('release-test')).status, 'ok');
  assert.equal((await available(f)).length, 0);
  assert.equal(releaseOutcome(await tick(f)).value.kind, 'no-release');
  assert.equal((await available(f)).length, 0);
  const advanced = await f.clock.advance(f.presenter, { commandId: 'advance', expectedClockVersion: '1', to: 'release' });
  assert.equal(advanced.status, 'ok');
  assert.equal((await available(f)).length, 0);
  assert.equal((await tick(f, 'due', '2')).status, 'ok');
  assert.equal((await available(f)).length, plan.windows[0].stock.length);
});

test('requests and confirmations never become stock; only the actual pull after the keyed lead time does', async () => {
  const policy = await alternativePolicy({ 'supply.leadTimeDays': 1 });
  const windows = structuredClone(plan.windows);
  windows[0].supplyId = 'confirmed-1';
  const f = await setup({ policy, windows });
  assert.equal((await tick(f)).status, 'ok');
  assert.equal((await available(f)).length, 0);
  const confirmation = { runId: f.greg.runId, supplyId: 'confirmed-1', state: 'confirmed', confirmedAt: '2026-11-05T10:00:00+01:00', sourceVersion: 'TEST-production-ack' };
  assert.equal((await f.service.queueConfirmedSupply(f.greg, { commandId: 'request' }, { ...confirmation, state: 'requested' })).status, 'invalid');
  assert.equal((await f.service.queueConfirmedSupply(f.greg, { commandId: 'rows' }, { ...confirmation, stock: plan.windows[0].stock })).status, 'invalid');
  assert.equal((await f.service.queueConfirmedSupply(f.greg, { commandId: 'future' }, { ...confirmation, confirmedAt: '2026-11-06T09:00:00.000Z' })).status, 'invalid');
  assert.equal((await f.service.queueConfirmedSupply(f.employee, { commandId: 'forged' }, confirmation)).status, 'forbidden');
  const queued = await f.service.queueConfirmedSupply(f.greg, { commandId: 'queue' }, confirmation);
  assert.equal(queued.value.eligibleFrom, '2026-11-06T09:00:00.000Z');
  assert.deepEqual(await f.service.queueConfirmedSupply(f.greg, { commandId: 'queue-replay' }, confirmation), queued);
  assert.equal((await f.service.queueConfirmedSupply(f.greg, { commandId: 'changed' }, { ...confirmation, sourceVersion: 'changed' })).status, 'conflict');
  assert.equal((await available(f)).length, 0);
  await tick(f, 'too-early');
  assert.equal((await available(f)).length, 0);
  await f.clock.advance(f.presenter, { commandId: 'next-day', expectedClockVersion: '1', bySeconds: 86400 });
  assert.equal((await available(f)).length, 0);
  assert.equal((await tick(f, 'actual-pull', '2')).status, 'ok');
  assert.equal((await available(f)).length, plan.windows[0].stock.length);
  assert.equal((await receipts(f))[0].outcome.value.supplyId, 'confirmed-1');
});

test('elapsed lead time with no provider appearance cannot manufacture released stock', async () => {
  const f = await setup({ policy: await alternativePolicy({ 'supply.leadTimeDays': 0 }), windows: [] });
  const confirmation = { runId: f.greg.runId, supplyId: 'absent-supply', state: 'confirmed', confirmedAt: '2026-11-05T09:00:00.000Z', sourceVersion: 'TEST-ack' };
  assert.equal((await f.service.queueConfirmedSupply(f.greg, { commandId: 'queue' }, confirmation)).status, 'ok');
  await tick(f);
  assert.equal((await available(f)).length, 0);
  assert.equal((await receipts(f)).length, 0);
});

test('run scope refuses old contexts and a provider snapshot from another run', async () => {
  const f = await setup({ providerFactory: () => fixtureProvider((result) => { result.value.runId = 'another-run'; return result; }) });
  assert.equal((await tick(f)).status, 'unavailable');
  assert.equal((await available(f)).length, 0);
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.reset(f.presenter, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  assert.equal((await tick(f, 'old-context')).status, 'stale-run');
});

test('synthetic and real-shaped contract fixtures use one validated pull port', async () => {
  for (const providerFactory of [undefined, () => fixtureProvider()]) {
    const f = await setup({ providerFactory });
    const result = await tick(f);
    assert.equal(result.status, 'ok');
    const rows = await available(f);
    assert.ok(rows.length > 0);
    assert.equal(rows[0].orderNumber, '0000001');
    assert.equal(rows[0].configurationId, target.value.stock[0].configurationId);
    assert.ok((await receipts(f))[0].outcome.value.source.label.includes('TEST FIXTURE'));
  }
  const request = { runId: 'test', asOf: target.value.observedAt };
  const shaped = structuredClone(target);
  shaped.value.runId = request.runId;
  assert.equal(validatePull(shaped, request).status, 'ok');
});

test('provider failures, duplicate cars, VINs, oversized tranches and unknown appearances fail closed', async () => {
  for (const mutate of [
    () => { throw new Error('source failure'); },
    (r) => { r.value.stock.push(structuredClone(r.value.stock[0])); return r; },
    (r) => { r.value.stock[0].vin17 = 'TEST-NOT-ALLOWED'; return r; },
    (r) => { r.value.stock[0].facts = { nested: { vin: 'TEST-NOT-ALLOWED' } }; return r; },
    (r) => { r.value.tranche = null; return r; },
    (r) => { r.value.tranche.supplyId = 'not-confirmed'; return r; },
    (r) => { r.value.stock.push(plan.windows[0].stock[1]); r.value.tranche.orderUuids.push(plan.windows[0].stock[1].orderUuid); return r; },
  ]) {
    const f = await setup({ policy: await alternativePolicy({ 'supply.release.size': 1 }), providerFactory: () => fixtureProvider(mutate) });
    const failed = await tick(f);
    for (const [key, value] of Object.entries(presentation.failure)) assert.equal(failed[key], value);
    assert.equal((await available(f)).length, 0);
    assert.equal((await receipts(f)).length, 0);
  }
});

test('missing policy assumptions never use local release defaults', async () => {
  const policy = createPolicyService();
  const f = await setup({ policy: { getActiveVersion: (...args) => policy.getActiveVersion(...args),
    getAssumption: (key, read) => key === 'supply.release.size' ? { status: 'invalid' } : policy.getAssumption(key, read) } });
  assert.equal((await tick(f)).status, 'unavailable');
  assert.equal((await available(f)).length, 0);
});

test('concurrent release ticks and repository/runtime restart retain one tranche/car release', async () => {
  const f = await setup({ providerFactory: () => fixtureProvider() });
  const results = await Promise.all([tick(f, 'concurrent-a'), tick(f, 'concurrent-b')]);
  assert.ok(results.every((row) => row.status === 'ok'), JSON.stringify(results));
  assert.equal((await available(f)).length, 1);
  assert.equal((await receipts(f)).length, 1);
  assert.equal((await f.clock.tick(f.employee, tickCommand('employee-release'))).status, 'forbidden');
  await f.repository.close();
  await f.repository.open();
  const runtime = await createDemoRuntime({ repository: f.repository, policy: f.policy, environmentId: 'release-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'restart', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('restarted-presenter')).value.context;
  const service = createStockReleaseService({ repository: f.repository, policy: f.policy, clock, identity, provider: f.provider });
  assert.equal((await service.register()).status, 'ok');
  assert.equal((await clock.tick(presenter, tickCommand('after-restart'))).status, 'ok');
  assert.equal((await f.repository.query(presenter, 'stock', { state: 'released' })).value.length, 1);
  assert.equal((await f.repository.query(presenter, 'event_receipts', { consumerId: STOCK_RELEASE_CONSUMER })).value.length, 1);
});

test('source-provided availability end is preserved; expired appearance is unavailable', async () => {
  for (const availableUntil of ['2026-11-12T09:00:00.000Z', '2026-11-05T09:00:00.000Z']) {
    const f = await setup({ providerFactory: () => fixtureProvider((result) => {
      result.value.stock[0].availability = { availableUntil };
      return result;
    }) });
    const result = await tick(f);
    if (availableUntil > '2026-11-05T09:00:00.000Z') {
      assert.equal(result.status, 'ok');
      assert.equal((await available(f))[0].release.availability.availableUntil, availableUntil);
    } else {
      assert.equal(result.status, 'unavailable');
      assert.equal((await available(f)).length, 0);
    }
  }
});

test('immutable identity conflicts and failed batch writes preserve the entire pool', async () => {
  let stockBefore;
  const f = await setup({ providerFactory: async ({ repository, presenter }) => {
    stockBefore = (await repository.query(presenter, 'stock')).value;
    const seeded = Object.fromEntries(Object.entries(stockBefore[0]).filter(([key]) => STOCK_FIELDS.includes(key)));
    return createStockPullFixtureProvider(async (request) => ok({ ...structuredClone(target.value), runId: request.runId,
      observedAt: request.asOf, stock: [structuredClone(target.value.stock[0]), { ...seeded, revision: seeded.revision + 1 }],
      tranche: { ...structuredClone(target.value.tranche), orderUuids: [target.value.stock[0].orderUuid, seeded.orderUuid] } }));
  } });
  assert.equal((await tick(f)).status, 'unavailable');
  assert.deepEqual((await f.repository.query(f.presenter, 'stock')).value, stockBefore);
  assert.equal((await receipts(f)).length, 0);
  let beforeCollision;
  const collision = await setup({ providerFactory: async ({ repository, presenter }) => {
    beforeCollision = (await repository.query(presenter, 'stock')).value;
    const cars = structuredClone(plan.windows[0].stock.slice(0, 2));
    const used = new Set(beforeCollision.map((row) => row.orderNumber));
    let next = 0;
    while (used.has(String(next).padStart(7, '0'))) next += 1;
    cars[0].orderNumber = String(next).padStart(7, '0');
    cars[1].orderNumber = beforeCollision[0].orderNumber;
    return createStockPullFixtureProvider(async (request) => ok({ ...structuredClone(target.value), runId: request.runId,
      observedAt: request.asOf, stock: cars, tranche: { ...structuredClone(target.value.tranche), orderUuids: cars.map((car) => car.orderUuid) } }));
  } });
  assert.equal((await tick(collision)).status, 'unavailable');
  assert.deepEqual((await collision.repository.query(collision.presenter, 'stock')).value, beforeCollision);
  assert.equal((await receipts(collision)).length, 0);
});
