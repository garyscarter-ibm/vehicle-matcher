// Writes the demo stock parity golden (FUCQ-462 s4) from the Node demo provider. Offline only.
// Run: node tools/supply-baseline/generate.mjs src/test/resources/supply/demo-parity.json (no node_modules; pg is stubbed).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import '../node-baseline/pg-stub.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const m = (p) => import(root + p);
const { createPolicyService } = await m('server/gcsp/policy/index.js');
const { createDemoStockProvider, withConfirmedSupply } = await m('server/gcsp/stock/demo-provider.js');
if (process.argv[2] === '--generated-request') {
  await generatedRequest(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
} else if (process.argv[2] === '--generated-inputs') {
  await generatedInputs(process.argv[3], process.argv[4] ?? 'main-successful-journey', process.argv[5] ?? 'run-1', process.argv[6]);
} else {
const out = process.argv[2];
const policy = createPolicyService();
const RUN = 'run-1'; const VERSION = 'gcsp-policy-v1';
const CUE = Date.parse('2026-11-05T09:30:00.000Z');
const at = (minutes) => new Date(CUE + minutes * 60000).toISOString();
const request = (minutes, released = [], queuedSupply = []) => ({ runId: RUN, asOf: at(minutes), tickId: `tick-${minutes}`,
  releaseSize: 100, leadTimeDays: 2, policyVersion: VERSION, released, queuedSupply });
const queued = (supplyId, eligibleMinutes) => ({ supplyId, confirmedAt: at(eligibleMinutes - 5), eligibleFrom: at(eligibleMinutes),
  sourceVersion: 'demo-synthetic-production-v1', policyVersion: VERSION });
const released = (value) => ({ trancheId: value.tranche.trancheId, orderUuids: value.tranche.orderUuids });
const demo = createDemoStockProvider({ policy });
const upstream = { lookup: (runId, supplyId) => (supplyId === 'sup-confirmed-1' ? { kind: 'touring', quantity: 2 } : null) };
const wrapped = withConfirmedSupply(createDemoStockProvider({ policy }), upstream, { policy });
const cases = [];
async function run(name, provider, req, held = null) {
  const outcome = await provider.pull(structuredClone(req));
  if (outcome.status !== 'ok') throw new Error(`${name}: ${outcome.status}`);
  cases.push({ name, request: req, confirmedSupply: held, expected: outcome.value });
  return outcome.value;
}
const a = await run('release cue', demo, request(0));
const b = await run('window 2 after window 1 released', demo, request(150, [released(a)]));
const bTranche = released(b);
await run('window 3 after windows 1 and 2 released', demo, request(1410, [released(a), bTranche]));
await run('nothing new before the next window', demo, request(60, [released(a)]));
const held = { 'sup-confirmed-1': { model: '3 Series Touring', derivative: '320i', quantity: 2 } };
const c = await run('confirmed supply releases first', wrapped, request(30, [], [queued('sup-confirmed-1', 10), queued('sup-unknown', 10)]), held);
await run('confirmed supply not yet eligible falls through to demo', wrapped, request(0, [], [queued('sup-confirmed-1', 60)]), held);
await run('released confirmed supply falls through to demo', wrapped, request(30, [released(c)], [queued('sup-confirmed-1', 10)]), held);
writeFileSync(out, JSON.stringify({ schemaVersion: 1, generator: 'services/gcsp-api/tools/supply-baseline/generate.mjs', policyVersion: VERSION, cases }, null, 1) + '\n');
console.log('cases', cases.length);
}

// Explicit input/output/inventory paths belong to the caller's supervised run; this tool creates no temporary root.
async function generatedRequest(inputPath, outputPath, inventoryPath, summaryPath) {
  if (!inputPath || !outputPath || !inventoryPath) throw new Error('Supply request, output and owned inventory paths.');
  const { createStockGenerator } = await m('server/gcsp/vehicle-evidence/stock-generator.js');
  const { createMemoryStore, createMemoryRepository, inputDigest } = await m('server/gcsp/repository/index.js');
  const { emptyAllocationInventory, canonicalAllocationContent } = await m('server/gcsp/vehicle-evidence/vin-allocation.js');
  const request = JSON.parse(readFileSync(inputPath, 'utf8'));
  const inventory = request.inventory ?? emptyAllocationInventory();
  writeFileSync(inventoryPath, canonicalAllocationContent(inventory), { flag: 'wx' });
  const context = { runId: request.runId, environmentId: 'generated-oracle', principalId: 'oracle-presenter', roles: ['presenter'] };
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => request.clockInstant });
  await repository.open();
  const seeded = await repository.transaction(context, { commandId: 'oracle-run', inputDigest: inputDigest(request) },
    (tx) => tx.insert('runs', { runId: request.runId, environmentId: context.environmentId, current: true, status: 'active',
      clockInstant: request.clockInstant, corpusVersion: request.plan.corpusVersion, policyVersion: request.policyVersion, versions: {} }));
  if (seeded.status !== 'ok') throw new Error(`oracle-run:${seeded.status}`);
  const policyService = { async getAssumption(key) {
    const row = request.assumptions[key];
    return row ? { status: 'ok', policyVersion: request.policyVersion, value: row } : { status: 'invalid' };
  } };
  const registry = { async getConfiguration(id) {
    return request.configurations[id] ? { status: 'complete', ...structuredClone(request.configurations[id]) } : { status: 'not-found' };
  } };
  const qualified = new Set(request.qualifyingConfigurationIds ?? []);
  const generator = createStockGenerator({ repository, registry, policyService, contextForRun: () => context,
    configurationPlan: request.plan, stockAccount: request.stockAccount, allocationInventoryPath: inventoryPath,
    visibility: request.visibility, factsForConfiguration: (binding) => structuredClone(request.configurations[binding.configurationId].extraFacts),
    ...(request.guarantee ? { guarantee: { ...request.guarantee, qualifies: (binding) => qualified.has(binding.configurationId) } } : {}) });
  const outcome = await generator.generateStock(request.runId, request.seed, request.policyVersion);
  const rows = await repository.query(context, 'stock');
  const expected = outcome.status === 'ok' ? { status: 'ok', value: { rows: rows.value, report: outcome.value.report,
    inventory: JSON.parse(readFileSync(inventoryPath, 'utf8')) } } : outcome;
  writeFileSync(outputPath, JSON.stringify({ ...expected, inputInventory: inventory }) + '\n');
  if (summaryPath) writeFileSync(summaryPath, JSON.stringify({ inputInventory: inventory, expected: outcome.status === 'ok'
    ? { status: 'ok', rowsDigest: inputDigest(rows.value), report: outcome.value.report,
      inventoryDigest: inputDigest(expected.value.inventory), valueDigest: inputDigest(expected.value) } : outcome }) + '\n');
  console.log('generated oracle', outcome.status, 'rows', rows.value?.length ?? 0);
}

