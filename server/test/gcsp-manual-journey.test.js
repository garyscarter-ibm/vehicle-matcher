// FUCQ-73: manual (cart) journeys through the hosted launcher's real HTTP routes on the memory repository, plus the composed difficult cases.
// Assertions never print contact, licence or account data; the check/same pattern keeps diagnostics to fixed words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { startGcspDemo } from '../../scripts/gcsp-demo.mjs';
import { createDemoStockProvider } from '../gcsp/stock/demo-provider.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { competingPolicy, good, actAs, assumption, resetRun, rows, stepper, tickTo } from './helpers/gcsp-journey.js';
import { createLocalHttpsFixture } from './helpers/local-https.js';

const check = (value, message) => assert.equal(Boolean(value), true, message);
const same = (actual, expected, message) => check(isDeepStrictEqual(actual, expected), message);
const DAY = 86400000;
const addSeconds = (instant, seconds) => new Date(Date.parse(instant) + seconds * 1000).toISOString();
const dateAfter = (instant, days) => new Date(Date.parse(`${instant.slice(0, 10)}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);
const brief = (reply) => `${reply.status} ${reply.json?.status ?? ''} ${reply.json?.code ?? reply.json?.reason ?? ''}`.trim();
/** The reply's value on a plain 200 ok; the message carries only the status words. */
const value = (reply, note) => { check(reply.status === 200 && reply.json?.status === 'ok', `${note}: ${brief(reply)}`); return reply.json.value; };

/** The hosted launcher (HTTPS, memory repository on an owned store) that `reopen()` can close and start again over the same store. */
async function boot(t, { edit, environmentId = 'manual-journey' } = {}) {
  const { seed, policy } = await competingPolicy(edit);
  const https = await createLocalHttpsFixture(t);
  const store = createMemoryStore();
  const f = { store, seed, counter: 0, presenter: null, context: null, app: null, services: null, policy: null, origin: null };
  const open = async () => {
    f.app = good(await startGcspDemo({ port: 0, accessKey: '', tls: https.configuration, runtime: { mode: 'memory',
      repository: createMemoryRepository({ store }), policy, stockProvider: createDemoStockProvider, adoptOfferJourney: true,
      environmentId, policyAsOf: seed.effectiveFrom, commandId: `${environmentId}-bootstrap` } }));
    Object.assign(f, { services: f.app.services, policy: f.app.services.policy, origin: f.app.origin });
  };
  await open();
  t.after(() => f.app.close());
  f.api = async (path, { body, session, method } = {}) => {
    const send = () => https.fetch(`${f.origin}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), timeoutMs: 60000,
      headers: { Origin: f.origin, Cookie: session ?? f.presenter, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    // A loopback connect that times out under host load never reached the server, so resending it is safe.
    let response;
    for (let attempt = 0; ; attempt += 1) {
      try { response = await send(); break; } catch (error) { if (error?.code !== 'ETIMEDOUT' || attempt >= 3) throw error; }
    }
    return { status: response.status, json: await response.json(), headers: response.headers };
  };
  // Trusted backend step: there is no HTTP route that issues a presenter session.
  f.reopenPresenter = async () => {
    const next = good(await f.services.identity.createPresenterSession(`presenter-${++f.counter}`));
    f.presenter = [next.setCookie].flat().map((entry) => entry.split(';')[0]).join('; '); f.context = next.context;
  };
  f.reopen = async () => { await f.app.close(); await open(); await f.reopenPresenter(); };
  await f.reopenPresenter();
  return f;
}

/** Reset to a fresh run, switch to the named employees, and release the first window with a presenter tick. */
async function begin(f, label, names, { release = true } = {}) {
  const { runId } = await resetRun(f, label);
  const sessions = {};
  for (const name of names) sessions[name] = await actAs(f, label, name);
  const out = { runId, sessions };
  if (release) {
    const tick = await tickTo(f, label, { mode: 'next-release' });
    out.released = tick.outcome('stock-release'); out.now = tick.now;
    check(out.released.kind === 'stock-released' && out.released.orderUuids.length > 0, 'the release tick publishes the run stock');
  }
  return out;
}

/** An employee's own calls: every route runs on the employee's cookie. */
const asEmployee = (f, session) => ({ get: (path) => f.api(path, { session }), post: (path, body) => f.api(path, { session, body }) });

/** The trusted employee context for a cookie, for backend-only fixture edits (the same seam the manual-context tests use). */
async function contextOf(f, session) { return good(await f.services.identity.resolveSession({ authorized: true, cookie: session })); }
async function edit(f, context, table, key, patch, id) {
  return good(await f.services.repository.transaction(context, { commandId: `fixture:${id}`, inputDigest: inputDigest({ id }) }, async (tx) => {
    const ref = { table, key: { runId: context.runId, ...key } };
    const found = await tx.get(ref); if (found.status !== 'ok') return found;
    return tx.compareAndSwap(ref, found.value.version, typeof patch === 'function' ? patch(found.value) : patch);
  }), id);
}
/** An employee with no current contract: the new-order branch (the seeded account always starts with one). */
async function makeNewOrderEmployee(f, context) {
  await edit(f, context, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId }, { contractId: null }, `new-slot:${context.employeeId}`);
  await edit(f, context, 'employees', { employeeId: context.employeeId }, (row) => {
    const manualContext = structuredClone(row.contract.manualContext); manualContext.contracts = []; manualContext.histories[0].entries = [];
    return { contract: { ...row.contract, manualContext } };
  }, `new-records:${context.employeeId}`);
}

const stockRow = async (f, orderUuid) => (await rows(f, 'stock')).find((row) => row.orderUuid === orderUuid);
const declarationsFor = (terms, mode) => Object.fromEntries(terms.declarations.filter((row) => row.appliesTo === 'all' || row.appliesTo === mode).map((row) => [row.id, true]));

/** The draft and the stock page, as the setup and gallery pages call them. Returns what later steps pin. */
async function chooseAndBrowse(f, who, plan, label, { claimable = true } = {}) {
  const e = asEmployee(f, who.session);
  const account = value(await e.get('/api/gcsp/manual/account'), 'account');
  const choices = { mode: plan.mode, oldContractId: account.actions[0].oldContractId, slotId: account.actions[0].slotId, schemeId: account.actions[0].schemeId,
    driverId: account.choices.drivers.find((row) => row.kind === plan.driverKind).driverId, contractOptionId: plan.contractOptionId,
    requestedCollectionDate: plan.date, collectionLocationId: plan.locationId, brand: account.choices.brands[0], contact: plan.contact,
    expectedReturnMileage: plan.mode === 'replacement' ? plan.mileage : null, specialRequirements: plan.requirements };
  const draft = value(await e.post('/api/gcsp/manual/draft', { commandId: `${label}-draft`, expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices }), 'save draft');
  const stock = value(await e.get('/api/gcsp/manual/stock'), 'stock');
  const decision = stock.decisions.find((row) => row.gateStatus === 'eligible' && row.claimInput);
  if (claimable) check(decision, 'the released pool has a car this employee can claim');
  return { e, account, choices, draft, stock, decision };
}

