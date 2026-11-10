// Shared GCSP host: runtime options, the same-origin page front and the hosted (Render) entry.
// The launcher and server/index.js both compose through here, so there is one copy.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGcspRuntime } from './runtime.js';
import { publicOrigin } from './public-origin.js';
import { createRunStockProviderFactory } from './stock/index.js';
import { createDemoUpstream, withConfirmedSupply } from './stock/demo-provider.js';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const SESSION_PAGES = ['/gcsp-brief-live.html', '/gcsp-activity-live.html', '/gcsp-order-progress-live.html', '/gcsp-account.html',
  '/gcsp-help.html', '/gcsp-greg.html', '/gcsp-case-queue.html', '/gcsp-presenter.html', '/gcsp-outbox.html'];
const sessionPage = (path) => SESSION_PAGES.includes(path);
const LOGIN_PATH = '/gcsp/login';
const loginPage = (path) => [LOGIN_PATH, '/gcsp-login.html'].includes(path);
const presenterPage = (path) => ['/gcsp-presenter.html', '/gcsp-outbox.html'].includes(path);
const gregPage = (path) => ['/gcsp-greg.html', '/gcsp-case-queue.html'].includes(path);
const landing = (context) => context?.roles?.includes('greg') ? '/gcsp-greg.html'
  : context?.roles?.includes('employee') ? '/gcsp-account.html' : LOGIN_PATH;
const publicPath = (path) => loginPage(path) || sessionPage(path) || ['/gcsp/offer', '/gcsp-offer.html', '/gcsp-employee.css'].includes(path)
  || path.startsWith('/blocks/') || path.startsWith('/assets/');

// The launcher's composition, shared. Callers pass only the defaults that differ.
export function gcspRuntimeOptions({ env = process.env, defaultMode, defaultEnvironmentId, commandId } = {}) {
  const mode = env.GCSP_REPOSITORY_MODE || defaultMode || 'postgres';
  const stock = createRunStockProviderFactory();
  // One synthetic ordering upstream confirms supply and releases it on top of the run's chosen stock source.
  const upstream = createDemoUpstream();
  const environmentId = env.GCSP_ENVIRONMENT_ID || defaultEnvironmentId;
  const runtime = { mode, stockProvider: (deps) => withConfirmedSupply(stock(deps), upstream, { policy: deps.policy }), production: upstream.production,
    repositoryOptions: { connectionString: env.GCSP_DATABASE_URL }, environmentId,
    policyAsOf: new Date().toISOString(), commandId, adoptOfferJourney: true,
    comparisonResultFile: env.GCSP_COMPARISON_RESULT_FILE, mail: { env } };
  return { runtime, stock, mode, environmentId };
}

