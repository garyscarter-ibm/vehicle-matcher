import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createConfiguredVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/vehicle-lookup.js';
import { calculateVinCheckDigit } from '../gcsp/vehicle-evidence/vin-generator.js';
import { createBmwVinGuideAdapter, createBmwVinGuideIdentityGuard } from '../vehicle-evidence/bmw-vin-guide-adapter.js';
import { options } from './helpers/vin-corpus-fixture.js';
import { inputDigest } from '../gcsp/repository/index.js';
import { offlineFixture, alternateDocument, unknownVin, get, route, listenFixture } from './helpers/offline-vehicle-fixture.js';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

const boundaries = ['private-key', 'encryption', 'manual', 'pdf', 'cosy-image', 'image', 'decoder', 'redirect'];
async function assertExternalDenied(registry, vin, instrumentation, context = {}) {
  let authorisations = 0;
  const guard = createBmwVinGuideIdentityGuard({ registry, authorizeExternalLookup: async () => {
    authorisations++; return { status: 'forbidden' };
  } });
  for (const boundary of boundaries) {
    const live = { id: `live-${boundary}`, version: '1', sourceKind: 'authorised-live', resolve: instrumentation.boundary(boundary) };
    // Guard applies to primary selection, outage fallback, and an attempted switch from synthetic mode.
    for (const adapter of [createBmwVinGuideAdapter({ provider: live, fallbackProvider: live, guard }),
      createBmwVinGuideAdapter({ provider: { id: 'offline-guide', version: '1', sourceKind: 'synthetic',
        resolve: async () => ({ status: 'source-unavailable' }) }, fallbackProvider: live, guard })]) {
      assert.equal((await adapter.resolve({ vin, locale: 'en-GB', identityKind: 'real', provider: 'live' }, context)).status,
        /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? 'source-unavailable' : 'invalid-input');
    }
  }
  const classification = await registry.classifyIdentity(vin);
  if (classification.status !== 'not-found') assert.equal(authorisations, 0, 'known/unavailable identities denied before independent real authorization');
  instrumentation.assertZero();
}

