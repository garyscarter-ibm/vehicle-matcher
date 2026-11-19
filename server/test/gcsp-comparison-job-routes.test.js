import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExperimentRequest } from '../gcsp/comparison/requests.js';
import { EXPERIMENT_IDS } from '../gcsp/comparison/experiments.js';
test('parseExperimentRequest returns only the accepted fields', () => {
  assert.deepEqual(parseExperimentRequest({ experimentId: 'process-only' }).value, { experimentId: 'process-only' });
  const mix = [{ modelLine: 'G20 Saloon|320i', weight: 100 }];
  assert.deepEqual(parseExperimentRequest({ experimentId: 'order-mix', change: { value: mix, basis: 'Why' } }).value,
    { experimentId: 'order-mix', change: { value: mix, basis: 'Why' } });
  assert.deepEqual(parseExperimentRequest({ experimentId: 'hold-sweep', change: { values: [900, 1800], basis: 'Why' } }).value,
    { experimentId: 'hold-sweep', change: { values: [900, 1800], basis: 'Why' } });
  assert.equal(parseExperimentRequest(null).reasons[0].field, 'body');
  for (const id of EXPERIMENT_IDS) assert.equal(parseExperimentRequest({ experimentId: id, seeds: [1] }).status, 'invalid');
});
