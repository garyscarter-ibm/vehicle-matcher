#!/usr/bin/env node
// Offline FUCQ-77 audit, selection and F54 publication of the demo subset. No network, key or browser access.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MATRIX_PATH, validateDemoPlan } from './demo-plan.mjs';
import { assignRowsToLines, configurationDeepLink, countOtdFacts, lineModels, verifyStagedDemoFleet } from './demo-verifier.mjs';
import { validateCorpusDirectory, writeCorpusCandidate } from '../../server/gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../../server/gcsp/vehicle-evidence/vehicle-lookup.js';
import { APPROVED_CORPUS_IMAGES } from '../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { createPolicyService } from '../../server/gcsp/policy/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SOURCE_STORE = 'server/data/gcsp/vehicle-evidence/fleet-source.v1';
export const DEMO_STORE = 'server/data/gcsp/vehicle-evidence/demo-fleet.v1';
export const PLAN_PATH = 'server/data/gcsp/vehicle-evidence/demo-plan.json';
export const REPORT_PATH = 'docs/gcsp/evidence/fucq-20/demo-collection-report.json';
const SOURCES_DIR = 'server/data/gcsp/vehicle-evidence/registered-sources';
const FUCQ61_DIR = 'docs/gcsp/evidence/fucq61/exact10000-closeout-2026-11-07';
const FUCQ61_STAGED_MANIFEST = '3b2a883cd85a2d0c3f89e36e14561d15996affec972e19bbba0d962cf79cce30';
const MINIMUM_PER_LINE = 8;
const MAXIMUM_PER_LINE = 45;
const UNKNOWN_CATEGORY = Object.freeze({ state: 'unknown',
  reason: 'The record carries no typed option category for this dimension; none is inferred from code prefixes.' });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sorted = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const firstDifference = (left, right) => { const at = left.findIndex((value, index) => value !== right[index]); return at < 0 ? 0 : left[at] - right[at]; };

/** Greedy, deterministic pick: new model code, paint, upholstery, then new option codes, then a stable hash order. */
export function selectDemoRows({ plan, records, keep = new Set(), minimum = MINIMUM_PER_LINE, maximum = MAXIMUM_PER_LINE } = {}) {
  const assigned = assignRowsToLines({ records, plan });
  const lines = assigned.mapped.map((line) => {
    const candidates = assigned.lines.get(line.id).map((item) => ({ ...item, id: records[item.index].configurationId,
      rank: sha(records[item.index].configurationId) })).sort((a, b) => sorted(a.rank, b.rank));
    const seen = { vg: new Set(), paint: new Set(), upholstery: new Set(), options: new Set() };
    const picked = [];
    const take = (item) => {
      picked.push(item); seen.vg.add(item.audited.vgModelCode);
      item.audited.paintCodes?.forEach((value) => seen.paint.add(value));
      item.audited.upholsteryCodes?.forEach((value) => seen.upholstery.add(value));
      item.audited.options.forEach((value) => seen.options.add(value));
    };
    const target = Math.min(maximum, candidates.length);
    for (const item of candidates.filter((value) => keep.has(value.id))) if (picked.length < target) take(item);
    const gain = (item) => [seen.vg.has(item.audited.vgModelCode) ? 0 : 1,
      (item.audited.paintCodes || []).filter((value) => !seen.paint.has(value)).length,
      (item.audited.upholsteryCodes || []).filter((value) => !seen.upholstery.has(value)).length,
      item.audited.options.filter((value) => !seen.options.has(value)).length];
    const remaining = candidates.filter((item) => !picked.includes(item));
    while (picked.length < target) {
      let best = null; let bestGain = null;
      for (const item of remaining) {
        const value = gain(item);
        if (!best || firstDifference(value, bestGain) > 0) { best = item; bestGain = value; }
      }
      remaining.splice(remaining.indexOf(best), 1); take(best);
    }
    picked.sort((a, b) => sorted(a.id, b.id));
    const byModel = {};
    for (const item of candidates) byModel[item.audited.vgModelCode] = (byModel[item.audited.vgModelCode] || 0) + 1;
    return { line, candidates: candidates.length, byModel, selected: picked, belowMinimum: candidates.length > 0 && candidates.length < minimum };
  });
  return { lines, total: lines.reduce((sum, item) => sum + item.selected.length, 0), unassigned: assigned.unassigned.length,
    invalid: assigned.invalid.length };
}

