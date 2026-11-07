#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCorpusDirectory, readCorpusFile, contentChecksum } from '../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createPolicyService } from '../../server/gcsp/policy/index.js';
import { createConfigurationKey } from './configuration-key.mjs';

const limitations = Object.freeze([
  'Compatible profile-family coverage is not inferred from configuration IDs or VIN spelling.',
  'Staged verification does not establish source-operation budgets, collection replay or full story acceptance.',
  'Unknown measurements, missing images and representative image fidelity remain explicit; no stock, eligibility or points facts are inferred.',
]);
const invalid = (reason, manifest = null) => ({ status: 'invalid-staged', targetMet: false, storyAcceptance: 'not-established',
  manifest, actual: null, shortfall: null, reason, limitations });
const count = (rows, select) => {
  const counts = new Map();
  for (const row of rows) { const key = select(row) ?? 'unknown'; counts.set(key, (counts.get(key) || 0) + 1); }
  // Fixed domain limit keeps CLI output bounded even for adversarial model/option names.
  const ordered = [...counts].sort(([a], [b]) => String(a).localeCompare(String(b)));
  return { values: Object.fromEntries(ordered.slice(0, 128)), omittedCategories: Math.max(0, ordered.length - 128) };
};
const boundedText = (value) => typeof value === 'string' ? value.slice(0, 512) : null;
const complete = (row) => row.sourceContext.sourceKind === 'dated-snapshot'
  && row.canonicalIdentity.provenance.kind === 'observed'
  && row.sourceContext.selectedOptionCompleteness === 'complete'
  && (row.catalogue?.completeness?.selectedConfiguration === 'complete' || row.catalogue?.completeness?.factorySelection === 'complete');

/** Read-only consumer of the single corpus validator; never packages, selects or activates a corpus. */
export async function verifyStagedFleet({ artifacts, requiredDistinct = 10000, plan = null, ...options } = {}) {
  if (typeof artifacts !== 'string' || !isAbsolute(artifacts)) return invalid({ code: 'explicit-path-required', message: 'Supply an absolute staged artifact directory.' });
  if (!Number.isSafeInteger(requiredDistinct) || requiredDistinct < 1 || requiredDistinct > 100000) return invalid({ code: 'invalid-target', message: 'Required distinct count must be an integer from 1 to 100000.' });
  const manifestPath = join(artifacts, 'manifest.json');
  const checked = await validateCorpusDirectory(artifacts, options);
  if (checked.status !== 'ok') {
    let sha256 = null;
    try { sha256 = contentChecksum(await readCorpusFile(artifacts, 'manifest.json')); } catch { /* Missing/unreadable manifests have no digest. */ }
    return invalid(checked.failure, { path: manifestPath, sha256 });
  }
  const { manifest, configurations, vins, images } = checked.corpus;
  const selectedManifest = { path: manifestPath, sha256: checked.manifestDigest, datasetId: manifest.datasetId, version: manifest.version,
    schemaVersion: manifest.schemaVersion, signaturePolicyVersion: manifest.signaturePolicy.policyVersion,
    profileRegistryVersion: manifest.profileRegistryVersion, generatorVersion: manifest.generatorVersion };
  try {
    const key = await createConfigurationKey({ ...options, policyRead: { ...options.policyRead, policyVersion: manifest.signaturePolicy.policyVersion } });
    const distinct = new Set(); const qualifying = new Set(); const optionCounts = [];
    for (const row of configurations) {
      const { agModelCode, ...canonicalIdentity } = row.canonicalIdentity;
      const identity = key({ ...canonicalIdentity, ...(agModelCode === null ? {} : { agModelCode }) });
      if (identity.configurationId !== row.configurationId || distinct.has(identity.configurationId)) {
        return invalid({ code: 'semantic-identity-mismatch', message: 'Every staged canonical identity must match the recomputed unique factory-selection key.' }, selectedManifest);
      }
      distinct.add(identity.configurationId);
      if (complete(row)) qualifying.add(identity.configurationId);
      optionCounts.push({ count: identity.canonicalIdentity.factoryOptionCodes.length });
    }
    const distributions = Object.fromEntries(['model', 'body', 'powertrain'].map((field) => [field, count(configurations, (row) => row.configuration[field])]));
    distributions.factoryOptionCount = count(optionCounts, (row) => String(row.count));
    distributions.sourceKind = count(configurations, (row) => row.sourceContext.sourceKind);
    distributions.unresolvedFacts = count(configurations.flatMap((row) => row.sourceContext.unresolvedFacts), (field) => field);
    distributions.imageFidelity = count(images, (row) => row.fidelity);
    const plannedFamilies = Array.isArray(plan?.families) ? plan.families.filter((family) => family && typeof family === 'object') : [];
    const coverage = {}; const omittedCoverageCategories = {};
    for (const [field, values] of Object.entries(manifest.coverage)) {
      const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
      coverage[field] = Object.fromEntries(entries.slice(0, 128));
      omittedCoverageCategories[field] = Math.max(0, entries.length - 128);
    }
    const planned = { provided: Boolean(plan), familyCount: plannedFamilies.length, families: plannedFamilies.slice(0, 128).map((family) => ({
      familyId: boundedText(family.familyId), plannedCount: Number.isSafeInteger(family.plannedCount) ? family.plannedCount : null,
      actualModelMarketDistinct: configurations.filter((row) => row.configuration.market === family.context?.market
        && row.configuration.vgModelCode === (family.context?.vgModelCode ?? family.context?.modelCode)).length,
      profileId: boundedText(family.profileId), wmi: boundedText(family.wmi),
    })), omittedFamilies: Math.max(0, plannedFamilies.length - 128), exclusions: (Array.isArray(plan?.coverage?.exclusions) ? plan.coverage.exclusions : []).slice(0, 128)
      .map((entry) => ({ scope: boundedText(entry?.scope), reason: boundedText(entry?.reason) })) };
    const shortfall = Math.max(0, requiredDistinct - qualifying.size); const targetMet = shortfall === 0;
    return { status: targetMet ? 'verified-staged' : 'shortfall', targetMet, storyAcceptance: 'not-established',
      requiredDistinct, shortfall, reason: targetMet ? null : { code: 'distinct-target-shortfall', message: 'Complete resolved source configurations remain below the required distinct target.' },
      manifest: selectedManifest, qualification: manifest.qualification,
      actual: { ...manifest.counts, distinctConfigurations: distinct.size, completeResolvedDistinct: qualifying.size,
        nonQualifyingConfigurations: configurations.length - qualifying.size, coverage, omittedCoverageCategories,
        completeness: manifest.completeness, distributions, vinMappings: vins.length }, planned, limitations };
  } catch (error) {
    return invalid({ code: error.code || 'semantic-audit-unavailable', message: 'Canonical factory-selection audit failed; no staged corpus was selected.' }, selectedManifest);
  }
}
export const verifyFleet = verifyStagedFleet;

