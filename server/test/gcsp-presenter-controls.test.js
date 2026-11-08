import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createDemoRuntime, createDemoClock } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createScenarioService } from '../gcsp/scenarios/index.js';
import { createPresenterControlsService } from '../gcsp/presenter-controls/index.js';
import { buildServer } from '../index.js';

const seedUrl = new URL('../gcsp/policy/seed-v1.json', import.meta.url);
const time = '2026-11-05T00:00:00.000Z';
async function setup({ policy = createPolicyService(), wrapRepository = (repository) => repository } = {}) {
  const store = createMemoryStore(); const repository = wrapRepository(createMemoryRepository({ store }));
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'presenter-test', environmentKind: 'synthetic',
    policyAsOf: time, commandId: 'bootstrap', sessionNow: () => time });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const session = await identity.createPresenterSession('presenter');
  const presenter = session.value.context;
  const principals = (await identity.readPresenterPrincipals(presenter)).value;
  const employee = await identity.switchPrincipal(presenter, principals.find((p) => p.roles.includes('employee')).principalId, 'employee');
  const scenarios = createScenarioService({ repository, policy, clock, identity });
  const controls = createPresenterControlsService({ clock, identity, scenarios });
  return { store, repository, policy, clock, identity, session, presenter, employee, scenarios, controls };
}
const step = (commandId = 'one', expectedClockVersion = '1') => ({ commandId, expectedClockVersion, mode: 'step' });
const modifiedPolicy = async (change) => {
  const seed = JSON.parse(await readFile(seedUrl, 'utf8')); change(seed);
  return new PolicyService({ provider: { loadVersions: async () => [seed] } });
};
const assumption = (seed, key) => seed.assumptions.find((row) => row.key === key);

test('projection exposes policy-owned step/named times, current scenario and only safe configured principal fields', async () => {
  const f = await setup();
  const projected = await f.controls.readState(f.presenter);
  assert.equal(projected.status, 'ok');
  const configured = await f.policy.getAssumption('clock.presenter.stepSeconds', {
    runId: f.presenter.runId, asOf: projected.value.now, policyVersion: f.presenter.policyVersion });
  assert.deepEqual(projected.value.controls.step, configured.value);
  assert.equal(projected.value.currentScenario.scenarioVersion, projected.value.versions.scenario);
  assert.equal(projected.value.controls.nextRelease.at, projected.value.controls.namedTimes.release);
  assert.equal(projected.value.lastTick, null);
  assert.deepEqual(projected.value.principals, (await f.identity.readPresenterPrincipals(f.presenter)).value);
  for (const principal of projected.value.principals) assert.deepEqual(Object.keys(principal), ['principalId', 'name', 'roles']);
  assert.ok(!JSON.stringify(projected).match(/sessionIdHash|setCookie|snapshot|entitlementSlotId/));
  projected.value.principals[0].roles.push('forged');
  assert.ok(!(await f.identity.readPresenterPrincipals(f.presenter)).value[0].roles.includes('forged'));
  for (const context of [f.employee.value.context, { ...f.presenter }]) {
    assert.equal((await f.controls.readState(context)).status, 'forbidden');
    assert.equal((await f.clock.advanceAndTick(context, step())).status, 'forbidden');
    assert.equal((await f.identity.readPresenterPrincipals(context)).status, 'forbidden');
  }
});

test('step composition returns ordered actual handler results; duplicate and response-loss replay never advance twice', async () => {
  const f = await setup(); let calls = 0;
  await f.clock.registerHandler({ handlerId: 'z-expiry', stage: 'manual-expiry', handle: async () => ok({ expired: 0 }) });
  await f.clock.registerHandler({ handlerId: 'release', stage: 'release-pull', handle: ({ transaction }) => transaction(async () => {
    calls++; return ok({ released: 2, source: 'synthetic-test-handler' });
  }) });
  const input = step();
  const [first, duplicate] = await Promise.all([f.controls.tick(f.presenter, input), f.controls.tick(f.presenter, input)]);
  assert.equal(first.status, 'ok'); assert.deepEqual(duplicate, first);
  assert.equal(calls, 1);
  assert.deepEqual(first.value.tick.handlerOrder.map((entry) => entry.handlerId), ['release', 'z-expiry']);
  assert.equal(first.value.tick.outcomes[0].outcome.value.released, 2);
  assert.deepEqual(first.value.tick.missingStages, ['buddy-expiry', 'pending-reconciliation', 'buddy-allocation', 'outbox-dispatch']);
  const seconds = (await f.clock.readControlsConfiguration(f.presenter)).value.step.value;
  assert.equal(first.value.advance.now, new Date(Date.parse('2026-11-05T09:00:00.000Z') + seconds * 1000).toISOString());
  assert.equal(first.value.advance.clockVersion, '2');
  const later = await f.controls.tick(f.presenter, step('later', '2')); assert.equal(later.status, 'ok');
  const reopened = createDemoClock({ repository: f.repository, policy: f.policy, identity: f.identity,
    environmentId: 'presenter-test', environmentKind: 'synthetic' });
  assert.deepEqual(await reopened.advanceAndTick(f.presenter, input), first);
  assert.equal((await f.clock.now(f.presenter)).value.clockVersion, '3');
  for (const patch of [{ mode: 'to', to: 'expiry' }, { expectedClockVersion: '2' }]) {
    assert.equal((await f.controls.tick(f.presenter, { ...input, ...patch })).status, 'conflict');
  }
  assert.equal((await f.clock.now(f.presenter)).value.clockVersion, '3');
});

