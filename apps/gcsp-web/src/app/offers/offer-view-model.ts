import { OfferExplanation, OfferFact, OfferFailure, OfferProjection, OfferSimpleValue } from './offer.types';
import { VehicleDetailRow } from '../kit/vehicle-details.component';

const labels: Readonly<Record<string, string>> = {
  eligibilityModelKey: 'Scheme model', body: 'Body style', fuel: 'Fuel', seats: 'Seats', doors: 'Doors', boot: 'Boot',
  zeroTo62: '0–62 mph', mileage: 'Mileage', evRange: 'Electric range', electricRange: 'Electric range', mpg: 'Fuel economy',
  cc: 'Engine capacity', year: 'Year', sizeClass: 'Size', tags: 'Features', frontIsofix: 'Front ISOFIX', rearIsofix: 'Rear ISOFIX',
  gearbox: 'Gearbox', transmission: 'Transmission', colour: 'Paint', interior: 'Upholstery', co2: 'CO₂', power: 'Power',
  torque: 'Torque', equipment: 'Equipment', options: 'Selected equipment', availableFrom: 'Available by',
  configuration: 'Configuration', points: 'Points a month',
};
export const offerFieldLabel = (key: string): string => labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

export function offerValue(value: OfferSimpleValue, unit: string | null = null): string {
  const scalar = (item: string | number | boolean | null): string => item === null || item === '' ? 'Not supplied'
    : typeof item === 'number' ? item.toLocaleString('en-GB') : typeof item === 'boolean' ? item ? 'Yes' : 'No' : item;
  const text = Array.isArray(value) ? value.length ? value.map(scalar).join(', ') : 'None listed' : scalar(value as string | number | boolean | null);
  const unitLabel = unit === 'count' ? '' : ({ L: 'litres', 'mpg-imperial': 'mpg', 'points-per-month': 'points' } as Readonly<Record<string, string>>)[unit ?? ''] ?? unit;
  return unitLabel && value !== null ? `${text} ${unitLabel}` : text;
}

export const offerFactValue = (fact: OfferFact | undefined): string => fact?.status === 'known'
  ? offerValue(fact.value, fact.unit) : 'Unknown';

export function offerDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/London', timeZoneName: 'short' }).format(new Date(value));
}

const explanationNames: Readonly<Record<string, string>> = {
  'driver-eligible': 'Driver eligibility checked', 'policy-include': 'Included in your scheme',
  'allowance-sufficient': 'Within your allowance', 'essential-met': 'Meets your requirement',
  'required-by-met': 'Available by your required date', 'preference-fit': 'Preference fit',
  'driver-ineligible': 'You are not eligible to drive this car.', 'driver-unconfirmed': 'Your driver eligibility still needs confirming.',
  'policy-exclude': 'Not offered under your scheme.', 'eligibility-unconfirmed': 'Your scheme eligibility for this car still needs confirming.',
  'points-unavailable': 'The points cost for this car is not available yet.', 'allowance-exceeded': 'Over your points allowance.',
  'employee-essentials-unconfirmed': 'Your essential requirements have not been confirmed yet.',
  'essential-unmet': 'Does not meet your requirement', 'essential-unconfirmed': 'Your requirement still needs confirming',
  'equipment-unconfirmed': 'Whether this car has the equipment you asked for is not confirmed.',
  'fuel-unconfirmed': 'The fuel type is not confirmed, so charging cannot be checked.',
  'charging-ready': 'You have the charging access this car needs.', 'charging-unavailable': 'You do not have the charging access this car needs.',
  'charging-unconfirmed': 'Charging access is unknown. Confirm home or work charging.',
  'preference-unconfirmed': 'Your preference still needs confirming', 'preference-fact-unknown': 'Car details are not complete enough to judge your preference',
  'not-available': 'Already reserved or no longer available.', 'not-yet-available': 'Not available yet.',
  'availability-expired': 'No longer available for collection.', 'availability-unconfirmed': 'Availability of this car is not confirmed.',
  'availability-date-unconfirmed': 'The dates this car is available are not confirmed.', 'required-by': 'Not available by your required date.',
  'required-by-unconfirmed': 'Your collection deadline still needs confirming.', 'required-by-already-passed': 'Your collection deadline has already passed.',
  'renewal-already-passed': 'Your renewal date has already passed.', 'insurance-grade-limit': 'Insurance group is above your limit.',
  'insurance-unconfirmed': 'The insurance group for this car is not confirmed.', 'licence-unconfirmed': 'Your licence details still need confirming.',
  'licence-not-valid-at-collection': 'Your licence is not valid on the collection date.', 'locally-excluded': 'You have ruled this car out.',
  'feedback-similar': 'Similar to your current car, which you rated highly.', 'feedback-different': 'Different from the current car you rated poorly.',
  'feedback-improvement': 'Better than your current car for your preferences.', 'same-again-match': 'The same model and specification as your current car, as you asked.',
  'feedback-similar-omitted': 'Too similar to your current car, which you rated poorly.',
  'feedback-not-similar-or-better': 'Neither similar to your current car nor better on your preferences.',
  'same-again-different': 'The same model and specification could not be confirmed.',
};

