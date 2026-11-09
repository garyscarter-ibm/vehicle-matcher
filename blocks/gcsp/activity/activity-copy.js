import { demoTime } from '../kit/activity-timeline.js';

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
  reviewBrief: 'Review your brief',
  keepNote: 'Buddy will keep searching with your brief as it is.',
  previewOnly: 'Preview only',
  noRenewalDate: 'Buddy cannot hold a car for you yet. There is no renewal date on your record to set your place in the queue, so you are left out of allocation until one is recorded.',
});
const offerStates = Object.freeze({ active: 'Waiting for you', 'decision-pending': 'Being processed', 'release-pending': 'Being processed',
  accepted: 'Accepted', rejected: 'Declined', declined: 'Declined', expired: 'Expired' });
export const offerStateLabel = (state) => offerStates[state] || 'Status unavailable';
export const respondBy = (offer) => offer?.state === 'active' && Number.isFinite(Date.parse(offer.expiresAt))
  ? `Respond by ${demoTime(offer.expiresAt)}` : null;

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;
// Search-status and last-check lines from supplied fields only; nothing is inferred when evidence is missing.
export function searchLines(value, paused) {
  const lines = []; const check = value.lastSuccessfulCheck;
  if (!paused && value.sourceStatus === 'unavailable') lines.push(activityCopy.sourceUnavailable);
  else if (!paused && value.sourceStatus === 'delayed') lines.push(activityCopy.sourceDelayed);
  else if (!paused && value.sourceStatus === 'ok' && value.searchEvidence?.status === 'recorded'
    && ['searching', 'offer-closed'].includes(value.state) && value.currentOffer?.state !== 'accepted') lines.push(activityCopy.searching);
  else if (!check && !value.currentOffer) lines.push(activityCopy.notSearched);
  if (check && Number.isFinite(Date.parse(check.checkedAt))) {
    const found = check.outcome === 'offer-held' ? ' Found a car for you.' : '';
    lines.push(`Last check ${demoTime(check.checkedAt)}: ${count(check.carsChecked, 'car')} checked, ${check.suitableCars} suitable.${found}`);
    if (!paused && check.limitation === 'renewal-deadline-unknown') lines.push(activityCopy.noRenewalDate);
  }
  return lines;
}
const bodies = Object.freeze({ estate: 'an estate body', suv: 'an SUV body', mpv: 'an MPV body', hatchback: 'a hatchback body',
  saloon: 'a saloon body', coupe: 'a coupe body', convertible: 'a convertible body' });
const fuels = Object.freeze({ petrol: 'a petrol engine', diesel: 'a diesel engine', phev: 'plug-in hybrid power', ev: 'electric power' });
const number = (v) => Number.isFinite(v) && v > 0;
// Display wording for an essential the allocation excluded on; the field and value come from the server, unknown ones stay generic.
function needPhrase({ essential, requirement } = {}) {
  const value = requirement?.value;
  switch (essential) {
    case 'seats': return number(value) ? count(value, 'seat') : null;
    case 'boot': return number(value) ? `${value} litres of boot space` : null;
    case 'equipment': return Array.isArray(value) && value.length === 1 && value[0] === 'towbar' ? 'a towbar' : 'the equipment you need';
    case 'body': return bodies[value] ?? null;
    case 'fuel': return fuels[value] ?? null;
    case 'frontIsofix': return value === true ? 'front ISOFIX points' : null;
    case 'rearIsofix': return value === true ? 'rear ISOFIX points' : null;
    case 'modelLine': return 'the model you asked for';
    default: return null;
  }
}
const closedOffers = ['rejected', 'declined', 'expired'];
// Why the last check found nothing, from Paula's own excluded-essential counts. Nothing for a held car, a pause or an open offer.
export function exclusionLines(value, paused) {
  const check = value.lastSuccessfulCheck; const offer = value.currentOffer;
  if (paused || !check || check.suitableCars !== 0 || !(check.carsChecked > 0) || !Array.isArray(check.exclusions)
    || offer && !closedOffers.includes(offer.state)) return [];
  return check.exclusions.map((row) => {
    const phrase = needPhrase(row); const all = !(row.cars < check.carsChecked);
    if (!phrase) return all ? 'No released car meets one of your essentials.' : `${row.cars} of ${count(check.carsChecked, 'car')} do not meet one of your essentials.`;
    return all ? `No released car has ${phrase}.` : `${row.cars} of ${count(check.carsChecked, 'car')} do not have ${phrase}.`;
  });
}
const labels = Object.freeze({ confirmed: 'Search confirmed', paused: 'Search paused', resumed: 'Search resumed',
  'changed-after-decline': 'Search updated after a decline' });
export const activityEvents = (changes = []) => {
  const seen = new Set();
  return changes.filter((event) => { if (!event.eventId || seen.has(event.eventId)) return false; seen.add(event.eventId); return true; })
    .map((event) => ({ id: event.eventId, occurredAt: event.occurredAt, label: labels[event.operation] || 'Search permission changed' }));
};
