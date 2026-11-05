import test from 'node:test';
import assert from 'node:assert/strict';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import * as notify from '../gcsp/notify/index.js';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createOutboxRoutes } from '../gcsp/notify/http.js';

const SECRET = 'synthetic-provider-secret';
const ADDRESS = 'approved@example.test';
const BASE = 'https://demo.example.test/vehicle-matcher/';
const LINK = '/gcsp/offer?token=fictional-access-value&run=synthetic';
const WALL = '2026-11-05T10:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const env = (patch = {}) => ({ GCSP_MAIL_TRANSPORT: 'brevo', GCSP_BREVO_API_KEY: SECRET,
  GCSP_MAIL_FROM: 'sender@example.test', GCSP_MAIL_FROM_NAME: 'GCSP demo',
  GCSP_MAIL_RECIPIENTS: JSON.stringify({ 'employee-paula': ADDRESS }), GCSP_PUBLIC_BASE_URL: BASE, ...patch });
const response = (status = 201, body = { messageId: '<accepted@smtp.test>' }) => ({ status, async json() { return body; } });
const cmd = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
const ref = (f) => ({ table: 'notification_outbox', key: { runId: f.context.runId, jobId: 'job-one' } });
const row = async (f) => (await f.repository.read(f.context, ref(f))).value;
async function setup(t, { mail = {}, link = LINK, state = 'pending', outcome, attempts = 0 } = {}) {
  assert.equal(typeof notify.createMailTransport, 'function');
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'mail-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T08:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const context = (await identity.createPresenterSession('presenter')).value.context;
  const ports = { repository, policy, clock, environmentId: 'mail-test', mail: { env: env(), wallNow: () => WALL, ...mail } };
  const dispatcher = new notify.NotificationDispatcher(ports);
  const f = { store, repository, policy, clock, identity, context, ports, dispatcher };
  t.after(async () => { dispatcher.close(); await repository.close(); });
  const stock = (await repository.query(context, 'stock')).value[0];
  assert.equal((await repository.transaction(context, cmd('seed'), async (tx) => {
    for (const [table, facts] of [
      ['quotes', { quoteId: 'quote-one', orderUuid: stock.orderUuid, employeeId: 'employee-paula', policyVersion: 'gcsp-policy-v1', facts: { model: 'BMW <Touring>' } }],
      ['holds', { holdId: 'hold-one', orderUuid: stock.orderUuid, employeeId: 'employee-paula', entitlementSlotId: 'slot-paula', type: 'buddy-offer', state: 'active', quoteId: 'quote-one', expiresAt: '2026-11-05T11:00:00.000Z' }],
      ['offers', { offerId: 'offer-one', holdId: 'hold-one', employeeId: 'employee-paula', orderUuid: stock.orderUuid, quoteId: 'quote-one', policyVersion: 'gcsp-policy-v1', environmentId: 'mail-test', state: 'active', expiresAt: '2026-11-05T11:00:00.000Z' }],
    ]) { const inserted = await tx.insert(table, { runId: context.runId, ...facts }); if (inserted.status !== 'ok') return inserted; }
    return tx.enqueueNotification({ runId: context.runId, jobId: 'job-one', offerId: 'offer-one', recipientId: 'employee-paula', messageKind: 'offer', messageVersion: '1',
      state, attempts, ...(outcome ? { outcome } : {}), idempotencyKey: 'offer:offer-one:notification:offer:1', inputDigest: inputDigest(link), payload: { offerLink: link } });
  })).status, 'ok');
  return f;
}
async function retry(f) {
  const job = await row(f); const state = (await f.clock.readState(f.context)).value;
  const bySeconds = (Date.parse(job.outcome.nextAttemptAt) - Date.parse(state.now)) / 1000;
  assert.equal((await f.clock.advance(f.context, { commandId: `tick:${job.attempts}`, expectedClockVersion: state.clockVersion, bySeconds })).status, 'ok');
  return f.dispatcher.dispatchPending();
}
async function directInput(f) {
  const job = await row(f);
  return { context: f.context, job, now: '2026-11-05T09:00:00.000Z', message: notify.renderOfferMessage({
    offer: { expiresAt: '2026-11-05T11:00:00.000Z', state: 'active' }, employee: { employeeId: 'employee-paula', name: 'Paula (fictional)' }, offerLink: LINK, now: '2026-11-05T09:00:00.000Z' }) };
}

test('Brevo adapter is available behind the existing MailTransport port', () => {
  assert.equal(typeof notify.BrevoMailTransport, 'function');
  assert.equal(typeof notify.createMailTransport, 'function');
});

