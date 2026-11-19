import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackState, reduceFeedback, applyBrowseFeedback, matchesFeedbackPredicate,
  applyConfirmedFeedbackChange, validateFeedbackAction } from '../../blocks/vehicle-matcher/feedback-actions.js';
import { instant, brief, essential } from './helpers/employee-recommendation.js';

const browseScope = { kind: 'browse', id: 'questionnaire:test' };
const employeeScope = { kind: 'employee-draft', id: 'employee:test' };
const action = (state, type, target, id = `${type}:${state.version}`, extra = {}) => ({ schemaVersion: 1,
  id, type, target, reason: 'Explicit local feedback', scope: state.scope, expectedVersion: state.version, ...extra });
const change = (state, path, value, extra = {}) => action(state.feedback ?? state, 'confirm-change', { path, value }, undefined,
  { confirmation: { actor: 'employee', confirmed: true, at: instant }, ...extra });
const freeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const listings = [
  { id: 'red', colour: 'Chili Red', shade: 'Red', priceMin: 30000, mileage: 12000, transmission: 'auto', features: ['heatedSeats'], link: '/red', photo: '/red.jpg' },
  { id: 'blue', colour: 'Ocean Blue', shade: 'Blue', priceMin: 25000, mileage: 8000, transmission: 'manual', features: ['towbar'], link: '/blue', photo: '/blue.jpg' },
  { id: 'unknown', priceMin: 22000, mileage: null, features: [] },
];
const retail = () => [{ car: { id: 'group-a', name: 'Grouped car', priceMin: 30000, listingCount: 3 }, score: 95, listings: structuredClone(listings) },
  { car: { id: 'group-b', name: 'Next car', priceMin: 20000 }, score: 90, listings: [{ id: 'other', colour: 'Black', shade: 'Black', priceMin: 20000, mileage: 4000, transmission: 'auto' }] }];

test('typed actions round trip as JSON; closures, unsupported operators and durable operations are refused', () => {
  const state = createFeedbackState(browseScope);
  const data = action(state, 'filter', { field: 'odometer', operator: 'less-than', value: 10000 });
  assert.equal(validateFeedbackAction(JSON.parse(JSON.stringify(data))), null);
  for (const invalid of [{ ...data, test: () => true }, { ...data, target: { field: 'annual-mileage', operator: 'less-than', value: 10000 } },
    { ...data, type: 'release-hold' }, { ...data, target: { ...data.target, value: Infinity } }]) assert.equal(validateFeedbackAction(invalid).status, 'invalid');
  const circular = { ...data }; circular.target = circular;
  assert.equal(validateFeedbackAction(circular).status, 'invalid');
});

test('exact exclusion keeps a sibling while whole-group shrug removes its entire card', () => {
  const state = createFeedbackState(browseScope); const pool = freeze(retail());
  const exact = reduceFeedback(state, action(state, 'exclude-candidate', { id: 'red' }));
  assert.deepEqual(applyBrowseFeedback(pool, exact.state)[0].listings.map((l) => l.id), ['blue', 'unknown']);
  const group = reduceFeedback(state, action(state, 'exclude-group', { id: 'group-a' }));
  assert.deepEqual(applyBrowseFeedback(pool, group.state).map((m) => m.car.id), ['group-b']);
  assert.equal(pool[0].listings.length, 3);
});

test('retail colour, cheaper purchase, lower odometer and gearbox preserve exact operators and unknown treatment', () => {
  for (const [target, expected] of [
    [{ field: 'shade', operator: 'not-equals', value: 'Red' }, ['blue', 'unknown']],
    [{ field: 'purchase-price', operator: 'less-than', value: 30000 }, ['blue', 'unknown']],
    [{ field: 'odometer', operator: 'less-than', value: 12000 }, ['blue']],
    [{ field: 'transmission', operator: 'not-equals', value: 'auto' }, ['blue', 'unknown']],
    [{ field: 'feature', operator: 'includes', value: 'heatedSeats' }, ['red']],
  ]) {
    const state = createFeedbackState(browseScope);
    const reduced = reduceFeedback(state, action(state, 'filter', target));
    assert.deepEqual(applyBrowseFeedback(retail(), reduced.state)[0].listings.map((l) => l.id), expected);
  }
  assert.equal(matchesFeedbackPredicate({ mileage: 10000, annualMileage: 500 }, { field: 'odometer', operator: 'less-than', value: 1000 }), false);
});

