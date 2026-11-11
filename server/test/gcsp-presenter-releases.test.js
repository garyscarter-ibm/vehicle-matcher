// FUCQ-364: presenter-only, user-agnostic read of the run's latest release, on demo and generated stock.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../gcsp/repository/index.js';
import { createDemoStockProvider, createRunStockProviderFactory } from '../gcsp/stock/index.js';
import { readDisplayImageCatalogue } from '../gcsp/vehicle-evidence/display-images.js';
import { buildServer } from '../index.js';

const ORIGIN = 'https://releases.test';
const PATH = 'presenter/releases/latest';
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const jar = (setCookie) => [].concat(setCookie).map((value) => value.split(';')[0]).join('; ');
const roots = [];
after(async () => { for (const directory of roots) await rm(directory, { recursive: true, force: true }); });

async function compose(t, { generated = false, main = false, environmentId = 'presenter-releases' } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  let stockProvider = createDemoStockProvider;
  if (generated) {
    const directory = await mkdtemp(join(process.env.TMPDIR || tmpdir(), 'gcsp-releases-')); roots.push(directory);
    stockProvider = createRunStockProviderFactory({ env: { GCSP_STOCK_INVENTORY_PATH: join(directory, 'inventory.json') }, logger: () => {} });
  }
  const services = good(await createGcspRuntime({ mode: 'memory', repository, environmentId, stockProvider,
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: `${environmentId}-bootstrap`, adoptOfferJourney: main, sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => services.close());
  let presenter = good(await services.identity.createPresenterSession(`${environmentId}-presenter`));
  if (main) {
    const scenario = good(await services.scenarios.readCatalogue(presenter.context)).scenarios.find((row) => row.scenarioId === 'main-successful-journey');
    const state = good(await services.clock.readState(presenter.context));
    const reset = good(await services.scenarios.reset(presenter.context, { commandId: 'main-start', expectedRunId: state.runId,
      expectedRunVersion: state.runVersion, scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
      fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion }));
    assert.equal(reset.startState.status, 'ok');
    presenter = good(await services.identity.createPresenterSession(`${environmentId}-main-presenter`));
  }
  const server = buildServer({ ...services.dependencies, gcspAllowedOrigins: [ORIGIN] });
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); });
  assert.equal((await server.gcspStartup).status, 'ok');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = jar(presenter.setCookie);
  const call = async (path, { as = cookie } = {}) => {
    const response = await fetch(`${base}/api/gcsp/${path}`, { headers: { Origin: ORIGIN, ...(as ? { cookie: as } : {}) } });
    return { status: response.status, body: await response.json() };
  };
  const release = async (commandId) => {
    const state = good(await services.clock.readState(presenter.context));
    const reply = good(await services.clock.advanceAndTick(presenter.context, { commandId, expectedClockVersion: state.clockVersion, mode: 'next-release' }));
    return reply.tick.outcomes.find((row) => row.handlerId === 'stock-release').outcome.value;
  };
  return { services, repository, store, context: presenter.context, call, release };
}

const EMPLOYEE_WORDS = /employee|paula|alex|eligib|gateStatus|suitab|offer|match|hold|quote|brief|score|grade|principal/i;
function assertUserAgnostic(value) {
  assert.deepEqual(Object.keys(value).sort(), ['allocation', 'cars', 'charts', 'counts', 'modelLines', 'release', 'runId']);
  assert.deepEqual(Object.keys(value.counts).sort(), ['buddyAllocated', 'colours', 'manuallyAllocated', 'modelLines', 'onScheme', 'released', 'totalReleased']);
  for (const car of value.cars) assert.deepEqual(Object.keys(car).sort(), ['colourName', 'id', 'imageAlt', 'imageSrc', 'modelLine', 'modelName']);
  assert.doesNotMatch(JSON.stringify(value), EMPLOYEE_WORDS);
}

async function catalogueSources() {
  const data = await readDisplayImageCatalogue();
  const images = [...data.configurations.map((row) => row.image), ...Object.values(data.variants), ...Object.values(data.models)];
  return new Set(images.flatMap((image) => [`/${image.asset}`, `/api/gcsp/vehicle-images/${image.imageId}.webp`]));
}

