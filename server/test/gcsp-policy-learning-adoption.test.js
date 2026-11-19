import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
const id = 'fucq113-learning-v1';
const digest = 'a49f54884322f5993faf510aa8f5cea6e4a9c02e9fae2d2ddfefd350a69d7782';
const bundle = getReviewedDefinitionSet(id);
const keys = ['learning.cohortSize', 'learning.cycles', 'learning.cycleSpacingDays', 'learning.maximumGeneratedRecords',
  'learning.maximumChoiceEntries', 'learning.noChoiceRate', 'learning.response.v1'];
test('registry retains all reviewed bundles and the exact immutable approved learning artifact', async () => {
  const bytes = await readFile(new URL('../gcsp/predict/records/policy-definitions.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'c083ed58abcde595ac0cbf077b319b9102795506efb736c980d5f0cdba840143');
  assert.deepEqual(bundle, JSON.parse(bytes)); assert.equal(bundle.revision, 'learning-definitions.v1');
  assert.equal(bundle.digest, digest); assert.equal(validateReviewedDefinitionSet(bundle), true);
  assert.deepEqual(bundle.definitions.map((row) => row.key), keys);
  for (const other of ['presenter-controls-v1', 'greg-publish-editor-v1']) assert.equal(validateReviewedDefinitionSet(getReviewedDefinitionSet(other)), true);
  assert.throws(() => { bundle.definitions[6].value.declineRate = 1; }, TypeError);
  assert.throws(() => { bundle.definitions.push({}); }, TypeError);
  const invalid = structuredClone(bundle); invalid.definitions[0].value += 1;
  assert.equal(validateReviewedDefinitionSet(invalid), false);
});