test('actual persisted identities deny every live pre-key/content/decoder/redirect boundary through errors, history and restart', async (t) => {
  const instrumentation = offlineEgressGuard(t);
  // Verify the transport tripwire really observes an attempted external call, then reset its test control.
  assert.throws(() => https.request('https://example.invalid/'), /Offline boundary denied/);
  assert.deepEqual(instrumentation.calls.splice(0), ['https.request']);
  const f = await offlineFixture(t); const vin = f.vins[0].vin17;
  assert.equal(vin[8], calculateVinCheckDigit(vin).character, 'synthetic VIN passes its supported structural checksum');
  const consumer = createConfiguredVehicleDetails({ lookup: f.lookup });
  const checks = [];
  for (const request of [{ kind: 'vin', id: vin }, { kind: 'configuration', id: f.configurations.find((r) => r.catalogue).configurationId },
    { kind: 'vin', id: 'invalid' }, { kind: 'vin', id: unknownVin },
    { kind: 'vin', id: vin, expected: { configurationId: f.configurations.find((r) => r.configurationId !== f.vins[0].configurationId).configurationId } }]) {
    const result = await consumer.resolve(request, { context: f.context }); checks.push(result.status);
    await assertExternalDenied(f.registry, request.id, instrumentation, { ...f.context, identityKind: 'real', externallyAuthorised: true });
  }
  assert.deepEqual(checks, ['partial', 'complete', 'invalid-input', 'not-found', 'identity-mismatch']);
  for (const flags of [{}, { identityKind: 'real' }, { synthetic: false, provider: 'live' }, { baseUrl: 'https://example.invalid/' }]) {
    const request = { kind: 'vin', id: vin, ...flags };
    assert.equal((await consumer.resolve(request, { context: f.context })).status, Object.keys(flags).length ? 'invalid-input' : 'partial');
  }
  for (const provider of ['live', 'bmw', 'drivers-guide', 'third-party-decoder', 'https://example.invalid/']) {
    assert.throws(() => createConfiguredVehicleDetails({ provider, lookup: f.lookup }), TypeError);
  }
  const base = await listenFixture(t, f, instrumentation.boundary('retail'));
  assert.equal((await get(base, `${route({ kind: 'vin', id: vin })}?identityKind=real&provider=live&url=https://example.invalid/`)).code, 400);
  // A missing independent inventory must deny even though the active facts are cached.
  const inventory = join(f.root, 'identity-inventory.json'); await rename(inventory, `${inventory}.held`);
  assert.equal((await consumer.resolve({ kind: 'vin', id: vin })).status, 'source-unavailable');
  await assertExternalDenied(f.registry, vin, instrumentation, f.context);
  await rename(`${inventory}.held`, inventory);
  const validHistory = await readFile(inventory, 'utf8'); await writeFile(inventory, '{corrupt');
  assert.equal((await consumer.resolve({ kind: 'vin', id: vin })).status, 'source-unavailable');
  await assertExternalDenied(f.registry, vin, instrumentation, f.context); await writeFile(inventory, validHistory);
  // Whole-inventory validation includes the current-run stock snapshot, not just the row's browser-shaped facts.
  for (const mutate of [(run) => { delete run.versions.syntheticIdentityInventory.snapshot; },
    (run) => { run.versions.syntheticIdentityInventory.snapshot.records[0].orderUuid = f.stock[1].orderUuid; }]) {
    const brokenRepository = { ...f.repository, currentRun: async (environment) => {
      const result = await f.repository.currentRun(environment); mutate(result.value); return result;
    } };
    const lookup = createVehicleEvidenceLookup({ registry: f.registry, repository: brokenRepository });
    assert.equal((await createConfiguredVehicleDetails({ lookup }).resolve({ kind: 'stock', id: f.stock[0].orderUuid }, { context: f.context })).status, 'source-unavailable');
  }
  // A delivered VIN association is not mutable stock, even if its order has the same target format.
  const deliveredInventory = structuredClone(f.input.allocationInventory);
  for (const row of deliveredInventory.records) { row.runId = f.context.runId; row.usage = 'delivered-car'; }
  const { contentDigest: oldDigest, ...content } = deliveredInventory; deliveredInventory.contentDigest = inputDigest(content);
  const deliveredRepository = { ...f.repository, currentRun: async (environment) => {
    const result = await f.repository.currentRun(environment);
    result.value.versions.syntheticIdentityInventory = { revision: deliveredInventory.revision,
      contentDigest: deliveredInventory.contentDigest, snapshot: deliveredInventory }; return result;
  } };
  const deliveredLookup = createVehicleEvidenceLookup({ registry: f.registry, repository: deliveredRepository });
  let deliveredReads = 0;
  const deliveredConsumer = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: deliveredLookup,
    alternateRead: () => { deliveredReads++; throw Error('delivered identity cannot enter stock adapter'); } });
  assert.equal((await deliveredConsumer.resolve({ kind: 'stock', id: deliveredInventory.records[0].orderUuid }, { context: f.context })).status, 'identity-mismatch');
  assert.equal(deliveredReads, 0);
  const unsupported = createSyntheticRegistry({ root: f.root, ...options,
    profileRegistry: { resolve: async () => ({ status: 'unsupported' }) } });
  assert.equal((await unsupported.load()).status, 'source-unavailable');
  assert.equal((await createConfiguredVehicleDetails({ lookup: createVehicleEvidenceLookup({ registry: unsupported }) }).resolve({ kind: 'vin', id: vin })).status, 'source-unavailable');
  await assertExternalDenied(unsupported, vin, instrumentation, f.context);
  assert.equal((await f.registry.deactivate()).status, 'ok');
  assert.equal((await consumer.resolve({ kind: 'vin', id: vin })).status, 'source-unavailable');
  await assertExternalDenied(f.registry, vin, instrumentation, f.context);
  const reopened = createSyntheticRegistry({ root: f.root, ...options });
  assert.equal((await reopened.load()).status, 'source-unavailable');
  assert.equal((await reopened.classifyIdentity(vin)).identityKind, 'synthetic');
  await assertExternalDenied(reopened, vin, instrumentation, f.context);
  // Reactivation uses the retained association; corrupted immutable bytes fail a fresh load.
  assert.equal((await f.registry.publish(f.candidate)).status, 'ok');
  const active = JSON.parse(await readFile(join(f.root, 'active.json'), 'utf8'));
  await rm(join(f.root, 'versions', active.selected.directory, 'images.jsonl'));
  const corrupted = createSyntheticRegistry({ root: f.root, ...options });
  assert.equal((await corrupted.load()).status, 'source-unavailable');
  assert.equal((await createConfiguredVehicleDetails({ lookup: createVehicleEvidenceLookup({ registry: corrupted }) }).resolve({ kind: 'vin', id: vin })).status, 'source-unavailable');
  await assertExternalDenied(corrupted, vin, instrumentation, f.context);
  const absent = createSyntheticRegistry({ root: join(f.scratch, 'absent'), ...options });
  assert.equal((await absent.load()).status, 'source-unavailable');
  assert.equal((await createConfiguredVehicleDetails({ lookup: createVehicleEvidenceLookup({ registry: absent }) }).resolve({ kind: 'vin', id: vin })).status, 'source-unavailable');
  await assertExternalDenied(absent, vin, instrumentation, f.context);
  instrumentation.assertZero(); t.diagnostic(`FUCQ57_PROOF ${JSON.stringify({ matrix: 'complete/partial/invalid/miss/mismatch/missing-corrupt-inventory/unsupported-profile/deactivated/restart/corrupt-absent-corpus/flags/switch/fallback', externalCalls: 0, namedBoundaries: boundaries })}`);
});

