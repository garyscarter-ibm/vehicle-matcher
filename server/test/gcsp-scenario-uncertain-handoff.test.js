// Replays uncertain-handoff (FUCQ-131), both resolutions, through the presenter and employee routes, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the synthetic ordering fault applies to one handoff in its own run only', async () => {
  const { createSyntheticOrderingFaults } = await import('../gcsp/adapters/synthetic-ordering-fault.js');
  const faults = createSyntheticOrderingFaults();
  assert.equal(faults.set('run-a', 'timeout-rejected'), true); assert.equal(faults.set('run-a', 'sometimes'), false);
  assert.equal(faults.take('run-b', 'op-b'), null);
  assert.deepEqual(faults.take('run-a', 'op-1'), { response: 'timeout', resolution: 'rejected' });
  assert.equal(faults.take('run-a', 'op-2'), null);
  assert.deepEqual(faults.read('run-a').handoffs.map((h) => h.response), ['timeout', 'answered']);
  assert.equal(faults.read('run-a').mode, 'none');
});
