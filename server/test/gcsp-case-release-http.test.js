// C4 authoring only. Requires the dispatcher-frozen C1 profile and composition.
// Actual HTTP handler/identity/JSON transport, without a socket or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createGcspRuntime } from '../gcsp/runtime.js';
import { buildServer } from '../index.js';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../gcsp/repository/index.js';
import { createCompositionTestProfile } from './helpers/runtime-composition-profile.js';
import { createCaseHttpAdapter } from '../../blocks/gcsp/cases/http-adapter.js';

const origin = 'https://case-composition.test';
// Never print contexts, sessions, outbox links or complete envelopes on failure.
const good = (envelope) => { assert.equal(envelope?.status, 'ok'); return envelope.value; };
const cookies = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
const rowRef = (f, table, key) => ({ table, key: { runId: f.employee.runId, ...key } });
async function http(f, path, { body, session = f.employeeCookie } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { url: path, method: body === undefined ? 'GET' : 'POST', headers: {
    host: 'case-composition.test', origin, cookie: session,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers = {}) { this.status = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); },
    end(body) { this.body = body; } };
  await f.server.listeners('request')[0](req, response);
  assert.ok(Number.isInteger(response.status), 'Actual handler must finish the response.');
  const json = response.body ? JSON.parse(response.body) : null;
  f.requests.push({ path: path.split('?')[0], method: req.method, httpStatus: response.status, status: json?.status });
  return { httpStatus: response.status, json };
}
function caseAdapter(f, session) {
  return createCaseHttpAdapter({ base: origin, async fetchImpl(url, options) {
    options.signal?.throwIfAborted();
    const { httpStatus, json } = await http(f, new URL(url).pathname + new URL(url).search,
      { session, ...(options.body === undefined ? {} : { body: JSON.parse(options.body) }) });
    // Only the real registered handler supplies the status and response bytes.
    return { ok: httpStatus >= 200 && httpStatus < 300, async json() { return json; } };
  } });
}
async function setup(t, { hold = false } = {}) {
  const store = createMemoryStore(); const repository = createMemoryRepository({ store });
  const profile = createCompositionTestProfile();
  const runtime = good(await createGcspRuntime({ mode: 'memory', repository, stockProvider: profile,
    environmentId: 'case-composition-test', policyAsOf: '2026-11-05T09:00:00.000Z',
    commandId: 'case-composition-bootstrap', sessionNow: () => '2026-11-06T00:00:00.000Z' }));
  t.after(() => runtime.close());
  const local = good(await runtime.createLocalSession());
  const employeeCookie = cookies(local.setCookie);
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: employeeCookie, purpose: 'presenter-control' }));
  const greg = good(await runtime.identity.switchPrincipal(presenter, 'demo-greg', 'case-composition-greg'));
  const f = { runtime, store, repository, profile, employee: local.context, employeeCookie,
    presenter, greg: greg.context, gregCookie: cookies(greg.setCookie), requests: [] };
  f.server = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  good(await f.server.gcspStartup);
  assert.equal(f.server.listening, false);
  assert.equal(runtime.dependencies.gcspCases, runtime.cases);
  assert.equal(runtime.dependencies.gcspStockRelease, runtime.stockRelease);
  f.employeeApi = caseAdapter(f, employeeCookie); f.gregApi = caseAdapter(f, f.gregCookie);
  // Actual persisted employee preparation is owned by createLocalSession/C1.
  // A brief is employee input; no test-authored manual facts or released rows.
  const preference = { value: 'hatchback', importance: 100, valueState: 'confirmed', importanceState: 'confirmed', source: 'employee' };
  good((await http(f, '/api/gcsp/brief/draft', { body: { commandId: 'case-brief-draft',
    expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference }, essentials: {
      seats: { value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee' },
    } } } })).json);
  good((await http(f, '/api/gcsp/brief/confirm', { body: { commandId: 'case-brief-confirm',
    expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold } } })).json);
  const opened = good(await f.employeeApi.requestHelp({ commandId: 'case-help', reason: 'Review my actual released alternative.' })).case;
  f.case = good(await f.gregApi.updateCase({ commandId: 'case-progress', caseId: opened.caseId,
    expectedVersion: opened.version, status: 'in-progress', reason: 'Review exact current evidence.',
    nextAction: 'Discuss the alternative with the employee.', dueAt: '2026-11-06T12:00:00.000Z' })).case;
  return f;
}
const alternatives = async (f) => good(await f.gregApi.readOptions({ caseId: f.case.caseId })).options.alternativeCars;
// Allocation runs in the release tick (FUCQ-118): a hold-consenting brief gets the car held there.
async function release(f, { held = false } = {}) {
  f.car = await f.profile.prepare(f.runtime, f.employee);
  assert.match(f.car.facts.sourceNamespace, /^TEST:/);
  assert.equal((await f.repository.read(f.employee, rowRef(f, 'stock', { orderUuid: f.car.orderUuid }))).status, 'not-found');
  assert.equal((await alternatives(f)).available, false);
  const now = good(await f.runtime.clock.now(f.presenter));
  good(await f.runtime.clock.advance(f.presenter, { commandId: 'case-noon', expectedClockVersion: now.clockVersion,
    to: '2026-11-05T12:00:00.000Z' }));
  const time = good(await f.runtime.clock.now(f.presenter));
  const input = { eventId: 'case-actual-release', inputDigest: inputDigest('case-actual-release'), expectedClockVersion: time.clockVersion };
  const released = await f.runtime.clock.tick(f.presenter, input);
  const outcome = good(released).outcomes.find((entry) => entry.handlerId === 'stock-release');
  assert.deepEqual(good(outcome.outcome).orderUuids, [f.car.orderUuid]);
  assert.equal(f.profile.calls.length, 1);
  const allocation = good(good(released).outcomes.find((entry) => entry.handlerId === 'buddy-allocation').outcome).allocations;
  const triggered = allocation.filter((entry) => entry.event.sourceReceipt.consumerId === 'stock-release');
  assert.equal(triggered.length, 1); // The release reached allocation; any trigger may make the one assignment.
  assert.deepEqual(allocation.flatMap((entry) => entry.assignments).map((entry) => [entry.employeeId, entry.orderUuid]),
    held ? [[f.employee.employeeId, f.car.orderUuid]] : []);
  const holds = f.store.state.tables.holds.filter((entry) => entry.orderUuid === f.car.orderUuid);
  assert.deepEqual(holds.map((entry) => [entry.type, entry.state, entry.employeeId]),
    held ? [['buddy-offer', 'active', f.employee.employeeId]] : []);
  const committed = good(await f.repository.read(f.employee, rowRef(f, 'stock', { orderUuid: f.car.orderUuid })));
  assert.equal(committed.state, held ? 'held' : 'released'); assert.equal(committed.configurationId, f.car.configurationId);
  assert.deepEqual(committed.facts, f.car.facts); assert.deepEqual(committed.visibility, f.car.visibility);
  const beforeReplay = structuredClone(f.store.state);
  assert.deepEqual(await f.runtime.clock.tick(f.presenter, input), released);
  assert.equal(inputDigest(f.store.state), inputDigest(beforeReplay)); assert.equal(f.profile.calls.length, 1);
  const options = await alternatives(f);
  if (held) { assert.equal(options.available, false); return committed; }
  assert.equal(options.available, true); assert.deepEqual(options.items.map((item) => item.orderUuid), [f.car.orderUuid]);
  assert.deepEqual(options.items[0].snapshot, committed.facts);
  return committed;
}
const proposal = (f, commandId = 'case-propose') => ({ commandId, caseId: f.case.caseId, expectedVersion: f.case.version,
  status: 'remedy-proposed', reason: 'Exact released TEST car reviewed.', nextAction: 'Discuss this proposal with the employee.',
  dueAt: '2026-11-06T12:00:00.000Z', remedy: { type: 'alternative-car', orderUuid: f.car.orderUuid } });
