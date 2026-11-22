// Explicit fixture refresh only: no HTTP server, browser, release, allocation, offer or hold is created here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const reference = process.env.GCSP_NODE_REFERENCE;
assert.ok(reference && path.isAbsolute(reference) && !/OneDrive|CloudStorage/i.test(reference));
assert.ok(process.env.SCRATCH?.startsWith('/private/tmp/'));
const here = path.dirname(fileURLToPath(import.meta.url));
const load = (file) => import(pathToFileURL(path.join(reference, file)).href);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const must = (value, step) => { assert.equal(value?.status, 'ok', `${step}: ${value?.code ?? value?.reason ?? value?.status}`); return value.value; };
const { createGcspRuntime } = await load('server/gcsp/runtime.js');
const { createRunStockProviderFactory } = await load('server/gcsp/stock/run-stock.js');
const { createDemoUpstream } = await load('server/gcsp/stock/demo-provider.js');
const { createMemoryStore, createMemoryRepository } = await load('server/gcsp/repository/memory.js');
const { SCENARIO_INPUTS_V1 } = await load('server/gcsp/fixtures/scenarios/catalogue-v1.js');
const { STOCK_FIELDS } = await load('server/gcsp/stock/port.js');
const store = createMemoryStore();
const repository = createMemoryRepository({ store });
const factory = createRunStockProviderFactory({ env: { ...process.env, GCSP_STOCK_INVENTORY_PATH: path.join(process.env.SCRATCH, 'stock-inventory.json') } });
const opened = await createGcspRuntime({ mode: 'memory', repository, environmentId: 'f548-frozen-main-input',
  commandId: 'f548-frozen-main-input', policyAsOf: new Date().toISOString(), wallNow: () => new Date(), stockProvider: factory, production: createDemoUpstream().production,
  offerLandingUrl: 'https://gcsp-proof.example.test/gcsp-offer.html', adoptOfferJourney: true,
  mail: { env: { GCSP_PUBLIC_ORIGIN: 'http://127.0.0.1:7548' } } });
