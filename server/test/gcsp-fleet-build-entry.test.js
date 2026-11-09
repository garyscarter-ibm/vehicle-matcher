import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const yaml = await readFile(new URL('../../render.gcsp.yaml', import.meta.url), 'utf8');
const currentRelease = '3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30';
const previousRelease = '0bfe3139491826c5605c0a22918ec58c687b7922bd00650d9dddeaf40860399a';
const gcspRender = { RENDER: 'true', RENDER_SERVICE_ID: 'srv-dbm9cim1egvs73bo6g5g' };

// Exercise the real CLI and selector; replace only the artifact transfer boundary.
async function runArtifactCommand(t, { env = {}, config = yaml, command = 'restore', network = 'download', stub } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'fleet-build-entry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['server/scripts', 'server/gcsp/vehicle-evidence']) await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, 'server/package.json'), '{"type":"module"}');
  await writeFile(join(root, 'render.gcsp.yaml'), config);
  // Offline and pack fixtures retain their existing standalone CLI dependency surface.
  const paths = ['scripts/fleet-artifacts.mjs', 'gcsp/vehicle-evidence/fleet-release.js', 'gcsp/vehicle-evidence/fleet-releases.json'];
  if (command === 'restore' && network === 'download') paths.push('scripts/prepare-fleet-build.mjs');
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

test('a stale explicit GCSP Render download command restores the current Blueprint release', async (t) => {
  // The assignment before npm install is not inherited by the later CLI process.
  for (const extra of [{}, { GCSP_FLEET_BUILD_EXPLICIT: '1' }]) {
    const result = await runArtifactCommand(t, { env: { ...gcspRender, ...extra } });
    assert.equal(result.code, 0);
    assert.equal(result.value.active.manifestDigest, currentRelease);
    assert.equal(result.value.options.offline, false);
  }
});

test('operator, retail, offline and pack commands preserve the explicitly requested release', async (t) => {
  for (const options of [{}, { env: { RENDER: 'true', RENDER_SERVICE_ID: 'another-service' } },
    { env: { ...gcspRender, RENDER: 'false' } }, { env: gcspRender, network: 'offline' }, { env: gcspRender, command: 'pack' }]) {
    const result = await runArtifactCommand(t, options);
    assert.equal(result.code, 0);
    assert.equal(result.value.options.releaseId, previousRelease);
  }
});

test('GCSP Render download rejects absent, unapproved or ambiguous Blueprint selectors', async (t) => {
  for (const config of ['', yaml.replace(/--release [a-f0-9]{64}/, '--release ' + 'a'.repeat(64)),
    yaml.replace('--release ' + currentRelease, '--release ' + currentRelease + ' --release ' + previousRelease)]) {
    const result = await runArtifactCommand(t, { env: gcspRender, config });
    assert.equal(result.code, 1);
    assert.equal(result.value.status, 'artifact-release-failed');
    assert.equal(result.value.active, undefined);
    assert.equal(result.value.step, 'resolve-release');
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

test('npm install prepares the GCSP fleet even when the remote build command only installs dependencies', async () => {
  assert.equal(pkg.scripts.postinstall, 'node --max-old-space-size=384 scripts/prepare-fleet-build.mjs');
  const { prepareFleetBuild } = await import('../scripts/prepare-fleet-build.mjs');
  const calls = [];
  const result = await prepareFleetBuild({
    env: { RENDER: 'true', RENDER_SERVICE_ID: 'srv-dbm9cim1egvs73bo6g5g' },
    config: yaml, restore: async (options) => { calls.push(options); return { status: 'ok', active: { manifestDigest: options.releaseId } }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].releaseId, '3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30');
  assert.equal(calls[0].offline, false);
  assert.match(calls[0].store, /\/server\/data\/gcsp\/vehicle-evidence\/fleet-source\.v1$/);
  assert.match(calls[0].cacheRoot, /\/server\/data\/gcsp\/vehicle-evidence\/fleet-artifacts\.v1$/);
  assert.equal(result.status, 'prepared');
});

test('ordinary installs and the retail Render service make no artifact calls', async () => {
  const { prepareFleetBuild } = await import('../scripts/prepare-fleet-build.mjs');
  for (const env of [{}, { RENDER: 'true', RENDER_SERVICE_ID: 'another-service' }]) {
    assert.deepEqual(await prepareFleetBuild({ env, restore: () => assert.fail('unexpected artifact call') }), { status: 'not-gcsp-render-build' });
  }
});

test('the Blueprint explicit restore avoids a second restore during npm install', async () => {
  const { prepareFleetBuild } = await import('../scripts/prepare-fleet-build.mjs');
  assert.match(yaml, /GCSP_FLEET_BUILD_EXPLICIT=1 npm install &&\s+node scripts\/fleet-artifacts\.mjs restore/);
  assert.deepEqual(await prepareFleetBuild({ env: { RENDER: 'true', RENDER_SERVICE_ID: 'srv-dbm9cim1egvs73bo6g5g', GCSP_FLEET_BUILD_EXPLICIT: '1' }, restore: () => assert.fail('duplicate restore') }), { status: 'explicit-build-restore' });
});

test('a missing pin, unapproved pin or failed restore fails the build', async () => {
  const { prepareFleetBuild } = await import('../scripts/prepare-fleet-build.mjs');
  const env = { RENDER: 'true', RENDER_SERVICE_ID: 'srv-dbm9cim1egvs73bo6g5g' };
  for (const config of ['', yaml.replace(/--release [a-f0-9]{64}/, '--release ' + 'a'.repeat(64))]) {
    await assert.rejects(prepareFleetBuild({ env, config, restore: () => assert.fail('unapproved restore') }));
  }
  await assert.rejects(prepareFleetBuild({ env, config: yaml, restore: async () => { throw Error('restore failed'); } }));
  await assert.rejects(prepareFleetBuild({ env, config: yaml, restore: async () => ({ status: 'ok', active: { manifestDigest: 'b'.repeat(64) } }) }));
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
