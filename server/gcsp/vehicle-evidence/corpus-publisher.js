import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { bmwCatalogueLookupIdentity, createBmwCatalogueAdapter } from '../../vehicle-evidence/bmw-catalogue-adapter.js';
import { registeredCatalogueSources } from './registered-catalogue-sources.js';
import { inputDigest } from '../repository/core.js';
import { indexJsonl, JsonlError, JSONL_MAX_BYTES } from './indexed-jsonl.js';
import { createVinProfileRegistry, VIN_PROFILE_REGISTRY_VERSION } from './vin-profiles.js';
import { generateVin, VIN_GENERATOR_VERSION } from './vin-generator.js';

export const CORPUS_SCHEMA_VERSION = '1';
export const CORPUS_FILES = Object.freeze(['configurations.jsonl', 'vins.jsonl', 'images.jsonl']);
const MAX_BYTES = 64 * 1024 * 1024;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\u0000-\u001f]/.test(v);
const version = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]{0,95}$/.test(v);
const date = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const keys = (v, allowed) => object(v) && Object.keys(v).every((key) => allowed.includes(key));
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, sorted(v[key])])) : v;
export const canonicalContent = (v) => JSON.stringify(sorted(v)) + '\n';
export const contentChecksum = (v) => createHash('sha256').update(v).digest('hex');
const equal = (a, b) => canonicalContent(a) === canonicalContent(b);
export function freezeCorpus(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeCorpus); Object.freeze(value); }
  return value;
}
class CorpusError extends Error {
  constructor(code, detail) { super(detail); this.code = code; }
}
const reject = (code, detail) => { throw new CorpusError(code, detail); };
export const corpusFailure = (error) => ({ status: 'invalid-corpus', failure: {
  code: (error instanceof CorpusError || error instanceof JsonlError) ? error.code : 'artifact-unavailable',
  message: (error instanceof CorpusError || error instanceof JsonlError) ? error.message : 'Read the complete candidate from an accessible explicit directory; no version was selected.',
} });
const requireValue = (condition, code, detail) => { if (!condition) reject(code, detail); };
const identityFields = ['vehicleId', 'configurationId', 'snapshotVersion', 'configurationHash', 'corpusVersion',
  'generatorVersion', 'identityKind', 'usage', 'vin17', 'vin7', 'serial', 'profile', 'sourceKind', 'sources',
  'confidence', 'unknownFields', 'completeVinDecoded', 'modelYear', 'productionEra', 'productionDate',
  'registrationDate', 'vinAllocationOrigin', 'originatingDatasetId'];
const configFields = ['configurationId', 'snapshotVersion', 'canonicalIdentity', 'canonicalSignature', 'configuration',
  'sourceContext', 'catalogue', 'imageIds'];
const sourceFields = ['sourceRefs', 'observedDate', 'confidence', 'unresolvedFacts', 'sourceKind', 'catalogueDate', 'selectedOptionCompleteness'];
const bindingFields = ['model', 'derivative', 'generation', 'body', 'powertrain', 'drive', 'transmission', 'engineCode',
  'agModelCode', 'vgModelCode', 'market', 'region', 'steering', 'modelYear', 'productionEra', 'productionDate', 'plant'];
const SIGNATURE_KEYS = ['stock.configuration.modelCodeField', 'stock.configuration.codeSeparator',
  'stock.configuration.includePaintAndUpholstery', 'stock.configuration.encoding'];
