// FUCQ-279 evidence: car names and image fallback on account, gallery, review, brief, buddy activity and offer. Offline host, memory repository.
// Usage: CAP_W=1280|375 CAP_PORT=9442|9443 CAP_SCRATCH=<owned dir> node capture.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const W = Number(process.env.CAP_W || 1280);
const viewport = W === 375 ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const port = Number(process.env.CAP_PORT || 9442);
if (port < 9442 || port > 9443) throw new Error('CAP_PORT must be 9442-9443');
const scratch = resolve(process.env.CAP_SCRATCH || '');
if (!scratch || scratch === '/') throw new Error('Set CAP_SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function shot(name, checks) {
  const file = `${W}-${name}.png`;
  await page.screenshot({ path: join(HERE, file), fullPage: true });
  const body = await text();
  const found = await page.evaluate(() => {
    const vis = (e) => e.getBoundingClientRect().width > 0;
    const names = [...document.querySelectorAll('.vm-card-name, .gcsp-feature h2, .gcsp-activity-offer-name, .gcsp-offer-comparison h3, .gcsp-offer-comparison h2, .gcsp-review h2')].filter(vis).map((e) => e.textContent.trim());
    const fallbacks = [...document.querySelectorAll('.vm-card-soon')].filter(vis).map((e) => e.textContent.trim());
    return { names: [...new Set(names)], fallbacks: [...new Set(fallbacks)], overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  results.push({ screen: name, file, viewport: `${W}x${viewport.height}`, url: page.url().replace(origin, ''), h1: (await h1()).slice(0, 60), ...found,
    badNameCopy: (body.match(/Synthetic [0-9i]|Fictional BMW|\b[FG]\d{2} [A-Z]|Image unavailable/) || [])[0] ?? null,
    syntheticLine: (body.match(/[^\n]*[Ss]ynthetic[^\n]*/g) || []).slice(-3), checks });
}
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
const kb = async (loc) => { await loc.first().focus(); await page.keyboard.press('Enter'); await wait(1200); };
async function resetTo(scenario) {
  await openStrip();
  await page.locator('.gcsp-presenter-controls button', { hasText: scenario }).first().click();
  await btn('Reset scenario').click(); await wait(600); await btn('Confirm reset').click();
  await until(async () => !/Action in progress/.test(await page.locator('.gcsp-presenter-controls').innerText()), 'reset done', 60000); await wait(1500);
  const cont = btn('Continue to workspace'); if (await cont.isVisible().catch(() => false)) { await cont.click(); await wait(1500); }
  await openStrip();
  await page.locator('.gcsp-presenter-controls button', { hasText: 'Paula (fictional)' }).first().click();
  await btn('Switch principal').click();
  await until(async () => !/Action in progress/.test(await page.locator('.gcsp-presenter-controls').innerText()), 'switch done', 60000); await wait(2500);
  if (await btn('Reload').isVisible().catch(() => false)) { await page.reload(); await wait(2500); }
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
    await until(async () => (await h1()) === 'Your cars', 'account');
    await shot('account', ['current car name follows the rule', 'synthetic footer present']);
    await kb(btn('Choose a replacement'));
    await until(async () => (await h1()) === 'Your order choices', 'setup'); await wait(1500);
    const pick = async (name) => { const s = page.locator(`select[name="${name}"]`);
      await until(async () => (await s.locator('option:not([disabled])').count()) > 1, `${name} options`);
      await s.selectOption(await s.locator('option:not([disabled])').evaluateAll((o) => o.find((x) => x.value)?.value)); };
    await page.locator('select[name="driverId"]').selectOption({ label: 'You: Paula (fictional)' }).catch(() => pick('driverId'));
    await pick('contractOptionId');
    const date = page.locator('input[name="requestedCollectionDate"]'); await date.fill(await date.getAttribute('min'));
    await pick('collectionLocationId');
    const fill = async (sel, v) => { const c = page.locator(sel); if (await c.count() && await c.isVisible() && !(await c.inputValue())) await c.fill(v); };
    await fill('input[name="phone"]', '07700900123'); await fill('input[name="email"]', 'paula.test@example.test'); await fill('input[name="expectedReturnMileage"]', '24000');
    await kb(btn('Save choices')); await until(async () => /Your choices are saved/.test(await text()), 'saved');
    await until(async () => btn('Continue').isEnabled(), 'continue enabled'); await kb(btn('Continue'));
    await until(async () => /Released cars/.test(await text()), 'gallery'); await wait(2500);
    await press('Next release'); await closeStrip();
    const refresh = btn('Refresh availability'); if (await refresh.count()) await kb(refresh);
    await wait(2500);
    if (!(await page.getByRole('button', { name: 'Review this car' }).count())) {
      await kb(btn('Back to your choices'));
      await until(async () => (await h1()) === 'Your order choices', 'setup again'); await wait(1500);
      await until(async () => (await date.getAttribute('min')) && !(await date.isDisabled()), 'window');
      await date.fill(await date.getAttribute('min')); await kb(btn('Save choices'));
      await until(async () => btn('Continue').isEnabled(), 'continue'); await kb(btn('Continue'));
    }
    await until(async () => (await page.getByRole('button', { name: 'Review this car' }).count()) > 0, 'cards', 30000); await wait(1500);
    await shot('gallery', ['card names follow the rule, colour after "in"', 'one image fallback string', 'synthetic footer present']);
    for (let tries = 0; tries < 4 && (await h1()) !== 'Review your car'; tries += 1) {
      const enabled = page.locator('button:enabled', { hasText: 'Review this car' });
      await kb(enabled.nth(Math.min(tries, (await enabled.count()) - 1)));
      await until(async () => (await h1()) === 'Review your car' || /no longer available/.test(await text()), 'review or conflict');
      if ((await h1()) !== 'Review your car') { await kb(btn('Refresh availability').first()); await wait(2500); }
    }
    await wait(2000);
    await shot('review', ['review car name follows the rule', 'synthetic footer present']);
    // Buddy journey: brief, activity, offer on the decline-then-change scenario.
    await go('/gcsp-presenter.html'); await resetTo('Decline then change'); await closeStrip();
    await go('/gcsp-brief-live.html'); await wait(1500);
    await shot('brief', ['brief card names follow the rule', 'synthetic line present']);
    await go('/gcsp-activity-live.html'); await wait(1500); await openStrip();
    if (await btn('Next release').isEnabled()) { await press('Next release'); await page.reload(); await wait(2500); }
    await closeStrip();
    await shot('activity', ['buddy activity offer name follows the rule', 'fallback is the one kit string']);
    const open = page.getByRole('link', { name: /View offer|Open the offer/i }).or(page.getByRole('button', { name: /View offer|Open the offer/i })).first();
    await kb(open); await wait(2500);
    await shot('offer', ['offer title and comparison names follow the rule', 'synthetic line present']);
  } catch (e) { results.push({ error: String(e.stack).slice(0, 600) }); await page.screenshot({ path: join(scratch, `error-${W}.png`), fullPage: true }).catch(() => {}); }
  await writeFile(join(HERE, `results-${W}.json`), JSON.stringify(results, null, 1));
  await context.close().catch(() => {}); stop();
}
main().then(() => process.exit(0), (e) => { console.error(e); stop(); process.exit(1); });
