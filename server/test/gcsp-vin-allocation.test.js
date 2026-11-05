import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { emptyAllocationInventory, allocateSyntheticIdentities, canonicalAllocationContent,
  allocateInventoryFile, readAllocationInventory, publishStockOrders, presentSyntheticIdentity } from '../gcsp/vehicle-evidence/vin-allocation.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { offlineVinCheck } from './helpers/vin-checker.js';

const { fixtures } = JSON.parse(await readFile(new URL('./fixtures/gcsp/vehicle-evidence/five-wmi-reference-configurations.json', import.meta.url)));
const configurationId = Buffer.from('REF430I:REFERENCE').toString('base64');
const car = (vehicleId = 'vehicle-a', extra = {}) => ({ vehicleId, configurationId, snapshotVersion: 'reference-fixtures.v1',
  usage: 'stock', configuration: fixtures[0].configuration, ...extra });
const plan = (vehicles = [car()], extra = {}) => ({ runId: 'run-a', seed: 'fictional-demo-seed', corpusVersion: 'reference-corpus.v1',
  datasetId: 'dataset-a', vehicles, ...extra });
const allocate = (inventory, request, expectedRevision = inventory.revision) => allocateSyntheticIdentities(inventory, request, { expectedRevision });
const delivered = (id = 'vehicle-a', extra = {}) => car(id, { usage: 'delivered-car', profileId: fixtures[0].profileId, referenceOnly: true, ...extra });
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'vin-allocation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('stock uses reproducible UUID-v4/order formats, distinct exact cars and no VIN/corpus mutation', async () => {
  const request = plan([car('b'), car('a')]);
  const input = structuredClone(request);
  const a = await allocate(emptyAllocationInventory(), request);
  const b = await allocate(emptyAllocationInventory(), plan([...request.vehicles].reverse()));
  assert.equal(a.status, 'ok');
  assert.equal(canonicalAllocationContent(a.inventory), canonicalAllocationContent(b.inventory));
  assert.deepEqual(request, input);
  assert.equal(a.inventory.records.length, 2);
  for (const row of a.inventory.records) {
    assert.match(row.orderUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.match(row.orderNumber, /^[0-9]{7}$/);
    assert.ok(Number.isInteger(row.wholesalerOrderId) && row.wholesalerOrderId >= 10000000 && row.wholesalerOrderId <= 99999999);
    assert.equal(row.configurationId, configurationId);
    assert.equal(row.vin17, undefined);
    assert.equal(row.vin7, undefined);
    assert.equal(row.originatingDatasetId, 'dataset-a');
    assert.equal(row.identityKind, 'synthetic');
  }
  assert.notEqual(a.inventory.records[0].orderUuid, a.inventory.records[1].orderUuid);
});

test('persisted replay/reordering and additions preserve all published mappings and source associations', async () => {
  const first = await allocate(emptyAllocationInventory(), plan([delivered('a'), car('b')]));
  const persisted = JSON.parse(canonicalAllocationContent(first.inventory));
  const replay = await allocate(persisted, plan([car('b'), delivered('a')], { datasetId: 'overlapping-dataset' }));
  assert.equal(replay.status, 'ok');
  assert.equal(canonicalAllocationContent(replay.inventory), canonicalAllocationContent(first.inventory));
  const added = await allocate(persisted, plan([car('0-new'), delivered('a')]));
  for (const original of first.inventory.records) {
    assert.deepEqual(added.inventory.records.find((row) => row.vehicleId === original.vehicleId), original);
  }
  assert.equal(added.inventory.revision, first.inventory.revision + 1);
});

test('delivery attaches a VIN once while preserving stock identifiers and source facts', async () => {
  const first = await allocate(emptyAllocationInventory(), plan());
  const original = first.inventory.records[0];
  const second = await allocate(first.inventory, plan([delivered()]));
  assert.equal(second.status, 'ok');
  const row = second.inventory.records[0];
  for (const key of ['orderUuid', 'orderNumber', 'wholesalerOrderId', 'configurationId', 'snapshotVersion', 'originatingDatasetId']) {
    assert.equal(row[key], original[key]);
  }
  assert.equal(offlineVinCheck(row.vin17).valid, true);
  assert.equal(row.vin7, row.vin17.slice(-7));
  const replay = await allocate(second.inventory, plan());
  assert.equal(canonicalAllocationContent(replay.inventory), canonicalAllocationContent(second.inventory));
});

