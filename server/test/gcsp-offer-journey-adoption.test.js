import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { getReviewedDefinitionSet } from '../gcsp/policy/reviewed-definitions.js';
import { adoptOfferJourneyPolicy } from '../gcsp/policy/offer-journey-adoption.js';
import { once } from 'node:events';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider, createMemoryPolicyStore } from '../gcsp/policy/index.js';

const KEYS = ['offer.declineReasons.v1', 'offer.followupQuestions.v1'];
const good = (outcome) => { assert.equal(outcome?.status, 'ok', outcome?.code ?? outcome?.reason); return outcome.value; };
const open = async (t, extra) => {
  const runtime = good(await createGcspRuntime({ mode: 'memory', environmentId: 'offer-journey-adoption',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'offer-journey-bootstrap', ...extra }));
  t.after(() => runtime.close());
  const employee = good(await runtime.createLocalSession()).context;
  const now = good(await runtime.clock.now(employee)).now;
  const reads = await Promise.all(KEYS.map((key) => runtime.policy.getAssumption(key,
    { runId: employee.runId, asOf: now, policyVersion: employee.policyVersion })));
  return { runtime, employee, reads };
};

test('the combined offer journey set is the two reviewed offer sets, row for row', () => {
  const combined = getReviewedDefinitionSet('offer-journey-v1');
  assert.deepEqual(combined.definitions, [...getReviewedDefinitionSet('offer-decline-reasons-v1').definitions,
    ...getReviewedDefinitionSet('offer-followup-questions-v1').definitions]);
});

test('demo startup adopts decline reasons and follow-up questions through PolicyService', async (t) => {
  const { runtime, employee, reads } = await open(t, { adoptOfferJourney: true });
  assert.equal(employee.policyVersion, 'gcsp-policy-v1+offer-journey-v1');
  reads.forEach((read, i) => { assert.equal(read.status, 'ok');
    assert.deepEqual(read.value.value, getReviewedDefinitionSet('offer-journey-v1').definitions[i].value); });
  // A second call finds the keys already active and publishes nothing.
  const again = good(await adoptOfferJourneyPolicy({ policy: runtime.policy, identity: runtime.identity, clock: runtime.clock }));
  assert.equal(again.adopted, false); assert.equal(again.policyVersion, employee.policyVersion);
});

test('runtimes that do not opt in keep the seed policy unchanged', async (t) => {
  const { employee, reads } = await open(t, {});
  assert.equal(employee.policyVersion, 'gcsp-policy-v1');
  assert.ok(reads.every((read) => read.status !== 'ok'));
});

test('after a scenario reset the presenter session renews and the new run has the offer sets active', async (t) => {
  const { runtime, employee } = await open(t, { adoptOfferJourney: true });
  const presenter = good(await runtime.identity.createPresenterSession('adoption-presenter')).context;
  const scenario = good(await runtime.scenarios.readCatalogue(presenter)).scenarios.find((row) => row.kind === 'mechanics');
  const state = good(await runtime.scenarios.readState(presenter));
  const reset = good(await runtime.scenarios.reset(presenter, { commandId: 'adoption-reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion }));
  assert.notEqual(reset.runId, employee.runId);
  const renewed = good(await runtime.identity.createPresenterSession('adoption-presenter-after-reset')).context;
  assert.equal(renewed.runId, reset.runId); assert.equal(renewed.policyVersion, 'gcsp-policy-v1+offer-journey-v1');
  const now = good(await runtime.clock.now(renewed)).now;
  const read = await runtime.policy.getAssumption('offer.declineReasons.v1', { runId: renewed.runId, asOf: now, policyVersion: renewed.policyVersion });
  assert.equal(read.status, 'ok');
});

const ORIGIN = 'https://offer-journey.test';
const jar = (setCookie) => [].concat(setCookie).map((value) => value.split(';')[0]).join('; ');
const offerSetsActive = async (runtime, context) => {
  const now = good(await runtime.clock.now(context)).now;
  return Promise.all(KEYS.map((key) => runtime.policy.getAssumption(key, { runId: context.runId, asOf: now, policyVersion: context.policyVersion })));
};

test('FUCQ-179: the plain presenter clock reset route also re-adopts the offer sets on the new run', async (t) => {
  const { runtime, employee } = await open(t, { adoptOfferJourney: true });
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [ORIGIN] });
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); });
  assert.equal((await server.gcspStartup).status, 'ok');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const call = async (path, cookie, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Origin: ORIGIN, cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { body: await response.json(), cookies: response.headers.getSetCookie() };
  };
  const cookie = jar(good(await runtime.identity.createPresenterSession('clock-route-presenter')).setCookie);
  const state = good((await call('presenter/clock', cookie)).body);
  const reset = await call('presenter/clock/reset', cookie, { commandId: 'clock-route-reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
  assert.notEqual(good(reset.body).runId, employee.runId);
  const renewed = good(await runtime.identity.createPresenterSession('clock-route-after-reset')).context;
  assert.equal(renewed.runId, reset.body.value.runId); assert.equal(renewed.policyVersion, 'gcsp-policy-v1+offer-journey-v1');
  assert.ok((await offerSetsActive(runtime, renewed)).every((read) => read.status === 'ok'));
});

test('FUCQ-179: a restart over the same durable stores after a reset reopens on the adopted run', async (t) => {
  const store = createMemoryStore(); const policyStore = createMemoryPolicyStore();
  const start = () => createGcspRuntime({ mode: 'memory', environmentId: 'offer-journey-restart', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'offer-journey-bootstrap', adoptOfferJourney: true, repository: createMemoryRepository({ store }),
    policy: new PolicyService({ provider: new MemoryPolicyProvider({ store: policyStore }) }) });
  const first = good(await start());
  const presenter = good(await first.identity.createPresenterSession('restart-presenter')).context;
  const scenario = good(await first.scenarios.readCatalogue(presenter)).scenarios.find((row) => row.kind === 'mechanics');
  const state = good(await first.scenarios.readState(presenter));
  const reset = good(await first.scenarios.reset(presenter, { commandId: 'restart-reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
    fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion }));
  await first.close();
  const second = good(await start()); t.after(() => second.close());
  const renewed = good(await second.identity.createPresenterSession('restart-presenter-after')).context;
  assert.equal(renewed.runId, reset.runId); assert.equal(renewed.policyVersion, 'gcsp-policy-v1+offer-journey-v1');
  assert.ok((await offerSetsActive(second, renewed)).every((read) => read.status === 'ok'));
});
