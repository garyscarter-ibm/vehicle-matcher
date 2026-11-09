// FUCQ-292 browser evidence: pages update after presenter strip actions, no reload. Offline host, memory repository.
// Usage: W=1280|375 PORT=9350..9359 SCRATCH=<owned dir> node capture.mjs
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
if (!(port >= 9350 && port <= 9359)) throw new Error('PORT must be 9350-9359');
const scratch = resolve(process.env.SCRATCH || '');
if (!process.env.SCRATCH || scratch === '/') throw new Error('Set SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const profile = join(scratch, `chrome-${W}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 400) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
let child; let context; let page; let navs = 0;
const steps = []; const checks = [];
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

async function activityPart() {
  await go('/gcsp-activity-live.html'); await closeStrip(); await wait(500);
  const before = { url: page.url(), text: clip(await stageText(), 500), focus: await active(), navs, offerLinks: await page.getByRole('link', { name: /View offer|Open the offer/i }).count() };
  note({ step: 'activity-before', ...before });
  await shot(`activity-${W}-01-before-release.png`);
  const navBefore = navs; const urlBefore = page.url(); await anns();
  const a = await act('deep', () => strip().getByRole('button', { name: 'Next release' }).first());
  const changed = await until(async () => (await page.getByRole('link', { name: /View offer|Open the offer/i }).count()) > 0, 'activity shows offer', 15000).then(() => true, () => false);
  await wait(800);
  const announce = await anns(); const bodyText = await stageText();
  const r = { step: 'activity-after-release', ...a, scrollAfter: await scrollY(), changed, urlBefore: urlBefore.replace(origin, ''), urlAfter: page.url().replace(origin, ''), navBefore, navAfter: navs, announcements: announce, liveRegion: await liveText(), focusAfter: await active(), text: clip(bodyText, 600), noOfferStale: /No current offer/.test(bodyText) };
  note(r);
  await showPage(`activity-${W}-02-after-release-no-reload.png`);
  check('activity updated without reload', changed && !r.noOfferStale && r.urlBefore === r.urlAfter && navBefore === navs, { changed, stale: r.noOfferStale, nav: [navBefore, navs] });
  check('activity focus kept, not lost to body', !r.focusAfter.isBody && (!a.prep?.focused || r.focusAfter.name.startsWith(a.focusBefore.name.slice(0, 20))), { before: a.focusBefore, after: r.focusAfter });
  check('activity scroll stayed within 40 px', Math.abs(r.scrollAfter - a.scrollBefore) <= 40, { before: a.scrollBefore, after: r.scrollAfter, max: a.prep?.max });
  check('activity announcement present once', announce.length === 1 && announce[0] === 'Activity updated.', announce);
}

async function acceptOffer() {
  const link = page.getByRole('link', { name: /View offer|Open the offer/i }).first();
  await link.focus(); await page.keyboard.press('Enter'); await wait(2500);
  note({ step: 'offer-page', url: page.url().replace(origin, '') });
  const boxes = page.locator('input[type="checkbox"]');
  for (let i = 0; i < await boxes.count(); i += 1) { await boxes.nth(i).focus(); await page.keyboard.press('Space'); }
  const acc = btn(/^Accept/, false).first(); await acc.focus(); await page.keyboard.press('Enter'); await wait(2500);
  note({ step: 'accepted', h1: await page.locator('h1').first().innerText().catch(() => '') });
}

let truth;
const latestApi = {};
const jdiff = (a, b, p = '', out = []) => { if (out.length > 6) return out; if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) jdiff(a[k], b[k], `${p}.${k}`, out); } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: p, was: JSON.stringify(a)?.slice(0, 60), now: JSON.stringify(b)?.slice(0, 60) }); return out; };
const apiDiff = (a, b) => { const out = {}; for (const k of Object.keys(b)) { let d = []; try { d = jdiff(JSON.parse(a[k] || 'null'), JSON.parse(b[k] || 'null')); } catch { d = ['parse']; } if (d.length) out[k] = d; } return out; };
const truthText = async () => { await truth.reload({ waitUntil: 'load' }); await truth.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(700); return truth.evaluate(() => { const c = (document.querySelector('main') || document.body).cloneNode(true); c.querySelectorAll('.gcsp-presenter-controls, [aria-live], script, style').forEach((n) => n.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim(); }); };

async function orderPart() {
  await go('/gcsp-order-progress-live.html'); await wait(1000); await closeStrip(); await wait(300);
  truth = await context.newPage(); await truth.goto(`${origin}/gcsp-order-progress-live.html`, { waitUntil: 'load' }); await wait(1500);
  note({ step: 'order-controls', controls: await page.evaluate(() => [...document.querySelectorAll('main button, main a[href], main summary')].filter((e) => !e.closest('.gcsp-presenter-controls')).map((e) => `${e.tagName}:${(e.textContent || '').trim().slice(0, 30)}`)) });
  note({ step: 'order-accepted', stage: clip(await stageText(), 700), navs });
  await showPage(`order-${W}-01-accepted.png`, 'Steps');
  const recs = []; const urlStart = page.url(); const navStart = navs;
  // One strip action on the order page, then wait up to 15 s for the page to match a fresh read of the same order.
  const step = async (label, mode, getButton, { before, serverCompare = true, shotName, focus } = {}) => {
    const text0 = await stageText(); const html0 = await mainHtml(); const truth0 = serverCompare ? await truthText() : null; await anns(); await scrollLog(); const api0 = { ...latestApi };
    const a = await act(mode, getButton, before, focus);
    let matches = !serverCompare; let truth1 = null;
    for (let i = 0; i < 15 && !matches; i += 1) { truth1 = await truthText(); matches = (await stageText()) === truth1; if (!matches) await wait(500); }
    if (!serverCompare) await until(async () => (await stageText()) !== text0, `${label} page changed`, 15000).catch(() => {});
    await wait(800);
    const text1 = await stageText(); const html1 = await mainHtml();
    const rec = { step: label, ...a, scrollAfter: await scrollY(), scrollTrace: await scrollLog(), apiDiff: apiDiff(api0, latestApi), visibleChanged: text1 !== text0, htmlChanged: html1 !== html0, htmlDiff: text1 === text0 ? diffAt(html0, html1) : null,
      serverChanged: serverCompare ? truth0 !== truth1 : null, matchesServer: serverCompare ? matches : null, announcements: await anns(), liveRegion: await liveText(), focusAfter: await active(), stage: clip(text1, 450), url: page.url().replace(origin, ''), navs };
    recs.push(rec); note(rec);
    if (shotName) await showPage(shotName, label === 'tick-to-target' ? 'Handover' : 'Steps');
    return rec;
  };
  const tick = () => strip().getByRole('button', { name: /^Tick \(/ }).first();
  for (let i = 1; i <= 6; i += 1) await step(`tick-${i}`, i <= 2 ? 'near' : 'deep', tick, { focus: i === 6 ? 'heading' : 'auto', shotName: i === 1 ? `order-${W}-02-tick1.png` : i === 6 ? `order-${W}-03-approvals-done.png` : null });
  // Handover: request a slot on the page itself, then tick to the target that books it.
  const slots = await page.getByRole('button', { name: /^Request \d/ }).allInnerTexts().catch(() => []);
  note({ step: 'slots', slots });
  let slotRec = null; let booked = null;
  if (slots.length) {
    const slot = page.getByRole('button', { name: /^Request \d/ }).first();
    const text0 = await stageText(); await anns();
    await slot.scrollIntoViewIfNeeded(); await slot.focus(); const y0 = await scrollY(); await page.keyboard.press('Enter');
    await until(async () => (await stageText()) !== text0, 'slot requested', 15000).catch(() => {}); await wait(800);
    slotRec = { step: 'request-slot', mode: 'in-page', scrollBefore: y0, scrollAfter: await scrollY(), visibleChanged: (await stageText()) !== text0, announcements: await anns(), liveRegion: await liveText(), focusAfter: await active(), stage: clip(await stageText(), 450) };
    recs.push(slotRec); note(slotRec);
    booked = await step('tick-to-target', 'deep', () => strip().getByRole('button', { name: 'Tick to target' }).first(), {
      before: async () => { const f = strip().locator('input[type=text]').first(); await f.fill('2026-11-05T10:07:00.000Z'); }, shotName: `order-${W}-04-handover-booked.png` });
  }
  const t6 = recs.filter((t) => /^tick-\d$/.test(t.step));
  const notes = (arr) => arr.map((t) => ({ step: t.step, mode: t.mode, visibleChanged: t.visibleChanged, serverChanged: t.serverChanged, matchesServer: t.matchesServer, ann: t.announcements }));
  const advanced = t6.length === 6 && t6.every((t) => t.matchesServer && (t.visibleChanged || !t.serverChanged)) && t6.filter((t) => t.visibleChanged).length >= 4 && /Choose a handover time/.test(t6[5].stage + (t6[5].liveRegion || ''));
  check('order progress advanced on every Tick without reload', advanced && page.url() === urlStart && navs === navStart, notes(t6));
  check('order handover booked without reload', Boolean(booked?.matchesServer) && /Booked:/.test(booked?.stage || ''), { slots, stage: booked?.stage });
  const movers = recs.filter((t) => t.scrollBefore !== undefined && t.step !== 'tick-6');
  const probe = recs.find((t) => t.step === 'tick-6');
  check('scroll stayed within 40 px', movers.every((t) => Math.abs(t.scrollAfter - t.scrollBefore) <= 40), movers.map((t) => ({ step: t.step, mode: t.mode, y: [t.scrollBefore, t.scrollAfter] })));
  check('order focus not lost to body', movers.every((t) => !t.focusAfter.isBody || t.focusBefore?.isBody), movers.map((t) => ({ step: t.step, before: t.focusBefore?.name, after: t.focusAfter.name, body: t.focusAfter.isBody })));
  check('observation: focus on a heading inside the order body keeps scroll', Math.abs(probe.scrollAfter - probe.scrollBefore) <= 40, { before: probe.focusBefore.name, after: probe.focusAfter.name, y: [probe.scrollBefore, probe.scrollAfter] });
  const synced = recs.filter((t) => t.visibleChanged && t.matchesServer !== undefined && t.step !== 'request-slot');
  check('order announcement once per changed read', synced.length > 0 && synced.every((t) => t.announcements.length === 1 && t.announcements[0] === 'Order progress updated.'), synced.map((t) => ({ step: t.step, ann: t.announcements })));
  const quiet = recs.filter((t) => !t.visibleChanged && t.matchesServer !== undefined);
  check('observation: no announcement when only the clock moved', quiet.every((t) => t.announcements.length === 0), quiet.map((t) => ({ step: t.step, ann: t.announcements, htmlChanged: t.htmlChanged, htmlDiff: t.htmlDiff })));
  await truth.close().catch(() => {});
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport, reducedMotion: 'no-preference' });
  page = context.pages()[0] || await context.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs += 1; });
  page.on('console', (m) => { if (m.type() === 'error') note({ consoleError: clip(m.text(), 200), at: page.url().replace(origin, '') }); });
  page.on('pageerror', (e) => note({ pageError: clip(e.message, 200) }));
  page.on('response', async (r) => { if (r.request().method() === 'GET' && /\/api\/gcsp\/(orders\/progress|documents|appointments|return-plan)(\?|$)/.test(r.url())) latestApi[r.url().replace(origin, '').split('?')[0]] = await r.text().catch(() => ''); });
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) note({ failed: `${r.status()} ${r.request().method()} ${r.url().replace(origin, '')}` }); });
  await signIn();
  await resetAndSwitch(); await closeStrip();
  await activityPart();
  await acceptOffer();
  await orderPart();
}
let failed = false;
try { await main(); } catch (e) { failed = true; note({ error: clip(e.stack, 800) }); check('script completed', false, clip(e.message, 200)); await page?.screenshot({ path: join(HERE, `error-${W}.png`) }).catch(() => {}); }
finally {
  await writeFile(join(HERE, `results-${W}.json`), JSON.stringify({ width: W, viewport, allPass: !failed && checks.every((c) => c.pass), checks, steps }, null, 1));
  await stopAll();
}
process.exit(failed ? 1 : 0);
