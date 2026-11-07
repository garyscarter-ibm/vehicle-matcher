/** Validation evidence only: exact retained source through enrichFleet; network unavailable. */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http'; import https from 'node:https';
import { createCollectionSession } from '../../../../../scripts/gcsp/collection-session.mjs';
import { enrichFleet } from '../../../../../scripts/gcsp/enrich-fleet.mjs';
import { BMW_OTD_MAPPING_AUTHORITY } from '../../../../../scripts/gcsp/bmw-technical-qualification.mjs';
const base = dirname(fileURLToPath(import.meta.url)); const prior = join(base, '../actual-v2-observation-2026-11-07');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let outbound = 0; const refuse = () => { outbound += 1; throw new Error('offline-egress-refused'); };
globalThis.fetch = refuse; for (const transport of [http, https]) { transport.request = refuse; transport.get = refuse; }
const allocation = JSON.parse(await readFile(join(prior, 'execution-plan.json')));
const source = await readFile(new URL('../../fucq59/f70-1f7e-first32-solver-2026-11-07/accepted.jsonl', import.meta.url));
if (sha(source) !== allocation.acceptedSource.fileSha256) throw new Error('accepted-source-pin');
const line = source.subarray(0, source.indexOf(10) + 1); const accepted = JSON.parse(line);
const plan = JSON.parse(await readFile(join(prior, 'observation-plan.json'))); const receipt = JSON.parse(await readFile(join(prior, 'receipt.json')));
const bytes = await readFile(join(prior, 'technical.json')); if (sha(bytes) !== receipt.artifacts.technical) throw new Error('retained-source-pin');
const document = JSON.parse(bytes); const artifact = { document, sha256: sha(bytes), bytes: bytes.length };
const technicalOptions = { registration: plan.registration, pins: { retainedSha256: artifact.sha256,
  responseSha256: document.observation.responseSha256, acceptedLineSha256: sha(line), mappingDigest: BMW_OTD_MAPPING_AUTHORITY.digest } };
const statePath = join(base, 'qualified-checkpoint.json');
try { await stat(statePath); throw new Error('existing-primary-preserved'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const operations = { catalogue: { kind: 'offline', sourceId: 'retained-catalogue', sourceVersion: '2', execute: async () => accepted.catalogue },
  technical: { kind: 'offline', sourceId: 'retained-otd', sourceVersion: '1', execute: async () => artifact } };
const limits = { maxAttempts: 1, retryDelayMs: 0, operationTimeoutMs: 10000, deadlineMs: 90000, concurrency: 1, imageRequests: 0,
  cacheEntries: 4, cacheRetentionMs: 86400000, checkpointBytes: 1048576, requestBudgets: { catalogue: 1, technical: 1 } };
const session = await createCollectionSession({ identity: { stage: 'actual-retained-otd-qualification', version: '1', acceptedLineSha256: sha(line),
  retainedSha256: artifact.sha256, mappingDigest: BMW_OTD_MAPPING_AUTHORITY.digest }, operations, limits, statePath, initialState: { accepted: [accepted] } });
const catalogueOptions = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((k) => [k, accepted.lookupIdentity[k]]));
const result = await enrichFleet({ session, accepted: [accepted], catalogueOptions, technicalOperation: 'technical', technicalOptions, asOf: '2026-11-07' });
if (outbound !== 0 || result.counts.sourceCalls !== 0 || result.records[0]?.facts.seats.value !== 5 || result.records[0]?.facts.bodyLength.state !== 'unknown') throw new Error('qualified-output-invalid');
await writeFile(join(base, 'qualified-enrichment.json'), JSON.stringify(result) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ processing: result.processing, knownFacts: Object.keys(result.records[0].facts).filter((k) => result.records[0].facts[k].state === 'known'),
  sourceCalls: result.counts.sourceCalls, outbound, primary: statePath, counts: result.counts, runtimePublication: false }));