/** Distinct counts per variation dimension; wheels and packs stay unknown unless the record types them. */
export function variationCounts(selected) {
  const distinct = (field) => {
    const known = selected.filter((item) => item.audited.categories?.[field]?.length);
    return known.length === 0 ? { state: 'unknown', reason: UNKNOWN_CATEGORY.reason, knownRows: 0 }
      : { distinct: new Set(known.flatMap((item) => item.audited.categories[field])).size, knownRows: known.length, unknownRows: selected.length - known.length };
  };
  return { vgModelCodes: new Set(selected.map((item) => item.audited.vgModelCode)).size,
    paint: distinct('paint'), upholstery: distinct('upholstery'), wheels: distinct('wheels'), packs: distinct('pack'),
    distinctOptionCodes: new Set(selected.flatMap((item) => item.audited.options)).size };
}

/** Pattern scan only; a clean result never replaces reading the artifact. */
export function privacyScan(files) {
  const patterns = {
    accessKey: /(api[-_]?key|access[-_]?key|x-api-key|client[-_]?secret|password|authorization:|bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.)/i,
    vin17: /(?<![A-Za-z0-9+/=_-])[A-HJ-NPR-Z0-9]{17}(?![A-Za-z0-9+/=_-])/,
    orderNumber: /(orderNumber|orderUuid|order-number|(?<![\w.:-])\d{7}(?![\w.:-]))/,
    imageUrlQuery: /https?:\/\/[^"\s]*\.(?:webp|png|jpe?g|avif)\?[^"\s]*/i,
  };
  const matches = Object.fromEntries(Object.keys(patterns).map((name) => [name, 0]));
  const hits = [];
  for (const [file, text] of files) {
    for (const [name, pattern] of Object.entries(patterns)) {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
      const found = text.match(new RegExp(pattern.source, flags))?.length || 0;
      matches[name] += found; if (found) hits.push({ file, pattern: name, count: found });
    }
  }
  return { filesScanned: files.length, matches, hits, clean: hits.length === 0 };
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

/** Load and fully validate the active published source store through the existing F54 validator. */
export async function loadSourceStore({ root = REPO_ROOT, policyService, policyRead } = {}) {
  const store = resolve(root, SOURCE_STORE); const active = await readJson(join(store, 'active.json'));
  const digest = active.selected?.manifestDigest;
  if (!/^[a-f0-9]{64}$/.test(digest || '') || active.selected.directory !== digest) throw new Error('The source store has no valid active selection.');
  const directory = join(store, 'versions', digest);
  const loaded = await validateCorpusDirectory(directory, { policyService, policyRead, approvedImages: APPROVED_CORPUS_IMAGES });
  if (loaded.status !== 'ok') throw new Error(`The source store failed validation (${loaded.failure?.code}).`);
  return { directory, manifestDigest: loaded.manifestDigest, manifest: loaded.manifest,
    records: loaded.corpus.configurations, images: loaded.corpus.images };
}

/** Distinct source rows per VG code in the registered source files (not necessarily published locally). */
export async function registeredSourceCounts(root = REPO_ROOT) {
  const dir = resolve(root, SOURCES_DIR); const ids = new Map();
  for (const name of (await readdir(dir)).filter((file) => file.endsWith('.jsonl')).sort()) {
    for (const line of (await readFile(join(dir, name), 'utf8')).split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line); const vg = row.canonicalIdentity?.vgModelCode;
      if (vg) { if (!ids.has(vg)) ids.set(vg, new Set()); ids.get(vg).add(row.configurationId); }
    }
  }
  return Object.fromEntries([...ids].sort(([a], [b]) => sorted(a, b)).map(([vg, set]) => [vg, set.size]));
}

async function retainedFucq61Counts(root = REPO_ROOT) {
  const coverage = await readJson(resolve(root, FUCQ61_DIR, 'coverage.json'));
  return Object.fromEntries(coverage.final10351Dimensions.vgModelCode.map((item) => [item.value, item.count]));
}

function sourceContexts(selected, records) {
  const keyed = new Map();
  for (const item of selected) {
    const row = records[item.index]; const { sourceKind, observedDate, catalogueDate } = row.sourceContext;
    const key = [sourceKind, row.configuration.market, row.configuration.steering, observedDate, catalogueDate].join('|');
    keyed.set(key, { catalogueDate, market: row.configuration.market, observedDate, sourceKind, steering: row.configuration.steering,
      note: `FUCQ-77 reuse subset of retained FUCQ-61 GB catalogue selections dated ${observedDate}; physical year, build, steering and plant remain unknown.` });
  }
  return [...keyed.entries()].sort(([a], [b]) => sorted(a, b)).map(([, value]) => value);
}

