/** Narrow synthetic checks for the new evidence-only projection/caller; never live traffic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projectRangeShape, createRangeShapeDiagnostic } from './diagnostic-source.mjs';
const base = dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(await readFile(join(base, 'qualification-plan.json')));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
function tree() {
  return { 1: { modelRanges: { F70: { name: 'Source range label', models: {
    '1F7A': { modelCode: '1F7A', agModelCode: '82GE', modelRange: 'F70', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05',
      transmissionVariants: [{ name: 'Source variant label' }] },
    'OTHER': { modelName: 'excluded sibling label' },
  }, lines: { SOURCE_LINE: { name: 'Source line label', defaultModel: { modelCode: '1F7A', agModelCode: '82GE' },
    includedTransmissionVariants: [{ configuration: { modelCode: '1F7A', options: ['S0ABC'] }, wltpRanges: { secret: 'not relevant' } }] } } } } } };
}
async function fixture(t, mutate = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'f70-shape-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const source = tree(); mutate(source); const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url.includes('/configure/')) return new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } });
    if (url.includes('/settings.')) return Response.json({ APP: { backend: { settingsVehicleTree: { 'x-api-key': 'private-shape-fixture' } } } });
    if (url.includes('/vehicle-trees/')) return Response.json(source);
    throw new Error('prohibited-options-or-solver');
  };
  return { calls, statePath: join(directory, 'primary.json'), input: { plan, statePath: join(directory, 'primary.json'),
    http: { kind: 'fixture', fetch }, mode: 'source-fixture', now: () => Date.parse('2026-11-07T02:00:00Z') } };
}

test('model/range projection retains exact nested relationship and primitive labels without manufacturing trim', () => {
  const result = projectRangeShape(tree(), plan.modelRegistration); const encoded = JSON.stringify(result);
  const row = result.rows.find((entry) => entry.pointer.endsWith('/lines/SOURCE_LINE/defaultModel/modelCode'));
  assert.equal(row.value, '1F7A'); assert.ok(encoded.includes('Source variant label'));
  assert.ok(encoded.includes('Source line label')); assert.ok(encoded.includes('S0ABC'));
  assert.equal(result.rows.some((entry) => entry.pointer.includes('/models/OTHER/')), false);
  assert.equal(result.rows.some((entry) => entry.pointer.includes('/wltpRanges/')), false);
  assert.equal(result.rows.some((entry) => entry.pointer.endsWith('/trim')), false);
});

test('unrecognised scalar values, HTML/control strings and VIN-like values are omitted while types remain', () => {
  const source = tree(); const model = source[1].modelRanges.F70.models['1F7A'];
  Object.assign(model, { opaque: 'private arbitrary value', name: '<unsafe>', label: 'WBA12345678901234', title: 'bad\nlabel' });
  const encoded = JSON.stringify(projectRangeShape(source, plan.modelRegistration));
  for (const text of ['private arbitrary value', '<unsafe>', 'WBA12345678901234', 'bad\\nlabel']) assert.equal(encoded.includes(text), false);
  assert.ok(encoded.includes('/opaque')); assert.ok(encoded.includes('/name'));
});

test('common session makes exactly three fixture GETs, keeps headers private and resumes without traffic', async (t) => {
  const { input, calls, statePath } = await fixture(t); const result = await (await createRangeShapeDiagnostic(input)).run();
  assert.equal(result.reason, 'range-shape-observed'); assert.equal(calls.length, 3);
  assert.equal(result.admitted, 0); assert.equal(result.acceptance, false);
  assert.equal((await readFile(statePath, 'utf8')).includes('private-shape-fixture'), false);
  assert.deepEqual(await (await createRangeShapeDiagnostic(input)).run(), result); assert.equal(calls.length, 3);
  assert.equal(calls.some((url) => /options|rulesolver|S0337/.test(url)), false);
});

test('a fresh unregistered alias stops before retaining diagnostic relationships', async (t) => {
  const { input, calls } = await fixture(t, (source) => { source.I = structuredClone(source[1]); });
  const result = await (await createRangeShapeDiagnostic(input)).run();
  assert.equal(result.reason, 'source-model-alias-conflict'); assert.equal(calls.length, 3); assert.equal(result.rangeShape, null);
});

test('live runner without grant refuses before marker, primary or source call', async () => {
  const env = { ...process.env }; delete env.F70_RANGE_SHAPE_SOURCE_GRANT;
  const tripwire = 'data:text/javascript,globalThis.fetch=async()=>{process.stderr.write("FORBIDDEN_FETCH_REACHED");throw new Error("offline-fetch")};';
  const child = spawnSync(process.execPath, ['--import', tripwire, join(base, 'run-live.mjs')], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env });
  assert.equal(child.status, 1); assert.match(child.stderr, /explicit-root-traffic-grant-required/);
  assert.doesNotMatch(child.stderr + child.stdout, /FORBIDDEN_FETCH_REACHED/);
  for (const name of ['execution-once.json', 'collector-checkpoint.json', 'source-events.jsonl']) {
    await assert.rejects(readFile(join(base, name)), { code: 'ENOENT' });
  }
});

test('frozen plan and code pins agree, with Python syntax checked without executing the supervisor', async () => {
  const allocation = JSON.parse(await readFile(join(base, 'execution-plan.json')));
  for (const [path, expected] of Object.entries(allocation.codePins)) {
    assert.equal(createHash('sha256').update(await readFile(join(root, path))).digest('hex'), expected, path);
  }
  assert.equal(allocation.attempts, 3); assert.equal(allocation.optionsAllowance, 0); assert.equal(allocation.solverAllowance, 0);
  const python = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(),filename=p) for p in sys.argv[1:]]', join(base, 'prepare.py'), join(base, 'supervise.py')], { encoding: 'utf8', timeout: 10000 });
  assert.equal(python.status, 0, python.stderr);
});
