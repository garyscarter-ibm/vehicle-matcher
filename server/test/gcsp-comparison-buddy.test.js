import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { loadComparisonPolicy, generateComparisonInputs } from '../gcsp/comparison/generator.js';
import { openComparisonRun } from '../gcsp/comparison/harness.js';
import { evaluateComparisonSeed, carFit } from '../gcsp/comparison/evaluation.js';
import { replayBuddyRoute } from '../gcsp/comparison/routes/buddy.js';
import { replayCurrentRoute } from '../gcsp/comparison/routes/current.js';
import { BuddyHoldService } from '../gcsp/offers/buddy-hold.js';
import { OfferDecisionService } from '../gcsp/offers/decision.js';
import { CapturedTransport } from '../gcsp/notify/index.js';
import { shortQuotePolicy } from './helpers/short-quote-policy.js';
import { expandEvaluation } from '../gcsp/allocation/evaluation-rows.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/gcsp-comparison-buddy-outcomes.json', import.meta.url), 'utf8'));
const policy = new PolicyService({ provider: new FilePolicyProvider() });
const origin = '2026-11-05T09:00:00.000Z';
const snapshot = await loadComparisonPolicy({ policyService: policy, policyRead: { runId: 'comparison-buddy-preparation', asOf: origin } });
const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const accessing = (responseSeconds) => [{ id: 'buddy-access', weight: 1, accessSeconds: { min: 0, max: 0 },
  responseSeconds: { min: responseSeconds, max: responseSeconds } }];

// One employee, one car per release: the first decliner's reason follows the one registered preference.
const solo = (preferences, seed) => ({ seed, overlay: { ...fixture.overlay, 'comparison.cohortSize': 1, 'comparison.buddyUptake': 1,
  'comparison.releaseCadence': { firstReleaseDay: 0, intervalDays: 1, batchSize: 1 },
  'comparison.briefNoise.v1': { accuratePreferenceProbability: 0, preserveEssentials: true },
  'comparison.needs.v1': { essentials: fixture.overlay['comparison.needs.v1'].essentials, preferences } }, });
// Two employees compete for two cars released a day apart; the first holder's underlying fit fails.
const pair = { seed: 'fucq134-pair-151', overlay: { 'comparison.cohortSize': 2, 'comparison.carsPerEmployee': 1,
  'comparison.renewalDays': { min: 30, max: 30 }, 'comparison.modelLineMix': [{ modelLine: 'G21 Touring|320i', weight: 1 }],
  'comparison.releaseCadence': { firstReleaseDay: 0, intervalDays: 1, batchSize: 1 }, 'comparison.accessGroups': accessing(600),
  'comparison.needs.v1': { essentials: fixture.overlay['comparison.needs.v1'].essentials, preferences: {
    body: [{ value: 'estate', weight: 1 }, { value: 'saloon', weight: 1 }], fuel: [{ value: 'petrol', weight: 1 }] } },
  'comparison.importanceDistribution': [{ value: 100, weight: 1 }],
  'comparison.briefNoise.v1': { accuratePreferenceProbability: 0.5, preserveEssentials: true }, 'comparison.buddyUptake': 1 } };
const shortPair = { ...pair, short: true };
const withOverlay = (setup, overlay) => ({ ...setup, overlay: { ...setup.overlay, ...overlay } });

// Quote terms (3600 s) that lapse inside the 7200 s hold: an explicit alternative policy, not the seed default.
const shortPolicy = await shortQuotePolicy(3600);
const shortSnapshot = await loadComparisonPolicy({ policyService: shortPolicy, policyRead: { runId: 'comparison-buddy-preparation', asOf: origin } });

async function prepare({ seed, overlay, short }) {
  const inputs = generateComparisonInputs(seed, short ? shortSnapshot : snapshot, { overlay });
  return { policy: short ? shortPolicy : policy, inputs, evaluation: await evaluateComparisonSeed({ inputs, policy: short ? shortPolicy : policy }), codeRevision: 'fucq135-test' };
}
async function open(t, setup, route = 'buddy') {
  const run = await openComparisonRun({ ...setup, route });
  t.after(() => run.close());
  return run;
}
async function replay(t, setup) {
  const prepared = await prepare(setup);
  const run = await open(t, prepared);
  return { run, setup: prepared, record: await replayBuddyRoute(run) };
}
const rows = async (run, table) => (await run.snapshot())[table];
const deepFrozen = (value) => !value || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(deepFrozen);

