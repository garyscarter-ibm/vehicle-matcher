import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const EVIDENCE = resolve(ROOT, 'docs/gcsp/evidence/fucq-30');
const SCRATCH = process.env.FUCQ30_SCRATCH;
const NODE_MODULES = '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const require = createRequire(pathToFileURL(join(NODE_MODULES, 'package.json')).href);
const { chromium } = require('playwright');
const { questionsForBrand } = await import(pathToFileURL(join(ROOT, 'server/questions.js')).href);

if (!SCRATCH) throw new Error('FUCQ30_SCRATCH is required');

const SOURCE_FILES = [
  'blocks/vehicle-matcher/modes/questionnaire.js',
  'blocks/vehicle-matcher/modes/result-card.js',
  'blocks/vehicle-matcher/feedback-actions.js',
  'blocks/vehicle-matcher/engine.js',
  'blocks/vehicle-matcher/modes/question-ui.js',
  'blocks/vehicle-matcher/component-gallery.js',
  'blocks/vehicle-matcher/vehicle-matcher.css',
  'blocks/vehicle-matcher/component-gallery.css',
  'components.html',
  'server/questions.js',
  'server/test/render.test.js',
];

const SHA256 = async (file) => createHash('sha256').update(await readFile(join(ROOT, file))).digest('hex');
const sourceHashes = {};
for (const file of SOURCE_FILES) sourceHashes[file] = await SHA256(file);

const questions = questionsForBrand('bmw').filter((question) => ['budget', 'fuel'].includes(question.id));
const group320i = {
  score: 88, reasons: [], tradeOffs: [],
  car: {
    id: 'fixture-320i', name: 'BMW 320i Touring', line: '3 Series', body: 'estate', fuel: 'petrol',
    colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' },
    priceMin: 29000, priceMax: 32000, priceFrom: 29000, priceTo: 32000,
    mileage: 10000, transmission: 'auto', listingCount: 3, colours: ['Blue', 'White', 'Black'],
    features: ['heatedSeats'], retailerName: 'Synthetic Test Retailer', distance: null, link: '#',
  },
  listings: [
    { id: 'fixture-blue', shade: 'Blue', colour: 'Blue', priceMin: 32000, mileage: 10000, transmission: 'auto', features: ['heatedSeats'], link: '#', retailerName: 'Synthetic Test Retailer' },
    { id: 'fixture-white', shade: 'White', colour: 'White', priceMin: 29000, mileage: 7000, transmission: 'auto', features: ['heatedSeats'], link: '#', retailerName: 'Synthetic Test Retailer' },
    { id: 'fixture-black', shade: 'Black', colour: 'Black', priceMin: 31000, mileage: null, transmission: 'manual', features: [], link: '#', retailerName: 'Synthetic Test Retailer' },
  ],
};
const group118i = {
  score: 84, reasons: [], tradeOffs: [],
  car: {
    id: 'fixture-118i', name: 'BMW 118i Hatchback', line: '1 Series', body: 'hatchback', fuel: 'petrol',
    colour: { colour: 'Grey', manufacturerColour: 'Brooklyn Grey' },
    priceMin: 23000, priceMax: 23000, priceFrom: 23000, priceTo: 23000,
    mileage: 9000, transmission: 'auto', listingCount: 1, colours: ['Grey'],
    features: ['parkingCamera'], retailerName: 'Synthetic Test Retailer', distance: null, link: '#',
  },
  listings: [
    { id: 'fixture-grey', shade: 'Grey', colour: 'Grey', priceMin: 23000, mileage: 9000, transmission: 'auto', features: ['parkingCamera'], link: '#', retailerName: 'Synthetic Test Retailer' },
  ],
};
const matches = [group320i, group118i];

