import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputDigest } from '../../server/gcsp/repository/index.js';
import { createSyntheticRegistry } from '../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { DEFAULT_ARTIFACT_ROOT, releaseLimits } from '../../server/gcsp/vehicle-evidence/fleet-release.js';
import { APPROVED_CORPUS_IMAGES } from '../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { readRetainedCorpus } from '../../server/gcsp/vehicle-evidence/stock-configuration-plan.js';
import { LearningInputError } from '../../server/gcsp/predict/records/index.js';
import { ENRICHMENT_DIR, ENRICHMENT_SCHEMA, readEnrichmentEvidence, scoreEnrichment } from './demo-verifier.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEMO_FLEET_STORE = 'server/data/gcsp/vehicle-evidence/demo-fleet.v1';
const SET_KEY = 'comparison.configurationSet.v1';
const MIX_KEY = 'comparison.modelLineMix';
const BRIDGE_KEY = 'stock.eligibilityModelKeys.v1';
const SOURCE = 'server/data/gcsp/vehicle-evidence/demo-fleet.v1 with demo-enrichment.v1';
// Sidecar facts that map to configuration features, with the unit and definition each must carry.
const FACTS = Object.freeze([['seats', 'seats', 'COUNT', 'SEATS'], ['luggageNormal', 'boot', 'LITRES', 'NORMAL'],
  ['acceleration', 'zeroTo62', 'SECONDS', '0–100 KM/H']]);

const refuse = (code, field) => { throw new LearningInputError(code, field); };
const need = (condition, field, code = 'corpus-unavailable') => { if (!condition) refuse(code, field); };

function enrich(configuration, entry) {
  const mapped = {};
  for (const [name, feature, unit, definition] of FACTS) {
    const fact = entry?.facts?.[name];
    if (fact?.state === 'known' && fact.unit === unit && fact.definition === definition && Number.isFinite(fact.value)) mapped[feature] = fact.value;
  }
  return { ...configuration, ...mapped };
}

// Real demo builds through the existing registry adapter; the sidecar only adds facts, and unknown ones stay absent.
async function openRegistry({ root, policyService, policyRead }) {
  const registry = createSyntheticRegistry({ root, policyService, approvedImages: APPROVED_CORPUS_IMAGES,
    jsonlLimitsForManifest: releaseLimits, sourceArtifactRoot: DEFAULT_ARTIFACT_ROOT, policyRead });
  let loaded;
  try { loaded = await registry.load(); } catch { refuse('corpus-unavailable', 'corpus-store'); }
  need(loaded?.status === 'ok' && loaded.recovered === false && registry.status().active, 'corpus-store');
  return registry;
}

async function bridge(policyService, policyRead) {
  const row = await policyService.getAssumption(BRIDGE_KEY, policyRead);
  need(row?.status === 'ok' && row.value?.value && typeof row.value.value === 'object', BRIDGE_KEY, 'policy-unavailable');
  return row.value.value;
}

export async function bindDemoFleet({ policyService, policyRead, repoRoot = REPO_ROOT } = {}) {
  need(typeof policyService?.getAssumption === 'function' && policyRead && typeof policyRead === 'object', 'policyService', 'policy-unavailable');
  const root = resolve(repoRoot, DEMO_FLEET_STORE);
  const registry = await openRegistry({ root, policyService, policyRead });
  const active = registry.status().active;
  let retained;
  try { retained = await readRetainedCorpus(root); } catch { refuse('corpus-unavailable', 'corpus-store'); }
  need(retained.manifestDigest === active.manifestDigest && retained.datasetId === active.datasetId
    && retained.corpusVersion === active.version && retained.rows.length === active.counts.configurations, 'corpus-store');
  const evidence = await readEnrichmentEvidence(repoRoot);
  const scored = scoreEnrichment(evidence, retained.rows, retained.manifestDigest);
  need(scored.summary.valid === true && evidence.manifest.schemaVersion === ENRICHMENT_SCHEMA, ENRICHMENT_DIR);
  const keys = await bridge(policyService, policyRead);
  const references = []; const records = new Map();
  for (const { configurationId } of retained.rows) {
    const found = registry.getConfiguration(configurationId);
    need(['ok', 'complete', 'partial'].includes(found.status) && found.record?.configurationId === configurationId, 'corpus-store');
    const modelLine = keys[found.record.canonicalIdentity?.agModelCode];
    need(typeof modelLine === 'string' && modelLine.length > 0, BRIDGE_KEY, 'configuration-unavailable');
    references.push({ modelLine, configurationId, snapshotVersion: found.record.snapshotVersion });
  }
  references.sort((a, b) => (a.configurationId < b.configurationId ? -1 : 1));
  const counts = {};
  for (const { modelLine } of references) counts[modelLine] = (counts[modelLine] ?? 0) + 1;
  const observedOn = evidence.manifest.observedDates?.last;
  const enrichment = { schemaVersion: ENRICHMENT_SCHEMA, demoManifestDigest: evidence.manifest.demoManifestDigest,
    checksum: evidence.manifest.checksums['enrichment.jsonl'], manifestDigest: inputDigest(evidence.manifest) };
  const corpus = { enrichment, getConfiguration(id) {
    const found = registry.getConfiguration(id);
    if (!found.record) return found;
    if (!records.has(id)) records.set(id, enrich(found.record.configuration, scored.entries.get(id)));
    return { ...found, record: { ...found.record, configuration: structuredClone(records.get(id)) } };
  } };
  // The set and mix are derived from the published corpus, since seed-v1 holds only the reviewed fixtures.
  const rows = {
    [SET_KEY]: { value: { kind: 'corpus', datasetId: active.datasetId, version: active.version, manifestDigest: active.manifestDigest,
      basis: 'Every published FUCQ-77 demo build, bound by id, snapshot version and manifest digest; model line from stock.eligibilityModelKeys.v1.',
      reviewedOn: observedOn, configurations: references }, basis: 'Derived from the published demo-fleet.v1 corpus, not hand-written.' },
    [MIX_KEY]: { value: Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)).map(([modelLine, weight]) => ({ modelLine, weight })),
      basis: 'Weights are the number of published real builds per model line; no real stock proportions are claimed.' },
  };
  const overlay = Object.create(policyService);
  for (const name of ['getActiveVersion', 'getAllowance', 'getEligibility', 'getPointsCost']) overlay[name] = (...args) => policyService[name](...args);
  overlay.getAssumption = async (key, ...args) => {
    const base = await policyService.getAssumption(key, ...args);
    if (!rows[key] || base?.status !== 'ok') return base;
    return { ...base, value: { ...base.value, ...rows[key], source: SOURCE, sourceDate: observedOn, status: 'assumed' } };
  };
  return { policyService: overlay, corpus, enrichment, configurations: references.length, modelLines: Object.keys(counts).length };
}