test('both routes get identical inputs: cohort, stock, release schedule and policy version', async (t) => {
  const prepared = await prepare(fixture);
  const current = await open(t, prepared, 'current');
  const buddy = await open(t, prepared, 'buddy');
  assert.deepEqual(buddy.inputs, current.inputs);
  assert.equal(JSON.stringify(buddy.inputs), JSON.stringify(current.inputs));
  assert.equal(buddy.evaluation, current.evaluation);
  assert.equal(buddy.metadata.inputHash, current.metadata.inputHash);
  assert.equal(buddy.metadata.policyVersion, current.metadata.policyVersion);
  assert.notEqual(buddy.metadata.runId, current.metadata.runId);
  const stock = (run) => rows(run, 'stock').then((list) => list.map((car) => [car.orderUuid, car.release.releaseId, car.release.at]));
  assert.deepEqual(await stock(buddy), await stock(current));
  const today = await replayCurrentRoute(current);
  const record = await replayBuddyRoute(buddy);
  for (const key of ['seed', 'policyVersion', 'inputHash', 'generatorVersion', 'policyHash', 'threshold']) assert.equal(record[key], today[key], key);
  assert.deepEqual(record.employees.map((row) => [row.employeeId, row.accessGroup, row.renewalAt]),
    today.employees.map((row) => [row.employeeId, row.accessGroup, row.renewalAt]));
  assert.deepEqual(record.cars.map((row) => [row.orderUuid, row.releaseId]), today.cars.map((row) => [row.orderUuid, row.releaseId]));
  assert.deepEqual([today.route, record.route], ['current', 'buddy']);
  assert.equal(prepared.evaluation.evaluatorCalls, 2 * prepared.inputs.employees.length);
  await assert.rejects(replayBuddyRoute(current), /invalid-input: route/);
  await assert.rejects(replayCurrentRoute(await open(t, prepared)), /invalid-input: route/);
});

test('the route calls FUCQ-96, FUCQ-100 and FUCQ-106 (no copies)', async (t) => {
  const prepared = await prepare(fixture);
  const run = await open(t, prepared);
  assert.ok(run.buddy.hold instanceof BuddyHoldService && run.buddy.decisions instanceof OfferDecisionService);
  const calls = { allocate: [], tryClaim: [], decide: [], directHold: 0 };
  const spy = (object, name, key, note) => { const real = object[name].bind(object);
    object[name] = (...args) => { calls[key].push(note ? note(args) : args); return real(...args); }; };
  spy(run.buddy.allocation, 'allocate', 'allocate', ([, event]) => event.eventId);
  spy(run.buddy.hold, 'tryClaim', 'tryClaim', ([, candidate]) => candidate);
  spy(run.buddy.decisions, 'decide', 'decide', ([, input]) => input.decision);
  const direct = run.buddy.hold.allocate.bind(run.buddy.hold);
  run.buddy.hold.allocate = (...args) => { calls.directHold += 1; return direct(...args); };
  const record = await replayBuddyRoute(run);
  const { totals } = record;
  assert.equal(calls.allocate.length, prepared.inputs.releaseSchedule.length);
  assert.ok(calls.allocate.every((id) => id.startsWith('allocation:')));
  assert.ok(calls.tryClaim.length >= totals.offersMade);
  assert.ok(calls.tryClaim.every((c) => c.operationId.startsWith('allocation:') && c.eventId.startsWith('allocation:')));
  assert.equal(calls.directHold, 0, 'holds come only from allocation proposals');
  assert.deepEqual(calls.decide.slice().sort(), [...Array(totals.offersAccepted).fill('accept'),
    ...Array(totals.declines).fill('decline')].sort());
  const persisted = await run.snapshot();
  const buddyHolds = persisted.holds.filter((hold) => hold.type === 'buddy-offer');
  assert.equal(buddyHolds.length, totals.offersMade);
  assert.ok(buddyHolds.every((hold) => hold.holdId.startsWith('buddy-hold:')));
  assert.equal(persisted.offers.length, totals.offersMade);
  assert.equal(persisted.decisions.length, totals.offersAccepted + totals.declines);
  assert.equal(persisted.event_receipts.filter((row) => row.consumerId === 'buddy-allocation').length, prepared.inputs.releaseSchedule.length);
  assert.ok(persisted.decisions.every((row) => row.actorId.startsWith('offer:')));
  assert.ok(totals.offersAccepted > 0 && totals.declines > 0);
});

