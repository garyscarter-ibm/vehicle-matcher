// FUCQ-248 run 1 UI/UX walk: presenter controls, Paula's journeys, offer decision. Offline host, memory repository.
// Usage: [WALK_SECTIONS=sections-run2.mjs] WALK_W=1280|375 WALK_SECTION=<name> WALK_PORT=9310..9319 WALK_SCRATCH=<owned dir> node walk.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const W = Number(process.env.WALK_W || 1280);
const viewport = W === 375 ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const port = Number(process.env.WALK_PORT || 9290);
if (port < 9310 || port > 9319) throw new Error('WALK_PORT must be 9310-9319');
const scratch = resolve(process.env.WALK_SCRATCH || '');
if (!scratch || scratch === '/') throw new Error('Set WALK_SCRATCH');
const OUT = join(scratch, 'out', `${process.env.WALK_SECTION}-${W}`);
const SHOTS = HERE;
const KEY = `walk-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 300) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
let child; let context; let page; let n = 0;
const log = [];
const note = (o) => { log.push(o); };

async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: join(scratch, 'tmp'), GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory',
    GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: origin, DEMO_ACCESS_KEY: KEY, PORT: String(port), GCSP_COMPARISON_RESULT_FILE: process.env.WALK_COMPARISON || '' };
  child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await appendFile(join(scratch, 'pids.txt'), `${child.pid} host ${port}\n`);
  let out = '';
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`host not ready: ${out.slice(-300)}`)), 90000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out += d; if (out.includes('GCSP hosted demo')) { clearTimeout(t); ok(); } });
    child.once('exit', (c) => { clearTimeout(t); fail(new Error(`host exited ${c}: ${out.slice(-300)}`)); });
  });
}
const stop = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);
process.on('SIGALRM', () => { stop(); process.exit(124); });

// Screenshot named <journey>-<width>-<nn>-<state>.png, plus a scripted accessibility audit of the same state.
async function shot(journey, state, { full = true, audit = true } = {}) {
  n += 1;
  const file = `${journey}-${W}-${String(n).padStart(2, '0')}-${state}.png`;
  await page.screenshot({ path: join(SHOTS, file), fullPage: full });
  const row = { file, url: page.url().replace(origin, ''), h1: clip(await page.locator('h1').first().innerText().catch(() => ''), 80) };
  if (audit) row.audit = await auditPage();
  note({ shot: row });
  return file;
}

// Scripted checks: names/roles, target size, contrast, overflow, headings, landmarks, live regions, em dashes.
async function auditPage() {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const name = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ') || e.labels?.[0]?.textContent || e.textContent || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt') || '').trim();
    const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(vis);
    const unnamed = focusables.filter((e) => !name(e) && e.type !== 'hidden').map((e) => e.outerHTML.slice(0, 120));
    const small = focusables.filter((e) => { const r = e.getBoundingClientRect(); return (r.width < 24 || r.height < 24) && !(e.tagName === 'A' && getComputedStyle(e).display === 'inline'); })
      .map((e) => `${e.tagName.toLowerCase()} "${name(e).slice(0, 40)}" ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    const under44 = focusables.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 && ['BUTTON', 'SELECT', 'INPUT', 'SUMMARY'].includes(e.tagName) && !['checkbox', 'radio'].includes(e.type); }).length;
    const rgb = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : [0, 0, 0, 0]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if ((c[3] ?? 1) > 0.5 && getComputedStyle(x).backgroundImage === 'none') return c; if (getComputedStyle(x).backgroundImage !== 'none') return null; } return [255, 255, 255]; };
    const low = [];
    for (const e of document.querySelectorAll('body *')) {
      if (!vis(e) || ![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      const s = getComputedStyle(e); const fg = rgb(s.color); const bg = bgOf(e); if (!bg) continue;
      const a = lum(fg); const b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) low.push(`${ratio.toFixed(2)} "${e.textContent.trim().slice(0, 40)}" ${s.color} on rgb(${bg.slice(0, 3)})`);
    }
    const heads = [...document.querySelectorAll('h1,h2,h3,h4')].filter(vis).map((h) => `${h.tagName}:${h.textContent.trim().slice(0, 50)}`);
    const text = document.body.innerText;
    return {
      title: document.title, lang: document.documentElement.lang, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h1Count: [...document.querySelectorAll('h1')].filter(vis).length, headings: heads.slice(0, 25),
      landmarks: [...document.querySelectorAll('main,nav,header,footer,aside,[role=main],[role=navigation],[role=region][aria-label],section[aria-label],section[aria-labelledby]')].map((e) => `${e.tagName.toLowerCase()}${e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''}:${(e.getAttribute('aria-label') || document.getElementById(e.getAttribute('aria-labelledby'))?.textContent || '').trim().slice(0, 30)}`).slice(0, 20),
      live: [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].map((e) => `${e.getAttribute('role') || ''}${e.getAttribute('aria-live') || ''}:"${e.textContent.trim().slice(0, 60)}"`).slice(0, 10),
      imgsNoAlt: [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).length,
      unnamed, small: small.slice(0, 12), under44, lowContrast: low.slice(0, 12), lowContrastCount: low.length,
      emDash: (text.match(/.{0,30}—.{0,30}/g) || []).slice(0, 5), focusableCount: focusables.length,
    };
  });
}

