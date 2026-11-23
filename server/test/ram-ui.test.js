import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { questionsForBrand } from '../questions.js';
import { installDom, resetDom, settle } from './dom-harness.js';
import { gbp } from '../../blocks/vehicle-matcher/ui.js';
import { pillFor } from '../../blocks/vehicle-matcher/quiz-meta.js';
import { formatRange } from '../../blocks/vehicle-matcher/modes/question-ui.js';
import { budgetBandsFromQuestion, priceLabel } from '../../blocks/vehicle-matcher/modes/match-signal.js';
import { matchCard, previewTile } from '../../blocks/vehicle-matcher/modes/result-card.js';
import { BRAND_COPY, tradeLines } from '../../blocks/vehicle-matcher/modes/brand-copy.js';

const questions = questionsForBrand('ram');
const budget = questions.find((q) => q.id === 'budget');
const matches = Array.from({ length: 4 }, (_, i) => ({
  car: { id: `ram-${i}`, name: `RAM ${i % 2 ? '2500' : '1500'} Big Horn`, line: i % 2 ? '2500' : '1500',
    body: 'pickup', fuel: i % 2 ? 'diesel' : 'petrol', currency: 'USD', transmission: 'auto',
    power: 395, powerUnit: 'hp', priceMin: 35000 + i * 5000, priceMax: 35000 + i * 5000,
    mileage: 12000 + i * 1000, year: 2023, seats: 5, retailerName: 'Test RAM Dealer',
    photo: `https://example.test/ram-${i}.jpg`, link: `https://example.test/inventory/ram-${i}` },
  score: 90 - i, reasons: ['Fits your budget.'], tradeOffs: [],
  listings: [{ id: `ram-${i}`, currency: 'USD', priceMin: 35000 + i * 5000,
    mileage: 12000 + i * 1000, transmission: 'auto', features: [], colour: i % 2 ? 'Black' : 'White' }],
}));
const pool = {
  brand: 'ram', currency: 'USD', n: 4, links: matches.map((m) => `${m.car.link}?verified=1`),
  names: matches.map((m) => m.car.name), lines: ['1500', '2500'], bodies: ['pickup'], fuels: ['petrol', 'diesel'],
  transmissions: ['auto'], retailers: ['Test RAM Dealer', 'Other RAM Dealer'], shades: ['White', 'Black'],
  paints: ['Bright White', 'Diamond Black'], featureKeys: [],
  sites: { lat: [40.1, 41.2], lon: [-74.1, -75.2] },
  id: matches.map((m) => m.car.id), name: [0, 1, 2, 3], line: [0, 1, 0, 1],
  body: [0, 0, 0, 0], fuel: [0, 1, 0, 1], transmission: [0, 0, 0, 0], retailer: [0, 1, 0, 1],
  shade: [0, 1, 0, 1], paint: [0, 1, 0, 1], price: matches.map((m) => m.car.priceMin),
  mileage: [12000, 13000, 14000, 15000], year: [2023, 2023, 2023, 2023],
  plate: [null, null, null, null], seats: [5, 5, 5, 5], features: [0, 0, 0, 0],
  boot: [null, null, null, null], zeroTo62: [null, null, null, null], mpg: [null, null, null, null],
  photo: matches.map((m) => m.car.photo), linkPrefix: 'https://example.test/inventory/',
};
let originalFetch;
let dom;
let emptyField = false;
let error = false;
let requests = [];
let inventory = pool;
before(() => { dom = installDom(); originalFetch = global.fetch; });
after(() => { global.fetch = originalFetch; dom.window.close(); });
beforeEach(() => {
  resetDom(); emptyField = false; error = false; requests = []; inventory = pool;
  window.history.replaceState(null, '', '/');
  navigator.clipboard.writeText = async () => {};
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const path = url.pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ path, body });
    const brand = url.searchParams.get('brand') || body?.brand || 'ram';
    const data = path === '/api/questions' ? { questions: JSON.parse(JSON.stringify(questionsForBrand(brand))) }
      : path === '/api/pool' ? inventory
        : path === '/api/nearby' ? { nearby: [], unmet: {} }
          : { matches: emptyField ? [] : matches, total: 4, eligible: 4, decisive: true, unmet: {}, margin: 5 };
    return { ok: !error, status: error ? 503 : 200, json: async () => structuredClone(data) };
  };
});
const mount = async (name, brand = 'ram') => {
  const mode = (await import(`../../blocks/vehicle-matcher/modes/${name}.js`)).default;
  const root = document.createElement('div'); root.className = `vm vm-${brand}`; document.body.append(root);
  const ctx = { api: 'https://example.test', brand, retailerLabel: 'Spoticar Certified Pre-Owned', overrides: {} };
  mode.mount(root, ctx);
  return { root, ctx };
};
const clean = (root) => assert.doesNotMatch(root.textContent, /£|BMW|Grassicks|Petrol|undefined|NaN|0–62|null mpg|litre boot|—/);

