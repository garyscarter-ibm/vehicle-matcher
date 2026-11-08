import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeCorpusCandidate, canonicalContent, contentChecksum } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { corpusInput, sourceBackedInput, options } from './helpers/vin-corpus-fixture.js';
const moduleUrl = new URL('../../scripts/gcsp/verify-fleet.mjs', import.meta.url);
const verifier = async () => (await import(moduleUrl)).verifyStagedFleet;
async function candidate(t, input) {
  const root = await mkdtemp(join(tmpdir(), 'fleet-verifier-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'staged');
  assert.equal((await writeCorpusCandidate(directory, input || await corpusInput({ count: 2 }), options)).status, 'ok');
  return { root, directory };
}
async function edit(directory, change) {
  const path = join(directory, 'configurations.jsonl'); const rows = (await readFile(path, 'utf8')).trimEnd().split('\n').map(JSON.parse);
  change(rows); const bytes = rows.map(canonicalContent).join(''); await writeFile(path, bytes);
  const mpath = join(directory, 'manifest.json'); const manifest = JSON.parse(await readFile(mpath));
  manifest.checksums['configurations.jsonl'] = contentChecksum(bytes); await writeFile(mpath, canonicalContent(manifest));
}
test('staged verifier quantifies real shortfall and preserves fixture and completeness labels', async (t) => {
  const { directory } = await candidate(t); const verify = await verifier();
  const report = await verify({ artifacts: directory, ...options });
  assert.equal(report.status, 'shortfall'); assert.equal(report.targetMet, false);
  assert.equal(report.actual.distinctConfigurations, 2); assert.equal(report.shortfall, 10000);
  assert.equal(report.manifest.path, join(directory, 'manifest.json'));
  assert.equal(report.manifest.sha256, contentChecksum(await readFile(report.manifest.path)));
  assert.equal(report.qualification, 'bounded-fixture-or-partial-corpus');
  assert.equal(report.actual.completeness.selectedOptions.unknown, 2);
  assert.equal(report.actual.coverage.markets.US, 2);
  const small = await verify({ artifacts: directory, requiredDistinct: 2, ...options });
  assert.equal(small.status, 'shortfall'); assert.equal(small.targetMet, false);
  assert.equal(small.actual.completeResolvedDistinct, 0);
  assert.equal(small.storyAcceptance, 'not-established');
});
test('source-backed row retains technical unknowns and exact complete selection without claiming VIN coverage', async (t) => {
  const { directory } = await candidate(t, await sourceBackedInput());
  const report = await (await verifier())({ artifacts: directory, requiredDistinct: 1, ...options });
  assert.equal(report.status, 'verified-staged'); assert.equal(report.actual.completeResolvedDistinct, 1);
  assert.deepEqual(report.actual.coverage.wmis, {}); assert.equal(report.actual.coverage.steering.unknown, 1);
  assert.ok(report.limitations.includes('Compatible profile-family coverage is not inferred from configuration IDs or VIN spelling.'));
});
test('semantic duplicates, canonical aliases and checksums fail through whole-corpus validation', async (t) => {
  for (const variant of ['duplicate', 'alias', 'hash', 'accessory']) {
    const { directory } = await candidate(t);
    if (variant === 'hash') await writeFile(join(directory, 'images.jsonl'), '\n');
    else await edit(directory, (rows) => {
      if (variant === 'duplicate') rows.push(structuredClone(rows[0]));
      if (variant === 'alias') rows[0].configurationId = Buffer.from('REF1:OTHER').toString('base64');
      if (variant === 'accessory') {
        rows[0].canonicalIdentity.factoryOptionCodes = ['SE000001'];
        rows[0].canonicalSignature = 'REF1:SE000001'; rows[0].configurationId = Buffer.from(rows[0].canonicalSignature).toString('base64');
      }
    });
    const report = await (await verifier())({ artifacts: directory, ...options });
    assert.equal(report.status, 'invalid-staged', variant); assert.equal(report.targetMet, false); assert.equal(report.actual, null);
  }
});
test('missing paths and invalid targets fail without changing adjacent active selection', async (t) => {
  const { root } = await candidate(t); const active = join(root, 'active.json'); await writeFile(active, 'previous-active');
  const before = await readdir(root);
  for (const input of [{ artifacts: join(root, 'absent') }, { artifacts: 'relative' }, { artifacts: root, requiredDistinct: 0 }]) {
    const report = await (await verifier())({ ...input, ...options }); assert.equal(report.status, 'invalid-staged');
  }
  assert.equal(await readFile(active, 'utf8'), 'previous-active'); assert.deepEqual(await readdir(root), before);
});
test('offline CLI reports exact staged path and exits nonzero for shortfall; config without staged destination fails clearly', async (t) => {
  const { root, directory } = await candidate(t, await sourceBackedInput()); const config = join(root, 'plan.json'); await writeFile(config, '{}');
  const run = (...args) => spawnSync(process.execPath, [moduleUrl.pathname, ...args], { encoding: 'utf8', env: process.env, timeout: 10000 });
  const args = ['--config', config, '--staged', '--artifacts', directory, '--run-id', options.policyRead.runId, '--as-of', options.policyRead.asOf];
  const short = run(...args, '--require-distinct', '10000'); assert.equal(short.status, 1); const report = JSON.parse(short.stdout);
  assert.equal(report.manifest.path, join(directory, 'manifest.json')); assert.equal(report.shortfall, 9999);
  assert.equal(run(...args, '--require-distinct', '1').status, 0);
  const missing = run('--config', config, '--staged'); assert.equal(missing.status, 2); assert.equal(JSON.parse(missing.stdout).reason.code, 'staged-destination-required');
  assert.equal(run(...args, '--active').status, 2);
});

test('mixed reference and complete source records cannot pad the complete target', async (t) => {
  const source = await sourceBackedInput(); const reference = await corpusInput();
  source.configurations.push(...reference.configurations);
  source.metadata.sourceContexts.push(...reference.metadata.sourceContexts);
  const { directory } = await candidate(t, source);
  const report = await (await verifier())({ artifacts: directory, requiredDistinct: 2, ...options });
  assert.equal(report.status, 'shortfall'); assert.equal(report.actual.distinctConfigurations, 2);
  assert.equal(report.actual.completeResolvedDistinct, 1); assert.equal(report.shortfall, 1);
});
