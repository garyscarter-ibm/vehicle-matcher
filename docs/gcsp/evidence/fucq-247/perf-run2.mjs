// FUCQ-247 run 2: Greg's dashboard, order progress, the outbox and the stock pull behind the gallery, on a local offline host.
// Helpers are copied from perf-run1.mjs. PERF_PROFILE=desktop|phone PERF_RUN=n PERF_PORT=9280-9289 PERF_SCRATCH=<owned dir>.
// `node perf-run2.mjs summarise` folds results2-*.json into summary-run2.json. Server figures come from server-probe-run2.mjs.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const PROBE = join(HERE, 'server-probe-run2.mjs');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const MIB = 1024 * 1024;

if (process.argv[2] === 'summarise') { await summarise(); process.exit(0); }

const profileName = process.env.PERF_PROFILE || 'desktop';
const runNo = Number(process.env.PERF_RUN || 1);
const port = Number(process.env.PERF_PORT || 9280);
if (port < 9280 || port > 9289) throw new Error('PERF_PORT must be 9280-9289');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!process.env.PERF_SCRATCH || !scratch.includes('review-247')) throw new Error('Set PERF_SCRATCH to the owned review-247 run folder');
const PHONE = profileName === 'phone';
// Phone: 4x CPU slowdown and Lighthouse's classic mobile network (150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up).
const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const viewport = PHONE ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const origin = `http://127.0.0.1:${port}`;
const tag = `${profileName}-${runNo}`;
const profileDir = join(scratch, `chrome-${tag}`);
const probeOut = join(scratch, `probe-${tag}.jsonl`);
const resultsFile = join(HERE, process.env.PERF_STARTUP_ONLY ? `startup-${runNo}.json` : `results2-${tag}.json`);
const pidFile = join(scratch, 'pids.txt');
const ACCESS_KEY = `perf-${randomBytes(9).toString('hex')}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import('/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');

const report = { story: 'FUCQ-247', run: 2, profile: profileName, runNo, where: 'local, macOS, offline memory host (GCSP_OFFLINE=1, GCSP_REPOSITORY_MODE=memory)',
  node: process.version, viewport, throttling: PHONE ? { cpuSlowdown: 4, network: { rttMs: 150, downKbps: 1600, upKbps: 750 } } : null,
  startedAt: new Date().toISOString(), state: 'incomplete', server: {}, steps: [], errors: [], badResponses: [] };
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 1)}\n`);
let child; let context; let page; let cdp;
const requests = []; const pending = [];

const killChrome = () => { try {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of ps.split('\n')) if (line.includes(`--user-data-dir=${profileDir}`)) { try { process.kill(Number(line.trim().split(/\s+/)[0])); } catch { /* gone */ } }
} catch { /* gone */ } };
const killServer = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('SIGALRM', () => { killChrome(); killServer(); report.state = 'timeout'; save().finally(() => process.exit(124)); });
process.on('exit', () => { killChrome(); killServer(); });

async function until(fn, { timeout = 90000, every = 100, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await wait(every); }
  throw new Error(`Timed out waiting for ${what}`);
}
const clip = (t, n = 200) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const bodyText = () => page.locator('body').evaluate((el) => el.innerText).catch(() => '');
const heading = () => page.locator('h1').first().innerText().catch(() => '');

// ---- Host ----
async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1',
    GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: ACCESS_KEY, PORT: String(port), GCSP_PERF_PROBE_OUT: probeOut };
  const t0 = Date.now();
  child = spawn(process.execPath, ['--import', PROBE, 'index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await appendFile(pidFile, `${child.pid} server ${tag}\n`);
  let output = '';
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Host not ready: ${clip(output.slice(-300))}`)), 180000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { output += d; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Host exited (${code}): ${clip(output.slice(-300))}`)); });
  });
  const listening = Date.now() - t0;
  const health = await until(async () => (await fetch(`${origin}/health/vehicle-evidence`)).status === 200, { what: 'health', timeout: 180000 }).then(() => Date.now() - t0);
  report.server = { spawnAt: t0, listeningMs: listening, healthReadyMs: health, readyAt: Date.now() };
  await wait(15000); report.server.idleUntil = Date.now(); // 15 s idle before the browser starts
}

// ---- Browser instrumentation ----
const INIT = () => {
  try {
    const p = { lt: [], lcp: null, fcp: null };
    Object.defineProperty(window, '__perf', { value: p });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) p.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) p.lcp = [Math.round(e.startTime), e.size, e.element ? `${e.element.tagName}.${e.element.className}`.slice(0, 60) : null]; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') p.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true });
  } catch { /* observer unsupported */ }
};
async function throttle(p) {
  if (!PHONE) return;
  cdp = await context.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', NET);
}
const docState = () => page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0]; const p = window.__perf ?? {};
  return { origin: performance.timeOrigin, now: Math.round(performance.now()), nav: n ? { type: n.type, ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null,
    fcp: p.fcp ?? null, lcp: p.lcp ?? null, lt: p.lt ?? [], resources: performance.getEntriesByType('resource').length };
}).catch(() => null);

