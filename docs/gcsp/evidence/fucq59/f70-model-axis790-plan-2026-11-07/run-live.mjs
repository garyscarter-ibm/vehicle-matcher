/** One exact declared model-axis session of at most eight requests. Parent series release is required. */
import { readFile, writeFile, appendFile, open, stat, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const series = JSON.parse(await readFile(join(base, 'series-plan.json')));
const number = Number(process.argv[2]);
if (!Number.isInteger(number) || number < 1 || number > series.chunks.length) throw new Error('exact-declared-chunk-required');
const entry = series.chunks[number - 1];
const directory = entry.outputDirectory;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => JSON.stringify(value) + '\n';
const save = (path, value) => writeFile(join(directory, path), encode(value), { flag: 'wx', mode: 0o600 });
const allocation = JSON.parse(await readFile(join(directory, 'execution-plan.json')));
const plan = JSON.parse(await readFile(join(directory, 'collection-plan.json')));
const index = JSON.parse(await readFile(join(directory, 'prior-canonical-index.json')));
const spent = JSON.parse(await readFile(join(directory, 'spent-request-index.json')));
if (allocation.id !== series.id + '-session' + String(number).padStart(3, '0') || process.env.F70_MODEL_AXIS790_SOURCE_GRANT !== allocation.id) throw new Error('explicit-root-traffic-grant-required');
if (sha(await readFile(join(directory, 'execution-plan.json'))) !== JSON.parse(await readFile(join(directory, 'execution-reservation.json'))).executionPlanSha256) throw new Error('chunk-allocation-integrity');
for (const [path, digest] of Object.entries(allocation.inputPins))
  if (sha(await readFile(path)) !== digest) throw new Error('source-input-pin-mismatch');
if (inputDigest(spent) !== allocation.spentIndexDigest || plan.candidates.some((row) => spent.entries.some((used) => used.requestDigest === inputDigest({ modelRegistration: plan.modelRegistration, request: row.request })))) throw new Error('spent-request-replay');
if (plan.qualificationDate !== new Date().toISOString().slice(0, 10) || inputDigest(plan) !== allocation.planDigest
  || inputDigest(index) !== allocation.priorIndexDigest) throw new Error('source-plan-date-or-index-mismatch');
for (const [path, digest] of Object.entries(allocation.codePins))
  if (sha(await readFile(join(root, path))) !== digest) throw new Error('source-code-pin-mismatch');
if (allocation.checkpointFile !== 'collector-checkpoint.json' || allocation.retainedDeliverables.primary !== join(directory, 'collector-checkpoint.json')) throw new Error('retained-checkpoint-destination');
const statePath = join(directory, allocation.checkpointFile);
const readCheckpoint = async () => {
  if ((await stat(statePath)).size > plan.limits.checkpointBytes) throw new Error('checkpoint-budget');
  const bytes = await readFile(statePath); const value = JSON.parse(bytes);
  if (inputDigest(value.content) !== value.contentDigest) throw new Error('checkpoint-integrity');
  return { bytes, state: value.content };
};
try { await stat(statePath); throw new Error('existing-primary-preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const phase = series.phases[entry.phase];
const seriesMarker = JSON.parse(await readFile(join(series.outputRoot, entry.phase + '-once.json')));
if (seriesMarker.id !== phase.grantId || seriesMarker.state !== 'reserved-and-consumed') throw new Error('original-phase-marker-required');
const remainingSeriesMs=()=>phase.maximumWallSeconds*1000-(Date.now()-Date.parse(seriesMarker.reservedAt));
if (remainingSeriesMs()<=0) throw new Error('original-series-clock-expired');
const marker = await open(join(directory, 'execution-once.json'), 'wx', 0o600);
try { await marker.writeFile(encode({ id: allocation.id, state: 'reserved-and-consumed', planDigest: allocation.planDigest, reservedAt: new Date().toISOString() })); await marker.sync(); }
finally { await marker.close(); }
const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
const startedAt = new Date().toISOString(); const started = performance.now(); let actualAttempts = 0;
const sourceEvents = join(directory, 'source-events.jsonl'); let collector; let result; let failure = null; let persisted = null;
const perOutcome = async () => {
  const { state } = await readCheckpoint(); const cursor = state.cursor; const candidate = plan.candidates[cursor - 1];
  const capture = state.sourceCaptures.find((row) => row.candidateId === candidate?.candidateId);
  const duplicate = state.duplicates.find((row) => row.candidateId === candidate?.candidateId);
  const rejected = state.rejected.find((row) => row.candidateId === candidate?.candidateId);
  const selected = capture && state.records.find((row) => row.sourceEvidence.solver === capture.solver.sha256);
  await appendFile(join(directory, 'outcomes.jsonl'), encode({ cursor, candidateId: candidate?.candidateId,
    outcome: rejected ? 'rejected' : duplicate ? 'duplicate' : selected ? 'accepted' : 'unresolved',
    configurationId: selected?.configurationId || duplicate?.configurationId || null,
    rejection: rejected?.code || null, priorBatch: duplicate?.priorBatch ?? false,
    source: capture ? { responseSha256: capture.solver.document.observation.responseSha256, responseBytes: capture.solver.document.observation.responseBytes,
      observedAt: capture.solver.document.observation.observedAt, retainedSha256: capture.solver.sha256 } : null,
    solverChanges: selected?.solverChanges || duplicate?.solverChanges || null, counts: state.counts }), { mode: 0o600 });
};
try {
  collector = await createFleetCollector({ plan, source: plan.source, mode: 'live', statePath,
    policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    batchBinding: { producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion, existingConfigurationIds: index.entries.map((row) => row.configurationId) },
    http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: allocation.planDigest, attempts: allocation.attempts, bytes: allocation.decodedBytes },
      fetch: async (url, options) => {
        if (++actualAttempts > allocation.attempts || remainingSeriesMs()<=0) throw new Error('finite-model-axis-allocation-expired'); const request = { attempt: actualAttempts, method: options.method, url, startedAt: new Date().toISOString() };
        await appendFile(sourceEvents, encode({ ...request, phase: 'started' }), { mode: 0o600 });
        try {
          const response = await globalThis.fetch(url, options);
          await appendFile(sourceEvents, encode({ ...request, phase: 'headers-received', status: response.status, at: new Date().toISOString() }), { mode: 0o600 });
          return response;
        } catch (error) {
          await appendFile(sourceEvents, encode({ ...request, phase: 'transport-refused', code: /^[a-zA-Z0-9_-]{1,64}$/.test(error.code || '') ? error.code : 'transport-error', at: new Date().toISOString() }), { mode: 0o600 });
          throw error;
        }
      } }, onPhase: async (phase) => { if (phase === 'outcome-committed') await perOutcome(); } });
  result = await collector.run();
} catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'source-execution-failed'; }
try { persisted = await readCheckpoint(); } catch { /* preserve the spent marker and honest failure receipt */ }
if (persisted) {
  await writeFile(join(directory, 'collector-state.json'), persisted.bytes, { flag: 'wx', mode: 0o600 });
  const state = persisted.state;
  if (state.batchEvidence) for (const [id, value] of Object.entries(state.batchEvidence)) {
    const bytes = encode(value.document); if (sha(bytes) !== value.sha256 || Buffer.byteLength(bytes) !== value.bytes) throw new Error('artifact-integrity');
    await writeFile(join(directory, id + '.json'), bytes, { flag: 'wx', mode: 0o600 });
  }
  await mkdir(join(directory, 'solver'), { recursive: true });
  for (const row of state.sourceCaptures) {
    const bytes = encode(row.solver.document); if (sha(bytes) !== row.solver.sha256 || Buffer.byteLength(bytes) !== row.solver.bytes) throw new Error('artifact-integrity');
    await writeFile(join(directory, 'solver', row.candidateId + '.json'), bytes, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(join(directory, 'accepted.jsonl'), state.accepted.map(encode).join(''), { flag: 'wx', mode: 0o600 });
  await save('outcome-index.json', { attemptedOutcomes: plan.candidates.slice(0, state.counts.operations.solve).map((candidate) => {
    const captured = state.sourceCaptures.find((row) => row.candidateId === candidate.candidateId);
    const duplicate = state.duplicates.find((row) => row.candidateId === candidate.candidateId);
    const rejected = state.rejected.find((row) => row.candidateId === candidate.candidateId);
    const selected = captured && state.records.find((row) => row.sourceEvidence.solver === captured.solver.sha256);
    return { candidateId: candidate.candidateId, request: candidate.request,
      outcome: rejected ? 'rejected' : duplicate ? 'duplicate' : selected ? 'accepted' : 'stopped',
      reason: rejected?.code || (!captured ? failure || result?.reason || state.halted : null),
      configurationId: selected?.configurationId || duplicate?.configurationId || null,
      retainedSha256: captured?.solver.sha256 || null, responseSha256: captured?.solver.document.observation.responseSha256 || null,
      responseEvidence: captured ? 'retained-safe-source-projection' : 'body-not-retained-after-refusal; status/attempt/bytes/checkpoint remain recorded' };
  }), sourceCaptures: state.sourceCaptures.map((row) => ({ candidateId: row.candidateId, retainedSha256: row.solver.sha256,
    source: row.solver.document.observation, retrievedAt: row.solver.retrievedAt })), rejected: state.rejected, duplicates: state.duplicates });
}
const elapsedMs = Math.round(performance.now() - started); const state = persisted?.state;
const receipt = { schemaVersion: 'f70-model-axis790-source-receipt.v1', allocationId: allocation.id, planDigest: allocation.planDigest,
  codeCommit: allocation.codeCommit, startedAt, completedAt: new Date().toISOString(), elapsedMs,
  reason: failure || result?.reason || state?.halted || null, status: result?.status || 'incomplete', actualAttempts,
  counts: state?.counts || null, coverage: result?.coverage || null, newlyAccepted: state?.accepted.length || 0,
  duplicates: state?.duplicates.length || 0, rejected: state?.rejected.length || 0, processedCandidates: state?.cursor || 0,
  retainedSolverCaptures: state?.sourceCaptures.length || 0, priorCanonicalIndexEntries: index.entries.length,
  priorAdmittedSourceConfigurations: index.entries.filter((row) => row.origins.some((origin) => origin.kind === 'admitted-source')).length,
  sourceRate: { candidatesPerSecond: elapsedMs ? (state?.counts.operations.solve || 0) / (elapsedMs / 1000) : null },
  checkpointSha256: persisted ? sha(persisted.bytes) : null, rawBodiesRetained: false, settingsRetained: false,
  retries: 0, sourceWrites: 0, images: 0, browser: 0, f61Acceptance: false, remaining: ['F60 enrichment and F54 publication/application integration', 'target10000 distinct source configurations', 'original model/profile/year/plant/five-WMI distribution evidence'] };
await save('receipt.json', receipt);
console.log(JSON.stringify({ status: receipt.status, reason: receipt.reason, elapsedMs, actualAttempts,
  newlyAccepted: receipt.newlyAccepted, duplicates: receipt.duplicates, rejected: receipt.rejected, counts: receipt.counts, coverage: receipt.coverage }));
if (failure || !result || result.reason !== 'queue-exhausted') process.exitCode = 1;
