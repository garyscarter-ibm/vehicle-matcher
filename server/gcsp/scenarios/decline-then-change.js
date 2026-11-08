import { inputDigest } from '../repository/core.js';
import { confirmPaulaBrief, fail, failed } from './brief-start.js';

// Start loader for decline-then-change. Runs after the reset, inside the new run, through actual
// services only. Returns a small truthful startState, never a fabricated success.
export async function startDeclineThenChange({ identity, clock, brief, policy, repository, prepareEmployee, scenario, runId }) {
  const start = await confirmPaulaBrief({ identity, clock, brief, policy, prepareEmployee, scenario, runId });
  if (!start.ok) return start;
  const { controller, context, key, time } = start;

  // The release cue and tick are the presenter's own controls; stock release and allocation do the rest.
  const advanced = await clock.advance(controller, { commandId: `scenario-start:${key}:advance`,
    expectedClockVersion: time.clockVersion, to: 'release' });
  if (advanced.status !== 'ok') return failed('release-cue', advanced);
  const eventId = `scenario-start:${key}:release`;
  const ticked = await clock.tick(controller, { eventId, inputDigest: inputDigest(eventId),
    expectedClockVersion: advanced.value.clockVersion });
  if (ticked.status !== 'ok') return failed('release-tick', ticked);

  const offers = await repository.query(context, 'offers', { employeeId: context.employeeId });
  const first = offers.status === 'ok' ? offers.value.find((row) => row.state === 'active') : null;
  if (!first) return fail('first-offer', 'No buddy offer was produced for Paula on the release tick.');
  return { status: 'ok', firstOfferId: first.offerId, now: advanced.value.now };
}
