import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createPolicyService, PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { NotificationDispatcher, CapturedTransport, MailTransport, renderOfferMessage } from '../gcsp/notify/index.js';
import { buildServer } from '../index.js';

const token = 'fictional-outbox-access-value';
const link = `/gcsp/offer?token=${token}&run=synthetic`;
const cmd = (commandId, input = commandId) => ({ commandId, inputDigest: inputDigest(input) });
async function setup(t, { policy = createPolicyService(), transport, logger } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'outbox-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T08:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  assert.equal(presenter.status, 'ok');
  const context = presenter.value.context;
  const dispatcher = new NotificationDispatcher({ repository, policy, clock, environmentId: 'outbox-test',
    ...(transport ? { transport: transport(repository) } : {}), logger });
  t.after(async () => { dispatcher.close(); await repository.close(); });
  return { repository, store, clock, identity, context, policy, dispatcher };
}
const jobRef = (f, jobId = 'job-one') => ({ table: 'notification_outbox', key: { runId: f.context.runId, jobId } });
const job = async (f, jobId) => (await f.repository.read(f.context, jobRef(f, jobId))).value;
async function seed(f, { id = 'one', offerPatch = {}, jobPatch = {}, rollback = false, employeeId = 'employee-paula', entitlementSlotId = 'slot-paula', stockIndex = 0 } = {}) {
  const runId = f.context.runId;
  const stock = (await f.repository.query(f.context, 'stock')).value[stockIndex];
  return f.repository.transaction(f.context, cmd(`seed:${id}`), async (tx) => {
    const rows = [
      ['quotes', { quoteId: `quote-${id}`, orderUuid: stock.orderUuid, employeeId, policyVersion: 'gcsp-policy-v1', facts: { model: 'BMW 320i Touring' } }],
      ['holds', { holdId: `hold-${id}`, orderUuid: stock.orderUuid, employeeId, entitlementSlotId,
        type: 'buddy-offer', state: 'active', quoteId: `quote-${id}`, expiresAt: '2026-11-05T11:00:00.000Z' }],
      ['offers', { offerId: `offer-${id}`, holdId: `hold-${id}`, employeeId, orderUuid: stock.orderUuid,
        quoteId: `quote-${id}`, policyVersion: 'gcsp-policy-v1', environmentId: 'outbox-test', state: 'active', expiresAt: '2026-11-05T11:00:00.000Z', ...offerPatch }],
    ];
    for (const [table, row] of rows) { const inserted = await tx.insert(table, { runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    const queued = await tx.enqueueNotification({ runId, jobId: `job-${id}`, offerId: `offer-${id}`, recipientId: employeeId,
      messageKind: 'offer', messageVersion: '1', state: 'pending', attempts: 0,
      idempotencyKey: `offer:offer-${id}:notification:offer:1`, inputDigest: inputDigest([id, link]), payload: { offerLink: link }, ...jobPatch });
    return queued.status !== 'ok' ? queued : rollback ? result('conflict', { reason: 'synthetic-rollback' }) : ok({ committed: id });
  });
}
async function move(f, seconds, id = 'advance') {
  const state = (await f.clock.readState(f.context)).value;
  return f.clock.advance(f.context, { commandId: id, expectedClockVersion: state.clockVersion, bySeconds: seconds });
}

test('default captured MailTransport persists fictional message and startup registers the real clock handler', async (t) => {
  const f = await setup(t);
  assert.ok(new CapturedTransport({ repository: f.repository }) instanceof MailTransport);
  assert.equal((await seed(f)).status, 'ok');
  const server = buildServer({ gcspClock: f.clock, gcspIdentity: f.identity, gcspNotify: f.dispatcher });
  assert.equal((await server.gcspStartup).status, 'ok');
  const stored = await job(f);
  assert.equal(stored.state, 'sent');
  assert.equal(stored.transport, 'captured');
  assert.equal(stored.attempts, 1);
  assert.deepEqual(stored.outcome.message.recipient, { employeeId: 'employee-paula', name: 'Paula (fictional)', fictional: true });
  assert.equal(stored.outcome.message.offerLink, link);
  assert.equal(stored.outcome.message.capturedAt, (await f.clock.now(f.context)).value.now);
  assert.match(stored.outcome.message.textBody, /No email has been sent/);
  const tick = await f.clock.tick(f.context, { eventId: 'tick-with-notify', expectedClockVersion: '1', inputDigest: inputDigest('tick') });
  assert.equal(tick.status, 'ok');
  assert.ok(tick.value.handlerOrder.some((row) => row.handlerId === 'captured-outbox' && row.stage === 'outbox-dispatch'));
  assert.equal((await job(f)).attempts, 1);
});

test('actual commit observer captures after commit, never on rollback or command replay and never recursively', async (t) => {
  const f = await setup(t);
  assert.equal((await f.dispatcher.start()).status, 'ok');
  const before = (await f.repository.query(f.context, 'stock')).value;
  assert.equal((await seed(f, { id: 'rollback', rollback: true })).status, 'conflict');
  assert.equal((await f.repository.read(f.context, jobRef(f, 'job-rollback'))).status, 'not-found');
  assert.deepEqual((await seed(f)).value, { committed: 'one' });
  assert.equal((await job(f)).state, 'sent');
  const receiptCount = f.store.state.tables.event_receipts.length;
  assert.deepEqual((await seed(f)).value, { committed: 'one' });
  assert.equal(f.store.state.tables.event_receipts.length, receiptCount);
  assert.deepEqual((await f.repository.query(f.context, 'stock')).value, before);
});

test('coalesced and independent concurrent drains capture each stable job once', async (t) => {
  const f = await setup(t);
  await seed(f);
  const other = new NotificationDispatcher({ repository: f.repository, policy: f.policy, clock: f.clock, environmentId: 'outbox-test' });
  const outcomes = await Promise.all([f.dispatcher.dispatchPending(), other.dispatchPending(), f.dispatcher.dispatchPending()]);
  assert.ok(outcomes.every((outcome) => outcome.status === 'ok'));
  const stored = await job(f);
  assert.equal(stored.state, 'sent');
  assert.equal(stored.attempts, 1);
  assert.equal(f.store.state.tables.notification_outbox.filter((row) => row.outcome?.message).length, 1);
  assert.equal((await f.dispatcher.dispatchPending()).status, 'ok');
  assert.deepEqual(await job(f), stored);
});

test('an injected transport acknowledgement is persisted before any later retry', async (t) => {
  let calls = 0;
  const f = await setup(t, { transport: () => ({ async send() { calls += 1; return ok({ accepted: true }); } }) });
  await seed(f); await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).state, 'sent'); assert.equal((await job(f)).transport, 'configured');
  await f.dispatcher.dispatchPending(); assert.equal(calls, 1);
});

test('a real commit arriving during a drain is captured by its queued follow-up', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  let calls = 0;
  const f = await setup(t, { transport: (repository) => {
    const captured = new CapturedTransport({ repository });
    return { async send(input) { calls += 1; if (calls === 1) { began(); await gate; } return captured.send(input); } };
  } });
  await seed(f);
  const starting = f.dispatcher.start();
  await started;
  let observed;
  const secondCommitted = new Promise((resolve) => { observed = resolve; });
  const unsubscribe = f.repository.afterCommit(({ commandId }) => { if (commandId === 'seed:two') observed(); });
  const second = seed(f, { id: 'two', employeeId: 'employee-alex', entitlementSlotId: 'slot-alex', stockIndex: 1 });
  await secondCommitted;
  release();
  assert.equal((await second).status, 'ok'); assert.equal((await starting).status, 'ok');
  assert.equal((await job(f)).state, 'sent'); assert.equal((await job(f, 'job-two')).state, 'sent');
  assert.equal(calls, 2); unsubscribe();
});

