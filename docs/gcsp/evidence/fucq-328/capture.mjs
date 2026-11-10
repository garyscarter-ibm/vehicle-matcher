// FUCQ-328 evidence: Paula's "Your scheme and starting answers" on the live preferences page, offline host, memory repository.
// Adapted from fucq-316/capture.mjs. Usage: CAP_W=1280|375 CAP_PORT=9512|9513 CAP_SCRATCH=<owned dir> node capture.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const W = Number(process.env.CAP_W || 1280);
const viewport = W === 375 ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const port = Number(process.env.CAP_PORT || 9512);
if (port < 9512 || port > 9513) throw new Error('CAP_PORT must be 9512-9513');
const scratch = resolve(process.env.CAP_SCRATCH || '');
if (!scratch || scratch === '/') throw new Error('Set CAP_SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FORBIDDEN = /Not supplied|Source not supplied|Unknown ·|policy:|undefined/;
let child; let page; const results = [];

async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: join(scratch, 'tmp'), GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
    GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: KEY, PORT: String(port) };
  child = spawn(process.execPath, ['index.js'], { cwd: resolve(HERE, '../../../../server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  await appendFile(join(scratch, 'pids.txt'), `${child.pid} host ${port}\n`);
  let out = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`host not ready: ${out.slice(-300)}`)), 90000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) { clearTimeout(t); ok(); } });
    child.once('exit', (c) => { clearTimeout(t); fail(new Error(`host exited ${c}`)); });
  });
}
const stop = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);
process.on('SIGALRM', () => { stop(); process.exit(124); });
const h1 = () => page.locator('h1').first().textContent().then((t) => t.trim()).catch(() => '');
const until = async (check, label, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check().catch(() => false)) return; await wait(300); } throw new Error(`timeout: ${label}`); };
const go = async (path) => { await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(800); };
const closeStrip = () => page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});

async function shot(name, checks) {
  const known = page.locator('.gcsp-brief-known');
  await known.scrollIntoViewIfNeeded();
  const file = `${W}-${name}.png`;
  await page.screenshot({ path: join(HERE, file), fullPage: false });
  const region = await known.evaluate((n) => ({
    facts: [...n.querySelectorAll('.vm-fact')].map((f) => [f.querySelector('dt').textContent, f.querySelector('dd').textContent]),
    notes: [...n.querySelectorAll(':scope > p, li:not([hidden])')].map((p) => p.textContent).filter(Boolean),
    hiddenRows: n.querySelectorAll('li[hidden]').length, text: n.innerText }));
  const metrics = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    focus: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}:${(document.activeElement.textContent || '').trim().slice(0, 40)}` : null,
    inlineHandlers: [...document.querySelectorAll('*')].filter((e) => [...e.attributes].some((a) => a.name.startsWith('on'))).length,
    inlineScripts: [...document.querySelectorAll('script:not([src])')].length }));
  const { text, ...shown } = region;
  results.push({ screen: name, file, viewport: `${W}x${viewport.height}`, url: page.url().replace(origin, ''), h1: (await h1()).slice(0, 60),
    ...shown, forbiddenCopyFound: (text.match(FORBIDDEN) || [])[0] ?? null, ...metrics, checks });
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  const context = await chromium.launchPersistentContext(join(scratch, `chrome-${W}`), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport });
  page = context.pages()[0] || await context.newPage();
  try {
    // FUCQ-322 login: the access key first if asked, then Paula's address and the shared temporary password.
    await go('/gcsp/login');
    const key = page.locator('#key');
    if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1500); }
    if (!/\/gcsp\/login/.test(page.url())) await go('/gcsp/login');
    await page.locator('input[type="email"]').fill('paula.mason@gcsp-demo.com'); await page.locator('input[type="password"]').fill('fucq');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await until(async () => (await h1()) === 'Your cars', 'account');
    await go('/gcsp-brief-live.html'); await closeStrip();
    await until(async () => (await h1()) === 'Your preferences', 'preferences'); await wait(1500);
    // Keyboard: focus the disclosure's summary and open it with Enter.
    const summary = page.locator('.gcsp-brief-known > summary');
    await summary.focus(); await page.keyboard.press('Enter'); await wait(600);
    await shot('open', ['summary opened by keyboard (focus stays on summary)', 'four facts from Paula\'s records, no Not supplied row', 'one line counts unanswered needs']);
    const towbar = page.locator('[aria-label="Do you need a towbar?"] button', { hasText: 'No' }).first();
    await towbar.focus(); await page.keyboard.press('Enter'); await wait(1500);
    await shot('answered', ['towbar answered No by keyboard', 'its provenance row appears as Draft · Your answers', 'pending count falls by one']);
  } catch (e) { results.push({ error: String(e.stack).slice(0, 600) }); await page.screenshot({ path: join(scratch, `error-${W}.png`), fullPage: true }).catch(() => {}); }
  await writeFile(join(scratch, `results-${W}.json`), JSON.stringify(results, null, 1));
  await context.close().catch(() => {}); stop();
}
main().then(() => process.exit(0), (e) => { console.error(e); stop(); process.exit(1); });
