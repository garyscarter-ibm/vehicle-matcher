import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { projectModelContext } from './model-context-projection.mjs';

const target = { modelCode: 'T5MJ', agModelCode: '72HH' };
const at = (projection, path) => projection.nodes.find(node => JSON.stringify(node.path) === JSON.stringify(path));

test('retains parent steering when a shorter matching cross-reference omits it', () => {
  const tree = { models: [{ ...target, steering: 'RL', reference: { ...target } }] };
  const result = projectModelContext(tree, target);
  assert.ok(at(result, ['models', '0']), 'parent model facts must be retained');
  assert.equal(at(result, ['models', '0']).facts.steering, 'RL');
  assert.deepEqual(at(result, ['models', '0', 'reference']).parentPath, ['models', '0']);
  assert.equal(at(result, ['models', '0', 'reference']).facts.steering, undefined);
  assert.equal(result.sameObjectObservations.find(item => item.path.length === 2).context.steering, 'RL');
});

test('records an AG ancestor relation without inventing a same-object binding', () => {
  const result = projectModelContext({ agModelCode: '72HH', steering: 'RL', models: { T5MJ: {} } }, target);
  assert.deepEqual(result.matches.model[0].path, ['models', 'T5MJ']);
  assert.equal(result.matches.model[0].via, 'key');
  assert.equal(result.relations[0].relation, 'ag-ancestor-of-model');
  assert.deepEqual(result.relations[0].commonAncestor, []);
  assert.deepEqual(result.sameObjectObservations, []);
  assert.equal(at(result, []).facts.steering, 'RL');
});

test('keeps unrelated left steering separate from target same-object observation', () => {
  const result = projectModelContext({ models: [{ ...target, steering: 'RL' }, { modelCode: 'OTHER', steering: 'LL' }] }, target);
  assert.equal(at(result, ['models', '1']).facts.steering, 'LL');
  assert.equal(result.sameObjectObservations.length, 1);
  assert.equal(result.sameObjectObservations[0].context.steering, 'RL');
  assert.deepEqual(result.sameObjectObservations[0].path, ['models', '0']);
});

test('projects validated allowlisted facts and omits arbitrary values and unsafe path segments', () => {
  const result = projectModelContext({
    'https://private.invalid/DO_NOT_RETAIN_PATH': {
      ...target, steering: 'RL', orderDate: '2026-11-01', effectDate: '2027-01-05', country: 'GB',
      cookie: 'DO_NOT_RETAIN_COOKIE', serial: 'DO_NOT_RETAIN_SERIAL', modelName: 'DO_NOT_RETAIN_NAME',
      locale: 'https://private.invalid/DO_NOT_RETAIN_VALUE', modelRange: 'DO_NOT_RETAIN_LONG_VALUE',
    },
  }, { ...target, cookie: 'DO_NOT_RETAIN_TARGET' });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('DO_NOT_RETAIN'), false);
  assert.equal(serialized.includes('https:'), false);
  assert.equal(result.omittedPathSegments, 1);
  assert.deepEqual(result.sameObjectObservations[0].context, { country: 'GB', effectDate: '2027-01-05', orderDate: '2026-11-01', steering: 'RL' });
});

test('retains an unknown steering literal without translating it to RHD', () => {
  const result = projectModelContext({ ...target, steering: 'XX' }, target);
  assert.equal(result.sameObjectObservations[0].context.steering, 'XX');
  assert.equal(JSON.stringify(result).includes('RHD'), false);
});

test('refuses contradictory direct identity rather than binding an alias to a different model', () => {
  assert.throws(() => projectModelContext({ modelCode: 'OTHER', code: 'T5MJ', agModelCode: '72HH', steering: 'RL' }, target), /projection-conflicting-identity/);
  assert.throws(() => projectModelContext({ T5MJ: { modelCode: 'OTHER', agModelCode: '72HH' } }, target), /projection-conflicting-identity/);
});

test('refuses conflicting case variants instead of overwriting a steering fact', () => {
  assert.throws(() => projectModelContext({ ...target, steering: 'RL', Steering: 'LL' }, target), /projection-ambiguous-field/);
});

test('rejects unbounded traversal, depth and fact output with safe errors', () => {
  assert.throws(() => projectModelContext({ ...target, steering: 'RL' }, target, { maxFacts: 2 }), /projection-fact-limit/);
  assert.throws(() => projectModelContext({ nested: { ...target } }, target, { maxNodes: 1 }), /projection-node-limit/);
  assert.throws(() => projectModelContext({ nested: { ...target } }, target, { maxDepth: 0 }), /projection-depth-limit/);
});

test('retained historical model remains dated historical evidence with literal RL', async () => {
  const prior = JSON.parse(await readFile(new URL('../../../fucq-4/observations-2026-11-01.json', import.meta.url), 'utf8'));
  const result = projectModelContext({ model: prior.model }, target);
  assert.equal(result.sameObjectObservations.length, 1);
  assert.deepEqual(result.sameObjectObservations[0].path, ['model']);
  assert.equal(result.sameObjectObservations[0].context.steering, 'RL');
  assert.equal(result.sameObjectObservations[0].context.effectDate, '2027-01-05');
  assert.equal(result.sameObjectObservations[0].context.orderDate, '2026-11-01');
});
