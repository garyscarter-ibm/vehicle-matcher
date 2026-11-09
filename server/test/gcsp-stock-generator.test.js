import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { createMemoryStore, createMemoryRepository } from '../gcsp/repository/memory.js';
import { inputDigest } from '../gcsp/repository/core.js';
import { emptyAllocationInventory, canonicalAllocationContent, readAllocationInventory } from '../gcsp/vehicle-evidence/vin-allocation.js';

// These are explicitly fictional structural fixtures, never accepted F77 data.
const generatorModule = await import('../gcsp/vehicle-evidence/stock-generator.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('stock-generator.js')) return {};
  throw error;
});
const at = '2026-11-06T10:00:00.000Z';
const allocationRoots = [];
after(async () => { for (const directory of allocationRoots) await rm(directory, { recursive: true, force: true }); });
const context = (runId) => ({ runId, environmentId: `fixture-${runId}`, principalId: 'fixture-presenter', roles: ['presenter'] });
const ids = ['A:WHITE', 'A:BLACK', 'B:WHITE', 'B:BLACK'].map((id) => Buffer.from(id).toString('base64'));
const configurationPlan = { kind: 'synthetic-fixture', datasetId: 'fictional-stock-fixture', corpusVersion: 'fixture.v1',
  source: 'inline synthetic test fixture; not F77 acceptance', configurations: ids.map((configurationId, i) => ({
    configurationId, modelLineId: i < 2 ? 'fixture-a' : 'fixture-b', colour: i % 2 ? 'Black' : 'White',
  })), aggregateKeys: { 'fixture-a': 'stock.aggregate.fixture-a', 'fixture-b': 'stock.aggregate.fixture-b' } };
const records = ids.map((configurationId, i) => ({ configurationId, snapshotVersion: 'fixture.v1',
  configuration: { model: i < 2 ? 'Fictional A' : 'Fictional B', paint: i % 2 ? 'Black' : 'White' } }));
const registry = { getConfiguration(id) { const record = records.find((row) => row.configurationId === id);
  return record ? { status: 'partial', record: structuredClone(record), active: { datasetId: configurationPlan.datasetId, version: 'fixture.v1', manifestDigest: inputDigest(records) } }
    : { status: 'not-found' }; } };

async function policyFixture(lead = [2, 4], version = 'fixture-policy-v1') {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
  seed.policyVersion = version;
  for (const table of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of seed[table]) row.policyVersion = version;
  }
  const put = (key, value) => {
    seed.assumptions = seed.assumptions.filter((row) => row.key !== key);
    seed.assumptions.push({ key, value, unit: 'explicit synthetic fixture', status: 'assumed',
      basis: 'Fictional contract fixture, never an observed BMW aggregate.', source: 'server/test/gcsp-stock-generator.test.js',
      sourceDate: '2026-11-06', policyVersion: version, effectiveFrom: seed.effectiveFrom });
  };
  put('supply.release.size', 20);
  put('supply.weeklyReleaseVolume', { min: 350, max: 350 });
  put('supply.release.cadence', { timeZone: 'Europe/London', slots: [
    { weekday: 1, time: '11:30' }, { weekday: 3, time: '11:30' }, { weekday: 5, time: '11:30' },
  ] });
  for (const [modelLineId, carCount] of [['fixture-a', 70], ['fixture-b', 30]]) {
    put(`stock.aggregate.${modelLineId}`, { modelLineId, carCount, colourShares: { White: 0.6, Black: 0.4 },
      upholsteryShares: { 'Fictional cloth': 1 }, leadTimeWeeks: { min: lead[0], max: lead[1] },
      deliveryDateSpread: { min: '2026-11-20', max: '2026-12-04' }, priceBand: { min: 40000, max: 70000, currency: 'GBP' },
      sampleDate: '2026-11-06', requestCount: 1, sourceKind: 'synthetic-fixture' });
  }
  return seed;
}

async function setup({ seeds, plan = configurationPlan, registryPort = registry, repositoryPort, store = createMemoryStore(), allocationLimits } = {}) {
  assert.equal(typeof generatorModule.createStockGenerator, 'function', 'the run-scoped generator factory must exist');
  const { PolicyService } = await import('../gcsp/policy/index.js');
  seeds ||= [await policyFixture()];
  const policy = new PolicyService({ provider: { async loadVersions() { return seeds; } } });
  const reads = [];
  const policyService = { async getAssumption(key, read) { reads.push({ key, ...read }); return policy.getAssumption(key, read); } };
  const repository = repositoryPort || createMemoryRepository({ store, now: () => at });
  const allocationDirectory = await mkdtemp(join(tmpdir(), 'stock-generation-identities-'));
  allocationRoots.push(allocationDirectory);
  const allocationInventoryPath = join(allocationDirectory, 'inventory.json');
  await writeFile(allocationInventoryPath, canonicalAllocationContent(emptyAllocationInventory(allocationLimits)));
  await repository.open();
  for (const runId of ['run-a', 'run-b', 'run-c']) {
    const policyVersion = runId === 'run-c' ? seeds.at(-1).policyVersion : seeds[0].policyVersion;
    await repository.transaction(context(runId), { commandId: 'fixture-run', inputDigest: inputDigest([runId, policyVersion]) }, async (tx) => tx.insert('runs', {
      runId, environmentId: context(runId).environmentId, current: true, status: 'active', clockInstant: at,
      corpusVersion: plan.corpusVersion, policyVersion, versions: {},
    }));
  }
  const generator = generatorModule.createStockGenerator({ repository, registry: registryPort, policyService,
    contextForRun: context, configurationPlan: plan, stockAccount: 'fictional-scheme-stock', allocationInventoryPath });
  return { generator, repository, store, reads, policy, allocationInventoryPath };
}
// Generated rows carry a VehicleSnapshot: raw fact values sit at facts.facts.<name>.value.
const fact = (row, name) => row.facts.facts[name].value;
const stock = async (repository, runId) => (await repository.query(context(runId), 'stock')).value;
const inventoryDigest = async (path) => inputDigest(JSON.parse(await readFile(path, 'utf8')));

