import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validateRelease, releaseLimits } from '../gcsp/vehicle-evidence/fleet-release.js';
import { downloadAsset, restoreFleetRelease, validationFailed } from '../gcsp/vehicle-evidence/fleet-artifacts.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { writeCorpusCandidate, validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { corpusInput, options } from './helpers/vin-corpus-fixture.js';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const bytes = Buffer.from('exact retained asset\n');
const asset = { name: 'configurations.jsonl', path: 'store/versions/' + 'a'.repeat(64) + '/configurations.jsonl',
  bytes: bytes.length, sha256: hash(bytes), role: 'corpus', url: 'https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/corpus-v1/configurations.jsonl' };
async function destination(t) { const p = await mkdtemp(join(tmpdir(), 'asset-test-')); t.after(() => rm(p, { recursive: true, force: true })); return join(p, 'asset'); }
test('release descriptor rejects traversal, unapproved hosts, oversized source shards and cap widening', () => {
  for (const change of [{ path: '../outside' }, { path: '/absolute' }, { url: 'https://example.org/asset' }, { path: 'store/a/../b' }])
    assert.throws(() => validateRelease({ ...fixture(), assets: [{ ...asset, ...change }] }));
  assert.throws(() => validateRelease({ ...fixture(), sources: [{ path: asset.path, sha256: asset.sha256, bytes: 33554433 }] }));
  assert.throws(() => validateRelease({ ...fixture(), jsonlMaxBytes: 268435457 }));
  assert.equal(releaseLimits('b'.repeat(64)).maxBytes, 67108864);
});
function fixture() { return { schemaVersion: 'fleet-release.v1', releaseId: 'a'.repeat(64), manifestDigest: 'a'.repeat(64), previousManifestDigest: null,
  datasetId: 'test', version: '1', jsonlMaxBytes: 67108864, assets: [asset], sources: [] }; }
