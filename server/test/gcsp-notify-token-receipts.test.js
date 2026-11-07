import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { verifyOfferToken } from '../gcsp/offers/offer-token.js';
import { NotificationDispatcher } from '../gcsp/notify/index.js';
import { stock, essential, preference } from './helpers/employee-recommendation.js';

const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
async function setup(t) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  t.after(() => repository.close());
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'notify-receipts', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok');
  const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const context = presenter.value.context;
  const logs = []; const responses = [];
  const f = { store, repository, policy, clock, identity, context, logs, responses };
  f.dispatcher = (overrides = {}) => new NotificationDispatcher({ repository, policy, clock, environmentId: context.environmentId,
    logger: { warn: (entry) => logs.push(entry) }, ...overrides });
  return f;
}
const reference = (f, table, key) => ({ table, key: { runId: f.context.runId, ...key } });
const readJob = async (f) => (await f.repository.query(f.context, 'notification_outbox')).value[0];
const rawJob = (f) => f.store.state.tables.notification_outbox[0];
function tokenFree(f, token, link) {
  const outside = Object.fromEntries(Object.entries(f.store.state.tables).filter(([name]) => name !== 'notification_outbox'));
  for (const value of [outside, f.responses, f.logs]) {
    assert.equal(JSON.stringify(value).includes(token), false);
    assert.equal(JSON.stringify(value).includes(link), false);
  }
}
async function dispatch(f, dispatcher = f.dispatcher()) {
  const response = await dispatcher.dispatchPending(); f.responses.push(response);
  assert.equal(response.status, 'ok'); return response;
}

// Small fixtures isolate notification retries and races; the first test uses the real producer.
async function fixture(f, patch = {}) {
  const token = 'synthetic-notify-receipt-secret';
  const link = `/gcsp/offer?offerId=offer-one#token=${token}`;
  const car = (await f.repository.query(f.context, 'stock')).value[0];
  const outcome = await f.repository.transaction(f.context, command('fixture'), async (tx) => {
    for (const [table, row] of [
      ['quotes', { quoteId: 'quote-one', orderUuid: car.orderUuid, employeeId: 'employee-paula', policyVersion: 'gcsp-policy-v1', facts: { model: 'BMW 320i Touring' } }],
      ['holds', { holdId: 'hold-one', orderUuid: car.orderUuid, employeeId: 'employee-paula', entitlementSlotId: 'slot-paula',
        type: 'buddy-offer', state: 'active', quoteId: 'quote-one', expiresAt: '2026-11-05T11:00:00.000Z' }],
      ['offers', { offerId: 'offer-one', holdId: 'hold-one', employeeId: 'employee-paula', orderUuid: car.orderUuid,
        quoteId: 'quote-one', policyVersion: 'gcsp-policy-v1', environmentId: f.context.environmentId, state: 'active', expiresAt: '2026-11-05T11:00:00.000Z' }],
    ]) { const inserted = await tx.insert(table, { runId: f.context.runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    const queued = await tx.enqueueNotification({ runId: f.context.runId, jobId: 'job-one', offerId: 'offer-one', recipientId: 'employee-paula',
      messageKind: 'offer', messageVersion: '1', state: 'pending', attempts: 0, idempotencyKey: 'offer:offer-one:notification:offer:1',
      inputDigest: inputDigest(link), payload: { offerLink: link }, ...patch });
    return queued.status === 'ok' ? ok(null) : queued;
  });
  assert.equal(outcome.status, 'ok'); return { token, link };
}

test('real BuddyHoldService cryptographic token survives captured rendering only inside the outbox', async (t) => {
  const f = await setup(t);
  assert.equal((await f.clock.advance(f.context, { commandId: 'noon', expectedClockVersion: '1', bySeconds: 10800 })).status, 'ok');
  const acting = await f.identity.switchPrincipal(f.context, 'demo-paula', 'paula'); f.context = acting.value.context;
  assert.equal((await seedManualDemoContext(f)).status, 'ok');
  const brief = new BriefService(f);
  assert.equal((await brief.saveDraft(f.context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } })).status, 'ok');
  assert.equal((await brief.confirm(f.context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } })).status, 'ok');
  const car = stock(1);
  assert.equal((await f.repository.transaction(f.context, command('released'), (tx) => tx.insert('stock', {
    runId: f.context.runId, orderUuid: car.orderUuid, orderNumber: '9123456', configurationId: car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: car.snapshot,
    release: { eventId: 'fixture-release', availability: car.availability },
    visibility: { companyIds: [f.context.companyId], schemeIds: [f.context.schemeId], employeeIds: null },
  }))).status, 'ok');
  const employee = (await f.repository.read(f.context, reference(f, 'employees', { employeeId: f.context.employeeId }))).value;
  const slot = (await f.repository.read(f.context, reference(f, 'entitlement_slots', { entitlementSlotId: f.context.entitlementSlotId }))).value;
  const service = new BuddyHoldService({ ...f, adapter: { mode: 'local-synthetic' } });
  const allocation = await service.allocate(f.context, { commandId: 'allocate', orderUuid: car.orderUuid, expectedBriefVersion: 1,
    expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version });
  f.responses.push(allocation); assert.equal(allocation.status, 'ok');
  const original = await readJob(f); const link = original.payload.offerLink;
  const token = new URL(link, 'https://demo.invalid').hash.slice('#token='.length);
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const offer = (await f.repository.query(f.context, 'offers')).value[0];
  assert.equal(verifyOfferToken(token, { environmentId: f.context.environmentId, runId: f.context.runId,
    offerId: offer.offerId }, offer.tokenHash), true);
  await dispatch(f);
  const stored = await readJob(f);
  assert.equal(stored.state, 'sent'); assert.equal(stored.messageVersion, '1');
  assert.equal(stored.outcome.message.offerLink === link, true);
  assert.equal(stored.outcome.message.textBody.includes(link), true);
  tokenFree(f, token, link);
});

