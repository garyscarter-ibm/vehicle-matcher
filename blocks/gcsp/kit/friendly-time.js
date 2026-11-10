// Friendly UK time for on-screen copy: the Europe/London wall clock, never UTC, ISO or "tick". Pure, no DOM.
const ZONE = 'Europe/London';
const WALL = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;
const instantMs = (iso) => (typeof iso === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? Date.parse(iso) : NaN);

/** An ISO instant as its London wall clock: { year, month, day, weekday (0 is Sunday), hour, minute }, or null. */
export function londonParts(iso) {
  const at = instantMs(iso); if (!Number.isFinite(at)) return null;
  const p = Object.fromEntries(WALL.formatToParts(new Date(at)).map(({ type, value }) => [type, Number(value)]));
  return { year: p.year, month: p.month, day: p.day, weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
    hour: p.hour, minute: p.minute };
}

const dayIndex = (p) => Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;

/** London calendar days from one instant to another (0 is the same day), or null. */
export function londonDaysBetween(fromIso, toIso) {
  const a = londonParts(fromIso); const b = londonParts(toIso);
  return a && b ? dayIndex(b) - dayIndex(a) : null;
}

/** The ISO instant of a London wall-clock time; correct either side of a clock change. */
export function londonInstant({ year, month, day, hour = 0, minute = 0 }) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let at = wall;
  for (let i = 0; i < 2; i += 1) {
    const p = londonParts(new Date(at).toISOString());
    at = wall - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at);
  }
  return new Date(at).toISOString();
}

/** "11:30am", "9:00am", "12:00pm" from London parts. */
export const clockTime = ({ hour, minute }) => `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;

/** "Tue 10 Nov, 11:30am", or null when not an instant. */
export function friendlyTime(iso) {
  const p = londonParts(iso);
  return p ? `${SHORT[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${clockTime(p)}` : null;
}

/** "Monday" for an instant's London date, or null. */
export const weekdayName = (iso) => LONG[londonParts(iso)?.weekday] ?? null;

/** "Today, 11:30am", "Tomorrow, 11:30am" or "Thu 12 Nov, 11:30am", relative to now. */
export function relativeTime(iso, nowIso) {
  const p = londonParts(iso); const days = londonDaysBetween(nowIso, iso);
  if (!p || days === null) return friendlyTime(iso);
  return days === 0 ? `Today, ${clockTime(p)}` : days === 1 ? `Tomorrow, ${clockTime(p)}` : friendlyTime(iso);
}

/** "Day 2 · Tue 10 Nov, 11:30am": the day counts from the run's start, so it reads the same after a restart. */
export function dayClock(nowIso, startIso) {
  const time = friendlyTime(nowIso); if (!time) return null;
  const days = londonDaysBetween(startIso, nowIso);
  return days === null || days < 0 ? time : `Day ${days + 1} · ${time}`;
}
