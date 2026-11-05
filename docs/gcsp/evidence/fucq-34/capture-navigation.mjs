import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../../../../server/index.js';
import { bmwPool, miniPool, fordPool, hondaPool, motorradPool, ferrariPool } from '../../../../server/test/helpers.js';

const ROOT = resolve(process.env.PROJECT_ROOT || process.cwd());
const EVIDENCE = join(ROOT, 'docs/gcsp/evidence/fucq-34');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLAYWRIGHT_CORE = process.env.PLAYWRIGHT_CORE || '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const FRONT_HOST = 'vehicle-matcher.demo.test';
const FRONT_PORTS = [31461, 31462, 31463];
const FRONT_ORIGIN_BASE = `http://${FRONT_HOST}`;
const REMOTE_API = 'https://bmw-matcher-api.onrender.com';
const SYNTHETIC_GATE_TOKEN = 'fixture-only-gate-token';
const BRANDS = ['bmw', 'mini', 'ford', 'honda', 'motorrad', 'ferrari'];
const MODES = ['questionnaire', 'swipe', 'head-to-head', 'podium', 'guess-who'];
const { chromium } = await import(PLAYWRIGHT_CORE);

const sha = (input) => createHash('sha256').update(input).digest('hex');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const now = () => new Date().toISOString();
const ownPath = fileURLToPath(import.meta.url);

function fixturePools() {
  const sources = { bmw: bmwPool(12), mini: miniPool(8), ford: fordPool(12), honda: hondaPool(12), motorrad: motorradPool(12), ferrari: ferrariPool(12) };
  return Object.fromEntries(Object.entries(sources).map(([brand, cars]) => [brand, cars.map((car) => ({ ...car, photo: null }))]));
}

async function freePort(port) {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolveListen);
  });
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
}

async function startStaticServer() {
  let port;
  for (const candidate of FRONT_PORTS) {
    try { await freePort(candidate); port = candidate; break; } catch { /* try the next reserved fallback */ }
  }
  if (!port) throw new Error('No planned static preview port is free (31461–31463).');
  const child = spawn(process.execPath, ['scripts/serve.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port) }, detached: false, stdio: 'ignore',
  });
  const origin = `${FRONT_ORIGIN_BASE}:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Static server exited early with ${child.exitCode}.`);
    try { const response = await fetch(`http://127.0.0.1:${port}/index.html`); if (response.ok) return { child, origin, port }; } catch { /* wait for the owned child */ }
    await sleep(50);
  }
  throw new Error('Static preview did not become ready.');
}

async function startFixtureApi() {
  const pools = fixturePools();
  process.env.DEMO_ACCESS_KEY = '';
  const server = buildServer({
    fetchRetailerStock: async (brand) => pools[brand] || pools.bmw,
    fetchNearbyStock: async () => [],
    enrichColours: async (_brand, cars) => cars,
    fetchDealerDirectory: async () => new Map(),
    geocodePostcode: async () => null,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

let trackedChrome = null;
const knownChromeProcesses = new Map();
const runtimeResources = {};
function ownedProcessCheckpoint(stage) {
  const group = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
  const all = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,rss=,comm='], { encoding: 'utf8' }).split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map((row) => ({ pid: Number(row[1]), parent: Number(row[2]), group: Number(row[3]), rssBytes: Number(row[4]) * 1024, executable: row[5].split('/').at(-1) }));
  const processes = all.filter((row) => row.group === group);
  const descendantPids = new Set(trackedChrome ? [trackedChrome.pid] : []);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of all) if (descendantPids.has(row.parent) && !descendantPids.has(row.pid)) { descendantPids.add(row.pid); changed = true; }
  }
  const profilePids = trackedChrome ? execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }).split('\n').map((line) => line.trim().match(/^(\d+)\s+(.+)$/)).filter((row) => row && row[2].includes(trackedChrome.profile)).map((row) => Number(row[1])) : [];
  const argumentRows = trackedChrome ? execFileSync('/bin/ps', ['-axo', 'pid=,args='], { encoding: 'utf8' }).split('\n').map((line) => line.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean) : [];
  for (const row of argumentRows) if (descendantPids.has(Number(row[1])) || profilePids.includes(Number(row[1]))) {
    const handler = row[2].match(/--crashpad-handler-pid=(\d+)/);
    if (handler) descendantPids.add(Number(handler[1]));
  }
  for (const row of all) if (descendantPids.has(row.parent)) descendantPids.add(row.pid);
  const chromeProcesses = all.filter((row) => descendantPids.has(row.pid) || profilePids.includes(row.pid) || knownChromeProcesses.has(row.pid));
  chromeProcesses.forEach((row) => knownChromeProcesses.set(row.pid, row));
  const escaped = chromeProcesses.filter((row) => row.group !== group);
  const record = { checkpoint: 'owned-startup-rss', stage, group, rssBytes: processes.reduce((total, row) => total + row.rssBytes, 0), processes, chromeProcesses, profilePids, escaped };
  console.log(JSON.stringify(record));
  if (escaped.length) throw new Error(`Owned Chrome descendants escaped supervised group: ${escaped.map((row) => row.pid).join(',')}`);
  return record;
}

async function launchChrome() {
  if (!process.env.TMPDIR) throw new Error('The lead supervisor did not supply TMPDIR.');
  const profile = join(process.env.TMPDIR, 'fucq34-chrome-profile');
  const child = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-extensions',
    '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication', '--remote-debugging-port=0',
    '--remote-allow-origins=*', `--user-data-dir=${profile}`,
    `--host-resolver-rules=MAP ${FRONT_HOST} 127.0.0.1,EXCLUDE localhost`, 'about:blank',
  ], { detached: false, stdio: ['ignore', 'ignore', 'ignore'] });
  trackedChrome = { pid: child.pid, profile, child };
  ownedProcessCheckpoint('chrome-spawned');
  const activePortFile = join(profile, 'DevToolsActivePort');
  let endpoint;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Chrome exited early with ${child.exitCode}.`);
    try {
      const lines = (await readFile(activePortFile, 'utf8')).trim().split(/\r?\n/);
      if (Number(lines[0])) { endpoint = `http://127.0.0.1:${lines[0]}`; break; }
    } catch { /* Chrome writes the port file after startup */ }
    await sleep(50);
  }
  ownedProcessCheckpoint('chrome-devtools-ready');
  if (!endpoint) throw new Error('Chrome remote debugging endpoint did not become ready.');
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  ownedProcessCheckpoint('cdp-connected');
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome did not provide its default browser context.');
  context.setDefaultTimeout(6500);
  context.setDefaultNavigationTimeout(12000);
  return { child, browser, context, profile, endpoint };
}

