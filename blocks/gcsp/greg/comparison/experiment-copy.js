// On-screen copy for the experiment picker, the hold rerun and the job strip. No DOM; the stored result and the server own every figure.
import { humanise } from '../demand-copy.js';
import { experimentLabel } from './comparison-copy.js';

export const PICKER_LABEL = 'Experiment';
export const NO_STORED = 'not run yet';
export const UNREADABLE = 'stored result could not be read';
export const stateText = (made) => `stored ${made}`;
export const NO_RESULT_TITLE = 'No stored result yet';
export const NO_RESULT_NOTE = 'This comparison has not been run yet.';
export const NO_PREVIOUS = 'No previous result';
export const NO_PREVIOUS_NOTE = 'The new result appears here when the run finishes.';
export const UNREADABLE_NOTE = 'The stored result for this experiment could not be read. Reload to try again.';
export const resultHeading = (kind, made) => (kind === 'new' ? `New result, made ${made}` : kind === 'previous' ? `Previous result, made ${made}. Still the latest stored.` : `Stored result, made ${made}`);
export const lastRun = (finishedAt, reason) => `Last run ${finishedAt}: ${reason}`;

export const FORM_TITLE = 'Try other hold durations';
export const HOURS_LABEL = 'Hold durations, in hours';
export const BASIS_LABEL = 'Why try these';
export const RUN_LABEL = 'Run the hold comparison';
export const RUNNING_REASON = 'A comparison is running.';
export const SUMMARY_TITLE = 'Check the hold comparison';
export const BASIS_MAX = 500; // The worker-start request shape (shared-contracts, FUCQ-175), not a policy value.
export const HOURS_HINT = 'Separate with commas. Decimals are fine: 0.25 is 15 minutes.';
export const SERVER_CHECKS = 'The service checks the range and how many.';
export function boundsHint(bounds, format) {
  if (!bounds || (bounds.minimum === null && bounds.maximum === null && bounds.maximumValues === null)) return `${HOURS_HINT} ${SERVER_CHECKS}`;
  const range = bounds.minimum !== null && bounds.maximum !== null ? ` From ${format(bounds.minimum)} to ${format(bounds.maximum)}.` : '';
  const most = bounds.maximumValues !== null ? ` Up to ${bounds.maximumValues} values.` : '';
  return `${HOURS_HINT}${range}${most} Not the value used today.`;
}
export const ERR_NONE = 'Give at least one hold duration.';
export const errNumber = (piece) => `"${piece}" is not a positive number of hours.`;
export const errWhole = (piece) => `"${piece}" hours is not a whole number of seconds.`;
export const ERR_DUPLICATE = 'Give each hold only once.';
export const ERR_BASIS_NONE = 'Say why these holds are worth trying.';
export const ERR_BASIS_LONG = `Keep this to ${BASIS_MAX} characters or fewer.`;
export const REFUSED_START = 'Only the scheme ordering lead or the presenter can start a comparison.';
export const START_UNAVAILABLE = 'The comparison could not be started. Try again in a moment.';
export const INVALID_FALLBACK = 'The service did not accept these values. Check them and try again.';

export const runName = (experimentId) => (experimentId === 'hold-sweep' ? 'hold comparison' : `${experimentLabel(experimentId).toLowerCase()} comparison`);
export const FAILED_TITLE = (id) => `The ${runName(id)} failed`;
export const STOPPED_TITLE = (id) => `The ${runName(id)} stopped before it finished`;
export const NO_RESULT_STORED = 'No result was stored. The result below is still the latest stored.';
export const NO_RESULT_STORED_NONE = 'No result was stored.';
export const STORED_READ_BACK = 'New result stored and read back.';
export const NOT_READ_BACK = 'The run finished but its result could not be read back. Reload to try again.';
export const LOST_CONTACT = 'Lost contact with the comparison. Reload to check it.';
export const NOT_TRACKED = 'The comparison was started but could not be tracked. Reload to check it.';
export const LOADING = 'Loading the stored comparisons';
export const LOADED = 'Stored comparisons loaded.';
export const jobLine = (v) => `${v.label}: ${v.statusLabel.toLowerCase()}.${v.requested?.text ? ` Trying ${v.requested.text}.` : ''}`;
export const STARTING = 'Starting the comparison.';
export const LEDE = 'Stored results of the comparison. Both routes get the same employees, cars and releases.';
export const CONFLICT = 'A comparison is already running. Wait for it to finish.';

// Plain names for policy and experiment keys. The raw key stays in the details table as provenance.
export const SETTING_COLUMN = 'Setting';
export const KEY_COLUMN = 'Key';
export const PARAMETER_LABELS = Object.freeze({
  'hold.buddy.durationSeconds': 'How long the buddy route holds a car',
  'hold.cart.durationSeconds': 'How long a car stays in a cart',
  'hold.cart.orderReview.durationSeconds': 'How long a car is held while the order is reviewed',
  'brief.slider.minimum': 'Lowest slider setting in a brief',
  'brief.slider.maximum': 'Highest slider setting in a brief',
  'offer.declinedCar.exclusion': 'When a declined car can be offered again',
  'allocation.tieBreak.rule': 'How ties between employees are settled',
  'comparison.modelLineMix': 'Which model lines employees order',
  'comparison.pointsAllowanceMultiplier': 'Multiplier on every points allowance',
  'comparison.acceptableFitThreshold': 'Lowest calculated fit counted as acceptable',
  'comparison.buddyRoute.v1': 'How the buddy route is modelled',
  'comparison.manualRoute.v1': "How today's release route is modelled",
  'comparison.noClearDifferenceRule': 'Rule for calling a difference clear',
  'comparison.experiments.v1': 'What each experiment may change',
  'offer.declineReasons.v1': 'Reasons an employee can give for declining',
});
export const parameterLabel = (key) => PARAMETER_LABELS[key] ?? humanise(String(key).replace(/\./g, ' '));
