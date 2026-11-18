// Runs `node index.js` the way Render does (memory runtime, one origin) and drives it over HTTP only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { essential, preference } from './helpers/employee-recommendation.js';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

// Starts the entry and resolves once its stdout contains `ready`; the child is stopped and joined in t.after.
async function launch(t, extra, ready) {
  const port = await freePort();
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? process.env.TMP ?? '/tmp',
    GCSP_OFFLINE: '1', GCSP_REPOSITORY_MODE: 'memory', PORT: String(port), ...extra(port) };
  const child = spawn(process.execPath, ['index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = once(child, 'exit');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited; clearTimeout(timer);
    }
  });
  const seen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Entry did not report readiness in time. Output tail: ${output.slice(-600)}`)), 60000);
    const check = () => { if (output.includes(ready)) { clearTimeout(timer); resolve(); } };
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output += chunk; check(); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Entry exited (${code}) before readiness. Output tail: ${output.slice(-600)}`)); });
  });
  await seen;
  return { port, base: `http://localhost:${port}`, output: () => output };
}

// A small cookie jar that honours Path, enough to prove the browser-visible behaviour.
function client(base) {
  const jar = new Map();
  const store = (response, path) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(';').map((part) => part.trim());
      const at = pair.indexOf('=');
      const attribute = (name) => attributes.find((part) => part.toLowerCase().startsWith(`${name.toLowerCase()}=`))?.split('=')[1];
      const name = pair.slice(0, at); const cookiePath = attribute('path') ?? path;
      const key = `${name}:${cookiePath}`;
      if (attribute('max-age') === '0') jar.delete(key);
      else jar.set(key, { name, value: pair.slice(at + 1), path: cookiePath, line });
    }
  };
  const cookieFor = (path) => [...jar.values()].filter((c) => path.startsWith(c.path)).map((c) => `${c.name}=${c.value}`).join('; ');
  const request = async (path, { method = 'GET', body, json, headers = {} } = {}) => {
    const cookie = cookieFor(path);
    const response = await fetch(base + path, { method, redirect: 'manual',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { Origin: base } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body });
    store(response, '/');
    const text = await response.text();
    let parsed = null; try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { status: response.status, headers: response.headers, text, json: parsed };
  };
  return { request, jar };
}
const good = (reply) => { assert.equal(reply.status, 200, reply.text.slice(0, 400)); assert.equal(reply.json?.status, 'ok', reply.text.slice(0, 400)); return reply.json.value; };

test('the hosted entry serves the open demo and takes a brief from Paula over one origin', { timeout: 120000 }, async (t) => {
  const app = await launch(t, (port) => ({ GCSP_RUNTIME: '1', GCSP_PUBLIC_ORIGIN: `http://localhost:${port}` }),
    '/gcsp/login');
  assert.match(app.output(), /GCSP hosted demo \(memory\)/);
  const browser = client(app.base);
  const get = (path, options) => browser.request(path, options);
  const post = (path, json) => browser.request(path, { method: 'POST', json });

  // Retail API paths fall through the front untouched.
  assert.equal((await get('/health')).status, 200);

  // The bare host sends a browser to the login page, revealing nothing; the favicon is a quiet 204.
  const bare = await get('/');
  assert.equal(bare.status, 303); assert.equal(bare.headers.get('location'), '/gcsp/login');
  assert.equal(bare.text, ''); assert.deepEqual(bare.headers.getSetCookie(), []);
  assert.equal((await get('/favicon.ico')).status, 204);

  // No key form: the access route is gone and pages are served directly.
  assert.notEqual((await get('/gcsp/access')).status, 200);
  assert.equal((await get('/gcsp/offer')).status, 404);
  assert.equal((await get('/gcsp/login')).status, 200);
  const css = await get('/blocks/gcsp/shell/gcsp-shell.css');
  assert.equal(css.status, 200); assert.equal(css.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await get('/blocks/gcsp/shell/gcsp-shell.css', { headers: { 'If-None-Match': css.headers.get('etag') } })).status, 304);

  // The legacy presenter page is retired: it answers 404 and issues no cookie.
  const retired = await get('/gcsp-presenter.html');
  assert.equal(retired.status, 404); assert.deepEqual(retired.headers.getSetCookie(), []);
  assert.equal((await get('/gcsp-help.html')).headers.get('location'), '/gcsp/login');
  const signedIn = good(await post('/api/gcsp/session/login', { email: 'paula.mason@gcsp-demo.com', password: 'fucq' })).context;
  assert.equal(signedIn.principalId, 'demo-paula');
  assert.equal(good(await get('/api/gcsp/context')).principalId, 'demo-paula');
  assert.equal((await get('/gcsp-help.html')).status, 200);
  assert.equal((await get('/api/gcsp/presenter/controls')).status, 403);

  // Paula's brief saves and confirms on the hosted origin. Release ticks are presenter-owned and covered in-process.
  good(await post('/api/gcsp/brief/draft', { commandId: 'hosted-draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
    brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
  good(await post('/api/gcsp/brief/confirm', { commandId: 'hosted-confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
    consent: { search: true, hold: true } }));
});

test('a fresh session reads its absent draft as 200 not-found, so sign-in logs no 404', { timeout: 90000 }, async (t) => {
  const app = await launch(t, (port) => ({ GCSP_RUNTIME: '1', GCSP_PUBLIC_ORIGIN: `http://localhost:${port}` }), '/gcsp/login');
  const browser = client(app.base);
  assert.equal((await browser.request('/gcsp/login')).status, 200);
  good(await browser.request('/api/gcsp/session/login', { method: 'POST', json: { email: 'paula.mason@gcsp-demo.com', password: 'fucq' } }));
  const draft = await browser.request('/api/gcsp/manual/draft');
  assert.equal(draft.status, 200, draft.text.slice(0, 300));
  assert.equal(draft.json.status, 'not-found'); assert.equal(draft.json.resourceType, 'manual-draft');
  // Other absent reads keep their 404.
  assert.equal((await browser.request('/api/gcsp/manual/no-such-route')).status, 404);
});

test('without GCSP_RUNTIME the entry still answers GCSP routes as unconfigured', { timeout: 90000 }, async (t) => {
  const app = await launch(t, () => ({}), 'Matcher API listening');
  const reply = await client(app.base).request('/api/gcsp/context');
  assert.equal(reply.status, 503); assert.match(reply.text, /GCSP identity has not been configured/);
  assert.equal((await client(app.base).request('/gcsp-presenter.html')).status, 404);
});

test('the hosted entry starts without a demo key and ignores one', async () => {
  const { startHostedGcsp } = await import('../gcsp/host.js');
  const started = await startHostedGcsp({ buildServer: () => assert.fail('must not build'),
    env: { GCSP_PUBLIC_ORIGIN: 'http://localhost:1' }, port: 0 });
  assert.deepEqual(started, { status: 'invalid', code: 'database-url-required' });
});

test('the hosted entry requires a durable database unless memory is explicitly selected', async () => {
  const { startHostedGcsp } = await import('../gcsp/host.js');
  const started = await startHostedGcsp({ buildServer: () => assert.fail('must not build'),
    env: { GCSP_PUBLIC_ORIGIN: 'http://localhost:1' }, port: 0 });
  assert.deepEqual(started, { status: 'invalid', code: 'database-url-required' });
});