function urlFor(origin, path, params = {}) {
  const url = new URL(path, `${origin}/`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return `${url.pathname}${url.search}${url.hash}`;
}

function makeState(kind, sourceCommit, harnessSha) {
  const path = join(EVIDENCE, `navigation-${kind}.json`);
  return { path, value: { story: 'FUCQ-34', sourceCommit, harnessSha, capturedAt: now(), fixtureBacked: true, runtimeResources: { ...runtimeResources }, externalEgress: 'blocked; remote default API fulfilled by injected local buildServer fixtures', checks: [], cases: [] } };
}

async function loadExisting(state) {
  try {
    const old = JSON.parse(await readFile(state.path, 'utf8'));
    if (old.sourceCommit === state.value.sourceCommit && old.harnessSha === state.value.harnessSha) {
      state.value = old;
      return true;
    }
  } catch { /* first run */ }
  return false;
}

async function saveState(state) {
  state.value.capturedAt = now();
  const temp = `${state.path}.tmp`;
  await writeFile(temp, `${JSON.stringify(state.value, null, 2)}\n`);
  await rename(temp, state.path);
}

function check(state, id, pass, expected, observed, details = {}) {
  const item = { id, pass: Boolean(pass), expected, observed, ...details };
  const found = state.value.checks.findIndex((checkItem) => checkItem.id === id);
  if (found >= 0) state.value.checks[found] = item;
  else state.value.checks.push(item);
  return item;
}

async function observePage(page, origin, fixtureOrigin) {
  const log = { errors: [], failed: [], badLocalResponses: [], externalBlocked: [], apiCalls: [] };
  let scope = 'setup';
  page.on('pageerror', (error) => log.errors.push({ scope, message: String(error) }));
  page.on('console', (message) => { if (message.type() === 'error') log.errors.push({ scope, message: message.text() }); });
  page.on('requestfailed', (request) => log.failed.push({ scope, url: request.url(), error: request.failure()?.errorText || 'failed' }));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(origin)) log.badLocalResponses.push({ scope, url: response.url(), status: response.status() });
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'about:') return route.continue();
    if ([REMOTE_API, fixtureOrigin].includes(url.origin)) {
      const headers = request.headers();
      const forwarded = new Headers();
      for (const name of ['accept', 'content-type', 'x-access-key']) if (headers[name]) forwarded.set(name, headers[name]);
      const options = { method: request.method(), headers: forwarded };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) options.body = request.postDataBuffer() || undefined;
      try {
        const response = await fetch(`${fixtureOrigin}${url.pathname}${url.search}`, options);
        const body = Buffer.from(await response.arrayBuffer());
        const responseHeaders = Object.fromEntries(response.headers.entries());
        Object.assign(responseHeaders, {
          'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Access-Key',
          'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400',
        });
        log.apiCalls.push({ scope, method: request.method(), path: `${url.pathname}${url.search}`, status: response.status });
        return route.fulfill({ status: response.status, headers: responseHeaders, body });
      } catch (error) {
        log.errors.push({ scope, message: `Local fixture API intercept failed: ${error.message}` });
        return route.abort();
      }
    }
    log.externalBlocked.push({ scope, origin: url.origin, path: url.pathname });
    return route.abort();
  });
  return { log, setScope: (value) => { scope = value; } };
}

async function waitForRetail(page, { brand, mode } = {}) {
  await page.waitForFunction(({ expectedBrand, expectedMode }) => {
    const root = document.querySelector('#demo-root');
    const block = document.querySelector('.vehicle-matcher.vm');
    const mounted = block?.querySelector('.vm-stage > *');
    if (!block?.classList.contains(`vm-${expectedBrand}`) || !mounted) return false;
    if (root && (root.dataset.entryState !== 'retail' || root.dataset.brand !== expectedBrand)) return false;
    if (expectedMode && new URLSearchParams(location.search).get('mode') !== expectedMode) return false;
    const signatures = { questionnaire: '.vm-intro:not(.vm-intro-skeleton), .vm-question, .vm-results', swipe: '.vm-mingle-seed:not(.vm-knockout-seed)', 'head-to-head': '.vm-knockout-seed', podium: '.vm-podium:not(.vm-podium-skeleton)', 'guess-who': '.vm-gw:not(.vm-gw-skeleton)' };
    return !block.querySelector('[aria-busy="true"]') && (!expectedMode || Boolean(block.querySelector(signatures[expectedMode])));
  }, { expectedBrand: brand, expectedMode: mode }, { timeout: 8000 });
}

async function waitForState(page, state) {
  await page.waitForFunction((expected) => document.querySelector('#demo-root')?.dataset.entryState === expected, state, { timeout: 8000 });
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 3500 }).catch(() => {});
  await sleep(80);
}

