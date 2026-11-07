// FUCQ-120 browser evidence for the employee order-progress view. One viewport per run (FUCQ120_CHUNK=desktop|narrow).
// Real memory runtime + buildServer over loopback HTTP; only the offer read routes are stubbed (section C).
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { buildServer } from '../../../../server/index.js';
import { createGcspRuntime } from '../../../../server/gcsp/runtime.js';
import { inputDigest } from '../../../../server/gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider } from '../../../../server/gcsp/policy/index.js';
import { createCompositionTestProfile } from '../../../../server/test/helpers/runtime-composition-profile.js';
import { createOrderProgressHttpAdapter } from '../../../../blocks/gcsp/order-progress/order-progress-http.js';
import { createOrderProgressController } from '../../../../blocks/gcsp/order-progress/order-progress-controller.js';
import { orderProgressFixtureNames } from '../../../../blocks/gcsp/order-progress/fixtures.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = process.env.FUCQ120_OUTPUT;
const scratch = process.env.FUCQ120_SCRATCH;
const chunk = process.env.FUCQ120_CHUNK;
const ledgerFile = process.env.FUCQ120_LEDGER || path.join(scratch, 'ledger.json');
assert.ok(output && scratch && ['desktop', 'narrow'].includes(chunk), 'Set FUCQ120_OUTPUT, FUCQ120_SCRATCH and FUCQ120_CHUNK=desktop|narrow');
const narrow = chunk === 'narrow';
const viewport = narrow ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const FAKE_OFFER_ORIGIN = 'https://offer.gcsp.test';
const SEED = JSON.parse(await readFile(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const CSP = "script-src 'self'; object-src 'none'; base-uri 'self'";
const report = { state: 'incomplete', chunk, viewport, boundary: 'Real buildServer routes, memory repository and canonical services over loopback HTTP. Offer read routes only are stubbed in section C.',
  cookieMode: null, checks: [], captures: [], errors: [], requests: {}, processes: {}, notes: [] };
const resultsFile = path.join(output, `results-${vp}.json`);
const save = () => writeFile(resultsFile, JSON.stringify(report, null, 2) + '\n');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const cookieHeader = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
let chrome; let browser; const worlds = [];

function rec(id, name, pass, detail) { report.checks.push({ id, name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); }
const killChrome = (signal) => { try { if (chrome?.pid) process.kill(-chrome.pid, signal); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome('SIGKILL'); report.state = 'timeout'; try { writeFile(resultsFile, JSON.stringify(report, null, 2)); } catch { /* best effort */ } process.exit(124); });
process.on('exit', () => killChrome('SIGKILL'));

// ---- Real runtime (copied from server/test/gcsp-order-progress-live.test.js) ----
async function tick(f, eventId, bySeconds = 0) {
  let now = good(await f.clock.now(f.presenter));
  if (bySeconds) {
    good(await f.clock.advance(f.presenter, { commandId: `advance:${eventId}`, expectedClockVersion: now.clockVersion, bySeconds }));
    now = good(await f.clock.now(f.presenter));
  }
  return f.clock.tick(f.presenter, { eventId, expectedClockVersion: now.clockVersion, inputDigest: inputDigest(eventId) });
}

async function submitOrder(f) {
  const account = good(await f.request('/api/gcsp/manual/account'));
  const action = account.actions.find((row) => row.enabled);
  const driver = account.choices.drivers.find((row) => row.kind === 'employee');
  const option = account.choices.contractOptions.find((row) => row.schemeIds.includes(f.employee.schemeId) && row.driverKinds.includes(driver.kind));
  const location = account.choices.collectionLocations.find((row) => row.contractOptionIds.includes(option.contractOptionId) && row.driverKinds.includes(driver.kind));
  const choices = { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId, slotId: action.slotId, schemeId: action.schemeId,
    driverId: driver.driverId, contractOptionId: option.contractOptionId, requestedCollectionDate: account.currentContract.earliestCollectionDate,
    collectionLocationId: location.locationId, brand: account.choices.brands[0], contact: account.account.contact,
    expectedReturnMileage: account.currentContract.currentOdometer.value, specialRequirements: '' };
  const post = async (p, body) => (await f.browserFetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  good(await post('/api/gcsp/manual/draft', { commandId: 'op-draft', expectedDraftVersion: 0, expectedContextVersion: account.contextVersion, choices }));
  const car = await f.profile.prepare(f.runtime, f.employee);
  const time = good(await f.clock.now(f.presenter));
  good(await tick(f, 'release-op-stock', (Date.parse('2026-11-05T12:00:00.000Z') - Date.parse(time.now)) / 1000));
  const decision = good(await f.request('/api/gcsp/manual/stock')).decisions.find((row) => row.orderUuid === car.orderUuid);
  const claimed = good(await f.manualClaims.claim(f.employee, { ...decision.claimInput, commandId: 'op-claim' }));
  const reviewed = good(await f.manualClaims.beginReview(f.employee, { commandId: 'op-review', holdId: claimed.hold.holdId,
    expectedHoldVersion: claimed.hold.version, expectedDraftVersion: claimed.quote.draftVersion }));
  const terms = good(await f.manualOrder.readTerms(f.employee));
  const stock = good(await f.repository.read(f.employee, { table: 'stock', key: { runId: f.employee.runId, orderUuid: car.orderUuid } }));
  good(await f.manualOrder.submit(f.employee, { commandId: 'op-submit', source: { type: 'cart', holdId: reviewed.hold.holdId,
    expectedHoldVersion: reviewed.hold.version, expectedDraftVersion: reviewed.quote.draftVersion }, expectedQuoteId: reviewed.quote.quoteId,
    expectedStockVersion: stock.version, termsDigest: terms.termsDigest,
    declarations: Object.fromEntries(terms.declarations.filter((row) => row.appliesTo === 'all' || row.appliesTo === choices.mode).map((row) => [row.id, true])) }));
  return car;
}

const open = async (f, options) => {
  const controller = createOrderProgressController({ adapter: createOrderProgressHttpAdapter({ fetch: f.browserFetch }), ...options, createCommandId: randomUUID });
  await controller.refresh(); return controller;
};
const value = (controller, section) => controller.getState().progress[section].value;
async function delays(f) {
  const read = { runId: f.employee.runId, policyVersion: f.employee.policyVersion, asOf: good(await f.clock.now(f.presenter)).now };
  return { appointment: good(await f.policy.getAssumption('lifecycle.appointments.confirmation.v1', read)).value.confirmDelaySeconds,
    documents: Math.max(...good(await f.policy.getAssumption('lifecycle.documents.v1', read)).value.items.map((row) => row.progressSeconds ?? 0)) };
}
async function approve(f, controller) {
  for (let index = 0; index < 20; index += 1) {
    good(await tick(f, `op-approve-${index}`)); await controller.refresh();
    if (value(controller, 'stages').outcome === 'sent-to-ordering') return;
  }
  assert.fail('the order never reached sent to ordering');
}

// ---- One world: runtime, loopback server (static files + API), Chrome context and page ----
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const staticOk = (p) => /^\/(blocks|assets)\//.test(p) || /^\/[^/]+\.(html|css)$/.test(p);

async function makeWorld(label, { proposeChange = false } = {}) {
  const profile = createCompositionTestProfile();
  let policy;
  if (proposeChange) {
    const seed = structuredClone(SEED); seed.assumptions.find((a) => a.key === 'lifecycle.appointments.scenario.v1').value.proposeChange = true;
    policy = new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } }) });
  }
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile, ...(policy ? { policy } : {}),
    environmentId: `fucq120-${label}`, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: `fucq120-${label}-bootstrap`, sessionNow: () => new Date().toISOString() }));
  const local = good(await runtime.createLocalSession());
  const presenter = good(await runtime.identity.resolveSession({ authorized: true, cookie: cookieHeader(local.setCookie), purpose: 'presenter-control' }));
  let api;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/api/')) return api(req, res);
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const file = path.resolve(ROOT, '.' + pathname);
    if (!staticOk(pathname) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
    readFile(file).then((bytes) => { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP }); res.end(bytes); },
      () => { res.writeHead(404); res.end('Not found'); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const backend = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin, FAKE_OFFER_ORIGIN] });
  api = backend.listeners('request')[0]; good(await backend.gcspStartup);
  const session = cookieHeader(local.setCookie);
  const browserFetch = (p, init = {}) => fetch(origin + p, { ...init, headers: { ...init.headers, Origin: origin, Cookie: session } });
  const request = async (p) => (await browserFetch(p)).json();
  const world = { label, ...runtime, runtime, profile, employee: local.context, presenter, request, browserFetch, origin, server, backend, session,
    setCookie: local.setCookie, port: server.address().port };
  worlds.push(world);
  report.processes[`server-${label}`] = { pid: process.pid, port: world.port };
  await writeFile(ledgerFile, JSON.stringify({ pids: [process.pid, chrome?.pid].filter(Boolean), chromeGroup: chrome?.pid, ports: worlds.map((w) => w.port), note: 'node runs the loopback server in-process' }));
  return world;
}