// Medium defect: server/gcsp/lifecycle/return-plan/index.js:52,58 reads the draft's mileage, not the frozen review details.
const RETURN_MILEAGE_DEFECT = 'defect: the return plan shows the first draft return mileage, not the one saved on the review page';
/** Plans for the two coherent journeys. Dates are offsets from the run clock, so no wall-clock date appears here. */
const NEW_SELF = { mode: 'new', driverKind: 'employee', contractOptionId: 'twelve-month-12000', locationId: 'demo-company-site', leadDays: 10,
  contact: { phone: '01632 960111', email: 'new-order-contact@example.invalid' }, requirements: 'Left-hand seat adjustment',
  reviewContact: { phone: '01632 960222', email: 'new-order-review@example.invalid' }, reviewRequirements: 'Collect after 2pm' };
const REPLACE_NOMINATED = { mode: 'replacement', driverKind: 'nominated', contractOptionId: 'six-month-8000', locationId: 'demo-collection-centre', leadDays: 14,
  mileage: 6700, contact: { phone: '01632 960333', email: 'replacement-contact@example.invalid' }, requirements: 'Nominated driver is Casey',
  reviewContact: { phone: '01632 960444', email: 'replacement-review@example.invalid' }, reviewRequirements: 'Please call before delivery', reviewMileage: 6850 };

// One journey from a reset: each chosen input goes in through the page routes and is read back from the order, progress and repository.

