// Shared GCSP host: runtime options, the same-origin page front and the hosted (Render) entry.
// The launcher and server/index.js both compose through here, so there is one copy.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGcspRuntime } from './runtime.js';
import { createRunStockProviderFactory } from './stock/index.js';
import { createDemoUpstream, withConfirmedSupply } from './stock/demo-provider.js';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const SESSION_PAGES = ['/gcsp-brief-live.html', '/gcsp-activity-live.html', '/gcsp-order-progress-live.html', '/gcsp-account.html',
  '/gcsp-help.html', '/gcsp-greg.html', '/gcsp-case-queue.html', '/gcsp-presenter.html', '/gcsp-outbox.html'];
const sessionPage = (path) => SESSION_PAGES.includes(path);
const navigationCookie = 'GCSP_LOCAL_BOOTSTRAP';
const ACCESS_COOKIE = 'GCSP_HOST_ACCESS';
const ACCESS_PATH = '/gcsp/access';
const ACCESS_MAX_AGE = 43200;
const ACCESS_BODY_LIMIT = 4096;
const publicPath = (path) => sessionPage(path) || ['/gcsp/offer', '/gcsp-offer.html', '/gcsp-employee.css', '/favicon.ico'].includes(path)
  || path.startsWith('/blocks/') || path.startsWith('/assets/');

// The launcher's composition, shared. Callers pass only the defaults that differ.
export function gcspRuntimeOptions({ env = process.env, defaultMode, defaultEnvironmentId, commandId } = {}) {
  const mode = env.GCSP_REPOSITORY_MODE || defaultMode;
  const stock = createRunStockProviderFactory();
  // One synthetic ordering upstream confirms supply and releases it on top of the run's chosen stock source.
  const upstream = createDemoUpstream();
  const environmentId = env.GCSP_ENVIRONMENT_ID || defaultEnvironmentId;
  const runtime = { mode, stockProvider: (deps) => withConfirmedSupply(stock(deps), upstream), production: upstream.production,
    repositoryOptions: { connectionString: env.GCSP_DATABASE_URL }, environmentId,
    policyAsOf: new Date().toISOString(), commandId, adoptOfferJourney: true };
  return { runtime, stock, mode, environmentId };
}

const digest = (value) => createHash('sha256').update(String(value)).digest();
const keyMatches = (given, expected) => timingSafeEqual(digest(given), digest(expected));
const accessToken = (accessKey) => createHmac('sha256', accessKey).update('gcsp-host-access-v1').digest('hex');
const cookieValue = (header, name) => header?.split(';').map((part) => part.trim())
  .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);

