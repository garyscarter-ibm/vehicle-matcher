import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository, createMemoryStore } from '../gcsp/repository/memory.js';
import { inputDigest, ok, FOUNDATION_TABLES } from '../gcsp/repository/core.js';
import { loadMigrations } from '../gcsp/migrations/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { createDemoRuntime } from '../gcsp/clock/index.js';
import { createSupplyService, createSyntheticProductionAdapter } from '../gcsp/supply/index.js';
import { createSupplyRoutes } from '../gcsp/supply/http.js';
import { createGcspHandler } from '../gcsp/identity/http.js';
import { readFile } from 'node:fs/promises';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createDemoStockProvider, createDemoUpstream, withConfirmedSupply } from '../gcsp/stock/demo-provider.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { essential, preference } from './helpers/employee-recommendation.js';

async function serviceFixture(options = {}) {
  const repository = createMemoryRepository({ store: createMemoryStore() }); await repository.open();
  const policy = options.policy ?? new PolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'orders-service', environmentKind: 'synthetic',
    policyAsOf: '2026-11-06T00:00:00.000Z', commandId: 'initialize', sessionNow: () => '2026-11-06T00:00:00.000Z' });
  assert.equal(runtime.status, 'ok', JSON.stringify(runtime));
  const { identity, clock } = runtime.value;
  const presenter = (await identity.createPresenterSession('presenter')).value.context;
  const greg = (await identity.switchPrincipal(presenter, 'demo-greg', 'greg')).value.context;
  const employee = (await identity.switchPrincipal(presenter, 'demo-paula', 'paula')).value.context;
  const production = options.production ?? createSyntheticProductionAdapter({ sourceVersion: 'test-production-v1',
    choices: [{ model: '3 Series', derivative: '320i Touring' }] });
  const queued = [];
  const releases = options.releases ?? { async queueConfirmedSupply(context, command, reference) {
    assert.equal((await identity.requireRole(context, 'greg')).status, 'ok');
    queued.push({ command, reference }); return ok({ ...reference, eligibleFrom: '2027-01-01T00:00:00.000Z' });
  } };
  const service = createSupplyService({ repository, policy, clock, identity, production, releases });
  return { repository, policy, identity, clock, presenter, greg, employee, service, production, queued };
}
async function submit(f, commandId = 'submit', quantity = 3) {
  const view = await f.service.readTracking(f.greg); assert.equal(view.status, 'ok', JSON.stringify(view));
  return f.service.submit(f.greg, { commandId, model: '3 Series', derivative: '320i Touring', quantity,
    expectedPolicyVersion: view.value.versions.policy, expectedStockVersion: view.value.versions.stock });
}

test('Greg submission pins current inputs, is idempotent and retains upstream intent only', async () => {
  const f = await serviceFixture();
  const view = (await f.service.readTracking(f.greg)).value;
  const input = { commandId: 'submit', model: '3 Series', derivative: '320i Touring', quantity: 3,
    expectedPolicyVersion: view.versions.policy, expectedStockVersion: view.versions.stock };
  const first = await f.service.submit(f.greg, input); assert.equal(first.status, 'ok', JSON.stringify(first));
  assert.equal(first.value.request.state, 'requested');
  assert.equal(first.value.request.stockVersion, view.versions.stock);
  assert.equal(first.value.request.policyVersion, view.versions.policy);
  assert.deepEqual(await f.service.submit(f.greg, input), first);
  assert.equal((await f.service.submit(f.greg, { ...input, quantity: 4 })).status, 'conflict');
  assert.equal((await f.repository.query(f.greg, 'future_order_requests')).value.length, 1);
  assert.equal((await f.repository.query(f.greg, 'confirmed_supply')).value.length, 0);
  assert.equal((await f.repository.query(f.greg, 'stock')).value.filter((s) => s.release).length, 0);
  await f.repository.close();
});