test('notifications are captured and none is sent', async (t) => {
  const { run, record } = await replay(t, fixture);
  const outbox = await rows(run, 'notification_outbox');
  assert.equal(outbox.length, record.totals.offersMade);
  assert.equal(record.totals.notificationsCaptured, outbox.length);
  assert.ok(run.transport instanceof CapturedTransport);
  for (const job of outbox) {
    assert.deepEqual([job.state, job.transport, job.messageKind], ['sent', 'captured', 'offer']);
    assert.match(job.outcome.message.textBody, /No email has been sent/);
    assert.equal(job.outcome.provider, undefined);
    assert.equal(job.outcome.message.recipient.fictional, true);
  }
  assert.equal(new Set(outbox.map((job) => job.offerId)).size, outbox.length);
});

test('employees accept or decline with a typed reason, one response time after the offer', async (t) => {
  const { run, setup, record } = await replay(t, shortPair);
  const { totals } = record;
  assert.deepEqual([totals.offersMade, totals.offersAccepted, totals.declines, totals.offerExpiries], [3, 1, 2, 0]);
  assert.deepEqual(totals.declinesByReason, { 'body-style': 2, size: 0, fuel: 0, equipment: 0 });
  const persisted = await run.snapshot();
  const registry = ['body-style', 'size', 'fuel', 'equipment'];
  const offerOf = (decision) => persisted.offers.find((entry) => entry.offerId === decision.offerId);
  for (const decision of persisted.decisions) {
    const quote = persisted.quotes.find((entry) => entry.quoteId === offerOf(decision).quoteId);
    assert.equal(Date.parse(decision.originalResponse.value.serverNow) - Date.parse(quote.quotedAt), 600 * 1000,
      'responses come at offer creation plus the generated response time');
    const fit = carFit(setup.evaluation, decision.employeeId, offerOf(decision).orderUuid).underlying;
    if (decision.decision === 'accept') {
      assert.equal(offerOf(decision).state, 'accepted');
      assert.ok(fit.gateStatus === 'eligible' && fit.score >= setup.evaluation.threshold);
      continue;
    }
    assert.ok(registry.includes(decision.reason.code));
    assert.equal(decision.reason.attribute, 'body');
    assert.equal(decision.versions.exclusion.value, 'untilRelevantConfirmedBriefChange');
    assert.ok(fit.score < setup.evaluation.threshold);
  }
  assert.equal(persisted.stock.filter((entry) => entry.state === 'allocated').length, 1);
});

test('an offer unanswered by its deadline expires through the clock, or lapses when its terms have', async (t) => {
  const base = withOverlay(shortPair, { 'comparison.accessGroups': accessing(8000) });
  const { run, record } = await replay(t, base);
  assert.deepEqual([record.totals.offersMade, record.totals.offerExpiries, record.totals.declines, record.totals.taken], [3, 3, 0, 0]);
  const persisted = await run.snapshot();
  assert.ok(persisted.holds.every((hold) => hold.state === 'expired' && hold.releaseReason === 'buddy-expired'));
  assert.ok(persisted.offers.every((offer) => offer.state === 'expired'));
  assert.equal(persisted.decisions.length, 0);
  assert.equal(persisted.event_receipts.filter((row) => row.consumerId === 'buddy-expiry').length, 3);
  assert.ok(persisted.tick_runs.some((tick) => tick.handlerOrder.some((row) => row.handlerId === 'buddy-expiry')));
  assert.ok(persisted.stock.every((car) => car.state === 'released' && car.available === true && car.held === false));
  assert.equal(record.totals.buddyHeldNotTakenHours, 6);
  assert.deepEqual(record.cars.map((car) => [car.outcome, car.holdsNotTaken, car.heldNotTakenSeconds]).sort(), [['held-not-taken', 2, 14400], ['held-not-taken', 1, 7200]].sort());
  // A response exactly at the deadline is too late (the deadline is inclusive).
  const edge = await replay(t, withOverlay(shortPair, { 'comparison.accessGroups': accessing(7200) }));
  assert.equal(edge.record.totals.offerExpiries, 3);
  // Answered inside the hold but after the quote's terms lapsed: only decline is left, so a keen employee lets it lapse.
  const lapsed = await replay(t, withOverlay(shortPair, { 'comparison.accessGroups': accessing(4000) }));
  assert.deepEqual([lapsed.record.totals.termsLapsed, lapsed.record.totals.offerExpiries, lapsed.record.totals.offersAccepted,
    lapsed.record.totals.declines], [1, 1, 0, 2]);
});

