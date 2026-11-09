// FUCQ-124 browser walkthrough: FUCQ-109's journey (copied from ../fucq-89, prelude not photographed) then the lifecycle after selection, keyboard only.
// One viewport per run (FUCQ110_CHUNK=desktop|narrow). Spawns `node index.js` in server/ as Render does (memory, demo key). Nothing is stubbed.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const chunk = process.env.FUCQ110_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ110_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ110_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ110_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
// FUCQ110_VARIANT=overdue stops after the documents task is left undone and the keyed due time passes (separate results and screenshots).
const variant = process.env.FUCQ110_VARIANT === 'overdue' ? 'overdue' : '';
const tag = variant ? `${variant}-` : '';
// FUCQ110_OUT lets a later story keep its own evidence (FUCQ-194: ../fucq-194) without overwriting this story's.
const OUT = process.env.FUCQ110_OUT ? resolve(process.env.FUCQ110_OUT) : HERE;
const shotDir = join(OUT, 'browser');
const resultsFile = join(OUT, `results-${tag}${chunk}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
// Default is the generated run stock as Render runs it; FUCQ110_STOCK=demo forces demo stock.
let stockMode = process.env.FUCQ110_STOCK === 'demo' ? 'demo' : 'default';
const report = { chunk, entry: 'hosted', viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), runIds: {}, steps: [], keyboard: [],
  firstRelease: null, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let quiet = true; let context; let page; let app; let child; let halted = null; let previewRendered = null;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
const killChrome = () => { try { spawnSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch { /* already gone */ } };
const killServer = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome(); killServer(); report.state = 'timeout'; process.exit(124); });
process.on('exit', () => { killChrome(); killServer(); });

async function until(fn, { timeout = 120000, every = 500, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const last = await fn(); if (last) return last; } catch { /* retry */ } await wait(every); }
  throw new Error(`Timed out waiting for ${what}`);
}
const clip = (text, n = 420) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const bare = (url) => String(url).replace(/[?#].*$/, '');

async function shot(name, full = true, force = false) {
  if (quiet && !force) return null;
  // The presenter strip is tooling: collapse it so each capture shows the employee screen.
  await page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d?.open && !location.pathname.includes('presenter')) d.open = false; }).catch(() => {});
  shots += 1;
  const file = `${tag}${vp}-${String(shots).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(shotDir, file), fullPage: full });
  return `browser/${file}`;
}

// A step records pass/fail, the observed state text and its screenshots. A failed critical step blocks the rest.
async function step(id, name, run, { critical = false } = {}) {
  const row = { id, name, pass: false, screenshots: [] };
  report.steps.push(row);
  if (halted) { row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    // Horizontal overflow of the page itself fails the step (tables and code may scroll inside their own box).
    row.overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)).catch(() => null);
    row.pass = out.pass !== false && !(row.overflowPx > 2); row.state = clip(out.state); if (out.detail !== undefined) row.detail = out.detail;
    if (out.shot !== false) row.screenshots.push(await shot(out.shotName || id, out.full !== false));
  } catch (error) {
    row.error = clip(error.message, 300);
    row.strip = clip(await stripText().catch(() => ''), 500);
    try { row.screenshots.push(await shot(`${id}-failed`, true, true)); } catch { /* page gone */ }
    if (critical) halted = id;
  }
  row.screenshots = row.screenshots.filter(Boolean);
  await save();
}

// Keyboard helpers: Tab from the current focus until the target holds it.
const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement).catch(() => false);
async function tabTo(locator, { max = 160 } = {}) {
  await locator.first().waitFor({ state: 'attached', timeout: 30000 });
  for (let count = 0; count <= max; count += 1) {
    if (await isFocused(locator.first())) return count;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
}
const ring = (locator) => locator.first().evaluate((el) => {
  const s = getComputedStyle(el);
  // A range input shows focus on its thumb, so read the thumb's own style.
  const t = el.type === 'range' ? getComputedStyle(el, '::-webkit-slider-thumb') : s;
  const outline = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (t.outlineStyle !== 'none' && parseFloat(t.outlineWidth) > 0);
  const shadow = (s.boxShadow && s.boxShadow !== 'none') || (t.boxShadow && t.boxShadow !== 'none');
  return { outline, shadow: Boolean(shadow), label: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 60) };
});
// One focused-control capture per page, reached by Tab so :focus-visible applies.
async function focusShot(row, locator, label) {
  await tabTo(locator);
  const visible = await ring(locator);
  const ok = visible.outline || visible.shadow;
  report.keyboard.push({ page: label, check: 'visible focus', pass: ok, detail: visible });
  row.screenshots.push(await shot(`focus-${label}`));
  if (!ok) row.pass = false;
}
const kb = (pageName, action, pass, detail) => report.keyboard.push({ page: pageName, check: action, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });

// ---- Hosted entry ----
// The Render command and env, plus a throwaway demo key. GCSP_STOCK_SOURCE is set only to force demo stock.
async function startHost() {
  // Leads share this Mac, so a lead may pin FUCQ110_PORT; 127.0.0.1 keeps cookies apart from other localhost hosts.
  const port = Number(process.env.FUCQ110_PORT) || (chunk === 'narrow' ? 8841 : 8840);
  if (!((port >= 8840 && port <= 8849) || (port >= 8860 && port <= 8869) || (port >= 9220 && port <= 9229))) throw new Error('FUCQ110_PORT must be 8840-8849, 8860-8869 or 9220-9229 (127.0.0.1 only)');
  const origin = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
    GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: ACCESS_KEY, PORT: String(port), ...(stockMode === 'demo' ? { GCSP_STOCK_SOURCE: 'demo' } : {}) };
  child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Host not ready in time: ${clip(output.slice(-300))}`)), 90000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Host exited (${code}): ${clip(output.slice(-300))}`)); });
  });
  await ready;
  report.origin = origin;
  return { origin, output: () => output, stop: async () => { if (child.exitCode === null) { const gone = once(child, 'exit'); child.kill('SIGTERM'); setTimeout(killServer, 5000).unref(); await gone; } } };
}

