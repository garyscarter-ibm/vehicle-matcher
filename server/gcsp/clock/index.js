import { inputDigest, ok, result } from '../repository/index.js';
import { DemoIdentityAdapter } from '../identity/index.js';
import { validInstant } from '../policy/file-provider.js';
import { loadClockConfiguration, buildScenarioSeed } from '../fixtures/scenario-v1.js';
import { randomUUID } from 'node:crypto';
import { isPreparedScenarioFixture } from '../fixtures/scenarios/index.js';
import { composePresenterTick, readPresenterClockConfiguration } from '../presenter-controls/commands.js';

const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const persistedClock = (run) => validInstant(run.clockInstant) && text(run.clockVersion)
  && /^[1-9][0-9]*$/.test(run.clockVersion) && Number.isSafeInteger(Number(run.clockVersion));
const initializedRun = (run) => {
  const versions = run.versions;
  const inventory = versions?.syntheticIdentityInventory;
  return persistedClock(run) && ['policy', 'scenario', 'fixture', 'corpus'].every((key) => text(versions?.[key]))
    && versions.policy === run.policyVersion && versions.scenario === run.scenarioVersion
    && versions.fixture === run.fixtureVersion && versions.corpus === run.corpusVersion
    && Number.isSafeInteger(inventory?.revision) && inventory.revision > 0 && /^[a-f0-9]{64}$/.test(inventory.contentDigest)
    && inventory.snapshot && inventory.snapshot.revision === inventory.revision
    && inventory.snapshot.contentDigest === inventory.contentDigest && Array.isArray(inventory.snapshot.records);
};
const invalid = (field, reason) => result('invalid', { code: 'invalid-clock-command', reasons: [{ field, reason }] });
const unavailable = () => result('unavailable', { reason: 'Demo clock is unavailable.', retryable: true });
const stale = () => result('stale-run', { reason: 'This request belongs to an earlier demonstration run.' });
const ref = (table, context, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const command = (commandId, payload) => ({ commandId, inputDigest: inputDigest(payload) });
const publicVersions = (versions) => ({ ...versions, syntheticIdentityInventory: versions.syntheticIdentityInventory
  ? { revision: versions.syntheticIdentityInventory.revision, contentDigest: versions.syntheticIdentityInventory.contentDigest } : null });
const publicReset = (outcome) => outcome.status === 'ok' ? ok({ ...outcome.value, versions: publicVersions(outcome.value.versions) }) : outcome;

export class DemoClock {
  #repository; #policy; #identity; #environmentId; #environmentKind;
  #handlers = new Map(); #sealed = false; #startup;

  constructor({ repository, policy, identity, environmentId, environmentKind }) {
    if (!repository || !policy || !identity || !text(environmentId)) throw new TypeError('Inject repository, policy, identity and environment.');
    this.#repository = repository; this.#policy = policy; this.#identity = identity;
    this.#environmentId = environmentId; this.#environmentKind = environmentKind;
  }

  async #current(context) {
    const found = await this.#repository.currentRun(this.#environmentId);
    if (found.status !== 'ok') return unavailable();
    if (context && (context.runId !== found.value.runId || context.environmentId !== this.#environmentId)) return stale();
    if (!persistedClock(found.value)) return unavailable();
    return found;
  }

  #read(run) { return { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion }; }

  async initialize({ policyAsOf, commandId }) {
    if (this.#environmentKind !== 'synthetic') return result('forbidden', { reason: 'Reset and seeding require an isolated synthetic environment.' });
    if (!validInstant(policyAsOf) || !text(commandId)) return invalid('bootstrap', 'Supply policyAsOf and commandId.');
    const existing = await this.#repository.currentRun(this.#environmentId);
    if (existing.status === 'ok') return initializedRun(existing.value)
      ? ok({ runId: existing.value.runId, initialized: false }) : unavailable();
    if (existing.status !== 'not-found') return existing;
    const runId = `demo-${inputDigest([this.#environmentId, commandId]).slice(0, 32)}`;
    const active = await this.#policy.getActiveVersion({ runId, asOf: policyAsOf });
    if (active.status !== 'ok') return unavailable();
    const read = { runId, asOf: policyAsOf, policyVersion: active.policyVersion };
    const configuration = await loadClockConfiguration(this.#policy, read);
    if (configuration.status !== 'ok') return configuration;
    const seed = await buildScenarioSeed({ policy: this.#policy, read, configuration: configuration.value, runId });
    if (seed.status !== 'ok') return seed;
    const context = { runId, environmentId: this.#environmentId, principalId: 'clock-bootstrap', roles: [] };
    return publicReset(await this.#repository.resetRun(context, command(`clock:initialize:${commandId}`, { policyAsOf }), {
      expectedCurrentRunId: null, nextRun: this.#runRow(runId, active.policyVersion, configuration.value, seed.value.versions), rows: seed.value.rows,
    }));
  }

  #runRow(runId, policyVersion, configuration, versions) {
    return { runId, environmentId: this.#environmentId, status: 'active', current: true, policyVersion,
      scenarioVersion: configuration.scenario.scenarioVersion, fixtureVersion: configuration.scenario.fixtureVersion,
      corpusVersion: configuration.scenario.corpusVersion, clockInstant: configuration.scenario.startsAt,
      clockVersion: configuration.commands.initialClockVersion, versions };
  }

  async now(context) {
    const found = await this.#current(context);
    return found.status === 'ok' ? ok({ now: found.value.clockInstant, runId: found.value.runId, clockVersion: found.value.clockVersion }) : found;
  }

  async readState(context) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    if (allowed.status !== 'ok') return allowed;
    const found = await this.#current(context);
    if (found.status !== 'ok') return found;
    const run = found.value;
    let lastTick = null;
    if (run.versions?.lastTickId) {
      const tick = await this.#repository.read(context, ref('tick_runs', context, { tickId: run.versions.lastTickId }));
      if (tick.status !== 'ok') return tick;
      lastTick = this.#tickValue(tick.value);
    }
    return ok({ runId: run.runId, now: run.clockInstant, clockVersion: run.clockVersion, runVersion: run.version,
      versions: publicVersions(run.versions), lastTick });
  }

  async advance(context, input = {}) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    if (allowed.status !== 'ok') return allowed;
    if (!text(input.commandId) || !text(input.expectedClockVersion) || Object.keys(input).some((key) => !['commandId', 'expectedClockVersion', 'bySeconds', 'to'].includes(key))
      || Object.hasOwn(input, 'bySeconds') === Object.hasOwn(input, 'to')) return invalid('advance', 'Supply commandId, expectedClockVersion and one of bySeconds or to.');
    const current = await this.#current(context);
    if (current.status !== 'ok') return current;
    const configured = await loadClockConfiguration(this.#policy, this.#read(current.value));
    if (configured.status !== 'ok') return configured;
    return this.#repository.transaction(context, command(`clock:advance:${input.commandId}`, input), async (tx) => {
      const found = await tx.get(ref('runs', context));
      if (found.status !== 'ok') return found;
      const run = found.value;
      if (run.clockVersion !== input.expectedClockVersion) return result('stale-version', { expectedVersion: input.expectedClockVersion, currentVersion: run.clockVersion, resource: ref('runs', context) });
      let target;
      if (Object.hasOwn(input, 'bySeconds')) {
        if (!Number.isSafeInteger(input.bySeconds) || input.bySeconds <= 0) return invalid('bySeconds', 'Supply a positive integer in seconds.');
        target = Date.parse(run.clockInstant) + input.bySeconds * 1000;
      } else {
        const value = configured.value.scenario.namedTimes[input.to] ?? input.to;
        if (!validInstant(value)) return invalid('to', 'Supply a configured named time or UTC instant.');
        target = Date.parse(value);
      }
      if (!Number.isFinite(target) || target <= Date.parse(run.clockInstant) || target > 8640000000000000) return invalid('to', 'Time must move forward to a valid instant.');
      const now = new Date(target).toISOString();
      const clockVersion = String(Number(run.clockVersion) + 1);
      if (!Number.isSafeInteger(Number(clockVersion))) return unavailable();
      const changed = await tx.compareAndSwap(ref('runs', context), run.version, { clockInstant: now, clockVersion });
      return changed.status === 'ok' ? ok({ runId: run.runId, now, clockVersion }) : changed;
    });
  }

  async readControlsConfiguration(context) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    if (allowed.status !== 'ok') return allowed;
    const current = await this.#current(context);
    return current.status === 'ok' ? readPresenterClockConfiguration(this.#policy, current.value) : current;
  }

  async advanceAndTick(context, input) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    if (allowed.status !== 'ok') return allowed;
    const current = await this.#current(context);
    if (current.status !== 'ok') return current;
    return composePresenterTick({ repository: this.#repository, policy: this.#policy, clock: this }, context, input);
  }

  async reset(context, input = {}, preparedFixture) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    // requireRole checks the adapter-owned context before returning stale-run. Such a previously
    // authenticated presenter may retrieve only its existing reset receipt, never execute new work.
    if (allowed.status !== 'ok' && !(allowed.status === 'stale-run' && context.roles.includes('presenter'))) return allowed;
    if (this.#environmentKind !== 'synthetic') return result('forbidden', { reason: 'An operational provider cannot be reset.' });
    if (!text(input.commandId) || input.expectedRunId !== context.runId || !Number.isSafeInteger(input.expectedRunVersion)
      || input.expectedRunVersion < 1 || !text(input.scenarioVersion) || !text(input.fixtureVersion)
      || Object.keys(input).some((key) => !['commandId', 'expectedRunId', 'expectedRunVersion', 'scenarioVersion', 'fixtureVersion'].includes(key))) return invalid('reset', 'Supply the current run/version and exact scenario/fixture versions.');
    if (preparedFixture !== undefined && (!isPreparedScenarioFixture(preparedFixture, this.#policy)
      || preparedFixture.preparedForRunId !== context.runId)) return invalid('fixture', 'Use a trusted run-bound scenario fixture selection.');
    const selection = preparedFixture === undefined ? null : { scenarioId: preparedFixture.scenarioId,
      sourceVersion: preparedFixture.sourceVersion, scenarioVersion: preparedFixture.scenarioVersion,
      fixtureVersion: preparedFixture.fixtureVersion, policyVersion: preparedFixture.policyVersion, inputDigest: preparedFixture.inputDigest };
    const cmd = command(`clock:reset:${input.commandId}`, selection ? { ...input, selection } : input);
    const prior = await this.#repository.read(context, ref('event_receipts', context, { consumerId: 'command:reset-run', eventId: cmd.commandId }));
    if (prior.status === 'ok') return prior.value.inputDigest === cmd.inputDigest ? publicReset(prior.value.outcome) : result('conflict', { reason: 'idempotency-input-changed', current: {} });
    if (prior.status !== 'not-found') return prior;
    if (allowed.status !== 'ok') return allowed;
    const found = await this.#current(context);
    if (found.status !== 'ok') return found;
    const configured = await loadClockConfiguration(this.#policy, this.#read(found.value));
    if (configured.status !== 'ok') return configured;
    if (preparedFixture && (preparedFixture.policyVersion !== found.value.policyVersion
      || preparedFixture.scenarioVersion !== input.scenarioVersion || preparedFixture.fixtureVersion !== input.fixtureVersion)) {
      return result('stale-version', { expectedVersion: preparedFixture.policyVersion, currentVersion: found.value.policyVersion,
        resource: { table: 'scenario-fixtures' }, action: 'refresh' });
    }
    const configuration = preparedFixture?.configuration ?? configured.value;
    const { scenario } = configuration;
    if (input.scenarioVersion !== scenario.scenarioVersion || input.fixtureVersion !== scenario.fixtureVersion) return invalid('fixtureVersion', 'This scenario/fixture version is not available.');
    const previous = found.value.versions?.syntheticIdentityInventory;
    if (!previous?.snapshot || previous.snapshot.contentDigest !== previous.contentDigest || previous.snapshot.revision !== previous.revision) return unavailable();
    const runId = `demo-${inputDigest([this.#environmentId, context.runId, input.commandId]).slice(0, 32)}`;
    // The new run pins the version its own policy store resolves; a per-run store may not hold the old run's adopted one.
    const active = await this.#policy.getActiveVersion({ runId, asOf: scenario.startsAt });
    if (active.status !== 'ok') return active;
    const nextRead = { runId, asOf: scenario.startsAt, policyVersion: active.policyVersion };
    const seed = await buildScenarioSeed({ policy: this.#policy, read: nextRead, configuration, runId, inventory: previous.snapshot });
    if (seed.status !== 'ok') return seed;
    return publicReset(await this.#repository.resetRun(context, cmd, { expectedCurrentRunId: input.expectedRunId, expectedRunVersion: input.expectedRunVersion,
      nextRun: this.#runRow(runId, active.policyVersion, configuration, { ...seed.value.versions,
        ...(selection ? { scenarioSelection: selection } : {}) }), rows: seed.value.rows }));
  }

  async registerHandler({ handlerId, stage, handle } = {}) {
    if (this.#sealed || !text(handlerId) || !/^[a-z0-9][a-z0-9-]*$/.test(handlerId)
      || typeof handle !== 'function' || this.#handlers.has(handlerId)) return invalid('handler', 'Register each stable handler ID once, before startup/ticks.');
    const run = await this.#current();
    if (run.status !== 'ok') return run;
    const configured = await loadClockConfiguration(this.#policy, this.#read(run.value));
    if (configured.status !== 'ok') return configured;
    if (!configured.value.stages.includes(stage)) return invalid('stage', 'Unknown handler stage.');
    // Recheck after asynchronous policy reads, so concurrent registration cannot overwrite a handler.
    if (this.#sealed || this.#handlers.has(handlerId)) return invalid('handler', 'Registry is sealed or this ID is registered.');
    this.#handlers.set(handlerId, { handlerId, stage, handle });
    return ok({ handlerId, stage });
  }

  #tickValue(row) {
    return { runId: row.runId, tickId: row.tickId, eventId: row.eventId, now: row.targetClock.now,
      clockVersion: row.targetClock.clockVersion, kind: row.targetClock.kind, handlerOrder: row.handlerOrder,
      missingStages: row.targetClock.missingStages, outcomes: row.outcomes, state: row.state };
  }

  async tick(context, input = {}) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    if (allowed.status !== 'ok') return allowed;
    if (!text(input.eventId) || !text(input.expectedClockVersion) || !/^[a-f0-9]{64}$/.test(input.inputDigest)
      || Object.keys(input).some((key) => !['eventId', 'expectedClockVersion', 'inputDigest'].includes(key))) return invalid('tick', 'Supply eventId, inputDigest and expectedClockVersion.');
    return this.#executeTick(context, input, 'presenter');
  }

  // One promise per backend instance, called by startup composition without requiring an HTTP request.
  // A later process startup gets a new event; handlers reuse persisted pending-operation IDs.
  reconcileStartup(environmentId = this.#environmentId) {
    if (environmentId !== this.#environmentId) return Promise.resolve(stale());
    this.#startup ??= (async () => {
      const run = await this.#current();
      if (run.status !== 'ok') return run;
      const context = { environmentId, runId: run.value.runId, principalId: 'clock-startup', roles: [] };
      const eventId = `startup-${randomUUID()}`;
      return this.#executeTick(context, { eventId, inputDigest: inputDigest({ startup: true }), expectedClockVersion: run.value.clockVersion }, 'startup');
    })();
    return this.#startup;
  }

  async #executeTick(context, input, kind) {
    const current = await this.#current(context);
    if (current.status !== 'ok') return current;
    const configured = await loadClockConfiguration(this.#policy, this.#read(current.value));
    if (configured.status !== 'ok') return configured;
    this.#sealed = true;
    const stages = kind === 'startup' ? configured.value.commands.startupStages : configured.value.stages;
    const order = [...this.#handlers.values()].filter((row) => stages.includes(row.stage))
      .sort((a, b) => configured.value.stages.indexOf(a.stage) - configured.value.stages.indexOf(b.stage)
        || (a.handlerId < b.handlerId ? -1 : a.handlerId > b.handlerId ? 1 : 0))
      .map(({ handlerId, stage }) => ({ handlerId, stage }));
    const tickId = input.eventId;
    const tickRef = ref('tick_runs', context, { tickId });
    const digest = inputDigest({ ...input, kind });
    const initialized = await this.#repository.transaction(context, { commandId: `clock:tick:start:${tickId}`, inputDigest: digest }, async (tx) => {
      const run = await tx.get(ref('runs', context));
      if (run.status !== 'ok') return run;
      if (run.value.clockVersion !== input.expectedClockVersion) return result('stale-version', {
        expectedVersion: input.expectedClockVersion, currentVersion: run.value.clockVersion, resource: ref('runs', context),
      });
      const inserted = await tx.insert('tick_runs', { runId: context.runId, tickId, eventId: input.eventId, commandId: input.eventId,
        inputDigest: digest, targetClock: { now: run.value.clockInstant, clockVersion: run.value.clockVersion, kind,
          missingStages: stages.filter((stage) => !order.some((row) => row.stage === stage)) },
        handlerOrder: order, outcomes: [], state: 'running' });
      if (inserted.status !== 'ok') return inserted;
      const updated = await tx.compareAndSwap(ref('runs', context), run.value.version, { versions: { ...run.value.versions, lastTickId: tickId } });
      return updated.status === 'ok' ? inserted : updated;
    });
    if (initialized.status !== 'ok') return initialized;
    let tick = await this.#repository.read(context, tickRef);
    if (tick.status !== 'ok') return tick;
    if (['completed', 'pending'].includes(tick.value.state)) return ok(this.#tickValue(tick.value));
    for (const entry of tick.value.handlerOrder) {
      const descriptor = this.#handlers.get(entry.handlerId);
      if (!descriptor || descriptor.stage !== entry.stage) return this.#interrupted(context, tickRef, entry, unavailable());
      const handlerCommand = { commandId: `clock:tick:handler:${inputDigest([tickId, entry.handlerId])}`,
        inputDigest: inputDigest([digest, entry]) };
      const prior = await this.#repository.read(context, ref('event_receipts', context, { consumerId: `clock:handler:${entry.handlerId}`, eventId: tickId }));
      let outcome;
      if (prior.status === 'ok') {
        if (prior.value.inputDigest !== handlerCommand.inputDigest) return result('conflict', { reason: 'idempotency-input-changed', current: {} });
        outcome = prior.value.outcome;
      } else if (prior.status !== 'not-found') return prior;
      else {
        const stillCurrent = await this.#current(context);
        if (stillCurrent.status !== 'ok') return stillCurrent;
        try {
          // Services own their transactions and external-operation protocol. This helper gives local
          // work one durable command key, so a crash before the handler receipt reuses its outcome.
          outcome = await descriptor.handle({ context, eventId: tickId, tickId, now: tick.value.targetClock.now,
            clockVersion: tick.value.targetClock.clockVersion, operationId: handlerCommand.commandId,
            transaction: (work) => this.#repository.transaction(context, handlerCommand, work) });
        } catch { outcome = unavailable(); }
      }
      if (!outcome || !['ok', 'pending'].includes(outcome.status)) return this.#interrupted(context, tickRef, entry, outcome?.status ? outcome : unavailable());
      if (outcome.status === 'ok' && !Object.hasOwn(outcome, 'value') || outcome.status === 'pending'
        && !['operationId', 'operationType', 'lastKnownState'].every((key) => text(outcome[key]))) return this.#interrupted(context, tickRef, entry, unavailable());
      const handled = await this.#repository.transaction(context,
        { ...handlerCommand, commandId: `clock:tick:receipt:${inputDigest([tickId, entry.handlerId])}` }, async (tx) => {
        const state = await tx.get(tickRef);
        if (state.status !== 'ok') return state;
        const receipt = await tx.recordReceipt({ consumerId: `clock:handler:${entry.handlerId}`, eventId: tickId,
          eventType: kind, handlerId: entry.handlerId, inputDigest: handlerCommand.inputDigest,
          inputVersions: { clock: state.value.targetClock.clockVersion, policy: current.value.policyVersion },
          state: outcome.status === 'pending' ? 'pending' : 'completed', outcome });
        if (receipt.status !== 'ok') return receipt;
        const outcomes = state.value.outcomes.filter((row) => row.handlerId !== entry.handlerId);
        outcomes.push({ ...entry, outcome });
        const changed = await tx.compareAndSwap(tickRef, state.value.version, { outcomes, state: 'running' });
        return changed.status === 'ok' ? ok({ outcome }) : changed;
      });
      if (handled.status !== 'ok') return this.#interrupted(context, tickRef, entry, handled);
    }
    return this.#repository.transaction(context, { commandId: `clock:tick:finish:${tickId}`, inputDigest: digest }, async (tx) => {
      const state = await tx.get(tickRef);
      if (state.status !== 'ok') return state;
      const changed = await tx.compareAndSwap(tickRef, state.value.version, {
        state: state.value.outcomes.some((row) => row.outcome.status === 'pending') ? 'pending' : 'completed',
      });
      return changed.status === 'ok' ? ok(this.#tickValue(changed.value)) : changed;
    });
  }

  async #interrupted(context, tickRef, entry, outcome) {
    // A reset may have retired the run between handlers. Its stale refusal takes precedence.
    if (outcome.status === 'stale-run') return outcome;
    const marked = await this.#repository.transaction(context,
      command(`clock:tick:interrupt:${inputDigest([tickRef.key.tickId, entry.handlerId])}`, entry), async (tx) => {
        const tick = await tx.get(tickRef);
        if (tick.status !== 'ok') return tick;
        const outcomes = tick.value.outcomes.filter((row) => row.handlerId !== entry.handlerId);
        outcomes.push({ ...entry, outcome });
        return tx.compareAndSwap(tickRef, tick.value.version, { state: 'interrupted', outcomes });
      });
    return marked.status === 'ok' ? result('unavailable', { tickId: tickRef.key.tickId, handlerId: entry.handlerId,
      reason: 'A registered clock handler did not complete. Retry this event ID.', retryable: true, handlerOutcome: outcome }) : marked;
  }
}

export const createDemoClock = (configuration) => new DemoClock(configuration);

// Trusted backend composition only: one repository current-run authority also feeds DemoIdentity.
export async function createDemoRuntime(options) {
  const { repository, policy, environmentId, sessionNow, secureCookies } = options;
  const identity = new DemoIdentityAdapter({ repository, policy, sessionNow, secureCookies,
    currentRun: async () => {
      const current = await repository.currentRun(environmentId);
      return current.status === 'ok' ? { runId: current.value.runId, environmentId } : null;
    } });
  const clock = createDemoClock({ ...options, identity });
  const initialized = await clock.initialize(options);
  return initialized.status === 'ok' ? ok({ clock, identity }) : initialized;
}