const authorityTables = ['employees', 'entitlement_slots', 'briefs', 'stock', 'holds', 'claims', 'quotes', 'offers', 'decisions'];
const snapshot = (f, tables = authorityTables) => Object.fromEntries(tables.map((name) => [name, structuredClone(f.store.state.tables[name])]));
async function refusal(f) {
  const before = structuredClone(f.store.state);
  const options = await alternatives(f); assert.equal(options.available, false);
  assert.equal((await f.gregApi.updateCase(proposal(f))).status, 'invalid');
  assert.equal(inputDigest(f.store.state), inputDigest(before));
  const own = good(await f.employeeApi.readCases()).cases.find((entry) => entry.caseId === f.case.caseId);
  assert.equal(own.status, 'in-progress'); assert.equal(own.version, f.case.version);
}
async function saveManualChoices(f) {
  const account = good((await http(f, '/api/gcsp/manual/account')).json);
  const action = account.actions.find((entry) => entry.enabled); assert.ok(action);
  const driver = account.choices.drivers.find((entry) => entry.kind === 'employee'); assert.ok(driver);
  const option = account.choices.contractOptions.find((entry) => entry.schemeIds.includes(f.employee.schemeId) && entry.driverKinds.includes(driver.kind));
  assert.ok(option);
  const location = account.choices.collectionLocations.find((entry) => entry.contractOptionIds.includes(option.contractOptionId) && entry.driverKinds.includes(driver.kind));
  assert.ok(location);
  good((await http(f, '/api/gcsp/manual/draft', { body: { commandId: 'case-manual-draft', expectedDraftVersion: 0,
    expectedContextVersion: account.contextVersion, choices: {
      mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId,
      slotId: action.slotId, schemeId: action.schemeId, driverId: driver.driverId, contractOptionId: option.contractOptionId,
      requestedCollectionDate: account.currentContract.earliestCollectionDate, collectionLocationId: location.locationId,
      brand: account.choices.brands[0], contact: account.account.contact,
      expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '',
    } } })).json);
}

