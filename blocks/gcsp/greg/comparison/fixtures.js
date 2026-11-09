// SYNTHETIC fixtures for Greg's route comparison: fictional cohort and figures. Never selected by the live dashboard.
// Every state goes through outcomeToState, as the live route does.
import { outcomeToState } from './http-adapter.js';
import { STORED_NO_CLEAR_DIFFERENCE } from './stored-fixture.js';

export const FIXTURE_NAMES = Object.freeze(['loading', 'buddy-better', 'no-clear-difference', 'today-better', 'old-policy', 'empty', 'unavailable', 'refused']);

const round = (v) => Math.round(v * 1e6) / 1e6;
const stats = ([mean, min, max], seeds = 3) => ({ mean, min, max, observedSeeds: seeds });
// Change a measure's figures and verdict together; the difference is rebuilt from the two routes (min = buddy min - today max).
function derive(id, changes) {
  const stored = structuredClone(STORED_NO_CLEAR_DIFFERENCE);
  stored.resultId = `process-comparison-fixture-${id}`;
  for (const [measure, { current, buddy, verdict }] of Object.entries(changes)) {
    const row = stored.result.differences.find((d) => d.measure === measure);
    row.current = stats(current); row.buddy = stats(buddy); row.verdict = verdict;
    row.difference = { mean: round(buddy[0] - current[0]), min: round(buddy[1] - current[2]), max: round(buddy[2] - current[1]) };
    const [group, key] = measure.split(':');
    const target = key ? (side) => (stored.result.measures[side][group][key] = row[side]) : (side) => (stored.result.measures[side][measure] = row[side]);
    target('current'); target('buddy');
  }
  return stored;
}
const COVERAGE = (current, buddy, verdict) => ({ current, buddy, verdict });
const group = 'accessGroupCoverage:mechanics-access';

const BUDDY_BETTER = () => derive('buddy-better', {
  acceptableCoverage: COVERAGE([0.125, 0, 0.25], [0.5, 0.375, 0.75], 'buddy-better'),
  [group]: COVERAGE([0.125, 0, 0.25], [0.5, 0.375, 0.75], 'buddy-better'),
  carsNeverAllocated: COVERAGE([3.666667, 3, 4], [2, 1, 2], 'buddy-better'),
});
const TODAY_BETTER = () => derive('today-better', {
  acceptableCoverage: COVERAGE([0.75, 0.625, 0.875], [0.25, 0.125, 0.375], 'current-better'),
  [group]: COVERAGE([0.75, 0.625, 0.875], [0.25, 0.125, 0.375], 'current-better'),
  declinedOffers: COVERAGE([0, 0, 0], [2.333333, 2, 3], 'current-better'),
  expiredOffers: COVERAGE([0, 0, 0], [1.666667, 1, 2], 'current-better'),
});
const NO_CLEAR = () => structuredClone(STORED_NO_CLEAR_DIFFERENCE);
const OLD_POLICY = () => ({ ...NO_CLEAR(), policyCurrent: false, activePolicyVersion: 'gcsp-policy-v2', resultId: 'process-comparison-fixture-old-policy' });

/** Stored values by name, for shape tests and galleries. Every call returns fresh objects. */
export const FIXTURE_VALUES = Object.freeze({ 'buddy-better': BUDDY_BETTER, 'no-clear-difference': NO_CLEAR, 'today-better': TODAY_BETTER, 'old-policy': OLD_POLICY });

function never(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

/** { load({ signal }) } for the named fixture, or null when the name is unknown. */
export function comparisonFixtureAdapter(name) {
  if (!FIXTURE_NAMES.includes(name)) return null;
  if (name === 'loading') return { load: ({ signal } = {}) => never(signal) };
  const outcomes = {
    empty: () => outcomeToState(404, { status: 'not-found' }),
    unavailable: () => outcomeToState(503, { status: 'unavailable' }),
    refused: () => outcomeToState(403, { status: 'forbidden' }),
  };
  const read = outcomes[name] ?? (() => outcomeToState(200, { status: 'ok', value: FIXTURE_VALUES[name]() }));
  return { load: async () => read() };
}