async function captureMatrix({ origin, fixtureOrigin, context, sourceCommit, harnessSha }) {
  const state = makeState('matrix', sourceCommit, harnessSha);
  await loadExisting(state);
  const done = new Map(state.value.cases.map((row) => [row.id, row]));
  const page = await context.newPage();
  const observed = await observePage(page, origin, fixtureOrigin);
  let first = true;
  try {
    for (const brand of BRANDS) for (const mode of MODES) {
      const id = `${brand}-${mode}-320`;
      const old = done.get(id);
      if (old?.pass) continue;
      observed.setScope(id);
      await page.setViewportSize({ width: 320, height: 740 });
      const params = { brand, mode, scope: brand === 'bmw' ? 'national' : 'dealer', retailer: brand === 'bmw' ? '96' : undefined,
        retailerName: brand === 'bmw' ? 'BMW Approved Used' : undefined, key: first ? SYNTHETIC_GATE_TOKEN : undefined };
      const suffix = brand === 'bmw' && mode === 'questionnaire' ? '#m=e30' : '';
      await page.goto(`${origin}${urlFor(origin, '/index.html', params)}${suffix}`, { waitUntil: 'domcontentloaded' });
      first = false;
      await waitForRetail(page, { brand, mode });
      await settle(page);
      const metrics = await page.evaluate(() => {
        const root = document.querySelector('#demo-root');
        const shell = root?.querySelector('.demo-shell');
        const block = root?.querySelector('.vehicle-matcher');
        const modeSwitch = block?.querySelector('[aria-label="Matching interface"]');
        const headerLinks = [...root.querySelectorAll('.demo-nav-experiences a, .demo-nav-back')].map((link) => {
          const rect = link.getBoundingClientRect();
          const url = new URL(link.href);
          return { route: link.dataset.retailRoute || 'real-site', label: link.textContent.trim(), href: link.getAttribute('href'), keyAbsent: !url.searchParams.has('key'), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }, inViewport: rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight };
        });
        const navigation = headerLinks.filter((link) => link.route !== 'real-site');
        const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
        const newNavigationFits = navigation.length === 2 && navigation.every((link) => link.inViewport && link.keyAbsent) && !overlaps(navigation[0].rect, navigation[1].rect) && navigation.every((link) => !headerLinks.some((other) => other.route !== link.route && overlaps(link.rect, other.rect)));
        return {
          headerLinks, newNavigationFits,
          path: location.pathname,
          queryHasKey: new URLSearchParams(location.search).has('key'),
          experience: root?.dataset.experience,
          entryState: root?.dataset.entryState,
          brand: root?.dataset.brand,
          shellBrand: shell?.dataset.brand,
          modeClass: [...(block?.classList || [])].find((item) => item.startsWith('vm-') && item !== 'vm-stage' && item !== 'vm'),
          modeLocked: modeSwitch === null,
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          shellWidth: shell?.scrollWidth || 0,
          shellClientWidth: shell?.clientWidth || 0,
          screen: block?.querySelector('.vm-stage')?.firstElementChild?.className || '',
          questionHeading: block?.querySelector('.vm-question')?.textContent?.trim() || null,
        };
      });
      const apiForCase = observed.log.apiCalls.filter((call) => call.scope === id);
      const errorsForCase = observed.log.errors.filter((error) => error.scope === id);
      const failedForCase = observed.log.failed.filter((error) => error.scope === id);
      const badForCase = observed.log.badLocalResponses.filter((error) => error.scope === id);
      const row = {
        id, brand, mode, viewport: { width: 320, height: 740 }, sourceCommit,
        mounted: metrics.entryState === 'retail' && metrics.brand === brand && metrics.shellBrand === brand && metrics.modeClass?.includes(`vm-${brand}`),
        modeLocked: metrics.modeLocked,
        keyRemoved: !metrics.queryHasKey,
        apiCalls: apiForCase,
        pageWidth: metrics.documentWidth,
        overflowPx: Math.max(0, metrics.documentWidth - metrics.viewportWidth),
        metrics,
        errors: errorsForCase, failedRequests: failedForCase, badLocalResponses: badForCase,
        externalBlocked: observed.log.externalBlocked.filter((request) => request.scope === id),
        pass: metrics.entryState === 'retail' && metrics.brand === brand && metrics.shellBrand === brand
          && metrics.modeClass?.includes(`vm-${brand}`) && metrics.modeLocked && !metrics.queryHasKey
          && metrics.newNavigationFits && errorsForCase.length === 0 && failedForCase.length === 0 && badForCase.length === 0,
      };
      row.narrowOverflow = row.overflowPx === 0 ? 'fits' : brand === 'mini' ? 'observed-known-mini-narrow-overflow' : 'observed-overflow';
      const index = state.value.cases.findIndex((item) => item.id === id);
      if (index >= 0) state.value.cases[index] = row; else state.value.cases.push(row);
      await saveState(state);
      if (id === 'bmw-questionnaire-320') {
        ownedProcessCheckpoint('first-actual-mount');
        await page.screenshot({ path: join(EVIDENCE, 'bmw-narrow-header.png'), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: join(EVIDENCE, 'bmw-desktop-header.png'), fullPage: true });
        await page.setViewportSize({ width: 320, height: 740 });
        state.value.firstMount = { id, capturedAt: now(), metrics, apiCalls: apiForCase, screenshot: 'bmw-narrow-header.png' };
        await saveState(state);
      }
      console.log(JSON.stringify({ checkpoint: id, pass: row.pass, apiCalls: apiForCase.length }));
      if ((kind === 'smoke' || process.argv.includes('--smoke'))) return state.value;
      if (id === 'mini-questionnaire-320') await page.screenshot({ path: join(EVIDENCE, 'mini-narrow-header.png'), fullPage: true });
    }
  } catch (error) {
    state.value.failure = { message: error.message, capturedAt: now() };
    state.value.browserLogs = observed.log; await saveState(state); throw error;
  } finally { await page.close(); }
  check(state, '30-brand-mode-mounts', state.value.cases.length === 30 && state.value.cases.every((row) => row.pass), '30 direct 320px retail mounts for all six brands and five locked modes; fixture API, no page errors or local HTTP failures', { cases: state.value.cases.length, pass: state.value.cases.filter((row) => row.pass).length, failures: state.value.cases.filter((row) => !row.pass).map((row) => row.id), overflows: state.value.cases.filter((row) => row.overflowPx > 0).map((row) => ({ id: row.id, overflowPx: row.overflowPx, disposition: row.narrowOverflow })) });
  await saveState(state);
  console.log(JSON.stringify({ chunk: 'matrix', sourceCommit, mounts: state.value.cases.length, passing: state.value.cases.filter((row) => row.pass).length, failed: state.value.cases.filter((row) => !row.pass).map((row) => row.id), firstMount: state.value.firstMount || null }));
  return state.value;
}