test('a reset run changes stock references while retaining the same physical car VIN and its allocation provenance', async () => {
  const first = await allocate(emptyAllocationInventory(), plan([delivered()]));
  const reset = await allocate(first.inventory, plan([delivered()], { runId: 'run-reset', seed: 'new-run-seed', datasetId: 'reset-dataset' }));
  assert.equal(reset.status, 'ok');
  const old = first.inventory.records[0];
  const current = reset.inventory.records.find((r) => r.runId === 'run-reset');
  assert.notEqual(current.orderUuid, old.orderUuid);
  assert.equal(current.vin17, old.vin17);
  assert.equal(current.vin7, old.vin7);
  assert.deepEqual(current.vinAllocationOrigin, old.vinAllocationOrigin);
  assert.equal(current.vinAllocationOrigin.seed, 'fictional-demo-seed');
  assert.equal(current.vinAllocationOrigin.originatingDatasetId, 'dataset-a');
  assert.equal((await allocate(first.inventory, plan([delivered('vehicle-a', { snapshotVersion: 'new-snapshot' })],
    { runId: 'run-reset' }))).status, 'version-conflict');
});

test('new seed, version, snapshot, configuration and profile changes cannot replace published identities', async () => {
  const first = await allocate(emptyAllocationInventory(), plan([delivered()]));
  for (const change of [{ seed: 'changed-seed' }, { corpusVersion: 'new-corpus' }, { generatorVersion: 'future-version' }]) {
    assert.equal((await allocate(first.inventory, plan([delivered()], change))).status, 'version-conflict');
  }
  for (const change of [{ configurationId: Buffer.from('OTHER:REFERENCE').toString('base64') },
    { snapshotVersion: 'new-snapshot' }, { configuration: { ...fixtures[0].configuration, effectDate: '2027-01-05' } },
    { profileId: fixtures[1].profileId }, { profileVersion: '2' }, { registryVersion: 'future-profiles' }]) {
    assert.equal((await allocate(first.inventory, plan([delivered('vehicle-a', change)]))).status, 'version-conflict', JSON.stringify(change));
  }
  assert.equal(first.inventory.records[0].configurationId, configurationId);
  assert.equal((await allocate(first.inventory, plan([car('new')], { corpusVersion: 'new-corpus' }))).status, 'version-conflict');
});

test('whole retained inventory resolves cross-dataset and cross-run VIN7/VIN17 collisions finitely', async () => {
  const inventory = emptyAllocationInventory({ serialSpace: 3, maxAttempts: 3 });
  const first = await allocate(inventory, plan([delivered('a')]));
  const second = await allocate(first.inventory, plan([delivered('b')], { datasetId: 'dataset-b', seed: 'another-seed' }));
  assert.equal(second.status, 'ok');
  const third = await allocate(second.inventory, plan([delivered('c')], { runId: 'run-b', datasetId: 'dataset-c' }));
  assert.equal(third.status, 'ok');
  assert.equal(new Set(third.inventory.records.map((row) => row.vin17)).size, 3);
  assert.equal(new Set(third.inventory.records.map((row) => row.vin7)).size, 3);
  const before = canonicalAllocationContent(third.inventory);
  const exhausted = await allocate(third.inventory, plan([car('new-stock'), delivered('d')], { datasetId: 'dataset-d' }));
  assert.equal(exhausted.status, 'exhausted');
  assert.equal(exhausted.reason, 'vin-serial-space');
  assert.equal(exhausted.attempts, 3);
  assert.ok(exhausted.collisions >= 3);
  assert.equal(exhausted.inventory, undefined);
  assert.equal(canonicalAllocationContent(third.inventory), before);
});

