// FUCQ-129 walkthrough of "Offer expires": the offer runs out on a tick and the old email link reads expired.
// One viewport per run (FUCQ129_CHUNK=desktop|narrow). Spawns `node index.js` in server/ as Render does (GCSP_RUNTIME=1, memory) on 127.0.0.1, port 8950-8959. Nothing is stubbed.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../../server');
const chunk = process.env.FUCQ129_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ129_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ129_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ129_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const stockMode = 'default'; const suffix = '';
const resultsFile = join(HERE, `results-${chunk}${suffix}.json`);
const profile = join(scratch, 'browser', `chrome-${chunk}${suffix}`);
const preload = join(scratch, 'loopback-listen.cjs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { build: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: SERVER_DIR }).toString().trim(), chunk, entry: 'hosted', viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), runIds: {}, steps: [], keyboard: [],
  readbacks: {}, paula: {}, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let context; let page; let app; let child; let halted = null;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
const killChrome = () => { try { spawnSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch { /* already gone */ } };
const killServer = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome(); killServer(); report.state = 'timeout'; try { writeFileSync(resultsFile, `${JSON.stringify(report, null, 2)}\n`); } catch { /* best effort */ } process.exit(124); });
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
  const row = { id, name, pass: false, screenshots: [] }; const began = Date.now();
  report.steps.push(row);
  if (halted) { row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    row.overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)).catch(() => null);
    row.emDash = await page.evaluate(() => (document.body.innerText.match(/\u2014/g) || []).length).catch(() => 0);
    if (row.emDash) report.notes.push(`DEFECT: ${row.emDash} em dash(es) in on-screen text at step ${id}`);
    row.pass = out.pass !== false && !(row.overflowPx > 2) && !row.emDash; row.state = clip(out.state, 600); if (out.detail !== undefined) row.detail = out.detail;
    if (out.shotName) row.screenshots.push(await shot(out.shotName, out.full !== false));
  } catch (error) {
    row.error = clip(error.stack, 500);
    await page.screenshot({ path: join(scratch, `failed-${id}-${vp}.png`), fullPage: true }).catch(() => {});
    row.pageText = clip(await page.evaluate(() => document.body.innerText).catch(() => ''), 500);
    if (critical) halted = id;
  }
  row.seconds = Math.round((Date.now() - began) / 1000);
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

