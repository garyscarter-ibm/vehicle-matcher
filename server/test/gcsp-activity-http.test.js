import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, result } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { createActivityService } from '../gcsp/brief/activity.js';
import { preference, essential } from './helpers/employee-recommendation.js';

const origin = 'https://activity.test';
const cookie = (session) => [session.value.setCookie].flat().map((value) => value.split(';')[0]).join('; ');
async function setup() {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store }); await repository.open();
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'activity-http-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { identity, clock } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context;
  const brief = createBriefService({ repository, policy, identity, clock });
  const activity = createActivityService({ repository, identity, clock });
  return { store, repository, policy, identity, clock, presenter, acting, context, brief, activity };
}
async function withHttp(f, work, { service = f.activity, accessKey = '' } = {}) {
  const previousKey = process.env.DEMO_ACCESS_KEY; process.env.DEMO_ACCESS_KEY = accessKey;
  const server = buildServer({ gcspIdentity: f.identity, gcspActivity: service, gcspBrief: f.brief, gcspAllowedOrigins: [origin] });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const request = async (path = '/activity', { method = 'GET', body, session = f.acting, origin: requestedOrigin = origin, key } = {}) => {
      const headers = { ...(session ? { cookie: cookie(session) } : {}), ...(requestedOrigin ? { Origin: requestedOrigin } : {}),
        ...(key ? { 'X-Access-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp${path}`, {
        method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, json: response.status === 204 ? null : await response.json(), headers: response.headers };
    };
    return await work(request);
  } finally {
    server.closeAllConnections(); await new Promise((done) => server.close(done)); await f.repository.close();
    if (previousKey === undefined) delete process.env.DEMO_ACCESS_KEY; else process.env.DEMO_ACCESS_KEY = previousKey;
  }
}
async function confirm(request) {
  const saved = await request('/brief/draft', { method: 'POST', body: { commandId: 'draft', expectedBriefVersion: 0,
    expectedDraftVersion: 0, brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const confirmed = await request('/brief/confirm', { method: 'POST', body: { commandId: 'confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: false } } });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
}

test('GET activity returns explicit no-brief evidence without writes and disables response caching', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    const before = structuredClone(f.store.state);
    const response = await request(); assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
    assert.equal(response.json.value.state, 'no-brief'); assert.equal(response.json.value.briefVersion, null);
    assert.equal(response.json.value.lastSuccessfulCheck, null); assert.equal(response.json.value.searchEvidence.status, 'not-recorded');
    assert.equal(response.json.value.sourceStatus, 'evidence-unavailable'); assert.deepEqual(response.json.value.offers, []);
    assert.deepEqual(f.store.state, before);
  });
});

test('fresh HTTP activity reads reflect BriefService confirmation, pause and resume immediately', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    await confirm(request);
    let response = await request(); assert.equal(response.status, 200); assert.equal(response.json.value.briefVersion, 1);
    assert.equal(response.json.value.permission.canSearch, true); assert.equal(response.json.value.permission.canHold, false);
    const paused = await request('/brief/pause', { method: 'POST', body: { commandId: 'pause', expectedBriefVersion: 1 } });
    assert.equal(paused.status, 200, JSON.stringify(paused.json));
    const before = structuredClone(f.store.state);
    for (let reload = 0; reload < 2; reload++) {
      response = await request(); assert.equal(response.status, 200);
      assert.equal(response.json.value.briefVersion, 2); assert.equal(response.json.value.state, 'paused');
      assert.equal(response.json.value.permission.canSearch, false); assert.equal(response.json.value.permission.canHold, false);
      assert.deepEqual(response.json.value.stateChanges.map((event) => event.operation), ['confirmed', 'paused']);
    }
    assert.deepEqual(f.store.state, before);
    const stale = await request('/brief/resume', { method: 'POST', body: { commandId: 'stale-resume', expectedBriefVersion: 1 } });
    assert.equal(stale.status, 409); assert.equal(stale.json.status, 'stale-version');
    const resumed = await request('/brief/resume', { method: 'POST', body: { commandId: 'resume', expectedBriefVersion: 2 } });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.json));
    response = await request(); assert.equal(response.status, 200); assert.equal(response.json.value.briefVersion, 3);
    assert.equal(response.json.value.permission.paused, false); assert.equal(response.json.value.permission.canSearch, true);
    assert.equal(response.json.value.permission.canHold, false); assert.equal(response.json.value.lastSuccessfulCheck, null);
    assert.equal(response.json.value.searchEvidence.status, 'not-recorded');
    assert.deepEqual(response.json.value.stateChanges.map((event) => event.operation), ['confirmed', 'paused', 'resumed']);
  });
});

