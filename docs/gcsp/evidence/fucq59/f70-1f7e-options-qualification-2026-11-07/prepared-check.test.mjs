/** Offline safety checks only. Missing grants and a fetch tripwire prevent source traffic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validatePublicBmwOptionsPlan } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const allocation = read(join(base, 'execution-plan.json')); const plan = read(join(base, 'qualification-plan.json'));
const unspent = ['execution-once.json', 'collector-checkpoint.json', 'collector-state.json', 'tree.json', 'options.json', 'trim-relationships.json', 'source-events.jsonl', 'receipt.json'];

test('actual strict plan allows four GETs and no candidates or solver', () => {
  assert.deepEqual(validatePublicBmwOptionsPlan(plan), plan);
  assert.equal(plan.source.version, 'f59-options-qualification-20261107.v1');
  assert.equal(plan.modelRegistration.modelCode, '1F7E'); assert.equal(plan.modelRegistration.agModelCode, '82GE');
  assert.deepEqual(plan.modelRegistration.aliases, ['1']); assert.equal(plan.modelRegistration.optionsTrim, 'S033B');
  assert.equal(plan.limits.sourceAttempts, 4); assert.deepEqual(plan.limits.requestBudgets, { page: 1, settings: 1, discover: 1, options: 1 });
  assert.deepEqual(allocation.requestSequence, ['page', 'settings', 'discover', 'options']);
  assert.equal(allocation.attempts, 4); assert.equal(allocation.optionsAllowance, 1); assert.equal(allocation.solverAllowance, 0); assert.equal(allocation.candidateAllowance, 0);
  assert.equal(allocation.sourceCapacityCredit, 0); assert.equal(allocation.acceptance, false);
});

test('actual full model and line facts share the exact retained raw response identity', () => {
  const p = read(join(base, 'source-relationship-provenance.json'));
  for (const [path, expected] of [[p.fullContext, p.fullContextSha256], [p.lineDiagnostic, p.lineDiagnosticSha256], [p.lineDiagnosticContext, p.lineDiagnosticContextSha256]]) assert.equal(sha(join(root, path)), expected);
  const full = read(join(root, p.fullContext)); const diagnostic = read(join(root, p.lineDiagnosticContext));
  assert.equal(full.observation.responseSha256, p.sharedRawTreeResponseSha256); assert.equal(diagnostic.observation.responseSha256, p.sharedRawTreeResponseSha256);
  assert.equal(full.report.nodes[0].facts.modelCode, '1F7E'); assert.equal(full.report.nodes[0].facts.agModelCode, '82GE');
  const rows = new Map(read(join(root, p.lineDiagnostic)).rows.map((row) => [row.pointer, row]));
  for (const [pointer, value] of Object.entries(p.explicitSourceRelationships)) assert.equal(rows.get(pointer).value, value);
  assert.equal(rows.get(p.includedTrimElementPointer).type, 'object');
  assert.match(p.elementTypes, /Unobserved; no prefix-based classification/);
  assert.deepEqual(allocation.actualSourceBasis, p);
});

test('frozen pins, reservation, first-write retention and bounded supervisor allocation agree', () => {
  assert.equal(inputDigest(plan), allocation.planDigest); assert.equal(allocation.codeCommit, '924e8baecf31039373b500a9e2547b84d81cfee8');
  for (const [path, expected] of Object.entries(allocation.codePins)) assert.equal(sha(join(root, path)), expected, path);
  assert.equal(sha(join(base, 'prepare.py')), allocation.preparerSha256);
  const reservation = read(join(base, 'execution-reservation.json'));
  assert.equal(reservation.status, 'prepared-unspent-no-traffic-grant'); assert.equal(reservation.allocationId, allocation.id);
  assert.equal(reservation.planDigest, allocation.planDigest); assert.equal(reservation.executionPlanSha256, sha(join(base, 'execution-plan.json')));
  assert.equal(reservation.exclusiveMarkerCreatedOnlyByLiveRunner, join(base, 'execution-once.json'));
  assert.deepEqual(allocation.resources, { workers: 1, retries: 0, scratchBytes: 67108864, hostRamBytes: 536870912, childRamBytes: 469762048 });
  assert.equal(allocation.sourceDeadlineSeconds, 90); assert.equal(allocation.supervisorChildSeconds, 105); assert.equal(allocation.supervisorChunkSeconds, 120);
  const retention = read(join(base, 'retained-deliverables.json'));
  assert.equal(retention.disposable, false); assert.equal(retention.retainOnInterruption, true); assert.equal(retention.exportBeforeScratchCleanup, true);
  assert.equal(retention.primary, join(base, 'collector-checkpoint.json')); assert.deepEqual(retention.embeddedArtifacts, ['contextObservation', 'trimRelationships', 'optionsObservation']);
  for (const name of unspent) assert.equal(existsSync(join(base, name)), false, name);
});

test('prepared Python and Node scripts parse without source execution', () => {
  const python = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in sys.argv[1:]]', join(base, 'prepare.py'), join(base, 'supervise.py')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(python.status, 0, python.stderr);
  const node = spawnSync(process.execPath, ['--check', join(base, 'run-live.mjs')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(node.status, 0, node.stderr);
});

test('runner without a grant refuses before marker, primary or fetch', () => {
  const env = { ...process.env }; delete env.F70_OPTIONS_SOURCE_GRANT;
  const tripwire = 'data:text/javascript,globalThis.fetch=async()=>{process.stderr.write("FORBIDDEN_FETCH_REACHED");throw new Error("forbidden-offline-fetch")};';
  const child = spawnSync(process.execPath, ['--import', tripwire, join(base, 'run-live.mjs')], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env });
  assert.equal(child.status, 1, child.stderr); assert.match(child.stderr, /explicit-root-traffic-grant-required/);
  assert.doesNotMatch(child.stderr + child.stdout, /FORBIDDEN_FETCH_REACHED/);
  for (const name of unspent) assert.equal(existsSync(join(base, name)), false, name);
});

test('supervisor without a grant refuses before resource allocation or runner invocation', () => {
  const env = { ...process.env }; delete env.F70_OPTIONS_SOURCE_GRANT;
  const child = spawnSync('/usr/bin/python3', ['-I', '-B', join(base, 'supervise.py'), 'live'], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env });
  assert.equal(child.status, 1, child.stderr); assert.match(child.stderr, /explicit-root-traffic-grant-required/);
  assert.equal(existsSync(allocation.scratchRoot), false);
  for (const name of unspent) assert.equal(existsSync(join(base, name)), false, name);
});
