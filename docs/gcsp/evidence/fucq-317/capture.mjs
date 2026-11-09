// FUCQ-317 browser evidence: an unrequested handover is not the current step. Offline host, memory repository.
// Usage: PHASE=before|after W=1280|375 PORT=9500..9504 SCRATCH=<owned dir> node capture.mjs
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
if (!(port >= 9500 && port <= 9504)) throw new Error('PORT must be 9500-9504');
const PHASE = process.env.PHASE;
if (!['before', 'after'].includes(PHASE)) throw new Error('PHASE must be before or after');
const scratch = resolve(process.env.SCRATCH || '');
if (!process.env.SCRATCH || scratch === '/') throw new Error('Set SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const profile = join(scratch, `chrome-${W}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 400) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
let child; let context; let page; let navs = 0;
const steps = []; const checks = []; let stepsText = null;
const note = (o) => { steps.push(o); console.log(JSON.stringify(o).slice(0, 300)); };
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
// Chrome PIDs are found by this run's own profile path, recorded in pids.txt, then killed by PID.
const chromePids = () => { try { return execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter((l) => l.includes(profile)).map((l) => Number(l.trim().split(/\s+/)[0])); } catch { return []; } };
async function stopAll() {
  const pids = chromePids();
  for (const pid of pids) await appendFile(join(scratch, 'pids.txt'), `${pid} chrome\n`).catch(() => {});
  await context?.close().catch(() => {});
  for (const pid of chromePids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ }
}
process.on('SIGALRM', () => { stopAll().finally(() => process.exit(124)); });

const text = () => page.locator('body').innerText().catch(() => '');
const go = async (path) => { await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(1200); await watch(); };
const until = async (fn, what, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await wait(250); } throw new Error(`timed out: ${what}`); };
const btn = (name, exact = true) => page.getByRole('button', { name, exact });
const strip = () => page.locator('.gcsp-presenter-controls');
const shot = async (name) => { await page.screenshot({ path: join(HERE, name), fullPage: false }); note({ shot: name, url: page.url().replace(origin, '') }); };
const closeStrip = () => page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 30000 });
  if (!(await root.evaluate((el) => el.open ?? true))) await root.locator('summary').first().click();
  await wait(500);
}
async function press(name) {
  await openStrip();
  const b = strip().getByRole('button', { name }).first();
  await b.scrollIntoViewIfNeeded();
  const y0 = await page.evaluate(() => scrollY);
  await b.click({ timeout: 30000 });
  for (let i = 0; i < 120; i += 1) { await wait(400); if (!/Action in progress/.test(await strip().innerText().catch(() => ''))) break; }
  return y0;
}
// Install a mutation log of non-empty live-region writes outside the strip; read and clear it per step.
const watch = () => page.evaluate(() => {
  window.__ann = []; window.__scrollLog = []; window.__repl = [];
  window.addEventListener('scroll', () => window.__scrollLog.push(Math.round(window.scrollY)));
  new MutationObserver((records) => {
    for (const r of records) if (r.removedNodes.length && r.addedNodes.length && r.target.nodeType === 1) window.__repl.push(`${r.target.tagName.toLowerCase()}.${String(r.target.className).slice(0, 40)} h=${Math.round(document.documentElement.scrollHeight)}`);
    for (const r of records) for (const n of r.addedNodes) {
      const el = n.nodeType === 3 ? n.parentElement : n; const live = el?.closest?.('[aria-live]');
      if (live && !live.closest('.gcsp-presenter-controls') && n.textContent.trim()) window.__ann.push(n.textContent.trim());
    }
  }).observe(document.body, { childList: true, subtree: true });
});
const scrollLog = () => page.evaluate(() => { const o = { scrolls: window.__scrollLog.slice(0, 12), replaced: [...new Set(window.__repl)].slice(0, 8) }; window.__scrollLog = []; window.__repl = []; return o; });
const anns = () => page.evaluate(() => { const a = window.__ann || []; window.__ann = []; return a; });
const liveText = () => page.evaluate(() => [...document.querySelectorAll('[aria-live]')].filter((e) => !e.closest('.gcsp-presenter-controls')).map((e) => e.textContent.trim()).filter(Boolean));
const active = () => page.evaluate(() => {
  const e = document.activeElement;
  return { tag: e?.tagName, name: (e?.getAttribute?.('aria-label') || e?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50), inStrip: Boolean(e?.closest?.('.gcsp-presenter-controls')), isBody: e === document.body || !e };
});
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
// Text of the page body outside the strip, the thing that must change after an action.
const pageBody = () => page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('.gcsp-presenter-controls, script, style').forEach((n) => n.remove()); return c.innerText.replace(/\s+/g, ' ').trim(); });
const stageText = () => page.evaluate(() => { const c = (document.querySelector('main') || document.body).cloneNode(true); c.querySelectorAll('.gcsp-presenter-controls, [aria-live], script, style').forEach((n) => n.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim(); });

async function resetAndSwitch() {
  await openStrip();
  await strip().locator('button', { hasText: 'Main successful journey' }).first().click();
  await btn('Reset scenario').click(); await wait(600);
  await btn('Confirm reset').click();
  await until(async () => !/Action in progress/.test(await strip().innerText()), 'reset done', 60000);
  await wait(1500);
  const cont = btn('Continue to workspace'); if (await cont.isVisible().catch(() => false)) { await cont.click(); await wait(1500); }
  if (await btn('Reload').isVisible().catch(() => false)) { await page.reload(); await wait(2000); }
  await openStrip();
  await strip().locator('button', { hasText: 'Paula (fictional)' }).first().click();
  await btn('Switch principal').click();
  await until(async () => !/Action in progress/.test(await strip().innerText()), 'switch done', 60000);
  await wait(2500);
  if (await btn('Reload').isVisible().catch(() => false)) { await page.reload(); await wait(2500); }
}
async function signIn() {
  await go('/gcsp-presenter.html');
  const key = page.locator('#key');
  if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1500); }
}

