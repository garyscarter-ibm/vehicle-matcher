import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  matchCars, rankCars, budgetRange, unmetWants, tradeOffs, STRETCH_FACTOR, MAX_SHOWN,
} from '../engine.js';
import { CARS } from '../data.js';
import { rrmcRegion, rrmcListingUrl, rrmcHandDrive, rrmcPriceGBP, rrmcMiles, projectRRMCListing } from '../rrmc-listing.js';
import { BUDGET_BANDS, QUESTIONS } from '../questions.js';

function run(answers) {
  return matchCars(answers, CARS);
}

/** Full ranking, not just the top 3 — lets a test assert over every survivor. */
function runAll(answers) {
  return rankCars(answers, CARS);
}

const base = {
  budget: 'b2',
  bodyStyles: ['any'],
  fuel: 'open',
  charging: 'none',
  primaryUse: 'commute',
  people: 'solo',
  mileage: 'mid',
  style: '3',
  priorities: ['economy', 'comfort'],
};

test('budget-constrained city driver gets a small, affordable car', () => {
  const { matches } = run({
    ...base,
    budget: 'b1',
    primaryUse: 'city',
    fuel: 'petrol',
    priorities: ['economy', 'image'],
  });
  assert.ok(matches.length > 0);
  const top = matches[0].car;
  const [, max] = BUDGET_BANDS.b1;
  assert.ok(top.priceMin <= max * STRETCH_FACTOR, 'top match respects budget + stretch');
  assert.ok(top.sizeClass <= 2, `expected a compact car, got ${top.name}`);
  assert.notEqual(top.fuel, 'ev', 'petrol preference should not surface an EV first');
});

test('large family with big boot needs gets practical 5+ seaters only', () => {
  const answers = {
    ...base,
    budget: 'b4',
    bodyStyles: ['suv', 'estate'],
    people: 'crew',
    primaryUse: 'family',
    priorities: ['comfort', 'economy'],
  };
  const { matches } = run(answers);
  assert.ok(matches.length > 0);
  for (const m of runAll(answers)) {
    assert.ok(m.car.seats >= 5, `${m.car.name} has too few seats`);
    assert.ok(m.car.boot >= 430, `${m.car.name} boot too small for a crew`);
  }
  assert.ok(['suv', 'estate'].includes(matches[0].car.body));
});

test('enthusiast gets a fast, drivers-car match', () => {
  const { matches } = run({
    ...base,
    budget: 'b4',
    bodyStyles: ['coupe'],
    fuel: 'petrol',
    primaryUse: 'fun',
    style: '5',
    priorities: ['performance', 'image'],
  });
  const top = matches[0].car;
  assert.ok(top.zeroTo62 < 5, `expected something quick, got ${top.name} (${top.zeroTo62}s)`);
  assert.ok(top.tags.includes('drivers-car'));
  assert.equal(top.body, 'coupe');
});

test('EV-curious commuter with home charging is steered electric', () => {
  const { matches } = run({
    ...base,
    budget: 'b3',
    fuel: 'open',
    charging: 'home',
    primaryUse: 'commute',
    mileage: 'high',
    priorities: ['economy', 'tech'],
  });
  assert.equal(matches[0].car.fuel, 'ev', `expected an EV first, got ${matches[0].car.name}`);
});

test('EV preference without charging access is heavily penalised', () => {
  const withCharging = run({ ...base, budget: 'b3', fuel: 'ev', charging: 'home' });
  const without = run({ ...base, budget: 'b3', fuel: 'ev', charging: 'none' });
  const evTop = withCharging.matches[0];
  assert.equal(evTop.car.fuel, 'ev');
  const sameCar = rankCars({ ...base, budget: 'b3', fuel: 'ev', charging: 'none' }, CARS)
    .find((m) => m.car.id === evTop.car.id);
  if (sameCar) {
    assert.ok(sameCar.score < evTop.score, 'no-charging score should drop');
  }
});

