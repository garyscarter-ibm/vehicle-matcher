// FUCQ-318 evidence: the offer's "Compared with your current car" headers at 1280 and 375, offline host, memory repository.
// Adapted from fucq-316/capture.mjs (offer section only).
// Usage: CAP_W=1280|375 CAP_PORT=9512|9513 CAP_SCRATCH=<owned dir> node capture.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { resetTo } from '../fucq-311/sections.mjs';

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
const FORBIDDEN = /Not supplied|Fitted equipment unknown/;
const LINE = 'More details not supplied';
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

const text = () => page.locator('body').innerText().catch(() => '');
const h1 = () => page.locator('h1').first().innerText().catch(() => '');
const until = async (check, label, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check().catch(() => false)) return; await wait(300); } throw new Error(`timeout: ${label}`); };
const btn = (name) => page.getByRole('button', { name, exact: true });
const go = async (path) => { await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(800); };
const kb = async (loc) => { await loc.first().focus(); await page.keyboard.press('Enter'); await wait(1200); };
async function openStrip() {
  const root = page.locator('.gcsp-presenter-controls'); await root.waitFor({ state: 'attached', timeout: 30000 });
  if (!(await root.evaluate((el) => el.open ?? true))) await root.locator('summary').first().click();
  await wait(600);
}
const closeStrip = () => page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
async function press(name) {
  await openStrip(); await page.getByRole('button', { name }).first().click({ timeout: 30000 });
  for (let i = 0; i < 120; i += 1) { await wait(500); if (!/Action in progress/.test(await page.locator('.gcsp-presenter-controls').innerText().catch(() => ''))) break; }
  await wait(2500);
}

// Screenshot plus checks on the named regions: no missing-fact copy, the single line present.
async function shot(name, regionSelector, checks) {
  const file = `${W}-${name}.png`;
  await page.screenshot({ path: join(HERE, file), fullPage: true });
  const regions = await page.locator(regionSelector).evaluateAll((nodes) => nodes.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
  const joined = regions.join(' | ');
  const metrics = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
  results.push({ screen: name, file, viewport: `${W}x${viewport.height}`, url: page.url().replace(origin, ''), h1: (await h1()).slice(0, 60),
    region: regionSelector, regionCount: regions.length, forbiddenCopyFound: (joined.match(FORBIDDEN) || [])[0] ?? null,
    lineCount: (joined.match(new RegExp(LINE, 'g')) || []).length, ...metrics, checks });
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  const context = await chromium.launchPersistentContext(join(scratch, `chrome-${W}`), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport });
  page = context.pages()[0] || await context.newPage();
  try {
    await go('/gcsp-presenter.html');
    const key = page.locator('#key');
    if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1500); }
    await closeStrip();
    // The offer, as in fucq-275: Paula, Decline then change, first release, then the offer from the activity page.
    await go('/gcsp-presenter.html'); await closeStrip();
    const H = { page: () => page, openStrip, note: () => {}, wait, clip: (t, n = 300) => String(t ?? '').slice(0, n), shot: async () => {} };
    await resetTo(H, 'Decline then change', 'offer', false, 'Paula'); await closeStrip();
    await openStrip(); if (await btn('Next release').isEnabled().catch(() => false)) await press('Next release'); await closeStrip();
    await go('/gcsp-activity-live.html'); await wait(1200);
    const open = page.getByRole('link', { name: /View offer|Open the offer/i }).first();
    if (!(await open.count())) throw new Error('no offer link on activity');
    await kb(open); await wait(2500); await closeStrip();
    await until(async () => (await page.locator('.vm-card').count()) > 0, 'offer card');
    const table = page.locator('[data-offer-comparison] .is-compare').first(); await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(HERE, `${W}-offer-compare.png`), fullPage: true });
    const heads = await page.locator('[data-offer-comparison] thead th').evaluateAll((ths) => ths.map((th) => {
      const cs = getComputedStyle(th); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      return { text: th.innerText.replace(/\s+/g, ' ').trim(), lines: Math.round((th.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh) }; }));
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    results.push({ screen: 'offer-compare', file: `${W}-offer-compare.png`, viewport: `${W}x${viewport.height}`, h1: (await h1()).slice(0, 60), heads, overflowX,
      checks: [W === 375 ? 'headers read This offer and Your current car, at most two lines' : 'headers keep the car names'] });
  } catch (e) { results.push({ error: String(e.stack).slice(0, 600) }); await page.screenshot({ path: join(scratch, `error-${W}.png`), fullPage: true }).catch(() => {}); }
  await writeFile(join(scratch, `results-${W}.json`), JSON.stringify(results, null, 1));
  await context.close().catch(() => {}); stop();
}
main().then(() => process.exit(0), (e) => { console.error(e); stop(); process.exit(1); });