test('backend selection defaults to capture and explicit configured dispatcher sends rendered payload', async (t) => {
  let sent;
  const f = await setup(t, { mail: { fetchImpl: async (url, options) => { sent = { url, options }; return response(); } } });
  assert.ok(notify.createMailTransport({ repository: f.repository, env: {} }) instanceof notify.CapturedTransport);
  assert.equal((await f.dispatcher.dispatchPending()).status, 'ok');
  const job = await row(f); const payload = JSON.parse(sent.options.body);
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email'); assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.headers['api-key'], SECRET);
  assert.deepEqual(payload.sender, { email: 'sender@example.test', name: 'GCSP demo' });
  assert.deepEqual(payload.to, [{ email: ADDRESS }]);
  assert.equal(payload.subject, job.outcome.message.subject);
  assert.equal(payload.textContent, job.outcome.message.textBody); assert.equal(payload.htmlContent, job.outcome.message.htmlBody);
  assert.match(payload.headers.idempotencyKey, UUID); assert.equal(payload.headers.idempotencyKey, job.outcome.provider.idempotencyKey);
  assert.equal(job.state, 'sent'); assert.equal(job.transport, 'configured');
  assert.equal(job.outcome.provider.messageId, '<accepted@smtp.test>'); assert.equal(job.outcome.provider.state, 'confirmed');
  assert.equal(job.outcome.message.offerLink, `${BASE}gcsp/offer?token=fictional-access-value&run=synthetic`);
  assert.match(payload.htmlContent, /BMW &lt;Touring&gt;/); assert.doesNotMatch(payload.textContent, /No email has been sent/);
  assert.match(payload.textContent, /Provider acceptance does not confirm inbox delivery/);
  const projected = await createOutboxRoutes({ repository: f.repository })[0].handle({ context: f.context, body: {}, searchParams: new URLSearchParams() });
  assert.equal(projected.value.messages[0].state, 'sent'); assert.equal(projected.value.messages[0].textBody, payload.textContent);
  for (const privateValue of [SECRET, ADDRESS, '<accepted@smtp.test>', job.outcome.provider.idempotencyKey]) assert.ok(!JSON.stringify(projected).includes(privateValue));
});

test('capture is committed before provider network and does not mark a failed send sent', async (t) => {
  let f;
  f = await setup(t, { mail: { fetchImpl: async () => {
    const captured = await row(f); assert.equal(captured.state, 'sending'); assert.ok(captured.outcome.message); assert.match(captured.outcome.provider.idempotencyKey, UUID);
    return response(503, { message: `${SECRET} ${ADDRESS} ${LINK}` });
  } } });
  const before = structuredClone(Object.fromEntries(['stock', 'holds', 'offers', 'employees'].map((table) => [table, f.store.state.tables[table]])));
  await f.dispatcher.dispatchPending();
  const job = await row(f); assert.equal(job.state, 'retrying'); assert.equal(job.outcome.error, 'provider-unavailable'); assert.ok(job.outcome.message);
  assert.deepEqual(Object.fromEntries(Object.keys(before).map((table) => [table, f.store.state.tables[table]])), before);
});

test('provider rejection, authentication and malformed acknowledgements map to fixed safe outcomes', async (t) => {
  for (const [status, body, error, state] of [
    [400, { message: SECRET }, 'provider-rejected', 'failed'],
    [401, { message: ADDRESS }, 'provider-authentication', 'failed'],
    [429, {}, 'provider-rate-limited', 'retrying'],
    [200, { messageId: '<not-201@smtp.test>' }, 'provider-unconfirmed', 'retrying'],
    [201, {}, 'provider-unconfirmed', 'retrying'],
    [201, { messageId: 'https://private.test/?token=secret' }, 'provider-unconfirmed', 'retrying'],
    [201, { messageId: '<unclosed-id' }, 'provider-unconfirmed', 'retrying'],
    [201, { messageId: SECRET }, 'provider-unconfirmed', 'retrying'],
  ]) await t.test(`${status} ${error}`, async (st) => {
    const f = await setup(st, { mail: { fetchImpl: async () => response(status, body) } });
    await f.dispatcher.dispatchPending(); const job = await row(f);
    assert.equal(job.state, state); assert.equal(job.outcome.error, error); assert.ok(job.outcome.message); assert.equal(job.outcome.provider.messageId, undefined);
  });
});