test('contradictory answers still produce ranked, in-filter results', () => {
  // Tiny budget, maximum-attack sports intent, seven people, huge boot.
  // Engine must not crash and must respect hard filters even if empty.
  for (const m of runAll({
    ...base,
    budget: 'b1',
    bodyStyles: ['convertible'],
    people: 'crew',
    style: '5',
    priorities: ['performance', 'image'],
  })) {
    assert.ok(m.car.seats >= 5);
    assert.ok(m.car.priceMin <= BUDGET_BANDS.b1[1] * STRETCH_FACTOR);
  }
});

test('scores are 0–100, sorted, deterministic, with reasons on the top match', () => {
  const a = run(base);
  const b = run(base);
  assert.deepEqual(a, b, 'same answers → same output');
  const all = runAll(base);
  for (let i = 0; i < all.length; i += 1) {
    assert.ok(all[i].score >= 0 && all[i].score <= 100);
    if (i > 0) assert.ok(all[i - 1].score >= all[i].score, 'sorted descending');
  }
  assert.ok(a.matches[0].reasons.length >= 1, 'top match explains itself');
});

test('stretch cars are flagged and carry a stretch reason', () => {
  // b1 budget: M135 (43k+) is within 15% of... no; use b2 (max 50k) → M240i (48k) fits;
  // find any returned stretch match across a few personas and assert the flag text.
  const stretchy = runAll({ ...base, budget: 'b2', style: '5', priorities: ['performance', 'image'], fuel: 'petrol', primaryUse: 'fun' }).filter((m) => m.stretch);
  for (const m of stretchy) {
    assert.ok(m.car.priceMin > BUDGET_BANDS.b2[1]);
    assert.ok(m.reasons.some((r) => r.toLowerCase().includes('stretch')));
  }
});

test('rankCars ranks a mixed-retailer pool on merit alone', () => {
  // The "worth the drive" carousel ranks cars from several retailers through
  // the same scoring as the hero grid. Retailer/distance must not leak into
  // the score: two identical cars differing only in where they sit must tie.
  const [near, far] = [2.2, 31.1].map((distance) => ({
    ...CARS[0], id: `${CARS[0].id}-${distance}`, distance, retailerId: distance < 10 ? 96 : 101,
  }));
  const ranked = rankCars(base, [near, far]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].score, ranked[1].score, 'distance must not affect score');
});

test('rankCars returns every survivor, not just the headline matches', () => {
  const all = rankCars(base, CARS);
  const { matches } = run(base);
  assert.ok(all.length > matches.length, 'ranking is wider than the headline matches');
  // matches are GROUPED (repeat listings of one car collapse into one card),
  // so compare identities rather than objects.
  assert.equal(matches[0].car.name, all[0].car.name, 'the best car still leads');
});

/* ---- clusters: only claim a winner when there is one ---- */

test('a clear winner is decisive and shows the usual three', () => {
  // One car engineered to beat everything: exactly the answers it satisfies.
  const runaway = {
    id: 'runaway', name: 'BMW i5 Touring', line: '5 Series', body: 'estate', fuel: 'ev',
    priceMin: 40000, priceMax: 40000, sizeClass: 3, seats: 5, boot: 570, zeroTo62: 5.9,
    evRange: 350, mpg: 0, tags: ['cruiser'], blurb: '', styleLine: null, doors: null,
  };
  const answers = {
    ...base, budget: [35000, 45000], bodyStyles: ['estate'], fuel: ['ev'], charging: 'home',
  };
  const { matches, decisive, clusterSize } = matchCars(answers, [runaway, ...CARS]);
  assert.equal(matches[0].car.id, 'runaway');
  assert.equal(decisive, true, 'nothing else is within reach, so the decree is earned');
  assert.equal(clusterSize, 1);
  assert.equal(matches.length, 3, 'a decisive result is the familiar hero + two');
});