test('stale policy/stock pins, unknown choices and forged or employee contexts refuse submission', async () => {
  const f = await serviceFixture(); const view = (await f.service.readTracking(f.greg)).value;
  const input = { commandId: 'bad', model: '3 Series', derivative: '320i Touring', quantity: 3,
    expectedPolicyVersion: view.versions.policy, expectedStockVersion: view.versions.stock };
  assert.equal((await f.service.submit(f.greg, { ...input, expectedStockVersion: 'stale' })).status, 'stale-version');
  assert.equal((await f.service.submit(f.greg, { ...input, expectedPolicyVersion: 'stale' })).status, 'stale-version');
  assert.equal((await f.service.submit(f.greg, { ...input, derivative: 'Unknown' })).status, 'invalid');
  assert.equal((await f.service.submit(f.employee, input)).status, 'forbidden');
  assert.equal((await f.service.submit({ ...f.greg }, input)).status, 'forbidden');
  await f.repository.close();
});

test('presenter partial confirmation and delay remain distinct from stock; retryable Greg queue uses actual acknowledgement', async () => {
  const f = await serviceFixture(); const first = await submit(f); assert.equal(first.status, 'ok', JSON.stringify(first));
  let request = first.value.request;
  const input = { commandId: 'partial', requestId: request.requestId, expectedVersion: request.version, action: 'confirm', quantity: 1 };
  const partial = await f.service.stepProduction(f.presenter, input); assert.equal(partial.status, 'ok', JSON.stringify(partial));
  assert.deepEqual(await f.service.stepProduction(f.presenter, input), partial);
  assert.equal(partial.value.request.state, 'partly-confirmed');
  const supply = partial.value.supply;
  const lead = await f.policy.getAssumption('supply.leadTimeDays', { runId: f.greg.runId, policyVersion: f.greg.policyVersion,
    asOf: supply.confirmedAt });
  assert.equal(Date.parse(supply.expectedAt) - Date.parse(supply.confirmedAt), lead.value.value * 86400000);
  assert.equal((await f.service.queueConfirmed(f.greg, { commandId: 'queue', requestId: request.requestId })).status, 'ok');
  assert.deepEqual(f.queued[0].reference, { runId: f.greg.runId, supplyId: supply.supplyId, state: 'confirmed',
    confirmedAt: supply.confirmedAt, sourceVersion: supply.sourceVersion });
  request = partial.value.request;
  const delayed = await f.service.stepProduction(f.presenter, { commandId: 'delay', requestId: request.requestId,
    expectedVersion: request.version, action: 'delay', delayUntil: '2027-02-01T00:00:00.000Z', reason: 'Synthetic production delay' });
  assert.equal(delayed.status, 'ok', JSON.stringify(delayed));
  const tracking = (await f.service.readTracking(f.greg)).value.requests[0];
  assert.equal(tracking.stage, 'delayed'); assert.equal(tracking.confirmedQuantity, 1); assert.equal(tracking.releasedQuantity, 0);
  assert.equal(tracking.outstandingQuantity, 2); assert.equal(tracking.delay.until, '2027-02-01T00:00:00.000Z');
  assert.equal((await f.service.stepProduction(f.greg, input)).status, 'forbidden');
  assert.equal((await f.service.queueConfirmed(f.presenter, { commandId: 'forged', requestId: request.requestId })).status, 'forbidden');
  await f.repository.close();
});

test('unavailable production retains saved requests and queue failure retains the actual acknowledgement', async () => {
  let queueReady = false;
  const f = await serviceFixture({ releases: { async queueConfirmedSupply(c, command, reference) {
    return queueReady ? ok(reference) : { status: 'unavailable', reason: 'Explicit test failure', retryable: true };
  } } });
  const request = (await submit(f)).value.request;
  const confirmed = await f.service.stepProduction(f.presenter, { commandId: 'confirm-all', requestId: request.requestId,
    expectedVersion: request.version, action: 'confirm', quantity: request.quantity });
  assert.equal(confirmed.status, 'ok', JSON.stringify(confirmed));
  assert.equal((await f.service.queueConfirmed(f.greg, { commandId: 'queue', requestId: request.requestId })).status, 'unavailable');
  assert.equal((await f.repository.query(f.greg, 'confirmed_supply')).value.length, 1);
  queueReady = true;
  assert.equal((await f.service.queueConfirmed(f.greg, { commandId: 'queue', requestId: request.requestId })).status, 'ok');
  const unavailable = createSupplyService({ ...f, production: { async describe() { throw Error('private detail'); },
    async submit() { throw Error('private detail'); } } });
  const view = await unavailable.readTracking(f.greg);
  assert.equal(view.status, 'ok'); assert.equal(view.value.adapter.status, 'unavailable'); assert.equal(view.value.requests.length, 1);
  const out = await unavailable.submit(f.greg, { commandId: 'new', model: '3 Series', derivative: '320i Touring', quantity: 1,
    expectedPolicyVersion: view.value.versions.policy, expectedStockVersion: view.value.versions.stock });
  assert.equal(out.status, 'unavailable'); assert.equal(JSON.stringify(out).includes('private detail'), false);
  await f.repository.close();
});

