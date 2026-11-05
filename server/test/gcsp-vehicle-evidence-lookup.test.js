import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup, canonicalVehicleIdentifier } from '../gcsp/vehicle-evidence/vehicle-lookup.js';
import { vehicleEvidenceHttpStatus } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { options } from './helpers/vin-corpus-fixture.js';

const candidate = fileURLToPath(new URL('../data/gcsp/vehicle-evidence/publication-reference.v1', import.meta.url));
const context = { runId: 'lookup-run', environmentId: 'lookup-test', principalId: 'fictional-reader', roles: ['employee'] };
const orderUuid = '1d736acd-674c-4bb1-8b6b-45dc56906442';
const rows = (file) => readFile(join(candidate, file), 'utf8').then((s) => s.trim().split('\n').filter(Boolean).map(JSON.parse));

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'vehicle-lookup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const registry = createSyntheticRegistry({ root, ...options });
  assert.equal((await registry.publish(candidate)).status, 'ok');
  const configurations = await rows('configurations.jsonl');
  const [vehicle] = await rows('vins.jsonl');
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  t.after(() => repository.close());
  const configuration = configurations.find((r) => r.configurationId === vehicle.configurationId);
  const stock = { runId: context.runId, orderUuid, orderNumber: '0000123', configurationId: configuration.configurationId,
    corpusVersion: vehicle.corpusVersion, facts: { syntheticIdentity: { vehicleId: 'fictional-stock-car', identityKind: 'synthetic',
      originatingDatasetId: 'lookup-fixture', snapshotVersion: configuration.snapshotVersion,
      configurationHash: inputDigest(configuration.configuration) } } };
  assert.equal((await repository.transaction(context, { commandId: 'seed', inputDigest: inputDigest(stock) }, async (tx) => {
    const run = await tx.insert('runs', { runId: context.runId, environmentId: context.environmentId, status: 'active', current: true });
    if (run.status !== 'ok') return run;
    const inserted = await tx.insert('stock', stock);
    return inserted.status === 'ok' ? ok(true) : inserted;
  })).status, 'ok');
  return { registry, repository, configurations, vehicle, stock,
    lookup: createVehicleEvidenceLookup({ registry, repository }) };
}

test('the three identifiers have separate canonical formats and VIN validation makes no year or checksum assumption', () => {
  const canonical = Buffer.from('T5MJ:FKSFU,P0300,S0337').toString('base64');
  assert.equal(canonicalVehicleIdentifier('configuration', canonical), canonical);
  for (const signature of ['T5MJ:S0337,P0300', 't5mj:P0300', 'T5MJ:p0300', 'T5MJ:P0300,P0300']) {
    assert.equal(canonicalVehicleIdentifier('configuration', Buffer.from(signature).toString('base64')), null);
  }
  assert.equal(canonicalVehicleIdentifier('configuration', canonical.replace(/=+$/, '')), null);
  assert.equal(canonicalVehicleIdentifier('configuration', ` ${canonical}`), null);
  assert.equal(canonicalVehicleIdentifier('stock', orderUuid), orderUuid);
  for (const value of ['0000123', ` ${orderUuid}`, orderUuid.replace('-4bb1-', '-1bb1-')]) {
    assert.equal(canonicalVehicleIdentifier('stock', value), null);
  }
  assert.equal(canonicalVehicleIdentifier('vin', '  zzzzzzzz0zz000000  '), 'ZZZZZZZZ0ZZ000000');
  for (const value of ['1234567', 'ZZZZZZZZIZ0000000', 'ZZZZZZZZ0ZZ00000!', 'ZZZZZZZZ0ZZ 00000']) {
    assert.equal(canonicalVehicleIdentifier('vin', value), null);
  }
});

