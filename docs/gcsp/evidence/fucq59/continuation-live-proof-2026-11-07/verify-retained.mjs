/** Strict offline requalification of both actual captures; never spends source allocations. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBmwSelectionBinding, createBmwSelectionRegistration, qualifyBmwSelectionRecord } from '../../../../../scripts/gcsp/bmw-selection-binding.mjs';
import { createConfigurationKey } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { PolicyService, FilePolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { createBmwCatalogueAdapter } from '../../../../../server/vehicle-evidence/bmw-catalogue-adapter.js';
const base = dirname(fileURLToPath(import.meta.url));
const read = async (path) => JSON.parse(await readFile(join(base, path), 'utf8'));
globalThis.fetch = () => { throw new Error('offline-verifier-network-forbidden'); };
const plan = await read('collection-plan.json'); const preparation = await read('preparation.json');
const a = (await read('phase-a/collector-checkpoint.json')).content;
const b = (await read('phase-b/collector-checkpoint.json')).content;
const key = await createConfigurationKey({ policyService: new PolicyService({ provider: new FilePolicyProvider() }),
  policyRead: { runId: 'f59-continuation-retained-verification', ...plan.policyRead } });
const artifact = (entry) => ({ bytes: JSON.stringify(entry.document) + '\n', artifactSha256: entry.sha256,
  retrievedAt: entry.retrievedAt || entry.document.observation.observedAt });
const qualified = []; const checks = [];
for (let index = 0; index < b.sourceCaptures.length; index++) {
  const capture = b.sourceCaptures[index]; const evidence = index === 0 ? a.batchEvidence : b.activeBatchEvidence;
  const registration = { plan, configurationKey: key, producerPins: preparation.batchBinding.producerPins,
    snapshotVersion: preparation.batchBinding.snapshotVersion, artifacts: { tree: artifact(evidence.tree), solver: artifact(capture.solver) },
    definitionBinding: { options: artifact(evidence.options) } };
  const result = buildBmwSelectionBinding(registration); assert.equal(result.status, 'qualified');
  assert.equal(qualifyBmwSelectionRecord(result.record, registration).status, 'qualified');
  const admission = b.accepted.find((row) => row.configurationId === result.record.configurationId);
  if (admission) assert.deepEqual({ ...admission, admission: false }, result.record);
  else assert(b.duplicates.some((row) => row.candidateId === capture.candidateId && row.configurationId === result.record.configurationId));
  const adapter = createBmwCatalogueAdapter({ sourceRegistrations: [createBmwSelectionRegistration(registration)],
    loadSnapshot: async () => JSON.stringify(result.record.catalogue) });
  const resolved = await adapter.resolve(result.record.catalogueRequest, Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion'].map((key) => [key, result.record.catalogue[key]])));
  assert.equal(resolved.status, 'partial'); assert.deepEqual(resolved.sourceBinding, result.record.catalogue.sourceBinding);
  assert.equal(resolved.equipment.selected.factoryComplete, true);
  qualified.push({ candidateId: capture.candidateId, ...result.record });
  checks.push({ candidateId: capture.candidateId, configurationId: result.record.configurationId, binder: 'qualified', adapter: resolved.status,
    factoryComplete: true, accessoryCodesComplete: resolved.equipment.selected.accessoryCodesComplete,
    accessoryQuantities: resolved.completeness.accessoryQuantities, verifiedFitted: resolved.equipment.verifiedFitted.state,
    selectedFactoryOptionCount: result.record.resolvedOptions.length, selectedAccessoryCount: result.record.selectedAccessories.length });
}
assert.equal(qualified.length, 2);
await writeFile(join(base, 'qualified-captures.jsonl'), qualified.map((row) => JSON.stringify(row)).join('\n') + '\n', { flag: 'wx' });
await writeFile(join(base, 'binding-verification.json'), JSON.stringify({ classification: 'scoped offline requalification of actual retained source observations', actualSourceRequests: 0, checks, acceptance: false }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ qualified: 2, adapterPartial: 2, actualSourceRequests: 0 }));