test('concurrent acknowledgements cannot overconfirm; stale request revisions fail without an extra supply row', async () => {
  const f = await serviceFixture(); const request = (await submit(f, 'two', 2)).value.request;
  const results = await Promise.all(['a', 'b'].map((commandId) => f.service.stepProduction(f.presenter, {
    commandId, requestId: request.requestId, expectedVersion: request.version, action: 'confirm', quantity: 2 })));
  assert.equal(results.filter((r) => r.status === 'ok').length, 1);
  assert.equal(results.filter((r) => r.status === 'stale-version').length, 1);
  assert.equal((await f.repository.query(f.greg, 'confirmed_supply')).value.reduce((n, s) => n + s.quantity, 0), 2);
  const view = (await f.service.readTracking(f.greg)).value.requests[0];
  assert.equal((await f.service.stepProduction(f.presenter, { commandId: 'extra', requestId: request.requestId,
    expectedVersion: view.version, action: 'confirm', quantity: 1 })).status, 'conflict');
  await f.repository.close();
});

test('confirmation supersedes a delay for its quantity while retaining the delayed remainder', async () => {
  const f = await serviceFixture(); let request = (await submit(f)).value.request;
  request = (await f.service.stepProduction(f.presenter, { commandId: 'delay-first', requestId: request.requestId,
    expectedVersion: request.version, action: 'delay', delayUntil: '2027-03-01T00:00:00.000Z', reason: 'Synthetic delay' })).value.request;
  const partial = await f.service.stepProduction(f.presenter, { commandId: 'override-part', requestId: request.requestId,
    expectedVersion: request.version, action: 'confirm', quantity: 1 });
  assert.equal(partial.status, 'ok', JSON.stringify(partial));
  const lead = await f.policy.getAssumption('supply.leadTimeDays', { runId: f.greg.runId, policyVersion: f.greg.policyVersion,
    asOf: partial.value.supply.confirmedAt });
  assert.equal(Date.parse(partial.value.supply.expectedAt) - Date.parse(partial.value.supply.confirmedAt), lead.value.value * 86400000);
  let row = (await f.service.readTracking(f.greg)).value.requests[0];
  assert.equal(row.outstandingQuantity, 2); assert.equal(row.delay.until, '2027-03-01T00:00:00.000Z');
  const rest = await f.service.stepProduction(f.presenter, { commandId: 'override-rest', requestId: row.requestId,
    expectedVersion: row.version, action: 'confirm', quantity: 2 });
  assert.equal(rest.status, 'ok', JSON.stringify(rest));
  row = (await f.service.readTracking(f.greg)).value.requests[0];
  assert.equal(row.stage, 'confirmed'); assert.equal(row.delay, null);
  await f.repository.close();
});

