// FUCQ-367 strict capture of the integrated current-car rating. Run: perl -e 'alarm shift; exec @ARGV' 600 node docs/gcsp/evidence/fucq367/capture.mjs
// Env: SCRATCH (owned scratch root; TMPDIR should point inside it). Browser settings mirror the frozen reference review.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = process.env.SCRATCH;
if (!scratch) throw new Error('SCRATCH is required');
const PORT = 3017; const BASE = `http://127.0.0.1:${PORT}`;
const REF_DIR = 'docs/gcsp/mockups/account-preferences-2026-11-10/review';
const REF_PAGE = '/docs/gcsp/mockups/account-preferences-2026-11-10/index.html';
const STAR3 = '3 stars: It’s okay'; const STAR4 = '4 stars: I really like it';
const radio = (page, name) => page.getByRole('radio', { name, exact: true });

// [name, width, height, query, referenceState, run(page), options]; extras have no reference PNG.
const sel = (rating = 4) => `fixture=ready&prefs=selected&rating=${rating}`;
const STATES = [
  ['1440-selected', 1440, 1100, sel(5), 'selected'],
  ['1440-initial', 1440, 1100, 'fixture=ready&prefs=empty&rating=4', 'empty'],
  ['1440-rating-tooltip', 1440, 1100, 'fixture=ready&prefs=empty', 'empty', async (p) => { await radio(p, STAR3).hover(); }, { refHover: STAR3 }],
  ['1920-selected', 1920, 1000, sel(), 'selected'],
  ['1100-selected', 1100, 1000, sel(), 'selected'],
  ['1024-selected', 1024, 1000, sel(), 'selected'],
  ['900-selected', 900, 1000, sel(), 'selected'],
  ['820-selected', 820, 1000, sel(), 'selected'],
  ['375-selected', 375, 1000, sel(), 'selected'],
  ['375-engaged', 375, 1000, sel(), 'selected'],
  ['320-long', 320, 1000, sel(), 'long', null, { long: true }],
  ['320-rating-tooltip-long', 320, 1000, sel(), 'long', async (p) => { await p.locator('h1').click(); await radio(p, STAR4).focus(); }, { long: true, refFocus: STAR4 }],
  ['320-keyboard-focus', 320, 1000, sel(), null, async (p, entry) => { await p.locator('h1').click(); entry.tabSequence = await tabToStar(p); entry.focusTarget = entry.tabSequence.at(-1); }, { long: true, extra: true }],
  ['1440-missing-image', 1440, 1100, 'fixture=missing-image&prefs=selected&rating=4', 'missing'],
  ['1440-cleared', 1440, 1100, sel(), 'empty', async (p) => { await radio(p, STAR4).click(); }, { refPng: '1440-rating-tooltip', extra: false, proxyFor: 'Paired with 1440-rating-tooltip.png star row as a proxy for unrated stars (that PNG also shows its tip, which the cleared state must not); the pointer stays over the cleared star.' }],
  ['1440-rating-failed', 1440, 1100, 'fixture=ready&prefs=rating-failed&rating=4', null, async (p) => { await radio(p, '2 stars: Ready for a change').click(); await p.waitForTimeout(400); }, { extra: true }],
  ['320-rating-failed', 320, 1000, 'fixture=ready&prefs=rating-failed&rating=4', null, async (p) => { await radio(p, '2 stars: Ready for a change').click(); await p.waitForTimeout(400); }, { extra: true }],
  // The transport never answers: the star must stay in its pending state.
  ['1440-rating-pending', 1440, 1100, 'fixture=ready&prefs=pending&rating=4', null, async (p) => { await radio(p, '2 stars: Ready for a change').click(); await p.waitForTimeout(400); }, { extra: true }],
  ['320-rating-pending', 320, 1000, 'fixture=ready&prefs=pending&rating=4', null, async (p) => { await radio(p, '2 stars: Ready for a change').click(); await p.waitForTimeout(400); }, { extra: true }],
  ['1440-keyboard', 1440, 1100, sel(), null, async (p, entry) => { entry.tabSequence = await tabToStar(p); entry.focusTarget = entry.tabSequence.at(-1); }, { extra: true }],
];

