// FUCQ-211 browser check: lapse the access key under Greg's case queue, refresh it, then Reload through the access form.
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
const PORT = Number(process.env.FUCQ211_PORT ?? 8985);
if (PORT < 8982 || PORT > 8989) throw new Error('Port must be 8982 to 8989');
const BASE = `http://127.0.0.1:${PORT}`;
const newKey = () => `check-${randomBytes(9).toString('hex')}`;
let KEY = newKey();
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
const lapse = async () => { await stop(); KEY = newKey(); await start(); };
async function enterKey(page) {
  await page.locator('input[type="password"]').fill(KEY);
  await Promise.all([page.waitForLoadState('networkidle'), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
}
const visibleText = (page) => page.evaluate(() => document.body.innerText);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const queueText = async (page) => (await page.locator('[data-region="case-queue"]').innerText()).replace(/\s+/g, ' ');
const shot = async (page, name) => { await page.locator('[data-region="case-queue"]').screenshot({ path: join(OUT, name) }); return `docs/gcsp/evidence/fucq-211/${name}`; };

const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq211-chrome-'));
try {
  await start();
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const run = { viewport: viewport.width };
    const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')), { executablePath: CHROME, headless: true, viewport });
    const page = context.pages()[0] ?? await context.newPage();
    try {
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/gcsp-account.html', { waitUntil: 'networkidle' });
      if (page.url().includes('/gcsp/access')) await enterKey(page);
      await page.goto(BASE + '/gcsp-greg.html', { waitUntil: 'networkidle' });
      const refresh = page.locator('[data-region="case-queue"]').getByRole('button', { name: 'Refresh queue' });
      await refresh.waitFor({ timeout: 20000 }); run.before = (await queueText(page)).slice(0, 200);
      await lapse(); await refresh.click();
      const reload = page.locator('[data-region="case-queue"]').getByRole('button', { name: 'Reload' });
      await reload.waitFor({ timeout: 20000 }); const text = await queueText(page);
      run.lapsed = { notice: text.includes('The demo was restarted. Reload the page to continue.'), status: text.includes('Demo restarted.'),
        unavailableCopy: /Renewal help is unavailable|unavailable/i.test(text), refreshButton: await refresh.count(), overflow: await overflow(page),
        text: text.slice(0, 300), screenshot: await shot(page, `${viewport.width}-greg-queue-lapsed.png`) };
      await reload.focus(); await page.keyboard.press('Enter');
      await page.waitForURL(/\/gcsp\/access/, { timeout: 20000 }).catch(() => {}); await page.waitForLoadState('networkidle');
      run.recover = { accessForm: page.url().includes('/gcsp/access') };
      if (run.recover.accessForm) await enterKey(page);
      run.recover.landed = new URL(page.url()).pathname;
      await refresh.waitFor({ timeout: 20000 }); await page.waitForTimeout(1000);
      const after = await queueText(page);
      run.recover.noRestartCopy = !/The demo was restarted|Renewal help is unavailable/.test(after);
      run.recover.text = after.slice(0, 200); run.recover.screenshot = await shot(page, `${viewport.width}-greg-queue-recovered.png`);
      run.pageErrors = errors;
      run.passed = run.lapsed.notice && run.lapsed.status && !run.lapsed.unavailableCopy && run.lapsed.refreshButton === 0 && run.lapsed.overflow <= 0
        && run.recover.accessForm && run.recover.landed === '/gcsp-greg.html' && run.recover.noRestartCopy && !errors.length;
    } catch (error) { run.error = error.message.slice(0, 300); run.passed = false; run.at = page.url(); run.text = (await visibleText(page).catch(() => '')).slice(0, 600); }
    finally { await context.close(); }
    runs.push(run);
  }
} finally { await stop(); await rm(profileRoot, { recursive: true, force: true }); }
const passed = runs.length === 2 && runs.every((run) => run.passed);
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: BASE, runtime: 'memory (GCSP_RUNTIME=1)', lapse: 'server restarted with a new access key', runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
