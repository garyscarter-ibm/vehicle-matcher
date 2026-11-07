/** Actual retained bytes and pure strict binders only. No HTTP port, grant or replay. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';
import { createConfigurationKey } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { qualifyBmwSelectionRecord, createBmwSelectionRegistration } from '../../../../../scripts/gcsp/bmw-selection-binding.mjs';
import { bmwBatchPlanRequestUrls } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = path => JSON.parse(readFileSync(path, 'utf8')); const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const a = read(join(base, 'execution-plan.json')); const series = read(join(base, 'series-receipt.json'));
const contexts = a.contextIds.map(id => ({ id, plan: read(join(base, id, 'collection-plan.json')),
  envelope: read(join(base, id, 'collector-checkpoint.json')), receipt: read(join(base, id, 'receipt.json')) }));
const prior = read(a.indexPins.canonical.path); const spent = read(a.indexPins.spent.path);

test('every frozen pin and actual primary/exported safe artifact agrees', () => {
  for (const [path, expected] of Object.entries({ ...a.codePins, ...a.sourcePins })) assert.equal(sha(join(root, path)), expected, path);
  for (const pin of Object.values(a.indexPins)) assert.equal(sha(pin.path), pin.sha256);
  for (const { id, envelope, receipt } of contexts) {
    const s = envelope.content; assert.equal(inputDigest(s), envelope.contentDigest);
    assert.equal(sha(join(base, id, 'collector-checkpoint.json')), receipt.checkpointSha256);
    assert.equal(sha(join(base, id, 'collector-state.json')), receipt.checkpointSha256);
    for (const [name, artifact] of Object.entries(s.batchEvidence)) assert.equal(sha(join(base, id, `${name}.json`)), artifact.sha256);
    for (const capture of s.sourceCaptures) assert.equal(sha(join(base, id, 'solver', `${capture.candidateId}.json`)), capture.solver.sha256);
  }
});
test('all four actual admissions pass the strict source binder and registered catalogue construction', async () => {
  for (const { plan, envelope } of contexts) {
    const s = envelope.content; const configurationKey = await createConfigurationKey({ policyService: new PolicyService({ provider: new FilePolicyProvider() }), policyRead: { runId: 'model-breadth-retained-check', ...plan.policyRead } });
    assert.equal(s.accepted.length, 1); assert.equal(s.records.length, 1); assert.equal(s.sourceCaptures.length, 1);
    assert.deepEqual(s.rejected, []); assert.deepEqual(s.duplicates, []);
    const artifact = row => ({ bytes: JSON.stringify(row.document) + '\n', artifactSha256: row.sha256, retrievedAt: row.retrievedAt || row.document.observation.observedAt });
    const registration = { plan, configurationKey, producerPins: a.producerPins, snapshotVersion: a.snapshotVersion,
      artifacts: { tree: artifact(s.batchEvidence.tree), solver: artifact(s.sourceCaptures[0].solver) }, definitionBinding: { options: artifact(s.batchEvidence.options) } };
    assert.equal(qualifyBmwSelectionRecord(s.records[0], registration).status, 'qualified'); assert.ok(createBmwSelectionRegistration(registration));
    assert.equal(inputDigest(s.accepted[0]), inputDigest({ ...s.records[0], admission: true }));
    assert.equal(s.accepted[0].canonicalIdentity.vgModelCode, plan.modelRegistration.modelCode);
    assert.equal(s.accepted[0].canonicalIdentity.agModelCode, plan.modelRegistration.agModelCode);
    assert.equal(s.accepted[0].catalogue.sourceBinding.optionalFacts.trim.state, 'unknown');
  }
});
test('all20actual GETs and four exact solver queries account for source bytes and HTTP200 statuses', () => {
  let attempts = 0; let bytes = 0;
  for (const { id, plan, envelope, receipt } of contexts) {
    const events = readFileSync(join(base, id, 'source-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const starts = events.filter(e => e.phase === 'started'); const headers = events.filter(e => e.phase === 'headers-received');
    assert.equal(starts.length, 5); assert.equal(headers.length, 5); assert.equal(events.length, 10);
    assert.ok(headers.every(e => e.status === 200)); assert.ok(starts.every(e => e.method === 'GET'));
    const urls = bmwBatchPlanRequestUrls(plan, plan.candidates[0].request); assert.equal(starts[4].url, urls.solve); assert.equal(starts[3].url, urls.options);
    const solve = new URL(starts[4].url); assert.equal(solve.searchParams.getAll('mandatory-elements').length, 1);
    assert.equal(solve.searchParams.get('mandatory-elements'), plan.lineRegistration.optionsQuery.code || '');
    assert.equal(solve.searchParams.get('add-rules-for-mandatory-element-classes'), 'fabric,paint,rim');
    assert.equal(receipt.status, 'complete'); assert.equal(receipt.reason, 'queue-exhausted'); assert.equal(receipt.actualAttempts, 5);
    assert.deepEqual(receipt.counts, envelope.content.counts); assert.deepEqual(receipt.counts.operations, { page: 1, settings: 1, discover: 1, options: 1, solve: 1 });
    assert.equal(Object.values(receipt.counts.operationBytes).reduce((x, y) => x + y), receipt.counts.decodedBytes);
    attempts += receipt.actualAttempts; bytes += receipt.counts.decodedBytes;
  }
  assert.equal(attempts, 20); assert.equal(bytes, 3534788); assert.ok(bytes <= a.decodedByteCeiling);
  assert.equal(series.publicGetAttempts, 20); assert.equal(series.newConfigurations, 4); assert.equal(series.acceptance, false);
});
test('canonical and spent indexes extend exact pinned inputs without conflating admission and acceptance', () => {
  const final = read(join(base, 'final-canonical-index.json')); const finalSpent = read(join(base, 'final-spent-request-index.json'));
  assert.equal(final.entries.length, 876); assert.equal(new Set(final.entries.map(r => r.configurationId)).size, 876);
  assert.equal(final.entries.filter(r => r.origins.some(o => o.kind === 'admitted-source')).length, 873);
  assert.deepEqual(final.entries.slice(0, prior.entries.length), prior.entries); assert.deepEqual(finalSpent.entries.slice(0, spent.entries.length), spent.entries);
  assert.equal(finalSpent.entries.length, 1586); assert.equal(new Set(finalSpent.entries.map(r => r.requestDigest)).size, 1586);
  const requests = contexts.map(({ plan }) => inputDigest({ modelRegistration: plan.modelRegistration, request: plan.candidates[0].request }));
  assert.deepEqual(finalSpent.entries.slice(spent.entries.length).map(r => r.requestDigest), requests);
  for (const { envelope } of contexts) assert.equal(prior.entries.some(r => r.configurationId === envelope.content.accepted[0].configurationId), false);
});
test('actual exported rows/outcomes and spent markers retain source privacy', () => {
  for (const { id, plan, envelope, receipt } of contexts) {
    const s = envelope.content; const accepted = readFileSync(join(base, id, 'accepted.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(accepted, s.accepted); const outcome = JSON.parse(readFileSync(join(base, id, 'outcomes.jsonl'), 'utf8'));
    assert.equal(outcome.candidateId, plan.candidates[0].candidateId); assert.equal(outcome.configurationId, accepted[0].configurationId); assert.equal(outcome.constructible, true);
    assert.equal(read(join(base, id, 'execution-once.json')).allocationId, a.id);
    assert.equal(read(join(base, id, 'checkpoint-export.json')).checkpointSha256, receipt.checkpointSha256);
    assert.doesNotMatch(readFileSync(join(base, id, 'collector-checkpoint.json'), 'utf8'), /x-api-key|settingsVehicleTree|settingsRuleSolver|settingsLocalisation/);
    assert.equal(readdirSync(join(base, id)).some(name => /collector-checkpoint\.json\.(writer-|writing-)/.test(name)), false);
    assert.equal(receipt.rawBodiesRetained, false); assert.equal(receipt.settingsRetained, false); assert.equal(receipt.acceptance, false);
  }
  assert.equal(read(join(base, 'execution-once.json')).state, 'reserved-and-consumed');
});
test('all owned source process groups, scratch and reservations were cleaned and dependency link is absent', () => {
  const live = read(join(homedir(), '.cache/agent-scaffolding/test-resources/reservations.json'));
  for (const row of series.contexts) {
    assert.equal(row.cleanup.groupsAbsent, true); assert.equal(row.cleanup.reservationAbsent, true); assert.equal(existsSync(row.cleanup.scratchRoot), false);
    const manifest = read(row.cleanup.manifest); assert.equal(manifest.state, 'removed'); assert.equal(Object.hasOwn(live, manifest.token), false);
    assert.equal(row.cleanup.compatibilityException, null); assert.deepEqual(row.writerMetadata, []);
  }
  assert.equal(series.dependencyLinkRemoved, true); assert.equal(read(join(base, 'live-results.json')).resources.dependencyLinkAbsent, true); // This bounded test has its own separately owned temporary dependency link.
});