test('C4 actual92 snapshot and persisted driver reach case HTTP proposal with replay and no claim', { timeout: 15000 }, async (t) => {
  const f = await setup(t); const committed = await release(f);
  const employee = good(await f.repository.read(f.employee, rowRef(f, 'employees', { employeeId: f.employee.employeeId })));
  const manual = employee.contract.manualContext;
  const slot = good(await f.repository.read(f.employee, rowRef(f, 'entitlement_slots', { entitlementSlotId: f.employee.entitlementSlotId })));
  const contract = manual.contracts.filter((entry) => entry.status === 'current' && entry.contractId === slot.contractId);
  assert.equal(contract.length, 1);
  const driver = manual.drivers.filter((entry) => entry.driverId === contract[0].driverId && entry.employeeId === f.employee.employeeId);
  assert.equal(driver.length, 1); assert.equal(driver[0].eligible.value, true);
  const central = good(await f.runtime.provider.resolve(f.employee));
  assert.deepEqual(central.employeeFacts.driverEligible, driver[0].eligible);
  assert.deepEqual(central.stock.find((entry) => entry.orderUuid === f.car.orderUuid).snapshot, committed.facts);
  const before = snapshot(f); const beforeCases = snapshot(f, ['renewal_cases', 'notification_outbox']);
  const input = proposal(f); const changed = await f.gregApi.updateCase(input); const proposed = good(changed).case;
  assert.equal(proposed.status, 'remedy-proposed'); assert.equal(proposed.remedy.orderUuid, f.car.orderUuid);
  assert.equal(proposed.history.length, f.case.history.length + 1);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.store.state.tables.notification_outbox.length, beforeCases.notification_outbox.length + 1);
  const after = structuredClone(f.store.state);
  assert.deepEqual(await f.gregApi.updateCase(input), changed); assert.equal(inputDigest(f.store.state), inputDigest(after));
  assert.equal((await f.gregApi.updateCase({ ...input, reason: 'Changed input under the same ID.' })).status, 'conflict');
  assert.equal(inputDigest(f.store.state), inputDigest(after));
  const own = good(await f.employeeApi.readCases()).cases.find((entry) => entry.caseId === proposed.caseId);
  assert.equal(own.status, 'remedy-proposed'); assert.equal(own.remedy.orderUuid, f.car.orderUuid);
  assert.equal((await f.employeeApi.listCases()).status, 'forbidden');
  assert.ok(f.requests.some((entry) => entry.path === '/api/gcsp/scheme-team/cases/update' && entry.method === 'POST' && entry.httpStatus === 200));
  assert.equal(f.server.listening, false);
});

test('C4 current persisted bound driver defeats contradictory flattened eligibility through actual HTTP', { timeout: 15000 }, async (t) => {
  const f = await setup(t); await release(f);
  // Disclosed controlled persisted-driver writer after option review. No stock repair.
  good(await f.repository.transaction(f.employee, { commandId: 'case-driver-race', inputDigest: inputDigest('case-driver-race') }, async (tx) => {
    const ref = rowRef(f, 'employees', { employeeId: f.employee.employeeId }); const employee = good(await tx.get(ref));
    const contract = structuredClone(employee.contract); const manual = contract.manualContext;
    const current = manual.contracts.find((entry) => entry.status === 'current' && entry.slotId === f.employee.entitlementSlotId);
    const driver = manual.drivers.find((entry) => entry.driverId === current.driverId);
    manual.employeeFacts.driverEligible = structuredClone(driver.eligible);
    driver.eligible = { ...driver.eligible, value: false };
    return tx.compareAndSwap(ref, employee.version, { contract });
  }));
  const current = good(await f.runtime.provider.resolve(f.employee));
  assert.equal(current.employeeFacts.driverEligible.value, false);
  await refusal(f);
});

test('C4 actual manual claim removes the exact92 option and refuses a stale HTTP proposal', { timeout: 15000 }, async (t) => {
  const f = await setup(t); await saveManualChoices(f); await release(f);
  const browse = good((await http(f, '/api/gcsp/manual/stock')).json);
  const car = browse.decisions.find((entry) => entry.orderUuid === f.car.orderUuid);
  assert.equal(car.gateStatus, 'eligible'); assert.ok(car.claimInput);
  good((await http(f, '/api/gcsp/manual/claim', { body: { commandId: 'case-actual-manual-claim', ...car.claimInput } })).json);
  const hold = f.store.state.tables.holds.find((entry) => entry.orderUuid === f.car.orderUuid);
  assert.equal(hold.type, 'cart'); assert.equal(hold.state, 'active');
  assert.deepEqual(good(await f.repository.read(f.employee, rowRef(f, 'stock', { orderUuid: f.car.orderUuid }))).facts, f.car.facts);
  await refusal(f);
});

test('C4 actual buddy service occupation removes the exact92 option and refuses a stale HTTP proposal', { timeout: 15000 }, async (t) => {
  // Hold consent: the release tick's own allocation producer occupies the car through the buddy port.
  const f = await setup(t, { hold: true }); await release(f, { held: true });
  assert.deepEqual(good(await f.repository.read(f.employee, rowRef(f, 'stock', { orderUuid: f.car.orderUuid }))).facts, f.car.facts);
  await refusal(f);
});
