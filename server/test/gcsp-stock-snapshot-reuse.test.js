import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicleSnapshot, freezeVehicleData } from '../vehicles/index.js';
import { createEmployeeRecommendationService, createStoredSubjectRecommendationEvaluator } from '../gcsp/recommendation/index.js';
import { context, instant, brief, stock, fact, essential, providerValue, provider, time, policy, currentCar, rating } from './helpers/employee-recommendation.js';

const ports = (source, extra = {}) => ({ provider: provider(source), policy: policy(), time, ...extra });
const recommend = (source, request = brief(), extra = {}) => createEmployeeRecommendationService(ports(source, extra)).recommend(context, request);
const first = (outcome) => { assert.equal(outcome.status, 'ok'); return outcome.value.decisions[0]; };
const subject = () => Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'roles'));
const snapshotShape = (value) => value && typeof value === 'object' && value.contractVersion === 'vehicle-snapshot-v1'
  && typeof value.candidateKey === 'string' && value.facts;

function observeSnapshotWork() {
  const original = { clone: globalThis.structuredClone, keys: Object.keys, freeze: Object.freeze, values: Object.values,
    descriptor: Object.getOwnPropertyDescriptor };
  const counts = { cloned: 0, validated: 0, frozen: 0, inspected: 0 };
  globalThis.structuredClone = (value, ...options) => {
    const seen = new Set();
    const visit = (item) => {
      if (!item || typeof item !== 'object' || seen.has(item)) return;
      seen.add(item);
      if (snapshotShape(item)) counts.cloned += 1;
      original.values(item).forEach(visit);
    };
    visit(value);
    return original.clone(value, ...options);
  };
  Object.keys = (value) => { if (snapshotShape(value)) counts.validated += 1; return original.keys(value); };
  Object.freeze = (value) => { if (snapshotShape(value)) counts.frozen += 1; return original.freeze(value); };
  Object.getOwnPropertyDescriptor = (value, key) => {
    if (snapshotShape(value)) counts.inspected += 1;
    return original.descriptor(value, key);
  };
  return { counts, restore() {
    globalThis.structuredClone = original.clone; Object.keys = original.keys; Object.freeze = original.freeze;
    Object.getOwnPropertyDescriptor = original.descriptor;
  } };
}

test('only constructor-validated snapshots are idempotent, detached and deeply immutable', () => {
  const input = structuredClone(stock().snapshot);
  const snapshot = createVehicleSnapshot(input);
  assert.notEqual(snapshot, input);
  assert.equal(createVehicleSnapshot(snapshot), snapshot);
  input.facts.tags.value.push('changed');
  assert.deepEqual(snapshot.facts.tags.value, ['cruiser']);
  assert.throws(() => snapshot.facts.tags.value.push('changed'), TypeError);
  assert.equal(freezeVehicleData({ snapshot }).snapshot, snapshot);
  const shallow = Object.freeze(structuredClone(snapshot));
  const deep = freezeVehicleData(structuredClone(snapshot));
  assert.notEqual(createVehicleSnapshot(shallow), shallow);
  assert.notEqual(createVehicleSnapshot(deep), deep);
});

test('unrecognised shallow and deeply frozen malformed snapshots still fail validation', async () => {
  for (const freeze of [Object.freeze, freezeVehicleData]) {
    for (const mutate of [
      (snapshot) => { snapshot.facts.seats.unit = 'L'; },
      (snapshot) => { snapshot.candidateKey = 'another-car'; },
      (snapshot) => { snapshot.facts.tags.value = new Date(instant); },
    ]) {
      const row = stock(); const input = structuredClone(row.snapshot); mutate(input); row.snapshot = freeze(input);
      assert.throws(() => createVehicleSnapshot(row.snapshot), TypeError);
      const outcome = await recommend(providerValue([row]));
      assert.equal(outcome.code, 'employee-source-invalid');
    }
  }
  const shallow = Object.freeze({ nested: { mutable: true } });
  freezeVehicleData(shallow);
  assert.equal(Object.isFrozen(shallow.nested), true);
});

test('mutable changed snapshots are revalidated and cannot change historical results', async () => {
  const source = structuredClone(providerValue());
  const before = await recommend(source); const historical = structuredClone(before);
  assert.equal(first(before).gateStatus, 'eligible');
  source.stock[0].snapshot.facts.seats.value = 2;
  const changed = await recommend(source);
  assert.equal(first(changed).gateStatus, 'ineligible');
  source.stock[0].snapshot.facts.seats.unit = 'wrong';
  assert.equal((await recommend(source)).code, 'employee-source-invalid');
  assert.deepEqual(before, historical);
  assert.equal(Object.isFrozen(first(before).snapshot.facts.seats), true);
});

