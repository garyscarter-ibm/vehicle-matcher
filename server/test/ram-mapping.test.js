import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRamRaw } from '../ram-mapping.js';

const listing = (overrides = {}) => ({
  make: 'RAM', model: '1500', vehicle_type_flag: 'cpo', certification_flag: 'TRUE',
  vin: '1TESTVIN000000001', dealer_code: '12345', internetprice: 46325, miles: 20935,
  year: 2026, seating_capacity: 5, doors: '4', body_style: 'Crew Cab', box: "5'7 Box",
  trim_desc: "Rebel Crew Cab 4x4 5'7 Box", eng_desc: '6', drive_type: 'AWD',
  fueltype: 'Gas', engine_horse_power: 420, towing_capacity: 0,
  transmission_desc: '8-Speed Automatic', exterior_color_desc: 'White',
  thumbnail: 'https://example.test/truck.jpg',
  option_desc: 'Heated Front Seats|Heated Steering Wheel|GPS Navigation|Apple CarPlay',
  dealerDetails: { dlr_dba_name: 'Example RAM Dealer', miles: '14.8' },
  ...overrides,
});

test('RAM CPO projection preserves listed USD price, miles, identity and explicit truck facts', () => {
  const car = mapRamRaw(listing());
  assert.equal(car.id, '1TESTVIN000000001_12345');
  assert.equal(car.body, 'pickup');
  assert.equal(car.line, '1500');
  assert.equal(car.styleLine, '1500');
  assert.equal(car.currency, 'USD');
  assert.equal(car.priceMin, 46325);
  assert.equal(car.priceMax, 46325);
  assert.equal(car.mileage, 20935);
  assert.equal(car.seats, 5);
  assert.equal(car.year, 2026);
  assert.equal(car.cab, 'Crew Cab');
  assert.equal(car.bed, "5'7 Box");
  assert.equal(car.engineDescription, '6');
  assert.equal(car.driveType, 'AWD');
  assert.equal(car.power, 420);
  assert.equal(car.powerUnit, 'hp');
  assert.deepEqual(car.colour, { colour: 'White', manufacturerColour: 'White' });
  assert.equal(car.retailerName, 'Example RAM Dealer');
  assert.equal(car.distance, undefined);
  assert.equal(car.photo, 'https://example.test/truck.jpg');
  assert.equal(car.transmission, 'auto');
  assert.deepEqual(car.features, ['heatedSeats', 'heatedWheel', 'navigation', 'smartphoneIntegration']);
});

test('only exact certified RAM pickup families enter the pool', () => {
  for (const delta of [
    { make: 'DODGE' }, { model: 'ProMaster' }, { model: '1500 ProMaster' },
    { model: '4500' }, { body_style: 'Chassis Cab' }, { vehicle_type_flag: 'cpo-go' },
    { vehicle_type_flag: 'cpo-gold' }, { vehicle_type_flag: 'CPO' },
    { vehicle_type_flag: '' }, { internetprice: 0 }, { internetprice: null },
    { vin: '' }, { dealer_code: '' },
  ]) assert.equal(mapRamRaw(listing(delta)), null, JSON.stringify(delta));
  assert.equal(mapRamRaw(null), null);
  for (const model of ['1500', '1500 Classic', '2500', '3500']) {
    const car = mapRamRaw(listing({ model }));
    assert.equal(car.line, model);
    assert.equal(car.styleLine, model.slice(0, 4));
  }
});

test('missing capacities and performance remain unknown, including unknown seating', () => {
  const car = mapRamRaw(listing({ seating_capacity: 0, doors: '', miles: 0, engine_horse_power: 0 }));
  for (const key of ['seats', 'doors', 'boot', 'zeroTo62', 'mpg', 'sizeClass', 'power']) {
    assert.equal(car[key], null, key);
  }
  assert.equal(car.mileage, 0);
  assert.equal(car.cc, undefined);
  assert.equal(car.towing, undefined);
  assert.equal(car.payload, undefined);
  assert.equal(mapRamRaw(listing({ seating_capacity: true })).seats, null);
});

