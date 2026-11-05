// FUCQ-97: presenter-only captured outbox route, composed through buildServer with the real clock,
// identity, repository and dispatcher. Seeds follow server/test/gcsp-outbox.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { NotificationDispatcher, CapturedTransport } from '../gcsp/notify/index.js';
import { buildServer } from '../index.js';
import { outcomeToState } from '../../blocks/gcsp/presenter/http-adapter.js';

const ORIGIN = 'https://outbox.test';
const link = '/gcsp/offer?token=fictional-route-access-value&run=synthetic';
const cmd = (commandId, input = commandId) => ({ commandId, inputDigest: inputDigest(input) });

async function setup(t, { failFor = [] } = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore() });
  assert.equal((await repository.open()).status, 'ok');
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'route-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T08:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const captured = new CapturedTransport({ repository });
  const transport = { async send(input) { return failFor.includes(input.job.recipientId) ? { status: 'unavailable', retryable: true } : captured.send(input); } };
  const dispatcher = new NotificationDispatcher({ repository, policy, clock, environmentId: 'route-test', transport });
  t.after(async () => { dispatcher.close(); await repository.close(); });
  return { repository, clock, identity, dispatcher, context: presenter.value.context, presenter };
}

async function seed(f, { id, employeeId, entitlementSlotId, stockIndex }) {
  const runId = f.context.runId;
  const stock = (await f.repository.query(f.context, 'stock')).value[stockIndex];
  return f.repository.transaction(f.context, cmd(`seed:${id}`), async (tx) => {
    const rows = [
      ['quotes', { quoteId: `quote-${id}`, orderUuid: stock.orderUuid, employeeId, policyVersion: 'gcsp-policy-v1', facts: { model: 'BMW 320i Touring' } }],
      ['holds', { holdId: `hold-${id}`, orderUuid: stock.orderUuid, employeeId, entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: `quote-${id}`, expiresAt: '2026-11-05T11:00:00.000Z' }],
      ['offers', { offerId: `offer-${id}`, holdId: `hold-${id}`, employeeId, orderUuid: stock.orderUuid, quoteId: `quote-${id}`, policyVersion: 'gcsp-policy-v1',
        environmentId: 'route-test', state: 'active', expiresAt: '2026-11-05T11:00:00.000Z' }],
    ];
    for (const [table, row] of rows) { const inserted = await tx.insert(table, { runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    const queued = await tx.enqueueNotification({ runId, jobId: `job-${id}`, offerId: `offer-${id}`, recipientId: employeeId, messageKind: 'offer', messageVersion: '1',
      state: 'pending', attempts: 0, idempotencyKey: `offer:offer-${id}:notification:offer:1`, inputDigest: inputDigest([id, link]), payload: { offerLink: link } });
    return queued.status !== 'ok' ? queued : ok({ committed: id });
  });
}

async function serve(t, f, extra = {}) {
  const server = buildServer({ gcspClock: f.clock, gcspIdentity: f.identity, gcspNotify: f.dispatcher, gcspOutbox: { repository: f.repository },
    gcspAllowedOrigins: [ORIGIN], ...extra });
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); });
  assert.equal((await server.gcspStartup).status, 'ok');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { cookie, body, method = body ? 'POST' : 'GET' } = {}) => {
    const response = await fetch(`${base}/api/gcsp/${path}`, { method, headers: { Origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control'), cookies: response.headers.getSetCookie() };
  };
  return { server, call };
}
const jar = (setCookie) => [].concat(setCookie).map((value) => value.split(';')[0]).join('; ');

test('presenter reads the run captured messages as a safe projection, newest first, with sent and retrying rows', async (t) => {
  const f = await setup(t, { failFor: ['employee-alex'] });
  await seed(f, { id: 'one', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', stockIndex: 0 });
  await seed(f, { id: 'two', employeeId: 'employee-alex', entitlementSlotId: 'slot-alex', stockIndex: 1 });
  const { call } = await serve(t, f);
  const cookie = jar(f.presenter.value.setCookie);
  const response = await call('presenter/outbox', { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.cache, 'no-store');
  const { runId, messages } = response.body.value;
  assert.equal(runId, f.context.runId);
  assert.equal(messages.length, 2);
  const sent = messages.find((m) => m.jobId === 'job-one');
  const retrying = messages.find((m) => m.jobId === 'job-two');
  assert.equal(sent.state, 'sent');
  assert.deepEqual(sent.recipient, { employeeId: 'employee-paula', name: 'Paula (fictional)' });
  assert.equal(sent.offerLink, link);
  assert.match(sent.subject, /vehicle offer/);
  assert.match(sent.htmlBody, /<h1/);
  assert.match(sent.textBody, /No email has been sent/);
  assert.equal(sent.time, '2026-11-05T09:00:00.000Z');
  assert.equal(retrying.state, 'retrying');
  assert.equal(retrying.attempts, 1);
  assert.equal(retrying.error, 'transport-unavailable');
  assert.ok(retrying.nextAttemptAt);
  assert.equal(retrying.htmlBody, null);
  assert.equal(retrying.offerLink, null);
  assert.equal(retrying.recipient.employeeId, 'employee-alex');
  assert.equal(typeof retrying.recipient.name, 'string');
  for (const message of messages) {
    assert.deepEqual(Object.keys(message).sort(), ['attempts', 'error', 'htmlBody', 'jobId', 'messageKind', 'nextAttemptAt', 'offerLink', 'recipient', 'state', 'subject', 'textBody', 'time']);
  }
  const raw = JSON.stringify(response.body);
  for (const secret of ['payload', 'idempotencyKey', 'inputDigest']) assert.ok(!raw.includes(secret), secret);
  assert.deepEqual(outcomeToState(response.status, response.body).status, 'ready');
});

test('rows sort newest first by time with nulls last, then job id', async (t) => {
  const f = await setup(t);
  await seed(f, { id: 'one', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', stockIndex: 0 });
  await f.dispatcher.dispatchPending();
  const state = (await f.clock.readState(f.context)).value;
  await f.clock.advance(f.context, { commandId: 'later', expectedClockVersion: state.clockVersion, bySeconds: 600 });
  await seed(f, { id: 'two', employeeId: 'employee-alex', entitlementSlotId: 'slot-alex', stockIndex: 1 });
  await f.dispatcher.dispatchPending();
  const { call } = await serve(t, f);
  const { body } = await call('presenter/outbox', { cookie: jar(f.presenter.value.setCookie) });
  assert.deepEqual(body.value.messages.map((m) => m.jobId), ['job-two', 'job-one']);
  assert.ok(Date.parse(body.value.messages[0].time) > Date.parse(body.value.messages[1].time));
});

test('no cookie, an employee and Greg are refused with 403 forbidden; the real body maps to the refused state', async (t) => {
  const f = await setup(t);
  await seed(f, { id: 'one', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', stockIndex: 0 });
  const { call } = await serve(t, f);
  const none = await call('presenter/outbox');
  assert.equal(none.status, 403);
  assert.equal(none.body.status, 'forbidden');
  for (const principal of ['demo-paula', 'demo-greg']) {
    const switched = await f.identity.switchPrincipal(f.context, principal, `switch-${principal}`);
    assert.equal(switched.status, 'ok', principal);
    const acting = jar(switched.value.setCookie);
    assert.ok(acting.startsWith('gcsp_session='), 'only the acting session cookie is sent');
    const refused = await call('presenter/outbox', { cookie: acting });
    assert.equal(refused.status, 403, principal);
    assert.equal(refused.body.status, 'forbidden');
    assert.ok(!JSON.stringify(refused.body).includes('job-one'));
    assert.equal(outcomeToState(refused.status, refused.body).status, 'refused');
  }
  assert.equal(outcomeToState(none.status, none.body).status, 'refused');
});

test('a query parameter is invalid and a missing composition is unavailable', async (t) => {
  const f = await setup(t);
  const cookie = jar(f.presenter.value.setCookie);
  const { call } = await serve(t, f);
  const query = await call('presenter/outbox?runId=other', { cookie });
  assert.equal(query.status, 400);
  assert.equal(query.body.status, 'invalid');
  assert.equal(query.body.code === 'browser-context-forbidden' || query.body.code === 'unsupported-query', true);
  const extra = await call('presenter/outbox?limit=1', { cookie });
  assert.equal(extra.body.code, 'unsupported-query');
  const bare = await serve(t, f, { gcspOutbox: undefined });
  const missing = await bare.call('presenter/outbox', { cookie });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.status, 'unavailable');
  assert.equal(outcomeToState(missing.status, missing.body).status, 'unavailable');
});

test('after a reset the old presenter cookie is stale and the renewed one sees only the new run', async (t) => {
  const f = await setup(t);
  await seed(f, { id: 'one', employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', stockIndex: 0 });
  const { call } = await serve(t, f);
  const oldCookie = jar(f.presenter.value.setCookie);
  const before = await call('presenter/outbox', { cookie: oldCookie });
  assert.equal(before.body.value.messages.length, 1);
  const state = (await call('presenter/clock', { cookie: oldCookie })).body.value;
  const reset = await call('presenter/clock/reset', { cookie: oldCookie, body: { commandId: 'route-reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture } });
  assert.equal(reset.body.status, 'ok', JSON.stringify(reset.body));
  const stale = await call('presenter/outbox', { cookie: oldCookie });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.status, 'stale-run');
  assert.equal(outcomeToState(stale.status, stale.body).status, 'refused');
  const fresh = await call('presenter/outbox', { cookie: jar(reset.cookies) });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.body.value.runId, before.body.value.runId);
  assert.deepEqual(fresh.body.value.messages, []);
  assert.equal(outcomeToState(fresh.status, fresh.body).status, 'empty');
});
