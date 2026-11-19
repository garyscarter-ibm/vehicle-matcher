import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getReviewedDefinitionSet, validateReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
const bundle = getReviewedDefinitionSet('presenter-controls-v1');
test('reviewed registry is immutable, digest checked and matches the exact canonical presenter definition', async () => {
  assert.equal(validateReviewedDefinitionSet(bundle), true); assert.equal(getReviewedDefinitionSet('unknown'), null);
  assert.throws(() => { bundle.definitions[0].value = 1; }, TypeError);
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const { policyVersion, effectiveFrom, ...definition } = seed.assumptions.find((row) => row.key === 'clock.presenter.stepSeconds');
  assert.deepEqual(bundle.definitions, [definition]);
  for (const change of [
    (value) => { value.definitions[0].value = Infinity; }, (value) => { value.definitions[0].unit = ''; },
    (value) => { value.definitions[0].sourceDate = '2026-02-30'; }, (value) => { value.definitions.push(value.definitions[0]); },
    (value) => { value.definitions[0].unexpected = true; }, (value) => { value.definitions[0].value = 3; },
  ]) { const bad = structuredClone(bundle); change(bad); assert.equal(validateReviewedDefinitionSet(bad), false); }
});
