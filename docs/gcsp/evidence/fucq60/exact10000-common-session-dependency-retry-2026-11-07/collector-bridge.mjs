// One retained actual pilot capture -> current collector -> its same session -> current F60.
import assert from 'node:assert/strict';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { enrichFleet } from '../../../../../scripts/gcsp/enrich-fleet.mjs';
import { createBmwCatalogueAdapter } from '../../../../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { loadPacket, sha, checkPin, denyAllNetwork } from './common.mjs';
const { plan, manifest, planSha256 } = await loadPacket();
assert.equal(process.env.F60_CHUNK_INDEX, 'collector-bridge');
const scratch = resolve(process.env.TMPDIR || ''); assert.match(scratch, /^\/private\/tmp\/test-stamp-shard-[a-f0-9]+$/);
const bridge = plan.collectorBridge; const selected = new Map();
for (const [name, pin] of Object.entries(bridge.sourceFiles)) { await checkPin(pin); selected.set(name, await readFile(pin.path)); }
const parse = name => JSON.parse(selected.get(name));
const original = JSON.parse(selected.get('accepted.jsonl').subarray(0, bridge.acceptedLineBytes));
assert.equal(sha(selected.get('accepted.jsonl').subarray(0, bridge.acceptedLineBytes)), bridge.acceptedLineSha256);
assert.equal(sha(original.configurationId), bridge.configurationIdSha256);
assert.ok(manifest.entries.some(row => row.configurationId === original.configurationId), 'Bridge is one already selected source ID, not an extra count.');
const allocation = parse('execution-plan.json'); const checkpoint = parse('collector-state.json');
assert.equal(inputDigest(checkpoint.content), checkpoint.contentDigest);
assert.equal(inputDigest(parse('collection-plan.json')), allocation.planDigest);
const captured = checkpoint.content.sourceCaptures.find(row => row.solver.sha256 === original.sourceEvidence.solver);
assert.equal(captured.candidateId, bridge.candidateId);
const sourcePlan = parse('collection-plan.json'); sourcePlan.planId = bridge.replayPlanId;
sourcePlan.target = 1; sourcePlan.limits.requestBudgets.catalogue = 1; sourcePlan.limits.deadlineMs = 15000;
const replayPlanDigest = inputDigest(sourcePlan); assert.notEqual(replayPlanDigest, allocation.planDigest);
const artifact = (name, retained) => ({ bytes: selected.get(name), artifactSha256: retained.sha256, retrievedAt: retained.retrievedAt });
const options = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion']
  .map(name => [name, original.lookupIdentity[name]]));
