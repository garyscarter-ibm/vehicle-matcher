// FUCQ-239 keyboard walk, one viewport per run (WALK_CHUNK=desktop|phone|narrow = 1280x900, 375x812, 320x700).
// Part A, hosted Main successful journey: Jordan (new order) and Paula (replacement) each open their buddy offer; the "Before you accept" wording is checked against ordering.terms.v1.
// Part B, fresh host: Jordan places a new order by hand; the account's Order history lists it. Spawns `node index.js` in server/ (memory repository, offline, random demo key) on 127.0.0.1.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const env = (name) => process.env[`WALK_${name}`];
const chunk = env('CHUNK');
if (!['desktop', 'phone', 'narrow'].includes(chunk)) throw new Error('Set WALK_CHUNK=desktop|phone|narrow');
const scratch = resolve(env('SCRATCH') || process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set WALK_SCRATCH (or TMPDIR) to an owned scratch directory');
const viewport = { desktop: { width: 1280, height: 900 }, phone: { width: 375, height: 812 }, narrow: { width: 320, height: 700 } }[chunk];
const vp = String(viewport.width);
const port = Number(env('PORT')) || { desktop: 8930, phone: 8931, narrow: 8932 }[chunk];
if (port < 8930 || port > 8949) throw new Error('WALK_PORT must be within 8930-8949');
const only = env('ONLY') ? `-${env('ONLY')}` : ''; // a partial run never overwrites the full run's files
const shotDir = join(HERE, `browser${only}`);
const resultsFile = join(HERE, `results-${vp}${only}.json`);
const profile = join(scratch, `chrome-${chunk}`);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ACCESS_KEY = `walk-${randomBytes(9).toString('hex')}`;

// Expected wording comes from the seed policy, not from typed strings.
const findTerms = (node) => { if (node && typeof node === 'object') { if (node.key === 'ordering.terms.v1' && node.value) return node.value; for (const v of Object.values(node)) { const r = findTerms(v); if (r) return r; } } return null; };
const TERMS = findTerms(JSON.parse(readFileSync(resolve(SERVER_DIR, 'gcsp/policy/seed-v1.json'), 'utf8')));
const WORDING_NEW = TERMS.wordingByMode.new; const WORDING_REPLACEMENT = TERMS.wording;
const REPLACEMENT_ONLY = TERMS.declarations.filter((d) => d.appliesTo === 'replacement').map((d) => d.id);
const ALL_DECLARATIONS = TERMS.declarations.filter((d) => d.appliesTo === 'all').map((d) => d.id);

const git = (...args) => spawnSync('git', args, { cwd: SERVER_DIR, encoding: 'utf8' }).stdout.trim();
const report = { story: 'fucq239', chunk, build: git('rev-parse', '--short', 'HEAD'), branch: git('rev-parse', '--abbrev-ref', 'HEAD'), entry: 'hosted-offline', viewport, state: 'incomplete',
  startedAt: new Date().toISOString(), expected: { wordingNew: WORDING_NEW, wordingReplacement: WORDING_REPLACEMENT, replacementOnlyDeclarations: REPLACEMENT_ONLY },
  steps: [], keyboard: [], consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], externalBlocked: [], blockers: [], notes: [] };
let hostLog = ''; let shots = 0; let context; let page; let app; let child; let halted = null; let origin; let reviewedOrder = null; let focusLog = [];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const save = () => writeFile(resultsFile, `${JSON.stringify(report, null, 2)}\n`);
const killChrome = () => { try {
  const ps = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout ?? '';
  for (const line of ps.split('\n')) if (line.includes(`--user-data-dir=${profile}`)) { try { process.kill(Number(line.trim().split(/\s+/)[0])); } catch { /* gone */ } }
} catch { /* already gone */ } };
const killServer = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome(); killServer(); report.state = 'timeout'; try { writeFileSync(resultsFile, `${JSON.stringify(report, null, 2)}\n`); } catch { /* best effort */ } process.exit(124); });
process.on('exit', () => { killChrome(); killServer(); });

async function until(fn, { timeout = 60000, every = 300, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const last = await fn(); if (last) return last; } catch { /* retry */ } await wait(every); }
  throw new Error(`Timed out waiting for ${what}`);
}
const clip = (text, n = 420) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const bare = (url) => String(url).replace(/[?#].*$/, '');
const isLoopback = (url) => { try { return ['127.0.0.1', 'localhost', ''].includes(new URL(url).hostname); } catch { return false; } };
const overflow = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)).catch(() => null);

async function shot(name, { full = true, selector } = {}) {
  shots += 1;
  const file = `${vp}-${String(shots).padStart(2, '0')}-${name}.png`;
  if (selector) await page.locator(selector).first().screenshot({ path: join(shotDir, file) });
  else await page.screenshot({ path: join(shotDir, file), fullPage: full });
  return `browser/${file}`;
}

