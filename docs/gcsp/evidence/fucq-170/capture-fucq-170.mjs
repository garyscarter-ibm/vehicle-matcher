// FUCQ-170 browser evidence: headless system Chrome, keyboard-only case interactions.
// Usage: TMPDIR=<owned scratch> FIX=http://127.0.0.1:8971 LIVE=http://127.0.0.1:8972 DEMO_KEY=<throwaway> node capture-fucq-170.mjs
// FIX serves the repo root (fixture pages). LIVE is the hosted runtime (GCSP_RUNTIME=1, memory mode, throwaway key).
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = join(OUT, '../../../..');
const FIX = process.env.FIX || 'http://127.0.0.1:8971';
const LIVE = process.env.LIVE || 'http://127.0.0.1:8972';
const KEY = process.env.DEMO_KEY;
if (!KEY) throw new Error('DEMO_KEY (throwaway hosted-demo key) is required');
const PW = [process.env.PLAYWRIGHT_CORE, '/Users/garycarter/opentabs-evo/node_modules/playwright-core/index.mjs',
  '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'].filter(Boolean);
let chromium;
for (const p of PW) { try { ({ chromium } = await import(p)); break; } catch { /* try next */ } }
if (!chromium) throw new Error('playwright-core not found');

const DESKTOP = { width: 1280, height: 900 };
const NARROW = { width: 375, height: 812 };
const WIDTHS = [['desktop', DESKTOP], ['narrow', NARROW]];
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const report = { story: 'DEV-2026-11-07-004 / FUCQ-170', commit: execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
  startedAt: new Date().toISOString(), fixtureOrigin: FIX, liveOrigin: LIVE, sections: { A: [], B: [], C: [] }, captures: [], keyboard: [],
  network: [], external: [], consoleErrors: [], pageErrors: [], defects: [], notes: [] };