async function journey(t, f, label, name, plan, { newOrder }) {
  const step = stepper(t); const seen = {};
  const start = await begin(f, label, [name]); const session = start.sessions[name];
  const ctx = await contextOf(f, session);
  if (newOrder) await makeNewOrderEmployee(f, ctx);
  const e = asEmployee(f, session);
  const stages = await assumption(f, 'ordering.approvalStages.v1');
  const cart = await assumption(f, 'hold.cart.durationSeconds'); const review = await assumption(f, 'hold.cart.orderReview.durationSeconds');
  const lead = (await assumption(f, 'manual.context.v1')).minimumLeadDays;
  check(plan.leadDays > lead, 'the plan chooses a date beyond the minimum lead');
  plan = { ...plan, date: dateAfter(start.now, plan.leadDays) };
  const beforeAccount = value(await e.get('/api/gcsp/manual/account'), 'account before');

  await step(`${label}: the account offers ${newOrder ? 'a new order' : 'a replacement'} and the draft carries every chosen input`, async () => {
    check(beforeAccount.state === 'ready', 'the account is ready');
    same([beforeAccount.actions[0].action, beforeAccount.actions[0].enabled], [newOrder ? 'order' : 'replace', true], 'the permitted action');
    same(beforeAccount.currentContract === null, newOrder, 'a new order has no current contract');
    const claimed = await chooseAndBrowse(f, { session }, plan, label); Object.assign(seen, claimed);
    same(claimed.draft.choices, claimed.choices, 'the saved draft is exactly the chosen inputs');
    same([claimed.draft.draftStage, claimed.draft.draftVersion], ['complete', 1], 'a complete first draft');
    const reread = value(await e.get('/api/gcsp/manual/draft'), 'draft read');
    same([reread.choices, reread.requiresRefresh], [claimed.choices, false], 'the draft reads back unchanged');
  });

  await step(`${label}: the stock page lists the released pool and browsing reserves nothing`, async () => {
    check(seen.stock.browsingReservesStock === false && seen.stock.state === 'available-stock', 'available stock that is not reserved');
    const pool = new Set(start.released.orderUuids);
    check(seen.stock.decisions.length > 0 && seen.stock.decisions.every((row) => pool.has(row.orderUuid)), 'every listed car is from the release tick');
    check((await rows(f, 'stock')).filter((row) => row.state === 'released').length === start.released.orderUuids.length, 'no car was held by browsing');
  });

  await step(`${label}: the claim holds the exact car for the policy preview time`, async () => {
    const claim = value(await e.post('/api/gcsp/manual/claim', { commandId: `${label}-claim`, ...seen.decision.claimInput }), 'claim'); seen.orderUuid = claim.hold.orderUuid;
    same([claim.state, claim.hold.state, claim.hold.phase, claim.hold.expiresAt], ['quoted', 'active', 'preview', addSeconds(start.now, cart)], 'a quoted preview hold');
    check(claim.hold.orderUuid === seen.decision.orderUuid && claim.quote.orderUuid === seen.decision.orderUuid, 'the hold and quote pin the chosen car');
    const car = await stockRow(f, seen.orderUuid);
    same(car.state, 'held', 'the car is held');
    seen.claim = claim;
  });

  await step(`${label}: review begins, the saved details change and the order is read for review`, async () => {
    const claim = seen.claim;
    const begun = value(await e.post('/api/gcsp/manual/claim/review', { commandId: `${label}-review`, holdId: claim.hold.holdId,
      expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion }), 'begin review');
    same([begun.hold.phase, begun.hold.expiresAt], ['order-review', addSeconds(start.now, review)], 'the review phase has its own policy time');
    const details = value(await e.get('/api/gcsp/manual/review-details'), 'review details');
    same([details.reviewDetailsVersion, details.mode, details.requestedCollection, details.editable],
      [0, plan.mode, { date: plan.date, locationId: plan.locationId }, true], 'review shows the requested collection and starts unsaved');
    same(details.details, { contact: plan.contact, expectedReturnMileage: plan.mode === 'replacement' ? plan.mileage : null, specialRequirements: plan.requirements },
      'review starts from the draft inputs');
    const edited = { contact: plan.reviewContact, expectedReturnMileage: plan.mode === 'replacement' ? plan.reviewMileage : null, specialRequirements: plan.reviewRequirements };
    const saved = value(await e.post('/api/gcsp/manual/review-details', { commandId: `${label}-details`, holdId: details.binding.holdId, quoteId: details.binding.quoteId,
      expectedHoldVersion: details.binding.expectedHoldVersion, expectedDraftVersion: details.binding.expectedDraftVersion,
      expectedReviewDetailsVersion: 0, details: edited }), 'save details');
    same([saved.reviewDetailsVersion, saved.details], [1, edited], 'the review save is a new revision of the edited details');
    Object.assign(seen, { edited, begun, binding: details.binding });
  });

  await step(`${label}: submit reaches one acknowledged order, a repeat is the same order`, async () => {
    const terms = value(await e.get('/api/gcsp/manual/order/terms'), 'terms');
    const hold = value(await e.get('/api/gcsp/manual/claim'), 'current claim');
    const car = await stockRow(f, seen.orderUuid);
    const body = { commandId: `${label}-submit`, source: { type: 'cart', holdId: hold.hold.holdId, expectedHoldVersion: hold.hold.version,
      expectedDraftVersion: hold.quote.draftVersion }, expectedQuoteId: hold.quote.quoteId, expectedStockVersion: car.version,
    termsDigest: terms.termsDigest, declarations: declarationsFor(terms, plan.mode), expectedReviewDetailsVersion: 1 };
    same(Object.keys(body.declarations).sort(), newOrder ? ['driver', 'terms'] : ['driver', 'return', 'terms'], 'only the declarations for this mode');
    const [first, second] = await Promise.all([e.post('/api/gcsp/manual/order', body), e.post('/api/gcsp/manual/order', { ...body, commandId: `${label}-double-click` })]);
    const order = value(first, 'submit'); const again = value(second, 'double submit');
    same([order.operationId, order.view, order.order.orderStatus], [again.operationId, { state: 'awaiting-approval', action: 'view-order' }, stages[0]], 'one acknowledged order, awaiting the first approval');
    same([again.order, again.selection], [order.order, order.selection], 'the double submit returns the same order and selection');
    same([order.order.status, order.order.orderNumber, order.order.orderUuid, order.order.fictional], ['confirmed', car.orderNumber, seen.orderUuid, true], 'the order is for the held car');
    Object.assign(seen, { order, terms, body, car });
  });

  await step(`${label}: the order carries the chosen inputs, the review edits and the declarations`, async () => {
    const sel = seen.order.selection;
    same(sel.draft.choices, seen.choices, 'the pinned draft keeps the original choices');
    same([sel.driver.kind, sel.draft.choices.driverId === sel.driver.driverId], [plan.driverKind, true], 'the chosen driver');
    same([sel.draft.choices.contractOptionId, sel.draft.choices.requestedCollectionDate, sel.draft.choices.collectionLocationId],
      [plan.contractOptionId, plan.date, plan.locationId], 'contract option, requested collection date and place');
    same(sel.reviewDetails.details, seen.edited, 'the review-page contact, return mileage and special requirements');
    same([sel.reviewDetails.reviewDetailsVersion, sel.reviewDetails.binding.holdId, sel.reviewDetails.binding.quoteId],
      [1, seen.claim.hold.holdId, seen.claim.quote.quoteId], 'the frozen review details are bound to the held quote');
    same(sel.declarations, declarationsFor(seen.terms, plan.mode), 'the accepted declarations');
    same([sel.terms.termsDigest, sel.quote.quoteId, sel.stock.orderUuid, sel.stock.orderNumber], [seen.terms.termsDigest, seen.claim.quote.quoteId, seen.orderUuid, seen.car.orderNumber],
      'terms, quote and exact car');
    same(sel.oldContract?.contractId ?? null, newOrder ? null : beforeAccount.currentContract.contractId, 'the old contract is the current one, only for a replacement');
    same(sel.terms.approvalStages, stages, 'the approval stages are the policy stages');
  });

  await step(`${label}: the employee's order progress shows this one order from its selection`, async () => {
    const all = value(await e.get('/api/gcsp/orders/progress/all'), 'all progress');
    const mine = all.orders.filter((row) => row.orderUuid === seen.orderUuid);
    same([all.orders.length, mine.length, all.failedCount], [1, 1, 0], 'exactly one order, and nothing failed');
    const row = mine[0];
    same([row.route, row.source.sourceType, row.source.operationId, row.source.orderNumber, row.source.quoteId, row.source.holdId],
      ['manual', 'cart', seen.order.operationId, seen.car.orderNumber, seen.claim.quote.quoteId, seen.claim.hold.holdId], 'the progress is sourced from this selection');
    same([row.stageList, row.currentStage, row.outcome, row.stages[0].state], [['selection received', ...stages], 'selection received', 'in-progress', 'approved'], 'selection received, approval in progress');
    same(row.stages.slice(1).map((s) => s.state), stages.map(() => 'not-started'), 'later stages have not started');
    const single = value(await e.get(`/api/gcsp/orders/progress?orderUuid=${seen.orderUuid}`), 'one progress');
    same([single.orderUuid, single.source.operationId], [seen.orderUuid, seen.order.operationId], 'the single read is the same order');
    seen.progress = row;
  });

  await step(`${label}: handover and return are not requested yet: nothing is confirmed, and the requested date stays the order's own`, async () => {
    const handover = value(await e.get(`/api/gcsp/appointments?orderUuid=${seen.orderUuid}`), 'handover');
    same([handover.state, handover.booked, handover.slot, handover.requestedSlot], ['not-requested', false, null, null], 'no handover time is requested or confirmed');
    const returning = value(await e.get(`/api/gcsp/return-plan?orderUuid=${seen.orderUuid}`), 'return plan');
    if (newOrder) same([returning.applicable], [false], 'a new order has no return of a current car');
    else same([returning.applicable, returning.state, returning.scheduled, returning.oldContractId, returning.currentCar.contractId, returning.location.locationId],
      [true, 'not-planned', false, beforeAccount.currentContract.contractId, beforeAccount.currentContract.contractId, plan.locationId], 'the return of the current car is applicable, unplanned and unscheduled');
    same(seen.order.selection.draft.choices.requestedCollectionDate, plan.date, 'the requested collection date is recorded on the order');
  });

  if (!newOrder) await t.test(`${label}: the return plan carries the return mileage the employee reviewed`, { skip: RETURN_MILEAGE_DEFECT }, async () => {
    const returning = value(await e.get(`/api/gcsp/return-plan?orderUuid=${seen.orderUuid}`), 'return plan');
    same([returning.returnMileage.value, returning.returnMileage.unit], [plan.reviewMileage, 'mi'], 'the reviewed return mileage, not the first draft\'s');
  });

  await step(`${label}: authority holds one selection, one provider receipt and the allocated car; the current contract is untouched`, async () => {
    const ops = (await rows(f, 'pending_operations')).filter((row) => row.operationType === 'selection-order');
    same([ops.length, ops[0].state, ops[0].lastKnownState], [1, 'completed', 'acknowledged'], 'one completed selection');
    same((await rows(f, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).length, 1, 'one provider write');
    const history = (await rows(f, 'event_receipts', { consumerId: `ordering:history:${ctx.employeeId}` })).map((row) => row.eventType).sort();
    same(history, ['selection-acknowledged', 'selection-received'], 'the order history records the selection and its acknowledgement');
    const car = await stockRow(f, seen.orderUuid);
    same([car.state, car.allocated, car.available], ['allocated', true, false], 'the car is allocated to the order');
    same((await rows(f, 'entitlement_slots')).find((row) => row.entitlementSlotId === ctx.entitlementSlotId).state, 'allocated', 'the entitlement is used by the order');
    same((await rows(f, 'holds')).find((row) => row.holdId === seen.claim.hold.holdId).state, 'allocated', 'the hold became the allocation');
    const after = value(await e.get('/api/gcsp/manual/account'), 'account after');
    same([after.currentContract, after.histories], [beforeAccount.currentContract, beforeAccount.histories], 'the current contract and history are unchanged by the order');
    same(after.state, 'no-entitlement', 'ordering is closed to a second order');
    if (!newOrder) same([after.currentContract.returnedDate, after.currentContract.contractEndDate !== plan.date], [null, true], 'the requested date is separate from the current contract end');
  });

  await step(`${label}: a second draft is refused and the order stays the same`, async () => {
    const again = await e.post('/api/gcsp/manual/draft', { commandId: `${label}-second`, expectedDraftVersion: 1,
      expectedContextVersion: seen.account.contextVersion, choices: seen.choices });
    check(again.status !== 200, 'the used entitlement refuses another draft');
    same(value(await e.get('/api/gcsp/manual/order'), 'order read').operationId, seen.order.operationId, 'the order is unchanged');
  });
  return { seen, session, ctx, stages, plan, newOrder, beforeAccount, start };
}

/** After a process reopen the order, its progress and the employee's refused second order read the same from the repository. */
async function readsAfterReopen(f, run, stepName, t) {
  const { seen, session } = run; const step = stepper(t);
  await step(stepName, async () => {
    await f.reopen();
    const e = asEmployee(f, session);
    const order = value(await e.get('/api/gcsp/manual/order'), 'order after reopen');
    same([order.operationId, order.view, order.order, order.selection], [seen.order.operationId, seen.order.view, seen.order.order, seen.order.selection], 'the same acknowledged order');
    const all = value(await e.get('/api/gcsp/orders/progress/all'), 'progress after reopen');
    same(all.orders.map((row) => [row.orderUuid, row.source.operationId, row.currentStage]), [[seen.orderUuid, seen.order.operationId, 'selection received']], 'the same order progress');
    same((await rows(f, 'pending_operations')).filter((row) => row.operationType === 'selection-order').length, 1, 'still one selection');
    same(value(await e.get('/api/gcsp/manual/account'), 'account after reopen').currentContract, run.beforeAccount.currentContract, 'the current contract is still as it was');
  });
}

test('new order, self driver: the chosen inputs reach one acknowledged order and the employee\'s progress, and survive a reopen', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-new-self' });
  const run = await journey(t, f, 'new-self', 'alex', NEW_SELF, { newOrder: true });
  await readsAfterReopen(f, run, 'new-self: process reopen', t);
});