// Checks on the changed sections: no em dash anywhere in the visible text; no box with a coloured left/right stripe inside the named sections.
const emDashCount = () => page.evaluate(() => (document.body.innerText.match(/\u2014/g) || []).length).catch(() => 0);
const stripeScan = (selector) => page.evaluate((sel) => {
  const root = document.querySelector(sel); if (!root) return null;
  const hit = [];
  for (const node of [root, ...root.querySelectorAll('*')]) {
    const s = getComputedStyle(node);
    for (const side of ['Left', 'Right']) {
      const width = parseFloat(s[`border${side}Width`]); const style = s[`border${side}Style`]; const color = s[`border${side}Color`];
      if (width > 1 && style !== 'none' && !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(color)) hit.push(`${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)} border-${side.toLowerCase()} ${width}px ${color}`);
    }
    if (/inset/.test(s.boxShadow) && /(?:^|\) )(?:-?[2-9]|-?\d{2,})px 0px 0px/.test(s.boxShadow)) hit.push(`${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)} inset side shadow ${s.boxShadow.slice(0, 60)}`);
  }
  return { scanned: root.querySelectorAll('*').length + 1, hits: hit };
}, selector).catch(() => null);

// A step records pass/fail, observed text, overflow, em dash count, page errors raised during it, focus indicators seen and its screenshots. A failed critical step blocks the rest.
async function step(id, name, run, { critical = false } = {}) {
  const row = { id, name, pass: false, screenshots: [] }; const errors0 = report.pageErrors.length; const began = Date.now(); focusLog = [];
  report.steps.push(row);
  if (halted) { row.blocked = `Blocked by failed step ${halted}`; await save(); return; }
  try {
    const out = await run(row) || {};
    row.overflowPx = await overflow(); row.emDash = await emDashCount();
    row.pageErrors = report.pageErrors.length - errors0;
    row.focus = { activated: focusLog.length, visible: focusLog.filter((f) => f.visible).length, missing: focusLog.filter((f) => !f.visible).map((f) => f.label) };
    row.pass = out.pass !== false && row.overflowPx === 0 && !row.emDash && row.pageErrors === 0 && !row.focus.missing.length && !(row.stripes?.hits?.length); row.state = clip(out.state, 700);
    if (out.detail !== undefined) row.detail = out.detail;
    if (out.shotName) row.screenshots.push(await shot(out.shotName, { full: out.full !== false }));
    for (const extra of out.extraShots ?? []) row.screenshots.push(await shot(extra.name, extra));
  } catch (error) {
    row.error = clip(error.message, 300); row.overflowPx = await overflow(); row.pageErrors = report.pageErrors.length - errors0;
    row.pageText = clip(await page.evaluate(() => document.body.innerText).catch(() => ''), 500);
    try { row.screenshots.push(await shot(`${id}-failed`, { full: false })); } catch { /* page gone */ }
    if (critical) halted = id;
  }
  row.seconds = Math.round((Date.now() - began) / 1000);
  await save();
}

// ---- Keyboard helpers: Tab from the current focus until the target holds it; record the focus indicator on every activated control ----
const isFocused = (locator) => locator.evaluate((el) => el === document.activeElement, undefined, { timeout: 2000 }).catch(() => false);
async function tabTo(locator, { max = 250 } = {}) {
  await locator.first().waitFor({ state: 'attached', timeout: 30000 });
  for (let count = 0; count <= max; count += 1) {
    if (await isFocused(locator.first())) return count;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the control');
}
const kb = (pageName, action, pass, detail) => report.keyboard.push({ page: pageName, check: action, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
// Own outline or box-shadow, or one on the label, parent or an adjacent sibling that draws the ring for a visually hidden input.
const ringNow = () => page.evaluate(() => {
  const el = document.activeElement; if (!el || el === document.body) return { visible: false, label: 'nothing focused' };
  const drawn = (n) => { const s = getComputedStyle(n); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none'); };
  const nearby = [el.closest('label'), el.parentElement, el.nextElementSibling, el.previousElementSibling].filter(Boolean);
  return { visible: Boolean(drawn(el) || nearby.some(drawn)), own: Boolean(drawn(el)), focusVisibleMatch: el.matches(':focus-visible'),
    label: (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 60) };
});
// Tab to the control, record its focus ring, then press Enter (or Space).
async function kbPress(locator, key = 'Enter', pageName = 'page') {
  await tabTo(locator);
  const ring = await ringNow(); focusLog.push(ring);
  kb(pageName, `Tab reaches "${ring.label}" with a visible focus indicator; ${key} activates it`, ring.visible, ring);
  await page.keyboard.press(key);
}
const text = (locator) => locator.first().evaluate((el) => el.innerText).catch(() => '');
const heading = () => page.locator('h1').first().innerText().catch(() => '');
const bodyText = () => page.locator('body').evaluate((el) => el.innerText).catch(() => '');
const button = (name) => page.getByRole('button', { name, exact: true });

// ---- Host ----
async function startHost() {
  origin = `http://127.0.0.1:${port}`;
  const hostEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1',
    GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: ACCESS_KEY, PORT: String(port) };
  child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: hostEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const ready = new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`Host not ready in time: ${clip(output.slice(-300))}`)), 90000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; hostLog = output.slice(-6000); if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`Host exited (${code}): ${clip(output.slice(-300))}`)); });
  });
  await ready;
  report.origin = origin;
  const own = child;
  return { stop: async () => { if (own.exitCode === null) { const gone = once(own, 'exit'); own.kill('SIGTERM'); setTimeout(() => { try { own.kill('SIGKILL'); } catch { /* gone */ } }, 5000).unref(); await gone; } } };
}
async function freshHost() {
  const old = page; page = await context.newPage(); await old.close().catch(() => {});
  await app.stop(); await rm(join(scratch, 'gcsp-stock-inventory'), { recursive: true, force: true });
  app = await startHost(); await context.clearCookies(); halted = null;
}
async function goto(path, ready) {
  await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 120000 });
  if (ready) await ready();
}

