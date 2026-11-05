import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { buildServer } from '../../../../server/index.js';
import { createMemoryRepository, createMemoryStore } from '../../../../server/gcsp/repository/index.js';
import { PolicyService } from '../../../../server/gcsp/policy/index.js';
import { createDemoRuntime } from '../../../../server/gcsp/clock/index.js';
import { createScenarioService } from '../../../../server/gcsp/scenarios/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../../../../server/gcsp/manual-context/index.js';
import { seedManualDemoContext } from '../../../../server/gcsp/manual-context/fixtures.js';
import { createGregDemandService } from '../../../../server/gcsp/greg/index.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const output = process.env.FUCQ126_OUTPUT;
const scratch = process.env.FUCQ126_SCRATCH;
const chunk = process.env.FUCQ126_CHUNK;
const viewport = chunk.endsWith('narrow') ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const report = { state: 'incomplete', chunk, viewport, checks: [], captures: [], errors: [],
  boundary: 'Actual buildServer routes, memory repository, canonical services. No stock/release producer composed.',
  syntheticInputs: [], expectedTransportFailures: [], requests: [] };
const save = () => writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
let backend; let browser; let chrome; let server; let context;
const repository = createMemoryRepository({ store: createMemoryStore() });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assertOk = (reply) => { assert.equal(reply.status, 'ok', JSON.stringify(reply)); return reply.value; };
function check(name, data = {}) { report.checks.push({ name, ...data }); }

