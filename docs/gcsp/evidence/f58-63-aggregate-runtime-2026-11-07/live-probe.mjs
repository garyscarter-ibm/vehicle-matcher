import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createLocalVehicleEvidenceLookup } from '../../../../server/gcsp/vehicle-evidence/local-vehicle-lookup.js';

const [code, deploymentText, expectedManifest, sourceText, reportPath] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(code || '') || !/^\d+$/.test(deploymentText || '')
  || !/^[a-f0-9]{64}$/.test(expectedManifest || '') || !/^\d+$/.test(sourceText || '')
  || !isAbsolute(reportPath || '')) throw Error('explicit-probe-pins-required');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const store = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const pointer = JSON.parse(await readFile(join(store, 'active.json'), 'utf8'));
if (pointer.selected.manifestDigest !== expectedManifest) throw Error('local-manifest-pin-mismatch');
const selected = join(store, 'versions', pointer.selected.directory);
const manifestBytes = await readFile(join(selected, 'manifest.json'));
if (createHash('sha256').update(manifestBytes).digest('hex') !== expectedManifest) throw Error('local-manifest-pin-mismatch');
const manifest = JSON.parse(manifestBytes);
if (manifest.counts.qualifyingCompleteDistinctSourceConfigurations !== Number(sourceText)) throw Error('local-source-count-mismatch');
const rows = async (name) => (await readFile(join(selected, name), 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
const configurations = await rows('configurations.jsonl');
const vins = await rows('vins.jsonl');
const requests = [...configurations.map((r) => ({ kind: 'configuration', id: r.configurationId })),
  ...vins.map((r) => ({ kind: 'vin', id: r.vin17 }))];
const lookup = createLocalVehicleEvidenceLookup({ root: store, asOf: '2026-11-07T00:00:00.000Z' });
const limits = { GET: 512, decodedBytes: 16 * 1024 * 1024, responseBytes: 1024 * 1024,
  requestMs: 10000, wallMs: 90000, workers: 1, retries: 0 };
if (requests.length + 1 > limits.GET) throw Error('probe-record-budget');
const started = Date.now(); let count = 0; let bytes = 0; let failure = null; const results = [];
async function get(path) {
  if (++count > limits.GET || Date.now() - started > limits.wallMs) throw Error('live-probe-budget');
  const began = performance.now();
  const response = await fetch('https://gcsp-api.onrender.com' + path,
    { signal: AbortSignal.timeout(Math.min(limits.requestMs, Math.max(1, limits.wallMs - (Date.now() - started)))), redirect: 'error' });
  const parts = []; let received = 0;
  for await (const part of response.body) {
    received += part.length; bytes += part.length;
    if (received > limits.responseBytes || bytes > limits.decodedBytes) throw Error('live-probe-byte-bound');
    parts.push(part);
  }
  const body = Buffer.concat(parts).toString('utf8');
  return { status: response.status, body: response.status === 200 ? JSON.parse(body) : null,
    elapsedMs: performance.now() - began };
}
try {
  const health = await get('/health');
  if (health.status !== 200 || health.body?.ok !== true) throw Error('live-health-unavailable');
  for (const request of requests) {
    const expected = await lookup.resolve(request);
    const group = request.kind === 'configuration' ? 'configurations' : 'vins';
    const actual = await get('/api/gcsp/vehicle-evidence/' + group + '/' + encodeURIComponent(request.id));
    const match = actual.status === 200 && isDeepStrictEqual(actual.body, expected)
      && actual.body?.versions?.manifestDigest === expectedManifest;
    results.push({ ...request, status: actual.status, match, elapsedMs: actual.elapsedMs });
    if (actual.status === 401) throw Error('access-key-required');
    if (!match) throw Error('deployed-dto-mismatch');
  }
} catch (error) { failure = /^[a-z-]{1,96}$/.test(error.message) ? error.message : 'live-probe-failed'; }
const report = { status: failure ? 'incomplete' : 'verified-live-partial-corpus',
  startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), code,
  deployment: Number(deploymentText), manifestDigest: expectedManifest, requests: count, decodedBytes: bytes,
  limits, compared: results.length, expected: requests.length, errors: results.filter((r) => !r.match).length,
  failure, results, sourceQualifiedDistinct: Number(sourceText), target10000Met: Number(sourceText) >= 10000,
  scope: 'Every active configuration and retained VIN; exact JSON parity with the local loader. Read-only production GETs.' };
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, compared: report.compared, errors: report.errors,
  requests: count, decodedBytes: bytes, failure }));
if (failure) process.exitCode = 1;