// ---- Presenter strip (keyboard) ----
const strip = () => page.locator('.gcsp-presenter-controls');
const stripText = () => strip().evaluate((el) => el.innerText).catch(() => '');
const clockOf = (t) => /DemoClock \(UTC\)\s+(\S+)/.exec(t)?.[1] ?? null;
const runOf = (t) => /\bRun\s+(\S+)/.exec(t)?.[1] ?? null;
const actingOf = (t) => /Acting principal\s+(.+)/.exec(t)?.[1]?.trim() ?? null;
const scenarioOf = (t) => /Scenario\s+(.+)/.exec(t)?.[1]?.trim() ?? null;
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'visible', timeout: 90000 });
  if (!(await root.evaluate((el) => el.open))) { await tabTo(root.locator(':scope > summary')); await page.keyboard.press('Enter'); }
  kb('presenter', 'Enter on "Presenter controls" opens the strip', await root.evaluate((el) => el.open));
  await until(async () => clockOf(await stripText()), { what: 'presenter clock readout', timeout: 90000 });
  await until(async () => (await page.locator('[role=radiogroup][aria-label="Scenario"] [role=radio]').count()) > 0, { timeout: 60000, what: 'catalogue' });
}
async function chooseRadio(groupLabel, target) {
  const scope = `[role=radiogroup][aria-label="${groupLabel}"]`;
  const radios = page.locator(`${scope} [role=radio]`); await radios.first().waitFor({ timeout: 30000 });
  const checked = page.locator(`${scope} [role=radio][aria-checked=true]`);
  const current = async () => (await checked.first().innerText().catch(() => '')).trim();
  await until(async () => (await checked.count()) > 0 && !(await radios.first().isDisabled()), { timeout: 30000, what: `${groupLabel} selection` }).catch(() => {});
  await tabTo((await checked.count()) ? checked : radios.first());
  const total = await radios.count();
  for (let i = 0; i <= total && !(await current()).startsWith(target); i += 1) await page.keyboard.press('ArrowDown');
  const ok = (await current()).startsWith(target);
  kb('presenter', `arrow keys choose "${target}" in "${groupLabel}"`, ok, clip(await current(), 80));
  if (!ok) throw new Error(`Arrow keys did not reach ${target}`);
}
const statuses = () => strip().evaluate((el) => [...el.querySelectorAll('[role=status]')].map((n) => n.innerText.trim()).filter(Boolean));
const settled = () => until(async () => { const s = await statuses(); return !s.some((m) => /Action in progress|Loading readback/.test(m)); }, { timeout: 240000, what: 'strip to settle' });
async function pressStrip(name) {
  const b = button(name);
  await until(async () => !(await b.isDisabled()), { timeout: 60000, what: `${name} enabled` });
  await kbPress(b, 'Enter', 'presenter'); await wait(1500); await settled();
}
async function openPresenter() {
  await goto('/gcsp-presenter.html', () => strip().waitFor({ state: 'attached', timeout: 90000 }));
  await openStrip();
}
async function enterAccessKey() {
  await page.goto(`${origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 120000 });
  const input = page.locator('#key'); await input.waitFor({ timeout: 30000 });
  await tabTo(input); await page.keyboard.type(ACCESS_KEY);
  const typed = (await input.inputValue()).length === ACCESS_KEY.length;
  await page.keyboard.press('Enter');
  await page.waitForURL(/gcsp-presenter\.html/, { timeout: 30000 });
  kb('access', 'Typing the demo key and Enter opens the demo', typed);
  await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
  return typed;
}
// Switch the acting principal with the keyboard; the confirmed switch reloads the workspace.
async function switchTo(name) {
  await openPresenter();
  await chooseRadio('Acting principal', name);
  await kbPress(button('Switch principal'), 'Enter', 'presenter');
  await until(async () => strip().evaluate((el) => !el.open), { timeout: 90000, what: `workspace to reload as ${name}` });
  await openStrip();
  await until(async () => { const t = await stripText(); return (actingOf(t) || '').startsWith(name) && !/Action in progress/.test(t) ? t : null; }, { timeout: 30000, what: `${name} acting` });
}
async function resetScenario(target) {
  await openPresenter();
  const previous = runOf(await stripText());
  await page.waitForLoadState('networkidle').catch(() => {}); await wait(2500);
  await chooseRadio('Scenario', target);
  await pressStrip('Reset scenario'); await button('Confirm reset').waitFor({ timeout: 10000 });
  if (!(await isFocused(button('Confirm reset')))) await tabTo(button('Confirm reset'));
  await page.keyboard.press('Enter');
  kb('presenter', 'Enter on "Confirm reset" resets the scenario', true);
  await wait(2000);
  await until(async () => page.evaluate(async (old) => { const r = await fetch('/api/gcsp/presenter/controls', { credentials: 'same-origin' }); const id = /"runId":"([^"]+)"/.exec(await r.text())?.[1]; return Boolean(id) && id !== old; }, previous), { timeout: 240000, every: 1000, what: 'new run after reset' });
  await page.reload({ waitUntil: 'load' }); await wait(1500);
  await openStrip(); await settled();
  const after = await stripText();
  return { previous, scenario: scenarioOf(after), run: runOf(after), clock: clockOf(after) };
}

// ---- Part A helpers: Jordan's brief, release, outbox and offer ----
// Radio buttons keep one tab stop: Tab to the group's current (or first) radio, then arrow keys move to the wanted one and Space selects it.
async function pickRadio(group, label) {
  const radios = page.locator(`[role=radiogroup][aria-label^="${group}"] [role=radio]`);
  await radios.first().waitFor({ timeout: 30000 });
  const stop = page.locator(`[role=radiogroup][aria-label^="${group}"] [role=radio][tabindex="0"]`);
  await tabTo((await stop.count()) ? stop : radios.first());
  const total = await radios.count();
  for (let i = 0; i <= total; i += 1) {
    if ((await page.evaluate(() => document.activeElement?.innerText.trim())) === label) break;
    await page.keyboard.press('ArrowRight');
  }
  const ring = await ringNow(); focusLog.push(ring);
  if (ring.label !== label) throw new Error(`Arrow keys did not reach ${label} in ${group}`);
  if ((await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'))) !== 'true') await page.keyboard.press('Space');
  const checked = await page.evaluate(() => document.activeElement?.getAttribute('aria-checked'));
  kb('brief', `Tab and arrow keys reach "${label}" in "${group}" with a visible focus indicator; Space selects it`, ring.visible && checked === 'true', { ...ring, checked });
}
async function saveJordanBrief() {
  await goto('/gcsp-brief-live.html', () => button('Save this brief').waitFor({ state: 'attached', timeout: 90000 }));
  await wait(1500);
  await pickRadio('Body style', 'Saloon');
  await pickRadio('Do you need to carry five people', 'Yes');
  await pickRadio('Do you need at least 430 litres', 'No');
  await pickRadio('Do you need a towbar', 'No');
  await pickRadio('Can you charge at home or work', 'No');
  await kbPress(page.getByRole('checkbox', { name: 'Search for cars for me' }), 'Space', 'brief');
  await kbPress(page.getByRole('checkbox', { name: 'Hold a suitable car for me' }), 'Space', 'brief');
  await kbPress(button('Save this brief'), 'Enter', 'brief');
  await until(async () => /Brief version 1/.test(await bodyText()), { timeout: 60000, what: 'Brief version 1 after Save this brief' });
}
// Captured email row for a person, selected by keyboard; Enter on the offer link opens the offer in a new tab.
async function openOfferFromOutbox(who) {
  await goto('/gcsp-outbox.html');
  const rows = page.locator('.gcsp-mail-row'); await rows.first().waitFor({ timeout: 20000 }).catch(() => {});
  const all = await rows.evaluateAll((nodes) => nodes.map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
  const mine = rows.filter({ hasText: who });
  if (!(await mine.count())) return { rows: all, opened: false };
  await tabTo(mine); await page.keyboard.press('Enter');
  kb('outbox', `Enter on the ${who} row opens the captured email`, true);
  const link = page.getByRole('link', { name: /Open the offer/ }); await link.waitFor({ timeout: 30000 });
  await tabTo(link); focusLog.push(await ringNow());
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 30000 }), page.keyboard.press('Enter')]);
  kb('outbox', 'Enter on "Open the offer" opens the offer', true);
  const old = page; page = popup; await old.close();
  await page.waitForLoadState('load');
  const panel = page.locator('section[aria-label="Before you accept"]');
  await panel.waitFor({ timeout: 120000 }).catch(() => {});
  await wait(1000);
  return { rows: all, opened: true, url: bare(page.url()) };
}
const handoffFacts = () => page.evaluate(() => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const sec = document.querySelector('section[aria-label="Before you accept"]'); if (!sec) return null;
  const decls = [...sec.querySelectorAll('input[data-offer-declaration]')].map((i) => ({ id: i.dataset.offerDeclaration, label: norm(i.closest('label')?.innerText || document.querySelector(`label[for="${i.id}"]`)?.innerText) }));
  return { text: norm(sec.innerText), notes: [...sec.querySelectorAll('p.gcsp-note')].map((p) => norm(p.textContent)), declarations: decls,
    rows: [...sec.querySelectorAll('dt')].map((d) => norm(d.textContent)) };
});
async function checkHandoff(row, who, mode) {
  const f = await handoffFacts();
  if (!f) { row.detail = { page: clip(await bodyText(), 500) }; return { pass: false, state: `No "Before you accept" section. ${clip(await bodyText(), 300)}`, shotName: `${who}-offer-no-handoff` }; }
  const wording = f.notes[0] ?? ''; const ids = f.declarations.map((d) => d.id);
  const returnLabels = f.rows.filter((r) => /Car to return|Contract end date|Recorded odometer/.test(r));
  const checks = mode === 'new'
    ? { wordingIsNewText: wording === WORDING_NEW, noReplacementSentence: !/replacement/i.test(f.text), noReturnDeclaration: !ids.some((i) => REPLACEMENT_ONLY.includes(i)) && !/return mileage|old contract/i.test(f.text),
      declarationsExact: ids.length === ALL_DECLARATIONS.length && ALL_DECLARATIONS.every((i) => ids.includes(i)), noReturnCarRows: returnLabels.length === 0 }
    : { wordingIsReplacementText: wording === WORDING_REPLACEMENT, hasReplacementSentence: /For a replacement/.test(wording), hasReturnDeclaration: REPLACEMENT_ONLY.every((i) => ids.includes(i)),
      declarationsAllThree: ids.length === ALL_DECLARATIONS.length + REPLACEMENT_ONLY.length, hasReturnCarRows: returnLabels.length === 3 };
  row.detail = { mode, wording, declarations: f.declarations, rowLabels: f.rows, checks };
  row.stripes = await stripeScan('section[aria-label="Before you accept"]');
  return { pass: Object.values(checks).every(Boolean), state: `${Object.entries(checks).map(([k, v]) => `${k} ${v}`).join('; ')}. Wording: ${clip(wording, 160)}`,
    shotName: `${who}-offer-handoff`, extraShots: [{ name: `${who}-before-you-accept`, selector: 'section[aria-label="Before you accept"]' }] };
}

// ---- Account Order history ----
const historyFacts = () => page.evaluate(() => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const h = document.querySelector('.gcsp-account-histories'); if (!h) return null;
  const entries = [...h.querySelectorAll(':scope > .gcsp-account-history')].map((e) => ({ heading: norm(e.querySelector('h3')?.textContent),
    facts: [...e.querySelectorAll('dl > div')].map((d) => [norm(d.querySelector('dt')?.textContent), norm(d.querySelector('dd')?.textContent)]) }));
  return { text: norm(h.innerText), entries, noHistoryText: /No order history\./.test(h.innerText) };
});
async function checkOrderHistory(row, who, orderNumber) {
  await until(async () => !/Loading your order/.test(await bodyText()), { timeout: 15000, what: 'order progress loaded' }).catch(() => {});
  const f = await historyFacts(); row.stripes = await stripeScan('.gcsp-account-histories');
  if (!f) return { pass: false, state: 'No Order history section on the account', shotName: `${who}-account-no-history-section` };
  const entry = f.entries[0]; const pairs = Object.fromEntries(entry?.facts ?? []);
  const checks = { listsAnEntry: Boolean(entry), noOrderHistoryText: !f.noHistoryText, carNameHeading: Boolean(entry?.heading) && entry.heading !== 'Model not supplied', hasStatus: Boolean(pairs.Status),
    hasOrderReference: Boolean(pairs['Order reference']), hasCarOrderNumber: /^\d{7}$/.test(pairs['Car order number'] ?? ''),
    orderNumberMatchesOutcome: orderNumber ? pairs['Car order number'] === orderNumber : true };
  row.detail = { orderNumber, entry, checks, slotRowShown: (entry?.facts ?? []).some(([k]) => k === 'Vehicle slot'), section: clip(f.text, 500) };
  return { pass: Object.values(checks).every(Boolean), state: `${Object.entries(checks).map(([k, v]) => `${k} ${v}`).join('; ')}. ${clip(f.text, 260)}`,
    shotName: `${who}-account-after-order`, extraShots: [{ name: `${who}-order-history`, selector: '.gcsp-account-histories' }] };
}

// ---- Part B helpers (from the FUCQ-70 walk: Jordan's new order) ----
const enabledButton = (name) => page.locator('button:not([disabled])').filter({ hasText: name });
const EMPTY_TITLES = /No cars have been released yet|No cars are available|No released cars are visible to you yet/;
const galleryFacts = async () => ({ cards: await page.getByRole('button', { name: 'Review this car' }).count(), enabled: await enabledButton('Review this car').count(), status: clip(await text(page.locator('.vm-status')), 240) });
const countdownOf = async () => clip(await text(page.locator('.gcsp-review-countdown')), 80);
const phone = () => page.locator('input[name="contact.phone"]');
async function fillSetup(driverLabel) {
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
  await fillIfEmpty('input[name="phone"]', '07700900123'); await fillIfEmpty('input[name="email"]', 'jordan.test@example.test');
  await kbPress(button('Save choices'));
  await page.getByText('Your choices are saved.').first().waitFor({ timeout: 60000 });
  return chosen;
}
const summaryText = () => text(page.locator('.gcsp-summary-body'));
const boxes = () => page.locator('input[type="checkbox"][data-declaration]');
const submitButton = () => page.getByRole('button', { name: /^(Submit order|Retry the same submission|Submitting order)$/ });
const waitOutcome = () => until(async () => /^(Order received|Order saved|Order not sent)$/.test((await heading()).trim()), { timeout: 60000, what: 'order outcome heading' });
async function submitByKeyboard() {
  await kbPress(page.getByRole('button', { name: 'Continue to order review' }));
  await page.getByRole('heading', { name: 'Review your order', exact: true }).waitFor({ timeout: 60000 });
  await until(async () => /Order review: \d+:\d{2} remaining/.test(await summaryText()), { what: 'order review countdown' });
  await until(async () => (await boxes().count()) > 0, { what: 'declaration checkboxes' });
  const total = await boxes().count();
  for (let i = 0; i < total; i += 1) await kbPress(boxes().nth(i), 'Space');
  const ticked = await boxes().evaluateAll((l) => l.filter((b) => b.checked).length);
  const enabled = await until(async () => submitButton().isEnabled(), { timeout: 5000, what: 'Submit enabled' }).catch(() => false);
  await kbPress(submitButton()); await waitOutcome();
  const t = await text(page.locator('.gcsp-summary-outcome'));
  reviewedOrder = /order number\s*:?\s*(\d+)/i.exec(t)?.[1] ?? null;
  return { total, ticked, enabled, orderNumber: reviewedOrder, heading: (await heading()).trim() };
}

// ---- Part A ----
const jordanBriefStep = (tag) => step(`${tag}-jordan-brief`, 'Switch to Jordan; save his brief (Saloon, five seats, no boot or towbar need, no charging, search and hold) by keyboard', async (row) => {
  await switchTo('Jordan');
  await saveJordanBrief();
  const t = await bodyText(); row.detail = { page: clip(t.slice(0, t.indexOf('Go to your preview')), 300) };
  return { pass: /Brief version 1/i.test(t), state: clip(t.slice(0, t.indexOf('Go to your preview')), 300), shot: false };
}, { critical: true });
const releaseStep = (tag, critical = true) => step(`${tag}-release`, 'Presenter: Next release (keyboard); read the strip result', async (row) => {
  await openPresenter();
  let failure = null;
  let failureBody = null;
  const watch = (r) => { if (r.status() >= 400 && /\/presenter\/controls\/tick$/.test(bare(r.url()))) { failure = r.status(); r.text().then((b) => { failureBody = clip(b, 700); }).catch(() => {}); } };
  page.on('response', watch);
  await pressStrip('Next release');
  page.off('response', watch);
  await wait(500);
  const code = /"handlerOutcome":\{[^}]*"code":"([^"]+)"/.exec(failureBody ?? '')?.[1] ?? null;
  if (failure) row.blocker = `Next release answered HTTP ${failure}, handler buddy-allocation, code ${code}`;
  if (failure) report.blockers.push({ step: row.id, what: row.blocker, source: 'server/gcsp/allocation/index.js: the contender needs a current contract with a contractEndDate (renewal deadline); Jordan has no current car' });
  const t = await stripText(); row.detail = { strip: clip(t, 300), statuses: await statuses(), tickHttpFailure: failure, tickFailureCode: code, tickFailureBody: failureBody };
  return { pass: /released/i.test(t) && !failure, state: `${failure ? `tick answered HTTP ${failure}; ` : ''}${clip((await statuses()).join(' | '), 300)}`, shot: false };
}, { critical });
// Opens the offer from the captured email; checks the handoff wording; on a missing email records the blocker and the person's Buddy activity.
async function offerStep(tag, who, label, mode) {
  let offered = false;
  await step(`${tag}-${who.toLowerCase()}-offer`, `${who}: outbox row, Enter on Open the offer; handoff wording ${mode === 'new' ? "is the policy's new-order text, with no replacement or return wording" : 'keeps the replacement wording and the return declaration'}`, async (row) => {
    await switchTo(who);
    const opened = await openOfferFromOutbox(who).catch((error) => ({ rows: [], opened: false, error: clip(error.message, 200) })); row.detail = { outbox: opened };
    if (!opened.opened) {
      report.blockers.push({ step: row.id, what: `${who} has no captured buddy offer email after the release`, outboxRows: opened.rows, error: opened.error });
      row.blocker = 'no captured offer email';
      return { pass: false, state: `No captured email for ${who}. Rows: ${opened.rows.join(' ;; ') || 'none'}`, shot: false };
    }
    offered = true;
    const result = await checkHandoff(row, label, mode); row.detail.outbox = opened; return result;
  });
  if (!offered) await step(`${tag}-${who.toLowerCase()}-activity`, `Blocker evidence: ${who}'s Buddy activity and brief preview after the release`, async (row) => {
    await switchTo(who);
    await goto('/gcsp-activity-live.html', () => until(async () => !/Loading/.test(await bodyText()) && (await bodyText()).length > 200, { timeout: 60000, what: 'activity page' }));
    await wait(1500);
    const t = await bodyText(); row.detail = { activity: clip(t.slice(t.indexOf('BUDDY ACTIVITY')), 700) };
    row.screenshots.push(await shot(`${label}-buddy-activity`, { full: false }));
    await goto('/gcsp-brief-live.html', () => button('Save this brief').waitFor({ state: 'attached', timeout: 90000 })); await wait(4000);
    const b = await bodyText(); row.detail.brief = clip(b.slice(Math.max(0, b.indexOf('Cars for your brief'))), 400);
    return { pass: true, state: clip(`${row.detail.activity} || ${row.detail.brief}`, 600), shot: false };
  });
  return offered;
}
async function acceptAndAccount(tag, who, label, declarations) {
  await step(`${tag}-${who.toLowerCase()}-accept`, `${who} ticks the ${declarations} declarations (Space) and presses Accept this offer (Enter); the offer reads accepted`, async (row) => {
    const decl = page.locator('input[data-offer-declaration]'); const total = await decl.count();
    for (let i = 0; i < total; i += 1) await kbPress(decl.nth(i), 'Space', 'offer');
    const accept = page.getByRole('button', { name: /Accept this offer/ });
    await until(async () => accept.isEnabled(), { timeout: 15000, what: 'Accept enabled' }).catch(() => {});
    await kbPress(accept, 'Enter', 'offer');
    await until(async () => /Offer accepted|Selection received/.test(await bodyText()), { timeout: 90000, what: 'accepted outcome' });
    const t = await bodyText(); const number = /Car order number\s+(\d{7})/.exec(t)?.[1] ?? null; row.detail = { ticked: total, orderNumber: number, page: clip(t, 400) };
    acceptedOrder = number;
    return { pass: total === declarations, state: clip(t.slice(t.search(/Offer accepted|Selection received/)), 240), shot: false };
  });
  await step(`${tag}-${who.toLowerCase()}-account`, `${who}'s account: Order history lists the accepted order`, async (row) => {
    await goto('/gcsp-account.html', () => page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 }));
    await until(async () => (await page.locator('.gcsp-account-histories').count()) > 0 && !/Loading/.test(await bodyText()), { timeout: 60000, what: 'account loaded' });
    await wait(2500);
    return checkOrderHistory(row, label, acceptedOrder);
  });
}
let acceptedOrder = null;
async function partA() {
  // A1: the default scenario has no seeded briefs, so Jordan is the only buddy participant.
  await step('a1-access', 'Demo key (keyboard) opens the demo on a fresh host; Presenter controls open', async () => {
    const typed = await enterAccessKey(); await openStrip();
    return { pass: typed, state: `scenario ${scenarioOf(await stripText())}`, shot: false };
  }, { critical: true });
  await jordanBriefStep('a1');
  await releaseStep('a1');
  const offered = await offerStep('a1', 'Jordan', 'jordan', 'new');
  if (offered) await acceptAndAccount('a1', 'Jordan', 'jordan-buddy', 2);
  report.jordanOffered = offered;
  halted = null;

  // A2: Main successful journey, Paula holds her seeded brief and gets the offer.
  await step('a2-reset', 'Reset into Main successful journey (keyboard)', async (row) => {
    const back = await resetScenario('Main successful journey'); row.detail = back;
    return { pass: back.scenario === 'Main successful journey' && back.run !== back.previous, state: JSON.stringify(back), shot: false };
  }, { critical: true });
  await releaseStep('a2');
  await offerStep('a2', 'Paula', 'paula', 'replacement');
  await acceptAndAccount('a2', 'Paula', 'paula-buddy', 3);
}
// Optional probe (WALK_PART=C): Jordan and Paula both eligible in the Main journey, then Next release.
async function partC() {
  await step('c-reset', 'Demo key, reset into Main successful journey (keyboard)', async (row) => {
    const typed = await enterAccessKey(); await openStrip();
    const back = await resetScenario('Main successful journey'); row.detail = back;
    return { pass: typed && back.scenario === 'Main successful journey', state: JSON.stringify(back), shot: false };
  }, { critical: true });
  await jordanBriefStep('c');
  await releaseStep('c', false);
  await offerStep('c', 'Jordan', 'jordan-contention', 'new');
}

