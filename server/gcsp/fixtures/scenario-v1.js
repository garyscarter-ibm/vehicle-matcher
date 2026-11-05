import { loadDemoPrincipalSeed } from './principals.js';
import { emptyAllocationInventory, allocateSyntheticIdentities } from '../vehicle-evidence/vin-allocation.js';
import { ok, result } from '../repository/core.js';
import { validInstant } from '../policy/file-provider.js';

const unavailable = () => result('unavailable', { reason: 'The versioned scenario fixture is unavailable.', retryable: false });
export async function loadClockConfiguration(policy, read) {
  const entries = await Promise.all(['clock.scenario.v1', 'clock.commands.v1', 'clock.handler.order.v1'].map((key) => policy.getAssumption(key, read)));
  if (entries.some((row) => row.status !== 'ok' || row.policyVersion !== read.policyVersion)) return unavailable();
  const [scenario, commands, stages] = entries.map((row) => row.value.value);
  if (!scenario || !validInstant(scenario.startsAt) || !scenario.namedTimes || !Object.values(scenario.namedTimes).every(validInstant)
    || !['scenarioVersion', 'fixtureVersion', 'seed', 'corpusVersion', 'datasetId'].every((key) => typeof scenario[key] === 'string' && scenario[key])
    || !Array.isArray(scenario.vehicles) || !scenario.vehicles.length || scenario.vehicles.some((row) => row.usage !== 'stock')
    || commands?.advanceAndTickSeparate !== true || commands.forwardOnly !== true || commands.resetProvider !== 'synthetic-only'
    || !/^[1-9][0-9]*$/.test(commands.initialClockVersion) || !Array.isArray(commands.startupStages)
    || !Array.isArray(stages) || new Set(stages).size !== stages.length || !stages.length || stages.some((stage) => typeof stage !== 'string' || !stage)
    || commands.startupStages.some((stage) => !stages.includes(stage))) return unavailable();
  return ok({ scenario, commands, stages });
}

export async function buildScenarioSeed({ policy, read, configuration, runId, inventory }) {
  const people = await loadDemoPrincipalSeed(policy, read);
  if (people.status !== 'ok') return people;
  const { scenario } = configuration;
  const prior = inventory ?? emptyAllocationInventory(scenario.allocationLimits);
  const allocated = await allocateSyntheticIdentities(prior, { runId, seed: scenario.seed, corpusVersion: scenario.corpusVersion,
    datasetId: scenario.datasetId, vehicles: scenario.vehicles }, { expectedRevision: prior.revision });
  if (allocated.status !== 'ok') return unavailable();
  const rows = [];
  for (const principal of people.value.principals) {
    rows.push(['employees', principal]);
    if (principal.roles.includes('employee')) rows.push(['entitlement_slots', { employeeId: principal.employeeId,
      entitlementSlotId: principal.entitlementSlotId, capacity: people.value.capacity, employeeCapacity: people.value.capacity }]);
  }
  for (const row of allocated.inventory.records.filter((entry) => entry.runId === runId)) {
    rows.push(['stock', { orderUuid: row.orderUuid, orderNumber: row.orderNumber, wholesalerOrderId: row.wholesalerOrderId,
      configurationId: row.configurationId, corpusVersion: row.corpusVersion, revision: 1, state: 'unreleased', available: false,
      facts: { syntheticIdentity: { vehicleId: row.vehicleId, identityKind: 'synthetic', generatorVersion: row.generatorVersion,
        originatingDatasetId: row.originatingDatasetId, configurationHash: row.configurationHash, snapshotVersion: row.snapshotVersion } } }]);
  }
  return ok({ rows, versions: { scenario: scenario.scenarioVersion, fixture: scenario.fixtureVersion, corpus: scenario.corpusVersion,
    policy: read.policyVersion, syntheticIdentityInventory: { revision: allocated.inventory.revision, contentDigest: allocated.inventory.contentDigest,
      snapshot: allocated.inventory } } });
}
