import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit read-only gallery fixtures qualify presentation, never released-run integration.
const root = process.cwd();
const width = Number(process.argv[process.argv.indexOf('--width') + 1]);
assert.ok([1280, 320].includes(width), 'Choose --width 1280 or 320');
assert.ok(process.env.TMPDIR && process.env.FUCQ69_BROWSER_RUN && process.env.FUCQ69_SOURCE);
const scratch = path.resolve(process.env.TMPDIR);
const profile = path.join(scratch, 'profile');
const cache = path.join(scratch, 'cache');
const crashpad = path.join(scratch, 'crashpad');
const out = path.join(root, 'docs/gcsp/evidence/fucq69/browser', process.env.FUCQ69_BROWSER_RUN);
await Promise.all([profile, cache, crashpad, out].map((dir) => mkdir(dir, { recursive: true })));
const result = { story: 'FUCQ-69', source: process.env.FUCQ69_SOURCE, width,
  input: 'Dated synthetic read-only gallery fixtures; no stock producer or claim service integration',
  cases: [], screenshots: [], errors: [], externalRequests: [], pageErrors: [],
  resources: { nodePid: process.pid, profile, cache, crashpad, httpPort: null, chromeTransport: 'owned pipe; no CDP listener', processes: [] }, cleanup: {} };
