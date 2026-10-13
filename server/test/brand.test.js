import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  mapVehicle, mapHondaRaw, mapFordRaw, mapMotorradRaw, mapFerrariRaw,
} from '../mapping.js';
import { questionsForBrand, applyBespokeAnswers } from '../questions.js';
import { normalizeBrand, brandConfig, brandTuning } from '../brands.js';
import { rankCars } from '../engine.js';
import { CARS } from '../data.js';
import { motorradRowsFromEnvelope, motorradRowToRaw, parseMotorradSid } from '../stock.js';
import { parseListingHtml, parseCard, listingUrl } from '../honda-listing.js';
import { parseResTable, parseRow, splitRows } from '../motorrad-listing.js';
import { thronCardImage, projectAd } from '../ferrari-listing.js';

/* Feed-shaped fixtures (the fields mapVehicle actually reads). */
const bmwVehicle = {
  advert_id: 202500001,
  title: 'BMW X3',
  derivative: 'X3 M40d',
  fuel: 'Diesel',
  cash_price: { value: 45990 },
  mileage: 12000,
  identification: { plate: '73' },
  consumption: { fuel: { values: { combined: 42.1 } } },
  media: { items: [{ type: 'image', url: 'https://img/x3.jpg' }] },
  retailer_site: { id: 96, name: 'Grassicks BMW', dealer_number: '11107' },
};

const miniVehicle = {
  advert_id: 202500002,
  title: 'MINI Countryman',
  derivative: 'Countryman S ALL4',
  fuel: 'Petrol',
  cash_price: { value: 28750 },
  mileage: 9681,
  identification: { plate: '74' },
  consumption: { fuel: { values: { combined: 42.2 } } },
  media: { items: [{ type: 'image', url: 'https://img/countryman.jpg' }] },
  retailer_site: { id: 92, name: 'Sytner Luton MINI', dealer_number: '15127' },
};

const miniElectric = {
  advert_id: 202500003,
  title: 'MINI Aceman',
  derivative: 'Aceman E',
  fuel: 'ELECTRIC',
  cash_price: { value: 26950 },
  mileage: 1580,
  consumption: { range: { values: { total: 250 } } },
  media: { items: [{ type: 'image', url: 'https://img/aceman.jpg' }] },
  retailer_site: { id: 92, name: 'Sytner Luton MINI', dealer_number: '15127' },
};

test('normalizeBrand defaults unknown/absent to bmw, accepts mini case-insensitively', () => {
  assert.equal(normalizeBrand(undefined), 'bmw');
  assert.equal(normalizeBrand('nope'), 'bmw');
  assert.equal(normalizeBrand('MINI'), 'mini');
  assert.equal(normalizeBrand('Mini'), 'mini');
});

test('brand config carries the right origin + default retailer', () => {
  assert.match(brandConfig('bmw').origin, /usedcars\.bmw\.co\.uk/);
  assert.equal(brandConfig('bmw').defaultRetailer, '96');
  assert.match(brandConfig('mini').origin, /approvedusedminis\.co\.uk/);
  assert.equal(brandConfig('mini').defaultRetailer, '92');
});

test('mapVehicle(bmw) produces a BMW car with a BMW PDP link', () => {
  const car = mapVehicle(bmwVehicle, 'bmw');
  assert.equal(car.body, 'suv');
  assert.equal(car.fuel, 'diesel');
  assert.equal(car.priceMin, 45990);
  assert.ok(car.seats >= 5);
  assert.match(car.link, /usedcars\.bmw\.co\.uk\/vehicle\/202500001/);
});

test('mapVehicle(mini) resolves a MINI spec, body and MINI PDP link', () => {
  const car = mapVehicle(miniVehicle, 'mini');
  assert.equal(car.line, 'Countryman');
  assert.equal(car.body, 'suv'); // Countryman is a crossover
  assert.equal(car.fuel, 'petrol');
  assert.equal(car.priceMin, 28750);
  assert.ok(car.seats >= 5 && car.boot > 0 && car.zeroTo62 > 0, 'MINI specs filled from MODEL_SPECS_MINI');
  assert.match(car.name, /MINI/);
  assert.match(car.link, /approvedusedminis\.co\.uk\/vehicle\/202500002/);
});

/*
 * dealerNumber is the join key the distance filter hangs off, and it is the kind
 * of field that breaks silently: `retailer_site` carries no postcode and no
 * coordinates, so this number is the only route from "which site sells this car"
 * to "where that site is" (see dealers.js, indexed on exactly this). Drop it and
 * nothing throws — every retailer simply becomes unlocated, the pool ships null
 * coordinates, and Guess Who quietly hides its Distance chip. A test is the only
 * thing that would notice.
 */
test('mapVehicle carries the dealer_number through, and tolerates a feed row without one', () => {
  assert.equal(mapVehicle(bmwVehicle, 'bmw').dealerNumber, '11107');
  assert.equal(mapVehicle(miniVehicle, 'mini').dealerNumber, '15127');

  // Some live rows omit it (resolveRetailerPostcode in stock.js scans for the
  // first that has one), so absent must be undefined rather than a crash or a
  // string like "undefined" that would then miss in the directory.
  const noDealer = mapVehicle(
    { ...bmwVehicle, retailer_site: { id: 96, name: 'Grassicks BMW' } },
    'bmw',
  );
  assert.equal(noDealer.dealerNumber, undefined);
  assert.equal(noDealer.retailerName, 'Grassicks BMW', 'the rest of the car still maps');

  // And a row with no retailer_site at all.
  const noSite = mapVehicle({ ...bmwVehicle, retailer_site: undefined }, 'bmw');
  assert.equal(noSite.dealerNumber, undefined);
});

test('mapVehicle(mini) maps ELECTRIC fuel and an electric line', () => {
  const car = mapVehicle(miniElectric, 'mini');
  assert.equal(car.fuel, 'ev');
  assert.equal(car.line, 'Aceman');
  assert.equal(car.body, 'suv');
  assert.ok(car.tags.includes('tech'));
});

test('questionsForBrand(mini) drops options MINI does not sell', () => {
  const q = questionsForBrand('mini');
  const byId = Object.fromEntries(q.map((x) => [x.id, x]));
  const bodyValues = byId.bodyStyles.options.map((o) => o.value);
  const fuelValues = byId.fuel.options.map((o) => o.value);
  assert.ok(!bodyValues.includes('saloon'), 'MINI has no saloon');
  assert.ok(!bodyValues.includes('coupe'), 'MINI has no coupé');
  assert.ok(!bodyValues.includes('mpv'), 'MINI has no 7-seat MPV');
  assert.ok(bodyValues.includes('hatchback') && bodyValues.includes('suv'));
  assert.ok(!fuelValues.includes('diesel'), 'MINI has no diesel');
  assert.ok(fuelValues.includes('ev') && fuelValues.includes('petrol'));
  // The internal `brands` marker must never reach the client.
  for (const opt of byId.bodyStyles.options) assert.equal(opt.brands, undefined);
});

test('the budget slider is capped lower for MINI than for BMW', () => {
  const bmwBudget = questionsForBrand('bmw').find((q) => q.id === 'budget');
  const miniBudget = questionsForBrand('mini').find((q) => q.id === 'budget');
  assert.equal(bmwBudget.max, 150000, 'BMW keeps the full range');
  assert.ok(miniBudget.max <= 50000, 'MINI budget is capped near its price ceiling');
  assert.ok(miniBudget.max < bmwBudget.max, 'MINI cap is below BMW');
  // Shared base fields are untouched, so the client renders it identically.
  assert.equal(miniBudget.type, 'slider');
  assert.equal(miniBudget.range, true);
  assert.equal(miniBudget.step, 1000);
  // The MINI default bracket sits within its own range.
  const [lo, hi] = miniBudget.default;
  assert.ok(lo >= miniBudget.min && hi <= miniBudget.max, 'MINI default is inside its range');
});

test('MINI copy differs from BMW in words, and narrows option values without inventing any', () => {
  const bmw = questionsForBrand('bmw');
  const mini = questionsForBrand('mini');
  const bmwById = Object.fromEntries(bmw.map((q) => [q.id, q]));
  const miniById = Object.fromEntries(mini.map((q) => [q.id, q]));

  // What MINI still shares with BMW, pinned so the surgery below can't quietly
  // change which questions this test is even talking about.
  const shared = mini.filter((q) => bmwById[q.id]).map((q) => q.id);
  assert.deepEqual(shared, ['budget', 'bodyStyles', 'fuel', 'charging'],
    'MINI keeps four of the shared pool; the rest is dropped or replaced bespoke');

  // Every one of them is reworded in MINI's voice.
  for (const id of shared) {
    assert.notEqual(miniById[id].title, bmwById[id].title, `${id} title is reworded for MINI`);
  }

  // Option VALUES may narrow but must never widen. optionsOverride cuts the
  // shapes and fuels MINI doesn't sell, so the sets are NOT equal across brands
  // — but a MINI-only value would reach a scorer that has no case for it and
  // score as nothing at all. So the invariant is subset-of-BMW, not equal-to.
  for (const id of shared) {
    const bmwVals = new Set((bmwById[id].options || []).map((o) => o.value));
    const invented = (miniById[id].options || []).map((o) => o.value)
      .filter((v) => !bmwVals.has(v));
    assert.deepEqual(invented, [], `${id} must not invent values BMW's engine can't score`);
  }

  // And the narrowing is real, not just permitted.
  const miniBody = miniById.bodyStyles.options.map((o) => o.value);
  assert.ok(!miniBody.includes('saloon') && !miniBody.includes('coupe') && !miniBody.includes('mpv'),
    'MINI drops the shapes it does not sell');
  assert.ok(!miniById.fuel.options.map((o) => o.value).includes('diesel'), 'MINI drops diesel');

  // A reworded label actually changed while its value held.
  const miniHatch = miniById.bodyStyles.options.find((o) => o.value === 'hatchback');
  const bmwHatch = bmwById.bodyStyles.options.find((o) => o.value === 'hatchback');
  assert.notEqual(miniHatch.label, bmwHatch.label);
  assert.match(miniHatch.label, /classic hatch/i);
});

test('questionsForBrand(bmw) keeps the full option set', () => {
  const q = questionsForBrand('bmw');
  const byId = Object.fromEntries(q.map((x) => [x.id, x]));
  const bodyValues = byId.bodyStyles.options.map((o) => o.value);
  const fuelValues = byId.fuel.options.map((o) => o.value);
  assert.ok(bodyValues.includes('saloon') && bodyValues.includes('coupe') && bodyValues.includes('mpv'));
  assert.ok(fuelValues.includes('diesel'));
});

/* ---- brand tuning: MINI scored against its own class ---- */

// A small, quick-for-its-class MINI hatch (the kind the BMW curve under-scores).
const miniHatch = {
  id: 'h', name: 'MINI Cooper', line: 'Hatch', body: 'hatchback', fuel: 'petrol',
  priceMin: 22000, priceMax: 22000, sizeClass: 1, seats: 4, boot: 210,
  zeroTo62: 7.7, mpg: 45, tags: ['urban', 'drivers-car'], blurb: '',
};

