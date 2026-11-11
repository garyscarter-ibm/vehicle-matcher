// FUCQ-368 strict capture of the integrated Account Preferences. Run: perl -e 'alarm shift; exec @ARGV' 900 node docs/gcsp/evidence/fucq368/capture.mjs
// Env: SCRATCH (owned scratch root). Browser settings mirror the frozen reference review.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = process.env.SCRATCH;
if (!scratch) throw new Error('SCRATCH is required');
const PORT = 4941; const IMPL = `http://127.0.0.1:${PORT}`;
const REF_DIR = 'docs/gcsp/mockups/account-preferences-2026-11-10/review';
const tile = (key) => `.gcsp-prefs-open[id$="-tile-${key}"]`;

// [name, width, height, prefs fixture, steps, options]; steps use only the real controls.
const STATES = [
  ['1440-initial', 1440, 1100, 'empty', []],
  ['1440-selected', 1440, 1100, 'selected', []],
  ['1440-options', 1440, 1100, 'selected', [['click', 'body']]],
  ['1440-slider-default', 1440, 1100, 'body-open-unset', [['pick', 'body', 'Touring / Estate'], ['done'], ['click', 'fuel'], ['pick', 'fuel', 'Petrol'], ['done'], ['click', 'comfort']]],
  ['1440-importance-unselected', 1440, 1100, 'empty', [['click', 'body']]],
  ['1440-importance-medium', 1440, 1100, 'empty', [['click', 'body'], ['pick', 'body', 'Touring / Estate']]],
  ['1440-importance-high', 1440, 1100, 'empty', [['click', 'body'], ['pick', 'body', 'Touring / Estate'], ['important']]],
  ['1440-remove-confirmation', 1440, 1100, 'selected', [['bin', 'body']]],
  ['1920-selected', 1920, 1000, 'selected', []],
  ['1100-selected', 1100, 1000, 'selected', []],
  ['1024-selected', 1024, 1000, 'selected', []],
  ['900-selected', 900, 1000, 'selected', []],
  ['820-selected', 820, 1000, 'selected', []],
  ['375-selected', 375, 1000, 'selected', []],
  ['320-long', 320, 1000, 'selected', [], { long: true }],
  ['320-long-options', 320, 1000, 'selected', [['click', 'comfort']], { long: true }],
  ['320-slider-midpoint', 320, 1000, 'selected', [['click', 'comfort'], ['key', 'Home'], ['key', 'ArrowRight']], { long: true }],
  // Reference replay reaches this after a saved slider edit, hence its saved status copy.
  ['320-remove-confirmation', 320, 1000, 'selected', [['click', 'comfort'], ['key', 'Home'], ['key', 'End'], ['done'], ['bin', 'comfort']], { long: true }],
  ['320-importance-unselected', 320, 1000, 'empty', [['click', 'fuel']]],
  ['320-importance-high', 320, 1000, 'empty', [['click', 'fuel'], ['pick', 'fuel', 'Plug-in hybrid'], ['important']]],
  // Service states the frozen reference does not draw: explicit review only, no reference pair.
  ['1440-save-failed', 1440, 1100, 'save-failed', [], { extra: true }],
  ['320-save-failed', 320, 1000, 'save-failed', [], { extra: true }],
  ['1440-stale', 1440, 1100, 'stale', [], { extra: true }],
  ['320-stale', 320, 1000, 'stale', [], { extra: true }],
  ['1440-pending', 1440, 1100, 'pending', [['click', 'size']], { extra: true }],
];

