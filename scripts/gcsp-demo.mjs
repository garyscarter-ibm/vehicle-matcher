#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../server/index.js';
import { createGcspRuntime } from '../server/gcsp/runtime.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const sessionPage = (path) => ['/gcsp-brief-live.html', '/gcsp-activity-live.html', '/gcsp-account.html'].includes(path);
const publicPath = (path) => sessionPage(path) || ['/gcsp/offer', '/gcsp-offer.html', '/gcsp-employee.css', '/favicon.ico'].includes(path)
  || path.startsWith('/blocks/') || path.startsWith('/assets/');

// Separate loopback entry; it neither changes the retail launcher nor adds a remote sign-in route.
export async function startGcspDemo({ runtime = {}, port = 0, root = ROOT, accessKey = process.env.DEMO_ACCESS_KEY } = {}) {
  const opened = await createGcspRuntime(runtime); if (opened.status !== 'ok') return opened;
  const services = opened.value;
  let api; let origin; let closed = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
      const path = decodeURIComponent(new URL(req.url, origin).pathname);
      if (path.startsWith('/api/gcsp/')) {
        // Only this loopback host is a trusted local client of the existing shared-key boundary.
        if (accessKey) req.headers['x-access-key'] = accessKey;
        api.emit('request', req, res); return;
      }
      if (req.method !== 'GET' || !publicPath(path)) { res.writeHead(404).end('Not found'); return; }
      const assetPath = path === '/gcsp/offer' ? '/gcsp-offer.html' : path;
      const file = resolve(root, `.${assetPath}`);
      const canonicalPath = `/${relative(resolve(root), file).split(sep).join('/')}`;
      if (!file.startsWith(`${resolve(root)}${sep}`) || !publicPath(canonicalPath) || canonicalPath !== assetPath
        || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
      if (sessionPage(path)) {
        const session = await services.identity.resolveSession({ authorized: true, cookie: req.headers.cookie });
        if (session.status !== 'ok') {
          const issued = await services.createLocalSession();
          if (issued.status !== 'ok') { res.writeHead(503).end('The local demo could not start.'); return; }
          res.setHeader('Set-Cookie', issued.value.setCookie);
        }
      }
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  });
  const close = async () => {
    if (closed) return; closed = true;
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    api?.closeAllConnections(); await services.close();
  };
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, 'localhost', done); });
    origin = `http://localhost:${server.address().port}`;
    api = buildServer({ ...services.dependencies, gcspAllowedOrigins: [origin] });
    const startup = await api.gcspStartup;
    if (startup?.status !== 'ok') { await close(); return startup; }
    return { status: 'ok', value: { origin, server, services, close } };
  } catch { await close(); return { status: 'unavailable', reason: 'The local demo could not start.', retryable: true }; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.env.GCSP_REPOSITORY_MODE || 'postgres';
  let connectionString = process.env.GCSP_DATABASE_URL;
  if (!connectionString && mode === 'postgres') {
    try { connectionString = (await readFile(resolve(ROOT, '.claude/gcsp-database-url'), 'utf8')).trim(); } catch { /* Missing configuration remains an explicit refusal. */ }
  }
  const app = await startGcspDemo({ port: Number(process.env.PORT) || 3001, runtime: { mode,
    repositoryOptions: { connectionString }, environmentId: process.env.GCSP_ENVIRONMENT_ID || 'gcsp-local-functional',
    policyAsOf: new Date().toISOString(), commandId: 'local-bootstrap' } });
  if (app.status !== 'ok') { console.error(`GCSP local startup: ${app.status}${app.code ? ` (${app.code})` : ''}`); process.exitCode = 1; }
  else {
    console.log(`GCSP local demo: ${app.value.origin}/gcsp-brief-live.html`);
    console.log(mode === 'memory' ? 'Explicit memory proof: state lasts only until this process stops; real released stock is not composed.' : 'PostgreSQL runtime; real released stock is not composed.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.value.close(); process.exitCode = 0; });
  }
}
