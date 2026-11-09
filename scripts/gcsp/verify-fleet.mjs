#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createSyntheticRegistry } from '../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { createConfiguredVehicleDetails } from '../../server/gcsp/vehicle-evidence/application-vehicle-details.js';
import { vehicleEvidenceHttpStatus } from '../../server/gcsp/vehicle-evidence/vehicle-details-contract.js';
import { installFleetOfflineGuard } from './fleet-offline-guard.mjs';
import { validateCorpusDirectory, readCorpusFile, contentChecksum } from '../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createPolicyService } from '../../server/gcsp/policy/index.js';
import { APPROVED_CORPUS_IMAGES } from '../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { createConfigurationKey } from './configuration-key.mjs';
import { demoVerifierCli } from './demo-verifier.mjs';

export { UNVERIFIED_DEMO_GATES, verifyFleetIdentity, verifyFleetCoverage, configurationDeepLink, verifyStagedDemoFleet } from './demo-verifier.mjs';

const limitations = Object.freeze([
  'Compatible profile-family coverage is not inferred from configuration IDs or VIN spelling.',
  'Staged verification does not establish source-operation budgets, collection replay or full story acceptance.',
  'Unknown measurements, missing images and representative image fidelity remain explicit; no stock, eligibility or points facts are inferred.',
]);
const invalid = (reason, manifest = null) => ({ status: 'invalid-staged', targetMet: false, storyAcceptance: 'not-established',
  manifest, actual: null, shortfall: null, reason, limitations });
const increment = (counts, value) => { const key = value ?? 'unknown'; counts.set(key, (counts.get(key) || 0) + 1); };
const boundedCounts = (counts) => {
  // Fixed domain limit keeps CLI output bounded even for adversarial model/option names.
  const ordered = [...counts].sort(([a], [b]) => String(a).localeCompare(String(b)));
  return { values: Object.fromEntries(ordered.slice(0, 128)), omittedCategories: Math.max(0, ordered.length - 128) };
};
const count = (rows, select) => { const counts = new Map(); for (const row of rows) increment(counts, select(row)); return boundedCounts(counts); };
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
  const checked = await validateCorpusDirectory(artifacts, { ...options, indexed: true });
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
    const distinct = new Set(); const qualifying = new Set(); const familyCounts = new Map();
    const groups = Object.fromEntries(['model', 'body', 'powertrain', 'factoryOptionCount', 'sourceKind', 'unresolvedFacts'].map((name) => [name, new Map()]));
    for (const row of configurations) {
      const { agModelCode, ...canonicalIdentity } = row.canonicalIdentity;
      const identity = key({ ...canonicalIdentity, ...(agModelCode === null ? {} : { agModelCode }) });
      if (identity.configurationId !== row.configurationId || distinct.has(identity.configurationId)) {
        return invalid({ code: 'semantic-identity-mismatch', message: 'Every staged canonical identity must match the recomputed unique factory-selection key.' }, selectedManifest);
      }
      distinct.add(identity.configurationId);
      if (complete(row)) qualifying.add(identity.configurationId);
      for (const field of ['model', 'body', 'powertrain']) increment(groups[field], row.configuration[field]);
      increment(groups.factoryOptionCount, String(identity.canonicalIdentity.factoryOptionCodes.length));
      increment(groups.sourceKind, row.sourceContext.sourceKind);
      for (const field of row.sourceContext.unresolvedFacts) increment(groups.unresolvedFacts, field);
      increment(familyCounts, JSON.stringify([row.configuration.market, row.configuration.vgModelCode]));
    }
    const distributions = Object.fromEntries(Object.entries(groups).map(([name, counts]) => [name, boundedCounts(counts)]));
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
      actualModelMarketDistinct: familyCounts.get(JSON.stringify([family.context?.market, family.context?.vgModelCode ?? family.context?.modelCode])) || 0,
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

