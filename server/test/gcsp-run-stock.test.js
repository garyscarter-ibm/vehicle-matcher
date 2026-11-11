// FUCQ-92: the run-level stock source. Memory repository, no network, no PostgreSQL URL.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, ok, result } from '../gcsp/repository/index.js';
import { PolicyService, createPolicyService } from '../gcsp/policy/index.js';
import { createPresenterControlsService } from '../gcsp/presenter-controls/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createRunStockProvider, createRunStockProviderFactory } from '../gcsp/stock/index.js';
import { createReleaseGuarantee } from '../gcsp/stock/release-guarantee.js';
import { STOCK_GENERATOR_NAMESPACE } from '../gcsp/vehicle-evidence/stock-generator.js';

const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const roots = [];
after(async () => { for (const directory of roots) await rm(directory, { recursive: true, force: true }); });
const quiet = () => {};

async function alternativePolicy(edit) {
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  edit((key) => seed.assumptions.find((entry) => entry.key === key));
  return new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
}

// Composes the real runtime with a per-test inventory file; `source` builds the stock provider from the runtime deps.
async function compose(t, { source, policy, environmentId = 'run-stock', directory: shared, logger = quiet } = {}) {
  const directory = shared ?? await mkdtemp(join(tmpdir(), 'gcsp-run-stock-')); if (!shared) roots.push(directory);
  const factory = createRunStockProviderFactory({ env: { GCSP_STOCK_INVENTORY_PATH: join(directory, 'inventory.json') }, logger });
  const repository = createMemoryRepository({ store: createMemoryStore() });
  const opened = good(await createGcspRuntime({ mode: 'memory', repository, ...(policy ? { policy } : {}), environmentId,
    stockProvider: source ? (deps) => source(deps, directory) : factory, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: `${environmentId}-bootstrap`,
    sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => opened.close());
  good(await opened.stockRelease.register());
  const presenter = good(await opened.identity.createPresenterSession(`${environmentId}-presenter`));
  const state = good(await opened.clock.readState(presenter.context));
  const controls = createPresenterControlsService({ clock: opened.clock, identity: opened.identity, scenarios: opened.scenarios });
  return { ...opened, factory, repository, context: presenter.context, runId: state.runId, controls, directory,
    stock: async (context = presenter.context) => good(await repository.query(context, 'stock')) };
}
const generatedRows = (rows) => rows.filter((row) => row.facts?.sourceNamespace === STOCK_GENERATOR_NAMESPACE);
const factOf = (row, name) => row.facts.facts?.[name]?.value;
const tick = async (f, commandId, mode = 'next-release') => {
  const state = good(await f.clock.readState(f.context));
  return f.clock.advanceAndTick(f.context, { commandId, expectedClockVersion: state.clockVersion, mode });
};
const releaseOutcome = (reply) => reply.value.tick.outcomes.find((row) => row.handlerId === 'stock-release').outcome;

test('default run: generated stock, Next release at the first cadence window, replay inserts nothing', async (t) => {
  const f = await compose(t);
  assert.deepEqual(f.factory.provider.describe(f.runId), { source: 'generated', reason: 'Stock generated for the run.' });
  const rows = generatedRows(await f.stock());
  assert.ok(rows.length > 100 && rows.every((row) => row.state === 'unreleased'), `generated ${rows.length}`);
  const run = good(await f.repository.read(f.context, { table: 'runs', key: { runId: f.runId } }));
  const windows = run.versions.stockGeneration.report.release.windows;
  const controls = good(await f.controls.readState(f.context)).controls;
  assert.deepEqual(controls.nextRelease, { status: 'available', to: 'release-window', at: windows[0] });
  const size = good(await f.policy.getAssumption('supply.release.size', { runId: f.runId, asOf: run.clockInstant, policyVersion: run.policyVersion })).value;
  const firstWindow = rows.filter((row) => factOf(row, 'plannedRelease').windowStart === windows[0]);
  const paula = good(await f.identity.switchPrincipal(f.context, 'demo-paula', 'acting-paula'));
  good(await seedManualDemoContext({ repository: f.repository, identity: f.identity, clock: f.clock, context: paula.context }));
  const account = good(await f.manualRead.readAccount(paula.context));
  const action = account.actions.find((entry) => entry.enabled);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee');
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(paula.context.schemeId) && entry.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  good(await f.manualRead.saveDraft(paula.context, { commandId: 'run-stock-draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion,
    choices: { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId,
      driverId: driver.driverId, contractOptionId: option.contractOptionId, requestedCollectionDate: '2026-11-16', // inside the window on every release day
      collectionLocationId: location.locationId, brand: account.choices.brands[0], contact: account.account.contact,
      expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' } }));
  const before = good(await f.clock.readState(f.context));
  const first = await tick(f, 'run-stock-release-1');
  const outcome = releaseOutcome(first);
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); assert.equal(outcome.value.kind, 'stock-released');
  assert.equal(outcome.value.releasedAt, windows[0]);
  assert.equal(outcome.value.orderUuids.length, Math.min(size, firstWindow.length));
  const released = (await f.stock()).filter((row) => row.state === 'released');
  assert.deepEqual(released.map((row) => row.orderUuid).sort(), [...outcome.value.orderUuids].sort());
  for (const row of released) {
    assert.match(row.orderUuid, /^[0-9a-f-]{36}$/); assert.match(row.orderNumber, /^\d{7}$/); assert.ok(row.configurationId);
    assert.equal(factOf(row, 'plannedRelease').windowStart, windows[0]);
  }
  const receipts = good(await f.repository.query(f.context, 'event_receipts', { consumerId: 'stock-release', state: 'completed' }));
  assert.equal(receipts.length, 1); assert.equal(receipts[0].outcome.value.kind, 'stock-released');
  // The manual gallery, as the runtime composes it, reads the released generated cars.
  const gallery = good(await f.manualRead.browseStock(paula.context));
  assert.equal(gallery.releaseHistory.history.releasedCarCount, released.length);
  assert.ok(gallery.decisions.length > 0 && gallery.decisions.length <= released.length);
  assert.ok(gallery.decisions.every((entry) => released.some((row) => row.orderUuid === entry.orderUuid)), 'only generated released cars');
  assert.ok(gallery.decisions.every((entry) => entry.snapshot.display.photo
    && entry.snapshot.display.images[0].src === entry.snapshot.display.photo), 'released gallery retains every picture');
  // The same command replays; a later Next release moves to the next window.
  const again = await f.clock.advanceAndTick(f.context, { commandId: 'run-stock-release-1', expectedClockVersion: before.clockVersion, mode: 'next-release' });
  assert.equal(again.status, 'ok', JSON.stringify(again));
  assert.deepEqual(again, first);
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, released.length);
  assert.equal(good(await f.controls.readState(f.context)).controls.nextRelease.at, windows[1]);
});

test('every generated car retains its configuration picture in its stock snapshot', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-pictures' });
  const rows = generatedRows(await f.stock()); assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.match(row.facts.display.photo ?? '', /^\/assets\/gcsp-vehicle-evidence\/[0-9a-f]{64}\.webp$/);
    assert.equal(row.facts.display.images[0].src, row.facts.display.photo);
    assert.ok(['representative-configuration', 'representative-model'].includes(row.facts.display.images[0].fidelity));
  }
});

test('eligibility keys come from policy: evidenced AG codes map, others stay unmapped, one entry changes it', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-keys' });
  const rows = generatedRows(await f.stock());
  const mapped = rows.filter((row) => factOf(row, 'eligibilityModelKey') !== undefined);
  // The demo fleet corpus (11 Nov) carries all seven scheme lines, so every policy key can appear.
  const keys = Object.values((await f.policy.getAssumption('stock.eligibilityModelKeys.v1', { runId: f.runId, asOf: '2026-11-05T09:00:00.000Z' })).value.value);
  assert.ok(mapped.length > 0, 'evidenced cars are mapped');
  assert.ok(mapped.every((row) => keys.includes(factOf(row, 'eligibilityModelKey')) && factOf(row, 'body') !== undefined && factOf(row, 'seats') > 0), JSON.stringify([...new Set(mapped.map((r) => [factOf(r, 'eligibilityModelKey'), factOf(r, 'body'), factOf(r, 'seats'), factOf(r, 'fuel')].join(',')))]));
  const i5 = mapped.filter((row) => factOf(row, 'eligibilityModelKey') === 'G61 i5|i5 40');
  assert.ok(i5.every((row) => factOf(row, 'body') === 'estate' && factOf(row, 'fuel') === 'ev' && factOf(row, 'seats') === 5));
  assert.ok(rows.filter((row) => !mapped.includes(row)).every((row) => factOf(row, 'body') === undefined), 'unmapped cars carry no model facts');
  assert.equal((await tick(f, 'keys-release-1')).status, 'ok');
  assert.equal((await tick(f, 'keys-release-2')).status, 'ok');
  const released = (await f.stock()).filter((row) => row.state === 'released');
  assert.ok(released.some((row) => keys.includes(factOf(row, 'eligibilityModelKey'))), 'a released car is eligible-keyed');
  const policy = await alternativePolicy((entry) => { entry('stock.eligibilityModelKeys.v1').value = { '72HH': 'G21 Touring|320i' }; });
  const changed = await compose(t, { policy, environmentId: 'run-stock-keys-alt' });
  const alt = generatedRows(await changed.stock()).filter((row) => factOf(row, 'eligibilityModelKey') !== undefined);
  assert.ok(alt.length > 0);
  assert.ok(alt.every((row) => factOf(row, 'eligibilityModelKey') === 'G21 Touring|320i' && factOf(row, 'boot') === 500));
});

// FUCQ-229: live-sampled one-week lead times voided the second Next release.
test('generated stock releases on every Next release across the run release windows', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-every-window' });
  const run = good(await f.repository.read(f.context, { table: 'runs', key: { runId: f.runId } }));
  const windows = run.versions.stockGeneration.report.release.windows;
  assert.ok(windows.length >= 2);
  for (const [index, at] of windows.entries()) {
    const reply = await tick(f, `every-window-${index}`);
    assert.equal(reply.status, 'ok', JSON.stringify(reply));
    const outcome = releaseOutcome(reply);
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); assert.equal(outcome.value.kind, 'stock-released');
    assert.equal(outcome.value.releasedAt, at); assert.ok(outcome.value.orderUuids.length > 0);
  }
  const last = Date.parse(windows.at(-1));
  assert.ok(generatedRows(await f.stock()).every((row) => Date.parse(`${factOf(row, 'confirmedDeliveryWeek')}T00:00:00.000Z`) > last));
});