const contentTag = (body) => `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
// If-None-Match uses weak comparison (RFC 9110), so a W/ prefix still matches.
const tagMatches = (header, tag) => typeof header === 'string'
  && header.split(',').some((value) => { const given = value.trim(); return given === '*' || given.replace(/^W\//, '') === tag; });

// Page serving needs Host === origin's host. With fallThrough, every other path goes to api.
export function createGcspFront({ root, services, api, origin, fallThrough = false } = {}) {
  const host = new URL(origin).host;
  const html = (res, status, body, headers = {}) => res.writeHead(status, { 'Content-Type': TYPES['.html'],
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }).end(body);
  const redirect = (res, location) => res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' }).end();

  return async (req, res) => {
    try {
      const hostOk = req.headers.host === host;
      if (!hostOk && !fallThrough) { res.writeHead(403).end(); return; }
      const url = new URL(req.url, origin);
      const path = decodeURIComponent(url.pathname);
      if (path.startsWith('/api/gcsp/')) { api.emit('request', req, res); return; }
      // The bare host and favicon get a browser answer rather than the retail API's 401 or a 404.
      if (hostOk && req.method === 'GET' && path === '/') {
        const session = await services.identity.resolveSession({ authorized: true, cookie: req.headers.cookie });
        redirect(res, session.status === 'ok' ? landing(session.value) : LOGIN_PATH); return;
      }
      if (hostOk && req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'max-age=86400' }).end(); return; }
      if (fallThrough && (!hostOk || !publicPath(path))) { api.emit('request', req, res); return; }
      if (req.method !== 'GET' || !publicPath(path)) { res.writeHead(404).end('Not found'); return; }
      if (presenterPage(path)) {
        const control = await services.identity.resolveSession({ authorized: true, cookie: req.headers.cookie, purpose: 'presenter-control' });
        if (control.status !== 'ok') {
          const issued = await services.createPresenterControlSession();
          if (issued.status !== 'ok') { html(res, 503, 'The service could not start.'); return; }
          res.setHeader('Set-Cookie', issued.value.setCookie);
        }
      } else if (sessionPage(path) || loginPage(path)) {
        const session = await services.identity.resolveSession({ authorized: true, cookie: req.headers.cookie });
        const destination = session.status === 'ok' ? landing(session.value) : LOGIN_PATH;
        if (session.status === 'unavailable') { html(res, 503, 'The service is unavailable. Try again.'); return; }
        if (loginPage(path)) {
          if (destination !== LOGIN_PATH) { redirect(res, destination); return; }
        } else if (destination === LOGIN_PATH || !session.value.roles.includes(gregPage(path) ? 'greg' : 'employee')) {
          redirect(res, destination); return;
        }
      }
      const assetPath = path === '/gcsp/offer' ? '/gcsp-offer.html' : loginPage(path) ? '/gcsp-login.html' : path;
      const file = resolve(root, `.${assetPath}`);
      const canonicalPath = `/${relative(resolve(root), file).split(sep).join('/')}`;
      if (!file.startsWith(`${resolve(root)}${sep}`) || !publicPath(canonicalPath) || canonicalPath !== assetPath
        || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
      const body = await readFile(file);
      const type = TYPES[extname(file)] || 'application/octet-stream';
      // Static files revalidate by content hash (no max-age, so a redeploy is never stale); pages stay no-store.
      if (extname(file) !== '.html') {
        const headers = { ETag: contentTag(body), 'Cache-Control': 'private, no-cache', 'Referrer-Policy': 'no-referrer' };
        if (tagMatches(req.headers['if-none-match'], headers.ETag)) { res.writeHead(304, headers).end(); return; }
        res.writeHead(200, { 'Content-Type': type, ...headers }).end(body); return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      res.end(body);
    } catch { if (!res.headersSent) res.writeHead(404).end('Not found'); else res.end(); }
  };
}

const failure = (code) => ({ status: 'invalid', code });

// Hosted entry: one origin serves the GCSP pages, /api/gcsp and the retail API. Resolves to { status, ... }.
export async function startHostedGcsp({ buildServer, env = process.env, port, root = REPO_ROOT } = {}) {
  const origin = publicOrigin(env.GCSP_PUBLIC_ORIGIN ?? '');
  if (!origin) return failure('public-origin-required');
  if (!env.GCSP_REPOSITORY_MODE && !env.GCSP_DATABASE_URL || env.GCSP_REPOSITORY_MODE === 'postgres' && !env.GCSP_DATABASE_URL) return failure('database-url-required');
  const options = gcspRuntimeOptions({ env, defaultMode: 'postgres', defaultEnvironmentId: 'gcsp-hosted-demo', commandId: 'hosted-bootstrap' });
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
    server = createServer(createGcspFront({ root, services, api, origin, fallThrough: true }));
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, done); });
  } catch { await close(); return { status: 'unavailable' }; }
  console.log(`GCSP hosted demo (${options.mode}): ${origin}/gcsp-presenter.html`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { close().finally(() => process.exit(0)); });
  return { status: 'ok', value: { server, services, origin, close } };
}
