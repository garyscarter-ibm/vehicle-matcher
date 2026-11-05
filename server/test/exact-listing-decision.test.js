import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CARS } from '../data.js';
import { groupListings, rankCars, LISTING_SAMPLE } from '../engine.js';
import { installDom, resetDom, loadMode, mountMode, settle } from './dom-harness.js';
import { questionsForBrand } from '../questions.js';
import { matchCard, mediaWell } from '../../blocks/vehicle-matcher/modes/result-card.js';
import { applyBrowseFeedback, createFeedbackState, reduceFeedback } from '../../blocks/vehicle-matcher/feedback-actions.js';

// R1's saved synthetic input, independently evaluated by the existing engine.
const answers = { budget: [25000, 35000], bodyStyles: ['estate'], fuel: ['petrol'],
  charging: 'none', primaryUse: 'roadtrips', people: 'solo', mileage: 12000,
  style: '1', priorities: ['comfort', 'economy'] };
const base = { ...CARS[0], id: 'r1-a', name: 'BMW Probe Touring', line: 'Probe',
  body: 'estate', fuel: 'petrol', priceMin: 30000, priceMax: 30000,
  seats: 5, boot: 560, zeroTo62: 7, sizeClass: 3, mpg: 48,
  tags: ['cruiser', 'efficient', 'practical'], transmission: 'auto',
  features: ['heatedSeats'], colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' },
  photo: '/blue.jpg', link: '/blue', mileage: 10000 };
const siblings = () => [structuredClone(base), { ...structuredClone(base), id: 'r1-b',
  features: ['parkingCamera'], priceMin: 39000, priceMax: 39000,
  transmission: 'manual', colour: { colour: 'Red', manufacturerColour: 'Chili Red' },
  photo: '', link: '/red', mileage: 18000 }];
const decision = ({ score, fit, taste, stretch, reasons, tradeOffs }) =>
  ({ score, fit, taste, stretch, reasons, tradeOffs });
const publicFixture = () => {
  const ranked = rankCars(answers, siblings());
  const grouped = groupListings(ranked)[0];
  return { ...grouped, listings: ranked.map((m) => ({ ...m.car,
    colour: m.car.colour.manufacturerColour, shade: m.car.colour.colour,
    decision: decision(m) })) };
};
const filter = (pool, target) => {
  const state = createFeedbackState({ kind: 'browse', id: 'r1' });
  return applyBrowseFeedback(pool, reduceFeedback(state, { schemaVersion: 1, id: 'filter',
    type: 'filter', target, reason: 'R1 refinement', scope: state.scope, expectedVersion: 0 }).state);
};
let dom;
before(() => { dom = installDom(); });
after(() => dom.window.close());
beforeEach(() => resetDom());

test('grouping retains independently computed exact decisions and old representative fields', () => {
  const cars = siblings(); const before = structuredClone(cars);
  const ranked = rankCars(answers, cars); const [group] = groupListings(ranked);
  assert.deepEqual(ranked.map((m) => [m.score, m.stretch]), [[96, false], [87, true]]);
  for (const key of ['score', 'fit', 'taste', 'stretch', 'reasons', 'tradeOffs']) assert.deepEqual(group[key], ranked[0][key]);
  assert.deepEqual(group.listings.map((l) => l.decision), ranked.map(decision));
  assert.deepEqual(group.car.features, ['heatedSeats', 'parkingCamera']);
  assert.deepEqual(cars, before, 'cached source cars are not mutated');
});

test('sampled members retain decisions while count and equipment union describe the full group', () => {
  const pool = Array.from({ length: LISTING_SAMPLE + 1 }, (_, i) => ({ ...base, id: `sample-${i}`,
    features: i === LISTING_SAMPLE ? ['towbar'] : ['heatedSeats'] }));
  const [group] = groupListings(rankCars(answers, pool));
  assert.equal(group.listings.length, LISTING_SAMPLE);
  assert.equal(group.car.listingCount, LISTING_SAMPLE + 1);
  assert.deepEqual(group.car.features, ['heatedSeats', 'towbar']);
  assert.ok(group.listings.every((l) => l.decision.score === 96));
});

