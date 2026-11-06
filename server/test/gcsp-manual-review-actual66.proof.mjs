// Explicit source-overlay proof. Never execute without its reviewed supervisor/loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMemoryRepository, createMemoryStore, inputDigest, OCCUPYING_STATES } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { ManualContextService, createRepositoryManualPorts } from '../gcsp/manual-context/index.js';
import { createManualContextRoutes } from '../gcsp/manual-context/http.js';
import { ManualClaimsService } from '../gcsp/manual-claims/index.js';
import { createManualClaimsRoutes } from '../gcsp/manual-claims/http.js';
import { createSyntheticManualStockAdapter } from '../gcsp/adapters/manual-stock.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { ManualReviewDetailsService } from '../gcsp/manual-review/index.js';
import { createManualReviewDetailsRoutes } from '../gcsp/manual-review/http.js';
import { createManualGalleryHttpAdapter } from '../../blocks/gcsp/manual-gallery/http-adapter.js';
import { createManualClaimController, isConfirmedManualClaim } from '../../blocks/gcsp/manual-gallery/claim-controller.js';
import { toManualCar } from '../../blocks/gcsp/manual-gallery/gallery-model.js';
import { createManualReviewHttpAdapter } from '../../blocks/gcsp/manual-review/http-adapter.js';
import { createManualReviewController } from '../../blocks/gcsp/manual-review/review-controller.js';
import { stock, fact } from './helpers/employee-recommendation.js';

if (!process.env.FUCQ70_PROOF_CONFIG) throw new Error('Run only through the admitted exact-source supervisor.');
const ORIGIN = 'https://gcsp-proof.invalid';
const AS_OF = '2026-11-05T09:00:00.000Z'; // Frozen synthetic fixture date, not wall-clock time.
const copy = (value) => structuredClone(value);
const rowRef = (context, table, key = {}) => ({ table, key: { runId: context.runId, ...key } });
const command = (commandId, payload = {}) => ({ commandId, inputDigest: inputDigest(payload) });
let setupCount = 0;
test.after(() => { assert.equal(setupCount, 8, 'The admitted proof contains exactly eight runtime setups'); console.log('FUCQ70_SETUPS=8'); });
const cookieOf = (issued) => issued.setCookie.split(';')[0];
const expectOk = (outcome) => { assert.equal(outcome.status, 'ok', `Actual service refused: ${outcome.status}:${outcome.code ?? outcome.reason ?? ''}`); return outcome.value; };
const posts = (f, path) => f.transport.records.filter((r) => r.method === 'POST' && r.path === `/api/gcsp/manual/${path}`);
const table = (f, name) => f.store.state.tables[name];
const exactRows = (f, name) => table(f, name).filter((r) => r.orderUuid === f.car.orderUuid);
function oneClaim(f) {
  assert.equal(exactRows(f, 'holds').length, 1);
  assert.equal(exactRows(f, 'claims').length, 1);
  assert.equal(exactRows(f, 'quotes').length, 1);
}
function occupancy(f, occupied) {
  oneClaim(f);
  assert.equal(exactRows(f, 'holds').filter((r) => OCCUPYING_STATES.includes(r.state)).length, occupied ? 1 : 0);
  assert.equal(exactRows(f, 'claims').filter((r) => OCCUPYING_STATES.includes(r.state)).length, occupied ? 1 : 0);
  const car = table(f, 'stock').find((r) => r.orderUuid === f.car.orderUuid);
  assert.equal(car.held, occupied); assert.equal(car.available, !occupied);
}
function stableDomain(f) {
  return copy(Object.fromEntries(['stock', 'holds', 'claims', 'quotes'].map((name) => [name, table(f, name)])));
}