test('demo stock: release null with zero counts before a release, then the first window with images, lines and colours', async (t) => {
  const f = await compose(t);
  const before = await f.call(PATH);
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.value, { runId: f.context.runId, allocation: { pending: 0, declined: 0, accepted: 0 }, release: null, cars: [], modelLines: [], charts: { colours: [], fuel: [], points: [] },
    counts: { released: 0, modelLines: 0, colours: 0, totalReleased: 0, onScheme: 0, buddyAllocated: 0, manuallyAllocated: 0 } });
  const released = await f.release('first-release');
  const reply = await f.call(PATH);
  assert.equal(reply.status, 200);
  const value = reply.body.value;
  assertUserAgnostic(value);
  assert.deepEqual(value.release, { windowId: released.windowId, releasedAt: released.releasedAt, trancheId: released.trancheId });
  assert.deepEqual(value.cars.map((car) => car.id), released.orderUuids);
  assert.equal(value.counts.released, released.orderUuids.length);
  const sources = await catalogueSources();
  for (const car of value.cars) {
    assert.ok(sources.has(car.imageSrc), `catalogue image for ${car.modelName}: ${car.imageSrc}`);
    assert.match(car.imageSrc, /^\/assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/, 'a local asset, no live image call');
    assert.match(car.modelName, /^BMW /); assert.match(car.modelLine, /^BMW /);
    // The saloon's catalogue picture names no paint, so its colour stays unknown rather than invented.
    assert.equal(car.colourName === null, /Saloon/.test(car.modelName), car.modelName);
    assert.equal(car.imageAlt, car.colourName ? `${car.modelName} in ${car.colourName}` : car.modelName);
  }
  assert.ok(value.cars.some((car) => car.colourName === 'Alpine White'));
  assert.equal(value.modelLines.reduce((sum, row) => sum + row.count, 0), value.counts.released);
  assert.equal(value.counts.modelLines, value.modelLines.length);
  assert.equal(value.counts.colours, new Set(value.cars.map((car) => car.colourName).filter(Boolean)).size);
  const stock = good(await f.repository.query(f.context, 'stock'));
  const free = stock.filter((row) => row.state === 'released' && row.available === true && row.held !== true && row.allocated !== true);
  assert.equal(value.counts.onScheme, free.length);
  assert.equal(value.counts.totalReleased, released.orderUuids.length);
  assert.equal(value.counts.buddyAllocated, 0); assert.equal(value.counts.manuallyAllocated, 0);
});

test('a later release replaces the first as latest', async (t) => {
  const f = await compose(t, { generated: true, environmentId: 'presenter-releases-two' });
  const first = await f.release('release-one');
  const second = await f.release('release-two');
  // Generated stock can release two tranches of one window, so the tranche identifies the release.
  assert.notEqual(first.trancheId, second.trancheId);
  assert.ok(Date.parse(second.releasedAt) > Date.parse(first.releasedAt));
  const { value } = (await f.call(PATH)).body;
  assert.deepEqual(value.release, { windowId: second.windowId, releasedAt: second.releasedAt, trancheId: second.trancheId });
  assert.deepEqual(value.cars.map((car) => car.id), second.orderUuids);
  assert.equal(value.counts.released, second.orderUuids.length);
  assert.equal(value.counts.totalReleased, new Set([...first.orderUuids, ...second.orderUuids]).size);
  assert.equal(value.counts.totalReleased, value.counts.onScheme + value.counts.buddyAllocated + value.counts.manuallyAllocated);
});

test('the main journey first release reports 100 latest and total, 99 unallocated and 1 Buddy allocation', async (t) => {
  const f = await compose(t, { generated: true, main: true, environmentId: 'presenter-first-allocation' });
  await f.release('main-release');
  const value = good((await f.call(PATH)).body);
  assertUserAgnostic(value);
  assert.equal(value.counts.released, 100); assert.equal(value.counts.totalReleased, 100);
  assert.deepEqual(value.allocation, { pending: 1, declined: 0, accepted: 0 });
  assert.equal(value.counts.onScheme, 99); assert.equal(value.counts.buddyAllocated, 1); assert.equal(value.counts.manuallyAllocated, 0);
});

