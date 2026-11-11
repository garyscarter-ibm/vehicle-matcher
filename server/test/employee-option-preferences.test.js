import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scorePreferences, validateBriefContent } from '../scenarios/employee/index.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { stock, fact, preference, context, provider, providerValue, time, brief } from './helpers/employee-recommendation.js';

const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
const config = seed.assumptions.find((entry) => entry.key === 'employee.recommendation.v1').value;
const slider = { minimum: 0, maximum: 100 };
const selection = (codes, extra = {}) => fact({ kind: 'selected-catalogue', complete: true, codes, ...extra });
const car = (codes, extra = {}) => stock(1, { optionSelection: selection(codes), ...extra }).snapshot;
const score = (codes, preferences = {}, extra = {}, policy = config) => scorePreferences(car(codes, extra), { preferences }, {}, policy, slider);
const hidden = (result) => result.components.find((entry) => entry.field === 'wellSpecified');
const observed = (result, field) => result.components.find((entry) => entry.field === field)?.observed;

test('more desirable equipment improves the same car through an invisible importance-100 preference', () => {
  const basic = score([], { body: preference('estate') });
  const rich = score(['S0459', 'S04HA', 'S06F4'], { body: preference('estate') });
  assert.ok(rich.score > basic.score, `${rich.score} > ${basic.score}`);
  assert.equal(hidden(rich).importance, 100);
  assert.equal(hidden(rich).hidden, true);
  assert.ok(![...rich.reasons, ...rich.tradeOffs, ...rich.unknowns].some((entry) => entry.field === 'wellSpecified'));
  assert.equal(Object.hasOwn(config.preferences, 'wellSpecified'), false);
  assert.ok(validateBriefContent({ schemaVersion: 1, preferences: { wellSpecified: preference(100) }, essentials: {} }, config, slider).length);
});

test('reviewed normal, premium and unicorn weights are monotonic and bounded', () => {
  const normal = hidden(score(['S0494']));
  const premium = hidden(score(['S04HA']));
  const unicorn = hidden(score(['FVAEW']));
  assert.ok(normal.score < premium.score && premium.score < unicorn.score);
  assert.equal(unicorn.totalWeight, 3);
  assert.equal(hidden(score(['FVATQ', 'FVAEW'])).totalWeight, 3, 'one upholstery capability');
  assert.equal(hidden(score(['S0494', 'S04HA', 'S04HA'])).totalWeight, 2, 'highest heating tier once');
  assert.equal(hidden(score(['S0494', 'S0453'])).totalWeight, 2, 'heating and ventilation are distinct');
  assert.ok(unicorn.score >= 0 && unicorn.score <= 100);
});

test('reviewed evidence changes selected preference fit in both directions at its selected importance', () => {
  const basic = score([], { comfort: preference(100) }, { tags: fact([]) });
  const luxurious = score(['S03KA', 'S0453'], { comfort: preference(100) }, { tags: fact([]) });
  assert.ok(observed(luxurious, 'comfort') > observed(basic, 'comfort'));
  const simple = score(['S03KA', 'S0453'], { comfort: preference(0, 25) }, { tags: fact([]) });
  const simpleBasic = score([], { comfort: preference(0, 25) }, { tags: fact([]) });
  assert.ok(simple.components[0].score < simpleBasic.components[0].score);
  assert.equal(simple.components[0].importance, 25);
  const sporty = score(['PI299', 'S02T4'], { sportiness: preference(100) });
  assert.ok(observed(sporty, 'sportiness') > observed(score([], { sportiness: preference(100) }), 'sportiness'));
  assert.ok(observed(score(['S02VF'], { comfort: preference(100) }), 'comfort') < observed(score([], { comfort: preference(100) }), 'comfort'));
  assert.ok(!score(['S03KA'], { comfort: preference(100, 0) }).components.some((entry) => entry.field === 'comfort'));
});

test('missing 0-62 is neutral, with selected sport equipment adding evidence to that neutral baseline', () => {
  const options = score(['S02T4'], { sportiness: preference(100) }, { zeroTo62: fact(null, 's') });
  assert.ok(observed(options, 'sportiness') > 50);
  assert.ok(options.unknowns.some((entry) => entry.code === 'preference-fact-unknown' && entry.field === 'sportiness'));
  const unknown = score([], { sportiness: preference(100) }, { zeroTo62: fact(null, 's') });
  assert.equal(observed(unknown, 'sportiness'), 50, 'missing performance is a neutral midpoint');
  const noOptions = score([], { sportiness: preference(100) }, { zeroTo62: fact(null, 's'), optionSelection: fact(null) });
  assert.equal(observed(noOptions, 'sportiness'), 50, 'neutral performance does not depend on having option evidence');
  assert.equal(noOptions.components[0].importance, 100, 'keep the selected preference weight');
});

test('packages, their markers and actual contents do not stack hidden or preference benefits', () => {
  const prefs = { sportiness: preference(100) };
  const pack = score(['S033F'], prefs);
  const markers = score(['S033F', 'S05ML', 'S09TA', 'S09T1', 'S09T2'], prefs);
  assert.equal(hidden(markers).totalWeight, hidden(pack).totalWeight);
  assert.equal(observed(markers, 'sportiness'), observed(pack, 'sportiness'));
  const parts = score(['S02T4', 'S02NH'], prefs);
  const both = score(['S033B', 'S09TB', 'S02T4', 'S02NH'], prefs);
  assert.equal(hidden(both).totalWeight, hidden(parts).totalWeight);
  assert.equal(observed(both, 'sportiness'), observed(parts, 'sportiness'));
  assert.equal(hidden(score(['S0610', 'S06U3', 'S07EW'])).totalWeight, hidden(score(['S0610'])).totalWeight);
});

