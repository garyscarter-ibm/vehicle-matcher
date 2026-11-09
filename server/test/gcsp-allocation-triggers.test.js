import test from 'node:test';
import assert from 'node:assert/strict';
import { inputDigest, ok } from '../gcsp/repository/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { buddyDeclineEvents, buddyExpiryEvents } from '../gcsp/allocation/index.js';
import { DECISION_EVENTS } from '../gcsp/offers/decision.js';
import { allocationFixture } from './helpers/gcsp-allocation.js';

const release = (f, id = 'released-tranche') => ({ consumerId: 'stock-release', eventId: id,
  eventType: 'stock-released', inputDigest: inputDigest(id), inputVersions: { policy: f.context.policyVersion, clock: 'clock-v1', source: 'fixture-v1' },
  state: 'completed', outcome: ok({ kind: 'stock-released', runId: f.context.runId, trancheId: id,
    windowId: 'window-1', supplyId: null, tickId: 'release-tick', releasedAt: '2026-11-05T12:00:00.000Z',
    orderUuids: [f.stock().orderUuid], visibleOrderUuids: [f.stock().orderUuid], policyVersion: f.context.policyVersion,
    source: { providerId: 'allocation-trigger-test', mode: 'synthetic', version: 'fixture-v1', label: 'TEST' } }) });
const put = (f, row) => f.write((tx) => tx.recordReceipt(row));
const lapse = (holdId, orderUuid = `order-${holdId}`, expiredAt = '2026-11-05T12:00:00.000Z') => ({ consumerId: 'buddy-expiry', eventId: holdId,
  eventType: 'buddy-expired', inputDigest: inputDigest(holdId), inputVersions: { holds: 1 }, state: 'completed',
  outcome: ok({ holdId, offerId: `offer-${holdId}`, orderUuid, state: 'expired', expiredAt, expiresAt: expiredAt, proposedCapability: true }) });

// FUCQ-233: the completed receipt decision.js writes for a decline; the decline trigger reads its event.
const decline = (f, holdId, orderUuid, employeeId, at = '2026-11-05T12:00:00.000Z') => {
  const eventId = `offer-decision-event:${holdId}`; const exclusion = { key: 'offer.declinedCar.exclusion', value: 'untilRelevantConfirmedBriefChange', policyVersion: f.context.policyVersion };
  const event = { schemaVersion: 1, eventId, type: 'offer-declined', runId: f.context.runId, offerId: `offer-${holdId}`, holdId, quoteId: `quote-${holdId}`,
    decisionId: `offer-decision:${holdId}`, commandId: `decline-${holdId}`, employeeId, entitlementSlotId: f.employees.find((e) => e.employeeId === employeeId).entitlementSlotId,
    renewalId: null, orderUuid, occurredAt: at, policyVersion: f.context.policyVersion, briefVersion: 1, reasonCode: 'body-style', exclusion };
  const versions = { brief: 1, pinnedBrief: 1, policy: f.context.policyVersion, quotePolicy: f.context.policyVersion, employee: 1, slot: 1,
    stock: 1, quote: 1, hold: 1, offer: 1, clock: 'clock-v1', exclusion };
  return { consumerId: DECISION_EVENTS, eventId, eventType: 'offer-declined', inputDigest: inputDigest(event), inputVersions: versions,
    state: 'completed', outcome: ok({ event }) };
};
// A declined hold: released by the decline, with the offer and decision rows that record it.
const declinedHold = async (f, holdId, orderUuid, holder) => {
  const key = { runId: f.context.runId, holdId }; const offerId = `offer-${holdId}`;
  await f.write((tx) => tx.insert('holds', { ...key, orderUuid, employeeId: holder.employeeId, entitlementSlotId: holder.entitlementSlotId, state: 'active' }));
  await f.write(async (tx) => { const row = await tx.get({ table: 'holds', key }); return tx.compareAndSwap({ table: 'holds', key }, row.value.version,
    { state: 'released', releaseReason: 'offer-declined' }); });
  const briefs = await f.repository.query(f.context, 'briefs'); assert.equal(briefs.status, 'ok', JSON.stringify(briefs));
  const { briefVersion } = briefs.value.find((b) => b.employeeId === holder.employeeId && b.status === 'confirmed');
  await f.write((tx) => tx.insert('offers', { runId: f.context.runId, offerId, holdId, orderUuid, employeeId: holder.employeeId, state: 'rejected' }));
  await f.write((tx) => tx.insert('decisions', { runId: f.context.runId, decisionId: `offer-decision:${holdId}`, commandId: `decline-${holdId}`, offerId, holdId,
    employeeId: holder.employeeId, decision: 'decline', reason: { code: 'body-style' }, actorId: `offer:${offerId}`, versions: { brief: briefVersion } }));
};

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

