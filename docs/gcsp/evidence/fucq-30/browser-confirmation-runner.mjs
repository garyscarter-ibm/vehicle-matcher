import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const EVIDENCE = resolve(ROOT, 'docs/gcsp/evidence/fucq-30');
const SCRATCH = process.env.FUCQ30_SCRATCH;
const RUN = 'fucq30-20261105-feedback-actions-browser-confirmation-retry1';
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
  'blocks/vehicle-matcher/modes/brand-copy.js',
  'blocks/vehicle-matcher/modes/preview-feed.js',
  'blocks/vehicle-matcher/quiz-meta.js',
  'blocks/vehicle-matcher/ui.js',
  'blocks/vehicle-matcher/share-context.js',
  'blocks/vehicle-matcher/component-gallery.js',
  'blocks/vehicle-matcher/vehicle-matcher.css',
  'blocks/vehicle-matcher/component-gallery.css',
  'blocks/vehicle-matcher/tokens.css',
  'components.html',
  'server/questions.js',
];
const round1Pngs = [
  'gallery-desktop-initial.png',
  'gallery-mobile-initial.png',
  'questionnaire-desktop-keyboard-undo.png',
  'questionnaire-mobile-filtered.png',
];
const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const sourceHashes = {};
for (const file of SOURCE_FILES) sourceHashes[file] = await sha256(join(ROOT, file));

const questions = questionsForBrand('bmw').filter((question) => ['budget', 'fuel'].includes(question.id));
const groups = [
  {
    score: 88, reasons: [], tradeOffs: [],
    car: {
      id: 'fixture-320i', name: 'BMW 320i Touring', line: '3 Series', body: 'estate', fuel: 'petrol',
      colour: { colour: 'Blue', manufacturerColour: 'Portimao Blue' },
      priceMin: 29000, priceMax: 32000, priceFrom: 29000, priceTo: 32000,
      mileage: 10000, transmission: 'auto', listingCount: 3, colours: ['Blue', 'White', 'Black'],
      features: ['heatedSeats'], retailerName: 'Synthetic Test Retailer', distance: null, link: '#',
      zeroTo62: null, mpg: null, evRange: null,
    },
    listings: [
      { id: 'fixture-blue', shade: 'Blue', colour: 'Blue', priceMin: 32000, mileage: 10000, transmission: 'auto', features: ['heatedSeats'], link: '#', retailerName: 'Synthetic Test Retailer' },
      { id: 'fixture-white', shade: 'White', colour: 'White', priceMin: 29000, mileage: 7000, transmission: 'auto', features: ['heatedSeats'], link: '#', retailerName: 'Synthetic Test Retailer' },
      { id: 'fixture-black', shade: 'Black', colour: 'Black', priceMin: 31000, mileage: null, transmission: 'manual', features: [], link: '#', retailerName: 'Synthetic Test Retailer' },
    ],
  },
  {
    score: 84, reasons: [], tradeOffs: [],
    car: {
      id: 'fixture-118i', name: 'BMW 118i Hatchback', line: '1 Series', body: 'hatchback', fuel: 'petrol',
      colour: { colour: 'Grey', manufacturerColour: 'Brooklyn Grey' },
      priceMin: 23000, priceMax: 23000, priceFrom: 23000, priceTo: 23000,
      mileage: 9000, transmission: 'auto', listingCount: 1, colours: ['Grey'],
      features: ['parkingCamera'], retailerName: 'Synthetic Test Retailer', distance: null, link: '#',
      zeroTo62: null, mpg: null, evRange: null,
    },
    listings: [
      { id: 'fixture-grey', shade: 'Grey', colour: 'Grey', priceMin: 23000, mileage: 9000, transmission: 'auto', features: ['parkingCamera'], link: '#', retailerName: 'Synthetic Test Retailer' },
    ],
  },
];

const matrix = {
  run: RUN,
  status: 'running',
  source: { head: process.env.FUCQ30_HEAD || null, branch: process.env.FUCQ30_BRANCH || null, files: sourceHashes },
  reusedRound1: {
    matrix: join(EVIDENCE, 'browser-matrix.json'),
    interactionChecks: 51,
    layoutSnapshots: 18,
    reason: 'Only the reconstruction helper, shared result-card technical-data rendering, and related fixtures changed; parent authorized one affected confirmation round.',
  },
  fixture: {
    kind: 'synthetic',
    note: 'Only local API stubs are used. The browser is not connected to live vehicle inventory.',
    searched: { total: 4, eligible: 4, margin: 4 },
    listings: [
      { group: 'BMW 320i Touring', paint: 'Blue', transmission: 'automatic', purchasePriceGBP: 32000, odometerMiles: 10000 },
      { group: 'BMW 320i Touring', paint: 'White', transmission: 'automatic', purchasePriceGBP: 29000, odometerMiles: 7000 },
      { group: 'BMW 320i Touring', paint: 'Black', transmission: 'manual', purchasePriceGBP: 31000, odometerMiles: null },
      { group: 'BMW 118i Hatchback', paint: 'Grey', transmission: 'automatic', purchasePriceGBP: 23000, odometerMiles: 9000 },
    ],
    optionalTechnicalNumbers: null,
  },
  checks: [],
  layout: [],
  captures: [],
  replacedRound1Captures: {},
  api: { calls: [], blockedExternal: [], unexpected: [] },
  console: { errors: [], pageErrors: [] },
  findings: [],
};

