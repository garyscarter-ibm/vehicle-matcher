// FUCQ-70 browser walkthrough of the manual claimed-car review screen, one viewport per run (FUCQ70_CHUNK=desktop|narrow).
// Spawns `node index.js` in server/ offline (GCSP_OFFLINE=1, memory repository). Nothing is stubbed except the one aborted claim read in step g.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const chunk = process.env.FUCQ70_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ70_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ70_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ70_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 320, height: 720 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const port = Number(process.env.FUCQ70_PORT) || (chunk === 'narrow' ? 8933 : 8932);
if (port < 8930 || port > 8949) throw new Error('FUCQ70_PORT must be within 8930-8949');
const shotDir = join(HERE, 'browser');
const resultsFile = join(HERE, `results-${chunk}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;
const report = { chunk, entry: 'hosted-offline', viewport, state: 'incomplete', startedAt: new Date().toISOString(), steps: [], keyboard: [],
  consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let shots = 0; let context; let page; let app; let child; let halted = null; let origin;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
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
  if (process.env.FUCQ70_LOG) console.error(`${new Date().toISOString().slice(11, 19)} step ${id}`);
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
  return { stop: async () => { if (child.exitCode === null) { const gone = once(child, 'exit'); child.kill('SIGTERM'); setTimeout(killServer, 5000).unref(); await gone; } } };
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
async function tick() { const r = await presenterPress(/^Tick \(/); await wait(Number(process.env.FUCQ70_SETTLE) || 1500); return clockOf(r.after); }

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
async function fillSetup() {
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
  await driver.selectOption({ label: 'You: Paula (fictional)' }).catch(async () => { await pick('driverId'); });
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

async function run() {
  await mkdir(shotDir, { recursive: true }); await mkdir(scratch, { recursive: true });
  await rm(join(scratch, 'gcsp-stock-inventory'), { recursive: true, force: true }); // a killed earlier run can leave a torn inventory file
  for (const old of await readdir(shotDir)) if (old.startsWith(`${vp}-`)) await rm(join(shotDir, old), { force: true });
  app = await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport });
  const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ text: clip(m.text(), 200), url: bare(m.location().url || p.url()), page: bare(p.url()) }); });
    p.on('pageerror', (e) => report.pageErrors.push(clip(e.message, 200)));
    p.on('requestfailed', (r) => report.failedRequests.push({ url: bare(r.url()), error: r.failure()?.errorText, method: r.method() }));
    p.on('response', async (r) => {
      if (r.status() < 400) return;
      report.badResponses.push({ status: r.status(), url: bare(r.url()), method: r.request().method(), body: clip(await r.text().catch(() => ''), 200) });
    });
  };
  context.on('page', watch);
  page = await context.newPage();
  let reviewedOrder = null;

  await step('access-key', 'Demo key form opens the offline hosted demo', async () => {
    const typed = await enterAccessKey();
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    return { pass: typed, state: await bodyText(), shot: false };
  }, { critical: true });

  await step('setup-saved', 'Choose a replacement; setup choices saved for Paula', async () => {
    await page.getByRole('button', { name: 'Choose a replacement' }).click();
    const chosen = await fillSetup();
    return { state: `${await heading()} | ${JSON.stringify(chosen)}`, detail: chosen, full: false };
  }, { critical: true });

  await step('release-and-gallery', 'Next release, Continue, Released cars gallery', async () => {
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
      if (process.env.FUCQ70_LOG) console.error(`${new Date().toISOString().slice(11, 19)} tick ${ticks} clock ${clockAt} countdown ${countdowns.at(-1)} notice ${clip(await text(page.locator('.gcsp-review-body > .gcsp-note')), 120)} status ${clip(await text(page.locator('.gcsp-review-announcement')), 100)} hold ${(await claimNow()).hold?.state}`);
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
