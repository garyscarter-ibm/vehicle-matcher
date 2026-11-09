// FUCQ-297 browser evidence: queue row Open buttons, case heading focus, remedy hint, Paula's Ask for help and short reference.
// Usage: W=1280|375 PORT=9437..9439 SCRATCH=<owned dir> node capture.mjs. Offline host, memory repository.
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
if (!(port >= 9437 && port <= 9439)) throw new Error('PORT must be 9437-9439');
const scratch = resolve(process.env.SCRATCH || '');
if (!process.env.SCRATCH || scratch === '/') throw new Error('Set SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const profile = join(scratch, `chrome-${W}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 300) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
let child; let context; let page;
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
const chromePids = () => { try { return execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter((l) => l.includes(profile)).map((l) => Number(l.trim().split(/\s+/)[0])); } catch { return []; } };
async function stopAll() {
  for (const pid of chromePids()) await appendFile(join(scratch, 'pids.txt'), `${pid} chrome\n`).catch(() => {});
  await context?.close().catch(() => {});
  for (const pid of chromePids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ }
}
process.on('SIGALRM', () => { stopAll().finally(() => process.exit(124)); });

const go = async (path) => { await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 60000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(1200); };
const btn = (name, exact = true) => page.getByRole('button', { name, exact });
const strip = () => page.locator('.gcsp-presenter-controls');
const shot = async (name, loc) => {
  if (loc) { await loc.scrollIntoViewIfNeeded().catch(() => {}); await wait(300); await page.evaluate(() => window.scrollBy(0, -70)); }
  await wait(300); await page.screenshot({ path: join(HERE, `${W}-${name}.png`), fullPage: false }); note({ shot: `${W}-${name}.png` });
};
const closeStrip = () => page.evaluate(() => { const d = document.querySelector('.gcsp-presenter-controls'); if (d) d.open = false; }).catch(() => {});
async function openStrip() {
  const root = strip(); await root.waitFor({ state: 'attached', timeout: 30000 });
  if (!(await root.evaluate((el) => el.open ?? true))) await root.locator('summary').first().click();
  await wait(500);
}
const settle = async () => { await wait(400); for (let i = 0; i < 120; i += 1) { if (!/Action in progress/.test(await strip().innerText().catch(() => ''))) break; await wait(400); } };
async function resetTo(scenario, principal) {
  await openStrip();
  await strip().locator('button', { hasText: scenario }).first().click();
  await btn('Reset scenario').click(); await wait(600);
  await btn('Confirm reset').click(); await settle(); await wait(1500);
  const cont = btn('Continue to workspace'); if (await cont.isVisible().catch(() => false)) { await cont.click(); await wait(1500); }
  if (await btn('Reload').isVisible().catch(() => false)) { await page.reload(); await wait(2000); }
  await switchTo(principal);
}
async function switchTo(who) {
  await openStrip();
  await strip().locator('button', { hasText: `${who} (fictional)` }).first().click();
  await btn('Switch principal').click(); await settle(); await wait(2500);
  if (await btn('Reload').isVisible().catch(() => false)) { await page.reload(); await wait(2500); }
}
async function signIn() {
  await go('/gcsp-presenter.html');
  const key = page.locator('#key');
  if (await key.count()) { await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter'); await page.waitForLoadState('load'); await wait(1500); }
}
const active = () => page.evaluate(() => { const e = document.activeElement;
  return { tag: e?.tagName, text: (e?.getAttribute?.('aria-label') || e?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), cls: String(e?.className || '').slice(0, 40), isBody: e === document.body || !e }; });
const size = (loc) => loc.evaluate((e) => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 40), px: parseFloat(getComputedStyle(e).fontSize) }));

async function paulaPart() {
  await go('/gcsp-help.html'); await closeStrip();
  const main = page.locator('main');
  const ask = main.getByRole('button', { name: 'Ask for help' });
  const inDetails = await ask.evaluate((e) => Boolean(e.closest('details')));
  const desc = await ask.evaluate((e) => document.getElementById(e.getAttribute('aria-describedby'))?.textContent.trim());
  note({ step: 'help-initial', visible: await ask.isVisible(), inDetails, describedBy: desc });
  check('Ask for help is visible without expanding anything', (await ask.isVisible()) && !inDetails, { inDetails });
  check('caveat is hint text tied to the button', /^Remedies need the scheme team.s decision\. No specific next car/.test(desc || ''), desc);
  await shot('01-help-ask-button', main.getByRole('heading', { name: 'Get help with your renewal' }));
  await ask.click(); await wait(500);
  const f1 = await active(); note({ step: 'help-revealed', focus: f1 });
  check('pressing Ask for help moves focus to the first field', f1.tag === 'TEXTAREA', f1);
  await shot('02-help-form-revealed', main.getByRole('heading', { name: 'Get help with your renewal' }));
  await main.getByRole('button', { name: 'Cancel' }).click(); await wait(400);
  const f2 = await active(); note({ step: 'help-cancelled', focus: f2 });
  check('Cancel hides the form and returns focus to the button', f2.tag === 'BUTTON' && f2.text === 'Ask for help' && (await main.locator('textarea').count()) === 0, f2);
  await main.getByRole('button', { name: 'Ask for help' }).click(); await wait(300);
  await main.locator('textarea').fill('My replacement may miss my contract end.');
  await main.getByRole('button', { name: 'Review help request' }).click(); await wait(800);
  await main.getByRole('button', { name: 'Confirm help request' }).click(); await wait(2500);
  const ref = await main.locator('.vm-fact-label', { hasText: 'Case reference' }).locator('xpath=following-sibling::*[1]').first().innerText().catch(() => '');
  const full = await main.locator('[data-case-id]').first().getAttribute('data-case-id').catch(() => null);
  note({ step: 'help-case', reference: ref, fullInDataAttr: full, text: clip(await main.innerText(), 500) });
  check('case reference is the short form', /^[0-9A-F]{8}$/.test(ref.trim()) && full && full.startsWith('renewal-') && !(await main.innerText()).includes(full), { ref, full });
  const h = await size(main.locator('article h2').first()); const p = await size(main.locator('h1').first());
  note({ step: 'paula-heading-sizes', caseHeading: h, pageTitle: p });
  check('Paula case heading is below page-title size', h.px <= 20 && p.px > 24, { h, p });
  await shot('03-help-case-short-reference', main.locator('article').first());
}

