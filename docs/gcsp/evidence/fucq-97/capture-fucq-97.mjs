// FUCQ-97 browser evidence: headless system Chrome against `npm run serve` (BASE env).
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
const SOURCES = ['blocks/gcsp/presenter/gcsp-outbox.js', 'blocks/gcsp/presenter/message-list.js', 'blocks/gcsp/presenter/outbox-copy.js',
  'blocks/gcsp/presenter/http-adapter.js', 'blocks/gcsp/presenter/fixtures.js', 'blocks/gcsp/presenter/harness.js', 'blocks/gcsp/presenter/register.js',
  'blocks/gcsp/presenter/gcsp-presenter.css', 'blocks/gcsp/shell/portal-shell.js', 'blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/shell/gcsp-tokens.css',
  'blocks/vehicle-matcher/ui.js', 'blocks/vehicle-matcher/component-gallery.js', 'server/gcsp/notify/http.js', 'gcsp-outbox.html', 'components.html'];
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
    if (url.startsWith(BASE) || url.startsWith('about:') || url.startsWith('data:')) return route.continue();
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
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
  results.push({ name, file: `${name}.png`, overflowPx: await overflow(page), ...log, ...extra });
}
const focusInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  const cs = getComputedStyle(a);
  return { tag: a.tagName, name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60), outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
});
const ready = (page) => page.waitForSelector('.gcsp-mail-row, .gcsp-presenter-body .vm-status', { timeout: 5000 });

try {
  for (const [label, vp] of [['desktop', DESKTOP], ['narrow-320', NARROW]]) {
    for (const fixture of ['messages', 'empty', 'retrying', 'failed', 'unavailable', 'refused']) {
      const { page, context, log } = await open(`gcsp-outbox.html?fixture=${fixture}`, vp);
      await ready(page);
      await record(`${fixture}-${label}`, page, log, { fixture, viewport: vp, rows: await page.locator('.gcsp-mail-row').count() });
      await context.close();
    }
    {
      const { page, context, log } = await open('gcsp-outbox.html?fixture=loading', vp);
      await page.waitForSelector('.gcsp-presenter-body .gcsp-note', { timeout: 5000 });
      await record(`loading-${label}`, page, log, { fixture: 'loading', viewport: vp }, { full: false });
      await context.close();
    }
    // Keyboard only: Tab to the first row, Enter opens it, then walk to the offer link.
    const { page, context, log } = await open('gcsp-outbox.html?fixture=messages', vp);
    await ready(page);
    const order = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const info = await focusInfo(page);
      order.push(info);
      if (info.tag === 'BUTTON' && await page.evaluate(() => document.activeElement.classList.contains('gcsp-mail-row'))) break;
    }
    const onRow = await focusInfo(page);
    await page.keyboard.press('Enter');
    const afterEnter = await focusInfo(page);
    const detail = await page.evaluate(() => {
      const frame = document.querySelector('.gcsp-mail-frame');
      const link = document.querySelector('.gcsp-mail-offer a');
      return { sandbox: frame?.getAttribute('sandbox'), referrerpolicy: frame?.getAttribute('referrerpolicy'), hasSrcdoc: Boolean(frame?.srcdoc),
        linkTarget: link?.target, linkRel: link?.rel, linkHref: link?.getAttribute('href'), pre: Boolean(document.querySelector('.gcsp-mail-text')) };
    });
    await record(`message-open-${label}`, page, log, { fixture: 'messages', viewport: vp, keyboardOnly: true, tabsToFirstRow: order.length, onRow, afterEnter, detail });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const next = await focusInfo(page);
    // Walk down the list: second row (retrying) by keyboard to show the explanation.
    await context.close();

    const second = await open('gcsp-outbox.html?fixture=messages', vp);
    await ready(second.page);
    await second.page.locator('.gcsp-mail-row').nth(1).focus();
    await second.page.keyboard.press('Enter');
    await record(`message-retrying-open-${label}`, second.page, second.log, { fixture: 'messages', viewport: vp, focused: await focusInfo(second.page), nextAfterTabs: next });
    await second.page.locator('.gcsp-mail-row').nth(2).focus();
    await second.page.keyboard.press('Enter');
    await record(`message-failed-open-${label}`, second.page, second.log, { fixture: 'messages', viewport: vp, focused: await focusInfo(second.page) });
    await second.context.close();
  }

  {
    const { page, context, log } = await open('gcsp-outbox.html?fixture=messages', DESKTOP, { reducedMotion: 'reduce' });
    await ready(page);
    const durations = await page.evaluate(() => ['.gcsp-mail-row', '.gcsp-nav', '.vm-btn']
      .map((s) => [s, document.querySelector(s) ? getComputedStyle(document.querySelector(s)).transitionDuration : 'missing']));
    await record('reduced-motion-desktop', page, log, { reducedMotion: 'reduce', transitionDurations: durations }, { full: false });
    await context.close();
  }

  for (const [label, vp] of [['desktop', DESKTOP], ['narrow-320', NARROW]]) {
    const { page, context, log } = await open('components.html', vp);
    await page.waitForSelector('.vm-gallery-gcsp-section .gcsp-mail-list', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.locator('.vm-gallery-gcsp-section .gcsp-mail').first().screenshot({ path: join(OUT, `gallery-messagelist-${label}.png`) });
    results.push({ name: `gallery-messagelist-${label}`, file: `gallery-messagelist-${label}.png`, overflowPx: await overflow(page), ...log });
    await context.close();
  }
} finally {
  await browser.close();
}

const hashes = {};
for (const f of SOURCES) hashes[f] = createHash('sha256').update(await readFile(join(ROOT, f))).digest('hex');
const head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'fucq-97-browser-matrix.json'), `${JSON.stringify({ story: 'FUCQ-97', head, base: BASE, browser: 'system Chrome, headless', capturedAt: new Date().toISOString(), sources: hashes, results }, null, 2)}\n`);
console.log(JSON.stringify(results.map((r) => ({ n: r.name, o: r.overflowPx, c: r.console.length, f: r.failed.length, x: r.external.length }))));
