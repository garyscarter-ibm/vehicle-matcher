import { inputDigest } from '../repository/core.js';

// Shared start step for journeys: Paula's confirmed brief, through actual services only.
// Never writes briefs, offers or holds itself; failures are a truthful startState, not a success.
export const fail = (step, reason) => ({ status: 'unavailable', step, reason });
export const failed = (step, outcome) => fail(step, outcome?.reason ?? outcome?.status ?? 'unavailable');

async function essentialFor(policy, read, key, value, source) {
  const [recommendation, lifecycle] = await Promise.all([
    policy.getAssumption('employee.recommendation.v1', read), policy.getAssumption('brief.lifecycle.v1', read)]);
  if (recommendation.status !== 'ok' || lifecycle.status !== 'ok') return null;
  const definition = key === 'charging' ? lifecycle.value.value?.charging : recommendation.value.value?.essentials?.[key];
  return definition ? { value, operator: definition.operator, unit: definition.unit, state: 'confirmed', source } : null;
}

async function briefContent(policy, read, input, source) {
  const preferences = Object.fromEntries(Object.entries(input.preferences).map(([key, p]) => [key,
    { value: p.value, importance: p.importance, valueState: 'confirmed', importanceState: 'confirmed', source }]));
  const essentials = {};
  for (const [key, value] of Object.entries(input.essentials)) {
    essentials[key] = await essentialFor(policy, read, key, value, source);
    if (!essentials[key]) return null;
  }
  return { schemaVersion: 1, preferences, essentials };
}


// Returns { ok: true, controller, context, key, time } after the brief is confirmed, else a failed startState.
export async function confirmPaulaBrief({ identity, clock, brief, policy, prepareEmployee, scenario, runId }) {
  const key = inputDigest(runId).slice(0, 32);
  const presenter = await identity.createPresenterSession(`scenario-start:${key}`);
  if (presenter.status !== 'ok') return failed('presenter-session', presenter);
  const controller = presenter.value.context;
  if (controller.runId !== runId) return fail('presenter-session', 'The new run is not current.');
  const input = scenario.inputs.briefs.find((entry) => entry.principalId === 'demo-paula');
  const person = scenario.principals.find((entry) => entry.principalId === 'demo-paula');
  if (!input || !person) return fail('brief', 'The scenario has no brief for Paula.');
  const employee = await identity.resolveEmployeeContext(controller, person.employeeId);
  if (employee.status !== 'ok') return failed('employee-context', employee);
  const context = employee.value;
  const prepared = await prepareEmployee(context);
  if (prepared.status !== 'ok') return failed('manual-context', prepared);

  const time = await clock.now(controller);
  if (time.status !== 'ok') return failed('clock', time);
  const content = await briefContent(policy, { runId, asOf: time.value.now, policyVersion: context.policyVersion }, input, `scenario:${scenario.scenarioId}`);
  if (!content) return fail('brief', 'The brief policy is unavailable.');
  const draft = await brief.saveDraft(context, { commandId: `scenario-start:${key}:draft`,
    expectedBriefVersion: 0, expectedDraftVersion: 0, brief: content });
  if (draft.status !== 'ok') return failed('brief-draft', draft);
  const confirmed = await brief.confirm(context, { commandId: `scenario-start:${key}:confirm`,
    expectedBriefVersion: 0, expectedDraftVersion: 1, consent: input.consent });
  if (confirmed.status !== 'ok') return failed('brief-confirm', confirmed);
  return { ok: true, controller, context, key, time: time.value, briefVersion: 1 };
}