test('leading zero order numbers and forced order collisions/exhaustion are deterministic per run', async () => {
  const inventory = emptyAllocationInventory({ orderNumberSpace: 2, maxAttempts: 2 });
  const result = await allocate(inventory, plan([car('a'), car('b')]));
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.inventory.records.map((r) => r.orderNumber).sort(), ['0000000', '0000001']);
  assert.equal((await allocate(result.inventory, plan([car('c')]))).reason, 'order-number-space');
  const anotherRun = await allocate(result.inventory, plan([car('a')], { runId: 'run-b' }));
  assert.equal(anotherRun.status, 'ok');
  assert.notEqual(anotherRun.inventory.records[2].orderUuid, result.inventory.records[0].orderUuid);
  assert.equal((await allocate(emptyAllocationInventory({ wholesalerSpace: 1, maxAttempts: 1 }), plan([car('a'), car('b')]))).reason, 'wholesaler-space');
});

test('invalid requests, stale base, duplicate vehicles and malformed inventories publish nothing', async () => {
  const inventory = emptyAllocationInventory();
  assert.equal((await allocate(inventory, plan(), 1)).status, 'stale-revision');
  for (const request of [plan([car('a'), car('a')]), plan([car('x', { usage: 'corpus' })]),
    plan([car('x', { vin17: 'untrusted-input' })]), plan([car('x', { snapshotVersion: '' })]),
    plan([car('x', { configurationId: '' })]), plan([], { seed: '' }), plan([car()], { vin17: 'untrusted-input' }),
    plan([delivered('x', { profileId: 'UK-OBS-001' })])]) {
    assert.notEqual((await allocate(inventory, request)).status, 'ok');
  }
  assert.equal(inventory.records.length, 0);
  assert.equal((await allocate({ ...inventory, records: [{}] }, plan())).status, 'invalid-inventory');
});

test('file persistence survives restart, refuses stale/competing writers and preserves atomic failure', async (t) => {
  const directory = await temporary(t); const file = path.join(directory, 'inventory.json');
  const first = await allocateInventoryFile({ path: file, expectedRevision: 0, plan: plan([delivered()]) });
  assert.equal(first.status, 'ok');
  const original = await readFile(file, 'utf8');
  assert.equal((await readAllocationInventory(file)).status, 'ok');
  const replay = await allocateInventoryFile({ path: file, expectedRevision: 1, plan: plan([delivered()]) });
  assert.equal(replay.status, 'ok');
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal((await allocateInventoryFile({ path: file, expectedRevision: 0, plan: plan([car('b')]) })).status, 'stale-revision');
  await writeFile(file + '.lock', 'other-owner');
  assert.equal((await allocateInventoryFile({ path: file, expectedRevision: 1, plan: plan() })).status, 'competing-writer');
  await rm(file + '.lock');
  const bad = plan([car('b'), delivered('c', { profileId: 'UK-OBS-001' })]);
  assert.notEqual((await allocateInventoryFile({ path: file, expectedRevision: 1, plan: bad })).status, 'ok');
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(await readdir(directory), ['inventory.json']);
});

test('independent concurrent file publishers cannot overwrite a winner', async (t) => {
  const directory = await temporary(t); const file = path.join(directory, 'inventory.json');
  const results = await Promise.all([allocateInventoryFile({ path: file, expectedRevision: 0, plan: plan([car('a')]) }),
    allocateInventoryFile({ path: file, expectedRevision: 0, plan: plan([car('b')]) })]);
  assert.equal(results.filter((r) => r.status === 'ok').length, 1);
  assert.ok(results.some((r) => ['competing-writer', 'stale-revision'].includes(r.status)));
  assert.equal((await readAllocationInventory(file)).inventory.records.length, 1);
});

