// FUCQ-369 strict paired capture of Same again and Buddy understanding. Run: perl -e 'alarm shift; exec @ARGV' 600 node docs/gcsp/evidence/fucq369/capture.mjs
// Env: SCRATCH (owned scratch root; TMPDIR should point inside it). Browser settings mirror the frozen reference review.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = process.env.SCRATCH;
if (!scratch) throw new Error('SCRATCH is required');
const PORT = 3027; const BASE = `http://127.0.0.1:${PORT}`;
const REF_DIR = 'docs/gcsp/mockups/account-preferences-2026-11-10/review';
const REF_PAGE = '/docs/gcsp/mockups/account-preferences-2026-11-10/index.html';
const MANIFEST = JSON.parse(await readFile(`${root}docs/gcsp/mockups/account-preferences-2026-11-10/design-reference.json`, 'utf8')).screenshots;
const byFile = Object.fromEntries(MANIFEST.map((s) => [s.file.replace(/\.png$/, ''), s]));
const SAME_NAME = 'Same again, please!';
const SCORES = [1, 3, 4, 6, 7, 9, 10];

// [name, query, steps, options]. Paired states take viewport and expectations from the manifest; extras give a viewport.
// Steps: tile:<key> pick:<label> important same sameOff hoverInfo clickInfo focusSwitch record. Both pages get the same steps.
const sel = (rating = 4) => `fixture=ready&prefs=selected&rating=${rating}`;
const EMPTY = 'fixture=ready&prefs=empty';
const HIGH = ['tile:body', 'pick:Touring / Estate', 'important', 'done'];
const STATES = [
  ['1440-initial', `${EMPTY}&rating=4`, [], { refMode: 'empty' }],
  ['1440-same-tooltip', EMPTY, ['hoverInfo'], { refMode: 'empty' }],
  ['1440-same-again', sel(5), ['same'], { refMode: 'selected' }],
  ['1440-same-again-retained-high', EMPTY, [...HIGH, 'same'], { refMode: 'empty' }],
  ['1440-selected', sel(5), [], { refMode: 'selected' }],
  ['1920-selected', sel(), [], { refMode: 'selected' }],
  ['1100-selected', sel(), [], { refMode: 'selected' }],
  ['1024-selected', sel(), [], { refMode: 'selected' }],
  ['900-selected', sel(), [], { refMode: 'selected' }],
  ['820-selected', sel(), [], { refMode: 'selected' }],
  ['375-selected', sel(), [], { refMode: 'selected' }],
  ['320-long', sel(), [], { refMode: 'long', long: true }],
  ['320-same-again', sel(), ['same'], { refMode: 'long', long: true }],
  ['320-same-again-neutral', sel(), ['same'], { refMode: 'long', long: true }],
  ['320-same-tooltip-long', sel(), ['focusInfo'], { refMode: 'long', long: true }],
  ['1440-importance-medium', EMPTY, ['tile:body', 'pick:Touring / Estate'], { refMode: 'empty' }],
  ['1440-importance-high', EMPTY, ['tile:body', 'pick:Touring / Estate', 'important'], { refMode: 'empty' }],
  ['1440-validation', `${EMPTY}&rating=4`, [], { refMode: 'empty', expected: 'Engage validation ("Choose 3 more categories to engage Buddy") belongs to FUCQ-370; implementation shows the empty state.' }],
  ['375-engaged', sel(), [], { refMode: 'selected', expected: 'Engage Buddy and the engaged lamp belong to FUCQ-370; implementation shows the not-engaged state.' }],
  ['1440-record-drawer', sel(), ['record'], { refMode: 'selected' }],
  ['375-record-drawer', sel(), ['record'], { refMode: 'selected' }],
  // Implementation-only states (no reference image): explicit review.
  ['1440-restored', sel(), ['same', 'sameOff'], { extra: true, viewport: [1440, 1100], restore: true, refMode: 'selected' }],
  ['320-restored', sel(), ['same', 'sameOff'], { extra: true, viewport: [320, 1000], restore: true, long: true, refMode: 'long' }],
  ['1440-restored-high', EMPTY, [...HIGH, 'same', 'sameOff'], { extra: true, viewport: [1440, 1100], restore: true, refMode: 'empty' }],
  ['1440-no-current-car', 'fixture=no-current-car&prefs=selected', [], { extra: true, viewport: [1440, 1100], unavailable: true }],
  ['320-no-current-car', 'fixture=no-current-car&prefs=selected', [], { extra: true, viewport: [320, 1000], unavailable: true }],
  ['1440-same-again-failed', `${sel()}`.replace('prefs=selected', 'prefs=same-again-failed'), [], { extra: true, viewport: [1440, 1100], failed: true }],
  ['320-same-again-failed', `${sel()}`.replace('prefs=selected', 'prefs=same-again-failed'), [], { extra: true, viewport: [320, 1000], failed: true, long: true }],
  ['1440-same-again-pending', sel().replace('prefs=selected', 'prefs=pending'), ['same'], { extra: true, viewport: [1440, 1100], pending: true }],
  ['320-same-keyboard', sel(), ['keyboardSame'], { extra: true, viewport: [320, 1000], keyboard: true, long: true }],
];

