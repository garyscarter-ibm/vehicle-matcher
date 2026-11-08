import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualReviewHttpAdapter } from '../../blocks/gcsp/manual-review/http-adapter.js';
import { createManualReviewController } from '../../blocks/gcsp/manual-review/review-controller.js';
import { toManualReviewModel, reviewCountdown, validateReviewDetails } from '../../blocks/gcsp/manual-review/review-model.js';
import { validateDetails as validateServerDetails } from '../gcsp/manual-review/validation.js';

const clone = (v) => structuredClone(v);
const ok = (value) => ({ status: 'ok', contractVersion: '1.0.0', value: clone(value) });
const initial = () => ({ contact: { phone: '01632 960001', email: 'chooser@example.invalid' }, expectedReturnMileage: 80, specialRequirements: '' });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
// Named synthetic HTTP-boundary fixture. It does not compose or prove FUCQ-66/FUCQ-71.
function boundaryFixture() {
  let now = '2026-11-05T09:00:00.000Z'; let clockVersion = '1'; let details = initial(); let version = 0;
  const hold = { runId: 'fixture-run', employeeId: 'fixture-employee', entitlementSlotId: 'fixture-slot', holdId: 'fixture-hold', quoteId: 'fixture-quote',
    orderUuid: 'fixture-order', type: 'cart', state: 'active', phase: 'preview', version: 1, policyVersion: 'fixture-policy', expiresAt: '2026-11-05T09:01:30.000Z' };
  const quote = { runId: hold.runId, employeeId: hold.employeeId, entitlementSlotId: hold.entitlementSlotId, quoteId: hold.quoteId,
    orderUuid: hold.orderUuid, configurationId: 'fixture-configuration', version: 1, draftVersion: 3, policyVersion: 'fixture-policy',
    validUntil: '2026-11-05T10:00:00.000Z', facts: { display: { title: 'Synthetic car' } }, terms: { points: { value: 20, unit: 'points/month' } },
    eligibility: { timing: { preview: 90, review: 400, assumptions: [{ key: 'fixture-timing', status: 'assumed' }] } } };
  const constraints = { maximumSpecialRequirements: 500, maximumReturnMileage: 1000, mileageUnit: 'mi', textLengthUnit: 'UTF-16 code units',
    provenance: { key: 'manual.context.v1', policyVersion: quote.policyVersion, source: 'named-controller-boundary-fixture', status: 'assumed' } };
  const calls = []; const receipts = new Map();
  const binding = () => Object.fromEntries(['runId', 'employeeId', 'entitlementSlotId', 'holdId', 'quoteId'].map((k) => [k, hold[k]]).concat([['expectedHoldVersion', hold.version], ['expectedDraftVersion', quote.draftVersion]]));
  const claim = () => ok({ state: hold.state === 'active' ? 'quoted' : hold.state, hold, quote, pendingOperation: null, now, clockVersion, view: {} });
  const projection = () => ok({ binding: binding(), reviewDetailsVersion: version, details, constraints, mode: 'replacement', currentContract: { contractId: 'fixture-old-contract' },
    oldContractId: 'fixture-old-contract', contract: {}, requestedCollection: { date: '2026-11-20', locationId: 'fixture-location' }, orderNumber: '9000001', hold, quote, now, clockVersion,
    frozen: false, editable: hold.state === 'active' && Date.parse(now) < Date.parse(hold.expiresAt), canContinue: hold.state === 'active' && Date.parse(now) < Date.parse(hold.expiresAt), view: {} });
  const mutate = (kind, payload, work) => {
    calls.push([kind, clone(payload)]);
    if (receipts.has(payload.commandId)) { const old = receipts.get(payload.commandId); return JSON.stringify(old.input) === JSON.stringify(payload) ? clone(old.outcome) : { status: 'conflict', code: 'idempotency-input-changed' }; }
    const outcome = work(); if (outcome.status === 'ok') receipts.set(payload.commandId, { input: clone(payload), outcome: clone(outcome) }); return outcome;
  };
  const adapter = {
    async readClaim() { calls.push(['readClaim']); return claim(); }, async readReviewDetails() { calls.push(['readReviewDetails']); return projection(); },
    async saveReviewDetails(payload) { return mutate('save', payload, () => {
      if (payload.expectedReviewDetailsVersion !== version) return { status: 'stale-version', resource: 'review-details', expectedVersion: payload.expectedReviewDetailsVersion, currentVersion: version };
      details = clone(payload.details); version += 1; return projection();
    }); },
    async beginReview(payload) { return mutate('review', payload, () => {
      if (hold.phase === 'preview') { hold.phase = 'order-review'; hold.version += 1; hold.expiresAt = new Date(Date.parse(now) + quote.eligibility.timing.review * 1000).toISOString(); }
      return claim();
    }); },
    async release(payload) { return mutate('release', payload, () => { hold.state = 'released'; hold.version += 1; return claim(); }); },
  };
  let seq = 0; const changes = []; const continued = []; const released = [];
  const controller = createManualReviewController({ adapter, commandId: () => `fixture-command-${++seq}`, onChange: (state) => changes.push(state), onContinue: (value) => continued.push(value), onReleased: (value) => released.push(value) });
  return { adapter, controller, calls, changes, continued, released, hold, quote, constraints, claim, projection,
    tick(to) { now = to; clockVersion = String(Number(clockVersion) + 1); },
    remoteSave(next) { details = clone(next); version += 1; },
  };
}

