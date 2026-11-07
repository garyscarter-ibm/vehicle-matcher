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
import { bmwPublicRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';

const code = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const series = JSON.parse(readFileSync(join(code, 'series-plan.json')));
const number = Number(process.env.F70_TYPED_AXIS_CHECK_CHUNK);
assert.ok(Number.isInteger(number) && number >= 1 && number <= series.chunks.length);
const base = series.chunks[number - 1].outputDirectory;
const read = (path) => JSON.parse(readFileSync(path, 'utf8')); const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const allocation = read(join(base, 'execution-plan.json')); const plan = read(join(base, 'collection-plan.json'));
const envelope = read(join(base, 'collector-checkpoint.json')); const state = envelope.content; const receipt = read(join(base, 'receipt.json'));
const prior = read(join(base, 'prior-canonical-index.json')); const spent = read(join(base, 'spent-request-index.json'));

test('source events, exact candidate URLs and counters account for the declared successful GETs', () => {
  const { events } = actualEventHistory(base, allocation, state);
  const starts = events.filter((row) => row.phase === 'started'); const headers = events.filter((row) => row.phase === 'headers-received');
  assert.equal(events.length, allocation.attempts * 2); assert.equal(starts.length, allocation.attempts); assert.equal(headers.length, allocation.attempts);
  assert.equal(headers.every((row) => row.status === 200), true); assert.equal(starts.every((row) => row.method === 'GET'), true);
  assert.deepEqual(starts.filter((row) => /rulesolver/.test(row.url)).map((row) => row.url), plan.candidates.map((row) => bmwPublicRequestUrls(plan.modelRegistration, row.request).solve));
  assert.equal(receipt.reason, 'queue-exhausted'); assert.equal(state.cursor, plan.candidateCount); assert.equal(receipt.actualAttempts, allocation.attempts);
  assert.deepEqual(receipt.counts, state.counts); assert.ok(state.counts.decodedBytes > 0 && state.counts.decodedBytes <= allocation.decodedBytes); assert.equal(state.counts.operations.solve, plan.candidateCount);
  assert.equal(Object.values(state.counts.operationBytes).reduce((a, b) => a + b), state.counts.decodedBytes); assert.equal(state.counts.failures, 0);
});
