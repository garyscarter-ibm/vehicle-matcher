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
import { createStrictScopeRepository } from './helpers/strict-scope-repository.js';

const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const ids = ['f9600000-0000-4000-8000-000000000001', 'f9600000-0000-4000-8000-000000000002'];

function car(orderUuid, index, contexts, observedAt, plugIn = false) {
  const version = 'TEST-fucq96-runtime-v1';
  const fact = (value, unit = null) => ({ status: 'known', value, unit,
    provenance: { sourceRef: 'TEST:fucq96-runtime', observedAt, version, assurance: 'synthetic-scenario' } });
  return { orderUuid, orderNumber: String(9600000 + index), configurationId: 'RjcwOlMx', corpusVersion: 'TEST-only-v1', revision: 1,
    visibility: { companyIds: [...new Set(contexts.map((c) => c.companyId))], schemeIds: [...new Set(contexts.map((c) => c.schemeId))], employeeIds: null },
    availability: { availableUntil: '2027-01-01T00:00:00.000Z' },
    facts: createVehicleSnapshot({ sourceNamespace: 'TEST:fucq96-runtime', identityKind: 'exact-stock',
      sourceKeys: { stockId: orderUuid }, snapshotVersion: version, observedAt,
      display: { name: `Synthetic TEST allocation car ${index}` }, facts: {
        eligibilityModelKey: fact(plugIn ? 'G21 Touring|330e' : 'F70 Sports Hatch|120'), body: fact(plugIn ? 'estate' : 'hatch'), fuel: fact(plugIn ? 'phev' : 'petrol'),
        seats: fact(5, 'count'), boot: fact(380 + index, 'L'), sizeClass: fact(2, 'ordinal-1-5'),
        insuranceGroup: fact(25, 'insurance-group'), zeroTo62: fact(7, 's'), mpg: fact(45, 'mpg-imperial'), tags: fact(['cruiser']) } }) };
}

