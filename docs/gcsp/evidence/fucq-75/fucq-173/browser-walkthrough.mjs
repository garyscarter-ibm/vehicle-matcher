// FUCQ-173 browser walkthrough of "Decline then change, no second car yet", one viewport per run
// (FUCQ173_CHUNK=desktop|narrow). Spawns `node index.js` in server/ as Render does (GCSP_RUNTIME=1, memory) on 127.0.0.1, port 8950-8969. Nothing is stubbed.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../../server');
const chunk = process.env.FUCQ173_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ173_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ173_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ173_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
// Default is the generated run stock as Render runs it; FUCQ173_STOCK=demo forces demo stock.
const stockMode = process.env.FUCQ173_STOCK === 'demo' ? 'demo' : 'default';
const suffix = stockMode === 'demo' ? '-demo' : '';
const resultsFile = join(HERE, `results-${chunk}${suffix}.json`);
const profile = join(scratch, 'browser', `chrome-${chunk}${suffix}`);
const preload = join(scratch, 'loopback-listen.cjs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { chunk, entry: 'hosted', viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), runIds: {}, steps: [], keyboard: [],
  paula: {}, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let context; let page; let app; let child; let halted = null;
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
  const file = `${name}-${vp}${suffix}.png`;
  await page.screenshot({ path: join(HERE, file), fullPage: full });
  return file;
}

// A step records pass/fail, the observed state text and its screenshots. A failed critical step blocks the rest.
async function step(id, name, run, { critical = false } = {}) {
  const row = { id, name, pass: false, screenshots: [] };
  report.steps.push(row);
  if (halted) { row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    row.overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)).catch(() => null);
    row.pass = out.pass !== false && !(row.overflowPx > 2); row.state = clip(out.state, 600); if (out.detail !== undefined) row.detail = out.detail;
    if (out.shotName) row.screenshots.push(await shot(out.shotName, out.full !== false));
  } catch (error) {
    row.error = clip(error.stack, 500);
    if (critical) halted = id;
  }
  await save();
}

// Keyboard helpers: Tab from the current focus until the target holds it.
const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement).catch(() => false);
async function tabTo(locator, { max = 200 } = {}) {
  await locator.first().waitFor({ state: 'attached', timeout: 30000 });
  for (let count = 0; count <= max; count += 1) {
    if (await isFocused(locator.first())) return count;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
}
const ring = (locator) => locator.first().evaluate((el) => {
  const s = getComputedStyle(el);
  const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
  const shadow = s.boxShadow && s.boxShadow !== 'none';
  return { outline, shadow: Boolean(shadow), label: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 60) };
});
const kb = (pageName, action, pass, detail) => report.keyboard.push({ page: pageName, check: action, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
async function focusCheck(locator, label) {
  await tabTo(locator);
  const visible = await ring(locator);
  kb(label, 'Tab reaches the control with a visible focus indicator', visible.outline || visible.shadow, visible);
}

// ---- Hosted entry on 127.0.0.1, ports 8950-8969 only ----
async function freePort() {
  for (let port = 8950; port <= 8969; port += 1) {
    const probe = createServer();
    const ok = await new Promise((done) => { probe.once('error', () => done(false)); probe.listen(port, '127.0.0.1', () => done(true)); });
    if (ok) { await new Promise((done) => probe.close(done)); return port; }
  }
  throw new Error('No free port in 8950-8969');
}
async function startHost() {
  const port = Number(process.env.FUCQ173_PORT) || await freePort();
  if (port < 8950 || port > 8969) throw new Error('Port must be in 8950-8969');
  const origin = `http://127.0.0.1:${port}`;
  // The server's own listen() has no host option, so a preload pins it to loopback.
  await writeFile(preload, "const net = require('node:net'); const listen = net.Server.prototype.listen;\n"
    + "net.Server.prototype.listen = function (...a) { if (typeof a[0] === 'number' && typeof a[1] !== 'string') a.splice(1, 0, '127.0.0.1'); return listen.apply(this, a); };\n");
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
    GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: ACCESS_KEY, PORT: String(port), ...(stockMode === 'demo' ? { GCSP_STOCK_SOURCE: 'demo' } : {}) };
  child = spawn(process.execPath, ['--require', preload, 'index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Host not ready in time: ${clip(output.slice(-300))}`)), 90000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Host exited (${code}): ${clip(output.slice(-300))}`)); });
  });
  await ready;
  report.origin = origin;
  return { origin, stop: async () => { if (child.exitCode === null) { const gone = once(child, 'exit'); child.kill('SIGTERM'); setTimeout(killServer, 5000).unref(); await gone; } } };
}

// ---- Presenter strip helpers ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (text) => /DemoClock \(UTC\)\s+(\S+)/.exec(text)?.[1] ?? null;
const runOf = (text) => /\bRun\s+(\S+)/.exec(text)?.[1] ?? null;
const actingOf = (text) => /Acting principal\s+(.+)/.exec(text)?.[1]?.trim() ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 90000 });
  if (!(await root.evaluate((el) => el.open))) await root.locator(':scope > summary').click();
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 90000 });
}
async function openStripByKeyboard() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 90000 });
  if (!(await root.evaluate((el) => el.open))) { await tabTo(root.locator(':scope > summary')); await page.keyboard.press('Enter'); }
  const ok = await root.evaluate((el) => el.open);
  kb('presenter', 'Enter on "Presenter controls" opens the strip', ok);
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 90000 });
  return ok;
}
async function chooseRadio(groupLabel, target, pageName) {
  const scope = `[role=radiogroup][aria-label="${groupLabel}"]`;
  const radios = page.locator(`${scope} [role=radio]`);
  await radios.first().waitFor({ timeout: 30000 });
  const checked = page.locator(`${scope} [role=radio][aria-checked=true]`);
  const current = async () => (await checked.first().innerText().catch(() => '')).trim();
  await until(async () => (await checked.count()) > 0 && !(await radios.first().isDisabled()), { timeout: 30000, what: `${groupLabel} selection` }).catch(() => {});
  if (!(await checked.count())) { await tabTo(radios.first()); } else { await tabTo(checked); }
  const total = await radios.count();
  for (let i = 0; i <= total && !(await current()).startsWith(target); i += 1) await page.keyboard.press('ArrowDown');
  const now = await current(); const ok = now.startsWith(target);
  kb(pageName, `arrow keys choose "${target}" in "${groupLabel}"`, ok, clip(now, 80));
  if (!ok) throw new Error(`Arrow keys did not reach ${target}`);
}
async function goto(path, ready) {
  await page.goto(`${app.origin}${path}`, { waitUntil: 'load', timeout: 120000 });
  if (ready) await ready();
}
const visibleText = (selector) => page.locator(selector).first().evaluate((el) => el.innerText);