test('declines name the attribute that falls shortest, with a keyed fallback reason', async (t) => {
  const cases = [['body', { body: [{ value: 'estate', weight: 1 }, { value: 'saloon', weight: 1 }] }, 'fucq135-1', 'body-style'],
    ['fuel', { fuel: [{ value: 'petrol', weight: 1 }, { value: 'ev', weight: 1 }] }, 'fucq135-4', 'fuel'],
    ['comfort has no registered attribute', { comfort: [{ value: 25, weight: 1 }, { value: 75, weight: 1 }] }, 'fucq135-5', 'size']];
  for (const [label, preferences, seed, expected] of cases) {
    const { setup, record } = await replay(t, solo(preferences, seed));
    const [person] = setup.inputs.employees;
    assert.notEqual(person.gradeId, 'G1-6', `${label}: this grade is eligible for no fixture car`);
    assert.deepEqual([record.totals.offersMade, record.totals.declines], [1, 1], label);
    assert.deepEqual(Object.entries(record.totals.declinesByReason).filter(([, n]) => n).map(([code]) => code), [expected], label);
    const components = carFit(setup.evaluation, person.employeeId, setup.inputs.stock[0].orderUuid).underlying.components;
    assert.deepEqual(components.map((c) => c.field), Object.keys(preferences), label);
    assert.ok(components[0].score < 100 && components[0].importance > 0);
  }
});

// FUCQ-209: each employee's evaluation is its own row; rejoin them for these assertions.
const sliceOf = (persisted, row, id) => expandEvaluation(persisted.event_receipts.find((slice) => slice.consumerId === 'buddy-allocation-evaluation'
  && slice.eventId === `${row.eventId}:${id}`).outcome.value.evaluation);
const allocationsOf = (persisted) => persisted.event_receipts.filter((row) => row.consumerId === 'buddy-allocation')
  .map((row) => ({ ...row.outcome.value, evaluations: row.outcome.value.evaluationRefs.employeeIds.map((id) => sliceOf(persisted, row, id)) }))
  .sort((a, b) => byId(a.event.occurredAt, b.event.occurredAt));

test('decline exclusion comes from FUCQ-96 and an expiry gives no priority', async (t) => {
  const declined = await replay(t, shortPair);
  const persisted = await declined.run.snapshot();
  const [first, second] = allocationsOf(persisted);
  const { employeeId: decliner, orderUuid: freed } = first.assignments[0];
  assert.equal(persisted.decisions.find((row) => row.employeeId === decliner).decision, 'decline');
  const retried = second.evaluations.find((row) => row.employeeId === decliner).decisions.find((row) => row.orderUuid === freed);
  assert.deepEqual([retried.gateStatus, retried.blockers.map((entry) => entry.code)], ['ineligible', ['declined-unchanged']]);
  assert.ok(persisted.offers.filter((offer) => offer.employeeId === decliner).every((offer) => offer.orderUuid !== freed || offer.state === 'rejected')
    && persisted.offers.filter((offer) => offer.employeeId === decliner && offer.orderUuid === freed).length === 1,
  'the declined car is never offered to the same employee again');
  assert.ok(second.assignments.some((a) => a.orderUuid === freed && a.employeeId !== decliner), 'the freed car goes to the next contender');

  const expired = await replay(t, withOverlay(shortPair, { 'comparison.accessGroups': accessing(8000) }));
  const [early, later] = allocationsOf(await expired.run.snapshot());
  assert.equal(later.assumptions[0].value, 'renewalDueThenFitThenSeededLottery');
  // Winners follow the policy's tie-break alone: renewal due, then fit, then the seeded lottery.
  const order = later.assignments.map((a) => [a.renewalDue, -a.score, a.lottery]);
  assert.ok(order.length > 1);
  assert.deepEqual(order, order.slice().sort((a, b) => byId(a[0], b[0]) || a[1] - b[1] || byId(a[2], b[2])));
  const { employeeId: holder, orderUuid: lapsedCar } = early.assignments[0];
  const open = later.evaluations.find((row) => row.employeeId === holder).decisions.find((row) => row.orderUuid === lapsedCar);
  assert.deepEqual([open.gateStatus, open.blockers], ['eligible', []], 'expiry leaves the car open to the same employee');
  assert.ok(later.assignments.every((a) => a.reasons.map((reason) => reason.code).join() === 'allocation-policy,renewal-due,eligible-fit'));
});