test('allowlist and invalid partial configuration refuse before network and retain capture', async (t) => {
  for (const patch of [{ GCSP_MAIL_RECIPIENTS: '{}' }, { GCSP_MAIL_RECIPIENTS: '{invalid' }, { GCSP_BREVO_API_KEY: '' },
    { GCSP_MAIL_FROM: 'bad\nvalue' }, { GCSP_PUBLIC_BASE_URL: 'http://localhost:3000/' }, { GCSP_MAIL_TRANSPORT: 'unknown' }]) {
    await t.test(Object.keys(patch)[0], async (st) => {
      let calls = 0; const f = await setup(st, { mail: { env: env(patch), fetchImpl: async () => { calls++; return response(); } } });
      await f.dispatcher.dispatchPending(); const job = await row(f);
      assert.equal(calls, 0); assert.equal(job.state, 'failed'); assert.ok(job.outcome.message);
    });
  }
  await t.test('mapped address outside separately injected allowed set', async (st) => {
    let calls = 0; const f = await setup(st, { state: 'sending', attempts: 1 });
    const transport = new notify.BrevoMailTransport({ repository: f.repository, apiKey: SECRET, sender: { email: 'sender@example.test', name: 'GCSP demo' },
      recipients: { 'employee-paula': ADDRESS }, allowedRecipients: ['other@example.test'], publicBaseUrl: BASE, wallNow: () => WALL, fetchImpl: async () => { calls++; return response(); } });
    const result = await transport.send(await directInput(f));
    assert.equal(result.code, 'recipient-not-allowed'); assert.equal(result.retryable, false); assert.equal(calls, 0); assert.ok((await row(f)).outcome.message);
  });
});

test('timeout and thrown provider diagnostics remain retryable and never reach logs', async (t) => {
  for (const kind of ['timeout', 'exception']) await t.test(kind, async (st) => {
    const logs = [];
    const f = await setup(st, { mail: { timeoutMs: 10, fetchImpl: kind === 'timeout' ? async () => new Promise(() => {}) : async () => { throw new Error(`${SECRET} ${ADDRESS} ${LINK}`); } } });
    const dispatcher = new notify.NotificationDispatcher({ ...f.ports, logger: { warn: (entry) => logs.push(entry) } });
    await dispatcher.dispatchPending(); dispatcher.close();
    const job = await row(f); assert.equal(job.state, 'retrying'); assert.equal(job.outcome.error, kind === 'timeout' ? 'provider-timeout' : 'provider-unavailable');
    assert.ok(job.outcome.message); assert.equal(logs.length, 1);
    for (const value of [SECRET, ADDRESS, LINK, 'fictional-access-value']) assert.ok(!JSON.stringify(logs).includes(value));
  });
});

test('stable UUID survives policy retry, repository reopen and a fresh dispatcher', async (t) => {
  const keys = []; let calls = 0;
  const mail = { fetchImpl: async (_url, options) => { keys.push(JSON.parse(options.body).headers.idempotencyKey); calls++; return calls === 1 ? response(503, {}) : response(); } };
  const f = await setup(t, { mail }); await f.dispatcher.dispatchPending();
  const first = await row(f); const rules = (await f.policy.getAssumption('notify.delivery.v1', { runId: f.context.runId, asOf: first.outcome.attemptedAt })).value.value;
  assert.equal(Date.parse(first.outcome.nextAttemptAt) - Date.parse(first.outcome.attemptedAt), rules.retryBaseSeconds * 1000);
  await f.repository.close(); assert.equal((await f.repository.open()).status, 'ok');
  f.dispatcher = new notify.NotificationDispatcher(f.ports); await retry(f);
  assert.equal((await row(f)).state, 'sent'); assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
  await new notify.NotificationDispatcher(f.ports).dispatchPending(); assert.equal(calls, 2);
});

test('concurrent transports reuse the CAS winner UUID and the persisted confirmed acknowledgement', async (t) => {
  const keys = []; let release; const gate = new Promise((resolve) => { release = resolve; });
  const f = await setup(t, { state: 'sending', attempts: 1 }); const input = await directInput(f);
  const options = { repository: f.repository, env: env(), wallNow: () => WALL, fetchImpl: async (_url, request) => { keys.push(JSON.parse(request.body).headers.idempotencyKey); await gate; return response(); } };
  const a = notify.createMailTransport(options); const b = notify.createMailTransport(options);
  const sends = [a.send(input), b.send(input)];
  await new Promise((resolve) => setImmediate(resolve)); release();
  assert.ok((await Promise.all(sends)).every((outcome) => outcome.status === 'ok'));
  assert.ok(keys.length >= 1); assert.ok(keys.every((key) => key === keys[0])); assert.match(keys[0], UUID);
  const stored = await row(f); assert.equal(stored.outcome.provider.state, 'confirmed');
  await f.repository.close(); await f.repository.open();
  assert.equal((await notify.createMailTransport({ ...options, fetchImpl: async () => { assert.fail('confirmed ack must not resend'); } }).send(input)).status, 'ok');
  assert.equal((await row(f)).outcome.provider.messageId, stored.outcome.provider.messageId);
});

