import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATRIX_PATH, validateDemoPlan } from './demo-plan.mjs';

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

/** Audit the existing F54 shape; solver/enrichment evidence belongs in the canonical producers. */
function auditIdentity(row) {
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

/** Count exact mapped identities without treating cached/provenance copies as more configurations. */
export function verifyFleetCoverage({ records, plan, matrixText, verifyEvidence } = {}) {
  const planReport = validateDemoPlan(plan, { matrixText, verifyEvidence });
  const pending = { planReady: planReport.ready, perLineValid: false, totalValid: false, coverageValid: false,
    distinctCount: 0, perLineCounts: {}, unassignedConfigurations: 0, acceptedDemoConfigurations: 0 };
  if (!planReport.ready || !Array.isArray(records)) return pending;
  const mapped = plan.modelLines.filter((line) => line.mapping.status === 'mapped');
  const key = (value) => `${value.modelRange}:${value.vgModelCode}:${value.agModelCode}`;
  const ownership = new Map(mapped.map((line) => [key(line.mapping), line.id]));
  const perLine = new Map(mapped.map((line) => [line.id, new Set()])); const distinct = new Set();
  let invalid = 0; let unassignedConfigurations = 0;
  for (const row of records) {
    const audited = auditIdentity(row);
    if (audited.errors.length) { invalid++; continue; }
    const lineId = ownership.get(key(audited));
    if (!lineId) { unassignedConfigurations++; continue; }
    perLine.get(lineId).add(audited.signature); distinct.add(audited.signature);
  }
  const perLineCounts = Object.fromEntries([...perLine].map(([id, signatures]) => [id, signatures.size]));
  const perLineValid = Object.values(perLineCounts).every((count) => count >= plan.requirements.minimumPerMappedLine);
  const totalValid = distinct.size >= plan.requirements.minimumDistinct;
  return { ...pending, perLineValid, totalValid, distinctCount: distinct.size, perLineCounts, unassignedConfigurations,
    coverageValid: perLineValid && totalValid && invalid === 0 && unassignedConfigurations === 0 };
}

/** Generate a route from audited identity; this does not assert today's browser round-trip. */
export function configurationDeepLink(row) {
  const audited = auditIdentity(row);
  if (audited.errors.length) throw new Error('Cannot form a configurator link from an invalid configuration identity.');
  return `https://configure.bmw.co.uk/en_GB/configure/${audited.modelRange}/${audited.vgModelCode}/${audited.options.join(',')}`;
}

/** Reuse F54's bounded schema/hash validator, never select or mutate a runtime corpus. */
export async function verifyStagedFleet({ plan, matrixText, directory, minimumDistinct = 200,
  verifyEvidence, policyService, policyRead, approvedImages } = {}) {
  const planReport = validateDemoPlan(plan, { matrixText, verifyEvidence });
  const pending = { status: 'incomplete', plan: planReport, acceptanceComplete: false,
    acceptedDemoConfigurations: 0, unverifiedGates: [...UNVERIFIED_DEMO_GATES] };
  if (!planReport.valid) return { ...pending, status: 'invalid' };
  if (!planReport.ready) return pending;
  if (typeof directory !== 'string' || !isAbsolute(directory)) return { ...pending, failure: { code: 'staged-directory-required' } };
  const { validateCorpusDirectory } = await import('../../server/gcsp/vehicle-evidence/corpus-publisher.js');
  const loaded = await validateCorpusDirectory(directory, { policyService, policyRead, approvedImages });
  if (loaded.status !== 'ok') return { ...pending, status: 'invalid', failure: { code: loaded.failure?.code || 'invalid-corpus' } };
  const identity = verifyFleetIdentity({ records: loaded.corpus.configurations, manifest: loaded.manifest, minimumDistinct });
  const coverage = verifyFleetCoverage({ records: loaded.corpus.configurations, plan, matrixText, verifyEvidence });
  return { ...pending, status: identity.identityValid && identity.manifestValid ? 'incomplete' : 'invalid',
    identity, coverage, stagedManifestDigest: loaded.manifestDigest };
}

async function main(args) {
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
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const plan = JSON.parse(await readFile(resolve(parsed['--config']), 'utf8'));
  const matrixText = await readFile(resolve(root, MATRIX_PATH), 'utf8');
  const report = await verifyStagedFleet({ plan, matrixText,
    directory: parsed['--directory'] ? resolve(parsed['--directory']) : plan.publication?.stagedDirectory, minimumDistinct });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // Source/producer/browser/publication proof remains incomplete; never stamp this as full acceptance.
  process.exitCode = report.status === 'invalid' ? 1 : 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write('Fleet verification unavailable. Use --config <plan.json> --staged --require-distinct 200; values are not echoed.\n');
    process.exitCode = 1;
  });
}
