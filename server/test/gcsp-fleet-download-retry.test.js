import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fleetReleases } from '../gcsp/vehicle-evidence/fleet-release.js';
import { downloadAssetWithRetry, restoreFleetRelease } from '../gcsp/vehicle-evidence/fleet-artifacts.js';
const bytes = Buffer.from('exact retained asset\n');
const asset = { name: 'configurations.jsonl', path: 'store/versions/' + 'a'.repeat(64) + '/configurations.jsonl', bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), role: 'corpus', url: 'https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/corpus-v1/configurations.jsonl' };
async function scratch(t) { const p = await mkdtemp(join(tmpdir(), 'retry-test-')); t.after(() => rm(p, { recursive: true, force: true })); return p; }
// Plays one scripted response per fetch call and records calls and sleeps.
function harness(script) {
  const h = { calls: 0, sleeps: [], sleep: async (ms) => { h.sleeps.push(ms); } };
  h.fetchImpl = async () => { const step = script[Math.min(h.calls++, script.length - 1)]; return step(); };
  return h;
}
const ok = () => new Response(bytes);
const status = (code) => () => new Response('nope', { status: code });
const resetError = () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNRESET' }) }); };
const partial = () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 2)); c.error(new Error('interrupted')); } }));

for (const [name, first] of [['a 503', status(503)], ['a network reset', resetError], ['a 429', status(429)], ['a partial body', partial]]) {
  test(`${name} is retried once and the verified bytes are kept`, async (t) => {
    const destination = join(await scratch(t), 'asset'); const h = harness([first, ok]);
    await downloadAssetWithRetry(asset, destination, h);
    assert.equal(h.calls, 2); assert.deepEqual(h.sleeps, [1000]); assert.deepEqual(await readFile(destination), bytes);
  });
}
test('a permanent 503 fails after four attempts with a URL-free cause and no leftover file', async (t) => {
  const destination = join(await scratch(t), 'asset'); const h = harness([status(503)]);
  await assert.rejects(downloadAssetWithRetry(asset, destination, h), { artifactCode: 'download-failed', httpStatus: 503, attempts: 4, asset: 'configurations.jsonl' });
  assert.equal(h.calls, 4); assert.deepEqual(h.sleeps, [1000, 2000, 4000]);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
});
test('a network reset records the safe error code and nothing else', async (t) => {
  const h = harness([resetError]);
  await assert.rejects(downloadAssetWithRetry(asset, join(await scratch(t), 'asset'), { ...h, retryDelaysMs: [] }), { artifactCode: 'download-failed', retryable: true, detail: 'ECONNRESET', attempts: 1 });
});
test('a 404 is not retried', async (t) => {
  const h = harness([status(404)]);
  await assert.rejects(downloadAssetWithRetry(asset, join(await scratch(t), 'asset'), h), { artifactCode: 'download-failed', httpStatus: 404, attempts: 1 });
  assert.equal(h.calls, 1); assert.deepEqual(h.sleeps, []);
});
test('wrong bytes are rejected on the first attempt without a retry', async (t) => {
  const destination = join(await scratch(t), 'asset'); const h = harness([() => new Response(Buffer.alloc(bytes.length))]);
  await assert.rejects(downloadAssetWithRetry(asset, destination, h), { artifactCode: 'digest-mismatch', attempts: 1 });
  assert.equal(h.calls, 1); assert.deepEqual(h.sleeps, []);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
});
test('a redirect to an unapproved host is rejected without a retry', async (t) => {
  const h = harness([() => new Response(null, { status: 302, headers: { location: 'https://example.org/x' } })]);
  await assert.rejects(downloadAssetWithRetry(asset, join(await scratch(t), 'asset'), h), { artifactCode: 'unapproved-host', attempts: 1 });
  assert.equal(h.calls, 1); assert.deepEqual(h.sleeps, []);
});
test('a failure after a signed redirect exposes neither the signature nor any URL', async (t) => {
  const signed = () => new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/a?sig=SECRET' } });
  const h = harness([signed, status(503)]); let error;
  try { await downloadAssetWithRetry(asset, join(await scratch(t), 'asset'), { ...h, retryDelaysMs: [] }); } catch (e) { error = e; }
  assert.equal(error.httpStatus, 503);
  const shown = JSON.stringify({ ...error, message: error.message });
  assert.doesNotMatch(shown, /SECRET|:\/\//);
});
test('restore reports the download step, status and file name, and leaves no stage or release directory', async (t) => {
  const root = await scratch(t); const cache = join(root, 'cache'); const h = harness([status(404)]);
  await assert.rejects(restoreFleetRelease({ releaseId: fleetReleases[0].releaseId, store: join(root, 'store'), cacheRoot: cache, offline: false, fetchImpl: h.fetchImpl, sleep: h.sleep }),
    (e) => e.step === 'download' && e.artifactCode === 'download-failed' && e.httpStatus === 404 && e.attempts === 1 && /^[A-Za-z0-9._-]+$/.test(e.asset));
  assert.deepEqual(await readdir(cache), []);
});