test('non-participants follow today\'s route for the same releases', async (t) => {
  // With nobody in the buddy route the whole cohort is non-participants, so the two records must agree.
  const none = withOverlay(fixture, { 'comparison.buddyUptake': 0 });
  const prepared = await prepare(none);
  const today = await replayCurrentRoute(await open(t, prepared, 'current'));
  const record = await replayBuddyRoute(await open(t, prepared, 'buddy'));
  assert.equal(record.totals.participants, 0);
  assert.ok(today.totals.claims > 0 && today.totals.expiries > 0, 'a claim and an expiry are exercised');
  const strip = (row) => { const { route, participant, offers, declines, offerExpiries, termsLapsed, buddyHeldNotTakenSeconds,
    buddyHeldNotTakenHours, ...rest } = row; return rest; };
  assert.deepEqual(record.employees.map(strip), today.employees.map(strip));
  assert.deepEqual(record.cars.map(strip), today.cars.map(strip));
  for (const key of Object.keys(today.totals)) assert.equal(record.totals[key], today.totals[key], key);
  assert.equal(record.totals.offersMade, 0);

  // Mixed cohort: non-participants claim through FUCQ-66 cart holds, only on cars the buddy has not held.
  const { run, setup, record: mixed } = await replay(t, fixture);
  const persisted = await run.snapshot();
  const members = new Set(setup.inputs.employees.filter((e) => e.buddyParticipation).map((e) => e.employeeId));
  const carts = persisted.holds.filter((hold) => hold.type === 'cart');
  assert.ok(carts.length > 0 && carts.every((hold) => hold.holdId.startsWith('manual-hold:') && !members.has(hold.employeeId)));
  assert.ok(persisted.holds.filter((hold) => hold.type === 'buddy-offer').every((hold) => members.has(hold.employeeId)));
  const quoted = (hold) => Date.parse(persisted.quotes.find((quote) => quote.quoteId === hold.quoteId).quotedAt);
  const ends = new Map(persisted.decisions.map((row) => [row.holdId, Date.parse(row.originalResponse.value.serverNow)]));
  for (const buddyHold of persisted.holds.filter((hold) => hold.type === 'buddy-offer')) {
    const [from, to] = [quoted(buddyHold), ends.get(buddyHold.holdId) ?? Date.parse(buddyHold.expiresAt)];
    assert.deepEqual(carts.filter((cart) => cart.orderUuid === buddyHold.orderUuid && quoted(cart) >= from && quoted(cart) < to), [],
      'a cart claim never lands on a car while the buddy holds it');
  }
  assert.ok(carts.some((cart) => persisted.holds.some((hold) => hold.type === 'buddy-offer' && hold.orderUuid === cart.orderUuid)),
    'a non-participant takes a car the buddy offered and released');
  assert.ok(mixed.employees.filter((row) => !row.participant).every((row) => row.offers === 0));
  assert.ok(mixed.employees.filter((row) => row.participant).every((row) => row.claims === 0 && row.sessions === 0));
});