test('seeded stock is deterministic, weighted, explicitly fictional and unreleased, with a persisted report', async () => {
  const a = await setup(); const b = await setup();
  const before = structuredClone(records);
  const result = await a.generator.generateStock('run-a', 'fictional-seed', 'fixture-policy-v1');
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.deepEqual(result, await b.generator.generateStock('run-a', 'fictional-seed', 'fixture-policy-v1'));
  const rows = await stock(a.repository, 'run-a');
  assert.equal(rows.length, 350);
  assert.equal(new Set(rows.map((row) => row.orderUuid)).size, 350);
  assert.equal(new Set(rows.map((row) => row.orderNumber)).size, 350);
  for (const row of rows) {
    assert.match(row.orderUuid, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.match(row.orderNumber, /^[0-9]{7}$/);
    assert.ok(row.wholesalerOrderId >= 10000000 && row.wholesalerOrderId <= 99999999);
    assert.ok(ids.includes(row.configurationId));
    assert.equal(fact(row, 'stockIdentityKind'), 'synthetic');
    assert.equal(row.facts.sourceNamespace, 'synthetic:stock-generator.v1');
    assert.equal(row.state, 'unreleased'); assert.equal(row.available, false);
    assert.equal(row.release, undefined, 'the release service owns the release object');
    assert.equal(row.account, 'fictional-scheme-stock');
    assert.equal(fact(row, 'policyVersion'), 'fixture-policy-v1');
    assert.ok(fact(row, 'leadTimeWeeks') >= 2 && fact(row, 'leadTimeWeeks') <= 4);
    assert.match(fact(row, 'confirmedDeliveryWeek'), /^\d{4}-\d{2}-\d{2}$/);
    const planned = fact(row, 'plannedRelease');
    assert.ok(Date.parse(planned.windowStart) >= Date.parse(at));
    assert.ok(Date.parse(planned.windowEnd) > Date.parse(planned.windowStart));
    assert.equal(new Date(fact(row, 'confirmedDeliveryWeek')).getUTCDay(), 1);
    assert.equal(row.vin17, undefined); assert.equal(row.vin, undefined);
  }
  assert.deepEqual(records, before);
  const report = result.value.report;
  assert.equal(report.totalCars, 350); assert.equal(report.policyVersion, 'fixture-policy-v1');
  assert.equal(report.configurationSource.kind, 'synthetic-fixture');
  for (const model of report.models) {
    assert.ok(Math.abs(model.actualShare - model.observedShare) <= 0.05);
    assert.ok(model.cars >= 20);
    for (const [colour, share] of Object.entries(model.observed.colourShares)) assert.ok(Math.abs(model.colourShares[colour] - share) <= 0.05);
    assert.ok(model.leadTimeWeeks.min >= 2 && model.leadTimeWeeks.max <= 4);
  }
  assert.equal(report.models.find((row) => row.modelLineId === 'fixture-a').cars, 245);
  assert.equal(a.reads.some((row) => row.key === 'supply.release.size'), true);
  assert.equal(a.reads.some((row) => row.key === 'supply.leadTimeDays'), false, 'observed stock lead times do not replace production planning');
  assert.ok(a.reads.every((row) => row.runId === 'run-a' && row.policyVersion === 'fixture-policy-v1'));
});

// FUCQ-229: a window's backlog releases on later windows, so even a one-week lead must outlast every window.
test('a one-week lead time keeps every confirmed delivery week after the last release window', async () => {
  const a = await setup({ seeds: [await policyFixture([1, 1])] });
  const result = await a.generator.generateStock('run-a', 'fictional-seed', 'fixture-policy-v1');
  assert.equal(result.status, 'ok', JSON.stringify(result));
  const last = Date.parse(result.value.report.release.windows.at(-1));
  const rows = await stock(a.repository, 'run-a');
  assert.ok(rows.length > 0 && rows.every((row) => fact(row, 'leadTimeWeeks') === 1));
  assert.ok(rows.every((row) => Date.parse(`${fact(row, 'confirmedDeliveryWeek')}T00:00:00.000Z`) > last),
    JSON.stringify([...new Set(rows.map((row) => fact(row, 'confirmedDeliveryWeek')))]));
});

test('idempotent regeneration and one new policy entry preserve other runs and retained run provenance', async () => {
  const first = await policyFixture();
  const changed = structuredClone(first); changed.policyVersion = 'fixture-policy-v2'; changed.effectiveFrom = '2026-11-06T00:00:00.000Z';
  for (const table of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of changed[table]) row.policyVersion = changed.policyVersion;
  }
  changed.assumptions.find((row) => row.key === 'stock.aggregate.fixture-a').value.leadTimeWeeks = { min: 8, max: 8 };
  const env = await setup({ seeds: [first, changed] });
  assert.equal((await env.generator.generateStock('run-a', 'fictional-seed', first.policyVersion)).status, 'ok');
  assert.equal((await env.generator.generateStock('run-b', 'fictional-seed', first.policyVersion)).status, 'ok');
  const before = structuredClone(env.store.state);
  assert.equal((await env.generator.generateStock('run-a', 'fictional-seed', first.policyVersion)).status, 'ok');
  assert.deepEqual(env.store.state, before);
  assert.equal((await env.generator.generateStock('run-c', 'fictional-seed', changed.policyVersion)).status, 'ok');
  const c = await stock(env.repository, 'run-c');
  assert.ok(c.filter((row) => fact(row, 'modelLine') === 'fixture-a').every((row) => fact(row, 'leadTimeWeeks') === 8));
  assert.ok(c.filter((row) => fact(row, 'modelLine') === 'fixture-b').every((row) => fact(row, 'leadTimeWeeks') <= 4));
  assert.deepEqual(await stock(env.repository, 'run-a'), before.tables.stock.filter((row) => row.runId === 'run-a'));
  assert.deepEqual(await stock(env.repository, 'run-b'), before.tables.stock.filter((row) => row.runId === 'run-b'));
  const run = await env.repository.read(context('run-a'), { table: 'runs', key: { runId: 'run-a' } });
  assert.equal(run.value.versions.stockGeneration.policyVersion, first.policyVersion);
  const retainedBeforeConflict = await inventoryDigest(env.allocationInventoryPath);
  const mutation = await env.generator.generateStock('run-a', 'another-seed', first.policyVersion);
  assert.equal(mutation.status, 'conflict');
  assert.equal(await inventoryDigest(env.allocationInventoryPath), retainedBeforeConflict);
});