test('corrupt or unavailable persisted inventory is never mistaken for an empty registry', async (t) => {
  const directory = await temporary(t); const file = path.join(directory, 'inventory.json');
  await writeFile(file, '{');
  assert.equal((await readAllocationInventory(file)).status, 'invalid-inventory');
  assert.equal((await allocateInventoryFile({ path: file, expectedRevision: 0, plan: plan() })).status, 'invalid-inventory');
  assert.equal(await readFile(file, 'utf8'), '{');
  assert.equal((await readAllocationInventory(directory)).status, 'source-unavailable');
  const generated = await allocate(emptyAllocationInventory(), plan([delivered()]));
  const corrupt = structuredClone(generated.inventory);
  corrupt.records[0].vin17 = corrupt.records[0].vin17.slice(0, 8) + (corrupt.records[0].vin17[8] === '0' ? '1' : '0') + corrupt.records[0].vin17.slice(9);
  const { contentDigest, ...content } = corrupt;
  corrupt.contentDigest = inputDigest(content);
  await writeFile(file, JSON.stringify(corrupt));
  assert.equal((await readAllocationInventory(file)).status, 'invalid-inventory');
});

const context = { runId: 'run-a', environmentId: 'demo', principalId: 'offline-publisher', roles: ['presenter'] };
async function repositoryFixture(t) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store, now: () => '2026-11-05T00:00:00.000Z' });
  await repository.open(); t.after(() => repository.close());
  await repository.transaction(context, { commandId: 'create-run', inputDigest: inputDigest('create-run') },
    (tx) => tx.insert('runs', { runId: 'run-a', environmentId: 'demo', status: 'active', current: true }));
  return { repository, store };
}

test('stock importer uses foundation transaction port and persists only unreleased order projection', async (t) => {
  const { repository, store } = await repositoryFixture(t);
  const generated = await allocate(emptyAllocationInventory(), plan([car('a'), delivered('b'), car('current', { usage: 'current-car', profileId: fixtures[0].profileId, referenceOnly: true })]));
  const out = await publishStockOrders({ repository, context, inventory: generated.inventory, expectedRunVersion: 1, commandId: 'import' });
  assert.equal(out.status, 'ok');
  const rows = (await repository.query(context, 'stock')).value;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.state, 'unreleased');
    assert.equal(row.available, false);
    assert.equal(row.vin17, undefined);
    assert.equal(row.vin7, undefined);
    assert.equal(JSON.stringify(row).includes('vin17'), false);
    assert.equal(row.facts.syntheticIdentity.identityKind, 'synthetic');
  }
  const reopened = createMemoryRepository({ store }); await reopened.open(); t.after(() => reopened.close());
  assert.deepEqual((await reopened.query(context, 'stock')).value, rows);
  assert.equal((await publishStockOrders({ repository, context, inventory: generated.inventory, expectedRunVersion: 1, commandId: 'import' })).status, 'ok');
});

test('stale repository publisher and existing identifier conflict roll back the entire stock batch', async (t) => {
  const { repository } = await repositoryFixture(t);
  const generated = await allocate(emptyAllocationInventory(), plan([car('a'), car('b')]));
  const args = { repository, context, inventory: generated.inventory, expectedRunVersion: 2, commandId: 'stale' };
  assert.equal((await publishStockOrders(args)).status, 'stale-version');
  assert.equal((await repository.query(context, 'stock')).value.length, 0);
  const existing = generated.inventory.records[1];
  await repository.transaction(context, { commandId: 'other', inputDigest: inputDigest('other') }, (tx) => tx.insert('stock',
    { runId: 'run-a', orderUuid: 'preexisting-stock', orderNumber: existing.orderNumber, configurationId }));
  assert.equal((await publishStockOrders({ ...args, expectedRunVersion: 1, commandId: 'conflict' })).status, 'conflict');
  assert.deepEqual((await repository.query(context, 'stock')).value.map((r) => r.orderUuid), ['preexisting-stock']);
  assert.equal((await repository.read(context, { table: 'runs', key: { runId: 'run-a' } })).value.version, 1);
});

