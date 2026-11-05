import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { createVehicleDetailsConsumer, createConfiguredVehicleDetails as configureVehicleDetails } from '../gcsp/vehicle-evidence/application-vehicle-details.js';
import { createLookupVehicleAdapter } from '../gcsp/vehicle-evidence/lookup-adapter.js';
import { createAlternateOfflineVehicleAdapter } from '../gcsp/vehicle-evidence/alternate-offline-adapter.js';
import { vehicleEvidenceFailure } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp/vehicle-evidence/alternate-provider.json', import.meta.url)));
const context = fixture.context;
// Isolated adapter tests inject a trusted classification double. FUCQ-57's
// integration suites use the actual retained registry and allocator inventory.
const fixtureIdentityLookup = { async classifyRequest(request) {
  const card = fixture.entries.find((e) => e.document.card.query.kind === request.kind
    && e.document.card.query.id === request.id)?.document.card;
  return card ? { status: 'ok', identityKind: 'synthetic', liveEligible: false,
    configurationId: card.identifiers.composition,
    ...(card.identifiers.subject ? { vehicleId: card.identifiers.subject } : {}) }
    : { status: 'not-found', identityKind: 'unknown', liveEligible: false };
} };
const createConfiguredVehicleDetails = (options) => configureVehicleDetails({ identityLookup: fixtureIdentityLookup, ...options });

const [vehicle] = (await readFile(new URL('../data/gcsp/vehicle-evidence/publication-reference.v1/vins.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
const stockEntry = fixture.entries.find((e) => e.key.category === 'order');
const orderUuid = stockEntry.key.token;
const stock = { runId: context.runId, orderUuid, orderNumber: '0000123', configurationId: vehicle.configurationId,
  facts: { syntheticIdentity: { identityKind: 'synthetic', vehicleId: 'fictional-stock-car',
    originatingDatasetId: 'consumer-fixture', snapshotVersion: vehicle.snapshotVersion, configurationHash: vehicle.configurationHash } } };
const repository = { currentRun: async () => ({ status: 'ok', value: { runId: context.runId } }),
  read: async (_context, { key }) => key.orderUuid === orderUuid ? { status: 'ok', value: stock } : { status: 'not-found' } };
const lookup = createLocalVehicleEvidenceLookup({ repository, asOf: '2026-11-05T00:00:00.000Z' });
function offlineRead(key, options) {
  const entry = fixture.entries.find((e) => e.key.category === key.category && e.key.token === key.token);
  const document = !entry ? { edition: 'offline-cards/1', result: 'missing' }
    : entry.context && entry.context.runId !== options.context?.runId ? { edition: 'offline-cards/1', result: 'mismatch' } : entry.document;
  return { document: structuredClone(document), transportStatus: 200 };
}
const providers = () => [createConfiguredVehicleDetails({ lookup }),
  createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: offlineRead })];
const requests = fixture.entries.map((e) => ({ kind: e.document.card.query.kind, id: e.key.token }));
const configuration = requests[0];
const complete = requests[1];

test('both providers give the same complete/partial vehicle, provenance and failure interface for all three identities', async () => {
  const [local, alternate] = providers();
  for (const request of requests) {
    const a = await local.resolve(request, { context }); const b = await alternate.resolve(request, { context });
    assert.equal(a.status, request === complete ? 'complete' : 'partial');
    assert.equal(b.status, a.status); assert.deepEqual(b.vehicle, a.vehicle);
    assert.equal(a.vehicle.identity.identityKind, 'synthetic');
    assert.equal(a.transport.protocol, 'in-process'); assert.equal(a.transport.status, null);
    assert.equal(b.transport.protocol, 'offline'); assert.equal(b.transport.status, 200);
    for (const name of ['provider', 'providerVersion', 'card', 'dimensions', 'portraits']) assert.equal(name in b.vehicle, false);
  }
});

test('the application adapter calls only the public same-process resolve port with canonical identity and trusted context', async () => {
  let calls = 0;
  const consumer = createConfiguredVehicleDetails({ lookup: { resolve: async (request, options) => {
    calls++; assert.deepEqual(request, { kind: 'vin', id: vehicle.vin17 });
    assert.deepEqual(options.context, context); assert.ok(options.signal instanceof AbortSignal);
    return lookup.resolve(request, options);
  } } });
  assert.equal((await consumer.resolve({ kind: 'vin', id: ` ${vehicle.vin17.toLowerCase()} ` }, { context })).status, 'partial');
  assert.equal(calls, 1);
  const result = await consumer.resolve({ kind: 'stock', id: orderUuid });
  assert.equal(result.status, 'source-unavailable'); assert.equal(calls, 1);
});

test('canonical input, missing records and unsupported/outage/mismatch remain typed with no accepted empty object', async () => {
  for (const consumer of providers()) {
    for (const request of [null, {}, { ...configuration, id: configuration.id.replace(/=+$/, '') },
      { kind: 'stock', id: '0000123' }, { kind: 'vin', id: 'ZZZZZZZZIZ0000000' },
      { ...configuration, url: 'https://private.example' }, { ...configuration, provider: 'live' },
      { ...configuration, expected: { unknown: 'field' } }]) {
      const r = await consumer.resolve(request, { context }); assert.equal(r.status, 'invalid-input');
      assert.equal(r.vehicle, null); assert.equal(r.transport.attempts, 0); assert.ok(r.failure.action);
    }
    for (const request of [{ kind: 'vin', id: 'ZZZZZZZZ0ZZ000000' },
      { kind: 'configuration', id: Buffer.from('UNKNOWN:CODE').toString('base64') },
      { kind: 'stock', id: '6ff0feca-90cd-4e6f-903c-41fad1ef9b91' }]) {
      assert.equal((await consumer.resolve(request, { context })).status, 'not-found');
    }
    assert.equal((await consumer.resolve({ kind: 'stock', id: orderUuid }, { context: { ...context, runId: 'old-run' } })).status, 'identity-mismatch');
  }
  for (const [status, alternateStatus] of [['unsupported', 'unsupported'], ['source-unavailable', 'unavailable'], ['identity-mismatch', 'mismatch']]) {
    const both = [createConfiguredVehicleDetails({ lookup: { resolve: () => vehicleEvidenceFailure(status, 'configuration') } }),
      createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: () => ({ document: { edition: 'offline-cards/1', result: alternateStatus } }) })];
    for (const consumer of both) {
      const r = await consumer.resolve(configuration); assert.equal(r.status, status); assert.equal(r.vehicle, null);
      assert.ok(r.failure.message); assert.ok(r.failure.action); assert.equal(r.failure.retryable, status === 'source-unavailable');
    }
  }
});

