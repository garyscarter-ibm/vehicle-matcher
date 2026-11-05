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

export async function sourceBackedInput() {
  const snapshot = JSON.parse(await readFile(new URL('../../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url)));
  const { createBmwCatalogueAdapter } = await import('../../vehicle-evidence/bmw-catalogue-adapter.js');
  const m = snapshot.model;
  const request = { catalogueDate: snapshot.observedDate, market: snapshot.market, locale: snapshot.locale,
    modelCode: m.modelCode, modelRange: m.modelRange, rawModelRange: m.rawModelRange, agModelCode: m.agModelCode,
    trim: snapshot.trim, orderDate: m.orderDate, effectDate: m.effectDate, productionDate: '2027-01-05', taxDate: m.taxDate,
    selectedOptions: snapshot.selectedOptions, selectedAccessories: snapshot.selectedAccessories, selectionComplete: true };
  const catalogue = await createBmwCatalogueAdapter().resolve(request);
  const input = await corpusInput();
  const configuration = Object.fromEntries(Object.keys(input.configurations[0].configuration).map((key) => [key, null]));
  Object.assign(configuration, { market: snapshot.market, agModelCode: m.agModelCode, vgModelCode: m.modelCode, generation: m.rawModelRange });
  const configurationId = Buffer.from(`${m.modelCode}:${[...snapshot.selectedOptions].sort().join(',')}`).toString('base64');
  return { ...input, metadata: { ...input.metadata, datasetId: 'dated-catalogue',
    sourceContexts: [{ sourceKind: 'dated-snapshot', observedDate: snapshot.observedDate, catalogueDate: snapshot.observedDate,
      market: snapshot.market, steering: null, note: 'Exact retained FUCQ-39 GB catalogue; physical year, build, steering and plant remain unknown' }] },
  configurations: [{ configurationId, snapshotVersion: snapshot.snapshotVersion, configuration,
    canonicalIdentity: { vgModelCode: m.modelCode, agModelCode: m.agModelCode, factoryOptionCodes: snapshot.selectedOptions,
      provenance: { kind: 'observed', source: 'BMW UK catalogue', observedDate: snapshot.observedDate } },
    catalogue, sourceContext: { sourceRefs: snapshot.sources, observedDate: snapshot.observedDate, catalogueDate: snapshot.observedDate,
      sourceKind: 'dated-snapshot', confidence: 'Exact dated catalogue observation; not a physical build',
      unresolvedFacts: Object.keys(configuration).filter((key) => configuration[key] === null), selectedOptionCompleteness: catalogue.completeness.selectedConfiguration }, imageIds: [] }],
  allocationInventory: emptyAllocationInventory() };
}
