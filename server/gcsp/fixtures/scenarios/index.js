import { loadClockConfiguration } from '../scenario-v1.js';
import { loadDemoPrincipals } from '../principals.js';
import { inputDigest, ok, result } from '../../repository/core.js';
import { PolicyService } from '../../policy/index.js';
import { SCENARIO_INPUTS_V1, MECHANICS_SCENARIO } from './catalogue-v1.js';

const prepared = new WeakMap();
const freeze = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const definitions = freeze(structuredClone([...SCENARIO_INPUTS_V1, MECHANICS_SCENARIO]));
export const scenarioDefinitions = () => structuredClone(definitions);
export const isPreparedScenarioFixture = (value, policy) => prepared.has(value) && prepared.get(value) === policy;
// A journey is available only when scenarios/ holds a reviewed start loader that applies its inputs through actual services.
const START_LOADERS = new Set(['main-successful-journey', 'decline-then-change', 'no-suitable-match']);
export const hasScenarioStartLoader = (scenarioId) => START_LOADERS.has(scenarioId);
export const missingScenarioCapabilities = (definition) => definition.kind === 'mechanics' || START_LOADERS.has(definition.scenarioId)
  ? [] : [...definition.requiredCapabilities];
const unavailable = () => result('unavailable', { reason: 'The scenario policy or canonical principals are unavailable.', retryable: false });

export async function loadScenarioCatalogue({ policy, read }) {
  if (!(policy instanceof PolicyService)) return unavailable();
  const [configuration, people] = await Promise.all([loadClockConfiguration(policy, read), loadDemoPrincipals(policy, read)]);
  if (configuration.status !== 'ok') return configuration;
  if (people.status !== 'ok' || people.policyVersion !== read.policyVersion) return unavailable();
  const entries = [];
  for (const definition of definitions) {
    const principals = definition.principalIds.map((id) => people.value.find((person) => person.principalId === id));
    if (principals.some((person) => !person)) return unavailable();
    const mechanics = definition.kind === 'mechanics';
    const missingCapabilities = missingScenarioCapabilities(definition);
    entries.push({ ...structuredClone(definition),
      scenarioVersion: mechanics ? configuration.value.scenario.scenarioVersion : definition.scenarioVersion,
      fixtureVersion: mechanics ? configuration.value.scenario.fixtureVersion : definition.fixtureVersion,
      policyVersion: read.policyVersion, clockStart: configuration.value.scenario.startsAt,
      namedTimes: structuredClone(configuration.value.scenario.namedTimes),
      principals: principals.map(({ principalId, employeeId, roles, name }) => ({ principalId, employeeId, roles, name })),
      availability: { available: missingCapabilities.length === 0, outcome: missingCapabilities.length ? 'not available yet' : 'available', missingCapabilities },
      inputProvenance: mechanics ? 'fictional-clock-mechanics-only' : missingCapabilities.length
        ? 'versioned-fictional-journey-inputs; required domain services unavailable'
        : 'versioned-fictional-journey-inputs; applied through actual services after reset',
    });
  }
  return ok({ catalogueVersion: 'gcsp-scenario-catalogue-v1', policyVersion: read.policyVersion, scenarios: entries });
}

// Only concrete, reviewed loaders in this module can create a prepared selection. A caller's
// function, capability flag or fixture label is never evidence that a business capability exists.
// Journey owning stories add their actual service preparation here before enabling their entry.
// Preparation is read-only; the complete resulting input set still commits through FUCQ-85.
export async function prepareScenarioFixture({ scenarioId, policy, read }) {
  const catalogue = await loadScenarioCatalogue({ policy, read });
  if (catalogue.status !== 'ok') return catalogue;
  const scenario = catalogue.value.scenarios.find((entry) => entry.scenarioId === scenarioId);
  if (!scenario) return result('not-found', { resourceType: 'scenario' });
  if (!scenario.availability.available) return result('unavailable', {
    code: 'scenario-not-available-yet', reason: 'not available yet', retryable: false, scenarioId,
    missingCapabilities: scenario.availability.missingCapabilities,
  });
  const configuration = await loadClockConfiguration(policy, read);
  if (configuration.status !== 'ok') return configuration;
  const fixture = freeze({ scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: read.policyVersion,
    sourceVersion: catalogue.value.catalogueVersion, preparedForRunId: read.runId, configuration: configuration.value,
    // These are start inputs; the allocator/PolicyService/repository compute identities/state.
    inputDigest: inputDigest({ inputs: scenario.inputs, configuration: configuration.value }),
  });
  prepared.set(fixture, policy);
  return ok(fixture);
}
