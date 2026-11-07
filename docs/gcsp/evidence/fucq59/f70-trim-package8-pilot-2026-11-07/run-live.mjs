/** Exact frozen eight-candidate pilot; --check never opens a source session or marker. */
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, open, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const mode = process.argv[2];
assert.ok(['--check','--source'].includes(mode) && process.argv.length === 3, 'exact-mode-required');
let forbiddenFetchAttempts = 0;
if (mode === '--check') globalThis.fetch = async () => { forbiddenFetchAttempts++; throw new Error('zero-traffic-preflight'); };
const { validatePublicBmwPlan } = await import('../../../../../scripts/gcsp/public-bmw-source.mjs');
const { validateBmwBatchPlan, bmwPublicRequestUrls, bmwBatchPlanRequestUrls } = await import('../../../../../scripts/gcsp/bmw-public-registration.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value) + '\n';
const read = async path => JSON.parse(await readFile(path));
const allocation = await read(join(base,'execution-plan.json'));
assert.equal(inputDigest(allocation),(await read(join(base,'execution-reservation.json'))).executionPlanSha256);
for (const [path,digest] of Object.entries(allocation.codePins)) assert.equal(sha(await readFile(join(root,path))),digest,path);
for (const [path,digest] of Object.entries(allocation.inputPins)) assert.equal(sha(await readFile(path)),digest,path);
const plan = await read(join(base,'collection-plan.json'));
const index = await read(allocation.indexPins.canonical.path); const spent = await read(allocation.indexPins.spent.path);
assert.equal(inputDigest(plan),allocation.planDigest); validatePublicBmwPlan(plan); validateBmwBatchPlan(plan);
assert.equal(plan.qualificationDate,new Date().toISOString().slice(0,10),'fresh-qualification-date-required');
assert.equal(inputDigest(index),allocation.priorIndexDigest); assert.equal(inputDigest(spent),allocation.spentIndexDigest);
assert.equal(index.entries.length,876); assert.equal(spent.entries.length,1586);
assert.equal(index.entries.filter(r=>r.origins.some(o=>o.kind==='admitted-source')).length,873);
assert.equal(plan.source.version,'f59-batch-20261107.v1'); assert.equal(plan.lineRegistration,undefined);
assert.equal(plan.candidateCount,8); assert.equal(plan.candidates.length,8); assert.equal(allocation.attempts,12);
assert.equal(plan.limits.sourceAttempts,12); assert.equal(plan.limits.maxAttempts,1); assert.equal(plan.limits.deadlineMs,120000);
assert.equal(plan.limits.sourceBytes,allocation.decodedBytes); assert.equal(plan.limits.responseBytes,1048576);
assert.equal(allocation.continuationReleased,false); assert.equal(allocation.capacityCreditBeforeSource,0);
const used = new Set(spent.entries.map(r=>r.requestDigest)); assert.equal(used.size,1586);
const requests = plan.candidates.map(c=>inputDigest({modelRegistration:plan.modelRegistration,request:c.request}));
assert.deepEqual(requests,allocation.requestDigests); assert.equal(new Set(requests).size,8); assert.equal(requests.some(d=>used.has(d)),false);
const definitions = new Map((await read(join(root,plan.candidateDefinitionBasis.path))).report.candidates[0].definitions.map(d=>[d.code,d]));
for (const c of plan.candidates) {
 const included=c.request.includedElements; const digest=inputDigest({modelRegistration:plan.modelRegistration,request:c.request});
 assert.equal(c.candidateId,'candidate-'+digest.slice(0,24)); assert.deepEqual(c.request.mandatoryElements,['S033B']);
 assert.deepEqual(included,[...new Set(included)].sort()); assert.ok(included.includes('S043U'));
 assert.equal(included.filter(c=>['S07EV','S07EW'].includes(c)).length,1); assert.equal(included.includes('S01H0'),false);
 for (const code of included) { assert.ok(definitions.has(code)); assert.deepEqual(definitions.get(code).issues,[]); }
 for (const kind of ['paint','fabric','rim']) assert.equal(included.filter(c=>definitions.get(c).optionType===kind).length,1);
 const urls=bmwBatchPlanRequestUrls(plan,c.request); assert.deepEqual(urls,bmwPublicRequestUrls(plan.modelRegistration,c.request));
 const url=new URL(urls.solve); assert.equal(url.searchParams.get('mandatory-elements'),'S033B'); assert.equal(url.searchParams.get('included-elements'),included.join(','));
}
const directory = allocation.artifactDestination;
if (mode === '--check') {
 assert.equal(existsSync(allocation.outputRoot),false,'no-output-root-or-marker-before-grant');
 assert.equal(forbiddenFetchAttempts,0);
 console.log(JSON.stringify({status:'prepared-only',allocationId:allocation.id,planDigest:allocation.planDigest,
   candidateCount:8,publicGetCeiling:12,sourceTraffic:0,forbiddenFetchAttempts,baseline:allocation.baseline,
   runtimePins:Object.keys(allocation.codePins).length,sourceRootAbsent:true,clockStarted:false,continuationReleased:false,capacityCredit:0}));
 process.exit(0);
}
assert.equal(process.env.F70_TRIM_PACKAGE8_SOURCE_GRANT,allocation.id,'explicit-parent-traffic-grant-required');
assert.equal(process.env.F70_TRIM_PACKAGE8_SUPERVISOR,allocation.id,'owned-supervisor-required');
const seriesMarker = await read(join(allocation.outputRoot,'execution-once.json'));
assert.equal(seriesMarker.id,allocation.seriesId); assert.equal(seriesMarker.state,'reserved-and-consumed');
const remainingSeriesMs=()=>900000-(Date.now()-Date.parse(seriesMarker.reservedAt));
assert.ok(remainingSeriesMs()>0,'original-series-clock-expired');
for (const [name,pin] of [['prior-canonical-index.json',allocation.indexPins.canonical],['spent-request-index.json',allocation.indexPins.spent]])
 assert.equal(sha(await readFile(join(directory,name))),pin.sha256);
assert.equal(sha(await readFile(join(directory,'collection-plan.json'))),sha(await readFile(join(base,'collection-plan.json'))));
assert.equal(inputDigest(await read(join(directory,'execution-plan.json'))),inputDigest(allocation));
const { createFleetCollector } = await import('../../../../../scripts/gcsp/collect-fleet.mjs');
const { PolicyService, FilePolicyProvider } = await import('../../../../../server/gcsp/policy/index.js');
const save = (path,value)=>writeFile(join(directory,path),encode(value),{flag:'wx',mode:0o600});
const statePath = join(directory, allocation.checkpointFile);
const readCheckpoint = async () => {
  if ((await stat(statePath)).size > plan.limits.checkpointBytes) throw new Error('checkpoint-budget');
  const bytes = await readFile(statePath); const value = JSON.parse(bytes);
  if (inputDigest(value.content) !== value.contentDigest) throw new Error('checkpoint-integrity');
  return { bytes, state: value.content };
};
try { await stat(statePath); throw new Error('existing-primary-preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
        if (++actualAttempts > 12 || remainingSeriesMs() <= 0) throw new Error('finite-pilot-source-ceiling'); const request = { attempt: actualAttempts, method: options.method, url, startedAt: new Date().toISOString() };
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
const receipt = { schemaVersion: 'f70-trim-package8-source-receipt.v1', allocationId: allocation.id, planDigest: allocation.planDigest,
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