// A step: `run` does the action and waits for the step's main control to be usable.
async function step(id, name, run, { demo, warm = false } = {}) {
  const row = { id, name, demo, warm, pass: false };
  report.steps.push(row);
  const before = await docState();
  const start = Date.now();
  try {
    const detail = await run();
    row.wallMs = Date.now() - start;
    if (detail?.usableAt) { row.wallMs = detail.usableAt - start; delete detail.usableAt; }
    const after = await docState();
    row.end = Date.now(); row.start = start;
    const navigated = !before || !after || after.origin !== before.origin;
    if (after) {
      row.navigated = navigated;
      if (navigated) Object.assign(row, { nav: after.nav, fcp: after.fcp, lcp: after.lcp?.[0] ?? null, lcpElement: after.lcp?.[2] ?? null, usableSinceNavMs: after.now });
      const lt = navigated ? after.lt : after.lt.filter(([s]) => s >= before.now);
      row.longTasks = { count: lt.length, totalMs: lt.reduce((a, [, d]) => a + d, 0), maxMs: lt.reduce((a, [, d]) => Math.max(a, d), 0) };
    }
    if (detail !== undefined) row.detail = detail;
    row.pass = true;
  } catch (error) {
    row.wallMs = Date.now() - start; row.end = Date.now(); row.start = start; row.error = clip(error.message, 300);
    try { await page.screenshot({ path: join(scratch, `fail-${tag}-${id}.png`) }); } catch { /* gone */ }
    report.errors.push({ step: id, error: row.error, h1: clip(await heading(), 80), body: clip(await bodyText(), 400) });
  }
  await save();
  return row.pass;
}

// ---- Presenter strip ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (t) => /DemoClock \(UTC\)\s+(\S+)/.exec(t)?.[1] ?? null;
const runOf = (t) => /\bRun\s+(\S+)/.exec(t)?.[1] ?? null;
const actingOf = (t) => /Acting principal\s+(.+)/.exec(t)?.[1]?.trim() ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 90000 });
  if (!(await root.evaluate((el) => el.open))) await root.locator(':scope > summary').click();
  await until(async () => clockOf(await stripText()) && !/Action in progress|Loading readback/.test(await stripText()), { what: 'presenter clock readout' });
}
const ready = async () => { const t = await stripText(); return !/Action in progress|Loading readback/.test(t) && clockOf(t) ? t : null; };
async function pickRadio(group, target) {
  const radio = page.locator(`[role=radiogroup][aria-label="${group}"] [role=radio]`).filter({ hasText: target }).first();
  await radio.waitFor({ timeout: 30000 });
  await until(async () => !(await radio.isDisabled()), { what: `${group} enabled` });
  await radio.click();
  await until(async () => (await radio.getAttribute('aria-checked')) === 'true', { timeout: 5000, what: `${target} checked` }).catch(async () => { await radio.focus(); await page.keyboard.press('Space'); });
}
async function presenterButton(name) {
  await openStrip();
  const before = await stripText();
  const b = page.getByRole('button', { name, exact: typeof name === 'string' });
  await until(async () => !(await b.isDisabled()), { what: `${name} enabled` });
  await b.click({ noWaitAfter: true });
  const after = await until(async () => { const t = await ready(); return t && (clockOf(t) !== clockOf(before) || (/Last tick/.test(t) && t !== before)) ? t : null; }, { timeout: 240000, what: `${name} to finish` });
  return { clockBefore: clockOf(before), clockAfter: clockOf(after), released: Number(/(\d+) cars? released/.exec(after)?.[1] ?? NaN) || null };
}
async function resetTo(scenario) {
  await openStrip();
  const previous = runOf(await stripText());
  await pickRadio('Scenario', scenario);
  await page.getByRole('button', { name: 'Reset scenario' }).click();
  const confirm = page.getByRole('button', { name: 'Confirm reset' }); await confirm.waitFor({ timeout: 10000 });
  const t0 = Date.now(); await confirm.click({ noWaitAfter: true });
  // The reset reloads the workspace; wait for the strip to show the new run, settled.
  const text = await until(async () => {
    const open = await strip().evaluate((el) => el.open).catch(() => false);
    if (!open) { await strip().locator(':scope > summary').click({ timeout: 2000 }).catch(() => {}); return null; }
    const t = await ready(); return t && runOf(t) && runOf(t) !== previous && t.includes(scenario) ? t : null;
  }, { timeout: 240000, every: 200, what: 'new run after reset' });
  return { scenario, confirmToReadyMs: Date.now() - t0, run: runOf(text) ? 'new' : null, clock: clockOf(text) };
}
async function switchTo(name) {
  await openStrip();
  if ((actingOf(await stripText()) || '').startsWith(name)) return { already: true };
  await pickRadio('Acting principal', name);
  await page.getByRole('button', { name: 'Switch principal' }).click({ noWaitAfter: true });
  await until(async () => { const open = await strip().evaluate((el) => el.open).catch(() => false);
    if (!open) { await strip().locator(':scope > summary').click({ timeout: 2000 }).catch(() => {}); return null; }
    const t = await ready(); return t && (actingOf(t) || '').startsWith(name) ? t : null; }, { timeout: 120000, every: 200, what: `${name} acting` });
  return { acting: name };
}
const goto = (path) => page.goto(`${origin}${path}`, { waitUntil: 'commit', timeout: 120000 });