// ---- Part B ----
async function partB() {
  await freshHost();
  await step('b-account', 'Fresh host: demo key, switch to Jordan; the account offers Start a new order and Order history says "No order history."', async (row) => {
    const typed = await enterAccessKey(); await switchTo('Jordan');
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 90000 });
    await until(async () => (await page.getByRole('button', { name: 'Start a new order' }).count()) > 0, { what: 'Start a new order' }); await wait(1500);
    const f = await historyFacts(); const t = await bodyText();
    row.detail = { history: f && { noHistoryText: f.noHistoryText, entries: f.entries.length } }; row.stripes = await stripeScan('.gcsp-account-histories');
    return { pass: typed && /Jordan/.test(t) && Boolean(f?.noHistoryText) && f.entries.length === 0, state: `Order history before the order: ${clip(f?.text, 120)}`, shotName: 'jordan-account-before-order', full: false };
  }, { critical: true });
  await step('b-setup', 'Start a new order (Enter); setup saved for You: Jordan (fictional)', async (row) => {
    await kbPress(button('Start a new order'));
    const chosen = await fillSetup('You: Jordan (fictional)'); row.detail = chosen;
    return { pass: /Jordan/.test(chosen.driver), state: `${await heading()} | ${JSON.stringify(chosen)}`, shot: false };
  }, { critical: true });
  await step('b-gallery', 'Continue (empty gallery), Next release, Review this car is available', async (row) => {
    await until(async () => button('Continue').isEnabled(), { what: 'Continue enabled' });
    await kbPress(button('Continue'));
    await until(async () => EMPTY_TITLES.test(await bodyText()) || (await page.getByRole('button', { name: 'Review this car' }).count()) > 0, { what: 'empty gallery state' });
    await openPresenterInPlace(); await pressStrip('Next release');
    await page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; });
    const refresh = page.getByRole('button', { name: 'Refresh availability' });
    if (await refresh.count()) await kbPress(refresh);
    await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'released cards', timeout: 15000 }).catch(() => {});
    if (!(await enabledButton('Review this car').count())) { // the release moved the collection window: pick the new first date, as the FUCQ-224 walk does
      await kbPress(button('Back to your choices'));
      await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor({ timeout: 60000 });
      const date = page.locator('input[name="requestedCollectionDate"]');
      await until(async () => (await date.getAttribute('min')) && !(await date.isDisabled()), { what: 'refreshed collection window' });
      await date.fill(await date.getAttribute('min'));
      await kbPress(button('Save choices'));
      await until(async () => /Your choices are saved/.test(await bodyText()), { what: 'choices re-saved' });
      await until(async () => button('Continue').isEnabled(), { what: 'Continue enabled' });
      await kbPress(button('Continue'));
    }
    await until(async () => (await enabledButton('Review this car').count()) > 0, { what: 'released cards', timeout: 30000 });
    row.detail = await galleryFacts();
    return { pass: row.detail.enabled > 0, state: `${row.detail.cards} cards, ${row.detail.enabled} enabled`, shot: false };
  }, { critical: true });
  await step('b-review', 'Review this car (Enter): review with an active countdown', async (row) => {
    await kbPress(enabledButton('Review this car'));
    await page.getByRole('heading', { name: 'Review your car', exact: true }).waitFor({ timeout: 60000 });
    await until(async () => /remaining/.test(await countdownOf()), { what: 'active countdown' });
    return { pass: Boolean(await phone().inputValue().catch(() => '')), state: `${await countdownOf()}`, shot: false };
  }, { critical: true });
  await step('b-order', 'Continue to order review, tick the declarations (Space), Submit (Enter): outcome with an order number', async (row) => {
    const r = await submitByKeyboard(); row.detail = r;
    return { pass: r.total > 0 && r.ticked === r.total && r.enabled === true && /^\d{7}$/.test(r.orderNumber ?? ''), state: `${r.heading} | order ${r.orderNumber}; ${r.ticked}/${r.total} ticked`, shotName: 'jordan-outcome', full: false };
  }, { critical: true });
  await step('b-account-after-order', 'Finish (Enter) returns to the account; Order history lists the order and no longer says "No order history."', async (row) => {
    await kbPress(page.getByRole('button', { name: 'Finish', exact: true }));
    await page.getByRole('heading', { name: 'Your cars' }).first().waitFor({ timeout: 60000 });
    await until(async () => (await bodyText()).includes(reviewedOrder ?? '#none'), { timeout: 30000, what: 'order number on the account' }).catch(() => {});
    await wait(1200);
    return checkOrderHistory(row, 'jordan', reviewedOrder);
  });
}
// Presenter strip already on the current page (the gallery workspace): open it by keyboard.
async function openPresenterInPlace() { await openStrip(); }