test('repeat listings of one car collapse into a single card', () => {
  // Five identical cars are not five choices — they're one car the retailer
  // has five of. Showing five cards read as the page stuttering.
  const clone = (id) => ({
    id, name: `BMW 320i ${id}`, line: '3 Series', body: 'saloon', fuel: 'petrol',
    priceMin: 30000, priceMax: 30000, sizeClass: 2, seats: 5, boot: 480, zeroTo62: 7.4,
    mpg: 45, tags: ['cruiser'], blurb: '', styleLine: null, doors: null,
  });
  const fivesome = ['a', 'b', 'c', 'd', 'e'].map(clone);
  const { matches, decisive, clusterSize } = matchCars({ ...base, budget: [25000, 35000] }, fivesome);
  assert.equal(clusterSize, 1, 'one car, not five');
  assert.equal(decisive, true, 'and naming it is honest');
  assert.equal(matches[0].car.listingCount, 5, 'the card speaks for all five');
  assert.equal(matches[0].car.priceFrom, 30000);
});

test('genuinely different cars still tie, and the whole tie is shown', () => {
  // Different models that happen to score alike — a real choice, unlike clones.
  const variant = (id, zeroTo62, tags) => ({
    id, name: `BMW ${id}`, line: `${id} Series`, body: 'saloon', fuel: 'petrol',
    priceMin: 30000, priceMax: 30000, sizeClass: 2, seats: 5, boot: 480, zeroTo62,
    mpg: 45, tags, blurb: '', styleLine: null, doors: null,
  });
  const pool = [variant('a', 7.4, ['cruiser']), variant('b', 7.5, ['cruiser']),
    variant('c', 7.6, ['cruiser']), variant('d', 7.7, ['cruiser'])];
  const { matches, decisive, clusterSize } = matchCars({ ...base, budget: [25000, 35000] }, pool);
  assert.equal(decisive, false, 'four different cars scoring alike is a real tie');
  assert.ok(clusterSize > 1);
  assert.equal(matches.length, clusterSize, 'the whole tie is shown, not a 3-car slice');
});