test('trusted expected identity and model/market/date context pins refuse substitutions with either provider', async () => {
  const base = (await providers()[0].resolve({ kind: 'vin', id: vehicle.vin17 })).vehicle;
  const pins = { configurationId: vehicle.configurationId, vehicleId: vehicle.vehicleId, datasetId: base.identity.datasetId,
    originatingDatasetId: vehicle.originatingDatasetId, corpusVersion: base.versions.corpus,
    snapshotVersion: vehicle.snapshotVersion, market: 'US', model: '430i', bodyType: 'Convertible',
    powertrain: 'petrol', profileId: vehicle.profile.profileId, observedDate: '2026-11-01' };
  for (const consumer of providers()) {
    assert.equal((await consumer.resolve({ kind: 'vin', id: vehicle.vin17, expected: pins })).status, 'partial');
    for (const key of Object.keys(pins)) {
      const r = await consumer.resolve({ kind: 'vin', id: vehicle.vin17, expected: { [key]: 'different' } });
      assert.equal(r.status, 'identity-mismatch', key); assert.equal(r.vehicle, null);
    }
    for (const key of ['effectDate', 'orderDate', 'taxDate', 'catalogueDate', 'agModelCode', 'vgModelCode']) {
      const r = await consumer.resolve({ ...complete, expected: { [key]: 'different' } });
      assert.equal(r.status, 'identity-mismatch', key);
    }
  }
});

