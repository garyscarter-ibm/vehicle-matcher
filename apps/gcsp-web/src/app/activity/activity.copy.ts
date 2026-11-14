import { ActivityExclusion, ActivityOffer, ActivityProjection, ActivityStateChange } from './activity.types';

export const activityCopy = Object.freeze({
  title: 'Your buddy',
  unavailable: 'Search status and offers are unavailable. Try again.',
  notSearched: 'Not searched yet',
  finished: 'Finished. You accepted a car.',
  searching: 'Still searching. No match yet.',
  sourceDelayed: 'Source delayed. Waiting for stock data.',
  sourceUnavailable: "Couldn't check for new cars. Stock source unavailable.",
  pausedDetail: 'New searches and holds have stopped.',
  pausedOffer: 'Your offer is still open. View it to accept or decline.',
  keepSearching: 'Keep searching',
  reviewPreferences: 'Review your preferences',
  keepNote: 'Buddy will keep searching with your preferences as they are.',
  noRenewalDate: 'Buddy cannot hold a car for you yet. There is no renewal date on your record to set your place in the queue, so you are left out of allocation until one is recorded.',
});

const ukTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
});

export function formatActivityTime(value: string): string {
  return ukTime.format(new Date(value));
}

const offerStates: Readonly<Record<string, string>> = Object.freeze({
  active: 'Waiting for you',
  'decision-pending': 'Being processed',
  'release-pending': 'Being processed',
  accepted: 'Accepted',
  rejected: 'Declined',
  declined: 'Declined',
  expired: 'Expired',
});

export const offerStateLabel = (state: string): string => offerStates[state] ?? 'Status unavailable';
export const respondBy = (offer: ActivityOffer | null | undefined): string | null => offer?.state === 'active'
  && typeof offer.expiresAt === 'string' && Number.isFinite(Date.parse(offer.expiresAt))
  ? `Respond by ${formatActivityTime(offer.expiresAt)}` : null;

const count = (value: number, noun: string): string => `${value} ${noun}${value === 1 ? '' : 's'}`;

export function searchLines(value: ActivityProjection, paused: boolean): readonly string[] {
  const lines: string[] = [];
  const check = value.lastSuccessfulCheck;
  if (!paused && value.sourceStatus === 'unavailable') lines.push(activityCopy.sourceUnavailable);
  else if (!paused && value.sourceStatus === 'delayed') lines.push(activityCopy.sourceDelayed);
  else if (!paused && value.sourceStatus === 'ok' && value.searchEvidence?.status === 'recorded'
    && ['searching', 'offer-closed'].includes(value.state) && value.currentOffer?.state !== 'accepted') lines.push(activityCopy.searching);
  else if (!check && !value.currentOffer) lines.push(activityCopy.notSearched);

  if (check && Number.isFinite(Date.parse(check.checkedAt))) {
    const found = check.outcome === 'offer-held' && value.currentOffer?.state !== 'active' ? ' Found a car for you.' : '';
    lines.push(`Last check ${formatActivityTime(check.checkedAt)}: ${count(check.carsChecked, 'car')} checked, ${check.suitableCars} suitable.${found}`);
    if (!paused && check.limitation === 'renewal-deadline-unknown') lines.push(activityCopy.noRenewalDate);
  }
  return lines;
}

const bodies: Readonly<Record<string, string>> = Object.freeze({
  estate: 'an estate body', suv: 'an SUV body', mpv: 'an MPV body', hatchback: 'a hatchback body',
  saloon: 'a saloon body', coupe: 'a coupe body', convertible: 'a convertible body',
});
const fuels: Readonly<Record<string, string>> = Object.freeze({ petrol: 'a petrol engine', diesel: 'a diesel engine', phev: 'plug-in hybrid power', ev: 'electric power' });
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function needPhrase({ essential, requirement }: ActivityExclusion): string | null {
  const value = requirement.value;
  switch (essential) {
    case 'seats': return number(value) ? count(value, 'seat') : null;
    case 'boot': return number(value) ? `${value} litres of boot space` : null;
    case 'equipment': return Array.isArray(value) && value.length === 1 && value[0] === 'towbar' ? 'a towbar' : 'the equipment you need';
    case 'body': return typeof value === 'string' ? bodies[value] ?? null : null;
    case 'fuel': return typeof value === 'string' ? fuels[value] ?? null : null;
    case 'frontIsofix': return value === true ? 'front ISOFIX points' : null;
    case 'rearIsofix': return value === true ? 'rear ISOFIX points' : null;
    case 'modelLine': return 'the model you asked for';
    default: return null;
  }
}

const closedOffers = new Set(['rejected', 'declined', 'expired']);

export function exclusionLines(value: ActivityProjection, paused: boolean): readonly string[] {
  const check = value.lastSuccessfulCheck;
  const offer = value.currentOffer;
  if (paused || !check || check.suitableCars !== 0 || !(check.carsChecked > 0) || !Array.isArray(check.exclusions)
    || offer && !closedOffers.has(offer.state)) return [];
  return check.exclusions.map((row) => {
    const phrase = needPhrase(row);
    const all = !(row.cars < check.carsChecked);
    if (!phrase) return all ? 'No released car meets one of your essentials.'
      : `${row.cars} of ${count(check.carsChecked, 'car')} do not meet one of your essentials.`;
    return all ? `No released car has ${phrase}.` : `${row.cars} of ${count(check.carsChecked, 'car')} do not have ${phrase}.`;
  });
}

const eventLabels: Readonly<Record<string, string>> = Object.freeze({
  confirmed: 'Preferences confirmed',
  paused: 'Buddy disengaged',
  resumed: 'Buddy settings updated',
  'changed-after-decline': 'Search updated after a decline',
  engaged: 'Buddy engaged',
  disengaged: 'Buddy disengaged',
  'preferences-updated': 'Preferences updated',
});

export interface ActivityTimelineEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly label: string;
}

export function activityEvents(changes: readonly ActivityStateChange[] = []): readonly ActivityTimelineEvent[] {
  const seen = new Set<string>();
  return changes.filter((event) => {
    if (!event.eventId || seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  }).map((event) => ({
    id: event.eventId,
    occurredAt: event.occurredAt,
    label: eventLabels[event.operation] ?? 'Search permission changed',
  }));
}

export function collapseAdjacentEvents(events: readonly ActivityTimelineEvent[]): readonly ActivityTimelineEvent[] {
  const collapsed: ActivityTimelineEvent[] = [];
  let previous: string | null = null;
  for (const event of events) {
    const key = `${event.occurredAt}|${event.label}`;
    if (key === previous) continue;
    collapsed.push(event);
    previous = key;
  }
  return collapsed;
}
