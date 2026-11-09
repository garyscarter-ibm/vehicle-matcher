import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { APPROVED_CORPUS_IMAGES } from '../gcsp/vehicle-evidence/registered-corpus-images.js';
import { sourceBackedInput, options } from './helpers/vin-corpus-fixture.js';
const run = promisify(execFile);
const project = fileURLToPath(new URL('../../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Exercise unchanged entry points in an owned application checkout whose sole
// code-owned release descriptor pins a small real-image fixture. No CLI approval
// parameter or production descriptor/file is patched by the test.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fleet-image-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'app'); await mkdir(app);
  // The input holds one configuration; reference only the registry images bound to it.
  const input = await sourceBackedInput(); const ids = new Set(input.configurations.map((row) => row.configurationId));
  const images = APPROVED_CORPUS_IMAGES.filter((image) => ids.has(image.configurationId));
  assert.equal(images.length, 1, 'exactly one approved image matches the source-backed configuration');
  for (const path of ['server/gcsp', 'server/vehicle-evidence', 'scripts/gcsp',
    'server/package.json', 'package.json', 'server/scripts/fleet-artifacts.mjs',
    'server/data/gcsp/vehicle-evidence/vin-profiles.v1.json', images[0].asset]) {
    await mkdir(dirname(join(app, path)), { recursive: true });
    await cp(join(project, path), join(app, path), { recursive: true, force: false, errorOnExist: true });
  }
  await symlink(await realpath(join(project, 'server/node_modules')), join(app, 'server/node_modules'), 'dir');
  const approved = { ...options, approvedImages: APPROVED_CORPUS_IMAGES };
  const candidate = join(root, 'candidate');
  const prepared = await writeCorpusCandidate(candidate, { ...input, images }, approved);
  assert.equal(prepared.status, 'ok', JSON.stringify(prepared));
  const digest = hash(await readFile(join(candidate, 'manifest.json')));
  const cache = join(app, 'server/data/gcsp/vehicle-evidence/fleet-artifacts.v1');
  const retained = join(cache, digest, 'store');
  assert.equal((await createSyntheticRegistry({ root: retained, ...approved }).publish(candidate)).status, 'ok');
  const assets = [];
  async function walk(path) {
    for (const entry of await readdir(join(retained, path), { withFileTypes: true })) {
      if (entry.name === 'publication-owner.json') continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) await walk(next);
      else {
        const bytes = await readFile(join(retained, next));
        const name = `fixture-${assets.length}`;
        assets.push({ path: `store/${next}`, name, role: 'corpus', bytes: bytes.length, sha256: hash(bytes),
          url: `https://github.com/garyscarter-ibm/vehicle-matcher/releases/download/fixture/${name}` });
      }
    }
  }
  await walk('');
  await writeFile(join(app, 'server/gcsp/vehicle-evidence/fleet-releases.json'), JSON.stringify([{
    schemaVersion: 'fleet-release.v1', releaseId: digest, manifestDigest: digest, previousManifestDigest: null,
    datasetId: input.metadata.datasetId, version: input.metadata.version, jsonlMaxBytes: 67108864, assets, sources: [],
  }]));
  const preload = join(root, 'offline.mjs');
  await writeFile(preload, `import {writeFileSync} from 'node:fs';
import {installFleetOfflineGuard} from ${JSON.stringify(pathToFileURL(join(project, 'scripts/gcsp/fleet-offline-guard.mjs')).href)};
const guard=installFleetOfflineGuard();const control=guard.control();
process.on('exit',()=>writeFileSync(process.env.F62_CLI_EGRESS,JSON.stringify({control,calls:guard.calls.length})));`);
  async function cli(path, args, expectedCode = 0) {
    const receipt = join(root, 'egress.json'); let result;
    try { result = await run(process.execPath, ['--max-old-space-size=128', '--import', preload, join(app, path), ...args],
      { cwd: app, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP,
        F62_CLI_EGRESS: receipt }, maxBuffer: 1048576 }); result.code = 0; }
    catch (error) { result = error; }
    assert.deepEqual(JSON.parse(await readFile(receipt)), { control: 'blocked', calls: 0 });
    assert.equal(result.code, expectedCode, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout);
  }
  return { root, app, digest, cache, retained, cli, image: images[0] };
}

test('real restore CLI admits only code-owned image approval on cold and repeated offline restore', async (t) => {
  const f = await fixture(t); const store = join(f.root, 'restored');
  const args = ['restore', '--release', f.digest, '--store', store, '--cache', f.cache, '--network', 'offline'];
  assert.equal((await f.cli('server/scripts/fleet-artifacts.mjs', args)).mode, 'cold-restore');
  const repeated = await f.cli('server/scripts/fleet-artifacts.mjs', args);
  assert.equal(repeated.status, 'ok'); assert.equal(repeated.idempotent, true);
  const before = await readFile(join(store, 'active.json'));
  const asset = join(f.app, f.image.asset); const bytes = await readFile(asset);
  for (const mutation of ['missing', 'corrupt']) {
    if (mutation === 'missing') await rm(asset);
    else { const changed = Buffer.from(bytes); changed[0] ^= 1; await writeFile(asset, changed); }
    assert.equal((await f.cli('server/scripts/fleet-artifacts.mjs', args, 1)).status, 'artifact-release-failed');
    assert.deepEqual(await readFile(join(store, 'active.json')), before);
  }
});

test('real operator active verifier CLI validates the approved image without injected options', async (t) => {
  const f = await fixture(t);
  const args = ['--active', '--store', f.retained, '--require-distinct', '1', '--offline',
    '--run-id', 'image-cli-regression', '--as-of', options.policyRead.asOf];
  const audit = await f.cli('scripts/gcsp/verify-fleet.mjs', args);
  assert.equal(audit.status, 'verified-active'); assert.equal(audit.actual.images, 1);
  assert.equal(audit.audit.checked, 1); assert.equal(audit.audit.errors, 0);
  const images = join(f.retained, 'versions', f.digest, 'images.jsonl');
  const original = JSON.parse((await readFile(images, 'utf8')).trim());
  await writeFile(images, JSON.stringify({ ...original, imageId: 'unapproved' }) + '\n');
  assert.notEqual((await f.cli('scripts/gcsp/verify-fleet.mjs', args, 1)).status, 'verified-active');
});
