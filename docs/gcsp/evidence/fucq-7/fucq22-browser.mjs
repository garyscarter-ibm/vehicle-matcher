// Offline browser proof for FUCQ-22. Requires the installed Playwright dev tool.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { buildServer } from '../../../../server/index.js';
import { StockUnavailableError } from '../../../../server/stock.js';
import { bmwPool } from '../../../../server/test/helpers.js';

const require = createRequire(process.env.PLAYWRIGHT_MODULE || '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const root = resolve(new URL('../../../../', import.meta.url).pathname);
const out = resolve(new URL('./', import.meta.url).pathname);
const report = { source: process.env.FUCQ22_SOURCE || 'unrecorded', checks: [], screenshots: [], externalBlocked: [], pageErrors: [], consoleErrors: [], matchResponses: [] };
const brief = { budget: [10000, 60000], bodyStyles: ['any'], fuel: ['open'], charging: 'none', primaryUse: 'commute', people: 'solo', mileage: 12000, style: '3', priorities: ['economy', 'comfort'] };
const excluded = bmwPool(2).map((car) => ({ ...car, priceMin: 1000000, priceMax: 1000000 }));
let stockState = 'empty';
let release;
let held;
const api = buildServer({
  fetchRetailerStock: async () => {
    if (held) await held;
    if (stockState === 'outage') throw new StockUnavailableError('offline synthetic outage');
    return stockState === 'excluded' ? excluded : [];
  },
  fetchNearbyStock: async () => [],
  enrichColours: async (_brand, cars) => cars,
  fetchDealerDirectory: async () => new Map(),
  geocodePostcode: async () => null,
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const site = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = resolve(root, `.${pathname === '/' ? '/block.html' : pathname}`);
    if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
let browser;
let context;
async function capture(page, state, widthName) {
  const name = `fucq22-${state}-${widthName}.png`;
  await page.screenshot({ path: resolve(out, name), fullPage: true });
  const layout = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, busy: !!document.querySelector('[aria-busy="true"]') }));
  assert.ok(layout.document <= layout.width, `${state}/${widthName}: no horizontal page overflow`);
  report.screenshots.push({ name, state, widthName, layout });
}
async function keyboardTo(page, text) {
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((label) => document.activeElement?.textContent === label, text)) {
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== 'none'), true, `${text} has visible focus`);
      return;
    }
  }
  throw new Error(`Keyboard cannot reach ${text}`);
}
try {
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  site.listen(0, '127.0.0.1'); await once(site, 'listening');
  const apiBase = `http://127.0.0.1:${api.address().port}`;
  const siteBase = `http://127.0.0.1:${site.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(`${siteBase}/`) || url.startsWith(`${apiBase}/`)) return route.continue();
    report.externalBlocked.push(url); return route.abort();
  });
  for (const [widthName, viewport] of [['desktop', { width: 1440, height: 1000 }], ['narrow', { width: 390, height: 844 }]]) {
    const page = await context.newPage(); await page.setViewportSize(viewport); page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    page.on('response', (response) => { if (response.url().endsWith('/api/match')) report.matchResponses.push({ widthName, status: response.status() }); });
    const url = `${siteBase}/block.html?api=${encodeURIComponent(apiBase)}&brand=bmw&mode=questionnaire#m=${Buffer.from(JSON.stringify(brief)).toString('base64url')}`;
    stockState = widthName === 'desktop' ? 'empty' : 'excluded';
    held = new Promise((resolveHeld) => { release = resolveHeld; });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.vm-results-skeleton[aria-busy="true"]').waitFor();
    await capture(page, 'loading', widthName);
    held = null; release();
    await page.getByRole('heading', { name: 'No matches found.', exact: true }).waitFor();
    await page.locator('.vm-nearby-band[aria-busy="true"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.vm-results-skeleton').count(), 0);
    await keyboardTo(page, 'Tweak my answers');
    await capture(page, 'no-match-keyboard', widthName);
    await page.keyboard.press('Enter');
    await page.locator('.vm-question').waitFor();
    await capture(page, 'change-answers', widthName);
    report.checks.push(`${widthName}: real ${stockState} stock response completes, loading clears, keyboard opens answer editing`);
    stockState = 'outage';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'We couldn’t reach the matcher.', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'No matches found.', exact: true }).count(), 0);
    await keyboardTo(page, 'Try again');
    await capture(page, 'outage-retry-keyboard', widthName);
    stockState = 'empty';
    held = new Promise((resolveHeld) => { release = resolveHeld; });
    await page.keyboard.press('Enter');
    await page.locator('.vm-results-skeleton[aria-busy="true"]').waitFor();
    held = null; release();
    await page.getByRole('heading', { name: 'No matches found.', exact: true }).waitFor();
    assert.equal(await page.locator('.vm-results-skeleton').count(), 0);
    await capture(page, 'retry-recovered', widthName);
    report.checks.push(`${widthName}: outage remains an error; keyboard retry reaches normal successful empty response`);
    await page.close();
  }
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalBlocked, []);
  assert.equal(report.matchResponses.filter((item) => item.status === 200).length, 4);
  assert.equal(report.matchResponses.filter((item) => item.status === 502).length, 2);
  assert.ok(report.consoleErrors.every((message) => message.includes('502')), 'only expected injected outage console messages');
  report.success = true;
} finally {
  release?.();
  await context?.close(); await browser?.close();
  api.closeAllConnections(); site.closeAllConnections();
  await Promise.all([new Promise((done) => api.close(done)), new Promise((done) => site.close(done))]);
  await writeFile(resolve(out, 'fucq22-browser.json'), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ success: report.success, checks: report.checks, screenshots: report.screenshots.length, matchResponses: report.matchResponses, pageErrors: report.pageErrors, externalBlocked: report.externalBlocked }));
