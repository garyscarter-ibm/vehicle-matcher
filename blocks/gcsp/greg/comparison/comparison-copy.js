// On-screen copy and number formatting for Greg's route comparison. No DOM. Display only: the stored result owns every figure.
import { humanise, formatDemoTime } from '../demand-copy.js';

export { formatDemoTime };
export const TITLE = 'Route comparison';
export const LEDE = 'Stored result of the fictional process comparison. Both routes get the same employees, cars and releases.';
export const BASELINE = "Today's release route";
export const BUDDY = 'Buddy route';
export const FALLBACK_CAVEAT = 'Calculated fit is not observed satisfaction.';
export const BAR_LABEL = 'Mean and range across seeds';
export const NOT_OBSERVED = 'Not observed';
export const LEAVES_OUT = 'What this replay leaves out';
export const DETAILS = 'Assumptions, seeds and provenance';
export const UNAVAILABLE = 'The stored comparison could not be loaded. Try again in a moment.';
export const REFUSED = 'Only the scheme ordering lead or the presenter can see the route comparison.';
export const EMPTY_TITLE = 'No comparison has been run for this demo yet';
export const EMPTY_NOTE = 'The presenter prepares it before the demo. Reload to check again.';
export const OLD_POLICY_TITLE = 'Older policy version';
export const oldPolicyText = (made, active) => `Made under policy ${made}. The active policy is ${active}. Prepare a new comparison to use it.`;

export const VERDICTS = Object.freeze({
  'buddy-better': 'Buddy route better',
  'current-better': "Today's release route better",
  'no-clear-difference': 'No clear difference',
  'insufficient-seeds': 'Too few seeds to compare',
});
export const BETTER_WHEN = Object.freeze({ higher: 'Higher is better', lower: 'Lower is better' });

// kind drives the unit: share (0..1 shown as %), days (car-days), count, fit (0..100).
const MEASURES = Object.freeze({
  acceptableCoverage: ['Covered before renewal', 'share'],
  carsNeverAllocated: ['Cars never allocated', 'count'],
  heldNotTakenCarDays: ['Car-days held but not taken', 'days'],
  declinedOffers: ['Offers declined', 'count'],
  expiredOffers: ['Offers expired', 'count'],
  failedClaims: ['Holds that expired untaken', 'count'],
  retries: ['Retries after a lost claim', 'count'],
  meanAcceptedFit: ['Calculated fit of accepted cars', 'fit'],
});
const GROUP = 'accessGroupCoverage:';
const measureInfo = (key) => (key.startsWith(GROUP) ? [`Covered before renewal: ${key.slice(GROUP.length).replace(/-/g, ' ')}`, 'share']
  : MEASURES[key] ?? [humanise(key), 'count']);
export const measureLabel = (key) => measureInfo(key)[0];
export const measureKind = (key) => measureInfo(key)[1];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const trim = (v, dp) => String(Math.round(v * 10 ** dp) / 10 ** dp);
const FORMATS = Object.freeze({
  share: (v) => `${trim(v * 100, 1)}%`,
  days: (v) => (v !== 0 && Math.abs(v) < 0.05 ? v.toFixed(3) : v.toFixed(1)),
  count: (v) => trim(v, 1),
  fit: (v) => v.toFixed(1),
});
/** A value in its measure's unit, or "Not observed" for null. */
export const formatMeasure = (kind, v) => (finite(v) ? FORMATS[kind](v) : NOT_OBSERVED);
/** As formatMeasure with an explicit sign, and "pts" for shares (a difference of two percentages). */
export function formatChange(kind, v) {
  if (!finite(v)) return NOT_OBSERVED;
  const body = FORMATS[kind](Math.abs(v));
  const sign = v > 0 && Number(body.replace('%', '')) !== 0 ? '+' : v < 0 && Number(body.replace('%', '')) !== 0 ? '-' : '';
  return `${sign}${kind === 'share' ? `${body.slice(0, -1)} pts` : body}`;
}
export function differenceText(kind, diff) {
  if (!finite(diff?.mean)) return `Difference (buddy minus today): ${NOT_OBSERVED}`;
  const range = finite(diff.min) && finite(diff.max) ? ` (${formatChange(kind, diff.min)} to ${formatChange(kind, diff.max)})` : '';
  return `Difference (buddy minus today): ${formatChange(kind, diff.mean)}${range}`;
}