const servers = [];
const stopAll = () => { for (const s of servers) { try { process.kill(-s.pid, 'SIGKILL'); } catch {} } };
process.on('SIGALRM', () => { stopAll(); process.exit(124); });
const quietFavicon = (context) => context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
const ready = async (url) => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`server not ready: ${url}`);
};
// Same long-model replacement as FUCQ-367/368; page-served only, no repo file changes.
const longVariant = (text) => {
  const cut = text.indexOf('export const UNSUPPORTED_SNAPSHOT');
  const head = text.slice(0, cut).replaceAll('"model": "BMW 3 Series Touring 320i"', '"model": "BMW 3 Series 330e xDrive M Sport Pro Touring"')
    .replaceAll('"configuration": "320i M Sport Touring"', '"configuration": "M Sport Pro BMW Individual specification"').replaceAll('"fuel": "petrol"', '"fuel": "phev"');
  return head + text.slice(cut);
};
const routeLong = (page) => page.route('**/blocks/gcsp/account/fixtures.js*', async (route) => {
  const res = await route.fetch(); await route.fulfill({ response: res, body: longVariant(await res.text()) });
});
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('img.vm-card-photo')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(150); await page.evaluate(() => scrollTo(0, 0));
};

const IMPL = { section: '.gcsp-prefs', car: '.gcsp-feature', heading: '.gcsp-prefs h2', score: '.gcsp-understanding', scoreLabel: '.gcsp-understanding-label', value: '.gcsp-understanding-value',
  meter: '.gcsp-understanding-meter', segments: '.gcsp-understanding-meter i', filled: '.gcsp-understanding-meter i.is-filled', mode: '.gcsp-prefs-mode', tiles: '.gcsp-prefs-tiles', tile: '.gcsp-prefs-tile',
  tileOpen: '.gcsp-prefs-open', switch: '.gcsp-same-switch input', info: '.gcsp-prefs-info', panel: '.gcsp-prefs-panel:not([hidden])', removal: '.gcsp-prefs-removal:not([hidden])',
  status: '.gcsp-prefs-status', stars: '.gcsp-star input:checked', note: '.gcsp-prefs-same-note', tileClasses: 'is-considered is-important is-open' };
const REF = { section: '.concept-preferences', car: '.concept-car', heading: '#preferences-heading', score: '.concept-score', scoreLabel: '.concept-score-label', value: '.concept-score-value',
  meter: '.concept-score-meter', segments: '.concept-score-meter i', filled: '.concept-score-meter i.is-filled', mode: '.concept-mode', tiles: '.concept-categories', tile: '.concept-category',
  tileOpen: '.concept-category-open', switch: '#same-again', info: '.concept-info-button', panel: '#category-options:not([hidden])', removal: '.concept-removal:not([hidden])',
  status: '#preference-status', stars: '.concept-star input:checked', note: '.none', tileClasses: 'is-considered is-important' };

