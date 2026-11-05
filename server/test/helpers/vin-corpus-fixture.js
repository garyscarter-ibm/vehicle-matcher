import { readFile } from 'node:fs/promises';
import { allocateSyntheticIdentities, emptyAllocationInventory } from '../../gcsp/vehicle-evidence/vin-allocation.js';
import { VIN_GENERATOR_VERSION } from '../../gcsp/vehicle-evidence/vin-generator.js';
import { createPolicyService } from '../../gcsp/policy/index.js';

export const policyService = createPolicyService();
export const policyRead = { runId: 'publication-test', asOf: '2026-11-05T00:00:00.000Z', policyVersion: 'gcsp-policy-v1' };
export const options = { policyService, policyRead };
const { fixtures } = JSON.parse(await readFile(new URL('../fixtures/gcsp/vehicle-evidence/five-wmi-reference-configurations.json', import.meta.url)));

export async function corpusInput({ count = 1, version = '1', datasetId = 'bounded-reference', inventory, usage = 'current-car' } = {}) {
  const configurations = fixtures.slice(0, count).map((fixture, i) => {
    const modelCode = `REF${i + 1}`;
    const configurationId = Buffer.from(`${modelCode}:REFERENCE`).toString('base64');
    return { configurationId, snapshotVersion: 'reference-fixtures.v1',
      canonicalIdentity: { vgModelCode: modelCode, agModelCode: null, factoryOptionCodes: ['REFERENCE'],
        provenance: { kind: 'synthetic', source: 'Bounded publication contract fixture; REF codes are fictional, not BMW codes', observedDate: null } },
      configuration: structuredClone(fixture.configuration),
      sourceContext: { ...structuredClone(fixture.sourceContext), sourceKind: fixture.sourceKind,
        catalogueDate: null, selectedOptionCompleteness: 'unknown' },
      catalogue: null, imageIds: [] };
  });
  const plan = { runId: 'fixture-run', seed: 'fictional-publication-seed', corpusVersion: 'reference-corpus.v1',
    datasetId, vehicles: configurations.map((row, i) => ({ vehicleId: `reference-vehicle-${i + 1}`,
      configurationId: row.configurationId, snapshotVersion: row.snapshotVersion, configuration: row.configuration,
      usage, profileId: fixtures[i].profileId, referenceOnly: true })) };
  const allocated = await allocateSyntheticIdentities(inventory || emptyAllocationInventory(), plan,
    { expectedRevision: inventory?.revision || 0 });
  if (allocated.status !== 'ok') throw new Error(`fixture allocation: ${allocated.status}`);
  return { metadata: { datasetId, version, schemaVersion: '1', profileRegistryVersion: 'vin-profiles.v1',
    generatorVersion: VIN_GENERATOR_VERSION, seed: { value: plan.seed, kind: 'synthetic' },
    sourceContexts: [{ sourceKind: 'north-american-reference', observedDate: '2026-11-01', market: 'US', steering: 'LHD',
      catalogueDate: null, note: 'Small structural reference fixture; no UK/RHD, full equipment or 200/10000 corpus claim' }] },
    configurations, allocationInventory: allocated.inventory, images: [] };
}