async function gregPart() {
  await switchTo('Greg'); await closeStrip(); await go('/gcsp-greg.html');
  const region = page.getByRole('region', { name: 'Renewal cases' }).first();
  await region.waitFor({ timeout: 30000 }); await until(() => region.locator('tbody .gcsp-table-action').count());
  const sectionH2 = await size(page.locator('.gcsp-greg-section .gcsp-greg-h2').first());
  const casesH2 = await size(region.locator('h2').first());
  note({ step: 'greg-queue', rowButtons: await region.locator('tbody .gcsp-table-action').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label'))),
    picker: await region.getByRole('combobox', { name: 'Case to work' }).count(), sectionH2, casesH2 });
  check('row Open button, no Case to work select', (await region.locator('tbody .gcsp-table-action').count()) >= 1 && (await region.getByRole('combobox', { name: 'Case to work' }).count()) === 0, {});
  check('Renewal cases h2 matches the dashboard h2 size', casesH2.px === sectionH2.px, { sectionH2, casesH2 });
  await shot('04-greg-queue-row-open', region);
  await region.locator('tbody .gcsp-table-action').first().click(); await wait(2000);
  const f = await active(); note({ step: 'greg-case-opened', focus: f });
  check('opening a case focuses its heading', f.tag === 'H3' && /Paula/.test(f.text), f);
  const caseH = await size(region.locator('[data-case-heading]'));
  note({ step: 'greg-heading-sizes', caseHeading: caseH });
  check('employee-name heading is below page-title size', caseH.px <= 20, caseH);
  await shot('05-greg-case-opened-focus-heading', region.locator('[data-case-heading]'));
  const sel = region.getByRole('combobox', { name: 'Remedy to record' });
  const options = await sel.locator('option').allInnerTexts();
  const hint = await sel.evaluate((e) => e.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id)?.textContent.trim()).join(' | '));
  note({ step: 'remedy-hint', options, hint });
  check('remedy options are short names; reasons are hint text', options.every((o) => o.length < 60) && /Not available|^$/.test(hint), { options, hint });
  await shot('06-greg-remedy-hint', sel);
  await region.getByRole('button', { name: 'Close case details' }).click(); await wait(500);
  const f2 = await active(); note({ step: 'greg-case-closed', focus: f2 });
  check('closing returns focus to the row Open button', /^Open case for/.test(f2.text), f2);
}
const until = async (fn, timeout = 30000) => { const end = Date.now() + timeout; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await wait(250); } throw new Error('timed out'); };

async function fixturePart() {
  await go('/gcsp-case-queue.html?fixture=populated'); await wait(1200);
  const q = page.locator('gcsp-case-queue');
  const n = await q.locator('tbody .gcsp-table-action').count();
  check('fixture queue has an Open button on every row', n === 5, n);
  await shot('07-fixture-queue-rows');
  await q.locator('tbody .gcsp-table-action').nth(2).click(); await wait(1800);
  const f = await active(); note({ step: 'fixture-case-opened', focus: f });
  check('fixture: focus on the case heading', f.tag === 'H2' && /Synthetic employee/.test(f.text), f);
  await shot('08-fixture-case-opened', q.locator('[data-case-heading]'));
}

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport, reducedMotion: 'no-preference' });
  page = context.pages()[0] || await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') note({ consoleError: clip(m.text(), 200), at: page.url().replace(origin, '') }); });
  page.on('pageerror', (e) => note({ pageError: clip(e.message, 200) }));
  await signIn();
  await resetTo('No suitable match', 'Paula'); await closeStrip();
  await paulaPart();
  await gregPart();
  await fixturePart();
}
let failed = false;
try { await main(); } catch (e) { failed = true; note({ error: clip(e.stack, 800) }); check('script completed', false, clip(e.message, 200)); await page?.screenshot({ path: join(HERE, `error-${W}.png`) }).catch(() => {}); }
finally {
  await writeFile(join(HERE, `results-${W}.json`), JSON.stringify({ width: W, viewport, allPass: !failed && checks.every((c) => c.pass), checks, steps }, null, 1));
  await stopAll();
}
process.exit(failed ? 1 : 0);