test('reconstruction derives count, ranges, features, paint and representative fields from survivors', () => {
  const state = createFeedbackState(browseScope);
  const reduced = reduceFeedback(state, action(state, 'filter', { field: 'shade', operator: 'equals', value: 'Blue' }));
  const [result] = applyBrowseFeedback(freeze(retail()), reduced.state);
  assert.equal(result.car.id, 'group-a'); assert.equal(result.car.listingCount, 1);
  assert.equal(result.car.priceMin, 25000); assert.equal(result.car.priceMax, 25000); assert.equal(result.car.priceFrom, 25000); assert.equal(result.car.priceTo, 25000);
  assert.equal(result.car.mileage, 8000); assert.equal(result.car.link, '/blue'); assert.equal(result.car.photo, '/blue.jpg');
  assert.deepEqual(result.car.colours, ['Ocean Blue']); assert.deepEqual(result.car.features, ['towbar']);
});

test('a surviving listing with unknown odometer cannot inherit the excluded listing mileage or price range', () => {
  const pool = retail();
  pool[0].car = { ...pool[0].car, priceMax: 30000, mileage: 12000 };
  const state = createFeedbackState(browseScope);
  const filtered = reduceFeedback(state, action(state, 'filter', { field: 'purchase-price', operator: 'less-than', value: 23000 }));
  const [result] = applyBrowseFeedback(freeze(pool), filtered.state);
  assert.equal(result.car.listingCount, 1);
  assert.equal(result.car.priceMin, 22000);
  assert.equal(result.car.priceMax, 22000);
  assert.equal(result.car.mileage, null);
});

test('local undo and reset are versioned, immutable and reversible even after an empty result', () => {
  const pool = freeze(retail()); const initial = freeze(createFeedbackState(browseScope));
  const first = reduceFeedback(initial, action(initial, 'exclude-group', { id: 'group-a' }, 'a')).state;
  const second = reduceFeedback(first, action(first, 'exclude-group', { id: 'group-b' }, 'b')).state;
  assert.equal(applyBrowseFeedback(pool, second).length, 0);
  const undo = reduceFeedback(second, action(second, 'undo', { actionIds: ['a', 'b'] }));
  assert.deepEqual(applyBrowseFeedback(pool, undo.state), pool); assert.equal(undo.nextVersion, 3);
  assert.deepEqual(initial.actions, []); assert.equal(first.actions.length, 1);
  const reset = reduceFeedback(second, action(second, 'reset', {})); assert.equal(reset.state.actions.length, 0);
});

test('stale version, wrong scope, duplicate action and invalid undo fail without any partial state', () => {
  const state = freeze(createFeedbackState(browseScope, 3));
  for (const a of [action(state, 'exclude-group', { id: 'a' }, 'a', { expectedVersion: 2 }),
    action(state, 'exclude-group', { id: 'a' }, 'a', { scope: { ...browseScope, id: 'other' } }), action(state, 'undo', { actionIds: ['missing'] })]) {
    const result = reduceFeedback(state, a); assert.notEqual(result.status, 'ok'); assert.equal(result.state, undefined); assert.equal(result.nextVersion, undefined);
  }
  const accepted = reduceFeedback(state, action(state, 'exclude-group', { id: 'a' }, 'a')).state;
  assert.equal(reduceFeedback(accepted, action(accepted, 'exclude-group', { id: 'b' }, 'a')).code, 'duplicate-action');
  assert.equal(state.version, 3); assert.deepEqual(state.actions, []);
});

test('confirmed changes require employee authority, preserve essentials, and return an explicit next version', () => {
  const original = freeze({ ...brief(), essentials: { ...brief().essentials, charging: essential('none', 'equals', null) } });
  const state = createFeedbackState(employeeScope, 1);
  const proposed = change(state, 'essentials.charging', essential('either', 'equals', null), { confirmation: { actor: 'inference', confirmed: true, at: instant } });
  assert.equal(applyConfirmedFeedbackChange(original, proposed).status, 'confirmation-required');
  assert.equal(applyConfirmedFeedbackChange(original, change(state, 'essentials.seats', null)).status, 'invalid');
  const applied = applyConfirmedFeedbackChange(original, change(state, 'preferences.body.value', 'suv'));
  assert.equal(applied.nextVersion, 2); assert.equal(applied.brief.briefVersion, 2);
  assert.equal(applied.brief.preferences.body.value, 'suv'); assert.deepEqual(applied.brief.essentials, original.essentials);
  assert.equal(original.preferences.body.value, 'estate');
});

test('canonical semantic no-op retains single-change consent across provenance, equipment order and duplicates', () => {
  const original = { ...brief(), essentials: { equipment: essential(['towbar', 'heatedSeats'], 'includes', 'equipment-key') } };
  const state = createFeedbackState(employeeScope, 1);
  assert.equal(applyConfirmedFeedbackChange(original, change(state, 'preferences.body.value', 'estate')).code, 'unchanged-value');
  assert.equal(applyConfirmedFeedbackChange(original, change(state, 'essentials.equipment', { ...essential(['heatedSeats', 'towbar', 'towbar'], 'includes', 'equipment-key'), source: 'reviewed-form' })).code, 'unchanged-value');
});