const activeFailure = (code, message) => ({ ...invalid({ code, message }), status: 'invalid-active' });
function localEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url : null;
  } catch { return null; }
}
function latency(values) {
  const sorted = [...values].sort((a, b) => a - b); const nth = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
  return { count: sorted.length, min: sorted[0] ?? null, p50: nth(0.5), p95: nth(0.95), p99: nth(0.99), max: sorted.at(-1) ?? null };
}
async function boundedWorkers(items, concurrency, visit) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = cursor++; if (index >= items.length) return; await visit(items[index], index); }
  }));
}
function matchesRetained(result, record, images, manifestDigest, supplement) {
  if (!['partial', 'complete'].includes(result?.status) || !record) return false;
  const source = record.sourceContext; const catalogue = record.catalogue; const configuration = record.configuration;
  return result.identity?.configurationId === record.configurationId && result.versions?.manifestDigest === manifestDigest
    && result.versions.snapshot === record.snapshotVersion
    && [['model', 'model'], ['derivative', 'derivative'], ['generation', 'generation'], ['bodyType', 'body']]
      .every(([field, stored]) => result.description?.[field]?.value === configuration[stored])
    && [['fuel', 'powertrain'], ['drive', 'drive'], ['transmission', 'transmission'], ['engine', 'engineCode']]
      .every(([field, stored]) => result.description?.powertrain?.[field]?.value === configuration[stored])
    && ['market', 'region', 'steering', 'agModelCode', 'vgModelCode', 'modelYear', 'productionEra', 'productionDate']
      .every((field) => result.source?.[field] === configuration[field])
    && result.source?.kind === source.sourceKind
    && result.source.observedDate === source.observedDate && result.source.catalogueDate === source.catalogueDate
    && isDeepStrictEqual(result.source.configurationIdentity, record.canonicalIdentity)
    && isDeepStrictEqual(result.source.references, source.sourceRefs)
    && isDeepStrictEqual(result.source.unresolvedFacts, source.unresolvedFacts)
    && result.completeness?.selectedOptions === source.selectedOptionCompleteness
    && (catalogue ? isDeepStrictEqual(result.equipment?.selected?.options, record.canonicalIdentity.factoryOptionCodes)
      : result.equipment?.selected?.state === 'unknown')
    && (!catalogue || Object.entries({ ...catalogue.facts, ...supplement?.facts }).every(([key, fact]) => isDeepStrictEqual(result.technical?.[key], fact)))
    && isDeepStrictEqual((result.images?.items || []).map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })), images.map(({ imageId, asset, role, fidelity, sourceKind, observedDate }) =>
      ({ imageId, asset, role, fidelity, sourceKind, observedDate })))
    && result.presentation?.syntheticLabel === 'Synthetic identity' && result.presentation?.unknownLabel === 'Unknown'
    && result.presentation?.sourceLabel === (source.sourceKind === 'dated-snapshot' ? 'Dated catalogue snapshot' : 'North American structural reference')
    && result.routing?.mode === 'offline' && result.routing.liveEligible === false;
}
function localHttpRead(endpoint, request) {
  const collection = { configuration: 'configurations', vin: 'vins', stock: 'stock' }[request.kind];
  const url = new URL(`/api/gcsp/vehicle-evidence/${collection}/${encodeURIComponent(request.id)}`, endpoint);
  return new Promise((resolve, reject) => {
    const headers = process.env.DEMO_ACCESS_KEY ? { 'X-Access-Key': process.env.DEMO_ACCESS_KEY } : {};
    const req = httpRequest(url, { headers }, (response) => {
      let content = ''; let size = 0;
      response.setEncoding('utf8'); response.on('data', (part) => {
        size += Buffer.byteLength(part); if (size > 2 * 1024 * 1024) req.destroy(new Error('Local response exceeds audit bound.')); else content += part;
      });
      response.on('error', reject); response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(content) }); } catch { reject(new Error('Invalid local HTTP response.')); }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Local HTTP audit deadline.'))); req.on('error', reject); req.end();
  });
}

