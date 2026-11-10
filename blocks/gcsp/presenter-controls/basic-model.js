// Basic console body: what the server reports, mapped to one headline and one primary button. Pure, no DOM.
// User agnostic: counts only, never an employee's name, match or offer.
import { londonParts, londonInstant, londonDaysBetween, relativeTime, dayClock, weekdayName } from '../kit/friendly-time.js';

const RELEASE_AT = { hour: 11, minute: 30 };
const own = (tick, handlerId) => (Array.isArray(tick?.outcomes) ? tick.outcomes : []).find((row) => row?.handlerId === handlerId);
const okValue = (row) => (row?.outcome?.status === 'ok' ? row.outcome.value : undefined);
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The first weekday 11:30am in London after today's London date. */
export function nextReleaseInstant(nowIso) {
  const today = londonParts(nowIso); if (!today) return null;
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    const weekday = date.getUTCDay();
    if (weekday >= 1 && weekday <= 5) return londonInstant({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
      day: date.getUTCDate(), ...RELEASE_AT });
  }
  return null;
}

/** Cars the last tick's stock release reported for this run, or null when it reported none it can vouch for. */
export function releasedThisTick(controls) {
  const tick = controls?.lastTick; const value = okValue(own(tick, 'stock-release'));
  if (!tick || tick.runId !== controls.runId || !value || value.runId !== controls.runId || value.tickId !== tick.tickId
    || !['stock-released', 'no-release'].includes(value.kind) || !Array.isArray(value.orderUuids)) return null;
  return value.orderUuids.length;
}

// Offers the last buddy allocation made, and whether it evaluated anyone (so someone had confirmed preferences).
function allocationThisTick(controls) {
  const value = okValue(own(controls?.lastTick, 'buddy-allocation'));
  const rows = Array.isArray(value?.allocations) ? value.allocations : [];
  return { offers: rows.reduce((n, row) => n + (Array.isArray(row?.assignments) ? row.assignments.length : 0), 0),
    evaluated: rows.some((row) => (row?.evaluations?.length ?? row?.evaluationRefs?.employeeIds?.length ?? 0) > 0) };
}

function ordersInProgress(controls, orders) {
  if (Number.isSafeInteger(orders) && orders >= 0) return orders;
  const value = okValue(own(controls?.lastTick, 'lifecycle-approvals'));
  return Number.isSafeInteger(value?.orders) ? value.orders : 0;
}

const unavailable = { phase: 'unavailable', headline: 'The scheme clock is not available', sub: 'Refresh the page to try again.',
  clock: null, exactNow: null, nextRelease: null, releaseAt: null,
  release: { label: "Release tomorrow's cars", disabled: true, reason: 'The scheme clock is not available.', body: null } };

/**
 * controls: the /presenter/controls value; scenario: the current scenario's catalogue entry (inputs, clockStart);
 * orders: an optional count of orders in progress. Returns the phase, copy and the Release button with its tick body.
 */
export function basicModel({ controls, scenario = null, orders = null } = {}) {
  const now = controls?.now;
  if (!controls || !londonParts(now) || typeof controls.clockVersion !== 'string') return structuredClone(unavailable);
  const at = nextReleaseInstant(now);
  const next = relativeTime(at, now);
  const base = { clock: dayClock(now, scenario?.clockStart), exactNow: now, nextRelease: next, releaseAt: at };
  const body = { expectedClockVersion: controls.clockVersion, mode: 'to', to: at };
  const released = releasedThisTick(controls);
  const allocation = allocationThisTick(controls);
  const briefs = Array.isArray(scenario?.inputs?.briefs) && scenario.inputs.briefs.length > 0;
  const inProgress = ordersInProgress(controls, orders);
  const cars = released === null ? null : released === 0 ? 'No new cars in the last release' : `${count(released, 'car', 'cars')} released`;

  if (inProgress > 0) {
    return { ...base, phase: 'accepted', headline: inProgress === 1 ? 'An order is in progress' : `${count(inProgress, 'order', 'orders')} in progress`,
      sub: `Move on a day to take orders forward. Next release: ${next}.`, release: { label: 'Move on a day', disabled: false, reason: '', body } };
  }
  if (allocation.offers > 0) {
    return { ...base, phase: 'offered', headline: cars ?? 'Cars released',
      sub: `Matches and offers show only in each employee's own portal. Next release: ${next}.`,
      release: { label: londonDaysBetween(now, at) === 1 ? "Release the next day's cars" : `Release ${weekdayName(at)}'s cars`,
        disabled: false, reason: '', body } };
  }
  if (!briefs && !allocation.evaluated) {
    return { ...base, phase: 'waiting', headline: 'Waiting for preferences',
      sub: 'No one has confirmed their preferences yet. Start again begins a fresh run with saved preferences.',
      release: { label: 'Waiting for preferences', disabled: true, reason: 'No one has confirmed their preferences yet.', body: null } };
  }
  // A weekday name beats "next day" (Friday reads "Release Monday's cars"); after a release or offer it is "the next day's".
  const label = londonDaysBetween(now, at) !== 1 ? `Release ${weekdayName(at)}'s cars`
    : (released ?? 0) > 0 ? "Release the next day's cars" : "Release tomorrow's cars";
  return { ...base, phase: 'ready', headline: cars ?? 'Ready for the next release', sub: `Next release: ${next}.`,
    release: { label, disabled: false, reason: '', body } };
}

export const MAIN_JOURNEY = 'main-successful-journey';

/** The catalogue entry for the current scenario, or null. */
export function currentEntry(controls, catalogue) {
  const current = controls?.currentScenario; const rows = Array.isArray(catalogue?.scenarios) ? catalogue.scenarios : [];
  return current ? rows.find((row) => row.scenarioId === current.scenarioId && row.fixtureVersion === current.fixtureVersion) ?? null : null;
}

/** The reset body for a fresh Main successful journey run, or { body: null, reason } when it can't start. */
export function startAgainBody({ controls, catalogue }) {
  const entry = (Array.isArray(catalogue?.scenarios) ? catalogue.scenarios : []).find((row) => row.scenarioId === MAIN_JOURNEY);
  if (!entry || entry.availability?.available !== true) return { body: null, reason: 'A fresh run is not available right now.' };
  if (typeof controls?.runId !== 'string' || !Number.isSafeInteger(controls.runVersion)) return { body: null, reason: 'The scheme clock is not available.' };
  return { body: { expectedRunId: controls.runId, expectedRunVersion: controls.runVersion, scenarioId: entry.scenarioId,
    scenarioVersion: entry.scenarioVersion, fixtureVersion: entry.fixtureVersion, policyVersion: catalogue.policyVersion }, reason: '' };
}