test('adapter has canonical read/save/review/release routes and never offers or sends claim POST', async () => {
  const requests = [];
  const adapter = createManualReviewHttpAdapter({ base: '/fixture', fetchImpl: async (url, options) => {
    requests.push({ url, ...options }); return { status: 200, ok: true, json: async () => ok({ fixture: true }) };
  } });
  assert.equal(adapter.claim, undefined);
  await adapter.readClaim(); await adapter.readReviewDetails(); await adapter.saveReviewDetails({ commandId: 'save' }); await adapter.beginReview({ commandId: 'review' }); await adapter.release({ reason: 'cancel' });
  assert.deepEqual(requests.map((r) => [r.method, r.url]), [['GET', '/fixture/api/gcsp/manual/claim'], ['GET', '/fixture/api/gcsp/manual/review-details'],
    ['POST', '/fixture/api/gcsp/manual/review-details'], ['POST', '/fixture/api/gcsp/manual/claim/review'], ['POST', '/fixture/api/gcsp/manual/claim/release']]);
  assert.ok(requests.every((r) => r.credentials === 'include')); assert.equal(requests[2].headers['Content-Type'], 'application/json');
});
test('transport failure/invalid success are uncertain for commands; 202 pending is preserved', async () => {
  const offline = createManualReviewHttpAdapter({ fetchImpl: async () => { throw new Error('fixture network failure'); } });
  assert.equal((await offline.saveReviewDetails({})).uncertain, true); assert.equal((await offline.readClaim()).uncertain, false);
  const pending = { status: 'pending', operationId: 'fixture-op', operationType: 'manual-release', lastKnownState: 'unknown' };
  const p = createManualReviewHttpAdapter({ fetchImpl: async () => ({ status: 202, ok: true, json: async () => pending }) });
  assert.deepEqual(await p.release({}), pending);
  const bad = createManualReviewHttpAdapter({ fetchImpl: async () => ({ status: 503, ok: false, json: async () => ok({}) }) });
  assert.equal((await bad.beginReview({})).status, 'unavailable');
});
test('reload trusts only matching current reads, keeps exact quote and rejects mismatched handoff', async () => {
  const f = boundaryFixture(); await f.controller.load({ handoff: { claim: f.claim() } });
  const state = f.controller.getState(); assert.equal(state.status, 'ready'); assert.equal(state.canContinue, true); assert.equal(state.model.orderNumber, '9000001');
  assert.deepEqual(state.model.quote, f.quote); assert.equal(f.calls.filter(([k]) => k === 'save' || k === 'review').length, 0);
  const mismatch = f.claim(); mismatch.value.hold.orderUuid = 'other-order';
  await f.controller.reload({ handoff: { claim: mismatch } });
  assert.equal(f.controller.state.status, 'conflict'); assert.equal(f.controller.state.canContinue, false);
  assert.equal(f.controller.state.outcome.code, 'review-handoff-mismatch');
});
test('authority binding/version/run/owner/order mismatches and missing timing fail closed', () => {
  const f = boundaryFixture();
  for (const change of [(v) => { v.binding.runId = 'other-run'; }, (v) => { v.quote.employeeId = 'other-employee'; },
    (v) => { v.binding.expectedHoldVersion += 1; }, (v) => { v.quote.version += 1; }, (v) => { v.quote.orderUuid = 'other-order'; },
    (v) => { delete v.quote.eligibility.timing; }]) {
    const details = f.projection(); change(details.value);
    assert.equal(toManualReviewModel(f.claim(), details).status, 'unavailable');
  }
});
test('client validation mirrors server field and policy bounds, conditional mileage and UTF-16 controls', () => {
  const constraints = { maximumSpecialRequirements: 5, maximumReturnMileage: 10 };
  const cases = [[initial(), 'replacement'], [{ ...initial(), expectedReturnMileage: 0, specialRequirements: '😀😀a' }, 'replacement'],
    [{ ...initial(), expectedReturnMileage: null }, 'new'], [{ ...initial(), expectedReturnMileage: 1 }, 'new'],
    [{ ...initial(), expectedReturnMileage: -1 }, 'replacement'], [{ ...initial(), expectedReturnMileage: 10.1 }, 'replacement'],
    [{ ...initial(), expectedReturnMileage: 10, specialRequirements: '😀😀😀' }, 'replacement'],
    [{ ...initial(), specialRequirements: '\u0000' }, 'replacement'], [{ ...initial(), contact: { phone: '', email: 'bad' } }, 'replacement']];
  for (const [details, mode] of cases) {
    const client = validateReviewDetails(details, mode, constraints); const server = validateServerDetails(details, mode, constraints);
    assert.deepEqual(client.map((r) => r.field), server?.reasons.map((r) => r.field) ?? []);
  }
});
test('uncertain save coalesces duplicate clicks and retries the same immutable command before fresh authority', async () => {
  const f = boundaryFixture(); await f.controller.load(); f.controller.edit('specialRequirements', 'Keep local inputs');
  const actualSave = f.adapter.saveReviewDetails; const gate = deferred(); let first = true;
  f.adapter.saveReviewDetails = async (payload) => { const result = await actualSave(payload); if (first) { first = false; await gate.promise; return { status: 'unavailable', uncertain: true }; } return result; };
  const a = f.controller.save(); const b = f.controller.save(); assert.equal(a, b); gate.resolve(); await a;
  assert.equal(f.controller.state.status, 'pending'); assert.equal(f.controller.state.details.specialRequirements, 'Keep local inputs'); assert.equal(f.controller.state.editable, false);
  await f.controller.save(); const posts = f.calls.filter(([kind]) => kind === 'save'); assert.equal(posts.length, 2); assert.deepEqual(posts[0][1], posts[1][1]);
  assert.equal(f.controller.state.dirty, false); assert.equal(f.controller.state.model.reviewDetailsVersion, 1); assert.equal(f.controller.state.canContinue, true);
});
test('revision conflict retains local fields and requires explicit discard for newer metadata', async () => {
  const f = boundaryFixture(); await f.controller.load(); f.controller.edit('contact.phone', '01632 960002');
  f.remoteSave({ ...initial(), specialRequirements: 'Other tab inputs' });
  assert.equal((await f.controller.save()).status, 'stale-version'); await f.controller.reload();
  assert.equal(f.controller.state.conflict, true); assert.equal(f.controller.state.details.contact.phone, '01632 960002'); assert.equal(f.controller.state.canContinue, false);
  assert.equal(f.controller.discardLocalChanges(), true); assert.equal(f.controller.state.details.specialRequirements, 'Other tab inputs'); assert.equal(f.controller.state.canContinue, true);
});
test('continue saves, reads, begins preview once, then verifies order-review; repeated reload never renews deadline', async () => {
  const f = boundaryFixture(); await f.controller.load(); await f.controller.continue();
  assert.equal(f.continued.length, 1); assert.equal(f.continued[0].snapshot.hold.phase, 'order-review');
  assert.equal(f.calls.filter(([k]) => k === 'review').length, 1); const expiry = f.hold.expiresAt;
  await f.controller.reload(); await f.controller.continue();
  assert.equal(f.hold.expiresAt, expiry); assert.equal(f.calls.filter(([k]) => k === 'review').length, 1); assert.equal(f.continued.length, 1);
  assert.ok(f.calls.findIndex(([k]) => k === 'save') < f.calls.findIndex(([k]) => k === 'review'));
});
test('uncertain begin-review retry keeps exact payload; current expiry suppresses continuation after historical success', async () => {
  const f = boundaryFixture(); await f.controller.load(); const actual = f.adapter.beginReview; let first = true;
  f.adapter.beginReview = async (payload) => { const result = await actual(payload); if (first) { first = false; return { status: 'unavailable', uncertain: true }; } return result; };
  await f.controller.continue(); assert.equal(f.controller.state.retryAction, 'continue'); assert.equal(f.continued.length, 0);
  f.tick(f.hold.expiresAt); const result = await f.controller.continue();
  assert.notEqual(result.status, 'ok'); assert.equal(f.continued.length, 0); const posts = f.calls.filter(([kind]) => kind === 'review'); assert.deepEqual(posts[0][1], posts[1][1]);
  assert.equal(f.controller.state.canContinue, false);
});
test('invalid contact does not prevent cancel; pending release never navigates and same retry remains stable', async () => {
  const f = boundaryFixture(); await f.controller.load(); f.controller.edit('contact.email', 'invalid');
  assert.equal((await f.controller.continue()).status, 'invalid');
  const actual = f.adapter.release; let first = true;
  f.adapter.release = async (payload) => { if (first) { first = false; f.calls.push(['pending-release', clone(payload)]); return { status: 'pending', operationId: 'fixture-op' }; } return actual(payload); };
  await f.controller.release('cancel'); assert.equal(f.released.length, 0); assert.equal(f.controller.state.status, 'pending');
  await f.controller.release(); assert.equal(f.released.length, 1); assert.equal(f.released[0].reason, 'cancel');
  assert.deepEqual(f.calls.find(([k]) => k === 'pending-release')[1], f.calls.find(([k]) => k === 'release')[1]);
});
test('pending claim/reopen and transport failure retain safe inputs and disable authority', async () => {
  const f = boundaryFixture(); await f.controller.load(); f.controller.edit('specialRequirements', 'Retained on failure');
  f.adapter.readClaim = async () => ({ status: 'pending', value: f.claim().value });
  await f.controller.reload(); assert.equal(f.controller.state.status, 'pending'); assert.equal(f.controller.state.canContinue, false); assert.equal(f.controller.state.details.specialRequirements, 'Retained on failure');
  f.adapter.readClaim = async () => { throw new Error('offline'); }; await f.controller.reload(); assert.equal(f.controller.state.canContinue, false);
});
test('countdown follows persisted domain time only, with low/expiry announcements once per phase', async () => {
  const f = boundaryFixture(); await f.controller.load(); assert.equal(f.controller.state.countdown.secondsRemaining, 90);
  assert.equal(reviewCountdown(f.projection().value).secondsRemaining, 90);
  f.tick('2026-11-05T09:01:10.000Z'); await f.controller.reload(); assert.equal(f.controller.state.countdown.secondsRemaining, 20); assert.match(f.controller.state.announcement.text, /nearly/);
  await f.controller.reload(); assert.equal(f.controller.state.announcement, null);
  f.controller.edit('specialRequirements', 'Safe after expiry'); f.tick(f.hold.expiresAt); await f.controller.reload();
  assert.equal(f.controller.state.status, 'expired'); assert.equal(f.controller.state.canContinue, false); assert.match(f.controller.state.announcement.text, /expired/);
  assert.equal(f.controller.state.details.specialRequirements, 'Safe after expiry'); await f.controller.reload(); assert.equal(f.controller.state.announcement, null);
});
test('newer release wins over older refresh; late save/review and destroyed callbacks cannot restore authority', async () => {
  const f = boundaryFixture(); await f.controller.load(); const gate = deferred(); const oldClaim = f.claim(); let first = true;
  f.adapter.readClaim = async () => { if (first) { first = false; await gate.promise; return oldClaim; } return f.claim(); };
  const loading = f.controller.reload(); await Promise.resolve(); const releasing = f.controller.release('back'); await releasing; gate.resolve(); await loading;
  assert.equal(f.controller.state.status, 'released'); assert.equal(f.controller.state.canContinue, false); assert.equal(f.released.length, 1);
  const g = boundaryFixture(); await g.controller.load(); const waiting = deferred(); const save = g.adapter.saveReviewDetails;
  g.adapter.saveReviewDetails = async (payload) => { await waiting.promise; return save(payload); };
  const continuing = g.controller.continue(); await Promise.resolve(); g.controller.destroy(); const notifications = g.changes.length; waiting.resolve(); await continuing;
  assert.equal(g.continued.length, 0); assert.equal(g.changes.length, notifications); assert.equal(g.controller.state.status, 'destroyed');
});

test('other-tab metadata during uncertain begin-review retains original reviewed inputs and blocks callback', async () => {
  const f = boundaryFixture(); await f.controller.load(); f.controller.edit('specialRequirements', 'Inputs I reviewed');
  const actual = f.adapter.beginReview; let first = true;
  f.adapter.beginReview = async (payload) => { const result = await actual(payload); if (first) { first = false; return { status: 'unavailable', uncertain: true }; } return result; };
  await f.controller.continue();
  f.remoteSave({ ...initial(), specialRequirements: 'Other tab replacement inputs' });
  await f.controller.continue();
  assert.equal(f.continued.length, 0); assert.equal(f.controller.state.conflict, true);
  assert.equal(f.controller.state.details.specialRequirements, 'Inputs I reviewed'); assert.equal(f.controller.state.model.reviewDetailsVersion, 2);
  assert.equal(f.controller.discardLocalChanges(), true); assert.equal(f.controller.state.details.specialRequirements, 'Other tab replacement inputs');
});
