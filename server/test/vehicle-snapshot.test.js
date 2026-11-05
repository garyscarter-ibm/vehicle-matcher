import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createVehicleSnapshot, createRetailTerms, createEmployeeTerms, createEmployeeProjection,
} from '../vehicles/index.js';
import { adaptMappedRetailVehicle, adaptRawRetailVehicle, projectRetailVehicle } from '../adapters/retail-vehicle.js';
import { syntheticVehicleFixtures } from '../adapters/synthetic-vehicle-fixtures.js';
import { mapVehicle } from '../mapping.js';

const observedAt = '2026-11-01T12:00:00.000Z';
const evidence = (assurance = 'synthetic-scenario') => ({
  sourceRef: 'fixture:vehicle-facts', observedAt, version: 'fixture-v1', assurance,
});
const fact = (value, unit = null, assurance = 'synthetic-scenario') => ({
  status: value === null ? 'unknown' : 'known', value, unit,
  provenance: evidence(value === null ? 'unknown' : assurance),
});
const source = () => ({
  sourceNamespace: 'fixture/scheme', identityKind: 'exact-stock',
  sourceKeys: { stockId: 'stock:01', advertId: 42, modelGroupId: '3-series' },
  snapshotVersion: 'stock-v1', observedAt, display: { name: 'Synthetic Touring' },
  facts: { seats: fact(5, 'count'), boot: fact(500, 'L'), frontIsofix: fact(null), rearIsofix: fact(true, null, 'derived') },
});
const quote = () => ({
  termsVersion: 'quote-v1', points: { value: 125, unit: 'points' },
  allowanceInputs: { allowance: { value: 130, unit: 'points' } },
  contribution: { amount: 15, currency: 'GBP', period: 'month' },
  validFrom: '2026-11-01T00:00:00.000Z', validUntil: '2026-12-01T00:00:00.000Z',
  provenance: evidence(),
});

test('namespaced exact stock, advert and model group identities stay distinct', () => {
  const snapshot = createVehicleSnapshot(source());
  assert.equal(snapshot.candidateKey, 'fixture%2Fscheme:exact-stock:stock%3A01');
  assert.deepEqual(snapshot.sourceKeys, { stockId: 'stock:01', advertId: 42, modelGroupId: '3-series' });
  assert.equal(snapshot.vin, undefined);
  assert.notEqual(createVehicleSnapshot({ ...source(), sourceNamespace: 'other' }).candidateKey, snapshot.candidateKey);
  assert.notEqual(createVehicleSnapshot({ ...source(), identityKind: 'advert' }).candidateKey, snapshot.candidateKey);
  assert.throws(() => createVehicleSnapshot({ ...source(), identityKind: 'model-group' }), /identityKind/);
  assert.throws(() => createVehicleSnapshot({ ...source(), candidateKey: 'forged' }), /candidateKey/);
});

test('snapshots require real candidate keys and valid observation/version metadata', () => {
  for (const patch of [
    { sourceNamespace: '' }, { snapshotVersion: '' }, { observedAt: 'yesterday' },
    { sourceKeys: { modelGroupId: 'only-a-group' } }, { vin: 'advert-42' },
  ]) assert.throws(() => createVehicleSnapshot({ ...source(), ...patch }), TypeError);
});

test('fact values retain units and separate unknown, derived, model and exact evidence', () => {
  const input = source();
  input.facts.boot.provenance = evidence('model-reference');
  input.facts.seats.provenance = evidence('confirmed-build');
  const snapshot = createVehicleSnapshot(input);
  assert.equal(snapshot.facts.boot.unit, 'L');
  assert.equal(snapshot.facts.boot.provenance.assurance, 'model-reference');
  assert.equal(snapshot.facts.seats.provenance.assurance, 'confirmed-build');
  assert.equal(snapshot.facts.rearIsofix.provenance.assurance, 'derived');
  assert.deepEqual(snapshot.facts.frontIsofix, fact(null));
  assert.equal(snapshot.facts.frontIsofix.provenance.observedAt, observedAt);
});

