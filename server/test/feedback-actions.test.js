import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackState, reduceFeedback, applyBrowseFeedback, matchesFeedbackPredicate,
  applyConfirmedFeedbackChange, validateFeedbackAction } from '../../blocks/vehicle-matcher/feedback-actions.js';
import { createEmployeeFeedbackDraft, reduceEmployeeDraft } from '../scenarios/employee/feedback.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { context, instant, fact, brief, stock, providerValue, provider, time, policy, preference, essential } from './helpers/employee-recommendation.js';

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

async function employeeFixture(cars = [stock()], request = brief(), input = providerValue(cars)) {
  const policies = policy();
  const read = { runId: context.runId, asOf: instant, policyVersion: context.policyVersion };
  const [calibration, minimum, maximum, charging, lifecycle] = await Promise.all(['employee.recommendation.v1', 'brief.slider.minimum', 'brief.slider.maximum',
    'eligibility.homeCharging.requiredForPlugIn', 'brief.lifecycle.v1'].map((key) => policies.getAssumption(key, read)));
  const projected = { ...request, essentials: Object.fromEntries(Object.entries(request.essentials).filter(([key]) => key !== 'charging')) };
  const source = await createEmployeeRecommendationService({ policy: policies, provider: provider(input), time }).recommend(context, projected);
  assert.equal(source.status, 'ok');
  return { state: createEmployeeFeedbackDraft(request, employeeScope), options: { source, config: calibration.value.value,
    slider: { minimum: minimum.value.value, maximum: maximum.value.value }, chargingRequired: charging.value.value,
    chargingDefinition: lifecycle.value.value.charging } };
}

test('employee recomputation promotes a candidate beyond the display cap using complete exact decisions', async () => {
  const cars = [stock(1), stock(2), stock(3), stock(4, { body: fact('suv') })];
  const f = await employeeFixture(cars); freeze(f);
  assert.equal(f.options.source.value.recommendations.some((d) => d.orderUuid === cars[3].orderUuid), false);
  const result = reduceEmployeeDraft(f.state, change(f.state, 'preferences.body.value', 'suv'), f.options);
  assert.equal(result.status, 'ok'); assert.equal(result.outcome.decisions.length, 4);
  assert.equal(result.outcome.recommendations[0].orderUuid, cars[3].orderUuid);
  assert.equal(result.nextVersion, 2); assert.equal(f.state.brief.briefVersion, 1);
});

test('employee exact and configuration-group exclusions are local and undo restores every recomputed candidate', async () => {
  const cars = [stock(1), stock(2), stock(3)];
  const f = await employeeFixture(cars); const key = f.options.source.value.decisions[0].candidateKey;
  const exact = reduceEmployeeDraft(f.state, action(f.state.feedback, 'exclude-candidate', { id: key }, 'exact'), f.options);
  assert.equal(exact.status, 'ok'); assert.equal(exact.outcome.eligibleCount, 2);
  const grouped = reduceEmployeeDraft(f.state, action(f.state.feedback, 'exclude-group', { id: cars[0].configurationId }, 'group'), f.options);
  assert.equal(grouped.status, 'ok'); assert.equal(grouped.outcome.eligibleCount, 0);
  const undo = reduceEmployeeDraft(grouped.state, action(grouped.state.feedback, 'undo', { actionIds: ['group'] }), f.options);
  assert.equal(undo.outcome.eligibleCount, 3); assert.equal(undo.nextVersion, 3);
});

test('employee essential changes recompute all candidates to no-match and undo restores previous essentials', async () => {
  const f = await employeeFixture();
  const changed = reduceEmployeeDraft(f.state, change(f.state, 'essentials.seats', essential(7)), f.options);
  assert.equal(changed.status, 'ok', JSON.stringify(changed)); assert.equal(changed.outcome.state, 'no-match');
  assert.equal(changed.outcome.decisions[0].gateStatus, 'ineligible');
  const undone = reduceEmployeeDraft(changed.state, action(changed.state.feedback, 'undo', { actionIds: [changed.state.feedback.actions[0].id] }), f.options);
  assert.equal(undone.outcome.state, 'recommendations'); assert.equal(undone.state.brief.essentials.seats.value, 5);
});

