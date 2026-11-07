import test from 'node:test';
import assert from 'node:assert/strict';
import { toManualCar, toManualGallery } from '../../blocks/gcsp/manual-gallery/gallery-model.js';
import { createManualGalleryController } from '../../blocks/gcsp/manual-gallery/gallery-controller.js';
import { createAccountHttpAdapter } from '../../blocks/gcsp/account/http-adapter.js';
import { createVehicleSnapshot } from '../vehicles/index.js';

// Optional inventory detail is synthetic test input, never a runtime stock source.
const fact = (value, unit = null) => ({ status: value === null ? 'unknown' : 'known', value, unit,
  provenance: { sourceRef: 'fixture:manual-gallery', observedAt: '2026-11-05T12:00:00.000Z', version: 'detail-v1', assurance: value === null ? 'unknown' : 'synthetic-scenario' } });
function stock(id = 1, facts = {}) {
  const orderUuid = `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  return { orderUuid, configurationId: 'RzIxOlMx', availability: { state: 'available', availableFrom: '2026-11-05T09:00:00.000Z',
    availableUntil: '2027-01-01T00:00:00.000Z', version: 'availability-v1' },
  snapshot: createVehicleSnapshot({ sourceNamespace: 'fixture:manual-gallery', identityKind: 'exact-stock', sourceKeys: { stockId: orderUuid },
    snapshotVersion: 'snapshot-v1', observedAt: '2026-11-05T12:00:00.000Z', display: { name: `Synthetic exact car ${id}` },
    facts: { eligibilityModelKey: fact('G21 Touring|320i'), body: fact('estate'), fuel: fact('petrol'), seats: fact(5, 'count'),
      boot: fact(500, 'L'), zeroTo62: fact(7, 's'), mpg: fact(45, 'mpg-imperial'), sizeClass: fact(3, 'ordinal-1-5'), tags: fact(['cruiser']), ...facts } }) };
}

const decision = (id = 1, changes = {}) => ({ ...stock(id, { series: fact('3 Series'), insuranceGroup: fact(25, 'insurance-group'),
  engine: fact('320i'), exterior: fact('Blue'), interior: fact('Black'), equipment: fact([{ code: 'S0488', name: 'Lumbar support' }]) }),
orderNumber: String(id).padStart(7, '0'), candidateKey: stock(id).snapshot.candidateKey, draftVersion: 2,
versions: { stock: 'stock-v1', terms: 'terms-v1', snapshot: 'snapshot-v1' }, gateStatus: 'eligible', score: null,
terms: { kind: 'employee-scheme', termsVersion: 'terms-v1', points: { value: 1100, unit: 'points' },
  allowanceInputs: { allowance: { value: 1300, unit: 'points' } }, contribution: null }, blockers: [], unknowns: [], ...changes });
const envelope = (decisions = [decision()], state = decisions.length ? 'available-stock' : 'empty-stock') => ({ status: 'ok', value: {
  state, decisions, cars: decisions.filter((car) => car.gateStatus === 'eligible'), total: 999, ranked: false,
  versions: { policy: 'policy-v1', stock: 'stock-v1', facts: 'facts-v1', clock: 'clock-v1', draft: 2, context: 'context-v1' }, browsingReservesStock: false } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };

test('all exact decisions remain reachable past five, with independent eligibility and record counts', () => {
  const input = envelope(Array.from({ length: 9 }, (_, index) => decision(index + 1, index === 8 ? { gateStatus: 'ineligible', blockers: [{ code: 'insurance-grade-limit' }] } : {})));
  const before = structuredClone(input); const model = toManualGallery(input);
  assert.equal(model.cars.length, 9); assert.deepEqual(model.counts, { records: 9, eligible: 8, visible: 9, visibleEligible: 8 });
  assert.equal(new Set(model.cars.map((car) => car.id)).size, 9);
  for (const car of model.cars) { assert.equal(car.view.members.length, 1); assert.equal(car.view.selectedId, car.id); }
  assert.deepEqual(input, before); assert.equal(model.ranked, false); assert.equal(model.browsingReservesStock, false);
});

test('search covers model, body, engine, colours, interior, option name and displayed order reference', () => {
  const input = envelope([decision(), decision(2, { snapshot: stock(2).snapshot })]);
  for (const query of ['Synthetic exact car 1', 'estate', '320i', 'Blue', 'Black', 'Lumbar', '0000001']) {
    const model = toManualGallery(input, { query }); assert.ok(model.cars.some((car) => car.id === decision().orderUuid), query);
  }
  assert.deepEqual(toManualGallery(input).series, ['3 Series']); assert.deepEqual(toManualGallery(input).bodies, ['estate']);
  assert.equal(toManualGallery(input, { query: 'no such car' }).state, 'empty-search');
  assert.equal(toManualGallery(input, { series: '3 Series', body: 'estate' }).cars.length, 1);
  assert.equal(toManualGallery(input, { series: '8 Series' }).cars.length, 0);
});

test('name, points and collection sorting place unknowns last with deterministic exact ties', () => {
  const first = decision(1); const second = decision(2); const missing = decision(3, { terms: null });
  first.terms.points.value = 0; second.terms.points.value = 100;
  first.snapshot = structuredClone(first.snapshot); second.snapshot = structuredClone(second.snapshot);
  first.snapshot.display.name = 'Zulu'; second.snapshot.display.name = 'Alpha';
  first.snapshot.facts.earliestCollectionDate = fact('2026-12-02', 'date');
  second.snapshot.facts.earliestCollectionDate = fact('2026-11-20', 'date');
  const input = envelope([missing, second, first]);
  assert.deepEqual(toManualGallery(input, { sort: 'points' }).cars.map((car) => car.identity.orderNumber), ['0000001', '0000002', '0000003']);
  assert.deepEqual(toManualGallery(input, { sort: 'earliest-collection' }).cars.map((car) => car.identity.orderNumber), ['0000002', '0000001', '0000003']);
  assert.equal(toManualGallery(input, { sort: 'name' }).cars[0].identity.orderNumber, '0000002');
  const tie = envelope([decision(2), decision(1)]); tie.value.decisions.forEach((car) => { car.snapshot = structuredClone(car.snapshot); car.snapshot.display.name = 'Same'; });
  assert.deepEqual(toManualGallery(tie).cars.map((car) => car.identity.orderNumber), ['0000001', '0000002']);
});

test('typed zero emissions survive; missing, invalid units and mismatched or absent basis stay unknown', () => {
  const car = decision(); car.snapshot = structuredClone(car.snapshot);
  car.snapshot.facts.nedcCo2 = fact({ value: 0, unit: 'g/km', basis: 'NEDC-correlated' });
  car.snapshot.facts.wltpCo2 = { ...fact({ value: 143, unit: 'g/km', basis: 'WLTP' }) };
  car.snapshot = createVehicleSnapshot(car.snapshot);
  const projected = toManualCar(car);
  car.snapshot = structuredClone(car.snapshot);
  assert.equal(projected.emissions[0].value, 0); assert.equal(projected.emissions[0].basis, 'NEDC-correlated');
  assert.equal(projected.emissions[1].value, 143); assert.notEqual(projected.emissions[0].label, projected.emissions[1].label);
  for (const source of [fact(null, 'g/km'), fact({ value: 10, unit: 'mg/km', basis: 'WLTP' }), fact({ value: 10, unit: 'g/km', basis: 'NEDC' }), fact(10, 'g/km')]) {
    car.snapshot.facts.wltpCo2 = source; const observation = toManualCar(car).emissions[1];
    assert.equal(observation.value, null); assert.equal(observation.status, 'unknown'); assert.deepEqual(observation.source, source);
  }
  car.terms.points.value = null; car.terms.allowanceInputs.allowance.value = null;
  assert.deepEqual(toManualCar(car).cost, { kind: 'points-monthly', value: null, allowance: null });
  car.terms.points.value = 0; assert.equal(toManualCar(car).cost.value, 0);
  car.terms.contribution = { amount: 0, currency: 'GBP', period: 'month' };
  assert.deepEqual(toManualCar(car).contribution, car.terms.contribution);
  assert.equal(toManualCar(car).view.members[0].facts.find((field) => field.key === 'contribution').value, 0);
  assert.equal(toManualCar(car).view.members[0].facts.find((field) => field.key === 'contribution').unit, 'GBP/month');
  car.terms.contribution.period = 'unknown'; assert.equal(toManualCar(car).contribution, null);
});

test('exact details retain all snapshot/provenance, separate reference data and never union members', () => {
  const a = decision(); const b = decision(2);
  a.snapshot = structuredClone(a.snapshot); b.snapshot = structuredClone(b.snapshot);
  a.snapshot.display.photo = '/blue.jpg'; a.snapshot.display.images = [{ src: '/blue.jpg', caption: 'Representative configuration', provenance: { sourceRef: 'image:a' } }];
  a.snapshot.facts.boot.provenance.assurance = 'model-reference'; a.snapshot.facts.historic = fact({ registered: null });
  b.snapshot.facts.equipment = fact([{ name: 'Tow bar' }]); b.snapshot.display.photo = '/red.jpg'; b.terms.points.value = 1200;
  const projected = toManualGallery(envelope([a, b])); const [one, two] = projected.allCars;
  assert.deepEqual(one.detail.snapshot, a.snapshot); assert.equal(one.detail.referenceFacts[0].key, 'boot');
  assert.ok(one.detail.exactFacts.some((field) => field.key === 'equipment'));
  assert.deepEqual(one.detail.equipment.value, [{ code: 'S0488', name: 'Lumbar support' }]);
  assert.deepEqual(two.detail.equipment.value, [{ name: 'Tow bar' }]);
  assert.equal(one.view.members[0].media.src, '/blue.jpg'); assert.equal(two.view.members[0].media.src, '/red.jpg');
  assert.equal(one.cost.value, 1100); assert.equal(two.cost.value, 1200);
  one.detail.snapshot.facts.body.value = 'changed'; assert.equal(a.snapshot.facts.body.value, 'estate');
});

test('source outage, empty pool, no suitable cars, context refresh and explicit release state remain distinct', () => {
  assert.equal(toManualGallery({ status: 'unavailable' }).state, 'source-unavailable');
  assert.equal(toManualGallery(envelope([])).state, 'empty-stock');
  assert.equal(toManualGallery(envelope([decision(1, { gateStatus: 'needs-confirmation' })], 'no-eligible-stock')).state, 'no-suitable-stock');
  assert.equal(toManualGallery({ status: 'stale-version' }).state, 'context-refresh');
  assert.equal(toManualGallery({ status: 'ok', value: { state: 'nothing-released-yet' } }).state, 'nothing-released-yet');
  for (const input of [{ status: 'ok', value: {} }, envelope([decision(), decision()])]) assert.equal(toManualGallery(input).state, 'source-unavailable');
});

test('controller browsing/detail/control operations have no write effect and only eligible exact review reaches host', async () => {
  const reviewed = []; let reads = 0; let commands = 0;
  const input = envelope([decision(), decision(2, { gateStatus: 'ineligible', blockers: [{ code: 'not-available' }] }), decision(3, { gateStatus: 'needs-confirmation' })]);
  const claimInput = { orderUuid: decision().orderUuid, expectedStockVersion: 8, expectedDraftVersion: 2,
    expectedContextVersion: 'context-v1', expectedTermsDigest: 'terms-digest-v1' };
  input.value.decisions[0].claimInput = claimInput;
  const controller = createManualGalleryController({ adapter: { async browseStock() { reads += 1; return input; } }, onReview: (value) => reviewed.push(value), commandId: () => `attempt-${++commands}` });
  await controller.load(); controller.openDetail(input.value.decisions[0].orderUuid); controller.setControls({ query: 'Blue', sort: 'points' });
  assert.equal(reads, 1); assert.equal(reviewed.length, 0);
  assert.equal(controller.openDetail('catalogue-id'), null);
  for (const car of input.value.decisions.slice(1)) { assert.equal(controller.review(car.orderUuid).status, 'unavailable');
    assert.equal(controller.getState().allCars.find((item) => item.id === car.orderUuid).view.members[0].actions[0].disabled, true); }
  const result = controller.review(input.value.decisions[0].orderUuid); controller.review(input.value.decisions[0].orderUuid);
  assert.equal(reviewed.length, 2); assert.deepEqual(result.value.claimInput, claimInput); assert.equal(result.value.commandId, reviewed[1].commandId);
  assert.deepEqual(result.value.facts, input.value.decisions[0].snapshot.facts); assert.deepEqual(result.value.versions, input.value.versions);
  assert.deepEqual(result.value.decisionVersions, input.value.decisions[0].versions); assert.equal(result.value.draftVersion, 2);
  assert.equal(result.value.configurationId, input.value.decisions[0].configurationId);
  assert.equal(controller.getState().cars[0].view.members[0].decision.score, null);
  assert.deepEqual(controller.getState().cars[0].view.members[0].decision.reasons, []);
  controller.reportOutcome({ status: 'conflict', reason: 'occupied' }); assert.equal(controller.getState().state, 'car-taken');
  controller.setControls({ query: '' }); assert.equal(controller.getState().state, 'car-taken');
  assert.equal(controller.review(input.value.decisions[0].orderUuid).status, 'unavailable');
  await controller.refresh(); assert.equal(controller.getState().state, 'available-stock');
  assert.equal(controller.review(input.value.decisions[0].orderUuid).value.commandId, result.value.commandId);
  assert.equal(commands, 1); controller.destroy();
});

test('missing claimInput disables review while exact detail browsing stays available', async () => {
  let calls = 0;
  const controller = createManualGalleryController({ adapter: { browseStock: async () => envelope() }, onReview() { calls += 1; }, commandId: () => 'id' });
  await controller.load(); assert.ok(controller.openDetail(decision().orderUuid));
  const result = controller.review(decision().orderUuid);
  assert.equal(result.status, 'unavailable'); assert.equal(calls, 0);
  const action = controller.getState().cars[0].view.members[0].actions[0];
  assert.equal(action.disabled, true); assert.equal(action.disabledReason, 'Refresh to review this car.');
  const withClaim = decision(2, { claimInput: { orderUuid: decision(2).orderUuid, expectedStockVersion: 1, expectedDraftVersion: 2,
    expectedContextVersion: 'context-v1', expectedTermsDigest: 'digest' } });
  const noHost = createManualGalleryController({ adapter: { browseStock: async () => envelope([withClaim]) } });
  await noHost.load(); assert.equal(noHost.review(withClaim.orderUuid).status, 'unavailable'); controller.destroy(); noHost.destroy();
});

test('async refresh ignores superseded responses, aborts on destroy and recovers after errors', async () => {
  const pending = [deferred(), deferred(), deferred()]; const signals = []; const changes = [];
  const controller = createManualGalleryController({ adapter: { browseStock({ signal }) { signals.push(signal); return pending[signals.length - 1].promise; } }, onChange: (value) => changes.push(value.state) });
  const old = controller.load(); assert.equal(controller.getState().state, 'loading'); const fresh = controller.refresh();
  assert.equal(signals[0].aborted, true); pending[1].resolve(envelope([decision(2)])); await fresh;
  pending[0].resolve(envelope([decision(1)])); await old; assert.equal(controller.getState().cars[0].identity.orderNumber, '0000002');
  const late = controller.refresh(); const count = changes.length; controller.destroy(); assert.equal(signals[2].aborted, true);
  pending[2].resolve(envelope()); await late; assert.equal(changes.length, count); assert.equal((await controller.refresh()).state, 'loading');
  let fail = true; const recover = createManualGalleryController({ adapter: { async browseStock() { if (fail) throw Error('transport'); return envelope([]); } } });
  await recover.load(); assert.equal(recover.getState().state, 'source-unavailable'); fail = false; await recover.refresh();
  assert.equal(recover.getState().state, 'empty-stock'); recover.destroy();
});

test('default read adapter only GETs the shared manual stock endpoint with trusted cookies', async () => {
  const calls = []; const input = envelope();
  const adapter = createAccountHttpAdapter({ fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => input }; } });
  const controller = createManualGalleryController({ adapter }); await controller.load(); controller.setControls({ query: 'estate' }); controller.openDetail(decision().orderUuid);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/gcsp/manual/stock'); assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'include'); assert.equal(calls[0].options.body, undefined); controller.destroy();
});


test('actual ManualContextService outcomes project all candidates, fail-closed gates and source errors without holds', async (t) => {
  const { createMemoryRepository, createMemoryStore } = await import('../gcsp/repository/index.js');
  const { createPolicyService } = await import('../gcsp/policy/index.js');
  const { createDemoRuntime } = await import('../gcsp/clock/index.js');
  const { ManualContextService, createRepositoryManualPorts } = await import('../gcsp/manual-context/index.js');
  const { seedManualDemoContext } = await import('../gcsp/manual-context/fixtures.js');
  const now = '2026-11-05T09:00:00.000Z';
  const repository = createMemoryRepository({ store: createMemoryStore(), now: () => now }); await repository.open();
  t.after(() => repository.close());
  const policy = createPolicyService();
  const runtime = await createDemoRuntime({ repository, policy, environmentId: 'manual-gallery-test', environmentKind: 'synthetic',
    policyAsOf: now, commandId: 'bootstrap', sessionNow: () => now });
  assert.equal(runtime.status, 'ok'); const { clock, identity } = runtime.value;
  const presenter = await identity.createPresenterSession('presenter');
  const acting = await identity.switchPrincipal(presenter.value.context, 'demo-paula', 'paula');
  const context = acting.value.context; const deps = { repository, policy, clock, identity, context };
  assert.equal((await seedManualDemoContext(deps)).status, 'ok');
  const ports = createRepositoryManualPorts(deps); const service = new ManualContextService({ ...deps, ports });
  const account = await service.readAccount(context);
  const saved = await service.saveDraft(context, { commandId: 'draft', expectedDraftVersion: 0, expectedContextVersion: account.value.contextVersion,
    choices: { mode: 'replacement', oldContractId: `current:${context.employeeId}`, slotId: context.entitlementSlotId, schemeId: context.schemeId,
      driverId: `driver:${context.employeeId}`, contractOptionId: 'six-month-8000', requestedCollectionDate: '2026-11-20',
      collectionLocationId: 'demo-collection-centre', brand: 'bmw', contact: { phone: '01632 960001', email: 'chooser@example.invalid' },
      expectedReturnMileage: 6700, specialRequirements: '' } });
  assert.equal(saved.status, 'ok');
  assert.equal(toManualGallery(await service.browseStock(context)).state, 'empty-stock');
  const base = (await ports.releasedStock.read(context)).value;
  const cars = Array.from({ length: 8 }, (_, index) => ({ ...stock(index + 20, { insuranceGroup: fact(index === 7 ? 45 : 25, 'insurance-group') }),
    orderNumber: String(index + 1).padStart(7, '0'), availability: { ...stock().availability, availableFrom: now } }));
  const populated = new ManualContextService({ ...deps, ports: { ...ports, releasedStock: { async read() { return { status: 'ok', value: { ...base, stock: cars } }; } } } });
  const before = (await repository.query(context, 'stock')).value;
  const response = await populated.browseStock(context); assert.equal(response.status, 'ok', JSON.stringify(response));
  const model = toManualGallery(response); assert.equal(model.cars.length, 8); assert.equal(model.counts.eligible, 7);
  assert.equal(model.cars.find((car) => car.id === cars[7].orderUuid).gateStatus, 'ineligible');
  assert.deepEqual((await repository.query(context, 'stock')).value, before); assert.equal((await repository.query(context, 'holds')).value.length, 0);
  assert.deepEqual(model.cars[0].review.versions, response.value.versions);
  const failed = new ManualContextService({ ...deps, ports: { ...ports, releasedStock: { async read() { throw Error('source unavailable'); } } } });
  assert.equal(toManualGallery(await failed.browseStock(context)).state, 'source-unavailable');
});


test('target-shaped optional facts and keyed equipment stay supplied facts with searchable option names', () => {
  const car = decision(); car.snapshot = structuredClone(car.snapshot);
  delete car.snapshot.facts.body; delete car.snapshot.facts.equipment;
  car.snapshot.facts.bodyType = fact('Touring'); car.snapshot.facts.marketingModelRange = fact('BMW 3 Series');
  car.snapshot.facts.equipments = fact({ S03AC: { description: 'Electrically folding tow bar' } });
  car.snapshot.facts.technicalAndEmission = fact({ electricityConsumption: null, cityRange: null });
  const model = toManualGallery(envelope([car]), { query: 'folding tow bar', body: 'Touring' });
  assert.equal(model.cars.length, 1); assert.deepEqual(model.bodies, ['Touring']);
  assert.equal(model.cars[0].fields.model.value, 'BMW 3 Series');
  assert.deepEqual(model.cars[0].detail.specifications, car.snapshot.facts.technicalAndEmission);
  assert.deepEqual(model.cars[0].detail.snapshot, car.snapshot);
});


test('catalogue, mismatched snapshot stock and mismatched claim identities fail unavailable', () => {
  const base = decision();
  for (const alter of [
    (car) => { car.snapshot.identityKind = 'advert'; },
    (car) => { car.snapshot.sourceKeys.stockId = decision(2).orderUuid; },
    (car) => { car.claimInput = { orderUuid: decision(2).orderUuid }; },
  ]) {
    const car = structuredClone(base); alter(car);
    const projected = toManualGallery(envelope([car]));
    assert.equal(projected.state, 'source-unavailable'); assert.equal(projected.cars.length, 0);
    assert.throws(() => toManualCar(car), /Exact stock identity/);
  }
  const incomplete = decision(1, { claimInput: { orderUuid: base.orderUuid } });
  assert.equal(toManualCar(incomplete).view.members[0].actions[0].disabled, true);
});