test('another real employee session sees only its own current activity and no foreign timeline', async () => {
  const f = await setup();
  const principals = (await f.policy.getAssumption('identity.demo.principals', { runId: f.context.runId,
    asOf: (await f.clock.now(f.context)).value.now })).value.value;
  const other = principals.find((person) => person.roles.includes('employee') && person.employeeId !== f.context.employeeId);
  const session = await f.identity.switchPrincipal(f.presenter.value.context, other.principalId, 'other');
  await withHttp(f, async (request) => {
    await confirm(request);
    const response = await request('/activity', { session }); assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.equal(response.json.value.employeeId, other.employeeId); assert.equal(response.json.value.briefVersion, null);
    assert.deepEqual(response.json.value.stateChanges, []); assert.deepEqual(response.json.value.offers, []);
    assert.ok(!JSON.stringify(response.json).includes(f.context.employeeId));
  });
});

test('activity retains employee-role and server-session enforcement', async () => {
  const f = await setup(); const greg = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-greg', 'greg');
  await withHttp(f, async (request) => {
    for (const session of [f.presenter, greg]) {
      const response = await request('/activity', { session }); assert.equal(response.status, 403); assert.equal(response.json.status, 'forbidden');
    }
    const missing = await request('/activity', { session: null }); assert.equal(missing.status, 401);
    assert.equal(missing.json.status, 'missing-session'); assert.equal(missing.headers.get('Cache-Control'), 'no-store');
  });
});

test('activity rejects every query selector and preserves strict browser-authority rejection', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    for (const query of ['employeeId=other', 'runId=old', 'roles=employee', 'context=x', 'token=x', 'offerId=x', 'limit=1', 'unknown=']) {
      const response = await request(`/activity?${query}`); assert.equal(response.status, 400, query);
      assert.equal(response.json.status, 'invalid'); assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.json.code, ['offerId=x', 'limit=1', 'unknown='].includes(query) ? 'unsupported-query' : 'browser-context-forbidden');
    }
    const post = await request('/activity', { method: 'POST', body: { commandId: 'not-an-activity-command' } });
    assert.equal(post.status, 404); assert.equal(post.json.resourceType, 'route');
  });
});

test('reset invalidates the old HTTP activity session instead of redirecting it into the new run', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    await confirm(request); const state = (await f.clock.readState(f.presenter.value.context)).value;
    const reset = await f.clock.reset(f.presenter.value.context, { commandId: 'reset', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
    assert.equal(reset.status, 'ok', JSON.stringify(reset));
    const old = await request(); assert.equal(old.status, 409); assert.equal(old.json.status, 'stale-run');
    assert.equal(old.headers.get('Cache-Control'), 'no-store'); assert.equal(old.json.value, undefined);
  });
});

test('missing or malformed activity injection is unavailable rather than a fabricated default', async () => {
  for (const service of [null, {}, { readActivity: 'not-a-function' }]) {
    const f = await setup();
    await withHttp(f, async (request) => {
      const response = await request(); assert.equal(response.status, 503, JSON.stringify(response.json));
      assert.equal(response.json.status, 'unavailable'); assert.equal(response.json.retryable, true);
      assert.equal(response.json.value, undefined); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }, { service });
  }
});

test('repository failures propagate through the injected reader and thrown service errors remain private', async () => {
  const f = await setup(); const failure = result('unavailable', { code: 'activity-source-offline', reason: 'Activity could not load.', retryable: true });
  const activity = createActivityService({ identity: f.identity, clock: f.clock, repository: { query: async () => failure } });
  await withHttp(f, async (request) => {
    const response = await request(); assert.equal(response.status, 503); assert.deepEqual(response.json, failure);
  }, { service: activity });
  const g = await setup();
  await withHttp(g, async (request) => {
    const response = await request(); assert.equal(response.status, 503); assert.equal(response.json.status, 'unavailable');
    assert.equal(response.json.value, undefined); assert.ok(!JSON.stringify(response.json).includes('private-provider-error'));
  }, { service: { readActivity() { throw new Error('private-provider-error'); } } });
});

test('activity inherits the shared access gate and exact-origin boundaries', async () => {
  const f = await setup();
  await withHttp(f, async (request) => {
    assert.equal((await request()).status, 401);
    assert.equal((await request('/activity', { key: 'wrong' })).status, 401);
    const allowed = await request('/activity', { key: 'activity-test-key' }); assert.equal(allowed.status, 200);
    const denied = await request('/activity', { key: 'activity-test-key', origin: 'https://other.test' });
    assert.equal(denied.status, 403); assert.equal(denied.json.status, 'forbidden');
    assert.equal(denied.headers.get('Access-Control-Allow-Origin'), 'null');
    const native = await request('/activity', { key: 'activity-test-key', origin: null }); assert.equal(native.status, 200);
    const preflight = await request('/activity', { method: 'OPTIONS', session: null }); assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  }, { accessKey: 'activity-test-key' });
});
