import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { createRunStockProviderFactory } from '../gcsp/stock/index.js';
import { STOCK_CORPUS_ROOT } from '../gcsp/stock/run-stock-generation.js';
import { createLocalVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { essential, preference } from './helpers/employee-recommendation.js';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';
import { createConfigurationDefinitionIndex, selectedConfigurationDefinitionFacts, withConfigurationDefinitions } from '../gcsp/vehicle-evidence/configuration-definitions.js';
import { indexJsonl } from '../gcsp/vehicle-evidence/indexed-jsonl.js';
import { vehicleEvidenceDetails } from '../gcsp/vehicle-evidence/vehicle-details-contract.js';
import { createVehicleSnapshot } from '../vehicles/index.js';
import { inputDigest } from '../gcsp/repository/core.js';
import pg from 'pg';
import { createPostgresRepository } from '../gcsp/repository/postgres.js';

const good = (reply) => { assert.equal(reply?.status, 'ok', JSON.stringify(reply)); return reply.value; };
const fact = (row, key) => row.facts.facts?.[key]?.value;

test('retained configuration facts survive actual generated stock, recommendation, new quote and offer access', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fucq382-producer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let admin; let schema;
  if (process.env.GCSP_FUCQ393_NATIVE_PRODUCER === '1') {
    assert.ok(process.env.GCSP_DATABASE_URL, 'native producer requires an explicit local database');
    schema = `gcsp_producer_${process.pid}`;
    admin = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 1 }); admin.on('error', () => {});
    await admin.query(`CREATE SCHEMA "${schema}"`);
  }
  const repository = admin ? createPostgresRepository({ schema, pool: admin, readTrustMs: 2000 })
    : createMemoryRepository({ store: createMemoryStore() });
  let runtime;
  t.after(async () => {
    try { await runtime?.close(); } finally {
      if (admin) { try { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await admin.end(); } }
    }
  });
  const factory = createRunStockProviderFactory({ env: { GCSP_STOCK_INVENTORY_PATH: join(directory, 'inventory.json') } });
  runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider: factory,
    environmentId: 'fucq382-producer', policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'f382-bootstrap',
    sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const presenter = good(await runtime.identity.createPresenterSession('f382-presenter')).context;
  const context = good(await runtime.identity.switchPrincipal(presenter, 'demo-paula', 'f382-paula')).context;
  good(await seedManualDemoContext({ repository, identity: runtime.identity, clock: runtime.clock, context }));
  assert.equal(factory.provider.describe(context.runId).source, 'generated');
  const rows = good(await repository.query(context, 'stock'));
  if (admin) {
    const storage = await admin.query(`SELECT (SELECT count(*)::int FROM "${schema}".vehicle_evidence_snapshots) AS snapshots,
      (SELECT coalesce(sum(octet_length(data::text)),0)::bigint FROM "${schema}".stock) AS stock_bytes,
      (SELECT coalesce(sum(octet_length(data::text)),0)::bigint FROM "${schema}".vehicle_evidence_snapshots) AS evidence_bytes`);
    t.diagnostic(JSON.stringify({ generatedCars: rows.length, logicalStockBytes: rows.reduce((n, row) => n + Buffer.byteLength(JSON.stringify(row)), 0), ...storage.rows[0] }));
  }
  const cars = rows.filter((row) => fact(row, 'eligibilityModelKey') === 'F70 Sports Hatch|120');
  assert.ok(cars.length > 1, 'real generator supplies the selected model');
  good(await runtime.stockRelease.register());
  const state = good(await runtime.clock.readState(presenter));
  good(await runtime.clock.advanceAndTick(presenter, { commandId: 'f382-release', expectedClockVersion: state.clockVersion, mode: 'next-release' }));
  const car = good(await repository.query(context, 'stock')).find((row) => row.state === 'released'
    && fact(row, 'eligibilityModelKey') === 'F70 Sports Hatch|120');
  assert.ok(car, 'actual stock release exposes a retained configuration of the selected model');
  assert.equal(typeof fact(car, 'interior'), 'string', 'exact selected upholstery reaches generated stock');
  assert.ok(fact(car, 'options')?.length > 0, 'readable selected options reach generated stock');
  const evidence = car.facts.facts.configurationEvidence.value;
  assert.equal(Object.hasOwn(evidence.identity, 'vin'), false, 'configuration evidence does not introduce a VIN into generated stock');
  assert.equal(evidence.description.powertrain.transmission.state, 'unknown', 'retained F70 source does not supply transmission');
  assert.equal(car.facts.facts.gearbox.status, 'unknown', 'no transmission is invented');
  assert.equal(car.facts.facts.gearbox.value, null);
  assert.equal(evidence.identity.configurationId, car.configurationId);
  assert.equal(evidence.equipment.verifiedFitted.state, 'unknown');
  assert.equal(evidence.equipment.available.state, 'unknown');
  const other = cars.find((row) => row.configurationId !== car.configurationId
    && JSON.stringify(row.facts.facts.configurationEvidence.value.equipment.selected.options)
      !== JSON.stringify(evidence.equipment.selected.options));
  assert.ok(other, 'actual same-model stock retains a contrasting exact selection');
  assert.notDeepEqual(fact(other, 'options'), fact(car, 'options'));
  const partial = rows.find((row) => fact(row, 'configurationEvidence')?.equipment.resolution?.unresolved.length > 0);
  assert.ok(partial, 'actual retained stock includes a genuine definition gap');
  assert.match(fact(partial, 'options').at(-1), /selected codes without a readable definition$/);
  assert.equal(fact(partial, 'configurationEvidence').equipment.verifiedFitted.state, 'unknown');
  const lookup = createLocalVehicleEvidenceLookup({ root: STOCK_CORPUS_ROOT, repository, policyService: runtime.policy });
  const traced = await lookup.resolve({ kind: 'stock', id: car.orderUuid }, { context });
  assert.ok(['complete', 'partial'].includes(traced.status), JSON.stringify(traced));
  assert.equal(traced.identity.vehicleId, car.facts.facts.syntheticIdentity.value.vehicleId);
  assert.equal(traced.identity.configurationId, car.configurationId);
  assert.deepEqual(traced.equipment.selected.options, evidence.equipment.selected.options);
  const sourceFacts = selectedConfigurationDefinitionFacts(traced);
  for (const key of ['colour', 'interior', 'options']) assert.deepEqual(car.facts.facts[key], sourceFacts[key], `${key} matches exact retained lookup facts and provenance`);
  assert.ok(car.facts.display.images.length >= 2, 'ordered configuration images survive generation');
  good(await runtime.brief.saveDraft(context, { commandId: 'f382-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('hatchback') }, essentials: { seats: essential(5) } } }));
  good(await runtime.brief.confirm(context, { commandId: 'f382-confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } }));
  const released = car;
  const read = async (table, key) => good(await repository.read(context, { table, key: { runId: context.runId, ...key } }));
  const employee = await read('employees', { employeeId: context.employeeId });
  const slot = await read('entitlement_slots', { entitlementSlotId: context.entitlementSlotId });
  const allocated = good(await runtime.buddy.allocate(context, { commandId: 'f382-allocate', orderUuid: released.orderUuid,
    expectedBriefVersion: 1, expectedStockVersion: released.version, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version }));
  assert.deepEqual(allocated.quote.facts, released.facts, 'the real recommender pins the generated snapshot');
  const selector = { runId: context.runId, offerId: allocated.offer.offerId };
  const dto = good(await runtime.offerAccess.fromAccount(context, selector)).offer;
  for (const key of ['colour', 'interior', 'gearbox', 'options']) {
    assert.deepEqual(dto.quote.facts.facts[key], released.facts.facts[key], `${key} and provenance survive access`);
  }
  assert.deepEqual(dto.quote.facts.display.images.map((image) => image.src), released.facts.display.images.map((image) => image.src));
  const projected = toOfferPresentation({ status: 'ok', value: dto });
  assert.equal(projected.status, 'ok');
  assert.ok(projected.value.card.members[0].facts.some((row) => row.value === fact(released, 'interior')));

  // A subsequent definition resolution and stock enrichment cannot change an already-issued quote.
  const pointer = JSON.parse(await readFile(join(STOCK_CORPUS_ROOT, 'active.json'), 'utf8'));
  const corpus = await indexJsonl(join(STOCK_CORPUS_ROOT, 'versions', pointer.selected.directory, 'configurations.jsonl'), { key: (row) => row.configurationId });
  const retained = corpus.get(released.configurationId);
  const seed = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/configuration-definitions.v1.json', import.meta.url), 'utf8'));
  seed.version = 'controlled-successor-definition.v2';
  const variant = seed.variants.find((entry) => retained.sourceContext.sourceRefs.includes(entry.source));
  const paintCode = retained.catalogue.equipment.selected.options.find((code) => code.startsWith('P'));
  variant.definitions[paintCode].candidates[0].label = 'Successor paint definition';
  const source = await withConfigurationDefinitions({ getConfiguration: () => ({ status: 'partial', record: retained,
    images: [], active: { datasetId: evidence.identity.datasetId, version: evidence.versions.corpus,
      manifestDigest: evidence.versions.manifestDigest } }) },
  { index: createConfigurationDefinitionIndex(seed, { digest: 'b'.repeat(64) }) }).getConfiguration(retained.configurationId);
  const nextFacts = selectedConfigurationDefinitionFacts(vehicleEvidenceDetails({ kind: 'configuration', id: retained.configurationId }, source));
  assert.equal(nextFacts.colour.value, 'Successor paint definition');
  assert.notEqual(nextFacts.colour.provenance.version, released.facts.facts.colour.provenance.version);
  const currentStock = await read('stock', { orderUuid: released.orderUuid });
  const successor = createVehicleSnapshot({ ...currentStock.facts, snapshotVersion: `${currentStock.facts.snapshotVersion}:successor`,
    facts: { ...currentStock.facts.facts, ...nextFacts } });
  good(await repository.transaction(context, { commandId: 'f382-successor-stock', inputDigest: inputDigest(successor) },
    (tx) => tx.compareAndSwap({ table: 'stock', key: { runId: context.runId, orderUuid: released.orderUuid } }, currentStock.version, { facts: successor })));
  const afterEnrichment = good(await runtime.offerAccess.fromAccount(context, selector)).offer;
  assert.deepEqual(afterEnrichment.quote, dto.quote, 'historical quote facts, source versions and terms stay pinned after current stock changes');
  assert.deepEqual(toOfferPresentation({ status: 'ok', value: afterEnrichment }).value.card, projected.value.card);
  if (process.env.FUCQ382_PRODUCER_SAMPLE) await writeFile(process.env.FUCQ382_PRODUCER_SAMPLE, JSON.stringify({
    source: evidence, orderUuid: released.orderUuid, configurationId: released.configurationId,
    generated: released.facts, pinned: allocated.quote.facts, offer: dto, projection: projected.value }, null, 2) + '\n');
});
