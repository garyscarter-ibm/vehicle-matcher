// FUCQ-201 browser check (from FUCQ-198's): after a restart the Your cars header stays quiet, the page offers Reload.
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
const PORT = Number(process.env.FUCQ201_PORT ?? 8982);
if (PORT < 8982 || PORT > 8989) throw new Error('Port must be 8982 to 8989');
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = `check-${randomBytes(9).toString('hex')}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCRATCH = process.env.TMPDIR ?? '/tmp';
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
const restart = async () => { await stop(); await start(); };

async function enterKey(page) {
  await page.locator('input[type="password"]').fill(KEY);
  await Promise.all([page.waitForLoadState('networkidle'), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
}
const visibleText = (page) => page.evaluate(() => document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const pages = {
  account: { path: '/gcsp-account.html', scope: '.gcsp-account-body', ready: async (page) => page.locator('.gcsp-account-body .gcsp-feature').first().waitFor({ timeout: 20000 }),
    act: async (page) => page.getByRole('button', { name: 'Refresh account' }).first().click() },
};

const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq201-chrome-'));
try {
  await start();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    for (const [name, spec] of Object.entries(pages)) {
      const run = { viewport: viewport.width, page: name, steps: [] };
      const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')),
        { executablePath: CHROME, headless: true, viewport });
      try {
        const page = context.pages()[0] ?? await context.newPage();
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(BASE + spec.path, { waitUntil: 'networkidle' });
        if (page.url().includes('/gcsp/access')) await enterKey(page);
        await spec.ready(page); run.steps.push('opened');
        await restart(); run.steps.push('server restarted');
        await spec.act(page);
        const area = page.locator(spec.scope); await area.getByText('The demo was restarted').waitFor({ timeout: 15000 });
        const text = await visibleText(page);
        const reload = area.getByRole('button', { name: 'Reload' });
        run.restarted = { notice: true, reloadVisible: await reload.isVisible(), reloadEnabled: await reload.isEnabled(),
          refusedCopy: /refused|cannot be opened|Account unavailable|Backend unavailable/i.test(text),
          headerAccountUnavailable: /Account unavailable/.test(text), overflow: await overflow(page),
          header: await page.locator('.gcsp-account').evaluate((node) => ({ status: node.dataset.status, text: node.textContent, retry: !!node.querySelector('.gcsp-account-retry') })) };
        const shot = `${viewport.width}-${name}-restarted.png`;
        await page.screenshot({ path: join(OUT, shot), fullPage: name === 'account' }); run.restarted.screenshot = `docs/gcsp/evidence/fucq-201/${shot}`;
        await Promise.all([page.waitForLoadState('networkidle'), reload.click()]);
        await page.waitForLoadState('networkidle');
        run.reload = { landed: new URL(page.url()).pathname };
        if (page.url().includes('/gcsp/access')) { run.reload.accessForm = true; await enterKey(page); }
        await spec.ready(page);
        const after = await visibleText(page);
        run.reload.back = new URL(page.url()).pathname === spec.path;
        run.reload.noticeGone = !(await area.innerText()).includes('The demo was restarted'); run.reload.afterHasRestartCopy = after.includes('The demo was restarted');
        const shotAfter = `${viewport.width}-${name}-reloaded.png`;
        await page.screenshot({ path: join(OUT, shotAfter) }); run.reload.screenshot = `docs/gcsp/evidence/fucq-201/${shotAfter}`;
        run.pageErrors = errors;
        run.passed = run.restarted.reloadVisible && run.restarted.reloadEnabled && run.restarted.overflow <= 0
          && !/refused|cannot be opened/i.test(text) && !run.restarted.headerAccountUnavailable
          && run.restarted.header.status === 'restarted' && !run.restarted.header.retry && run.reload.back && run.reload.noticeGone && !errors.length;
      } catch (error) { run.error = error.message.slice(0, 400); run.passed = false; }
      finally { await context.close(); }
      runs.push(run);
    }
  }
} finally { await stop(); await rm(profileRoot, { recursive: true, force: true }); }
const passed = runs.length === 2 && runs.every((run) => run.passed);
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: BASE, runtime: 'memory (GCSP_RUNTIME=1)', runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
