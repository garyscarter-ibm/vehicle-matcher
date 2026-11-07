/** Offline preparation checks; the finite collector fixture is synthetic and grants no source capacity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createFleetCollector } from '../../../../../scripts/gcsp/collect-fleet.mjs';
import { validateBmwBatchPlan } from '../../../../../scripts/gcsp/bmw-public-registration.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

const base = dirname(fileURLToPath(import.meta.url)); const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (path) => JSON.parse(readFileSync(path, 'utf8')); const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const plan = read(join(base, 'collection-plan.json')); const allocation = read(join(base, 'execution-plan.json'));
const provenance = read(join(base, 'candidate-provenance.json')); const prior = read(join(base, 'prior-canonical-index.json')); const spent = read(join(base, 'spent-request-index.json'));
const unspent = ['execution-once.json', 'collector-checkpoint.json', 'collector-state.json', 'tree.json', 'options.json', 'source-events.jsonl', 'receipt.json'];

test('existing strict batch validator accepts exactly eight pinned F70 requests and twelve GETs', () => {
  assert.deepEqual(validateBmwBatchPlan(plan), plan); assert.equal(plan.source.version, 'f59-batch-20261107.v1');
  assert.deepEqual([plan.modelRegistration.modelCode, plan.modelRegistration.agModelCode, plan.modelRegistration.optionsTrim], ['1F7B', '82GE', 'S0337']);
  assert.deepEqual(plan.modelRegistration.aliases, ['1']); assert.equal(plan.candidateCount, 8); assert.equal(plan.target, 8);
  assert.equal(plan.limits.sourceAttempts, 12); assert.deepEqual(plan.limits.requestBudgets, { page: 1, settings: 1, discover: 1, options: 1, solve: 8 });
  assert.equal(allocation.attempts, 12); assert.equal(allocation.solverAllowance, 8); assert.equal(allocation.sourceCapacityCreditBeforeExecution, 0);
});

test('all candidate codes and types come from actual retained typed definitions', () => {
  assert.equal(sha(join(root, provenance.actualOptionsPath)), provenance.actualOptionsSha256);
  const options = read(join(root, provenance.actualOptionsPath)); const rows = options.report.candidates[0].definitions;
  assert.equal(options.observation.responseSha256, provenance.actualOptionsResponseSha256);
  for (const row of provenance.definitions) {
    const index = Number(row.retainedPointer.split('/').at(-1)); const source = rows[index];
    assert.equal(source.code, row.code); assert.equal(source.option, row.code); assert.equal(source.optionType, row.type); assert.equal(source.pointer, row.sourcePointer);
  }
  const used = new Set(spent.entries.map((row) => row.requestDigest)); const planned = new Set();
  for (const candidate of plan.candidates) {
    const digest = inputDigest({ modelRegistration: plan.modelRegistration, request: candidate.request });
    assert.equal(used.has(digest), false); assert.equal(planned.has(digest), false); planned.add(digest);
    assert.equal(provenance.candidates.find((row) => row.candidateId === candidate.candidateId).requestDigest, digest);
    for (const type of ['paint', 'fabric', 'rim']) assert.equal(candidate.request.includedElements.filter((code) => rows.find((row) => row.code === code)?.optionType === type).length, 1);
    assert.deepEqual(candidate.request.mandatoryElements, ['S0337']); assert.equal(candidate.request.includedElements.length, 4);
  }
  assert.equal(planned.size, 8); assert.equal(prior.entries.length, 344); assert.equal(spent.entries.length, 407);
  assert.equal(provenance.priorAdmittedSourceConfigurations, 341);
});

test('existing collector processes this exact registration and eight finite fixture candidates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'f70-first8-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const context = read(join(root, provenance.fullContextPath)); const facts = context.report.nodes[0].facts;
  const sourceOptions = read(join(root, provenance.actualOptionsPath)).report.candidates[0].definitions;
  const definitions = Object.fromEntries(sourceOptions.map((row) => [row.code, { option: row.option, optionType: row.optionType,
    ...(Object.hasOwn(row, 'longDescription') ? { phrases: { longDescription: row.longDescription } } : {}) }]));
  const calls = [];
  const collector = await createFleetCollector({ plan, source: plan.source, mode: 'source-fixture', statePath: join(directory, 'primary.json'),
    policyService: new PolicyService({ provider: new FilePolicyProvider() }), now: () => Date.parse('2026-11-07T02:00:00Z'),
    batchBinding: { producerPins: allocation.producerPins, snapshotVersion: allocation.snapshotVersion, existingConfigurationIds: prior.entries.map((row) => row.configurationId) },
    http: { kind: 'fixture', fetch: async (url) => {
      calls.push(url);
      if (url.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
      if (url.includes('/settings.')) return Response.json({ APP: { backend: { settingsVehicleTree: { 'x-api-key': 'fixture-tree-private' }, settingsLocalisation: { 'x-api-key': 'fixture-options-private' }, settingsRuleSolver: { 'x-api-key': 'fixture-solver-private' } } } });
      if (url.includes('/vehicle-trees/')) return Response.json({ 1: { modelRanges: { F70: { models: { '1F7B': facts } } } } });
      if (url.includes('/options/')) return Response.json(definitions);
      if (url.includes('/rulesolver/')) {
        const codes = new URL(url).searchParams.get('included-elements').split(',');
        return Response.json({ constructible: true, configuration: { modelCode: '1F7B', elements: Object.fromEntries(codes.map((code) => [code, { code, type: 'option' }])) } });
      }
      throw new Error('unexpected-fixture-route');
    } } });
  const result = await collector.run(); assert.equal(result.reason, 'queue-exhausted'); assert.equal(result.records.length, 8);
  assert.equal(result.accepted.length, 0); assert.equal(result.rejected.length, 0); assert.equal(result.duplicates.length, 0);
  assert.equal(result.counts.httpAttempts, 12); assert.equal(result.counts.operations.solve, 8); assert.equal(calls.length, 12);
  assert.equal(new Set(result.records.map((row) => row.configurationId)).size, 8); assert.equal(result.admission, false);
});

test('all code/input pins, cumulative indexes, retention and reservations agree', () => {
  assert.equal(inputDigest(plan), allocation.planDigest); assert.equal(inputDigest(prior), allocation.priorIndexDigest); assert.equal(inputDigest(spent), allocation.spentIndexDigest);
  for (const [path, expected] of Object.entries(allocation.codePins)) assert.equal(sha(join(root, path)), expected, path);
  for (const item of provenance.cumulativeIndexInputs) assert.equal(sha(join(base, item.retainedCopy)), item.sha256);
  const reservation = read(join(base, 'execution-reservation.json')); assert.equal(reservation.status, 'prepared-unspent-no-traffic-grant');
  assert.equal(reservation.executionPlanSha256, sha(join(base, 'execution-plan.json'))); assert.equal(reservation.planDigest, allocation.planDigest);
  assert.equal(allocation.retainedDeliverables.primary, join(base, 'collector-checkpoint.json'));
  assert.equal(allocation.retainedDeliverables.disposable, false); assert.equal(allocation.retainedDeliverables.exportBeforeScratchCleanup, true);
  assert.deepEqual(allocation.resources, { workers: 1, retries: 0, scratchBytes: 67108864, hostRamBytes: 536870912, childRamBytes: 469762048 });
  assert.equal(allocation.sourceDeadlineSeconds, 90); assert.equal(allocation.supervisorChildSeconds, 105); assert.equal(allocation.supervisorChunkSeconds, 120);
  for (const name of unspent) assert.equal(existsSync(join(base, name)), false, name);
});

test('Python and Node preparation scripts parse', () => {
  const py = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(),filename=p) for p in sys.argv[1:]]', join(base, 'prepare.py'), join(base, 'supervise.py')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(py.status, 0, py.stderr);
  const js = spawnSync(process.execPath, ['--check', join(base, 'run-live.mjs')], { encoding: 'utf8', timeout: 10000 }); assert.equal(js.status, 0, js.stderr);
});

test('runner and supervisor refuse absent grants before marker, primary or fetch', () => {
  const env = { ...process.env }; delete env.F70_FIRST8_SOURCE_GRANT;
  const tripwire = 'data:text/javascript,globalThis.fetch=async()=>{process.stderr.write("FORBIDDEN_FETCH_REACHED");throw new Error("forbidden-offline-fetch")};';
  const node = spawnSync(process.execPath, ['--import', tripwire, join(base, 'run-live.mjs')], { encoding: 'utf8', env, timeout: 10000, maxBuffer: 65536 });
  assert.equal(node.status, 1, node.stderr); assert.match(node.stderr, /explicit-root-traffic-grant-required/); assert.doesNotMatch(node.stderr + node.stdout, /FORBIDDEN_FETCH_REACHED/);
  const py = spawnSync('/usr/bin/python3', ['-I', '-B', join(base, 'supervise.py'), 'live'], { encoding: 'utf8', env, timeout: 10000, maxBuffer: 65536 });
  assert.equal(py.status, 1, py.stderr); assert.match(py.stderr, /explicit-root-traffic-grant-required/);
  for (const name of unspent) assert.equal(existsSync(join(base, name)), false, name); assert.equal(existsSync(allocation.scratchRoot), false);
});
