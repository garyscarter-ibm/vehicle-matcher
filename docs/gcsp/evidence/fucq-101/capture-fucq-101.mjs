// FUCQ-101 browser evidence: headless system Chrome against `npm run serve` (BASE env).
// Usage: PLAYWRIGHT_CORE=<playwright-core/index.mjs> BASE=http://localhost:3141 node <this file>
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
const BASE = process.env.BASE || 'http://localhost:3141';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE);
const SOURCES = ['blocks/gcsp/greg/gcsp-greg.js', 'blocks/gcsp/greg/gcsp-greg.css', 'blocks/gcsp/greg/demand-view.js', 'blocks/gcsp/greg/demand-copy.js',
  'blocks/gcsp/greg/fixtures.js', 'blocks/gcsp/greg/http-adapter.js', 'blocks/gcsp/greg/harness.js', 'blocks/gcsp/greg/register.js',
  'blocks/gcsp/kit/metric-tile.js', 'blocks/gcsp/kit/data-table.js', 'blocks/gcsp/kit/gcsp-kit.css',
  'blocks/gcsp/shell/portal-shell.js', 'blocks/gcsp/shell/gcsp-shell.css', 'blocks/gcsp/shell/gcsp-tokens.css',
  'blocks/vehicle-matcher/ui.js', 'blocks/vehicle-matcher/component-gallery.js', 'blocks/vehicle-matcher/component-gallery.css',
  'gcsp-greg.html', 'components.html'];
