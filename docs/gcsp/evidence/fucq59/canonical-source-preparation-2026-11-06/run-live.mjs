// PROPOSED ONLY. No allocation exists; do not execute during offline preparation.
// The parent must supervise one process group and own scratch/finalization before launch.
import { readFile, writeFile, open, mkdir, lstat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireGate = (condition) => { if (!condition) throw new Error('diagnostic-preflight-refused'); };
const exec = promisify(execFile);
async function boundedBytes(path, limit = 1048576) {
  const stat = await lstat(path); requireGate(stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit);
  const bytes = await readFile(path); requireGate(bytes.length <= limit); return bytes;
}
async function digestFile(path) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest('hex');
}
// Passive exported boundaries permit offline validation; none invokes the source executor.
export async function consumeOnceMarker(path, content, { openFile = open } = {}) {
  const marker = await openFile(path, 'wx', 0o600);
  try { await marker.writeFile(JSON.stringify(content) + '\n'); await marker.sync(); }
  finally { await marker.close(); }
  // The exclusive name must be durable before any transport can consume its allocation.
  const parent = await openFile(dirname(path), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
const operationNames = ['page', 'settings', 'discover', 'options'];
function receiptCounts(counts) {
  const number = (value) => Number.isSafeInteger(value) && value >= 0;
  const scalars = ['sourceCalls', 'failures', 'timeouts', 'substitutions', 'cacheEvictions', 'httpAttempts', 'decodedBytes'];
  requireGate(counts && scalars.every((key) => number(counts[key]))
    && counts.httpAttempts <= 4 && counts.sourceCalls <= counts.httpAttempts);
  const selected = Object.fromEntries(scalars.map((key) => [key, counts[key]]));
  for (const field of ['operations', 'cacheHits', 'operationBytes']) {
    requireGate(counts[field] && operationNames.every((name) => number(counts[field][name])
      && (field !== 'operations' || counts[field][name] <= 1)));
    selected[field] = Object.fromEntries(operationNames.map((name) => [name, counts[field][name]]));
  }
  return selected;
}
export async function inspectCheckpoint({ statePath, diagnostic, planDigest }) {
  let bytes;
  try { bytes = await boundedBytes(statePath); }
  catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'invalid' }; }
  const metadata = { sha256: sha(bytes), bytes: bytes.length, retained: false };
  try {
    // The pinned producer checks envelope schema/contentDigest, complete session/source/plan/
    // limits/transport identity, counters, attempts, cache bounds and every payloadDigest.
    // No stage option: inspection cannot create a fresh stage or commit a checkpoint.
    const state = await diagnostic.session.withCheckpoint(async ({ state }) => {
      const stage = state.stages['source-qualification-diagnostic'];
      requireGate(stage?.version === '1' && stage.inputDigest === planDigest
        && stage.data !== null && typeof stage.data === 'object' && !Array.isArray(stage.data));
      return structuredClone(state);
    });
    requireGate(sha(await boundedBytes(statePath)) === metadata.sha256);
    return { status: 'valid', ...metadata, counts: receiptCounts(state.counts),
      artifacts: Object.fromEntries([['discover', 'tree'], ['options', 'options']].map(([operation, key]) =>
        [key, state.cache.find((row) => row.operation === operation)?.payload ?? null])) };
  } catch { return { status: 'invalid', ...metadata }; }
}
export async function retainDiagnosticReceipt({ outputRoot, result, failure = null, cancelled = false,
  checkpoint = { status: 'missing' }, provenance }, { write = writeFile } = {}) {
  const retained = []; const exportFailures = [];
  let counts = null; let countBasis = 'unknown; no verified accounting available';
  if (result) {
    try { counts = receiptCounts(result.counts); countBasis = 'executor final result'; }
    catch { failure ||= 'diagnostic-result-accounting-invalid'; }
  }
  if (!counts && checkpoint.status === 'valid') {
    counts = receiptCounts(checkpoint.counts);
    countBasis = 'validated last persisted checkpoint; lower bound on interrupted work';
  }
  for (const [operation, key] of [['discover', 'tree'], ['options', 'options']]) {
    const artifact = result?.diagnostic?.[key] ?? (checkpoint.status === 'valid' ? checkpoint.artifacts?.[key] : null);
    if (!artifact) continue;
    const file = key + '.json'; let bytes;
    try {
      bytes = Buffer.from(JSON.stringify(artifact.document) + '\n');
      requireGate(bytes.length <= 131072 && artifact.bytes === bytes.length && artifact.sha256 === sha(bytes)
        && artifact.document?.observation?.operation === operation && artifact.document.requestScope?.role === 'request-input-only');
    } catch { exportFailures.push({ operation, file, reason: 'diagnostic-artifact-validation-failed' }); continue; }
    try {
      await write(join(outputRoot, file), bytes, { flag: 'wx', mode: 0o600 });
      requireGate((await boundedBytes(join(outputRoot, file), 131072)).equals(bytes));
      retained.push({ operation, file, bytes: bytes.length, sha256: sha(bytes) });
    } catch { exportFailures.push({ operation, file, reason: 'diagnostic-artifact-export-failed' }); }
  }
  const safeCode = (code) => typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code : null;
  const { artifacts: ignoredArtifacts, counts: ignoredCounts, ...checkpointMetadata } = checkpoint;
  const receipt = { schemaVersion: 'f59-live-diagnostic-receipt.v1', ...provenance,
    completedAt: new Date().toISOString(), reason: safeCode(failure) || exportFailures[0]?.reason || safeCode(result?.reason) || 'diagnostic-incomplete',
    cancelled, counts, countBasis, checkpoint: checkpointMetadata, artifacts: retained, exportFailures,
    bootstrapObservations: result?.diagnostic?.bootstrapObservations ?? [],
    qualification: 'observation-only-schema-diagnostic', admission: false, accepted: [], distinctConfigurations: 0,
    solver: 0, sourceWrites: 0, imageRequests: 0, browser: 0, sql: 0, credentialLookups: 0, fullRawRetention: 0,
    cleanup: 'PENDING supervisor process-group join, scratch removal and independent absence receipt; once marker remains spent',
    reviewRequired: 'actual raw localisation pointer/root binding; no classifier, F39/F54 publication or schema compatibility claim' };
  await write(join(outputRoot, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return receipt;
}
async function main() {
  requireGate(process.argv.length === 3 && isAbsolute(process.argv[2]));
  const allocation = JSON.parse(await boundedBytes(process.argv[2], 131072));
  const planBytes = await boundedBytes(join(directory, 'diagnostic-plan.json'), 131072);
  const handoffBytes = await boundedBytes(join(directory, 'execution-handoff.json'), 131072);
  const plan = JSON.parse(planBytes); const handoff = JSON.parse(handoffBytes);
  // The draft handoff is intentionally non-executable. Only a separate parent allocation opens this gate.
  requireGate(allocation.executable === true && allocation.id === plan.planId
    && allocation.sourceVersion === plan.source.version && allocation.attempts === 4 && allocation.bytes === 2097152
    && allocation.planSha256 === sha(planBytes) && allocation.planSha256 === handoff.plan.sha256 && allocation.handoffSha256 === sha(handoffBytes)
    && allocation.runnerSha256 === await digestFile(fileURLToPath(import.meta.url))
    && allocation.reviewedCodeTestIdentity === handoff.producer.reviewedCodeTestIdentity
    && allocation.reviewVerdicts?.code === 'passed' && allocation.reviewVerdicts?.security === 'passed'
    && /^[a-f0-9]{40}$/.test(allocation.producerCommit) && allocation.remoteVerifiedCommit === allocation.producerCommit
    && new Date().toISOString().slice(0, 10) === plan.qualificationDate
    && allocation.supervisorFinalizerRegistered === true);
  const root = allocation.producerRoot; const scratch = allocation.scratchRoot;
  requireGate(isAbsolute(root || '') && await realpath(root) === root && isAbsolute(scratch || '')
    && await realpath(scratch) === scratch && (await lstat(scratch)).isDirectory()
    && ['TMPDIR', 'TMP', 'TEMP'].every((key) => process.env[key] === scratch)
    && isAbsolute(allocation.ownershipManifest || '') && relative(scratch, allocation.ownershipManifest).startsWith('../')
    && allocation.outputRoot === handoff.resources.retainedOutputRoot);
  const ownership = JSON.parse(await boundedBytes(allocation.ownershipManifest, 131072));
  requireGate(ownership.root === scratch && typeof ownership.token === 'string');
  const git = async (args) => (await exec('git', ['-C', root, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 131072,
  })).stdout.trim();
  requireGate(await git(['rev-parse', 'HEAD']) === allocation.producerCommit
    && await git(['status', '--porcelain', '--untracked-files=no']) === '');
  const pins = { ...handoff.producer.moduleHashes, ...handoff.producer.reviewedEightPathHashes, ...handoff.producer.frozenContractHashes };
  for (const [path, digest] of Object.entries(pins)) requireGate(await digestFile(join(root, path)) === digest);
  requireGate(allocation.runtimeSha256 === await digestFile(process.execPath));
  const { inputDigest } = await import(pathToFileURL(join(root, 'server/gcsp/repository/core.js')));
  const { createPublicBmwQualificationDiagnostic } = await import(pathToFileURL(join(root, 'scripts/gcsp/collect-fleet.mjs')));
  requireGate(inputDigest(plan) === allocation.planDigest && allocation.planDigest === handoff.plan.inputDigest);
  // Retained output is separate from disposable owned scratch. Existing output/marker refuses, never resumes traffic.
  await mkdir(allocation.outputRoot, { mode: 0o700 });
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const statePath = join(scratch, 'diagnostic-session.json'); const startedAt = new Date().toISOString();
  let result; let diagnostic; let failure = null;
  try {
    try {
      await consumeOnceMarker(handoff.onceMarker.path, { allocation: allocation.id, state: 'reserved-and-consumed',
        reservedAt: new Date().toISOString(), planDigest: inputDigest(plan), producerCommit: allocation.producerCommit });
    } catch { const error = new Error('once-marker-publication-failed'); error.code = 'once-marker-publication-failed'; throw error; }
    diagnostic = await createPublicBmwQualificationDiagnostic({ plan, statePath, mode: 'live',
      http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: allocation.sourceVersion,
        attempts: allocation.attempts, bytes: allocation.bytes, planDigest: inputDigest(plan) }, fetch: globalThis.fetch.bind(globalThis) },
      onPhase: async () => { if (cancelled) { const error = new Error('diagnostic-cancelled'); error.code = 'diagnostic-cancelled'; throw error; } } });
    result = await diagnostic.run();
    requireGate(result.admission === false && result.accepted.length === 0 && result.coverage.distinctConfigurations === 0);
  } catch (error) {
    // Never retain transport error messages/stacks, headers or raw source data.
    failure = typeof error.code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(error.code) ? error.code : 'diagnostic-runner-failure';
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
  const checkpoint = await inspectCheckpoint({ statePath, diagnostic, planDigest: inputDigest(plan) });
  const receipt = await retainDiagnosticReceipt({ outputRoot: allocation.outputRoot, result, failure, cancelled, checkpoint,
    provenance: { allocation: allocation.id, producerCommit: allocation.producerCommit,
      codeTestIdentity: handoff.producer.reviewedCodeTestIdentity, planSha256: sha(planBytes),
      planDigest: inputDigest(plan), startedAt } });
  console.log(JSON.stringify({ reason: receipt.reason, counts: receipt.counts, retained: receipt.artifacts.map((row) => row.file), accepted: 0, admission: false }));
  if (failure || cancelled || receipt.exportFailures.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('diagnostic-runner-stopped; inspect bounded supervisor receipt; allocation marker must never be reset'); process.exitCode = 1; });
