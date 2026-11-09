import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasonText, longDate, bodyStyleLabel } from '../../blocks/gcsp/kit/plain-copy.js';

// Every code the server emits in reasons, tradeOffs, blockers and unknowns, with the fields it carries.
const CODES = [
  ['reasons', { code: 'driver-eligible' }], ['blockers', { code: 'driver-ineligible' }], ['unknowns', { code: 'driver-unconfirmed' }],
  ['reasons', { code: 'policy-include', ruleIds: ['r1'] }], ['blockers', { code: 'policy-exclude', ruleIds: ['r1'] }],
  ['unknowns', { code: 'eligibility-unconfirmed', reasons: [] }], ['unknowns', { code: 'points-unavailable', configurationId: 'c1' }],
  ['reasons', { code: 'allowance-sufficient', allowance: 1300, monthlyPoints: 1100, unit: 'points/month' }],
  ['blockers', { code: 'allowance-exceeded', allowance: 1300, monthlyPoints: 1400, unit: 'points/month' }],
  ['unknowns', { code: 'employee-essentials-unconfirmed' }],
  ['reasons', { code: 'essential-met', field: 'zeroTo62' }], ['blockers', { code: 'essential-unmet', field: 'body' }],
  ['unknowns', { code: 'essential-unconfirmed', field: 'boot' }], ['unknowns', { code: 'equipment-unconfirmed', field: 'equipment', keys: ['towbar'] }],
  ['unknowns', { code: 'fuel-unconfirmed' }], ['reasons', { code: 'charging-ready' }], ['blockers', { code: 'charging-unavailable' }],
  ['unknowns', { code: 'charging-unconfirmed' }],
  ['tradeOffs', { code: 'preference-fit', field: 'sportiness', score: 62 }], ['unknowns', { code: 'preference-unconfirmed', field: 'comfort' }],
  ['unknowns', { code: 'preference-fact-unknown', field: 'economy', facts: ['mpg'] }],
  ['blockers', { code: 'not-available', availability: { state: 'reserved' } }],
  ['blockers', { code: 'not-yet-available', availableFrom: '2026-12-05T00:00:00.000Z' }],
  ['blockers', { code: 'availability-expired', availableUntil: '2026-11-01T00:00:00.000Z' }],
  ['unknowns', { code: 'availability-unconfirmed' }], ['unknowns', { code: 'availability-date-unconfirmed', field: 'availableFrom' }],
  ['blockers', { code: 'required-by', requiredBy: '2026-12-01T23:59:59.999Z' }], ['reasons', { code: 'required-by-met', requiredBy: '2026-12-01T23:59:59.999Z' }],
  ['unknowns', { code: 'required-by-unconfirmed' }], ['blockers', { code: 'required-by-already-passed' }], ['blockers', { code: 'renewal-already-passed' }],
  ['blockers', { code: 'insurance-grade-limit', maximum: 20, actual: 22 }], ['unknowns', { code: 'insurance-unconfirmed' }],
  ['unknowns', { code: 'licence-unconfirmed' }], ['blockers', { code: 'licence-not-valid-at-collection' }], ['blockers', { code: 'locally-excluded', scope: {} }],
];

test('every server code reads as a plain sentence with no code word, camelCase or unit', () => {
  for (const [kind, entry] of CODES) {
    const text = reasonText(entry, kind);
    assert.match(text, /^[A-Z0-9].*\.$/, `${entry.code}: ${text}`);
    assert.ok(!text.includes(entry.code), `${entry.code} printed: ${text}`);
    assert.doesNotMatch(text, /[a-z][A-Z]|points\/month|[a-z]-[a-z]|\bmonthlyPoints\b/, `${entry.code}: ${text}`);
    assert.ok(!text.includes('—'), `${entry.code} has an em dash`);
  }
});

test('mapped sentences carry the right facts', () => {
  assert.equal(reasonText({ code: 'allowance-exceeded', allowance: 1300, monthlyPoints: 1400 }, 'blockers'), 'Over your allowance by 100 points a month.');
  assert.equal(reasonText({ code: 'allowance-exceeded', allowance: 1300, monthlyPoints: 14000 }, 'blockers'), 'Over your allowance by 12,700 points a month.');
  assert.equal(reasonText({ code: 'allowance-exceeded' }, 'blockers'), 'Over your points allowance.');
  assert.equal(reasonText({ code: 'policy-exclude' }, 'blockers'), 'Not offered under your scheme.');
  assert.equal(reasonText({ code: 'not-available' }, 'blockers'), 'Already reserved or no longer available.');
  assert.equal(reasonText({ code: 'insurance-grade-limit', maximum: 20, actual: 22 }, 'blockers'), 'Insurance group 22 is above your limit of 20.');
  assert.equal(reasonText({ code: 'insurance-grade-limit' }, 'blockers'), 'Insurance group is above your limit.');
  assert.equal(reasonText({ code: 'required-by-met', requiredBy: '2026-12-01T23:59:59.999Z' }, 'reasons'), 'Available by Tuesday 1 December 2026.');
  assert.equal(reasonText({ code: 'essential-met', field: 'body' }, 'reasons'), 'Meets your body style requirement.');
  assert.equal(reasonText({ code: 'essential-unmet', field: 'zeroTo62' }, 'blockers'), 'Does not meet your 0 to 62 mph requirement.');
  assert.equal(reasonText({ code: 'preference-fit', field: 'sportiness', score: 62, desired: 90, observed: 13 }, 'tradeOffs'), 'Less sporty than you prefer.');
});