test('availability, unknown equipment and inactive preparations receive no invented benefit', () => {
  const available = score([], {}, { equipment: fact({ available: ['FVAEW', 'S04HA'] }) });
  assert.equal(hidden(available).totalWeight, 0);
  const ignored = score(['S0999', 'S0XYZ', 'S09QV', 'S04U8', 'S06D5']);
  assert.equal(hidden(ignored).totalWeight, 0);
  assert.equal(observed(score(['S04U8'], { economy: preference(100) }), 'economy'), observed(score([], { economy: preference(100) }), 'economy'));
  assert.ok(observed(score(['S04U8'], { economy: preference(100) }, { optionSelection: selection(['S04U8'], { activeCodes: ['S04U8'] }) }), 'economy') > observed(score([], { economy: preference(100) }), 'economy'));
  const unknown = score([], {}, { optionSelection: fact(null) });
  assert.equal(hidden(unknown), undefined);
  const partial = score([], {}, { optionSelection: selection(['S04HA'], { complete: false }) });
  assert.equal(hidden(partial), undefined, 'an incomplete selection is not a complete basic specification');
});

test('fuel evidence cannot override known powertrain or essential requirements', () => {
  const request = { fuel: preference('ev') };
  const basic = score([], request, { fuel: fact('phev') });
  const chargingCard = score(['SE000034'], request, { fuel: fact('phev') });
  assert.ok(observed(chargingCard, 'fuel') > observed(basic, 'fuel'));
  assert.equal(chargingCard.components[0].facts.fuel.value, 'phev');
  assert.ok(chargingCard.components[0].score < 100);
  assert.equal(observed(score(['SE000034'], request), 'fuel'), observed(score([], request), 'fuel'), 'charging-card inference cannot turn petrol into a plug-in');
});

test('policy weights still govern visible preferences, and old policy pins retain their scoring', () => {
  const weighted = structuredClone(config);
  weighted.preferenceWeights = Object.fromEntries(Object.keys(config.preferences).map((key) => [key, 0]));
  assert.equal(score(['S04HA'], { body: preference('estate') }, {}, weighted).score, Math.round(hidden(score(['S04HA'])).score));
  const legacy = structuredClone(config); delete legacy.optionEvidence;
  assert.deepEqual(score(['S04HA'], { body: preference('estate') }, {}, legacy), score([], { body: preference('estate') }, {}, legacy));
  const invalid = structuredClone(config); invalid.optionEvidence.options.S04HA.weight = 11;
  assert.throws(() => score([], {}, {}, invalid), /Invalid.*option/i);
});

test('real recommendation gates retain the points cap and rich equipment cannot bypass essentials', async () => {
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const rich = stock(2, { optionSelection: selection(['FVAEW', 'S04HA', 'S06F4']) });
  const basic = stock(1, { optionSelection: selection([]) });
  const service = createEmployeeRecommendationService({ provider: provider(providerValue([basic, rich])), policy, time });
  const output = await service.recommend(context, brief());
  assert.equal(output.status, 'ok');
  assert.equal(output.value.recommendations[0].orderUuid, rich.orderUuid);
  const bad = stock(3, { seats: fact(4, 'count'), optionSelection: selection(['FVAEW', 'S04HA', 'S06F4']) });
  const gated = await createEmployeeRecommendationService({ provider: provider(providerValue([bad])), policy, time }).recommend(context, brief());
  assert.equal(gated.status, 'ok');
  assert.equal(gated.value.decisions[0].gateStatus, 'ineligible');
  assert.equal(gated.value.decisions[0].score, null);
  assert.deepEqual(output.value.ranking, { rule: 'similarFitThenPoints', fitTolerance: 5 });
  const missingPerformance = stock(4, { zeroTo62: fact(null, 's') });
  const neutral = await createEmployeeRecommendationService({ provider: provider(providerValue([missingPerformance])), policy, time })
    .recommend(context, { ...brief(), preferences: { sportiness: preference(100) } });
  assert.equal(neutral.status, 'ok');
  assert.equal(neutral.value.recommendations[0].gateStatus, 'eligible');
  assert.equal(observed(neutral.value.recommendations[0], 'sportiness'), 50);
  const expensiveSeed = structuredClone(seed);
  const template = expensiveSeed.pricePlans.find((entry) => entry.schemeId === context.schemeId);
  expensiveSeed.pricePlans = expensiveSeed.pricePlans.filter((entry) => entry.schemeId !== context.schemeId);
  expensiveSeed.pricePlans.push({ ...template, key: 'expensive-options', priceEntryId: 'expensive-options',
    matchField: 'configurationId', matchValue: rich.configurationId, monthlyPoints: 999999, value: 999999 });
  const overBudget = await createEmployeeRecommendationService({ provider: provider(providerValue([rich])),
    policy: new PolicyService({ provider: { async loadVersions() { return [expensiveSeed]; } } }), time }).recommend(context, brief());
  assert.equal(overBudget.status, 'ok');
  assert.equal(overBudget.value.recommendations.length, 0);
  assert.ok(overBudget.value.decisions[0].blockers.some((entry) => entry.code === 'allowance-exceeded'));
});
