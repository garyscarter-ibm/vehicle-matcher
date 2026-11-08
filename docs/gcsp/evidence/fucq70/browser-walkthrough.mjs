// Browser walkthrough of the manual journey, one viewport per run (WALK_CHUNK=desktop|narrow), story by WALK_STORY=fucq70|fucq72|fucq73|fucq145|fucq222 (fucq145 and fucq222 also have chunk phone, 375x812).
// Spawns `node index.js` in server/ offline (GCSP_OFFLINE=1, memory repository). FUCQ70_* names still work as fallbacks for WALK_*.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const env = (name) => process.env[`WALK_${name}`] ?? process.env[`FUCQ70_${name}`];
const story = process.env.WALK_STORY || 'fucq70';
if (!['fucq70', 'fucq72', 'fucq73', 'fucq145', 'fucq222'].includes(story)) throw new Error('Set WALK_STORY=fucq70|fucq72|fucq73|fucq145|fucq222');
const chunk = env('CHUNK');
const second = ['fucq145', 'fucq222'].includes(story) ? 'phone' : 'narrow';
if (!['desktop', second].includes(chunk)) throw new Error(`Set WALK_CHUNK=desktop|${second}`);
const scratch = resolve(env('SCRATCH') || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set WALK_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 320, height: 720 } : chunk === 'phone' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const port = Number(env('PORT')) || (story === 'fucq222' ? (chunk === 'phone' ? 8941 : 8940) : story === 'fucq145' ? (chunk === 'phone' ? 8939 : 8938) : story === 'fucq73' ? (chunk === 'narrow' ? 8937 : 8936) : chunk === 'narrow' ? 8933 : 8932);
if (port < 8930 || port > 8949) throw new Error('WALK_PORT must be within 8930-8949');
const outDir = story === 'fucq70' ? HERE : story === 'fucq73' ? resolve(HERE, '..', 'fucq-6', story) : resolve(HERE, '..', story); // fucq145 -> ../fucq145, fucq222 -> ../fucq222
const only = env('ONLY') ? `-${env('ONLY')}` : ''; // a partial run never overwrites the full run's files
const shotDir = join(outDir, `browser${only}`);
const resultsFile = join(outDir, `results-${chunk}${only}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { ...(story === 'fucq70' ? {} : { story }), chunk, entry: 'hosted-offline', viewport, state: 'incomplete', startedAt: new Date().toISOString(), steps: [], keyboard: [],
  consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [], ...(story === 'fucq73' ? { screens: [], rawIdFailures: [], defects: [], motion: [], focus: [], contrast: [] } : {}) };
let lastStock = null; let shots = 0; let reviewedOrder = null; const orderPosts = []; let context; let page; let app; let child; let halted = null; let origin;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => { if (story !== 'fucq70') report.orderPosts = orderPosts; if (env('TRACE')) report.trace = trace; return writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`); };
// Kill only this run's Chrome, by PID: other sessions run walkthroughs too.
const killChrome = () => { try {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of ps.split('\n')) if (line.includes(`--user-data-dir=${profile}`)) { try { process.kill(Number(line.trim().split(/\s+/)[0])); } catch { /* gone */ } }
} catch { /* already gone */ } };
const killServer = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome(); killServer(); report.state = 'timeout'; process.exit(124); });
process.on('exit', () => { killChrome(); killServer(); });

async function until(fn, { timeout = 60000, every = 300, what = 'condition' } = {}) {
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
  if (story === 'fucq73') await rawIdCheck(file);
  return `browser/${file}`;
}
// FUCQ-73: every captured screen's visible text and aria/title/alt values are checked for raw internal ids.
const RAW73 = ['slot-paula', 'choices-fs-uk', 'current:employee', 'demo-collection-centre', 'insurance-group', 'demo-bmw'];
async function rawIdCheck(file) {
  const t = await page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[aria-label],[title],img[alt]')].map((n) => n.getAttribute('aria-label') || n.getAttribute('title') || n.getAttribute('alt'))].join('\n')).catch(() => '');
  const ids = RAW73.filter((id) => t.includes(id)); const kebab = [...new Set((t.match(/\b(?:[a-z0-9]+-){2,}[a-z0-9]+\b/g) ?? []).filter((x) => !/^\d/.test(x)))].slice(0, 8);
  report.screens.push({ screen: file, h1: clip(await page.locator('h1').first().innerText().catch(() => ''), 60), rawIds: ids, ...(kebab.length ? { kebabCaseText: kebab } : {}) });
  if (ids.length) report.rawIdFailures.push({ screen: file, ids });
  if (kebab.includes('twelve-month-12000')) defect({ id: 'rawIdCheck', screenshots: [`browser/${file}`] }, 'D3', 'Medium', 'blocks/gcsp/manual-setup/gcsp-manual-setup.js:126 (reason list falls back to contractOptionId)', 'Setup lists "twelve-month-12000: Not available for this driver and scheme." Expected the contract option name (for example "12 months, 12000 mi/year") instead of the raw option id, as the dropdown already shows.');
}
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => null);

// A step records pass/fail, observed text, page overflow and its screenshot. A failed critical step blocks the rest.
async function step(id, name, run, { critical = false } = {}) {
  const row = { id, name, pass: false, screenshots: [] };
  if (env('LOG')) console.error(`${new Date().toISOString().slice(11, 19)} step ${id}`);
  report.steps.push(row);
  if (halted) { row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    row.overflowPx = await overflow();
    row.pass = out.pass !== false && row.overflowPx === 0; row.state = clip(out.state, 600);
    if (out.detail !== undefined) row.detail = out.detail;
    if (out.shot !== false) row.screenshots.push(await shot(out.shotName || id, out.full !== false));
    if (story === 'fucq73') { const bad = report.rawIdFailures.filter((f) => row.screenshots.some((s) => s.endsWith(f.screen))); if (bad.length) { row.pass = false; row.rawIds = bad; } }
  } catch (error) {
    row.error = clip(error.message, 300); row.overflowPx = await overflow();
    try { row.screenshots.push(await shot(`${id}-failed`, false)); } catch { /* page gone */ }
    if (critical) halted = id;
  }
  await save();
}

const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement, undefined, { timeout: 2000 }).catch(() => false);
async function tabTo(locator, { max = 120 } = {}) {
  await locator.first().waitFor({ state: 'attached', timeout: 30000 });
  for (let count = 0; count <= max; count += 1) {
    if (await isFocused(locator.first())) return count;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
}
const kb = (pageName, action, pass, detail) => report.keyboard.push({ page: pageName, check: action, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });

// ---- Host ----
async function startHost() {
  origin = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1',
    GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: ACCESS_KEY, PORT: String(port) };
  child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Host not ready in time: ${clip(output.slice(-300))}`)), 90000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Host exited (${code}): ${clip(output.slice(-300))}`)); });
  });
  await ready;
  report.origin = origin;
  const own = child;
  return { stop: async () => { if (own.exitCode === null) { const gone = once(own, 'exit'); own.kill('SIGTERM'); setTimeout(() => { try { own.kill('SIGKILL'); } catch { /* gone */ } }, 5000).unref(); await gone; } } };
}

