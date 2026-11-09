// FUCQ-291 evidence: Paula's offer email in the presenter outbox, offline host, memory repository.
// Usage: WALK_W=1280|375 WALK_PORT=9320..9329 WALK_SCRATCH=<owned dir> node walk.mjs (reuses fucq-248 resetTo).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
import { resetTo } from '../fucq-248/sections.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const W = Number(process.env.WALK_W || 1280);
const viewport = W === 375 ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const port = Number(process.env.WALK_PORT || 9320);
if (port < 9320 || port > 9329) throw new Error('WALK_PORT must be 9320-9329');
const scratch = resolve(process.env.WALK_SCRATCH || '');
if (!scratch || scratch === '/') throw new Error('Set WALK_SCRATCH');
const KEY = `walk-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 300) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
let child; let context; let page;
const log = [];
const note = (o) => { log.push(o); };

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
const stop = () => { try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } };
process.on('exit', stop);

const go = async (path) => { await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(800); };
const strip = () => page.locator('.gcsp-presenter-controls');
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 30000 });
  if (!(await root.evaluate((el) => el.open ?? true))) await root.locator('summary').first().click();
  await wait(600);
}
async function press(name) {
  await openStrip();
  await page.getByRole('button', { name }).first().click({ timeout: 30000 });
  for (let i = 0; i < 120; i += 1) { await wait(500); if (!/Action in progress/.test(await strip().innerText().catch(() => ''))) break; }
  await wait(2500);
}
const closeStrip = () => page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});

async function main() {
  await startHost();
  context = await chromium.launchPersistentContext(join(scratch, `chrome-${W}`), { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport });
  page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (e) => note({ pageError: clip(e.message, 200) }));
  const H = { page: () => page, openStrip, wait, note, clip, shot: async () => {} };
  await go('/gcsp-presenter.html');
  const key = page.locator('#key');
  if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1500); }
  await resetTo(H, 'Main successful journey', 'fucq-291', false, 'Paula');
  await closeStrip();
  await press('Next release'); await closeStrip();
  let msg;
  for (let i = 0; i < 20; i += 1) {
    await go('/gcsp-outbox.html'); await wait(1500);
    msg = page.locator('main button', { hasText: 'Paula' }).last();
    if (await msg.count()) break;
  }
  await msg.focus(); await page.keyboard.press('Enter'); await wait(1500);
  const frame = page.frameLocator('iframe.gcsp-mail-frame');
  const facts = await page.locator('.gcsp-mail-facts').innerText();
  const chip = await page.locator('.gcsp-mail-status').first().innerText();
  const email = clip(await frame.locator('body').innerText(), 1200);
  const href = await frame.locator('a').first().getAttribute('href');
  const plain = clip(await page.locator('main').innerText(), 4000);
  await page.screenshot({ path: join(HERE, `${W}-outbox-message.png`), fullPage: true });
  // Reach the frame by keyboard, as a presenter would, then read its computed outline.
  await page.locator('.gcsp-mail-heading').focus();
  let ring = {};
  for (let i = 0; i < 30 && ring.tag !== 'IFRAME'; i += 1) {
    await page.keyboard.press('Tab'); await wait(100);
    ring = await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e);
      return { tag: e.tagName, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        matches: [':focus', ':focus-visible', ':focus-within'].filter((q) => e.matches(q)) }; });
  }
  // Each Tab stop inside the frame, shot so the ring (on the frame or its link) can be seen.
  const stops = [];
  while (ring.tag === 'IFRAME' && stops.length < 3) {
    stops.push(ring); await page.locator('iframe.gcsp-mail-frame').screenshot({ path: join(HERE, `${W}-outbox-frame-focus-${stops.length}.png`) });
    await page.keyboard.press('Tab'); await wait(150);
    ring = await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e);
      return { tag: e.tagName, outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, matches: [':focus', ':focus-visible'].filter((q) => e.matches(q)) }; });
  }
  ring = { stops, after: ring };
  const checks = {
    carNamed: !/Your scheme vehicle/.test(email), points: /\d[\d,]* points a month/.test(email),
    deadlineInWords: /Respond by \d\d:\d\d on [A-Z][a-z]+day \d{1,2} [A-Z][a-z]+\./.test(email), noIso: !/\d{4}-\d\d-\d\dT/.test(email),
    greeting: /Hello Paula,/.test(email) && !/\(fictional\),/.test(email), absoluteLink: (href || '').startsWith(`${origin}/gcsp/offer`),
    tokenInFragment: /#token=/.test(href || '') && !/[?&]token=/.test(href || ''), capturedLabel: chip === 'Captured, not sent' && /Captured, not sent/.test(facts),
    noSentLabel: !/^Sent$/m.test(facts), frameStops: stops.length, noEmDash: !/\u2014/.test(plain + email),
  };
  note({ W, chip, facts: clip(facts, 300), email: email.replace(/token=[\w-]+/g, 'token=<redacted>'), href: (href || '').replace(/token=[^&]+/, 'token=<redacted>'), ring, checks });
  const file = join(HERE, 'results.json');
  const prior = await readFile(file, 'utf8').then(JSON.parse).catch(() => ({}));
  prior[W] = log;
  await writeFile(file, `${JSON.stringify(prior, null, 1)}\n`);
  await context.close().catch(() => {}); stop();
  console.log(JSON.stringify(checks));
}
main().then(() => process.exit(0), async (e) => { console.error(e); note({ error: clip(e.stack, 800) }); await context?.close().catch(() => {}); stop(); process.exit(1); });
