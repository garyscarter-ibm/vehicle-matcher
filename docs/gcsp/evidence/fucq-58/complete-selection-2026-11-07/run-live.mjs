import { readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBmwSelectionCapture } from '../../../../../scripts/gcsp/capture-bmw-selection.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
const directory = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const allocation = JSON.parse(await readFile(join(directory, 'execution-plan.json'), 'utf8'));
const plan = JSON.parse(await readFile(join(directory, 'collection-plan.json'), 'utf8'));
if (new Date().toISOString().slice(0, 10) !== plan.qualificationDate || inputDigest(plan) !== allocation.planDigest)
  throw new Error('capture-date-or-plan-mismatch');
for (const [path, digest] of Object.entries(allocation.codePins))
  if (sha(await readFile(join(root, path))) !== digest) throw new Error('capture-code-pin-mismatch');
const marker = await open(join(directory, 'execution-once.json'), 'wx', 0o600);
try { await marker.writeFile(JSON.stringify({ id: allocation.id, state: 'reserved-and-consumed',
  planDigest: allocation.planDigest, reservedAt: new Date().toISOString() }) + '\n'); await marker.sync(); }
finally { await marker.close(); }
const parent = await open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
const startedAt = new Date().toISOString(); let result; let failure = null; let capture;
const artifacts = {};
try {
  capture = await createBmwSelectionCapture({ plan, statePath: join(process.env.TMPDIR, 'session.json'),
    http: { kind: 'live', allocation: { id: allocation.id, sourceVersion: plan.source.version,
      attempts: 4, bytes: 2097152, planDigest: allocation.planDigest }, fetch: globalThis.fetch.bind(globalThis) } });
  result = await capture.run();
  const retained = await capture.session.withCheckpoint(async ({ state }) => Object.fromEntries(['discover', 'solve']
    .map((operation) => [operation === 'discover' ? 'tree' : 'solver', state.cache.find((row) => row.operation === operation)?.payload || null])));
  for (const [id, artifact] of Object.entries(retained)) if (artifact) {
    const bytes = Buffer.from(JSON.stringify(artifact.document) + '\n');
    if (bytes.length !== artifact.bytes || sha(bytes) !== artifact.sha256) throw new Error('capture-artifact-mismatch');
    const path = join(directory, id + '.json'); await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    const readback = await readFile(path); if (sha(readback) !== artifact.sha256) throw new Error('capture-export-mismatch');
    artifacts[id] = { path: id + '.json', bytes: readback.length, artifactSha256: sha(readback),
      responseSha256: artifact.document.observation.responseSha256, responseBytes: artifact.document.observation.responseBytes,
      observedAt: artifact.document.observation.observedAt, retrievedAt: new Date().toISOString() };
  }
} catch (error) { failure = /^[a-z0-9-]{1,96}$/.test(error.code || '') ? error.code : 'capture-execution-failed'; }
const receipt = { schemaVersion: 'bmw-complete-selection-receipt.v1', allocationId: allocation.id, planDigest: allocation.planDigest,
  startedAt, completedAt: new Date().toISOString(), status: result?.status || 'incomplete', reason: failure || result?.reason || null,
  counts: result?.counts || null, artifacts, admission: false, accepted: [], rawBodiesRetained: false,
  sourceWrites: 0, images: 0, retries: 0, browser: 0 };
await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: receipt.status, reason: receipt.reason, counts: receipt.counts, artifacts }));
if (receipt.status !== 'observed' || failure) process.exitCode = 1;
