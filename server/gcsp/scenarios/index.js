import { DemoClock } from '../clock/index.js';
import { DemoIdentityAdapter } from '../identity/index.js';
import { PolicyService } from '../policy/index.js';
import { loadScenarioCatalogue, prepareScenarioFixture } from '../fixtures/scenarios/index.js';
import { ok, result } from '../repository/core.js';

const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 128;
const invalid = () => result('invalid', { code: 'invalid-scenario-command', reasons: [{ field: 'reset', reason: 'Supply scenario, fixture and policy versions with the current run/version and commandId.' }] });
const unavailable = () => result('unavailable', { reason: 'The named scenario service has not been configured with the GCSP runtime.', retryable: false });
const staleVersion = (field, expectedVersion, currentVersion) => result('stale-version', {
  expectedVersion, currentVersion, resource: { table: 'scenario-catalogue', field }, action: 'refresh',
});
export class ScenarioService {
  #repository; #policy; #clock; #identity;
  constructor({ repository, policy, clock, identity } = {}) {
    this.#repository = repository; this.#policy = policy; this.#clock = clock; this.#identity = identity;
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
    return this.#clock.reset(context, { commandId: `scenario:${input.commandId}`, expectedRunId: input.expectedRunId,
      expectedRunVersion: input.expectedRunVersion, scenarioVersion: input.scenarioVersion, fixtureVersion: input.fixtureVersion }, fixture.value);
  }
}
export const createScenarioService = (options) => new ScenarioService(options);
