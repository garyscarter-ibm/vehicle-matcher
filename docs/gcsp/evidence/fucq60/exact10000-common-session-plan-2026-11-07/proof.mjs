// Actual current F60 + actual shared session for sealed retained accepted rows.
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCollectionSession } from '../../../../../scripts/gcsp/collection-session.mjs';
import { createConfigurationKey } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { enrichFleet } from '../../../../../scripts/gcsp/enrich-fleet.mjs';
import { createBmwCatalogueAdapter } from '../../../../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { validateBmwCatalogueV2Envelope } from '../../../../../server/vehicle-evidence/bmw-catalogue-v2.js';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { loadPacket, originalRow, canonicalSha, environment, atomic, denyAllNetwork, checkPin } from './common.mjs';

const packet = await loadPacket(); const { plan, manifest, planSha256 } = packet;
assert.equal(process.argv.length, 3); const index = Number(process.argv[2]); const chunk = plan.chunks[index];
assert.ok(chunk && chunk.index === index); assert.equal(process.env.F60_CHUNK_INDEX, String(index));
const scratch = resolve(process.env.TMPDIR || ''); assert.match(scratch, /^\/private\/tmp\/test-stamp-shard-[a-f0-9]+$/);
const output = plan.outputRoot; await mkdir(output, { recursive: true, mode: 0o700 });
assert.ok(!output.startsWith(scratch + '/'));
const selected = manifest.entries.slice(chunk.start, chunk.end);
assert.equal(canonicalSha(selected), chunk.selectedEntriesSha256);
const progressPath = join(output, `chunk-${index}-progress.json`);
const receiptPath = join(output, `chunk-${index}-receipt.json`);
await assert.rejects(stat(receiptPath), { code: 'ENOENT' }, 'Do not rerun a completed chunk.');
const identity = { planSha256, codeIdentity: plan.codeIdentity, selectionManifestSha256: plan.selectionManifest.sha256,
  environment: environment(), chunkIndex: index, start: chunk.start, end: chunk.end, selectedEntriesSha256: chunk.selectedEntriesSha256 };