// Real Tab presses until a star radio has focus; returns every stop so the focus order is on record.
async function tabToStar(p) {
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await p.keyboard.press('Tab');
    const info = await p.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, label: a?.getAttribute('aria-label') || a?.textContent?.trim().slice(0, 40), inRating: !!a?.closest('.gcsp-star-rating'), checked: a?.checked ?? null }; });
    seen.push(info); if (info.inRating) break;
  }
  return seen;
}

const servers = [];
const stopAll = () => { for (const s of servers) { try { process.kill(-s.pid, 'SIGKILL'); } catch {} } };
process.on('SIGALRM', () => { stopAll(); process.exit(124); });
// The harness page has no favicon link, so Chrome's one-off /favicon.ico 404 is answered here and not counted as an error.
const quietFavicon = (context) => context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
const ready = async (url) => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`server not ready: ${url}`);
};
// Same long-model replacement text as FUCQ-368; page-served only, no repo file changes.
const longVariant = (text) => {
  const cut = text.indexOf('export const UNSUPPORTED_SNAPSHOT');
  const head = text.slice(0, cut).replaceAll('"model": "BMW 3 Series Touring 320i"', '"model": "BMW 3 Series 330e xDrive M Sport Pro Touring"')
    .replaceAll('"configuration": "320i M Sport Touring"', '"configuration": "M Sport Pro BMW Individual specification"').replaceAll('"fuel": "petrol"', '"fuel": "phev"');
  return head + text.slice(cut);
};
const routeLong = (page) => page.route('**/blocks/gcsp/account/fixtures.js*', async (route) => {
  const res = await route.fetch(); await route.fulfill({ response: res, body: longVariant(await res.text()) });
});
const settle = async (page, photoSel) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction((s) => [...document.querySelectorAll(s)].every((i) => i.complete && i.naturalWidth > 0), photoSel, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(150); await page.evaluate(() => scrollTo(0, 0));
};
// Watches Account's single live region; each non-empty text added counts as one announcement.
const watchLive = (page) => page.evaluate(() => {
  const node = document.querySelector('gcsp-account > .gcsp-vh'); window.__live = [];
  if (node) new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.textContent) window.__live.push(n.textContent); }).observe(node, { childList: true, characterData: true, subtree: true });
  return !!node;
});

// Geometry shared by both pages: media box, drawn image box (object-fit contain), rating box, glyph and target sizes.
const GEOMETRY = `(sel) => {
  const q = (s) => document.querySelector(s);
  const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: +(r.x + scrollX).toFixed(2), y: +(r.y + scrollY).toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) }; };
  const media = q(sel.media); const photo = q(sel.photo); const rating = q(sel.rating); const m = box(media);
  let drawn = m;
  if (photo && photo.naturalWidth) { const r = photo.getBoundingClientRect(); const k = Math.min(r.width / photo.naturalWidth, r.height / photo.naturalHeight);
    drawn = { x: +(r.x + scrollX + (r.width - photo.naturalWidth * k) / 2).toFixed(2), y: +(r.y + scrollY + (r.height - photo.naturalHeight * k) / 2).toFixed(2), width: +(photo.naturalWidth * k).toFixed(2), height: +(photo.naturalHeight * k).toFixed(2) }; }
  const rb = box(rating); const tip = q(sel.tip); const glyph = q(sel.glyph); const target = q(sel.target);
  const tb = tip && !tip.hidden ? box(tip) : null;
  const checked = [...document.querySelectorAll(sel.radios)].find((n) => n.checked);
  return { media: m, hasPhoto: !!(photo && photo.naturalWidth), drawnImage: drawn, rating: rb,
    gapRight: rb ? +((drawn.x + drawn.width) - (rb.x + rb.width)).toFixed(2) : null, gapBottom: rb ? +((drawn.y + drawn.height) - (rb.y + rb.height)).toFixed(2) : null,
    mediaGapRight: rb ? +((m.x + m.width) - (rb.x + rb.width)).toFixed(2) : null, mediaGapBottom: rb ? +((m.y + m.height) - (rb.y + rb.height)).toFixed(2) : null,
    glyph: glyph ? box(glyph) : null, target: target ? box(target) : null, checked: checked ? checked.value : null,
    tipVisible: !!tb, tipBox: tb, tipText: tip ? tip.textContent : null, legend: q(sel.legend)?.textContent ?? null,
    tipInsideViewport: tb ? (tb.x >= 0 && tb.x + tb.width <= innerWidth) : null,
    ratingInsideViewport: rb ? (rb.x >= 0 && rb.x + rb.width <= innerWidth) : null, overflow: document.documentElement.scrollWidth > innerWidth, docHeight: document.documentElement.scrollHeight };
}`;
const IMPL_SEL = { media: '.gcsp-feature .vm-card-media', photo: '.gcsp-feature .vm-card-photo', rating: '.gcsp-star-rating', tip: '.gcsp-star-rating .gcsp-help-tip', glyph: '.gcsp-star svg', target: '.gcsp-star',
  radios: '.gcsp-star input', legend: '.gcsp-star-rating > legend' };
