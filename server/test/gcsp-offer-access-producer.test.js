import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { BriefService } from '../gcsp/brief/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createOfferAccessService } from '../gcsp/offers/access.js';
import { stock, essential, preference } from './helpers/employee-recommendation.js';

if (!process.env.GCSP_BUDDY_HOLD_MODULE || !process.env.GCSP_PRODUCER_MODULE_MAP) {
  throw Error('Use the exact approved producer-composition supervisor.');
}
const { BuddyHoldService } = await import(process.env.GCSP_BUDDY_HOLD_MODULE);
const { verifyOfferToken } = await import(process.env.GCSP_OFFER_TOKEN_MODULE);
const ref = (f, table, key = {}) => ({ table, key: { runId: f.context.runId, ...key } });
const cookieOf = (value) => value.split(';')[0];
const passed = (outcome) => { assert.equal(outcome.status, 'ok'); return outcome.value; };

async function setup(t) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  passed(await repository.open()); t.after(() => repository.close());
  const policy = createPolicyService(); const wall = '2026-11-05T12:00:00.000Z';
  const runtime = passed(await createDemoRuntime({ repository, policy, environmentId: 'actual-producer-access-proof',
    environmentKind: 'synthetic', policyAsOf: wall, commandId: 'producer-bootstrap', sessionNow: () => wall }));
  const { clock, identity } = runtime;
  const presenter = passed(await identity.createPresenterSession('producer-presenter'));
  const acting = passed(await identity.switchPrincipal(presenter.context, 'demo-paula', 'producer-paula'));
  const context = acting.context;
  passed(await seedManualDemoContext({ repository, identity, clock, context }));
  const initial = passed(await clock.now(context));
  passed(await clock.advance(presenter.context, { commandId: 'producer-noon', expectedClockVersion: initial.clockVersion,
    bySeconds: (Date.parse(wall) - Date.parse(initial.now)) / 1000 }));
  const brief = new BriefService({ repository, policy, clock, identity });
  passed(await brief.saveDraft(context, { commandId: 'producer-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  passed(await brief.confirm(context, { commandId: 'producer-confirm', expectedBriefVersion: 0,
    expectedDraftVersion: 1, consent: { search: true, hold: true } }));
  const car = stock(1);
  passed(await repository.transaction(context, { commandId: 'producer-stock', inputDigest: inputDigest('producer-stock') },
    (tx) => tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: '0123456',
      configurationId: car.configurationId, state: 'released', available: true, held: false, allocated: false,
      facts: car.snapshot, release: { eventId: 'explicit-synthetic-release', availability: car.availability },
      visibility: { companyIds: [context.companyId], schemeIds: [context.schemeId], employeeIds: null } })));
  const f = { repository, store, policy, clock, identity, context, presenter, acting, car };
  const employee = passed(await repository.read(context, ref(f, 'employees', { employeeId: context.employeeId })));
  const slot = passed(await repository.read(context, ref(f, 'entitlement_slots', { entitlementSlotId: context.entitlementSlotId })));
  f.input = { commandId: 'producer-allocate', orderUuid: car.orderUuid, expectedBriefVersion: 1,
    expectedStockVersion: 1, expectedEmployeeVersion: employee.version, expectedSlotVersion: slot.version };
  f.producer = new BuddyHoldService({ repository, policy, clock, identity, adapter: { mode: 'local-synthetic' } });
  f.allocated = passed(await f.producer.allocate(context, f.input));
  const jobs = passed(await repository.query(context, 'notification_outbox'));
  assert.equal(jobs.length, 1);
  // The committed outbox is the sole raw-link custody source. Never print it.
  let link;
  try { link = new URL(jobs[0].payload.offerLink, 'https://explicit-synthetic.test'); }
  catch { throw Error('Producer link shape is unavailable.'); }
  f.token = new URLSearchParams(link.hash.slice(1)).get('token');
  f.selector = { runId: link.searchParams.get('runId'), offerId: link.searchParams.get('offerId') };
  assert.equal(f.selector.runId, context.runId); assert.equal(f.selector.offerId, f.allocated.offer.offerId);
  assert.equal(typeof f.token, 'string'); assert.equal(f.token.length, 43);
  f.accessOptions = { repository, policy, clock, identity, environmentId: context.environmentId,
    sessionNow: () => wall, verifyOfferToken };
  f.access = createOfferAccessService(f.accessOptions);
  f.exchange = () => f.access.exchange({ ...f.selector, token: f.token });
  f.advanceTo = async (instant, commandId) => {
    const time = passed(await clock.now(context));
    return clock.advance(presenter.context, { commandId, expectedClockVersion: time.clockVersion,
      bySeconds: (Date.parse(instant) - Date.parse(time.now)) / 1000 });
  };
  f.tick = async (eventId) => {
    const time = passed(await clock.now(context));
    return clock.tick(presenter.context, { eventId, inputDigest: inputDigest(eventId), expectedClockVersion: time.clockVersion });
  };
  return f;
}

function assertCustody(f, value, credential) {
  assert.equal(JSON.stringify(value).includes(f.token), false);
  for (const [table, rows] of Object.entries(f.store.state.tables)) {
    if (table !== 'notification_outbox') assert.equal(JSON.stringify(rows).includes(f.token), false, table);
    if (credential) assert.equal(JSON.stringify(rows).includes(credential), false, table);
  }
}

