import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createStockReleaseService, createSyntheticStockProvider } from '../gcsp/stock/index.js';
import { createRepositoryManualPorts } from '../gcsp/manual-context/ports.js';

const plan = JSON.parse(await readFile(new URL('../gcsp/stock/fixtures/tranche-plan.json', import.meta.url), 'utf8'));
const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const visible = { companyIds: ['demo-bmw-fs-uk'], schemeIds: ['choices-fs-uk'], employeeIds: null };
async function setup(t, { cars = 1, visibility = () => visible, oneTranche = false } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore() });
  await repository.open(); t.after(() => repository.close());
  const policy = createPolicyService(); let sessionInstant = '2026-11-05T00:00:00.000Z';
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'release-history-test', environmentKind: 'synthetic',
    policyAsOf: sessionInstant, commandId: 'bootstrap', sessionNow: () => sessionInstant });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const employee = (await identity.switchPrincipal(presenter, 'demo-paula', 'employee')).value.context;
  const alex = (await identity.switchPrincipal(presenter, 'demo-alex', 'alex')).value.context;
  const windows = plan.windows[0].stock.slice(0, cars).map((car, index) => {
    const stockCar = structuredClone(car); delete stockCar.visibility;
    const scope = visibility(index); if (scope !== undefined) stockCar.visibility = scope;
    return { windowId: `history-${index}`, availableAt: '2026-11-05T09:00:00.000Z', supplyId: null, stock: [stockCar] };
  });
  const provider = createSyntheticStockProvider({ runId: presenter.runId, version: 'TEST-history-v1', label: 'TEST history input; not F77/F78',
    windows: oneTranche ? [{ ...windows[0], stock: windows.flatMap((window) => window.stock) }] : windows });
  const release = createStockReleaseService({ repository, policy, clock, identity, provider });
  assert.equal((await release.register()).status, 'ok');
  let module;
  try { module = await import('../gcsp/stock/history-port.js'); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; assert.fail('The producer-owned release-history read seam is not implemented.'); }
  const port = (injected = {}) => module.createStockReleaseHistoryPort({ repository, clock, identity, ...injected });
  const tick = async (eventId = 'release') => {
    const time = (await clock.now(presenter)).value;
    const outcome = await clock.tick(presenter, { eventId, expectedClockVersion: time.clockVersion, inputDigest: inputDigest(eventId) });
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome;
  };
  const patch = async (table, row, changes, suffix = '') => {
    const key = table === 'stock' ? { runId: presenter.runId, orderUuid: row.orderUuid }
      : { runId: presenter.runId, consumerId: row.consumerId, eventId: row.eventId };
    const outcome = await repository.transaction(presenter, command(`patch-${table}-${suffix}`), (tx) => tx.compareAndSwap({ table, key }, row.version, changes));
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value;
  };
  const stock = async () => (await repository.query(presenter, 'stock')).value.filter((row) => row.release);
  const receipts = async () => (await repository.query(presenter, 'event_receipts', { consumerId: 'stock-release' })).value;
  const reset = async () => {
    const state = (await clock.readState(presenter)).value;
    const outcome = await clock.reset(presenter, { commandId: 'history-reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
      scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
  };
  return { repository, policy, clock, identity, presenter, employee, alex, port, tick, patch, stock, receipts, reset,
    expire() { sessionInstant = '2030-01-01T00:00:00.000Z'; } };
}

test('before release the authenticated read reports no visible history and unknown current provider without writing', async (t) => {
  const f = await setup(t); const before = await f.repository.query(f.presenter, 'event_receipts');
  const read = await f.port().read(f.employee); assert.equal(read.status, 'ok');
  assert.deepEqual(read.value, {
    runId: f.employee.runId, observedAt: '2026-11-05T09:00:00.000Z',
    history: { state: 'none-visible', releasedCarCount: 0, releaseCount: 0, latestReleasedAt: null, sourceVersions: [] },
    source: { state: 'current-version-unknown' },
  });
  assert.deepEqual(await f.repository.query(f.presenter, 'event_receipts'), before);
});

test('confirmed visible cars and nonempty tranches determine history and latest release independently of hidden releases', async (t) => {
  const f = await setup(t, { cars: 3, visibility: (index) => index === 1 ? { ...visible, companyIds: ['another-company'] } : visible });
  await f.tick('first'); await f.tick('hidden');
  assert.equal((await f.clock.advance(f.presenter, { commandId: 'later', expectedClockVersion: '1', bySeconds: 3600 })).status, 'ok');
  await f.tick('last');
  const read = await f.port().read(f.employee);
  assert.deepEqual(read.value, { runId: f.employee.runId, observedAt: '2026-11-05T10:00:00.000Z',
    history: { state: 'released', releasedCarCount: 2, releaseCount: 2, latestReleasedAt: '2026-11-05T10:00:00.000Z', sourceVersions: ['TEST-history-v1'] },
    source: { state: 'current-version-unknown' } });
  assert.equal(read.status, 'ok');
});

test('held allocated and legacy available cars retain confirmed history when no current stock is available', async (t) => {
  const f = await setup(t); await f.tick(); let row = (await f.stock())[0]; const receipts = await f.receipts();
  for (const state of ['held', 'allocated', 'available']) {
    row = await f.patch('stock', row, { state, available: false }, state);
    const read = await f.port().read(f.employee);
    assert.equal(read.status, 'ok', JSON.stringify(read)); assert.equal(read.value.history.releasedCarCount, 1);
    assert.equal(read.value.history.state, 'released');
    const browse = await createRepositoryManualPorts({ repository: f.repository, policy: f.policy }).releasedStock.read(f.employee);
    assert.equal(browse.status, 'ok'); assert.ok(browse.value.stock.every((car) => car.availability.state !== 'available'));
    assert.deepEqual((await f.stock())[0], row); assert.deepEqual(await f.receipts(), receipts);
  }
});

test('multiple confirmed cars in one tranche count as one release and replay adds no history', async (t) => {
  const f = await setup(t, { cars: 3, oneTranche: true }); await f.tick();
  const before = await f.port().read(f.employee);
  assert.equal(before.value.history.releasedCarCount, 3); assert.equal(before.value.history.releaseCount, 1);
  await f.tick('source-replay'); assert.deepEqual(await f.port().read(f.employee), before);
});

test('company scheme and employee visibility all restrict history without disclosing other exact identities', async (t) => {
  const scopes = [{ ...visible, employeeIds: ['employee-paula'] }, { ...visible, schemeIds: ['other-scheme'] }, { ...visible, companyIds: ['other-company'] }];
  const f = await setup(t, { cars: 3, visibility: (index) => scopes[index] });
  await f.tick('one'); await f.tick('two'); await f.tick('three');
  assert.equal((await f.port().read(f.employee)).value.history.releasedCarCount, 1);
  assert.deepEqual((await f.port().read(f.alex)).value.history, {
    state: 'none-visible', releasedCarCount: 0, releaseCount: 0, latestReleasedAt: null, sourceVersions: [],
  });
});

test('missing or malformed release visibility is unavailable instead of a zero count', async (t) => {
  for (const visibility of [undefined, { companyIds: 'invalid', schemeIds: [], employeeIds: null }, { companyIds: [], schemeIds: [3], employeeIds: null }, { ...visible, employeeIds: {} }]) {
    const f = await setup(t, { visibility: () => visibility }); await f.tick();
    const read = await f.port().read(f.employee); assert.equal(read.status, 'unavailable', JSON.stringify(read)); assert.equal(read.value, undefined);
  }
});

test('mismatched retained tranche source instant and missing provenance cannot become confirmed history', async (t) => {
  for (const changed of [{ trancheId: 'wrong' }, { sourceVersion: 'wrong' }, { releasedAt: '2026-11-05T08:00:00.000Z' }, null]) {
    const f = await setup(t); await f.tick(); const row = (await f.stock())[0];
    await f.patch('stock', row, { release: changed === null ? null : { ...row.release, ...changed } }, 'provenance');
    assert.equal((await f.port().read(f.employee)).status, 'unavailable');
  }
});

test('a missing retained exact car makes successful receipt history unavailable', async (t) => {
  const f = await setup(t); await f.tick(); const orderUuid = (await f.stock())[0].orderUuid;
  const repository = { ...f.repository, async query(context, table, filter) {
    const read = await f.repository.query(context, table, filter);
    return table === 'stock' && read.status === 'ok' ? { ...read, value: read.value.filter((row) => row.orderUuid !== orderUuid) } : read;
  } };
  assert.equal((await f.port({ repository }).read(f.employee)).status, 'unavailable');
});

test('malformed successful receipt identity source version and future release instant fail closed', async (t) => {
  for (const change of ['uuid', 'run', 'version', 'future', 'missing-receipt']) {
    const f = await setup(t); await f.tick(); const receipt = (await f.receipts())[0]; const outcome = structuredClone(receipt.outcome);
    const patch = { outcome };
    if (change === 'uuid') outcome.value.orderUuids = ['configuration-id'];
    if (change === 'run') outcome.value.runId = 'another-run';
    if (change === 'version') patch.inputVersions = { ...receipt.inputVersions, source: 'wrong' };
    if (change === 'future') outcome.value.releasedAt = '2026-11-05T12:00:00.000Z';
    if (change === 'missing-receipt') patch.eventType = 'different-event';
    await f.patch('event_receipts', receipt, patch, change);
    assert.equal((await f.port().read(f.employee)).status, 'unavailable');
  }
});

test('pending failed and unrelated receipts do not count as confirmed releases', async (t) => {
  const f = await setup(t);
  for (const [state, consumerId] of [['pending', 'stock-release'], ['failed', 'stock-release'], ['completed', 'unrelated']]) {
    assert.equal((await f.repository.transaction(f.presenter, command(`receipt-${state}`), (tx) => tx.recordReceipt({ consumerId,
      eventId: state, eventType: 'stock-released', state, inputDigest: inputDigest(state), outcome: { status: 'ok', value: { kind: 'stock-released' } } }))).status, 'ok');
  }
  assert.equal((await f.port().read(f.employee)).value.history.state, 'none-visible');
});

test('fabricated role-bearing contexts nonemployees and expired actual sessions cannot read history', async (t) => {
  const f = await setup(t); await f.tick();
  for (const context of [{ ...f.employee }, f.presenter]) assert.equal((await f.port().read(context)).status, 'forbidden');
  f.expire(); assert.equal((await f.port().read(f.employee)).status, 'expired-session');
});

test('a reset before or during the read refuses the old authenticated run', async (t) => {
  for (const during of [false, true]) {
    const f = await setup(t); await f.tick();
    if (!during) await f.reset();
    const repository = { ...f.repository, async query(context, table, filter) {
      const read = await f.repository.query(context, table, filter); if (table === 'stock') await f.reset(); return read;
    } };
    assert.equal((await f.port(during ? { repository } : {}).read(f.employee)).status, 'stale-run');
  }
});

test('an actual clock advance during reads requires refresh instead of mixing observations', async (t) => {
  const f = await setup(t); await f.tick();
  const repository = { ...f.repository, async query(context, table, filter) {
    const read = await f.repository.query(context, table, filter);
    if (table === 'stock') assert.equal((await f.clock.advance(f.presenter, { commandId: 'during-read', expectedClockVersion: '1', bySeconds: 60 })).status, 'ok');
    return read;
  } };
  assert.equal((await f.port({ repository }).read(f.employee)).status, 'conflict');
});