test('allocation totals use each current Buddy/manual car once and release or expiry returns it to unallocated', async (t) => {
  const f = await compose(t, { environmentId: 'presenter-allocation-lifecycle' });
  const released = await f.release('allocation-release');
  const all = released.orderUuids.length;
  const ref = (table, key) => ({ table, key: { runId: f.context.runId, ...key } });
  const command = (commandId) => ({ commandId, inputDigest: inputDigest(commandId) });
  for (const [i, type] of ['buddy-offer', 'cart'].entries()) {
    const employee = good(await f.services.identity.switchPrincipal(f.context, i ? 'demo-alex' : 'demo-paula', `allocation-employee-${i}`)).context;
    good(await f.repository.transaction(f.context, command(`allocation-${i}`), async (tx) => {
      const stock = good(await tx.get(ref('stock', { orderUuid: released.orderUuids[i] })));
      const slot = good(await tx.get(ref('entitlement_slots', { entitlementSlotId: employee.entitlementSlotId })));
      const quoteId = `stats-quote-${i}`;
      good(await tx.insert('quotes', { runId: f.context.runId, quoteId, orderUuid: stock.orderUuid, employeeId: employee.employeeId, policyVersion: f.context.policyVersion }));
      const available = good(await tx.compareAndSwap(ref('stock', { orderUuid: stock.orderUuid }), stock.version, { state: 'available' }));
      const held = good(await tx.conditionalClaim({ orderUuid: stock.orderUuid, holdId: `stats-hold-${i}`, claimId: `stats-claim-${i}`,
        employeeId: employee.employeeId, entitlementSlotId: employee.entitlementSlotId, type, expiresAt: '2026-11-06T18:00:00.000Z',
        policyVersion: f.context.policyVersion, quoteId, expectedStockVersion: available.version, expectedSlotVersion: slot.version }));
      good(await tx.compareAndSwap(ref('stock', { orderUuid: stock.orderUuid }), held.stockVersion, { available: false, held: true, allocated: false }));
      return ok({});
    }));
  }
  const counts = async () => good((await f.call(PATH)).body).counts;
  assert.deepEqual(await counts(), { released: all, modelLines: 4, colours: 2, totalReleased: all, onScheme: all - 2, buddyAllocated: 1, manuallyAllocated: 1 });
  const change = async (i, state) => good(await f.repository.transaction(f.context, command(`allocation-${i}-${state}`), async (tx) => {
    for (const [table, key] of [['holds', { holdId: `stats-hold-${i}` }], ['claims', { claimId: `stats-claim-${i}` }]]) {
      const row = good(await tx.get(ref(table, key))); good(await tx.compareAndSwap(ref(table, key), row.version, { state }));
    }
    const key = { orderUuid: released.orderUuids[i] }; const stock = good(await tx.get(ref('stock', key)));
    const free = ['expired', 'released', 'claim-failed'].includes(state); const allocated = state === 'allocated';
    good(await tx.compareAndSwap(ref('stock', key), stock.version, { state: free ? 'released' : allocated ? 'allocated' : 'held', available: free, held: !free && !allocated, allocated }));
    return ok({});
  }));
  for (const state of ['claim-pending', 'release-pending', 'selection-pending', 'allocated']) {
    await change(1, state); const current = await counts();
    assert.equal(current.manuallyAllocated, 1, state); assert.equal(current.buddyAllocated, 1, state); assert.equal(current.onScheme, all - 2, state);
  }
  await change(1, 'released');
  assert.equal((await counts()).manuallyAllocated, 0); assert.equal((await counts()).onScheme, all - 1);
  await change(0, 'expired');
  assert.equal((await counts()).buddyAllocated, 0); assert.equal((await counts()).onScheme, all);
});