test('invalid facts cannot omit units or promote unknowns to confirmed equipment', () => {
  for (const bad of [
    { ...fact(5), unit: null }, { ...fact(5, 'L') },
    { ...fact(null), provenance: evidence('confirmed-build') },
    { ...fact(5, 'count'), provenance: { ...evidence(), sourceRef: '' } },
    { ...fact(Infinity, 'count') }, { ...fact(5, 'count'), status: 'unknown' },
  ]) assert.throws(() => createVehicleSnapshot({ ...source(), facts: { seats: bad } }), TypeError);
});

test('source snapshots detach and recursively freeze input data', () => {
  const input = source();
  const snapshot = createVehicleSnapshot(input);
  input.sourceKeys.stockId = 'changed';
  input.facts.seats.value = 2;
  assert.equal(snapshot.sourceKeys.stockId, 'stock:01');
  assert.equal(snapshot.facts.seats.value, 5);
  assert.throws(() => { snapshot.facts.seats.value = 2; }, TypeError);
  assert.throws(() => { snapshot.display.name = 'changed'; }, TypeError);
});

test('shared snapshots reject employee-specific overlays and mutable object types', () => {
  for (const patch of [{ eligibility: {} }, { scores: {} }, { terms: quote() }, { hold: {} }, { offer: {} }]) {
    assert.throws(() => createVehicleSnapshot({ ...source(), ...patch }), TypeError);
  }
  assert.throws(() => createVehicleSnapshot({ ...source(), facts: { equipment: fact(new Map()) } }), TypeError);
});

test('retail terms distinguish absent and zero price, and accept only GBP purchase amounts', () => {
  assert.equal(createRetailTerms({ purchasePrice: null, provenance: evidence('unknown') }).purchasePrice, null);
  assert.deepEqual(createRetailTerms({ purchasePrice: { amount: 0, currency: 'GBP' }, provenance: evidence() }).purchasePrice,
    { amount: 0, currency: 'GBP' });
  for (const price of [{ amount: -1, currency: 'GBP' }, { amount: 1, currency: 'points' }]) {
    assert.throws(() => createRetailTerms({ purchasePrice: price, provenance: evidence() }), TypeError);
  }
});

test('employee terms preserve points, dated contribution and currency/period independently', () => {
  const terms = createEmployeeTerms(quote());
  assert.equal(terms.kind, 'employee-scheme');
  assert.equal(terms.points.value, 125);
  assert.deepEqual(terms.contribution, { amount: 15, currency: 'GBP', period: 'month' });
  assert.equal(terms.purchasePrice, undefined);
  assert.equal(terms.allowanceInputs.allowance.unit, 'points');
  assert.ok(Object.isFrozen(terms.allowanceInputs.allowance));
});

test('employee quotes reject ambiguous points, periods, dates and non-finite finance', () => {
  for (const patch of [
    { points: { value: 125, unit: 'GBP' } },
    { contribution: { amount: NaN, currency: 'GBP', period: 'month' } },
    { contribution: { amount: 15, currency: 'GBP' } },
    { contribution: { amount: 15, currency: ['GBP'], period: 'month' } },
    { validUntil: '2026-10-01T00:00:00.000Z' }, { termsVersion: '' },
    { purchasePrice: { amount: 125, currency: 'GBP' } },
  ]) assert.throws(() => createEmployeeTerms({ ...quote(), ...patch }), TypeError);
});

test('employee inventory needs no retail price and evaluations cannot affect another employee', () => {
  const snapshot = createVehicleSnapshot(source());
  const input = { employeeKey: 'employee-a', policyVersion: 'test-policy-v1', evaluatedAt: observedAt,
    terms: quote(), eligibility: { status: 'eligible', reasons: [] }, scores: { fit: 82 },
    hold: { id: 'hold-a' }, offer: { id: 'offer-a' } };
  const a = createEmployeeProjection(snapshot, input);
  const b = createEmployeeProjection(snapshot, { ...input, employeeKey: 'employee-b', terms: { ...quote(), points: { value: 140, unit: 'points' } },
    eligibility: { status: 'ineligible', reasons: ['allowance'] }, scores: { fit: 41 }, hold: null, offer: null });
  input.scores.fit = 0;
  input.terms.contribution.amount = 999;
  assert.equal(a.scores.fit, 82);
  assert.equal(a.terms.contribution.amount, 15);
  assert.equal(b.scores.fit, 41);
  assert.equal(b.terms.points.value, 140);
  assert.equal(snapshot.terms, undefined);
  assert.equal(snapshot.hold, undefined);
  assert.throws(() => { a.terms.points.value = 0; }, TypeError);
  assert.throws(() => { a.snapshot.facts.seats.value = 2; }, TypeError);
});