async function setup(t, { beforeRelease = false, repository, releases = 1, carsPerRelease = 2, unmatchable = false, accountSubset = false, retainedDraft = false, plugIn = false } = {}) {
  let plan;
  const stockProvider = { pull: (request) => plan ? plan.pull(request) : { status: 'unavailable', retryable: true } };
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider, environmentId: 'fucq96-runtime-test',
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
  if (accountSubset) {
    if (retainedDraft) {
      const editor = good(await runtime.editor.readEditor(contexts.paula));
      good(await runtime.brief.saveDraft(contexts.paula, { commandId: 'retained-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
        brief: editor.initial.brief }));
    }
    const saved = good(await runtime.editor.savePreferences(contexts.paula, { commandId: 'account-subset', expectedBriefVersion: 0,
      expectedDraftVersion: retainedDraft ? 1 : 0, changes: { body: { value: ['estate'] }, comfort: { value: 50 }, sportiness: { value: 50 } } }));
    good(await runtime.editor.engage(contexts.paula, { commandId: 'account-engage', expectedBriefVersion: 0, expectedDraftVersion: saved.draftVersion }));
  } else {
    good(await runtime.brief.saveDraft(contexts.paula, { commandId: 'brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(unmatchable ? 99 : 5) } } }));
    good(await runtime.brief.confirm(contexts.paula, { commandId: 'brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: true } }));
  }
  const time = good(await runtime.clock.now(presenter));
  const cars = ids.map((id, i) => car(id, i + 1, [contexts.paula, contexts.alex], time.now, plugIn));
  plan = createSyntheticStockProvider({ runId: presenter.runId, version: 'TEST-fucq96-runtime-v1',
    label: 'Synthetic TEST allocation input; not F77/F78', windows: Array.from({ length: releases }, (_, day) => ({ windowId: `TEST-noon-${day}`,
      availableAt: new Date(Date.parse('2026-11-05T12:00:00.000Z') + day * 86400000).toISOString(), supplyId: null,
      stock: day === 0 && carsPerRelease === 2 ? cars : Array.from({ length: carsPerRelease }, (_, i) =>
        car(`f9700000-0000-4000-8000-${String(day * carsPerRelease + i + 1).padStart(12, '0')}`, day * carsPerRelease + i + 1,
          [contexts.paula, contexts.alex], time.now)) })) });
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
const allocationsOf = async (f, ticked) => {
  const value = ticked.outcomes.find((row) => row.handlerId === 'buddy-allocation').outcome.value;
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 1024);
  assert.equal(value.allocations, undefined);
  const { allocations } = good(await f.runtime.allocation.consumeTriggers(f.presenter));
  assert.deepEqual(value.summary, { events: allocations.length,
    offers: allocations.reduce((n, row) => n + row.assignments.length, 0),
    evaluated: allocations.reduce((n, row) => n + row.evaluations.length, 0) });
  return allocations;
};
async function assertFellThrough(f, out, raced, expectedStatus) {
  const ticked = good(out);
  assert.ok(ticked.handlerOrder.findIndex((row) => row.handlerId === 'stock-release')
    < ticked.handlerOrder.findIndex((row) => row.handlerId === 'buddy-allocation'));
  const allocations = await allocationsOf(f, ticked);
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
  const [briefChanged] = await allocationsOf(f, f.early);
  assert.equal(briefChanged.event.eventType, 'brief-changed'); assert.equal(briefChanged.state, 'no-assignment');
  assert.deepEqual(briefChanged.attempts, []); assert.equal((await f.rows('offers')).length, 0);
  const released = (await allocationsOf(f, good(await tick(f)))).filter((row) => row.event.eventType === 'stock-released');
  assert.equal(released.length, 1); assert.equal(released[0].state, 'allocated');
  assert.equal(released[0].policyVersion, f.presenter.policyVersion);
  assert.equal(released[0].assumptions[0].key, 'allocation.tieBreak.rule');
  assert.deepEqual(released[0].evaluations.map((row) => row.employeeId), [f.contexts.paula.employeeId]);
  assert.equal(released[0].attempts.length, 1); assert.equal(released[0].attempts[0].outcome.status, 'ok');
  for (const table of ['offers', 'notification_outbox']) assert.equal((await f.rows(table)).length, 1);
  assert.equal((await f.rows('holds')).filter((row) => row.type === 'buddy-offer').length, 1);
});

test('Account subset preferences reach a real release, hold and offer for fresh and retained drafts', async (t) => {
  for (const retainedDraft of [false, true]) {
    const f = await setup(t, { accountSubset: true, retainedDraft, beforeRelease: true });
    const released = (await allocationsOf(f, good(await tick(f)))).find((row) => row.event.eventType === 'stock-released');
    assert.equal(released.state, 'allocated', JSON.stringify(released.evaluations));
    assert.equal(released.assignments.length, 1);
    assert.equal((await f.rows('offers')).length, 1);
    assert.equal((await f.rows('notification_outbox')).length, 1);
    assert.equal((await f.rows('holds')).filter((row) => row.type === 'buddy-offer').length, 1);
    const current = good(await f.runtime.editor.readEditor(f.contexts.paula));
    assert.equal(current.initial.accountPreferences.considered, 3);
    assert.equal(current.initial.accountPreferences.categories.size.state, 'unset');
  }
});

test('untouched charging retains source readiness through a real plug-in hold and acceptance', async (t) => {
  const f = await setup(t, { accountSubset: true, plugIn: true, beforeRelease: true });
  const released = (await allocationsOf(f, good(await tick(f)))).find((row) => row.event.eventType === 'stock-released');
  assert.equal(released.state, 'allocated', JSON.stringify(released.evaluations));
  const offer = (await f.rows('offers'))[0];
  const hold = (await f.rows('holds')).find((h) => h.holdId === offer.holdId);
  const quote = (await f.rows('quotes')).find((q) => q.quoteId === offer.quoteId);
  const selector = { runId: f.presenter.runId, offerId: offer.offerId };
  const capability = good(await f.runtime.offerAccess.fromAccount(f.contexts.paula, selector)).context;
  const shown = good(await f.runtime.offerAccess.read(capability));
  const handoff = shown.handoff;
  const outcome = good(await f.runtime.offerDecisions.decide(capability, { ...selector, commandId: 'subset-accept', decision: 'accept',
    expectedOfferVersion: offer.version, expectedHoldVersion: hold.version, expectedQuoteVersion: quote.version,
    termsDigest: handoff.termsDigest, declarations: Object.fromEntries(handoff.declarations.map((d) => [d.id, true])),
    expectedReturnMileage: 6000 }));
  assert.equal(outcome.state, 'accepted');
  assert.equal(outcome.holdState, 'allocated');
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

async function repeatedReleases(t, repository) {
  const f = await setup(t, { repository, releases: 6, carsPerRelease: 12, unmatchable: true });
  let last;
  for (let day = 0; day < 6; day += 1) {
    if (day) {
      const time = good(await f.runtime.clock.now(f.presenter));
      good(await f.runtime.clock.advance(f.presenter, { commandId: `release-day-${day}`, expectedClockVersion: time.clockVersion, bySeconds: 86400 }));
    }
    last = good(await tick(f, `release-${day}`));
    const buddy = last.outcomes.find((row) => row.handlerId === 'buddy-allocation').outcome;
    assert.deepEqual(buddy.value.summary, { events: day + 2, offers: 0, evaluated: day + 2 });
    assert.ok(Buffer.byteLength(JSON.stringify(buddy)) < 1024);
    assert.deepEqual(good(await tick(f, `release-${day}`)), last, 'same event remains idempotent');
  }
  const allocations = await allocationsOf(f, last);
  assert.ok(allocations.at(-1).evaluations[0].decisions.length >= 72, 'later releases evaluate the growing available stock');
  assert.ok(Buffer.byteLength(JSON.stringify(allocations)) > 20000, 'regression fixture retains substantial canonical evidence');
  const receipts = (await f.rows('event_receipts')).filter((row) => row.consumerId === 'clock:handler:buddy-allocation'
    || row.consumerId === 'command:transaction' && row.eventId.startsWith('clock:tick:'));
  for (const row of receipts) assert.ok(Buffer.byteLength(JSON.stringify(row)) < 8192, `${row.consumerId}:${row.eventId}`);
  for (const row of await f.rows('tick_runs')) assert.ok(Buffer.byteLength(JSON.stringify(row)) < 8192);
  t.diagnostic(`Retained allocation details: ${Buffer.byteLength(JSON.stringify(allocations))} bytes; final Buddy clock outcome: ${Buffer.byteLength(JSON.stringify(last.outcomes.find((row) => row.handlerId === 'buddy-allocation').outcome))} bytes.`);
  return f;
}

test('six successive releases keep clock receipts bounded as canonical evaluations grow', async (t) => repeatedReleases(t));

test('native PostgreSQL persists bounded tick and command JSON across six releases', {
  skip: process.env.GCSP_DATABASE_URL === undefined ? 'native PostgreSQL URL unset' : false,
}, async (t) => {
  const { default: pg } = await import('pg');
  const { createPostgresRepository } = await import('../gcsp/repository/postgres.js');
  const schema = `release_memory_${process.pid}`;
  const pool = new pg.Pool({ connectionString: process.env.GCSP_DATABASE_URL, max: 2, statement_timeout: 15000 });
  pool.on('error', () => {});
  const repository = createPostgresRepository({ schema, pool });
  t.after(async () => { await repository.close(); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const f = await repeatedReleases(t, repository);
  const ticks = await pool.query(`SELECT max(octet_length(data::text)) AS bytes FROM "${schema}".tick_runs`);
  const commands = await pool.query(`SELECT max(octet_length(data::text)) AS bytes FROM "${schema}".event_receipts
    WHERE consumer_id = 'clock:handler:buddy-allocation' OR consumer_id = 'command:transaction' AND event_id LIKE 'clock:tick:%'`);
  assert.ok(ticks.rows[0].bytes < 8192); assert.ok(commands.rows[0].bytes < 8192);
  t.diagnostic(`Native SQL maximum tick JSON: ${ticks.rows[0].bytes} bytes; maximum clock receipt/command JSON: ${commands.rows[0].bytes} bytes.`);
  await f.runtime.close();
});

// FUCQ-424: every declared clock/allocation receipt transaction completes on its declared state alone, equal to full state.
test('declared clock and allocation receipt transactions need only their declared state', async (t) => {
  const { repository, report } = createStrictScopeRepository();
  const f = await setup(t, { repository, beforeRelease: true });
  const ticked = good(await tick(f));
  assert.deepEqual(good(await tick(f)).outcomes, ticked.outcomes);
  assert.equal((await f.rows('offers')).length, 1);
  const kinds = new Set(report.scoped.map((id) => id.split(':').slice(0, 3).join(':')));
  for (const kind of ['clock:advance:to-noon', 'clock:tick:start', 'clock:tick:receipt', 'clock:tick:finish',
    'allocation:prepare:allocation', 'allocation:advance:allocation', 'allocation:complete:allocation']) assert.ok(kinds.has(kind), `${kind}: ${[...kinds]}`);
  assert.deepEqual(report.misses, []); assert.deepEqual(report.differences, []);
});
