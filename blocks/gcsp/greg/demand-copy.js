// Plain-English copy, labels and formatting for the Greg dashboard. No DOM here.
// Display only: the server owns every threshold, gate and count (build-rules.md, central assumptions).

export const BASIS_LABEL = 'Expressed saved demand';
export const BASIS_NOTE = 'What employees have saved and confirmed they need. It is not satisfaction and not a prediction.';
export const NO_PREFERENCE = 'No preference stated';
export const MODEL_LINE_UNCONFIRMED = 'Model line not confirmed';

const FIELD_LABELS = Object.freeze({
  seats: 'Seats', boot: 'Boot space', equipment: 'Equipment', body: 'Body style', fuel: 'Fuel type',
  frontIsofix: 'Front ISOFIX', rearIsofix: 'Rear ISOFIX', modelLine: 'Model line', charging: 'Charging access',
  availableFrom: 'Available from', availableUntil: 'Available until',
});
const KEY_LABELS = Object.freeze({
  unspecified: NO_PREFERENCE, suv: 'SUV', mpv: 'MPV', phev: 'Plug-in hybrid', ev: 'Electric', hev: 'Hybrid', mhev: 'Mild hybrid',
  petrol: 'Petrol', diesel: 'Diesel', hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', coupe: 'Coupe', convertible: 'Convertible',
  home: 'Home', work: 'Work', either: 'Home or work',
});
const REASON_LABELS = Object.freeze({
  sportiness: 'Performance feel', comfort: 'Comfort', economy: 'Running costs', size: 'Size',
  other: 'Another reason', timing: 'Timing', points: 'Points cost', 'no-longer-needed': 'No longer needed',
  'just-not-this-one': 'Just not this car', unclassified: 'Reason not classified',
});
const OPERATORS = Object.freeze({ gte: 'at least', lte: 'at most', equals: 'is', includes: 'includes' });
const UNITS = Object.freeze({ count: '', L: ' litres', 'equipment-key': '' });

/** "noLongerNeeded" or "no-longer-needed" -> "No longer needed". */
export function humanise(code) {
  const text = String(code).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : String(code);
}
export const fieldLabel = (field) => FIELD_LABELS[field] || humanise(field);
export const keyLabel = (key) => KEY_LABELS[key] || (/^[a-z][a-z0-9-]*$/.test(String(key)) ? humanise(key) : String(key));
export const reasonLabel = (key) => REASON_LABELS[key] || FIELD_LABELS[key] || humanise(key);
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Demo-clock instant as "5 Nov 2026, 10:05 GMT" (UK time, explicit zone), or null when unreadable. */
export function formatDemoTime(iso) {
  const ms = Date.parse(iso);
  if (typeof iso !== 'string' || Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Europe/London', timeZoneName: 'short',
  });
}

function valueText(field, value, unit) {
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'number') return `${value}${UNITS[unit] ?? (unit ? ` ${unit}` : '')}`;
  if (field === 'modelLine') return String(value);
  return keyLabel(value);
}

/** Readable requirement, e.g. "Seats at least 5" or "Model line is G21 Touring". */
export function requirementText({ field, operator, value, unit }) {
  const name = fieldLabel(field);
  if (value === null || value === undefined) return `${name}, value not confirmed`;
  if (typeof value === 'boolean') return value ? `${name} required` : `${name} not required`;
  return `${name} ${OPERATORS[operator] || humanise(operator ?? 'is').toLowerCase()} ${valueText(field, value, unit)}`;
}

// Gate codes the shared recommendation and essential checks can report. 'blocker' rules a car out; 'confirm' waits on a fact.
const GATES = Object.freeze({
  'no-released-stock': ['blocker', 'No stock has been released yet'],
  'stock-not-visible': ['blocker', 'Released stock is not open to these employees'],
  'declined-unchanged': ['blocker', 'Declined car and the brief has not changed'],
  'essential-unmet': ['blocker', 'Essential not met'],
  'essential-unconfirmed': ['confirm', 'Essential not confirmed'],
  'availability-expired': ['blocker', 'Car availability has ended'],
  'not-available': ['blocker', 'Car is not available'],
  'not-yet-available': ['blocker', 'Car is not available yet'],
  'policy-exclude': ['blocker', 'Scheme rules exclude the car'],
  'required-by': ['blocker', 'Car arrives after the date needed'],
  'allowance-exceeded': ['blocker', 'Over the points allowance'],
  'driver-ineligible': ['blocker', 'Employee is not an eligible driver'],
  'charging-unavailable': ['blocker', 'Charging access does not suit the car'],
  'availability-date-unconfirmed': ['confirm', 'Availability date not confirmed'],
  'availability-unconfirmed': ['confirm', 'Car availability not confirmed'],
  'driver-unconfirmed': ['confirm', 'Driver eligibility not confirmed'],
  'eligibility-unconfirmed': ['confirm', 'Scheme eligibility not confirmed'],
  'employee-essentials-unconfirmed': ['confirm', 'Employee details not confirmed'],
  'required-by-unconfirmed': ['confirm', 'Date needed not confirmed'],
  'points-unavailable': ['confirm', 'Points cost not available'],
  'charging-unconfirmed': ['confirm', 'Charging access not confirmed'],
  'equipment-unconfirmed': ['confirm', 'Equipment not confirmed'],
  'fuel-unconfirmed': ['confirm', 'Fuel type not confirmed'],
});
export const GATE_SEVERITY_LABELS = Object.freeze({ blocker: 'Blocks the offer', 'needs-confirmation': 'Needs confirmation', unknown: 'Other reason' });

/** Gate code (optionally "code:field") -> { code, field, label, severity }. Unknown codes keep the code visible. */
export function gateInfo(key) {
  const text = String(key);
  const at = text.indexOf(':');
  const code = at < 0 ? text : text.slice(0, at);
  const field = at < 0 ? null : text.slice(at + 1);
  const known = GATES[code];
  if (!known) return { code: text, field, label: `Other reason (${text})`, severity: 'unknown' };
  const label = field ? `${known[1]}: ${fieldLabel(field)}` : known[1];
  return { code, field, label, severity: known[0] === 'blocker' ? 'blocker' : 'needs-confirmation' };
}
