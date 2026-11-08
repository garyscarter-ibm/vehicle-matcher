import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createScenarioService } from '../gcsp/scenarios/index.js';
import { prepareScenarioFixture } from '../gcsp/fixtures/scenarios/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';

async function setup({ policy = createPolicyService() } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store }); await repository.open();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'scenario-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z', secureCookies: true });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const session = await identity.createPresenterSession('presenter');
  const employee = await identity.switchPrincipal(session.value.context, 'demo-paula', 'acting-paula');
  const scenarios = createScenarioService({ repository, policy, clock, identity });
  return { store, repository, policy, clock, identity, scenarios, session, presenter: session.value.context, employee: employee.value.context };
}
const command = (state, scenario, commandId = 'reset') => ({ commandId, expectedRunId: state.runId, expectedRunVersion: state.runVersion,
  scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion, fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion });
const snapshot = (f) => inputDigest(f.store.state);
const support = (catalogue) => catalogue.scenarios.find((s) => s.kind === 'mechanics');

test('catalogue lists the six authored journeys first with canonical principals, policy and finite input versions', async () => {
  const f = await setup();
  const read = await f.scenarios.readCatalogue(f.presenter); assert.equal(read.status, 'ok');
  const entries = read.value.scenarios;
  assert.deepEqual(entries.slice(0, 6).map((s) => s.ownerStory), ['FUCQ-109', 'FUCQ-127', 'FUCQ-128', 'FUCQ-129', 'FUCQ-130', 'FUCQ-131']);
  assert.equal(new Set(entries.map((s) => s.scenarioId)).size, entries.length);
  for (const s of entries) {
    assert.ok(s.name && s.fixtureVersion && s.scenarioVersion && s.policyVersion && s.clockStart);
    assert.ok(s.stories.length && s.epics.length && s.requiredCapabilities.length && s.steps.length);
    assert.deepEqual(s.principals.map((p) => p.principalId), s.principalIds);
    assert.ok(s.principals.every((p) => p.roles.length === 1));
    assert.ok(Array.isArray(s.inputs.briefs) && Array.isArray(s.inputs.stockTranches) && Array.isArray(s.inputs.pendingOperations));
  }
  assert.equal(support(read.value).inputProvenance, 'fictional-clock-mechanics-only');
  entries[0].name = 'Changed by consumer';
  assert.notEqual((await f.scenarios.readCatalogue(f.presenter)).value.scenarios[0].name, entries[0].name);
});

test('only journeys with a reviewed start loader are available; the rest refuse before any reset mutation', async () => {
  const f = await setup();
  const state = (await f.scenarios.readState(f.presenter)).value;
  const catalogue = (await f.scenarios.readCatalogue(f.presenter)).value;
  const before = snapshot(f);
  const journeys = catalogue.scenarios.filter((s) => s.kind === 'journey');
  assert.deepEqual(journeys.filter((s) => s.availability.available).map((s) => s.scenarioId), ['main-successful-journey', 'no-suitable-match', 'decline-then-change', 'data-unavailable', 'uncertain-handoff', 'uncertain-handoff-rejected', 'decline-then-change-waiting']);
  const decline = journeys.find((s) => s.scenarioId === 'decline-then-change');
  assert.equal(decline.fixtureVersion, 'decline-then-change-inputs-v2'); assert.deepEqual(decline.variants, ['later-suitable-stock']);
  assert.equal(decline.inputs.change.value, 'saloon');
  // Without the brief and employee-preparation services the start state cannot be built, so nothing is reset.
  const unstarted = await f.scenarios.reset(f.presenter, command(state, decline, 'no-start-services'));
  const mainEntry = journeys.find((s) => s.scenarioId === 'main-successful-journey');
  const mainUnstarted = await f.scenarios.reset(f.presenter, command(state, mainEntry, 'main-no-start-services'));
  assert.equal(mainUnstarted.code, 'scenario-start-services-unavailable');
  assert.equal(unstarted.status, 'unavailable'); assert.equal(unstarted.code, 'scenario-start-services-unavailable'); assert.equal(snapshot(f), before);
  for (const s of journeys.filter((s) => !s.availability.available)) {
    const outcome = await f.scenarios.reset(f.presenter, command(state, s, s.scenarioId));
    assert.equal(outcome.status, 'unavailable'); assert.equal(outcome.reason, 'not available yet');
    assert.deepEqual(outcome.missingCapabilities, s.availability.missingCapabilities);
    assert.ok(outcome.missingCapabilities.length); assert.equal(snapshot(f), before);
  }
});

