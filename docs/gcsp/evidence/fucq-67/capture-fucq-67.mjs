import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createGcspRuntime } from '../../../../server/gcsp/runtime.js';
import { buildServer } from '../../../../server/index.js';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'docs/gcsp/evidence/fucq-67');
const PLAYWRIGHT = '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIMIT = 12 * 1024 * 1024;
const serviceOnly = process.argv.includes('--service-only');
const mkdirp = (dir) => mkdir(dir, { recursive: true });
const mime = (file) => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' })[path.extname(file)] || 'application/octet-stream';

if (!process.env.TMPDIR || !existsSync(process.env.TMPDIR)) throw new Error('Supervisor-owned TMPDIR is required.');
if (!existsSync(PLAYWRIGHT) || !existsSync(CHROME)) throw new Error('Retained browser dependencies are unavailable.');
const scratch = process.env.TMPDIR;
await mkdirp(path.join(scratch, 'chrome-profile'));
await mkdirp(path.join(scratch, 'chrome-cache'));

const runtimeResult = await createGcspRuntime({ mode: 'memory', environmentId: 'fucq67-browser',
  policyAsOf: '2026-11-05T09:00:00.000Z', commandId: 'bootstrap-fucq67-browser', secureCookies: false,
  sessionNow: () => '2026-11-05T09:00:00.000Z' });
if (runtimeResult.status !== 'ok') throw new Error(`Memory runtime unavailable: ${runtimeResult.status}`);
const runtime = runtimeResult.value;
let context;
let server;
let api;
let listenerOrigin = null;
let listenerHost = '127.0.0.1';
let listenerPort = null;
let contextClosed = false;
let listenerClosed = false;
let runtimeClosed = false;
const results = {
  story: 'FUCQ-67', phase: serviceOnly ? 'actual-service-smoke' : 'full-matrix', captureHead: '717df5c0eff189e7db5d12eaa16bd1919ec7b2bb', productHead: 'db4a53bbe7865f06d3434f8a6ec095bfa74c384f',
  approvedBase: 'ade262aa81c7ccbf0043e0f5658a7052f501734e', viewport: {}, actualService: {}, fixtures: {}, probes: {},
  keyboard: {}, externalRequests: [], errors: [], screenshots: [], cleanup: {},
};
const session = await runtime.createLocalSession();
if (session.status !== 'ok') throw new Error(`Local synthetic session unavailable: ${session.status}`);