function requireCondition(name, condition, observed) {
  matrix.checks.push({ name, status: condition ? 'passed' : 'failed', observed });
  if (!condition) throw new Error(name + ': ' + JSON.stringify(observed));
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
  if (url.pathname === '/favicon.ico') return response.writeHead(204).end();
  if (url.pathname === '/__questionnaire') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return response.end(fixtureHtml);
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
const byText = (locator, text) => locator.filter({ hasText: text }).first();
const summaryFor = async (selector) => page.locator(selector).evaluateAll((elements) => elements.map((element) => ({
  name: element.querySelector('.vm-card-name')?.textContent?.trim() || '',
  specs: element.querySelector('.vm-specs')?.textContent?.trim() || '',
  availability: element.querySelector('.vm-avail')?.textContent?.trim() || '',
  used: element.querySelector('.vm-usedmeta')?.textContent?.trim() || '',
  text: element.innerText,
})));

async function auditLayout(name) {
  const result = await page.evaluate(() => {
    const selectors = '.vm-title,.vm-card-name,.vm-specs,.vm-avail,.vm-usedmeta,.vm-brief-item,.vm-feedback-scope,.vm-gallery-copy,.vm-gallery-title';
    const clipped = [...document.querySelectorAll(selectors)].filter((element) => {
      const style = getComputedStyle(element);
      return (element.scrollWidth > element.clientWidth + 1 && /hidden|clip|ellipsis/.test(style.overflowX + style.textOverflow))
        || (element.scrollHeight > element.clientHeight + 1 && /hidden|clip/.test(style.overflowY));
    }).map((element) => ({
      selector: element.className || element.tagName,
      text: (element.innerText || '').trim().slice(0, 100),
      client: [element.clientWidth, element.clientHeight],
      scroll: [element.scrollWidth, element.scrollHeight],
    }));
    return { viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1, clippedText: clipped };
  });
  matrix.layout.push({ state: name, ...result });
  requireCondition(name + ' has no horizontal overflow or clipped text', !result.horizontalOverflow && !result.clippedText.length, result);
}

async function capture(name) {
  const path = join(EVIDENCE, name);
  if (!Object.hasOwn(matrix.replacedRound1Captures, name)) {
    matrix.replacedRound1Captures[name] = await sha256(path);
  }
  await page.screenshot({ path, fullPage: true, animations: 'disabled', type: 'png' });
  const info = await stat(path);
  matrix.captures.push({ name, path, bytes: info.size, sha256: await sha256(path), viewport: await page.evaluate(() => [innerWidth, innerHeight]) });
}

async function galleryCheck(width, height, captureName, label) {
  await page.setViewportSize({ width, height });
  await page.goto(origin + '/components.html');
  await page.waitForLoadState('networkidle');
  await page.locator('.vm-gallery-cards .vm-card').first().waitFor();
  const initialText = await page.locator('.vm-gallery-cards').innerText();
  requireCondition(label + ' gallery renders two cards without undefined/null technical copy',
    (await page.locator('.vm-gallery-cards .vm-card').count()) === 2 && !/\b(undefined|null|NaN)\b/i.test(initialText), initialText);
  const employee = await page.locator('.vm-gallery-employee').innerText();
  requireCondition(label + ' gallery keeps five-seat essential and unknown charging distinct',
    /at least 5 \(confirmed\)/i.test(employee) && /unknown \(needs confirmation\)/i.test(employee), employee);
  await auditLayout(label + ' gallery initial');
  await capture(captureName);

  const wrapper = page.locator('.vm-gallery-cards .vm-reject').first();
  const trigger = wrapper.locator('.vm-reject-open');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const option = byText(wrapper.locator('.vm-reject-option'), 'Not the blue');
  const scope = await option.evaluate((element) => element.nextElementSibling?.textContent?.trim() || '');
  requireCondition(label + ' gallery shade reason names whole current search', /Whole current search.*all retailers and listings/i.test(scope), scope);
  await option.focus();
  await page.keyboard.press('Enter');
  const undo = page.locator('.vm-gallery-feedback .vm-brief-undo').first();
  requireCondition(label + ' gallery has named Undo and no undefined claims after regroup',
    await undo.getAttribute('aria-label') === 'Undo Not the blue'
      && !/\b(undefined|null|NaN)\b/i.test(await page.locator('.vm-gallery-cards').innerText()),
    { undo: await undo.getAttribute('aria-label'), cards: await page.locator('.vm-gallery-cards').innerText() });
  await undo.focus();
  const focus = await undo.evaluate((element) => ({ focusVisible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outlineStyle + ' ' + getComputedStyle(element).outlineWidth }));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /3 available/.test(document.querySelector('.vm-gallery-cards .vm-avail')?.textContent || ''));
  requireCondition(label + ' gallery keyboard Undo restores three listings', /3 available/.test(await page.locator('.vm-gallery-cards .vm-avail').first().innerText()), { focus, availability: await page.locator('.vm-gallery-cards .vm-avail').first().innerText() });
}

