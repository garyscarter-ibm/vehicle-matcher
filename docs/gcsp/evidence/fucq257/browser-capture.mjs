// FUCQ-257 browser evidence: after a completed handover the account order card is titled as handed over.
// Copied from fucq253/browser-capture.mjs. Real memory runtime + buildServer over loopback HTTP. One viewport per run (FUCQ257_CHUNK=desktop|narrow).
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

const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = process.env.FUCQ257_OUTPUT;
const scratch = process.env.FUCQ257_SCRATCH;
const chunk = process.env.FUCQ257_CHUNK;
const ledgerFile = process.env.FUCQ257_LEDGER || path.join(scratch, 'ledger.json');
assert.ok(output && scratch && ['desktop', 'narrow'].includes(chunk), 'Set FUCQ257_OUTPUT, FUCQ257_SCRATCH and FUCQ257_CHUNK=desktop|narrow');
const narrow = chunk === 'narrow';
const viewport = narrow ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const FAKE_OFFER_ORIGIN = 'https://offer.gcsp.test';
const BASE_PORT = 9260; const DEBUG_PORT = 9269;
const SEED = JSON.parse(await readFile(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const CSP = "script-src 'self'; object-src 'none'; base-uri 'self'";
const report = { state: 'incomplete', chunk, viewport, boundary: 'Real buildServer routes, memory repository and canonical services over loopback HTTP, hosted on gcsp-account.html. Offer read routes only are stubbed in capture 07.',
  cookieMode: null, checks: [], captures: [], errors: [], requests: {}, processes: {}, notes: [], facts: {} };
const resultsFile = path.join(output, `results-${vp}.json`);
const save = () => writeFile(resultsFile, JSON.stringify(report, null, 2) + '\n');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const good = (outcome) => { assert.equal(outcome?.status, 'ok', JSON.stringify(outcome)); return outcome.value; };
const cookieHeader = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
let chrome; let browser; const worlds = []; let portIndex = 0;

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
// Policy delays, handover/return steps and the presenter outcome calls, as in the live test (toScheduled, returnScheduled, pastReturn).
const slotOf = (offered) => offered[0];
async function toScheduled(f, controller, tag) {
  await approve(f, controller); const w = await delays(f);
  const docs = value(controller, 'documents').orders[0]; const task = docs.tasks.find((row) => row.actionable);
  await controller.completeTask(task.itemId); good(await tick(f, `${tag}-documents-ready`, w.documents)); await controller.refresh();
  const slot = slotOf(value(controller, 'appointment').offeredSlots);
  await controller.requestAppointment(slot.slotId); good(await tick(f, `${tag}-confirm`, w.appointment)); await controller.refresh();
  assert.deepEqual([value(controller, 'appointment').state, value(controller, 'documents').orders[0].readiness.ready], ['scheduled', true]);
  return { slot, wait: w };
}
async function returnScheduled(f, controller, w, tag) {
  const plan = value(controller, 'returnPlan'); const pick = slotOf(plan.offeredSlots.separate);
  await controller.requestReturn({ choice: 'separate', slotId: pick.slotId }); good(await tick(f, `${tag}-return-confirm`, w.appointment)); await controller.refresh();
  const returning = value(controller, 'returnPlan'); assert.deepEqual([returning.state, returning.scheduled], ['return-scheduled', true]);
  return pick;
}
async function pastReturn(f, controller, slot, tag) {
  const read = { runId: f.employee.runId, policyVersion: f.employee.policyVersion, asOf: good(await f.clock.now(f.presenter)).now };
  const { delaySecondsAfterSlotEnd } = good(await f.policy.getAssumption('lifecycle.return.outcome.v1', read)).value;
  const gap = (Date.parse(slot.end) + delaySecondsAfterSlotEnd * 1000 - Date.parse(read.asOf)) / 1000;
  good(await tick(f, `${tag}-return-outcome`, Math.max(gap + 1, 1))); await controller.refresh();
}

// ---- One world: runtime, loopback server (static files + API), Chrome context and page ----
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const staticOk = (p) => /^\/(blocks|assets)\//.test(p) || /^\/[^/]+\.(html|css)$/.test(p);

async function makeWorld(label, { returnOutcome = null } = {}) {
  const profile = createCompositionTestProfile();
  let policy;
  if (returnOutcome) {
    const seed = structuredClone(SEED); Object.assign(seed.assumptions.find((a) => a.key === 'lifecycle.return.outcome.v1').value, { enabled: true, outcome: returnOutcome });
    policy = new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } }) });
  }
  const runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile, ...(policy ? { policy } : {}),
    environmentId: `fucq169-${label}`, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: `fucq169-${label}-bootstrap`, sessionNow: () => new Date().toISOString() }));
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
  server.listen(BASE_PORT + portIndex, '127.0.0.1'); portIndex += 1; await once(server, 'listening');
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

