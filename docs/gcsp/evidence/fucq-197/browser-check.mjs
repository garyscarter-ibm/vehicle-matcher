// FUCQ-197 browser check: Your cars saved journey, order history and footer at 1280 and 375 show no raw ids.
// Runs the real hosted entry (`node index.js`, GCSP_RUNTIME=1 memory) on 127.0.0.1; captures and results.json land here.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const SERVER = fileURLToPath(new URL('../../../../server/', import.meta.url));
const OUT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.FUCQ197_PORT ?? 8983);
if (PORT < 8982 || PORT > 8989) throw new Error('Port must be 8982 to 8989');
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = `check-${randomBytes(9).toString('hex')}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCRATCH = process.env.TMPDIR ?? '/tmp';
const RAW = ['current:employee-paula', 'slot-paula', 'choices-fs-uk', 'pcs-ukfs-bmw', 'motorcycle-choices', 'manual-records-v1', 'Draft version'];
let server;

async function start() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: SCRATCH, GCSP_OFFLINE: '1', GCSP_RUNTIME: '1',
    PORT: String(PORT), GCSP_PUBLIC_ORIGIN: BASE, DEMO_ACCESS_KEY: KEY };
  server = spawn(process.execPath, ['index.js'], { cwd: SERVER, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`server not ready: ${output.slice(-400)}`)), 60000);
    for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => {
      output += chunk; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
  });
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exited = once(server, 'exit'); server.kill('SIGTERM');
  const timer = setTimeout(() => server.kill('SIGKILL'), 5000); await exited; clearTimeout(timer);
}
async function openAccount(page) {
  await page.goto(`${BASE}/gcsp-account.html`, { waitUntil: 'networkidle' });
  if (page.url().includes('/gcsp/access')) {
    await page.locator('input[type="password"]').fill(KEY);
    await Promise.all([page.waitForLoadState('networkidle'), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
  }
  await page.locator('.gcsp-account-body .gcsp-feature').first().waitFor({ timeout: 20000 });
}

const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq197-chrome-'));
try {
  await start();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const run = { viewport: viewport.width };
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')), { executablePath: CHROME, headless: true, viewport });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await openAccount(page);
      const choose = page.locator('.gcsp-account-body').getByRole('button', { name: 'Choose a replacement' }).first();
      if (await choose.count()) { await choose.click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(1000); }
      await openAccount(page);
      const body = page.locator('.gcsp-account-body');
      const saved = body.locator('.gcsp-summary').filter({ hasText: 'journey saved' }).first();
      await saved.waitFor({ timeout: 15000 });
      await body.evaluate((node) => node.querySelectorAll('.gcsp-account-histories details').forEach((d) => { d.open = true; }));
      const parts = { savedJourney: await saved.innerText(), orderHistory: await body.locator('.gcsp-account-histories').innerText(),
        footer: await body.locator(':scope > .gcsp-synthetic').last().innerText() };
      const all = Object.values(parts).join('\n');
      run.rawFound = [...RAW.filter((id) => all.includes(id)), ...(/\d{4}-\d{2}-\d{2}T\d{2}/.test(all) ? ['ISO timestamp'] : [])];
      run.savedJourney = parts.savedJourney; run.footer = parts.footer;
      run.historySummaries = await body.locator('.gcsp-account-histories summary').allInnerTexts();
      run.overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await saved.screenshot({ path: join(OUT, `${viewport.width}-saved-journey.png`) });
      const history = body.locator('.gcsp-account-histories');
      await history.screenshot({ path: join(OUT, `${viewport.width}-order-history.png`) });
      await body.locator(':scope > .gcsp-synthetic').last().screenshot({ path: join(OUT, `${viewport.width}-footer.png`) });
      run.screenshots = ['saved-journey', 'order-history', 'footer'].map((name) => `docs/gcsp/evidence/fucq-197/${viewport.width}-${name}.png`);
      run.pageErrors = errors;
      run.passed = !run.rawFound.length && run.overflow <= 0 && !errors.length;
    } catch (error) { run.error = error.message.slice(0, 400); run.passed = false; }
    finally { await context.close(); }
    runs.push(run);
  }
} finally { await stop(); await rm(profileRoot, { recursive: true, force: true }); }
const passed = runs.length === 2 && runs.every((run) => run.passed);
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: BASE, runtime: 'memory (GCSP_RUNTIME=1)', runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
