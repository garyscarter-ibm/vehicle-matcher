/** Finite model-options inspection. This module grants no source traffic by itself. */
import { readFile, writeFile, appendFile, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicBmwOptionsQualification } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validatePublicBmwOptionsPlan, validatePublicBmwOptionsObservations } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { bmwModelOptionsRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const allocation = JSON.parse(await readFile(join(base, 'execution-plan.json')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value) + '\n';
const plans = [];
for (const id of allocation.contextIds) {
  const plan = JSON.parse(await readFile(join(base, id, 'qualification-plan.json'))); validatePublicBmwOptionsPlan(plan);
  plans.push(plan);
  if (inputDigest(plan) !== allocation.contextPlanDigests[id]) throw new Error('source-context-plan-digest-mismatch');
  const urls = bmwModelOptionsRequestUrls({ model: plan.modelRegistration, line: plan.lineRegistration });
  if (inputDigest(urls) !== inputDigest(allocation.contextUrls[id])) throw new Error('source-request-url-mismatch');
}
if (inputDigest(plans) !== allocation.planDigest) throw new Error('source-series-plan-digest-mismatch');
for (const [path, expected] of Object.entries(allocation.codePins)) if (sha(await readFile(join(root, path))) !== expected) throw new Error('source-code-pin-mismatch');
if (process.argv[2] === '--check') {
  console.log(JSON.stringify({ status: 'prepared-only', planDigest: allocation.planDigest, contexts: allocation.contextIds,
    publicGetCeiling: 16, sourceTraffic: false, newConfigurations: 0, sourceCapacityCredit: 0 }));
} else {
  if (process.env.F70_REMAINING_OPTIONS_SOURCE_GRANT !== allocation.id) throw new Error('explicit-root-traffic-grant-required');
  const id = process.argv[2]; if (!allocation.contextIds.includes(id)) throw new Error('unregistered-context');
  const plan = plans[allocation.contextIds.indexOf(id)];
  if (plan.qualificationDate !== new Date().toISOString().slice(0, 10)) throw new Error('source-qualification-date-mismatch');
  const directory = join(base, id); const primary = join(directory, 'collector-checkpoint.json');
  const save = (name, value) => writeFile(join(directory, name), encode(value), { flag: 'wx', mode: 0o600 });
  try { await stat(primary); throw new Error('existing-primary-preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const marker = await open(join(directory, 'execution-once.json'), 'wx', 0o600);
  try { await marker.writeFile(encode({ allocationId: allocation.id, planDigest: inputDigest(plan), state: 'reserved-and-consumed', reservedAt: new Date().toISOString() })); await marker.sync(); }
  finally { await marker.close(); }
  const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
  let actualAttempts = 0; let result; let failure; let checkpointSha256 = null; const started = performance.now();
  try {
    const work = await createPublicBmwOptionsQualification({ plan, statePath: primary, mode: 'live', http: { kind: 'live',
      allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: inputDigest(plan), attempts: 4, bytes: plan.limits.sourceBytes },
      fetch: async (url, options) => {
        if (++actualAttempts > 4) throw new Error('four-get-ceiling');
        const request = { attempt: actualAttempts, method: options.method, url, at: new Date().toISOString() };
        await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'started' }), { mode: 0o600 });
        const response = await globalThis.fetch(url, options);
        await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'headers-received', status: response.status }), { mode: 0o600 });
        return response;
      } } });
    result = await work.run();
  } catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'model-options-execution-failed'; }
  try {
    const bytes = await readFile(primary); const envelope = JSON.parse(bytes);
    if (inputDigest(envelope.content) !== envelope.contentDigest) throw new Error('checkpoint-integrity');
    validatePublicBmwOptionsObservations(plan, envelope.content, 'live'); checkpointSha256 = sha(bytes);
    await writeFile(join(directory, 'collector-state.json'), bytes, { flag: 'wx', mode: 0o600 });
    for (const [field, name] of [['contextObservation', 'tree.json'], ['optionsObservation', 'options.json']]) if (envelope.content[field]) {
      const artifact = envelope.content[field]; const encoded = encode(artifact.document);
      if (sha(encoded) !== artifact.sha256 || Buffer.byteLength(encoded) !== artifact.bytes) throw new Error('artifact-integrity');
      await writeFile(join(directory, name), encoded, { flag: 'wx', mode: 0o600 });
    }
    await save('line-relationships.json', envelope.content.trimRelationships);
  } catch (error) { failure ||= error.code === 'ENOENT' ? 'primary-unavailable' : 'model-options-export-failed'; }
  const reason = failure || result?.reason || 'model-options-result-unavailable';
  const receipt = { schemaVersion: 'f70-model-options-context-receipt.v1', allocationId: allocation.id, planDigest: inputDigest(plan),
    codeCommit: allocation.codeCommit, modelCode: plan.modelRegistration.modelCode, agModelCode: plan.modelRegistration.agModelCode,
    line: plan.lineRegistration, reason, status: reason === 'source-options-qualified' ? 'observed-typed-options-only' : 'stopped',
    elapsedMs: Math.round(performance.now() - started), actualAttempts, counts: result?.counts || null, checkpointSha256,
    admitted: 0, newConfigurations: 0, sourceCapacityCredit: 0, solverRequests: 0, imageRequests: 0, sourceWrites: 0,
    rawBodiesRetained: false, settingsRetained: false, retries: 0, browser: 0, acceptance: false };
  await save('receipt.json', receipt); console.log(JSON.stringify(receipt));
  if (reason !== 'source-options-qualified') process.exitCode = 1;
}
