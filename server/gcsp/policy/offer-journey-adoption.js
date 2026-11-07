import { randomUUID } from 'node:crypto';
import { ok, result } from '../repository/core.js';

export const OFFER_JOURNEY_SET = 'offer-journey-v1';
const KEYS = ['offer.declineReasons.v1', 'offer.followupQuestions.v1'];

// Demo startup adopts the reviewed decline/follow-up sets once, as Greg, through PolicyService.
// Policy is per run: a reset starts on the base version, so ScenarioService re-adopts after each reset.
export async function adoptOfferJourneyPolicy({ policy, identity, clock }) {
  const presenter = await identity.createPresenterSession(`offer-journey-policy:${randomUUID()}`);
  if (presenter.status !== 'ok') return presenter;
  const start = presenter.value.context;
  const time = await clock.now(start); if (time.status !== 'ok') return time;
  const read = { runId: start.runId, asOf: time.value.now, policyVersion: start.policyVersion };
  const present = await Promise.all(KEYS.map((key) => policy.getAssumption(key, read)));
  if (present.every((row) => row.status === 'ok')) return ok({ adopted: false, policyVersion: start.policyVersion });
  const principals = await policy.getAssumption('identity.demo.principals', read);
  const principal = principals.status === 'ok' ? principals.value.value.find((row) => row.roles?.includes('greg')) : null;
  if (!principal) return result('unavailable', { code: 'offer-journey-policy-unavailable' });
  const greg = await identity.switchPrincipal(start, principal.principalId, `offer-journey-policy-greg:${randomUUID()}`);
  if (greg.status !== 'ok') return greg;
  const adopted = await policy.adoptReviewedAssumptions(greg.value.context, { commandId: `adopt:${OFFER_JOURNEY_SET}:${start.runId}`,
    expectedActiveVersion: start.policyVersion, policyVersion: `${start.policyVersion}+${OFFER_JOURNEY_SET}`,
    effectiveFrom: time.value.now, definitionSetId: OFFER_JOURNEY_SET });
  if (adopted.status !== 'ok' || adopted.value?.activation?.status !== 'active') {
    return result('unavailable', { code: 'offer-journey-policy-unavailable' });
  }
  return ok({ adopted: true, policyVersion: adopted.value.activation.policyVersion });
}
