import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { result } from '../repository/index.js';
import { DEFAULT_VEHICLE_CORPUS_ROOT } from '../vehicle-evidence/local-vehicle-lookup.js';
import { releaseLimits, DEFAULT_ARTIFACT_ROOT } from '../vehicle-evidence/fleet-release.js';
import { APPROVED_CORPUS_IMAGES } from '../vehicle-evidence/registered-corpus-images.js';
import { createSyntheticRegistry } from '../vehicle-evidence/synthetic-registry.js';
import { buildRetainedCorpusPlan } from '../vehicle-evidence/stock-configuration-plan.js';
import { createStockGenerator } from '../vehicle-evidence/stock-generator.js';
import { canonicalAllocationContent, emptyAllocationInventory } from '../vehicle-evidence/vin-allocation.js';
import { VISIBILITY, modelBrowseFacts } from './demo-provider.js';

export const STOCK_ACCOUNT = 'gcsp-demo-scheme-stock';
export const STOCK_SEED = 'gcsp-demo-stock-v1';
export const ELIGIBILITY_KEYS = 'stock.eligibilityModelKeys.v1';
const unavailable = (code) => result('unavailable', { code, reason: 'Generated stock is unavailable.', retryable: true });

/** Composes the FUCQ-78 generator for the demo: retained corpus registry and plan, loaded once and cached.
 * generate(run) is idempotent per run; any build failure is an unavailable outcome, never a throw. */
export function createDemoStockGeneration({ policy, repository, contextForRun, environmentId, env = process.env,
  corpusRoot = DEFAULT_VEHICLE_CORPUS_ROOT } = {}) {
  const inventoryPath = env.GCSP_STOCK_INVENTORY_PATH || join(tmpdir(), 'gcsp-stock-inventory', `${environmentId}.json`);
  let registry; const plans = new Map();
  async function ensureInventory() {
    if (!isAbsolute(inventoryPath)) return false;
    try { await readFile(inventoryPath); } catch {
      await mkdir(dirname(inventoryPath), { recursive: true });
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
      return built;
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
    async generate(run) {
      try {
        if (!(await ensureInventory())) return unavailable('inventory-path-invalid');
        const read = { runId: run.runId, asOf: run.clockInstant, policyVersion: run.policyVersion };
        const [loaded, plan, keys] = await Promise.all([loadRegistry(), planFor(read), policy.getAssumption(ELIGIBILITY_KEYS, read)]);
        const mapping = keys.status === 'ok' && keys.value?.key === ELIGIBILITY_KEYS ? keys.value.value : null;
        if (!mapping || typeof mapping !== 'object') return unavailable('eligibility-keys-unavailable');
        // Unmapped cars get no extra facts: they release but are not eligible.
        const factsForConfiguration = (_binding, record) => {
          const key = mapping[record?.configuration?.agModelCode];
          return typeof key === 'string' ? { eligibilityModelKey: { value: key, unit: null }, ...modelBrowseFacts(key) } : {};
        };
        const generator = createStockGenerator({ repository, registry: loaded, policyService: policy, contextForRun, configurationPlan: plan,
          stockAccount: STOCK_ACCOUNT, allocationInventoryPath: inventoryPath, visibility: VISIBILITY, factsForConfiguration });
        return await generator.generateStock(run.runId, STOCK_SEED, run.policyVersion);
      } catch { return unavailable('stock-generation-unavailable'); }
    },
  });
}