test('brand tuning: BMW default is unchanged (no tuning arg == BMW tuning)', () => {
  const answers = {
    budget: [15000, 35000], bodyStyles: ['hatchback'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'city', people: 'solo', mileage: 8000, style: '5', priorities: ['performance'],
  };
  const noArg = rankCars(answers, [miniHatch])[0].score;
  const bmwArg = rankCars(answers, [miniHatch], brandTuning('bmw'))[0].score;
  assert.equal(noArg, bmwArg, 'omitting tuning must equal the BMW tuning');
});

test('brand tuning: a sporty MINI scores higher under MINI tuning than BMW tuning', () => {
  // A JCW — genuinely quick for a MINI (6.0s) — is exactly the car the BMW
  // curve under-scores and MINI tuning should reward.
  const jcw = {
    ...miniHatch, id: 'jcw', name: 'MINI John Cooper Works', zeroTo62: 6.0, tags: ['urban', 'drivers-car', 'image'],
  };
  const answers = {
    budget: [15000, 35000], bodyStyles: ['hatchback'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'fun', people: 'solo', mileage: 8000, style: '5', priorities: ['performance', 'image'],
  };
  const bmwScore = rankCars(answers, [jcw], brandTuning('bmw'))[0].score;
  const miniScore = rankCars(answers, [jcw], brandTuning('mini'))[0].score;
  assert.ok(miniScore > bmwScore, `MINI tuning should lift a JCW (${miniScore} vs ${bmwScore})`);
  assert.ok(miniScore >= 80, `a well-matched sporty MINI should reach a high score, got ${miniScore}`);
});

test('brand tuning: MINI hard-filters do not exclude a Countryman for a family', () => {
  const countryman = {
    ...miniHatch, id: 'cm', name: 'MINI Countryman', body: 'suv', sizeClass: 2, seats: 5, boot: 460, zeroTo62: 8.3,
  };
  const familyAnswers = {
    budget: [15000, 40000], bodyStyles: ['suv'], fuel: ['open'], charging: 'none',
    primaryUse: 'family', people: 'family', mileage: 10000, style: '3', priorities: ['comfort'],
  };
  const survivors = rankCars(familyAnswers, [countryman], brandTuning('mini'));
  assert.equal(survivors.length, 1, 'the Countryman survives the MINI family filter');
});

test('body binding applies to BMW too, but still yields when no right shape fits', () => {
  // BMW honoured a named shape in only 53% of top-3s until body moved to
  // 4.5 / miss 0 (see BMW_TUNING). A right-shape car that fits the brief must
  // beat a wrong-shape one that's stronger everywhere else...
  const estate = {
    id: 'touring', name: 'BMW 320d Touring', line: '3 Series', body: 'estate', fuel: 'diesel',
    priceMin: 34000, priceMax: 34000, sizeClass: 2, seats: 5, boot: 500, zeroTo62: 7.4,
    mpg: 55, tags: ['practical', 'family'], blurb: '',
  };
  const suv = {
    id: 'x5', name: 'BMW X5 xDrive40d', line: 'X5', body: 'suv', fuel: 'diesel',
    priceMin: 34000, priceMax: 34000, sizeClass: 4, seats: 5, boot: 500, zeroTo62: 6.5,
    mpg: 48, tags: ['practical', 'family', 'cruiser', 'image'], blurb: '',
  };
  const wantsEstate = {
    budget: [30000, 45000], bodyStyles: ['estate'], fuel: ['diesel'], charging: 'none',
    primaryUse: 'family', people: 'family', mileage: 15000, style: '3',
    priorities: ['comfort', 'image'],
  };
  const ranked = rankCars(wantsEstate, [suv, estate], brandTuning('bmw'));
  assert.equal(ranked[0].car.id, 'touring', 'the estate the buyer asked for tops, not the plusher SUV');
  // ...but the binding is a weighting, not a filter: with no estate in stock
  // the SUV is still offered as the closest available fit.
  assert.equal(rankCars(wantsEstate, [suv], brandTuning('bmw')).length, 1,
    'a wrong-shape car is never filtered out, only out-ranked');
});

test('body binding: a wrong-shape car cannot top the list when a right-shape one exists', () => {
  // Regression: a JCW EV crossover was topping "hatchback" searches because
  // body was only lightly weighted. A wrong-shape car (however strong on fuel/
  // performance/character) must rank below a right-shape car that also fits.
  const jcwEvSuv = {
    ...miniHatch, id: 'aceman', name: 'MINI JCW Aceman', body: 'suv', fuel: 'ev',
    sizeClass: 2, seats: 5, boot: 300, zeroTo62: 6.4, evRange: 250,
    tags: ['urban', 'drivers-car', 'image', 'tech', 'efficient'],
  };
  const plainHatchEv = {
    ...miniHatch, id: 'hatchev', name: 'MINI Hatch Electric', body: 'hatchback', fuel: 'ev',
    zeroTo62: 7.3, evRange: 200, tags: ['urban', 'tech', 'efficient'],
  };
  const wantsHatchEv = {
    budget: [15000, 35000], bodyStyles: ['hatchback'], fuel: ['ev'], charging: 'home',
    primaryUse: 'city', people: 'solo', mileage: 8000, style: '5',
    priorities: ['performance', 'image'],
  };
  const ranked = rankCars(wantsHatchEv, [jcwEvSuv, plainHatchEv], brandTuning('mini'));
  assert.equal(ranked[0].car.id, 'hatchev', 'the right-shape hatchback tops, not the SUV');
  assert.ok(
    ranked.find((m) => m.car.id === 'hatchev').score > ranked.find((m) => m.car.id === 'aceman').score,
    'right-shape scores strictly higher than the stronger-elsewhere wrong shape',
  );
});

/* ---- mileage now moves the ranking for all fuels ---- */

test('annual mileage changes the ranking (efficient cars rise at high mileage)', () => {
  const thirstyPetrol = {
    ...miniHatch, id: 'p', name: 'MINI JCW', fuel: 'petrol', mpg: 34, zeroTo62: 6.1, tags: ['urban', 'drivers-car', 'image'],
  };
  const ev = {
    ...miniHatch, id: 'e', name: 'MINI Electric', fuel: 'ev', mpg: 0, evRange: 200, tags: ['urban', 'tech', 'efficient'],
  };
  const base = {
    budget: [15000, 40000], bodyStyles: ['hatchback'], fuel: ['open'], charging: 'home',
    primaryUse: 'commute', people: 'solo', style: '3', priorities: ['economy'],
  };
  const low = rankCars({ ...base, mileage: 3000 }, [thirstyPetrol, ev], brandTuning('mini'));
  const high = rankCars({ ...base, mileage: 24000 }, [thirstyPetrol, ev], brandTuning('mini'));
  const evLow = low.find((m) => m.car.id === 'e').score;
  const evHigh = high.find((m) => m.car.id === 'e').score;
  const petrolLow = low.find((m) => m.car.id === 'p').score;
  const petrolHigh = high.find((m) => m.car.id === 'p').score;
  // The EV should gain (or the petrol lose) ground as mileage climbs — i.e. the
  // EV-minus-petrol gap widens in the EV's favour. (Old engine: no change.)
  assert.ok((evHigh - petrolHigh) > (evLow - petrolLow),
    `high mileage should favour the EV more (low gap ${evLow - petrolLow}, high gap ${evHigh - petrolHigh})`);
});

/* ---- bespoke per-brand question ---- */

test('MINI question surgery: drops five, adds doors + miniVibe; BMW keeps its full set', () => {
  const mini = questionsForBrand('mini');
  const ids = mini.map((q) => q.id);
  const bmwIds = questionsForBrand('bmw').map((q) => q.id);
  // Dropped for MINI (dead or near-dead against its range), kept for BMW.
  const dropped = ['mileage', 'style', 'primaryUse', 'people', 'priorities'];
  for (const id of dropped) {
    assert.ok(!ids.includes(id), `MINI drops ${id}`);
    assert.ok(bmwIds.includes(id), `BMW keeps ${id}`);
  }
  // Added for MINI. Both declare insertAfter: 'charging' — the last shared
  // question — so the bespoke pair closes the flow. Note the rendered order is
  // the REVERSE of the declaration order in brands.js: each insert lands
  // immediately after its anchor and pushes the previous one down, so `doors`
  // (declared first) ends up last. Assert the order the client actually gets.
  assert.equal(ids.indexOf('miniVibe'), ids.indexOf('charging') + 1, 'miniVibe follows charging');
  assert.equal(ids.indexOf('doors'), ids.indexOf('miniVibe') + 1, 'doors follows miniVibe');
  assert.equal(ids.at(-1), 'doors', 'doors is the last question MINI asks');
  assert.ok(!bmwIds.includes('doors') && !bmwIds.includes('miniVibe'), 'BMW has neither');
  // scoresAs is engine-internal and must never cross to the client.
  for (const o of mini.find((q) => q.id === 'miniVibe').options) {
    assert.equal(o.scoresAs, undefined, 'miniVibe scoresAs stripped');
  }
});

test('miniVibe folds trim + style into the standard answer set without overriding explicit answers', () => {
  // "sport" carries the styleLine (for scoreStyleLine) AND supplies the style
  // value the dropped style question no longer collects — the fold that keeps
  // comfort-vs-sporty signal alive without its own screen.
  const folded = applyBespokeAnswers('mini', { priorities: ['image'], miniVibe: 'sport' });
  assert.equal(folded.styleLine, 'sport', 'sport sets the trim line');
  assert.equal(folded.style, '5', 'sport fills the sporty style');
  assert.ok(folded.priorities.includes('performance'), 'sport adds the performance priority');
  assert.ok(folded.priorities.includes('image'), 'existing priority preserved');
  // classic/exclusive map to their own trim + a calmer style.
  assert.equal(applyBespokeAnswers('mini', { miniVibe: 'classic' }).styleLine, 'classic');
  assert.equal(applyBespokeAnswers('mini', { miniVibe: 'exclusive' }).style, '3');
  // An explicit style still wins over the bespoke nudge (legacy shared links).
  const explicit = applyBespokeAnswers('mini', { style: '1', miniVibe: 'sport' });
  assert.equal(explicit.style, '1', 'explicit style is not overridden');
  // The doors answer passes straight through (no scoresAs) for scoreDoors.
  assert.equal(applyBespokeAnswers('mini', { doors: '3' }).doors, '3');
  // BMW has no bespoke questions → answers pass through untouched.
  assert.deepEqual(applyBespokeAnswers('bmw', { style: '3' }), { style: '3' });
});

/* ---- BMW spec-gap fill + fuel/crew binding (from the used-stock eval) ---- */

test('BMW spec gaps: I Series / Z3 / Z8 / Alpina map to real lines, not defaults', () => {
  const line = (title, derivative) => mapVehicle(
    { title, derivative, cash_price: { value: 40000 }, retailer_site: { id: 1 } },
    'bmw',
  );
  // "I Series" generic title → real i-line from the derivative (was the bug).
  assert.equal(line('BMW I Series', 'iX xDrive50 M Sport Edition').line, 'iX');
  assert.equal(line('BMW I Series', 'iX xDrive50 M Sport Edition').body, 'suv');
  // Z3/Z8 "… Series" titles fold to the bare spec keys, seats 2, convertible.
  assert.equal(line('BMW Z3 Series', 'Z3 2.8i Roadster').seats, 2);
  assert.equal(line('BMW Z8 Series', 'Z8 Roadster').body, 'convertible');
  // Alpina normalises (incl. the "Unspecified Models" catch-all via derivative).
  assert.equal(line('BMW Alpina Unspecified Models', 'ALPINA D3 2.0D TOURING').line, 'Alpina D3');
  assert.equal(line('BMW Alpina XB7', 'ALPINA XB7').body, 'suv');
  // A filled line no longer uses the default 0-62 (8.0); i8 is a 4.4s coupe.
  assert.equal(line('BMW i8', 'i8 Coupe').zeroTo62, 4.4);
});

test('fuel binds hard when a specific fuel is chosen (wrong-fuel car cannot top)', () => {
  const petrolSaloon = {
    id: 'p', name: 'BMW 520i', line: '5 Series', body: 'saloon', fuel: 'petrol',
    priceMin: 45000, priceMax: 45000, sizeClass: 3, seats: 5, boot: 520, zeroTo62: 7.5,
    mpg: 45, tags: ['cruiser'], blurb: '',
  };
  const evFlagship = {
    id: 'e', name: 'BMW i7 M70', line: 'i7', body: 'saloon', fuel: 'ev',
    priceMin: 45000, priceMax: 45000, sizeClass: 5, seats: 5, boot: 500, zeroTo62: 3.9,
    evRange: 350, tags: ['tech', 'cruiser', 'efficient'], blurb: '',
  };
  const wantsPetrol = {
    budget: [40000, 120000], bodyStyles: ['saloon'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'roadtrips', people: 'solo', mileage: 8000, style: '1',
    priorities: ['comfort', 'tech'],
  };
  const ranked = rankCars(wantsPetrol, [petrolSaloon, evFlagship], brandTuning('bmw'));
  assert.equal(ranked[0].car.id, 'p', 'petrol saloon tops for a petrol buyer, not the EV');
  // "help me decide" leaves fuel unbound → the strong EV can win again.
  const openMinded = rankCars({ ...wantsPetrol, fuel: ['open'], charging: 'home' }, [petrolSaloon, evFlagship], brandTuning('bmw'));
  assert.equal(openMinded[0].car.id, 'e', 'open-minded buyer with home charging can top the EV');
});

test('crew buyer: a 7-seater tops when one exists, but 5-seaters still rank (stock-safe)', () => {
  const sevenSeat = {
    id: 'x7', name: 'BMW X7', line: 'X7', body: 'suv', fuel: 'diesel',
    priceMin: 55000, priceMax: 55000, sizeClass: 5, seats: 7, boot: 750, zeroTo62: 5.9,
    mpg: 40, tags: ['family', 'practical', 'cruiser'], blurb: '',
  };
  const fiveSeat = {
    id: 'x1', name: 'BMW X1', line: 'X1', body: 'suv', fuel: 'diesel',
    priceMin: 35000, priceMax: 35000, sizeClass: 2, seats: 5, boot: 540, zeroTo62: 8.3,
    mpg: 55, tags: ['family', 'practical', 'urban'], blurb: '',
  };
  const crew = {
    budget: [30000, 60000], bodyStyles: ['suv'], fuel: ['diesel'], charging: 'none',
    primaryUse: 'family', people: 'crew', mileage: 15000, style: '3',
    priorities: ['comfort', 'economy'],
  };
  const both = rankCars(crew, [sevenSeat, fiveSeat], brandTuning('bmw'));
  assert.equal(both[0].car.id, 'x7', 'the 7-seater tops a crew search');
  // With no 7-seater in stock the 5-seater still appears (not filtered out).
  const only5 = rankCars(crew, [fiveSeat], brandTuning('bmw'));
  assert.equal(only5.length, 1, 'a 5-seater is not hard-excluded from a crew search');
});

/* ---- MINI-first: styleLine + doors parsing and scoring ---- */

test('mapVehicle parses MINI styleLine + doors from the derivative; BMW leaves them null', () => {
  const map = (derivative, title = 'MINI Hatch') => mapVehicle(
    { advert_id: 1, title, derivative, fuel: 'Petrol', cash_price: { value: 22000 }, retailer_site: { id: 92 } },
    'mini',
  );
  // Style LINE (Classic/Exclusive/Sport/JCW) is distinct from the perf TIER
  // (Cooper C / Cooper S): ~47% of stock uses the older "Cooper S 3 Door"
  // naming that states only the tier, no style word → styleLine null (neutral,
  // never penalised). Doors still parse from either naming.
  assert.deepEqual(
    [map('Cooper S 3 Door').styleLine, map('Cooper S 3 Door').doors], [null, 3],
    'Cooper S 3 Door states a tier, not a style line → styleLine null, 3 doors',
  );
  assert.deepEqual(
    [map('3-Door Hatch Cooper S Sport').styleLine, map('3-Door Hatch Cooper S Sport').doors], ['sport', 3],
    'the newer naming carries the Sport style word',
  );
  assert.deepEqual(
    [map('5-Door Hatch Cooper Exclusive').styleLine, map('5-Door Hatch Cooper Exclusive').doors], ['exclusive', 5],
  );
  assert.equal(map('3-Door Hatch Cooper Classic').styleLine, 'classic');
  assert.equal(map('Hatch John Cooper Works').styleLine, 'jcw', 'JCW is its own trim');
  // Non-hatch bodies never carry a door count; edition names name no style line.
  assert.equal(map('Countryman C', 'MINI Countryman').doors, null, 'SUV has no door question');
  assert.equal(map('Cooper Untamed Edition').styleLine, null, 'unknown edition → null, not a guess');
  // BMW never sets either — the fields exist but stay null.
  const bmw = mapVehicle({ advert_id: 2, title: 'BMW X3', derivative: 'X3 M40d M Sport', fuel: 'Diesel', cash_price: { value: 45000 }, retailer_site: { id: 96 } }, 'bmw');
  assert.deepEqual([bmw.styleLine, bmw.doors], [null, null], 'BMW styleLine/doors are null');
});

test('styleLine + doors move MINI ranking, and neither touches BMW', () => {
  const sportHatch = {
    id: 'sp', name: 'MINI Cooper S', line: 'Hatch', body: 'hatchback', fuel: 'petrol',
    priceMin: 24000, priceMax: 24000, sizeClass: 1, seats: 4, boot: 210, zeroTo62: 6.6,
    mpg: 44, tags: ['urban', 'drivers-car'], blurb: '', styleLine: 'sport', doors: 3,
  };
  const classicHatch = {
    id: 'cl', name: 'MINI Cooper Classic', line: 'Hatch', body: 'hatchback', fuel: 'petrol',
    priceMin: 24000, priceMax: 24000, sizeClass: 1, seats: 4, boot: 210, zeroTo62: 7.7,
    mpg: 49, tags: ['urban'], blurb: '', styleLine: 'classic', doors: 5,
  };
  const base = {
    budget: [15000, 30000], bodyStyles: ['hatchback'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'fun', people: 'solo', priorities: ['image'],
  };
  // A "classic" vibe should lift the classic-trim car over the otherwise-punchier
  // sport car (which the 0-62 curve would otherwise favour).
  const wantsClassic = applyBespokeAnswers('mini', { ...base, miniVibe: 'classic' });
  const rankedC = rankCars(wantsClassic, [sportHatch, classicHatch], brandTuning('mini'));
  assert.equal(rankedC[0].car.id, 'cl', 'classic vibe tops the Classic-trim car');
  assert.ok(rankedC[0].reasons.some((r) => /Classic trim/i.test(r)), 'and says why');
  // A 3-door preference reorders two otherwise-equal-trim hatches.
  const equalTrim = { ...classicHatch, id: 'cl5', styleLine: 'classic', doors: 5 };
  const equalTrim3 = { ...classicHatch, id: 'cl3', styleLine: 'classic', doors: 3 };
  const wants3 = applyBespokeAnswers('mini', { ...base, miniVibe: 'classic', doors: '3' });
  const rankedD = rankCars(wants3, [equalTrim, equalTrim3], brandTuning('mini'));
  assert.equal(rankedD[0].car.id, 'cl3', '3-door preference tops the 3-door car');

  // The same styleLine/doors answers must not change BMW output at all: build
  // two BMWs, rank with and without the MINI-only answers under BMW tuning.
  const bmwA = {
    id: 'a', name: 'BMW 320i', line: '3 Series', body: 'saloon', fuel: 'petrol',
    priceMin: 30000, priceMax: 30000, sizeClass: 2, seats: 5, boot: 480, zeroTo62: 7.4,
    mpg: 45, tags: ['cruiser'], blurb: '', styleLine: null, doors: null,
  };
  const bmwB = { ...bmwA, id: 'b', name: 'BMW 330i', zeroTo62: 5.8, tags: ['drivers-car'] };
  const bmwAnswers = {
    budget: [20000, 50000], bodyStyles: ['saloon'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'commute', people: 'solo', mileage: 10000, style: '3', priorities: ['comfort'],
  };
  const plain = rankCars(bmwAnswers, [bmwA, bmwB], brandTuning('bmw'));
  const withMiniAnswers = rankCars(
    { ...bmwAnswers, styleLine: 'sport', doors: '3' }, [bmwA, bmwB], brandTuning('bmw'),
  );
  assert.deepEqual(
    plain.map((m) => [m.car.id, m.score]), withMiniAnswers.map((m) => [m.car.id, m.score]),
    'styleLine/doors answers are inert for BMW — identical ids and scores',
  );
});

/* ---- equipment concepts: the granular facts refinement will need ---- */

/** A feed vehicle carrying the three option shapes the real feed mixes. */
const equipped = (...strings) => ({
  ...miniVehicle,
  features: {
    interior: { standard: strings.slice(0, 1), additional: [] },
    exterior: { standard: [], additional: strings.slice(1, 2) },
    additional: strings.slice(2).map((s) => ({ category: 'other', description: s })),
  },
});

test('mapVehicle parses equipment concepts from every feed shape', () => {
  const car = mapVehicle(equipped('Panoramic glass roof', 'Head-Up Display', 'Harman Kardon speakers'), 'mini');
  assert.deepEqual(car.features, ['headUpDisplay', 'panoRoof', 'premiumAudio'], 'sorted concept keys, all three nestings read');
  // A car with no options list is an absence of facts, not a car with nothing.
  assert.deepEqual(mapVehicle(miniVehicle, 'mini').features, []);
});

test('concepts match per string, so context can exclude a false positive', () => {
  // The blob-matching bug this replaced: a leather WHEEL read as leather seats,
  // and "heated steering wheel" + "sport seats" combined into heated seats.
  const car = mapVehicle(equipped('Sport leather steering wheel', 'Heated steering wheel', 'Sport seats'), 'mini');
  assert.ok(car.features.includes('leatherWheel') && car.features.includes('heatedWheel'));
  assert.ok(!car.features.includes('heatedSeats'), 'must not pair "heated steering" with a separate "seats" string');
  // A panoramic roof is not what someone picturing a small sunroof means.
  assert.deepEqual(mapVehicle(equipped('Panoramic sunroof'), 'mini').features, ['panoRoof']);
});

test('BMW names the parking pack its own way and still matches', () => {
  // "Parking Assistant" (59% of BMW stock) vs MINI/plain "Park Distance Control".
  assert.ok(mapVehicle(equipped('Parking Assistant'), 'bmw').features.includes('parkingSensors'));
  assert.ok(mapVehicle(equipped('Park Distance Control'), 'mini').features.includes('parkingSensors'));
});

test('transmission normalises to auto/manual, undefined when the feed is silent', () => {
  assert.equal(mapVehicle({ ...miniVehicle, transmission: 'Automatic' }, 'mini').transmission, 'auto');
  assert.equal(mapVehicle({ ...miniVehicle, transmission: 'Manual' }, 'mini').transmission, 'manual');
  assert.equal(mapVehicle(miniVehicle, 'mini').transmission, undefined);
});

test('contrast roof reads as styling, not as any string with a colour in it', () => {
  // MINI's one aesthetic fact: a contrast roof vs one painted body colour.
  assert.ok(mapVehicle(equipped('Roof in Black'), 'mini').features.includes('contrastRoof'));
  assert.ok(mapVehicle(equipped('Black Roof and Mirror Caps'), 'mini').features.includes('contrastRoof'));
  assert.ok(mapVehicle(equipped('Roof and Mirror Caps in Chili Red'), 'mini').features.includes('contrastRoof'));
  // Same roof, no contrast — the buyer who wants one hasn't got one here.
  assert.ok(!mapVehicle(equipped('Roof in Body Colour'), 'mini').features.includes('contrastRoof'));
  // Things that merely mention a roof or a colour are not a contrast roof.
  assert.ok(!mapVehicle(equipped('Roof Rails', 'Anthracite Roof Lining'), 'mini').features.includes('contrastRoof'));
  assert.ok(!mapVehicle(equipped('19" M Double-spoke Jet Black Alloy Wheels'), 'bmw').features.includes('contrastRoof'));
});

/* ================================================================== *
 * Honda — the first fixtures-source brand. Honda has no Auto Trader
 * feed shape; its stock is scraped into a flat record and projected by
 * mapHondaRaw (not BRAND_MAPPERS), then served as-is by the fixtures
 * source. These prove the projection is engine-valid and the config /
 * tuning resolve, so the brand can't silently rot behind the render test.
 * ================================================================== */

// The raw scrape shape mapHondaRaw consumes: flat, string-ish fields.
const hondaRaw = (overrides = {}) => ({
  id: 'HND-TEST-1',
  title: 'Honda Civic 1.5 VTEC Turbo Sport',
  price: 18995,
  fuel: 'Petrol',
  mileage: 14200,
  mpg: 47.1,
  reg: 'LX21 ABC',
  doors: 5,
  transmission: 'Manual',
  image: 'https://img/honda-civic.jpg',
  link: 'https://usedcars.honda.co.uk/vehicle/HND-TEST-1',
  ...overrides,
});

test('brand config: honda is a live-source brand with a Honda origin', () => {
  const cfg = brandConfig('honda');
  assert.equal(cfg.source, 'live-honda', 'honda fetches its listing live, degrading to fixtures');
  assert.match(cfg.origin, /honda\.co\.uk/);
  assert.equal(normalizeBrand('Honda'), 'honda');
  assert.equal(normalizeBrand('HONDA'), 'honda');
});

test('mapHondaRaw projects a flat scrape record into the engine car schema', () => {
  const car = mapHondaRaw(hondaRaw());
  for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
    assert.ok(car[field] !== undefined, `mapped Honda missing ${field}`);
  }
  assert.equal(car.line, 'Civic');
  assert.equal(car.body, 'hatchback');
  assert.equal(car.fuel, 'petrol');
  assert.equal(car.priceMin, 18995);
  assert.equal(car.priceMax, 18995, 'a used car is a single price, not a range');
  assert.equal(car.transmission, 'manual');
  assert.equal(car.retailerName, 'Honda Approved Used');
  assert.match(car.name, /^Honda /, 'the display name leads with the marque');
  assert.match(car.link, /usedcars\.honda\.co\.uk/);
});

test('mapHondaRaw folds Honda hybrids onto the petrol axis, carries hybrid identity in tags', () => {
  // The engine fuel axis is petrol|diesel|phev|ev; Honda's self-charging
  // i-MMD/e:HEV is not plug-in, so it scores as petrol but must still read as
  // efficient so a mileage-conscious buyer is steered to it.
  const hybrid = mapHondaRaw(hondaRaw({ fuel: 'Petrol Hybrid', title: 'Honda Jazz 1.5 i-MMD Advance' }));
  assert.equal(hybrid.fuel, 'petrol', 'a self-charging hybrid is petrol on the engine axis');
  assert.ok(hybrid.tags.includes('efficient'), 'hybrid identity survives as the efficient tag');
  assert.match(hybrid.blurb, /hybrid/i, 'the blurb still tells the buyer it is a hybrid');
});

test('mapHondaRaw maps a real EV line to ev + evRange, an SUV line to suv', () => {
  const ev = mapHondaRaw(hondaRaw({ fuel: 'Electric', title: 'Honda e:Ny1 Advance' }));
  assert.equal(ev.fuel, 'ev');
  assert.ok(ev.evRange > 0, 'an EV needs a range for the engine economy axis');
  const suv = mapHondaRaw(hondaRaw({ title: 'Honda CR-V 2.0 i-MMD Hybrid EX', fuel: 'Petrol Hybrid' }));
  assert.equal(suv.body, 'suv');
  assert.match(suv.name, /Honda CR-V/, 'CR-V casing is preserved, not lower-cased');
});

test('mapHondaRaw returns null for a priceless record (nothing to rank)', () => {
  assert.equal(mapHondaRaw(hondaRaw({ price: 0 })), null);
  assert.equal(mapHondaRaw(hondaRaw({ price: undefined })), null);
});

test('every Honda fixture is engine-valid (real shipped stock, not a synthetic sample)', () => {
  const path = fileURLToPath(new URL('../../fixtures/honda-cars.json', import.meta.url));
  const cars = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(cars.length > 0, 'honda fixtures are not empty');
  for (const car of cars) {
    for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
      assert.ok(car[field] !== undefined, `${car.name || car.id} missing ${field}`);
    }
    assert.ok(car.priceMin <= car.priceMax, `${car.name} price range inverted`);
    if (car.fuel === 'ev') assert.ok(car.evRange > 0, `${car.name} (ev) needs evRange`);
    else assert.ok(car.mpg > 0, `${car.name} needs mpg`);
    assert.ok(!car.blurb.includes('—'), `${car.name} blurb has an em dash`);
    assert.ok(!car.name.includes('—'), `${car.name} name has an em dash`);
  }
});

test('honda tuning ranks a thrifty hatch a real family buyer would pick', () => {
  // Honda tuning leans economy + practicality. A frugal Jazz should out-rank a
  // thirstier, sportier car for a value-minded family, where BMW's image-leaning
  // curve would not separate them the same way.
  const jazz = {
    id: 'jazz', name: 'Honda Jazz', line: 'Jazz', body: 'hatchback', fuel: 'petrol',
    priceMin: 17000, priceMax: 17000, sizeClass: 1, seats: 5, boot: 304, zeroTo62: 9.4,
    mpg: 62, tags: ['urban', 'efficient'], blurb: '',
  };
  const thirsty = {
    ...jazz, id: 'thirsty', name: 'Thirsty Hatch', mpg: 34, zeroTo62: 7.0,
    tags: ['urban', 'drivers-car'],
  };
  const valueFamily = {
    budget: [12000, 22000], bodyStyles: ['hatchback'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'commute', people: 'couple', mileage: 18000, style: '3',
    priorities: ['economy'],
  };
  const ranked = rankCars(valueFamily, [thirsty, jazz], brandTuning('honda'));
  assert.equal(ranked[0].car.id, 'jazz', 'the economical Honda tops for a value buyer under Honda tuning');
});

/* ------------------------------------------------------------------ *
 * Honda live listing adapter (honda-listing.js). Honda runs genuinely
 * live now: stock.js fetches usedcars.honda.co.uk and parses the
 * server-rendered cards with these functions, degrading to the fixtures
 * snapshot on any failure. The parser is the fragile seam (it reads real
 * HTML), so it's pinned here against a card in the site's real shape, and
 * the parseCard -> mapHondaRaw handoff is proven so the live path and the
 * snapshot path stay contract-compatible.
 * ------------------------------------------------------------------ */

// One vehicle card in the shape the real listing renders: a "vehicle-inner"
// wrapper, a Honda detail link + title attr, a monthly then a cash £, a spec
// <li> list (label tag then value tag), a reg data-attr and a /picserver image.
const hondaCardHtml = `
<div class="vehicle-inner">
  <a href="/en/used-cars/approved-cars/honda/civic/1-0-vtec-turbo-se-500243" title="Honda Civic 1.0 VTEC Turbo SE 5dr">
    <img src="/picserver1/userdata/46/500243/Y.jpg" alt="Honda Civic">
  </a>
  <span class="monthly">&pound;189</span>
  <span class="price">&pound;8,799</span>
  <ul>
    <li><span>Mileage</span><span>72,500&nbsp;miles</span></li>
    <li><span>Fuel Type</span><span>Petrol</span></li>
    <li><span>Transmission</span><span>Manual</span></li>
    <li><span>Doors</span><span>5</span></li>
    <li><span>mpg combined</span><span>47.1</span></li>
    <li><span>Exterior colour</span><span>Crystal Black</span></li>
    <li><span>First registration date</span><span>01/03/2021</span></li>
  </ul>
  <div data-modix-360-reg="LX21ABC"></div>
</div>`;

test('parseCard reads one real-shape Honda listing card into the flat raw record', () => {
  const raw = parseCard(hondaCardHtml.split('class="vehicle-inner"')[1]);
  assert.ok(raw, 'a real vehicle card parses');
  assert.match(raw.title, /^Honda Civic 1\.0 VTEC Turbo SE/);
  assert.equal(raw.price, 8799, 'the cash price wins over the smaller monthly figure');
  assert.equal(raw.mileage, 72500);
  assert.equal(raw.fuel, 'Petrol');
  assert.equal(raw.transmission, 'Manual');
  assert.equal(raw.doors, 5);
  assert.equal(raw.colour, 'Crystal Black');
  assert.equal(raw.year, 2021, 'the year comes from the first-registration date');
  assert.match(raw.link, /^https:\/\/usedcars\.honda\.co\.uk\/en\/used-cars\//, 'link is absolute');
  assert.match(raw.image, /^https:\/\/usedcars\.honda\.co\.uk\/picserver/, 'image is absolute');
});

test('parseListingHtml keeps real vehicle cards and drops chrome', () => {
  // A page is real cards plus a trailing chunk with no Honda link/title.
  const page = `<html><body>${hondaCardHtml}
    <div class="vehicle-inner"><div class="pager">Next page</div></div>
  </body></html>`;
  const raw = parseListingHtml(page);
  assert.equal(raw.length, 1, 'the pager chunk is not a vehicle and is dropped');
  assert.equal(raw[0].price, 8799);
});

test('a parsed Honda card feeds mapHondaRaw into an engine-valid car (live == snapshot contract)', () => {
  // This is the seam that matters: whatever the live parse produces must satisfy
  // the same projection the committed snapshot went through, or the live deck and
  // the fixtures deck would disagree in shape.
  const [raw] = parseListingHtml(hondaCardHtml);
  const car = mapHondaRaw(raw);
  assert.ok(car, 'a live-parsed card maps to a car');
  for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
    assert.ok(car[field] !== undefined, `live-mapped Honda missing ${field}`);
  }
  assert.equal(car.line, 'Civic');
  assert.equal(car.body, 'hatchback');
  assert.equal(car.fuel, 'petrol');
  assert.equal(car.priceMin, 8799);
  assert.equal(car.priceMax, 8799);
  assert.match(car.photo, /picserver/, 'the live photo survives into the car');
  assert.ok(!car.blurb.includes('—'), 'no em dash in a live-derived blurb');
});

test('listingUrl carries the approved-used programme and the location facet, page as a path', () => {
  const p1 = listingUrl(1);
  assert.match(p1, /warrantyProgram=22/, 'page 1 keeps the approved-used filter');
  assert.ok(!/\/page/.test(p1), 'page 1 is the bare base, no /pageN');

  const p2 = listingUrl(2);
  assert.match(p2, /\/page2\?/, 'later pages are a /pageN path segment, not a query param');

  const near = listingUrl(1, { zip: 'PH1 3GA', radius: 25 });
  assert.match(near, /zip=PH1\+3GA/, 'the postcode is the location facet (zip)');
  assert.match(near, /radius=25/, 'radius is in miles');
  assert.match(near, /warrantyProgram=22/, 'the location facet does not drop the programme filter');
});

/* ================================================================== *
 * Ford — the second fixtures-source brand, and the broadest range we
 * carry. Its live feed IS reachable but token-gated, so rather than run a
 * live adapter the fixtures are a one-off real snapshot, projected by
 * mapFordRaw (a flat-raw → mapped-car projection, the same shape a live
 * adapter would feed). Ford's mapper is richer than
 * Honda's: a real performance halo (ST/GT speed-up), a genuine EV+PHEV
 * split, and body derivation across estate/convertible/pickup/mpv. These
 * prove all of that, plus the same engine-validity guard the render test
 * relies on. See the Ford section of DECISIONS.md.
 * ================================================================== */

// The flat-raw shape mapFordRaw consumes (curated fixtures, or the live adapter).
const fordRaw = (overrides = {}) => ({
  id: 'FRD-TEST-1',
  title: 'Ford Focus',
  derivative: '1.0 EcoBoost mHEV 125 Titanium 5dr',
  fuel: 'Petrol',
  price: 16500,
  mileage: 18400,
  reg: '72 FRD',
  colour: 'Frozen White',
  ...overrides,
});

test('brand config: ford is a fixtures-source brand with a Ford origin', () => {
  const cfg = brandConfig('ford');
  assert.equal(cfg.source, 'fixtures', 'ford serves from fixtures, not the live feed');
  assert.match(cfg.origin, /ford\.co\.uk/);
  assert.equal(normalizeBrand('Ford'), 'ford');
  assert.equal(normalizeBrand('FORD'), 'ford');
});

test('mapFordRaw projects a flat record into the engine car schema', () => {
  const car = mapFordRaw(fordRaw());
  for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
    assert.ok(car[field] !== undefined, `mapped Ford missing ${field}`);
  }
  assert.equal(car.line, 'Focus');
  assert.equal(car.body, 'hatchback');
  assert.equal(car.fuel, 'petrol');
  assert.equal(car.priceMin, 16500);
  assert.equal(car.priceMax, 16500, 'a used car is a single price, not a range');
  assert.ok(car.mpg > 0, 'a combustion Ford is scored on mpg');
  assert.equal(car.retailerName, 'Ford Approved Used');
  assert.match(car.name, /^Ford Focus /, 'the display name leads with marque + line');
  assert.match(car.name, /Titanium/, 'the derivative is carried so trims are distinguishable');
});

test('mapFordRaw fires the ST/GT performance halo, but not on ST-Line', () => {
  // ST-Line is a styling pack, not the hot car; only ST/GT get the 0-62 speed-up.
  const base = mapFordRaw(fordRaw());
  const stLine = mapFordRaw(fordRaw({ derivative: '1.0 EcoBoost mHEV 155 ST-Line 5dr' }));
  assert.equal(stLine.zeroTo62, base.zeroTo62, 'ST-Line is NOT sped up (it is a look, not the hot car)');
  assert.ok(!stLine.tags.includes('drivers-car'), 'ST-Line is not a performance flag');

  const focusST = mapFordRaw(fordRaw({ derivative: '2.3 EcoBoost ST 5dr' }));
  assert.ok(focusST.zeroTo62 < base.zeroTo62, 'the real Focus ST is quicker than the mainstream trim');
  assert.ok(focusST.zeroTo62 <= 6.0, 'Focus ST 0-62 is a hot-hatch figure (~5.7s)');
  assert.ok(focusST.tags.includes('drivers-car'), 'the ST reads as a performance car');

  const machEgt = mapFordRaw(fordRaw({ title: 'Ford Mustang Mach-E', derivative: 'GT AWD 5dr Auto', fuel: 'Electric', price: 38000 }));
  assert.ok(machEgt.zeroTo62 < 5, 'the Mach-E GT is properly fast');
  assert.equal(machEgt.fuel, 'ev');
});

test('mapFordRaw splits EV, PHEV and petrol correctly', () => {
  const ev = mapFordRaw(fordRaw({ title: 'Ford Explorer', derivative: 'Extended Range RWD Premium 5dr Auto', fuel: 'Electric', price: 38000 }));
  assert.equal(ev.fuel, 'ev');
  assert.ok(ev.evRange > 0, 'an EV needs a range for the economy axis');
  assert.ok(!ev.mpg, 'an EV carries no usable mpg (scored on range instead)');

  // Kuga PHEV: a real plug-in, NOT folded to petrol (unlike Honda's self-charging
  // hybrids). It carries both a plug-in range and an mpg.
  const phev = mapFordRaw(fordRaw({ title: 'Ford Kuga', derivative: '2.5 PHEV ST-Line X 5dr Auto', fuel: 'Plug-in Hybrid', price: 24000 }));
  assert.equal(phev.fuel, 'phev', 'a plug-in hybrid keeps its own fuel category');
  assert.ok(phev.evRange > 0, 'the PHEV carries an electric-only range');
  assert.ok(phev.mpg > 0, 'the PHEV also carries a combustion mpg');

  // Mild-hybrid EcoBoost is petrol, not phev/ev.
  const mhev = mapFordRaw(fordRaw({ derivative: '1.0 EcoBoost mHEV ST-Line 5dr' }));
  assert.equal(mhev.fuel, 'petrol', 'mild-hybrid EcoBoost scores as petrol');
});

test('mapFordRaw derives body from line + derivative (estate, convertible, pickup, mpv)', () => {
  const estate = mapFordRaw(fordRaw({ derivative: '1.0 EcoBoost mHEV 155 Titanium Estate 5dr' }));
  assert.equal(estate.body, 'estate');
  assert.ok(estate.boot >= 550, 'the estate carries more boot than the hatch');

  const convertible = mapFordRaw(fordRaw({ title: 'Ford Mustang', derivative: '5.0 V8 GT Convertible 2dr Auto', price: 40000 }));
  assert.equal(convertible.body, 'convertible');

  const coupe = mapFordRaw(fordRaw({ title: 'Ford Mustang', derivative: '5.0 V8 GT 2dr Auto', price: 40000 }));
  assert.equal(coupe.body, 'coupe');
  assert.equal(coupe.seats, 4, 'the Mustang is a 4-seat coupe');

  const pickup = mapFordRaw(fordRaw({ title: 'Ford Ranger', derivative: '2.0 EcoBlue Wildtrak Double Cab Auto', fuel: 'Diesel', price: 30000 }));
  assert.equal(pickup.body, 'pickup');

  const mpv = mapFordRaw(fordRaw({ title: 'Ford Galaxy', derivative: '2.0 EcoBlue 150 Titanium 5dr', fuel: 'Diesel', price: 19000 }));
  assert.equal(mpv.body, 'mpv');
  assert.equal(mpv.seats, 7, 'the Galaxy is a 7-seat MPV');
});

test('mapFordRaw returns null for a priceless record (nothing to rank)', () => {
  assert.equal(mapFordRaw(fordRaw({ price: 0 })), null);
  assert.equal(mapFordRaw(fordRaw({ price: undefined })), null);
});

test('every Ford fixture is engine-valid (the curated stock the app serves)', () => {
  const path = fileURLToPath(new URL('../../fixtures/ford-cars.json', import.meta.url));
  const cars = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(cars.length > 0, 'ford fixtures are not empty');
  for (const car of cars) {
    for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
      assert.ok(car[field] !== undefined, `${car.name || car.id} missing ${field}`);
    }
    assert.ok(car.priceMin <= car.priceMax, `${car.name} price range inverted`);
    if (car.fuel === 'ev') assert.ok(car.evRange > 0, `${car.name} (ev) needs evRange`);
    else assert.ok(car.mpg > 0, `${car.name} needs mpg`);
    assert.ok(!car.blurb.includes('—'), `${car.name} blurb has an em dash`);
    assert.ok(!car.name.includes('—'), `${car.name} name has an em dash`);
  }
});

test('ford tuning ranks a practical family SUV a real Ford buyer would pick', () => {
  // Ford tuning leans practicality + economy + body fit, lighter on image than
  // BMW. For a family needing space, a roomy Kuga should out-rank a sporty but
  // impractical Mustang under Ford tuning.
  const kuga = {
    id: 'kuga', name: 'Ford Kuga', line: 'Kuga', body: 'suv', fuel: 'petrol',
    priceMin: 20000, priceMax: 20000, sizeClass: 4, seats: 5, boot: 475, zeroTo62: 9.5,
    mpg: 45, tags: ['family', 'practical'], blurb: '',
  };
  const mustang = {
    id: 'mustang', name: 'Ford Mustang', line: 'Mustang', body: 'coupe', fuel: 'petrol',
    priceMin: 20000, priceMax: 20000, sizeClass: 5, seats: 4, boot: 408, zeroTo62: 5.3,
    mpg: 28, tags: ['image', 'drivers-car'], blurb: '',
  };
  const family = {
    budget: [15000, 25000], bodyStyles: ['suv'], fuel: ['petrol'], charging: 'none',
    primaryUse: 'family', people: 'family', mileage: 15000, style: '3',
    priorities: ['practicality'],
  };
  const ranked = rankCars(family, [mustang, kuga], brandTuning('ford'));
  assert.equal(ranked[0].car.id, 'kuga', 'the practical Ford SUV tops for a family under Ford tuning');
});

/* ==================================================================
 * Motorrad — the first NON-CAR brand: BMW's used-bike range on the
 * same engine. It proves the engine is vehicle-agnostic, not just
 * multi-marque. The mapped shape is the identical engine schema, but
 * every field carries a bike meaning: `body` is the riding category
 * (adventure/tourer/sport/naked/roadster/heritage/scooter), `boot` is
 * luggage litres, `seats` is pillion capability, `sizeClass` is a
 * licence-and-manageability band, and the CE scooters are electric. The
 * live feed is a session-gated SPA (unreachable here), so fixtures are
 * curated and projected by mapMotorradRaw. See the Motorrad section of
 * DECISIONS.md for the full field-by-field axis map and the tuning
 * recalibration (bike 0-62 curve, luggage bootNeed, seat floors).
 * ================================================================== */

// The flat-raw shape mapMotorradRaw consumes (curated fixtures, or the live
// adapter): a listing title, a ride-away price, mileage and a plate.
const motorradRaw = (overrides = {}) => ({
  id: 'MOT-TEST-1',
  title: 'BMW R 1250 GS',
  price: 13500,
  mileage: 9200,
  reg: 'MOT 1',
  ...overrides,
});

test('brand config: motorrad runs live, naming its bikes-file offline pool', () => {
  const cfg = brandConfig('motorrad');
  // Motorrad fetches its live approved-used pool (source: 'live-motorrad') and,
  // like every live brand, surfaces a fetch failure as a 502 rather than serving
  // a stale snapshot (no runtime fallback). The committed snapshot survives only
  // as the offline test pool, and fixturesFile records where it lives — the bike
  // file, not <brand>-cars.json.
  assert.equal(cfg.source, 'live-motorrad', 'motorrad serves live, no silent fallback');
  assert.equal(cfg.fixturesFile, 'motorrad-bikes.json', 'motorrad names the bikes file, not <brand>-cars.json');
  assert.match(cfg.origin, /bmw-motorrad\.co\.uk/);
  assert.equal(normalizeBrand('Motorrad'), 'motorrad');
  assert.equal(normalizeBrand('MOTORRAD'), 'motorrad');
});

test('mapMotorradRaw projects a flat bike record into the engine schema', () => {
  const bike = mapMotorradRaw(motorradRaw());
  for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
    assert.ok(bike[field] !== undefined, `mapped Motorrad missing ${field}`);
  }
  assert.equal(bike.line, 'R 1250 GS');
  assert.equal(bike.body, 'adventure', 'the GS is an adventure bike, and body carries the category');
  assert.equal(bike.fuel, 'petrol');
  assert.equal(bike.priceMin, 13500);
  assert.equal(bike.priceMax, 13500, 'a used bike is a single ride-away price, not a range');
  assert.ok(bike.mpg > 0, 'a combustion bike is scored on mpg');
  assert.equal(bike.seats, 2, 'the GS carries a pillion');
  assert.equal(bike.retailerName, 'BMW Motorrad Approved Used');
  assert.match(bike.name, /^BMW /, 'the display name leads with the marque');
  assert.equal(bike.cc, 1254, 'engine capacity is surfaced for the card');
  assert.match(bike.blurb, /ride away/, 'bikes ride away, they do not drive away');
});

test('mapMotorradRaw derives the category (body) from the model across the range', () => {
  const cases = [
    ['BMW R 1300 GS', 'adventure'],
    ['BMW R 1250 RT', 'tourer'],
    ['BMW S 1000 RR', 'sport'],
    ['BMW S 1000 R', 'naked'],
    ['BMW R 1250 R', 'roadster'],
    ['BMW R 18', 'heritage'],
    ['BMW CE 04', 'scooter'],
    ['BMW C 400 GT', 'scooter'],
  ];
  for (const [title, category] of cases) {
    const bike = mapMotorradRaw(motorradRaw({ title }));
    assert.equal(bike.body, category, `${title} should map to the ${category} category`);
    assert.ok(bike.tags.includes(category), `${title} carries its category as a tag`);
  }
});

test('mapMotorradRaw resolves the cross-family lines that used to mislabel (F 750, K 1600 Grand America, K 1300 S)', () => {
  // Regression: these three real titles once fell through motorradLine to a
  // completely wrong family (F 750 -> R 1250 GS, the two K lines -> R 1250 R),
  // so 9 of 963 bikes wore the wrong badge and spec. Each must now resolve to
  // its own line AND pull that line's cc, or the honesty of the deck breaks.
  const cases = [
    ['BMW F 750 GS TE', 'F 750 GS', 853, 'adventure'],
    ['BMW K 1600 Grand America', 'K 1600 Grand America', 1649, 'tourer'],
    ['BMW K 1300 S HP', 'K 1300 S', 1293, 'sport'],
  ];
  for (const [title, line, cc, category] of cases) {
    const bike = mapMotorradRaw(motorradRaw({ title, price: 9995 }));
    assert.equal(bike.line, line, `${title} resolves to its own line, not a foreign family`);
    assert.equal(bike.cc, cc, `${title} carries the ${line} engine (${cc}cc)`);
    assert.equal(bike.body, category, `${title} maps to the ${category} category`);
  }
});

test('mapMotorradRaw makes EVERY zero-cc scooter electric (not just one named model)', () => {
  // Fuel is gated on the spec cc, so every electric model is caught. This pins
  // the CE 02 fix: it was silently mapped to petrol when only "CE 04" was named.
  for (const title of ['BMW CE 04', 'BMW CE 02']) {
    const ev = mapMotorradRaw(motorradRaw({ title, price: 9000 }));
    assert.equal(ev.fuel, 'ev', `${title} is an electric scooter`);
    assert.ok(ev.evRange > 0, `${title} needs a range for the economy axis`);
    assert.ok(!ev.mpg, `${title} is an EV, so it carries no mpg`);
    assert.equal(ev.body, 'scooter');
    assert.match(ev.blurb, /electric scooter/i, `${title} reads as an electric scooter`);
    assert.ok(!/electric electric/i.test(ev.blurb), 'the blurb does not double "electric"');
  }

  // A PETROL scooter (C 400 GT/X, 350cc) is petrol, and its blurb must NOT claim
  // "electric" — the bug that made the whole scooter category read electric.
  const c400 = mapMotorradRaw(motorradRaw({ title: 'BMW C 400 GT', price: 6500 }));
  assert.equal(c400.fuel, 'petrol', 'the C 400 is a petrol scooter');
  assert.ok(c400.mpg > 0, 'a combustion scooter is scored on mpg');
  assert.equal(c400.body, 'scooter');
  assert.doesNotMatch(c400.blurb, /electric/i, 'a petrol scooter is never called electric');

  const gs = mapMotorradRaw(motorradRaw());
  assert.equal(gs.fuel, 'petrol');
  assert.ok(gs.mpg > 0);
  assert.equal(gs.evRange, undefined, 'a petrol bike carries no ev range');
});

test('mapMotorradRaw returns null for a priceless record (never invents a price)', () => {
  assert.equal(mapMotorradRaw(motorradRaw({ price: 0 })), null);
  assert.equal(mapMotorradRaw(motorradRaw({ price: undefined })), null);
});

test('the Motorrad offline pool is the whole real deck, every bike with a real photo', () => {
  // The snapshot is the live feed's own output, captured (see
  // scripts/fetch-motorrad-all-pages.mjs). It's no longer a runtime fallback,
  // but it IS the offline test pool the render tests mount against, so it must
  // stay indistinguishable from live — the full ~963-bike pool, and crucially
  // every bike carrying its real listing photo (the whole point of the
  // missing-images fix). A rebuild that shrank the deck or dropped photos should
  // fail here, loudly.
  const path = fileURLToPath(new URL('../../fixtures/motorrad-bikes.json', import.meta.url));
  const bikes = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(bikes.length >= 500, `the pool is the real deck, not a sample (got ${bikes.length})`);
  const ids = new Set(bikes.map((b) => b.id));
  assert.equal(ids.size, bikes.length, 'no duplicate offers in the snapshot');
  for (const bike of bikes) {
    for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
      assert.ok(bike[field] !== undefined, `${bike.name || bike.id} missing ${field}`);
    }
    assert.ok(bike.priceMin <= bike.priceMax, `${bike.name} price range inverted`);
    if (bike.fuel === 'ev') assert.ok(bike.evRange > 0, `${bike.name} (ev) needs evRange`);
    else assert.ok(bike.mpg > 0, `${bike.name} needs mpg`);
    assert.match(bike.photo || '', /GetImg\?imgId=/, `${bike.name} carries its real listing photo`);
    assert.ok(!bike.blurb.includes('—'), `${bike.name} blurb has an em dash`);
    assert.ok(!bike.name.includes('—'), `${bike.name} name has an em dash`);
  }
});

