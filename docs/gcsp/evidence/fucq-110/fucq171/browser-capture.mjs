// FUCQ-171 browser evidence: terminal handover, no-show and rebooking, returned and missed return, and advanced renewal help, as Paula and Greg.
// Adapted from ../../fucq169/browser-capture.mjs. Real memory runtime and buildServer over loopback HTTP; nothing is stubbed. One viewport per run (FUCQ171_CHUNK=desktop|narrow).
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { buildServer } from '../../../../../server/index.js';
import { createGcspRuntime } from '../../../../../server/gcsp/runtime.js';
import { inputDigest } from '../../../../../server/gcsp/repository/index.js';
import { PolicyService, MemoryPolicyProvider } from '../../../../../server/gcsp/policy/index.js';
import { createDemoStockProvider } from '../../../../../server/gcsp/stock/demo-provider.js';
import { createCompositionTestProfile } from '../../../../../server/test/helpers/runtime-composition-profile.js';
import { good, competingPolicy, assumption, rows, tickTo, resetRun, actAs, confirmed, openLink, readOffer, offerPath } from '../../../../../server/test/helpers/gcsp-journey.js';
import { createOrderProgressHttpAdapter } from '../../../../../blocks/gcsp/order-progress/order-progress-http.js';
import { createOrderProgressController } from '../../../../../blocks/gcsp/order-progress/order-progress-controller.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(fileURLToPath(new URL('../../../../../', import.meta.url)));
const output = path.resolve(process.env.FUCQ171_OUTPUT || HERE);
const scratch = process.env.FUCQ171_SCRATCH;
const chunk = process.env.FUCQ171_CHUNK;
const only = (process.env.FUCQ171_ONLY || '').split(',').filter(Boolean);
const shotDir = path.join(output, 'browser');
const ledgerFile = path.join(scratch || '/', 'ledger.json');
assert.ok(scratch && ['desktop', 'narrow'].includes(chunk), 'Set FUCQ171_SCRATCH and FUCQ171_CHUNK=desktop|narrow');
const narrow = chunk === 'narrow';
const viewport = narrow ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const BASE_PORT = 9160; const DEBUG_PORT = 9169;
const SEED = JSON.parse(await readFile(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
const CSP = "script-src 'self'; object-src 'none'; base-uri 'self'";
const APPT = '/api/gcsp/appointments';
const SCHEME = '/api/gcsp/scheme-team/cases';
const report = { state: 'incomplete', chunk, viewport, startedAt: new Date().toISOString(),
  boundary: 'Real buildServer routes, canonical services and the memory repository over loopback HTTP; the runner serves the same HTML, CSS and blocks from a plain file server. No live external calls, no PostgreSQL.',
  cookieMode: {}, checks: [], captures: [], steps: [], observations: [], errors: [], requests: {}, failedRequests: [], processes: {}, notes: [], facts: {} };
const resultsFile = path.join(output, `results-${vp}.json`);
const save = () => writeFile(resultsFile, JSON.stringify(report, null, 2) + '\n');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cookieHeader = (values) => [values].flat().map((value) => value.split(';')[0]).join('; ');
let chrome; let browser; const worlds = []; let portIndex = 0;

const rec = (id, name, pass, detail) => { report.checks.push({ id, name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); };
const via = (id, mode, what, test) => report.steps.push({ id, via: mode, what, ...(test ? { repeatedBy: test } : {}) });
const observe = (id, severity, text, detail) => report.observations.push({ id, severity, text, ...(detail === undefined ? {} : { detail }) });
const killChrome = (signal) => { try { if (chrome?.pid) process.kill(-chrome.pid, signal); } catch { /* already gone */ } };
process.on('SIGALRM', () => { killChrome('SIGKILL'); report.state = 'timeout'; try { writeFile(resultsFile, JSON.stringify(report, null, 2)); } catch { /* best effort */ } process.exit(124); });
process.on('exit', () => killChrome('SIGKILL'));

// ---- Service-level helpers (as in ../../fucq169 and server/test/gcsp-order-progress-live.test.js) ----
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
const readOf = async (f) => ({ runId: f.employee.runId, policyVersion: f.employee.policyVersion, asOf: good(await f.clock.now(f.presenter)).now });
const keyed = async (f, key) => good(await f.policy.getAssumption(key, await readOf(f))).value;
async function delays(f) {
  const docs = await keyed(f, 'lifecycle.documents.v1');
  return { appointment: (await keyed(f, 'lifecycle.appointments.confirmation.v1')).confirmDelaySeconds, documents: Math.max(...docs.items.map((row) => row.progressSeconds ?? 0)) };
}
async function approve(f, controller) {
  for (let index = 0; index < 20; index += 1) {
    good(await tick(f, `op-approve-${index}`)); await controller.refresh();
    if (value(controller, 'stages').outcome === 'sent-to-ordering') return;
  }
  assert.fail('the order never reached sent to ordering');
}
const slotOf = (offered) => offered[0];
// Booked, not ready: the employee's document task is left undone, so the keyed readiness items still block completion.
async function toBookedNotReady(f, controller, tag) {
  await approve(f, controller); const w = await delays(f);
  const slot = slotOf(value(controller, 'appointment').offeredSlots);
  await controller.requestAppointment(slot.slotId); good(await tick(f, `${tag}-confirm`, w.appointment)); await controller.refresh();
  assert.deepEqual([value(controller, 'appointment').state, value(controller, 'documents').orders[0].readiness.ready], ['scheduled', false]);
  return { slot, wait: w };
}
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
  const read = await readOf(f);
  const { delaySecondsAfterSlotEnd } = good(await f.policy.getAssumption('lifecycle.return.outcome.v1', read)).value;
  const gap = (Date.parse(slot.end) + delaySecondsAfterSlotEnd * 1000 - Date.parse(read.asOf)) / 1000;
  good(await tick(f, `${tag}-return-outcome`, Math.max(gap + 1, 1))); await controller.refresh();
}

// ---- One world: runtime, loopback server (static files + API) and Chrome contexts ----
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const staticOk = (p) => /^\/(blocks|assets)\//.test(p) || /^\/[^/]+\.(html|css)$/.test(p);

async function makeWorld(label, { kind = 'manual', returnOutcome = null } = {}) {
  let runtime; let profile; let seed;
  if (kind === 'manual') {
    profile = createCompositionTestProfile();
    let policy;
    if (returnOutcome) {
      seed = structuredClone(SEED); Object.assign(seed.assumptions.find((a) => a.key === 'lifecycle.return.outcome.v1').value, { enabled: true, outcome: returnOutcome });
      policy = new PolicyService({ provider: new MemoryPolicyProvider({ seedProvider: { async loadVersions() { return [seed]; } } }) });
    }
    runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: profile, ...(policy ? { policy } : {}),
      environmentId: `fucq171-${label}`, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: `fucq171-${label}-bootstrap`, sessionNow: () => new Date().toISOString() }));
  } else {
    // The launcher's own composition (demo stock, offer journey adopted, Alex given Paula's grade as in the e2e tests), minus its HTTPS front.
    const competing = await competingPolicy(); seed = competing.seed;
    runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy: competing.policy,
      environmentId: `fucq171-${label}`, policyAsOf: seed.effectiveFrom, commandId: `fucq171-${label}-bootstrap` }));
  }
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
  const backend = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin] });
  api = backend.listeners('request')[0]; good(await backend.gcspStartup);
  const world = { label, kind, ...runtime, runtime, services: runtime, profile, seed, origin, server, backend, port: server.address().port, counter: 0, actors: [] };
  world.reopenPresenter = async () => {
    const next = good(await runtime.identity.createPresenterSession(`fucq171-presenter-${label}-${++world.counter}`));
    world.presenterCookie = cookieHeader(next.setCookie); world.presenter = world.context = next.context;
  };
  world.api = async (p, { body, session, method } = {}) => {
    const response = await fetch(origin + p, { method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { Origin: origin, Cookie: session ?? world.presenterCookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, json: await response.json(), headers: response.headers };
  };
  if (kind === 'manual') {
    const local = good(await runtime.createLocalSession());
    world.session = cookieHeader(local.setCookie); world.setCookie = local.setCookie; world.employee = local.context;
    world.presenter = world.context = good(await runtime.identity.resolveSession({ authorized: true, cookie: world.session, purpose: 'presenter-control' }));
    world.presenterCookie = cookieHeader(good(await runtime.identity.createPresenterSession(`fucq171-presenter-${label}`)).setCookie);
    world.browserFetch = (p, init = {}) => fetch(origin + p, { ...init, headers: { ...init.headers, Origin: origin, Cookie: world.session } });
    world.request = async (p) => (await world.browserFetch(p)).json();
  } else await world.reopenPresenter();
  worlds.push(world);
  report.processes[`server-${label}`] = { pid: process.pid, port: world.port, note: 'in-process loopback server' };
  await writeFile(ledgerFile, JSON.stringify({ pids: [process.pid, chrome?.pid].filter(Boolean), chromeGroup: chrome?.pid, ports: worlds.map((w) => w.port) }));
  return world;
}
async function closeWorld(world) {
  for (const actor of world.actors) { try { await actor.context.close(); } catch { /* browser killed later */ } }
  if (world.server?.listening) { world.server.closeAllConnections(); await new Promise((resolve) => world.server.close(resolve)); }
  world.backend?.closeAllConnections();
  try { await world.runtime.close(); } catch { /* already closed */ }
}
function parseCookie(text, host) {
  const parts = text.split(';').map((part) => part.trim()); const at = parts[0].indexOf('=');
  const attrs = Object.fromEntries(parts.slice(1).map((part) => { const ix = part.indexOf('='); return ix < 0 ? [part, true] : [part.slice(0, ix), part.slice(ix + 1)]; }));
  return { name: parts[0].slice(0, at), value: parts[0].slice(at + 1), domain: host, path: attrs.Path, httpOnly: true, ...(Number.isFinite(Date.parse(attrs.Expires)) ? { expires: Date.parse(attrs.Expires) / 1000 } : {}) };
}
// One browser context (and page) per principal. The session cookie is injected, as in ../../fucq169; the runtime's own attributes first, then a plain loopback cookie.
async function openActor(world, name, setCookie, probePath) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const parsed = [setCookie].flat().map((text) => parseCookie(text, '127.0.0.1'));
  await context.addCookies(parsed.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: true, secure: true, sameSite: 'None', ...(c.expires ? { expires: c.expires } : {}) })));
  report.cookieMode[`${world.label}:${name}`] = 'runtime attributes (Secure, SameSite=None) accepted on http://127.0.0.1';
  const probe = await context.request.get(world.origin + probePath).then((r) => r.json()).catch(() => ({ status: 'error' }));
  if (probe.status !== 'ok') {
    await context.clearCookies();
    await context.addCookies(parsed.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: true, secure: false, sameSite: 'Lax', ...(c.expires ? { expires: c.expires } : {}) })));
    report.cookieMode[`${world.label}:${name}`] = 'fallback: Secure and SameSite=None refused on http://127.0.0.1, session cookie stored Lax, not Secure';
  }
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(world.origin + '/') || url.startsWith('data:')) return route.continue();
    report.errors.push({ type: 'external-request', url }); return route.abort();
  });
  await context.addInitScript(() => { window.__csp = []; addEventListener('securitypolicyviolation', (event) => { window.__csp.push(`${event.violatedDirective} ${event.blockedURI}`); }); });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const actor = { name, world, context, page, console: [], resource: [], consoleMark: 0, resourceMark: 0 };
  page.on('requestfailed', (req) => { const text = `${req.method()} ${new URL(req.url()).pathname} ${req.failure()?.errorText}`; if (!/ERR_ABORTED/.test(text)) report.failedRequests.push(text); });
  page.on('pageerror', (error) => actor.console.push(`pageerror: ${error.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') actor.console.push(msg.text()); });
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith('/api/gcsp/')) {
      const envelope = await res.json().then((body) => `${body.status}${body.reason ? `:${String(body.reason).slice(0, 60)}` : ''}`, () => 'non-json');
      const key = `${name} ${res.request().method()} ${url.pathname} ${res.status()} ${envelope}`; report.requests[key] = (report.requests[key] || 0) + 1;
    }
    if (res.status() >= 400 && !url.pathname.endsWith('/favicon.ico')) actor.resource.push(`${res.status()} ${url.pathname}`);
  });
  world.actors.push(actor);
  return actor;
}
const principalCookie = async (world, name) => {
  const switched = await world.api('/api/gcsp/session/switch', { body: { principalId: `demo-${name}`, commandId: `fucq171-as-${name}-${++world.counter}` } });
  assert.equal(switched.status, 200, JSON.stringify(switched.json));
  return switched.headers.getSetCookie();
};

// ---- Capture and generic checks ----
// A wide element only counts when no ancestor scrolls it sideways (a table in its own overflow-x box is allowed).
const probeBody = () => {
  const contained = (n) => { for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) return true; return false; };
  const all = [...document.body.querySelectorAll('*')].map((n) => [n, n.getBoundingClientRect()]).filter(([, r]) => r.width > innerWidth + 0.5);
  const fmt = ([n, r]) => `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)} ${Math.round(r.width)}px`;
  return { iw: innerWidth, sw: document.scrollingElement.scrollWidth, wide: all.filter(([n]) => !contained(n)).slice(0, 5).map(fmt),
    scrollContained: all.filter(([n]) => contained(n) && n.tagName === 'TABLE').map(fmt),
    emDash: document.body.textContent.includes('\u2014'), csp: window.__csp || [], text: document.body.innerText.replace(/\s+/g, ' ').trim() };
};

async function cap(actor, name, { expectText = [], forbidText = [], shot = true } = {}) {
  const { page } = actor;
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]')).catch(() => {});
  await wait(150);
  const m = await page.evaluate(probeBody);
  const consoleErrors = actor.console.slice(actor.consoleMark); actor.consoleMark = actor.console.length;
  let resourceErrors = actor.resource.slice(actor.resourceMark); actor.resourceMark = actor.resource.length;
  // An employee-only session on a page with the presenter strip gets a 403 from the presenter controls read: recorded once as an observation, not as a failure.
  const known = resourceErrors.filter((r) => r === '403 /api/gcsp/presenter/controls');
  if (known.length) {
    resourceErrors = resourceErrors.filter((r) => !known.includes(r)); let drop = known.length;
    for (let i = consoleErrors.length - 1; i >= 0 && drop; i -= 1) if (/status of 403/.test(consoleErrors[i])) { consoleErrors.splice(i, 1); drop -= 1; }
    if (!report.observations.some((o) => o.id === 'presenter-controls-403')) observe('presenter-controls-403', 'Low', 'Pages with the presenter strip read /api/gcsp/presenter/controls as an employee-only session and log a 403 in the console on each load; nothing shows on screen.', { firstSeen: name });
  }
  const file = `${vp}-${name}.png`;
  const entry = { name: `${vp}-${name}`, as: actor.name, innerWidth: m.iw, scrollWidth: m.sw, horizontalScroll: m.sw > m.iw, wideElements: m.wide, scrollContained: m.scrollContained, emDash: m.emDash, consoleErrors, resourceErrors, cspViolations: m.csp };
  if (shot) { await mkdir(shotDir, { recursive: true }); const png = await page.screenshot({ path: path.join(shotDir, file), fullPage: true }); Object.assign(entry, { file: `browser/${file}`, bytesPng: png.length }); }
  report.captures.push(entry);
  rec(`${name}:layout`, `${name}: no horizontal scroll, nothing wider than the viewport`, m.sw <= m.iw && !m.wide.length, { scrollWidth: m.sw, innerWidth: m.iw, wide: m.wide });
  rec(`${name}:copy`, `${name}: no em dash in body text`, !m.emDash);
  rec(`${name}:console`, `${name}: no console errors, failed resources or CSP violations`, !consoleErrors.length && !resourceErrors.length && !m.csp.length, { consoleErrors, resourceErrors, csp: m.csp });
  for (const [label, pattern] of expectText) rec(`${name}:${label}`, `${name}: ${label}`, pattern.test(m.text), pattern.test(m.text) ? undefined : m.text.slice(0, 600));
  for (const [label, pattern] of forbidText) rec(`${name}:no-${label}`, `${name}: absent: ${label}`, !pattern.test(m.text), pattern.test(m.text) ? m.text.match(pattern)[0] : undefined);
  await save();
  return m.text;
}
async function settleOrder(actor) {
  const { page } = actor;
  await page.waitForSelector('.gcsp-order-progress', { state: 'attached' });
  await page.waitForFunction(() => !/Loading your order/.test(document.body.innerText) && (Boolean(document.querySelector('.gcsp-order-section')) || /unavailable/i.test(document.body.innerText)));
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
}
async function gotoPage(actor, file, ready) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { await actor.page.goto(actor.world.origin + file, { waitUntil: 'domcontentloaded' }); break; } catch (error) { if (attempt) throw error; report.notes.push(`goto retry: ${String(error.message).split('\n')[0]}`); }
  }
  await ready(actor);
}
const gotoAccount = (actor) => gotoPage(actor, '/gcsp-account.html', async (a) => {
  await a.page.waitForFunction(() => /Your order/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {}); await settleOrder(a);
});
const gotoHelp = (actor) => gotoPage(actor, '/gcsp-help.html', async (a) => {
  await a.page.waitForFunction(() => /Renewal help/.test(document.body.innerText) && !/Loading your cases/.test(document.body.innerText), null, { timeout: 20000 });
  await a.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
});
const gotoQueue = (actor) => gotoPage(actor, '/gcsp-case-queue.html', async (a) => {
  await a.page.waitForFunction(() => /Renewal cases/.test(document.body.innerText) && !/Loading renewal cases/.test(document.body.innerText), null, { timeout: 20000 });
  await a.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
});

async function focusInfo(page) {
  return page.evaluate(() => {
    const a = document.activeElement; const cs = getComputedStyle(a);
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
    return { tag: a.tagName.toLowerCase(), id: a.id || null, label: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 80), focusVisible: a.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth}`, boxShadow: cs.boxShadow === 'none' ? 'none' : 'set', ring: ring && a.matches(':focus-visible') };
  });
}
// Press Tab until the focused element matches a CSS selector or (for buttons) its text; records whether the focus ring shows.
async function tabTo(actor, id, matcher, max = 160) {
  const { page } = actor; const trail = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(([kind, m]) => { const a = document.activeElement; const text = (a.textContent || '').trim();
      return { match: kind === 'css' ? a.matches(m) : (['BUTTON', 'SUMMARY'].includes(a.tagName) && new RegExp(m).test(text)), label: text.slice(0, 40) || a.tagName }; },
    matcher instanceof RegExp ? ['text', matcher.source] : ['css', matcher]);
    trail.push(hit.label);
    if (hit.match) {
      const f = await focusInfo(page); rec(`${id}:tab`, `${id}: Tab alone reaches the control (${i + 1} presses)`, true, { tabs: i + 1 });
      rec(`${id}:focus-ring`, `${id}: the focused control shows a visible focus ring`, f.ring, f); return f;
    }
  }
  rec(`${id}:tab`, `${id}: Tab alone reaches the control`, false, { tabs: max, lastStops: trail.slice(-6) });
  throw new Error(`Tab never reached ${id}`);
}
const statusText = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"],[role="alert"]')].map((n) => `${n.getAttribute('role')}:${n.textContent.trim()}`));
async function pressEnterAndWait(actor, id, expected, selector = '[role="status"]') {
  await actor.page.keyboard.press('Enter');
  const seen = await actor.page.waitForFunction(([sel, text]) => [...document.querySelectorAll(sel)].some((n) => n.textContent.trim() === text), [selector, expected], { timeout: 15000 }).then(() => true, () => false);
  await actor.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 }).catch(() => {});
  const status = await statusText(actor.page);
  rec(`${id}:status`, `${id}: Enter produces the status message "${expected}"`, seen, status);
  const after = await focusInfo(actor.page); rec(`${id}:focus-kept`, `${id}: focus is not lost to the page body`, after.tag !== 'body', after);
  return seen;
}
// Selects an option from a native select with the keyboard (type-ahead); falls back to selectOption and says so.
async function chooseOption(actor, id, selector, optionText) {
  await tabTo(actor, id, selector);
  const read = () => actor.page.evaluate((sel) => { const s = document.querySelector(sel); return s.options[s.selectedIndex]?.textContent.trim(); }, selector);
  if (optionText === null) {
    await actor.page.keyboard.press('ArrowDown'); let first = await read();
    if (/^Choose/.test(first ?? '')) { report.notes.push(`${id}: ArrowDown did not change the select, used selectOption index 1`); await actor.page.selectOption(selector, { index: 1 }); first = await read(); }
    rec(`${id}:chosen`, `${id}: ArrowDown selects the first real option`, Boolean(first) && !/^Choose/.test(first), first); return first;
  }
  await actor.page.keyboard.type(optionText.slice(0, 4), { delay: 40 });
  let got = await read();
  if (got !== optionText) {
    report.notes.push(`${id}: keyboard type-ahead gave "${got}", used selectOption for "${optionText}"`);
    await actor.page.selectOption(selector, { label: optionText }); got = await read();
  }
  rec(`${id}:chosen`, `${id}: the select reads "${optionText}"`, got === optionText, got);
}
async function typeInto(actor, id, selector, text, replace = false) {
  await tabTo(actor, id, selector);
  if (replace) await actor.page.keyboard.press('ControlOrMeta+A');
  await actor.page.keyboard.type(text, { delay: 5 });
}
const section = (page, cls) => page.evaluate((c) => document.querySelector(`.${c}`)?.innerText.replace(/\s+/g, ' ').trim() ?? null, cls);
const buttonsIn = (page, cls) => page.evaluate((c) => [...document.querySelectorAll(`.${c} button`)].map((b) => b.textContent.trim()), cls);
const step = async (id, fn) => { try { await fn(); } catch (error) { rec(id, `${id} ran to completion`, false, String(error.stack || error.message).slice(0, 800)); report.errors.push({ id, message: String(error.message).slice(0, 400) }); await save(); } };
const NO_BOOKED = [['"Booked:" or "Not booked yet" (live state)', /Booked:|Not booked yet/]];
const carName = (page) => page.evaluate(() => document.querySelector('.gcsp-order-car-name')?.textContent.trim() ?? null);
const currentCarCard = (page) => page.evaluate(() => { const n = [...document.querySelectorAll('*')].filter((x) => /^your current car/i.test(x.innerText?.trim() ?? '') && x.innerText.length > 40 && x.innerText.length < 500).pop(); return n ? n.innerText.replace(/\s+/g, ' ').trim().slice(0, 160) : null; });
async function newOrder(world) { const car = await submitOrder(world); const controller = await open(world, { orderUuid: car.orderUuid }); return { car, controller }; }
// Paula's own reads over the routes the page uses.
const returnPlanOf = async (world, order) => good(await (await world.browserFetch(`/api/gcsp/return-plan?orderUuid=${order}`)).json());
const handoverOf = async (world, order) => good(await (await world.browserFetch(`${APPT}?orderUuid=${order}`)).json());

