/** Prepared new three-GET allocation; parent source release is required before invocation. */
import { readFile, writeFile, appendFile, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRangeShapeDiagnostic } from './diagnostic-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const allocation = JSON.parse(await readFile(join(base, 'execution-plan.json')));
const plan = JSON.parse(await readFile(join(base, 'qualification-plan.json')));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => JSON.stringify(value) + '\n';
const save = (name, value) => writeFile(join(base, name), encode(value), { flag: 'wx', mode: 0o600 });
if (process.env.F70_RANGE_SHAPE_SOURCE_GRANT !== allocation.id) throw new Error('explicit-root-traffic-grant-required');
if (plan.qualificationDate !== new Date().toISOString().slice(0, 10) || inputDigest(plan) !== allocation.planDigest) throw new Error('source-plan-date-or-digest-mismatch');
for (const [path, expected] of Object.entries(allocation.codePins)) if (sha(await readFile(join(root, path))) !== expected) throw new Error('source-code-pin-mismatch');
const primary = join(base, 'collector-checkpoint.json');
try { await stat(primary); throw new Error('existing-primary-preserved'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const marker = await open(join(base, 'execution-once.json'), 'wx', 0o600);
try { await marker.writeFile(encode({ id: allocation.id, state: 'reserved-and-consumed', planDigest: allocation.planDigest, reservedAt: new Date().toISOString() })); await marker.sync(); }
finally { await marker.close(); }
const parent = await open(base, 'r'); try { await parent.sync(); } finally { await parent.close(); }
let actualAttempts = 0; let result; let failure; const startedAt = new Date().toISOString(); const started = performance.now();
try {
  const work = await createRangeShapeDiagnostic({ plan, statePath: primary, mode: 'live', http: { kind: 'live',
    allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: allocation.planDigest, attempts: 3, bytes: plan.limits.sourceBytes },
    fetch: async (url, options) => {
      const request = { attempt: ++actualAttempts, method: options.method, url, startedAt: new Date().toISOString() };
      await appendFile(join(base, 'source-events.jsonl'), encode({ ...request, phase: 'started' }), { mode: 0o600 });
      const response = await globalThis.fetch(url, options);
      await appendFile(join(base, 'source-events.jsonl'), encode({ ...request, phase: 'headers-received', status: response.status }), { mode: 0o600 });
      return response;
    } } });
  result = await work.run();
} catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'range-shape-execution-failed'; }
let checkpointSha256 = null;
try {
  const bytes = await readFile(primary); const envelope = JSON.parse(bytes);
  if (inputDigest(envelope.content) !== envelope.contentDigest) throw new Error('checkpoint-integrity');
  checkpointSha256 = sha(bytes); await writeFile(join(base, 'collector-state.json'), bytes, { flag: 'wx', mode: 0o600 });
  for (const [field, name] of [['contextObservation', 'tree.json'], ['rangeShape', 'range-shape.json']]) if (envelope.content[field]) {
    const artifact = envelope.content[field]; const encoded = encode(artifact.document);
    if (sha(encoded) !== artifact.sha256 || Buffer.byteLength(encoded) !== artifact.bytes) throw new Error('artifact-integrity');
    await writeFile(join(base, name), encoded, { flag: 'wx', mode: 0o600 });
  }
} catch (error) { failure ||= error.code === 'ENOENT' ? 'primary-unavailable' : 'range-shape-export-failed'; }
const reason = failure || result?.reason || 'range-shape-result-unavailable';
const receipt = { schemaVersion: 'f70-one-context-range-shape-receipt.v1', allocationId: allocation.id, planDigest: allocation.planDigest,
  codeCommit: allocation.codeCommit, startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
  status: reason === 'range-shape-observed' ? 'observed-shape-only' : 'stopped', reason, actualAttempts, counts: result?.counts || null,
  checkpointSha256, modelCode: plan.modelRegistration.modelCode, admitted: 0, newConfigurations: 0, optionsRequests: 0, solverRequests: 0,
  rawBodiesRetained: false, settingsRetained: false, retries: 0, images: 0, browser: 0, sourceWrites: 0, acceptance: false,
  remaining: ['review actual diagnostic relationships', 'independently qualify exact options request', 'separate candidate/source allocation'] };
await save('receipt.json', receipt); console.log(JSON.stringify(receipt));
if (reason !== 'range-shape-observed') process.exitCode = 1;
