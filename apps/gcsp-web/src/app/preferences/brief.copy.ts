type Reason = Readonly<Record<string, unknown>>;
const labels: Readonly<Record<string, string>> = { body: 'body style', fuel: 'fuel', seats: 'seats', boot: 'boot', zeroTo62: '0 to 62 mph', mpg: 'fuel economy', sportiness: 'sportiness', comfort: 'comfort', economy: 'economy', size: 'size', equipment: 'equipment', charging: 'charging', insuranceGroup: 'insurance group' };
export const words = (v: unknown): string => typeof v === 'string' ? v.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase() : 'requirement';
const field = (v: unknown): string => labels[String(v)] ?? words(v);
const title = (v: string): string => v.replace(/^./, (c) => c.toUpperCase());
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const enumLabels: Readonly<Record<string, string>> = { ev: 'Electric', phev: 'Plug-in hybrid', petrol: 'Petrol', diesel: 'Diesel', suv: 'SUV', coupe: 'Coupé', saloon: 'Saloon', estate: 'Estate', hatchback: 'Hatchback', convertible: 'Convertible', mpv: 'Family carrier' };
export const choiceLabel = (v: unknown): string => enumLabels[String(v)] ?? title(words(v));
const date = (v: unknown): string | null => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(v) || !Number.isFinite(Date.parse(v))) return null;
  if (!v.includes('T') && new Date(v).toISOString().slice(0, 10) !== v) return null;
  return new Date(v).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: v.includes('T') ? 'Europe/London' : 'UTC' });
};
const preferenceFit = (e: Reason): string => {
  const key = String(e['field']); const matched = finite(e['score']) && e['score'] >= 100;
  if (['body', 'fuel'].includes(key)) {
    const desired = e['desired']; const wanted = typeof desired === 'string' && desired ? choiceLabel(desired) : null;
    const facts = e['facts']; const fact = facts && typeof facts === 'object' ? (facts as Reason)[key] : null;
    const observed = fact && typeof fact === 'object' ? (fact as Reason)['value'] : null;
    if (matched) return wanted ? `${wanted}, the ${field(key)} you prefer.` : `This car matches your ${field(key)} preference.`;
    if (!wanted) return `This car differs from your ${field(key)} preference.`;
    return observed ? `${choiceLabel(observed)}, not the ${/^[A-Z]{2,}$/.test(wanted) ? wanted : wanted.toLowerCase()} you prefer.` : `Not the ${/^[A-Z]{2,}$/.test(wanted) ? wanted : wanted.toLowerCase()} you prefer.`;
  }
  if (matched) return `${title(field(key))} matches your preference.`;
  const scales: Record<string, readonly [string, string]> = { sportiness: ['Less sporty than you prefer.', 'Sportier than you prefer.'], comfort: ['Less comfortable than you prefer.', 'More comfortable than you prefer.'], economy: ['Less economical than you prefer.', 'More economical than you prefer.'], size: ['Smaller than you prefer.', 'Larger than you prefer.'] };
  return scales[key] && finite(e['desired']) && finite(e['observed']) && e['desired'] !== e['observed'] ? scales[key][e['observed'] < e['desired'] ? 0 : 1] : `${title(field(key))} differs from your preference.`;
};
const fixed: Readonly<Record<string, string>> = {
  'driver-eligible': 'Driver eligible.', 'driver-ineligible': 'You are not eligible to drive this car.', 'driver-unconfirmed': 'Your driver eligibility still needs confirming.',
  'policy-include': 'Included in your scheme.', 'policy-exclude': 'Not offered under your scheme.', 'eligibility-unconfirmed': 'Your scheme eligibility for this car still needs confirming.',
  'points-unavailable': 'The points cost for this car is not available yet.', 'allowance-sufficient': 'Within your points allowance.',
  'employee-essentials-unconfirmed': 'Your essential requirements have not been confirmed yet.', 'equipment-unconfirmed': 'Whether this car has the equipment you asked for is not confirmed.',
  'fuel-unconfirmed': 'The fuel type is not confirmed, so charging cannot be checked.', 'charging-ready': 'You have the charging access this car needs.', 'charging-unavailable': 'You do not have the charging access this car needs.', 'charging-unconfirmed': 'Charging access is unknown. Confirm home or work charging.',
  'not-available': 'Already reserved or no longer available.', 'availability-expired': 'No longer available for collection.', 'availability-unconfirmed': 'Availability of this car is not confirmed.', 'availability-date-unconfirmed': 'The dates this car is available are not confirmed.',
  'required-by-unconfirmed': 'Your collection deadline still needs confirming.', 'required-by-already-passed': 'Your collection deadline has already passed.', 'renewal-already-passed': 'Your renewal date has already passed.',
  'insurance-unconfirmed': 'The insurance group for this car is not confirmed.', 'licence-unconfirmed': 'Your licence details still need confirming.', 'licence-not-valid-at-collection': 'Your licence is not valid on the collection date.', 'locally-excluded': 'You have ruled this car out.',
  'feedback-similar': 'Similar to your current car, which you rated highly.', 'feedback-different': 'Different from the current car you rated poorly.', 'same-again-match': 'The same model and specification as your current car, as you asked.',
  'feedback-similar-omitted': 'Too similar to your current car, which you rated poorly.', 'feedback-not-similar-or-better': 'Neither similar to your current car nor better on your preferences.', 'same-again-different': 'The same model and specification could not be confirmed.',
};
export function reasonText(e: Reason, kind: string): string {
  for (const key of ['text', 'reason']) if (typeof e[key] === 'string' && e[key]) return e[key];
  const code = String(e['code']); if (Object.hasOwn(fixed, code)) return fixed[code];
  switch (code) {
    case 'allowance-exceeded': return finite(e['allowance']) && finite(e['monthlyPoints']) && e['monthlyPoints'] > e['allowance'] ? `Over your allowance by ${(e['monthlyPoints'] - e['allowance']).toLocaleString('en-GB')} points a month.` : 'Over your points allowance.';
    case 'essential-met': return `Meets your ${field(e['field'])} requirement.`;
    case 'essential-unmet': return `Does not meet your ${field(e['field'])} requirement.`;
    case 'essential-unconfirmed': return `Your ${field(e['field'])} requirement still needs confirming.`;
    case 'preference-fit': return preferenceFit(e);
    case 'preference-unconfirmed': return `Your ${field(e['field'])} preference still needs confirming.`;
    case 'preference-fact-unknown': return `This car's details are not complete enough to judge ${field(e['field'])}.`;
    case 'not-yet-available': return date(e['availableFrom']) ? `Not available until ${date(e['availableFrom'])}.` : 'Not available yet.';
    case 'required-by': return date(e['requiredBy']) ? `Not available by ${date(e['requiredBy'])}.` : 'Not available by your required date.';
    case 'required-by-met': return date(e['requiredBy']) ? `Available by ${date(e['requiredBy'])}.` : 'Available by your required date.';
    case 'insurance-grade-limit': return finite(e['maximum']) && finite(e['actual']) ? `Insurance group ${e['actual']} is above your limit of ${e['maximum']}.` : 'Insurance group is above your limit.';
    case 'feedback-improvement': { const keys = Array.isArray(e['keys']) ? e['keys'].filter((key) => typeof key === 'string' && key).map(field) : []; const list = keys.length < 2 ? keys.join('') : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`; return list ? `Better than your current car for ${list}.` : 'Better than your current car for your preferences.'; }
    default: return ({ reasons: "This car meets one of your scheme's checks.", tradeOffs: 'This car differs from one of your preferences.', blockers: "This car does not meet one of your scheme's checks.", unknowns: 'Something about this car still needs confirming.' } as Record<string, string>)[kind] ?? 'Something about this car still needs confirming.';
  }
}