test('selecting expensive R1 sibling updates all exact claims and preserves aggregate availability', () => {
  const card = matchCard(publicFixture(), { big: true }); document.body.append(card);
  assert.equal(card.querySelector('.vm-score').textContent, '96%');
  const choice = card.querySelectorAll('.vm-pick-opt')[1]; choice.focus(); choice.click();
  assert.equal(document.activeElement, choice);
  assert.equal(choice.getAttribute('aria-pressed'), 'true');
  assert.equal(card.querySelector('.vm-score').textContent, '87%');
  assert.match(card.querySelector('.vm-reasons').textContent, /stretch.*£39k/i);
  assert.doesNotMatch(card.querySelector('.vm-reasons').textContent, /within.*budget/i);
  assert.match(card.querySelector('.vm-specs').textContent, /Manual.*£39,000/);
  assert.equal(card.querySelector('.vm-card-photo'), null);
  assert.equal(card.querySelector('.vm-card-link').getAttribute('href'), '/red');
  assert.match(card.querySelector('.vm-kit').textContent, /Parking camera/);
  assert.doesNotMatch(card.querySelector('.vm-kit').textContent, /Heated seats/);
  assert.match(card.querySelector('.vm-avail').textContent, /2 available.*£30,000–£39,000/);
});

test('refining to expensive equipment promotes its server decision alongside its exact facts', () => {
  const [match] = filter([publicFixture()], { field: 'feature', operator: 'includes', value: 'parkingCamera' });
  assert.equal(match.score, 87); assert.equal(match.stretch, true);
  assert.match(match.reasons.join(' '), /stretch/);
  const card = matchCard(match, { big: true });
  assert.equal(card.querySelector('.vm-score').textContent, '87%');
  assert.match(card.querySelector('.vm-specs').textContent, /£39,000/);
  assert.match(card.querySelector('.vm-reasons').textContent, /stretch/);
  assert.deepEqual(match.car.features, ['parkingCamera']);
});

test('legacy sibling selection suppresses unsupported score, stretch and representative reasons', () => {
  const match = publicFixture(); match.listings.forEach((l) => { delete l.decision; });
  const card = matchCard(match, { big: true });
  assert.equal(card.querySelector('.vm-score').textContent, '96%');
  card.querySelectorAll('.vm-pick-opt')[1].click();
  assert.equal(card.querySelector('.vm-score'), null);
  assert.equal(card.querySelector('.vm-reasons'), null);
  assert.equal(card.querySelector('.vm-trade-text'), null);
  assert.match(card.textContent, /score.*unavailable/i);
  assert.match(card.querySelector('.vm-specs').textContent, /£39,000/);
  card.querySelectorAll('.vm-pick-opt')[0].click();
  assert.equal(card.querySelector('.vm-score').textContent, '96%');
});

test('legacy refinement clears representative claims without inventing an exact score', () => {
  const match = publicFixture(); match.listings.forEach((l) => { delete l.decision; });
  const [result] = filter([match], { field: 'shade', operator: 'equals', value: 'Red' });
  assert.equal(result.score, undefined); assert.equal(result.stretch, undefined);
  assert.deepEqual(result.reasons, []); assert.deepEqual(result.tradeOffs, []);
  const card = matchCard(result, { big: true });
  assert.equal(card.querySelector('.vm-score'), null);
  assert.equal(card.querySelector('.vm-reasons'), null);
  assert.match(card.textContent, /score.*unavailable/i);
});

test('missing selected equipment, gearbox, image and link never inherit representative facts', () => {
  const match = publicFixture();
  Object.assign(match.listings[1], { features: undefined, transmission: undefined, photo: undefined, link: undefined });
  const card = matchCard(match, { big: true });
  card.querySelectorAll('.vm-pick-opt')[1].click();
  assert.ok(card.querySelector('.vm-kit').hidden);
  assert.doesNotMatch(card.querySelector('.vm-specs').textContent, /Automatic/);
  assert.equal(card.querySelector('.vm-card-photo'), null);
  assert.equal(card.querySelector('.vm-card-link'), null);
});

test('hard-filter and compact modes remain usable without an invented decision', () => {
  const match = publicFixture(); delete match.score; match.reasons = [];
  const card = matchCard(match, { compact: true, showScore: false });
  assert.equal(card.querySelector('.vm-score'), null);
  assert.equal(card.querySelector('.vm-pick'), null);
});

test('a late failed image from the previous listing cannot hide the selected photo', () => {
  const { media, showPhoto } = mediaWell(base);
  const previous = media.querySelector('img');
  showPhoto('/red.jpg', { name: 'Selected red car', line: 'Selected line' });
  previous.dispatchEvent(new window.Event('error'));
  assert.ok(media.classList.contains('has-photo'));
  assert.equal(media.querySelector('img').alt, 'Selected red car');
  assert.equal(media.querySelector('.vm-card-line').textContent, 'Selected line');
  media.querySelector('img').dispatchEvent(new window.Event('error'));
  assert.equal(media.querySelector('img'), null);
  assert.equal(media.classList.contains('has-photo'), false);
});

