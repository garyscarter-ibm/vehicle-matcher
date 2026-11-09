// FUCQ-319 evidence: every request during sign-in on the offline host. Usage: PHASE=before|after PORT=9505..9509 SCRATCH=<owned dir> node capture.mjs
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/garycarter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SERVER_DIR = resolve(HERE, '../../../../server');
const phase = process.env.PHASE === 'after' ? 'after' : 'before';
const port = Number(process.env.PORT || 0);
if (!(port >= 9505 && port <= 9509)) throw new Error('PORT must be 9505-9509');
const scratch = resolve(process.env.SCRATCH || '');
if (!process.env.SCRATCH || scratch === '/') throw new Error('Set SCRATCH');
const KEY = `cap-${randomBytes(9).toString('hex')}`;
const origin = `http://127.0.0.1:${port}`;
const profile = join(scratch, 'chrome-1280');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (t, n = 400) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n).split(KEY).join('[key]');
const rel = (u) => u.replace(origin, '');
let child; let context; let page;
const requests = []; const consoleErrors = []; const stages = [];

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
// Chrome PIDs are found by this run's own profile path, recorded in pids.txt, then killed by PID.
const chromePids = () => { try { return execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter((l) => l.includes(profile)).map((l) => Number(l.trim().split(/\s+/)[0])); } catch { return []; } };
async function stopAll() {
  for (const pid of chromePids()) await appendFile(join(scratch, 'pids.txt'), `${pid} chrome\n`).catch(() => {});
  await context?.close().catch(() => {});
  for (const pid of chromePids()) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  try { if (child && child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ }
}
process.on('SIGALRM', () => { stopAll().finally(() => process.exit(124)); });

async function main() {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  await startHost();
  context = await chromium.launchPersistentContext(profile, { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, viewport: { width: 1280, height: 900 } });
  page = context.pages()[0] || await context.newPage();
  page.on('request', (r) => { const h = r.headers(); requests.push({ id: requests.length, method: r.method(), url: rel(r.url()), type: r.resourceType(), accept: h.accept || null,
    frame: rel(r.frame()?.url() || ''), redirectedFrom: r.redirectedFrom() ? rel(r.redirectedFrom().url()) : null, status: null }); });
  const find = (r) => requests.findLast((q) => q.url === rel(r.url()) && q.method === r.method() && q.status === null);
  page.on('response', (r) => { const q = find(r.request()); if (q) { q.status = r.status(); q.location = r.headers().location ? rel(r.headers().location) : undefined; q.contentType = r.headers()['content-type'] || null; } });
  page.on('requestfailed', (r) => { const q = find(r); if (q) q.status = `failed: ${r.failure()?.errorText}`; });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ text: clip(m.text(), 300), location: m.location()?.url ? rel(m.location().url) : null, pageUrl: rel(page.url()) }); });
  page.on('pageerror', (e) => consoleErrors.push({ pageError: clip(e.message, 300), pageUrl: rel(page.url()) }));
  const settle = async () => { await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await wait(2500); };
  await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 60000 }); await settle();
  stages.push({ stage: 'access page', url: rel(page.url()), requestsSoFar: requests.length });
  const key = page.locator('#key'); await key.waitFor({ timeout: 15000 });
  await key.focus(); await page.keyboard.type(KEY); await page.keyboard.press('Enter');
  await page.waitForURL(`${origin}/gcsp-presenter.html`, { timeout: 30000 }); await settle();
  stages.push({ stage: 'presenter', url: rel(page.url()), requestsSoFar: requests.length });
}
let failed = false; let error;
try { await main(); } catch (e) { failed = true; error = clip(e.stack, 800); console.log(error); }
finally {
  const bad = requests.filter((q) => typeof q.status === 'number' && q.status >= 400);
  const out = { phase, viewport: '1280x900', failed, error, stages, count: requests.length, status4xx: bad, consoleErrors, requests };
  await writeFile(join(HERE, `requests-${phase}.json`), JSON.stringify(out, null, 1).split(KEY).join('[key]'));
  console.log(JSON.stringify({ count: requests.length, bad, consoleErrors }, null, 1));
  await stopAll();
}
process.exit(failed ? 1 : 0);
