import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOfferController, countdownText, remainingTime } from '../../blocks/gcsp/offer/offer-controller.js';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';

const handoff = (over = {}) => ({ termsVersion: 'terms-v1', termsDigest: 'digest-1', wording: 'Fictional terms.', fictional: true, mode: 'replacement',
  blocker: null, contact: { phone: '07700 900123', email: 'p@example.invalid' }, returnCar: null,
  declarations: [{ id: 'terms', label: 'Terms.' }, { id: 'return', label: 'Return.' }], ...over });
const tickAll = (c) => { c.tickDeclaration('terms', true); c.tickDeclaration('return', true); };
const pending = (overrides = {}) => ({ status: 'ok', value: { state: 'pending', actionable: true, handoff: handoff(),
  reference: { offerId: 'offer-1', runId: 'run-1', offerVersion: 1, holdVersion: 1, quoteVersion: 1 },
  now: '2026-11-05T12:00:00.000Z', expiresAt: '2026-11-05T14:00:00.000Z',
  actions: { accept: true, decline: true }, ...overrides } });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('countdown uses supplied server instants, preserves deadline and labels missing time', () => {
  assert.equal(remainingTime('2026-11-05T14:00:00Z', '2026-11-05T12:00:00Z'), 7200);
  assert.equal(remainingTime('2026-11-05T14:00:00Z', '2026-11-05T14:00:00Z'), 0);
  assert.equal(remainingTime('2026-11-05T14:00:00Z', null), null);
  assert.equal(countdownText(7200), '2 hours remaining');
  assert.equal(countdownText(1), '1 minute remaining');
  assert.equal(countdownText(null), 'Time remaining unavailable');
});

test('missing decision port and missing server timing cannot enable actions', async () => {
  const controller = createOfferController({ read: async () => pending() });
  assert.equal((await controller.refresh()).canAccept, false);
  assert.equal(controller.snapshot().decisionUnavailable, true);
  controller.destroy();
  for (const timing of [{ now: null }, { expiresAt: null }, { actionable: false }, { reference: null },
    { reference: { offerId: 'offer-1', runId: 'run-1', offerVersion: 0, holdVersion: 1 } }]) {
    const c = createOfferController({ read: async () => pending(timing), decide: async () => {} });
    const view = await c.refresh(); assert.equal(view.canAccept, false); assert.equal(view.canDecline, false); c.destroy();
  }
});

test('zero rereads authority once and never turns an active response into client-declared expiry', async () => {
  let reads = 0;
  const c = createOfferController({ read: async () => { reads++; return pending({ now: '2026-11-05T14:00:00Z' }); }, decide: async () => {} });
  const view = await c.refresh();
  assert.equal(reads, 2); assert.equal(view.state, 'pending'); assert.equal(view.checkingExpiry, true); assert.equal(view.canAccept, false);
  c.destroy();
  reads = 0;
  const expired = createOfferController({ read: async () => ++reads === 1
    ? pending({ now: '2026-11-05T14:00:00Z' }) : pending({ state: 'expired' }) });
  assert.equal((await expired.refresh()).state, 'expired'); assert.equal(reads, 2); expired.destroy();
});

test('terminal and uncertain states remain mutually exclusive and cannot decide', async () => {
  let decisions = 0;
  for (const state of ['accepted', 'declined', 'expired', 'superseded', 'earlier-run', 'not-found', 'uncertain', 'refused']) {
    const c = createOfferController({ read: async () => pending({ state }), decide: async () => { decisions++; } });
    assert.equal((await c.refresh()).state, state);
    assert.equal(c.snapshot().canAccept, false); await c.decision('accept'); c.destroy();
  }
  assert.equal(decisions, 0);
});

test('verified earlier-run outcome clears all current offer data and actions', async () => {
  let reads = 0;
  const c = createOfferController({ read: async () => ++reads === 1 ? pending() : { status: 'stale-run' }, decide: async () => {} });
  await c.refresh(); const state = await c.refresh();
  assert.equal(state.state, 'earlier-run'); assert.equal(state.reference, undefined); assert.equal(state.canAccept, false); c.destroy();
});

test('failed email exchange offers reopening the original email without pretending a refresh retains its credential', async () => {
  const c = createOfferController({ read: async () => ({ status: 'unavailable', accessExchange: 'failed' }) });
  const state = await c.refresh(); assert.match(state.message, /Open the original email link/);
  assert.equal(state.canAccept, false); c.destroy();
});

// FUCQ-228: the stale link was the one just opened, so never send the reader back to it.
test('an earlier-run link explains the earlier run instead of sending the reader back to the same link', async () => {
  const c = createOfferController({ read: async () => ({ status: 'stale-run', accessExchange: 'failed' }) });
  const state = await c.refresh(); assert.equal(state.state, 'earlier-run');
  assert.match(state.message, /earlier demo run/); assert.doesNotMatch(state.message, /original email link/);
  assert.equal(state.canAccept, false); c.destroy();
});

test('a stale or destroyed read never replaces newer current state', async () => {
  const first = deferred(); let reads = 0;
  const c = createOfferController({ read: () => ++reads === 1 ? first.promise : Promise.resolve(pending({ state: 'declined' })) });
  const old = c.refresh(); await c.refresh(); first.resolve(pending()); await old;
  assert.equal(c.snapshot().state, 'declined');
  const later = deferred(); let emits = 0;
  const d = createOfferController({ read: () => later.promise, onChange: () => { emits++; } });
  const waiting = d.refresh(); d.destroy(); later.resolve(pending()); await waiting;
  assert.equal(emits, 0); c.destroy();
});

