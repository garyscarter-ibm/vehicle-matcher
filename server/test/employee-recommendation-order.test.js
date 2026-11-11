import test from 'node:test';
import assert from 'node:assert/strict';
import { rankEmployeeRecommendations } from '../scenarios/employee/index.js';

const config = { ranking: { rule: 'similarFitThenPoints', fitTolerance: 5 } };
const car = (orderUuid, score, points, gateStatus = 'eligible') => ({ orderUuid, score, gateStatus, terms: { points: { value: points } } });
const ids = (rows, calibration = config) => rankEmployeeRecommendations(rows, calibration).map((row) => row.orderUuid);

test('fuller allowance use wins inside a similar-fit band without changing preference scores', () => {
  const rows = [car('low', 100, 800), car('high', 95, 1300), car('middle', 98, 1000)];
  const before = structuredClone(rows);
  assert.deepEqual(ids(rows), ['high', 'middle', 'low']);
  assert.deepEqual(rows, before);
});

test('a substantially worse match and any failed or unknown gate cannot buy first place', () => {
  assert.deepEqual(ids([car('good', 100, 800), car('worse', 94, 1300), car('poor', 0, 1400),
    car('over-budget', null, 1500, 'ineligible'), car('unknown', null, 1500, 'needs-confirmation')]), ['good', 'worse', 'poor']);
});

test('fit bands anchor to their best member and are independent of provider order', () => {
  const rows = [car('best', 100, 800), car('near', 96, 1000), car('further', 92, 1300)];
  for (const input of [rows, [...rows].reverse(), [rows[1], rows[2], rows[0]]]) {
    assert.deepEqual(ids(input), ['near', 'best', 'further']);
  }
});

test('equal points use preference fit then stable identity; no preferences use most points', () => {
  assert.deepEqual(ids([car('b', 100, 1000), car('a', 100, 1000), car('c', 96, 1000)]), ['a', 'b', 'c']);
  assert.deepEqual(ids([car('low', null, 0), car('high', null, 1300), car('middle', null, 800)]), ['high', 'middle', 'low']);
  assert.deepEqual(ids([car('known', 0, 800), car('unscored', null, 1300)]), ['known', 'unscored']);
});

test('policy pins control similarity and older pins keep their original ordering', () => {
  const rows = [car('best', 100, 800), car('near', 96, 1300)];
  assert.deepEqual(ids(rows, { ranking: { ...config.ranking, fitTolerance: 0 } }), ['best', 'near']);
  assert.deepEqual(ids(rows, {}), ['best', 'near']);
  for (const ranking of [{ rule: 'unknown', fitTolerance: 5 }, { ...config.ranking, fitTolerance: -1 },
    { ...config.ranking, fitTolerance: 101 }, { ...config.ranking, fitTolerance: '5' }]) {
    assert.throws(() => rankEmployeeRecommendations(rows, { ranking }), /Invalid employee recommendation ranking/);
  }
});