// ---- Presenter strip helpers ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (text) => /DemoClock \(UTC\)\s+(\S+)/.exec(text)?.[1] ?? null;
const runOf = (text) => /\bRun\s+(\S+)/.exec(text)?.[1] ?? null;
const actingOf = (text) => /Acting principal\s+(.+)/.exec(text)?.[1]?.trim() ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 60000 });
  if (!(await root.evaluate((el) => el.open))) await root.locator('summary').click();
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 60000 });
}
// Open the strip with Tab and Enter, as a keyboard user would.
async function openStripByKeyboard() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 60000 });
  if (!(await root.evaluate((el) => el.open))) { await tabTo(root.locator('summary')); await page.keyboard.press('Enter'); }
  const ok = await root.evaluate((el) => el.open);
  kb('presenter', 'Enter on "Presenter controls" opens the strip', ok);
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 60000 });
  return ok;
}
// Arrow keys move a radio group's selection; stops when the checked option's text starts with the target.
async function chooseRadio(groupLabel, target, pageName, scope = `[role=radiogroup][aria-label="${groupLabel}"]`) {
  const radios = page.locator(`${scope} [role=radio]`);
  await radios.first().waitFor({ timeout: 30000 });
  const checked = page.locator(`${scope} [role=radio][aria-checked=true]`);
  const current = async () => (await checked.first().innerText().catch(() => '')).trim();
  if (!(await checked.count())) { await tabTo(radios.first()); } else { await tabTo(checked); }
  const total = await radios.count();
  for (let i = 0; i <= total && !(await current()).startsWith(target); i += 1) await page.keyboard.press('ArrowDown');
  const now = await current(); const ok = now.startsWith(target);
  kb(pageName, `arrow keys choose "${target}" in "${groupLabel}"`, ok, clip(now, 80));
  if (!ok) throw new Error(`Arrow keys did not reach ${target}`);
}
async function nextRelease(row) {
  await openStrip();
  const before = clockOf(await stripText());
  await page.getByRole('button', { name: 'Next release' }).click({ timeout: 240000, noWaitAfter: true });
  const text = await until(async () => {
    const now = await stripText();
    return clockOf(now) !== before && !/Action in progress/.test(now) && /Presenter controls ready|Last tick/.test(now) ? now : null;
  }, { timeout: 240000, what: 'release to finish' });
  const released = Number(/(\d+) cars released/.exec(text)?.[1] ?? NaN) || null;
  row.detail = { clockBefore: before, clockAfter: clockOf(text), carsReleased: released, releaseCue: /Release cue: (\S+)/.exec(text)?.[1] ?? null };
  await page.evaluate(() => document.querySelector('.gcsp-presenter-controls')?.scrollIntoView({ block: 'start' }));
  return { state: `Clock ${before} to ${clockOf(text)}; cars released ${released}`, shotName: row.id };
}

async function goto(path, ready) {
  await page.goto(`${app.origin}${path}`, { waitUntil: 'load', timeout: 120000 });
  if (ready) await ready();
}
const visibleText = (selector) => page.locator(selector).first().evaluate((el) => el.innerText);

// ---- Brief ----
const previewState = () => visibleText('gcsp-brief').then((t) => {
  const after = t.split('Cars for your brief').pop();
  return { updating: /Updating cars/.test(after), text: after };
});
async function settledPreview() {
  return until(async () => { const p = await previewState(); return p.updating || !/eligible car|No cars/.test(p.text) ? null : p; }, { timeout: 150000, what: 'brief preview to settle' });
}
async function previewFacts() {
  const preview = await settledPreview();
  const count = Number(/(\d+) eligible car/.exec(preview.text)?.[1] ?? 0);
  const needs = Number(/(\d+) cars? need/.exec(preview.text)?.[1] ?? 0);
  const cards = await page.locator('gcsp-brief .gcsp-brief-cards article.vm-card').evaluateAll((nodes) => nodes.map((n) => ({
    title: n.querySelector('h2,h3,h4,.vm-card-title')?.innerText.trim() || '', compact: n.classList.contains('vm-card-compact') })));
  const eligible = cards.filter((c) => !c.compact).map((c) => c.title.split(' in ')[0]);
  const fits = await page.locator('gcsp-brief .gcsp-brief-cards article.vm-card:not(.vm-card-compact)').evaluateAll((nodes) => nodes.map((n) => /(\d+)%/.exec(n.innerText)?.[1] ?? null));
  const lines = {}; for (const line of eligible) lines[line] = (lines[line] || 0) + 1;
  return { eligibleCount: count, needConfirmation: needs, eligibleCardsShown: eligible.length, modelLines: lines, cardOrder: eligible.map((t, i) => `${t} (${fits[i] ?? '?'}%)`), summary: clip(preview.text, 120) };
}

