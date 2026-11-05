import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { createOfferAccessService, OFFER_ACCESS_COOKIE, OFFER_ACCESS_CONSUMER } from '../gcsp/offers/access.js';
import { createOfferAccessHandler } from '../gcsp/offers/access-http.js';
import { stock as candidateStock, brief, fact } from './helpers/employee-recommendation.js';

if (!process.env.GCSP_OFFER_TOKEN_MODULE) throw Error('Run the scoped supervisor with the verified published FUCQ-100 token module.');
const { mintOfferToken, verifyOfferToken } = await import(process.env.GCSP_OFFER_TOKEN_MODULE);
const cmd = (commandId, data = commandId) => ({ commandId, inputDigest: inputDigest(data) });
const cookieOf = (value) => [value].flat().map((cookie) => cookie.split(';')[0]).join('; ');
const reference = (table, scope, key) => ({ table, key: { runId: scope.runId, ...key } });

async function fixture({ mutateDecision } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  const policy = createPolicyService(); let wall = '2026-11-05T12:00:00.000Z';
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'offer-access-test', environmentKind: 'synthetic',
    policyAsOf: wall, commandId: 'bootstrap', sessionNow: () => wall });
  assert.equal(runtime.status, 'ok'); const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter'); assert.equal(presenter.status, 'ok');
  const employee = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula'); assert.equal(employee.status, 'ok');
  const employeeContext = employee.value.context;
  const initial = await clock.now(employeeContext);
  const advanceSeconds = (Date.parse(wall) - Date.parse(initial.value.now)) / 1000;
  assert.equal((await clock.advance(presenter.value.context, { commandId: 'midday', expectedClockVersion: initial.value.clockVersion, bySeconds: advanceSeconds })).status, 'ok');
  const now = (await clock.now(employeeContext)).value;
  const candidate = candidateStock(987);
  const recommendation = createEmployeeRecommendationService({ policy, time: clock, provider: { async resolve() {
    return { status: 'ok', value: { runId: employeeContext.runId, environmentId: employeeContext.environmentId,
      employeeId: employeeContext.employeeId, factsVersion: 'employee-facts-v1', stockVersion: 'stock-v1',
      employeeFacts: { driverEligible: fact(true), essentials: {}, charging: fact('home'), requiredBy: fact('2026-12-01T00:00:00.000Z') }, stock: [candidate] } };
  } } });
  const evaluated = await recommendation.recommend(employeeContext, brief()); assert.equal(evaluated.status, 'ok');
  const decision = structuredClone(evaluated.value.decisions[0]); assert.equal(decision.gateStatus, 'eligible');
  mutateDecision?.(decision);
  const binding = { environmentId: employeeContext.environmentId, runId: employeeContext.runId, offerId: 'offer-one' };
  const token = mintOfferToken(binding); const rawToken = new URLSearchParams(token.offerLink.split('#')[1]).get('token');
  const duration = await policy.getAssumption('hold.buddy.durationSeconds', { runId: binding.runId, asOf: now.now, policyVersion: employeeContext.policyVersion });
  const expiresAt = new Date(Date.parse(now.now) + duration.value.value * 1000).toISOString();
  const seeded = await repository.transaction(employeeContext, cmd('offer-fixture'), async (tx) => {
    const rows = [
      ['stock', { orderUuid: candidate.orderUuid, orderNumber: '0999987', configurationId: candidate.configurationId, state: 'held', available: false, held: true }],
      ['quotes', { quoteId: 'quote-one', orderUuid: candidate.orderUuid, employeeId: employeeContext.employeeId,
        entitlementSlotId: employeeContext.entitlementSlotId, configurationId: candidate.configurationId, facts: decision.snapshot,
        eligibility: { decision }, terms: decision.terms, allowance: decision.terms.allowanceInputs,
        briefVersion: 1, policyVersion: employeeContext.policyVersion, quotedAt: now.now, validUntil: decision.terms.validUntil }],
      ['holds', { holdId: 'hold-one', orderUuid: candidate.orderUuid, employeeId: employeeContext.employeeId,
        entitlementSlotId: employeeContext.entitlementSlotId, type: 'buddy-offer', state: 'active', quoteId: 'quote-one', policyVersion: employeeContext.policyVersion, expiresAt }],
      ['offers', { ...binding, holdId: 'hold-one', quoteId: 'quote-one', orderUuid: candidate.orderUuid,
        employeeId: employeeContext.employeeId, state: 'active', briefVersion: 1, policyVersion: employeeContext.policyVersion,
        expiresAt, tokenHash: token.tokenHash, tokenMetadata: token.tokenMetadata }],
    ];
    for (const [table, row] of rows) { const inserted = await tx.insert(table, { runId: binding.runId, ...row }); if (inserted.status !== 'ok') return inserted; }
    return { status: 'ok', value: { seeded: true } };
  });
  assert.equal(seeded.status, 'ok');
  const options = { repository, policy, clock, identity, environmentId: binding.environmentId, sessionNow: () => wall, verifyOfferToken };
  const service = createOfferAccessService(options);
  let changes = 0;
  const patch = async (table, key, value) => {
    const found = await repository.read(employeeContext, reference(table, binding, key)); assert.equal(found.status, 'ok');
    const saved = await repository.transaction(employeeContext, cmd(`patch-${++changes}`, value), (tx) => tx.compareAndSwap(reference(table, binding, key), found.value.version, value));
    assert.equal(saved.status, 'ok');
  };
  const exchange = () => service.exchange({ runId: binding.runId, offerId: binding.offerId, token: rawToken });
  return { store, repository, policy, clock, identity, presenter, employee, employeeContext, service, options, binding, rawToken, token, decision,
    expiresAt, patch, exchange, selector: { runId: binding.runId, offerId: binding.offerId },
    advanceWall: (seconds) => { wall = new Date(Date.parse(wall) + seconds * 1000).toISOString(); },
    advanceDomain: async (seconds) => {
      const time = await clock.now(employeeContext);
      assert.equal((await clock.advance(presenter.value.context, { commandId: `advance-${++changes}`, expectedClockVersion: time.value.clockVersion, bySeconds: seconds })).status, 'ok');
    },
    reset: async () => {
      const state = (await clock.readState(presenter.value.context)).value;
      const reset = await clock.reset(presenter.value.context, { commandId: 'reset', expectedRunId: state.runId,
        expectedRunVersion: state.runVersion, scenarioVersion: state.versions.scenario, fixtureVersion: state.versions.fixture });
      assert.equal(reset.status, 'ok');
    } };
}

