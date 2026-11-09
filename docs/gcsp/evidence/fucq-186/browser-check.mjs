// FUCQ-186 browser check: FUCQ-109 walkthrough cut at the first release, asserting Paula's brief gallery is in fit order.
// Spawns `node index.js` in server/ as Render does (GCSP_RUNTIME=1, memory, one HTTP origin behind the demo key). Nothing is stubbed.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const chunk = process.env.FUCQ89_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ89_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ89_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ89_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const shotDir = join(HERE, 'browser');
const resultsFile = join(HERE, `results-${chunk}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
// Default is the generated run stock as Render runs it; FUCQ89_STOCK=demo forces demo stock.
let stockMode = process.env.FUCQ89_STOCK === 'demo' ? 'demo' : 'default';
const report = { chunk, entry: 'hosted', viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), runIds: {}, steps: [], keyboard: [],
  firstRelease: null, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let context; let page; let app; let child; let halted = null; let previewRendered = null;
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

async function shot(name, full = true) {
  shots += 1;
  const file = `${vp}-${String(shots).padStart(2, '0')}-${name}.png`;
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
    try { row.screenshots.push(await shot(`${id}-failed`)); } catch { /* page gone */ }
    if (critical) halted = id;
  }
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
async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}
// The Render command and env, plus a throwaway demo key. GCSP_STOCK_SOURCE is set only to force demo stock.
async function startHost() {
  // Leads share this Mac, so a lead may pin FUCQ89_PORT; 127.0.0.1 keeps cookies apart from other localhost hosts.
  const port = Number(process.env.FUCQ89_PORT) || await freePort();
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
    const pct = facts.cardOrder.map((c) => Number(/\((\d+)%\)$/.exec(c)?.[1]));
    const fitOrdered = pct.every((v, i) => Number.isFinite(v) && (i === 0 || pct[i - 1] >= v)); report.firstRelease.fitOrdered = fitOrdered;
    return { state: `${facts.eligibleCount} eligible; order ${facts.cardOrder.join(', ')}; fit ordered ${fitOrdered}`, pass: facts.eligibleCount > 0 && fitOrdered, full: false };
  });
  if (report.firstRelease) report.firstRelease.screenshot = report.steps.at(-1).screenshots.at(-1) ?? null;

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
