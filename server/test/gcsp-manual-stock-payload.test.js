// Wire shape of GET /api/gcsp/manual/stock: compact over HTTP, full DTO in process, expanded by the browser adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest, result } from '../gcsp/repository/index.js';
import { createSyntheticStockProvider } from '../gcsp/stock/index.js';
import { compactStockPayload } from '../gcsp/manual-gallery/stock-payload.js';
import { expandStockPayload } from '../../blocks/gcsp/account/stock-payload.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';
import { stock, fact } from './helpers/employee-recommendation.js';

const origin = 'https://stock-payload.test';
const good = (value) => { assert.equal(value?.status, 'ok', JSON.stringify(value)); return value.value; };
const cookies = (value) => [value].flat().map((entry) => entry.split(';')[0]).join('; ');
async function request(f, path, { body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: { host: 'stock-payload.test', origin,
    cookie: f.cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
    end(text) { this.body = text; } };
  await f.server.listeners('request')[0](req, response);
  return { status: response.status, text: response.body, json: response.body ? JSON.parse(response.body) : null };
}

async function setup(t) {
  let inner = null;
  const provider = { async pull(input) { return inner ? inner.pull(input) : result('unavailable', { reason: 'Not prepared.', retryable: true }); } };
  const repository = createMemoryRepository({ store: createMemoryStore() });
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider: provider, environmentId: 'stock-payload-test',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'stock-payload-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => runtime.close());
  const local = good(await runtime.createLocalSession());
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookies(local.setCookie), purpose: 'presenter-control' }));
  const f = { ...runtime, runtime, employee: local.context, cookie: cookies(local.setCookie), presenter };
  f.server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] }); good(await f.server.gcspStartup);
  const account = good((await request(f, '/api/gcsp/manual/account')).json);
  const action = account.actions.find((entry) => entry.enabled);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee');
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(f.employee.schemeId) && entry.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  const saved = await request(f, '/api/gcsp/manual/draft', { body: { commandId: 'draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices: { mode: action.action === 'replace' ? 'replacement' : 'new',
      oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId,
      contractOptionId: option.contractOptionId, requestedCollectionDate: account.currentContract.earliestCollectionDate,
      collectionLocationId: location.locationId, brand: account.choices.brands[0], contact: account.account.contact,
      expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' } } });
  assert.equal(saved.status, 200);
  const visible = { companyIds: [f.employee.companyId], schemeIds: [f.employee.schemeId], employeeIds: null };
  const cars = [21, 22, 23].map((id) => {
    const car = stock(id, { eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'), boot: fact(380, 'L'),
      sizeClass: fact(2, 'ordinal-1-5'), insuranceGroup: fact(25, 'insurance-group') }, 'RjcwOlMx');
    return { orderUuid: car.orderUuid, orderNumber: `91235${id}`, configurationId: car.configurationId, facts: car.snapshot,
      availability: { availableUntil: car.availability.availableUntil }, visibility: structuredClone(visible) };
  });
  inner = createSyntheticStockProvider({ runId: f.employee.runId, version: 'TEST-stock-payload-v1', label: 'Offline TEST source',
    windows: [{ windowId: 'TEST-noon', availableAt: '2026-11-05T12:00:00.000Z', supplyId: null, stock: cars }] });
  const time = good(await f.clock.now(f.presenter));
  good(await f.clock.advance(f.presenter, { commandId: 'advance', expectedClockVersion: time.clockVersion, to: '2026-11-05T12:00:00.000Z' }));
  const next = good(await f.clock.now(f.presenter));
  good(await f.clock.tick(f.presenter, { eventId: 'release', inputDigest: inputDigest('release'), expectedClockVersion: next.clockVersion }));
  f.cars = cars;
  return f;
}

test('the stock route sends the compact shape and the client expands it to the in-process answer', async (t) => {
  const f = await setup(t);
  const response = await request(f, '/api/gcsp/manual/stock'); assert.equal(response.status, 200);
  const wire = good(response.json);
  const inProcess = good(await f.manualRead.browseStock(f.employee));
  assert.equal(inProcess.decisions.length, 3); assert.equal(inProcess.cars.length, 3);
  assert.equal(wire.payloadShape, 'manual-stock-compact-v1');
  assert.deepEqual(wire.sharedVersionKeys, ['brief', 'facts', 'policy', 'stock', 'clock']);
  assert.equal(Array.isArray(wire.cars), false); assert.deepEqual(wire.carIds, inProcess.cars.map((car) => car.orderUuid));
  for (const row of wire.decisions) {
    for (const key of wire.sharedVersionKeys) assert.equal(key in row.versions, false, key);
    assert.deepEqual(Object.keys(row.versions), ['snapshot', 'terms', 'availability']);
  }
  assert.deepEqual(wire.carIds, inProcess.decisions.filter((row) => row.gateStatus === 'eligible').map((row) => row.orderUuid));
  assert.deepEqual(wire.versions, inProcess.versions);
  assert.deepEqual(expandStockPayload(wire), inProcess);
  const full = JSON.stringify(inProcess).length;
  t.diagnostic(`manual stock body: ${full} bytes in process, ${response.text.length} bytes over HTTP`);
  assert.ok(response.text.length <= full * 0.6, `${response.text.length} vs ${full}`);
});

test('the account adapter expands the compact stock answer, passes the old shape through and refuses a dangling car id', async (t) => {
  const f = await setup(t);
  const wire = good((await request(f, '/api/gcsp/manual/stock')).json);
  const inProcess = good(await f.manualRead.browseStock(f.employee));
  const adapter = (value, status = 'ok') => createAccountHttpAdapter({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status, value }) }) });
  assert.deepEqual(good(await adapter(wire).browseStock()), inProcess);
  assert.deepEqual(good(await adapter(inProcess).browseStock()), inProcess);
  const dangling = await adapter({ ...wire, carIds: [...wire.carIds, 'missing'] }).browseStock();
  assert.deepEqual([dangling.status, dangling.code], ['unavailable', 'account-response-invalid']);
  const missingKey = await adapter({ ...wire, versions: { brief: wire.versions.brief } }).browseStock();
  assert.equal(missingKey.status, 'unavailable');
});

test('compaction leaves an unexpected shape unchanged and never mutates its input', async (t) => {
  const f = await setup(t);
  const inProcess = good(await f.manualRead.browseStock(f.employee));
  const differing = { ...inProcess, cars: inProcess.cars.map((car, index) => (index ? car : { ...car, score: -1 })) };
  assert.equal(compactStockPayload(differing), differing);
  const duplicate = { ...inProcess, decisions: [inProcess.decisions[0], inProcess.decisions[0]] };
  assert.equal(compactStockPayload(duplicate), duplicate);
  assert.equal(compactStockPayload({ state: 'empty-stock' }).payloadShape, undefined);
  const before = JSON.stringify(inProcess);
  const compact = compactStockPayload(inProcess); assert.equal(compact.payloadShape, 'manual-stock-compact-v1');
  assert.equal(JSON.stringify(inProcess), before);
  assert.equal(expandStockPayload({ state: 'x' }).state, 'x');
});
