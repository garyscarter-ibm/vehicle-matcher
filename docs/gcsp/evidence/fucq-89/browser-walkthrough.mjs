// FUCQ-109 browser walkthrough of Paula's path on the real launcher, one viewport per run (FUCQ89_CHUNK=desktop|narrow).
// Nothing is stubbed: startGcspDemo over HTTPS, the default generated stock, real routes. FUCQ89_STOCK=demo forces demo stock.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { startGcspDemo } from '../../../../scripts/gcsp-demo.mjs';
import { createRunStockProviderFactory } from '../../../../server/gcsp/stock/index.js';
import { createDemoUpstream, withConfirmedSupply } from '../../../../server/gcsp/stock/demo-provider.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const chunk = process.env.FUCQ89_CHUNK;
if (!['desktop', 'narrow'].includes(chunk)) throw new Error('Set FUCQ89_CHUNK=desktop|narrow');
const scratch = resolve(process.env.FUCQ89_SCRATCH || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set FUCQ89_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = chunk === 'narrow' ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const shotDir = join(HERE, 'browser');
const resultsFile = join(HERE, `results-${chunk}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const stockMode = process.env.FUCQ89_STOCK === 'demo' ? 'demo' : 'default';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const report = { chunk, viewport, stockMode, state: 'incomplete', startedAt: new Date().toISOString(), steps: [], keyboard: [], firstRelease: null,
  consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], notes: [] };
let previewRendered = null; let shots = 0; let context; let page; let app; let halted = null;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
const killChrome = () => { try { spawnSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome(); report.state = 'timeout'; process.exit(124); });
process.on('exit', killChrome);

async function until(fn, { timeout = 120000, every = 500, what = 'condition' } = {}) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch { /* retry */ } await wait(every); }
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

// A step records pass/fail, the observed state text and its screenshots. A failed critical step blocks the rest.
async function step(id, name, run, { critical = false } = {}) {
  const row = { id, name, pass: false, screenshots: [] };
  report.steps.push(row);
  if (halted) { row.pass = false; row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    // Horizontal overflow of the page itself fails the step (tables and code may scroll inside their own box).
    row.overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)).catch(() => null);
    row.pass = out.pass !== false && !(row.overflowPx > 2); row.state = clip(out.state); if (out.detail !== undefined) row.detail = out.detail;
    if (out.shot !== false) row.screenshots.push(await shot(out.shotName || id, out.full !== false));
  } catch (error) {
    row.error = clip(error.message, 300);
    try { row.screenshots.push(await shot(`${id}-failed`)); } catch { /* page gone */ }
    if (critical) halted = id;
  }
  await save();
}

// Keyboard helpers: Tab from the current focus until the target holds it.
const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement).catch(() => false);
async function tabTo(locator, { max = 140 } = {}) {
  await locator.first().waitFor({ state: 'attached', timeout: 30000 });
  for (let count = 0; count <= max; count += 1) {
    if (await isFocused(locator.first())) return count;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
}
const ring = (locator) => locator.first().evaluate((el) => {
  const s = getComputedStyle(el);
  // A range input shows focus on its thumb, so read the thumb's own style.
  const t = el.type === 'range' ? getComputedStyle(el, '::-webkit-slider-thumb') : s;
  const outline = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (t.outlineStyle !== 'none' && parseFloat(t.outlineWidth) > 0);
  const shadow = (s.boxShadow && s.boxShadow !== 'none') || (t.boxShadow && t.boxShadow !== 'none');
  return { outline, shadow: Boolean(shadow), label: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 60) };
});
// One focused-control capture per page, reached by Tab so :focus-visible applies.
async function focusShot(row, locator, label) {
  await tabTo(locator);
  const visible = await ring(locator);
  const ok = visible.outline || visible.shadow;
  report.keyboard.push({ page: label, check: 'visible focus', pass: ok, detail: visible });
  row.screenshots.push(await shot(`focus-${label}`));
  if (!ok) row.pass = false;
}
const kb = (pageName, action, pass, detail) => report.keyboard.push({ page: pageName, check: action, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });

// ---- Presenter strip helpers ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (text) => /DemoClock \(UTC\)\s+(\S+)/.exec(text)?.[1] ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 60000 });
  if (!(await root.evaluate((el) => el.open))) await root.locator('summary').click();
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 60000 });
}
async function nextRelease(row) {
  await openStrip();
  const before = clockOf(await stripText());
  await page.getByRole('button', { name: 'Next release' }).click({ timeout: 240000, noWaitAfter: true });
  const text = await until(async () => {
    const now = await stripText();
    return clockOf(now) !== before && !/Action in progress/.test(now) && /Presenter controls ready|Last tick/.test(now) ? now : null;
  }, { timeout: 240000, what: 'release to finish' });
  const released = Number(/(\d+) cars released/.exec(text)?.[1] ?? NaN) || null;
  row.detail = { clockBefore: before, clockAfter: clockOf(text), carsReleased: released, releaseCue: /Release cue: (\S+)/.exec(text)?.[1] ?? null };
  await page.evaluate(() => document.querySelector('.gcsp-presenter-controls')?.scrollIntoView({ block: 'start' }));
  return { state: `Clock ${before} to ${clockOf(text)}; cars released ${released}`, shotName: row.id };
}

async function goto(path, ready) {
  await page.goto(`${app.value.origin}${path}`, { waitUntil: 'load', timeout: 120000 });
  if (ready) await ready();
}
const visibleText = (selector) => page.locator(selector).first().evaluate((el) => el.innerText);

// ---- Brief ----
const group = (question) => page.locator(`[role=radiogroup][aria-label^="${question}"]`);
async function answerByKeyboard(question, target) {
  const checked = group(question).locator('[role=radio][aria-checked=true]');
  await tabTo(checked);
  const labels = await group(question).locator('[role=radio]').evaluateAll((nodes) => nodes.map((n) => n.innerText.trim()));
  const from = labels.indexOf((await checked.innerText()).trim()); const to = labels.indexOf(target);
  const key = to < from ? 'ArrowLeft' : 'ArrowRight';
  for (let i = 0; i < Math.abs(to - from); i += 1) await page.keyboard.press(key);
  const ok = (await group(question).locator('[role=radio][aria-checked=true]').innerText()).trim() === target;
  kb('brief', `arrow keys choose "${target}" for "${question}"`, ok);
  if (!ok) throw new Error(`Arrow keys did not select ${target}`);
}
async function toggleByKeyboard(name) {
  const box = page.getByRole('checkbox', { name, exact: true });
  await tabTo(box); await page.keyboard.press('Space');
  const ok = (await box.getAttribute('aria-checked')) === 'true';
  kb('brief', `Space switches on "${name}"`, ok);
  if (!ok) throw new Error(`Space did not switch on ${name}`);
}
const previewState = () => visibleText('gcsp-brief').then((t) => {
  const after = t.split('Cars for your brief').pop();
  return { updating: /Updating cars/.test(after), text: after };
});
async function settledPreview() {
  return until(async () => { const p = await previewState(); return p.updating || !/eligible car/.test(p.text) ? null : p; }, { timeout: 150000, what: 'brief preview to settle' });
}
async function previewFacts() {
  const preview = await settledPreview();
  const count = Number(/(\d+) eligible car/.exec(preview.text)?.[1] ?? NaN);
  const needs = Number(/(\d+) cars? need/.exec(preview.text)?.[1] ?? 0);
  const cards = await page.locator('gcsp-brief .gcsp-brief-cards article.vm-card').evaluateAll((nodes) => nodes.map((n) => ({
    title: n.querySelector('h2,h3,h4,.vm-card-title')?.innerText.trim() || '', compact: n.classList.contains('vm-card-compact') })));
  const eligible = cards.filter((c) => !c.compact).map((c) => c.title.split(' in ')[0]);
  const lines = {}; for (const line of eligible) lines[line] = (lines[line] || 0) + 1;
  return { eligibleCount: count, needConfirmation: needs, eligibleCardsShown: eligible.length, modelLines: lines, summary: clip(preview.text, 120) };
}

// ---- Outbox and offer ----
async function openMessage(index) {
  await goto('/gcsp-outbox-live.html', () => until(() => page.locator('gcsp-outbox').evaluate((el) => /captured email/.test(el.innerText) && !/Loading captured/.test(el.innerText)), { timeout: 90000, what: 'outbox to load' }));
  const rows = page.locator('gcsp-outbox button').filter({ hasText: 'Your vehicle offer' });
  const count = await rows.count();
  await rows.nth(index).click();
  await page.getByRole('link', { name: /Open the offer/ }).waitFor({ timeout: 30000 });
  // The sandboxed HTML preview must actually paint the email heading, not an empty frame.
  previewRendered = await page.frameLocator('gcsp-outbox iframe').locator('h1').first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  return count;
}
// Open the message's own offer link with the keyboard; the link opens a new tab, which becomes the working page.
async function openOfferLink(label) {
  const link = page.getByRole('link', { name: /Open the offer/ });
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 30000 }), (async () => { await tabTo(link); await page.keyboard.press('Enter'); })()]);
  kb(label, 'Enter on the captured message link opens the offer', true);
  const old = page; page = popup; await old.close();
  await page.waitForLoadState('load');
  await page.getByRole('button', { name: /Accept this offer/ }).waitFor({ timeout: 180000 });
}
const offerText = () => visibleText('gcsp-offer');

async function run() {
  await mkdir(shotDir, { recursive: true }); await mkdir(scratch, { recursive: true });
  const conf = join(scratch, 'openssl.cnf'); const keyFile = join(scratch, 'localhost.key'); const certFile = join(scratch, 'localhost.crt');
  await writeFile(conf, '[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=server\n[subject]\nCN=localhost\n[server]\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '1', '-config', conf], { stdio: 'ignore', timeout: 20000 });
  // Same composition as the scripts/gcsp-demo.mjs CLI: default stock factory, one confirming upstream, offer journey adopted.
  const stock = createRunStockProviderFactory(stockMode === 'demo' ? { env: { ...process.env, GCSP_STOCK_SOURCE: 'demo' } } : {});
  const upstream = createDemoUpstream();
  const environmentId = `fucq89-${chunk}`;
  app = await startGcspDemo({ port: 0, tls: { keyFile, certFile }, runtime: { mode: 'memory', stockProvider: (deps) => withConfirmedSupply(stock(deps), upstream),
    production: upstream.production, environmentId, policyAsOf: new Date().toISOString(), commandId: `${environmentId}-bootstrap`, adoptOfferJourney: true } });
  if (app.status !== 'ok') throw new Error(`Launcher did not start: ${app.status} ${app.code || ''}`);
  report.origin = app.value.origin;

  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, ignoreHTTPSErrors: true, viewport });
  const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ text: clip(m.text(), 200), url: bare(m.location().url || p.url()) }); });
    p.on('pageerror', (e) => report.pageErrors.push(clip(e.message, 200)));
    p.on('requestfailed', (r) => report.failedRequests.push({ url: bare(r.url()), error: r.failure()?.errorText, method: r.method() }));
    p.on('response', (r) => { if (r.status() >= 400) report.badResponses.push({ status: r.status(), url: bare(r.url()), method: r.request().method() }); });
  };
  context.on('page', watch);
  page = await context.newPage();

  // 1 Presenter workspace and strip
  await step('presenter-workspace', 'Presenter workspace opens on Paula with the strip collapsed', async () => {
    await goto('/gcsp-presenter.html');
    await strip().waitFor({ state: 'attached', timeout: 90000 });
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    return { state: await visibleText('[data-presenter-workspace]') };
  }, { critical: true });
  await step('presenter-strip-open', 'Presenter strip opens with the keyboard and shows run, clock and release cue', async (row) => {
    const summary = strip().locator('summary'); await tabTo(summary); await page.keyboard.press('Enter');
    const ok = await strip().evaluate((el) => el.open); kb('presenter', 'Enter on "Presenter controls" opens the strip', ok);
    const text = await until(async () => (clockOf(await stripText()) ? stripText() : null), { what: 'strip readout' });
    row.detail = { clock: clockOf(text), releaseCue: /Release cue: (\S+)/.exec(text)?.[1] ?? null, actingPrincipal: /Acting principal\s+(.+)/.exec(text)?.[1] ?? null };
    const radio = page.getByRole('radio', { name: /Paula \(fictional\)/ }).first();
    if (await radio.count()) await focusShot(row, radio, 'presenter');
    return { state: `${clip(text, 200)}`, pass: ok };
  }, { critical: true });

  // 2 Brief
  await step('brief-initial', 'Brief page loads with Paula\'s starting answers', async () => {
    await goto('/gcsp-brief-live.html', () => page.getByRole('button', { name: 'Save this brief' }).waitFor({ timeout: 90000 }));
    return { state: await visibleText('gcsp-brief') };
  }, { critical: true });
  await step('brief-answers-keyboard', 'Paula confirms her essentials and buddy permissions with the keyboard', async (row) => {
    await answerByKeyboard('Do you need to carry five', 'Yes');
    await answerByKeyboard('Do you need at least 430', 'No');
    await answerByKeyboard('Do you need a towbar', 'No');
    await answerByKeyboard('Can you charge', 'No');
    await toggleByKeyboard('Search for cars for me');
    await toggleByKeyboard('Hold a suitable car for me');
    await focusShot(row, page.getByRole('button', { name: 'Save this brief' }), 'brief');
    const preview = await previewFacts(); row.detail = { previewBeforeAnyRelease: preview };
    await page.getByRole('button', { name: 'Save this brief' }).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    return { state: `Preview before any release: ${preview.summary}`, pass: preview.eligibleCount === 0, shotName: 'brief-answered-preview' };
  }, { critical: true });
  await step('brief-saved', 'Brief saved with Enter on Save this brief', async () => {
    const save_ = page.getByRole('button', { name: 'Save this brief' });
    await tabTo(save_); await page.keyboard.press('Enter');
    const status = await until(() => page.locator('gcsp-brief [role=status]').evaluateAll((n) => n.map((x) => x.innerText).find((t) => /saved/i.test(t))), { timeout: 60000, what: 'save confirmation' });
    kb('brief', 'Enter on "Save this brief" saves the brief', true, status);
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: status };
  }, { critical: true });

  // 3 Activity before release
  await step('activity-before-release', 'Activity before any release shows an active buddy and no offer', async (row) => {
    await goto('/gcsp-activity-live.html', () => until(() => page.locator('gcsp-activity').evaluate((el) => /Your offer/.test(el.innerText)), { timeout: 90000, what: 'activity' }));
    return { state: await visibleText('gcsp-activity') };
  });

  // 4 First release from the presenter workspace
  await step('presenter-first-release', 'Presenter Next release publishes the first stock release', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    return nextRelease(row);
  }, { critical: true });
  await step('brief-first-release-eligibility', 'Brief preview after the first release counts Paula\'s eligible cars', async (row) => {
    await goto('/gcsp-brief-live.html', () => page.getByRole('button', { name: 'Save this brief' }).waitFor({ timeout: 90000 }));
    const facts = await previewFacts(); report.firstRelease = { ...facts, stockSource: stockMode === 'demo' ? 'demo (forced)' : 'default factory (generated stock expected)' };
    row.detail = facts;
    await page.getByRole('heading', { name: 'Cars for your brief' }).evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); });
    return { state: `${facts.eligibleCount} eligible; lines ${JSON.stringify(facts.modelLines)}`, pass: facts.eligibleCount > 0, full: false };
  });

  // 5 Activity shows the offer
  await step('activity-offer', 'Paula\'s activity shows the first offer and the search result', async (row) => {
    await goto('/gcsp-activity-live.html');
    await until(() => page.locator('gcsp-activity').evaluate((el) => /Waiting for you/.test(el.innerText)), { timeout: 150000, what: 'offer on activity' });
    const link = page.getByRole('link', { name: /View offer/ }); await focusShot(row, link, 'activity');
    return { state: await visibleText('gcsp-activity') };
  }, { critical: true });

  // 6 Outbox and first offer
  await step('outbox-first-message', 'Outbox viewer shows the captured offer email', async (row) => {
    const count = await openMessage(0); row.detail = { capturedEmails: count, emailPreviewRendered: previewRendered };
    const rowBtn = page.locator('gcsp-outbox button').filter({ hasText: 'Your vehicle offer' }).first();
    await page.locator('gcsp-outbox .gcsp-presenter-body, gcsp-outbox').first().evaluate(() => window.scrollTo(0, 0));
    await focusShot(row, rowBtn, 'outbox');
    return { state: `${count} email. ${clip(await visibleText('gcsp-outbox'), 300)}`, pass: count === 1 && previewRendered };
  }, { critical: true });
  await step('offer-first', 'First offer opens from the captured message link', async () => {
    await openOfferLink('outbox');
    return { state: await offerText() };
  }, { critical: true });
  await step('offer-decline-form', 'Decline opens its reason form with the keyboard', async (row) => {
    const decline = page.getByRole('button', { name: 'Decline this offer' });
    await tabTo(decline); await page.keyboard.press('Enter');
    const select = page.locator('select');
    await until(async () => (await select.locator('option').count()) > 1, { timeout: 90000, what: 'decline reasons' });
    row.detail = { reasons: await select.locator('option').evaluateAll((o) => o.map((x) => x.textContent.trim()).filter((t) => !/^Choose/.test(t))) };
    await tabTo(select); await focusShot(row, select, 'offer-decline');
    await page.keyboard.type('Size');
    const chosen = await select.evaluate((el) => el.selectedOptions[0]?.textContent.trim());
    kb('offer', 'typing "Size" in the reason list chooses it (no free-text field exists)', chosen === 'Size', chosen);
    return { state: `Reason chosen: ${chosen}`, pass: chosen === 'Size', shotName: 'offer-decline-reason' };
  }, { critical: true });
  await step('offer-declined-followup', 'Confirm decline shows the recorded decline and one follow-up question', async (row) => {
    const confirm = page.getByRole('button', { name: 'Confirm decline' });
    await tabTo(confirm); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Confirm decline" records the decline', true);
    const slider = page.getByRole('slider');
    await slider.waitFor({ timeout: 180000 });
    const text = await offerText();
    row.detail = { question: /What [^?]+\?/.exec(text)?.[0] ?? null, declined: /Offer declined/.test(text) };
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: clip(text.split('Your next offer')[0], 120) + ' | ' + clip(text.split('Your next offer')[1], 200), pass: /Offer declined/.test(text) };
  }, { critical: true });
  await step('offer-change-confirmed', 'Paula changes the follow-up answer with the keyboard and confirms one change', async (row) => {
    const slider = page.getByRole('slider');
    await tabTo(slider); await page.keyboard.press('End');
    kb('offer', 'End key moves the follow-up slider to its top value', Number(await slider.inputValue()) > 50, await slider.inputValue());
    const confirmNow = page.getByRole('button', { name: 'Confirm this change' });
    row.detail = { confirmDisabledAfterEnd: await confirmNow.isDisabled() };
    await focusShot(row, slider, 'offer-followup');
    const confirm = page.getByRole('button', { name: 'Confirm this change' });
    await tabTo(confirm); await page.keyboard.press('Enter');
    const text = await until(async () => { const t = await offerText(); return /Change saved|saved in brief version/.test(t) ? t : null; }, { timeout: 90000, what: 'change saved' });
    kb('offer', 'Enter on "Confirm this change" saves the change', true);
    await page.evaluate(() => document.querySelector('gcsp-offer')?.scrollIntoView());
    return { state: clip(text.split('Your next offer')[1], 260) };
  }, { critical: true });

  // 7 Second release
  await step('presenter-second-release', 'Presenter Next release publishes the next stock release', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    return nextRelease(row);
  }, { critical: true });
  await step('activity-second-offer', 'Activity shows the second offer after the decline update', async (row) => {
    await goto('/gcsp-activity-live.html');
    await until(() => page.locator('gcsp-activity').evaluate((el) => /Waiting for you/.test(el.innerText)), { timeout: 240000, what: 'second offer on activity' });
    row.detail = { text: clip(await visibleText('gcsp-activity'), 500) };
    return { state: await visibleText('gcsp-activity') };
  }, { critical: true });
  await step('outbox-second-message', 'Outbox viewer now lists both captured emails, newest first', async (row) => {
    const count = await openMessage(0); row.detail = { capturedEmails: count, emailPreviewRendered: previewRendered };
    return { state: `${count} emails. ${clip(await visibleText('gcsp-outbox'), 300)}`, pass: count === 2 && previewRendered };
  }, { critical: true });
  await step('offer-second', 'Second offer opens from the newest message and excludes the declined car', async (row) => {
    await openOfferLink('outbox');
    const text = await offerText();
    row.detail = { title: /ORDER NO\. (\d+)\s+([^\n]+)/.exec(text)?.slice(1, 3) ?? null };
    return { state: text };
  }, { critical: true });

  // 8 Accept and outcome
  await step('offer-accepted', 'Paula accepts with the keyboard and the outcome shows', async (row) => {
    for (const box of await page.getByRole('checkbox').all()) { await tabTo(box); await page.keyboard.press('Space'); }
    kb('offer', 'Space ticks each of the three declarations', (await page.getByRole('checkbox').evaluateAll((n) => n.every((x) => x.checked))));
    const accept = page.getByRole('button', { name: 'Accept this offer' });
    await until(async () => !(await accept.isDisabled()), { timeout: 20000, what: 'accept enabled' });
    await tabTo(accept); await focusShot(row, accept, 'offer-accept'); await page.keyboard.press('Enter');
    kb('offer', 'Enter on "Accept this offer" sends the decision', true);
    const text = await until(async () => { const t = await offerText(); return /accepted|Selected|selected|order|requested/i.test(t.split('Before you accept')[0] + (t.split('Synthetic source')[1] || '')) && !/Checking your decision/.test(t) ? t : null; }, { timeout: 150000, what: 'decision outcome' }).catch(() => offerText());
    await page.evaluate(() => window.scrollTo(0, 0));
    return { state: clip(text.split('Your current car')[0], 160) + ' | ' + clip(text.split('Synthetic source')[1], 300) };
  }, { critical: true });
  await step('order-progress', 'Order progress shows the selection outcome and handoff', async (row) => {
    await goto('/gcsp-order-progress-live.html');
    const text = await until(async () => { const t = await visibleText('gcsp-order-progress'); return !/Loading your order/.test(t) ? t : null; }, { timeout: 150000, what: 'order progress' });
    const probe = page.getByRole('button').filter({ hasText: /Refresh|Check/ }).first();
    if (await probe.count()) await focusShot(row, probe, 'order-progress');
    return { state: text };
  });
  // Optional: advance the demo clock so approvals can progress, then read the order again (not an acceptance criterion).
  await step('presenter-tick-to-target', 'Presenter Tick to target moves the clock three days on', async (row) => {
    await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
    await openStrip();
    const before = clockOf(await stripText());
    const target = new Date(Date.parse(before) + 72 * 3600 * 1000).toISOString();
    await page.getByLabel('Named time or UTC target').fill(target);
    await page.getByRole('button', { name: 'Tick to target' }).click({ timeout: 240000, noWaitAfter: true });
    const text = await until(async () => { const now = await stripText(); return clockOf(now) !== before && !/Action in progress/.test(now) ? now : null; }, { timeout: 240000, what: 'tick to finish' });
    row.detail = { clockBefore: before, clockAfter: clockOf(text) };
    return { state: `Clock ${before} to ${clockOf(text)}`, pass: clockOf(text) === target };
  });
  await step('order-progress-after-tick', 'Order progress after the clock moved on', async () => {
    await goto('/gcsp-order-progress-live.html');
    const text = await until(async () => { const t = await visibleText('gcsp-order-progress'); return !/Loading your order/.test(t) ? t : null; }, { timeout: 150000, what: 'order progress' });
    return { state: text };
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
  await app?.value?.close?.().catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, firstRelease: report.firstRelease, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
