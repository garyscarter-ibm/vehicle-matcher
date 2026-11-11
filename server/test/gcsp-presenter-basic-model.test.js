// FUCQ-362: friendly UK time and the journey-driven Release button, from /presenter/controls and catalogue shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyTime, relativeTime, dayClock, londonInstant, londonParts } from '../../blocks/gcsp/kit/friendly-time.js';
import { basicModel, nextReleaseInstant, startAgainBody, currentEntry } from '../../blocks/gcsp/presenter-controls/basic-model.js';

const RUN = 'demo-run-1';
const START = '2026-11-09T09:00:00.000Z';
const paula = { inputs: { briefs: [{ principalId: 'demo-paula' }] }, clockStart: START };
const empty = { inputs: { briefs: [] }, clockStart: START };
const tick = (outcomes) => ({ runId: RUN, tickId: 't1', eventId: 't1', outcomes });
const release = (n) => ({ handlerId: 'stock-release', stage: 'release-pull', outcome: { status: 'ok',
  value: { kind: n ? 'stock-released' : 'no-release', runId: RUN, tickId: 't1', orderUuids: Array.from({ length: n }, (_, i) => `id-${i}`) } } });
const buddy = (assignments, evaluated = 1) => ({ handlerId: 'buddy-allocation', stage: 'buddy-allocation', outcome: { status: 'ok',
  value: { runId: RUN, allocations: [{ assignments: Array.from({ length: assignments }, () => ({ employeeId: 'e' })),
    evaluationRefs: { employeeIds: Array.from({ length: evaluated }, () => 'e') } }] } } });
const orders = (n) => ({ handlerId: 'lifecycle-approvals', stage: 'lifecycle', outcome: { status: 'ok', value: { handlerId: 'lifecycle-approvals', orders: n } } });
const controls = (now, outcomes = null) => ({ runId: RUN, runVersion: 2, now, clockVersion: '3', lastTick: outcomes ? tick(outcomes) : null,
  currentScenario: { scenarioId: 'main-successful-journey', fixtureVersion: 'main-successful-journey-inputs-v1' } });
const SCREEN_FIELDS = (m) => [m.headline, m.sub, m.clock, m.nextRelease, m.release.label, m.release.reason].join(' ');

test('friendly time reads the London wall clock, never UTC or an ISO string', () => {
  assert.equal(friendlyTime('2026-11-10T11:30:00.000Z'), 'Tue 10 Nov, 11:30am');
  assert.equal(friendlyTime('2026-11-09T09:00:00.000Z'), 'Mon 9 Nov, 9:00am');
  assert.equal(friendlyTime('2026-07-01T11:30:00.000Z'), 'Wed 1 Jul, 12:30pm', 'summer time is an hour ahead of UTC');
  assert.equal(friendlyTime('2026-11-10T00:15:00.000Z'), 'Tue 10 Nov, 12:15am');
  assert.equal(friendlyTime('not a time'), null);
  assert.equal(dayClock('2026-11-10T11:30:00.000Z', START), 'Day 2 · Tue 10 Nov, 11:30am');
  assert.equal(dayClock(START, START), 'Day 1 · Mon 9 Nov, 9:00am');
  assert.equal(dayClock('2026-11-10T11:30:00.000Z', undefined), 'Tue 10 Nov, 11:30am');
});

test('relative time says Today, Tomorrow or the date', () => {
  const now = '2026-11-10T09:00:00.000Z';
  assert.equal(relativeTime('2026-11-10T11:30:00.000Z', now), 'Today, 11:30am');
  assert.equal(relativeTime('2026-11-11T11:30:00.000Z', now), 'Tomorrow, 11:30am');
  assert.equal(relativeTime('2026-11-12T11:30:00.000Z', now), 'Thu 12 Nov, 11:30am');
  assert.equal(relativeTime('2026-11-11T11:30:00.000Z', '2026-11-10T23:30:00.000Z'), 'Tomorrow, 11:30am');
});

test('the next release is the next weekday at 11:30am UK time, either side of a clock change', () => {
  assert.equal(nextReleaseInstant('2026-11-09T09:00:00.000Z'), '2026-11-10T11:30:00.000Z');
  assert.equal(nextReleaseInstant('2026-11-10T11:30:00.000Z'), '2026-11-11T11:30:00.000Z');
  assert.equal(nextReleaseInstant('2026-11-13T11:30:00.000Z'), '2026-11-16T11:30:00.000Z', 'Friday moves to Monday');
  assert.equal(nextReleaseInstant('2026-11-14T10:00:00.000Z'), '2026-11-16T11:30:00.000Z', 'Saturday moves to Monday');
  assert.equal(nextReleaseInstant('2026-07-01T09:00:00.000Z'), '2026-07-02T10:30:00.000Z', 'BST: 11:30am is 10:30 UTC');
  assert.equal(nextReleaseInstant('2026-03-27T12:00:00.000Z'), '2026-03-30T10:30:00.000Z', 'across the spring change');
  assert.deepEqual(londonParts(londonInstant({ year: 2026, month: 10, day: 26, hour: 11, minute: 30 })).hour, 11);
});

