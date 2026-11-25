import { describe, expect, it } from 'vitest';
import { dayClock, friendlyTime, londonDaysBetween, londonInstant, relativeTime } from './friendly-time';

describe('source friendly UK time port', () => {
  it('uses London calendar days across the daylight saving change', () => {
    expect(londonInstant({ year: 2026, month: 7, day: 6, hour: 11, minute: 30 })).toBe('2026-07-06T10:30:00.000Z');
    expect(friendlyTime('2026-07-06T10:30:00Z')).toBe('Mon 6 Jul, 11:30am');
    expect(londonDaysBetween('2026-10-24T10:30:00Z', '2026-10-25T11:30:00Z')).toBe(1);
    expect(relativeTime('2026-11-17T11:30:00Z', '2026-11-16T11:30:00Z')).toBe('Tomorrow, 11:30am');
    expect(dayClock('2026-11-17T11:30:00Z', '2026-11-16T11:30:00Z')).toBe('Day 2 · Tue 17 Nov, 11:30am');
    expect(friendlyTime('broken')).toBeNull();
  });
});
