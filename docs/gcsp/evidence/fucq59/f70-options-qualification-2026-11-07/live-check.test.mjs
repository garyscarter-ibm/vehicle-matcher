/** Retained actual-source reconciliation only; no HTTP port or source grant is installed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validatePublicBmwOptionsObservations } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8')); const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const allocation = read(join(base, 'execution-plan.json')); const plan = read(join(base, 'qualification-plan.json'));
const envelope = read(join(base, 'collector-checkpoint.json')); const state = envelope.content; const receipt = read(join(base, 'receipt.json'));

test('actual primary, source identity, typed projections and standalone artifacts validate', () => {
  assert.equal(envelope.contentDigest, inputDigest(state)); assert.equal(sha(join(base, 'collector-checkpoint.json')), receipt.checkpointSha256);
  assert.equal(sha(join(base, 'collector-state.json')), receipt.checkpointSha256);
  assert.doesNotThrow(() => validatePublicBmwOptionsObservations(plan, state, 'live'));
  for (const [field, name] of [['contextObservation', 'tree.json'], ['optionsObservation', 'options.json']]) {
    assert.equal(sha(join(base, name)), state[field].sha256); assert.deepEqual(read(join(base, name)), state[field].document);
  }
  assert.deepEqual(read(join(base, 'trim-relationships.json')), state.trimRelationships);
});

test('actual receipt and source events account for precisely four successful GETs', () => {
  const events = readFileSync(join(base, 'source-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 8); const starts = events.filter((row) => row.phase === 'started'); const headers = events.filter((row) => row.phase === 'headers-received');
  assert.deepEqual(starts.map((row) => row.attempt), [1, 2, 3, 4]); assert.deepEqual(headers.map((row) => row.status), [200, 200, 200, 200]);
  assert.equal(starts.every((row) => row.method === 'GET'), true); assert.equal(starts.some((row) => /rulesolver/.test(row.url)), false);
  assert.equal(receipt.reason, 'source-options-qualified'); assert.equal(receipt.actualAttempts, 4);
  assert.deepEqual(receipt.counts, state.counts); assert.equal(state.counts.sourceCalls, 4); assert.equal(state.counts.httpAttempts, 4);
  assert.deepEqual(state.counts.operations, { discover: 1, options: 1, page: 1, settings: 1 });
  assert.equal(state.counts.decodedBytes, 879529); assert.equal(Object.values(state.counts.operationBytes).reduce((a, b) => a + b), 879529);
  assert.equal(state.counts.failures, 0); assert.equal(state.counts.timeouts, 0);
});

test('actual types are source literals and grant no candidate or configuration credit', () => {
  const rows = state.optionsObservation.document.report.candidates[0].definitions;
  assert.equal(rows.length, 234);
  for (const [type, count] of [['paint', 13], ['fabric', 5], ['rim', 4]]) assert.equal(rows.filter((row) => row.optionType === type).length, count);
  assert.equal(rows.find((row) => row.code === 'S0337').optionType, 'package');
  assert.equal(rows.find((row) => row.code === 'P0300').optionType, 'paint');
  assert.equal(rows.find((row) => row.code === 'FKTNL').optionType, 'fabric');
  assert.equal(rows.find((row) => row.code === 'S01H5').optionType, 'rim');
  assert.deepEqual(state.accepted, []); assert.deepEqual(state.rejected, []); assert.deepEqual(state.duplicates, []);
  assert.equal(receipt.solverRequests, 0); assert.equal(receipt.newConfigurations, 0); assert.equal(receipt.sourceCapacityCredit, 0); assert.equal(receipt.acceptance, false);
});

test('spent marker, frozen code pins and hashes-only export agree', () => {
  const marker = read(join(base, 'execution-once.json')); assert.equal(marker.id, allocation.id); assert.equal(marker.state, 'reserved-and-consumed');
  assert.equal(marker.planDigest, inputDigest(plan)); assert.equal(marker.planDigest, allocation.planDigest);
  for (const [path, expected] of Object.entries(allocation.codePins)) assert.equal(sha(join(root, path)), expected, path);
  const exported = read(join(base, 'checkpoint-export.json')); assert.equal(exported.status, 'exported'); assert.equal(exported.checkpointSha256, receipt.checkpointSha256);
  assert.equal(exported.accepted, 0); assert.equal(exported.sourceCaptures, 0);
});

test('bootstrap profiles, raw bodies and owned writer metadata are absent', () => {
  const raw = readFileSync(join(base, 'collector-checkpoint.json'), 'utf8'); assert.doesNotMatch(raw, /x-api-key|settingsVehicleTree|settingsLocalisation/);
  assert.equal(receipt.rawBodiesRetained, false); assert.equal(receipt.settingsRetained, false);
  assert.equal(readdirSync(base).some((name) => name.startsWith('collector-checkpoint.json.writer-') || name.startsWith('collector-checkpoint.json.writing-')), false);
  assert.equal(existsSync(allocation.scratchRoot), false); assert.equal(existsSync(join(root, 'server/node_modules')), true); // this verifier's owned dependency link
});
