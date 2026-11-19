import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
const definitions = [
  { id: 'offer-decline-reasons-v1', path: 'offer-decline-reasons-v1.json',
    sha: '1f1b632be83ddef1a5656288b4e40c0378736cda5c21fcf03de68544dfbe688f',
    digest: '2d7be8d50ff899dd4c72ed3490bcfc888e092196ef19b44d5d0519de76f00b4d', count: 1 },
  { id: 'offer-followup-questions-v1', path: 'offer-followup-questions-v1.json',
    sha: '2b634e30a65f8fce6a3cfef67e10b04e9dff72ecb4fe296c51330e98efe86d5d',
    digest: 'bb05e490f85e9f6fd9aa1c424c849740ad2884cc62e9d9a2b98ee8f739f8b7ed', count: 1 },
  { id: 'fucq115-choice-model-v1', path: 'fucq115-choice-model-v1.json',
    sha: '89565ec7fa05db042e623c6c88c132542505f7757848e61784f38d49b8391987',
    digest: 'dec7093d94d6ce4494c98a92b6aa2e0dc4207c1ee506d1eb449e51c36e9cd54d', count: 7 },
];
test('consumer registry loads exact reviewed bytes, validates and deeply freezes all six bundles', async () => {
  for (const item of definitions) {
    const bytes = await readFile(new URL(`../gcsp/policy/reviewed/${item.path}`, import.meta.url));
    const bundle = getReviewedDefinitionSet(item.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha);
    assert.deepEqual(bundle, JSON.parse(bytes)); assert.equal(bundle.digest, item.digest);
    assert.equal(bundle.definitions.length, item.count); assert.equal(validateReviewedDefinitionSet(bundle), true);
    assert.throws(() => { bundle.definitions[0].value = null; }, TypeError);
    assert.throws(() => { bundle.definitions.push({}); }, TypeError);
  }
  assert.notEqual(getReviewedDefinitionSet('offer-decline-reasons-v1').definitions[0].key,
    getReviewedDefinitionSet('offer-followup-questions-v1').definitions[0].key);
  for (const id of ['presenter-controls-v1', 'greg-publish-editor-v1', 'fucq113-learning-v1'])
    assert.equal(validateReviewedDefinitionSet(getReviewedDefinitionSet(id)), true);
});
