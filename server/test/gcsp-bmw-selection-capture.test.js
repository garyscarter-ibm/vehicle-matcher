import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createBmwSelectionCapture, publicBmwCompleteSelectionOperations } from '../../scripts/gcsp/capture-bmw-selection.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const snapshot = JSON.parse(await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url), 'utf8'));
const originalPlan = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq59/source-executor-2026-11-06/collection-plan.json', import.meta.url), 'utf8'));
const seed = ['FKSFU', 'P0300', 'S0337', 'S043L'];
const fixture = () => {
  const plan = { ...structuredClone(originalPlan), captureVersion: 'bmw-complete-selection.v1', qualificationDate: '2026-11-06' };
  const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const tree = Object.fromEntries(['5', 'I'].map((group) => [group, { modelRanges: { G61E: { models: { T5MJ: structuredClone(model) } } } }]));
  const elements = Object.fromEntries([...snapshot.selectedOptions, 'SE000001'].sort().map((code) => [code, { code, type: code === 'SE000001' ? 'accessory' : 'option' }]));
  const solver = { constructible: true, configuration: { modelCode: 'T5MJ', elements }, configurationChanges: {
    addedElements: Object.fromEntries(Object.entries(elements).filter(([code]) => !seed.includes(code))) }, configurationState: 'opaque-not-retained' };
  const settings = { APP: { backend: { settingsVehicleTree: { 'x-api-key': 'fixture-tree-header' }, settingsRuleSolver: { 'x-api-key': 'fixture-solver-header' } } } };
  return { plan, tree, solver, settings };
};
async function runFixture(change = () => {}, action = async (capture) => capture.run()) {
  const f = fixture(); change(f); const root = await mkdtemp(join(tmpdir(), 'bmw-selection-capture-')); const requests = [];
  const transport = async (url) => {
    requests.push(url);
    const value = url.includes('settings.') ? f.settings : url.includes('/vehicle-trees/') ? f.tree : f.solver;
    return url.includes('/configure/') ? new Response('<script src="settings.fixture.json"></script>', { headers: { 'content-type': 'text/html' } })
      : new Response(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const options = { plan: f.plan, statePath: join(root, 'session.json'), http: { kind: 'fixture', fetch: transport }, now: () => Date.parse('2026-11-06T23:00:00.000Z') };
    const capture = await createBmwSelectionCapture(options);
    return { result: await action(capture, options, requests), requests, f };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('complete solver capture retains actual typed selection, changes, hashes and unknown quantity without admission', async () => {
  const { result, requests, f } = await runFixture();
  assert.equal(result.status, 'observed'); assert.equal(result.admission, false); assert.deepEqual(result.accepted, []);
  assert.equal(requests.length, 4); assert.equal(result.counts.httpAttempts, 4);
  const { tree, solver } = result.capture; const report = solver.document.report;
  assert.equal(Object.keys(report.configuration.elements).length, 48);
  assert.equal(report.configurationChanges.state, 'present');
  assert.equal(Object.keys(report.configurationChanges.maps.addedElements).length, 44);
  assert.equal(report.accessories[0].code, 'SE000001');
  assert.deepEqual(report.accessories[0].quantity, { state: 'unknown', value: null, reason: 'quantity-not-exposed' });
  assert.deepEqual(report.derivedChanges.ignored, { state: 'unknown', codes: null });
  assert.equal(JSON.stringify(result).includes('opaque-not-retained'), false);
  assert.equal(JSON.stringify(result).includes('fixture-solver-header'), false);
  assert.equal(solver.document.observation.responseSha256, sha(JSON.stringify(f.solver)));
  assert.equal(solver.document.rawSelectionSha256, sha(JSON.stringify(report) + '\n'));
  assert.equal(solver.sha256, sha(JSON.stringify(solver.document) + '\n'));
  assert.equal(solver.document.requestSha256, sha(JSON.stringify(solver.document.observation.request) + '\n'));
  assert.notEqual(solver.sha256, solver.document.observation.responseSha256);
  assert.equal(tree.document.report.nodes.length, 2);
  assert.equal(tree.document.report.nodes[0].facts.effectDate, '2027-01-05');
  assert.equal(tree.document.observation.request.url.includes('/effect-dates/2026-11-01/'), true);
  assert.equal(Object.hasOwn(report.configuration, 'effectDate'), false);
});

test('capture construction is passive and completed observation resumes without a source request', async () => {
  const { result, requests } = await runFixture(() => {}, async (capture, options, calls) => {
    assert.equal(calls.length, 0); const first = await capture.run();
    const second = await (await createBmwSelectionCapture(options)).run(); assert.deepEqual(second, first); return second;
  });
  assert.equal(requests.length, 4); assert.equal(result.status, 'observed');
});

test('fresh alias, selection and provider change drift stop within the same finite source allocation', async () => {
  for (const [mutate, reason, attempts] of [
    [(f) => { f.tree.I.modelRanges.G61E.models.T5MJ.effectDate = '2027-01-06'; }, 'source-model-substitution', 3],
    [(f) => { delete f.tree.I; }, 'source-full-model-missing', 3],
    [(f) => { f.solver.configuration.elements.S0999 = { code: 'S0999', type: 'option' }; }, 'source-selection-changed', 4],
    [(f) => { f.solver.configurationChanges.addedElements = {}; }, 'capture-change-membership', 4],
    [(f) => { f.solver.configurationChanges.addedElements.S0230 = { code: 'S0230', type: 'accessory' }; }, 'capture-change-membership', 4],
    [(f) => { f.solver.configurationChanges.opaque = { unsafe: 'not-retained' }; }, 'capture-change-shape', 4],
    [(f) => { f.solver.configuration.elements.SE000001.quantity = 0; }, 'capture-element-shape', 4],
  ]) {
    const { result, requests } = await runFixture(mutate);
    assert.equal(result.status, 'incomplete'); assert.equal(result.reason, reason); assert.equal(result.capture, null);
    assert.equal(requests.length, attempts); assert.deepEqual(result.accepted, []);
  }
});

test('capture opts into fatal UTF-8 and escaped duplicate-key refusal on public JSON', async () => {
  for (const [mutate, reason] of [
    [(f) => { f.solver = JSON.stringify(f.solver).replace('"constructible":true', '"constructible":true,"construct\\u0069ble":true'); }, 'source-json-duplicate-key'],
    [(f) => { f.solver = new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]); }, 'source-json-utf8'],
  ]) { const { result, requests } = await runFixture(mutate); assert.equal(result.reason, reason); assert.equal(requests.length, 4); }
});

test('source projection rejects caller-forged observation metadata before retaining a tree', async () => {
  const f = fixture(); const operations = publicBmwCompleteSelectionOperations(f.plan);
  assert.throws(() => operations.discover.project(f.tree, {}, { operation: 'discover' }), { code: 'source-observation-metadata' });
});
