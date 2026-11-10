import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';
const [,, SERVER_DIR, OUT, RTT, PORT] = process.argv; const port = Number(PORT); const origin = `http://127.0.0.1:${port}`;
const { chromium } = await import('/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs');
const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: origin, PORT: String(port) }, stdio: 'ignore' });
process.on('exit', () => { try { child.kill('SIGKILL'); } catch {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 360; i++) { try { if ((await fetch(origin + '/health/vehicle-evidence')).status === 200) break; } catch {} await wait(500); }
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: Number(RTT), downloadThroughput: 20e6 / 8, uploadThroughput: 10e6 / 8 });
let net = 0; page.on('request', (r) => { if (!new URL(r.url()).pathname.includes('/api/')) net++; });
const idle = () => page.waitForLoadState('networkidle', { timeout: 60000 });
const results = [];
async function load(name, path) {
  net = 0; const t0 = Date.now(); await page.goto(origin + path, { waitUntil: 'commit' }); await idle(); const wall = Date.now() - t0 - 500;
  const m = await page.evaluate(() => { const f = performance.getEntriesByName('first-contentful-paint')[0]; const res = performance.getEntriesByType('resource').filter((e) => !e.name.includes('/api/'));
    return { fcp: Math.round(f?.startTime ?? -1), staticN: res.length, fromNetwork: res.filter((e) => e.transferSize > 0).length, h1: document.querySelector('h1')?.innerText?.slice(0, 40) ?? null }; });
  results.push({ name, wall, ...m, staticRequestsSent: net }); console.log(name, JSON.stringify(results.at(-1)));
}
await page.goto(origin + '/gcsp-presenter.html'); await idle(); await cdp.send('Network.clearBrowserCache');
const pages = [['presenter', '/gcsp-presenter.html'], ['offer', '/gcsp/offer'], ['outbox', '/gcsp-outbox.html'], ['login', '/gcsp/login']];
for (const [n, p] of pages) await load('cold-' + n, p);
for (const [n, p] of pages) await load('warm-' + n, p);
results.push({ errors }); writeFileSync(OUT, JSON.stringify(results, null, 1)); await browser.close(); child.kill('SIGTERM'); process.exit(0);
