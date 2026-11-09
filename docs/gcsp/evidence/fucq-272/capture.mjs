// FUCQ-272 browser evidence: Reset switches to the scenario lead and keeps focus on the strip's "Reset done" status.
// Usage: W=1280|375 PORT=9430..9433 SCRATCH=<owned dir> node capture.mjs   (offline host, memory repository)
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const W = Number(process.env.W || 1280);
if (![1280, 375].includes(W)) throw new Error('W must be 1280 or 375');
const viewport = W === 375 ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const port = Number(process.env.PORT || 0);
if (!(port >= 9430 && port <= 9433)) throw new Error('PORT must be 9430-9433');
if (!process.env.SCRATCH) throw new Error('Set SCRATCH');
const scratch = resolve(process.env.SCRATCH);
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const profile = join(scratch, `chrome-${W}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 300) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
let child; let context; let page; let navs = 0;
const steps = []; const checks = [];
const note = (o) => { steps.push(o); console.log(JSON.stringify(o).slice(0, 400)); };
const check = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), detail }); console.log(`CHECK ${pass ? 'PASS' : 'FAIL'} ${name}`); };

async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: join(scratch, 'tmp'), GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
    GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: KEY, PORT: String(port) };
  child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await appendFile(join(scratch, 'pids.txt'), `${child.pid} host ${port}\n`);
  let out = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`host not ready: ${out.slice(-300)}`)), 90000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) { clearTimeout(t); ok(); } });
    child.once('exit', (c) => { clearTimeout(t); fail(new Error(`host exited ${c}: ${out.slice(-300)}`)); });
  });
}
const chromePids = () => { try { return execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter((l) => l.includes(profile)).map((l) => Number(l.trim().split(/\s+/)[0])); } catch { return []; } };
async function stopAll() {
  for (const pid of chromePids()) await appendFile(join(scratch, 'pids.txt'), `${pid} chrome\n`).catch(() => {});
  await context?.close().catch(() => {});
  for (const pid of chromePids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ }
}
process.on('SIGALRM', () => { stopAll().finally(() => process.exit(124)); });

const until = async (fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await wait(250); } throw new Error(`timeout: ${what}`); };
const btn = (name) => page.getByRole('button', { name, exact: true });
const strip = () => page.locator('.gcsp-presenter-controls');
const shot = async (name) => { await page.screenshot({ path: join(HERE, name), fullPage: false }); note({ shot: name, url: page.url().replace(origin, '') }); };
const active = () => page.evaluate(() => {
  const e = document.activeElement;
  return { tag: e?.tagName, role: e?.getAttribute?.('role') || null, text: (e?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90),
    inStrip: Boolean(e?.closest?.('.gcsp-presenter-controls')), isBody: e === document.body, stripOpen: Boolean(document.querySelector('.gcsp-presenter-controls')?.open),
    scrollY: Math.round(window.scrollY), top: e ? Math.round(e.getBoundingClientRect().top) : null, viewportH: innerHeight };
});
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 30000 });
  if (!(await root.evaluate((el) => el.open ?? true))) await root.locator('summary').first().click();
  await wait(500);
}
const radio = (label, value) => strip().locator(`[role="radiogroup"][aria-label="${label}"] [data-value="${value}"]`);
const bodyOutsideStrip = () => page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('.gcsp-presenter-controls, script, style').forEach((n) => n.remove()); return c.innerText.replace(/\s+/g, ' ').trim().slice(0, 200); });

async function signIn() {
  await page.goto(`${origin}/gcsp-presenter.html`, { waitUntil: 'load', timeout: 60000 }); await wait(1200);
  const key = page.locator('#key');
  if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1800); }
}
// One reset: pick the scenario (and optionally a principal), screenshot the confirmation, confirm, wait for the reloaded page.
async function resetRun(tag, { pickPrincipal } = {}) {
  await openStrip();
  await radio('Scenario', 'main-successful-journey').click();
  if (pickPrincipal) await radio('Acting principal', pickPrincipal).click();
  await btn('Reset scenario').click(); await wait(500);
  const confirmText = await strip().locator('.gcsp-presenter-confirmation .gcsp-note').innerText();
  note({ step: `${tag}-confirm`, confirmText });
  await shot(`${W}-${tag}-confirm-reset.png`);
  const navBefore = navs;
  await btn('Confirm reset').click();
  await until(async () => navs > navBefore, `${tag} navigation`, 60000);
  const doneText = await until(async () => { const t = await strip().locator('[role="status"]').first().innerText(); return /Acting as/.test(t) ? t : null; }, `${tag} reset done status`, 60000);
  await wait(300);
  const focusAtLoad = await active();
  await wait(4000); // The journey or dashboard settles; focus must stay in the strip.
  const focusLater = await active();
  note({ step: `${tag}-after-reset`, doneText, focusAtLoad, focusLater, pageBody: await bodyOutsideStrip() });
  await shot(`${W}-${tag}-after-reset.png`);
  return { confirmText, doneText, focusAtLoad, focusLater };
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport });
  page = context.pages()[0] || await context.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs += 1; });
  page.on('console', (m) => { if (m.type() === 'error') note({ consoleError: clip(m.text(), 200) }); });
  page.on('pageerror', (e) => note({ pageError: clip(e.message, 200) }));
  await signIn();
  const paula = await resetRun('paula');
  check('confirmation names the lead principal', /Reset into Main successful journey as .*Paula.*\? This starts a new run\./.test(paula.confirmText) && !/—/.test(paula.confirmText), paula.confirmText);
  check('status reads Reset done, new run, Acting as Paula', /^Reset done\. New run: \S+\. Acting as .*Paula/.test(paula.doneText), paula.doneText);
  check('focus is on the status in the strip at load', paula.focusAtLoad.inStrip && paula.focusAtLoad.role === 'status' && paula.focusAtLoad.stripOpen, paula.focusAtLoad);
  check('focus still in the strip after the journey settles', paula.focusLater.inStrip && paula.focusLater.role === 'status', paula.focusLater);
  check('page is the employee journey, not the placeholder', !/Choose an acting principal/.test(await bodyOutsideStrip()), await bodyOutsideStrip());
  if (W === 1280) {
    await signIn().catch(() => {});
    const greg = await resetRun('greg', { pickPrincipal: 'demo-greg' });
    check('Greg variant names Greg in the confirmation', /as .*Greg/.test(greg.confirmText), greg.confirmText);
    check('Greg variant status says Acting as Greg', /Acting as .*Greg/.test(greg.doneText), greg.doneText);
    check('Greg variant focus stays on the strip status', greg.focusAtLoad.inStrip && greg.focusAtLoad.role === 'status' && greg.focusLater.inStrip, { load: greg.focusAtLoad, later: greg.focusLater });
  }
}
let failed = false;
try { await main(); } catch (e) { failed = true; note({ error: clip(e.stack, 800) }); check('script completed', false, clip(e.message, 200)); await page?.screenshot({ path: join(HERE, `error-${W}.png`) }).catch(() => {}); }
finally {
  await writeFile(join(HERE, `results-${W}.json`), JSON.stringify({ width: W, viewport, allPass: !failed && checks.every((c) => c.pass), checks, steps }, null, 1));
  await stopAll();
}
process.exit(failed ? 1 : 0);