// ---- Manual journey helpers ----
async function setupUsable() {
  await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor({ timeout: 90000 });
  const driver = page.locator('select[name="driverId"]');
  await until(async () => (await driver.locator('option').count()) > 1 && !(await driver.isDisabled()), { what: 'driver options' });
}
async function fillSetup() {
  const pick = async (name) => {
    const s = page.locator(`select[name="${name}"]`);
    await until(async () => (await s.locator('option:not([disabled])').count()) > 1 && !(await s.isDisabled()), { what: `${name} options` });
    const v = await s.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value); await s.selectOption(v);
  };
  await page.locator('select[name="driverId"]').selectOption({ label: 'You: Paula (fictional)' }).catch(() => pick('driverId'));
  await pick('contractOptionId');
  const date = page.locator('input[name="requestedCollectionDate"]'); await date.fill(await date.getAttribute('min'));
  await pick('collectionLocationId');
  const brand = page.locator('select[name="brand"]');
  if (!(await brand.isDisabled()) && !(await brand.inputValue())) await brand.selectOption({ label: 'BMW' }).catch(() => pick('brand'));
  const fillIfEmpty = async (sel, v) => { const c = page.locator(sel); if (await c.count() && await c.isVisible() && !(await c.inputValue())) await c.fill(v); };
  await fillIfEmpty('input[name="phone"]', '07700900123'); await fillIfEmpty('input[name="email"]', 'paula.test@example.test');
  await fillIfEmpty('input[name="expectedReturnMileage"]', '24000');
}
const countdown = () => page.locator('.gcsp-review-countdown').first().innerText().catch(() => '');
async function reviewUsable() {
  await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 90000 });
  await until(async () => /remaining/.test(await countdown()), { what: 'active countdown' });
  await until(async () => page.getByRole('button', { name: 'Continue to order review' }).isEnabled(), { what: 'Continue to order review enabled' });
}
const boxes = () => page.locator('input[type="checkbox"][data-declaration]');
const submitButton = () => page.getByRole('button', { name: /^(Submit order|Retry the same submission|Submitting order)$/ });
const OUTCOME_H1 = /^(Order received|Order saved|Order not sent)$/;

// ---- Offer helpers ----
const offerText = () => page.locator('gcsp-offer').first().evaluate((el) => el.innerText).catch(() => '');
const FOLLOWUP = 'gcsp-offer .gcsp-followup';
async function outboxOfferHrefs() {
  await until(() => page.locator('gcsp-outbox').evaluate((el) => /captured email/.test(el.innerText) && !/Loading captured/.test(el.innerText)), { what: 'outbox to load' });
  const rows = page.locator('gcsp-outbox button').filter({ hasText: 'Your vehicle offer' });
  await rows.first().waitFor({ timeout: 30000 });
  return rows;
}
async function hrefOf(rows, i) {
  await rows.nth(i).click();
  const link = page.getByRole('link', { name: /Open the offer/ }); await link.first().waitFor({ timeout: 30000 });
  return link.first().getAttribute('href');
}
async function offerUsable() {
  await until(async () => { const t = await offerText(); return t.length > 40 && !/Loading your offer|Please wait/.test(t); }, { what: 'offer to settle' });
  await page.getByRole('button', { name: /Accept this offer/ }).waitFor({ timeout: 90000 });
}
const offerIdOf = (href) => new URL(href, origin).searchParams.get('offerId');

