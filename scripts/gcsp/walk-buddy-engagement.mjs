// FUCQ-370 live walkthrough of explicit Buddy engagement on Account: real HTTP, memory repository, real demo login. Nothing is stubbed.
// Run: OUT=<external folder> SCRATCH=<owned scratch> perl -e 'alarm shift; exec @ARGV' 900 node scripts/gcsp/walk-buddy-engagement.mjs
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = process.env.SCRATCH; const OUT = process.env.OUT;
if (!scratch || !OUT) throw new Error('SCRATCH and OUT are required');
const PORT = Number(process.env.WALK_PORT || 8808); const ORIGIN = `http://127.0.0.1:${PORT}`;
const KEY = `walk-${randomBytes(9).toString('hex')}`; // the host still takes a demo key setting; the gate itself was removed upstream
const EMAIL = process.env.WALK_EMAIL || 'paula.mason@gcsp-demo.com'; const PASSWORD = process.env.WALK_PASSWORD;
if (!PASSWORD) throw new Error('WALK_PASSWORD is required (the demo login password)');
const VIEWPORTS = [[1440, 1100], [375, 1000]];
const report = { run: 'fucq370-live-walkthrough', commit: null, viewports: {}, findings: [] };
const stoppers = [];
process.on('SIGALRM', async () => { for (const stop of stoppers) await stop().catch(() => {}); process.exit(124); });

async function startHost() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_PUBLIC_ORIGIN: ORIGIN, PORT: String(PORT), DEMO_ACCESS_KEY: KEY };
  const child = spawn(process.execPath, ['index.js'], { cwd: `${root}server`, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let output = '';
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`host not ready: ${output.slice(-300)}`)), 90000);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { output += d; if (output.includes('GCSP hosted demo')) { clearTimeout(timer); done(); } });
    child.once('exit', (code) => { clearTimeout(timer); fail(new Error(`host exited ${code}: ${output.slice(-300)}`)); });
  });
  const stop = async () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  stoppers.push(stop); return { stop };
}