/** Write the selected rows through FUCQ-54 into a fresh candidate, then publish it into the versioned demo store. */
export async function publishDemoStore({ root = REPO_ROOT, source, selection, policyService, policyRead, scratch = tmpdir() }) {
  const chosen = selection.lines.flatMap((line) => line.selected);
  const ids = new Set(chosen.map((item) => item.id));
  const configurations = chosen.map((item) => structuredClone(source.records[item.index])).sort((a, b) => sorted(a.configurationId, b.configurationId));
  const supplements = (source.manifest.technicalSupplements || []).filter((item) => ids.has(item.configurationId));
  const images = source.images.filter((item) => ids.has(item.configurationId)).map((item) => structuredClone(item));
  const work = await mkdtemp(join(scratch, 'demo-selection-'));
  try {
    const { manifest: base } = source;
    const metadata = { datasetId: 'gcsp-demo-fleet', version: '2026-11-07.1', profileRegistryVersion: base.profileRegistryVersion,
      generatorVersion: base.generatorVersion, seed: structuredClone(base.seed), sourceContexts: sourceContexts(chosen, source.records) };
    const candidate = join(work, 'candidate');
    const written = await writeCorpusCandidate(candidate, { configurations, images, metadata, technicalSupplements: supplements },
      { policyService, policyRead, approvedImages: APPROVED_CORPUS_IMAGES });
    if (written.status !== 'ok') throw new Error(`Candidate write failed (${written.failure?.code}).`);
    const registry = createSyntheticRegistry({ root: resolve(root, DEMO_STORE), policyService, policyRead, approvedImages: APPROVED_CORPUS_IMAGES });
    const published = await registry.publish(candidate);
    if (published.status !== 'ok') throw new Error(`Publication failed (${published.failure?.code ?? published.status}).`);
    return { manifestDigest: published.active.manifestDigest, manifest: written.manifest, idempotent: published.idempotent === true };
  } finally { await rm(work, { recursive: true, force: true }); }
}

/** Resolve every selected configuration through the lookup port of the published demo store. */
export async function proveLookupPort({ root = REPO_ROOT, ids, policyService, policyRead }) {
  const registry = createSyntheticRegistry({ root: resolve(root, DEMO_STORE), policyService, policyRead, approvedImages: APPROVED_CORPUS_IMAGES });
  const loaded = await registry.load(); const lookup = createVehicleEvidenceLookup({ registry });
  const statuses = {};
  for (const id of ids) {
    const result = await lookup.resolve({ kind: 'configuration', id });
    statuses[result.status] = (statuses[result.status] || 0) + 1;
  }
  const active = registry.status().active;
  return { loaderStatus: loaded.status, activeManifestDigest: active?.manifestDigest ?? null, requested: ids.length, statuses,
    allResolved: ids.length > 0 && Object.keys(statuses).every((status) => ['partial', 'complete'].includes(status))
      && Object.values(statuses).reduce((sum, n) => sum + n, 0) === ids.length };
}

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path)); else out.push(path);
  }
  return out.sort();
}

function deepLinkSample(selection, plan, records, count) {
  const mappings = new Map(plan.modelLines.filter((line) => line.mapping.status === 'mapped')
    .flatMap((line) => lineModels(line).map((model) => [model.vgModelCode, model.modelRange])));
  const queues = selection.lines.map((line) => [...line.selected].sort((a, b) => sorted(sha(a.id), sha(b.id))));
  const sample = [];
  for (let round = 0; sample.length < count && queues.some((queue) => queue[round]); round++) {
    for (const [index, queue] of queues.entries()) {
      const item = queue[round]; if (!item || sample.length >= count) continue;
      sample.push({ lineId: selection.lines[index].line.id, configurationId: item.id, roundTrip: 'not-run',
        url: configurationDeepLink(records[item.index], { modelRange: mappings.get(item.audited.vgModelCode) }) });
    }
  }
  return sample;
}

