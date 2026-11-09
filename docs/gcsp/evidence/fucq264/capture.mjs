// FUCQ-264: two screenshots of Greg's closed case (1280 and 375 px). Static file server on 9141, headless Chrome CDP on 9149.
import { spawn } from 'node:child_process'; import { mkdir, writeFile } from 'node:fs/promises'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const HERE = fileURLToPath(new URL('.', import.meta.url)); const ROOT = path.resolve(HERE, '../../../..'); const scratch = process.env.FUCQ264_SCRATCH;
if (!scratch) throw new Error('Set FUCQ264_SCRATCH');
const kids = []; const killAll = () => { for (const k of kids) { try { process.kill(-k.pid, 'SIGKILL'); } catch { /* gone */ } } };
process.on('exit', killAll);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js')], { env: { ...process.env, PORT: '9141' }, detached: true, stdio: 'ignore' }); kids.push(server);
const profile = path.join(scratch, 'chrome-profile'); await mkdir(profile, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9149', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' }); kids.push(chrome);
let browser; for (let i = 0; i < 40 && !browser; i++) { await wait(250); browser = await chromium.connectOverCDP('http://127.0.0.1:9149').catch(() => null); }
const results = { pids: { server: server.pid, chrome: chrome.pid }, shots: [] };
for (const width of [1280, 375]) {
  const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 900 } }); const page = await context.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:9141/docs/gcsp/evidence/fucq264/greg-closed-unconfirmed.html'); await page.waitForSelector('[id$="-selection"]', { timeout: 15000 });
  await page.selectOption('[id$="-selection"]', 'synthetic-case-closed'); await page.getByRole('button', { name: 'Open selected case' }).click();
  await page.waitForSelector('.gcsp-case-remedy', { timeout: 15000 });
  const remedy = page.locator('.gcsp-case-remedy'); await remedy.scrollIntoViewIfNeeded();
  const text = await remedy.innerText(); const buttons = await remedy.locator('button').count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const file = path.join(HERE, `${width}-greg-closed-unconfirmed.png`); await page.screenshot({ path: file, fullPage: true });
  results.shots.push({ width, file: path.relative(ROOT, file), remedyText: text, remedyButtons: buttons, horizontalOverflow: overflow, errors });
  await context.close();
}
await browser.close().catch(() => {}); killAll(); await writeFile(path.join(HERE, 'results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results.shots.map(({ remedyText, ...s }) => ({ ...s, remedyText: remedyText.replace(/\n+/g, ' | ') }))));