test('configuration, stock order UUID and current-car VIN resolve the same immutable facts without manufacturing a stock VIN', async (t) => {
  const { lookup, vehicle, stock } = await fixture(t);
  const configuration = await lookup.resolve({ kind: 'configuration', id: vehicle.configurationId });
  const exact = await lookup.resolve({ kind: 'stock', id: orderUuid }, { context });
  const current = await lookup.resolve({ kind: 'vin', id: ` ${vehicle.vin17.toLowerCase()} ` });
  for (const value of [configuration, exact, current]) {
    assert.equal(value.status, 'partial');
    assert.equal(value.identity.configurationId, vehicle.configurationId);
    assert.equal(value.identity.identityKind, 'synthetic');
    assert.deepEqual(value.description, configuration.description);
    assert.deepEqual(value.technical, configuration.technical);
    assert.equal(value.routing.liveEligible, false);
  }
  assert.equal(exact.identity.orderUuid, stock.orderUuid);
  assert.equal(exact.identity.orderNumber, '0000123');
  assert.equal(exact.identity.vin, null);
  assert.equal(current.identity.vin, vehicle.vin17);
  assert.equal(current.identity.vehicleId, vehicle.vehicleId);
  assert.equal(current.identity.originatingDatasetId, vehicle.originatingDatasetId);
  assert.equal(current.source.profile.referenceOnly, true);
  assert.equal(current.source.productionDate, null);
  assert.equal(current.source.registrationDate, null);
  assert.equal(current.equipment.verifiedFitted.state, 'unknown');
  assert.equal(current.description.paint.state, 'unknown');
  assert.equal(current.description.upholstery.state, 'unknown');
});

test('known catalogue facts keep source dates, meaning, units, unknown fields and separate requested/resolved source context', async (t) => {
  const { lookup, configurations } = await fixture(t);
  const row = configurations.find((r) => r.catalogue);
  const result = await lookup.resolve({ kind: 'configuration', id: row.configurationId });
  assert.equal(result.status, 'complete');
  assert.equal(result.technical.luggageNormal.value, 570);
  assert.equal(result.technical.luggageNormal.unit, 'LITRES');
  assert.equal(result.technical.luggageNormal.definition, 'NORMAL');
  assert.equal(result.technical.bodyLength.state, 'unknown');
  assert.equal(result.technical.bodyLength.value, null);
  assert.equal(result.source.observedDate, '2026-11-01');
  assert.equal(result.source.catalogueValidity.productionDate, '2027-01-05');
  assert.equal(result.source.productionDate, null);
  assert.deepEqual(result.source.requestedIdentity, row.catalogue.requestedIdentity);
  assert.deepEqual(result.source.resolvedIdentity, row.catalogue.resolvedIdentity);
  assert.equal(result.description.paint.state, 'known');
  assert.equal(result.description.paint.selections[0].label.value, 'Alpine White');
  assert.equal(result.description.upholstery.selections[0].label.value, 'Perforated and Quilted Veganza in Smoke White');
  assert.equal(result.images.state, 'unknown');
  assert.equal(result.images.label, 'Images unavailable');
  assert.equal(result.presentation.syntheticLabel, 'Synthetic identity');
  assert.equal(result.presentation.verifiedFittedLabel, 'VIN-fitted equipment unknown');
  result.technical.luggageNormal.value = 0;
  assert.equal((await lookup.resolve({ kind: 'configuration', id: row.configurationId })).technical.luggageNormal.value, 570);
});

test('invalid, unknown and unavailable outcomes remain distinct across all three identities and redact arbitrary input', async (t) => {
  const { lookup } = await fixture(t);
  const missing = [
    { kind: 'configuration', id: Buffer.from('UNKNOWN:CODE').toString('base64') },
    { kind: 'stock', id: '6ff0feca-90cd-4e6f-903c-41fad1ef9b91' },
    { kind: 'vin', id: 'ZZZZZZZZ0ZZ000000' },
  ];
  for (const request of missing) {
    const result = await lookup.resolve(request, { context });
    assert.equal(result.status, 'not-found'); assert.equal(vehicleEvidenceHttpStatus(result), 404);
    assert.equal(result.requested.id, null); assert.equal(result.identity, null);
    const invalid = await lookup.resolve({ ...request, id: 'invalid' }, { context });
    assert.equal(invalid.status, 'invalid-input'); assert.equal(vehicleEvidenceHttpStatus(invalid), 400);
    const unavailable = await createVehicleEvidenceLookup().resolve(request, { context });
    assert.equal(unavailable.status, 'source-unavailable'); assert.equal(vehicleEvidenceHttpStatus(unavailable), 503);
  }
  assert.equal((await lookup.resolve(missing[1])).status, 'source-unavailable');
});

