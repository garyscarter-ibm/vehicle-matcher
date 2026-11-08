import { confirmScenarioBrief, releaseToFirstOffer } from './brief-start.js';

// Start loader: Paula's and Alex's briefs, then the release and allocation through actual services. Paula is left
// holding the buddy offer (its email captured by the notify service); no expiry, decline or acceptance happens here.
export async function startOfferExpires(services) {
  const briefs = {}; let paula;
  for (const { principalId } of services.scenario.inputs.briefs) {
    const start = await confirmScenarioBrief(services, principalId);
    if (!start.ok) return start;
    briefs[principalId] = start.briefVersion; if (principalId === 'demo-paula') paula = start;
  }
  const released = await releaseToFirstOffer(services, paula);
  if (!released.ok) return released;
  const { offerId, expiresAt } = released.offer;
  return { status: 'ok', briefs, offerId, expiresAt, now: released.now };
}