// ---- Hosted entry on 127.0.0.1, ports 8950-8959 only ----
async function freePort() {
  for (let port = 8950; port <= 8959; port += 1) {
    const probe = createServer();
    const ok = await new Promise((done) => { probe.once('error', () => done(false)); probe.listen(port, '127.0.0.1', () => done(true)); });
    if (ok) { await new Promise((done) => probe.close(done)); return port; }
  }
  throw new Error('No free port in 8950-8959');
}
async function startHost() {
  const port = Number(process.env.FUCQ129_PORT) || await freePort();
  if (port < 8950 || port > 8959) throw new Error('Port must be in 8950-8959');
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

// ---- Presenter strip, workspace and page helpers ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (text) => /DemoClock \(UTC\)\s+(\S+)/.exec(text)?.[1] ?? null;
const runOf = (text) => /\bRun\s+(\S+)/.exec(text)?.[1] ?? null;
const scenarioOf = (text) => /Scenario\s+(.+)/.exec(text)?.[1]?.trim() ?? null;
const actingOf = (text) => /Acting principal\s+(.+)/.exec(text)?.[1]?.trim() ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'visible', timeout: 90000 });
  if (!(await root.evaluate((el) => el.open))) { await tabTo(root.locator(':scope > summary')); await page.keyboard.press('Enter'); }
  const ok = await root.evaluate((el) => el.open);
  kb('presenter', 'Enter on "Presenter controls" opens the strip', ok);
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 90000 });
  await until(async () => (await page.locator('[role=radiogroup][aria-label="Scenario"] [role=radio]').count()) > 0, { timeout: 60000, what: 'catalogue' });
  return ok;
}
async function chooseRadio(groupLabel, target, pageName = 'presenter') {
  const scope = `[role=radiogroup][aria-label="${groupLabel}"]`;
  const radios = page.locator(`${scope} [role=radio]`);
  await radios.first().waitFor({ timeout: 30000 });
  const checked = page.locator(`${scope} [role=radio][aria-checked=true]`);
  const current = async () => (await checked.first().innerText().catch(() => '')).trim();
  await until(async () => (await checked.count()) > 0 && !(await radios.first().isDisabled()), { timeout: 30000, what: `${groupLabel} selection` }).catch(() => {});
  await tabTo((await checked.count()) ? checked : radios.first());
  const total = await radios.count();
  for (let i = 0; i <= total && !(await current()).startsWith(target); i += 1) await page.keyboard.press('ArrowDown');
  const now = await current(); const ok = now.startsWith(target);
  kb(pageName, `arrow keys choose "${target}" in "${groupLabel}"`, ok, clip(now, 80));
  if (!ok) throw new Error(`Arrow keys did not reach ${target}`);
  return clip(now, 200);
}
const statuses = () => strip().evaluate((el) => [...el.querySelectorAll('[role=status]')].map((n) => n.innerText.trim()).filter(Boolean));
const resultsText = () => strip().evaluate((el) => el.querySelector('.gcsp-presenter-results')?.innerText.replace(/\n+/g, ' | ') ?? '');
const button = (name) => page.getByRole('button', { name, exact: true });
const settled = () => until(async () => !/Action in progress/.test((await statuses()).join(' ')) && !(await statuses()).some((m) => /Loading readback/.test(m)), { timeout: 240000, what: 'strip to settle' });
async function goto(path, ready) {
  await page.goto(`${app.origin}${path}`, { waitUntil: 'load', timeout: 120000 });
  if (ready) await ready();
}
async function openPresenter() {
  await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
  await openStrip();
}
// Switch the acting principal with the keyboard; the confirmed switch reloads the workspace.
async function switchTo(name) {
  await openPresenter();
  const before = actingOf(await stripText());
  await chooseRadio('Acting principal', name);
  await tabTo(page.getByRole('button', { name: 'Switch principal' })); await page.keyboard.press('Enter');
  kb('presenter', `Enter on "Switch principal" switches to ${name}`, true);
  await until(async () => strip().evaluate((el) => !el.open), { timeout: 90000, what: `workspace to reload as ${name}` });
  await openStrip();
  const text = await until(async () => { const t = await stripText(); return (actingOf(t) || '').startsWith(name) && !/Action in progress/.test(t) ? t : null; }, { timeout: 30000, what: `${name} acting` });
  return { before, after: actingOf(text) };
}
async function readActivity() {
  await goto('/gcsp-activity-live.html');
  await until(() => page.locator('gcsp-activity').evaluate((el) => el.innerText.trim().length > 40 && !/Loading/.test(el.innerText)), { timeout: 120000, what: 'activity to load' });
  await wait(1500);
  return page.locator('gcsp-activity').first().evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim());
}
const offerText = () => page.locator('gcsp-offer').first().evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
// Open a link in the offer page and wait for it to leave its loading state.
async function openOffer(href) {
  await page.goto(new URL(href, app.origin).href, { waitUntil: 'load', timeout: 120000 });
  await until(async () => { const t = await offerText(); return t.length > 40 && !/Loading your offer|Please wait/.test(t) ? t : null; }, { timeout: 120000, what: 'offer page to settle' });
  await wait(1500);
  return offerText();
}
const decisionControls = () => page.locator('gcsp-offer').first().evaluate((el) => [...el.querySelectorAll('button, a[href], input, select')]
  .filter((n) => n.offsetParent !== null && /accept|decline|confirm/i.test(n.innerText || n.getAttribute('aria-label') || ''))
  .map((n) => ({ text: (n.innerText || n.getAttribute('aria-label') || '').trim().slice(0, 60), disabled: n.disabled || n.getAttribute('aria-disabled') === 'true' }))).catch(() => []);

