import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_PATH, validateDemoPlan } from './demo-plan.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FUCQ61_COVERAGE = 'docs/gcsp/evidence/fucq61/exact10000-closeout-2026-11-07/coverage.json';
export const ROUND_TRIPS_PATH = 'docs/gcsp/evidence/fucq77/round-trips-2026-11-08/round-trips.json';

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

// The five OTD facts and the record field that carries each; absent fields stay unknown, never inferred.
const OTD_FACTS = Object.freeze({ acceleration: ['acceleration'], seats: ['seats'], boot: ['luggageNormal'], rangeOrEconomy: [], co2: [] });

/** Count known versus unknown OTD facts, using the record's own states and any registered technical supplement. */
export function countOtdFacts(records, manifest = {}) {
  const supplements = new Map((manifest.technicalSupplements || []).map((item) => [item.configurationId, item]));
  const result = Object.fromEntries(Object.keys(OTD_FACTS).map((name) => [name, { known: 0, unknown: 0 }]));
  for (const row of records) {
    for (const [name, fields] of Object.entries(OTD_FACTS)) {
      const isKnown = fields.some((field) => row.catalogue?.facts?.[field]?.state === 'known'
        || supplements.get(row.configurationId)?.facts?.[field]?.state === 'known');
      result[name][isKnown ? 'known' : 'unknown']++;
    }
  }
  return result;
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
  policyService, policyRead, approvedImages, retainedCounts = {}, root = REPO_ROOT, roundTripEvidence } = {}) {
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
  const facts = countOtdFacts(records, loaded.manifest);
  const imaged = new Set(loaded.corpus.images.map((item) => item.configurationId));
  const images = { rows: loaded.corpus.images.length,
    configurationsWithImage: records.filter((row) => imaged.has(row.configurationId) || row.imageIds.length > 0).length };
  images.configurationsWithoutImage = records.length - images.configurationsWithImage;
  const required = plan.requirements.minimumDeepLinkChecks;
  const evidence = roundTripEvidence !== undefined ? roundTripEvidence
    : await readFile(resolve(root, ROUND_TRIPS_PATH), 'utf8').then(JSON.parse, () => null);
  const { counts: roundTrips, outcomes: roundTripResults } = scoreRoundTrips(evidence, links, required);
  const openGates = [
    ...(roundTrips.notRun > 0 ? [{ gate: 'headless-round-trips',
      detail: `${roundTrips.notRun} of ${required} not run; pass ${roundTrips.passed}, fail ${roundTrips.failed}` }] : []),
    { gate: 'facts-and-images', detail: 'facts unknown counts and image coverage are listed; enrichment not run' },
    ...(planReport.gaps.length ? [{ gate: 'pending-model-lines', detail: `${planReport.gaps.length} lines have no mapping` }] : []),
    ...(coverage.coverageGaps?.length ? [{ gate: 'coverage-gaps', detail: `${coverage.coverageGaps.length} mapped lines have no local rows` }] : []),
  ];
  const offlineProven = identity.identityValid && identity.manifestValid === true && identity.countsValid
    && coverage.localPerLineValid === true && coverage.unassignedConfigurations === 0 && coverage.invalidConfigurations === 0
    && linksInvalid === 0 && linksBuilt === records.length;
  const status = !(identity.identityValid && identity.manifestValid) ? 'invalid' : offlineProven ? 'verified-offline' : 'incomplete';
  return { ...pending, status, identity, coverage, deepLinks: { built: linksBuilt, invalid: linksInvalid, sample }, roundTrips, roundTripResults,
    facts, images, openGates, stagedManifestDigest: loaded.manifestDigest };
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