test('equipment and photo fallbacks use listing content without invented options', () => {
  const car = mapRamRaw(listing({
    thumbnail: 'javascript:alert(1)', photo_url: '|https://example.test/first.jpg|https://example.test/second.jpg',
    option_desc: 'Without Heated Seats|Navigation Delete|Leather Steering Wheel|Regular Bucket Seats',
    seating_capacity: null, cab: '', body_style: '', dealerDetails: null,
  }));
  assert.equal(car.photo, 'https://example.test/first.jpg');
  assert.deepEqual(car.features, ['leatherWheel']);
  assert.equal(car.seats, null);
  assert.equal(car.cab, undefined);
  assert.equal(car.retailerName, undefined);
  assert.equal(car.distance, undefined);
  assert.equal(car.link, 'https://www.spoticar.com/t1/vehicle-details?vin=1TESTVIN000000001&dealercode=12345&vehicle_type=cpo');
  assert.notEqual(mapRamRaw(listing({ dealer_code: 'other' })).id, mapRamRaw(listing()).id);
});

test('photo, colour and character tags reflect this listing rather than trim marketing or bootstrap location', () => {
  const car = mapRamRaw(listing({
    photo_url: 'https://example.test/real.jpg|https://example.test/next.jpg',
    exterior_color_desc: 'Granite Crystal Metallic Clearcoat',
  }));
  assert.equal(car.photo, 'https://example.test/real.jpg');
  assert.deepEqual(car.colour, { colour: 'Grey', manufacturerColour: 'Granite Crystal Metallic Clearcoat' });
  assert.deepEqual(car.tags, ['practical', 'tech', 'cruiser']);
  const sparse = mapRamRaw(listing({
    trim_desc: 'Limited Rebel 4x4', drive_type: '', option_desc: '', exterior_color_desc: 'Mystery Pearl',
  }));
  assert.deepEqual(sparse.tags, []);
  assert.deepEqual(sparse.colour, { manufacturerColour: 'Mystery Pearl' });
  assert.equal(sparse.distance, undefined);
  assert.ok(mapRamRaw(listing({ option_desc: 'Ventilated Front Seats' })).tags.includes('cruiser'));
});

test('upstream Laie is corrected only in display names while original trim and listing facts are preserved', () => {
  const car = mapRamRaw(listing({ trim_desc: "Laie Crew Cab 4x4 8' Box", miles: 0 }));
  assert.equal(car.name, "RAM 1500 Laramie Crew Cab 4x4 8' Box");
  assert.equal(car.trim, "Laie Crew Cab 4x4 8' Box");
  assert.equal(car.driveType, 'AWD');
  assert.equal(car.mileage, 0);
  assert.equal(mapRamRaw(listing({ trim_desc: 'LaieCustom' })).name, 'RAM 1500 LaieCustom');
  assert.equal(mapRamRaw(listing({ trim_desc: 'Laramie' })).name, 'RAM 1500 Laramie');
});

test('gasoline mild hybrids retain their combustion fuel instead of entering the electric pool', () => {
  for (const fueltype of ['Gas/Electric', 'Gasoline/Mild Electric Hybrid', 'Gasoline Hybrid', 'Petrol/Electric', 'Flex Fuel']) {
    assert.equal(mapRamRaw(listing({ fueltype })).fuel, 'petrol', fueltype);
  }
  assert.equal(mapRamRaw(listing({ fueltype: 'Diesel/Electric Hybrid' })).fuel, 'diesel');
  for (const fueltype of ['Electric', 'Battery Electric']) {
    assert.equal(mapRamRaw(listing({ fueltype })).fuel, 'ev', fueltype);
  }
  assert.equal(mapRamRaw(listing({ fueltype: 'Hybrid Electric' })).fuel, null);
});
