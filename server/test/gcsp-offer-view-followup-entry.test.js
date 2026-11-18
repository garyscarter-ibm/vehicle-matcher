// Authored contract check on the kept offer projection: only the exact opaque follow-up handle crosses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';
const sample = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url)));
const handle = { decisionId: `offer-decision:${'a'.repeat(64)}` };
const otherHandle = { decisionId: `offer-decision:${'b'.repeat(64)}` };
const dto = (followup = handle) => ({ ...structuredClone(sample), state: 'declined', reason: 'declined',
  offerState: 'rejected', holdState: 'released', availableActions: [], followup: structuredClone(followup) });
const project = (value) => toOfferPresentation({ status: 'ok', value });

test('only the exact opaque handle crosses a consistent terminal declined DTO; legacy/malformed sources stay declined', () => {
  const original = dto(); const outcome = project(original);
  assert.equal(outcome.status, 'ok'); assert.deepEqual(outcome.value.followup, handle);
  outcome.value.followup.decisionId = otherHandle.decisionId; assert.deepEqual(original.followup, handle);
  const invalid = [null, {}, [], handle.decisionId, { decisionId: 'offer-decision:short' },
    { decisionId: `offer-decision:${'A'.repeat(64)}` }, { decisionId: handle.decisionId + '\n' },
    { ...handle, employeeId: 'must-not-cross' }, { ...handle, [Symbol('extra')]: true }];
  for (const followup of invalid) {
    const input = dto(null); input.followup = followup;
    const result = project(input); assert.equal(result.value.state, 'declined'); assert.equal(result.value.followup, null);
    assert.equal(JSON.stringify(result).includes('must-not-cross'), false);
  }
  const legacy = dto(); delete legacy.followup; assert.equal(project(legacy).value.followup, null);
  for (const state of ['pending', 'accepted', 'expired', 'superseded']) {
    assert.equal(project({ ...dto(), state }).value.followup, null);
  }
  for (const inconsistent of [{ offerState: 'offered' }, { holdState: 'allocated' }]) {
    const result = project({ ...dto(), ...inconsistent });
    assert.equal(result.value.state, 'declined'); assert.equal(result.value.followup, null);
  }
});
