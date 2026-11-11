// Your cars Order history at 1280: the returned PCS row and its record, offline host, memory repository, Paula.
// Usage: CAP_SERVER=<checkout>/server CAP_OUT=<dir> CAP_PORT=9514|9515 CAP_SCRATCH=<owned dir> node capture.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const port = Number(process.env.CAP_PORT || 9514);
const scratch = resolve(process.env.CAP_SCRATCH || ''); const out = resolve(process.env.CAP_OUT || '');
if (!process.env.CAP_SCRATCH || !process.env.CAP_OUT || !process.env.CAP_SERVER) throw new Error('Set CAP_SERVER, CAP_OUT and CAP_SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`; const origin = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let child;
const stop = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);

async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: join(scratch, 'tmp'), GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
    GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: KEY, PORT: String(port) };
  child = spawn(process.execPath, ['index.js'], { cwd: resolve(process.env.CAP_SERVER), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`host not ready: ${log.slice(-300)}`)), 90000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { log += d; if (log.includes('GCSP hosted demo')) { clearTimeout(t); ok(); } });
    child.once('exit', (c) => { clearTimeout(t); fail(new Error(`host exited ${c}`)); });
  });
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true }); await mkdir(out, { recursive: true });
  await startHost();
  const context = await chromium.launchPersistentContext(join(scratch, `chrome-${port}`), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport: { width: 1280, height: 900 } });
  const page = context.pages()[0] || await context.newPage(); const result = {};
  try {
    await page.goto(`${origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 60000 });
    const key = page.locator('#key');
    if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); }
    // Demo test principal from docs/gcsp/evidence/fucq-375/live-check.mjs (local memory host only).
    await page.goto(`${origin}/gcsp/login`); await page.getByLabel('Email address').fill('paula.mason@gcsp-demo.com');
    await page.getByLabel('Password').fill('fucq'); await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !/login/.test(String(u)), { timeout: 60000 });
    await page.goto(`${origin}/gcsp-account.html`, { waitUntil: 'load' });
    await page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
    await page.locator('.gcsp-account-history tbody tr').nth(1).waitFor({ timeout: 30000 }); await wait(1500);
    const history = page.locator('.gcsp-account-history');
    result.rows = await history.locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.trim())));
    await history.scrollIntoViewIfNeeded(); await history.screenshot({ path: join(out, 'order-history.png') });
    await history.locator('tbody .gcsp-table-action').nth(1).click(); await wait(800);
    const panel = page.locator('.gcsp-side-drawer-panel');
    result.recordTitle = await panel.locator('h2').first().innerText();
    await page.screenshot({ path: join(out, 'record-drawer.png') });
    result.placeholder = /model not supplied/i.test(await page.locator('body').innerText());
  } catch (e) { result.error = String(e.stack).slice(0, 600); await page.screenshot({ path: join(out, 'error.png'), fullPage: true }).catch(() => {}); }
  await writeFile(join(out, 'result.json'), `${JSON.stringify(result, null, 1)}\n`);
  await context.close().catch(() => {}); stop();
}
main().then(() => process.exit(0), (e) => { console.error(e); stop(); process.exit(1); });