// ---- Run ----
async function run() {
  await mkdir(shotDir, { recursive: true }); await mkdir(scratch, { recursive: true });
  await rm(join(scratch, 'gcsp-stock-inventory'), { recursive: true, force: true });
  for (const old of await readdir(shotDir)) if (old.startsWith(`${vp}-`)) await rm(join(shotDir, old), { force: true });
  app = await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport });
  await context.route('**/*', (route) => {
    if (isLoopback(route.request().url())) return route.continue();
    report.externalBlocked.push({ url: bare(route.request().url()), step: report.steps.at(-1)?.id });
    return route.abort();
  });
  context.on('page', (p) => {
    p.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ text: clip(m.text(), 200), url: bare(m.location().url || p.url()), page: bare(p.url()), step: report.steps.at(-1)?.id }); });
    p.on('pageerror', (e) => report.pageErrors.push({ message: clip(e.message, 200), step: report.steps.at(-1)?.id }));
    p.on('requestfailed', (r) => report.failedRequests.push({ url: bare(r.url()), error: r.failure()?.errorText, method: r.method(), step: report.steps.at(-1)?.id }));
    p.on('response', async (r) => {
      if (r.status() < 400) return;
      report.badResponses.push({ status: r.status(), url: bare(r.url()).replace(/^https?:\/\/[^/]+/, ''), method: r.request().method(), step: report.steps.at(-1)?.id });
    });
  });
  page = await context.newPage();
  if (env('PART') === 'C') { await partC(); return; }
  if (env('PART') !== 'B') await partA();
  halted = null;
  if (env('PART') !== 'A') await partB();
}