test('recovery manifests retain their code-owned byte bound and direct anchors take precedence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'release-limit-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modulePath = join(directory, 'fleet-release.mjs');
  await writeFile(modulePath, await readFile(new URL('../gcsp/vehicle-evidence/fleet-release.js', import.meta.url)));
  const previous = 'b'.repeat(64);
  const descriptors = [{ ...fixture(), previousManifestDigest: previous, jsonlMaxBytes: 268435456 }];
  await writeFile(join(directory, 'fleet-releases.json'), JSON.stringify(descriptors));
  const projected = await import(pathToFileURL(modulePath).href);
  assert.equal(projected.releaseLimits('a'.repeat(64)).maxBytes, 268435456);
  assert.equal(projected.releaseLimits(previous).maxBytes, 268435456);
  assert.equal(projected.releaseLimits('c'.repeat(64)).maxBytes, 67108864);
  descriptors.push({ ...fixture(), releaseId: previous, manifestDigest: previous, jsonlMaxBytes: 67108864 });
  await writeFile(join(directory, 'fleet-releases.json'), JSON.stringify(descriptors));
  const direct = await import(pathToFileURL(modulePath).href + '?direct-anchor');
  assert.equal(direct.releaseLimits(previous).maxBytes, 67108864);
});
test('validator selects limits from exact manifest bytes and selector overrides caller limits', async (t) => {
  const directory = await destination(t); const written = await writeCorpusCandidate(directory, await corpusInput(), options);
  assert.equal(written.status, 'ok'); let selected;
  const result = await validateCorpusDirectory(directory, { ...options, indexed: true, jsonlLimits: { maxBytes: 268435456 },
    jsonlLimitsForManifest: (digest) => { selected = digest; return { maxBytes: 1 }; } });
  assert.equal(selected, hash(await readFile(join(directory, 'manifest.json'))));
  assert.notEqual(result.status, 'ok');
});
test('raw asset transfer streams exact bytes and checksum to exclusive destination', async (t) => {
  const p = await destination(t); let calls = 0;
  await downloadAsset(asset, p, { fetchImpl: async (_url, options) => { calls++; assert.equal(options.redirect, 'manual'); return new Response(bytes); } });
  assert.deepEqual(await readFile(p), bytes); assert.equal(calls, 1);
});
test('byte overflow, truncation, wrong hash and partial transport remove incomplete output', async (t) => {
  const p = await destination(t);
  const cases = [async () => new Response(Buffer.concat([bytes, bytes])), async () => new Response(bytes.subarray(1)),
    async () => new Response(Buffer.alloc(bytes.length)), async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 2)); c.error(new Error('interrupted')); } }))];
  for (const fetchImpl of cases) { await assert.rejects(downloadAsset(asset, p, { fetchImpl })); await assert.rejects(stat(p), { code: 'ENOENT' }); }
});
test('redirects cannot forward to arbitrary hosts or loop without bound', async (t) => {
  const p = await destination(t); let calls = 0;
  await assert.rejects(downloadAsset(asset, p, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://example.org/no' } }); } }));
  assert.equal(calls, 1); await assert.rejects(stat(p), { code: 'ENOENT' });
  calls = 0;
  await assert.rejects(downloadAsset(asset, p, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x' } }); } }));
  assert.equal(calls, 4);
});
test('one approved release CDN redirect retains exact hash and original exclusive file', async (t) => {
  const p = await destination(t); let calls = 0;
  await downloadAsset(asset, p, { fetchImpl: async () => ++calls === 1 ? new Response(null, { status: 302,
    headers: { location: 'https://release-assets.githubusercontent.com/asset?temporary=opaque' } }) : new Response(bytes) });
  assert.equal(calls, 2); assert.deepEqual(await readFile(p), bytes);
  await assert.rejects(downloadAsset(asset, p, { fetchImpl: async () => new Response(bytes) }));
  assert.deepEqual(await readFile(p), bytes);
});
test('zero-byte descriptor assets require the exact empty checksum', () => {
  assert.throws(() => validateRelease({ ...fixture(), assets: [{ ...asset, bytes: 0 }] }));
  assert.equal(validateRelease({ ...fixture(), assets: [{ ...asset, bytes: 0, sha256: hash('') }] }).assets[0].bytes, 0);
});
test('zero-byte exact assets materialize exclusively without transport; other digests fail closed', async (t) => {
  const p = await destination(t); let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('empty asset must not fetch'); };
  await assert.rejects(downloadAsset({ ...asset, bytes: 0 }, p, { fetchImpl }));
  await assert.rejects(stat(p), { code: 'ENOENT' });
  await downloadAsset({ ...asset, bytes: 0, sha256: hash('') }, p, { fetchImpl });
  assert.equal((await readFile(p)).length, 0); assert.equal(calls, 0);
  await writeFile(p, 'existing caller file');
  await assert.rejects(downloadAsset({ ...asset, bytes: 0, sha256: hash('') }, p, { fetchImpl }));
  assert.equal(await readFile(p, 'utf8'), 'existing caller file'); assert.equal(calls, 0);
});
// FUCQ-164: a real failing store load keeps its first specific reason on the restore error.
test('a cached store validation failure carries the stage and first specific reason', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'restore-validation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); assert.equal((await writeCorpusCandidate(source, await corpusInput(), options)).status, 'ok');
  const store = join(root, 'store'); const registry = createSyntheticRegistry({ root: store, ...options });
  assert.equal((await registry.publish(source)).status, 'ok');
  const digest = registry.status().active.manifestDigest; const vins = join(store, 'versions', digest, 'vins.jsonl');
  await writeFile(vins, (await readFile(vins, 'utf8')) + '{}\n');
  const loaded = await createSyntheticRegistry({ root: store, ...options }).load();
  const error = validationFailed('Cached store failed full validation', 'cached', loaded, { manifestDigest: digest });
  assert.equal(error.artifactCode, 'validation-failed'); assert.equal(error.message, 'Cached store failed full validation');
  assert.equal(error.validation.stage, 'cached'); assert.equal(error.validation.status, 'source-unavailable');
  assert.equal(error.validation.failure.code, 'selected-corpus-invalid'); assert.equal(error.validation.manifestDigestMatches, false);
  assert.equal(error.validation.diagnostic.cause.code, 'checksum-mismatch'); assert.equal(error.validation.diagnostic.phase, 'index:vins.jsonl');
  assert.equal(JSON.stringify(error.validation).includes(root), false);
});
test('restore accepts no caller-supplied release list; unapproved ids fail closed', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'restore-approval-')); t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(restoreFleetRelease({ releaseId: 'c'.repeat(64), store: join(root, 'store'), cacheRoot: join(root, 'cache'),
    releases: [{ releaseId: 'c'.repeat(64) }] }), { artifactCode: 'release-not-approved' });
});

async function restoreFixtureCLI(root, cachedStore, digest, metadata) {
  // Isolate the code-owned descriptor alongside a copy of the real CLI/restore code.
  // Production approval still comes only from fleet-releases.json, never caller input.
  const moduleRoot = join(root, 'server/gcsp/vehicle-evidence');
  await mkdir(moduleRoot, { recursive: true }); await mkdir(join(root, 'server/scripts'));
  await writeFile(join(root, 'server/package.json'), '{"type":"module"}');
  const moduleUrl = new URL('../gcsp/vehicle-evidence/fleet-artifacts.js', import.meta.url);
  const moduleSource = (await readFile(moduleUrl, 'utf8')).replace(/from '([^']+)'/g, (match, specifier) =>
    specifier.startsWith('.') && specifier !== './fleet-release.js' ? `from '${new URL(specifier, moduleUrl).href}'` : match);
  await writeFile(join(moduleRoot, 'fleet-artifacts.js'), moduleSource);
  await writeFile(join(moduleRoot, 'fleet-release.js'), await readFile(new URL('../gcsp/vehicle-evidence/fleet-release.js', import.meta.url)));
  const cli = join(root, 'server/scripts/fleet-artifacts.mjs');
  await writeFile(cli, await readFile(new URL('../scripts/fleet-artifacts.mjs', import.meta.url)));
  const assets = [];
  for (const name of ['active.json', 'identity-inventory.json', ...['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl'].map((file) => `versions/${digest}/${file}`)]) {
    const content = await readFile(join(cachedStore, name));
    assets.push({ name: name.replaceAll('/', '--'), path: `store/${name}`, role: 'corpus', bytes: content.length, sha256: hash(content),
      url: `https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/test-fixture/${name.replaceAll('/', '--')}` });
  }
  await writeFile(join(moduleRoot, 'fleet-releases.json'), JSON.stringify([{ schemaVersion: 'fleet-release.v1',
    releaseId: digest, manifestDigest: digest, previousManifestDigest: null, datasetId: metadata.datasetId,
    version: metadata.version, jsonlMaxBytes: 67108864, assets, sources: [] }]));
  return cli;
}

