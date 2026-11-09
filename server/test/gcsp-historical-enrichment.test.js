import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PolicyService } from '../gcsp/policy/index.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/vehicle-lookup.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const producerRoot = process.env.F60_PRODUCER_ROOT || repository;
assert.ok(isAbsolute(producerRoot), 'Select an absolute actual producer root.');
// Re-pinned 9 Nov (FUCQ-245) to the FUCQ-156 revision (3507792d); historical output proven byte-identical.
const producerIdentity = {
  'scripts/gcsp/collection-session.mjs': '75298b96656df70056f656b4db1210d04e0d96e5d973cfd493c75883c62dc5f9',
  'scripts/gcsp/configuration-key.mjs': '2527393ebb3c0221595200283293ec88c584a1a7178ed1060e2313c0e1998b60',
};
for (const [path, expected] of Object.entries(producerIdentity)) {
  const bytes = await readFile(join(producerRoot, path));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Frozen producer changed: ${path}`);
}
const { createCollectionSession } = await import(pathToFileURL(join(producerRoot, 'scripts/gcsp/collection-session.mjs')));
const { createConfigurationKey } = await import(pathToFileURL(join(producerRoot, 'scripts/gcsp/configuration-key.mjs')));
const policyRead = { runId: 'f60-historical-proof', asOf: '2026-11-06T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' };
const directory = join(repository, 'server/data/gcsp/vehicle-evidence/lookup-reference.v1/versions/c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709');
const snapshotPath = join(repository, 'server/vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json');
const limits = { requestBudgets: { catalogue: 1 }, maxAttempts: 1, operationTimeoutMs: 1000,
  deadlineMs: 10000, retryDelayMs: 0, concurrency: 1, cacheEntries: 4, cacheRetentionMs: 10000,
  checkpointBytes: 1024 * 1024, imageRequests: 0 };

async function fixture(fn, onPhase = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'f60-historical-'));
  try {
    const api = await import('../../scripts/gcsp/historical-enrichment.mjs');
    const input = await api.readRetainedHistoricalInput({ directory, snapshotPath });
    const options = { input, createCollectionSession, createConfigurationKey, producerIdentity,
      policyService: new PolicyService(), policyRead, statePath: join(root, 'checkpoint.json'),
      limits, asOf: '2026-11-06', now: () => 1000, onPhase };
    await fn({ api, root, input, options, open: (changes = {}) => api.createHistoricalEnrichmentRun({ ...options, ...changes }) });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('historical source uses the actual common session through F54 publication and read-only lookup', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls += 1; throw Error('No outbound transport authorised'); });
  await fixture(async ({ root, input, open }) => {
    const run = await open(); const result = await run.run();
    assert.equal(result.ingress.receipt.kind, 'retained-historical-source');
    assert.equal(result.ingress.receipt.observedDate, '2026-11-01');
    assert.equal(result.ingress.accepted[0].sourceKind, 'dated-snapshot');
    assert.equal(result.enrichment.qualification, 'offline-session-not-source-qualified');
    assert.equal(result.enrichment.status, 'incomplete');
    assert.equal(result.enrichment.records[0].facts.bodyLength.value, null);
    assert.equal(result.enrichment.counts.operations.catalogue, 1);
    assert.equal(result.enrichment.counts.cacheHits.catalogue, 1);
    assert.equal(result.enrichment.counts.sourceCalls, 0);
    const candidate = await run.writeCandidate({ directory: join(root, 'candidate'), result });
    const checked = await validateCorpusDirectory(candidate.directory, { policyService: new PolicyService(), policyRead });
    assert.equal(checked.status, 'ok', JSON.stringify(checked.failure));
    assert.deepEqual(checked.corpus.configurations, [input.row]);
    assert.equal(checked.manifest.counts.configurations, 1);
    assert.equal(checked.manifest.counts.vinMappings, 0);
    assert.equal(checked.manifest.counts.images, 0);
    assert.equal(checked.manifest.sourceContexts.length, 1);
    const sidecars = JSON.parse(await readFile(candidate.sidecarsPath, 'utf8'));
    assert.equal(sidecars.manifestDigest, checked.manifestDigest);
    assert.deepEqual(sidecars.ingress, result.ingress.receipt);
    assert.deepEqual(sidecars.enrichment, result.enrichment);
    const registry = createSyntheticRegistry({ root: join(root, 'store'), policyService: new PolicyService(), policyRead });
    assert.equal((await registry.publish(candidate.directory)).status, 'ok');
    const lookup = createVehicleEvidenceLookup({ registry });
    const view = await lookup.resolve({ kind: 'configuration', id: input.row.configurationId,
      expected: { market: 'GB', snapshotVersion: input.row.snapshotVersion } });
    // F54 complete means its supported catalogue subset; physical/field completeness remains explicit.
    assert.equal(view.status, 'complete');
    assert.equal(view.source.observedDate, '2026-11-01');
    assert.equal(view.source.productionDate, null);
    assert.equal(view.source.catalogueValidity.productionDate, '2027-01-05');
    assert.equal(view.source.steering, null);
    assert.equal(view.technical.bodyLength.value, null);
    assert.equal(view.technical.seats.value, 5);
    assert.equal(view.technical.acceleration.unit, 'SECONDS');
    assert.equal(view.equipment.selected.options.length, 47);
    assert.deepEqual(view.equipment.selected.accessories, [{ code: 'SE000001', type: 'accessory', quantity: 1 }]);
    assert.equal(view.equipment.verifiedFitted.state, 'unknown');
    assert.equal(view.images.state, 'unknown');
    assert.equal(view.identity.vin, null);
    assert.equal(view.identity.orderUuid, null);
    assert.equal(Object.hasOwn(view, 'eligibility'), false);
    const resumed = await (await open()).run();
    assert.deepEqual(resumed.ingress, result.ingress);
    assert.deepEqual(resumed.enrichment.records, result.enrichment.records);
    assert.equal(resumed.enrichment.counts.operations.catalogue, 1);
    assert.deepEqual(await (await open()).writeCandidate({ directory: candidate.directory, result }), candidate);
    assert.deepEqual((await readdir(root)).sort(), ['candidate', 'candidate.f60.json', 'checkpoint.json', 'store']);
  });
  assert.equal(calls, 0);
});

test('changed source pins and mutable caller inputs cannot become admitted historical evidence', async () => {
  await fixture(async ({ api, input, options, open }) => {
    await assert.rejects(api.readRetainedHistoricalInput({ directory, snapshotPath,
      pins: { ...input.pins, snapshot: '0'.repeat(64) } }), { code: 'historical-pin-mismatch' });
    assert.throws(() => { input.catalogueRequest.taxDate = '2026-11-06'; }, TypeError);
    const forged = structuredClone(input); forged.catalogueRequest.selectedAccessories[0].quantity = 2;
    await assert.rejects(open({ input: forged }), { code: 'historical-input-required' });
    const mutablePins = structuredClone(producerIdentity);
    const opening = open({ producerIdentity: mutablePins });
    mutablePins['scripts/gcsp/collection-session.mjs'] = '0'.repeat(64);
    await (await opening).run();
    const checkpoint = JSON.parse(await readFile(options.statePath, 'utf8'));
    assert.deepEqual(checkpoint.content.identity.stage.producerIdentity, producerIdentity);
  });
});

test('a producer identity other than the reviewed pins is refused before any session opens', async () => {
  await fixture(async ({ open, options }) => {
    const previous = { ...producerIdentity,
      'scripts/gcsp/collection-session.mjs': 'bf86e5b92b35aae44d093f50c4085ed3628faac0592182092a5124cb04210790' };
    for (const identity of [previous, { ...producerIdentity, 'scripts/gcsp/configuration-key.mjs': '0'.repeat(64) },
      { 'scripts/gcsp/collection-session.mjs': producerIdentity['scripts/gcsp/collection-session.mjs'] }, undefined]) {
      await assert.rejects(open({ producerIdentity: identity }), { code: 'historical-producer-required' });
    }
    await assert.rejects(readFile(options.statePath), { code: 'ENOENT' });
  });
});

test('historical input snapshots caller pins before asynchronous reads', async () => {
  await fixture(async ({ api, root, input, open }) => {
    const alternate = join(root, 'alternate');
    await mkdir(alternate);
    const manifest = structuredClone(input.manifest);
    manifest.generatorVersion = 'caller-substituted-generator';
    const manifestBytes = JSON.stringify(manifest);
    await writeFile(join(alternate, 'manifest.json'), manifestBytes);
    await writeFile(join(alternate, 'configurations.jsonl'), await readFile(join(directory, 'configurations.jsonl')));
    const mutablePins = structuredClone(api.HISTORICAL_PINS);
    const alteredRead = api.readRetainedHistoricalInput({ directory: alternate, snapshotPath, pins: mutablePins });
    mutablePins.manifest = createHash('sha256').update(manifestBytes).digest('hex');
    await assert.rejects(alteredRead, { code: 'historical-pin-mismatch' });

    const retainedPins = structuredClone(api.HISTORICAL_PINS);
    const retainedRead = api.readRetainedHistoricalInput({ directory, snapshotPath, pins: retainedPins });
    for (const name of Object.keys(retainedPins)) retainedPins[name] = '0'.repeat(64);
    const retainedInput = await retainedRead;
    const expectedPins = {
      manifest: 'c1f8040107f03fa1c25e88d23065bdef3f92a55ca086cd1894655a6c0b0b1709',
      configurations: '9c1fb6a34e324e6e4937baa1e80eabafa44fae394dd138f2f77be9f6867e9855',
      snapshot: 'ee1ae6c5cb6ab742f9a2959825ca722007409fa019d15acd44bb4b79984556a3',
    };
    assert.deepEqual(retainedInput.pins, expectedPins);
    const result = await (await open({ input: retainedInput })).run();
    assert.deepEqual(result.ingress.receipt.pins, expectedPins);
    assert.equal(result.ingress.receipt.observedDate, '2026-11-01');
  });
});

test('cache commit before admission keeps accepted empty and reopens without another source operation', async () => {
  let interrupted = false;
  await fixture(async ({ root, options, open }) => {
    await assert.rejects((await open()).run(), /interrupt before admission/);
    const checkpoint = JSON.parse(await readFile(options.statePath, 'utf8')).content;
    assert.deepEqual(checkpoint.accepted, []);
    assert.equal(checkpoint.historicalReceipt, null);
    assert.equal(checkpoint.counts.operations.catalogue, 1);
    assert.equal(checkpoint.cache.length, 1);
    const result = await (await open({ onPhase: async () => {} })).run();
    assert.equal(result.ingress.accepted.length, 1);
    assert.equal(result.enrichment.counts.operations.catalogue, 1);
    assert.equal(result.enrichment.counts.cacheHits.catalogue, 2);
    assert.deepEqual((await readdir(root)).sort(), ['checkpoint.json']);
  }, async (phase) => { if (phase === 'historical-response-cached' && !interrupted) { interrupted = true; throw Error('interrupt before admission'); } });
});

test('committed admission reopens once and cannot admit changed dates, quantities or a missing receipt', async () => {
  for (const change of [
    (s) => { s.accepted[0].catalogueRequest.taxDate = '2026-11-06'; },
    (s) => { s.accepted[0].catalogueRequest.selectedAccessories[0].quantity = 2; },
    (s) => { s.historicalReceipt = null; },
  ]) {
    let interrupted = false;
    await fixture(async ({ options, open }) => {
      await assert.rejects((await open()).run(), /interrupt after admission/);
      const before = JSON.parse(await readFile(options.statePath, 'utf8'));
      assert.equal(before.content.accepted.length, 1);
      assert.ok(before.content.historicalReceipt);
      const result = await (await open({ onPhase: async () => {} })).run();
      assert.equal(result.ingress.accepted.length, 1);
      assert.equal(result.enrichment.counts.operations.catalogue, 1);
      change(before.content); before.contentDigest = inputDigest(before.content);
      await writeFile(options.statePath, JSON.stringify(before));
      await assert.rejects((await open({ onPhase: async () => {} })).run(), { code: 'historical-state-mismatch' });
    }, async (phase) => { if (phase === 'historical-admitted' && !interrupted) { interrupted = true; throw Error('interrupt after admission'); } });
  }
});

test('corpus packaging rejects altered reports and immutable sidecar conflicts', async () => {
  await fixture(async ({ root, open }) => {
    const run = await open(); const result = await run.run();
    const changed = structuredClone(result); changed.enrichment.records[0].facts.seats.value = 99;
    await assert.rejects(run.writeCandidate({ directory: join(root, 'bad'), result: changed }), { code: 'historical-result-mismatch' });
    const candidate = await run.writeCandidate({ directory: join(root, 'candidate'), result });
    await writeFile(candidate.sidecarsPath, '{}\n');
    await assert.rejects(run.writeCandidate({ directory: candidate.directory, result }), { code: 'historical-sidecar-conflict' });
  });
});

test('actual F54 interrupted selection reopens the same immutable historical candidate', async () => {
  await fixture(async ({ root, input, open }) => {
    const run = await open(); const result = await run.run();
    const candidate = await run.writeCandidate({ directory: join(root, 'candidate'), result });
    const settings = { root: join(root, 'store'), policyService: new PolicyService(), policyRead };
    const interrupted = createSyntheticRegistry({ ...settings, onPhase: async (phase) => { if (phase === 'before-select') throw Error('publication interrupted'); } });
    assert.notEqual((await interrupted.publish(candidate.directory)).status, 'ok');
    const reopened = createSyntheticRegistry(settings);
    assert.equal((await reopened.publish(candidate.directory)).status, 'ok');
    assert.equal((await reopened.publish(candidate.directory)).idempotent, true);
    const view = await createVehicleEvidenceLookup({ registry: reopened }).resolve({ kind: 'configuration', id: input.row.configurationId });
    assert.equal(view.source.observedDate, '2026-11-01');
    assert.equal(view.technical.bodyLength.value, null);
    assert.equal(view.identity.vin, null);
  });
});

test('interrupted sidecar staging leaves no final partial file and resumes the same candidate', async () => {
  let interrupted = false;
  await fixture(async ({ root, open }) => {
    const run = await open(); const result = await run.run();
    const directory = join(root, 'candidate');
    await assert.rejects(run.writeCandidate({ directory, result }), /interrupt staged sidecar/);
    assert.deepEqual((await readdir(root)).sort(), ['candidate', 'checkpoint.json']);
    const candidate = await (await open({ onPhase: async () => {} })).writeCandidate({ directory, result });
    assert.equal(JSON.parse(await readFile(candidate.sidecarsPath, 'utf8')).manifestDigest, candidate.manifestDigest);
  }, async (phase) => { if (phase === 'historical-sidecar-staged' && !interrupted) { interrupted = true; throw Error('interrupt staged sidecar'); } });
});

test('an admitted session cannot revert to unqualified state or replace the enrichment-stage records', async () => {
  for (const kind of ['reverted-admission', 'changed-report']) {
    await fixture(async ({ root, options, open }) => {
      const run = await open(); const result = await run.run();
      const checkpoint = JSON.parse(await readFile(options.statePath, 'utf8'));
      if (kind === 'reverted-admission') {
        checkpoint.content.accepted = []; checkpoint.content.historicalReceipt = null; checkpoint.content.historicalCatalogue = null;
      } else {
        checkpoint.content.stages['historical-result'].data.result.records[0].facts.seats.value = 99;
        result.enrichment.records[0].facts.seats.value = 99;
      }
      checkpoint.contentDigest = inputDigest(checkpoint.content);
      await writeFile(options.statePath, JSON.stringify(checkpoint));
      if (kind === 'reverted-admission') {
        let callbacks = 0;
        await assert.rejects(run.session.withCheckpoint(async () => { callbacks += 1; }), { code: 'historical-state-mismatch' });
        assert.equal(callbacks, 0);
      } else {
        await assert.rejects(run.writeCandidate({ directory: join(root, 'candidate'), result }), { code: 'historical-result-mismatch' });
      }
    });
  }
});
