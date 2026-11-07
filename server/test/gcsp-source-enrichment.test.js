/** Reuses retained source bytes through the actual collector and registered catalogue adapter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { createBmwCatalogueAdapter } from '../vehicle-evidence/bmw-catalogue-adapter.js';
import { createFleetCollector } from '../../scripts/gcsp/collect-fleet.mjs';
import { enrichFleet } from '../../scripts/gcsp/enrich-fleet.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base = new URL('../../docs/gcsp/evidence/fucq-58/complete-selection-2026-11-07/', import.meta.url);
const catalogueOptions = (record) => Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion']
  .map((key) => [key, record.lookupIdentity[key]]));

async function setup(context) {
  const dir = await mkdtemp(join(tmpdir(), 'source-enrichment-'));
  context.after(() => rm(dir, { recursive: true, force: true }));
  const plan = JSON.parse(await readFile(new URL('collection-plan.json', base)));
  plan.limits.requestBudgets.catalogue = 1;
  const receipt = JSON.parse(await readFile(new URL('receipt.json', base)));
  const artifacts = {};
  for (const name of ['tree', 'solver']) artifacts[name] = { bytes: await readFile(new URL(name + '.json', base)),
    artifactSha256: receipt.artifacts[name].artifactSha256, retrievedAt: receipt.artifacts[name].retrievedAt };
  const definitionBinding = { options: {
    bytes: await readFile(new URL('../../docs/gcsp/evidence/fucq59/canonical-source-live-2026-11-06/options.json', import.meta.url)),
    artifactSha256: '6883be7544a6c03ef523aa6287a74c03fddd9b0e09b80127c25b72c1bec0061b', retrievedAt: null },
  fieldReport: {
    bytes: await readFile(new URL('../../docs/gcsp/evidence/fucq59/canonical-source-field-binding-2026-11-06/field-report.json', import.meta.url)),
    artifactSha256: '23ef3385a05272cd8d8ebddd655e1c9a2617b6736739f16c0fa3ef3496134598' } };
  const producerPins = {};
  for (const [key, path] of [['projectorSha256', 'capture-bmw-selection.mjs'], ['qualifierSha256', 'bmw-selection-binding.mjs'],
    ['sessionSha256', 'collection-session.mjs']]) producerPins[key] = sha(await readFile(new URL('../../scripts/gcsp/' + path, import.meta.url)));
  producerPins.policyVersion = plan.policyRead.policyVersion;
  let outbound = 0;
  const stop = () => { outbound += 1; throw new Error('Retained-source enrichment forbids network'); };
  context.mock.method(globalThis, 'fetch', stop);
  for (const name of ['node:http', 'node:https']) {
    const { default: transport } = await import(name);
    context.mock.method(transport, 'request', stop); context.mock.method(transport, 'get', stop);
  }
  context.after(() => assert.equal(outbound, 0));
  let adapter; let loads = 0; let calls = 0;
  const input = { plan, statePath: join(dir, 'checkpoint.json'), mode: 'capture-replay',
    policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    captureReplay: { artifacts, definitionBinding, producerPins, snapshotVersion: 'bmw-gb-t5mj-selection-2026-11-07.v2' },
    operations: { catalogue: { kind: 'offline', sourceId: 'registered-bmw-catalogue', sourceVersion: '2',
      execute: async (request) => { calls += 1; return adapter.resolve(request, options); } } } };
  const collector = await createFleetCollector(input); const collected = await collector.run();
  const record = collected.accepted[0]; const options = catalogueOptions(record);
  adapter = createBmwCatalogueAdapter({ sourceRegistrations: [collector.catalogueRegistration],
    loadSnapshot: async (version, call) => {
      loads += 1; assert.equal(version, record.lookupIdentity.snapshotVersion);
      assert.deepEqual(call.lookupIdentity, record.lookupIdentity); return record.catalogue;
    } });
  return { input, collector, collected, options, counts: () => ({ loads, calls }) };
}

test('accepted source v2 selection enriches through registered adapter and resumes the same session cache', async (context) => {
  const source = await setup(context); let interrupted = false;
  const input = { accepted: source.collected.accepted, catalogueOptions: source.options, asOf: '2026-11-07' };
  await assert.rejects(enrichFleet({ ...input, session: source.collector.session,
    onPhase: async (phase) => { if (phase === 'enrichment-response-cached' && !interrupted) {
      interrupted = true; throw new Error('interrupted after v2 catalogue cache');
    } } }), /interrupted after v2 catalogue cache/);
  const before = JSON.parse(await readFile(source.input.statePath)).content;
  assert.equal(before.stages.enrichment.data.cursor, 0);
  assert.equal(before.counts.operations.catalogue, 1);
  const reopened = await createFleetCollector(source.input); const collected = await reopened.run();
  const output = await enrichFleet({ ...input, accepted: collected.accepted, session: reopened.session });
  assert.equal(output.processing, 'finished'); assert.equal(output.pending, 0);
  assert.deepEqual(output.outcomes, { total: 1, partial: 1, rejected: 0 });
  assert.deepEqual(source.counts(), { loads: 1, calls: 1 });
  assert.equal(output.counts.operations.capture, 1); assert.equal(output.counts.operations.catalogue, 1);
  assert.equal(output.counts.cacheHits.catalogue, 1); assert.equal(output.counts.sourceCalls, 0);
  const [record] = output.records;
  assert.equal(record.sources.catalogue.outcome, 'ok');
  assert.equal(record.equipment.filter((entry) => entry.catalogueSelection.state === 'selected').length, 47);
  assert.equal(record.resolvedConfiguration.selection.accessories[0].quantity.state, 'unknown');
  assert.equal(record.resolvedConfiguration.optionalFacts.physicalProductionDate.value, null);
  assert.deepEqual(record.appearance.paint.selections.map(({ code, type }) => ({ code, type })),
    [{ code: 'P0300', type: 'paint' }]);
  assert.deepEqual(record.appearance.upholstery.selections.map(({ code, type }) => ({ code, type })),
    [{ code: 'FKSFU', type: 'upholstery' }]);
  assert.equal(record.appearance.paint.selections[0].label, null);
  assert.equal(record.sources.catalogue.retrievedDate, '2026-11-07');
  assert.equal(record.sources.catalogue.evidence.find((entry) => entry.id === 'definitions').retrievedAt, null);
  assert.equal(record.image, null); assert.equal(record.completeness.image, 'unknown');
  assert.ok(Object.values(record.facts).every((fact) => fact.state === 'unknown' && fact.value === null));
  const resumed = await enrichFleet({ ...input, accepted: collected.accepted, session: reopened.session });
  assert.deepEqual(resumed.records, output.records); assert.deepEqual(source.counts(), { loads: 1, calls: 1 });
});

test('v2 enrichment options cannot substitute the accepted collector lookup', async (context) => {
  const source = await setup(context);
  await assert.rejects(enrichFleet({ session: source.collector.session, accepted: source.collected.accepted,
    catalogueOptions: { ...source.options, snapshotVersion: 'substitute.v2' }, asOf: '2026-11-07' }),
  { code: 'invalid-accepted-record' });
  assert.deepEqual(source.counts(), { loads: 0, calls: 0 });
});

test('tampered accepted appearance and rehashed checkpoints cannot supply source appearance', async (context) => {
  const source = await setup(context);
  const changed = structuredClone(source.collected.accepted);
  changed[0].paint.value.code = 'S0230';
  await assert.rejects(enrichFleet({ session: source.collector.session, accepted: changed,
    catalogueOptions: source.options, asOf: '2026-11-07' }), { code: 'accepted-input-mismatch' });
  assert.deepEqual(source.counts(), { loads: 0, calls: 0 });
  const saved = JSON.parse(await readFile(source.input.statePath));
  saved.content.accepted[0].paint.value.code = 'S0230';
  saved.contentDigest = inputDigest(saved.content);
  await writeFile(source.input.statePath, JSON.stringify(saved) + '\n');
  await assert.rejects(async () => (await createFleetCollector(source.input)).run(), { code: 'source-selection-mismatch' });
  assert.deepEqual(source.counts(), { loads: 0, calls: 0 });
});
