import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_PATH, validateDemoPlan } from './demo-plan.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FUCQ61_COVERAGE = 'docs/gcsp/evidence/fucq61/exact10000-closeout-2026-11-07/coverage.json';
export const ROUND_TRIPS_PATH = 'docs/gcsp/evidence/fucq77/round-trips-2026-11-08/round-trips.json';
export const ENRICHMENT_DIR = 'server/data/gcsp/vehicle-evidence/demo-enrichment.v1';
export const ENRICHMENT_SCHEMA = 'demo-enrichment.v1';
// Sidecar fact keys: the five OTD facts the story names, then the expanded luggage volume.
export const ENRICHMENT_FACTS = Object.freeze(['acceleration', 'seats', 'luggageNormal', 'rangeOrEconomy', 'co2', 'luggageExpanded']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const code = (value) => typeof value === 'string' && /^[A-Z0-9]{2,16}$/.test(value);
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sameCodes = (left, right) => Array.isArray(left) && Array.isArray(right)
  && left.length === right.length && left.every((value, index) => value === right[index]);
export const UNVERIFIED_DEMO_GATES = Object.freeze([
  'accepted-current-model-plan', 'F59-real-constructible-solver-proof-and-changes',
  'eight-real-configurations-per-mapped-line', 'source-backed-paint-upholstery-wheel-pack-variation',
  'F60-real-OTD-facts-and-COSY-exterior-provenance', 'twenty-real-exact-headless-deep-links',
  'finite-live-budget-redaction-resume-report', 'F54-versioned-publication-and-lookup-proof',
  'authored-collector-verifier-integration-suite', 'parent-coordinated-final-suite',
]);

const known = (field) => (object(field) && field.state === 'known' ? field.value : undefined);
const decodedModel = (id) => { try { return Buffer.from(String(id), 'base64').toString('utf8').split(':')[0]; } catch { return null; } };
const accessoryCode = (value) => (object(value) ? value.code : value);

// Option categories only from typed definition locators such as "paint-P0300"; prefixes are never used to guess a category.
const CATEGORY_NAMES = Object.freeze({ paint: 'paint', upholstery: 'upholstery', wheel: 'wheels', wheels: 'wheels',
  rim: 'wheels', rims: 'wheels', pack: 'pack', packs: 'pack', package: 'pack', packages: 'pack' });
export function typedCategories(binding) {
  const result = { paint: [], upholstery: [], wheels: [], pack: [] };
  for (const locator of (binding?.evidence || []).flatMap((item) => (Array.isArray(item?.locators) ? item.locators : []))) {
    const match = /^([a-z]+)-([A-Z0-9]{2,16})$/.exec(locator?.name);
    const category = match && CATEGORY_NAMES[match[1]];
    if (category && !result[category].includes(match[2])) result[category].push(match[2]);
  }
  return result;
}

/** Audit a v2 row: identity, solver binding and dates come from the retained source binding, not synthetic fields. */
function auditIdentityV2(row) {
  const errors = []; const fail = (value) => { if (!errors.includes(value)) errors.push(value); };
  const identity = row.canonicalIdentity || {}; const config = row.configuration || {}; const catalogue = row.catalogue;
  const binding = catalogue.sourceBinding; const source = row.sourceContext || {}; const selected = catalogue.equipment?.selected || {};
  if (!object(binding) || !object(binding.confirmedContext) || !object(binding.selection)) return { errors: ['configuration-schema'] };
  const context = binding.confirmedContext; const selection = binding.selection; const options = identity.factoryOptionCodes;
  const { vgModelCode, agModelCode } = identity;
  if (!code(vgModelCode) || !code(agModelCode) || config.vgModelCode !== vgModelCode || config.agModelCode !== agModelCode) fail('model-identity');
  const identities = ['requestedIdentity', 'resolvedIdentity', 'lookupIdentity', 'resolvedLookupIdentity'].map((name) => catalogue[name]);
  const [requested, resolved, lookup, resolvedLookup] = identities;
  if (!identities.every(object)) fail('requested-resolved-identity');
  const confirmedVg = known(context.modelCode); const confirmedAg = known(context.agModelCode);
  if (confirmedVg === undefined || confirmedAg === undefined) fail('model-identity');
  else if (confirmedVg !== vgModelCode || confirmedAg !== agModelCode
    || binding.canonicalIdentity?.vgModelCode !== vgModelCode || binding.canonicalIdentity?.agModelCode !== agModelCode
    || (binding.requestScope?.requests || []).some((value) => value.modelCode !== undefined && value.modelCode !== vgModelCode)
    || identities.filter(object).some((value) => decodedModel(value.configurationId) !== vgModelCode)) fail('changed-model-code');
  const validCodes = Array.isArray(options) && options.length > 0 && options.length <= 256
    && options.every(code) && new Set(options).size === options.length && sameCodes(options, [...options].sort());
  if (!validCodes) fail('factory-option-normalisation');
  const categories = typedCategories(binding); const paintCodes = categories.paint; const upholsteryCodes = categories.upholstery;
  let signature; let configurationId;
  if (validCodes && code(vgModelCode)) {
    signature = `${vgModelCode}:${options.join(',')}`; configurationId = Buffer.from(signature, 'utf8').toString('base64');
    if (row.canonicalSignature !== signature || row.configurationId !== configurationId
      || [resolved, lookup, resolvedLookup].filter(object).some((value) => value.configurationId !== configurationId)) fail('configuration-id');
    if (!options.some((value) => value.startsWith('P')) || !options.some((value) => value.startsWith('F'))
      || ![...paintCodes, ...upholsteryCodes].every((value) => options.includes(value))) fail('paint-upholstery-required');
    const accessories = new Set([...(selection.accessories || []), ...(selected.accessories || []),
      ...(selection.elements || []).filter((value) => value?.type === 'accessory')].map(accessoryCode));
    if (options.some((value) => accessories.has(value))) fail('dealer-accessory-in-identity');
  }
  const optionElements = (selection.elements || []).filter((value) => value?.type === 'option').map((value) => value.code).sort();
  if (source.selectedOptionCompleteness !== 'complete' || catalogue.completeness?.factorySelection !== 'complete'
    || selected.state !== 'known' || selected.factoryComplete !== true || selection.constructible !== true
    || selection.factoryComplete !== true || !sameCodes(options, selected.options)
    || !sameCodes(options, selection.factoryOptionCodes) || !sameCodes(options, optionElements)) fail('complete-selection-required');
  const orderDate = known(context.orderDate); const effectDate = known(context.effectDate);
  if (!date(orderDate) || !date(effectDate) || !date(source.observedDate) || catalogue.observedDate !== source.observedDate
    || !date(catalogue.retrievedDate) || !date(source.catalogueDate) || source.catalogueDate !== catalogue.observedDate) fail('source-dates');
  if (source.sourceKind !== 'dated-snapshot' || catalogue.sourceKind !== 'dated-snapshot'
    || identity.provenance?.kind !== 'observed' || !date(identity.provenance?.observedDate)
    || !Array.isArray(source.sourceRefs) || source.sourceRefs.length === 0
    || !Array.isArray(binding.evidence) || binding.evidence.length === 0) fail('observed-source-required');
  if (!Object.hasOwn(config, 'modelYear') || (config.modelYear === null
    ? !Array.isArray(source.unresolvedFacts) || !source.unresolvedFacts.includes('modelYear')
    : !Number.isSafeInteger(config.modelYear) || config.modelYear < 1900 || config.modelYear > 2100)) fail('model-year-explicit');
  const changes = selection.solverChanges || {}; const size = (name) => (Array.isArray(changes[name]) ? changes[name].length : 0);
  return { errors, signature, configurationId, vgModelCode, agModelCode, options, rawModelRange: known(context.rawModelRange),
    paintCodes, upholsteryCodes, categories, orderDate, effectDate, modelYear: config.modelYear ?? null,
    identityChange: object(requested) && object(resolved) ? { bindingDigestChanged: requested.bindingDigest !== resolved.bindingDigest,
      configurationIdChanged: requested.configurationId !== resolved.configurationId } : null,
    solverChanges: { added: size('added'), removed: size('removed'), ignored: size('ignored') } };
}

/** Audit the retained F54 shape (v1 and v2); solver/enrichment evidence belongs in the canonical producers. */
export function auditIdentity(row) {
  if (!object(row)) return { errors: ['configuration-schema'] };
  return row.catalogue?.schemaVersion === '2' ? auditIdentityV2(row) : auditIdentityV1(row);
}

/** Older v1 rows carry the requested/resolved identities in full, so they are audited field by field. */
function auditIdentityV1(row) {
  const errors = []; const fail = (value) => errors.push(value);
  if (!object(row)) return { errors: ['configuration-schema'] };
  const identity = row.canonicalIdentity || {}; const config = row.configuration || {};
  const catalogue = row.catalogue || {}; const lookup = catalogue.lookupIdentity || {};
  const resolvedLookup = catalogue.resolvedLookupIdentity || {};
  const requested = catalogue.requestedIdentity || {}; const resolved = catalogue.resolvedIdentity || {};
  const selected = catalogue.equipment?.selected || {}; const source = row.sourceContext || {};
  const options = identity.factoryOptionCodes;
  if (!code(identity.vgModelCode) || !code(identity.agModelCode) || !code(lookup.modelRange)
    || config.vgModelCode !== identity.vgModelCode || config.agModelCode !== identity.agModelCode) fail('model-identity');
  const validCodes = Array.isArray(options) && options.length > 0 && options.length <= 256
    && options.every(code) && new Set(options).size === options.length && sameCodes(options, [...options].sort());
  if (!validCodes) fail('factory-option-normalisation');
  let signature; let configurationId;
  if (validCodes && code(identity.vgModelCode)) {
    signature = `${identity.vgModelCode}:${options.join(',')}`;
    configurationId = Buffer.from(signature, 'utf8').toString('base64');
    if (row.canonicalSignature !== signature || row.configurationId !== configurationId) fail('configuration-id');
    if (!options.some((value) => value.startsWith('P')) || !options.some((value) => value.startsWith('F'))) fail('paint-upholstery-required');
    const accessories = new Set((Array.isArray(selected.accessories) ? selected.accessories : []).map((value) => value?.code));
    if (options.some((value) => accessories.has(value) || value.startsWith('SE'))) fail('dealer-accessory-in-identity');
  }
  if (source.selectedOptionCompleteness !== 'complete' || catalogue.completeness?.selectedConfiguration !== 'complete'
    || selected.state !== 'known' || selected.complete !== true || selected.completeness !== 'complete'
    || !sameCodes(options, selected.options) || !sameCodes(options, resolved.selectedOptions)
    || !sameCodes(options, lookup.selectedOptions) || !sameCodes(options, requested.selectedOptions)
    || !sameCodes(options, resolvedLookup.selectedOptions)) fail('complete-selection-required');
  if ([requested, resolved, lookup, resolvedLookup].some((value) => value.modelCode !== identity.vgModelCode
    || value.agModelCode !== identity.agModelCode || value.modelRange !== lookup.modelRange || value.market !== 'GB')
    || config.market !== 'GB') fail('changed-model-or-context');
  const validity = catalogue.catalogueValidity || {};
  if (!date(source.observedDate) || catalogue.observedDate !== source.observedDate
    || !date(catalogue.retrievedDate) || !date(source.catalogueDate)
    || !['orderDate', 'effectDate'].every((field) => date(validity[field])
      && [requested, resolved, lookup, resolvedLookup].every((value) => value[field] === validity[field]))
    || [requested, resolved, lookup, resolvedLookup].some((value) => value.catalogueDate !== source.catalogueDate)) fail('source-dates');
  if (source.sourceKind !== 'dated-snapshot' || catalogue.sourceKind !== 'dated-snapshot'
    || identity.provenance?.kind !== 'observed' || !date(identity.provenance?.observedDate)
    || !Array.isArray(source.sourceRefs) || source.sourceRefs.length === 0) fail('observed-source-required');
  if (!Object.hasOwn(config, 'modelYear') || (config.modelYear === null
    ? !Array.isArray(source.unresolvedFacts) || !source.unresolvedFacts.includes('modelYear')
    : !Number.isSafeInteger(config.modelYear) || config.modelYear < 1900 || config.modelYear > 2100)) fail('model-year-explicit');
  return { errors, signature, configurationId, modelRange: lookup.modelRange, options,
    vgModelCode: identity.vgModelCode, agModelCode: identity.agModelCode };
}

/** A passing identity audit is deliberately not a collected, enriched or browser-verified demo corpus. */
export function verifyFleetIdentity({ records, manifest = null, minimumDistinct = 200 } = {}) {
  if (!Number.isSafeInteger(minimumDistinct) || minimumDistinct < 200) throw new TypeError('The demo requires at least 200 distinct configurations.');
  const errors = []; const signatures = new Set(); const ids = new Set();
  if (!Array.isArray(records) || records.length > 100000) {
    return { scope: 'F54-identity-only', identityValid: false, countsValid: false, manifestValid: false,
      recordCount: 0, distinctCount: 0, errors: [{ code: 'configuration-schema' }],
      acceptanceComplete: false, acceptedDemoConfigurations: 0, unverifiedGates: [...UNVERIFIED_DEMO_GATES] };
  }
  records.forEach((row, rowIndex) => {
    const audited = auditIdentity(row);
    for (const code of audited.errors) errors.push({ code, rowIndex });
    // Record metadata is intentionally absent from the distinctness key.
    if (audited.signature) {
      if (signatures.has(audited.signature) || ids.has(row.configurationId)) errors.push({ code: 'duplicate-configuration', rowIndex });
      signatures.add(audited.signature); ids.add(row.configurationId);
    }
  });
  if (records.length === 0) errors.push({ code: 'configuration-corpus-empty' });
  const identityValid = errors.length === 0;
  const manifestValid = manifest === null ? null : manifest.counts?.configurations === records.length
    && manifest.counts?.distinctConfigurations === signatures.size;
  if (manifestValid === false) errors.push({ code: 'manifest-count-mismatch' });
  return { scope: 'F54-identity-only', identityValid, countsValid: signatures.size >= minimumDistinct,
    manifestValid, minimumDistinct, recordCount: records.length, distinctCount: signatures.size, errors,
    acceptanceComplete: false, acceptedDemoConfigurations: 0, unverifiedGates: [...UNVERIFIED_DEMO_GATES] };
}

/** Every VG model a mapped line owns: its primary mapping plus the additional models it lists. */
export function lineModels(line) {
  const { mapping } = line; const raw = mapping.evidence?.rawModelRange;
  return [{ vgModelCode: mapping.vgModelCode, agModelCode: mapping.agModelCode, modelRange: mapping.modelRange, rawModelRange: raw },
    ...(mapping.additionalModels || []).map((extra) => ({ vgModelCode: extra.vgModelCode, agModelCode: extra.agModelCode,
      modelRange: mapping.modelRange, rawModelRange: extra.evidence?.rawModelRange ?? raw }))];
}

/** Audit each row once and own it by VG code (then AG and range), so a changed model can never count for a line. */
export function assignRowsToLines({ records, plan } = {}) {
  const mapped = plan.modelLines.filter((line) => line.mapping.status === 'mapped');
  const owner = new Map(mapped.flatMap((line) => lineModels(line).map((model) => [model.vgModelCode, { lineId: line.id, ...model }])));
  const lines = new Map(mapped.map((line) => [line.id, []])); const unassigned = []; const invalid = [];
  records.forEach((row, index) => {
    const audited = auditIdentity(row);
    if (audited.errors.length) { invalid.push({ index, errors: audited.errors }); return; }
    const model = owner.get(audited.vgModelCode);
    const rangeOk = model && (audited.modelRange === undefined ? audited.rawModelRange === model.rawModelRange : audited.modelRange === model.modelRange);
    if (!model || model.agModelCode !== audited.agModelCode || !rangeOk) { unassigned.push(index); return; }
    lines.get(model.lineId).push({ index, audited, modelRange: model.modelRange });
  });
  return { mapped, lines, unassigned, invalid };
}

/** Count exact mapped identities without treating cached/provenance copies as more configurations. */
export function verifyFleetCoverage({ records, plan, matrixText, verifyEvidence, planReport, retainedCounts = {} } = {}) {
  planReport = planReport || validateDemoPlan(plan, { matrixText, verifyEvidence });
  const pending = { planReady: planReport.ready, perLineValid: false, totalValid: false, coverageValid: false,
    distinctCount: 0, perLineCounts: {}, unassignedConfigurations: 0, acceptedDemoConfigurations: 0 };
  if (!planReport.mappedReady || !Array.isArray(records)) return pending;
  const { mapped, lines, unassigned, invalid } = assignRowsToLines({ records, plan });
  const distinct = new Set(); const perLineCounts = {}; const lineReport = [];
  for (const line of mapped) {
    const signatures = new Set(lines.get(line.id).map((item) => item.audited.signature));
    signatures.forEach((value) => distinct.add(value)); perLineCounts[line.id] = signatures.size;
    lineReport.push({ lineId: line.id, model: line.model, engine: line.engine, localRows: signatures.size,
      vgModelCodes: lineModels(line).map((model) => model.vgModelCode),
      fucq61Rows: lineModels(line).reduce((sum, model) => sum + (retainedCounts[model.vgModelCode] || 0), 0) });
  }
  const minimum = plan.requirements.minimumPerMappedLine;
  const perLineValid = Object.values(perLineCounts).every((count) => count >= minimum);
  const totalValid = distinct.size >= plan.requirements.minimumDistinct;
  const coverageGaps = lineReport.filter((line) => line.localRows === 0);
  const underMinimum = lineReport.filter((line) => line.localRows > 0 && line.localRows < minimum);
  return { ...pending, perLineValid, totalValid, distinctCount: distinct.size, perLineCounts, unassignedConfigurations: unassigned.length,
    invalidConfigurations: invalid.length, lines: lineReport, coverageGaps, underMinimum, localPerLineValid: underMinimum.length === 0,
    coverageValid: perLineValid && totalValid && invalid.length === 0 && unassigned.length === 0 };
}

/** Generate a route from audited identity; this does not assert today's browser round-trip. */
export function configurationDeepLink(row, { modelRange } = {}) {
  const audited = auditIdentity(row);
  const range = audited.modelRange ?? modelRange;
  if (audited.errors.length || !code(range) || (audited.modelRange !== undefined && modelRange !== undefined && modelRange !== audited.modelRange)) {
    throw new Error('Cannot form a configurator link from an invalid configuration identity.');
  }
  return `https://configure.bmw.co.uk/en_GB/configure/${range}/${audited.vgModelCode}/${audited.options.join(',')}`;
}

// The five OTD facts, the record field that carries each and its sidecar key; absent fields stay unknown, never inferred.
const OTD_FACTS = Object.freeze({ acceleration: ['acceleration'], seats: ['seats'], boot: ['luggageNormal'], rangeOrEconomy: [], co2: [] });
const SIDECAR_KEY = Object.freeze({ acceleration: 'acceleration', seats: 'seats', boot: 'luggageNormal', rangeOrEconomy: 'rangeOrEconomy', co2: 'co2' });

/** Count known versus unknown OTD facts from the record, a registered technical supplement or a validated sidecar entry. */
export function countOtdFacts(records, manifest = {}, sidecar = new Map()) {
  const supplements = new Map((manifest.technicalSupplements || []).map((item) => [item.configurationId, item]));
  const result = Object.fromEntries(Object.keys(OTD_FACTS).map((name) => [name, { known: 0, unknown: 0 }]));
  for (const row of records) {
    for (const [name, fields] of Object.entries(OTD_FACTS)) {
      const isKnown = fields.some((field) => row.catalogue?.facts?.[field]?.state === 'known'
        || supplements.get(row.configurationId)?.facts?.[field]?.state === 'known')
        || sidecar.get(row.configurationId)?.facts?.[SIDECAR_KEY[name]]?.state === 'known';
      result[name][isKnown ? 'known' : 'unknown']++;
    }
  }
  return result;
}

const FACT_REASON = /^[a-z][a-z0-9-]{1,63}$/;
const ASSET_URL = /https?:|\/\/|\.(?:webp|png|jpe?g|avif)\b/i;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function validEnrichmentFact(fact) {
  if (!object(fact)) return false;
  if (fact.state === 'known') {
    return typeof fact.value === 'number' && Number.isFinite(fact.value) && typeof fact.unit === 'string' && fact.unit.length > 0
      && object(fact.provenance) && fact.provenance.source === 'BMW UK OTD' && date(fact.provenance.observedDate);
  }
  return fact.state === 'unknown' && fact.value === null && typeof fact.reason === 'string' && FACT_REASON.test(fact.reason);
}

function validExteriorReference(ref) {
  return object(ref) && ref.kind === 'cosy-exterior-render' && ref.source === 'BMW COSY' && date(ref.observedDate)
    && typeof ref.viewpoint === 'string' && /^[A-Z0-9]{1,32}$/.test(ref.viewpoint) && typeof ref.pointer === 'string' && ref.pointer.startsWith('/')
    && ref.fidelity === 'representative-configuration' && object(ref.fidelityDetail) && object(ref.manifestRequest)
    && !ASSET_URL.test(JSON.stringify(ref));
}

function validEnrichmentEntry(entry, errors) {
  const bad = (code) => { if (!errors.includes(code)) errors.push(code); };
  const observed = entry.observation === 'observed';
  if (!['observed', 'not-observed', 'rejected'].includes(entry.observation)) bad('entry-observation');
  if (!object(entry.facts) || !ENRICHMENT_FACTS.every((name) => validEnrichmentFact(entry.facts[name]))) bad('malformed-fact');
  else if (!observed && ENRICHMENT_FACTS.some((name) => entry.facts[name].state !== 'unknown')) bad('unobserved-entry-with-fact');
  // A rejected technical observation may still carry its own validated exterior render reference; a not-observed row may not.
  if (!Array.isArray(entry.imageReferences) || entry.imageReferences.length > 8 || !entry.imageReferences.every(validExteriorReference)) bad('malformed-image-reference');
  else if (entry.observation === 'not-observed' && entry.imageReferences.length > 0) bad('unobserved-entry-with-image');
  if (!Array.isArray(entry.unmappedOtdCodes) || !entry.unmappedOtdCodes.every((value) => /^[A-Z0-9_]{1,96}$/.test(value))) bad('malformed-unmapped-codes');
}

/** Counts a set of sidecar entries; the composer and the verifier share it so the manifest can be recomputed. */
export function countEnrichmentEntries(entries) {
  const facts = Object.fromEntries(ENRICHMENT_FACTS.map((name) => [name, { known: 0, unknown: 0 }]));
  const counts = { rows: 0, observed: 0, notObserved: 0, rejected: 0, rowsWithExteriorReference: 0, facts };
  for (const entry of entries) {
    counts.rows++;
    if (entry.observation === 'observed') counts.observed++;
    else if (entry.observation === 'rejected') counts.rejected++;
    else counts.notObserved++;
    if (entry.imageReferences?.length > 0) counts.rowsWithExteriorReference++;
    for (const name of ENRICHMENT_FACTS) facts[name][entry.facts?.[name]?.state === 'known' ? 'known' : 'unknown']++;
  }
  return counts;
}

/** Read the sidecar from the repo path; absent or unreadable files mean no sidecar, never an error. */
export async function readEnrichmentEvidence(root = REPO_ROOT) {
  const read = (name) => readFile(resolve(root, ENRICHMENT_DIR, name), 'utf8');
  try { return { manifest: JSON.parse(await read('manifest.json')), jsonl: await read('enrichment.jsonl') }; } catch { return null; }
}

/** Validate a sidecar against the staged rows; any defect rejects the whole sidecar so no partial value is ever applied. */
export function scoreEnrichment(evidence, records, stagedDigest) {
  const base = { path: ENRICHMENT_DIR, present: false, valid: null, errors: [] };
  if (evidence === null || evidence === undefined) return { summary: base, entries: new Map() };
  const errors = []; const fail = (code) => { if (!errors.includes(code)) errors.push(code); };
  const manifest = evidence.manifest; const text = evidence.jsonl; const entries = new Map(); const list = [];
  if (!object(manifest) || manifest.schemaVersion !== ENRICHMENT_SCHEMA) fail('schema-version');
  if (manifest?.demoManifestDigest !== stagedDigest) fail('manifest-digest-mismatch');
  if (typeof text !== 'string' || sha256(text) !== manifest?.checksums?.['enrichment.jsonl']) fail('checksum-mismatch');
  const ids = new Set(records.map((row) => row.configurationId));
  if (typeof text === 'string') {
    for (const line of text.split('\n').filter(Boolean)) {
      let entry; try { entry = JSON.parse(line); } catch { fail('jsonl-malformed'); continue; }
      if (!object(entry) || typeof entry.configurationId !== 'string') { fail('entry-malformed'); continue; }
      if (!ids.has(entry.configurationId)) fail('foreign-configuration');
      if (entries.has(entry.configurationId)) fail('duplicate-entry');
      if (entry.demoManifestDigest !== stagedDigest) fail('entry-digest-mismatch');
      validEnrichmentEntry(entry, errors);
      entries.set(entry.configurationId, entry); list.push(entry);
    }
  }
  const counts = countEnrichmentEntries(list);
  if (!errors.length && JSON.stringify(manifest.counts) !== JSON.stringify(counts)) fail('count-mismatch');
  const perHost = manifest?.requests?.perHost;
  if (!errors.length && !(object(perHost) && Object.values(perHost).every((n) => Number.isSafeInteger(n) && n >= 0))) fail('requests-malformed');
  const valid = errors.length === 0;
  return { entries: valid ? entries : new Map(), summary: { path: ENRICHMENT_DIR, present: true, valid, errors,
    demoManifestDigest: manifest?.demoManifestDigest ?? null, checksum: manifest?.checksums?.['enrichment.jsonl'] ?? null,
    counts: valid ? counts : null, requests: valid ? structuredClone(manifest.requests) : null } };
}

/** Score retained headless results: an entry counts only for a staged record whose deep link equals its url; pass is recomputed. */
export function scoreRoundTrips(evidence, links, required) {
  const outcomes = new Map();
  for (const entry of Array.isArray(evidence?.results) ? evidence.results : []) {
    if (!object(entry) || links.get(entry.configurationId) !== entry.url || outcomes.has(entry.configurationId)) continue;
    outcomes.set(entry.configurationId, entry.constructible === true && Array.isArray(entry.missing) && Array.isArray(entry.extra)
      && entry.missing.length === 0 && entry.extra.length === 0);
  }
  const passed = [...outcomes.values()].filter(Boolean).length;
  return { counts: { required, passed, failed: outcomes.size - passed, notRun: Math.max(0, required - outcomes.size) },
    outcomes: Object.fromEntries([...outcomes].map(([id, ok]) => [id, ok ? 'pass' : 'fail'])) };
}

const repoPath = (value, root = REPO_ROOT) => {
  if (typeof value !== 'string' || !value) return null;
  if (isAbsolute(value)) return value;
  const base = resolve(root); const path = resolve(base, value);
  return value.split(/[\\/]/).includes('..') || !path.startsWith(base + sep) ? null : path;
};

/** Reuse F54's bounded schema/hash validator, never select or mutate a runtime corpus. */
export async function verifyStagedDemoFleet({ plan, matrixText, directory, minimumDistinct = 200, verifyEvidence,
  policyService, policyRead, approvedImages, retainedCounts = {}, root = REPO_ROOT, roundTripEvidence, enrichmentEvidence } = {}) {
  const planReport = validateDemoPlan(plan, { matrixText, verifyEvidence });
  const pending = { status: 'incomplete', plan: planReport, acceptanceComplete: false,
    acceptedDemoConfigurations: 0, unverifiedGates: [...UNVERIFIED_DEMO_GATES] };
  if (!planReport.valid) return { ...pending, status: 'invalid' };
  if (!planReport.mappedReady) return pending;
  const staged = repoPath(directory, root);
  if (!staged) return { ...pending, failure: { code: 'staged-directory-required' } };
  const { validateCorpusDirectory } = await import('../../server/gcsp/vehicle-evidence/corpus-publisher.js');
  const loaded = await validateCorpusDirectory(staged, { policyService, policyRead, approvedImages });
  if (loaded.status !== 'ok') return { ...pending, status: 'invalid', failure: { code: loaded.failure?.code || 'invalid-corpus' } };
  const records = loaded.corpus.configurations;
  const identity = verifyFleetIdentity({ records, manifest: loaded.manifest, minimumDistinct });
  const coverage = verifyFleetCoverage({ records, plan, planReport, retainedCounts });
  const mappings = new Map(plan.modelLines.filter((line) => line.mapping.status === 'mapped')
    .flatMap((line) => lineModels(line).map((model) => [model.vgModelCode, model.modelRange])));
  let linksBuilt = 0; let linksInvalid = 0; const sample = []; const links = new Map();
  for (const row of records) {
    try {
      const url = configurationDeepLink(row, { modelRange: mappings.get(row.canonicalIdentity?.vgModelCode) });
      linksBuilt++; links.set(row.configurationId, url); if (sample.length < 3) sample.push(url);
    } catch { linksInvalid++; }
  }
  const sidecarEvidence = enrichmentEvidence !== undefined ? enrichmentEvidence : await readEnrichmentEvidence(root);
  const enrichment = scoreEnrichment(sidecarEvidence, records, loaded.manifestDigest);
  const facts = countOtdFacts(records, loaded.manifest, enrichment.entries);
  const imaged = new Set(loaded.corpus.images.map((item) => item.configurationId));
  const sidecarRendered = new Set([...enrichment.entries].filter(([, entry]) => entry.imageReferences.length > 0).map(([id]) => id));
  const hasRender = (row) => imaged.has(row.configurationId) || row.imageIds.length > 0 || sidecarRendered.has(row.configurationId);
  const images = { rows: loaded.corpus.images.length, sidecarReferenceRows: sidecarRendered.size,
    configurationsWithImage: records.filter(hasRender).length };
  images.configurationsWithoutImage = records.length - images.configurationsWithImage;
  const supplements = new Map((loaded.manifest.technicalSupplements || []).map((item) => [item.configurationId, item]));
  const recordObserved = (row) => ['acceleration', 'seats', 'luggageNormal'].every((name) => {
    const fact = row.catalogue?.facts?.[name]?.state === 'known' ? row.catalogue.facts[name] : supplements.get(row.configurationId)?.facts?.[name];
    return fact?.state === 'known' && fact.provenance?.kind === 'observed' && typeof fact.provenance.source === 'string' && date(fact.provenance.observedDate);
  });
  const entryOf = (row) => enrichment.entries.get(row.configurationId);
  const observedRows = records.filter((row) => entryOf(row)?.observation === 'observed').length;
  const rejectedRows = records.filter((row) => entryOf(row)?.observation === 'rejected').length;
  // A row the sidecar marks not registrable is covered only when the published record itself carries observed OTD facts.
  const recordCovered = records.filter((row) => entryOf(row)?.observation === 'not-observed' && entryOf(row).reason?.startsWith('not-registrable:')
    && recordObserved(row)).length;
  const factsSatisfied = records.filter((row) => entryOf(row)?.observation === 'observed'
    || entryOf(row)?.observation === 'not-observed' && entryOf(row).reason?.startsWith('not-registrable:') && recordObserved(row)).length;
  const factTotals = Object.values(facts).reduce((sum, item) => ({ known: sum.known + item.known, unknown: sum.unknown + item.unknown }),
    { known: 0, unknown: 0 });
  const factsAndImagesClosed = enrichment.summary.valid === true && records.length > 0
    && factsSatisfied === records.length && images.configurationsWithImage === records.length;
  enrichment.summary.gate = { closed: factsAndImagesClosed, stagedRows: records.length, observedRows, rejectedRows, recordCoveredRows: recordCovered,
    factsSatisfiedRows: factsSatisfied, factsKnown: factTotals.known, factsUnknown: factTotals.unknown, rowsWithExteriorRender: images.configurationsWithImage };
  const required = plan.requirements.minimumDeepLinkChecks;
  const evidence = roundTripEvidence !== undefined ? roundTripEvidence
    : await readFile(resolve(root, ROUND_TRIPS_PATH), 'utf8').then(JSON.parse, () => null);
  const { counts: roundTrips, outcomes: roundTripResults } = scoreRoundTrips(evidence, links, required);
  const openGates = [
    ...(roundTrips.notRun > 0 ? [{ gate: 'headless-round-trips',
      detail: `${roundTrips.notRun} of ${required} not run; pass ${roundTrips.passed}, fail ${roundTrips.failed}` }] : []),
    ...(factsAndImagesClosed ? [] : [{ gate: 'facts-and-images',
      detail: `${enrichment.summary.present ? 'sidecar' : 'no sidecar'}: facts satisfied ${factsSatisfied} of ${records.length} rows `
        + `(observed ${observedRows}, record-covered ${recordCovered}, rejected ${rejectedRows}); `
        + `five OTD facts known ${factTotals.known}, unknown ${factTotals.unknown}; exterior renders ${images.configurationsWithImage} of ${records.length}` }]),
    ...(enrichment.summary.valid === false ? [{ gate: 'enrichment-sidecar-invalid', detail: enrichment.summary.errors.join(', ') }] : []),
    ...(planReport.gaps.length ? [{ gate: 'pending-model-lines', detail: `${planReport.gaps.length} lines have no mapping` }] : []),
    ...(coverage.coverageGaps?.length ? [{ gate: 'coverage-gaps', detail: `${coverage.coverageGaps.length} mapped lines have no local rows` }] : []),
  ];
  const offlineProven = identity.identityValid && identity.manifestValid === true && identity.countsValid
    && coverage.localPerLineValid === true && coverage.unassignedConfigurations === 0 && coverage.invalidConfigurations === 0
    && linksInvalid === 0 && linksBuilt === records.length;
  const status = !(identity.identityValid && identity.manifestValid) || enrichment.summary.valid === false ? 'invalid'
    : offlineProven ? 'verified-offline' : 'incomplete';
  return { ...pending, status, identity, coverage, deepLinks: { built: linksBuilt, invalid: linksInvalid, sample }, roundTrips, roundTripResults,
    facts, images, enrichment: enrichment.summary, openGates, stagedManifestDigest: loaded.manifestDigest };
}

/** Demo-plan CLI path of verify-fleet.mjs; returns 1 for invalid, 2 while gates stay open, 0 when the offline proof holds. */
export async function demoVerifierCli(args, write = (value) => process.stdout.write(value)) {
  const parsed = {}; const flags = new Set(['--staged']);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (flags.has(key)) { if (parsed[key]) throw new Error(); parsed[key] = true; continue; }
    if (!['--config', '--directory', '--require-distinct'].includes(key) || parsed[key] || !args[index + 1]
      || args[index + 1].startsWith('--')) throw new Error();
    parsed[key] = args[++index];
  }
  if (!parsed['--config'] || !parsed['--staged']) throw new Error();
  const minimumDistinct = parsed['--require-distinct'] === undefined ? 200 : Number(parsed['--require-distinct']);
  if (!Number.isSafeInteger(minimumDistinct) || minimumDistinct < 200) throw new Error();
  const plan = JSON.parse(await readFile(resolve(parsed['--config']), 'utf8'));
  const matrixText = await readFile(resolve(REPO_ROOT, MATRIX_PATH), 'utf8');
  const { createPolicyService } = await import('../../server/gcsp/policy/index.js');
  const { APPROVED_CORPUS_IMAGES } = await import('../../server/gcsp/vehicle-evidence/registered-corpus-images.js');
  let retainedCounts = {};
  try {
    const coverage = JSON.parse(await readFile(resolve(REPO_ROOT, FUCQ61_COVERAGE), 'utf8'));
    retainedCounts = Object.fromEntries(coverage.final10351Dimensions.vgModelCode.map((item) => [item.value, item.count]));
  } catch { /* Missing retained counts only leave the gap table without historical numbers. */ }
  const report = await verifyStagedDemoFleet({ plan, matrixText, retainedCounts,
    directory: parsed['--directory'] ? resolve(parsed['--directory']) : plan.publication?.stagedDirectory,
    minimumDistinct, policyService: createPolicyService(), approvedImages: APPROVED_CORPUS_IMAGES,
    policyRead: { runId: 'demo-verification', asOf: `${plan.qualificationDate}T12:00:00.000Z` } });
  write(`${JSON.stringify(report, null, 2)}\n`);
  // Exit 0 means the offline proof holds; round trips, enrichment and pending lines keep acceptanceComplete false.
  return report.status === 'invalid' ? 1 : report.status === 'verified-offline' ? 0 : 2;
}
