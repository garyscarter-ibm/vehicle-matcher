// Replays data-unavailable (FUCQ-130) through the presenter and employee routes, twice across two resets.
import test from 'node:test';
import assert from 'node:assert/strict';
test('the synthetic stock fault is run-scoped and never alters an operational provider pull', async () => {
  const { createSyntheticStockFaults } = await import('../gcsp/stock/synthetic-fault.js');
  const policy = { getAssumption: async () => ({ status: 'ok', value: { value: 60, unit: 'minutes' } }) };
  const snapshot = (mode) => ({ status: 'ok', value: { observedAt: '2026-11-05T09:30:00.000Z', source: { mode }, stock: [] } });
  const faults = createSyntheticStockFaults({ policy });
  const request = { runId: 'run-a', asOf: '2026-11-05T09:30:00.000Z', policyVersion: 'v1' };
  assert.equal(faults.set('run-a', 'unavailable'), true); assert.equal(faults.set('run-a', 'broken'), false);
  assert.deepEqual(await faults.wrap({ pull: async () => snapshot('dated-snapshot') }).pull(request), snapshot('dated-snapshot'));
  assert.equal((await faults.wrap({ pull: async () => snapshot('synthetic') }).pull(request)).status, 'unavailable');
  assert.deepEqual(await faults.wrap({ pull: async () => snapshot('synthetic') }).pull({ ...request, runId: 'run-b' }), snapshot('synthetic'));
  faults.set('run-a', 'stale');
  const stale = await faults.wrap({ pull: async () => snapshot('synthetic') }).pull(request);
  assert.equal(stale.value.observedAt, '2026-11-05T08:29:00.000Z');
  assert.equal(faults.read('run-b').mode, 'none');
});
