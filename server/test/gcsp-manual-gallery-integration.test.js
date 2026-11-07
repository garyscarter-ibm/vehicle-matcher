// Authenticated in-process memory integration. Offline TEST source; no listener,
// browser, F77/F78 provider, native database, live claim or F70 acceptance proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { seedManualDemoContext } from '../gcsp/manual-context/fixtures.js';
import { createStockReleaseService, createSyntheticStockProvider } from '../gcsp/stock/index.js';
import { createStockReleaseHistoryPort } from '../gcsp/stock/history-port.js';
import { createManualGalleryStockRead } from '../gcsp/manual-gallery/stock-read.js';
import { stock, fact } from './helpers/employee-recommendation.js';

const origin = 'https://demo.invalid';
const good = (outcome) => { assert.equal(outcome.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const cookie = (value) => [value].flat().map((part) => part.split(';')[0]).join('; ');
const command = (id) => ({ commandId: id, inputDigest: inputDigest(id) });
async function request(server, path, { body, session } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: {
    host: 'demo.invalid', origin, ...(session ? { cookie: session } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
    end(value) { this.body = value; } };
  await server.listeners('request')[0](req, response);
  return { ...response, json: response.body ? JSON.parse(response.body) : null };
}

// Test composition only. Class methods retain their original private-field receiver.
// Central F100 owns the delivered wiring; no second claims service is constructed.
function bindClaims(manual, read) {
  const methods = ['readAccount', 'readDraft', 'saveDraft', 'readClaim', 'readQuote',
    'claim', 'beginReview', 'release', 'registerClockHandler'];
  return Object.freeze({ ...Object.fromEntries(methods.map((key) => [key, manual[key].bind(manual)])),
    browseStock: read.browseStock.bind(read) });
}

async function setup(t, { hiddenFirst = false } = {}) {
  const store = createMemoryStore();
  const repository = createMemoryRepository({ store });
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository,
    environmentId: 'manual-gallery-integration', policyAsOf: '2026-11-05T00:00:00.000Z',
    commandId: 'bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => runtime.close());
  const presenter = good(await runtime.identity.createPresenterSession('presenter'));
  const acting = good(await runtime.identity.switchPrincipal(presenter.context, 'demo-paula', 'paula'));
  const greg = good(await runtime.identity.switchPrincipal(presenter.context, 'demo-greg', 'greg'));
  good(await seedManualDemoContext({ repository, identity: runtime.identity, clock: runtime.clock, context: acting.context }));
  const initial = good(await runtime.clock.now(presenter.context));
  good(await runtime.clock.advance(presenter.context, { commandId: 'noon', expectedClockVersion: initial.clockVersion,
    to: '2026-11-05T12:00:00.000Z' }));
  const visible = { companyIds: [acting.context.companyId], schemeIds: [acting.context.schemeId], employeeIds: null };
  const cars = [11, 12].map((id) => {
    const car = stock(id, { eligibilityModelKey: fact('F70 Sports Hatch|120'), body: fact('hatch'),
      boot: fact(380, 'L'), sizeClass: fact(2, 'ordinal-1-5'), insuranceGroup: fact(25, 'insurance-group') }, 'RjcwOlMx');
    return { orderUuid: car.orderUuid, orderNumber: `91234${id}`, configurationId: car.configurationId,
      facts: car.snapshot, availability: { availableUntil: car.availability.availableUntil }, visibility: structuredClone(visible) };
  });
  if (hiddenFirst) cars[0].visibility.companyIds = ['another-company'];
  const provider = createSyntheticStockProvider({ runId: acting.context.runId, version: 'TEST-gallery-release-v1',
    label: 'Offline TEST source; not F77/F78 or a real supply acknowledgement',
    windows: cars.map((car, index) => ({ windowId: `TEST-gallery-${index}`, availableAt: '2026-11-05T12:00:00.000Z',
      supplyId: null, stock: [car] })) });
  const release = createStockReleaseService({ repository, policy: runtime.policy, identity: runtime.identity, clock: runtime.clock, provider });
  good(await release.register());
  const history = createStockReleaseHistoryPort({ repository, identity: runtime.identity, clock: runtime.clock });
  const read = createManualGalleryStockRead({ manual: runtime.manualClaims, releaseHistory: history,
    identity: runtime.identity, clock: runtime.clock });
  const server = buildServer({ ...runtime.dependencies, gcspManualClaims: bindClaims(runtime.manualClaims, read),
    gcspAllowedOrigins: [origin] });
  good(await server.gcspStartup);
  const f = { ...runtime, store, server, history, read, release, cars,
    context: acting.context, session: cookie(acting.setCookie), gregSession: cookie(greg.setCookie),
    presenter: presenter.context, presenterSession: cookie(presenter.setCookie) };
  const accountResponse = await request(server, '/api/gcsp/manual/account', { session: f.session });
  assert.equal(accountResponse.status, 200);
  const account = good(accountResponse.json); const action = account.actions.find((entry) => entry.enabled);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee');
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(f.context.schemeId)
    && entry.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId)
    && entry.driverKinds.includes(driver.kind));
  const saved = await request(server, '/api/gcsp/manual/draft', { session: f.session, body: {
    commandId: 'manual-draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion,
    choices: { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
      slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
      requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
      brand: account.choices.brands[0], contact: account.account.contact,
      expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' },
  } });
  assert.equal(saved.status, 200); good(saved.json);
  return f;
}
async function tick(f, id) {
  const time = good(await f.clock.now(f.presenter));
  good(await f.clock.tick(f.presenter, { eventId: id, inputDigest: inputDigest(id), expectedClockVersion: time.clockVersion }));
}
async function browse(f) {
  const response = await request(f.server, '/api/gcsp/manual/stock', { session: f.session });
  assert.equal(response.status, 200); return good(response.json);
}
async function reset(f) {
  const catalogue = good(await f.scenarios.readCatalogue(f.presenter));
  const scenario = catalogue.scenarios.find((entry) => entry.kind === 'mechanics');
  const state = good(await f.scenarios.readState(f.presenter));
  const response = await request(f.server, '/api/gcsp/presenter/scenarios/reset', { session: f.presenterSession,
    body: { commandId: 'TEST-gallery-reset', expectedRunId: state.runId, expectedRunVersion: state.runVersion,
      scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion,
      fixtureVersion: scenario.fixtureVersion, policyVersion: scenario.policyVersion } });
  assert.equal(response.status, 200); return good(response.json);
}
async function patchStock(f, car, patch, id) {
  const key = { table: 'stock', key: { runId: f.context.runId, orderUuid: car.orderUuid } };
  const row = good(await f.repository.read(f.context, key));
  return good(await f.repository.transaction(f.presenter, command(id), (tx) => tx.compareAndSwap(key, row.version, patch)));
}

test('authenticated pre-release browse retains typed visible absence and unknown provider without creating commands', async (t) => {
  const f = await setup(t); const before = structuredClone(f.store.state);
  const value = await browse(f);
  assert.equal(value.state, 'empty-stock'); assert.deepEqual(value.decisions, []);
  assert.deepEqual(value.releaseHistory, { runId: f.context.runId, observedAt: '2026-11-05T12:00:00.000Z',
    history: { state: 'none-visible', releasedCarCount: 0, releaseCount: 0, latestReleasedAt: null, sourceVersions: [] },
    source: { state: 'current-version-unknown' } });
  assert.equal(value.ranked, false); assert.equal(value.browsingReservesStock, false);
  assert.deepEqual(f.store.state, before);
});

test('actual F92 tick and receipt feed authenticated manual stock with unchanged exact decisions and issued claimInput', async (t) => {
  const f = await setup(t); await tick(f, 'actual-release');
  const expected = good(await f.manualClaims.browseStock(f.context)); const before = structuredClone(f.store.state);
  const value = await browse(f); const { releaseHistory, ...original } = value;
  assert.deepEqual(original, expected); assert.equal(value.decisions.length, 1);
  const decision = value.decisions[0]; assert.equal(decision.orderUuid, f.cars[0].orderUuid);
  assert.equal(decision.gateStatus, 'eligible'); assert.deepEqual(decision.snapshot, f.cars[0].facts);
  assert.deepEqual(decision.claimInput, expected.decisions[0].claimInput); assert.ok(decision.claimInput.expectedTermsDigest);
  assert.equal(releaseHistory.history.state, 'released'); assert.equal(releaseHistory.history.releaseCount, 1);
  assert.deepEqual(releaseHistory.history.sourceVersions, ['TEST-gallery-release-v1']);
  assert.equal(releaseHistory.source.state, 'current-version-unknown');
  const receipts = good(await f.repository.query(f.context, 'event_receipts', { consumerId: 'stock-release', state: 'completed' }));
  assert.equal(receipts.length, 1); assert.deepEqual(receipts[0].outcome.value.orderUuids, [decision.orderUuid]);
  assert.deepEqual(f.store.state, before);
});

test('a confirmed hidden release remains none-visible rather than a global first-release assertion', async (t) => {
  const f = await setup(t, { hiddenFirst: true }); await tick(f, 'hidden-release');
  const hidden = await browse(f);
  assert.equal(hidden.releaseHistory.history.state, 'none-visible'); assert.equal(hidden.decisions.length, 0);
  assert.equal(good(await f.repository.query(f.presenter, 'event_receipts', { consumerId: 'stock-release' })).length, 1);
  assert.equal('nothingReleasedYet' in hidden.releaseHistory, false);
  assert.equal(JSON.stringify(hidden.releaseHistory).includes(f.cars[0].orderUuid), false);
  await tick(f, 'visible-release'); const visible = await browse(f);
  assert.equal(visible.releaseHistory.history.releasedCarCount, 1); assert.equal(visible.decisions[0].orderUuid, f.cars[1].orderUuid);
});

test('TEST occupied-state mutations retain real confirmed history while current suitability changes without browse writes', async (t) => {
  const f = await setup(t); await tick(f, 'release-before-occupation'); const history = (await browse(f)).releaseHistory;
  // State fixtures exercise the read boundary only; they do not prove a claim/allocation protocol.
  for (const state of ['held', 'allocated']) {
    await patchStock(f, f.cars[0], { state, available: false, held: state === 'held', allocated: state === 'allocated' }, `TEST-${state}`);
    const before = structuredClone(f.store.state); const value = await browse(f);
    assert.deepEqual(value.releaseHistory, history); assert.equal(value.state, 'no-eligible-stock');
    assert.ok(value.decisions.every((entry) => entry.gateStatus !== 'eligible' && entry.claimInput === null));
    assert.deepEqual(f.store.state, before);
  }
});

test('actual missing receipt provenance is unavailable and cannot become an empty-history success', async (t) => {
  const f = await setup(t); await tick(f, 'release-before-tamper');
  const row = good(await f.repository.read(f.context, { table: 'stock', key: { runId: f.context.runId, orderUuid: f.cars[0].orderUuid } }));
  await patchStock(f, f.cars[0], { release: { ...row.release, sourceVersion: 'TEST-mismatch' } }, 'TEST-provenance-mismatch');
  const expected = await f.history.read(f.context); assert.equal(expected.status, 'unavailable');
  const before = structuredClone(f.store.state);
  const response = await request(f.server, '/api/gcsp/manual/stock', { session: f.session });
  assert.equal(response.status, 503); assert.deepEqual(response.json, expected); assert.deepEqual(f.store.state, before);
});

test('actual authenticated HTTP rejects absent, nonemployee and fabricated authority', async (t) => {
  const f = await setup(t);
  assert.equal((await request(f.server, '/api/gcsp/manual/stock')).status, 401);
  assert.equal((await request(f.server, '/api/gcsp/manual/stock', { session: f.gregSession })).status, 403);
  assert.equal((await f.read.browseStock({ ...f.context })).status, 'forbidden');
});

test('an actual clock advance during the join returns conflict without replaying either service', async (t) => {
  const f = await setup(t); let observed = 0; let reads = 0; let histories = 0;
  const read = createManualGalleryStockRead({ identity: f.identity,
    clock: { async now(context) {
      observed += 1;
      if (observed === 2) {
        const current = good(await f.clock.now(f.presenter));
        good(await f.clock.advance(f.presenter, { commandId: 'TEST-midread-clock', expectedClockVersion: current.clockVersion, bySeconds: 1 }));
      }
      return f.clock.now(context);
    } }, manual: { browseStock(context) { reads += 1; return f.manualClaims.browseStock(context); } },
    releaseHistory: { read(context) { histories += 1; return f.history.read(context); } } });
  assert.equal((await read.browseStock(f.context)).status, 'conflict');
  assert.equal(reads, 1); assert.equal(histories, 1); assert.equal(observed, 2);
});

test('actual named reset during the join invalidates the original employee instead of returning mixed-run history', async (t) => {
  const f = await setup(t);
  const read = createManualGalleryStockRead({ manual: f.manualClaims, identity: f.identity, clock: f.clock,
    releaseHistory: { async read(context) { const history = await f.history.read(context); await reset(f); return history; } } });
  assert.equal((await read.browseStock(f.context)).status, 'stale-run');
  assert.equal((await request(f.server, '/api/gcsp/manual/stock', { session: f.session })).status, 409);
});

test('an original manual refusal is returned unchanged and does not trigger history reads', async (t) => {
  const f = await setup(t); const refusal = { status: 'pending', operationId: 'TEST-pending', contractVersion: '1.0.0' };
  let histories = 0;
  const read = createManualGalleryStockRead({ identity: f.identity, clock: f.clock,
    manual: { async browseStock() { return refusal; } }, releaseHistory: { async read() { histories += 1; throw Error('must not run'); } } });
  assert.equal(await read.browseStock(f.context), refusal); assert.equal(histories, 0);
});