// One probe for both pages: boxes in page coordinates plus the text, state and style facts the checks use.
const PROBE = `(S) => {
  const q = (s) => document.querySelector(s); const qa = (s) => [...document.querySelectorAll(s)];
  const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { x: +(r.x + scrollX).toFixed(2), y: +(r.y + scrollY).toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) }; };
  const section = q(S.section); const mode = q(S.mode); const sw = q(S.switch); const value = q(S.value);
  const details = qa('section').find((s) => s.getAttribute('aria-labelledby') === 'gcsp-account-details-title');
  const regions = { car: q(S.car), preferences: section, history: q('.gcsp-account-history'), details };
  const follows = (a, b) => !!(regions[a] && regions[b] && (regions[a].compareDocumentPosition(regions[b]) & Node.DOCUMENT_POSITION_FOLLOWING));
  const ms = mode ? getComputedStyle(mode) : null;
  const tips = qa('[role=tooltip]:not([hidden])').map((n) => { const b = box(n); return { id: n.id, text: n.textContent, box: b, insideViewport: b.x >= 0 && b.x + b.width <= innerWidth }; });
  const dialog = q('[role=dialog]'); const db = dialog ? box(dialog) : null;
  const active = document.activeElement;
  return { sectionBox: box(section), headingBox: box(q(S.heading)), scoreBox: box(q(S.score)), scoreWidthVsSection: (() => { const a = box(q(S.score)); const b = box(section); return a && b ? +(a.width / b.width).toFixed(3) : null; })(), meterBox: box(q(S.meter)), valueBox: box(value), modeBox: box(mode), tilesBox: box(q(S.tiles)), firstTileBox: box(q(S.tile)),
    modeBorders: ms ? { top: ms.borderTopWidth, bottom: ms.borderBottomWidth, left: ms.borderLeftWidth, right: ms.borderRightWidth, topColour: ms.borderTopColor, bottomColour: ms.borderBottomColor, style: ms.borderTopStyle } : null,
    understanding: { text: value?.textContent ?? null, aria: value?.getAttribute('aria-label') ?? null, label: q(S.scoreLabel)?.textContent ?? null, segments: qa(S.segments).length, filled: qa(S.filled).length, pending: !!q(S.score)?.classList.contains('is-pending') },
    switchState: sw ? { checked: sw.checked, disabled: sw.disabled, role: sw.getAttribute('role'), describedBy: sw.getAttribute('aria-describedby'), name: (sw.labels?.[0]?.textContent ?? '').trim() } : null,
    infoLabel: q(S.info)?.getAttribute('aria-label') ?? null, note: q(S.note) && !q(S.note).hidden ? q(S.note).textContent : null,
    tiles: qa(S.tile).map((n) => { const open = n.querySelector(S.tileOpen); return { label: open.getAttribute('aria-label'), expanded: open.getAttribute('aria-expanded'), disabled: open.disabled, classes: n.className.split(/\\s+/).filter((c) => S.tileClasses.split(' ').includes(c)).join(' ') }; }),
    panelOpen: !!q(S.panel), removalOpen: !!q(S.removal), tooltips: tips, stars: q(S.stars)?.value ?? null, status: (q(S.status)?.textContent ?? '').trim(),
    tryAgain: qa('.gcsp-prefs .vm-btn').map((n) => n.textContent.trim()).filter((t) => /try again/i.test(t)),
    domOrder: { carBeforePreferences: follows('car', 'preferences'), preferencesBeforeHistory: follows('preferences', 'history'), historyBeforeDetails: follows('history', 'details') },
    dialog: dialog ? { box: db, insideViewport: db.x >= 0 && db.x + db.width <= innerWidth, headings: [...dialog.querySelectorAll('h2,h3')].map((n) => n.textContent.trim()), text: dialog.innerText.slice(0, 600) } : null,
    overflow: document.documentElement.scrollWidth > innerWidth, docHeight: document.documentElement.scrollHeight,
    active: (active?.getAttribute('aria-label') || active?.id || active?.tagName || '').slice(0, 60), activeIsSwitch: active === sw };
}`;
const probe = (page, sel) => page.evaluate(`(${PROBE})(${JSON.stringify(sel)})`);
const rel = (a, b) => (a && b ? { dx: +(a.x - b.x).toFixed(2), dy: +(a.y - b.y).toFixed(2) } : null);
const derive = (m) => ({ tileTop: m.tilesBox && m.sectionBox ? +(m.tilesBox.y - m.sectionBox.y).toFixed(2) : null, firstTileTop: m.firstTileBox && m.sectionBox ? +(m.firstTileBox.y - m.sectionBox.y).toFixed(2) : null,
  modeTop: rel(m.modeBox, m.sectionBox)?.dy ?? null, modeHeight: m.modeBox?.height ?? null, meterVsHeading: rel(m.meterBox, m.headingBox), scoreVsSection: rel(m.scoreBox, m.sectionBox), sectionHeight: m.sectionBox?.height ?? null, scoreWidth: m.scoreBox?.width ?? null, valueRight: m.valueBox && m.sectionBox ? +((m.sectionBox.x + m.sectionBox.width) - (m.valueBox.x + m.valueBox.width)).toFixed(2) : null, meterWidth: m.meterBox?.width ?? null });