test('alternate stock documents must bind the trusted current run and environment before mapping', async () => {
  for (const scope of [undefined, { run: 'old-run', environment: context.environmentId },
    { run: context.runId, environment: 'other-environment' }]) {
    const document = structuredClone(stockEntry.document); document.card.scope = scope;
    const consumer = createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: () => ({ document }) });
    const r = await consumer.resolve({ kind: 'stock', id: orderUuid }, { context });
    assert.equal(r.status, scope ? 'identity-mismatch' : 'source-unavailable'); assert.equal(r.vehicle, null);
  }
});

test('wrong returned VIN/configuration/vehicle identity, source model and requested/resolved context never reach the consumer', async () => {
  const original = await lookup.resolve({ kind: 'vin', id: vehicle.vin17 });
  const completeOriginal = await lookup.resolve(complete);
  for (const mutate of [(w) => { w.identity.vin = 'ZZZZZZZZ0ZZ000000'; },
    (w) => { w.resolved.configurationId = Buffer.from('OTHER:CODE').toString('base64'); },
    (w) => { w.identity.identityKind = 'real'; }, (w) => { w.identity.usage = 'stock'; }]) {
    const w = structuredClone(original); mutate(w);
    const r = await createConfiguredVehicleDetails({ lookup: { resolve: () => w } }).resolve({ kind: 'vin', id: vehicle.vin17 });
    assert.equal(r.status, 'identity-mismatch'); assert.equal(r.vehicle, null);
  }
  for (const mutate of [(w) => { w.source.resolvedIdentity.modelCode = 'OTHER'; },
    (w) => { w.source.resolvedIdentity.market = 'US'; },
    (w) => { w.source.requestedIdentity.effectDate = '2026-01-01'; }]) {
    const w = structuredClone(completeOriginal); mutate(w);
    assert.equal((await createConfiguredVehicleDetails({ lookup: { resolve: () => w } }).resolve(complete)).status, 'identity-mismatch');
  }
  for (const field of ['chassis', 'composition', 'flavour', 'purpose']) {
    const doc = structuredClone(fixture.entries[2].document);
    doc.card.identifiers[field] = field === 'composition' ? Buffer.from('OTHER:CODE').toString('base64') : 'different';
    const consumer = createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: () => ({ document: doc }) });
    assert.equal((await consumer.resolve({ kind: 'vin', id: vehicle.vin17 })).status, 'identity-mismatch', field);
  }
});

test('malformed/versioned/truncated payloads, wrong units and impossible evidence are source-unavailable for both boundaries', async () => {
  for (const value of [null, {}, 'not JSON', [], { contractVersion: '99', schemaVersion: '1' }]) {
    const local = createConfiguredVehicleDetails({ lookup: { resolve: () => value } });
    assert.equal((await local.resolve(configuration)).status, 'source-unavailable');
  }
  for (const document of [null, {}, 'not JSON', '{"edition":', JSON.stringify({ edition: 'offline-cards/2' }),
    { edition: 'offline-cards/1', result: 'complete', card: {} }]) {
    const alternate = createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: () => ({ document }) });
    assert.equal((await alternate.resolve(configuration)).status, 'source-unavailable');
  }
  for (const mutate of [(w) => { w.technical.seats.unit = 'LITRES'; },
    (w) => { w.technical.seats.value = Number.NaN; }, (w) => { w.description.paint = {}; },
    (w) => { w.equipment.verifiedFitted.state = 'known'; }, (w) => { w.images.state = 'exact-build'; },
    (w) => { w.source.observedDate = '2026-02-30'; }, (w) => { delete w.versions; },
    (w) => { w.description.model.sourceKey = 'private'; },
    (w) => { w.source.requestedIdentity.privateStorageName = 'private'; }]) {
    const w = await lookup.resolve(complete); mutate(w);
    const r = await createConfiguredVehicleDetails({ lookup: { resolve: () => w } }).resolve(complete);
    assert.equal(r.status, 'source-unavailable'); assert.equal(r.vehicle, null);
  }
});