// FUCQ-231: a presenter jump past a delivery week made one expired car void every later pull.
test('a presenter jump past a delivery week still releases the remaining generated cars', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-expired-jump' });
  const until = (row) => Date.parse(`${factOf(row, 'confirmedDeliveryWeek')}T00:00:00.000Z`);
  const rows = generatedRows(await f.stock()).filter((row) => factOf(row, 'plannedRelease'));
  const to = new Date(Math.min(...rows.map(until))).toISOString();
  const ended = rows.filter((row) => until(row) <= Date.parse(to)).map((row) => row.orderUuid).sort();
  assert.ok(ended.length > 0 && ended.length < rows.length, `ended ${ended.length} of ${rows.length}`);
  const jump = async (commandId, at) => {
    const state = good(await f.clock.readState(f.context));
    const reply = await f.clock.advanceAndTick(f.context, { commandId, expectedClockVersion: state.clockVersion, mode: 'to', to: at });
    assert.equal(reply.status, 'ok', JSON.stringify(reply));
    const outcome = releaseOutcome(reply);
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
    return outcome.value;
  };
  const first = await jump('expired-jump', to);
  assert.equal(first.kind, 'stock-released'); assert.ok(first.orderUuids.length > 0);
  assert.ok(first.orderUuids.every((id) => !ended.includes(id)), 'an expired car was released');
  assert.deepEqual([...f.factory.provider.expired(f.runId)], ended);
  const later = await jump('after-expired-jump', new Date(Date.parse(to) + 3600000).toISOString());
  assert.equal(later.kind, 'stock-released', 'later pulls are not wedged');
  const after = generatedRows(await f.stock());
  assert.ok(after.filter((row) => ended.includes(row.orderUuid)).every((row) => row.state === 'unreleased'));
});

