import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultView, findDecision, selectedDecision, selectMember, availability } from '../recommendation/index.js';
import { USED_RETAIL_V1 } from '../scenarios/retail/index.js';
import { evaluateEssentials } from '../scenarios/employee/index.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { CARS } from '../data.js';
import { rankCars, groupListings, LISTING_SAMPLE } from '../engine.js';
import { fact, essential, brief, stock, providerValue, provider, time, policy, context } from './helpers/employee-recommendation.js';

// Synthetic exact decisions: each has its own score, reasons and price.
const make = (n, extra = {}) => ({ candidateKey: `car-${n}`, family: 'touring', score: 100 - n,
  reasons: [`reason-${n}`], price: 30000 + n, ...extra });
const cars = (count, extra = () => ({})) => Array.from({ length: count }, (_, i) => make(i + 1, extra(i + 1)));
const flat = { groupOf: (d) => d.family };

test('exact member selection returns that member own decision, never the representative', () => {
  const decisions = cars(3);
  const view = buildResultView(decisions, flat);
  const [group] = view.groups;
  assert.equal(group.representativeKey, 'car-1');
  assert.equal(group.selectedKey, 'car-1');
  const picked = selectMember(view, group.key, 'car-3');
  assert.equal(picked.groups[0].selectedKey, 'car-3');
  const own = selectedDecision(picked, group.key);
  assert.equal(own, decisions[2], 'the same decision reference, not a copy');
  assert.deepEqual([own.score, own.reasons, own.price], [97, ['reason-3'], 30003]);
  assert.equal(view.groups[0].selectedKey, 'car-1', 'the original view is not mutated');
  assert.equal(findDecision(view, 'car-2'), decisions[1]);
});

test('a foreign member key or unknown group leaves the view unchanged', () => {
  const decisions = [make(1), make(2, { family: 'saloon' })];
  const view = buildResultView(decisions, flat);
  assert.deepEqual(view.groups.map((g) => g.key), ['touring', 'saloon']);
  assert.equal(selectMember(view, 'touring', 'car-2'), view);
  assert.equal(selectMember(view, 'nope', 'car-1'), view);
  assert.equal(selectMember(view, 'touring', 'missing'), view);
});

test('groups report every member while members respect the sample, and flag truncation', () => {
  const decisions = cars(7);
  const view = buildResultView(decisions, { ...flat, sample: 3 });
  const [group] = view.groups;
  assert.equal(view.candidateCount, 7);
  assert.deepEqual(group.memberKeys, decisions.map((d) => d.candidateKey));
  assert.equal(group.members.length, 3);
  assert.ok(group.members.every((m, i) => m === decisions[i]), 'members are references in decision order');
  assert.deepEqual(group.count, { total: 7, sampled: 3, complete: false });
  assert.equal(findDecision(view, 'car-7'), decisions[6], 'an unsampled member is still discoverable');
  assert.equal(selectMember(view, 'touring', 'car-7').groups[0].selectedKey, 'car-7');
  const whole = buildResultView(decisions, flat).groups[0];
  assert.deepEqual(whole.count, { total: 7, sampled: 7, complete: true });
});

test('group order is first appearance, null group is its own group, and nothing is reordered', () => {
  const decisions = [make(1, { family: 'b' }), make(2, { family: 'a' }), make(3, { family: null }),
    make(4, { family: 'b' }), make(5, { family: undefined })];
  const view = buildResultView(decisions, flat);
  assert.deepEqual(view.groups.map((g) => g.memberKeys), [['car-1', 'car-4'], ['car-2'], ['car-3'], ['car-5']]);
  assert.deepEqual(view.decisions, decisions);
  assert.equal(view.decisions[0], decisions[0]);
  assert.equal(view.source.status, 'unknown', 'never assumes the source is complete');
});

test('duplicate member keys and malformed policies throw', () => {
  assert.throws(() => buildResultView([make(1), make(1)], flat), /duplicate member key: car-1/);
  assert.throws(() => buildResultView([make(1)], { ...flat, sample: 0 }), TypeError);
  assert.throws(() => buildResultView([make(1)], { keyOf: () => '' }), TypeError);
  assert.throws(() => buildResultView('nope', flat), TypeError);
  assert.throws(() => findDecision({ decisions: [] }, 'x'), TypeError);
});

const equipment = (n, towbar) => ({ candidateKey: `eq-${n}`, snapshot: stock(n, { equipment: fact({ towbar }) }).snapshot });
const union = (members) => ({ equipment: [...new Set(members.flatMap((m) => Object.entries(m.snapshot.facts.equipment.value)
  .filter(([, on]) => on).map(([key]) => key)))] });