test('participants stop when manual ordering closes before renewal', async (t) => {
  const { run, setup, record } = await replay(t, withOverlay(pair, { 'comparison.renewalDays': { min: 3, max: 3 } }));
  assert.deepEqual([record.totals.offersMade, record.totals.taken], [0, 0]);
  assert.ok(record.employees.every((row) => row.orderingClosedAt && Date.parse(row.orderingClosedAt) <= Date.parse(row.renewalAt)));
  const briefs = await rows(run, 'briefs');
  assert.equal(briefs.filter((brief) => brief.buddy.paused === true).length, setup.inputs.employees.length);
  assert.equal(record.totals.carsUnused, setup.inputs.stock.length);
});

test('the hold-duration override is recorded and never published', async (t) => {
  const seconds = 300;
  const baseline = await replay(t, withOverlay(pair, { 'comparison.accessGroups': accessing(600) }));
  const { run, setup, record } = await replay(t, withOverlay(pair, { 'hold.buddy.durationSeconds': seconds }));
  assert.deepEqual(baseline.record.holdDuration, { key: 'hold.buddy.durationSeconds', holdDurationSeconds: 7200, overlay: false, baselineValue: 7200 });
  assert.deepEqual(record.holdDuration, { key: 'hold.buddy.durationSeconds', holdDurationSeconds: seconds, overlay: true, baselineValue: 7200 });
  assert.equal(record.assumptions.find((row) => row.key === 'hold.buddy.durationSeconds').value, seconds);
  assert.equal(setup.inputs.manifest.overlay['hold.buddy.durationSeconds'], seconds);
  assert.equal(setup.inputs.manifest.assumptions.find((row) => row.key === 'hold.buddy.durationSeconds').baselineValue, 7200);
  assert.equal(record.inputHash, baseline.record.inputHash, 'a sweep leaves the cohort, stock and releases alone');
  const stored = await run.snapshot();
  for (const hold of stored.holds) {
    assert.equal(Date.parse(hold.expiresAt) - Date.parse(stored.quotes.find((quote) => quote.quoteId === hold.quoteId).quotedAt), seconds * 1000);
  }
  assert.deepEqual([record.totals.offerExpiries, record.totals.offersAccepted], [3, 0], 'a 600 s answer now arrives after the 300 s hold');
  assert.equal(record.totals.buddyHeldNotTakenHours, 0.25);
  // The canonical policy is untouched, through the run's view of it and through a fresh reader.
  const read = { runId: 'comparison-after-override', asOf: origin };
  assert.equal((await policy.getAssumption('hold.buddy.durationSeconds', read)).value.value, 7200);
  const fresh = new PolicyService({ provider: new FilePolicyProvider() });
  assert.equal((await fresh.getAssumption('hold.buddy.durationSeconds', read)).value.value, 7200);
  assert.equal((await policy.getAssumption('offer.declineReasons.v1', read)).status, 'invalid');
  assert.equal(run.policy.publishPolicyVersion, undefined);
  assert.equal(run.policy.adoptReviewedAssumptions, undefined);
});

test('identical outcomes for the same seed', async (t) => {
  for (const setup of [fixture, pair, withOverlay(pair, { 'comparison.accessGroups': accessing(8000) })]) {
    const a = await replay(t, setup);
    const b = await replay(t, setup);
    assert.deepEqual(a.record, b.record);
    assert.equal(JSON.stringify(a.record), JSON.stringify(b.record));
    assert.ok(deepFrozen(a.record));
    for (const row of [...a.record.employees, ...a.record.cars]) {
      assert.deepEqual([row.seed, row.policyVersion, row.route], [setup.seed, 'gcsp-policy-v1', 'buddy']);
    }
  }
});

test('the recorded buddy outcome record matches the replay', async (t) => {
  const { record } = await replay(t, fixture);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), fixture.outcomeRecord);
  assert.ok(record.employees.some((row) => row.participant) && record.employees.some((row) => !row.participant));
  const { totals } = record;
  assert.deepEqual([totals.offersMade, totals.offersAccepted, totals.declines], [3, 1, 2]);
  assert.equal(totals.declines, Object.values(totals.declinesByReason).reduce((sum, n) => sum + n, 0));
});
