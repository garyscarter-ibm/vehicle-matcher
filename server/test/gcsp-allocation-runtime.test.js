// FUCQ-96 failed-claim fall-through and FUCQ-100 AC5 on the composed memory runtime.
// Real release, allocator and buddy hold; only a racer is injected between plan and claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { inputDigest, OCCUPYING_STATES } from '../gcsp/repository/index.js';
import { createSyntheticStockProvider } from '../gcsp/stock/index.js';
import { createVehicleSnapshot } from '../vehicles/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { essential, preference } from './helpers/employee-recommendation.js';

const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const ids = ['f9600000-0000-4000-8000-000000000001', 'f9600000-0000-4000-8000-000000000002'];

function car(orderUuid, index, contexts, observedAt) {
  const version = 'TEST-fucq96-runtime-v1';
  const fact = (value, unit = null) => ({ status: 'known', value, unit,
    provenance: { sourceRef: 'TEST:fucq96-runtime', observedAt, version, assurance: 'synthetic-scenario' } });
  return { orderUuid, orderNumber: `960000${index}`, configurationId: 'RjcwOlMx', corpusVersion: 'TEST-only-v1', revision: 1,
    visibility: { companyIds: [...new Set(contexts.map((c) => c.companyId))], schemeIds: [...new Set(contexts.map((c) => c.schemeId))], employeeIds: null },
    availability: { availableUntil: '2027-01-01T00:00:00.000Z' },
    facts: createVehicleSnapshot({ sourceNamespace: 'TEST:fucq96-runtime', identityKind: 'exact-stock',
      sourceKeys: { stockId: orderUuid }, snapshotVersion: version, observedAt,
      display: { name: `Synthetic TEST allocation car ${index}` }, facts: {
        eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'), fuel: fact('petrol'),
        seats: fact(5, 'count'), boot: fact(380 + index, 'L'), sizeClass: fact(2, 'ordinal-1-5'),
        insuranceGroup: fact(25, 'insurance-group'), zeroTo62: fact(7, 's'), mpg: fact(45, 'mpg-imperial'), tags: fact(['cruiser']) } }) };
}

