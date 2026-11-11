import test from 'node:test';
import assert from 'node:assert/strict';
import { buddyOfferCounts, createPresenterReleaseRoutes } from '../gcsp/presenter-releases/http.js';

const RUN = 'current'; const NOW = '2026-11-11T11:30:00.000Z';
const row = (id, state, holdState, extra = {}) => ({
  offer: { runId: RUN, offerId: id, holdId: id, orderUuid: id, state, ...extra.offer },
  hold: { runId: RUN, holdId: id, orderUuid: id, type: 'buddy-offer', state: holdState,
    expiresAt: '2026-11-11T12:30:00.000Z', ...extra.hold },
});
const project = (rows, now = NOW) => buddyOfferCounts(rows.map((r) => r.offer), rows.map((r) => r.hold), now, RUN);

test('mixed outcomes count offers in this run, separate from reservations, expired offers and reconciliation', () => {
  const rows = [row('pending', 'active', 'active'), row('accepted', 'accepted', 'allocated'),
    row('declined', 'rejected', 'released', { hold: { releaseReason: 'offer-declined' } }),
    row('declined-legacy', 'declined', 'released', { hold: { releaseReason: 'offer-declined' } }),
    row('expired', 'expired', 'expired'), row('deadline', 'active', 'active', { hold: { expiresAt: NOW } }),
    row('decision-intent', 'decision-pending', 'selection-pending'), row('release-intent', 'release-pending', 'release-pending'),
    row('claim-intent', 'claim-pending', 'claim-pending'), row('reconciling', 'accepted', 'selection-pending'),
    row('system-rejection', 'rejected', 'released', { hold: { releaseReason: 'system-rejection' } }),
    row('selected', 'selected', 'allocated'), row('manual', 'active', 'active', { hold: { type: 'cart' } }),
    row('old-run', 'accepted', 'allocated', { offer: { runId: 'old' }, hold: { runId: 'old' } })];
  assert.deepEqual(project(rows), { pending: 1, declined: 2, accepted: 1 });
  assert.deepEqual(project(rows, '2026-11-11T12:30:00.000Z'), { pending: 0, declined: 2, accepted: 1 });
});

test('missing source, clock or matching hold cannot become false zero', () => {
  assert.equal(buddyOfferCounts(null, [], NOW, RUN), null); assert.equal(buddyOfferCounts([], null, NOW, RUN), null);
  assert.equal(buddyOfferCounts([], [], 'bad-clock', RUN), null);
  assert.equal(buddyOfferCounts([row('missing', 'active', 'active').offer], [], NOW, RUN), null);
  assert.equal(project([row('bad-expiry', 'active', 'active', { hold: { expiresAt: null } })]), null);
});

const routeRead = async ({ offers = [], holds = [], clock = { status: 'ok', value: { now: NOW } } } = {}) => {
  const calls = []; const repository = { query: async (context, table) => {
    calls.push({ context, table });
    if (table === 'offers') { if (offers instanceof Error) throw offers; return Array.isArray(offers) ? { status: 'ok', value: offers } : offers; }
    return { status: 'ok', value: table === 'holds' ? holds : [] };
  } };
  const route = createPresenterReleaseRoutes({ repository, clock: { now: async () => clock } })[0];
  const reply = await route.handle({ context: { runId: RUN }, body: {}, searchParams: new URLSearchParams() });
  return { route, reply, calls };
};
test('latest-release HTTP projection reads run-scoped allocation even before a release and exposes only aggregates', async () => {
  const pending = row('private-employee-offer', 'active', 'active');
  const { route, reply, calls } = await routeRead({ offers: [pending.offer], holds: [pending.hold] });
  assert.equal(route.role, 'presenter'); assert.equal(route.method, 'GET');
  assert.equal(reply.status, 'ok'); assert.equal(reply.value.release, null);
  assert.deepEqual(reply.value.allocation, { pending: 1, declined: 0, accepted: 0 });
  assert.ok(calls.every(({ context }) => context.runId === RUN)); assert.doesNotMatch(JSON.stringify(reply), /private-employee-offer/);
});
test('offer read refusal, missing data, throw or clock failure leaves release stock independent and Allocation unavailable', async () => {
  for (const options of [{ offers: { status: 'unavailable' } }, { offers: { status: 'ok' } }, { offers: Error('offline') }, { clock: { status: 'unavailable' } }]) {
    const { reply } = await routeRead(options); assert.equal(reply.status, 'ok');
    assert.equal(reply.value.allocation, null); assert.equal(reply.value.counts.totalReleased, 0);
  }
});

test('latest-release HTTP projection retains mixed authoritative outcomes without exposing offer records', async () => {
  const rows = [row('a', 'active', 'active'), row('b', 'accepted', 'allocated'),
    row('c', 'rejected', 'released', { hold: { releaseReason: 'offer-declined' } }),
    row('d', 'expired', 'expired'), row('e', 'decision-pending', 'selection-pending')];
  const { reply } = await routeRead({ offers: rows.map((r) => r.offer), holds: rows.map((r) => r.hold) });
  assert.deepEqual(reply.value.allocation, { pending: 1, declined: 1, accepted: 1 });
  assert.deepEqual(Object.keys(reply.value.allocation), ['pending', 'declined', 'accepted']);
});