// ---- Presenter strip ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (text) => /DemoClock \(UTC\)\s+(\S+)/.exec(text)?.[1] ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 60000 });
  if (!(await root.evaluate((el) => el.open))) await root.locator('summary').first().click();
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout' });
}
// Presses a presenter button and waits for the clock to move (or the action to finish when it does not).
async function presenterPress(name) {
  await openStrip();
  const before = await stripText();
  await page.getByRole('button', { name }).click({ timeout: 60000, noWaitAfter: true });
  const after = await until(async () => { const t = await stripText(); return !/Action in progress/.test(t) && (clockOf(t) !== clockOf(before) || /Last tick/.test(t) && t !== before) ? t : null; }, { timeout: 120000, what: `${name} to finish` });
  return { before, after };
}
async function tick() { const r = await presenterPress(/^Tick \(/); await wait(Number(env('SETTLE')) || 1500); return clockOf(r.after); }

// ---- Review helpers ----
const body = () => page.locator('.gcsp-review-body');
const phone = () => page.locator('input[name="contact.phone"]');
const countdownLocator = () => page.locator('.gcsp-review-countdown');
const liveLocator = () => page.locator('.gcsp-review-announcement');
const text = (locator) => locator.first().evaluate((el) => el.innerText).catch(() => '');
const countdownOf = async () => clip(await text(countdownLocator()), 80);
const heading = () => page.locator('h1').first().innerText().catch(() => '');
const bodyText = () => page.locator('body').evaluate((el) => el.innerText).catch(() => '');
// Counts changes to the live region, so "does not announce every second" is a measured fact.
async function watchLive() {
  await page.evaluate(() => {
    const node = document.querySelector('.gcsp-review-announcement'); if (!node) return;
    window.__live = { changes: 0, texts: [node.textContent] };
    new MutationObserver(() => { window.__live.changes += 1; window.__live.texts.push(node.textContent); }).observe(node, { childList: true, characterData: true, subtree: true });
  });
}
const liveStats = () => page.evaluate(() => window.__live ? { changes: window.__live.changes, texts: window.__live.texts.slice(-6) } : null).catch(() => null);

async function reviewFacts() {
  const t = await text(body());
  return {
    vehicleName: clip(await text(page.locator('.gcsp-review-vehicle h2, .gcsp-review-vehicle h3, .gcsp-review-vehicle .vm-card-title')), 120),
    vehicleCard: clip(await text(page.locator('.gcsp-review-vehicle')), 500),
    orderNumber: /Order(?: number)?\s*:?\s*(\d{4,})/.exec(t)?.[1] ?? null,
    hasPoints: /points/i.test(await text(page.locator('.gcsp-review-vehicle'))),
    hasRepresentativeCaption: /Representative image/.test(t),
    noImagePlaceholder: /No image for this car yet/.test(t), // offline stock carries no photo, so no caption renders
    context: clip(await text(page.locator('.gcsp-review-context')), 500),
    countdown: await countdownOf(),
    consequence: clip(await text(page.locator('.gcsp-review-time .gcsp-note')), 200),
    phone: await phone().inputValue().catch(() => null),
    email: await page.locator('input[name="contact.email"]').inputValue().catch(() => null),
    mileage: await page.locator('input[name="expectedReturnMileage"]').inputValue().catch(() => null),
    special: await page.locator('textarea[name="specialRequirements"]').inputValue().catch(() => null),
    counter: clip(await text(page.locator('.gcsp-review-form .gcsp-field-hint').last()), 80),
    notice: clip(await text(page.locator('.gcsp-review-body > .gcsp-note')), 200),
  };
}

// ---- Journey ----
async function enterAccessKey(row) {
  await page.goto(`${origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
  const input = page.locator('#key'); await input.waitFor({ timeout: 30000 });
  await tabTo(input); await page.keyboard.type(ACCESS_KEY);
  const typed = (await input.inputValue()).length === ACCESS_KEY.length;
  await page.keyboard.press('Enter');
  await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
  kb('access', 'Typing the demo key and Enter opens the demo', typed);
  return typed;
}
async function fillSetup(driverLabel = 'You: Paula (fictional)', { keyboard = false } = {}) {
  await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor({ timeout: 60000 });
  const pick = async (name) => {
    const select = page.locator(`select[name="${name}"]`);
    await until(async () => (await select.locator('option:not([disabled])').count()) > 1 && !(await select.isDisabled()), { what: `${name} options` });
    const value = await select.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value);
    await select.selectOption(value); return value;
  };
  const chosen = {};
  const driver = page.locator('select[name="driverId"]');
  await until(async () => (await driver.locator('option').count()) > 1 && !(await driver.isDisabled()), { what: 'driver options' });
  await driver.selectOption({ label: driverLabel }).catch(async () => { await pick('driverId'); });
  chosen.driver = clip(await driver.evaluate((s) => s.selectedOptions[0]?.textContent), 60);
  chosen.contract = await pick('contractOptionId');
  const date = page.locator('input[name="requestedCollectionDate"]');
  chosen.date = await date.getAttribute('min'); await date.fill(chosen.date);
  chosen.location = await pick('collectionLocationId');
  const brand = page.locator('select[name="brand"]');
  if (!(await brand.isDisabled()) && !(await brand.inputValue())) await brand.selectOption({ label: 'BMW' }).catch(() => pick('brand'));
  const fillIfEmpty = async (selector, value) => { const c = page.locator(selector); if (!(await c.inputValue())) await c.fill(value); };
  await fillIfEmpty('input[name="phone"]', '07700900123');
  await fillIfEmpty('input[name="email"]', 'paula.test@example.test');
  await fillIfEmpty('input[name="expectedReturnMileage"]', '24000');
  if (keyboard) { await tabTo(page.getByRole('button', { name: 'Save choices' })); await page.keyboard.press('Enter'); } else await page.getByRole('button', { name: 'Save choices' }).click();
  await page.getByText('Your choices are saved.').first().waitFor({ timeout: 60000 });
  return chosen;
}
// Opens the first eligible card's review and waits for the review page with an active countdown.
async function reviewFirstCar() {
  await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor({ timeout: 60000 });
  const reviewButton = page.getByRole('button', { name: 'Review this car' });
  await until(async () => (await reviewButton.count()) > 0 && await reviewButton.first().isEnabled(), { what: 'an enabled Review this car button' });
  await reviewButton.first().click();
  await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 60000 });
  await until(async () => /remaining/.test(await countdownOf()), { what: 'active countdown' });
}
async function claimNow() {
  return page.evaluate(async () => { const r = await fetch('/api/gcsp/manual/claim', { credentials: 'same-origin' }); const j = await r.json(); return { status: r.status, hold: j.value?.hold ?? j.hold ?? null }; });
}

const DEFAULT_DRIVER = 'You: Paula (fictional)';
// Demo key, Choose a replacement, setup saved, Next release, Continue to the gallery. `tag` prefixes step ids for later runs.
async function reachGallery({ driverLabel = DEFAULT_DRIVER, tag = '' } = {}) {
  await step(`${tag}access-key`, 'Demo key form opens the offline hosted demo', async () => {
    const typed = await enterAccessKey();
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    return { pass: typed, state: await bodyText(), shot: false };
  }, { critical: true });

  await step(`${tag}setup-saved`, driverLabel === DEFAULT_DRIVER ? 'Choose a replacement; setup choices saved for Paula' : `Choose a replacement; setup choices saved for ${driverLabel}`, async () => {
    await page.getByRole('button', { name: 'Choose a replacement' }).click();
    const chosen = await fillSetup(driverLabel);
    return { state: `${await heading()} | ${JSON.stringify(chosen)}`, detail: chosen, full: false };
  }, { critical: true });

  await step(`${tag}release-and-gallery`, 'Next release, Continue, Released cars gallery', async () => {
    const { after } = await presenterPress('Next release');
    // The release moves the collection window, so the saved date is re-picked from the refreshed window before Continue.
    const date = page.locator('input[name="requestedCollectionDate"]');
    await until(async () => (await date.getAttribute('min')) && !(await date.isDisabled()), { what: 'refreshed collection window' });
    const window = { min: await date.getAttribute('min'), max: await date.getAttribute('max'), was: await date.inputValue() };
    if (window.was !== window.min) {
      await date.fill(window.min);
      await page.getByRole('button', { name: 'Save choices' }).click();
      await until(async () => /Your choices are saved/.test(await bodyText()), { what: 'choices re-saved' });
    }
    report.notes.push(`Collection window after release: ${JSON.stringify(window)}`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor({ timeout: 60000 });
    await until(async () => (await page.getByRole('button', { name: 'Review this car' }).count()) > 0, { what: 'gallery cards' });
    const cards = await page.getByRole('button', { name: 'Review this car' }).count();
    return { state: `${await heading()}; ${cards} review buttons; ${clip(after, 160)}`, detail: { cards }, full: false };
  }, { critical: true });
}

// WALK_TRACE=1 records every /api/ request with timing, outcome and the claim/review-details envelope fields into report.trace.
const trace = []; const T0 = Date.now(); const mark = (label) => trace.push({ at: Date.now() - T0, mark: label });
function traceRequests(p) {
  const rows = new Map();
  p.on('request', (r) => { if (!/\/api\//.test(r.url())) return; const row = { at: Date.now() - T0, method: r.method(), path: bare(r.url()).replace(/^https?:\/\/[^/]+/, '').replace('/api/gcsp/manual', '') , done: null }; rows.set(r, row); trace.push(row); });
  p.on('requestfailed', (r) => { const row = rows.get(r); if (row) row.done = `failed ${r.failure()?.errorText}`; });
  p.on('response', async (r) => {
    const row = rows.get(r.request()); if (!row) return; row.http = r.status(); row.done = `done +${Date.now() - T0 - row.at}ms`;
    if (row.method === 'GET' && /^\/(claim|review-details)$/.test(row.path)) {
      const j = await r.json().catch(() => null); const v = j?.value ?? {}; const h = v.hold ?? v.claim?.hold ?? {};
      row.env = j?.status; row.v = { state: h.state, phase: h.phase, expiresAt: h.expiresAt, now: v.now ?? j?.now ?? v.hold?.now, pendingOperation: v.pendingOperation === undefined ? undefined : (v.pendingOperation === null ? null : 'set'),
        frozen: v.frozen, editable: v.editable ?? j?.view?.editable, view: v.view?.state ?? v.view ?? j?.view?.state, vstate: v.state };
    }
  });
}
// ---- FUCQ-72: manual order review, declarations, submit and outcome ----
const RAW_IDS = ['slot-paula', 'demo-collection-centre', 'current:employee-paula', 'insurance-group'];
const ORDER_ROUTE = /\/api\/gcsp\/manual\/order(\?.*)?$/;
const summaryText = () => text(page.locator('.gcsp-summary-body'));
const boxes = () => page.locator('input[type="checkbox"][data-declaration]');
const submitButton = () => page.getByRole('button', { name: /^(Submit order|Retry the same submission|Submitting order)$/ });
const countdown72 = async () => clip(await text(page.locator('.gcsp-review-countdown')), 80);
const OUTCOME_H1 = /^(Order received|Order saved|Order not sent)$/;
const waitOutcome = () => until(async () => OUTCOME_H1.test((await heading()).trim()), { timeout: 60000, what: 'order outcome heading' });
const rawIdsIn = (t) => RAW_IDS.filter((id) => t.includes(id));
const sectionText = (title) => text(page.locator('.gcsp-summary-section').filter({ has: page.locator('h2', { hasText: title }) }));

async function toSummary() {
  await tabTo(page.getByRole('button', { name: 'Continue to order review' }));
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Review your order', exact: true }).waitFor({ timeout: 60000 });
  await until(async () => /Order review: \d+:\d{2} remaining/.test(await summaryText()), { what: 'order review countdown' });
  await until(async () => (await boxes().count()) > 0, { what: 'declaration checkboxes' });
}
async function declarationLabels() {
  return boxes().evaluateAll((list) => list.map((b) => (b.closest('label') ?? document.querySelector(`label[for="${b.id}"]`))?.innerText.replace(/\s+/g, ' ').trim() ?? ''));
}
async function tickAll() {
  const total = await boxes().count();
  for (let i = 0; i < total; i += 1) if (!(await boxes().nth(i).isChecked())) await boxes().nth(i).check();
  await until(async () => submitButton().isEnabled(), { timeout: 15000, what: 'Submit enabled' }).catch(() => {});
}
async function checkedCount() { return boxes().evaluateAll((list) => list.filter((b) => b.checked).length); }
async function outcomeFacts() {
  const t = await text(page.locator('.gcsp-summary-outcome'));
  return { heading: (await heading()).trim(), orderNumber: /Order number\s*:?\s*(\d+)/.exec(t)?.[1] ?? null, status: /Status\s*:?\s*([^\n]+)/.exec(t)?.[1]?.trim() ?? null,
    stages: await page.locator('.gcsp-stage-items li').allInnerTexts().then((l) => l.map((x) => clip(x, 80))),
    nextSteps: await page.locator('.gcsp-summary-steps li').allInnerTexts(), requestedCollection: clip(await sectionText('Requested collection'), 240),
    forbiddenWording: (t.match(/\b(approved|collected|booked)\b/gi) ?? []), rawIds: rawIdsIn(t), text: clip(t, 900) };
}
// A fresh in-memory host (new run) and a clean page in the same Chrome context.
async function freshHost() {
  const old = page; page = await context.newPage(); await old.close().catch(() => {});
  await app.stop(); await rm(join(scratch, 'gcsp-stock-inventory'), { recursive: true, force: true });
  app = await startHost(); await context.clearCookies(); halted = null;
}

async function walk72() {
  const only = env('ONLY') === 's10';
  // Segment 1: Paula, lost response, outcome, print, reload, finish.
  if (!only) {
  await reachGallery();
  await step('review-loaded', 'Review loaded (FUCQ-70 route)', async () => {
    await reviewFirstCar(); return { state: `${await heading()} | ${await countdownOf()}`, full: false, shot: false };
  }, { critical: true });

  await step('s01-summary', 'Tab+Enter on Continue to order review shows the summary', async (row) => {
    await toSummary();
    const t = await summaryText(); const h2 = await page.locator('.gcsp-summary-body h2').allInnerTexts();
    const f = { heading: await heading(), countdown: await countdown72(), sections: h2, rawIds: rawIdsIn(t), requestedWording: /Collection is requested, not a confirmed appointment/.test(t) && /Requested collection date/.test(t),
      vehicleHasPoints: /points/i.test(await text(page.locator('.gcsp-review-vehicle'))), allowance: /Monthly allowance/.test(t), returnInfo: /Returning car/.test(t) && /Expected return mileage/.test(t),
      contact: /Contact phone/.test(t) && /Contact email/.test(t), employeeDriver: /Name/.test(t) && /Licence number/.test(t), emDash: /—/.test(t) };
    const rawNode = await page.evaluate((id) => { const w = document.createTreeWalker(document.querySelector('.gcsp-summary-body'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.includes(id)) return `${n.parentElement.outerHTML}`.slice(0, 300); return null; }, 'insurance-group');
    row.detail = { ...f, rawIdElement: rawNode, text: clip(t, 1500) };
    kb('review', 'Tab reaches Continue to order review; Enter opens the order summary', f.heading === 'Review your order');
    const wanted = ['Your replacement order', 'Driver and licence', 'Points and contract', 'Collection', 'Contact and requirements', 'Car you are returning'];
    const ok = f.heading === 'Review your order' && /^Order review: \d+:\d{2} remaining$/.test(f.countdown) && wanted.every((w) => h2.includes(w)) && !f.rawIds.length && f.requestedWording
      && f.vehicleHasPoints && f.allowance && f.returnInfo && f.contact && f.employeeDriver && !f.emDash;
    return { pass: ok, state: `${f.heading} | ${f.countdown} | sections ${h2.join(', ')} | raw ids ${f.rawIds.join(',') || 'none'} | requested wording ${f.requestedWording}` };
  }, { critical: true });

  await step('s02-declaration-gating', 'Keyboard-only declarations gate Submit', async (row) => {
    const total = await boxes().count(); const labels = await declarationLabels();
    const initial = { checked: await checkedCount(), enabled: await submitButton().isEnabled() };
    for (let i = 0; i < total - 1; i += 1) { await tabTo(boxes().nth(i)); await page.keyboard.press('Space'); }
    const partial = { checked: await checkedCount(), enabled: await submitButton().isEnabled() };
    await tabTo(boxes().nth(total - 1)); await page.keyboard.press('Space');
    const full = { checked: await checkedCount(), enabled: await until(async () => submitButton().isEnabled(), { timeout: 5000, what: 'Submit enabled' }).catch(() => false) };
    row.detail = { total, labels, initial, partial, full, hint: clip(await text(page.locator('.gcsp-summary-body .gcsp-field-hint').last()), 120) };
    kb('summary', 'Space ticks each declaration; Submit enables only after the last', !initial.enabled && !partial.enabled && full.enabled === true);
    return { pass: total > 0 && !initial.enabled && !partial.enabled && full.enabled === true, state: `${total} declarations; Submit enabled: none ticked ${initial.enabled}, ${partial.checked}/${total} ticked ${partial.enabled}, all ticked ${full.enabled}; labels ${labels.join(' | ')}`, shotName: 's02-all-ticked' };
  });

  await step('s03-edit-details', 'Change contact or requirements returns to review; Continue returns to summary', async (row) => {
    const before = await checkedCount();
    await tabTo(page.getByRole('button', { name: 'Change contact or requirements' })); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 60000 });
    const area = page.locator('textarea[name="specialRequirements"]'); await area.waitFor({ timeout: 30000 });
    const note = 'Walkthrough edit'; await area.fill(note);
    await toSummary();
    const after = await checkedCount(); const contact = await sectionText('Contact and requirements');
    row.detail = { ticksBefore: before, ticksAfter: after, ticks: after === 0 ? 'reset' : after === before ? 'retained' : 'partial', editShown: contact.includes(note), submitEnabled: await submitButton().isEnabled() };
    return { pass: after === 0 && contact.includes(note), state: `ticks ${row.detail.ticks} (${before} before, ${after} after); edited note on summary ${contact.includes(note)}; Submit enabled ${row.detail.submitEnabled}` };
  });

  await step('s04-lost-response', 'Lost response: Submit shows could not confirm; Check order status finds the order; one POST', async (row) => {
    await tickAll();
    const posts0 = orderPosts.length; let reached = null;
    await page.route(ORDER_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const r = await route.fetch(); reached = { status: r.status(), body: clip(await r.text(), 160) }; } catch (e) { reached = { error: clip(e.message, 100) }; }
      return route.abort('failed');
    });
    try {
      await tabTo(submitButton()); await page.keyboard.press('Enter');
      await until(async () => /could not confirm whether your order was placed/.test(await summaryText()), { timeout: 30000, what: 'could-not-confirm notice' });
      const unconfirmed = { notice: clip(await text(page.locator('.gcsp-summary-body .gcsp-note').first()), 240), submitLabel: clip(await text(submitButton()), 60),
        statusButton: await page.getByRole('button', { name: 'Check order status' }).count() };
      row.screenshots.push(await shot('s04-could-not-confirm'));
      await page.unroute(ORDER_ROUTE);
      await page.getByRole('button', { name: 'Check order status' }).click(); await waitOutcome();
      const outcome = await outcomeFacts(); const posts = orderPosts.length - posts0; reviewedOrder = outcome.orderNumber;
      row.detail = { postsFromPage: posts, serverReceived: reached, unconfirmed, outcome: { heading: outcome.heading, orderNumber: outcome.orderNumber, status: outcome.status } };
      return { pass: posts === 1 && Boolean(reached?.status) && /could not confirm/.test(unconfirmed.notice) && unconfirmed.statusButton > 0 && /^\d{7}$/.test(outcome.orderNumber ?? ''),
        state: `page POSTs ${posts}; server answered ${JSON.stringify(reached)}; notice "${unconfirmed.notice}"; submit label "${unconfirmed.submitLabel}"; outcome "${outcome.heading}" order ${outcome.orderNumber}`, shotName: 's04-outcome-after-check' };
    } finally { await page.unroute(ORDER_ROUTE).catch(() => {}); }
  });

  await step('s05-outcome', 'Outcome: heading, 7-digit order number, status without approved/collected/booked, stages, next steps, requested collection', async (row) => {
    const o = await outcomeFacts(); row.detail = o;
    const ok = /^\d{7}$/.test(o.orderNumber ?? '') && Boolean(o.status) && !o.forbiddenWording.length && o.stages.length > 0 && o.nextSteps.length > 0 && /requested/i.test(o.requestedCollection);
    return { pass: ok, state: `${o.heading} | order ${o.orderNumber} | status ${o.status} | stages ${o.stages.join('; ')} | next ${o.nextSteps.join(' / ')} | forbidden words ${o.forbiddenWording.join(',') || 'none'}` };
  });

  await step('s06-print', 'Print media hides buttons and presenter controls', async (row) => {
    await page.emulateMedia({ media: 'print' });
    try {
      const hidden = await page.evaluate(() => {
        const info = (el) => el ? { display: getComputedStyle(el).display, wrapperDisplay: getComputedStyle(el.closest('.gcsp-print-hidden') ?? el).display, rects: el.getClientRects().length } : null;
        const btn = (name) => info([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name));
        return { finish: btn('Finish'), print: btn('Print order'), check: btn('Check order status'), presenter: info(document.querySelector('.gcsp-presenter-controls')),
          anyButtonVisible: [...document.querySelectorAll('.gcsp-summary-outcome button')].some((b) => b.getClientRects().length > 0) };
      });
      row.detail = hidden; row.screenshots.push(await shot('s06-print'));
      const gone = (x) => x === null || x.rects === 0 || x.wrapperDisplay === 'none';
      return { pass: gone(hidden.finish) && gone(hidden.print) && gone(hidden.presenter) && !hidden.anyButtonVisible, state: JSON.stringify(hidden), shot: false };
    } finally { await page.emulateMedia({ media: 'screen' }); }
  });

  await step('s08-finish', 'Finish returns to the account screen showing the order', async (row) => {
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 60000 });
    await wait(1000); const t = await bodyText(); const shown = reviewedOrder ? t.includes(reviewedOrder) : false;
    row.detail = { orderShown: shown, text: clip(t, 900) };
    return { pass: shown, state: `heading "${await heading()}"; order ${reviewedOrder} shown ${shown}; ${clip(t, 400)}` };
  });

  await step('s07-reload', 'Reload and reopen: same order, no second POST (run after Finish, which has no outcome to leave from afterwards)', async (row) => {
    const posts0 = orderPosts.length;
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('heading').first().waitFor({ timeout: 60000 });
    await until(async () => (await page.getByRole('button').count()) > 0, { what: 'account buttons' });
    await wait(4000);
    const resume = page.getByRole('button', { name: /Resume saved journey/ });
    const resumeOffered = await resume.count();
    const afterReload = { heading: await heading(), resumeOffered, buttons: await page.getByRole('button').evaluateAll((b) => b.map((x) => x.textContent.trim()).filter(Boolean).slice(0, 12)),
      orderShown: (await bodyText()).includes(reviewedOrder ?? '#none'), orderProgress: /Your order is in progress|View order progress/.test(await bodyText()),
      savedJourneyCard: clip((await bodyText()).match(/(Replacement|New order) journey saved[^]*?(start the permitted journey again\.|Resume saved journey)/)?.[0], 400) };
    if (resumeOffered) { await resume.first().click(); await until(async () => OUTCOME_H1.test((await heading()).trim()), { timeout: 60000, what: 'outcome after resume' }).catch(() => {}); }
    const reopened = OUTCOME_H1.test((await heading()).trim()); const o = reopened ? await outcomeFacts() : null; const posts = orderPosts.length - posts0;
    const claimOrder = await page.evaluate(async () => { const r = await fetch('/api/gcsp/manual/order', { credentials: 'same-origin' }); const j = await r.json(); return { status: r.status, operationState: j.value?.operationState, orderNumber: j.value?.selection?.stock?.orderNumber ?? null }; });
    row.detail = { afterReload, reopened, outcome: o && { heading: o.heading, orderNumber: o.orderNumber, status: o.status }, postsAfterReload: posts, serverStillHasOrder: claimOrder };
    return { pass: reopened && o.orderNumber === reviewedOrder && posts === 0, state: `after reload "${afterReload.heading}" [${afterReload.buttons.join(' | ')}]; Resume offered ${resumeOffered}; order progress on account ${afterReload.orderProgress}; reopened outcome ${reopened} order ${o?.orderNumber ?? 'none'} (expected ${reviewedOrder}); server GET order ${JSON.stringify(claimOrder)}; POSTs since reload ${posts}` };
  });

  }
  // Segment 2: nominated driver.
  if (!only) {
  await freshHost();
  await reachGallery({ driverLabel: 'Nominated: Casey (fictional)', tag: 'nom-' });
  await step('nom-review-loaded', 'Nominated run: review loaded', async () => {
    await reviewFirstCar(); return { state: `${await heading()} | ${await countdownOf()}`, full: false, shot: false };
  }, { critical: true });
  await step('s09-nominated-driver', 'Nominated driver: summary shows Casey and the driver declaration; submit gives an outcome', async (row) => {
    await toSummary();
    const driver = await sectionText('Driver and licence'); const labels = await declarationLabels();
    row.screenshots.push(await shot('s09-nominated-summary'));
    await tickAll(); await submitButton().click(); await waitOutcome();
    const o = await outcomeFacts(); const outDriver = await sectionText('Driver and licence');
    row.detail = { driverSection: clip(driver, 400), declarationLabels: labels, outcome: { heading: o.heading, orderNumber: o.orderNumber, status: o.status }, outcomeDriverSection: clip(outDriver, 400) };
    return { pass: /Casey/.test(driver) && labels.some((l) => /driver/i.test(l)) && /Casey/.test(outDriver) && /^\d{7}$/.test(o.orderNumber ?? ''),
      state: `driver section "${clip(driver, 200)}"; declarations ${labels.join(' | ')}; outcome "${o.heading}" order ${o.orderNumber} status ${o.status}`, shotName: 's09-nominated-outcome', shot: true };
  });

  }
  // Segment 3: expiry at the summary.
  if (!only) await freshHost();
  await reachGallery({ tag: 'exp-' });
  await step('exp-review-loaded', 'Expiry run: review loaded', async () => {
    await reviewFirstCar(); return { state: `${await heading()} | ${await countdownOf()}`, full: false, shot: false };
  }, { critical: true });
  await step('s10-expired-at-summary', 'Presenter ticks expire the order-review hold: Submit disabled, expiry message, Refresh stock', async (row) => {
    await toSummary(); await tickAll();
    const countdowns = [await countdown72()]; let ticks = 0;
    const expiredShown = async () => /Your reservation has expired|This deadline has passed/.test(await bodyText());
    while (ticks < 60 && !(await expiredShown())) {
      mark(`tick ${ticks + 1} start, countdown ${countdowns.at(-1)}`); await tick(); ticks += 1; mark(`tick ${ticks} end`);
      await until(expiredShown, { timeout: 6000, what: 'expiry' }).catch(() => {});
      countdowns.push(await countdown72());
    }
    await until(expiredShown, { timeout: 30000, what: 'expired message' });
    const snap = async () => ({ submitPresent: await submitButton().count(), submitDisabled: await submitButton().count() ? await submitButton().isDisabled() : null, refreshStock: await page.getByRole('button', { name: 'Refresh stock' }).count(),
      notice: clip(await text(page.locator('.gcsp-summary-body .gcsp-note').first()), 240), hint: clip(await text(page.locator('.gcsp-summary-body .gcsp-field-hint').last()), 120), heading: await heading(), countdown: await countdown72() });
    mark('expired text shown'); await wait(1000); const atExpiry = await snap();
    // The claim is re-read on presenter ticks, so give it a settle period, then one more tick if Refresh stock is still absent.
    await until(async () => page.getByRole('button', { name: 'Refresh stock' }).count(), { timeout: 8000, what: 'Refresh stock' }).catch(() => {});
    mark('settle end (8s after expiry)'); const afterSettle = await snap(); let extraTick = null;
    if (!afterSettle.refreshStock) { mark('extra tick start'); extraTick = await tick(); mark('extra tick end'); await until(async () => page.getByRole('button', { name: 'Refresh stock' }).count(), { timeout: 8000, what: 'Refresh stock' }).catch(() => {}); }
    mark('final settle end');
    const f = { ticks, countdowns: countdowns.slice(-6), atExpiry, afterSettle, extraTick, final: await snap() };
    row.detail = f; const fin = f.final;
    return { pass: (!fin.submitPresent || fin.submitDisabled) && /expired/.test(await bodyText()) && fin.refreshStock >= 1,
      state: `ticks ${ticks}; at expiry: notice "${atExpiry.notice}", Refresh stock ${atExpiry.refreshStock}; after settle${extraTick ? ' and one more tick' : ''}: Submit present ${Boolean(fin.submitPresent)} disabled ${fin.submitDisabled}, Refresh stock ${fin.refreshStock}, notice "${fin.notice}", hint "${fin.hint}"`, shotName: 's10-expired' };
  });
  report.orderPosts = orderPosts;
}

// ---- FUCQ-73: full manual journey (replacement and new order), states, keyboard, contrast, motion, print ----
const kbPress = async (locator) => { await tabTo(locator); await page.keyboard.press('Enter'); };
const enabledButton = (name) => page.locator('button:not([disabled])').filter({ hasText: name });
const EMPTY_TITLES = /No cars have been released yet|No cars are available|No released cars are visible to you yet/;
async function waitGalleryReady() {
  await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor({ timeout: 60000 });
  await until(async () => (await enabledButton('Review this car').count()) > 0 || EMPTY_TITLES.test(await bodyText()), { what: 'gallery cards or empty state' });
}
const galleryFacts = async () => ({ cards: await page.getByRole('button', { name: 'Review this car' }).count(), enabled: await enabledButton('Review this car').count(), status: clip(await text(page.locator('.vm-status')), 240) });
async function keyboardSubmitToOutcome(row, tag) {
  await toSummary();
  row.screenshots.push(await shot(`${tag}-summary-unticked`));
  const total = await boxes().count();
  for (let i = 0; i < total; i += 1) { await tabTo(boxes().nth(i)); await page.keyboard.press('Space'); }
  const ticked = await checkedCount(); const enabled = await until(async () => submitButton().isEnabled(), { timeout: 5000, what: 'Submit enabled' }).catch(() => false);
  row.screenshots.push(await shot(`${tag}-summary-ticked`));
  const posts0 = orderPosts.length;
  await kbPress(submitButton()); await waitOutcome();
  const o = await outcomeFacts(); reviewedOrder = o.orderNumber;
  return { total, ticked, enabled, posts: orderPosts.length - posts0, o };
}
async function printOutcome(row, tag) {
  await page.emulateMedia({ media: 'print' });
  try {
    const gone = await page.evaluate(() => { const vis = (el) => el.getClientRects().length > 0 && getComputedStyle(el.closest('.gcsp-print-hidden') ?? el).display !== 'none';
      return { buttonsVisible: [...document.querySelectorAll('.gcsp-summary-outcome button')].filter(vis).length, presenterVisible: [...document.querySelectorAll('.gcsp-presenter-controls')].filter(vis).length }; });
    row.screenshots.push(await shot(`${tag}-outcome-print`));
    return gone;
  } finally { await page.emulateMedia({ media: 'screen' }); }
}
const defect = (row, id, severity, fileGuess, text) => { const d = { id, severity, fileGuess, observedVsExpected: text, step: row.id, screenshot: row.screenshots.at(-1) ?? 'taken after the step' }; if (!report.defects.some((x) => x.id === id)) report.defects.push(d); };
const closeStrip = () => page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
async function finishToAccount() {
  await kbPress(page.getByRole('button', { name: 'Finish', exact: true }));
  await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 60000 });
  await wait(1200);
}

async function walkReplacement() {
  await step('rep-account', 'Demo key opens the account for Paula (Tab+Enter, keyboard only)', async () => {
    const typed = await enterAccessKey();
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    await wait(800);
    const hasReplace = await page.getByRole('button', { name: 'Choose a replacement' }).count();
    return { pass: typed && hasReplace > 0, state: await bodyText(), shotName: 'rep-account' };
  }, { critical: true });
  await step('rep-setup', 'Choose a replacement (Tab+Enter); setup saved with the nominated driver Casey', async () => {
    await kbPress(page.getByRole('button', { name: 'Choose a replacement' }));
    const chosen = await fillSetup('Nominated: Casey (fictional)', { keyboard: true });
    return { pass: /Casey/.test(chosen.driver), state: `${await heading()} | ${JSON.stringify(chosen)}`, detail: chosen, shotName: 'rep-setup-saved' };
  }, { critical: true });
  await step('rep-empty-gallery', 'Continue before any release: empty gallery states the next action', async (row) => {
    await until(async () => page.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), { what: 'Continue enabled after availability refresh' });
    await kbPress(page.getByRole('button', { name: 'Continue', exact: true }));
    await until(async () => EMPTY_TITLES.test(await bodyText()) || (await page.getByRole('button', { name: 'Review this car' }).count()) > 0, { what: 'empty gallery state' });
    const g = await galleryFacts(); row.detail = g;
    return { pass: EMPTY_TITLES.test(g.status) && g.cards === 0, state: `status "${g.status}"; cards ${g.cards}`, shotName: 'rep-gallery-empty' };
  }, { critical: true });
  await step('rep-release-gallery', 'Presenter Next release; Refresh availability (keyboard) shows released cars', async (row) => {
    const { after } = await presenterPress('Next release'); await closeStrip();
    const refresh = page.getByRole('button', { name: 'Refresh availability' });
    if (await refresh.count()) await kbPress(refresh);
    await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'released cards', timeout: 15000 }).catch(() => {});
    const g = await galleryFacts(); row.detail = { ...g, stockStatus: lastStock?.status };
    if (!g.enabled) defect(row, 'D1', 'Medium', 'blocks/gcsp/manual-gallery/gallery-controller.js (stock 400 mapping)', `After Next release the saved collection date left the window: GET stock answered ${lastStock?.status} invalid-manual-draft, and the gallery said "${g.status}". Expected a message that the collection date needs changing with a way to fix it; Refresh availability can never succeed.`);
    return { pass: g.enabled > 0, state: `${g.cards} cards, ${g.enabled} enabled; stock ${lastStock?.status}; status "${g.status}"; ${clip(after, 100)}`, shotName: 'rep-gallery-after-release' };
  });
  await step('rep-date-recovery', 'Back to your choices, pick a date in the new window, Save, Continue: released cars', async (row) => {
    if (!(await enabledButton('Review this car').count())) {
      await kbPress(page.getByRole('button', { name: 'Back to your choices' }));
      await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor({ timeout: 60000 });
      const date = page.locator('input[name="requestedCollectionDate"]');
      await until(async () => (await date.getAttribute('min')) && !(await date.isDisabled()), { what: 'refreshed collection window' });
      const w = { min: await date.getAttribute('min'), max: await date.getAttribute('max'), was: await date.inputValue() }; row.detail = w;
      await date.fill(w.min);
      await kbPress(page.getByRole('button', { name: 'Save choices' }));
      await until(async () => /Your choices are saved/.test(await bodyText()), { what: 'choices re-saved' });
      await until(async () => page.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), { what: 'Continue enabled' });
      await kbPress(page.getByRole('button', { name: 'Continue', exact: true }));
    }
    await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'released cards', timeout: 30000 });
    const g = await galleryFacts(); row.detail = { ...row.detail, ...g };
    return { pass: g.enabled > 0, state: `${g.cards} cards, ${g.enabled} enabled`, shotName: 'rep-gallery-released' };
  }, { critical: true });
  await step('rep-review', 'Review this car (Tab+Enter) opens the review with an active countdown', async (row) => {
    await kbPress(enabledButton('Review this car'));
    await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 60000 });
    await until(async () => /remaining/.test(await countdownOf()), { what: 'active countdown' });
    const f = await reviewFacts(); row.detail = f;
    return { pass: Boolean(f.vehicleName) && Boolean(f.phone), state: `${f.vehicleName} | ${f.countdown} | image caption ${f.hasRepresentativeCaption} placeholder ${f.noImagePlaceholder}`, shotName: 'rep-review' };
  }, { critical: true });
  await step('rep-final-review', 'Continue to order review, tick declarations (Space), Submit (Enter): outcome', async (row) => {
    const r = await keyboardSubmitToOutcome(row, 'rep');
    row.detail = { total: r.total, ticked: r.ticked, submitEnabled: r.enabled, posts: r.posts, outcome: { heading: r.o.heading, orderNumber: r.o.orderNumber, status: r.o.status, stages: r.o.stages, rawIds: r.o.rawIds } };
    return { pass: r.total > 0 && r.ticked === r.total && r.enabled === true && r.posts === 1 && /^\d{7}$/.test(r.o.orderNumber ?? '') && !r.o.forbiddenWording.length, state: `${r.o.heading} | order ${r.o.orderNumber} | status ${r.o.status}; POSTs ${r.posts}`, shotName: 'rep-outcome' };
  }, { critical: true });
  await step('rep-print', 'Print media: outcome keeps the order, hides buttons and presenter controls', async (row) => {
    const g = await printOutcome(row, 'rep'); row.detail = g;
    return { pass: g.buttonsVisible === 0 && g.presenterVisible === 0, state: JSON.stringify(g), shot: false };
  });
  await step('rep-finish', 'Finish (Tab+Enter) returns to the account, which shows the order', async (row) => {
    await finishToAccount(); const t0 = Date.now();
    await until(async () => (await bodyText()).includes(reviewedOrder ?? '#none'), { timeout: 30000, what: 'order number on the account' }).catch(() => {});
    const t = await bodyText(); const shown = reviewedOrder ? t.includes(reviewedOrder) : false;
    const stale = /Replacement journey saved|New order journey saved/.test(t) && /This is not an order confirmation/.test(t);
    row.detail = { orderShown: shown, shownAfterMs: Date.now() - t0, staleSavedJourneyCard: stale, text: clip(t, 700) };
    if (stale) defect(row, 'D2', 'Low', 'blocks/gcsp/account/gcsp-account.js (saved journey card)', 'After the order was received the account still showed the "Replacement journey saved ... This is not an order confirmation. Your saved context has changed ... start the permitted journey again" card beside "Your order is in progress". Expected the saved-journey card to be cleared or reworded once the order exists.');
    return { pass: shown, state: `order ${reviewedOrder} shown ${shown}; ${clip(t, 300)}`, shotName: 'rep-account-after-order' };
  });
}

// Switches the acting principal with the presenter strip, then reloads so the account shows that person's actions.
async function switchTo(principalId) {
  await openStrip();
  await page.locator(`.gcsp-presenter-controls [data-value="${principalId}"]`).first().click();
  await page.getByRole('button', { name: 'Switch principal' }).click();
  await wait(4000); await page.waitForLoadState('load').catch(() => {}); // the switch navigates to the new principal's account
  await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
  await until(async () => (await page.getByRole('button', { name: /Refresh account/ }).count()) > 0, { what: 'account buttons' }); await wait(1500);
  return { buttons: await page.getByRole('button').evaluateAll((b) => b.map((x) => x.textContent.trim()).filter(Boolean)), who: clip(await text(page.locator('.gcsp-shell-account, header').first()), 80) };
}
async function walkNewOrder() {
  await freshHost();
  let chosen = null; const tried = [{ principal: 'Paula', note: 'replacement journey (rep segment): Choose a replacement, no Start a new order' }];
  await step('new-principal', 'Find a fictional principal whose account offers Start a new order (Alex, Sam tried after Paula)', async (row) => {
    await enterAccessKey(); await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    for (const [id, label] of [['demo-alex', 'Alex'], ['demo-sam', 'Sam']]) {
      const r = await switchTo(id); const has = r.buttons.some((b) => /Start a new order/.test(b));
      const nav = await page.getByRole('button', { name: /New order/ }).first().evaluate((n) => ({ disabled: n.disabled, ariaDisabled: n.getAttribute('aria-disabled'), text: n.innerText.trim(), title: n.title })).catch(() => null);
      tried.push({ principal: label, actions: r.buttons.filter((b) => /Choose a replacement|Start a new order|Contact support/.test(b)), startNewOrder: has, sidebarNewOrder: nav, notice: clip((await bodyText()).match(/Ordering is not supported[^.]*\.|Replacement is unavailable[^.]*\./)?.[0], 120) });
      if (has && !chosen) { chosen = { id, label }; break; }
    }
    row.detail = { tried, chosen };
    if (!chosen) report.notes.push(`New-order journey not run: no fictional principal in the default scenario offers Start a new order. Tried ${JSON.stringify(tried.map((t) => [t.principal, t.actions ?? t.note]))}. Sam: Ordering is not supported for this scheme.`);
    return { pass: true, state: chosen ? `chosen ${chosen.label}` : `none offers Start a new order: ${JSON.stringify(tried)}`, shotName: 'new-account-sam' };
  }, { critical: true });
}

// ---- FUCQ-73 states: loading, outage, images, long data, motion, focus, contrast, pending, expired ----
const STOCK_ROUTE = /\/api\/gcsp\/manual\/stock(\?.*)?$/;
const CLAIM_READ_ROUTE = /\/api\/gcsp\/manual\/(claim|review-details)(\?.*)?$/;
const IMAGE_ROUTE = (url) => /\.(png|jpe?g|webp|avif)(\?.*)?$/i.test(url.pathname) || /\/images\//.test(url.pathname);
const continueButton = () => page.getByRole('button', { name: 'Continue', exact: true });
// Walks the saved journey back to a screen: reload, Resume saved journey, Continue on setup, Review this car on the gallery.
async function landOn(target, { reload = true } = {}) {
  if (reload) await page.reload({ waitUntil: 'load' });
  for (let i = 0; i < 8; i += 1) {
    const h = (await heading()).trim(); if (env('LOG')) console.error(`  landOn ${target}: h="${h}"`);
    if (h === target) return;
    if (h === 'Your cars') { const b = page.getByRole('button', { name: /Resume saved journey|Choose a replacement/ }); await until(async () => (await b.count()) > 0, { what: 'journey button', timeout: 20000 }); await kbPress(b.first()).catch(() => {}); }
    else if (h === 'Your order choices') { await until(async () => (await heading()).trim() !== 'Your order choices' || continueButton().isEnabled().catch(() => false), { what: 'Continue enabled or auto-advance' }); if ((await heading()).trim() === 'Your order choices') await kbPress(continueButton()); }
    else if (h === 'Released cars' && target === 'Review your car' && (await enabledButton('Review this car').count()) > 0) await kbPress(enabledButton('Review this car')); // an active claim moves on to its review by itself
    await wait(1500);
  }
  throw new Error(`Did not reach ${target}`);
}
// Longest computed transition or animation time (seconds) among rendered elements.
const motionMax = () => page.evaluate(() => {
  const secs = (v) => v.split(',').map((x) => { const n = parseFloat(x); return /ms$/.test(x.trim()) ? n / 1000 : n; });
  let max = 0; let who = null;
  for (const n of document.querySelectorAll('body *')) {
    if (!n.getClientRects().length) continue;
    const c = getComputedStyle(n);
    const animated = c.animationName !== 'none' ? secs(c.animationDuration) : [0];
    const t = Math.max(...secs(c.transitionDuration), ...animated);
    if (t > max) { max = t; who = `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)}`; }
  }
  return { maxSeconds: max, element: who };
});
async function motionCheck(stage) {
  const normal = await motionMax();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try { const reduced = await motionMax(); const row = { stage, normal, reduced, pass: reduced.maxSeconds <= 0.01 }; report.motion.push(row); return row; }
  finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
}
// WCAG contrast of every visible text element and the primary button; the lowest few are recorded.
const contrastIn = () => page.evaluate(() => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } } let base = [255, 255, 255]; for (const c of layers.reverse()) base = base.map((v, i) => c[i] * c[3] + v * (1 - c[3])); return base; };
  const ratio = (el) => { const bg = bgOf(el); const fg = rgba(getComputedStyle(el).color); const f = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])); const [a, b] = [lum(f), lum(bg)]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const rows = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[disabled],[aria-disabled="true"]') || el.disabled) continue;
    const c = getComputedStyle(el); if (c.visibility === 'hidden' || c.opacity === '0') continue;
    const size = parseFloat(c.fontSize); const large = size >= 24 || size >= 18.66 && Number(c.fontWeight) >= 700;
    rows.push({ el: `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`, text: el.textContent.trim().slice(0, 30), ratio: Math.round(ratio(el) * 100) / 100, large });
  }
  const primary = document.querySelector('.gcsp-review-body .vm-btn-primary:not([disabled])') ?? document.querySelector('.gcsp-summary-body .vm-btn-primary:not([disabled])') ?? document.querySelector('.vm-btn-primary:not([disabled])'); const ghost = document.querySelector('.vm-btn-ghost:not([disabled])');
  const bodyRatio = Math.round(ratio(document.querySelector('.gcsp-review-body, .gcsp-summary-body, main') ?? document.body) * 100) / 100;
  rows.sort((a, b) => a.ratio - b.ratio);
  const failing = rows.filter((r) => r.ratio < (r.large ? 3 : 4.5));
  return { bodyText: bodyRatio, primaryButton: primary ? { text: primary.textContent.trim(), ratio: Math.round(ratio(primary) * 100) / 100 } : null,
    ghostButton: ghost ? { text: ghost.textContent.trim(), ratio: Math.round(ratio(ghost) * 100) / 100 } : null, checked: rows.length, lowest: rows.slice(0, 4), belowThreshold: failing.slice(0, 6), failingCount: failing.length };
});
// Tabs through every control once; each stop must show an outline or box-shadow.
async function focusWalk(stage, { max = 70 } = {}) {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const stops = []; let first = null;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => { const a = document.activeElement; if (!a || a === document.body) return null; const c = getComputedStyle(a);
      return { id: `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''}`, name: (a.getAttribute('aria-label') || a.textContent || a.value || a.name || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        outline: `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}`, outlineVisible: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0, boxShadow: c.boxShadow === 'none' ? null : c.boxShadow.slice(0, 60) }; });
    if (!info) break;
    const key = `${info.id}|${info.name}`; if (first === key) break; if (!first) first = key;
    stops.push({ ...info, visibleIndicator: info.outlineVisible || Boolean(info.boxShadow) });
  }
  const missing = stops.filter((x) => !x.visibleIndicator);
  const row = { stage, stops: stops.length, missingIndicator: missing.map((m) => `${m.id} "${m.name}"`), sample: stops.slice(0, 3).map((x) => `${x.id} "${x.name}" ${x.outline}`), pass: stops.length > 0 && !missing.length };
  report.focus.push(row); return row;
}
const imageHits = []; const imageRoute = async (route) => { imageHits.push(bare(route.request().url()).replace(/^https?:\/\/[^/]+/, '')); await route.fulfill({ status: 404, body: '' }); };
const IMAGE_GLOB = (url) => IMAGE_ROUTE(url);
// Offline stock carries no photo, so responses are patched to point every car at a missing /images/ file that the 404 route then refuses.
const PHOTO = '/images/gcsp-missing-car.jpg';
const withPhotos = (node) => { if (Array.isArray(node)) node.forEach(withPhotos); else if (node && typeof node === 'object') { if (node.display && typeof node.display === 'object' && typeof node.display.name === 'string') { node.display.photo = PHOTO; node.display.images = [{ src: PHOTO, alt: node.display.name, caption: 'Representative image. See image provenance in vehicle details.' }]; patched.count += 1; } Object.values(node).forEach(withPhotos); } return node; };
const patched = { count: 0 };
const photoRoute = async (route) => { if (route.request().method() !== 'GET') return route.continue(); const r = await route.fetch(); const json = await r.json().catch(() => null); if (!json) return route.fulfill({ response: r }); return route.fulfill({ response: r, json: withPhotos(json) }); };
async function layoutFacts(selector) {
  return page.evaluate((sel) => { const root = document.querySelector(sel) ?? document.body; const wide = [...root.querySelectorAll('*')].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === 'visible').slice(0, 4).map((n) => `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)}`);
    return { docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, wideElements: wide, images: root.querySelectorAll('img').length, brokenImages: [...root.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length,
      fallbackText: [...root.querySelectorAll('*')].filter((n) => /No image for this car yet|Image unavailable|could not be loaded/i.test(n.textContent) && n.children.length === 0).length }; }, selector);
}

async function walkStates() {
  await freshHost();
  await reachGallery({ tag: 'st-' });
  await closeStrip();
  // Loading and outage: the saved journey is reopened with the stock read delayed, then refused.
  await step('st-gallery-loading', 'GET stock delayed 3 s: gallery shows a loading status, then the cars', async (row) => {
    await page.route(STOCK_ROUTE, async (route) => { if (route.request().method() !== 'GET') return route.continue(); await wait(3000); return route.continue(); });
    try {
      await page.reload({ waitUntil: 'load' });
      await until(async () => (await heading()).trim() === 'Your cars', { what: 'account' });
      const b = page.getByRole('button', { name: /Resume saved journey/ }); await until(async () => (await b.count()) > 0, { what: 'resume button' }); await kbPress(b.first());
      let seenLoading = false;
      const clicker = (async () => { for (let i = 0; i < 80 && !seenLoading; i += 1) { if ((await heading()).trim() === 'Your order choices' && await continueButton().isEnabled().catch(() => false)) { await continueButton().click().catch(() => {}); return; } await wait(300); } })();
      await page.getByText('Loading released cars').first().waitFor({ state: 'visible', timeout: 40000 }); seenLoading = true; await clicker;
      row.screenshots.push(await shot('st-gallery-loading')); const shotName = true;
      row.detail = { loadingText: clip(await text(page.locator('.vm-status')), 160), heading: (await heading()).trim() };
      await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'cards after delay', timeout: 60000 });
      return { pass: Boolean(shotName), state: `loading text seen ${Boolean(shotName)}; ${clip(row.detail?.loadingText, 100)}; cards loaded after the delay`, shot: false };
    } finally { await page.unroute(STOCK_ROUTE).catch(() => {}); }
  }, { critical: true });

  await step('st-setup-outage', 'GET stock answers 503 on the way to the gallery: outage state with a recovery button; unroute and recover', async (row) => {
    await page.reload({ waitUntil: 'load' });
    await until(async () => (await heading()).trim() === 'Your cars', { what: 'account' });
    const b = page.getByRole('button', { name: /Resume saved journey/ }); await until(async () => (await b.count()) > 0, { what: 'resume button' }); await kbPress(b.first());
    await until(async () => (await heading()).trim() === 'Your order choices' || /Released cars/.test(await heading()), { what: 'setup or gallery' });
    if ((await heading()).trim() === 'Your order choices') await until(async () => continueButton().isEnabled(), { what: 'Continue enabled' });
    let routed = 0;
    await page.route(STOCK_ROUTE, (route) => { if (route.request().method() !== 'GET') return route.continue(); routed += 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', retryable: true }) }); });
    try {
      let where = 'gallery';
      if ((await heading()).trim() === 'Your order choices') {
        await kbPress(continueButton()); await wait(3000);
        where = /Availability cannot be checked right now/.test(await bodyText()) ? 'gallery' : 'setup';
      } else { const r = page.getByRole('button', { name: 'Refresh availability' }); if (await r.count()) await kbPress(r); await wait(2000); }
      const body = await bodyText();
      const outage = { where, heading: (await heading()).trim(), galleryStatus: clip(await text(page.locator('.vm-status')), 200), setupNotice: clip((body.match(/Availability could not be refreshed[^]*?Retry availability/) ?? [''])[0], 200), routed,
        recoveryButtons: await page.getByRole('button', { name: /Refresh availability|Retry availability/ }).allInnerTexts() };
      row.screenshots.push(await shot(`st-outage-${where}`));
      await page.unroute(STOCK_ROUTE);
      await kbPress(page.getByRole('button', { name: /Refresh availability|Retry availability/ }));
      await until(async () => (await heading()).trim() === 'Released cars' || (await enabledButton('Review this car').count()) > 0 || continueButton().isEnabled().catch(() => false), { timeout: 30000, what: 'recovery' });
      if ((await heading()).trim() === 'Your order choices') { await until(async () => continueButton().isEnabled(), { what: 'Continue enabled' }); await kbPress(continueButton()); }
      await until(async () => (await enabledButton('Review this car').count()) > 0, { timeout: 30000, what: 'recovered cards' });
      row.detail = { outage, recoveredCards: await enabledButton('Review this car').count() };
      return { pass: outage.recoveryButtons.length >= 1 && (/Retry/.test(outage.galleryStatus) || Boolean(outage.setupNotice)), state: `${where}: "${outage.galleryStatus || outage.setupNotice}"; recovery buttons ${outage.recoveryButtons.join(' | ')}; recovered ${row.detail.recoveredCards} cards`, shot: false };
    } finally { await page.unroute(STOCK_ROUTE).catch(() => {}); }
  });

  await step('st-gallery-outage', 'GET stock answers 503 on the gallery (presenter tick re-reads): outage status with Refresh availability; recovers', async (row) => {
    await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'gallery cards' });
    await page.route(STOCK_ROUTE, (route) => { if (route.request().method() !== 'GET') return route.continue(); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', retryable: true }) }); });
    try {
      await tick(); await closeStrip();
      await until(async () => /Availability cannot be checked right now/.test(await bodyText()), { timeout: 30000, what: 'gallery outage' });
      const status = clip(await text(page.locator('.vm-status')), 200); const buttons = await page.getByRole('button', { name: 'Refresh availability' }).count();
      row.screenshots.push(await shot('st-gallery-outage'));
      await page.unroute(STOCK_ROUTE);
      await kbPress(page.getByRole('button', { name: 'Refresh availability' }));
      await until(async () => (await enabledButton('Review this car').count()) > 0, { timeout: 30000, what: 'recovered cards' });
      row.detail = { status, refreshButtons: buttons, recoveredCards: await enabledButton('Review this car').count() };
      return { pass: buttons === 1 && /Retry/.test(status), state: `"${status}"; Refresh availability buttons ${buttons}; recovered ${row.detail.recoveredCards} cards`, shot: false };
    } finally { await page.unroute(STOCK_ROUTE).catch(() => {}); }
  });

  await step('st-gallery-images', 'Every image request 404s on the gallery: fallback text, layout intact, no overflow', async (row) => {
    imageHits.length = 0; patched.count = 0; await page.route(IMAGE_GLOB, imageRoute); await page.route(STOCK_ROUTE, photoRoute);
    try {
      await landOn('Released cars'); await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'cards' });
      // Lazy images load (and fail) as they scroll in, so sweep the page until no card still holds a photo.
      for (let pass = 0; pass < 3 && (await page.locator('.vm-card-media.has-photo').count()); pass += 1) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += 400) { await page.evaluate((v) => window.scrollTo(0, v), y); await wait(150); }
        await wait(1500);
      }
      await page.evaluate(() => window.scrollTo(0, 0)); await wait(800);
      const l = await layoutFacts('main, body'); const wells = await page.evaluate(() => ({ cards: document.querySelectorAll('.vm-card-media').length, withPhotoClass: document.querySelectorAll('.vm-card-media.has-photo').length, photoImgs: document.querySelectorAll('img.vm-card-photo').length }));
      row.detail = { ...l, ...wells, stockResponsesPatched: patched.count, imageRequestsRouted404: imageHits.length, sampleRequests: imageHits.slice(0, 2), placeholders: await page.getByText('No image for this car yet').count() };
      return { pass: l.docOverflow === 0 && imageHits.length > 0 && wells.withPhotoClass === 0 && wells.photoImgs === 0, state: `photo URLs injected ${patched.count}; image requests 404ed ${imageHits.length}; cards ${wells.cards}, still showing a photo ${wells.withPhotoClass}; fallback texts ${row.detail.placeholders}; overflow ${l.docOverflow}`, shotName: 'st-gallery-images-404' };
    } finally { await page.unroute(IMAGE_GLOB).catch(() => {}); await page.unroute(STOCK_ROUTE).catch(() => {}); }
  });

  await step('st-gallery-motion', 'Gallery under prefers-reduced-motion', async (row) => {
    const m = await motionCheck('gallery'); row.detail = m; return { pass: m.pass, state: JSON.stringify(m), shot: false };
  });

}

async function walkStatesB() {
  await freshHost();
  await reachGallery({ tag: 'stb-' });
  await closeStrip();
  await step('st-review-loading', 'GET claim/review-details delayed 3 s: review shows a loading state, then the car', async (row) => {
    let delayed = 0; const matcher = CLAIM_READ_ROUTE;
    await page.route(matcher, async (route) => { if (route.request().method() !== 'GET') return route.continue(); delayed += 1; await wait(3000); return route.continue(); });
    try {
      await kbPress(enabledButton('Review this car'));
      const seen = []; let shotTaken = false;
      for (let i = 0; i < 24 && !shotTaken; i += 1) { const t = await bodyText(); seen.push(clip(await heading(), 40)); if (/Review your car/.test(await heading()) || /Reserving|Checking|Loading/i.test(t) && delayed > 0) { row.screenshots.push(await shot('st-review-loading')); shotTaken = true; row.detail = { heading: await heading(), status: clip(await text(page.locator('.gcsp-review-body, .vm-status, [role=status]').first()), 200), countdown: await countdownOf() }; } await wait(200); }
      await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 60000 });
      if (!/remaining/.test(await countdownOf())) row.screenshots.push(await shot('st-review-loading-review-page'));
      await until(async () => /remaining/.test(await countdownOf()), { timeout: 60000, what: 'active countdown after delay' });
      row.detail = { ...row.detail, delayedReads: delayed, headingsSeen: [...new Set(seen)] };
      return { pass: shotTaken && delayed > 0, state: `delayed claim reads ${delayed}; loading state ${JSON.stringify(row.detail)}`, shot: false };
    } finally { await page.unroute(matcher).catch(() => {}); }
  }, { critical: true });

  await step('st-review-images', 'Every image request 404s on the review: fallback text, layout intact', async (row) => {
    imageHits.length = 0; patched.count = 0; await page.route(IMAGE_GLOB, imageRoute); await page.route(CLAIM_READ_ROUTE, photoRoute);
    try {
      await landOn('Review your car'); await until(async () => /remaining/.test(await countdownOf()), { what: 'active countdown' }); await wait(1500);
      const l = await layoutFacts('.gcsp-review-body'); const f = await reviewFacts();
      const wells = await page.evaluate(() => ({ withPhotoClass: document.querySelectorAll('.vm-card-media.has-photo').length, photoImgs: document.querySelectorAll('img.vm-card-photo').length }));
      row.detail = { ...l, ...wells, responsesPatched: patched.count, imageRequestsRouted404: imageHits.length, noImagePlaceholder: f.noImagePlaceholder, caption: f.hasRepresentativeCaption };
      return { pass: l.docOverflow === 0 && wells.withPhotoClass === 0 && wells.photoImgs === 0 && f.noImagePlaceholder, state: `photo URLs injected ${patched.count}; image requests 404ed ${imageHits.length}; still showing a photo ${wells.withPhotoClass}; placeholder ${f.noImagePlaceholder}; overflow ${l.docOverflow}`, shotName: 'st-review-images-404' };
    } finally { await page.unroute(IMAGE_GLOB).catch(() => {}); await page.unroute(CLAIM_READ_ROUTE).catch(() => {}); }
  }, { critical: true });

  await step('st-review-a11y', 'Review: reduced motion, Tab focus indicators, contrast', async (row) => {
    const m = await motionCheck('review'); const f = await focusWalk('review'); const c = await contrastIn(); report.contrast.push({ stage: 'review', ...c });
    row.detail = { motion: m, focus: f, contrast: c };
    return { pass: m.pass && f.pass && c.bodyText >= 4.5 && (c.primaryButton?.ratio ?? 0) >= 4.5 && !c.failingCount, state: `motion max ${m.reduced.maxSeconds}s reduced; focus stops ${f.stops}, missing ${f.missingIndicator.length}; body ${c.bodyText}; primary ${c.primaryButton?.ratio}; below threshold ${c.failingCount}`, shot: false };
  });

  await step('st-review-long-data', '500 characters of unbroken words in Special requirements: no overflow on review and final review', async (row) => {
    const area = page.locator('textarea[name="specialRequirements"]'); const word = 'Unbroken'.repeat(12);
    await area.click(); await area.fill(''); await area.fill(Array(6).fill(word).join(' ').slice(0, 500));
    await page.keyboard.press('Tab'); const len = await area.evaluate((e) => e.value.length);
    const onReview = await layoutFacts('.gcsp-review-body'); row.screenshots.push(await shot('st-review-long-data'));
    await toSummary(); await wait(500);
    const onSummary = await layoutFacts('.gcsp-summary-body');
    row.detail = { length: len, onReview, onSummary, shownOnSummary: (await sectionText('Contact and requirements')).includes(word.slice(0, 40)) };
    return { pass: len === 500 && onReview.docOverflow === 0 && onSummary.docOverflow === 0 && !onSummary.wideElements.length && !onReview.wideElements.length, state: `typed ${len}; review overflow ${onReview.docOverflow}, wide ${onReview.wideElements.join(',') || 'none'}; final review overflow ${onSummary.docOverflow}, wide ${onSummary.wideElements.join(',') || 'none'}`, shotName: 'st-final-review-long-data' };
  }, { critical: true });

  await step('st-summary-a11y', 'Final review: reduced motion, Tab focus indicators, contrast', async (row) => {
    const m = await motionCheck('final review'); const f = await focusWalk('final review'); const c = await contrastIn(); report.contrast.push({ stage: 'final review', ...c });
    row.detail = { motion: m, focus: f, contrast: c };
    return { pass: m.pass && f.pass && c.bodyText >= 4.5 && (c.primaryButton?.ratio ?? 0) >= 4.5 && !c.failingCount, state: `motion max ${m.reduced.maxSeconds}s reduced; focus stops ${f.stops}, missing ${f.missingIndicator.length}; body ${c.bodyText}; primary ${c.primaryButton?.ratio}; below threshold ${c.failingCount}`, shot: false };
  });

  await step('st-pending', 'Lost response: one POST, could-not-confirm notice, Check order status recovers the order', async (row) => {
    await tickAll(); const posts0 = orderPosts.length; let reached = null;
    await page.route(ORDER_ROUTE, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      try { const r = await route.fetch(); reached = { status: r.status(), body: clip(await r.text(), 120) }; } catch (e) { reached = { error: clip(e.message, 100) }; }
      return route.abort('failed');
    });
    try {
      await kbPress(submitButton());
      await until(async () => /could not confirm whether your order was placed/.test(await summaryText()), { timeout: 30000, what: 'could-not-confirm notice' });
      const notice = clip(await text(page.locator('.gcsp-summary-body .gcsp-note').first()), 240); const statusButton = await page.getByRole('button', { name: 'Check order status' }).count();
      row.screenshots.push(await shot('st-pending-could-not-confirm'));
      await page.unroute(ORDER_ROUTE);
      await kbPress(page.getByRole('button', { name: 'Check order status' })); await waitOutcome();
      const o = await outcomeFacts(); const posts = orderPosts.length - posts0; reviewedOrder = o.orderNumber;
      row.detail = { postsFromPage: posts, serverReceived: reached, notice, outcome: { heading: o.heading, orderNumber: o.orderNumber, status: o.status } };
      return { pass: posts === 1 && Boolean(reached?.status) && statusButton > 0 && /^\d{7}$/.test(o.orderNumber ?? ''), state: `POSTs ${posts}; server answered ${JSON.stringify(reached)}; notice "${notice}"; outcome "${o.heading}" ${o.orderNumber}`, shotName: 'st-pending-outcome' };
    } finally { await page.unroute(ORDER_ROUTE).catch(() => {}); }
  });
}

async function walkExpired() {
  await freshHost();
  await reachGallery({ tag: 'exp-' }); await closeStrip();
  await step('exp-review-loaded', 'Expiry run: review loaded', async () => { await reviewFirstCar(); return { state: `${await heading()} | ${await countdownOf()}`, shot: false }; }, { critical: true });
  await step('exp-expired', 'Presenter ticks expire the hold at the final review: expiry message, Submit disabled, Refresh stock', async (row) => {
    await toSummary(); await tickAll();
    let ticks = 0; const expiredShown = async () => /Your reservation has expired|This deadline has passed/.test(await bodyText());
    while (ticks < 60 && !(await expiredShown())) { await tick(); ticks += 1; await until(expiredShown, { timeout: 6000, what: 'expiry' }).catch(() => {}); }
    await until(expiredShown, { timeout: 30000, what: 'expired message' });
    await until(async () => page.getByRole('button', { name: 'Refresh stock' }).count(), { timeout: 12000, what: 'Refresh stock' }).catch(() => {});
    if (!(await page.getByRole('button', { name: 'Refresh stock' }).count())) { await tick(); await until(async () => page.getByRole('button', { name: 'Refresh stock' }).count(), { timeout: 8000, what: 'Refresh stock' }).catch(() => {}); }
    await closeStrip();
    const f = { ticks, submitPresent: await submitButton().count(), submitDisabled: (await submitButton().count()) ? await submitButton().isDisabled() : null, refreshStock: await page.getByRole('button', { name: 'Refresh stock' }).count(),
      notice: clip(await text(page.locator('.gcsp-summary-body .gcsp-note').first()), 240), hint: clip(await text(page.locator('.gcsp-summary-body .gcsp-field-hint').last()), 120) };
    row.detail = f;
    return { pass: (!f.submitPresent || f.submitDisabled) && f.refreshStock >= 1, state: `ticks ${ticks}; notice "${f.notice}"; hint "${f.hint}"; Submit present ${Boolean(f.submitPresent)} disabled ${f.submitDisabled}; Refresh stock ${f.refreshStock}`, shotName: 'exp-expired' };
  });
}

// The retail demo pages and the GCSP component gallery are static files: served here by a throwaway server on the chunk's sibling port.
async function startStatic(staticPort) {
  const root = resolve(HERE, '../../../..'); const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname); const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root) || /\/(\.git|node_modules|server)\//.test(file)) { res.writeHead(404); return res.end(); }
    try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(data); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((done) => server.listen(staticPort, '127.0.0.1', done));
  return { origin: `http://127.0.0.1:${staticPort}`, stop: () => new Promise((done) => server.close(done)) };
}
async function walkAdjacent() {
  const paths = ['/', '/block.html?brand=bmw', '/components.html'];
  await step('adj-hosted-entry', 'Same origin as the GCSP host: which retail and gallery pages it serves', async (row) => {
    const out = []; for (const path of paths) { const r = await page.request.get(`${origin}${path}`, { failOnStatusCode: false }).catch(() => null); out.push({ path, status: r?.status() ?? null }); }
    row.detail = out; return { pass: true, state: `${JSON.stringify(out)} (401 or 404: not served by the hosted GCSP entry)`, shot: false };
  });
  const staticPort = port === 8936 ? 8937 : 8936; const stat = await startStatic(staticPort);
  try {
    await page.route((url) => url.origin !== stat.origin && url.origin !== origin, (route) => route.abort('blockedbyclient')); // no live retail feeds
    for (const path of paths) {
      await step(`adj-${path === '/' ? 'home' : path.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '')}`, `Static ${path} (retail demo picker, block harness, GCSP component gallery)`, async (row) => {
        const errs0 = report.consoleErrors.length; const fails0 = report.failedRequests.length;
        const resp = await page.goto(`${stat.origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await wait(2000);
        const info = { path, status: resp?.status(), title: await page.title(), h1: clip(await heading(), 80), consoleErrors: report.consoleErrors.slice(errs0).map((e) => clip(`${e.text} @ ${e.url.replace(stat.origin, '')}`, 140)),
          blockedExternal: report.failedRequests.slice(fails0).filter((f) => /BLOCKED_BY_CLIENT/i.test(f.error ?? '')).length };
        row.detail = info;
        return { pass: info.status === 200 && Boolean(info.title), state: JSON.stringify(info), shotName: `adj-static-${path === '/' ? 'home' : path.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '')}` };
      });
    }
  } finally { await stat.stop(); }
}

async function walk73() {
  const want = (id) => !env('ONLY') || env('ONLY').split(',').includes(id);
  if (want('rep')) await walkReplacement();
  if (want('new')) await walkNewOrder();
  if (want('st')) await walkStates();
  if (want('stb')) await walkStatesB();
  if (want('exp')) await walkExpired();
  if (want('adj')) await walkAdjacent();
}

// FUCQ-145: after an account Resume, keyboard focus must land on the final review heading, never rest on BODY.
const FOCUS_POLL = () => {
  const fp = window.__fp = { samples: [], enterAt: null };
  const read = () => {
    const a = document.activeElement; const h = document.querySelector('main h1'); const c = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue to order review');
    return { t: Math.round(performance.now() * 10) / 10, tag: a ? a.tagName : 'NONE', text: a && a.tagName !== 'BODY' ? (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '', main1: Boolean(a && a.matches('main h1')),
      h1: h ? h.textContent.trim() : null, ready: Boolean(h && h.textContent.trim() === 'Review your car' && c && !c.disabled && c.getAttribute('aria-disabled') !== 'true') };
  };
  fp.id = setInterval(() => fp.samples.push(read()), 25);
};
const activeFacts = () => page.evaluate(() => {
  const a = document.activeElement; const cs = getComputedStyle(a);
  return { tag: a.tagName, text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), insideMain: Boolean(a.closest('main')), isMainH1: a.matches('main h1'), tabindex: a.getAttribute('tabindex'),
    outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, boxShadow: cs.boxShadow, focusVisible: a.matches(':focus-visible') };
});
function analyse(samples, enterAt) {
  const seq = []; for (const s of samples) { const key = `${s.tag}|${s.text}`; if (seq.at(-1)?.key !== key) seq.push({ key, tag: s.tag, text: s.text, atMs: Math.round(s.t - enterAt) }); }
  const after = samples.filter((s) => s.t >= enterAt);
  const firstAt = (fn) => samples.find(fn)?.t ?? null;
  const renderedAt = firstAt((s) => s.h1 === 'Review your car'); const readyAt = firstAt((s) => s.ready);
  const bodyAfter = (from) => (from === null ? null : samples.filter((s) => s.t >= from && s.tag === 'BODY').length);
  let maxBodyMs = 0; let run = null;
  for (const s of after) { if (s.tag === 'BODY') run ??= s.t; else if (run !== null) { maxBodyMs = Math.max(maxBodyMs, s.t - run); run = null; } }
  if (run !== null) maxBodyMs = Math.max(maxBodyMs, after.at(-1).t - run + 25);
  return { sampleCount: samples.length, transitionSequence: seq.filter((x) => x.atMs >= 0).map(({ tag, text, atMs }) => ({ tag, text, atMs })), tabPathSequence: seq.filter((x) => x.atMs < 0).map(({ tag, text }) => ({ tag, text })),
    renderedAtMs: renderedAt === null ? null : Math.round(renderedAt - enterAt), readyAtMs: readyAt === null ? null : Math.round(readyAt - enterAt),
    focusOnHeadingAtMs: (() => { const h = samples.find((s) => s.t >= enterAt && s.main1 && s.text === 'Review your car'); return h ? Math.round(h.t - enterAt) : null; })(),
    bodySamplesAfterRender: bodyAfter(renderedAt), bodySamplesAfterReady: bodyAfter(readyAt), maxBodyMsDuringTransition: Math.round(maxBodyMs) };
}
const accountResume = () => page.getByRole('button', { name: /Resume saved journey/ });
async function reloadToAccount(n) {
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 60000 });
  await until(async () => (await accountResume().count()) > 0, { what: 'Resume saved journey button' });
  return { state: `reload ${n}: heading "${await heading()}"; Resume saved journey offered`, shotName: `reload-${n}-account-resume`, full: false };
}
async function resumeAndWatch(n, row) {
  await page.evaluate(FOCUS_POLL);
  const before = await activeFacts(); const hops = await tabTo(accountResume());
  await page.evaluate(() => { window.__fp.enterAt = performance.now(); });
  await page.keyboard.press('Enter');
  await until(async () => (await page.locator('main h1').first().innerText().catch(() => '')).trim() === 'Review your car' && await page.getByRole('button', { name: 'Continue to order review' }).isEnabled().catch(() => false), { timeout: 60000, what: 'final review rendered, Continue enabled' });
  await wait(600);
  const { samples, enterAt } = await page.evaluate(() => { clearInterval(window.__fp.id); return window.__fp; });
  const final = await activeFacts(); const a = analyse(samples, enterAt);
  const ok = final.isMainH1 && final.text === 'Review your car' && a.bodySamplesAfterRender === 0;
  row.detail = { focusBeforeTab: `${before.tag} "${before.text}"`, tabPresses: hops, final, ...a };
  kb('review', `Resume ${n}: Enter on Resume saved journey leaves focus on the main h1 "Review your car"`, ok, { final: `${final.tag} "${final.text}"`, bodyAfterRender: a.bodySamplesAfterRender, maxBodyMs: a.maxBodyMsDuringTransition });
  return { pass: ok, state: `resume ${n}: focus before Tab ${before.tag}, ${hops} Tab presses; final ${final.tag} "${final.text}" (main h1 ${final.isMainH1}); BODY samples after render ${a.bodySamplesAfterRender}, after ready ${a.bodySamplesAfterReady}; max BODY ${a.maxBodyMsDuringTransition} ms; sequence ${a.transitionSequence.map((x) => `${x.tag}${x.text ? ` "${x.text}"` : ''}`).join(' > ')}`, shotName: `resume-${n}-review-focus`, full: false };
}
async function walk145() {
  await reachGallery();
  await step('claim-review', 'Review this car: a claim exists and the review is shown', async () => {
    await reviewFirstCar(); const hold = (await claimNow()).hold;
    return { pass: hold?.state === 'active', state: `${await heading()} | ${await countdownOf()} | claim ${hold?.state}`, shotName: 'review-claimed', full: false };
  }, { critical: true });
  await step('reload-1-account', 'Reload: Your cars shows Resume saved journey', () => reloadToAccount(1), { critical: true });
  await step('resume-1-focus', 'Keyboard Resume: focus ends on the review heading, never BODY after render', (row) => resumeAndWatch(1, row), { critical: true });
  await step('tab-after-heading', 'Tab then Shift+Tab from the heading', async (row) => {
    await page.keyboard.press('Tab'); await wait(200);
    const next = await activeFacts();
    const expected = await page.evaluate(() => { const h = document.querySelector('main h1'); const sel = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
      const f = [...document.querySelectorAll(sel)].find((el) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && el.getClientRects().length); return f ? (f.innerText || f.getAttribute('aria-label') || f.name || f.tagName).replace(/\s+/g, ' ').trim().slice(0, 60) : null; });
    row.screenshots.push(await shot('tab-1-first-control', false));
    await page.keyboard.press('Shift+Tab'); await wait(200);
    const back = await activeFacts();
    row.screenshots.push(await shot('shift-tab-back', false));
    row.detail = { tab: next, firstFocusableAfterHeading: expected, shiftTab: back };
    const visible = next.focusVisible && (/^(solid|auto)/.test(next.outline) && !/ 0px /.test(next.outline) || next.boxShadow !== 'none');
    kb('review', 'Tab moves from the heading to the first control after it, with a visible focus ring', visible && next.text === expected, { tab: `${next.tag} "${next.text}"`, expected, shiftTab: `${back.tag} "${back.text}"` });
    return { pass: visible && next.text === expected, state: `Tab: ${next.tag} "${next.text}" outline [${next.outline}] shadow [${next.boxShadow}] (first after heading "${expected}"); Shift+Tab: ${back.tag} "${back.text}" main h1 ${back.isMainH1}`, shot: false };
  });
  await step('reload-2-account', 'Second reload: Your cars shows Resume saved journey', () => reloadToAccount(2), { critical: true });
  await step('resume-2-focus', 'Second keyboard Resume: same focus result (stable)', (row) => resumeAndWatch(2, row));
  await step('errors', 'No page errors; only expected 404s in console and responses', async (row) => {
    const bad = report.badResponses.filter((r) => r.status !== 404); const con = report.consoleErrors.filter((c) => !/404|favicon/i.test(`${c.text} ${c.url}`)); const failed = report.failedRequests.filter((f) => f.error !== 'net::ERR_ABORTED'); // reload aborts in-flight reads
    row.detail = { pageErrors: report.pageErrors, consoleErrors: report.consoleErrors, badResponses: report.badResponses.map((r) => `${r.status} ${r.url}`), failedRequests: report.failedRequests };
    return { pass: !report.pageErrors.length && !bad.length && !con.length && !failed.length, state: `page errors ${report.pageErrors.length}; console errors ${report.consoleErrors.length} (unexpected ${con.length}); HTTP >=400: ${report.badResponses.map((r) => `${r.status} ${r.url}`).join(', ') || 'none'}; failed requests ${report.failedRequests.length} (${failed.length} other than aborted)`, shot: false };
  });
}

// FUCQ-222: after Next release passes the saved date, the gallery offers one Back to your choices; keyboard recovery to released cars.
const statusButtons = () => page.locator('.vm-status button').evaluateAll((list) => list.map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
async function walk222() {
  await step('access-key', 'Demo key form opens the offline hosted demo', async () => {
    const typed = await enterAccessKey();
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    return { pass: typed, state: await bodyText(), shot: false };
  }, { critical: true });
  await step('setup-saved', 'Choose a replacement; Paula saves the earliest permitted date', async () => {
    await page.getByRole('button', { name: 'Choose a replacement' }).click();
    const chosen = await fillSetup(DEFAULT_DRIVER);
    return { state: `${await heading()} | ${JSON.stringify(chosen)}`, detail: chosen, shotName: 'setup-saved' };
  }, { critical: true });
  await step('gallery-before-release', 'Continue (keyboard) opens the gallery before any release', async (row) => {
    await until(async () => page.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), { what: 'Continue enabled' });
    await kbPress(page.getByRole('button', { name: 'Continue', exact: true }));
    await waitGalleryReady(); row.detail = await galleryFacts();
    return { state: `status "${row.detail.status}"; cards ${row.detail.cards}`, shotName: 'gallery-before-release' };
  }, { critical: true });
  await step('stale-date-gallery', 'Next release passes the saved date: one Back to your choices, no Refresh availability', async (row) => {
    const { after } = await presenterPress('Next release'); await closeStrip();
    const stale = async () => /Your saved choices need updating/.test(await text(page.locator('.vm-status')));
    const settled = await until(stale, { timeout: 8000, what: 'stale-date status' }).catch(() => false);
    if (!settled) { const refresh = page.getByRole('button', { name: 'Refresh availability' }); if (await refresh.count()) await kbPress(refresh); await until(stale, { timeout: 20000, what: 'stale-date status after refresh' }).catch(() => {}); }
    const status = clip(await text(page.locator('.vm-status')), 300); const buttons = await statusButtons();
    row.detail = { status, statusButtons: buttons, pageRefreshButtons: await page.getByRole('button', { name: 'Refresh availability' }).count(), stockStatus: lastStock?.status, clock: clockOf(after) };
    const ok = /Your saved choices need updating/.test(status) && /pick a new date/.test(status) && buttons.length === 1 && buttons[0] === 'Back to your choices' && !buttons.includes('Refresh availability');
    return { pass: ok, state: `status "${status}"; status buttons [${buttons.join(' | ')}]; stock ${lastStock?.status}`, shotName: 'stale-date-gallery' };
  }, { critical: true });
  await step('back-keyboard', 'Tab to the status Back to your choices, Enter: setup screen; focus recorded', async (row) => {
    const back = page.locator('.vm-status').getByRole('button', { name: 'Back to your choices' });
    const hops = await tabTo(back);
    row.detail = { tabHops: hops, backButtons: await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Back to your choices').map((b) => ({ disabled: b.disabled, inStatus: Boolean(b.closest('.vm-status')) }))), notes: await page.locator('.gcsp-note').allInnerTexts() };
    const t0 = Date.now(); // the page-level Back stays disabled while the reservation check runs; record whether it ever frees up
    row.detail.pageBackEnabledAfterMs = await until(async () => (await page.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Back to your choices' && !x.closest('.vm-status') && !x.disabled))), { timeout: 10000, what: 'page Back enabled' }).then(() => Date.now() - t0).catch(() => null);
    row.detail.focusBeforeEnter = await page.evaluate(() => { const a = document.activeElement; return `${a.tagName} "${(a.innerText || '').trim().slice(0, 40)}" inStatus ${Boolean(a.closest('.vm-status'))}`; });
    const lost = !/inStatus true/.test(row.detail.focusBeforeEnter); // a redraw after the reservation check drops focus from the status button
    if (lost) { report.notes.push(`FUCQ-222 defect: focus left the status Back button before Enter (${row.detail.focusBeforeEnter}); Enter did nothing. Retabbed once settled.`); await tabTo(back); }
    row.detail.focusLostEarly = lost;
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor({ timeout: 20000 }); await wait(400);
    const focus = await page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, text: (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) }; });
    row.detail = { ...row.detail, focus }; kb('gallery', 'Tab reaches the status Back to your choices; Enter opens the setup screen', true, { hops, focus });
    return { pass: !lost, state: `${lost ? 'FOCUS LOST EARLY (Enter did nothing until retab); ' : ''}setup "${await heading()}"; focus ${focus.tag}#${focus.id} "${focus.text}"`, shotName: 'setup-after-back' };
  }, { critical: true });
  await step('date-recovery', 'Pick a later valid date, Save and Continue (keyboard): released cars', async (row) => {
    const date = page.locator('input[name="requestedCollectionDate"]');
    await until(async () => (await date.getAttribute('min')) && !(await date.isDisabled()), { what: 'refreshed collection window' });
    const w = { min: await date.getAttribute('min'), max: await date.getAttribute('max'), was: await date.inputValue() };
    await tabTo(date); await date.fill(w.min); w.now = await date.inputValue();
    await kbPress(page.getByRole('button', { name: 'Save choices' }));
    await until(async () => /Your choices are saved/.test(await bodyText()), { what: 'choices re-saved' });
    await until(async () => page.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), { what: 'Continue enabled' });
    await kbPress(page.getByRole('button', { name: 'Continue', exact: true }));
    await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'released cards', timeout: 30000 });
    const g = await galleryFacts(); row.detail = { window: w, ...g }; kb('setup', 'Save choices and Continue by keyboard reach the released cars', g.enabled > 0, g);
    return { pass: g.enabled > 0 && w.now !== w.was, state: `window ${JSON.stringify(w)}; ${g.cards} cards, ${g.enabled} enabled`, shotName: 'gallery-released' };
  }, { critical: true });
  await step('errors', 'No page errors; only the one expected stock 400 and 404s', async (row) => {
    const stock400 = report.badResponses.filter((r) => r.status === 400 && /\/api\/gcsp\/manual\/stock$/.test(r.url));
    const bad = report.badResponses.filter((r) => r.status !== 404 && !stock400.includes(r)); const con = report.consoleErrors.filter((c) => !/404|400|favicon/i.test(`${c.text} ${c.url}`));
    row.detail = { pageErrors: report.pageErrors, consoleErrors: report.consoleErrors, badResponses: report.badResponses.map((r) => `${r.status} ${r.method} ${r.url} ${r.body}`), stock400s: stock400.length, failedRequests: report.failedRequests };
    return { pass: !report.pageErrors.length && !bad.length && !con.length && !report.failedRequests.some((f) => f.error !== 'net::ERR_ABORTED') && stock400.length >= 1, state: `page errors ${report.pageErrors.length}; unexpected console ${con.length}; stock 400s ${stock400.length}; HTTP >=400: ${report.badResponses.map((r) => `${r.status} ${r.url}`).join(', ') || 'none'}; failed requests ${report.failedRequests.length}`, shot: false };
  });
}

