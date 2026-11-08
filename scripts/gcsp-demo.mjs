#!/usr/bin/env node
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../server/index.js';
import { createGcspRuntime } from '../server/gcsp/runtime.js';
import { createGcspFront, gcspRuntimeOptions } from '../server/gcsp/host.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

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
  let api; let origin; let services; let server; let front; let closed = false;
  const handle = (req, res) => {
    if (!front) { res.writeHead(503).end('The local demo is starting.'); return; }
    front(req, res);
  };
  // Validate TLS before opening repositories or allocating a listener. Never expose file or OpenSSL errors.
  try {
    const [key, cert] = await Promise.all([readFile(tls.keyFile), readFile(tls.certFile)]);
    server = createServer({ key, cert, passphrase: tls.passphrase, minVersion: 'TLSv1.2' }, handle);
  } catch { return tlsRefusal('local-tls-configuration-invalid'); }
  const opened = await createGcspRuntime(runtime); if (opened.status !== 'ok') return opened;
  services = opened.value;
  const close = async () => {
    if (closed) return; closed = true; front = null;
    await new Promise((done) => { server.close(done); server.closeAllConnections(); });
    api?.closeAllConnections(); await services.close();
  };
  try {
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port, 'localhost', done); });
    origin = `https://localhost:${server.address().port}`;
    api = buildServer({ ...services.dependencies, gcspAllowedOrigins: [origin] });
    const startup = await api.gcspStartup;
    if (startup?.status !== 'ok') { await close(); return startup; }
    front = createGcspFront({ root, services, api, origin, accessKey });
    return { status: 'ok', value: { origin, server, services, close } };
  } catch { await close(); return { status: 'unavailable', reason: 'The local demo could not start.', retryable: true }; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { runtime, stock, mode, environmentId } = gcspRuntimeOptions({ defaultMode: 'postgres',
    defaultEnvironmentId: 'gcsp-local-functional', commandId: 'local-bootstrap' });
  const app = await startGcspDemo({ port: Number(process.env.PORT) || 3001, runtime });
  if (app.status !== 'ok') { console.error(`GCSP local startup: ${app.status}${app.code ? ` (${app.code})` : ''}`); process.exitCode = 1; }
  else {
    console.log(`GCSP local demo: ${app.value.origin}/gcsp-account.html`);
    console.log(`Presenter workspace: ${app.value.origin}/gcsp-presenter.html`);
    console.log(mode === 'memory' ? 'Explicit memory proof: state lasts only until this process stops.' : 'PostgreSQL runtime.');
    const current = await app.value.services.repository.currentRun(environmentId);
    const chosen = current.status === 'ok' ? stock.provider?.describe?.(current.value.runId) : null;
    console.log(stock.forced ? 'Stock source: synthetic demo stock on reviewed configurations (GCSP_STOCK_SOURCE=demo).'
      : chosen?.source === 'generated' ? 'Stock source: synthetic stock generated on the retained corpus configurations; not BMW stock.'
        : chosen ? `Stock source: synthetic demo stock on reviewed configurations. ${chosen.reason}`
          : 'Stock source: chosen per run on its first release; generated stock, else synthetic demo stock.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.value.close(); process.exitCode = 0; });
  }
}
