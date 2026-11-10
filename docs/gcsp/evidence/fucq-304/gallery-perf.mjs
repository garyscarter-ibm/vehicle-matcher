// FUCQ-304: re-times FUCQ-247 run 1's gallery-open step (same journey up to it) and counts manual/stock requests and bytes.
// PERF_LABEL=before|after PERF_PROFILE=desktop|phone PERF_RUN=n PERF_PORT=9550-9559 PERF_SCRATCH=<owned fucq-304 dir>; `node gallery-perf.mjs summarise <label>`.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const PROBE = join(HERE, '../fucq-247/server-probe.mjs');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (xs) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const STOCK = /\/manual\/stock$/;

if (process.argv[2] === 'summarise') { await summarise(process.argv[3]); process.exit(0); }

const label = process.env.PERF_LABEL;
if (!['before', 'after'].includes(label)) throw new Error('Set PERF_LABEL=before|after');
const profileName = process.env.PERF_PROFILE || 'desktop';
const runNo = Number(process.env.PERF_RUN || 1);
const port = Number(process.env.PERF_PORT || 0);
if (!(port >= 9550 && port <= 9559)) throw new Error('PERF_PORT must be 9550-9559');
const scratch = resolve(process.env.PERF_SCRATCH || '');
if (!process.env.PERF_SCRATCH || !scratch.includes('fucq-304')) throw new Error('Set PERF_SCRATCH to the owned fucq-304 run folder');
const PHONE = profileName === 'phone';
// Phone: 4x CPU slowdown and Lighthouse's classic mobile network (150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up).
const NET = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const viewport = PHONE ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const origin = `http://127.0.0.1:${port}`;
const tag = `${profileName}-${runNo}`;
const profileDir = join(scratch, `chrome-${tag}`);
const probeOut = join(scratch, `probe-${tag}.jsonl`);
const resultsFile = join(HERE, `${label}-${tag}.json`);
const pidFile = join(scratch, 'pids.txt');
const ACCESS_KEY = `perf-${randomBytes(9).toString('hex')}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import('/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');

const report = { story: 'FUCQ-304', label, profile: profileName, runNo, where: 'local, macOS, offline memory host (GCSP_OFFLINE=1, GCSP_REPOSITORY_MODE=memory)',
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

async function run() {
  await mkdir(scratch, { recursive: true }); await mkdir(profileDir, { recursive: true });
  await startHost(); await save();
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
  await wait(3000); // let any late stock request land before whole-run counts
}

async function finish() {
  await Promise.all(pending);
  await context?.close().catch(() => {}); killChrome();
  if (child && child.exitCode === null) { const gone = once(child, 'exit'); child.kill('SIGTERM'); setTimeout(() => killServer(), 8000).unref(); await gone; }
  const lines = (await readFile(probeOut, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const served = lines.filter((l) => l.k === 'r');
  const stats = (from, to) => {
    const br = requests.filter((r) => r.t >= from - 5 && r.t <= to);
    const sv = served.filter((r) => r.t >= from - 5 && r.t <= to);
    const stock = sv.filter((r) => STOCK.test(r.p)); const stockBr = br.filter((r) => STOCK.test(r.p));
    return { totalRequests: br.length, totalTransferredBytes: br.reduce((a, r) => a + (r.enc ?? 0), 0), serverRequests: sv.length, serverBodyBytes: sv.reduce((a, r) => a + r.b, 0),
      stockRequests: stockBr.length, stockServed: stock.map((r) => ({ st: r.st, ms: r.ms, bodyBytes: r.b, contentEncoding: r.enc })), stockTransferredBytes: stockBr.map((r) => r.enc) };
  };
  for (const row of report.steps) if (row.start) row.requests = stats(row.start, row.end);
  const all = stats(0, Infinity);
  report.wholeRun = { stockRequests: all.stockRequests, stockServed: all.stockServed, totalRequests: all.totalRequests, totalTransferredBytes: all.totalTransferredBytes };
  report.finishedAt = new Date().toISOString();
  await save();
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'failed'; report.errors.push({ fatal: clip(error.stack, 600) }); }
finally { await finish().catch((e) => { report.errors.push({ finish: clip(e.stack, 400) }); return save(); }); }
process.exit(0);

// ---- Summary across runs ----
async function summarise(lab) {
  if (!['before', 'after'].includes(lab)) throw new Error('Usage: gallery-perf.mjs summarise before|after');
  const files = (await readdir(HERE)).filter((f) => new RegExp(`^${lab}-(desktop|phone)-\\d+\\.json$`).test(f)).sort();
  const runs = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(HERE, f), 'utf8'))));
  const spread = (xs) => { const s = xs.filter(Number.isFinite); return s.length ? { median: median(s), min: Math.min(...s), max: Math.max(...s), n: s.length } : null; };
  const out = { story: 'FUCQ-304', label: lab, generatedAt: new Date().toISOString(), files, profiles: {} };
  for (const prof of ['desktop', 'phone']) {
    const rs = runs.filter((r) => r.profile === prof); if (!rs.length) continue;
    const gs = rs.map((r) => r.steps.find((s) => s.id === 'gallery-open')).filter((s) => s?.pass);
    out.profiles[prof] = { runs: rs.length, states: rs.map((r) => r.state), galleryPassed: `${gs.length}/${rs.length}`,
      durationMs: spread(gs.map((s) => s.wallMs)), cards: spread(gs.map((s) => s.detail?.cards)),
      stockRequests: spread(gs.map((s) => s.requests?.stockRequests)), stockRequestsWholeRun: spread(rs.map((r) => r.wholeRun?.stockRequests)),
      stockBodyBytesPerResponse: spread(gs.flatMap((s) => (s.requests?.stockServed ?? []).map((x) => x.bodyBytes))),
      stockTransferredBytesPerResponse: spread(gs.flatMap((s) => s.requests?.stockTransferredBytes ?? [])),
      stepTotalRequests: spread(gs.map((s) => s.requests?.totalRequests)), stepTransferredBytes: spread(gs.map((s) => s.requests?.totalTransferredBytes)),
      stepServerBodyBytes: spread(gs.map((s) => s.requests?.serverBodyBytes)) };
  }
  await writeFile(join(HERE, `summary-${lab}.json`), `${JSON.stringify(out, null, 1)}\n`);
  console.log(JSON.stringify({ files, written: `summary-${lab}.json` }));
}