const REF_SEL = { media: '.concept-car .vm-card-media', photo: '.concept-car .vm-card-photo', rating: '.concept-rating', tip: '#rating-help', glyph: '.concept-star svg', target: '.concept-star',
  radios: '.concept-star input', legend: '.concept-rating legend' };
const geometry = (page, sel) => page.evaluate(`(${GEOMETRY})(${JSON.stringify(sel)})`);

const measureImpl = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const details = [...document.querySelectorAll('section')].find((s) => s.getAttribute('aria-labelledby') === 'gcsp-account-details-title');
  const regions = { car: q('.gcsp-feature'), preferences: q('.gcsp-account-preferences'), history: q('.gcsp-account-history'), details };
  const follows = (a, b) => !!(regions[a] && regions[b] && (regions[a].compareDocumentPosition(regions[b]) & Node.DOCUMENT_POSITION_FOLLOWING));
  const fs = q('.gcsp-star-rating'); const retry = fs?.querySelector('.vm-btn');
  const failedBox = (s) => { const n = q(s); if (!n || n.hidden) return null; const b = n.getBoundingClientRect(); const m = q('.gcsp-feature .vm-card-media').getBoundingClientRect();
    return { x: +(b.x + scrollX).toFixed(2), y: +(b.y + scrollY).toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2),
      insideImage: b.x >= m.x && b.y >= m.y && b.right <= m.right && b.bottom <= m.bottom, insideViewport: b.x >= 0 && b.right <= innerWidth,
      insetRight: +(m.right - b.right).toFixed(2), insetBottom: +(m.bottom - b.bottom).toFixed(2) }; };
  const r = retry?.getBoundingClientRect();
  return { helpText: q('.gcsp-star-rating .gcsp-help-tip')?.textContent ?? null, liveText: q('gcsp-account > .gcsp-vh')?.textContent ?? null, ratingStatus: fs?.dataset.status ?? null,
    liveCountOnPage: document.querySelectorAll('gcsp-account > .gcsp-vh').length, heading: q('.gcsp-feature .gcsp-h2')?.textContent ?? null, spec: q('.gcsp-feature .gcsp-account-spec')?.textContent ?? null,
    domOrder: { carBeforePreferences: follows('car', 'preferences'), preferencesBeforeHistory: follows('preferences', 'history'), historyBeforeDetails: follows('history', 'details') },
    ariaBusy: fs?.getAttribute('aria-busy') ?? null, visibleStars: [...document.querySelectorAll('.gcsp-star')].map((n) => n.classList.contains('is-filled')),
    failedLine: failedBox('.gcsp-star-failed'), failedText: (() => { const n = q('.gcsp-star-failed'); return n && !n.hidden ? n.textContent : null; })(), retryName: retry?.getAttribute('aria-label') ?? null,
    footerFailure: /not saved|failed|try again|could not/i.test(q('.gcsp-account-preferences')?.innerText ?? ''), footerText: q('.gcsp-prefs-statusline')?.textContent?.trim() ?? null,
    retryVisible: retry ? !retry.hidden && !!(r.width && r.height) : null, retryBox: retry && !retry.hidden ? { x: +(r.x + scrollX).toFixed(1), y: +(r.y + scrollY).toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) } : null,
    prefsStatus: q('.gcsp-prefs-status')?.textContent ?? null, active: (document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName || '').slice(0, 60) };
});