// Runs one step on either page. `side` is IMPL or REF; step names are shared.
async function perform(page, step, side) {
  const [kind, arg] = step.split(/:(.*)/s);
  const ref = side === REF; const sw = page.getByRole('switch', { name: SAME_NAME, exact: true });
  if (kind === 'tile') await page.locator(ref ? `#category-${arg}` : `.gcsp-prefs-open[id$="-tile-${arg}"]`).click();
  else if (kind === 'pick') await (ref ? page.getByRole('checkbox', { name: arg, exact: true }) : page.locator('.gcsp-prefs-panel .vm-option', { hasText: arg }).first()).click();
  else if (kind === 'important') await page.getByRole('switch', { name: 'This is really important', exact: true }).click();
  else if (kind === 'done') await page.getByRole('button', { name: 'Done', exact: true }).click();
  else if (kind === 'same') await sw.click();
  else if (kind === 'sameOff') await sw.click();
  else if (kind === 'hoverInfo') { await page.locator('h1').click(); await page.getByRole('button', { name: `About ${SAME_NAME}`, exact: true }).hover(); }
  else if (kind === 'focusInfo') { await page.locator('h1').click(); await page.mouse.move(2, 2); await page.getByRole('button', { name: `About ${SAME_NAME}`, exact: true }).focus(); }
  else if (kind === 'clickInfo') await page.getByRole('button', { name: `About ${SAME_NAME}`, exact: true }).click();
  else if (kind === 'record') await page.locator('.gcsp-account-history tbody button').first().click();
  if (kind === 'record') await page.getByRole('dialog').waitFor({ timeout: 10000 });
  await page.waitForTimeout(160);
  if (!ref) await page.waitForFunction(() => !document.querySelector('.gcsp-understanding.is-pending'), null, { timeout: 4000 }).catch(() => {});
}

// Real Tab presses from the page heading until the Same again switch has focus; every stop is recorded.
async function tabToSwitch(page) {
  await page.locator('h1').click(); const seen = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, role: a?.getAttribute('role'), label: (a?.getAttribute('aria-label') || a?.textContent || a?.id || '').trim().slice(0, 50), isSwitch: a?.matches('.gcsp-same-switch input') }; });
    seen.push(info); if (info.isSwitch) break;
  }
  return seen;
}

const results = { run: 'fucq369-strict-capture', implementationCommit: null, reference: { commit: '193cbf07', dir: REF_DIR }, environment: {}, states: {}, counts: {}, checks: [], expectedDifferences: [], notes: [
  'Integrated Account harness gcsp-account.html?fixture=<name>&prefs=<state>&rating=<n>; reference geometry is measured live from the frozen mockup page in the same browser settings, pixels come from the committed review PNGs.',
  'Expected values (viewport, understanding, Same again, rating, categories, tooltips) come from design-reference.json screenshots[].',
  '320-* long states serve a longer current-car model through page.route on fixtures.js only.',
  '320-same-tooltip-long uses keyboard focus on the info button (the reference manifest records it as the active element). A mouse click on the info button opens the tip, but scrolling the page back to the top moves it from under the pointer and pointerleave closes it; see results.notes in the report.',
  '?prefs=same-again-failed already drives the failing toggle on load through the public controller intent; no second click is made.'] };
const check = (state, label, pass, detail) => results.checks.push({ state, label, pass: !!pass, ...(detail === undefined ? {} : { detail }) });
const norm = (label) => label.replace(', kept while Same again is on', '');
const near = (a, b, tol = 1) => a !== null && b !== null && Math.abs(a - b) <= tol;

