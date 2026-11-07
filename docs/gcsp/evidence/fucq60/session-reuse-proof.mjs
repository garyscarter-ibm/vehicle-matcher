// Explicit offline integration proof. No producer implementation is bundled or substituted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { PolicyService } from '../../../../server/gcsp/policy/index.js';
import { createBmwCatalogueAdapter } from '../../../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { createBmwImageAdapter } from '../../../../server/vehicle-evidence/bmw-image-adapter.js';
import { enrichFleet } from '../../../../scripts/gcsp/enrich-fleet.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  assert.ok(['--producer', '--producer-sha256', '--session-sha256'].includes(process.argv[index])
    && process.argv[index + 1] && !args.has(process.argv[index]), 'Supply producer path and both pinned SHA-256 values explicitly.');
  args.set(process.argv[index], process.argv[index + 1]);
}
const producerPath = args.get('--producer');
assert.ok(args.size === 3 && isAbsolute(producerPath || ''), 'Select an absolute real F59 --producer; this proof never silently skips.');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identities = {};
for (const [name, path, expected] of [
  ['producer', producerPath, args.get('--producer-sha256')],
  ['session', join(dirname(producerPath), 'collection-session.mjs'), args.get('--session-sha256')],
]) {
  identities[name] = { path, sha256: sha(await readFile(path)) };
  assert.match(expected, /^[a-f0-9]{64}$/, 'Supply an exact pinned module hash.');
  assert.equal(identities[name].sha256, expected, `${name} differs from the selected producer pin`);
}
identities.consumer = { path: new URL('../../../../scripts/gcsp/enrich-fleet.mjs', import.meta.url).pathname,
  sha256: sha(await readFile(new URL('../../../../scripts/gcsp/enrich-fleet.mjs', import.meta.url))) };