test('replacement, permitted nominated driver: the chosen inputs reach one acknowledged order and the employee\'s progress, and survive a reopen', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-replace-nominated' });
  const run = await journey(t, f, 'replace-nominated', 'paula', REPLACE_NOMINATED, { newOrder: false });
  await readsAfterReopen(f, run, 'replace-nominated: process reopen', t);
});


// ---- The retained difficult cases, each from its own reset on the same launcher composition. ----

const controls = async (f) => value(await f.api('/api/gcsp/presenter/controls'), 'controls');
/** A presenter tick whose outcome the case inspects itself (tickTo insists that every handler succeeds). */
async function tickRaw(f, label, plan) {
  const before = await controls(f);
  return f.api('/api/gcsp/presenter/controls/tick', { body: { commandId: `${label}-tick-${++f.counter}`, expectedClockVersion: before.clockVersion, ...plan } });
}
const setFault = (f, label, adapter, mode) => f.api('/api/gcsp/presenter/scenarios/faults', { body: { commandId: `${label}-fault-${++f.counter}`, adapter, mode } });
/** The plan every difficult case starts from: a replacement by the employee, dated beyond the minimum lead. */
const basePlan = (now) => ({ ...REPLACE_NOMINATED, driverKind: 'employee', date: dateAfter(now, 14), contractOptionId: 'six-month-8000' });

async function claimCar(e, label, decision) {
  return e.post('/api/gcsp/manual/claim', { commandId: `${label}-claim`, ...decision.claimInput });
}
/** Begins review on the held car and saves the review details once; returns the bindings a submit needs. */
async function reviewAndSave(e, label, claim) {
  const begun = value(await e.post('/api/gcsp/manual/claim/review', { commandId: `${label}-review`, holdId: claim.hold.holdId,
    expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion }), 'begin review');
  const details = value(await e.get('/api/gcsp/manual/review-details'), 'review details');
  const saved = value(await e.post('/api/gcsp/manual/review-details', { commandId: `${label}-details`, holdId: details.binding.holdId,
    quoteId: details.binding.quoteId, expectedHoldVersion: details.binding.expectedHoldVersion, expectedDraftVersion: details.binding.expectedDraftVersion,
    expectedReviewDetailsVersion: 0, details: details.details }), 'save details');
  return { begun, details, saved };
}
/** The submit body from the employee's current claim, terms and stock; `over` changes one field to make it stale. */
async function submitBody(f, e, label, mode, over = {}) {
  const terms = value(await e.get('/api/gcsp/manual/order/terms'), 'terms');
  const current = value(await e.get('/api/gcsp/manual/claim'), 'current claim');
  const car = await stockRow(f, current.hold.orderUuid);
  return { commandId: `${label}-submit`, source: { type: 'cart', holdId: current.hold.holdId, expectedHoldVersion: current.hold.version,
    expectedDraftVersion: current.quote.draftVersion }, expectedQuoteId: current.quote.quoteId, expectedStockVersion: car.version,
  termsDigest: terms.termsDigest, declarations: declarationsFor(terms, mode), expectedReviewDetailsVersion: 1, ...over };
}
const selections = async (f) => (await rows(f, 'pending_operations')).filter((row) => row.operationType === 'selection-order');

test('no HR account, an unsupported scheme and a disabled entitlement each stop ordering at the account, before any draft or claim', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-no-account' });
  const start = await begin(f, 'no-account', ['paula', 'sam']);
  const refused = async (e, note) => {
    const draft = await e.post('/api/gcsp/manual/draft', { commandId: `${note}-draft`, expectedDraftVersion: 0, expectedContextVersion: 'none',
      choices: { mode: 'replacement' } });
    check(draft.status >= 400, `${note}: a draft is refused`);
    check((await e.get('/api/gcsp/manual/stock')).status >= 400, `${note}: the stock page is refused`);
    check((await e.post('/api/gcsp/manual/claim', { commandId: `${note}-claim`, orderUuid: 'none', expectedStockVersion: 1, expectedDraftVersion: 1,
      expectedContextVersion: 'none', expectedTermsDigest: 'none' })).status >= 400, `${note}: a claim is refused`);
  };
  await t.test('no HR account: an employee the presenter switched to without the backend preparation has no account to order from', async () => {
    const alex = await f.services.identity.switchPrincipal(f.context, 'demo-alex', 'no-account-alex-raw');
    const session = [good(alex).setCookie].flat().map((entry) => entry.split(';')[0]).join('; ');
    const e = asEmployee(f, session);
    const account = value(await e.get('/api/gcsp/manual/account'), 'account');
    same([account.state, account.account, account.actions, account.view.action], ['absent-hr-account', null, [], 'contact-support'], 'an absent HR account is its own state');
    await refused(e, 'absent-hr');
  });
  await t.test('unsupported scheme: a scheme that is not enabled for manual ordering offers no action', async () => {
    const e = asEmployee(f, start.sessions.sam);
    const account = value(await e.get('/api/gcsp/manual/account'), 'account');
    same([account.state, account.actions, account.view.editable], ['unsupported-scheme', [], false], 'the scheme is shown as unsupported');
    await refused(e, 'unsupported');
  });
  await t.test('no entitlement: a disabled slot stops ordering and the stock page', async () => {
    const e = asEmployee(f, start.sessions.paula);
    const ctx = await contextOf(f, start.sessions.paula);
    check(value(await e.get('/api/gcsp/manual/account'), 'account').state === 'ready', 'the account starts ready');
    await edit(f, ctx, 'entitlement_slots', { entitlementSlotId: ctx.entitlementSlotId }, { state: 'disabled' }, 'disable-slot');
    const account = value(await e.get('/api/gcsp/manual/account'), 'account');
    same([account.state, account.actions], ['no-entitlement', []], 'no entitlement is its own state');
    await refused(e, 'no-entitlement');
    check((await selections(f)).length === 0, 'no selection was created');
  });
});

