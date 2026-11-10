// Scratch live check for FUCQ-375: presenter tab ticks, Paula's tab bell updates without reload.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const [, , ROOT, SERVER_DIR] = process.argv;
const KEY = `bell-${Date.now()}`; const out = { steps: [], errors: [] }; let child; const profile = join(ROOT, 'chrome');
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
try {
  const E = await ctx.newPage(); E.on('pageerror', (e) => out.errors.push(`paula: ${e.message}`));
  await P.goto(`${origin}/gcsp-presenter.html`);
  const consoleRoot = P.locator('.gcsp-console'); await consoleRoot.waitFor({ timeout: 90000 });
  const relBtn = () => P.getByRole('button', { name: /^Release /, exact: false }).first();
  await P.getByRole('button', { name: 'Start again' }).first().click(); await P.getByRole('alertdialog').getByRole('button', { name: 'Start again' }).click();
  await until(async () => !(await relBtn().isDisabled().catch(() => true)), 120000, 'release enabled after start again');
  await E.goto(`${origin}/gcsp/login`); await E.getByLabel('Email address').fill('paula.mason@gcsp-demo.com'); await E.getByLabel('Password').fill('fucq');
  await E.getByRole('button', { name: 'Sign in' }).click(); await E.waitForURL((u) => !/login/.test(String(u)), { timeout: 60000 });
  rec('signed in as Paula; console started again', true, `release label=${await relBtn().innerText()}`);
  for (const path of ['/gcsp-account.html', '/gcsp-activity-live.html', '/gcsp-order-progress-live.html', '/gcsp-help.html', '/gcsp-brief-live.html']) {
    await E.goto(`${origin}${path}`, { waitUntil: 'load' });
    const label = await until(() => E.evaluate(() => document.querySelector('.gcsp-bell')?.dataset.status === 'ok' && document.querySelector('.gcsp-bell-btn')?.getAttribute('aria-label')), 60000, `bell on ${path}`).catch(() => null);
    const ok = Boolean(label);
    const leftOfAccount = ok && await E.evaluate(() => { const b = document.querySelector('.gcsp-bell'); const a = document.querySelector('.gcsp-account'); return b && a && b.getBoundingClientRect().right <= a.getBoundingClientRect().left + 1; });
    rec(`bell on ${path}`, ok && leftOfAccount && label === 'Notifications, none waiting', `url=${E.url().replace(origin, '')} label=${label} leftOfAccount=${leftOfAccount}`);
  }
  await E.screenshot({ path: join(ROOT, 'shots', '1-searching.png') });
  // Frame 2: Next release in the presenter tab; Paula's tab must update without reload.
  const navs = []; E.on('framenavigated', (f) => { if (f === E.mainFrame()) navs.push(f.url()); });
  await P.bringToFront(); await P.reload({ waitUntil: 'load' }); await consoleRoot.waitFor({ timeout: 90000 });
  await until(async () => !(await relBtn().isDisabled().catch(() => true)), 120000, 'release enabled after reload');
  const relLabel = await relBtn().innerText(); await relBtn().click();
  const before = relLabel; await until(async () => { const t = await relBtn().innerText().catch(() => ''); return !(await relBtn().isDisabled().catch(() => true)) && t !== before ? t : null; }, 240000, 'release done').catch(() => null);
  console.log('CONSOLE AFTER:', (await consoleRoot.innerText()).replace(/\s+/g, ' ').slice(0, 400));
  console.log('RELEASED via', relLabel);
  const t0 = Date.now();
  const badge = await until(async () => E.evaluate(() => { const b = document.querySelector('.gcsp-bell-badge'); return b && !b.hidden ? b.textContent : null; }), 45000, 'badge').catch(() => null);
  const note = await E.evaluate(() => { const n = document.querySelector('.gcsp-bell-note'); return n && !n.hidden ? n.innerText.replace(/\s+/g, ' ') : null; });
  const label2 = await E.evaluate(() => document.querySelector('.gcsp-bell-btn')?.getAttribute('aria-label'));
  const live = await E.evaluate(() => [...document.querySelectorAll('.gcsp-bell [aria-live], .gcsp-bell [role=status]')].map((n) => n.textContent).join(' | '));
  rec('badge appears without reload', badge === '1' && navs.length === 0, `badge=${badge} after ${Date.now() - t0}ms navigations=${navs.length} label=${label2}`);
  rec('note shown and announced', Boolean(note) && /Your buddy found a car/.test(live), `note=${note} live=${live}`);
  await E.bringToFront(); await E.screenshot({ path: join(ROOT, 'shots', '2-note.png') });
  // Frame 3: open by keyboard, check panel, Escape returns focus.
  await E.locator('.gcsp-bell-btn').focus(); await E.keyboard.press('Enter');
  const panel = await E.evaluate(() => { const p = document.querySelector('.gcsp-bell-panel'); const b = document.querySelector('.gcsp-bell-btn'); return { open: !p.hidden, expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls') === p.id, text: p.innerText.replace(/\s+/g, ' ').slice(0, 400), thumb: Boolean(p.querySelector('.gcsp-bell-thumb')?.naturalWidth) }; });
  rec('panel opens with offer row', panel.open && panel.expanded === 'true' && panel.controls && /Your buddy found a car/.test(panel.text) && /View your offer/.test(panel.text) && /Respond by \d\d:\d\d/.test(panel.text), JSON.stringify(panel));
  await E.screenshot({ path: join(ROOT, 'shots', '3-open.png') });
  await E.keyboard.press('Escape');
  const esc = await E.evaluate(() => ({ hidden: document.querySelector('.gcsp-bell-panel').hidden, focus: document.activeElement?.classList.contains('gcsp-bell-btn') }));
  rec('Escape closes and returns focus', esc.hidden && esc.focus, JSON.stringify(esc));
  // Mutual close with the account menu.
  await E.locator('.gcsp-bell-btn').click(); await E.locator('.gcsp-account-summary').click();
  const mutual = await E.evaluate(() => ({ bellHidden: document.querySelector('.gcsp-bell-panel').hidden, accountOpen: document.querySelector('.gcsp-account-details')?.open }));
  await E.locator('.gcsp-bell-btn').click();
  const mutual2 = await E.evaluate(() => ({ bellOpen: !document.querySelector('.gcsp-bell-panel').hidden, accountOpen: document.querySelector('.gcsp-account-details')?.open }));
  rec('bell and account menu close each other', mutual.bellHidden && mutual.accountOpen && mutual2.bellOpen && !mutual2.accountOpen, JSON.stringify({ mutual, mutual2 }));
  // Frame 4: View your offer; badge still shown on the offer page.
  await E.locator('.gcsp-bell-panel a', { hasText: 'View your offer' }).click(); await E.waitForURL(/gcsp\/offer/, { timeout: 60000 });
  const offerBadge = await until(async () => E.evaluate(() => { const b = document.querySelector('.gcsp-bell-badge'); return b && !b.hidden ? b.textContent : null; }), 30000, 'offer badge').catch(() => null);
  rec('offer page keeps the badge', offerBadge === '1', `url=${E.url().replace(/\?.*/, '')} badge=${offerBadge}`);
  await E.screenshot({ path: join(ROOT, 'shots', '4-offer.png') });
  const text = await E.evaluate(() => document.body.innerText);
  rec('no em dashes on screen', !text.includes('\u2014'));
} catch (e) { rec('run', false, e.message); }
out.errors.length ? rec('no page errors', false, out.errors.join(' ; ')) : rec('no page errors', true);
await writeFile(join(ROOT, 'result.json'), JSON.stringify(out, null, 2));
await ctx.close(); child.kill('SIGTERM'); await wait(1000); done(); process.exit(0);
