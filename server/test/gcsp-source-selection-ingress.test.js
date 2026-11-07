/** Existing retained BMW source bytes only. No new source allocation or requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { createFleetCollector } from '../../scripts/gcsp/collect-fleet.mjs';
import { createConfigurationKey } from '../../scripts/gcsp/configuration-key.mjs';
import * as binding from '../../scripts/gcsp/bmw-selection-binding.mjs';
import { createBmwCatalogueAdapter } from '../vehicle-evidence/bmw-catalogue-adapter.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const base = new URL('../../docs/gcsp/evidence/fucq-58/complete-selection-2026-11-07/', import.meta.url);
const options = (record) => Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion']
  .map((key) => [key, record.lookupIdentity[key]]));
const request = (record) => ({ configurationId: record.configurationId, bindingDigest: record.lookupIdentity.bindingDigest });
async function setup(context) {
  const dir = await mkdtemp(join(tmpdir(), 'source-ingress-')); context.after(() => rm(dir, { recursive: true, force: true }));
  const policyService = new PolicyService({ provider: new FilePolicyProvider() });
  const plan = JSON.parse(await readFile(new URL('collection-plan.json', base)));
  const receipt = JSON.parse(await readFile(new URL('receipt.json', base)));
  const artifacts = {};
  for (const name of ['tree', 'solver']) artifacts[name] = { bytes: await readFile(new URL(name + '.json', base)),
    artifactSha256: receipt.artifacts[name].artifactSha256, retrievedAt: receipt.artifacts[name].retrievedAt };
  const definitionBinding = { options: { bytes: await readFile(new URL('../../docs/gcsp/evidence/fucq59/canonical-source-live-2026-11-06/options.json', import.meta.url)),
    artifactSha256: '6883be7544a6c03ef523aa6287a74c03fddd9b0e09b80127c25b72c1bec0061b', retrievedAt: null },
  fieldReport: { bytes: await readFile(new URL('../../docs/gcsp/evidence/fucq59/canonical-source-field-binding-2026-11-06/field-report.json', import.meta.url)),
    artifactSha256: '23ef3385a05272cd8d8ebddd655e1c9a2617b6736739f16c0fa3ef3496134598' } };
  const producerPins = { projectorSha256: sha(await readFile(new URL('../../scripts/gcsp/capture-bmw-selection.mjs', import.meta.url))),
    qualifierSha256: sha(await readFile(new URL('../../scripts/gcsp/bmw-selection-binding.mjs', import.meta.url))),
    sessionSha256: sha(await readFile(new URL('../../scripts/gcsp/collection-session.mjs', import.meta.url))), policyVersion: plan.policyRead.policyVersion };
  let outbound = 0;
  const stop = () => { outbound += 1; throw new Error('Saved-source ingress forbids network'); };
  context.mock.method(globalThis, 'fetch', stop);
  for (const name of ['node:http', 'node:https']) {
    const { default: transport } = await import(name); context.mock.method(transport, 'request', stop); context.mock.method(transport, 'get', stop);
  }
  context.after(() => assert.equal(outbound, 0));
  return { plan, policyService, statePath: join(dir, 'checkpoint.json'), mode: 'capture-replay',
    captureReplay: { artifacts, definitionBinding, producerPins, snapshotVersion: 'bmw-gb-t5mj-selection-2026-11-07.v2' } };
}
function removeSelected(candidate, key) {
  const code = 'S0230'; candidate.resolvedOptions = candidate.resolvedOptions.filter((value) => value !== code);
  candidate.selectedElements = candidate.selectedElements.filter((value) => value.code !== code);
  const source = candidate.catalogue.sourceBinding;
  source.canonicalIdentity.factoryOptionCodes = candidate.resolvedOptions.slice();
  source.selection.factoryOptionCodes = candidate.resolvedOptions.slice(); source.selection.elements = structuredClone(candidate.selectedElements);
  source.selection.solverChanges.added = source.selection.solverChanges.added.filter((value) => value !== code);
  candidate.solverChanges = structuredClone(source.selection.solverChanges); candidate.catalogue.equipment.selected.options = candidate.resolvedOptions.slice();
  const canonical = key(source.canonicalIdentity);
  const identity = { snapshotVersion: candidate.lookupIdentity.snapshotVersion, bindingDigest: inputDigest(source), configurationId: canonical.configurationId };
  const lookup = { ...options(candidate), ...identity };
  candidate.configurationId = canonical.configurationId; candidate.canonicalSignature = canonical.decodedIdentity; candidate.canonicalIdentity = canonical.canonicalIdentity;
  candidate.catalogueRequest = { configurationId: identity.configurationId, bindingDigest: identity.bindingDigest }; candidate.lookupIdentity = structuredClone(lookup);
  candidate.catalogue.requestedIdentity = structuredClone(identity); candidate.catalogue.resolvedIdentity = structuredClone(identity);
  candidate.catalogue.lookupIdentity = structuredClone(lookup); candidate.catalogue.resolvedLookupIdentity = structuredClone(lookup);
}

test('actual saved source enters common persisted accepted state and resumes without duplication', async (context) => {
  const input = await setup(context); const collector = await createFleetCollector(input); const result = await collector.run();
  assert.equal(result.accepted.length, 1); assert.equal(result.admission, true);
  assert.equal(result.qualification, 'source-configuration-admitted'); assert.equal(result.status, 'complete');
  const [record] = result.accepted;
  assert.deepEqual(record.catalogueRequest, request(record));
  assert.equal(record.admission, true); assert.equal(record.sourceKind, 'dated-snapshot'); assert.equal(record.resolvedOptions.length, 47);
  assert.equal(record.selectedAccessories[0].quantity.state, 'unknown');
  assert.equal(record.catalogue.sourceBinding.optionalFacts.modelYear.state, 'unknown');
  assert.equal(record.catalogue.sourceBinding.evidence.find((row) => row.id === 'definitions').retrievedAt, null);
  assert.equal(result.counts.sourceCalls, 0); assert.equal(result.counts.operations.capture, 1);
  const persisted = JSON.parse(await readFile(input.statePath)); assert.deepEqual(persisted.content.accepted, result.accepted);
  assert.equal(typeof collector.session.withCheckpoint, 'function');
  await collector.session.withCheckpoint(async ({ stageState, commit }) => { stageState.seen = record.configurationId; await commit('consumer-proof'); },
    { stage: { id: 'consumer-proof', version: '1', inputDigest: inputDigest(record.configurationId) } });
  const resumed = await (await createFleetCollector(input)).run();
  assert.deepEqual(resumed.accepted, result.accepted); assert.equal(resumed.counts.operations.capture, 1);
  assert.equal(resumed.duplicates.length, 0);
  assert.equal(JSON.parse(await readFile(input.statePath)).content.stages['consumer-proof'].data.seen, record.configurationId);
});

test('coherent selected deletion with rewritten checkpoint integrity is refused against trusted source bytes', async (context) => {
  const input = await setup(context); const collector = await createFleetCollector(input); await collector.run();
  const key = await createConfigurationKey({ policyService: input.policyService, policyRead: { runId: 'mutation-proof', ...input.plan.policyRead } });
  const envelope = JSON.parse(await readFile(input.statePath)); removeSelected(envelope.content.accepted[0], key);
  envelope.contentDigest = inputDigest(envelope.content); await writeFile(input.statePath, JSON.stringify(envelope) + '\n');
  await assert.rejects((await createFleetCollector(input)).run(), { code: 'source-selection-mismatch' });
});

test('existing catalogue adapter resolves only exact source-registered v2 snapshots without outbound calls', async (context) => {
  const input = await setup(context); const collector = await createFleetCollector(input); const { accepted: [record] } = await collector.run();
  assert.equal(typeof binding.createBmwSelectionRegistration, 'function');
  assert.deepEqual(collector.catalogueRegistration.lookupIdentity, record.lookupIdentity);
  let loads = 0; let snapshot = structuredClone(record.catalogue);
  const adapter = createBmwCatalogueAdapter({ sourceRegistrations: [collector.catalogueRegistration],
    loadSnapshot: async (version, call) => { loads += 1; assert.equal(version, record.lookupIdentity.snapshotVersion);
      assert.deepEqual(call.lookupIdentity, record.lookupIdentity); return snapshot; } });
  const resolved = await adapter.resolve(request(record), options(record)); assert.deepEqual(resolved, record.catalogue);
  resolved.equipment.selected.options.length = 0;
  assert.equal((await adapter.resolve(request(record), options(record))).equipment.selected.options.length, 47);
  const unknown = await adapter.resolve({ ...request(record), bindingDigest: 'f'.repeat(64) }, options(record));
  assert.equal(unknown.status, 'unsupported'); assert.equal(loads, 2);
  const unregistered = await createBmwCatalogueAdapter({ loadSnapshot: async () => { throw new Error('must not load'); } }).resolve(request(record), options(record));
  assert.equal(unregistered.status, 'unsupported');
  const mutated = structuredClone(record); const key = await createConfigurationKey({ policyService: input.policyService,
    policyRead: { runId: 'adapter-mutation', ...input.plan.policyRead } }); removeSelected(mutated, key); snapshot = mutated.catalogue;
  const refused = await adapter.resolve(request(record), options(record)); assert.equal(refused.status, 'source-unavailable');
  assert.equal(refused.failure.code, 'artifact-malformed'); assert.equal(refused.sourceBinding, null);
});


test('trusted capture ingress shares bounded extra operation stages and keeps live allocation disabled', async (context) => {
  const input = await setup(context); let reads = 0;
  input.plan.limits.requestBudgets.catalogue = 1;
  input.operations = { catalogue: { kind: 'offline', sourceId: 'registered-catalogue', sourceVersion: '2',
    execute: async (value) => { reads += 1; return { status: 'partial', configurationId: value.configurationId }; } } };
  const collector = await createFleetCollector(input); const { accepted: [record] } = await collector.run();
  await collector.session.withCheckpoint(async ({ stageState, execute, commit }) => {
    stageState.catalogue = await execute('catalogue', record.catalogueRequest); await commit('catalogue-proof');
  }, { stage: { id: 'enrichment-proof', version: '1', inputDigest: inputDigest(record.configurationId) } });
  const state = JSON.parse(await readFile(input.statePath)).content;
  assert.equal(state.accepted.length, 1); assert.equal(state.counts.sourceCalls, 0); assert.equal(reads, 1);
  assert.equal(state.counts.operations.catalogue, 1);
  assert.equal(state.stages['enrichment-proof'].data.catalogue.configurationId, record.configurationId);
  const fixture = await setup(context);
  for (const name of ['tree', 'solver']) {
    const artifact = fixture.captureReplay.artifacts[name]; const document = JSON.parse(artifact.bytes);
    document.observation.transportKind = 'fixture'; artifact.bytes = JSON.stringify(document) + '\n'; artifact.artifactSha256 = sha(artifact.bytes);
  }
  delete fixture.captureReplay.definitionBinding;
  await assert.rejects(createFleetCollector(fixture), { code: 'source-selection-not-live' });
  await assert.rejects(createFleetCollector({ ...input, statePath: undefined }), { code: 'explicit-path-required' });
  await assert.rejects(createFleetCollector({ ...input, operations: { capture: input.operations.catalogue } }), { code: 'invalid-session' });
});