// Press a strip button by keyboard (Enter) and wait for the action to settle.
async function press(name) {
  const b = typeof name === 'string' ? button(name) : page.getByRole('button', { name });
  await until(async () => !(await b.isDisabled()), { timeout: 60000, what: `${name} enabled` });
  await tabTo(b); await page.keyboard.press('Enter');
  kb('presenter', `Enter on "${String(name)}"`, true);
  await wait(1500);
  await settled();
}
// Reset into Offer expires by keyboard; reload and read back scenario, run and clock.
async function resetOfferExpires() {
  await openPresenter();
  const previous = runOf(await stripText());
  // Let the workspace behind the strip finish loading so it cannot take focus mid-step.
  await page.waitForLoadState('networkidle').catch(() => {}); await wait(2500);
  const chosen = await chooseRadio('Scenario', 'Offer expires');
  await press('Reset scenario'); await button('Confirm reset').waitFor({ timeout: 10000 });
  const onConfirm = await isFocused(button('Confirm reset'));
  kb('presenter', 'Reset scenario opens the confirmation with focus on Confirm reset', onConfirm);
  if (!onConfirm) { report.notes.push(`DEFECT: focus was not on Confirm reset after Reset scenario (${vp}px); focus was on ${await page.evaluate(() => document.activeElement?.tagName + ' ' + (document.activeElement?.innerText || '').slice(0, 40))}`); await tabTo(button('Confirm reset')); }
  await page.keyboard.press('Enter');
  kb('presenter', 'Enter on "Confirm reset" resets into Offer expires', true);
  await wait(2000);
  // The reset reloads the workspace, so poll the controls route for the new run instead of the strip text.
  await until(async () => page.evaluate(async (old) => { const r = await fetch('/api/gcsp/presenter/controls', { credentials: 'same-origin' }); const id = /"runId":"([^"]+)"/.exec(await r.text())?.[1]; return Boolean(id) && id !== old; }, previous), { timeout: 240000, every: 1000, what: 'new run after reset' });
  await page.reload({ waitUntil: 'load' }); await wait(1500);
  await openStrip(); await settled();
  const after = await stripText();
  return { chosen, previous, scenario: scenarioOf(after), run: runOf(after), clock: clockOf(after), acting: actingOf(after), lastTick: await resultsText() };
}
// Paula's captured email in the outbox viewer: select her row by keyboard, read the offer link.
async function readOutbox() {
  await goto('/gcsp-outbox.html');
  const rows = page.locator('.gcsp-mail-row');
  await rows.first().waitFor({ timeout: 90000 });
  const all = await rows.evaluateAll((nodes) => nodes.map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
  const mine = rows.filter({ hasText: 'Paula' }).first();
  await tabTo(mine); await page.keyboard.press('Enter');
  kb('outbox', 'Enter on the Paula row opens her captured email', true);
  const open = page.getByRole('link', { name: /Open the offer/ });
  await open.waitFor({ timeout: 30000 });
  const href = await open.getAttribute('href');
  const detail = await page.locator('.gcsp-presenter-body').first().evaluate((el) => el.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  const text = await page.locator('.gcsp-mail-text').first().innerText().catch(() => '');
  return { rows: all, href, detail: clip(detail, 500), text: clip(text, 600) };
}
const linkParts = (href) => { const u = new URL(href, app.origin); return { runId: u.searchParams.get('runId'), offerId: u.searchParams.get('offerId') }; };

async function run() {
  await mkdir(profile, { recursive: true }); await mkdir(scratch, { recursive: true });
  app = await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport });
  const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ text: clip(m.text(), 200), url: bare(m.location().url || p.url()), page: bare(p.url()), step: report.steps.at(-1)?.id }); });
    p.on('pageerror', (e) => report.pageErrors.push(clip(e.message, 200)));
    p.on('requestfailed', (r) => report.failedRequests.push({ url: bare(r.url()), error: r.failure()?.errorText, method: r.method(), step: report.steps.at(-1)?.id }));
    p.on('response', async (r) => {
      if (r.status() < 400) return;
      const body = r.status() === 404 ? undefined : clip(await r.text().catch(() => ''), 300);
      report.badResponses.push({ status: r.status(), url: bare(r.url()), method: r.request().method(), step: report.steps.at(-1)?.id, ...(body ? { body } : {}) });
    });
  };
  context.on('page', watch);
  page = await context.newPage();

  let href = null; let expiresAt = null; let firstLink = null;
  await step('reset', 'Open the presenter page with the key, open Presenter controls, choose Offer expires, Reset scenario and Confirm reset; read back scenario, run and clock', async (row) => {
    await page.goto(`${app.origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
    const input = page.locator('#key'); await input.waitFor({ timeout: 30000 });
    await tabTo(input); await page.keyboard.type(ACCESS_KEY);
    const typed = (await input.inputValue()).length === ACCESS_KEY.length;
    await page.keyboard.press('Enter');
    await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
    kb('access', 'Tab reaches the demo key field; typing the key and Enter opens the demo', typed);
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    await openStrip();
    const back = await resetOfferExpires();
    report.runIds.first = back.run; report.readbacks.reset = back; row.detail = back;
    return { pass: typed && back.scenario === 'Offer expires' && back.run && back.run !== back.previous && /09:30/.test(back.clock || ''), state: JSON.stringify(back), shotName: 'reset' };
  }, { critical: true });

  await step('paula-activity', 'Paula, Buddy activity: the offer and the time it is available until', async (row) => {
    row.detail = await switchTo('Paula');
    const text = await readActivity();
    report.paula.activityBefore = text;
    const until_ = /(?:until|by|before|expires?)[^.]{0,40}?(\d{1,2} \w{3} \d{4},? \d{1,2}:\d{2}(?: UTC)?)/i.exec(text)?.[1] ?? null;
    row.detail.availableUntil = until_; report.readbacks.availableUntil = until_;
    return { pass: /offer|available/i.test(text) && Boolean(until_), state: text, shotName: 'paula-activity' };
  }, { critical: true });

  await step('outbox', 'Presenter outbox viewer: Paula\'s captured email and its offer link', async (row) => {
    const mail = await readOutbox();
    href = mail.href; firstLink = href;
    const parts = href ? linkParts(href) : {};
    report.readbacks.outbox = { ...mail, ...parts }; row.detail = report.readbacks.outbox;
    // The exact deadline comes from the offer read, as Paula's page itself would.
    const read = await page.evaluate(async ({ offerId, runId }) => {
      const r = await fetch(`/api/gcsp/offers/${encodeURIComponent(offerId)}?runId=${encodeURIComponent(runId)}`, { credentials: 'same-origin' });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, parts).catch(() => null);
    expiresAt = read?.body?.value?.expiresAt ?? read?.body?.expiresAt ?? /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/.exec(mail.text)?.[0] ?? null;
    report.readbacks.expiresAt = expiresAt; row.detail.expiresAt = expiresAt; row.detail.offerReadStatus = read?.status;
    return { pass: Boolean(href && expiresAt && parts.runId === report.runIds.first), state: `${mail.rows.join(' ;; ')} | link ${href} | expiresAt ${expiresAt}`, shotName: 'outbox' };
  }, { critical: true });

  await step('tick-to-target', 'Presenter: type the expiresAt into Named time or UTC target and press Tick to target; read the buddy-expiry step', async (row) => {
    await openPresenter();
    const field = page.getByLabel('Named time or UTC target');
    await tabTo(field); await page.keyboard.type(expiresAt);
    kb('presenter', 'Typing the expiresAt in "Named time or UTC target"', (await field.inputValue()) === expiresAt);
    await press('Tick to target');
    const details = strip().locator('.gcsp-presenter-receipts > summary');
    let handlers = [];
    if (await details.count()) { await tabTo(details); await page.keyboard.press('Enter'); handlers = await strip().locator('.gcsp-presenter-handlers li').allInnerTexts(); }
    const last = await resultsText(); const clock = clockOf(await stripText());
    const expiry = handlers.find((h) => /buddy.expiry/i.test(h)) ?? null;
    report.readbacks.tick = { clock, lastTick: last, handlers, expiry, statuses: await statuses() }; row.detail = report.readbacks.tick;
    return { pass: Boolean(expiry) && /11:30/.test(clock || ''), state: `${clock} | ${last} | ${handlers.join(' ;; ')}`, shotName: 'tick-to-target' };
  }, { critical: true });

  await step('expired-page', 'Paula opens the captured-email link: the page reads expired from the backend, no usable accept or decline', async (row) => {
    await switchTo('Paula');
    const text = await openOffer(href);
    const controls = await decisionControls();
    const usable = controls.filter((c) => !c.disabled);
    if (/Eligible/.test(text)) report.notes.push('DEFECT (Low): the expired offer page still shows the car with "Eligible" and "Why it suits you", as if the car were still on offer.');
    report.paula.expired = text; row.detail = { controls, url: bare(page.url()) };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { pass: /Offer expired/.test(text) && usable.length === 0, state: text, shotName: 'expired-page' };
  }, { critical: true });

  await step('no-revival', 'Reload, presenter Tick once, reload again: still expired', async (row) => {
    await page.reload({ waitUntil: 'load' });
    await until(async () => { const t = await offerText(); return t.length > 40 && !/Loading your offer/.test(t) ? t : null; }, { timeout: 120000, what: 'reload to settle' });
    const one = await offerText();
    await openPresenter(); const before = clockOf(await stripText());
    await press(/^Tick \(/);
    const after = clockOf(await stripText()); const last = await resultsText();
    const text = await openOffer(href);
    const usable = (await decisionControls()).filter((c) => !c.disabled);
    report.paula.afterReload = one; report.paula.afterTick = text; row.detail = { reloadText: clip(one, 300), clockBefore: before, clockAfter: after, lastTick: last };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { pass: /Offer expired/.test(one) && /Offer expired/.test(text) && usable.length === 0 && before !== after, state: text, shotName: 'no-revival' };
  }, { critical: true });

  await step('alex-activity', 'Alex, Buddy activity: record what it shows (the known reallocation gap)', async (row) => {
    row.detail = await switchTo('Alex');
    const text = await readActivity();
    report.readbacks.alexActivity = text;
    const offered = /View offer|Waiting for you|Respond by/i.test(text);
    row.detail.offeredCar = offered;
    report.notes.push(offered ? 'Alex is shown an offer after the expiry.' : 'Known gap (not a defect of this run): Alex sees no offer for the expired car; allocation has no expiry trigger.');
    return { state: text, shotName: 'alex-activity' };
  });

  await step('stale-link', 'Reset into Offer expires again and open the first run\'s email link: stale-run refusal', async (row) => {
    const back = await resetOfferExpires();
    report.runIds.second = back.run;
    await switchTo('Paula');
    const text = await openOffer(firstLink);
    const usable = (await decisionControls()).filter((c) => !c.disabled);
    if (/Open the original email link/.test(text)) report.notes.push('DEFECT (Low): the stale-run page tells the reader to "Open the original email link" when that is the link just opened.');
    report.paula.staleLink = text; row.detail = { reset: back, staleUrl: bare(firstLink) };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { pass: back.run !== report.runIds.first && /earlier demo run|restarted|no longer/i.test(text) && !/Your car offer/.test(text) && usable.length === 0, state: text, shotName: 'stale-link' };
  });
}

// Known noise: 404 draft and favicon.
const KNOWN = (u) => /\/api\/gcsp\/manual\/draft$|\/favicon\.ico$/.test(u);
// A 409 is the stale-run refusal: the old run's reads after a reset, and the first run's link.
const EXPECTED = (r) => ['reset', 'stale-link'].includes(r.step) && (r.status === 409 || /\b409\b/.test(r.text || ''));
try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  for (const list of [report.consoleErrors, report.badResponses]) for (const row of list) { row.known = KNOWN(row.url); row.expectedRefusal = EXPECTED(row); }
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots,
    keyboardChecks: report.keyboard.length, keyboardPassed: report.keyboard.filter((k) => k.pass).length };
  report.errors = { consoleUnknown: report.consoleErrors.filter((r) => !r.known && !r.expectedRefusal).length, badResponsesUnknown: report.badResponses.filter((r) => !r.known && !r.expectedRefusal).length,
    pageErrors: report.pageErrors.length, failedRequests: report.failedRequests.length, abortedByNavigation: report.failedRequests.filter((r) => r.error === 'net::ERR_ABORTED').length };
  report.overflow = { horizontal: report.steps.some((s) => s.overflowPx > 2), maxPx: Math.max(0, ...report.steps.map((s) => s.overflowPx || 0)) };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, runIds: report.runIds, errors: report.errors, overflow: report.overflow, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
