// FUCQ-203 browser check: three ticks on the hosted memory server, then measure the Last tick panel at 320 and 1280.
// Runs the real entry (`node index.js`, GCSP_RUNTIME=1) on 127.0.0.1; screenshots and results.json land here.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const SERVER = fileURLToPath(new URL('../../../../server/', import.meta.url));
const OUT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.FUCQ203_PORT ?? 8986);
if (PORT < 8982 || PORT > 8989) throw new Error('Port must be 8982 to 8989');
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = `check-${randomBytes(9).toString('hex')}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCRATCH = process.env.TMPDIR ?? '/tmp';
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: SCRATCH, GCSP_OFFLINE: '1', GCSP_RUNTIME: '1',
  PORT: String(PORT), GCSP_PUBLIC_ORIGIN: BASE, DEMO_ACCESS_KEY: KEY };
const server = spawn(process.execPath, ['index.js'], { cwd: SERVER, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error(`server not ready: ${output.slice(-400)}`)), 60000);
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => {
    output += chunk; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
});
const measure = (page) => page.evaluate(() => {
  const results = document.querySelector('.gcsp-presenter-controls .gcsp-presenter-results'); const receipts = results?.querySelector('details.gcsp-presenter-receipts');
  return { resultsHeight: Math.round(results?.getBoundingClientRect().height ?? 0), receiptsOpen: receipts?.open ?? null,
    steps: receipts?.querySelectorAll('li').length ?? 0, summary: receipts?.querySelector('summary')?.textContent ?? null,
    summaryHeight: Math.round(receipts?.querySelector('summary')?.getBoundingClientRect().height ?? 0),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
});
const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq203-chrome-'));
try {
  for (const viewport of [{ width: 320, height: 700 }, { width: 1280, height: 900 }]) {
    const run = { viewport: viewport.width };
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')), { executablePath: CHROME, headless: true, viewport });
    try {
      const page = context.pages()[0] ?? await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/gcsp-presenter.html', { waitUntil: 'networkidle' });
      if (page.url().includes('/gcsp/access')) {
        await page.locator('input[type="password"]').fill(KEY);
        await Promise.all([page.waitForLoadState('networkidle'), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
      }
      const bar = page.locator('.gcsp-presenter-controls').first(); await bar.waitFor({ timeout: 20000 });
      if (!await bar.evaluate((node) => node.open)) await bar.locator(':scope > summary').click();
      await bar.getByText('Presenter controls ready').waitFor({ timeout: 20000 });
      for (let i = 0; i < 3; i++) { await bar.getByRole('button', { name: /^Tick \(/ }).click(); await page.waitForTimeout(1500); }
      run.collapsed = await measure(page);
      await page.locator('.gcsp-presenter-results').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `${viewport.width}-collapsed.png`) }); run.collapsed.screenshot = `docs/gcsp/evidence/fucq-203/${viewport.width}-collapsed.png`;
      await page.locator('.gcsp-presenter-receipts > summary').click();
      await bar.getByRole('button', { name: /^Tick \(/ }).click(); await page.waitForTimeout(1500);
      run.openedThenTicked = await measure(page);
      run.pageErrors = errors;
      run.passed = run.collapsed.receiptsOpen === false && run.collapsed.steps > 3 && run.collapsed.resultsHeight < 400
        && run.collapsed.summaryHeight >= 44 && run.collapsed.overflow <= 0 && run.openedThenTicked.receiptsOpen === true && !errors.length;
    } catch (error) { run.error = error.message.slice(0, 400); run.passed = false; }
    finally { await context.close(); }
    runs.push(run);
  }
} finally {
  const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited; await rm(profileRoot, { recursive: true, force: true });
}
const passed = runs.length === 2 && runs.every((run) => run.passed);
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: BASE, runtime: 'memory (GCSP_RUNTIME=1)', runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