test('throwing provider token text stays absent through retries, tick recovery and final failure', async (t) => {
  const f = await setup(t); const { token, link } = await fixture(f);
  let calls = 0;
  const dispatcher = f.dispatcher({ transport: { async send() { calls += 1; throw Error(link); } } });
  t.after(() => dispatcher.close());
  const started = await dispatcher.start(); f.responses.push(started); assert.equal(started.status, 'ok');
  const rules = (await f.policy.getAssumption('notify.delivery.v1', { runId: f.context.runId,
    asOf: (await f.clock.now(f.context)).value.now, policyVersion: f.context.policyVersion })).value.value;
  for (let attempt = 1; attempt <= rules.maxAttempts; attempt += 1) {
    const stored = await readJob(f);
    assert.equal(stored.attempts, attempt);
    assert.equal(stored.state, attempt < rules.maxAttempts ? 'retrying' : 'failed');
    assert.equal(stored.outcome.error, 'transport-unavailable');
    tokenFree(f, token, link);
    if (attempt < rules.maxAttempts) {
      const clock = (await f.clock.readState(f.context)).value;
      const now = (await f.clock.now(f.context)).value.now;
      const moved = await f.clock.advance(f.context, { commandId: `retry-${attempt}`, expectedClockVersion: clock.clockVersion,
        bySeconds: (Date.parse(stored.outcome.nextAttemptAt) - Date.parse(now)) / 1000 });
      f.responses.push(moved); assert.equal(moved.status, 'ok');
      const state = (await f.clock.readState(f.context)).value;
      const tick = await f.clock.tick(f.context, { eventId: `retry-tick-${attempt}`, expectedClockVersion: state.clockVersion,
        inputDigest: inputDigest(attempt) });
      f.responses.push(tick); assert.equal(tick.status, 'ok');
    }
  }
  assert.equal(calls, rules.maxAttempts); await dispatch(f, dispatcher); assert.equal(calls, rules.maxAttempts);
  const final = await readJob(f);
  const replay = await f.repository.transaction(f.context, {
    commandId: `notify:failure:${inputDigest([final.jobId, final.attempts])}`,
    inputDigest: inputDigest([final.jobId, final.attempts, 'transport-unavailable', 'failed']),
  }, () => { throw Error('failure replay must not execute'); });
  f.responses.push(replay); assert.deepEqual(replay.value, { state: 'failed' });
  tokenFree(f, token, link);
});

test('interrupted sending recovery and durable attempt replay keep original safe descriptor', async (t) => {
  const f = await setup(t); const { token, link } = await fixture(f, { state: 'sending', attempts: 1 });
  const before = await readJob(f); await dispatch(f);
  const descriptor = { jobId: before.jobId, version: before.version, attempts: before.attempts, state: 'sending' };
  const replay = await f.repository.transaction(f.context, {
    commandId: `notify:attempt:${inputDigest([before.jobId, before.version])}`, inputDigest: inputDigest([before.jobId, before.version]),
  }, () => { throw Error('durable replay must not execute'); });
  f.responses.push(replay); assert.deepEqual(replay.value, descriptor);
  assert.equal((await readJob(f)).version > replay.value.version, true);
  assert.equal((await readJob(f)).state, 'sent'); tokenFree(f, token, link);
});