const producerRoot = resolve(dirname(producerPath), '../..');
identities.boundaries = {};
for (const path of ['scripts/gcsp/configuration-key.mjs', 'server/gcsp/repository/core.js',
  'server/gcsp/repository/schema.js', 'server/vehicle-evidence/bmw-catalogue-adapter.js']) {
  identities.boundaries[join(producerRoot, path)] = sha(await readFile(join(producerRoot, path)));
}
console.log(JSON.stringify({ proof: 'FUCQ-60 actual offline F59 reuse', identities }));
const { createFleetCollector } = await import(pathToFileURL(producerPath).href);
const snapshot = JSON.parse(await readFile(new URL('../../../../server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url)));
const context = { catalogueDate: snapshot.observedDate, market: snapshot.market, locale: snapshot.locale,
  orderDate: snapshot.model.orderDate, effectDate: snapshot.model.effectDate,
  productionDate: '2027-01-05', taxDate: snapshot.model.taxDate };
const model = { modelCode: snapshot.model.modelCode, agModelCode: snapshot.model.agModelCode,
  modelRange: snapshot.model.modelRange, rawModelRange: snapshot.model.rawModelRange, trim: snapshot.trim };
const type = (code) => code.startsWith('SE') ? 'accessory' : code.startsWith('P') ? 'paint'
  : code.startsWith('F') ? 'upholstery' : 'option';
const elements = [...snapshot.selectedOptions, ...snapshot.selectedAccessories.map((row) => row.code)];
const policyRead = { runId: 'f60-session-proof', asOf: '2026-11-06T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' };

async function fixture(fn, { catalogueBudget = 1, catalogueFailures = 0, imageUnavailable = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'f60-session-'));
  const calls = { discover: 0, solve: 0, catalogue: 0, image: 0 }; let clock = 1000;
  const catalogue = createBmwCatalogueAdapter(); const image = createBmwImageAdapter({ environment: 'gcsp-demo' });
  const plan = { schemaVersion: '1', planId: 'f60-session-proof', version: '1', seed: 'one-observed-selection',
    policyRead: { asOf: policyRead.asOf, policyVersion: policyRead.policyVersion },
    source: { id: 'f60-offline-fixture', version: '1' }, context, models: [model.modelCode], target: 1, candidateCount: 1,
    limits: { maxCandidates: 1, requestBudgets: { discover: 1, solve: 1, catalogue: catalogueBudget, 'image-manifest': 1 },
      maxAttempts: 2, operationTimeoutMs: 1000, deadlineMs: 5000, retryDelayMs: 0, concurrency: 1,
      cacheEntries: 8, cacheRetentionMs: 10000, checkpointBytes: 1024 * 1024, imageRequests: 0 } };
  const settings = { plan, mode: 'offline', statePath: join(root, 'checkpoint.json'), policyService: new PolicyService(), policyRead,
    now: () => clock, source: { kind: 'offline', version: '1',
      discover: async () => { calls.discover += 1; return { schemaVersion: '1', context, models: [{ ...model,
        baseElements: elements, definitions: elements.map((code) => ({ code, type: type(code), aliases: [] })) }] }; },
      solve: async (request) => { calls.solve += 1; return { status: 'ok', selectionComplete: true,
        resolvedIdentity: { ...context, ...model, selectedOptions: request.elements.filter((code) => type(code) !== 'accessory'),
          selectedAccessories: request.selectedAccessories, selectionComplete: true },
        selectedElements: request.elements.map((code) => ({ code, type: type(code), ...(type(code) === 'accessory' ? { quantity: 1 } : {}) })) }; } },
    operations: {
      catalogue: { sourceId: 'f39-fixture', sourceVersion: '1', kind: 'offline', execute: async (request) => {
        calls.catalogue += 1; if (calls.catalogue <= catalogueFailures) throw new Error('offline catalogue failure');
        return catalogue.resolve(request);
      } },
      'image-manifest': { sourceId: 'f42-fixture', sourceVersion: '1', kind: 'offline', execute: async (request) => {
        calls.image += 1; return imageUnavailable ? { status: 'source-unavailable' } : image.resolve(request);
      } },
    } };
  const options = { catalogueOperation: 'catalogue', imageOperation: 'image-manifest', asOf: '2026-11-06',
    imageRequest: { viewpoint: 'HEROFRONT', size: { width: 2560, height: 1646 } },
    retention: { status: 'allowed', decision: 'FUCQ-58-2026-11-05' } };
  try { await fn({ root, calls, settings, options, setClock: (value) => { clock = value; } }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('real collection, F60 enrichment and reopened resume share cached responses and outcome cursor', async () => {
  await fixture(async ({ root, settings, options, calls }) => {
    const first = await createFleetCollector(settings); const collected = await first.run();
    assert.equal(collected.accepted.length, 1); let interrupted = false;
    await assert.rejects(enrichFleet({ ...options, session: first.session, accepted: collected.accepted,
      onPhase: async (phase) => { if (phase === 'enrichment-response-cached' && !interrupted) {
        interrupted = true; throw new Error('interrupted after actual catalogue cache');
      } } }), /interrupted after actual catalogue cache/);
    const saved = JSON.parse(await readFile(settings.statePath, 'utf8')).content;
    assert.equal(saved.stages.enrichment.data.cursor, 0); assert.equal(saved.counts.operations.catalogue, 1);
    const reopened = await createFleetCollector(settings); const recollected = await reopened.run();
    const output = await enrichFleet({ ...options, session: reopened.session, accepted: recollected.accepted });
    assert.deepEqual(calls, { discover: 1, solve: 1, catalogue: 1, image: 1 });
    assert.equal(output.counts.cacheHits.catalogue, 1); assert.equal(output.counts.operations.solve, 1);
    assert.equal(output.counts.sourceCalls, 0); assert.equal(output.deadlineAt, saved.deadlineAt);
    assert.equal(output.processing, 'finished'); assert.equal(output.status, 'incomplete');
    assert.equal(output.records[0].facts.seats.value, 5); assert.ok(output.records[0].image);
    assert.equal(output.records[0].configurationId, collected.accepted[0].configurationId);
    assert.equal(output.records[0].completeness.sharedAccounting, 'shared-session-offline');
    const again = await enrichFleet({ ...options, session: reopened.session, accepted: recollected.accepted });
    assert.deepEqual(again.records, output.records); assert.deepEqual(again.counts, output.counts);
    assert.deepEqual((await readdir(root)).filter((name) => name.includes('writer-') || name.includes('.writing-')), []);
  });
});

test('F60 stage changes cannot refresh the original persisted absolute deadline', async () => {
  await fixture(async ({ settings, options, calls, setClock }) => {
    const first = await createFleetCollector(settings); const collected = await first.run(); setClock(6001);
    const reopened = await createFleetCollector(settings);
    const output = await enrichFleet({ ...options, session: reopened.session, accepted: collected.accepted });
    assert.equal(output.reason, 'deadline'); assert.equal(output.pending, 1); assert.equal(output.deadlineAt, 6000);
    assert.equal(calls.catalogue, 0); assert.equal(calls.image, 0);
    const later = await enrichFleet({ ...options, stageId: 'later-enrichment', session: reopened.session, accepted: collected.accepted });
    assert.equal(later.reason, 'deadline'); assert.equal(later.deadlineAt, 6000);
  });
});

test('lifetime operation and retry accounting survives F60 interruption and cannot be reset by a new stage', async () => {
  await fixture(async ({ settings, options, calls }) => {
    let interrupted = false;
    settings.onPhase = async (phase, detail) => { if (phase === 'before-rename' && detail.kind === 'source-failure' && !interrupted) {
      interrupted = true; throw new Error('interrupted after durable request count');
    } };
    const first = await createFleetCollector(settings); const collected = await first.run();
    await assert.rejects(enrichFleet({ ...options, session: first.session, accepted: collected.accepted }), /durable request count/);
    settings.onPhase = async () => {};
    const reopened = await createFleetCollector(settings);
    const output = await enrichFleet({ ...options, session: reopened.session, accepted: collected.accepted });
    assert.equal(output.reason, 'request-budget'); assert.equal(output.counts.operations.catalogue, 1);
    assert.equal(calls.catalogue, 1); assert.equal(calls.image, 0);
    const later = await enrichFleet({ ...options, stageId: 'later-enrichment', session: reopened.session, accepted: collected.accepted });
    assert.equal(later.reason, 'request-budget'); assert.equal(calls.catalogue, 1);
  }, { catalogueFailures: 1 });
  await fixture(async ({ settings, options, calls }) => {
    const first = await createFleetCollector(settings); const collected = await first.run();
    const output = await enrichFleet({ ...options, session: first.session, accepted: collected.accepted });
    assert.equal(output.reason, 'source-failure'); assert.equal(calls.catalogue, 2);
    const reopened = await createFleetCollector(settings);
    const later = await enrichFleet({ ...options, stageId: 'later-enrichment', session: reopened.session, accepted: collected.accepted });
    assert.equal(later.reason, 'source-failure'); assert.equal(calls.catalogue, 2);
  }, { catalogueBudget: 3, catalogueFailures: 3 });
});

test('accepted source records and F60 stage policy are immutable across resume', async () => {
  await fixture(async ({ settings, options, calls }) => {
    const collector = await createFleetCollector(settings); const collected = await collector.run();
    const forged = structuredClone(collected.accepted); forged[0].configurationId = 'unaccepted-id';
    await assert.rejects(enrichFleet({ ...options, session: collector.session, accepted: forged, stageId: 'forged' }), { code: 'accepted-input-mismatch' });
    assert.equal(calls.catalogue, 0);
    await enrichFleet({ ...options, session: collector.session, accepted: collected.accepted });
    for (const change of [{ asOf: '2026-11-07' }, { retention: { status: 'denied', decision: 'changed' } },
      { catalogueOperation: 'different' }, { imageRequest: { viewpoint: 'REAR', size: { width: 2560, height: 1646 } } }]) {
      await assert.rejects(enrichFleet({ ...options, ...change, session: collector.session, accepted: collected.accepted }), { code: 'stage-incompatible' });
    }
    assert.equal(calls.catalogue, 1);
  });
});

test('a stopped image operation retains valid facts as a durable explicit partial outcome', async () => {
  await fixture(async ({ settings, options, calls }) => {
    const collector = await createFleetCollector(settings); const collected = await collector.run();
    const output = await enrichFleet({ ...options, session: collector.session, accepted: collected.accepted });
    assert.equal(output.reason, 'request-budget'); assert.equal(output.records[0].status, 'partial');
    assert.equal(output.records[0].facts.seats.value, 5); assert.equal(output.records[0].image, null);
    assert.deepEqual(output.records[0].sources.image.execution, { status: 'stopped', reason: 'request-budget' });
    const reopened = await createFleetCollector(settings);
    const resumed = await enrichFleet({ ...options, session: reopened.session, accepted: collected.accepted });
    assert.deepEqual(resumed.records, output.records); assert.equal(calls.image, 1); assert.equal(calls.catalogue, 1);
  }, { imageUnavailable: true });
});

test('an interruption after committed F60 outcome never repeats accepted work', async () => {
  await fixture(async ({ settings, options, calls }) => {
    const collector = await createFleetCollector(settings); const collected = await collector.run();
    await assert.rejects(enrichFleet({ ...options, session: collector.session, accepted: collected.accepted,
      onPhase: async (phase) => { if (phase === 'enrichment-outcome-committed') throw new Error('outcome committed interruption'); } }), /outcome committed interruption/);
    const reopened = await createFleetCollector(settings);
    const output = await enrichFleet({ ...options, session: reopened.session, accepted: collected.accepted });
    assert.equal(output.records.length, 1); assert.equal(output.processing, 'finished');
    assert.deepEqual(calls, { discover: 1, solve: 1, catalogue: 1, image: 1 });
    await assert.rejects(enrichFleet({ ...options, session: reopened.session, accepted: collected.accepted,
      imageRequest: { ...options.imageRequest, modelCode: 'SUBSTITUTE' } }), { code: 'invalid-enrichment' });
  });
});
