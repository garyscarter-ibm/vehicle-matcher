// FUCQ-256 browser evidence: the live activity page shows the approved i5 corpus image in the offer panel.
// API answers are page.route fixtures built from repo code and data, not an end-to-end buddy run.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { createPolicyService } from '../../../../server/gcsp/policy/index.js';
import { createDemoStockProvider } from '../../../../server/gcsp/stock/demo-provider.js';
import { activityFixtures } from '../../../../blocks/gcsp/activity/activity-fixtures.js';
import { toOfferPresentation } from '../../../../blocks/gcsp/offer/offer-projection.js';

const ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const OUT = path.join(ROOT, 'docs/gcsp/evidence/fucq-256');
const PORT = 9270; const DEBUG_PORT = 9279;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORTS = [{ width: 1280, height: 900 }, { width: 375, height: 812 }];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { state: 'incomplete', note: 'API responses are page.route fixtures built from repo code and data (activity-fixtures, representative-access.json envelope, demo stock provider i5 display); this is not an end-to-end buddy run.',
  viewports: {}, abortedApi: [], errors: [], cleanup: {} };
let scratch; let chrome; let browser; let server;
const killChrome = (signal) => { try { if (chrome?.pid) process.kill(-chrome.pid, signal); } catch { /* already gone */ } };
process.on('exit', () => killChrome('SIGKILL'));

// Fixtures from repo code. The offer envelope follows server/test/gcsp-activity-transport.test.js.
async function buildFixtures() {
  const out = await createDemoStockProvider({ policy: createPolicyService() }).pull({ runId: 'demo-fucq256', asOf: '2026-11-06T12:00:00.000Z',
    policyVersion: 'gcsp-policy-v1', released: [], releaseSize: 10, queuedSupply: [] });
  assert.equal(out.status, 'ok');
  const car = out.value.stock.find((row) => row.facts.facts.eligibilityModelKey.value === 'G61 i5|i5 40');
  assert.ok(car?.facts.display.images.length, 'demo stock has an i5 with an approved image');
  const activity = structuredClone(activityFixtures.snapshots.offer);
  const offerId = activity.value.currentOffer.offerRef.offerId;
  const runId = 'demo-4c7d45fb1cefd387adf500299f0b119f';
  activity.value.runId = runId;
  const offer = JSON.parse(await readFile(path.join(ROOT, 'docs/gcsp/evidence/fucq105/representative-access.json'), 'utf8'));
  Object.assign(offer, { availableActions: [], offerId, runId });
  offer.quote.facts.display = car.facts.display;
  const envelope = { status: 'ok', value: offer, contractVersion: '1.0.0' };
  const presented = toOfferPresentation(envelope, { reference: { offerId, runId } });
  assert.equal(presented.status, 'ok', `the offer envelope passes the offer view validation: ${JSON.stringify(presented).slice(0, 200)}`);
  // The minimal account the page's createAccountHttpAdapter accepts as ready.
  const account = { status: 'ok', value: { state: 'ready', account: { name: 'Paula Fictional', gradeId: 'G1-6' } } };
  return { activity, envelope, account, offerId, runId };
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json' };
const staticOk = (p) => /^\/(blocks|assets)\//.test(p) || /^\/[^/]+\.(html|css)$/.test(p);
async function startStatic() {
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const file = path.resolve(ROOT, '.' + pathname);
    if (!staticOk(pathname) || !file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('Not found'); }
    readFile(file).then((bytes) => { res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes); },
      () => { res.writeHead(404); res.end('Not found'); });
  });
  server.listen(PORT, '127.0.0.1'); await once(server, 'listening');
}