test('published token exchanges for exactly one safe current offer and independent secure credential', async () => {
  const f = await fixture(); const result = await f.exchange(); assert.equal(result.status, 'ok');
  const { offer, context, setCookie } = result.value;
  assert.equal(offer.state, 'pending'); assert.equal(offer.expiresAt, f.expiresAt);
  assert.equal(offer.quote.orderNumber, '0999987'); assert.equal(offer.quote.configurationId, f.decision.configurationId);
  assert.deepEqual(offer.quote.terms, f.decision.terms); assert.deepEqual(offer.availableActions, ['accept', 'decline']);
  assert.equal(offer.comparison.status, 'unavailable'); assert.equal(offer.comparison.currentCar, null);
  assert.ok(Object.isFrozen(context)); assert.equal(context.roles, undefined);
  assert.match(setCookie.slice(setCookie.indexOf(';')), /Path=\/api\/gcsp\/offers; HttpOnly; SameSite=None; Expires=.*; Secure$/);
  assert.ok(!setCookie.includes(f.rawToken));
  assert.ok(!JSON.stringify(offer).match(/employeeId|employeeFacts|tokenHash|tokenMetadata|principalId|sessionId|"brief":\{/));
  if (process.env.GCSP_OFFER_ACCESS_SAMPLE) await writeFile(process.env.GCSP_OFFER_ACCESS_SAMPLE, JSON.stringify(offer, null, 2) + '\n');
});

for (const [stored, held, state, reason] of [
  ['accepted', 'allocated', 'accepted', 'accepted'], ['rejected', 'released', 'declined', 'declined'],
  ['expired', 'expired', 'expired', 'deadline-passed'], ['superseded', 'released', 'superseded', 'superseded'],
  ['decision-pending', 'selection-pending', 'pending', 'decision-pending'],
  ['release-pending', 'release-pending', 'pending', 'release-pending'],
]) test(`stored ${stored}/${held} reads ${state} without optimistic actions`, async () => {
  const f = await fixture(); await f.patch('offers', { offerId: 'offer-one' }, { state: stored });
  await f.patch('holds', { holdId: 'hold-one' }, { state: held });
  const result = await f.exchange(); assert.equal(result.status, 'ok');
  assert.equal(result.value.offer.state, state); assert.equal(result.value.offer.reason, reason);
  assert.deepEqual(result.value.offer.availableActions, []);
});

test('exact persisted deadline is expired while reads and repeated exchange never mutate or revive business rows', async () => {
  const f = await fixture(); const first = await f.exchange(); assert.equal(first.status, 'ok');
  const before = structuredClone(f.store.state.tables);
  await f.advanceDomain((Date.parse(f.expiresAt) - Date.parse(first.value.offer.serverNow)) / 1000);
  const expired = await f.service.read(first.value.context); assert.equal(expired.status, 'ok');
  assert.equal(expired.value.state, 'expired'); assert.deepEqual(expired.value.availableActions, []);
  assert.equal((await f.exchange()).value.offer.state, 'expired');
  for (const table of ['offers', 'holds', 'quotes', 'stock', 'claims', 'notification_outbox', 'decisions']) assert.deepEqual(f.store.state.tables[table], before[table]);
});

test('in-flight selection remains uncertain after the deadline and never appears accepted or released', async () => {
  const f = await fixture(); await f.patch('offers', { offerId: 'offer-one' }, { state: 'decision-pending' });
  await f.patch('holds', { holdId: 'hold-one' }, { state: 'selection-pending' });
  const first = await f.exchange(); assert.equal(first.status, 'ok');
  await f.advanceDomain((Date.parse(f.expiresAt) - Date.parse(first.value.offer.serverNow)) / 1000 + 1);
  const read = await f.service.read(first.value.context); assert.equal(read.status, 'ok');
  assert.equal(read.value.reason, 'decision-pending'); assert.deepEqual(read.value.availableActions, []);
});

test('unknown, malformed, tampered and incorrectly bound tokens return the same not-found', async () => {
  const f = await fixture(); const base = { ...f.selector, token: f.rawToken };
  const expected = await f.service.exchange({ ...base, token: 'bad' });
  for (const input of [{ ...base, offerId: 'unknown' }, { ...base, runId: 'unknown' },
    { ...base, token: 'A'.repeat(43) }, { ...base, environmentId: 'other' },
    { ...base, token: mintOfferToken({ ...f.binding, runId: 'other' }).offerLink.split('#token=')[1] }]) {
    assert.deepEqual(await f.service.exchange(input), expected);
  }
  assert.equal(expected.status, 'not-found');
});

test('a real reset returns minimal earlier-run only after full token or session verification', async () => {
  const f = await fixture(); const access = await f.exchange(); assert.equal(access.status, 'ok');
  await f.reset(); const stale = await f.exchange(); assert.equal(stale.status, 'stale-run');
  assert.equal(stale.reason, 'This offer belongs to an earlier demo run.');
  assert.deepEqual(Object.keys(stale).sort(), ['contractVersion', 'reason', 'status']);
  assert.deepEqual(await f.service.fromSession(f.selector, cookieOf(access.value.setCookie)), stale);
  assert.equal((await f.service.exchange({ ...f.selector, token: 'A'.repeat(43) })).status, 'not-found');
});

test('hashed sessions survive new service instances and expire on wall time independently of demo time', async () => {
  const f = await fixture(); const exchanged = await f.exchange(); assert.equal(exchanged.status, 'ok');
  const cookie = cookieOf(exchanged.value.setCookie);
  const restarted = createOfferAccessService(f.options);
  assert.equal((await restarted.fromSession(f.selector, cookie)).status, 'ok');
  assert.equal((await restarted.read(exchanged.value.context)).status, 'not-found');
  const current = (await f.clock.now(f.employeeContext)).value;
  const lifetime = await f.policy.getAssumption('identity.session.durationSeconds', { runId: f.binding.runId, asOf: current.now, policyVersion: f.employeeContext.policyVersion });
  f.advanceWall(lifetime.value.value);
  assert.equal((await restarted.fromSession(f.selector, cookie)).status, 'not-found');
  assert.equal((await f.clock.now(f.employeeContext)).value.now, current.now);
});

test('raw link token and fresh cookie never enter repository rows or automatic command receipts', async () => {
  const f = await fixture(); const exchanged = await f.exchange(); assert.equal(exchanged.status, 'ok');
  const credential = cookieOf(exchanged.value.setCookie).split('=')[1];
  const persisted = JSON.stringify(f.store.state);
  assert.ok(!persisted.includes(f.rawToken)); assert.ok(!persisted.includes(credential));
  const records = f.store.state.tables.event_receipts.filter((row) => row.consumerId === OFFER_ACCESS_CONSUMER);
  assert.equal(records.length, 1); assert.match(records[0].eventId, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(records[0].outcome).sort(), ['environmentId', 'expiresAt', 'offerId', 'runId', 'schemaVersion']);
});

test('nested projection preserves public image/fact provenance while excluding unrecognised private payloads', async () => {
  const f = await fixture({ mutateDecision(decision) {
    decision.snapshot.display.images = [{ src: '/car.webp', alt: 'The offered car', employeeId: 'hidden-image-owner' }];
    decision.snapshot.facts.privateEmployee = fact('hidden-fact');
    decision.reasons.push({ code: 'safe-reason', employeeId: 'hidden-reason-owner', actual: { employeeId: 'hidden-nested-owner' } });
    decision.terms.allowanceInputs.employeePrivate = { value: 123, unit: 'points' };
  } });
  const access = await f.exchange(); assert.equal(access.status, 'ok'); const dto = access.value.offer;
  assert.deepEqual(dto.quote.facts.display.images, [{ src: '/car.webp', alt: 'The offered car' }]);
  assert.equal(dto.quote.facts.facts.seats.provenance.assurance, 'synthetic-scenario');
  assert.ok(!JSON.stringify(dto).match(/hidden-|privateEmployee|employeePrivate/));
  assert.deepEqual(dto.quote.decision.reasons.at(-1), { code: 'safe-reason' });
});

test('account route uses real resource authority and converges on the same privately branded capability', async () => {
  const f = await fixture(); const link = await f.exchange(); const account = await f.service.fromAccount(f.employeeContext, { offerId: f.binding.offerId });
  assert.equal(link.status, 'ok'); assert.equal(account.status, 'ok'); assert.deepEqual(account.value.offer, link.value.offer);
  for (const context of [link.value.context, account.value.context]) {
    assert.equal((await f.service.authorizeOffer(context, f.selector, 'decide')).status, 'ok');
    assert.equal((await f.service.authorizeOffer(context, { ...f.selector, offerId: 'other' }, 'decide')).status, 'not-found');
    assert.equal((await f.service.read({ ...context })).status, 'not-found');
  }
  assert.equal((await f.service.fromAccount({ ...f.employeeContext }, f.selector)).status, 'not-found');
  const other = await f.identity.switchPrincipal(f.presenter.value.context, 'demo-alex', 'alex'); assert.equal(other.status, 'ok');
  assert.equal((await f.service.fromAccount(other.value.context, f.selector)).status, 'not-found');
  assert.equal((await f.identity.requireRole(link.value.context, 'employee')).status, 'forbidden');
});

test('cookie binding cannot be changed to another offer, duplicated or forged', async () => {
  const f = await fixture(); const access = await f.exchange(); assert.equal(access.status, 'ok');
  const cookie = cookieOf(access.value.setCookie);
  assert.equal((await f.service.fromSession({ ...f.selector, offerId: 'other' }, cookie)).status, 'not-found');
  assert.equal((await f.service.fromSession(f.selector, `${cookie}; ${cookie}`)).status, 'not-found');
  assert.equal((await f.service.fromSession(f.selector, `${OFFER_ACCESS_COOKIE}=${'A'.repeat(43)}`)).status, 'not-found');
});

test('misaligned owner, quote, exact car, state or deadline fail closed', async () => {
  for (const patch of [{ employeeId: 'other' }, { orderUuid: 'other' }, { expiresAt: '2026-11-06T12:00:00.000Z' }, { state: 'accepted' }]) {
    const f = await fixture(); await f.patch('offers', { offerId: 'offer-one' }, patch);
    assert.equal((await f.exchange()).status, 'unavailable');
  }
});

test('changed clock during the second snapshot refuses mixed state', async () => {
  const f = await fixture(); const access = await f.exchange(); assert.equal(access.status, 'ok');
  let calls = 0;
  const racing = createOfferAccessService({ ...f.options, clock: { async now(scope) {
    const read = await f.clock.now(scope); calls += 1;
    return calls === 2 && read.status === 'ok' ? { ...read, value: { ...read.value, clockVersion: 'changed' } } : read;
  } } });
  assert.equal((await racing.fromSession(f.selector, cookieOf(access.value.setCookie))).status, 'unavailable');
});

test('provider errors are generic and produce no token-bearing log output', async () => {
  const f = await fixture(); const logs = []; const original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const broken = createOfferAccessService({ ...f.options, verifyOfferToken() { throw Error(f.rawToken); } });
    const failed = await broken.exchange({ ...f.selector, token: f.rawToken });
    assert.equal(failed.status, 'unavailable'); assert.ok(!JSON.stringify(failed).includes(f.rawToken));
    assert.equal(logs.length, 0);
  } finally { console.error = original; }
});

