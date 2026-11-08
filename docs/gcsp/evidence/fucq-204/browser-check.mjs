// FUCQ-204 browser check: the account header and body name no raw company id; Last tick reads in words, at 1280 and 375.
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
const PORT = Number(process.env.FUCQ204_PORT ?? 8987);
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
const RAW = /demo-bmw-[a-z-]+/;
const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq204-chrome-'));
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const run = { viewport: viewport.width };
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')), { executablePath: CHROME, headless: true, viewport });
    try {
      const page = context.pages()[0] ?? await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/gcsp-account.html', { waitUntil: 'networkidle' });
      if (page.url().includes('/gcsp/access')) {
        await page.locator('input[type="password"]').fill(KEY);
        await Promise.all([page.waitForLoadState('networkidle'), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
      }
      await page.locator('.gcsp-account-body .gcsp-feature').first().waitFor({ timeout: 20000 });
      const header = await page.locator('header').first().innerText(); const body = await page.locator('body').innerText();
      run.account = { header: header.replace(/\s+/g, ' ').slice(0, 200), rawInHeader: RAW.test(header), rawInPage: RAW.test(body) };
      await page.screenshot({ path: join(OUT, `${viewport.width}-account.png`) }); run.account.screenshot = `docs/gcsp/evidence/fucq-204/${viewport.width}-account.png`;
      const bar = page.locator('.gcsp-presenter-controls').first(); await bar.waitFor({ timeout: 20000 });
      if (!await bar.evaluate((node) => node.open)) await bar.locator(':scope > summary').click();
      await bar.getByText('Presenter controls ready').waitFor({ timeout: 20000 });
      await bar.getByRole('button', { name: /^Tick \(/ }).click(); await page.waitForTimeout(2000);
      await page.locator('.gcsp-presenter-receipts > summary').click();
      const results = await page.locator('.gcsp-presenter-results').innerText();
      const readback = await page.evaluate(async () => (await (await fetch('/api/gcsp/presenter/controls', { credentials: 'same-origin' })).json()).value?.lastTick);
      run.handlerIds = (readback?.handlerOrder ?? []).map((row) => `${row.stage}/${row.handlerId}`);
      run.lastTick = { text: results.replace(/\s+/g, ' ').slice(0, 700), json: /[{}]|"status"/.test(results), tickId: /presenter-[0-9a-f]{16,}/.test(results),
        summary: /Tick (completed|still running|result not confirmed)\. \d+ steps?/.test(results), anotherStep: /Another step/.test(results),
        overflow: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) };
      await page.locator('.gcsp-presenter-results').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `${viewport.width}-last-tick.png`) }); run.lastTick.screenshot = `docs/gcsp/evidence/fucq-204/${viewport.width}-last-tick.png`;
      run.pageErrors = errors;
      run.passed = !run.account.rawInHeader && !run.account.rawInPage && !run.lastTick.json && !run.lastTick.tickId && run.lastTick.summary
        && !run.lastTick.anotherStep && run.lastTick.overflow <= 0 && !errors.length;
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