test('failure is visible with safe error, attempt and canonical demo-clock backoff; retry captures once', async (t) => {
  let calls = 0;
  const f = await setup(t, { transport: (repository) => {
    const captured = new CapturedTransport({ repository });
    return { async send(input) { calls += 1; if (calls === 1) throw new Error(`private ${token}`); return captured.send(input); } };
  } });
  await seed(f);
  const before = structuredClone(Object.fromEntries(['stock', 'holds', 'offers', 'employees'].map((table) => [table, f.store.state.tables[table]])));
  assert.equal((await f.dispatcher.dispatchPending()).status, 'ok');
  const failed = await job(f);
  const rules = (await f.policy.getAssumption('notify.delivery.v1', { runId: f.context.runId, asOf: (await f.clock.now(f.context)).value.now })).value.value;
  assert.equal(failed.state, 'retrying'); assert.equal(failed.attempts, 1);
  assert.equal(failed.outcome.error, 'transport-unavailable');
  assert.equal(Date.parse(failed.outcome.nextAttemptAt) - Date.parse(failed.outcome.attemptedAt), rules.retryBaseSeconds * 1000);
  assert.equal((await f.dispatcher.dispatchPending()).status, 'ok'); assert.equal(calls, 1);
  assert.deepEqual(Object.fromEntries(Object.keys(before).map((table) => [table, f.store.state.tables[table]])), before);
  await move(f, rules.retryBaseSeconds);
  await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).state, 'sent'); assert.equal((await job(f)).attempts, 2);
  assert.equal((await f.dispatcher.dispatchPending()).status, 'ok'); assert.equal(calls, 2);
});