// Real-control checks on 1440, ready, selected, rating=4.
async function interactions(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
  await quietFavicon(context); const page = await context.newPage(); const log = []; const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const url = `${BASE}/gcsp-account.html?${sel(4)}`;
  await page.goto(url); await page.locator('.gcsp-star-rating').waitFor({ timeout: 20000 }); await settle(page, 'img.vm-card-photo'); await watchLive(page);
  const snap = () => page.evaluate(() => ({ checked: [...document.querySelectorAll('.gcsp-star input')].find((n) => n.checked)?.value ?? null, status: document.querySelector('.gcsp-star-rating').dataset.status,
    tipVisible: !document.querySelector('.gcsp-star-rating .gcsp-help-tip').hidden, announcements: window.__live.slice(), focus: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName }));
  const act = async (label, fn, expect) => {
    const before = await snap(); await fn(); await page.waitForTimeout(350); const after = await snap();
    const added = after.announcements.slice(before.announcements.length);
    const entry = { step: label, checked: after.checked, status: after.status, tipVisible: after.tipVisible, newAnnouncements: added, focus: after.focus, expect };
    entry.pass = (expect.checked === undefined || after.checked === expect.checked) && (expect.status === undefined || after.status === expect.status)
      && (expect.tipVisible === undefined || after.tipVisible === expect.tipVisible) && (expect.announce === undefined || (added.length === expect.announce.length && added.every((t, i) => t === expect.announce[i])));
    log.push(entry);
  };
  const star = (n, words) => radio(page, `${n} ${n === 1 ? 'star' : 'stars'}: ${words}`);
  const s5 = star(5, 'I love it'); const s3 = star(3, 'It’s okay'); const s2 = star(2, 'Ready for a change'); const s4 = star(4, 'I really like it');
  await act('click star 5', () => s5.click(), { checked: '5', status: 'saved', tipVisible: false, announce: ['Rating saved: 5 of 5'] });
  await act('click star 5 again clears', () => s5.click(), { checked: null, status: 'saved', tipVisible: false, announce: ['Rating cleared'] });
  await page.locator('h1').click(); await s3.focus();
  const opened = await snap();
  log.push({ step: 'focus star 3 shows the tip', tipVisible: opened.tipVisible, checked: opened.checked, pass: opened.tipVisible && opened.checked === null });
  await act('Space on star 3 selects', () => page.keyboard.press('Space'), { checked: '3', status: 'saved', tipVisible: false, announce: ['Rating saved: 3 of 5'] });
  await act('Space again clears', () => page.keyboard.press('Space'), { checked: null, status: 'saved', tipVisible: false, announce: ['Rating cleared'] });
  await act('Enter selects', () => page.keyboard.press('Enter'), { checked: '3', status: 'saved', tipVisible: false, announce: ['Rating saved: 3 of 5'] });
  await act('ArrowRight moves to 4 and selects', () => page.keyboard.press('ArrowRight'), { checked: '4', status: 'saved', tipVisible: false, announce: ['Rating saved: 4 of 5'] });
  await act('ArrowLeft moves to 3 and selects', () => page.keyboard.press('ArrowLeft'), { checked: '3', status: 'saved', tipVisible: false, announce: ['Rating saved: 3 of 5'] });
  await page.locator('h1').click(); await page.mouse.move(5, 5); await s2.focus();
  const tipOpen = await snap();
  log.push({ step: 'focus star 2 (away from host) shows the tip', tipVisible: tipOpen.tipVisible, checked: tipOpen.checked, pass: tipOpen.tipVisible && tipOpen.checked === '3' });
  await act('Escape hides the open tip and keeps focus', () => page.keyboard.press('Escape'), { tipVisible: false, checked: '3', announce: [] });
  log.at(-1).focusStillOnStar2 = log.at(-1).focus === '2 stars: Ready for a change'; log.at(-1).pass = log.at(-1).pass && log.at(-1).focusStillOnStar2;
  await page.goto(url); await page.locator('.gcsp-star-rating').waitFor({ timeout: 20000 }); await settle(page, 'img.vm-card-photo'); await watchLive(page);
  const afterReload = await snap();
  log.push({ step: 'reload with rating=4: in-memory fixture value is not kept (expected)', checked: afterReload.checked, pass: afterReload.checked === '4',
    note: 'Last saved value before reload was 3; the fixture transport lives in page memory, real persistence is covered by the HTTP test.' });
  await context.close();
  return { url, steps: log, errors, pass: log.every((s) => s.pass) && errors.length === 0 };
}

