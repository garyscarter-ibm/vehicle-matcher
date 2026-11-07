// Public manual ordering contract through the real server and memory runtime composition.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';

const origin = 'https://order-http.test';
const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const seededTerms = seed.assumptions.find((row) => row.key === 'ordering.terms.v1').value;
const good = (value) => { assert.equal(value?.status, 'ok'); return value.value; };
const cookies = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');
async function request(f, path, { body, method = body === undefined ? 'GET' : 'POST', session = f.cookie } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method, headers: { host: 'order-http.test', origin, ...(session ? { cookie: session } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
    end(text) { this.body = text; } };
  await f.server.listeners('request')[0](req, response);
  return { status: response.status, json: response.body ? JSON.parse(response.body) : null };
}
async function setup(t) {
  const profile = createCompositionTestProfile();
  const repository = createMemoryRepository({ store: createMemoryStore() });
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider: profile, environmentId: 'order-http-test',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'order-http-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const local = good(await runtime.createLocalSession());
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookies(local.setCookie), purpose: 'presenter-control' }));
  const f = { ...runtime, runtime, profile, employee: local.context, cookie: cookies(local.setCookie), presenter };
  t.after(() => runtime.close());
  f.server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] }); good(await f.server.gcspStartup);
  return f;
}
// Draft, release the TEST car, claim it and begin order review; returns a valid submit body.
async function toOrderReview(f) {
  const account = good((await request(f, '/api/gcsp/manual/account')).json);
  const action = account.actions.find((entry) => entry.enabled);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee');
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(f.employee.schemeId) && entry.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
    requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
    brand: account.choices.brands[0], contact: account.account.contact,
    expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
  assert.equal((await request(f, '/api/gcsp/manual/draft', { body: { commandId: 'draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices } })).status, 200);
  const car = await f.profile.prepare(f.runtime, f.employee);
  const to = '2026-11-05T12:00:00.000Z';
  const time = good(await f.clock.now(f.presenter));
  good(await f.clock.advance(f.presenter, { commandId: 'advance', expectedClockVersion: time.clockVersion, to }));
  const next = good(await f.clock.now(f.presenter));
  good(await f.clock.tick(f.presenter, { eventId: 'release', inputDigest: inputDigest('release'), expectedClockVersion: next.clockVersion }));
  const browse = good((await request(f, '/api/gcsp/manual/stock')).json);
  const decision = browse.decisions.find((row) => row.orderUuid === car.orderUuid); assert.ok(decision?.claimInput);
  const claimed = await request(f, '/api/gcsp/manual/claim', { body: { commandId: 'claim', ...decision.claimInput } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const held = good(claimed.json);
  const reviewed = await request(f, '/api/gcsp/manual/claim/review', { body: { commandId: 'review', holdId: held.hold.holdId,
    expectedHoldVersion: held.hold.version, expectedDraftVersion: 1 } });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.json));
  const { hold, quote } = good(reviewed.json);
  const stock = good(await f.repository.read(f.employee, { table: 'stock', key: { runId: f.employee.runId, orderUuid: hold.orderUuid } }));
  const terms = good((await request(f, '/api/gcsp/manual/order/terms')).json);
  return { car, body: { commandId: 'submit', source: { type: 'cart', holdId: hold.holdId, expectedHoldVersion: hold.version,
    expectedDraftVersion: 1 }, expectedQuoteId: quote.quoteId, expectedStockVersion: stock.version,
  termsDigest: terms.termsDigest, declarations: { terms: true, driver: true, return: true } } };
}

test('terms read serves the canonical versioned terms and declarations', async (t) => {
  const f = await setup(t);
  const response = await request(f, '/api/gcsp/manual/order/terms'); assert.equal(response.status, 200);
  const terms = good(response.json);
  assert.match(terms.termsDigest, /\S/);
  assert.equal(terms.termsVersion, seededTerms.termsVersion);
  assert.deepEqual(terms.declarations.map((row) => row.id), seededTerms.declarations.map((row) => row.id));
});

test('submit, repeat with a new commandId and reopen return one order and operation', async (t) => {
  const f = await setup(t); const { car, body } = await toOrderReview(f);
  const first = await request(f, '/api/gcsp/manual/order', { body });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const value = first.json.value;
  assert.equal(value.view.state, 'awaiting-approval', JSON.stringify(value.view));
  assert.equal(value.order.orderNumber, car.orderNumber); assert.match(value.order.orderNumber, /^\d{7}$/);
  const again = await request(f, '/api/gcsp/manual/order', { body: { ...body, commandId: 'double-click' } });
  assert.equal(again.status, first.status);
  assert.equal(again.json.value.operationId, value.operationId); assert.deepEqual(again.json.value.order, value.order);
  const read = await request(f, '/api/gcsp/manual/order'); assert.equal(read.status, 200);
  assert.equal(read.json.value.operationId, value.operationId); assert.equal(read.json.value.view.state, 'awaiting-approval');
  const operations = good(await f.repository.query(f.employee, 'pending_operations', { operationType: 'selection-order' }));
  assert.equal(operations.length, 1);
  const second = good(await createGcspRuntime({ mode: 'memory', repository: f.repository, environmentId: 'order-http-test',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'order-http-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => second.close());
  const reopened = buildServer({ ...second.dependencies, gcspAllowedOrigins: [origin] }); good(await reopened.gcspStartup);
  const afterReopen = await request({ ...f, server: reopened }, '/api/gcsp/manual/order');
  assert.equal(afterReopen.status, 200); assert.equal(afterReopen.json.value.operationId, value.operationId);
});

test('a wrong termsDigest is a reviewable conflict and creates no order', async (t) => {
  const f = await setup(t); const { body } = await toOrderReview(f);
  const refused = await request(f, '/api/gcsp/manual/order', { body: { ...body, termsDigest: 'stale-digest' } });
  assert.equal(refused.status, 409); assert.equal(refused.json.reason, 'terms-changed');
  assert.equal(refused.json.view.state, 'review-required');
  assert.equal(good(await f.repository.query(f.employee, 'pending_operations', { operationType: 'selection-order' })).length, 0);
  assert.equal((await request(f, '/api/gcsp/manual/order')).status, 404);
});

test('queries are refused and a missing session is unauthenticated', async (t) => {
  const f = await setup(t);
  for (const path of ['/api/gcsp/manual/order?x=1', '/api/gcsp/manual/order/terms?x=1']) {
    const response = await request(f, path); assert.equal(response.status, 400);
    assert.equal(response.json.code, 'unsupported-query');
  }
  for (const path of ['/api/gcsp/manual/order', '/api/gcsp/manual/order/terms']) {
    assert.equal((await request(f, path, { session: null })).status, 401);
  }
});