try {
  assertOk(await repository.open());
  const seed = JSON.parse(await readFile(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
  seed.assumptions.find((row) => row.key === 'identity.session.sameSite').value = 'Lax';
  const policy = new PolicyService({ provider: { loadVersions: async () => [seed] } });
  const sessionWallClock = new Date().toISOString();
  const { clock, identity } = assertOk(await createDemoRuntime({ repository, policy,
    environmentId: 'fucq126-browser', environmentKind: 'synthetic', policyAsOf: '2026-11-05T00:00:00.000Z',
    commandId: 'browser-bootstrap', sessionNow: () => sessionWallClock, secureCookies: false }));
  const session = assertOk(await identity.createPresenterSession('browser-presenter'));
  const scenarios = createScenarioService({ repository, policy, clock, identity });
  const manual = new ManualContextService({ repository, policy, clock, identity,
    ports: createRepositoryManualPorts({ repository, policy }) });
  const greg = createGregDemandService({ repository, policy, clock, identity });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
  let api;
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) return api(req, res);
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const file = path.resolve(ROOT, '.' + pathname);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes); }
    catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.port = server.address().port;
  backend = buildServer({ gcspIdentity: identity, gcspClock: clock, gcspScenarios: scenarios,
    gcspManual: manual, gcspGreg: greg, gcspAllowedOrigins: [origin] });
  api = backend.listeners('request')[0]; await backend.gcspStartup;
  const profile = path.join(scratch, 'chrome-profile'); await mkdir(profile, { recursive: true });
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
    '--disable-gpu-shader-disk-cache', '--disk-cache-size=1048576', '--media-cache-size=1048576',
    `--crash-dumps-dir=${path.join(scratch, 'crashes')}`, 'about:blank'], { stdio: 'ignore' });
  await writeFile(process.env.FUCQ126_PROCESS_LEDGER, JSON.stringify({ pids: [process.pid, chrome.pid], port: report.port }));
  let debug;
  for (let i = 0; i < 100; i++) {
    try { debug = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n'); break; }
    catch { await wait(100); }
  }
  assert.ok(debug, 'Chrome exposes its owned CDP port');
  report.chromeDebugPort = Number(debug[0]);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debug[0]}`);
  context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  // Trusted initial bootstrap only. All subsequent principal issuance uses the actual UI.
  await context.addCookies(session.setCookie.map((text) => {
    const parts = text.split(';').map((part) => part.trim()); const at = parts[0].indexOf('=');
    const attrs = Object.fromEntries(parts.slice(1).map((part) => { const ix = part.indexOf('='); return ix < 0 ? [part, true] : [part.slice(0, ix), part.slice(ix + 1)]; }));
    return { name: parts[0].slice(0, at), value: parts[0].slice(at + 1), domain: '127.0.0.1',
      path: attrs.Path, httpOnly: true, sameSite: 'Lax', secure: false, expires: Date.parse(attrs.Expires) / 1000 };
  }));
  await context.route('**/*', async (route) => {
    if (!route.request().url().startsWith(origin + '/')) {
      report.errors.push({ type: 'external-request', url: route.request().url() }); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) report.errors.push({ type: 'console', message: msg.text() }); });
  page.on('requestfailed', (req) => report.expectedTransportFailures.push({ path: new URL(req.url()).pathname, error: req.failure()?.errorText }));
  page.on('response', async (res) => {
    if (!res.url().includes('/api/gcsp/')) return;
    try { const body = await res.json(); report.requests.push({ method: res.request().method(), path: new URL(res.url()).pathname,
      httpStatus: res.status(), status: body.status }); } catch { /* intentional transport loss */ }
  });
  const controls = page.locator('.gcsp-presenter-controls');
  const summary = controls.locator('summary');
  const picker = (label) => controls.getByRole('radiogroup', { name: label, exact: true });
  const option = (label, value) => picker(label).locator(`[role="radio"][data-value=${JSON.stringify(value)}]`);
  const selectedValue = (label) => picker(label).locator('[role="radio"][aria-checked="true"]').getAttribute('data-value');
  const tick = () => controls.getByRole('button', { name: /^Tick \(/ });
  const idle = async () => { await controls.waitFor({ state: 'visible' }); await page.waitForFunction(() => document.querySelector('.gcsp-presenter-controls')?.getAttribute('aria-busy') === 'false'); };
  const open = async () => { await idle(); if (!(await controls.getAttribute('open') !== null)) { await summary.focus(); await page.keyboard.press('Enter'); } };
  const read = async (p) => { const res = await context.request.get(origin + '/api/gcsp/' + p); return res.json(); };
  const capture = async (name) => {
    // Fixed viewport captures must show the claimed state even when the narrow
    // drawer is taller than one screen. Raw top-of-drawer captures are separate.
    if (/^(03-|05-|17-)/.test(name)) await controls.locator('.gcsp-presenter-results').scrollIntoViewIfNeeded();
    if (/^(05b-|13-|16-)/.test(name)) await controls.locator('[role="status"]').first().scrollIntoViewIfNeeded();
    if (name.startsWith('11-')) await picker('Scenario').scrollIntoViewIfNeeded();
    if (name.startsWith('12-')) await controls.getByRole('button', { name: 'Confirm reset', exact: true }).scrollIntoViewIfNeeded();
    if (name.startsWith('14-')) await controls.getByRole('button', { name: 'Retry original action', exact: true }).scrollIntoViewIfNeeded();
    if (name.startsWith('13b-')) await controls.getByRole('button', { name: 'Retry original action', exact: true }).scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      activeTag: document.activeElement?.tagName, activeText: document.activeElement?.textContent?.slice(0, 80),
      outline: getComputedStyle(document.activeElement).outlineStyle }));
    assert.ok(overflow.scrollWidth <= overflow.width, `${name}: horizontal overflow ${JSON.stringify(overflow)}`);
    const file = name + '.png'; await page.screenshot({ path: path.join(output, file), fullPage: false });
    report.captures.push({ name, file, ...overflow }); await save();
  };
  await page.goto(origin + '/gcsp-presenter.html'); await idle();
  await capture('01-idle-collapsed'); await open();
  await page.keyboard.press('Tab');
  assert.ok(await tick().evaluate((node) => node === document.activeElement));
  await capture('02-idle-open-keyboard');
  await page.keyboard.press('Escape'); assert.equal(await controls.getAttribute('open'), null);
  assert.ok(await summary.evaluate((node) => node === document.activeElement)); await open();
  check('Native disclosure opens with Enter; Tab reaches tick; Escape closes and returns focus');
  const first = assertOk(await read('presenter/controls'));
  assert.equal(await selectedValue('Scenario'), first.currentScenario.scenarioId);
  check('Initial selected scenario matches actual current scenario after catalogue load');
  for (const label of ['Scenario', 'Acting principal']) {
    const radios = picker(label).getByRole('radio'); const before = await selectedValue(label);
    const total = await radios.count(); assert.ok(total > 1);
    await radios.first().focus(); await page.keyboard.press('End');
    assert.ok(await radios.last().evaluate((node) => node === document.activeElement));
    assert.equal(await radios.last().getAttribute('aria-checked'), 'true');
    await page.keyboard.press('ArrowRight'); assert.ok(await radios.first().evaluate((node) => node === document.activeElement));
    await page.keyboard.press('ArrowLeft'); assert.ok(await radios.last().evaluate((node) => node === document.activeElement));
    await page.keyboard.press('Home'); assert.ok(await radios.first().evaluate((node) => node === document.activeElement));
    assert.equal(await picker(label).locator('[role="radio"][tabindex="0"]').count(), 1);
    const beforeIndex = before ? await radios.evaluateAll((nodes, value) => nodes.findIndex((node) => node.dataset.value === value), before) : 0;
    assert.ok(beforeIndex >= 0);
    // Restore with real keys so the focus-ring proof precedes every pointer click.
    for (let index = 0; index < beforeIndex; index++) await page.keyboard.press('ArrowRight');
    const focused = radios.nth(beforeIndex);
    assert.ok(await focused.evaluate((node) => node === document.activeElement && node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'));
    await capture(`02a-${label === 'Scenario' ? 'scenario' : 'principal'}-keyboard-focus`);
    const identity = await focused.elementHandle(); const value = await selectedValue(label);
    await controls.getByRole('button', { name: 'Refresh readback', exact: true }).evaluate((node) => node.click());
    await idle();
    assert.ok(await identity.evaluate((node) => node.isConnected && node === document.activeElement));
    assert.ok(await identity.evaluate((node) => node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'));
    assert.equal(await selectedValue(label), value); await identity.dispose();
  }
  await capture('02b-shared-options-keyboard-focus');
  check('Both shared radio pickers wrap arrows, support Home/End and preserve focused node/value and visible keyboard outline through ordinary readback');
  await tick().click(); await idle();
  const advanced = assertOk(await read('presenter/controls'));
  assert.equal(Date.parse(advanced.now) - Date.parse(first.now), first.controls.step.value * 1000);
  assert.ok(advanced.lastTick.missingStages.includes('release-pull'));
  assert.match(await controls.innerText(), /Release unavailable: no released count reported/);
  assert.doesNotMatch(await controls.innerText(), /0 cars released/);
  await capture('03-actual-tick-missing-release'); check('Actual policy step and handler receipt', { before: first.now, after: advanced.now, step: first.controls.step, missingStages: advanced.lastTick.missingStages });

  if (chunk === 'desktop' || chunk === 'narrow') {
    // Delay the committed real HTTP reply. No business response is replaced.
    let releaseBusy; let busyCount = 0;
    const busyBarrier = new Promise((resolve) => { releaseBusy = resolve; });
    const busyRoute = async (route) => { busyCount++; const actual = await route.fetch(); await busyBarrier; await route.fulfill({ response: actual }); };
    await page.route('**/api/gcsp/presenter/controls/tick', busyRoute);
    await tick().click(); await page.waitForFunction(() => document.querySelector('.gcsp-presenter-controls')?.getAttribute('aria-busy') === 'true');
    await tick().evaluate((node) => { node.click(); node.click(); });
    assert.equal(await controls.getByRole('radio').count(), await controls.locator('[role="radio"]:disabled').count());
    await capture('04-busy-real-response-delayed'); assert.equal(busyCount, 1);
    releaseBusy(); await idle(); await page.unroute('**/api/gcsp/presenter/controls/tick', busyRoute);
    check('Busy prevents duplicate command', { requests: busyCount });
    await controls.getByRole('button', { name: 'Next release', exact: true }).click(); await idle();
    assert.ok(await controls.getByRole('button', { name: 'Next release', exact: true }).isDisabled());
    await capture('05-next-release-no-producer');
    const released = assertOk(await read('presenter/controls'));
    assert.equal(released.now, first.controls.nextRelease.at);
    check('Actual next-release cue, no producer/count; future cue then unavailable', { at: released.now });
    await controls.getByLabel('Named time or UTC target', { exact: true }).fill('expiry');
    await controls.getByRole('button', { name: 'Tick to target', exact: true }).click(); await idle();
    assert.equal(assertOk(await read('presenter/controls')).now, first.controls.namedTimes.expiry);
    check('Named target uses actual policy cue');
    await controls.getByLabel('Named time or UTC target', { exact: true }).fill(first.now);
    await controls.getByRole('button', { name: 'Tick to target', exact: true }).click(); await idle();
    assert.match(await controls.innerText(), /tick: Supply commandId/);
    await capture('05b-typed-invalid-past-target');
    check('Actual typed validation explains the past target field');
    const principals = first.principals;
    const employee = principals.find((p) => p.roles.includes('employee'));
    const gregPrincipal = principals.find((p) => p.roles.includes('greg'));
    const switchTo = async (principal) => {
      await option('Acting principal', principal.principalId).click();
      await Promise.all([page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() && frame.url() === origin + '/gcsp-presenter.html' }), controls.getByRole('button', { name: 'Switch principal', exact: true }).click()]);
      await page.waitForLoadState('load'); await idle();
      assert.equal(assertOk(await read('context')).principalId, principal.principalId); await open();
    };
    await switchTo(employee);
    // Existing explicit synthetic account inputs, after resolving the genuinely issued browser session.
    const cookieHeader = (await context.cookies(origin + '/api/gcsp')).map((c) => `${c.name}=${c.value}`).join('; ');
    const acting = assertOk(await identity.resolveSession({ authorized: true, cookie: cookieHeader, purpose: 'acting' }));
    assertOk(await seedManualDemoContext({ repository, identity, clock, context: acting }));
    report.syntheticInputs.push('seedManualDemoContext manual-records-v1 through actual issued employee session; no stock producer');
    await page.reload(); await idle(); await capture('06-paula-account-collapsed'); await open(); await capture('07-paula-account-controls');
    await switchTo(gregPrincipal); await capture('08-greg-dashboard-controls');
    assert.equal(assertOk(await read('greg/demand')).runId, assertOk(await read('context')).runId);
    await switchTo(employee); await capture('09-paula-return');
    check('Actual UI principal issuance employee to Greg to employee; actual context readbacks', { employee: employee.name, greg: gregPrincipal.name });
    const nonpresenter = await browser.newContext({ viewport });
    await nonpresenter.addCookies((await context.cookies()).filter((cookie) => !cookie.name.includes('presenter')));
    const nonPage = await nonpresenter.newPage(); await nonPage.goto(origin + '/gcsp-presenter.html');
    await nonPage.waitForTimeout(300);
    assert.equal(await nonPage.locator('.gcsp-presenter-controls:visible').count(), 0);
    await nonPage.screenshot({ path: path.join(output, '10-nonpresenter-hidden.png'), fullPage: false });
    report.captures.push({ name: '10-nonpresenter-hidden', file: '10-nonpresenter-hidden.png' });
    await nonpresenter.close(); check('Actual acting cookie alone hides presenter controls');
    const catalogue = assertOk(await read('presenter/scenarios'));
    const unavailable = catalogue.scenarios.find((s) => !s.availability.available);
    await option('Scenario', unavailable.scenarioId).click();
    assert.ok(await controls.getByRole('button', { name: 'Reset scenario', exact: true }).isDisabled());
    await capture('11-scenario-unavailable');
    const available = catalogue.scenarios.find((s) => s.availability.available);
    await option('Scenario', available.scenarioId).click();
    await controls.getByRole('button', { name: 'Reset scenario', exact: true }).click();
    await capture('12-reset-confirmation');
    await controls.getByRole('button', { name: 'Cancel reset', exact: true }).click();
    assert.equal(await controls.getByRole('button', { name: 'Confirm reset', exact: true }).isVisible(), false);
    const beforeReset = assertOk(await read('presenter/controls'));
    await controls.getByRole('button', { name: 'Reset scenario', exact: true }).click();
    await Promise.all([page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() && frame.url() === origin + '/gcsp-presenter.html' }),
      controls.getByRole('button', { name: 'Confirm reset', exact: true }).click()]);
    await page.waitForLoadState('load'); await idle(); await open();
    const afterReset = assertOk(await read('presenter/controls'));
    assert.notEqual(afterReset.runId, beforeReset.runId);
    const resetContext = assertOk(await read('context'));
    assert.ok(resetContext.roles.includes('presenter')); assert.equal(resetContext.runId, afterReset.runId);
    assert.match(await page.locator('.gcsp-header').innerText(), /Presenter/);
    assert.equal(await page.locator('.gcsp-account-body').count(), 0);
    assert.match(await page.locator('.gcsp-main').innerText(), /Presenter workspace/);
    assert.match(await controls.innerText(), new RegExp(afterReset.runId));
    assert.equal(await selectedValue('Scenario'), afterReset.currentScenario.scenarioId);
    await capture('13-clock-mechanics-reset'); check('Actual reset discards employee shell; new context, header, workspace and run agree', { before: beforeReset.runId, after: afterReset.runId, roles: resetContext.roles });
    let lostBody; let retriedBody; let dropped = false;
    const lostRoute = async (route) => {
      if (!dropped) { dropped = true; lostBody = route.request().postData(); await route.fetch(); await route.abort('failed'); }
      else { retriedBody = route.request().postData(); await route.continue(); }
    };
    await page.route('**/api/gcsp/presenter/controls/tick', lostRoute);
    const beforeLost = assertOk(await read('presenter/controls'));
    await tick().click(); await idle(); await capture('14-lost-response');
    await controls.getByRole('button', { name: 'Retry original action', exact: true }).click(); await idle();
    const afterRetry = assertOk(await read('presenter/controls'));
    assert.equal(retriedBody, lostBody);
    assert.equal(Date.parse(afterRetry.now) - Date.parse(beforeLost.now), beforeLost.controls.step.value * 1000);
    await page.unroute('**/api/gcsp/presenter/controls/tick', lostRoute);
    await capture('15-original-retry-recovered'); check('Lost response retries byte-identical original command once', { sameBody: true, before: beforeLost.now, after: afterRetry.now });
    // Preserve real renewal headers/cookies while losing only the JSON body.
    // The current backend can return stale-run on replay under the renewed cookie.
    await switchTo(employee);
    const beforeResetLoss = assertOk(await read('presenter/controls'));
    let resetDropped = false; let resetLostBody; let resetRetriedBody; let resetRetryStatus;
    const resetLossRoute = async (route) => {
      const actual = await route.fetch();
      if (!resetDropped) {
        resetDropped = true; resetLostBody = route.request().postData();
        await route.fulfill({ response: actual, body: '{', contentType: 'application/json' });
      } else {
        resetRetriedBody = route.request().postData(); resetRetryStatus = (await actual.json()).status;
        await route.fulfill({ response: actual });
      }
    };
    await page.route('**/api/gcsp/presenter/scenarios/reset', resetLossRoute);
    const beforeLossRoot = await controls.elementHandle();
    await controls.getByRole('button', { name: 'Reset scenario', exact: true }).click();
    await controls.getByRole('button', { name: 'Confirm reset', exact: true }).click(); await idle();
    assert.ok(await beforeLossRoot.evaluate((node) => node.isConnected));
    const currentAfterBodyLoss = assertOk(await read('presenter/controls'));
    assert.notEqual(currentAfterBodyLoss.runId, beforeResetLoss.runId);
    await capture('13b-lost-reset-body-cookie-delivered');
    await Promise.all([page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() && frame.url() === origin + '/gcsp-presenter.html' }),
      controls.getByRole('button', { name: 'Retry original action', exact: true }).click()]);
    await page.waitForLoadState('load'); await idle(); await open();
    await page.unroute('**/api/gcsp/presenter/scenarios/reset', resetLossRoute);
    await beforeLossRoot.dispose();
    assert.equal(resetRetriedBody, resetLostBody); assert.equal(resetRetryStatus, 'stale-run');
    const reconciled = assertOk(await read('context'));
    assert.equal(reconciled.runId, currentAfterBodyLoss.runId); assert.ok(reconciled.roles.includes('presenter'));
    assert.equal(await page.locator('.gcsp-account-body').count(), 0);
    assert.match(await page.locator('.gcsp-header').innerText(), /Presenter/);
    assert.doesNotMatch(await controls.innerText(), /Reset done/);
    await capture('13c-reset-stale-retry-reconciled');
    check('Reset cookie delivered/body lost: exact retry returns stale-run; fresh agreed run/context navigates without success claim',
      { sameBody: true, retryStatus: resetRetryStatus, before: beforeResetLoss.runId, current: reconciled.runId });
    await page.route('**/api/gcsp/presenter/controls', (route) => route.abort('failed'));
    await controls.getByRole('button', { name: 'Refresh readback', exact: true }).click(); await idle();
    assert.match(await controls.innerText(), /Backend unavailable/);
    await capture('16-backend-read-outage'); check('Controlled actual transport outage is distinct from business refusal');
    await page.unroute('**/api/gcsp/presenter/controls');
    let releaseLate; let fetchedLate; let finishLate;
    const lateBarrier = new Promise((resolve) => { releaseLate = resolve; });
    const actualFetched = new Promise((resolve) => { fetchedLate = resolve; });
    const lateFinished = new Promise((resolve) => { finishLate = resolve; });
    const lateRoute = async (route) => {
      const actual = await route.fetch(); fetchedLate(); await lateBarrier;
      try { await route.fulfill({ response: actual }); }
      catch { /* navigating away deliberately aborts the old document's request */ }
      finally { finishLate(); }
    };
    await page.route('**/api/gcsp/presenter/controls', lateRoute);
    await controls.getByRole('button', { name: 'Refresh readback', exact: true }).click();
    await actualFetched;
    await page.unroute('**/api/gcsp/presenter/controls', lateRoute);
    await page.goto(origin + '/gcsp-presenter.html'); await idle(); await open();
    const freshRoot = await controls.elementHandle();
    const freshText = await controls.innerText(); const freshUrl = page.url();
    let lateNavigations = 0;
    const countLateNavigation = (frame) => { if (frame === page.mainFrame()) lateNavigations++; };
    page.on('framenavigated', countLateNavigation);
    releaseLate();
    await Promise.race([lateFinished, wait(2000).then(() => { throw new Error('Late route teardown did not settle'); })]);
    await wait(100);
    assert.ok(await freshRoot.evaluate((node) => node.isConnected));
    assert.equal(await controls.innerText(), freshText); assert.equal(page.url(), freshUrl); assert.equal(lateNavigations, 0);
    page.off('framenavigated', countLateNavigation); await freshRoot.dispose();
    await capture('16b-delayed-read-after-navigation');
    check('Actual delayed read after document teardown cannot replace fresh DOM or navigate');
  }
  if (chunk !== 'smoke-desktop') {
    for (const mode of ['pending', 'refused']) {
      await page.goto(origin + '/docs/gcsp/evidence/fucq-126/browser-visual.html?state=' + mode);
      await idle(); await tick().click(); await idle();
      assert.match(await page.locator('.proof-boundary').innerText(), /Synthetic visual fixture/);
      assert.match(await controls.innerText(), /2026-11-05T09:01:00.000Z/);
      assert.match(await controls.innerText(), /Release unavailable: no released count reported/);
      assert.match(await controls.innerText(), mode === 'pending' ? /pending/ : /Synthetic source refused release/);
      assert.ok(await tick().isEnabled());
      await controls.locator('.gcsp-presenter-results').scrollIntoViewIfNeeded();
      await capture('17-synthetic-' + mode);
      check('Synthetic ' + mode + ' rendering only; advance retained and next action enabled');
    }
  }
  assert.deepEqual(report.errors, []);
  report.state = 'passed';
} catch (error) {
  report.errors.push({ type: 'assertion-or-runner', message: error.stack || error.message });
  process.exitCode = 1;
} finally {
  try { await context?.close(); } catch { /* external supervisor still owns all identities */ }
  try { await browser?.close(); } catch { /* same */ }
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM'); await Promise.race([once(chrome, 'exit'), wait(1500)]);
    if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await once(chrome, 'exit'); }
  }
  if (server?.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  backend?.closeAllConnections();
  if (repository.close) await repository.close();
  report.listenerClosed = !server?.listening;
  await save();
  console.log(JSON.stringify({ state: report.state, chunk, checks: report.checks.length, screenshots: report.captures.length, errors: report.errors }));
}