async function captureFlows({ origin, fixtureOrigin, context, sourceCommit, harnessSha }) {
  const continuing = process.argv.includes('--continue');
  const state = makeState(continuing ? 'flows-continuation' : 'flows', sourceCommit, harnessSha);
  await loadExisting(state);
  const page = await context.newPage();
  const observed = await observePage(page, origin, fixtureOrigin);
  const record = async (id, pass, expected, actual) => { ownedProcessCheckpoint(id); check(state, id, pass, expected, actual); await saveState(state); };
  try {
    if (continuing) {
      for (const width of [1280, 320]) {
        observed.setScope(`picker-return-link-${width}`);
        await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
        await page.goto(`${origin}${urlFor(origin, '/index.html', { experience: 'used-cars', key: SYNTHETIC_GATE_TOKEN })}`, { waitUntil: 'domcontentloaded' });
        await waitForState(page, 'retail-picker'); await settle(page);
        for (let step = 0; step < 12; step += 1) {
          if (await page.evaluate(() => document.activeElement?.matches('.demo-picker-intro .vm-btn'))) break;
          await page.keyboard.press('Tab');
        }
        const geometry = await page.locator('.demo-picker-intro .vm-btn').evaluate((node) => {
          const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
          return { label: node.textContent.trim(), href: node.getAttribute('href'), focused: node === document.activeElement, focusVisible: node.matches(':focus-visible'), outlineWidth: style.outlineWidth, fontFamily: style.fontFamily, fontSize: style.fontSize, padding: style.padding, paddingLeft: parseFloat(style.paddingLeft), paddingTop: parseFloat(style.paddingTop), rect: { x: rect.x, right: rect.right, y: rect.y, height: rect.height, width: rect.width }, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
        });
        await page.screenshot({ path: join(EVIDENCE, width === 320 ? 'brand-picker-narrow-focus.png' : 'brand-picker-fresh-start.png'), fullPage: true });
        await record(`picker-return-link-geometry-${width}`, geometry.rect.height >= 44 && geometry.paddingLeft > 0 && geometry.paddingTop > 0 && geometry.rect.x >= 0 && geometry.rect.right <= width && geometry.focused && geometry.focusVisible && parseFloat(geometry.outlineWidth) > 0,
          'picker return link has shared button geometry, fits the viewport and receives visible keyboard focus after the picker token fix', geometry);
        await page.keyboard.press('Enter'); await waitForState(page, 'launcher');
        await record(`picker-return-link-enter-${width}`, true, 'Enter activates the labelled picker return link', page.url());
      }
    }
    if (!continuing) {
    for (const mode of ['swipe', 'head-to-head']) {
      observed.setScope(`ferrari-${mode}-overflow-diagnostic`);
      await page.setViewportSize({ width: 320, height: 740 });
      await page.goto(`${origin}${urlFor(origin, '/index.html', { brand: 'ferrari', mode, key: SYNTHETIC_GATE_TOKEN })}`, { waitUntil: 'domcontentloaded' });
      await waitForRetail(page, { brand: 'ferrari', mode }); await settle(page);
      const measure = () => page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, addedLinks: document.querySelectorAll('[data-retail-route]').length, overflowing: [...document.querySelectorAll('.vehicle-matcher *')].map((node) => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect }) => rect.width > 0 && rect.right > innerWidth + 1).slice(0, 12).map(({ node, rect }) => ({ selector: `${node.tagName.toLowerCase()}.${[...node.classList].join('.')}`, rect: { x: rect.x, right: rect.right, width: rect.width, y: rect.y, height: rect.height } })) }));
      const before = await measure();
      await page.screenshot({ path: join(EVIDENCE, `ferrari-${mode}-narrow-before.png`), fullPage: true });
      await page.locator('[data-retail-route]').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
      const after = await measure();
      await page.screenshot({ path: join(EVIDENCE, `ferrari-${mode}-narrow-without-added-links.png`), fullPage: true });
      const diagnostic = { id: `ferrari-${mode}-retained-body-overflow`, viewport: { width: 320, height: 740 }, before, after, bodyFits: before.documentWidth <= before.width, pass: before.documentWidth <= before.width, disposition: 'Diagnostic removes only the added header links in the browser DOM; no product file changes. Retained mode-source comparison belongs to lead review.' };
      state.value.cases.push(diagnostic);
      await record(`ferrari-${mode}-header-removal-diagnostic`, before.documentWidth === after.documentWidth && before.addedLinks === 2 && after.addedLinks === 0,
        'measure whether observed body overflow remains after removing only the two added header links; this does not assert the body fits', diagnostic);
    }
    observed.setScope('launcher-selected-bmw');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}${urlFor(origin, '/index.html', { experience: 'launcher', brand: 'bmw', key: SYNTHETIC_GATE_TOKEN })}`, { waitUntil: 'domcontentloaded' });
    await waitForState(page, 'launcher'); await settle(page);
    await page.locator('.demo-brand-control').selectOption('bmw');
    await page.screenshot({ path: join(EVIDENCE, 'launcher-selected-bmw.png'), fullPage: true });
    await record('launcher-selected-brand', await page.locator('.demo-launcher-selection').innerText().then((text) => text.includes('BMW')),
      'BMW visibly selected while employee route remains unavailable', await page.locator('.demo-launcher-selection').innerText());

    observed.setScope('brand-picker-fresh-start');
    await page.goto(`${origin}${urlFor(origin, '/index.html', { experience: 'used-cars' })}`, { waitUntil: 'domcontentloaded' });
    await waitForState(page, 'retail-picker'); await settle(page);
    const pickerLabels = await page.locator('.demo-picker-tile-label').allTextContents();
    await page.screenshot({ path: join(EVIDENCE, 'brand-picker-fresh-start.png'), fullPage: true });
    await record('fresh-brand-picker', pickerLabels.length === 6 && pickerLabels.some((label) => label.includes('MINI')) && pickerLabels.some((label) => label.includes('BMW Motorrad')),
      'six named brand choices including BMW Motorrad', pickerLabels);

    }
    await page.setViewportSize({ width: 1280, height: 900 });
    observed.setScope('same-brand-round-trip-and-history');
    const definition = await fetch(`${fixtureOrigin}/api/questions?brand=bmw`).then((response) => response.json());
    const answers = Object.fromEntries(definition.questions.map((q) => [q.id, q.type === 'slider' ? (q.default ?? q.min) : q.multi ? [q.options.at(-1).value] : q.options.at(-1).value]));
    const answerHash = '#m=' + Buffer.from(JSON.stringify(answers)).toString('base64url');
    const nationalRetail = urlFor(origin, '/index.html', { brand: 'bmw', mode: 'questionnaire', scope: 'national', retailer: '96', retailerName: 'BMW Approved Used', api: fixtureOrigin, key: continuing ? SYNTHETIC_GATE_TOKEN : undefined }) + answerHash;
    await page.goto(`${origin}${nationalRetail}`, { waitUntil: 'domcontentloaded' });
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    const original = new URL(page.url());
    await page.locator('[data-retail-route="launcher"]').click();
    await waitForState(page, 'launcher'); await settle(page);
    const launcherUrl = new URL(page.url());
    const sameBrandCta = page.locator('.demo-experience-choice').filter({ has: page.getByRole('heading', { name: 'Used cars' }) }).getByRole('link').first();
    const ctaText = await sameBrandCta.innerText();
    await sameBrandCta.click();
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    const returned = new URL(page.url());
    const returnFacts = { original: `${original.pathname}${original.search}${original.hash}`, launcher: `${launcherUrl.pathname}${launcherUrl.search}${launcherUrl.hash}`, returned: `${returned.pathname}${returned.search}${returned.hash}`, sameBrandCta: ctaText,
      samePath: returned.pathname === original.pathname, brand: returned.searchParams.get('brand'), mode: returned.searchParams.get('mode'), scope: returned.searchParams.get('scope'), retailer: returned.searchParams.get('retailer'), retailerName: returned.searchParams.get('retailerName'), answerHash: returned.hash };
    if (!continuing) {
    await record('same-brand-launcher-round-trip', returnFacts.brand === 'bmw' && returnFacts.mode === 'questionnaire' && returnFacts.scope === 'national' && returnFacts.retailer === '96' && returnFacts.answerHash === answerHash && returned.searchParams.get('api') === fixtureOrigin && !returned.searchParams.has('key'),
      'same BMW national questionnaire journey, retailer context and answer hash; no key', returnFacts);
    let copied;
    page.once('dialog', async (dialog) => { copied = dialog.defaultValue(); await dialog.dismiss(); });
    await page.getByRole('button', { name: 'Copy share link', exact: true }).click();
    await page.waitForTimeout(150);
    const shared = copied ? new URL(copied) : null;
    await record('actual-copy-share-control', Boolean(shared) && !shared.searchParams.has('key') && shared.searchParams.get('api') === fixtureOrigin && shared.searchParams.get('scope') === 'national' && shared.hash === answerHash,
      'actual share button fallback produces a public context-preserving answer URL without consumed key', copied || 'No prompt captured; clipboard path requires inspection');
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    await record('retail-refresh-context', page.url() === returned.href, 'refresh retains full public retail URL', page.url());
    }
    await page.evaluate(() => history.back()); await waitForState(page, 'launcher');
    await page.evaluate(() => history.back()); await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' });
    const backUrl = new URL(page.url());
    await page.evaluate(() => history.forward()); await waitForState(page, 'launcher');
    await page.evaluate(() => history.forward()); await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' });
    const forwardUrl = new URL(page.url());
    await record('back-forward-context', backUrl.searchParams.get('scope') === 'national' && backUrl.hash === answerHash && forwardUrl.hash === answerHash && forwardUrl.searchParams.get('api') === fixtureOrigin && forwardUrl.searchParams.get('brand') === 'bmw' && forwardUrl.searchParams.get('retailer') === '96',
      'Back/Forward traverses launcher and the selected BMW journey without losing its context', { back: `${backUrl.pathname}${backUrl.search}${backUrl.hash}`, forward: `${forwardUrl.pathname}${forwardUrl.search}${forwardUrl.hash}` });

    await page.locator('[data-retail-route="launcher"]').click(); await waitForState(page, 'launcher');
    await page.locator('.demo-experience-choice').filter({ has: page.getByRole('heading', { name: 'Used cars' }) }).getByRole('link').first().click();
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    await record('desktop-launcher-retail-repeat', new URL(page.url()).hash === answerHash && new URL(page.url()).searchParams.get('api') === fixtureOrigin, '1280x900 launcher to retail to launcher to the same retail journey', page.url());

    await page.setViewportSize({ width: 320, height: 740 });
    await page.locator('[data-retail-route="launcher"]').click(); await waitForState(page, 'launcher'); await settle(page);
    await page.screenshot({ path: join(EVIDENCE, 'launcher-narrow-selected-bmw.png'), fullPage: true });
    await page.locator('.demo-experience-choice').filter({ has: page.getByRole('heading', { name: 'Used cars' }) }).getByRole('link').first().click();
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    const narrowReturned = new URL(page.url());
    await record('narrow-same-brand-round-trip', narrowReturned.hash === answerHash && narrowReturned.searchParams.get('mode') === 'questionnaire' && narrowReturned.searchParams.get('scope') === 'national' && narrowReturned.searchParams.get('api') === fixtureOrigin && narrowReturned.searchParams.get('retailer') === '96', '320x740 launcher to same BMW journey retains mode/scope/API/retailer/answers', page.url());
    await page.locator('[data-retail-route="launcher"]').click(); await waitForState(page, 'launcher');
    await page.locator('.demo-experience-choice').filter({ has: page.getByRole('heading', { name: 'Used cars' }) }).getByRole('link').first().click();
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    await record('narrow-launcher-retail-repeat', new URL(page.url()).hash === answerHash && new URL(page.url()).searchParams.get('api') === fixtureOrigin, '320x740 launcher to retail to launcher to the same retail journey', page.url());
    await page.setViewportSize({ width: 1280, height: 900 });

    observed.setScope('deliberate-brand-change');
    await page.locator('[data-retail-route="brand"]').click(); await waitForState(page, 'retail-picker'); await settle(page);
    const freshCopy = await page.locator('.demo-picker-intro').innerText();
    const changedPicker = new URL(page.url());
    const pickerContext = { hasBrand: changedPicker.searchParams.has('brand'), mode: changedPicker.searchParams.get('mode'), scope: changedPicker.searchParams.get('scope'), retailer: changedPicker.searchParams.get('retailer'), hash: changedPicker.hash };
    await page.locator('.demo-picker-tile').filter({ hasText: 'MINI' }).click();
    await waitForRetail(page, { brand: 'mini', mode: 'questionnaire' }); await settle(page);
    const miniUrl = new URL(page.url());
    const miniLabel = await page.locator('.demo-shell').innerText();
    const brandFacts = { freshCopy, miniRetailerLabelVisible: miniLabel.includes('MINI Approved Used'), api: miniUrl.searchParams.get('api'), picker: pickerContext, chosenBrand: miniUrl.searchParams.get('brand'), mode: miniUrl.searchParams.get('mode'), scope: miniUrl.searchParams.get('scope'), retailer: miniUrl.searchParams.get('retailer'), retailerName: miniUrl.searchParams.get('retailerName'), hash: miniUrl.hash };
    await record('deliberate-brand-change-starts-fresh', !pickerContext.hasBrand && pickerContext.hash === '' && miniUrl.searchParams.get('brand') === 'mini' && miniUrl.searchParams.get('mode') === 'questionnaire' && miniUrl.searchParams.get('scope') === 'national' && !miniUrl.searchParams.has('retailer') && miniUrl.hash === '' && miniUrl.searchParams.get('api') === fixtureOrigin && miniLabel.includes('MINI Approved Used') && /resets your answers and retailer/.test(freshCopy),
      'picker explains reset; MINI retains valid mode/scope but no BMW dealer or answers', brandFacts);

    await page.locator('[data-retail-route="brand"]').click(); await waitForState(page, 'retail-picker');
    await page.locator('.demo-picker-tile').filter({ hasText: 'Ford' }).click();
    await waitForRetail(page, { brand: 'ford', mode: 'questionnaire' }); await settle(page);
    const fordUrl = new URL(page.url());
    await record('second-deliberate-brand-switch', fordUrl.searchParams.get('brand') === 'ford' && fordUrl.searchParams.get('mode') === 'questionnaire' && fordUrl.searchParams.get('scope') === 'national' && fordUrl.searchParams.get('api') === fixtureOrigin && !fordUrl.hash && !fordUrl.searchParams.has('retailer'),
      'MINI to Ford retains valid mode/scope/API and clears answer/dealer context', fordUrl.pathname + fordUrl.search + fordUrl.hash);
    await page.goto(`${origin}${nationalRetail}`, { waitUntil: 'domcontentloaded' });
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    observed.setScope('employee-boundary-isolation');
    await page.goto(`${origin}${urlFor(origin, '/index.html', { experience: 'employee-cars', brand: 'bmw', mode: 'podium', scope: 'national', retailer: '96', retailerName: 'Private dealer', api: fixtureOrigin, key: SYNTHETIC_GATE_TOKEN })}#m=buyer-private`, { waitUntil: 'domcontentloaded' });
    await waitForState(page, 'employee-unavailable'); await settle(page);
    const employeeFacts = await page.evaluate(() => {
      const employee = document.querySelector('.demo-experience-choice[aria-labelledby]');
      const used = [...document.querySelectorAll('.demo-experience-choice')].find((card) => card.querySelector('h2')?.textContent.trim() === 'Used cars')?.querySelector('a');
      const url = used ? new URL(used.href) : null;
      return { safeEmployeeContext: document.querySelector('#demo-root')?.entryContext, storageKeys: Object.keys(sessionStorage), state: document.querySelector('#demo-root')?.dataset.entryState, visibleRecovery: Boolean(used), recoveryLabel: used?.textContent.trim(), target: url ? { experience: url.searchParams.get('experience'), brand: url.searchParams.get('brand'), mode: url.searchParams.get('mode'), scope: url.searchParams.get('scope'), retailer: url.searchParams.get('retailer'), retailerName: url.searchParams.get('retailerName'), hash: url.hash, key: url.searchParams.has('key') } : null, visiblePrivateRetailer: document.body.innerText.includes('Private dealer'), entryHasKey: new URLSearchParams(location.search).has('key') };
    });
    await record('employee-boundary-recovery', employeeFacts.state === 'employee-unavailable' && employeeFacts.target?.experience === 'used-cars' && employeeFacts.target?.brand === 'bmw' && employeeFacts.target?.mode === 'questionnaire' && employeeFacts.target?.retailer === '96' && employeeFacts.target?.hash === answerHash && !employeeFacts.target?.key && !employeeFacts.entryHasKey && !employeeFacts.visiblePrivateRetailer && !/[?&](mode|scope|retailer|retailerName)=|#/.test(employeeFacts.safeEmployeeContext.location),
      'unavailable employee entry exposes no private retail fields; recovery reopens the separately retained BMW retail session', employeeFacts);

    await page.locator('.demo-experience-choice').filter({ has: page.getByRole('heading', { name: 'Used cars' }) }).getByRole('link').first().click();
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    await record('employee-return-retained-retail', new URL(page.url()).hash === answerHash, 'return from unavailable employee entry reopens the session-only retained public answer URL', page.url());
    observed.setScope('legacy-block-entry');
    await page.goto(`${origin}${urlFor(origin, '/block.html', { brand: 'ford', mode: 'questionnaire', api: fixtureOrigin, key: SYNTHETIC_GATE_TOKEN })}`, { waitUntil: 'domcontentloaded' });
    await waitForRetail(page, { brand: 'ford', mode: 'questionnaire' }); await settle(page);
    const blockFacts = await page.evaluate(() => ({ path: location.pathname, api: document.querySelector('.vehicle-matcher')?.dataset.api, keyAbsent: !new URLSearchParams(location.search).has('key'), state: document.querySelector('.vehicle-matcher.vm') ? 'retail' : null, brand: document.querySelector('.vehicle-matcher.vm')?.classList.contains('vm-ford') ? 'ford' : null, modeSwitchVisible: Boolean(document.querySelector('[aria-label="Matching interface"]')) }));
    await page.screenshot({ path: join(EVIDENCE, 'ford-retail-theme.png'), fullPage: true });
    await record('legacy-direct-block-entry', blockFacts.path.endsWith('/block.html') && blockFacts.state === 'retail' && blockFacts.brand === 'ford' && !blockFacts.modeSwitchVisible,
      'direct block.html enters the intended Ford locked retail mode without compulsory launcher selection', blockFacts);
    const blockPublic = new URL(page.url());
    await record('block-consumed-key-local-api', !blockPublic.searchParams.has('key') && blockPublic.searchParams.get('api') === fixtureOrigin, 'block direct entry consumes fake key and uses explicit local fixture override', blockPublic.pathname + blockPublic.search);
    await page.evaluate(() => sessionStorage.clear());
    observed.setScope('real-session-gate');
    await page.goto(`${origin}/index.html?brand=bmw&mode=questionnaire`, { waitUntil: 'domcontentloaded' });
    await page.locator('.vm-gate').waitFor();
    const gateVisible = await page.locator('.vm-gate-input').isVisible();
    await page.locator('.vm-gate-input').fill(SYNTHETIC_GATE_TOKEN);
    await page.locator('.vm-gate-btn').click();
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' });
    await record('session-demo-gate', gateVisible && await page.locator('.vm-gate').count() === 0, 'nonlocal deployed-default entry prompts without session key; entering synthetic key mounts and refresh reuses session', { gateSeen: gateVisible, gateAfterRefresh: await page.locator('.vm-gate').count(), effectiveApi: await page.locator('.vehicle-matcher').getAttribute('data-api'), fixtureInterceptCalls: observed.log.apiCalls.filter((item) => item.scope === 'real-session-gate').length });
  } catch (error) {
    state.value.failure = { message: error.message, capturedAt: now() };
    state.value.browserLogs = observed.log; await saveState(state); throw error;
  } finally { await page.close(); }
  state.value.browserLogs = observed.log;
  await saveState(state);
  console.log(JSON.stringify({ chunk: continuing ? 'flows-continuation' : 'flows', sourceCommit, checks: state.value.checks.length, passed: state.value.checks.filter((item) => item.pass).length, failed: state.value.checks.filter((item) => !item.pass).map((item) => item.id) }));
  return state.value;
}

