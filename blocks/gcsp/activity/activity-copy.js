export const activityCopy = Object.freeze({
  title: 'Your buddy',
  unavailable: 'Search status and offers are unavailable. Try again.',
  lastCheckMissing: 'Last successful check: unavailable',
  checkMissing: 'Check and source information unavailable',
  pausedDetail: 'Searches and holds paused. Existing offers remain.',
});
const labels = Object.freeze({ confirmed: 'Search confirmed', paused: 'Search paused', resumed: 'Search resumed',
  'changed-after-decline': 'Search updated after a decline' });
export const activityEvents = (changes = []) => {
  const seen = new Set();
  return changes.filter((event) => { if (!event.eventId || seen.has(event.eventId)) return false; seen.add(event.eventId); return true; })
    .map((event) => ({ id: event.eventId, occurredAt: event.occurredAt, label: labels[event.operation] || 'Search permission changed' }));
};
