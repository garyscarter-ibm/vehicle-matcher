import { randomUUID } from 'node:crypto';
import { ok, result } from '../repository/core.js';
import { getReviewedDefinitionSet } from './reviewed-definitions.js';
import { adoptOfferJourneyPolicy } from './offer-journey-adoption.js';
import { planEmployeeExperienceUpgrade } from './employee-experience-upgrade.js';

const SET = 'employee-experience-v1';
const unavailable = (invalidKey) => result('unavailable', { code: 'employee-experience-policy-unavailable', retryable: true,
  ...(invalidKey ? { reason: `The retained ${invalidKey} rule is malformed or is not a recognized legacy shape.` } : {}) });

// Upgrade retained demo runs through the same authorized publication/activation boundary.
// Existing runs, drafts and historical versions survive; fresh runs publish the offer sets once.
export async function adoptEmployeeExperiencePolicy({ policy, identity, clock }) {
  const presenter = await identity.createPresenterSession(`employee-experience:${randomUUID()}`);
  if (presenter.status !== 'ok') return presenter;
  const context = presenter.value.context;
  let time = await clock.now(context); if (time.status !== 'ok') return time;
  const read = { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion };
  const bundle = getReviewedDefinitionSet(SET); if (!bundle) return unavailable();
  const snapshot = await policy.getPolicySnapshot(read); if (snapshot.status !== 'ok') return snapshot;
  const plan = planEmployeeExperienceUpgrade(snapshot.value.assumptions, bundle);
  if (plan.invalidKey) return unavailable(plan.invalidKey);
  if (!plan.required) return adoptOfferJourneyPolicy({ policy, identity, clock });
  const principals = await policy.getAssumption('identity.demo.principals', read);
  const principal = principals.status === 'ok' ? principals.value.value.find((row) => row.roles?.includes('greg')) : null;
  if (!principal) return unavailable();
  // Immutable policy dates must be distinct. A prior adoption may share the current
  // simulated instant, so advance exactly one millisecond with presenter authority.
  if (Date.parse(snapshot.value.effectiveFrom) === Date.parse(time.value.now)) {
    const advanced = await clock.advance(context, { commandId: `${SET}:clock:${context.runId}:${context.policyVersion}`,
      expectedClockVersion: time.value.clockVersion, to: new Date(Date.parse(time.value.now) + 1).toISOString() });
    if (advanced.status !== 'ok') return advanced;
    time = await clock.now(context); if (time.status !== 'ok') return time;
  }
  const greg = await identity.switchPrincipal(context, principal.principalId, `employee-experience-greg:${randomUUID()}`);
  if (greg.status !== 'ok') return greg;
  const adopted = await policy.refreshEmployeeExperience(greg.value.context, { commandId: `adopt:${SET}:${context.runId}`,
    expectedActiveVersion: greg.value.context.policyVersion, policyVersion: `${greg.value.context.policyVersion}+${SET}`,
    effectiveFrom: time.value.now, definitionSetId: SET });
  if (adopted.status !== 'ok' || adopted.value?.activation?.status !== 'active') return unavailable();
  return ok({ adopted: true, policyVersion: adopted.value.activation.policyVersion, adoption: adopted.value.adoption });
}
