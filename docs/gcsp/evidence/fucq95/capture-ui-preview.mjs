// Scoped, isolated design-checkpoint proof; no authenticated session or saved commands.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve, sep, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const phase = process.argv[2] || 'initial';
if (!['initial', 'confirmed'].includes(phase)) throw new Error('Unknown evidence phase');
const { chromium } = await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const SOURCES = ['gcsp-activity.html', 'components.html', 'blocks/gcsp/activity/activity-body.js',
  'blocks/gcsp/activity/activity-copy.js', 'blocks/gcsp/activity/activity-fixtures.js', 'blocks/gcsp/activity/harness.js',
  'blocks/gcsp/activity/gcsp-activity.css', 'blocks/gcsp/kit/activity-timeline.js', 'blocks/gcsp/kit/activity-timeline.css',
  'blocks/vehicle-matcher/component-gallery.js', 'blocks/vehicle-matcher/vehicle-matcher.css',
  'blocks/vehicle-matcher/gcsp-kit.css', 'blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/employee/gcsp-employee.js'];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const path = resolve(ROOT, `.${name}`);
    if (!path.startsWith(ROOT + sep)) throw new Error('Outside root');
    const body = await readFile(path); res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
const focus = (page) => page.evaluate(() => {
  const el = document.activeElement; const style = getComputedStyle(el);
  return { tag: el.tagName, name: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    outline: `${style.outlineStyle} ${style.outlineWidth}`, classes: el.className };
});
async function tabTo(page, selector, maximum = 40) {
  const order = [];
  for (let i = 0; i < maximum; i += 1) {
    await page.keyboard.press('Tab'); order.push(await focus(page));
    if (await page.evaluate((sel) => document.activeElement.matches(sel), selector)) return { found: true, order };
  }
  return { found: false, order };
}
async function open(path, viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage(); const logs = { console: [], failures: [], external: [] };
  page.on('console', (m) => { if (m.type() === 'error') logs.console.push(m.text()); });
  page.on('pageerror', (e) => logs.console.push(String(e)));
  page.on('requestfailed', (r) => { if (!logs.external.includes(r.url())) logs.failures.push(r.url()); });
  page.on('response', (r) => { if (r.status() >= 400) logs.failures.push(`${r.status()} ${r.url()}`); });
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(base)) return route.continue();
    logs.external.push(route.request().url()); return route.abort();
  });
  await page.goto(base + '/' + path);
  return { page, context, logs };
}
async function state(page) {
  return page.evaluate(() => ({ overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    title: document.querySelector('h1')?.textContent, text: document.querySelector('.gcsp-activity')?.innerText,
    times: [...document.querySelectorAll('.gcsp-activity time')].map((el) => ({ value: el.dateTime, text: el.textContent })),
    disabled: [...document.querySelectorAll('.gcsp-activity button:disabled')].map((el) => ({ name: el.textContent,
      reason: document.getElementById(el.getAttribute('aria-describedby'))?.textContent })),
    animations: [...document.querySelectorAll('.gcsp-activity, .gcsp-activity *')].filter((el) => getComputedStyle(el).animationName !== 'none').length }));
}
async function settle(page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
}
try {
  await mkdir(OUT, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [size, viewport] of [['desktop', { width: 1280, height: 900 }], ['narrow-375', { width: 375, height: 812 }]]) {
    for (const fixture of ['never-checked', 'paused', 'unavailable']) {
      const { page, context, logs } = await open(`gcsp-activity.html?fixture=${fixture}`, viewport);
      await page.waitForSelector('.gcsp-activity');
      const observed = await state(page);
      const firstTab = await tabTo(page, '.gcsp-skip');
      await page.keyboard.press('Enter');
      const skipTarget = await focus(page);
      let retry;
      if (fixture === 'unavailable') {
        const tabbed = await tabTo(page, '.gcsp-activity button');
        await page.keyboard.press('Enter');
        retry = { tabbed, focusAfter: await focus(page), announcement: await page.locator('.gcsp-activity-preview-status').innerText() };
        retry.focusRetained = retry.focusAfter.tag === 'BUTTON' && retry.focusAfter.name === 'Retry';
      } else {
        const tabbed = await tabTo(page, '[data-fixture="paused"]');
        await page.keyboard.press('Enter');
        const switched = await state(page);
        const retained = await focus(page);
        if (!switched.text.includes('Your buddy is paused') || retained.tag !== 'BUTTON' || retained.name !== 'Paused') throw new Error('Preview keyboard switch failed');
        await page.locator(`[data-fixture="${fixture}"]`).click();
        observed.keyboardStateSwitch = { found: tabbed.found, focusRetained: true };
      }
      const shot = `${phase}-${fixture}-${size}.png`;
      await settle(page);
      await page.screenshot({ path: join(OUT, shot), fullPage: true });
      results.push({ name: `${fixture}-${size}`, viewport, file: shot, ...observed, firstTab, skipTarget, retry, ...logs });
      await context.close();
    }
    const { page, context, logs } = await open('components.html', viewport);
    await page.waitForSelector('[aria-label="Buddy activity"] .gcsp-activity');
    await settle(page);
    const section = page.locator('section[aria-label="Buddy activity"]');
    const file = `${phase}-gallery-activity-${size}.png`;
    await section.screenshot({ path: join(OUT, file) });
    const adjacent = `${phase}-gallery-reference-${size}.png`;
    await page.locator('section[aria-label="Employee decision card"]').screenshot({ path: join(OUT, adjacent) });
    const dots = await page.evaluate(() => [...document.querySelectorAll('.vm-pending-dot')].map((el) => ({
      visible: !!el.getClientRects().length, animation: getComputedStyle(el).animationName,
      parent: el.parentElement.textContent.trim() })));
    results.push({ name: `gallery-${size}`, viewport, files: [file, adjacent], pendingDots: dots,
      overflowPx: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), ...logs });
    await context.close();
  }
  {
    const { page, context, logs } = await open('gcsp-activity.html?fixture=paused', { width: 375, height: 812 }, 'reduce');
    await page.waitForSelector('.gcsp-activity');
    const menu = await tabTo(page, 'button[aria-label="Menu"]');
    await page.keyboard.press('Enter');
    const expanded = await page.locator('button[aria-label="Menu"]').getAttribute('aria-expanded');
    await page.keyboard.press('Escape');
    if (!menu.found || expanded !== 'true' || (await focus(page)).name !== 'Menu') throw new Error('Mobile Menu keyboard behavior failed');
    results.push({ name: 'reduced-motion-menu-narrow', menu, expanded, focusAfterEscape: await focus(page), ...(await state(page)), ...logs });
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
const sourceIdentity = Object.fromEntries(await Promise.all(SOURCES.map(async (name) => [name, createHash('sha256').update(await readFile(join(ROOT, name))).digest('hex')])));
const summary = { phase, scope: 'first representative UI checkpoint only', headless: true, isolated: true,
  profile: 'supervisor-owned temporary browser working data; browser and contexts closed in finally', sourceIdentity, results };
await writeFile(join(OUT, `${phase}-render-matrix.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ phase, checks: results.length, issues: results.filter((r) => r.overflowPx > 0 || r.console.length || r.failures.length || r.external.length || r.retry?.focusRetained === false).map((r) => r.name) }));
