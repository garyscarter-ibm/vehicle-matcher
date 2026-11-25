import { describe, expect, it } from 'vitest';
import { basicModel, nextReleaseInstant, weekDays } from './basic-model';
import { PresenterControls } from './presenter.types';
const controls = (now = '2026-11-16T09:00:00Z'): PresenterControls => ({ runId: 'unit-run', now, clockVersion: 4, startsAt: '2026-11-16T09:00:00Z', scenarioVersion: 'one', fixtureVersion: 'one', namedTimes: {}, lastTick: null, controls: { policyVersion: 'one', step: { value: 60, unit: 'seconds' }, namedTimes: {}, nextRelease: { status: 'unavailable', reason: 'No cue configured' } } });
describe('presenter source basic model', () => {
  it('keeps the London run week, missing clock and unprepared preferences truthful', () => {
    expect(basicModel(null).release.disabled).toBe(true); expect(basicModel(controls()).phase).toBe('waiting');
    const days = weekDays('2026-11-17T11:30:00Z', '2026-11-16T09:00:00Z');
    expect(days[0]).toEqual({ label: 'Mon 16', done: true, today: false, weekend: false, beforeStart: false });
    expect(days[1].today).toBe(true); expect(days[6].weekend).toBe(true); expect(weekDays('bad', null)).toEqual([]);
  });
  it('moves Basic to the next weekday at 11:30 London independently of the Advanced cue, including DST', () => {
    expect(nextReleaseInstant('2026-07-03T12:00:00Z')).toBe('2026-07-06T10:30:00.000Z');
    expect(nextReleaseInstant('2026-10-23T12:00:00Z')).toBe('2026-10-26T11:30:00.000Z');
    const model = basicModel(controls(), true); expect(model.release.label).toBe("Release tomorrow's cars");
    expect(model.release.body).toEqual({ mode: 'to', to: '2026-11-17T11:30:00.000Z' }); expect(model.release.disabled).toBe(false);
    expect(basicModel(controls('2026-11-20T11:30:00Z'), true).release.label).toBe("Release Monday's cars");
  });
  it('preserves zero latest-release outcomes and offered/accepted phases from actual recorded inputs', () => {
    const base = controls(); const value: PresenterControls = { ...base, lastTick: { runId: base.runId, tickId: 'tick', now: base.now, clockVersion: 4, policyVersion: 'one', kind: 'presenter', state: 'completed', handlerOrder: [], missingStages: [], outcomes: [{ handlerId: 'stock-release', stage: 'release-pull', outcome: { status: 'ok', value: { runId: base.runId, tickId: 'tick', kind: 'no-release', orderUuids: [] } } }, { handlerId: 'buddy-allocation', stage: 'buddy-allocation', outcome: { status: 'ok', value: { runId: base.runId, summary: { events: 1, offers: 2, evaluated: 3 } } } }] } };
    expect(basicModel(value).headline).toBe('No new cars in the last release'); expect(basicModel(value).phase).toBe('offered');
    expect(basicModel(value, true, 1).headline).toBe('An order is in progress'); expect(basicModel(value, true, 1).release.label).toBe('Move on a day');
  });
});
