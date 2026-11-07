#!/usr/bin/env node
import { createServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../server/index.js';
import { createGcspRuntime } from '../server/gcsp/runtime.js';
import { createDemoStockProvider } from '../server/gcsp/stock/demo-provider.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const sessionPage = (path) => ['/gcsp-brief-live.html', '/gcsp-activity-live.html', '/gcsp-account.html',
  '/gcsp-help.html', '/gcsp-greg.html', '/gcsp-case-queue.html', '/gcsp-presenter.html'].includes(path);
const navigationCookie = 'GCSP_LOCAL_BOOTSTRAP';
const publicPath = (path) => sessionPage(path) || ['/gcsp/offer', '/gcsp-offer.html', '/gcsp-employee.css', '/favicon.ico'].includes(path)
  || path.startsWith('/blocks/') || path.startsWith('/assets/');

const tlsConfiguration = () => ({ keyFile: process.env.GCSP_TLS_KEY_FILE, certFile: process.env.GCSP_TLS_CERT_FILE,
  passphrase: process.env.GCSP_TLS_KEY_PASSPHRASE });
const tlsRefusal = (code) => ({ status: 'invalid', code,
  reason: 'Configure a valid local HTTPS certificate and private key.', retryable: false });

// One HTTPS loopback origin serves both entries and the unchanged shared API gate.
export async function startGcspDemo({ runtime = {}, port = 0, root = ROOT, accessKey = process.env.DEMO_ACCESS_KEY,
  tls = tlsConfiguration() } = {}) {
  if (!tls || typeof tls !== 'object' || Array.isArray(tls)
    || Object.keys(tls).some((key) => !['keyFile', 'certFile', 'passphrase'].includes(key))
    || !['keyFile', 'certFile'].every((key) => typeof tls[key] === 'string' && tls[key].trim())
    || tls.passphrase !== undefined && typeof tls.passphrase !== 'string') return tlsRefusal('local-tls-configuration-required');
  let api; let origin; let services; let server; let ready = false; let closed = false;
  const handle = async (req, res) => {
    try {
      if (!ready) { res.writeHead(503).end('The local demo is starting.'); return; }
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
      // API cookies deliberately stay on /api/gcsp, so browsers do not send them
      // on HTML navigation. This non-authority marker only prevents rebootstrap;
      // every API request still authenticates the unchanged identity cookies.
      const bootstrapped = req.headers.cookie?.split(';').some((value) => value.trim() === `${navigationCookie}=1`);
      if (sessionPage(path) && !bootstrapped) {
        const session = await services.identity.resolveSession({ authorized: true, cookie: req.headers.cookie });
        if (session.status !== 'ok') {
          const issued = await services.createLocalSession();
          if (issued.status !== 'ok') { res.writeHead(503).end('The local demo could not start.'); return; }
          const expires = issued.value.setCookie.at(-1).match(/; Expires=([^;]+)/)?.[1];
          if (!expires) { res.writeHead(503).end('The local demo could not start.'); return; }
          res.setHeader('Set-Cookie', [...issued.value.setCookie,
            `${navigationCookie}=1; Path=/; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`]);
        }
      }
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer' });
      res.end(await readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  };
  // Validate TLS before opening repositories or allocating a listener. Never expose file or OpenSSL errors.
  try {
    const [key, cert] = await Promise.all([readFile(tls.keyFile), readFile(tls.certFile)]);
    server = createServer({ key, cert, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, handle);
  } catch { return tlsRefusal('local-tls-configuration-invalid'); }
  const opened = await createGcspRuntime(runtime); if (opened.status !== 'ok') return opened;
  services = opened.value;
  const close = async () => {
    if (closed) return; closed = true; ready = false;
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    api?.closeAllConnections(); await services.close();
  };
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, 'localhost', done); });
    origin = `https://localhost:${server.address().port}`;
    api = buildServer({ ...services.dependencies, gcspAllowedOrigins: [origin] });
    const startup = await api.gcspStartup;
    if (startup?.status !== 'ok') { await close(); return startup; }
    ready = true;
    return { status: 'ok', value: { origin, server, services, close } };
  } catch { await close(); return { status: 'unavailable', reason: 'The local demo could not start.', retryable: true }; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mode = process.env.GCSP_REPOSITORY_MODE || 'postgres';
  const connectionString = process.env.GCSP_DATABASE_URL;
  const app = await startGcspDemo({ port: Number(process.env.PORT) || 3001, runtime: { mode, stockProvider: (deps) => createDemoStockProvider(deps),
    repositoryOptions: { connectionString }, environmentId: process.env.GCSP_ENVIRONMENT_ID || 'gcsp-local-functional',
    policyAsOf: new Date().toISOString(), commandId: 'local-bootstrap' } });
  if (app.status !== 'ok') { console.error(`GCSP local startup: ${app.status}${app.code ? ` (${app.code})` : ''}`); process.exitCode = 1; }
  else {
    console.log(`GCSP local demo: ${app.value.origin}/gcsp-account.html`);
    console.log(`Presenter workspace: ${app.value.origin}/gcsp-presenter.html`);
    console.log(`${mode === 'memory' ? 'Explicit memory proof: state lasts only until this process stops.' : 'PostgreSQL runtime.'} Released stock is synthetic demo stock.`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.value.close(); process.exitCode = 0; });
  }
}