test('wrong VIN/configuration/market/body/profile and stock digest associations fail without leaking substituted facts', async (t) => {
  const { lookup, registry, vehicle } = await fixture(t);
  for (const expected of [{ market: 'GB' }, { bodyType: 'Touring' }, { profileId: 'not-the-retained-profile' }]) {
    const outcome = await lookup.resolve({ kind: 'vin', id: vehicle.vin17, expected });
    assert.equal(outcome.status, 'identity-mismatch'); assert.equal(outcome.identity, null);
    assert.equal(vehicleEvidenceHttpStatus(outcome), 409);
  }
  const wrong = createVehicleEvidenceLookup({ registry: { getVin: () => ({ ...registry.getVin(vehicle.vin17),
    vehicle: { ...vehicle, vin17: 'ZZZZZZZZ0ZZ000000' } }) } });
  assert.equal((await wrong.resolve({ kind: 'vin', id: vehicle.vin17 })).status, 'identity-mismatch');
  const stock = { ...registry.getVin(vehicle.vin17).vehicle, orderUuid, orderNumber: '0000001', runId: context.runId,
    facts: { syntheticIdentity: { identityKind: 'synthetic', configurationHash: 'different', snapshotVersion: vehicle.snapshotVersion } } };
  const inconsistent = createVehicleEvidenceLookup({ registry, repository: { currentRun: async () => ok({ runId: context.runId }), read: async () => ok(stock) } });
  assert.equal((await inconsistent.resolve({ kind: 'stock', id: orderUuid }, { context })).status, 'identity-mismatch');
  const unsupported = createVehicleEvidenceLookup({ registry: { getVin: () => ({ status: 'unsupported', failure: { message: 'private source detail' } }) } });
  const result = await unsupported.resolve({ kind: 'vin', id: vehicle.vin17 });
  assert.equal(result.status, 'unsupported'); assert.equal(vehicleEvidenceHttpStatus(result), 422);
  assert.equal(JSON.stringify(result).includes('private source detail'), false);
});

test('a reset/historical stock context cannot return another demo run and record evidence cannot choose live routing', async (t) => {
  const { registry, vehicle, stock } = await fixture(t);
  const changed = createVehicleEvidenceLookup({ registry, repository: { currentRun: async () => ok({ runId: 'next-run' }),
    read: async () => { assert.fail('stale context must fail before stock read'); } } });
  assert.equal((await changed.resolve({ kind: 'stock', id: orderUuid }, { context })).status, 'identity-mismatch');
  const mismatched = createVehicleEvidenceLookup({ registry, repository: { currentRun: async () => ok({ runId: context.runId }),
    read: async () => ok({ ...stock, orderUuid: '6ff0feca-90cd-4e6f-903c-41fad1ef9b91' }) } });
  assert.equal((await mismatched.resolve({ kind: 'stock', id: orderUuid }, { context })).status, 'identity-mismatch');
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => { calls++; throw new Error('live transport forbidden'); };
  t.after(() => { globalThis.fetch = original; });
  const lookup = createVehicleEvidenceLookup({ registry });
  for (const id of [vehicle.vin17, 'ZZZZZZZZ0ZZ000000', 'invalid']) await lookup.resolve({ kind: 'vin', id });
  assert.equal((await lookup.resolve({ kind: 'vin', id: vehicle.vin17, provider: 'live', identityKind: 'real' })).status, 'invalid-input');
  assert.equal(calls, 0);
});
