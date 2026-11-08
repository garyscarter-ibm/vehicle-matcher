// FUCQ-127 browser walkthrough of the no-suitable-match scenario, one viewport per run (FUCQ127_CHUNK=desktop|narrow).
// Spawns `node index.js` in server/ as Render does (GCSP_RUNTIME=1, memory) on 127.0.0.1, port 8950-8969. Nothing is stubbed.
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
const chunk = process.env.FUCQ127_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ127_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ127_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ127_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
// Default is the generated run stock as Render runs it; FUCQ127_STOCK=demo forces demo stock.
const stockMode = process.env.FUCQ127_STOCK === 'demo' ? 'demo' : 'default';
const suffix = stockMode === 'demo' ? '-demo' : '';
const resultsFile = join(HERE, `results-${chunk}${suffix}.json`);
const profile = join(scratch, 'browser', `chrome-${chunk}${suffix}`);
const preload = join(scratch, 'loopback-listen.cjs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { chunk, entry: 'hosted', viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), runIds: {}, steps: [], keyboard: [],
  paula: null, alex: null, greg: null, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
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
  const port = Number(process.env.FUCQ127_PORT) || await freePort();
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
  if (!(await root.evaluate((el) => el.open))) await root.locator('summary').click();
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 90000 });
}
async function openStripByKeyboard() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 90000 });
  if (!(await root.evaluate((el) => el.open))) { await tabTo(root.locator('summary')); await page.keyboard.press('Enter'); }
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

  // 1 Access and scenario reset from the presenter controls
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
  await step('scenario-reset', 'Scenario "No suitable match" chosen with arrow keys and reset confirmed by keyboard', async (row) => {
    const ok = await openStripByKeyboard();
    previousRun = runOf(await stripText()); report.runIds.previous = previousRun;
    await chooseRadio('Scenario', 'No suitable match', 'presenter');
    await tabTo(page.getByRole('button', { name: 'Reset scenario' })); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Confirm reset' }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Reset scenario" then "Confirm reset" resets the run', true);
    const text = await until(async () => { await strip().waitFor({ state: 'attached', timeout: 1000 }); const t = await stripText().catch(() => ''); return !/Action in progress/.test(t) && runOf(t) && runOf(t) !== previousRun ? t : null; }, { timeout: 300000, what: 'new run after reset' }).catch(async () => { await openStrip(); return stripText(); });
    await page.waitForLoadState('load');
    await openStrip();
    const after = await stripText(); report.runIds.new = runOf(after);
    row.detail = { previousRun, newRun: runOf(after), scenario: /Scenario\s+(.+)/.exec(after)?.[1] ?? null, clock: clockOf(after), releaseCue: /Release cue: (\S+)/.exec(after)?.[1] ?? null };
    await page.evaluate(() => document.querySelector('.gcsp-presenter-controls')?.scrollIntoView({ block: 'start' }));
    return { pass: ok && Boolean(runOf(after)) && runOf(after) !== previousRun, state: clip(after, 400), shotName: 'reset-done' };
  }, { critical: true });

  // 2 Next release
  await step('next-release', 'Next release runs the release and allocation', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    await openStrip();
    const before = clockOf(await stripText());
    const button = page.getByRole('button', { name: 'Next release' });
    await until(async () => !(await button.isDisabled()), { timeout: 60000, what: 'Next release enabled' });
    await tabTo(button); await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Next release" runs the release', true);
    const text = await until(async () => { const now = await stripText(); return clockOf(now) !== before && !/Action in progress/.test(now) && /Presenter controls ready|Last tick/.test(now) ? now : null; }, { timeout: 480000, what: 'release to finish' });
    row.detail = { clockBefore: before, clockAfter: clockOf(text), carsReleased: Number(/(\d+) cars released/.exec(text)?.[1] ?? NaN) || null };
    await page.evaluate(() => document.querySelector('.gcsp-presenter-controls')?.scrollIntoView({ block: 'start' }));
    return { state: `Clock ${before} to ${clockOf(text)}; ${clip(text.split('Last tick').pop(), 200)}`, shotName: 'next-release' };
  }, { critical: true });

  // 3 Paula's activity view
  await step('activity-paula', 'Paula\'s activity view after the release', async (row) => {
    row.detail = await switchTo('Paula');
    const pageText = await readActivity();
    // The activity region itself, apart from the shell navigation and presenter strip.
    const text = await visibleText('.gcsp-activity');
    const controls = await controlsIn('.gcsp-activity');
    const findings = {
      a_searchedNoSuitableMatchYet: /still searching|no match|0 suitable|no suitable/i.test(text),
      b_gateOrEssentialNamed: /seat|essential|gate|blocked|excluded/i.test(text),
      c_nextStepInActivityRegion: /keep searching|review (your|the) brief|change your brief|update your brief|edit your brief/i.test(text),
      d_noEmptyError: !/error|went wrong|unavailable|could not/i.test(text) && text.trim().length > 40,
    };
    report.paula = { activityRegionText: text, pageText, controls, findings };
    row.detail = { ...row.detail, findings, controls };
    row.screenshots.push(await shot('activity-paula'));
    for (const c of controls) {
      await focusCheck(page.locator('.gcsp-activity').getByRole('button', { name: c.text, exact: true }), `activity "${clip(c.text, 40)}"`)
        .catch((e) => kb('activity', `Tab reaches "${clip(c.text, 40)}"`, false, clip(e.message, 100)));
    }
    return { state: text, pass: findings.a_searchedNoSuitableMatchYet && findings.d_noEmptyError };
  }, { critical: true });
  await step('activity-paula-next-action', 'Paula\'s next actions by keyboard: Search actions menu and the Your car brief navigation', async (row) => {
    const actions = page.locator('.gcsp-activity').getByRole('button', { name: 'Search actions', exact: true });
    await tabTo(actions); await page.keyboard.press('Enter');
    const items = await page.getByRole('menuitem').evaluateAll((n) => n.map((x) => ({ text: x.innerText.trim(), disabled: x.disabled || x.getAttribute('aria-disabled') === 'true' }))).catch(() => []);
    kb('activity', 'Enter on "Search actions" opens its menu', items.length > 0, items);
    await page.keyboard.press('Escape');
    const nav = page.getByRole('button', { name: 'Your car brief', exact: true });
    // At narrow widths the navigation sits behind the Menu button.
    if (!(await nav.first().isVisible().catch(() => false))) {
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      await tabTo(menu); await page.keyboard.press('Enter');
      kb('shell', 'Enter on "Menu" opens the navigation', await nav.first().isVisible().catch(() => false));
    }
    await nav.first().waitFor({ state: 'visible', timeout: 10000 });
    const brief = await nav.first().evaluate((el) => el.innerText.trim());
    await tabTo(nav); await page.keyboard.press('Enter');
    await page.waitForLoadState('load').catch(() => {});
    await wait(1500);
    const landed = bare(page.url());
    const briefText = await page.locator('body').innerText().catch(() => '');
    kb('activity', 'Enter on the "Your car brief" navigation item opens the brief', /brief/i.test(landed) || /Save this brief|Your car brief/i.test(briefText), { url: landed });
    row.detail = { searchActionsMenu: items, navigationLabel: brief, landed };
    return { state: `Menu: ${JSON.stringify(items)}. Navigation went to ${landed}` };
  });

  // 4 Alex
  await step('activity-alex', 'Alex\'s activity view after the same release', async (row) => {
    row.detail = await switchTo('Alex');
    const pageText = await readActivity();
    const text = await visibleText('.gcsp-activity');
    const hasOffer = !/No current offer/.test(text) && /View offer|Waiting for you/.test(text);
    report.alex = { activityRegionText: text, pageText, hasOffer };
    row.detail = { ...row.detail, hasOffer };
    return { state: text, shotName: 'activity-alex' };
  });

  // 5 Greg
  await step('greg-demand', 'Greg\'s demand figures show the blocking gate', async (row) => {
    row.detail = await switchTo('Greg');
    await until(() => page.locator('[data-presenter-workspace]').evaluate((el) => /no suitable car/i.test(el.innerText)), { timeout: 120000, what: 'Greg demand figures' });
    await page.getByRole('heading', { name: /no suitable car|blocking|gate/i }).first().scrollIntoViewIfNeeded().catch(() => {});
    const text = await visibleText('[data-presenter-workspace]');
    const seatsRow = text.split('\n').filter((l) => /seat/i.test(l));
    const unmetBlock = text.slice(Math.max(0, text.search(/no suitable car/i) - 50), Math.max(0, text.search(/no suitable car/i)) + 900);
    report.greg = { seatsRow, unmetBlock, text };
    row.detail = { seatsRow };
    await page.locator('[data-presenter-workspace]').getByText(/no suitable car/i).first().evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -60); });
    return { state: `Seats row: ${JSON.stringify(seatsRow)}`, shotName: 'greg-demand', full: false, pass: seatsRow.length > 0 };
  });
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots,
    keyboardChecks: report.keyboard.length, keyboardPassed: report.keyboard.filter((k) => k.pass).length };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, runIds: report.runIds, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