export function offerExplanation(entry: OfferExplanation): { title: string; details: readonly string[] } {
  if (typeof entry === 'string') return { title: entry, details: [] };
  const code = typeof entry['code'] === 'string' ? entry['code'] : '';
  const field = typeof entry['field'] === 'string' ? offerFieldLabel(entry['field']) : '';
  const title = typeof entry['text'] === 'string' && entry['text'] ? entry['text']
    : [explanationNames[code] ?? (offerFieldLabel(code) || 'Recorded explanation'), field].filter(Boolean).join(': ');
  const details: string[] = [];
  if (entry.fact) details.push(`${field || 'Recorded value'}: ${offerFactValue(entry.fact)}`);
  if (entry.facts && typeof entry.facts === 'object' && !Array.isArray(entry.facts)) {
    for (const [key, fact] of Object.entries(entry.facts)) details.push(`${offerFieldLabel(key)}: ${offerFactValue(fact as OfferFact)}`);
  } else if (entry.facts !== undefined) details.push(`Recorded facts: ${offerValue(entry.facts as OfferSimpleValue)}`);
  if (entry.requirement) {
    const operators: Readonly<Record<string, string>> = { gte: 'at least', lte: 'at most', eq: 'equal to', includes: 'includes' };
    const operator = entry.requirement.operator;
    details.push(`Required: ${operator == null ? '' : `${typeof operator === 'string' ? operators[operator] ?? operator : offerValue(operator)} `}${offerValue(entry.requirement.value ?? null, typeof entry.requirement.unit === 'string' ? entry.requirement.unit : null)}`);
  }
  for (const key of ['expected', 'actual', 'target', 'desired', 'observed', 'allowance', 'monthlyPoints', 'requiredBy', 'availableFrom', 'attribute', 'preference', 'direction', 'keys']) {
    const value = entry[key];
    if (value !== undefined) details.push(`${offerFieldLabel(key)}: ${offerValue(value as OfferSimpleValue)}`);
  }
  return { title, details };
}

const blockerCopy: Readonly<Record<string, string>> = {
  'contact-required': 'A valid contact phone and email are needed before you can accept.',
  'driver-review-required': 'Your driver details need review before you can accept.',
  'return-data-required': 'The details of the car you return are incomplete.',
  'ordering-terms-unavailable': 'The ordering terms are unavailable right now.',
};

