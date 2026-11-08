// FUCQ-202 browser check: restart the hosted memory server with a new access key (the old key lapses), act, then Reload.
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
const PORT = Number(process.env.FUCQ202_PORT ?? 8983);
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

// The offer link sits outside the access gate: it links to the access form, which returns to the account.
const pages = {
  offer: { path: '/gcsp-offer.html?offerId=check-offer-1&runId=check-run-1', notice: 'Demo access needed', action: { role: 'link', name: 'Enter the access key' },
    returnsTo: '/gcsp-account.html', ready: async (page) => page.locator('[data-offer-action="refresh"]').waitFor({ timeout: 20000 }),
    act: async (page) => page.locator('[data-offer-action="refresh"]').click() },
  // Hosted Greg reads fixture figures and mounts no plan or publish adapter, so only the case queue calls the API here.
  greg: { path: '/gcsp-greg.html', observe: '[data-region="case-queue"]', ready: async (page) => page.getByRole('button', { name: 'Refresh queue' }).waitFor({ timeout: 20000 }),
    act: async (page) => page.getByRole('button', { name: 'Refresh queue' }).click() },
};

const runs = [];
const profileRoot = await mkdtemp(join(SCRATCH, 'fucq202-chrome-'));
try {
  await start();
  for (const viewport of (process.env.FUCQ202_ONE ? [{ width: 1280, height: 900 }] : [{ width: 1280, height: 900 }, { width: 375, height: 812 }])) {
    for (const [name, spec] of Object.entries(pages)) {
      const run = { viewport: viewport.width, page: name, steps: [] };
      const context = await chromium.launchPersistentContext(await mkdtemp(join(profileRoot, 'p-')),
        { executablePath: CHROME, headless: true, viewport });
      const page = context.pages()[0] ?? await context.newPage();
      try {
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(BASE + '/gcsp-account.html', { waitUntil: 'networkidle' });
        if (page.url().includes('/gcsp/access')) await enterKey(page);
        await page.goto(BASE + spec.path, { waitUntil: 'networkidle' });
        await spec.ready(page); run.steps.push('opened');
        await lapse(); run.steps.push('access key lapsed');
        await spec.act(page);
        if (spec.observe) {
          await page.waitForTimeout(3000); run.observed = (await page.locator(spec.observe).innerText()).replace(/\s+/g, ' ').slice(0, 300);
          await page.screenshot({ path: join(OUT, `${viewport.width}-${name}-lapsed.png`) }); run.pageErrors = errors; run.passed = !errors.length; runs.push(run); continue;
        }
        const notice = page.getByText(spec.notice, { exact: false }).locator('visible=true').first();
        await notice.waitFor({ timeout: 20000 });
        const control = page.getByRole(spec.action.role, { name: spec.action.name });
        const text = await visibleText(page);
        run.lapsed = { notice: true, actionVisible: await control.isVisible(), unavailableCopy: /unavailable|could not be loaded|refused/i.test(text),
          overflow: await overflow(page) };
        const shot = `${viewport.width}-${name}-lapsed.png`;
        await page.screenshot({ path: join(OUT, shot) }); run.lapsed.screenshot = `docs/gcsp/evidence/fucq-202/${shot}`;
        await Promise.all([page.waitForLoadState('networkidle'), control.click()]);
        await page.waitForLoadState('networkidle');
        run.recover = { accessForm: page.url().includes('/gcsp/access') };
        if (run.recover.accessForm) await enterKey(page);
        run.recover.landed = new URL(page.url()).pathname;
        await page.waitForTimeout(1500);
        run.recover.noLapsedCopy = !/The demo was restarted|Demo access needed/.test(await visibleText(page));
        const shotAfter = `${viewport.width}-${name}-recovered.png`;
        await page.screenshot({ path: join(OUT, shotAfter) }); run.recover.screenshot = `docs/gcsp/evidence/fucq-202/${shotAfter}`;
        run.pageErrors = errors;
        run.passed = run.lapsed.actionVisible && run.lapsed.overflow <= 0 && !run.lapsed.unavailableCopy && run.recover.accessForm
          && run.recover.landed === spec.returnsTo && run.recover.noLapsedCopy && !errors.length;
      } catch (error) { run.error = error.message.slice(0, 300); run.passed = false; run.at = page.url(); run.text = (await visibleText(page).catch(() => '')).slice(0, 600); }
      finally { await context.close(); }
      runs.push(run);
    }
  }
} finally { await stop(); await rm(profileRoot, { recursive: true, force: true }); }
const passed = runs.length === (process.env.FUCQ202_ONE ? 2 : 4) && runs.every((run) => run.passed);
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: BASE, runtime: 'memory (GCSP_RUNTIME=1)', lapse: 'server restarted with a new access key', note: 'greg runs observe the case queue only (FUCQ-170 owns it); passed means no page errors', runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