/* ---- Motorrad bespoke bike questions ---- */

test('questionsForBrand(motorrad) drops car-only questions and adds the bike ones', () => {
  const ids = questionsForBrand('motorrad').map((q) => q.id);
  // Car-only questions Motorrad drops (a bike has no charging plug question,
  // no "how many people", and comfort<->sporty is folded into ridingStyle).
  for (const dropped of ['charging', 'people', 'style']) {
    assert.ok(!ids.includes(dropped), `motorrad should drop the car-only "${dropped}" question`);
  }
  // Bike-native questions Motorrad adds.
  assert.ok(ids.includes('ridingStyle'), 'motorrad asks what kind of riding it is for');
  assert.ok(ids.includes('licence'), 'motorrad asks which licence you ride on');
  // The bespoke questions are spliced in after bodyStyles, in order.
  assert.ok(ids.indexOf('ridingStyle') > ids.indexOf('bodyStyles'), 'ridingStyle follows bodyStyles');
  assert.ok(ids.indexOf('licence') > ids.indexOf('ridingStyle'), 'licence follows ridingStyle');
});

test('applyBespokeAnswers(motorrad) folds ridingStyle into standard engine fields', () => {
  // "Adventure" must resolve to primaryUse:roadtrips (not fun) so the GS range's
  // big-frame + luggage strengths surface — see brands.js for the rationale.
  const adv = applyBespokeAnswers('motorrad', { ridingStyle: 'adventure' });
  assert.equal(adv.primaryUse, 'roadtrips', 'adventure riding folds to roadtrips so GS bikes surface');
  assert.equal(adv.style, '3');
  assert.deepEqual(adv.priorities, ['comfort']);

  const sport = applyBespokeAnswers('motorrad', { ridingStyle: 'sport' });
  assert.equal(sport.primaryUse, 'fun');
  assert.deepEqual(sport.priorities, ['performance']);

  // An explicit standard answer still wins over the bespoke nudge (a scalar only
  // fills a blank; it never overwrites what the rider set directly).
  const explicit = applyBespokeAnswers('motorrad', { primaryUse: 'city', ridingStyle: 'sport' });
  assert.equal(explicit.primaryUse, 'city', 'an explicit primaryUse is not overwritten by the bespoke fold');
});