test('undoing an earlier change to the same field leaves later confirmed intent intact', async () => {
  const f = await employeeFixture();
  const firstAction = change(f.state, 'preferences.body.value', 'suv');
  const first = reduceEmployeeDraft(f.state, firstAction, f.options);
  const second = reduceEmployeeDraft(first.state, change(first.state, 'preferences.body.value', 'estate'), f.options);
  assert.equal(second.status, 'ok');
  const undo = reduceEmployeeDraft(second.state, action(second.state.feedback, 'undo', { actionIds: [firstAction.id] }), f.options);
  assert.equal(undo.status, 'ok', JSON.stringify(undo)); assert.equal(undo.state.brief.preferences.body.value, 'estate');
  const noop = reduceEmployeeDraft(second.state, change(second.state, 'preferences.body.value', 'estate'), f.options);
  assert.equal(noop.code, 'unchanged-value'); assert.equal(noop.nextVersion, undefined);
});

test('inference cannot override charging:none or discard essentials; confirmed changes retain provider gates', async () => {
  const cars = [stock(1, { fuel: fact('ev') })];
  const request = { ...brief(), essentials: { ...brief().essentials, charging: { ...essential('none', 'equals', null), confirmedAt: instant } } };
  const input = providerValue(cars); input.employeeFacts.charging = fact('none');
  const f = await employeeFixture(cars, request, input); freeze(f);
  const unconfirmed = change(f.state, 'essentials.charging', essential('either', 'equals', null));
  delete unconfirmed.confirmation;
  const proposed = reduceEmployeeDraft(f.state, unconfirmed, f.options);
  assert.equal(proposed.status, 'confirmation-required'); assert.equal(proposed.state, undefined);
  const changed = reduceEmployeeDraft(f.state, change(f.state, 'preferences.body.value', 'suv'), f.options);
  assert.equal(changed.status, 'ok', JSON.stringify(changed)); assert.equal(changed.outcome.state, 'no-match');
  assert.ok(changed.outcome.decisions[0].blockers.some((e) => e.code === 'charging-unavailable'));
  assert.equal(changed.state.brief.essentials.charging.value, 'none');
  const permitted = reduceEmployeeDraft(f.state, change(f.state, 'essentials.charging', essential('either', 'equals', null)), f.options);
  assert.equal(permitted.status, 'ok'); assert.equal(permitted.outcome.state, 'recommendations');
  assert.ok(permitted.outcome.decisions[0].reasons.some((e) => e.code === 'policy-include'));
});

test('unknown remains a confirmation need rather than indifference when another preference changes', async () => {
  const request = { ...brief(), essentials: { seats: { ...essential(null), state: 'needs-confirmation' } } };
  const f = await employeeFixture([stock()], request);
  const changed = reduceEmployeeDraft(f.state, change(f.state, 'preferences.body.value', 'suv'), f.options);
  assert.equal(changed.status, 'ok'); assert.equal(changed.outcome.state, 'needs-confirmation');
  assert.equal(changed.state.brief.essentials.seats.value, null); assert.equal(changed.state.brief.essentials.seats.state, 'needs-confirmation');
});

test('provider-owned essential blockers survive local changes and cannot be undone by employee feedback', async () => {
  const input = providerValue(); input.employeeFacts.essentials = { seats: essential(7) };
  const f = await employeeFixture(input.stock, brief(), input);
  const result = reduceEmployeeDraft(f.state, change(f.state, 'essentials.seats', essential(4)), f.options);
  assert.equal(result.status, 'ok'); assert.equal(result.outcome.state, 'no-match');
  assert.ok(result.outcome.decisions[0].blockers.some((b) => b.authority === 'employee-provider' && b.code === 'essential-unmet'));
});

test('stale employee changes and unavailable/incomplete inputs do not return partial changes or new versions', async () => {
  const f = await employeeFixture(); const before = JSON.stringify(f.state);
  const cases = [reduceEmployeeDraft(f.state, change(f.state, 'preferences.body.value', 'suv', { expectedVersion: 0 }), f.options),
    reduceEmployeeDraft(f.state, change(f.state, 'preferences.body.value', 'suv'), { ...f.options, source: { status: 'unavailable' } }),
    reduceEmployeeDraft(f.state, change(f.state, 'preferences.body.value', 'suv'), { ...f.options, source: { status: 'ok', value: { recommendations: [] } } })];
  assert.deepEqual(cases.map((r) => r.status), ['stale-version', 'unavailable', 'unavailable']);
  for (const result of cases) { assert.equal(result.state, undefined); assert.equal(result.nextVersion, undefined); }
  assert.equal(JSON.stringify(f.state), before);
});

