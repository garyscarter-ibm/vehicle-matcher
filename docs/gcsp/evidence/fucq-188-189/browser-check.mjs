// FUCQ-188/189 check, derived from the FUCQ-183 walkthrough: counts Check current state and measures the question legend.
// One run per FUCQ183_CHUNK (desktop|narrow), FUCQ183_REASON and FUCQ_TAG. Ports 8990-8999; stops after the saved change.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const chunk = process.env.FUCQ183_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ183_CHUNK=desktop|narrow');
const REASON = process.env.FUCQ183_REASON;
// Default "Decline then change"; FUCQ183_SCENARIO="Main successful journey" runs the main journey (after FUCQ-109).
const SCENARIO = process.env.FUCQ183_SCENARIO || 'Decline then change';
const ANSWERS = { Size: 'slider to 70', 'Fuel type': 'Electric', Equipment: 'towbar', 'Body style': 'Saloon' };
if (!ANSWERS[REASON]) throw new Error('Set FUCQ183_REASON to Size, Fuel type, Equipment or Body style');
const slug = `${process.env.FUCQ_TAG || 'check'}-${SCENARIO === 'Decline then change' ? '' : `${SCENARIO.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`}${REASON.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const scratch = resolve(process.env.FUCQ183_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ183_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const shotDir = join(HERE, 'browser');
const resultsFile = join(HERE, `results-${chunk}-${slug}.json`);
const profile = join(scratch, `chrome-${chunk}-${slug}`);
const certDir = join(scratch, `cert-${chunk}-${slug}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { chunk, reason: REASON, scenario: SCENARIO, entry: 'https 127.0.0.1 memory runtime', viewport, state: 'incomplete', startedAt: new Date().toISOString(),
  runIds: {}, steps: [], followup: {}, consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let context; let page; let app; let halted = null;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
const killChrome = () => { try { spawnSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome(); report.state = 'timeout'; process.exit(124); });
process.on('exit', killChrome);

async function until(fn, { timeout = 120000, every = 500, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const last = await fn(); if (last) return last; } catch { /* retry */ } await wait(every); }
  throw new Error(`Timed out waiting for ${what}`);
}
const clip = (text, n = 420) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const bare = (url) => String(url).replace(/[?#].*$/, '');

// Key-state screenshots only: reason chosen, question, answered, after confirm, next state.
async function shot(name, full = true) {
  shots += 1;
  const file = `${vp}-${slug}-${String(shots).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(shotDir, file), fullPage: full });
  return `browser/${file}`;
}

// A step records pass/fail and observed text; a failed critical step blocks the rest. Page overflow above 2px fails it.
async function step(id, name, run, { critical = false } = {}) {
  const row = { id, name, pass: false, screenshots: [] };
  report.steps.push(row);
  if (halted) { row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    row.overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)).catch(() => null);
    row.pass = out.pass !== false && !(row.overflowPx > 2); row.state = clip(out.state, out.stateLimit ?? 420);
    if (out.detail !== undefined) row.detail = out.detail;
    if (out.shotName) row.screenshots.push(await shot(out.shotName, out.full !== false));
  } catch (error) {
    row.error = clip(error.message, 300);
    try { row.screenshots.push(await shot(`${id}-failed`)); } catch { /* page gone */ }
    if (critical) halted = id;
  }
  await save();
}

const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement).catch(() => false);
async function tabTo(locator, { max = 200 } = {}) {
  await locator.first().waitFor({ state: 'attached', timeout: 30000 });
  for (let count = 0; count <= max; count += 1) {
    if (await isFocused(locator.first())) return count;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
}

// ---- Host: the hosted composition (access gate, one origin) over HTTPS on 127.0.0.1 ----
async function freePort() {
  for (let port = 8990; port <= 8999; port += 1) {
    const probe = createNetServer();
    const ok = await new Promise((done) => { probe.once('error', () => done(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => done(true))); });
    if (ok) return port;
  }
  throw new Error('No free port in 8990-8999');
}
async function startHost() {
  await mkdir(certDir, { recursive: true });
  const key = join(certDir, 'key.pem'); const cert = join(certDir, 'cert.pem');
  const made = spawnSync('/opt/homebrew/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  if (made.status !== 0) throw new Error('Could not create the throwaway certificate');
  process.env.DEMO_ACCESS_KEY = ACCESS_KEY;
  const { buildServer } = await import(join(ROOT, 'server/index.js'));
  const { createGcspRuntime } = await import(join(ROOT, 'server/gcsp/runtime.js'));
  const { createGcspFront, gcspRuntimeOptions } = await import(join(ROOT, 'server/gcsp/host.js'));
  const port = Number(process.env.FUCQ183_PORT) || await freePort();
  if (port < 8990 || port > 8999) throw new Error('Port must be in 8990-8999');
  const origin = `https://127.0.0.1:${port}`;
  const options = gcspRuntimeOptions({ env: { GCSP_REPOSITORY_MODE: 'memory' }, defaultMode: 'memory', defaultEnvironmentId: 'gcsp-hosted-demo', commandId: 'hosted-bootstrap' });
  const opened = await createGcspRuntime(options.runtime);
  if (opened.status !== 'ok') throw new Error(`Runtime did not open: ${opened.status}`);
  const services = opened.value;
  const api = buildServer({ ...services.dependencies, gcspAllowedOrigins: [origin] });
  const startup = await api.gcspStartup;
  if (startup?.status !== 'ok') throw new Error(`Startup: ${startup?.status}`);
  const front = createGcspFront({ root: ROOT, services, api, origin, accessKey: ACCESS_KEY, accessGate: true, fallThrough: true });
  const server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert), minVersion: 'TLSv1.2' }, front);
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  report.origin = origin;
  const stop = async () => {
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    api.closeAllConnections?.(); await services.close();
  };
  return { origin, stop };
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
async function openStripByKeyboard() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 60000 });
  if (!(await root.evaluate((el) => el.open))) { await tabTo(root.locator('summary')); await page.keyboard.press('Enter'); }
  const ok = await root.evaluate((el) => el.open);
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 60000 });
  return ok;
}
// Arrow keys move a radio group's selection until the checked option's text starts with the target.
async function chooseRadio(groupLabel, target, scope = `[role=radiogroup][aria-label="${groupLabel}"]`) {
  const radios = page.locator(`${scope} [role=radio]`);
  await radios.first().waitFor({ timeout: 30000 });
  const checked = page.locator(`${scope} [role=radio][aria-checked=true]`);
  const current = async () => (await checked.first().innerText().catch(() => '')).trim();
  if (!(await checked.count())) { await tabTo(radios.first()); } else { await tabTo(checked); }
  const total = await radios.count();
  for (let i = 0; i <= total && !(await current()).startsWith(target); i += 1) await page.keyboard.press('ArrowDown');
  const now = await current();
  if (!now.startsWith(target)) throw new Error(`Arrow keys did not reach ${target}`);
  return now;
}
async function nextRelease(row) {
  await openStrip();
  const before = clockOf(await stripText());
  await page.getByRole('button', { name: 'Next release' }).click({ timeout: 240000, noWaitAfter: true });
  const text = await until(async () => {
    const now = await stripText();
    return clockOf(now) !== before && !/Action in progress/.test(now) && /Presenter controls ready|Last tick/.test(now) ? now : null;
  }, { timeout: 240000, what: 'release to finish' });
  row.detail = { clockBefore: before, clockAfter: clockOf(text), carsReleased: Number(/(\d+) cars released/.exec(text)?.[1] ?? NaN) || null };
  return { state: `Clock ${before} to ${clockOf(text)}` };
}