test('equal configuration and version never substitute exact identities or bypass per-row checks', async () => {
  const rows = [stock(2), stock(1)]; const source = providerValue(rows);
  const outcome = await recommend(source);
  assert.equal(outcome.status, 'ok');
  assert.equal(rows[0].configurationId, rows[1].configurationId);
  assert.equal(rows[0].snapshot.snapshotVersion, rows[1].snapshot.snapshotVersion);
  assert.deepEqual(outcome.value.decisions.map((row) => [row.orderUuid, row.snapshot.sourceKeys.stockId, row.candidateKey]),
    rows.map((row) => [row.orderUuid, row.orderUuid, row.snapshot.candidateKey]));
  assert.deepEqual(outcome.value.recommendations.map((row) => row.orderUuid), [...rows].reverse().map((row) => row.orderUuid));
  assert.equal(outcome.value.decisions[0].snapshot, rows[0].snapshot);
  assert.equal(outcome.value.decisions[1].snapshot, rows[1].snapshot);
  for (const cars of [[rows[0], rows[0]], [{ ...rows[0], orderUuid: rows[1].orderUuid }], [{ ...rows[0], orderUuid: 'bad-id' }]]) {
    assert.equal((await recommend(providerValue(cars))).code, 'employee-source-invalid');
  }
  const vinRow = stock();
  vinRow.snapshot = createVehicleSnapshot({ ...vinRow.snapshot, vin: 'WBA12345678901234' });
  assert.equal((await recommend(providerValue([vinRow]))).code, 'employee-source-invalid');
});

test('trusted and mutable complete decisions, explanations and stored-subject replay are equivalent', async () => {
  const source = providerValue([stock(2), stock(1), stock(3, { seats: fact(2, 'count') }), stock(4, { seats: fact(null, 'count') })]);
  source.currentCar = currentCar();
  const request = { ...brief(), currentCarRating: rating(5) };
  const mutable = await recommend(structuredClone(source), structuredClone(request));
  const trusted = await recommend(source, request);
  assert.equal(trusted.status, 'ok'); assert.deepEqual(trusted, mutable);
  const evaluator = createStoredSubjectRecommendationEvaluator(ports(source));
  assert.deepEqual(await evaluator.evaluate(subject(), request), trusted);
  assert.deepEqual(await evaluator.evaluate(subject(), request), trusted);
  assert.deepEqual(JSON.parse(JSON.stringify(trusted)), JSON.parse(JSON.stringify(mutable)));
  assert.equal(Object.isFrozen(source.currentCar.facts.body), false);
  assert.equal(Object.isFrozen(source.employeeFacts), false);
});

test('shared stock keeps employee facts, brief, current car and availability isolated', async () => {
  const row = stock(); const source = providerValue([row]); source.currentCar = currentCar();
  const request = brief(); const before = await recommend(source, request); const history = structuredClone(before);
  const shared = first(before).snapshot;
  assert.notEqual(first(before).employeeFacts, source.employeeFacts);
  assert.notEqual(first(before).brief, request);
  assert.notEqual(first(before).evidence.availability, row.availability);
  source.employeeFacts.driverEligible.value = false;
  source.currentCar.facts.body.value = 'suv';
  row.availability.state = 'held'; request.essentials.seats.value = 9;
  const secondContext = { ...context, employeeId: 'employee-two' };
  const service = createEmployeeRecommendationService(ports(source, { provider: { async resolve(ctx) { return { status: 'ok', value: { ...source, employeeId: ctx.employeeId } }; } } }));
  const next = await service.recommend(secondContext, request);
  assert.equal(first(next).snapshot, shared);
  assert.equal(first(next).gateStatus, 'ineligible');
  assert.ok(first(next).blockers.some((entry) => entry.code === 'driver-ineligible'));
  assert.ok(first(next).blockers.some((entry) => entry.code === 'not-available'));
  assert.deepEqual(before, history);
  assert.equal(Object.isFrozen(source.currentCar.facts.body), false);
});