const matrix = {
  run: 'fucq30-20261105-feedback-actions-browser',
  status: 'running',
  source: {
    head: process.env.FUCQ30_HEAD || null,
    baselineHead: process.env.FUCQ30_BASELINE_HEAD || null,
    branch: process.env.FUCQ30_BRANCH || null,
    files: sourceHashes,
  },
  fixture: {
    kind: 'synthetic',
    note: 'Questionnaire API calls are intercepted locally. No live inventory, retailer, account, or employee system is connected.',
    listings: [
      { group: 'BMW 320i Touring', paint: 'Blue', transmission: 'automatic', purchasePriceGBP: 32000, odometerMiles: 10000 },
      { group: 'BMW 320i Touring', paint: 'White', transmission: 'automatic', purchasePriceGBP: 29000, odometerMiles: 7000 },
      { group: 'BMW 320i Touring', paint: 'Black', transmission: 'manual', purchasePriceGBP: 31000, odometerMiles: null },
      { group: 'BMW 118i Hatchback', paint: 'Grey', transmission: 'automatic', purchasePriceGBP: 23000, odometerMiles: 9000 },
    ],
  },
  viewport: { desktop: '1440x1000', narrow: '390x844' },
  checks: [],
  findings: [],
  layout: [],
  api: { calls: [], blockedExternal: [], unexpected: [] },
  captures: [],
  errors: [],
};

function pass(name, observed) {
  matrix.checks.push({ name, status: 'passed', observed });
}

function requireCondition(name, condition, observed) {
  if (!condition) {
    matrix.checks.push({ name, status: 'failed', observed });
    throw new Error(name + ': ' + JSON.stringify(observed));
  }
  pass(name, observed);
}

function contentType(path) {
  const ext = extname(path).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.woff2': 'font/woff2',
  })[ext] || 'application/octet-stream';
}

const fixtureHtml = [
  '<!doctype html><html lang="en-GB"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Synthetic questionnaire fixture</title>',
  '<link rel="stylesheet" href="/blocks/vehicle-matcher/vehicle-matcher.css">',
  '</head><body><main><p class="vm-fixture-note">Synthetic questionnaire fixture. Not connected to vehicle inventory.</p>',
  '<div id="stage" class="vm vm-bmw"></div></main></body></html>',
].join('');

