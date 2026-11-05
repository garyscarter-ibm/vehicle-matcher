import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { allocateSyntheticIdentities } from '../gcsp/vehicle-evidence/vin-allocation.js';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { vehicleEvidenceHttpStatus } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { options } from './helpers/vin-corpus-fixture.js';
import { offlineFixture, listenFixture, get, route, alternateDocument, unknownVin } from './helpers/offline-vehicle-fixture.js';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

test('five actual WMI allocations publish/load and agree through HTTP, in-process consumer and alternate offline shapes', async (t) => {
  const guard = offlineEgressGuard(t); const f = await offlineFixture(t);
  const base = await listenFixture(t, f, guard.boundary('retail-provider'));
  assert.deepEqual(f.receipt.counts, { configurations: 6, distinctConfigurations: 6, vinMappings: 5, images: 0 });
  assert.deepEqual(f.receipt.coverage.wmis, { WBA: 1, WBS: 1, WBY: 1, '5UX': 1, '5YM': 1 });
  assert.deepEqual(f.receipt.coverage.markets, { US: 5, GB: 1 });
  assert.deepEqual(f.receipt.coverage.steering, { LHD: 5, unknown: 1 });
  const consumer = createConfiguredVehicleDetails({ lookup: f.lookup });
  const kinds = { composition: 'configuration', order: 'stock', delivered: 'vin' };
  const alternate = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup,
    alternateRead: async ({ category, token }, { context }) => ({ document: alternateDocument(await f.lookup.resolve({ kind: kinds[category], id: token }, { context }), context) }) });
  const requests = [...f.configurations.map((r) => ({ kind: 'configuration', id: r.configurationId })),
    ...f.stock.map((r) => ({ kind: 'stock', id: r.orderUuid })), ...f.vins.map((r) => ({ kind: 'vin', id: r.vin17 })),
    { kind: 'vin', id: unknownVin }, { kind: 'vin', id: 'invalid' }];
  const statuses = {};
  for (const request of requests) {
    const direct = await f.lookup.resolve(request, { context: f.context });
    const http = await get(base, route(request));
    assert.equal(http.code, vehicleEvidenceHttpStatus(direct)); assert.deepEqual(http.body, direct);
    assert.equal(http.headers['cache-control'], 'no-store');
    const consumed = await consumer.resolve(request, { context: f.context });
    const switched = await alternate.resolve(request, { context: f.context });
    assert.equal(consumed.status, direct.status, `in-process ${JSON.stringify(request)}`);
    assert.equal(switched.status, direct.status, `alternate ${JSON.stringify(request)}`);
    assert.deepEqual(switched.vehicle, consumed.vehicle);
    statuses[direct.status] = (statuses[direct.status] || 0) + 1;
    if (consumed.vehicle) {
      const v = consumed.vehicle;
      assert.deepEqual(v, Object.fromEntries(Object.keys(v).map((key) => [key, http.body[key]])));
      assert.equal(v.presentation.syntheticLabel, 'Synthetic identity');
      assert.equal(v.equipment.verifiedFitted.state, 'unknown');
      assert.deepEqual(v.images, { state: 'unknown', label: 'Images unavailable', items: [] });
      assert.equal(v.technical.luggageNormal.unit, 'LITRES');
      assert.equal(v.technical.acceleration.unit, 'SECONDS');
      assert.equal(v.technical.bodyLength.unit, 'MILLIMETRES');
      assert.equal(v.source.observedDate, '2026-11-01');
      assert.equal(v.identity.vin, request.kind === 'vin' ? request.id : null);
      if (v.source.kind === 'north-american-reference') {
        assert.equal(v.source.market, 'US'); assert.equal(v.source.steering, 'LHD');
        assert.equal(v.description.paint.state, 'unknown'); assert.equal(v.status, undefined);
        assert.equal(direct.status, 'partial'); assert.equal(v.source.completeVinDecoded, false);
        if (v.source.profile?.profileId === 'wbs-m3-competition-xdrive-my2026') {
          assert.ok(v.source.profileSources.some((source) => source.id === 'PLANT-F' && source.source.endsWith('?language=en')));
        }
      } else { assert.equal(direct.status, 'complete'); assert.equal(v.source.steering, null); }
    }
  }
  assert.deepEqual(statuses, { partial: 15, complete: 1, 'not-found': 1, 'invalid-input': 1 });
  guard.assertZero(); t.diagnostic(`FUCQ57_PROOF ${JSON.stringify({ ...f.receipt, statuses, externalCalls: 0 })}`);
});

test('actual approved fictional image contracts preserve both representative roles and unknown fitting across the provider switch', async (t) => {
  const guard = offlineEgressGuard(t); const f = await offlineFixture(t, { imageContracts: true });
  const direct = createConfiguredVehicleDetails({ lookup: f.lookup });
  const alternate = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup,
    alternateRead: async ({ token }) => ({ document: alternateDocument(await f.lookup.resolve({ kind: 'configuration', id: token })) }) });
  for (const image of f.input.images) {
    const request = { kind: 'configuration', id: image.configurationId };
    const a = await direct.resolve(request); const b = await alternate.resolve(request);
    assert.equal(a.status, 'partial'); assert.deepEqual(a.vehicle, b.vehicle);
    assert.equal(a.vehicle.images.state, 'representative');
    assert.equal(a.vehicle.images.items[0].role, image.role); assert.equal(a.vehicle.images.items[0].fidelity, image.fidelity);
    assert.match(a.vehicle.images.items[0].asset, /^fixture-only\/no-runtime-asset/);
    assert.equal(a.vehicle.equipment.verifiedFitted.state, 'unknown');
  }
  guard.assertZero(); t.diagnostic(`FUCQ57_PROOF ${JSON.stringify({ imageContractOnly: true, realAssets: 0,
    roles: f.input.images.map((image) => image.role), externalCalls: 0 })}`);
});