test('preview charging stays evaluation-local with trusted EV snapshots and unchanged provider inputs', async () => {
  const source = providerValue([stock(1, { fuel: fact('ev') })]); source.employeeFacts.charging = fact('none');
  const saved = structuredClone(source); const service = createEmployeeRecommendationService(ports(source));
  const { briefVersion, ...content } = brief();
  const request = { ...content, essentials: { ...content.essentials, charging: { ...essential('home', 'equals', null), state: 'draft' } } };
  const previewInput = { brief: request, baseBriefVersion: briefVersion, baseDraftVersion: 2 };
  const preview = await service.previewUnsaved(context, previewInput);
  assert.equal(first(preview).gateStatus, 'eligible');
  const mutable = createEmployeeRecommendationService(ports(structuredClone(source)));
  assert.deepEqual(await mutable.previewUnsaved(context, structuredClone(previewInput)), preview);
  assert.equal(first(await service.recommend(context, brief())).gateStatus, 'ineligible');
  assert.deepEqual(source, saved);
  assert.equal(request.essentials.charging.state, 'draft');
  assert.equal(Object.isFrozen(request), false);
});

test('stock reuse does not retain suitability across releases or time changes', async () => {
  const source = providerValue(); let now = instant;
  const clock = { async now() { return { status: 'ok', value: { now, runId: context.runId, clockVersion: now } }; } };
  const service = createEmployeeRecommendationService(ports(source, { time: clock }));
  const initial = await service.recommend(context, brief()); const history = structuredClone(initial);
  source.stock[0].availability.state = 'held'; source.stockVersion = 'release-two';
  const held = await service.recommend(context, brief());
  assert.equal(first(held).gateStatus, 'ineligible'); assert.equal(first(held).versions.stock, 'release-two');
  source.stock[0].availability.state = 'available'; now = '2026-12-02T12:00:00.000Z';
  const expired = await service.recommend(context, brief());
  assert.ok(first(expired).blockers.some((entry) => entry.code === 'required-by'));
  assert.deepEqual(initial, history);
  now = instant; source.stockVersion = 'stock-v1';
  assert.deepEqual(await service.recommend(context, brief()), initial);
});

test('repeated employees reuse stock without whole-snapshot cloning, validation or freezing', async (t) => {
  const source = providerValue(); const observer = observeSnapshotWork();
  try {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(createVehicleSnapshot(source.stock[0].snapshot), source.stock[0].snapshot);
      assert.equal(first(await recommend(source)).snapshot, source.stock[0].snapshot);
      assert.equal(first(await createStoredSubjectRecommendationEvaluator(ports(source)).evaluate(subject(), brief())).snapshot, source.stock[0].snapshot);
    }
    assert.deepEqual(observer.counts, { cloned: 0, validated: 0, frozen: 0, inspected: 0 });
    t.diagnostic(`trusted, six evaluations: ${JSON.stringify(observer.counts)}`);
  } finally { observer.restore(); }
  const mutable = structuredClone(source); const fallback = observeSnapshotWork();
  try {
    for (let i = 0; i < 3; i += 1) assert.equal((await recommend(mutable)).status, 'ok');
    assert.deepEqual(fallback.counts, { cloned: 3, validated: 3, frozen: 3, inspected: 0 });
    t.diagnostic(`mutable, three evaluations: ${JSON.stringify(fallback.counts)}`);
  } finally { fallback.restore(); }
});

test('persisted unbranded immutable stock is admitted once and reused by subsequent employees', async (t) => {
  const row = stock(); row.snapshot = freezeVehicleData(JSON.parse(JSON.stringify(row.snapshot)));
  const source = providerValue([row]); const observer = observeSnapshotWork(); let admitted;
  try {
    admitted = first(await recommend(source)).snapshot;
    assert.notEqual(admitted, row.snapshot);
    assert.deepEqual(admitted, row.snapshot);
    assert.ok(observer.counts.inspected > 0);
    assert.deepEqual(observer.counts, { cloned: 0, validated: 1, frozen: 1, inspected: observer.counts.inspected });
    t.diagnostic(`persisted first admission: ${JSON.stringify(observer.counts)}`);
    Object.assign(observer.counts, { cloned: 0, validated: 0, frozen: 0, inspected: 0 });
    for (let i = 0; i < 3; i += 1) {
      assert.equal(first(await recommend(source)).snapshot, admitted);
      assert.equal(first(await createStoredSubjectRecommendationEvaluator(ports(source)).evaluate(subject(), brief())).snapshot, admitted);
    }
    assert.deepEqual(observer.counts, { cloned: 0, validated: 0, frozen: 0, inspected: 0 });
    t.diagnostic(`persisted six subsequent evaluations: ${JSON.stringify(observer.counts)}`);
  } finally { observer.restore(); }
});

