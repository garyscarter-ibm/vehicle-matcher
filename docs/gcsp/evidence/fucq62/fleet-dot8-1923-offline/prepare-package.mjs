// Existing F54 publisher and F62 wire formats; retained source bytes only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyntheticRegistry } from '../../../../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../../../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { fleetReleases, releaseLimits, validateRelease } from '../../../../../server/gcsp/vehicle-evidence/fleet-release.js';
import { packFleetRelease } from '../../../../../server/gcsp/vehicle-evidence/fleet-artifacts.js';
import { installFleetOfflineGuard } from '../../../../../scripts/gcsp/fleet-offline-guard.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const plan = JSON.parse(await readFile(new URL('./plan.json', import.meta.url)));
const phase = process.argv[2]; assert.ok(['describe', 'pack'].includes(phase));
const output = plan.outputRoot; assert.ok(isAbsolute(output));
const inputsFile = join(plan.outputRoot, 'descriptor-inputs.json');
const inputs = JSON.parse(await readFile(inputsFile));
plan.manifestDigest=inputs.candidateManifestDigest;plan.previousManifestDigest=inputs.previousManifestDigest;
const store = join(root, 'server/data/gcsp/vehicle-evidence/fleet-source.v1');
const sourceRoot = join(root, 'server/data/gcsp/vehicle-evidence/registered-sources');
const isolated = join(output, 'isolated-store');
const candidate = plan.candidateDirectory;
async function sha(path) { const h = createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); }
async function save(name, value) { await writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
async function tree(path) {
  const result = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const item = join(dir, entry.name); assert.equal((await lstat(item)).isSymbolicLink(), false);
      if (entry.isDirectory()) await walk(item);
      else { assert.equal(entry.isFile(), true); result.push({ path: relative(path, item), bytes: (await stat(item)).size, sha256: await sha(item) }); }
    }
  }
  await walk(path);
  return result;
}
async function verifyInputs() {
  assert.equal(inputs.version,plan.version);
  assert.equal(inputs.candidateManifestDigest, plan.manifestDigest);
  assert.equal(inputs.previousManifestDigest, plan.previousManifestDigest);
  for (const file of inputs.files) {
    const path = join(candidate, file.name); assert.equal((await stat(path)).size, file.bytes); assert.equal(await sha(path), file.sha256);
  }
  for (const source of inputs.sources) {
    const path = join(sourceRoot, source.origin); assert.equal((await stat(path)).size, source.bytes); assert.equal(await sha(path), source.sha256);
  }
  for (const [path, digest] of Object.entries(inputs.ordinaryStoreInputPins)) assert.equal(await sha(path), digest);
}
await verifyInputs();
const before = await tree(store);
const guard = installFleetOfflineGuard(); const control = guard.control(); assert.equal(control, 'blocked');
try {
  if (phase === 'describe') {
    const previous = fleetReleases.find(r => r.manifestDigest === plan.previousManifestDigest);
    assert.deepEqual(previous, inputs.previousDescriptor);
    assert.equal(fleetReleases.some(r => r.manifestDigest === plan.manifestDigest), false);
    const historyBefore = JSON.parse(await readFile(join(store, 'identity-inventory.json')));
    const pointerBefore = JSON.parse(await readFile(join(store, 'active.json')));
    assert.equal(pointerBefore.selected.manifestDigest, plan.previousManifestDigest);
    await cp(store, isolated, { recursive: true, force: false, errorOnExist: true });
    const options = { approvedImages: APPROVED_CORPUS_IMAGES, jsonlLimitsForManifest: releaseLimits,
      policyService: createPolicyService(), policyRead: { runId: plan.runId, asOf: '2026-11-07T00:00:00.000Z' } };
    const registry = createSyntheticRegistry({ root: isolated, ...options });
    const published = await registry.publish(candidate); assert.equal(published.status, 'ok', JSON.stringify(published));
    assert.equal(published.active.manifestDigest, plan.manifestDigest);
    assert.equal((await registry.publish(candidate)).idempotent,true);
    const coldRegistry=createSyntheticRegistry({root:isolated,...options});
    const cold = await coldRegistry.load();
    for(const image of APPROVED_CORPUS_IMAGES){const imaged=coldRegistry.getConfiguration(image.configurationId);assert.deepEqual(imaged.record.imageIds,[]);assert.deepEqual(imaged.images,[image]);assert.equal(imaged.imageState,'representative');}
    assert.equal(cold.status, 'ok', JSON.stringify(cold)); assert.equal(cold.active.manifestDigest, plan.manifestDigest);
    const historyAfter = JSON.parse(await readFile(join(isolated, 'identity-inventory.json')));
    assert.equal(historyBefore.configurations.length, 1134); assert.equal(historyAfter.configurations.length, 1924);
    assert.deepEqual(historyAfter.identities, historyBefore.identities);
    const configurations = new Map(historyAfter.configurations.map(r => [r.configurationId, r]));
    for (const row of historyBefore.configurations) assert.deepEqual(configurations.get(row.configurationId), row);
    for (const row of historyBefore.datasets) assert.deepEqual(historyAfter.datasets.find(r => r.datasetId === row.datasetId && r.version === row.version), row);
    assert.equal(historyAfter.datasets.length, historyBefore.datasets.length + 1);
    assert.equal(historyAfter.revision, historyBefore.revision + 1);
    for (const entry of before.filter(r => r.path.startsWith('versions/'))) assert.equal(await sha(join(isolated, entry.path)), entry.sha256);
    for (const entry of inputs.files) assert.equal(await sha(join(isolated, 'versions', plan.manifestDigest, entry.name)), entry.sha256);
    const pointer = JSON.parse(await readFile(join(isolated, 'active.json')));
    assert.equal(pointer.selected.manifestDigest, plan.manifestDigest); assert.deepEqual(pointer.previous, pointerBefore.selected);
    assert.deepEqual(JSON.parse(await readFile(join(isolated, 'last-good.json'))), { schemaVersion: '1', selected: pointerBefore.selected });
    const assets = [];
    async function asset(path, input, extra = {}) {
      const name = path.replaceAll('/', '--'); const value = { name, path, bytes: (await stat(input)).size, sha256: await sha(input), role: 'corpus',
        url: `https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/${plan.tag}/${name}`, ...extra };
      assets.push(value); return value;
    }
    for (const file of ['active.json', 'last-good.json', 'identity-inventory.json']) await asset('store/' + file, join(isolated, file));
    for (const digest of [plan.manifestDigest, plan.previousManifestDigest]) for (const file of ['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl']) {
      const path = `versions/${digest}/${file}`; await asset('store/' + path, join(isolated, path));
    }
    const sources = [];
    for (const source of inputs.sources) {
      const copied = await asset(source.path, join(sourceRoot, source.origin), { role: 'source', origin: source.origin });
      assert.equal(copied.sha256, source.sha256); assert.equal(copied.bytes, source.bytes);
      sources.push({ path: source.path, sha256: source.sha256, bytes: source.bytes, manifestDigests: source.manifestDigests });
    }
    const descriptor = validateRelease({ schemaVersion: 'fleet-release.v1', releaseId: plan.manifestDigest, manifestDigest: plan.manifestDigest,
      previousManifestDigest: plan.previousManifestDigest, datasetId: 'gcsp-source-fleet', version: inputs.version, jsonlMaxBytes: 67108864, assets, sources });
    assert.equal(assets.length, 23); assert.equal(sources.length, 12); assert.equal(assets.every(a => a.bytes > 0), true);
    await save('descriptor.json', descriptor);
    await save('publication-receipt.json', { status: 'isolated-published-and-described', releaseId: plan.manifestDigest,
      tag: plan.tag, counts: cold.active.counts, isolatedStore: isolated, files: assets.length, nonemptyPublicFiles: assets.length,
      bytes: assets.reduce((n, a) => n + a.bytes, 0), sourceShards: sources.length,
      preservation: { priorVersionFilesByteIdentical: before.filter(r => r.path.startsWith('versions/')).length,
        priorHistoryConfigurationsIdentical: historyBefore.configurations.length, priorHistoryIdentitiesIdentical: historyBefore.identities.length,
        priorHistoryDatasetsIdentical: historyBefore.datasets.length, addedHistoryConfigurations: 790, addedHistoryDatasets: 1,
        candidateBytesUnchanged: true, old1134LinesEvidenceReused: './candidate-results.json', vinAndOldImageBytesUnchanged: true, newImageAssociationAdditive: true },
      ordinaryStoreBefore: before, isolatedStoreFiles: await tree(isolated),
      egress: { control, externalCalls: guard.calls.length }, ordinaryPublicationExecuted: false, publicUploadExecuted: false, acceptance: false });
  } else {
    const descriptor = validateRelease(JSON.parse(await readFile(join(output, 'descriptor.json'))));
    assert.deepEqual(fleetReleases.find(r => r.releaseId === plan.manifestDigest), descriptor);
    assert.deepEqual(fleetReleases.find(r => r.releaseId === plan.previousManifestDigest), inputs.previousDescriptor);
    await mkdir(join(output, 'pack'));
    const packed = await packFleetRelease({ releaseId: plan.manifestDigest, store: isolated, output: join(output, 'pack'), sourceRoot });
    assert.equal(packed.files, 23); assert.equal(packed.bytes, descriptor.assets.reduce((n, a) => n + a.bytes, 0));
    await save('pack-receipt.json', { ...packed, descriptorSha256: await sha(join(output, 'descriptor.json')), tag: plan.tag,
      filesVerified: await tree(packed.directory), egress: { control, externalCalls: guard.calls.length },
      ordinaryPublicationExecuted: false, publicUploadExecuted: false, acceptance: false });
  }
  assert.equal(guard.calls.length, 0); await verifyInputs(); assert.deepEqual(await tree(store), before);
} finally { guard.restore(); }
console.log(JSON.stringify({ status: 'scoped-offline-' + phase + '-passed', releaseId: plan.manifestDigest, output }));
