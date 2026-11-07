/** Actual retained source32 -> fresh offline collector session -> F60 proof. */
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
  assert.ok(['--source-directory', '--receipt'].includes(name) && isAbsolute(value || '')
    && !argumentsByName.has(name), 'Supply explicit absolute source-directory and receipt paths.');
  argumentsByName.set(name, value);
}
assert.equal(argumentsByName.size, 2);
const sourceDirectory = resolve(argumentsByName.get('--source-directory'));
const receiptPath = resolve(argumentsByName.get('--receipt'));
const progressPath = receiptPath + '.progress.json';
const progressStaging = progressPath + '.writing';
const scratch = resolve(process.env.TMPDIR || '');
assert.equal(scratch, '/tmp/vehicle-matcher-f58-63-20261106/f60-source32-replay',
  'Run only with the declared supervisor-owned TMPDIR.');
assert.ok(!receiptPath.startsWith(scratch + '/') && receiptPath !== scratch,
  'Retain the compact receipt outside disposable scratch.');
const proofPlanBytes = await readFile(new URL('source-batch32-replay-plan.json', import.meta.url));
const proofPlan = JSON.parse(proofPlanBytes);
for (const path of [receiptPath, progressPath, progressStaging])
  await assert.rejects(stat(path), { code: 'ENOENT' }, 'Retained proof output must be new.');
const selectedFiles = new Map();
async function pinnedFile(path, digest, maxBytes = 16 * 1024 * 1024) {
  assert.ok((await stat(path)).size <= maxBytes, 'Selected input exceeds its finite byte bound.');
  const bytes = await readFile(path);
  assert.equal(sha(bytes), digest, 'Selected immutable input changed: ' + path);
  return bytes;
}
for (const [path, pin] of Object.entries(proofPlan.sourceFiles))
  selectedFiles.set(path, await pinnedFile(join(sourceDirectory, path), pin.sha256, pin.bytes));
for (const [path, digest] of Object.entries(proofPlan.runtimePins))
  await pinnedFile(join(root, path), digest);
const parse = (name) => JSON.parse(selectedFiles.get(name));
const sourcePlan = parse('collection-plan.json');
const allocation = parse('execution-plan.json');
const checkpoint = parse('collector-state.json');
assert.equal(inputDigest(sourcePlan), allocation.planDigest);
assert.equal(inputDigest(checkpoint.content), checkpoint.contentDigest);
assert.deepEqual(allocation.producerPins, proofPlan.producerPins);
assert.equal(allocation.snapshotVersion, proofPlan.snapshotVersion);
const originals = selectedFiles.get('accepted.jsonl').toString('utf8').trim().split('\n').map(JSON.parse);
assert.equal(originals.length, proofPlan.expectedRows);
assert.equal(new Set(originals.map((row) => row.configurationId)).size, proofPlan.expectedRows);
assert.deepEqual(checkpoint.content.accepted, originals);
const captures = new Map(checkpoint.content.sourceCaptures.map((row) => [row.solver.sha256, row]));
const policyService = new PolicyService({ provider: new FilePolicyProvider() });
const rows = []; const startedAt = new Date().toISOString(); const started = performance.now();
async function checkpointProgress() {
  await writeFile(progressStaging, JSON.stringify({ schemaVersion: 'f60-source32-offline-replay-progress.v1',
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
  for (const [index, original] of originals.entries()) {
    const rowStarted = performance.now();
    const captured = captures.get(original.sourceEvidence.solver);
    assert.ok(captured, 'Each admitted row needs its actual retained solver capture.');
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
    const artifact = (name, retained) => ({ bytes: selectedFiles.get(name),
      artifactSha256: retained.sha256, retrievedAt: retained.retrievedAt });
    const input = { plan, mode: 'capture-replay', policyService,
      statePath: join(rowDirectory, 'checkpoint.json'),
      captureReplay: {
        artifacts: { tree: artifact('tree.json', checkpoint.content.batchEvidence.tree),
          solver: artifact('solver/' + captured.candidateId + '.json', captured.solver) },
        definitionBinding: { options: artifact('options.json', checkpoint.content.batchEvidence.options) },
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
      const interruption = new Error('source32 replay interruption after durable catalogue cache');
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
    rows.push({ candidateId: captured.candidateId, configurationId: original.configurationId,
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
    await pinnedFile(join(sourceDirectory, path), pin.sha256, pin.bytes);
  const receipt = { schemaVersion: 'f60-source32-offline-replay-receipt.v1',
    startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
    proofPlanSha256: sha(proofPlanBytes), proofSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    sourceDirectory, sourceAllocationId: allocation.id, originalSourcePlanDigest: allocation.planDigest,
    producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion,
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