let STEP = 'setup';
const save = () => writeFile(join(OUT, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (section, entry) => { report.sections[section].push(entry); console.log(`[${section}] ${entry.pass === false ? 'FAIL' : 'ok  '} ${entry.name}${entry.error ? ' :: ' + entry.error : ''}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ---- contexts and logging ---------------------------------------------------------------------
async function newCtx(label, viewport) {
  const context = await browser.newContext({ viewport, locale: 'en-GB', timezoneId: 'UTC', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const log = { label, console: [], page: [] };
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/^https?:\/\/127\.0\.0\.1[:/]/.test(url) || /^(data|about|blob):/.test(url)) return route.continue();
    report.external.push({ step: STEP, url }); return route.abort();
  });
  page.on('console', (m) => { if (m.type() === 'error') { const e = { step: STEP, label, text: m.text(), location: m.location()?.url?.replace(/^https?:\/\/127\.0\.0\.1:\d+/, '') }; log.console.push(e); report.consoleErrors.push(e); } });
  page.on('pageerror', (e) => { const x = { step: STEP, label, text: String(e) }; log.page.push(x); report.pageErrors.push(x); });
  page.on('response', (r) => {
    const req = r.request(); const type = req.resourceType();
    if (!/^https?:\/\/127\.0\.0\.1[:/]/.test(r.url())) return;
    if (!['fetch', 'xhr', 'document'].includes(type)) return;
    report.network.push({ step: STEP, label, method: req.method(), path: new URL(r.url()).pathname + new URL(r.url()).search, status: r.status() });
  });
  return { context, page, log, label, viewport };
}
async function liveSession(label, viewport, { principal, next = '/gcsp-presenter.html' } = {}) {
  const a = await newCtx(label, viewport);
  await a.page.goto(LIVE + '/gcsp/access?next=' + encodeURIComponent(next));
  // Setup only: enter the throwaway demo key (typed, then Enter) to obtain the host access cookie.
  await a.page.locator('#key').focus(); await a.page.keyboard.type(KEY); await a.page.keyboard.press('Enter');
  await a.page.waitForURL('**' + next); await a.page.waitForTimeout(800);
  if (principal) {
    const sw = await api(a.page, 'POST', 'session/switch', { principalId: principal, commandId: `fucq170-${label}-${Date.now()}` });
    if (sw.body?.status !== 'ok') throw new Error('principal switch failed: ' + JSON.stringify(sw.body).slice(0, 200));
    await a.page.goto(LIVE + next);
  }
  return a;
}
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => {
  const r = await fetch('/api/gcsp/' + p, { method: m, credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return { http: r.status, body: await r.json() };
}, [method, path, body]);

// ---- inspection --------------------------------------------------------------------------------
const describeFocus = (page) => page.evaluate(() => {
  const a = document.activeElement; const cs = getComputedStyle(a);
  const label = a.labels?.[0]?.textContent || a.getAttribute?.('aria-label') || a.textContent || '';
  const outlineW = parseFloat(cs.outlineWidth) || 0;
  return { tag: a.tagName, id: a.id || null, text: label.trim().replace(/\s+/g, ' ').slice(0, 80),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow === 'none' ? 'none' : 'set',
    visibleIndicator: (cs.outlineStyle !== 'none' && outlineW > 0) || cs.boxShadow !== 'none' };
});
const pageFacts = (page) => page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth, innerWidth,
  noOverflow: document.documentElement.scrollWidth <= innerWidth,
  statusRegions: [...document.querySelectorAll('[role="status"],[role="alert"]')].map((n) => `${n.getAttribute('role')}: ${n.textContent.trim().replace(/\s+/g, ' ')}`).filter((t) => t.length > 8),
}));
// Names recorded with facts but no PNG, to keep the evidence set small.
const SKIP_PNG = new Set(['A-sort-status-narrow', 'A-review-preference-desktop', 'A-review-alternative-car-narrow', 'C1-paula-help-before',
  'C2a-greg-review-in-progress-desktop', 'C2b-greg-editor-remedy-desktop', 'C4-greg-review-resolved-narrow', 'B-help-in-progress-narrow', 'B-help-trigger-narrow']);
async function shot(name, a, extra = {}, { el, viewportOnly } = {}) {
  await a.page.waitForTimeout(250);
  const facts = await pageFacts(a.page); const focus = await describeFocus(a.page);
  const file = SKIP_PNG.has(name) ? null : `${name}.png`;
  if (file) {
    if (el) await a.page.locator(el).first().screenshot({ path: join(OUT, file) });
    else await a.page.screenshot({ path: join(OUT, file), fullPage: !viewportOnly });
  }
  const entry = { name, file, viewport: `${a.viewport.width}x${a.viewport.height}`, ...facts, focus,
    consoleErrors: a.log.console.length, pageErrors: a.log.page.length, ...extra };
  report.captures.push(entry); await save(); return entry;
}

// ---- keyboard primitives (Tab / Shift+Tab / Enter / Space / arrows / typing only) ---------------
async function tabTo(page, loc, { dir = 'Tab', max = 1500, what } = {}) {
  const h = await loc.first().elementHandle({ timeout: 8000 });
  for (let i = 0; i <= max; i += 1) {
    if (await h.evaluate((n) => n === document.activeElement)) { report.keyboard.push({ step: STEP, to: what || (await describeFocus(page)).text, presses: i, dir }); return i; }
    await page.keyboard.press(dir);
  }
  throw new Error(`keyboard could not reach ${what || 'target'} in ${max} ${dir} presses`);
}
const activeSelect = (page) => page.evaluate(() => { const a = document.activeElement;
  return a.tagName === 'SELECT' ? { idx: a.selectedIndex, id: a.id, value: a.value, text: a.options[a.selectedIndex]?.textContent.trim() } : null; });
// Native selects: ArrowDown opens the popup in Chrome on macOS, so choose by type-ahead (first letter, repeated to cycle).
async function pickOption(page, loc, want, what) {
  await tabTo(page, loc, { what: what || 'select' });
  const opts = await loc.first().evaluate((n) => [...n.options].map((o) => ({ v: o.value, t: o.textContent.trim() })));
  const idx = opts.findIndex((o) => (want instanceof RegExp ? want.test(o.t) : o.v === want));
  if (idx < 0) throw new Error(`option ${want} not offered in ${what}: ${opts.map((o) => o.t).join(' | ')}`);
  const letter = opts[idx].t[0]; let cur = await activeSelect(page); const keys = [];
  for (let n = 0; n < 14 && cur && cur.text !== opts[idx].t; n += 1) {
    keys.push(letter); await page.keyboard.type(letter); await sleep(80);
    cur = await activeSelect(page);
    if (!cur) { await tabTo(page, loc, { what }); cur = await activeSelect(page); }
  }
  if (!cur || cur.text !== opts[idx].t) throw new Error(`could not select ${want} in ${what}; at ${JSON.stringify(cur)}`);
  report.keyboard.push({ step: STEP, select: what, chose: opts[idx].t, typeaheadKeys: keys.join('') });
  return { options: opts.map((o) => o.t), chose: opts[idx].t };
}
async function typeInto(page, loc, text, what) {
  await tabTo(page, loc, { what });
  await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace'); await page.keyboard.type(text);
  const v = await loc.first().inputValue();
  if (v !== text) throw new Error(`${what}: typed ${JSON.stringify(text)} but value is ${JSON.stringify(v)}`);
}
async function typeDateTime(page, loc, iso, what) {
  // en-GB segments: dd/mm/yyyy, HH:mm:ss. Typing digits only; the browser advances segments.
  await tabTo(page, loc, { what });
  const [d, t] = iso.split('T'); const [y, m, dd] = d.split('-'); const [hh, mi, ss = '00'] = t.split(':');
  await page.keyboard.type(`${dd}${m}${y}`); await page.keyboard.press('Tab'); // year takes up to 6 digits, so Tab to the time segments
  await page.keyboard.type(`${hh}${mi}${ss}`);
  const v = await loc.first().inputValue();
  if (!v.startsWith(iso.slice(0, 16))) throw new Error(`${what}: wanted ${iso} got ${v}`);
  return v;
}
async function press(page, loc, key = 'Enter', what) { await tabTo(page, loc, { what }); await page.keyboard.press(key); }
const btn = (scope, name) => scope.getByRole('button', { name, exact: typeof name === 'string' });
const texts = (loc) => loc.evaluateAll((ns) => ns.map((n) => n.textContent.trim().replace(/\s+/g, ' ')));

// ---- queue helpers ----------------------------------------------------------------------------
async function queueReady(page) {
  await page.locator('.gcsp-case-queue-content[aria-busy="false"]').first().waitFor({ timeout: 15000 });
}
async function tableOrder(page) {
  return page.evaluate(() => [...document.querySelectorAll('.gcsp-case-queue table tbody tr')].map((r) => {
    const c = [...r.children].map((x) => x.textContent.trim().replace(/\s+/g, ' ')); return `${c[0]} | ${c[4]} | ${c[1]}`;
  }));
}
async function factsOf(loc) {
  return loc.evaluate((root) => [...root.querySelectorAll('dt')].map((dt) => `${dt.textContent.trim()}: ${dt.nextElementSibling?.textContent.trim()}`));
}
function writeCount(from = 0) { return report.network.slice(from).filter((n) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(n.method) && n.path !== '/gcsp/access' && !n.path.endsWith('/session/switch')).length; }

// =================================================================================================
// A. Fixture harness, Greg queue
// =================================================================================================
const QUEUE_FIXTURES = ['populated', 'empty', 'loading', 'unavailable', 'forbidden', 'stale-run', 'unavailable-options'];
async function queueStates() {
  for (const [wlabel, vp] of WIDTHS) {
    for (const fx of QUEUE_FIXTURES) {
      STEP = `A-state-${fx}-${wlabel}`; const name = `A-queue-${fx}-${wlabel}`;
      const a = await newCtx(name, vp);
      try {
        await a.page.goto(`${FIX}/gcsp-case-queue.html?fixture=${fx}`);
        let extra = {};
        if (fx === 'loading') {
          await a.page.locator('.gcsp-case-queue-content[aria-busy="true"]').waitFor({ timeout: 8000 });
          extra = { busy: await a.page.locator('.gcsp-case-queue-content').getAttribute('aria-busy'), text: (await a.page.locator('.gcsp-case-queue-content').innerText()).slice(0, 160) };
        } else {
          await queueReady(a.page);
          const body = (await a.page.locator('.gcsp-case-queue-content').innerText()).replace(/\s+/g, ' ').slice(0, 400);
          extra = { body, rows: fx === 'populated' || fx === 'unavailable-options' ? await tableOrder(a.page) : undefined };
        }
        if (fx === 'unavailable-options') {
          // Keyboard: pick and open the first case to see every remedy marked unavailable.
          await pickOption(a.page, a.page.getByLabel('Case to work', { exact: true }), /Synthetic employee 1 /, 'Case to work');
          await press(a.page, btn(a.page, 'Open selected case'), 'Enter', 'Open selected case');
          await a.page.locator('.gcsp-case-work .gcsp-case-editor').waitFor({ timeout: 8000 });
          const notes = await texts(a.page.locator('.gcsp-case-editor .gcsp-note'));
          const remedyOptions = await a.page.getByLabel('Remedy to record', { exact: true }).evaluate((n) => [...n.options].map((o) => o.textContent.trim()));
          extra = { ...extra, unavailableNotes: notes, remedyOptions };
        }
        const e = await shot(name, a, extra);
        const expectText = { empty: /No renewal cases/, unavailable: /unavailable/i, forbidden: /cannot open/i, 'stale-run': /demo run has changed/i, loading: /Loading/ }[fx];
        const pass = e.noOverflow && (!expectText || expectText.test(JSON.stringify(e.statusRegions) + (extra.body || extra.text || '')))
          && (fx !== 'unavailable-options' || (extra.remedyOptions.length === 2 && extra.unavailableNotes.length >= 4));
        record('A', { name, fixture: fx, width: wlabel, pass, file: e.file, noOverflow: e.noOverflow, statusRegions: e.statusRegions, ...extra });
      } catch (error) { record('A', { name, pass: false, error: String(error.message).slice(0, 300) }); }
      await a.context.close();
    }
  }
}

async function queueFlow(wlabel, vp) {
  const tag = `A-flow-${wlabel}`; STEP = tag;
  const a = await newCtx(tag, vp); const p = a.page;
  const root = p.locator('.gcsp-case-queue');
  const flow = { name: tag, width: wlabel, steps: [], pass: true };
  const fail = (e) => { flow.pass = false; flow.error = String(e.message).slice(0, 300); };
  try {
    const netStart = report.network.length;
    await p.goto(`${FIX}/gcsp-case-queue.html?fixture=populated`); await queueReady(p);
    // 1. Table scroll region
    const wrap = root.locator('.gcsp-table-wrap').first();
    const presses = await tabTo(p, wrap, { what: 'table scroll region' });
    const before = await wrap.evaluate((n) => ({ sl: n.scrollLeft, sw: n.scrollWidth, cw: n.clientWidth, tabindex: n.tabIndex, label: n.getAttribute('aria-label') || n.getAttribute('role') }));
    const focusWrap = await describeFocus(p);
    for (let i = 0; i < 4; i += 1) await p.keyboard.press('ArrowRight');
    await sleep(150);
    const afterRight = await wrap.evaluate((n) => n.scrollLeft);
    for (let i = 0; i < 4; i += 1) await p.keyboard.press('ArrowLeft');
    await sleep(150);
    const afterLeft = await wrap.evaluate((n) => n.scrollLeft);
    flow.tableRegion = { presses, ...before, focus: focusWrap, scrollLeftAfter4Right: afterRight, scrollLeftAfter4Left: afterLeft, scrollable: before.sw > before.cw };
    if (wlabel === 'narrow') { await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await sleep(150); await shot(`A-table-keyboard-scroll-${wlabel}`, a, { scrollLeft: await wrap.evaluate((n) => n.scrollLeft) }); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); }
    flow.steps.push(`table region focusable (tabindex ${before.tabindex}); at ${vp.width}px scrollWidth ${before.sw}, clientWidth ${before.cw} (${before.sw > before.cw ? 'scrolls' : 'no scrolling needed'}); ArrowRight x4 moved scrollLeft 0 -> ${afterRight}; ArrowLeft x4 -> ${afterLeft}`);
    if (wlabel === 'narrow' && !(afterRight > 0 && afterLeft < afterRight)) throw new Error('table region did not scroll with arrow keys at 375');

    // 2. Sort order
    const sortLoc = p.getByLabel('Sort cases', { exact: true });
    const orders = {};
    orders['Deadline, active cases first (default)'] = await tableOrder(p);
    const sortOpts = await pickOption(p, sortLoc, 'status', 'Sort cases');
    orders['Status, then deadline'] = await tableOrder(p);
    await shot(`A-sort-status-${wlabel}`, a, { rows: orders['Status, then deadline'], focusAfterSort: await describeFocus(p) });
    const focusAfterSort = await describeFocus(p);
    await pickOption(p, sortLoc, 'deadline', 'Sort cases');
    const backToDeadline = await tableOrder(p);
    flow.sort = { options: sortOpts.options, orders, returnedToDeadlineMatches: JSON.stringify(backToDeadline) === JSON.stringify(orders['Deadline, active cases first (default)']), focusAfterSort };
    flow.steps.push('sort changed by keyboard both ways');

    // 3. Pick and open
    await pickOption(p, p.getByLabel('Case to work', { exact: true }), /Synthetic employee 1 /, 'Case to work');
    await press(p, btn(root, 'Open selected case'), 'Enter', 'Open selected case');
    await root.locator('.gcsp-case-editor').waitFor({ timeout: 8000 });
    flow.openFocus = await describeFocus(p);
    flow.statusAfterOpen = (await root.locator('.gcsp-case-status').innerText()).trim();

    // 4. Empty submit -> error summary takes focus
    await press(p, btn(root, 'Review case update'), 'Enter', 'Review case update (empty)');
    await sleep(200);
    const summaryFocus = await describeFocus(p);
    flow.errorSummary = { focus: summaryFocus, text: (await root.locator('.gcsp-error-summary').innerText()).replace(/\s+/g, ' ').trim(),
      focusOnSummaryHeading: await p.evaluate(() => document.activeElement.closest('.gcsp-error-summary') !== null) };
    await shot(`A-editor-empty-error-summary-${wlabel}`, a, { summary: flow.errorSummary.text });
    if (!flow.errorSummary.focusOnSummaryHeading) throw new Error('error summary did not take focus');

    // 5. Alternative car (fixture offers one) then review and cancel
    const nextStatus = root.getByLabel('Next case status', { exact: true });
    const statusPick = await pickOption(p, nextStatus, 'remedy-proposed', 'Next case status');
    await typeInto(p, root.getByLabel('Reason for this update', { exact: true }), 'Scheme team reviewed the synthetic renewal and found a suitable car.', 'Reason');
    await typeInto(p, root.getByLabel('Next action', { exact: true }), 'Contact the employee about the proposed car.', 'Next action');
    const due = await typeDateTime(p, root.getByLabel('Next action due, demo clock (UTC)', { exact: true }), '2026-11-07T12:00:00', 'Due');
    const remedyPick = await pickOption(p, root.getByLabel('Remedy to record', { exact: true }), /Alternative car/, 'Remedy to record');
    const proposedCar = await texts(root.locator('.gcsp-case-editor .gcsp-case-facts dd'));
    const editorFacts = await factsOf(root.locator('.gcsp-case-editor .gcsp-case-facts').first());
    await shot(`A-editor-alternative-car-${wlabel}`, a, { remedyOptions: remedyPick.options, statusOptions: statusPick.options, editorFacts, due });
    flow.editor = { statusOptions: statusPick.options, remedyOptions: remedyPick.options, due, editorFacts };
    const writesBeforeReview = report.network.length;
    await press(p, btn(root, 'Review case update'), 'Enter', 'Review case update');
    await root.locator('.gcsp-case-confirmation').waitFor({ timeout: 5000 });
    const reviewFocus = await describeFocus(p);
    const confirmationFacts = await factsOf(root.locator('.gcsp-case-confirmation'));
    await shot(`A-review-alternative-car-${wlabel}`, a, { confirmationFacts, focus: reviewFocus });
    flow.reviewAlternativeCar = { focus: reviewFocus, confirmationFacts, heading: (await root.locator('.gcsp-case-confirmation h3, .gcsp-case-confirmation h2, .gcsp-case-confirmation h4').first().innerText()) };
    // Cancel update (Tab from Confirm to Cancel, never Confirm)
    await press(p, btn(root, 'Cancel update'), 'Enter', 'Cancel update');
    await sleep(200);
    const afterCancel = await describeFocus(p);
    flow.cancelAlternativeCar = { focusAfter: afterCancel, confirmationGone: await root.locator('.gcsp-case-confirmation').count() === 0,
      editorStillShown: await root.locator('.gcsp-case-editor').count() === 1,
      requestsDuringReviewAndCancel: report.network.slice(writesBeforeReview).length, writesDuringReviewAndCancel: writeCount(writesBeforeReview) };
    flow.steps.push('alternative car reviewed and cancelled');

    // 6. Preference change then review and cancel
    const prefPick = await pickOption(p, root.getByLabel('Remedy to record', { exact: true }), /^Change body/i, 'Remedy to record');
    const prefValue = await pickOption(p, root.getByLabel('Proposed preference value', { exact: true }), /suv/i, 'Proposed preference value');
    const prefNote = await texts(root.locator('.gcsp-case-editor .gcsp-note'));
    await press(p, btn(root, 'Review case update'), 'Enter', 'Review case update (preference)');
    await root.locator('.gcsp-case-confirmation').waitFor({ timeout: 5000 });
    const prefFacts = await factsOf(root.locator('.gcsp-case-confirmation'));
    await shot(`A-review-preference-${wlabel}`, a, { confirmationFacts: prefFacts });
    flow.reviewPreference = { remedyOptions: prefPick.options, valueOptions: prefValue.options, notes: prefNote, confirmationFacts: prefFacts };
    await press(p, btn(root, 'Cancel update'), 'Enter', 'Cancel update (preference)');
    await sleep(200);
    flow.cancelPreference = { focusAfter: await describeFocus(p), confirmationGone: await root.locator('.gcsp-case-confirmation').count() === 0 };
    const allNet = report.network.slice(netStart);
    flow.networkAfterPageLoad = allNet.filter((n) => !/\.(css|js|html)$/.test(n.path.split('?')[0]));
    flow.writeRequests = writeCount(netStart);
    flow.writeNote = 'Fixture adapter updateCase is not exposed for call counting; evidence is zero POST/PUT/PATCH/DELETE and no fetch/XHR traffic during the flow (the fixture adapter makes no requests), plus no confirmation reached the Confirm button.';
  } catch (e) { fail(e); try { await shot(`A-flow-failure-${wlabel}`, a, { error: String(e.message).slice(0, 200) }); } catch { /* ignore */ } }
  record('A', flow); await a.context.close();
}

// =================================================================================================
// B. Fixture harness, Paula
// =================================================================================================
const HELP_FIXTURES = ['waiting', 'in-progress', 'resolved', 'closed', 'trigger', 'loading', 'unavailable', 'forbidden'];
async function helpReady(page) { await page.locator('.gcsp-case-content[aria-busy="false"]').first().waitFor({ timeout: 15000 }); }
async function helpStates() {
  for (const [wlabel, vp] of WIDTHS) {
    for (const fx of HELP_FIXTURES) {
      STEP = `B-${fx}-${wlabel}`; const name = `B-help-${fx}-${wlabel}`;
      const a = await newCtx(name, vp); const p = a.page; const entry = { name, fixture: fx, width: wlabel, pass: true };
      try {
        await p.goto(`${FIX}/gcsp-help.html?fixture=${fx}`);
        if (fx === 'loading') {
          await p.locator('.gcsp-case-content[aria-busy="true"]').waitFor({ timeout: 8000 });
          entry.text = (await p.locator('.gcsp-case-content').innerText()).replace(/\s+/g, ' ').slice(0, 160);
        } else {
          await helpReady(p);
          entry.text = (await p.locator('.gcsp-case-content').innerText()).replace(/\s+/g, ' ').slice(0, 600);
        }
        if (fx === 'waiting') {
          const review = p.getByRole('button', { name: /^Review .* change$/ });
          entry.reviewButton = (await review.first().innerText()).trim();
          await press(p, review, 'Enter', entry.reviewButton);
          await p.locator('.gcsp-case-confirmation').waitFor({ timeout: 5000 });
          entry.confirmation = { focus: await describeFocus(p), notes: await texts(p.locator('.gcsp-case-confirmation .gcsp-note')),
            heading: (await p.locator('.gcsp-case-confirmation').innerText()).split('\n')[0] };
          entry.beforeAfterLine = entry.confirmation.notes.find((t) => t.includes('→'));
          entry.onlyThisPreferenceNote = entry.confirmation.notes.find((t) => /only this preference/i.test(t));
          const writes0 = report.network.length;
          await shot(`B-help-waiting-confirm-${wlabel}`, a, { notes: entry.confirmation.notes });
          await press(p, btn(p, 'Cancel preference change'), 'Enter', 'Cancel preference change');
          await sleep(200);
          entry.cancel = { focusAfter: await describeFocus(p), confirmationGone: await p.locator('.gcsp-case-confirmation').count() === 0, writes: writeCount(writes0) };
          entry.pass = !!entry.beforeAfterLine && !!entry.onlyThisPreferenceNote && entry.cancel.confirmationGone && entry.cancel.writes === 0;
        }
        if (fx === 'resolved' || fx === 'closed') {
          await press(p, p.locator('details.gcsp-case-history > summary'), 'Enter', 'Dated case history');
          await sleep(200);
          entry.historyOpen = await p.locator('details.gcsp-case-history').evaluate((n) => n.open);
          entry.historyEvents = await p.locator('li.gcsp-case-event').count();
          entry.historyFocus = await describeFocus(p);
          entry.pass = entry.historyOpen && entry.historyEvents >= 1;
        }
        const e = await shot(name, a, { fixture: fx });
        entry.file = e.file; entry.noOverflow = e.noOverflow; entry.statusRegions = e.statusRegions;
        const expect = { forbidden: /cannot open/i, unavailable: /unavailable/i, loading: /Loading/i }[fx];
        if (expect) entry.pass = entry.pass && expect.test(entry.text + JSON.stringify(e.statusRegions));
        entry.pass = entry.pass && e.noOverflow;
      } catch (error) { entry.pass = false; entry.error = String(error.message).slice(0, 300); }
      record('B', entry); await a.context.close();
    }
  }
}

// =================================================================================================
// C. Live composed host
// =================================================================================================
async function fillEditor(p, root, { status, reason, nextAction, due, remedy, decision }) {
  const out = {};
  out.status = await pickOption(p, root.getByLabel('Next case status', { exact: true }), status, 'Next case status');
  await typeInto(p, root.getByLabel('Reason for this update', { exact: true }), reason, 'Reason');
  await typeInto(p, root.getByLabel('Next action', { exact: true }), nextAction, 'Next action');
  out.due = await typeDateTime(p, root.getByLabel('Next action due, demo clock (UTC)', { exact: true }), due, 'Due');
  if (remedy) out.remedy = await pickOption(p, root.getByLabel('Remedy to record', { exact: true }), remedy, 'Remedy to record');
  if (decision) await typeInto(p, root.getByLabel('Authorised scheme-team decision', { exact: true }), decision, 'Decision');
  return out;
}
const caseCard = async (p) => {
  const c = p.locator('[data-case-id]').first(); await c.waitFor({ timeout: 8000 });
  const facts = await factsOf(c);
  return { heading: (await c.locator('h1,h2,h3,h4,h5,h6').first().innerText()).trim(), facts: facts.filter((f) => !f.startsWith('Demo clock (UTC)') || true).slice(0, 12),
    remedyFacts: await c.locator('.gcsp-case-remedy').count() ? await factsOf(c.locator('.gcsp-case-remedy')) : [],
    remedyHeading: await c.locator('.gcsp-case-remedy h3,.gcsp-case-remedy h4,.gcsp-case-remedy h2').count() ? (await c.locator('.gcsp-case-remedy h3,.gcsp-case-remedy h4,.gcsp-case-remedy h2').first().innerText()).trim() : null,
    historyEvents: await c.locator('li.gcsp-case-event').count(),
    historyDates: await c.locator('li.gcsp-case-event').evaluateAll((ns) => ns.map((n) => n.querySelector('dd')?.textContent.trim())),
    historyActors: await c.locator('li.gcsp-case-event').evaluateAll((ns) => ns.map((n) => [...n.querySelectorAll('dt')].filter((dt) => ['Actor', 'Role', 'Status'].includes(dt.textContent.trim())).map((dt) => `${dt.textContent.trim()}: ${dt.nextElementSibling?.textContent.trim()}`).join(' / '))) };
};
const isSetup = (n) => n.path === '/gcsp/access' || n.path.endsWith('/session/switch');
const stepNet = (step) => { const rows = report.network.filter((n) => n.step === step); return { step,
  requests: rows.length, writes: rows.filter((n) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(n.method) && !isSetup(n)).map((n) => `${n.method} ${n.path} ${n.status}`),
  setupWrites: rows.filter((n) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(n.method) && isSetup(n)).map((n) => `${n.method} ${n.path} ${n.status}`),
  nonOk: rows.filter((n) => n.status >= 400).map((n) => `${n.method} ${n.path} ${n.status}`) }; };

async function liveFlow() {
  const live = { name: 'C-live', pass: true, steps: {} };
  const fail = (e, where) => { live.pass = false; live.error = `${where}: ${String(e.message).slice(0, 300)}`; };
  let presenter; let paula; let greg; let gregNarrow; let paulaNarrow; let forbidden;
  let where = 'setup';
  try {
    STEP = 'C-setup';
    presenter = await liveSession('presenter', DESKTOP);
    const ctl = await api(presenter.page, 'GET', 'presenter/controls');
    const cat = (await api(presenter.page, 'GET', 'presenter/scenarios')).body.value;
    const main = cat.scenarios.find((s) => s.scenarioId === 'main-successful-journey');
    const reset = await api(presenter.page, 'POST', 'presenter/scenarios/reset', { commandId: `fucq170-reset-${Date.now()}`, expectedRunId: ctl.body.value.runId,
      expectedRunVersion: ctl.body.value.runVersion, scenarioId: main.scenarioId, scenarioVersion: main.scenarioVersion, fixtureVersion: main.fixtureVersion, policyVersion: cat.policyVersion });
    live.setup = { scenario: main.scenarioId, resetStatus: reset.body.status, startState: reset.body.value?.startState, briefConfirmed: reset.body.value?.startState?.status === 'ok',
      note: 'Setup via API: access key, scenario reset (confirmed brief for Paula), principal switch. Every case interaction below is keyboard only.' };
    if (reset.body.status !== 'ok') throw new Error('scenario reset failed ' + JSON.stringify(reset.body).slice(0, 200));
    // Setup only: one presenter "next release" tick so the run holds released synthetic stock (alternative cars become offerable).
    const clockNow = (await api(presenter.page, 'GET', 'presenter/controls')).body.value;
    const tick = await api(presenter.page, 'POST', 'presenter/controls/tick', { commandId: `fucq170-tick-${Date.now()}`, expectedClockVersion: clockNow.clockVersion, mode: 'next-release' });
    live.setup.releaseTick = { status: tick.body.status, now: tick.body.value?.advance?.now, handlers: tick.body.value?.tick?.handlerOrder?.map((h) => h.handlerId) };
    if (tick.body.status !== 'ok') live.setup.releaseTickNote = 'tick failed; the flow falls back to Manual decision';
    await presenter.context.close(); presenter = null;

    // ---- 1. Paula requests help (desktop)
    where = 'step1'; STEP = 'C1-paula-help-request';
    paula = await liveSession('paula', DESKTOP, { next: '/gcsp-help.html' });
    await helpReady(paula.page);
    await shot('C1-paula-help-before', paula, { note: 'no case yet' });
    await press(paula.page, paula.page.locator('details.gcsp-case-entry > summary'), 'Enter', 'Get help with your renewal');
    await press(paula.page, btn(paula.page, 'Ask for help'), 'Enter', 'Ask for help');
    live.steps.askFocus = await describeFocus(paula.page);
    await sleep(150);
    const reasonText = 'My replacement car may not arrive before my contract ends. Please review my options.';
    await paula.page.keyboard.type(reasonText);
    await press(paula.page, btn(paula.page, 'Review help request'), 'Enter', 'Review help request');
    await paula.page.locator('.gcsp-case-confirmation').waitFor({ timeout: 5000 });
    live.steps.reviewFocus = await describeFocus(paula.page);
    await shot('C1-paula-help-confirm', paula, { focus: live.steps.reviewFocus });
    const w0 = report.network.length;
    await press(paula.page, btn(paula.page, 'Confirm help request'), 'Enter', 'Confirm help request');
    await paula.page.locator('[data-case-id]').first().waitFor({ timeout: 10000 });
    await helpReady(paula.page); await sleep(300);
    live.steps.step1 = { card: await caseCard(paula.page), status: (await paula.page.locator('.gcsp-case-status').innerText()).trim(), focus: await describeFocus(paula.page), writes: writeCount(w0), ...stepNet(STEP) };
    await shot('C1-paula-help-confirmed', paula, { card: live.steps.step1.card });
    const caseId = await paula.page.locator('[data-case-id]').first().getAttribute('data-case-id');

    // ---- 2. Greg works the case on the presenter workspace (desktop)
    where = 'step2'; STEP = 'C2-greg-remedy';
    greg = await liveSession('greg', DESKTOP, { principal: 'demo-greg' });
    const gp = greg.page; const groot = gp.locator('.gcsp-case-queue');
    await queueReady(gp);
    // FUCQ-150 measurement
    live.fucq150 = await gp.evaluate(() => {
      const q = document.querySelector('.gcsp-case-queue'); const region = q.closest('.gcsp-greg-region') || q.parentElement;
      const dash = document.querySelector('.gcsp-greg'); const r = region.getBoundingClientRect(); const d = dash.getBoundingClientRect();
      const grid = region.parentElement; const gcs = getComputedStyle(grid);
      return { viewport: innerWidth, dashboardWidth: Math.round(d.width * 10) / 10, regionWidth: Math.round(r.width * 10) / 10, queueWidth: Math.round(q.getBoundingClientRect().width * 10) / 10,
        regionClass: region.className, regionParentClass: grid.className, parentDisplay: gcs.display, parentColumns: gcs.gridTemplateColumns, regionGridColumn: getComputedStyle(region).gridColumn,
        regionSpansDashboard: Math.abs(r.width - d.width) <= 2 };
    });
    await groot.scrollIntoViewIfNeeded(); await shot('C2-greg-dashboard-queue-desktop', greg, { fucq150: live.fucq150 }, { viewportOnly: true });
    await pickOption(gp, groot.getByLabel('Case to work', { exact: true }), /Paula/, 'Case to work');
    await press(gp, btn(groot, 'Open selected case'), 'Enter', 'Open selected case');
    await groot.locator('.gcsp-case-editor').waitFor({ timeout: 10000 });
    const remedyOptions = await groot.getByLabel('Remedy to record', { exact: true }).evaluate((n) => [...n.options].map((o) => o.textContent.trim()));
    const notes = await texts(groot.locator('.gcsp-case-editor .gcsp-note'));
    const nextStatuses = await groot.getByLabel('Next case status', { exact: true }).evaluate((n) => [...n.options].map((o) => o.textContent.trim()));
    live.steps.options = { statusOptions: nextStatuses, remedyOptions, unavailableAndExplanatoryNotes: notes };
    const confirmFacts = async (root) => { await root.locator('.gcsp-case-confirmation').waitFor({ timeout: 5000 }); return factsOf(root.locator('.gcsp-case-confirmation')); };
    const confirmSave = async (page, root, shotName, g) => {
      await press(page, btn(root, 'Review case update'), 'Enter', 'Review case update');
      const confirmation = await confirmFacts(root);
      if (shotName) await shot(shotName, g, { confirmation }, { el: '.gcsp-case-queue' });
      const w = report.network.length;
      await press(page, btn(root, 'Confirm case update'), 'Enter', 'Confirm case update');
      await page.waitForFunction(() => /recorded/i.test(document.querySelector('.gcsp-case-queue .gcsp-case-status')?.textContent || ''), null, { timeout: 15000 });
      await queueReady(page); await sleep(300);
      return { confirmation, statusMessage: (await root.locator('.gcsp-case-status').innerText()).trim(), focus: await describeFocus(page),
        posts: report.network.slice(w).filter((n) => n.method === 'POST').map((n) => `${n.method} ${n.path} ${n.status}`), writes: writeCount(w) };
    };
    // 2a. A fresh Open case only offers In progress or Closed, so move it to In progress first.
    STEP = 'C2a-greg-in-progress';
    await fillEditor(gp, groot, { status: 'in-progress', reason: 'Scheme team has started reviewing the renewal.', nextAction: 'Review remedies for Paula.', due: '2026-11-06T12:00:00' });
    live.steps.step2a = { ...(await confirmSave(gp, groot, 'C2a-greg-review-in-progress-desktop', greg)), ...stepNet(STEP) };
    // 2b. Remedy proposed with the best offered remedy.
    STEP = 'C2b-greg-remedy';
    await groot.locator('.gcsp-case-editor').waitFor({ timeout: 10000 });
    const remedyOptions2 = await groot.getByLabel('Remedy to record', { exact: true }).evaluate((n) => [...n.options].map((o) => o.textContent.trim()));
    const notes2 = await texts(groot.locator('.gcsp-case-editor .gcsp-note'));
    const statuses2 = await groot.getByLabel('Next case status', { exact: true }).evaluate((n) => [...n.options].map((o) => o.textContent.trim()));
    live.steps.options2b = { statusOptions: statuses2, remedyOptions: remedyOptions2, notes: notes2 };
    const wantAlt = remedyOptions2.some((o) => /^Alternative car/.test(o));
    const fillA = await fillEditor(gp, groot, { status: 'remedy-proposed', reason: 'Scheme team reviewed the renewal and proposed a remedy.',
      nextAction: 'Contact Paula about the proposed remedy.', due: '2026-11-07T12:00:00',
      remedy: wantAlt ? /^Alternative car/ : /^Manual decision/, decision: wantAlt ? undefined : 'Authorised manual review: the scheme team will arrange a reviewed replacement and contact Paula.' });
    live.steps.chosenRemedy = fillA.remedy?.chose;
    await shot('C2b-greg-editor-remedy-desktop', greg, { remedyOptions: remedyOptions2 }, { el: '.gcsp-case-queue' });
    live.steps.step2 = { ...(await confirmSave(gp, groot, 'C2b-greg-review-remedy-desktop', greg)), ...stepNet(STEP), queueRows: await tableOrder(gp), workCard: await caseCard(groot) };
    await shot('C2b-greg-after-confirm-desktop', greg, { statusMessage: live.steps.step2.statusMessage }, { el: '.gcsp-case-queue' });
    await greg.context.close(); greg = null;

    // ---- 3. Paula reloads (real reload)
    where = 'step3'; STEP = 'C3-paula-reload';
    await paula.page.reload(); await helpReady(paula.page); await sleep(300);
    live.steps.step3 = { card: await caseCard(paula.page), ...stepNet(STEP) };
    const rawIdLeak = /[0-9a-f]{8}-[0-9a-f]{4}-|order[-_]?uuid/i.test(JSON.stringify(live.steps.step3.card.remedyFacts));
    live.steps.step3.rawIdInRemedyFacts = rawIdLeak;
    await shot('C3-paula-reload-persisted-desktop', paula, { card: live.steps.step3.card });

    // ---- 4. Greg resolves the case (narrow, standalone queue page on the hosted origin)
    where = 'step4'; STEP = 'C4-greg-resolve-narrow';
    gregNarrow = await liveSession('greg-narrow', NARROW, { principal: 'demo-greg', next: '/gcsp-case-queue.html' });
    const np = gregNarrow.page; const nroot = np.locator('.gcsp-case-queue'); await queueReady(np);
    live.steps.narrowQueueRows = await tableOrder(np);
    await shot('C4-greg-queue-narrow', gregNarrow, { rows: live.steps.narrowQueueRows });
    await pickOption(np, nroot.getByLabel('Case to work', { exact: true }), /Paula/, 'Case to work');
    await press(np, btn(nroot, 'Open selected case'), 'Enter', 'Open selected case');
    await nroot.locator('.gcsp-case-editor').waitFor({ timeout: 10000 });
    live.steps.step4Options = { statusOptions: await nroot.getByLabel('Next case status', { exact: true }).evaluate((n) => [...n.options].map((o) => o.textContent.trim())) };
    await fillEditor(np, nroot, { status: 'resolved', reason: 'The scheme team recorded the remedy and resolved the case.', nextAction: 'No further action needed.', due: '2026-11-08T12:00:00' });
    await shot('C4-greg-editor-narrow', gregNarrow);
    await press(np, btn(nroot, 'Review case update'), 'Enter', 'Review case update');
    live.steps.step4Confirmation = await confirmFacts(nroot);
    await shot('C4-greg-review-resolved-narrow', gregNarrow, { confirmation: live.steps.step4Confirmation });
    const w4 = report.network.length;
    await press(np, btn(nroot, 'Confirm case update'), 'Enter', 'Confirm case update');
    await np.waitForFunction(() => /recorded/i.test(document.querySelector('.gcsp-case-queue .gcsp-case-status')?.textContent || ''), null, { timeout: 15000 });
    await queueReady(np); await sleep(300);
    live.steps.step4 = { statusMessage: (await nroot.locator('.gcsp-case-status').innerText()).trim(), posts: report.network.slice(w4).filter((n) => n.method === 'POST').map((n) => `${n.method} ${n.path} ${n.status}`),
      writes: writeCount(w4), rows: await tableOrder(np), ...stepNet(STEP) };
    await shot('C4-greg-after-resolve-narrow', gregNarrow, { statusMessage: live.steps.step4.statusMessage });
    await gregNarrow.context.close(); gregNarrow = null;

    // ---- 5. Paula reloads again (desktop, then narrow in a fresh context)
    where = 'step5'; STEP = 'C5-paula-reload-resolved';
    await paula.page.reload(); await helpReady(paula.page); await sleep(300);
    await press(paula.page, paula.page.locator('details.gcsp-case-history > summary'), 'Enter', 'Dated case history');
    await sleep(200);
    live.steps.step5 = { card: await caseCard(paula.page), ...stepNet(STEP) };
    await shot('C5-paula-reload-resolved-desktop', paula, { card: live.steps.step5.card });
    await paula.context.close(); paula = null;
    STEP = 'C5-paula-reload-resolved-narrow';
    paulaNarrow = await liveSession('paula-narrow', NARROW, { next: '/gcsp-help.html', principal: 'demo-paula' });
    await helpReady(paulaNarrow.page);
    await press(paulaNarrow.page, paulaNarrow.page.locator('details.gcsp-case-history > summary'), 'Enter', 'Dated case history');
    await sleep(200);
    live.steps.step5Narrow = { card: await caseCard(paulaNarrow.page), ...stepNet(STEP) };
    await shot('C5-paula-reload-resolved-narrow', paulaNarrow, { card: live.steps.step5Narrow.card });
    await paulaNarrow.context.close(); paulaNarrow = null;

    // ---- Forbidden: Paula's employee session at the Greg queue page
    where = 'forbidden'; STEP = 'C6-forbidden';
    forbidden = await liveSession('paula-forbidden', DESKTOP, { next: '/gcsp-case-queue.html' });
    await forbidden.page.waitForFunction(() => document.querySelector('.gcsp-case-queue-content')?.getAttribute('aria-busy') === 'false', null, { timeout: 15000 });
    live.steps.forbidden = { text: (await forbidden.page.locator('.gcsp-case-queue-content').innerText()).replace(/\s+/g, ' ').slice(0, 300), ...stepNet(STEP) };
    await shot('C6-paula-at-greg-queue-forbidden-desktop', forbidden, { text: live.steps.forbidden.text });
    await forbidden.context.close(); forbidden = null;
    live.caseId = caseId;
  } catch (e) {
    fail(e, where);
    for (const [k, a] of Object.entries({ presenter, paula, greg, gregNarrow, paulaNarrow, forbidden })) {
      if (a) { try { await shot(`C-failure-${k}`, a, { error: String(e.message).slice(0, 200) }); } catch { /* ignore */ } try { await a.context.close(); } catch { /* ignore */ } }
    }
  }
  live.fucq150Pass = live.fucq150?.regionSpansDashboard === true;
  live.perStep = ['C1-paula-help-request', 'C2a-greg-in-progress', 'C2b-greg-remedy', 'C3-paula-reload', 'C4-greg-resolve-narrow', 'C5-paula-reload-resolved', 'C5-paula-reload-resolved-narrow', 'C6-forbidden'].map(stepNet);
  record('C', live);
}

// =================================================================================================
const only = (process.env.ONLY || 'ABC').toUpperCase();
try {
  if (only.includes('A')) { await queueStates(); for (const [w, vp] of WIDTHS) await queueFlow(w, vp); }
  if (only.includes('B')) await helpStates();
  if (only.includes('C')) await liveFlow();
} finally {
  await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.totals = { screenshots: report.captures.length, external: report.external.length, consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length,
    nonOk: report.network.filter((n) => n.status >= 400).length };
  report.nonOkResponses = report.network.filter((n) => n.status >= 400);
  await save();
  console.log(JSON.stringify(report.totals));
}
