/** Actual pinned retained observations through the existing session/enrichment boundary; zero network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollectionSession } from '../../scripts/gcsp/collection-session.mjs';
import { enrichFleet } from '../../scripts/gcsp/enrich-fleet.mjs';
import { inputDigest } from '../gcsp/repository/core.js';
const base = new URL('../../docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/', import.meta.url);
const sha = (v) => createHash('sha256').update(v).digest('hex');
async function inputs() {
  const q = await import('../../scripts/gcsp/bmw-technical-qualification.mjs');
  const plan = JSON.parse(await readFile(new URL('observation-plan.json', base)));
  const source = await readFile(new URL('../../docs/gcsp/evidence/fucq59/f70-1f7e-first32-solver-2026-11-07/accepted.jsonl', import.meta.url), 'utf8');
  const accepted = JSON.parse(source.split('\n')[0]); const bytes = await readFile(new URL('technical.json', base));
  const document = JSON.parse(bytes); const artifact = { document, sha256: sha(bytes), bytes: bytes.length };
  const options = { registration: plan.registration, pins: { retainedSha256: artifact.sha256,
    responseSha256: document.observation.responseSha256, acceptedLineSha256: sha(source.split('\n')[0] + '\n'), mappingDigest: q.BMW_OTD_MAPPING_AUTHORITY.digest } };
  return { q, accepted, artifact, options };
}
test('actual four-key OTD qualifier keeps approved mapping units distinct from absent source units and unknown 76 keys', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('no source'); });
  const f = await inputs(); const value = f.q.qualifyBmwTechnicalObservation({ artifact: f.artifact, accepted: f.accepted, ...f.options });
  assert.deepEqual(Object.values(value.facts).map((x) => x.value), [5, 300, 1135, 7.8]);
  assert.equal(value.mappingAuthority.digest, f.q.BMW_OTD_MAPPING_AUTHORITY.digest);
  assert.equal(value.unmappedKeys.length, 76); assert.ok(value.unmappedKeys.includes('A_LAENGE'));
  assert.equal(value.measurementEvidence.seats.sourceUnit, null); assert.equal(value.measurementEvidence.seats.unitAuthority, 'approved-reference-code-mapping');
  assert.equal(value.facts.seats.provenance.source, 'BMW UK OTD'); assert.equal(value.source.observedDate, '2026-11-07');
});
test('changed retained values, source hash, accepted row, selection/date or mapping digest cannot qualify', async () => {
  const f = await inputs();
  for (const mutate of [(x) => { x.artifact.document.report.values[0].targetValue = 999; },
    (x) => { x.pins.responseSha256 = '0'.repeat(64); }, (x) => { x.accepted.canonicalIdentity.agModelCode = '72HH'; },
    (x) => { x.registration.model.effectDate = '2027-01-06'; }, (x) => { x.registration.factoryOptionCodes.pop(); },
    (x) => { x.pins.mappingDigest = '0'.repeat(64); }]) {
    const x = structuredClone({ artifact: f.artifact, accepted: f.accepted, ...f.options }); mutate(x);
    assert.throws(() => f.q.qualifyBmwTechnicalObservation(x));
  }
});
test('placeholder or malformed mapped values stay unknown under a separately pinned fixture artifact', async () => {
  const f = await inputs();
  for (const value of ['0000', -1, 2.5]) {
    const artifact = structuredClone(f.artifact); artifact.document.report.values.find((x) => x.code === 'N_SITZE').targetValue = value;
    const bytes = JSON.stringify(artifact.document) + '\n'; artifact.sha256 = sha(bytes); artifact.bytes = Buffer.byteLength(bytes);
    const result = f.q.qualifyBmwTechnicalObservation({ artifact, accepted: f.accepted, ...f.options,
      pins: { ...f.options.pins, retainedSha256: artifact.sha256 } });
    assert.equal(result.facts.seats.state, 'unknown'); assert.equal(result.facts.seats.value, null);
  }
});
// FUCQ-163: technical recalculation must keep an all-unknown result unknown, not partial.
test('technical measurement completeness stays unknown, partial or complete with facts and provenance unchanged', async (t) => {
  const f = await inputs(); const { BMW_OTD_MEASUREMENT_MAPPING } = await import('../vehicle-evidence/bmw-catalogue-adapter.js');
  t.mock.method(globalThis, 'fetch', () => { throw new Error('no source'); });
  const blank = (codes) => { const artifact = structuredClone(f.artifact);
    for (const value of artifact.document.report.values) if (codes.includes(value.code)) value.targetValue = '0000';
    const bytes = JSON.stringify(artifact.document) + '\n'; artifact.sha256 = sha(bytes); artifact.bytes = Buffer.byteLength(bytes);
    return artifact; };
  const run = async (artifact, catalogue = f.accepted.catalogue) => {
    const root = await mkdtemp(join(tmpdir(), 'f60-completeness-')); t.after(() => rm(root, { recursive: true, force: true }));
    const operations = { catalogue: { kind: 'offline', sourceId: 'retained-catalogue', sourceVersion: '2', execute: async () => structuredClone(catalogue) },
      technical: { kind: 'offline', sourceId: 'retained-otd', sourceVersion: '1', execute: async () => structuredClone(artifact) } };
    const limits = { maxAttempts: 1, retryDelayMs: 0, operationTimeoutMs: 10000, deadlineMs: 90000, concurrency: 1,
      imageRequests: 0, cacheEntries: 4, cacheRetentionMs: 86400000, checkpointBytes: 1048576, requestBudgets: { catalogue: 1, technical: 1 } };
    const session = await createCollectionSession({ identity: { stage: 'completeness-test', version: '1' }, operations, limits,
      statePath: join(root, 'primary.json'), initialState: { accepted: [f.accepted] } });
    const catalogueOptions = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((k) => [k, f.accepted.lookupIdentity[k]]));
    const options = { ...f.options, pins: { ...f.options.pins, retainedSha256: artifact.sha256 } };
    const output = await enrichFleet({ session, accepted: [f.accepted], catalogueOptions, technicalOperation: 'technical', technicalOptions: options, asOf: '2026-11-07' });
    return { record: output.records[0], qualified: f.q.qualifyBmwTechnicalObservation({ artifact, accepted: f.accepted, ...options }) };
  };
  const codes = Object.values(BMW_OTD_MEASUREMENT_MAPPING).map(([code]) => code);
  const none = await run(blank(codes));
  assert.equal(none.record.completeness.measurements, 'unknown');
  for (const fact of Object.values(none.record.facts)) {
    assert.equal(fact.state, 'unknown'); assert.equal(fact.value, null); assert.deepEqual(fact.provenance, { kind: 'unknown', source: null, observedDate: null });
  }
  const seats = BMW_OTD_MEASUREMENT_MAPPING.seats[0]; const mixed = await run(blank([seats]));
  assert.equal(mixed.record.completeness.measurements, 'partial');
  assert.equal(mixed.record.facts.seats.state, 'unknown'); assert.equal(mixed.record.facts.seats.value, null);
  for (const name of ['luggageNormal', 'luggageExpanded', 'acceleration']) assert.deepEqual(mixed.record.facts[name], mixed.qualified.facts[name]);
  const catalogue = structuredClone(f.accepted.catalogue);
  catalogue.facts.bodyLength = { state: 'known', value: 4600, definition: 'BODY LENGTH', unit: 'MILLIMETRES', reason: null,
    completeness: 'complete', provenance: { kind: 'observed', source: 'BMW UK catalogue', observedDate: '2026-11-07' } };
  const all = await run(f.artifact, catalogue);
  assert.equal(all.record.completeness.measurements, 'complete');
  for (const name of ['seats', 'luggageNormal', 'luggageExpanded', 'acceleration']) assert.deepEqual(all.record.facts[name], all.qualified.facts[name]);
  assert.equal(all.record.facts.bodyLength.value, 4600); assert.equal(all.record.facts.bodyLength.provenance.source, 'BMW UK catalogue');
});
test('existing enrichFleet records four known values with shared accounting, keeps catalogue immutable and resumes without execution', async (t) => {
  const f = await inputs(); const original = inputDigest(f.accepted);
  const root = await mkdtemp(join(tmpdir(), 'f60-qualified-')); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0; let sourceCalls = 0; t.mock.method(globalThis, 'fetch', () => { sourceCalls += 1; throw new Error('no source'); });
  const operations = { catalogue: { kind: 'offline', sourceId: 'retained-catalogue', sourceVersion: '2', execute: async () => { calls += 1; return f.accepted.catalogue; } },
    technical: { kind: 'offline', sourceId: 'retained-otd', sourceVersion: '1', execute: async () => { calls += 1; return f.artifact; } } };
  const limits = { maxAttempts: 1, retryDelayMs: 0, operationTimeoutMs: 10000, deadlineMs: 90000, concurrency: 1,
    imageRequests: 0, cacheEntries: 4, cacheRetentionMs: 86400000, checkpointBytes: 1048576, requestBudgets: { catalogue: 1, technical: 1 } };
  const session = await createCollectionSession({ identity: { stage: 'qualified-otd-test', version: '1' }, operations, limits,
    statePath: join(root, 'primary.json'), initialState: { accepted: [f.accepted] } });
  const catalogueOptions = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((k) => [k, f.accepted.lookupIdentity[k]]));
  const input = { session, accepted: [f.accepted], catalogueOptions, technicalOperation: 'technical', technicalOptions: f.options, asOf: '2026-11-07' };
  const output = await enrichFleet(input); const record = output.records[0];
  assert.equal(record.facts.seats.value, 5); assert.equal(record.facts.bodyLength.state, 'unknown');
  assert.equal(record.facts.acceleration.value, 7.8); assert.equal(record.sources.technical.responseSha256, f.options.pins.responseSha256);
  assert.equal(record.sources.technical.mappingAuthority.digest, f.q.BMW_OTD_MAPPING_AUTHORITY.digest);
  assert.equal(record.measurementEvidence.luggageNormal.sourceUnit, null); assert.equal(output.counts.operations.technical, 1);
  assert.equal(output.counts.sourceCalls, 0); assert.equal(sourceCalls, 0); assert.equal(inputDigest(f.accepted), original);
  assert.deepEqual(await enrichFleet(input), output); assert.equal(calls, 2);
  await assert.rejects(enrichFleet({ ...input, technicalOptions: { ...f.options, pins: { ...f.options.pins, mappingDigest: '0'.repeat(64) } } }), { code: 'stage-incompatible' });
});
async function session(t, row, artifact) {
  const root = await mkdtemp(join(tmpdir(), 'f60-substitution-')); t.after(() => rm(root, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', () => { throw new Error('no source'); });
  const operations = { catalogue: { kind: 'offline', sourceId: 'retained-catalogue', sourceVersion: '2', execute: async () => row.catalogue },
    technical: { kind: 'offline', sourceId: 'retained-otd', sourceVersion: '1', execute: async () => artifact } };
  const limits = { maxAttempts: 1, retryDelayMs: 0, operationTimeoutMs: 10000, deadlineMs: 90000, concurrency: 1,
    imageRequests: 0, cacheEntries: 4, cacheRetentionMs: 86400000, checkpointBytes: 1048576, requestBudgets: { catalogue: 1, technical: 1 } };
  return createCollectionSession({ identity: { stage: 'substitution-test', version: '1' }, operations, limits,
    statePath: join(root, 'primary.json'), initialState: { accepted: [row] } });
}
const v2Options = (row) => Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((k) => [k, row.lookupIdentity[k]]));
test('technical options cannot substitute the session-owned accepted row', async (t) => {
  const f = await inputs(); const source = await readFile(new URL('../../docs/gcsp/evidence/fucq59/f70-1f7e-first32-solver-2026-11-07/accepted.jsonl', import.meta.url), 'utf8');
  const rowA = JSON.parse(source.split('\n')[1]); assert.notEqual(rowA.configurationId, f.accepted.configurationId);
  const technicalOptions = { ...f.options, accepted: f.accepted };
  await assert.rejects(enrichFleet({ session: await session(t, rowA, f.artifact), accepted: [rowA], catalogueOptions: v2Options(rowA),
    technicalOperation: 'technical', technicalOptions, asOf: '2026-11-07' }), { code: 'technical-options-substitution' });
});
test('technical options cannot substitute the session-owned operation artifact', async (t) => {
  const f = await inputs(); const other = structuredClone(f.artifact); other.document.report.values[0].targetValue = 999;
  const technicalOptions = { ...f.options, artifact: f.artifact };
  await assert.rejects(enrichFleet({ session: await session(t, f.accepted, other), accepted: [f.accepted], catalogueOptions: v2Options(f.accepted),
    technicalOperation: 'technical', technicalOptions, asOf: '2026-11-07' }), { code: 'technical-options-substitution' });
});
