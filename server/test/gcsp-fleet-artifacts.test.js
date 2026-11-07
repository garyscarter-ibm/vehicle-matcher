import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateRelease, releaseLimits } from '../gcsp/vehicle-evidence/fleet-release.js';
import { downloadAsset } from '../gcsp/vehicle-evidence/fleet-artifacts.js';
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