const unavailableDatabase = 'postgresql://build-fixture@127.0.0.1:1/unavailable';
test('the real offline restore CLI validates retained policy without the runtime database', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'restore-offline-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = await corpusInput({ count: 2 }); const candidate = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(candidate, input, options)).status, 'ok');
  const digest = hash(await readFile(join(candidate, 'manifest.json')));
  const cache = join(root, 'cache'); const cachedStore = join(cache, digest, 'store'); const store = join(root, 'restored');
  assert.equal((await createSyntheticRegistry({ root: cachedStore, ...options }).publish(candidate)).status, 'ok');
  const cli = await restoreFixtureCLI(root, cachedStore, digest, input.metadata);
  const cachedInventory = await readFile(join(cachedStore, 'identity-inventory.json'));
  // Cold restore then existing-store replay must both ignore runtime database configuration.
  for (const [index, connectionString] of [unavailableDatabase, ''].entries()) {
    const child = spawnSync(process.execPath, [cli, 'restore', '--release', digest, '--store', store, '--cache', cache, '--network', 'offline'],
      { cwd: root, env: { ...process.env, GCSP_DATABASE_URL: connectionString }, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stdout + child.stderr); assert.equal(child.stderr, '');
    const report = JSON.parse(child.stdout);
    assert.equal(report.status, 'ok'); assert.equal(report.active.manifestDigest, digest); assert.equal(report.externalCalls, 0);
    assert.equal(report.mode, index === 0 ? 'cold-restore' : 'publish-existing');
    if (index === 1) assert.equal(report.idempotent, true);
    assert.deepEqual(await readFile(join(store, 'identity-inventory.json')), cachedInventory);
    for (const file of ['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl']) {
      assert.deepEqual(await readFile(join(store, 'versions', digest, file)), await readFile(join(candidate, file)));
    }
  }
});

test('the real offline restore CLI retains an existing-store rejection and leaves the old selection intact', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'restore-existing-rejection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await corpusInput(); const store = join(root, 'existing');
  const firstCandidate = join(root, 'first');
  assert.equal((await writeCorpusCandidate(firstCandidate, first, options)).status, 'ok');
  assert.equal((await createSyntheticRegistry({ root: store, ...options }).publish(firstCandidate)).status, 'ok');
  const before = await Promise.all(['active.json', 'identity-inventory.json'].map((file) => readFile(join(store, file))));

  // Both corpora are valid independently; changing the same dataset/version is forbidden.
  const candidate = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(candidate, await corpusInput({ count: 2, inventory: first.allocationInventory }), options)).status, 'ok');
  const digest = hash(await readFile(join(candidate, 'manifest.json')));
  const cache = join(root, 'cache'); const cachedStore = join(cache, digest, 'store');
  assert.equal((await createSyntheticRegistry({ root: cachedStore, ...options }).publish(candidate)).status, 'ok');
  const cli = await restoreFixtureCLI(root, cachedStore, digest, first.metadata);

  const child = spawnSync(process.execPath, [cli, 'restore', '--release', digest, '--store', store, '--cache', cache, '--network', 'offline'],
    { cwd: root, env: { ...process.env, GCSP_DATABASE_URL: unavailableDatabase }, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 1, child.stderr); assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.equal(report.step, 'publish-existing'); assert.equal(report.code, 'store-rejected');
  assert.equal(report.validation.stage, 'existing'); assert.equal(report.validation.status, 'conflict');
  assert.equal(report.validation.failure.code, 'dataset-version-conflict');
  assert.equal(child.stdout.trim().split('\n').length, 1); assert.equal(child.stdout.includes(root), false);
  assert.doesNotMatch(child.stdout, /:\/\//);
  for (const [i, file] of ['active.json', 'identity-inventory.json'].entries()) assert.deepEqual(await readFile(join(store, file)), before[i]);
  assert.equal((await createSyntheticRegistry({ root: store, ...options }).load()).active.version, '1');
});
