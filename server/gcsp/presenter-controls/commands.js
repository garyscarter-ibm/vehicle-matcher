import { inputDigest, ok, result } from '../repository/core.js';
import { loadClockConfiguration } from '../fixtures/scenario-v1.js';
import { validInstant } from '../policy/file-provider.js';

const invalid = () => result('invalid', { code: 'invalid-presenter-tick', reasons: [{ field: 'tick',
  reason: 'Supply commandId, expectedClockVersion and mode step, to or next-release. Only mode to accepts a named time or UTC instant.' }] });

export async function readPresenterClockConfiguration(policy, run) {
  const read = { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion };
  const [configured, assumption] = await Promise.all([
    loadClockConfiguration(policy, read), policy.getAssumption('clock.presenter.stepSeconds', read),
  ]);
  if (configured.status !== 'ok') return configured;
  if (assumption.status !== 'ok' || assumption.policyVersion !== read.policyVersion
    || assumption.value?.unit !== 'seconds' || !Number.isSafeInteger(assumption.value.value) || assumption.value.value <= 0) {
    return result('unavailable', { code: 'presenter-step-unavailable',
      reason: 'The current policy needs a valid presenter step in seconds.', retryable: false });
  }
  const step = assumption.value;
  const namedTimes = structuredClone(configured.value.scenario.namedTimes);
  const nextRelease = Object.hasOwn(namedTimes, 'release') && Date.parse(namedTimes.release) > Date.parse(run.clockInstant)
    ? { status: 'available', to: 'release', at: namedTimes.release }
    : { status: 'unavailable', reason: 'No future release cue is configured.' };
  return ok({ policyVersion: read.policyVersion, step, namedTimes, nextRelease });
}

// Persist the original plan before either subcommand, so a lost response cannot resolve a new target.
// The existing clock and repository retain authority for advancement and handler execution/replay.
export async function composePresenterTick({ repository, policy, clock }, context, input = {}) {
  const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
  if (!input || typeof input !== 'object' || Array.isArray(input) || !text(input.commandId) || !text(input.expectedClockVersion)
    || !['step', 'to', 'next-release'].includes(input.mode)
    || Object.keys(input).some((key) => !['commandId', 'expectedClockVersion', 'mode', 'to'].includes(key))
    || (input.mode === 'to' ? !text(input.to) : Object.hasOwn(input, 'to'))) return invalid();
  const key = inputDigest(input.commandId);
  const planned = await repository.transaction(context, { commandId: `presenter:tick:plan:${key}`, inputDigest: inputDigest(input) }, async (tx) => {
    const current = await tx.get({ table: 'runs', key: { runId: context.runId } });
    if (current.status !== 'ok') return current;
    if (current.value.clockVersion !== input.expectedClockVersion) return result('stale-version', {
      expectedVersion: input.expectedClockVersion, currentVersion: current.value.clockVersion, resource: { table: 'runs', key: { runId: context.runId } },
    });
    const configured = await readPresenterClockConfiguration(policy, current.value);
    if (configured.status !== 'ok') return configured;
    const { step, namedTimes, nextRelease } = configured.value;
    let target;
    if (input.mode === 'step') target = Date.parse(current.value.clockInstant) + step.value * 1000;
    else if (input.mode === 'next-release') {
      if (nextRelease.status !== 'available') return result('unavailable', { reason: nextRelease.reason, retryable: false });
      target = Date.parse(nextRelease.at);
    } else {
      const value = Object.hasOwn(namedTimes, input.to) ? namedTimes[input.to] : input.to;
      if (!validInstant(value)) return invalid();
      target = Date.parse(value);
    }
    if (!Number.isFinite(target) || target <= Date.parse(current.value.clockInstant) || target > 8640000000000000) return invalid();
    return ok({ advance: { commandId: `presenter-${key}`, expectedClockVersion: input.expectedClockVersion,
      to: new Date(target).toISOString() }, eventId: `presenter-${key}`, inputDigest: inputDigest(input) });
  });
  if (planned.status !== 'ok') return planned;
  const advanced = await clock.advance(context, planned.value.advance);
  if (advanced.status !== 'ok') return advanced;
  const tick = await clock.tick(context, { eventId: planned.value.eventId, inputDigest: planned.value.inputDigest,
    expectedClockVersion: advanced.value.clockVersion });
  if (tick.status === 'ok') return ok({ advance: advanced.value, tick: tick.value });
  const state = await clock.readState(context);
  return { ...tick, advance: advanced.value,
    ...(state.status === 'ok' && state.value.lastTick?.eventId === planned.value.eventId ? { tick: state.value.lastTick } : {}) };
}