test('the primary button follows the journey state read from the server', () => {
  const ready = basicModel({ controls: controls(START), scenario: paula });
  assert.equal(ready.phase, 'ready'); assert.equal(ready.release.label, "Release tomorrow's cars"); assert.equal(ready.release.disabled, false);
  assert.deepEqual(ready.release.body, { expectedClockVersion: '3', mode: 'to', to: '2026-11-10T11:30:00.000Z' });
  assert.equal(ready.nextRelease, 'Tomorrow, 11:30am'); assert.equal(ready.clock, 'Day 1 · Mon 9 Nov, 9:00am');

  const waiting = basicModel({ controls: controls(START), scenario: empty });
  assert.equal(waiting.phase, 'waiting'); assert.equal(waiting.release.disabled, true); assert.equal(waiting.release.body, null);
  assert.equal(waiting.release.label, 'Waiting for preferences');

  const friday = basicModel({ controls: controls('2026-11-13T11:30:00.000Z', [release(0)]), scenario: paula });
  assert.equal(friday.release.label, "Release Monday's cars"); assert.equal(friday.release.body.to, '2026-11-16T11:30:00.000Z');
  assert.equal(friday.nextRelease, 'Mon 16 Nov, 11:30am');

  const offered = basicModel({ controls: controls('2026-11-10T11:30:00.000Z', [release(100), buddy(1)]), scenario: paula });
  assert.equal(offered.phase, 'offered'); assert.equal(offered.release.label, "Release the next day's cars");
  assert.equal(offered.headline, '100 cars released');

  // A decline records no tick, so the release tick still stands; a later release with no new offer reads the same.
  const later = basicModel({ controls: controls('2026-11-11T11:30:00.000Z', [release(100), buddy(0)]), scenario: paula });
  assert.equal(later.phase, 'ready'); assert.equal(later.release.label, "Release the next day's cars");
  const fridayOffer = basicModel({ controls: controls('2026-11-13T11:30:00.000Z', [release(100), buddy(1)]), scenario: paula });
  assert.equal(fridayOffer.release.label, "Release Monday's cars");

  const accepted = basicModel({ controls: controls('2026-11-10T12:00:00.000Z', [orders(1)]), scenario: paula });
  assert.equal(accepted.phase, 'accepted'); assert.equal(accepted.release.label, 'Move on a day');
  assert.equal(accepted.release.body.to, '2026-11-11T11:30:00.000Z'); assert.equal(accepted.headline, 'An order is in progress');
  assert.equal(basicModel({ controls: controls(START), scenario: paula, orders: 2 }).headline, '2 orders in progress');
});

test('unreadable controls disable Release instead of guessing', () => {
  for (const value of [null, { now: 'soon', clockVersion: '1' }, { now: START }]) {
    const model = basicModel({ controls: value, scenario: paula });
    assert.equal(model.phase, 'unavailable'); assert.equal(model.release.disabled, true); assert.equal(model.release.body, null);
  }
  const foreign = controls('2026-11-10T11:30:00.000Z', [release(100)]); foreign.lastTick.runId = 'other-run';
  assert.equal(basicModel({ controls: foreign, scenario: paula }).headline, 'Ready for the next release');
});

test('compact allocation counts preserve the legacy presenter states and reject invalid or foreign counts', () => {
  for (const [offers, evaluated] of [[1, 2], [0, 2], [0, 0]]) {
    const legacy = buddy(offers, evaluated);
    const compact = { ...legacy, outcome: { status: 'ok', value: { runId: RUN, summary: { events: 1, offers, evaluated } } } };
    const model = (row) => basicModel({ controls: controls(START, [release(100), row]), scenario: empty });
    assert.deepEqual(model(compact), model(legacy));
    for (const bad of [-1, NaN, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = structuredClone(compact); invalid.outcome.value.summary.offers = bad;
      assert.equal(model(invalid).phase, 'waiting');
    }
    const foreign = structuredClone(compact); foreign.outcome.value.runId = 'other';
    assert.equal(model(foreign).phase, 'waiting');
    const foreignTick = controls(START, [compact]); foreignTick.lastTick.runId = 'other';
    assert.equal(basicModel({ controls: foreignTick, scenario: empty }).phase, 'waiting');
  }
});

test('copy is user agnostic and never shows UTC, ISO instants, tick or em dashes', () => {
  const states = [basicModel({ controls: controls(START), scenario: paula }), basicModel({ controls: controls(START), scenario: empty }),
    basicModel({ controls: controls('2026-11-10T11:30:00.000Z', [release(100), buddy(2)]), scenario: paula }),
    basicModel({ controls: controls('2026-11-10T12:00:00.000Z', [orders(1)]), scenario: paula }), basicModel({ controls: null })];
  for (const model of states) {
    const copy = SCREEN_FIELDS(model);
    assert.doesNotMatch(copy, /UTC|\dT\d|\btick\b|—|Paula|demo|synthetic|example/i, copy);
  }
  assert.equal(states[0].exactNow, START, 'Advanced keeps the exact instant');
});

test('Start again resets into a fresh Main successful journey with the current run identity', () => {
  const entry = { scenarioId: 'main-successful-journey', scenarioVersion: 'gcsp-acceptance-scenarios-v1',
    fixtureVersion: 'main-successful-journey-inputs-v1', availability: { available: true }, inputs: paula.inputs, clockStart: START };
  const catalogue = { policyVersion: 'gcsp-policy-v1', scenarios: [{ scenarioId: 'no-suitable-match', availability: { available: true } }, entry] };
  assert.deepEqual(startAgainBody({ controls: controls(START), catalogue }).body, { expectedRunId: RUN, expectedRunVersion: 2,
    scenarioId: entry.scenarioId, scenarioVersion: entry.scenarioVersion, fixtureVersion: entry.fixtureVersion, policyVersion: 'gcsp-policy-v1' });
  assert.equal(currentEntry(controls(START), catalogue), entry);
  const off = { ...catalogue, scenarios: [{ ...entry, availability: { available: false } }] };
  assert.equal(startAgainBody({ controls: controls(START), catalogue: off }).body, null);
  assert.equal(startAgainBody({ controls: { runId: RUN }, catalogue }).body, null);
});
