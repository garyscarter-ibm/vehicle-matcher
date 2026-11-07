import test from 'node:test';
import assert from 'node:assert/strict';
import { good } from './helpers/greg-publish-run.js';
import { startHttpServer } from './helpers/employee-recommendation-http.js';
import { fixture, TOURING, DERIVATIVES, cap, submitOf } from './helpers/order-plan-fixture.js';
import { createGcspRuntime } from '../gcsp/runtime.js';

const BASE = '/api/gcsp/greg/order-plan';
const quantity = (plan, id) => plan.quantities.find((q) => q.derivativeId === id).quantity;

async function httpFixture(t) {
  const f = await fixture(t);
  const http = await startHttpServer({ gcspRepository: f.repository, gcspPolicy: f.policy, gcspClock: f.clock,
    gcspIdentity: f.identity, gcspOrderPlan: f.ops });
  t.after(() => http.close());
  const acting = async (principalId, commandId) => {
    const out = await http.request('/api/gcsp/session/switch', { session: f.presenter, body: { principalId, commandId } });
    assert.equal(out.status, 200, JSON.stringify(out.json));
    return { value: { setCookie: out.headers.get('set-cookie'), context: out.json.value } };
  };
  const greg = await acting('demo-greg', 'http-plan-greg');
  const call = async (path, session, body) => http.request(`${BASE}${path}`, { session, ...(body === undefined ? {} : { body }) });
  const okJson = (out) => { assert.equal(out.status, 200, JSON.stringify(out.json)); return good(out.json); };
  return { ...f, ...http, acting, greg, call, okJson };
}

test('Greg reads the plan, previews without writing, keeps a draft and submits the previewed plan', async (t) => {
  const f = await httpFixture(t);
  const before = await f.state();
  const plan = f.okJson(await f.call('', f.greg)).plan;
  assert.equal(quantity(plan, TOURING), 1);
  const changes = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { min: 2 }) }];
  const preview = f.okJson(await f.call('/preview', f.greg, { changes }));
  assert.deepEqual([preview.mode, preview.preview, preview.writes], ['preview', true, 'none']);
  assert.deepEqual([quantity(preview.activePlan, TOURING), quantity(preview.plan, TOURING)], [1, 2]);
  assert.deepEqual(await f.state(), before); assert.equal(f.fake.requestCount, 0);

  assert.equal(f.okJson(await f.call('/draft', f.greg)).draft, null);
  const saved = f.okJson(await f.call('/draft', f.greg, { commandId: 'http-draft', changes }));
  assert.match(saved.draftId, /^constraint-draft-/);
  assert.deepEqual(f.okJson(await f.call('/draft', f.greg)).draft.changes, changes);

  const out = f.okJson(await f.call('/submit', f.greg, submitOf(preview.plan, 'http-submit', { changes })));
  assert.equal(f.fake.requestCount, 1);
  assert.deepEqual([out.planId, out.requests.length, f.fake.rows.future_order_requests[0].quantity], [preview.plan.planId, 1, 2]);
});

test('a stale submit reaches the client as a 409 replan-needed with its changed inputs', async (t) => {
  const f = await httpFixture(t);
  const { plan } = f.okJson(await f.call('', f.greg));
  f.okJson(await f.call('/submit', f.greg, submitOf(plan, 'http-first')));
  const stale = await f.call('/submit', f.greg, submitOf(plan, 'http-second'));
  assert.equal(stale.status, 409, JSON.stringify(stale.json));
  assert.deepEqual([stale.json.status, stale.json.code, stale.json.changedInputs], ['conflict', 'replan-needed', ['supply', 'plan']]);
  assert.match(stale.json.reason, /Replan before submitting/);
  assert.equal(f.fake.requestCount, 1);
});

test('employee and presenter sessions are refused on every route, with nothing written', async (t) => {
  const f = await httpFixture(t);
  const { plan } = f.okJson(await f.call('', f.greg));
  const changes = [{ key: 'orderPlan.budgetMinor', value: 19000000 }];
  const employee = await f.acting('demo-paula', 'http-plan-paula');
  const before = await f.state();
  const routes = [['', undefined], ['/preview', { changes }], ['/draft', undefined], ['/draft', { commandId: 'x', changes }],
    ['/publish', { commandId: 'x', expectedActiveVersion: 'gcsp-policy-v1', changes }], ['/submit', submitOf(plan, 'x')]];
  for (const [who, session] of [['employee', employee], ['presenter', f.presenter]]) {
    for (const [path, body] of routes) assert.equal((await f.call(path, session, body)).status, 403, `${who} ${path}`);
  }
  assert.equal((await f.call('')).status, 401);
  assert.deepEqual(await f.state(), before); assert.equal(f.fake.requestCount, 0);
});

test('query strings and caller-chosen run, person or quantity are refused, never honoured', async (t) => {
  const f = await httpFixture(t);
  const { plan } = f.okJson(await f.call('', f.greg));
  const changes = [{ key: 'orderPlan.budgetMinor', value: 19000000 }];
  const before = await f.state();
  for (const path of ['?runId=other-run', '/draft?x=1']) assert.equal((await f.call(path, f.greg)).status, 400, path);
  assert.equal((await f.request(`${BASE}/preview?runId=other`, { session: f.greg, body: { changes } })).status, 400);
  const posts = [['/preview', { changes }], ['/draft', { commandId: 'y', changes }], ['/submit', submitOf(plan, 'z')]];
  for (const [path, body] of posts) {
    for (const extra of [{ runId: 'other-run' }, { principalId: 'demo-paula' }, { quantity: 9 }, { requestId: 'request-x' }]) {
      assert.equal((await f.call(path, f.greg, { ...body, ...extra })).status, 400, `${path} ${Object.keys(extra)}`);
    }
  }
  assert.deepEqual(await f.state(), before); assert.equal(f.fake.requestCount, 0);
});

test('the delivered runtime exposes the order plan and submit says it is not configured', async (t) => {
  const runtime = good(await createGcspRuntime({ mode: 'memory', environmentId: 'order-plan-runtime',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'order-plan-bootstrap' }));
  t.after(() => runtime.close());
  assert.equal(runtime.dependencies.gcspOrderPlan, runtime.orderPlan);
  const presenter = good(await runtime.identity.createPresenterSession('plan-presenter')).context;
  const greg = good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', 'plan-greg')).context;
  const out = await runtime.dependencies.gcspOrderPlan.submitPlan(greg, { commandId: 'rt', planId: 'order-plan-x', versions: { plan: 'order-plan-x' } });
  assert.deepEqual([out.status, out.code], ['unavailable', 'supply-requests-not-configured']);
});