test('money and budget helpers use explicit USD with unchanged GBP defaults', () => {
  assert.equal(gbp(35000), '£35,000'); assert.equal(gbp(35000, 'USD'), '$35,000');
  assert.equal(formatRange([35000, 50000], budget), '$35,000 – $50,000');
  assert.equal(formatRange([35000, 50000], { format: 'gbp' }), '£35,000 – £50,000');
  assert.equal(pillFor(budget, { budget: [35000, 50000] }), '$35k–50k');
  assert.equal(pillFor({ ...budget, currency: undefined }, { budget: [35000, 50000] }), '£35k–50k');
  assert.equal(pillFor({ id: 'fuel', multi: true }, { fuel: ['petrol'] }, 'ram'), 'Gasoline');
  for (const series of ['1500', '2500', '3500']) {
    assert.equal(pillFor(questions.find((q) => q.id === 'truckClass'), { truckClass: series }, 'ram'), `RAM ${series}`);
  }
  assert.equal(pillFor(questions.find((q) => q.id === 'priorities'), { priorities: ['4wd'] }, 'ram'), 'Four-wheel drive');
  assert.ok(budgetBandsFromQuestion(budget).every((b) => !b.label.includes('£')));
  assert.equal(priceLabel(matches[0].car), '$35,000');
  assert.equal(priceLabel({ priceMin: 35000, priceMax: 35000 }), '£35,000');
});

test('RAM shell and both harnesses register the new brand', () => {
  const shell = readFileSync(new URL('../../blocks/vehicle-matcher/vehicle-matcher.js', import.meta.url), 'utf8');
  assert.match(shell, /KNOWN_BRANDS = \[[^\]]*'ram'/);
  for (const file of ['index.html', 'block.html']) {
    const html = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(html, /ram: 'Spoticar Certified Pre-Owned'/);
  }
  assert.match(BRAND_COPY.ram.lede({ questions: 2, retailer: 'Spoticar' }), /truck series, fuel, seats and equipment/);
  assert.match(tradeLines('ram', [{ dim: 'fuel', wants: ['diesel'], got: 'petrol' }])[0], /Gasoline/);
});

test('cards, previews and listing choices show USD and omit unverified truck specs', () => {
  const match = structuredClone(matches[0]);
  match.car.listingCount = 2; match.car.priceFrom = 35000; match.car.priceTo = 40000;
  match.listings.push({ ...match.listings[0], id: 'second', priceMin: 40000, colour: 'Black' });
  const card = matchCard(match, { brand: 'ram', big: true });
  document.body.append(card);
  assert.match(card.textContent, /Pickup.*Gasoline.*\$35,000/);
  assert.match(card.textContent, /395 hp/);
  assert.match(card.querySelector('.vm-usedmeta').textContent, /2023 model year.*12,000 miles/);
  assert.doesNotMatch(card.textContent, /bhp/);
  assert.match(card.textContent, /\$35,000–\$40,000/);
  card.querySelectorAll('.vm-pick-opt')[1].click();
  assert.match(card.querySelector('.vm-specs').textContent, /\$40,000/);
  assert.match(card.querySelector('.vm-usedmeta').textContent, /2023 model year.*12,000 miles/);
  clean(card);
  const preview = previewTile(match); assert.match(preview.textContent, /Gasoline.*\$35,000/); clean(preview);
  const unknown = matchCard({ score: 90, car: { ...matches[0].car, priceMin: null, priceMax: null }, reasons: [] }, { brand: 'ram' });
  assert.match(unknown.textContent, /Price unavailable/); clean(unknown);
});