async function gregSession(f, label) {
  const switched = await f.api('/api/gcsp/session/switch', { body: { principalId: 'demo-greg', commandId: `${label}-as-greg` } });
  check(switched.status === 200, 'the presenter can switch to the ordering lead');
  return switched.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
}

test('no stock and a stock source outage read differently, the outage keeps the release window, and the retry releases it', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-no-stock' });
  const start = await begin(f, 'no-stock', ['paula'], { release: false });
  const greg = await gregSession(f, 'no-stock');
  const walk = await chooseAndBrowse(f, { session: start.sessions.paula }, basePlan((await controls(f)).now), 'no-stock', { claimable: false });
  const step = stepper(t);
  const source = async () => value(await f.api('/api/gcsp/greg/demand', { session: greg }), 'demand').stock.source.status;
  const windows = (await assumption(f, 'supply.release.windows')).windows;

  await step('no stock: before any release the pool is empty, nothing is claimable and no source check has run', async () => {
    same([walk.stock.state, walk.stock.total, walk.stock.decisions.length, walk.stock.view.action], ['empty-stock', 0, 0, 'retry-or-contact-support'], 'an empty pool');
    same(walk.stock.releaseHistory.history.releaseCount, 0, 'no release has happened');
    same(await source(), 'not-checked', 'the stock source has not been checked');
  });

  await step('outage: a failed pull is unavailable, not zero; the employee still sees nothing and no window is released', async () => {
    check((await setFault(f, 'no-stock', 'stock', 'unavailable')).status === 200, 'the presenter sets the stock outage');
    const tick = await tickRaw(f, 'no-stock', { mode: 'next-release' });
    same([tick.status, tick.json.status], [503, 'unavailable'], 'the release tick reports the outage');
    const stock = value(await walk.e.get('/api/gcsp/manual/stock'), 'stock during outage');
    same([stock.state, stock.decisions.length], ['empty-stock', 0], 'nothing is claimable during the outage');
    same(await source(), 'unavailable', 'the source reads unavailable, which the empty pool does not');
    same((await rows(f, 'stock')).filter((row) => row.release).length, 0, 'no window was released');
    same((await controls(f)).controls.nextRelease.status, 'unavailable', 'the cue time has passed');
  });

  await step('retry: with the outage cleared the next tick releases the first window and the employee can claim from it', async () => {
    check((await setFault(f, 'no-stock', 'stock', 'none')).status === 200, 'the presenter clears the outage');
    const tick = await tickTo(f, 'no-stock', { mode: 'step' });
    const released = tick.outcome('stock-release');
    same([released.kind, released.windowId, released.orderUuids.length], ['stock-released', windows[0].windowId, windows[0].cars.length], 'the first window is released');
    const stock = value(await walk.e.get('/api/gcsp/manual/stock'), 'stock after retry');
    same(stock.state, 'available-stock', 'stock is now available');
    same(await source(), 'ok', 'the source reads current again');
    const decision = stock.decisions.find((row) => row.claimInput);
    const claim = value(await claimCar(walk.e, 'no-stock', decision), 'claim after retry');
    same([claim.state, claim.hold.orderUuid], ['quoted', decision.orderUuid], 'the employee holds a car from the retried window');
  });
});

test('stock contention: the second employee cannot take a held car, sees it unavailable, and takes it once it is released', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-contention' });
  const start = await begin(f, 'contention', ['paula', 'alex']);
  const plan = basePlan(start.now);
  const paula = await chooseAndBrowse(f, { session: start.sessions.paula }, plan, 'paula');
  const alex = await chooseAndBrowse(f, { session: start.sessions.alex }, plan, 'alex');
  const car = paula.decision.orderUuid;
  const alexInput = alex.stock.decisions.find((row) => row.orderUuid === car)?.claimInput;
  const step = stepper(t);
  check(alexInput, 'both employees were offered the same car');

  await step('both are offered the car; Paula claims it first', async () => {
    const claim = value(await claimCar(paula.e, 'paula', paula.decision), 'paula claim');
    same([claim.hold.orderUuid, (await stockRow(f, car)).state], [car, 'held'], 'Paula holds the car');
    paula.claimed = claim;
  });

  await step('Alex\'s claim on the same car is refused with nothing held; his page now marks it unavailable', async () => {
    const refusal = await alex.e.post('/api/gcsp/manual/claim', { commandId: 'alex-claim', ...alexInput });
    same([refusal.status, refusal.json.status, refusal.json.reason], [409, 'conflict', 'car-not-eligible-or-available'], 'the held car cannot be claimed twice');
    same((await rows(f, 'holds')).filter((row) => row.employeeId === 'employee-alex').length, 0, 'Alex holds nothing');
    same((await rows(f, 'holds')).filter((row) => row.orderUuid === car && row.state === 'active').length, 1, 'the car has exactly one active hold');
    const again = value(await alex.e.get('/api/gcsp/manual/stock'), 'alex stock');
    const row = again.decisions.find((entry) => entry.orderUuid === car);
    same([row.gateStatus, row.blockers.map((b) => b.code), row.claimInput], ['ineligible', ['not-available'], null], 'the held car is unavailable to Alex');
  });

  await step('Alex takes another car, and both employees hold different cars', async () => {
    const other = value(await alex.e.get('/api/gcsp/manual/stock'), 'alex stock').decisions.find((row) => row.claimInput);
    const claim = value(await claimCar(alex.e, 'alex-other', other), 'alex claim');
    check(claim.hold.orderUuid !== car, 'a different car');
    same((await rows(f, 'holds')).filter((row) => row.state === 'active').map((row) => row.employeeId).sort(), ['employee-alex', 'employee-paula'], 'one active hold each');
  });

  await step('Paula releases her car; it returns to the pool and a fresh page lets Alex see it claimable', async () => {
    const hold = paula.claimed.hold;
    value(await paula.e.post('/api/gcsp/manual/claim/release', { commandId: 'paula-release', holdId: hold.holdId, expectedHoldVersion: hold.version,
      expectedDraftVersion: paula.claimed.quote.draftVersion, reason: 'cancel' }), 'release');
    same((await stockRow(f, car)).state, 'released', 'the car is back in the released pool');
    const row = value(await paula.e.get('/api/gcsp/manual/stock'), 'paula stock').decisions.find((entry) => entry.orderUuid === car);
    same([row.gateStatus, Boolean(row.claimInput)], ['eligible', true], 'the car is claimable again');
    same(value(await paula.e.get('/api/gcsp/manual/account'), 'account').state, 'ready', 'Paula keeps her entitlement');
  });
});