/** Reads the actual published store; all publication/recovery mutations belong to separate owned regression fixtures. */
export async function verifyActiveFleet({ root, requiredDistinct = 10000, http = false, endpoint, offline = false,
  concurrency = 1, sampleSize = 128, repository, context, stockReferences = [], ...options } = {}) {
  if (typeof root !== 'string' || !isAbsolute(root)) return activeFailure('explicit-store-required', 'Supply an absolute published corpus store.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 1024
    || !Array.isArray(stockReferences) || stockReferences.length > 100000 || new Set(stockReferences).size !== stockReferences.length || !stockReferences.every((id) => typeof id === 'string' && id.length <= 128)) {
    return activeFailure('invalid-audit-bounds', 'Use 1–8 workers, 1–1024 HTTP samples and explicit bounded stock order references.');
  }
  if (offline !== true) return activeFailure('offline-required', 'Active audit requires explicit offline instrumentation.');
  const bind = http ? localEndpoint(endpoint) : null;
  if (http && !bind) return activeFailure('loopback-endpoint-required', 'Supply an explicit numeric loopback HTTP bind endpoint, for example http://127.0.0.1:0.');
  let guard; let server; let result; let sourceCalls = 0;
  try {
    guard = installFleetOfflineGuard(); const control = guard.control();
    const registry = createSyntheticRegistry({ root, ...options }); const loaded = await registry.load(); const active = registry.status().active;
    if (!active) return activeFailure('active-corpus-unavailable', 'No validated active or recovered corpus is available.');
    const artifacts = join(root, 'versions', active.manifestDigest);
    const staged = await verifyStagedFleet({ artifacts, requiredDistinct, ...options });
    if (staged.status === 'invalid-staged') return { ...staged, status: 'invalid-active' };
    const checked = await validateCorpusDirectory(artifacts, { ...options, indexed: true });
    if (checked.status !== 'ok' || checked.manifestDigest !== active.manifestDigest || staged.manifest.sha256 !== active.manifestDigest) {
      return activeFailure('active-manifest-changed', 'Active loader and actual retained artifact digest must agree.');
    }
    const rows = checked.corpus; const configurations = rows.configurations;
    const imageAssociations = new Map();
    for (const image of rows.images) {
      const references = imageAssociations.get(image.configurationId) || [];
      references.push(image.imageId); imageAssociations.set(image.configurationId, references);
    }
    const lookup = createVehicleEvidenceLookup({ registry, repository });
    const consumer = createConfiguredVehicleDetails({ lookup, timeoutMs: 5000, maxAttempts: 1 });
    const requests = [...rows.configurations.metadataEntries()].map((entry) => ({ kind: 'configuration', id: entry.key }));
    for (const entry of rows.vins.metadataEntries()) requests.push({ kind: 'vin', id: entry.vin17 });
    for (const id of stockReferences) requests.push({ kind: 'stock', id });
    const latencies = []; let errors = 0; const started = performance.now();
    await boundedWorkers(requests, concurrency, async (request) => {
      const start = performance.now();
      const direct = await lookup.resolve(request, { context }); const consumed = await consumer.resolve(request, { context });
      const record = configurations.get(direct.identity?.configurationId);
      const images = [...new Set([...(record?.imageIds || []), ...(imageAssociations.get(record?.configurationId) || [])])]
        .map((id) => rows.images.get(id));
      if (!matchesRetained(direct, record, images, active.manifestDigest, checked.manifest.technicalSupplements?.find(s => s.configurationId === record?.configurationId)) || consumed.status !== direct.status || !consumed.vehicle
        || !isDeepStrictEqual(consumed.vehicle, Object.fromEntries(Object.keys(consumed.vehicle).map((key) => [key, direct[key]])))) errors++;
      latencies.push(performance.now() - start);
    });
    const elapsedMs = performance.now() - started;
    let httpReport = null;
    if (http) {
      const { buildServer } = await import('../../server/index.js');
      const denied = () => { sourceCalls++; throw new Error('Source capability is unavailable during offline audit.'); };
      server = buildServer({ fetchRetailerStock: denied, fetchNearbyStock: denied, enrichColours: denied,
        fetchDealerDirectory: denied, geocodePostcode: denied,
        gcspVehicleEvidence: { lookup, resolveContext: async () => context ? { status: 'ok', value: context } : { status: 'source-unavailable' } } });
      server.listen(Number(bind.port || 80), bind.hostname.replace(/^\[|\]$/g, '')); await once(server, 'listening');
      const actualEndpoint = `http://${bind.hostname}:${server.address().port}`;
      const total = Math.min(sampleSize, requests.length); const samples = Array.from({ length: total }, (_, index) => requests[Math.floor(index * requests.length / total)]);
      const httpLatencies = []; let httpErrors = 0; const httpStart = performance.now();
      await boundedWorkers(samples, concurrency, async (request) => {
        const start = performance.now();
        try {
          const direct = await lookup.resolve(request, { context }); const response = await localHttpRead(actualEndpoint, request);
          if (response.status !== vehicleEvidenceHttpStatus(direct) || !isDeepStrictEqual(response.body, direct)) httpErrors++;
        } catch { httpErrors++; }
        httpLatencies.push(performance.now() - start);
      });
      const httpElapsedMs = performance.now() - httpStart;
      httpReport = { endpoint: actualEndpoint, scope: samples.length === requests.length ? 'all-records' : 'deterministic-even-sample',
        requests: samples.length, totalRecords: requests.length, concurrency, errors: httpErrors, elapsedMs: httpElapsedMs,
        throughputPerSecond: samples.length / (httpElapsedMs / 1000), latencyMs: latency(httpLatencies), serverClosed: false };
    }
    const passed = errors === 0 && (!httpReport || httpReport.errors === 0) && guard.calls.length === 0 && sourceCalls === 0;
    result = { ...staged, status: !passed ? 'invalid-active' : staged.targetMet ? 'verified-active' : 'shortfall',
      targetMet: passed && staged.targetMet, storyAcceptance: 'not-established',
      reason: passed ? staged.reason : { code: 'active-reconciliation-failed', message: 'Actual loaded records, consuming port, HTTP parity or offline boundaries failed.' },
      activeStore: root, activation: { loaderStatus: loaded.status, recovered: loaded.recovered === true },
      audit: { scope: 'all-records', records: { configurations: rows.configurations.length, vinMappings: rows.vins.length, stockReferences: stockReferences.length },
        checked: requests.length, errors, elapsedMs, concurrency, throughputPerSecond: requests.length / (elapsedMs / 1000), latencyMs: latency(latencies),
        environment: { node: process.version, platform: process.platform, arch: process.arch }, stockScope: stockReferences.length ? 'explicit-repository-fixture-or-supplied-references' : 'not-supplied' },
      http: httpReport, egress: { scope: 'this-audit-process', externalCalls: guard.calls.length, sourceCalls, control },
      acceptanceLimits: ['Actual full-target source corpus and declared coverage remain required for story acceptance.',
        'Stock references are supplied through the repository seam; no native PostgreSQL or stock generation proof is inferred.',
        'Restart, activation interruption and rollback are tested in owned fixtures; this command does not mutate the active store.'] };
    return result;
  } catch { return { ...activeFailure('active-audit-unavailable', 'Restore compatible local inputs and retry the bounded offline audit.'),
    egress: guard ? { scope: 'this-audit-process', externalCalls: guard.calls.length, sourceCalls } : null }; }
  finally {
    if (server) {
      server.closeAllConnections(); await new Promise((done) => server.close(done));
      if (result?.http) result.http.serverClosed = true;
    }
    guard?.restore();
  }
}