test('generation unavailable or not configured falls back to demo stock and says why; a forced demo launcher skips it', async (t) => {
  const logs = [];
  const failing = { generate: async () => result('unavailable', { code: 'forced-failure', retryable: true }) };
  const f = await compose(t, { environmentId: 'run-stock-fallback',
    source: (deps) => createRunStockProvider({ ...deps, generation: failing, logger: (line) => logs.push(line) }) });
  const run = f.runId;
  const described = good(await f.repository.read(f.context, { table: 'runs', key: { runId: run } }));
  assert.equal(generatedRows(await f.stock()).length, 0);
  assert.equal(described.versions.stockGeneration, undefined);
  assert.equal(good(await f.controls.readState(f.context)).controls.nextRelease.to, 'release', 'the named release cue is kept');
  const outcome = releaseOutcome(await tick(f, 'fallback-release-1'));
  assert.equal(outcome.value.kind, 'stock-released');
  assert.equal(outcome.value.source.version, 'demo-synthetic-stock-v1');
  assert.match(outcome.value.source.label, /Synthetic demo stock/);
  assert.equal(logs.length, 1); assert.match(logs[0], new RegExp(`${run}.*forced-failure`));
  // Not configured, and the escape hatch, each choose demo stock; neither asks the generator.
  const unconfigured = await compose(t, { environmentId: 'run-stock-unconfigured', source: (deps) => createRunStockProvider({ ...deps, logger: quiet }) });
  assert.match(releaseOutcome(await tick(unconfigured, 'unconfigured-release-1')).value.source.label, /Synthetic demo stock/);
  const forced = createRunStockProviderFactory({ env: { GCSP_STOCK_SOURCE: 'demo' } });
  const hatch = await compose(t, { environmentId: 'run-stock-forced', source: (deps) => forced(deps) });
  assert.equal(forced.forced, true); assert.equal(forced.provider.describe, undefined);
  assert.equal(generatedRows(await hatch.stock()).length, 0);
});