test('motorrad tuning surfaces a go-anywhere GS for an adventure rider, over a sportbike', () => {
  // The riskiest product claim of the whole bike adaptation: an adventure rider
  // should be shown a GS, not an S 1000 RR. The GS wins on category fit + size +
  // luggage once "adventure" folds to roadtrips; the sportbike is quicker but
  // impractical for the stated use. This is the tuning end-to-end, through the
  // real bespoke fold and the real rankCars.
  const gs = {
    id: 'gs', name: 'BMW R 1250 GS', line: 'R 1250 GS', body: 'adventure', fuel: 'petrol',
    priceMin: 13500, priceMax: 13500, sizeClass: 5, seats: 2, boot: 68, zeroTo62: 3.4,
    mpg: 56, tags: ['adventure', 'touring'], blurb: '',
  };
  const rr = {
    id: 'rr', name: 'BMW S 1000 RR', line: 'S 1000 RR', body: 'sport', fuel: 'petrol',
    priceMin: 13500, priceMax: 13500, sizeClass: 4, seats: 1, boot: 0, zeroTo62: 2.9,
    mpg: 42, tags: ['sport', 'sporty'], blurb: '',
  };
  const rider = applyBespokeAnswers('motorrad', {
    budget: [8000, 18000], bodyStyles: ['adventure'], fuel: ['petrol'],
    ridingStyle: 'adventure', licence: 'a', mileage: 8000,
  });
  const ranked = rankCars(rider, [rr, gs], brandTuning('motorrad'));
  assert.equal(ranked[0].car.id, 'gs', 'the GS tops for an adventure rider under Motorrad tuning');
});