// Waits for the strip's "Action in progress" to appear and clear.
async function settleStrip() {
  await wait(300);
  for (let i = 0; i < 120; i += 1) { if (!/Action in progress/.test(await strip().innerText().catch(() => ''))) break; await wait(400); }
}
// 'near': scroll so the strip button is on screen and click it. 'deep': scroll into the page content, focus a control there, click the strip button in the DOM.
async function act(mode, getButton, before = async () => {}, focus = 'auto') {
  await openStrip();
  const b = getButton();
  await before();
  let prep = null;
  if (mode === 'near') {
    await b.evaluate((el) => { const top = el.getBoundingClientRect().top + window.scrollY; window.scrollTo(0, Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, top - 60))); });
  } else {
    prep = await page.evaluate((focusMode) => {
      const sec = document.querySelector('.gcsp-order-section, .gcsp-activity'); const y = sec ? Math.round(sec.getBoundingClientRect().top + window.scrollY - 10) : 0;
      const max = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, Math.max(0, Math.min(max, y + 120)));
      const inView = (e) => { const r = e.getBoundingClientRect(); return r.top > 0 && r.bottom < innerHeight && r.width > 0; };
      const ctl = [...document.querySelectorAll('main button:not(:disabled), main a[href], main summary')].filter((e) => !e.closest('.gcsp-presenter-controls') && e.getBoundingClientRect().width > 0);
      let c = focusMode === 'heading' ? null : ctl.find(inView) || ctl[0]; if (c && !inView(c)) c.scrollIntoView({ block: 'center' });
      let kind = 'control'; if (focusMode !== 'heading' && !c) document.activeElement?.blur();
      if (!c && focusMode === 'heading') { c = [...document.querySelectorAll('main h1, main h2, main h3')].find((e) => !e.closest('.gcsp-presenter-controls') && inView(e)); if (c) { c.tabIndex = -1; kind = 'heading'; } }
      c?.focus(); return { max: Math.round(max), kind: c ? kind : null, focused: c ? (c.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) : null };
    }, focus);
  }
  const y0 = await scrollY(); const focusBefore = await active();
  if (mode === 'near') await b.click({ timeout: 30000 }); else await b.evaluate((el) => el.click());
  await settleStrip();
  return { mode, prep, scrollBefore: y0, focusBefore };
}
// Collapses the strip and shows the top of the page for the evidence picture (after all measurements).
async function showPage(name, heading) {
  await page.evaluate((h) => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; window.scrollTo(0, 0);
    const t = h && [...document.querySelectorAll('main h2, main h3')].find((e) => e.textContent.trim() === h); t?.scrollIntoView({ block: 'start' }); }, heading || null);
  await wait(400); await shot(name);
}
const diffAt = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i += 1; return a === b ? null : { at: i, was: a.slice(Math.max(0, i - 40), i + 80), now: b.slice(Math.max(0, i - 40), i + 80) }; };
const mainHtml = () => page.evaluate(() => (document.querySelector('main') || document.body).innerHTML.replace(/\s+/g, ' '));