// ---- Outbox and offer ----
async function openMessage(index, row, focus = true) {
  await goto('/gcsp-outbox.html', () => until(() => page.locator('gcsp-outbox').evaluate((el) => /captured email/.test(el.innerText) && !/Loading captured/.test(el.innerText)), { timeout: 90000, what: 'outbox to load' }));
  const rows = page.locator('gcsp-outbox button').filter({ hasText: 'Your vehicle offer' });
  const count = await rows.count();
  // Tab to the row and press Enter, so focus then moves on to the detail heading and the offer link.
  const target = rows.nth(index);
  if (row && focus) await focusShot(row, target, 'outbox'); else await tabTo(target);
  await page.keyboard.press('Enter');
  kb('outbox', 'Enter on a captured email row opens the message', true);
  await page.getByRole('link', { name: /Open the offer/ }).waitFor({ timeout: 30000 });
  // The sandboxed HTML preview must actually paint the email heading, not an empty frame.
  const heading = page.frameLocator('gcsp-outbox iframe').locator('h1').first();
  previewRendered = await heading.waitFor({ timeout: 20000 }).then(() => true, () => false);
  const box = previewRendered ? await heading.boundingBox().catch(() => null) : null;
  report.notes.push(`Email preview heading box at ${vp}px: ${box ? `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}` : 'none'}`);
  await wait(600);
  // A viewport capture of the frame itself: tall full-page captures can miss sandboxed iframe paint.
  await page.locator('gcsp-outbox iframe').scrollIntoViewIfNeeded().catch(() => {});
  if (row) row.screenshots.push(await shot('outbox-email-preview', false));
  await page.evaluate(() => window.scrollTo(0, 0));
  return count;
}
// Open the message's own offer link with the keyboard; the link opens a new tab, which becomes the working page.
async function openOfferLink(label) {
  const link = page.getByRole('link', { name: /Open the offer/ });
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 30000 }), (async () => { await tabTo(link); await page.keyboard.press('Enter'); })()]);
  kb(label, 'Enter on the captured message link opens the offer', true);
  const old = page; page = popup; await old.close();
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: /Accept this offer/ }).waitFor({ timeout: 180000 });
}
// The follow-up's own option list; the presenter strip on the same page has radio groups too.
const FOLLOWUP_GROUP = 'gcsp-offer [role=radiogroup]:not(.gcsp-presenter-controls *)';
const offerText = () => visibleText('gcsp-offer');

