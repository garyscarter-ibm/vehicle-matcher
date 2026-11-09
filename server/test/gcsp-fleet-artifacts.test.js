import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateRelease, releaseLimits } from '../gcsp/vehicle-evidence/fleet-release.js';
import { downloadAsset, restoreFleetRelease } from '../gcsp/vehicle-evidence/fleet-artifacts.js';
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

// FUCQ-164: bytes match the pinned hashes but the corpus fails semantic validation, so the reason must survive.
test('a restore whose cached store fails validation carries the stage and first specific reason', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'restore-validation-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source'); assert.equal((await writeCorpusCandidate(source, await corpusInput(), options)).status, 'ok');
  const registry = createSyntheticRegistry({ root: join(root, 'cache', 'store'), ...options });
  assert.equal((await registry.publish(source)).status, 'ok');
  const digest = registry.status().active.manifestDigest; const cached = join(root, 'cache', 'store');
  await writeFile(join(cached, 'versions', digest, 'vins.jsonl'), (await readFile(join(cached, 'versions', digest, 'vins.jsonl'), 'utf8')) + '{}\n');
  const assets = []; const list = async (directory) => { for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name); if (entry.isDirectory()) await list(path); else if (!entry.name.startsWith('.') && entry.name !== 'publication-owner.json') assets.push(path); } };
  await list(cached);
  const releaseId = 'c'.repeat(64); const release = validateRelease({ schemaVersion: 'fleet-release.v1', releaseId, manifestDigest: releaseId,
    previousManifestDigest: null, datasetId: 'test', version: '1', jsonlMaxBytes: 67108864, sources: [],
    assets: await Promise.all(assets.map(async (path) => { const bytes = await readFile(path); const relative = path.slice(join(root, 'cache').length + 1);
      return { name: relative.replace(/\//g, '_'), path: relative, bytes: bytes.length, sha256: hash(bytes), role: 'corpus',
        url: 'https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/t/' + relative.replace(/\//g, '_') }; })) });
  await mkdir(join(root, 'releases'), { recursive: true });
  await Promise.all(assets.map(async (path) => { const target = join(root, 'releases', releaseId, path.slice(join(root, 'cache').length + 1));
    await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(path)); }));
  await assert.rejects(restoreFleetRelease({ releaseId, store: join(root, 'restored'), cacheRoot: join(root, 'releases'), offline: true, releases: [release] }), (error) => {
    assert.equal(error.artifactCode, 'validation-failed'); assert.equal(error.message, 'Cached store failed full validation'); assert.equal(error.step, 'validate-cache');
    assert.equal(error.validation.stage, 'cached'); assert.equal(error.validation.status, 'source-unavailable');
    assert.equal(error.validation.failure.code, 'selected-corpus-invalid'); assert.equal(error.validation.manifestDigestMatches, false);
    assert.equal(error.validation.diagnostic.cause.code, 'checksum-mismatch'); assert.equal(error.validation.diagnostic.phase, 'index:vins.jsonl');
    assert.equal(JSON.stringify(error.validation).includes(root), false); return true;
  });
  await assert.rejects(stat(join(root, 'restored')), { code: 'ENOENT' });
});