test('generated stock: the release reads its model lines and colours from the generated rows', async (t) => {
  const f = await compose(t, { generated: true, environmentId: 'presenter-releases-generated' });
  const released = await f.release('generated-release');
  const { value } = (await f.call(PATH)).body;
  assertUserAgnostic(value);
  assert.equal(value.release.windowId, released.windowId);
  assert.equal(value.counts.released, released.orderUuids.length);
  assert.ok(value.counts.released > 0);
  const sources = await catalogueSources();
  const rows = new Map(good(await f.repository.query(f.context, 'stock')).map((row) => [row.orderUuid, row]));
  for (const car of value.cars) {
    const facts = rows.get(car.id).facts.facts;
    assert.equal(car.colourName, facts.colour.value);
    assert.ok(sources.has(car.imageSrc), car.imageSrc);
    assert.match(car.modelLine, /^BMW /); assert.doesNotMatch(car.modelName, / in /);
  }
  assert.equal(value.modelLines.reduce((sum, row) => sum + row.count, 0), value.counts.released);
  // Charts: every released car is counted once in colour, fuel and points; seven lines follow the mockup mix.
  const total = (list) => list.reduce((sum, row) => sum + row.count, 0);
  for (const name of ['colours', 'fuel', 'points']) assert.equal(total(value.charts[name]), value.counts.released, name);
  assert.ok(value.charts.points.every((row) => /^\d+$/.test(row.label)));
  assert.ok(value.charts.fuel.every((row) => ['Petrol', 'Diesel', 'Plug-in hybrid', 'Electric'].includes(row.label)));
  assert.equal(value.modelLines.length, 7);
});

test('the read writes nothing', async (t) => {
  const f = await compose(t, { environmentId: 'presenter-releases-read-only' });
  await f.release('read-only-release');
  await f.call(PATH);
  const tables = JSON.stringify(f.store.state.tables);
  const state = f.store.state;
  for (let i = 0; i < 3; i += 1) assert.equal((await f.call(PATH)).status, 200);
  assert.equal(f.store.state, state, 'no transaction committed');
  assert.equal(JSON.stringify(f.store.state.tables), tables);
});

test('no cookie, an employee and Greg are refused; query selectors are invalid', async (t) => {
  const f = await compose(t, { environmentId: 'presenter-releases-refused' });
  await f.release('refused-release');
  const none = await f.call(PATH, { as: null });
  assert.equal(none.status, 403); assert.equal(none.body.status, 'forbidden');
  for (const principal of ['demo-paula', 'demo-greg']) {
    const switched = good(await f.services.identity.switchPrincipal(f.context, principal, `switch-${principal}`));
    const refused = await f.call(PATH, { as: jar(switched.setCookie) });
    assert.equal(refused.status, 403, principal); assert.equal(refused.body.status, 'forbidden');
    assert.ok(!('value' in refused.body));
  }
  for (const query of ['?runId=other', '?limit=1', '?windowId=x']) {
    const reply = await f.call(`${PATH}${query}`);
    assert.equal(reply.status, 400, query); assert.equal(reply.body.status, 'invalid');
  }
});

test('a run without stock configured answers the existing unavailable shape', async (t) => {
  const repository = createMemoryRepository({ store: createMemoryStore() });
  const services = good(await createGcspRuntime({ mode: 'memory', repository, environmentId: 'presenter-releases-none',
    policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'none-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => services.close());
  assert.equal(services.dependencies.gcspStockRelease, undefined);
  const presenter = good(await services.identity.createPresenterSession('none-presenter'));
  const server = buildServer({ ...services.dependencies, gcspAllowedOrigins: [ORIGIN] });
  t.after(async () => { server.closeAllConnections(); if (server.listening) await new Promise((done) => server.close(done)); });
  assert.equal((await server.gcspStartup).status, 'ok');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gcsp/${PATH}`, { headers: { Origin: ORIGIN, cookie: jar(presenter.setCookie) } });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'unavailable'); assert.equal(body.retryable, true); assert.ok(body.reason);
});
