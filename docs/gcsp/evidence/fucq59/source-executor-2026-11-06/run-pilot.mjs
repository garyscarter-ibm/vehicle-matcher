import { readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { PolicyService } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

// This evidence runner cannot repeat a consumed allocation. It is not a second request engine.
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../../../../..');
const plan = JSON.parse(await readFile(join(directory, 'collection-plan.json'), 'utf8'));
const execution = JSON.parse(await readFile(join(directory, 'execution-plan.json'), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const [path, digest] of Object.entries(execution.codePins)) {
  if (sha(await readFile(join(root, path))) !== digest) throw new Error('pilot-code-pin-mismatch');
}
if (sha(await readFile(join(directory, 'collection-plan.json'))) !== execution.collectionPlanSha256
  || execution.allocation.attempts !== 4 || execution.allocation.bytes !== 2097152
  || execution.allocation.sourceVersion !== plan.source.version || execution.executable !== true
  || !isAbsolute(process.env.TMPDIR || '')) throw new Error('pilot-plan-refused');
const markerPath = join(directory, 'execution-once.json');
const marker = await open(markerPath, 'wx', 0o600);
try { await marker.writeFile(JSON.stringify({ allocation: execution.allocation.id, state: 'reserved-and-consumed',
  reservedAt: new Date().toISOString(), planDigest: inputDigest(plan), retries: 0 }) + '\n'); await marker.sync(); }
finally { await marker.close(); }
const requests = [];
const startedAt = new Date().toISOString();
const collector = await createFleetCollector({ plan, source: { kind: 'public-bmw-uk', version: plan.source.version },
  mode: 'live', policyService: new PolicyService(), statePath: join(process.env.TMPDIR, 'pilot-session.json'),
  http: { kind: 'live', allocation: { ...execution.allocation, planDigest: inputDigest(plan) },
    fetch: async (url, options) => {
      const category = url.includes('/model-matrices/') ? 'discover' : url.includes('/rulesolver/') ? 'solve'
        : url.includes('/settings.') ? 'settings' : 'page';
      const record = { category, startedAt: new Date().toISOString(), status: null }; requests.push(record);
      try {
        const response = await fetch(url, options);
        record.status = response.status; record.contentType = (response.headers.get('content-type') || '').split(';')[0];
        return response;
      } catch (error) { record.transportFailure = true; throw error; }
    } } });
const result = await collector.run();
const checkpoint = await readFile(join(process.env.TMPDIR, 'pilot-session.json'));
const retained = { schemaVersion: 'f59-source-executor-observation.v1', allocation: execution.allocation.id,
  startedAt, completedAt: new Date().toISOString(), planDigest: inputDigest(plan), requests,
  checkpointSha256: sha(checkpoint), checkpointBytes: checkpoint.byteLength,
  result: { ...result, checkpoint: 'removed with supervisor-owned scratch after retaining this safe observation' },
  writesToSource: 0, imageRequests: 0, browserOperations: 0, retries: 0, additionalConfigurations: 0 };
await writeFile(join(directory, 'observation.json'), JSON.stringify(retained, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: result.status, reason: result.reason, counts: result.counts,
  sourceObservations: result.sourceObservations.length, accepted: result.accepted.length, requests: requests.map(({ category, status }) => ({ category, status })) }));
