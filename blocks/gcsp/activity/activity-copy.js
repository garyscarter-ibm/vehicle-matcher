export const activityCopy = Object.freeze({
  title: 'Your buddy activity',
  lede: 'See where your search stands and what happens next.',
  preview: 'Synthetic design preview. Pause and resume do not change a saved search here.',
  unavailable: 'We could not load your activity. Your search permission and offers are hidden until a fresh view is available.',
  checkMissing: 'Check information is unavailable. We cannot tell you what the buddy found yet.',
  active: 'Your buddy is active',
  activeDetail: 'The buddy has permission to search. New checks run when the presenter advances this demonstration.',
  paused: 'Your buddy is paused',
  pausedDetail: 'New searches and new holds are paused. Pausing does not cancel an existing offer.',
  offerEmpty: 'No offer is recorded in this activity.',
  offerMissing: 'Offer details and access are unavailable. Open your offer through its existing authorised route.',
});

const labels = Object.freeze({ confirmed: 'Search brief confirmed', paused: 'Search paused', resumed: 'Search resumed',
  'changed-after-decline': 'Search brief updated after a decline' });
export const activityEvents = (changes = []) => changes.map((event) => ({ id: event.eventId, occurredAt: event.occurredAt,
  label: labels[event.operation] || 'Search permission changed', detail: `Brief version ${event.briefVersion}` }));