test('buddy expiry receipts group by lapse instant, sort holds and ignore other producers', () => {
  const at = '2026-11-05T12:00:00.000Z'; const later = '2026-11-05T12:05:00.000Z';
  const receipts = [lapse('hold-b', 'order-b', at), lapse('hold-a', 'order-a', at), lapse('hold-c', 'order-c', later),
    { ...lapse('hold-p', 'order-p', at), state: 'pending' }, { ...lapse('hold-f', 'order-f', at), outcome: { status: 'unavailable' } },
    { ...lapse('hold-o', 'order-o', at), consumerId: 'other-consumer' }];
  const events = buddyExpiryEvents('allocation-run', receipts);
  assert.deepEqual(events.map((e) => [e.occurredAt, e.holdIds]), [[at, ['hold-a', 'hold-b']], [later, ['hold-c']]]);
  assert.deepEqual([events[0].eventType, events[0].orderUuids], ['buddy-expired', ['order-a', 'order-b']]);
  const again = buddyExpiryEvents('allocation-run', receipts);
  assert.equal(again[0].eventId, events[0].eventId); assert.deepEqual(again, events);
});

test('a completed buddy-expiry receipt whose hold differs from its event ID is malformed', () => {
  const wrong = lapse('hold-m'); wrong.outcome.value.holdId = 'hold-n';
  assert.equal(buddyExpiryEvents('allocation-run', [wrong]), null);
});

test('a lapsed hold hands its car to another eligible employee, once', async () => {
  const f = await allocationFixture({ cars: 1 });
  const [holder, other] = f.employees; const orderUuid = f.stock().orderUuid; const key = { runId: f.context.runId, holdId: 'hold-x' };
  await f.write((tx) => tx.insert('holds', { ...key, orderUuid, employeeId: holder.employeeId, entitlementSlotId: holder.entitlementSlotId, state: 'active' }));
  await f.write(async (tx) => { const row = await tx.get({ table: 'holds', key }); return tx.compareAndSwap({ table: 'holds', key }, row.value.version,
    { state: 'expired', releaseReason: 'buddy-expired' }); });
  await put(f, lapse('hold-x', orderUuid));
  const out = await f.service.consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.allocations[0].event.eventType, 'buddy-expired');
  assert.deepEqual(out.value.allocations[0].assignments.map((a) => a.employeeId), [other.employeeId]);
  const calls = f.calls.length;
  assert.deepEqual(await f.create().consumeTriggers(f.context), out); assert.equal(f.calls.length, calls);
});

test('a malformed completed buddy-expiry receipt refuses the trigger batch without a claim', async () => {
  const f = await allocationFixture({ cars: 1 });
  const malformed = lapse('hold-bad', f.stock().orderUuid); malformed.outcome.value.orderUuid = '';
  await put(f, malformed);
  const out = await f.service.consumeTriggers(f.context);
  assert.deepEqual([out.status, out.code], ['unavailable', 'allocation-trigger-invalid']); assert.equal(f.calls.length, 0);
});

test('each completed buddy decline makes one event, ignores other receipts, and repeats with the same IDs', async () => {
  const f = await allocationFixture({ cars: 1 }); const [holder, other] = f.employees; const orderUuid = f.stock().orderUuid;
  const declined = decline(f, 'hold-a', orderUuid, holder.employeeId); const second = decline(f, 'hold-b', 'order-b', other.employeeId);
  const pending = { ...decline(f, 'hold-p', 'order-p', holder.employeeId), state: 'pending' };
  const failed = { ...decline(f, 'hold-f', 'order-f', holder.employeeId), outcome: { status: 'unavailable' } };
  const otherConsumer = { ...decline(f, 'hold-o', 'order-o', holder.employeeId), consumerId: 'other-consumer' };
  const accepted = decline(f, 'hold-y', 'order-y', holder.employeeId); accepted.eventType = 'offer-accepted'; accepted.outcome.value.event.type = 'offer-accepted';
  const receipts = [declined, pending, second, failed, otherConsumer, accepted];
  const events = buddyDeclineEvents(f.context.runId, receipts);
  assert.deepEqual(events.map((e) => [e.eventType, e.holdIds, e.orderUuids, e.sourceEventId]),
    [['buddy-declined', ['hold-a'], [orderUuid], declined.eventId], ['buddy-declined', ['hold-b'], ['order-b'], second.eventId]]);
  assert.equal(new Set(events.map((e) => e.eventId)).size, 2);
  assert.deepEqual(buddyDeclineEvents(f.context.runId, receipts), events);
});