test('HTTP boundary uses separate real acting and presenter cookies and rejects browser selectors', async () => {
  const f = await serviceFixture();
  const control = (await f.identity.createPresenterSession('http-presenter')).value;
  const acting = (await f.identity.switchPrincipal(control.context, 'demo-greg', 'http-greg')).value;
  const gregCookie = acting.setCookie.split(';')[0];
  const bothCookies = `${gregCookie}; ${control.setCookie[1].split(';')[0]}`;
  const handler = createGcspHandler({ identity: f.identity, routes: createSupplyRoutes(f.service), allowedOrigins: ['https://greg.test'] });
  const call = async (path, { method = 'GET', body = {}, cookie = bothCookies, query = '' } = {}) => {
    let captured;
    const req = { method, headers: { cookie, origin: 'https://greg.test' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
    await handler({ req, res: { setHeader() {} }, pathname: path, searchParams: new URLSearchParams(query), corsHeaders: {},
      sendJson(_res, status, value) { captured = { status, value }; } });
    return captured;
  };
  const view = (await call('/api/gcsp/greg/orders')).value.value;
  const input = { commandId: 'http-submit', model: '3 Series', derivative: '320i Touring', quantity: 3,
    expectedPolicyVersion: view.versions.policy, expectedStockVersion: view.versions.stock };
  const submitted = await call('/api/gcsp/greg/orders', { method: 'POST', body: input });
  assert.equal(submitted.status, 200, JSON.stringify(submitted));
  const request = submitted.value.value.request;
  const step = { commandId: 'http-confirm', requestId: request.requestId, expectedVersion: request.version, action: 'confirm', quantity: 1 };
  assert.equal((await call('/api/gcsp/presenter/production', { method: 'POST', body: step, cookie: gregCookie })).status, 403);
  assert.equal((await call('/api/gcsp/presenter/production', { method: 'POST', body: step })).status, 200);
  assert.equal((await call('/api/gcsp/greg/orders/queue', { method: 'POST', body: { commandId: 'http-queue', requestId: request.requestId } })).status, 200);
  for (const query of ['runId=forged', 'limit=1']) assert.equal((await call('/api/gcsp/greg/orders', { query })).status, 400);
  assert.equal((await call('/api/gcsp/greg/orders', { method: 'POST', body: { ...input, runId: 'forged' } })).status, 400);
  assert.equal((await call('/api/gcsp/greg/orders', { cookie: control.setCookie[0] })).status, 403);
  assert.equal((await f.repository.query(f.greg, 'stock')).value.filter((s) => s.release).length, 0);
  await f.repository.close();
});

test('tracking counts only successful release receipts matching retained stock provenance, including held stock', async () => {
  const f = await serviceFixture(); const request = (await submit(f, 'one', 1)).value.request;
  const supply = (await f.service.stepProduction(f.presenter, { commandId: 'confirmed-one', requestId: request.requestId,
    expectedVersion: request.version, action: 'confirm', quantity: 1 })).value.supply;
  const now = (await f.clock.now(f.greg)).value.now;
  const release = { trancheId: 'explicit-reader-fixture', supplyId: supply.supplyId, releasedAt: now,
    sourceVersion: 'explicit-source-v1', policyVersion: f.greg.policyVersion };
  const outcome = ok({ kind: 'stock-released', runId: f.greg.runId, trancheId: release.trancheId, supplyId: supply.supplyId,
    releasedAt: now, orderUuids: ['explicit-reader-car'], policyVersion: f.greg.policyVersion, source: { version: release.sourceVersion } });
  const fixture = await f.repository.transaction(f.greg, { commandId: 'explicit-release-reader-fixture', inputDigest: inputDigest(outcome) }, async (tx) => {
    const added = await tx.insert('stock', { runId: f.greg.runId, orderUuid: 'explicit-reader-car', state: 'held', available: false, held: true, release });
    if (added.status !== 'ok') return added;
    return tx.recordReceipt({ consumerId: 'stock-release', eventId: release.trancheId, eventType: 'stock-released', state: 'completed', outcome, inputDigest: inputDigest(outcome) });
  });
  assert.equal(fixture.status, 'ok', JSON.stringify(fixture));
  const view = await f.service.readTracking(f.greg); assert.equal(view.status, 'ok', JSON.stringify(view));
  assert.equal(view.value.requests[0].stage, 'released'); assert.equal(view.value.requests[0].releasedQuantity, 1);
  const stockRef = { table: 'stock', key: { runId: f.greg.runId, orderUuid: 'explicit-reader-car' } };
  const stock = (await f.repository.read(f.greg, stockRef)).value;
  await f.repository.transaction(f.greg, { commandId: 'corrupt-reader-fixture', inputDigest: inputDigest('corrupt') },
    (tx) => tx.compareAndSwap(stockRef, stock.version, { release: { ...release, sourceVersion: 'wrong-source' } }));
  assert.equal((await f.service.readTracking(f.greg)).status, 'unavailable');
  await f.repository.close();
});

test('tracking refuses mixed repository revisions and unavailable/empty production choice sets', async () => {
  const f = await serviceFixture(); let stockReads = 0;
  const repository = { ...f.repository, async query(context, table, ...rest) {
    if (table === 'stock' && ++stockReads === 2) await f.repository.transaction(context,
      { commandId: 'change-during-read', inputDigest: inputDigest('change') },
      (tx) => tx.insert('stock', { runId: context.runId, orderUuid: 'reader-race', state: 'unreleased', available: false }));
    return f.repository.query(context, table, ...rest);
  } };
  assert.equal((await createSupplyService({ ...f, repository }).readTracking(f.greg)).status, 'conflict');
  const production = { async describe() { const out = await f.production.describe(); return ok({ ...out.value, choices: [] }); } };
  const view = await createSupplyService({ ...f, production }).readTracking(f.greg);
  assert.equal(view.status, 'ok'); assert.equal(view.value.adapter.status, 'unavailable');
  await f.repository.close();
});

test('canonical lead-time change alters expected dates and delayed-command replay retains its original result after time advances', async () => {
  const source = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url)));
  source.assumptions.find((x) => x.key === 'supply.leadTimeDays').value = 2;
  const policy = new PolicyService({ provider: { async loadVersions() { return [source]; } } });
  const f = await serviceFixture({ policy }); const request = (await submit(f, 'policy', 2)).value.request;
  const input = { commandId: 'delay', requestId: request.requestId, expectedVersion: request.version,
    action: 'delay', delayUntil: '2026-11-08T00:00:00.000Z', reason: 'Synthetic scenario date' };
  const delayed = await f.service.stepProduction(f.presenter, input); assert.equal(delayed.status, 'ok');
  const time = (await f.clock.now(f.presenter)).value;
  assert.equal((await f.clock.advance(f.presenter, { commandId: 'advance', expectedClockVersion: time.clockVersion,
    to: '2026-11-09T00:00:00.000Z' })).status, 'ok');
  assert.deepEqual(await f.service.stepProduction(f.presenter, input), delayed);
  const confirmed = await f.service.stepProduction(f.presenter, { commandId: 'confirm', requestId: request.requestId,
    expectedVersion: delayed.value.request.version, action: 'confirm', quantity: 1 });
  assert.equal(confirmed.status, 'ok');
  assert.equal(Date.parse(confirmed.value.supply.expectedAt) - Date.parse(confirmed.value.supply.confirmedAt), 2 * 86400000);
  await f.repository.close();
});