test('a repository read failure is unavailable and cached nothing; a recovered read then decides once', async () => {
  const policy = createPolicyService();
  const run = { runId: 'flaky-run', clockInstant: '2026-11-05T09:00:00.000Z', policyVersion: 'gcsp-policy-v1', versions: {} };
  let mode = 'fail-query'; let generations = 0;
  const repository = {
    async read() { return mode === 'throw' ? Promise.reject(new Error('boom')) : ok(run); },
    async query() { return mode === 'fail-query' ? result('unavailable', { retryable: true }) : ok([]); },
  };
  const generation = { async generate() { generations += 1; return result('unavailable', { code: 'later' }); } };
  const provider = createRunStockProvider({ policy, repository, generation, logger: quiet,
    contextForRun: (runId) => ({ runId, environmentId: 'e', principalId: 'p', roles: ['presenter'] }) });
  const request = { runId: 'flaky-run', asOf: '2026-11-05T09:30:00.000Z', policyVersion: 'gcsp-policy-v1', releaseSize: 20, released: [], queuedSupply: [] };
  assert.equal((await provider.pull(request)).status, 'unavailable');
  assert.equal(provider.describe('flaky-run'), null); assert.equal(generations, 0);
  mode = 'throw';
  assert.equal((await provider.prepareRun('flaky-run')).status, 'unavailable'); assert.equal(generations, 0);
  mode = 'ok';
  assert.equal((await provider.prepareRun('flaky-run')).value.source, 'demo');
  assert.equal(generations, 1);
  assert.equal((await provider.pull(request)).value.tranche.windowId, 'demo-release-1');
  await provider.prepareRun('flaky-run');
  assert.equal(generations, 1, 'the decision is cached per run');
});

