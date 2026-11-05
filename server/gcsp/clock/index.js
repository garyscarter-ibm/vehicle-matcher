import { inputDigest, ok, result } from '../repository/index.js';
import { DemoIdentityAdapter } from '../identity/index.js';
import { validInstant } from '../policy/file-provider.js';
import { loadClockConfiguration, buildScenarioSeed } from '../fixtures/scenario-v1.js';

const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128;
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

  constructor({ repository, policy, identity, environmentId, environmentKind }) {
    if (!repository || !policy || !identity || !text(environmentId)) throw new TypeError('Inject repository, policy, identity and environment.');
    this.#repository = repository; this.#policy = policy; this.#identity = identity;
    this.#environmentId = environmentId; this.#environmentKind = environmentKind;
  }

  async #current(context) {
    const found = await this.#repository.currentRun(this.#environmentId);
    if (found.status !== 'ok') return unavailable();
    if (context && (context.runId !== found.value.runId || context.environmentId !== this.#environmentId)) return stale();
    if (!validInstant(found.value.clockInstant) || !text(found.value.clockVersion)) return unavailable();
    return found;
  }

  #read(run) { return { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion }; }

  async initialize({ policyAsOf, commandId }) {
    if (this.#environmentKind !== 'synthetic') return result('forbidden', { reason: 'Reset and seeding require an isolated synthetic environment.' });
    if (!validInstant(policyAsOf) || !text(commandId)) return invalid('bootstrap', 'Supply policyAsOf and commandId.');
    const existing = await this.#repository.currentRun(this.#environmentId);
    if (existing.status === 'ok') return ok({ runId: existing.value.runId, initialized: false });
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
      lastTick = tick.value;
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

  async reset(context, input = {}) {
    const allowed = await this.#identity.requireRole(context, 'presenter');
    // requireRole checks the adapter-owned context before returning stale-run. Such a previously
    // authenticated presenter may retrieve only its existing reset receipt, never execute new work.
    if (allowed.status !== 'ok' && !(allowed.status === 'stale-run' && context.roles.includes('presenter'))) return allowed;
    if (this.#environmentKind !== 'synthetic') return result('forbidden', { reason: 'An operational provider cannot be reset.' });
    if (!text(input.commandId) || input.expectedRunId !== context.runId || !Number.isSafeInteger(input.expectedRunVersion)
      || input.expectedRunVersion < 1 || !text(input.scenarioVersion) || !text(input.fixtureVersion)
      || Object.keys(input).some((key) => !['commandId', 'expectedRunId', 'expectedRunVersion', 'scenarioVersion', 'fixtureVersion'].includes(key))) return invalid('reset', 'Supply the current run/version and exact scenario/fixture versions.');
    const cmd = command(`clock:reset:${input.commandId}`, input);
    const prior = await this.#repository.read(context, ref('event_receipts', context, { consumerId: 'command:reset-run', eventId: cmd.commandId }));
    if (prior.status === 'ok') return prior.value.inputDigest === cmd.inputDigest ? publicReset(prior.value.outcome) : result('conflict', { reason: 'idempotency-input-changed', current: {} });
    if (prior.status !== 'not-found') return prior;
    if (allowed.status !== 'ok') return allowed;
    const found = await this.#current(context);
    if (found.status !== 'ok') return found;
    const configured = await loadClockConfiguration(this.#policy, this.#read(found.value));
    if (configured.status !== 'ok') return configured;
    const { scenario } = configured.value;
    if (input.scenarioVersion !== scenario.scenarioVersion || input.fixtureVersion !== scenario.fixtureVersion) return invalid('fixtureVersion', 'This scenario/fixture version is not available.');
    const previous = found.value.versions?.syntheticIdentityInventory;
    if (!previous?.snapshot || previous.snapshot.contentDigest !== previous.contentDigest || previous.snapshot.revision !== previous.revision) return unavailable();
    const runId = `demo-${inputDigest([this.#environmentId, context.runId, input.commandId]).slice(0, 32)}`;
    const seed = await buildScenarioSeed({ policy: this.#policy, read: this.#read(found.value), configuration: configured.value, runId, inventory: previous.snapshot });
    if (seed.status !== 'ok') return seed;
    return publicReset(await this.#repository.resetRun(context, cmd, { expectedCurrentRunId: input.expectedRunId, expectedRunVersion: input.expectedRunVersion,
      nextRun: this.#runRow(runId, found.value.policyVersion, configured.value, seed.value.versions), rows: seed.value.rows }));
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