test('listing-owned trade-offs, retailer, plate and link text switch together', () => {
  const match = publicFixture();
  Object.assign(match.listings[0], { retailerName: 'Blue Retailer', distance: 2, plate: '24' });
  Object.assign(match.listings[1], { retailerName: 'Red Retailer', distance: 18, plate: '25' });
  match.listings[1].decision.tradeOffs = [{ dim: 'fuel', wants: ['ev'], got: 'petrol' }];
  const card = matchCard(match, { big: true });
  card.querySelectorAll('.vm-pick-opt')[1].click();
  assert.match(card.querySelector('.vm-trade-text').textContent, /Petrol.*fully electric/);
  assert.match(card.querySelector('.vm-distance').textContent, /18 miles away.*Red Retailer/);
  assert.match(card.querySelector('.vm-usedmeta').textContent, /’25 reg/);
  assert.match(card.querySelector('.vm-card-link').textContent, /Red Retailer/);
  card.querySelectorAll('.vm-pick-opt')[0].click();
  assert.equal(card.querySelector('.vm-trade-text'), null);
  assert.match(card.querySelector('.vm-distance').textContent, /Blue Retailer/);
});

test('refining away a photographed car clears missing exact imagery, location and gearbox', () => {
  const match = publicFixture();
  Object.assign(match.car, { retailerName: 'Blue Retailer', distance: 2, plate: '24' });
  Object.assign(match.listings[1], { photo: undefined, transmission: undefined, link: undefined });
  const [selected] = filter([match], { field: 'shade', operator: 'equals', value: 'Red' });
  const card = matchCard(selected, { big: true });
  assert.equal(card.querySelector('.vm-card-photo'), null);
  assert.equal(card.querySelector('.vm-card-link'), null);
  assert.ok(card.querySelector('.vm-distance').hidden);
  assert.doesNotMatch(card.querySelector('.vm-specs').textContent, /Automatic/);
  assert.doesNotMatch(card.querySelector('.vm-usedmeta').textContent, /’24 reg/);
});

for (const legacy of [false, true]) test(`questionnaire equipment refinement uses ${legacy ? 'truthful legacy fallback' : 'exact server decisions'} and undo restores R1`, async (t) => {
  const match = publicFixture();
  if (legacy) match.listings.forEach((l) => { delete l.decision; });
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname;
    const value = path === '/api/questions' ? { questions: questionsForBrand('bmw') }
      : path === '/api/nearby' ? { nearby: [], unmet: {} }
        : { matches: [match], alternatives: [], decisive: true, searched: { total: 2, eligible: 2 }, unmet: {} };
    return new Response(JSON.stringify(value), { status: 200 });
  });
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.history.replaceState(null, '', `/#m=${Buffer.from(JSON.stringify(answers)).toString('base64url')}`);
  const stage = mountMode(await loadMode('questionnaire'), { base: 'http://r1.test', brand: 'bmw' });
  await settle(stage, (s) => s.querySelector('.vm-card'));
  const camera = [...stage.querySelectorAll('.vm-chip')].find((b) => b.textContent === 'Parking camera');
  assert.ok(camera, 'aggregate availability offers the exact equipment refinement');
  camera.click();
  assert.match(stage.querySelector('.vm-card .vm-specs').textContent, /£39,000/);
  if (legacy) {
    assert.equal(stage.querySelector('.vm-score'), null);
    assert.match(stage.querySelector('.vm-title').textContent, /selected listings/i);
    assert.doesNotMatch(stage.textContent, /fit you equally well|within the budget|undefined%|NaN/);
  } else {
    assert.equal(stage.querySelector('.vm-score').textContent, '87%');
    assert.match(stage.querySelector('.vm-reasons').textContent, /stretch/);
    assert.doesNotMatch(stage.querySelector('.vm-title').textContent, /perfect/i);
  }
  const undo = stage.querySelector('.vm-brief-undo');
  assert.ok(undo); undo.click();
  assert.equal(stage.querySelector('.vm-score').textContent, '96%');
  assert.equal(stage.querySelectorAll('.vm-pick-opt').length, 2);
});