const mime = (file) => ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' })[path.extname(file)] ?? 'application/octet-stream';
const served = new Map(); let origin; let context; let page; let bytes = 0;
const permitted = (file) => file === 'gcsp-manual-gallery.html' || file === 'gcsp-employee.css'
  || /^(blocks\/(gcsp|vehicle-matcher)\/).+\.(js|css)$/.test(file)
  || /^blocks\/vehicle-matcher\/fonts\/[^/]+\.(woff|woff2)$/.test(file)
  || file === 'assets/brand-hero/bmw.jpg';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin ?? 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    const relative = path.relative(root, file);
    if (!file.startsWith(`${root}${path.sep}`) || !permitted(relative)) { res.writeHead(403); return res.end(); }
    const content = await readFile(file);
    const hash = createHash('sha256').update(content).digest('hex');
    assert.ok(!served.has(relative) || served.get(relative) === hash, 'Served source changed during browser proof');
    served.set(relative, hash);
    res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404); res.end(); }
});
function sampleProcesses() {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,args='], { encoding: 'utf8' }).split('\n');
  result.resources.processes.push(...rows.filter((row) => row.includes(profile) || row.includes(crashpad)).map((row) => {
    const match = row.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/);
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) } : null;
  }).filter(Boolean));
}
async function capture(name) {
  const observation = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    labelledControls: [...document.querySelectorAll('input,select,textarea')].every((node) => node.labels?.length),
    visibleScores: [...document.querySelectorAll('.vm-score')].filter((node) => !node.hidden).length,
    font: getComputedStyle(document.querySelector('.gcsp-gallery-body')).fontFamily,
  }));
  const file = `${String(result.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(out, file), fullPage: true, animations: 'disabled' });
  const data = await readFile(path.join(out, file)); bytes += data.byteLength;
  result.screenshots.push({ file, bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex'), ...observation });
  assert.ok(bytes <= 12 * 1024 * 1024, 'Bounded capture allowance exceeded');
  assert.equal(observation.overflow, false, name); assert.ok(observation.labelledControls, name);
  assert.equal(observation.visibleScores, 0); sampleProcesses();
}
async function load(name = 'available') {
  await page.goto(`${origin}/gcsp-manual-gallery.html?fixture=${name}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Released cars', exact: true }).waitFor();
  await page.getByText('Read-only synthetic gallery · 5 November 2026', { exact: true }).waitFor();
}
async function keyboardSelect(name, value) {
  const field = page.locator(`[name="${name}"]`); await field.focus();
  await field.press('Space'); await field.press('Home'); await field.press('ArrowDown'); await field.press('Enter'); await field.press('Tab');
  const actual = await field.inputValue(); result.cases.push({ name: `keyboard-${name}`, expected: value, actual });
  assert.equal(actual, value);
}
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  result.resources.httpPort = server.address().port; origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(pathToFileURL('/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs'));
  context = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, viewport: { width, height: width === 320 ? 740 : 900 }, deviceScaleFactor: 1,
    args: ['--disable-dev-shm-usage', '--disable-breakpad', '--disable-crash-reporter', '--disable-background-networking',
      `--disk-cache-dir=${cache}`, `--crash-dumps-dir=${crashpad}`] });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (new URL(url).origin === origin || url.startsWith('data:')) return route.continue();
    result.externalRequests.push(new URL(url).origin); return route.abort();
  });
  page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', (error) => result.pageErrors.push(error.message));
  page.setDefaultTimeout(8000);
  await load(); await page.locator('.vm-card').nth(2).waitFor(); await capture('overview');
  assert.equal(await page.locator('[data-action-id="review-car"]:enabled').count(), 0);
  await keyboardSelect('series', '3 Series');
  assert.equal(await page.locator('.vm-card').count(), 2);
  await page.locator('[name="series"]').selectOption('');
  await keyboardSelect('body', 'Touring'); await keyboardSelect('sort', 'points');
  await page.locator('[name="query"]').focus(); await page.keyboard.type('Technology Plus');
  assert.equal(await page.locator('.vm-card').count(), 1);
  const details = page.getByRole('button', { name: 'Vehicle details', exact: true }); await details.focus(); await details.press('Enter');
  await page.locator('.gcsp-gallery-detail h2').waitFor();
  assert.ok(await page.locator('.gcsp-gallery-detail h2').evaluate((node) => node === document.activeElement));
  const equipment = page.getByText('Configured equipment and options', { exact: true }).first(); await equipment.focus(); await equipment.press('Enter');
  await capture('long-name-details');
  assert.ok(await page.locator('.gcsp-gallery-detail').getByText('Parking Assistant Plus', { exact: false }).count());
  const back = page.getByRole('button', { name: 'Back to released cars', exact: true }); await back.focus(); await back.press('Enter');
  assert.ok(await details.evaluate((node) => node === document.activeElement));
  await page.locator('[name="query"]').fill('no matching vehicle'); await capture('empty-search');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.route('**/assets/brand-hero/bmw.jpg', (route) => route.abort());
  await load(); await page.locator('.vm-card-soon').first().waitFor(); await capture('image-failure');
  for (const [name, heading] of [['empty-stock', 'No cars are available'], ['nothing-released-yet', 'No cars have been released yet'],
    ['no-suitable-stock', 'No suitable cars are available'], ['source-unavailable', 'Availability is unavailable'],
    ['context-refresh', 'Your choices need refreshing'], ['car-taken', 'This car is no longer available']]) {
    await load(name); await page.getByRole('heading', { name: heading, exact: true }).waitFor(); await capture(name);
  }
  assert.deepEqual(result.externalRequests, []); assert.deepEqual(result.pageErrors, []);
  result.state = 'passed';
} catch (error) { result.state = 'incomplete'; result.errors.push({ name: error.name, message: error.message }); process.exitCode = 1; }
finally {
  try { sampleProcesses(); } catch (error) { result.errors.push({ cleanupSample: error.message }); }
  try { await context?.close(); result.cleanup.browserClosed = true; } catch (error) { result.cleanup.browserError = error.message; process.exitCode = 1; }
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); result.cleanup.serverClosed = true;
  result.servedSources = Object.fromEntries([...served.entries()].sort());
  result.servedSourcesUnchanged = (await Promise.all([...served].map(async ([file, hash]) => createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') === hash))).every(Boolean);
  if (!result.servedSourcesUnchanged) { result.state = 'incomplete'; process.exitCode = 1; }
  await writeFile(path.join(out, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ state: result.state, width, captures: result.screenshots.length, bytes, out, errors: result.errors }));
}
