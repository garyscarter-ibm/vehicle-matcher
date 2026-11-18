// Model boundary only: typed release-history fixtures, no stock producer or host acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toManualGallery } from '../../blocks/gcsp/manual-gallery/gallery-model.js';
import { createManualGalleryFixture } from '../../blocks/gcsp/manual-gallery/fixtures.js';

const copy = (value) => structuredClone(value);
const history = (state = 'released') => ({ runId: 'TEST-history-run', observedAt: '2026-11-05T12:00:00.000Z',
  history: state === 'none-visible'
    ? { state, releasedCarCount: 0, releaseCount: 0, latestReleasedAt: null, sourceVersions: [] }
    : { state, releasedCarCount: 5, releaseCount: 2, latestReleasedAt: '2026-11-05T11:00:00.000Z', sourceVersions: ['TEST-release-v1'] },
  source: { state: 'current-version-unknown' } });
const withHistory = (input = createManualGalleryFixture(), value = history()) => ({ ...copy(input),
  value: { ...copy(input.value), releaseHistory: value } });

test('visible release history survives filters and current ineligibility without changing exact selections', () => {
  const input = withHistory(); const before = copy(input); const baseline = toManualGallery(createManualGalleryFixture());
  const result = toManualGallery(input);
  assert.deepEqual(result.allCars, baseline.allCars); assert.deepEqual(result.releaseHistory, input.value.releaseHistory);
  const filtered = toManualGallery(input, { query: 'no matching car' });
  assert.equal(filtered.state, 'empty-search'); assert.equal(filtered.cars.length, 0);
  assert.deepEqual(filtered.releaseHistory, input.value.releaseHistory);
  const excluded = copy(input); excluded.value.decisions.forEach((car) => { car.gateStatus = 'ineligible'; car.claimInput = null; });
  assert.equal(toManualGallery(excluded).state, 'no-suitable-stock');
  assert.deepEqual(toManualGallery(excluded).releaseHistory, input.value.releaseHistory);
  const empty = toManualGallery(withHistory(createManualGalleryFixture('empty-stock')));
  assert.equal(empty.state, 'empty-stock'); assert.equal(empty.releaseHistory.history.releasedCarCount, 5);
  result.releaseHistory.history.sourceVersions.push('local-change');
  assert.deepEqual(input, before); assert.equal(result.browsingReservesStock, false);
});

test('none-visible stays employee-relative and missing or invalid history never becomes a zero-history fact', () => {
  const empty = createManualGalleryFixture('empty-stock');
  assert.equal(toManualGallery(empty).state, 'empty-stock'); assert.equal(toManualGallery(empty).releaseHistory, null);
  const none = toManualGallery(withHistory(empty, history('none-visible')));
  assert.equal(none.state, 'no-visible-releases'); assert.equal(none.releaseHistory.source.state, 'current-version-unknown');
  assert.equal(toManualGallery(withHistory(createManualGalleryFixture('nothing-released-yet'), history('none-visible'))).state, 'no-visible-releases');
  const invalid = [null, {}, { ...history(), source: { state: 'healthy' } },
    { ...history(), runId: '' }, { ...history(), history: { ...history().history, releaseCount: -1 } },
    { ...history(), history: { ...history().history, latestReleasedAt: '2026-11-06T12:00:00.000Z' } },
    { ...history('none-visible'), history: { ...history('none-visible').history, releasedCarCount: 1 } },
    { ...history(), history: { ...history().history, sourceVersions: ['same', 'same'] } }];
  for (const value of invalid) {
    const result = toManualGallery(withHistory(empty, value));
    assert.equal(result.state, 'source-unavailable'); assert.equal(result.releaseHistory, null); assert.deepEqual(result.allCars, []);
  }
  const wrongRun = withHistory(empty); wrongRun.value.runId = 'other-run';
  assert.equal(toManualGallery(wrongRun).state, 'source-unavailable');
  const refused = toManualGallery({ status: 'unavailable', reason: 'Confirmed release history is unavailable.' });
  assert.equal(refused.state, 'source-unavailable'); assert.equal(refused.releaseHistory, null);
});
