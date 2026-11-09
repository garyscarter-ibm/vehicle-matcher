// Plain-English copy and formatting for Greg's order plan panel. No DOM here.
// Display only: the server owns every number, bound, gate and constraint (build-rules.md, central assumptions).
import { gbp } from '../../../vehicle-matcher/ui.js';
import { humanise, plural, formatDemoTime, gateInfo } from '../demand-copy.js';

export { humanise, plural, formatDemoTime };

export const FORECAST_LABEL = 'Expressed demand';
export const FORECAST_QUALIFIER = 'deterministic baseline';
export const FORECAST_NOTE = 'Built from what employees have saved and confirmed they need. It is not a prediction.';
export const LEARNED_LABEL = 'Synthetic-trained model';
export const LEARNED_UNREADABLE = 'The learned forecast is unavailable right now, so only the baseline plan is shown.';
export const PREVIEW_BADGE = 'Preview';
export const PREVIEW_FALLBACK = 'Preview only. Nothing is saved, published or ordered.';
export const NO_ORDER = 'No new order recommended';
export const INFEASIBLE_ACTION = 'No plan meets these limits';
export const NO_DEMAND_ACTION = 'No saved demand to plan for yet';
export const NO_DEMAND_NOTE = 'Employees need to save and confirm a brief with a renewal date before a plan can be made.';

export const REQUEST_LINK = 'See this request in Order requests';
export const ORDER_REQUESTS_ID = 'gcsp-order-requests';
export const requestedHeadline = (n) => `${plural(n, 'vehicle')} requested from Production`;
export const requestedNotice = (at) => `Requested${at ? ` at ${at}` : ''}. Production has not confirmed anything yet.`;
/** Items from requestedLimitText -> the note shown above the editable limits while a request is with Production. */
export function requestedLimitsNote(items) {
  const joined = items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
  return `The limits below are the plan in force. Your request for ${joined} is with Production.`;
}
export const recommendationLine = (n, text) => `Under the current limits the plan recommends ${plural(n, 'vehicle')}: ${text}.`;

export const UNBOUND_TITLE = 'Cars left out of this plan';
/** Server count and model names of cars not in the ordering list -> the one notice sentence. */
export function unboundStockText(count, models = []) {
  const one = count === 1;
  return `${count} new ${one ? "car isn't" : "cars aren't"} in the ordering list yet, so this plan leaves ${one ? 'it' : 'them'} out${models.length ? `: ${models.join(', ')}` : ''}.`;
}

const INPUT_LABELS = Object.freeze({
  stock: 'Stock', supply: 'Production requests and supply', policy: 'Limits and rules', plan: 'The plan itself',
  clock: 'Demo clock', forecast: 'Demand forecast', cohort: 'Employee group', catalog: 'Vehicle catalogue',
});
export const inputLabel = (key) => INPUT_LABELS[key] || humanise(key);

export const ALTERNATIVE_LABELS = Object.freeze({ 'zero-new-orders-baseline': 'No new orders', 'next-best-distinct-feasible': 'Next best plan' });
export const alternativeLabel = (kind) => ALTERNATIVE_LABELS[kind] || humanise(kind);

// Planner gate codes (solver explain). Eligibility gate codes fall through to the shared dashboard copy.
const PLAN_GATES = Object.freeze({
  'renewal-already-passed': 'The renewal date has already passed',
  'required-by-already-passed': 'The date needed has already passed',
  'no-permitted-acceptable-choice': 'No permitted car suits this employee',
  'stock-not-visible': 'Suitable stock is not open to this employee',
  'held-for-another-entitlement': 'Suitable stock is held for someone else',
  'declined-unchanged': 'The only suitable car was declined and the brief has not changed',
  'arrival-after-renewal': 'Suitable supply arrives after the renewal date',
  'arrival-after-required-by': 'Suitable supply arrives after the date needed',
  'objective-tradeoff': 'Another vehicle is allowed but would not improve the plan',
  'acceptable-supply-scarcity': 'No more suitable vehicles can be ordered inside the limits',
});

/** Gate code (optionally "code:id") -> plain sentence. Unknown codes stay visible as "Other reason (code)". */
export function gateText(code, nameOf = (id) => id) {
  const text = String(code);
  const at = text.indexOf(':');
  const head = at < 0 ? text : text.slice(0, at);
  if (head === 'derivative-representation-not-fully-eligible' && at > 0) return `Not every version of ${nameOf(text.slice(at + 1))} is eligible`;
  if (PLAN_GATES[text]) return PLAN_GATES[text];
  return gateInfo(text).label;
}

export function formatDate(iso) {
  const ms = Date.parse(iso);
  if (typeof iso !== 'string' || Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

/** Whole pounds from minor units, e.g. 4200000 -> "£42,000". Other currencies keep their code. */
export function money(minor, currency = 'GBP') {
  if (!Number.isFinite(minor)) return '';
  return currency === 'GBP' ? gbp(minor / 100) : `${(minor / 100).toLocaleString('en-GB')} ${currency}`;
}

// Server constraint text quotes budgets in minor units; show pounds instead.
export function detailText(detail, currency = 'GBP') {
  return String(detail ?? '').replace(/Spend (\d+) exceeds (\d+) [A-Z]{3} minor units\./,
    (_, spend, budget) => `Spend ${money(Number(spend), currency)} is over the ${money(Number(budget), currency)} budget.`);
}

export function quantityLabel(n) { return plural(n, 'vehicle'); }

const REQUEST_STATES = Object.freeze({ requested: 'Requested', 'partly-confirmed': 'Partly confirmed', confirmed: 'Confirmed',
  delayed: 'Delayed', released: 'Released', 'partly-released': 'Partly released' });
export const requestStateLabel = (state) => REQUEST_STATES[state] || humanise(state);

/** Latest Production response -> "Production partly confirmed 1 vehicle". */
export function responseLabel(after) {
  if (!after || typeof after !== 'object') return null;
  const n = Number.isInteger(after.quantity) ? quantityLabel(after.quantity) : null;
  if (after.kind === 'confirmed') return `Production confirmed ${n ?? 'the order'}`;
  if (after.kind === 'partly-confirmed') return `Production partly confirmed ${n ?? 'the order'}`;
  if (after.kind === 'released') return `Production released ${n ?? 'vehicles'} to stock`;
  if (after.kind === 'delayed') {
    const until = formatDate(after.delayUntil);
    return `Production delayed the order${until ? ` to ${until}` : ''}${after.reason ? ` (${after.reason})` : ''}`;
  }
  return `Production response: ${humanise(after.kind)}`;
}

export const SUBMISSION_LABELS = Object.freeze({
  submitted: 'Submitted. Production has not confirmed anything yet.',
  replanned: 'Production has responded, so the plan has been recalculated.',
});

/** Signed change for a table cell: "+1", "-2" or "No change". */
export function changeLabel(change) {
  if (!Number.isFinite(change) || change === 0) return 'No change';
  return change > 0 ? `+${change}` : `-${Math.abs(change)}`;
}