const DESKTOP = { width: 1280, height: 900 };
const NARROW = { width: 320, height: 740 };
const SIZES = [['desktop', DESKTOP], ['narrow-320', NARROW]];
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
  page.on('requestfailed', (r) => { if (!r.url().endsWith('/favicon.ico') && !log.external.includes(r.url())) log.failed.push(`failed ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) log.failed.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__unavailable = 0;
    document.addEventListener('gcsp:unavailable', () => { window.__unavailable += 1; }, true);
  });
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
  const labelled = a.getAttribute('aria-labelledby') && document.getElementById(a.getAttribute('aria-labelledby'))?.textContent;
  return {
    tag: a.tagName, role: a.getAttribute('role'), tableRegion: a.classList.contains('gcsp-table-wrap'),
    name: (a.getAttribute('aria-label') || labelled || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
  };
});
const ready = (page) => page.waitForSelector('.gcsp-greg-body .gcsp-table-wrap, .gcsp-greg-body .vm-status', { timeout: 5000 });
const text = (page, sel) => page.locator(sel).first().innerText();
const snapshot = (page) => page.evaluate(() => ({
  status: document.querySelector('.gcsp-greg-status')?.textContent.trim(),
  headline: [...document.querySelectorAll('.gcsp-greg-headline .gcsp-tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
  meta: document.querySelector('.gcsp-greg-facts')?.innerText.replace(/\s+/g, ' ').trim(),
  offers: [...document.querySelectorAll('.gcsp-greg-tiles .gcsp-tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
  unmetFirstRows: [...document.querySelectorAll('[data-section="unmet"] tbody tr')].slice(0, 2).map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
}));
async function tabTo(page, test, max = 80) {
  const order = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const info = await focusInfo(page);
    order.push(info);
    if (await page.evaluate(test)) return { found: true, order };
  }
  return { found: false, order };
}

try {
  // 1. States at both widths.
  for (const [label, vp] of SIZES) {
    for (const fixture of ['populated', 'after-release-decline', 'empty', 'no-stock', 'banded', 'unavailable', 'refused', 'conflict']) {
      const { page, context, log } = await open(`gcsp-greg.html?fixture=${fixture}`, vp);
      await ready(page);
      const tables = await page.locator('.gcsp-table-wrap').count();
      const tileTexts = await snapshot(page);
      const reservedHidden = await page.evaluate(() => document.querySelector('.gcsp-greg-regions').hidden);
      const regionHeadings = await page.locator('.gcsp-greg-region .gcsp-greg-h2').allInnerTexts();
      await record(`${fixture}-${label}`, page, log, { fixture, viewport: vp, tables, reservedHidden, regionHeadings, view: tileTexts });
      await context.close();
    }
    const { page, context, log } = await open('gcsp-greg.html?fixture=loading', vp);
    await page.waitForSelector('.gcsp-greg-body[aria-busy="true"]', { state: 'attached', timeout: 5000 });
    await record(`loading-${label}`, page, log, { fixture: 'loading', viewport: vp, status: await text(page, '.gcsp-greg-status') }, { full: false });
    await context.close();
  }

  // 2. Refresh by keyboard only.
  for (const [label, vp] of SIZES) {
    const { page, context, log } = await open('gcsp-greg.html?fixture=refresh', vp);
    await ready(page);
    const tabbed = await tabTo(page, () => document.activeElement.textContent.trim() === 'Refresh' && document.activeElement.tagName === 'BUTTON');
    const before = await snapshot(page);
    await record(`refresh-before-${label}`, page, log, { fixture: 'refresh', viewport: vp, keyboardOnly: true, tabOrderToRefresh: tabbed.order, foundRefresh: tabbed.found, before });
    await page.keyboard.press('Enter');
    await page.waitForFunction((was) => {
      const s = document.querySelector('.gcsp-greg-status')?.textContent.trim();
      return s && s !== was && s.startsWith('Figures updated for');
    }, before.status, { timeout: 5000 });
    const after = await snapshot(page);
    const focus = await focusInfo(page);
    await record(`refresh-after-${label}`, page, log, {
      fixture: 'refresh', viewport: vp, keyboardOnly: true, after, focusAfter: focus,
      changed: { status: before.status !== after.status, meta: before.meta !== after.meta, headline: JSON.stringify(before.headline) !== JSON.stringify(after.headline),
        offers: JSON.stringify(before.offers) !== JSON.stringify(after.offers), unmet: JSON.stringify(before.unmetFirstRows) !== JSON.stringify(after.unmetFirstRows) },
      focusStillOnRefresh: focus.tag === 'BUTTON' && focus.name === 'Refresh',
    });
    await context.close();
  }

  // 3. Keyboard walk, populated.
  {
    const { page, context, log } = await open('gcsp-greg.html?fixture=populated', DESKTOP);
    await ready(page);
    const order = [];
    let first = null;
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press('Tab');
      const info = await focusInfo(page);
      if (info.tag === 'BODY') break;
      order.push(info);
      if (info.tableRegion && !first) {
        first = info;
        const box = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        const pad = 14;
        const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(DESKTOP.width, box.width + 2 * pad), height: box.height + 2 * pad };
        await page.screenshot({ path: join(OUT, 'keyboard-table-region-desktop.png'), clip });
      }
    }
    const skipLink = order[0];
    results.push({ name: 'keyboard-walk-desktop', fixture: 'populated', viewport: DESKTOP, stops: order.length, order, skipLinkFirst: /skip/i.test(skipLink?.name || ''),
      tableRegions: order.filter((o) => o.tableRegion).length, outlineMissing: order.filter((o) => /^none/.test(o.outline)).map((o) => o.name),
      overflowPx: await overflow(page), ...log });
    await context.close();
  }
  {
    const { page, context, log } = await open('gcsp-greg.html?fixture=populated', NARROW);
    await ready(page);
    const regions = await page.evaluate(() => [...document.querySelectorAll('.gcsp-table-wrap')].map((r) => ({
      name: document.getElementById(r.getAttribute('aria-labelledby'))?.textContent, scrollWidth: r.scrollWidth, clientWidth: r.clientWidth, overflows: r.scrollWidth > r.clientWidth })));
    const found = await tabTo(page, () => document.activeElement.classList.contains('gcsp-table-wrap') && document.activeElement.scrollWidth > document.activeElement.clientWidth);
    const result = { name: 'keyboard-scroll-narrow-320', fixture: 'populated', viewport: NARROW, regions, overflowingRegionFocused: found.found, tabStops: found.order.length };
    if (found.found) {
      const at = () => page.evaluate(() => document.activeElement.scrollLeft);
      result.scrollLeft = { start: await at() };
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(150);
      result.scrollLeft.afterArrowRight = await at();
      await page.keyboard.press('End');
      await page.waitForTimeout(150);
      result.scrollLeft.afterEnd = await at();
      result.focusedRegion = (await focusInfo(page)).name;
    }
    await page.evaluate(() => document.activeElement.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(OUT, 'keyboard-scroll-narrow-320.png') });
    results.push({ ...result, file: 'keyboard-scroll-narrow-320.png', overflowPx: await overflow(page), ...log });
    await context.close();
  }

  // 4. Unavailable: keyboard to Retry, Enter.
  for (const [label, vp] of SIZES) {
    const { page, context, log } = await open('gcsp-greg.html?fixture=unavailable', vp);
    await ready(page);
    const eventsBefore = await page.evaluate(() => window.__unavailable);
    const tabbed = await tabTo(page, () => document.activeElement.textContent.trim() === 'Retry');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__unavailable >= 2, null, { timeout: 5000 });
    await page.waitForSelector('.gcsp-greg-body .vm-status button', { timeout: 5000 });
    const focusAfter = await focusInfo(page);
    await record(`retry-after-${label}`, page, log, { fixture: 'unavailable', viewport: vp, keyboardOnly: true, foundRetry: tabbed.found, tabOrderToRetry: tabbed.order,
      unavailableEventsBefore: eventsBefore, unavailableEventsAfterRetry: await page.evaluate(() => window.__unavailable), status: await text(page, '.gcsp-greg-status'), focusAfter,
      alertRole: await page.locator('.gcsp-greg-body [role="alert"]').count() });
    await context.close();
  }

  // 5. Reduced motion.
  {
    const { page, context, log } = await open('gcsp-greg.html?fixture=populated', DESKTOP, { reducedMotion: 'reduce' });
    await ready(page);
    const durations = await page.evaluate(() => Object.fromEntries(['.gcsp-greg-body', '.vm-btn', '.gcsp-nav-btn', '.gcsp-table-wrap']
      .map((s) => [s, document.querySelector(s) ? getComputedStyle(document.querySelector(s)).transitionDuration : 'missing'])));
    await record('reduced-motion-desktop', page, log, { fixture: 'populated', reducedMotion: 'reduce', transitionDurations: durations }, { full: false });
    await context.close();
  }

  // 6. Gallery.
  for (const [label, vp] of SIZES) {
    const { page, context, log } = await open('components.html', vp);
    await page.waitForSelector('.vm-gallery-greg-section .gcsp-table-wrap', { timeout: 5000 });
    await page.waitForTimeout(400);
    const section = page.locator('.vm-gallery-greg-section').first();
    await section.screenshot({ path: join(OUT, `gallery-greg-kit-${label}.png`) });
    const groups = await page.locator('.vm-gallery-greg-section .vm-gallery-gcsp-title').allInnerTexts();
    results.push({ name: `gallery-greg-kit-${label}`, file: `gallery-greg-kit-${label}.png`, viewport: vp, groups, overflowPx: await overflow(page), ...log });
    await context.close();
  }

  // 7. Contrast: computed colour against the first opaque ancestor background.
  const contrastPage = async (path, vp, probes) => {
    const { page, context, log } = await open(path, vp);
    await ready(page);
    const rows = await page.evaluate((list) => {
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
      const lum = ({ r, g, b }) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const mix = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const bgOf = (node) => { const stack = []; for (let n = node; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0) stack.push(c); if (c.a === 1) break; } return stack.reverse().reduce((under, c) => mix(c, under), { r: 255, g: 255, b: 255, a: 1 }); };
      return list.map(([label, sel]) => {
        const node = document.querySelector(sel);
        if (!node) return { label, selector: sel, missing: true };
        const cs = getComputedStyle(node);
        const bg = bgOf(node);
        const fg = mix(parse(cs.color), bg);
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const size = parseFloat(cs.fontSize);
        return { label, selector: sel, colour: cs.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, fontSize: size, weight: cs.fontWeight,
          ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100, opacity: cs.opacity };
      });
    }, probes);
    await context.close();
    return { rows, log };
  };
  const populatedProbes = [
    ['tile label (headline)', '.gcsp-greg-headline .gcsp-tile-label'], ['tile figure (headline)', '.gcsp-greg-headline .gcsp-tile-figure'],
    ['table header', '.gcsp-table-th'], ['table caption', '.gcsp-table-caption'], ['table row header', '.gcsp-table-rowhead'], ['table cell', '.gcsp-table-td'],
    ['muted note, meta strip', '.gcsp-greg-meta .gcsp-note'], ['muted note, section', '.gcsp-greg-section > .gcsp-note'], ['status line', '.gcsp-greg-status'],
    ['region heading', '.gcsp-greg-region .gcsp-greg-h2'], ['region note', '.gcsp-greg-region .gcsp-note'], ['section heading', '.gcsp-greg-section > .gcsp-greg-h2'],
    ['facts label', '.gcsp-greg-facts dt'], ['facts value', '.gcsp-greg-facts dd'], ['Refresh button', '.gcsp-greg-bar .vm-btn'],
  ];
  const bandedProbes = [['band figure (tile)', '.gcsp-tile-figure.is-band'], ['band cell (table)', '.gcsp-table .is-band']];
  const contrast = [];
  for (const [label, vp] of SIZES) {
    const a = await contrastPage('gcsp-greg.html?fixture=populated', vp, populatedProbes);
    const b = await contrastPage('gcsp-greg.html?fixture=banded', vp, bandedProbes);
    contrast.push({ viewport: label, populated: a.rows, banded: b.rows });
  }
  const ratios = contrast.flatMap((c) => [...c.populated, ...c.banded]).filter((r) => !r.missing);
  const minRow = ratios.reduce((m, r) => (r.ratio < m.ratio ? r : m), ratios[0]);
  results.push({ name: 'contrast', threshold: 4.5, minimum: { label: minRow.label, ratio: minRow.ratio }, failures: ratios.filter((r) => r.ratio < 4.5), missing: contrast.flatMap((c) => [...c.populated, ...c.banded]).filter((r) => r.missing), contrast });

  // 8. Reference comparison at desktop.
  const compare = [];
  for (const [label, path, wait] of [['greg dashboard', 'gcsp-greg.html?fixture=populated', '.gcsp-greg-body .gcsp-table-wrap'],
    ['FUCQ-97 outbox', 'gcsp-outbox.html?fixture=messages', '.gcsp-mail-row'], ['FUCQ-64 employee', 'gcsp-employee.html', '.gcsp-header']]) {
    const { page, context, log } = await open(path, DESKTOP);
    await page.waitForSelector(wait, { timeout: 5000 });
    await page.waitForTimeout(500);
    compare.push({ label, path, log, ...(await page.evaluate(() => {
      const root = document.querySelector('.gcsp');
      const cs = (n) => getComputedStyle(n);
      const nav = document.querySelector('.gcsp-nav');
      const main = document.querySelector('.gcsp-main');
      const header = document.querySelector('.gcsp-header');
      const accent = cs(root).getPropertyValue('--gcsp-accent').trim();
      const btn = document.querySelector('.vm-btn-primary, .vm-btn-ghost');
      return { headerHeight: Math.round(header.getBoundingClientRect().height), headerBackground: cs(header).backgroundColor, sidebarWidth: Math.round(nav.getBoundingClientRect().width),
        bodyFont: cs(main).fontFamily, pageBackground: cs(document.querySelector('.gcsp-content') || main).backgroundColor, accent, h1: cs(document.querySelector('h1')).fontSize,
        buttonBackground: btn ? cs(btn).backgroundColor : null, buttonLabel: btn?.textContent.trim() };
    })) });
    await context.close();
  }
  const sameKeys = ['headerHeight', 'headerBackground', 'sidebarWidth', 'bodyFont', 'pageBackground', 'accent'];
  results.push({ name: 'reference-comparison', compare, shellMatches: compare.slice(1).every((c) => sameKeys.every((k) => c[k] === compare[0][k])) });
} finally {
  await browser.close();
}

const hashes = {};
for (const f of SOURCES) hashes[f] = createHash('sha256').update(await readFile(join(ROOT, f))).digest('hex');
const head = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
const dirty = execSync('git status --porcelain -- blocks gcsp-greg.html components.html server', { cwd: ROOT }).toString().trim();
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'fucq-101-browser-matrix.json'), `${JSON.stringify({ story: 'FUCQ-101', head, sourceTreeClean: dirty === '', base: BASE, browser: 'system Chrome, headless', capturedAt: new Date().toISOString(), sources: hashes, results }, null, 2)}\n`);
const shots = results.filter((r) => r.file);
const sum = (k) => shots.reduce((n, r) => n + (r[k]?.length || 0), 0);
console.log(JSON.stringify({ captures: shots.length, overflowing: shots.filter((r) => r.overflowPx > 0).map((r) => r.name), console: sum('console'), failed: sum('failed'), external: sum('external') }));
