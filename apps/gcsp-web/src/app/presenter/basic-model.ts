import { dayClock, londonDaysBetween, londonInstant, londonParts, relativeTime, weekdayName } from '../kit/friendly-time';
import { PresenterControls } from './presenter.types';

export function weekDays(nowIso: unknown, startIso: unknown) {
  const now = londonParts(nowIso); if (!now) return [];
  const start = londonParts(startIso); const today = Date.UTC(now.year, now.month - 1, now.day);
  const monday = today - (now.weekday + 6) % 7 * 86400000; const first = start ? Date.UTC(start.year, start.month - 1, start.day) : -Infinity;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, index) => { const day = monday + index * 86400000; return { label: `${name} ${new Date(day).getUTCDate()}`, done: day < today && day >= first, today: day === today, weekend: index > 4, beforeStart: day < first }; });
}
export function releasedThisTick(controls: PresenterControls): number | null {
  const tick = controls.lastTick; const outcome = tick?.outcomes.find(row => row.handlerId === 'stock-release')?.outcome;
  const value = outcome?.['status'] === 'ok' ? outcome['value'] as Record<string, unknown> | undefined : undefined;
  return tick?.runId === controls.runId && value?.['runId'] === controls.runId && value?.['tickId'] === tick.tickId
    && ['stock-released', 'no-release'].includes(String(value['kind'])) && Array.isArray(value['orderUuids']) ? value['orderUuids'].length : null;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function successful(controls: PresenterControls, id: string): Record<string, unknown> | null {
  const row = controls.lastTick?.outcomes.find(row => row.handlerId === id)?.outcome;
  return row?.['status'] === 'ok' && object(row['value']) ? row['value'] : null;
}
export function nextReleaseInstant(now: unknown): string | null {
  const today = londonParts(now); if (!today) return null;
  for (let ahead = 1; ahead <= 7; ahead++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) return londonInstant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 11, minute: 30 });
  }
  return null;
}
function allocationThisTick(controls: PresenterControls): { offers: number; evaluated: boolean } {
  const value = successful(controls, 'buddy-allocation');
  if (controls.lastTick?.runId !== controls.runId || value?.['runId'] !== controls.runId) return { offers: 0, evaluated: false };
  const summary = value['summary'];
  if (object(summary) && ['events', 'offers', 'evaluated'].every(key => whole(summary[key]))) return { offers: Number(summary['offers']), evaluated: Number(summary['evaluated']) > 0 };
  const rows = Array.isArray(value['allocations']) ? value['allocations'].filter(object) : [];
  return { offers: rows.reduce((n, row) => n + (Array.isArray(row['assignments']) ? row['assignments'].length : 0), 0), evaluated: rows.some(row => Array.isArray(row['evaluations']) ? row['evaluations'].length > 0 : object(row['evaluationRefs']) && Array.isArray(row['evaluationRefs']['employeeIds']) && row['evaluationRefs']['employeeIds'].length > 0) };
}
export function basicModel(controls: PresenterControls | null, prepared = false, orders: number | null = null) {
  const clock = controls ? dayClock(controls.now, controls.startsAt) : null;
  const unavailable = { phase: 'unavailable', headline: 'The scheme clock is not available', sub: 'Refresh the page to try again.', clock, release: { label: "Release tomorrow's cars", disabled: true, reason: 'The scheme clock is not available.', body: null as { mode: 'to'; to: string } | null } };
  if (!controls || !londonParts(controls.now)) return unavailable;
  const at = nextReleaseInstant(controls.now); if (!at) return unavailable;
  const next = relativeTime(at, controls.now); const released = releasedThisTick(controls); const allocation = allocationThisTick(controls);
  const inProgress = whole(orders) ? orders : successful(controls, 'lifecycle-approvals')?.['orders'];
  const body = { mode: 'to' as const, to: at }; const base = { clock, release: { label: '', disabled: false, reason: '', body: body as { mode: 'to'; to: string } | null } };
  const cars = released === null ? null : released === 0 ? 'No new cars in the last release' : `${released.toLocaleString('en-GB')} ${released === 1 ? 'car' : 'cars'} released`;
  if (whole(inProgress) && inProgress > 0) return { ...base, phase: 'accepted', headline: inProgress === 1 ? 'An order is in progress' : `${inProgress.toLocaleString('en-GB')} orders in progress`, sub: `Move on a day to take orders forward. Next release: ${next}.`, release: { ...base.release, label: 'Move on a day' } };
  if (allocation.offers > 0) return { ...base, phase: 'offered', headline: cars ?? 'Cars released', sub: `Open Car suitability below to explain the Buddy decisions. Next release: ${next}.`, release: { ...base.release, label: londonDaysBetween(controls.now, at) === 1 ? "Release the next day's cars" : `Release ${weekdayName(at)}'s cars` } };
  if (!prepared && !allocation.evaluated) return { ...base, phase: 'waiting', headline: 'Waiting for preferences', sub: 'No one has confirmed their preferences yet. Start again begins a fresh run with saved preferences.', release: { label: 'Waiting for preferences', disabled: true, reason: 'No one has confirmed their preferences yet.', body: null } };
  const label = londonDaysBetween(controls.now, at) !== 1 ? `Release ${weekdayName(at)}'s cars` : (released ?? 0) > 0 ? "Release the next day's cars" : "Release tomorrow's cars";
  return { ...base, phase: 'ready', headline: cars ?? 'Ready for the next release', sub: `Next release: ${next}.`, release: { ...base.release, label } };
}