async function capture(viewport, fx) {
  const origin = `http://127.0.0.1:${PORT}`;
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const aborted = []; const consoleErrors = [];
  try {
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { aborted.push(route.request().url()); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/gcsp/manual/account') return json(route, fx.account);
      if (url.pathname === '/api/gcsp/activity') return json(route, fx.activity);
      if (url.pathname === `/api/gcsp/offers/${fx.offerId}` && url.searchParams.get('runId') === fx.runId) return json(route, fx.envelope);
      aborted.push(url.pathname + url.search); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.goto(`${origin}/gcsp-activity-live.html`, { waitUntil: 'domcontentloaded' });
    const offer = page.locator('.gcsp-activity-offer');
    await offer.locator('img.vm-card-photo').waitFor({ state: 'attached' }).catch(() => {});
    await page.waitForFunction(() => { const i = document.querySelector('.gcsp-activity-offer img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
    await offer.scrollIntoViewIfNeeded().catch(() => {});
    await wait(200);
    const facts = await page.evaluate(() => {
      const root = document.querySelector('.gcsp-activity-offer'); const img = root?.querySelector('img');
      return { imgSrc: img?.getAttribute('src') ?? null, naturalWidth: img?.naturalWidth ?? 0, alt: img?.alt ?? null,
        caption: root?.querySelector('.vm-media-caption')?.textContent ?? null,
        placeholderPresent: Boolean(root) && getComputedStyle(root.querySelector('.vm-card-soon')).display !== 'none' && !root.querySelector('.vm-card-media')?.classList.contains('has-photo'),
        title: root?.querySelector('.gcsp-activity-offer-name')?.textContent ?? null,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth };
    });
    const file = `${viewport.width}-activity-offer-i5.png`;
    const png = await offer.screenshot({ path: path.join(OUT, file) }).catch(async () => page.screenshot({ path: path.join(OUT, file) }));
    report.viewports[viewport.width] = { ...facts, consoleErrors, abortedApi: aborted, screenshot: file, screenshotBytes: png.length };
    report.abortedApi.push(...aborted);
  } finally { await context.close().catch(() => {}); }
}

try {
  await mkdir(OUT, { recursive: true });
  scratch = await mkdtemp(path.join(process.env.FUCQ256_SCRATCH || tmpdir(), 'fucq256-'));
  report.cleanup.scratch = scratch;
  const fixtures = await buildFixtures();
  await startStatic();
  const profileDir = path.join(scratch, 'chrome-profile'); await mkdir(profileDir, { recursive: true });
  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--disable-extensions',
    '--disk-cache-size=1048576', '--media-cache-size=1048576', `--crash-dumps-dir=${path.join(scratch, 'crashes')}`, 'about:blank'], { stdio: 'ignore', detached: true });
  report.cleanup.chromePid = chrome.pid;
  let ready = false;
  for (let i = 0; i < 300 && !ready; i += 1) { ready = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.ok, () => false); if (!ready) await wait(100); }
  assert.ok(ready, 'Chrome exposes its owned CDP port');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
  for (const viewport of VIEWPORTS) await capture(viewport, fixtures);
  const rows = Object.values(report.viewports);
  report.state = rows.length === VIEWPORTS.length && rows.every((r) => r.naturalWidth > 0 && !r.placeholderPresent && !r.horizontalOverflow) ? 'passed' : 'completed-with-failures';
} catch (error) {
  report.errors.push(String(error.stack || error.message).slice(0, 800)); report.state = 'runner-error'; process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch { /* chrome is killed below */ }
  if (chrome && chrome.exitCode === null) {
    killChrome('SIGTERM'); await Promise.race([once(chrome, 'exit'), wait(1500)]);
    if (chrome.exitCode === null) { killChrome('SIGKILL'); await Promise.race([once(chrome, 'exit'), wait(1500)]); }
  }
  if (server?.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  if (scratch) {
    await rm(scratch, { recursive: true, force: true });
    report.cleanup.scratchRemoved = await stat(scratch).then(() => false, () => true);
  }
  let alive = false; try { if (chrome?.pid) { process.kill(chrome.pid, 0); alive = true; } } catch { /* gone */ }
  report.cleanup.chromeAlive = alive; report.cleanup.serverClosed = !server?.listening;
  const { scratch: _owned, ...cleanup } = report.cleanup; report.cleanup = cleanup;
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ state: report.state, cleanup: report.cleanup, errors: report.errors.length }));
}