const results = { run: 'fucq367-strict-capture', implementationCommit: null, reference: { commit: '193cbf07', dir: REF_DIR }, environment: {}, states: {}, interactions: null, checks: [],
  notes: ['Integrated Account harness gcsp-account.html?fixture=<name>&prefs=<state>&rating=<n>; the in-memory transport has no persistence across reloads.',
    'Reference geometry is measured live from the frozen mockup page (same browser settings) to locate the media box for the zoom crops.',
    'Out of scope and absent by design: Buddy lamp and understanding (FUCQ-369), Same again (FUCQ-369), Engage (FUCQ-370).',
    '320-* long states serve a longer current-car model through page.route on fixtures.js only.'] };
const check = (state, label, pass, detail) => results.checks.push({ state, label, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
let browser;
try {
  await mkdir(`${scratch}/impl367`, { recursive: true });
  results.implementationCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  servers.push(spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore', detached: true }));
  await ready(`${BASE}/gcsp-account.html`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  results.environment = { browser: browser.version(), deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB', capture: 'fullPage', scroll: [0, 0] };
  for (const [name, width, height, query, refState, run, opts = {}] of STATES) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
    await quietFavicon(context); const page = await context.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().replace(BASE, '')}`); });
    if (opts.long) await routeLong(page);
    const url = `/gcsp-account.html?${query}`;
    await page.goto(`${BASE}${url}`);
    await page.locator('.gcsp-star-rating').waitFor({ timeout: 20000 });
    await settle(page, 'img.vm-card-photo');
    await watchLive(page);
    const entry = { viewport: { width, height }, url, steps: [], longVariant: !!opts.long };
    if (run) { entry.steps.push(String(run).replace(/\s+/g, ' ').slice(0, 220)); await run(page, entry); }
    await page.waitForTimeout(300);
    const refName = opts.extra ? null : (opts.refPng ?? name);
    entry.referencePng = refName ? `${REF_DIR}/${refName}.png` : null;
    Object.assign(entry, { impl: await geometry(page, IMPL_SEL) }, await measureImpl(page));
    entry.errors = errors; if (opts.proxyFor) entry.pairing = opts.proxyFor;
    await page.evaluate(() => scrollTo(0, 0)); await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${scratch}/impl367/${name}.png`, fullPage: true });
    if (refName) {
      // Same browser settings on the frozen mockup, to place the zoom crop and compare the tip.
      const rp = await context.newPage();
      await rp.goto(`${BASE}${REF_PAGE}?state=${refState}`); await rp.locator('.concept-page').waitFor({ timeout: 20000 }); await settle(rp, 'img.vm-card-photo');
      if (opts.refHover) await rp.getByRole('radio', { name: opts.refHover, exact: true }).hover();
      if (opts.refFocus) await rp.getByRole('radio', { name: opts.refFocus, exact: true }).focus();
      await rp.waitForTimeout(250);
      entry.ref = await geometry(rp, REF_SEL);
      entry.ref.helpText = await rp.evaluate(() => document.querySelector('#rating-help')?.textContent ?? null);
      await rp.close();
    }
    results.states[name] = entry; await context.close();
    const c = entry.impl; const e = entry;
    check(name, 'no horizontal overflow', !c.overflow);
    check(name, 'no page or console errors', errors.length === 0, errors);
    check(name, 'region order car, preferences, history, details', e.domOrder.carBeforePreferences && e.domOrder.preferencesBeforeHistory && e.domOrder.historyBeforeDetails);
    check(name, 'star glyph 24x24', c.glyph && c.glyph.width === 24 && c.glyph.height === 24, c.glyph);
    check(name, 'star target 44x44', c.target && c.target.width === 44 && c.target.height === 44, c.target);
    check(name, 'rating gap to drawn image right is 8', c.gapRight !== null && Math.abs(c.gapRight - 8) < 1, c.gapRight);
    check(name, 'rating gap to drawn image bottom is 8', c.gapBottom !== null && Math.abs(c.gapBottom - 8) < 1, c.gapBottom);
    check(name, 'rating inside viewport', c.ratingInsideViewport);
    if (c.tipVisible) check(name, 'open tip inside viewport', c.tipInsideViewport, c.tipBox);
    if (e.ref) check(name, 'rating box offset from media matches reference', Math.abs((c.rating.x - c.media.x) - (e.ref.rating.x - e.ref.media.x)) < 1 && Math.abs((c.rating.y - c.media.y) - (e.ref.rating.y - e.ref.media.y)) < 1,
      { impl: [c.rating.x - c.media.x, c.rating.y - c.media.y], ref: [e.ref.rating.x - e.ref.media.x, e.ref.rating.y - e.ref.media.y] });
    if (e.ref) check(name, 'media box size matches reference', Math.abs(c.media.width - e.ref.media.width) < 1 && Math.abs(c.media.height - e.ref.media.height) < 1, { impl: c.media, ref: e.ref.media });
  }
  for (const [n, want] of [['1440-selected', '5'], ['1440-initial', '4'], ['1920-selected', '4'], ['320-long', '4'], ['320-rating-tooltip-long', '4'], ['1440-missing-image', '4'], ['1440-rating-tooltip', null], ['1440-cleared', null]]) {
    check(n, `checked value is ${want ?? 'none'}`, results.states[n].impl.checked === want, results.states[n].impl.checked);
  }
  check('1440-rating-tooltip', 'tip visible on hover', results.states['1440-rating-tooltip'].impl.tipVisible);
  check('320-rating-tooltip-long', 'tip visible on keyboard focus with 4 still checked', results.states['320-rating-tooltip-long'].impl.tipVisible && results.states['320-rating-tooltip-long'].impl.checked === '4');
  check('1440-cleared', 'tip hidden after clearing with the pointer still over the star', !results.states['1440-cleared'].impl.tipVisible);
  for (const k of ['1440-rating-failed', '320-rating-failed']) {
    const s = results.states[k]; const ft = s.failedLine; const rb = s.retryBox;
    check(k, 'rating status is failed', s.ratingStatus === 'failed', s.ratingStatus);
    check(k, 'failed line shows visible text "Rating not saved"', /Rating not saved/.test(s.failedText ?? ''), s.failedText);
    check(k, 'Try again visible, accessible name, >=44px high', s.retryVisible && s.retryName === 'Try saving your rating again' && rb && rb.height >= 44, { name: s.retryName, box: rb });
    check(k, 'failed line inside image and viewport with 8px right and bottom inset on the rating block', ft && ft.insideImage && ft.insideViewport && s.impl.gapRight === 8 && Math.abs(s.impl.gapBottom - 8) < 1, { ft, gapRight: s.impl.gapRight, gapBottom: s.impl.gapBottom });
    check(k, 'failed line sits above the stars', ft && ft.y + ft.height <= s.impl.target.y + 1, { failedBottom: ft && ft.y + ft.height, starTop: s.impl.target.y });
    check(k, 'Preferences footer shows no failure', !s.footerFailure, s.footerText);
    check(k, 'two stars filled, rating 2 checked', s.impl.checked === '2' && s.visibleStars.filter(Boolean).length === 2, s.visibleStars);
  }
  for (const k of ['1440-rating-pending', '320-rating-pending']) {
    const s = results.states[k];
    check(k, 'pending: data-status pending and aria-busy true', s.ratingStatus === 'pending' && s.ariaBusy === 'true', { status: s.ratingStatus, busy: s.ariaBusy });
    check(k, 'pending: two stars visible and no failed line', s.visibleStars.filter(Boolean).length === 2 && !s.failedLine, s.visibleStars);
    check(k, 'pending: rating inside image with 8px inset', Math.abs(s.impl.gapRight - 8) < 1 && Math.abs(s.impl.gapBottom - 8) < 1);
  }
  for (const k of ['1440-keyboard', '320-keyboard-focus']) check(k, 'Tab reaches a star radio', !!results.states[k].focusTarget?.inRating, results.states[k].focusTarget);
  results.interactions = await interactions(browser);
  check('interactions', 'all real-control interaction steps pass', results.interactions.pass);
  await browser.close(); browser = null;
  results.summary = { checks: results.checks.length, passed: results.checks.filter((c) => c.pass).length, failed: results.checks.filter((c) => !c.pass).map((c) => `${c.state}: ${c.label}`) };
  await writeFile(`${folder}results.json`, JSON.stringify(results, null, 2));
  const c = spawnSync('python3', ['-I', `${folder}compose.py`, scratch], { stdio: 'inherit' });
  if (c.status !== 0) throw new Error(`compose.py exited ${c.status}`);
  console.log(JSON.stringify(results.summary, null, 1));
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
  await writeFile(`${folder}results.json`, JSON.stringify({ ...results, failure: String(error.stack) }, null, 2)).catch(() => {});
} finally {
  try { await browser?.close(); } catch {}
  stopAll();
}
