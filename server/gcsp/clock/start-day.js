import { londonParts, londonInstant } from '../../../blocks/gcsp/kit/friendly-time.js';

const dayNumber = (p) => Date.UTC(p.year, p.month - 1, p.day) / 86400000;
const onDay = (template, day) => {
  const t = londonParts(template); const d = new Date(day * 86400000);
  return londonInstant({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: t.hour, minute: t.minute });
};

/** The run's own start: the template's London wall time moved to the London date of `wall`; named cues shift by the same days. */
export function deriveScenarioClock(scenario, wall) {
  const today = londonParts(new Date(wall).toISOString()); const base = londonParts(scenario.startsAt);
  if (!today || !base) return { startsAt: scenario.startsAt, namedTimes: structuredClone(scenario.namedTimes) };
  const shift = dayNumber(today) - dayNumber(base);
  return { startsAt: onDay(scenario.startsAt, dayNumber(today)),
    namedTimes: Object.fromEntries(Object.entries(scenario.namedTimes).map(([name, at]) => [name, onDay(at, dayNumber(londonParts(at)) + shift)])) };
}

/** The scenario with a run's stored start applied; the policy template when the run has none. */
export function withRunClock(scenario, run) {
  const own = run?.versions?.scenarioClock;
  return own?.startsAt && own.namedTimes ? { ...scenario, startsAt: own.startsAt, namedTimes: structuredClone(own.namedTimes) } : scenario;
}