for (const mode of ['questionnaire', 'mingle', 'knockout', 'podium', 'guess-who']) {
  test(`RAM ${mode} mounts with its own copy and scoped USD controls`, async () => {
    const { root, ctx } = await mount(mode);
    await settle(root, (r) => r.textContent.includes('RAM'));
    if (mode === 'questionnaire') {
      assert.equal(root.querySelector('.vm-intro .vm-kicker'), null);
      assert.doesNotMatch(root.textContent, /UK matchmaker/);
      ctx.showQuestion(0);
      assert.equal(root.querySelector('.vm-slider-value').textContent, formatRange(budget.default, budget));
      ctx.showResults({ budget: [0, budget.max], truckClass: '1500' });
      await settle(root, (r) => Boolean(r.querySelector('.vm-results .vm-card-name')));
    } else if (['mingle', 'knockout'].includes(mode)) {
      assert.match(root.querySelector('.vm-mingle-tiles-budget').textContent, /\$25k/);
      root.querySelector('.vm-mingle-tiles-budget .vm-mingle-tile').click();
      const truck = root.querySelector('.vm-mingle-tile-use');
      assert.match(truck.textContent, /RAM 1500/);
      truck.click();
      const start = root.querySelector('.vm-mingle-seed-cta');
      assert.equal(start.disabled, false); start.click();
      await settle(root, (r) => Boolean(r.querySelector('.vm-mingle-pill')));
      const field = requests.find((r) => r.path === '/api/field');
      assert.equal(field.body.answers.truckClass, '1500');
      assert.equal(field.body.answers.primaryUse, undefined);
    } else if (mode === 'podium') {
      await settle(root, (r) => Boolean(r.querySelector('.vm-card')));
    } else {
      await settle(root, (r) => Boolean(r.querySelector('.vm-card-name')));
      assert.match(root.querySelector('.vm-card-link').href, /\?verified=1$/);
      assert.equal(root.querySelector('input[name="postcode"]'), null);
      assert.doesNotMatch(root.querySelector('.vm-gw-chips').textContent, /Distance/);
      assert.equal(root.querySelector('.vm-gw-swipe-hint').textContent, 'Swipe filters for more choices.');
      assert.doesNotMatch(root.querySelector('.vm-gw-note').textContent, /Each colored tile/);
    }
    assert.match(root.textContent, /\$/); clean(root);
  });
}

for (const mode of ['mingle', 'knockout']) {
  test(`RAM ${mode} empty inventory has an actionable truck message`, async () => {
    emptyField = true; const { root } = await mount(mode);
    await settle(root, (r) => Boolean(r.querySelector('.vm-mingle-seed-cta')));
    root.querySelector('.vm-mingle-tiles-budget .vm-mingle-tile').click();
    root.querySelector('.vm-mingle-tile-use').click(); root.querySelector('.vm-mingle-seed-cta').click();
    await settle(root, (r) => Boolean(r.querySelector('.vm-status')));
    assert.match(root.textContent, /trucks/); assert.match(root.textContent, /Adjust budget/); clean(root);
  });
}