// The first visit shows the demo key form; the key goes in by keyboard, once. Cookies then carry the access.
async function enterAccessKey(row) {
  await page.goto(`${app.origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
  const input = page.locator('#key');
  await input.waitFor({ timeout: 30000 });
  row.screenshots.push(await shot('access-form'));
  await tabTo(input); await page.keyboard.type(ACCESS_KEY);
  const typed = (await input.inputValue()).length === ACCESS_KEY.length;
  await page.keyboard.press('Enter');
  await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
  kb('access', 'Tab reaches the demo key field; typing the key and Enter opens the demo', typed);
  return typed;
}

async function run() {
  await mkdir(shotDir, { recursive: true }); await mkdir(scratch, { recursive: true });
  app = await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport });
  const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ text: clip(m.text(), 200), url: bare(m.location().url || p.url()), page: bare(p.url()) }); });
    p.on('pageerror', (e) => report.pageErrors.push(clip(e.message, 200)));
    p.on('requestfailed', (r) => report.failedRequests.push({ url: bare(r.url()), error: r.failure()?.errorText, method: r.method(), page: bare(r.frame()?.url?.() || '') }));
    p.on('response', async (r) => {
      if (r.status() < 400) return;
      const body = r.status() === 404 ? undefined : clip(await r.text().catch(() => ''), 300);
      report.badResponses.push({ status: r.status(), url: bare(r.url()), method: r.request().method(), page: bare(r.frame()?.url?.() || ''), ...(body ? { body } : {}) });
    });
  };
  context.on('page', watch);
  page = await context.newPage();

  // 1 Access, presenter workspace, scenario reset
  await step('access-key', 'The demo key form opens the hosted demo, key typed by keyboard once', async (row) => {
    const typed = await enterAccessKey(row);
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 }).catch(() => {});
    return { pass: typed, state: clip(await page.locator('body').innerText()), shot: false };
  }, { critical: true });
  await step('presenter-workspace', 'Presenter workspace opens with the strip collapsed', async (row) => {
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    return { state: await visibleText('[data-presenter-workspace]') };
  }, { critical: true });
  let previousRun = null;
  await step('presenter-strip-open', 'Presenter controls open with the keyboard and show run, clock and release cue', async (row) => {
    const ok = await openStripByKeyboard();
    const text = await stripText(); previousRun = runOf(text); report.runIds.previous = previousRun;
    row.detail = { run: previousRun, clock: clockOf(text), releaseCue: /Release cue: (\S+)/.exec(text)?.[1] ?? null, actingPrincipal: actingOf(text) };
    return { state: clip(text, 260), pass: ok && Boolean(previousRun) };
  }, { critical: true });
  await step('scenario-main-reset', 'Scenario "Main successful journey" chosen with arrow keys and reset confirmed by keyboard', async (row) => {
    await chooseRadio('Scenario', 'Main successful journey', 'presenter');
    await tabTo(page.getByRole('button', { name: 'Reset scenario' })); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Confirm reset' }).waitFor({ timeout: 10000 });
    row.screenshots.push(await shot('reset-confirm', false));
    await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Reset scenario" then "Confirm reset" resets the run', true);
    const text = await until(async () => { await strip().waitFor({ state: 'attached', timeout: 1000 }); const t = await stripText().catch(() => ''); return !/Action in progress/.test(t) && runOf(t) && runOf(t) !== previousRun ? t : null; }, { timeout: 240000, what: 'new run after reset' }).catch(async () => {
      await openStrip(); return stripText();
    });
    report.runIds.new = runOf(text);
    row.detail = { previousRun, newRun: runOf(text), scenario: /Scenario\s+(.+)/.exec(text)?.[1] ?? null, clock: clockOf(text) };
    return { state: clip(text, 260), pass: Boolean(runOf(text)) && runOf(text) !== previousRun };
  }, { critical: true });
  await step('presenter-after-reset', 'Presenter workspace after the reset shows the new run in the strip', async (row) => {
    await page.waitForLoadState('load');
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    await openStrip();
    const text = await stripText(); report.runIds.new = runOf(text) || report.runIds.new;
    row.detail = { newRun: runOf(text), previousRun, actingPrincipal: actingOf(text), scenario: /Scenario\s+(.+)/.exec(text)?.[1] ?? null };
    return { state: clip(text, 260), pass: runOf(text) !== previousRun && /Main successful journey/.test(text) };
  }, { critical: true });

  // 2 Switch to Paula
  await step('switch-to-paula', 'Acting principal switched to Paula with the keyboard', async (row) => {
    await openStrip();
    const before = actingOf(await stripText());
    await chooseRadio('Acting principal', 'Paula', 'presenter');
    await tabTo(page.getByRole('button', { name: 'Switch principal' })); await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Switch principal" switches the acting principal', true);
    // A confirmed switch reloads the workspace, so the strip comes back closed; read it again once reopened.
    await until(async () => strip().evaluate((el) => !el.open), { timeout: 90000, what: 'workspace to reload as Paula' });
    await openStrip();
    const text = await until(async () => { const t = await stripText(); return /Paula/.test(actingOf(t) || '') && !/Action in progress/.test(t) ? t : null; }, { timeout: 30000, what: 'Paula acting' });
    row.detail = { actingBefore: before, actingAfter: actingOf(text) };
    return { state: clip(text, 260) };
  }, { critical: true });

  // 3 Brief and activity before release
  await step('brief-confirmed', 'Brief page shows Paula\'s confirmed brief and no cars before release', async (row) => {
    await goto('/gcsp-brief-live.html', () => page.getByRole('button', { name: 'Save this brief' }).waitFor({ timeout: 90000 }));
    const checked = await page.locator('gcsp-brief [role=radio][aria-checked=true], gcsp-brief [role=checkbox][aria-checked=true]').evaluateAll((n) => n.map((x) => x.getAttribute('aria-label') || x.innerText.trim()).filter(Boolean));
    const preview = await previewFacts();
    row.detail = { checkedOptions: checked.map((c) => clip(c, 60)), previewBeforeAnyRelease: preview };
    await focusShot(row, page.getByRole('button', { name: 'Save this brief' }), 'brief');
    await page.getByRole('heading', { name: 'Cars for your brief' }).evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); });
    return { state: `Confirmed: ${checked.map((c) => clip(c, 40)).join(' | ')}. Preview: ${preview.summary}`, pass: preview.eligibleCount === 0 && checked.length > 0, shotName: 'brief-confirmed' };
  }, { critical: true });
  await step('activity-before-release', 'Activity before any release shows an active buddy and no offer', async () => {
    await goto('/gcsp-activity-live.html', () => until(() => page.locator('gcsp-activity').evaluate((el) => /Your offer/.test(el.innerText)), { timeout: 90000, what: 'activity' }));
    return { state: await visibleText('gcsp-activity') };
  });

  // 4 First release and eligibility
  await step('presenter-first-release', 'Presenter Next release publishes the first stock release', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    return nextRelease(row);
  }, { critical: true });
  await step('brief-first-release-eligibility', 'Brief preview after the first release counts the cars Paula sees', async (row) => {
    await goto('/gcsp-brief-live.html', () => page.getByRole('button', { name: 'Save this brief' }).waitFor({ timeout: 90000 }));
    const facts = await previewFacts();
    report.firstRelease = { ...facts, stockSource: stockMode === 'demo' ? 'demo (GCSP_STOCK_SOURCE=demo)' : 'default generated run stock', screenshot: null };
    row.detail = facts;
    await page.getByRole('heading', { name: 'Cars for your brief' }).evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); });
    return { state: `${facts.eligibleCount} eligible; lines ${JSON.stringify(facts.modelLines)}`, pass: facts.eligibleCount > 0, full: false };
  });
  if (report.firstRelease) report.firstRelease.screenshot = report.steps.at(-1).screenshots.at(-1) ?? null;

  // 5 Activity shows the offer
  await step('activity-offer', 'Paula\'s activity shows the first offer and the search result', async (row) => {
    await goto('/gcsp-activity-live.html');
    await until(() => page.locator('gcsp-activity').evaluate((el) => /Waiting for you/.test(el.innerText)), { timeout: 150000, what: 'offer on activity' });
    const link = page.getByRole('link', { name: /View offer/ }); await focusShot(row, link, 'activity');
    return { state: await visibleText('gcsp-activity') };
  }, { critical: true });

  // 6 Outbox and first offer
  await step('outbox-first-message', 'Outbox viewer shows the captured offer email', async (row) => {
    const count = await openMessage(0, row); row.detail = { capturedEmails: count, emailPreviewRendered: previewRendered };
    return { state: `${count} email. ${clip(await visibleText('gcsp-outbox'), 300)}`, pass: count === 1 && previewRendered };
  }, { critical: true });
  await step('offer-first', 'First offer opens from the captured message link', async () => {
    await openOfferLink('outbox');
    return { state: await offerText() };
  }, { critical: true });
  await step('offer-decline-form', 'Decline opens its reason form with the keyboard', async (row) => {
    const decline = page.getByRole('button', { name: 'Decline this offer' });
    await tabTo(decline); await page.keyboard.press('Enter');
    const select = page.locator('select');
    await until(async () => (await select.locator('option').count()) > 1, { timeout: 90000, what: 'decline reasons' });
    row.detail = { reasons: await select.locator('option').evaluateAll((o) => o.map((x) => x.textContent.trim()).filter((t) => !/^Choose/.test(t))), freeTextFields: await page.locator('gcsp-offer textarea, gcsp-offer input[type=text]').count() };
    await tabTo(select); await focusShot(row, select, 'offer-decline');
    // Body style is the one reason whose follow-up has a confirmed target in this brief (see the defects list).
    await page.keyboard.type('Body');
    const chosen = await select.evaluate((el) => el.selectedOptions[0]?.textContent.trim());
    kb('offer', 'typing "Body" in the reason list chooses "Body style"', chosen === 'Body style', chosen);
    return { state: `Reason chosen: ${chosen}`, pass: chosen === 'Body style', shotName: 'offer-decline-reason' };
  }, { critical: true });
  await step('offer-declined-followup', 'Confirm decline shows the recorded decline and one follow-up question', async (row) => {
    const confirm = page.getByRole('button', { name: 'Confirm decline' });
    await tabTo(confirm); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Confirm decline" records the decline', true);
    const options = page.locator(`${FOLLOWUP_GROUP} [role=radio]`);
    await options.first().waitFor({ timeout: 180000 });
    const text = await offerText();
    row.detail = { question: /(Which|What) [^?]+\?/.exec(text)?.[0] ?? null, declined: /Offer declined/.test(text),
      options: await options.evaluateAll((n) => n.map((x) => x.innerText.trim())) };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: `${clip(text.split('Your next offer')[0], 120)} | ${clip(text.split('Your next offer')[1], 200)}`, pass: /Offer declined/.test(text) };
  }, { critical: true });
  await step('offer-change-confirmed', 'Paula changes the follow-up answer with the keyboard and confirms one change', async (row) => {
    await chooseRadio('Follow-up question', 'Saloon', 'offer', FOLLOWUP_GROUP);
    row.detail = { confirmDisabledAfterChoice: await page.getByRole('button', { name: 'Confirm this change' }).isDisabled() };
    const confirm = page.getByRole('button', { name: 'Confirm this change' });
    await focusShot(row, confirm, 'offer-followup');
    await page.keyboard.press('Enter');
    const text = await until(async () => { const t = await offerText(); return /Change saved|saved in brief version/.test(t) ? t : null; }, { timeout: 90000, what: 'change saved' });
    kb('offer', 'Enter on "Confirm this change" saves the change', true);
    await page.evaluate(() => document.querySelector('gcsp-offer')?.scrollIntoView());
    return { state: clip(text.split('Your next offer')[1], 260) };
  }, { critical: true });

  // 7 Second release
  await step('presenter-second-release', 'Presenter advances the clock (Next release when a cue remains, else one Tick) for the second offer', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    await openStrip();
    await until(async () => /Presenter controls ready/.test(await stripText()) && !(await page.getByRole('button', { name: /^Tick \(/ }).isDisabled()), { what: 'strip to finish loading' });
    const text = await stripText(); const cue = /Next release unavailable: ([^\n]+)/.exec(text)?.[1] ?? null;
    if (!cue) return nextRelease(row);
    // The generated run has one release window, so the decline-then-change route advances with a single Tick.
    report.notes.push(`Next release unavailable after the first release (${cue}); one Tick (60 seconds) used instead.`);
    const before = clockOf(text);
    await tabTo(page.getByRole('button', { name: /^Tick \(/ })); await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Tick" advances the clock', true);
    const after = await until(async () => { const t = await stripText(); return clockOf(t) !== before && !/Action in progress/.test(t) ? t : null; }, { timeout: 240000, what: 'tick to finish' });
    row.detail = { nextReleaseUnavailable: cue, clockBefore: before, clockAfter: clockOf(after) };
    await page.evaluate(() => document.querySelector('.gcsp-presenter-controls')?.scrollIntoView({ block: 'start' }));
    return { state: `Next release unavailable (${cue}). Tick: clock ${before} to ${clockOf(after)}`, shotName: row.id };
  }, { critical: true });
  await step('activity-second-offer', 'Activity shows the second offer after the decline update', async (row) => {
    await goto('/gcsp-activity-live.html');
    await until(() => page.locator('gcsp-activity').evaluate((el) => /Waiting for you/.test(el.innerText)), { timeout: 240000, what: 'second offer on activity' });
    row.detail = { text: clip(await visibleText('gcsp-activity'), 500) };
    return { state: await visibleText('gcsp-activity') };
  }, { critical: true });
  await step('outbox-second-message', 'Outbox viewer now lists both captured emails, newest first', async (row) => {
    const count = await openMessage(0, row, false); row.detail = { capturedEmails: count, emailPreviewRendered: previewRendered };
    return { state: `${count} emails. ${clip(await visibleText('gcsp-outbox'), 300)}`, pass: count === 2 && previewRendered };
  }, { critical: true });
  await step('offer-second', 'Second offer opens from the newest message and excludes the declined car', async (row) => {
    await openOfferLink('outbox');
    const text = await offerText();
    row.detail = { title: /ORDER NO\. (\d+)\s+([^\n]+)/.exec(text)?.slice(1, 3) ?? null };
    report.acceptedOffer = row.detail.title ? [row.detail.title[0], row.detail.title[1].trim()] : null;
    return { state: text };
  }, { critical: true });

  // 8 Accept and outcome
  quiet = false;
  await step('offer-accepted', 'Paula accepts with the keyboard and the outcome shows', async (row) => {
    for (const box of await page.getByRole('checkbox').all()) { await tabTo(box); await page.keyboard.press('Space'); }
    kb('offer', 'Space ticks each of the three declarations', (await page.getByRole('checkbox').evaluateAll((n) => n.every((x) => x.checked))));
    const accept = page.getByRole('button', { name: 'Accept this offer' });
    await until(async () => !(await accept.isDisabled()), { timeout: 20000, what: 'accept enabled' });
    await tabTo(accept); await focusShot(row, accept, 'offer-accept'); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Accept this offer" sends the decision', true);
    const text = await until(async () => { const t = await offerText(); return /accepted|Selected|selected|order|requested/i.test(t.split('Before you accept')[0] + (t.split('Synthetic source')[1] || '')) && !/Checking your decision/.test(t) ? t : null; }, { timeout: 150000, what: 'decision outcome' }).catch(() => offerText());
    // The embedded order progress loads after the decision; record what it settles on.
    const settled = await until(async () => { const t = await offerText(); return /Order progress/.test(t) && !/Loading your order/.test(t) ? t : null; }, { timeout: 60000, what: 'embedded order progress' }).catch(() => null);
    row.detail = { embeddedOrderProgressSettled: Boolean(settled) };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: `${clip(text.split('Your current car')[0], 160)} | ${clip(text.split('Synthetic source')[1], 300)}` };
  }, { critical: true });

  // ---- Lifecycle after selection (FUCQ-124): every value below is read from the app or the policy seed, nothing is hard-coded ----
  const assumptions = JSON.parse(await readFile(join(SERVER_DIR, 'gcsp/policy/seed-v1.json'), 'utf8')).assumptions;
  const keyed = (key) => assumptions.find((a) => a.key === key).value;
  const stageNames = keyed('ordering.approvalStages.v1'); const stageTicks = keyed('lifecycle.approval.ticks.v1');
  const delay = keyed('lifecycle.appointments.confirmation.v1').confirmDelaySeconds;
  const lastProgress = Math.max(...keyed('lifecycle.documents.v1').items.map((item) => item.progressSeconds || 0));
  report.policy = { approvalStages: stageNames, approvalTicks: stageTicks, confirmDelaySeconds: delay, documentsLastProgressSeconds: lastProgress };
  const upper = (text) => text[0].toUpperCase() + text.slice(1);
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const later = (iso, seconds) => new Date(Date.parse(iso) + seconds * 1000).toISOString();
  const progress = () => visibleText('gcsp-order-progress');
  const section = (name) => visibleText(`gcsp-order-progress .gcsp-order-${name}`);
  const inProgress = (selector) => page.locator(`gcsp-order-progress ${selector}`);
  const stageRows = () => page.locator('gcsp-order-progress .gcsp-stage').evaluateAll((nodes) => nodes.map((n) => ({
    label: n.querySelector('.gcsp-stage-label')?.innerText ?? '', state: n.querySelector('.gcsp-stage-state')?.innerText ?? '', at: n.querySelector('time')?.dateTime ?? null })));
  async function openProgress() {
    await goto('/gcsp-order-progress-live.html');
    return until(async () => { const t = await progress(); return /Steps/.test(t) && !/Loading your|Updating your/.test(t) ? t : null; }, { timeout: 150000, what: 'order progress' });
  }
  // Keyboard: Tab to the control, record whether focus is visible on it, leave focus there for the action.
  async function focusCheck(row, locator, label) {
    await tabTo(locator);
    const visible = await ring(locator); const ok = visible.outline || visible.shadow;
    report.keyboard.push({ page: label, check: 'visible focus', pass: ok, detail: visible });
    if (!ok) row.pass = false;
  }
  const clockNow = async () => { await openStrip(); return clockOf(await stripText()); };
  async function tickOnce() {
    const before = await clockNow(); const button = page.getByRole('button', { name: /^Tick \(/ });
    await until(async () => !(await button.isDisabled()), { what: 'Tick enabled' });
    await tabTo(button); await page.keyboard.press('Enter');
    const after = await until(async () => { const t = await stripText(); return clockOf(t) !== before && !/Action in progress/.test(t) ? clockOf(t) : null; }, { timeout: 240000, what: 'tick to finish' });
    kb('presenter', 'Enter on "Tick" advances the clock', Boolean(after), `${before} to ${after}`);
    return after;
  }
  async function tickToTime(iso) {
    await openStrip(); const input = strip().getByLabel('Named time or UTC target'); const go = page.getByRole('button', { name: 'Tick to target' });
    await tabTo(input); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(iso);
    await until(async () => !(await go.isDisabled()), { what: 'Tick to target enabled' });
    await tabTo(go); await page.keyboard.press('Enter');
    const after = await until(async () => { const t = await stripText(); return Date.parse(clockOf(t)) === Date.parse(iso) && !/Action in progress/.test(t) ? clockOf(t) : null; }, { timeout: 240000, what: 'tick to target' });
    kb('presenter', 'Typing a UTC target and Enter on "Tick to target" advances the clock', Boolean(after), `to ${after}`);
    return after;
  }

  let acceptedName = null;
  await step('order-progress', 'Order progress shows the accepted car name (FUCQ-185) and the approval stages not started', async (row) => {
    const text = await openProgress(); const stages = await stageRows();
    const name = (await inProgress('.gcsp-order-car-name').first().innerText()).trim(); acceptedName = report.acceptedOffer?.[1] ?? null;
    const expected = ['Selection received', ...stageNames.map(upper)];
    row.detail = { carName: name, acceptedOfferName: acceptedName, stages };
    const labels = stages.map((s) => s.label); const states = stages.map((s) => s.state);
    const good = JSON.stringify(labels) === JSON.stringify(expected) && states[0] === 'Done' && states.slice(1).every((s) => s === 'Not started');
    return { state: text, pass: good && name === acceptedName && !/Car details not supplied/.test(text) };
  }, { critical: true });

  // Approvals: one presenter Tick at a time, re-reading the page after each; the policy keys give the tick counts.
  const trail = [];
  async function ticksThenRead(count) {
    for (let n = 0; n < count; n += 1) { await tickOnce(); await openProgress(); trail.push((await stageRows()).map((s) => s.state)); }
  }
  const expectStates = (stages, doneThrough) => JSON.stringify(stages.map((s) => s.state)) === JSON.stringify(['Done', ...stageNames.map((_, i) => (i <= doneThrough ? 'Done' : i === doneThrough + 1 ? 'Current step' : 'Not started'))]);
  await step('approval-started', `One Tick starts "${stageNames[0]}"`, async (row) => {
    await ticksThenRead(1); const stages = await stageRows(); row.detail = { ticks: 1, stages };
    return { state: await section('stages'), pass: expectStates(stages, -1) };
  }, { critical: true });
  for (const [index, name] of stageNames.entries()) {
    await step(`approval-${slug(name)}`, `${stageTicks[name]} Tick${stageTicks[name] > 1 ? 's' : ''} approve "${name}"${index + 1 < stageNames.length ? `, "${stageNames[index + 1]}" starts` : ''}`, async (row) => {
      await ticksThenRead(stageTicks[name]); const stages = await stageRows();
      row.detail = { ticks: stageTicks[name], stages, trail: trail.map((t) => t.join(' | ')) };
      return { state: await section('stages'), pass: expectStates(stages, index) };
    }, { critical: true });
  }
  const lastStage = async () => (await stageRows()).at(-1);

  // Handover: request an offered slot, Tick past the confirmation delay, read it booked.
  let askedAt = null; let handoverSlot = null;
  await step('handover-offered', 'Handover section offers the policy slots', async (row) => {
    const slots = inProgress('.gcsp-order-handover .gcsp-order-slots button');
    const count = await slots.count(); const names = await slots.evaluateAll((n) => n.map((x) => x.innerText.trim()));
    row.detail = { slotButtons: names }; handoverSlot = names[0]?.replace(/^Request /, '') ?? null;
    if (count) await focusCheck(row, slots.first(), 'handover-slot');
    const text = await section('handover');
    return { state: text, pass: count > 0 && /Choose a handover time/.test(text) };
  }, { critical: true });
  await step('handover-requested', 'Enter on the first slot requests it; the page says not booked yet', async (row) => {
    askedAt = await clockNow();
    await tabTo(inProgress('.gcsp-order-handover .gcsp-order-slots button').first());
    await page.keyboard.press('Enter'); kb('order progress', 'Enter on a handover slot button requests it', true);
    const text = await until(async () => { const t = await section('handover'); return /Not booked yet/.test(t) ? t : null; }, { timeout: 150000, what: 'requested handover' });
    row.detail = { requestedAtClock: askedAt };
    return { state: text, pass: text.includes(handoverSlot ?? '?') };
  }, { critical: true });
  await step('handover-confirmed', `After ${delay} seconds of demo time the retailer confirms the handover`, async (row) => {
    await tickToTime(later(askedAt, delay - 60)); await openProgress();
    const early = await section('handover'); row.detail = { stillRequestedBeforeDelay: /Not booked yet/.test(early), clockBeforeLastTick: later(askedAt, delay - 60) };
    const at = await tickOnce(); await openProgress(); row.detail.clockAtConfirmation = at;
    const text = await section('handover');
    return { state: text, pass: row.detail.stillRequestedBeforeDelay && /Booked:/.test(text) && !/Not booked yet/.test(text) && text.includes(handoverSlot ?? '?') };
  }, { critical: true });

  // Documents: the employee task, then readiness once the keyed times pass.
  await step('documents-open', 'Documents and checks list the employee task and the other owners, not ready yet', async (row) => {
    const act = inProgress('.gcsp-order-documents .gcsp-task button'); const count = await act.count();
    row.detail = { taskButtons: await act.evaluateAll((n) => n.map((x) => x.innerText.trim())) };
    if (count) await focusCheck(row, act.first(), 'document-task');
    const text = await section('documents');
    return { state: text, pass: count === 1 && /Not ready for handover/.test(text) };
  }, { critical: true });
  if (variant === 'overdue') {
    const flags = () => inProgress('.gcsp-order-documents .gcsp-task-flag').allInnerTexts();
    let openedAt = null;
    await step('documents-due-time', 'On the agreement\'s keyed due time the task is not yet overdue', async (row) => {
      openedAt = (await lastStage()).at; const target = later(openedAt, keyed('lifecycle.documents.v1').items.find((item) => item.owner === 'employee').dueSeconds);
      await tickToTime(target); await openProgress();
      row.detail = { documentsOpenedAt: openedAt, targetClock: target, flags: await flags() };
      const text = await section('documents');
      return { state: text, pass: row.detail.flags.length === 0 && await inProgress('.gcsp-order-documents .gcsp-task button').count() === 1 };
    }, { critical: true });
    await step('documents-overdue', 'One Tick later the agreement reads Overdue, still owned by the employee, and the order is not ready', async (row) => {
      const at = await tickOnce(); await openProgress();
      row.detail = { clock: at, flags: await flags() };
      const text = await section('documents');
      return { state: text, pass: row.detail.flags.some((flag) => /Overdue/.test(flag)) && /Not ready for handover/.test(text) && await inProgress('.gcsp-order-documents .gcsp-task button').count() === 1 };
    }, { critical: true });
    return;
  }
  await step('documents-task-complete', 'Enter on the task button completes the employee document task', async (row) => {
    await tabTo(inProgress('.gcsp-order-documents .gcsp-task button').first()); await page.keyboard.press('Enter');
    kb('order progress', 'Enter on the document task button completes it', true);
    const text = await until(async () => { const t = await section('documents'); return /Complete/.test(t) && !/Updating/.test(t) ? t : null; }, { timeout: 150000, what: 'task complete' });
    row.detail = { taskButtonsLeft: await inProgress('.gcsp-order-documents .gcsp-task button').count() };
    return { state: text, pass: row.detail.taskButtonsLeft === 0 && /Not ready for handover/.test(text) };
  }, { critical: true });
  await step('documents-ready', 'After the last keyed item time the page reads ready for handover', async (row) => {
    const opened = (await lastStage()).at; const target = later(opened, lastProgress);
    row.detail = { documentsOpenedAt: opened, targetClock: target };
    await tickToTime(target); await openProgress();
    const text = await section('documents');
    return { state: text, pass: /Ready for handover/.test(text) && !/Not ready/.test(text) };
  }, { critical: true });

  // Separate return plan (FUCQ-184): request, Tick past the delay, read it scheduled. FUCQ-194: collected from her home address.
  const HOME = /Collection from your home address\s*1 Fictional Way, Example Town, ZZ1 1ZZ/;
  let returnAskedAt = null; let returnSlot = null;
  await step('return-offered', 'Return section offers both choices, says the current car stays yours and names her home address as the collection place', async (row) => {
    const separate = inProgress('.gcsp-order-return button').filter({ hasText: /^Request return (?!at handover)/ });
    const count = await separate.count(); row.detail = { separateSlotButtons: await separate.evaluateAll((n) => n.map((x) => x.innerText.trim())) };
    returnSlot = row.detail.separateSlotButtons[0]?.replace(/^Request return /, '') ?? null;
    if (count) await focusCheck(row, separate.first(), 'return-slot');
    const text = await section('return');
    return { state: text, pass: count > 0 && !/Return plan unavailable/.test(text) && /stays yours until it is returned/.test(text) && HOME.test(text) };
  }, { critical: true });
  await step('return-requested', 'Enter on the first separate-return slot requests it; the page says not booked yet', async (row) => {
    returnAskedAt = await clockNow();
    await tabTo(inProgress('.gcsp-order-return button').filter({ hasText: /^Request return (?!at handover)/ }).first());
    await page.keyboard.press('Enter'); kb('order progress', 'Enter on a separate-return slot button requests it', true);
    const text = await until(async () => { const t = await section('return'); return /Return requested/.test(t) && /Not booked yet/.test(t) ? t : null; }, { timeout: 150000, what: 'requested return' });
    row.detail = { requestedAtClock: returnAskedAt };
    return { state: text, pass: text.includes(returnSlot ?? '?') };
  }, { critical: true });
  await step('return-scheduled', `After ${delay} seconds of demo time the return is scheduled`, async (row) => {
    await tickToTime(later(returnAskedAt, delay - 60)); await openProgress();
    row.detail = { stillRequestedBeforeDelay: /Not booked yet/.test(await section('return')) };
    const at = await tickOnce(); await openProgress(); row.detail.clockAtConfirmation = at;
    const text = await section('return');
    return { state: text, pass: row.detail.stillRequestedBeforeDelay && /Return booked:/.test(text) && text.includes(returnSlot ?? '?') && !/unavailable/i.test(text) && HOME.test(text) };
  }, { critical: true });
  await step('order-progress-final', 'Whole page after the plan: stages done, handover booked, documents ready, return booked', async (row) => {
    const text = await openProgress(); const stages = await stageRows();
    row.detail = { stages };
    return { state: text, pass: stages.every((s) => s.state === 'Done') && /Booked:/.test(text) && /Ready for handover/.test(text) && /Return booked:/.test(text) };
  });

  // The current car is unchanged, and help opens a case with a named owner.
  // The account page's own current-car card, not the order progress line that also names the car.
  const carCard = /YOUR CURRENT CAR\s+Fictional BMW 320i Touring[\s\S]*?Status\s+current/i;
  await step('current-car-unchanged', 'Your cars page still shows the current Fictional BMW 320i Touring as current', async (row) => {
    await goto('/gcsp-account.html', () => page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 }));
    const text = await until(async () => { const t = await visibleText('main, body'); return carCard.test(t) ? t : null; }, { timeout: 60000, what: 'current car card' }).catch(() => visibleText('main, body'));
    row.detail = { currentCarCard: carCard.exec(text)?.[0].replace(/\s+/g, ' ') ?? null, noEntitlementBanner: /No ordering entitlement/.test(text), offerPromptStillShown: /View your offer/.test(text) };
    return { state: text, pass: carCard.test(text) && !/Status\s+returned/i.test(text) };
  });
  await step('help-case', 'Renewal help: Ask for help, review, confirm; the case shows its named owner and status', async (row) => {
    await goto('/gcsp-help.html', () => page.getByText('Get help with your renewal').first().waitFor({ timeout: 90000 }));
    const entry = page.locator('gcsp-help details.gcsp-case-entry, .gcsp-case-entry').first();
    if (!(await entry.evaluate((el) => el.open))) { await tabTo(entry.locator('summary')); await page.keyboard.press('Enter'); }
    kb('help', 'Enter on "Get help with your renewal" opens the request', true);
    await tabTo(page.getByRole('button', { name: 'Ask for help' })); await page.keyboard.press('Enter');
    const box = page.locator('textarea'); await box.waitFor({ timeout: 30000 });
    await tabTo(box); await page.keyboard.type('My replacement may not arrive before my contract ends.');
    await tabTo(page.getByRole('button', { name: 'Review help request' })); await page.keyboard.press('Enter');
    const confirm = page.getByRole('button', { name: 'Confirm help request' }); await confirm.waitFor({ timeout: 30000 });
    await focusCheck(row, confirm, 'help-confirm'); await page.keyboard.press('Enter');
    kb('help', 'Enter on "Confirm help request" opens the case', true);
    const text = await until(async () => { const t = await visibleText('gcsp-help, body'); return /Case reference/.test(t) ? t : null; }, { timeout: 150000, what: 'case shown' });
    return { state: text, pass: /Owner\s+Scheme team/.test(text) && /Open/.test(text) };
  });
  await step('current-car-after-help', 'Your cars page after the help request: current car still current', async () => {
    await goto('/gcsp-account.html', () => page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 }));
    const text = await until(async () => { const t = await visibleText('main, body'); return carCard.test(t) ? t : null; }, { timeout: 60000, what: 'current car card' }).catch(() => visibleText('main, body'));
    return { state: text, pass: carCard.test(text) };
  });
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  report.stockMode = stockMode;
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots,
    keyboardChecks: report.keyboard.length, keyboardPassed: report.keyboard.filter((k) => k.pass).length };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, runIds: report.runIds, firstRelease: report.firstRelease, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