/* ------------------------------------------------------------------ *
 * Motorrad live-feed adapter (motorrad-listing.js). The feed's ResTable
 * is NOT a JSON array of vehicles — it's a server-rendered HTML <table>
 * string, one <tr> per bike, each with a real per-vehicle photo. That is
 * why the earlier synthetic fixtures had no images: nothing in the feed
 * was ever an image URL field. These pin the real shape against a captured
 * live response (test/fixtures/motorrad-restable.html), the same way the
 * Honda card is pinned. The gate on the live endpoint is a session/IP one
 * (GMB-SID), so the fetch itself can't run unattended from here, but the
 * parse — the fragile seam — is fully exercised. See DECISIONS.md.
 * ------------------------------------------------------------------ */

const resTableHtml = () => readFileSync(
  fileURLToPath(new URL('./fixtures/motorrad-restable.html', import.meta.url)), 'utf8',
);

test('splitRows isolates the result <tr> blocks and drops the header row', () => {
  const rows = splitRows(resTableHtml());
  assert.equal(rows.length, 5, 'five real vehicle rows, header <tr> excluded');
});

test('parseRow reads one real ResTable <tr> into the flat raw bike record', () => {
  const [first] = splitRows(resTableHtml());
  const raw = parseRow(first);
  assert.ok(raw, 'a real vehicle row parses');
  assert.match(raw.title, /^BMW R nineT Urban G\/S/);
  assert.equal(raw.price, 8995, 'the cash price is read off the row');
  assert.equal(raw.cc, 1170, 'capacity (ccm) is carried through as a display extra');
  assert.equal(raw.powerKw, 81, 'power reads the leading kW, not a fused 81109');
  assert.match(raw.image, /GetImg\?imgId=/, 'the real per-vehicle photo is captured');
  assert.match(raw.link, /^https:\/\/approvedused\.bmw-motorrad\.co\.uk\/uk\/detail\.cshtml\?on=577260/);
});