/** Build the report object; pure given its inputs so the CLI and tests share it. */
export function buildReport({ plan, source, selection, retained, registered, published, lookup, verifier, sample, imageRows }) {
  const mapped = plan.modelLines.filter((line) => line.mapping.status === 'mapped');
  const chosenRows = selection.lines.flatMap((line) => line.selected.map((item) => source.records[item.index]));
  const lines = selection.lines.map(({ line, candidates, byModel, selected, belowMinimum }) => ({
    lineId: line.id, model: line.model, engine: line.engine, modelRange: line.mapping.modelRange,
    models: lineModels(line).map((model) => ({ vgModelCode: model.vgModelCode, agModelCode: model.agModelCode,
      localRows: byModel[model.vgModelCode] || 0, selectedRows: selected.filter((item) => item.audited.vgModelCode === model.vgModelCode).length,
      fucq61Rows: retained[model.vgModelCode] || 0, registeredSourceRows: registered[model.vgModelCode] || 0,
      registeredNotPublishedLocally: Math.max(0, (registered[model.vgModelCode] || 0) - (byModel[model.vgModelCode] || 0)) })),
    localRows: candidates, selectedCount: selected.length, belowMinimum,
    variation: variationCounts(selected), selectedConfigurationIds: selected.map((item) => item.id),
  }));
  const gaps = lines.filter((line) => line.localRows === 0).map((line) => ({ lineId: line.lineId, model: line.model, engine: line.engine,
    modelRange: line.modelRange, vgModelCodes: line.models.map((model) => model.vgModelCode),
    fucq61Rows: line.models.reduce((sum, model) => sum + model.fucq61Rows, 0),
    registeredSourceRowsNotPublishedLocally: line.models.reduce((sum, model) => sum + model.registeredSourceRows, 0) }));
  const facts = countOtdFacts(chosenRows, published.manifest);
  const exclusions = plan.modelLines.filter((line) => line.mapping.status === 'excluded')
    .map((line) => ({ lineId: line.id, model: line.model, engine: line.engine, reason: line.mapping.reason }));
  const pending = plan.modelLines.filter((line) => line.mapping.status === 'pending').map((line) => line.id);
  return {
    schemaVersion: 'gcsp-demo-collection-report.v1', story: 'FUCQ-77', epic: 'FUCQ-20', qualificationDate: plan.qualificationDate,
    mode: 'offline-reuse-of-retained-fucq61-records',
    source: { datasetId: source.manifest.datasetId, version: source.manifest.version, manifestDigest: source.manifestDigest,
      store: SOURCE_STORE, configurations: source.records.length, qualifyingSourceRows: source.manifest.counts.qualifyingCompleteDistinctSourceConfigurations,
      retainedBasis: { readme: `${FUCQ61_DIR}/README.md`, coverage: `${FUCQ61_DIR}/coverage.json`, stagedManifestSha256: FUCQ61_STAGED_MANIFEST,
        stagedConfigurations: 10000, availableLocally: false,
        note: 'The staged .12 corpus is on a release asset and is not restored here; its per-VG counts come from the retained coverage audit.' } },
    plan: { path: PLAN_PATH, lines: plan.modelLines.length, mapped: mapped.length, excluded: exclusions.length, pending: pending.length },
    publication: { boundary: 'FUCQ-54', store: DEMO_STORE, versionDirectory: `${DEMO_STORE}/versions/${published.manifestDigest}`,
      manifestDigest: published.manifestDigest, datasetId: published.manifest.datasetId, version: published.manifest.version, counts: published.manifest.counts,
      files: ['manifest.json', 'configurations.jsonl', 'vins.jsonl', 'images.jsonl'], lookupPort: lookup },
    selection: { method: 'greedy distinct model code, paint, upholstery and option codes, then stable SHA-256 order of the configuration ID',
      minimumPerMappedLine: MINIMUM_PER_LINE, maximumPerLine: MAXIMUM_PER_LINE, total: selection.total,
      sourceRowsWithoutMappedLine: selection.unassigned, sourceRowsRejectedByAudit: selection.invalid, lines },
    coverageGaps: gaps, exclusions, pendingLines: { count: pending.length, ids: pending },
    collection: { collectorRun: false, newSourceRequests: 0, rejections: 0, duplicates: 0, elapsedSeconds: 0,
      reason: 'Reuse closes every locally available line. The remaining mapped lines need the staged .12 restore or an explicit live collection, neither of which ran.' },
    budget: { limit: 3000, concurrency: 2, stopOrBackoffStatuses: [401, 403, 429], newSourceRequests: 0,
      historicalFucq61Receipts: { reference: `${FUCQ61_DIR}/operations.json`, charged: false,
        note: 'Historical FUCQ-61 traffic is referenced, not charged to this story or claimed to fit its budget.' } },
    deepLinks: { template: 'https://configure.bmw.co.uk/en_GB/configure/{modelRange}/{vgModelCode}/{sorted options}', built: published.manifest.counts.configurations,
      roundTrip: { required: 20, passed: 0, failed: 0, notRun: 20, status: 'not-run' }, sample },
    facts: { basis: 'Counts over the published demo rows; 0-62 reads the record acceleration field, which the source labels 0-100 km/h.', counts: facts },
    images: { cosyExteriorRenderReferences: imageRows.cosy, rows: imageRows.rows, configurationsWithoutImage: imageRows.without,
      origin: 'BMW COSY catalogue render', fidelity: 'representative-configuration' },
    verifier: verifier,
  };
}