test('frozen accessor-backed and shallow snapshots never memoize their mutable nested facts', async () => {
  for (const accessor of [false, true]) {
    const row = stock(); const input = structuredClone(row.snapshot); const facts = input.facts;
    if (accessor) Object.defineProperty(input, 'facts', { enumerable: true, get: () => facts });
    row.snapshot = Object.freeze(input);
    const source = providerValue([row]); const initial = await recommend(source);
    assert.equal(first(initial).gateStatus, 'eligible');
    facts.seats.value = 2;
    const changed = await recommend(source);
    assert.equal(first(changed).gateStatus, 'ineligible');
    assert.notEqual(first(changed).snapshot, first(initial).snapshot);
    assert.equal(first(initial).snapshot.facts.seats.value, 5);
  }
});

test('provider accessors and non-enumerable snapshots retain structuredClone behavior', async () => {
  const source = providerValue(); const rows = source.stock; let reads = 0;
  Object.defineProperty(source, 'stock', { enumerable: true, get() { reads += 1; return rows; } });
  assert.equal(first(await recommend(source)).gateStatus, 'eligible');
  assert.equal(reads, 1);
  const row = stock();
  Object.defineProperty(row, 'snapshot', { enumerable: false });
  assert.equal((await recommend(providerValue([row]))).code, 'employee-source-invalid');
  for (const uncloneable of [
    Object.assign(() => {}, providerValue()),
    providerValue([Object.assign(() => {}, stock())]),
    { ...providerValue(), metadata: () => {} },
    { ...providerValue(), metadata: Symbol('not-data') },
    providerValue(Object.assign([stock()], { metadata: () => {} })),
  ]) assert.equal((await recommend(uncloneable)).code, 'employee-source-invalid');
  for (const source of [Object.assign(new Date(instant), providerValue()), providerValue([Object.assign(new Date(instant), stock())])]) {
    assert.deepEqual(await recommend(source), await recommend(structuredClone(source)));
  }
  const changing = providerValue(); const facts = changing.employeeFacts;
  Object.defineProperty(changing, 'employeeFacts', { enumerable: true, get() {
    changing.stock[0].snapshot = stock(1, { seats: fact(2, 'count') }).snapshot;
    return facts;
  } });
  assert.equal(first(await recommend(changing)).gateStatus, 'ineligible');
  const otherRows = [stock(1), stock(2)]; const availability = otherRows[0].availability;
  Object.defineProperty(otherRows[0], 'availability', { enumerable: true, get() {
    otherRows[1].snapshot = stock(2, { seats: fact(2, 'count') }).snapshot;
    return availability;
  } });
  assert.equal((await recommend(providerValue(otherRows))).value.decisions[1].gateStatus, 'ineligible');
  const hiddenRows = [stock()]; Object.defineProperty(hiddenRows, '0', { enumerable: false });
  assert.deepEqual(await recommend(providerValue(hiddenRows)), await recommend(structuredClone(providerValue(hiddenRows))));
});

test('malformed immutable stock keeps context refusal ahead of stock validation', async () => {
  const source = structuredClone(providerValue()); source.employeeId = 'another-employee';
  source.stock[0].snapshot.facts.seats.unit = 'invalid';
  const mutable = await recommend(source);
  assert.equal(mutable.status, 'stale-run');
  freezeVehicleData(source.stock[0].snapshot);
  assert.deepEqual(await recommend(source), mutable);
});

test('hidden snapshot fields are never admitted around provider structuredClone validation', async () => {
  for (const hide of [
    (snapshot) => Object.defineProperty(snapshot, 'sourceNamespace', { enumerable: false }),
    (snapshot) => Object.defineProperty(snapshot.facts.seats, 'value', { enumerable: false }),
    (snapshot) => Object.defineProperty(snapshot.facts.tags.value, 'hidden', { value: 'ignored', enumerable: false }),
  ]) {
    const row = stock(); row.snapshot = structuredClone(row.snapshot); hide(row.snapshot); freezeVehicleData(row.snapshot);
    const source = providerValue([row]); const expected = await recommend(structuredClone(source));
    assert.deepEqual(await recommend(source), expected);
    createVehicleSnapshot(row.snapshot);
    assert.deepEqual(await recommend(source), expected);
    if (expected.status === 'ok') assert.notEqual(first(await recommend(source)).snapshot, first(await recommend(source)).snapshot);
    else assert.equal(expected.code, 'employee-source-invalid');
  }
});