test('preference-fit reads in words for every preference key, with no percentage', () => {
  const fit = (field, score, desired, observed, facts) => reasonText({ code: 'preference-fit', field, score, desired, observed, facts }, score >= 100 ? 'reasons' : 'tradeOffs');
  const car = { body: { status: 'known', value: 'saloon' }, fuel: { status: 'known', value: 'diesel' } };
  assert.equal(fit('body', 100, 'estate', 100, { body: { value: 'estate' } }), 'Estate, the body style you prefer.');
  assert.equal(fit('body', 0, 'estate', 0, car), 'Saloon, not the estate you prefer.');
  assert.equal(fit('body', 0, 'suv', 0, car), 'Saloon, not the SUV you prefer.');
  assert.equal(fit('body', 0, 'estate', 0, {}), 'Not the estate you prefer.');
  assert.equal(fit('fuel', 100, 'petrol', 100, {}), 'Petrol, the fuel you prefer.');
  assert.equal(fit('fuel', 0, 'ev', 0, car), 'Diesel, not the electric you prefer.');
  const sliders = { sportiness: ['Sportiness', 'Less sporty', 'Sportier'], comfort: ['Comfort', 'Less comfortable', 'More comfortable'],
    economy: ['Economy', 'Less economical', 'More economical'], size: ['Size', 'Smaller', 'Larger'] };
  for (const [key, [name, less, more]] of Object.entries(sliders)) {
    assert.equal(fit(key, 100, 60, 60), `${name} matches your preference.`);
    assert.equal(fit(key, 40, 90, 30), `${less} than you prefer.`);
    assert.equal(fit(key, 40, 20, 70), `${more} than you prefer.`);
    assert.equal(fit(key, 40, 20, undefined), `${name} differs from your preference.`);
  }
  assert.equal(fit('mystery', 30, 10, 40), 'Mystery differs from your preference.');
  for (const field of ['body', 'fuel', 'sportiness', 'comfort', 'economy', 'size', 'mystery']) {
    for (const score of [0, 37, 100]) assert.doesNotMatch(fit(field, score, 'estate', 5, car), /%|\bfit\.|—/, `${field} ${score}`);
  }
});

test('supplied text is kept and unmapped codes never print the code or its fields', () => {
  assert.equal(reasonText({ code: 'x', text: 'Already written.' }, 'reasons'), 'Already written.');
  assert.equal(reasonText({ code: 'x', reason: 'Because.' }, 'blockers'), 'Because.');
  assert.equal(reasonText('Plain string.', 'reasons'), 'Plain string.');
  const odd = { code: 'brand-new-code', someField: 'secret-value', monthlyPoints: 5 };
  assert.equal(reasonText(odd, 'blockers'), 'This car does not meet one of your scheme\'s checks.');
  assert.equal(reasonText(odd, 'unknowns'), 'Something about this car still needs confirming.');
  assert.equal(reasonText(odd, 'reasons'), 'This car meets one of your scheme\'s checks.');
  assert.equal(reasonText(odd, 'tradeOffs'), 'This car differs from one of your preferences.');
  assert.equal(reasonText({ code: 'essential-met', field: 'someOddKey' }, 'reasons'), 'Meets your some odd key requirement.');
  assert.equal(reasonText(null, 'unknowns'), 'Something about this car still needs confirming.');
});

test('longDate formats date-only values and instants, and refuses the rest', () => {
  assert.equal(longDate('2026-11-13'), 'Friday 13 November 2026');
  assert.equal(longDate('2026-11-05T09:00:00.000Z'), 'Thursday 5 November 2026');
  assert.equal(longDate('2026-12-01T23:59:59.999Z'), 'Tuesday 1 December 2026');
  for (const bad of [null, undefined, '', 'soon', '2026-02-30', '13/11/2026', 20261113]) assert.equal(longDate(bad), null, String(bad));
});

test('bodyStyleLabel reuses the shared labels and title-cases the rest', () => {
  assert.equal(bodyStyleLabel('coupe'), 'Coupé');
  assert.equal(bodyStyleLabel('mpv'), 'Family carrier');
  assert.equal(bodyStyleLabel('estate'), 'Estate');
  assert.equal(bodyStyleLabel('gran-coupe'), 'Gran Coupe');
  assert.equal(bodyStyleLabel('sports_activity'), 'Sports Activity');
  assert.equal(bodyStyleLabel(''), null);
  assert.equal(bodyStyleLabel(null), null);
});