test('one canonical policy change controls retry cap, delay and terminal failed state', async (t) => {
  const seedPolicy = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  seedPolicy.assumptions.find((row) => row.key === 'notify.delivery.v1').value = { maxAttempts: 2, retryBaseSeconds: 7, retryMaximumSeconds: 9 };
  const f = await setup(t, { policy: new PolicyService({ provider: { async loadVersions() { return [seedPolicy]; } } }), transport: () => ({ async send() { return result('unavailable'); } }) });
  await seed(f); await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).outcome.nextAttemptAt, '2026-11-05T09:00:07.000Z');
  await move(f, 7); await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).state, 'failed'); assert.equal((await job(f)).attempts, 2);
  assert.equal((await job(f)).outcome.nextAttemptAt, null);
  await move(f, 100, 'later'); await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).attempts, 2);
  assert.equal((await f.repository.query(f.context, 'offers')).value[0].state, 'active');
});

test('dispatcher or observer failure cannot replace the successful committed command', async (t) => {
  const f = await setup(t, { transport: () => ({ async send() { throw new Error(token); } }) });
  const unsubscribe = f.repository.afterCommit(() => { throw new Error(token); });
  await f.dispatcher.start();
  const committed = await seed(f);
  assert.equal(committed.status, 'ok'); assert.deepEqual(committed.value, { committed: 'one' });
  assert.equal((await job(f)).state, 'retrying');
  assert.equal((await f.repository.query(f.context, 'offers')).value[0].state, 'active');
  unsubscribe();
});