async function goto(path, ready) {
  await page.goto(`${app.origin}${path}`, { waitUntil: 'load', timeout: 120000 });
  if (ready) await ready();
}
const visibleText = (selector) => page.locator(selector).first().evaluate((el) => el.innerText);
const offerText = () => visibleText('gcsp-offer');
const FOLLOWUP = 'gcsp-offer .gcsp-followup';

async function enterAccessKey(row) {
  await page.goto(`${app.origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
  const input = page.locator('#key');
  await input.waitFor({ timeout: 30000 });
  await tabTo(input); await page.keyboard.type(ACCESS_KEY);
  const typed = (await input.inputValue()).length === ACCESS_KEY.length;
  await page.keyboard.press('Enter');
  await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
  return typed;
}

async function openFirstOffer() {
  await goto('/gcsp-outbox.html', () => until(() => page.locator('gcsp-outbox').evaluate((el) => /captured email/.test(el.innerText) && !/Loading captured/.test(el.innerText)), { timeout: 90000, what: 'outbox to load' }));
  const rows = page.locator('gcsp-outbox button').filter({ hasText: 'Your vehicle offer' });
  const count = await rows.count();
  await tabTo(rows.nth(0)); await page.keyboard.press('Enter');
  const link = page.getByRole('link', { name: /Open the offer/ });
  await link.waitFor({ timeout: 30000 });
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 30000 }), (async () => { await tabTo(link); await page.keyboard.press('Enter'); })()]);
  const old = page; page = popup; await old.close();
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: /Accept this offer/ }).waitFor({ timeout: 180000 });
  return count;
}

// Visible Check current state buttons in the offer, and the legend's box against its fieldset border.
const measure = () => page.evaluate(() => {
  const offer = document.querySelector('gcsp-offer');
  const refreshes = [...offer.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Check current state' && b.offsetParent).length;
  const field = offer.querySelector('.gcsp-followup-field'); const legend = field?.querySelector('legend');
  if (!legend) return { refreshes };
  const f = field.getBoundingClientRect(); const l = legend.getBoundingClientRect(); const border = parseFloat(getComputedStyle(field).borderTopWidth);
  return { refreshes, legend: { top: Math.round(l.top - f.top - border), left: Math.round(l.left - f.left), right: Math.round(f.right - l.right),
    overflowX: legend.scrollWidth > legend.clientWidth, crossesBorder: l.top < f.top + border, lines: Math.round(l.height / parseFloat(getComputedStyle(legend).lineHeight || 24)) } };
});
async function run() {
  await mkdir(shotDir, { recursive: true }); await mkdir(scratch, { recursive: true });
  app = await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport, ignoreHTTPSErrors: true });
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

  await step('access-key', 'The demo key form opens the demo, key typed by keyboard', async (row) => {
    const typed = await enterAccessKey(row);
    return { pass: typed, state: 'Demo key accepted' };
  }, { critical: true });
  let previousRun = null;
  await step('scenario-reset', `Presenter reset to "${SCENARIO}" by keyboard`, async (row) => {
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    await openStripByKeyboard();
    previousRun = runOf(await stripText());
    await chooseRadio('Scenario', SCENARIO);
    const reset = page.getByRole('button', { name: 'Reset scenario' });
    await until(async () => !(await reset.isDisabled()), { timeout: 60000, what: 'Reset scenario to enable' });
    await tabTo(reset); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Confirm reset' }).waitFor({ timeout: 10000 });
    await page.keyboard.press('Enter');
    const text = await until(async () => { const t = await stripText(); return !/Action in progress/.test(t) && runOf(t) && runOf(t) !== previousRun ? t : null; }, { timeout: 240000, what: 'new run after reset' })
      .catch(async () => { await openStrip(); return stripText(); });
    report.runIds = { previous: previousRun, new: runOf(text) };
    return { state: clip(text, 200), pass: Boolean(runOf(text)) && runOf(text) !== previousRun && text.includes(SCENARIO) };
  }, { critical: true });
  await step('switch-to-paula', 'Acting principal switched to Paula by keyboard', async () => {
    await page.waitForLoadState('load'); await strip().waitFor({ state: 'attached', timeout: 90000 }); await openStrip();
    await chooseRadio('Acting principal', 'Paula');
    await tabTo(page.getByRole('button', { name: 'Switch principal' })); await page.keyboard.press('Enter');
    await until(async () => strip().evaluate((el) => !el.open), { timeout: 90000, what: 'workspace to reload as Paula' });
    await openStrip();
    const text = await until(async () => { const t = await stripText(); return /Paula/.test(actingOf(t) || '') && !/Action in progress/.test(t) ? t : null; }, { timeout: 30000, what: 'Paula acting' });
    return { state: `Acting principal ${actingOf(text)}` };
  }, { critical: true });
  await step('presenter-first-release', 'Presenter Next release publishes the first stock release', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    await openStrip();
    await until(async () => /Presenter controls ready/.test(await stripText()), { what: 'strip to finish loading' });
    const text = await stripText();
    // This scenario's start state may already hold the first offer, so a release is optional.
    if (/Next release unavailable/.test(text)) return { state: `No release to publish: ${/Next release unavailable: ([^\n]+)/.exec(text)?.[1]}` };
    return nextRelease(row);
  }, { critical: true });
  await step('activity-offer', 'Paula\'s activity shows the first offer', async () => {
    await goto('/gcsp-activity-live.html');
    await until(() => page.locator('gcsp-activity').evaluate((el) => /Waiting for you/.test(el.innerText)), { timeout: 150000, what: 'offer on activity' });
    return { state: await visibleText('gcsp-activity') };
  }, { critical: true });
  await step('offer-first', 'First offer opens from the outbox link', async (row) => {
    const count = await openFirstOffer(); row.detail = { capturedEmails: count };
    return { state: await offerText(), pass: count === 1 };
  }, { critical: true });
  await step('offer-decline-reason', `Decline form opens and "${REASON}" is chosen by keyboard`, async (row) => {
    await tabTo(page.getByRole('button', { name: 'Decline this offer' })); await page.keyboard.press('Enter');
    const select = page.locator('select');
    await until(async () => (await select.locator('option').count()) > 1, { timeout: 90000, what: 'decline reasons' });
    row.detail = { reasons: await select.locator('option').evaluateAll((o) => o.map((x) => x.textContent.trim()).filter((t) => !/^Choose/.test(t))) };
    await tabTo(select); await page.keyboard.type(REASON);
    const chosen = await select.evaluate((el) => el.selectedOptions[0]?.textContent.trim());
    return { state: `Reason chosen: ${chosen}`, pass: chosen === REASON, shotName: 'decline-reason' };
  }, { critical: true });
  await step('followup-question', 'Confirm decline shows the follow-up question, not an unavailable message', async (row) => {
    await tabTo(page.getByRole('button', { name: 'Confirm decline' })); await page.keyboard.press('Enter');
    const questionBox = page.locator(`${FOLLOWUP} fieldset`);
    await until(async () => (await questionBox.count()) > 0 || /temporarily unavailable|try again/i.test(await offerText()), { timeout: 180000, what: 'follow-up question or error' });
    const text = await offerText();
    const unavailable = /temporarily unavailable/i.test(text);
    const note = (await page.locator(`${FOLLOWUP} .gcsp-note`).allInnerTexts()).map((t) => t.trim());
    const hasNote = note.some((t) => /Not in your brief yet\. Your answer adds it\./.test(t));
    const control = (await page.locator(`${FOLLOWUP} input[type=range]`).count()) ? 'slider' : (await page.locator(`${FOLLOWUP} textarea`).count()) ? 'textarea'
      : (await page.locator(`${FOLLOWUP} [role=radio]`).count()) ? 'options' : 'none';
    const sliderStart = control === 'slider' ? await page.locator(`${FOLLOWUP} input[type=range]`).first().inputValue() : null;
    const confirmDisabled = await page.getByRole('button', { name: 'Confirm this change' }).isDisabled().catch(() => null);
    const addsNew = REASON !== 'Body style';
    report.followup = { question: await questionBox.locator('legend').first().innerText().catch(() => null), control, sliderStart, notes: note, confirmDisabledAtStart: confirmDisabled,
      optionsChecked: await page.locator(`${FOLLOWUP} [role=radio][aria-checked=true]`).count() };
    report.followup.atQuestion = await measure(); row.detail = report.followup;
    await page.evaluate(() => document.querySelector('gcsp-offer .gcsp-followup')?.scrollIntoView({ block: 'start' }));
    const m = report.followup.atQuestion; const pass = m.refreshes === 1 && m.legend && !m.legend.crossesBorder && !m.legend.overflowX && !unavailable && control !== 'none' && (addsNew ? hasNote : !hasNote) && (control !== 'slider' || sliderStart === '50');
    return { state: `${unavailable ? 'UNAVAILABLE. ' : ''}Question: ${report.followup.question}. Note: ${note.join(' | ') || 'none'}. Control ${control}${sliderStart ? ` at ${sliderStart}` : ''}`, pass, shotName: 'followup-question', full: false };
  }, { critical: true });
  await step('followup-answered-confirmed', 'Answer by keyboard and confirm; the change is saved in a brief version', async (row) => {
    let answered;
    if (REASON === 'Size') {
      const slider = page.locator(`${FOLLOWUP} input[type=range]`).first();
      await tabTo(slider); for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowRight');
      answered = `slider ${await slider.inputValue()}`;
    } else if (REASON === 'Equipment') {
      const box = page.locator(`${FOLLOWUP} textarea`).first();
      await tabTo(box); await page.keyboard.type('towbar'); answered = `textarea "${await box.inputValue()}"`;
    } else { answered = await chooseRadio('Follow-up question', REASON === 'Fuel type' ? 'Electric' : 'Saloon', `${FOLLOWUP} [role=radiogroup]`); }
    const confirm = page.getByRole('button', { name: 'Confirm this change' });
    await until(async () => !(await confirm.isDisabled()), { timeout: 10000, what: 'confirm to enable' });
    await wait(1500); // let the enable transition settle before the capture
    row.screenshots.push(await shot('answered', false));
    await tabTo(confirm); await page.keyboard.press('Enter');
    const text = await until(async () => { const t = await offerText(); return /saved in brief version \d+|Change saved/.test(t) ? t : null; }, { timeout: 90000, what: 'change saved' });
    const saved = /saved in brief version \d+/.exec(text)?.[0] ?? null;
    const after = text.split('Your next offer').pop();
    report.followup.afterConfirm = await measure(); report.followup.answered = answered; report.followup.saved = saved; report.followup.nextStateOnOffer = clip(after, 500);
    await page.evaluate(() => document.querySelector('gcsp-offer .gcsp-followup')?.scrollIntoView({ block: 'start' }));
    await wait(1500); // let any fade settle before the capture
    return { state: `${answered}. ${saved}. Next: ${clip(after, 260)}`, pass: Boolean(saved) && report.followup.afterConfirm.refreshes === 1, shotName: 'after-confirm', full: false };
  }, { critical: true });
}

try { await run(); report.state = report.steps.every((s) => s.pass) && !report.badResponses.some((b) => b.status >= 500) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots,
    consoleErrors: report.consoleErrors.length, pageErrors: report.pageErrors.length, badResponses: report.badResponses.length,
    serverErrors503: report.badResponses.filter((b) => b.status === 503).length };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  await rm(certDir, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, runIds: report.runIds, followup: report.followup, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
