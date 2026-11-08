// Browser walkthrough of the manual journey, one viewport per run (WALK_CHUNK=desktop|narrow), story by WALK_STORY=fucq70|fucq72.
// Spawns `node index.js` in server/ offline (GCSP_OFFLINE=1, memory repository). FUCQ70_* names still work as fallbacks for WALK_*.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const env = (name) => process.env[`WALK_${name}`] ?? process.env[`FUCQ70_${name}`];
const story = process.env.WALK_STORY || 'fucq70';
if (!['fucq70', 'fucq72'].includes(story)) throw new Error('Set WALK_STORY=fucq70|fucq72');
const chunk = env('CHUNK');
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set WALK_CHUNK=desktop|narrow');
const scratch = resolve(env('SCRATCH') || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set WALK_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 320, height: 720 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const port = Number(env('PORT')) || (chunk === 'narrow' ? 8933 : 8932);
if (port < 8930 || port > 8949) throw new Error('WALK_PORT must be within 8930-8949');
const outDir = story === 'fucq70' ? HERE : resolve(HERE, '..', story);
const only = env('ONLY') ? `-${env('ONLY')}` : ''; // a partial run never overwrites the full run's files
const shotDir = join(outDir, `browser${only}`);
const resultsFile = join(outDir, `results-${chunk}${only}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { ...(story === 'fucq70' ? {} : { story }), chunk, entry: 'hosted-offline', viewport, state: 'incomplete', startedAt: new Date().toISOString(), steps: [], keyboard: [],
  consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let reviewedOrder = null; const orderPosts = []; let context; let page; let app; let child; let halted = null; let origin;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => { if (story === 'fucq72') report.orderPosts = orderPosts; if (env('TRACE')) report.trace = trace; return writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`); };
const killChrome = () => { try { spawnSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch { /* already gone */ } };
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
  return `browser/${file}`;
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
  } catch (error) {
    row.error = clip(error.message, 300); row.overflowPx = await overflow();
    try { row.screenshots.push(await shot(`${id}-failed`, false)); } catch { /* page gone */ }
    if (critical) halted = id;
  }
  await save();
}

const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement).catch(() => false);
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
  if (!(await root.evaluate((el) => el.open))) await root.locator('summary').click();
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
async function fillSetup(driverLabel = 'You: Paula (fictional)') {
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
  await page.getByRole('button', { name: 'Save choices' }).click();
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
      if (r.status() < 400) return;
      report.badResponses.push({ status: r.status(), url: bare(r.url()), method: r.request().method(), body: clip(await r.text().catch(() => ''), 200) });
    });
  };
  context.on('page', watch);
  if (env('TRACE')) context.on('page', traceRequests);
  page = await context.newPage();
  if (story === 'fucq72') { await walk72(); return; }

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