async function closeWorld(world) {
  try { await world.context?.close(); } catch { /* external supervisor owns processes */ }
  if (world.server?.listening) { world.server.closeAllConnections(); await new Promise((resolve) => world.server.close(resolve)); }
  world.backend?.closeAllConnections();
  try { await world.runtime.close(); } catch { /* already closed */ }
}

function parseCookie(text, host) {
  const parts = text.split(';').map((part) => part.trim()); const at = parts[0].indexOf('=');
  const attrs = Object.fromEntries(parts.slice(1).map((part) => { const ix = part.indexOf('='); return ix < 0 ? [part, true] : [part.slice(0, ix), part.slice(ix + 1)]; }));
  return { name: parts[0].slice(0, at), value: parts[0].slice(at + 1), domain: host, path: attrs.Path, httpOnly: true, attrs, expires: Date.parse(attrs.Expires) / 1000 };
}

// Browser state shared by every capture of one world.
async function openBrowserPage(world) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  world.context = context;
  const parsed = world.setCookie.map((text) => parseCookie(text, '127.0.0.1'));
  // First try the runtime's own attributes (Secure, SameSite=None); fall back to a plain loopback cookie.
  await context.addCookies(parsed.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: true, secure: true, sameSite: 'None', expires: c.expires })));
  let jar = await context.cookies(world.origin);
  report.cookieMode = 'runtime attributes (Secure, SameSite=None) accepted on http://127.0.0.1';
  const probe = await context.request.get(world.origin + '/api/gcsp/manual/account').then((r) => r.json()).catch(() => ({ status: 'error' }));
  if (!jar.length || probe.status !== 'ok') {
    await context.clearCookies();
    await context.addCookies(parsed.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: true, secure: false, sameSite: 'Lax', expires: c.expires })));
    report.cookieMode = 'fallback: Secure and SameSite=None refused on http://127.0.0.1, bootstrap cookie stored Lax, not Secure';
  }
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(world.origin + '/')) return route.continue();
    if (url.startsWith(FAKE_OFFER_ORIGIN + '/') || url.startsWith('data:')) return route.fallback();
    report.errors.push({ type: 'external-request', url }); return route.abort();
  });
  await context.addInitScript(() => {
    window.__csp = [];
    addEventListener('securitypolicyviolation', (event) => { window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`); });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const log = { console: [], resource: [] };
  page.on('requestfailed', (req) => { report.failedRequests ??= []; report.failedRequests.push(`${req.method()} ${new URL(req.url()).pathname} ${req.failure()?.errorText}`); });
  page.on('pageerror', (error) => log.console.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') log.console.push(msg.text()); });
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith('/api/gcsp/')) {
      const envelope = await res.json().then((body) => `${body.status}${body.reason ? `:${String(body.reason).slice(0, 60)}` : ''}`, () => 'non-json');
      const key = `${res.request().method()} ${url.pathname} ${res.status()} ${envelope}`; report.requests[key] = (report.requests[key] || 0) + 1;
    }
    if (res.status() >= 400 && !url.pathname.endsWith('/favicon.ico')) log.resource.push(`${res.status()} ${url.pathname}`);
  });
  world.page = page; world.log = log; world.logMark = 0; world.resMark = 0;
  return page;
}

// ---- Capture and generic checks ----
const probeBody = () => ({ iw: innerWidth, sw: document.scrollingElement.scrollWidth,
  wide: [...document.body.querySelectorAll('*')].map((n) => [n, n.getBoundingClientRect()]).filter(([, r]) => r.width > innerWidth + 0.5)
    .slice(0, 5).map(([n, r]) => `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)} ${Math.round(r.width)}px`),
  emDash: document.body.textContent.includes('\u2014'), csp: window.__csp || [],
  text: document.body.innerText.replace(/\s+/g, ' ').trim() });

async function cap(world, name, { evidence = false, expectText = [] } = {}) {
  const { page, log } = world;
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')).catch(() => {});
  await wait(150);
  const m = await page.evaluate(probeBody);
  const consoleErrors = log.console.slice(world.logMark); world.logMark = log.console.length;
  const resourceErrors = log.resource.slice(world.resMark); world.resMark = log.resource.length;
  const file = `${vp}-${name}.png`;
  const png = await page.screenshot({ path: path.join(scratch, 'raw', file), fullPage: true });
  let jpgBytes = null;
  if (evidence) jpgBytes = (await page.screenshot({ path: path.join(scratch, 'raw', `${vp}-${name}.jpg`), fullPage: true, type: 'jpeg', quality: 70 })).length;
  const entry = { name: `${vp}-${name}`, file, bytesPng: png.length, ...(jpgBytes ? { bytesJpeg: jpgBytes } : {}), evidence, innerWidth: m.iw, scrollWidth: m.sw,
    horizontalScroll: m.sw > m.iw, wideElements: m.wide, emDash: m.emDash, consoleErrors, resourceErrors, cspViolations: m.csp };
  report.captures.push(entry);
  rec(`${name}:layout`, `${name}: no horizontal scroll, nothing wider than the viewport`, m.sw <= m.iw && !m.wide.length, { scrollWidth: m.sw, innerWidth: m.iw, wide: m.wide });
  rec(`${name}:copy`, `${name}: no em dash in body text`, !m.emDash);
  rec(`${name}:console`, `${name}: no console errors, failed resources or CSP violations`, !consoleErrors.length && !resourceErrors.length && !m.csp.length,
    { consoleErrors, resourceErrors, csp: m.csp });
  for (const [label, pattern] of expectText) rec(`${name}:${label}`, `${name}: ${label}`, pattern.test(m.text), pattern.test(m.text) ? undefined : m.text.slice(0, 500));
  await save();
  return m.text;
}

async function settle(world, { none = false } = {}) {
  const { page } = world;
  await page.waitForSelector('.gcsp-order-progress', { state: 'attached' });
  await page.waitForFunction((isNone) => {
    const text = document.body.innerText; if (/Loading your order/.test(text)) return false;
    return isNone ? /No order yet/.test(text) : Boolean(document.querySelector('.gcsp-order-section')) || /unavailable/i.test(text);
  }, none);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
}
const gotoLive = async (world, opts) => { await world.page.goto(world.origin + '/gcsp-order-progress-live.html'); await settle(world, opts); };

async function focusInfo(page) {
  return page.evaluate(() => {
    const a = document.activeElement; const cs = getComputedStyle(a);
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
    return { tag: a.tagName.toLowerCase(), role: a.getAttribute('role'), label: (a.textContent || '').trim().slice(0, 80), focusVisible: a.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth}`, boxShadow: cs.boxShadow === 'none' ? 'none' : 'set', ring: ring && a.matches(':focus-visible') };
  });
}
// Press Tab until the focused element matches `selector`; returns the labels passed through.
async function tabTo(page, selector, max = 80) {
  const trail = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate((sel) => ({ match: document.activeElement.matches(sel), label: (document.activeElement.textContent || document.activeElement.tagName).trim().slice(0, 40) }), selector);
    trail.push(hit.label); if (hit.match) return { found: true, tabs: i + 1, trail };
  }
  return { found: false, tabs: max, trail };
}
const statusText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"]')].map((n) => `${n.getAttribute('role')}:${n.textContent.trim()}`));
async function pressEnterAndRead(world, expected) {
  const { page } = world;
  await page.keyboard.press('Enter');
  const seen = await page.waitForFunction((text) => [...document.querySelectorAll('.gcsp-order-message[role="status"]')].some((n) => n.textContent.trim() === text), expected, { timeout: 8000 })
    .then(() => true, () => false);
  await page.waitForFunction(() => !document.querySelector('.gcsp-order-message')?.textContent.includes('Updating'), null, { timeout: 8000 }).catch(() => {});
  return { announced: seen, status: await statusText(page), focusAfter: await focusInfo(page) };
}
const section = (page, cls) => page.evaluate((c) => document.querySelector(`.${c}`)?.innerText.replace(/\s+/g, ' ').trim() ?? null, cls);
const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
const step = async (id, fn) => { try { await fn(); } catch (error) { rec(id, `${id} ran to completion`, false, String(error.stack || error.message).slice(0, 800)); report.errors.push({ id, message: String(error.message).slice(0, 400) }); await save(); } };

