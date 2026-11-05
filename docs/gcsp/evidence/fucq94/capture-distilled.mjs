// Distilled representative body only; prior checkpoint evidence stays intact. Run under the registered FUCQ-94 resource supervisor.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
assert(process.env.TMPDIR, 'The resource supervisor must own browser scratch.');
const profile = join(process.env.TMPDIR, 'brief-chrome-profile');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/usget/.npm/_npx/db89d7302a373f10/node_modules/playwright-core/index.mjs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(ROOT, `.${decodeURIComponent(new URL(request.url, 'http://local').pathname)}`);
    if (!path.startsWith(`${ROOT}${sep}`) || !(await stat(path)).isFile()) throw Error('Not found');
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const BASE = `http://127.0.0.1:${server.address().port}`;
let context;
const results = [];
const vpDesktop = { width: 1280, height: 900 };
const vpMobile = { width: 375, height: 812 };
const sources = ['gcsp-brief.html', 'blocks/gcsp/brief/gcsp-brief.js', 'blocks/gcsp/brief/brief-view.js', 'blocks/gcsp/brief/brief-view-model.js', 'blocks/gcsp/brief/brief-transport.js', 'blocks/gcsp/brief/gcsp-brief.css', 'blocks/gcsp/brief/harness.js', 'blocks/vehicle-matcher/modes/question-ui.js', 'blocks/vehicle-matcher/component-gallery.js', 'docs/gcsp/evidence/fucq94/representative-snapshot.json', 'docs/gcsp/evidence/fucq94/capture-distilled.mjs'];
const info = (page) => page.evaluate(() => {
  const active = document.activeElement;
  const style = getComputedStyle(active);
  return { name: (active.getAttribute('aria-label') || active.textContent || '').trim().slice(0, 100), role: active.getAttribute('role'), outline: `${style.outlineStyle} ${style.outlineWidth}` };
});
async function open(viewport, reducedMotion = 'no-preference') {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.setViewportSize(viewport); await page.emulateMedia({ reducedMotion });
  const log = { console: [], failed: [], external: [] };
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) log.console.push(m.text()); });
  page.on('pageerror', (e) => log.console.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) log.failed.push(`${r.status()} ${r.url()}`); });
  await page.route('**/*', (route) => {
    if (route.request().url().startsWith(`${BASE}/`)) return route.continue();
    log.external.push(route.request().url()); return route.abort();
  });
  await page.goto(`${BASE}/gcsp-brief.html`);
  console.log(`Opened ${viewport.width}px representative`);
  try {
    await page.waitForFunction(() => document.querySelector('.gcsp-brief-preview-status')?.textContent.startsWith('1 eligible car'), null, { timeout: 5000 });
  } catch (error) {
    console.log(JSON.stringify({ startupLog: log, body: (await page.locator('body').innerText()).slice(0, 15000) }));
    throw error;
  }
  // Mobile places preview below the form, so force only its existing lazy image to load for full-page evidence.
  await page.locator('.vm-card-photo').evaluateAll((images) => Promise.all(images.map((image) => { image.loading = 'eager'; return image.decode(); })));
  console.log(`Ready ${viewport.width}px representative`);
  return { page, log };
}
async function record(name, page, log, extra = {}, fullPage = false) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log(`Captured ${name}`);
  const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflowPx, 0, `${name}: horizontal overflow`);
  assert.deepEqual(log, { console: [], failed: [], external: [] }, `${name}: browser errors`);
  results.push({ name, file: `${name}.png`, viewport: page.viewportSize(), overflowPx, ...log, ...extra });
}

