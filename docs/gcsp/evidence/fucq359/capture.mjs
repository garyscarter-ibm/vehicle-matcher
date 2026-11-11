// FUCQ-359 strict capture. Run: perl -e 'alarm shift; exec @ARGV' 900 node docs/gcsp/evidence/fucq359/capture.mjs
// Env: SCRATCH (owned scratch root). Browser settings mirror the frozen reference review.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const baseRoot = '/Users/usget/Claude/vehicle-matcher';
const scratch = process.env.SCRATCH;
if (!scratch) throw new Error('SCRATCH is required');
const IMPL = 'http://127.0.0.1:4931';
const BASE = 'http://127.0.0.1:4932';
const REF_DIR = 'docs/gcsp/mockups/account-preferences-2026-11-10/review';

const STATES = [
  ['1920-selected', 1920, 1000, 'ready'], ['1440-selected', 1440, 1100, 'ready'], ['1100-selected', 1100, 1000, 'ready'],
  ['1024-selected', 1024, 1000, 'ready'], ['900-selected', 900, 1000, 'ready'], ['820-selected', 820, 1000, 'ready'],
  ['375-selected', 375, 1000, 'ready'], ['375-engaged', 375, 1000, 'ready'], ['320-long', 320, 1000, 'ready', { long: true }],
  ['1440-missing-image', 1440, 1100, 'missing-image'], ['1440-record-drawer', 1440, 1000, 'ready', { drawer: true }],
  ['375-record-drawer', 375, 1000, 'ready', { drawer: true }],
];
const NEIGHBOURS = ['gcsp-employee.html', 'gcsp-offer.html', 'gcsp-brief.html', 'gcsp-greg.html', 'components.html'];

const servers = [];
const start = (cwd, port) => {
  const child = spawn(process.execPath, ['scripts/serve.js'], { cwd, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  servers.push(child); return child;
};
const stopAll = () => { for (const s of servers) { try { s.kill('SIGKILL'); } catch {} } };
process.on('SIGALRM', () => { stopAll(); process.exit(124); });
const ready = async (url) => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`server not ready: ${url}`);
};

// Longer model text lives only in the page-served module; no repo file changes.
const longVariant = (text) => {
  const cut = text.indexOf('export const UNSUPPORTED_SNAPSHOT');
  const head = text.slice(0, cut).replaceAll('"model": "BMW 3 Series Touring 320i"', '"model": "BMW 3 Series 330e xDrive M Sport Pro Touring"')
    .replaceAll('"configuration": "320i M Sport Touring"', '"configuration": "M Sport Pro BMW Individual specification"')
    .replaceAll('"fuel": "petrol"', '"fuel": "phev"');
  return head + text.slice(cut);
};

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('img.vm-card-photo')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 });
  await page.evaluate(() => scrollTo(0, 0));
};

