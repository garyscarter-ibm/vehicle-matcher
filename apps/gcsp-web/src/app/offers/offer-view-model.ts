import { OfferExplanation, OfferFact, OfferFailure, OfferProjection, OfferSimpleValue } from './offer.types';
import { VehicleDetailRow } from '../kit/vehicle-details.component';
import { orderIdentityRows } from '../kit/order-identity';
import type { DecisionHighlight } from '../kit/decision-highlights.component';
import { bodyStyleLabel, fuelSpecLabel, reasonText } from '../preferences/brief.copy';
import type { FactRow } from '../kit/fact-list.component';

const labels: Readonly<Record<string, string>> = {
  eligibilityModelKey: 'Scheme model', body: 'Body style', fuel: 'Fuel', seats: 'Seats', doors: 'Doors', boot: 'Boot',
  zeroTo62: '0–62 mph', mileage: 'Mileage', evRange: 'Electric range', electricRange: 'Electric range', mpg: 'Fuel economy',
  cc: 'Engine capacity', year: 'Year', sizeClass: 'Size', tags: 'Features', frontIsofix: 'Front ISOFIX', rearIsofix: 'Rear ISOFIX',
  gearbox: 'Gearbox', transmission: 'Transmission', colour: 'Paint', interior: 'Upholstery', co2: 'CO₂', power: 'Power',
  torque: 'Torque', equipment: 'Equipment', options: 'Selected equipment', availableFrom: 'Available by',
  configuration: 'Configuration', points: 'Points a month', collectionFrom: 'Collection from',
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

const comparedKeys = ['body', 'fuel', 'seats', 'boot', 'zeroTo62', 'mpg', 'points'];
const comparisonLabel = (key: string) => key === 'zeroTo62' ? '0 to 62 mph' : offerFieldLabel(key);
const checkCodes = new Set(['driver-eligible', 'policy-include', 'allowance-sufficient', 'essential-met']);
type SourceReason = Exclude<OfferExplanation, string> & { readonly text: string };
const sourceReasons = (entries: readonly OfferExplanation[], kind: string): SourceReason[] => entries.map((entry) => typeof entry === 'string'
  ? { text: entry } : { ...entry, text: reasonText(entry, kind) });

// Current-car units are defined by the recorded field, not the optional DTO unit metadata.
function currentValue(key: string, value: string | number | undefined): string | null {
  if (['body', 'fuel'].includes(key)) return typeof value === 'string' && value.trim() ? value.charAt(0).toUpperCase() + value.slice(1) : null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const n = value.toLocaleString('en-GB');
  return ({ boot: `${n} litres`, mpg: `${n} mpg`, zeroTo62: `${n} s`, points: `${n} points`, seats: n } as Record<string, string>)[key] ?? null;
}

// Match decisionView's supplied fact labels and its bounded unit map before comparison.
function offeredFact(key: string, fact: OfferFact | undefined): FactRow {
  const raw = fact?.status !== 'known' ? null : key === 'body' ? bodyStyleLabel(fact.value) : key === 'fuel'
    ? fuelSpecLabel(fact.value) ?? String(fact.value).replaceAll('-', ' ').replaceAll('_', ' ') : fact.value;
  const value = raw !== null && typeof raw === 'object' ? String(raw) : raw;
  const unit = ({ L: 'litres', s: 's', 'mpg-imperial': 'mpg' } as Readonly<Record<string, string>>)[fact?.unit ?? ''];
  return { label: comparisonLabel(key), value, unit };
}

function offeredValue(key: string, fact: OfferFact | undefined): string | null {
  const { value, unit } = offeredFact(key, fact);
  if (value == null || value === '') return null;
  return `${typeof value === 'number' ? value.toLocaleString('en-GB') : value}${unit ? ` ${unit}` : ''}`;
}

function detailFact(label: string, fact: OfferFact | undefined, missingLabel = 'Not supplied'): FactRow {
  const raw = fact?.status === 'known' ? fact.value : null;
  const value = raw !== null && typeof raw === 'object' ? raw.length ? raw.map((entry) => entry === null ? 'Not supplied' : String(entry)).join(', ') : 'None listed' : raw;
  return { label, value, unit: fact?.unit ?? undefined, missingLabel };
}

function comparableNumber(value: string | null): number | null {
  const match = value?.match(/^([\d,]+(?:\.\d+)?) (?:points|litres)$/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

// The source read adapter presents these pending receipts as an uncertain outcome.
export function offerPresentationState(offer: Pick<OfferProjection, 'state' | 'reason'>): OfferProjection['state'] | 'uncertain' {
  return offer.state === 'pending' && ['decision-pending', 'release-pending'].includes(offer.reason) ? 'uncertain' : offer.state;
}

export function offerViewModel(offer: OfferProjection) {
  const { quote } = offer;
  const { display, facts } = quote.facts;
  const presentationState = offerPresentationState(offer);
  const isPending = presentationState === 'pending'; const uncertain = presentationState === 'uncertain';
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
      : selection.selectionState === 'handoff-failed' ? `The car stays reserved for you. Nothing has been ordered.${selection.orderReference ? ` Quote order reference ${selection.orderReference} when you contact scheme support.` : ''}`
        : `Selection received. Waiting for ${selection.stages.find((stage) => stage.state === 'waiting')?.name ?? selection.current}.`;
  }
  const finishFacts = [facts['colour'] ? detailFact('Paint', facts['colour']) : { label: 'Paint', value: display.colour ?? null }, detailFact('Upholstery', facts['interior'])];
  const finishes: readonly VehicleDetailRow[] = finishFacts.map(({ label, value }) => ({ label, value: value == null ? null : String(value) }));
  const rows: VehicleDetailRow[] = [
    ...(['manufacturer', 'model', 'derivative'] as const).filter((key) => display[key] !== undefined).map((key) => ({ label: offerFieldLabel(key), value: display[key]! })),
    ...Object.entries(facts).filter(([key]) => !['colour', 'interior'].includes(key)).map(([key, fact]) => ({ label: offerFieldLabel(key), value: offerFactValue(fact) })),
  ];
  const equipmentFact = facts['options'] ?? facts['equipment'];
  const equipment = equipmentFact?.status === 'known' && Array.isArray(equipmentFact.value)
    ? equipmentFact.value.map((value) => value === null ? 'Not supplied' : String(value)) : [];
  const detailRows: readonly FactRow[] = [
    { label: 'Model', value: display.model ?? null }, { label: 'Derivative', value: display.derivative ?? null },
    ...(equipment.length ? [] : [detailFact('Options', equipmentFact, 'Fitted equipment unknown')]),
    ...['body', 'fuel', 'seats', 'boot', 'zeroTo62', 'mpg'].map((key) => offeredFact(key, facts[key])),
    detailFact('Gearbox', facts['gearbox'] ?? facts['transmission']),
  ];
  const genericFacts: readonly FactRow[] = [
    { label: 'Model', value: display.model ?? null }, { label: 'Derivative', value: display.derivative ?? null },
    facts['colour'] ? detailFact('Colour', facts['colour']) : { label: 'Colour', value: display.colour ?? null },
    detailFact('Options', equipmentFact, 'Fitted equipment unknown'),
    ...['body', 'fuel', 'seats', 'boot', 'zeroTo62', 'mpg'].map((key) => offeredFact(key, facts[key])),
    detailFact('Interior', facts['interior']), detailFact('Gearbox', facts['gearbox'] ?? facts['transmission']),
  ];
  const primaryImage = display.images.find(image => image.src === display.photo);
  const genericImage = display.photo ? { ...primaryImage, src: display.photo, alt: primaryImage?.alt || display.name } : null;
  const genericLine = quote.orderNumber === null ? 'Order number not supplied' : `Order no. ${quote.orderNumber}`;
  const genericTerm = `${quote.terms.points.value.toLocaleString('en-GB')} points a month · ${quote.terms.allowanceInputs.allowance
    ? quote.terms.allowanceInputs.allowance.value.toLocaleString('en-GB') + ' points a month allowance' : 'monthly points allowance not supplied'}`;
  const overview = ['body', 'fuel', 'boot', 'seats'].map((key) => ({ label: comparisonLabel(key), value: offeredValue(key, facts[key]) }))
    .filter((row) => row.value !== null);
  const expiresAt = Date.parse(offer.expiresAt); const serverNow = Date.parse(offer.serverNow);
  const remainingSeconds = Number.isFinite(expiresAt) && Number.isFinite(serverNow)
    ? Math.max(0, Math.ceil((expiresAt - serverNow) / 1000)) : null;
  const remainingMinutes = remainingSeconds === null ? null : Math.ceil(remainingSeconds / 60);
  const contribution = quote.terms.contribution;
  const sourceComparison = comparedKeys.map((key) => ({ key,
    current: currentValue(key, offer.comparison.currentCar?.facts?.[key]?.value),
    offered: key === 'points' ? `${quote.terms.points.value.toLocaleString('en-GB')} points` : offeredValue(key, facts[key]),
  }));
  const comparison = sourceComparison.map(({ key, current, offered }) => ({ label: comparisonLabel(key), current: current ?? 'Unknown', offered: offered ?? 'Not supplied' }));
  const normalizedDecision = {
    reasons: sourceReasons(quote.decision.reasons, 'reasons').filter((entry) => !checkCodes.has(String(entry['code']))),
    tradeOffs: sourceReasons(quote.decision.tradeOffs, 'tradeOffs'),
    blockers: sourceReasons(quote.decision.blockers, 'blockers'), unknowns: sourceReasons(quote.decision.unknowns, 'unknowns'),
  };
  const measuredBenefits: ReturnType<typeof offerExplanation>[] = [];
  const measuredTradeOffs: ReturnType<typeof offerExplanation>[] = [];
  const benefits: DecisionHighlight[] = []; const tradeoffs: DecisionHighlight[] = [];
  const measuredFields = new Set<string>(); let pointsDifference: string | null = null;
  for (const key of ['points', 'boot']) {
    const row = sourceComparison.find((entry) => entry.key === key)!;
    const current = comparableNumber(row.current); const offered = comparableNumber(row.offered);
    if (current === null || offered === null || current === offered) continue;
    const better = key === 'points' ? offered < current : offered > current;
    const delta = Math.abs(offered - current).toLocaleString('en-GB');
    measuredFields.add(key);
    (better ? benefits : tradeoffs).push({ number: delta,
      title: key === 'points' ? `${better ? 'fewer' : 'more'} points` : `litres ${better ? 'more' : 'less'}`,
      detail: key === 'points' ? 'Every month, compared with your current car' : 'Boot space compared with your current car' });
    if (key === 'points' && better) pointsDifference = `${delta} fewer than your current car`;
    (better ? measuredBenefits : measuredTradeOffs).push({ title: `${delta} ${key === 'points' ? `${better ? 'fewer' : 'more'} points` : `litres ${better ? 'more' : 'less'}`}`,
      details: [key === 'points' ? 'Every month, compared with your current car' : 'Boot space compared with your current car'] });
  }
  for (const [entries, target] of [[normalizedDecision.reasons, benefits], [normalizedDecision.tradeOffs, tradeoffs]] as const) {
    for (const entry of entries) {
      if (checkCodes.has(String(entry['code'])) || typeof entry['field'] === 'string' && measuredFields.has(entry['field'])) continue;
      if (entry.text) target.push({ title: entry.text });
    }
  }
  const decisionDetails = [
    { label: quote.decision.gateStatus === 'eligible' ? 'Why it suits you' : 'Checks passed', entries: isPending ? [] : normalizedDecision.reasons.map((entry) => entry.text) },
    { label: 'Why it is not eligible', entries: normalizedDecision.blockers.map((entry) => entry.text) },
    { label: 'Needs confirmation', entries: normalizedDecision.unknowns.map((entry) => entry.text) },
    { label: 'Trade-offs', entries: isPending ? [] : normalizedDecision.tradeOffs.map((entry) => entry.text) },
  ].filter(group => group.entries.length);
  const orderNumber = offer.selection?.orderNumber ?? quote.orderNumber;
  const acceptedIdentityRows = [...(display.name ? [{ label: 'Your new car', value: display.name }] : []),
    ...(orderNumber ? orderIdentityRows(null, orderNumber) : [])];
  const selectionIdentityRows = refused && (offer.selection?.orderReference || offer.selection?.orderNumber)
    ? orderIdentityRows(offer.selection.orderReference, offer.selection.orderNumber) : [];
  return { title, message, name: display.name, memberId: quote.orderUuid, gateStatus: quote.decision.gateStatus, genericFacts, genericImage, genericLine, genericTerm, finishes, rows, detailRows, equipment, overview, comparison,
    images: display.images.length ? display.images : display.photo ? [{ src: display.photo, alt: display.name }] : [],
    showVehicle: offer.state === 'pending' || offer.state === 'superseded' || refused,
    showAcceptedIdentity: offer.state === 'accepted' && !refused,
    orderNumber, acceptedIdentityRows, selectionIdentityRows, showSelection: refused && offer.selection !== null,
    isPending, isExpired: offer.state === 'expired', isRefused: refused,
    monthlyPoints: quote.terms.points.value, monthlyAllowance: quote.terms.allowanceInputs.allowance?.value ?? null,
    pointsDifference, benefits, tradeoffs, hasCurrentCar: offer.comparison.currentCar !== null, decisionDetails,
    decisionGate: isPending && quote.decision.gateStatus === 'eligible' ? null
      : ({ eligible: 'Eligible', ineligible: 'Not eligible', 'needs-confirmation': 'Needs confirmation' })[quote.decision.gateStatus],
    points: offerValue(quote.terms.points.value), allowance: quote.terms.allowanceInputs.allowance ? offerValue(quote.terms.allowanceInputs.allowance.value) : null,
    contribution: contribution ? `${new Intl.NumberFormat('en-GB', { style: 'currency', currency: contribution.currency }).format(contribution.amount)} ${contribution.period === 'one-off' ? 'one-off' : `a ${contribution.period}`}` : null,
    deadline: offerDate(offer.expiresAt),
    deadlineTime: Number.isFinite(expiresAt) ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).format(expiresAt) : null,
    deadlineDate: Number.isFinite(expiresAt) ? new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(expiresAt) : null,
    remainingSeconds, remaining: remainingMinutes === null ? 'Time remaining unavailable' : `${Math.floor(remainingMinutes / 60)}h ${String(remainingMinutes % 60).padStart(2, '0')}m`,
    reasons: [...measuredBenefits, ...quote.decision.reasons.map(offerExplanation)], tradeOffs: [...measuredTradeOffs, ...quote.decision.tradeOffs.map(offerExplanation)],
    blockers: quote.decision.blockers.map(offerExplanation), unknowns: quote.decision.unknowns.map(offerExplanation),
    handoffBlocker: offer.handoff?.blocker ? blockerCopy[offer.handoff.blocker] : null,
    selectionStages: refused ? offer.selection?.stages ?? [] : [],
    currentName: offer.comparison.currentCar ? [offer.comparison.currentCar.model, offer.comparison.currentCar.facts?.['configuration']?.value].filter((value) => value !== undefined).join(', ') : 'Current car not supplied',
    comparisonNote: !offer.comparison.currentCar ? 'Current-car details not supplied. Equipment is unknown.' : offer.comparison.status === 'available' ? '' : sourceComparison.some((row) => row.current !== null)
      ? 'Partial comparison. Some current-car facts are unknown.' : 'Partial comparison. Current-car specifications and points are unknown.',
    comparisonUnknowns: offer.comparison.unknowns.map(offerFieldLabel),
    termsDates: `${offerDate(quote.terms.validFrom)} to ${offerDate(quote.terms.validUntil)}`,
    termsWording: offer.handoff?.wording ?? 'Scheme wording not supplied.',
  };
}

export function offerFailureView(failure: OfferFailure): { title: string; message: string; retry: boolean } {
  const copy: Readonly<Record<OfferFailure['status'], readonly [string, string]>> = {
    invalid: ['Offer link incomplete', 'Open the offer from your account or use its original email link.'],
    unavailable: ['Your offer could not be loaded', 'The current offer could not be loaded.'],
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
