// Reconcile exact nonoverlapping sealed10000 outcomes; never infer Story acceptance.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadPacket, environment } from './common.mjs';
const { plan, manifest, planSha256 } = await loadPacket();
const bridge = JSON.parse(await readFile(join(plan.outputRoot, 'collector-bridge-receipt.json')));
assert.equal(bridge.status, 'scoped-passed'); assert.equal(bridge.planSha256, planSha256);
assert.equal(bridge.codeIdentity, plan.codeIdentity); assert.deepEqual(bridge.environment, environment());
assert.equal(bridge.configurationIdSha256, plan.collectorBridge.configurationIdSha256);
assert.equal(bridge.originalAcceptedLineSha256, plan.collectorBridge.acceptedLineSha256);
assert.deepEqual(bridge.sourceFiles, plan.collectorBridge.sourceFiles);
for (const name of ['actualCurrentCollector', 'sameCollectorSessionEnriched', 'exactOriginalCaptureContext',
  'exactSelectionAndContext', 'durableCacheRecoveryPassed', 'deadlineUnchanged', 'completedStageReopenPassed']) assert.equal(bridge[name], true);
assert.equal(bridge.bootstrappedAcceptedState, false); assert.equal(bridge.admittedRows, 1);
assert.equal(bridge.captureCalls, 1); assert.equal(bridge.catalogueCalls, 1); assert.equal(bridge.catalogueLoads, 1);
assert.equal(bridge.catalogueCacheHits, 1); assert.equal(bridge.partial, 1); assert.equal(bridge.rejected, 0);
assert.equal(bridge.sourceCalls + bridge.httpAttempts + bridge.imageCalls + bridge.technicalCalls, 0);
assert.ok(Object.values(bridge.outbound).every(value => value === 0));
assert.equal(bridge.originalLiveSessionEnriched, false); assert.equal(bridge.acceptance, false);
const receipts = [];
for (const chunk of plan.chunks) {
  const receipt = JSON.parse(await readFile(join(plan.outputRoot, `chunk-${chunk.index}-receipt.json`)));
  assert.deepEqual(receipt.identity, { planSha256, codeIdentity: plan.codeIdentity,
    selectionManifestSha256: plan.selectionManifest.sha256, environment: environment(),
    chunkIndex: chunk.index, start: chunk.start, end: chunk.end, selectedEntriesSha256: chunk.selectedEntriesSha256 });
  assert.equal(receipt.status, 'scoped-passed'); assert.equal(receipt.count, chunk.end - chunk.start);
  assert.equal(receipt.rows.length, receipt.count); assert.equal(receipt.offlineSessions, receipt.count);
  assert.ok(Object.values(receipt.outbound).every(value => value === 0));
  assert.equal(receipt.sourceCalls + receipt.imageCalls + receipt.technicalCalls, 0);
  assert.equal(receipt.originalLiveSessionEnriched, false); assert.equal(receipt.acceptance, false);
  receipts.push(receipt);
}
const rows = receipts.flatMap(receipt => receipt.rows); assert.equal(rows.length, 10000);
assert.equal(new Set(rows.map(row => row.configurationIdSha256)).size, 10000);
for (const [index, row] of rows.entries()) {
  const entry = manifest.entries[index];
  assert.equal(row.globalIndex, index); assert.equal(row.configurationIdSha256, entry.configurationIdSha256);
  assert.equal(row.sourceRowSha256, entry.sourceRowSha256); assert.equal(row.bindingDigest, entry.bindingDigest);
  assert.equal(row.coverageGroupIndex, entry.coverageGroupIndex);
  assert.equal(row.historicalCandidateRecord, entry.historicalCandidateRecord);
  assert.equal(row.strictV2CandidateRecord, entry.strictV2CandidateRecord);
  assert.equal(row.status, 'partial'); assert.equal(row.finished, true); assert.equal(row.exactContextAndSelection, true);
  assert.equal(row.factorySelection, 'complete'); assert.equal(row.measurements, 'unknown'); assert.equal(row.image, 'unknown');
  assert.equal(row.catalogueCalls, 1); assert.equal(row.catalogueLoads, 1);
  assert.equal(row.cacheHits, index === 0 ? 1 : 0); assert.equal(row.sourceCalls + row.httpAttempts + row.decodedBytes, 0);
  assert.match(row.outputSha256, /^[a-f0-9]{64}$/); assert.match(row.resolvedConfigurationSha256, /^[a-f0-9]{64}$/);
  if (index === 0) {
    assert.equal(row.recovery.cacheReopenPassed, true); assert.equal(row.recovery.deadlineUnchanged, true);
    assert.equal(row.recovery.completedStageReopenPassed, true);
  } else assert.equal(row.recovery, null);
}
assert.equal(rows.filter(row => row.historicalCandidateRecord).length, 1);
assert.equal(rows.filter(row => row.strictV2CandidateRecord).length, 9999);
assert.equal(new Set(rows.map(row => row.coverageGroupIndex)).size, manifest.coverageGroups.length);
await writeFile(join(plan.outputRoot, 'final-receipt.json'), JSON.stringify({
  schemaVersion: 'f60-exact10000-common-session-summary.v1', status: 'scoped-passed', planSha256,
  codeIdentity: plan.codeIdentity, selectionManifestSha256: plan.selectionManifest.sha256, environment: environment(),
  exactOrderedUnion: true, disjointChunks: true, chunkCount: receipts.length, actualRetainedSelections: rows.length,
  actualCurrentF60Sessions: rows.length, exactContextAndSelection: rows.length, partial: rows.length, rejected: 0,
  currentCollectorSameSessionBridgePassed: true, separateBridgeRows: 1, bridgeAddsCohortRows: 0,
  offlineCatalogueCalls: rows.length, catalogueCacheHits: 1, retainedObservedGroups: manifest.coverageGroups.length,
  historicalAcceptedV2SourceRows: 1, candidateHistoricalV1RepresentationChanged: false,
  unknownTechnicalRows: rows.length, unknownImageRows: rows.length, sourceCalls: 0, networkCalls: 0,
  firstRowRecoveryAndCompletedStageReopenPassed: true, originalLiveSessionEnriched: false,
  sourceQualification: 'offline-session-not-source-qualified', bulkCollectorAdmissionReplayed: false,
  corpusPublicationExecuted: false, fullSuiteRun: false, acceptance: false,
  scope: 'Current F60 and common-session integration for every exact sealed admitted row; explicit retained-admission handoff. Original live-session/source qualification, technical/image expansion, corpus publication and full Story acceptance excluded.',
}) + '\n', { flag: 'wx', mode: 0o600 });