test('finite provider timeouts/retries abort each attempt and transport status stays separate from capability/completeness', async () => {
  for (const protocol of ['lookup', 'alternate-offline']) {
    let attempts = 0; let aborted = 0;
    const read = (_key, { signal }) => { attempts++; signal.addEventListener('abort', () => { aborted++; }); return new Promise(() => {}); };
    const consumer = createConfiguredVehicleDetails({ provider: protocol, lookup: { resolve: read }, alternateRead: read,
      timeoutMs: 5, maxAttempts: 2 });
    const r = await consumer.resolve(configuration);
    assert.equal(r.status, 'source-unavailable'); assert.equal(attempts, 2); assert.equal(aborted, 2);
    assert.equal(r.transport.attempts, 2); assert.equal(r.transport.status, null); assert.equal(r.transport.outcome, 'unavailable');
  }
  let attempts = 0;
  const broken = createConfiguredVehicleDetails({ provider: 'alternate-offline', maxAttempts: 2,
    alternateRead: () => { attempts++; return { transportStatus: 503, document: fixture.entries[0].document }; } });
  const r = await broken.resolve(configuration);
  assert.equal(r.status, 'source-unavailable'); assert.equal(r.transport.status, 503); assert.equal(attempts, 2);
  const malformed = await createConfiguredVehicleDetails({ provider: 'alternate-offline', alternateRead: () =>
    ({ transportStatus: 200, document: '{"edition":' }) }).resolve(configuration);
  assert.equal(malformed.status, 'source-unavailable'); assert.equal(malformed.transport.status, 200);
  assert.equal(malformed.transport.outcome, 'answered');
  const wire = await lookup.resolve(complete);
  for (const transport of [{ protocol: 'offline', status: 503, attempts: 1, outcome: 'answered' },
    { protocol: 'in-process', status: null, attempts: 1, outcome: 'unavailable' }]) {
    const consumer = createVehicleDetailsConsumer({ adapter: { resolve: () => ({ result: wire, transport }) } });
    assert.equal((await consumer.resolve(complete)).status, 'source-unavailable');
  }
  for (const invalid of [{ timeoutMs: 0 }, { timeoutMs: 5001 }, { maxAttempts: 0 }, { maxAttempts: 3 }]) {
    assert.throws(() => createConfiguredVehicleDetails({ lookup, ...invalid }), TypeError);
  }
});

test('backend presentation keeps source/synthetic labels, unknowns, physical/catalogue dates, units and equipment apart', async () => {
  for (const consumer of providers()) {
    const { vehicle: partial } = await consumer.resolve(configuration);
    assert.equal(partial.description.paint.state, 'unknown'); assert.equal(partial.description.upholstery.state, 'unknown');
    assert.equal(partial.equipment.selected.state, 'unknown'); assert.equal(partial.technical.seats.value, null);
    assert.equal(partial.technical.seats.unit, 'COUNT'); assert.equal(partial.presentation.unknownLabel, 'Unknown');
    const { vehicle: full } = await consumer.resolve(complete);
    assert.equal(full.technical.luggageNormal.value, 570); assert.equal(full.technical.luggageNormal.unit, 'LITRES');
    assert.equal(full.technical.acceleration.unit, 'SECONDS'); assert.equal(full.technical.bodyLength.unit, 'MILLIMETRES');
    assert.equal(full.technical.bodyLength.state, 'unknown'); assert.equal(full.technical.bodyLength.value, null);
    assert.equal(full.technical.luggageNormal.provenance.kind, 'observed');
    assert.equal(full.description.paint.selections[0].label.value, 'Alpine White');
    assert.equal(full.description.upholstery.selections[0].label.provenance.kind, 'observed');
    assert.equal(full.equipment.selected.state, 'known'); assert.equal(full.equipment.verifiedFitted.state, 'unknown');
    assert.equal(full.source.configurationIdentity.provenance.kind, 'observed');
    assert.equal(full.identity.identityKind, 'synthetic'); assert.match(full.presentation.associationLabel, /Fictional/);
    assert.equal(full.source.catalogueValidity.productionDate, '2027-01-05'); assert.equal(full.source.productionDate, null);
    assert.equal(full.source.observedDate, '2026-11-01'); assert.equal(full.images.state, 'unknown');
    assert.equal(full.images.label, 'Images unavailable'); assert.equal(full.presentation.syntheticLabel, 'Synthetic identity');
    full.technical.luggageNormal.value = 0;
    assert.equal((await consumer.resolve(complete)).vehicle.technical.luggageNormal.value, 570);
  }
});