async function cap(world, name, { expectText = [], forbidText = [] } = {}) {
  const { page, log } = world;
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')).catch(() => {});
  await wait(150);
  const m = await page.evaluate(probeBody);
  const consoleErrors = log.console.slice(world.logMark); world.logMark = log.console.length;
  const resourceErrors = log.resource.slice(world.resMark); world.resMark = log.resource.length;
  const file = `${vp}-${name}.png`;
  const png = await page.screenshot({ path: path.join(output, file), fullPage: true });
  const entry = { name: `${vp}-${name}`, file, bytesPng: png.length, innerWidth: m.iw, scrollWidth: m.sw,
    horizontalScroll: m.sw > m.iw, wideElements: m.wide, emDash: m.emDash, consoleErrors, resourceErrors, cspViolations: m.csp };
  report.captures.push(entry);
  rec(`${name}:layout`, `${name}: no horizontal scroll, nothing wider than the viewport`, m.sw <= m.iw && !m.wide.length, { scrollWidth: m.sw, innerWidth: m.iw, wide: m.wide });
  rec(`${name}:copy`, `${name}: no em dash in body text`, !m.emDash);
  rec(`${name}:console`, `${name}: no console errors, failed resources or CSP violations`, !consoleErrors.length && !resourceErrors.length && !m.csp.length,
    { consoleErrors, resourceErrors, csp: m.csp });
  for (const [label, pattern] of expectText) rec(`${name}:${label}`, `${name}: ${label}`, pattern.test(m.text), pattern.test(m.text) ? undefined : m.text.slice(0, 500));
  for (const [label, pattern] of forbidText) rec(`${name}:no-${label}`, `${name}: absent: ${label}`, !pattern.test(m.text), pattern.test(m.text) ? m.text.match(pattern)[0] : undefined);
  await save();
  return m.text;
}

async function settle(world) {
  const { page } = world;
  await page.waitForSelector('.gcsp-order-progress', { state: 'attached' });
  await page.waitForFunction(() => !/Loading your order/.test(document.body.innerText) && (Boolean(document.querySelector('.gcsp-order-section')) || /unavailable/i.test(document.body.innerText)));
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
}
async function gotoAccount(world) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await world.page.goto(world.origin + '/gcsp-account.html', { waitUntil: 'domcontentloaded' }); break; } catch (error) { if (attempt) throw error; report.notes.push(`goto retry: ${String(error.message).split('\n')[0]}`); }
  }
  await world.page.waitForFunction(() => /Your order/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await settle(world);
}
async function gotoLive(world) { await world.page.goto(world.origin + '/gcsp-order-progress-live.html'); await settle(world); }

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