test('stale draft, stale quote and stale terms are refused without a selection, and the hold stays usable', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-stale' });
  const start = await begin(f, 'stale', ['paula']);
  const walk = await chooseAndBrowse(f, { session: start.sessions.paula }, basePlan(start.now), 'stale');
  const { e } = walk; const step = stepper(t);

  await step('a held car freezes the draft: any draft change must release first', async () => {
    walk.claim = value(await claimCar(e, 'stale', walk.decision), 'claim');
    const changed = await e.post('/api/gcsp/manual/draft', { commandId: 'stale-draft-2', expectedDraftVersion: 1, expectedContextVersion: walk.account.contextVersion,
      choices: { ...walk.choices, specialRequirements: 'changed while held' } });
    same([changed.status, changed.json.reason], [409, 'release-required'], 'the draft cannot change under a hold');
  });

  await step('after release and a new draft, the earlier claim input is a stale draft', async () => {
    const hold = walk.claim.hold;
    value(await e.post('/api/gcsp/manual/claim/release', { commandId: 'stale-release', holdId: hold.holdId, expectedHoldVersion: hold.version,
      expectedDraftVersion: walk.claim.quote.draftVersion, reason: 'change' }), 'release');
    const saved = value(await e.post('/api/gcsp/manual/draft', { commandId: 'stale-draft-3', expectedDraftVersion: 1, expectedContextVersion: walk.account.contextVersion,
      choices: { ...walk.choices, specialRequirements: 'new draft' } }), 'new draft');
    same(saved.draftVersion, 2, 'a second draft');
    const stale = await e.post('/api/gcsp/manual/claim', { commandId: 'stale-claim-old', ...walk.decision.claimInput });
    same([stale.status, stale.json.status, stale.json.resource, stale.json.expectedVersion, stale.json.currentVersion], [409, 'stale-version', 'manual-draft', 1, 2], 'the old draft pin is refused');
    same((await rows(f, 'holds')).filter((row) => row.state === 'active').length, 0, 'no hold was made by the stale input');
  });

  await step('a fresh page pins the new draft; a submit with the earlier quote, earlier draft or earlier terms is refused', async () => {
    const decision = value(await e.get('/api/gcsp/manual/stock'), 'fresh stock').decisions.find((row) => row.claimInput);
    same(decision.claimInput.expectedDraftVersion, 2, 'the fresh page pins draft 2');
    const claim = value(await claimCar(e, 'stale-fresh', decision), 'fresh claim');
    await reviewAndSave(e, 'stale-fresh', claim);
    const good = await submitBody(f, e, 'stale', 'replacement');
    const refusals = [
      ['an earlier quote', { expectedQuoteId: walk.claim.quote.quoteId }, 'conflict', 'quote-changed'],
      ['an earlier draft', { source: { ...good.source, expectedDraftVersion: 1 } }, 'conflict', 'draft-review-required'],
      ['earlier terms', { termsDigest: 'terms-from-an-earlier-version' }, 'conflict', 'terms-changed'],
      ['an earlier hold', { source: { ...good.source, expectedHoldVersion: good.source.expectedHoldVersion - 1 } }, 'stale-version', undefined],
    ];
    for (const [name, over, status, reason] of refusals) {
      const refused = await e.post('/api/gcsp/manual/order', { ...good, commandId: `stale-${name}`, ...over });
      same([refused.status, refused.json.status, refused.json.reason], [409, status, reason], `${name} is refused for review`);
    }
    same((await selections(f)).length, 0, 'no selection was created by any stale submit');
    const current = value(await e.get('/api/gcsp/manual/claim'), 'claim after refusals');
    same([current.state, current.hold.holdId], ['quoted', claim.hold.holdId], 'the hold is still held and usable');
    same(value(await e.post('/api/gcsp/manual/order', good), 'correct submit').view.state, 'awaiting-approval', 'the correct submit still succeeds');
  });
});

test('short hold expiry: ticks past the preview and the order-review holds return the car, refuse review and submit, and let the employee start again', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-expiry' });
  const start = await begin(f, 'expiry', ['paula']);
  const walk = await chooseAndBrowse(f, { session: start.sessions.paula }, basePlan(start.now), 'expiry');
  const { e } = walk; const step = stepper(t);
  const lapse = async (hold) => {
    const tick = await tickTo(f, 'expiry', { mode: 'to', to: hold.expiresAt });
    same(tick.now, hold.expiresAt, 'the clock stands at the hold deadline');
    check(tick.outcome('manual-claim-expiry'), 'the manual expiry handler ran in the tick');
  };

  await step('preview hold: a tick at its deadline expires it and returns the car; review on the old hold is refused', async () => {
    const claim = value(await claimCar(e, 'expiry-one', walk.decision), 'claim');
    await lapse(claim.hold);
    const current = value(await e.get('/api/gcsp/manual/claim'), 'claim after expiry');
    same([current.state, current.hold.state], ['expired', 'expired'], 'the claim reads expired');
    same((await stockRow(f, claim.hold.orderUuid)).state, 'released', 'the car is back in the pool');
    const review = await e.post('/api/gcsp/manual/claim/review', { commandId: 'expiry-late-review', holdId: claim.hold.holdId,
      expectedHoldVersion: claim.hold.version, expectedDraftVersion: claim.quote.draftVersion });
    same([review.status, review.json.status], [409, 'stale-version'], 'review on an expired hold is refused');
    same(value(await e.get('/api/gcsp/manual/account'), 'account').state, 'ready', 'the entitlement is not used');
  });

  await step('order-review hold: after the late tick the submit built before it, and the review edit, are refused; no selection exists', async () => {
    const fresh = value(await e.get('/api/gcsp/manual/stock'), 'fresh stock').decisions.find((row) => row.claimInput);
    const claim = value(await claimCar(e, 'expiry-two', fresh), 'second claim');
    same(claim.hold.expiresAt, addSeconds((await controls(f)).now, await assumption(f, 'hold.cart.durationSeconds')), 'a new hold with its own policy deadline from the new time');
    const saved = await reviewAndSave(e, 'expiry-two', claim);
    const body = await submitBody(f, e, 'expiry-two', 'replacement');
    await lapse(saved.begun.hold);
    const edit = await e.post('/api/gcsp/manual/review-details', { commandId: 'expiry-late-details', holdId: saved.details.binding.holdId,
      quoteId: saved.details.binding.quoteId, expectedHoldVersion: saved.details.binding.expectedHoldVersion,
      expectedDraftVersion: saved.details.binding.expectedDraftVersion, expectedReviewDetailsVersion: 1, details: saved.saved.details });
    check(edit.status >= 400, `a review edit after expiry is refused: ${brief(edit)}`);
    const submit = await e.post('/api/gcsp/manual/order', body);
    same([submit.status, submit.json.status], [409, 'conflict'], 'a submit after expiry is refused for review');
    same((await selections(f)).length, 0, 'no selection was created');
    same((await stockRow(f, claim.hold.orderUuid)).state, 'released', 'the car is back in the pool again');
  });

  await step('the employee can claim, review and submit again from the same draft after both lapses', async () => {
    const fresh = value(await e.get('/api/gcsp/manual/stock'), 'fresh stock').decisions.find((row) => row.claimInput);
    const claim = value(await claimCar(e, 'expiry-three', fresh), 'third claim');
    await reviewAndSave(e, 'expiry-three', claim);
    const order = value(await e.post('/api/gcsp/manual/order', await submitBody(f, e, 'expiry-three', 'replacement')), 'submit');
    same([order.view.state, order.order.orderUuid], ['awaiting-approval', claim.hold.orderUuid], 'the retry is acknowledged');
  });
});

