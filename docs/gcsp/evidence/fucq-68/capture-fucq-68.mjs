import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createGcspRuntime } from '../../../../server/gcsp/runtime.js';
import { buildServer } from '../../../../server/index.js';
import { ManualContextService, createRepositoryManualPorts } from '../../../../server/gcsp/manual-context/index.js';
import { PolicyService } from '../../../../server/gcsp/policy/index.js';
import { inputDigest, result } from '../../../../server/gcsp/repository/index.js';

const ROOT = process.cwd();
const chunk = process.argv[process.argv.indexOf('--chunk') + 1];
assert.ok(['flow', 'states', 'theme', 'typography'].includes(chunk), 'Use --chunk flow, states, theme or typography.');
assert.ok(process.env.TMPDIR && existsSync(process.env.TMPDIR), 'Supervisor-owned TMPDIR is required.');
assert.ok(process.env.FUCQ68_HEAD && process.env.FUCQ68_BASE, 'FUCQ68_HEAD and FUCQ68_BASE provenance is required.');
const scratch = path.resolve(process.env.TMPDIR); const OUT = path.join(ROOT, 'docs/gcsp/evidence/fucq-68', chunk);
const profile = path.join(scratch, 'chrome-profile'); const cache = path.join(scratch, 'chrome-cache');
const crashpad = path.join(scratch, 'chrome-crashpad');
await Promise.all([OUT, profile, cache, crashpad].map((dir) => mkdir(dir, { recursive: true })));
const PLAYWRIGHT = '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const instant = '2026-11-05T09:00:00.000Z'; const LIMIT = 12 * 1024 * 1024;
const results = { story: 'FUCQ-68', chunk, head: process.env.FUCQ68_HEAD, base: process.env.FUCQ68_BASE,
  cases: [], api: [], events: [], screenshots: [], pageErrors: [], consoleErrors: [], externalRequests: [], errors: [],
  resources: { nodePid: process.pid, nodePgid: Number(execFileSync('/bin/ps', ['-p', String(process.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim()),
    scratch, profile, cache, crashpad, browserEndpoint: null, sampledBrowserProcesses: [] }, cleanup: {} };
let runtime; let service; let session; let api; let browser; let page; let origin; let port; let outage = false; let sequence = 0;
const apiTasks = []; const runtimes = []; const servedSources = new Set(['docs/gcsp/evidence/fucq-68/capture-fucq-68.mjs',
  'server/index.js', 'server/gcsp/manual-context/index.js', 'server/gcsp/runtime.js', 'server/gcsp/policy/seed-v1.json']);
let bytes = 0; let scenario = null;
const mime = (file) => ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream';
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin ?? 'http://127.0.0.1');
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname.startsWith('/api/')) return api.emit('request', req, res);
  const file = path.resolve(ROOT, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  if (!file.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403); return res.end(); }
  try { const contents = await readFile(file); servedSources.add(path.relative(ROOT, file));
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store' }); res.end(contents); }
  catch { res.writeHead(404); res.end(); }
});
function sampleProcesses() {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,args='], { encoding: 'utf8' }).split('\n');
  const owned = rows.filter((row) => row.includes(profile) || row.includes(crashpad)).map((row) => {
    const match = row.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), executable: 'owned-chrome' } : null;
  }).filter(Boolean);
  results.resources.sampledBrowserProcesses.push(...owned);
}
async function mutate(change, slotPatch = null) {
  const context = session.value.context;
  const outcome = await runtime.repository.transaction(context, { commandId: `capture-source-${++sequence}`,
    inputDigest: inputDigest({ sequence }) }, async (tx) => {
    const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
    const found = await tx.get(ref); const source = structuredClone(found.value.contract.manualContext); change(source);
    const updated = await tx.compareAndSwap(ref, found.value.version, { contract: { manualContext: source } });
    if (updated.status !== 'ok' || !slotPatch) return updated;
    const slot = { table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } };
    const old = await tx.get(slot); return tx.compareAndSwap(slot, old.value.version, slotPatch);
  });
  assert.equal(outcome.status, 'ok');
}
async function prepare(name, width) {
  await runtime?.close(); outage = false; scenario = { name, width };
  const seed = JSON.parse(await readFile(path.join(ROOT, 'server/gcsp/policy/seed-v1.json'), 'utf8'));
  if (name === 'nominated-closed') seed.assumptions.find((a) => a.key === 'manual.context.v1').value.locations[0].closedDates = ['2026-11-20'];
  const created = await createGcspRuntime({ mode: 'memory', environmentId: `fucq68-${chunk}-${width}-${name}`,
    policy: new PolicyService({ provider: { async loadVersions() { return [seed]; } } }),
    policyAsOf: instant, commandId: `bootstrap-${++sequence}`, sessionNow: () => instant });
  assert.equal(created.status, 'ok'); runtime = created.value; runtimes.push(runtime);
  session = await runtime.createLocalSession(); assert.equal(session.status, 'ok');
  const ports = createRepositoryManualPorts(runtime); const contract = ports.employeeContract;
  service = new ManualContextService({ ...runtime, ports: { ...ports, employeeContract: { read: (...args) =>
    outage ? result('unavailable', { retryable: true }) : contract.read(...args) } } });
  if (name === 'new') await mutate((r) => { r.contracts = []; }, { contractId: null });
  if (name === 'long-unknown') await mutate((r) => {
    r.account.name = 'Alexandra Morgan-Withfield (fictional) with a long account name'; delete r.account.contact;
    r.contracts[0].model = 'Fictional BMW Touring with a very long model and specification description '.repeat(3);
    r.drivers[1].name = 'Casey Withfield-Morgan (fictional) with a long nominated-driver name';
    r.drivers[1].licence.validUntil = null; r.drivers[1].eligible.value = null;
  });
  const denied = async () => { throw new Error('Unrelated provider called in isolated setup proof.'); };
  api = buildServer({ ...runtime.dependencies, gcspManual: service, gcspAllowedOrigins: [origin],
    fetchRetailerStock: denied, fetchNearbyStock: denied, enrichColours: denied, fetchDealerDirectory: denied, geocodePostcode: denied });
  await browser.clearCookies();
  const raw = session.value.setCookie[1].split(';', 1)[0]; const split = raw.indexOf('=');
  await browser.addCookies([{ name: raw.slice(0, split), value: raw.slice(split + 1), domain: '127.0.0.1', path: '/api/gcsp', httpOnly: true, sameSite: 'Lax', secure: false }]);
  await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
  await page.goto(`${origin}/${name === 'flow' ? 'gcsp-account.html' : 'gcsp-manual-setup.html'}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: name === 'flow' ? 'Your cars' : 'Your order choices', exact: true }).waitFor();
}
const field = (name) => page.locator(`[name="${name}"]`);
async function fill({ nominated = false, isNew = false, date = '2026-11-20' } = {}) {
  const context = session.value.context;
  await field('driverId').selectOption(`${nominated ? 'nominated' : 'driver'}:${context.employeeId}`);
  await field('contractOptionId').selectOption('six-month-8000'); await field('requestedCollectionDate').fill(date);
  await field('collectionLocationId').selectOption('demo-collection-centre');
  if (!isNew) await field('expectedReturnMileage').fill('6700');
}
async function capture(name, data = {}) {
  const file = `${String(results.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: 'disabled' });
  const image = await readFile(path.join(OUT, file)); bytes += image.byteLength;
  assert.ok(bytes < LIMIT, 'Chunk captures exceed 12 MiB.');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  const labels = await page.locator('input,select,textarea').evaluateAll((nodes) => nodes.every((node) => !!node.labels?.length));
  results.screenshots.push({ file, bytes: image.byteLength, sha256: createHash('sha256').update(image).digest('hex'),
    width: (await page.viewportSize()).width, overflow, labelledControls: labels, ...data });
  assert.equal(overflow, false); assert.equal(labels, true); sampleProcesses();
}
async function saved() { await page.getByRole('heading', { name: 'Availability refreshed', exact: true }).waitFor(); }
async function themeObservation(width) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((viewport) => {
    const css = (selector, names) => {
      const node = document.querySelector(selector); const style = getComputedStyle(node);
      return Object.fromEntries(names.map((name) => [name, style[name]]));
    };
    const rgb = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (color) => rgb(color).map((part) => {
      const value = part / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrast = (a, b) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Number(((values[0] + .05) / (values[1] + .05)).toFixed(3)); };
    const shell = css('.gcsp', ['backgroundColor', 'color', 'fontFamily']);
    const primary = css('.gcsp-setup-actions .vm-btn-primary', ['backgroundColor', 'color', 'borderRadius', 'minHeight']);
    const muted = css('.gcsp-setup-notice', ['color']); const focused = getComputedStyle(document.activeElement);
    const focus = { tag: document.activeElement.tagName, name: document.activeElement.getAttribute('name'),
      outlineColor: focused.outlineColor, outlineWidth: focused.outlineWidth, outlineStyle: focused.outlineStyle,
      outlineOffset: focused.outlineOffset };
    return { width: viewport, cssViewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth, shell, primary, muted, focus,
      title: css('h1.vm-title', ['fontFamily', 'fontWeight', 'fontSize']),
      roles: Object.fromEntries(Object.entries({ heading: '.gcsp-setup-group h2', label: '.gcsp-field-label',
        input: '.gcsp-field input', select: '.gcsp-field select', textarea: '.gcsp-field textarea',
        button: '.gcsp-setup-actions .vm-btn-primary', error: '.gcsp-field-error:not([hidden])' })
        .map(([name, selector]) => [name, css(selector, ['fontFamily', 'fontWeight'])])),
      fontLoaded: document.fonts.check('500 32px BMWGroupTNCondensedPro-Medium'),
      loadedFaces: [...document.fonts].filter((face) => face.family.includes('BMWGroupTNCondensedPro')).map((face) => ({ family: face.family, status: face.status, weight: face.weight })),
      fontResources: performance.getEntriesByType('resource').filter((entry) => /BMWGroupTNCondensedPro-Medium\.woff2/.test(entry.name)).map((entry) => new URL(entry.name).pathname),
      geometry: { headerMinHeight: getComputedStyle(document.querySelector('.gcsp-header')).minHeight,
        headerHeight: document.querySelector('.gcsp-header').getBoundingClientRect().height,
        navWidth: document.querySelector('.gcsp-nav').getBoundingClientRect().width,
        actionHeights: [...document.querySelectorAll('.gcsp-setup-actions button')].map((node) => node.getBoundingClientRect().height) },
      contrast: { primaryText: contrast(primary.color, primary.backgroundColor), bodyText: contrast(shell.color, shell.backgroundColor),
        mutedText: contrast(muted.color, shell.backgroundColor), focusOnWhite: contrast(focus.outlineColor, 'rgb(255,255,255)'),
        focusOnPage: contrast(focus.outlineColor, shell.backgroundColor) } };
  }, width);
}

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); port = server.address().port; origin = `http://127.0.0.1:${port}`;
  results.resources.listenerPort = port; results.resources.listenerHost = '127.0.0.1';
  const { chromium } = await import(pathToFileURL(PLAYWRIGHT));
  browser = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, deviceScaleFactor: 1,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-breakpad', '--disable-crash-reporter', '--disable-background-networking',
      '--disable-default-apps', '--disable-sync', '--no-first-run', `--disk-cache-dir=${cache}`, `--crash-dumps-dir=${crashpad}`] });
  page = await browser.newPage(); page.setDefaultTimeout(10000);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url()); if (url.origin === origin) return route.continue();
    results.externalRequests.push({ host: url.hostname, path: url.pathname }); return route.abort();
  });
  await page.exposeFunction('captureSetupEvent', (name, detail) => results.events.push({ name, detail, scenario: { ...scenario } }));
  await page.addInitScript(() => {
    window.captureSetupCounts = {};
    for (const name of ['gcsp:journey-start', 'gcsp:setup-ready', 'gcsp:setup-back']) document.addEventListener(name, (event) => {
      const { mode, oldContractId, slotId, schemeId, draftVersion, contextVersion } = event.detail ?? {};
      window.captureSetupEvent(name, { mode, oldContractId, slotId, schemeId, draftVersion, contextVersion })
        .then(() => { window.captureSetupCounts[name] = (window.captureSetupCounts[name] ?? 0) + 1; });
    });
  });
  page.on('pageerror', (error) => results.pageErrors.push(String(error.message).slice(0, 250)));
  page.on('console', (message) => { if (message.type() === 'error') results.consoleErrors.push({ text: message.text().slice(0, 180), path: new URL(message.location().url || origin).pathname }); });
  page.on('response', (response) => {
    const url = new URL(response.url()); if (url.origin !== origin || !url.pathname.startsWith('/api/gcsp/')) return;
    const requestScenario = { ...scenario };
    apiTasks.push((async () => {
      const envelope = await response.json(); const value = envelope.value;
      results.api.push({ scenario: requestScenario, method: response.request().method(), path: url.pathname, httpStatus: response.status(), status: envelope.status,
        draftVersion: value?.draftVersion, contextVersion: value?.contextVersion, requiresRefresh: value?.requiresRefresh,
        versions: value?.versions, state: value?.state, draftStage: value?.draftStage, reason: envelope.reason,
        currentContractId: value?.currentContract?.contractId });
    })());
  });
  for (const width of [1280, 320]) {
    if (['theme', 'typography'].includes(chunk)) {
      await prepare('theme', width); await page.evaluate(() => document.fonts.ready);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.textContent === 'Check your choices');
      await capture(`invalid-${width}`, { summaryFocused: true });
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
      assert.equal(await field('driverId').evaluate((node) => document.activeElement === node), true);
      const observation = await themeObservation(width);
      assert.equal(observation.shell.backgroundColor, 'rgb(245, 246, 246)');
      assert.equal(observation.primary.backgroundColor, 'rgb(3, 116, 147)');
      assert.equal(observation.primary.borderRadius, '2px');
      assert.match(observation.title.fontFamily, /BMWGroupTNCondensedPro-Medium/); assert.equal(observation.title.fontWeight, '500');
      for (const name of ['label', 'input', 'select', 'textarea']) assert.equal(observation.roles[name].fontWeight, '400', name);
      for (const name of ['heading', 'button', 'error']) assert.equal(observation.roles[name].fontWeight, '600', name);
      for (const role of Object.values(observation.roles)) assert.equal(role.fontFamily, observation.shell.fontFamily);
      assert.equal(observation.fontLoaded, true); assert.ok(observation.fontResources.length > 0);
      assert.ok(observation.loadedFaces.some((face) => face.status === 'loaded' && face.weight === '500'));
      assert.equal(observation.geometry.headerMinHeight, '56px');
      // Narrow menu: 44px control + 12px padding + 1px border makes the existing shell 57px tall.
      assert.equal(observation.geometry.headerHeight, width === 320 ? 57 : 56);
      if (width === 1280) assert.equal(observation.geometry.navWidth, 48);
      assert.ok(observation.geometry.actionHeights.every((height) => height >= 48));
      assert.equal(observation.cssViewport, width); assert.equal(observation.scrollWidth, width);
      assert.equal(observation.focus.outlineStyle, 'solid'); assert.equal(observation.focus.outlineWidth, '2px');
      assert.equal(observation.focus.outlineColor, 'rgb(2, 145, 183)');
      for (const name of ['primaryText', 'bodyText', 'mutedText']) assert.ok(observation.contrast[name] >= 4.5);
      for (const name of ['focusOnWhite', 'focusOnPage']) assert.ok(observation.contrast[name] >= 3);
      await capture(`keyboard-focus-${width}`);
      await fill(); await page.getByRole('button', { name: 'Save choices', exact: true }).click(); await saved();
      await capture(`saved-${width}`);
      await prepare('long-unknown', width); await page.evaluate(() => document.fonts.ready); await capture(`long-unknown-${width}`);
      results.cases.push({ name: chunk === 'typography' ? 'canonical-density-typography' : 'default-density',
        ...observation, functionalTraceReused: 'flow/results.json and states/results.json at0a4ff5ac' });
    } else if (chunk === 'flow') {
      await prepare('flow', width); await page.locator('.gcsp-feature').first().getByRole('button', { name: 'Choose a replacement', exact: true }).click();
      await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.waitForFunction(() => document.activeElement?.textContent === 'Check your choices');
      await capture(`invalid-${width}`, { summaryFocused: true });
      await page.locator('.gcsp-error-summary a').first().click();
      assert.equal(await field('driverId').evaluate((node) => document.activeElement === node), true);
      await page.keyboard.press('y'); await page.keyboard.press('Tab');
      assert.equal(await field('driverId').inputValue(), `driver:${session.value.context.employeeId}`);
      await fill({ nominated: true }); assert.match(await page.locator('.gcsp-setup-source').innerText(), /spouse/);
      await fill(); await field('requestedCollectionDate').focus();
      assert.equal(await field('requestedCollectionDate').getAttribute('type'), 'date');
      const dateTabSteps = [];
      for (let step = 0; step < 4; step += 1) {
        await page.keyboard.press('Tab');
        dateTabSteps.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName,
          name: document.activeElement?.getAttribute('name'), type: document.activeElement?.getAttribute('type') })));
        if (dateTabSteps.at(-1).name === 'collectionLocationId') break;
      }
      assert.equal(await field('collectionLocationId').evaluate((node) => document.activeElement === node), true);
      const before = results.events.filter((e) => e.name === 'gcsp:setup-ready').length;
      await page.getByRole('button', { name: 'Continue', exact: true }).evaluate((node) => { node.click(); node.click(); }); await saved();
      await page.waitForFunction(() => window.captureSetupCounts['gcsp:setup-ready'] === 1);
      assert.equal(results.events.filter((e) => e.name === 'gcsp:setup-ready').length, before + 1);
      assert.deepEqual(Object.keys(results.events.at(-1).detail).sort(), ['mode', 'oldContractId', 'slotId', 'schemeId', 'draftVersion', 'contextVersion'].sort());
      await capture(`saved-${width}`, { duplicateSuppressed: true });
      await page.getByRole('button', { name: 'Back to account', exact: true }).click();
      await page.getByRole('heading', { name: 'Your cars', exact: true }).waitFor(); await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Resume saved journey', exact: true }).click();
      await page.getByRole('heading', { name: 'Your order choices', exact: true }).waitFor();
      assert.equal(await field('requestedCollectionDate').inputValue(), '2026-11-20');
      const invalidatedFields = [];
      for (const [name, value] of [['driverId', `nominated:${session.value.context.employeeId}`],
        ['driverId', `driver:${session.value.context.employeeId}`], ['contractOptionId', 'twelve-month-12000'],
        ['requestedCollectionDate', '2026-11-21'], ['collectionLocationId', 'demo-company-site']]) {
        if (name === 'requestedCollectionDate') await field(name).fill(value); else await field(name).selectOption(value);
        await page.getByText('Your choices changed. Availability, selection and quote context need refreshing.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Availability refreshed', exact: true }).count(), 0);
        invalidatedFields.push(name);
      }
      await capture(`changed-${width}`); await page.getByRole('button', { name: 'Save choices', exact: true }).click(); await saved();
      const draft = (await service.readDraft(session.value.context)).value;
      assert.equal(draft.currentContract.contractId, 'current:employee-paula');
      assert.equal(draft.choices.contractOptionId, 'twelve-month-12000'); assert.equal(draft.choices.collectionLocationId, 'demo-company-site');
      const stock = await service.browseStock(session.value.context); assert.equal(stock.status, 'ok');
      assert.equal(stock.value.versions.draft, draft.draftVersion); assert.equal(stock.value.versions.context, draft.contextVersion);
      results.cases.push({ name: 'flow', width, persisted: true, currentCarUnchanged: true, keyboardSummaryLink: true,
        keyboardDriverSelection: 'Native select typeahead y, then Tab commits You', nativeDateType: 'date', dateTabFocus: 'collectionLocationId', dateTabSteps, invalidatedFields,
        savedAvailabilityVersions: { draft: stock.value.versions.draft, context: stock.value.versions.context } });
    } else {
      await prepare('new', width); assert.equal(await field('expectedReturnMileage').isVisible(), false); await fill({ isNew: true });
      await page.getByRole('button', { name: 'Save choices', exact: true }).click(); await saved(); await capture(`new-${width}`);
      const newDraft = (await service.readDraft(session.value.context)).value; assert.equal(newDraft.choices.oldContractId, null); assert.equal(newDraft.choices.expectedReturnMileage, null);
      await prepare('nominated-closed', width); await fill({ nominated: true, date: '2026-11-21' });
      assert.equal(await field('contractOptionId').locator('[value="twelve-month-12000"]').isDisabled(), true);
      assert.equal(await field('collectionLocationId').locator('[value="demo-company-site"]').isDisabled(), true);
      await field('requestedCollectionDate').fill('2026-11-20'); await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByText('Choose an open, permitted collection location.', { exact: true }).first().waitFor(); await capture(`nominated-closed-${width}`);
      await prepare('long-unknown', width); assert.equal(await field('driverId').locator('[value="nominated:employee-paula"]').isDisabled(), true);
      assert.equal(await field('phone').inputValue(), ''); await capture(`long-unknown-${width}`);
      await prepare('source-conflict', width); await fill(); outage = true;
      await field('specialRequirements').fill('Retain my local choices'); await page.getByRole('button', { name: 'Save choices', exact: true }).click();
      await page.getByRole('button', { name: 'Review fresh context', exact: true }).waitFor();
      assert.equal(await field('specialRequirements').inputValue(), 'Retain my local choices'); await capture(`source-error-${width}`);
      outage = false; await page.getByRole('button', { name: 'Review fresh context', exact: true }).click();
      await page.getByRole('button', { name: 'Save choices', exact: true }).click(); await saved();
      const current = (await service.readDraft(session.value.context)).value;
      assert.equal((await service.saveDraft(session.value.context, { commandId: `other-browser-${width}`, expectedDraftVersion: current.draftVersion,
        expectedContextVersion: current.contextVersion, choices: { ...current.choices, specialRequirements: 'Newer browser choices' } })).status, 'ok');
      await field('specialRequirements').fill('Local conflicting choices'); await page.getByRole('button', { name: 'Save choices', exact: true }).click();
      await page.getByRole('button', { name: 'Review fresh context', exact: true }).click();
      await page.getByRole('button', { name: 'Discard local edits and load newer draft', exact: true }).waitFor(); await capture(`conflict-${width}`);
      assert.equal(await field('specialRequirements').inputValue(), 'Local conflicting choices');
      await page.getByRole('button', { name: 'Discard local edits and load newer draft', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[name="specialRequirements"]').value === 'Newer browser choices');
      results.cases.push({ name: 'states', width, newWithoutReturnMileage: true, nominatedRestrictions: true, closedLocation: true,
        unknownReadOnlyFacts: true, sourceFailureRetainsEdits: true, staleDraftRequiresDiscard: true });
    }
  }
  await Promise.all(apiTasks);
  const expectedFailure = (row) => row.path.endsWith('/draft') && row.httpStatus === 404 && row.status === 'not-found'
    || row.scenario.name === 'source-conflict' && (row.httpStatus === 503 && row.status === 'unavailable'
      || row.path.endsWith('/draft') && row.httpStatus === 409 && ['stale-version', 'conflict'].includes(row.status));
  results.expectedHttpFailures = results.api.filter(expectedFailure);
  results.unexpectedHttpFailures = results.api.filter((row) => row.httpStatus >= 400 && !expectedFailure(row));
  results.unexpectedConsoleErrors = results.consoleErrors.filter((row) => !results.expectedHttpFailures.some((apiRow) => apiRow.path === row.path
    && row.text.includes(String(apiRow.httpStatus))));
  assert.deepEqual(results.pageErrors, []); assert.deepEqual(results.unexpectedHttpFailures, []);
  assert.deepEqual(results.unexpectedConsoleErrors, []); assert.deepEqual(results.externalRequests, []);
} catch (error) { results.errors.push(String(error.message).slice(0, 300)); process.exitCode = 1; }
finally {
  results.sourceHashes = {};
  for (const file of [...servedSources].sort()) results.sourceHashes[file] = createHash('sha256').update(await readFile(path.join(ROOT, file))).digest('hex');
  try { sampleProcesses(); } catch { }
  let browserClosed = !browser; let listenerClosed = !server.listening;
  try { await browser?.close(); browserClosed = true; } catch { }
  try { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); listenerClosed = true; } catch { }
  const closed = await Promise.allSettled(runtimes.map((item) => item.close()));
  results.cleanup = { browserContextClosed: browserClosed, listenerClosed: listenerClosed && !server.listening,
    listenerPort: port, listenerHost: '127.0.0.1', runtimeClosed: closed.every((row) => row.status === 'fulfilled'),
    profile, cache, crashpad, scratch, apiServerNeverBound: !api?.listening };
  results.captureBytes = bytes;
  const pngBytes = async (dir) => {
    let total = 0; for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name); if (entry.isDirectory()) total += await pngBytes(file);
      else if (entry.name.endsWith('.png')) total += (await readFile(file)).byteLength;
    } return total;
  };
  results.aggregateCaptureBytes = await pngBytes(path.dirname(OUT));
  if (results.aggregateCaptureBytes > LIMIT) { results.errors.push('Aggregate captures exceed 12 MiB.'); process.exitCode = 1; }
  await writeFile(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ chunk, captures: results.screenshots.length, bytes, errors: results.errors, cleanup: results.cleanup }));
}