test('a run that already released demo stock never switches to generated', async (t) => {
  const failing = { generate: async () => result('unavailable', { code: 'forced-failure' }) };
  const f = await compose(t, { environmentId: 'run-stock-sticky', source: (deps) => createRunStockProvider({ ...deps, generation: failing, logger: quiet }) });
  assert.equal(releaseOutcome(await tick(f, 'sticky-release-1')).value.kind, 'stock-released');
  let asked = 0;
  const restarted = createRunStockProvider({ policy: f.policy, repository: f.repository, logger: quiet,
    contextForRun: (runId) => ({ runId, environmentId: 'run-stock-sticky', principalId: 'p', roles: ['presenter'] }),
    generation: { generate: async () => { asked += 1; return result('unavailable', { code: 'unexpected' }); } } });
  const decided = good(await restarted.prepareRun(f.runId));
  assert.equal(decided.source, 'demo'); assert.equal(asked, 0);
});

test('a scenario that declares published demo stock keeps the demo provider and its release cue', async () => {
  let asked = 0;
  const run = { runId: 'scenario-run', clockInstant: '2026-11-05T09:00:00.000Z', policyVersion: 'gcsp-policy-v1',
    versions: { scenarioSelection: { scenarioId: 'offer-expires' } } };
  const repository = { read: async () => ok(run), query: async () => ok([]) };
  const provider = createRunStockProvider({ policy: createPolicyService(), repository,
    contextForRun: (runId) => ({ runId, environmentId: 'e', principalId: 'p', roles: ['presenter'] }),
    generation: { generate: async () => { asked += 1; return ok({}); } } });
  const decided = good(await provider.prepareRun('scenario-run'));
  assert.equal(decided.source, 'demo'); assert.equal(asked, 0);
  const cue = good(await createPolicyService().getAssumption('clock.scenario.v1', { runId: 'scenario-run', asOf: run.clockInstant })).value.namedTimes.release;
  const pulled = good(await provider.pull({ runId: 'scenario-run', asOf: cue, policyVersion: 'gcsp-policy-v1', releaseSize: 20, released: [], queuedSupply: [] }));
  assert.equal(pulled.tranche.windowId, 'demo-release-1'); assert.equal(pulled.tranche.availableAt, cue);
});

test('the main successful journey is generated and every release holds 3 cars Paula qualifies for in 3 colours', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-main' });
  const entry = good(await f.scenarios.readCatalogue(f.context)).scenarios.find((row) => row.scenarioId === 'main-successful-journey');
  const state = good(await f.scenarios.readState(f.context));
  const reset = good(await f.scenarios.reset(f.context, { commandId: 'to-main', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioId: entry.scenarioId, scenarioVersion: entry.scenarioVersion, fixtureVersion: entry.fixtureVersion, policyVersion: entry.policyVersion }));
  assert.equal(f.factory.provider.describe(reset.runId)?.source, 'generated');
  const next = good(await f.identity.createPresenterSession('run-stock-main-presenter-2'));
  const rows = generatedRows(good(await f.repository.query(next.context, 'stock')));
  const run = good(await f.repository.read(next.context, { table: 'runs', key: { runId: reset.runId } }));
  const read = { runId: reset.runId, asOf: run.clockInstant, policyVersion: run.policyVersion };
  const tranche = entry.inputs.stockTranches[0];
  const check = await createReleaseGuarantee({ policy: f.policy, read, scenario: entry, guarantee: tranche.guarantee });
  const report = run.versions.stockGeneration.report.release;
  const size = good(await f.policy.getAssumption('supply.release.size', read)).value;
  assert.equal(report.guarantee.minimumCars, 3);
  const releases = Map.groupBy(rows, (row) => factOf(row, 'plannedRelease').releaseId);
  assert.ok(releases.size >= 2);
  for (const [releaseId, cars] of releases) {
    const mine = [];
    for (const row of cars) {
      const extra = Object.fromEntries(Object.entries(row.facts.facts).filter(([name]) => name !== 'plannedRelease'));
      if (await check.qualifies({ configurationId: row.configurationId }, null, extra)) mine.push(row);
    }
    assert.ok(mine.length >= 3, `${releaseId}: ${mine.length} qualifying cars`);
    assert.ok(new Set(mine.map((row) => factOf(row, 'colour'))).size >= 3, `${releaseId}: colours`);
    assert.ok(cars.length <= size);
  }
});

