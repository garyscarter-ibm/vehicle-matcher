// FUCQ-172 presenter strip walkthrough: scenario catalogue, reset, start-state refusal and synthetic faults.
// One viewport per run (FUCQ172_CHUNK=desktop|narrow). Spawns `node index.js` in server/ as Render does (GCSP_RUNTIME=1, memory) on 127.0.0.1, port 8950-8959. Nothing is stubbed.
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
const chunk = process.env.FUCQ172_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ172_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ172_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ172_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const stockMode = 'default'; const suffix = '';
const resultsFile = join(HERE, `results-${chunk}${suffix}.json`);
const profile = join(scratch, 'browser', `chrome-${chunk}${suffix}`);
const preload = join(scratch, 'loopback-listen.cjs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { chunk, entry: 'hosted', viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), runIds: {}, steps: [], keyboard: [],
  readbacks: {}, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
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
  const port = Number(process.env.FUCQ172_PORT) || await freePort();
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

// ---- Presenter strip helpers ----
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
  await until(async () => (await page.locator('[role=radiogroup][aria-label="Scenario"] [role=radio]').count()) > 0 && (await strip().locator('h3', { hasText: 'Synthetic faults' }).count()) > 0, { timeout: 60000, what: 'catalogue and faults' });
  return ok;
}
async function chooseRadio(groupLabel, target) {
  const scope = `[role=radiogroup][aria-label="${groupLabel}"]`;
  const radios = page.locator(`${scope} [role=radio]`);
  await radios.first().waitFor({ timeout: 30000 });
  const checked = page.locator(`${scope} [role=radio][aria-checked=true]`);
  const current = async () => (await checked.first().innerText().catch(() => '')).trim();
  await tabTo((await checked.count()) ? checked : radios.first());
  const total = await radios.count();
  for (let i = 0; i <= total && !(await current()).startsWith(target); i += 1) await page.keyboard.press('ArrowDown');
  const now = await current(); const ok = now.startsWith(target);
  kb('presenter', `arrow keys choose "${target}" in "${groupLabel}"`, ok, clip(now, 80));
  if (!ok) throw new Error(`Arrow keys did not reach ${target}`);
  return clip(now, 200);
}
const checkedText = (groupLabel) => page.locator(`[role=radiogroup][aria-label="${groupLabel}"] [role=radio][aria-checked=true]`).first().innerText().then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => null);
const statuses = () => strip().evaluate((el) => [...el.querySelectorAll('[role=status]')].map((n) => n.innerText.trim()).filter(Boolean));
const resultsText = () => strip().evaluate((el) => el.querySelector('.gcsp-presenter-results')?.innerText.replace(/\n+/g, ' | ') ?? '');
const availabilityText = () => page.locator('[id^="presenter-availability-"]').first().innerText();
const button = (name) => page.getByRole('button', { name, exact: true });
async function reload() { await page.waitForLoadState('load'); }
// Press a strip button by keyboard (Enter) and wait for the action to settle.
async function press(name, { exact = true } = {}) {
  const b = exact ? button(name) : page.getByRole('button', { name });
  await until(async () => !(await b.isDisabled()), { timeout: 60000, what: `${name} enabled` });
  await tabTo(b); await page.keyboard.press('Enter');
  kb('presenter', `Enter on "${String(name)}"`, true);
  await wait(1200);
  await until(async () => !/Action in progress/.test((await statuses()).join(' ')), { timeout: 240000, what: `${name} to settle` });
  await until(async () => !(await statuses()).some((m) => /Loading readback/.test(m)), { timeout: 60000, what: 'readback to settle' }).catch(() => {});
}

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

  const other = 'Decline then change, no second car yet';
  await step('catalogue', 'Open the presenter page and Presenter controls; the Scenario picker lists the whole catalogue', async (row) => {
    await page.goto(`${app.origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
    const input = page.locator('#key');
    await input.waitFor({ timeout: 30000 });
    await tabTo(input); await page.keyboard.type(ACCESS_KEY);
    const typed = (await input.inputValue()).length === ACCESS_KEY.length;
    await page.keyboard.press('Enter');
    await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
    kb('access', 'Tab reaches the demo key field; typing the key and Enter opens the demo', typed);
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    const ok = await openStrip();
    report.runIds.first = runOf(await stripText());
    const options = await page.locator('[role=radiogroup][aria-label="Scenario"] [role=radio]').evaluateAll((nodes) => nodes.map((n) => ({
      text: n.innerText.replace(/\n+/g, ' | '), checked: n.getAttribute('aria-checked') === 'true', disabled: n.disabled || n.getAttribute('aria-disabled') === 'true' })));
    report.readbacks.catalogue = options; row.detail = { run: report.runIds.first, options, readback: clip((await stripText()).split('Tick')[0], 300) };
    return { pass: typed && ok && options.length >= 7, state: options.map((o) => o.text).join(' ;; '), shotName: 'catalogue' };
  }, { critical: true });

  await step('offer-expires', 'Arrow to "Offer expires": availability reads Not available yet and Reset scenario is disabled', async (row) => {
    const chosen = await chooseRadio('Scenario', 'Offer expires');
    const availability = await availabilityText(); const disabled = await button('Reset scenario').isDisabled();
    const radioEnabled = await page.locator('[role=radiogroup][aria-label="Scenario"] [role=radio][aria-checked=true]').first().isEnabled();
    kb('presenter', 'Reset scenario is disabled for the unavailable "Offer expires"', disabled);
    row.detail = { chosen, availability, resetDisabled: disabled, radioStillEnabled: radioEnabled };
    report.readbacks.offerExpires = availability;
    return { pass: /Not available yet/.test(availability) && disabled && radioEnabled, state: `${availability} | Reset disabled: ${disabled}`, shotName: 'offer-expires' };
  }, { critical: true });

  await step('reset-other', `Choose "${other}", Reset scenario, Cancel reset, then Reset and Confirm reset; readback after the reload`, async (row) => {
    await chooseRadio('Scenario', other);
    const resetBtn = button('Reset scenario');
    await tabTo(resetBtn); await page.keyboard.press('Enter');
    const confirmText = await page.locator('.gcsp-presenter-confirmation').innerText();
    await button('Confirm reset').waitFor({ timeout: 10000 });
    kb('presenter', 'Enter on "Reset scenario" opens the confirmation with focus on Confirm reset', await isFocused(button('Confirm reset')), confirmText);
    await tabTo(button('Cancel reset')); await page.keyboard.press('Enter');
    const back = await isFocused(resetBtn); const hidden = await page.locator('.gcsp-presenter-confirmation').isHidden();
    kb('presenter', 'Cancel reset closes the confirmation and focus returns to Reset scenario', back && hidden);
    const stillRun = runOf(await stripText());
    await page.keyboard.press('Enter');
    await button('Confirm reset').waitFor({ timeout: 10000 });
    await page.keyboard.press('Enter');
    kb('presenter', 'Enter on "Reset scenario" then "Confirm reset" resets the run', true);
    await until(async () => { const t = await stripText().catch(() => ''); return !/Action in progress/.test(t) && runOf(t) && runOf(t) !== stillRun ? t : null; }, { timeout: 180000, what: 'new run after reset' }).catch(() => {});
    await reload(); await wait(1500);
    await openStrip();
    const after = await stripText();
    const readback = { scenario: scenarioOf(after), run: runOf(after), clock: clockOf(after), acting: actingOf(after) };
    // Open the collapsed Step results by keyboard so the ordered start tick is on screen.
    const details = strip().locator('.gcsp-presenter-receipts > summary');
    let steps = [];
    if (await details.count()) { await tabTo(details); await page.keyboard.press('Enter'); steps = await strip().locator('.gcsp-presenter-handlers li').allInnerTexts(); }
    const last = await resultsText();
    report.runIds.afterOther = readback.run;
    report.readbacks.resetOther = { ...readback, lastTick: last, steps, cancelFocusReturned: back, unchangedRunAfterCancel: stillRun === report.runIds.first };
    row.detail = report.readbacks.resetOther;
    return { pass: readback.scenario === other && readback.run && readback.run !== report.runIds.first && back && stillRun === report.runIds.first, state: `${JSON.stringify(readback)} | ${last}`, shotName: 'reset-other' };
  }, { critical: true });

  await step('reset-data-unavailable', 'Choose "Data unavailable", Reset scenario and Confirm reset', async (row) => {
    await chooseRadio('Scenario', 'Data unavailable');
    await press('Reset scenario'); await button('Confirm reset').waitFor({ timeout: 10000 });
    await page.keyboard.press('Enter'); kb('presenter', 'Enter on "Confirm reset" resets into Data unavailable', true);
    await wait(2000); await reload(); await wait(1500);
    await until(async () => { const t = await stripText().catch(() => ''); return !/Action in progress/.test(t) && (await statuses().catch(() => [])).join(' ') !== 'Action in progress' ? true : null; }, { timeout: 180000, what: 'reset to settle' });
    await wait(2000); await reload();
    await openStrip();
    const after = await stripText();
    const readback = { scenario: scenarioOf(after), run: runOf(after), clock: clockOf(after), acting: actingOf(after), lastTick: await resultsText() };
    report.runIds.dataUnavailable = readback.run; report.readbacks.resetDataUnavailable = readback; row.detail = readback;
    return { pass: readback.scenario === 'Data unavailable' && readback.run !== report.runIds.afterOther, state: JSON.stringify(readback), shotName: 'reset-data-unavailable' };
  }, { critical: true });

  await step('release-refused', 'Next release with the stock feed unavailable: record the refused/interrupted message and whether the strip stays usable', async (row) => {
    const cue = await page.locator('[id^="presenter-release-"]').first().innerText();
    await press('Next release');
    await until(async () => !(await statuses()).some((m) => /Loading readback/.test(m)), { timeout: 60000, what: 'readback to settle' });
    const msgs = await statuses(); const last = await resultsText();
    const usable = async () => ({ setStockDisabled: await button('Set stock feed fault').isDisabled(), faultRadiosDisabled: await page.locator('[role=radiogroup][aria-label="Stock feed fault"] [role=radio]').first().isDisabled(),
      retryVisible: await button('Retry original action').isVisible(), resetDisabled: await button('Reset scenario').isDisabled() });
    const afterRefusal = await usable();
    await tabTo(button('Refresh readback')); await page.keyboard.press('Enter'); await wait(1200);
    await until(async () => !(await statuses()).some((m) => /Loading readback|Action in progress/.test(m)), { timeout: 60000, what: 'refresh to settle' }).catch(() => {});
    const afterRefresh = await usable();
    kb('presenter', 'After the refused tick, Refresh readback returns the fault controls to use', !afterRefresh.setStockDisabled && !afterRefresh.faultRadiosDisabled, { afterRefusal, afterRefresh });
    report.readbacks.releaseRefused = { cue, messages: msgs, lastTick: last, afterRefusal, afterRefresh }; row.detail = report.readbacks.releaseRefused;
    if (afterRefresh.setStockDisabled) report.notes.push('DEFECT: after the refused (retryable) Next release the strip stays in its uncertain state; Stock feed fault picker and Set stock feed fault stay disabled after Refresh readback, only Retry original action (same refusal) or a page reload frees them.');
    return { pass: /Stock source is unavailable/.test(msgs.join(' ')), state: `${msgs.join(' || ')} | ${last}`, shotName: 'release-refused' };
  }, { critical: true });

  await step('fault-cleared', 'Synthetic faults: stock fault reads "Stock feed unavailable"; choose No fault and Set stock feed fault', async (row) => {
    let reloaded = false;
    await until(async () => !(await button('Set stock feed fault').isDisabled()), { timeout: 30000, what: 'Set stock feed fault enabled' }).catch(() => {});
    if (await button('Set stock feed fault').isDisabled()) { await page.reload({ waitUntil: 'load' }); await wait(1500); await openStrip(); reloaded = true; }
    const mode = await checkedText('Stock feed fault'); const orderingMode = await checkedText('Ordering fault');
    await chooseRadio('Stock feed fault', 'No fault');
    await press('Set stock feed fault');
    await until(async () => !(await statuses()).some((m) => /Loading readback/.test(m)), { timeout: 60000, what: 'readback to settle' });
    const msgs = await statuses(); const now = await checkedText('Stock feed fault');
    report.readbacks.faultCleared = { workaroundPageReload: reloaded, stockModeBefore: mode, orderingModeBefore: orderingMode, messages: msgs, stockModeAfter: now }; row.detail = report.readbacks.faultCleared;
    return { pass: /Stock feed unavailable/.test(mode || '') && msgs.some((m) => /Stock feed fault cleared/.test(m)) && /^No fault/.test(now || ''), state: JSON.stringify(report.readbacks.faultCleared), shotName: 'fault-cleared' };
  }, { critical: true });

  await step('after-clear-tick', 'After clearing the fault, Retry original action (the refused Next release); record the last tick and cars released', async (row) => {
    // The refused release keeps its retry, and Tick stays disabled until it resolves.
    const tickDisabledBefore = await page.getByRole('button', { name: /^Tick \(/ }).isDisabled();
    await press('Retry original action');
    const msgs = await statuses(); const last = await resultsText(); const retryHidden = !(await button('Retry original action').isVisible());
    report.readbacks.afterClearTick = { tickDisabledBefore, retryHidden, messages: msgs, lastTick: last, clock: clockOf(await stripText()) }; row.detail = report.readbacks.afterClearTick;
    return { pass: tickDisabledBefore && retryHidden && /Tick completed/.test(last), state: `${msgs.join(' || ')} | ${last}`, shotName: 'after-clear-tick' };
  }, { critical: true });

  await step('ordering-fault', 'Set the ordering fault to "Next handoff times out, provider accepted" and back to No fault', async (row) => {
    await chooseRadio('Ordering fault', 'Next handoff times out, provider accepted');
    await press('Set ordering fault');
    const setMsgs = await statuses(); const setMode = await checkedText('Ordering fault');
    row.screenshots.push(await shot('ordering-fault-set'));
    await chooseRadio('Ordering fault', 'No fault');
    await press('Set ordering fault');
    const clearMsgs = await statuses(); const clearMode = await checkedText('Ordering fault');
    report.readbacks.orderingFault = { setMessages: setMsgs, setMode, clearMessages: clearMsgs, clearMode }; row.detail = report.readbacks.orderingFault;
    return { pass: setMsgs.some((m) => /Ordering fault set: Next handoff times out, provider accepted/.test(m)) && clearMsgs.some((m) => /Ordering fault cleared/.test(m)), state: JSON.stringify(report.readbacks.orderingFault), shotName: 'ordering-fault' };
  });
}

// Known noise: 404 draft and favicon. The 503 on the tick route is the expected refused release (stock fault set).
const KNOWN = (u) => /\/api\/gcsp\/manual\/draft$|\/favicon\.ico$/.test(u);
const EXPECTED = (u) => /\/api\/gcsp\/presenter\/controls\/tick$/.test(u);
try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  for (const list of [report.consoleErrors, report.badResponses]) for (const row of list) { row.known = KNOWN(row.url); row.expectedRefusal = row.step === 'release-refused' && EXPECTED(row.url); }
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots,
    keyboardChecks: report.keyboard.length, keyboardPassed: report.keyboard.filter((k) => k.pass).length };
  report.errors = { consoleUnknown: report.consoleErrors.filter((r) => !r.known && !r.expectedRefusal).length, badResponsesUnknown: report.badResponses.filter((r) => !r.known && !r.expectedRefusal).length,
    pageErrors: report.pageErrors.length, failedRequests: report.failedRequests.length };
  report.overflow = { horizontal: report.steps.some((s) => s.overflowPx > 2), maxPx: Math.max(0, ...report.steps.map((s) => s.overflowPx || 0)) };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, runIds: report.runIds, errors: report.errors, overflow: report.overflow, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
