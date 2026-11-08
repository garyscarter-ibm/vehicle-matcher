import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const OUT = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(OUT, '../../../..');
assert(process.env.TMPDIR, 'Use the registered resource supervisor.');
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || '/Users/usget/.npm/_npx/db89d7302a373f10/node_modules/playwright-core/index.mjs');
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(ROOT, `.${decodeURIComponent(path)}`);
    assert(file.startsWith(ROOT + sep));
    assert(path === '/gcsp-outbox.html' || path === '/gcsp-employee.css' || path.startsWith('/blocks/') || path.startsWith('/assets/'));
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = resolve(process.env.TMPDIR, 'headless-outbox-profile');
const results = []; const errors = []; let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, reducedMotion: 'reduce' });
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['narrow', { width: 375, height: 812 }]]) {
    const page = await browser.newPage(); await page.setViewportSize(viewport); page.setDefaultTimeout(6000);
    page.on('pageerror', () => errors.push('page-error'));
    await page.route('**/*', (route) => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    await page.goto(base + '/gcsp-outbox.html?fixture=messages');
    await page.locator('.gcsp-mail-row').first().waitFor();
    assert.match(await page.locator('main').innerText(), /Captured messages and delivery status\./);
    assert.doesNotMatch(await page.locator('main').innerText(), /Captured demonstration emails\. No email has been sent/);
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(() => document.activeElement?.classList.contains('gcsp-mail-row'))) break;
    }
    assert(await page.evaluate(() => document.activeElement?.classList.contains('gcsp-mail-row')));
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'gcsp-mail-heading');
    assert.equal(await page.locator('iframe').getAttribute('sandbox'), '');
    assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
    assert.match(await page.locator('.gcsp-mail-text').innerText(), /No email has been sent/);
    const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(await overflow(), 0);
    await page.locator('iframe').scrollIntoViewIfNeeded();
    await page.frameLocator('iframe').getByText('GCSP employee vehicle scheme').waitFor();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.screenshot({ path: resolve(OUT, `capture-${label}.png`), fullPage: true, animations: 'disabled' });
    results.push({ state: 'captured fixture', viewport, overflowPx: await overflow(), keyboardOpened: true, focus: 'message heading', sandbox: '', file: `capture-${label}.png` });
    await page.evaluate(async () => {
      const { fixtureMessages } = await import('/blocks/gcsp/presenter/fixtures.js');
      const node = document.querySelector('gcsp-outbox');
      const captured = fixtureMessages()[0];
      const footer = 'This is a captured demonstration message for a fictional employee. No email has been sent.';
      const realFooter = 'This is a demonstration message for a fictional employee. Provider acceptance does not confirm inbox delivery.';
      const messages = [{ ...captured, textBody: captured.textBody.replaceAll(footer, realFooter),
        htmlBody: captured.htmlBody.replaceAll(footer, realFooter), state: 'failed', attempts: 2, error: 'provider-window-expired' }];
      node.adapter = { loadMessages: async () => ({ status: 'ready', messages }) };
    });
    await page.locator('.gcsp-mail-row').first().focus(); await page.keyboard.press('Enter');
    const copy = await page.locator('.gcsp-mail-detail').innerText();
    assert.match(copy, /confirm|confirmation/i);
    assert.doesNotMatch(copy, /No email has been sent/);
    assert.equal(await overflow(), 0);
    await page.locator('iframe').scrollIntoViewIfNeeded();
    await page.frameLocator('iframe').getByText('GCSP employee vehicle scheme').waitFor();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await page.screenshot({ path: resolve(OUT, `unconfirmed-${label}.png`), fullPage: true, animations: 'disabled' });
    results.push({ state: 'unconfirmed provider-window fixture', viewport, overflowPx: await overflow(), keyboardOpened: true, copy, file: `unconfirmed-${label}.png` });
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise((done) => { server.close(done); server.closeAllConnections(); });
}
const sources = {};
for (const path of ['blocks/gcsp/presenter/gcsp-outbox.js', 'blocks/gcsp/presenter/outbox-copy.js', 'blocks/gcsp/presenter/message-list.js', 'blocks/gcsp/presenter/gcsp-presenter.css', 'docs/gcsp/evidence/fucq98/capture-outbox.mjs']) sources[path] = createHash('sha256').update(await readFile(resolve(ROOT, path))).digest('hex');
await writeFile(resolve(OUT, 'browser-receipt.json'), JSON.stringify({ run: 'fucq98-20261105-brevo-transport', browser: 'isolated headless system Chrome', sources, results, errors, compatibilityException: { profile, expectedPeakMiB: 32, removedBy: 'registered supervisor Scratch finalizer' }, limits: ['Synthetic viewer presentation inputs only; no external network/mail', 'No layout, component or provider delivery claim'] }, null, 2) + '\n');
console.log(JSON.stringify({ captures: results.length, errors: errors.length, keyboard: 'passed', overflow: 'zero' }));