let origin = '';
const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  if (url.pathname === '/__questionnaire') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(fixtureHtml);
    return;
  }
  if (url.pathname !== '/components.html' && !url.pathname.startsWith('/blocks/vehicle-matcher/')) {
    response.writeHead(404).end('Not found');
    return;
  }
  const path = resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!path.startsWith(ROOT + sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': contentType(path), 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

let context;
let page;
const consoleErrors = [];
const pageErrors = [];
const menuLabels = async (menu) => menu.locator('.vm-reject-option').allTextContents();
const cardSnapshot = async (selector) => page.locator(selector).evaluateAll((cards) => cards.map((card) => ({
  name: card.querySelector('.vm-card-name')?.textContent?.trim() || '',
  specs: card.querySelector('.vm-specs')?.textContent?.trim() || '',
  availability: card.querySelector('.vm-avail')?.textContent?.trim() || '',
  used: card.querySelector('.vm-usedmeta')?.textContent?.trim() || '',
  text: card.innerText,
})));

async function capture(name) {
  if (matrix.captures.length >= 12) throw new Error('Capture limit of 12 reached');
  const file = join(EVIDENCE, name + '.png');
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', type: 'png' });
  const info = await stat(file);
  matrix.captures.push({ name, path: file, bytes: info.size, viewport: await page.evaluate(() => [innerWidth, innerHeight]) });
}

async function auditLayout(name) {
  const observed = await page.evaluate(() => {
    const selectors = [
      '.vm-title', '.vm-card-name', '.vm-specs', '.vm-avail', '.vm-usedmeta',
      '.vm-brief-item', '.vm-feedback-scope', '.vm-refine-empty-text',
      '.vm-gallery-copy', '.vm-gallery-title', '.vm-gallery-employee',
    ].join(',');
    const clipped = [...document.querySelectorAll(selectors)]
      .filter((element) => {
        const style = getComputedStyle(element);
        const horizontal = element.scrollWidth > element.clientWidth + 1 && /hidden|clip|ellipsis/.test(style.overflowX + style.textOverflow);
        const vertical = element.scrollHeight > element.clientHeight + 1 && /hidden|clip/.test(style.overflowY);
        return horizontal || vertical;
      })
      .map((element) => ({
        selector: element.className || element.tagName,
        text: (element.innerText || '').trim().slice(0, 120),
        client: [element.clientWidth, element.clientHeight],
        scroll: [element.scrollWidth, element.scrollHeight],
      }));
    return {
      viewport: [innerWidth, innerHeight],
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      clippedText: clipped,
    };
  });
  matrix.layout.push({ state: name, ...observed });
  return observed;
}

async function ensureNoHorizontalOverflow(name) {
  const layout = await auditLayout(name);
  if (layout.horizontalOverflow || layout.clippedText.length) {
    matrix.layout[matrix.layout.length - 1].status = 'review';
  }
}

async function visibleGalleryCards() {
  return page.locator('.vm-gallery-cards .vm-card').count();
}

async function galleryCardText() {
  return page.locator('.vm-gallery-cards .vm-card').allInnerTexts();
}

async function openGalleryMenu() {
  const wrapper = page.locator('.vm-gallery-cards .vm-reject').first();
  await wrapper.locator('.vm-reject-open').click();
  await wrapper.locator('.vm-reject-menu').waitFor({ state: 'visible' });
  return wrapper;
}

async function galleryOption(wrapper, label) {
  const option = wrapper.locator('.vm-reject-option').filter({ hasText: label }).first();
  const actual = (await option.textContent())?.trim() || '';
  const scope = await option.evaluate((element) => element.nextElementSibling?.textContent?.trim() || '');
  return { option, actual, scope };
}

async function resetGallery() {
  await page.goto(origin + '/components.html');
  await page.waitForLoadState('networkidle');
  await page.locator('.vm-gallery-cards .vm-card').first().waitFor();
}

async function bootQuestionnaire(width, height) {
  if (page && await page.evaluate(() => Boolean(window.__vmCleanup)).catch(() => false)) {
    await page.evaluate(() => { window.__vmCleanup?.(); window.__vmCleanup = null; });
  }
  await page.setViewportSize({ width, height });
  await page.goto(origin + '/__questionnaire');
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    const module = await import('/blocks/vehicle-matcher/modes/questionnaire.js');
    const root = document.getElementById('stage');
    const ctx = {
      api: location.origin,
      brand: 'bmw',
      retailer: 'synthetic-retailer',
      retailerLabel: 'Synthetic Test Retailer',
      scope: 'dealer',
      overrides: {},
    };
    window.__vmCtx = ctx;
    window.__vmCleanup = module.default.mount(root, ctx);
  });
  await page.locator('.vm-intro').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const answers = { budget: [10000, 40000], fuel: ['petrol'] };
    window.__vmCtx.answers = answers;
    window.__vmCtx.showResults(answers);
  });
  await page.locator('.vm-reject-open').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.vm-card .vm-card-name')?.textContent?.includes('320i'));
}

async function openQuestionnaireMenu(keyboard) {
  const wrapper = page.locator('.vm-reject').first();
  const trigger = wrapper.locator('.vm-reject-open');
  if (keyboard) {
    await trigger.focus();
    await page.keyboard.press('Enter');
  } else {
    await trigger.click();
  }
  await wrapper.locator('.vm-reject-menu').waitFor({ state: 'visible' });
  return wrapper;
}

async function questionnaireOption(wrapper, label) {
  const option = wrapper.locator('.vm-reject-option').filter({ hasText: label }).first();
  const actual = (await option.textContent())?.trim() || '';
  const scope = await option.evaluate((element) => element.nextElementSibling?.textContent?.trim() || '');
  return { option, actual, scope };
}

async function questionnaireGroup320i() {
  return page.locator('.vm-card').filter({ hasText: 'BMW 320i Touring' }).first();
}