test('repository additions preserve operational stock state and reject changed associations', async (t) => {
  const { repository } = await repositoryFixture(t);
  const first = await allocate(emptyAllocationInventory(), plan());
  const args = { repository, context, inventory: first.inventory, expectedRunVersion: 1, commandId: 'first' };
  assert.equal((await publishStockOrders(args)).status, 'ok');
  const uuid = first.inventory.records[0].orderUuid;
  await repository.transaction(context, { commandId: 'release', inputDigest: inputDigest('release') },
    (tx) => tx.compareAndSwap({ table: 'stock', key: { runId: 'run-a', orderUuid: uuid } }, 1, { state: 'held', available: false }));
  const added = await allocate(first.inventory, plan([car('b')]));
  assert.equal((await publishStockOrders({ ...args, inventory: added.inventory, expectedRunVersion: 2, commandId: 'added' })).status, 'ok');
  assert.equal((await repository.read(context, { table: 'stock', key: { runId: 'run-a', orderUuid: uuid } })).value.state, 'held');
  assert.equal((await repository.query(context, 'stock')).value.length, 2);
  const staleArtifact = await publishStockOrders({ ...args, inventory: first.inventory, expectedRunVersion: 3, commandId: 'stale-artifact' });
  assert.equal(staleArtifact.status, 'conflict');
  assert.equal(staleArtifact.reason, 'inventory-version-conflict');
  assert.equal((await repository.read(context, { table: 'runs', key: { runId: 'run-a' } })).value.version, 3);
});

test('employee presentation exposes orderNumber only and truthful synthetic/profile/failure context', async () => {
  const generated = await allocate(emptyAllocationInventory(), plan([car('a'), delivered('b')]));
  const stock = presentSyntheticIdentity({ status: 'ok', record: generated.inventory.records[0] });
  assert.equal(stock.orderReference, generated.inventory.records[0].orderNumber);
  for (const hidden of ['orderUuid', 'configurationId', 'wholesalerOrderId', 'vehicleId', 'vin7', 'vin17', 'serial']) assert.equal(stock[hidden], undefined);
  assert.equal(stock.identityKind, 'synthetic');
  const delivery = presentSyntheticIdentity({ status: 'ok', record: generated.inventory.records[1] });
  assert.equal(delivery.referenceOnly, true);
  assert.equal(delivery.productionDate, null);
  assert.equal(delivery.registrationDate, null);
  assert.match(delivery.notice, /fictional/i);
  assert.ok(delivery.sources.length);
  for (const status of ['unsupported', 'identity-mismatch', 'source-unavailable', 'invalid-input', 'collision', 'exhausted', 'stale-revision', 'competing-writer']) {
    const shown = presentSyntheticIdentity({ status, reason: status });
    assert.equal(shown.status, status);
    assert.equal(shown.orderReference, undefined);
    assert.ok(shown.message);
  }
  const resolvedCollision = presentSyntheticIdentity({ status: 'ok', record: generated.inventory.records[0], collisions: 1 });
  assert.equal(resolvedCollision.collisionsResolved, 1);
  assert.match(resolvedCollision.collisionMessage, /resolved/i);
  const current = await allocate(emptyAllocationInventory(), plan([delivered('current', { usage: 'current-car' })]));
  const currentPresentation = presentSyntheticIdentity({ status: 'ok', record: current.inventory.records[0] });
  assert.equal(currentPresentation.vin17, undefined);
  assert.equal(currentPresentation.vin7, undefined);
});

test('offline CLI repeats persisted allocation and fails without partial publication', async (t) => {
  const directory = await temporary(t); const file = path.join(directory, 'inventory.json'); const input = path.join(directory, 'plan.json');
  await writeFile(input, JSON.stringify(plan()));
  const cli = (revision) => spawnSync(process.execPath, ['server/scripts/generate-synthetic-vins.mjs', '--inventory', file, '--plan', input,
    '--expected-revision', String(revision)], { cwd: process.cwd(), timeout: 10000, encoding: 'utf8' });
  const first = cli(0); assert.equal(first.status, 0, first.stderr);
  const original = await readFile(file, 'utf8');
  assert.equal(cli(1).status, 0);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(cli(0).status, 1);
  assert.equal(await readFile(file, 'utf8'), original);
});