const servers = [];
const stopAll = () => { for (const s of servers) { try { s.kill('SIGKILL'); } catch {} } };
process.on('SIGALRM', () => { stopAll(); process.exit(124); });
const ready = async (url) => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`server not ready: ${url}`);
};
// Longer current-car text lives only in the page-served fixture module; no repo file changes.
const longVariant = (text) => {
  const cut = text.indexOf('export const UNSUPPORTED_SNAPSHOT');
  const head = text.slice(0, cut).replaceAll('"model": "BMW 3 Series Touring 320i"', '"model": "BMW 3 Series 330e xDrive M Sport Pro Touring"')
    .replaceAll('"configuration": "320i M Sport Touring"', '"configuration": "M Sport Pro BMW Individual specification"').replaceAll('"fuel": "petrol"', '"fuel": "phev"');
  return head + text.slice(cut);
};
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('img.vm-card-photo')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(150); await page.evaluate(() => scrollTo(0, 0));
};
async function step(page, [kind, a, b]) {
  if (kind === 'click') await page.locator(tile(a)).click();
  else if (kind === 'bin') await page.getByRole('button', { name: `Remove ${a[0].toUpperCase()}${a.slice(1)} preference`, exact: true }).click();
  else if (kind === 'pick') await page.locator('.gcsp-prefs-panel .vm-option', { hasText: b }).first().click();
  else if (kind === 'done') await page.getByRole('button', { name: 'Done', exact: true }).click();
  else if (kind === 'important') await page.getByRole('switch', { name: 'This is really important' }).click();
  else if (kind === 'key') { await page.locator('.gcsp-prefs-panel input[type=range]').focus(); await page.keyboard.press(a); }
  await page.waitForTimeout(120);
}
const measure = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) }; };
  const details = [...document.querySelectorAll('section')].find((s) => s.getAttribute('aria-labelledby') === 'gcsp-account-details-title');
  const regions = { car: q('.gcsp-feature'), preferences: q('.gcsp-account-preferences'), history: q('.gcsp-account-history'), details };
  const follows = (a, b) => !!(regions[a] && regions[b] && (regions[a].compareDocumentPosition(regions[b]) & Node.DOCUMENT_POSITION_FOLLOWING));
  const sw = q('.gcsp-prefs-panel [role=switch]');
  return { overflow: document.documentElement.scrollWidth > innerWidth,
    boxes: { preferences: box(regions.preferences), tiles: [...document.querySelectorAll('.gcsp-prefs-tile')].map(box), panel: box(q('.gcsp-prefs-panel:not([hidden])')) },
    domOrder: { carBeforePreferences: follows('car', 'preferences'), preferencesBeforeHistory: follows('preferences', 'history'), historyBeforeDetails: follows('history', 'details') },
    tiles: [...document.querySelectorAll('.gcsp-prefs-open')].map((n) => ({ name: n.getAttribute('aria-label'), expanded: n.getAttribute('aria-expanded') })),
    importanceSwitch: sw ? { checked: sw.checked, disabled: sw.disabled, describedBy: sw.getAttribute('aria-describedby') } : null,
    slider: q('.gcsp-prefs-panel input[type=range]') ? { value: q('.gcsp-prefs-panel input[type=range]').value, valuetext: q('.gcsp-prefs-panel input[type=range]').getAttribute('aria-valuetext') } : null,
    status: q('.gcsp-prefs-status')?.textContent ?? null,
    active: (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '').trim().slice(0, 60) };
});
// Keyboard trial at 320: Space on the switch, arrows on the slider, Done and Keep it focus return.
async function keyboardTrial(page) {
  const out = {};
  await page.locator(tile('comfort')).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  const slider = page.locator('.gcsp-prefs-panel input[type=range]');
  await slider.focus(); await page.keyboard.press('Home'); out.home = [await slider.inputValue(), await slider.getAttribute('aria-valuetext')];
  await page.keyboard.press('ArrowRight'); out.arrowRight = [await slider.inputValue(), await slider.getAttribute('aria-valuetext')];
  await page.keyboard.press('End'); out.end = [await slider.inputValue(), await slider.getAttribute('aria-valuetext')];
  const sw = page.getByRole('switch', { name: 'This is really important' }); await sw.focus(); await page.keyboard.press('Space');
  out.spaceHigh = await sw.isChecked(); await page.keyboard.press('Space'); out.spaceMedium = !(await sw.isChecked());
  await page.getByRole('button', { name: 'Done', exact: true }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  out.doneReturnsToTile = await page.evaluate(() => document.activeElement?.id?.endsWith('-tile-comfort'));
  await page.getByRole('button', { name: 'Remove Comfort preference', exact: true }).focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  out.binFocusesKeep = await page.evaluate(() => document.activeElement?.textContent.trim() === 'Keep it');
  await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  out.keepReturnsToBin = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Remove Comfort preference');
  out.keptComfort = await page.locator(tile('comfort')).getAttribute('aria-label');
  return out;
}

const results = { run: 'fucq368-strict-capture', implementationCommit: null, reference: { commit: '193cbf07', dir: REF_DIR }, environment: {}, states: {},
  notes: ['Integrated Account harness gcsp-account.html?fixture=ready&prefs=<start>; prefs fixtures are an in-memory brief transport, states reached through real controls.',
    'Out of scope here and absent by design: star rating (FUCQ-367), Same again and Buddy understanding (FUCQ-369), Engage/Disengage and Buddy lamp (FUCQ-370).',
    '320-* long states serve a longer current-car model through page.route on fixtures.js only.'] };
let browser;
try {
  await mkdir(`${scratch}/impl368`, { recursive: true });
  results.implementationCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  servers.push(spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' }));
  await ready(`${IMPL}/gcsp-account.html`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  results.environment = { browser: browser.version(), deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB', capture: 'fullPage', scroll: [0, 0] };
  for (const [name, width, height, prefs, steps, opts = {}] of STATES) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    if (opts.long) await page.route('**/blocks/gcsp/account/fixtures.js*', async (route) => {
      const res = await route.fetch(); await route.fulfill({ response: res, body: longVariant(await res.text()) });
    });
    const url = `/gcsp-account.html?fixture=ready&prefs=${prefs}`;
    await page.goto(`${IMPL}${url}`);
    await page.locator('.gcsp-prefs-tile').first().waitFor({ timeout: 20000 });
    await settle(page);
    for (const s of steps) await step(page, s);
    await page.waitForTimeout(250);
    const entry = { viewport: { width, height }, url, steps, longVariant: !!opts.long, referencePng: opts.extra ? null : `${REF_DIR}/${name}.png` };
    Object.assign(entry, await measure(page));
    await page.evaluate(() => scrollTo(0, 0)); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${scratch}/impl368/${name}.png`, fullPage: true });
    if (name === '320-long') entry.keyboard = await keyboardTrial(page);
    entry.errors = errors; results.states[name] = entry; await context.close();
  }
  await browser.close(); browser = null;
  await writeFile(`${folder}results.json`, JSON.stringify(results, null, 2));
  const c = spawnSync('python3', ['-I', `${folder}compose.py`, scratch], { stdio: 'inherit' });
  if (c.status !== 0) throw new Error(`compose.py exited ${c.status}`);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  await writeFile(`${folder}results.json`, JSON.stringify({ ...results, failure: String(error.stack) }, null, 2)).catch(() => {});
} finally {
  try { await browser?.close(); } catch {}
  stopAll();
}