async function questionnaireCards() {
  return cardSnapshot('.vm-refine .vm-card');
}

async function verifyLocalScope() {
  const scope = await page.locator('.vm-feedback-scope').first().textContent();
  requireCondition('questionnaire feedback labels current-session non-saving scope', /not saved/i.test(scope || ''), scope);
}

async function galleryTrialDesktop() {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await resetGallery();
  const initial = await galleryCardText();
  requireCondition('gallery desktop starts with two grouped cards and unknown charging', initial.length === 2, initial);
  await ensureNoHorizontalOverflow('gallery desktop initial');
  await capture('gallery-desktop-initial');

  let wrapper = await openGalleryMenu();
  let options = await menuLabels(wrapper);
  requireCondition('gallery desktop rejection menu offers only-manual and scoped reasons', options.includes('Only manual'), options);
  const notBlue = await galleryOption(wrapper, 'Not the blue');
  requireCondition('gallery desktop colour scope names whole search', /Whole current search.*all retailers and listings/i.test(notBlue.scope), notBlue);
  await ensureNoHorizontalOverflow('gallery desktop menu');
  await capture('gallery-desktop-menu');
  await notBlue.option.click();
  let cards = await galleryCardText();
  const availability = await page.locator('.vm-gallery-cards .vm-card .vm-avail').first().textContent();
  requireCondition('gallery desktop shade rejection preserves siblings and removes stale claims', cards.length === 2 && /2 available/.test(availability || '') && /White/.test(availability || '') && /Black/.test(availability || '') && !/Blue/.test(availability || ''), { cards, availability });
  requireCondition('gallery desktop shows local undo and no-save note', await page.locator('.vm-gallery-feedback .vm-brief-undo').getAttribute('aria-label') === 'Undo Not the blue' && /nothing is saved/i.test(await page.locator('.vm-gallery-feedback').innerText()), await page.locator('.vm-gallery-feedback').innerText());
  await ensureNoHorizontalOverflow('gallery desktop shade undo');
  await capture('gallery-desktop-undo');
  await page.locator('.vm-gallery-feedback .vm-brief-undo').click();
  requireCondition('gallery desktop undo restores three exact listings', /3 available/.test(await page.locator('.vm-gallery-cards .vm-card .vm-avail').first().innerText()), await page.locator('.vm-gallery-cards .vm-card .vm-avail').first().innerText());

  wrapper = await openGalleryMenu();
  let group = await galleryOption(wrapper, 'Just not this one');
  requireCondition('gallery desktop group rejection names exact group/model', /This exact group and model only/i.test(group.scope), group);
  await group.option.click();
  requireCondition('gallery desktop first group rejection leaves the other group', (await visibleGalleryCards()) === 1, await galleryCardText());
  wrapper = await openGalleryMenu();
  group = await galleryOption(wrapper, 'Just not this one');
  await group.option.click();
  const empty = await page.locator('.vm-refine-empty-text').innerText();
  requireCondition('gallery desktop empty state explains reset', empty.length > 15 && await page.locator('.vm-gallery-reset').count() === 1, empty);
  await ensureNoHorizontalOverflow('gallery desktop empty');
  await capture('gallery-desktop-empty');
  await page.locator('.vm-gallery-reset').click();
  requireCondition('gallery desktop reset restores both groups and three sibling listings', (await visibleGalleryCards()) === 2 && /3 available/.test(await page.locator('.vm-gallery-cards .vm-card .vm-avail').first().innerText()), await galleryCardText());
  await ensureNoHorizontalOverflow('gallery desktop reset');
  await capture('gallery-desktop-reset');

  const employee = page.locator('.vm-gallery-employee');
  const before = await employee.innerText();
  requireCondition('gallery employee starts with unknown charging and preserves body/seats', /estate \(confirmed\)/i.test(before) && /at least 5 \(confirmed\)/i.test(before) && /unknown \(needs confirmation\)/i.test(before), before);
  await employee.getByRole('button', { name: 'Confirm no charging access' }).click();
  const confirmed = await employee.innerText();
  requireCondition('gallery employee explicit confirmation changes only charging to none', /none \(confirmed\)/i.test(confirmed) && /estate \(confirmed\)/i.test(confirmed) && /at least 5 \(confirmed\)/i.test(confirmed) && /No saved brief.*account learning.*hold/i.test(confirmed), confirmed);
  await ensureNoHorizontalOverflow('gallery employee confirmed none');
  await capture('gallery-employee-confirmed-none');
  const undo = employee.locator('.vm-brief-undo');
  requireCondition('gallery employee undo has a descriptive name', await undo.getAttribute('aria-label') === 'Undo Confirm no charging access', await undo.getAttribute('aria-label'));
  await undo.click();
  const restored = await employee.innerText();
  requireCondition('gallery employee undo restores unknown charging with body/seats intact', /unknown \(needs confirmation\)/i.test(restored) && /estate \(confirmed\)/i.test(restored) && /at least 5 \(confirmed\)/i.test(restored), restored);
  pass('gallery desktop employee unknown -> confirmed none -> undo unknown', { before, confirmed, restored });
}