test('bounded retries/redirects, delayed classification, alternate substitution and a reset race never enter live paths', async (t) => {
  const instrumentation = offlineEgressGuard(t); const f = await offlineFixture(t);
  const request = { kind: 'vin', id: f.vins[0].vin17 };
  for (const transportStatus of [301, 302, 307, 308, 404, 503]) {
    let attempts = 0;
    const consumer = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup, maxAttempts: 2,
      alternateRead: async () => { attempts++; return { transportStatus, location: `https://example.invalid/${request.id}` }; } });
    assert.equal((await consumer.resolve(request)).status, 'source-unavailable'); assert.equal(attempts, 2);
  }
  let timedAttempts = 0;
  const timeout = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup, timeoutMs: 5, maxAttempts: 2,
    alternateRead: async (_, { signal }) => { timedAttempts++; return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ transportStatus: 503 }), { once: true })); } });
  assert.equal((await timeout.resolve(request)).status, 'source-unavailable'); assert.equal(timedAttempts, 2);
  let reads = 0;
  const delayed = createConfiguredVehicleDetails({ lookup: { resolve: () => { reads++; throw Error('must not read'); } },
    identityLookup: { classifyRequest: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 15)); return f.lookup.classifyRequest(...args); } }, timeoutMs: 2, maxAttempts: 2 });
  assert.equal((await delayed.resolve(request)).status, 'source-unavailable');
  await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(reads, 0);
  let misses = 0;
  const miss = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup,
    alternateRead: () => { misses++; throw Error('a miss cannot fall through'); } });
  assert.equal((await miss.resolve({ kind: 'vin', id: unknownVin })).status, 'not-found'); assert.equal(misses, 0);
  const original = await f.lookup.resolve(request);
  const substituted = alternateDocument(original); substituted.card.identifiers.composition = f.configurations.find((r) => r.configurationId !== original.identity.configurationId).configurationId;
  const alternate = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup, alternateRead: () => ({ document: substituted }) });
  assert.equal((await alternate.resolve(request)).status, 'identity-mismatch');
  const stockRequest = { kind: 'stock', id: f.stock[0].orderUuid }; const before = (await f.clock.readState(f.context)).value;
  const racing = createConfiguredVehicleDetails({ provider: 'alternate-offline', identityLookup: f.lookup,
    alternateRead: async () => {
      const w = await f.lookup.resolve(stockRequest, { context: f.context });
      assert.equal((await f.clock.reset(f.context, { commandId: 'racing-reset', expectedRunId: before.runId,
        expectedRunVersion: before.runVersion, scenarioVersion: before.versions.scenario, fixtureVersion: before.versions.fixture })).status, 'ok');
      return { document: alternateDocument(w, f.context) };
    } });
  assert.equal((await racing.resolve(stockRequest, { context: f.context })).status, 'identity-mismatch');
  await assertExternalDenied(f.registry, request.id, instrumentation, f.context);
  instrumentation.assertZero(); t.diagnostic(`FUCQ57_PROOF ${JSON.stringify({ matrix: 'two-attempt redirect/error/timeout; classifier deadline; unknown miss; immutable substitution; actual DemoClock reset race', externalCalls: 0 })}`);
});