try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, reducedMotion: 'no-preference' });
  for (const [name, viewport] of [['desktop', vpDesktop], ['mobile-375', vpMobile]]) {
    const { page, log } = await open(viewport);
    const initial = await page.evaluate(() => ({
      ranges: document.querySelectorAll('.gcsp-brief input[type="range"]').length,
      photos: document.querySelectorAll('.gcsp-brief .vm-card-photo').length,
      bodyText: document.querySelector('.gcsp-brief').textContent,
      documentHeight: document.documentElement.scrollHeight,
      visibleWords: document.querySelector('.gcsp-brief').innerText.trim().split(/\s+/).length,
      disclosureClosed: !document.querySelector('.gcsp-brief-known').open,
      saveDisabled: document.querySelector('[data-save-brief]').disabled,
    }));
    assert.equal(initial.disclosureClosed, true);
    const cardText = await page.locator('.gcsp-brief-cards').innerText();
    assert.match(cardText, /Plug-in hybrid/); assert.match(cardText, /45 mpg/); assert.match(cardText, /Seats/);
    assert.doesNotMatch(cardText, /mpg-imperial|ordinal-1-5|5 count|Driver eligible|Included in your scheme/);
    assert.equal(initial.ranges, 10); assert.equal(initial.photos, 1); assert.equal(initial.saveDisabled, true);
    assert.equal(await page.getByRole('button', { name: 'Retry preview', exact: true }).isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Refresh and review', exact: true }).isVisible(), false);
    assert.match(initial.bodyText, /BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack/);
    assert.match(initial.bodyText, /BMW brand image, not this exact car/);
    assert.match(initial.bodyText, /Charging access is unknown/);
    assert.doesNotMatch(initial.bodyText, /Exact car [0-9a-f]{8}-/);
    await record(`distilled-${name}`, page, log, { initial }, true);
    if (name === 'desktop') {
      await page.keyboard.press('Tab');
      const skip = await info(page); assert.match(skip.name, /Skip/);
      await record('distilled-keyboard-skip-desktop', page, log, { focused: skip });
      await page.keyboard.press('Enter');
      const disclosure = page.locator('.gcsp-brief-known');
      await disclosure.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await disclosure.evaluate((node) => node.open), true);
      const detailText = await disclosure.innerText();
      assert.match(detailText, /Driver eligible/); assert.match(detailText, /Included in your scheme/);
      assert.match(detailText, /Draft preference/);
      await record('distilled-keyboard-disclosure-desktop', page, log, { focused: await info(page), detailText });
      await page.keyboard.press('Enter');
      assert.equal(await disclosure.evaluate((node) => node.open), false);
      const firstRange = page.getByRole('slider', { name: 'Comfort: what you prefer', exact: true });
      await firstRange.focus(); await firstRange.evaluate((node) => { window.briefFocusedNode = node; });
      const before = await firstRange.inputValue();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.gcsp-brief-preview-status').textContent.includes('Preview unavailable. Your edits are kept. Reload to restore the example.'));
      assert.equal(await firstRange.inputValue(), String(Number(before) + 1));
      assert.equal(await page.evaluate(() => document.activeElement === window.briefFocusedNode), true);
      await record('distilled-keyboard-retained-edit-desktop', page, log, { focused: await info(page), before, after: await firstRange.inputValue(), stableNodeAfterResponse: true });
      const fuel = page.getByRole('radiogroup', { name: 'Fuel: what you prefer', exact: true });
      const selected = fuel.locator('[aria-checked="true"]'); await selected.focus();
      await page.keyboard.press('End');
      assert.equal(await fuel.locator('[tabindex="0"]').count(), 1);
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-checked')), 'true');
      const hold = page.getByRole('checkbox', { name: 'Hold a suitable car for me', exact: true });
      const search = page.getByRole('checkbox', { name: 'Search for cars for me', exact: true });
      await hold.focus(); await page.keyboard.press('Space');
      assert.equal(await hold.getAttribute('aria-checked'), 'true'); assert.equal(await search.getAttribute('aria-checked'), 'false');
      await record('distilled-keyboard-independent-consent-desktop', page, log, { focused: await info(page), hold: true, search: false });
    } else {
      const menu = page.locator('.gcsp-menu-toggle'); await menu.focus(); await page.keyboard.press('Enter');
      assert.equal(await menu.getAttribute('aria-expanded'), 'true');
      await record('distilled-keyboard-menu-mobile-375', page, log, { focused: await info(page), menuExpanded: true });
    }
    await page.close();
  }
  const { page, log } = await open(vpDesktop, 'reduce');
  const durations = await page.evaluate(() => ['.gcsp-nav', '.gcsp-brief', '.vm-card'].map((s) => [s, document.querySelector(s) ? { animation: getComputedStyle(document.querySelector(s)).animationDuration, transition: getComputedStyle(document.querySelector(s)).transitionDuration } : null]));
  await record('distilled-reduced-motion-desktop', page, log, { reducedMotion: 'reduce', durations });
  await page.close();
} finally {
  if (context) await context.close();
  server.closeAllConnections();
  await new Promise((close) => server.close(close));
}
const hashes = {};
for (const path of sources) hashes[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex');
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'distilled-browser-matrix.json'), `${JSON.stringify({ story: 'FUCQ-94', scope: 'distilled representative body; broader states pending human review', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(), capturedAt: new Date().toISOString(), browser: 'headless isolated system Chrome', activeProfileCompatibilityException: profile, sources: hashes, results }, null, 2)}\n`);
console.log(JSON.stringify(results.map(({ name, overflowPx, console, failed, external }) => ({ name, overflowPx, console: console.length, failed: failed.length, external: external.length }))));