async function setup(t, { beforeRelease = false } = {}) {
  let plan;
  const stockProvider = { pull: (request) => plan ? plan.pull(request) : { status: 'unavailable', retryable: true } };
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider, environmentId: 'fucq96-runtime-test',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'fucq96-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => runtime.close());
  const registered = []; const register = runtime.clock.registerHandler.bind(runtime.clock);
  runtime.clock.registerHandler = async (input) => { registered.push(input.handlerId); return register(input); };
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: ['https://fucq96.test'] });
  good(await server.gcspStartup);
  const presenter = good(await runtime.identity.createPresenterSession('fucq96-presenter')).context;
  const contexts = {};
  for (const name of ['paula', 'alex']) {
    contexts[name] = good(await runtime.identity.switchPrincipal(presenter, `demo-${name}`, `fucq96-${name}`)).context;
    good(await seedManualDemoContext({ repository: runtime.repository, identity: runtime.identity, clock: runtime.clock, context: contexts[name] }));
  }
  // Paula alone has a consenting buddy brief, so both cars are her candidates in turn.
  good(await runtime.brief.saveDraft(contexts.paula, { commandId: 'brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  good(await runtime.brief.confirm(contexts.paula, { commandId: 'brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
  const time = good(await runtime.clock.now(presenter));
  const cars = ids.map((id, i) => car(id, i + 1, [contexts.paula, contexts.alex], time.now));
  plan = createSyntheticStockProvider({ runId: presenter.runId, version: 'TEST-fucq96-runtime-v1',
    label: 'Synthetic TEST allocation input; not F77/F78', windows: [{ windowId: 'TEST-noon',
      availableAt: '2026-11-05T12:00:00.000Z', supplyId: null, stock: cars }] });
  // An earlier tick consumes the brief-changed event before any car is released.
  let early;
  if (beforeRelease) early = good(await presenterTick(runtime, presenter, 'fucq96-before-release'));
  if (time.now < '2026-11-05T12:00:00.000Z') good(await runtime.clock.advance(presenter,
    { commandId: 'to-noon', expectedClockVersion: time.clockVersion, to: '2026-11-05T12:00:00.000Z' }));
  return { runtime, presenter, contexts, registered, early, rows: (table) => runtime.repository.query(presenter, table).then(good) };
}

// The racer runs once, between the allocator's plan and its first real claim.
function raceFirstClaim(f, race) {
  const real = f.runtime.buddy.tryClaim.bind(f.runtime.buddy); const raced = [];
  f.runtime.buddy.tryClaim = async (context, candidate) => {
    if (!raced.length) { raced.push(candidate.orderUuid); await race(candidate.orderUuid); }
    return real(context, candidate);
  };
  return raced;
}
async function presenterTick(runtime, presenter, eventId) {
  const time = good(await runtime.clock.now(presenter));
  return runtime.clock.tick(presenter, { eventId, inputDigest: inputDigest(eventId), expectedClockVersion: time.clockVersion });
}
const tick = (f, eventId = 'fucq96-release-tick') => presenterTick(f.runtime, f.presenter, eventId);
const allocationsOf = (ticked) => ticked.outcomes.find((row) => row.handlerId === 'buddy-allocation').outcome.value.allocations;
async function assertFellThrough(f, out, raced, expectedStatus) {
  const ticked = good(out);
  assert.ok(ticked.handlerOrder.findIndex((row) => row.handlerId === 'stock-release')
    < ticked.handlerOrder.findIndex((row) => row.handlerId === 'buddy-allocation'));
  const allocations = allocationsOf(ticked);
  const allocated = allocations.filter((row) => row.state === 'allocated');
  assert.equal(allocated.length, 1, JSON.stringify(allocations.map((row) => row.attempts)));
  const [failedAttempt, wonAttempt] = allocated[0].attempts;
  assert.equal(allocated[0].attempts.length, 2);
  assert.equal(failedAttempt.orderUuid, raced[0]); assert.equal(failedAttempt.employeeId, f.contexts.paula.employeeId);
  assert.ok(expectedStatus.includes(failedAttempt.outcome.status), JSON.stringify(failedAttempt.outcome));
  assert.equal(wonAttempt.employeeId, f.contexts.paula.employeeId, 'the same employee tries the next candidate');
  assert.notEqual(wonAttempt.orderUuid, raced[0]); assert.equal(wonAttempt.outcome.status, 'ok');
  assert.equal(allocated[0].assignments.length, 1); assert.equal(allocated[0].assignments[0].orderUuid, wonAttempt.orderUuid);
  const buddyHolds = (await f.rows('holds')).filter((row) => row.type === 'buddy-offer');
  const offers = await f.rows('offers'); const outbox = await f.rows('notification_outbox');
  assert.equal(buddyHolds.length, 1); assert.equal(buddyHolds[0].orderUuid, wonAttempt.orderUuid);
  assert.equal(offers.length, 1); assert.equal(offers[0].orderUuid, wonAttempt.orderUuid);
  assert.equal(offers[0].employeeId, f.contexts.paula.employeeId);
  assert.equal(outbox.length, 1); assert.equal(outbox[0].offerId, offers[0].offerId);
  assert.ok(!buddyHolds.some((row) => row.orderUuid === raced[0]) && !offers.some((row) => row.orderUuid === raced[0]));
  // Replaying the same tick is idempotent: no further claim, hold, offer or outbox job.
  const again = good(await tick(f));
  assert.deepEqual(again.outcomes, ticked.outcomes);
  for (const [table, count] of [['offers', 1], ['notification_outbox', 1]]) assert.equal((await f.rows(table)).length, count);
}

test('shared runtime allocates on brief-changed then stock-released triggers through the buddy hold', async (t) => {
  const f = await setup(t, { beforeRelease: true });
  assert.equal(f.runtime.dependencies.gcspAllocation, f.runtime.allocation);
  assert.ok(f.registered.indexOf('stock-release') < f.registered.indexOf('buddy-allocation'));
  const [briefChanged] = allocationsOf(f.early);
  assert.equal(briefChanged.event.eventType, 'brief-changed'); assert.equal(briefChanged.state, 'no-assignment');
  assert.deepEqual(briefChanged.attempts, []); assert.equal((await f.rows('offers')).length, 0);
  const released = allocationsOf(good(await tick(f))).filter((row) => row.event.eventType === 'stock-released');
  assert.equal(released.length, 1); assert.equal(released[0].state, 'allocated');
  assert.equal(released[0].policyVersion, f.presenter.policyVersion);
  assert.equal(released[0].assumptions[0].key, 'allocation.tieBreak.rule');
  assert.deepEqual(released[0].evaluations.map((row) => row.employeeId), [f.contexts.paula.employeeId]);
  assert.equal(released[0].attempts.length, 1); assert.equal(released[0].attempts[0].outcome.status, 'ok');
  for (const table of ['offers', 'notification_outbox']) assert.equal((await f.rows(table)).length, 1);
  assert.equal((await f.rows('holds')).filter((row) => row.type === 'buddy-offer').length, 1);
});

test('a stale first claim makes the composed allocator try the next car; one hold, offer and outbox job', async (t) => {
  const f = await setup(t);
  // A concurrent stock revision lands after planning, so the first exact claim is stale.
  const raced = raceFirstClaim(f, (orderUuid) => f.runtime.repository.transaction(f.presenter,
    { commandId: 'racer-revision', inputDigest: inputDigest('racer-revision') }, async (tx) => {
      const key = { table: 'stock', key: { runId: f.presenter.runId, orderUuid } };
      const row = good(await tx.get(key)); return tx.compareAndSwap(key, row.version, { revision: (row.revision ?? 1) + 1 });
    }).then(good));
  await assertFellThrough(f, await tick(f), raced, ['stale-version']);
});

test('a conflicting first claim (car taken by another route) falls through without an offer for that car', async (t) => {
  const f = await setup(t);
  // A competing exclusive hold appears on the first car after planning.
  const raced = raceFirstClaim(f, (orderUuid) => f.runtime.repository.transaction(f.presenter,
    { commandId: 'racer-hold', inputDigest: inputDigest('racer-hold') }, async (tx) => {
      const key = { table: 'stock', key: { runId: f.presenter.runId, orderUuid } };
      const row = good(await tx.get(key));
      return tx.compareAndSwap(key, row.version, { state: 'held', held: true, available: false });
    }).then(good));
  await assertFellThrough(f, await tick(f), raced, ['conflict', 'stale-version']);
  const stock = await f.rows('stock');
  assert.equal(stock.find((row) => row.orderUuid === raced[0]).state, 'held');
  assert.ok((await f.rows('holds')).filter((row) => OCCUPYING_STATES.includes(row.state)).every((row) => row.orderUuid !== raced[0]));
});
