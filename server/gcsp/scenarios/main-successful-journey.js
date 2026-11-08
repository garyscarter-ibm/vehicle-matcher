import { confirmPaulaBrief } from './brief-start.js';

// Start loader for the main journey: Paula's confirmed brief only. The presenter advances to
// release and ticks, so no stock is released and no offer exists yet.
export async function startMainSuccessfulJourney(services) {
  const start = await confirmPaulaBrief(services);
  if (!start.ok) return start;
  return { status: 'ok', briefVersion: start.briefVersion, now: start.time.now };
}