async function bootQuestionnaire(width, height, trial) {
  if (page && await page.evaluate(() => Boolean(window.__vmCleanup)).catch(() => false)) {
    await page.evaluate(() => { window.__vmCleanup?.(); window.__vmCleanup = null; });
  }
  await page.setViewportSize({ width, height });
  await page.goto(origin + '/__questionnaire?trial=' + trial);
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    const module = await import('/blocks/vehicle-matcher/modes/questionnaire.js');
    const ctx = { api: location.origin, brand: 'bmw', retailer: 'synthetic-retailer',
      retailerLabel: 'Synthetic Test Retailer', scope: 'dealer', overrides: {} };
    window.__vmCtx = ctx;
    window.__vmCleanup = module.default.mount(document.getElementById('stage'), ctx);
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

async function openQuestionnaireMenu() {
  const wrapper = page.locator('.vm-reject').first();
  await wrapper.locator('.vm-reject-open').focus();
  await page.keyboard.press('Enter');
  await wrapper.locator('.vm-reject-menu').waitFor({ state: 'visible' });
  return wrapper;
}

async function questionnaireOption(wrapper, label) {
  const option = byText(wrapper.locator('.vm-reject-option'), label);
  const actual = (await option.textContent())?.trim() || '';
  const scope = await option.evaluate((element) => element.nextElementSibling?.textContent?.trim() || '');
  return { option, actual, scope };
}

async function questionnaireCard(name) {
  return page.locator('.vm-card').filter({ hasText: name }).first().evaluate((element) => ({
    name: element.querySelector('.vm-card-name')?.textContent?.trim() || '',
    specs: element.querySelector('.vm-specs')?.textContent?.trim() || '',
    availability: element.querySelector('.vm-avail')?.textContent?.trim() || '',
    used: element.querySelector('.vm-usedmeta')?.textContent?.trim() || '',
    text: element.innerText,
  }));
}

async function questionnaireManual() {
  await bootQuestionnaire(1440, 1000, 'manual');
  await auditLayout('questionnaire desktop initial');
  const wrapper = await openQuestionnaireMenu();
  const selection = await questionnaireOption(wrapper, 'Only manual');
  requireCondition('Only manual reason is whole-search scoped', /Whole current search.*all retailers and listings/i.test(selection.scope), selection);
  await selection.option.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.vm-brief-undo')?.getAttribute('aria-label') === 'Undo Only manual');
  const card = await questionnaireCard('BMW 320i Touring');
  requireCondition('Only manual retains exact £31,000 Black listing without stale claims or undefined text',
    /Manual/.test(card.specs) && /Black/.test(card.specs) && /£31,000/.test(card.specs)
      && !/£32,000/.test(card.text) && !/10,000 miles/.test(card.text)
      && !/available/.test(card.availability) && !/\b(undefined|null|NaN)\b/i.test(card.text) && !card.used,
    card);
  requireCondition('Only manual undo is named', await page.locator('.vm-brief-undo').first().getAttribute('aria-label') === 'Undo Only manual',
    await page.locator('.vm-brief-undo').first().getAttribute('aria-label'));
  const undo = page.locator('.vm-brief-undo').first();
  await undo.focus();
  const focus = await undo.evaluate((element) => ({ focusVisible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outlineStyle + ' ' + getComputedStyle(element).outlineWidth,
    label: element.getAttribute('aria-label') }));
  requireCondition('keyboard focus is visible on named Undo', focus.focusVisible && /solid 2px/.test(focus.outline), focus);
  await auditLayout('questionnaire desktop Only manual');
  await capture('questionnaire-desktop-keyboard-undo.png');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.vm-avail-count')].some((element) => element.textContent.includes('3 available')));
  const restored = await questionnaireCard('BMW 320i Touring');
  requireCondition('Enter on named Undo restores original price/paint/count claims',
    /3 available/.test(restored.availability) && /£29,000/.test(restored.availability)
      && /£32,000/.test(restored.availability) && /Blue/.test(restored.availability)
      && /White/.test(restored.availability) && /Black/.test(restored.availability),
    restored);
  matrix.checks.push({ name: 'Only manual named Undo focus and Enter restoration', status: 'passed', observed: { focus, restored } });
}

async function questionnaireMileage() {
  await bootQuestionnaire(390, 844, 'mileage');
  const wrapper = await openQuestionnaireMenu();
  const selection = await questionnaireOption(wrapper, 'Fewer than 10,000 miles');
  requireCondition('mileage reason is whole-search scoped', /Whole current search.*all retailers and listings/i.test(selection.scope), selection);
  await selection.option.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.vm-brief-undo')?.getAttribute('aria-label') === 'Undo Fewer than 10,000 miles');
  const card = await questionnaireCard('BMW 320i Touring');
  requireCondition('narrow mileage filter keeps White £29,000 / 7,000-mile listing with no stale or undefined claims',
    /White/.test(card.specs) && /£29,000/.test(card.specs) && !/£32,000/.test(card.text)
      && /7,000 miles/.test(card.used) && !/10,000 miles/.test(card.text)
      && !/available/.test(card.availability) && !/\b(undefined|null|NaN)\b/i.test(card.text),
    card);
  const undo = page.locator('.vm-brief-undo').first();
  requireCondition('narrow mileage feedback has named undo', await undo.getAttribute('aria-label') === 'Undo Fewer than 10,000 miles', await undo.getAttribute('aria-label'));
  await auditLayout('questionnaire narrow fewer than 10000');
  await capture('questionnaire-mobile-filtered.png');
  await undo.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.vm-avail-count')].some((element) => element.textContent.includes('3 available')));
  const restored = await questionnaireCard('BMW 320i Touring');
  requireCondition('narrow mileage Undo restores original three listings and claims', /3 available/.test(restored.availability) && /£32,000/.test(restored.availability) && /Blue/.test(restored.availability) && /Black/.test(restored.availability), restored);
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
  page.on('console', (message) => { if (message.type() === 'error') matrix.console.errors.push(message.text()); });
  page.on('pageerror', (error) => matrix.console.pageErrors.push(error.message));
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
    } else if (parsed.pathname === '/api/match') {
      matrix.api.calls.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ matches: groups, alternatives: [], decisive: false, clusterSize: 2,
          tasteLead: false, searched: { total: 4, eligible: 4, margin: 4 }, unmet: {} }),
      });
    } else if (parsed.pathname === '/api/nearby') {
      matrix.api.calls.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nearby: [], unmet: {} }) });
    } else if (parsed.pathname.startsWith('/api/')) {
      matrix.api.unexpected.push({ path: parsed.pathname, method: request.method() });
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'unexpected synthetic endpoint' }) });
    } else {
      await route.continue();
    }
  });

  const desktopPngCount = (await readdir(EVIDENCE)).filter((name) => name.endsWith('.png')).length;
  requireCondition('round 1 evidence currently has exactly twelve PNG files', desktopPngCount === 12, desktopPngCount);
  await galleryCheck(1440, 1000, 'gallery-desktop-initial.png', 'desktop');
  await galleryCheck(390, 844, 'gallery-mobile-initial.png', 'narrow');
  await questionnaireManual();
  await questionnaireMileage();
  const pngCount = (await readdir(EVIDENCE)).filter((name) => name.endsWith('.png')).length;
  requireCondition('confirmation refreshed only four existing PNG paths and stayed within twelve total', pngCount === 12 && matrix.captures.length === 4, { pngCount, refreshed: matrix.captures.map((capture) => capture.name) });
  requireCondition('confirmation API calls stayed synthetic and local', matrix.api.unexpected.length === 0 && matrix.api.blockedExternal.length === 0, matrix.api);
  requireCondition('confirmation browser reported no console/page errors', matrix.console.errors.length === 0 && matrix.console.pageErrors.length === 0, matrix.console);
  matrix.status = 'passed';
}

try {
  await main();
} catch (error) {
  matrix.status = 'failed';
  matrix.errors = [String(error?.stack || error)];
  console.error(error?.stack || error);
} finally {
  if (context) {
    try { await context.close(); } catch (error) { matrix.errors = [...(matrix.errors || []), 'context close: ' + String(error)]; }
  }
  if (server.listening) {
    try { server.closeAllConnections?.(); await new Promise((resolveClose) => server.close(resolveClose)); }
    catch (error) { matrix.errors = [...(matrix.errors || []), 'server close: ' + String(error)]; }
  }
  await writeFile(join(EVIDENCE, 'browser-confirmation-matrix.json'), JSON.stringify(matrix, null, 2) + '\n');
}

if (matrix.status !== 'passed') process.exitCode = 1;