// Switch the acting principal with the keyboard; the confirmed switch reloads the workspace.
async function switchTo(name) {
  await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
  await openStrip();
  const before = actingOf(await stripText());
  await chooseRadio('Acting principal', name, 'presenter');
  await tabTo(page.getByRole('button', { name: 'Switch principal' })); await page.keyboard.press('Enter');
  kb('presenter', `Enter on "Switch principal" switches to ${name}`, true);
  await until(async () => strip().evaluate((el) => !el.open), { timeout: 90000, what: `workspace to reload as ${name}` });
  await openStrip();
  const text = await until(async () => { const t = await stripText(); return (actingOf(t) || '').startsWith(name) && !/Action in progress/.test(t) ? t : null; }, { timeout: 30000, what: `${name} acting` });
  return { before, after: actingOf(text) };
}

// Interactive controls inside an element, in tab order, with their text and target.
const controlsIn = (selector) => page.locator(selector).first().evaluate((root) => [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
  .filter((el) => el.offsetParent !== null).map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().slice(0, 80), href: el.getAttribute('href') })));

// Activity view: wait until it has settled on a result and read it.
async function readActivity() {
  await goto('/gcsp-activity-live.html');
  await until(() => page.locator('gcsp-activity').evaluate((el) => el.innerText.trim().length > 40 && !/Loading/.test(el.innerText)), { timeout: 120000, what: 'activity to load' });
  await wait(1000);
  return visibleText('gcsp-activity');
}