// ---- World 1: handover completion is blocked until ready, then completes and the current car changes (manual order, FUCQ-72) ----
async function runHandover() {
  const world = await makeWorld('handover');
  try {
    const paula = await openActor(world, 'paula', world.setCookie, '/api/gcsp/manual/account'); const { page } = paula;
    const { car, controller } = await newOrder(world); const outcomes = await keyed(world, 'lifecycle.appointments.outcomes.v1'); let w;
    await step('01', async () => {
      ({ wait: w } = await toBookedNotReady(world, controller, 'h1'));
      const refused = await world.api(`${APPT}/complete`, { body: { orderUuid: car.orderUuid } });
      rec('01:refused', '01: completing before readiness is refused as a conflict "handover-not-ready" with the keyed owner and next step',
        refused.status === 409 && refused.json.code === 'handover-not-ready' && refused.json.owner === outcomes.notReady.owner && refused.json.nextStep === outcomes.notReady.nextStep, { status: refused.status, body: refused.json });
      rec('01:still-scheduled', '01: the appointment is still scheduled after the refusal', (await handoverOf(world, car.orderUuid)).state === 'scheduled');
      via('01', 'api', 'Presenter route POST /api/gcsp/appointments/complete refused (409). The browser has no completion control.', "'FUCQ-171 manual handoff lifecycle' step 3 and 'no-show then rebooking' step 6");
      await gotoAccount(paula);
      await cap(paula, '01-handover-blocked', { expectText: [['"Booked: <time>"', /Booked: \S/], ['"Not ready for handover. Still to do:"', /Not ready for handover\. Still to do: \S/]], forbidText: [['"Handover complete"', /Handover complete/]] });
      report.facts['01'] = { refused: { status: refused.json.status, code: refused.json.code, owner: refused.json.owner, nextStep: refused.json.nextStep, blocking: refused.json.readiness?.blocking }, handover: await section(page, 'gcsp-order-handover'), documents: await section(page, 'gcsp-order-documents') };
    });
    await step('02', async () => {
      await gotoAccount(paula);
      await tabTo(paula, '02:acknowledge', /^Acknowledge the agreement$/);
      await pressEnterAndWait(paula, '02:acknowledge', 'Task completed.', '.gcsp-order-message[role="status"]');
      via('02a', 'browser', 'Paula acknowledges the agreement with Tab and Enter (the only document task she owns).');
      good(await tick(world, 'h2-documents-ready', w.documents)); await controller.refresh();
      rec('02:ready', '02: after the keyed document and preparation times the order is ready', value(controller, 'documents').orders[0].readiness.ready === true);
      const done = await world.api(`${APPT}/complete`, { body: { orderUuid: car.orderUuid } });
      rec('02:completed', '02: the presenter completion route answers 200 with state completed and the keyed owner and next step',
        done.status === 200 && done.json.value.state === 'completed' && done.json.value.owner === outcomes.states.completed.owner && done.json.value.nextStep === outcomes.states.completed.nextStep, { status: done.status, state: done.json.value?.state });
      via('02b', 'api', 'Presenter route POST /api/gcsp/appointments/complete (200). The readiness time is reached by a service tick in this runner; the presenter strip Tick controls drive the same clock (the FUCQ-124 walkthrough clicks them).', "'FUCQ-171 manual handoff lifecycle' steps 4 and 5");
      const plan = await returnPlanOf(world, car.orderUuid);
      rec('02:current-car', '02: the current car is now the new order; the old contract is held and separate', plan.relationship.currentCar.kind === 'order' && plan.relationship.currentCar.orderUuid === car.orderUuid
        && plan.relationship.oldCar.status === 'held' && plan.relationship.newCar.status === 'collected', plan.relationship);
      await gotoAccount(paula);
      const text = await cap(paula, '02-handover-completed', { expectText: [['"Handover complete: <time>"', /Handover complete: \S/], ['completion sentence', /Your handover is complete\./], ['readiness "Ready for handover"', /Ready for handover/]], forbidText: NO_BOOKED });
      const card = await currentCarCard(page); const name = await carName(page);
      report.facts['02'] = { newCar: name, currentCarCard: card, returnSection: await section(page, 'gcsp-order-return') };
      rec('02:no-handover-buttons', '02: no handover buttons after completion', (await buttonsIn(page, 'gcsp-order-handover')).length === 0);
      if (card && !card.includes(name)) observe('current-car-card-after-completion', 'Medium (same area as FUCQ-252)', 'After the handover is completed (before any return) the Your cars current-car card still shows the old contract car as current, while the return plan relationship names the new order.', { card, newCar: name });
      void text;
    });
    controller.destroy();
  } finally { await closeWorld(world); }
}