// This transport invokes the real authenticated handler; it never synthesises an outcome.
function transportFor(handler, cookie) {
  const transport = { records: [], after: null };
  transport.fetchAs = (overrides = {}) => async (input, options = {}) => {
    const url = new URL(input, ORIGIN);
    assert.equal(url.origin, ORIGIN); assert.equal(options.credentials, 'include');
    const req = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
    req.method = options.method ?? 'GET';
    req.headers = { origin: overrides.origin ?? ORIGIN, cookie: overrides.cookie ?? cookie };
    const headers = {}; let captured = null;
    const res = { setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(status, values) { captured = { status, envelope: null }; Object.assign(headers, values); }, end() {} };
    const record = { method: req.method, path: url.pathname,
      body: options.body === undefined ? null : JSON.parse(options.body), status: null, envelope: null };
    transport.records.push(record);
    await handler({ req, res, pathname: url.pathname, searchParams: url.searchParams,
      corsHeaders: {}, gateAuthorized: true,
      sendJson(_res, status, envelope, values) { captured = { status, envelope: copy(envelope) }; Object.assign(headers, values); } });
    assert.ok(captured, 'Actual handler must send a response');
    record.status = captured.status; record.envelope = copy(captured.envelope);
    assert.equal(headers['cache-control'], 'no-store');
    if (transport.after) await transport.after(record);
    return new Response(JSON.stringify(captured.envelope), { status: captured.status });
  };
  transport.fetch = transport.fetchAs();
  return transport;
}

// Explicit synthetic provider protocol. Real FUCQ-66 owns every intent and authority row.
function remoteProtocol() {
  const adapter = { mode: 'remote', calls: [], executeAnswer: 'throw', reconcileAnswer: 'pending', inspect: null };
  const respond = (operation, answer) => {
    if (answer === 'throw') throw new Error('Synthetic provider response lost');
    return { status: answer === 'absent' || answer === 'bad-absent' ? 'not-found'
      : answer === 'bad-confirmed' ? 'confirmed' : answer,
    operationId: answer.startsWith('bad-') ? 'different-operation' : operation.operationId,
    runId: operation.runId, orderUuid: operation.payload.orderUuid };
  };
  for (const method of ['execute', 'reconcile']) adapter[method] = async (operation) => {
    const persisted = adapter.inspect ? await adapter.inspect(operation) : false;
    adapter.calls.push({ method, operationId: operation.operationId, idempotencyKey: operation.idempotencyKey,
      inputDigest: operation.inputDigest, persisted });
    return respond(operation, adapter[`${method}Answer`]);
  };
  return adapter;
}