test('representative image roles/fidelity survive either mapping without a claimed real asset or fitted build', async () => {
  const image = { imageId: 'fictional-contract-image', asset: 'fixture-only/no-runtime-asset.webp',
    role: 'representative-model', fidelity: 'representative-model', sourceKind: 'dated-snapshot',
    observedDate: '2026-11-01', label: 'Representative model image' };
  const direct = await lookup.resolve(complete); direct.images = { state: 'representative', label: 'Representative imagery', items: [image] };
  direct.presentation.imageLabel = 'Representative imagery'; direct.completeness.images = 'representative';
  const doc = structuredClone(fixture.entries[1].document);
  doc.card.portraits = { knowledge: 'representative', caption: 'Representative imagery', pictures: [{ reference: image.imageId,
    resource: image.asset, usage: image.role, accuracy: image.fidelity, origin: image.sourceKind, dated: image.observedDate, caption: image.label }] };
  doc.card.labels.imageLabel = 'Representative imagery'; doc.card.coverage.images = 'representative';
  const a = createVehicleDetailsConsumer({ adapter: createLookupVehicleAdapter({ lookup: { resolve: () => direct } }) });
  const b = createVehicleDetailsConsumer({ adapter: createAlternateOfflineVehicleAdapter({ read: () => ({ document: doc }) }) });
  assert.deepEqual((await a.resolve(complete)).vehicle, (await b.resolve(complete)).vehicle);
  doc.card.portraits.pictures[0].accuracy = 'exact-build';
  assert.equal((await b.resolve(complete)).status, 'source-unavailable');
  doc.card.portraits.pictures[0].accuracy = 'representative-model';
  doc.card.portraits.pictures[0].resource = 'https://private.local/handbook?key=opaque';
  assert.equal((await b.resolve(complete)).status, 'source-unavailable');
});

test('provider construction is server-only and no outcome or switch calls an outbound transport', async (t) => {
  let calls = 0; const original = globalThis.fetch;
  globalThis.fetch = () => { calls++; throw new Error('No outbound transport allowed'); };
  t.after(() => { globalThis.fetch = original; });
  assert.throws(() => createConfiguredVehicleDetails({ provider: 'live' }), TypeError);
  for (const consumer of providers()) {
    for (const request of [...requests, { kind: 'vin', id: 'ZZZZZZZZ0ZZ000000' },
      { ...configuration, provider: 'alternate-offline' }, { ...configuration, baseUrl: 'https://private.example' }]) {
      const r = await consumer.resolve(request, { context });
      assert.equal(JSON.stringify(r).includes('private.example'), false);
      assert.equal(JSON.stringify(r).includes('sourceKey'), false);
    }
  }
  assert.equal(calls, 0);
});

test('public language citations remain exact while credential parameters and queried image assets remain unavailable', async () => {
  const original = await lookup.resolve(configuration);
  const citation = 'https://www.press.bmwgroup.com/global/article/reference?language=en';
  const wire = structuredClone(original); wire.source.references = [citation];
  const mapped = createVehicleDetailsConsumer({ adapter: createLookupVehicleAdapter({ lookup: { resolve: () => wire } }) });
  assert.equal((await mapped.resolve(configuration)).status, 'partial');
  assert.deepEqual((await mapped.resolve(configuration)).vehicle.source.references, [citation]);
  for (const url of ['https://public.example/source?token=opaque', 'https://public.example/source?language=en&key=opaque',
    'https://private.local/source?language=en', 'https://name:opaque@public.example/source?language=en']) {
    wire.source.references = [url]; assert.equal((await mapped.resolve(configuration)).status, 'source-unavailable');
  }
  // Even the allowed source language query remains forbidden on executable asset metadata.
  wire.source.references = [citation];
  wire.images = { state: 'representative', label: 'Representative imagery', items: [{ imageId: 'citation-is-not-an-asset',
    asset: citation, role: 'representative-model', fidelity: 'representative-model', sourceKind: 'dated-snapshot',
    observedDate: '2026-11-01', label: 'Representative model image' }] };
  wire.presentation.imageLabel = 'Representative imagery'; wire.completeness.images = 'representative';
  assert.equal((await mapped.resolve(configuration)).status, 'source-unavailable');
});