async function acceptOffer() {
  const link = page.getByRole('link', { name: /View offer|Open the offer/i }).first();
  await link.focus(); await page.keyboard.press('Enter'); await wait(2500);
  note({ step: 'offer-page', url: page.url().replace(origin, '') });
  const boxes = page.locator('input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await page.keyboard.press('Space'); }
  const acc = btn(/^Accept/, false).first(); await acc.focus(); await page.keyboard.press('Enter'); await wait(2500);
  note({ step: 'accepted', h1: await page.locator('h1').first().innerText().catch(() => '') });
}


async function releaseOffer() {
  await go('/gcsp-activity-live.html'); await closeStrip(); await wait(500);
  await act('near', () => strip().getByRole('button', { name: 'Next release' }).first());
  await until(async () => (await page.getByRole('link', { name: /View offer|Open the offer/i }).count()) > 0, 'offer released', 20000);
}

const tick = () => strip().getByRole('button', { name: /^Tick \(/ }).first();
// What the Steps list, slot pickers and documents lists look like right now, read from the DOM.
const probe = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.gcsp-stage-tracker li.gcsp-stage')].map((r) => ({ label: r.querySelector('.gcsp-stage-label')?.textContent, state: r.querySelector('.gcsp-stage-state')?.textContent,
    next: r.querySelector('.gcsp-stage-next')?.textContent ?? null, note: r.querySelector('.gcsp-stage-note')?.textContent ?? null }));
  const pickers = [...document.querySelectorAll('.gcsp-slot-picker')].map((p) => ({ section: p.closest('.gcsp-order-section')?.className.split(' ').pop(), days: [...p.querySelectorAll(':scope > .gcsp-slot-day')].map((d) => {
    const bs = [...d.querySelectorAll('button')]; return { heading: d.querySelector('.gcsp-slot-day-heading').textContent, times: bs.map((b) => b.textContent), rowTops: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)))].length,
      label0: bs[0]?.getAttribute('aria-label'), perRowFirstTwoSame: bs.length > 1 ? Math.round(bs[0].getBoundingClientRect().top) === Math.round(bs[1].getBoundingClientRect().top) : null }; }) }));
  const todo = [...document.querySelectorAll('.gcsp-order-todo')].map((g) => ({ title: g.querySelector('.gcsp-order-todo-title').textContent, items: [...g.querySelectorAll('li')].map((l) => l.textContent) }));
  const docs = document.querySelector('.gcsp-order-documents .gcsp-order-statement')?.textContent ?? null;
  return { rows, pickers, todo, docs, nextCount: document.querySelectorAll('.gcsp-stage-next').length, overflowX: document.documentElement.scrollWidth > innerWidth };
});

async function orderPart() {
  await go('/gcsp-order-progress-live.html'); await wait(1000); await closeStrip(); await wait(300);
  for (let i = 1; i <= 6; i += 1) { await act('near', tick); await wait(500); }
  await until(async () => /Choose a handover slot/.test(await stageText()), 'handover open', 20000);
  const A = await probe(); note({ step: 'A-not-requested', ...A });
  await showPage(`${PHASE}-${W}-A.png`, 'Steps');
  const h = A.rows.at(-2);
  check('A: handover not started, owner and single Next, no Current step', h.state === 'Not started' && A.nextCount === 1 && /Choose a handover slot/.test(h.next ?? '') && !A.rows.some((r) => r.state === 'Current step'), A.rows);
  const first = page.getByRole('button', { name: /^Request \d/ }).first();
  await first.scrollIntoViewIfNeeded(); await first.focus(); await page.keyboard.press('Enter');
  await until(async () => /Not booked yet/.test(await stageText()), 'slot requested', 20000); await wait(600);
  const B = await probe(); note({ step: 'B-requested', ...B });
  await showPage(`${PHASE}-${W}-B.png`, 'Steps');
  check('B: requested handover is current with one Next', B.rows.at(-2).state === 'Current step' && B.nextCount === 1, B.rows);
  await openStrip();
  await strip().locator('input[type=text]').first().fill('2026-11-05T10:07:00.000Z');
  await act('near', () => strip().getByRole('button', { name: 'Tick to target' }).first());
  await until(async () => /Booked:/.test(await stageText()), 'handover booked', 30000); await wait(800);
  const C = await probe(); note({ step: 'C-booked', ...C });
  await showPage(`${PHASE}-${W}-C.png`, 'Steps');
  check('C: handover done, Ready current, one Next', C.rows.at(-2).state === 'Done' && C.rows.at(-1).state === 'Current step' && C.nextCount === 1, C.rows);
  check('no horizontal overflow', !A.overflowX && !B.overflowX && !C.overflowX, null);
  stepsText = { A: A.rows, B: B.rows, C: C.rows };
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport, reducedMotion: 'no-preference' });
  page = context.pages()[0] || await context.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs += 1; });
  page.on('console', (m) => { if (m.type() === 'error') note({ consoleError: clip(m.text(), 200), at: page.url().replace(origin, '') }); });
  page.on('pageerror', (e) => note({ pageError: clip(e.message, 200) }));
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) note({ failed: `${r.status()} ${r.request().method()} ${r.url().replace(origin, '')}` }); });
  await signIn();
  await resetAndSwitch(); await closeStrip();
  await releaseOffer();
  await acceptOffer();
  await orderPart();
}
let failed = false;
try { await main(); } catch (e) { failed = true; note({ error: clip(e.stack, 800) }); check('script completed', false, clip(e.message, 200)); await page?.screenshot({ path: join(HERE, `error-${W}.png`) }).catch(() => {}); }
finally {
  await writeFile(join(HERE, `results-${PHASE}-${W}.json`), JSON.stringify({ phase: PHASE, width: W, viewport, stepsText, allPass: !failed && checks.every((c) => c.pass), checks, steps }, null, 1));
  await stopAll();
}
process.exit(failed ? 1 : 0);
