/** Offline prepared-plan safety checks; source grant is absent and fetch is a tripwire. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validatePublicBmwContextPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const manifest = read(join(base, 'stage1-plan.json'));
const unspentFiles = ['execution-once.json', 'collector-checkpoint.json', 'collector-state.json', 'tree.json', 'source-events.jsonl', 'receipt.json'];

test('frozen manifest has exactly six historical contexts and only eighteen GETs', () => {
  assert.equal(inputDigest(manifest), 'ce14282252e10dbadedb6f7afcc69ba142947215c5b390fc485e124dd365725b');
  assert.deepEqual(manifest.contexts.map((row) => [row.modelCode, row.agModelCode]),
    [['1F7A', '82GE'], ['1F7B', '82GE'], ['1F7C', '22GE'], ['1F7D', '62GE'], ['1F7E', '82GE'], ['1F7F', '62GE']]);
  assert.equal(manifest.totalGetCeiling, 18); assert.equal(manifest.workers, 1); assert.equal(manifest.retries, 0);
  assert.equal(manifest.optionsRequests, 0); assert.equal(manifest.solverRequests, 0); assert.equal(manifest.newConfigurationTarget, 0);
  assert.deepEqual(manifest.reservedButUnallocated, { options: 6, solver: 48 });
  assert.equal(sha(join(base, 'prepare.py')), manifest.preparerSha256);
});

for (const row of manifest.contexts) {
  test(`${row.context}: real validator, provenance, allocation and every frozen pin agree`, () => {
    const directory = join(base, row.context);
    const plan = read(join(directory, 'qualification-plan.json'));
    const allocation = read(join(directory, 'execution-plan.json'));
    const reservation = read(join(directory, 'execution-reservation.json'));
    const provenance = read(join(directory, 'candidate-provenance.json'));
    assert.deepEqual(validatePublicBmwContextPlan(plan), plan);
    assert.equal(inputDigest(plan), row.planDigest); assert.equal(allocation.planDigest, row.planDigest);
    assert.equal(sha(join(directory, 'execution-plan.json')), row.allocationSha256);
    assert.equal(allocation.codeCommit, '03f04ec812b0e8c6aa97850c2595173b6fa850d5');
    assert.equal(allocation.attempts, 3); assert.equal(allocation.solverAllowance, 0); assert.equal(allocation.optionsAllowance, 0);
    assert.equal(allocation.sourceCapacityCredit, 0); assert.equal(allocation.acceptance, false);
    assert.deepEqual(allocation.resources, { workers: 1, scratchBytes: 67108864, hostRamBytes: 536870912, childRamBytes: 469762048, expectedRetainedBytes: 1048576 });
    assert.equal(allocation.sourceDeadlineSeconds, 90); assert.equal(allocation.supervisorChildSeconds, 105); assert.equal(allocation.supervisorChunkSeconds, 120);
    for (const [path, expected] of Object.entries(allocation.codePins)) assert.equal(sha(join(root, path)), expected, path);
    for (const [path, expected] of Object.entries(manifest.codePins)) assert.equal(allocation.codePins[path], expected, path);
    assert.equal(sha(join(root, provenance.historicalCandidateSource)), provenance.sourceSha256);
    assert.deepEqual(provenance.optionsTrim, { state: 'unknown', value: null });
    assert.equal(reservation.allocationId, allocation.id); assert.equal(reservation.planDigest, row.planDigest);
    assert.equal(reservation.status, 'prepared-unspent-no-traffic-grant');
    for (const name of unspentFiles) assert.equal(existsSync(join(directory, name)), false, name);
  });
}

test('prepared Python supervisors parse without execution and runner parses without source', () => {
  const python = spawnSync('/usr/bin/python3', ['-I', '-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in sys.argv[1:]]', join(base, 'prepare.py'), join(base, 'supervise.py')], { encoding: 'utf8', timeout: 10000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(python.status, 0, python.stderr);
  const node = spawnSync(process.execPath, ['--check', join(base, 'run-live.mjs')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(node.status, 0, node.stderr);
});

for (const row of manifest.contexts) {
  test(`${row.context}: absent grant refuses before marker, retained primary or fetch`, () => {
    const env = { ...process.env }; delete env.F70_CONTEXT_SOURCE_GRANT;
    const tripwire = 'data:text/javascript,globalThis.fetch=async()=>{process.stderr.write("FORBIDDEN_FETCH_REACHED");throw new Error("forbidden-offline-fetch")};';
    const child = spawnSync(process.execPath, ['--import', tripwire, join(base, 'run-live.mjs'), row.context], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env });
    assert.equal(child.status, 1, child.stderr);
    assert.match(child.stderr, /explicit-root-traffic-grant-required/);
    assert.doesNotMatch(child.stderr + child.stdout, /FORBIDDEN_FETCH_REACHED/);
    for (const name of unspentFiles) assert.equal(existsSync(join(base, row.context, name)), false, name);
  });
}