async function run() {
  await mkdir(shotDir, { recursive: true }); await mkdir(scratch, { recursive: true });
  await rm(join(scratch, 'gcsp-stock-inventory'), { recursive: true, force: true }); // a killed earlier run can leave a torn inventory file
  for (const old of await readdir(shotDir)) if (old.startsWith(`${vp}-`)) await rm(join(shotDir, old), { force: true });
  app = await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport });
  const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ text: clip(m.text(), 200), url: bare(m.location().url || p.url()), page: bare(p.url()) }); });
    p.on('request', (r) => { if (r.method() === 'POST' && /\/api\/gcsp\/manual\/order$/.test(bare(r.url()))) orderPosts.push(new Date().toISOString().slice(11, 23)); });
    p.on('pageerror', (e) => report.pageErrors.push(clip(e.message, 200)));
    p.on('requestfailed', (r) => report.failedRequests.push({ url: bare(r.url()), error: r.failure()?.errorText, method: r.method() }));
    p.on('response', async (r) => {
      if (/\/api\/gcsp\/manual\/stock$/.test(bare(r.url()))) lastStock = { status: r.status(), url: bare(r.url()) };
      if (r.status() < 400) return;
      report.badResponses.push({ status: r.status(), url: bare(r.url()), method: r.request().method(), body: clip(await r.text().catch(() => ''), 200) });
    });
  };
  context.on('page', watch);
  if (env('TRACE')) context.on('page', traceRequests);
  page = await context.newPage();
  if (story === 'fucq72') { await walk72(); return; }
  if (story === 'fucq73') { await walk73(); return; }
  if (story === 'fucq145') { await walk145(); return; }
  if (story === 'fucq222') { await walk222(); return; }

  await reachGallery();

  // a. Review loaded
  await step('a-review-loaded', 'Review loaded with vehicle, facts, countdown and prefilled fields', async (row) => {
    await reviewFirstCar(); await watchLive();
    const f = await reviewFacts(); reviewedOrder = f.orderNumber; row.detail = f;
    const counter = /^\d+ \/ 500 characters$/.test(f.counter);
    const ok = Boolean(f.vehicleName) && f.hasPoints && (f.hasRepresentativeCaption || f.noImagePlaceholder) && /Requested collection date/.test(f.context) && /Returning car/.test(f.context)
      && /Current contract/.test(f.context) && /^Car reservation: \d+:\d{2} remaining$/.test(f.countdown) && Boolean(f.phone) && Boolean(f.email) && Boolean(f.mileage) && counter;
    return { pass: ok, state: `${f.vehicleName} | ${f.countdown} | phone ${f.phone ? 'set' : 'empty'}, email ${f.email ? 'set' : 'empty'}, mileage ${f.mileage || 'empty'} | ${f.counter}` };
  }, { critical: true });

  // b. Keyboard validation
  await step('b-keyboard-validation', 'Empty phone then Enter on Continue shows the error summary with focus on it', async (row) => {
    const original = await phone().inputValue();
    await phone().click(); await phone().fill('');
    await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    const hops = await tabTo(page.getByRole('button', { name: 'Continue to order review' }));
    await page.keyboard.press('Enter');
    const summary = page.getByText('Check your review details');
    await summary.first().waitFor({ timeout: 15000 });
    await wait(300);
    const focus = await page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, id: a.id, text: a.textContent.trim().slice(0, 60), insideSummary: Boolean(a.closest('.gcsp-error-summary')) }; });
    const phoneError = await page.evaluate(() => { const c = document.querySelector('input[name="contact.phone"]'); return { invalid: c.getAttribute('aria-invalid'), error: document.getElementById(`${c.id}-error`)?.textContent ?? '' }; });
    const link = await text(page.locator('.gcsp-error-summary li a'));
    row.detail = { tabHops: hops, focus, phoneError, summaryLinks: clip(link, 160) };
    kb('review', 'Tab reaches Continue to order review; Enter shows the error summary and focuses it', focus.insideSummary, focus);
    const shotName = await shot('b-keyboard-validation-error'); row.screenshots.push(shotName);
    await phone().fill(original); await page.keyboard.press('Tab');
    return { pass: focus.insideSummary && phoneError.invalid === 'true' && Boolean(phoneError.error), state: `focus ${focus.tag}#${focus.id} "${focus.text}"; phone error "${phoneError.error}"; summary "${clip(link, 120)}"`, shot: false };
  });

  // c. 500 character cap
  await step('c-500-cap', '520 characters typed into Special requirements are capped at 500', async (row) => {
    const area = page.locator('textarea[name="specialRequirements"]');
    await area.click(); await area.fill(''); await area.pressSequentially('x'.repeat(520), { delay: 0 });
    const length = await area.evaluate((el) => el.value.length);
    const counter = clip(await text(page.locator('.gcsp-review-form .gcsp-field-hint').last()), 60);
    const maxLength = await area.getAttribute('maxlength');
    row.detail = { length, counter, maxLength };
    return { pass: length === 500 && /500 \/ 500/.test(counter), state: `value length ${length}; maxlength ${maxLength}; counter "${counter}"`, shotName: 'c-500-cap' };
  });

  // d. Long text wrapping (page overflow is also measured on every step)
  await step('d-long-text', 'Long names and the full-length field wrap without horizontal page overflow', async (row) => {
    const widths = await page.evaluate(() => {
      const wide = [...document.querySelectorAll('.gcsp-review-body *')].filter((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX === 'visible').slice(0, 5).map((n) => `${n.tagName}.${n.className}`.slice(0, 80));
      const name = document.querySelector('.gcsp-review-vehicle h2, .gcsp-review-vehicle h3, .gcsp-review-vehicle .vm-card-title');
      return { docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, wideElements: wide, vehicleNameHeightPx: name ? Math.round(name.getBoundingClientRect().height) : null, vehicleName: name?.innerText ?? null };
    });
    row.detail = widths;
    return { pass: widths.docOverflow === 0, state: `document overflow ${widths.docOverflow}px; vehicle name "${widths.vehicleName}" height ${widths.vehicleNameHeightPx}px; wide elements ${widths.wideElements.join(', ') || 'none'}`, shotName: 'd-long-text' };
  });

  // e. Presenter ticks to expiry
  await step('e-expiry', 'Presenter ticks run the reservation out; expired message, Continue disabled, Refresh stock shown', async (row) => {
    const hold = (await claimNow()).hold; row.detail = { holdBefore: hold ? { state: hold.state, phase: hold.phase, expiresAt: hold.expiresAt } : null };
    await watchLive();
    const countdowns = [await countdownOf()]; let ticks = 0; let clockAt = null;
    while (ticks < 45 && !/expired/i.test(await bodyText().then((t) => (t.match(/Your reservation has expired[^.]*\./) || [''])[0]))) {
      clockAt = await tick(); ticks += 1;
      // The review reconciles a moment after each tick, so give the expired state a few seconds before ticking again.
      await until(async () => /Your reservation has expired/.test(await bodyText()), { timeout: 6000, what: 'expiry' }).catch(() => {});
      countdowns.push(await countdownOf());
      if (env('LOG')) console.error(`${new Date().toISOString().slice(11, 19)} tick ${ticks} clock ${clockAt} countdown ${countdowns.at(-1)} notice ${clip(await text(page.locator('.gcsp-review-body > .gcsp-note')), 120)} status ${clip(await text(page.locator('.gcsp-review-announcement')), 100)} hold ${(await claimNow()).hold?.state}`);
    }
    await until(async () => /Your reservation has expired/.test(await bodyText()), { timeout: 30000, what: 'expired message' });
    const live = await liveStats();
    const continueDisabled = await page.getByRole('button', { name: 'Continue to order review' }).isDisabled();
    const refresh = await page.getByRole('button', { name: 'Refresh stock' }).count();
    const entries = { phone: await phone().inputValue().catch(() => null), special: (await page.locator('textarea[name="specialRequirements"]').inputValue().catch(() => '')).length };
    row.detail = { ...row.detail, ticks, clockAt, countdowns: countdowns.slice(-8), liveRegion: live, notice: clip(await text(page.locator('.gcsp-review-body > .gcsp-note')), 160), entries,
      expiredHold: (await claimNow()).hold && { state: (await claimNow()).hold.state } };
    await page.locator('.gcsp-review-announcement').scrollIntoViewIfNeeded().catch(() => {});
    const ok = continueDisabled && refresh === 1 && entries.special === 500 && Boolean(entries.phone) && (live?.changes ?? 99) <= 3;
    return { pass: ok, state: `ticks ${ticks}; Continue disabled ${continueDisabled}; Refresh stock buttons ${refresh}; live-region changes ${live?.changes}; texts ${JSON.stringify(live?.texts)}; entries ${JSON.stringify(entries)}`, shotName: 'e-expired' };
  }, { critical: true });

  // f. Reload after expiry
  await step('f-reload-after-expiry', 'Reload after expiry does not show the claim as active again', async (row) => {
    await page.reload({ waitUntil: 'load' });
    await page.getByRole('heading').first().waitFor({ timeout: 60000 });
    await until(async () => (await page.getByRole('button', { name: /Resume saved journey|Choose a replacement/ }).count()) > 0, { what: 'account journey buttons' });
    const resume = page.getByRole('button', { name: /Resume saved journey/ });
    const resumeOffered = await resume.count();
    row.detail = { afterReloadHeading: await heading(), resumeOffered };
    if (resumeOffered) { await resume.first().click(); await until(async () => (await heading()) !== 'Your cars', { what: 'resume to land' }); await wait(1500); row.detail.afterResumeHeading = await heading(); }
    // Walk to wherever the journey sits and try the review for the expired claim.
    const t = await bodyText();
    const countdownShown = /Car reservation: \d+:\d{2} remaining|Order review: \d+:\d{2} remaining/.test(t);
    const claim = (await claimNow()).hold;
    row.detail.claimHold = claim && { state: claim.state, phase: claim.phase };
    row.detail.countdownShown = countdownShown; row.detail.expiredTextShown = /Your reservation has expired/.test(t);
    row.detail.buttons = await page.getByRole('button').evaluateAll((b) => b.map((x) => x.textContent.trim()).filter(Boolean).slice(0, 14));
    return { pass: !countdownShown && !(claim && claim.state === 'active'), state: `heading "${await heading()}"; countdown shown ${countdownShown}; claim hold ${JSON.stringify(row.detail.claimHold)}; buttons ${row.detail.buttons.join(' | ')}`, shotName: 'f-reload-after-expiry' };
  });

  // Fresh claim for g and h
  async function freshClaim() {
    for (let i = 0; i < 8 && (await heading()) !== 'Released cars'; i += 1) {
      const h = await heading();
      const click = async (name) => { const b = page.getByRole('button', { name }); if (await b.count() && await b.first().isEnabled()) { await b.first().click(); return true; } return false; };
      if (h === 'Your cars') { (await click('Resume saved journey')) || (await click('Choose a replacement')); }
      else if (h === 'Your order choices') {
        const date = page.locator('input[name="requestedCollectionDate"]'); const min = await date.getAttribute('min');
        if (min && (await date.inputValue()) !== min) { await date.fill(min); await click('Save choices'); await until(async () => /Your choices are saved/.test(await bodyText()), { what: 'choices re-saved' }); }
        await click('Continue');
      } else if (h === 'Review your car') { await click('Refresh stock'); }
      await wait(1500);
    }
    await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor({ timeout: 30000 });
    const reviewButton = page.getByRole('button', { name: 'Review this car' });
    await until(async () => (await reviewButton.count()) > 0, { what: 'gallery cards' });
    if (!(await reviewButton.evaluateAll((b) => b.some((x) => !x.disabled)))) { await presenterPress('Next release'); }
    await reviewFirstCar();
  }

  // g. Pending or unavailable claim read
  await step('g-claim-unavailable', 'Aborted claim read: status not confirmed, no confirmed countdown; recovers on Check current claim', async (row) => {
    await freshClaim(); await watchLive();
    const before = { countdown: await countdownOf(), claim: (await claimNow()).hold?.state };
    const matcher = /\/api\/gcsp\/manual\/claim(\?.*)?$/;
    let blocked = 0;
    await page.route(matcher, (route) => { if (route.request().method() === 'GET') { blocked += 1; return route.abort('failed'); } return route.continue(); });
    await page.getByRole('button', { name: 'Check current claim' }).click();
    await until(async () => /could not be confirmed|still being checked/.test(await bodyText()), { timeout: 30000, what: 'unconfirmed status' });
    const shown = await bodyText();
    const during = { blocked, notice: clip(await text(page.locator('.gcsp-review-body > .gcsp-note, .gcsp-status, [role=status], main').first()), 220),
      statusLine: (shown.match(/The current claim could not be confirmed[^.]*\.|The outcome is still being checked[^.]*\./) || [''])[0],
      countdown: await countdownOf(), consequence: clip(await text(page.locator('.gcsp-review-time .gcsp-note')), 200), reviewVisible: (await body().count()) > 0,
      continueEnabled: (await body().count()) ? await page.getByRole('button', { name: 'Continue to order review' }).isEnabled() : false };
    row.screenshots.push(await shot('g-claim-unavailable'));
    await page.unroute(matcher);
    const check = page.getByRole('button', { name: 'Check current claim' });
    await check.first().click();
    await until(async () => /Your current claim has been checked/.test(await bodyText()), { timeout: 30000, what: 'recovered claim' });
    const after = { notice: (await bodyText()).match(/Your current claim has been checked\./)?.[0], countdown: await countdownOf(), reviewVisible: (await body().count()) > 0 };
    row.detail = { before, during, after };
    // The brief asks that no held countdown is presented as confirmed while the read fails; stale reserved copy fails that check.
    const staleHeldCopy = /remaining/.test(during.countdown ?? '') || /reserved until the deadline/.test(during.consequence ?? '');
    row.detail.checks = { unconfirmedTextShown: Boolean(during.statusLine), continueDisabled: !during.continueEnabled, staleHeldCountdownShown: staleHeldCopy, recoveredOnCheck: /remaining/.test(after.countdown ?? '') };
    if (staleHeldCopy) report.notes.push(`FINDING g: while the claim read failed the review still showed "${during.countdown}" and "${clip(during.consequence, 70)}" beside "${during.statusLine}".`);
    return { pass: Boolean(during.statusLine) && !during.continueEnabled && !staleHeldCopy && row.detail.checks.recoveredOnCheck, state: `unconfirmed text "${during.statusLine}"; countdown during outage "${during.countdown}"; Continue enabled ${during.continueEnabled}; stale held copy shown ${staleHeldCopy}; recovered "${after.notice}" ${after.countdown}`, shotName: 'g-claim-recovered' };
  });

  // h. Back releases the car
  await step('h-back-releases', 'Back on an active review returns to the gallery and the car is available again', async (row) => {
    const order = (await reviewFacts()).orderNumber ?? reviewedOrder;
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor({ timeout: 60000 });
    await until(async () => (await page.getByRole('button', { name: 'Review this car' }).count()) > 0, { what: 'gallery cards' });
    await wait(800);
    const enabled = await page.getByRole('button', { name: 'Review this car' }).evaluateAll((b) => b.filter((x) => !x.disabled).length);
    const claim = (await claimNow()).hold;
    row.detail = { order, reviewButtonsEnabled: enabled, claimHold: claim && { state: claim.state }, galleryText: clip(await bodyText(), 300) };
    return { pass: enabled > 0 && !(claim && claim.state === 'active'), state: `heading "${await heading()}"; enabled Review buttons ${enabled}; claim hold ${JSON.stringify(row.detail.claimHold)}`, shotName: 'h-back-gallery', full: false };
  });
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots, keyboardChecks: report.keyboard.length };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