// Tab through the page, recording where focus lands and whether it is visibly indicated.
async function tabWalk(label, max = 60) {
  const seq = [];
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const e = document.activeElement; if (!e) return null; const s = getComputedStyle(e);
      const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
      const r = e.getBoundingClientRect();
      return { tag: e.tagName, text: (e.getAttribute('aria-label') || e.textContent || e.value || e.name || '').trim().slice(0, 40), ring, inView: r.bottom > 0 && r.top < innerHeight, y: Math.round(r.top + scrollY) };
    });
    if (!f || f.tag === 'BODY') { seq.push(f || { tag: 'null' }); break; }
    if (seq.length && seq[0].text === f.text && seq[0].tag === f.tag && seq[0].y === f.y) break;
    seq.push(f);
  }
  const noRing = seq.filter((s) => s.tag !== 'BODY' && !s.ring).map((s) => `${s.tag}:${s.text}`);
  note({ tab: label, stops: seq.length, order: seq.map((s) => `${s.tag}:${s.text}`).slice(0, 40), noRing: noRing.slice(0, 15), bodyHit: seq.some((s) => s.tag === 'BODY' || s.tag === 'null') });
  return seq;
}
async function ariaDump(label) {
  const snap = await page.locator('body').ariaSnapshot().catch((e) => `ERR ${e.message}`);
  await writeFile(join(OUT, `aria-${label}.yml`), snap);
}
async function reflow320(label) {
  await page.setViewportSize({ width: 320, height: 720 }); await wait(400);
  const o = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    wide: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`) }));
  note({ reflow320: label, ...o });
  await page.setViewportSize(viewport); await wait(300);
}
const text = () => page.locator('body').innerText().catch(() => '');
const go = async (path) => { await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(800); };
async function signIn() {
  await go('/gcsp-presenter.html');
  const key = page.locator('#key');
  if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1500); }
}
const strip = () => page.locator('.gcsp-presenter-controls');
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 30000 });
  if (!(await root.evaluate((el) => el.open ?? true))) await root.locator('summary').first().click();
  await wait(600);
}
async function press(name, { settle = 2500 } = {}) {
  await openStrip();
  await page.getByRole('button', { name }).first().click({ timeout: 30000 });
  for (let i = 0; i < 120; i += 1) { await wait(500); if (!/Action in progress/.test(await strip().innerText().catch(() => ''))) break; }
  await wait(settle);
}
const buttons = () => page.locator('main button:visible, main a[href]:visible').evaluateAll((b) => b.map((x) => (x.textContent || x.getAttribute('aria-label') || '').trim().slice(0, 50)).filter(Boolean));
async function dump(label) {
  await writeFile(join(OUT, `text-${label}.txt`), `${page.url()}\n${await text()}`);
  note({ dump: label, buttons: (await buttons()).slice(0, 30) });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await startHost();
  context = await chromium.launchPersistentContext(join(scratch, `chrome-${process.env.WALK_SECTION}-${W}`), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport, reducedMotion: 'no-preference' });
  page = context.pages()[0] || await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') note({ consoleError: clip(m.text(), 200), at: page.url().replace(origin, '') }); });
  page.on('pageerror', (e) => note({ pageError: clip(e.message, 200) }));
  const H = { page: () => page, go, signIn, shot, tabWalk, ariaDump, reflow320, press, openStrip, dump, text, note, wait, clip, origin, W, OUT };
  const mod = await import(join(HERE, process.env.WALK_SECTIONS || 'sections.mjs'));
  try { await mod[process.env.WALK_SECTION](H); note({ done: true }); } catch (e) { note({ error: clip(e.stack, 800) }); await shot('error', 'failure', { audit: false }).catch(() => {}); }
  await writeFile(join(OUT, 'log.json'), JSON.stringify(log, null, 1));
  await context.close().catch(() => {}); stop();
}
main().then(() => process.exit(0), (e) => { console.error(e); stop(); process.exit(1); });