export const STATUS_LABELS = Object.freeze({ assumed: 'Assumed', verified: 'Verified' });
export const statusLabel = (s) => STATUS_LABELS[s] ?? String(s ?? '');

// Experiments (FUCQ-176). Labels and plain descriptions; the stored result owns every figure.
export const EXPERIMENTS = Object.freeze({
  'process-only': { label: 'Process only', summary: 'Compares the buddy route with today\'s release route. Nothing else changes.' },
  'order-mix': { label: 'Order mix', summary: 'Changes which model lines the fictional employees order.' },
  points: { label: 'Points allowance', summary: 'Scales every employee\'s points allowance by one multiplier.' },
  'hold-sweep': { label: 'Hold duration', summary: 'Changes how long the buddy route holds a car, one run per chosen duration.' },
});
export const experimentLabel = (id) => EXPERIMENTS[id]?.label ?? humanise(id);
export const WHAT_IF = 'What-if: this value is tried here and never published as live policy.';
export const TODAY = 'today';
export const EXPERIMENT_VERDICTS = Object.freeze({
  'baseline-better': "Today's value better",
  'no-clear-difference': VERDICTS['no-clear-difference'],
  'insufficient-seeds': VERDICTS['insufficient-seeds'],
});
/** Verdict text for a tried value: a variant win names the value, a baseline win is as plain. Null for an unknown verdict. */
export const experimentVerdict = (verdict, valueText) => (verdict === 'variant-better' ? `${valueText} better` : EXPERIMENT_VERDICTS[verdict] ?? null);
export function experimentDifferenceText(kind, diff, valueText) {
  const head = `Difference (${valueText} minus today)`;
  if (!finite(diff?.mean)) return `${head}: ${NOT_OBSERVED}`;
  const range = finite(diff.min) && finite(diff.max) ? ` (${formatChange(kind, diff.min)} to ${formatChange(kind, diff.max)})` : '';
  return `${head}: ${formatChange(kind, diff.mean)}${range}`;
}

/** Whole seconds as "15 min", "2 h", "1 h 30 min"; anything else as plain seconds. */
export function formatHold(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) return String(seconds);
  if (seconds === 0 || seconds % 60 !== 0) return `${seconds} s`;
  const hours = Math.floor(seconds / 3600); const minutes = (seconds % 3600) / 60;
  return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : ''].filter(Boolean).join(' ');
}
const share = (v) => `${trim(v * 100, 1)}%`;
function formatMix(mix) {
  if (!Array.isArray(mix) || !mix.length || !mix.every((m) => m && typeof m.modelLine === 'string' && finite(m.weight) && m.weight >= 0)) return JSON.stringify(mix);
  const total = mix.reduce((sum, m) => sum + m.weight, 0);
  return total > 0 ? mix.map((m) => `${m.modelLine}: ${share(m.weight / total)}`).join(', ') : JSON.stringify(mix);
}
/** One stored value for people. experimentId picks the unit: hold seconds, points multiplier, or an order mix. */
export function formatExperimentValue(experimentId, value) {
  if (experimentId === 'hold-sweep') return formatHold(value);
  if (experimentId === 'points') return finite(value) ? `${trim(value, 2)} times the allowance` : String(value);
  if (experimentId === 'order-mix') return formatMix(value);
  return typeof value === 'string' ? value : JSON.stringify(value);
}

// Jobs. Counts come from the server; these words only describe them.
export const JOB_STATUS = Object.freeze({ starting: 'Starting', running: 'Running', succeeded: 'Finished', failed: 'Failed', interrupted: 'Stopped before it finished' });
export const PREPARING = 'Preparing the run.';
export const jobProgressText = ({ seedsDone, seedsTotal, stepsDone, stepsTotal }) => (stepsTotal === 0 ? PREPARING
  : `Seeds done: ${seedsDone} of ${seedsTotal}. Steps: ${stepsDone} of ${stepsTotal}.`);