try { await run(); report.state = report.steps.every((s) => s.pass) ? 'passed' : report.steps.every((s) => s.pass || s.blocker) ? 'passed-with-blocker' : 'completed-with-failures'; }
catch (error) { report.state = 'error'; report.error = clip(error.message, 400); }
finally {
  if (report.blockers.length) report.hostLogTail = hostLog.replace(/walk-[0-9a-f]{18}/g, '<key>').split('\n').slice(-40);
  report.finishedAt = new Date().toISOString();
  report.counts = { steps: report.steps.length, passed: report.steps.filter((s) => s.pass).length, screenshots: shots, keyboardChecks: report.keyboard.length, keyboardPassed: report.keyboard.filter((k) => k.pass).length };
  report.summary = { maxOverflowPx: Math.max(0, ...report.steps.map((s) => s.overflowPx || 0)), pageErrors: report.pageErrors.length, emDashSteps: report.steps.filter((s) => s.emDash).length,
    stripeHits: report.steps.flatMap((s) => s.stripes?.hits ?? []), externalBlocked: report.externalBlocked.length, consoleErrors: report.consoleErrors.length, badResponses: report.badResponses.length,
    focusMissing: report.steps.flatMap((s) => s.focus?.missing ?? []) };
  await save().catch(() => {});
  await context?.close().catch(() => {}); killChrome();
  await app?.stop?.().catch(() => {}); killServer();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(JSON.stringify({ state: report.state, counts: report.counts, summary: { ...report.summary, stripeHits: report.summary.stripeHits.length }, blockers: report.blockers, error: report.error }, null, 1));
  process.exit(report.state === 'error' ? 1 : 0);
}
