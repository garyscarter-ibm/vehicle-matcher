import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { selectFullModelRecord } from './full-model-selector.mjs';

const fixture = JSON.parse(await readFile(new URL('../../steering-diagnostic-2026-11-05/evidence/projection.json', import.meta.url), 'utf8'));
const expected = { modelCode: 'T5MJ', agModelCode: '72HH', catalogueRangeKey: 'G61E', modelRangeField: 'G61', orderDate: '2026-11-01', effectDate: '2027-01-05', steeringLiteral: 'RL', groups: ['5', 'I'] };
const copy = () => structuredClone(fixture);
const full = (projection, group = '5') => projection.nodes.find(node => JSON.stringify(node.path) === JSON.stringify([group, 'modelRanges', 'G61E', 'models', 'T5MJ']));

test('actual retained projection selects full records and collapses consistent 5/I appearances', () => {
  const result = selectFullModelRecord(fixture, expected);
  assert.deepEqual(result.selection, { modelCode: 'T5MJ', agModelCode: '72HH', catalogueRangeKey: 'G61E', modelRangeField: 'G61', orderDate: '2026-11-01', effectDate: '2027-01-05', steeringLiteral: 'RL' });
  assert.deepEqual(result.evidencePaths, [['5', 'modelRanges', 'G61E', 'models', 'T5MJ'], ['I', 'modelRanges', 'G61E', 'models', 'T5MJ']]);
  assert.equal(result.aliasAppearances, 2);
  assert.equal(result.distinctSelectedModels, 1);
  assert.deepEqual(result.qualification, { constructibility: 'not-established', vinProfile: 'unqualified', additionalConfigurations: 0 });
  assert.equal(Object.hasOwn(result.selection, 'market'), false);
});

test('compact defaultModel references cannot replace a full model record', () => {
  const projection = copy();
  projection.nodes = projection.nodes.filter(node => node.path.at(-1) === 'defaultModel');
  assert.throws(() => selectFullModelRecord(projection, expected), /selector-full-record-missing/);
});

test('unrelated RL cannot supply missing steering on either full record', () => {
  const projection = copy();
  delete full(projection).facts.steering;
  assert.throws(() => selectFullModelRecord(projection, expected), /selector-required-fact-missing/);
});

test('wrong direct model or AG identity is rejected despite matching path and other references', () => {
  for (const [field, value] of [['modelCode', 'OTHER'], ['agModelCode', '72XX']]) {
    const projection = copy();
    full(projection).facts[field] = value;
    assert.throws(() => selectFullModelRecord(projection, expected), /selector-identity-mismatch/);
  }
});

test('case changes in record path, identity or field names are not normalized', () => {
  const pathCase = copy();
  full(pathCase).path[4] = 't5mj';
  assert.throws(() => selectFullModelRecord(pathCase, expected), /selector-full-record-missing/);
  const identityCase = copy();
  full(identityCase).facts.modelCode = 't5mj';
  assert.throws(() => selectFullModelRecord(identityCase, expected), /selector-identity-mismatch/);
  const fieldCase = copy();
  full(fieldCase).facts.Steering = full(fieldCase).facts.steering;
  delete full(fieldCase).facts.steering;
  assert.throws(() => selectFullModelRecord(fieldCase, expected), /selector-fact-field/);
});

test('date aliases, non-ISO dates and changed order or effect dates refuse', () => {
  const alias = copy();
  delete full(alias).facts.effectDate;
  assert.equal(full(alias).facts.taxDate, '2027-01-05');
  assert.throws(() => selectFullModelRecord(alias, expected), /selector-required-fact-missing/);
  for (const [field, value] of [['effectDate', '20270105'], ['effectDate', '2027-01-06'], ['orderDate', '2026-11-02']]) {
    const projection = copy(); full(projection).facts[field] = value;
    assert.throws(() => selectFullModelRecord(projection, expected), /selector-context-mismatch/);
  }
});

test('catalogue map key and payload modelRange remain different required facts', () => {
  const payload = copy(); full(payload).facts.modelRange = 'G61E';
  assert.throws(() => selectFullModelRecord(payload, expected), /selector-range-mismatch/);
  for (const value of ['G61', 'g61e']) {
    const projection = copy(); full(projection).path[2] = value;
    assert.throws(() => selectFullModelRecord(projection, expected), /selector-full-record-missing/);
  }
});

test('missing, conflicting or ambiguous duplicate records cannot qualify by choosing one', () => {
  const missing = copy(); missing.nodes = missing.nodes.filter(node => node !== full(missing, 'I'));
  assert.throws(() => selectFullModelRecord(missing, expected), /selector-full-record-missing/);
  const steering = copy(); full(steering, 'I').facts.steering = 'LL';
  assert.throws(() => selectFullModelRecord(steering, expected), /selector-context-mismatch/);
  const optional = copy(); full(optional, 'I').facts.taxDate = '2027-01-06';
  assert.throws(() => selectFullModelRecord(optional, expected), /selector-duplicate-context-mismatch/);
  const ambiguous = copy(); ambiguous.nodes.push(structuredClone(full(ambiguous)));
  assert.throws(() => selectFullModelRecord(ambiguous, expected), /selector-full-record-ambiguous/);
});

test('wrong projection target/version, malformed nodes and excessive node counts refuse safely', () => {
  const target = copy(); target.target.agModelCode = 'OTHER';
  assert.throws(() => selectFullModelRecord(target, expected), /selector-projection-target/);
  const version = copy(); version.version = 'unknown';
  assert.throws(() => selectFullModelRecord(version, expected), /selector-projection/);
  assert.throws(() => selectFullModelRecord({ ...fixture, nodes: null }, expected), /selector-projection/);
  assert.throws(() => selectFullModelRecord({ ...fixture, nodes: Array(1025).fill({ path: [], facts: {} }) }, expected), /selector-projection-limit/);
});

test('unknown selected fields and private contract metadata produce only safe refusal codes', () => {
  const projection = copy(); full(projection).facts.privateNote = 'DO_NOT_RETAIN_PRIVATE_VALUE';
  assert.throws(() => selectFullModelRecord(projection, expected), error => error.message === 'selector-fact-field');
  assert.throws(() => selectFullModelRecord(fixture, { ...expected, cookie: 'DO_NOT_RETAIN_PRIVATE_VALUE' }), error => error.message === 'selector-contract');
});

test('contract requires complete canonical dates, unique expected groups and source literal', () => {
  for (const patch of [{ effectDate: '2027-02-30' }, { groups: ['5', '5'] }, { steeringLiteral: 'rhd' }, { catalogueRangeKey: 'g61e' }]) {
    assert.throws(() => selectFullModelRecord(fixture, { ...expected, ...patch }), /selector-contract/);
  }
});

test('selection never mutates the immutable observed projection or caller contract', () => {
  const before = JSON.stringify(fixture); const contractBefore = JSON.stringify(expected);
  selectFullModelRecord(fixture, expected);
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(JSON.stringify(expected), contractBefore);
});
