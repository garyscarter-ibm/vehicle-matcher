// FUCQ-194: the order progress design harness for the buddy return place, with and without a home address, at 1280 and 375.
// Serves the repo with scripts/serve.js on 127.0.0.1 (FUCQ194_PORT 8860-8869) and headless Chrome; a fresh profile, removed afterwards.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const port = Number(process.env.FUCQ194_PORT) || 8862;
if (!(port >= 8860 && port <= 8869)) throw new Error('FUCQ194_PORT must be 8860-8869');
const scratch = resolve(process.env.TMPDIR || '');
if (!scratch || scratch === '/') throw new Error('Set TMPDIR to an owned scratch directory');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cases = [
  { fixture: 'return-buddy-home', expect: /Collection from your home address\s*1 Fictional Way, Example Town, ZZ1 1ZZ/ },
  { fixture: 'return-buddy-no-address', expect: /Collection from your home address\s*Not supplied/ },
  { fixture: 'return-not-planned', expect: /Return place\s*Fictional BMW retailer/, absent: /home address/ },
];
const report = { startedAt: new Date().toISOString(), port, results: [], consoleErrors: [] };
const server = spawn(process.execPath, ['scripts/serve.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore', detached: true });
const profile = join(scratch, 'chrome-fucq194');
let browser;
try {
  await new Promise((r) => setTimeout(r, 800));
  await mkdir(join(HERE, 'browser'), { recursive: true });
  browser = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true });
  for (const width of [1280, 375]) {
    const page = await browser.newPage(); await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(`${width} ${m.text()}`); });
    for (const c of cases) {
      await page.goto(`http://127.0.0.1:${port}/gcsp-order-progress.html?fixture=${c.fixture}`);
      const section = page.locator('.gcsp-order-return').first(); await section.waitFor({ timeout: 20000 });
      const text = (await section.innerText()).replace(/\s+/g, ' ');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const shot = `browser/${width}-${c.fixture}.png`;
      await section.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(HERE, shot), fullPage: true });
      const pass = c.expect.test(text) && !(c.absent?.test(text)) && overflow <= 0;
      report.results.push({ width, fixture: c.fixture, pass, overflow, screenshot: shot, returnSection: text });
    }
    await page.close();
  }
} finally {
  await browser?.close(); try { process.kill(-server.pid); } catch {}
  await rm(profile, { recursive: true, force: true });
  report.passed = report.results.length === 6 && report.results.every((r) => r.pass);
  await writeFile(join(HERE, 'results-harness.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`harness: ${report.results.filter((r) => r.pass).length}/${report.results.length} passed, console errors ${report.consoleErrors.length}`);
}