test('duplicate response is ambiguous and expired wall-time window refuses another network send', async (t) => {
  let wall = WALL; let calls = 0;
  const f = await setup(t, { mail: { wallNow: () => wall, fetchImpl: async () => { calls++; return response(400, { code: 'duplicate_parameter', messageId: '<not-confirmed@smtp.test>' }); } } });
  await f.dispatcher.dispatchPending(); let job = await row(f);
  assert.equal(job.state, 'retrying'); assert.equal(job.outcome.error, 'provider-unconfirmed'); assert.equal(job.outcome.provider.messageId, undefined);
  wall = '2026-11-05T10:30:00.000Z'; await retry(f); job = await row(f);
  assert.equal(job.state, 'failed'); assert.equal(job.outcome.error, 'provider-window-expired'); assert.equal(calls, 1); assert.ok(job.outcome.message);
});

test('real transport resolves only canonical public project links and preserves query/run access data', async (t) => {
  for (const link of [`${BASE}gcsp/offer?token=fictional-access-value&run=synthetic`, 'https://unrelated.test/gcsp/offer?token=x',
    'https://user:password@demo.example.test/vehicle-matcher/gcsp/offer', '/other/route?token=x', '/gcsp/offer?token=x#fragment']) {
    await t.test(link.split('?')[0], async (st) => {
      let calls = 0; const f = await setup(st, { link, mail: { fetchImpl: async () => { calls++; return response(); } } });
      await f.dispatcher.dispatchPending(); const job = await row(f);
      const accepted = link === `${BASE}gcsp/offer?token=fictional-access-value&run=synthetic`;
      assert.equal(calls, accepted ? 1 : 0); assert.equal(job.state, accepted ? 'sent' : 'failed');
      if (!link.includes('user:password@')) assert.ok(job.outcome.message);
      if (accepted) assert.equal(job.outcome.message.offerLink, link);
    });
  }
});