let stockBody = null; let controlsBody = null; // the largest of each, for what fills them
async function run() {
  await mkdir(scratch, { recursive: true }); await mkdir(profileDir, { recursive: true });
  await startHost(); await save();
  if (process.env.PERF_STARTUP_ONLY) { report.startupOnly = true; return; } // FUCQ-190 like-for-like: start, 15 s idle, stop
  context = await chromium.launchPersistentContext(profileDir, { executablePath: CHROME, headless: true, viewport,
    ...(PHONE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  const chromePids = ps.split('\n').filter((l) => l.includes(`--user-data-dir=${profileDir}`)).map((l) => l.trim().split(/\s+/)[0]);
  await appendFile(pidFile, `${chromePids.join(' ')} chrome ${tag}\n`);
  await context.addInitScript(INIT);
  context.on('requestfinished', (r) => pending.push((async () => {
    const t = r.timing(); const s = await r.sizes().catch(() => null); const resp = await r.response().catch(() => null);
    const u = new URL(r.url());
    requests.push({ t: Math.round(t.startTime), m: r.method(), p: u.pathname, type: r.resourceType(), st: resp?.status() ?? null,
      ttfb: t.responseStart >= 0 && t.requestStart >= 0 ? Math.round(t.responseStart - t.requestStart) : null, dur: t.responseEnd >= 0 ? Math.round(t.responseEnd) : null,
      enc: s?.responseBodySize ?? null });
  })()));
  context.on('response', async (r) => { if (r.status() === 200 && new URL(r.url()).pathname === '/api/gcsp/manual/stock') { const t = await r.text().catch(() => null); if (t && t.length > (stockBody?.length ?? 0)) stockBody = t; } if (r.status() === 200 && new URL(r.url()).pathname === '/api/gcsp/presenter/controls') { const t = await r.text().catch(() => null); if (t && t.length > (controlsBody?.length ?? 0)) controlsBody = t; } });
  context.on('response', async (r) => { if (r.status() >= 400) report.badResponses.push({ st: r.status(), m: r.request().method(), p: new URL(r.url()).pathname }); });
  page = await context.newPage(); await throttle(page);
  page.on('pageerror', (e) => report.errors.push({ pageError: clip(e.message, 200) }));

  // Sign-in: the demo key form, then the workspace's first useful screen.
  await step('signin-access-page', 'Open the presenter link: access key page usable', async () => {
    await goto('/gcsp-presenter.html'); await page.locator('#key').waitFor({ timeout: 90000 });
  }, { demo: 'sign-in' });
  await step('signin-workspace', 'Type the key, Enter: workspace shows Your cars', async () => {
    await page.locator('#key').fill(ACCESS_KEY); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: /Choose a replacement|Resume saved journey/ }).first().waitFor({ timeout: 90000 });
  }, { demo: 'sign-in' });
  await step('presenter-open', 'Open Presenter controls: clock and controls ready', () => openStrip(), { demo: 'presenter' });
  await step('presenter-tick-1', 'Tick on a fresh run', () => presenterButton(/^Tick \(/), { demo: 'presenter' });

  // Paula's manual selection (fresh host, before any reset, as the FUCQ-70 walkthrough does).
  await step('account-load', 'Account page (gcsp-account.html) load to Choose a replacement', async () => {
    await goto('/gcsp-account.html');
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    await page.getByRole('button', { name: /Choose a replacement|Resume saved journey/ }).first().waitFor({ timeout: 90000 });
  }, { demo: 'employee' });
  await step('setup-open', 'Choose a replacement: setup form usable', async () => {
    await page.getByRole('button', { name: /Choose a replacement|Resume saved journey/ }).first().click(); await setupUsable();
  }, { demo: 'employee' });
  await fillSetup();
  await step('setup-save', 'Save choices: saved confirmation', async () => {
    await page.getByRole('button', { name: 'Save choices' }).click(); await page.getByText('Your choices are saved.').first().waitFor({ timeout: 90000 });
  }, { demo: 'employee' });
  await step('presenter-next-release', 'Next release from the setup page', () => presenterButton('Next release'), { demo: 'presenter' });
  const date = page.locator('input[name="requestedCollectionDate"]');
  await until(async () => (await date.getAttribute('min')) && !(await date.isDisabled()), { what: 'refreshed collection window' }).catch(() => {});
  if ((await date.inputValue().catch(() => '')) !== (await date.getAttribute('min').catch(() => ''))) {
    await date.fill(await date.getAttribute('min')); await page.getByRole('button', { name: 'Save choices' }).click();
    await until(async () => /Your choices are saved/.test(await bodyText()), { what: 'choices re-saved' }).catch(() => {});
  }
  await step('gallery-open', 'Continue: Released cars gallery with enabled Review buttons', async () => {
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor({ timeout: 120000 });
    const b = page.getByRole('button', { name: 'Review this car' });
    await until(async () => (await b.count()) > 0 && await b.first().isEnabled(), { what: 'enabled Review this car' });
    return { cards: await b.count() };
  }, { demo: 'employee' });
  await step('review-open', 'Review this car: review page with countdown and Continue enabled', async () => {
    await page.getByRole('button', { name: 'Review this car' }).first().click(); await reviewUsable();
  }, { demo: 'employee' });
  await step('resume-account', 'Reload: account offers Resume saved journey', async () => {
    await goto('/gcsp-account.html');
    await page.getByRole('button', { name: /Resume saved journey/ }).first().waitFor({ timeout: 90000 });
  }, { demo: 'employee' });
  await step('resume-review', 'Resume saved journey: back on the review page, usable', async () => {
    await page.getByRole('button', { name: /Resume saved journey/ }).first().click(); await reviewUsable();
  }, { demo: 'employee' });
  await step('order-summary', 'Continue to order review: summary with declarations', async () => {
    await page.getByRole('button', { name: 'Continue to order review' }).click();
    await page.getByRole('heading', { name: 'Review your order', exact: true }).waitFor({ timeout: 90000 });
    await until(async () => (await boxes().count()) > 0, { what: 'declaration checkboxes' });
  }, { demo: 'employee' });
  const total = await boxes().count().catch(() => 0);
  for (let i = 0; i < total; i += 1) if (!(await boxes().nth(i).isChecked())) await boxes().nth(i).check();
  await step('order-submit', 'Submit order: outcome heading', async () => {
    await until(async () => submitButton().isEnabled(), { what: 'Submit enabled' });
    await submitButton().click();
    await until(async () => OUTCOME_H1.test((await heading()).trim()), { timeout: 120000, what: 'order outcome' });
    return { outcome: (await heading()).trim() };
  }, { demo: 'employee' });
  await step('order-finish', 'Finish: account shows the order', async () => {
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
  }, { demo: 'employee' });


  // ---- Run 2 steps ----
  // Order progress for the order Paula just placed, then after a tick moves it on.
  const progressSettled = () => settled('gcsp-order-progress');
  await step('order-progress-load', 'Order progress page (gcsp-order-progress-live.html) load until settled', async () => {
    await goto('/gcsp-order-progress-live.html'); return { usableAt: await progressSettled(), text: clip(await page.locator('gcsp-order-progress').innerText(), 160) };
  }, { demo: 'order-progress' });
  await goto('/gcsp-presenter.html'); await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
  await step('presenter-tick-order', 'Tick with an order placed', () => presenterButton(/^Tick \(/), { demo: 'order-progress' });
  await step('order-progress-after-tick', 'Order progress reload after the tick', async () => {
    await goto('/gcsp-order-progress-live.html'); return { usableAt: await progressSettled(), text: clip(await page.locator('gcsp-order-progress').innerText(), 160) };
  }, { demo: 'order-progress' });

  // Greg's dashboard: demand, ordering, renewal cases, route comparison and experiments.
  await goto('/gcsp-presenter.html'); await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
  await step('presenter-switch-greg', 'Switch principal to Greg: dashboard settled', async () => {
    await switchTo('Greg'); await page.getByRole('heading', { name: 'Demand and supply' }).first().waitFor({ timeout: 90000 }); return { usableAt: await settled('body') };
  }, { demo: 'greg' });
  await step('greg-page-load', 'Greg dashboard page load until every region settles', async () => {
    await goto('/gcsp-presenter.html'); await page.getByRole('heading', { name: 'Demand and supply' }).first().waitFor({ timeout: 90000 });
    const usableAt = await settled('body');
    const regions = await page.evaluate(() => [...document.querySelectorAll('section[aria-label], section[aria-labelledby], [aria-label="Renewal cases"], [aria-label="Route comparison"], [aria-label="Next order plan"]')]
      .map((s) => ({ label: s.getAttribute('aria-label') || document.getElementById(s.getAttribute('aria-labelledby'))?.textContent || s.className, chars: s.innerText.length,
        buttons: [...s.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 8), text: s.innerText.replace(/\s+/g, ' ').slice(0, 140) })).slice(0, 12));
    return { usableAt, regions, domNodes: await page.evaluate(() => document.querySelectorAll('*').length) };
  }, { demo: 'greg' });
  const inRegion = (label, name) => page.locator(`[aria-label="${label}"]`).getByRole('button', { name, exact: true }).first();
  for (const [id, label, name, what] of [['greg-cases-refresh', 'Renewal cases', 'Refresh queue', 'Renewal cases: Refresh queue'],
    ['greg-comparison-reload', 'Route comparison', 'Reload', 'Route comparison and experiments: Reload']]) {
    await step(id, what, async () => {
      const b = inRegion(label, name); if (!(await b.count())) return { skipped: `no ${name} button` };
      await until(async () => b.isEnabled(), { what: `${name} enabled` }); await b.click(); return { usableAt: await settled('body') };
    }, { demo: 'greg' });
  }
  await step('greg-plan-preview', 'Next order plan: Preview', async () => {
    const region = page.locator('[aria-label="Next order plan"]');
    const b = region.getByRole('button', { name: /^Preview/ }).first(); if (!(await b.count()) || !(await b.isEnabled())) return { skipped: 'no enabled Preview', buttons: await region.locator('button').allInnerTexts() };
    await b.click(); return { usableAt: await settled('body') };
  }, { demo: 'greg' });
  await step('greg-tick', 'Tick from Greg\'s dashboard: strip and dashboard refreshed', async () => {
    const r = await presenterButton(/^Tick \(/); return { ...r, usableAt: await settled('body') };
  }, { demo: 'greg' });

  // The outbox, after a reset that sends Paula's offer email (as run 1's offer flow does), then after a tick.
  await step('presenter-reset-decline', 'Reset to Decline then change from Greg\'s dashboard', () => resetTo('Decline then change'), { demo: 'outbox' });
  for (const id of ['outbox-load', 'outbox-after-tick']) {
    if (id === 'outbox-after-tick') await presenterButton(/^Tick \(/);
    await step(id, `Outbox page load, open the first offer email (${id})`, async () => {
      await goto('/gcsp-outbox.html'); const rows = await outboxOfferHrefs(); const n = await page.locator('gcsp-outbox button').count();
      await hrefOf(rows, 0); return { usableAt: await settled('gcsp-outbox'), offerRows: await rows.count(), buttons: n };
    }, { demo: 'outbox' });
  }

  for (const [id, path, ok] of [['greg', '/gcsp-presenter.html', async () => { await page.getByRole('heading', { name: 'Demand and supply' }).first().waitFor({ timeout: 90000 }); return settled('body'); }],
    ['order-progress', '/gcsp-order-progress-live.html', () => progressSettled()],
    ['outbox', '/gcsp-outbox.html', () => settled('gcsp-outbox')]]) {
    await step(`warm-${id}`, `Warm reload of ${id}`, async () => { await goto(path); return { usableAt: await ok() }; }, { demo: 'warm', warm: true });
  }
}

// Settled: under `sel`, at least 60 characters of text, no loading copy or aria-busy, and the text unchanged for 400 ms.
// Returns when it became stable. (A phone run first settled on the empty element while its modules downloaded.)
async function settled(sel, quiet = 400) {
  let last = null; let since = Date.now(); const end = Date.now() + 150000;
  while (Date.now() < end) {
    const s = await page.evaluate((q) => { const r = document.querySelector(q) ?? document.body; const t = r.innerText;
      return { t: `${t.length}:${t.slice(-300)}`, busy: t.trim().length < 60 || /\bLoading\b|Reading the|Please wait|Starting the|Action in progress/i.test(t) || Boolean(r.querySelector('[aria-busy="true"]')) }; }, sel)
      .catch(() => ({ t: null, busy: true }));
    if (s.busy || s.t !== last) { last = s.t; since = Date.now(); } else if (Date.now() - since >= quiet) return since;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${sel} to settle`);
}

// What fills the manual/stock payload: bytes by JSON path (array items folded) and repeated subtrees.
function stockAnatomy(text) {
  const body = JSON.parse(text); const size = (x) => JSON.stringify(x ?? null).length;
  const paths = new Map(); const seen = new Map();
  const walk = (x, p, d) => {
    if (x === null || typeof x !== 'object') return;
    const s = JSON.stringify(x);
    if (s.length >= 512) { const e = seen.get(s); if (e) { e.n += 1; return; } seen.set(s, { n: 1, b: s.length, p }); }
    if (d >= 6) return;
    if (Array.isArray(x)) for (const y of x) walk(y, `${p}[]`, d + 1); else for (const [k, y] of Object.entries(x)) walk(y, `${p}.${k}`, d + 1);
  };
  walk(body, '$', 0); seen.clear(); paths.clear(); walkAll(body, '$', 0); seen.clear(); walk(body, '$', 0);
  function walkAll(x, p, d) { paths.set(p, (paths.get(p) ?? 0) + size(x)); if (x === null || typeof x !== 'object' || d >= 6) return;
    if (Array.isArray(x)) for (const y of x) walkAll(y, `${p}[]`, d + 1); else for (const [k, y] of Object.entries(x)) walkAll(y, `${p}.${k}`, d + 1); }
  const repeated = [...seen.values()].filter((e) => e.n > 1);
  const v = body.value ?? {};
  return { totalBytes: text.length, counts: Object.fromEntries(Object.entries(v).filter(([, x]) => Array.isArray(x)).map(([k, x]) => [k, x.length])),
    topLevelKB: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(size(x) / 1024)])),
    largestPaths: [...paths].filter(([p]) => p.split(/\.|\[\]/).length > 2).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p, b]) => ({ p, kb: Math.round(b / 102.4) / 10 })),
    repeatedSubtrees: { distinct: repeated.length, extraCopies: repeated.reduce((a, e) => a + e.n - 1, 0), wastedKB: Math.round(repeated.reduce((a, e) => a + (e.n - 1) * e.b, 0) / 1024),
      top: repeated.sort((a, b) => (b.n - 1) * b.b - (a.n - 1) * a.b).slice(0, 8).map((e) => ({ p: e.p, copies: e.n, kb: Math.round(e.b / 102.4) / 10 })) } };
}

async function finish() {
  await Promise.all(pending);
  await context?.close().catch(() => {}); killChrome();
  if (child && child.exitCode === null) { const gone = once(child, 'exit'); child.kill('SIGTERM'); setTimeout(() => killServer(), 8000).unref(); await gone; }
  const lines = (await readFile(probeOut, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const samples = lines.filter((l) => l.k === 's'); const served = lines.filter((l) => l.k === 'r');
  const exit = lines.find((l) => l.k === 'exit');
  const within = (a, b) => samples.filter((s) => s.t >= a && s.t <= b + 250);
  const mib = (x) => Math.round(x / MIB);
  const srv = report.server;
  const toReady = samples.filter((s) => s.t <= srv.readyAt); const idle = within(srv.readyAt, srv.idleUntil);
  Object.assign(srv, { peakRssToReadyMiB: mib(Math.max(...toReady.map((s) => s.rss))), rssAtReadyMiB: mib(toReady.at(-1)?.rss ?? 0),
    heapUsedAtReadyMiB: mib(toReady.at(-1)?.heapUsed ?? 0), idleRssEndMiB: mib(idle.at(-1)?.rss ?? 0), idleHeapUsedEndMiB: mib(idle.at(-1)?.heapUsed ?? 0),
    cpuMsToReady: toReady.length ? Math.round((toReady.at(-1).cpuUser + toReady.at(-1).cpuSystem) / 1000) : null,
    peakRssWholeRunMiB: samples.length ? mib(Math.max(...samples.map((s) => s.rss))) : null, peakHeapUsedWholeRunMiB: samples.length ? mib(Math.max(...samples.map((s) => s.heapUsed))) : null,
    maxRssProcessMiB: exit ? mib(exit.maxRssBytes) : null, maxEventLoopDelayToReadyMs: Math.max(0, ...toReady.map((s) => s.eldMaxMs)) });
  for (const row of report.steps) {
    if (!row.start) continue;
    const ss = within(row.start, row.end); const prev = samples.filter((s) => s.t <= row.start).at(-1) ?? ss[0]; const last = ss.at(-1);
    row.serverDuring = ss.length ? { peakRssMiB: mib(Math.max(...ss.map((s) => s.rss))), peakHeapUsedMiB: mib(Math.max(...ss.map((s) => s.heapUsed))),
      cpuMs: prev && last ? Math.round((last.cpuUser + last.cpuSystem - prev.cpuUser - prev.cpuSystem) / 1000) : null, maxEventLoopDelayMs: Math.max(...ss.map((s) => s.eldMaxMs)) } : null;
    const br = requests.filter((r) => r.t >= row.start - 5 && r.t <= row.end);
    const api = served.filter((r) => r.t >= row.start - 5 && r.t <= row.end && r.p.startsWith('/api/'));
    const statics = served.filter((r) => r.t >= row.start - 5 && r.t <= row.end && !r.p.startsWith('/api/'));
    row.requests = { browserCount: br.length, browserEncodedBytes: br.reduce((a, r) => a + (r.enc ?? 0), 0), staticCount: statics.length, staticBytes: statics.reduce((a, r) => a + r.b, 0),
      apiCount: api.length, apiBytes: api.reduce((a, r) => a + r.b, 0), apiServerMsTotal: Math.round(api.reduce((a, r) => a + r.ms, 0)),
      api: api.map((r) => ({ m: r.m, p: r.p.replace(/\/[0-9a-f-]{16,}|\/(?:offer|run|claim)-[\w-]+/g, '/:id'), st: r.st, ms: r.ms, b: r.b })) };
  }
  report.serverRequests = { count: served.length, uncompressed: served.filter((r) => !r.enc).length, staticNoStoreBytes: served.filter((r) => !r.p.startsWith('/api/')).reduce((a, r) => a + r.b, 0) };
  try { if (stockBody) report.stockPayload = stockAnatomy(stockBody); } catch (e) { report.errors.push({ stock: clip(e.message) }); }
  try { if (controlsBody) report.controlsPayload = stockAnatomy(controlsBody); } catch (e) { report.errors.push({ controls: clip(e.message) }); }
  // Which tick handler's outcome fills the readback's lastTick.
  try { const outs = JSON.parse(controlsBody ?? 'null')?.value?.lastTick?.outcomes;
    if (Array.isArray(outs)) report.controlsPayload.lastTickOutcomes = outs.map((o) => ({ id: o.handlerId ?? o.consumerId ?? o.handler ?? o.name ?? Object.values(o).find((v) => typeof v === 'string') ?? null,
      kb: Math.round(JSON.stringify(o).length / 102.4) / 10, keys: Object.keys(o?.outcome?.value ?? {}).slice(0, 8) })); } catch { /* best effort */ }
  report.stockFetches = report.steps.map((s) => ({ id: s.id, n: (s.requests?.api ?? []).filter((a) => a.p === '/api/gcsp/manual/stock').length })).filter((x) => x.n);
  report.finishedAt = new Date().toISOString();
  await save();
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'failed'; report.errors.push({ fatal: clip(error.stack, 600) }); }
finally { await finish().catch((e) => { report.errors.push({ finish: clip(e.stack, 400) }); return save(); }); }
process.exit(0);

// ---- Summary across runs ----
async function summarise() {
  const files = (await readdir(HERE)).filter((f) => /^results2-(desktop|phone)-\d+\.json$/.test(f)).sort();
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(HERE, f), 'utf8'))));
  const out = { story: 'FUCQ-247', run: 2, generatedAt: new Date().toISOString(), files, profiles: {} };
  const spread = (xs) => { const s = xs.filter(Number.isFinite); return s.length ? { median: median(s), min: Math.min(...s), max: Math.max(...s), n: s.length } : null; };
  for (const prof of ['desktop', 'phone']) {
    const rs = runs.filter((r) => r.profile === prof); if (!rs.length) continue;
    const p = { runs: rs.length, states: rs.map((r) => r.state), server: {}, steps: {} };
    for (const k of ['peakRssWholeRunMiB', 'peakHeapUsedWholeRunMiB', 'maxRssProcessMiB']) p.server[k] = spread(rs.map((r) => r.server?.[k]));
    const ids = [...new Set(rs.flatMap((r) => r.steps.map((s) => s.id)))];
    for (const id of ids) {
      const ss = rs.map((r) => r.steps.find((s) => s.id === id)).filter(Boolean); const ok = ss.filter((s) => s.pass && !s.detail?.skipped);
      p.steps[id] = { name: ss[0].name, demo: ss[0].demo, warm: ss[0].warm, passed: `${ok.length}/${ss.length}`, wallMs: spread(ok.map((s) => s.wallMs)),
        fcp: spread(ok.map((s) => s.fcp)), lcp: spread(ok.map((s) => s.lcp)), longTaskTotalMs: spread(ok.map((s) => s.longTasks?.totalMs)), longTaskMaxMs: spread(ok.map((s) => s.longTasks?.maxMs)),
        browserRequests: spread(ok.map((s) => s.requests?.browserCount)), browserKB: spread(ok.map((s) => Math.round((s.requests?.browserEncodedBytes ?? NaN) / 1024))),
        apiCalls: spread(ok.map((s) => s.requests?.apiCount)), apiKB: spread(ok.map((s) => Math.round((s.requests?.apiBytes ?? NaN) / 1024))), apiServerMs: spread(ok.map((s) => s.requests?.apiServerMsTotal)),
        serverCpuMs: spread(ok.map((s) => s.serverDuring?.cpuMs)), serverMaxEldMs: spread(ok.map((s) => s.serverDuring?.maxEventLoopDelayMs)),
        skipped: ss.filter((s) => s.detail?.skipped).map((s) => s.detail.skipped), errors: ss.filter((s) => !s.pass).map((s) => s.error) };
    }
    out.profiles[prof] = p;
  }
  out.stockPayload = runs.find((r) => r.stockPayload)?.stockPayload ?? null;
  out.controlsPayload = runs.find((r) => r.controlsPayload)?.controlsPayload ?? null;
  await writeFile(join(HERE, 'summary-run2.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ files, written: 'summary-run2.json' }));
}
