import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSyntheticRegistry, presentCorpusLoad } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { corpusInput, options } from './helpers/vin-corpus-fixture.js';

async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'vin-registry-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
async function candidate(root, name, input) { const directory = join(root, name); assert.equal((await writeCorpusCandidate(directory, input, options)).status, 'ok'); return directory; }
const registry = (root, extra = {}) => createSyntheticRegistry({ root: join(root, 'store'), ...options, ...extra });

test('cold absence is source-unavailable; successful, idempotent and failed loads preserve presentation truth and immutable reads', async (t) => {
  const root = await temporary(t); const port = registry(root);
  assert.equal((await port.load()).status, 'source-unavailable');
  assert.equal(port.getConfiguration('missing').status, 'source-unavailable');
  const input = await corpusInput(); const path = await candidate(root, 'v1', input);
  const published = await port.publish(path); assert.equal(published.status, 'ok');
  const id = input.configurations[0].configurationId; const vin = input.allocationInventory.records[0].vin17;
  const read = port.getVin(vin); assert.equal(read.status, 'partial'); assert.equal(read.identityKind, 'synthetic');
  assert.equal(read.record.configuration.market, 'US'); assert.equal(read.record.configuration.steering, 'LHD');
  assert.equal(read.record.configuration.productionDate, null); assert.equal(read.record.sourceContext.selectedOptionCompleteness, 'unknown');
  assert.equal(read.record.sourceContext.observedDate, '2026-11-01'); assert.equal(read.images.length, 0);
  read.record.configuration.market = 'GB'; assert.equal(port.getConfiguration(id).record.configuration.market, 'US');
  const inventory = await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8');
  const selected = await readFile(join(root, 'store', 'active.json'), 'utf8');
  assert.equal((await port.publish(path)).idempotent, true);
  assert.equal(await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8'), inventory);
  assert.equal(await readFile(join(root, 'store', 'active.json'), 'utf8'), selected);
  await writeFile(join(path, 'vins.jsonl'), 'broken'); const failed = await port.publish(path);
  assert.equal(failed.status, 'invalid-corpus'); assert.equal(failed.stillActive.version, '1');
  assert.deepEqual(port.getVin(vin).record.sourceContext, read.record.sourceContext);
  const presentation = presentCorpusLoad(failed); assert.equal(presentation.active.version, '1');
  assert.equal(presentation.status, 'invalid-corpus'); assert.equal(presentation.syntheticNotice.includes('fictional'), true);
  assert.equal((await port.classifyIdentity(vin)).identityKind, 'synthetic');
});

test('restart, dataset additions and demo-run reset preserve physical VIN and original dataset/configuration associations', async (t) => {
  const root = await temporary(t); const first = await corpusInput(); const path = await candidate(root, 'v1', first);
  const port = registry(root); await port.publish(path);
  const original = port.getVin(first.allocationInventory.records[0].vin17);
  const added = await corpusInput({ count: 2, version: '2', datasetId: 'later-dataset', inventory: first.allocationInventory });
  assert.equal((await port.publish(await candidate(root, 'v2', added))).status, 'ok');
  const restarted = registry(root); assert.equal((await restarted.load()).status, 'ok');
  assert.deepEqual(restarted.getVin(original.vehicle.vin17).vehicle, original.vehicle);
  assert.equal(restarted.getVin(original.vehicle.vin17).vehicle.originatingDatasetId, 'bounded-reference');
  assert.equal(restarted.getVin(original.vehicle.vin17).record.configurationId, original.record.configurationId);
  const configOrigin = JSON.parse(await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8')).configurations
    .find((row) => row.configurationId === original.record.configurationId);
  assert.equal(configOrigin.originatingDatasetId, 'bounded-reference');
  // Mutable run reset has no registry writer or delete capability. Reopening the same root is independent of it.
  const resetRead = registry(root, { policyRead: { ...options.policyRead, runId: 'reset-run' } });
  assert.equal((await resetRead.load()).status, 'ok'); assert.deepEqual(resetRead.getVin(original.vehicle.vin17), restarted.getVin(original.vehicle.vin17));
});

test('historical configuration, VIN association and dataset-version conflicts cannot replace active selection', async (t) => {
  const root = await temporary(t); const first = await corpusInput(); const port = registry(root);
  await port.publish(await candidate(root, 'first', first));
  const changed = await corpusInput({ version: '2' }); changed.configurations[0].sourceContext.confidence += ' changed';
  const result = await port.publish(await candidate(root, 'changed', changed));
  assert.equal(result.status, 'conflict'); assert.equal(result.failure.code, 'historical-configuration-conflict');
  const different = await corpusInput({ count: 2 });
  const versionConflict = await port.publish(await candidate(root, 'version-conflict', different));
  assert.equal(versionConflict.failure.code, 'dataset-version-conflict'); assert.equal(port.status().active.version, '1');
});

test('atomic reader visibility stays old until selection and every reader resolves a whole matching version', async (t) => {
  const root = await temporary(t); const first = await corpusInput(); const port = registry(root); const other = registry(root);
  await port.publish(await candidate(root, 'first', first)); await other.load();
  const next = await corpusInput({ count: 2, version: '2', inventory: first.allocationInventory });
  let release; const paused = new Promise((done) => { release = done; }); let reached;
  const staging = new Promise((done) => { reached = done; });
  const writer = registry(root, { onPhase: async (phase) => { if (phase === 'before-select') { reached(); await paused; } } });
  const publication = writer.publish(await candidate(root, 'second', next)); await staging;
  for (let i = 0; i < 8; i++) {
    assert.equal((await other.load()).active.version, '1'); assert.equal(other.status().active.counts.configurations, 1);
    assert.equal((await registry(root).publish(join(root, 'second'))).status, 'competing-writer');
  }
  release(); assert.equal((await publication).status, 'ok');
  assert.equal((await other.load()).active.version, '2'); assert.equal(other.status().active.counts.configurations, 2);
  assert.equal(port.status().active.version, '1');
});

test('interruption after durable identity retention keeps last good data and resumes through stale writer recovery', async (t) => {
  const root = await temporary(t); const first = await corpusInput(); const port = registry(root);
  await port.publish(await candidate(root, 'first', first));
  const next = await corpusInput({ count: 2, version: '2', inventory: first.allocationInventory });
  const path = await candidate(root, 'second', next);
  const code = `import {createSyntheticRegistry} from ${JSON.stringify(new URL('../gcsp/vehicle-evidence/synthetic-registry.js', import.meta.url).href)};
import {options} from ${JSON.stringify(new URL('./helpers/vin-corpus-fixture.js', import.meta.url).href)};
const port=createSyntheticRegistry({root:${JSON.stringify(join(root, 'store'))},...options,onPhase:async phase=>{if(phase==='inventory-persisted')process.exit(72)}});
await port.publish(${JSON.stringify(path)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 72, child.stderr);
  const reopened = registry(root); assert.equal((await reopened.load()).active.version, '1');
  assert.equal((await reopened.classifyIdentity(next.allocationInventory.records[1].vin17)).identityKind, 'synthetic');
  assert.equal((await reopened.publish(path)).status, 'ok'); assert.equal(reopened.status().active.version, '2');
  assert.equal((await readdir(join(root, 'store'))).some((name) => name.startsWith('.stage-') || name === 'publication.lock'), false);
});

test('cold restart recovers validated previous version after selected artifact corruption; history errors fail routing closed', async (t) => {
  const root = await temporary(t); const first = await corpusInput(); const port = registry(root);
  await port.publish(await candidate(root, 'first', first));
  await port.publish(await candidate(root, 'second', await corpusInput({ count: 2, version: '2', inventory: first.allocationInventory })));
  const selection = JSON.parse(await readFile(join(root, 'store', 'active.json'), 'utf8'));
  await writeFile(join(root, 'store', 'versions', selection.selected.directory, 'configurations.jsonl'), '{}\n');
  const reopened = registry(root); const recovered = await reopened.load();
  assert.equal(recovered.status, 'source-unavailable'); assert.equal(recovered.recovered, true);
  assert.equal(reopened.status().active.version, '1');
  const vin = first.allocationInventory.records[0].vin17;
  await writeFile(join(root, 'store', 'identity-inventory.json'), '{}');
  assert.equal((await reopened.classifyIdentity(vin)).liveEligible, false);
  assert.equal((await reopened.classifyIdentity(vin)).status, 'source-unavailable');
  await rm(join(root, 'store', 'identity-inventory.json'));
  assert.equal((await registry(root).load()).status, 'source-unavailable');
});

test('explicit deactivation preserves the independent durable synthetic inventory across restart and failures', async (t) => {
  const root = await temporary(t); const input = await corpusInput(); const port = registry(root);
  await port.publish(await candidate(root, 'first', input)); const vin = input.allocationInventory.records[0].vin17;
  const before = await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8');
  assert.equal((await port.deactivate()).status, 'ok'); assert.equal(port.getVin(vin).status, 'source-unavailable');
  const reopened = registry(root); assert.equal((await reopened.load()).status, 'source-unavailable');
  assert.equal((await reopened.classifyIdentity(vin)).identityKind, 'synthetic');
  assert.equal((await reopened.classifyIdentity(vin.slice(-7))).identityKind, 'synthetic');
  assert.equal((await reopened.classifyIdentity('not-a-vin')).liveEligible, false);
  assert.equal(await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8'), before);
});

test('explicit-path local CLI validates, publishes, reloads and reports finite errors with still-active version', async (t) => {
  const root = await temporary(t); const path = await candidate(root, 'candidate', await corpusInput());
  const cli = resolve('server/scripts/publish-synthetic-vin-dataset.mjs');
  const run = (command, extra = []) => spawnSync(process.execPath, [cli, command, '--store', join(root, 'store'),
    '--artifacts', path, '--run-id', 'publication-cli', '--as-of', options.policyRead.asOf, ...extra], { encoding: 'utf8', timeout: 10000 });
  for (const command of ['validate', 'publish', 'load']) { const result = run(command); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).status, 'ok'); }
  await writeFile(join(path, 'vins.jsonl'), 'truncated'); const bad = run('publish');
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).stillActive.version, '1');
  const missing = spawnSync(process.execPath, [cli, 'publish'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(missing.status, 2); assert.equal(JSON.parse(missing.stdout).failure.code, 'invalid-command');
});

test('every interrupted publication phase retains the previous complete selection and bounded staging recovers', async (t) => {
  for (const phase of ['staged', 'version-persisted', 'inventory-persisted', 'before-select']) {
    const root = await temporary(t); const first = await corpusInput(); const original = registry(root);
    await original.publish(await candidate(root, 'first', first));
    const nextPath = await candidate(root, 'next', await corpusInput({ count: 2, version: '2', inventory: first.allocationInventory }));
    const interrupted = registry(root, { onPhase: async (current) => { if (current === phase) throw new Error('Injected publication interruption'); } });
    const result = await interrupted.publish(nextPath); assert.equal(result.status, 'source-unavailable', phase);
    assert.equal(result.stillActive.version, '1', phase);
    const reopened = registry(root); assert.equal((await reopened.load()).active.version, '1', phase);
    assert.equal((await reopened.publish(nextPath)).status, 'ok', phase);
    const leftovers = (await readdir(join(root, 'store'))).filter((name) => name.startsWith('.stage-') || name.startsWith('.publisher-') || name.startsWith('.write-'));
    assert.deepEqual(leftovers, [], phase);
  }
});

test('a newly allocated VIN for an already retained physical car cannot rewrite historical association', async (t) => {
  const { allocateSyntheticIdentities, emptyAllocationInventory } = await import('../gcsp/vehicle-evidence/vin-allocation.js');
  const root = await temporary(t); const first = await corpusInput(); const port = registry(root);
  await port.publish(await candidate(root, 'first', first));
  const changed = await corpusInput({ version: '2' }); const row = first.configurations[0];
  const allocation = await allocateSyntheticIdentities(emptyAllocationInventory(), { runId: 'different-run', seed: 'independent-fictional-seed',
    corpusVersion: 'reference-corpus.v1', datasetId: 'different-origin', vehicles: [{ vehicleId: 'reference-vehicle-1',
      configurationId: row.configurationId, snapshotVersion: row.snapshotVersion, configuration: row.configuration,
      usage: 'current-car', profileId: first.allocationInventory.records[0].profile.profileId, referenceOnly: true }] }, { expectedRevision: 0 });
  changed.allocationInventory = allocation.inventory;
  const rejected = await port.publish(await candidate(root, 'changed-vin', changed));
  assert.equal(rejected.status, 'conflict'); assert.equal(rejected.failure.code, 'historical-identity-conflict');
  assert.equal(port.getVin(first.allocationInventory.records[0].vin17).vehicle.originatingDatasetId, 'bounded-reference');
});

test('source-backed presentation survives restart, replay and failed activation with zero live transport calls', async (t) => {
  const { sourceBackedInput } = await import('./helpers/vin-corpus-fixture.js');
  const root = await temporary(t); const input = await sourceBackedInput(); const path = await candidate(root, 'source', input);
  const previousFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('No live transport allowed'); }; t.after(() => { globalThis.fetch = previousFetch; });
  const port = registry(root); assert.equal((await port.publish(path)).status, 'ok');
  const id = input.configurations[0].configurationId; const before = port.getConfiguration(id);
  assert.equal(before.record.catalogue.facts.luggageNormal.unit, 'LITRES');
  assert.equal(before.record.catalogue.facts.bodyLength.state, 'unknown');
  assert.equal(before.record.catalogue.equipment.verifiedFitted.state, 'unknown');
  assert.equal(before.record.catalogue.observedDate, '2026-11-01');
  assert.equal(before.record.catalogue.catalogueValidity.productionDate, '2027-01-05');
  assert.equal(before.record.configuration.productionDate, null);
  assert.equal((await port.publish(path)).idempotent, true);
  const restarted = registry(root); await restarted.load(); assert.deepEqual(restarted.getConfiguration(id), before);
  await writeFile(join(path, 'configurations.jsonl'), '{'); assert.equal((await restarted.publish(path)).status, 'invalid-corpus');
  assert.deepEqual(restarted.getConfiguration(id), before); assert.equal(calls, 0);
});

test('a failed selected version keeps its specific diagnostic while the previous valid selection stays readable', async (t) => {
  const root = await temporary(t); const first = await corpusInput(); const port = registry(root);
  await port.publish(await candidate(root, 'v1', first));
  const added = await corpusInput({ count: 2, version: '2', datasetId: 'later-dataset', inventory: first.allocationInventory });
  assert.equal((await port.publish(await candidate(root, 'v2', added))).status, 'ok');
  const vin = first.allocationInventory.records[0].vin17; const versions = join(root, 'store', 'versions');
  const [older, newer] = (await readdir(versions)).sort((a, b) => (a === port.status().active.manifestDigest ? 1 : 0) - (b === port.status().active.manifestDigest ? 1 : 0));
  await writeFile(join(versions, newer, 'configurations.jsonl'), '{"a":1}\nbroken\n');
  const reopened = registry(root); const result = await reopened.load();
  assert.equal(result.status, 'source-unavailable'); assert.equal(result.recovered, true); assert.equal(result.stillActive.version, '1');
  assert.deepEqual(result.failure, { code: 'selected-corpus-invalid', message: 'The selected complete corpus failed validation.' });
  assert.equal(result.diagnostic.selection, 'selected'); assert.equal(result.diagnostic.cause.code, 'malformed-jsonl');
  assert.deepEqual({ ...result.diagnostic, cause: undefined }, { selection: 'selected', cause: undefined, phase: 'index:configurations.jsonl',
    file: 'configurations.jsonl', check: 'parse', record: 2, offset: 8 });
  assert.equal(result.previousDiagnostic, undefined);
  assert.equal(reopened.getVin(vin).status, 'partial'); assert.equal(reopened.getVin(vin).identityKind, 'synthetic');
  assert.equal(Object.hasOwn(presentCorpusLoad(result), 'diagnostic'), false);
  assert.equal(JSON.stringify(presentCorpusLoad(result)).includes('configurations.jsonl'), false);
  await writeFile(join(versions, older, 'vins.jsonl'), 'broken');
  const both = await registry(root).load();
  assert.equal(both.failure.code, 'selected-corpus-invalid'); assert.equal(both.recovered, undefined);
  assert.equal(both.diagnostic.selection, 'selected'); assert.equal(both.previousDiagnostic.selection, 'previous');
  assert.equal(both.previousDiagnostic.phase, 'index:vins.jsonl');
});
test('store and history load failures keep the error name and errno beside the unchanged failure', async (t) => {
  const root = await temporary(t); const port = registry(root); await port.publish(await candidate(root, 'v1', await corpusInput()));
  await writeFile(join(root, 'store', 'identity-inventory.json'), '{');
  const result = await registry(root).load();
  assert.equal(result.failure.code, 'identity-inventory-unavailable'); assert.deepEqual(result.diagnostic, { errorName: 'SyntaxError' });
});
