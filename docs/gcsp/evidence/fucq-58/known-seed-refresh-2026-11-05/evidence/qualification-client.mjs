import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runQualification } from './qualification.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--execute-known-seed-refresh') throw Error('explicit-known-seed-execution-required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const planBytes = await readFile(new URL('../plan.json', import.meta.url));
const plan = JSON.parse(planBytes);
if (process.env.FUCQ58_ADMITTED_RUN !== plan.run) throw Error('admitted-run-required');
const preflight = JSON.parse(await readFile(new URL('./preflight.json', import.meta.url)));
if (preflight.status !== 'passed' || preflight.networkAttempts !== 0 || preflight.planSha256 !== hash(planBytes) || preflight.tests.passed !== 12 || preflight.tests.failed !== 0 || preflight.tests.skipped !== 0) throw Error('offline-preflight-required');
for (const [relative, expected] of Object.entries(plan.inputs)) {
  if (relative.startsWith('/') || relative.split('/').includes('..') || hash(await readFile(new URL('../../../../../../' + relative, import.meta.url))) !== expected) throw Error('qualification-input-hash');
}
const sources = {};
for (const name of ['qualification-client.mjs', 'qualification.mjs', 'qualification.test.mjs']) {
  sources[name] = hash(await readFile(new URL('./' + name, import.meta.url)));
  if (sources[name] !== preflight.fileSha256[name]) throw Error('qualification-source-hash');
}
const execution = { version: 'fleet-known-seed-execution.v1', run: plan.run, startedAt: new Date().toISOString(), planSha256: hash(planBytes), fileSha256: sources, inputs: plan.inputs, authority: plan.authority, requestsAdmitted: 4, concurrency: 1, retries: 0, readOnly: true };
const executionText = JSON.stringify(execution, null, 2) + '\n';
// The exclusive marker prevents another execution, including after a partial or crashed run.
await writeFile(new URL('./execution.json', import.meta.url), executionText, { flag: 'wx' });
const result = await runQualification(plan);
const observation = { ...result, requestedContext: plan.context, planSha256: hash(planBytes), fileSha256: sources, inputs: plan.inputs, executionRecordSha256: hash(executionText), authority: plan.authority, interpretation: 'Fresh exact known-seed corroboration only. No new configuration, corpus capacity, VIN profile, fitted-equipment, steering-code semantics or year/plant/era qualification.' };
await writeFile(new URL('./observation.json', import.meta.url), JSON.stringify(observation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: observation.status, stop: observation.stop, attempts: observation.attempts, decodedBytes: observation.decodedBytes, elapsedMs: observation.elapsedMs, knownConfiguration: observation.build?.knownConfiguration ?? false, additionalConfigurations: 0, profileActivations: 0, output: 'observation.json' }));
if (observation.status !== 'completed-known-seed-refresh') process.exitCode = 1;
