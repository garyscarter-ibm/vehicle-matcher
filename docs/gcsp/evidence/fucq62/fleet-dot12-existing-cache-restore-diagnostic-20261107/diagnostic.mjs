// One proposed offline restore from an immutable existing cache into owned scratch.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, rename, stat, lstat, mkdir, copyFile, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const base = fileURLToPath(new URL('.', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function sha(path) { const h = createHash('sha256'); for await (const bytes of createReadStream(path)) h.update(bytes); return h.digest('hex'); }
const bytes = await readFile(join(base, 'plan.json'));
assert.equal(hash(bytes), process.env.REVIEWED_PLAN_SHA256);
const plan = JSON.parse(bytes), grant = JSON.parse(await readFile(process.env.ROOT_RELEASE_PATH));
assert.equal(grant.authorized, true);
assert.equal(grant.phase, 'existing-cache-restore');
assert.equal(grant.planSha256, hash(bytes));
assert.equal(grant.runtimeTarget, plan.runtimeTarget);
assert.equal(grant.manifestDigest, plan.manifestDigest);
assert.equal(grant.networkRequests, 0);
assert.equal(grant.runtimeProjectionAllowed, true);
assert.deepEqual(grant.runtimeProjection, plan.runtimeProjection);
assert.equal(plan.runtimeProjection.diagnosticInstrumentation, false);
assert.equal(process.env.PHASE_OUTPUT, plan.outputRoot);
assert.match(process.env.TMPDIR || '', /\/test-stamp-shard-[a-f0-9]+$/);
assert.ok(process.env.TMPDIR.startsWith(join(plan.outputRoot, '.scratch') + '/'));
assert.equal(process.env.TMP, process.env.TMPDIR);
assert.equal(process.env.TEMP, process.env.TMPDIR);
assert.equal(Object.hasOwn(process.env, 'GCSP_DATABASE_URL'), false);
for (const pin of [plan.restorePlan, plan.packageReceipt, plan.descriptor, plan.registrationProposal,
  plan.previousValidatorDiagnostic.plan, plan.previousValidatorDiagnostic.result, plan.previousValidatorDiagnostic.receipt,
  plan.previousRegistryDiagnostic.plan, plan.previousRegistryDiagnostic.result, plan.previousRegistryDiagnostic.receipt,
  plan.assetIdentityComparison.publicPublicationReceipt, ...plan.runtimePins, ...plan.inputPins]) {
  if (pin.bytes !== undefined) assert.equal((await stat(pin.path)).size, pin.bytes, pin.path);
  assert.equal(await sha(pin.path), pin.sha256, pin.path);
}
for (const pin of plan.preparedScripts) assert.equal(await sha(join(base, pin.name)), pin.sha256);
assert.equal(join(plan.cacheRoot, plan.manifestDigest), plan.packageRoot);
assert.equal((await lstat(plan.packageRoot)).isDirectory(), true);
assert.equal((await lstat(plan.packageRoot)).isSymbolicLink(), false);
const store = join(process.env.TMPDIR, plan.freshStoreRelativeToOwnedScratch);
assert.equal(plan.freshStoreRelativeToOwnedScratch, 'restored-store');
await assert.rejects(lstat(store), { code: 'ENOENT' });
const started = performance.now();
let stage = 'inputs-checked', egress, rawError = null, publicResult = null, restoreCalls = 0;
async function checkpoint(status, extra = {}) {
  const path = join(plan.outputRoot, status === 'complete' || status === 'failed' ? 'receipt.json' : 'progress.json');
  await writeFile(path + '.tmp', JSON.stringify({ schemaVersion: 'fleet-dot12-existing-cache-restore-receipt.v1', status, stage,
    runtimeTarget: plan.runtimeTarget, manifestDigest: plan.manifestDigest, planSha256: hash(bytes),
    elapsedMs: performance.now() - started, publicResult, rawError, restoreCalls, sourceCalls: 0,
    networkRequests: egress?.calls.length ?? 0, diagnosticOnly: true, originalAttempt2CauseProved: false,
    publicAnonymousColdAttemptSucceeded: false, acceptance: false, ...extra }, null, 2) + '\n');
  await rename(path + '.tmp', path);
}
try {
  await checkpoint('in-progress');
  const guardPin = plan.runtimePins.find(pin => pin.relativePath === 'scripts/gcsp/fleet-offline-guard.mjs');
  const { installFleetOfflineGuard } = await import(pathToFileURL(guardPin.path));
  egress = installFleetOfflineGuard();
  assert.equal(egress.control(), 'blocked');
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
  const anchor = join(runtime, plan.runtimeProjection.anchorRelativePath);
  await copyFile(plan.registrationProposal.path, anchor);
  assert.equal(await sha(anchor), plan.registrationProposal.sha256);
  await symlink(plan.runtimeProjection.nodeModules, join(runtime, 'server/node_modules'), 'dir');
  stage = 'runtime-projected';
  await checkpoint('in-progress', { sourceModulesUnchanged: true, blockedEgressControl: true });
  const { restoreFleetRelease } = await import(pathToFileURL(join(runtime, 'server/gcsp/vehicle-evidence/fleet-artifacts.js')));
  stage = 'restore-started';
  await checkpoint('in-progress', { store, storeAbsentBefore: true, cacheRoot: plan.cacheRoot });
  restoreCalls++;
  const result = await restoreFleetRelease({ releaseId: plan.manifestDigest, store, cacheRoot: plan.cacheRoot, offline: true });
  publicResult = result;
  assert.ok(Buffer.byteLength(JSON.stringify(publicResult)) <= 65536);
  assert.equal(result.status, 'ok');
  assert.equal(result.mode, 'cold-restore');
  assert.equal(result.active.manifestDigest, plan.manifestDigest);
  assert.equal(result.externalCalls, 0);
  let copiedFiles = 0, copiedLogicalBytes = 0;
  async function measure(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await measure(path);
      else { assert.equal(entry.isFile(), true); copiedFiles++; copiedLogicalBytes += (await stat(path)).size; }
    }
  }
  await measure(store);
  assert.equal(copiedFiles, 11);
  assert.equal(copiedLogicalBytes, plan.resources.copiedCorpusLogicalBytes);
  for (const pin of [...plan.inputPins, ...plan.runtimePins]) assert.equal(await sha(pin.path), pin.sha256, pin.path);
  assert.equal(egress.calls.length, 0);
  stage = 'restore-complete';
  await checkpoint('complete', { offlineExistingCacheRestoreSucceeded: true, store, copiedFiles, copiedLogicalBytes,
    inputPinsUnchanged: true, sourceModulesUnchanged: true, separateValidatorCalls: 0, separateRegistryLoadCalls: 0 });
  console.log(JSON.stringify({ status: 'diagnostic-complete', restoreCalls, publicResult, copiedFiles, copiedLogicalBytes,
    rawError: null, networkRequests: 0, acceptance: false }));
} catch (error) {
  rawError = { name: String(error.name || 'Error').slice(0,64), code: String(error.code || '').slice(0,128),
    message: String(error.message || '').slice(0,2048), stack: String(error.stack || '').slice(0,4096) };
  await checkpoint('failed', { offlineExistingCacheRestoreSucceeded: false, store });
  console.log(JSON.stringify({ status: 'diagnostic-failed', restoreCalls, rawError, networkRequests: egress?.calls.length ?? 0, acceptance: false }));
  process.exitCode = 1;
}