function textPlanUpdate(text, directory) {
  if (text.includes('"stagedDirectory"')) return text.replace(/"stagedDirectory": "[^"]*"/, `"stagedDirectory": "${directory}"`);
  return text.replace('"boundary": "FUCQ-54",', `"boundary": "FUCQ-54",\n    "stagedDirectory": "${directory}",`);
}

export async function runDemoSelection({ root = REPO_ROOT, write = false, log = () => {} } = {}) {
  const policyService = createPolicyService();
  const planText = await readFile(resolve(root, PLAN_PATH), 'utf8'); const plan = JSON.parse(planText);
  const matrixText = await readFile(resolve(root, MATRIX_PATH), 'utf8');
  const policyRead = { runId: 'demo-selection', asOf: `${plan.qualificationDate}T12:00:00.000Z` };
  const planReport = validateDemoPlan(plan, { matrixText });
  if (!planReport.mappedReady) throw new Error('The demo plan has no verified mapped lines.');
  const source = await loadSourceStore({ root, policyService, policyRead });
  const keep = new Set([...source.images.map((item) => item.configurationId),
    ...(source.manifest.technicalSupplements || []).map((item) => item.configurationId)]);
  const selection = selectDemoRows({ plan, records: source.records, keep });
  const retained = await retainedFucq61Counts(root); const registered = await registeredSourceCounts(root);
  log(`selected ${selection.total} rows across ${selection.lines.length} mapped lines`);
  if (!write) return { selection, source, retained, registered };
  const published = await publishDemoStore({ root, source, selection, policyService, policyRead });
  const directory = `${DEMO_STORE}/versions/${published.manifestDigest}`;
  const updated = textPlanUpdate(planText, directory);
  if (updated !== planText) await writeFile(resolve(root, PLAN_PATH), updated);
  const ids = selection.lines.flatMap((line) => line.selected.map((item) => item.id));
  const lookup = await proveLookupPort({ root, ids, policyService, policyRead });
  const staged = await verifyStagedDemoFleet({ plan: JSON.parse(updated), matrixText, directory, policyService, policyRead,
    approvedImages: APPROVED_CORPUS_IMAGES, retainedCounts: retained, root });
  const verifier = { status: staged.status, acceptanceComplete: staged.acceptanceComplete, recordCount: staged.identity?.recordCount,
    distinctCount: staged.identity?.distinctCount, manifestCountMatchesVerifier: staged.identity?.manifestValid === true,
    perLineCounts: staged.coverage?.perLineCounts,
    deepLinks: staged.deepLinks, openGates: staged.openGates };
  const chosen = new Set(ids); const imaged = source.images.filter((item) => chosen.has(item.configurationId));
  const sample = deepLinkSample(selection, JSON.parse(updated), source.records, 20);
  const report = buildReport({ plan: JSON.parse(updated), source, selection, retained, registered, published, lookup, verifier, sample,
    imageRows: { cosy: imaged.length, rows: imaged.length, without: ids.length - imaged.length } });
  const files = [[REPORT_PATH, JSON.stringify(report, null, 2)]];
  for (const path of await listFiles(resolve(root, directory))) files.push([relative(root, path), await readFile(path, 'utf8')]);
  report.privacy = { ...privacyScan(files), scope: 'report body and every file of the published demo version' };
  await writeFile(resolve(root, REPORT_PATH), `${JSON.stringify(report, null, 2)}\n`);
  return { report, published, staged };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--write')) { process.stderr.write('Usage: node scripts/gcsp/demo-selection.mjs [--write]\n'); process.exitCode = 1; }
  else {
    runDemoSelection({ write: args.includes('--write'), log: (line) => process.stdout.write(`${line}\n`) }).then((result) => {
      if (result.report) process.stdout.write(`wrote ${REPORT_PATH}; manifest ${result.published.manifestDigest}; verifier ${result.staged.status}\n`);
    }).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  }
}
