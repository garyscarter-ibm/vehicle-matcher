// Shared manual-order lifecycle harness (FUCQ-71 producer): the composed memory runtime on loopback HTTP and a real cart selection.
// `f.api`, `f.services`, `f.context` and `f.counter` match the launcher helpers, so gcsp-journey's `assumption`, `rows` and `tickTo` work on it.
import assert from 'node:assert/strict';
import { createGcspRuntime } from '../../gcsp/runtime.js';
import { buildServer } from '../../index.js';
import { inputDigest, result } from '../../gcsp/repository/index.js';
import { createCompositionTestProfile } from './runtime-composition-profile.js';
import { competingPolicy } from './gcsp-journey.js';

export const origin = 'https://lifecycle-composition.test';
// Diagnostics deliberately expose only status, never sessions or provider payloads.
export const good = (outcome) => { assert.equal(outcome?.status, 'ok'); return outcome.value; };
export const cookie = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
export const ref = (context, table, key) => ({ table, key: { runId: context.runId, ...key } });

/** `refuse` makes one service method fail at startup; `edit(seed, byKey)` changes the policy seed before boot. */
export async function setupManualRuntime(t, { refuse, edit } = {}) {
  const profile = createCompositionTestProfile();
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile, ...(edit ? { policy: (await competingPolicy(edit)).policy } : {}),
    environmentId: 'lifecycle-composition', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'lifecycle-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  const registrations = []; const register = runtime.clock.registerHandler.bind(runtime.clock);
  runtime.clock.registerHandler = (input) => { registrations.push(input.handlerId); return register(input); };
  let reconciliations = 0; const reconcile = runtime.clock.reconcileStartup.bind(runtime.clock);
  runtime.clock.reconcileStartup = (...args) => { reconciliations += 1; return reconcile(...args); };
  if (refuse) runtime[refuse.service][refuse.method] = async () => result('unavailable', { code: 'selected-registration-refusal' });
  const local = good(await runtime.createLocalSession()); const session = cookie(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: session, purpose: 'presenter-control' }));
  const server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  t.after(async () => {
    try { await new Promise((done) => { server.close(done); server.closeAllConnections(); }); }
    finally { await runtime.close(); }
  });
  const startup = await server.gcspStartup;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { body, session: supplied = session, requestOrigin = origin } = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: requestOrigin, ...(supplied ? { Cookie: supplied } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, json: await response.json() };
  };
  const f = { ...runtime, runtime, services: runtime, profile, server, startup, registrations, session, employee: local.context,
    presenter, request, reconciliations: () => reconciliations, counter: 0, context: presenter };
  // Launcher-style call: the presenter's own session unless another is given.
  f.api = async (path, { body, session: supplied } = {}) => request(path, { body, session: supplied ?? f.presenterCookie });
  if (startup.status === 'ok') f.presenterCookie = cookie(good(await runtime.identity.createPresenterSession('manual-order-presenter')).setCookie);
  return f;
}

/** Service-level tick (optionally after advancing `bySeconds`), as the composition tests drive it. */
export async function tickRuntime(f, eventId, bySeconds = 0) {
  let now = good(await f.clock.now(f.presenter));
  if (bySeconds) {
    good(await f.clock.advance(f.presenter, { commandId: `advance:${eventId}`, expectedClockVersion: now.clockVersion, bySeconds }));
    now = good(await f.clock.now(f.presenter));
  }
  const input = { eventId, expectedClockVersion: now.clockVersion, inputDigest: inputDigest(eventId) };
  return { input, outcome: await f.clock.tick(f.presenter, input) };
}

/** The real manual producer: draft, release, claim, review and submit one cart selection. */
export async function selectManualOrder(f) {
  const account = good((await f.request('/api/gcsp/manual/account')).json);
  const action = account.actions.find((row) => row.enabled);
  const driver = account.choices.drivers.find((row) => row.kind === 'employee');
  const option = account.choices.contractOptions.find((row) => row.schemeIds.includes(f.employee.schemeId) && row.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((row) => row.contractOptionIds.includes(option.contractOptionId) && row.driverKinds.includes(driver.kind));
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
    slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
    requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
    brand: account.choices.brands[0], contact: account.account.contact,
    expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
  good((await f.request('/api/gcsp/manual/draft', { body: { commandId: 'lifecycle-draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices } })).json);
  const car = await f.profile.prepare(f.runtime, f.employee);
  const time = good(await f.clock.now(f.presenter));
  good((await tickRuntime(f, 'release-lifecycle-stock', (Date.parse('2026-11-05T12:00:00.000Z') - Date.parse(time.now)) / 1000)).outcome);
  const stock = good((await f.request('/api/gcsp/manual/stock')).json);
  const decision = stock.decisions.find((row) => row.orderUuid === car.orderUuid);
  assert.equal(decision.gateStatus, 'eligible');
  const claimed = good(await f.manualClaims.claim(f.employee, { ...decision.claimInput, commandId: 'lifecycle-claim' }));
  const reviewed = good(await f.manualClaims.beginReview(f.employee, { commandId: 'lifecycle-review', holdId: claimed.hold.holdId,
    expectedHoldVersion: claimed.hold.version, expectedDraftVersion: claimed.quote.draftVersion }));
  const terms = good(await f.manualOrder.readTerms(f.employee));
  const currentStock = good(await f.repository.read(f.employee, ref(f.employee, 'stock', { orderUuid: car.orderUuid })));
  const input = { commandId: 'lifecycle-submit', source: { type: 'cart', holdId: reviewed.hold.holdId,
    expectedHoldVersion: reviewed.hold.version, expectedDraftVersion: reviewed.quote.draftVersion },
  expectedQuoteId: reviewed.quote.quoteId, expectedStockVersion: currentStock.version, termsDigest: terms.termsDigest,
  declarations: Object.fromEntries(terms.declarations.filter((row) => row.appliesTo === 'all' || row.appliesTo === choices.mode).map((row) => [row.id, true])) };
  const submitted = good(await f.manualOrder.submit(f.employee, input));
  assert.equal(submitted.view.state, 'awaiting-approval'); assert.equal(submitted.order.status, 'confirmed');
  assert.deepEqual(good(await f.manualOrder.submit(f.employee, input)), submitted);
  const persisted = good(await f.repository.read(f.employee, ref(f.employee, 'pending_operations', { operationId: submitted.operationId })));
  assert.equal(persisted.payload.atomicConversion, true); // F66 converts through FUCQ-71's atomic callback.
  assert.equal(persisted.lastKnownState, 'acknowledged');
  assert.equal(good(await f.repository.read(f.employee, ref(f.employee, 'holds', { holdId: reviewed.hold.holdId }))).state, 'allocated');
  return { car, submitted, operation: persisted };
}