async function walk([width, height]) {
  const tag = String(width); const rows = []; const errors = [];
  const step = (name, pass, detail) => { rows.push({ step: name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); console.log(`${pass ? 'ok  ' : 'FAIL'} ${tag} ${name}`); };
  const host = await startHost(); let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'en-GB' });
    await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url().replace(ORIGIN, '')}`); });
    const shot = async (name) => { await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200); await page.screenshot({ path: `${scratch}/walk/${tag}-${name}.png`, fullPage: true }); };
    const api = (path) => page.evaluate(async (p) => { const r = await fetch(p, { credentials: 'same-origin' }); return { status: r.status, body: await r.json().catch(() => null) }; }, path);
    const permission = async () => { const a = await api('/api/gcsp/activity'); const v = a.body?.value ?? a.body; return { status: a.status, permission: v?.permission ?? null, state: v?.state ?? null, changes: (v?.stateChanges ?? []).map((c) => c.operation), briefVersion: v?.briefVersion ?? null }; };
    const lamp = () => page.locator('.gcsp-buddy-status.is-prominent').evaluate((n) => ({ text: n.textContent.trim(), state: n.dataset.state })).catch(() => null);
    const action = () => page.locator('.gcsp-prefs-action button');
    const statusText = () => page.locator('.gcsp-prefs-status').innerText().catch(() => '');
    const settle = async () => { await page.locator('.gcsp-prefs-tile').first().waitFor({ timeout: 30000 }); await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state && document.querySelector('.gcsp-buddy-status.is-prominent').dataset.state !== 'unknown', null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(400); };
    const considered = () => page.locator('.gcsp-prefs-tile.is-considered').count();
    const state = async () => ({ lamp: await lamp(), action: (await action().innerText().catch(() => '')).trim(), considered: await considered(), status: (await statusText()).trim() });
    const reload = async () => { await page.reload(); await settle(); };

    // Sign in through the real login page as the seeded employee, then open Account.
    await page.goto(`${ORIGIN}/gcsp/login`, { waitUntil: 'load', timeout: 120000 });
    await page.getByLabel('Email address').fill(EMAIL); await page.getByLabel('Password').fill(PASSWORD); await page.keyboard.press('Enter');
    await page.waitForURL(/gcsp-account|gcsp\/account|\/gcsp-/, { timeout: 60000 }).catch(() => {});
    await page.goto(`${ORIGIN}/gcsp-account.html`, { waitUntil: 'load', timeout: 60000 }); await settle();
    await shot('01-loaded');
    let s = await state(); const p0 = await permission();
    step('load: lamp, action and consent agree', s.lamp?.state && ((s.lamp.state === 'engaged') === (s.action === 'Disengage Buddy')) && ((s.lamp.state === 'engaged') === Boolean(p0.permission?.canSearch)), { ui: s, activity: p0 });
    report.initial = { ui: s, activity: p0 };

    // A fresh memory run has no confirmed brief for the employee, so there is no seeded consent to disengage from (recorded, not hidden).
    step('fresh run: no confirmed brief, so the lamp is "Buddy disengaged" and activity reports no permission', p0.state === 'no-brief' ? s.lamp?.state === 'disengaged' && p0.permission === null : true, { activity: p0 });
    if (p0.state !== 'no-brief') report.findings.push('Seeded brief present: the disengage-from-seed step was not exercised; see the post-engage disengage below.');
    else report.findings.push('The fresh memory run starts with no confirmed brief for Paula (activity state "no-brief"), so the "seeded brief has consent" starting point does not exist in this run; Disengage is exercised after a real Engage instead.');

    // Under the minimum: remove categories until fewer than three, then press Engage.
    while ((await considered()) >= 3) {
      const first = page.locator('.gcsp-prefs-tile.is-considered .gcsp-prefs-remove').first();
      await first.click(); await page.getByRole('button', { name: 'Remove preference', exact: true }).click();
      await page.waitForFunction((n) => document.querySelectorAll('.gcsp-prefs-tile.is-considered').length < n, await considered(), { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await action().click(); await page.waitForTimeout(500); s = await state(); await shot('04-under-minimum');
    const need = 3 - s.considered;
    step('Engage under the minimum shows the red choose-more message and focuses the status line', s.status === `Choose ${need} more ${need === 1 ? 'category' : 'categories'} to engage Buddy. Your preferences save automatically.` && await page.locator('.gcsp-prefs-status').evaluate((n) => n === document.activeElement) && s.lamp?.state === 'disengaged', s);
    const p2 = await permission(); step('the refused engage wrote nothing: no search permission', !p2.permission?.canSearch, p2);

    // Choose categories up to three through the tiles, then Engage.
    const picks = [['body', 'Touring / Estate'], ['fuel', 'Petrol'], ['size', null]];
    for (const [key, label] of picks) {
      if (await considered() >= 3) break;
      const tile = page.locator(`.gcsp-prefs-open[id$="-tile-${key}"]`);
      if (await tile.evaluate((n) => n.closest('.gcsp-prefs-tile').classList.contains('is-considered'))) continue;
      await tile.click();
      if (label) await page.locator('.gcsp-prefs-panel .vm-option', { hasText: label }).first().click();
      else { const slider = page.locator('.gcsp-prefs-panel input[type=range]').first(); await slider.focus(); await page.keyboard.press('ArrowRight'); }
      await page.getByRole('button', { name: 'Done', exact: true }).click(); await page.waitForTimeout(600);
    }
    s = await state(); step('three categories are considered', s.considered >= 3, s);
    await action().click(); await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state === 'engaged', null, { timeout: 15000 }).catch(() => {});
    s = await state(); await shot('05-engaged');
    step('Engage Buddy: green lamp "Buddy engaged", action "Disengage Buddy", ok copy', s.lamp?.state === 'engaged' && s.action === 'Disengage Buddy' && s.status === 'Buddy engaged. Your preferences will guide the search.', s);
    await reload(); s = await state(); const p3 = await permission(); await shot('06-engaged-reload');
    step('after reload Buddy is engaged and activity canSearch and canHold are true', s.lamp?.state === 'engaged' && p3.permission?.canSearch === true && p3.permission?.canHold === true, { ui: s, activity: p3 });
    step('activity records an "engaged" state change after the disengaged one', p3.changes.lastIndexOf('engaged') > p3.changes.lastIndexOf('disengaged'), p3.changes);

    // Disengage from the live engaged state, persist across reload, then engage again.
    const kept = await considered();
    await action().click();
    await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state === 'disengaged', null, { timeout: 15000 }).catch(() => {});
    s = await state(); await shot('06b-disengaged');
    step('Disengage Buddy: red lamp "Buddy disengaged", action "Engage Buddy", ok copy, focus stays on the button', s.lamp?.state === 'disengaged' && s.action === 'Engage Buddy' && s.status === 'Buddy disengaged. Your preferences are kept.' && await action().evaluate((n) => n === document.activeElement), s);
    await reload(); s = await state(); const pd = await permission(); await shot('06c-disengaged-reload');
    step('after reload Buddy stays disengaged, preferences are kept, and activity canSearch is false', s.lamp?.state === 'disengaged' && s.action === 'Engage Buddy' && s.considered === kept && pd.permission?.canSearch === false && pd.permission?.canHold === false, { ui: s, activity: pd });
    step('activity records a "disengaged" state change', pd.changes.at(-1) === 'disengaged', pd.changes);
    await action().click(); await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state === 'engaged', null, { timeout: 15000 }).catch(() => {});
    s = await state(); step('Engage Buddy again after a disengage works with the kept preferences', s.lamp?.state === 'engaged' && s.action === 'Disengage Buddy', s);

    // Remove one category with the bin and its confirmation: minimum loss.
    const before = await considered();
    await page.locator('.gcsp-prefs-tile.is-considered .gcsp-prefs-remove').first().click(); await shot('07-remove-confirmation');
    await page.getByRole('button', { name: 'Remove preference', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.gcsp-buddy-status.is-prominent')?.dataset.state === 'disengaged', null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500); s = await state(); await shot('08-minimum-loss');
    step('removing a category under the minimum turns the lamp to "Buddy disengaged" with the minimum-loss copy', before === 3 && s.considered === 2 && s.lamp?.state === 'disengaged' && s.action === 'Engage Buddy' && s.status === 'Preferences saved. Buddy disengaged: choose at least 3 categories to engage again.', { before, ...s });
    await reload(); s = await state(); const p4 = await permission(); await shot('09-minimum-loss-reload');
    step('after reload canSearch is false and the last state change is "disengaged"', s.lamp?.state === 'disengaged' && p4.permission?.canSearch === false && p4.changes.at(-1) === 'disengaged', { ui: s, activity: p4 });

    const tab = await page.evaluate(() => [...document.querySelectorAll('button')].map((n) => n.textContent.trim()).filter((t) => /save/i.test(t)));
    step('no button on Account contains "Save"', tab.length === 0, tab);
    step('no page or console errors, no HTTP >= 400 other than expected', errors.length === 0, errors);
  } catch (error) {
    step('walkthrough completed without throwing', false, String(error.stack).slice(0, 600));
  } finally {
    try { await browser?.close(); } catch {}
    await host.stop(); await new Promise((r) => setTimeout(r, 400));
  }
  return { rows, errors };
}

try {
  await mkdir(`${scratch}/walk`, { recursive: true }); await mkdir(OUT, { recursive: true });
  report.commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  for (const vp of VIEWPORTS) report.viewports[vp[0]] = await walk(vp);
  const all = Object.values(report.viewports).flatMap((v) => v.rows);
  report.summary = { steps: all.length, passed: all.filter((r) => r.pass).length, failed: all.filter((r) => !r.pass).map((r) => r.step) };
  const left = spawnSync('lsof', ['-nP', '-iTCP:8808', '-iTCP:3028', '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim();
  report.listenersAfter = left || 'none';
  await writeFile(`${OUT}/walkthrough.json`, JSON.stringify(report, null, 2));
  const c = spawnSync('python3', ['-I', `${root}scripts/gcsp/compose-account-prefs.py`, '--walk', scratch, OUT], { stdio: 'inherit' });
  if (c.status !== 0) throw new Error(`compose --walk exited ${c.status}`);
  console.log(JSON.stringify(report.summary, null, 1), report.listenersAfter);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
} finally {
  for (const stop of stoppers) await stop().catch(() => {});
}