async function request(f, path, { method = 'GET', body, cookie, origin = 'https://offer.test', gateAuthorized = true, rawBody } = {}) {
  const handler = createOfferAccessHandler({ service: f.service, identity: f.identity, allowedOrigins: ['https://offer.test'] });
  const url = new URL(path, 'https://api.test');
  const req = Readable.from(rawBody !== undefined ? [rawBody] : body ? [JSON.stringify(body)] : []);
  req.method = method; req.headers = { ...(origin === null ? {} : { origin }), ...(cookie ? { cookie } : {}), 'content-type': 'application/json' };
  const headers = {}; const res = { setHeader(key, value) { headers[key.toLowerCase()] = value; },
    writeHead(status, more) { this.status = status; Object.assign(headers, more); }, end() {} };
  await handler({ req, res, pathname: url.pathname, searchParams: url.searchParams, gateAuthorized,
    sendJson(_res, status, json, more) { res.status = status; res.json = json; Object.assign(headers, more); } });
  return { status: res.status, json: res.json, headers };
}

test('HTTP exchange and cookie reload use the safe DTO; a second browser independently exchanges the same email link', async () => {
  const f = await fixture(); const body = { ...f.selector, token: f.rawToken };
  const exchanged = await request(f, '/api/gcsp/offers/access', { method: 'POST', body }); assert.equal(exchanged.status, 200);
  assert.equal(exchanged.headers['cache-control'], 'no-store'); assert.equal(exchanged.headers['referrer-policy'], 'no-referrer');
  assert.ok(!JSON.stringify(exchanged.json).includes(f.rawToken)); assert.equal(exchanged.json.value.context, undefined);
  const path = `/api/gcsp/offers/offer-one?runId=${encodeURIComponent(f.binding.runId)}`;
  const reloaded = await request(f, path, { cookie: cookieOf(exchanged.headers['set-cookie']) });
  assert.equal(reloaded.status, 200); assert.deepEqual(reloaded.json, exchanged.json);
  assert.equal((await request(f, '/api/gcsp/offers/offer-one', { cookie: cookieOf(exchanged.headers['set-cookie']) })).status, 200);
  const second = await request(f, '/api/gcsp/offers/access', { method: 'POST', body }); assert.equal(second.status, 200);
  assert.ok(second.headers['set-cookie'] !== exchanged.headers['set-cookie']);
  const account = await request(f, '/api/gcsp/offers/offer-one', { cookie: cookieOf(f.employee.value.setCookie) });
  assert.equal(account.status, 200); assert.deepEqual(account.json, exchanged.json);
});