test('employee projection validates its trusted context and rejects retail terms', () => {
  const context = { employeeKey: 'a', policyVersion: 'p1', evaluatedAt: observedAt, terms: quote(), eligibility: { status: 'eligible', reasons: [] } };
  for (const patch of [{ employeeKey: '' }, { policyVersion: '' }, { evaluatedAt: 'now' },
    { eligibility: { status: 'maybe' } }, { terms: { purchasePrice: 100 } }]) {
    assert.throws(() => createEmployeeProjection(createVehicleSnapshot(source()), { ...context, ...patch }), TypeError);
  }
});

const context = { sourceNamespace: 'retail/bmw', snapshotVersion: 'legacy-fixture-v1', observedAt,
  sourceRef: 'fixture:existing-retail', modelGroupId: '3-Series|tourer' };

test('already-mapped fixtures receive honest annotations and exactly preserve retail shapes', () => {
  const car = { id: 'advert-123', name: 'Existing fixture', priceMin: 31000, priceMax: 31000,
    seats: 5, boot: 500, features: ['isofix', 'heatedSeats'], monthlyFrom: '£199', photo: undefined };
  const before = structuredClone(car);
  const adapted = adaptMappedRetailVehicle(car, context);
  assert.equal(adapted.annotation.mapping, 'already-mapped');
  assert.equal(adapted.snapshot.facts.seats.provenance.assurance, 'model-reference');
  assert.equal(adapted.snapshot.facts.features.provenance.assurance, 'derived');
  assert.equal(adapted.snapshot.facts.frontIsofix.status, 'unknown');
  assert.equal(adapted.snapshot.facts.rearIsofix.status, 'unknown');
  assert.deepEqual(projectRetailVehicle(adapted), before);
  assert.deepEqual(car, before);
  const projection = projectRetailVehicle(adapted);
  projection.features.push('towbar');
  projection.colour = { colour: 'Blue' };
  assert.deepEqual(projectRetailVehicle(adapted), before);
  assert.equal(adapted.employeeTerms, undefined);
});

test('raw retail adapter preserves mapper signature/output and the original advert and VIN keys', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/retail-compat-v1/inputs.json', import.meta.url)));
  for (const brand of ['bmw', 'mini']) {
    for (const raw of input.raw[brand]) {
      const adapted = adaptRawRetailVehicle(raw, brand, { ...context, sourceNamespace: `retail/${brand}` });
      assert.deepEqual(projectRetailVehicle(adapted), mapVehicle(raw, brand));
      assert.equal(adapted.annotation.mapping, 'mapped-now');
      if (raw.advert_id != null) assert.equal(adapted.snapshot.sourceKeys.advertId, raw.advert_id);
    }
  }
  assert.equal(adaptRawRetailVehicle({ advert_id: 'no-price' }, 'bmw', context), null);
});

test('legacy annotations never turn monthly text or inferred prices into employee finance', () => {
  const adapted = adaptMappedRetailVehicle({ id: 'legacy-no-price', name: 'Scheme-shaped input', monthlyFrom: '£199' }, context);
  assert.equal(adapted.retailTerms.purchasePrice, null);
  assert.equal(adapted.snapshot.facts.frontIsofix.status, 'unknown');
  assert.equal(adapted.snapshot.facts.seats.status, 'unknown');
  assert.equal(adapted.snapshot.vin, undefined);
  const employee = createEmployeeProjection(adapted.snapshot, { employeeKey: 'a', policyVersion: 'p1', evaluatedAt: observedAt,
    terms: quote(), eligibility: { status: 'needs-confirmation', reasons: ['unknown equipment'] } });
  assert.equal(employee.terms.contribution.amount, 15);
  assert.equal(adapted.snapshot.terms, undefined);
});