test('a quote that lapses inside its hold is refused at submit; releasing and claiming again gives a fresh quote', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-quote-lapse', edit: (seed, byKey) => { byKey('employee.recommendation.v1').value.termValiditySeconds = 150; } });
  const start = await begin(f, 'quote-lapse', ['paula']);
  const walk = await chooseAndBrowse(f, { session: start.sessions.paula }, basePlan(start.now), 'quote-lapse');
  const { e } = walk; const step = stepper(t); const review = await assumption(f, 'hold.cart.orderReview.durationSeconds');

  await step('the quote lapses while the order-review hold is still active: review is expired and submit is refused', async () => {
    const claim = value(await claimCar(e, 'quote-one', walk.decision), 'claim');
    same(claim.quote.validUntil, addSeconds(start.now, 150), 'the quote is valid for the policy term');
    const saved = await reviewAndSave(e, 'quote-one', claim);
    check(150 < review, 'the policy quote term is shorter than the review hold');
    const body = await submitBody(f, e, 'quote-one', 'replacement');
    const tick = await tickTo(f, 'quote-lapse', { mode: 'to', to: addSeconds(start.now, 151) });
    check(Date.parse(tick.now) < Date.parse(saved.begun.hold.expiresAt), 'the hold has not expired');
    const hold = value(await e.get('/api/gcsp/manual/claim'), 'claim');
    same([hold.state, hold.hold.state], ['quoted', 'active'], 'the hold is still active');
    const details = value(await e.get('/api/gcsp/manual/review-details'), 'review details');
    same([details.editable, details.view.state, details.canContinue], [false, 'expired', false], 'the review page reads the quote as expired');
    const refused = await e.post('/api/gcsp/manual/order', body);
    same([refused.status, refused.json.status, refused.json.reason], [409, 'conflict', 'quote-expired'], 'the lapsed quote cannot be ordered');
    same((await selections(f)).length, 0, 'no selection was created');
  });

  await step('release and a fresh claim give a fresh quote that can be ordered', async () => {
    const current = value(await e.get('/api/gcsp/manual/claim'), 'claim');
    value(await e.post('/api/gcsp/manual/claim/release', { commandId: 'quote-release', holdId: current.hold.holdId, expectedHoldVersion: current.hold.version,
      expectedDraftVersion: current.quote.draftVersion, reason: 'change' }), 'release');
    const fresh = value(await e.get('/api/gcsp/manual/stock'), 'fresh stock').decisions.find((row) => row.claimInput);
    const claim = value(await claimCar(e, 'quote-two', fresh), 'second claim');
    check(claim.quote.quoteId !== current.quote.quoteId && Date.parse(claim.quote.validUntil) > Date.parse(current.quote.validUntil), 'a new quote with a later term');
    await reviewAndSave(e, 'quote-two', claim);
    same(value(await e.post('/api/gcsp/manual/order', await submitBody(f, e, 'quote-two', 'replacement')), 'submit').view.state, 'awaiting-approval', 'the fresh quote is ordered');
  });
});

/** Claim, review and save details for one employee, then build the submit and return what the lost-response cases read back. */
async function readyToSubmit(f, label, name) {
  const start = await begin(f, label, [name]);
  const walk = await chooseAndBrowse(f, { session: start.sessions[name] }, basePlan(start.now), label);
  const claim = value(await claimCar(walk.e, label, walk.decision), 'claim');
  await reviewAndSave(walk.e, label, claim);
  return { start, walk, claim, e: walk.e, session: start.sessions[name], body: await submitBody(f, walk.e, label, 'replacement') };
}
const providerWrites = async (f) => (await rows(f, 'event_receipts', { consumerId: 'synthetic-ordering:v1' })).length;

/** Submits under the lost-response fault and returns the pending selection's operation id. */
async function submitLost(f, run, label, mode) {
  check((await setFault(f, label, 'ordering', mode)).status === 200, 'the presenter sets the lost-response fault');
  const lost = await run.e.post('/api/gcsp/manual/order', run.body);
  same([lost.status, lost.json.status], [202, 'pending'], 'the submit is pending');
  const view = lost.json.value;
  same([view.view.state, view.order, view.operationState], ['handoff-pending', null, 'unknown'], 'no order is confirmed or invented');
  same(await providerWrites(f), 1, 'the provider recorded exactly one write');
  const read = await run.e.get('/api/gcsp/manual/order');
  same([read.json.status, read.json.value.order], ['pending', null], 'the order read agrees');
  same(value(await run.e.get('/api/gcsp/orders/progress/all'), 'progress').orders.length, 0, 'no order progress exists before an acknowledgement');
  same((await selections(f)).map((row) => [row.state, row.lastKnownState]), [['pending', 'unknown']], 'one pending selection');
  return view.operationId;
}

test('lost provider response: the order stays pending until one presenter tick reconciles it from the provider receipt, with no second write', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-lost-response' });
  const run = await readyToSubmit(f, 'lost', 'paula'); const stages = await assumption(f, 'ordering.approvalStages.v1');
  const orderUuid = run.claim.hold.orderUuid;
  const operationId = await submitLost(f, run, 'lost', 'timeout-acknowledged');
  const tick = await tickTo(f, 'lost', { mode: 'step' });
  same(tick.outcome('selection-order-reconciliation').reconciled, 1, 'the reconciliation handler found the one pending selection');
  const order = value(await run.e.get('/api/gcsp/manual/order'), 'order after tick');
  same([order.operationId, order.view.state, order.order.orderStatus, order.order.orderUuid], [operationId, 'awaiting-approval', stages[0], orderUuid], 'the same operation is acknowledged');
  same(order.order.orderNumber, (await stockRow(f, orderUuid)).orderNumber, 'the order number is the stock order number');
  same(await providerWrites(f), 1, 'reconciliation did not write again');
  const all = value(await run.e.get('/api/gcsp/orders/progress/all'), 'progress after tick');
  same(all.orders.map((row) => [row.orderUuid, row.source.operationId]), [[orderUuid, operationId]], 'the order progress lists the order');
  same([(await stockRow(f, orderUuid)).state, (await selections(f))[0].state], ['allocated', 'completed'], 'the car is allocated and the selection complete');
});

test('lost provider response, process reopen: the restarted process reconciles the pending order from the provider receipt and does not resend', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-lost-reopen' });
  const run = await readyToSubmit(f, 'reopen', 'paula'); const orderUuid = run.claim.hold.orderUuid;
  const operationId = await submitLost(f, run, 'reopen', 'timeout-acknowledged');
  await f.reopen();
  const order = value(await asEmployee(f, run.session).get('/api/gcsp/manual/order'), 'order after reopen');
  same([order.operationId, order.view.state, order.order.orderUuid], [operationId, 'awaiting-approval', orderUuid], 'startup reconciliation acknowledged the same order');
  same(await providerWrites(f), 1, 'the restart did not resend to the provider');
  same((await selections(f)).map((row) => row.state), ['completed'], 'one completed selection');
  const tick = await tickTo(f, 'reopen', { mode: 'step' });
  same(tick.outcome('selection-order-reconciliation').reconciled, 0, 'a following presenter tick has nothing left to reconcile');
  same(value(await asEmployee(f, run.session).get('/api/gcsp/orders/progress/all'), 'progress').orders.map((row) => row.source.operationId), [operationId], 'the order progress lists the order');
});

