import { DemoClock } from '../clock/index.js';
import { DemoIdentityAdapter } from '../identity/index.js';
import { PolicyService } from '../policy/index.js';
import { loadScenarioCatalogue, prepareScenarioFixture, hasScenarioStartLoader } from '../fixtures/scenarios/index.js';
import { startDeclineThenChange } from './decline-then-change.js';
import { startMainSuccessfulJourney } from './main-successful-journey.js';
import { startNoSuitableMatch } from './no-suitable-match.js';
import { startDataUnavailable } from './data-unavailable.js';
import { startUncertainHandoff } from './uncertain-handoff.js';
import { inputDigest, ok, result } from '../repository/core.js';

const START_BY_SCENARIO = { 'main-successful-journey': startMainSuccessfulJourney, 'decline-then-change': startDeclineThenChange,
  'no-suitable-match': startNoSuitableMatch, 'data-unavailable': startDataUnavailable,
  'uncertain-handoff': startUncertainHandoff, 'uncertain-handoff-rejected': startUncertainHandoff };

const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;
const invalid = () => result('invalid', { code: 'invalid-scenario-command', reasons: [{ field: 'reset', reason: 'Supply scenario, fixture and policy versions with the current run/version and commandId.' }] });
const unavailable = () => result('unavailable', { reason: 'The named scenario service has not been configured with the GCSP runtime.', retryable: false });
const staleVersion = (field, expectedVersion, currentVersion) => result('stale-version', {
  expectedVersion, currentVersion, resource: { table: 'scenario-catalogue', field }, action: 'refresh',
});
export class ScenarioService {
  #repository; #policy; #clock; #identity; #brief; #prepareEmployee; #afterReset; #faults;
  constructor({ repository, policy, clock, identity, brief, prepareEmployee, afterReset, faults } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
    this.#brief = brief; this.#prepareEmployee = prepareEmployee;
    this.#afterReset = typeof afterReset === 'function' ? afterReset : undefined;
    this.#faults = Object.fromEntries(Object.entries(faults ?? {}).filter(([, row]) => typeof row?.set === 'function' && typeof row.read === 'function'));
  }
  async #authorize(context, replay = false) {
    if (!(this.#clock instanceof DemoClock) || !(this.#identity instanceof DemoIdentityAdapter)
      || !(this.#policy instanceof PolicyService) || !this.#repository) return unavailable();
    const allowed = await this.#identity.requireRole(context, 'presenter');
    return replay && allowed.status === 'stale-run' && context.roles.includes('presenter') ? ok({ historical: true }) : allowed;
  }
  async #run(context) {
    return this.#repository.read(context, { table: 'runs', key: { runId: context.runId } });
  }
  #read(run) { return { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion }; }
  async readCatalogue(context) {
    const allowed = await this.#authorize(context); if (allowed.status !== 'ok') return allowed;
    const run = await this.#run(context); if (run.status !== 'ok') return run;
    return loadScenarioCatalogue({ policy: this.#policy, read: this.#read(run.value) });
  }
  async readState(context) {
    const allowed = await this.#authorize(context); if (allowed.status !== 'ok') return allowed;
    const state = await this.#clock.readState(context); if (state.status !== 'ok') return state;
    const catalogue = await this.readCatalogue(context); if (catalogue.status !== 'ok') return catalogue;
    const selected = state.value.versions.scenarioSelection;
    const current = catalogue.value.scenarios.find((s) => selected ? s.scenarioId === selected.scenarioId
      && s.fixtureVersion === selected.fixtureVersion : s.kind === 'mechanics' && s.scenarioVersion === state.value.versions.scenario
      && s.fixtureVersion === state.value.versions.fixture);
    return ok({ ...state.value, catalogueVersion: catalogue.value.catalogueVersion, currentScenario: current
      ? { scenarioId: current.scenarioId, name: current.name, scenarioVersion: current.scenarioVersion,
        fixtureVersion: current.fixtureVersion, policyVersion: current.policyVersion } : null });
  }
  // Synthetic adapter faults for the current run only; a reset starts a new run with none set.
  async readFaults(context) {
    const allowed = await this.#authorize(context); if (allowed.status !== 'ok') return allowed;
    return ok({ runId: context.runId, faults: Object.values(this.#faults).map((row) => row.read(context.runId)) });
  }
  async setFault(context, input = {}) {
    const allowed = await this.#authorize(context); if (allowed.status !== 'ok') return allowed;
    const faults = this.#faults[input?.adapter];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['commandId', 'adapter', 'mode'].includes(key))
      || !text(input.commandId) || !faults || !text(input.mode)) return result('invalid', { code: 'invalid-fault-command',
      reasons: [{ field: 'fault', reason: 'Supply commandId, a configured synthetic adapter and one of its modes.' }] });
    const run = await this.#run(context); if (run.status !== 'ok') return run;
    if (!run.value.current) return result('stale-run', { reason: 'This request belongs to an earlier demonstration run.' });
    if (!faults.set(context.runId, input.mode)) return result('invalid', { code: 'invalid-fault-command',
      reasons: [{ field: 'mode', reason: `Choose one of: ${faults.read(context.runId).modes.join(', ')}.` }] });
    return ok({ runId: context.runId, faults: Object.values(this.#faults).map((row) => row.read(context.runId)) });
  }
  async reset(context, input = {}) {
    const allowed = await this.#authorize(context, true); if (allowed.status !== 'ok') return allowed;
    const fields = ['commandId', 'expectedRunId', 'expectedRunVersion', 'scenarioId', 'scenarioVersion', 'fixtureVersion', 'policyVersion'];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !fields.includes(key))
      || !fields.filter((key) => key !== 'expectedRunVersion').every((key) => text(input[key]))
      || !Number.isSafeInteger(input.expectedRunVersion) || input.expectedRunVersion < 1) return invalid();
    if (input.expectedRunId !== context.runId) return result('stale-run', { reason: 'This request belongs to another demonstration run.' });
    const run = await this.#run(context); if (run.status !== 'ok') return run;
    const catalogue = await loadScenarioCatalogue({ policy: this.#policy, read: this.#read(run.value) });
    if (catalogue.status !== 'ok') return catalogue;
    const scenario = catalogue.value.scenarios.find((s) => s.scenarioId === input.scenarioId);
    if (!scenario) return result('not-found', { resourceType: 'scenario' });
    for (const field of ['scenarioVersion', 'fixtureVersion', 'policyVersion']) {
      if (input[field] !== scenario[field]) return staleVersion(field, input[field], scenario[field]);
    }
    // A historical presenter can only reach the clock's existing durable reset receipt.
    if (!allowed.value?.historical && input.expectedRunVersion !== run.value.version) return staleVersion('runVersion', input.expectedRunVersion, run.value.version);
    if (allowed.value?.historical && scenario.kind !== 'mechanics') return result('stale-run', { reason: 'This request belongs to an earlier demonstration run.' });
    const fixture = await prepareScenarioFixture({ scenarioId: scenario.scenarioId, policy: this.#policy, read: this.#read(run.value) });
    if (fixture.status !== 'ok') return fixture;
    const journey = scenario.kind === 'journey' && hasScenarioStartLoader(scenario.scenarioId);
    // Refuse before any reset when the services the start state needs are not composed.
    if (journey && !(this.#brief && typeof this.#prepareEmployee === 'function')) return result('unavailable', {
      code: 'scenario-start-services-unavailable', reason: 'not available yet', retryable: false, scenarioId: scenario.scenarioId });
    const reset = await this.#clock.reset(context, { commandId: `scenario:${inputDigest(input.commandId)}`, expectedRunId: input.expectedRunId,
      expectedRunVersion: input.expectedRunVersion, scenarioVersion: input.scenarioVersion, fixtureVersion: input.fixtureVersion }, fixture.value);
    if (reset.status !== 'ok') return reset;
    // The host prepares the new run (stock source, reviewed policy sets); policy is per run.
    let adopted = ok({});
    if (this.#afterReset && text(reset.value?.runId)) {
      try { adopted = (await this.#afterReset(reset.value.runId)) ?? ok({}); } catch { adopted = result('unavailable', {}); }
    }
    if (!journey) return reset;
    if (adopted.status !== 'ok') return ok({ ...reset.value, startState: { status: 'unavailable', step: 'policy', reason: 'The reviewed policy sets could not be adopted.' } });
    const startState = await START_BY_SCENARIO[scenario.scenarioId]({ identity: this.#identity, clock: this.#clock, brief: this.#brief,
      policy: this.#policy, repository: this.#repository, prepareEmployee: this.#prepareEmployee, faults: this.#faults, scenario, runId: reset.value.runId });
    return ok({ ...reset.value, startState });
  }
}
export const createScenarioService = (options) => new ScenarioService(options);