test('parseResTable turns the whole HTML table into raw bikes, every one with a real photo', () => {
  const raws = parseResTable(resTableHtml());
  assert.equal(raws.length, 5);
  for (const raw of raws) {
    assert.ok(raw.title, 'each row has a title');
    assert.ok(raw.price > 0, 'each row has a price');
    assert.match(raw.image, /^https:\/\/approvedused\.bmw-motorrad\.co\.uk\/api\/Image\/GetImg/,
      `every bike carries a real listing photo (${raw.title})`);
  }
});

test('motorradRowsFromEnvelope parses the real HTML ResTable string at either envelope depth', () => {
  const html = resTableHtml();
  // The real shape: ResTable is an HTML string, under SearchFilter.
  assert.equal(motorradRowsFromEnvelope({ SearchFilter: { ResTable: html } }).length, 5);
  // Also read at the envelope root (older/flatter captures).
  assert.equal(motorradRowsFromEnvelope({ ResTable: html }).length, 5);
  // The null envelope a session-less request gets back — no rows, no throw.
  assert.deepEqual(motorradRowsFromEnvelope({ SearchFilter: null, ResTable: null }), []);
  assert.deepEqual(motorradRowsFromEnvelope(null), [], 'a null body is empty, not a crash');
  assert.deepEqual(motorradRowsFromEnvelope({}), [], 'an unknown shape degrades to empty');
});

