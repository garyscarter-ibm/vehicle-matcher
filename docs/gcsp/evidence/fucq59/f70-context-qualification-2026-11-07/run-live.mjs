/** Prepared qualification-only allocation. Root must release traffic before supervisor execution. */
import { readFile, writeFile, appendFile, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPublicBmwContextQualification } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const context = process.argv[2];
if (!/^context0[1-6]$/.test(context || '')) throw new Error('exact-context-required');
const directory = join(base, context);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => JSON.stringify(value) + '\n';
const save = (name, value) => writeFile(join(directory, name), encode(value), { flag: 'wx', mode: 0o600 });
const allocation = JSON.parse(await readFile(join(directory, 'execution-plan.json')));
const plan = JSON.parse(await readFile(join(directory, 'qualification-plan.json')));
if (process.env.F70_CONTEXT_SOURCE_GRANT !== allocation.id) throw new Error('explicit-root-traffic-grant-required');
if (plan.qualificationDate !== new Date().toISOString().slice(0, 10) || inputDigest(plan) !== allocation.planDigest) throw new Error('source-plan-date-or-digest-mismatch');
for (const [path, expected] of Object.entries(allocation.codePins)) if (sha(await readFile(join(root, path))) !== expected) throw new Error('source-code-pin-mismatch');
const primary = join(directory, 'collector-checkpoint.json');
try { await stat(primary); throw new Error('existing-primary-preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const marker = await open(join(directory, 'execution-once.json'), 'wx', 0o600);
try { await marker.writeFile(encode({ id: allocation.id, state: 'reserved-and-consumed', planDigest: allocation.planDigest, reservedAt: new Date().toISOString() })); await marker.sync(); }
finally { await marker.close(); }
const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
const startedAt = new Date().toISOString(); const started = performance.now(); let actualAttempts = 0; let result; let failure;
try {
  const qualifier = await createPublicBmwContextQualification({ plan, mode: 'live', statePath: primary,
    http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: allocation.planDigest, attempts: 3, bytes: plan.limits.sourceBytes },
      fetch: async (url, options) => {
        actualAttempts++; const request = { attempt: actualAttempts, method: options.method, url, startedAt: new Date().toISOString() };
        await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'started' }), { mode: 0o600 });
        const response = await globalThis.fetch(url, options);
        await appendFile(join(directory, 'source-events.jsonl'), encode({ ...request, phase: 'headers-received', status: response.status }), { mode: 0o600 });
        return response;
      } } });
  result = await qualifier.run();
} catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'context-execution-failed'; }
let checkpointSha256 = null;
try {
  const bytes = await readFile(primary); const envelope = JSON.parse(bytes);
  if (inputDigest(envelope.content) !== envelope.contentDigest) throw new Error('checkpoint-integrity');
  checkpointSha256 = sha(bytes); await writeFile(join(directory, 'collector-state.json'), bytes, { flag: 'wx', mode: 0o600 });
  if (envelope.content.contextObservation) {
    const artifact = envelope.content.contextObservation; const retained = encode(artifact.document);
    if (sha(retained) !== artifact.sha256 || Buffer.byteLength(retained) !== artifact.bytes) throw new Error('context-artifact-integrity');
    await writeFile(join(directory, 'tree.json'), retained, { flag: 'wx', mode: 0o600 });
  }
} catch (error) { failure ||= error.code === 'ENOENT' ? 'primary-unavailable' : 'context-export-failed'; }
const reason = failure || result?.reason || 'context-result-unavailable';
const normal = ['source-trim-unknown', 'context-observed-options-unallocated'].includes(reason);
const receipt = { schemaVersion: 'f70-context-qualification-receipt.v1', allocationId: allocation.id, planDigest: allocation.planDigest,
  codeCommit: allocation.codeCommit, startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
  status: normal ? 'observed-context-only' : 'stopped', reason, actualAttempts, counts: result?.counts || null, checkpointSha256,
  modelCode: plan.modelRegistration.modelCode, newConfigurations: 0, admitted: 0, optionsRequests: 0, solverRequests: 0,
  rawBodiesRetained: false, settingsRetained: false, retries: 0, images: 0, browser: 0, sourceWrites: 0,
  acceptance: false, remaining: ['typed option definitions', 'exact finite candidate lists and separate allocation', 'model/scheme/profile/year/plant/five-WMI joins'] };
await save('receipt.json', receipt); console.log(JSON.stringify(receipt));
if (!normal) process.exitCode = 1;
