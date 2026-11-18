import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandConfig, brandTuning, normalizeBrand } from '../brands.js';
import { questionsForBrand, applyBespokeAnswers } from '../questions.js';
import { rankCars, groupListings } from '../engine.js';
import { mapRamRaw } from '../ram-mapping.js';
import { startTestServer, get, post } from './helpers.js';
import { enrichColours, fetchNearbyStock, StockUnavailableError } from '../stock.js';

const truck = (model, changes = {}) => mapRamRaw({
  make: 'RAM', model, vehicle_type_flag: 'cpo', body_style: 'Crew Cab',
  vin: `TEST${model}`, dealer_code: 'test-dealer', internetprice: 45000,
  miles: 18000, year: 2024, fueltype: 'Gasoline', seating_capacity: 5,
  engine_horse_power: 395, drive_type: '4x4',
  dealerDetails: { dlr_dba_name: 'Synthetic RAM Dealer' },
  ...changes,
});

test('RAM has a live source and a USD truck quiz with no unsupported car questions', () => {
  assert.equal(normalizeBrand('RAM'), 'ram');
  assert.equal(brandConfig('ram').source, 'live-spoticar');
  const qs = questionsForBrand('ram');
  assert.deepEqual(qs.map((q) => q.id), ['budget', 'truckClass', 'fuel', 'people', 'mileage', 'priorities']);
  assert.equal(qs[0].currency, 'USD');
  assert.equal(qs[0].format, 'usd');
  assert.deepEqual(qs.find((q) => q.id === 'fuel').options.map((o) => o.value), ['petrol', 'diesel', 'open']);
  assert.deepEqual(qs[1].options.map((o) => o.value), ['1500', '2500', '3500', 'open']);
  assert.ok(qs[1].options.every((o) => !o.scoresAs));
  assert.equal(questionsForBrand('bmw')[0].format, 'gbp');
});

test('truck series affects ranking and all money reasons stay in dollars', () => {
  const cars = ['1500', '2500', '3500'].map((model) => truck(model));
  for (const series of ['1500', '2500', '3500']) {
    const answers = applyBespokeAnswers('ram', { budget: [30000, 60000], truckClass: series, fuel: ['petrol'] });
    const ranked = rankCars(answers, cars, brandTuning('ram'));
    assert.equal(ranked[0].car.line, series);
    assert.ok(ranked.every((m) => Number.isFinite(m.score)));
    assert.match(ranked[0].reasons.join(' '), /\$30k–\$60k/);
    assert.match(ranked[0].reasons.join(' '), new RegExp(`RAM ${series}`));
    assert.doesNotMatch(ranked[0].reasons.join(' '), /£|undefined|litres|mpg|0–62|motorway/);
  }
  const stretch = rankCars({ budget: [30000, 40000] }, [cars[0]], brandTuning('ram'))[0];
  assert.equal(stretch.stretch, true);
  assert.match(stretch.reasons.at(-1), /\$45k/);
});

test('unknown truck specs cannot gain artificial performance or economy weight', () => {
  const actual = truck('1500');
  const fabricated = { ...actual, id: 'other', zeroTo62: 1, boot: 3000, sizeClass: 1, mpg: 150 };
  const answers = { budget: 60000, people: 'crew', mileage: 25000, style: '5', priorities: ['performance', 'economy'] };
  const ranked = rankCars(answers, [actual, fabricated], brandTuning('ram'));
  assert.equal(ranked[0].score, ranked[1].score);
  assert.ok(ranked.every((r) => Number.isFinite(r.score)));
  assert.doesNotMatch(ranked.flatMap((m) => m.reasons).join(' '), /mpg|litres|0–62/);
  const unknownFuel = rankCars({ budget: 60000, fuel: ['diesel'] }, [{ ...actual, fuel: null }], brandTuning('ram'));
  assert.ok(Number.isFinite(unknownFuel[0].score));
  const seatsMissing = { ...actual, seats: null };
  assert.equal(rankCars({ budget: 60000, people: 'crew' }, [seatsMissing], brandTuning('ram')).length, 0);
});

test('individual truck configurations and dealers stay separate in grouped results', () => {
  const cars = [truck('1500', { vin: 'A', trim_desc: 'Rebel', engine_horse_power: 420 }),
    truck('1500', { vin: 'B', trim_desc: 'Laramie', engine_horse_power: 395,
      dealer_code: 'second-dealer', dealerDetails: { dlr_dba_name: 'Second Dealer' } })];
  const matches = groupListings(rankCars({ budget: 60000 }, cars, brandTuning('ram')));
  assert.equal(matches.length, 2);
  for (const match of matches) {
    assert.equal(match.listings.length, 1);
    assert.equal(match.car.name, match.listings[0].name);
    assert.equal(match.car.retailerName, match.listings[0].retailerName);
    assert.equal(match.car.power, match.listings[0].power);
  }
});

test('real HTTP RAM routes keep dollars, query listing links, dealer identity and unknown facts', async () => {
  const cars = ['1500', '2500', '3500'].map((model) => truck(model));
  const calls = [];
  const srv = await startTestServer({
    fetchRetailerStock: async (brand) => { calls.push(brand); return cars; },
    fetchNearbyStock: async () => [],
    enrichColours: async (_brand, rows) => rows,
    fetchDealerDirectory: async () => { throw new Error('RAM must not query the UK dealer directory'); },
  });
  try {
    const questions = await get(srv.base, '/api/questions?brand=ram');
    assert.equal(questions.status, 200);
    assert.equal(questions.json.currency, 'USD');
    const pool = await get(srv.base, '/api/pool?brand=ram');
    assert.equal(pool.status, 200);
    assert.equal(pool.json.currency, 'USD');
    assert.equal(pool.json.scope, 'national');
    assert.equal(pool.json.n, 3);
    assert.deepEqual(pool.json.links, cars.map((c) => c.link));
    assert.deepEqual(pool.json.sites.lat, [null]);
    assert.deepEqual(pool.json.boot, [null, null, null]);
    for (const route of ['match', 'preview', 'field']) {
      const response = await post(srv.base, `/api/${route}`, {
        brand: 'ram', answers: { budget: [30000, 60000], truckClass: '2500', fuel: ['petrol'] }, enrich: true,
      });
      assert.equal(response.status, 200);
      const car = response.json.matches[0].car;
      assert.equal(car.line, '2500');
      assert.equal(car.currency, 'USD');
      assert.equal(car.powerUnit, 'hp');
      assert.equal(car.driveType, '4x4');
      assert.equal(car.boot, null);
      assert.equal(car.mpg, null);
      assert.equal(car.retailerName, 'Synthetic RAM Dealer');
      assert.match(car.link, /\/t1\/vehicle-details\?vin=TEST2500&dealercode=test-dealer&vehicle_type=cpo$/);
    }
    assert.ok(calls.every((brand) => brand === 'ram'));
  } finally { await srv.close(); }
});

test('RAM never invokes BMW colour or UK nearby sources, and an outage remains explicit', async () => {
  const cars = [truck('1500')];
  assert.equal(await enrichColours('ram', cars), cars);
  assert.deepEqual(await fetchNearbyStock('ram'), []);
  const srv = await startTestServer({ fetchRetailerStock: async () => { throw new StockUnavailableError('offline'); } });
  try {
    for (const route of ['match', 'preview', 'field']) {
      const res = await post(srv.base, `/api/${route}`, { brand: 'ram', answers: { budget: 60000 } });
      assert.equal(res.status, 502);
    }
    assert.equal((await get(srv.base, '/api/pool?brand=ram')).status, 502);
  } finally { await srv.close(); }
});