test('motorradRowsFromEnvelope still accepts a pre-parsed JSON array (resilience fallback)', () => {
  // If the feed ever grows a JSON variant, array rows project through
  // motorradRowToRaw rather than crashing the HTML path.
  const rows = [{ Id: 1, Title: 'BMW R 1250 GS', Price: 14250 }];
  const [raw] = motorradRowsFromEnvelope({ SearchFilter: { ResTable: { Items: rows } } });
  assert.equal(raw.id, 1);
  assert.equal(raw.title, 'BMW R 1250 GS');
  assert.equal(raw.price, 14250);
});

test('parseMotorradSid reads the self-issued session out of the landing page', () => {
  // The whole live chain hinges on this: the feed's GMB-SID is not minted by JS,
  // it is embedded in the results page as a hidden #hfSID field, so a plain GET
  // of the landing page yields a fresh session. This is the exact markup the
  // real page serves (a base64 of "<ip>;<guid>").
  const sid = 'OAA2AC4AMQA0ADQALgAxADIAOQAuADIANAAwADsAZgA3ADkAMwBkADcAMwBmAC0AOQBiADMANQAtADQANgBjADcALQA4AGQAZAA5AC0ANABlADIAMgA5ADAAOAAyADcAZAA5ADEA';
  const html = `<form><input type="hidden" id="hfSID" name="hfSID" value="${sid}" /></form>`;
  assert.equal(parseMotorradSid(html), sid, 'the #hfSID value is the session token');
  // It decodes to the "<ip>;<guid>" the server bound to this caller.
  assert.match(Buffer.from(parseMotorradSid(html), 'base64').toString('utf16le'),
    /^\d+\.\d+\.\d+\.\d+;[0-9a-f-]{36}$/, 'the token is ip;guid');
  // A page without the field (shape changed / not the results page) is null, not
  // a crash — the adapter turns that into a clean StockUnavailableError.
  assert.equal(parseMotorradSid('<html><body>no session here</body></html>'), null);
  assert.equal(parseMotorradSid(''), null);
});

test('every parsed live bike maps to the same engine schema as a fixture, photo intact', () => {
  // The seam that matters: whatever the live parse produces must satisfy the
  // same projection the committed fixtures went through, and the real photo
  // must survive into the mapped bike so the deck can paint it.
  const raws = parseResTable(resTableHtml());
  for (const raw of raws) {
    const bike = mapMotorradRaw(raw);
    assert.ok(bike, `${raw.title} maps to a bike`);
    for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
      assert.ok(bike[field] !== undefined, `mapped live bike missing ${field}`);
    }
    assert.match(bike.photo, /GetImg\?imgId=/, `the real photo survives into ${bike.name}`);
    assert.ok(!bike.blurb.includes('—'), `no em dash in a live-derived blurb (${bike.name})`);
  }
});

test('the display name keeps the model + genuine trim but drops the dealer sales tail', () => {
  const nameOf = (title) => mapMotorradRaw({ title, price: 9999 }).name;
  // Real captured titles: marketing clauses and warranty/condition tails go,
  // the model and its genuine trim/spec pack stay.
  assert.equal(nameOf('BMW R nineT Urban G/S Option 719 Gold, Alarm System'),
    'BMW R nineT Urban G/S Option 719 Gold');
  assert.equal(nameOf('BMW R 1250 GS Adventure TE 2 YEAR BMW WARRANTY'),
    'BMW R 1250 GS Adventure TE');
  assert.equal(nameOf('BMW R 1300 GS Ex Demo, Top Spec, Low Miles!'), 'BMW R 1300 GS');
  // A clean title is left untouched; a marque-less title is prefixed.
  assert.equal(nameOf('BMW R 1300 R SE'), 'BMW R 1300 R SE');
  assert.equal(nameOf('R 1300 R SE'), 'BMW R 1300 R SE');
});

test('the captured rows resolve to the right model lines and honest categories', () => {
  // Line resolution is the mapper subtlety the capture exposed: nineT must not
  // collapse to R 12 nineT, GS Adventure must not fall through to a naked
  // default. Pin the five real rows to the lines they must resolve to.
  const byTitle = Object.fromEntries(
    parseResTable(resTableHtml()).map((r) => [r.title, mapMotorradRaw(r)]),
  );
  const expect = [
    ['BMW R nineT Urban G/S Option 719 Gold, Alarm System', 'R nineT', 'heritage', 1170],
    ['BMW R 1250 GS Adventure TE 2 YEAR BMW WARRANTY', 'R 1250 GS Adventure', 'adventure', 1254],
    ['BMW R 1300 R SE', 'R 1300 R', 'roadster', 1300],
    ['BMW S 1000 XR Sport SE', 'S 1000 XR', 'sport', 999],
    ['BMW R 1300 GS Ex Demo, Top Spec, Low Miles!', 'R 1300 GS', 'adventure', 1300],
  ];
  for (const [title, line, body, cc] of expect) {
    const bike = byTitle[title];
    assert.ok(bike, `row present: ${title}`);
    assert.equal(bike.line, line, `${title} -> line`);
    assert.equal(bike.body, body, `${title} -> category`);
    assert.equal(bike.cc, cc, `${title} -> capacity`);
  }
});

/* ================================================================== *
 * Ferrari — a fixtures-source brand of a very different SHAPE to the
 * mainstream marques: a two-seat, high-performance range with no diesel,
 * no hatchbacks, a single four-seat SUV (the Purosangue) and two plug-in
 * hybrids (296, SF90) whose fuel the feed leaves blank. The cars are
 * cold-fetchable (public __NEXT_DATA__ JSON) but the photos are
 * Thron-gallery-gated, so the brand ships a real 148-car snapshot and the
 * live adapter is wired dormant. mapFerrariRaw is the flat-raw -> mapped-car
 * projection (same shape mapFordRaw produces). These tests pin the parts a
 * thin fixture can't guarantee: fuel comes off the SPEC row not the card
 * (so every 296/SF90 is phev, never petrol), body comes off the NAME (so a
 * "GTS"/Spider is convertible and the Purosangue is the SUV), and the spec
 * table never overwrites a real per-listing cc/power. See the Ferrari
 * section of DECISIONS.md.
 * ================================================================== */

// The flat-raw shape mapFerrariRaw consumes (snapshot record, or the live
// adapter's projected ad). Defaults to a petrol coupe (the F8 Tributo).
const ferrariRaw = (overrides = {}) => ({
  id: 'FER-TEST-1',
  name: 'Ferrari F8 Tributo',
  price: 219900,
  mileage: 6200,
  powerHp: 720,
  cc: 3902,
  engine: '3.9 V8',
  gearBox: 'Automatic',
  ...overrides,
});

test('brand config: ferrari serves its listing live with a Ferrari origin', () => {
  const cfg = brandConfig('ferrari');
  assert.equal(cfg.source, 'live-ferrari', 'ferrari fetches its listing live (both cars and cover photos are cold-fetchable), degrading to StockUnavailableError, never a silent fixture fallback');
  assert.match(cfg.origin, /ferrari\.com/);
  assert.equal(cfg.defaultRetailer, 'ferrari-approved');
  assert.equal(normalizeBrand('Ferrari'), 'ferrari');
  assert.equal(normalizeBrand('FERRARI'), 'ferrari');
});

test('mapFerrariRaw projects a flat record into the engine car schema', () => {
  const car = mapFerrariRaw(ferrariRaw());
  for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
    assert.ok(car[field] !== undefined, `mapped Ferrari missing ${field}`);
  }
  assert.equal(car.line, 'F8');
  assert.equal(car.body, 'coupe');
  assert.equal(car.fuel, 'petrol');
  assert.equal(car.priceMin, 219900);
  assert.equal(car.priceMax, 219900, 'a used car is a single price, not a range');
  assert.ok(car.mpg > 0, 'a combustion Ferrari carries an mpg for the (down-weighted) economy axis');
  assert.equal(car.seats, 2, 'a mid-engined Ferrari is a two-seater');
  assert.match(car.name, /^Ferrari /, 'the display name leads with the marque');
  assert.ok(car.tags.includes('drivers-car') && car.tags.includes('image'), 'every Ferrari reads as a drivers-car with image');
});

test('mapFerrariRaw takes fuel from the SPEC row, never the blank card: every 296/SF90 is phev', () => {
  // The bug this guards: the feed leaves fuelType blank on exactly the
  // electrified cars, so a name/card-based check silently maps them petrol.
  // Fuel is the spec row's, so every plug-in resolves to phev with a range.
  for (const name of ['Ferrari 296 GTB', 'Ferrari 296 GTS', '296 GTS', 'Ferrari SF90 Stradale', 'SF90 Spider']) {
    const car = mapFerrariRaw(ferrariRaw({ name, price: 300000, cc: undefined, powerHp: undefined }));
    assert.equal(car.fuel, 'phev', `${name} is a plug-in hybrid, not petrol`);
    assert.ok(car.evRange > 0, `${name} (phev) carries an electric-only range`);
    assert.ok(car.mpg > 0, `${name} also carries a nominal combustion mpg`);
    assert.ok(car.tags.includes('efficient') && car.tags.includes('tech'), `${name} reads as the electrified, techy car`);
  }
  // A car with no spec row falls back to petrol (never invents phev).
  const petrol = mapFerrariRaw(ferrariRaw());
  assert.equal(petrol.fuel, 'petrol');
  assert.ok(!petrol.evRange, 'a petrol Ferrari carries no ev range');
});