const measure = (page, withKeys) => page.evaluate(() => {
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; };
  const q = (s) => document.querySelector(s);
  const details = [...document.querySelectorAll('section')].find((s) => s.getAttribute('aria-labelledby') === 'gcsp-account-details-title');
  const regions = { car: q('.gcsp-feature'), preferences: q('.gcsp-account-preferences'), history: q('.gcsp-account-history'), details };
  const img = q('img.vm-card-photo');
  let drawn = null;
  if (img && img.naturalWidth) {
    const b = box(img); const scale = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight);
    drawn = { x: b.x + (b.width - img.naturalWidth * scale) / 2, y: b.y + (b.height - img.naturalHeight * scale) / 2, width: img.naturalWidth * scale, height: img.naturalHeight * scale };
  }
  const media = box(q('.vm-card-media'));
  const names = ['car', 'preferences', 'history', 'details'];
  const pos = (a, b) => !!(regions[a] && regions[b] && (regions[a].compareDocumentPosition(regions[b]) & Node.DOCUMENT_POSITION_FOLLOWING));
  const tops = Object.fromEntries(names.map((n) => [n, regions[n] ? box(regions[n]).y : null]));
  const body = q('.gcsp-account-body');
  const text = body?.innerText ?? '';
  const facts = q('.gcsp-account-car-facts')?.innerText ?? '';
  const pointsLine = (facts.match(/Points cost[\s\S]{0,60}/) ?? [''])[0].replace(/\s+/g, ' ').trim();
  return {
    overflow: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth,
    boxes: { body: box(body), feature: box(regions.car), featureMedia: box(q('.gcsp-feature-media')), cardMedia: media, drawnImage: drawn,
      preferences: box(regions.preferences), history: box(regions.history), details: box(details) },
    mediaMinusDrawnHeight: media && drawn ? media.height - drawn.height : null,
    domOrder: { carBeforePreferences: pos('car', 'preferences'), preferencesBeforeHistory: pos('preferences', 'history'), historyBeforeDetails: pos('history', 'details') },
    visualTops: tops,
    visualOrderIncreasing: names.every((n, i) => i === 0 || (tops[n] != null && tops[names[i - 1]] != null && tops[n] > tops[names[i - 1]])),
    absent: { accountKey: !q('.gcsp-account-key'),
      viewCarRecord: ![...document.querySelectorAll('body *')].some((n) => n.children.length === 0 && /view car record/i.test(n.textContent)),
      buddyCard: !([...document.querySelectorAll('.gcsp-account-body h1, .gcsp-account-body h2, .gcsp-account-body h3, .gcsp-account-body [class*=buddy]')].some((n) => /your buddy/i.test(n.textContent) || /buddy/i.test(n.className))) },
    pointsCostLine: pointsLine, pointsCostCount: (text.match(/Points cost/g) ?? []).length,
    headings: [...document.querySelectorAll('.gcsp-account-body h1, .gcsp-account-body h2')].map((h) => h.textContent.trim()),
    currentModel: q('.gcsp-feature h2, .gcsp-feature h3')?.textContent.trim() ?? null,
  };
});

const tabOrder = async (page) => {
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  const seq = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const item = await page.evaluate(() => {
      const el = document.activeElement; if (!el || el === document.body) return null;
      const inSec = (n) => el.closest(n);
      const details = el.closest('section')?.getAttribute('aria-labelledby') === 'gcsp-account-details-title';
      const region = inSec('.gcsp-feature') ? 'car' : inSec('.gcsp-account-preferences') ? 'preferences' : inSec('.gcsp-account-history') ? 'history' : details ? 'details' : 'other';
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      return { tag: el.tagName.toLowerCase(), name, region };
    });
    if (!item) break; seq.push(item);
  }
  const regions = []; for (const s of seq) if (regions.at(-1) !== s.region) regions.push(s.region);
  return { stops: seq, regionSequence: regions };
};

const drawerChecks = async (page) => {
  const opener = page.locator('.gcsp-account-history tbody button').first();
  const same = () => opener.evaluate((n) => n === document.activeElement);
  const out = {};
  await opener.click(); await page.locator('aside.gcsp-side-drawer-panel[role=dialog]').waitFor();
  out.heading = await page.evaluate(() => { const d = document.querySelector('aside.gcsp-side-drawer-panel[role=dialog]'); const id = d.getAttribute('aria-labelledby'); return (id && document.getElementById(id)?.textContent.trim()) || d.querySelector('h1,h2')?.textContent.trim(); });
  out.sectionHeadings = await page.evaluate(() => [...document.querySelectorAll('aside.gcsp-side-drawer-panel[role=dialog] h2, aside.gcsp-side-drawer-panel[role=dialog] h3')].map((h) => h.textContent.trim()));
  out.focusInsideDialog = await page.evaluate(() => !!document.activeElement?.closest('aside.gcsp-side-drawer-panel[role=dialog]'));
  out.dialogBox = await page.locator('aside.gcsp-side-drawer-panel[role=dialog]').boundingBox();
  await settle(page);
  return { out, close: async () => {
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    out.escape = { dialogGone: (await page.locator('aside.gcsp-side-drawer-panel[role=dialog]').count()) === 0, focusReturnedToOpener: await same() };
    await opener.click(); await page.locator('aside.gcsp-side-drawer-panel[role=dialog]').waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).first().click(); await page.waitForTimeout(300);
    out.closeButton = { dialogGone: (await page.locator('aside.gcsp-side-drawer-panel[role=dialog]').count()) === 0, focusReturnedToOpener: await same() };
  } };
};

