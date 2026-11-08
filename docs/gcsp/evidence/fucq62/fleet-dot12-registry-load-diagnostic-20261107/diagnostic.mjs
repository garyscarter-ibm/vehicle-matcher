// Proposed single offline registry-load observation. Exact root grant and supervision required.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename, stat, mkdir, copyFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const base = fileURLToPath(new URL('.', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
async function sha(path) { const h = createHash('sha256'); for await (const bytes of createReadStream(path)) h.update(bytes); return h.digest('hex'); }
const bytes = await readFile(join(base, 'plan.json'));
assert.equal(hash(bytes), process.env.REVIEWED_PLAN_SHA256);
const plan = JSON.parse(bytes), grant = JSON.parse(await readFile(process.env.ROOT_RELEASE_PATH));
assert.equal(grant.authorized, true);
assert.equal(grant.phase, 'registry-load');
assert.equal(grant.planSha256, hash(bytes));
assert.equal(grant.runtimeTarget, plan.runtimeTarget);
assert.equal(grant.manifestDigest, plan.manifestDigest);
assert.equal(grant.networkRequests, 0);
assert.equal(grant.diagnosticCatchProjectionAllowed, true);
assert.deepEqual(grant.runtimeProjection, plan.runtimeProjection);
assert.equal(process.env.PHASE_OUTPUT, plan.outputRoot);
assert.match(process.env.TMPDIR || '', /\/test-stamp-shard-[a-f0-9]+$/);
assert.ok(process.env.TMPDIR.startsWith(join(plan.outputRoot, '.scratch') + '/'));
assert.equal(process.env.TMP, process.env.TMPDIR);
assert.equal(process.env.TEMP, process.env.TMPDIR);
assert.equal(Object.hasOwn(process.env, 'GCSP_DATABASE_URL'), false);
assert.equal(await sha(plan.restorePlan.path), plan.restorePlan.sha256);
assert.equal(await sha(plan.packageReceipt.path), plan.packageReceipt.sha256);
for (const pin of [plan.previousValidatorDiagnostic.plan, plan.previousValidatorDiagnostic.result, plan.previousValidatorDiagnostic.receipt, plan.assetIdentityComparison.publicPublicationReceipt]) assert.equal(await sha(pin.path), pin.sha256);
for (const pin of plan.preparedScripts) assert.equal(await sha(join(base, pin.name)), pin.sha256);
for (const pin of [plan.descriptor, plan.registrationProposal, ...plan.runtimePins, ...plan.inputPins]) {
  if (pin.bytes !== undefined) assert.equal((await stat(pin.path)).size, pin.bytes, pin.path);
  assert.equal(await sha(pin.path), pin.sha256, pin.path);
}
const started = performance.now();
let stage = 'inputs-checked', egress, rawError = null, publicResult = null;
async function checkpoint(status, extra = {}) {
  const path = join(plan.outputRoot, status === 'complete' || status === 'failed' ? 'receipt.json' : 'progress.json');
  await writeFile(path + '.tmp', JSON.stringify({ schemaVersion: 'fleet-dot12-registry-load-receipt.v1', status, stage,
    runtimeTarget: plan.runtimeTarget, manifestDigest: plan.manifestDigest, planSha256: hash(bytes),
    elapsedMs: performance.now() - started, publicResult, rawError, sourceCalls: 0, networkRequests: egress?.calls.length ?? 0,
    diagnosticOnly: true, coldRestoreSucceeded: false, acceptance: false, ...extra }, null, 2) + '\n');
  await rename(path + '.tmp', path);
}
try {
  await checkpoint('in-progress');
  const guardPin = plan.runtimePins.find(pin => pin.relativePath === 'scripts/gcsp/fleet-offline-guard.mjs');
  const { installFleetOfflineGuard } = await import(pathToFileURL(guardPin.path));
  egress = installFleetOfflineGuard();
  assert.equal(egress.control(), 'blocked');
  // This diagnostic has no HTTP server. Deny loopback as well, including any SQL socket.
  net.Socket.prototype.connect = function () { egress.calls.push('all-sockets-denied'); throw new Error('Diagnostic socket denied'); };
  syncBuiltinESMExports();
  const runtime = join(process.env.TMPDIR, 'runtime');
  await mkdir(runtime);
  for (const pin of plan.runtimePins) {
    const target = join(runtime, pin.relativePath);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(pin.path, target);
    assert.equal(await sha(target), pin.sha256, target);
  }
  const anchor = join(runtime, 'server/gcsp/vehicle-evidence/fleet-releases.json');
  await copyFile(plan.registrationProposal.path, anchor);
  assert.equal(await sha(anchor), plan.registrationProposal.sha256);
  await symlink(plan.runtimeProjection.nodeModules, join(runtime, 'server/node_modules'), 'dir');
  const registryModule = join(runtime, plan.runtimeProjection.originalModule.relativePath);
  const original = await readFile(registryModule, 'utf8');
  assert.equal(hash(original), plan.runtimeProjection.originalModule.sha256);
  const { functionStart: start, functionEnd: end, exactCatchBefore: before, exactCatchAfter: after } = plan.runtimeProjection;
  const body = original.slice(start, end);
  assert.equal(hash(body), plan.runtimeProjection.loadFunctionSha256);
  assert.equal(body.split(before).length, 2);
  const instrumented = original.slice(0, start) + body.replace(before, after) + original.slice(end);
  assert.equal(hash(instrumented), plan.runtimeProjection.diagnosticModuleSha256);
  await writeFile(registryModule, instrumented);
  stage = 'runtime-projected';
  await checkpoint('in-progress', { diagnosticModuleSha256: hash(instrumented), blockedEgressControl: true });
  const { createSyntheticRegistry } = await import(pathToFileURL(registryModule));
  const { createPolicyService } = await import(pathToFileURL(join(runtime, 'server/gcsp/policy/index.js')));
  const { releaseLimits } = await import(pathToFileURL(join(runtime, 'server/gcsp/vehicle-evidence/fleet-release.js')));
  const { APPROVED_CORPUS_IMAGES } = await import(pathToFileURL(join(runtime, 'server/gcsp/vehicle-evidence/registered-corpus-images.js')));
  const policyService = createPolicyService();
  const options = { jsonlLimitsForManifest: releaseLimits, sourceArtifactDirectory: plan.packageRoot,
    approvedImages: APPROVED_CORPUS_IMAGES, policyService,
    policyRead: { runId: 'fleet-artifact-restore', asOf: new Date().toISOString() } };
  assert.equal(releaseLimits(plan.manifestDigest).maxBytes, 268435456);
  stage = 'registry-load-started';
  await checkpoint('in-progress');
  const registry = createSyntheticRegistry({ root: plan.registryStore, ...options });
  const result = await registry.load();
  rawError = globalThis[Symbol.for('dot12-registry-load-error')] ?? null;
  publicResult = { status: result.status, failure: result.failure ?? null, active: result.active ?? null,
    stillActive: result.stillActive ?? null, recovered: result.recovered === true };
  assert.ok(Buffer.byteLength(JSON.stringify(publicResult)) <= 65536);
  await policyService.close();
  stage = 'registry-load-complete';
  for (const pin of [...plan.inputPins, ...plan.runtimePins]) assert.equal(await sha(pin.path), pin.sha256, pin.path);
  assert.equal(egress.calls.length, 0);
  await checkpoint('complete', { registryLoadCalls: 1, inputPinsUnchanged: true, diagnosticReproduction: result.status === 'ok' ? 'did-not-reproduce-registry-load-failure' : 'registry-returned-failure',
    originalAttempt2CauseProved: false, registryLoadExecuted: true, separateValidatorCallExecuted: false, storeCopyExecuted: false, historicalConsumerFailures: 2707 });
  console.log(JSON.stringify({ status: 'diagnostic-complete', publicResult, rawError, registryLoadCalls: 1, networkRequests: 0, acceptance: false }));
} catch (error) {
  rawError = { name: String(error.name || 'Error').slice(0,64), code: String(error.code || '').slice(0,128), message: String(error.message || '').slice(0,2048) };
  await checkpoint('failed', { registryLoadCalls: stage === 'registry-load-started' ? 1 : 0, originalAttempt2CauseProved: false });
  throw error;
}
