/** One exact eight-request breadth model pilot. A fresh base review and exact source release are required. */
import { readFile, writeFile, appendFile, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validatePublicBmwPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const checking=process.argv[2]==='--check';
if(!checking&&process.env.BMW_SCHEME_BREADTH_TYPED_PILOT_SOURCE_GRANT!=='scheme-breadth-typed-pilot48-20261107-once')throw new Error('explicit-root-traffic-grant-required');
const allocation = JSON.parse(await readFile(join(base, 'execution-plan.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex'); const encode = value => JSON.stringify(value) + '\n';
for(const [path,pin]of Object.entries(allocation.runtimePins))if(sha(await readFile(path))!==pin)throw new Error('source-runtime-pin-mismatch');
const indexes = {}; const plans = [];
for (const [name, pin] of Object.entries(allocation.indexPins)) {
  const bytes = await readFile(pin.path); if (sha(bytes) !== pin.sha256) throw new Error('prior-index-pin-mismatch');
  indexes[name] = JSON.parse(bytes); if (inputDigest(indexes[name]) !== pin.digest || indexes[name].entries.length !== pin.entries) throw new Error('prior-index-identity-mismatch');
}
for (const [path, digest] of Object.entries({ ...allocation.codePins, ...allocation.sourcePins })) if (sha(await readFile(join(root, path))) !== digest) throw new Error('source-code-or-evidence-pin-mismatch');
for (const id of allocation.contextIds) {
  const plan = JSON.parse(await readFile(join(base, id, 'collection-plan.json'))); validatePublicBmwPlan(plan); plans.push(plan);
  if (inputDigest(plan) !== allocation.contextPlanDigests[id] || inputDigest(bmwBatchPlanRequestUrls(plan, plan.candidates[0].request)) !== inputDigest(allocation.contextUrls[id])) throw new Error('source-context-plan-or-url-mismatch');
  if (plan.candidates.some(row => indexes.spent.entries.some(used => used.requestDigest === inputDigest({ modelRegistration: plan.modelRegistration, request: row.request })))) throw new Error('spent-request-replay');
}
if (inputDigest(plans) !== allocation.planDigest || allocation.publicGetCeiling !== 72 || allocation.solverCeiling !== 48) throw new Error('source-series-plan-mismatch');
if (checking) {
  console.log(JSON.stringify({ status: 'prepared-only', allocationId: allocation.id, planDigest: allocation.planDigest, publicGetCeiling: 72, sourceTraffic: false }));
} else {
  if (allocation.baseRefreshRequired) throw new Error('fresh-root-audited-cumulative-base-required');
  const series=JSON.parse(await readFile(join(base,'execution-once.json')));if(series.allocationId!==allocation.id||series.planDigest!==allocation.planDigest)throw new Error('series-reservation-required');
  const id = process.argv[2]; if (!allocation.contextIds.includes(id)) throw new Error('unregistered-context');
  const plan = plans[allocation.contextIds.indexOf(id)];
  if (plan.qualificationDate !== new Date().toISOString().slice(0, 10)) throw new Error('source-qualification-date-mismatch');
  const directory = join(base, id); const statePath = join(directory, 'collector-checkpoint.json');
  const save = (name, value) => writeFile(join(directory, name), encode(value), { flag: 'wx', mode: 0o600 });
  try { await stat(statePath); throw new Error('existing-primary-preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const marker = await open(join(directory, 'execution-once.json'), 'wx', 0o600);
  try { await marker.writeFile(encode({ allocationId: allocation.id, planDigest: inputDigest(plan), state: 'reserved-and-consumed', reservedAt: new Date().toISOString() })); await marker.sync(); }
  finally { await marker.close(); }
  const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
  const { PolicyService, FilePolicyProvider } = await import('../../../../../server/gcsp/policy/index.js');
  let actualAttempts = 0; let result; let failure; let checkpointSha256 = null; let state = null; const started = performance.now();
  try {
    const work = await createFleetCollector({ plan, source: plan.source, statePath, mode: 'live',
      policyService: new PolicyService({ provider: new FilePolicyProvider() }),
      batchBinding: { producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion, existingConfigurationIds: indexes.canonical.entries.map(row => row.configurationId) },
      http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: 12, bytes: plan.limits.sourceBytes },
        fetch: async (url, options) => {
          if (++actualAttempts > 12) throw new Error('twelve-get-ceiling');
          const request = { attempt: actualAttempts, method: options.method, at: new Date().toISOString() };
          await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'started' }), { mode: 0o600 });
          try {
            const response = await globalThis.fetch(url, options);
            await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'headers-received', status: response.status }), { mode: 0o600 }); return response;
          } catch (error) {
            await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'transport-refused', code: /^[a-zA-Z0-9_-]{1,64}$/.test(error.code || '') ? error.code : 'transport-error' }), { mode: 0o600 }); throw error;
          }
        } } });
    result = await work.run();
    // Reopening verifies persisted captures and every admitted record without new source traffic.
    const again = await (await createFleetCollector({ plan, source: plan.source, statePath, mode: 'live',
      policyService: new PolicyService({ provider: new FilePolicyProvider() }),
      batchBinding: { producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion, existingConfigurationIds: indexes.canonical.entries.map(row => row.configurationId) },
      http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: 12, bytes: plan.limits.sourceBytes },
        fetch: async () => { throw new Error('forbidden-retained-replay'); } } })).run();
    if (inputDigest(again.records) !== inputDigest(result.records)) throw new Error('retained-record-mismatch');
  } catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'model-batch-execution-failed'; }
  try {
    const bytes = await readFile(statePath); const envelope = JSON.parse(bytes);
    if (inputDigest(envelope.content) !== envelope.contentDigest) throw new Error('checkpoint-integrity'); state = envelope.content; checkpointSha256 = sha(bytes);
  } catch (error) { failure ||= error.code === 'ENOENT' ? 'primary-unavailable' : 'model-batch-checkpoint-failed'; }
  const reason = failure || result?.reason || 'model-batch-result-unavailable';
  const receipt = { schemaVersion: 'g42-typed-pilot-context-receipt.v1', allocationId: allocation.id, planDigest: inputDigest(plan),
    codeCommit: allocation.codeCommit, modelCode: plan.modelRegistration.modelCode, agModelCode: plan.modelRegistration.agModelCode, line: plan.lineRegistration,
    reason, status: failure ? 'incomplete' : result?.status || 'incomplete', elapsedMs: Math.round(performance.now() - started), actualAttempts,
    counts: state?.counts || result?.counts || null, checkpointSha256, processedCandidates:state?.cursor||0, admitted: state?.accepted.length || 0, records: state?.records.length || 0,
    duplicates: state?.duplicates.length || 0, rejected: state?.rejected.length || 0, retainedSolverCaptures: state?.sourceCaptures.length || 0,
    rawBodiesRetained: false, settingsRetained: false, retries: 0, images: 0, sourceWrites: 0, browser: 0, acceptance: false };
  await save('receipt.json', receipt); console.log(JSON.stringify(receipt));
  receipt.processedCandidates=state?.cursor||0;
  if (failure || receipt.status !== 'complete' || reason !== 'queue-exhausted' || receipt.processedCandidates!==8 || receipt.admitted+receipt.duplicates+receipt.rejected!==8 || actualAttempts!==12) process.exitCode=1;
}
