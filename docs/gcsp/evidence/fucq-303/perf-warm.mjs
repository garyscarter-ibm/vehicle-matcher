// FUCQ-303: trimmed copy of FUCQ-247 perf-run1.mjs. Signs in, reaches Paula's offer, then loads presenter, account,
// activity and offer twice (prime, warm) in one browser. PERF_VARIANT=before|after PERF_SERVER_DIR=<server dir>; `summarise` folds results.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(process.env.PERF_SERVER_DIR || resolve(HERE, '../../../../server'));
const PROBE = join(HERE, '../fucq-247/server-probe.mjs');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const MIB = 1024 * 1024;

if (process.argv[2] === 'summarise') { await summarise(); process.exit(0); }

const profileName = process.env.PERF_PROFILE || 'desktop';
const runNo = Number(process.env.PERF_RUN || 1);
const port = Number(process.env.PERF_PORT || 9530);
if (port < 9530 || port > 9539) throw new Error('PERF_PORT must be 9530-9539');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!process.env.PERF_SCRATCH || !scratch.includes('t303')) throw new Error('Set PERF_SCRATCH to the owned t303 run folder');
const PHONE = profileName === 'phone';
// Phone: 4x CPU slowdown and Lighthouse's classic mobile network (150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up).
const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const viewport = PHONE ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const origin = `http://127.0.0.1:${port}`;
const variant = process.env.PERF_VARIANT;
if (!['before', 'after'].includes(variant)) throw new Error('PERF_VARIANT must be before or after');
const tag = `${variant}-${profileName}-${runNo}`;
const profileDir = join(scratch, `chrome-${tag}`);
const probeOut = join(scratch, `probe-${tag}.jsonl`);
const resultsFile = join(HERE, `results-${tag}.json`);
const pidFile = join(scratch, '..', 'pids.txt');
const ACCESS_KEY = `perf-${randomBytes(9).toString('hex')}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import('/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');

const report = { story: 'FUCQ-303', variant, serverDir: SERVER_DIR, profile: profileName, runNo, where: 'local, macOS, offline memory host (GCSP_OFFLINE=1, GCSP_REPOSITORY_MODE=memory)',
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

// ---- Journey ----
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
  await step('presenter-reset-decline', 'Reset to Decline then change (confirm to settled strip)', () => resetTo('Decline then change'), { demo: 'presenter' });
  await step('presenter-switch-paula', 'Switch principal to Paula', () => switchTo('Paula'), { demo: 'presenter' });
  await step('activity-load', 'Buddy activity load until the offer shows', async () => {
    await goto('/gcsp-activity-live.html');
    await until(() => page.locator('gcsp-activity').evaluate((el) => /Waiting for you|Found a car/.test(el.innerText)), { timeout: 150000, what: 'offer on activity' });
  }, { demo: 'offer' });
  let firstHref;
  await step('outbox-load', 'Outbox load and open Paula\'s offer email', async () => {
    await goto('/gcsp-outbox.html'); const rows = await outboxOfferHrefs(); firstHref = await hrefOf(rows, 0); return { rows: await rows.count() };
  }, { demo: 'offer' });
  await step('offer-open-1', 'Offer link: offer page usable (Accept visible)', async () => { await page.goto(new URL(firstHref, origin).href, { waitUntil: 'commit' }); await offerUsable(); }, { demo: 'offer' });
  let secondHref;

  // Warm repeats: the same pages again in this server process and browser.
  for (const pass of ['prime', 'warm']) for (const [id, path, ok] of [['presenter', '/gcsp-presenter.html', async () => { await page.getByRole('heading').first().waitFor({ timeout: 90000 }); await openStrip(); }],
    ['account', '/gcsp-account.html', () => page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 })],
    ['activity', '/gcsp-activity-live.html', () => until(() => page.locator('gcsp-activity').evaluate((el) => el.innerText.length > 40 && !/Loading/.test(el.innerText)), { what: 'activity' })],
    ['offer', new URL(secondHref ?? firstHref ?? '/gcsp-offer.html', origin).pathname + new URL(secondHref ?? firstHref ?? '/gcsp-offer.html', origin).search, () => until(async () => { const t = await offerText(); return t.length > 40 && !/Loading your offer|Please wait/.test(t); }, { what: 'offer settled' })]]) {
    await step(`${pass}-${id}`, `${pass} load of ${id}`, async () => { await goto(path); await ok(); }, { demo: pass, warm: pass === 'warm' });
  }
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
  report.finishedAt = new Date().toISOString();
  await save();
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'failed'; report.errors.push({ fatal: clip(error.stack, 600) }); }
finally { await finish().catch((e) => { report.errors.push({ finish: clip(e.stack, 400) }); return save(); }); }
process.exit(0);
// ---- Summary across runs: prime and warm rows by variant and profile ----
async function summarise() {
  const files = (await readdir(HERE)).filter((f) => /^results-(before|after)-(desktop|phone)-\d+\.json$/.test(f)).sort();
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(HERE, f), 'utf8'))));
  const spread = (xs) => { const s = xs.filter(Number.isFinite); return s.length ? { median: median(s), min: Math.min(...s), max: Math.max(...s), n: s.length } : null; };
  const out = { story: 'FUCQ-303', generatedAt: new Date().toISOString(), files, groups: {} };
  for (const v of ['before', 'after']) for (const prof of ['desktop', 'phone']) {
    const rs = runs.filter((r) => r.variant === v && r.profile === prof); if (!rs.length) continue;
    const g = { runs: rs.length, states: rs.map((r) => r.state), steps: {} };
    for (const id of [...new Set(rs.flatMap((r) => r.steps.map((s) => s.id)))].filter((x) => /^(prime|warm)-/.test(x))) {
      const ss = rs.map((r) => r.steps.find((s) => s.id === id)).filter(Boolean); const ok = ss.filter((s) => s.pass);
      g.steps[id] = { passed: `${ok.length}/${ss.length}`, fcp: spread(ok.map((s) => s.fcp)), usableMs: spread(ok.map((s) => s.wallMs)),
        browserRequests: spread(ok.map((s) => s.requests?.browserCount)), browserKB: spread(ok.map((s) => Math.round((s.requests?.browserEncodedBytes ?? NaN) / 1024))),
        staticServed: spread(ok.map((s) => s.requests?.staticCount)), staticKB: spread(ok.map((s) => Math.round((s.requests?.staticBytes ?? NaN) / 1024))),
        errors: ss.filter((s) => !s.pass).map((s) => s.error) };
    }
    out.groups[`${v}-${prof}`] = g;
  }
  await writeFile(join(HERE, 'summary.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ files, written: 'summary.json' }));
}