test('HTTP gate and exact origins precede exchange, including missing, null and deceptive origins', async () => {
  const f = await fixture(); const body = { ...f.selector, token: f.rawToken };
  const before = f.store.state.tables.event_receipts.length;
  for (const origin of [null, 'null', 'https://offer.test.evil', 'https://offer.test/']) {
    assert.equal((await request(f, '/api/gcsp/offers/access', { method: 'POST', body, origin })).status, 403);
  }
  assert.equal((await request(f, '/api/gcsp/offers/access', { method: 'POST', body, gateAuthorized: false })).status, 401);
  assert.equal(f.store.state.tables.event_receipts.length, before);
});

test('HTTP refuses token URLs, duplicate run selectors, identity claims and oversized or malformed JSON', async () => {
  const f = await fixture(); const body = { ...f.selector, token: f.rawToken };
  for (const path of ['/api/gcsp/offers/access?token=secret', '/api/gcsp/offers/access?runId=other']) {
    assert.equal((await request(f, path, { method: 'POST', body })).status, 400);
  }
  for (const path of ['/api/gcsp/offers/offer-one?token=secret', '/api/gcsp/offers/offer-one?runId=a&runId=b', '/api/gcsp/offers/offer-one?employeeId=other']) {
    assert.equal((await request(f, path)).status, 400);
  }
  assert.equal((await request(f, '/api/gcsp/offers/access', { method: 'POST', body: { ...body, roles: ['employee'] } })).status, 400);
  for (const rawBody of ['{', '[]', 'A'.repeat(16385)]) assert.equal((await request(f, '/api/gcsp/offers/access', { method: 'POST', rawBody })).status, 400);
});