test('reset atomically marks old unsent jobs stale and refuses old drains; sent history persists', async (t) => {
  const f = await setup(t);
  await seed(f); await f.dispatcher.dispatchPending();
  // Avoid a second active hold for the same exact synthetic car.
  await f.repository.transaction(f.context, cmd('release-fixture'), async (tx) => {
    const hold = (await tx.get({ table: 'holds', key: { runId: f.context.runId, holdId: 'hold-one' } })).value;
    return tx.compareAndSwap({ table: 'holds', key: { runId: f.context.runId, holdId: 'hold-one' } }, hold.version, { state: 'released' });
  });
  await seed(f, { id: 'unsent' });
  const state = (await f.clock.readState(f.context)).value;
  const reset = await f.clock.reset(f.context, { commandId: 'reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
  assert.equal(reset.status, 'ok');
  assert.equal((await job(f, 'job-unsent')).state, 'stale');
  assert.equal((await job(f, 'job-unsent')).outcome.error, 'stale-run');
  assert.equal((await job(f)).state, 'sent');
  assert.equal((await f.dispatcher.dispatchPending(f.context)).status, 'stale-run');
  assert.deepEqual((await f.dispatcher.dispatchPending()).value, { sent: 0, retrying: 0, failed: 0 });
});

test('a failed replacement seed rolls back stale marking with the run transition', async (t) => {
  const f = await setup(t);
  await seed(f);
  const current = (await f.repository.currentRun('outbox-test')).value;
  const reset = await f.repository.resetRun(f.context, cmd('invalid-reset'), { expectedCurrentRunId: current.runId, expectedRunVersion: current.version,
    nextRun: { ...current, runId: 'failed-replacement' }, rows: [['entitlement_slots', { entitlementSlotId: 'orphan', employeeId: 'missing-person', capacity: 1 }]] });
  assert.equal(reset.status, 'conflict'); assert.equal((await job(f)).state, 'pending');
  assert.equal((await f.repository.currentRun('outbox-test')).value.runId, current.runId);
});

test('captured message survives repository reopen and a fresh dispatcher does not send again', async (t) => {
  const f = await setup(t);
  await seed(f); await f.dispatcher.dispatchPending();
  const original = await job(f);
  await f.repository.close();
  assert.equal((await f.repository.open()).status, 'ok');
  await f.dispatcher.dispatchPending();
  assert.deepEqual(await job(f), original);
});

test('interrupted sending attempt resumes its durable job identity without another attempt or capture', async (t) => {
  const f = await setup(t);
  await seed(f);
  await f.repository.transaction(f.context, cmd('interrupted-attempt'), (tx) => tx.compareAndSwap(jobRef(f), 1,
    { state: 'sending', attempts: 1, outcome: { attemptedAt: '2026-11-05T09:00:00.000Z', error: null, nextAttemptAt: null } }));
  await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).state, 'sent'); assert.equal((await job(f)).attempts, 1);
  const stored = await job(f);
  await f.dispatcher.dispatchPending(); assert.deepEqual(await job(f), stored);
});

test('an in-flight captured acknowledgement cannot send after reset retires its run', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let began;
  const started = new Promise((resolve) => { began = resolve; });
  const f = await setup(t, { transport: (repository) => {
    const captured = new CapturedTransport({ repository });
    return { async send(input) { began(); await gate; return captured.send(input); } };
  } });
  await seed(f);
  const dispatch = f.dispatcher.dispatchPending();
  await started;
  const state = (await f.clock.readState(f.context)).value;
  const reset = await f.clock.reset(f.context, { commandId: 'reset-in-flight', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
    scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
  assert.equal((await f.dispatcher.dispatchPending(f.context)).status, 'stale-run');
  release();
  assert.equal(reset.status, 'ok'); assert.equal((await dispatch).status, 'stale-run');
  assert.equal((await job(f)).state, 'stale'); assert.equal((await job(f)).outcome.message, undefined);
});

test('capture refuses recipients outside the canonical fictional identity registry', async (t) => {
  const f = await setup(t);
  await seed(f);
  await f.repository.transaction(f.context, cmd('non-fictional-fixture'), async (tx) => {
    const employee = (await tx.get({ table: 'employees', key: { runId: f.context.runId, employeeId: 'employee-paula' } })).value;
    return tx.compareAndSwap({ table: 'employees', key: { runId: f.context.runId, employeeId: 'employee-paula' } }, employee.version,
      { principalId: 'unregistered-person' });
  });
  await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).state, 'failed'); assert.equal((await job(f)).outcome.error, 'fictional-recipient-required');
  assert.equal((await job(f)).outcome.message, undefined);
});

test('expired offer records useful failure without transport or stock changes', async (t) => {
  let calls = 0;
  const f = await setup(t, { transport: () => ({ async send() { calls += 1; throw new Error(); } }) });
  await seed(f, { offerPatch: { expiresAt: '2026-11-05T09:00:00.000Z' } });
  const before = structuredClone(f.store.state.tables.stock);
  await f.dispatcher.dispatchPending();
  assert.equal((await job(f)).state, 'failed'); assert.equal((await job(f)).outcome.error, 'offer-expired');
  assert.equal(calls, 0); assert.deepEqual(f.store.state.tables.stock, before);
});