test('group equipment union is labelled aggregate availability and never feeds exact essentials', () => {
  const decisions = [equipment(1, false), equipment(2, true)];
  const before = structuredClone(decisions);
  const view = buildResultView(decisions, { groupOf: () => 'g', summarise: union });
  const [group] = view.groups;
  assert.deepEqual(group.aggregate, { scope: 'group-availability', equipment: ['towbar'] });
  assert.deepEqual(decisions, before, 'the aggregate is not written onto any member decision');
  assert.ok(decisions.every((d) => !('aggregate' in d) && !('equipment' in d)));
  const config = { confirmedAssurances: ['synthetic-scenario'] };
  const need = { essentials: { equipment: essential(['towbar'], 'includes', 'equipment-key') } };
  const lacking = evaluateEssentials(findDecision(view, 'eq-1').snapshot, need, config);
  const having = evaluateEssentials(findDecision(view, 'eq-2').snapshot, need, config);
  assert.deepEqual(lacking.blockers.map((b) => b.code), ['essential-unmet'], 'the member without a towbar fails despite the union');
  assert.deepEqual(having.reasons.map((r) => r.code), ['essential-met']);
});

test('a viable thirteenth candidate gated over the complete set stays discoverable behind a small shortlist', async () => {
  const stockRows = Array.from({ length: 13 }, (_, i) => stock(i + 1,
    i === 12 ? { equipment: fact({ towbar: true }) } : {}));
  const result = await createEmployeeRecommendationService({ policy: policy(), time,
    provider: provider(providerValue(stockRows)) }).recommend(context, brief());
  assert.equal(result.status, 'ok');
  const { decisions, recommendations, eligibleCount } = result.value;
  assert.equal(decisions.length, 13);
  assert.equal(eligibleCount, 13);
  assert.equal(recommendations.length, 3, 'the service displayLimit is 3');
  const thirteenth = decisions.find((d) => d.orderUuid.endsWith('000000000013'));
  assert.equal(thirteenth.gateStatus, 'eligible');
  assert.ok(!recommendations.includes(thirteenth));
  // Gate first over the complete set, then project: the view takes every eligible decision.
  const eligible = decisions.filter((d) => d.gateStatus === 'eligible');
  const view = buildResultView(eligible, { keyOf: (d) => d.candidateKey, groupOf: () => 'touring', sample: 12 },
    { source: { status: 'complete' } });
  const [group] = view.groups;
  assert.equal(group.count.total, 13);
  assert.equal(group.members.length, 12);
  assert.ok(!group.members.includes(thirteenth), 'absent from the displayed members');
  assert.equal(findDecision(view, thirteenth.candidateKey), thirteenth);
  const hasTowbar = (d) => d.snapshot.facts.equipment?.value?.towbar === true;
  assert.ok(!group.members.some(hasTowbar));
  assert.equal(availability(view, hasTowbar), 'available');
  assert.equal(availability(view, (d) => d.snapshot.facts.equipment?.value?.tow === true), 'unavailable');
});

test('availability is unavailable only for a complete source; partial and unknown stay unknown', () => {
  const decisions = [make(1), make(2, { roofRack: true })];
  const absent = (d) => d.heatedSeats === true;
  const present = (d) => d.roofRack === true;
  const views = Object.fromEntries(['complete', 'partial', 'unknown', undefined].map((status) =>
    [String(status), buildResultView(decisions, flat, status ? { source: { status } } : {})]));
  assert.equal(availability(views.complete, absent), 'unavailable');
  assert.equal(availability(views.partial, absent), 'unknown');
  assert.equal(availability(views.unknown, absent), 'unknown');
  assert.equal(availability(views.undefined, absent), 'unknown');
  assert.equal(views.undefined.source.status, 'unknown');
  const shown = buildResultView(decisions, { ...flat, sample: 1 }, { source: { status: 'partial' } });
  assert.ok(!shown.groups[0].members.some(present), 'not among the displayed members');
  assert.equal(availability(shown, present), 'available', 'present in the full set, so available');
  assert.equal(availability(buildResultView([], flat, { source: { status: 'partial' } }), present), 'unknown');
});

// ---- retail adapter ----
const answers = { budget: [25000, 40000], bodyStyles: ['estate'], fuel: ['petrol'],
  charging: 'none', primaryUse: 'roadtrips', people: 'solo', mileage: 12000, style: '1', priorities: ['comfort', 'economy'] };