for (const [count, stage] of [[50, 'tile'], [200, 'chip']]) {
  for (const linkSource of ['explicit', 'prefix', 'missing']) {
    test(`Guess Who ${stage} adverts support ${linkSource} listing URLs before the final shortlist`, async () => {
      inventory = structuredClone(pool);
      for (const key of ['id', 'name', 'line', 'body', 'fuel', 'transmission', 'retailer', 'shade', 'paint',
        'price', 'mileage', 'year', 'plate', 'seats', 'features', 'boot', 'zeroTo62', 'mpg', 'photo', 'links']) {
        inventory[key] = Array.from({ length: count }, (_, i) => pool[key][i % pool.n]);
      }
      inventory.n = count;
      if (linkSource !== 'explicit') inventory.links = [];
      if (linkSource === 'missing') inventory.linkPrefix = '';
      const { root } = await mount('guess-who');
      await settle(root, (r) => Boolean(r.querySelector(`.vm-gw-board[data-stage="${stage}"]`)));
      const cell = root.querySelector('.vm-gw-cell');
      const link = cell.querySelector('a');
      if (linkSource === 'missing') {
        assert.equal(link, null, 'A missing advert URL must not become a dead link');
        assert.ok(cell.querySelector('img'));
        return;
      }
      assert.ok(link, 'The advert is already clickable while many vehicles remain');
      assert.equal(link.href, linkSource === 'explicit' ? pool.links[0] : `${pool.linkPrefix}${pool.id[0]}`);
      assert.equal(link.target, '_blank');
      assert.equal(link.rel, 'noopener noreferrer');
      assert.match(link.getAttribute('aria-label'), /RAM 1500 Big Horn.*\$35,000.*Test RAM Dealer/);
      assert.ok(link.querySelector('img'), 'The photo opens the advert');
      assert.equal(link.querySelector('button'), null, 'Reject controls stay outside the link');
      if (stage === 'tile') {
        assert.match(link.textContent, /RAM 1500 Big Horn.*\$35,000/);
        assert.ok(cell.querySelector('.vm-reject-open'));
      }
    });
  }
}

test('RAM load failure offers a retry without fabricated inventory', async () => {
  error = true; const { root } = await mount('guess-who');
  await settle(root, (r) => r.textContent.includes('Try again'));
  assert.match(root.textContent, /couldn’t reach/); clean(root);
});


for (const mode of ['mingle', 'knockout']) {
  test(`${mode} retains the incumbent primaryUse seed contract`, async () => {
    const { root } = await mount(mode, 'bmw');
    await settle(root, (r) => Boolean(r.querySelector('.vm-mingle-seed-cta')));
    root.querySelector('.vm-mingle-tiles-budget .vm-mingle-tile').click();
    root.querySelector('.vm-mingle-tile-use').click();
    const start = root.querySelector('.vm-mingle-seed-cta');
    assert.equal(start.disabled, false); start.click();
    await settle(root, (r) => Boolean(r.querySelector('.vm-mingle-pill')));
    const field = requests.find((r) => r.path === '/api/field');
    assert.equal(field.body.answers.primaryUse, questionsForBrand('bmw').find((q) => q.id === 'primaryUse').options[0].value);
    assert.equal(field.body.answers.truckClass, undefined);
  });
}


test('questionnaire share keeps RAM configuration and answers without access secrets', async () => {
  window.history.replaceState(null, '', '/?brand=ram&api=https%3A%2F%2Fexample.test&mode=questionnaire&scope=national&retailer=ram-cpo&key=fixture&access-key=fixture&password=fixture');
  let copied;
  navigator.clipboard.writeText = async (text) => { copied = text; };
  const { root, ctx } = await mount('questionnaire');
  await settle(root, (r) => r.textContent.includes('Find my RAM'));
  ctx.showResults({ budget: [30000, 65000], truckClass: '1500', fuel: ['petrol'] });
  await settle(root, (r) => Boolean(r.querySelector('.vm-results .vm-card-name')));
  [...root.querySelectorAll('button')].find((b) => b.textContent === 'Copy share link').click();
  await settle(root, () => Boolean(copied));
  const url = new URL(copied);
  for (const [key, value] of Object.entries({ brand: 'ram', api: 'https://example.test', mode: 'questionnaire', scope: 'national', retailer: 'ram-cpo' })) {
    assert.equal(url.searchParams.get(key), value);
  }
  for (const key of ['key', 'access-key', 'password']) assert.equal(url.searchParams.has(key), false);
  assert.match(url.hash, /^#m=.+/);
  const answers = JSON.parse(Buffer.from(url.hash.slice(3), 'base64').toString());
  assert.equal(answers.truckClass, '1500');
});