/** Only explicit staged/offline flags are supported. Active/HTTP verification belongs to FUCQ-63. */
export async function verifyFleetCli(argv = process.argv.slice(2), write = (value) => process.stdout.write(value)) {
  const fail = (code, message) => { write(JSON.stringify(invalid({ code, message })) + '\n'); return 2; };
  const values = new Map(); const valued = new Set(['--config', '--artifacts', '--require-distinct', '--run-id', '--as-of']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (values.has(flag) || (flag !== '--staged' && !valued.has(flag))) return fail('unsupported-arguments', 'Use --staged with --config or --artifacts; active/HTTP verification is unsupported.');
    if (flag === '--staged') values.set(flag, true);
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) return fail('unsupported-arguments', 'Each option needs an explicit value.'); values.set(flag, argv[++i]); }
  }
  if (!values.has('--staged')) return fail('staged-required', 'Explicit --staged verification is required.');
  let plan = null;
  if (values.has('--config')) {
    try { plan = JSON.parse(await readFile(resolve(values.get('--config')), 'utf8')); }
    catch { return fail('config-unavailable', 'Read a valid explicit plan JSON file.'); }
  }
  // No plan destination means no implicit active-store discovery or source run.
  const artifacts = values.get('--artifacts') || plan?.destinations?.staged?.path;
  if (!artifacts) return fail('staged-destination-required', 'The plan has no selected staged corpus destination; supply --artifacts with an absolute directory.');
  const requiredDistinct = values.has('--require-distinct') ? (/^[1-9][0-9]*$/.test(values.get('--require-distinct')) ? Number(values.get('--require-distinct')) : NaN) : 10000;
  const report = await verifyStagedFleet({ artifacts, requiredDistinct, plan, policyService: createPolicyService(),
    policyRead: { runId: values.get('--run-id') || 'fleet-staged-verification', asOf: values.get('--as-of') || new Date().toISOString() } });
  write(JSON.stringify(report) + '\n'); return report.status === 'verified-staged' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await verifyFleetCli();
