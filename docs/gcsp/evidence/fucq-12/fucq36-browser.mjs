// Reproducible, offline assembled-artifact trial. Run under test_resources/test_stamp.
// PLAYWRIGHT_MODULE is an existing absolute Playwright index.mjs, not an install.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assembleSite } from '../../../../scripts/assemble-site.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const deployedStyle = process.env.FUCQ36_API_STYLE === 'deployed';
const EVIDENCE = fileURLToPath(new URL(deployedStyle ? './fucq36-deployed-browser/' : './fucq36-browser/', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
// The trial never reads native credentials or asks an external stock provider.
delete process.env.DEMO_ACCESS_KEY;
const { startGcspDemo } = await import('../../../../scripts/gcsp-demo.mjs');
const { buildServer } = await import('../../../../server/index.js');
const { createPolicyService, FilePolicyProvider } = await import('../../../../server/gcsp/policy/index.js');
const { poolsFor } = await import('../../../../server/test/retail-compat-harness.js');
const inputs = JSON.parse(await readFile(path.join(ROOT, 'server/test/fixtures/retail-compat-v1/inputs.json'), 'utf8'));
const pools = poolsFor(inputs);
const output = path.join(process.env.TMPDIR, 'assembled-site');
const disabledOutput = path.join(process.env.TMPDIR, 'assembled-disabled');
const report = { proof: 'actual assembled package; real memory runtime/identity/manual entry; deterministic retail stock provider; no live data/database/deployment',
  node: process.version, configuration: deployedStyle ? 'deployed HTTPS API origin, browser requests forwarded only to owned loopback API' : 'local loopback HTTPS API',
  sourceHashes: {}, rows: [], errors: [], failedRequests: [], assetResponses: [], outsideRequests: [], screenshots: [], apiRequests: [], apiOutcomes: [], missingOffer: true };
let browser, demo, server, api;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2' };
let activeOutput = output;
try {
  await mkdir(EVIDENCE, { recursive: true });
  for (const file of ['scripts/assemble-site.mjs', 'scripts/gcsp-demo.mjs', 'server/index.js', 'server/gcsp/policy/seed-v1.json',
    'docs/gcsp/evidence/fucq-12/fucq36-browser.mjs']) report.sourceHashes[file] = createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex');
  const opened = await startGcspDemo({ root: ROOT, accessKey: null, runtime: { mode: 'memory',
    policy: createPolicyService({ provider: new FilePolicyProvider() }), environmentId: 'fucq36-assembled-proof',
    policyAsOf: '2026-11-06T00:00:00.000Z', commandId: 'fucq36-browser-bootstrap' } });
  assert.equal(opened.status, 'ok'); demo = opened.value;
  const keyFile = path.join(process.env.TMPDIR, 'loopback-key.pem'), certFile = path.join(process.env.TMPDIR, 'loopback-cert.pem');
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile,
    '-out', certFile, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore', timeout: 10000 });
  server = createServer({ key: await readFile(keyFile), cert: await readFile(certFile) }, async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') { api.emit('request', req, res); return; }
      const requestPath = url.pathname.replace(/^\/vehicle-matcher\//, '/');
      const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
      const file = path.resolve(activeOutput, relative);
      if (!file.startsWith(`${activeOutput}${path.sep}`) || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const origin = `https://localhost:${server.address().port}`;
  const configuredApi = deployedStyle ? 'https://gcsp-api.example.test' : origin;
  api = buildServer({ ...demo.services.dependencies, gcspAllowedOrigins: [origin],
    fetchRetailerStock: async (brand) => structuredClone(pools[brand]),
    fetchNearbyStock: async (brand) => structuredClone(pools[brand]),
    enrichColours: async (_brand, cars) => cars,
    fetchDealerDirectory: async () => new Map(inputs.location.directory), geocodePostcode: async () => null });
  assert.equal((await api.gcspStartup).status, 'ok');
  const configuration = { sourceRoot: ROOT, apiUrl: configuredApi, environment: deployedStyle ? 'deployed' : 'local', revision: process.env.FUCQ36_REVISION || 'unrecorded-working-tree' };
  const manifest = await assembleSite({ ...configuration, output });
  await assembleSite({ ...configuration, output: disabledOutput, employeeEnabled: false });
  report.manifestSha256 = createHash('sha256').update(await readFile(path.join(output, 'site-manifest.json'))).digest('hex');
  report.manifest = { revision: manifest.revision, apiUrl: manifest.apiUrl, blocks: manifest.blocks.map((b) => b.name), files: manifest.files.length,
    demoPages: manifest.demoPages };
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ignoreHTTPSErrors: true });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (deployedStyle && url.origin === configuredApi) {
      report.apiRequests.push({ pathname: url.pathname, origin: url.origin });
      return route.fulfill({ response: await route.fetch({ url: `${origin}${url.pathname}${url.search}`, ignoreHTTPSErrors: true }) });
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      report.outsideRequests.push({ type: route.request().resourceType(), url: `${url.origin}${url.pathname}` });
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/')) report.apiRequests.push({ pathname: url.pathname, origin: url.origin });
    return route.continue();
  });
  const session = await demo.services.createLocalSession();
  assert.equal(session.status, 'ok');
  await context.addCookies(session.value.setCookie.flat().map((header) => {
    const [pair] = header.split(';'), at = pair.indexOf('=');
    return { name: pair.slice(0, at), value: pair.slice(at + 1), url: configuredApi, httpOnly: true, secure: true, sameSite: 'None' };
  }));
  const page = await context.newPage();
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && response.request().resourceType() !== 'document' && !url.pathname.startsWith('/api/')) {
      report.assetResponses.push({ path: url.pathname, status: response.status(), type: response.request().resourceType() });
    }
    if (url.pathname.startsWith('/api/gcsp/')) {
      const body = await response.json().catch(() => ({}));
      report.apiOutcomes.push({ pathname: url.pathname, httpStatus: response.status(), status: body.status, code: body.code, reason: body.reason, error: body.error });
    }
  });
  page.on('pageerror', (error) => report.errors.push(error.message));
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin === configuredApi || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) report.failedRequests.push({ url: `${url.pathname}${url.search}`, error: request.failure()?.errorText });
  });
  const inspect = async (name, relative, expected, screenshot = true) => {
    const response = await page.goto(`${origin}${relative}`, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, name);
    if (expected) await page.getByText(expected, { exact: false }).filter({ visible: true }).first().waitFor();
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => ({ title: document.title, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      headings: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent),
      focus: { tag: document.activeElement.tagName, text: document.activeElement.textContent?.trim().slice(0, 100), outline: getComputedStyle(document.activeElement).outlineStyle },
      entry: document.querySelector('#demo-root')?.dataset.entryState,
      missingImages: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')) }));
    assert.ok(state.scrollWidth <= state.width + 1, `${name}: horizontal overflow ${state.scrollWidth}/${state.width}`);
    report.rows.push({ name, path: relative, ...state });
    if (screenshot) {
      const filename = `${name}.png`; await page.screenshot({ path: path.join(EVIDENCE, filename), fullPage: true }); report.screenshots.push(filename);
    }
  };
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = width === 1440 ? 'desktop' : 'narrow';
    await inspect(`launcher-${size}`, '/index.html', 'Employee cars');
    await page.getByRole('link', { name: /Used cars/ }).first().focus();
    await Promise.all([page.waitForURL('**/*experience=used-cars*'), page.keyboard.press('Enter')]);
    await page.locator('#demo-root[data-entry-state="retail-picker"]').waitFor();
    assert.equal(await page.locator('#demo-root').getAttribute('data-entry-state'), 'retail-picker');
    await inspect(`retail-${size}`, '/index.html?brand=bmw&mode=questionnaire', 'Find Your BMW');
    await inspect(`employee-${size}`, '/index.html?experience=employee-cars&brand=bmw', 'Paula (fictional)');
    assert.equal(await page.locator('gcsp-employee-entry').count(), 1);
    await inspect(`greg-${size}`, '/gcsp-greg.html', 'Demand');
    await inspect(`outbox-${size}`, '/gcsp-outbox.html', 'Captured emails');
    await inspect(`gallery-${size}`, '/components.html', null);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const prefix of ['/', '/vehicle-matcher/']) {
    for (const relative of ['index.html', 'index.html?experience=used-cars', 'index.html?experience=employee-cars&brand=bmw', 'block.html?brand=bmw', 'gcsp-greg.html', 'gcsp-outbox.html']) {
      await inspect(`direct-${prefix === '/' ? 'root' : 'prefix'}-${relative}`, `${prefix}${relative}`, null, false);
      await page.reload({ waitUntil: 'networkidle' });
    }
    const missing = await page.goto(`${origin}${prefix}gcsp-offer.html`); assert.equal(missing.status(), 404);
    for (const brand of ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']) for (const mode of ['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who']) {
      await inspect(`matrix-${prefix === '/' ? 'root' : 'prefix'}-${brand}-${mode}`, `${prefix}index.html?experience=used-cars&brand=${brand}&mode=${mode}`, null, false);
      assert.equal(await page.locator('#demo-root').getAttribute('data-entry-state'), 'retail');
      assert.equal(await page.locator('.vehicle-matcher').getAttribute('data-api'), configuredApi);
      assert.ok(await page.locator('.vm-stage').count() || await page.locator('.vm').count());
    }
  }
  activeOutput = disabledOutput;
  await page.setViewportSize({ width: 375, height: 1000 });
  await inspect('employee-disabled-narrow', '/vehicle-matcher/index.html?experience=employee-cars&brand=bmw', 'Employee cars unavailable');
  for (const brand of ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari']) for (const mode of ['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who']) {
    await inspect(`disabled-${brand}-${mode}`, `/vehicle-matcher/index.html?brand=${brand}&mode=${mode}`, null, false);
    assert.equal(await page.locator('#demo-root').getAttribute('data-entry-state'), 'retail');
  }
  activeOutput = output;
  await page.route('**/api/gcsp/manual/account', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', retryable: true }) }));
  await inspect('employee-service-error', '/index.html?experience=employee-cars&brand=bmw', 'Account unavailable');
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  assert.equal(report.failedRequests.length, 0, JSON.stringify(report.failedRequests));
  assert.equal(report.assetResponses.length, 0, JSON.stringify(report.assetResponses));
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = { message: error.message, stack: error.stack?.split('\n').slice(0, 5) };
  if (browser) { const pages = browser.contexts().flatMap((c) => c.pages()); if (pages[0]) await pages[0].screenshot({ path: path.join(EVIDENCE, 'failure.png'), fullPage: true }).catch(() => {}); }
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  api?.closeAllConnections();
  await demo?.close();
  await writeFile(path.join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, rows: report.rows.length, screenshots: report.screenshots.length, errors: report.errors,
    localFailures: report.failedRequests, blockedExternalImages: report.outsideRequests.length, failure: report.failure, report: path.join(EVIDENCE, 'report.json') }));
}