const context = { environmentId: 'supply-test', runId: 'supply-run', principalId: 'greg', roles: ['greg'] };
const provenance = { providerId: 'synthetic-production', mode: 'synthetic', sourceVersion: 'production-v1' };
async function records() {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  assert.equal((await repository.open()).status, 'ok');
  let serial = 0;
  const write = (work) => { const id = `record-${++serial}`;
    return repository.transaction(context, { commandId: id, inputDigest: inputDigest(id) }, work); };
  assert.equal((await write((tx) => tx.insert('runs', { runId: context.runId,
    environmentId: context.environmentId, status: 'active', current: true }))).status, 'ok');
  return { store, repository, write };
}
const request = () => ({ runId: context.runId, requestId: 'request-a', commandId: 'submit-a',
  model: '3 Series', derivative: '320i Touring', quantity: 3, state: 'requested', requestedAt: '2026-11-06T00:00:00.000Z',
  requestedBy: context.principalId, policyVersion: 'policy-v1', stockVersion: 'stock-v1',
  providerReference: 'upstream-request-a', provenance, history: [] });
const supply = () => ({ runId: context.runId, supplyId: 'supply-a', requestId: 'request-a', commandId: 'confirm-a',
  quantity: 2, state: 'confirmed', confirmedAt: '2026-11-06T01:00:00.000Z',
  expectedAt: '2027-01-01T01:00:00.000Z', policyVersion: 'policy-v1',
  sourceVersion: 'production-v1', providerReference: 'upstream-ack-a', provenance });

