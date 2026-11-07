import { demoTime } from '../kit/activity-timeline.js';

export const activityCopy = Object.freeze({
  title: 'Your buddy',
  unavailable: 'Search status and offers are unavailable. Try again.',
  notSearched: 'Not searched yet',
  searching: 'Still searching. No match yet.',
  sourceDelayed: 'Source delayed. Waiting for stock data.',
  sourceUnavailable: 'Stock source unavailable.',
  pausedDetail: 'New searches and holds have stopped.',
  pausedOffer: 'Your offer is still open. View it to accept or decline.',
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
    && ['searching', 'offer-closed'].includes(value.state)) lines.push(activityCopy.searching);
  else if (!check && !value.currentOffer) lines.push(activityCopy.notSearched);
  if (check && Number.isFinite(Date.parse(check.checkedAt))) {
    const found = check.outcome === 'offer-held' ? ' Found a car for you.' : '';
    lines.push(`Last check ${demoTime(check.checkedAt)}: ${count(check.carsChecked, 'car')} checked, ${check.suitableCars} suitable.${found}`);
  }
  return lines;
}
const labels = Object.freeze({ confirmed: 'Search confirmed', paused: 'Search paused', resumed: 'Search resumed',
  'changed-after-decline': 'Search updated after a decline' });
export const activityEvents = (changes = []) => {
  const seen = new Set();
  return changes.filter((event) => { if (!event.eventId || seen.has(event.eventId)) return false; seen.add(event.eventId); return true; })
    .map((event) => ({ id: event.eventId, occurredAt: event.occurredAt, label: labels[event.operation] || 'Search permission changed' }));
};