async function capture(browser, [name, query, steps, opts]) {
  const man = byFile[name]; const [width, height] = man ? [man.viewport.width, man.viewport.height] : opts.viewport;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
  await quietFavicon(context); const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().replace(BASE, '')}`); });
  if (opts.long) await routeLong(page);
  const url = `/gcsp-account.html?${query}`; await page.goto(`${BASE}${url}`);
  await page.locator('.gcsp-prefs-tile').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => document.querySelector('.gcsp-understanding-value')?.textContent, null, { timeout: 10000 }); await settle(page);
  const entry = { viewport: { width, height }, url, steps, longVariant: !!opts.long, referencePng: man ? `${REF_DIR}/${name}.png` : null };
  const sequence = opts.restore ? steps.slice(0, -2) : steps;
  if (opts.restore) { for (const s of sequence) await perform(page, s, IMPL); entry.before = await probe(page, IMPL); for (const s of steps.slice(-2)) await perform(page, s, IMPL); }
  else if (opts.keyboard) {
    entry.tabSequence = await tabToSwitch(page); entry.beforeSpace = await probe(page, IMPL);
    await page.keyboard.press('Space'); await page.waitForTimeout(300); entry.steps = ['Tab from heading to switch', 'Space'];
  } else for (const s of steps) await perform(page, s, IMPL);
  if (opts.failed || opts.pending) await page.waitForTimeout(500);
  await page.waitForTimeout(300);
  entry.impl = await probe(page, IMPL); entry.impl.derived = derive(entry.impl); entry.errors = errors;
  await page.evaluate(() => scrollTo(0, 0)); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${scratch}/impl369/${name}.png`, fullPage: true });
  if (man || opts.refMode) {
    const rp = await context.newPage(); await rp.goto(`${BASE}${REF_PAGE}?state=${opts.refMode}`); await rp.locator('.concept-page').waitFor({ timeout: 20000 }); await settle(rp);
    if (opts.long) await rp.waitForTimeout(50);
    for (const s of steps) if (s !== 'done' || true) await perform(rp, s, REF);
    await rp.waitForTimeout(250); entry.ref = await probe(rp, REF); entry.ref.derived = derive(entry.ref); entry.ref.car = await rp.locator('#current-car-title').innerText().then((t) => t.split('\n')[0]);
    await rp.screenshot({ path: `${scratch}/ref369/${name}.png`, fullPage: true }); await rp.close();
  }
  if (opts.expected) entry.expectedDifference = opts.expected;
  await context.close(); return { entry, man };
}

