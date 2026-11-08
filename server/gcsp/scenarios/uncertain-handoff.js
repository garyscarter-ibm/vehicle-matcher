import { confirmScenarioBrief, releaseToFirstOffer, fail } from './brief-start.js';

// Start loader: Paula's and Alex's briefs, the release and allocation through actual services, then the
// fixture's one-handoff ordering fault. Paula is left about to accept; nothing is accepted or handed off here.
export async function startUncertainHandoff(services) {
  const briefs = {}; let paula;
  for (const { principalId } of services.scenario.inputs.briefs) {
    const start = await confirmScenarioBrief(services, principalId);
    if (!start.ok) return start;
    briefs[principalId] = start.briefVersion; if (principalId === 'demo-paula') paula = start;
  }
  const released = await releaseToFirstOffer(services, paula);
  if (!released.ok) return released;
  if (!services.faults?.ordering?.set(services.runId, services.scenario.inputs.syntheticOrderingFault)) return fail('ordering-fault', 'The synthetic ordering fault is not configured.');
  return { status: 'ok', briefs, offerId: released.offer.offerId, now: released.now, faults: [services.faults.ordering.read(services.runId)] };
}
