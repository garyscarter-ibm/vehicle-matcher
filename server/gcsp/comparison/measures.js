import { freezeVehicleData } from '../../vehicles/index.js';
import { ComparisonRunError } from './harness.js';

export const RULE_KEY = 'comparison.noClearDifferenceRule';
export const MEASURE_NAMES = Object.freeze(['acceptableCoverage', 'carsNeverAllocated', 'heldNotTakenCarDays',
  'declinedOffers', 'expiredOffers', 'failedClaims', 'retries', 'meanAcceptedFit', 'accessGroupCoverage']);
const SCALAR_MEASURES = MEASURE_NAMES.filter((name) => name !== 'accessGroupCoverage');
const GROUP_PREFIX = 'accessGroupCoverage:';

const refuse = (boundary) => { throw new ComparisonRunError('invalid-input', boundary); };
// Adding zero turns a rounded -0 into 0, so stored JSON and fresh values compare equal.
const round = (number, places = 6) => Math.round(number * 10 ** places) / 10 ** places + 0;
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Acceptable means taken by renewal with underlying calculated fit at or above the record's threshold.
const covered = (row, threshold) => row.outcome === 'taken' && Date.parse(row.takenAt) <= Date.parse(row.renewalAt)
  && Number.isFinite(row.fit?.underlying) && row.fit.underlying >= threshold;

/** The per-route measures of one FUCQ-134/135 outcome record. */
export function routeMeasures(record) {
  if (!record || !['current', 'buddy'].includes(record.route) || !Array.isArray(record.employees) || !Array.isArray(record.cars)
    || !numeric(record.threshold) || !record.totals) refuse('outcome-record');
  const { employees, cars, totals, threshold } = record;
  const acceptable = employees.filter((row) => covered(row, threshold));
  const groups = {};
  for (const row of employees) {
    groups[row.accessGroup] ??= { members: 0, covered: 0 };
    groups[row.accessGroup].members += 1;
    if (covered(row, threshold)) groups[row.accessGroup].covered += 1;
  }
  const carDays = record.route === 'buddy' ? totals.heldNotTakenHours / 24
    : cars.reduce((sum, car) => sum + car.heldNotTakenSeconds / 86400, 0);
  return freezeVehicleData({
    acceptableCoverage: employees.length ? round(acceptable.length / employees.length) : null,
    carsNeverAllocated: cars.filter((car) => car.outcome !== 'allocated').length,
    heldNotTakenCarDays: round(carDays),
    declinedOffers: totals.declines ?? 0,
    expiredOffers: totals.offerExpiries ?? 0,
    failedClaims: totals.expiries,
    retries: totals.retries,
    meanAcceptedFit: acceptable.length ? round(acceptable.reduce((sum, row) => sum + row.fit.underlying, 0) / acceptable.length, 2) : null,
    accessGroupCoverage: Object.fromEntries(Object.keys(groups).sort(byId).map((id) => [id, round(groups[id].covered / groups[id].members)])),
  });
}

/** Mean, minimum and maximum over the seeds that observed the measure. */
export function summariseSeeds(values) {
  const seen = (Array.isArray(values) ? values : []).filter(numeric);
  if (!seen.length) return Object.freeze({ mean: null, min: null, max: null, observedSeeds: 0 });
  return Object.freeze({ mean: round(seen.reduce((sum, value) => sum + value, 0) / seen.length),
    min: Math.min(...seen), max: Math.max(...seen), observedSeeds: seen.length });
}

const DIRECTIONS = ['higher', 'lower'];
function validRule(ruleRow) {
  const rule = ruleRow?.value;
  if (!rule || rule.schemaVersion !== 1 || rule.rule !== 'route-seed-ranges-overlap' || typeof rule.overlapInclusive !== 'boolean'
    || !Number.isSafeInteger(rule.minimumSeeds) || rule.minimumSeeds < 1 || !rule.betterWhen || typeof rule.betterWhen !== 'object'
    || MEASURE_NAMES.some((name) => !DIRECTIONS.includes(rule.betterWhen[name]))) refuse(RULE_KEY);
  return rule;
}

function entry(measure, betterWhen, pairs, rule) {
  const current = summariseSeeds(pairs.map(([c]) => c));
  const buddy = summariseSeeds(pairs.map(([, b]) => b));
  const both = pairs.filter(([c, b]) => numeric(c) && numeric(b));
  const diffs = both.map(([c, b]) => round(b - c));
  const difference = Object.freeze({ mean: current.observedSeeds && buddy.observedSeeds ? round(buddy.mean - current.mean) : null,
    min: diffs.length ? Math.min(...diffs) : null, max: diffs.length ? Math.max(...diffs) : null });
  let verdict;
  if (both.length < rule.minimumSeeds) verdict = 'insufficient-seeds';
  else {
    const overlap = rule.overlapInclusive ? current.min <= buddy.max && buddy.min <= current.max
      : current.min < buddy.max && buddy.min < current.max;
    // A shared single point is not a difference even when overlap is exclusive.
    const samePoint = current.min === current.max && buddy.min === buddy.max && current.min === buddy.min;
    if (overlap || samePoint) verdict = 'no-clear-difference';
    else verdict = (buddy.min > current.max) === (betterWhen === 'higher') ? 'buddy-better' : 'current-better';
  }
  return { measure, betterWhen, current, buddy, difference, verdict };
}

/** One honest entry per measure and access group; nothing is dropped, so wins and losses both show. */
export function compareRoutes(perSeed, ruleRow) {
  const rule = validRule(ruleRow);
  if (!Array.isArray(perSeed)) refuse('perSeed');
  const groups = [...new Set(perSeed.flatMap((seed) => ['current', 'buddy'].flatMap((route) => Object.keys(seed[route]?.accessGroupCoverage ?? {}))))].sort(byId);
  const pairsOf = (read) => perSeed.map((seed) => [read(seed.current), read(seed.buddy)]);
  return freezeVehicleData([
    ...SCALAR_MEASURES.map((name) => entry(name, rule.betterWhen[name], pairsOf((m) => m?.[name]), rule)),
    ...groups.map((id) => entry(`${GROUP_PREFIX}${id}`, rule.betterWhen.accessGroupCoverage, pairsOf((m) => m?.accessGroupCoverage?.[id]), rule)),
  ]);
}