export function offerViewModel(offer: OfferProjection) {
  const { quote } = offer;
  const { display, facts } = quote.facts;
  const uncertain = offer.state === 'pending' && ['decision-pending', 'release-pending'].includes(offer.reason);
  const refused = offer.state === 'accepted' && offer.selection?.selectionState === 'handoff-failed';
  const title = refused ? 'Your selection was not sent to ordering' : uncertain ? 'Checking your decision'
    : ({ pending: 'Your offer', accepted: 'Offer accepted', declined: 'Offer declined', expired: 'Offer expired', superseded: 'Offer superseded' })[offer.state];
  let message = ({ pending: '', accepted: 'Your selection is recorded. Ordering and approval are separate steps.',
    declined: `You declined the ${display.name}.`, expired: 'This offer is no longer available to accept. Open your account to check for a new offer.',
    superseded: 'This offer has been replaced and cannot be changed.' })[offer.state];
  if (uncertain) message = offer.reason === 'release-pending' ? 'The release is being confirmed. Actions are unavailable.' : 'Your decision is being confirmed. Actions are unavailable.';
  if (offer.state === 'accepted' && offer.selection) {
    const selection = offer.selection;
    message = selection.selectionState === 'handoff-pending' ? 'Sending your selection to ordering. Ordering owns the next step. You do not need to do anything.'
      : selection.selectionState === 'handoff-failed' ? `The car stays reserved for you. Nothing has been ordered. Contact scheme support${selection.orderReference ? ` and quote order reference ${selection.orderReference}` : ''}.`
        : `Selection received. Waiting for ${selection.stages.find((stage) => stage.state === 'waiting')?.name ?? selection.current}. Ordering and approval are separate steps.`;
  }
  const finishes: readonly VehicleDetailRow[] = [
    { label: 'Paint', value: facts['colour'] ? offerFactValue(facts['colour']) : display.colour ?? null },
    { label: 'Upholstery', value: facts['interior'] ? offerFactValue(facts['interior']) : null },
  ];
  const rows: VehicleDetailRow[] = [
    ...(['manufacturer', 'model', 'derivative'] as const).filter((key) => display[key] !== undefined).map((key) => ({ label: offerFieldLabel(key), value: display[key]! })),
    ...Object.entries(facts).filter(([key]) => !['colour', 'interior'].includes(key)).map(([key, fact]) => ({ label: offerFieldLabel(key), value: offerFactValue(fact) })),
  ];
  const equipmentFact = facts['options'] ?? facts['equipment'];
  const equipment = equipmentFact?.status === 'known' && equipmentFact.value !== null
    ? (Array.isArray(equipmentFact.value) ? equipmentFact.value : [equipmentFact.value]).map((value) => offerValue(value)) : [];
  const overview = ['body', 'fuel', 'boot', 'availableFrom'].filter((key) => facts[key]?.status === 'known')
    .map((key) => ({ label: offerFieldLabel(key), value: offerFactValue(facts[key]) }));
  const remainingMinutes = Math.max(0, Math.floor((Date.parse(offer.expiresAt) - Date.parse(offer.serverNow)) / 60000));
  const contribution = quote.terms.contribution;
  const comparison = ['body', 'fuel', 'seats', 'boot', 'zeroTo62', 'mpg', 'points'].map((key) => {
    const current = offer.comparison.currentCar?.facts?.[key];
    return { label: offerFieldLabel(key), current: current ? offerValue(current.value, current.unit) : 'Unknown',
      offered: key === 'points' ? `${offerValue(quote.terms.points.value)} points` : offerFactValue(facts[key]) };
  });
  const measuredBenefits: ReturnType<typeof offerExplanation>[] = [];
  const measuredTradeOffs: ReturnType<typeof offerExplanation>[] = [];
  for (const key of ['points', 'boot']) {
    const current = offer.comparison.currentCar?.facts?.[key];
    const offered = key === 'points' ? quote.terms.points.value : facts[key]?.status === 'known' ? facts[key].value : null;
    const unit = (value: string | null | undefined) => value === 'L' ? 'litres' : value === 'points-per-month' ? 'points' : value;
    const offeredUnit = key === 'points' ? 'points' : facts[key]?.unit;
    if (typeof current?.value !== 'number' || typeof offered !== 'number' || unit(current.unit) !== unit(offeredUnit) || current.value === offered) continue;
    const better = key === 'points' ? offered < current.value : offered > current.value;
    (better ? measuredBenefits : measuredTradeOffs).push({ title: `${Math.abs(offered - current.value).toLocaleString('en-GB')} ${key === 'points' ? `${better ? 'fewer' : 'more'} points` : `litres ${better ? 'more' : 'less'}`}`,
      details: [key === 'points' ? 'Every month, compared with your current car' : 'Boot space compared with your current car'] });
  }
  return { title, message, name: display.name, finishes, rows, equipment, overview, comparison,
    images: display.images.length ? display.images : display.photo ? [{ src: display.photo, alt: display.name }] : [],
    showVehicle: offer.state === 'pending' || offer.state === 'superseded' || refused,
    showAcceptedIdentity: offer.state === 'accepted' && !refused,
    orderNumber: offer.selection?.orderNumber ?? quote.orderNumber,
    points: offerValue(quote.terms.points.value), allowance: quote.terms.allowanceInputs.allowance ? offerValue(quote.terms.allowanceInputs.allowance.value) : null,
    contribution: contribution ? `${new Intl.NumberFormat('en-GB', { style: 'currency', currency: contribution.currency }).format(contribution.amount)} ${contribution.period === 'one-off' ? 'one-off' : `a ${contribution.period}`}` : null,
    deadline: offerDate(offer.expiresAt), remaining: `${Math.floor(remainingMinutes / 60)}h ${String(remainingMinutes % 60).padStart(2, '0')}m`,
    reasons: [...measuredBenefits, ...quote.decision.reasons.map(offerExplanation)], tradeOffs: [...measuredTradeOffs, ...quote.decision.tradeOffs.map(offerExplanation)],
    blockers: quote.decision.blockers.map(offerExplanation), unknowns: quote.decision.unknowns.map(offerExplanation),
    handoffBlocker: offer.handoff?.blocker ? blockerCopy[offer.handoff.blocker] : null,
    selectionStages: refused ? offer.selection?.stages ?? [] : [],
    currentName: offer.comparison.currentCar ? [offer.comparison.currentCar.model, offer.comparison.currentCar.facts?.['configuration']?.value].filter((value) => value !== undefined).join(', ') : 'Current car not supplied',
    comparisonNote: offer.comparison.status === 'available' ? '' : offer.comparison.comparisonAvailable
      ? 'Partial comparison. Some current-car facts are unknown.' : 'Current-car specifications and points are unknown.',
    comparisonUnknowns: offer.comparison.unknowns.map(offerFieldLabel),
    termsDates: `${offerDate(quote.terms.validFrom)} to ${offerDate(quote.terms.validUntil)}`,
    termsWording: offer.handoff?.wording ?? 'Scheme wording not supplied.',
  };
}