test('business records persist separately across reopen and never create released stock', async () => {
  const f = await records();
  const written = await f.write(async (tx) => {
    const a = await tx.insert('future_order_requests', request());
    if (a.status !== 'ok') return a;
    return tx.insert('confirmed_supply', supply());
  });
  assert.equal(written.status, 'ok', JSON.stringify(written));
  await f.repository.close();
  const reopened = createMemoryRepository({ store: f.store }); await reopened.open();
  assert.equal((await reopened.query(context, 'future_order_requests')).value.length, 1);
  assert.equal((await reopened.query(context, 'confirmed_supply')).value[0].quantity, 2);
  assert.deepEqual((await reopened.query(context, 'stock')).value, []);
  const other = { ...context, runId: 'another-run' };
  assert.deepEqual((await reopened.query(other, 'confirmed_supply')).value, []);
  await reopened.close();
});

test('acknowledgement is immutable and must reference a request in the same run', async () => {
  const f = await records();
  const missing = await f.write((tx) => tx.insert('confirmed_supply', supply()));
  assert.equal(missing.status, 'conflict');
  assert.equal((await f.write((tx) => tx.insert('future_order_requests', request()))).status, 'ok');
  assert.equal((await f.write((tx) => tx.insert('confirmed_supply', supply()))).status, 'ok');
  const changed = await f.write((tx) => tx.compareAndSwap({ table: 'confirmed_supply',
    key: { runId: context.runId, supplyId: 'supply-a' } }, 1, { quantity: 3 }));
  assert.equal(changed.code, 'immutable-row');
  const duplicate = await f.write((tx) => tx.insert('confirmed_supply', { ...supply(), supplyId: 'supply-b' }));
  assert.equal(duplicate.status, 'conflict');
  await f.repository.close();
});