test('reorder/resume/addition and durable reload preserve identities; reset changes stock/employees only', async (t) => {
  const guard = offlineEgressGuard(t); const f = await offlineFixture(t);
  const originals = structuredClone(f.vins);
  const vehicles = f.input.configurations.slice(0, 5).map((r, i) => ({ vehicleId: `reference-vehicle-${i + 1}`,
    configurationId: r.configurationId, snapshotVersion: r.snapshotVersion, configuration: r.configuration,
    usage: 'current-car', profileId: f.input.allocationInventory.records.find((x) => x.configurationId === r.configurationId).profile.profileId, referenceOnly: true }));
  const plan = { runId: 'fixture-run', seed: 'fictional-publication-seed', corpusVersion: 'reference-corpus.v1',
    datasetId: f.input.metadata.datasetId, vehicles: [...vehicles].reverse() };
  const resumed = await allocateSyntheticIdentities(f.input.allocationInventory, plan, { expectedRevision: f.input.allocationInventory.revision });
  assert.equal(resumed.status, 'ok'); assert.deepEqual(resumed.inventory, f.input.allocationInventory);
  const added = await allocateSyntheticIdentities(resumed.inventory, { ...plan, vehicles: [...plan.vehicles,
    { ...vehicles[0], vehicleId: 'added-stock-only', usage: 'stock' }] }, { expectedRevision: resumed.inventory.revision });
  assert.equal(added.status, 'ok');
  const changedInput = { ...f.input, metadata: { ...f.input.metadata, version: '2' }, allocationInventory: added.inventory };
  const next = join(f.scratch, 'additional'); assert.equal((await writeCorpusCandidate(next, changedInput, options)).status, 'ok');
  assert.equal((await f.registry.publish(next)).status, 'ok');
  const reopened = createSyntheticRegistry({ root: f.root, ...options }); assert.equal((await reopened.load()).status, 'ok');
  for (const row of originals) assert.deepEqual(reopened.getVin(row.vin17).vehicle, row);
  const beforeBytes = await Promise.all(['active.json', 'identity-inventory.json'].map((name) => readFile(join(f.root, name), 'utf8')));
  const before = (await f.clock.readState(f.context)).value;
  const employee = (await f.repository.query(f.context, 'employees')).value.find((row) => row.roles.includes('employee'));
  assert.equal((await f.repository.transaction(f.context, { commandId: 'alter-person', inputDigest: inputDigest('alter-person') },
    (tx) => tx.compareAndSwap({ table: 'employees', key: { runId: before.runId, employeeId: employee.employeeId } }, 1, { name: 'Changed trial name' }))).status, 'ok');
  const reset = await f.clock.reset(f.context, { commandId: 'reset-proof', expectedRunId: before.runId,
    expectedRunVersion: before.runVersion, scenarioVersion: before.versions.scenario, fixtureVersion: before.versions.fixture });
  assert.equal(reset.status, 'ok', JSON.stringify(reset));
  const fresh = (await f.identity.createPresenterSession('fresh')).value.context;
  const stock = (await f.repository.query(fresh, 'stock')).value;
  assert.equal(stock.length, 5);
  const consumer = createConfiguredVehicleDetails({ lookup: f.lookup });
  for (const old of f.stock) {
    const row = stock.find((r) => r.configurationId === old.configurationId);
    assert.notEqual(row.orderUuid, old.orderUuid); assert.notEqual(row.orderNumber, old.orderNumber);
    assert.equal(Object.hasOwn(row, 'vin'), false); assert.equal(Object.hasOwn(row, 'vin17'), false);
    assert.equal((await consumer.resolve({ kind: 'stock', id: old.orderUuid }, { context: f.context })).status, 'identity-mismatch');
    assert.equal((await consumer.resolve({ kind: 'stock', id: old.orderUuid }, { context: fresh })).status, 'identity-mismatch');
    assert.equal((await consumer.resolve({ kind: 'stock', id: row.orderUuid }, { context: fresh })).status, 'partial');
  }
  assert.equal((await f.repository.read(fresh, { table: 'employees', key: { runId: fresh.runId, employeeId: employee.employeeId } })).value.name, employee.name);
  assert.deepEqual(await Promise.all(['active.json', 'identity-inventory.json'].map((name) => readFile(join(f.root, name), 'utf8'))), beforeBytes);
  for (const row of originals) assert.deepEqual(f.registry.getVin(row.vin17).vehicle, row);
  // Broken active pointer recovers a complete known version; no identity is regenerated.
  await writeFile(join(f.root, 'active.json'), '{broken');
  assert.equal((await reopened.load()).recovered, true);
  for (const row of originals) assert.deepEqual(reopened.getVin(row.vin17).vehicle, row);
  guard.assertZero();
});