test('lost advance response and lost tick-start response resume original plan with stable server-created digest', async () => {
  for (const phase of ['clock:advance:', 'clock:tick:start:']) {
    let lose = true;
    const f = await setup({ wrapRepository: (repository) => ({ ...repository, async transaction(context, command, work) {
      const outcome = await repository.transaction(context, command, work);
      if (lose && command.commandId.startsWith(phase)) { lose = false; return result('unavailable', { reason: 'synthetic lost response', retryable: true }); }
      return outcome;
    } }) });
    const input = step('lost');
    assert.equal((await f.controls.tick(f.presenter, input)).status, 'unavailable');
    assert.equal((await f.clock.now(f.presenter)).value.clockVersion, '2');
    const recovered = await f.controls.tick(f.presenter, input);
    assert.equal(recovered.status, 'ok'); assert.equal(recovered.value.advance.clockVersion, '2');
    assert.equal(recovered.value.tick.clockVersion, '2');
    assert.equal((await f.repository.query(f.presenter, 'tick_runs')).value.length, 1);
    assert.deepEqual(await f.controls.tick(f.presenter, input), recovered);
    const plan = (await f.repository.query(f.presenter, 'event_receipts')).value.find((row) => row.eventId.startsWith('presenter:tick:plan:'));
    assert.equal(plan.inputDigest, inputDigest(input));
  }
});

test('next-release and named times advance honestly without inventing release counts or missing business capability', async () => {
  const f = await setup();
  const released = await f.controls.tick(f.presenter, { ...step('release'), mode: 'next-release' });
  assert.equal(released.status, 'ok'); assert.equal(released.value.advance.now, '2026-11-05T09:30:00.000Z');
  assert.ok(released.value.tick.missingStages.includes('release-pull'));
  assert.deepEqual(released.value.tick.outcomes, []);
  assert.ok(!JSON.stringify(released).includes('released'));
  assert.equal((await f.controls.readState(f.presenter)).value.controls.nextRelease.status, 'unavailable');
  const noFuture = await f.controls.tick(f.presenter, { ...step('no-future', '2'), mode: 'next-release' });
  assert.equal(noFuture.status, 'unavailable'); assert.match(noFuture.reason, /No future release cue/);
  assert.equal((await f.clock.now(f.presenter)).value.clockVersion, '2');
  const named = await f.controls.tick(f.presenter, { ...step('expiry', '2'), mode: 'to', to: 'expiry' });
  assert.equal(named.value.advance.now, '2026-11-05T11:00:00.000Z');
  assert.equal((await f.controls.readState(f.presenter)).value.lastTick.tickId, named.value.tick.tickId);
  const catalogue = (await f.scenarios.readCatalogue(f.presenter)).value;
  // Only journeys with a reviewed start loader are available; the others stay "not available yet".
  assert.deepEqual(catalogue.scenarios.filter((entry) => entry.kind === 'journey' && entry.availability.available).map((entry) => entry.scenarioId), ['main-successful-journey', 'no-suitable-match', 'decline-then-change', 'data-unavailable', 'uncertain-handoff', 'uncertain-handoff-rejected', 'decline-then-change-waiting']);
});

test('pending and refused handler outcomes stay ordered and truthful after time has advanced', async () => {
  for (const outcome of [result('pending', { operationId: 'op', operationType: 'release', lastKnownState: 'uncertain' }),
    result('forbidden', { reason: 'Synthetic release source refused this request.' })]) {
    const f = await setup();
    await f.clock.registerHandler({ handlerId: 'pull', stage: 'release-pull', handle: async () => outcome });
    const response = await f.controls.tick(f.presenter, step());
    assert.equal(response.status, outcome.status === 'pending' ? 'ok' : 'unavailable');
    if (outcome.status === 'forbidden') assert.deepEqual(response.handlerOutcome, outcome);
    const tick = response.status === 'ok' ? response.value.tick : response.tick;
    assert.equal((response.value?.advance ?? response.advance).clockVersion, '2');
    assert.equal(tick.state, outcome.status === 'pending' ? 'pending' : 'interrupted');
    assert.deepEqual(tick.outcomes[0].outcome, outcome);
    assert.deepEqual((await f.controls.readState(f.presenter)).value.lastTick, tick);
  }
});

