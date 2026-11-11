// Interim FUCQ-367 capture: serves the worktree on port 3017, screenshots the gallery section and runs keyboard checks in Chrome.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const scratch = process.env.SCRATCH ?? '/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-20261110-claude/DEV-2026-11-10-009/scratch';
const shots = join(scratch, 'shots'); mkdirSync(shots, { recursive: true });
const { chromium } = await import('/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');

const server = spawn('node', ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: '3017' }, detached: true, stdio: 'ignore' });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stopServer);
await new Promise((r) => setTimeout(r, 1200));

const results = []; const check = (name, pass, detail = '') => { results.push({ name, pass: Boolean(pass), detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail); };
let context;
try {
  context = await chromium.launchPersistentContext(join(scratch, 'chrome-profile'), {
    channel: 'chrome', headless: true, deviceScaleFactor: 1, locale: 'en-GB', reducedMotion: 'reduce', viewport: { width: 1440, height: 1100 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  const section = page.locator('#gcsp-star-rating');
  const examples = section.locator('.vm-gallery-gcsp-media');
  const state = async (n) => examples.nth(n).evaluate((node) => {
    const radios = [...node.querySelectorAll('input[type=radio]')]; const tip = node.querySelector('[role=tooltip]');
    return { value: radios.findIndex((r) => r.checked) + 1 || null, tipHidden: tip.hidden, active: radios.indexOf(document.activeElement) + 1 };
  });
  const star = (n, k) => examples.nth(n).locator('.gcsp-star').nth(k - 1);
  async function load(width, height) {
    await page.setViewportSize({ width, height });
    await page.goto('http://localhost:3017/components.html', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await section.waitFor();
    await section.scrollIntoViewIfNeeded(); // Lazy images only load once near the viewport.
    await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 8000)), Promise.all([...document.querySelectorAll('#gcsp-star-rating img')].map((img) => img.complete ? 0 : new Promise((r) => { img.onload = img.onerror = r; })))]));
    await page.mouse.move(0, 0);
  }
  async function pair(label, n, file, width) {
    const media = examples.nth(n).locator('.vm-card-media'); const tip = examples.nth(n).locator('[role=tooltip]');
    const m = await media.boundingBox(); const t = await tip.boundingBox();
    const top = Math.max(0, Math.min(m.y, t ? t.y : m.y) - 8); const left = Math.max(0, m.x - 4);
    await page.screenshot({ path: join(shots, file), fullPage: true, clip: { x: left, y: top + await page.evaluate(() => scrollY), width: Math.min(width - left, m.width + 8), height: m.y + m.height - top } });
  }

  // Desktop captures and keyboard/mouse checks.
  await load(1440, 1100);
  await section.screenshot({ path: join(shots, '1440-section.png') });
  await star(0, 1).hover(); await page.waitForTimeout(100);
  check('hover shows the tip on example (a)', !(await state(0)).tipHidden);
  await section.screenshot({ path: join(shots, '1440-section-tip.png') });
  await pair('a-tip', 0, '1440-a-tip.png', 1440);
  await page.mouse.move(0, 0);
  await examples.nth(1).locator('.vm-card-media').screenshot({ path: join(shots, '1440-b-selected.png') });
  await examples.nth(2).locator('.vm-card-media').screenshot({ path: join(shots, '1440-c-five.png') });
  await examples.nth(5).locator('.vm-card-media').screenshot({ path: join(shots, '1440-f-missing.png') });

  // Keyboard on example (b): Tab in from (a), arrow, Space, Enter.
  await examples.nth(0).locator('input').nth(4).focus(); await page.keyboard.press('Tab');
  let s = await state(1);
  check('Tab reaches the checked star of example (b)', s.active === 4 && s.value === 4, JSON.stringify(s));
  check('tip opens on keyboard focus', !s.tipHidden);
  await page.keyboard.press('ArrowRight'); s = await state(1);
  check('ArrowRight selects 5', s.value === 5 && s.active === 5, JSON.stringify(s));
  check('tip hidden right after ArrowRight', s.tipHidden);
  await page.keyboard.press('Space'); s = await state(1);
  check('Space on the selected star clears it', s.value === null && s.active === 5, JSON.stringify(s));
  check('tip hidden right after Space', s.tipHidden);
  await page.keyboard.press('Space'); s = await state(1);
  check('Space selects again', s.value === 5, JSON.stringify(s));
  await page.keyboard.press('Enter'); s = await state(1);
  check('Enter on the selected star clears it', s.value === null, JSON.stringify(s));
  check('tip hidden right after Enter', s.tipHidden);
  await page.waitForTimeout(700);
  check('status line announced once after saves', (await examples.nth(1).locator('[role=status]').textContent()).length > 0, await examples.nth(1).locator('[role=status]').textContent());

  // Mouse click on example (c): select, then clear.
  await star(2, 2).click(); s = await state(2);
  check('mouse click selects 2 stars', s.value === 2, JSON.stringify(s)); check('tip hidden right after click', s.tipHidden);
  await star(2, 2).click(); s = await state(2);
  check('second click clears', s.value === null, JSON.stringify(s)); check('tip hidden after second click', s.tipHidden);

  // Escape on example (a).
  await page.mouse.move(0, 0); await examples.nth(0).locator('input').nth(0).focus();
  check('keyboard focus opens the tip on (a)', !(await state(0)).tipHidden);
  await page.keyboard.press('Escape');
  check('Escape hides the tip', (await state(0)).tipHidden);
  await page.evaluate(() => document.activeElement.blur());

  // Narrow captures.
  await load(320, 1000);
  await section.screenshot({ path: join(shots, '320-section.png') });
  await star(0, 1).hover(); await page.waitForTimeout(100);
  await section.screenshot({ path: join(shots, '320-section-tip.png') });
  await pair('a-tip', 0, '320-a-tip.png', 320);
  await page.mouse.move(0, 0);
  await star(3, 1).hover(); await page.waitForTimeout(100);
  const box = await examples.nth(3).locator('[role=tooltip]').boundingBox();
  check('long tip stays inside 0..320 at 320px', box && box.x >= 0 && box.x + box.width <= 320, JSON.stringify(box));
  await pair('d-tip', 3, '320-d-tip-long.png', 320);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth);
  check('no horizontal overflow at 320px', overflow <= 320, String(overflow));
} finally {
  await context?.close();
  stopServer();
  writeFileSync(join(here, 'results.json'), JSON.stringify({ capturedAt: new Date().toISOString(), viewport: 'chrome headless, dsf 1, en-GB, reduced motion', results }, null, 2) + '\n');
}
process.exit(results.every((r) => r.pass) ? 0 : 1);
