import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore, inputDigest, ok, result } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createBriefService } from '../gcsp/brief/index.js';
import { preference, essential, stock, providerValue } from './helpers/employee-recommendation.js';

const implementation = await import('../gcsp/brief/activity.js').catch(() => ({}));
test('activity exposes the read-only employee projection', () => assert.equal(typeof implementation.createActivityService, 'function'));
const activity = (name, work) => test(name, { skip: !implementation.createActivityService }, work);
const command = (commandId) => ({ commandId, inputDigest: inputDigest({ commandId }) });
const draft = () => ({ schemaVersion: 1, preferences: { body: preference('estate') },
  essentials: { seats: essential(5) } });
async function setup() {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store }); await repository.open();
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'activity-test', environmentKind: 'synthetic',
    policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap', sessionNow: () => '2026-11-05T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { clock, identity } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const context = (await identity.switchPrincipal(presenter, 'demo-paula', 'paula')).value.context;
  const brief = createBriefService({ repository, policy, clock, identity });
  const service = implementation.createActivityService({ repository, clock, identity });
  return { store, repository, policy, clock, identity, presenter, context, brief, service };
}
async function confirm(f, consent = { search: true, hold: true }, version = 0) {
  const saved = await f.brief.saveDraft(f.context, { commandId: `draft-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: version ? 1 : 0, brief: draft() });
  assert.equal(saved.status, 'ok', JSON.stringify(saved));
  const confirmed = await f.brief.confirm(f.context, { commandId: `confirm-${version}`, expectedBriefVersion: version,
    expectedDraftVersion: saved.value.draftVersion, consent });
  assert.equal(confirmed.status, 'ok', JSON.stringify(confirmed));
  return confirmed.value.brief;
}
async function offerFixture(f, state = 'active', extra = {}) {
  // Synthetic stored-row inputs exercise projection, never a successful allocation/search.
  const order = (await f.repository.query(f.context, 'stock')).value[0];
  const inserted = await f.repository.transaction(f.context, command('offer-fixture'), async (tx) => {
    await tx.insert('quotes', { runId: f.context.runId, quoteId: 'quote', employeeId: f.context.employeeId, orderUuid: order.orderUuid });
    await tx.insert('holds', { runId: f.context.runId, holdId: 'hold', orderUuid: order.orderUuid, employeeId: f.context.employeeId,
      entitlementSlotId: f.context.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'quote' });
    return tx.insert('offers', { runId: f.context.runId, offerId: 'offer', holdId: 'hold', quoteId: 'quote',
      employeeId: f.context.employeeId, orderUuid: order.orderUuid, state, briefVersion: 1, policyVersion: f.context.policyVersion,
      expiresAt: '2026-11-05T08:00:00.000Z', tokenHash: 'private-token-hash', tokenMetadata: { secret: 'private-token-metadata' },
      operationId: 'private-operation', ...extra });
  });
  assert.equal(inserted.status, 'ok', JSON.stringify(inserted));
  return inserted.value;
}
const read = async (f) => {
  const outcome = await f.service.readActivity(f.context);
  assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value;
};

activity('no brief is explicit and storage timestamps do not invent search evidence', async () => {
  const f = await setup(); const value = await read(f);
  assert.equal(value.state, 'no-brief'); assert.equal(value.briefVersion, null); assert.equal(value.permission, null);
  assert.equal(value.lastSuccessfulCheck, null); assert.equal(value.searchEvidence.status, 'not-recorded');
  assert.equal(value.sourceStatus, 'not-checked'); assert.equal(value.currentOffer, null);
  assert.deepEqual(value.offers, []); assert.deepEqual(value.stateChanges, []);
  await f.brief.saveDraft(f.context, { commandId: 'draft-only', expectedBriefVersion: 0, expectedDraftVersion: 0, brief: draft() });
  assert.equal((await read(f)).state, 'no-brief');
});

activity('the latest confirmation supplies independent permission and only real completed changes', async () => {
  const f = await setup(); await confirm(f, { search: true, hold: false });
  let value = await read(f);
  assert.equal(value.state, 'never-searched'); assert.equal(value.briefVersion, 1);
  assert.deepEqual(value.permission, { searchConsent: true, holdConsent: false, paused: false,
    permissionVersion: 1, canSearch: true, canHold: false });
  const latest = await confirm(f, { search: false, hold: true }, 1); value = await read(f);
  assert.equal(value.briefVersion, 2); assert.equal(value.permission.searchConsent, false);
  assert.equal(value.permission.holdConsent, true); assert.equal(value.permission.canHold, false);
  assert.deepEqual(value.stateChanges.map(({ operation, briefVersion }) => ({ operation, briefVersion })),
    [{ operation: 'confirmed', briefVersion: 1 }, { operation: 'confirmed', briefVersion: 2 }]);
  assert.equal(value.stateChanges[1].occurredAt, latest.confirmedAt);
  assert.equal(value.lastSuccessfulCheck, null);
});

activity('persisted pause and resume change permission while leaving actual offers unchanged', async () => {
  const f = await setup(); await confirm(f); await offerFixture(f);
  const before = (await f.repository.query(f.context, 'offers')).value;
  assert.equal((await f.brief.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 })).status, 'ok');
  let value = await read(f); assert.equal(value.state, 'paused'); assert.equal(value.briefVersion, 2);
  assert.equal(value.permission.canSearch, false); assert.equal(value.permission.canHold, false);
  assert.equal(value.offers[0].state, 'active'); assert.equal(value.offers[0].briefVersion, 1);
  await f.repository.close(); await f.repository.open();
  assert.equal((await read(f)).state, 'paused');
  assert.equal((await f.brief.resume(f.context, { commandId: 'resume', expectedBriefVersion: 2 })).status, 'ok');
  value = await read(f); assert.equal(value.state, 'offer'); assert.equal(value.permission.canHold, true);
  assert.deepEqual(value.stateChanges.map((e) => e.operation), ['confirmed', 'paused', 'resumed']);
  assert.deepEqual((await f.repository.query(f.context, 'offers')).value, before);
});

activity('trusted employee context is required and cannot be copied or redirected', async () => {
  const f = await setup(); await confirm(f);
  for (const context of [undefined, {}, { ...f.context }, { ...f.context, employeeId: 'other' },
    { ...f.context, roles: ['employee'] }, { ...f.context, runId: 'old-run' }, f.presenter]) {
    assert.equal((await f.service.readActivity(context)).status, 'forbidden');
  }
  const principals = (await f.policy.getAssumption('identity.demo.principals', { runId: f.context.runId,
    asOf: (await f.clock.now(f.context)).value.now })).value.value;
  const other = principals.find((p) => p.roles.includes('employee') && p.employeeId !== f.context.employeeId);
  const otherContext = (await f.identity.switchPrincipal(f.presenter, other.principalId, 'other')).value.context;
  const value = (await f.service.readActivity(otherContext)).value;
  assert.equal(value.briefVersion, null); assert.deepEqual(value.stateChanges, []); assert.deepEqual(value.offers, []);
});

activity('previous-run contexts refuse after the real clock resets', async () => {
  const f = await setup(); await confirm(f);
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.reset(f.presenter, { commandId: 'reset', expectedRunId: state.runId,
    expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture })).status, 'ok');
  assert.equal((await f.service.readActivity(f.context)).status, 'stale-run');
});

activity('malformed, future, unsuccessful and mismatched own receipts cannot become dated events', async () => {
  const f = await setup(); await confirm(f);
  const original = (await f.repository.query(f.context, 'event_receipts', { consumerId: 'brief:changes' })).value[0];
  const mutations = [
    { state: 'pending' }, { eventType: 'clock-tick' }, { inputVersions: { brief: 2, policy: f.context.policyVersion } },
    { inputVersions: { brief: 1, policy: 'wrong-policy' } }, { outcome: result('unavailable') },
    ...[{ occurredAt: '2027-01-01T00:00:00.000Z' }, { occurredAt: 'not-a-time' }, { runId: 'old-run' },
      { briefVersion: 99 }, { eventType: 'clock-tick' }, { operation: 'searched' }, { previousBriefVersion: 100 }]
      .map((patch) => ({ outcome: ok({ ...original.outcome.value, ...patch }) })),
  ];
  for (const patch of mutations) {
    const row = f.store.state.tables.event_receipts.find((r) => r.consumerId === 'brief:changes');
    Object.assign(row, structuredClone(original), patch);
    const value = await read(f); assert.deepEqual(value.stateChanges, [], JSON.stringify(patch));
    assert.notEqual(value.stateChangesEvidence.status, 'recorded'); assert.equal(value.lastSuccessfulCheck, null);
  }
});

activity('clock ticks, completed handlers, command replays and evaluations are not search checks', async () => {
  const f = await setup(); await confirm(f);
  assert.equal((await f.clock.registerHandler({ handlerId: 'activity-test-observation', stage: 'buddy-allocation',
    handle: async () => ok({ observed: true }) })).status, 'ok');
  assert.equal((await f.brief.confirm(f.context, { commandId: 'confirm-0', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } })).status, 'ok');
  const evaluated = await f.brief.evaluateCandidate(f.context, { candidate: stock(), employeeFacts: providerValue().employeeFacts });
  assert.equal(evaluated.status, 'ok', JSON.stringify(evaluated));
  const state = (await f.clock.readState(f.presenter)).value;
  assert.equal((await f.clock.tick(f.presenter, { eventId: 'tick', expectedClockVersion: state.clockVersion, inputDigest: inputDigest({}) })).status, 'ok');
  assert.equal((await f.repository.query(f.context, 'event_receipts', { consumerId: 'clock:handler:activity-test-observation' })).value[0].state, 'completed');
  const value = await read(f); assert.equal(value.lastSuccessfulCheck, null);
  assert.equal(value.state, 'never-searched'); assert.equal(value.searchEvidence.status, 'not-recorded');
  assert.equal(value.sourceStatus, 'ok'); assert.equal(value.stateChanges.length, 1);
});

activity('actual offer states and quoted versions survive projection without invented expiry or private fields', async () => {
  const f = await setup(); await confirm(f); const offer = await offerFixture(f);
  for (const state of ['active', 'decision-pending', 'release-pending', 'accepted', 'rejected', 'declined', 'expired']) {
    const changed = await f.repository.transaction(f.context, command(`offer-state-${state}`), (tx) => tx.compareAndSwap({ table: 'offers',
      key: { runId: f.context.runId, offerId: offer.offerId } }, f.store.state.tables.offers[0].version, { state }));
    assert.equal(changed.status, 'ok', JSON.stringify(changed));
    const value = await read(f); const projected = value.offers[0];
    assert.equal(projected.state, state); assert.equal(projected.expiresAt, '2026-11-05T08:00:00.000Z');
    assert.equal(projected.briefVersion, 1); assert.equal(projected.policyVersion, f.context.policyVersion);
    assert.equal(projected.version, changed.value.version); assert.deepEqual(projected.offerRef, { offerId: 'offer' });
    assert.equal(projected.orderUuid, offer.orderUuid); assert.equal(value.lastSuccessfulCheck, null);
    assert.ok(!JSON.stringify(value).includes('private-'));
    assert.deepEqual(Object.keys(projected).sort(), ['offerRef', 'holdId', 'orderUuid', 'state', 'briefVersion', 'policyVersion',
      'quoteId', 'expiresAt', 'version', 'createdAt'].sort());
    assert.equal(value.currentOffer.state, state); assert.ok(!JSON.stringify(value.currentOffer).includes('private-'));
  }
});

activity('reads are deterministic after reopening and never persist command receipts or other writes', async () => {
  const f = await setup(); await confirm(f); await offerFixture(f);
  const before = structuredClone(f.store.state); const first = await read(f); const again = await read(f);
  assert.deepEqual(first, again); assert.deepEqual(f.store.state, before);
  await f.repository.close(); await f.repository.open(); assert.deepEqual(await read(f), first);
  first.offers[0].state = 'forged'; first.stateChanges[0].operation = 'forged';
  assert.equal((await read(f)).offers[0].state, 'active'); assert.deepEqual(f.store.state, before);
});

activity('query failures and thrown providers do not become empty activity or source-delay claims', async () => {
  const f = await setup(); const failure = result('unavailable', { code: 'repository-offline', retryable: true });
  for (const table of ['briefs', 'offers', 'event_receipts']) {
    const service = implementation.createActivityService({ ...f, repository: { query: (context, name, filter) => name === table
      ? failure : f.repository.query(context, name, filter) } });
    assert.deepEqual(await service.readActivity(f.context), failure);
  }
  const thrown = implementation.createActivityService({ ...f, repository: { query() { throw new Error('private failure'); } } });
  const outcome = await thrown.readActivity(f.context); assert.equal(outcome.status, 'unavailable');
  assert.ok(!JSON.stringify(outcome).includes('private failure'));
  assert.equal((await implementation.createActivityService().readActivity(f.context)).status, 'unavailable');
});

activity('concurrent brief or clock changes refuse mixed snapshots without writing', async () => {
  for (const kind of ['brief', 'clock', 'offer', 'receipt']) {
    const f = await setup(); await confirm(f); await offerFixture(f); let reads = 0;
    const repository = { query: async (context, table, filter) => {
      if (++reads === 5) {
        if (kind === 'brief') await f.brief.pause(f.context, { commandId: 'during-read', expectedBriefVersion: 1 });
        else if (kind === 'clock') await f.clock.advance(f.presenter, { commandId: 'during-read', expectedClockVersion: '1', bySeconds: 1 });
        else if (kind === 'offer') await f.repository.transaction(f.context, command('during-read'), (tx) => tx.compareAndSwap(
          { table: 'offers', key: { runId: f.context.runId, offerId: 'offer' } }, 1, { state: 'rejected' }));
        else f.store.state.tables.event_receipts.find((row) => row.consumerId === 'brief:changes').state = 'pending';
      }
      return f.repository.query(context, table, filter);
    } };
    const service = implementation.createActivityService({ ...f, repository });
    assert.equal((await service.readActivity(f.context)).status, 'conflict');
  }
});

activity('malformed offer payloads refuse safely and valid timeline fields exclude arbitrary receipt data', async () => {
  const f = await setup(); await confirm(f); const original = await offerFixture(f);
  const receipt = f.store.state.tables.event_receipts.find((row) => row.consumerId === 'brief:changes');
  receipt.outcome.value.payload = { sessionHash: 'private-session-hash', otherEmployee: 'private-other-employee' };
  const valid = await read(f); assert.ok(!JSON.stringify(valid).includes('private-'));
  for (const patch of [{ state: { secret: 'private-state' } }, { policyVersion: { secret: 'private-policy' } },
    { expiresAt: 'tomorrow' }, { briefVersion: -1 }, { offerId: { secret: 'private-ref' } }]) {
    Object.assign(f.store.state.tables.offers[0], structuredClone(original), patch);
    const outcome = await f.service.readActivity(f.context);
    assert.equal(outcome.status, 'unavailable', JSON.stringify(patch)); assert.ok(!JSON.stringify(outcome).includes('private-'));
  }
});

activity('a repository scope breach refuses without disclosing foreign rows', async () => {
  const f = await setup(); await confirm(f); await offerFixture(f);
  for (const table of ['briefs', 'offers']) {
    const repository = { query: async (context, name, filter) => {
      const rows = await f.repository.query(context, name, filter);
      return name === table ? ok(rows.value.map((row) => ({ ...row, employeeId: 'private-other-employee' }))) : rows;
    } };
    const outcome = await implementation.createActivityService({ ...f, repository }).readActivity(f.context);
    assert.equal(outcome.status, 'unavailable'); assert.ok(!JSON.stringify(outcome).includes('private-other-employee'));
  }
});

activity('reset during the final clock read refuses and the trusted identity is rechecked before disclosure', async () => {
  const f = await setup(); await confirm(f); let checks = 0;
  const identity = { requireRole: async (context, role) => {
    const allowed = await f.identity.requireRole(context, role);
    return ++checks === 2 ? result('forbidden', { reason: 'access-revoked' }) : allowed;
  } };
  assert.equal((await implementation.createActivityService({ ...f, identity }).readActivity(f.context)).status, 'forbidden');
  let reads = 0;
  const clock = { now: async (context) => {
    if (++reads === 2) {
      const state = (await f.clock.readState(f.presenter)).value;
      await f.clock.reset(f.presenter, { commandId: 'during-final-read', expectedRunId: state.runId,
        expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
    }
    return f.clock.now(context);
  } };
  assert.equal((await implementation.createActivityService({ ...f, clock }).readActivity(f.context)).status, 'stale-run');
});

const NOW = '2026-11-05T00:00:00.000Z';
const OTHER = 'private-other-employee';
async function receipt(f, eventId, { at = NOW, own, others = [{ orderUuid: 'o-x', gateStatus: 'eligible', score: 99 }], assigned = false,
  state = 'completed', status = 'ok', included = true } = {}) {
  const mine = own ?? [{ orderUuid: 'o-1', gateStatus: 'eligible', score: 7 }, { orderUuid: 'o-2', gateStatus: 'ineligible', score: 1 }, { orderUuid: 'o-3', gateStatus: 'eligible', score: 5 }];
  const evaluations = [{ employeeId: OTHER, decisions: others }, ...(included ? [{ employeeId: f.context.employeeId, decisions: mine }] : [])];
  const assignments = [{ employeeId: OTHER, orderUuid: 'o-x' }, ...(assigned ? [{ employeeId: f.context.employeeId, orderUuid: 'o-1' }] : [])];
  const outcome = status === 'ok' ? ok({ state: 'allocated', runId: f.context.runId, evaluatedAt: at, inputVersions: { clock: '3' }, assignments, evaluations })
    : result('unavailable');
  const done = await f.repository.transaction(f.context, command(`receipt-${eventId}`), (tx) => tx.recordReceipt({ consumerId: 'buddy-allocation',
    eventId, eventType: 'stock-released', inputDigest: inputDigest({ eventId }), inputVersions: {}, state, outcome }));
  assert.equal(done.status, 'ok', JSON.stringify(done));
}
async function tickWith(f, id, stages) {
  for (const [stage, handle] of Object.entries(stages)) {
    assert.equal((await f.clock.registerHandler({ handlerId: `h-${stage}`, stage, handle: async () => handle })).status, 'ok');
  }
  const state = (await f.clock.readState(f.presenter)).value;
  return f.clock.tick(f.presenter, { eventId: id, expectedClockVersion: state.clockVersion, inputDigest: inputDigest({}) });
}
const pendingOutcome = { status: 'pending', operationId: 'op', operationType: 'release-pull', lastKnownState: 'waiting' };

activity('search checks drive last successful check, evidence and the searching state without leaking others', async () => {
  const f = await setup(); await confirm(f);
  await receipt(f, 'ev-other-only', { included: false, at: '2026-11-04T23:00:00.000Z' });
  await receipt(f, 'ev-future', { at: '2027-01-01T00:00:00.000Z' });
  await receipt(f, 'ev-failed', { status: 'unavailable' }); await receipt(f, 'ev-pending', { state: 'pending' });
  let value = await read(f);
  assert.equal(value.state, 'never-searched'); assert.equal(value.lastSuccessfulCheck, null);
  assert.deepEqual(value.searchEvidence, { status: 'not-recorded', reason: 'no-search-check-yet' });
  await receipt(f, 'ev-old', { at: '2026-11-04T10:00:00.000Z', assigned: true });
  await receipt(f, 'ev-new', { at: '2026-11-04T23:30:00.000Z' });
  value = await read(f);
  assert.equal(value.state, 'searching'); assert.deepEqual(value.searchEvidence, { status: 'recorded', checks: 2 });
  assert.deepEqual(value.lastSuccessfulCheck, { checkedAt: '2026-11-04T23:30:00.000Z', clockVersion: '3', carsChecked: 3, suitableCars: 2, exclusions: [], outcome: 'no-match' });
  await receipt(f, 'ev-aaa', { at: '2026-11-04T23:30:00.000Z', assigned: true });
  assert.equal((await read(f)).lastSuccessfulCheck.outcome, 'no-match');
  await receipt(f, 'ev-zz', { at: '2026-11-04T23:30:00.000Z', assigned: true });
  value = await read(f); assert.equal(value.lastSuccessfulCheck.outcome, 'offer-held');
  const text = JSON.stringify(value);
  assert.ok(!text.includes(OTHER)); assert.ok(!text.includes('o-x')); assert.ok(!text.includes('"score"'));
});

const unmet = (field, value, extra = {}) => ({ code: 'essential-unmet', field, requirement: { operator: 'gte', value, unit: 'count' }, fact: { raw: 'private' }, ...extra });
const car = (id, ...blockers) => ({ orderUuid: id, gateStatus: 'ineligible', blockers });

activity('a no-match check names the top two excluding essentials from this employee\'s own decisions only', async () => {
  const f = await setup(); await confirm(f);
  const own = [car('o-1', unmet('seats', 9), unmet('boot', 430)), car('o-2', unmet('seats', 9)), car('o-3', unmet('seats', 9), unmet('seats', 9)),
    car('o-4', unmet('boot', 430), unmet('body', 'estate')), car('o-5', { code: 'not-available' })];
  const others = [car('o-x', unmet('fuel', 'diesel')), car('o-y', unmet('fuel', 'diesel'))];
  await receipt(f, 'ev-why', { at: '2026-11-04T23:30:00.000Z', own, others });
  const value = await read(f);
  assert.deepEqual(value.lastSuccessfulCheck.exclusions, [
    { essential: 'seats', requirement: { operator: 'gte', unit: 'count', value: 9 }, cars: 3 },
    { essential: 'boot', requirement: { operator: 'gte', unit: 'count', value: 430 }, cars: 2 }]);
  const text = JSON.stringify(value); assert.ok(!text.includes('fuel') && !text.includes('diesel') && !text.includes('private') && !text.includes('o-x'));
});

activity('exclusions tie-break by essential name, drop unusable requirements, and are empty when a car is suitable', async () => {
  const f = await setup(); await confirm(f);
  await receipt(f, 'ev-tie', { at: '2026-11-04T22:00:00.000Z', own: [car('o-1', unmet('seats', 9, { requirement: { value: { nested: 1 }, operator: 'gte' } }), unmet('boot', 430))] });
  assert.deepEqual((await read(f)).lastSuccessfulCheck.exclusions.map((row) => [row.essential, row.cars]), [['boot', 1], ['seats', 1]]);
  assert.deepEqual((await read(f)).lastSuccessfulCheck.exclusions[1].requirement, { operator: 'gte' });
  await receipt(f, 'ev-suitable', { at: '2026-11-04T23:00:00.000Z', own: [car('o-1', unmet('seats', 9)), { orderUuid: 'o-2', gateStatus: 'eligible', blockers: [] }] });
  assert.deepEqual((await read(f)).lastSuccessfulCheck.exclusions, []);
  await receipt(f, 'ev-empty', { at: '2026-11-04T23:30:00.000Z', own: [] });
  const check = (await read(f)).lastSuccessfulCheck; assert.deepEqual([check.carsChecked, check.exclusions], [0, []]);
});

activity('every state value is reported, with pause winning and the offer still shown', async () => {
  const f = await setup(); assert.equal((await read(f)).state, 'no-brief'); await confirm(f);
  assert.equal((await read(f)).state, 'never-searched');
  await receipt(f, 'ev-1'); assert.equal((await read(f)).state, 'searching');
  const offer = await offerFixture(f); const swap = async (state) => assert.equal((await f.repository.transaction(f.context, command(`s-${state}`),
    (tx) => tx.compareAndSwap({ table: 'offers', key: { runId: f.context.runId, offerId: 'offer' } },
      f.store.state.tables.offers[0].version, { state }))).status, 'ok');
  assert.equal(offer.offerId, 'offer'); assert.equal((await read(f)).state, 'offer');
  for (const state of ['declined', 'rejected', 'expired', 'accepted']) { await swap(state); assert.equal((await read(f)).state, 'offer-closed', state); }
  await swap('active');
  assert.equal((await f.brief.pause(f.context, { commandId: 'pause', expectedBriefVersion: 1 })).status, 'ok');
  const value = await read(f); assert.equal(value.state, 'paused');
  assert.equal(value.currentOffer.offerRef.offerId, 'offer'); assert.equal(value.currentOffer.state, 'active');
  assert.equal(value.permission.canSearch, false); assert.equal(value.lastSuccessfulCheck.carsChecked, 3);
});

activity('the current offer is the newest by createdAt and carries the canonical encoded link', async () => {
  const f = await setup(); await confirm(f); const first = await offerFixture(f);
  assert.equal((await read(f)).currentOffer.href, `/gcsp/offer?offerId=offer&runId=${encodeURIComponent(f.context.runId)}`);
  const older = { ...structuredClone(first), offerId: 'offer b&c', holdId: 'hold-2', createdAt: '2020-01-01T00:00:00.000Z' };
  f.store.state.tables.offers.push(older);
  let value = await read(f); assert.equal(value.currentOffer.offerRef.offerId, 'offer'); assert.equal(value.offers.length, 2);
  f.store.state.tables.offers[1].createdAt = '2030-01-01T00:00:00.000Z';
  value = await read(f); assert.equal(value.currentOffer.offerRef.offerId, 'offer b&c');
  assert.equal(value.currentOffer.href, `/gcsp/offer?offerId=offer%20b%26c&runId=${encodeURIComponent(f.context.runId)}`);
  assert.ok(!JSON.stringify(value).includes('private-'));
});

activity('source status distinguishes not-checked, ok, delayed and unavailable from the latest tick', async () => {
  const f = await setup(); await confirm(f); assert.equal((await read(f)).sourceStatus, 'not-checked');
  assert.equal((await tickWith(f, 'tick-ok', { 'release-pull': ok({ pulled: 0 }), 'buddy-allocation': ok({}) })).status, 'ok');
  assert.equal((await read(f)).sourceStatus, 'ok');
  const row = () => f.store.state.tables.tick_runs.find((r) => r.tickId === 'tick-ok');
  row().state = 'pending'; row().outcomes[0].outcome = pendingOutcome; assert.equal((await read(f)).sourceStatus, 'delayed');
  row().state = 'running'; row().outcomes[0].outcome = ok({}); assert.equal((await read(f)).sourceStatus, 'delayed');
  row().state = 'interrupted'; assert.equal((await read(f)).sourceStatus, 'unavailable');
  row().state = 'completed'; row().outcomes[1].outcome = result('unavailable'); assert.equal((await read(f)).sourceStatus, 'unavailable');
  row().outcomes = [row().outcomes[0]]; assert.equal((await read(f)).sourceStatus, 'unavailable');
  row().outcomes = []; row().handlerOrder = [{ handlerId: 'other', stage: 'notifications' }]; assert.equal((await read(f)).sourceStatus, 'not-checked');
});

activity('a handler that fails really marks the tick interrupted and the source unavailable', async () => {
  const f = await setup(); await confirm(f);
  assert.notEqual((await tickWith(f, 'tick-bad', { 'release-pull': result('unavailable') })).status, 'ok');
  assert.equal((await read(f)).sourceStatus, 'unavailable');
});

activity('an unreadable tick source degrades to evidence-unavailable without failing the read', async () => {
  const f = await setup(); await confirm(f);
  const repository = { query: (c, t, q) => f.repository.query(c, t, q), read: async () => result('unavailable') };
  const value = (await implementation.createActivityService({ ...f, repository }).readActivity(f.context)).value;
  assert.equal(value.sourceStatus, 'evidence-unavailable'); assert.equal(value.state, 'never-searched');
});

activity('a foreign employee context is refused and sees none of another employee check data', async () => {
  const f = await setup(); await confirm(f); await receipt(f, 'ev-1');
  const principals = (await f.policy.getAssumption('identity.demo.principals', { runId: f.context.runId, asOf: NOW })).value.value;
  const other = principals.find((p) => p.roles.includes('employee') && p.employeeId !== f.context.employeeId);
  const otherContext = (await f.identity.switchPrincipal(f.presenter, other.principalId, 'other')).value.context;
  const value = (await f.service.readActivity(otherContext)).value;
  assert.equal(value.lastSuccessfulCheck, null); assert.equal(value.currentOffer, null); assert.equal(value.state, 'no-brief');
  assert.equal((await f.service.readActivity({ ...f.context, employeeId: other.employeeId })).status, 'forbidden');
});
