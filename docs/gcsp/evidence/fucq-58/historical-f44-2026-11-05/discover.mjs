import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runDiscovery } from './catalogue.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--execute-historical-f44-discovery') throw Error('explicit-discovery-execution-required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const planBytes = await readFile(new URL('./plan.json', import.meta.url));
const plan = JSON.parse(planBytes);
if (process.env.FUCQ58_ADMITTED_RUN !== plan.run) throw Error('admitted-run-required');
const preflight = JSON.parse(await readFile(new URL('./preflight.json', import.meta.url)));
if (preflight.status !== 'passed' || preflight.networkAttempts !== 0 || preflight.planSha256 !== hash(planBytes) || preflight.tests.passed !== 16 || preflight.tests.failed !== 0 || preflight.tests.skipped !== 0) throw Error('offline-preflight-required');
for (const [relative, expected] of Object.entries(plan.inputs)) {
  if (relative.startsWith('/') || relative.split('/').includes('..') || hash(await readFile(new URL('../../../../../' + relative, import.meta.url))) !== expected) throw Error('discovery-input-hash');
}
const sources = {};
for (const name of ['discover.mjs', 'catalogue.mjs', 'catalogue.test.mjs']) {
  sources[name] = hash(await readFile(new URL('./' + name, import.meta.url)));
  if (sources[name] !== preflight.fileSha256[name]) throw Error('discovery-source-hash');
}
const execution = { version: 'historical-f44-execution.v1', run: plan.run, chunk: plan.chunk, startedAt: new Date().toISOString(), planSha256: hash(planBytes), fileSha256: sources, inputs: plan.inputs, requestsAdmitted: 3, concurrency: 1, retries: 0, readOnly: true };
const executionBytes = JSON.stringify(execution, null, 2) + '\n';
// Exclusive creation preserves the finite budget after an interrupted or completed attempt.
await writeFile(new URL('./execution.json', import.meta.url), executionBytes, { flag: 'wx' });
const result = await runDiscovery(plan);
const observation = { ...result, planSha256: hash(planBytes), fileSha256: sources, inputs: plan.inputs, executionRecordSha256: hash(executionBytes), authority: plan.authority, interpretation: plan.interpretation };
const bytes = JSON.stringify(observation, null, 2) + '\n';
if (Buffer.byteLength(bytes) > plan.limits.outputBytes) throw Error('observation-output-limit');
await writeFile(new URL('./observation.json', import.meta.url), bytes, { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, stop: result.stop, attempts: result.attempts, decodedBytes: result.decodedBytes, elapsedMs: result.elapsedMs, ranges: result.observations.map(({ requestedRange, requestedRangeFound, models }) => ({ requestedRange, requestedRangeFound, modelCount: models.length })), newConfigurations: 0, profileActivations: 0 }));
if (result.status !== 'completed-discovery') process.exitCode = 1;