const results = { run: 'fucq359-strict-capture', implementationCommit: null, reference: { commit: '193cbf07', dir: REF_DIR, note: 'Reference PNGs are not copied; cited by repo path.' },
  environment: {}, states: {}, neighbours: {}, notes: [
    '320-long is a capture-time data variant: fixtures.js served via page.route with a longer model and specification in ACCOUNT_SNAPSHOT only (all occurrences of the current-car model/configuration strings).',
    '375-engaged and 375-selected use the same ready fixture; the real page cannot start Buddy in a read-only fixture, so the reference Buddy-engaged state is not reproduced.'] };
let browser;
try {
  await mkdir(`${scratch}/impl`, { recursive: true }); await mkdir(`${scratch}/neighbours`, { recursive: true });
  results.implementationCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  start(root, 4931); start(baseRoot, 4932);
  await Promise.all([ready(`${IMPL}/gcsp-account.html`), ready(`${BASE}/gcsp-account.html`)]);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  results.environment = { browser: browser.version(), deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB', capture: 'fullPage' };

  for (const [name, width, height, fixture, opts = {}] of STATES) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    if (opts.long) await page.route('**/blocks/gcsp/account/fixtures.js*', async (route) => {
      const res = await route.fetch(); await route.fulfill({ response: res, body: longVariant(await res.text()) });
    });
    await page.goto(`${IMPL}/gcsp-account.html?fixture=${fixture}`);
    await page.locator('.gcsp-account-body').waitFor({ timeout: 20000 });
    await page.locator('.gcsp-account-preferences').waitFor({ timeout: 20000 }).catch(() => {});
    await settle(page);
    const entry = { viewport: { width, height }, url: `/gcsp-account.html?fixture=${fixture}`, referencePng: `${REF_DIR}/${name}.png`, longVariant: !!opts.long };
    Object.assign(entry, await measure(page));
    if (width === 1440 || width === 375) {
      if (!opts.drawer) { entry.keyboard = await tabOrder(page); await page.evaluate(() => { document.activeElement?.blur(); }); await settle(page); }
    }
    if (opts.drawer) {
      const d = await drawerChecks(page);
      await page.screenshot({ path: `${scratch}/impl/${name}.png`, fullPage: true });
      await d.close(); entry.drawer = d.out;
    } else {
      await settle(page);
      await page.screenshot({ path: `${scratch}/impl/${name}.png`, fullPage: true });
    }
    entry.errors = errors;
    results.states[name] = entry;
    await context.close();
  }

  // Neighbour check at 1440x1000: base (4932) vs branch (4931).
  for (const [label, origin] of [['branch', IMPL], ['base', BASE]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
    for (const p of NEIGHBOURS) {
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      await page.goto(`${origin}/${p}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000); await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${scratch}/neighbours/${p.replace('.html', '')}-${label}.png`, fullPage: true });
      (results.neighbours[p] ??= { errors: {} }).errors[label] = errors;
      await page.close();
    }
    await context.close();
  }
  await browser.close(); browser = null;
  await writeFile(`${folder}results.json`, JSON.stringify(results, null, 2));
  const c = spawnSync('python3', ['-I', `${folder}compose.py`, scratch], { stdio: 'inherit', env: { ...process.env } });
  if (c.status !== 0) throw new Error(`compose.py exited ${c.status}`);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  await writeFile(`${folder}results.json`, JSON.stringify({ ...results, failure: String(error.stack) }, null, 2)).catch(() => {});
} finally {
  try { await browser?.close(); } catch {}
  stopAll();
}
