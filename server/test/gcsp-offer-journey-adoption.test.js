import test from 'node:test';
import assert from 'node:assert/strict';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
test('the combined offer journey set is the two reviewed offer sets, row for row', () => {
  const combined = getReviewedDefinitionSet('offer-journey-v1');
  assert.deepEqual(combined.definitions, [...getReviewedDefinitionSet('offer-decline-reasons-v1').definitions,
    ...getReviewedDefinitionSet('offer-followup-questions-v1').definitions]);
});

test('the successor adds re-entry without changing the historical journey definitions', () => {
  const old = getReviewedDefinitionSet('offer-journey-v1');
  const next = getReviewedDefinitionSet('offer-journey-v2');
  assert.ok(next, 'The reviewed successor must be adoptable.');
  assert.deepEqual(next.definitions.slice(0, 2), old.definitions);
  assert.equal(next.definitions[2].key, 'offer.declinedCar.reentry.v1');
  assert.equal(old.definitions.length, 2);
});