// ---- Captures ----
// The history timeline legitimately lists a past "Booked" event, so the live state is checked as "Booked:" and "Not booked yet".
const NO_BOOKED = [['"Booked:" or "Not booked yet" (live state)', /Booked:|Not booked yet/]];
const handoverText = (page) => section(page, 'gcsp-order-handover');
const returnText = (page) => section(page, 'gcsp-order-return');
const buttonsIn = (page, cls) => page.evaluate((c) => [...document.querySelectorAll(`.${c} button`)].map((b) => b.textContent.trim()), cls);
async function newOrder(world) {
  const car = await submitOrder(world); const controller = await open(world, { orderUuid: car.orderUuid }); return { car, controller };
}
const carName = (page) => page.evaluate(() => document.querySelector('.gcsp-order-car-name')?.textContent.trim() ?? null);

// World 1: handover completed (captures 01 and 07).
async function runCompleted() {
  const world = await makeWorld('completed');
  try {
    await openBrowserPage(world); const { page } = world;
    const { car, controller } = await newOrder(world);
    await step('01', async () => {
      const keyed = SEED.assumptions.find((row) => row.key === 'lifecycle.appointments.outcomes.v1').value.states.completed;
      await toScheduled(world, controller, 'c1');
      good(await world.dependencies.gcspAppointments.complete(world.presenter, { orderUuid: car.orderUuid }));
      await gotoAccount(world);
      const label = keyed.stage[0].toUpperCase() + keyed.stage.slice(1);
      await cap(world, '01-handover-tracker', { expectText: [['"Handover complete: <time>"', /Handover complete: \S/],
        ['account card current step', new RegExp(`Current step: ${label}\\.`)], ['order history status', /Status\s*Handed over/]],
      forbidText: [['"Current step: Sent to ordering"', /Current step: Sent to ordering/], ['"Your order is in progress"', /Your order is in progress/]] });
      const title = await page.evaluate(() => document.querySelector('.gcsp-account-order-status h2')?.textContent.trim() ?? null);
      rec('01:title', '01: the account order card is titled "Your car has been handed over"', title === 'Your car has been handed over', title);
      const rows = await page.evaluate(() => [...document.querySelectorAll('.gcsp-order-progress .gcsp-stage-tracker li.gcsp-stage')].map((n) => n.innerText.replace(/\s+/g, ' ').trim()));
      const next = rows.filter((row) => /Next: /.test(row));
      rec('01:one-current', '01: exactly one tracker row carries the owner and next step', next.length === 1, rows);
      rec('01:handover-current', `01: that row is the keyed "${label}" stage with the keyed next step`, next[0]?.startsWith(label) && next[0].includes(keyed.nextStep), next);
      rec('01:sent-done', '01: Sent to ordering is Done with no next step', rows.some((row) => /^Sent to ordering Done/.test(row) && !/Next: /.test(row)), rows);
      report.facts['01'] = { tracker: rows };
    });
    controller.destroy();
  } finally { await closeWorld(world); }
}

try {
  await mkdir(output, { recursive: true }); await mkdir(scratch, { recursive: true });
  const profileDir = path.join(scratch, 'chrome-profile'); await mkdir(profileDir, { recursive: true });
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter',
    '--disable-extensions', '--disk-cache-size=1048576', '--media-cache-size=1048576', `--crash-dumps-dir=${path.join(scratch, 'crashes')}`, 'about:blank'], { stdio: 'ignore', detached: true });
  report.processes.chrome = { pid: chrome.pid, group: chrome.pid, debugPort: DEBUG_PORT };
  await writeFile(ledgerFile, JSON.stringify({ pids: [process.pid, chrome.pid], chromeGroup: chrome.pid }));
  // A fixed debug port writes no DevToolsActivePort file, so poll the version endpoint.
  let ready = false;
  for (let i = 0; i < 300 && !ready; i += 1) { ready = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.ok, () => false); if (!ready) await wait(100); }
  assert.ok(ready, 'Chrome exposes its owned CDP port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  for (const run of [runCompleted]) {
    try { await run(); } catch (error) { report.errors.push({ type: 'world', world: run.name, message: String(error.stack || error.message).slice(0, 800) }); await save(); }
  }
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
