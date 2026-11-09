// FUCQ-92: the run-level stock source. Memory repository, no network, no PostgreSQL URL.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, ok, result } from '../gcsp/repository/index.js';
import { PolicyService, createPolicyService } from '../gcsp/policy/index.js';
import { createPresenterControlsService } from '../gcsp/presenter-controls/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createRunStockProvider, createRunStockProviderFactory } from '../gcsp/stock/index.js';
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
async function compose(t, { source, policy, environmentId = 'run-stock' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'gcsp-run-stock-')); roots.push(directory);
  const factory = createRunStockProviderFactory({ env: { GCSP_STOCK_INVENTORY_PATH: join(directory, 'inventory.json') }, logger: quiet });
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
  // The same command replays; a later Next release moves to the next window.
  const again = await f.clock.advanceAndTick(f.context, { commandId: 'run-stock-release-1', expectedClockVersion: before.clockVersion, mode: 'next-release' });
  assert.equal(again.status, 'ok', JSON.stringify(again));
  assert.deepEqual(again, first);
  assert.equal((await f.stock()).filter((row) => row.state === 'released').length, released.length);
  assert.equal(good(await f.controls.readState(f.context)).controls.nextRelease.at, windows[1]);
});

test('eligibility keys come from policy: evidenced AG codes map, others stay unmapped, one entry changes it', async (t) => {
  const f = await compose(t, { environmentId: 'run-stock-keys' });
  const rows = generatedRows(await f.stock());
  const mapped = rows.filter((row) => factOf(row, 'eligibilityModelKey') !== undefined);
  const keys = ['G61 i5|i5 40', 'F70 Sports Hatch|120', 'F70 Sports Hatch|M135', 'G42 Coupe|220i', 'G42 Coupe|230i', 'G42 Coupe|M240i'];
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
    versions: { scenarioSelection: { scenarioId: 'main-successful-journey' } } };
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