const runtime = must(opened, 'frozen runtime');
try {
  let control = must(await runtime.identity.createPresenterSession('f548-input-presenter'), 'presenter').context;
  const catalogue = must(await runtime.scenarios.readCatalogue(control), 'catalogue');
  const selected = catalogue.scenarios.find((item) => item.scenarioId === 'main-successful-journey');
  const state = must(await runtime.scenarios.readState(control), 'initial clock');
  const reset = must(await runtime.scenarios.reset(control, { commandId: 'f548-captured-main', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioId: selected.scenarioId, scenarioVersion: selected.scenarioVersion,
    fixtureVersion: selected.fixtureVersion, policyVersion: selected.policyVersion }), 'Main reset');
  assert.equal(reset.startState.status, 'ok', 'The frozen named loader must confirm the actual Main initial brief');
  control = must(await runtime.identity.createPresenterSession('f548-input-current-presenter'), 'fresh presenter').context;
  const clock = must(await runtime.scenarios.readState(control), 'Main clock');
  const run = must(await repository.read(control, { table: 'runs', key: { runId: control.runId } }), 'Main clock input');
  const employee = must(await runtime.identity.resolveEmployeeContext(control, 'employee-paula'), 'Paula context');
  const initialBrief = must(await runtime.brief.readCurrent(employee), 'Main initial brief');
  const account = must(await runtime.account.readAccount(employee), 'Main account');
  const scenario = SCENARIO_INPUTS_V1.find((item) => item.scenarioId === 'main-successful-journey');
  const controls = must(await runtime.clock.readControlsConfiguration(control), 'Main presenter controls');
  assert.equal(controls.nextRelease.status, 'available');
  const release = controls.nextRelease.at;
  const pulled = must(await factory.provider.pull({ runId: control.runId, asOf: release, policyVersion: control.policyVersion,
    releaseSize: 100, released: [], queuedSupply: [] }), 'first raw stock pull');
  assert.ok(pulled.tranche && pulled.stock.length, 'The actual frozen source supplies the initial release: ' + JSON.stringify({
    release, clock: run.versions.scenarioClock, source: factory.provider.describe?.(control.runId),
    planned: must(await repository.query(control, 'stock'), 'source stock rows').slice(0, 2).map((row) => row.facts?.facts?.plannedRelease?.value),
  }));
  // This is the frozen generated-provider.js planFor mapping, over the full captured instance.
  // It preserves raw facts/IDs and all windows; no release/offer/hold outcome is synthesized.
  const sourceRows = must(await repository.query(control, 'stock'), 'full generated stock').filter((row) =>
    row.facts?.sourceNamespace === 'synthetic:stock-generator.v1' && row.facts.facts?.plannedRelease?.value)
    .sort((a, b) => a.orderNumber < b.orderNumber ? -1 : a.orderNumber > b.orderNumber ? 1 : 0);
  assert.ok(sourceRows.length, 'A generated instance is required, rather than an unnoticed demo-source fallback');
  const groups = new Map();
  for (const row of sourceRows) {
    const at = row.facts.facts.plannedRelease.value.windowStart;
    groups.set(at, [...(groups.get(at) ?? []), row]);
  }
  const windows = [...groups.entries()].sort(([a], [b]) => Date.parse(a) - Date.parse(b)).map(([availableAt, members]) => ({
    windowId: members[0].facts.facts.plannedRelease.value.releaseId, availableAt, supplyId: null,
    stock: members.map((row) => ({ ...Object.fromEntries(STOCK_FIELDS.filter((key) => row[key] !== undefined && key !== 'availability')
      .map((key) => [key, row[key]])), availability: { availableUntil: `${row.facts.facts.confirmedDeliveryWeek.value}T00:00:00.000Z` } })),
  }));
  const plan = { label: pulled.source.label, version: pulled.source.version, windows };
  assert.deepEqual(windows[0].stock.slice(0, pulled.stock.length), pulled.stock, 'Retained mapping matches the actual first pull');
  const bytes = Buffer.from(JSON.stringify(plan) + '\n');
  const compressed = gzipSync(bytes, { level: 9 });
  assert.ok(compressed.length <= 8 * 1024 * 1024 && bytes.length <= 256 * 1024 * 1024,
    `Stock fixture bound: ${bytes.length} raw bytes, ${compressed.length} compressed bytes`);
  // Explicit whitelist: memory/session/cookie stores are never serialized.
  const input = { schemaVersion: 1, reference: { commit: 'e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38',
      capturedAt: new Date().toISOString(), runId: control.runId,
      sourceFiles: Object.fromEntries(['server/gcsp/fixtures/scenarios/catalogue-v1.js', 'server/gcsp/scenarios/brief-start.js',
        'server/gcsp/stock/generated-provider.js', 'server/gcsp/stock/run-stock-generation.js'].map((file) => [file, sha(readFileSync(path.join(reference, file)))])),
      stockSource: factory.provider.describe?.(control.runId) ?? null },
    scenario, clock: { now: clock.now, clockVersion: clock.clockVersion, startsAt: run.versions.scenarioClock.startsAt,
      namedTimes: run.versions.scenarioClock.namedTimes, nextRelease: controls.nextRelease, policyVersion: control.policyVersion },
    initialBrief, account,
    stockPlan: { file: 'main-stock-plan.json.gz', sha256: sha(bytes), bytes: bytes.length,
      compressedSha256: sha(compressed), compressedBytes: compressed.length, stockCount: sourceRows.length, windowCount: windows.length,
      closure: 'Full exact generated source instance, all planned windows, captured before release.' },
    replay: 'Frozen createGcspRuntime stockProvider seam + createSyntheticStockProvider; Java existing tranche-plan provider. Only run/environment identifiers are mapped.' };
  const tables = store.state.tables;
  for (const [name, rows] of Object.entries(tables).filter(([name]) => /^(offers|holds|allocations|buddy_offers|buddy_holds)$/.test(name))) {
    assert.equal(rows.length, 0, `Capture contains no computed ${name}`);
  }
  writeFileSync(path.join(here, 'main-stock-plan.json.gz'), compressed);
  writeFileSync(path.join(here, 'main-inputs.json'), JSON.stringify(input, null, 2) + '\n');
  console.log(JSON.stringify({ stockCount: sourceRows.length, stockBytes: bytes.length, compressedBytes: compressed.length, sha256: sha(bytes),
    source: input.reference.stockSource, clock: input.clock, noOfferOrHoldInput: true }));
} finally { await runtime.close(); }