const base = { ...CARS[0], id: 'p-0', name: 'BMW Probe Touring', line: 'Probe', body: 'estate', fuel: 'petrol',
  priceMin: 30000, priceMax: 30000, seats: 5, boot: 560, zeroTo62: 7, sizeClass: 3, mpg: 48,
  tags: ['cruiser', 'efficient', 'practical'], transmission: 'auto', features: ['heatedSeats'],
  colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' }, photo: '/b.jpg', link: '/b', mileage: 10000 };
const pool = (count, tweak = () => ({})) => Array.from({ length: count }, (_, i) => ({ ...structuredClone(base),
  id: `p-${i}`, priceMin: 30000 + i * 100, priceMax: 30000 + i * 100, ...tweak(i) }));

// The pre-FUCQ-28 implementation, kept here as an independent expectation.
function legacyGroup(ranked) {
  const key = (c) => [c.line, c.body, c.fuel, c.zeroTo62, c.styleLine ?? ''].join('|');
  const groups = new Map();
  for (const match of ranked) {
    const k = key(match.car);
    if (!groups.has(k)) groups.set(k, { match, listings: [] });
    const { score, fit, taste, stretch, reasons, tradeOffs } = match;
    groups.get(k).listings.push({ ...match.car, decision: { score, fit, taste, stretch, reasons, tradeOffs } });
  }
  return [...groups.values()].map(({ match, listings }) => {
    const prices = listings.map((c) => c.priceMin).filter(Number.isFinite);
    const colours = [...new Set(listings.map((c) => c.colour?.manufacturerColour || c.colour?.colour).filter(Boolean))];
    return { ...match, car: { ...match.car,
      name: listings.reduce((a, b) => (b.name.length < a.length ? b.name : a), match.car.name),
      listingCount: listings.length, priceFrom: prices.length ? Math.min(...prices) : match.car.priceMin,
      priceTo: prices.length ? Math.max(...prices) : match.car.priceMin, colours,
      features: [...new Set(listings.flatMap((c) => c.features || []))] },
    listings: listings.slice(0, LISTING_SAMPLE) };
  });
}

test('retail: a 30-listing group keeps the full count and union while carrying a 24-listing sample', () => {
  const ranked = rankCars(answers, pool(30, (i) => (i === 29 ? { features: ['towbar'], priceMin: 31000, priceMax: 31000,
    colour: { colour: 'Red', manufacturerColour: 'Chili Red' }, name: 'Probe', mpg: 20, boot: 300 } : {})));
  assert.equal(ranked.length, 30);
  assert.equal(ranked[29].car.id, 'p-29', 'the lowest-scoring listing sits beyond the sample');
  const groups = groupListings(ranked);
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group.car.listingCount, 30);
  assert.equal(group.listings.length, 24);
  assert.ok(!group.listings.some((l) => l.features.includes('towbar')), 'the towbar car is beyond the sample');
  assert.deepEqual(group.car.features, ['heatedSeats', 'towbar']);
  assert.equal(group.car.name, 'Probe');
  assert.deepEqual(group.car.colours, ['Portimao Blue', 'Chili Red']);
  assert.equal(group.car.priceFrom, Math.min(...ranked.map((m) => m.car.priceMin)));
  assert.equal(group.car.priceTo, Math.max(...ranked.map((m) => m.car.priceMin)));
  group.listings.forEach((listing, i) => {
    const { score, fit, taste, stretch, reasons, tradeOffs } = ranked[i];
    assert.deepEqual(listing.decision, { score, fit, taste, stretch, reasons, tradeOffs });
    assert.equal(listing.id, ranked[i].car.id);
  });
  assert.equal(JSON.stringify(groups), JSON.stringify(legacyGroup(ranked)), 'values and key order match the legacy shape');
});

test('retail: mixed models and a repeated feed id keep the legacy output without merging cars', () => {
  const mixed = pool(6, (i) => (i % 2 ? { line: 'Other', zeroTo62: 6 } : { id: i === 4 ? 'p-0' : `p-${i}` }));
  const ranked = rankCars(answers, mixed);
  const groups = groupListings(ranked);
  assert.equal(groups.length, 2);
  assert.equal(groups.reduce((n, g) => n + g.car.listingCount, 0), ranked.length);
  assert.equal(JSON.stringify(groups), JSON.stringify(legacyGroup(ranked)));
  assert.equal(JSON.stringify(groupListings([])), '[]');
});

test('retail presentation policy builds a view whose selected member is exact', () => {
  const ranked = rankCars(answers, pool(3, (i) => ({ mpg: 48 - i * 12, priceMin: 30000 + i * 3000, priceMax: 30000 + i * 3000 })));
  const view = buildResultView(ranked, { ...USED_RETAIL_V1.presentation, keyOf: (m) => m.car.id }, { source: { status: 'complete' } });
  const [group] = view.groups;
  assert.equal(group.aggregate.scope, 'group-availability');
  assert.equal(group.aggregate.listingCount, 3);
  const picked = selectedDecision(selectMember(view, group.key, 'p-2'), group.key);
  assert.equal(picked, ranked.find((m) => m.car.id === 'p-2'));
  assert.notEqual(picked.score, ranked[0].score);
  assert.ok(Object.isFrozen(USED_RETAIL_V1.presentation));
});