function accessPage(next, message) {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Open the demo</title>
  <link rel="stylesheet" href="/blocks/gcsp/shell/gcsp-shell.css">
  <link rel="stylesheet" href="/gcsp-employee.css">
</head>
<body>
  <main>
    <h1>Open the demo</h1>
    ${message ? `<p role="alert">${message}</p>` : ''}
    <form method="post" action="${ACCESS_PATH}">
      <label for="key">Demo key</label>
      <input id="key" name="key" type="password" autocomplete="off" required>
      <input type="hidden" name="next" value="${next}">
      <button type="submit">Open the demo</button>
    </form>
  </main>
</body>
</html>
`;
}

async function readLimited(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) return null; chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

// Page serving and key injection need Host === origin's host. With fallThrough, every other path goes to api.
export function createGcspFront({ root, services, api, origin, accessKey, accessGate = false, fallThrough = false } = {}) {
  const host = new URL(origin).host;
  const gated = Boolean(accessGate && accessKey);
  const token = gated ? accessToken(accessKey) : '';
  const hasAccess = (req) => {
    const given = cookieValue(req.headers.cookie, ACCESS_COOKIE);
    return typeof given === 'string' && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
  };
  const html = (res, status, body, headers = {}) => res.writeHead(status, { 'Content-Type': TYPES['.html'],
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }).end(body);
  // The marker names this process, so a restart (Render sleep, deploy) bootstraps a fresh session.
  const boot = randomBytes(12).toString('hex');
  const nextPath = (value) => (sessionPage(value) ? value : '/gcsp-presenter.html');

  async function accessRoute(req, res, url) {
    if (req.method === 'GET') { html(res, 200, accessPage(nextPath(url.searchParams.get('next')))); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'GET, POST' }).end(); return; }
    const body = await readLimited(req, ACCESS_BODY_LIMIT);
    if (body === null) { res.writeHead(413).end(); return; }
    const form = new URLSearchParams(body); const next = nextPath(form.get('next'));
    if (!keyMatches(form.get('key') ?? '', accessKey)) { html(res, 401, accessPage(next, 'That key did not match. Try again.')); return; }
    res.writeHead(303, { Location: next, 'Cache-Control': 'no-store',
      'Set-Cookie': `${ACCESS_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}` }).end();
  }

  return async (req, res) => {
    try {
      const hostOk = req.headers.host === host;
      if (!hostOk && !fallThrough) { res.writeHead(403).end(); return; }
      const url = new URL(req.url, origin);
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith('/api/gcsp/')) {
        // Only this trusted host is a local client of the existing shared-key boundary.
        if (hostOk && accessKey && (!gated || hasAccess(req))) req.headers['x-access-key'] = accessKey;
        api.emit('request', req, res); return;
      }
      if (fallThrough && (!hostOk || !(publicPath(path) || gated && path === ACCESS_PATH))) { api.emit('request', req, res); return; }
      if (gated && path === ACCESS_PATH) { await accessRoute(req, res, url); return; }
      if (req.method !== 'GET' || !publicPath(path)) { res.writeHead(404).end('Not found'); return; }
      if (gated && sessionPage(path) && !hasAccess(req)) {
        res.writeHead(303, { Location: `${ACCESS_PATH}?next=${encodeURIComponent(path)}`, 'Cache-Control': 'no-store' }).end(); return;
      }
      const assetPath = path === '/gcsp/offer' ? '/gcsp-offer.html' : path;
      const file = resolve(root, `.${assetPath}`);
      const canonicalPath = `/${relative(resolve(root), file).split(sep).join('/')}`;
      if (!file.startsWith(`${resolve(root)}${sep}`) || !publicPath(canonicalPath) || canonicalPath !== assetPath
        || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
      // API cookies deliberately stay on /api/gcsp, so browsers do not send them
      // on HTML navigation. This non-authority marker only prevents rebootstrap;
      // every API request still authenticates the unchanged identity cookies.
      const bootstrapped = req.headers.cookie?.split(';').some((value) => value.trim() === `${navigationCookie}=${boot}`);
      if (sessionPage(path) && !bootstrapped) {
        const session = await services.identity.resolveSession({ authorized: true, cookie: req.headers.cookie });
        if (session.status !== 'ok') {
          const issued = await services.createLocalSession();
          if (issued.status !== 'ok') { res.writeHead(503).end('The local demo could not start.'); return; }
          const expires = issued.value.setCookie.at(-1).match(/; Expires=([^;]+)/)?.[1];
          if (!expires) { res.writeHead(503).end('The local demo could not start.'); return; }
          res.setHeader('Set-Cookie', [...issued.value.setCookie,
            `${navigationCookie}=${boot}; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`]);
        }
      }
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer' });
      res.end(await readFile(file));
    } catch { if (!res.headersSent) res.writeHead(404).end('Not found'); else res.end(); }
  };
}

const failure = (code) => ({ status: 'invalid', code });
function publicOrigin(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    return url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:' && local) ? url.origin : null;
  } catch { return null; }
}

// Hosted entry: one origin serves the GCSP pages, /api/gcsp and the retail API. Resolves to { status, ... }.
export async function startHostedGcsp({ buildServer, env = process.env, port, root = REPO_ROOT } = {}) {
  const origin = publicOrigin(env.GCSP_PUBLIC_ORIGIN ?? '');
  if (!origin) return failure('public-origin-required');
  // Fail closed: the hosted pages and /api/* are only open behind the demo key.
  if (!env.DEMO_ACCESS_KEY) return failure('access-key-required');
  const options = gcspRuntimeOptions({ env, defaultMode: 'memory', defaultEnvironmentId: 'gcsp-hosted-demo', commandId: 'hosted-bootstrap' });
  const opened = await createGcspRuntime(options.runtime);
  if (opened.status !== 'ok') return opened;
  const services = opened.value;
  let api; let server; let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    await new Promise((done) => { server?.close(done); server?.closeAllConnections(); if (!server?.listening) done(); });
    api?.closeAllConnections(); await services.close();
  };
  try {
    const allowed = [...new Set([origin, ...(env.GCSP_ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)])];
    api = buildServer({ ...services.dependencies, gcspAllowedOrigins: allowed });
    const startup = await api.gcspStartup;
    if (startup?.status !== 'ok') { await close(); return startup ?? { status: 'unavailable' }; }
    server = createServer(createGcspFront({ root, services, api, origin, accessKey: env.DEMO_ACCESS_KEY, accessGate: true, fallThrough: true }));
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, done); });
  } catch { await close(); return { status: 'unavailable' }; }
  console.log(`GCSP hosted demo (${options.mode}): ${origin}/gcsp-presenter.html`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { close().finally(() => process.exit(0)); });
  return { status: 'ok', value: { server, services, origin, close } };
}