// ---- Sections ----
async function runLive(world) {
  const { page } = world;
  let orderUuid; let car; let controller; let wait_;
  await step('A1', async () => {
    await gotoLive(world, { none: true });
    await cap(world, '01-no-order', { expectText: [['reads "No order yet"', /No order yet/]] });
  });
  await step('A2', async () => {
    car = await submitOrder(world); orderUuid = car.orderUuid;
    await gotoLive(world);
    const defect = await cap(world, '02a-real-account-after-order');
    const after = good(await world.request('/api/gcsp/manual/account'));
    rec('A2:real-account-ready', 'A2: the standalone live page shows the order after a real order, using the real account read (no stub anywhere)',
      /Order no\. \d{7}/.test(defect), { accountState: after.state, pageText: defect.slice(0, 220) });
    await gotoLive(world);
    const text = await cap(world, '02-approval-in-progress', { evidence: true, expectText: [['order number has 7 digits', /Order no\. \d{7}\b/], ['current stage shown (Selection received)', /Selection received/], ['owner shown on the current stage ("With ...")', /With [a-z]+/i], ['next step shown on the current stage ("Next: ...")', /Next: \S/], ['approval in progress, no handover yet', /Handover times open once your order is sent to ordering/]] });
    const current = await page.locator('[aria-current="step"]').count();
    rec('A2:current-step', 'A2 OBSERVATION: some stage carries the "Current step" state (aria-current); the server current stage is already Done here', current >= 1, { count: current });
    rec('A2:owner-copy', 'A2: owner written as "With ..."', /With (the )?[A-Za-z ]+/.test(text), text.match(/With [A-Za-z ]+/)?.[0]);
  });
  await step('A3', async () => {
    controller = await open(world, { orderUuid }); await approve(world, controller);
    await gotoLive(world);
    const text = await cap(world, '03-documents-outstanding', { evidence: true, expectText: [['documents section lists "Your tasks"', /Your tasks/], ['handover not requested, times offered', /Choose a handover time/], ['not ready for handover yet', /Not ready for handover/]] });
    const order = await page.evaluate(() => {
      const s = document.querySelector('.gcsp-order-documents'); const t = s?.innerText || '';
      return { mine: t.indexOf('Your tasks'), others: t.indexOf('Being handled by others'), buttons: [...(s?.querySelectorAll('button') || [])].map((b) => b.textContent.trim()) };
    });
    rec('A3:tasks-first', 'A3: "Your tasks" comes before "Being handled by others" and carries an action button', order.mine >= 0 && (order.others < 0 || order.mine < order.others) && order.buttons.length >= 1, order);
    const slots = await page.locator('.gcsp-order-handover .gcsp-order-slot button').allInnerTexts();
    rec('A3:slots', 'A3: handover not requested, offered slots are buttons', slots.length >= 1 && /^Request /.test(slots[0]), slots);
    rec('A3:stage', 'A3: sent to ordering is the current stage', /Sent to ordering/.test(text));
  });
  await step('B3', async () => {
    await page.goto(world.origin + '/gcsp-account.html');
    await page.waitForFunction(() => /Your order/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    await settle(world);
    await cap(world, '08-account-state3', { expectText: [['"Your order" area present', /Your order/], ['order number', /Order no\. \d{7}\b/], ['stage names', /Sent to ordering/]] });
  });
  await step('A4', async () => {
    await gotoLive(world);
    const t1 = await tabTo(page, '.gcsp-order-documents button');
    rec('A4:tab-task', 'A4: Tab reaches the employee task action', t1.found, { tabs: t1.tabs, trail: t1.trail });
    const f1 = await focusInfo(page);
    rec('A4:task-focus-visible', 'A4: task action shows a visible keyboard focus ring (:focus-visible with outline or box-shadow)', f1.ring, f1);
    await cap(world, '04a-task-focus');
    const r1 = await pressEnterAndRead(world, 'Task completed.');
    rec('A4:task-status', 'A4: Enter completes the task and a status message "Task completed." is announced (role=status)', r1.announced, r1.status);
    rec('A4:task-focus-kept', 'A4: focus stays on a sensible element after the repaint (not lost to body)', r1.focusAfter.tag !== 'body', r1.focusAfter);
    await cap(world, '04b-task-completed', { expectText: [['task shows Complete', /Complete/]] });
    const t2 = await tabTo(page, '.gcsp-order-handover .gcsp-order-slot button');
    rec('A4:tab-slot', 'A4: Tab reaches a handover slot button', t2.found, { tabs: t2.tabs, trail: t2.trail });
    const f2 = await focusInfo(page);
    rec('A4:slot-focus-visible', 'A4: slot button shows a visible keyboard focus ring', f2.ring, f2);
    const r2 = await pressEnterAndRead(world, 'Handover time requested.');
    rec('A4:slot-status', 'A4: Enter requests the slot and "Handover time requested." is announced', r2.announced, r2.status);
    const handover = await section(page, 'gcsp-order-handover');
    rec('A4:requested-not-booked', 'A4: handover reads "Requested ... Not booked yet." and never "Booked"', /Requested .*Not booked yet\./.test(handover || '') && !/Booked/.test(await bodyText(page)), handover);
    await cap(world, '04c-handover-requested');
  });
  await step('A5', async () => {
    wait_ = await delays(world);
    good(await tick(world, 'op-confirm-appointment', wait_.appointment));
    await gotoLive(world);
    const booked = await section(page, 'gcsp-order-handover');
    rec('A5:booked', 'A5: after the tick the handover reads "Booked:"', /Booked:/.test(booked || ''), booked);
    await cap(world, '05-handover-booked');
    const t = await tabTo(page, '.gcsp-order-return .gcsp-order-slot button');
    rec('A5:tab-return', 'A5: Tab reaches a return slot button', t.found, { tabs: t.tabs, trail: t.trail });
    rec('A5:return-focus-visible', 'A5: return slot button shows a visible keyboard focus ring', (await focusInfo(page)).ring);
    const r = await pressEnterAndRead(world, 'Return requested.');
    rec('A5:return-status', 'A5: Enter requests the return and "Return requested." is announced', r.announced, r.status);
    const sections = await page.evaluate(() => {
      const h = document.querySelector('.gcsp-order-handover'); const r2 = document.querySelector('.gcsp-order-return');
      return { separate: Boolean(h && r2 && h !== r2 && !h.contains(r2) && !r2.contains(h)), returnText: r2?.innerText.replace(/\s+/g, ' ') ?? null,
        heading: r2?.querySelector('h2,h3,h4')?.textContent ?? null };
    });
    rec('A5:return-requested', 'A5: return requested, not booked', /Return requested/.test(sections.returnText || '') && /Not booked yet/.test(sections.returnText || '') && !/Return booked/.test(sections.returnText || ''), sections.returnText);
    rec('A5:separate-section', 'A5: return is its own section, separate from Handover, with its own heading', sections.separate && /Returning your current car/.test(sections.heading || ''), sections.heading);
    rec('A5:current-car', 'A5: current car shown in the return section', /Current car/.test(sections.returnText || ''), sections.returnText);
    rec('A5:handover-untouched', 'A5: handover stays Booked while the return is only requested', /Booked:/.test(await section(page, 'gcsp-order-handover') || ''));
    await cap(world, '05b-return-requested', { evidence: true });
  });
  await step('A6', async () => {
    good(await tick(world, 'op-confirm-return', wait_.appointment));
    await gotoLive(world);
    const text = await cap(world, '06-return-booked', { evidence: true, expectText: [['return booked', /Return booked/]] });
    const first = await page.evaluate(() => document.querySelector('.gcsp-order-progress').innerText.replace(/\s+/g, ' '));
    await page.reload(); await settle(world);
    const second = await page.evaluate(() => document.querySelector('.gcsp-order-progress').innerText.replace(/\s+/g, ' '));
    rec('A6:readback', 'A6: reload reads back the same state', first === second && /Return booked/.test(second) && /Booked:/.test(second), first === second ? undefined : { first: first.slice(0, 300), second: second.slice(0, 300) });
    rec('A6:text', 'A6: both handover and return are booked', /Booked:/.test(text) && /Return booked/.test(text));
  });
  await step('B6', async () => {
    await page.goto(world.origin + '/gcsp-account.html');
    await page.waitForFunction(() => /Your order/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
    await settle(world);
    await cap(world, '09-account-state6', { evidence: true, expectText: [['"Your order" area present', /Your order/], ['order number', /Order no\. \d{7}\b/], ['stages shown', /Sent to ordering/], ['return booked shown', /Return booked/]] });
  });
  await step('C', async () => { await runOffer(world, orderUuid, car); });
  controller?.destroy();
}

// Registers the stubbed https offer origin for this world; only /api/gcsp/offers/ reads are stubbed.
async function offerRoute(world, orderUuid, car) {
  const { context } = world;
  const base = JSON.parse(await readFile(path.join(ROOT, 'docs/gcsp/evidence/fucq105/producer-access.json'), 'utf8'));
  const dto = structuredClone(base);
  Object.assign(dto, { state: 'accepted', reason: 'accepted', offerState: 'accepted', holdState: 'allocated', availableActions: [] });
  dto.quote.orderUuid = orderUuid; dto.quote.orderNumber = car.orderNumber; dto.quote.facts.sourceKeys.stockId = orderUuid;
  const stubbed = [];
  await context.route(`${FAKE_OFFER_ORIGIN}/**`, async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.startsWith('/api/gcsp/offers/')) {
      stubbed.push(`${request.method()} ${url.pathname}`);
      const body = request.method() === 'GET' && url.pathname === `/api/gcsp/offers/${encodeURIComponent(dto.offerId)}`
        ? { status: 'ok', value: dto, contractVersion: '1.0.0' } : { status: 'not-found', contractVersion: '1.0.0' };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    const headers = { ...request.headers(), cookie: world.session }; delete headers.host;
    const response = await route.fetch({ url: world.origin + url.pathname + url.search, headers });
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
  });
  return { stubbed, target: `${FAKE_OFFER_ORIGIN}/gcsp-offer.html?offerId=${encodeURIComponent(dto.offerId)}&runId=${encodeURIComponent(dto.runId)}` };
}

async function openOffer(world, route) {
  const { page } = world; const { target } = route;
  // Chrome treats the stubbed https origin as secure, which the offer transport requires; its pages and order APIs are fetched from the real loopback server.
  let attempt = 0; let shown = false;
  while (attempt < 2 && !shown) {
    attempt += 1;
    await page.goto(target);
    shown = await page.waitForFunction(() => /Your order/.test(document.body.innerText) && !/Loading your order/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false);
  }
  return { shown, attempt };
}

async function runOffer(world, orderUuid, car) {
  const { page } = world; const route = await offerRoute(world, orderUuid, car); const { stubbed } = route;
  const { shown, attempt } = await openOffer(world, route);
  rec('C:stub', 'C: offer read stubbed (accepted offer; quote.orderUuid is the real order). Order progress routes are real', shown, { attempts: attempt, stubbedRoutes: [...new Set(stubbed)], note: 'offer read stubbed page served at a stubbed https origin because the offer transport requires https' });
  if (!shown) { report.notes.push('C skipped: the offer projection or page did not show embedded progress after two attempts.'); await cap(world, '10-offer-not-shown'); return; }
  await settle(world);
  await cap(world, '10-offer-accepted', { evidence: true, expectText: [['offer shows accepted', /accepted/i], ['embedded order progress shows order number', /Order no\. \d{7}\b/], ['embedded stages shown', /Sent to ordering/]] });
  rec('C:embedded', 'C: embedded progress is inside the "Your order progress" region', await page.locator('section[aria-label="Your order progress"] .gcsp-order-progress').count() === 1);
}

// Keyboard only: Tab to the control, check the focus ring, press Enter, check the role=status message and where focus went.
async function keyboardOperate(world, { id, label, selector, status, capName, expectText = [] }) {
  const { page } = world;
  const t = await tabTo(page, selector, 150);
  rec(`${id}:tab`, `${id}: Tab alone reaches ${label}`, t.found, { tabs: t.tabs, lastStops: t.trail.slice(-6) });
  const f = await focusInfo(page);
  rec(`${id}:focus-visible`, `${id}: the control shows a visible keyboard focus ring (:focus-visible with outline or box-shadow)`, t.found && f.ring, f);
  const r = await pressEnterAndRead(world, status);
  rec(`${id}:status`, `${id}: Enter produces the role=status message "${status}"`, r.announced, r.status);
  rec(`${id}:focus-kept`, `${id}: focus is not lost to the page body after the repaint`, r.focusAfter.tag !== 'body' && r.focusAfter.ring, r.focusAfter);
  return cap(world, capName, { evidence: true, expectText });
}

async function runProposed() {
  const world = await makeWorld('proposed', { proposeChange: true });
  try {
    await openBrowserPage(world);
    const { page } = world;
    const car = await submitOrder(world);
    const controller = await open(world, { orderUuid: car.orderUuid });
    await step('A7', async () => {
      await approve(world, controller); const wait_ = await delays(world);
      // Keyboard-only checks on the account and offer hosts (this order is at "sent to ordering", task outstanding, slots offered).
      await step('B-kbd', async () => {
        await world.page.goto(world.origin + '/gcsp-account.html');
        await world.page.waitForFunction(() => /Your order/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
        await settle(world);
        await keyboardOperate(world, { id: 'B-kbd', label: 'the employee task action in the embedded "Your order" area', selector: '.gcsp-order-progress .gcsp-order-documents button',
          status: 'Task completed.', capName: '12-account-keyboard', expectText: [['embedded order shown', /Order no\. \d{7}\b/], ['task now complete', /Complete/]] });
      });
      await step('C-kbd', async () => {
        const route = await offerRoute(world, car.orderUuid, car);
        const { shown } = await openOffer(world, route);
        rec('C-kbd:shown', 'C-kbd: offer host (offer read stubbed) shows the embedded order progress', shown);
        await settle(world);
        await keyboardOperate(world, { id: 'C-kbd', label: 'a handover slot button in the embedded order progress', selector: '.gcsp-order-progress .gcsp-order-handover .gcsp-order-slot button',
          status: 'Handover time requested.', capName: '13-offer-keyboard', expectText: [['handover requested, not booked', /Not booked yet/]] });
      });
      await controller.refresh();
      if (value(controller, 'appointment').state === 'not-requested') await controller.requestAppointment(value(controller, 'appointment').offeredSlots[0].slotId);
      good(await tick(world, 'op-propose-appointment', wait_.appointment));
      await gotoLive(world);
      const text = await cap(world, '07a-change-proposed', { evidence: true, expectText: [['New time proposed', /New time proposed/], ['"Accept new time" offered', /Accept new time/], ['not booked yet', /Not booked yet/]] });
      rec('A7:not-booked', 'A7: proposed time is not shown as Booked', !/Booked:/.test(text));
      const help = await page.evaluate(() => ({ present: Boolean(document.querySelector('.gcsp-order-handover .gcsp-order-help')), text: document.querySelector('.gcsp-order-handover .gcsp-order-help')?.innerText.replace(/\s+/g, ' ').slice(0, 160) ?? null }));
      rec('A7:help', 'A7: help entry shown beside the proposed time', help.present, help);
      const t = await tabTo(page, '.gcsp-order-handover .gcsp-order-actions button');
      rec('A7:tab-accept', 'A7: Tab reaches "Accept new time"', t.found && /Accept new time/.test((await focusInfo(page)).label), { tabs: t.tabs, trail: t.trail });
      const f = await focusInfo(page);
      rec('A7:accept-focus-visible', 'A7: Accept new time shows a visible keyboard focus ring', f.ring, f);
      const r = await pressEnterAndRead(world, 'New handover time accepted.');
      rec('A7:accept-status', 'A7: Enter accepts and "New handover time accepted." is announced', r.announced, r.status);
      const handover = await section(page, 'gcsp-order-handover');
      rec('A7:booked', 'A7: after acceptance the handover reads "Booked:"', /Booked:/.test(handover || ''), handover);
      await cap(world, '07b-change-accepted');
    });
    controller.destroy();
  } finally { await closeWorld(world); }
}

async function runHarness(world) {
  const { page } = world;
  const expects = { declined: /Declined/, 'provider-unsupported': null, 'appointment-pending': /Waiting for confirmation of your last update/, 'documents-overdue': /Overdue/,
    'documents-failed': /Failed/, 'ready-for-handover': /Ready for handover/, 'return-unavailable': null, unavailable: /Order progress unavailable/, loading: /Loading your order/, 'partial-failure': /unavailable/i };
  let index = 10;
  for (const name of Object.keys(expects)) {
    index += 1;
    await step(`D:${name}`, async () => {
      assert.ok(orderProgressFixtureNames.includes(name), `unknown fixture ${name}`);
      await page.goto(`${world.origin}/gcsp-order-progress.html?fixture=${name}`);
      await page.waitForSelector('.gcsp-order-progress');
      await wait(200);
      const pattern = expects[name];
      const text = await cap(world, `${index}-fixture-${name}`, { evidence: narrow && ['declined', 'documents-failed'].includes(name), expectText: pattern ? [['shows the expected state', pattern]] : [] });
      report.captures.at(-1).excerpt = text.slice(0, 400);
    });
  }
}

try {
  await mkdir(output, { recursive: true }); await mkdir(path.join(scratch, 'raw'), { recursive: true });
  const profileDir = path.join(scratch, 'chrome-profile'); await mkdir(profileDir, { recursive: true });
  await rm(path.join(profileDir, 'DevToolsActivePort'), { force: true });
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter',
    '--disable-extensions', '--disk-cache-size=1048576', '--media-cache-size=1048576', `--crash-dumps-dir=${path.join(scratch, 'crashes')}`, 'about:blank'], { stdio: 'ignore', detached: true });
  report.processes.chrome = { pid: chrome.pid, group: chrome.pid };
  await writeFile(ledgerFile, JSON.stringify({ pids: [process.pid, chrome.pid], chromeGroup: chrome.pid }));
  let debug;
  for (let i = 0; i < 100 && !debug; i += 1) { try { debug = (await readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split('\n'); } catch { await wait(100); } }
  assert.ok(debug, 'Chrome exposes its owned CDP port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debug[0]}`);

  const main = await makeWorld('main');
  await openBrowserPage(main);
  try {
    await runLive(main);
    await runHarness(main);
  } finally { await closeWorld(main); }
  await runProposed();
  report.state = report.checks.every((c) => c.pass) && !report.errors.length ? 'passed' : 'completed-with-failures';
} catch (error) {
  report.errors.push({ type: 'runner', message: error.stack || error.message }); report.state = 'runner-error'; process.exitCode = 1;
} finally {
  for (const world of worlds) { try { await closeWorld(world); } catch { /* best effort */ } }
  try { await browser?.close(); } catch { /* chrome is killed below */ }
  if (chrome && chrome.exitCode === null) {
    killChrome('SIGTERM'); await Promise.race([once(chrome, 'exit'), wait(1500)]);
    if (chrome.exitCode === null) { killChrome('SIGKILL'); await Promise.race([once(chrome, 'exit'), wait(1500)]); }
  }
  report.summary = { checks: report.checks.length, failed: report.checks.filter((c) => !c.pass).map((c) => c.id), captures: report.captures.length };
  await save();
  console.log(JSON.stringify({ state: report.state, chunk, ...report.summary, errors: report.errors.length }));
}