function checksFor(name, entry, man, opts) {
  const c = entry.impl; const e = entry;
  check(name, 'no horizontal overflow', !c.overflow);
  check(name, 'no page or console errors, no HTTP >= 400', e.errors.length === 0, e.errors);
  if (opts.unavailable) check(name, 'region order Your preferences, Order history, Your details (no current car, so no Your cars section)', c.domOrder.preferencesBeforeHistory && c.domOrder.historyBeforeDetails, c.domOrder);
  else check(name, 'region order Your cars, Your preferences, Order history, Your details', c.domOrder.carBeforePreferences && c.domOrder.preferencesBeforeHistory && c.domOrder.historyBeforeDetails, c.domOrder);
  if (c.modeBorders) check(name, 'mode row has two 1px borders (top and bottom only)', c.modeBorders.top === '1px' && c.modeBorders.bottom === '1px' && c.modeBorders.left === '0px' && c.modeBorders.right === '0px' && c.modeBorders.style === 'solid', c.modeBorders);
  for (const t of c.tooltips) if (width(e) <= 375) check(name, `tooltip ${t.id} inside the ${width(e)}px viewport`, t.insideViewport, t.box);
  if (e.ref && !opts.noGeometry) {
    const d = c.derived; const r = e.ref.derived;
    check(name, 'tiles top offset within the preferences section matches the reference (1px)', near(d.tileTop, r.tileTop), { impl: d.tileTop, ref: r.tileTop });
    check(name, 'mode row top offset matches the reference (1px)', near(d.modeTop, r.modeTop), { impl: d.modeTop, ref: r.modeTop });
    check(name, 'mode row height matches the reference (1px)', near(d.modeHeight, r.modeHeight), { impl: d.modeHeight, ref: r.modeHeight });
    check(name, 'understanding meter sits where the reference puts it relative to the heading (1px)', d.meterVsHeading && r.meterVsHeading && near(d.meterVsHeading.dx, r.meterVsHeading.dx) && near(d.meterVsHeading.dy, r.meterVsHeading.dy), { impl: d.meterVsHeading, ref: r.meterVsHeading });
    check(name, 'understanding block width and right inset match the reference (1px)', near(d.scoreWidth, r.scoreWidth) && near(d.valueRight, r.valueRight), { impl: [d.scoreWidth, d.valueRight, d.meterWidth], ref: [r.scoreWidth, r.valueRight, r.meterWidth] });
    check(name, 'mode row borders match the reference widths', c.modeBorders.top === e.ref.modeBorders.top && c.modeBorders.bottom === e.ref.modeBorders.bottom, { impl: c.modeBorders, ref: e.ref.modeBorders });
  }
  if (!man) return;
  const s = man.state;
  check(name, `viewport ${s && man.viewport.width}x${man.viewport.height} equals the manifest`, e.viewport.width === man.viewport.width && e.viewport.height === man.viewport.height);
  check(name, `understanding text is ${s.understanding}`, c.understanding.text === s.understanding, c.understanding.text);
  const n = s.understanding.split(' / '); check(name, 'understanding aria-label names the score', c.understanding.aria === `Buddy understanding ${n[0]} out of ${n[1]}` && c.understanding.label === 'Buddy understanding', { aria: c.understanding.aria, label: c.understanding.label });
  check(name, `segments: ${n[1]} drawn, ${n[0]} filled`, c.understanding.segments === Number(n[1]) && c.understanding.filled === Number(n[0]), c.understanding);
  check(name, `Same again switch ${s.sameAgain ? 'on' : 'off'}, enabled, named "${SAME_NAME}"`, c.switchState?.checked === s.sameAgain && !c.switchState.disabled && c.switchState.role === 'switch' && c.switchState.name === SAME_NAME, c.switchState);
  check(name, `current-car rating is ${s.rating || 'none'}`, (c.stars ? Number(c.stars) : 0) === s.rating, c.stars);
  const wantTiles = s.categories.map((t) => ({ label: t.label, considered: t.considered, important: t.important, expanded: t.expanded }));
  const gotTiles = c.tiles.map((t) => ({ label: norm(t.label), considered: t.classes.includes('is-considered'), important: t.classes.includes('is-important'), expanded: t.expanded }));
  check(name, 'tile labels, considered, important and expanded equal the manifest', JSON.stringify(wantTiles) === JSON.stringify(gotTiles), { want: wantTiles, got: gotTiles });
  if (s.sameAgain) check(name, 'categories show as kept (neutral) while Same again is on: tiles disabled, no panel or removal', c.tiles.every((t) => t.disabled) && !c.panelOpen && !c.removalOpen && !c.tiles.some((t) => t.classes.includes('is-important')), c.tiles.map((t) => t.classes));
  const wantTips = s.visibleTooltips.map((id) => id); const gotTips = c.tooltips.map((t) => t.id);
  check(name, `visible tooltips equal the manifest (${wantTips.join(', ') || 'none'})`, wantTips.length === gotTips.length && wantTips.every((id, i) => gotTips[i].endsWith(`-${id}`) || gotTips[i] === id), { want: wantTips, got: gotTips });
  if (wantTips.length && e.ref?.tooltips.length) {
    const lead = 'Select this option if you just love everything about your current car, and your next best car would be another ';
    check(name, 'tooltip is the exact Same again sentence followed by the car heading and specification', c.tooltips[0].text.startsWith(lead) && c.tooltips[0].text.includes(e.ref.car), { impl: c.tooltips[0].text });
    if (c.tooltips[0].text !== e.ref.tooltips[0].text) results.expectedDifferences.push({ state: name, note: 'Tooltip description differs from the reference (account spec line repeats 320i and orders long-spec parts differently).', impl: c.tooltips[0].text, ref: e.ref.tooltips[0].text });
  }
  if (name.endsWith('record-drawer')) {
    check(name, 'GC record opens in the shared drawer inside the viewport', c.dialog?.insideViewport && c.dialog.headings.includes('BMW 3 Series Touring 320i'), c.dialog?.headings);
    check(name, 'drawer text equals the reference drawer text', c.dialog?.text === e.ref?.dialog?.text, { impl: c.dialog?.text.slice(0, 200), ref: e.ref?.dialog?.text.slice(0, 200) });
  }
  e.manifestFeedback = s.feedback; e.manifestActive = s.activeElement; e.observedStatus = c.status; e.observedActive = c.active;
  e.sameAgainOnFocusSwitch = c.activeIsSwitch;
}
const width = (e) => e.viewport.width;