// ---- World 2: no-show, keyboard rebooking, attempt 2 completes (manual order) ----
async function runNoShow() {
  const world = await makeWorld('noshow');
  try {
    const paula = await openActor(world, 'paula', world.setCookie, '/api/gcsp/manual/account'); const { page } = paula;
    const { car, controller } = await newOrder(world); let w;
    await step('03', async () => {
      ({ wait: w } = await toScheduled(world, controller, 'n3'));
      const missed = await world.api(`${APPT}/no-show`, { body: { orderUuid: car.orderUuid } });
      rec('03:no-show', '03: the presenter no-show route answers 200 with state no-show', missed.status === 200 && missed.json.value.state === 'no-show', { status: missed.status });
      via('03a', 'api', 'Presenter route POST /api/gcsp/appointments/no-show (200). The browser has no no-show control.', "'FUCQ-171 no-show then rebooking' step 2");
      await gotoAccount(paula);
      await tabTo(paula, '03:rebook', '.gcsp-order-handover .gcsp-order-slot button');
      const label = (await focusInfo(page)).label; rec('03:first-button', '03: the focused control is the first "Request <time>" button', /^Request /.test(label), label);
      await cap(paula, '03-no-show-rebook-focus', { expectText: [['"Handover missed: <time>"', /Handover missed: \S/], ['owner row', /Owner\s*\S/], ['rebook buttons "Request <time>"', /Request \S/]], forbidText: NO_BOOKED });
      const ok = await pressEnterAndWait(paula, '03:rebook', 'Handover time requested.', '.gcsp-order-message[role="status"]');
      via('03b', 'browser', 'Paula rebooks with Tab and Enter on the first offered slot.');
      await cap(paula, '04-rebooked', { expectText: [['"Requested ... Not booked yet."', /Requested .*Not booked yet\./], ['"Earlier handover missed: <time>"', /Earlier handover missed: \S/]], forbidText: [['"Booked:"', /Booked:/]] });
      report.facts['04'] = { announced: ok, handover: await section(page, 'gcsp-order-handover') };
    });
    await step('04b', async () => {
      good(await tick(world, 'n4-confirm2', w.appointment));
      const booked = await handoverOf(world, car.orderUuid);
      rec('04b:attempt2', '04b: the retailer confirms attempt 2 on the keyed delay, with the missed attempt kept on record', booked.state === 'scheduled' && booked.attempt === 2 && booked.previousAttempts.length === 1, { state: booked.state, attempt: booked.attempt });
      const done = await world.api(`${APPT}/complete`, { body: { orderUuid: car.orderUuid } });
      rec('04b:completed', '04b: attempt 2 completes (200)', done.status === 200 && done.json.value.state === 'completed' && done.json.value.attempt === 2, { status: done.status });
      via('04b', 'api', 'Retailer confirmation is a service tick; completion is the presenter route. No PNG: the completed state is captured in 02.', "'FUCQ-171 no-show then rebooking' steps 5 and 6");
      const plan = await returnPlanOf(world, car.orderUuid);
      rec('04b:current-car', '04b: the new order is the current car after attempt 2', plan.relationship.currentCar.kind === 'order' && plan.relationship.currentCar.orderUuid === car.orderUuid, plan.relationship.currentCar);
      await gotoAccount(paula);
      await cap(paula, '04c-attempt2-completed', { shot: false, expectText: [['"Handover complete: <time>"', /Handover complete: \S/], ['"Earlier handover missed: <time>"', /Earlier handover missed: \S/]] });
    });
    controller.destroy();
  } finally { await closeWorld(world); }
}

