// Plain employee copy: reason sentences, long dates and body labels. Pure, no DOM.
import { SPEC_LABELS } from '../../vehicle-matcher/modes/result-card.js';

const FIELDS = { body: 'Body style', fuel: 'Fuel', seats: 'Seats', boot: 'Boot', zeroTo62: '0 to 62 mph', mpg: 'Fuel economy',
  sportiness: 'Sportiness', comfort: 'Comfort', economy: 'Economy', size: 'Size', equipment: 'Equipment', charging: 'Charging',
  mileage: 'Mileage', colour: 'Colour', gearbox: 'Gearbox', doors: 'Doors', evRange: 'Electric range', insuranceGroup: 'Insurance group' };
const spaced = (v) => String(v).replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll(/[-_]+/g, ' ').trim().toLowerCase();
const upperFirst = (v) => v.charAt(0).toUpperCase() + v.slice(1);
/** A field key as a lower-case phrase ("body style"); never a raw key. */
const fieldWords = (key) => (FIELDS[key] ? FIELDS[key].replace(/^./, (c) => c.toLowerCase()) : key ? spaced(key) : 'requirement');
const fieldLabel = (key) => FIELDS[key] ?? upperFirst(fieldWords(key));
const count = (n) => n.toLocaleString('en-GB');
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

const DATE_ONLY = /^(\d{4})-(\d\d)-(\d\d)$/;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/;
const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-11-13" or an ISO instant as "Friday 13 November 2026"; null when not a real date. */
export function longDate(value) {
  if (typeof value !== 'string') return null;
  const day = DATE_ONLY.exec(value);
  if (day) {
    const [, y, m, d] = day.map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  } else if (!INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** Body style enum as label: "coupe" as "Coupé"; unknown values title-cased. */
export function bodyStyleLabel(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim();
  return SPEC_LABELS[key] ?? key.replaceAll(/[-_]+/g, ' ').toLowerCase().replaceAll(/(^|\s)\S/g, (c) => c.toUpperCase());
}

const FALLBACK = {
  reasons: 'This car meets one of your scheme\'s checks.',
  tradeOffs: 'This car differs from one of your preferences.',
  blockers: 'This car does not meet one of your scheme\'s checks.',
  unknowns: 'Something about this car still needs confirming.',
};

const SENTENCES = {
  'driver-eligible': () => 'Driver eligible.',
  'driver-ineligible': () => 'You are not eligible to drive this car.',
  'driver-unconfirmed': () => 'Your driver eligibility still needs confirming.',
  'policy-include': () => 'Included in your scheme.',
  'policy-exclude': () => 'Not offered under your scheme.',
  'eligibility-unconfirmed': () => 'Your scheme eligibility for this car still needs confirming.',
  'points-unavailable': () => 'The points cost for this car is not available yet.',
  'allowance-sufficient': () => 'Within your points allowance.',
  'allowance-exceeded': (e) => finite(e.allowance) && finite(e.monthlyPoints) && e.monthlyPoints > e.allowance
    ? `Over your allowance by ${count(e.monthlyPoints - e.allowance)} points a month.` : 'Over your points allowance.',
  'employee-essentials-unconfirmed': () => 'Your essential requirements have not been confirmed yet.',
  'essential-met': (e) => `Meets your ${fieldWords(e.field)} requirement.`,
  'essential-unmet': (e) => `Does not meet your ${fieldWords(e.field)} requirement.`,
  'essential-unconfirmed': (e) => `Your ${fieldWords(e.field)} requirement still needs confirming.`,
  'equipment-unconfirmed': () => 'Whether this car has the equipment you asked for is not confirmed.',
  'fuel-unconfirmed': () => 'The fuel type is not confirmed, so charging cannot be checked.',
  'charging-ready': () => 'You have the charging access this car needs.',
  'charging-unavailable': () => 'You do not have the charging access this car needs.',
  'charging-unconfirmed': () => 'Charging access is unknown. Confirm home or work charging.',
  'preference-fit': (e) => `${fieldLabel(e.field)}: ${e.score}% fit.`,
  'preference-unconfirmed': (e) => `Your ${fieldWords(e.field)} preference still needs confirming.`,
  'preference-fact-unknown': (e) => `This car's details are not complete enough to judge ${fieldWords(e.field)}.`,
  'not-available': () => 'Already reserved or no longer available.',
  'not-yet-available': (e) => longDate(e.availableFrom) ? `Not available until ${longDate(e.availableFrom)}.` : 'Not available yet.',
  'availability-expired': () => 'No longer available for collection.',
  'availability-unconfirmed': () => 'Availability of this car is not confirmed.',
  'availability-date-unconfirmed': () => 'The dates this car is available are not confirmed.',
  'required-by': (e) => longDate(e.requiredBy) ? `Not available by ${longDate(e.requiredBy)}.` : 'Not available by your required date.',
  'required-by-met': (e) => longDate(e.requiredBy) ? `Available by ${longDate(e.requiredBy)}.` : 'Available by your required date.',
  'required-by-unconfirmed': () => 'Your collection deadline still needs confirming.',
  'required-by-already-passed': () => 'Your collection deadline has already passed.',
  'renewal-already-passed': () => 'Your renewal date has already passed.',
  'insurance-grade-limit': (e) => finite(e.maximum) && finite(e.actual)
    ? `Insurance group ${e.actual} is above your limit of ${e.maximum}.` : 'Insurance group is above your limit.',
  'insurance-unconfirmed': () => 'The insurance group for this car is not confirmed.',
  'licence-unconfirmed': () => 'Your licence details still need confirming.',
  'licence-not-valid-at-collection': () => 'Your licence is not valid on the collection date.',
  'locally-excluded': () => 'You have ruled this car out.',
};

/** One server reason, trade-off, blocker or unknown as a plain sentence; never a code or field name. */
export function reasonText(entry, kind) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return FALLBACK[kind] ?? FALLBACK.unknowns;
  if (entry.text || entry.reason) return entry.text || entry.reason;
  const sentence = Object.hasOwn(SENTENCES, entry.code) ? SENTENCES[entry.code](entry) : null;
  return sentence ?? FALLBACK[kind] ?? FALLBACK.unknowns;
}