const outputPath = join(plan.outputRoot, 'collector-bridge-receipt.json');
await assert.rejects(stat(outputPath), { code: 'ENOENT' });
const statePath = join(scratch, 'collector-checkpoint.json'); const guard = denyAllNetwork();
let adapter; let catalogueCalls = 0; let catalogueLoads = 0; const started = performance.now();
try {
  const input = { plan: sourcePlan, mode: 'capture-replay', policyService: new PolicyService({ provider: new FilePolicyProvider() }), statePath,
    captureReplay: { artifacts: { tree: artifact('tree.json', checkpoint.content.batchEvidence.tree),
      solver: artifact(bridge.solverFile, captured.solver) },
    definitionBinding: { options: artifact('options.json', checkpoint.content.batchEvidence.options) },
    producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion },
    operations: { catalogue: { kind: 'offline', sourceId: 'registered-bmw-catalogue', sourceVersion: '2',
      execute: async request => { catalogueCalls += 1; return adapter.resolve(request, options); } } } };
  let collector = await createFleetCollector(input); const collected = await collector.run();
  assert.equal(collected.status, 'complete'); assert.equal(collected.accepted.length, 1);
  assert.deepEqual(collected.accepted[0], { ...original, sourceEvidence: { ...original.sourceEvidence, planDigest: replayPlanDigest } });
  adapter = createBmwCatalogueAdapter({ sourceRegistrations: [collector.catalogueRegistration], loadSnapshot: async (version, call) => {
    catalogueLoads += 1; assert.equal(version, allocation.snapshotVersion);
    assert.deepEqual(call.lookupIdentity, original.lookupIdentity); return structuredClone(original.catalogue);
  } });
  const enrichment = { accepted: collected.accepted, catalogueOptions: options, imageOperation: null,
    technicalOperation: null, asOf: plan.asOf };
  const interruption = new Error('Declared bridge interruption after durable response');
  await assert.rejects(enrichFleet({ ...enrichment, session: collector.session, onPhase: async phase => {
    if (phase === 'enrichment-response-cached') throw interruption;
  } }), error => error === interruption);
  const saved = JSON.parse(await readFile(statePath)); assert.equal(inputDigest(saved.content), saved.contentDigest);
  assert.equal(saved.content.stages.enrichment.data.cursor, 0);
  assert.deepEqual(saved.content.counts.operations, { capture: 1, catalogue: 1 });
  collector = await createFleetCollector(input); assert.deepEqual((await collector.run()).accepted, collected.accepted);
  const output = await enrichFleet({ ...enrichment, session: collector.session });
  assert.equal(output.processing, 'finished'); assert.equal(output.pending, 0); assert.equal(output.status, 'incomplete');
  assert.equal(output.qualification, 'offline-session-not-source-qualified');
  assert.deepEqual(output.outcomes, { total: 1, partial: 1, rejected: 0 });
  assert.deepEqual(output.counts.operations, { capture: 1, catalogue: 1 });
  assert.deepEqual(output.counts.cacheHits, { capture: 0, catalogue: 1 });
  for (const name of ['sourceCalls', 'httpAttempts', 'decodedBytes', 'failures', 'timeouts', 'substitutions']) assert.equal(output.counts[name], 0);
  assert.equal(output.deadlineAt, saved.content.deadlineAt);
  const [result] = output.records; const source = original.catalogue.sourceBinding;
  assert.equal(result.configurationId, original.configurationId); assert.equal(result.status, 'partial');
  assert.equal(result.sources.catalogue.outcome, 'ok');
  assert.deepEqual(result.sources.catalogue.lookupIdentity, original.lookupIdentity);
  assert.deepEqual(result.resolvedConfiguration, { requestScope: Object.fromEntries(['market', 'locale', 'catalogueRangeKey']
    .map(name => [name, source.requestScope[name]])), confirmedContext: source.confirmedContext,
  canonicalIdentity: source.canonicalIdentity, selection: source.selection, optionalFacts: source.optionalFacts });
  assert.deepEqual(result.equipment.filter(row => row.catalogueSelection.state === 'selected').map(row => row.code), [...original.resolvedOptions].sort());
  assert.deepEqual(result.facts, original.catalogue.facts);
  assert.equal(Object.keys(result.facts).length, 5);
  assert.ok(Object.values(result.facts).every(fact => fact.state === 'unknown' && fact.value === null));
  for (const name of ['paint', 'upholstery']) assert.deepEqual(result.appearance[name].selections
    .map(({ code, type }) => ({ code, type })), [original[name].value]);
  assert.equal(result.image, null); assert.equal(result.completeness.image, 'unknown');
  assert.equal(result.completeness.sharedAccounting, 'shared-session-offline');
  const persisted = JSON.parse(await readFile(statePath)); assert.equal(inputDigest(persisted.content), persisted.contentDigest);
  assert.equal(persisted.content.stages.enrichment.data.cursor, 1);
  assert.deepEqual(persisted.content.accepted, collected.accepted);
  assert.deepEqual(persisted.content.stages.enrichment.data.records, output.records);
  collector = await createFleetCollector(input); assert.deepEqual((await collector.run()).accepted, collected.accepted);
  assert.deepEqual(await enrichFleet({ ...enrichment, session: collector.session }), output);
  assert.equal(catalogueCalls, 1); assert.equal(catalogueLoads, 1);
  assert.ok(Object.values(guard.attempts).every(value => value === 0));
  for (const pin of Object.values(bridge.sourceFiles)) await checkPin(pin);
  for (const pin of plan.codePins) await checkPin(pin);
  await writeFile(outputPath, JSON.stringify({ schemaVersion: 'f60-current-collector-common-session-bridge.v1',
    status: 'scoped-passed', planSha256, codeIdentity: plan.codeIdentity, environment: plan.environment,
    sourceFiles: bridge.sourceFiles, configurationIdSha256: bridge.configurationIdSha256,
    originalAcceptedLineSha256: bridge.acceptedLineSha256, exactOriginalCaptureContext: true,
    actualCurrentCollector: true, sameCollectorSessionEnriched: true, bootstrappedAcceptedState: false,
    replayPlanDigest, originalPlanDigest: allocation.planDigest, exactSelectionAndContext: true,
    admittedRows: 1, partial: 1, rejected: 0, captureCalls: 1, catalogueCalls, catalogueLoads,
    catalogueCacheHits: 1, durableCacheRecoveryPassed: true, deadlineUnchanged: true,
    completedStageReopenPassed: true, outputSha256: inputDigest(result), sourceCalls: 0, httpAttempts: 0,
    imageCalls: 0, technicalCalls: 0, outbound: guard.attempts, elapsedMs: Math.round(performance.now() - started),
    originalLiveSessionEnriched: false, acceptance: false }) + '\n', { flag: 'wx', mode: 0o600 });
} finally { guard.restore(); }
