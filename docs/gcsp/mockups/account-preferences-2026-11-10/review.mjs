// One bounded browser pass. The Python supervisor owns TMPDIR and process teardown.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/usget/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const folder = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = `${folder}review`;
await mkdir(output, { recursive: true });
const port = process.env.MOCKUP_PORT ?? '4876';
const base = `http://127.0.0.1:${port}/docs/gcsp/mockups/account-preferences-2026-11-10/index.html`;
const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: root, env: { ...process.env, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] });
const serverExit = once(server, 'exit');
let browser;
const receipt = { run: 'account-preferences-20261110-01a1c6a0', kind: 'scoped mockup review', checks: [], screenshots: [], consoleErrors: [], failures: [], codeIdentity: {}, independentReview: 'capacity unavailable; pending' };
const check = (label, passed) => { receipt.checks.push({ label, passed }); assert.ok(passed, label); };
try {
  await once(server.stdout, 'data');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', (error) => receipt.consoleErrors.push(error.message));
  const snap = async (name) => { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: `${output}/${name}.png`, fullPage: true }); receipt.screenshots.push(`${name}.png`); };
  const fit = async (name) => {
    const result = await page.evaluate(() => {
      const bounds = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height }; };
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, image: !!document.querySelector('.vm-card-photo')?.naturalWidth,
        media: bounds('.vm-card-media'), canvas: bounds('.concept-page'), content: bounds('.gcsp-content') };
    });
    (receipt.viewports ??= []).push({ name, ...result });
    check(`${name}: no horizontal page overflow`, result.scroll <= result.width);
    check(`${name}: car image has useful height`, result.media.height >= 140);
    return result;
  };
  await page.goto(`${base}?state=empty`); await page.locator('.concept-page').waitFor(); await page.evaluate(() => document.fonts.ready);
  check('Initially show categories without options', !await page.locator('#category-options').isVisible());
  check('Initial understanding is 1 of 11', await page.locator('.concept-score-value').innerText() === '1 / 11');
  check('Six supported categories', await page.locator('.concept-category').count() === 6);
  check('Real local car image loads', (await fit('1440 initial')).image);
  check('No inline script/event handlers', await page.locator('script:not([src]),[onclick],[onchange]').count() === 0);
  await snap('1440-initial');
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  check('Fewer than three categories gets a clear validation', (await page.locator('#preference-status').innerText()).includes('Choose 3 more categories'));
  await snap('1440-validation');
  for (const [category, option] of [['body', 'Touring / Estate'], ['fuel', 'Petrol'], ['comfort', 'As comfortable as possible']]) {
    await page.locator(`#category-${category}`).click();
    await page.getByRole(category === 'comfort' ? 'radio' : 'checkbox', { name: option, exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  check('Three configured categories are distinct', await page.locator('.concept-category.is-considered').count() === 3);
  check('Three configured categories illustrate score 6', await page.locator('.concept-score-value').innerText() === '6 / 11');
  await page.getByRole('radio', { name: '5 stars: I love it', exact: true }).check();
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  check('Save gives confirmation', (await page.locator('#preference-status').innerText()).startsWith('Saved.'));
  await page.goto(base); await page.locator('.concept-page').waitFor();
  check('Reload preserves three categories', await page.locator('.concept-category.is-considered').count() === 3);
  check('Reload preserves five-star rating', await page.getByRole('radio', { name: '5 stars: I love it', exact: true }).isChecked());
  await snap('1440-selected');
  await page.locator('#category-body').click(); await snap('1440-options');
  await page.getByRole('button', { name: 'Remove Body preference', exact: true }).click();
  check('Remove asks for confirmation', await page.getByRole('button', { name: 'Remove preference', exact: true }).isVisible());
  await snap('1440-remove-confirmation');
  await page.getByRole('button', { name: 'Keep it', exact: true }).click();
  check('Cancel retains category', await page.locator('.concept-category.is-considered').count() === 3);
  await page.getByRole('button', { name: 'Remove Body preference', exact: true }).click();
  await page.getByRole('button', { name: 'Remove preference', exact: true }).click();
  check('Confirmed removal clears category', await page.locator('.concept-category.is-considered').count() === 2);
  await page.locator('#category-body').click(); await page.getByRole('checkbox', { name: 'Touring / Estate', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).check();
  check('Same again is 11', await page.locator('.concept-score-value').innerText() === '11 / 11');
  check('Same again disables six category selectors', await page.locator('.concept-category-open:disabled').count() === 6);
  check('Same again keeps stored categories', await page.locator('.concept-category.is-considered').count() === 3);
  await snap('1440-same-again');
  await page.getByRole('switch', { name: 'Same again, please!', exact: true }).uncheck();
  check('Untoggle restores categories and normal score', await page.locator('.concept-score-value').innerText() === '6 / 11');
  for (const category of ['sportiness', 'economy', 'size']) {
    await page.locator(`#category-${category}`).click(); await page.locator('#category-options [role=radio]').first().click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  }
  check('All preference categories cap the score at 10', await page.locator('.concept-score-value').innerText() === '10 / 11');
  for (const [width, variant] of [[1920, 'selected'], [820, 'selected'], [375, 'selected'], [320, 'long']]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(`${base}?state=${variant}`); await page.locator('.concept-page').waitFor();
    await fit(`${width} ${variant}`); await snap(`${width}-${variant}`);
    if (width === 320) {
      await page.locator('#category-comfort').click(); await fit('320 long options'); await snap('320-long-options');
      await page.getByRole('radio', { name: 'As comfortable as possible', exact: true }).focus();
      await page.keyboard.press('Home'); check('Option group keyboard Home picks first choice', await page.getByRole('radio', { name: 'Simple and functional', exact: true }).getAttribute('aria-checked') === 'true');
      await page.keyboard.press('End'); check('Option group keyboard End picks last choice', await page.getByRole('radio', { name: 'As comfortable as possible', exact: true }).getAttribute('aria-checked') === 'true');
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('button', { name: 'Remove Comfort preference', exact: true }).click(); await fit('320 remove confirmation'); await snap('320-remove-confirmation');
      await page.getByRole('button', { name: 'Keep it', exact: true }).click();
      await page.getByRole('switch', { name: 'Same again, please!', exact: true }).check(); await snap('320-same-again');
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(`${base}?state=missing`); await page.locator('.concept-page').waitFor(); await snap('1440-missing-image');
  check('Missing car image has a useful fallback', await page.getByText('No image available for your car', { exact: true }).isVisible());
  check('No uncaught page errors', receipt.consoleErrors.length === 0);
} catch (error) { receipt.failures.push(error.stack); process.exitCode = 1; }
finally {
  await browser?.close(); server.kill('SIGTERM'); await serverExit;
  for (const name of ['index.html', 'mockup.js', 'mockup.css']) receipt.codeIdentity[name] = createHash('sha256').update(await readFile(`${folder}${name}`)).digest('hex');
  await writeFile(`${output}/browser-review.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ checks: receipt.checks.length, screenshots: receipt.screenshots.length, failures: receipt.failures, consoleErrors: receipt.consoleErrors }));
}