try {
  // One listener serves both static files and the real GCSP HTTP handler. The
  // buildServer object is composed into it and never binds its own port.
  let origin = '';
  const dispatch = createServer(async (req, res) => {
    const url = new URL(req.url, origin || 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/api/')) return api.emit('request', req, res);
    let file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const absolute = path.resolve(ROOT, file);
    if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403); return res.end(); }
    try {
      const bytes = await readFile(absolute);
      res.writeHead(200, { 'Content-Type': mime(absolute), 'Cache-Control': 'no-store' });
      res.end(bytes);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  server = dispatch;
  await new Promise((resolve, reject) => {
    dispatch.once('error', reject);
    dispatch.listen(0, '127.0.0.1', resolve);
  });
  listenerPort = dispatch.address().port;
  origin = `http://${listenerHost}:${listenerPort}`;
  listenerOrigin = origin;
  const denied = async () => { throw new Error('Non-GCSP application service must not be called in this proof.'); };
  api = buildServer({ ...runtime.dependencies, gcspAllowedOrigins: [origin], fetchRetailerStock: denied,
    fetchNearbyStock: denied, enrichColours: denied, fetchDealerDirectory: denied, geocodePostcode: denied });
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT));
  context = await chromium.launchPersistentContext(path.join(scratch, 'chrome-profile'), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--disk-cache-dir=${path.join(scratch, 'chrome-cache')}`,
      '--disable-background-networking', '--disable-default-apps', '--disable-sync', '--no-first-run'],
  });
  const actingCookie = session.value.setCookie[1];
  const cookiePairs = [actingCookie.split(';', 1)[0]].map((pair) => {
    const index = pair.indexOf('=');
    return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: '127.0.0.1', path: '/api/gcsp',
      httpOnly: true, sameSite: 'Lax', secure: false };
  });
  await context.addCookies(cookiePairs); // Synthetic credentials stay in this ephemeral browser context.
  const page = await context.newPage();
  const apiRecords = [];
  const apiTasks = [];
  const appRequests = [];
  results.browserErrors = []; results.journeyEvents = [];
  await page.exposeFunction('captureJourneyEvent', (detail) => results.journeyEvents.push(detail));
  await page.addInitScript(() => {
    window.__gcspJourneyEvents = [];
    document.addEventListener('gcsp:journey-start', (event) => {
      const detail = event.detail || {};
      const safe = { mode: detail.mode, oldContractId: detail.oldContractId, slotId: detail.slotId, schemeId: detail.schemeId,
        draftVersion: detail.draftVersion, contextVersion: detail.contextVersion };
      window.__gcspJourneyEvents.push(safe); window.captureJourneyEvent?.(safe);
    });
  });
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === origin) return route.continue();
    results.externalRequests.push({ host: requestUrl.hostname, path: requestUrl.pathname, method: route.request().method() });
    return route.abort('blockedbyclient');
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== origin || !url.pathname.startsWith('/api/gcsp/')) return;
    const record = { method: response.request().method(), path: url.pathname, httpStatus: response.status() };
    apiRecords.push(record);
    apiTasks.push((async () => {
      try {
        const payload = await response.json();
        record.status = payload?.status ?? null;
        record.contractVersion = payload?.contractVersion ?? null;
        if (payload?.status === 'ok') {
          const value = payload.value ?? {};
          if (Array.isArray(value.currentContracts)) record.currentContracts = value.currentContracts.length;
          if (Array.isArray(value.histories)) record.histories = value.histories.map((item) => ({ schemeId: item.schemeId, count: item.count, orderingSupported: item.orderingSupported }));
          if (Array.isArray(value.actions)) record.actions = value.actions.map(({ action, enabled, reason }) => ({ action, enabled, reason }));
          if (value.state) record.state = value.state;
          if (value.draftStage) record.draftStage = value.draftStage;
          if (value.draftVersion) record.draftVersion = value.draftVersion;
          if (value.choices) record.choices = { mode: value.choices.mode, oldContractId: value.choices.oldContractId,
            slotId: value.choices.slotId, schemeId: value.choices.schemeId };
          if (value.requiresRefresh != null) record.requiresRefresh = value.requiresRefresh;
        }
      } catch { record.schemaRead = 'unavailable'; }
    })());
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname.startsWith('/api/gcsp/')) appRequests.push({ method: request.method(), path: url.pathname });
  });
  page.on('pageerror', (error) => results.browserErrors.push({ type: 'pageerror', message: String(error.message).slice(0, 180) }));
  page.on('console', (message) => { if (message.type() === 'error') results.browserErrors.push({ type: 'console', message: message.text().slice(0, 180) }); });
  const save = async (file, metadata = {}) => {
    const destination = path.join(OUT, file);
    await page.screenshot({ path: destination, type: 'png', animations: 'disabled', fullPage: true });
    results.screenshots.push({ file, width: (await page.evaluate(() => innerWidth)), height: (await page.evaluate(() => innerHeight)), ...metadata });
  };
  const ready = async (url) => {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.getByRole('heading', { name: 'Your cars', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
  };
  const base = `${origin}/gcsp-account.html`;
  await ready(base);
  results.actualService.initialVisible = await page.locator('gcsp-account').innerText().then((text) => text.includes('Fictional BMW 320i Touring'));
  results.actualService.initialOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  results.actualService.initialContractIds = await page.locator('.gcsp-feature').evaluateAll((nodes) => nodes.map((node) => node.dataset.contractId));
  const contractSummary = page.locator('.gcsp-feature details > summary').first();
  await page.locator('.gcsp-feature').first().getByRole('button', { name: 'Choose a replacement', exact: true }).focus();
  await page.keyboard.press('Tab');
  results.keyboard.contractSummaryReachedByTab = await contractSummary.evaluate((node) => document.activeElement === node);
  await page.keyboard.press('Enter');
  results.keyboard.contractDetailsOpened = await contractSummary.evaluate((node) => ({ focused: document.activeElement === node, open: node.parentElement.open, label: node.innerText }));
  const historySummary = page.locator('.gcsp-account-histories details > summary').first();
  let historyTabs = 0;
  while (historyTabs < 40 && !await historySummary.evaluate((node) => document.activeElement === node)) {
    await page.keyboard.press('Tab'); historyTabs += 1;
  }
  results.keyboard.historyFocusedByTab = await historySummary.evaluate((node) => document.activeElement === node);
  results.keyboard.tabsToHistorySummary = historyTabs;
  await page.keyboard.press('Enter');
  results.keyboard.historyOpened = await historySummary.evaluate((node) => ({ focused: document.activeElement === node, open: node.parentElement.open, label: node.innerText }));
  results.keyboard.focusVisible = await historySummary.evaluate((node) => {
    const style = getComputedStyle(node);
    return Boolean(style.outlineStyle !== 'none' || style.boxShadow !== 'none' || node.matches(':focus-visible'));
  });
  await save('01-service-desktop-account.png', { case: 'actual-service-ready-keyboard-details' });
  await page.locator('.gcsp-feature').first().getByRole('button', { name: 'Choose a replacement', exact: true }).click();
  await page.getByText('Replacement journey saved', { exact: true }).waitFor({ state: 'visible' });
  await save('02-service-desktop-saved.png', { case: 'actual-service-replacement-saved' });
  const desktopDraft = await page.locator('.gcsp-summary').innerText();
  results.actualService.desktopSavedShowsReplacement = desktopDraft.includes('Replacement');
  results.actualService.currentContractAfterSave = await page.locator('.gcsp-feature').evaluateAll((nodes) => nodes.map((node) => node.dataset.contractId));
  results.actualService.currentContractUnchangedAfterSave = JSON.stringify(results.actualService.initialContractIds) === JSON.stringify(results.actualService.currentContractAfterSave);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Replacement journey saved', { exact: true }).waitFor({ state: 'visible' });
  await save('03-service-desktop-reloaded.png', { case: 'persisted-draft-after-reload' });
  results.actualService.desktopReloadRetainedDraft = true;
  await page.getByRole('button', { name: 'Resume saved journey', exact: true }).click();
  await page.getByRole('heading', { name: 'Your saved journey', exact: true }).waitFor({ state: 'visible' });
  await save('04-service-desktop-resumed.png', { case: 'actual-service-resumed' });
  results.actualService.desktopResumeChangedView = true;
  results.actualService.currentContractAfterResume = await page.locator('.gcsp-feature').evaluateAll((nodes) => nodes.map((node) => node.dataset.contractId));
  await page.getByRole('button', { name: 'Back to account', exact: true }).click();
  await page.getByRole('heading', { name: 'Your cars', exact: true }).waitFor({ state: 'visible' });
  results.actualService.backReturnedToAccount = await page.locator('.gcsp-feature').count() === 1;
  results.actualService.desktopContractAfterBack = await page.locator('.gcsp-feature').evaluateAll((nodes) => nodes.map((node) => node.dataset.contractId));
  results.actualService.desktopContractUnchangedAfterBack = JSON.stringify(results.actualService.initialContractIds) === JSON.stringify(results.actualService.desktopContractAfterBack);

  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your cars', exact: true }).waitFor({ state: 'visible' });
  results.actualService.narrowInitialOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await save('05-service-narrow-account.png', { case: 'actual-service-ready', width: 320 });
  await page.getByRole('button', { name: 'Resume saved journey', exact: true }).click();
  await page.getByRole('heading', { name: 'Your saved journey', exact: true }).waitFor({ state: 'visible' });
  results.actualService.narrowSavedOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await save('06-service-narrow-saved.png', { case: 'actual-service-resumed', width: 320 });
  await page.getByRole('button', { name: 'Back to account', exact: true }).click();
  await page.getByRole('heading', { name: 'Your cars', exact: true }).waitFor({ state: 'visible' });
  results.actualService.narrowBackReturnedToAccount = await page.locator('.gcsp-feature').count() === 1;
  results.actualService.narrowContractAfterBack = await page.locator('.gcsp-feature').evaluateAll((nodes) => nodes.map((node) => node.dataset.contractId));
  results.actualService.narrowContractUnchangedAfterBack = JSON.stringify(results.actualService.initialContractIds) === JSON.stringify(results.actualService.narrowContractAfterBack);
  results.actualService.startPostCount = appRequests.filter((item) => item.method === 'POST' && item.path === '/api/gcsp/manual/draft').length;
  results.actualService.contractUnchanged = results.actualService.currentContractUnchangedAfterSave
    && results.actualService.desktopContractUnchangedAfterBack && results.actualService.narrowContractUnchangedAfterBack;
  results.actualService.singleStartPost = results.actualService.startPostCount === 1;

  const fixtureExpectations = serviceOnly ? {} : {
    'multi-slot': 'Your current car', 'missing-image': 'No image for this car yet',
    'absent-hr-account': 'Your HR account is missing', 'not-yet-eligible': 'Replacement is not available yet',
    'source-failure': 'Your account is unavailable',
  };
  let number = 7;
  for (const [fixture, expected] of Object.entries(fixtureExpectations)) {
    results.fixtures[fixture] = {};
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
      await ready(`${base}?fixture=${encodeURIComponent(fixture)}`);
      const bodyText = await page.locator('gcsp-account').innerText();
      const visible = bodyText.includes(expected);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      results.fixtures[fixture][String(width)] = { expectedVisible: visible, overflow,
        currentCarCount: await page.locator('.gcsp-feature').count(),
        historyGroupCount: await page.locator('.gcsp-account-histories details').count(),
        detailsSummaryCount: await page.locator('gcsp-account details > summary').count(),
        visibleImageCount: await page.locator('gcsp-account img').count(),
        brokenImageCount: await page.locator('gcsp-account img').evaluateAll((images) => images.filter((image) => image.complete && image.naturalWidth === 0).length) };
      const tag = width === 320 ? 'narrow' : 'desktop';
      const filename = `${String(number).padStart(2, '0')}-${fixture}-${tag}.png`;
      await save(filename, { case: fixture, width });
      number += 1;
    }
  }
  for (const [probe, expected] of (serviceOnly ? [] : [['no-current-car', 'No current car'], ['no-history', 'No order history.']])) {
    await ready(`${base}?fixture=${encodeURIComponent(probe)}`);
    const text = await page.locator('gcsp-account').innerText();
    results.probes[probe] = { expectedVisible: text.includes(expected), detail: expected };
  }
  await Promise.allSettled(apiTasks);
  const savedDraftResponses = apiRecords.filter((item) => item.path === '/api/gcsp/manual/draft' && item.method === 'POST');
  results.actualService.savedDraftVersion = savedDraftResponses.at(-1)?.draftVersion ?? null;
  const persistedDraftReads = apiRecords.filter((item) => item.path === '/api/gcsp/manual/draft' && item.method === 'GET' && item.status === 'ok');
  results.actualService.persistedDraftVersion = persistedDraftReads.at(-1)?.draftVersion ?? null;
  results.actualService.persistedDraftVisibleAfterReload = results.actualService.persistedDraftVersion === results.actualService.savedDraftVersion;
  results.actualService.journeyEventsPresent = results.journeyEvents.length >= 2 && results.journeyEvents.every((event) => event.mode === 'replacement');
  results.apiRequests = apiRecords;
  results.externalRequests = [...new Map(results.externalRequests.map((item) => [`${item.method} ${item.host}${item.path}`, item])).values()];
  const expectedNotFoundDraftReads = apiRecords.filter((item) => item.method === 'GET' && item.path === '/api/gcsp/manual/draft'
    && item.httpStatus === 404 && item.status === 'not-found');
  const unexpectedHttpErrors = apiRecords.filter((item) => item.httpStatus >= 400 && !expectedNotFoundDraftReads.includes(item));
  results.network = { allGcspResponsesExpected: apiRecords.length > 0 && apiRecords.every((item) => item.httpStatus === 200
      || item.httpStatus === 404 && item.status === 'not-found'), gcspRequestCount: apiRecords.length,
    expectedNotFoundDraftReads: expectedNotFoundDraftReads.length, expectedHttpResponses: expectedNotFoundDraftReads.map(({ method, path, httpStatus, status }) => ({ method, path, httpStatus, status })),
    unexpectedHttpErrors };
  results.browserErrorClassification = { pageErrors: results.browserErrors.filter((item) => item.type === 'pageerror'),
    consoleErrors: results.browserErrors.filter((item) => item.type === 'console') };
  results.viewport = { desktop: { width: 1280, height: 900 }, narrow: { width: 320, height: 740 } };
  results.listener = { host: listenerHost, port: listenerPort, origin: listenerOrigin, listenerCount: 1 };
  results.sourceHashes = {};
  const sourceFiles = ['gcsp-account.html', 'blocks/gcsp/account/harness.js', 'blocks/gcsp/account/gcsp-account.js',
    'blocks/gcsp/account/account-view.js', 'blocks/gcsp/account/http-adapter.js', 'blocks/gcsp/account/gcsp-account.css',
    'blocks/gcsp/account/fixtures.js', 'server/gcsp/runtime.js', 'server/gcsp/manual-context/http.js',
    'server/gcsp/manual-context/index.js', 'server/index.js'];
  for (const file of sourceFiles) results.sourceHashes[file] = createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex');
  if (!results.actualService.initialVisible || !results.actualService.desktopReloadRetainedDraft || !results.actualService.desktopResumeChangedView
    || !results.actualService.desktopSavedShowsReplacement || !results.actualService.backReturnedToAccount
    || !results.actualService.narrowBackReturnedToAccount || !results.actualService.contractUnchanged || !results.actualService.singleStartPost
    || !results.actualService.persistedDraftVisibleAfterReload || !results.actualService.journeyEventsPresent
    || !results.keyboard.contractSummaryReachedByTab || !results.keyboard.historyFocusedByTab
    || !results.keyboard.contractDetailsOpened.open || !results.keyboard.historyOpened.open || !results.keyboard.focusVisible
    || !results.network.allGcspResponsesExpected || results.network.unexpectedHttpErrors.length > 0
    || results.browserErrorClassification.pageErrors.length > 0 || results.browserErrorClassification.consoleErrors.length > 0
    || results.externalRequests.length > 0
    || Object.values(results.fixtures).some((widths) => Object.values(widths).some((item) => !item.expectedVisible))) {
    throw new Error('One or more required browser assertions failed; inspect the sanitized matrix.');
  }
} catch (error) {
  results.errors.push(String(error?.message || error).slice(0, 300));
  throw error;
} finally {
  if (context) { try { await context.close(); contextClosed = true; } catch { } }
  else contextClosed = true;
  if (server?.listening) { try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); listenerClosed = true; } catch { } }
  else listenerClosed = true;
  try { await runtime.close(); runtimeClosed = true; } catch { }
  results.cleanup = { browserContextClosed: contextClosed, apiServerNeverBound: !api?.listening,
    composedListenerClosed: listenerClosed && !server?.listening, runtimeClosed, independentlyVerifyHost: listenerHost, port: listenerPort };
  try {
    const pngs = results.screenshots.map((item) => path.join(OUT, item.file));
    let bytes = 0; results.captureFiles = [];
    for (let index = 0; index < pngs.length; index += 1) {
      try { const image = await readFile(pngs[index]); bytes += image.byteLength;
        results.captureFiles.push({ file: results.screenshots[index].file, bytes: image.byteLength, sha256: createHash('sha256').update(image).digest('hex') });
      } catch { }
    }
    results.captureBytes = bytes; results.captureCount = results.captureFiles.length;
    results.captureLimitBytes = LIMIT;
    results.evidenceFiles = ['capture-fucq-67.mjs', 'fucq-67-browser-matrix.json', 'README.md', ...results.captureFiles.map((entry) => entry.file)];
    results.evidenceFileCount = results.evidenceFiles.length;
    if (bytes > LIMIT) results.errors.push('Capture size exceeded 12 MiB.');
    await writeFile(path.join(OUT, 'fucq-67-browser-matrix.json'), `${JSON.stringify(results, null, 2)}\n`);
  } catch { }
}
if (results.errors.length) process.exitCode = 1;
console.log(JSON.stringify({ screenshots: results.screenshots.length, captureBytes: results.captureBytes, apiRequests: results.network?.gcspRequestCount,
  errors: results.errors, cleanup: results.cleanup }));