/** Staged validation and explicit offline active audits share the same corpus port and canonical policy. */
export async function verifyFleetCli(argv = process.argv.slice(2), write = (value) => process.stdout.write(value)) {
  const configAt = argv.indexOf('--config');
  if (configAt >= 0 && argv[configAt + 1]) {
    // FUCQ-77 demo plans carry modelLines; route them to the demo verifier, which keeps its own exit contract.
    let candidate = null;
    try { candidate = JSON.parse(await readFile(resolve(argv[configAt + 1]), 'utf8')); } catch { /* Fall through to the corpus CLI error. */ }
    if (Array.isArray(candidate?.modelLines)) {
      try { return await demoVerifierCli(argv, write); } catch {
        process.stderr.write('Fleet verification unavailable. Use --config <plan.json> --staged --require-distinct 200; values are not echoed.\n');
        return 1;
      }
    }
  }
  const fail = (code, message) => { write(JSON.stringify(invalid({ code, message })) + '\n'); return 2; };
  const values = new Map(); const valued = new Set(['--config', '--artifacts', '--store', '--endpoint', '--require-distinct', '--run-id', '--as-of', '--concurrency', '--sample-size']);
  const flags = new Set(['--staged', '--active', '--http', '--offline']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (values.has(flag) || (!flags.has(flag) && !valued.has(flag))) return fail('unsupported-arguments', 'Use one explicit staged or active verification mode with supported bounded options.');
    if (flags.has(flag)) values.set(flag, true);
    else { if (!argv[i + 1] || argv[i + 1].startsWith('--')) return fail('unsupported-arguments', 'Each option needs an explicit value.'); values.set(flag, argv[++i]); }
  }
  if (values.has('--staged') === values.has('--active')) return fail('verification-mode-required', 'Select exactly one of --staged or --active.');
  let plan = null;
  if (values.has('--config')) {
    try { plan = JSON.parse(await readFile(resolve(values.get('--config')), 'utf8')); }
    catch { return fail('config-unavailable', 'Read a valid explicit plan JSON file.'); }
  }
  const integer = (name, fallback) => values.has(name) ? (/^[1-9][0-9]*$/.test(values.get(name)) ? Number(values.get(name)) : NaN) : fallback;
  const options = { requiredDistinct: integer('--require-distinct', 10000), plan, policyService: createPolicyService(),
    approvedImages: APPROVED_CORPUS_IMAGES,
    policyRead: { runId: values.get('--run-id') || 'fleet-verification', asOf: values.get('--as-of') || new Date().toISOString() } };
  let report;
  if (values.has('--staged')) {
    if (['--store', '--endpoint', '--http', '--offline', '--concurrency', '--sample-size'].some((flag) => values.has(flag))) return fail('unsupported-arguments', 'Active audit options cannot be used for staged verification.');
    const artifacts = values.get('--artifacts') || plan?.destinations?.staged?.path;
    if (!artifacts) return fail('staged-destination-required', 'The plan has no selected staged corpus destination; supply --artifacts with an absolute directory.');
    report = await verifyStagedFleet({ artifacts, ...options });
  } else {
    if (values.has('--artifacts')) return fail('unsupported-arguments', 'Active verification reads a published --store, not staged --artifacts.');
    const root = values.get('--store') || plan?.destinations?.active?.path;
    if (!root) return fail('active-store-required', 'Supply the explicit absolute active --store or selected plan destination.');
    report = await verifyActiveFleet({ root, ...options, http: values.has('--http'), offline: values.has('--offline'),
      endpoint: values.get('--endpoint'), concurrency: integer('--concurrency', 1), sampleSize: integer('--sample-size', 128) });
  }
  write(JSON.stringify(report) + '\n'); return ['verified-staged', 'verified-active'].includes(report.status) ? 0 : 1;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await verifyFleetCli();
