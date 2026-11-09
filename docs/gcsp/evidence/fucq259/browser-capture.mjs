// FUCQ-259 browser evidence: a missed return opens a case labelled as a missed return, as Greg (queue and case) and Paula (help).
// Reduced from ../fucq-110/fucq171/browser-capture.mjs (world 4 only). Real memory runtime and buildServer over loopback HTTP; one viewport per run (FUCQ259_CHUNK=desktop|narrow).
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
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
import { createDemoStockProvider } from '../../../../server/gcsp/stock/demo-provider.js';
import { createCompositionTestProfile } from '../../../../server/test/helpers/runtime-composition-profile.js';
import { good, competingPolicy, assumption, rows, tickTo, resetRun, actAs, confirmed, openLink, readOffer, offerPath } from '../../../../server/test/helpers/gcsp-journey.js';
import { createOrderProgressHttpAdapter } from '../../../../blocks/gcsp/order-progress/order-progress-http.js';
import { createOrderProgressController } from '../../../../blocks/gcsp/order-progress/order-progress-controller.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = path.resolve(process.env.FUCQ259_OUTPUT || HERE);
const scratch = process.env.FUCQ259_SCRATCH;
const chunk = process.env.FUCQ259_CHUNK;
const only = (process.env.FUCQ259_ONLY || '').split(',').filter(Boolean);
const shotDir = path.join(output, 'browser');
const ledgerFile = path.join(scratch || '/', 'ledger.json');
assert.ok(scratch && ['desktop', 'narrow'].includes(chunk), 'Set FUCQ259_SCRATCH and FUCQ259_CHUNK=desktop|narrow');
const narrow = chunk === 'narrow';
const viewport = narrow ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const vp = String(viewport.width);
const BASE_PORT = 9140; const DEBUG_PORT = 9149;
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
      environmentId: `fucq259-${label}`, policyAsOf: '2026-11-05T09:00:00.000Z', commandId: `fucq259-${label}-bootstrap`, sessionNow: () => new Date().toISOString() }));
  } else {
    // The launcher's own composition (demo stock, offer journey adopted, Alex given Paula's grade as in the e2e tests), minus its HTTPS front.
    const competing = await competingPolicy(); seed = competing.seed;
    runtime = good(await createGcspRuntime({ mode: 'memory', stockProvider: createDemoStockProvider, adoptOfferJourney: true, policy: competing.policy,
      environmentId: `fucq259-${label}`, policyAsOf: seed.effectiveFrom, commandId: `fucq259-${label}-bootstrap` }));
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
    const next = good(await runtime.identity.createPresenterSession(`fucq259-presenter-${label}-${++world.counter}`));
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
    world.presenterCookie = cookieHeader(good(await runtime.identity.createPresenterSession(`fucq259-presenter-${label}`)).setCookie);
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
  const switched = await world.api('/api/gcsp/session/switch', { body: { principalId: `demo-${name}`, commandId: `fucq259-as-${name}-${++world.counter}` } });
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

// ---- The missed return, and the case Greg and Paula see (manual order; outcome `missed` set before boot) ----
async function runMissed() {
  const world = await makeWorld('missed', { returnOutcome: 'missed' });
  const copy = SEED.assumptions.find((r) => r.key === 'renewalCase.lifecycle.exceptionCopy').value['return-missed'];
  const exceptionType = SEED.assumptions.find((r) => r.key === 'lifecycle.return.outcome.v1').value.exceptionType;
  try {
    const paula = await openActor(world, 'paula', world.setCookie, '/api/gcsp/manual/account');
    const { controller } = await newOrder(world);
    await step('01', async () => {
      const { wait: w } = await toScheduled(world, controller, 'm1'); const pick = await returnScheduled(world, controller, w, 'm1');
      await pastReturn(world, controller, pick, 'm1');
      via('01a', 'api', 'The missed outcome is the policy key lifecycle.return.outcome.v1 (enabled, missed, before boot) acting on its keyed delay.', "'FUCQ-259: a missed return opens a case keyed and labelled as a missed return'");
      const receipts = good(await world.repository.query(world.presenter, 'event_receipts', { consumerId: 'lifecycle-return:exceptions:v1' }));
      rec('01:receipt', `01: the missed-return receipt is keyed ${exceptionType}, event <orderUuid>:return-missed`, receipts.length === 1 && receipts[0].eventType === 'return-missed'
        && exceptionType === 'return-missed' && /:return-missed$/.test(receipts[0].eventId), receipts.map((r) => [r.eventId, r.eventType]));
      good(await tick(world, 'm1-case')); via('01b', 'api', 'One service tick runs the renewal-risk rule that opens the owned case (renewalCase.lifecycle.eventTypes).');
      const greg = await openActor(world, 'greg', await principalCookie(world, 'greg'), SCHEME);
      await gotoQueue(greg);
      const row = await greg.page.evaluate(() => [...document.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => c.textContent.trim())));
      rec('01:row', '01: Greg\'s queue row shows the keyed label and reason, not the raw trigger', row.length === 1 && row[0][2] === copy.label && row[0][3] === copy.reason, row);
      await chooseOption(greg, '01:pick', 'select[id$="-selection"]', await greg.page.evaluate(() => [...document.querySelector('select[id$="-selection"]').options].pop().textContent.trim()));
      await tabTo(greg, '01:open', /^Open selected case$/);
      await greg.page.keyboard.press('Enter');
      await greg.page.waitForFunction(() => /Options as of/i.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
      via('01c', 'browser', 'Greg picks the case and opens it with Tab, a type-ahead select and Enter on /gcsp-case-queue.html.');
      const text = await cap(greg, '01-missed-return-case-greg', { expectText: [['queue and case label', new RegExp(copy.label)], ['keyed reason', new RegExp(copy.reason.replace(/\./g, '\\.'))],
        ['Opened from the missed return', new RegExp(`Opened from\\s*${copy.label}`)], ['Paula', /Paula/]],
        forbidText: [['handover label', /Missed handover appointment/], ['raw trigger', /lifecycle-exception/], ['generic reason', /A configured lifecycle exception/]] });
      report.facts['01'] = { opened: /Options as of/.test(text), text: text.slice(0, 900) };
      await gotoHelp(paula);
      await cap(paula, '02-missed-return-case-paula', { shot: false, expectText: [['Opened from the missed return', new RegExp(`Opened from\\s*${copy.label}`)], ['keyed reason', new RegExp(copy.reason.replace(/\./g, '\\.'))]],
        forbidText: [['handover label', /Missed handover appointment/], ['generic reason', /A configured lifecycle exception/]] });
      via('02', 'browser', 'Paula reads her own case on /gcsp-help.html (text check, no PNG).');
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
  let ready = false;
  for (let i = 0; i < 300 && !ready; i += 1) { ready = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.ok, () => false); if (!ready) await wait(100); }
  assert.ok(ready, 'Chrome exposes its owned CDP port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  for (const [key, run] of [['missed', runMissed]]) {
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