test('named mechanics resets twice through85 with equivalent inputs, fresh identifiers and stale old runs', async () => {
  const f = await setup();
  const catalogue = (await f.scenarios.readCatalogue(f.presenter)).value;
  const fixture = support(catalogue); const firstState = (await f.scenarios.readState(f.presenter)).value;
  const firstInput = command(firstState, fixture, 'first');
  const first = await f.scenarios.reset(f.presenter, firstInput); assert.equal(first.status, 'ok', JSON.stringify(first));
  assert.notEqual(first.value.runId, firstState.runId);
  assert.deepEqual(await f.scenarios.reset(f.presenter, firstInput), first);
  const newSession = await f.identity.createPresenterSession('after-first');
  const state = (await f.scenarios.readState(newSession.value.context)).value;
  assert.equal(state.currentScenario.scenarioId, fixture.scenarioId); assert.equal(state.currentScenario.fixtureVersion, fixture.fixtureVersion);
  const stock = (await f.repository.query(newSession.value.context, 'stock')).value;
  const second = await f.scenarios.reset(newSession.value.context, command(state, fixture, 'second')); assert.equal(second.status, 'ok');
  const latest = await f.identity.createPresenterSession('after-second');
  const final = (await f.repository.query(latest.value.context, 'stock')).value;
  assert.deepEqual(final.map((s) => s.configurationId), stock.map((s) => s.configurationId));
  assert.deepEqual(final.map((s) => [s.state, s.available]), stock.map((s) => [s.state, s.available]));
  for (let i = 0; i < stock.length; i++) { assert.notEqual(final[i].orderUuid, stock[i].orderUuid); assert.notEqual(final[i].orderNumber, stock[i].orderNumber); }
  assert.equal((await f.scenarios.readState(f.presenter)).status, 'stale-run');
  assert.equal((await f.scenarios.reset(f.presenter, { ...firstInput, commandId: 'not-replay' })).status, 'stale-run');
  assert.equal((await f.scenarios.reset(f.presenter, { ...firstInput, policyVersion: 'changed' })).status, 'stale-version');
});

test('presenter-only guards reject employee and copied contexts without mutation', async () => {
  const f = await setup(); const before = snapshot(f);
  for (const context of [f.employee, { ...f.presenter }]) {
    assert.equal((await f.scenarios.readCatalogue(context)).status, 'forbidden');
    assert.equal((await f.scenarios.readState(context)).status, 'forbidden');
    assert.equal((await f.scenarios.reset(context, {})).status, 'forbidden');
  }
  assert.equal(snapshot(f), before);
});

test('version/current-run failures remain distinct from missing capabilities and stale CAS cannot partly reset', async () => {
  const f = await setup(); const state = (await f.scenarios.readState(f.presenter)).value;
  const catalogue = (await f.scenarios.readCatalogue(f.presenter)).value;
  const fixture = support(catalogue); const before = snapshot(f);
  for (const patch of [{ fixtureVersion: 'bad' }, { scenarioVersion: 'bad' }, { policyVersion: 'bad' }, { expectedRunVersion: state.runVersion + 1 }]) {
    assert.equal((await f.scenarios.reset(f.presenter, { ...command(state, fixture), ...patch })).status, 'stale-version');
    assert.equal(snapshot(f), before);
  }
  const outcome = await Promise.all(['one', 'two'].map((id) => f.scenarios.reset(f.presenter, command(state, fixture, id))));
  assert.equal(outcome.filter((o) => o.status === 'ok').length, 1);
  assert.ok(outcome.some((o) => ['stale-run', 'stale-version'].includes(o.status)));
});

test('prepared fixture identity is trusted and immutable; fabricated functions and availability flags cannot activate journeys', async () => {
  const f = await setup(); const state = (await f.clock.readState(f.presenter)).value;
  const base = { commandId: 'direct', expectedRunId: state.runId, expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture };
  const before = snapshot(f);
  for (const fake of [{}, { prepare: () => ({}), available: true }, { scenarioId: 'gcsp-clock-scenario-v1', policyVersion: state.versions.policy }]) {
    assert.equal((await f.clock.reset(f.presenter, base, fake)).status, 'invalid'); assert.equal(snapshot(f), before);
  }
  const prepared = await prepareScenarioFixture({ scenarioId: 'gcsp-clock-scenario-v1', policy: f.policy,
    read: { runId: state.runId, asOf: state.now, policyVersion: state.versions.policy } });
  assert.equal(prepared.status, 'ok'); assert.equal(Object.isFrozen(prepared.value.configuration.scenario), true);
  assert.throws(() => { prepared.value.policyVersion = 'forged'; }, TypeError);
  assert.equal((await f.clock.reset(f.presenter, base, prepared.value)).status, 'ok');
  assert.equal((await f.clock.reset(f.presenter, base)).status, 'conflict');
});