async function signaturePolicy({ policyService, policyRead }, pin) {
  requireValue(policyService?.getAssumption && object(policyRead), 'signature-policy-unavailable', 'Inject canonical PolicyService and an explicit dated policy read.');
  const read = { ...policyRead, ...(pin ? { policyVersion: pin } : {}) };
  const rows = await Promise.all(SIGNATURE_KEYS.map((key) => policyService.getAssumption(key, read)));
  requireValue(rows.every((r) => r.status === 'ok') && new Set(rows.map((r) => r.policyVersion)).size === 1,
    'signature-policy-unavailable', 'The retained signature policy could not be resolved coherently; do not regenerate configuration IDs.');
  const values = Object.fromEntries(rows.map((r, i) => [SIGNATURE_KEYS[i], r.value.value]));
  requireValue(['vgModelCode', 'agModelCode'].includes(values[SIGNATURE_KEYS[0]])
    && text(values[SIGNATURE_KEYS[1]]) && values[SIGNATURE_KEYS[1]].length === 1
    && values[SIGNATURE_KEYS[2]] === true && values[SIGNATURE_KEYS[3]] === 'base64-padded',
  'unsupported-signature-policy', 'This code supports a named model-code field, one separator, all factory codes and padded Base64. Publish no IDs under an unsupported rule.');
  return { policyVersion: rows[0].policyVersion, assumptions: Object.fromEntries(rows.map((r, i) => [SIGNATURE_KEYS[i], r.value])) };
}
function configurationKey(identity, policy) {
  requireValue(keys(identity, ['vgModelCode', 'agModelCode', 'factoryOptionCodes', 'provenance']), 'configuration-signature', 'Supply a separate explicit canonical model/code identity.');
  const field = policy.assumptions[SIGNATURE_KEYS[0]].value;
  const model = identity[field]; const codes = identity.factoryOptionCodes;
  requireValue(typeof model === 'string' && /^[A-Z0-9]{2,16}$/.test(model) && Array.isArray(codes)
    && codes.length > 0 && codes.length <= 256 && codes.every((v) => typeof v === 'string' && /^[A-Z0-9]{2,16}$/.test(v))
    && new Set(codes).size === codes.length, 'configuration-signature', 'Canonical identity needs an explicit upper-case model code and every unique factory code; unknown source codes cannot be invented as observed.');
  const signature = `${model}:${[...codes].sort().join(policy.assumptions[SIGNATURE_KEYS[1]].value)}`;
  return { configurationId: Buffer.from(signature).toString('base64'), decodedIdentity: signature, signaturePolicyVersion: policy.policyVersion };
}
function configurationSignature(row, policy) {
  const identity = configurationKey(row.canonicalIdentity, policy);
  requireValue(row.configurationId === identity.configurationId, 'configuration-signature', 'configurationId must match the canonical model and sorted complete identity codes.');
  return identity.decodedIdentity;
}
function validProvenance(p) {
  return keys(p, ['kind', 'source', 'observedDate']) && ['observed', 'synthetic'].includes(p.kind) && text(p.source)
    && (p.kind === 'observed' ? date(p.observedDate) : p.observedDate === null);
}
async function validateConfiguration(row, policy, catalogueAdapter) {
  requireValue(keys(row, configFields) && text(row.configurationId) && version(row.snapshotVersion)
    && object(row.configuration) && keys(row.configuration, bindingFields)
    && Array.isArray(row.imageIds) && row.imageIds.every(text) && new Set(row.imageIds).size === row.imageIds.length,
  'configuration-schema', 'Configurations contain immutable description fields only, with snapshot version and explicit image references.');
  const signature = configurationSignature(row, policy);
  requireValue(row.canonicalSignature === signature && validProvenance(row.canonicalIdentity.provenance),
    'configuration-signature', 'The declared canonical signature/provenance does not match configurationId.');
  const source = row.sourceContext; const config = row.configuration;
  requireValue(keys(source, sourceFields) && Array.isArray(source.sourceRefs) && source.sourceRefs.length > 0
    && source.sourceRefs.every(text) && new Set(source.sourceRefs).size === source.sourceRefs.length
    && date(source.observedDate) && (source.catalogueDate === null || date(source.catalogueDate))
    && ['dated-snapshot', 'north-american-reference'].includes(source.sourceKind)
    && text(source.confidence) && Array.isArray(source.unresolvedFacts) && source.unresolvedFacts.every(text)
    && ['complete', 'partial', 'unknown'].includes(source.selectedOptionCompleteness)
    && bindingFields.every((key) => Object.hasOwn(config, key))
    && bindingFields.filter((key) => !['modelYear', 'productionDate'].includes(key)).every((key) => config[key] === null || text(config[key]))
    && /^[A-Z]{2}$/.test(config.market)
    && bindingFields.filter((key) => config[key] === null).every((key) => source.unresolvedFacts.includes(key))
    && (config.modelYear === null || Number.isSafeInteger(config.modelYear)) && (config.productionDate === null || date(config.productionDate)),
  'configuration-provenance', 'Keep source references, dates, market, steering, equipment completeness and explicit unknowns; VIN spelling supplies none of these facts.');
  for (const field of ['agModelCode', 'vgModelCode']) {
    if (config[field] !== null) requireValue(row.canonicalIdentity[field] === config[field], 'configuration-signature', 'A known source model code cannot be replaced by an identity alias.');
  }
  if (source.sourceKind === 'north-american-reference') {
    requireValue(config.market === 'US' && config.steering === 'LHD' && source.selectedOptionCompleteness === 'unknown'
      && row.canonicalIdentity.provenance.kind === 'synthetic' && row.catalogue === null,
    'configuration-provenance', 'Partial North American structural references do not establish full selections, UK/RHD profiles or real canonical option codes.');
  } else if (row.catalogue?.schemaVersion === '2') {
    const c = row.catalogue; const binding = c.sourceBinding;
    const options = Object.fromEntries(['provider', 'providerVersion', 'schemaVersion', 'sourceContractVersion', 'snapshotVersion']
      .map((name) => [name, c[name]]));
    const qualified = await catalogueAdapter.resolve({ configurationId: row.configurationId, bindingDigest: c.lookupIdentity?.bindingDigest }, options);
    requireValue(['ok', 'partial'].includes(qualified.status) && equal(qualified, c),
      'unregistered-source', 'A v2 row must match an independently registered admitted source envelope exactly.');
    const expected = Object.fromEntries(bindingFields.map((field) => [field, null]));
    Object.assign(expected, { model: binding.optionalFacts.modelName.value, generation: binding.confirmedContext.rawModelRange.value,
      agModelCode: binding.canonicalIdentity.agModelCode, vgModelCode: binding.canonicalIdentity.vgModelCode,
      market: binding.requestScope.market });
    requireValue(equal(config, expected) && equal(row.canonicalIdentity, { ...binding.canonicalIdentity, provenance: c.identityProvenance })
      && row.snapshotVersion === c.snapshotVersion && source.observedDate === c.observedDate
      && source.catalogueDate === c.observedDate && source.selectedOptionCompleteness === c.completeness.factorySelection
      && c.completeness.factorySelection === 'complete' && c.equipment.selected.factoryComplete === true
      && equal(source.sourceRefs, [...new Set(binding.evidence.map((e) => e.request.url))].sort())
      && row.canonicalIdentity.provenance.kind === 'observed'
      && binding.evidence.every((e) => e.sourceId === 'bmw-uk-public'),
    'configuration-provenance', 'Retain exact complete factory selection and source context; physical build, technical and accessory quantity unknowns do not become observed facts.');
  } else {
    const c = row.catalogue;
    const lookup = c?.resolvedIdentity ? bmwCatalogueLookupIdentity({ ...c.resolvedIdentity, selectionComplete: true },
      { snapshotVersion: row.snapshotVersion }) : null;
    requireValue(object(c) && ['ok', 'partial'].includes(c.status) && c.schemaVersion === '1'
      && c.provider === 'bmw-catalogue-snapshot' && c.providerVersion === '1' && c.sourceKind === 'dated-snapshot'
      && c.snapshotVersion === row.snapshotVersion && c.observedDate === source.observedDate
      && date(c.retrievedDate) && object(c.requestedIdentity) && equal(c.requestedIdentity, c.resolvedIdentity)
      && lookup && equal(lookup, c.lookupIdentity) && equal(c.lookupIdentity, c.resolvedLookupIdentity)
      && row.canonicalIdentity.provenance.kind === 'observed' && validProvenance(c.identityProvenance)
      && equal(c.catalogueValidity, Object.fromEntries(['orderDate', 'effectDate', 'productionDate', 'taxDate'].map((key) => [key, c.resolvedIdentity[key]])))
      && c.resolvedIdentity.market === config.market && c.resolvedIdentity.catalogueDate === source.catalogueDate
      && c.resolvedIdentity.modelCode === config.vgModelCode && c.resolvedIdentity.agModelCode === config.agModelCode
      && equal([...c.resolvedIdentity.selectedOptions].sort(), [...row.canonicalIdentity.factoryOptionCodes].sort())
      && c.equipment?.selected?.state === 'known' && c.equipment.selected.complete === true
      && c.equipment.selected.completeness === 'complete' && c.completeness?.selectedConfiguration === 'complete'
      && equal(c.equipment.selected.options, c.resolvedIdentity.selectedOptions)
      && c.completeness?.selectedConfiguration === source.selectedOptionCompleteness
      && c.equipment?.verifiedFitted?.state === 'unknown' && c.equipment.verifiedFitted.codes === null
      && keys(c.facts, ['seats', 'luggageNormal', 'luggageExpanded', 'acceleration', 'bodyLength'])
      && ['seats', 'luggageNormal', 'luggageExpanded', 'acceleration', 'bodyLength'].every((key) => Object.hasOwn(c.facts, key))
      && Object.values(c.facts).every((fact) => ['known', 'unknown'].includes(fact?.state)
        && text(fact.unit) && text(fact.definition)
        && (fact.state === 'unknown' ? fact.value === null && fact.provenance?.kind === 'unknown'
          : typeof fact.value === 'number' && Number.isFinite(fact.value) && fact.value >= 0
            && ['partial', 'complete'].includes(fact.completeness) && validProvenance(fact.provenance))),
    'configuration-provenance', 'Dated catalogue evidence must preserve the exact FUCQ-39 identity, selected options, dates, units, unknowns and fitted-equipment limits.');
  }
}
function summary(configurations, vins, images) {
  const counts = { configurations: configurations.length, distinctConfigurations: 0, vinMappings: vins.length, images: images.length };
  const coverage = { markets: {}, steering: {}, models: {}, wmis: {} };
  const completeness = { selectedOptions: {}, sourceKinds: {}, imagesMissing: 0 };
  const signatures = new Set(); const qualifying = new Set(); let observed = 0; let v2 = false;
  const count = (values, key) => { values[key] = (values[key] || 0) + 1; };
  for (const row of configurations) {
    signatures.add(row.canonicalSignature); v2 ||= row.catalogue?.schemaVersion === '2';
    if (row.sourceContext.sourceKind === 'dated-snapshot' && row.canonicalIdentity.provenance.kind === 'observed') {
      observed++;
      if (row.catalogue?.schemaVersion === '2'
        ? row.catalogue.sourceBinding.selection.constructible === true && row.catalogue.sourceBinding.selection.factoryComplete === true
          && row.catalogue.completeness.factorySelection === 'complete'
        : row.catalogue?.completeness?.selectedConfiguration === 'complete') qualifying.add(row.canonicalSignature);
    }
    count(coverage.markets, row.configuration.market); count(coverage.steering, row.configuration.steering ?? 'unknown');
    count(coverage.models, row.configuration.model ?? 'unknown');
    count(completeness.selectedOptions, row.sourceContext.selectedOptionCompleteness);
    count(completeness.sourceKinds, row.sourceContext.sourceKind); if (!row.imageIds.length) completeness.imagesMissing++;
  }
  for (const row of vins) count(coverage.wmis, row.vin17.slice(0, 3));
  counts.distinctConfigurations = signatures.size;
  if (v2) Object.assign(counts, { sourceConfigurations: observed, qualifyingCompleteDistinctSourceConfigurations: qualifying.size });
  return { counts, coverage, completeness };
}
function projectVins(inventory) {
  requireValue(object(inventory) && inventory.schemaVersion === '1' && inventory.generatorVersion === VIN_GENERATOR_VERSION
    && Array.isArray(inventory.records), 'allocation-inventory', 'Supply the complete persisted FUCQ-53 allocation inventory.');
  const { contentDigest, ...content } = inventory;
  requireValue(inputDigest(content) === contentDigest, 'allocation-inventory', 'Allocation inventory integrity failed; do not regenerate identities.');
  const unique = new Map();
  for (const row of inventory.records) {
    requireValue(['stock', 'current-car', 'delivered-car'].includes(row.usage), 'allocation-inventory', 'Unsupported allocation usage.');
    if (row.usage === 'stock') { requireValue(!row.vin17 && !row.vin7, 'stock-vin', 'Stock orders cannot carry published VINs.'); continue; }
    const projected = Object.fromEntries(identityFields.map((field) => [field, structuredClone(row[field])]));
    projected.originatingDatasetId = row.vinAllocationOrigin?.originatingDatasetId;
    // Run-specific order references are intentionally outside the immutable VIN map.
    if (unique.has(row.vehicleId)) requireValue(equal(unique.get(row.vehicleId), projected), 'conflicting-association', 'Repeated physical-car associations disagree.');
    unique.set(row.vehicleId, projected);
  }
  return [...unique.values()].sort((a, b) => a.vehicleId.localeCompare(b.vehicleId));
}
async function validateRows(configurations, vins, images, manifest, options) {
  requireValue(configurations.length > 0 && configurations.length <= 100000, 'configuration-schema', 'A valid corpus needs at least one configuration; absence is source-unavailable.');
  const ids = new Map(); const signatures = new Set();
  let catalogueAdapter; let currentEnvelope;
  for (const row of configurations) {
    requireValue(!ids.has(row.configurationId), 'duplicate-configuration', 'Duplicate configurationId.');
    if (row.catalogue?.schemaVersion === '2') {
      if (!catalogueAdapter) {
        const key = (identity) => configurationKey(identity, manifest.signaturePolicy);
        key.policyVersion = manifest.signaturePolicy.policyVersion;
        const registrations = options.sourceRegistrations ?? await registeredCatalogueSources(key);
        catalogueAdapter = createBmwCatalogueAdapter({ sourceRegistrations: registrations,
          loadSnapshot: async (_version, { lookupIdentity }) => {
            const envelope = currentEnvelope && equal(currentEnvelope.lookupIdentity, lookupIdentity)
              ? structuredClone(currentEnvelope) : undefined;
            // Restore member order only after both retained identities agree.
            if (envelope && equal(envelope.lookupIdentity, lookupIdentity) && equal(envelope.resolvedLookupIdentity, lookupIdentity)) {
              envelope.lookupIdentity = structuredClone(lookupIdentity); envelope.resolvedLookupIdentity = structuredClone(lookupIdentity);
            }
            return envelope;
          } });
      }
      currentEnvelope = row.catalogue;
    }
    await validateConfiguration(row, manifest.signaturePolicy, catalogueAdapter); currentEnvelope = undefined;
    requireValue(!signatures.has(row.canonicalSignature), 'duplicate-configuration', 'Duplicate canonical configuration signature.');
    ids.set(row.configurationId, { snapshotVersion: row.snapshotVersion, configuration: row.configuration,
      configurationHash: inputDigest(row.configuration), imageIds: row.imageIds });
    signatures.add(row.canonicalSignature);
    requireValue(manifest.sourceContexts.some((context) => context.sourceKind === row.sourceContext.sourceKind
      && context.market === row.configuration.market && context.steering === row.configuration.steering
      && context.observedDate === row.sourceContext.observedDate && context.catalogueDate === row.sourceContext.catalogueDate),
    'source-context-mismatch', 'Manifest source contexts must match the configurations actually retained, including explicit unknown steering.');
  }
  const imageIds = new Map();
  for (const image of images) {
    requireValue(keys(image, ['imageId', 'configurationId', 'asset', 'role', 'fidelity', 'sourceKind', 'observedDate'])
      && text(image.imageId) && text(image.asset) && !imageIds.has(image.imageId) && ids.has(image.configurationId)
      && ['representative-model', 'representative-configuration'].includes(image.role)
      && ['representative-model', 'representative-configuration'].includes(image.fidelity)
      && image.role === image.fidelity && image.sourceKind === 'dated-snapshot' && date(image.observedDate)
      && (options.approvedImages || []).some((approved) => equal(approved, image)),
    'unapproved-image', 'Reference only an explicitly approved existing published image with exact role, fidelity, source date and configuration association.');
    imageIds.set(image.imageId, image.configurationId);
  }
  for (const [configurationId, row] of ids) for (const imageId of row.imageIds) {
    requireValue(imageIds.has(imageId) && imageIds.get(imageId) === configurationId,
      'dangling-image', 'Every image reference must resolve to the same configuration.');
  }
  for (const image of images) requireValue(ids.get(image.configurationId).imageIds.includes(image.imageId), 'dangling-image', 'Images need a reciprocal configuration reference.');
  const seen = new Set(); const physical = new Set(); const suffixes = new Set();
  for (const row of vins) {
    requireValue(keys(row, identityFields) && ['current-car', 'delivered-car'].includes(row.usage) && row.identityKind === 'synthetic'
      && ['vehicleId', 'configurationId', 'snapshotVersion', 'configurationHash', 'corpusVersion', 'originatingDatasetId'].every((key) => text(row[key]))
      && object(row.vinAllocationOrigin) && ['seed', 'runId', 'originatingDatasetId'].every((key) => text(row.vinAllocationOrigin[key]))
      && row.originatingDatasetId === row.vinAllocationOrigin.originatingDatasetId, 'vin-schema', 'Only complete delivered/current synthetic VIN associations may be published.');
    requireValue(!seen.has(row.vin17) && !physical.has(row.vehicleId) && !suffixes.has(row.vin7), 'duplicate-vin', 'VIN17, VIN7 and physical vehicle IDs must be unique.');
    seen.add(row.vin17); suffixes.add(row.vin7); physical.add(row.vehicleId);
    const config = ids.get(row.configurationId);
    requireValue(config, 'dangling-configuration', 'A VIN references a missing configuration.');
    requireValue(row.snapshotVersion === config.snapshotVersion && row.configurationHash === config.configurationHash,
      'conflicting-association', 'VIN allocation must retain the exact frozen source snapshot and configuration digest.');
    requireValue(row.generatorVersion === manifest.generatorVersion && row.generatorVersion === VIN_GENERATOR_VERSION,
      'generator-version', 'Generator drift cannot regenerate a retained VIN.');
    const generated = await generateVin({ configuration: config.configuration, serial: row.serial, profileId: row.profile?.profileId,
      profileVersion: row.profile?.profileVersion, registryVersion: row.profile?.registryVersion,
      referenceOnly: row.profile?.referenceOnly, usage: row.usage }, { registry: options.profileRegistry || createVinProfileRegistry() });
    requireValue(generated.status === 'ok', 'unsupported-profile', 'The enabled versioned profile must match the exact market/steering/model/era configuration.');
    for (const field of ['vin17', 'vin7', 'serial', 'profile', 'sourceKind', 'sources', 'confidence', 'unknownFields', 'completeVinDecoded',
      'modelYear', 'productionEra', 'productionDate', 'registrationDate']) requireValue(equal(row[field], generated[field]), 'vin-profile-mismatch', `VIN field ${field} disagrees with retained profile evidence.`);
  }
  const computed = summary(configurations, vins, images);
  requireValue(equal(computed.counts, manifest.counts), 'count-mismatch', 'Declared record/distinct/VIN/image counts do not reconcile.');
  requireValue(equal(computed.coverage, manifest.coverage) && equal(computed.completeness, manifest.completeness),
    'summary-mismatch', 'Coverage or completeness does not reconcile; a small fixture never proves the 200/10000 target.');
}
async function validateManifest(manifest, options) {
  requireValue(keys(manifest, ['datasetId', 'version', 'schemaVersion', 'profileRegistryVersion', 'generatorVersion', 'seed',
    'sourceContexts', 'signaturePolicy', 'qualification', 'counts', 'coverage', 'completeness', 'checksums'])
    && version(manifest.datasetId) && version(manifest.version) && manifest.schemaVersion === CORPUS_SCHEMA_VERSION
    && manifest.profileRegistryVersion === VIN_PROFILE_REGISTRY_VERSION && manifest.generatorVersion === VIN_GENERATOR_VERSION
    && keys(manifest.seed, ['value', 'kind']) && text(manifest.seed.value) && manifest.seed.kind === 'synthetic'
    && Array.isArray(manifest.sourceContexts) && manifest.sourceContexts.length > 0
    && manifest.sourceContexts.every((c) => object(c) && text(c.sourceKind) && date(c.observedDate)
      && (c.catalogueDate === null || date(c.catalogueDate)) && text(c.market) && (c.steering === null || text(c.steering)) && text(c.note))
    && manifest.qualification === 'bounded-fixture-or-partial-corpus'
    && keys(manifest.checksums, CORPUS_FILES) && CORPUS_FILES.every((file) => /^[a-f0-9]{64}$/.test(manifest.checksums[file])),
  'manifest-schema', 'Supply the compatible complete manifest with explicit versions, seed, source contexts, counts, coverage and every artifact checksum.');
  const policy = await signaturePolicy(options, manifest.signaturePolicy?.policyVersion);
  requireValue(equal(policy, manifest.signaturePolicy), 'signature-policy-drift', 'Retained policy provenance differs; no identity regeneration or silent rule migration is allowed.');
}
export async function readCorpusFile(directory, name) {
  const path = join(directory, name); const info = await stat(path);
  requireValue(info.isFile() && info.size <= MAX_BYTES, 'artifact-size', 'Artifact is not a regular file or exceeds the bounded 64 MiB per-file loader limit.');
  return readFile(path, 'utf8');
}
function parseJsonl(content, name) {
  requireValue(content === '' || content.endsWith('\n'), 'truncated-jsonl', `${name} must end with a newline; interrupted/truncated records cannot activate.`);
  if (!content) return [];
  return content.slice(0, -1).split('\n').map((line, i) => {
    try { const row = JSON.parse(line); requireValue(object(row), 'artifact-schema', `${name}:${i + 1} must contain an object.`); return row; }
    catch (error) { if (error instanceof CorpusError) throw error; reject('malformed-jsonl', `${name}:${i + 1} is not a complete JSON object.`); }
  });
}
export async function validateCorpusDirectory(directory, options = {}) {
  try {
    requireValue(typeof directory === 'string' && isAbsolute(directory), 'explicit-path-required', 'Supply an absolute artifact directory.');
    const manifestText = await readCorpusFile(directory, 'manifest.json'); let manifest;
    try { manifest = JSON.parse(manifestText); } catch { reject('manifest-schema', 'manifest.json is malformed.'); }
    await validateManifest(manifest, options);
    const rows = [];
    for (const [i, file] of CORPUS_FILES.entries()) {
      if (options.indexed === true) {
        const indexed = await indexJsonl(join(directory, file), { ...options.jsonlLimits,
          key: (row) => row[['configurationId', 'vehicleId', 'imageId'][i]],
          metadata: (row) => ({ recordDigest: inputDigest(row), ...(i === 1 ? { vin17: row.vin17, vin7: row.vin7 } : {}) }) });
        requireValue(indexed.checksum === manifest.checksums[file], 'checksum-mismatch', `${file} checksum failed; the active corpus is unchanged.`);
        rows.push(indexed);
      } else {
        const content = await readCorpusFile(directory, file);
        requireValue(contentChecksum(content) === manifest.checksums[file], 'checksum-mismatch', `${file} checksum failed; the active corpus is unchanged.`);
        rows.push(parseJsonl(content, file));
      }
    }
    await validateRows(...rows, manifest, options);
    return { status: 'ok', manifest, manifestDigest: contentChecksum(manifestText),
      corpus: freezeCorpus({ manifest, configurations: rows[0], vins: rows[1], images: rows[2] }) };
  } catch (error) { return corpusFailure(error); }
}
export async function durableWrite(path, content, exclusive = false) {
  const file = await open(path, exclusive ? 'wx' : 'w', 0o600);
  try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
}
export async function syncDirectory(path) {
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
/** Bounded byte copy; destination validation checks its complete manifest digest. */
export async function durableCopy(source, destination, maxBytes = JSONL_MAX_BYTES) {
  const input = await open(source, 'r'); let output;
  try {
    const info = await input.stat();
    requireValue(info.isFile() && info.size <= maxBytes, 'artifact-size', 'Artifact exceeds the bounded copy limit.');
    output = await open(destination, 'wx', 0o600);
    const buffer = Buffer.alloc(64 * 1024); let total = 0;
    while (true) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      total += bytesRead; requireValue(total <= maxBytes, 'artifact-size', 'Artifact exceeds the bounded copy limit.');
      await output.writeFile(buffer.subarray(0, bytesRead));
    }
    await output.sync();
  } finally { await input.close(); if (output) await output.close(); }
}
async function writeRows(path, rows, limits = {}) {
  const file = await open(path, 'wx', 0o600); const hash = createHash('sha256'); let bytes = 0; let count = 0;
  try {
    for await (const row of rows) {
      const content = canonicalContent(row); const length = Buffer.byteLength(content); bytes += length; count++;
      requireValue(length <= (limits.maxRowBytes ?? 1024 * 1024), 'artifact-row-size', 'JSONL record exceeds its bounded row limit.');
      requireValue(bytes <= (limits.maxBytes ?? JSONL_MAX_BYTES), 'artifact-size', 'Artifact exceeds the bounded streaming file limit.');
      requireValue(count <= (limits.maxRows ?? 100000), 'artifact-row-count', 'JSONL record count exceeds its bounded limit.');
      await file.writeFile(content); hash.update(content);
    }
    await file.sync(); return hash.digest('hex');
  } finally { await file.close(); }
}
async function spoolRows(staging, name, prior, next, field, options, normalize = (row) => row) {
  const known = new Map(); const incoming = new Set();
  async function* merged() {
    for (const row of prior) { known.set(row[field], inputDigest(row)); yield row; }
    for await (const value of next) {
      const row = normalize(structuredClone(value)); const digest = inputDigest(row); const id = row[field];
      if (field === 'configurationId') requireValue(!incoming.has(id), 'duplicate-configuration', 'Duplicate configurationId.');
      incoming.add(id);
      requireValue(!known.has(id) || known.get(id) === digest,
        field === 'configurationId' ? 'historical-configuration-conflict' : 'conflicting-association',
        'A retained immutable configuration, VIN or image association cannot change.');
      if (!known.has(id)) { known.set(id, digest); yield row; }
    }
  }
  const path = join(staging, `.spool-${name}`);
  await writeRows(path, merged(), options.jsonlLimits);
  const indexed = await indexJsonl(path, { ...options.jsonlLimits, key: (row) => row[field] });
  const entries = [...indexed.metadataEntries()].sort((a, b) => a.key.localeCompare(b.key));
  return { path, rows: { length: entries.length, *[Symbol.iterator]() { for (const entry of entries) yield indexed.get(entry.key); } } };
}
/** Offline packaging only. Publishes no selection and changes no allocation inventory. */
export async function writeCorpusCandidate(directory, input, options = {}) {
  let staging;
  try {
    requireValue(typeof directory === 'string' && isAbsolute(directory), 'explicit-path-required', 'Supply an absolute candidate output directory.');
    const policy = await signaturePolicy(options);
    let retained = { configurations: [], vins: [], images: [] };
    if (input.retainedCorpusDirectory !== undefined) {
      const checked = await validateCorpusDirectory(input.retainedCorpusDirectory, { ...options, indexed: true });
      requireValue(checked.status === 'ok', 'retained-corpus-invalid', 'Restore a complete validated prior corpus before retaining its immutable rows.');
      retained = checked.corpus;
    }
    let configurations = input.configurations;
    if (input.configurationsFile !== undefined) {
      requireValue(typeof input.configurationsFile === 'string' && isAbsolute(input.configurationsFile)
        && configurations === undefined, 'explicit-path-required', 'Supply one absolute configurationsFile or an iterable of configuration rows.');
      configurations = await indexJsonl(input.configurationsFile, options.jsonlLimits);
    }
    requireValue(configurations && (typeof configurations[Symbol.iterator] === 'function'
      || typeof configurations[Symbol.asyncIterator] === 'function'), 'configuration-schema', 'Supply an iterable of configurations or an explicit JSONL configurationsFile.');
    directory = resolve(directory); await mkdir(dirname(directory), { recursive: true });
    staging = join(dirname(directory), `.candidate-${randomUUID()}`); await mkdir(staging, { mode: 0o700 });
    const prepared = [];
    prepared.push(await spoolRows(staging, CORPUS_FILES[0], retained.configurations, configurations, 'configurationId', options, (row) => {
      row.canonicalSignature = configurationSignature(row, policy); row.canonicalIdentity.factoryOptionCodes.sort(); return row;
    }));
    const additions = input.allocationInventory === undefined ? [] : projectVins(input.allocationInventory);
    prepared.push(await spoolRows(staging, CORPUS_FILES[1], retained.vins, additions, 'vehicleId', options));
    prepared.push(await spoolRows(staging, CORPUS_FILES[2], retained.images, input.images || [], 'imageId', options));
    const checksums = {};
    for (const [i, file] of CORPUS_FILES.entries()) checksums[file] = await writeRows(join(staging, file), prepared[i].rows, options.jsonlLimits);
    const manifest = { ...structuredClone(input.metadata), signaturePolicy: policy, qualification: 'bounded-fixture-or-partial-corpus',
      ...summary(...prepared.map((item) => item.rows)), checksums };
    await durableWrite(join(staging, 'manifest.json'), canonicalContent(manifest), true);
    const validated = await validateCorpusDirectory(staging, { ...options, indexed: true });
    if (validated.status !== 'ok') return validated;
    for (const item of prepared) await rm(item.path);
    await syncDirectory(staging);
    // rename cannot replace a populated output directory; callers use a fresh explicit path.
    await rename(staging, directory); staging = null; await syncDirectory(dirname(directory));
    return { status: 'ok', directory, manifest };
  } catch (error) { return corpusFailure(error); }
  finally { if (staging) await rm(staging, { recursive: true, force: true }); }
}