test('safe accessible HTML/plain template escapes hostile facts, explains missing facts and contains no em dash', () => {
  const offer = { state: 'active', expiresAt: '2026-11-05T11:00:00.000Z' };
  const message = renderOfferMessage({ offer, employee: { employeeId: 'fictional', name: '<script>alert(1)</script>\u2014 Fictional' },
    quote: { facts: { model: '<img src=x onerror=alert(1)>\u2014Touring' } }, offerLink: link, now: '2026-11-05T09:00:00.000Z' });
  assert.doesNotMatch(message.textBody + message.htmlBody + message.subject, /\u2014/);
  const document = new JSDOM(message.htmlBody).window.document;
  assert.equal(document.documentElement.lang, 'en'); assert.ok(document.querySelector('main h1'));
  assert.equal(document.querySelectorAll('script,iframe,object,img').length, 0);
  assert.equal(document.querySelectorAll('[onclick],[onerror],[onload]').length, 0);
  assert.equal(document.querySelector('a').getAttribute('href'), link);
  assert.match(document.querySelector('a').textContent, /current status/);
  assert.match(message.textBody, /<script>/); // harmless plain text alternative
  const missing = renderOfferMessage({ offer, employee: {}, offerLink: link, now: '2026-11-05T11:00:00.000Z' });
  assert.match(missing.textBody, /expired/); assert.match(missing.htmlBody, /Full vehicle details are not available/);
  for (const offerLink of ['javascript:alert(1)', '//evil.example', '/\\evil', '/offer\n?token=x', 'https://person:secret@example.invalid/offer']) {
    assert.throws(() => renderOfferMessage({ offer, employee: {}, offerLink, now: '2026-11-05T09:00:00.000Z' }), /unavailable/);
  }
});

test('actual emitted diagnostic logs and safe public outcomes contain no offer token or provider error', async (t) => {
  const emitted = [];
  const original = console.warn;
  console.warn = (...args) => emitted.push(args);
  t.after(() => { console.warn = original; });
  const f = await setup(t, { logger: console, transport: () => ({ async send() { throw new Error(`https://private.invalid/?token=${token}`); } }) });
  await f.dispatcher.start();
  const response = await seed(f);
  assert.equal((await job(f)).state, 'retrying'); assert.equal(emitted.length, 1);
  assert.doesNotMatch(JSON.stringify([emitted, response, (await job(f)).outcome]), new RegExp(token));
  assert.deepEqual(emitted[0], [{ event: 'notification-attempt-failed', state: 'retrying', attempt: 1, error: 'transport-unavailable' }]);
});

test('registered tick retries a due committed job after restart without disconnected hook simulation', async (t) => {
  let calls = 0;
  const f = await setup(t, { transport: (repository) => {
    const captured = new CapturedTransport({ repository });
    return { async send(input) { calls += 1; return calls === 1 ? result('unavailable') : captured.send(input); } };
  } });
  await seed(f);
  assert.equal((await f.dispatcher.start()).status, 'ok');
  f.dispatcher.close(); // Tick remains registered; isolate the deliberate tick trigger.
  const retryAt = (await job(f)).outcome.nextAttemptAt;
  const now = (await f.clock.now(f.context)).value.now;
  await move(f, (Date.parse(retryAt) - Date.parse(now)) / 1000);
  assert.equal((await job(f)).state, 'retrying');
  const state = (await f.clock.readState(f.context)).value;
  const tick = await f.clock.tick(f.context, { eventId: 'retry-tick', expectedClockVersion: state.clockVersion, inputDigest: inputDigest('retry-tick') });
  assert.equal(tick.status, 'ok'); assert.equal((await job(f)).state, 'sent'); assert.equal(calls, 2);
  assert.equal((await f.clock.tick(f.context, { eventId: 'retry-tick', expectedClockVersion: state.clockVersion, inputDigest: inputDigest('retry-tick') })).status, 'ok');
  assert.equal(calls, 2);
});
