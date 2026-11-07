/** Actual retained bounded pilot chunk -> fresh offline collector session -> F60 proof. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { createFleetCollector } from '../../../../scripts/gcsp/collect-fleet.mjs';
import { enrichFleet } from '../../../../scripts/gcsp/enrich-fleet.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../server/gcsp/policy/index.js';
import { createBmwCatalogueAdapter } from '../../../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { inputDigest } from '../../../../server/gcsp/repository/core.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]; const value = process.argv[index + 1];
  assert.ok(['--receipt', '--proof-plan'].includes(name) && isAbsolute(value || '') && !argumentsByName.has(name));
  argumentsByName.set(name, value);
}
assert.equal(argumentsByName.size, 2);
const receiptPath = resolve(argumentsByName.get('--receipt'));
const progressPath = receiptPath + '.progress.json'; const progressStaging = progressPath + '.writing';
const scratch = resolve(process.env.TMPDIR || '');
assert.equal(scratch, '/tmp/vehicle-matcher-f58-63-20261106/f60-new9-replay');
assert.ok(!receiptPath.startsWith(scratch + '/') && receiptPath !== scratch);
const proofPlanBytes = await readFile(argumentsByName.get('--proof-plan')); const proofPlan = JSON.parse(proofPlanBytes);
for (const path of [receiptPath, progressPath, progressStaging]) await assert.rejects(stat(path), { code: 'ENOENT' });
const selectedFiles = new Map();
async function pinnedFile(path, digest, maxBytes = 16 * 1024 * 1024) {
  assert.ok((await stat(path)).size <= maxBytes);
  const bytes = await readFile(path); assert.equal(sha(bytes), digest, 'Selected immutable input changed: ' + path); return bytes;
}
for (const [path, pin] of Object.entries(proofPlan.sourceFiles)) selectedFiles.set(path, await pinnedFile(join(root, path), pin.sha256, pin.bytes));
for (const [path, digest] of Object.entries(proofPlan.runtimePins)) await pinnedFile(join(root, path), digest);
const originals = [];
for (const group of proofPlan.groups) {
  const parse = (name) => JSON.parse(selectedFiles.get(group.files[name]));
  const sourcePlan = parse('plan'); const checkpoint = parse('checkpoint'); const marker = parse('marker');
  assert.equal(inputDigest(sourcePlan), group.originalPlanDigest);
  assert.equal(inputDigest(checkpoint.content), checkpoint.contentDigest);
  assert.equal((marker.allocation ?? marker).planDigest, group.originalPlanDigest);
  const accepted = selectedFiles.get(group.files.accepted).toString('utf8').trim().split('\n').map(JSON.parse);
  assert.equal(accepted.length, group.expectedRows); assert.deepEqual(checkpoint.content.accepted, accepted);
  for (const original of accepted) {
    assert.equal(original.sourceEvidence.planDigest, group.originalPlanDigest);
    assert.deepEqual(original.catalogue.sourceBinding.producerPins, group.producerPins);
    assert.equal(original.catalogue.snapshotVersion, group.snapshotVersion);
    const captured = checkpoint.content.sourceCaptures.find((entry) => entry.solver.sha256 === original.sourceEvidence.solver);
    assert.ok(captured); const evidence = captured.batchEvidence ?? checkpoint.content.batchEvidence;
    assert.equal(evidence.tree.sha256, original.sourceEvidence.tree);
    assert.equal(evidence.options.sha256, original.sourceEvidence.definitionPins.options);
    const allocation = { id: group.originalAllocationId, planDigest: group.originalPlanDigest,
      producerPins: group.producerPins, snapshotVersion: group.snapshotVersion };
    originals.push({ original, group, sourcePlan, checkpoint, captured, evidence, allocation });
  }
}
assert.equal(originals.length, proofPlan.expectedRows);
assert.equal(new Set(originals.map(({ original }) => original.configurationId)).size, proofPlan.expectedRows);
const policyService = new PolicyService({ provider: new FilePolicyProvider() });
const rows = []; const startedAt = new Date().toISOString(); const started = performance.now();
async function checkpointProgress() {
  await writeFile(progressStaging, JSON.stringify({ schemaVersion: 'f60-new9-offline-replay-progress.v1',
    proofPlanSha256: sha(proofPlanBytes), startedAt, expectedRows: proofPlan.expectedRows,
    completedRows: rows.length, rows }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(progressStaging, progressPath);
}
await checkpointProgress();
const outbound = { fetch: 0, http: 0, https: 0, net: 0, tls: 0 };
const guards = [];
function deny(target, name, kind) {
  const previous = target[name];
  target[name] = () => { outbound[kind] += 1; throw new Error('Offline replay forbids network: ' + kind); };
  guards.push(() => { target[name] = previous; });
}
deny(globalThis, 'fetch', 'fetch');
for (const name of ['request', 'get']) { deny(http, name, 'http'); deny(https, name, 'https'); }
for (const name of ['connect', 'createConnection']) deny(net, name, 'net');
deny(tls, 'connect', 'tls'); syncBuiltinESMExports();
try {
  for (const [index, item] of originals.entries()) {
    const { original, group, sourcePlan, captured, evidence, allocation } = item;
    const rowStarted = performance.now();
    const plan = structuredClone(sourcePlan);
    plan.planId = proofPlan.planIdPrefix + '-' + String(index + 1).padStart(2, '0');
    plan.target = 1; plan.limits.requestBudgets.catalogue = 1;
    const replayPlanDigest = inputDigest(plan);
    assert.notEqual(replayPlanDigest, allocation.planDigest);
    const rowDirectory = join(scratch, 'row-' + String(index + 1).padStart(2, '0'));
    await mkdir(rowDirectory);
    let adapter; let catalogueCalls = 0; let catalogueLoads = 0;
    const options = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion',
      'sourceContractVersion', 'snapshotVersion'].map((name) => [name, original.lookupIdentity[name]]));
    const artifact = (retained) => {
      const bytes = Buffer.from(JSON.stringify(retained.document) + '\n');
      assert.equal(bytes.length, retained.bytes); assert.equal(sha(bytes), retained.sha256);
      return { bytes, artifactSha256: retained.sha256, retrievedAt: retained.retrievedAt };
    };
    const input = { plan, mode: 'capture-replay', policyService,
      statePath: join(rowDirectory, 'checkpoint.json'),
      captureReplay: {
        artifacts: { tree: artifact(evidence.tree),
          solver: artifact(captured.solver) },
        definitionBinding: { options: artifact(evidence.options) },
        producerPins: structuredClone(allocation.producerPins), snapshotVersion: allocation.snapshotVersion,
      },
      operations: { catalogue: { kind: 'offline', sourceId: 'registered-bmw-catalogue', sourceVersion: '2',
        execute: async (request) => { catalogueCalls += 1; return adapter.resolve(request, options); } } },
    };
    let collector = await createFleetCollector(input);
    const collected = await collector.run();
    assert.equal(collected.status, 'complete'); assert.equal(collected.accepted.length, 1);
    const replayed = collected.accepted[0];
    assert.deepEqual(replayed, { ...original, sourceEvidence: { ...original.sourceEvidence, planDigest: replayPlanDigest } });
    adapter = createBmwCatalogueAdapter({ sourceRegistrations: [collector.catalogueRegistration],
      loadSnapshot: async (version, call) => {
        catalogueLoads += 1; assert.equal(version, allocation.snapshotVersion);
        assert.deepEqual(call.lookupIdentity, original.lookupIdentity); return original.catalogue;
      } });
    const enrichment = { accepted: collected.accepted, catalogueOptions: options,
      imageOperation: null, asOf: proofPlan.asOf };
    let cacheBeforeReopen = null;
    if (index === 0) {
      const interruption = new Error('pilot replay interruption after durable catalogue cache');
      await assert.rejects(enrichFleet({ ...enrichment, session: collector.session,
        onPhase: async (phase) => { if (phase === 'enrichment-response-cached') throw interruption; } }),
      (error) => error === interruption);
      const saved = JSON.parse(await readFile(input.statePath)).content;
      assert.equal(saved.stages.enrichment.data.cursor, 0);
      assert.equal(saved.counts.operations.capture, 1); assert.equal(saved.counts.operations.catalogue, 1);
      assert.equal(saved.counts.sourceCalls, 0);
      cacheBeforeReopen = { cursor: saved.stages.enrichment.data.cursor,
        catalogueCalls: saved.counts.operations.catalogue, deadlineAt: saved.deadlineAt };
      collector = await createFleetCollector(input);
      assert.deepEqual((await collector.run()).accepted, collected.accepted);
    }
    const output = await enrichFleet({ ...enrichment, session: collector.session });
    assert.equal(output.processing, 'finished'); assert.equal(output.pending, 0);
    assert.equal(output.status, 'incomplete');
    assert.deepEqual(output.outcomes, { total: 1, partial: 1, rejected: 0 });
    assert.equal(output.counts.operations.capture, 1); assert.equal(output.counts.operations.catalogue, 1);
    assert.equal(output.counts.cacheHits.catalogue, index === 0 ? 1 : 0);
    assert.equal(output.counts.sourceCalls, 0); assert.equal(output.counts.httpAttempts, 0);
    assert.equal(output.counts.decodedBytes, 0);
    assert.deepEqual(Object.keys(output.counts.operations).sort(), ['capture', 'catalogue']);
    const [result] = output.records; const source = original.catalogue.sourceBinding;
    assert.equal(result.configurationId, original.configurationId);
    assert.equal(result.sources.catalogue.outcome, 'ok');
    assert.deepEqual(result.sources.catalogue.lookupIdentity, original.lookupIdentity);
    assert.deepEqual(result.resolvedConfiguration.canonicalIdentity, source.canonicalIdentity);
    assert.deepEqual(result.resolvedConfiguration.confirmedContext, source.confirmedContext);
    assert.deepEqual(result.resolvedConfiguration.selection, source.selection);
    assert.deepEqual(result.resolvedConfiguration.optionalFacts, source.optionalFacts);
    assert.deepEqual(result.equipment.filter((entry) => entry.catalogueSelection.state === 'selected')
      .map((entry) => entry.code), [...original.resolvedOptions].sort());
    assert.ok(Object.values(result.facts).every((fact) => fact.state === 'unknown' && fact.value === null));
    for (const name of ['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted']) {
      assert.equal(result.resolvedConfiguration.optionalFacts[name].state, 'unknown');
      assert.equal(result.resolvedConfiguration.optionalFacts[name].value, null);
    }
    for (const name of ['paint', 'upholstery']) {
      assert.equal(original[name].state, 'known');
      assert.deepEqual(result.appearance[name].selections.map(({ code, type }) => ({ code, type })), [original[name].value]);
      assert.ok(result.appearance[name].selections.every((selection) => selection.label === null));
    }
    assert.equal(result.completeness.factorySelection, 'complete');
    assert.equal(result.completeness.accessoryQuantities, original.catalogue.completeness.accessoryQuantities);
    assert.equal(result.image, null); assert.equal(result.completeness.image, 'unknown');
    collector = await createFleetCollector(input);
    assert.deepEqual((await collector.run()).accepted, collected.accepted);
    const repeated = await enrichFleet({ ...enrichment, session: collector.session });
    assert.deepEqual(repeated, output); assert.equal(catalogueCalls, 1); assert.equal(catalogueLoads, 1);
    assert.deepEqual((await readdir(rowDirectory)).filter((name) => name !== 'checkpoint.json'), []);
    rows.push({ sourceGroup: group.id, candidateId: captured.candidateId, configurationId: original.configurationId,
      bindingDigest: original.lookupIdentity.bindingDigest, replayPlanDigest,
      originalPlanDigest: original.sourceEvidence.planDigest,
      unchangedCatalogueSha256: sha(Buffer.from(JSON.stringify(original.catalogue))),
      outputDigest: inputDigest(result), factoryOptions: original.resolvedOptions.length,
      accessoryCodes: original.selectedAccessories.length, outcome: result.status,
      factorySelection: result.completeness.factorySelection,
      accessoryQuantities: result.completeness.accessoryQuantities,
      measurements: result.completeness.measurements, image: result.completeness.image,
      catalogueCalls, catalogueLoads, catalogueCacheHits: output.counts.cacheHits.catalogue,
      sourceCalls: output.counts.sourceCalls, httpAttempts: output.counts.httpAttempts,
      elapsedMs: Math.round(performance.now() - rowStarted),
      cacheBeforeReopen, unchangedDeadlineAfterReopen: cacheBeforeReopen === null
        ? null : cacheBeforeReopen.deadlineAt === output.deadlineAt });
    if (index === 0) assert.equal(rows[0].unchangedDeadlineAfterReopen, true);
    await checkpointProgress();
  }
  assert.ok(Object.values(outbound).every((count) => count === 0));
  for (const [path, pin] of Object.entries(proofPlan.sourceFiles))
    await pinnedFile(join(root, path), pin.sha256, pin.bytes);
  const receipt = { schemaVersion: 'f60-new9-offline-replay-receipt.v1',
    startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
    proofPlanSha256: sha(proofPlanBytes), proofSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    sourceGroups: proofPlan.groups.map((group) => ({ id: group.id, sourceAllocationId: group.originalAllocationId,
      originalPlanDigest: group.originalPlanDigest, producerPins: group.producerPins, snapshotVersion: group.snapshotVersion,
      actualRetainedSelections: group.expectedRows })),
    runtimePins: proofPlan.runtimePins, selectedSourceFiles: Object.keys(proofPlan.sourceFiles).length,
    immutableSourceFilesUnchanged: true, actualRetainedSelections: rows.length,
    newlyCollectedSourceConfigurations: 0, originalLiveSessionEnriched: false,
    offlineSessions: rows.length, offlineCatalogueCalls: rows.reduce((sum, row) => sum + row.catalogueCalls, 0),
    catalogueCacheHits: rows.reduce((sum, row) => sum + row.catalogueCacheHits, 0),
    sourceCalls: 0, imageCalls: 0, outbound, partial: rows.length, rejected: 0,
    scope: 'actual retained captures replayed into new explicitly budgeted offline sessions; no live-session enrichment or full Story acceptance',
    rows };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rm(progressPath);
  console.log(JSON.stringify({ actualRetainedSelections: rows.length, offlineSessions: rows.length,
    offlineCatalogueCalls: receipt.offlineCatalogueCalls, catalogueCacheHits: receipt.catalogueCacheHits,
    sourceCalls: 0, imageCalls: 0, outbound, partial: rows.length, rejected: 0 }));
} finally {
  for (const restore of guards.reverse()) restore(); syncBuiltinESMExports();
  await rm(progressStaging, { force: true });
}