test('canonical assumptions drive controls; missing or invalid presenter step preserves existing clock operations', async () => {
  const policy = await modifiedPolicy((seed) => {
    assumption(seed, 'clock.presenter.stepSeconds').value = 120;
    assumption(seed, 'clock.scenario.v1').value.namedTimes.release = '2026-11-05T10:00:00.000Z';
    assumption(seed, 'identity.demo.principals').value.find((p) => p.roles.includes('employee')).name = 'Updated fictional employee';
  });
  const f = await setup({ policy }); const projected = (await f.controls.readState(f.presenter)).value;
  assert.equal(projected.controls.step.value, 120);
  assert.equal(projected.controls.nextRelease.at, '2026-11-05T10:00:00.000Z');
  assert.ok(projected.principals.some((p) => p.name === 'Updated fictional employee'));
  assert.equal((await f.controls.tick(f.presenter, step())).value.advance.now, '2026-11-05T09:02:00.000Z');
  for (const value of [undefined, 0, -1, 1.5, '60']) {
    const invalidPolicy = await modifiedPolicy((seed) => {
      if (value === undefined) seed.assumptions = seed.assumptions.filter((row) => row.key !== 'clock.presenter.stepSeconds');
      else assumption(seed, 'clock.presenter.stepSeconds').value = value;
    });
    const legacy = await setup({ policy: invalidPolicy });
    const unavailable = await legacy.controls.readState(legacy.presenter);
    assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.code, 'presenter-step-unavailable');
    assert.equal((await legacy.controls.tick(legacy.presenter, step())).status, 'unavailable');
    assert.equal((await legacy.clock.now(legacy.presenter)).value.clockVersion, '1');
    assert.equal((await legacy.clock.advance(legacy.presenter, { commandId: 'existing-core-clock', expectedClockVersion: '1', bySeconds: 1 })).status, 'ok');
  }
});

test('strict command validation, stale versions and old run context cannot mutate the clock', async () => {
  const f = await setup();
  for (const input of [null, [], {}, { ...step(), inputDigest: inputDigest('browser') }, { ...step(), bySeconds: 60 },
    { ...step(), mode: 'anything' }, { ...step(), to: 'release' }, { ...step(), mode: 'to' },
    { ...step(), mode: 'to', to: 'constructor' }, { ...step(), mode: 'to', to: '2026-11-05T08:00:00.000Z' }]) {
    assert.equal((await f.controls.tick(f.presenter, input)).status, 'invalid', JSON.stringify(input));
  }
  assert.equal((await f.controls.tick(f.presenter, step('stale', '9'))).status, 'stale-version');
  assert.equal((await f.clock.now(f.presenter)).value.clockVersion, '1');
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.reset(f.presenter, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  assert.equal((await f.controls.tick(f.presenter, step())).status, 'stale-run');
  assert.equal((await f.controls.readState(f.presenter)).status, 'stale-run');
});

test('registered HTTP controls use presenter capability while acting as employee; guard Origin, selectors and session replay', async () => {
  const f = await setup(); const server = buildServer({ gcspIdentity: f.identity, gcspClock: f.clock,
    gcspScenarios: f.scenarios, gcspAllowedOrigins: ['https://presenter.test'] });
  try {
    await server.gcspStartup; server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const presenterCookie = f.session.value.setCookie[1].split(';')[0];
    const employeeCookie = f.employee.value.setCookie.split(';')[0];
    const cookie = `${presenterCookie}; ${employeeCookie}`;
    const request = async (path, body, credential = cookie, origin = 'https://presenter.test') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/${path}`, {
        method: body ? 'POST' : 'GET', headers: { cookie: credential, ...(origin ? { Origin: origin } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
    };
    const projection = await request('presenter/controls'); assert.equal(projection.status, 200); assert.equal(projection.cache, 'no-store');
    assert.equal((await request('context')).body.value.principalId, f.employee.value.context.principalId);
    assert.equal((await request('presenter/controls', undefined, employeeCookie)).status, 403);
    assert.equal((await request('presenter/controls?x=1')).status, 400);
    assert.equal((await request('presenter/controls?runId=forged')).status, 400);
    assert.equal((await request('presenter/controls/tick', step(), cookie, null)).status, 403);
    assert.equal((await request('presenter/controls/tick', step(), cookie, 'https://evil.test')).status, 403);
    for (const patch of [{ principalId: 'forged' }, { inputDigest: inputDigest('forged') }, { runId: 'forged' }, { to: 'release' }]) {
      assert.equal((await request('presenter/controls/tick', { ...step(), ...patch })).status, 400);
    }
    const tick = await request('presenter/controls/tick', step('http')); assert.equal(tick.status, 200);
    assert.deepEqual(await request('presenter/controls/tick', step('http')), tick);
    const person = projection.body.value.principals.find((p) => p.roles.includes('greg'));
    const switchInput = { principalId: person.principalId, commandId: 'http-switch' };
    assert.equal((await request('session/switch', switchInput)).status, 200);
    assert.equal((await request('session/switch', switchInput)).status, 409);
    assert.equal((await f.clock.now(f.presenter)).value.clockVersion, '2');
  } finally { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); }
});
