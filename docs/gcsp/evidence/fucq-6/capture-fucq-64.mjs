// FUCQ-64 browser evidence: headless system Chrome against `npm run serve` (BASE env).
// Usage: PLAYWRIGHT_CORE=<playwright-core/index.mjs> BASE=http://localhost:3000 node <this file>
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const BASE = process.env.BASE || 'http://localhost:3000';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE);
const SOURCES = ['blocks/gcsp/shell/portal-shell.js', 'blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/shell/gcsp-tokens.css',
  'blocks/gcsp/employee/gcsp-employee.js', 'blocks/gcsp/employee/representative-body.js', 'blocks/gcsp/employee/fixtures.js',
  'blocks/gcsp/employee/gcsp-employee.css', 'blocks/gcsp/employee/harness.js', 'blocks/vehicle-matcher/ui.js',
  'blocks/vehicle-matcher/component-gallery.js', 'gcsp-employee.html', 'components.html'];
const DESKTOP = { width: 1280, height: 900 };
const NARROW = { width: 320, height: 740 };
const results = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function open(path, viewport, opts = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: opts.reducedMotion || 'no-preference' });
  const page = await context.newPage();
  const log = { console: [], failed: [], external: [] };
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    log.external.push(url);
    return route.abort();
  });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) log.console.push(m.text()); });
  page.on('pageerror', (e) => log.console.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) log.failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/${path}`);
  return { page, context, log };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function record(name, page, log, extra = {}, { full = true } = {}) {
  await page.waitForTimeout(400); // let the kit's 0.25s entry animation and tooltip fade settle
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  results.push({ name, file: `${name}.png`, overflowPx: await overflow(page), ...log, ...extra });
}
const ready = (page) => page.waitForSelector('.gcsp-rep .gcsp-card, .gcsp-rep .vm-status', { timeout: 5000 });
const focusInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const cs = getComputedStyle(a);
  return { name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60), outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
});

try {
  for (const [label, vp] of [['desktop', DESKTOP], ['narrow-320', NARROW]]) {
    for (const fixture of ['representative', 'representative-no-images', 'representative-unavailable']) {
      const { page, context, log } = await open(`gcsp-employee.html?fixture=${fixture}`, vp);
      await ready(page);
      const imgs = await page.locator('.gcsp-rep img.vm-card-photo').count();
      await record(`${fixture}-${label}`, page, log, { fixture, viewport: vp, carPhotos: imgs });
      await context.close();
    }
    const { page, context, log } = await open('gcsp-employee.html?fixture=representative-loading', vp);
    await page.waitForSelector('.gcsp-account[aria-busy="true"]', { timeout: 5000 });
    await record(`representative-loading-${label}`, page, log, { fixture: 'representative-loading', viewport: vp }, { full: false });
    await context.close();
  }

  {
    const { page, context, log } = await open('gcsp-employee.html?fixture=representative', DESKTOP);
    await ready(page);
    await page.keyboard.press('Tab');
    await record('keyboard-skip-link-desktop', page, log, { focused: await focusInfo(page) }, { full: false });
    const order = [];
    for (let i = 0; i < 10; i += 1) { order.push(await focusInfo(page)); await page.keyboard.press('Tab'); }
    await page.locator('.gcsp-nav-btn[aria-disabled="true"]').first().focus();
    await record('keyboard-unavailable-nav-desktop', page, log, { focused: await focusInfo(page) }, { full: false });
    await page.locator('.gcsp-feature .vm-btn-primary').focus();
    await page.keyboard.press('Enter');
    const afterChoose = await focusInfo(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const pressed = await page.locator('.gcsp-pick').first().getAttribute('aria-pressed');
    const focusedPick = await focusInfo(page);
    await record('keyboard-selected-desktop', page, log, { tabOrder: order, focusAfterChoose: afterChoose, focusedPick, firstCardPressed: pressed }, { full: false });
    await page.locator('.gcsp-summary').scrollIntoViewIfNeeded();
    await record('selected-summary-desktop', page, log, {}, { full: false });
    await context.close();
  }

  {
    const { page, context, log } = await open('gcsp-employee.html?fixture=representative', NARROW);
    await ready(page);
    await page.locator('.gcsp-menu-toggle').focus();
    await page.keyboard.press('Enter');
    await record('narrow-menu-open-320', page, log, { menuExpanded: await page.locator('.gcsp-menu-toggle').getAttribute('aria-expanded') }, { full: false });
    await context.close();
  }

  {
    const { page, context, log } = await open('gcsp-employee.html?fixture=representative', DESKTOP, { reducedMotion: 'reduce' });
    await ready(page);
    await page.locator('.gcsp-nav-toggle').click();
    const durations = await page.evaluate(() => ['.gcsp-nav', '.gcsp-card', '.gcsp-nav-toggle .gcsp-icon']
      .map((s) => [s, document.querySelector(s) ? getComputedStyle(document.querySelector(s)).transitionDuration : 'missing']));
    await record('reduced-motion-labels-desktop', page, log, { reducedMotion: 'reduce', transitionDurations: durations }, { full: false });
    await context.close();
  }

  for (const [label, vp] of [['desktop', DESKTOP], ['narrow-320', NARROW]]) {
    const { page, context, log } = await open('components.html', vp);
    await page.waitForSelector('.vm-gallery-gcsp-section', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.locator('.vm-gallery-gcsp-section').screenshot({ path: join(OUT, `gallery-gcsp-${label}.png`) });
    results.push({ name: `gallery-gcsp-${label}`, file: `gallery-gcsp-${label}.png`, overflowPx: await overflow(page), ...log });
    await context.close();
  }
} finally {
  await browser.close();
}

const hashes = {};
for (const f of SOURCES) hashes[f] = createHash('sha256').update(await readFile(join(ROOT, f))).digest('hex');
const head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'fucq-64-browser-matrix.json'), `${JSON.stringify({ story: 'FUCQ-64', head, base: BASE, browser: 'system Chrome, headless', capturedAt: new Date().toISOString(), sources: hashes, results }, null, 2)}\n`);
console.log(JSON.stringify(results.map((r) => ({ n: r.name, o: r.overflowPx, c: r.console.length, f: r.failed.length, x: r.external.length }))));
