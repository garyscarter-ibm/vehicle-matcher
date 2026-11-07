/** Prepared observation only. Parent must release this exact four-GET allocation. */
import { readFile, writeFile, appendFile, open, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createEnrichmentObserver } from '../../../../../scripts/gcsp/enrichment-observation.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const directory = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const encode = (v) => JSON.stringify(v) + '\n';
const allocation = JSON.parse(await readFile(join(directory, 'execution-plan.json')));
if (process.env.F60_OBSERVATION_SOURCE_GRANT !== allocation.id) throw new Error('explicit-root-traffic-grant-required');
const plan = JSON.parse(await readFile(join(directory, 'observation-plan.json')));
if (inputDigest(plan) !== allocation.planDigest || plan.qualificationDate !== new Date().toISOString().slice(0, 10)) throw new Error('source-plan-date-mismatch');
for (const [path, digest] of Object.entries(allocation.codePins)) if (sha(await readFile(join(root, path))) !== digest) throw new Error('source-code-pin-mismatch');
const sourceBytes = await readFile(join(root, allocation.acceptedSource.path));
const line = sourceBytes.subarray(0, sourceBytes.indexOf(10) + 1);
if (sha(sourceBytes) !== allocation.acceptedSource.fileSha256 || sha(line) !== plan.registration.sourceAcceptedSha256
  || JSON.parse(line).configurationId !== plan.registration.configurationId) throw new Error('accepted-source-pin-mismatch');
if (allocation.attempts !== 4 || allocation.decodedBytes !== 4194304 || allocation.primary !== join(directory, 'observer-checkpoint.json')) throw new Error('allocation-mismatch');
const statePath = allocation.primary;
try { await stat(statePath); throw new Error('existing-primary-preserved'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const marker = await open(join(directory, 'execution-once.json'), 'wx', 0o600);
try { await marker.writeFile(encode({ id: allocation.id, planDigest: allocation.planDigest, state: 'reserved-and-consumed', at: new Date().toISOString() })); await marker.sync(); } finally { await marker.close(); }
const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
const startedAt = new Date().toISOString(); const started = performance.now(); let actualAttempts = 0; let result; let failure = null;
try {
  const observer = await createEnrichmentObserver({ plan, statePath, http: { kind: 'live',
    allocation: { id: allocation.id, sourceVersion: plan.source.version, planDigest: allocation.planDigest, attempts: 4, bytes: 4194304 },
    fetch: async (url, options) => {
      actualAttempts += 1;
      // Registered request URLs are public and nonopaque. Headers and bodies never enter the log.
      await appendFile(join(directory, 'source-events.jsonl'), encode({ attempt: actualAttempts, method: 'GET', url, at: new Date().toISOString() }), { mode: 0o600 });
      return globalThis.fetch(url, options);
    } } });
  result = await observer.run();
} catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'source-execution-failed'; }
let checkpointSha256 = null; let counts = null; const artifacts = {};
try {
  if ((await stat(statePath)).size > plan.limits.checkpointBytes) throw new Error('checkpoint-budget');
  const bytes = await readFile(statePath); const envelope = JSON.parse(bytes);
  if (inputDigest(envelope.content) !== envelope.contentDigest) throw new Error('checkpoint-integrity');
  checkpointSha256 = sha(bytes); counts = envelope.content.counts;
  for (const [name, artifact] of Object.entries(envelope.content.observations)) {
    const projected = encode(artifact.document);
    if (sha(projected) !== artifact.sha256 || Buffer.byteLength(projected) !== artifact.bytes) throw new Error('artifact-integrity');
    await writeFile(join(directory, name + '.json'), projected, { flag: 'wx', mode: 0o600 }); artifacts[name] = artifact.sha256;
  }
} catch (error) { failure ||= 'checkpoint-export-incomplete'; }
const receipt = { schemaVersion: 'f60-observation-receipt.v1', allocationId: allocation.id, planDigest: allocation.planDigest,
  startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), status: result?.status || 'incomplete',
  reason: failure || result?.reason || null, actualAttempts, counts, checkpointSha256, artifacts,
  admission: false, meaningsQualified: false, unitsQualified: false, imageFidelityQualified: false,
  rawBodiesRetained: false, settingsRetained: false, opaqueUrlsRetained: false, sourceWrites: 0, retries: 0, images: 0,
  physicalBuildDate: 'unknown', f60Acceptance: false };
await writeFile(join(directory, 'receipt.json'), encode(receipt), { flag: 'wx', mode: 0o600 });
console.log(encode({ status: receipt.status, reason: receipt.reason, actualAttempts, counts }).trim());
if (failure || result?.status !== 'observed') process.exitCode = 1;