// ---- World 3: confirmed return (manual order; policy outcome enabled before boot) ----
async function runReturned() {
  const world = await makeWorld('returned', { returnOutcome: 'returned' });
  try {
    const paula = await openActor(world, 'paula', world.setCookie, '/api/gcsp/manual/account'); const { page } = paula;
    const { car, controller } = await newOrder(world);
    await step('05', async () => {
      const { wait: w } = await toScheduled(world, controller, 'r5'); const pick = await returnScheduled(world, controller, w, 'r5');
      const completed = await world.api(`${APPT}/complete`, { body: { orderUuid: car.orderUuid } }); assert.equal(completed.status, 200, JSON.stringify(completed.json)); await controller.refresh();
      await pastReturn(world, controller, pick, 'r5');
      via('05', 'api', 'Return outcome is the policy key lifecycle.return.outcome.v1 (enabled and set to returned before boot) acting on the keyed delay after the slot; handover completion is the presenter route. The browser has neither.', "'FUCQ-171 buddy lifecycle' steps 4 and 5");
      const plan = await returnPlanOf(world, car.orderUuid);
      rec('05:relationship', '05: old car returned, new order the current car', plan.relationship.oldCar.status === 'returned' && plan.relationship.currentCar.orderUuid === car.orderUuid, plan.relationship);
      await gotoAccount(paula);
      await cap(paula, '05-returned', { expectText: [['"Returned: <time>"', /Returned: \S/], ['"Return reference (synthetic)" SYN-RET-', /Return reference \(synthetic\)\s*SYN-RET-/], ['"Current car" row', /Current car/], ['"Returned car" row', /Returned car/], ['handover also complete', /Handover complete: \S/]],
        forbidText: [['"Return missed"', /Return missed/]] });
      const rt = await section(page, 'gcsp-order-return'); const card = await currentCarCard(page); const name = await carName(page);
      report.facts['05'] = { newCar: name, returnSection: rt, currentCarCard: card };
      rec('05:separate', '05: the Returning section names the new car as current and a different returned car', /Current car\s*\S/.test(rt) && /Returned car\s*\S/.test(rt) && !new RegExp(`Returned car\\s*${(name || '#').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(rt), rt);
      if (card && !card.includes(name)) observe('FUCQ-252', 'Medium (known, FUCQ-252)', 'After the confirmed return the Your cars current-car card still shows the old car (Fictional BMW 320i Touring) as current.', { card, newCar: name });
    });
    controller.destroy();
  } finally { await closeWorld(world); }
}

// ---- World 4: missed return, and the case Greg sees (manual order) ----
async function runMissed() {
  const world = await makeWorld('missed', { returnOutcome: 'missed' });
  try {
    const paula = await openActor(world, 'paula', world.setCookie, '/api/gcsp/manual/account');
    const { car, controller } = await newOrder(world);
    await step('06', async () => {
      const { wait: w } = await toScheduled(world, controller, 'm6'); const pick = await returnScheduled(world, controller, w, 'm6');
      await pastReturn(world, controller, pick, 'm6');
      via('06a', 'api', 'The missed outcome is the policy key lifecycle.return.outcome.v1 (enabled, missed, before boot) acting on its keyed delay; no browser control.', "'FUCQ-171 missed return' steps 2 and 3");
      await gotoAccount(paula);
      await cap(paula, '06a-return-missed-paula', { shot: false, expectText: [['"Return missed: <time>"', /Return missed: \S/], ['owner "Scheme team"', /Owner\s*Scheme team/], ['old car stays yours', /stays yours until it is returned/], ['handover still booked', /Booked:/]], forbidText: [['"Returned:"', /Returned: /], ['"Return reference"', /Return reference/]] });
      good(await tick(world, 'm6-case')); via('06b', 'api', 'One service tick runs the renewal-risk rule that opens the owned case (renewalCase.lifecycle.eventTypes).', "'FUCQ-171 missed return' step 4");
      const greg = await openActor(world, 'greg', await principalCookie(world, 'greg'), SCHEME);
      await gotoQueue(greg);
      const listed = await greg.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      rec('06:row', '06: Greg\'s queue lists one open lifecycle-exception case for Paula', /Paula/.test(listed) && /lifecycle-exception/.test(listed) && /Open/.test(listed), listed.slice(0, 500));
      await chooseOption(greg, '06:pick', 'select[id$="-selection"]', await greg.page.evaluate(() => [...document.querySelector('select[id$="-selection"]').options].pop().textContent.trim()));
      await tabTo(greg, '06:open', /^Open selected case$/);
      await greg.page.keyboard.press('Enter');
      await greg.page.waitForFunction(() => /Current case options loaded\.|unavailable|Options as of/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      via('06c', 'browser', 'Greg picks the case and opens it with Tab, a type-ahead select and Enter on /gcsp-case-queue.html.');
      const text = await cap(greg, '06-missed-case-greg-queue', { expectText: [['case table "Renewal-risk cases"', /Renewal-risk cases/], ['lifecycle-exception trigger', /lifecycle-exception/], ['Paula', /Paula/]] });
      report.facts['06'] = { opened: /Options as of/.test(text), text: text.slice(0, 900) };
      if (/Opened from Missed handover appointment/.test(text)) observe('missed-return-case-label', 'Medium', 'The case opened by a missed RETURN reads "Opened from Missed handover appointment" and the queue trigger shows the raw "lifecycle-exception": lifecycle.return.outcome.v1 reuses exceptionType "appointment-no-show", and the label and reason text are keyed to that type alone.', { reason: 'A configured lifecycle exception needs scheme-team review.' });
      if (!/Options as of/.test(text)) observe('queue-options-unavailable', 'Medium', 'Greg could not open the missed-return case options in the browser.', { text: text.slice(0, 500) });
      void car;
    });
    controller.destroy();
  } finally { await closeWorld(world); }
}

// ---- World 5: advanced help (launcher composition: demo stock, offer journey, real brief and offer routes) ----
async function saveConfirmedBrief(f, label, session, body) {
  const brief = { schemaVersion: 1, preferences: { body: confirmed(body) }, essentials: { seats: { value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee' },
    charging: { value: 'home', operator: 'equals', unit: null, state: 'confirmed', source: 'employee' } } };
  good((await f.api('/api/gcsp/brief/draft', { session, body: { commandId: `${label}-paula-draft`, expectedBriefVersion: 0, expectedDraftVersion: 0, brief } })).json, 'save draft');
  return good((await f.api('/api/gcsp/brief/confirm', { session, body: { commandId: `${label}-paula-confirm`, expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } })).json, 'confirm brief');
}
async function saveEstateBrief(f, label, name, session) {
  const brief = { schemaVersion: 1, preferences: { body: confirmed('estate') }, essentials: { seats: { value: 5, operator: 'gte', unit: 'count', state: 'confirmed', source: 'employee' } } };
  good((await f.api('/api/gcsp/brief/draft', { session, body: { commandId: `${label}-${name}-draft`, expectedBriefVersion: 0, expectedDraftVersion: 0, brief } })).json, 'save draft');
  good((await f.api('/api/gcsp/brief/confirm', { session, body: { commandId: `${label}-${name}-confirm`, expectedBriefVersion: 0, expectedDraftVersion: 1, consent: { search: true, hold: true } } })).json, 'confirm brief');
}
async function declinedFirstOffer(f, label) {
  await resetRun(f, label);
  const paula = await actAs(f, label, 'paula'); const alex = await actAs(f, label, 'alex');
  await saveConfirmedBrief(f, label, paula, 'estate'); await saveEstateBrief(f, label, 'alex', alex);
  await tickTo(f, label, { mode: 'next-release' });
  const offer = (await rows(f, 'offers')).find((row) => row.employeeId === 'employee-paula' && row.state === 'active'); assert.ok(offer, 'Paula holds a pending offer');
  const job = (await rows(f, 'notification_outbox')).find((row) => row.offerId === offer.offerId);
  const message = good((await f.api('/api/gcsp/presenter/outbox')).json, 'outbox viewer').messages.find((row) => row.jobId === job.jobId);
  const { reply, selector, session } = await openLink(f, message.offerLink); assert.equal(reply.status, 200, JSON.stringify(reply.json));
  const reason = (await assumption(f, 'offer.declineReasons.v1')).reasons.find((row) => row.attribute === 'body'); const view = await readOffer(f, session, selector);
  const declined = await f.api(`${offerPath(selector)}/decision`, { session, body: { commandId: `${label}-decline`, runId: selector.runId, decision: 'decline', reasonCode: reason.code,
    expectedOfferVersion: view.offerVersion, expectedHoldVersion: view.holdVersion, expectedQuoteVersion: view.quote.revisions.quote } });
  assert.equal(declined.status, 200, JSON.stringify(declined.json));
  const decision = (await rows(f, 'decisions')).find((row) => row.employeeId === 'employee-paula' && row.decision === 'decline');
  return { paula, alex, decisionId: decision.decisionId };
}
const ALLOCATION_TABLES = ['briefs', 'employees', 'entitlement_slots', 'stock', 'holds', 'claims', 'offers', 'decisions'];
const allocatorInputs = async (f) => Object.fromEntries(await Promise.all(ALLOCATION_TABLES.map(async (name) => [name, JSON.stringify(await rows(f, name))])));

async function runHelp() {
  const world = await makeWorld('help', { kind: 'help' }); const f = world; const asked = 'My contract ends on 1 December and I have no car yet.';
  try {
    const owner = await assumption(f, 'renewalCase.owner.role'); const state = {};
    await step('07a', async () => {
      Object.assign(state, await declinedFirstOffer(f, 'help171'));
      const employee = (await rows(f, 'employees')).find((row) => row.employeeId === 'employee-paula');
      const end = employee.contract.manualContext.contracts.find((row) => row.status === 'current').contractEndDate;
      const now = new Date(Date.parse(`${end}T09:00:00.000Z`) - 7 * 86400000).toISOString();
      await tickTo(f, 'near-deadline', { mode: 'to', to: now });
      state.inputs = await allocatorInputs(f); state.end = end;
      const mine = (await world.api('/api/gcsp/cases', { session: state.paula })).json.value.cases;
      rec('07a:auto-case', '07a: the keyed deadline rule has opened one owned case for Paula', mine.length === 1 && mine[0].trigger.type === 'renewal-deadline' && mine[0].owner.role === owner, mine.map((c) => [c.status, c.trigger.type]));
      via('07a', 'api', 'Setup: reset, briefs, release, the real first offer opened from its outbox link and declined for body style over the offer routes, then a presenter tick to one week before the contract end. These are the setup steps of the e2e test.', "'FUCQ-171 advanced help' step 1");
    });
    const paulaSet = await principalCookie(world, 'paula'); state.paula = cookieHeader(paulaSet);
    const paula = await openActor(world, 'paula', paulaSet, '/api/gcsp/cases');
    const greg = await openActor(world, 'greg', await principalCookie(world, 'greg'), SCHEME);
    await step('07', async () => {
      await gotoHelp(paula);
      const before = await paula.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      rec('07:auto-visible', '07: before asking, Paula already sees the Open case from the deadline rule, owned by the scheme team', /Open/.test(before) && /Renewal deadline approaching/.test(before) && /Scheme team/.test(before), before.slice(0, 400));
      await tabTo(paula, '07:summary', /^Get help with your renewal$/); await paula.page.keyboard.press('Enter');
      await tabTo(paula, '07:ask', /^Ask for help$/); await paula.page.keyboard.press('Enter');
      await paula.page.waitForSelector('textarea'); await paula.page.keyboard.type(asked, { delay: 3 });
      await tabTo(paula, '07:review', /^Review help request$/); await paula.page.keyboard.press('Enter');
      await paula.page.waitForSelector('.gcsp-case-confirmation');
      await tabTo(paula, '07:confirm', /^Confirm help request$/);
      await pressEnterAndWait(paula, '07:confirm', 'Your help request was recorded.');
      via('07', 'browser', 'Paula asks, reviews and confirms on /gcsp-help.html with Tab and Enter.');
      await cap(paula, '07-paula-help-requested', { expectText: [['"Your help request was recorded."', /Your help request was recorded\./], ['her reason in the history', /I have no car yet/], ['owner "Scheme team"', /Scheme team/], ['status Open', /Open/]] });
      const cases = (await world.api('/api/gcsp/cases', { session: state.paula })).json.value.cases;
      rec('07:one-case', '07: her request appended to the existing case rather than opening a second', cases.length === 1 && cases[0].history.length === 2, cases.map((c) => c.history.length));
      state.caseId = cases[0].caseId;
    });
    const gregUpdate = async (id, { status, reason, nextAction, remedyLabel, valueLabel, expectMessage = 'The case update was recorded.' }) => {
      await gotoQueue(greg);
      await chooseOption(greg, `${id}:pick`, 'select[id$="-selection"]', await greg.page.evaluate(() => [...document.querySelector('select[id$="-selection"]').options].find((o) => /^Paula/.test(o.textContent.trim())).textContent.trim()));
      await tabTo(greg, `${id}:open`, /^Open selected case$/); await greg.page.keyboard.press('Enter');
      await greg.page.waitForFunction(() => /Current case options loaded\./.test(document.body.innerText), null, { timeout: 20000 });
      await chooseOption(greg, `${id}:status`, 'select[id$="-status"]', status);
      await typeInto(greg, `${id}:reason`, 'textarea[id$="-reason"]', reason);
      await typeInto(greg, `${id}:next`, 'textarea[id$="-nextAction"]', nextAction, true);
      if (remedyLabel) {
        await chooseOption(greg, `${id}:remedy`, 'select[id$="-remedyKey"]', remedyLabel);
        await chooseOption(greg, `${id}:value`, 'select[id$="-preferenceValue"]', valueLabel);
      }
      await tabTo(greg, `${id}:review`, /^Review case update$/); await greg.page.keyboard.press('Enter');
      await greg.page.waitForSelector('.gcsp-case-confirmation');
      const confirmation = await greg.page.evaluate(() => document.querySelector('.gcsp-case-confirmation').innerText.replace(/\s+/g, ' '));
      await tabTo(greg, `${id}:confirm`, /^Confirm case update$/);
      await pressEnterAndWait(greg, `${id}:confirm`, expectMessage, '.gcsp-case-status');
      return confirmation;
    };
    await step('08', async () => {
      const first = await gregUpdate('08a', { status: 'In progress', reason: 'Scheme team has started work on this renewal.', nextAction: 'Review options and propose a remedy.' });
      rec('08a:in-progress', '08a: the case is In progress after Greg\'s first update', /In progress/.test(first) , first.slice(0, 300));
      const second = await gregUpdate('08', { status: 'Remedy proposed', reason: 'A different body style is available; proposing one body style change.', nextAction: 'Employee to confirm the body style change.',
        remedyLabel: 'Change body', valueLabel: null });
      rec('08:review', '08: the review screen names a one-preference change that the employee must confirm', /One preference change/.test(second) && /Required through the employee brief/.test(second), second.slice(0, 500));
      via('08', 'browser', 'Greg moves the case to In progress, then to Remedy proposed with one body-style change, with Tab, type-ahead selects and Enter on /gcsp-case-queue.html (FUCQ-122 remainder).');
      const own = (await world.api('/api/gcsp/cases', { session: state.paula })).json.value.cases[0];
      rec('08:proposal-only', '08: the case holds a proposal and Paula\'s brief is still version 1 (estate): proposal and applied change stay distinct', own.status === 'remedy-proposed' && own.remedy.confirmationState === 'employee-confirmation-required'
        && (await world.api('/api/gcsp/brief', { session: state.paula })).json.value.brief.briefVersion === 1, { status: own.status, remedy: own.remedy });
      await cap(greg, '08-greg-remedy-proposed', { expectText: [['status "Remedy proposed"', /Remedy proposed/], ['proposed remedy section', /Proposed remedy/], ['"Employee confirmation is recorded" absent yet or confirmation required text', /confirms this preference through their brief/]] });
    });
    await step('09', async () => {
      await gotoHelp(paula);
      const text = await paula.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
      rec('09:waiting', '09: Paula sees the proposed remedy waiting for her confirmation, not yet applied', /Proposed remedy/.test(text) && /Waiting for your confirmation/.test(text), text.slice(0, 600));
      await tabTo(paula, '09:review', /^Review .* change$/); await paula.page.keyboard.press('Enter');
      await paula.page.waitForSelector('[data-confirm-relaxation]');
      await tabTo(paula, '09:confirm', /^Confirm preference change$/);
      await pressEnterAndWait(paula, '09:confirm', 'Your preference change was confirmed. The scheme team will review the current case.');
      via('09', 'browser', 'Paula reviews and confirms the single change on /gcsp-help.html (POST /api/gcsp/brief/change-after-decline). The control exists.', "'FUCQ-171 advanced help' step 7");
      await cap(paula, '09-paula-confirmed-change', { expectText: [['"You confirmed this preference change"', /You confirmed this preference change/], ['status still "Remedy proposed"', /Remedy proposed/]], forbidText: [['"Resolved"', /Resolved/]] });
      const brief = (await world.api('/api/gcsp/brief', { session: state.paula })).json.value.brief;
      rec('09:brief2', '09: only now is there a confirmed brief version 2, with only the body style changed', brief.briefVersion === 2 && brief.status === 'confirmed' && brief.preferences.body.value !== 'estate', { v: brief.briefVersion, body: brief.preferences.body.value });
    });
    await step('10', async () => {
      const paulaCase = async () => (await world.api('/api/gcsp/cases', { session: state.paula })).json.value.cases[0];
      // The editor keeps the confirmed remedy ("Keep the current remedy"); the server checks Paula's confirmation before it allows the resolution.
      await gregUpdate('10', { status: 'Resolved', reason: 'Employee confirmed the change; case resolved.', nextAction: 'No further action.' }).catch((error) => report.notes.push(`10: ${String(error.message).slice(0, 160)}`));
      let own = await paulaCase();
      if (own.status !== 'resolved') {
        observe('greg-cannot-resolve-in-queue', 'Medium', 'Greg could not resolve the confirmed case from the queue.', { screen: await greg.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 900)) });
        const resolved = await world.api(`${SCHEME}/update`, { session: cookieHeader(await principalCookie(world, 'greg')), body: { commandId: `fucq171-resolve-${++world.counter}`, caseId: own.caseId, expectedVersion: own.version,
          status: 'resolved', reason: 'Employee confirmed the change; case resolved.', nextAction: 'No further action.', dueAt: own.dueAt, remedy: own.remedy } });
        via('10-fallback', 'api', 'Fallback because the queue did not resolve the case: POST /api/gcsp/scheme-team/cases/update with the persisted remedy.', "'FUCQ-171 advanced help' step 8");
        rec('10:fallback', '10: the scheme-team update route resolves the case (200)', resolved.status === 200, resolved.json);
        own = await paulaCase();
      } else via('10', 'browser', 'Greg resolves the confirmed case on /gcsp-case-queue.html with Tab, type-ahead selects and Enter, keeping the confirmed remedy.');
      rec('10:resolved', '10: the case is resolved with the employee-confirmed remedy at brief version 2', own.status === 'resolved' && own.remedy.confirmationState === 'employee-confirmed' && own.remedy.briefVersion === 2, { status: own.status, remedy: own.remedy });
      await gotoQueue(greg);
      await cap(greg, '10-greg-resolved', { expectText: [['Paula\'s case "Resolved" in the queue', /Paula \(fictional\) 2026-12-01 renewal-deadline[^]*?Resolved/]] });
    });
    await step('11', async () => {
      await gotoHelp(paula);
      const text = await cap(paula, '11-paula-resolved', { expectText: [['status "Resolved"', /Resolved/], ['"Recorded remedy"', /Recorded remedy/], ['"You confirmed this preference change"', /You confirmed this preference change/]], forbidText: [['"Waiting for your confirmation"', /Waiting for your confirmation/]] });
      via('11', 'browser', 'Paula reloads /gcsp-help.html and reads the persisted outcome.');
      const own = (await world.api('/api/gcsp/cases', { session: state.paula })).json.value.cases[0];
      rec('11:history', '11: the dated history shows system, employee and scheme-team entries in order', JSON.stringify(own.history.map((h) => [h.actorRole, h.status])).includes('["system","open"],["employee","open"],["scheme-team","in-progress"],["scheme-team","remedy-proposed"],["scheme-team","resolved"]'), own.history.map((h) => [h.actorRole, h.status]));
      const after = await allocatorInputs(f); const moved = ALLOCATION_TABLES.filter((name) => after[name] !== state.inputs[name]);
      rec('11:allocation', '11: across the whole case the only allocation input that moved is Paula\'s brief (the confirmed version 2)', moved.length === 1 && moved[0] === 'briefs', moved);
      void text;
    });
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
  let ready = false;
  for (let i = 0; i < 300 && !ready; i += 1) { ready = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.ok, () => false); if (!ready) await wait(100); }
  assert.ok(ready, 'Chrome exposes its owned CDP port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  for (const [key, run] of [['handover', runHandover], ['noshow', runNoShow], ['returned', runReturned], ['missed', runMissed], ['help', runHelp]]) {
    if (only.length && !only.includes(key)) continue;
    try { await run(); } catch (error) { report.errors.push({ type: 'world', world: key, message: String(error.stack || error.message).slice(0, 800) }); await save(); }
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
  report.finishedAt = new Date().toISOString();
  report.summary = { checks: report.checks.length, passed: report.checks.filter((c) => c.pass).length, failed: report.checks.filter((c) => !c.pass).map((c) => c.id), captures: report.captures.length, pngs: report.captures.filter((c) => c.file).length };
  await save();
  console.log(JSON.stringify({ state: report.state, chunk, ...report.summary, errors: report.errors.length }));
}