let progress;
try { progress = JSON.parse(await readFile(progressPath)); }
catch (error) { if (error.code !== 'ENOENT') throw error; progress = { identity, startedAt: new Date().toISOString(), rows: [] }; }
assert.deepEqual(progress.identity, identity); assert.ok(progress.rows.length <= selected.length);
for (const [offset, row] of progress.rows.entries()) {
  const entry = selected[offset];
  assert.equal(row.globalIndex, chunk.start + offset); assert.equal(row.sourceRowSha256, entry.sourceRowSha256);
  assert.equal(row.configurationIdSha256, entry.configurationIdSha256); assert.equal(row.status, 'partial');
  assert.equal(row.exactContextAndSelection, true); assert.equal(row.finished, true);
  assert.equal(row.sourceCalls, 0); assert.equal(row.httpAttempts, 0);
}
const guard = denyAllNetwork(); const started = performance.now();
async function checkpoint(status, error) {
  await atomic(progressPath, { ...progress, status, lastError: error ? String(error.stack || error).slice(0, 4096) : null,
    completedRows: progress.rows.length, updatedAt: new Date().toISOString() });
}
try {
  const key = await createConfigurationKey({ policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    policyRead: plan.policyRead });
  await checkpoint('in-progress');
  for (let offset = progress.rows.length; offset < selected.length; offset += 1) {
    const globalIndex = chunk.start + offset; const entry = selected[offset]; const before = performance.now();
    const original = await originalRow(manifest, entry); const source = original.catalogue.sourceBinding;
    assert.equal(key(original.canonicalIdentity).configurationId, original.configurationId);
    assert.equal(inputDigest(source), original.lookupIdentity.bindingDigest);
    const options = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion']
      .map(name => [name, original.lookupIdentity[name]]));
    const trusted = { configurationKey: key, producerPins: source.producerPins, evidencePins: source.evidence,
      requestScope: source.requestScope, confirmedContext: source.confirmedContext };
    let catalogueCalls = 0; let catalogueLoads = 0;
    const adapter = createBmwCatalogueAdapter({ sourceRegistrations: [{ lookupIdentity: original.lookupIdentity,
      qualifySnapshot(snapshot) {
        const checked = validateBmwCatalogueV2Envelope(JSON.stringify(snapshot), trusted);
        assert.equal(checked.status, 'valid'); assert.equal(inputDigest(checked.envelope), inputDigest(original.catalogue));
        return { status: 'qualified', envelope: checked.envelope };
      } }], loadSnapshot: async (version, call) => {
      catalogueLoads += 1; assert.equal(version, original.lookupIdentity.snapshotVersion);
      assert.deepEqual(call.lookupIdentity, original.lookupIdentity); return structuredClone(original.catalogue);
    } });
    const directory = join(scratch, `row-${globalIndex}`); await mkdir(directory);
    const statePath = join(directory, 'checkpoint.json');
    const sessionInput = { identity: { schemaVersion: 'f60-retained-admission-handoff.v1', planSha256,
      configurationIdSha256: entry.configurationIdSha256, sourceRowSha256: entry.sourceRowSha256 },
    operations: { catalogue: { kind: 'offline', sourceId: 'sealed-retained-catalogue', sourceVersion: '2',
      execute: async request => { catalogueCalls += 1; return adapter.resolve(request, options); } } },
    limits: plan.sessionLimits, statePath, initialState: { accepted: [original],
      handoff: { kind: 'offline-retained-admission', sourceRowSha256: entry.sourceRowSha256, originalLiveSessionEnriched: false } },
    validateState(state) { assert.deepEqual(state.accepted, [original]); } };
    let session = await createCollectionSession(sessionInput);
    const enrichment = { accepted: [original], catalogueOptions: options, imageOperation: null, technicalOperation: null, asOf: plan.asOf };
    let recovery = null;
    if (globalIndex === 0) {
      const interruption = new Error('Declared proof interruption after durable catalogue response');
      await assert.rejects(enrichFleet({ ...enrichment, session, onPhase: async phase => {
        if (phase === 'enrichment-response-cached') throw interruption;
      } }), error => error === interruption);
      const saved = JSON.parse(await readFile(statePath)); assert.equal(inputDigest(saved.content), saved.contentDigest);
      assert.equal(saved.content.stages.enrichment.data.cursor, 0);
      assert.equal(saved.content.counts.operations.catalogue, 1); assert.equal(saved.content.counts.sourceCalls, 0);
      recovery = { interruptedCursor: 0, deadlineAt: saved.content.deadlineAt };
      session = await createCollectionSession(sessionInput);
    }
    const output = await enrichFleet({ ...enrichment, session });
    assert.equal(output.scope, 'session-enrichment'); assert.equal(output.qualification, 'offline-session-not-source-qualified');
    assert.equal(output.processing, 'finished'); assert.equal(output.pending, 0); assert.equal(output.status, 'incomplete');
    assert.deepEqual(output.outcomes, { total: 1, partial: 1, rejected: 0 });
    assert.deepEqual(output.counts.operations, { catalogue: 1 });
    assert.deepEqual(output.counts.cacheHits, { catalogue: globalIndex === 0 ? 1 : 0 });
    for (const name of ['sourceCalls', 'httpAttempts', 'decodedBytes', 'failures', 'timeouts', 'substitutions']) assert.equal(output.counts[name], 0);
    const [result] = output.records;
    assert.equal(result.configurationId, original.configurationId); assert.equal(result.status, 'partial');
    assert.equal(result.sources.catalogue.outcome, 'ok');
    assert.deepEqual(result.sources.catalogue.lookupIdentity, original.lookupIdentity);
    assert.equal(result.sources.catalogue.observedDate, original.catalogue.observedDate);
    assert.equal(result.sources.catalogue.retrievedDate, original.catalogue.retrievedDate);
    assert.deepEqual(result.resolvedConfiguration, { requestScope: Object.fromEntries(['market', 'locale', 'catalogueRangeKey']
      .map(name => [name, source.requestScope[name]])), confirmedContext: source.confirmedContext,
    canonicalIdentity: source.canonicalIdentity, selection: source.selection, optionalFacts: source.optionalFacts });
    assert.deepEqual(result.equipment.filter(row => row.catalogueSelection.state === 'selected').map(row => row.code), [...original.resolvedOptions].sort());
    assert.deepEqual(result.facts, original.catalogue.facts);
    assert.equal(Object.keys(result.facts).length, 5);
    assert.ok(Object.values(result.facts).every(fact => fact.state === 'unknown' && fact.value === null));
    for (const name of ['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted']) {
      assert.equal(result.resolvedConfiguration.optionalFacts[name].state, 'unknown');
      assert.equal(result.resolvedConfiguration.optionalFacts[name].value, null);
    }
    for (const name of ['paint', 'upholstery']) {
      assert.equal(original[name].state, 'known'); assert.equal(result.appearance[name].state, 'known');
      assert.deepEqual(result.appearance[name].selections.map(({ code, type }) => ({ code, type })), [original[name].value]);
      assert.ok(result.appearance[name].selections.every(row => row.label === null));
    }
    assert.equal(result.completeness.factorySelection, 'complete');
    assert.equal(result.completeness.accessoryCodes, 'complete');
    assert.equal(result.completeness.accessoryQuantities, original.catalogue.completeness.accessoryQuantities);
    assert.equal(result.completeness.measurements, 'unknown'); assert.equal(result.completeness.sharedAccounting, 'shared-session-offline');
    assert.equal(result.image, null); assert.equal(result.completeness.image, 'unknown');
    const persisted = JSON.parse(await readFile(statePath)); assert.equal(inputDigest(persisted.content), persisted.contentDigest);
    assert.equal(persisted.content.stages.enrichment.data.cursor, 1);
    assert.deepEqual(persisted.content.stages.enrichment.data.records, output.records);
    assert.deepEqual(persisted.content.counts, output.counts);
    if (globalIndex === 0) {
      assert.equal(recovery.deadlineAt, output.deadlineAt); session = await createCollectionSession(sessionInput);
      assert.deepEqual(await enrichFleet({ ...enrichment, session }), output);
      recovery = { ...recovery, cacheReopenPassed: true, deadlineUnchanged: true, completedStageReopenPassed: true };
    }
    assert.equal(catalogueCalls, 1); assert.equal(catalogueLoads, 1);
    assert.deepEqual(await readdir(directory), ['checkpoint.json']);
    await rm(directory, { recursive: true }); await assert.rejects(stat(directory), { code: 'ENOENT' });
    progress.rows.push({ globalIndex, configurationIdSha256: entry.configurationIdSha256, sourceRowSha256: entry.sourceRowSha256,
      bindingDigest: entry.bindingDigest, coverageGroupIndex: entry.coverageGroupIndex,
      historicalCandidateRecord: entry.historicalCandidateRecord, strictV2CandidateRecord: entry.strictV2CandidateRecord,
      resolvedConfigurationSha256: inputDigest(result.resolvedConfiguration), outputSha256: inputDigest(result),
      status: result.status, exactContextAndSelection: true, finished: true, factorySelection: 'complete',
      accessoryQuantities: result.completeness.accessoryQuantities, measurements: 'unknown', image: 'unknown',
      catalogueCalls, catalogueLoads, cacheHits: output.counts.cacheHits.catalogue, sourceCalls: 0, httpAttempts: 0,
      decodedBytes: 0, recovery, elapsedMs: Math.round(performance.now() - before) });
    await checkpoint('in-progress');
    console.log(JSON.stringify({ chunk: index, globalIndex, completedRows: progress.rows.length, total: selected.length }));
  }
  assert.ok(Object.values(guard.attempts).every(count => count === 0));
  for (const pin of plan.codePins) await checkPin(pin); await checkPin(plan.selectionManifest);
  const receipt = { schemaVersion: 'f60-exact10000-common-session-chunk.v1', status: 'scoped-passed', identity,
    startedAt: progress.startedAt, completedAt: new Date().toISOString(), invocationElapsedMs: Math.round(performance.now() - started),
    count: progress.rows.length, rows: progress.rows, outbound: guard.attempts, offlineSessions: progress.rows.length,
    originalLiveSessionEnriched: false, sourceCalls: 0, imageCalls: 0, technicalCalls: 0,
    sourceQualification: 'offline-session-not-source-qualified', acceptance: false };
  await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
  await checkpoint('completed');
} catch (error) { await checkpoint('failed-partial', error); throw error; }
finally { guard.restore(); }