test('migration discovery and foundation snapshot include additive supply records', async () => {
  const migrations = await loadMigrations();
  const added = migrations.find((row) => row.filename === '0004_greg_supply.sql');
  assert.ok(added);
  for (const table of ['future_order_requests', 'confirmed_supply']) {
    assert.ok(FOUNDATION_TABLES.includes(table));
    assert.match(added.sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(added.sql, /REFERENCES future_order_requests\(run_id,request_id\)/);
});

// The real runtime and routes with the demo upstream: a confirmed request is the only way its stock appears.
test('allocation and demand update after a release from a confirmed request', async (t) => {
  const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
  const upstream = createDemoUpstream();
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: (deps) => withConfirmedSupply(createDemoStockProvider(deps), upstream),
    production: upstream.production, environmentId: 'orders-runtime-test', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'orders-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => runtime.close());
  assert.equal(runtime.dependencies.gcspSupply, runtime.supply);
  good(await buildServer({ ...runtime.dependencies, gcspAllowedOrigins: ['https://orders.test'] }).gcspStartup);
  const presenter = good(await runtime.identity.createPresenterSession('orders-presenter')).context;
  const greg = good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', 'orders-greg')).context;
  const paula = good(await runtime.identity.switchPrincipal(presenter, 'demo-paula', 'orders-paula')).context;
  good(await seedManualDemoContext({ repository: runtime.repository, identity: runtime.identity, clock: runtime.clock, context: paula }));
  good(await runtime.brief.saveDraft(paula, { commandId: 'brief-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  good(await runtime.brief.confirm(paula, { commandId: 'brief-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
  let ticks = 0;
  const tick = async () => { const now = good(await runtime.clock.now(presenter)); ticks += 1;
    return good(await runtime.clock.tick(presenter, { eventId: `orders-tick-${ticks}`, inputDigest: inputDigest(`orders-${ticks}`),
      expectedClockVersion: now.clockVersion })); };
  const advance = async (to) => good(await runtime.clock.advance(presenter, { commandId: `orders-advance-${to}`,
    expectedClockVersion: good(await runtime.clock.now(presenter)).clockVersion, to }));
  const outcome = (ticked, handlerId) => ticked.outcomes.find((row) => row.handlerId === handlerId).outcome.value;
  const touring = async () => good(await runtime.greg.readDemand(greg)).stock.byModelLine.find((row) => row.key === 'G21 Touring')?.released.count;
  const tracking = async () => good(await runtime.supply.readTracking(greg));

  // Greg requests 3, production confirms 2, Greg queues: confirmed with a date and nothing released.
  const view = await tracking();
  assert.deepEqual(view.adapter.choices.map((c) => c.model), ['3 Series Saloon', '3 Series Touring', 'i5 Touring']);
  const { request } = good(await runtime.supply.submit(greg, { commandId: 'orders-submit', model: '3 Series Touring', derivative: '320i',
    quantity: 3, expectedPolicyVersion: view.versions.policy, expectedStockVersion: view.versions.stock }));
  const { supply } = good(await runtime.supply.stepProduction(presenter, { commandId: 'orders-confirm', requestId: request.requestId,
    expectedVersion: request.version, action: 'confirm', quantity: 2 }));
  good(await runtime.supply.queueConfirmed(greg, { commandId: 'orders-queue', requestId: request.requestId }));
  let row = (await tracking()).requests[0];
  assert.equal(row.confirmedQuantity, 2); assert.equal(row.releasedQuantity, 0); assert.equal(row.outstandingQuantity, 1);
  assert.deepEqual(row.supplies.map((s) => [s.supplyId, s.expectedAt, s.queued]), [[supply.supplyId, supply.expectedAt, true]]);
  const ownStock = async () => (await runtime.repository.query(greg, 'stock')).value.filter((s) => s.release?.supplyId === supply.supplyId);

  // Fixed demo windows drain, but the supply stays unreleased until its policy lead time has passed.
  await advance(new Date(Date.parse(supply.expectedAt) - 86400000).toISOString());
  for (let i = 0; i < 4; i += 1) assert.notEqual(outcome(await tick(), 'stock-release').supplyId, supply.supplyId);
  assert.equal((await ownStock()).length, 0);
  assert.equal((await tracking()).requests[0].releasedQuantity, 0);

  // At expectedAt the tick releases exactly the confirmed 2 cars, never the unconfirmed third.
  await advance(supply.expectedAt);
  const before = await touring(); assert.equal(before.kind, 'band');
  let ticked; let released;
  for (let i = 0; i < 4 && !released; i += 1) {
    ticked = await tick(); const value = outcome(ticked, 'stock-release');
    if (value.supplyId === supply.supplyId) released = value;
  }
  assert.ok(released, 'the confirmed supply released on a tick');
  assert.equal(released.orderUuids.length, 2);
  const rows = await ownStock();
  assert.deepEqual(rows.map((s) => s.orderUuid).sort(), [...released.orderUuids].sort());
  assert.ok(rows.every((s) => s.state === 'released' && s.facts.facts.eligibilityModelKey.value === 'G21 Touring|320i'));
  row = (await tracking()).requests[0];
  assert.equal(row.releasedQuantity, 2); assert.equal(row.confirmedQuantity, 2); assert.equal(row.outstandingQuantity, 1);
  assert.equal(row.stage, 'partly-released');

  // Greg's demand sees the new stock (4 touring cars as a band, then 6 exact).
  const after = await touring(); assert.deepEqual([after.kind, after.value], ['exact', 6]);

  // The allocation stage ran on that release and weighed the new cars. The seeded employee holds none:
  // the demo employee fails policy/allowance gates for them, so this asserts evaluation, not a hold.
  const allocation = outcome(ticked, 'buddy-allocation').allocations.find((a) => a.event.eventType === 'stock-released'
    && released.orderUuids.every((id) => a.inputVersions.stock.some((s) => s.orderUuid === id)));
  assert.ok(allocation, 'allocation considered the released supply cars');
  const decided = allocation.evaluations.find((e) => e.employeeId === paula.employeeId).decisions.map((d) => d.orderUuid);
  for (const id of released.orderUuids) assert.ok(decided.includes(id));
});