test('lost provider response that was a rejection: reconciliation fails the order visibly, invents no order and keeps the allocation attached', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-lost-rejected' });
  const run = await readyToSubmit(f, 'rejected', 'paula'); const orderUuid = run.claim.hold.orderUuid;
  const operationId = await submitLost(f, run, 'rejected', 'timeout-rejected');
  const tick = await tickTo(f, 'rejected', { mode: 'step' });
  same(tick.outcome('selection-order-reconciliation').reconciled, 1, 'the one pending selection was reconciled');
  const read = value(await run.e.get('/api/gcsp/manual/order'), 'order after tick');
  same([read.operationId, read.view, read.order, read.operationState, read.progress.selectionState],
    [operationId, { state: 'handoff-failed', action: 'contact-support' }, null, 'handoff-failed', 'handoff-failed'], 'the order is failed for support, not confirmed');
  same([read.failure.status, read.failure.reason, read.failure.orderUuid], ['rejected', 'synthetic-ordering-refused', orderUuid], 'the provider refusal is recorded');
  same(value(await run.e.get('/api/gcsp/orders/progress/all'), 'progress').orders.length, 0, 'no order progress exists for a refused order');
  same(await providerWrites(f), 1, 'one provider write');
  same((await rows(f, 'event_receipts', { consumerId: 'ordering:history:employee-paula' })).map((row) => row.eventType).sort(), ['selection-handoff-failed', 'selection-received'], 'the history records the failure');
  // The documented conservative rule (manual-order-contract.md): a failed handoff keeps the allocation attached to the entitlement.
  same([(await stockRow(f, orderUuid)).state, (await rows(f, 'entitlement_slots')).find((row) => row.entitlementSlotId === 'slot-paula').state], ['allocated', 'allocated'], 'the allocation stays attached');
});

test('unknown essentials: an unconfirmed insurance group and licence stop the claim and the draft, and unconfirmed terms stop the order', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-unknowns' });
  const start = await begin(f, 'unknowns', ['paula']); const step = stepper(t);
  const session = start.sessions.paula; const ctx = await contextOf(f, session);
  const walk = await chooseAndBrowse(f, { session }, basePlan(start.now), 'unknowns');
  const { e } = walk; const target = walk.decision.orderUuid;

  await step('an unconfirmed insurance group makes that car need confirmation: no claim input, and a forged claim is refused', async () => {
    await edit(f, ctx, 'stock', { orderUuid: target }, (row) => ({ facts: { ...row.facts, facts: { ...row.facts.facts,
      insuranceGroup: { ...row.facts.facts.insuranceGroup, status: 'unknown', value: null,
        provenance: { ...row.facts.facts.insuranceGroup.provenance, assurance: 'unknown' } } } } }), 'unknown-insurance');
    const page = value(await e.get('/api/gcsp/manual/stock'), 'stock');
    const row = page.decisions.find((entry) => entry.orderUuid === target);
    same([row.gateStatus, row.claimInput, row.unknowns.map((u) => u.code), row.view.action], ['needs-confirmation', null, ['insurance-unconfirmed'], 'request-confirmation'], 'the car needs confirmation');
    const forged = await e.post('/api/gcsp/manual/claim', { commandId: 'unknowns-forged', ...walk.decision.claimInput });
    check(forged.status >= 400, `a claim with the old pins is refused: ${brief(forged)}`);
    same((await rows(f, 'holds')).length, 0, 'no hold was made');
    check(page.decisions.some((entry) => entry.orderUuid !== target && entry.claimInput), 'other cars are still claimable');
  });

  await step('an unconfirmed driver licence stops a draft that names that driver, while the confirmed driver still saves', async () => {
    await edit(f, ctx, 'employees', { employeeId: ctx.employeeId }, (row) => {
      const manualContext = structuredClone(row.contract.manualContext);
      delete manualContext.drivers.find((driver) => driver.kind === 'nominated').licence.source;
      return { contract: { ...row.contract, manualContext } };
    }, 'unknown-licence');
    const account = value(await e.get('/api/gcsp/manual/account'), 'account');
    const nominated = account.choices.drivers.find((driver) => driver.kind === 'nominated');
    const refused = await e.post('/api/gcsp/manual/draft', { commandId: 'unknowns-nominated', expectedDraftVersion: 1, expectedContextVersion: account.contextVersion,
      choices: { ...walk.choices, driverId: nominated.driverId } });
    same([refused.status, refused.json.status, refused.json.code], [400, 'invalid', 'licence-unconfirmed'], 'the unconfirmed licence is refused as invalid');
    same(refused.json.reasons.map((r) => r.field), ['driverId'], 'the reason names the driver field');
    const kept = value(await e.post('/api/gcsp/manual/draft', { commandId: 'unknowns-employee', expectedDraftVersion: 1, expectedContextVersion: account.contextVersion,
      choices: { ...walk.choices, specialRequirements: 'saved with the confirmed driver' } }), 'draft with the confirmed driver');
    same([kept.draftVersion, kept.draftStage], [2, 'complete'], 'the confirmed driver still saves');
  });

  await step('a held car whose terms digest differs from the page is refused as changed terms; no selection is created', async () => {
    const page = value(await e.get('/api/gcsp/manual/stock'), 'stock');
    const decision = page.decisions.find((entry) => entry.claimInput);
    const claim = value(await claimCar(e, 'unknowns-terms', decision), 'claim');
    await reviewAndSave(e, 'unknowns-terms', claim);
    const refused = await e.post('/api/gcsp/manual/order', await submitBody(f, e, 'unknowns', 'replacement', { termsDigest: 'unconfirmed-terms' }));
    same([refused.status, refused.json.reason, refused.json.view.state], [409, 'terms-changed', 'review-required'], 'unconfirmed terms stop the order for review');
    same((await selections(f)).length, 0, 'no selection was created');
  });
});

test('unavailable ordering terms: with no ordering terms policy the terms and submit fail closed and nothing is ordered', { timeout: 120000 }, async (t) => {
  const f = await boot(t, { environmentId: 'manual-no-terms', edit: (seed) => { seed.assumptions = seed.assumptions.filter((row) => row.key !== 'ordering.terms.v1'); } });
  const start = await begin(f, 'no-terms', ['paula']);
  const walk = await chooseAndBrowse(f, { session: start.sessions.paula }, basePlan(start.now), 'no-terms');
  const claim = value(await claimCar(walk.e, 'no-terms', walk.decision), 'claim');
  await reviewAndSave(walk.e, 'no-terms', claim);
  const terms = await walk.e.get('/api/gcsp/manual/order/terms');
  same([terms.status, terms.json.status], [503, 'unavailable'], 'the terms are unavailable');
  const current = value(await walk.e.get('/api/gcsp/manual/claim'), 'current claim');
  const submit = await walk.e.post('/api/gcsp/manual/order', { commandId: 'no-terms-submit', source: { type: 'cart', holdId: current.hold.holdId,
    expectedHoldVersion: current.hold.version, expectedDraftVersion: current.quote.draftVersion }, expectedQuoteId: current.quote.quoteId,
  expectedStockVersion: (await stockRow(f, current.hold.orderUuid)).version, termsDigest: 'no-terms', declarations: { terms: true, driver: true, return: true },
  expectedReviewDetailsVersion: 1 });
  same([submit.status, submit.json.status], [503, 'unavailable'], 'a submit without terms fails closed');
  same((await selections(f)).length, 0, 'no selection was created');
});
