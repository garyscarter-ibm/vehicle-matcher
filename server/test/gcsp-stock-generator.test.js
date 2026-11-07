import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    assert.equal(row.facts.syntheticIdentity.identityKind, 'synthetic');
    assert.equal(row.facts.stockGeneration.identityKind, 'synthetic');
    assert.equal(row.state, 'unreleased'); assert.equal(row.available, false);
    assert.equal(row.account, 'fictional-scheme-stock');
    assert.equal(row.facts.stockGeneration.policyVersion, 'fixture-policy-v1');
    assert.ok(row.facts.stockGeneration.leadTimeWeeks >= 2 && row.facts.stockGeneration.leadTimeWeeks <= 4);
    assert.match(row.facts.stockGeneration.confirmedDeliveryWeek, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Date.parse(row.release.at) >= Date.parse(at));
    assert.equal(row.release.windowStart, row.release.at);
    assert.ok(Date.parse(row.release.windowEnd) > Date.parse(row.release.windowStart));
    assert.equal(new Date(row.facts.stockGeneration.confirmedDeliveryWeek).getUTCDay(), 1);
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
  assert.ok(c.filter((row) => row.facts.stockGeneration.modelLineId === 'fixture-a').every((row) => row.facts.stockGeneration.leadTimeWeeks === 8));
  assert.ok(c.filter((row) => row.facts.stockGeneration.modelLineId === 'fixture-b').every((row) => row.facts.stockGeneration.leadTimeWeeks <= 4));
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
  const plan = structuredClone(configurationPlan); plan.configurations = plan.configurations.filter((row) => row.colour !== 'Black');
  const unsupported = await setup({ plan });
  assert.notEqual((await unsupported.generator.generateStock('run-a', 'fixture', 'fixture-policy-v1')).status, 'ok');
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
  assert.ok((await stock(env.repository, 'run-a')).every((row) => new Date(row.release.at).getUTCDay() === 2));
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