let browser;
try {
  await mkdir(`${scratch}/impl369`, { recursive: true }); await mkdir(`${scratch}/ref369`, { recursive: true });
  results.implementationCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  servers.push(spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore', detached: true }));
  await ready(`${BASE}/gcsp-account.html`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  results.environment = { browser: browser.version(), deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB', capture: 'fullPage', scroll: [0, 0] };
  for (const spec of STATES) {
    const [name, , , opts] = spec; const { entry, man } = await capture(browser, spec);
    results.states[name] = entry; checksFor(name, entry, man, opts); const c = entry.impl;
    if (entry.expectedDifference) results.expectedDifferences.push({ state: name, note: entry.expectedDifference });
    if (name === '1440-same-again' || name === '320-same-again' || name === '320-same-again-neutral' || name === '1440-same-again-retained-high') check(name, 'focus stays on the Same again switch after a real click', c.activeIsSwitch, c.active);
    if (opts.restore) {
      const b = entry.before; const same = (x) => JSON.stringify({ t: x.tiles, u: x.understanding.text, s: x.switchState.checked });
      check(name, 'turning Same again off restores categories, importance classes and score exactly', same(b) === same(c) && !c.switchState.checked, { before: b.understanding.text, after: c.understanding.text });
      check(name, `restored score is ${name.endsWith('high') ? '3 / 11 with Body really important' : '6 / 11'}`, c.understanding.text === (name.endsWith('high') ? '3 / 11' : '6 / 11') && (!name.endsWith('high') || c.tiles[0].classes.includes('is-important')), c.understanding.text);
    }
    if (opts.unavailable) {
      check(name, 'Same again unavailable: switch disabled with the reason shown and described', c.switchState?.disabled && c.note === 'Add your current car to use this.' && /note/.test(c.switchState.describedBy ?? ''), { sw: c.switchState, note: c.note });
      check(name, 'categories stay editable and score follows the count', c.tiles.every((t) => !t.disabled) && c.understanding.text === '6 / 11', c.understanding.text);
    }
    if (opts.failed) {
      check(name, 'Same again failure: switch on, score says not saved, status and Try again visible', c.switchState?.checked && /not saved/.test(c.understanding.aria) && c.tryAgain.length > 0 && /./.test(c.status), { aria: c.understanding.aria, status: c.status, tryAgain: c.tryAgain });
    }
    if (opts.pending) check(name, 'Same again pending: pending score (saving) and no failure', c.understanding.pending && /saving/.test(c.understanding.aria) && c.tryAgain.length === 0, { aria: c.understanding.aria, status: c.status });
    if (opts.keyboard) {
      const last = entry.tabSequence.at(-1);
      check(name, 'Tab from the heading reaches the Same again switch', !!last?.isSwitch, entry.tabSequence);
      check(name, 'Space toggles the switch on and the score goes to 11 / 11', !entry.beforeSpace.switchState.checked && c.switchState.checked && c.understanding.text === '11 / 11' && c.activeIsSwitch, { before: entry.beforeSpace.understanding.text, after: c.understanding.text });
    }
  }
  // Score strip: prefs=count-0..6 with the section only.
  for (let n = 0; n <= 6; n++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
    await quietFavicon(context); const page = await context.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}/gcsp-account.html?fixture=ready&prefs=count-${n}`); await page.locator('.gcsp-prefs-tile').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.gcsp-understanding-value')?.textContent, null, { timeout: 10000 }); await settle(page);
    const m = await probe(page, IMPL); results.counts[`1440-count-${n}`] = { text: m.understanding.text, aria: m.understanding.aria, filled: m.understanding.filled, considered: m.tiles.filter((t) => t.classes.includes('is-considered')).length, errors };
    await page.locator('.gcsp-prefs').screenshot({ path: `${scratch}/impl369/1440-count-${n}.png` }); await context.close();
    const want = `${SCORES[n]} / 11`; const r = results.counts[`1440-count-${n}`];
    check(`1440-count-${n}`, `${n} considered gives ${want}, filled segments and aria agree`, r.text === want && r.filled === SCORES[n] && r.aria === `Buddy understanding ${SCORES[n]} out of 11` && r.considered === n && errors.length === 0, r);
  }
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
