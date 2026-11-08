import { confirmPaulaBrief, releaseToFirstOffer } from './brief-start.js';

// Start loader for decline-then-change. Runs after the reset, inside the new run, through actual
// services only. Returns a small truthful startState, never a fabricated success.
export async function startDeclineThenChange(services) {
  const start = await confirmPaulaBrief(services);
  if (!start.ok) return start;
  // The release cue and tick are the presenter's own controls; stock release and allocation do the rest.
  const released = await releaseToFirstOffer(services, start);
  if (!released.ok) return released;
  return { status: 'ok', firstOfferId: released.offer.offerId, now: released.now };
}
