import test from 'node:test';
import assert from 'node:assert/strict';
import { inputDigest, ok } from '../gcsp/repository/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';

const release = (f, id = 'released-tranche') => ({ consumerId: 'stock-release', eventId: id,
  eventType: 'stock-released', inputDigest: inputDigest(id), inputVersions: { policy: f.context.policyVersion, clock: 'clock-v1', source: 'fixture-v1' },
  state: 'completed', outcome: ok({ kind: 'stock-released', runId: f.context.runId, trancheId: id,
    windowId: 'window-1', supplyId: null, tickId: 'release-tick', releasedAt: '2026-11-05T12:00:00.000Z',
    orderUuids: [f.stock().orderUuid], visibleOrderUuids: [f.stock().orderUuid], policyVersion: f.context.policyVersion,
    source: { providerId: 'allocation-trigger-test', mode: 'synthetic', version: 'fixture-v1', label: 'TEST' } }) });
const put = (f, row) => f.write((tx) => tx.recordReceipt(row));

test('persisted release triggers preserve producer evidence and replay without another claim', async () => {
  const f = await allocationFixture({ cars: 1 }); const source = release(f); await put(f, source);
  const out = await f.service.consumeTriggers(f.context);
  assert.equal(out.status, 'ok', JSON.stringify(out)); assert.equal(out.value.allocations.length, 1);
  const allocated = out.value.allocations[0];
  assert.equal(allocated.state, 'allocated'); assert.equal(allocated.assignments.length, 1);
  assert.equal(allocated.event.sourceEventId, 'released-tranche');
  assert.equal(allocated.event.trancheId, 'released-tranche');
  assert.deepEqual(allocated.event.sourceReceipt.inputVersions, source.inputVersions);
  assert.equal(allocated.event.sourceReceipt.inputDigest, source.inputDigest);
  assert.notEqual(allocated.event.eventId, source.eventId, 'consumer namespaces the producer replay key');
  const calls = f.calls.length;
  assert.deepEqual(await f.create().consumeTriggers(f.context), out); assert.equal(f.calls.length, calls);
});

test('actual BriefService pause receipt triggers current cohort evaluation', async () => {
  const f = await allocationFixture({ cars: 1 });
  const briefs = new BriefService({ repository: f.repository, policy: f.policy, clock: f.clock, identity: f.identity });
  const paused = await briefs.pause(f.employees[0], { commandId: 'pause', expectedBriefVersion: 1 });
  assert.equal(paused.status, 'ok', JSON.stringify(paused));
  const out = await f.service.consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.allocations.length, 1);
  assert.equal(out.value.allocations[0].event.operation, 'paused');
  assert.equal(out.value.allocations[0].event.sourceEventId, paused.value.event.eventId);
  assert.equal(out.value.allocations[0].assignments[0].employeeId, f.employees[1].employeeId);
});

test('unrelated pending and failed receipts create no allocation; malformed completed producers refuse', async () => {
  const f = await allocationFixture({ cars: 1 });
  await put(f, { ...release(f, 'pending'), state: 'pending' });
  await put(f, { ...release(f, 'failed'), outcome: { status: 'unavailable' } });
  await put(f, { ...release(f, 'unrelated'), consumerId: 'other-consumer' });
  const out = await f.service.consumeTriggers(f.context);
  assert.equal(out.status, 'ok', JSON.stringify(out)); assert.deepEqual(out.value.allocations, []);
  assert.equal(f.calls.length, 0);
  const malformed = release(f, 'malformed'); malformed.outcome.value.trancheId = 'different'; await put(f, malformed);
  assert.equal((await f.service.consumeTriggers(f.context)).code, 'allocation-trigger-invalid');
  assert.equal(f.calls.length, 0);
});

test('uncertain claim retries the persisted producer event and quote before later triggers', async () => {
  let unavailable = true;
  const f = await allocationFixture({ cars: 1, claimResult: (_, input) => unavailable
    ? { status: 'unavailable' } : ok({ claimId: input.operationId }) });
  await put(f, release(f));
  assert.equal((await f.service.consumeTriggers(f.context)).code, 'claim-pending'); unavailable = false;
  const out = await f.create().consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.allocations[0].assignments.length, 1);
  assert.equal(f.calls[0].input.operationId, f.calls[1].input.operationId);
  assert.deepEqual(f.calls[0].input.quote, f.calls[1].input.quote);
});

test('registered allocation consumer enforces actual identity at its handler boundary', async () => {
  const f = await allocationFixture({ cars: 1 }); await put(f, release(f)); let descriptor;
  const service = f.create({ clock: { ...f.clock, async registerHandler(value) { descriptor = value; return ok({ registered: true }); } } });
  assert.equal((await service.register()).status, 'ok'); assert.equal(descriptor.stage, 'buddy-allocation');
  assert.equal((await descriptor.handle({ context: { ...f.context } })).status, 'forbidden');
  assert.equal(f.calls.length, 0);
  const out = await descriptor.handle({ context: f.context }); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.allocations[0].assignments.length, 1);
});

test('equal producer event IDs remain distinct and order is independent of receipt insertion', async () => {
  const outcomes = [];
  for (const reverse of [false, true]) {
    const f = await allocationFixture({ cars: 1 }); const id = 'same-producer-event';
    const stock = release(f, id);
    const brief = { consumerId: 'brief:changes', eventId: id, eventType: 'brief-changed',
      inputDigest: inputDigest('brief-event'), inputVersions: { brief: 1, policy: f.context.policyVersion }, state: 'completed',
      outcome: ok({ eventId: id, eventType: 'brief-changed', runId: f.context.runId, employeeId: f.employees[0].employeeId,
        briefVersion: 1, previousBriefVersion: null, operation: 'confirmed', occurredAt: '2026-11-05T12:00:00.000Z' }) };
    for (const row of reverse ? [stock, brief] : [brief, stock]) await put(f, row);
    const out = await f.service.consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
    assert.equal(out.value.allocations.length, 2);
    assert.equal(new Set(out.value.allocations.map((a) => a.event.eventId)).size, 2);
    assert.deepEqual(out.value.allocations.map((a) => a.event.sourceReceipt.consumerId), ['brief:changes', 'stock-release']);
    outcomes.push(out);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('changing a completed producer payload conflicts without another claim', async () => {
  const f = await allocationFixture({ cars: 1 }); await put(f, release(f));
  assert.equal((await f.service.consumeTriggers(f.context)).status, 'ok'); const calls = f.calls.length;
  const ref = { table: 'event_receipts', key: { runId: f.context.runId, consumerId: 'stock-release', eventId: 'released-tranche' } };
  const row = (await f.repository.read(f.context, ref)).value;
  await f.write((tx) => tx.compareAndSwap(ref, row.version, { outcome: ok({ ...row.outcome.value, source: {
    ...row.outcome.value.source, version: 'changed-source' } }) }));
  assert.equal((await f.service.consumeTriggers(f.context)).status, 'conflict'); assert.equal(f.calls.length, calls);
});
