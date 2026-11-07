import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest, ok, result } from '../gcsp/repository/core.js';

const command = (id) => ({ commandId: id, inputDigest: inputDigest(id) });
const context = (id = 'a') => ({ environmentId: `environment-${id}`, runId: `run-${id}`, principalId: 'server', roles: [] });
async function setup(t) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok'); t.after(() => repository.close());
  for (const id of ['a', 'b']) {
    const c = context(id);
    assert.equal((await repository.transaction(c, command('seed'), (tx) => tx.insert('runs', {
      runId: c.runId, environmentId: c.environmentId, status: 'active',
    }))).status, 'ok');
  }
  const token = randomBytes(32).toString('base64url');
  return { store, repository, token, input: { runId: 'run-a', jobId: 'job', idempotencyKey: 'offer:job:notification:offer:1',
    inputDigest: inputDigest('offer-job'), messageKind: 'offer', messageVersion: '1', state: 'pending', attempts: 0,
    payload: { offerLink: `/gcsp/offer#token=${token}`, retained: 'original-payload' } } };
}
async function insert(f, id, input = f.input, c = context()) {
  let response;
  const outcome = await f.repository.transaction(c, command(id), async (tx) => {
    response = await tx.insert('notification_outbox', input);
    return response.status === 'ok' ? ok({ jobId: response.value.jobId }) : response;
  });
  return { outcome, response };
}
const receipt = (f) => f.store.state.tables.event_receipts.find((row) => row.consumerId === 'repository:insert:notification_outbox' && row.runId === 'run-a');
const noReceiptLeak = (f) => assert.equal(JSON.stringify(f.store.state.tables.event_receipts).includes(f.token), false);

test('outbox insert receipt omits only the link and reconstructs the original insert result on replay', async (t) => {
  const f = await setup(t); const first = await insert(f, 'first');
  assert.equal(first.outcome.status, 'ok');
  assert.equal(JSON.stringify(first.response).includes(f.token), true);
  assert.equal(receipt(f).inputVersions.offerLinkFromInsertInput, 1);
  assert.equal(Object.hasOwn(receipt(f).outcome.value.payload, 'offerLink'), false);
  assert.equal(receipt(f).outcome.value.payload.retained, 'original-payload');
  const replay = await insert(f, 'replay'); assert.equal(replay.outcome.status, 'ok');
  assert.equal(inputDigest(replay.response) === inputDigest(first.response), true);
  noReceiptLeak(f);
});

test('outbox replay keeps original timestamps, version, state and link after mutable job changes', async (t) => {
  const f = await setup(t); const first = await insert(f, 'first');
  const changed = await f.repository.transaction(context(), command('change'), async (tx) => {
    const outcome = await tx.compareAndSwap({ table: 'notification_outbox', key: { runId: 'run-a', jobId: 'job' } }, 1,
      { state: 'sent', attempts: 5, payload: { offerLink: '/different-current-link', retained: 'current-payload' } });
    return outcome.status === 'ok' ? ok({ changed: true }) : outcome;
  });
  assert.equal(changed.status, 'ok');
  const replay = await insert(f, 'replay'); assert.equal(replay.outcome.status, 'ok');
  assert.equal(inputDigest(replay.response) === inputDigest(first.response), true);
  assert.equal(replay.response.value.state, 'pending'); assert.equal(replay.response.value.version, 1);
  assert.equal(replay.response.value.createdAt === first.response.value.createdAt, true);
  assert.equal(replay.response.value.updatedAt === first.response.value.updatedAt, true);
  noReceiptLeak(f);
});

test('changed original input conflicts, including a changed sensitive link', async (t) => {
  const f = await setup(t); await insert(f, 'first');
  for (const input of [{ ...f.input, state: 'failed' }, { ...f.input, payload: { ...f.input.payload, offerLink: '/changed' } }]) {
    const response = await insert(f, `changed-${input.state}`, input);
    assert.equal(response.outcome.status, 'conflict'); assert.equal(response.outcome.reason, 'idempotency-input-changed');
  }
  noReceiptLeak(f);
});

test('receipt reconstruction remains isolated by complete job key and run', async (t) => {
  const f = await setup(t); await insert(f, 'first');
  const otherJob = await insert(f, 'other-job', { ...f.input, jobId: 'other', idempotencyKey: 'other-key', payload: { offerLink: '/other-job' } });
  const otherRun = await insert(f, 'other-run', { ...f.input, runId: 'run-b', payload: { offerLink: '/other-run' } }, context('b'));
  assert.equal(otherJob.outcome.status, 'ok'); assert.equal(otherRun.outcome.status, 'ok');
  assert.equal(JSON.stringify(otherJob.response).includes(f.token), false);
  assert.equal(JSON.stringify(otherRun.response).includes(f.token), false);
  const replay = await insert(f, 'replay'); assert.equal(replay.response.value.payload.offerLink === f.input.payload.offerLink, true);
  noReceiptLeak(f);
});

test('rollback removes the outbox and insert receipt, while token-free enclosing enqueue receipts stay safe', async (t) => {
  const f = await setup(t);
  const failed = await f.repository.transaction(context(), command('rollback'), async (tx) => {
    assert.equal((await tx.enqueueNotification(f.input)).status, 'ok');
    return result('conflict', { reason: 'injected-late-failure' });
  });
  assert.equal(failed.status, 'conflict'); assert.equal(f.store.state.tables.notification_outbox.length, 0);
  assert.equal(receipt(f), undefined);
  const success = await f.repository.transaction(context(), command('safe-producer'), async (tx) => {
    const queued = await tx.enqueueNotification(f.input);
    return queued.status === 'ok' ? ok({ jobId: queued.value.jobId, state: queued.value.state }) : queued;
  });
  assert.equal(success.status, 'ok'); assert.equal(JSON.stringify(success).includes(f.token), false); noReceiptLeak(f);
});

test('generic insert receipts and outbox payloads without links preserve their original outcome', async (t) => {
  const f = await setup(t); const input = { ...f.input, payload: { caseUpdate: { caseId: 'case-one' } } };
  const first = await insert(f, 'no-link-first', input); const replay = await insert(f, 'no-link-replay', input);
  assert.equal(JSON.stringify(first.response) === JSON.stringify(replay.response), true);
  assert.equal(Object.hasOwn(receipt(f), 'inputVersions'), false);
  let initial;
  await f.repository.transaction(context(), command('generic'), async (tx) => {
    initial = await tx.insert('employees', { runId: 'run-a', employeeId: 'employee', name: 'Original' }); return ok(null);
  });
  const generic = f.store.state.tables.event_receipts.find((row) => row.consumerId === 'repository:insert:employees');
  assert.equal(JSON.stringify(generic.outcome) === JSON.stringify(initial), true);
  assert.equal(Object.hasOwn(generic, 'inputVersions'), false);
});
