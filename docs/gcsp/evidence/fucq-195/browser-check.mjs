// FUCQ-195 browser check: Paula's current-car card at 1280 and 375, from the read-only `ready` snapshot.
// That snapshot is asserted equal to the real manual service output in gcsp-account-render.test.js.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const OUT = fileURLToPath(new URL('./', import.meta.url));
const PORT = Number(process.env.FUCQ195_PORT ?? 8890);
if (PORT < 8890 || PORT > 8899) throw new Error('Port must be 8890 to 8899');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = resolve(ROOT, `.${decodeURIComponent(new URL(req.url, 'http://x').pathname)}`);
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  let body; try { body = await readFile(path); } catch { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
});
await new Promise((done) => server.listen(PORT, '127.0.0.1', done));
const raw = ['current:employee-paula', 'slot-paula', 'choices-fs-uk', 'fixture:manual-records-v1', 'manual-records-v1'];
const profile = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'fucq195-chrome-'));
const runs = [];
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
    const context = await chromium.launchPersistentContext(profile, { executablePath: CHROME, headless: true, viewport });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/gcsp-account.html?fixture=ready`, { waitUntil: 'networkidle' });
      const card = page.locator('.gcsp-feature').first(); await card.waitFor();
      const closed = await card.evaluate((node) => [...node.querySelectorAll('.gcsp-feature-copy > dl dt')].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
      const terms = await card.locator('.gcsp-account-terms').textContent();
      await card.screenshot({ path: join(OUT, `${viewport.width}-current-car.png`) });
      await card.evaluate((node) => node.querySelectorAll('details').forEach((d) => { d.open = true; }));
      const text = await card.evaluate((node) => [...node.querySelectorAll('dd, p, h2, summary, button')].map((n) => n.textContent));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      runs.push({ viewport, summaryFacts: closed, terms, rawFound: raw.filter((id) => text.some((t) => t.includes(id))),
        statusRaw: closed.some(([, v]) => v === 'current'), overflow, consoleErrors: errors,
        screenshot: `docs/gcsp/evidence/fucq-195/${viewport.width}-current-car.png` });
    } finally { await context.close(); }
  }
} finally { server.close(); await rm(profile, { recursive: true, force: true }); }
const passed = runs.every((r) => !r.rawFound.length && !r.statusRaw && r.overflow <= 0 && /^1,100 points a month/.test(r.terms));
await writeFile(join(OUT, 'results.json'), `${JSON.stringify({ passed, origin: `http://127.0.0.1:${PORT}`, runs }, null, 2)}\n`);
console.log(passed ? 'PASSED' : 'FAILED');
process.exit(passed ? 0 : 1);