async function captureKeyboard({ origin, fixtureOrigin, context, sourceCommit, harnessSha }) {
  const questionOnly = process.argv.includes('--question-only');
  const state = makeState(questionOnly ? 'keyboard-question-settled' : 'keyboard', sourceCommit, harnessSha);
  await loadExisting(state);
  const page = await context.newPage();
  const observed = await observePage(page, origin, fixtureOrigin);
  try {
    await page.setViewportSize({ width: 320, height: 740 });
    if (!questionOnly) {
    observed.setScope('retail-header-focus');
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`${origin}${urlFor(origin, '/index.html', { brand: 'bmw', mode: 'questionnaire', key: SYNTHETIC_GATE_TOKEN })}`, { waitUntil: 'domcontentloaded' });
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' }); await settle(page);
    const nav = page.locator('[data-retail-route="launcher"]');
    for (let i = 0; i < 20; i += 1) {
      const focused = await page.evaluate(() => document.activeElement?.matches('[data-retail-route="launcher"]'));
      if (focused) break;
      await page.keyboard.press('Tab');
    }
    const headerFocus = await page.evaluate(() => {
      const node = document.activeElement;
      const style = node && getComputedStyle(node);
      return { text: node?.textContent.trim(), href: node?.getAttribute('href'), focusVisible: node?.matches(':focus-visible'), outline: style?.outlineStyle, outlineWidth: style?.outlineWidth, outlineColor: style?.outlineColor, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
    await page.screenshot({ path: join(EVIDENCE, 'keyboard-header-focus.png'), fullPage: true });
    check(state, 'keyboard-retail-header-focus', headerFocus.text === 'All car experiences' && headerFocus.focusVisible && headerFocus.outlineWidth !== '0px', 'Tab reaches a labelled return link with visible focus at 320px', headerFocus);

    await page.keyboard.press('Enter');
    await waitForState(page, 'launcher');
    check(state, 'keyboard-return-link-enter', true, 'Enter activates the focused All car experiences return link', page.url());
    for (let i = 0; i < 10; i += 1) {
      if (await page.evaluate(() => document.activeElement?.matches('.demo-brand-control'))) break;
      await page.keyboard.press('Tab');
    }
    const nativeFocus = await page.locator('.demo-brand-control').evaluate((node) => ({ focused: node === document.activeElement, focusVisible: node.matches(':focus-visible'), tag: node.tagName, label: document.querySelector(`label[for="${node.id}"]`)?.textContent.trim(), outline: getComputedStyle(node).outline, value: node.value }));
    await page.screenshot({ path: join(EVIDENCE, 'keyboard-native-select-focus.png'), fullPage: true });
    check(state, 'native-select-focus-prerequisite', nativeFocus.focused && nativeFocus.tag === 'SELECT' && Boolean(nativeFocus.label), 'Tab focuses the labelled semantic native brand select before the single popup attempt', nativeFocus);
    const nativeBefore = await page.locator('.demo-brand-control').inputValue();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    const nativeAfter = await page.locator('.demo-brand-control').inputValue();
    check(state, 'native-select-keyboard-attempt', nativeFocus.focused && nativeAfter !== nativeBefore, 'bounded native select ArrowDown/Enter changes brand; unchanged value retains the known automation limitation', { nativeFocus, before: nativeBefore, after: nativeAfter, limitation: nativeAfter === nativeBefore ? 'Native popup automation unchanged; selectOption routing is independently exercised' : null });
    const usedLink = page.locator('.demo-experience-choice').filter({ has: page.getByRole('heading', { name: 'Used cars' }) }).getByRole('link').first();
    await usedLink.focus(); await page.keyboard.press('Enter'); await waitForRetail(page, { brand: nativeAfter || 'bmw', mode: 'questionnaire' });
    check(state, 'keyboard-used-cars-enter', true, 'Enter opens the labelled Used cars route', page.url());

    }
    observed.setScope('shared-question-option-arrow');
    await page.goto(`${origin}${urlFor(origin, '/block.html', { brand: 'bmw', mode: 'questionnaire', api: fixtureOrigin })}`, { waitUntil: 'domcontentloaded' });
    await waitForRetail(page, { brand: 'bmw', mode: 'questionnaire' });
    await page.locator('.vehicle-matcher .vm-intro .vm-btn-primary').click();
    const radio = page.locator('.vm-options[role="radiogroup"] [role="radio"]');
    for (let step = 0; step < 16 && await radio.count() === 0; step += 1) {
      const options = page.locator('.vm-options [role="checkbox"]');
      if (await options.count()) await options.last().click();
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    await radio.first().waitFor();
    const questionBefore = await page.locator('.vm-question').innerText();
    const before = await radio.evaluateAll((nodes) => nodes.map((node) => ({ text: node.innerText.trim(), checked: node.getAttribute('aria-checked'), tabIndex: node.tabIndex })));
    await radio.first().focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction((heading) => document.querySelector('.vm-question')?.textContent !== heading, questionBefore);
    const result = { questionBefore, before, expectedChosenOption: before[1]?.text, questionAfter: await page.locator('.vm-question').innerText(), focusedText: await page.evaluate(() => document.activeElement?.textContent.trim()) };
    check(state, 'shared-radio-arrow-selection', result.questionAfter !== questionBefore, 'ArrowDown selects the next actual questionnaire radio option and advances to the next question through its onPick callback', result);
    await settle(page);
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'), { timeout: 3500 });
    const settled = await page.locator('.vm-question').evaluate((node) => ({ text: node.innerText, opacity: getComputedStyle(node).opacity, runningAnimations: document.getAnimations().filter((animation) => animation.playState === 'running').length }));
    state.value.captureSettlement = settled;
    await page.screenshot({ path: join(EVIDENCE, 'keyboard-question-option.png'), fullPage: true });
  } catch (error) {
    state.value.failure = { message: error.message, capturedAt: now() };
    state.value.browserLogs = observed.log; await saveState(state); throw error;
  } finally { await page.close(); }
  ownedProcessCheckpoint('keyboard-complete');
  state.value.browserLogs = observed.log;
  await saveState(state);
  console.log(JSON.stringify({ chunk: 'keyboard', sourceCommit, checks: state.value.checks.length, passed: state.value.checks.filter((item) => item.pass).length, failed: state.value.checks.filter((item) => !item.pass).map((item) => item.id) }));
  return state.value;
}

const kind = process.argv[2];
if (!['smoke', 'matrix', 'flows', 'keyboard'].includes(kind)) throw new Error('Choose one chunk: matrix, flows, or keyboard.');
await mkdir(EVIDENCE, { recursive: true });
const sourceCommit = process.env.SOURCE_COMMIT;
if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw new Error('SOURCE_COMMIT must identify the adapter-verified source HEAD.');
const harnessSha = sha(await readFile(ownPath));
let fixture, staticSite, chrome;
try {
  fixture = await startFixtureApi();
  staticSite = await startStaticServer();
  ownedProcessCheckpoint('fixture-and-static-ready');
  chrome = await launchChrome();
  Object.assign(runtimeResources, { staticPort: staticSite.port, fixtureApiPort: fixture.port, chromeCdpPort: Number(new URL(chrome.endpoint).port), chromePid: chrome.child.pid, profile: chrome.profile });
  console.log(JSON.stringify({ checkpoint: 'owned-resources', ...runtimeResources }));
  const options = { origin: staticSite.origin, fixtureOrigin: fixture.origin, context: chrome.context, sourceCommit, harnessSha };
  if (kind === 'matrix' || kind === 'smoke') await captureMatrix(options);
  if (kind === 'flows') await captureFlows(options);
  if (kind === 'keyboard') await captureKeyboard(options);
} finally {
  if (!chrome && trackedChrome) chrome = { child: trackedChrome.child };
  if (chrome?.browser) await Promise.race([chrome.browser.close().catch(() => {}), sleep(2500)]);
  if (chrome?.child && chrome.child.exitCode === null && chrome.child.signalCode === null) {
    chrome.child.kill('SIGTERM');
    await Promise.race([once(chrome.child, 'exit'), sleep(2500)]);
    if (chrome.child.exitCode === null && chrome.child.signalCode === null) { chrome.child.kill('SIGKILL'); await once(chrome.child, 'exit').catch(() => {}); }
  }
  if (staticSite?.child && staticSite.child.exitCode === null && staticSite.child.signalCode === null) {
    staticSite.child.kill('SIGTERM');
    await Promise.race([once(staticSite.child, 'exit'), sleep(2500)]);
    if (staticSite.child.exitCode === null && staticSite.child.signalCode === null) { staticSite.child.kill('SIGKILL'); await once(staticSite.child, 'exit').catch(() => {}); }
  }
  if (fixture?.server?.listening) {
    fixture.server.closeAllConnections?.();
    await new Promise((resolveClose, reject) => fixture.server.close((error) => error ? reject(error) : resolveClose()));
  }
  const portChecks = [];
  for (const port of [staticSite?.port, fixture?.port, runtimeResources.chromeCdpPort].filter(Boolean)) {
    try { await freePort(port); portChecks.push({ port, closed: true }); }
    catch { portChecks.push({ port, closed: false }); }
  }
  let ownership = ownedProcessCheckpoint('after-owned-services-closed');
  for (let attempt = 0; ownership.chromeProcesses.length && attempt < 10; attempt += 1) { await sleep(100); ownership = ownedProcessCheckpoint('waiting-for-owned-chrome-exit'); }
  if (ownership.chromeProcesses.length || portChecks.some((row) => !row.closed)) throw new Error('Owned browser process or endpoint remains after cleanup.');
  console.log(JSON.stringify({ checkpoint: 'owned-service-cleanup', ports: portChecks, remainingChromeProcesses: ownership.chromeProcesses }));
}