test('actual buddy allocation feeds pinned private offer access, cookie/account parity and stable replay', async (t) => {
  const f = await setup(t); const exchanged = passed(await f.exchange()); const dto = exchanged.offer;
  assert.equal(dto.state, 'pending'); assert.deepEqual(dto.availableActions, ['accept', 'decline']);
  assert.equal(dto.expiresAt, f.allocated.hold.expiresAt); assert.equal(dto.quote.quoteId, f.allocated.quote.quoteId);
  assert.equal(dto.quote.orderUuid, f.car.orderUuid); assert.equal(dto.quote.orderNumber, '0123456');
  assert.equal(dto.quote.facts.snapshotVersion, f.allocated.quote.facts.snapshotVersion);
  assert.equal(dto.quote.facts.display.name, f.allocated.quote.facts.display.name);
  assert.deepEqual(dto.quote.facts.sourceKeys, { stockId: f.car.orderUuid });
  assert.deepEqual(dto.quote.facts.facts, f.allocated.quote.facts.facts);
  assert.deepEqual(dto.quote.terms, f.allocated.quote.terms);
  assert.equal(dto.comparison.status, 'partial'); assert.equal(dto.comparison.comparisonAvailable, false);
  assert.deepEqual(dto.comparison.currentCar, { model: f.allocated.quote.eligibility.currentCarComparison.display.model,
    source: f.allocated.quote.eligibility.currentCarComparison.display.source });
  assert.equal(JSON.stringify(dto).match(/employeeId|principalId|tokenHash|tokenMetadata|contractId|employeeVersion|slotVersion|"binding"/), null);
  const cookie = cookieOf(exchanged.setCookie); const credential = cookie.split('=')[1];
  assertCustody(f, { allocated: f.allocated, dto }, credential);
  const replay = passed(await f.producer.allocate(f.context, f.input));
  assert.equal(JSON.stringify(replay).includes(f.token), false); assert.deepEqual(replay, f.allocated);
  const second = passed(await f.exchange()); assert.equal(second.offer.expiresAt, dto.expiresAt);
  assert.equal(second.setCookie === exchanged.setCookie, false);
  const restarted = createOfferAccessService(f.accessOptions);
  assert.deepEqual(passed(await restarted.fromSession(f.selector, cookie)).offer, dto);
  assert.deepEqual(passed(await f.access.fromAccount(f.context, f.selector)).offer, dto);
  assert.equal((await f.access.authorizeOffer(exchanged.context, f.selector, 'decide')).status, 'ok');
  for (const table of ['holds', 'offers', 'quotes', 'notification_outbox']) {
    assert.equal(passed(await f.repository.query(f.context, table)).length, 1);
  }
  assertCustody(f, dto, second.setCookie.split(';')[0].split('=')[1]);
  if (process.env.GCSP_OFFER_PRODUCER_SAMPLE) await writeFile(process.env.GCSP_OFFER_PRODUCER_SAMPLE, JSON.stringify(dto, null, 2)+'\n');
});

test('actual buddy expiry and real reset make old links current or stale without revival', async (t) => {
  const f = await setup(t); const access = passed(await f.exchange());
  passed(await f.producer.start());
  passed(await f.advanceTo(f.allocated.hold.expiresAt, 'producer-expiry'));
  passed(await f.tick('producer-expiry-tick'));
  const offer = passed(await f.repository.read(f.context, ref(f, 'offers', { offerId: f.selector.offerId })));
  const hold = passed(await f.repository.read(f.context, ref(f, 'holds', { holdId: f.allocated.hold.holdId })));
  const car = passed(await f.repository.read(f.context, ref(f, 'stock', { orderUuid: f.car.orderUuid })));
  assert.equal(offer.state, 'expired'); assert.equal(hold.state, 'expired');
  assert.equal(car.state, 'released'); assert.equal(car.available, true); assert.equal(car.held, false);
  const businessBefore = JSON.stringify(Object.fromEntries(['offers','holds','stock','claims','quotes','notification_outbox']
    .map((table) => [table,f.store.state.tables[table]])));
  for (let i=0;i<2;i+=1) {
    const read = passed(await f.exchange()).offer; assert.equal(read.state, 'expired');
    assert.equal(read.expiresAt, f.allocated.hold.expiresAt); assert.deepEqual(read.availableActions, []);
  }
  assert.equal(JSON.stringify(Object.fromEntries(['offers','holds','stock','claims','quotes','notification_outbox']
    .map((table) => [table,f.store.state.tables[table]]))), businessBefore);
  const state = passed(await f.clock.readState(f.presenter.context));
  passed(await f.clock.reset(f.presenter.context, { commandId:'producer-reset', expectedRunId:state.runId,
    expectedRunVersion:state.runVersion, scenarioVersion:state.versions.scenario, fixtureVersion:state.versions.fixture }));
  const stale = await f.exchange(); assert.equal(stale.status,'stale-run');
  assert.deepEqual(Object.keys(stale).sort(),['contractVersion','reason','status']);
  assert.deepEqual(await f.access.fromSession(f.selector,cookieOf(access.setCookie)),stale);
  for (const input of [{...f.selector,token:'A'.repeat(43)}, {...f.selector,offerId:'unknown',token:f.token}]) {
    assert.equal((await f.access.exchange(input)).status,'not-found');
  }
  assertCustody(f,stale);
});

test('actual pinned quote expiry preserves pending hold and existing no-action presentation', async (t) => {
  const f = await setup(t); const initial = passed(await f.exchange()).offer;
  assert.equal(Date.parse(initial.quote.validUntil) < Date.parse(initial.expiresAt),true);
  passed(await f.producer.start()); passed(await f.advanceTo(initial.quote.validUntil,'producer-quote-expiry'));
  passed(await f.tick('producer-quote-expiry-tick'));
  const current = passed(await f.exchange()).offer;
  assert.equal(current.state,'pending'); assert.equal(current.holdState,'active');
  assert.equal(current.expiresAt,initial.expiresAt); assert.deepEqual(current.availableActions,[]);
});