test('HTTP named controls use presenter cookie, exact Origin, no-store and85 cookie rollover/replay', async () => {
  const { buildServer } = await import('../index.js');
  const { once } = await import('node:events');
  const f = await setup();
  const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock,
    gcspScenarios: f.scenarios, gcspAllowedOrigins: ['https://scenario.test'] });
  try {
    await server.gcspStartup; server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const cookie = f.session.value.setCookie.map((c) => c.split(';')[0]).join('; ');
    const request = async (path, body, credential = cookie, origin = 'https://scenario.test') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/presenter/scenarios${path}`, {
        method: body ? 'POST' : 'GET', headers: { ...(origin ? { Origin: origin } : {}), cookie: credential,
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { response, outcome: await response.json() };
    };
    const catalogue = await request(''); assert.equal(catalogue.response.status, 200); assert.equal(catalogue.response.headers.get('cache-control'), 'no-store');
    const state = (await request('/current')).outcome.value;
    const input = command(state, support(catalogue.outcome.value), 'http');
    const before = snapshot(f);
    assert.equal((await request('/reset', input, cookie, null)).response.status, 403);
    assert.equal((await request('/reset', { ...input, principalId: 'demo-presenter' })).response.status, 400);
    const employeeSession = await f.identity.switchPrincipal(f.presenter, 'demo-paula', 'employee-only');
    const employeeCookies = employeeSession.value.setCookie.split(';')[0];
    const employeeBefore = snapshot(f);
    assert.equal((await request('', undefined, employeeCookies)).response.status, 403); assert.equal(snapshot(f), employeeBefore);
    const reset = await request('/reset', input); assert.equal(reset.response.status, 200, JSON.stringify(reset.outcome));
    assert.ok(reset.response.headers.getSetCookie().length); assert.notEqual(snapshot(f), before);
    const fresh = reset.response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.equal((await request('/current', undefined, fresh)).outcome.value.runId, reset.outcome.value.runId);
    assert.equal((await request('/current')).outcome.status, 'stale-run');
    const replay = await request('/reset', input); assert.deepEqual(replay.outcome, reset.outcome);
    assert.equal((await request('/reset', { ...input, commandId: 'changed' })).outcome.status, 'stale-run');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('presentation fixture agrees with computed catalogue/refusal/reset/current response contracts', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('../gcsp/fixtures/scenarios/presentation-v1.json', import.meta.url), 'utf8'));
  const f = await setup(); const catalogue = (await f.scenarios.readCatalogue(f.presenter)).value;
  assert.equal(catalogue.catalogueVersion, fixture.catalogueVersion);
  assert.deepEqual(catalogue.scenarios.filter((s) => s.kind === 'journey').map((s) => s.scenarioId), fixture.journeyIds);
  const mechanics = support(catalogue);
  assert.deepEqual(Object.fromEntries(Object.keys(fixture.mechanics).map((key) => [key, mechanics[key]])), fixture.mechanics);
  const state = (await f.scenarios.readState(f.presenter)).value;
  assert.deepEqual(Object.keys(state), fixture.currentFields);
  assert.deepEqual(await f.scenarios.reset(f.presenter, command(state, catalogue.scenarios.find((s) => s.kind === 'journey' && !s.availability.available))), fixture.unavailable);
  const reset = await f.scenarios.reset(f.presenter, command(state, mechanics)); assert.equal(reset.status, 'ok');
  assert.deepEqual(Object.keys(reset.value), fixture.resetFields);
  assert.equal(JSON.stringify(reset).includes('snapshot'), false);
  assert.equal(JSON.stringify(reset).includes('gcsp_session'), false);
});

test('catalogue and real reset use changed canonical clock configuration without local scenario defaults', async () => {
  const { readFile } = await import('node:fs/promises');
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const config = seed.assumptions.find((a) => a.key === 'clock.scenario.v1');
  config.value.startsAt = '2026-11-05T08:00:00.000Z';
  config.value.namedTimes.release = '2026-11-05T08:30:00.000Z';
  const policy = new PolicyService({ provider: { loadVersions: async () => [seed] } });
  const f = await setup({ policy }); const catalogue = (await f.scenarios.readCatalogue(f.presenter)).value;
  assert.ok(catalogue.scenarios.every((s) => s.clockStart === config.value.startsAt && s.namedTimes.release === config.value.namedTimes.release));
  const state = (await f.scenarios.readState(f.presenter)).value;
  const outcome = await f.scenarios.reset(f.presenter, command(state, support(catalogue), 'x'.repeat(128)));
  assert.equal(outcome.status, 'ok'); assert.equal(outcome.value.now, config.value.startsAt);
});

test('unavailable policy or a different policy authority cannot prepare or partly reset a run', async () => {
  const f = await setup(); const state = (await f.clock.readState(f.presenter)).value;
  const read = { runId: state.runId, asOf: state.now, policyVersion: state.versions.policy };
  const before = snapshot(f);
  const failedPolicy = new PolicyService({ provider: { loadVersions: async () => { throw new Error('offline'); } } });
  assert.equal((await prepareScenarioFixture({ scenarioId: 'gcsp-clock-scenario-v1', policy: failedPolicy, read })).status, 'unavailable');
  assert.equal((await prepareScenarioFixture({ scenarioId: 'gcsp-clock-scenario-v1', policy: { getAssumption: () => ({ status: 'ok' }) }, read })).status, 'unavailable');
  const foreign = await prepareScenarioFixture({ scenarioId: 'gcsp-clock-scenario-v1', policy: createPolicyService(), read });
  const input = { commandId: 'foreign', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture };
  assert.equal((await f.clock.reset(f.presenter, input, foreign.value)).status, 'invalid');
  assert.equal(snapshot(f), before);
});