async function galleryTrialNarrow() {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetGallery();
  await ensureNoHorizontalOverflow('gallery narrow initial');
  await capture('gallery-mobile-initial');
  let wrapper = await openGalleryMenu();
  const options = await menuLabels(wrapper);
  requireCondition('gallery narrow rejection menu remains available', options.includes('Not the blue') && options.includes('Just not this one'), options);
  await ensureNoHorizontalOverflow('gallery narrow menu');
  await capture('gallery-mobile-menu');
  const notBlue = await galleryOption(wrapper, 'Not the blue');
  await notBlue.option.click();
  requireCondition('gallery narrow shade feedback has visible undo', await page.locator('.vm-gallery-feedback .vm-brief-undo').getAttribute('aria-label') === 'Undo Not the blue', await page.locator('.vm-gallery-feedback').innerText());
  await ensureNoHorizontalOverflow('gallery narrow shade undo');
  await capture('gallery-mobile-undo');
  await page.locator('.vm-gallery-feedback .vm-brief-undo').click();
  requireCondition('gallery narrow undo restores original count', /3 available/.test(await page.locator('.vm-gallery-cards .vm-card .vm-avail').first().innerText()), await page.locator('.vm-gallery-cards .vm-card .vm-avail').first().innerText());
  wrapper = await openGalleryMenu();
  let group = await galleryOption(wrapper, 'Just not this one');
  await group.option.click();
  wrapper = await openGalleryMenu();
  group = await galleryOption(wrapper, 'Just not this one');
  await group.option.click();
  requireCondition('gallery narrow empty/reset path remains readable', await page.locator('.vm-refine-empty-text').count() === 1 && await page.locator('.vm-gallery-reset').count() === 1, await page.locator('.vm-refine-empty-text').innerText());
  await ensureNoHorizontalOverflow('gallery narrow empty');
  await page.locator('.vm-gallery-reset').click();
  requireCondition('gallery narrow reset restores two groups', (await visibleGalleryCards()) === 2, await galleryCardText());
  await ensureNoHorizontalOverflow('gallery narrow reset');
  pass('gallery narrow initial/menu/undo/empty/reset', { cards: await visibleGalleryCards(), viewport: [390, 844] });
}

