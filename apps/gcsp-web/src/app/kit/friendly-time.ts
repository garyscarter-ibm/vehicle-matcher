// Frozen friendly-time.js: display the London wall clock, including daylight saving changes.
const WALL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
interface LondonParts { readonly year: number; readonly month: number; readonly day: number; readonly weekday: number; readonly hour: number; readonly minute: number }
export function londonParts(iso: unknown): LondonParts | null {
  const at = typeof iso === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return null;
  const p = Object.fromEntries(WALL.formatToParts(new Date(at)).map(({ type, value }) => [type, Number(value)]));
  return { year: p['year'], month: p['month'], day: p['day'], weekday: new Date(Date.UTC(p['year'], p['month'] - 1, p['day'])).getUTCDay(), hour: p['hour'], minute: p['minute'] };
}
export function londonDaysBetween(from: unknown, to: unknown): number | null {
  const a = londonParts(from); const b = londonParts(to);
  return a && b ? (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000 : null;
}
export function londonInstant({ year, month, day, hour = 0, minute = 0 }: { year: number; month: number; day: number; hour?: number; minute?: number }): string {
  const wall = Date.UTC(year, month - 1, day, hour, minute); let at = wall;
  for (let i = 0; i < 2; i++) { const p = londonParts(new Date(at).toISOString())!; at = wall - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - at); }
  return new Date(at).toISOString();
}
export const clockTime = ({ hour, minute }: Pick<LondonParts, 'hour' | 'minute'>): string => `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
export function friendlyTime(iso: unknown): string | null { const p = londonParts(iso); return p ? `${SHORT[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${clockTime(p)}` : null; }
export const weekdayName = (iso: unknown): string | null => { const p = londonParts(iso); return p ? LONG[p.weekday] : null; };
export function relativeTime(iso: unknown, now: unknown): string | null { const p = londonParts(iso); const days = londonDaysBetween(now, iso); return !p || days === null ? friendlyTime(iso) : days === 0 ? `Today, ${clockTime(p)}` : days === 1 ? `Tomorrow, ${clockTime(p)}` : friendlyTime(iso); }
export function dayClock(now: unknown, start: unknown): string | null { const time = friendlyTime(now); if (!time) return null; const days = londonDaysBetween(start, now); return days === null || days < 0 ? time : `Day ${days + 1} · ${time}`; }
