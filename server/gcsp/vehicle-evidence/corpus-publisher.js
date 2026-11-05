import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { inputDigest } from '../repository/core.js';
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
  code: error instanceof CorpusError ? error.code : 'artifact-unavailable',
  message: error instanceof CorpusError ? error.message : 'Read the complete candidate from an accessible explicit directory; no version was selected.',
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
function configurationSignature(row, policy) {
  const identity = row.canonicalIdentity;
  requireValue(keys(identity, ['vgModelCode', 'agModelCode', 'factoryOptionCodes', 'provenance']), 'configuration-signature', 'Supply a separate explicit canonical model/code identity.');
  const field = policy.assumptions[SIGNATURE_KEYS[0]].value;
  const model = identity[field]; const codes = identity.factoryOptionCodes;
  requireValue(typeof model === 'string' && /^[A-Z0-9]{2,16}$/.test(model) && Array.isArray(codes)
    && codes.length > 0 && codes.length <= 256 && codes.every((v) => typeof v === 'string' && /^[A-Z0-9]{2,16}$/.test(v))
    && new Set(codes).size === codes.length, 'configuration-signature', 'Canonical identity needs an explicit upper-case model code and every unique factory code; unknown source codes cannot be invented as observed.');
  const signature = `${model}:${[...codes].sort().join(policy.assumptions[SIGNATURE_KEYS[1]].value)}`;
  requireValue(row.configurationId === Buffer.from(signature).toString('base64'), 'configuration-signature', 'configurationId must match the canonical model and sorted complete identity codes.');
  return signature;
}
function validProvenance(p) {
  return keys(p, ['kind', 'source', 'observedDate']) && ['observed', 'synthetic'].includes(p.kind) && text(p.source)
    && (p.kind === 'observed' ? date(p.observedDate) : p.observedDate === null);
}
function validateConfiguration(row, policy) {
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
    && ['market', 'region', 'steering', 'model', 'derivative', 'generation', 'body', 'powertrain', 'drive', 'productionEra', 'plant'].every((key) => text(config[key]))
    && ['agModelCode', 'vgModelCode', 'transmission', 'engineCode'].every((key) => config[key] === null || text(config[key]))
    && Number.isSafeInteger(config.modelYear) && (config.productionDate === null || date(config.productionDate)),
  'configuration-provenance', 'Keep source references, dates, market, steering, equipment completeness and explicit unknowns; VIN spelling supplies none of these facts.');
  for (const field of ['agModelCode', 'vgModelCode']) {
    if (config[field] !== null) requireValue(row.canonicalIdentity[field] === config[field], 'configuration-signature', 'A known source model code cannot be replaced by an identity alias.');
  }
  if (source.sourceKind === 'north-american-reference') {
    requireValue(config.market === 'US' && config.steering === 'LHD' && source.selectedOptionCompleteness === 'unknown'
      && row.canonicalIdentity.provenance.kind === 'synthetic' && row.catalogue === null,
    'configuration-provenance', 'Partial North American structural references do not establish full selections, UK/RHD profiles or real canonical option codes.');
  } else {
    const c = row.catalogue;
    requireValue(object(c) && ['ok', 'partial'].includes(c.status) && c.schemaVersion === '1'
      && c.provider === 'bmw-catalogue-snapshot' && c.providerVersion === '1' && c.sourceKind === 'dated-snapshot'
      && c.snapshotVersion === row.snapshotVersion && c.observedDate === source.observedDate
      && date(c.retrievedDate) && object(c.requestedIdentity) && equal(c.requestedIdentity, c.resolvedIdentity)
      && object(c.lookupIdentity) && equal(c.lookupIdentity, c.resolvedLookupIdentity)
      && c.resolvedIdentity.market === config.market && c.resolvedIdentity.catalogueDate === source.catalogueDate
      && c.resolvedIdentity.modelCode === config.vgModelCode && c.resolvedIdentity.agModelCode === config.agModelCode
      && equal([...c.resolvedIdentity.selectedOptions].sort(), [...row.canonicalIdentity.factoryOptionCodes].sort())
      && c.equipment?.selected?.state === 'known' && c.equipment.selected.complete === true
      && equal(c.equipment.selected.options, c.resolvedIdentity.selectedOptions)
      && c.completeness?.selectedConfiguration === source.selectedOptionCompleteness
      && c.equipment?.verifiedFitted?.state === 'unknown' && object(c.facts)
      && Object.values(c.facts).every((fact) => ['known', 'unknown'].includes(fact?.state)
        && (fact.state === 'unknown' ? fact.value === null : typeof fact.value === 'number' && Number.isFinite(fact.value)
          && text(fact.unit) && validProvenance(fact.provenance))),
    'configuration-provenance', 'Dated catalogue evidence must preserve the exact FUCQ-39 identity, selected options, dates, units, unknowns and fitted-equipment limits.');
  }
}
function summary(configurations, vins, images) {
  const count = (items, selector) => items.reduce((result, item) => { const key = selector(item); result[key] = (result[key] || 0) + 1; return result; }, {});
  return { counts: { configurations: configurations.length, distinctConfigurations: new Set(configurations.map((r) => r.canonicalSignature)).size,
    vinMappings: vins.length, images: images.length },
  coverage: { markets: count(configurations, (r) => r.configuration.market), steering: count(configurations, (r) => r.configuration.steering),
    models: count(configurations, (r) => r.configuration.model), wmis: count(vins, (r) => r.vin17.slice(0, 3)) },
  completeness: { selectedOptions: count(configurations, (r) => r.sourceContext.selectedOptionCompleteness),
    sourceKinds: count(configurations, (r) => r.sourceContext.sourceKind), imagesMissing: configurations.filter((r) => !r.imageIds.length).length } };
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
  for (const row of configurations) {
    requireValue(!ids.has(row.configurationId), 'duplicate-configuration', 'Duplicate configurationId.');
    validateConfiguration(row, manifest.signaturePolicy);
    requireValue(!signatures.has(row.canonicalSignature), 'duplicate-configuration', 'Duplicate canonical configuration signature.');
    ids.set(row.configurationId, row); signatures.add(row.canonicalSignature);
  }
  const imageIds = new Set();
  for (const image of images) {
    requireValue(keys(image, ['imageId', 'configurationId', 'asset', 'role', 'fidelity', 'sourceKind', 'observedDate'])
      && text(image.imageId) && !imageIds.has(image.imageId) && ids.has(image.configurationId)
      && ['representative-model', 'representative-configuration'].includes(image.role)
      && ['representative-model', 'representative-configuration'].includes(image.fidelity)
      && image.sourceKind === 'dated-snapshot' && date(image.observedDate)
      && (options.approvedImages || []).some((approved) => equal(approved, image)),
    'unapproved-image', 'Reference only an explicitly approved existing published image with exact role, fidelity, source date and configuration association.');
    imageIds.add(image.imageId);
  }
  for (const row of configurations) for (const imageId of row.imageIds) {
    requireValue(imageIds.has(imageId) && images.find((i) => i.imageId === imageId).configurationId === row.configurationId,
      'dangling-image', 'Every image reference must resolve to the same configuration.');
  }
  requireValue(images.every((image) => ids.get(image.configurationId).imageIds.includes(image.imageId)), 'dangling-image', 'Images need a reciprocal configuration reference.');
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
    requireValue(row.snapshotVersion === config.snapshotVersion && row.configurationHash === inputDigest(config.configuration),
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
      && (c.catalogueDate === null || date(c.catalogueDate)) && text(c.market) && text(c.steering) && text(c.note))
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
    for (const file of CORPUS_FILES) {
      const content = await readCorpusFile(directory, file);
      requireValue(contentChecksum(content) === manifest.checksums[file], 'checksum-mismatch', `${file} checksum failed; the active corpus is unchanged.`);
      rows.push(parseJsonl(content, file));
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
/** Offline packaging only. Publishes no selection and changes no allocation inventory. */
export async function writeCorpusCandidate(directory, input, options = {}) {
  let staging;
  try {
    requireValue(typeof directory === 'string' && isAbsolute(directory), 'explicit-path-required', 'Supply an absolute candidate output directory.');
    const policy = await signaturePolicy(options);
    const configurations = structuredClone(input.configurations).sort((a, b) => a.configurationId.localeCompare(b.configurationId));
    for (const row of configurations) row.canonicalSignature = configurationSignature(row, policy);
    const vins = projectVins(input.allocationInventory); const images = structuredClone(input.images || []).sort((a, b) => a.imageId.localeCompare(b.imageId));
    const artifacts = [configurations, vins, images].map((rows) => rows.map(canonicalContent).join(''));
    const manifest = { ...structuredClone(input.metadata), signaturePolicy: policy, qualification: 'bounded-fixture-or-partial-corpus',
      ...summary(configurations, vins, images), checksums: Object.fromEntries(CORPUS_FILES.map((name, i) => [name, contentChecksum(artifacts[i])])) };
    await validateManifest(manifest, options); await validateRows(configurations, vins, images, manifest, options);
    directory = resolve(directory); await mkdir(dirname(directory), { recursive: true });
    staging = join(dirname(directory), `.candidate-${randomUUID()}`); await mkdir(staging, { mode: 0o700 });
    for (const [i, file] of CORPUS_FILES.entries()) await durableWrite(join(staging, file), artifacts[i], true);
    await durableWrite(join(staging, 'manifest.json'), canonicalContent(manifest), true); await syncDirectory(staging);
    // rename cannot replace a populated output directory; callers use a fresh explicit path.
    await rename(staging, directory); staging = null; await syncDirectory(dirname(directory));
    return { status: 'ok', directory, manifest };
  } catch (error) { return corpusFailure(error); }
  finally { if (staging) await rm(staging, { recursive: true, force: true }); }
}