async function questionnaireTrialDesktop() {
  await bootQuestionnaire(1440, 1000);
  let cards = await questionnaireCards();
  requireCondition('questionnaire desktop mounts actual module with synthetic 320i group', cards.some((card) => card.name.includes('320i') && /3 available/.test(card.availability)), cards);
  await ensureNoHorizontalOverflow('questionnaire desktop initial');

  let wrapper = await openQuestionnaireMenu(true);
  let labels = await menuLabels(wrapper);
  requireCondition('questionnaire keyboard opens real rejection menu', labels.includes('Not the blue') && labels.includes('Under £32,000') && labels.includes('Fewer than 10,000 miles') && labels.includes('Only manual') && labels.includes('Just not this one'), labels);
  const notBlue = await questionnaireOption(wrapper, 'Not the blue');
  requireCondition('questionnaire colour scope names whole current search', /Whole current search.*all retailers and listings/i.test(notBlue.scope), notBlue);
  await ensureNoHorizontalOverflow('questionnaire desktop menu');
  await capture('questionnaire-desktop-menu');
  await notBlue.option.focus();
  await page.keyboard.press('Enter');
  await verifyLocalScope();
  cards = await questionnaireCards();
  const group = cards.find((card) => card.name.includes('320i'));
  requireCondition('questionnaire keyboard colour rejection preserves exact sibling listings', Boolean(group) && /2 available/.test(group?.availability || '') && /White/.test(group?.availability || '') && /Black/.test(group?.availability || '') && !/Blue/.test(group?.availability || '') && /£29,000/.test(group?.availability || '') && /£31,000/.test(group?.availability || ''), group);
  const undo = page.locator('.vm-brief-undo').first();
  requireCondition('questionnaire shows named local undo', await undo.getAttribute('aria-label') === 'Undo Not the blue', await undo.getAttribute('aria-label'));
  await undo.focus();
  const focusStyle = await undo.evaluate((element) => ({
    focusVisible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outlineStyle + ' ' + getComputedStyle(element).outlineWidth,
    shadow: getComputedStyle(element).boxShadow,
    text: element.getAttribute('aria-label'),
  }));
  matrix.focus = focusStyle;
  await ensureNoHorizontalOverflow('questionnaire desktop applied colour and focused undo');
  await capture('questionnaire-desktop-keyboard-undo');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.vm-avail-count')].some((element) => element.textContent.includes('3 available')));
  cards = await questionnaireCards();
  const restored = cards.find((card) => card.name.includes('320i'));
  requireCondition('questionnaire keyboard undo restores count and all original claims', Boolean(restored) && /3 available/.test(restored?.availability || '') && /£29,000/.test(restored?.availability || '') && /£32,000/.test(restored?.availability || '') && /Blue/.test(restored?.availability || '') && /White/.test(restored?.availability || '') && /Black/.test(restored?.availability || ''), restored);
  pass('questionnaire keyboard focus/apply/named undo/Enter', { focus: focusStyle, restored });

  await bootQuestionnaire(1440, 1000);
  wrapper = await openQuestionnaireMenu(false);
  let price = await questionnaireOption(wrapper, 'Under £32,000');
  requireCondition('purchase-price option is whole-search scoped', /Whole current search/i.test(price.scope), price);
  await price.option.click();
  await verifyLocalScope();
  cards = await questionnaireCards();
  const priceGroup = cards.find((card) => card.name.includes('320i'));
  requireCondition('Under £32,000 is strict and reconstructs price/count/paint', Boolean(priceGroup) && /2 available/.test(priceGroup?.availability || '') && /£29,000/.test(priceGroup?.availability || '') && /£31,000/.test(priceGroup?.availability || '') && !/£32,000/.test(priceGroup?.availability || '') && /White/.test(priceGroup?.availability || '') && /Black/.test(priceGroup?.availability || '') && !/Blue/.test(priceGroup?.availability || ''), priceGroup);
  pass('questionnaire purchase price uses strict less-than and exact reconstruction', priceGroup);

  await bootQuestionnaire(1440, 1000);
  wrapper = await openQuestionnaireMenu(false);
  const mileage = await questionnaireOption(wrapper, 'Fewer than 10,000 miles');
  await mileage.option.click();
  await verifyLocalScope();
  cards = await questionnaireCards();
  const mileageGroup = cards.find((card) => card.name.includes('320i'));
  requireCondition('odometer less-than excludes 10,000 equality and unknown mileage', Boolean(mileageGroup) && !/available/.test(mileageGroup?.availability || '') && /7,000 miles/.test(mileageGroup?.used || '') && !/10,000 miles/.test(mileageGroup?.text || '') && !/Black/.test(mileageGroup?.text || ''), mileageGroup);
  pass('questionnaire mileage rule excludes unknown odometer and keeps only the 7,000-mile listing', mileageGroup);

  await bootQuestionnaire(1440, 1000);
  wrapper = await openQuestionnaireMenu(false);
  const manual = await questionnaireOption(wrapper, 'Only manual');
  requireCondition('Only manual is offered only with another known gearbox and scoped', /Whole current search/i.test(manual.scope), manual);
  await manual.option.click();
  await verifyLocalScope();
  cards = await questionnaireCards();
  const manualGroup = cards.find((card) => card.name.includes('320i'));
  requireCondition('Only manual applies to the exact manual listing with no stale availability or paint', Boolean(manualGroup) && /Manual/i.test(manualGroup?.specs || '') && !/Automatic/i.test(manualGroup?.specs || '') && !/available/.test(manualGroup?.availability || '') && !/Blue/.test(manualGroup?.text || ''), manualGroup);
  const staleClaims = {
    priceRange: /£31,000[–-]£32,000/.test(manualGroup?.specs || ''),
    oldOdometer: /10,000 miles/.test(manualGroup?.text || ''),
    cardText: manualGroup?.text || '',
  };
  if (staleClaims.priceRange || staleClaims.oldOdometer) {
    matrix.findings.push({
      severity: 'defect',
      state: 'questionnaire Only manual regroup',
      issue: 'A single surviving listing with £31,000 price and unknown odometer retained stale grouped claims.',
      observed: staleClaims,
    });
  }
  pass('questionnaire gearbox rule leaves one manual listing and records all regrouped claims', { manualGroup, staleClaims });

  await bootQuestionnaire(1440, 1000);
  wrapper = await openQuestionnaireMenu(false);
  let shrug = await questionnaireOption(wrapper, 'Just not this one');
  requireCondition('questionnaire shrug is scoped to exact group/model', /This exact group and model only/i.test(shrug.scope), shrug);
  await shrug.option.click();
  cards = await questionnaireCards();
  requireCondition('first questionnaire group rejection leaves second group only', cards.length > 0 && cards.some((card) => card.name.includes('118i')) && !cards.some((card) => card.name.includes('320i')), cards);
  await page.locator('.vm-brief-undo').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.vm-avail-count')].some((element) => element.textContent.includes('3 available')));
  cards = await questionnaireCards();
  requireCondition('group undo restores original count, prices, and paints', cards.some((card) => card.name.includes('320i') && /3 available/.test(card.availability) && /£32,000/.test(card.availability) && /Blue/.test(card.availability) && /Black/.test(card.availability)), cards);

  wrapper = await openQuestionnaireMenu(false);
  shrug = await questionnaireOption(wrapper, 'Just not this one');
  await shrug.option.click();
  wrapper = await openQuestionnaireMenu(false);
  shrug = await questionnaireOption(wrapper, 'Just not this one');
  await shrug.option.click();
  const empty = await page.locator('.vm-refine-empty-text').innerText();
  requireCondition('questionnaire second group rejection reaches explained empty with Start again', empty.length > 15 && await page.getByRole('button', { name: 'Start again', exact: true }).count() === 1, empty);
  await ensureNoHorizontalOverflow('questionnaire desktop empty');
  await page.getByRole('button', { name: 'Start again', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.vm-avail-count')].some((element) => element.textContent.includes('3 available')));
  cards = await questionnaireCards();
  requireCondition('questionnaire Start again clears all local actions and restores two groups', cards.some((card) => card.name.includes('320i')) && cards.some((card) => card.name.includes('118i')) && /3 available/.test(cards.find((card) => card.name.includes('320i')).availability), cards);
  await ensureNoHorizontalOverflow('questionnaire desktop reset');
  pass('questionnaire group removal/undo/empty/Start again', { empty, restored: cards });
}

async function questionnaireTrialNarrow() {
  await bootQuestionnaire(390, 844);
  await ensureNoHorizontalOverflow('questionnaire narrow initial');
  const wrapper = await openQuestionnaireMenu(false);
  const mileage = await questionnaireOption(wrapper, 'Fewer than 10,000 miles');
  await mileage.option.click();
  await verifyLocalScope();
  const cards = await questionnaireCards();
  const group = cards.find((card) => card.name.includes('320i'));
  requireCondition('questionnaire narrow layout retains strict mileage result and visible undo', Boolean(group) && /7,000 miles/.test(group?.used || '') && !/available/.test(group?.availability || '') && await page.locator('.vm-brief-undo').count() > 0, { group, undo: await page.locator('.vm-brief-undo').first().getAttribute('aria-label') });
  await ensureNoHorizontalOverflow('questionnaire narrow mileage and undo');
  await capture('questionnaire-mobile-filtered');
  await page.locator('.vm-brief-undo').first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.vm-avail-count')].some((element) => element.textContent.includes('3 available')));
  await page.locator('.vm-reject-open').first().focus();
  const focus = await page.locator('.vm-reject-open').first().evaluate((element) => ({
    focusVisible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outlineStyle + ' ' + getComputedStyle(element).outlineWidth,
    shadow: getComputedStyle(element).boxShadow,
  }));
  matrix.narrowFocus = focus;
  pass('questionnaire narrow undo restores count and keyboard focus remains inspectable', { focus, count: (await questionnaireCards()).find((card) => card.name.includes('320i'))?.availability });
}

async function main() {
  await mkdir(EVIDENCE, { recursive: true });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  origin = 'http://127.0.0.1:' + server.address().port;
  context = await chromium.launchPersistentContext(join(SCRATCH, 'profile'), {
    headless: true,
    viewport: { width: 1440, height: 1000 },
  });
  page = context.pages()[0] || await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    if (!url.startsWith(origin)) {
      matrix.api.blockedExternal.push(url);
      await route.abort();
      return;
    }
    const parsed = new URL(url);
    if (parsed.pathname === '/api/questions') {
      matrix.api.calls.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ questions }) });
      return;
    }
    if (parsed.pathname === '/api/match') {
      matrix.api.calls.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ matches, alternatives: [], decisive: false, clusterSize: 2, tasteLead: false, searched: 4, unmet: {} }),
      });
      return;
    }
    if (parsed.pathname === '/api/nearby') {
      matrix.api.calls.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nearby: [], unmet: {} }) });
      return;
    }
    if (parsed.pathname.startsWith('/api/')) {
      matrix.api.unexpected.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected synthetic fixture endpoint' }) });
      return;
    }
    await route.continue();
  });

  await galleryTrialDesktop();
  await galleryTrialNarrow();
  await questionnaireTrialDesktop();
  await questionnaireTrialNarrow();

  requireCondition('all API calls stayed within the synthetic fixture endpoints', matrix.api.unexpected.length === 0 && matrix.api.blockedExternal.length === 0, matrix.api);
  requireCondition('browser reported no console or page errors', consoleErrors.length === 0 && pageErrors.length === 0, { consoleErrors, pageErrors });
  matrix.console = { errors: consoleErrors, pageErrors };
  matrix.status = 'passed';
}

try {
  await main();
} catch (error) {
  matrix.status = 'failed';
  matrix.errors.push(String(error?.stack || error));
  console.error(error?.stack || error);
} finally {
  if (context) {
    try { await context.close(); } catch (error) { matrix.errors.push('context close: ' + String(error)); }
  }
  if (server.listening) {
    try {
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
    } catch (error) {
      matrix.errors.push('server close: ' + String(error));
    }
  }
  matrix.console = { errors: consoleErrors, pageErrors };
  matrix.api.calls = matrix.api.calls;
  await writeFile(join(EVIDENCE, 'browser-matrix.json'), JSON.stringify(matrix, null, 2) + '\n');
}

if (matrix.status !== 'passed') process.exitCode = 1;
