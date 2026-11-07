import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const yaml = await readFile(new URL('../../render.gcsp.yaml', import.meta.url), 'utf8');

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
