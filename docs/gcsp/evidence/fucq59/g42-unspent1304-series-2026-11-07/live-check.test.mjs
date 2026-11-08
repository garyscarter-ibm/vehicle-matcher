/** Actual retained artifacts only: pure strict binders, no HTTP port, grant or replay. */
import test from 'node:test';
import { actualEventHistory } from './actual-event-history.mjs';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { createConfigurationKey } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { qualifyBmwSelectionRecord, createBmwSelectionRegistration } from '../../../../../scripts/gcsp/bmw-selection-binding.mjs';
import { bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';

const code = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const series = JSON.parse(readFileSync(join(code, 'series-plan.json')));
const number = Number(process.env.G42_UNSPENT1304_CHECK_SESSION);
assert.ok(Number.isInteger(number) && number >= 1 && number <= series.chunks.length);
const base = series.chunks[number - 1].outputDirectory;
const read = (path) => JSON.parse(readFileSync(path, 'utf8')); const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const allocation = read(join(base, 'execution-plan.json')); const plan = read(join(base, 'collection-plan.json'));
const envelope = read(join(base, 'collector-checkpoint.json')); const state = envelope.content; const receipt = read(join(base, 'receipt.json'));
const prior = read(join(base, 'prior-canonical-index.json')); const spent = read(join(base, 'spent-request-index.json'));

test('primary, standalone safe artifacts and every frozen pin agree', () => {
  assert.equal(inputDigest(state), envelope.contentDigest); assert.equal(sha(join(base, 'collector-checkpoint.json')), receipt.checkpointSha256);
  assert.equal(sha(join(base, 'collector-state.json')), receipt.checkpointSha256);
  for (const [name, artifact] of Object.entries(state.batchEvidence)) assert.equal(sha(join(base, name + '.json')), artifact.sha256);
  for (const row of state.sourceCaptures) assert.equal(sha(join(base, 'solver', row.candidateId + '.json')), row.solver.sha256);
  for (const [path, expected] of Object.entries(allocation.codePins)) assert.equal(sha(join(root, path)), expected, path);
  for (const [path, expected] of Object.entries(allocation.inputPins)) assert.equal(sha(path), expected, path);
});

test('every actual admitted record pass strict source binding and registered catalogue construction', async () => {
  const configurationKey = await createConfigurationKey({ policyService: new PolicyService({ provider: new FilePolicyProvider() }), policyRead: { runId: 'g42-unspent1304-retained-verification', ...plan.policyRead } });
  const artifact = (row) => ({ bytes: JSON.stringify(row.document) + '\n', artifactSha256: row.sha256, retrievedAt: row.retrievedAt || row.document.observation.observedAt });
  assert.equal(state.accepted.length + state.duplicates.length + state.rejected.length, plan.candidateCount);
  assert.equal(state.records.length, state.accepted.length); assert.equal(state.sourceCaptures.length, state.accepted.length + state.duplicates.length);
  for (const row of state.records) {
    const capture = state.sourceCaptures.find((entry) => entry.solver.sha256 === row.sourceEvidence.solver); assert.ok(capture);
    const registration = { plan, configurationKey, producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion,
      artifacts: { tree: artifact(state.batchEvidence.tree), solver: artifact(capture.solver) }, definitionBinding: { options: artifact(state.batchEvidence.options) } };
    assert.equal(qualifyBmwSelectionRecord(row, registration).status, 'qualified');
    assert.ok(createBmwSelectionRegistration(registration));
    assert.ok(state.accepted.some((accepted) => inputDigest(accepted) === inputDigest({ ...row, admission: true })));
  }
});

test('source events, exact candidate URLs and counters account for the declared successful GETs', () => {
  const { events } = actualEventHistory(base, allocation, state);
  const starts = events.filter((row) => row.phase === 'started'); const headers = events.filter((row) => row.phase === 'headers-received');
  assert.equal(events.length, allocation.attempts * 2); assert.equal(starts.length, allocation.attempts); assert.equal(headers.length, allocation.attempts);
  assert.equal(headers.every((row) => row.status === 200), true); assert.equal(starts.every((row) => row.method === 'GET'), true);
  assert.equal(starts.some(row=>Object.hasOwn(row,'url')||Object.hasOwn(row,'headers')),false);
  for(const row of plan.candidates)assert.ok(bmwBatchPlanRequestUrls(plan,row.request).solve);
  assert.deepEqual(state.counts.operations,{page:1,settings:1,discover:1,options:1,solve:plan.candidateCount});
  assert.equal(receipt.reason, 'queue-exhausted'); assert.equal(state.cursor, plan.candidateCount); assert.equal(receipt.actualAttempts, allocation.attempts);
  assert.deepEqual(receipt.counts, state.counts); assert.ok(state.counts.decodedBytes > 0 && state.counts.decodedBytes <= allocation.decodedBytes); assert.equal(state.counts.operations.solve, plan.candidateCount);
  assert.equal(Object.values(state.counts.operationBytes).reduce((a, b) => a + b), state.counts.decodedBytes); assert.equal(state.counts.failures, 0);
});

test('every resolved canonical selection is novel and both cumulative indexes extend exact inputs', () => {
  const known = new Set(prior.entries.map((row) => row.configurationId)); const ids = state.accepted.map((row) => row.configurationId);
  assert.equal(new Set(ids).size, state.accepted.length); assert.equal(ids.some((id) => known.has(id)), false);
  const final = read(join(base, 'final-canonical-index.json')); const finalSpent = read(join(base, 'final-spent-request-index.json'));
  assert.equal(final.entries.length, prior.entries.length + state.accepted.length); assert.equal(final.entries.filter((row) => row.origins.some((origin) => origin.kind === 'admitted-source')).length, prior.entries.filter(row => row.origins.some(origin => origin.kind === 'admitted-source')).length + state.accepted.length);
  assert.equal(finalSpent.entries.length, spent.entries.length + plan.candidateCount); assert.equal(new Set(finalSpent.entries.map((row) => row.requestDigest)).size, spent.entries.length + plan.candidateCount);
  assert.deepEqual(final.entries.slice(0,prior.entries.length),prior.entries);
  assert.deepEqual(finalSpent.entries.slice(0, spent.entries.length), spent.entries);
  assert.deepEqual(finalSpent.entries.slice(spent.entries.length).map((row) => row.requestDigest), plan.candidates.map((row) => inputDigest({ modelRegistration: plan.modelRegistration, request: row.request })));
});

test('exported rows, spent marker and source privacy remain intact', () => {
  const accepted = readFileSync(join(base, 'accepted.jsonl'), 'utf8').split('\n').filter((line) => line.trim()).map(JSON.parse); assert.deepEqual(accepted, state.accepted);
  const exported = read(join(base, 'checkpoint-export.json')); assert.equal(exported.accepted, state.accepted.length); assert.equal(exported.sourceCaptures, state.sourceCaptures.length); assert.equal(exported.checkpointSha256, receipt.checkpointSha256);
  const marker = read(join(base, 'execution-once.json')); assert.equal(marker.id, allocation.id); assert.equal(marker.state, 'reserved-and-consumed');
  assert.doesNotMatch(readFileSync(join(base, 'collector-checkpoint.json'), 'utf8'), /x-api-key|settingsVehicleTree|settingsRuleSolver|settingsLocalisation/);
  assert.equal(readdirSync(base).some((name) => name.startsWith('collector-checkpoint.json.writer-') || name.startsWith('collector-checkpoint.json.writing-')), false);
  assert.equal(receipt.rawBodiesRetained, false); assert.equal(receipt.settingsRetained, false); assert.equal(receipt.f61Acceptance, false);
});
