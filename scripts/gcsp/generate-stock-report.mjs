#!/usr/bin/env node
// Offline FUCQ-78 generator report: real seed, real retained corpus, in-memory repository. No network.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryRepository, createMemoryStore } from '../../server/gcsp/repository/memory.js';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { createPolicyService, FilePolicyProvider } from '../../server/gcsp/policy/index.js';
import { DEFAULT_VEHICLE_CORPUS_ROOT } from '../../server/gcsp/vehicle-evidence/local-vehicle-lookup.js';
import { releaseLimits, DEFAULT_ARTIFACT_ROOT } from '../../server/gcsp/vehicle-evidence/fleet-release.js';
import { APPROVED_CORPUS_IMAGES } from '../../server/gcsp/vehicle-evidence/registered-corpus-images.js';
import { createSyntheticRegistry } from '../../server/gcsp/vehicle-evidence/synthetic-registry.js';
import { buildRetainedCorpusPlan } from '../../server/gcsp/vehicle-evidence/stock-configuration-plan.js';
import { createStockGenerator, STOCK_GENERATOR_NAMESPACE } from '../../server/gcsp/vehicle-evidence/stock-generator.js';
import { canonicalAllocationContent, emptyAllocationInventory } from '../../server/gcsp/vehicle-evidence/vin-allocation.js';

export const RUN_ID = 'fucq78-report-run';
export const SEED = 'fucq78-report-seed';
const AS_OF = '2026-11-07T09:00:00.000Z';
const OUT = fileURLToPath(new URL('../../docs/gcsp/evidence/fucq-20/generator-report-2026-11-07.json', import.meta.url));
const share = (n, total) => Math.round(n / total * 10000) / 10000;
const fact = (row, name) => row.facts.facts[name].value;

export async function buildGeneratorReport() {
  const policy = createPolicyService({ provider: new FilePolicyProvider() });
  const active = await policy.getActiveVersion({ runId: RUN_ID, asOf: AS_OF });
  if (active.status !== 'ok') throw new Error('policy-unavailable');
  const policyVersion = active.policyVersion;
  const built = await buildRetainedCorpusPlan({ root: DEFAULT_VEHICLE_CORPUS_ROOT, policyService: policy, read: { runId: RUN_ID, asOf: AS_OF, policyVersion } });
  if (built.status !== 'ok') throw new Error(`plan-${built.code}`);
  const registry = createSyntheticRegistry({ root: DEFAULT_VEHICLE_CORPUS_ROOT, policyService: policy, approvedImages: APPROVED_CORPUS_IMAGES,
    jsonlLimitsForManifest: releaseLimits, sourceArtifactRoot: DEFAULT_ARTIFACT_ROOT, policyRead: { runId: 'local-vehicle-evidence', asOf: AS_OF } });
  if ((await registry.load()).status !== 'ok') throw new Error('registry-unavailable');
  const context = { runId: RUN_ID, environmentId: 'fucq78-report', principalId: 'fucq78-report', roles: ['presenter'] };
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => AS_OF });
  await repository.open();
  await repository.transaction(context, { commandId: 'report-run', inputDigest: inputDigest([RUN_ID]) }, async (tx) => tx.insert('runs', {
    runId: RUN_ID, environmentId: context.environmentId, current: true, status: 'active', clockInstant: AS_OF,
    corpusVersion: 'synthetic-clock-corpus-v1', policyVersion, versions: {} }));
  const directory = await mkdtemp(join(tmpdir(), 'fucq78-report-'));
  try {
    const allocationInventoryPath = join(directory, 'inventory.json');
    await writeFile(allocationInventoryPath, canonicalAllocationContent(emptyAllocationInventory()));
    const generator = createStockGenerator({ repository, registry, policyService: policy, contextForRun: () => context,
      configurationPlan: built.value.plan, stockAccount: 'fucq78-report-scheme-stock', allocationInventoryPath });
    const outcome = await generator.generateStock(RUN_ID, SEED, policyVersion);
    if (outcome.status !== 'ok') throw new Error(`generation-${outcome.status}-${outcome.code ?? outcome.reason ?? ''}`);
    const rows = (await repository.query(context, 'stock')).value.filter((row) => row.facts?.sourceNamespace === STOCK_GENERATOR_NAMESPACE);
    const { report } = outcome.value;
    const lines = report.models.map((model) => {
      const own = rows.filter((row) => fact(row, 'modelLine') === built.value.plan.titles[model.modelLineId]);
      const colours = Object.entries(model.observed.colourShares).map(([colour, planned]) => {
        const count = own.filter((row) => fact(row, 'colour') === colour).length;
        return { colour, planned, cars: count, actual: share(count, own.length) };
      });
      const histogram = {};
      for (const row of own) histogram[fact(row, 'leadTimeWeeks')] = (histogram[fact(row, 'leadTimeWeeks')] || 0) + 1;
      const leads = own.map((row) => fact(row, 'leadTimeWeeks'));
      const modelShare = { planned: share(model.observed.carCount, report.models.reduce((sum, row) => sum + row.observed.carCount, 0)), actual: share(model.cars, report.totalCars) };
      return { modelLineId: model.modelLineId, title: built.value.plan.titles[model.modelLineId], aggregateKey: model.aggregateKey, sourceKind: model.sourceKind,
        cars: model.cars, modelShare, colourShares: colours,
        leadTimeWeeks: { aggregate: model.observed.leadTimeWeeks, min: Math.min(...leads), max: Math.max(...leads),
          histogram: Object.fromEntries(Object.entries(histogram).sort(([a], [b]) => a - b)) },
        ...(model.cars >= 20 ? { withinFivePoints: Math.abs(modelShare.planned - modelShare.actual) <= 0.05
          && colours.every((row) => Math.abs(row.planned - row.actual) <= 0.05) } : {}) };
    });
    const windows = {};
    for (const row of rows) {
      const planned = fact(row, 'plannedRelease');
      windows[planned.windowStart] ||= { windowStart: planned.windowStart, windowEnd: planned.windowEnd, cars: 0 };
      windows[planned.windowStart].cars += 1;
    }
    return { schemaVersion: 1, kind: 'synthetic-stock-generator-report', runId: RUN_ID, seed: SEED, clockInstant: AS_OF,
      note: 'Synthetic scheme stock on assumed aggregates; not BMW stock. withinFivePoints compares model and colour shares with the plan, for lines with 20 or more cars.',
      generatorVersion: report.generatorVersion, policyVersion, totalCars: report.totalCars, configurationSource: report.configurationSource,
      release: { trancheSize: report.release.trancheSize, weeklyVolume: report.release.weeklyVolume,
        windows: Object.values(windows).sort((a, b) => Date.parse(a.windowStart) - Date.parse(b.windowStart)) },
      coverage: { coveredLines: built.value.coverage.coveredCount, schemeLines: built.value.coverage.totalCount, note: built.value.coverage.note },
      lines };
  } finally { await rm(directory, { recursive: true, force: true }); await repository.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = JSON.stringify(await buildGeneratorReport(), null, 2) + '\n';
  if (process.argv[2] === '--stdout') process.stdout.write(json);
  else await writeFile(OUT, json);
}
