// Scratch 1280 walk for FUCQ-354: Paula's screens show UK times with no "UTC" text.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const [, , ROOT, SERVER_DIR] = process.argv;
const KEY = `utc-${Date.now()}`; const out = { steps: [], errors: [] }; let child; const profile = join(ROOT, 'chrome');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const done = () => { try { spawnSync('/usr/bin/pkill', ['-f', `user-data-dir=${profile}`]); } catch {} try { child?.kill('SIGKILL'); } catch {} };
process.on('exit', done);
async function until(fn, ms = 90000, what = 'condition') { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await wait(400); } throw new Error(`timeout: ${what}`); }
const rec = (name, pass, detail) => { out.steps.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` | ${detail}` : ''}`); };
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const origin = `http://127.0.0.1:${port}`;
child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: join(ROOT, 'tmp'),
  GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: KEY, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; await new Promise((ok, fail) => { const t = setTimeout(() => fail(new Error('host timeout ' + log.slice(-300))), 90000);
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { log += d; if (log.includes('GCSP hosted demo')) { clearTimeout(t); ok(); } }); child.once('exit', (c) => fail(new Error(`host exit ${c} ${log.slice(-300)}`))); });
const ctx = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport: { width: 1280, height: 900 } });
const P = await ctx.newPage(); P.on('pageerror', (e) => out.errors.push(`presenter: ${e.message}`));
const timeLines = (t) => (t.match(/[^\n]*\b\d{1,2} \w{3} \d{4}, \d\d:\d\d[^\n]*|[^\n]*Respond by[^\n]*|[^\n]*Last check[^\n]*/g) || []).slice(0, 6);
async function look(E, name, shot) {
  await wait(2500);
  const text = await E.evaluate(() => document.body.innerText);
  const utc = text.match(/[^\n]*UTC[^\n]*/g) || [];
  rec(`${name}: no UTC text`, utc.length === 0, `url=${E.url().replace(origin, '').replace(/\?.*/, '')} utc=${JSON.stringify(utc)} times=${JSON.stringify(timeLines(text))}`);
  if (shot) await E.screenshot({ path: join(ROOT, 'shots', shot), fullPage: true });
  return text;
}
try {
  const E = await ctx.newPage(); E.on('pageerror', (e) => out.errors.push(`paula: ${e.message}`));
  await P.goto(`${origin}/gcsp-presenter.html`);
  const consoleRoot = P.locator('.gcsp-console'); await consoleRoot.waitFor({ timeout: 90000 });
  const relBtn = () => P.getByRole('button', { name: /^Release /, exact: false }).first();
  await P.getByRole('button', { name: 'Start again' }).first().click(); await P.getByRole('alertdialog').getByRole('button', { name: 'Start again' }).click();
  await until(async () => !(await relBtn().isDisabled().catch(() => true)), 120000, 'release enabled after start again');
  await E.goto(`${origin}/gcsp/login`); await E.getByLabel('Email address').fill('paula.mason@gcsp-demo.com'); await E.getByLabel('Password').fill('fucq');
  await E.getByRole('button', { name: 'Sign in' }).click(); await E.waitForURL((u) => !/login/.test(String(u)), { timeout: 60000 });
  await E.goto(`${origin}/gcsp-account.html`); await look(E, 'Your cars (account)', '1-account.png');
  await E.goto(`${origin}/gcsp-activity-live.html`); await look(E, 'Buddy activity before release', null);
  await P.bringToFront(); await P.reload({ waitUntil: 'load' }); await consoleRoot.waitFor({ timeout: 90000 });
  await until(async () => !(await relBtn().isDisabled().catch(() => true)), 120000, 'release enabled after reload');
  const before = await relBtn().innerText(); await relBtn().click();
  await until(async () => { const t = await relBtn().innerText().catch(() => ''); return !(await relBtn().isDisabled().catch(() => true)) && t !== before ? t : null; }, 240000, 'release done').catch(() => null);
  await E.bringToFront(); await E.goto(`${origin}/gcsp-activity-live.html`);
  await until(() => E.evaluate(() => /Respond by/.test(document.body.innerText)), 60000, 'offer on activity').catch(() => null);
  await look(E, 'Buddy activity with offer', '2-activity.png');
  await E.locator('.gcsp-bell-btn').click(); await wait(500);
  const panel = await E.evaluate(() => document.querySelector('.gcsp-bell-panel')?.innerText.replace(/\s+/g, ' ') ?? '');
  rec('bell panel: Respond by, no UTC', /Respond by \d\d:\d\d/.test(panel) && !/UTC/.test(panel), panel.slice(0, 200));
  await E.screenshot({ path: join(ROOT, 'shots', '3-bell.png') }); await E.keyboard.press('Escape');
  const href = await E.evaluate(() => [...document.querySelectorAll('a[href*="/gcsp/offer"]')][0]?.getAttribute('href')); await E.goto(`${origin}${href}`); await E.waitForURL(/gcsp\/offer/, { timeout: 60000 });
  await look(E, 'Offer', '4-offer.png');
  await E.goto(`${origin}/gcsp-order-progress-live.html`); await look(E, 'Order progress', '5-order-progress.png');
  await E.goto(`${origin}/gcsp-help.html`); await look(E, 'Renewal help', null);
  await E.goto(`${origin}/gcsp-manual-gallery.html`); await look(E, 'Released cars (manual gallery)', '6-gallery.png');
  const text = await E.evaluate(() => document.body.innerText);
  rec('no em dashes on last screen', !text.includes('\u2014'));
} catch (e) { rec('run', false, e.message); }
out.errors.length ? rec('no page errors', false, out.errors.join(' ; ')) : rec('no page errors', true);
await writeFile(join(ROOT, 'result.json'), JSON.stringify(out, null, 2));
await ctx.close(); child.kill('SIGTERM'); await wait(1000); done(); process.exit(0);
