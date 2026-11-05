// Existing body/controller with a clearly labelled supplied-decision projection.
// Run only through the registered resource supervisor; this is not live stock evidence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
assert(process.env.TMPDIR, 'Run through the registered resource supervisor.');
const profile = join(process.env.TMPDIR, 'essential-unknown-chrome-profile');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/usget/.npm/_npx/db89d7302a373f10/node_modules/playwright-core/index.mjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const snapshotPath = 'docs/gcsp/evidence/fucq94/representative-snapshot.json';
const snapshotBytes = await readFile(join(ROOT, snapshotPath));
const supplied = JSON.parse(snapshotBytes).preview.value.decisions.filter((decision) => decision.gateStatus === 'needs-confirmation');
assert.equal(supplied.length, 1);
assert.deepEqual(supplied[0].unknowns.map((entry) => entry.code), ['charging-unconfirmed']);
const harnessPath = 'docs/gcsp/evidence/fucq94/essential-unknown-harness.js';
const harness = await readFile(join(ROOT, harnessPath), 'utf8');
const pageBytes = await readFile(join(ROOT, 'gcsp-brief.html'), 'utf8');
for (const [name, value] of [['page', pageBytes], ['external harness', harness]]) {
  assert.doesNotMatch(value, /\bon\w+\s*=|\beval\s*\(|\bnew\s+Function\b|set(?:Timeout|Interval)\s*\(\s*['"`]/i, `${name}: CSP unsafe source`);
}
for (const script of pageBytes.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) assert.equal(script[1].trim(), '', 'Original page has no inline script body');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const allowed = (path) => ['/gcsp-brief.html', '/gcsp-employee.css', `/${snapshotPath}`, `/${harnessPath}`].includes(path)
  || path.startsWith('/blocks/') || path.startsWith('/assets/');
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    const file = resolve(ROOT, `.${path}`);
    const canonical = `/${relative(ROOT, file).split(sep).join('/')}`;
    if (request.method !== 'GET' || !allowed(path) || path !== canonical || !file.startsWith(`${ROOT}${sep}`) || !(await stat(file)).isFile()) throw Error('Not found');
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(path === '/blocks/gcsp/brief/harness.js' ? `import '/${harnessPath}';\n` : await readFile(file));
  } catch { response.writeHead(404).end('Not found'); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
const results = [];
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile-375', { width: 375, height: 812 }]]) {
    const page = await context.newPage(); page.setDefaultTimeout(6000); await page.setViewportSize(viewport);
    const errors = []; const requests = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error' && !/favicon/.test(message.text())) errors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    await page.route('**/*', (route) => {
      const url = route.request().url(); requests.push(url.startsWith(`${origin}/`) ? new URL(url).pathname : 'external');
      if (url.startsWith(`${origin}/`)) return route.continue();
      errors.push('Unexpected external request'); return route.abort();
    });
    await page.goto(`${origin}/gcsp-brief.html`);
    await page.waitForFunction(() => document.querySelector('.gcsp-brief-preview-status')?.textContent === '0 eligible cars; 1 car needs confirmation.');
    await page.locator('.vm-card-photo').evaluateAll((images) => Promise.all(images.map((image) => { image.loading = 'eager'; return image.decode(); })));
    assert.match(await page.locator('.gcsp-brief-draft').innerText(), /Test-only supplied decision: essential unknown/);
    assert.equal(await page.locator('.gcsp-brief-cards > *').count(), 1);
    const cardText = await page.locator('.gcsp-brief-cards').innerText();
    assert.match(cardText, /Charging access is unknown. Confirm home or work charging./);
    assert.match(cardText, /BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack/);
    assert.doesNotMatch(cardText, /BMW 320i M Sport Touring/);
    assert.equal(await page.getByRole('button', { name: 'Save this brief', exact: true }).isDisabled(), true);
    assert.equal(requests.some((path) => path.startsWith('/api/')), false);
    if (name === 'desktop') {
      await page.keyboard.press('Tab');
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Skip/);
      await page.keyboard.press('Enter');
    } else {
      const menu = page.locator('.gcsp-menu-toggle'); await menu.focus(); await page.keyboard.press('Enter');
      assert.equal(await menu.getAttribute('aria-expanded'), 'true'); await page.keyboard.press('Enter');
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    }
    const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflowPx, 0); assert.deepEqual(errors, []);
    const file = `essential-unknown-${name}.png`;
    await page.screenshot({ path: join(OUT, file), fullPage: true, animations: 'disabled' });
    results.push({ name, file, viewport, overflowPx, errors, apiRequests: 0, summary: '0 eligible cars; 1 car needs confirmation.', saveDisabled: true, cardText });
    console.log(`Captured ${file}`); await page.close();
  }
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise((done) => server.close(done));
}
assert.equal(hash(await readFile(join(ROOT, snapshotPath))), hash(snapshotBytes), 'Original supplied input stayed unchanged');
const sources = {};
for (const path of ['gcsp-brief.html', 'blocks/gcsp/brief/gcsp-brief.js', 'blocks/gcsp/brief/brief-controller.js', 'blocks/gcsp/brief/brief-view.js', 'blocks/gcsp/brief/brief-view-model.js', 'blocks/gcsp/brief/gcsp-brief.css', 'blocks/gcsp/brief/harness.js', snapshotPath, harnessPath, 'docs/gcsp/evidence/fucq94/capture-essential-unknown.mjs']) sources[path] = hash(await readFile(join(ROOT, path)));
await writeFile(join(OUT, 'essential-unknown-browser-matrix.json'), `${JSON.stringify({ story: 'FUCQ-94', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim(), capturedAt: new Date().toISOString(), browser: 'isolated headless system Chrome', scope: 'Test-only supplied needs-confirmation decision, original mounted body/controller; not live stock/service evidence', projection: { source: snapshotPath, originalDecisionCount: 2, selectedGate: 'needs-confirmation', retainedDecisionSha256: hash(JSON.stringify(supplied[0])), changedDecisionFields: [], recommendations: [], eligibleCount: 0, state: 'no-viable-stock' }, activeProfileCompatibilityException: profile, sources, results }, null, 2)}\n`);
console.log(JSON.stringify({ captures: results.length, errors: 0, scope: 'supplied-decision only' }));