test('a completed decline whose event disagrees with its receipt or run is malformed', async () => {
  const f = await allocationFixture({ cars: 1 }); const orderUuid = f.stock().orderUuid; const holder = f.employees[0].employeeId;
  const wrongEvent = decline(f, 'hold-m', orderUuid, holder); wrongEvent.outcome.value.event.eventId = 'offer-decision-event:hold-n';
  assert.equal(buddyDeclineEvents(f.context.runId, [wrongEvent]), null);
  const wrongRun = decline(f, 'hold-r', orderUuid, holder); wrongRun.outcome.value.event.runId = 'another-run';
  assert.equal(buddyDeclineEvents(f.context.runId, [wrongRun]), null);
});

test('a declined hold hands its car to another eligible employee, once', async () => {
  const f = await allocationFixture({ cars: 1 }); const [decliner, other] = f.employees; const orderUuid = f.stock().orderUuid;
  await declinedHold(f, 'hold-d', orderUuid, decliner); await put(f, decline(f, 'hold-d', orderUuid, decliner.employeeId));
  const out = await f.service.consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.equal(out.value.allocations[0].event.eventType, 'buddy-declined');
  assert.deepEqual(out.value.allocations[0].assignments.map((a) => a.employeeId), [other.employeeId]);
  const calls = f.calls.length;
  assert.deepEqual(await f.create().consumeTriggers(f.context), out); assert.equal(f.calls.length, calls);
});

test('the decliner is not re-offered the declined car', async () => {
  const f = await allocationFixture({ cars: 3 }); const [decliner, ...others] = f.employees; const orderUuid = f.stock().orderUuid;
  // Every other employee holds a different car, so the declined car's only possible taker is the decliner.
  for (const [i, other] of others.entries()) await f.write((tx) => tx.insert('holds', { runId: f.context.runId, holdId: `hold-other-${i}`,
    orderUuid: f.stock(i + 2).orderUuid, employeeId: other.employeeId, entitlementSlotId: other.entitlementSlotId, state: 'active' }));
  await declinedHold(f, 'hold-d', orderUuid, decliner); await put(f, decline(f, 'hold-d', orderUuid, decliner.employeeId));
  const declinedOut = await f.service.consumeTriggers(f.context); assert.equal(declinedOut.status, 'ok', JSON.stringify(declinedOut));
  assert.deepEqual(declinedOut.value.allocations.map((a) => [a.event.eventType, a.state, a.assignments]), [['buddy-declined', 'no-assignment', []]]);
  await put(f, release(f));
  const out = await f.service.consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual(out.value.allocations.map((a) => a.event.eventType).sort(), ['buddy-declined', 'stock-released']);
  assert.deepEqual(out.value.allocations.flatMap((a) => a.assignments), []); assert.equal(f.calls.length, 0);
});

test('a malformed completed decline receipt refuses the trigger batch without a claim', async () => {
  const f = await allocationFixture({ cars: 1 });
  const malformed = decline(f, 'hold-bad', f.stock().orderUuid, f.employees[0].employeeId); malformed.outcome.value.event.orderUuid = '';
  await put(f, malformed);
  const out = await f.service.consumeTriggers(f.context);
  assert.deepEqual([out.status, out.code], ['unavailable', 'allocation-trigger-invalid']); assert.equal(f.calls.length, 0);
});

test('a decliner with a changed brief still sits out the allocation their decline triggers', async () => {
  const f = await allocationFixture({ cars: 3 }); const [decliner, ...others] = f.employees; const orderUuid = f.stock().orderUuid;
  for (const [i, other] of others.entries()) await f.write((tx) => tx.insert('holds', { runId: f.context.runId, holdId: `hold-other-${i}`,
    orderUuid: f.stock(i + 2).orderUuid, employeeId: other.employeeId, entitlementSlotId: other.entitlementSlotId, state: 'active' }));
  await declinedHold(f, 'hold-d', orderUuid, decliner); await put(f, decline(f, 'hold-d', orderUuid, decliner.employeeId));
  // A relevant confirmed change lifts the declined-car exclusion, so only the sit-out rule keeps the decliner out.
  const briefs = await f.repository.query(f.context, 'briefs');
  const current = briefs.value.filter((b) => b.employeeId === decliner.employeeId && b.status === 'confirmed').sort((a, b) => b.briefVersion - a.briefVersion)[0];
  const [path, pref] = Object.entries(current.preferences)[0];
  await f.write((tx) => tx.insert('briefs', { ...structuredClone(current), briefVersion: current.briefVersion + 1,
    preferences: { ...current.preferences, [path]: { ...pref, importance: pref.importance === 1 ? 2 : 1 } } }));
  const out = await f.service.consumeTriggers(f.context); assert.equal(out.status, 'ok', JSON.stringify(out));
  assert.deepEqual(out.value.allocations.map((a) => [a.event.eventType, a.assignments]), [['buddy-declined', []]]); assert.equal(f.calls.length, 0);
});