// Press a strip button by keyboard and wait for the action to settle.
async function pressStrip(name) {
  await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
  await openStrip();
  const before = await stripText();
  const button = page.getByRole('button', name === 'Tick' ? { name: /^Tick \(/ } : { name, exact: true });
  await until(async () => !(await button.isDisabled()), { timeout: 60000, what: `${name} enabled` });
  await tabTo(button); await page.keyboard.press('Enter');
  kb('presenter', `Enter on "${name}" runs the tick`, true);
  await wait(1500);
  return until(async () => { const now = await stripText(); return now !== before && !/Action in progress/.test(now) ? now : null; }, { timeout: 480000, what: `${name} to finish` });
}

// Visible text of the first match, or '' while it is absent.
const textOf = (selector) => page.locator(selector).first().evaluate((el) => el.innerText).catch(() => '');
const followupText = () => textOf('[data-offer-followup]');
const offerText = () => textOf('gcsp-offer');

async function run() {
  await mkdir(profile, { recursive: true }); await mkdir(scratch, { recursive: true });
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

  const scenarioName = 'Decline then change, no second car yet';
  await step('access-key', 'The demo key form opens the hosted demo, key typed by keyboard once', async () => {
    await page.goto(`${app.origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
    const input = page.locator('#key');
    await input.waitFor({ timeout: 30000 });
    await tabTo(input); await page.keyboard.type(ACCESS_KEY);
    const typed = (await input.inputValue()).length === ACCESS_KEY.length;
    await page.keyboard.press('Enter');
    await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
    kb('access', 'Tab reaches the demo key field; typing the key and Enter opens the demo', typed);
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    return { pass: typed, state: 'Presenter page opened' };
  }, { critical: true });

  let previousRun = null;
  await step('scenario-reset', `Scenario "${scenarioName}" chosen with arrow keys and reset confirmed by keyboard`, async (row) => {
    const ok = await openStripByKeyboard();
    previousRun = runOf(await stripText()); report.runIds.previous = previousRun;
    await chooseRadio('Scenario', scenarioName, 'presenter');
    await tabTo(page.getByRole('button', { name: 'Reset scenario' })); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Confirm reset' }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Reset scenario" then "Confirm reset" resets the run', true);
    await until(async () => { await strip().waitFor({ state: 'attached', timeout: 1000 }); const t = await stripText().catch(() => ''); return !/Action in progress/.test(t) && runOf(t) && runOf(t) !== previousRun ? t : null; }, { timeout: 120000, what: 'new run after reset' }).catch(async () => { await openStrip(); return stripText(); });
    await page.waitForLoadState('load');
    await openStrip();
    const after = await stripText(); report.runIds.new = runOf(after);
    const clock = clockOf(after);
    row.detail = { previousRun, newRun: runOf(after), clock };
    return { pass: ok && runOf(after) !== previousRun && /09:30/.test(clock || ''), state: clip(after, 400), shotName: 'reset-done' };
  }, { critical: true });

  let offerUrl = null;
  await step('first-offer', 'Paula opens her first offer from Buddy activity by keyboard', async (row) => {
    row.detail = await switchTo('Paula');
    await readActivity();
    const scope = page.locator('.gcsp-activity');
    const view = scope.getByRole('link', { name: 'View offer' }).or(scope.getByRole('button', { name: 'View offer' }));
    await tabTo(view); await page.keyboard.press('Enter');
    kb('activity', 'Enter on "View offer" opens the offer', true);
    await page.getByRole('button', { name: 'Decline this offer' }).waitFor({ timeout: 180000 });
    offerUrl = page.url();
    const text = await offerText(); report.paula.firstOffer = text;
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: clip(text, 600), shotName: 'first-offer', pass: /3 Series Touring/i.test(text) };
  }, { critical: true });

  await step('decline-reason', 'Paula presses Decline and chooses the reason Equipment by keyboard', async (row) => {
    const decline = page.getByRole('button', { name: 'Decline this offer' });
    await until(async () => !(await decline.isDisabled()), { timeout: 30000, what: 'decline enabled' });
    await tabTo(decline); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Decline this offer" opens the reason choice', true);
    const select = page.locator('select[data-offer-reason]');
    await until(async () => (await select.locator('option').count()) > 1 && !(await select.isDisabled()), { timeout: 60000, what: 'decline reasons' });
    row.detail = { options: await select.locator('option').allInnerTexts() };
    await tabTo(select); await page.keyboard.type('Equipment');
    const chosen = await select.evaluate((el) => el.selectedOptions[0]?.textContent?.trim());
    kb('offer', 'Typing "Equipment" on the reason list chooses it', chosen === 'Equipment', chosen);
    if (chosen !== 'Equipment') throw new Error(`Reason chosen was ${chosen}`);
    row.detail.chosen = chosen;
    return { state: clip(await offerText(), 700), shotName: 'decline-reason' };
  }, { critical: true });

  await step('decline-submit', 'Paula confirms the decline; the follow-up asks which equipment is essential', async (row) => {
    const confirm = page.getByRole('button', { name: 'Confirm decline' });
    await until(async () => !(await confirm.isDisabled()), { timeout: 20000, what: 'confirm decline enabled' });
    await tabTo(confirm); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Confirm decline" records the decline', true);
    const area = page.getByLabel('Required equipment');
    await area.waitFor({ timeout: 180000 });
    const text = await offerText(); report.paula.declined = text;
    row.detail = { followup: clip(await followupText(), 400) };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: clip(text, 700), shotName: 'question-equipment', pass: /Which equipment is essential for your next car\?/.test(text) && /Offer declined/i.test(text) };
  }, { critical: true });

  await step('change-saved', 'Paula adds Tow bar and confirms by keyboard; the page reads waiting', async (row) => {
    const area = page.getByLabel('Required equipment');
    await tabTo(area); await page.keyboard.type('Tow bar');
    kb('follow-up', 'Typing "Tow bar" in the equipment box adds the item', (await area.inputValue()) === 'Tow bar');
    const confirm = page.getByRole('button', { name: 'Confirm this change' });
    await until(async () => !(await confirm.isDisabled()), { timeout: 20000, what: 'confirm change enabled' });
    await tabTo(confirm); await page.keyboard.press('Enter');
    kb('follow-up', 'Enter on "Confirm this change" saves the change', true);
    const text = await until(async () => { const t = await followupText(); return /Change saved|Waiting for the next release/.test(t) ? t : null; }, { timeout: 180000, what: 'saved or waiting state' });
    await wait(1500);
    const settled = await followupText();
    report.paula.waitingFollowup = settled; report.paula.waitingPage = await offerText();
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: clip(settled, 700), shotName: 'waiting', pass: /Change saved|Waiting for the next release/.test(settled) && !/Your next car offer/.test(settled) };
  }, { critical: true });

  await step('tick', 'One presenter Tick (60 s) from the strip, by keyboard', async (row) => {
    const ticked = await pressStrip('Tick');
    row.detail = { strip: clip(ticked.split('Last tick').pop(), 400), clock: clockOf(ticked) };
    return { state: row.detail.strip };
  }, { critical: true });

  await step('after-tick', 'Paula presses Check current state; no second offer, no claim a car was found', async (row) => {
    await switchTo('Paula');
    await page.goto(offerUrl, { waitUntil: 'load', timeout: 120000 });
    await until(async () => { const t = await offerText(); return t.length > 80 && !/Loading/.test(t) ? t : null; }, { timeout: 120000, what: 'offer to load' });
    await wait(1500);
    report.paula.reloadedFollowup = await followupText();
    const refresh = page.getByRole('button', { name: 'Check current state' }).last();
    await tabTo(refresh); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Check current state" rechecks the offer and follow-up', true);
    await wait(3000);
    await until(async () => { const t = await offerText(); return !/Loading|Checking/.test(t) ? t : null; }, { timeout: 120000, what: 'recheck to settle' });
    await wait(1500);
    const follow = await followupText(); const page_ = await offerText();
    report.paula.afterTickFollowup = follow; report.paula.afterTickPage = page_;
    await page.evaluate(() => window.scrollTo(0, 0));
    const claims = /Your next car offer|Open this offer|new offer|found/i.test(page_);
    const pass = !claims && /Nothing suitable yet|Waiting for the next release|Change saved/.test(follow);
    row.detail = { claimsCar: claims };
    return { state: clip(follow, 700), shotName: 'after-tick', pass };
  }, { critical: true });

  await step('activity-after-tick', 'Paula\'s Buddy activity after the tick', async (row) => {
    const text = await readActivity(); await wait(2000);
    const settled = await visibleText('gcsp-activity');
    report.paula.activityAfterTick = settled;
    const hasSecond = (settled.match(/3 Series|Touring|View offer/gi) || []).length;
    row.detail = { offerWordsSeen: hasSecond, noMatchWords: /no match|nothing suitable|0 suitable|no suitable/i.test(settled) };
    return { state: settled, shotName: 'activity-after-tick' };
  });
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots,
    keyboardChecks: report.keyboard.length, keyboardPassed: report.keyboard.filter((k) => k.pass).length };
  report.overflow = { horizontal: report.steps.some((s) => s.overflowPx > 2), maxPx: Math.max(0, ...report.steps.map((s) => s.overflowPx || 0)) };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, runIds: report.runIds, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