test('mapFerrariRaw derives body from the NAME, not the unreliable card bodyStyle', () => {
  // Every category the range actually has, resolved off the name: the open
  // cars (Spider/GTS/Portofino/California), the SUV (Purosangue), and coupe
  // as the default. A "GTS" is open even though the feed reports "coupè".
  const coupe = mapFerrariRaw(ferrariRaw({ name: 'Ferrari 812 Superfast' }));
  assert.equal(coupe.body, 'coupe');

  const spider = mapFerrariRaw(ferrariRaw({ name: 'Ferrari F8 Spider' }));
  assert.equal(spider.body, 'convertible');

  const gts = mapFerrariRaw(ferrariRaw({ name: 'Ferrari 296 GTS', price: 300000 }));
  assert.equal(gts.body, 'convertible', 'a GTS is an open car whatever the card says');

  const portofino = mapFerrariRaw(ferrariRaw({ name: 'Ferrari Portofino M', price: 170000 }));
  assert.equal(portofino.body, 'convertible', 'the folding-hard-top GT is a convertible');

  const suv = mapFerrariRaw(ferrariRaw({ name: 'Ferrari Purosangue', price: 350000, cc: 6496 }));
  assert.equal(suv.body, 'suv');
  assert.equal(suv.seats, 4, 'the Purosangue is the four-seat Ferrari');
  assert.ok(suv.tags.includes('family') && suv.tags.includes('practical'), 'the SUV reads as the usable one');
});

test('mapFerrariRaw keeps a real per-listing cc/power; the spec table only backfills a blank', () => {
  // The rule from Step 2: never present a generic spec value as measured, and
  // never let a spec value overwrite a real one.
  const real = mapFerrariRaw(ferrariRaw({ name: 'Ferrari 296 GTB', cc: 2992, powerHp: 830, price: 300000 }));
  assert.equal(real.cc, 2992, 'a real per-listing cc is kept');
  assert.equal(real.power, 830, 'a real per-listing power is kept');

  // The 296 GTS ships no cc: the spec row backfills it (2992), never leaving it blank.
  const blank = mapFerrariRaw(ferrariRaw({ name: 'Ferrari 296 GTS', cc: undefined, powerHp: undefined, price: 300000 }));
  assert.equal(blank.cc, 2992, 'a blank cc is backfilled from the spec row');
});

test('mapFerrariRaw returns null for a priceless record (never invents a price)', () => {
  assert.equal(mapFerrariRaw(ferrariRaw({ price: 0 })), null);
  assert.equal(mapFerrariRaw(ferrariRaw({ price: undefined })), null);
});

test('thronCardImage builds a public, session-less cover URL for a gallery id', () => {
  // The card image is a Thron DAM asset on the token-free /delivery/public/
  // path — the clientId (ferrari) and sessId (3zayf6) are hardcoded public
  // constants, not per-session values, so a cold script resolves the cover.
  const gid = 'a643790c-131e-4e24-b053-d2ab73783d8a';
  const url = thronCardImage(gid, '600x400', 'Ferrari 488 GTB');
  assert.ok(url.startsWith('https://ferrari-cdn.thron.com/delivery/public/'), 'lives on the public delivery path');
  // A GALLERY id resolves through the `thumbnail` verb (its cover frame); the
  // `image` verb is for single-image ids and 404s on a gallery. Getting this
  // wrong is the whole trap, so pin it.
  assert.match(url, /\/delivery\/public\/thumbnail\/ferrari\//, 'a gallery id uses the thumbnail verb');
  assert.ok(url.includes(`/${gid}/3zayf6/std/600x400/`), 'carries the gallery id, public sessId and requested size');
  assert.ok(!url.includes('token') && !url.includes('?'), 'no token or session query param');
  // No id -> no photo (a placeholder ad), never a broken URL.
  assert.equal(thronCardImage(null), null);
  assert.equal(thronCardImage(undefined, '600x400', 'x'), null);
});

test('projectAd resolves the card cover photo from the ad thronGalleryId', () => {
  const ad = {
    id: 'FER-1', carName: 'Ferrari F8 Tributo', price: '219,900',
    cardImages: { thronGalleryId: 'a643790c-131e-4e24-b053-d2ab73783d8a' },
  };
  const rec = projectAd(ad);
  assert.equal(rec.thronGalleryId, 'a643790c-131e-4e24-b053-d2ab73783d8a', 'carries the gallery id');
  assert.equal(
    rec.photo,
    thronCardImage(ad.cardImages.thronGalleryId, '600x400', ad.carName),
    'photo is the public cover URL built from that id',
  );
  // A gallery-less ad projects with no photo (undefined, not a broken URL) —
  // the mapper and cards guard on car.photo, so it degrades cleanly.
  const noGallery = projectAd({ id: 'FER-2', carName: 'Ferrari Roma', price: '150,000', cardImages: {} });
  assert.equal(noGallery.photo, undefined, 'a gallery-less ad carries no photo');
});

test('every Ferrari fixture is engine-valid (the baked snapshot the app serves)', () => {
  const path = fileURLToPath(new URL('../../fixtures/ferrari-cars.json', import.meta.url));
  const cars = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(cars.length > 0, 'ferrari fixtures are not empty');
  for (const car of cars) {
    for (const field of ['id', 'name', 'line', 'body', 'fuel', 'priceMin', 'priceMax', 'sizeClass', 'seats', 'boot', 'zeroTo62', 'tags', 'blurb']) {
      assert.ok(car[field] !== undefined, `${car.name || car.id} missing ${field}`);
    }
    assert.ok(car.priceMin <= car.priceMax, `${car.name} price range inverted`);
    assert.ok(['coupe', 'convertible', 'suv'].includes(car.body), `${car.name} has an off-range body (${car.body})`);
    assert.ok(['petrol', 'phev'].includes(car.fuel), `${car.name} has an off-range fuel (${car.fuel})`);
    if (car.fuel === 'phev') assert.ok(car.evRange > 0, `${car.name} (phev) needs evRange`);
    else assert.ok(car.mpg > 0, `${car.name} needs mpg`);
    assert.ok(!car.blurb.includes('—'), `${car.name} blurb has an em dash`);
    assert.ok(!car.name.includes('—'), `${car.name} name has an em dash`);
    // The snapshot now ships a real cover photo per car (public Thron cover
    // frame). Guard that they stay present and public — a regression to the old
    // photo-less snapshot, or a token creeping into the URL, fails here.
    assert.ok(
      typeof car.photo === 'string' && car.photo.startsWith('https://ferrari-cdn.thron.com/delivery/public/thumbnail/'),
      `${car.name} is missing its public Thron cover photo`,
    );
  }
});

test('ferrari tuning surfaces the outright-fastest car for a performance-led buyer', () => {
  // Ferrari tuning leans performance + character + body fit, light on economy.
  // For a buyer who wants the quickest thing, the SF90 (2.5s) should out-rank a
  // slower classic, even though both are "a Ferrari".
  const sf90 = {
    id: 'sf90', name: 'Ferrari SF90 Stradale', line: 'SF90', body: 'coupe', fuel: 'phev',
    priceMin: 300000, priceMax: 300000, sizeClass: 2, seats: 2, boot: 74, zeroTo62: 2.5,
    mpg: 39, evRange: 15, tags: ['drivers-car', 'image', 'efficient', 'tech'], blurb: '',
  };
  const testarossa = {
    id: 'testarossa', name: 'Ferrari Testarossa', line: 'Testarossa', body: 'coupe', fuel: 'petrol',
    priceMin: 300000, priceMax: 300000, sizeClass: 3, seats: 2, boot: 140, zeroTo62: 5.2,
    mpg: 15, tags: ['drivers-car', 'image', 'collectable'], blurb: '',
  };
  // No fuel preference is stated: this buyer is about pace, not powertrain, so
  // the fuel-fit axis stays neutral and performance + character decide. (State a
  // petrol-only preference and the phev SF90 rightly loses the fuel bonus — a
  // different, also-correct answer; that is not what "wants the fastest" tests.)
  const driver = {
    budget: [250000, 350000], bodyStyles: ['coupe'], fuel: [],
    primaryUse: 'fun', people: 'solo', mileage: 3000, style: '5',
    priorities: ['performance'],
  };
  const ranked = rankCars(driver, [testarossa, sf90], brandTuning('ferrari'));
  assert.equal(ranked[0].car.id, 'sf90', 'the outright-fastest Ferrari tops for a performance-led buyer');
});

test('questionsForBrand(ferrari) drops charging and offers only the bodies/fuels the range has', () => {
  const questions = questionsForBrand('ferrari');
  const ids = questions.map((q) => q.id);
  // A Ferrari has no charging-plug question (no EVs, and the phevs are not
  // pitched on home charging), so it is dropped like every non-EV brand.
  assert.ok(!ids.includes('charging'), 'ferrari drops the charging question');
  // It keeps the standard car questions (unlike the bikes brand).
  for (const kept of ['budget', 'bodyStyles', 'fuel', 'people', 'style', 'priorities']) {
    assert.ok(ids.includes(kept), `ferrari keeps the "${kept}" question`);
  }

  // bodyStyles offers exactly Ferrari's real bodies, and none it lacks.
  const bodyValues = questions.find((q) => q.id === 'bodyStyles').options.map((o) => o.value);
  for (const has of ['coupe', 'convertible', 'suv']) {
    assert.ok(bodyValues.includes(has), `ferrari offers the ${has} body`);
  }
  for (const lacks of ['hatchback', 'saloon', 'estate', 'mpv']) {
    assert.ok(!bodyValues.includes(lacks), `ferrari does not offer the ${lacks} body it has no stock of`);
  }

  // fuel offers petrol + the plug-in hybrids, never diesel.
  const fuelValues = questions.find((q) => q.id === 'fuel').options.map((o) => o.value);
  assert.ok(fuelValues.includes('petrol'), 'ferrari offers petrol');
  assert.ok(fuelValues.includes('phev'), 'ferrari offers the plug-in hybrids (296, SF90)');
  assert.ok(!fuelValues.includes('diesel'), 'ferrari never offers diesel');
});

test('RRMC budget runs £60k to £1m+, and the top means no upper limit while the minimum binds', () => {
  const budget = questionsForBrand('rrmc').find((q) => q.id === 'budget');
  assert.equal(budget.min, 60000);
  assert.equal(budget.max, 1000000);
  assert.equal(budget.plusAtMax, true);
  assert.equal(budget.minGap, 20000);
  // At the "+" ceiling: open top, minimum kept.
  assert.deepEqual(applyBespokeAnswers('rrmc', { budget: [200000, 1000000] }).budget, [200000, Infinity]);
  // Below the ceiling: unchanged.
  assert.deepEqual(applyBespokeAnswers('rrmc', { budget: [200000, 900000] }).budget, [200000, 900000]);
  // Other brands' "+" ceilings are untouched.
  assert.deepEqual(applyBespokeAnswers('bmw', { budget: [40000, 150000] }).budget, [40000, 150000]);
  // The engine then keeps a £1.5m car (no hard cap) but still ranks under-minimum cars lower.
  const cars = [
    { ...CARS[0], id: 'big', priceMin: 1500000, priceMax: 1500000 },
    { ...CARS[0], id: 'cheap', priceMin: 90000, priceMax: 90000 },
  ];
  const ranked = rankCars(applyBespokeAnswers('rrmc', { budgetGate: 'yes', budget: [200000, 1000000] }), cars, brandTuning('rrmc'));
  assert.deepEqual(ranked.map((r) => r.car.id).sort(), ['big', 'cheap']);
  assert.ok(ranked.find((r) => r.car.id === 'big').score > ranked.find((r) => r.car.id === 'cheap').score);
});