for (const phase of ['claim', 'offers', 'employees', 'quotes']) {
  for (const change of ['state', 'version', 'attempts', 'payload']) {
    test(`obsolete ${change} after ${phase} skips transport and bookkeeping`, async (t) => {
      const f = await setup(t); const { token, link } = await fixture(f); let changed = false; let calls = 0;
      const mutate = () => {
        changed = true; const row = rawJob(f);
        if (change === 'state') row.state = 'stale';
        if (change === 'version') row.version += 1;
        if (change === 'attempts') row.attempts += 1;
        if (change === 'payload') { row.payload = { offerLink: '/gcsp/offer#token=replacement' }; if (phase === 'claim') row.version += 1; }
      };
      const repository = { ...f.repository,
        transaction: async (context, cmd, work) => {
          const outcome = await f.repository.transaction(context, cmd, work);
          if (!changed && phase === 'claim' && cmd.commandId.startsWith('notify:attempt:')) mutate();
          return outcome;
        },
        read: async (context, ref) => {
          const outcome = await f.repository.read(context, ref);
          if (!changed && ref.table === phase) mutate();
          return outcome;
        },
      };
      await dispatch(f, f.dispatcher({ repository, transport: { async send() { calls += 1; return ok(null); } } }));
      assert.equal(changed, true); assert.equal(calls, 0);
      assert.equal(rawJob(f).state === 'retrying' || rawJob(f).state === 'failed', false);
      tokenFree(f, token, link);
    });
  }
}

for (const delivery of ['success', 'failure']) {
  for (const change of ['state', 'version', 'attempts', 'payload']) {
    test(`obsolete ${change} during ${delivery} transport preserves newer bookkeeping`, async (t) => {
      const f = await setup(t); const { token, link } = await fixture(f); let calls = 0;
      const dispatcher = f.dispatcher({ transport: { async send() {
        calls += 1;
        const row = rawJob(f);
        if (change === 'state') row.state = 'stale';
        if (change === 'version') row.version += 1;
        if (change === 'attempts') row.attempts += 1;
        if (change === 'payload') row.payload = { offerLink: '/gcsp/offer#token=replacement' };
        if (delivery === 'failure') throw Error(link);
        return ok(null);
      } } });
      const response = await dispatch(f, dispatcher);
      assert.equal(calls, 1);
      assert.equal(rawJob(f).state, change === 'state' ? 'stale' : 'sending');
      assert.equal(rawJob(f).attempts, change === 'attempts' ? 2 : 1);
      assert.equal(rawJob(f).outcome.acknowledgedAt === undefined, true);
      assert.equal(rawJob(f).outcome.nextAttemptAt, null);
      assert.deepEqual(response.value, { sent: 0, retrying: 0, failed: 0 });
      assert.equal(f.logs.length, 0);
      tokenFree(f, token, link);
    });
  }
}

test('replayed attempt descriptor rejects newer current job rather than substituting its payload', async (t) => {
  const f = await setup(t); const { token, link } = await fixture(f); const original = await readJob(f); let calls = 0;
  const commandSpec = { commandId: `notify:attempt:${inputDigest([original.jobId, original.version])}`,
    inputDigest: inputDigest([original.jobId, original.version]) };
  const claimed = await f.repository.transaction(f.context, commandSpec, async (tx) => {
    const changed = await tx.compareAndSwap(reference(f, 'notification_outbox', { jobId: original.jobId }), original.version,
      { state: 'sending', attempts: 1 });
    return ok({ jobId: changed.value.jobId, version: changed.value.version, attempts: 1, state: 'sending' });
  });
  rawJob(f).version += 1; rawJob(f).payload = { offerLink: '/gcsp/offer#token=replacement' };
  const repository = { ...f.repository, query: async (context, table) => table === 'notification_outbox'
    ? ok([original]) : f.repository.query(context, table) };
  await dispatch(f, f.dispatcher({ repository, transport: { async send() { calls += 1; return ok(null); } } }));
  const replay = await f.repository.transaction(f.context, commandSpec, () => { throw Error('unexpected work'); });
  f.responses.push(replay); assert.deepEqual(replay.value, claimed.value);
  assert.equal(replay.value.version < rawJob(f).version, true); assert.equal(calls, 0);
  tokenFree(f, token, link);
});
