import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { writeCorpusCandidate } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { offlineFixture } from './helpers/offline-vehicle-fixture.js';
import { options } from './helpers/vin-corpus-fixture.js';
const moduleUrl = new URL('../../scripts/gcsp/verify-fleet.mjs', import.meta.url);
const verifier = async () => (await import(moduleUrl)).verifyActiveFleet;

test('active audit reconciles every real fixture record through consuming port and actual HTTP with zero egress', async (t) => {
  const f = await offlineFixture(t, { imageContracts: true }); const verify = await verifier();
  assert.equal(typeof verify, 'function', 'active verifier API exists');
  const report = await verify({ root: f.root, requiredDistinct: 1, endpoint: 'http://127.0.0.1:0', http: true, offline: true,
    concurrency: 2, sampleSize: 32, repository: f.repository, context: f.context,
    stockReferences: f.stock.map((row) => row.orderUuid), ...options, approvedImages: f.input.images });
  assert.equal(report.status, 'verified-active', JSON.stringify(report)); assert.equal(report.storyAcceptance, 'not-established');
  assert.equal(report.manifest.sha256, f.checked.manifestDigest); assert.equal(report.actual.completeResolvedDistinct, 1);
  assert.deepEqual(report.audit.records, { configurations: 6, vinMappings: 5, stockReferences: 5 });
  assert.equal(report.audit.scope, 'all-records'); assert.equal(report.audit.errors, 0); assert.equal(report.audit.checked, 16);
  assert.equal(report.http.requests, 16); assert.equal(report.http.errors, 0); assert.match(report.http.endpoint, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
  assert.equal(report.egress.externalCalls, 0); assert.equal(report.egress.sourceCalls, 0); assert.equal(report.egress.control, 'blocked');
  assert.equal(report.audit.latencyMs.count, 16); assert.ok(report.audit.latencyMs.p95 >= 0);
  assert.ok(report.audit.throughputPerSecond > 0); assert.equal(report.http.serverClosed, true);
});
test('active audit quantifies complete-source shortfall despite retained reference records', async (t) => {
  const f = await offlineFixture(t, { runtime: false }); const before = await readFile(join(f.root, 'active.json'), 'utf8');
  const report = await (await verifier())({ root: f.root, requiredDistinct: 10000, offline: true, ...options });
  assert.equal(report.status, 'shortfall'); assert.equal(report.shortfall, 9999); assert.equal(report.targetMet, false);
  assert.equal(report.audit.checked, 11); assert.equal(report.http, null);
  assert.equal(await readFile(join(f.root, 'active.json'), 'utf8'), before);
});
test('active verifier rejects absent stores and non-loopback endpoint before connecting', async (t) => {
  const f = await offlineFixture(t, { runtime: false }); const verify = await verifier();
  for (const input of [{ root: join(f.root, 'absent') }, { root: 'relative' },
    { root: f.root, http: true, endpoint: 'https://example.invalid/' }, { root: f.root, http: true },
    { root: f.root, concurrency: 1000 }, { root: f.root, sampleSize: 100000 }]) {
    const report = await verify({ ...input, offline: true, ...options }); assert.equal(report.status, 'invalid-active', JSON.stringify(input));
  }
});
test('real registry restart idempotent reload interrupted invalid activation and rollback retain exact identities', async (t) => {
  const f = await offlineFixture(t, { runtime: false }); const before = f.registry.status().active;
  const oldPointer = JSON.parse(await readFile(join(f.root, 'active.json')));
  assert.equal((await f.registry.publish(f.candidate)).idempotent, true);
  const version2 = join(f.scratch, 'candidate2'); const input = structuredClone(f.input); input.metadata.version = '2';
  assert.equal((await writeCorpusCandidate(version2, input, options)).status, 'ok');
  const interrupted = createSyntheticRegistry({ root: f.root, ...options, onPhase: async (phase) => { if (phase === 'staged') throw new Error('test interruption'); } });
  assert.equal((await interrupted.load()).status, 'ok'); assert.notEqual((await interrupted.publish(version2)).status, 'ok');
  assert.deepEqual(f.registry.status().active, before);
  await writeFile(join(version2, 'images.jsonl'), '\n'); assert.notEqual((await f.registry.publish(version2)).status, 'ok');
  const fresh = createSyntheticRegistry({ root: f.root, ...options }); assert.equal((await fresh.load()).status, 'ok'); assert.equal((await fresh.load()).status, 'ok');
  for (const row of f.configurations) assert.deepEqual(fresh.getConfiguration(row.configurationId), f.registry.getConfiguration(row.configurationId));
  for (const row of f.vins) assert.deepEqual(fresh.getVin(row.vin17), f.registry.getVin(row.vin17));
  await writeFile(join(f.root, 'active.json'), JSON.stringify({ schemaVersion: '1', selected: { directory: '0'.repeat(64), manifestDigest: '0'.repeat(64) }, previous: oldPointer.selected }));
  const restored = createSyntheticRegistry({ root: f.root, ...options }); const outcome = await restored.load(); assert.equal(outcome.recovered, true); assert.deepEqual(outcome.active, before);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {createSyntheticRegistry} from ${JSON.stringify(new URL('../gcsp/vehicle-evidence/synthetic-registry.js', import.meta.url).href)}; import {options} from ${JSON.stringify(new URL('./helpers/vin-corpus-fixture.js', import.meta.url).href)}; const registry=createSyntheticRegistry({root:${JSON.stringify(f.root)},...options}); await registry.load(); process.stdout.write(JSON.stringify(registry.status()));`], { encoding: 'utf8', timeout: 10000, env: process.env });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout).active, before);
  assert.ok(!(await readdir(f.root)).some((entry) => entry.startsWith('.stage-')));
});

test('active CLI binds only explicit loopback and reports actual manifest all-record scope and target result', async (t) => {
  const f = await offlineFixture(t, { runtime: false });
  const run = (required) => spawnSync(process.execPath, [moduleUrl.pathname, '--active', '--store', f.root, '--http', '--offline',
    '--endpoint', 'http://127.0.0.1:0', '--require-distinct', String(required), '--concurrency', '2', '--sample-size', '32',
    '--run-id', options.policyRead.runId, '--as-of', options.policyRead.asOf], { encoding: 'utf8', timeout: 15000, env: process.env });
  const small = run(1); assert.equal(small.status, 0, small.stdout + small.stderr); const report = JSON.parse(small.stdout);
  assert.equal(report.manifest.sha256, f.checked.manifestDigest); assert.equal(report.audit.checked, 11);
  assert.equal(report.http.requests, 11); assert.equal(report.http.serverClosed, true); assert.equal(report.egress.externalCalls, 0);
  const target = run(10000); assert.equal(target.status, 1, target.stderr); assert.equal(JSON.parse(target.stdout).shortfall, 9999);
});
