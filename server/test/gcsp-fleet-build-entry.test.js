import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const yaml = await readFile(new URL('../../render.gcsp-buddy.yaml', import.meta.url), 'utf8');
const previousRelease = '0bfe3139491826c5605c0a22918ec58c687b7922bd00650d9dddeaf40860399a';
const gcspRender = { RENDER: 'true', RENDER_SERVICE_ID: 'srv-dbm9cim1egvs73bo6g5g' };

// Exercise the real CLI and selector; replace only the artifact transfer boundary.
async function runArtifactCommand(t, { env = {}, config = yaml, command = 'restore', network = 'download', stub } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'fleet-build-entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['server/scripts', 'server/gcsp/vehicle-evidence']) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, 'server/package.json'), '{"type":"module"}');
  await writeFile(join(root, 'render.gcsp-buddy.yaml'), config);
  // Offline and pack fixtures retain their existing standalone CLI dependency surface.
  const paths = ['scripts/fleet-artifacts.mjs', 'gcsp/vehicle-evidence/fleet-release.js', 'gcsp/vehicle-evidence/fleet-releases.json'];
  for (const path of paths) {
    await writeFile(join(root, 'server', path), await readFile(new URL('../' + path, import.meta.url)));
  }
  await writeFile(join(root, 'server/gcsp/vehicle-evidence/fleet-artifacts.js'), stub ?? `
    export async function restoreFleetRelease(options) { return { status: 'ok', active: { manifestDigest: options.releaseId }, options }; }
    export async function packFleetRelease(options) { return { status: 'packed', options }; }
  `);
  const args = [join(root, 'server/scripts/fleet-artifacts.mjs'), command, '--release', previousRelease, '--store', join(root, 'store'),
    ...(command === 'restore' ? ['--cache', join(root, 'cache'), '--network', network] : ['--output', join(root, 'output')])];
  const child = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined);
  assert.equal(child.stderr, '');
  return { code: child.status, value: JSON.parse(child.stdout), stdout: child.stdout };
}

test('operator, retail, offline and pack commands preserve the explicitly requested release', async (t) => {
  for (const options of [{}, { env: { RENDER: 'true', RENDER_SERVICE_ID: 'another-service' } },
    { env: { ...gcspRender, RENDER: 'false' } }, { env: gcspRender, network: 'offline' }, { env: gcspRender, command: 'pack' }]) {
    const result = await runArtifactCommand(t, options);
    assert.equal(result.code, 0);
    assert.equal(result.value.options.releaseId, previousRelease);
  }
});

test('a failed restore reports its step, cause, status and file name on one URL-free line', async (t) => {
  const stub = `
    export async function restoreFleetRelease() { throw Object.assign(new TypeError('Artifact response rejected'),
      { artifactCode: 'download-failed', httpStatus: 503, attempts: 4, asset: 'configurations.jsonl', step: 'download' }); }
    export async function packFleetRelease() { return {}; }
  `;
  const child = await runArtifactCommand(t, { env: gcspRender, stub });
  assert.equal(child.code, 1);
  assert.deepEqual(child.value, { status: 'artifact-release-failed', step: 'download', code: 'download-failed', httpStatus: 503, attempts: 4,
    asset: 'configurations.jsonl', failure: 'Check approved release, explicit absolute paths, pinned bytes and offline cache. Existing selection is preserved on rejected candidates.' });
  assert.doesNotMatch(child.stdout, /:\/\//);
});

test('the server install runs no GCSP fleet hook', () => {
  assert.equal(pkg.scripts.postinstall, undefined);
});

test('a validation failure prints the bounded stage, failure and diagnostic on the same URL-free line', async (t) => {
  const stub = `
    export async function restoreFleetRelease() { throw Object.assign(new TypeError('Cached store failed full validation'),
      { artifactCode: 'validation-failed', step: 'validate-cache', validation: { stage: 'cached', status: 'source-unavailable',
        failure: { code: 'selected-corpus-invalid', message: 'The selected complete corpus failed validation.' },
        diagnostic: { selection: 'selected', cause: { code: 'checksum-mismatch' }, phase: 'index:vins.jsonl' }, manifestDigestMatches: false } }); }
    export async function packFleetRelease() { return {}; }
  `;
  const child = await runArtifactCommand(t, { env: gcspRender, stub });
  assert.equal(child.code, 1); assert.equal(child.stdout.trim().split('\n').length, 1);
  assert.equal(child.value.code, 'validation-failed'); assert.equal(child.value.step, 'validate-cache');
  assert.equal(child.value.reason, 'Cached store failed full validation');
  assert.deepEqual(child.value.validation, { stage: 'cached', status: 'source-unavailable',
    failure: { code: 'selected-corpus-invalid', message: 'The selected complete corpus failed validation.' },
    diagnostic: { selection: 'selected', cause: { code: 'checksum-mismatch' }, phase: 'index:vins.jsonl' }, manifestDigestMatches: false });
  assert.doesNotMatch(child.stdout, /:\/\//);
});