async function generatedInputs(outputPath, scenarioId, runId, summaryPath) {
  if (!outputPath) throw new Error('Supply an output path.');
  const { createSyntheticRegistry } = await m('server/gcsp/vehicle-evidence/synthetic-registry.js');
  const { withDisplayImages } = await m('server/gcsp/vehicle-evidence/display-images.js');
  const { withConfigurationDefinitions, selectedConfigurationDefinitionFacts } = await m('server/gcsp/vehicle-evidence/configuration-definitions.js');
  const { vehicleEvidenceDetails } = await m('server/gcsp/vehicle-evidence/vehicle-details-contract.js');
  const { buildRetainedCorpusPlan } = await m('server/gcsp/vehicle-evidence/stock-configuration-plan.js');
  const { STOCK_CORPUS_ROOT, STOCK_ACCOUNT, STOCK_SEED, ELIGIBILITY_KEYS } = await m('server/gcsp/stock/run-stock-generation.js');
  const { releaseLimits, DEFAULT_ARTIFACT_ROOT } = await m('server/gcsp/vehicle-evidence/fleet-release.js');
  const { APPROVED_CORPUS_IMAGES } = await m('server/gcsp/vehicle-evidence/registered-corpus-images.js');
  const { VISIBILITY, modelBrowseFacts } = await m('server/gcsp/stock/demo-provider.js');
  const { SCENARIO_INPUTS_V1 } = await m('server/gcsp/fixtures/scenarios/catalogue-v1.js');
  const { createReleaseGuarantee } = await m('server/gcsp/stock/release-guarantee.js');
  const policy = createPolicyService();
  const read = { runId, policyVersion: 'gcsp-policy-v1', asOf: '2026-11-05T09:00:00.000Z' };
  const assumptions = {};
  async function assumption(key, required = true) {
    const row = await policy.getAssumption(key, read);
    if (row.status !== 'ok') { if (required) throw new Error(`assumption:${key}`); return; }
    assumptions[key] = row.value;
    return row.value.value;
  }
  const base = createSyntheticRegistry({ root: STOCK_CORPUS_ROOT, policyService: policy, approvedImages: APPROVED_CORPUS_IMAGES,
    jsonlLimitsForManifest: releaseLimits, sourceArtifactRoot: DEFAULT_ARTIFACT_ROOT, policyRead: read });
  const loaded = await base.load();
  if (loaded.status !== 'ok') throw new Error(`registry:${loaded.status}`);
  const registry = withConfigurationDefinitions(withDisplayImages(base));
  const built = await buildRetainedCorpusPlan({ root: STOCK_CORPUS_ROOT, policyService: policy, read });
  if (built.status !== 'ok') throw new Error(`plan:${built.status}`);
  const plan = built.value.plan;
  for (const key of ['stock.corpusModelLines.v1', 'stock.optionLabels.v1', 'supply.release.size', 'supply.weeklyReleaseVolume',
    'supply.release.cadence', ...Object.values(plan.aggregateKeys)]) await assumption(key);
  for (const key of ['supply.release.modelMix', 'policy.displayLabels.v1']) await assumption(key, false);
  const mapping = await assumption(ELIGIBILITY_KEYS);
  const configurations = {};
  for (const binding of plan.configurations) {
    const source = await registry.getConfiguration(binding.configurationId);
    const record = source.record;
    // Keep this projection aligned with the production callback in run-stock-generation.js; the oracle runs Node's evidence helpers.
    const selected = record.catalogue?.equipment?.selected;
    const selection = selected?.state === 'known' && Array.isArray(selected.options) ? { optionSelection: { value: {
      kind: 'selected-catalogue', codes: [...new Set([...selected.options, ...(selected.accessories ?? []).map((entry) => typeof entry === 'string' ? entry : entry.code)])],
      complete: record.catalogue.schemaVersion === '2' ? selected.factoryComplete === true && selected.accessoryCodesComplete === true
        : record.catalogue.schemaVersion === '1' && selected.complete === true && selected.completeness === 'complete',
      modelCode: record.configuration.vgModelCode, sourceRef: record.configurationId }, unit: null } } : {};
    const details = vehicleEvidenceDetails({ kind: 'configuration', id: record.configurationId }, source);
    delete details.identity.vin;
    const provenance = { sourceRef: JSON.stringify(record.sourceContext.sourceRefs), observedAt: `${record.sourceContext.observedDate}T00:00:00.000Z`,
      version: record.snapshotVersion, assurance: 'model-reference' };
    const known = (value) => ({ status: 'known', value, unit: null, provenance });
    const key = mapping[record.configuration.agModelCode];
    const extraFacts = { ...selection, ...(typeof key === 'string' ? { eligibilityModelKey: { value: key, unit: null }, ...modelBrowseFacts(key) } : {}),
      ...selectedConfigurationDefinitionFacts(details), configurationEvidence: known(details),
      gearbox: details.description.powertrain.transmission.state === 'known' ? known(details.description.powertrain.transmission.value)
        : { status: 'unknown', value: null, unit: null, provenance: { ...provenance, assurance: 'unknown' } } };
    configurations[binding.configurationId] = { record, active: source.active, images: source.images, extraFacts };
  }
  const scenario = SCENARIO_INPUTS_V1.find((row) => row.scenarioId === scenarioId);
  if (scenarioId !== 'none' && !scenario) throw new Error('scenario-unavailable');
  const guarantee = scenario?.inputs?.stockTranches?.find((row) => row.source === 'generated-stock')?.guarantee ?? null;
  const qualifyingConfigurationIds = [];
  if (guarantee) {
    const checked = await createReleaseGuarantee({ policy, read, scenario, guarantee });
    if (!checked) throw new Error('release-guarantee-unavailable');
    for (const key of ['identity.demo.principals', 'eligibility.context.mapping', 'employee.recommendation.v1', 'brief.lifecycle.v1',
      'eligibility.homeCharging.requiredForPlugIn']) await assumption(key);
    for (const binding of plan.configurations) {
      const extra = configurations[binding.configurationId].extraFacts;
      const wrapped = Object.fromEntries(Object.entries(extra).map(([key, fact]) => [key, fact && typeof fact === 'object'
        && ('status' in fact || 'provenance' in fact) ? fact : { status: 'known', value: fact && typeof fact === 'object' && Object.keys(fact).length === 2
          && 'value' in fact && 'unit' in fact ? fact.value : fact, unit: fact?.unit ?? null,
        provenance: { sourceRef: 'generator:stock-generator.v1', observedAt: read.asOf, version: `stock-generator.v1:${read.policyVersion}`, assurance: 'synthetic-scenario' } }]));
      if (await checked.qualifies(binding, configurations[binding.configurationId].record, wrapped)) qualifyingConfigurationIds.push(binding.configurationId);
    }
  }
  const request = { runId, seed: STOCK_SEED, policyVersion: read.policyVersion, clockInstant: read.asOf,
    stockAccount: STOCK_ACCOUNT, plan, assumptions, configurations, visibility: VISIBILITY, guarantee, qualifyingConfigurationIds };
  writeFileSync(outputPath, JSON.stringify(request) + '\n');
  if (summaryPath) {
    const { inputDigest } = await m('server/gcsp/repository/index.js');
    const { configurations: _configurations, ...pins } = request;
    const browseFacts = Object.fromEntries(Object.values(mapping).map((key) => [key, modelBrowseFacts(key)]));
    const sourcePaths = ['stock/run-stock-generation.js', 'stock/demo-provider.js', 'stock/release-guarantee.js',
      'vehicle-evidence/stock-configuration-plan.js', 'vehicle-evidence/configuration-definitions.js',
      'vehicle-evidence/stock-generator.js', 'vehicle-evidence/vin-allocation.js'];
    const codeSources = Object.fromEntries(sourcePaths.map((path) => [`server/gcsp/${path}`,
      createHash('sha256').update(readFileSync(root + 'server/gcsp/' + path)).digest('hex')]));
    writeFileSync(summaryPath, JSON.stringify({ schemaVersion: 1, codeSources, scenario: scenario ?? null,
      tranche: scenario?.inputs?.stockTranches?.find((row) => row.source === 'generated-stock') ?? null,
      pins, configurationDigests: Object.fromEntries(Object.entries(configurations).map(([id, value]) => [id, inputDigest(value)])),
      requestDigest: inputDigest(request), browseFacts }) + '\n');
  }
  console.log('generated inputs', plan.configurations.length, 'qualified', qualifyingConfigurationIds.length);
}