test('resetting to the mechanics scenario generates stock for the new run through afterReset', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-reset' });
  const catalogue = good(await f.scenarios.readCatalogue(f.context));
  const mechanics = catalogue.scenarios.find((entry) => entry.kind === 'mechanics');
  const state = good(await f.scenarios.readState(f.context));
  const reset = good(await f.scenarios.reset(f.context, { commandId: 'to-mechanics', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioId: mechanics.scenarioId, scenarioVersion: mechanics.scenarioVersion, fixtureVersion: mechanics.fixtureVersion, policyVersion: mechanics.policyVersion }));
  assert.notEqual(reset.runId, state.runId);
  assert.equal(f.factory.provider.describe(reset.runId)?.source, 'generated');
  const next = good(await f.identity.createPresenterSession('run-stock-reset-presenter-2'));
  assert.equal(next.context.runId, reset.runId);
  assert.ok(generatedRows(await f.stock(next.context)).length > 100);
});

test('presenter controls without generated stock keep the named release cue', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-plain', source: (deps) => createRunStockProvider({ ...deps, logger: quiet }) });
  const controls = good(await f.controls.readState(f.context)).controls;
  assert.equal(controls.nextRelease.to, 'release'); assert.equal(controls.nextRelease.at, controls.namedTimes.release);
});

// FUCQ-363: run ids are deterministic, so a restarted process meets its predecessor's inventory file.
test('restart: a stale inventory from a different policy still gives generated stock, no demo fallback', async (t) => {
  const environmentId = 'run-stock-restart';
  const policy = await alternativePolicy((entry) => { entry('supply.weeklyReleaseVolume').value = { min: 400, max: 400 }; });
  const first = await compose(t, { environmentId, policy });
  assert.equal(first.factory.provider.describe(first.runId).source, 'generated');
  const staleCount = generatedRows(await first.stock()).length;
  await first.close();
  const logs = [];
  const second = await compose(t, { environmentId, directory: first.directory, logger: (line) => logs.push(String(line)) });
  assert.equal(second.runId, first.runId);
  assert.deepEqual(second.factory.provider.describe(second.runId), { source: 'generated', reason: 'Stock generated for the run.' });
  assert.ok(!logs.some((line) => /demo/i.test(line)), logs.join('\n'));
  const rows = generatedRows(await second.stock());
  assert.ok(rows.length > 0 && rows.length !== staleCount, `${rows.length} vs ${staleCount}`);
  const outcome = releaseOutcome(await tick(second, 'restart-release-1'));
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); assert.equal(outcome.value.kind, 'stock-released');
  assert.ok(outcome.value.orderUuids.length > 0);
  const released = (await second.stock()).filter((row) => row.state === 'released');
  assert.ok(released.length > 0 && generatedRows(released).length === released.length, 'released cars are generated');
});

test('restart: identical inputs reuse the inventory and keep the same order identities', async (t) => {
  const environmentId = 'run-stock-restart-same';
  const first = await compose(t, { environmentId });
  const orders = generatedRows(await first.stock()).map((row) => row.orderUuid).sort();
  const releasedFirst = releaseOutcome(await tick(first, 'same-release-1')).value.orderUuids.slice().sort();
  await first.close();
  const second = await compose(t, { environmentId, directory: first.directory });
  assert.equal(second.factory.provider.describe(second.runId).source, 'generated');
  assert.deepEqual(generatedRows(await second.stock()).map((row) => row.orderUuid).sort(), orders);
  assert.deepEqual(releaseOutcome(await tick(second, 'same-release-1')).value.orderUuids.slice().sort(), releasedFirst);
});

test('an invalid inventory file at startup is renamed aside and generation still succeeds', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'gcsp-run-stock-')); roots.push(directory);
  await writeFile(join(directory, 'inventory.json'), '{');
  const f = await compose(t, { environmentId: 'run-stock-invalid-inventory', directory });
  assert.deepEqual(f.factory.provider.describe(f.runId), { source: 'generated', reason: 'Stock generated for the run.' });
  const names = await readdir(directory);
  const aside = names.filter((name) => name.startsWith('inventory.json.invalid-'));
  assert.equal(aside.length, 1, names.join());
  assert.equal(await readFile(join(directory, aside[0]), 'utf8'), '{');
  assert.ok(generatedRows(await f.stock()).length > 0);
});