test('missing policy, unsupported coverage and registry changes fail without publishing partial rows', async () => {
  const missing = await policyFixture(); missing.assumptions = missing.assumptions.filter((row) => row.key !== 'supply.release.cadence');
  const env = await setup({ seeds: [missing] }); const before = structuredClone(env.store.state);
  assert.notEqual((await env.generator.generateStock('run-a', 'fixture', missing.policyVersion)).status, 'ok');
  assert.deepEqual(env.store.state, before);
  const plan = structuredClone(configurationPlan); plan.configurations = plan.configurations.filter((row) => row.modelLineId !== 'fixture-b');
  const unsupported = await setup({ plan });
  assert.equal((await unsupported.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).code, 'unsupported-configuration-coverage');
  assert.equal((await stock(unsupported.repository, 'run-a')).length, 0);
  const unavailable = await setup({ registryPort: { getConfiguration() { return { status: 'source-unavailable' }; } } });
  assert.notEqual((await unavailable.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  assert.equal((await stock(unavailable.repository, 'run-a')).length, 0);
  assert.notEqual((await env.generator.generateStock('run-a', '', missing.policyVersion)).status, 'ok');
  const malformed = await setup({ plan: { ...configurationPlan, configurations: [null] } });
  assert.equal((await malformed.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'invalid');
});

test('a failed repository mutation rolls back every generated stock row and report', async () => {
  const store = createMemoryStore(); const real = createMemoryRepository({ store, now: () => at });
  let insertions = 0;
  const repositoryPort = { ...real, transaction(ctx, command, work) { return real.transaction(ctx, command, async (tx) => work({ ...tx,
    async insert(table, row) {
      if (table === 'stock' && ++insertions === 3) return { status: 'unavailable' };
      return tx.insert(table, row);
    },
  })); } };
  const env = await setup({ repositoryPort, store }); const before = structuredClone(store.state);
  assert.notEqual((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  assert.deepEqual(store.state, before);
  const reserved = await inventoryDigest(env.allocationInventoryPath);
  assert.equal((await readAllocationInventory(env.allocationInventoryPath)).inventory.records.length, 350,
    'F53 retains valid reservations separately from failed stock publication');
  assert.equal((await env.generator.generateStock('run-a', 'changed-seed', 'fixture-policy-v1')).status, 'conflict');
  assert.equal(await inventoryDigest(env.allocationInventoryPath), reserved, 'changed request cannot reserve additional identifiers');
  assert.equal((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  assert.equal((await stock(env.repository, 'run-a')).length, 350);
  assert.equal(await inventoryDigest(env.allocationInventoryPath), reserved, 'retry reuses the existing identifiers');
});

test('an accepted-plan label cannot turn synthetic policy fixtures into observed source authority', async () => {
  const plan = { ...structuredClone(configurationPlan), kind: 'accepted-f77' };
  const env = await setup({ plan }); const before = structuredClone(env.store.state);
  const outcome = await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1');
  assert.equal(outcome.status, 'invalid');
  assert.equal(outcome.code, 'aggregate-provenance-mismatch');
  assert.deepEqual(env.store.state, before);
});

test('the actual immutable registry port supplies configuration identity without corpus writes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'stock-generator-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { corpusInput, options } = await import('./helpers/vin-corpus-fixture.js');
  const { createSyntheticRegistry } = await import('../gcsp/vehicle-evidence/synthetic-registry.js');
  const { writeCorpusCandidate } = await import('../gcsp/vehicle-evidence/corpus-publisher.js');
  const input = await corpusInput({ usage: 'stock' });
  const candidate = join(root, 'candidate');
  assert.equal((await writeCorpusCandidate(candidate, input, options)).status, 'ok');
  const port = createSyntheticRegistry({ root: join(root, 'store'), ...options });
  assert.equal((await port.publish(candidate)).status, 'ok');
  const before = await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8');
  const configurationBefore = port.getConfiguration(input.configurations[0].configurationId).record;
  const seed = await policyFixture();
  const aggregate = seed.assumptions.find((row) => row.key === 'stock.aggregate.fixture-a');
  aggregate.value.colourShares = { White: 1 };
  const plan = { ...configurationPlan, datasetId: input.metadata.datasetId, corpusVersion: input.metadata.version,
    configurations: [{ configurationId: input.configurations[0].configurationId, modelLineId: 'fixture-a', colour: 'White' }],
    aggregateKeys: { 'fixture-a': 'stock.aggregate.fixture-a' } };
  const env = await setup({ seeds: [seed], plan, registryPort: port });
  assert.equal((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  assert.equal((await stock(env.repository, 'run-a')).length, 350);
  assert.equal(await readFile(join(root, 'store', 'identity-inventory.json'), 'utf8'), before);
  assert.deepEqual(port.getConfiguration(input.configurations[0].configurationId).record, configurationBefore);
});

test('release cadence is policy data, and unknown aggregate fields cannot enter stock reports', async () => {
  const seed = await policyFixture();
  seed.assumptions.find((row) => row.key === 'supply.release.cadence').value = {
    timeZone: 'Europe/London', slots: [{ weekday: 2, time: '11:30' }],
  };
  const env = await setup({ seeds: [seed] });
  assert.equal((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  assert.ok((await stock(env.repository, 'run-a')).every((row) => new Date(fact(row, 'plannedRelease').windowStart).getUTCDay() === 2));
  const unsafe = await policyFixture();
  unsafe.assumptions.find((row) => row.key === 'stock.aggregate.fixture-a').value.singleCarRecord = 'DO_NOT_RETAIN';
  const rejected = await setup({ seeds: [unsafe] });
  assert.equal((await rejected.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'invalid');
  assert.equal((await stock(rejected.repository, 'run-a')).length, 0);
});

test('whole retained F53 inventory prevents cross-run collision reuse and preserves the first run on exhaustion', async () => {
  const env = await setup({ allocationLimits: { wholesalerSpace: 350 } });
  assert.equal((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  const before = await readFile(env.allocationInventoryPath, 'utf8');
  const stockBefore = await stock(env.repository, 'run-a');
  assert.equal((await env.generator.generateStock('run-b', 'fixture', 'fixture-policy-v1')).status, 'exhausted');
  assert.equal((await stock(env.repository, 'run-b')).length, 0);
  assert.deepEqual(await stock(env.repository, 'run-a'), stockBefore);
  assert.equal(await readFile(env.allocationInventoryPath, 'utf8'), before);
});

test('nested aggregate records are rejected before allocating or persisting any stock', async () => {
  for (const dimension of ['leadTimeWeeks', 'deliveryDateSpread', 'priceBand', 'colourShares', 'upholsteryShares']) {
    const seed = await policyFixture();
    seed.assumptions.find((row) => row.key === 'stock.aggregate.fixture-a').value[dimension].singleCarRecord = { vin: 'DO_NOT_RETAIN' };
    const env = await setup({ seeds: [seed] });
    const before = await readFile(env.allocationInventoryPath, 'utf8');
    assert.equal((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'invalid');
    assert.equal((await stock(env.repository, 'run-a')).length, 0);
    assert.equal(await readFile(env.allocationInventoryPath, 'utf8'), before);
  }
});

// The real seed, the real retained corpus and the real registry port: assumed aggregates, never observed stock.
let realBuilt;
async function realStock() {
  realBuilt ||= (async () => {
    const { createPolicyService, FilePolicyProvider } = await import('../gcsp/policy/index.js');
    const { DEFAULT_VEHICLE_CORPUS_ROOT } = await import('../gcsp/vehicle-evidence/local-vehicle-lookup.js');
    const { releaseLimits, DEFAULT_ARTIFACT_ROOT } = await import('../gcsp/vehicle-evidence/fleet-release.js');
    const { APPROVED_CORPUS_IMAGES } = await import('../gcsp/vehicle-evidence/registered-corpus-images.js');
    const { createSyntheticRegistry } = await import('../gcsp/vehicle-evidence/synthetic-registry.js');
    const { buildRetainedCorpusPlan } = await import('../gcsp/vehicle-evidence/stock-configuration-plan.js');
    const policy = createPolicyService({ provider: new FilePolicyProvider() });
    const policyVersion = (await policy.getActiveVersion({ runId: 'run-a', asOf: at })).value?.policyVersion ?? 'gcsp-policy-v1';
    const read = { runId: 'run-a', asOf: at, policyVersion };
    const registry = createSyntheticRegistry({ root: DEFAULT_VEHICLE_CORPUS_ROOT, policyService: policy, approvedImages: APPROVED_CORPUS_IMAGES,
      jsonlLimitsForManifest: releaseLimits, sourceArtifactRoot: DEFAULT_ARTIFACT_ROOT, policyRead: { runId: 'local-vehicle-evidence', asOf: new Date().toISOString() } });
    assert.equal((await registry.load()).status, 'ok');
    const built = await buildRetainedCorpusPlan({ root: DEFAULT_VEHICLE_CORPUS_ROOT, policyService: policy, read });
    return { policy, policyVersion, read, registry, built };
  })();
  return realBuilt;
}
// Runs carry the clock scenario's corpus version and its unreleased fixture stock, as after a real reset.
const CLOCK_CORPUS = 'synthetic-clock-corpus-v1';
export const clockFixtureRow = (runId) => ({ runId, orderUuid: '11111111-1111-4111-8111-111111111111', orderNumber: '1000001', wholesalerOrderId: 10000001,
  configurationId: 'clock-fixture-config', corpusVersion: CLOCK_CORPUS, revision: 1, state: 'unreleased', available: false,
  facts: { syntheticIdentity: { vehicleId: 'clock-fixture-1', identityKind: 'synthetic' } } });
async function realRun(seeds, { runIds = ['run-a'], policy: custom, versions = {}, repository: given, ...generatorOptions } = {}) {
  const base = await realStock();
  const { registry, built } = base; const policy = custom ?? base.policy; const policyVersion = base.policyVersion;
  assert.equal(built.status, 'ok', JSON.stringify(built));
  const repository = given ?? createMemoryRepository({ store: createMemoryStore(), now: () => at });
  const directory = await mkdtemp(join(tmpdir(), 'stock-generation-real-')); allocationRoots.push(directory);
  const allocationInventoryPath = join(directory, 'inventory.json');
  await writeFile(allocationInventoryPath, canonicalAllocationContent(emptyAllocationInventory()));
  await repository.open();
  for (const runId of runIds) {
    await repository.transaction(context(runId), { commandId: 'real-run', inputDigest: inputDigest([runId]) }, async (tx) => tx.insert('runs', {
      runId, environmentId: context(runId).environmentId, current: true, status: 'active', clockInstant: at,
      corpusVersion: CLOCK_CORPUS, policyVersion: versions[runId] ?? policyVersion, versions: {} }));
    await repository.transaction(context(runId), { commandId: 'real-fixture', inputDigest: inputDigest([runId, 'fixture']) }, async (tx) => tx.insert('stock', clockFixtureRow(runId)));
  }
  const generator = generatorModule.createStockGenerator({ repository, registry, policyService: policy, contextForRun: context,
    configurationPlan: built.value.plan, stockAccount: 'fictional-scheme-stock', allocationInventoryPath, ...generatorOptions });
  const outcomes = [];
  for (const [runId, seed] of seeds) outcomes.push(await generator.generateStock(runId, seed, versions[runId] ?? policyVersion));
  return { outcomes, repository, plan: built.value.plan, coverage: built.value.coverage, registry, policy, policyVersion, allocationInventoryPath };
}
const generated = (rows) => rows.filter((row) => row.facts?.sourceNamespace === 'synthetic:stock-generator.v1');
const shape = (rows) => rows.map((row) => [row.configurationId, fact(row, 'leadTimeWeeks'), fact(row, 'plannedRelease').windowStart, fact(row, 'confirmedDeliveryWeek')]);

test('retained-corpus plan is deterministic, capped per colour and records the coverage gap honestly', async () => {
  const { built } = await realStock();
  assert.equal(built.status, 'ok', JSON.stringify(built));
  const { plan, coverage } = built.value;
  assert.equal(plan.kind, 'retained-corpus'); assert.match(plan.source, /^FUCQ-61 retained corpus server\/data\/gcsp\/vehicle-evidence\/fleet-source\.v1$/);
  assert.deepEqual(Object.keys(plan.aggregateKeys).sort(), ['f70-sports-hatch', 'g42-coupe', 'g61-i5']);
  const groups = new Map();
  for (const row of plan.configurations) groups.set(`${row.modelLineId}|${row.colour}`, (groups.get(`${row.modelLineId}|${row.colour}`) || 0) + 1);
  assert.ok([...groups.values()].every((count) => count >= 1 && count <= 8));
  assert.equal(coverage.coveredCount, 3); assert.equal(coverage.totalCount, 31);
  assert.deepEqual(coverage.schemeModelLines.filter((row) => row.covered).map((row) => row.title).sort(), ['F70 Sports Hatch', 'G42 Coupe', 'G61 i5']);
  assert.deepEqual(coverage.excluded.unmappedGeneration, { G23: 1 });
  const again = await (await import('../gcsp/vehicle-evidence/stock-configuration-plan.js')).buildRetainedCorpusPlan({
    root: (await import('../gcsp/vehicle-evidence/local-vehicle-lookup.js')).DEFAULT_VEHICLE_CORPUS_ROOT, policyService: (await realStock()).policy, read: (await realStock()).read });
  assert.deepEqual(again.value, built.value);
});

test('seeded stock from the real seed and corpus is reproducible, seed-sensitive and within the planned aggregates', async () => {
  const a = await realRun([['run-a', 'real-seed']]); const b = await realRun([['run-a', 'real-seed']]);
  const other = await realRun([['run-a', 'another-real-seed']]);
  assert.equal(a.outcomes[0].status, 'ok', JSON.stringify(a.outcomes[0]));
  assert.deepEqual(a.outcomes[0].value.report, b.outcomes[0].value.report);
  const rows = generated((await a.repository.query(context('run-a'), 'stock')).value);
  assert.deepEqual(shape(rows), shape(generated((await b.repository.query(context('run-a'), 'stock')).value)));
  assert.notDeepEqual(shape(rows), shape(generated((await other.repository.query(context('run-a'), 'stock')).value)));
  const planned = new Set(a.plan.configurations.map((row) => row.configurationId));
  for (const row of rows) {
    assert.ok(planned.has(row.configurationId));
    assert.ok(['ok', 'complete', 'partial'].includes(a.registry.getConfiguration(row.configurationId).status));
    assert.equal(fact(row, 'stockIdentityKind'), 'synthetic');
    for (const key of ['vin', 'vin17', 'vin7']) assert.equal(row[key], undefined);
  }
  const report = a.outcomes[0].value.report;
  assert.equal(report.configurationSource.kind, 'retained-corpus'); assert.equal(report.models.length, 3);
  assert.equal(report.totalCars, rows.length);
  for (const model of report.models) {
    const aggregate = (await a.policy.getAssumption(`stock.aggregate.${model.modelLineId}`, { runId: 'run-a', asOf: at, policyVersion: a.policyVersion })).value;
    assert.equal(aggregate.status, 'observed aggregate'); assert.equal(model.sourceKind, 'observed-aggregate');
    assert.equal(model.observed.sampleDate, '2026-11-08'); assert.ok(model.observed.requestCount > 0);
    assert.ok(model.coveredColourShare > 0 && model.coveredColourShare <= 1 && model.uncoveredColourCount >= 0);
    const own = rows.filter((row) => fact(row, 'modelLine') === a.plan.titles[model.modelLineId]);
    assert.equal(own.length, model.cars);
    for (const row of own) {
      const lead = fact(row, 'leadTimeWeeks');
      assert.ok(lead >= model.observed.leadTimeWeeks.min && lead <= model.observed.leadTimeWeeks.max);
    }
    if (model.cars < 20) continue;
    assert.ok(Math.abs(model.actualShare - model.observedShare) <= 0.05);
    for (const [colour, share] of Object.entries(model.plannedColourShares)) {
      const actual = own.filter((row) => fact(row, 'colour') === colour).length / own.length;
      assert.ok(Math.abs(actual - share) <= 0.05, `${model.modelLineId} ${colour}`);
      assert.ok(Math.abs(model.colourShares[colour] - share) <= 0.05);
    }
  }
});

test('observed colours without a configuration are dropped, the rest renormalised and reported', async () => {
  const seed = await policyFixture();
  seed.assumptions.find((row) => row.key === 'stock.aggregate.fixture-a').value.colourShares = { White: 0.5, Black: 0.3, Red: 0.2 };
  const env = await setup({ seeds: [seed] });
  const result = await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1');
  assert.equal(result.status, 'ok', JSON.stringify(result));
  const model = result.value.report.models.find((row) => row.modelLineId === 'fixture-a');
  assert.deepEqual(Object.keys(model.plannedColourShares).sort(), ['Black', 'White']);
  assert.ok(Math.abs(model.plannedColourShares.White - 0.625) < 1e-9 && Math.abs(model.plannedColourShares.Black - 0.375) < 1e-9);
  assert.equal(model.coveredColourShare, 0.8); assert.equal(model.uncoveredColourCount, 1);
  assert.equal(Object.hasOwn(model.colourShares, 'Red'), false);
  for (const [colour, share] of Object.entries(model.plannedColourShares)) assert.ok(Math.abs(model.colourShares[colour] - share) <= 0.05);
  const other = result.value.report.models.find((row) => row.modelLineId === 'fixture-b');
  assert.equal(other.coveredColourShare, 1); assert.equal(other.uncoveredColourCount, 0);
  const none = await policyFixture();
  none.assumptions.find((row) => row.key === 'stock.aggregate.fixture-a').value.colourShares = { Red: 0.5, Green: 0.5 };
  const refused = await setup({ seeds: [none] });
  assert.equal((await refused.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).code, 'unsupported-configuration-coverage');
  assert.equal((await stock(refused.repository, 'run-a')).length, 0);
});

test('a retained-corpus assumed aggregate may not claim a sample, and fixtures cannot pose as assumed aggregates', async () => {
  const plan = { ...structuredClone(configurationPlan), kind: 'retained-corpus' };
  const fixture = await setup({ plan });
  assert.equal((await fixture.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).code, 'aggregate-provenance-mismatch');
  const claimed = await policyFixture();
  for (const row of claimed.assumptions.filter((entry) => entry.key.startsWith('stock.aggregate.'))) row.value.sourceKind = 'assumed-aggregate';
  const sampled = await setup({ seeds: [claimed], plan });
  assert.equal((await sampled.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).code, 'unsupported-stock-aggregate');
  for (const row of claimed.assumptions.filter((entry) => entry.key.startsWith('stock.aggregate.'))) { delete row.value.sampleDate; delete row.value.requestCount; }
  const assumed = await setup({ seeds: [claimed], plan });
  assert.equal((await assumed.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
});

test('a retained-corpus observed aggregate needs the observed aggregate status and sourceKind together', async () => {
  const plan = { ...structuredClone(configurationPlan), kind: 'retained-corpus' };
  const seed = await policyFixture();
  const rows = seed.assumptions.filter((entry) => entry.key.startsWith('stock.aggregate.'));
  for (const row of rows) row.value.sourceKind = 'observed-aggregate';
  const mismatched = await setup({ seeds: [seed], plan });
  assert.equal((await mismatched.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).code, 'aggregate-provenance-mismatch');
  for (const row of rows) row.status = 'observed aggregate';
  const observed = await setup({ seeds: [seed], plan });
  const result = await observed.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1');
  assert.equal(result.status, 'ok', JSON.stringify(result));
  assert.ok(result.value.report.models.every((model) => model.sourceKind === 'observed-aggregate'));
  assert.ok(result.value.report.policyProvenance.filter((row) => row.key.startsWith('stock.aggregate.')).every((row) => row.status === 'observed aggregate'));
});

// ---- Generated rows on the existing release path (FUCQ-92 service, pull port) ----
const GENERATOR_NAMESPACE = 'synthetic:stock-generator.v1';
const keysDeep = (value) => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => [key, ...keysDeep(child)]) : []);
const corpusDigest = async () => {
  const { DEFAULT_VEHICLE_CORPUS_ROOT } = await import('../gcsp/vehicle-evidence/local-vehicle-lookup.js');
  const active = JSON.parse(await readFile(join(DEFAULT_VEHICLE_CORPUS_ROOT, 'active.json'), 'utf8'));
  return inputDigest([active, (await readFile(join(DEFAULT_VEHICLE_CORPUS_ROOT, 'versions', active.selected.directory, 'configurations.jsonl'))).toString('base64')]);
};

test('generated stock is released by the existing release service in the runtime, with facts unchanged', async (t) => {
  const { registry, built } = await realStock();
  const { createGcspRuntime } = await import('../gcsp/runtime.js');
  const { createGeneratedStockProvider } = await import('../gcsp/stock/index.js');
  const { validatePull } = await import('../gcsp/stock/port.js');
  const repository = createMemoryRepository({ store: createMemoryStore() });
  let source;
  const runtime = await createGcspRuntime({ mode: 'memory', repository, stockProvider: { pull: (request) => source.pull(request) },
    environmentId: 'generated-release', policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'generated-release-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  t.after(() => runtime.value.close());
  const { clock, identity, stockRelease, policy } = runtime.value;
  assert.equal((await stockRelease.register()).status, 'ok');
  const presenter = (await identity.createPresenterSession('generated-release-presenter')).value;
  const ctx = presenter.context; const state = (await clock.readState(ctx)).value;
  const run = (await repository.read(ctx, { table: 'runs', key: { runId: state.runId } })).value;
  assert.equal(run.corpusVersion, CLOCK_CORPUS, 'the run carries the clock scenario corpus, not the generator corpus');
  const clockRows = (await repository.query(ctx, 'stock')).value;
  assert.ok(clockRows.length > 0 && clockRows.every((row) => row.state === 'unreleased'));
  const directory = await mkdtemp(join(tmpdir(), 'stock-generation-release-')); allocationRoots.push(directory);
  const allocationInventoryPath = join(directory, 'inventory.json');
  await writeFile(allocationInventoryPath, canonicalAllocationContent(emptyAllocationInventory()));
  const visibility = { companyIds: ['demo-bmw-fs-uk'], schemeIds: ['choices-fs-uk'], employeeIds: null };
  const generator = generatorModule.createStockGenerator({ repository, registry, policyService: policy, contextForRun: () => ctx,
    configurationPlan: built.value.plan, stockAccount: 'fictional-scheme-stock', allocationInventoryPath, visibility });
  const generation = await generator.generateStock(state.runId, 'release-seed', run.policyVersion);
  assert.equal(generation.status, 'ok', JSON.stringify(generation));
  const before = new Map(generated((await repository.query(ctx, 'stock')).value).map((row) => [row.orderUuid, row]));
  assert.equal(before.size, generation.value.generated);
  assert.ok([...before.values()].every((row) => row.state === 'unreleased' && row.release === undefined && row.visibility.schemeIds[0] === 'choices-fs-uk'));
  source = createGeneratedStockProvider({ repository, contextForRun: () => ctx });
  const [first] = generation.value.report.release.windows;
  const request = { runId: state.runId, asOf: first, releaseSize: 20, released: [], queuedSupply: [], policyVersion: run.policyVersion };
  const early = validatePull(await source.pull({ ...request, asOf: '2026-11-05T09:30:00.000Z' }), { ...request, asOf: '2026-11-05T09:30:00.000Z' });
  assert.equal(early.status, 'ok'); assert.equal(early.value.tranche, null);
  const pulled = validatePull(await source.pull(request), request);
  assert.equal(pulled.status, 'ok', JSON.stringify(pulled));
  assert.ok(pulled.value.tranche.orderUuids.length > 0 && pulled.value.tranche.orderUuids.length <= request.releaseSize);
  const tick = await clock.advanceAndTick(ctx, { commandId: 'generated-release-tick', expectedClockVersion: state.clockVersion, mode: 'to', to: first });
  assert.equal(tick.status, 'ok', JSON.stringify(tick));
  const outcome = tick.value.tick.outcomes.find((row) => row.handlerId === 'stock-release').outcome;
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); assert.equal(outcome.value.kind, 'stock-released');
  assert.deepEqual([...outcome.value.orderUuids].sort(), [...pulled.value.tranche.orderUuids].sort());
  const after = (await repository.query(ctx, 'stock')).value;
  for (const row of generated(after)) {
    const wasReleased = outcome.value.orderUuids.includes(row.orderUuid);
    assert.equal(row.state, wasReleased ? 'released' : 'unreleased');
    assert.deepEqual(row.facts, before.get(row.orderUuid).facts);
    assert.equal(row.release === undefined, !wasReleased);
  }
  assert.ok(after.filter((row) => !generated([row]).length).every((row) => row.state === 'unreleased'), 'clock fixture rows stay unreleased');
});

test('regenerating another run leaves the first run and the retained corpus unchanged', async () => {
  const corpusBefore = await corpusDigest();
  const first = await realRun([['run-a', 'real-seed']], { runIds: ['run-a', 'run-b'] });
  assert.equal(first.outcomes[0].status, 'ok', JSON.stringify(first.outcomes[0]));
  const runA = await stock(first.repository, 'run-a');
  const store = first.repository;
  assert.equal(generated(runA).length, first.outcomes[0].value.generated);
  const { createStockGenerator } = generatorModule;
  const second = createStockGenerator({ repository: store, registry: first.registry, policyService: first.policy, contextForRun: context,
    configurationPlan: first.plan, stockAccount: 'fictional-scheme-stock', allocationInventoryPath: first.allocationInventoryPath });
  const again = await second.generateStock('run-b', 'another-seed', first.policyVersion);
  assert.equal(again.status, 'ok', JSON.stringify(again));
  assert.deepEqual(await stock(store, 'run-a'), runA);
  assert.ok(generated(await stock(store, 'run-b')).length > 0);
  assert.equal(await corpusDigest(), corpusBefore);
});

test('one policy entry changes the next run only: i5 lead times follow the new aggregate, earlier rows keep theirs', async () => {
  const { policyVersion } = await realStock();
  const { PolicyService, FilePolicyProvider } = await import('../gcsp/policy/index.js');
  const [first] = await new FilePolicyProvider().loadVersions();
  const changed = structuredClone(first); changed.policyVersion = 'gcsp-policy-v2-test'; changed.effectiveFrom = '2026-11-06T00:00:00.000Z';
  for (const table of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
    for (const row of changed[table]) row.policyVersion = changed.policyVersion;
  }
  const i5 = changed.assumptions.find((row) => row.key === 'stock.aggregate.g61-i5');
  const was = structuredClone(first.assumptions.find((row) => row.key === 'stock.aggregate.g61-i5').value.leadTimeWeeks);
  i5.value.leadTimeWeeks = { min: 20, max: 24 };
  const policy = new PolicyService({ provider: { async loadVersions() { return [first, changed]; } } });
  const env = await realRun([['run-a', 'real-seed'], ['run-c', 'real-seed']], { runIds: ['run-a', 'run-c'], policy, versions: { 'run-c': changed.policyVersion } });
  assert.deepEqual(env.outcomes.map((row) => row.status), ['ok', 'ok'], JSON.stringify(env.outcomes));
  const lead = (rows) => generated(rows).filter((row) => fact(row, 'modelLine') === 'G61 i5').map((row) => fact(row, 'leadTimeWeeks'));
  const a = lead(await stock(env.repository, 'run-a')); const c = lead(await stock(env.repository, 'run-c'));
  assert.ok(a.length > 0 && c.length > 0);
  assert.ok(c.every((weeks) => weeks >= 20 && weeks <= 24));
  assert.ok(a.every((weeks) => weeks >= was.min && weeks <= was.max));
  assert.ok(generated(await stock(env.repository, 'run-a')).every((row) => fact(row, 'policyVersion') === policyVersion));
  assert.ok(generated(await stock(env.repository, 'run-c')).every((row) => fact(row, 'policyVersion') === changed.policyVersion));
});

test('generated facts are a valid synthetic VehicleSnapshot with no VIN key, and the extra-facts seam cannot override generator facts', async () => {
  const { createVehicleSnapshot } = await import('../vehicles/index.js');
  const seam = (binding) => ({ eligibilityModelKey: `key-${binding.modelLineId}`, body: 'hatch', boot: { value: 300, unit: 'L' } });
  const env = await realRun([['run-a', 'real-seed']], { factsForConfiguration: seam });
  assert.equal(env.outcomes[0].status, 'ok', JSON.stringify(env.outcomes[0]));
  const rows = generated(await stock(env.repository, 'run-a'));
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.deepEqual(createVehicleSnapshot(structuredClone(row.facts)), row.facts);
    assert.equal(row.facts.identityKind, 'exact-stock'); assert.equal(row.facts.sourceKeys.stockId, row.orderUuid);
    assert.equal(fact(row, 'stockIdentityKind'), 'synthetic');
    assert.equal(row.facts.facts.leadTimeWeeks.unit, 'weeks');
    assert.equal(row.facts.display.name, `${fact(row, 'modelLine')} in ${fact(row, 'colour')}`);
    assert.match(fact(row, 'eligibilityModelKey'), /^key-/); assert.equal(fact(row, 'boot'), 300);
    assert.ok(keysDeep(row).every((key) => !['vin', 'vin7', 'vin17'].includes(key.toLowerCase())));
    assert.ok(row.facts.facts.plannedRelease.value.releaseId.startsWith('run-a:stock:'));
  }
  for (const bad of [{ colour: 'Hijack' }, { leadTimeWeeks: 1 }, { vin: 'X' }, { x: null }]) {
    const refused = await realRun([['run-a', 'real-seed']], { factsForConfiguration: () => bad });
    assert.equal(refused.outcomes[0].status, 'invalid', JSON.stringify(bad));
    assert.equal(generated(await stock(refused.repository, 'run-a')).length, 0);
    assert.equal((await readAllocationInventory(refused.allocationInventoryPath)).inventory.records.length, 0, 'refused before reserving identifiers');
  }
});

test('a run that already holds generator rows refuses a second generation, while clock fixture rows do not', async () => {
  const env = await setup();
  const insert = (row) => env.repository.transaction(context('run-a'), { commandId: `seed-${row.orderUuid}`, inputDigest: inputDigest(row) }, (tx) => tx.insert('stock', row));
  assert.equal((await insert({ ...clockFixtureRow('run-a'), corpusVersion: 'synthetic-clock-corpus-v1' })).status, 'ok');
  const outcome = await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1');
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
  assert.equal((await stock(env.repository, 'run-a')).filter((row) => row.facts.sourceNamespace === GENERATOR_NAMESPACE).length, 350);
  const other = await setup();
  const planted = { ...clockFixtureRow('run-b'), orderUuid: '22222222-2222-4222-8222-222222222222', orderNumber: '1000002',
    facts: { sourceNamespace: GENERATOR_NAMESPACE } };
  assert.equal((await other.repository.transaction(context('run-b'), { commandId: 'plant', inputDigest: inputDigest(planted) }, (tx) => tx.insert('stock', planted))).status, 'ok');
  const refused = await other.generator.generateStock('run-b', 'fixture', 'fixture-policy-v1');
  assert.equal(refused.status, 'conflict'); assert.equal(refused.reason, 'stock-generation-exists');
});

test('the pull port accepts real corpus identifiers up to 4096 characters, and the provider needs generated rows and a context', async () => {
  const { validCar } = await import('../gcsp/stock/port.js');
  const { createGeneratedStockProvider } = await import('../gcsp/stock/generated-provider.js');
  const car = { orderUuid: 'a1b2c3d4-0000-4000-8000-000000000001', orderNumber: '1234567', configurationId: 'c'.repeat(4096) };
  assert.equal(validCar(car), true);
  assert.equal(validCar({ ...car, configurationId: 'c'.repeat(4097) }), false);
  assert.equal(validCar({ ...car, configurationId: '' }), false);
  const env = await setup();
  const request = { runId: 'run-a', asOf: at, releaseSize: 20, released: [], queuedSupply: [], policyVersion: 'fixture-policy-v1' };
  assert.equal((await createGeneratedStockProvider({ repository: env.repository }).pull(request)).status, 'unavailable');
  assert.equal((await createGeneratedStockProvider({ repository: env.repository, contextForRun: context }).pull(request)).status, 'unavailable', 'no generated rows yet');
  assert.equal((await env.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
  const pulled = await createGeneratedStockProvider({ repository: env.repository, contextForRun: context }).pull(
    { ...request, asOf: '2026-12-01T00:00:00.000Z' });
  assert.equal(pulled.status, 'ok');
  assert.equal(pulled.value.tranche.orderUuids.length, 20);
  assert.equal(pulled.value.stock.length, 20);
  const earliest = generated(await stock(env.repository, 'run-a')).filter((row) => fact(row, 'plannedRelease').windowStart === pulled.value.tranche.availableAt)
    .sort((x, y) => (x.orderNumber < y.orderNumber ? -1 : 1))[0];
  assert.equal(pulled.value.tranche.windowId, fact(earliest, 'plannedRelease').releaseId);
  assert.equal((await createGeneratedStockProvider({ repository: env.repository, contextForRun: context }).pull({ ...request, runId: 'run-b' })).status, 'unavailable');
});

test('native postgresql: generateStock persists one run-scoped set of synthetic rows', {
  skip: process.env.GCSP_DATABASE_URL === undefined ? 'GCSP_DATABASE_URL is unset; native PostgreSQL generation was not run' : false,
}, async () => {
  const { createPostgresRepository } = await import('../gcsp/repository/postgres.js');
  const schema = `gcsp_stockgen_${process.pid}_1`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  pool.on('error', () => {});
  let created = false;
  const repository = createPostgresRepository({ schema });
  try {
    try { await pool.query(`CREATE SCHEMA "${schema}"`); created = true; }
    catch { throw new Error('PostgreSQL stock-generation fixture unavailable'); }
    assert.equal((await repository.open()).status, 'ok');
    const env = await realRun([['run-a', 'native-seed']], { repository });
    assert.equal(env.outcomes[0].status, 'ok', JSON.stringify(env.outcomes[0]));
    const rows = (await repository.query(context('run-a'), 'stock')).value;
    const own = generated(rows);
    assert.equal(own.length, env.outcomes[0].value.generated);
    assert.equal(rows.length, own.length + 1, 'the clock-like fixture row is the only other row');
    assert.ok(own.every((row) => row.runId === 'run-a' && fact(row, 'stockIdentityKind') === 'synthetic' && row.state === 'unreleased' && row.release === undefined));
    assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM "${schema}".stock`)).rows[0].count, rows.length);
  } finally {
    await repository.close();
    try {
      if (created) {
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        const absent = await pool.query('SELECT count(*)::integer AS count FROM pg_namespace WHERE nspname = $1', [schema]);
        assert.equal(absent.rows[0].count, 0, 'The exact owned stock-generation schema must be absent.');
      }
    }
    catch { throw new Error('PostgreSQL stock-generation fixture cleanup incomplete'); }
    finally { await pool.end(); }
  }
});