test('reset before send and reset during provider request cannot acknowledge an old run', async (t) => {
  let release; const gate = new Promise((resolve) => { release = resolve; }); let began; const started = new Promise((resolve) => { began = resolve; });
  const f = await setup(t, { mail: { fetchImpl: async () => { began(); await gate; return response(); } } });
  const sending = f.dispatcher.dispatchPending(); await started;
  const state = (await f.clock.readState(f.context)).value;
  assert.equal((await f.clock.reset(f.context, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  release(); assert.equal((await sending).status, 'stale-run'); assert.equal((await row(f)).state, 'stale');
  const transport = notify.createMailTransport({ repository: f.repository, env: env(), fetchImpl: async () => { assert.fail('old run cannot send'); } });
  assert.equal((await transport.send(await directInput(f))).status, 'stale-run');
});


test('trusted runtime composes capture by default, configured transport and notification shutdown', async (t) => {
  const runtime = await createGcspRuntime({ mode: 'memory', environmentId: 'runtime-mail', policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'runtime-bootstrap', mail: { env: {} } });
  assert.equal(runtime.status, 'ok'); t.after(() => runtime.value.close());
  assert.ok(runtime.value.dependencies.gcspNotify instanceof notify.NotificationDispatcher);
  assert.equal(runtime.value.dependencies.gcspOutbox.repository, runtime.value.repository);
  assert.equal((await runtime.value.dependencies.gcspNotify.start()).status, 'ok');
  await runtime.value.close();
  assert.equal((await runtime.value.repository.currentRun('runtime-mail')).status, 'unavailable');
});

test('trusted runtime startup actually dispatches captured, configured and invalid-config jobs', async (t) => {
  for (const mode of ['captured', 'brevo', 'invalid']) await t.test(mode, async (st) => {
    const f = await setup(st); let calls = 0; const events = [];
    const repository = { ...f.repository, afterCommit(observer) {
      events.push('subscribed'); const unsubscribe = f.repository.afterCommit(observer);
      return () => { events.push('unsubscribed'); unsubscribe(); };
    }, async close() { events.push('closed'); return f.repository.close(); } };
    const runtime = await createGcspRuntime({ mode: 'memory', repository, policy: f.policy, environmentId: 'mail-test',
      policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T08:00:00.000Z',
      mail: { env: mode === 'captured' ? {} : env(mode === 'invalid' ? { GCSP_BREVO_API_KEY: '' } : {}),
        wallNow: () => WALL, fetchImpl: async () => { calls++; return response(); } } });
    assert.equal(runtime.status, 'ok');
    assert.equal((await runtime.value.dependencies.gcspNotify.start()).status, 'ok');
    const stored = await row(f);
    assert.equal(stored.state, mode === 'invalid' ? 'failed' : 'sent'); assert.ok(stored.outcome.message);
    assert.equal(calls, mode === 'brevo' ? 1 : 0);
    assert.equal(stored.outcome.provider?.state, mode === 'brevo' ? 'confirmed' : undefined);
    if (mode === 'captured') assert.match(stored.outcome.message.textBody, /No email has been sent/);
    if (mode === 'invalid') assert.equal(stored.outcome.error, 'mail-configuration-invalid');
    await runtime.value.close(); assert.deepEqual(events, ['subscribed', 'unsubscribed', 'closed']);
  });
});

test('restart finalises a confirmed provider acknowledgement after offer expiry without another send', async (t) => {
  const f = await setup(t, { state: 'sending', attempts: 1 });
  const transport = notify.createMailTransport({ ...f.ports.mail, repository: f.repository, fetchImpl: async () => response() });
  assert.equal((await transport.send(await directInput(f))).status, 'ok');
  const acknowledged = await row(f); assert.equal(acknowledged.state, 'sending');
  assert.equal(acknowledged.outcome.provider.state, 'confirmed');
  const clock = (await f.clock.readState(f.context)).value;
  assert.equal((await f.clock.advance(f.context, { commandId: 'past-offer-expiry', expectedClockVersion: clock.clockVersion, bySeconds: 10800 })).status, 'ok');
  const fresh = new notify.NotificationDispatcher({ ...f.ports, mail: { ...f.ports.mail, fetchImpl: async () => { assert.fail('confirmed acceptance must not resend'); } } });
  t.after(() => fresh.close());
  assert.equal((await fresh.dispatchPending()).status, 'ok');
  const sent = await row(f); assert.equal(sent.state, 'sent'); assert.equal(sent.outcome.error, null);
  assert.equal(sent.outcome.provider.messageId, acknowledged.outcome.provider.messageId);
  assert.equal(sent.outcome.provider.idempotencyKey, acknowledged.outcome.provider.idempotencyKey);
  assert.deepEqual(sent.outcome.message, acknowledged.outcome.message);
});

test('confirmed acknowledgement on a retired run cannot be finalised by a fresh dispatcher', async (t) => {
  const f = await setup(t, { state: 'sending', attempts: 1 });
  const transport = notify.createMailTransport({ ...f.ports.mail, repository: f.repository, fetchImpl: async () => response() });
  assert.equal((await transport.send(await directInput(f))).status, 'ok');
  const state = (await f.clock.readState(f.context)).value;
  assert.equal((await f.clock.reset(f.context, { commandId: 'reset-confirmed', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  const fresh = new notify.NotificationDispatcher({ ...f.ports, mail: { ...f.ports.mail, fetchImpl: async () => { assert.fail('retired run must not send'); } } });
  t.after(() => fresh.close());
  assert.equal((await fresh.dispatchPending(f.context)).status, 'stale-run');
  assert.equal((await row(f)).state, 'stale');
});

test('runtime shutdown joins an in-flight provider acknowledgement before closing its repository', async (t) => {
  const f = await setup(t); let began; const started = new Promise((resolve) => { began = resolve; });
  let release; const gate = new Promise((resolve) => { release = resolve; }); let repositoryClosed = false;
  const repository = { ...f.repository, async close() { repositoryClosed = true; return f.repository.close(); } };
  const runtime = await createGcspRuntime({ mode: 'memory', repository, policy: f.policy, environmentId: 'mail-test',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T08:00:00.000Z',
    mail: { env: env(), wallNow: () => WALL, fetchImpl: async () => { began(); await gate; return response(); } } });
  assert.equal(runtime.status, 'ok');
  const sending = runtime.value.dependencies.gcspNotify.start(); await started;
  const closing = runtime.value.close(); await new Promise((resolve) => setImmediate(resolve));
  const closedEarly = repositoryClosed; release(); await sending; await closing;
  assert.equal(closedEarly, false); assert.equal(repositoryClosed, true);
  assert.equal((await f.repository.open()).status, 'ok');
  assert.equal((await row(f)).state, 'sent'); assert.equal((await row(f)).outcome.provider.state, 'confirmed');
});