export function offerFailureView(failure: OfferFailure): { title: string; message: string; retry: boolean } {
  const copy: Readonly<Record<OfferFailure['status'], readonly [string, string]>> = {
    invalid: ['Offer link incomplete', 'Open the offer from your account or use its original email link.'],
    unavailable: ['Your offer could not be loaded', 'Please try again in a moment.'],
    'stale-version': ['Offer details changed', 'Check the current offer again before continuing.'],
    conflict: ['Offer details changed', 'Check the current offer again before continuing.'],
    forbidden: ['Offer unavailable', 'This offer is not available for your account.'],
    denied: ['Offer unavailable', 'This offer is not available for your account.'],
    'not-found': ['Offer not found', 'Check the offer link or open the offer from your account.'],
    'stale-run': ['Offer out of date', 'Use your latest offer email or open the offer from your account.'],
    pending: ['Checking your offer', 'The current offer state is being confirmed.'],
    unauthenticated: ['Sign in to view your offer', 'Sign in with your employee account to continue.'],
    unsupported: ['Offer unavailable', 'This offer cannot be opened right now.'],
  };
  const [title, message] = copy[failure.status];
  return { title, message, retry: failure.retryable === true && ['unavailable', 'stale-version', 'conflict', 'pending'].includes(failure.status) };
}