test('explicit synthetic adapter fixtures provide unknown essentials without fabricating VINs', () => {
  const fixtures = syntheticVehicleFixtures();
  assert.equal(fixtures.length, 2);
  assert.equal(fixtures[0].vin, undefined);
  assert.notEqual(fixtures[0].candidateKey, fixtures[1].candidateKey);
  assert.equal(fixtures[0].facts.frontIsofix.status, 'unknown');
  assert.equal(fixtures[0].facts.seats.provenance.assurance, 'synthetic-scenario');
  assert.equal(fixtures[0].facts.rearIsofix.provenance.assurance, 'synthetic-scenario');
  assert.ok(Object.isFrozen(fixtures[0].facts));
});

test('VIN-only raw rows retain VIN identity and unkeyed rows cannot invent advert identities', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/retail-compat-v1/inputs.json', import.meta.url)));
  const raw = { ...input.raw.bmw[0], vin: 'WBA00000000000001' };
  delete raw.advert_id;
  const adapted = adaptRawRetailVehicle(raw, 'bmw', context);
  assert.equal(adapted.snapshot.identityKind, 'vin');
  assert.equal(adapted.snapshot.vin, 'WBA00000000000001');
  assert.equal(adapted.snapshot.sourceKeys.advertId, undefined);
  assert.equal(adapted.snapshot.candidateKey, 'retail%2Fbmw:vin:WBA00000000000001');
  delete raw.vin;
  assert.throws(() => adaptRawRetailVehicle(raw, 'bmw', context), /candidate identity/);
  const legacy = adaptMappedRetailVehicle({ id: 'unverified-key', name: 'Legacy', priceMin: 1, priceMax: 1 }, context);
  assert.equal(legacy.snapshot.identityKind, 'legacy-record');
  assert.deepEqual(legacy.snapshot.sourceKeys, { recordId: 'unverified-key', modelGroupId: '3-Series|tourer' });
});

test('known numeric and position-specific equipment facts reject incompatible value types', () => {
  for (const facts of [{ seats: fact('five', 'count') }, { seats: fact(-1, 'count') },
    { seats: fact(4.5, 'count') }, { frontIsofix: fact('yes') }, { boot: fact(500, 'litres') }]) {
    assert.throws(() => createVehicleSnapshot({ ...source(), facts }), TypeError);
  }
  assert.throws(() => createVehicleSnapshot({ ...source(), vin: 12345678901234567 }), TypeError);
});

test('all frozen legacy brand pools can project without payload additions or lost values', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/retail-compat-v1/inputs.json', import.meta.url)));
  for (const [brand, cars] of Object.entries(input.mapped)) {
    for (const car of cars) {
      assert.deepEqual(projectRetailVehicle(adaptMappedRetailVehicle(car, { ...context, sourceNamespace: `legacy/${brand}` })), car);
    }
  }
});

test('new fact evidence produces an independent snapshot version and retains earlier unknowns', () => {
  const old = createVehicleSnapshot(source());
  const refreshed = createVehicleSnapshot({ ...old, snapshotVersion: 'stock-v2', observedAt: '2026-11-02T12:00:00.000Z',
    facts: { ...old.facts, frontIsofix: fact(true, null, 'confirmed-build') } });
  assert.equal(old.facts.frontIsofix.status, 'unknown');
  assert.equal(old.snapshotVersion, 'stock-v1');
  assert.equal(refreshed.facts.frontIsofix.provenance.assurance, 'confirmed-build');
  assert.equal(refreshed.snapshotVersion, 'stock-v2');
  assert.equal(refreshed.candidateKey, old.candidateKey);
});

test('a null optional VIN preserves a valid advert and its unchanged retail projection', () => {
  const input = JSON.parse(readFileSync(new URL('./fixtures/retail-compat-v1/inputs.json', import.meta.url)));
  const raw = { ...input.raw.bmw[0], vin: null };
  const adapted = adaptRawRetailVehicle(raw, 'bmw', context);
  assert.equal(adapted.snapshot.vin, undefined);
  assert.equal(adapted.snapshot.sourceKeys.advertId, raw.advert_id);
  assert.deepEqual(projectRetailVehicle(adapted), mapVehicle(raw, 'bmw'));
});
