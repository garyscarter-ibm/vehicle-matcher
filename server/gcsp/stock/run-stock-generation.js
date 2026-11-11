import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { result } from '../repository/index.js';
import { fileURLToPath } from 'node:url';
import { releaseLimits, DEFAULT_ARTIFACT_ROOT } from '../vehicle-evidence/fleet-release.js';
import { APPROVED_CORPUS_IMAGES } from '../vehicle-evidence/registered-corpus-images.js';
import { withDisplayImages } from '../vehicle-evidence/display-images.js';
import { withConfigurationDefinitions, selectedConfigurationDefinitionFacts } from '../vehicle-evidence/configuration-definitions.js';
import { vehicleEvidenceDetails } from '../vehicle-evidence/vehicle-details-contract.js';
import { createSyntheticRegistry } from '../vehicle-evidence/synthetic-registry.js';
import { buildRetainedCorpusPlan } from '../vehicle-evidence/stock-configuration-plan.js';
import { createStockGenerator } from '../vehicle-evidence/stock-generator.js';
import { canonicalAllocationContent, emptyAllocationInventory, readAllocationInventory } from '../vehicle-evidence/vin-allocation.js';
import { VISIBILITY, modelBrowseFacts } from './demo-provider.js';
import { createReleaseGuarantee } from './release-guarantee.js';

export const STOCK_ACCOUNT = 'gcsp-demo-scheme-stock';
export const STOCK_SEED = 'gcsp-demo-stock-v1';
export const ELIGIBILITY_KEYS = 'stock.eligibilityModelKeys.v1';
// The demo fleet corpus covers all seven scheme lines; the retained FUCQ-61 corpus covers only F70, G42 and G61.
export const STOCK_CORPUS_ROOT = fileURLToPath(new URL('../../data/gcsp/vehicle-evidence/demo-fleet.v1', import.meta.url));
const unavailable = (code) => result('unavailable', { code, reason: 'Generated stock is unavailable.', retryable: true });

/** Composes the FUCQ-78 generator for the demo: retained corpus registry and plan, loaded once and cached.
 * generate(run, { scenario, tranche }) is idempotent per run; any build failure is an unavailable outcome, never a throw. */
export function createDemoStockGeneration({ policy, repository, contextForRun, environmentId, env = process.env,
  corpusRoot = STOCK_CORPUS_ROOT } = {}) {
  const inventoryPath = env.GCSP_STOCK_INVENTORY_PATH || join(tmpdir(), 'gcsp-stock-inventory', `${environmentId}.json`);
  let registry; const plans = new Map();
  async function ensureInventory() {
    if (!isAbsolute(inventoryPath)) return false;
    try { await readFile(inventoryPath); } catch {
      await mkdir(dirname(inventoryPath), { recursive: true });
      await writeFile(inventoryPath, canonicalAllocationContent(emptyAllocationInventory()), { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      return true;
    }
    // A truncated or corrupt file is renamed aside, never deleted, so startup does not fall back to demo stock.
    if ((await readAllocationInventory(inventoryPath)).status === 'invalid-inventory') {
      await rename(inventoryPath, `${inventoryPath}.invalid-${Date.now()}`);
      await writeFile(inventoryPath, canonicalAllocationContent(emptyAllocationInventory()), { flag: 'wx' }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    }
    return true;
  }
  function loadRegistry() {
    registry ??= (async () => {
      const built = createSyntheticRegistry({ root: corpusRoot, policyService: policy, approvedImages: APPROVED_CORPUS_IMAGES,
        jsonlLimitsForManifest: releaseLimits, sourceArtifactRoot: DEFAULT_ARTIFACT_ROOT,
        policyRead: { runId: 'local-vehicle-evidence', asOf: new Date().toISOString() } });
      const loaded = await built.load();
      if (loaded.status !== 'ok') throw new Error('registry-unavailable');
      return withConfigurationDefinitions(withDisplayImages(built));
    })();
    registry.catch(() => { registry = undefined; });
    return registry;
  }
  function planFor(read) {
    if (!plans.has(read.policyVersion)) {
      const pending = buildRetainedCorpusPlan({ root: corpusRoot, policyService: policy, read })
        .then((built) => { if (built.status !== 'ok') throw new Error('plan-unavailable'); return built.value.plan; });
      pending.catch(() => plans.delete(read.policyVersion));
      plans.set(read.policyVersion, pending);
    }
    return plans.get(read.policyVersion);
  }
  return Object.freeze({
    async generate(run, input = {}) {
      try {
        if (!(await ensureInventory())) return unavailable('inventory-path-invalid');
        const read = { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion };
        const [loaded, plan, keys] = await Promise.all([loadRegistry(), planFor(read), policy.getAssumption(ELIGIBILITY_KEYS, read)]);
        const mapping = keys.status === 'ok' && keys.value?.key === ELIGIBILITY_KEYS ? keys.value.value : null;
        if (!mapping || typeof mapping !== 'object') return unavailable('eligibility-keys-unavailable');
        // Exact source evidence is retained even for an unmapped, ineligible model.
        const factsForConfiguration = (_binding, record, source) => {
          const key = mapping[record?.configuration?.agModelCode];
          const details = vehicleEvidenceDetails({ kind: 'configuration', id: record.configurationId }, source);
          // The stock pull port excludes VIN fields; a configuration has no VIN association.
          delete details.identity.vin;
          const provenance = { sourceRef: JSON.stringify(record.sourceContext.sourceRefs),
            observedAt: `${record.sourceContext.observedDate}T00:00:00.000Z`, version: record.snapshotVersion, assurance: 'model-reference' };
          const known = (value) => ({ status: 'known', value, unit: null, provenance });
          return { ...(typeof key === 'string' ? { eligibilityModelKey: { value: key, unit: null }, ...modelBrowseFacts(key) } : {}),
            ...selectedConfigurationDefinitionFacts(details), configurationEvidence: known(details),
            gearbox: details.description.powertrain.transmission.state === 'known'
              ? known(details.description.powertrain.transmission.value)
              : { status: 'unknown', value: null, unit: null, provenance: { ...provenance, assurance: 'unknown' } } };
        };
        const wanted = input.tranche?.guarantee;
        const checked = wanted ? await createReleaseGuarantee({ policy, read, scenario: input.scenario, guarantee: wanted }) : null;
        if (wanted && !checked) return unavailable('release-guarantee-unavailable');
        const generator = createStockGenerator({ repository, registry: loaded, policyService: policy, contextForRun, configurationPlan: plan,
          stockAccount: STOCK_ACCOUNT, allocationInventoryPath: inventoryPath, visibility: VISIBILITY, factsForConfiguration,
          ...(checked ? { guarantee: { ...wanted, qualifies: checked.qualifies } } : {}) });
        return await generator.generateStock(run.runId, STOCK_SEED, run.policyVersion);
      } catch { return unavailable('stock-generation-unavailable'); }
    },
  });
}