async function setup(t, adapter = createSyntheticManualStockAdapter()) {
  setupCount += 1;
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  expectOk(await repository.open()); t.after(() => repository.close());
  const policy = createPolicyService();
  const { clock, identity } = expectOk(await createDemoRuntime({ repository, policy,
    environmentId: 'fucq70-actual66-memory-proof', environmentKind: 'synthetic', policyAsOf: AS_OF,
    commandId: 'bootstrap', sessionNow: () => AS_OF }));
  const presenter = expectOk(await identity.createPresenterSession('presenter'));
  const acting = expectOk(await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula'));
  const context = acting.context;
  assert.equal((await identity.requireRole(context, 'employee')).status, 'ok');
  assert.equal((await identity.requireRole({ ...context }, 'employee')).status, 'forbidden');
  expectOk(await seedManualDemoContext({ repository, identity, clock, context }));
  const options = { repository, policy, clock, identity, adapter };
  const manualContext = new ManualContextService({ ...options, ports: createRepositoryManualPorts(options) });
  const claims = new ManualClaimsService({ ...options, manual: manualContext });
  expectOk(await claims.registerClockHandler());
  const details = new ManualReviewDetailsService({ repository, policy, identity, manualClaims: claims });
  const handler = createGcspHandler({ identity, allowedOrigins: [ORIGIN], routes: [
    ...createManualContextRoutes(claims), ...createManualClaimsRoutes(claims), ...createManualReviewDetailsRoutes(details),
  ] });
  const transport = transportFor(handler, cookieOf(acting));
  const galleryAdapter = createManualGalleryHttpAdapter({ base: ORIGIN, fetchImpl: transport.fetch });
  const reviewAdapter = createManualReviewHttpAdapter({ base: ORIGIN, fetchImpl: transport.fetch });
  const f = { store, repository, policy, clock, identity, presenter, acting, context, claims, details,
    transport, galleryAdapter, reviewAdapter, confirmed: [], continued: [], released: [], loads: [], sequence: 0 };
  f.review = createManualReviewController({ adapter: reviewAdapter, commandId: () => `review-command-${++f.sequence}`,
    onContinue: (value) => f.continued.push(value), onReleased: (value) => f.released.push(value) });
  f.gallery = createManualClaimController({ adapter: galleryAdapter,
    onConfirmed(value) { f.confirmed.push(value); f.loads.push(f.review.load({ handoff: value })); } });
  t.after(() => { f.gallery.destroy(); f.review.destroy(); });
  if (adapter.mode === 'remote') adapter.inspect = async (operation) => {
    const found = await repository.read(context, rowRef(context, 'pending_operations', { operationId: operation.operationId }));
    return found.status === 'ok' && found.value.state === 'pending' && found.value.idempotencyKey === operation.idempotencyKey;
  };
  const account = expectOk(await galleryAdapter.readAccount());
  const action = account.actions.find((a) => a.enabled && a.action === 'replace'); assert.ok(action);
  const driver = account.choices.drivers.find((d) => d.kind === 'employee'); assert.ok(driver);
  const option = account.choices.contractOptions.find((o) => o.schemeIds.includes(context.schemeId) && o.driverKinds.includes(driver.kind)); assert.ok(option);
  const location = account.choices.collectionLocations.find((l) => l.contractOptionIds.includes(option.contractOptionId) && l.driverKinds.includes(driver.kind)); assert.ok(location);
  expectOk(await galleryAdapter.saveDraft({ commandId: 'draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices: { mode: 'replacement', oldContractId: action.oldContractId,
      slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
      requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
      brand: account.choices.brands[0], contact: account.account.contact,
      expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' } }));
  const now = expectOk(await clock.now(context)).now;
  f.car = stock(11, { eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'),
    boot: fact(380, 'L'), sizeClass: fact(2, 'ordinal-1-5'), insuranceGroup: fact(25, 'insurance-group') }, 'RjcwOlMx');
  expectOk(await repository.transaction(context, command('synthetic-release'), (tx) => tx.insert('stock', {
    runId: context.runId, orderUuid: f.car.orderUuid, orderNumber: '9123456', configurationId: f.car.configurationId,
    state: 'released', available: true, held: false, allocated: false, facts: f.car.snapshot,
    release: { eventId: 'synthetic-local-release', availability: { ...f.car.availability, availableFrom: now } },
    visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null },
  })));
  const browsed = expectOk(await galleryAdapter.browseStock());
  const decision = browsed.decisions.find((d) => d.orderUuid === f.car.orderUuid); assert.ok(decision);
  assert.equal(decision.gateStatus, 'eligible', JSON.stringify({ blockers: decision.blockers, unknowns: decision.unknowns }));
  assert.ok(decision.claimInput); f.selection = { ...toManualCar(decision, browsed.versions).review, commandId: 'gallery-explicit-claim' };
  assert.deepEqual(f.selection.claimInput, decision.claimInput);
  assert.equal(exactRows(f, 'holds').length, 0); assert.equal(exactRows(f, 'quotes').length, 0);
  await f.gallery.load(); assert.equal(f.gallery.getState().state, 'ready');
  return f;
}
async function claimFromGallery(f) {
  await f.gallery.review(f.selection); await Promise.all(f.loads);
  assert.equal(f.confirmed.length, 1); assert.equal(f.review.state.status, 'ready'); occupancy(f, true);
}
async function advanceTo(f, to) {
  const current = expectOk(await f.clock.now(f.presenter.context));
  expectOk(await f.clock.advance(f.presenter.context, { commandId: `advance-${++f.sequence}`, expectedClockVersion: current.clockVersion, to }));
  const advanced = expectOk(await f.clock.now(f.presenter.context));
  expectOk(await f.clock.tick(f.presenter.context, { eventId: `tick-${++f.sequence}`, expectedClockVersion: advanced.clockVersion,
    inputDigest: inputDigest({ to }) }));
}
function currentAction(f, commandId) {
  const b = f.review.state.model.binding;
  return { commandId, holdId: b.holdId, expectedHoldVersion: b.expectedHoldVersion, expectedDraftVersion: b.expectedDraftVersion };
}

test('actual66 issued claim → actual69 confirmed readback callback → review without another claim', async (t) => {
  const f = await setup(t); let entered; let release;
  const reached = new Promise((resolve) => { entered = resolve; }); const barrier = new Promise((resolve) => { release = resolve; });
  f.transport.after = async (r) => { if (r.method === 'POST' && r.path.endsWith('/claim')) { entered(); await barrier; } };
  const first = f.gallery.review(f.selection); const duplicate = f.gallery.review(f.selection);
  try { await reached; assert.equal(f.confirmed.length, 0); assert.equal(posts(f, 'claim').length, 1); }
  finally { release(); }
  await Promise.all([first, duplicate]); f.transport.after = null; await Promise.all(f.loads);
  assert.equal(f.confirmed.length, 1); occupancy(f, true);
  assert.deepEqual(posts(f, 'claim')[0].body, { commandId: f.selection.commandId, ...f.selection.claimInput });
  assert.ok(f.transport.records.some((r) => r.method === 'GET' && r.path.endsWith('/claim') && r.envelope?.value?.hold?.state === 'active'));
  assert.deepEqual(f.confirmed[0].selection.claimInput, f.selection.claimInput);
  const domain = stableDomain(f); const draft = expectOk(await f.claims.readDraft(f.context));
  assert.equal(f.review.state.model.orderNumber, '9123456');
  assert.deepEqual(f.review.state.details, { contact: draft.choices.contact, expectedReturnMileage: draft.choices.expectedReturnMileage, specialRequirements: draft.choices.specialRequirements });
  assert.ok(f.review.edit('contact.email', 'changed@example.invalid'));
  assert.ok(f.review.edit('specialRequirements', 'Synthetic review note'));
  expectOk(await f.review.save()); assert.equal(f.review.state.model.reviewDetailsVersion, 1);
  assert.deepEqual(stableDomain(f), domain); assert.deepEqual(expectOk(await f.claims.readDraft(f.context)), draft);
  expectOk(await f.review.continue()); assert.equal(f.continued.length, 1); assert.equal(posts(f, 'claim/review').length, 1);
  assert.equal(f.continued[0].reviewDetailsVersion, 2); assert.equal(f.continued[0].details.contact.email, 'changed@example.invalid');
  const reviewed = expectOk(await f.galleryAdapter.readClaim());
  assert.equal(reviewed.hold.phase, 'order-review'); assert.equal(reviewed.hold.holdId, domain.holds.find((h) => h.orderUuid === f.car.orderUuid).holdId);
  const timing = await f.policy.getAssumption('hold.cart.orderReview.durationSeconds', { runId: f.context.runId, asOf: reviewed.now, policyVersion: reviewed.quote.policyVersion });
  assert.equal(timing.status, 'ok'); assert.equal(Date.parse(reviewed.hold.expiresAt) - Date.parse(reviewed.hold.reviewStartedAt), timing.value.value * 1000);
  const reviewPost = posts(f, 'claim/review')[0]; assert.deepEqual(await f.reviewAdapter.beginReview(reviewPost.body), reviewPost.envelope);
  assert.equal(expectOk(await f.galleryAdapter.readClaim()).hold.expiresAt, reviewed.hold.expiresAt);
  assert.deepEqual(table(f, 'stock'), domain.stock); assert.deepEqual(table(f, 'quotes'), domain.quotes);
  let reopenedConfirmed = 0;
  const gallery = createManualClaimController({ adapter: f.galleryAdapter, onConfirmed() { reopenedConfirmed += 1; } });
  const review = createManualReviewController({ adapter: f.reviewAdapter });
  try { await gallery.load(); expectOk(await review.load()); assert.equal(gallery.getState().state, 'existing-claim');
    assert.equal(gallery.getState().selection, null); assert.equal(gallery.getState().commandId, null); assert.equal(reopenedConfirmed, 0);
    assert.equal(review.state.model.hold.expiresAt, reviewed.hold.expiresAt); assert.equal(posts(f, 'claim').length, 1); }
  finally { gallery.destroy(); review.destroy(); }
});

test('actual66 confirmed release remains available with invalid local contacts for cancel/back/change', async (t) => {
  for (const reason of ['cancel', 'back', 'change']) {
    const f = await setup(t); await claimFromGallery(f);
    assert.ok(f.review.edit('contact.email', 'invalid'));
    const saves = posts(f, 'review-details').length;
    expectOk(await f.review.release(reason));
    assert.equal(posts(f, 'review-details').length, saves); assert.equal(f.released.length, 1);
    assert.equal(f.released[0].reason, reason); assert.equal(f.continued.length, 0); occupancy(f, false);
    assert.equal(expectOk(await f.galleryAdapter.readClaim()).hold.state, 'released'); assert.equal(posts(f, 'claim').length, 1);
    assert.equal(f.review.state.details.contact.email, 'invalid');
  }
});

test('actual66 historical success replay cannot authorise continuation after exact clock expiry', async (t) => {
  const f = await setup(t); await claimFromGallery(f);
  f.review.edit('specialRequirements', 'Retain after uncertain review');
  f.transport.after = async (r) => { if (r.method === 'POST' && r.path.endsWith('/claim/review')) throw new Error('Synthetic response lost after commit'); };
  const lost = await f.review.continue(); assert.equal(lost.status, 'unavailable'); assert.equal(f.continued.length, 0);
  f.transport.after = null;
  const reviewPost = posts(f, 'claim/review')[0]; assert.equal(reviewPost.envelope.status, 'ok');
  const deadline = reviewPost.envelope.value.hold.expiresAt; await advanceTo(f, deadline);
  const claimPost = posts(f, 'claim')[0]; assert.deepEqual(await f.galleryAdapter.claim(claimPost.body), claimPost.envelope);
  assert.deepEqual(await f.reviewAdapter.beginReview(reviewPost.body), reviewPost.envelope);
  const current = await f.galleryAdapter.readClaim(); assert.equal(current.value.hold.state, 'expired');
  assert.equal(current.value.hold.expiresAt, deadline); assert.equal(isConfirmedManualClaim(current, f.selection, claimPost.envelope), false);
  const retry = await f.review.continue(); assert.notEqual(retry.status, 'ok');
  assert.equal(f.continued.length, 0); assert.equal(f.review.state.canContinue, false);
  assert.equal(f.review.state.details.specialRequirements, 'Retain after uncertain review');
  const commands = posts(f, 'claim/review'); assert.equal(commands.length, 3);
  assert.ok(commands.every((r) => JSON.stringify(r.body) === JSON.stringify(reviewPost.body)));
  assert.equal(new Set(posts(f, 'claim').map((r) => r.body.commandId)).size, 1);
  let callbacks = 0; const gallery = createManualClaimController({ adapter: f.galleryAdapter, onConfirmed() { callbacks += 1; } });
  try { await gallery.load(); assert.equal(callbacks, 0); } finally { gallery.destroy(); }
  occupancy(f, false);
});

test('actual66 HTTP202 pending claim/replay reconciles before same-operation resend and actual GET confirmation', async (t) => {
  const remote = remoteProtocol(); const f = await setup(t, remote);
  await f.gallery.review(f.selection); assert.equal(f.confirmed.length, 0); occupancy(f, true);
  const claimPost = posts(f, 'claim')[0]; assert.equal(claimPost.status, 202); assert.equal(claimPost.envelope.status, 'pending');
  await f.review.load(); assert.equal(f.review.state.status, 'pending'); assert.equal(f.review.state.canContinue, false);
  const input = copy(claimPost.body); assert.deepEqual(await f.galleryAdapter.claim(input), claimPost.envelope);
  assert.equal(remote.calls.filter((c) => c.method === 'execute').length, 1);
  const claimPosts = posts(f, 'claim').length;
  for (const answer of ['bad-confirmed', 'bad-absent']) { remote.reconcileAnswer = answer; await f.gallery.checkStatus(); assert.equal(f.confirmed.length, 0); }
  assert.equal(remote.calls.filter((c) => c.method === 'execute').length, 1);
  remote.executeAnswer = 'pending'; remote.reconcileAnswer = 'absent'; await f.gallery.checkStatus();
  const executions = remote.calls.filter((c) => c.method === 'execute'); assert.equal(executions.length, 2);
  const resent = remote.calls.lastIndexOf(executions[1]); assert.equal(remote.calls[resent - 1].method, 'reconcile');
  assert.deepEqual({ ...executions[0], persisted: true }, { ...executions[1], persisted: true });
  assert.ok(executions.every((c) => c.persisted));
  remote.reconcileAnswer = 'confirmed'; await f.gallery.checkStatus(); await Promise.all(f.loads);
  assert.equal(f.confirmed.length, 1); assert.equal(f.review.state.status, 'ready');
  assert.equal(posts(f, 'claim').length, claimPosts); occupancy(f, true);
  assert.deepEqual(await f.galleryAdapter.claim(input), claimPost.envelope);
  assert.equal(posts(f, 'claim').at(-1).status, 202);
  const current = await f.galleryAdapter.readClaim(); assert.equal(current.status, 'ok');
  assert.equal(f.transport.records.at(-1).status, 200); assert.equal(current.value.hold.state, 'active');
  assert.equal(new Set(posts(f, 'claim').map((r) => r.body.commandId)).size, 1);
  assert.equal(remote.calls.filter((c) => c.method === 'execute').length, 2);
});

test('actual66 HTTP202 release stays occupied past deadline until matching terminal GET, retaining invalid edits', async (t) => {
  const remote = remoteProtocol(); remote.executeAnswer = 'confirmed'; remote.reconcileAnswer = 'confirmed';
  const f = await setup(t, remote); await claimFromGallery(f);
  const deadline = f.review.state.model.hold.expiresAt;
  f.review.edit('contact.email', 'invalid'); remote.executeAnswer = 'pending'; remote.reconcileAnswer = 'pending';
  const pending = await f.review.release('change'); assert.equal(pending.status, 'pending');
  const releasePost = posts(f, 'claim/release')[0]; assert.equal(releasePost.status, 202);
  await advanceTo(f, new Date(Date.parse(deadline) + 1000).toISOString());
  await f.review.reload(); assert.equal(f.review.state.status, 'pending'); assert.equal(f.review.state.canContinue, false);
  assert.equal(f.review.state.details.contact.email, 'invalid'); assert.equal(f.released.length, 0); occupancy(f, true);
  assert.deepEqual(await f.review.release(), releasePost.envelope);
  assert.deepEqual(posts(f, 'claim/release').at(-1).body, releasePost.body);
  assert.equal(expectOkPending(await f.galleryAdapter.readClaim()).hold.expiresAt, deadline);
  remote.reconcileAnswer = 'confirmed';
  assert.equal(expectOk(await f.galleryAdapter.readClaim()).hold.state, 'released');
  expectOk(await f.review.reload()); assert.equal(f.released.length, 1); assert.equal(f.continued.length, 0); occupancy(f, false);
  assert.equal(f.review.state.details.contact.email, 'invalid'); assert.equal(posts(f, 'claim').length, 1);
});
function expectOkPending(outcome) { assert.equal(outcome.status, 'pending'); return outcome.value; }

test('actual identity/session isolation and competing review metadata readback fail closed without a new claim', async (t) => {
  const f = await setup(t); await claimFromGallery(f);
  const request = (fetchImpl, suffix, body) => fetchImpl(`${ORIGIN}/api/gcsp/manual/${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await request(f.transport.fetchAs({ cookie: '' }), 'claim')).status, 401);
  assert.equal((await request(f.transport.fetchAs({ origin: 'https://unapproved.invalid' }), 'claim/review', currentAction(f, 'forbidden-origin'))).status, 403);
  assert.equal((await request(f.transport.fetch, 'claim?employeeId=forged')).status, 400);
  assert.equal((await request(f.transport.fetch, 'review-details', { employeeId: 'forged' })).status, 400);
  const second = expectOk(await f.identity.switchPrincipal(f.presenter.context, 'demo-alex', 'alex'));
  assert.equal((await f.identity.requireRole(second.context, 'employee')).status, 'ok');
  const secondFetch = f.transport.fetchAs({ cookie: cookieOf(second) });
  for (const suffix of ['claim', 'review-details']) { const response = await request(secondFetch, suffix); assert.equal(response.status, 404);
    assert.equal(JSON.stringify(await response.json()).includes(f.review.state.model.binding.holdId), false); }
  const domain = stableDomain(f);
  f.review.edit('specialRequirements', 'This tab reviewed value'); let injected = false;
  f.transport.after = async (r) => {
    if (!injected && r.method === 'POST' && r.path.endsWith('/review-details') && r.envelope?.status === 'ok') {
      injected = true; const value = r.envelope.value;
      const b = value.binding;
      expectOk(await f.details.saveReviewDetails(f.context, { commandId: 'competing-real-save', holdId: b.holdId,
        quoteId: b.quoteId, expectedHoldVersion: b.expectedHoldVersion, expectedDraftVersion: b.expectedDraftVersion,
        expectedReviewDetailsVersion: value.reviewDetailsVersion,
        details: { ...value.details, specialRequirements: 'Other tab saved value' } }));
    }
  };
  const result = await f.review.continue(); f.transport.after = null;
  assert.equal(injected, true); assert.equal(result.status, 'conflict'); assert.equal(f.review.state.conflict, true);
  assert.equal(f.review.state.details.specialRequirements, 'This tab reviewed value'); assert.equal(f.review.state.canContinue, false);
  assert.equal(posts(f, 'claim/review').length, 0); assert.equal(f.continued.length, 0); assert.deepEqual(stableDomain(f), domain);
  assert.equal(posts(f, 'claim').length, 1); occupancy(f, true);
});