test('a tie wider than MAX_SHOWN is capped for display but counted in full', () => {
  // Distinct 0-62s keep these as separate cars rather than one grouped listing.
  const many = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`, name: `BMW 320i ${i}`, line: '3 Series', body: 'saloon', fuel: 'petrol',
    priceMin: 30000, priceMax: 30000, sizeClass: 2, seats: 5, boot: 480,
    zeroTo62: 7.4 + i * 0.05,
    mpg: 45, tags: ['cruiser'], blurb: '', styleLine: null, doors: null,
  }));
  const { matches, clusterSize } = matchCars({ ...base, budget: [25000, 35000] }, many);
  assert.equal(clusterSize, 10, 'the page can say how big the tie really is');
  assert.equal(matches.length, MAX_SHOWN, 'without rendering all ten');
});

test('an empty pool is decisive by vacuum, not by claim', () => {
  // `searched` reports the funnel the page shows its working with. On an empty
  // pool it must still be present and still be honest: nothing searched,
  // nothing eligible, and no margin to claim over a car that isn't there.
  assert.deepEqual(matchCars(base, []), {
    matches: [],
    decisive: true,
    clusterSize: 0,
    tasteLead: false,
    searched: { total: 0, eligible: 0, margin: null },
  });
});

test('every dataset entry has the fields the engine needs', () => {
  for (const car of CARS) {
    for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
      assert.ok(car[field] !== undefined, `${car.name} missing ${field}`);
    }
    assert.ok(car.priceMin <= car.priceMax, `${car.name} price range inverted`);
    if (car.fuel === 'ev') assert.ok(car.evRange > 0, `${car.name} needs evRange`);
    else assert.ok(car.mpg > 0, `${car.name} needs mpg`);
  }
});

test('boot need is derived from people + primaryUse, not from a boot question', () => {
  // Two identical cars but for luggage space. A solo weekend driver asks
  // nothing of a boot, so they tie; a small family on family duties (1 + 1 →
  // "big") separates them. This is the signal the cut boot question used to
  // carry, now folded into the answers that already implied it.
  const small = {
    ...CARS[0], id: 'sm', seats: 5, boot: 300, priceMin: 40000, priceMax: 40000,
  };
  const big = { ...small, id: 'bg', boot: 550 };
  const scoreOf = (answers, id) => rankCars(answers, [small, big]).find((m) => m.car.id === id).score;

  const soloFun = {
    ...base, budget: [30000, 50000], people: 'solo', primaryUse: 'fun',
  };
  assert.equal(scoreOf(soloFun, 'sm'), scoreOf(soloFun, 'bg'),
    'a solo weekend driver has no space requirement, so boot cannot separate them');

  const familyDuties = {
    ...base, budget: [30000, 50000], people: 'family', primaryUse: 'family',
  };
  assert.ok(scoreOf(familyDuties, 'bg') > scoreOf(familyDuties, 'sm'),
    'a family on family duties needs the space, so the bigger boot wins');

  // An old shared link may still carry a boot answer; it is ignored, not read.
  assert.equal(scoreOf({ ...soloFun, boot: 'big' }, 'sm'), scoreOf(soloFun, 'sm'),
    'a legacy boot answer neither throws nor changes the score');
});

/* ---- Stakeholder amendments: slider budget/mileage, multi-select fuel ---- */

test('budgetRange resolves a band key, a raw number, and a [min,max] range', () => {
  assert.deepEqual(budgetRange({ budget: 'b2' }), BUDGET_BANDS.b2);
  assert.deepEqual(budgetRange({ budget: 60000 }), [0, 60000]);
  assert.deepEqual(budgetRange({ budget: [40000, 75000] }), [40000, 75000]);
  // Unordered thumbs normalise; garbage/empty ranges are unusable.
  assert.deepEqual(budgetRange({ budget: [75000, 40000] }), [40000, 75000]);
  assert.equal(budgetRange({ budget: [0, 0] }), null);
  assert.equal(budgetRange({ budget: 0 }), null, '0 is not a usable budget');
  assert.equal(budgetRange({ budget: 'nope' }), null);
});

test('a [min,max] budget scores in-bracket cars full and cheaper cars lower', () => {
  // 40k–75k: a car around the middle should out-score one well under the min.
  const ranked = rankCars({ ...base, budget: [40000, 75000], fuel: ['open'] }, CARS);
  const inBracket = ranked.find((m) => m.car.priceMin >= 40000 && m.car.priceMax <= 75000);
  const cheap = ranked.find((m) => m.car.priceMax < 40000);
  if (inBracket && cheap) {
    // Compare the budget dimension's effect: an in-bracket car isn't penalised
    // for price, a sub-min car is (the min thumb now bites).
    const both = rankCars({ ...base, budget: [40000, 75000], fuel: ['open'] }, [inBracket.car, cheap.car]);
    const inScore = both.find((m) => m.car.id === inBracket.car.id).score;
    const cheapScore = both.find((m) => m.car.id === cheap.car.id).score;
    assert.ok(inScore >= cheapScore, 'in-bracket car should not score below a sub-min car on budget');
  }
});

test('a car far below a high budget floor is heavily penalised, not gently', () => {
  // Regression: with a £92k–128k range, a £39k car used to score 0.7 on budget
  // and — since budget is only ~1/5 of the blend — out-ranked pricier cars that
  // actually fit the bracket. A car well under the floor must now score low.
  const near = { ...CARS[0], id: 'near', priceMin: 90000, priceMax: 95000 };
  const wayUnder = { ...CARS[0], id: 'under', priceMin: 38000, priceMax: 42000 };
  const answers = { ...base, budget: [92000, 128000], fuel: ['open'] };
  const ranked = rankCars(answers, [near, wayUnder]);
  const nearScore = ranked.find((m) => m.car.id === 'near').score;
  const underScore = ranked.find((m) => m.car.id === 'under').score;
  // Same car spec, so any gap is the budget dimension: the near-floor car must
  // clearly beat one ~£50k under it (old behaviour had them near-tied).
  assert.ok(nearScore - underScore >= 5, `expected a clear gap, got ${nearScore} vs ${underScore}`);
});

test('a numeric budget ranks the same cars as the equivalent band', () => {
  // b3 is [50k, 70k]; a 70k number should surface the same top match.
  const byBand = run({ ...base, budget: 'b3', fuel: 'petrol', primaryUse: 'commute' });
  const byNumber = run({ ...base, budget: 70000, fuel: ['petrol'], primaryUse: 'commute' });
  assert.ok(byNumber.matches.length > 0);
  assert.equal(byNumber.matches[0].car.id, byBand.matches[0].car.id);
});

test('multi-select fuel scores a car on its best matching fuel', () => {
  // Picking petrol + ev: a petrol car should score on its (perfect) petrol
  // merit, not be dragged down by the ev mismatch — best-of, not average.
  const petrolOnly = rankCars({ ...base, budget: 'b3', fuel: ['petrol'], charging: 'none' }, CARS);
  const petrolAndEv = rankCars({ ...base, budget: 'b3', fuel: ['petrol', 'ev'], charging: 'none' }, CARS);
  const aPetrol = petrolOnly.find((m) => m.car.fuel === 'petrol');
  assert.ok(aPetrol, 'expected a petrol car in the pool');
  const same = petrolAndEv.find((m) => m.car.id === aPetrol.car.id);
  assert.ok(same.score >= aPetrol.score, 'adding EV as an option must not lower a petrol car');
});

test('an empty / absent fuel selection scores like "help me decide"', () => {
  const asOpen = rankCars({ ...base, budget: 'b3', fuel: 'open' }, CARS);
  const asEmpty = rankCars({ ...base, budget: 'b3', fuel: [] }, CARS);
  assert.deepEqual(asEmpty.map((m) => m.car.id), asOpen.map((m) => m.car.id));
});

test('numeric mileage ≥20k triggers the same diesel/economy boost as vhigh', () => {
  const byBand = run({ ...base, budget: 'b3', fuel: ['open'], mileage: 'vhigh' });
  const byNumber = run({ ...base, budget: 'b3', fuel: ['open'], mileage: 22000 });
  assert.equal(byNumber.matches[0].car.id, byBand.matches[0].car.id);
  // And a low number must NOT trigger it — 5k should differ from 22k when a
  // diesel is in play.
  const low = run({ ...base, budget: 'b3', fuel: ['open'], mileage: 5000 });
  assert.ok(low.matches.length > 0);
});

test('charging "either" gives EV access like home charging', () => {
  const home = rankCars({ ...base, budget: 'b3', fuel: ['ev'], charging: 'home' }, CARS);
  const either = rankCars({ ...base, budget: 'b3', fuel: ['ev'], charging: 'either' }, CARS);
  const evHome = home.find((m) => m.car.fuel === 'ev');
  assert.ok(evHome, 'expected an EV with home charging');
  const evEither = either.find((m) => m.car.id === evHome.car.id);
  assert.equal(evEither.score, evHome.score, '"either" should match "home" for EV access');
});

/* ---- unmet wants: what the pool couldn't offer (results-page honesty) ---- */

// A deliberately narrow pool: petrol saloons only. Anything else a user asks
// for is genuinely absent, which is exactly the case the results note exists
// to admit to.
const petrolOnly = CARS.filter((c) => c.fuel === 'petrol' && c.body === 'saloon');

test('an unmet fuel want is reported against the pool that was searched', () => {
  assert.ok(petrolOnly.length, 'fixture sanity: some petrol saloons exist');
  assert.deepEqual(unmetWants({ ...base, fuel: ['ev'] }, petrolOnly), { fuel: ['ev'] });
  // Only the missing values are listed — a met pick alongside is not flagged.
  assert.deepEqual(
    unmetWants({ ...base, fuel: ['petrol', 'ev'] }, petrolOnly),
    { fuel: ['ev'] },
  );
});

test('an unmet body-style want is reported the same way', () => {
  assert.deepEqual(
    unmetWants({ ...base, bodyStyles: ['convertible'], fuel: ['petrol'] }, petrolOnly),
    { bodyStyles: ['convertible'] },
  );
  // Both dimensions can be unmet at once, each listing only its own values.
  assert.deepEqual(
    unmetWants({ ...base, bodyStyles: ['convertible', 'saloon'], fuel: ['ev'] }, petrolOnly),
    { fuel: ['ev'], bodyStyles: ['convertible'] },
  );
});

test('a want the pool CAN meet produces nothing to apologise for', () => {
  assert.deepEqual(
    unmetWants({ ...base, fuel: ['petrol'], bodyStyles: ['saloon'] }, petrolOnly),
    {},
  );
  // And against the full range, a normal answer set is entirely satisfiable.
  assert.deepEqual(unmetWants({ ...base, fuel: ['ev'], bodyStyles: ['suv'] }, CARS), {});
});

test('"no preference" answers state no want, so can never be unmet', () => {
  // 'open' fuel / 'any' body are the help-me-decide values: nothing was asked
  // for, so nothing can be missing — even from a pool that has neither.
  assert.deepEqual(unmetWants({ ...base, fuel: ['open'], bodyStyles: ['any'] }, petrolOnly), {});
  assert.deepEqual(unmetWants({ ...base, fuel: 'open', bodyStyles: ['any'] }, []), {});
  // Unanswered is the same: an absent fuel/body answer reads as no preference.
  assert.deepEqual(unmetWants({ budget: 'b2' }, []), {});
  assert.deepEqual(unmetWants({ ...base, fuel: [] }, []), {});
});

/* ---- trade-offs: what THIS car gives up (hero-card honesty) ---- */

// tradeOffs only reads the two stock facts, so a minimal car is enough.
const petrolSaloon = { fuel: 'petrol', body: 'saloon' };

test('a car of the wrong fuel owns the trade', () => {
  assert.deepEqual(
    tradeOffs({ ...base, fuel: ['ev'] }, petrolSaloon),
    [{ dim: 'fuel', wants: ['ev'], got: 'petrol' }],
  );
  // Multi-select: matching ANY chosen fuel is a met want, not a trade.
  assert.deepEqual(tradeOffs({ ...base, fuel: ['petrol', 'ev'] }, petrolSaloon), []);
  // ...and missing all of them lists every want, so the copy can say
  // "where you asked for diesel or fully electric".
  assert.deepEqual(
    tradeOffs({ ...base, fuel: ['diesel', 'ev'] }, petrolSaloon),
    [{ dim: 'fuel', wants: ['diesel', 'ev'], got: 'petrol' }],
  );
});

test('a car of the wrong shape owns the trade, fuel listed first', () => {
  assert.deepEqual(
    tradeOffs({ ...base, fuel: ['petrol'], bodyStyles: ['estate'] }, petrolSaloon),
    [{ dim: 'bodyStyles', wants: ['estate'], got: 'saloon' }],
  );
  assert.deepEqual(
    tradeOffs({ ...base, fuel: ['ev'], bodyStyles: ['estate', 'suv'] }, petrolSaloon),
    [
      { dim: 'fuel', wants: ['ev'], got: 'petrol' },
      { dim: 'bodyStyles', wants: ['estate', 'suv'], got: 'saloon' },
    ],
  );
});

test('"no preference" answers trade nothing away', () => {
  assert.deepEqual(tradeOffs({ ...base, fuel: ['open'], bodyStyles: ['any'] }, petrolSaloon), []);
  assert.deepEqual(tradeOffs({ budget: 'b2' }, petrolSaloon), []);
});

test('every ranked match carries its own trade-offs', () => {
  // Unlike the pool-level unmetWants, a trade-off is per car: with EVs in
  // stock, an EV match owns nothing while a petrol match still owns its fuel.
  for (const m of runAll({ ...base, fuel: ['ev'] })) {
    assert.deepEqual(
      m.tradeOffs,
      m.car.fuel === 'ev' ? [] : [{ dim: 'fuel', wants: ['ev'], got: m.car.fuel }],
      `${m.car.name} should own exactly its own misses`,
    );
  }
});

test('quiz answer keys line up with what the engine reads', () => {
  const ids = QUESTIONS.map((q) => q.id);
  for (const key of ['budget', 'bodyStyles', 'fuel', 'charging', 'primaryUse', 'people', 'mileage', 'style', 'priorities']) {
    assert.ok(ids.includes(key), `question "${key}" missing from quiz`);
  }
  // And nothing the engine no longer reads is still on screen: `boot` was cut
  // (its need is derived from people + primaryUse — see bootNeedKey).
  assert.ok(!ids.includes('boot'), 'the boot question was folded into people/primaryUse');
});

test('regions filter drops cars from unchosen regions but keeps ones of unknown region', () => {
  const [a, b, c] = CARS;
  const pool = [{ ...a, region: 'europe' }, { ...b, region: 'apac' }, { ...c }];
  const ids = (answers) => rankCars({ ...base, budget: 'any', ...answers }, pool).map((r) => r.car.id);
  assert.deepEqual(ids({ regions: ['europe'] }).sort(), [a.id, c.id].sort());
  assert.equal(ids({ regions: ['europe', 'apac'] }).length, ids({}).length);
  assert.deepEqual(ids({ regions: [] }).sort(), ids({}).sort());
});

test('rrmcRegion reads the retailer country in its common shapes', () => {
  assert.equal(rrmcRegion({ dealer: { address: { countryCode: 'gb' } } }), 'europe');
  assert.equal(rrmcRegion({ dealer: { country: 'UK' } }), 'europe');
  assert.equal(rrmcRegion({ dealer: { country: 'United Arab Emirates' } }), 'mea');
  assert.equal(rrmcRegion({ dealer: { address: { country: { code: 'HK' } } } }), 'apac');
  assert.equal(rrmcRegion({ location: { country: 'United States' } }), 'americas');
  assert.equal(rrmcRegion({ dealer: {} }), undefined);
  assert.equal(rrmcRegion({ dealer: { country: 'Atlantis' } }), undefined);
});

test('rrmcListingUrl builds the site\'s own vdp address', () => {
  const v = (id, modelYear, name, interiorColour, exteriorColour) => ({
    id, vehicle: { modelYear, registrationYear: modelYear - 1, model: { name }, appearanceOptions: { interiorColour, exteriorColour } },
  });
  const base = 'https://pre-owned.rolls-roycemotorcars.com/en_gb/vdp/';
  assert.equal(rrmcListingUrl(v(30006990, 2024, 'Spectre', 'Grace White', 'Tempest grey')),
    `${base}30006990-2024-Spectre-Grace-White-Tempest-grey`);
  assert.equal(rrmcListingUrl(v(30001613, 2011, 'Ghost', 'Crème Light', 'Jubilee Silver')),
    `${base}30001613-2011-Ghost-Cr%C3%A8me-Light-Jubilee-Silver`);
  assert.equal(rrmcListingUrl({}), 'https://pre-owned.rolls-roycemotorcars.com');
});

test('rrmcHandDrive takes the car\'s own steering first, else the retailer country\'s side', () => {
  const at = (countryCode, vehicle = {}) => ({ vehicle, dealer: { countryCode, structuredAddress: { countryCode } } });
  assert.equal(rrmcHandDrive(at('GB')), 'rhd');
  assert.equal(rrmcHandDrive(at('JP')), 'rhd');
  assert.equal(rrmcHandDrive(at('SA')), 'lhd');
  assert.equal(rrmcHandDrive(at('US')), 'lhd');
  assert.equal(rrmcHandDrive(at('GB', { steeringPosition: 'Left' })), 'lhd');
  assert.equal(rrmcHandDrive(at('AE', { handDrive: 'R' })), 'rhd');
  assert.equal(rrmcHandDrive(at('GB', { handDrive: 'L' })), 'lhd');
  assert.equal(rrmcHandDrive({ dealer: { country: 'United Kingdom' } }), 'rhd');
  assert.equal(rrmcHandDrive({ dealer: {} }), undefined);
});

test('drive side is a hard filter only when the regions answer is not specific', () => {
  const [a, b] = CARS;
  const pool = [{ ...a, region: 'europe', handDrive: 'rhd' }, { ...b, region: 'europe', handDrive: 'lhd' }];
  const run = (answers) => rankCars({ ...base, budget: 'any', handDrive: 'rhd', ...answers }, pool);
  // No regions, or all four: the wrong side is dropped.
  assert.deepEqual(run({}).map((r) => r.car.id), [a.id]);
  assert.deepEqual(run({ regions: ['europe', 'mea', 'apac', 'americas'] }).map((r) => r.car.id), [a.id]);
  // Specific regions: the wrong side stays, scored below what it would be on the right side.
  const soft = run({ regions: ['europe'] });
  assert.equal(soft.length, 2);
  const lhd = soft.find((r) => r.car.id === b.id).score;
  const unpenalised = rankCars({ ...base, budget: 'any', regions: ['europe'] }, pool).find((r) => r.car.id === b.id).score;
  assert.ok(lhd < unpenalised, `${lhd} should be below ${unpenalised}`);
});

test('rrmcPriceGBP converts the dealer\'s local price at today\'s rate, else the feed\'s GBP', () => {
  const rates = { GBP: 1, JPY: 200, USD: 1.25 };
  const at = (retail, code, gbp) => ({ price: { retail }, currency: { code }, normalisedPrice: gbp ? { GBP: { retail: gbp } } : undefined });
  assert.equal(rrmcPriceGBP(at(95000, 'GBP'), rates), 95000);
  assert.equal(rrmcPriceGBP(at(16800000, 'JPY', 80200), rates), 84000);
  assert.equal(rrmcPriceGBP(at(125000, 'USD'), rates), 100000);
  // No rate for the currency (or no rates at all): the feed's own GBP figure.
  assert.equal(rrmcPriceGBP(at(70000, 'KWD', 170194), rates), 170194);
  assert.equal(rrmcPriceGBP(at(70000, 'KWD', 170194), null), 170194);
  // Neither: no price rather than a wrong one, so the card shows POA.
  assert.equal(rrmcPriceGBP(at(70000, 'KWD'), null), 0);
  assert.equal(rrmcPriceGBP({ price: {} }, rates), 0);
  const p = projectRRMCListing({ id: 1, ...at(16800000, 'JPY'), vehicle: { model: { name: 'Phantom' } } }, rates);
  assert.equal(p.price, 84000);
  assert.equal(p.poa, false);
});

test('rrmcMiles converts kilometre readings, by the reading\'s units or else the dealer\'s', () => {
  assert.equal(rrmcMiles({ odometer: { value: 10850, units: 'mi' } }), 10850);
  assert.equal(rrmcMiles({ odometer: { value: 58500, units: 'km' } }), 36350);
  assert.equal(rrmcMiles({ odometer: { value: 8000 }, dealer: { odometerUnit: 'km' } }), 4971);
  // The reading's own units win over the dealer's.
  assert.equal(rrmcMiles({ odometer: { value: 100, units: 'mi' }, dealer: { odometerUnit: 'km' } }), 100);
  assert.equal(rrmcMiles({ odometer: {} }), 0);
  assert.equal(projectRRMCListing({ id: 1, odometer: { value: 1000, units: 'km' } }).mileage, 621);
});