test('decisions never infer success and block concurrent commands until authoritative readback', async () => {
  const operation = deferred(); const calls = []; let reads = 0;
  const c = createOfferController({ read: async () => ++reads === 1 ? pending() : pending({ state: 'accepted' }),
    createCommandId: () => 'stable-command', decide: async (input) => { calls.push(input); return operation.promise; } });
  await c.refresh(); tickAll(c); const deciding = c.decision('accept');
  assert.equal(c.snapshot().state, 'uncertain'); await c.decision('decline'); await c.refresh();
  assert.equal(reads, 1); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { kind: 'accept', commandId: 'stable-command', offer: pending().value.reference,
    termsDigest: 'digest-1', declarations: { terms: true, return: true } });
  operation.resolve({ status: 'ok' }); await deciding;
  assert.equal(c.snapshot().state, 'accepted'); c.destroy();
});

test('failed command and failed readback keep an uncertain outcome, never a fabricated decline', async () => {
  let reads = 0;
  const c = createOfferController({ read: async () => ++reads === 1 ? pending() : { status: 'unavailable' },
    decide: async () => { throw new Error('lost response'); } });
  await c.refresh(); tickAll(c); await c.decision('accept');
  assert.equal(c.snapshot().state, 'uncertain'); assert.equal(c.snapshot().canDecline, false); c.destroy();
});

test('published decline-only sample blocks accept, allows only an injected decline spy and waits for readback', async () => {
  const initial = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-access.json', import.meta.url), 'utf8'));
  const decline = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-decline-access.json', import.meta.url), 'utf8'));
  let dto = { ...initial, handoff: handoff() }; const calls = [];
  const c = createOfferController({ read: async () => toOfferPresentation({ status: 'ok', value: dto }),
    readReasons: async () => ({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'contract-spy', reasons: [{ code: 'test-reason', label: 'Test reason', attribute: 'body' }] } }),
    createCommandId: () => 'decline-spy-only', decide: async ({ kind }) => { calls.push(kind); } });
  try {
    const before = await c.refresh(); tickAll(c); assert.equal(c.snapshot().canAccept, true); assert.equal(before.canDecline, true);
    dto = decline; const current = await c.refresh();
    assert.equal(current.canAccept, false); assert.equal(current.canDecline, true); assert.equal(current.seconds, 3600);
    assert.equal(current.expiresAt, initial.expiresAt); assert.equal(current.state, 'pending');
    await c.decision('accept'); assert.deepEqual(calls, []);
    await c.decision('decline'); assert.deepEqual(calls, []);
    await c.decision('decline', { reasonCode: 'test-reason' }); assert.deepEqual(calls, ['decline']);
    assert.equal(c.snapshot().state, 'pending'); // The contract spy cannot establish a declined outcome.
  } finally { c.destroy(); }
  const readOnly = createOfferController({ read: async () => toOfferPresentation({ status: 'ok', value: decline }) });
  try { const current = await readOnly.refresh(); assert.equal(current.canAccept, false); assert.equal(current.canDecline, false); }
  finally { readOnly.destroy(); }
});

test('accept needs the server handoff, no blocker and every required declaration ticked', async () => {
  const sent = []; let value = pending();
  const c = createOfferController({ read: async () => value, decide: async (input) => { sent.push(input); return { status: 'ok' }; } });
  const first = await c.refresh(); assert.equal(first.canAccept, false); assert.deepEqual(first.ticked, { terms: false, return: false });
  await c.decision('accept'); assert.equal(sent.length, 0);
  c.tickDeclaration('terms', true); assert.equal(c.snapshot().canAccept, false);
  c.tickDeclaration('unknown', true); c.tickDeclaration('return', true);
  assert.deepEqual(c.snapshot().ticked, { terms: true, return: true }); assert.equal(c.snapshot().canAccept, true);
  c.tickDeclaration('return', false); assert.equal(c.snapshot().canAccept, false); c.tickDeclaration('return', true);
  assert.equal((await c.refresh()).canAccept, true); // A clock read for the same terms keeps the ticks.
  value = pending({ handoff: handoff({ termsDigest: 'digest-2' }) });
  assert.equal((await c.refresh()).canAccept, false); // New terms need fresh declarations.
  tickAll(c); value = pending({ handoff: handoff({ blocker: 'contact-required', contact: null }) });
  assert.equal((await c.refresh()).canAccept, false); await c.decision('accept'); assert.equal(sent.length, 0);
  value = pending({ handoff: null }); assert.equal((await c.refresh()).canAccept, false);
  c.destroy();
});

test('a ticked accept sends the server digest and exactly the required declaration ids', async () => {
  const sent = []; let reads = 0;
  const c = createOfferController({ read: async () => ++reads === 1 ? pending() : pending({ state: 'accepted', handoff: null }),
    decide: async (input) => { sent.push(input); return { status: 'ok' }; } });
  await c.refresh(); tickAll(c); await c.decision('accept');
  assert.equal(sent.length, 1); assert.equal(sent[0].termsDigest, 'digest-1'); assert.deepEqual(sent[0].declarations, { terms: true, return: true });
  assert.equal(c.snapshot().state, 'accepted'); c.destroy();
});

test('a lapsed access key reads access-lapsed, an unknown session restarted, with no actions; stale-run stays earlier-run', async () => {
  for (const [status, expected] of [['access-required', 'access-lapsed'], ['unknown-session', 'restarted']]) {
    let reads = 0;
    const c = createOfferController({ read: async () => ++reads === 1 ? pending() : { status }, decide: async () => {} });
    await c.refresh(); const state = await c.refresh();
    assert.equal(state.state, expected); assert.equal(state.reference, undefined); assert.equal(state.canAccept, false); assert.equal(state.canDecline, false); c.destroy();
  }
  const c = createOfferController({ read: async () => ({ status: 'stale-run' }) });
  assert.equal((await c.refresh()).state, 'earlier-run'); c.destroy();
});
